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

/**
 * A2A Channel Config (flat structure)
 * 
 * Example:
 * {
 *   "channels": {
 *     "a2a": {
 *       "enabled": true,
 *       "bridgeUrl": "wss://hub.gopherhole.ai/ws",
 *       "apiKey": "gph_your_api_key"
 *     }
 *   }
 * }
 */
export interface A2AChannelConfig {
  enabled?: boolean;
  bridgeUrl?: string;           // WebSocket URL (default: wss://hub.gopherhole.ai/ws)
  apiKey?: string;              // GopherHole API key (gph_...)
  agentId?: string;             // Our agent ID (default: "openclaw")
  agentName?: string;           // Display name for agent card
  agentCard?: A2AAgentCard;     // Custom agent card (overrides defaults)
  reconnectIntervalMs?: number; // Reconnect delay (default: 5000)
  requestTimeoutMs?: number;    // Request timeout (default: 180000)
}

export interface ResolvedA2AAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  agentId: string;
  bridgeUrl: string | null;
  config: A2AChannelConfig;
}
