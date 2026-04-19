/**
 * Gateway WebSocket Client
 * Sends messages to the Clawdbot gateway via its WebSocket protocol
 * 
 * chat.send is non-blocking - it returns a runId immediately and
 * streams the response via chat events. We accumulate deltas and
 * resolve when we get state: "final".
 */

import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface PendingChat {
  resolve: (result: { text: string }) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  latestText: string;  // Each delta is the full message so far, not incremental
}

let ws: WebSocket | null = null;
let pendingRequests: Map<string, PendingRequest> = new Map();
let pendingChats: Map<string, PendingChat> = new Map(); // keyed by runId
let connected = false;
let handshakeComplete = false;

function getGatewayToken(): string | null {
  // Try the current OpenClaw config location first, then the legacy
  // Clawdbot path as a fallback for users still on older installs.
  const candidates = [
    join(homedir(), '.openclaw', 'openclaw.json'),
    join(homedir(), '.clawdbot', 'clawdbot.json'),
  ];
  for (const configPath of candidates) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      const token = config?.gateway?.auth?.token;
      if (token) return token;
    } catch {
      // file missing or unparseable — try next
    }
  }
  return null;
}

export async function connectToGateway(port = 18789): Promise<void> {
  if (ws && connected && handshakeComplete) return;

  const token = getGatewayToken();

  return new Promise((resolve, reject) => {
    ws = new WebSocket(`ws://127.0.0.1:${port}`);

    const timeout = setTimeout(() => {
      ws?.terminate();
      reject(new Error('Gateway connection timeout'));
    }, 10000);

    ws.on('open', () => {
      console.log('[a2a] Connected to gateway WebSocket, sending handshake...');
      connected = true;
      
      // Send connect handshake
      const connectId = uuidv4();
      
      const connectFrame = {
        type: 'req',
        id: connectId,
        method: 'connect',
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: 'gateway-client',
            displayName: 'A2A Channel Plugin',
            version: '0.3.4',
            platform: process.platform,
            mode: 'backend',
          },
          caps: [],
          auth: token ? { token } : undefined,
          role: 'operator',
          scopes: ['operator.admin'],
        },
      };
      
      pendingRequests.set(connectId, {
        resolve: () => {
          clearTimeout(timeout);
          handshakeComplete = true;
          console.log('[a2a] Gateway handshake complete');
          resolve();
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
        timeout: setTimeout(() => {
          pendingRequests.delete(connectId);
          reject(new Error('Gateway handshake timeout'));
        }, 5000),
      });
      
      ws!.send(JSON.stringify(connectFrame));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        // Log all non-tick messages for debugging
        if (msg.type !== 'tick') {
          console.log(`[a2a] Gateway msg: type=${msg.type}, event=${msg.event ?? 'n/a'}, id=${msg.id ?? 'n/a'}`);
        }
        
        // Handle response frames (for RPC calls)
        if (msg.type === 'res' && msg.id && pendingRequests.has(msg.id)) {
          const pending = pendingRequests.get(msg.id)!;
          clearTimeout(pending.timeout);
          pendingRequests.delete(msg.id);
          
          if (msg.error) {
            pending.reject(new Error(msg.error.message || 'RPC error'));
          } else {
            // Protocol uses 'payload' not 'result'
            pending.resolve(msg.payload);
          }
          return;
        }
        
        // Handle chat events (streaming responses)
        if (msg.type === 'event' && msg.event === 'chat') {
          handleChatEvent(msg.payload);
          return;
        }
        
        // Handle tick frames (keepalive)
        if (msg.type === 'tick') {
          // Could respond with tick ack if needed
        }
      } catch (err) {
        console.error('[a2a] Failed to parse gateway message:', err);
      }
    });

    ws.on('close', () => {
      connected = false;
      handshakeComplete = false;
      ws = null;
      console.log('[a2a] Disconnected from gateway WebSocket');
      
      // Reject all pending chats
      for (const [runId, pending] of pendingChats) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Gateway connection closed'));
      }
      pendingChats.clear();
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      console.error('[a2a] Gateway WebSocket error:', err.message);
      reject(err);
    });
  });
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    // Content blocks array: [{ type: 'text', text: '...' }, ...]
    return content
      .filter((block: unknown) => 
        typeof block === 'object' && block !== null && 
        (block as Record<string, unknown>).type === 'text'
      )
      .map((block: unknown) => (block as { text?: string }).text ?? '')
      .join('');
  }
  if (typeof content === 'object' && content !== null) {
    // Single content block or unknown structure
    const obj = content as Record<string, unknown>;
    if (obj.text && typeof obj.text === 'string') {
      return obj.text;
    }
  }
  return '';
}

