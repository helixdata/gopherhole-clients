/**
 * A2A Protocol Types
 * Compatible with MarketClaw's A2A implementation
 */

export interface A2AMessage {
  type: 'message' | 'response' | 'chunk' | 'status';
  taskId: string;
  contextId?: string;
  from?: string;
  content?: {
    parts: Array<{ kind: string; text?: string; data?: unknown }>;
  };
  status?: 'working' | 'completed' | 'failed' | 'canceled';
  error?: string;
}

export interface A2AAgentCard {
  id: string;
  name: string;
  description?: string;
  skills?: string[];
  url?: string;
}

// A2AConnection is defined locally in connection.ts to avoid WebSocket type issues

export interface A2APendingRequest {
  taskId: string;
  resolve: (response: A2AResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  startedAt: number;
}

export interface A2AResponse {
  text: string;
  status: string;
  from?: string;
}

export interface A2AChannelConfig {
  enabled?: boolean;
  agentId?: string;        // Our agent ID (default: "clawdbot")
  agentName?: string;      // Display name
  bridgeUrl?: string;      // A2A bridge/hub URL (ws://...)
  agents?: Array<{         // Direct agent connections
    id: string;
    url: string;
    name?: string;
  }>;
  gopherhole?: {           // GopherHole Agent Hub connection
    enabled?: boolean;
    apiKey: string;
    hubUrl?: string;       // Default: wss://gopherhole.helixdata.workers.dev/ws
  };
  auth?: {
    token?: string;
  };
  reconnectIntervalMs?: number;
  requestTimeoutMs?: number;
}

export interface ResolvedA2AAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  agentId: string;
  bridgeUrl: string | null;
  agents: Array<{ id: string; url: string; name?: string }>;
  config: A2AChannelConfig;
}
