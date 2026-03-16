package gopherhole

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestNew(t *testing.T) {
	t.Run("creates client with defaults", func(t *testing.T) {
		client := New("gph_test_key")

		if client.apiKey != "gph_test_key" {
			t.Errorf("expected apiKey 'gph_test_key', got %q", client.apiKey)
		}
		if client.hubURL != DefaultHubURL {
			t.Errorf("expected hubURL %q, got %q", DefaultHubURL, client.hubURL)
		}
		if client.apiURL != DefaultAPIURL {
			t.Errorf("expected apiURL %q, got %q", DefaultAPIURL, client.apiURL)
		}
		if !client.autoReconnect {
			t.Error("expected autoReconnect to be true")
		}
		if client.maxReconnectAttempts != 0 {
			t.Errorf("expected maxReconnectAttempts 0 (infinite), got %d", client.maxReconnectAttempts)
		}
		if client.maxReconnectDelay != 5*time.Minute {
			t.Errorf("expected maxReconnectDelay 5m, got %v", client.maxReconnectDelay)
		}
	})

	t.Run("accepts custom hub URL", func(t *testing.T) {
		client := New("gph_test_key", WithHubURL("wss://custom.hub.ai/ws"))

		if client.hubURL != "wss://custom.hub.ai/ws" {
			t.Errorf("expected custom hubURL, got %q", client.hubURL)
		}
		// Should derive API URL from hub URL
		if client.apiURL != "https://custom.hub.ai" {
			t.Errorf("expected derived apiURL, got %q", client.apiURL)
		}
	})

	t.Run("accepts custom API URL", func(t *testing.T) {
		client := New("gph_test_key", WithAPIURL("https://custom.api.ai"))

		if client.apiURL != "https://custom.api.ai" {
			t.Errorf("expected custom apiURL, got %q", client.apiURL)
		}
	})

	t.Run("accepts auto reconnect option", func(t *testing.T) {
		client := New("gph_test_key", WithAutoReconnect(false))

		if client.autoReconnect {
			t.Error("expected autoReconnect to be false")
		}
	})

	t.Run("accepts reconnect delay option", func(t *testing.T) {
		client := New("gph_test_key", WithReconnectDelay(5*time.Second))

		if client.reconnectDelay != 5*time.Second {
			t.Errorf("expected reconnectDelay 5s, got %v", client.reconnectDelay)
		}
	})

	t.Run("accepts max reconnect attempts option", func(t *testing.T) {
		client := New("gph_test_key", WithMaxReconnectAttempts(5))

		if client.maxReconnectAttempts != 5 {
			t.Errorf("expected maxReconnectAttempts 5, got %d", client.maxReconnectAttempts)
		}
	})

	t.Run("accepts custom HTTP client", func(t *testing.T) {
		httpClient := &http.Client{Timeout: 60 * time.Second}
		client := New("gph_test_key", WithHTTPClient(httpClient))

		if client.httpClient != httpClient {
			t.Error("expected custom HTTP client")
		}
	})

	t.Run("accepts request timeout option", func(t *testing.T) {
		client := New("gph_test_key", WithRequestTimeout(60*time.Second))

		if client.requestTimeout != 60*time.Second {
			t.Errorf("expected requestTimeout 60s, got %v", client.requestTimeout)
		}
	})

	t.Run("accepts agent card option", func(t *testing.T) {
		card := &AgentCard{
			Name:    "Test Agent",
			Version: "1.0.0",
		}
		client := New("gph_test_key", WithAgentCard(card))

		if client.agentCard == nil || client.agentCard.Name != "Test Agent" {
			t.Error("expected agent card to be set")
		}
	})
}

func TestClientEventHandlers(t *testing.T) {
	t.Run("sets message handler", func(t *testing.T) {
		client := New("gph_test_key")
		client.OnMessage(func(m Message) {
			// handler set
		})

		if client.onMessage == nil {
			t.Error("expected onMessage handler to be set")
		}
	})

	t.Run("sets task update handler", func(t *testing.T) {
		client := New("gph_test_key")
		client.OnTaskUpdate(func(t Task) {})

		if client.onTaskUpdate == nil {
			t.Error("expected onTaskUpdate handler to be set")
		}
	})

	t.Run("sets error handler", func(t *testing.T) {
		client := New("gph_test_key")
		client.OnError(func(err error) {})

		if client.onError == nil {
			t.Error("expected onError handler to be set")
		}
	})

	t.Run("sets connect handler", func(t *testing.T) {
		client := New("gph_test_key")
		client.OnConnect(func() {})

		if client.onConnect == nil {
			t.Error("expected onConnect handler to be set")
		}
	})

	t.Run("sets disconnect handler", func(t *testing.T) {
		client := New("gph_test_key")
		client.OnDisconnect(func(reason string) {})

		if client.onDisconnect == nil {
			t.Error("expected onDisconnect handler to be set")
		}
	})
}

