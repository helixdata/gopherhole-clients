/**
 * GopherHoleAgent - Helper for building webhook-based A2A agents
 * 
 * Use this to create agents that receive requests from the GopherHole hub
 * via webhooks (e.g., Cloudflare Workers, Express servers).
 */

import type { AgentCard, AgentSkill } from './types';

// Re-export types for convenience
export type { AgentCard, AgentSkill };

// ============================================================
// TYPES
// ============================================================

export interface IncomingMessage {
  role: 'user' | 'agent';
  parts: AgentMessagePart[];
  metadata?: Record<string, unknown>;
}

export interface AgentMessagePart {
  kind: 'text' | 'file' | 'data';
  text?: string;
  mimeType?: string;
  data?: string;
  uri?: string;
}

export interface AgentTaskResult {
  id: string;
  contextId: string;
  status: AgentTaskStatus;
  messages: IncomingMessage[];
  artifacts?: AgentArtifact[];
}

export interface AgentTaskStatus {
  state: 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled';
  timestamp: string;
  message?: string;
}

export interface AgentArtifact {
  name?: string;
  mimeType?: string;
  parts?: AgentMessagePart[];
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id?: string | number;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id?: string | number | null;
}

// ============================================================
// MESSAGE HANDLER TYPE
// ============================================================

export interface MessageContext {
  /** The incoming message */
  message: IncomingMessage;
  /** Extracted text content from message parts */
  text: string;
  /** Task ID if provided */
  taskId?: string;
  /** Context ID if provided */
  contextId?: string;
  /** Full params from JSON-RPC request */
  params: Record<string, unknown>;
}

export type MessageHandler = (ctx: MessageContext) => Promise<string | AgentTaskResult> | string | AgentTaskResult;

// ============================================================
// AGENT CLASS
// ============================================================

export interface GopherHoleAgentOptions {
  /** Agent card for discovery */
  card: AgentCard;
  /** API key for authentication (from GopherHole hub) */
  apiKey?: string;
  /** Handler for incoming messages */
  onMessage: MessageHandler;
}

export class GopherHoleAgent {
  private card: AgentCard;
  private apiKey?: string;
  private onMessage: MessageHandler;

  constructor(options: GopherHoleAgentOptions) {
    this.card = options.card;
    this.apiKey = options.apiKey;
    this.onMessage = options.onMessage;
  }

  /** Get the agent card */
  getCard(): AgentCard {
    return this.card;
  }

  /** Verify authorization header */
  verifyAuth(authHeader: string | null): boolean {
    if (!this.apiKey) return true; // No auth configured
    return authHeader === `Bearer ${this.apiKey}`;
  }

  /**
   * Handle an incoming HTTP request
   * Returns a Response object (works with Cloudflare Workers, Bun, etc.)
   */
  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Agent card endpoints
    if (url.pathname === '/.well-known/agent.json' || url.pathname === '/agent.json') {
      return Response.json(this.card, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === '/health') {
      return Response.json(
        { status: 'ok', agent: this.card.name, version: this.card.version || '1.0.0' },
        { headers: corsHeaders }
      );
    }

    // JSON-RPC endpoint
    if (request.method === 'POST' && (url.pathname === '/' || url.pathname === '/a2a')) {
      // Verify auth
      if (this.apiKey && !this.verifyAuth(request.headers.get('Authorization'))) {
        return Response.json(
          { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null },
          { status: 401, headers: corsHeaders }
        );
      }

      try {
        const body = await request.json() as JsonRpcRequest;
        const response = await this.handleJsonRpc(body);
        return Response.json(response, { headers: corsHeaders });
      } catch {
        return Response.json(
          { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null },
          { status: 400, headers: corsHeaders }
        );
      }
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }

  /**
   * Handle a JSON-RPC request directly
   */
  async handleJsonRpc(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { method, params = {}, id } = req;

    switch (method) {
      case 'message/send':
        return this.handleMessageSend(params, id);

      case 'tasks/get':
        return {
          jsonrpc: '2.0',
          error: { code: -32601, message: 'This agent does not support persistent tasks' },
          id,
        };

      case 'tasks/cancel':
        return {
          jsonrpc: '2.0',
          error: { code: -32601, message: 'This agent does not support task cancellation' },
          id,
        };

      default:
        return {
          jsonrpc: '2.0',
          error: { code: -32601, message: `Method not found: ${method}` },
          id,
        };
    }
  }

  private async handleMessageSend(
    params: Record<string, unknown>,
    id?: string | number
  ): Promise<JsonRpcResponse> {
    const message = params.message as IncomingMessage | undefined;

    if (!message?.parts) {
      return {
        jsonrpc: '2.0',
        error: { code: -32602, message: 'Invalid params: message with parts required' },
        id,
      };
    }

    // Extract text from message parts
    const text = message.parts
      .filter(p => p.kind === 'text' || p.text)
      .map(p => p.text || '')
      .join('\n')
      .trim();

    const config = params.configuration as Record<string, unknown> | undefined;
    const ctx: MessageContext = {
      message,
      text,
      taskId: params.taskId as string | undefined,
      contextId: config?.contextId as string | undefined,
      params,
    };

    try {
      const result = await this.onMessage(ctx);
      
      // If handler returned a string, wrap it in a task result
      if (typeof result === 'string') {
        const taskResult = this.createTaskResult(message, result, ctx.contextId);
        return { jsonrpc: '2.0', result: taskResult, id };
      }

      return { jsonrpc: '2.0', result, id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Handler error';
      return {
        jsonrpc: '2.0',
        error: { code: -32000, message: errorMessage },
        id,
      };
    }
  }

  /**
   * Create a completed task result from a text response
   */
  createTaskResult(
    originalMessage: IncomingMessage,
    responseText: string,
    contextId?: string
  ): AgentTaskResult {
    return {
      id: `task-${Date.now()}`,
      contextId: contextId || `ctx-${Date.now()}`,
      status: {
        state: 'completed',
        timestamp: new Date().toISOString(),
      },
      messages: [
        originalMessage,
        {
          role: 'agent',
          parts: [{ kind: 'text', text: responseText }],
          metadata: { generatedAt: new Date().toISOString() },
        },
      ],
    };
  }

  /**
   * Helper to create a text message part
   */
  static textPart(text: string): AgentMessagePart {
    return { kind: 'text', text };
  }

  /**
   * Helper to create a file message part
   */
  static filePart(uri: string, mimeType: string): AgentMessagePart {
    return { kind: 'file', uri, mimeType };
  }

  /**
   * Helper to create a data message part (base64)
   */
  static dataPart(data: string, mimeType: string): AgentMessagePart {
    return { kind: 'data', data, mimeType };
  }
}

export default GopherHoleAgent;
