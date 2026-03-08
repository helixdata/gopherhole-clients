# OpenClaw A2A Plugin - Response Relay Fix Guide

## Problem
When Agent A sends to Agent B via GopherHole, Agent B can receive and process the message, but the response doesn't get relayed back. Agent A sees their original message echoed instead of the actual response.

## Root Cause Analysis

### 1. TaskId Flow Issue
The `taskId` is critical for routing responses back. If it's missing or invalid:
- `connection.ts` generates a fake `gph-<timestamp>` ID
- `respond()` sends to this fake task
- GopherHole ignores it (task doesn't exist)
- `waitForTask` falls back to history, returning the original request

### 2. Agent ID Mismatch
GopherHole validates that responses come from the correct agent:
```sql
SELECT context_id FROM tasks WHERE id = ? AND server_agent_id = ?
```
If the agent's connected ID doesn't match `server_agent_id`, the response is silently dropped.

## Debugging Steps

### Step 1: Add Logging to connection.ts

In `handleIncomingMessage()`:
```typescript
private handleIncomingMessage(message: Message): void {
  console.log(`[a2a] RAW incoming message:`, JSON.stringify(message, null, 2));
  
  if (!this.messageHandler) return;

  console.log(`[a2a] Received message from ${message.from}, taskId=${message.taskId}`);
  // ... rest of handler
}
```

In `sendResponseViaGopherHole()`:
```typescript
sendResponseViaGopherHole(
  _targetAgentId: string,
  taskId: string,
  text: string,
  _contextId?: string
): void {
  console.log(`[a2a] Attempting respond - taskId=${taskId}, connected=${this.connected}, text=${text.slice(0, 100)}`);
  
  if (!taskId || taskId.startsWith('gph-')) {
    console.error(`[a2a] WARNING: Invalid taskId "${taskId}" - response will be lost!`);
  }
  // ... rest of method
}
```

### Step 2: Verify Agent ID Configuration

Check your config:
```yaml
channels:
  a2a:
    enabled: true
    agentId: "agent-XXXXXXXX"  # Must match your GopherHole agent ID
    apiKey: "gph_..."
```

The `agentId` here should match exactly what's in your GopherHole dashboard.

### Step 3: Check SDK Message Event

In the SDK (`@gopherhole/sdk`), the message handler should receive taskId:
```typescript
this.emit('message', {
  from: data.from,
  taskId: data.taskId,  // Must be present!
  payload: data.payload,
  timestamp: data.timestamp || Date.now(),
});
```

If `data.taskId` is undefined in the raw WebSocket message from GopherHole, that's a server-side bug.

## The Fix

### Option A: Ensure taskId is propagated (SDK/Server fix)

The GopherHole hub's `deliverMessage` should always include taskId:
```typescript
conn.ws.send(JSON.stringify({
  type: 'message',
  from: message.from,
  taskId: message.taskId,  // This must be present
  payload: message.payload,
}));
```

### Option B: Plugin resilience (Client-side workaround)

If taskId isn't available, the plugin could store a mapping:
```typescript
// In handleIncomingMessage:
const taskId = message.taskId || `pending-${message.from}-${Date.now()}`;
if (!message.taskId) {
  // Store for later - need server-side support for this
  console.warn('[a2a] No taskId in message - response routing may fail');
}
```

## Testing

1. Send a simple message to your agent via GopherHole
2. Check logs for:
   - `[a2a] RAW incoming message:` - does it have taskId?
   - `[a2a] Attempting respond - taskId=` - is taskId valid?
3. If taskId is missing/invalid, the issue is upstream (SDK or GopherHole server)

## Quick Checklist

- [ ] Agent ID in config matches GopherHole dashboard
- [ ] API key is valid and has correct permissions
- [ ] WebSocket connection is established (check for "Connected to GopherHole Hub via SDK" log)
- [ ] Incoming messages have valid taskId (not undefined or gph-*)
- [ ] Agent's `respond()` is actually being called after processing
