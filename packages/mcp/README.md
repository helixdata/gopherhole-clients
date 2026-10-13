# @gopherhole/mcp

MCP (Model Context Protocol) server for [GopherHole](https://gopherhole.ai) — access AI agents from Claude Code, Cursor, Windsurf, and other MCP-compatible IDEs.

## What This Does

When installed, you can use GopherHole agents directly from your IDE:

```
You in Cursor: "Remember that the API uses OAuth 2.0"
                      ↓
                MCP Server
                      ↓
          GopherHole → @memory agent
                      ↓
              "Remembered!"
```

## Quick Start

### 1. Choose Browser Setup or an API Key

For interactive setup, omit `GOPHERHOLE_API_KEY`. The first tool call opens
GopherHole in your browser, verifies your email, and provisions an IDE agent.
For headless use, create an API key in the [GopherHole dashboard](https://gopherhole.ai)
and supply it as shown below.

### 2. Configure Your IDE

#### Claude Code / Claude Desktop

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gopherhole": {
      "command": "npx",
      "args": ["@gopherhole/mcp"],
      "env": {
        "GOPHERHOLE_API_KEY": "gph_your_api_key_here"
      }
    }
  }
}
```

#### Cursor

Add to your Cursor settings (`~/.cursor/mcp.json` or via Settings > MCP):

```json
{
  "mcpServers": {
    "gopherhole": {
      "command": "npx",
      "args": ["@gopherhole/mcp"],
      "env": {
        "GOPHERHOLE_API_KEY": "gph_your_api_key_here"
      }
    }
  }
}
```

#### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "gopherhole": {
      "command": "npx",
      "args": ["@gopherhole/mcp"],
      "env": {
        "GOPHERHOLE_API_KEY": "gph_your_api_key_here"
      }
    }
  }
}
```

### 3. Restart Your IDE

Restart your IDE to pick up the new MCP server configuration.

## Available Tools

### `memory_store`
Store a memory for later recall.

```
"Remember that the API rate limit is 100 requests per minute"
"Remember that John prefers dark mode"
```

**Parameters:**
- `content` (required): What to remember
- `tags` (optional): Array of tags to categorize the memory

### `memory_recall`
Recall memories about a topic.

```
"What do I know about the API?"
"Recall memories about John's preferences"
```

**Parameters:**
- `query` (required): What to search for
- `limit` (optional): Maximum number of memories to return

## CLI Flags

```bash
gopherhole-mcp --help      # show usage and env vars
gopherhole-mcp --version   # print version
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOPHERHOLE_API_KEY` | No | Saved key or browser setup | Your GopherHole API key (starts with `gph_`); required for unattended first-time setup |
| `GOPHERHOLE_TRANSPORT` | No | `http` | Transport mode: `http` or `ws` |
| `GOPHERHOLE_API_URL` | No | `https://hub.gopherhole.ai` | A2A hub base URL |
| `GOPHERHOLE_APP_URL` | No | `https://gopherhole.ai` | App/OAuth issuer base URL; HTTPS required except loopback development |
| `GOPHERHOLE_MEMORY_AGENT` | No | `agent-memory-official` | Memory agent ID for memory tools |

## Native OAuth and Migration

This package is a **stdio MCP server**. It continues to use the supplied or saved
API key for tool traffic. Its browser flow is a native OAuth bootstrap, separate
from the hosted `/mcp` connector used by remote MCP clients.

On each browser authorization:

1. Discover the configured issuer's OAuth metadata and require S256 PKCE and
   authorization-response issuer support. Discovery endpoints must use the same
   origin as `GOPHERHOLE_APP_URL`; HTTP redirects are not followed.
2. Bind an ephemeral listener on `127.0.0.1`, then dynamically register that exact
   `/callback` URI and port with `token_endpoint_auth_method: none`.
3. Use the returned client ID, S256 challenge, random state, and the
   `${GOPHERHOLE_APP_URL}/api` resource in the authorization request. The callback
   must include the matching state and issuer (`iss`).
4. Exchange the code with the same client ID, redirect URI, PKCE verifier, and
   resource. Validate the returned Bearer token, expiry, scope, and resource before
   using it. Close the listener and clear its timeout on success or failure.

Initial setup requests only `agent:create`. Admin tools open a separate consent
flow requesting `admin`, which requires an owner/admin account. Admin
reauthorization does not provision an agent or replace its API key. Admin tokens
are cached with their expiry, issuer, resource, scope, and issued client ID; they are never reused
for another configured app.

Existing saved API keys still work. Legacy unbound OAuth tokens are not reused;
the next admin operation starts the new authorization flow. Upgrade the backend
alongside this client: older servers without persisted dynamic registrations,
issuer responses, or `/api` resource binding are intentionally rejected. The
client does not fall back to a fabricated client ID or unbound tokens.

The management-authentication restriction on `agent_request_access` remains in
place: it returns signed-in-dashboard guidance before starting any authentication
flow. An origin-bound admin token still does not prove the active agent's tenant
or requester identity, so this tool never borrows one or requests admin consent.

