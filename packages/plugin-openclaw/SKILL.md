# A2A Channel Plugin

Enables Clawdbot to communicate with other AI agents via the A2A (Agent-to-Agent) protocol.

## Overview

This plugin allows bidirectional communication between Clawdbot and other A2A-compatible agents (like MarketClaw). Messages flow both ways:
- **Outbound:** Clawdbot can send messages to connected agents
- **Inbound:** Other agents can send messages to Clawdbot, which routes them through the normal reply pipeline

## Configuration

Add to your Clawdbot config:

```yaml
channels:
  a2a:
    enabled: true
    agentId: nova              # Our identifier (default: clawdbot)
    agentName: Nova            # Display name
    bridgeUrl: ws://localhost:8080/a2a   # A2A bridge/hub (optional)
    agents:                    # Direct agent connections (optional)
      - id: marketclaw
        url: ws://localhost:7891/a2a
        name: MarketClaw
    auth:
      token: secret-token      # Auth token (optional)
    reconnectIntervalMs: 5000  # Reconnect delay (default: 5000)
    requestTimeoutMs: 300000   # Request timeout (default: 5 min)
```

## Protocol

Messages follow this format (compatible with MarketClaw's A2A implementation):

```typescript
interface A2AMessage {
  type: 'message' | 'response' | 'chunk' | 'status';
  taskId: string;        // UUID for request/response matching
  contextId?: string;    // Optional conversation thread
  from?: string;         // Sender agent ID
  content?: {
    parts: [{ kind: 'text', text: string }]
  };
  status?: 'working' | 'completed' | 'failed' | 'canceled';
  error?: string;
}
```

## Tool: a2a_agents

The plugin registers an `a2a_agents` tool for interacting with connected agents:

```typescript
// List connected agents
{ action: 'list' }
// Returns: { agents: [{ id, name, connected }] }

// Send message to agent
{ action: 'send', agentId: 'marketclaw', message: 'What stocks are trending?' }
// Returns: { success: true, response: { text, status, from } }
```

## Files

- `index.ts` - Plugin entry point, registers channel + tool
- `src/channel.ts` - Channel plugin implementation
- `src/connection.ts` - WebSocket connection manager
- `src/types.ts` - TypeScript interfaces

## Building

```bash
cd ~/clawd/extensions/a2a
npm install
npm run build
```

## Notes

- WebSocket connections auto-reconnect with exponential backoff
- Each message gets a unique `taskId` for request/response correlation
- `contextId` can be used to maintain conversation threads
- The plugin announces itself to connected agents on connect
