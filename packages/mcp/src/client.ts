/**
 * GopherHole API Client
 * Lightweight HTTP client for the MCP server
 */

const DEFAULT_API_URL = 'https://gopherhole.ai';

export interface GopherHoleConfig {
  apiKey: string;
  apiUrl?: string;
  timeout?: number;
}

export interface Task {
  id: string;
  contextId: string;
  status: {
    state: 'submitted' | 'working' | 'completed' | 'failed' | 'canceled' | 'rejected';
    message?: string;
    timestamp?: string;
  };
  history?: Array<{
    role: 'user' | 'agent';
    parts: Array<{ kind: 'text' | 'file' | 'data'; text?: string }>;
  }>;
  artifacts?: Array<{
    name?: string;
    parts?: Array<{ kind: 'text' | 'file' | 'data'; text?: string }>;
  }>;
}

export interface DiscoverResult {
  agents: Array<{
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    tags: string[];
    pricing: 'free' | 'paid' | 'contact';
    avgRating: number;
    ratingCount: number;
    tenantName: string;
  }>;
  count: number;
}

export class GopherHoleClient {
  private apiKey: string;
  private apiUrl: string;
  private timeout: number;

  constructor(config: GopherHoleConfig) {
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl || DEFAULT_API_URL;
    this.timeout = config.timeout || 60000;
  }

  /**
   * Make an A2A JSON-RPC call
   */
  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

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

      const data = await response.json() as { result?: T; error?: { message: string } };

      if (data.error) {
        throw new Error(data.error.message || 'RPC error');
      }

