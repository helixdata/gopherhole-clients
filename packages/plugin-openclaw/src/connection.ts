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
    this.agentId = config.agentId ?? 'clawdbot';
  }

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    // Connect to GopherHole if configured
    if (this.config.gopherhole?.enabled && this.config.gopherhole?.apiKey) {
      await this.connectToGopherHole();
    }
  }

  private async connectToGopherHole(): Promise<void> {
    const gphConfig = this.config.gopherhole!;
    const hubUrl = gphConfig.hubUrl || 'wss://gopherhole.ai/ws';
    const timeoutMs = this.config.requestTimeoutMs ?? 180000;

    this.gopherhole = new GopherHole({
      apiKey: gphConfig.apiKey,
      hubUrl,
      autoReconnect: true,
      reconnectDelay: this.config.reconnectIntervalMs ?? 5000,
      maxReconnectAttempts: 20,
      requestTimeout: timeoutMs,
      messageTimeout: timeoutMs,
      agentCard: gphConfig.agentCard ?? {
        name: this.config.agentName ?? 'OpenClaw',
        description: 'Personal AI assistant with tools, web search, browser control, and various skills',
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

    this.gopherhole.on('error', (error) => {
      console.error('[a2a] GopherHole SDK error:', error.message);
    });

    this.gopherhole.on('message', (message: Message) => {
      this.handleIncomingMessage(message);
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

    this.messageHandler('gopherhole', a2aMsg).catch((err) => {
      console.error('[a2a] Error handling incoming message:', err);
    });
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
      console.warn('[a2a] Cannot send response - GopherHole not connected');
      return;
    }

    console.log(`[a2a] Responding to taskId=${taskId}: ${text.slice(0, 100)}...`);

    try {
      // Use SDK's respond method to complete the task
      this.gopherhole.respond(taskId, text);
    } catch (err) {
      console.error('[a2a] Failed to send response:', (err as Error).message);
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
   * List connected agents (just GopherHole for now)
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