func TestClientRPC(t *testing.T) {
	t.Run("sends RPC request", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Verify request
			if r.Method != "POST" {
				t.Errorf("expected POST method, got %s", r.Method)
			}
			if r.URL.Path != "/a2a" {
				t.Errorf("expected /a2a path, got %s", r.URL.Path)
			}
			if r.Header.Get("Authorization") != "Bearer gph_test_key" {
				t.Errorf("expected Authorization header, got %q", r.Header.Get("Authorization"))
			}
			if r.Header.Get("Content-Type") != "application/json" {
				t.Errorf("expected Content-Type header, got %q", r.Header.Get("Content-Type"))
			}

			// Parse request
			var req jsonRPCRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Fatalf("failed to decode request: %v", err)
			}

			// Return response
			resp := jsonRPCResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
			}
			result, _ := json.Marshal(map[string]interface{}{
				"id":        "task-123",
				"contextId": "ctx-456",
				"status": map[string]string{
					"state":     "submitted",
					"timestamp": "2024-01-01T00:00:00Z",
				},
			})
			resp.Result = result

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		task, err := client.SendText(ctx, "agent-id", "Hello", nil)
		if err != nil {
			t.Fatalf("SendText failed: %v", err)
		}

		if task.ID != "task-123" {
			t.Errorf("expected task ID 'task-123', got %q", task.ID)
		}
		if task.ContextID != "ctx-456" {
			t.Errorf("expected context ID 'ctx-456', got %q", task.ContextID)
		}
	})

	t.Run("handles RPC error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			resp := jsonRPCResponse{
				JSONRPC: "2.0",
				Error: &jsonRPCError{
					Code:    -32001,
					Message: "Task not found",
				},
				ID: 1,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		_, err := client.GetTask(ctx, "nonexistent", 0)
		if err == nil {
			t.Fatal("expected error")
		}
		if !strings.Contains(err.Error(), "Task not found") {
			t.Errorf("expected 'Task not found' in error, got %q", err.Error())
		}
	})
}

