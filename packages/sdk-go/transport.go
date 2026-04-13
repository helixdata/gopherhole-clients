package gopherhole

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// TransportMode specifies how JSON-RPC requests are sent to the hub.
type TransportMode string

const (
	// TransportHTTP sends all RPC requests via HTTP POST to /a2a.
	TransportHTTP TransportMode = "http"
	// TransportWS sends all RPC requests as JSON-RPC frames over WebSocket.
	TransportWS TransportMode = "ws"
	// TransportAuto uses HTTP for RPC (default, backwards-compatible behaviour).
	TransportAuto TransportMode = "auto"
)

// Transport sends JSON-RPC requests to the hub.
type Transport interface {
	// Request sends a JSON-RPC request and unmarshals the result into dest.
	Request(ctx context.Context, method string, params interface{}, dest interface{}) error
	// IsOpen reports whether the transport can currently send requests.
	IsOpen() bool
	// Close cleans up resources.
	Close() error
}

// httpTransport sends JSON-RPC requests via HTTP POST.
type httpTransport struct {
	apiURL         string
	apiKey         string
	httpClient     *http.Client
	requestTimeout time.Duration
	rpcCounter     atomic.Int64
}

func newHTTPTransport(apiURL, apiKey string, httpClient *http.Client, timeout time.Duration) *httpTransport {
	return &httpTransport{
		apiURL:         apiURL,
		apiKey:         apiKey,
		httpClient:     httpClient,
		requestTimeout: timeout,
	}
}

func (t *httpTransport) IsOpen() bool { return true }

func (t *httpTransport) Request(ctx context.Context, method string, params interface{}, dest interface{}) error {
	req := jsonRPCRequest{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
		ID:      t.rpcCounter.Add(1),
	}

	body, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", t.apiURL+"/a2a", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+t.apiKey)
	httpReq.Header.Set("A2A-Version", "1.0")

	resp, err := t.httpClient.Do(httpReq)
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

	if dest != nil && rpcResp.Result != nil {
		if err := json.Unmarshal(rpcResp.Result, dest); err != nil {
			return fmt.Errorf("unmarshal result: %w", err)
		}
	}

	return nil
}

func (t *httpTransport) Close() error { return nil }

// wsTransport sends JSON-RPC requests as frames over an existing WebSocket.
type wsTransport struct {
	getConn        func() *websocket.Conn
	connMu         *sync.RWMutex
	requestTimeout time.Duration
	rpcCounter     atomic.Int64

	mu      sync.Mutex
	pending map[int64]chan wsResult

	// Optional HTTP fallback
	httpFallback *httpTransport
}

type wsResult struct {
	result json.RawMessage
	err    error
}

func newWSTransport(
	getConn func() *websocket.Conn,
	connMu *sync.RWMutex,
	timeout time.Duration,
	wsFallback bool,
	apiURL, apiKey string,
	httpClient *http.Client,
) *wsTransport {
	t := &wsTransport{
		getConn:        getConn,
		connMu:         connMu,
		requestTimeout: timeout,
		pending:        make(map[int64]chan wsResult),
	}
	if wsFallback {
		t.httpFallback = newHTTPTransport(apiURL, apiKey, httpClient, timeout)
	}
	return t
}

func (t *wsTransport) IsOpen() bool {
	t.connMu.RLock()
	conn := t.getConn()
	t.connMu.RUnlock()
	return conn != nil
}

// HandleMessage processes an incoming WebSocket message as a potential JSON-RPC response.
// Returns true if the message was consumed.
func (t *wsTransport) HandleMessage(data []byte) bool {
	var resp jsonRPCResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return false
	}

	// Must be a JSON-RPC 2.0 response (has result or error, and an id)
	if resp.JSONRPC != "2.0" || (resp.Result == nil && resp.Error == nil) {
		return false
	}

	t.mu.Lock()
	ch, ok := t.pending[resp.ID]
	if ok {
		delete(t.pending, resp.ID)
	}
	t.mu.Unlock()

	if !ok {
		return false
	}

	if resp.Error != nil {
		ch <- wsResult{err: fmt.Errorf("rpc error %d: %s", resp.Error.Code, resp.Error.Message)}
	} else {
		ch <- wsResult{result: resp.Result}
	}
	return true
}

func (t *wsTransport) Request(ctx context.Context, method string, params interface{}, dest interface{}) error {
	t.connMu.RLock()
	conn := t.getConn()
	t.connMu.RUnlock()

	if conn == nil {
		if t.httpFallback != nil {
			return t.httpFallback.Request(ctx, method, params, dest)
		}
		return fmt.Errorf("WebSocket not connected. Call Connect() first or enable WithWSFallback(true)")
	}

	id := t.rpcCounter.Add(1)
	ch := make(chan wsResult, 1)

	t.mu.Lock()
	t.pending[id] = ch
	t.mu.Unlock()

	req := jsonRPCRequest{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
		ID:      id,
	}

	t.connMu.RLock()
	err := conn.WriteJSON(req)
	t.connMu.RUnlock()
	if err != nil {
		t.mu.Lock()
		delete(t.pending, id)
		t.mu.Unlock()
		return fmt.Errorf("ws send: %w", err)
	}

	select {
	case res := <-ch:
		if res.err != nil {
			return res.err
		}
		if dest != nil && res.result != nil {
			if err := json.Unmarshal(res.result, dest); err != nil {
				return fmt.Errorf("unmarshal result: %w", err)
			}
		}
		return nil
	case <-ctx.Done():
		t.mu.Lock()
		delete(t.pending, id)
		t.mu.Unlock()
		return ctx.Err()
	case <-time.After(t.requestTimeout):
		t.mu.Lock()
		delete(t.pending, id)
		t.mu.Unlock()
		return fmt.Errorf("request timeout after %v", t.requestTimeout)
	}
}

// Cleanup cancels all pending requests (called on disconnect).
func (t *wsTransport) Cleanup() {
	t.mu.Lock()
	for id, ch := range t.pending {
		ch <- wsResult{err: fmt.Errorf("WebSocket disconnected")}
		delete(t.pending, id)
	}
	t.mu.Unlock()
}

func (t *wsTransport) Close() error {
	t.Cleanup()
	if t.httpFallback != nil {
		return t.httpFallback.Close()
	}
	return nil
}
