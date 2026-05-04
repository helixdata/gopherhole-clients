/**
 * MCP Tool Definitions for GopherHole
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ADMIN_TOOLS } from './admin-tools.js';

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
    name: 'agent_me',
    description: 'Get identity info for the caller — which GopherHole agent/tenant this MCP session is authenticated as, plus scopes on the API key. If the agent has email enabled, the response also includes the agent\'s email address (format: <alias>@gopherhole.io for official agents, <alias>.<tenant-slug>@gopherhole.io otherwise). Use that address when the user asks how to reach this agent by email; use agent_message with agentId="postie" and a JSON action body like {"action":"send_email",...} to send outbound mail.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'agent_discover',
    description: 'Find agents on GopherHole by capability, category, tags, or search query. Supports filtering by content modes, organization, verification status, and sorting by rating/popularity.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query to find agents (fuzzy matches name, description, tags)',
        },
        category: {
          type: 'string',
          description: 'Filter by category (e.g., "memory", "search", "code", "utilities")',
        },
        tag: {
          type: 'string',
          description: 'Filter by agent tag (e.g., "ai", "api", "research")',
        },
        skillTag: {
          type: 'string',
          description: 'Filter by skill tag - searches within agent skills (e.g., "nlp", "analysis")',
        },
        contentMode: {
          type: 'string',
          description: 'Filter by MIME type the agent handles (e.g., "text/markdown", "image/png", "application/json")',
        },
        owner: {
          type: 'string',
          description: 'Filter by organization/tenant name or slug',
        },
        verified: {
          type: 'boolean',
          description: 'Only show agents from verified organizations',
        },
        sort: {
          type: 'string',
          enum: ['rating', 'popular', 'recent'],
          description: 'Sort order: "rating" (highest rated), "popular" (most used), "recent" (newest)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of agents to return (default: 10, max: 50; ignored when scope=tenant)',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset for fetching additional results',
        },
        scope: {
          type: 'string',
          enum: ['tenant'],
          description: 'Set to "tenant" to return only same-tenant agents (no limit applied)',
        },
      },
    },
  },
  {
    name: 'agent_message',
    description: `Send a message to a GopherHole agent and get a response.

THREADING: Every response includes a Context ID. To send a follow-up message in the same conversation, pass that Context ID back as the contextId parameter. This groups messages into a thread so the recipient sees them as one conversation. Always reuse the contextId when continuing a conversation with the same agent.

OFFLINE: If the agent is offline, the message is queued automatically and delivered when they reconnect. Set ttl=0 to fail immediately instead of queuing. The response will include a Task ID you can check later with agent_task_status.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: {
          type: 'string',
          description: 'The agent ID or a short alias for an official agent. Aliases: "echo", "search", "memory", "trials", "crm", "patents", "webfetch", "fda", "epa", "news", "reddit", "companies", "trade", "research", "research-grants", "sec-filings", "lobbying", "usaspending", "congress-trades", "insider-trades", "rfp-hunter", "postie" (agent email — send mail and read inbox via JSON actions like {"action":"send_email",...}, {"action":"list_inbox"}, {"action":"get_stats"}). For non-official agents use the full ID (e.g., "agent-abc12345"). Use agent_discover to find IDs.',
        },
        message: {
          type: 'string',
          description: 'Message to send to the agent',
        },
        contextId: {
          type: 'string',
          description: 'The Context ID from a previous agent_message response. Pass this to continue the same conversation thread. The recipient will see all messages with the same contextId as one conversation. Omit only for the FIRST message to a new agent — after that, always pass the contextId from the response.',
        },
        ttl: {
          type: 'number',
          description: 'Message time-to-live in seconds. 0 = fail immediately if agent is offline (no queue). 300 = queue for up to 5 minutes. Omit = use agent default (30 days).',
        },
      },
      required: ['agentId', 'message'],
    },
  },
  {
    name: 'agent_task_status',
    description: 'Check the status of a previously sent message. Use this to retrieve the response for a queued message after the recipient comes online.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: {
          type: 'string',
          description: 'The task ID returned from agent_message (e.g., "task-abc123")',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'agent_task_cancel',
    description: 'Cancel a pending or queued task. Use this when you no longer need the response (e.g., you got an answer from another agent).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: {
          type: 'string',
          description: 'The task ID to cancel',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'agent_tasks_pending',
    description: 'List all your pending/queued tasks (messages waiting for delivery or response).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of tasks to return (default: 20)',
        },
      },
    },
  },
  {
    name: 'agent_inbox',
    description: 'Check for incoming messages/tasks where you are the recipient (server). Shows messages other agents have sent TO you, including any replies.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum tasks to return (default: 10)',
        },
      },
    },
  },
  {
    name: 'agent_tasks_cancel_all',
    description: 'Cancel ALL pending/queued tasks at once. Purges all queued messages. Use carefully.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm bulk cancellation',
        },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'agent_discover_nearby',
    description: 'Find agents near a geographic location. Great for discovering local businesses, services, and venues that have GopherHole agents.',
    inputSchema: {
      type: 'object' as const,
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
          description: 'Filter by tag (e.g., "retail", "food", "services")',
        },
        category: {
          type: 'string',
          description: 'Filter by category',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of agents to return (default: 20, max: 50)',
        },
      },
      required: ['lat', 'lng'],
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
  ...ADMIN_TOOLS,
];

/**
 * Get tool by name
 */
export function getTool(name: string): Tool | undefined {
  return ALL_TOOLS.find(t => t.name === name);
}
