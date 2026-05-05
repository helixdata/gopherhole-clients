/**
 * GopherHole A2A HTTP Client
 * Implements A2A JSON-RPC over HTTP with SSE streaming support
 */

import { EventEmitter } from 'eventemitter3';

export interface A2AClientOptions {
  baseUrl?: string;
  apiKey: string;
}

export interface Message {
  role: 'user' | 'agent';
  parts: MessagePart[];
  messageId?: string;
}

export interface MessagePart {
  kind?: 'text' | 'data' | 'file';
  text?: string;
  data?: unknown;
  mediaType?: string;
  url?: string;
  filename?: string;
}

export interface TaskStatus {
  state: 'submitted' | 'working' | 'completed' | 'failed' | 'canceled' | 'input-required' | 'rejected' | 'auth-required';
  message?: Message;
  timestamp?: string;
}

export interface Task {
  id: string;
  contextId: string;
  status: TaskStatus;
  history?: Message[];
  artifacts?: Artifact[];
  metadata?: Record<string, unknown>;
}

export interface Artifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: MessagePart[];
  metadata?: Record<string, unknown>;
}

export interface TaskStatusUpdateEvent {
  taskId: string;
  contextId: string;
  status: TaskStatus;
  metadata?: Record<string, unknown>;
}

export interface TaskArtifactUpdateEvent {
  taskId: string;
  contextId: string;
  artifact: Artifact;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}

export interface StreamResponse {
  task?: Task;
  message?: Message;
  statusUpdate?: TaskStatusUpdateEvent;
  artifactUpdate?: TaskArtifactUpdateEvent;
}

export interface SendMessageConfig {
  agentId: string;
  contextId?: string;
  taskId?: string;
  historyLength?: number;
  blocking?: boolean;
}

export interface PushNotificationConfig {
  id?: string;
  url: string;
  token?: string;
  authentication?: {
    scheme: string;
    credentials?: string;
  };
}

// Discovery types (GopherHole extension)
export interface AvailableAgent {
  id: string;
  name: string;
  description?: string;
  tenantName: string;
  tenantSlug: string;
  verified: boolean;
  accessType: 'same-tenant' | 'granted' | 'public';
  autoApprove: boolean;
}

export interface DiscoveredAgent {
  id: string;
  name: string;
  description?: string;
  category?: string;
  tags: string[];
  pricing: string;
  tenantName: string;
  tenantSlug: string;
  verified: boolean;
  featured: boolean;
  avgRating: number;
  ratingCount: number;
  autoApprove: boolean;
  websiteUrl?: string;
  docsUrl?: string;
}

/**
 * A2A HTTP Client for GopherHole
 * Use this for request/response and polling-based interactions
 */
export class A2AClient {
  private baseUrl: string;
  private apiKey: string;
  private requestId = 0;

