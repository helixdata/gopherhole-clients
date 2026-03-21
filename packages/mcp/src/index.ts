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
          const tag = args?.tag as string;
          const skillTag = args?.skillTag as string;
          const contentMode = args?.contentMode as string;
          const owner = args?.owner as string;
          const verified = args?.verified as boolean | undefined;
          const sort = args?.sort as string;
          const limit = args?.limit as number;
          const offset = args?.offset as number;
          const scope = args?.scope as string;
          
          const result = await client.discover({ query, category, tag, skillTag, contentMode, owner, verified, sort, limit, offset, scope });
          
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

        // ============================================================
        // WORKSPACE TOOLS
        // ============================================================

        case 'workspace_list': {
          const result = await client.workspaceList();
          
          if (result.workspaces.length === 0) {
            return {
              content: [{ type: 'text', text: 'You are not a member of any workspaces yet.' }],
            };
          }

          const list = result.workspaces.map(w => 
            `• **${w.name}** (${w.id})\n  ${w.description || 'No description'}\n  Role: ${w.my_role || 'unknown'} | Members: ${w.member_count || '?'} | Memories: ${w.memory_count || '?'}`
          ).join('\n\n');
          
          return {
            content: [{ type: 'text', text: `Your workspaces:\n\n${list}` }],
          };
        }

        case 'workspace_create': {
          const wsName = args?.name as string;
          const description = args?.description as string | undefined;
          
          if (!wsName) {
            return {
              content: [{ type: 'text', text: 'Error: name is required' }],
              isError: true,
            };
          }

          const result = await client.workspaceCreate(wsName, description);
          
          return {
            content: [{ type: 'text', text: `Workspace created!\n\nID: ${result.workspace.id}\nName: ${result.workspace.name}` }],
          };
        }

        case 'workspace_members_add': {
          const workspaceId = args?.workspace_id as string;
          const agentId = args?.agent_id as string;
          const role = (args?.role as 'read' | 'write' | 'admin') || 'write';
          
          if (!workspaceId || !agentId) {
            return {
              content: [{ type: 'text', text: 'Error: workspace_id and agent_id are required' }],
              isError: true,
            };
          }

          await client.workspaceMembersAdd(workspaceId, agentId, role);
          
          return {
            content: [{ type: 'text', text: `Added agent ${agentId} to workspace with role: ${role}` }],
          };
        }

        case 'workspace_members_list': {
          const workspaceId = args?.workspace_id as string;
          
          if (!workspaceId) {
            return {
              content: [{ type: 'text', text: 'Error: workspace_id is required' }],
              isError: true,
            };
          }

          const result = await client.workspaceMembersList(workspaceId);
          
          const list = result.members.map(m => 
            `• ${m.agent_name || m.agent_id} (${m.role})`
          ).join('\n');
          
          return {
            content: [{ type: 'text', text: `Workspace members:\n\n${list}` }],
          };
        }

        case 'workspace_store': {
          const workspaceId = args?.workspace_id as string;
          const content = args?.content as string;
          const memType = args?.type as 'fact' | 'decision' | 'preference' | 'todo' | 'context' | 'reference' | undefined;
          const tags = args?.tags as string[] | undefined;
          
          if (!workspaceId || !content) {
            return {
              content: [{ type: 'text', text: 'Error: workspace_id and content are required' }],
              isError: true,
            };
          }

          const result = await client.workspaceStore({
            workspace_id: workspaceId,
            content,
            type: memType,
            tags,
          });
          
          return {
            content: [{ type: 'text', text: `Memory stored!\n\nID: ${result.memory.id}\nType: ${result.memory.type}` }],
          };
        }

        case 'workspace_query': {
          const workspaceId = args?.workspace_id as string;
          const query = args?.query as string;
          const memType = args?.type as string | undefined;
          const limit = args?.limit as number | undefined;
          
          if (!workspaceId || !query) {
            return {
              content: [{ type: 'text', text: 'Error: workspace_id and query are required' }],
              isError: true,
            };
          }

          const result = await client.workspaceQuery({
            workspace_id: workspaceId,
            query,
            type: memType,
            limit,
          });
          
          if (result.memories.length === 0) {
            return {
              content: [{ type: 'text', text: 'No memories found matching your query.' }],
            };
          }

          const list = result.memories.map(m => 
            `• [${m.type}] ${m.content.substring(0, 200)}${m.content.length > 200 ? '...' : ''}\n  Similarity: ${((m.similarity || 0) * 100).toFixed(0)}% | Tags: ${m.tags.join(', ') || 'none'}`
          ).join('\n\n');
          
          return {
            content: [{ type: 'text', text: `Found ${result.count} memories:\n\n${list}` }],
          };
        }

        case 'workspace_memories': {
          const workspaceId = args?.workspace_id as string;
          const limit = args?.limit as number || 20;
          const offset = args?.offset as number || 0;
          
          if (!workspaceId) {
            return {
              content: [{ type: 'text', text: 'Error: workspace_id is required' }],
              isError: true,
            };
          }

          const result = await client.workspaceMemories({
            workspace_id: workspaceId,
            limit,
            offset,
          });
          
          if (result.memories.length === 0) {
            return {
              content: [{ type: 'text', text: 'No memories in this workspace.' }],
            };
          }

          const list = result.memories.map(m => 
            `• [${m.type}] ${m.content.substring(0, 150)}${m.content.length > 150 ? '...' : ''}`
          ).join('\n\n');
          
          return {
            content: [{ type: 'text', text: `Showing ${result.count} of ${result.total} memories:\n\n${list}` }],
          };
        }

        case 'workspace_forget': {
          const workspaceId = args?.workspace_id as string;
          const memoryId = args?.id as string | undefined;
          const query = args?.query as string | undefined;
          
          if (!workspaceId) {
            return {
              content: [{ type: 'text', text: 'Error: workspace_id is required' }],
              isError: true,
            };
          }

          if (!memoryId && !query) {
            return {
              content: [{ type: 'text', text: 'Error: either id or query is required' }],
              isError: true,
            };
          }

          const result = await client.workspaceForget({
            workspace_id: workspaceId,
            id: memoryId,
            query,
          });
          
          return {
            content: [{ type: 'text', text: `Deleted ${result.deleted} memory/memories.` }],
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
