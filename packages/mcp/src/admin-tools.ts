import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const ADMIN_TOOLS: Tool[] = [
  {
    name: 'admin_agents_list',
    description: 'List all agents registered on your tenant. Returns agent IDs, names, aliases, visibility, and status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of agents to return (default: 50)',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset',
        },
      },
    },
  },
  {
    name: 'admin_agent_get',
    description: 'Get full details for a specific agent, including its agent card, skills, alias, email config, and visibility.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'The agent ID to retrieve (e.g., "agent-abc12345")',
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'admin_agent_create',
    description: 'Create a new agent on your tenant. Returns the new agent ID and a generated API key.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Display name for the agent',
        },
        description: {
          type: 'string',
          description: 'Human-readable description of what the agent does',
        },
        alias: {
          type: 'string',
          description: 'Short unique alias for the agent within your tenant (used in email addresses and discovery)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorising and discovering the agent',
        },
        category: {
          type: 'string',
          description: 'Category for grouping the agent (e.g., "utilities", "intelligence", "core")',
        },
        visibility: {
          type: 'string',
          enum: ['public', 'private', 'unlisted'],
          description: 'Who can discover the agent: "public" (anyone), "private" (tenant only), "unlisted" (accessible but not searchable)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'admin_agent_update',
    description: 'Update metadata on an existing agent. Only supplied fields are changed; omitted fields are left as-is.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'The agent ID to update',
        },
        name: {
          type: 'string',
          description: 'New display name',
        },
        description: {
          type: 'string',
          description: 'New description',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replacement tag list (replaces all existing tags)',
        },
        category: {
          type: 'string',
          description: 'New category',
        },
        visibility: {
          type: 'string',
          enum: ['public', 'private', 'unlisted'],
          description: 'New visibility setting',
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'admin_agent_delete',
    description: 'Permanently delete an agent and all associated data. This cannot be undone.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'The agent ID to delete',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm permanent deletion',
        },
      },
      required: ['agent_id', 'confirm'],
    },
  },
  {
    name: 'admin_agent_alias',
    description: "Set or change an agent's short alias. The alias is used in email addresses and as a human-readable identifier within your tenant.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'The agent ID to update',
        },
        alias: {
          type: 'string',
          description: 'The new alias (must be unique within the tenant, lowercase alphanumeric and hyphens only)',
        },
      },
      required: ['agent_id', 'alias'],
    },
  },
  {
    name: 'admin_agent_email',
    description: "Enable or disable inbound email for an agent. When enabled, the agent receives an email address (<alias>.<tenant-slug>@gopherhole.io) and inbound mail is delivered as agent messages.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'The agent ID to configure',
        },
        enabled: {
          type: 'boolean',
          description: 'true to enable email, false to disable',
        },
      },
      required: ['agent_id', 'enabled'],
    },
  },
  {
    name: 'admin_keys_list',
    description: 'List all API keys on the tenant. Returns key IDs, names, associated agent, scopes, and creation date. Secret values are never returned.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'admin_key_create',
    description: 'Create a new API key scoped to a specific agent. The secret is only returned once at creation time — store it securely.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Human-readable label for this key (e.g., "Production Worker")',
        },
        agent_id: {
          type: 'string',
          description: 'The agent this key authenticates as',
        },
        scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Permission scopes granted to this key (e.g., ["messages:send", "memory:read"]). Omit to inherit defaults.',
        },
      },
      required: ['name', 'agent_id'],
    },
  },
  {
    name: 'admin_key_delete',
    description: 'Permanently revoke and delete an API key. Any services using this key will immediately lose access.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        key_id: {
          type: 'string',
          description: 'The key ID to revoke',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm revocation',
        },
      },
      required: ['key_id', 'confirm'],
    },
  },
  {
    name: 'admin_key_regenerate',
    description: "Regenerate an agent's primary API key. The old key is immediately revoked and a new secret is returned. Store it securely — it will not be shown again.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'The agent whose API key should be regenerated',
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'admin_team_list',
    description: 'List all members of your tenant, including their roles, join dates, and the agents they own.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'admin_team_invite',
    description: 'Invite a person to join your tenant by email. They will receive an invitation link. You can optionally set their role.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        email: {
          type: 'string',
          description: 'Email address of the person to invite',
        },
        role: {
          type: 'string',
          enum: ['admin', 'member', 'viewer'],
          description: 'Role to assign: "admin" (full access), "member" (create and manage agents), "viewer" (read-only). Defaults to "member".',
        },
      },
      required: ['email'],
    },
  },
  {
    name: 'admin_team_remove',
    description: 'Remove a team member from your tenant. Their agents and keys are reassigned to the tenant owner.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        member_id: {
          type: 'string',
          description: 'The member ID to remove',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm removal',
        },
      },
      required: ['member_id', 'confirm'],
    },
  },
  {
    name: 'admin_access_incoming',
    description: 'List external agents and tenants that have requested access to your agents. Review these before approving or denying.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of requests to return (default: 20)',
        },
      },
    },
  },
  {
    name: 'admin_access_outgoing',
    description: 'List access requests your tenant has sent to external agents, including their current status (pending, approved, denied).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of requests to return (default: 20)',
        },
      },
    },
  },
  {
    name: 'admin_access_approve',
    description: 'Approve an incoming access request, granting the requesting agent permission to interact with your agent.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        request_id: {
          type: 'string',
          description: 'The access request ID to approve',
        },
        scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Scopes to grant with this approval. Omit to grant the scopes originally requested.',
        },
      },
      required: ['request_id'],
    },
  },
  {
    name: 'admin_access_deny',
    description: 'Deny an incoming access request. The requesting agent will be notified that access was not granted.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        request_id: {
          type: 'string',
          description: 'The access request ID to deny',
        },
        reason: {
          type: 'string',
          description: 'Optional reason sent to the requesting agent',
        },
      },
      required: ['request_id'],
    },
  },
  {
    name: 'admin_usage_summary',
    description: 'Get a high-level usage overview for your tenant: total messages sent and received, tasks created, active connections, and unique agents contacted.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string',
          enum: ['day', 'week', 'month'],
          description: 'Time window for the summary (default: month)',
        },
      },
    },
  },
  {
    name: 'admin_usage_agents',
    description: 'Get per-agent usage breakdown showing message counts, task counts, and credits consumed for each agent on your tenant.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string',
          enum: ['day', 'week', 'month'],
          description: 'Time window for the breakdown (default: month)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of agents to include (default: 20)',
        },
      },
    },
  },
  {
    name: 'admin_credits_balance',
    description: 'Get the current credit balance for your tenant, including total purchased, total used, and remaining credits.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'admin_spending',
    description: 'Get a spending overview showing credit consumption over time, broken down by category (messages, tasks, storage).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string',
          enum: ['day', 'week', 'month'],
          description: 'Time window for the spending report (default: month)',
        },
      },
    },
  },
  {
    name: 'admin_webhooks_list',
    description: 'List all configured webhooks on your tenant, including their URLs, subscribed events, and last delivery status.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'admin_webhooks_create',
    description: 'Create a new webhook endpoint. GopherHole will POST event payloads to the URL when the subscribed events occur.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The HTTPS URL to deliver events to',
        },
        events: {
          type: 'array',
          items: { type: 'string' },
          description: 'Event types to subscribe to (e.g., ["message.received", "task.completed", "access.requested"])',
        },
        description: {
          type: 'string',
          description: 'Optional human-readable label for this webhook',
        },
        secret: {
          type: 'string',
          description: 'Optional signing secret. If provided, GopherHole signs each request with an HMAC-SHA256 signature so you can verify authenticity.',
        },
      },
      required: ['url', 'events'],
    },
  },
  {
    name: 'admin_webhooks_delete',
    description: 'Delete a webhook endpoint. GopherHole will stop delivering events to this URL immediately.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        webhook_id: {
          type: 'string',
          description: 'The webhook ID to delete',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm deletion',
        },
      },
      required: ['webhook_id', 'confirm'],
    },
  },
  {
    name: 'admin_webhooks_test',
    description: 'Send a test event payload to a webhook endpoint to verify it is reachable and your handler is working correctly.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        webhook_id: {
          type: 'string',
          description: 'The webhook ID to test',
        },
      },
      required: ['webhook_id'],
    },
  },
  {
    name: 'admin_tenant_settings',
    description: 'Get current tenant settings including name, slug, plan, billing contact, and feature flags.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'admin_tenant_update',
    description: 'Update tenant-level settings such as the display name or slug. At least one field must be supplied.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'New display name for the tenant',
        },
        slug: {
          type: 'string',
          description: 'New URL-safe slug for the tenant (must be unique, lowercase alphanumeric and hyphens only)',
        },
      },
    },
  },
  {
    name: 'admin_profile_update',
    description: 'Update your own user profile on GopherHole. At least one field must be supplied.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Your display name',
        },
        avatar_url: {
          type: 'string',
          description: 'URL to your avatar image (must be a publicly accessible HTTPS URL)',
        },
      },
    },
  },
  {
    name: 'admin_secrets_list',
    description: 'List secret keys stored in a workspace. Only key names are returned — values are never exposed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: {
          type: 'string',
          description: 'The workspace ID whose secrets to list',
        },
      },
      required: ['workspace_id'],
    },
  },
  {
    name: 'admin_secrets_set',
    description: 'Create or update a secret in a workspace. If the key already exists, its value is overwritten. Secrets are encrypted at rest.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: {
          type: 'string',
          description: 'The workspace ID to store the secret in',
        },
        key: {
          type: 'string',
          description: 'Secret key name (e.g., "OPENAI_API_KEY")',
        },
        value: {
          type: 'string',
          description: 'Secret value to store',
        },
      },
      required: ['workspace_id', 'key', 'value'],
    },
  },
  {
    name: 'admin_secrets_delete',
    description: 'Permanently delete a secret from a workspace. Any agent relying on this secret will lose access to it.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: {
          type: 'string',
          description: 'The workspace ID containing the secret',
        },
        key: {
          type: 'string',
          description: 'The secret key name to delete',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm deletion',
        },
      },
      required: ['workspace_id', 'key', 'confirm'],
    },
  },
];