  constructor(options: A2AClientOptions) {
    this.baseUrl = options.baseUrl || 'https://hub.gopherhole.ai/a2a';
    this.apiKey = options.apiKey;
  }

  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'A2A-Version': '1.0',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id: ++this.requestId,
      }),
    });

    const data = await response.json() as { result?: T; error?: { code: number; message: string } };
    
    if (data.error) {
      throw new Error(`A2A Error ${data.error.code}: ${data.error.message}`);
    }
    
    return data.result as T;
  }

  /**
   * Send a message to an agent (non-streaming)
   * A2A Spec Section 3.1.1
   */
  async sendMessage(message: Message, config: SendMessageConfig): Promise<Task> {
    return this.rpc<Task>('SendMessage', {
      message,
      configuration: config,
    });
  }

  /**
   * Send a text message to an agent
   */
  async sendText(agentId: string, text: string, config?: Partial<SendMessageConfig>): Promise<Task> {
    return this.sendMessage(
      { role: 'user', parts: [{ kind: 'text', text }] },
      { agentId, ...config }
    );
  }

  /**
   * Get a task by ID
   * A2A Spec Section 3.1.3
   */
  async getTask(taskId: string, historyLength?: number): Promise<Task> {
    return this.rpc<Task>('GetTask', { id: taskId, historyLength });
  }

  /**
   * List tasks
   * A2A Spec Section 3.1.4
   */
  async listTasks(options?: {
    contextId?: string;
    status?: string;
    pageSize?: number;
    pageToken?: string;
    historyLength?: number;
    includeArtifacts?: boolean;
  }): Promise<{ tasks: Task[]; nextPageToken: string; totalSize: number }> {
    return this.rpc('ListTasks', options || {});
  }

  /**
   * Cancel a task
   * A2A Spec Section 3.1.5
   */
  async cancelTask(taskId: string): Promise<Task> {
    return this.rpc<Task>('CancelTask', { id: taskId });
  }

  /**
   * Create push notification config for a task
   * A2A Spec Section 3.1.7
   */
  async createPushConfig(taskId: string, config: PushNotificationConfig): Promise<PushNotificationConfig & { id: string }> {
    return this.rpc('CreateTaskPushNotificationConfig', { taskId, config });
  }

  /**
   * Get push notification config
   * A2A Spec Section 3.1.8
   */
  async getPushConfig(taskId: string, configId: string): Promise<PushNotificationConfig & { id: string }> {
    return this.rpc('GetTaskPushNotificationConfig', { taskId, id: configId });
  }

  /**
   * List push notification configs for a task
   * A2A Spec Section 3.1.9
   */
  async listPushConfigs(taskId: string, pageSize?: number, pageToken?: string): Promise<{ configs: PushNotificationConfig[]; nextPageToken: string }> {
    return this.rpc('ListTaskPushNotificationConfigs', { taskId, pageSize, pageToken });
  }

  /**
   * Delete push notification config
   * A2A Spec Section 3.1.10
   */
  async deletePushConfig(taskId: string, configId: string): Promise<{ success: boolean }> {
    return this.rpc('DeleteTaskPushNotificationConfig', { taskId, id: configId });
  }

  /**
   * Send a message with streaming (SSE)
   * Returns an EventEmitter that emits 'task', 'statusUpdate', 'artifactUpdate', 'error', 'end'
   * A2A Spec Section 3.1.2
   */
  streamMessage(message: Message, config: SendMessageConfig): TaskStream {
    return new TaskStream(this.baseUrl, this.apiKey, 'SendStreamingMessage', {
      message,
      configuration: config,
    });
  }

  /**
   * Stream text message
   */
  streamText(agentId: string, text: string, config?: Partial<SendMessageConfig>): TaskStream {
    return this.streamMessage(
      { role: 'user', parts: [{ kind: 'text', text }] },
      { agentId, ...config }
    );
  }

  /**
   * Subscribe to task updates (SSE)
   * A2A Spec Section 3.1.6
   */
  subscribeToTask(taskId: string): TaskStream {
    return new TaskStream(this.baseUrl, this.apiKey, 'SubscribeToTask', { id: taskId });
  }

  // ============================================================
  // DISCOVERY METHODS (GopherHole Extension)
  // ============================================================

  /**
   * List agents you have access to (same-tenant + granted)
   * Use query param to search public agents
   */
  async listAvailableAgents(options?: {
    query?: string;
    public?: boolean;
  }): Promise<{ agents: AvailableAgent[] }> {
    return this.rpc('x-gopherhole/agents.available', options || {});
  }

  /**
   * Discover public agents in the marketplace
   * Uses smart scoring: featured + verified + rating + recency - exposure
   */
  async discoverAgents(options?: {
    query?: string;
    category?: string;
    tag?: string;
    owner?: string;
    organization?: string; // Alias for owner (deprecated)
    verified?: boolean;
    country?: string; // ISO 3166-1 alpha-2 country code
    sort?: 'smart' | 'rating' | 'popular' | 'recent';
    limit?: number;
    offset?: number;
  }): Promise<{ agents: DiscoveredAgent[]; count: number; offset: number }> {
    // Normalize: prefer owner, fall back to organization
    const params = { ...options };
    if (params.organization && !params.owner) {
      params.owner = params.organization;
    }
    return this.rpc('x-gopherhole/agents.discover', params);
  }

  /**
   * Discover agents near a geographic location
   */
  async discoverNearby(options: {
    lat: number;
    lng: number;
    radius?: number; // km, default 10
    tag?: string;
    category?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ 
    agents: Array<DiscoveredAgent & { 
      location: { name: string; lat: number; lng: number; country: string };
      distance: number;
    }>; 
    center: { lat: number; lng: number };
    radius: number;
    count: number;
    offset: number;
  }> {
    return this.rpc('x-gopherhole/agents.discover.nearby', options);
  }

  /**
   * Request access to a private agent
   */
  async requestAccess(agentId: string, reason?: string): Promise<{ id: string; status: string; created_at: string }> {
    const apiUrl = this.baseUrl.replace('/a2a', '');
    const response = await fetch(`${apiUrl}/api/discover/agents/${agentId}/request-access`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(reason ? { reason } : {}),
    });
    if (!response.ok) {
      const data = await response.json() as { error?: string };
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return response.json() as Promise<{ id: string; status: string; created_at: string }>;
  }

  /**
   * Create client from environment variables
   */
  static fromEnv(options?: Partial<A2AClientOptions>): A2AClient {
    const apiKey = process.env.GOPHERHOLE_API_KEY;
    if (!apiKey) {
      throw new Error('GOPHERHOLE_API_KEY environment variable required');
    }
    return new A2AClient({
      apiKey,
      baseUrl: process.env.GOPHERHOLE_API_URL || options?.baseUrl,
    });
  }
}

