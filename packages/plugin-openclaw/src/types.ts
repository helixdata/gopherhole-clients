/**
 * A2A Protocol Types
 * Compatible with @gopherhole/sdk
 */

export interface A2AMessage {
  type: 'message' | 'response' | 'chunk' | 'status';
  taskId: string;
  contextId?: string;
  from?: string;
  content?: {
    parts: Array<{ kind: string; text?: string; data?: unknown; mimeType?: string }>;
  };
  status?: 'working' | 'completed' | 'failed' | 'canceled';
  error?: string;
}

export interface A2ASkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface A2AAgentCard {
  name: string;
  description?: string;
  url?: string;
  version?: string;
  skills?: A2ASkill[];
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
  bridgeUrl?: string;      // Legacy: direct bridge URL (ws://...)
  agents?: Array<{         // Legacy: direct agent connections
    id: string;
    url: string;
    name?: string;
  }>;
  gopherhole?: {           // GopherHole Agent Hub connection
    enabled?: boolean;
    apiKey: string;
    hubUrl?: string;       // Default: wss://gopherhole.ai/ws
    requestTimeoutMs?: number;
    agentCard?: A2AAgentCard;  // Custom agent card (overrides defaults)
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
