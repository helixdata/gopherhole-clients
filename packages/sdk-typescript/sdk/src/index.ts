import { EventEmitter } from 'eventemitter3';

// Re-export types
export * from './types';

// Re-export agent helper for webhook-based agents
export { 
  GopherHoleAgent,
  GopherHoleAgentOptions,
  IncomingMessage,
  AgentMessagePart,
  AgentTaskResult,
  AgentTaskStatus,
  AgentArtifact,
  MessageContext,
  MessageHandler,
} from './agent';

// Convenience type aliases
export type { AgentTaskResult as TaskResult } from './agent';

export interface GopherHoleOptions {
  /** API key (starts with gph_) */
  apiKey: string;
  /** Hub URL (defaults to production) */
  hubUrl?: string;
  /** Agent card to register on connect */
  agentCard?: AgentCardConfig;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
  /** Max reconnect attempts */
  maxReconnectAttempts?: number;
  /** Default request timeout in ms (default: 30000) */
  requestTimeout?: number;
  /** Default message response timeout in ms (default: 30000) */
  messageTimeout?: number;
}

/** Agent card configuration for registration */
export interface AgentCardConfig {
  name: string;
  description?: string;
  url?: string;
  version?: string;
  skills?: AgentSkillConfig[];
}

/** Skill configuration */
export interface AgentSkillConfig {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface Message {
  from: string;
  taskId?: string;
  payload: MessagePayload;
  timestamp: number;
}

export interface MessagePayload {
  role: 'user' | 'agent';
  parts: MessagePart[];
}

export interface MessagePart {
  kind: 'text' | 'file' | 'data';
  text?: string;
  mimeType?: string;
  data?: string;
  uri?: string;
}

export interface Task {
  id: string;
  contextId: string;
  status: TaskStatus;
  history?: MessagePayload[];
  artifacts?: Artifact[];
}

export interface TaskStatus {
  state: 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled' | 'rejected';
  timestamp: string;
  message?: string;
}

export interface Artifact {
  name?: string;
  artifactId?: string;
  mimeType?: string;
  parts?: MessagePart[];
  data?: string;
  uri?: string;
}

/**
 * Extract text response from a completed task.
 * Checks artifacts first (where responses live), then falls back to history.
 */
export function getTaskResponseText(task: Task): string {
  // Check artifacts first (this is where responses from other agents appear)
  if (task.artifacts?.length) {
    const texts: string[] = [];
    for (const artifact of task.artifacts) {
      if (artifact.parts) {
        for (const part of artifact.parts) {
          if (part.kind === 'text' && part.text) {
            texts.push(part.text);
          }
        }
      }
    }
    if (texts.length > 0) {
      return texts.join('\n');
    }
  }

  // Fall back to history (last message)
  if (task.history?.length) {
    const lastMessage = task.history[task.history.length - 1];
    if (lastMessage.parts) {
      const texts: string[] = [];
      for (const part of lastMessage.parts) {
        if (part.kind === 'text' && part.text) {
          texts.push(part.text);
        }
      }
      if (texts.length > 0) {
        return texts.join('\n');
      }
    }
  }

  return '';
}

export interface SendOptions {
  /** Existing context/conversation ID */
  contextId?: string;
  /** Push notification URL */
  pushNotificationUrl?: string;
  /** History length to include */
  historyLength?: number;
  /** Request timeout in ms (overrides default) */
  timeoutMs?: number;
}

export interface SendAndWaitOptions extends SendOptions {
  /** Polling interval in ms (default: 1000) */
  pollIntervalMs?: number;
  /** Max wait time in ms (default: 300000 = 5 min) */
  maxWaitMs?: number;
}

type EventMap = {
  connect: () => void;
  disconnect: (reason: string) => void;
  error: (error: Error) => void;
  message: (message: Message) => void;
  taskUpdate: (task: Task) => void;
};

const DEFAULT_HUB_URL = 'wss://gopherhole.helixdata.workers.dev/ws';
const DEFAULT_API_URL = 'https://gopherhole.helixdata.workers.dev';

export class GopherHole extends EventEmitter<EventMap> {
  private apiKey: string;
  private hubUrl: string;
  private apiUrl: string;
  private ws: WebSocket | null = null;
  private autoReconnect: boolean;
  private reconnectDelay: number;
  private maxReconnectAttempts: number;
  private requestTimeout: number;
  private messageTimeout: number;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private agentId: string | null = null;
  private agentCard: AgentCardConfig | null = null;

