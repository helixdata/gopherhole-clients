import { loadStoredAccessToken, refreshAdminToken } from './auth.js';

interface AdminContext {
  appUrl: string;
  apiUrl: string;
}

let adminToken: string | null = null;
let adminAuthInProgress = false;

export async function ensureAdminToken(ctx: AdminContext): Promise<string> {
  if (adminToken) return adminToken;

  const stored = loadStoredAccessToken();
  if (stored) {
    adminToken = stored;
    return stored;
  }

  if (!adminAuthInProgress) {
    adminAuthInProgress = true;
    refreshAdminToken(ctx.appUrl).then(({ accessToken }) => {
      adminToken = accessToken;
      adminAuthInProgress = false;
      console.error('  GopherHole: Admin token refreshed. Admin tools are now available.');
    }).catch(() => {
      adminAuthInProgress = false;
    });
  }

  throw new Error(
    'Admin session expired. A browser window has been opened to re-authenticate — please complete email verification, then retry this tool call.'
  );
}

async function adminFetch(ctx: AdminContext, path: string, opts: RequestInit = {}): Promise<any> {
  const token = await ensureAdminToken(ctx);
  const url = `${ctx.appUrl}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });

  if (res.status === 401) {
    adminToken = null;
    throw new Error('Admin session expired. Please retry — a browser window will open to re-authenticate.');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(body.error || body.message || `HTTP ${res.status} ${res.statusText}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

function error(msg: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
}

export async function handleAdminTool(
  name: string,
  args: Record<string, any> | undefined,
  ctx: AdminContext,
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  try {
    switch (name) {
      // ── Agent Management ──────────────────────────────────────
      case 'admin_agents_list': {
        const params = new URLSearchParams();
        if (args?.limit) params.set('limit', String(args.limit));
        if (args?.offset) params.set('offset', String(args.offset));
        const qs = params.toString() ? `?${params}` : '';
        const data = await adminFetch(ctx, `/api/agents${qs}`);
        const agents = Array.isArray(data) ? data : data.agents || [];
        if (agents.length === 0) return text('No agents found on this tenant.');
        const list = agents.map((a: any) =>
          `- **${a.name}** (\`${a.id}\`)${a.alias ? ` @${a.alias}` : ''} — ${a.visibility || 'private'}${a.description ? `\n  ${a.description.slice(0, 100)}` : ''}`
        ).join('\n');
        return text(`**${agents.length} agent(s):**\n\n${list}`);
      }

      case 'admin_agent_get': {
        if (!args?.agent_id) return error('agent_id is required');
        const data = await adminFetch(ctx, `/api/agents/${args.agent_id}`);
        return text(`\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
      }

      case 'admin_agent_create': {
        if (!args?.name) return error('name is required');
        const body: any = { name: args.name };
        if (args.description) body.description = args.description;
        if (args.alias) body.alias = args.alias;
        if (args.tags) body.tags = args.tags;
        if (args.category) body.category = args.category;
        if (args.visibility) body.visibility = args.visibility;
        const data = await adminFetch(ctx, '/api/agents', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return text(`Agent created!\n\n- **ID:** \`${data.id || data.agent?.id}\`\n- **Name:** ${data.name || data.agent?.name}\n- **API Key:** \`${data.apiKey || data.api_key || '(see dashboard)'}\``);
      }

      case 'admin_agent_update': {
        if (!args?.agent_id) return error('agent_id is required');
        const { agent_id, ...updates } = args;
        if (Object.keys(updates).length === 0) return error('At least one field to update is required');
        const data = await adminFetch(ctx, `/api/agents/${agent_id}`, {
          method: 'PATCH',
          body: JSON.stringify(updates),
        });
        return text(`Agent \`${agent_id}\` updated successfully.`);
      }

      case 'admin_agent_delete': {
        if (!args?.agent_id) return error('agent_id is required');
        if (!args?.confirm) return error('confirm must be true to delete an agent');
        await adminFetch(ctx, `/api/agents/${args.agent_id}`, { method: 'DELETE' });
        return text(`Agent \`${args.agent_id}\` has been permanently deleted.`);
      }

      case 'admin_agent_alias': {
        if (!args?.agent_id || !args?.alias) return error('agent_id and alias are required');
        await adminFetch(ctx, `/api/agents/${args.agent_id}/alias`, {
          method: 'PATCH',
          body: JSON.stringify({ alias: args.alias }),
        });
        return text(`Alias for \`${args.agent_id}\` set to **@${args.alias}**`);
      }

      case 'admin_agent_email': {
        if (!args?.agent_id || args?.enabled === undefined) return error('agent_id and enabled are required');
        await adminFetch(ctx, `/api/agents/${args.agent_id}/email-enabled`, {
          method: 'PATCH',
          body: JSON.stringify({ emailEnabled: args.enabled }),
        });
        return text(`Email ${args.enabled ? 'enabled' : 'disabled'} for agent \`${args.agent_id}\`.`);
      }

      // ── API Keys ──────────────────────────────────────────────
      case 'admin_keys_list': {
        const data = await adminFetch(ctx, '/api/api-keys');
        const keys = Array.isArray(data) ? data : data.keys || [];
        if (keys.length === 0) return text('No API keys found.');
        const list = keys.map((k: any) =>
          `- \`${k.id}\` — ${k.name || 'unnamed'} (agent: ${k.agentId || k.agent_id || 'none'}, prefix: \`${k.prefix || '???'}\`, scopes: ${k.scopes?.join(', ') || 'default'})`
        ).join('\n');
        return text(`**${keys.length} API key(s):**\n\n${list}`);
      }

      case 'admin_key_create': {
        if (!args?.name || !args?.agent_id) return error('name and agent_id are required');
        const body: any = { name: args.name, agentId: args.agent_id };
        if (args.scopes) body.scopes = args.scopes;
        const data = await adminFetch(ctx, '/api/api-keys', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return text(`API key created!\n\n- **ID:** \`${data.id}\`\n- **Key:** \`${data.key || data.secret || '(shown once — check response)'}\`\n\nStore this key securely — it will not be shown again.`);
      }

      case 'admin_key_delete': {
        if (!args?.key_id) return error('key_id is required');
        if (!args?.confirm) return error('confirm must be true to revoke a key');
        await adminFetch(ctx, `/api/api-keys/${args.key_id}`, { method: 'DELETE' });
        return text(`API key \`${args.key_id}\` has been revoked and deleted.`);
      }

      case 'admin_key_regenerate': {
        if (!args?.agent_id) return error('agent_id is required');
        const data = await adminFetch(ctx, `/api/agents/${args.agent_id}/regenerate-key`, {
          method: 'POST',
        });
        return text(`API key regenerated for \`${args.agent_id}\`.\n\n- **New Key:** \`${data.key || data.apiKey || data.api_key}\`\n\nThe old key is now invalid. Store this securely.`);
      }

      // ── Team ──────────────────────────────────────────────────
      case 'admin_team_list': {
        const data = await adminFetch(ctx, '/api/team/members');
        const members = Array.isArray(data) ? data : data.members || [];
        if (members.length === 0) return text('No team members found.');
        const list = members.map((m: any) =>
          `- **${m.name || m.email}** (\`${m.id}\`) — role: ${m.role}${m.joinedAt ? `, joined: ${m.joinedAt}` : ''}`
        ).join('\n');
        return text(`**${members.length} team member(s):**\n\n${list}`);
      }

      case 'admin_team_invite': {
        if (!args?.email) return error('email is required');
        const body: any = { email: args.email };
        if (args.role) body.role = args.role;
        await adminFetch(ctx, '/api/team/invites', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return text(`Invitation sent to \`${args.email}\` with role: ${args.role || 'member'}.`);
      }

      case 'admin_team_remove': {
        if (!args?.member_id) return error('member_id is required');
        if (!args?.confirm) return error('confirm must be true to remove a team member');
        await adminFetch(ctx, `/api/team/members/${args.member_id}`, { method: 'DELETE' });
        return text(`Team member \`${args.member_id}\` has been removed.`);
      }

      // ── Access Grants ─────────────────────────────────────────
      case 'admin_access_incoming': {
        const limit = args?.limit || 20;
        const data = await adminFetch(ctx, `/api/access/incoming?limit=${limit}`);
        const requests = Array.isArray(data) ? data : data.requests || [];
        if (requests.length === 0) return text('No incoming access requests.');
        const list = requests.map((r: any) =>
          `- \`${r.id}\` — from ${r.requesterName || r.requesterId} → ${r.agentName || r.agentId} (status: ${r.status})`
        ).join('\n');
        return text(`**${requests.length} incoming request(s):**\n\n${list}`);
      }

      case 'admin_access_outgoing': {
        const limit = args?.limit || 20;
        const data = await adminFetch(ctx, `/api/access/outgoing?limit=${limit}`);
        const requests = Array.isArray(data) ? data : data.requests || [];
        if (requests.length === 0) return text('No outgoing access requests.');
        const list = requests.map((r: any) =>
          `- \`${r.id}\` — to ${r.agentName || r.agentId} (status: ${r.status})`
        ).join('\n');
        return text(`**${requests.length} outgoing request(s):**\n\n${list}`);
      }

      case 'admin_access_approve': {
        if (!args?.request_id) return error('request_id is required');
        const body: any = {};
        if (args.scopes) body.scopes = args.scopes;
        await adminFetch(ctx, `/api/access/${args.request_id}/approve`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return text(`Access request \`${args.request_id}\` approved.`);
      }

      case 'admin_access_deny': {
        if (!args?.request_id) return error('request_id is required');
        const body: any = {};
        if (args.reason) body.reason = args.reason;
        await adminFetch(ctx, `/api/access/${args.request_id}/deny`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return text(`Access request \`${args.request_id}\` denied.`);
      }

      // ── Usage & Spending ──────────────────────────────────────
      case 'admin_usage_summary': {
        const params = new URLSearchParams();
        if (args?.period) params.set('period', args.period);
        const qs = params.toString() ? `?${params}` : '';
        const data = await adminFetch(ctx, `/api/usage/summary${qs}`);
        return text(`\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
      }

      case 'admin_usage_agents': {
        const params = new URLSearchParams();
        if (args?.period) params.set('period', args.period);
        if (args?.limit) params.set('limit', String(args.limit));
        const qs = params.toString() ? `?${params}` : '';
        const data = await adminFetch(ctx, `/api/usage/agents${qs}`);
        return text(`\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
      }

      case 'admin_credits_balance': {
        const data = await adminFetch(ctx, '/api/credits/balance');
        return text(`\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
      }

      case 'admin_spending': {
        const params = new URLSearchParams();
        if (args?.period) params.set('period', args.period);
        const qs = params.toString() ? `?${params}` : '';
        const data = await adminFetch(ctx, `/api/spending${qs}`);
        return text(`\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
      }

      // ── Webhooks ──────────────────────────────────────────────
      case 'admin_webhooks_list': {
        const data = await adminFetch(ctx, '/api/webhooks');
        const hooks = Array.isArray(data) ? data : data.webhooks || [];
        if (hooks.length === 0) return text('No webhooks configured.');
        const list = hooks.map((h: any) =>
          `- \`${h.id}\` — ${h.url}\n  Events: ${h.events?.join(', ') || 'all'}${h.description ? `\n  ${h.description}` : ''}`
        ).join('\n');
        return text(`**${hooks.length} webhook(s):**\n\n${list}`);
      }

      case 'admin_webhooks_create': {
        if (!args?.url || !args?.events) return error('url and events are required');
        const body: any = { url: args.url, events: args.events };
        if (args.description) body.description = args.description;
        if (args.secret) body.secret = args.secret;
        const data = await adminFetch(ctx, '/api/webhooks', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return text(`Webhook created!\n\n- **ID:** \`${data.id}\`\n- **URL:** ${args.url}\n- **Events:** ${args.events.join(', ')}`);
      }

      case 'admin_webhooks_delete': {
        if (!args?.webhook_id) return error('webhook_id is required');
        if (!args?.confirm) return error('confirm must be true to delete a webhook');
        await adminFetch(ctx, `/api/webhooks/${args.webhook_id}`, { method: 'DELETE' });
        return text(`Webhook \`${args.webhook_id}\` deleted.`);
      }

      case 'admin_webhooks_test': {
        if (!args?.webhook_id) return error('webhook_id is required');
        const data = await adminFetch(ctx, `/api/webhooks/${args.webhook_id}/test`, {
          method: 'POST',
        });
        const status = data?.status || data?.statusCode || 'sent';
        return text(`Test event sent to webhook \`${args.webhook_id}\`. Response status: ${status}`);
      }

      // ── Account ───────────────────────────────────────────────
      case 'admin_tenant_settings': {
        const data = await adminFetch(ctx, '/api/auth/tenant/settings');
        return text(`\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
      }

      case 'admin_tenant_update': {
        const body: any = {};
        if (args?.name) body.name = args.name;
        if (args?.slug) body.slug = args.slug;
        if (Object.keys(body).length === 0) return error('At least one of name or slug is required');
        await adminFetch(ctx, '/api/auth/tenant', {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        return text(`Tenant updated.${body.name ? ` Name: ${body.name}` : ''}${body.slug ? ` Slug: ${body.slug}` : ''}`);
      }

      case 'admin_profile_update': {
        const body: any = {};
        if (args?.name) body.name = args.name;
        if (args?.avatar_url) body.avatarUrl = args.avatar_url;
        if (Object.keys(body).length === 0) return error('At least one of name or avatar_url is required');
        await adminFetch(ctx, '/api/auth/me', {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        return text(`Profile updated.${body.name ? ` Name: ${body.name}` : ''}${body.avatarUrl ? ` Avatar: updated` : ''}`);
      }

      // ── Workspace Secrets ─────────────────────────────────────
      case 'admin_secrets_list': {
        if (!args?.workspace_id) return error('workspace_id is required');
        const data = await adminFetch(ctx, `/api/workspaces/${args.workspace_id}/secrets`);
        const secrets = Array.isArray(data) ? data : data.secrets || [];
        if (secrets.length === 0) return text('No secrets stored in this workspace.');
        const list = secrets.map((s: any) => `- \`${s.key || s.name}\``).join('\n');
        return text(`**${secrets.length} secret(s):**\n\n${list}`);
      }

      case 'admin_secrets_set': {
        if (!args?.workspace_id || !args?.key || !args?.value) return error('workspace_id, key, and value are required');
        await adminFetch(ctx, `/api/workspaces/${args.workspace_id}/secrets`, {
          method: 'POST',
          body: JSON.stringify({ key: args.key, value: args.value }),
        });
        return text(`Secret \`${args.key}\` stored in workspace \`${args.workspace_id}\`.`);
      }

      case 'admin_secrets_delete': {
        if (!args?.workspace_id || !args?.key) return error('workspace_id and key are required');
        if (!args?.confirm) return error('confirm must be true to delete a secret');
        await adminFetch(ctx, `/api/workspaces/${args.workspace_id}/secrets/${args.key}`, {
          method: 'DELETE',
        });
        return text(`Secret \`${args.key}\` deleted from workspace \`${args.workspace_id}\`.`);
      }

      default:
        return error(`Unknown admin tool: ${name}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
  }
}
