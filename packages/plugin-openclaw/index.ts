/**
 * A2A Channel Plugin Entry Point
 * Enables OpenClaw to communicate with other AI agents via A2A protocol
 */

import { a2aPlugin, setA2ARuntime, getA2AConnectionManager } from './src/channel.js';
import { readFileSync } from 'fs';
import { basename, extname } from 'path';

// Minimal plugin interface
interface OpenClawPluginApi {
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
  register(api: OpenClawPluginApi) {
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
          file: {
            type: 'string',
            description: 'Path to file to send - PDF, documents, etc. (for send action)',
          },
        },
        required: ['action'],
      },
      execute: async (_id, params) => {
        const action = params.action as string;
        const agentId = params.agentId as string | undefined;
        const message = params.message as string | undefined;
        const imagePath = params.image as string | undefined;
        const filePath = params.file as string | undefined;
        
        const manager = getA2AConnectionManager();
        if (!manager) {
          return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: 'A2A channel not running' }) }] };
        }

        if (action === 'list') {
          const hubStatus = manager.listAgents();
          const availableAgents = await manager.listAvailableAgents();
          return { content: [{ type: 'text', text: JSON.stringify({ 
            status: 'ok', 
            connected: hubStatus.some(h => h.connected),
            agents: availableAgents 
          }) }] };
        }

        if (action === 'send') {
          if (!agentId || (!message && !imagePath && !filePath)) {
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: 'agentId and (message, image, or file) required for send action' }) }] };
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
            
            // Add file part if image or file path provided
            const attachmentPath = imagePath || filePath;
            if (attachmentPath) {
              try {
                const fileData = readFileSync(attachmentPath);
                const base64Data = fileData.toString('base64');
                const ext = extname(attachmentPath).toLowerCase();
                const mimeTypes: Record<string, string> = {
                  // Images
                  '.png': 'image/png',
                  '.jpg': 'image/jpeg',
                  '.jpeg': 'image/jpeg',
                  '.gif': 'image/gif',
                  '.webp': 'image/webp',
                  '.svg': 'image/svg+xml',
                  // Documents
                  '.pdf': 'application/pdf',
                  '.doc': 'application/msword',
                  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  '.xls': 'application/vnd.ms-excel',
                  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  '.ppt': 'application/vnd.ms-powerpoint',
                  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                  '.txt': 'text/plain',
                  '.csv': 'text/csv',
                  '.json': 'application/json',
                  '.xml': 'application/xml',
                  '.html': 'text/html',
                  '.md': 'text/markdown',
                  // Archives
                  '.zip': 'application/zip',
                };
                const mimeType = mimeTypes[ext] || 'application/octet-stream';
                parts.push({ kind: 'data', data: base64Data, mimeType });
              } catch (fileErr) {
                return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: `Failed to read file: ${(fileErr as Error).message}` }) }] };
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

    // Register a tool for location-based agent discovery
    api.registerTool?.({
      name: 'a2a_discover_nearby',
      description: 'Find A2A agents near a geographic location',
      parameters: {
        type: 'object',
        properties: {
          lat: {
            type: 'number',
            description: 'Latitude of search center',
          },
          lng: {
            type: 'number',
            description: 'Longitude of search center',
          },
          radius: {
            type: 'number',
            description: 'Search radius in kilometers (default: 10, max: 500)',
          },
          tag: {
            type: 'string',
            description: 'Filter by tag (e.g., "retail", "food")',
          },
          category: {
            type: 'string',
            description: 'Filter by category',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 20, max: 50)',
          },
        },
        required: ['lat', 'lng'],
      },
      execute: async (_id, params) => {
        const lat = params.lat as number;
        const lng = params.lng as number;
        const radius = params.radius as number | undefined;
        const tag = params.tag as string | undefined;
        const category = params.category as string | undefined;
        const limit = params.limit as number | undefined;
        
        const manager = getA2AConnectionManager();
        if (!manager) {
          return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: 'A2A channel not running' }) }] };
        }

        if (!manager.isGopherHoleConnected()) {
          return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: 'Not connected to GopherHole' }) }] };
        }

        try {
          const agents = await manager.discoverNearby({ lat, lng, radius, tag, category, limit });
          return { content: [{ type: 'text', text: JSON.stringify({ 
            status: 'ok', 
            center: { lat, lng },
            radius: radius || 10,
            count: agents.length,
            agents 
          }) }] };
        } catch (err) {
          return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: (err as Error).message }) }] };
        }
      },
    });
  },
};

export default plugin;
export { getA2AConnectionManager };
