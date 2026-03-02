/**
 * A2A Channel Plugin Entry Point
 * Enables Clawdbot to communicate with other AI agents via A2A protocol
 */

import { a2aPlugin, setA2ARuntime, getA2AConnectionManager } from './src/channel.js';
import { readFileSync } from 'fs';
import { basename, extname } from 'path';

// Minimal plugin interface
interface ClawdbotPluginApi {
  runtime: unknown;
  registerChannel(opts: { plugin: unknown }): void;
  registerTool?(opts: {
    name: string;
    description: string;
    parameters: unknown;
    execute: (id: string, params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
  }): void;
}

const plugin = {
  id: 'gopherhole_openclaw_a2a',
  name: 'A2A Protocol',
  description: 'Agent-to-Agent communication channel',
  configSchema: { type: 'object', additionalProperties: false, properties: {} },
  register(api: ClawdbotPluginApi) {
    setA2ARuntime(api.runtime);
    api.registerChannel({ plugin: a2aPlugin });

    // Register a tool for interacting with connected agents
    api.registerTool?.({
      name: 'a2a_agents',
      description: 'List connected A2A agents and send messages to them',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'send'],
            description: 'Action to perform',
          },
          agentId: {
            type: 'string',
            description: 'Target agent ID (for send action)',
          },
          message: {
            type: 'string',
            description: 'Text message to send (for send action)',
          },
          image: {
            type: 'string',
            description: 'Path to image file to send (for send action)',
          },
        },
        required: ['action'],
      },
      execute: async (_id, params) => {
        const action = params.action as string;
        const agentId = params.agentId as string | undefined;
        const message = params.message as string | undefined;
        const imagePath = params.image as string | undefined;
        
        const manager = getA2AConnectionManager();
        if (!manager) {
          return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: 'A2A channel not running' }) }] };
        }

        if (action === 'list') {
          const agents = manager.listAgents();
          return { content: [{ type: 'text', text: JSON.stringify({ status: 'ok', agents }) }] };
        }

        if (action === 'send') {
          if (!agentId || (!message && !imagePath)) {
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: 'agentId and (message or image) required for send action' }) }] };
          }
          try {
            const isGopherHoleConnected = manager.isGopherHoleConnected();
            const isDirectConnection = manager.isConnected(agentId) && agentId !== 'gopherhole';
            
            // Build parts array
            const parts: Array<{ kind: string; text?: string; data?: string; mimeType?: string }> = [];
            
            // Add text part if message provided
            if (message) {
              parts.push({ kind: 'text', text: message });
            }
            
            // Add image part if image path provided
            if (imagePath) {
              try {
                const imageData = readFileSync(imagePath);
                const base64Data = imageData.toString('base64');
                const ext = extname(imagePath).toLowerCase();
                const mimeTypes: Record<string, string> = {
                  '.png': 'image/png',
                  '.jpg': 'image/jpeg',
                  '.jpeg': 'image/jpeg',
                  '.gif': 'image/gif',
                  '.webp': 'image/webp',
                  '.svg': 'image/svg+xml',
                };
                const mimeType = mimeTypes[ext] || 'application/octet-stream';
                parts.push({ kind: 'data', data: base64Data, mimeType });
              } catch (imgErr) {
                return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: `Failed to read image: ${(imgErr as Error).message}` }) }] };
              }
            }
            
            let response;
            if (isDirectConnection) {
              // Direct WebSocket - only supports text for now
              if (message) {
                response = await manager.sendMessage(agentId, message);
              } else {
                return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: 'Direct connections only support text messages' }) }] };
              }
            } else if (isGopherHoleConnected) {
              // Route through GopherHole hub with multi-part support
              response = await manager.sendPartsViaGopherHole(agentId, parts);
            } else {
              return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: `Cannot reach agent ${agentId} - no direct connection or GopherHole` }) }] };
            }
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'ok', agentId, response }) }] };
          } catch (err) {
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: (err as Error).message }) }] };
          }
        }

        return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: `Unknown action: ${action}` }) }] };
      },
    });
  },
};

export default plugin;
export { getA2AConnectionManager };