function handleChatEvent(payload: {
  runId: string;
  sessionKey: string;
  seq: number;
  state: 'delta' | 'final' | 'aborted' | 'error';
  message?: { role?: string; content?: unknown };
  errorMessage?: string;
}): void {
  const pending = pendingChats.get(payload.runId);
  if (!pending) {
    // Not a chat we're tracking
    return;
  }

  // Detailed logging for debugging relay issues
  console.log(`[a2a] Chat event: runId=${payload.runId}, state=${payload.state}, seq=${payload.seq}, role=${payload.message?.role}`);
  
  if (payload.state === 'delta' || payload.state === 'final') {
    console.log(`[a2a] Chat content (${payload.state}): ${JSON.stringify(payload.message?.content)?.slice(0, 300)}`);
  }

  if (payload.state === 'delta') {
    // Each delta contains the full message so far, not incremental
    if (payload.message?.role === 'assistant' && payload.message?.content) {
      const text = extractTextContent(payload.message.content);
      if (text) {
        pending.latestText = text;
        console.log(`[a2a] Updated latestText (delta): "${text.slice(0, 100)}..." (len=${text.length})`);
      }
    } else {
      console.log(`[a2a] Skipping delta - role=${payload.message?.role}, hasContent=${!!payload.message?.content}`);
    }
  } else if (payload.state === 'final') {
    // Final message - resolve with latest text
    clearTimeout(pending.timeout);
    pendingChats.delete(payload.runId);
    
    // Use final content if available, otherwise use latest delta
    if (payload.message?.role === 'assistant' && payload.message?.content) {
      const text = extractTextContent(payload.message.content);
      if (text) {
        pending.latestText = text;
        console.log(`[a2a] Updated latestText (final): "${text.slice(0, 100)}..." (len=${text.length})`);
      }
    }
    
    console.log(`[a2a] Chat complete - resolving with: "${pending.latestText.slice(0, 150)}..." (total ${pending.latestText.length} chars)`);
    pending.resolve({ text: pending.latestText });
  } else if (payload.state === 'error' || payload.state === 'aborted') {
    clearTimeout(pending.timeout);
    pendingChats.delete(payload.runId);
    console.error(`[a2a] Chat ${payload.state}: ${payload.errorMessage}`);
    pending.reject(new Error(payload.errorMessage || `Chat ${payload.state}`));
  }
}

export async function callGateway(method: string, params: Record<string, unknown>, timeoutMs = 300000): Promise<unknown> {
  if (!ws || !connected || !handshakeComplete) {
    await connectToGateway();
  }

  const id = uuidv4();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('Gateway request timeout'));
    }, timeoutMs);

    pendingRequests.set(id, { resolve, reject, timeout });

    const frame = {
      type: 'req',
      id,
      method,
      params,
    };
    
    ws!.send(JSON.stringify(frame));
  });
}

/**
 * Send a chat message and wait for the full response.
 * chat.send is non-blocking - returns runId immediately, response streams via events.
 */
export async function sendChatMessage(
  sessionKey: string, 
  message: string,
  timeoutMs = 300000
): Promise<{ text: string }> {
  if (!ws || !connected || !handshakeComplete) {
    await connectToGateway();
  }

  const idempotencyKey = uuidv4();

  // First, send the chat.send request
  console.log(`[a2a] Sending chat.send: sessionKey=${sessionKey}, idempotencyKey=${idempotencyKey}`);
  
  const result = await callGateway('chat.send', {
    sessionKey,
    message,
    idempotencyKey,
  }) as { runId: string; status: string } | undefined;

  console.log(`[a2a] chat.send raw result:`, JSON.stringify(result));

  if (!result.runId) {
    throw new Error('chat.send did not return a runId');
  }

  // Now wait for chat events to complete
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingChats.delete(result.runId);
      reject(new Error('Chat response timeout'));
    }, timeoutMs);

    pendingChats.set(result.runId, {
      resolve,
      reject,
      timeout,
      latestText: '',
    });
  });
}

export function disconnectFromGateway(): void {
  if (ws) {
    ws.close();
    ws = null;
    connected = false;
    handshakeComplete = false;
  }
  pendingChats.clear();
  pendingRequests.clear();
}
