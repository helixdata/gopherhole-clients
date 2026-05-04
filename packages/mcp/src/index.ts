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

import { GopherHole, TransportMode, getTaskResponseText } from '@gopherhole/sdk';
import type { MemoryType } from '@gopherhole/sdk';
import { ALL_TOOLS } from './tools.js';
import { loadStoredApiKey, loadStoredAccessToken, bootstrapAuth } from './auth.js';
import { handleAdminTool } from './admin.js';

const VERSION = '0.9.0';

// Default memory agent ID (can be overridden via env)
const MEMORY_AGENT_ID = process.env.GOPHERHOLE_MEMORY_AGENT || 'agent-memory-official';

const HELP_TEXT = `gopherhole-mcp v${VERSION}

MCP server for GopherHole — exposes GopherHole agents as tools for Claude
Code, Cursor, and other MCP-compatible IDEs.

USAGE
  gopherhole-mcp [--help] [--version]

AUTHENTICATION
  On first run, a browser window will open for email verification.
  Your API key is saved to ~/.config/gopherhole/mcp-credentials.json.
  Subsequent runs use the stored key automatically.

  To skip auto-registration, set GOPHERHOLE_API_KEY manually.

ENVIRONMENT
  GOPHERHOLE_API_KEY       API key (auto-provisioned if not set)
  GOPHERHOLE_TRANSPORT     http | ws            (default: http)
  GOPHERHOLE_API_URL       Hub base URL         (default: https://hub.gopherhole.ai)
  GOPHERHOLE_APP_URL       App base URL         (default: https://gopherhole.ai)
  GOPHERHOLE_MEMORY_AGENT  Default memory agent (default: agent-memory-official)

EXAMPLE (Claude Desktop / Code mcp.json)
  {
    "mcpServers": {
      "gopherhole": {
        "command": "npx",
        "args": ["-y", "@gopherhole/mcp"]
      }
    }
  }

DOCS
  https://docs.gopherhole.ai/integrations/ide-mcp
`;

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
  // CLI flags (stdout is reserved for MCP protocol only when running as a
  // server — flags exit before we connect the transport, so stdout is safe)
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }

  // Resolve API key: env var → stored credentials (don't block on OAuth yet)
  const appUrl = process.env.GOPHERHOLE_APP_URL || 'https://gopherhole.ai';
  let apiKey = process.env.GOPHERHOLE_API_KEY || loadStoredApiKey();

  const transportMode = (process.env.GOPHERHOLE_TRANSPORT || 'http') as TransportMode;
  const apiUrl = process.env.GOPHERHOLE_API_URL || 'https://hub.gopherhole.ai';
  const hubUrl = apiUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws';

  // Client initialized lazily after auth completes
  let client: GopherHole | null = apiKey ? new GopherHole({
    apiKey,
    hubUrl,
    transport: transportMode,
    autoReconnect: false,
  }) : null;

  // Track background auth state
  let authInProgress = false;
  let authError: string | null = null;

  async function ensureClient(): Promise<GopherHole> {
    if (client) return client;

    if (!authInProgress) {
      authInProgress = true;
      authError = null;
      bootstrapAuth(appUrl).then((result) => {
        apiKey = result.apiKey;
        client = new GopherHole({
          apiKey: result.apiKey,
          hubUrl,
          transport: transportMode,
          autoReconnect: false,
        });
        authInProgress = false;
        console.error('  GopherHole: Authentication complete. Tools are now available.');
      }).catch((err) => {
        authError = err instanceof Error ? err.message : String(err);
        authInProgress = false;
      });
    }

    throw new Error(
      authInProgress
        ? 'GopherHole is waiting for authentication. A browser window has been opened — please complete email verification, then retry this tool call.'
        : `Authentication failed: ${authError}. Remove ~/.config/gopherhole/mcp-credentials.json and try again.`
    );
  }

  // Create MCP server
  const server = new Server(
    {
      name: 'gopherhole',
      version: VERSION,
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

    // Route admin_* tools to the admin handler (uses OAuth access token)
    if (name.startsWith('admin_')) {
      return handleAdminTool(name, args as Record<string, any> | undefined, { appUrl, apiUrl });
    }

    try {
      const gopherhole = await ensureClient();
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
          const response = await gopherhole.askText(MEMORY_AGENT_ID, message);
          
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
          const response = await gopherhole.askText(MEMORY_AGENT_ID, message);
          
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

          const response = await gopherhole.askText(MEMORY_AGENT_ID, `Forget memories matching: ${query}`);
          
          return {
            content: [{ type: 'text', text: response || 'Memories deleted' }],
          };
        }

        case 'memory_list': {
          const limit = args?.limit as number || 20;
          const offset = args?.offset as number || 0;
          
          const response = await gopherhole.askText(
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
          
          const result = await gopherhole.discover({ query, category, tag, skillTag, contentMode, owner, verified, sort: sort as any, limit, offset, scope: scope as any });
          
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

        case 'agent_me': {
          // Call /api/auth/whoami on the app host to resolve the calling
          // API key to its identity (tenant + agent + scopes).
          try {
            const res = await fetch(`${appUrl}/api/auth/whoami`, {
              headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (!res.ok) {
              return {
                content: [{
                  type: 'text',
                  text: `whoami failed: HTTP ${res.status} ${res.statusText}`,
                }],
                isError: true,
              };
            }
            const data = (await res.json()) as any;
            if (data?.type === 'api_key') {
              const t = data.tenant || {};
              const k = data.apiKey || {};
              const a = data.agent || null;
              const scopes = Array.isArray(k.scopes) ? k.scopes.join(', ') : 'none';
              const lines = [
                `**Agent:** ${k.agentId || '(none)'}`,
                `**Tenant:** ${t.name || t.id || '(unknown)'}${t.slug ? ` (${t.slug})` : ''}${t.plan ? ` — ${t.plan}` : ''}`,
                `**API Key:** ${k.name || k.prefix || k.id} (${k.prefix || ''})`,
                `**Scopes:** ${scopes}`,
              ];
              // Surface the agent's email so the LLM can offer/share it
              // with the user. Send outbound via the "postie" alias.
              if (a && a.emailAddress) {
                lines.push(`**Email:** ${a.emailAddress} (send via "postie", receive at this address)`);
              } else if (a && a.alias && !a.emailEnabled) {
                lines.push(`**Email:** disabled — alias "${a.alias}" is set; enable with \`gopherhole agents config ${k.agentId} --email-enabled\``);
              } else if (a && !a.alias) {
                lines.push(`**Email:** not configured — set an alias with \`gopherhole agents config ${k.agentId} --alias <handle>\`, then enable with \`--email-enabled\``);
              }
              if (k.lastUsedAt) lines.push(`**Last used:** ${new Date(k.lastUsedAt).toISOString()}`);
              if (k.expiresAt) lines.push(`**Expires:** ${new Date(k.expiresAt).toISOString()}`);
              return { content: [{ type: 'text', text: lines.join('\n') }] };
            }
            // Unexpected for MCP (no session cookie) but handle gracefully
            return {
              content: [{ type: 'text', text: `Identity:\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`` }],
            };
          } catch (err) {
            return {
              content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
              isError: true,
            };
          }
        }

        case 'agent_message': {
          const agentId = args?.agentId as string;
          const message = args?.message as string;
          const ttl = args?.ttl as number | undefined;
          const contextId = args?.contextId as string | undefined;
          
          if (!agentId || !message) {
            return {
              content: [{ type: 'text', text: 'Error: agentId and message are required' }],
              isError: true,
            };
          }

          // Build send options
          const sendOpts: Record<string, unknown> = {};
          if (ttl !== undefined) sendOpts.ttl = ttl;
          if (contextId) sendOpts.contextId = contextId;
          const opts = Object.keys(sendOpts).length > 0 ? sendOpts : undefined;

          // Send the message — returns a task immediately
          const task = await gopherhole.sendText(agentId, message, opts as any);
          const taskContextId = (task as any).contextId || contextId || '';

          // If the agent is offline and the message was queued, return
          // immediately instead of hanging for 60s waiting for a reply
          if (task.status?.state === 'submitted') {
            return {
              content: [{
                type: 'text',
                text: `Message queued — agent "${agentId}" is currently offline. ` +
                  `The message will be delivered when they reconnect` +
                  (ttl ? ` (TTL: ${ttl}s).` : ' (TTL: 30 days).') +
                  `\n\nTask ID: ${task.id}` +
                  (taskContextId ? `\nContext ID: ${taskContextId}` : ''),
              }],
            };
          }

          // Agent is online — wait for the response as normal
          try {
            const completed = await gopherhole.waitForTask(task.id, { maxWaitMs: 60_000 });
            const responseText = getTaskResponseText(completed);
            const ctxInfo = taskContextId ? `\n\nContext ID: ${taskContextId} (use this to continue the conversation)` : '';
            return {
              content: [{ type: 'text', text: (responseText || 'No response from agent') + ctxInfo }],
            };
          } catch (err) {
            return {
              content: [{
                type: 'text',
                text: `Message sent to "${agentId}" but response timed out.\n\nTask ID: ${task.id}` +
                  (taskContextId ? `\nContext ID: ${taskContextId}` : ''),
              }],
              isError: true,
            };
          }
        }

        case 'agent_task_status': {
          const taskId = args?.taskId as string;
          if (!taskId) {
            return {
              content: [{ type: 'text', text: 'Error: taskId is required' }],
              isError: true,
            };
          }

          try {
            const task = await gopherhole.getTask(taskId);
            const state = task.status?.state || 'unknown';
            const responseText = getTaskResponseText(task);

            let summary = `Task ${taskId}: **${state}**`;
            if (task.status?.timestamp) {
              summary += ` (${task.status.timestamp})`;
            }
            if (state === 'completed' && responseText) {
              summary += `\n\nResponse:\n${responseText}`;
            } else if (state === 'failed') {
              const failMsg = task.status?.message;
              summary += `\n\nError: ${typeof failMsg === 'string' ? failMsg : 'Unknown error'}`;
            } else if (state === 'submitted') {
              summary += `\n\nMessage is queued — recipient hasn't come online yet.`;
            } else if (state === 'working') {
              summary += `\n\nMessage delivered — waiting for response.`;
            }

            return {
              content: [{ type: 'text', text: summary }],
            };
          } catch (err) {
            return {
              content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
              isError: true,
            };
          }
        }

        case 'agent_task_cancel': {
          const taskId = args?.taskId as string;
          if (!taskId) {
            return {
              content: [{ type: 'text', text: 'Error: taskId is required' }],
              isError: true,
            };
          }

          try {
            const task = await gopherhole.cancelTask(taskId);
            return {
              content: [{ type: 'text', text: `Task ${taskId} canceled. Any queued messages have been purged.` }],
            };
          } catch (err) {
            return {
              content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
              isError: true,
            };
          }
        }

        case 'agent_inbox': {
          const limit = (args?.limit as number) || 10;
          try {
            // List recent tasks
            const result = await gopherhole.listTasks({ pageSize: limit, sortOrder: 'desc' } as any);
            const tasks = result.tasks || [];

            if (tasks.length === 0) {
              return { content: [{ type: 'text', text: 'No tasks found.' }] };
            }

            // Fetch full task details (listTasks may omit artifacts)
            const detailed = await Promise.all(
              tasks.slice(0, limit).map(async (t: any) => {
                try {
                  return await gopherhole.getTask(t.id);
                } catch {
                  return t; // fallback to list data
                }
              })
            );

            const lines = detailed.map((t: any) => {
              const state = t.status?.state || 'unknown';
              const from = t.clientAgentId || t.serverAgentId || 'unknown';

              // Extract the original message (first user message in history)
              const originalMsg = t.history?.find((m: any) => m.role === 'user');
              const originalText = originalMsg?.parts
                ?.filter((p: any) => p.kind === 'text')
                .map((p: any) => p.text)
                .join(' ') || '';

              // Extract the response (artifacts from server agent)
              const responseText = getTaskResponseText(t);
              // Avoid showing original as response — only show if different
              const hasRealResponse = responseText && responseText !== originalText;

              let line = `• **${t.id}** — ${state}`;
              if (t.status?.timestamp) line += ` (${t.status.timestamp})`;
              line += `\n  From: ${from}`;
              if (originalText) line += `\n  Message: ${originalText.slice(0, 150)}`;
              if (hasRealResponse) line += `\n  Reply: ${responseText.slice(0, 200)}`;
              else if (state === 'submitted') line += `\n  ⏳ Queued`;
              else if (state === 'working') line += `\n  ⚙️ Delivered, awaiting reply`;

              return line;
            });

            return {
              content: [{
                type: 'text',
                text: `**${detailed.length} recent task(s):**\n\n${lines.join('\n\n')}`,
              }],
            };
          } catch (err) {
            return {
              content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
              isError: true,
            };
          }
        }

        case 'agent_tasks_pending': {
          const limit = (args?.limit as number) || 20;
          try {
            const result = await gopherhole.listTasks({ status: 'submitted', pageSize: limit } as any);
            const tasks = result.tasks || [];
            if (tasks.length === 0) {
              return {
                content: [{ type: 'text', text: 'No pending tasks.' }],
              };
            }
            const lines = tasks.map((t: any) => {
              const age = Date.now() - new Date(t.status?.timestamp || 0).getTime();
              const ageMins = Math.round(age / 60000);
              return `• **${t.id}** → ${t.serverAgentId || 'unknown'} (queued ${ageMins}m ago)`;
            });
            return {
              content: [{ type: 'text', text: `**${tasks.length} pending task(s):**\n\n${lines.join('\n')}` }],
            };
          } catch (err) {
            return {
              content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
              isError: true,
            };
          }
        }

        case 'agent_tasks_cancel_all': {
          if (!args?.confirm) {
            return {
              content: [{ type: 'text', text: 'Error: set confirm=true to cancel all pending tasks.' }],
              isError: true,
            };
          }
          try {
            const result = await gopherhole.listTasks({ status: 'submitted', pageSize: 100 } as any);
            const tasks = result.tasks || [];
            if (tasks.length === 0) {
              return {
                content: [{ type: 'text', text: 'No pending tasks to cancel.' }],
              };
            }
            let canceled = 0;
            let failed = 0;
            for (const t of tasks) {
              try {
                await gopherhole.cancelTask(t.id);
                canceled++;
              } catch {
                failed++;
              }
            }
            return {
              content: [{
                type: 'text',
                text: `Canceled ${canceled} task(s).` + (failed > 0 ? ` ${failed} failed to cancel.` : '') + ' All queued messages purged.',
              }],
            };
          } catch (err) {
            return {
              content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
              isError: true,
            };
          }
        }

        case 'agent_discover_nearby': {
          const lat = args?.lat as number;
          const lng = args?.lng as number;
          const radius = args?.radius as number | undefined;
          const tag = args?.tag as string | undefined;
          const category = args?.category as string | undefined;
          const limit = args?.limit as number | undefined;
          
          if (lat === undefined || lng === undefined) {
            return {
              content: [{ type: 'text', text: 'Error: lat and lng are required' }],
              isError: true,
            };
          }

          const result = await gopherhole.discoverNearby({ lat, lng, radius, tag, category, limit });
          
          if (result.agents.length === 0) {
            return {
              content: [{ type: 'text', text: `No agents found within ${result.radius}km of (${lat}, ${lng})` }],
            };
          }

          const agentList = result.agents.map(a => 
            `• **${a.name}** (${a.id}) - ${a.distance}km away\n  📍 ${a.location.name}\n  ${a.description || 'No description'}\n  Rating: ${a.avgRating.toFixed(1)} ⭐`
          ).join('\n\n');
          
          return {
            content: [{ type: 'text', text: `Found ${result.count} agents within ${result.radius}km:\n\n${agentList}` }],
          };
        }

        // ============================================================
        // WORKSPACE TOOLS
        // ============================================================

        case 'workspace_list': {
          const result = await gopherhole.workspaceList();
          
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

          const result = await gopherhole.workspaceCreate(wsName, description);
          
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

          await gopherhole.workspaceMembersAdd(workspaceId, agentId, role);
          
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

          const result = await gopherhole.workspaceMembersList(workspaceId);
          
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

          const result = await gopherhole.workspaceStore({
            workspace_id: workspaceId,
            content,
            type: memType ?? 'fact',
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

          const result = await gopherhole.workspaceQuery({
            workspace_id: workspaceId,
            query,
            type: memType as MemoryType | undefined,
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

          const result = await gopherhole.workspaceMemories({
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

          const result = await gopherhole.workspaceForget({
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
