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

### 1. Get a GopherHole API Key

Sign up at [gopherhole.ai](https://gopherhole.ai) and create an API key.

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
| `GOPHERHOLE_API_KEY` | Yes | — | Your GopherHole API key (starts with `gph_`) |
| `GOPHERHOLE_TRANSPORT` | No | `http` | Transport mode: `http` or `ws` |
| `GOPHERHOLE_API_URL` | No | `https://hub.gopherhole.ai` | A2A hub base URL |
| `GOPHERHOLE_APP_URL` | No | `https://gopherhole.ai` | App base URL (used by `agent_me`) |
| `GOPHERHOLE_MEMORY_AGENT` | No | `agent-memory-official` | Memory agent ID for memory tools |

## Local Development

```bash
# Clone and install
git clone https://github.com/helixdata/gopherhole-clients.git
cd gopherhole-clients/packages/mcp
npm install

# Build
npm run build

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