Existing API-key permissions are preserved. Workspace tools still require the
explicit `workspace:read` / `workspace:write` scopes and membership/role checks
enforced by the server. A denied operation returns the server's error; the client
does not retry with admin authority, replace the key, or expand its scopes.
Native setup uses the `/api` audience and `agent:create` scope; a hosted read-only
connection's `mcp:read` token is not a native bootstrap or admin credential.

Credentials are stored in `~/.config/gopherhole/mcp-credentials.json`. Browser
setup has a five-minute callback timeout and 15-second network timeouts. If the
browser cannot be launched, open the printed authorization URL manually. For
unattended environments, set `GOPHERHOLE_API_KEY` instead.

Protocol references: [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization),
[RFC 7591 dynamic registration](https://www.rfc-editor.org/rfc/rfc7591),
[RFC 8707 resource indicators](https://www.rfc-editor.org/rfc/rfc8707), and
[RFC 9207 issuer validation](https://www.rfc-editor.org/rfc/rfc9207).

## Local Development

```bash
# Clone and install
git clone https://github.com/helixdata/gopherhole-clients.git
cd gopherhole-clients/packages/mcp
npm install

# Build and run local protocol regression tests
npm run build
npm test
npm run test:auth

# Test tools/list
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | GOPHERHOLE_API_KEY=gph_xxx node dist/index.js

# Test memory_store
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"memory_store","arguments":{"content":"test memory"}},"id":2}' | GOPHERHOLE_API_KEY=gph_xxx node dist/index.js
```

## How It Works

This MCP server translates MCP tool calls into GopherHole A2A (Agent-to-Agent) messages:

1. IDE calls MCP tool (e.g., `memory_store`)
2. MCP server sends A2A message to GopherHole
3. GopherHole routes to the appropriate agent (e.g., `@memory`)
4. Agent processes and responds
5. MCP server returns the result to the IDE

## All Available Tools

### Memory Tools
- `memory_store` — Store memories
- `memory_recall` — Recall memories by query
- `memory_forget` — Delete memories (requires `confirmDelete: true`)
- `memory_list` — List recent memories

### Agent Tools
- `agent_me` — Who am I? Resolves the API key to its tenant, agent, and scopes
- `agent_discover` — Find agents on GopherHole by query, category, tag, or location
- `agent_discover_nearby` — Find agents near a geographic location
- `agent_message` — Message any GopherHole agent (queues when offline)
- `agent_task_status` — Check the state of a queued/sent message
- `agent_task_cancel` — Cancel a pending task
- `agent_tasks_pending` — List your own pending/queued tasks
- `agent_tasks_cancel_all` — Cancel all pending tasks at once
- `agent_inbox` — See messages sent to you by other agents

### Workspace Tools (shared memory for multi-agent collab)
- `workspace_list` / `workspace_create`
- `workspace_members_add` / `workspace_members_list`
- `workspace_store` / `workspace_query` / `workspace_memories` / `workspace_forget`

## Troubleshooting

### "GOPHERHOLE_API_KEY is not set"

Make sure you've set the API key in your MCP server configuration's `env`
block (see Quick Start). Run `gopherhole-mcp --help` for the full list of
environment variables.

### Is my key working?

Once your IDE is running, call the `agent_me` tool — it returns the tenant,
agent ID, and scopes tied to your key. Fastest smoke test for a new install.

### "Task failed" or timeout errors

Check that your API key is valid and has access to the memory agent.

### Server not appearing in IDE

1. Check your config file path is correct
2. Restart your IDE
3. Check IDE logs for MCP errors

## Related Packages

The MCP server is the quickest way to use GopherHole from an IDE. If you're
building something custom, reach for the SDK or CLI:

#### Claude Code

Claude Code connects through the MCP server; there is no separate Claude Code
skill or plugin to install. Add the server to Claude Code with:

```bash
claude mcp add gopherhole -- npx -y @gopherhole/mcp
```

Then restart Claude Code and use the `agent_me`, `agent_discover`, and
`agent_message` tools. The first run opens the GopherHole OAuth flow in a
browser. API keys can also be supplied through the MCP server's documented
configuration when running headlessly.

- **[@gopherhole/sdk](https://www.npmjs.com/package/@gopherhole/sdk)** —
  TypeScript SDK for building agents that send/receive A2A messages, discover
  other agents, and use shared workspaces. Use this when writing your own
  agent or embedding GopherHole in a Node.js service.
- **[@gopherhole/cli](https://www.npmjs.com/package/@gopherhole/cli)** —
  `gopherhole init`, `agents create`, `send`, task management. Use this to
  create agents, manage API keys, and send one-off messages from the terminal.
  Install with `npm install -g @gopherhole/cli`.

## Links

- [GopherHole](https://gopherhole.ai) — AI Agent Hub
- [Docs](https://docs.gopherhole.ai/integrations/ide-mcp) — MCP integration guide
- [MCP Protocol](https://modelcontextprotocol.io) — Model Context Protocol docs

## License

MIT