  constructor(apiKeyOrOptions: string | GopherHoleOptions) {
    super();

    const options = typeof apiKeyOrOptions === 'string'
      ? { apiKey: apiKeyOrOptions }
      : apiKeyOrOptions;

    this.apiKey = options.apiKey;
    this.hubUrl = options.hubUrl || DEFAULT_HUB_URL;
    this.apiUrl = this.hubUrl.replace('/ws', '').replace('wss://', 'https://').replace('ws://', 'http://');
    this.agentCard = options.agentCard || null;
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectDelay = options.reconnectDelay ?? 1000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.requestTimeout = options.requestTimeout ?? 30000;
    this.messageTimeout = options.messageTimeout ?? 30000;
  }
  
  /**
   * Get the configured message timeout
   */
  getMessageTimeout(): number {
    return this.messageTimeout;
  }
  
  /**
   * Update agent card (sends to hub if connected)
   */
  async updateCard(card: AgentCardConfig): Promise<void> {
    this.agentCard = card;
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'update_card', agentCard: card }));
    }
  }

  /**
   * Connect to the GopherHole hub via WebSocket
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Browser or Node WebSocket
      const WS = typeof WebSocket !== 'undefined' ? WebSocket : require('ws');
      
      const ws = new WS(this.hubUrl, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      }) as WebSocket;
      
      this.ws = ws;
      
      ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.startPing();
        this.emit('connect');
        resolve();
      };

      ws.onclose = (event: CloseEvent) => {
        this.stopPing();
        const reason = event.reason || 'Connection closed';
        this.emit('disconnect', reason);
        
        if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };

      ws.onerror = () => {
        const error = new Error('WebSocket error');
        this.emit('error', error);
        reject(error);
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data.toString());
          this.handleMessage(data);
        } catch {
          this.emit('error', new Error('Failed to parse message'));
        }
      };
    });
  }

  /**
   * Disconnect from the hub
   */
  disconnect(): void {
    this.autoReconnect = false;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Send a message to another agent
   */
  async send(toAgentId: string, payload: MessagePayload, options?: SendOptions): Promise<Task> {
    const { timeoutMs, ...config } = options || {};
    const response = await this.rpc('message/send', {
      message: payload,
      configuration: {
        agentId: toAgentId,
        ...config,
      },
    }, timeoutMs);

    return response as Task;
  }

  /**
   * Send a text message to another agent
   */
  async sendText(toAgentId: string, text: string, options?: SendOptions): Promise<Task> {
    return this.send(toAgentId, {
      role: 'agent',
      parts: [{ kind: 'text', text }],
    }, options);
  }

  /**
   * Send a text message and wait for completion
   * Returns the completed task with response artifacts
   */
  async sendTextAndWait(toAgentId: string, text: string, options?: SendAndWaitOptions): Promise<Task> {
    const task = await this.sendText(toAgentId, text, options);
    return this.waitForTask(task.id, options);
  }

  /**
   * Send a text message and wait for the text response
   * This is a convenience method that extracts the response text automatically
   */
  async askText(toAgentId: string, text: string, options?: SendAndWaitOptions): Promise<string> {
    const task = await this.sendTextAndWait(toAgentId, text, options);
    if (task.status.state === 'failed') {
      throw new Error(task.status.message || 'Task failed');
    }
    return getTaskResponseText(task);
  }

  /**
   * Wait for a task to complete (polling)
   */
  async waitForTask(taskId: string, options?: SendAndWaitOptions): Promise<Task> {
    const pollInterval = options?.pollIntervalMs ?? 1000;
    const maxWait = options?.maxWaitMs ?? 300000; // 5 min default
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const task = await this.getTask(taskId);
      
      if (task.status.state === 'completed' || task.status.state === 'failed' || 
          task.status.state === 'canceled' || task.status.state === 'rejected') {
        return task;
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Task ${taskId} did not complete within ${maxWait}ms`);
  }

  /**
   * Get a task by ID
   */
  async getTask(taskId: string, historyLength?: number): Promise<Task> {
    const response = await this.rpc('tasks/get', {
      id: taskId,
      historyLength,
    });
    return response as Task;
  }

  /**
   * List tasks
   */
  async listTasks(options?: {
    contextId?: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<{ tasks: Task[]; nextPageToken?: string; totalSize: number }> {
    const response = await this.rpc('tasks/list', options || {});
    return response as { tasks: Task[]; nextPageToken?: string; totalSize: number };
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<Task> {
    const response = await this.rpc('tasks/cancel', { id: taskId });
    return response as Task;
  }

  /**
   * Respond to an incoming task via WebSocket (completes the task)
   * Use this when you receive a 'message' event and want to send back a response
   * that completes the original task.
   */
  respond(taskId: string, text: string, options?: { status?: 'completed' | 'failed'; message?: string }): void {
    if (!this.ws || this.ws.readyState !== 1) {
      throw new Error('WebSocket not connected');
    }

    const response = {
      type: 'task_response',
      taskId,
      status: { 
        state: options?.status ?? 'completed',
        message: options?.message,
      },
      artifact: {
        artifactId: `response-${Date.now()}`,
        mimeType: 'text/plain',
        parts: [{ kind: 'text', text }],
      },
      lastChunk: true,
    };

    this.ws.send(JSON.stringify(response));
  }

  /**
   * Respond with a failure to an incoming task
   */
  respondError(taskId: string, errorMessage: string): void {
    this.respond(taskId, errorMessage, { status: 'failed', message: errorMessage });
  }

  /**
   * Reply to a message/task (sends back to the original caller)
   * Note: This creates a NEW task via HTTP. For completing an existing task,
   * use respond() instead.
   */
  async reply(taskId: string, payload: MessagePayload, toAgentId?: string): Promise<Task> {
    // If toAgentId not provided, we need to figure out who to reply to
    // For now, require the caller to provide it or pass through the task context
    if (!toAgentId) {
      // Get task to use same context
      const task = await this.getTask(taskId);
      // Note: The task doesn't expose client_agent_id via API, so we send to context
      // The server should route based on contextId
      const response = await this.rpc('message/send', {
        message: payload,
        configuration: {
          contextId: task.contextId,
          // Server needs to handle replies via context routing
        },
      });
      return response as Task;
    }
    
    const response = await this.rpc('message/send', {
      message: payload,
      configuration: {
        agentId: toAgentId,
      },
    });

    return response as Task;
  }

  /**
   * Reply with text (creates new task)
   * Note: For completing an existing task, use respond() instead.
   */
  async replyText(taskId: string, text: string): Promise<Task> {
    return this.reply(taskId, {
      role: 'agent',
      parts: [{ kind: 'text', text }],
    });
  }

  /**
   * Make a JSON-RPC call to the A2A endpoint
   */
  private async rpc(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    const timeout = timeoutMs ?? this.requestTimeout;
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

      return data.result;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: any): void {
    if (data.type === 'message') {
      this.emit('message', {
        from: data.from,
        taskId: data.taskId,
        payload: data.payload,
        timestamp: data.timestamp || Date.now(),
      });
    } else if (data.type === 'task_update') {
      this.emit('taskUpdate', data.task);
    } else if (data.type === 'pong') {
      // Heartbeat response
    } else if (data.type === 'welcome') {
      this.agentId = data.agentId;
      // Send agent card if configured
      if (this.agentCard && this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({ type: 'update_card', agentCard: this.agentCard }));
      }
    } else if (data.type === 'card_updated') {
      // Agent card was successfully updated
    } else if (data.type === 'warning') {
      console.warn('GopherHole warning:', data.message);
    }
  }

  /**
   * Start ping interval
   */
  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === 1) { // OPEN
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000); // 15s ping to keep connection alive
  }

  /**
   * Stop ping interval
   */
  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Schedule reconnection
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        // Will retry via onclose handler
      }
    }, delay);
  }

  /**
   * Get connection state
   */
  get connected(): boolean {
    return this.ws?.readyState === 1;
  }

  /**
   * Get the agent ID (available after connect)
   */
  get id(): string | null {
    return this.agentId;
  }

  // ============================================================
  // DISCOVERY METHODS
  // ============================================================

  /**
   * Discover public agents with comprehensive search
   */
  async discover(options?: DiscoverOptions): Promise<DiscoverResult> {
    const params = new URLSearchParams();
    
    if (options?.query) params.set('q', options.query);
    if (options?.category) params.set('category', options.category);
    if (options?.tag) params.set('tag', options.tag);
    if (options?.skillTag) params.set('skillTag', options.skillTag);
    if (options?.contentMode) params.set('contentMode', options.contentMode);
    if (options?.sort) params.set('sort', options.sort);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    if (options?.scope) params.set('scope', options.scope);
    
    // Include API key to see same-tenant agents (not just public)
    const response = await fetch(`${this.apiUrl}/api/discover/agents?${params}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });
    return response.json();
  }

  /**
   * Discover all agents in your tenant (no limit)
   */
  async discoverTenantAgents(): Promise<DiscoverResult> {
    return this.discover({ scope: 'tenant' });
  }

  /**
   * Search agents with fuzzy matching on description
   */
  async searchAgents(query: string, options?: Omit<DiscoverOptions, 'query'>): Promise<DiscoverResult> {
    return this.discover({ ...options, query });
  }

  /**
   * Find agents by category
   */
  async findByCategory(category: string, options?: Omit<DiscoverOptions, 'category'>): Promise<DiscoverResult> {
    return this.discover({ ...options, category });
  }

  /**
   * Find agents by tag
   */
  async findByTag(tag: string, options?: Omit<DiscoverOptions, 'tag'>): Promise<DiscoverResult> {
    return this.discover({ ...options, tag });
  }

  /**
   * Find agents by skill tag (searches within agent skills)
   */
  async findBySkillTag(skillTag: string, options?: Omit<DiscoverOptions, 'skillTag'>): Promise<DiscoverResult> {
    return this.discover({ ...options, skillTag });
  }

  /**
   * Find agents that support a specific input/output mode
   */
  async findByContentMode(mode: string, options?: Omit<DiscoverOptions, 'contentMode'>): Promise<DiscoverResult> {
    return this.discover({ ...options, contentMode: mode });
  }

  /**
   * Get top-rated agents
   */
  async getTopRated(limit = 10): Promise<DiscoverResult> {
    return this.discover({ sort: 'rating', limit });
  }

  /**
   * Get most popular agents (by usage)
   */
  async getPopular(limit = 10): Promise<DiscoverResult> {
    return this.discover({ sort: 'popular', limit });
  }

  /**
   * Get featured/curated agents
   */
  async getFeatured(): Promise<{ featured: PublicAgent[] }> {
    const response = await fetch(`${this.apiUrl}/api/discover/featured`);
    return response.json();
  }

  /**
   * Get available categories
   */
  async getCategories(): Promise<{ categories: AgentCategory[] }> {
    const response = await fetch(`${this.apiUrl}/api/discover/categories`);
    return response.json();
  }

  /**
   * Get detailed info about a public agent
   */
  async getAgentInfo(agentId: string): Promise<AgentInfoResult> {
    const response = await fetch(`${this.apiUrl}/api/discover/agents/${agentId}`);
    if (!response.ok) {
      throw new Error('Agent not found');
    }
    return response.json();
  }

  /**
   * Rate an agent (requires authentication)
   */
  async rateAgent(agentId: string, rating: number, review?: string): Promise<RatingResult> {
    const response = await fetch(`${this.apiUrl}/api/discover/agents/${agentId}/rate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ rating, review }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to rate agent');
    }
    return response.json();
  }

  /**
   * Get best agent for a task using smart matching
   * Searches by query and returns the top-rated match
   */
  async findBestAgent(query: string, options?: {
    category?: string;
    minRating?: number;
    pricing?: 'free' | 'paid' | 'any';
  }): Promise<PublicAgent | null> {
    const result = await this.discover({
      query,
      category: options?.category,
      sort: 'rating',
      limit: 10,
    });
    
    const agents = result.agents.filter(agent => {
      if (options?.minRating && agent.avgRating < options.minRating) return false;
      if (options?.pricing === 'free' && agent.pricing !== 'free') return false;
      if (options?.pricing === 'paid' && agent.pricing === 'free') return false;
      return true;
    });
    
    return agents[0] || null;
  }

  /**
   * Find agents similar to a given agent
   */
  async findSimilar(agentId: string, limit = 5): Promise<DiscoverResult> {
    // Get the agent's info first
    const info = await this.getAgentInfo(agentId);
    const agent = info.agent;
    
    // Search by category and tags
    if (agent.category) {
      const result = await this.discover({
        category: agent.category,
        sort: 'rating',
        limit: limit + 1, // +1 to exclude self
      });
      
      // Filter out the original agent
      result.agents = result.agents.filter(a => a.id !== agentId).slice(0, limit);
      return result;
    }
    
    // Fallback to top rated
    return this.getTopRated(limit);
  }
}

// ============================================================
// DISCOVERY TYPES
// ============================================================

export interface DiscoverOptions {
  /** Search query (fuzzy matches name, description, tags) */
  query?: string;
  /** Filter by category */
  category?: string;
  /** Filter by tag */
  tag?: string;
  /** Filter by skill tag (searches within agent skills) */
  skillTag?: string;
  /** Filter by content mode (MIME type, e.g., 'text/markdown', 'image/png') */
  contentMode?: string;
  /** Sort order */
  sort?: 'rating' | 'popular' | 'recent';
  /** Max results (default 20, max 100; ignored when scope=tenant) */
  limit?: number;
  /** Pagination offset */
  offset?: number;
  /** Scope: 'tenant' returns only same-tenant agents with no limit */
  scope?: 'tenant';
}

export interface DiscoverResult {
  agents: PublicAgent[];
  count: number;
  offset: number;
}

export interface PublicAgent {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  tags: string[];
  pricing: 'free' | 'paid' | 'contact';
  avgRating: number;
  ratingCount: number;
  tenantName: string;
  websiteUrl: string | null;
  docsUrl: string | null;
}

export interface AgentCategory {
  name: string;
  count: number;
}

export interface AgentInfoResult {
  agent: PublicAgent & {
    agentCard: {
      name: string;
      description?: string;
      skills?: AgentSkill[];
    } | null;
    stats: {
      avgRating: number;
      ratingCount: number;
      totalMessages: number;
      successRate: number;
      avgResponseTime: number;
    };
  };
  reviews: AgentReview[];
}

/** Full A2A skill schema */
export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface AgentReview {
  rating: number;
  review: string;
  created_at: number;
  reviewer_name: string;
}

export interface RatingResult {
  success: boolean;
  avgRating: number;
  ratingCount: number;
}

// Default export
export default GopherHole;
