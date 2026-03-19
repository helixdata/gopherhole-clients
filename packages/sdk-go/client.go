package gopherhole

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

const (
	DefaultHubURL = "wss://hub.gopherhole.ai/ws"
	DefaultAPIURL = "https://hub.gopherhole.ai"
)

// ClientOption configures a Client.
type ClientOption func(*Client)

// WithHubURL sets a custom hub WebSocket URL.
func WithHubURL(url string) ClientOption {
	return func(c *Client) {
		c.hubURL = url
	}
}

// WithAPIURL sets a custom API URL.
func WithAPIURL(url string) ClientOption {
	return func(c *Client) {
		c.apiURL = url
	}
}

// WithAutoReconnect enables/disables auto-reconnection.
func WithAutoReconnect(enabled bool) ClientOption {
	return func(c *Client) {
		c.autoReconnect = enabled
	}
}

// WithReconnectDelay sets the initial reconnect delay.
func WithReconnectDelay(d time.Duration) ClientOption {
	return func(c *Client) {
		c.reconnectDelay = d
	}
}

// WithMaxReconnectAttempts sets the maximum reconnection attempts (0 = infinite).
func WithMaxReconnectAttempts(n int) ClientOption {
	return func(c *Client) {
		c.maxReconnectAttempts = n
	}
}

// WithMaxReconnectDelay sets the maximum delay between reconnection attempts (caps exponential backoff).
func WithMaxReconnectDelay(d time.Duration) ClientOption {
	return func(c *Client) {
		c.maxReconnectDelay = d
	}
}

// WithHTTPClient sets a custom HTTP client.
func WithHTTPClient(hc *http.Client) ClientOption {
	return func(c *Client) {
		c.httpClient = hc
	}
}

// WithRequestTimeout sets the default request timeout.
func WithRequestTimeout(d time.Duration) ClientOption {
	return func(c *Client) {
		c.requestTimeout = d
	}
}

// WithAgentCard sets the agent card to register on connect.
func WithAgentCard(card *AgentCard) ClientOption {
	return func(c *Client) {
		c.agentCard = card
	}
}

// MessageHandler is called when a message is received.
type MessageHandler func(Message)

// TaskUpdateHandler is called when a task is updated.
type TaskUpdateHandler func(Task)

// ErrorHandler is called when an error occurs.
type ErrorHandler func(error)

// ReconnectingHandler is called when a reconnection attempt is scheduled.
type ReconnectingHandler func(attempt int, delay time.Duration)

// Client is a GopherHole SDK client.
type Client struct {
	apiKey               string
	hubURL               string
	apiURL               string
	autoReconnect        bool
	reconnectDelay       time.Duration
	maxReconnectDelay    time.Duration
	maxReconnectAttempts int
	requestTimeout       time.Duration
	httpClient           *http.Client
	agentCard            *AgentCard

	// WebSocket state
	conn              *websocket.Conn
	connMu            sync.RWMutex
	connected         atomic.Bool
	agentID           string
	reconnectAttempts int

	// Event handlers
	onMessage      MessageHandler
	onTaskUpdate   TaskUpdateHandler
	onError        ErrorHandler
	onConnect      func()
	onDisconnect   func(reason string)
	onReconnecting ReconnectingHandler

	// Lifecycle
	ctx        context.Context
	cancel     context.CancelFunc
	done       chan struct{}
	rpcCounter atomic.Int64
}

// New creates a new GopherHole client.
func New(apiKey string, opts ...ClientOption) *Client {
	c := &Client{
		apiKey:               apiKey,
		hubURL:               DefaultHubURL,
		apiURL:               DefaultAPIURL,
		autoReconnect:        true,
		reconnectDelay:       time.Second,
		maxReconnectDelay:    5 * time.Minute,
		maxReconnectAttempts: 0, // 0 = infinite
		requestTimeout:       30 * time.Second,
		done:                 make(chan struct{}),
	}

	for _, opt := range opts {
		opt(c)
	}

	// Set HTTP client timeout from requestTimeout
	if c.httpClient == nil {
		c.httpClient = &http.Client{Timeout: c.requestTimeout}
	}

	// Derive API URL from hub URL if not explicitly set
	if c.apiURL == DefaultAPIURL && c.hubURL != DefaultHubURL {
		c.apiURL = strings.Replace(c.hubURL, "/ws", "", 1)
		c.apiURL = strings.Replace(c.apiURL, "wss://", "https://", 1)
		c.apiURL = strings.Replace(c.apiURL, "ws://", "http://", 1)
	}

	return c
}