/**
 * SSE Stream handler for task updates
 */
export class TaskStream extends EventEmitter {
  private abortController: AbortController;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private method: string,
    private params: Record<string, unknown>
  ) {
    super();
    this.abortController = new AbortController();
    this.start();
  }

  private async start(): Promise<void> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'text/event-stream',
          'A2A-Version': '1.0',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: this.method,
          params: this.params,
          id: Date.now(),
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      this.reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await this.reader.read();
        
        if (done) {
          this.emit('end');
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        // Parse SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6);
              const jsonRpc = JSON.parse(jsonStr);
              
              if (jsonRpc.error) {
                this.emit('error', new Error(`A2A Error: ${jsonRpc.error.message}`));
                continue;
              }

              const result = jsonRpc.result as StreamResponse;
              
              if (result.task) {
                this.emit('task', result.task);
              }
              if (result.message) {
                this.emit('message', result.message);
              }
              if (result.statusUpdate) {
                this.emit('statusUpdate', result.statusUpdate);
                // Also emit state-specific events
                this.emit(result.statusUpdate.status.state, result.statusUpdate);
              }
              if (result.artifactUpdate) {
                this.emit('artifactUpdate', result.artifactUpdate);
              }
            } catch (e) {
              this.emit('error', new Error(`Failed to parse SSE event: ${e}`));
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.emit('error', error);
      }
    }
  }

  /**
   * Close the stream
   */
  close(): void {
    this.abortController.abort();
    if (this.reader) {
      this.reader.cancel().catch(() => {});
    }
  }

  /**
   * Wait for the stream to complete
   */
  async wait(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.once('end', resolve);
      this.once('error', reject);
    });
  }

  /**
   * Collect all events until stream ends
   */
  async collect(): Promise<{
    task?: Task;
    statusUpdates: TaskStatusUpdateEvent[];
    artifactUpdates: TaskArtifactUpdateEvent[];
  }> {
    const result: {
      task?: Task;
      statusUpdates: TaskStatusUpdateEvent[];
      artifactUpdates: TaskArtifactUpdateEvent[];
    } = {
      statusUpdates: [],
      artifactUpdates: [],
    };

    return new Promise((resolve, reject) => {
      this.on('task', (task: Task) => {
        result.task = task;
      });
      this.on('statusUpdate', (event: TaskStatusUpdateEvent) => {
        result.statusUpdates.push(event);
      });
      this.on('artifactUpdate', (event: TaskArtifactUpdateEvent) => {
        result.artifactUpdates.push(event);
      });
      this.once('end', () => resolve(result));
      this.once('error', reject);
    });
  }
}

export default A2AClient;
