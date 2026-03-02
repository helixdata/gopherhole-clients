#!/usr/bin/env node
/**
 * GopherHole MCP Server
 * 
 * Exposes GopherHole agents as MCP tools for Claude Code, Cursor, and other
 * MCP-compatible IDEs.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { GopherHoleClient } from './client.js';
import { ALL_TOOLS } from './tools.js';

// Default memory agent ID (can be overridden via env)
const MEMORY_AGENT_ID = process.env.GOPHERHOLE_MEMORY_AGENT || 'agent-memory-official';

/**
 * Format tags for the memory store message
 */
function formatStoreMessage(content: string, tags?: string[]): string {
  let message = `Remember this:\n\n${content}`;
  if (tags?.length) {
    message += `\n\nTags: ${tags.join(', ')}`;
  }
  return message;
}

/**
 * Format search query for memory recall
 */
function formatRecallMessage(query: string, limit?: number): string {
  let message = `Search memories for: ${query}`;
  if (limit) {
    message += ` (limit: ${limit})`;
  }
  return message;
}

/**
 * Main entry point
 */
async function main() {
  // Initialize GopherHole client
  let client: GopherHoleClient;
  try {
    client = GopherHoleClient.fromEnv();
  } catch (error) {
    console.error('Error: GOPHERHOLE_API_KEY environment variable is required');
    console.error('Get your API key at https://gopherhole.ai');
    process.exit(1);
  }

  // Create MCP server
  const server = new Server(
    {
      name: 'gopherhole',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle tools/list
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: ALL_TOOLS };
  });

  // Handle tools/call
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'memory_store': {
          const content = args?.content as string;
          const tags = args?.tags as string[] | undefined;
          
          if (!content) {
            return {
              content: [{ type: 'text', text: 'Error: content is required' }],
              isError: true,
            };
          }

          const message = formatStoreMessage(content, tags);
          const response = await client.askText(MEMORY_AGENT_ID, message);
          
          return {
            content: [{ type: 'text', text: response || 'Memory stored successfully' }],
          };
        }

        case 'memory_recall': {
          const query = args?.query as string;
          const limit = args?.limit as number | undefined;
          
          if (!query) {
            return {
              content: [{ type: 'text', text: 'Error: query is required' }],
              isError: true,
            };
          }

          const message = formatRecallMessage(query, limit);
          const response = await client.askText(MEMORY_AGENT_ID, message);
          
          return {
            content: [{ type: 'text', text: response || 'No memories found' }],
          };
        }

        case 'memory_forget': {
          const query = args?.query as string;
          const confirmDelete = args?.confirmDelete as boolean;
          
          if (!query || !confirmDelete) {
            return {
              content: [{ type: 'text', text: 'Error: query and confirmDelete=true are required' }],
              isError: true,
            };
          }

          const response = await client.askText(MEMORY_AGENT_ID, `Forget memories matching: ${query}`);
          
          return {
            content: [{ type: 'text', text: response || 'Memories deleted' }],
          };
        }

        case 'memory_list': {
          const limit = args?.limit as number || 20;
          const offset = args?.offset as number || 0;
          
          const response = await client.askText(
            MEMORY_AGENT_ID, 
            `List my recent memories (limit: ${limit}, offset: ${offset})`
          );
          
          return {
            content: [{ type: 'text', text: response || 'No memories found' }],
          };
        }

        case 'agent_discover': {
          const query = args?.query as string;
          const category = args?.category as string;
          const limit = args?.limit as number;
          
          const result = await client.discover({ query, category, limit });
          
          if (result.agents.length === 0) {
            return {
              content: [{ type: 'text', text: 'No agents found matching your criteria' }],
            };
          }

          const agentList = result.agents.map(a => 
            `• **${a.name}** (${a.id})\n  ${a.description || 'No description'}\n  Rating: ${a.avgRating.toFixed(1)} ⭐ (${a.ratingCount} reviews)`
          ).join('\n\n');
          
          return {
            content: [{ type: 'text', text: `Found ${result.count} agents:\n\n${agentList}` }],
          };
        }

        case 'agent_message': {
          const agentId = args?.agentId as string;
          const message = args?.message as string;
          
          if (!agentId || !message) {
            return {
              content: [{ type: 'text', text: 'Error: agentId and message are required' }],
              isError: true,
            };
          }

          const response = await client.askText(agentId, message);
          
          return {
            content: [{ type: 'text', text: response || 'No response from agent' }],
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  // Log to stderr (stdout is for MCP protocol)
  console.error('GopherHole MCP server started');
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