func TestClientSendMethods(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req jsonRPCRequest
		json.NewDecoder(r.Body).Decode(&req)

		result, _ := json.Marshal(map[string]interface{}{
			"id":        "task-123",
			"contextId": "ctx-456",
			"status": map[string]string{
				"state":     "submitted",
				"timestamp": "2024-01-01T00:00:00Z",
			},
		})

		resp := jsonRPCResponse{
			JSONRPC: "2.0",
			Result:  result,
			ID:      req.ID,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	t.Run("Send creates task", func(t *testing.T) {
		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		payload := MessagePayload{
			Role:  RoleAgent,
			Parts: []MessagePart{TextPart("Hello")},
		}
		task, err := client.Send(ctx, "agent-id", payload, nil)

		if err != nil {
			t.Fatalf("Send failed: %v", err)
		}
		if task.ID != "task-123" {
			t.Errorf("expected task ID 'task-123', got %q", task.ID)
		}
	})

	t.Run("Send with options", func(t *testing.T) {
		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		payload := MessagePayload{
			Role:  RoleAgent,
			Parts: []MessagePart{TextPart("Hello")},
		}
		opts := &SendOptions{
			ContextID:     "existing-ctx",
			HistoryLength: 10,
		}
		_, err := client.Send(ctx, "agent-id", payload, opts)

		if err != nil {
			t.Fatalf("Send with options failed: %v", err)
		}
	})

	t.Run("SendText sends text message", func(t *testing.T) {
		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		task, err := client.SendText(ctx, "agent-id", "Hello world", nil)

		if err != nil {
			t.Fatalf("SendText failed: %v", err)
		}
		if task.ID != "task-123" {
			t.Errorf("expected task ID 'task-123', got %q", task.ID)
		}
	})
}

func TestClientTaskMethods(t *testing.T) {
	t.Run("GetTask fetches task", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var req jsonRPCRequest
			json.NewDecoder(r.Body).Decode(&req)

			if req.Method != "tasks/get" {
				t.Errorf("expected method 'tasks/get', got %q", req.Method)
			}

			result, _ := json.Marshal(map[string]interface{}{
				"id":        "task-123",
				"contextId": "ctx-456",
				"status": map[string]string{
					"state":     "completed",
					"timestamp": "2024-01-01T00:00:00Z",
				},
				"artifacts": []map[string]interface{}{
					{
						"parts": []map[string]string{
							{"kind": "text", "text": "Response"},
						},
					},
				},
			})

			resp := jsonRPCResponse{
				JSONRPC: "2.0",
				Result:  result,
				ID:      req.ID,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		task, err := client.GetTask(ctx, "task-123", 0)
		if err != nil {
			t.Fatalf("GetTask failed: %v", err)
		}

		if task.ID != "task-123" {
			t.Errorf("expected task ID 'task-123', got %q", task.ID)
		}
		if task.Status.State != "completed" {
			t.Errorf("expected state 'completed', got %q", task.Status.State)
		}
	})

	t.Run("CancelTask cancels task", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var req jsonRPCRequest
			json.NewDecoder(r.Body).Decode(&req)

			if req.Method != "tasks/cancel" {
				t.Errorf("expected method 'tasks/cancel', got %q", req.Method)
			}

			result, _ := json.Marshal(map[string]interface{}{
				"id":        "task-123",
				"contextId": "ctx-456",
				"status": map[string]string{
					"state":     "canceled",
					"timestamp": "2024-01-01T00:00:00Z",
				},
			})

			resp := jsonRPCResponse{
				JSONRPC: "2.0",
				Result:  result,
				ID:      req.ID,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		task, err := client.CancelTask(ctx, "task-123")
		if err != nil {
			t.Fatalf("CancelTask failed: %v", err)
		}

		if task.Status.State != "canceled" {
			t.Errorf("expected state 'canceled', got %q", task.Status.State)
		}
	})
}

func TestClientWaitForTask(t *testing.T) {
	t.Run("returns immediately when task is completed", func(t *testing.T) {
		callCount := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			callCount++
			result, _ := json.Marshal(map[string]interface{}{
				"id":        "task-123",
				"contextId": "ctx-456",
				"status": map[string]string{
					"state":     "completed",
					"timestamp": "2024-01-01T00:00:00Z",
				},
			})

			resp := jsonRPCResponse{
				JSONRPC: "2.0",
				Result:  result,
				ID:      1,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		task, err := client.WaitForTask(ctx, "task-123", &WaitOptions{
			PollInterval: 10 * time.Millisecond,
			MaxWait:      1 * time.Second,
		})

		if err != nil {
			t.Fatalf("WaitForTask failed: %v", err)
		}
		if task.Status.State != TaskStateCompleted {
			t.Errorf("expected completed state, got %q", task.Status.State)
		}
		if callCount != 1 {
			t.Errorf("expected 1 call, got %d", callCount)
		}
	})

	t.Run("polls until task completes", func(t *testing.T) {
		callCount := 0
		var mu sync.Mutex
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			callCount++
			currentCount := callCount
			mu.Unlock()

			state := "working"
			if currentCount >= 3 {
				state = "completed"
			}

			result, _ := json.Marshal(map[string]interface{}{
				"id":        "task-123",
				"contextId": "ctx-456",
				"status": map[string]string{
					"state":     state,
					"timestamp": "2024-01-01T00:00:00Z",
				},
			})

			resp := jsonRPCResponse{
				JSONRPC: "2.0",
				Result:  result,
				ID:      1,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		task, err := client.WaitForTask(ctx, "task-123", &WaitOptions{
			PollInterval: 10 * time.Millisecond,
			MaxWait:      1 * time.Second,
		})

		if err != nil {
			t.Fatalf("WaitForTask failed: %v", err)
		}
		if task.Status.State != TaskStateCompleted {
			t.Errorf("expected completed state, got %q", task.Status.State)
		}

		mu.Lock()
		if callCount < 3 {
			t.Errorf("expected at least 3 calls, got %d", callCount)
		}
		mu.Unlock()
	})

	t.Run("times out when task doesn't complete", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			result, _ := json.Marshal(map[string]interface{}{
				"id":        "task-123",
				"contextId": "ctx-456",
				"status": map[string]string{
					"state":     "working",
					"timestamp": "2024-01-01T00:00:00Z",
				},
			})

			resp := jsonRPCResponse{
				JSONRPC: "2.0",
				Result:  result,
				ID:      1,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		_, err := client.WaitForTask(ctx, "task-123", &WaitOptions{
			PollInterval: 10 * time.Millisecond,
			MaxWait:      50 * time.Millisecond,
		})

		if err == nil {
			t.Fatal("expected timeout error")
		}
		// Accept either our timeout message or context deadline exceeded
		if !strings.Contains(err.Error(), "did not complete") && !strings.Contains(err.Error(), "deadline exceeded") {
			t.Errorf("expected timeout error, got %q", err.Error())
		}
	})
}

func TestClientAskText(t *testing.T) {
	t.Run("returns response text on success", func(t *testing.T) {
		callCount := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			callCount++
			var req jsonRPCRequest
			json.NewDecoder(r.Body).Decode(&req)

			var result []byte
			if req.Method == "message/send" {
				result, _ = json.Marshal(map[string]interface{}{
					"id":        "task-123",
					"contextId": "ctx-456",
					"status": map[string]string{
						"state":     "submitted",
						"timestamp": "2024-01-01T00:00:00Z",
					},
				})
			} else {
				result, _ = json.Marshal(map[string]interface{}{
					"id":        "task-123",
					"contextId": "ctx-456",
					"status": map[string]string{
						"state":     "completed",
						"timestamp": "2024-01-01T00:00:00Z",
					},
					"artifacts": []map[string]interface{}{
						{
							"parts": []map[string]string{
								{"kind": "text", "text": "Hello from agent!"},
							},
						},
					},
				})
			}

			resp := jsonRPCResponse{
				JSONRPC: "2.0",
				Result:  result,
				ID:      req.ID,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		response, err := client.AskText(ctx, "agent-id", "Hello", nil, &WaitOptions{
			PollInterval: 10 * time.Millisecond,
			MaxWait:      1 * time.Second,
		})

		if err != nil {
			t.Fatalf("AskText failed: %v", err)
		}
		if response != "Hello from agent!" {
			t.Errorf("expected 'Hello from agent!', got %q", response)
		}
	})

	t.Run("returns error on task failure", func(t *testing.T) {
		callCount := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			callCount++
			var req jsonRPCRequest
			json.NewDecoder(r.Body).Decode(&req)

			var result []byte
			if req.Method == "message/send" {
				result, _ = json.Marshal(map[string]interface{}{
					"id":        "task-123",
					"contextId": "ctx-456",
					"status": map[string]string{
						"state":     "submitted",
						"timestamp": "2024-01-01T00:00:00Z",
					},
				})
			} else {
				result, _ = json.Marshal(map[string]interface{}{
					"id":        "task-123",
					"contextId": "ctx-456",
					"status": map[string]interface{}{
						"state":     "failed",
						"timestamp": "2024-01-01T00:00:00Z",
						"message":   "Something went wrong",
					},
				})
			}

			resp := jsonRPCResponse{
				JSONRPC: "2.0",
				Result:  result,
				ID:      req.ID,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		_, err := client.AskText(ctx, "agent-id", "Hello", nil, &WaitOptions{
			PollInterval: 10 * time.Millisecond,
			MaxWait:      1 * time.Second,
		})

		if err == nil {
			t.Fatal("expected error")
		}
		if !strings.Contains(err.Error(), "Something went wrong") {
			t.Errorf("expected 'Something went wrong' in error, got %q", err.Error())
		}
	})
}

func TestClientDiscoveryMethods(t *testing.T) {
	t.Run("Discover fetches agents", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !strings.HasPrefix(r.URL.Path, "/api/discover/agents") {
				t.Errorf("expected /api/discover/agents path, got %s", r.URL.Path)
			}

			// Check query params
			if r.URL.Query().Get("q") != "weather" {
				t.Errorf("expected q=weather, got %q", r.URL.Query().Get("q"))
			}
			if r.URL.Query().Get("category") != "utility" {
				t.Errorf("expected category=utility, got %q", r.URL.Query().Get("category"))
			}

			result := DiscoverResult{
				Agents: []PublicAgent{
					{ID: "agent-1", Name: "Weather Agent", AvgRating: 4.5},
				},
				Count:  1,
				Offset: 0,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(result)
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		result, err := client.Discover(ctx, &DiscoverOptions{
			Query:    "weather",
			Category: "utility",
		})

		if err != nil {
			t.Fatalf("Discover failed: %v", err)
		}
		if len(result.Agents) != 1 {
			t.Errorf("expected 1 agent, got %d", len(result.Agents))
		}
		if result.Agents[0].Name != "Weather Agent" {
			t.Errorf("expected 'Weather Agent', got %q", result.Agents[0].Name)
		}
	})

	t.Run("SearchAgents searches by query", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("q") != "code assistant" {
				t.Errorf("expected q='code assistant', got %q", r.URL.Query().Get("q"))
			}

			result := DiscoverResult{Agents: []PublicAgent{}, Count: 0, Offset: 0}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(result)
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		_, err := client.SearchAgents(ctx, "code assistant", nil)
		if err != nil {
			t.Fatalf("SearchAgents failed: %v", err)
		}
	})

	t.Run("GetTopRated gets top rated agents", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("sort") != "rating" {
				t.Errorf("expected sort=rating, got %q", r.URL.Query().Get("sort"))
			}
			if r.URL.Query().Get("limit") != "5" {
				t.Errorf("expected limit=5, got %q", r.URL.Query().Get("limit"))
			}

			result := DiscoverResult{Agents: []PublicAgent{}, Count: 0, Offset: 0}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(result)
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		_, err := client.GetTopRated(ctx, 5)
		if err != nil {
			t.Fatalf("GetTopRated failed: %v", err)
		}
	})

	t.Run("GetPopular gets popular agents", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("sort") != "popular" {
				t.Errorf("expected sort=popular, got %q", r.URL.Query().Get("sort"))
			}

			result := DiscoverResult{Agents: []PublicAgent{}, Count: 0, Offset: 0}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(result)
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		_, err := client.GetPopular(ctx, 5)
		if err != nil {
			t.Fatalf("GetPopular failed: %v", err)
		}
	})

	t.Run("FindBySkillTag filters by skill tag", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("skillTag") != "summarization" {
				t.Errorf("expected skillTag=summarization, got %q", r.URL.Query().Get("skillTag"))
			}

			result := DiscoverResult{Agents: []PublicAgent{}, Count: 0, Offset: 0}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(result)
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		_, err := client.FindBySkillTag(ctx, "summarization", nil)
		if err != nil {
			t.Fatalf("FindBySkillTag failed: %v", err)
		}
	})

	t.Run("FindByContentMode filters by content mode", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("contentMode") != "text/markdown" {
				t.Errorf("expected contentMode=text/markdown, got %q", r.URL.Query().Get("contentMode"))
			}

			result := DiscoverResult{Agents: []PublicAgent{}, Count: 0, Offset: 0}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(result)
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		_, err := client.FindByContentMode(ctx, "text/markdown", nil)
		if err != nil {
			t.Fatalf("FindByContentMode failed: %v", err)
		}
	})

	t.Run("GetCategories fetches categories", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/api/discover/categories" {
				t.Errorf("expected /api/discover/categories path, got %s", r.URL.Path)
			}

			result := struct {
				Categories []AgentCategory `json:"categories"`
			}{
				Categories: []AgentCategory{
					{Name: "productivity", Count: 10},
					{Name: "utility", Count: 5},
				},
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(result)
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		categories, err := client.GetCategories(ctx)
		if err != nil {
			t.Fatalf("GetCategories failed: %v", err)
		}
		if len(categories) != 2 {
			t.Errorf("expected 2 categories, got %d", len(categories))
		}
	})

	t.Run("GetAgentInfo fetches agent details", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/api/discover/agents/agent-123" {
				t.Errorf("expected /api/discover/agents/agent-123 path, got %s", r.URL.Path)
			}

			result := AgentInfo{
				Agent: PublicAgent{ID: "agent-123", Name: "Test Agent"},
				Stats: AgentStats{AvgRating: 4.5, RatingCount: 10},
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(result)
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		info, err := client.GetAgentInfo(ctx, "agent-123")
		if err != nil {
			t.Fatalf("GetAgentInfo failed: %v", err)
		}
		if info.Agent.ID != "agent-123" {
			t.Errorf("expected agent ID 'agent-123', got %q", info.Agent.ID)
		}
	})

	t.Run("RateAgent rates an agent", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "POST" {
				t.Errorf("expected POST method, got %s", r.Method)
			}
			if r.URL.Path != "/api/discover/agents/agent-123/rate" {
				t.Errorf("expected /api/discover/agents/agent-123/rate path, got %s", r.URL.Path)
			}

			var body map[string]interface{}
			json.NewDecoder(r.Body).Decode(&body)
			if body["rating"].(float64) != 5 {
				t.Errorf("expected rating 5, got %v", body["rating"])
			}
			if body["review"] != "Great agent!" {
				t.Errorf("expected review 'Great agent!', got %v", body["review"])
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"success":     true,
				"avgRating":   4.6,
				"ratingCount": 11,
			})
		}))
		defer server.Close()

		client := New("gph_test_key", WithAPIURL(server.URL))
		ctx := context.Background()

		err := client.RateAgent(ctx, "agent-123", 5, "Great agent!")
		if err != nil {
			t.Fatalf("RateAgent failed: %v", err)
		}
	})
}

