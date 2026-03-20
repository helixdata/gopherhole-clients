/**
 * A2A Connection Manager
 * Uses @gopherhole/sdk for GopherHole hub connectivity
 */

import { GopherHole, Message, getTaskResponseText } from '@gopherhole/sdk';
import { v4 as uuidv4 } from 'uuid';
import type {
  A2AMessage,
  A2AResponse,
  A2AChannelConfig,
} from './types.js';

export type MessageHandler = (agentId: string, message: A2AMessage) => Promise<void>;

export class A2AConnectionManager {
  private gopherhole: GopherHole | null = null;
  private messageHandler: MessageHandler | null = null;
  private config: A2AChannelConfig;
  private agentId: string;
  private connected = false;

  constructor(config: A2AChannelConfig) {
    this.config = config;
    this.agentId = config.agentId ?? 'openclaw';
  }

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    // Connect to GopherHole if configured (flat config: enabled + apiKey)
    if (this.config.enabled && this.config.apiKey) {
      await this.connectToGopherHole();
    }
  }

  private async connectToGopherHole(): Promise<void> {
    const hubUrl = this.config.bridgeUrl || 'wss://hub.gopherhole.ai/ws';
    const timeoutMs = this.config.requestTimeoutMs ?? 180000;

    this.gopherhole = new GopherHole({
      apiKey: this.config.apiKey!,
      hubUrl,
      autoReconnect: true,
      reconnectDelay: this.config.reconnectIntervalMs ?? 5000,
      maxReconnectDelay: 300000, // 5 min cap on backoff
      // maxReconnectAttempts defaults to 0 (infinite) in SDK
      requestTimeout: timeoutMs,
      messageTimeout: timeoutMs,
      agentCard: this.config.agentCard ?? {
        name: this.config.agentName ?? 'OpenClaw',
        description: 'Personal AI assistant with tools, web search, browser control, and various skills',
        version: '0.1.0',
        skills: [
          {
            id: 'chat',
            name: 'Chat',
            description: 'General conversation and Q&A',
            tags: ['conversation', 'assistant'],
            inputModes: ['text/plain'],
            outputModes: ['text/plain', 'text/markdown'],
          },
          {
            id: 'web-search',
            name: 'Web Search',
            description: 'Search the web and summarize results',
            tags: ['search', 'research', 'web'],
            inputModes: ['text/plain'],
            outputModes: ['text/plain', 'text/markdown'],
          },
          {
            id: 'coding',
            name: 'Coding',
            description: 'Write, review, and debug code',
            tags: ['code', 'programming', 'development'],
            inputModes: ['text/plain'],
            outputModes: ['text/plain', 'text/markdown'],
          },
          {
            id: 'files',
            name: 'File Operations',
            description: 'Read, write, and manage files',
            tags: ['files', 'documents'],
            inputModes: ['text/plain', 'application/pdf', 'image/*'],
            outputModes: ['text/plain', 'text/markdown'],
          },
        ],
      },
    });

    // Set up event handlers
    this.gopherhole.on('connect', () => {
      this.connected = true;
      console.log('[a2a] Connected to GopherHole Hub via SDK');
    });

    this.gopherhole.on('disconnect', (reason) => {
      this.connected = false;
      console.log(`[a2a] Disconnected from GopherHole: ${reason}`);
    });

    this.gopherhole.on('reconnecting', ({ attempt, delayMs }) => {
      console.log(`[a2a] Reconnecting to GopherHole (attempt ${attempt}, waiting ${delayMs}ms)...`);
    });

    this.gopherhole.on('error', (error) => {
      console.error('[a2a] GopherHole SDK error:', error.message);
    });

    this.gopherhole.on('message', (message: Message) => {
      this.handleIncomingMessage(message);
    });

    // Handle system messages (rate limits, budget alerts, announcements)
    this.gopherhole.on('system', (message) => {
      this.handleSystemMessage(message);
    });

    // Connect
    try {
      await this.gopherhole.connect();
      console.log(`[a2a] GopherHole SDK connected, agent ID: ${this.gopherhole.id}`);
    } catch (err) {
      console.error('[a2a] Failed to connect to GopherHole:', (err as Error).message);
      throw err;
    }
  }

  private handleIncomingMessage(message: Message): void {
    if (!this.messageHandler) return;

    console.log(`[a2a] Received message from ${message.from}, taskId=${message.taskId}`);
    console.log(`[a2a] Raw message payload:`, JSON.stringify(message.payload, null, 2).slice(0, 500));

    // Validate taskId - critical for response routing
    if (!message.taskId) {
      console.error(`[a2a] WARNING: No taskId in incoming message! Response relay will fail.`);
      console.error(`[a2a] Full message object:`, JSON.stringify(message, null, 2));
    }

    // Convert SDK message to our A2AMessage format
    const a2aMsg: A2AMessage = {
      type: 'message',
      taskId: message.taskId || `gph-${Date.now()}`,
      from: message.from,
      content: {
        parts: message.payload.parts.map(p => ({
          kind: p.kind,
          text: p.text,
          data: p.data,
          mimeType: p.mimeType,
        })),
      },
    };

    console.log(`[a2a] Dispatching to messageHandler with taskId=${a2aMsg.taskId}`);

    this.messageHandler('gopherhole', a2aMsg).catch((err) => {
      console.error('[a2a] Error handling incoming message:', err);
    });
  }

  /**
   * Handle system messages from GopherHole Hub
   * These include spending alerts, account alerts, notices, maintenance, etc.
   */
  private handleSystemMessage(message: Message): void {
    const kind = message.metadata?.kind;
    const text = message.payload.parts.find(p => p.kind === 'text')?.text || '';
    const data = message.metadata?.data;

    // Log all system messages
    console.log(`[a2a] System message (${kind || 'unknown'}): ${text}`);

    // Handle specific message kinds
    switch (kind) {
      case 'spending_alert':
        console.warn(`[a2a] 💰 Spending alert: ${text}`);
        if (data) {
          console.warn(`[a2a] Spending data:`, JSON.stringify(data));
        }
        break;

      case 'account_alert':
        console.warn(`[a2a] ⚠️ Account alert: ${text}`);
        break;

      case 'system_notice':
        console.log(`[a2a] 📢 System notice: ${text}`);
        break;

      case 'maintenance':
        console.warn(`[a2a] 🔧 Maintenance notice: ${text}`);
        break;

      default:
        // Log but don't warn for unknown types
        if (kind) {
          console.log(`[a2a] System message "${kind}": ${text}`);
        }
    }
  }

  async stop(): Promise<void> {
    if (this.gopherhole) {
      this.gopherhole.disconnect();
      this.gopherhole = null;
    }
    this.connected = false;
  }

  /**
   * Send a message to another agent via GopherHole and wait for response
   */
  async sendMessage(
    targetAgentId: string,
    text: string,
    _contextId?: string
  ): Promise<A2AResponse> {
    return this.sendPartsViaGopherHole(targetAgentId, [{ kind: 'text', text }]);
  }

  /**
   * Send a multi-part message via GopherHole hub
   * Supports text, images, and other MIME types
   */
  async sendPartsViaGopherHole(
    targetAgentId: string,
    parts: Array<{ kind: string; text?: string; data?: string; mimeType?: string }>,
    contextId?: string
  ): Promise<A2AResponse> {
    if (!this.gopherhole || !this.connected) {
      throw new Error('GopherHole not connected');
    }

    console.log(`[a2a] Sending to ${targetAgentId} via SDK, parts=${parts.length}`);

    try {
      // Use SDK's send method with polling for completion
      const task = await this.gopherhole.send(
        targetAgentId,
        {
          role: 'agent',
          parts: parts.map(p => ({
            kind: p.kind as 'text' | 'file' | 'data',
            text: p.text,
            data: p.data,
            mimeType: p.mimeType,
          })),
        },
        { contextId }
      );

      // Wait for task completion
      const completedTask = await this.gopherhole.waitForTask(task.id, {
        pollIntervalMs: 1000,
        maxWaitMs: this.config.requestTimeoutMs ?? 180000,
      });

      if (completedTask.status.state === 'failed') {
        throw new Error(completedTask.status.message ?? 'Task failed');
      }

      // Extract response text using SDK helper
      const responseText = getTaskResponseText(completedTask);

      console.log(`[a2a] Got response from ${targetAgentId}: ${responseText.slice(0, 100)}...`);

      return {
        text: responseText,
        status: completedTask.status.state,
        from: targetAgentId,
      };
    } catch (err) {
      console.error(`[a2a] Failed to send to ${targetAgentId}:`, (err as Error).message);
      throw err;
    }
  }

  /**
   * Send a response to an incoming message via GopherHole
   * Uses SDK's respond() method to complete the original task
   */
  sendResponseViaGopherHole(
    _targetAgentId: string,
    taskId: string,
    text: string,
    _contextId?: string
  ): void {
    if (!this.gopherhole || !this.connected) {
      console.error('[a2a] Cannot send response - GopherHole not connected');
      return;
    }

    // Validate taskId
    if (!taskId) {
      console.error('[a2a] Cannot respond - taskId is null/undefined!');
      return;
    }
    
    if (taskId.startsWith('gph-')) {
      console.error(`[a2a] Cannot respond - taskId "${taskId}" is a fallback ID (not a real task). Response will be lost!`);
      return;
    }

    console.log(`[a2a] Responding to taskId=${taskId}: "${text.slice(0, 200)}..." (total ${text.length} chars)`);

    try {
      // Use SDK's respond method to complete the task
      this.gopherhole.respond(taskId, text);
      console.log(`[a2a] respond() called successfully for taskId=${taskId}`);
    } catch (err) {
      console.error('[a2a] Failed to send response:', (err as Error).message);
      console.error('[a2a] Error details:', err);
    }
  }

  /**
   * Legacy alias for sendPartsViaGopherHole with text-only
   */
  async sendViaGopherHole(
    targetAgentId: string,
    text: string,
    contextId?: string
  ): Promise<A2AResponse> {
    return this.sendPartsViaGopherHole(targetAgentId, [{ kind: 'text', text }], contextId);
  }

  /**
   * Legacy sendResponse (routes to GopherHole)
   */
  sendResponse(agentId: string, taskId: string, text: string, contextId?: string): void {
    this.sendResponseViaGopherHole(agentId, taskId, text, contextId);
  }

  /**
   * Check if GopherHole is connected
   */
  isGopherHoleConnected(): boolean {
    return this.connected && this.gopherhole?.connected === true;
  }

  /**
   * List available agents from GopherHole
   * Fetches same-tenant agents + agents with approved access + public agents
   */
  async listAvailableAgents(): Promise<Array<{
    id: string;
    name: string;
    description?: string;
    accessType: 'same-tenant' | 'public' | 'granted';
  }>> {
    if (!this.config.apiKey) {
      return [];
    }

    const hubUrl = this.config.bridgeUrl || 'wss://hub.gopherhole.ai/ws';
    // Convert wss:// to https:// for API calls
    const apiBase = hubUrl.replace('wss://', 'https://').replace('/ws', '');

    try {
      const response = await fetch(`${apiBase}/api/agents/available`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`[a2a] Failed to fetch agents: ${response.status}`);
        return [];
      }

      const data = await response.json() as { agents: Array<{
        id: string;
        name: string;
        description?: string;
        access_type: string;
      }> };

      return data.agents.map(a => ({
        id: a.id,
        name: a.name,
        description: a.description,
        accessType: a.access_type as 'same-tenant' | 'public' | 'granted',
      }));
    } catch (err) {
      console.error('[a2a] Error fetching available agents:', (err as Error).message);
      return [];
    }
  }

  /**
   * List connection status (for backward compatibility)
   */
  listAgents(): Array<{ id: string; name: string; connected: boolean }> {
    const agents: Array<{ id: string; name: string; connected: boolean }> = [];
    
    if (this.gopherhole) {
      agents.push({
        id: 'gopherhole',
        name: 'GopherHole Hub',
        connected: this.connected,
      });
    }

    return agents;
  }

  /**
   * Check if an agent is connected
   */
  isConnected(agentId: string): boolean {
    if (agentId === 'gopherhole') {
      return this.isGopherHoleConnected();
    }
    return false;
  }

  /**
   * Get the underlying GopherHole SDK instance (for advanced usage)
   */
  getSDK(): GopherHole | null {
    return this.gopherhole;
  }
}
