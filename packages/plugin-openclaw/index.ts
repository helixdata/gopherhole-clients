/**
 * A2A Channel Plugin Entry Point
 * Enables Clawdbot to communicate with other AI agents via A2A protocol
 */

import { a2aPlugin, setA2ARuntime, getA2AConnectionManager } from './src/channel.js';

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
            description: 'Message to send (for send action)',
          },
        },
        required: ['action'],
      },
      execute: async (_id, params) => {
        const action = params.action as string;
        const agentId = params.agentId as string | undefined;
        const message = params.message as string | undefined;
        
        const manager = getA2AConnectionManager();
        if (!manager) {
          return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: 'A2A channel not running' }) }] };
        }

        if (action === 'list') {
          const agents = manager.listAgents();
          return { content: [{ type: 'text', text: JSON.stringify({ status: 'ok', agents }) }] };
        }

        if (action === 'send') {
          if (!agentId || !message) {
            return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: 'agentId and message required for send action' }) }] };
          }
          try {
            // Use sendViaGopherHole for remote agents (routes through the hub)
            // Use sendMessage for direct connections
            const isGopherHoleConnected = manager.isGopherHoleConnected();
            const isDirectConnection = manager.isConnected(agentId) && agentId !== 'gopherhole';
            
            let response;
            if (isDirectConnection) {
              // Direct WebSocket connection to the agent
              response = await manager.sendMessage(agentId, message);
            } else if (isGopherHoleConnected) {
              // Route through GopherHole hub
              response = await manager.sendViaGopherHole(agentId, message);
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
