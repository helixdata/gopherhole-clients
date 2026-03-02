/**
 * MCP Tool Definitions for GopherHole
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Phase 1 Tools - Memory
 */
export const MEMORY_TOOLS: Tool[] = [
  {
    name: 'memory_store',
    description: 'Store a memory for later recall. Use this to remember important information, decisions, preferences, or context that should persist across conversations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'What to remember. Be specific and include relevant context.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags to categorize the memory (e.g., "project", "preference", "decision")',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'memory_recall',
    description: 'Recall memories about a topic. Search through stored memories to find relevant information.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'What to search for. Can be a topic, keyword, or question.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of memories to return (default: 10)',
        },
      },
      required: ['query'],
    },
  },
];

/**
 * Phase 2 Tools - Extended Memory
 */
export const EXTENDED_MEMORY_TOOLS: Tool[] = [
  {
    name: 'memory_forget',
    description: 'Forget/delete memories matching a query. Use carefully - this permanently removes memories.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Query to match memories to forget',
        },
        confirmDelete: {
          type: 'boolean',
          description: 'Must be true to confirm deletion',
        },
      },
      required: ['query', 'confirmDelete'],
    },
  },
  {
    name: 'memory_list',
    description: 'List recent memories without searching. Good for reviewing what has been stored.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of memories to return (default: 20)',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset',
        },
      },
    },
  },
];

/**
 * Phase 2 Tools - Agent Discovery & Messaging
 */
export const AGENT_TOOLS: Tool[] = [
  {
    name: 'agent_discover',
    description: 'Find agents on GopherHole by capability, category, or search query.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query to find agents',
        },
        category: {
          type: 'string',
          description: 'Filter by category (e.g., "memory", "search", "code")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of agents to return (default: 10)',
        },
      },
    },
  },
  {
    name: 'agent_message',
    description: 'Send a message to any GopherHole agent and get a response.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID (e.g., "memory", "search", or a full agent ID)',
        },
        message: {
          type: 'string',
          description: 'Message to send to the agent',
        },
      },
      required: ['agentId', 'message'],
    },
  },
];

/**
 * All tools combined
 */
export const ALL_TOOLS: Tool[] = [
  ...MEMORY_TOOLS,
  ...EXTENDED_MEMORY_TOOLS,
  ...AGENT_TOOLS,
];

/**
 * Get tool by name
 */
export function getTool(name: string): Tool | undefined {
  return ALL_TOOLS.find(t => t.name === name);
}