      return data.result as T;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Send a text message to an agent
   */
  async sendText(agentId: string, text: string, contextId?: string): Promise<Task> {
    return this.rpc<Task>('message/send', {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text }],
      },
      configuration: {
        agentId,
        contextId,
      },
    });
  }

  /**
   * Get a task by ID
   */
  async getTask(taskId: string): Promise<Task> {
    return this.rpc<Task>('tasks/get', { id: taskId });
  }

  /**
   * Wait for a task to complete (polling)
   */
  async waitForTask(taskId: string, maxWaitMs = 60000, pollIntervalMs = 1000): Promise<Task> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const task = await this.getTask(taskId);
      
      if (['completed', 'failed', 'canceled', 'rejected'].includes(task.status.state)) {
        return task;
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Task ${taskId} did not complete within ${maxWaitMs}ms`);
  }

  /**
   * Send text and wait for completion
   */
  async sendTextAndWait(agentId: string, text: string, contextId?: string): Promise<Task> {
    const task = await this.sendText(agentId, text, contextId);
    return this.waitForTask(task.id);
  }

  /**
   * Send text and get the response text
   */
  async askText(agentId: string, text: string): Promise<string> {
    const task = await this.sendTextAndWait(agentId, text);
    
    if (task.status.state === 'failed') {
      throw new Error(task.status.message || 'Task failed');
    }

    return this.extractResponseText(task);
  }

  /**
   * Extract text response from a completed task
   */
  private extractResponseText(task: Task): string {
    // Check artifacts first
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

    // Fall back to history
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

  /**
   * Discover agents
   */
  async discover(options?: {
    query?: string;
    category?: string;
    tag?: string;
    limit?: number;
  }): Promise<DiscoverResult> {
    const params = new URLSearchParams();
    if (options?.query) params.set('q', options.query);
    if (options?.category) params.set('category', options.category);
    if (options?.tag) params.set('tag', options.tag);
    if (options?.limit) params.set('limit', String(options.limit));

    const response = await fetch(`${this.apiUrl}/api/discover/agents?${params}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Discovery failed: ${response.statusText}`);
    }

    return response.json() as Promise<DiscoverResult>;
  }

  /**
   * Create client from environment
   */
  static fromEnv(): GopherHoleClient {
    const apiKey = process.env.GOPHERHOLE_API_KEY;
    if (!apiKey) {
      throw new Error('GOPHERHOLE_API_KEY environment variable is required');
    }

    return new GopherHoleClient({
      apiKey,
      apiUrl: process.env.GOPHERHOLE_API_URL,
    });
  }

  // ============================================================
  // WORKSPACE METHODS
  // ============================================================

  /**
   * List workspaces this agent is a member of
   */
  async workspaceList(): Promise<{ workspaces: Workspace[] }> {
    return this.rpc('x-gopherhole/workspace.list', {});
  }

  /**
   * Create a new workspace
   */
  async workspaceCreate(name: string, description?: string): Promise<{ workspace: Workspace }> {
    return this.rpc('x-gopherhole/workspace.create', { name, description });
  }

  /**
   * Delete a workspace (must be owner)
   */
  async workspaceDelete(workspaceId: string): Promise<{ success: boolean }> {
    return this.rpc('x-gopherhole/workspace.delete', { workspace_id: workspaceId });
  }

  /**
   * Add an agent to a workspace
   */
  async workspaceMembersAdd(workspaceId: string, agentId: string, role: 'read' | 'write' | 'admin' = 'write'): Promise<{ success: boolean }> {
    return this.rpc('x-gopherhole/workspace.members.add', { workspace_id: workspaceId, agent_id: agentId, role });
  }

  /**
   * Remove an agent from a workspace
   */
  async workspaceMembersRemove(workspaceId: string, agentId: string): Promise<{ success: boolean }> {
    return this.rpc('x-gopherhole/workspace.members.remove', { workspace_id: workspaceId, agent_id: agentId });
  }

  /**
   * List workspace members
   */
  async workspaceMembersList(workspaceId: string): Promise<{ members: WorkspaceMember[] }> {
    return this.rpc('x-gopherhole/workspace.members.list', { workspace_id: workspaceId });
  }

  /**
   * Store a memory in a workspace
   */
  async workspaceStore(params: {
    workspace_id: string;
    content: string;
    type?: 'fact' | 'decision' | 'preference' | 'todo' | 'context' | 'reference';
    tags?: string[];
  }): Promise<{ memory: WorkspaceMemory }> {
    return this.rpc('x-gopherhole/workspace.store', {
      workspace_id: params.workspace_id,
      content: params.content,
      type: params.type || 'fact',
      tags: params.tags,
    });
  }

  /**
   * Query workspace memories with semantic search
   */
  async workspaceQuery(params: {
    workspace_id: string;
    query: string;
    type?: string;
    limit?: number;
    tags?: string[];
  }): Promise<{ memories: WorkspaceMemory[]; count: number }> {
    return this.rpc('x-gopherhole/workspace.query', params);
  }

  /**
   * List memories in a workspace (non-semantic)
   */
  async workspaceMemories(params: {
    workspace_id: string;
    limit?: number;
    offset?: number;
  }): Promise<{ memories: WorkspaceMemory[]; count: number; total: number }> {
    return this.rpc('x-gopherhole/workspace.memories', params);
  }

  /**
   * Delete memories from a workspace
   */
  async workspaceForget(params: {
    workspace_id: string;
    id?: string;
    query?: string;
  }): Promise<{ deleted: number }> {
    return this.rpc('x-gopherhole/workspace.forget', params);
  }
}

// Workspace types
export interface Workspace {
  id: string;
  owner_agent_id: string;
  name: string;
  description: string | null;
  created_at: number;
  updated_at: number;
  member_count?: number;
  memory_count?: number;
  my_role?: 'read' | 'write' | 'admin';
}

export interface WorkspaceMember {
  agent_id: string;
  agent_name?: string;
  role: 'read' | 'write' | 'admin';
  added_at: number;
}

export interface WorkspaceMemory {
  id: string;
  workspace_id: string;
  content: string;
  type: string;
  tags: string[];
  links: string[];
  similarity?: number;
  created_at: number;
  created_by: string | null;
  updated_at?: number;
}
