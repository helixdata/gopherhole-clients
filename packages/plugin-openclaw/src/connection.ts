/**
 * A2A Connection Manager
 * Handles WebSocket connections to other agents and the bridge
 */

import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type {
  A2AMessage,
  A2APendingRequest,
  A2AResponse,
  A2AChannelConfig,
} from './types.js';

// Use ws module's WebSocket type directly
interface A2AConnection {
  id: string;
  name: string;
  url: string;
  ws: WebSocket | null;
  connected: boolean;
  lastPingAt?: number;
  reconnectAttempts: number;
}

export type MessageHandler = (agentId: string, message: A2AMessage) => Promise<void>;

export class A2AConnectionManager {
  private connections: Map<string, A2AConnection> = new Map();
  private pendingRequests: Map<string, A2APendingRequest> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private messageHandler: MessageHandler | null = null;
  private config: A2AChannelConfig;
  private agentId: string;

  constructor(config: A2AChannelConfig) {
    this.config = config;
    this.agentId = config.agentId ?? 'clawdbot';
  }

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    // Connect to direct agents
    if (this.config.agents) {
      for (const agent of this.config.agents) {
        await this.connectToAgent(agent.id, agent.url, agent.name);
      }
    }

    // Connect to bridge if configured
    if (this.config.bridgeUrl) {
      await this.connectToAgent('bridge', this.config.bridgeUrl, 'A2A Bridge');
    }

