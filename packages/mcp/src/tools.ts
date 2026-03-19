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
 * Phase 3 Tools - Workspaces (Multi-Agent Collaboration)
 */
export const WORKSPACE_TOOLS: Tool[] = [
  {
    name: 'workspace_list',
    description: 'List workspaces you are a member of. Workspaces are shared memory spaces for multi-agent collaboration.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'workspace_create',
    description: 'Create a new workspace for collaboration with other agents.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Name of the workspace',
        },
        description: {
          type: 'string',
          description: 'Optional description of the workspace purpose',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'workspace_members_add',
    description: 'Add an agent to a workspace (requires admin role).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: {
          type: 'string',
          description: 'ID of the workspace',
        },
        agent_id: {
          type: 'string',
          description: 'ID of the agent to add',
        },
        role: {
          type: 'string',
          enum: ['read', 'write', 'admin'],
          description: 'Role for the new member (default: write)',
        },
      },
      required: ['workspace_id', 'agent_id'],
    },
  },
  {
    name: 'workspace_members_list',
    description: 'List members of a workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: {
          type: 'string',
          description: 'ID of the workspace',
        },
      },
      required: ['workspace_id'],
    },
  },
  {
    name: 'workspace_store',
    description: 'Store a memory in a shared workspace. Other workspace members can query this memory.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: {
          type: 'string',
          description: 'ID of the workspace',
        },
        content: {
          type: 'string',
          description: 'Content to store',
        },
        type: {
          type: 'string',
          enum: ['fact', 'decision', 'preference', 'todo', 'context', 'reference'],
          description: 'Type of memory (default: fact)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for categorization',
        },
      },
      required: ['workspace_id', 'content'],
    },
  },
  {
    name: 'workspace_query',
    description: 'Search workspace memories using semantic search. Returns memories matching your query.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: {
          type: 'string',
          description: 'ID of the workspace',
        },
        query: {
          type: 'string',
          description: 'Search query',
        },
        type: {
          type: 'string',
          description: 'Optional filter by memory type',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 10)',
        },
      },
      required: ['workspace_id', 'query'],
    },
  },
  {
    name: 'workspace_memories',
    description: 'List all memories in a workspace (non-semantic browse).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: {
          type: 'string',
          description: 'ID of the workspace',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 20)',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset',
        },
      },
      required: ['workspace_id'],
    },
  },
  {
    name: 'workspace_forget',
    description: 'Delete memories from a workspace by ID or semantic query.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: {
          type: 'string',
          description: 'ID of the workspace',
        },
        id: {
          type: 'string',
          description: 'Specific memory ID to delete',
        },
        query: {
          type: 'string',
          description: 'Or delete memories matching this query',
        },
      },
      required: ['workspace_id'],
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
  ...WORKSPACE_TOOLS,
];

/**
 * Get tool by name
 */
export function getTool(name: string): Tool | undefined {
  return ALL_TOOLS.find(t => t.name === name);
}