// OnMessage sets the handler for incoming messages.
func (c *Client) OnMessage(h MessageHandler) {
	c.onMessage = h
}

// OnTaskUpdate sets the handler for task updates.
func (c *Client) OnTaskUpdate(h TaskUpdateHandler) {
	c.onTaskUpdate = h
}

// OnError sets the handler for errors.
func (c *Client) OnError(h ErrorHandler) {
	c.onError = h
}

// OnConnect sets the handler for connection events.
func (c *Client) OnConnect(h func()) {
	c.onConnect = h
}

// OnDisconnect sets the handler for disconnection events.
func (c *Client) OnDisconnect(h func(reason string)) {
	c.onDisconnect = h
}

// OnReconnecting sets the handler for reconnection attempts.
func (c *Client) OnReconnecting(h ReconnectingHandler) {
	c.onReconnecting = h
}

// Connect establishes a WebSocket connection to the hub.
func (c *Client) Connect(ctx context.Context) error {
	c.ctx, c.cancel = context.WithCancel(ctx)

	header := http.Header{}
	header.Set("Authorization", "Bearer "+c.apiKey)

	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.DialContext(c.ctx, c.hubURL, header)
	if err != nil {
		return fmt.Errorf("websocket dial: %w", err)
	}

	c.connMu.Lock()
	c.conn = conn
	c.connMu.Unlock()
	c.connected.Store(true)
	c.reconnectAttempts = 0

	// Start message reader
	go c.readLoop()

	// Start ping loop
	go c.pingLoop()

	if c.onConnect != nil {
		c.onConnect()
	}

	return nil
}

// Disconnect closes the WebSocket connection.
func (c *Client) Disconnect() {
	c.autoReconnect = false
	if c.cancel != nil {
		c.cancel()
	}
	c.connMu.Lock()
	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}
	c.connMu.Unlock()
	c.connected.Store(false)
}

// Connected returns true if the client is connected.
func (c *Client) Connected() bool {
	return c.connected.Load()
}

// AgentID returns the agent ID (available after connect).
func (c *Client) AgentID() string {
	return c.agentID
}

// Wait blocks until the client disconnects.
func (c *Client) Wait() {
	<-c.done
}

// Send sends a message to another agent.
func (c *Client) Send(ctx context.Context, toAgentID string, payload MessagePayload, opts *SendOptions) (*Task, error) {
	params := map[string]interface{}{
		"message": payload,
		"configuration": map[string]interface{}{
			"agentId": toAgentID,
		},
	}

	if opts != nil {
		config := params["configuration"].(map[string]interface{})
		if opts.ContextID != "" {
			config["contextId"] = opts.ContextID
		}
		if opts.PushNotificationURL != "" {
			config["pushNotificationUrl"] = opts.PushNotificationURL
		}
		if opts.HistoryLength > 0 {
			config["historyLength"] = opts.HistoryLength
		}
	}

	var task Task
	if err := c.rpc(ctx, "message/send", params, &task); err != nil {
		return nil, err
	}
	return &task, nil
}

// SendText sends a text message to another agent.
func (c *Client) SendText(ctx context.Context, toAgentID, text string, opts *SendOptions) (*Task, error) {
	return c.Send(ctx, toAgentID, MessagePayload{
		Role:  RoleAgent,
		Parts: []MessagePart{TextPart(text)},
	}, opts)
}

// SendTextAndWait sends a text message and waits for completion.
func (c *Client) SendTextAndWait(ctx context.Context, toAgentID, text string, opts *SendOptions, waitOpts *WaitOptions) (*Task, error) {
	task, err := c.SendText(ctx, toAgentID, text, opts)
	if err != nil {
		return nil, err
	}
	return c.WaitForTask(ctx, task.ID, waitOpts)
}

// AskText sends a text message and returns the response text.
// This is the simplest way to interact with another agent - it handles
// all the polling and response extraction automatically.
func (c *Client) AskText(ctx context.Context, toAgentID, text string, opts *SendOptions, waitOpts *WaitOptions) (string, error) {
	task, err := c.SendTextAndWait(ctx, toAgentID, text, opts, waitOpts)
	if err != nil {
		return "", err
	}
	if task.Status.State == TaskStateFailed {
		msg := task.Status.Message
		if msg == "" {
			msg = "task failed"
		}
		return "", errors.New(msg)
	}
	return task.GetResponseText(), nil
}