    // Connect to GopherHole if configured
    if (this.config.gopherhole?.enabled && this.config.gopherhole?.apiKey) {
      await this.connectToGopherHole();
    }
  }

  private async connectToGopherHole(): Promise<void> {
    const gphConfig = this.config.gopherhole!;
    const hubUrl = gphConfig.hubUrl || 'wss://gopherhole.helixdata.workers.dev/ws';
    
    const conn: A2AConnection = {
      id: 'gopherhole',
      name: 'GopherHole Hub',
      url: hubUrl,
      ws: null,
      connected: false,
      reconnectAttempts: 0,
    };

    try {
      await this.establishGopherHoleConnection(conn, gphConfig.apiKey);
      this.connections.set('gopherhole', conn);
      console.log(`[a2a] Connected to GopherHole Hub`);
    } catch (err) {
      console.error(`[a2a] Failed to connect to GopherHole:`, (err as Error).message);
      this.connections.set('gopherhole', conn);
      this.scheduleReconnect('gopherhole');
    }
  }

  private async establishGopherHoleConnection(conn: A2AConnection, apiKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(conn.url);

      const timeout = setTimeout(() => {
        ws.terminate();
        reject(new Error('GopherHole connection timeout'));
      }, 10000);

      ws.on('open', () => {
        console.log('[a2a] GopherHole connected, authenticating...');
        ws.send(JSON.stringify({ type: 'auth', token: apiKey }));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          
          if (msg.type === 'auth_ok' || msg.type === 'welcome') {
            clearTimeout(timeout);
            conn.ws = ws;
            conn.connected = true;
            conn.reconnectAttempts = 0;
            conn.lastPingAt = Date.now();
            console.log(`[a2a] GopherHole authenticated as ${msg.agentId}`);
            resolve();
          } else if (msg.type === 'auth_error') {
            clearTimeout(timeout);
            reject(new Error(msg.error || 'GopherHole auth failed'));
          } else if (msg.type === 'message') {
            // Incoming message from another agent via GopherHole
            console.log(`[a2a] Received GopherHole message: taskId=${msg.taskId}, from=${msg.from}`);
            const a2aMsg: A2AMessage = {
              type: 'message',
              taskId: msg.taskId || `gph-${Date.now()}`,
              from: msg.from,
              content: msg.payload,
            };
            this.handleMessage('gopherhole', a2aMsg);
          } else if (msg.jsonrpc === '2.0' && msg.result) {
            // JSON-RPC response - task status (may be immediate success/failure)
            const requestId = msg.id;
            const taskId = msg.result?.id;
            const state = msg.result?.status?.state;
            console.log(`[a2a] GopherHole JSON-RPC response: requestId=${requestId}, taskId=${taskId}, state=${state}`);
            
            // Handle terminal states immediately (use requestId - that's what we stored)
            if (state === 'completed' || state === 'failed') {
              this.resolveGopherHoleTask(requestId, msg.result);
              return;
            }
            
            // For 'working'/'submitted', map taskId for future task_update events
            if (taskId && requestId && taskId !== requestId) {
              const pending = this.pendingRequests.get(requestId);
              if (pending) {
                this.pendingRequests.set(taskId, pending);
                this.pendingRequests.delete(requestId);
                console.log(`[a2a] Mapped taskId ${taskId} from requestId ${requestId}`);
              }
            }
          } else if (msg.jsonrpc === '2.0' && msg.error) {
            // JSON-RPC error response
            const requestId = msg.id;
            console.log(`[a2a] GopherHole JSON-RPC error: id=${requestId}, error=${msg.error?.message}`);
            
            const pending = this.pendingRequests.get(requestId);
            if (pending) {
              clearTimeout(pending.timeout);
              this.pendingRequests.delete(requestId);
              pending.reject(new Error(msg.error?.message || 'RPC error'));
            }
          } else if (msg.type === 'task_update') {
            // Task update event - nested under msg.task
            const task = msg.task || msg;
            const taskId = task.id || task.taskId;
            const state = task.status?.state;
            console.log(`[a2a] GopherHole task_update: taskId=${taskId}, state=${state}`);
            
            if (state === 'completed' || state === 'failed') {
              this.resolveGopherHoleTask(taskId, task);
            }
          } else if (msg.type === 'error') {
            // Error response (e.g., AGENT_NOT_FOUND)
            const taskId = msg.taskId;
            console.log(`[a2a] GopherHole error: code=${msg.code}, message=${msg.message}, taskId=${taskId}`);
            
            if (taskId) {
              const pending = this.pendingRequests.get(taskId);
              if (pending) {
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(taskId);
                pending.reject(new Error(msg.message || msg.code || 'Unknown error'));
              }
            }
          } else {
            // Unhandled message type - log for debugging
            console.log(`[a2a] Unhandled GopherHole message: ${JSON.stringify(msg).slice(0, 500)}`);
          }
        } catch (err) {
          console.error(`[a2a] Failed to parse GopherHole message:`, err);
        }
      });

      ws.on('close', (code, reason) => {
        conn.connected = false;
        conn.ws = null;
        console.log(`[a2a] Disconnected from GopherHole: ${code} ${reason?.toString()}`);
        this.scheduleReconnect('gopherhole');
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        console.error(`[a2a] GopherHole WebSocket error:`, err.message);
        if (!conn.connected) {
          reject(err);
        }
      });
    });
  }

  async stop(): Promise<void> {
    // Clear all reconnect timers
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    // Clear pending requests
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closing'));
    }
    this.pendingRequests.clear();

    // Close all connections
    for (const conn of this.connections.values()) {
      if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.close(1000, 'Shutting down');
      }
    }
    this.connections.clear();
  }

  private async connectToAgent(id: string, url: string, name?: string): Promise<void> {
    const conn: A2AConnection = {
      id,
      name: name ?? id,
      url,
      ws: null,
      connected: false,
      reconnectAttempts: 0,
    };

    try {
      await this.establishConnection(conn);
      this.connections.set(id, conn);
      console.log(`[a2a] Connected to agent: ${conn.name} (${id})`);
    } catch (err) {
      console.error(`[a2a] Failed to connect to ${id}:`, (err as Error).message);
      this.connections.set(id, conn);
      this.scheduleReconnect(id);
    }
  }

  private async establishConnection(conn: A2AConnection): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(conn.url);

      const timeout = setTimeout(() => {
        ws.terminate();
        reject(new Error('Connection timeout'));
      }, 10000);

      ws.on('open', () => {
        clearTimeout(timeout);
        conn.ws = ws;
        conn.connected = true;
        conn.reconnectAttempts = 0;
        conn.lastPingAt = Date.now();

        // Send agent card announcement
        this.sendAgentAnnounce(conn);
        resolve();
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString()) as A2AMessage;
          this.handleMessage(conn.id, message);
        } catch (err) {
          console.error(`[a2a] Failed to parse message from ${conn.id}:`, err);
        }
      });

      ws.on('close', (code, reason) => {
        conn.connected = false;
        conn.ws = null;
        console.log(`[a2a] Disconnected from ${conn.id}: ${code} ${reason?.toString()}`);
        this.scheduleReconnect(conn.id);
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        console.error(`[a2a] WebSocket error for ${conn.id}:`, err.message);
        reject(err);
      });

      ws.on('ping', () => {
        conn.lastPingAt = Date.now();
        ws.pong();
      });
    });
  }

  private sendAgentAnnounce(conn: A2AConnection): void {
    if (!conn.ws || !conn.connected) return;

    // Announce ourselves to the agent/bridge
    const announce = {
      type: 'announce',
      agent: {
        id: this.agentId,
        name: this.config.agentName ?? 'Clawdbot',
        description: 'Clawdbot AI assistant',
        skills: ['chat', 'tasks', 'tools'],
      },
    };
    conn.ws.send(JSON.stringify(announce));
  }

  private scheduleReconnect(agentId: string): void {
    if (this.reconnectTimers.has(agentId)) return;

    const conn = this.connections.get(agentId);
    if (!conn) return;

    // Exponential backoff: 5s, 10s, 20s, 40s, max 60s
    const baseDelay = this.config.reconnectIntervalMs ?? 5000;
    const delay = Math.min(baseDelay * Math.pow(2, conn.reconnectAttempts), 60000);
    conn.reconnectAttempts++;

    console.log(`[a2a] Scheduling reconnect to ${agentId} in ${delay}ms`);

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(agentId);
      if (!conn.connected) {
        try {
          // Use GopherHole auth flow for gopherhole connection
          if (agentId === 'gopherhole' && this.config.gopherhole?.apiKey) {
            await this.establishGopherHoleConnection(conn, this.config.gopherhole.apiKey);
          } else {
            await this.establishConnection(conn);
          }
          console.log(`[a2a] Reconnected to ${agentId}`);
        } catch {
          this.scheduleReconnect(agentId);
        }
      }
    }, delay);

    this.reconnectTimers.set(agentId, timer);
  }

  private handleMessage(agentId: string, message: A2AMessage): void {
    // Handle responses to our requests
    if (message.type === 'response' || message.status === 'completed' || message.status === 'failed') {
      const pending = this.pendingRequests.get(message.taskId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.taskId);

        if (message.status === 'failed' || message.error) {
          pending.reject(new Error(message.error ?? 'Task failed'));
        } else {
          const text = message.content?.parts
            ?.filter((p) => p.kind === 'text')
            .map((p) => p.text)
            .join('\n') ?? '';
          pending.resolve({
            text,
            status: message.status ?? 'completed',
            from: message.from,
          });
        }
        return;
      }
    }

    // Route to message handler for incoming messages
    if (this.messageHandler) {
      this.messageHandler(agentId, message).catch((err) => {
        console.error(`[a2a] Error handling message from ${agentId}:`, err);
      });
    }
  }

  /**
   * Resolve a GopherHole task response - extract text from artifacts
   */
  private resolveGopherHoleTask(taskId: string, taskData: Record<string, unknown>): void {
    const pending = this.pendingRequests.get(taskId);
    if (!pending) {
      console.log(`[a2a] No pending request for taskId ${taskId}`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(taskId);

    const status = taskData.status as { state?: string; message?: string } | undefined;
    
    if (status?.state === 'failed') {
      pending.reject(new Error(status.message ?? 'Task failed'));
      return;
    }

    // Extract text from artifacts (GopherHole puts responses in artifacts, not history!)
    let text = '';
    const artifacts = taskData.artifacts as Array<{
      artifactId?: string;
      parts?: Array<{ kind: string; text?: string }>;
    }> | undefined;

    if (artifacts?.length) {
      // Get text from all artifacts
      text = artifacts
        .flatMap((artifact) => artifact.parts ?? [])
        .filter((part) => part.kind === 'text' && part.text)
        .map((part) => part.text!)
        .join('\n');
    }

    console.log(`[a2a] Resolved task ${taskId}: ${text.slice(0, 100)}...`);
    pending.resolve({
      text,
      status: (status?.state as string) ?? 'completed',
      from: 'gopherhole',
    });
  }

  /**
   * Send a message to another agent and wait for response
   */
  async sendMessage(
    agentId: string,
    text: string,
    contextId?: string
  ): Promise<A2AResponse> {
    const conn = this.connections.get(agentId);
    if (!conn) {
      throw new Error(`Agent ${agentId} not found`);
    }
    if (!conn.connected || !conn.ws) {
      throw new Error(`Agent ${agentId} not connected`);
    }

    const taskId = uuidv4();
    const timeoutMs = this.config.requestTimeoutMs ?? 60000; // 60s default

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(taskId);
        reject(new Error(`Request timeout after ${timeoutMs / 1000}s - agent may be offline`));
      }, timeoutMs);

      this.pendingRequests.set(taskId, {
        taskId,
        resolve,
        reject,
        timeout,
        startedAt: Date.now(),
      });

      const msg: A2AMessage = {
        type: 'message',
        taskId,
        contextId,
        from: this.agentId,
        content: {
          parts: [{ kind: 'text', text }],
        },
      };

      conn.ws!.send(JSON.stringify(msg));
    });
  }

  /**
   * Send a response to an incoming message
   */
  sendResponse(agentId: string, taskId: string, text: string, contextId?: string): void {
    const conn = this.connections.get(agentId);
    if (!conn?.ws || !conn.connected) {
      console.warn(`[a2a] Cannot send response - ${agentId} not connected`);
      return;
    }

    const response: A2AMessage = {
      type: 'response',
      taskId,
      contextId,
      from: this.agentId,
      content: {
        parts: [{ kind: 'text', text }],
      },
      status: 'completed',
    };

    conn.ws.send(JSON.stringify(response));
  }

  /**
   * Send a response to an agent via GopherHole (for replying to incoming messages)
   */
  sendResponseViaGopherHole(
    targetAgentId: string,
    taskId: string,
    text: string,
    contextId?: string
  ): void {
    const gphConn = this.connections.get('gopherhole');
    if (!gphConn?.connected || !gphConn.ws) {
      console.warn(`[a2a] Cannot send GopherHole response - not connected`);
      return;
    }

    // GopherHole task_response format (completes the original task)
    const msg = {
      type: 'task_response',
      taskId,
      to: targetAgentId,
      status: { state: 'completed' },
      artifact: {
        artifactId: `response-${Date.now()}`,
        mimeType: 'text/plain',
        parts: [{ kind: 'text', text }],
      },
      lastChunk: true,
    };

    console.log(`[a2a] Sending response to ${targetAgentId} via GopherHole: taskId=${taskId}, msg=${JSON.stringify(msg)}`);
    gphConn.ws.send(JSON.stringify(msg));
  }

  /**
   * Send a message to a remote agent via GopherHole
   * Note: targetAgentId must be the actual agent ID (e.g., "agent-70153299")
   */
  async sendViaGopherHole(
    targetAgentId: string,
    text: string,
    contextId?: string
  ): Promise<A2AResponse> {
    const gphConn = this.connections.get('gopherhole');
    if (!gphConn?.connected || !gphConn.ws) {
      throw new Error('GopherHole not connected');
    }

    const taskId = uuidv4();
    const timeoutMs = this.config.requestTimeoutMs ?? 60000; // 60s default

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(taskId);
        reject(new Error(`GopherHole request timeout after ${timeoutMs / 1000}s - target agent may be offline`));
      }, timeoutMs);

      this.pendingRequests.set(taskId, {
        taskId,
        resolve,
        reject,
        timeout,
        startedAt: Date.now(),
      });

      // GopherHole WebSocket message format
      const msg = {
        type: 'message',
        id: taskId,
        to: targetAgentId,
        payload: {
          parts: [{ kind: 'text', text }],
          ...(contextId ? { contextId } : {}),
        },
      };

      console.log(`[a2a] Sending to ${targetAgentId} via GopherHole: taskId=${taskId}`);
      gphConn.ws!.send(JSON.stringify(msg));
    });
  }

  /**
   * Check if GopherHole is connected
   */
  isGopherHoleConnected(): boolean {
    return this.connections.get('gopherhole')?.connected ?? false;
  }

  /**
   * List connected agents
   */
  listAgents(): Array<{ id: string; name: string; connected: boolean }> {
    return Array.from(this.connections.values()).map((c) => ({
      id: c.id,
      name: c.name,
      connected: c.connected,
    }));
  }

  /**
   * Check if an agent is connected
   */
  isConnected(agentId: string): boolean {
    const conn = this.connections.get(agentId);
    return conn?.connected ?? false;
  }
}
