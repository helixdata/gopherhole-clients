/**
 * GopherHole Transport Layer
 *
 * Defines the Transport interface and implementations for HTTP, WebSocket, and Auto modes.
 * The transport handles sending JSON-RPC requests to the hub — connection lifecycle
 * and push events are managed separately by the GopherHole class.
 */

export type TransportMode = 'http' | 'ws' | 'auto';

/**
 * Transport interface for sending JSON-RPC requests to the hub.
 */
export interface Transport {
  /** Send a JSON-RPC request and return the parsed result */
  request<T>(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  /** Whether this transport is currently able to send requests */
  readonly isOpen: boolean;
}

/**
 * HTTP Transport — sends JSON-RPC requests via HTTP POST to /a2a.
 * Always available, no connection required.
 */
export class HttpTransport implements Transport {
  constructor(
    private apiUrl: string,
    private apiKey: string,
    private defaultTimeout: number,
  ) {}

  get isOpen(): boolean {
    return true; // HTTP is always available
  }

  async request<T>(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    const timeout = timeoutMs ?? this.defaultTimeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.apiUrl}/a2a`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method,
          params,
          id: Date.now(),
        }),
        signal: controller.signal,
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message || 'RPC error');
      }

      return data.result as T;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * WebSocket Transport — sends JSON-RPC requests as frames over an existing WebSocket connection.
 * Requires an open WebSocket connection. Falls back to HTTP if wsFallback is enabled.
 */
export class WsTransport implements Transport {
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private requestId = 0;
  private httpFallback: HttpTransport | null;

  constructor(
    private getWs: () => WebSocket | null,
    private defaultTimeout: number,
    wsFallback: boolean,
    apiUrl: string,
    apiKey: string,
  ) {
    this.httpFallback = wsFallback ? new HttpTransport(apiUrl, apiKey, defaultTimeout) : null;
  }

  get isOpen(): boolean {
    const ws = this.getWs();
    return ws?.readyState === 1;
  }

  /**
   * Handle an incoming WebSocket message. Called by the GopherHole class when a
   * message arrives on the WebSocket. Returns true if the message was a JSON-RPC
   * response that was consumed, false otherwise.
   */
  handleMessage(data: Record<string, unknown>): boolean {
    if (data.jsonrpc === '2.0' && data.id != null && (data.result !== undefined || data.error !== undefined)) {
      const pending = this.pendingRequests.get(data.id as number);
      if (pending) {
        this.pendingRequests.delete(data.id as number);
        clearTimeout(pending.timer);
        if (data.error) {
          pending.reject(new Error((data.error as { message: string }).message || 'RPC error'));
        } else {
          pending.resolve(data.result);
        }
        return true;
      }
    }
    return false;
  }

  async request<T>(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    const ws = this.getWs();
    if (!ws || ws.readyState !== 1) {
      if (this.httpFallback) {
        return this.httpFallback.request<T>(method, params, timeoutMs);
      }
      throw new Error('WebSocket not connected. Call connect() first or enable wsFallback.');
    }

    const timeout = timeoutMs ?? this.defaultTimeout;
    const id = ++this.requestId;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      }));
    });
  }

  /** Clean up pending requests on disconnect */
  cleanup(): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('WebSocket disconnected'));
    }
    this.pendingRequests.clear();
  }
}

/**
 * Auto Transport — uses HTTP for RPC requests (same as current SDK behaviour).
 * This is the default transport that preserves backwards compatibility.
 */
export class AutoTransport implements Transport {
  private http: HttpTransport;

  constructor(apiUrl: string, apiKey: string, defaultTimeout: number) {
    this.http = new HttpTransport(apiUrl, apiKey, defaultTimeout);
  }

  get isOpen(): boolean {
    return true; // HTTP is always available
  }

  async request<T>(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    return this.http.request<T>(method, params, timeoutMs);
  }
}