// WaitOptions configures the WaitForTask behavior.
type WaitOptions struct {
	// PollInterval is the time between polls (default 1s).
	PollInterval time.Duration
	// MaxWait is the maximum wait time (default 5 min).
	MaxWait time.Duration
}

// WaitForTask polls a task until it reaches a terminal state.
func (c *Client) WaitForTask(ctx context.Context, taskID string, opts *WaitOptions) (*Task, error) {
	pollInterval := time.Second
	maxWait := 5 * time.Minute

	if opts != nil {
		if opts.PollInterval > 0 {
			pollInterval = opts.PollInterval
		}
		if opts.MaxWait > 0 {
			maxWait = opts.MaxWait
		}
	}

	ctx, cancel := context.WithTimeout(ctx, maxWait)
	defer cancel()

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		task, err := c.GetTask(ctx, taskID, 0)
		if err != nil {
			return nil, err
		}

		switch task.Status.State {
		case "completed", "failed", "canceled", "rejected":
			return task, nil
		}

		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("task %s did not complete within %v", taskID, maxWait)
		case <-ticker.C:
			// Continue polling
		}
	}
}

// UpdateCard updates the agent card (sends to hub if connected).
func (c *Client) UpdateCard(card *AgentCard) error {
	c.agentCard = card
	c.connMu.RLock()
	conn := c.conn
	c.connMu.RUnlock()
	if conn != nil {
		cardMsg := map[string]interface{}{
			"type":      "update_card",
			"agentCard": card,
		}
		return conn.WriteJSON(cardMsg)
	}
	return nil
}

// GetTask retrieves a task by ID.
func (c *Client) GetTask(ctx context.Context, taskID string, historyLength int) (*Task, error) {
	params := map[string]interface{}{
		"id": taskID,
	}
	if historyLength > 0 {
		params["historyLength"] = historyLength
	}

	var task Task
	if err := c.rpc(ctx, "tasks/get", params, &task); err != nil {
		return nil, err
	}
	return &task, nil
}

// CancelTask cancels a task.
func (c *Client) CancelTask(ctx context.Context, taskID string) (*Task, error) {
	params := map[string]interface{}{
		"id": taskID,
	}

	var task Task
	if err := c.rpc(ctx, "tasks/cancel", params, &task); err != nil {
		return nil, err
	}
	return &task, nil
}