func TestClientWebSocket(t *testing.T) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	t.Run("Connect establishes WebSocket connection", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Verify auth header
			if r.Header.Get("Authorization") != "Bearer gph_test_key" {
				t.Errorf("expected Authorization header, got %q", r.Header.Get("Authorization"))
			}

			conn, err := upgrader.Upgrade(w, r, nil)
			if err != nil {
				t.Fatalf("failed to upgrade: %v", err)
			}
			defer conn.Close()

			// Send welcome message
			welcome := map[string]string{
				"type":    "welcome",
				"agentId": "my-agent-123",
			}
			conn.WriteJSON(welcome)

			// Keep connection open for a bit
			time.Sleep(100 * time.Millisecond)
		}))
		defer server.Close()

		wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
		client := New("gph_test_key", WithHubURL(wsURL))

		connected := make(chan bool, 1)
		client.OnConnect(func() {
			connected <- true
		})

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		err := client.Connect(ctx)
		if err != nil {
			t.Fatalf("Connect failed: %v", err)
		}

		select {
		case <-connected:
			// Success
		case <-time.After(1 * time.Second):
			t.Fatal("timeout waiting for connect event")
		}

		if !client.Connected() {
			t.Error("expected Connected() to return true")
		}

		client.Disconnect()
	})

	t.Run("handles incoming messages", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			conn, err := upgrader.Upgrade(w, r, nil)
			if err != nil {
				t.Fatalf("failed to upgrade: %v", err)
			}
			defer conn.Close()

			// Send welcome
			conn.WriteJSON(map[string]string{
				"type":    "welcome",
				"agentId": "my-agent-123",
			})

			// Send a message
			time.Sleep(50 * time.Millisecond)
			conn.WriteJSON(map[string]interface{}{
				"type":   "message",
				"from":   "other-agent",
				"taskId": "task-123",
				"payload": map[string]interface{}{
					"role": "user",
					"parts": []map[string]string{
						{"kind": "text", "text": "Hello!"},
					},
				},
				"timestamp": time.Now().UnixMilli(),
			})

			time.Sleep(100 * time.Millisecond)
		}))
		defer server.Close()

		wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
		client := New("gph_test_key", WithHubURL(wsURL))

		messageCh := make(chan Message, 1)
		client.OnMessage(func(m Message) {
			messageCh <- m
		})

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		err := client.Connect(ctx)
		if err != nil {
			t.Fatalf("Connect failed: %v", err)
		}

		select {
		case msg := <-messageCh:
			if msg.From != "other-agent" {
				t.Errorf("expected from 'other-agent', got %q", msg.From)
			}
			if msg.TaskID != "task-123" {
				t.Errorf("expected taskId 'task-123', got %q", msg.TaskID)
			}
		case <-time.After(1 * time.Second):
			t.Fatal("timeout waiting for message")
		}

		client.Disconnect()
	})

	t.Run("Disconnect closes connection", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			conn, err := upgrader.Upgrade(w, r, nil)
			if err != nil {
				t.Fatalf("failed to upgrade: %v", err)
			}
			defer conn.Close()

			// Send welcome
			conn.WriteJSON(map[string]string{
				"type":    "welcome",
				"agentId": "my-agent-123",
			})

			// Keep connection open
			for {
				_, _, err := conn.ReadMessage()
				if err != nil {
					return
				}
			}
		}))
		defer server.Close()

		wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
		client := New("gph_test_key", WithHubURL(wsURL), WithAutoReconnect(false))

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		err := client.Connect(ctx)
		if err != nil {
			t.Fatalf("Connect failed: %v", err)
		}

		if !client.Connected() {
			t.Error("expected Connected() to return true")
		}

		client.Disconnect()

		// Give it a moment to disconnect
		time.Sleep(50 * time.Millisecond)

		if client.Connected() {
			t.Error("expected Connected() to return false after disconnect")
		}
	})
}