// Reply sends a reply to an existing task.
func (c *Client) Reply(ctx context.Context, taskID string, payload MessagePayload) (*Task, error) {
	// Get the task to find context
	task, err := c.GetTask(ctx, taskID, 0)
	if err != nil {
		return nil, err
	}

	params := map[string]interface{}{
		"message": payload,
		"configuration": map[string]interface{}{
			"contextId": task.ContextID,
		},
	}

	var result Task
	if err := c.rpc(ctx, "message/send", params, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ReplyText sends a text reply to an existing task.
func (c *Client) ReplyText(ctx context.Context, taskID, text string) (*Task, error) {
	return c.Reply(ctx, taskID, MessagePayload{
		Role:  RoleAgent,
		Parts: []MessagePart{TextPart(text)},
	})
}

// Discover searches for public agents.
func (c *Client) Discover(ctx context.Context, opts *DiscoverOptions) (*DiscoverResult, error) {
	params := url.Values{}
	if opts != nil {
		if opts.Query != "" {
			params.Set("q", opts.Query)
		}
		if opts.Category != "" {
			params.Set("category", opts.Category)
		}
		if opts.Tag != "" {
			params.Set("tag", opts.Tag)
		}
		if opts.SkillTag != "" {
			params.Set("skillTag", opts.SkillTag)
		}
		if opts.ContentMode != "" {
			params.Set("contentMode", opts.ContentMode)
		}
		if opts.Sort != "" {
			params.Set("sort", opts.Sort)
		}
		if opts.Limit > 0 {
			params.Set("limit", strconv.Itoa(opts.Limit))
		}
		if opts.Offset > 0 {
			params.Set("offset", strconv.Itoa(opts.Offset))
		}
	}

	endpoint := c.apiURL + "/api/discover/agents"
	if len(params) > 0 {
		endpoint += "?" + params.Encode()
	}

	var result DiscoverResult
	if err := c.httpGet(ctx, endpoint, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// SearchAgents searches for agents by query.
func (c *Client) SearchAgents(ctx context.Context, query string, opts *DiscoverOptions) (*DiscoverResult, error) {
	if opts == nil {
		opts = &DiscoverOptions{}
	}
	opts.Query = query
	return c.Discover(ctx, opts)
}

// GetTopRated returns top-rated agents.
func (c *Client) GetTopRated(ctx context.Context, limit int) (*DiscoverResult, error) {
	return c.Discover(ctx, &DiscoverOptions{Sort: "rating", Limit: limit})
}

// GetPopular returns popular agents.
func (c *Client) GetPopular(ctx context.Context, limit int) (*DiscoverResult, error) {
	return c.Discover(ctx, &DiscoverOptions{Sort: "popular", Limit: limit})
}

// FindBySkillTag finds agents by skill tag (searches within agent skills).
func (c *Client) FindBySkillTag(ctx context.Context, skillTag string, opts *DiscoverOptions) (*DiscoverResult, error) {
	if opts == nil {
		opts = &DiscoverOptions{}
	}
	opts.SkillTag = skillTag
	return c.Discover(ctx, opts)
}

// FindByContentMode finds agents that support a specific input/output mode.
func (c *Client) FindByContentMode(ctx context.Context, mode string, opts *DiscoverOptions) (*DiscoverResult, error) {
	if opts == nil {
		opts = &DiscoverOptions{}
	}
	opts.ContentMode = mode
	return c.Discover(ctx, opts)
}

// GetCategories returns available agent categories.
func (c *Client) GetCategories(ctx context.Context) ([]AgentCategory, error) {
	var result struct {
		Categories []AgentCategory `json:"categories"`
	}
	if err := c.httpGet(ctx, c.apiURL+"/api/discover/categories", &result); err != nil {
		return nil, err
	}
	return result.Categories, nil
}

// GetAgentInfo returns detailed information about an agent.
func (c *Client) GetAgentInfo(ctx context.Context, agentID string) (*AgentInfo, error) {
	var result AgentInfo
	if err := c.httpGet(ctx, c.apiURL+"/api/discover/agents/"+agentID, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// RateAgent rates an agent.
func (c *Client) RateAgent(ctx context.Context, agentID string, rating int, review string) error {
	body := map[string]interface{}{
		"rating": rating,
	}
	if review != "" {
		body["review"] = review
	}

	return c.httpPost(ctx, c.apiURL+"/api/discover/agents/"+agentID+"/rate", body, nil)
}

// ============================================================
// WORKSPACE METHODS (GopherHole Extension)
// ============================================================

// WorkspaceCreate creates a new workspace.
func (c *Client) WorkspaceCreate(ctx context.Context, name, description string) (*Workspace, error) {
	params := map[string]interface{}{
		"name":        name,
		"description": description,
	}
	var result struct {
		Workspace Workspace `json:"workspace"`
	}
	if err := c.rpc(ctx, "x-gopherhole/workspace.create", params, &result); err != nil {
		return nil, err
	}
	return &result.Workspace, nil
}

// WorkspaceGet retrieves a workspace by ID.
func (c *Client) WorkspaceGet(ctx context.Context, workspaceID string) (*Workspace, error) {
	params := map[string]string{"workspace_id": workspaceID}
	var result struct {
		Workspace Workspace `json:"workspace"`
	}
	if err := c.rpc(ctx, "x-gopherhole/workspace.get", params, &result); err != nil {
		return nil, err
	}
	return &result.Workspace, nil
}

// WorkspaceDelete deletes a workspace (must be owner).
func (c *Client) WorkspaceDelete(ctx context.Context, workspaceID string) error {
	params := map[string]string{"workspace_id": workspaceID}
	return c.rpc(ctx, "x-gopherhole/workspace.delete", params, nil)
}

// WorkspaceList lists workspaces this agent is a member of.
func (c *Client) WorkspaceList(ctx context.Context) ([]Workspace, error) {
	var result struct {
		Workspaces []Workspace `json:"workspaces"`
	}
	if err := c.rpc(ctx, "x-gopherhole/workspace.list", map[string]interface{}{}, &result); err != nil {
		return nil, err
	}
	return result.Workspaces, nil
}

// WorkspaceMembersAdd adds an agent to a workspace (admin only).
func (c *Client) WorkspaceMembersAdd(ctx context.Context, workspaceID, agentID string, role WorkspaceRole) error {
	params := map[string]interface{}{
		"workspace_id": workspaceID,
		"agent_id":     agentID,
		"role":         role,
	}
	return c.rpc(ctx, "x-gopherhole/workspace.members.add", params, nil)
}

// WorkspaceMembersRemove removes an agent from a workspace (admin only).
func (c *Client) WorkspaceMembersRemove(ctx context.Context, workspaceID, agentID string) error {
	params := map[string]interface{}{
		"workspace_id": workspaceID,
		"agent_id":     agentID,
	}
	return c.rpc(ctx, "x-gopherhole/workspace.members.remove", params, nil)
}

// WorkspaceMembersList lists workspace members.
func (c *Client) WorkspaceMembersList(ctx context.Context, workspaceID string) ([]WorkspaceMember, error) {
	params := map[string]string{"workspace_id": workspaceID}
	var result struct {
		Members []WorkspaceMember `json:"members"`
	}
	if err := c.rpc(ctx, "x-gopherhole/workspace.members.list", params, &result); err != nil {
		return nil, err
	}
	return result.Members, nil
}

// WorkspaceStore stores a memory in a workspace.
func (c *Client) WorkspaceStore(ctx context.Context, params WorkspaceStoreParams) (*WorkspaceMemory, error) {
	var result struct {
		Memory WorkspaceMemory `json:"memory"`
	}
	if err := c.rpc(ctx, "x-gopherhole/workspace.store", params, &result); err != nil {
		return nil, err
	}
	return &result.Memory, nil
}

// WorkspaceQuery queries workspace memories using semantic search.
func (c *Client) WorkspaceQuery(ctx context.Context, params WorkspaceQueryParams) ([]WorkspaceMemory, error) {
	var result struct {
		Memories []WorkspaceMemory `json:"memories"`
		Count    int               `json:"count"`
	}
	if err := c.rpc(ctx, "x-gopherhole/workspace.query", params, &result); err != nil {
		return nil, err
	}
	return result.Memories, nil
}

// WorkspaceUpdate updates an existing memory.
func (c *Client) WorkspaceUpdate(ctx context.Context, params WorkspaceUpdateParams) (*WorkspaceMemory, error) {
	var result struct {
		Memory WorkspaceMemory `json:"memory"`
	}
	if err := c.rpc(ctx, "x-gopherhole/workspace.update", params, &result); err != nil {
		return nil, err
	}
	return &result.Memory, nil
}

// WorkspaceForget deletes memories by ID or semantic query.
func (c *Client) WorkspaceForget(ctx context.Context, workspaceID string, memoryID string, query string) (int, error) {
	params := map[string]interface{}{"workspace_id": workspaceID}
	if memoryID != "" {
		params["id"] = memoryID
	}
	if query != "" {
		params["query"] = query
	}
	var result struct {
		Deleted int `json:"deleted"`
	}
	if err := c.rpc(ctx, "x-gopherhole/workspace.forget", params, &result); err != nil {
		return 0, err
	}
	return result.Deleted, nil
}

// WorkspaceMemories lists memories in a workspace (non-semantic browse).
func (c *Client) WorkspaceMemories(ctx context.Context, params WorkspaceListMemoriesParams) (*WorkspaceMemoriesResult, error) {
	var result WorkspaceMemoriesResult
	if err := c.rpc(ctx, "x-gopherhole/workspace.memories", params, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// WorkspaceTypes returns available memory types.
func (c *Client) WorkspaceTypes(ctx context.Context) ([]MemoryType, error) {
	var result struct {
		Types []struct {
			ID string `json:"id"`
		} `json:"types"`
	}
	if err := c.rpc(ctx, "x-gopherhole/workspace.types", map[string]interface{}{}, &result); err != nil {
		return nil, err
	}
	types := make([]MemoryType, len(result.Types))
	for i, t := range result.Types {
		types[i] = MemoryType(t.ID)
	}
	return types, nil
}

// Internal methods

func (c *Client) rpc(ctx context.Context, method string, params interface{}, result interface{}) error {
	req := jsonRPCRequest{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
		ID:      c.rpcCounter.Add(1),
	}

	body, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.apiURL+"/a2a", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	var rpcResp jsonRPCResponse
	if err := json.Unmarshal(respBody, &rpcResp); err != nil {
		return fmt.Errorf("unmarshal response: %w", err)
	}

	if rpcResp.Error != nil {
		return fmt.Errorf("rpc error %d: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}

	if result != nil && rpcResp.Result != nil {
		if err := json.Unmarshal(rpcResp.Result, result); err != nil {
			return fmt.Errorf("unmarshal result: %w", err)
		}
	}

	return nil
}

func (c *Client) httpGet(ctx context.Context, url string, result interface{}) error {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("http %d: %s", resp.StatusCode, string(body))
	}

	return json.NewDecoder(resp.Body).Decode(result)
}

func (c *Client) httpPost(ctx context.Context, url string, body interface{}, result interface{}) error {
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("http %d: %s", resp.StatusCode, string(respBody))
	}

	if result != nil {
		return json.NewDecoder(resp.Body).Decode(result)
	}
	return nil
}

func (c *Client) readLoop() {
	defer func() {
		c.connected.Store(false)
		if c.onDisconnect != nil {
			c.onDisconnect("connection closed")
		}
		c.maybeReconnect()
		close(c.done)
	}()

	for {
		c.connMu.RLock()
		conn := c.conn
		c.connMu.RUnlock()

		if conn == nil {
			return
		}

		_, data, err := conn.ReadMessage()
		if err != nil {
			if c.onError != nil && !errors.Is(err, websocket.ErrCloseSent) {
				c.onError(err)
			}
			return
		}

		var msg wsMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			if c.onError != nil {
				c.onError(fmt.Errorf("unmarshal ws message: %w", err))
			}
			continue
		}

		c.handleWSMessage(msg)
	}
}

func (c *Client) handleWSMessage(msg wsMessage) {
	switch msg.Type {
	case "message":
		if c.onMessage != nil {
			var payload MessagePayload
			if err := json.Unmarshal(msg.Payload, &payload); err == nil {
				c.onMessage(Message{
					From:      msg.From,
					TaskID:    msg.TaskID,
					Payload:   payload,
					Timestamp: time.UnixMilli(msg.Timestamp),
				})
			}
		}
	case "task_update":
		if c.onTaskUpdate != nil && msg.Task != nil {
			c.onTaskUpdate(*msg.Task)
		}
	case "welcome":
		c.agentID = msg.AgentID
		// Send agent card if configured
		if c.agentCard != nil {
			c.connMu.RLock()
			conn := c.conn
			c.connMu.RUnlock()
			if conn != nil {
				cardMsg := map[string]interface{}{
					"type":      "update_card",
					"agentCard": c.agentCard,
				}
				_ = conn.WriteJSON(cardMsg)
			}
		}
	case "card_updated":
		// Agent card was successfully updated
	case "pong":
		// Heartbeat response, ignore
	}
}

func (c *Client) pingLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-c.ctx.Done():
			return
		case <-ticker.C:
			c.connMu.RLock()
			conn := c.conn
			c.connMu.RUnlock()

			if conn != nil {
				conn.WriteJSON(map[string]string{"type": "ping"})
			}
		}
	}
}

func (c *Client) maybeReconnect() {
	// Check if we should reconnect: enabled AND (infinite OR under max attempts)
	shouldReconnect := c.autoReconnect &&
		(c.maxReconnectAttempts == 0 || c.reconnectAttempts < c.maxReconnectAttempts)

	if !shouldReconnect {
		return
	}

	c.reconnectAttempts++
	// Exponential backoff capped at maxReconnectDelay
	uncappedDelay := c.reconnectDelay * time.Duration(1<<(c.reconnectAttempts-1))
	delay := uncappedDelay
	if delay > c.maxReconnectDelay {
		delay = c.maxReconnectDelay
	}

	// Emit reconnecting event
	if c.onReconnecting != nil {
		c.onReconnecting(c.reconnectAttempts, delay)
	}

	time.AfterFunc(delay, func() {
		if err := c.Connect(context.Background()); err != nil {
			if c.onError != nil {
				c.onError(fmt.Errorf("reconnect failed: %w", err))
			}
		}
	})
}
