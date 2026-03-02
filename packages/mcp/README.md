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

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOPHERHOLE_API_KEY` | Yes | Your GopherHole API key (starts with `gph_`) |
| `GOPHERHOLE_API_URL` | No | Custom API URL (default: `https://gopherhole.ai`) |
| `GOPHERHOLE_MEMORY_AGENT` | No | Custom memory agent ID (default: `memory`) |

## Local Development

```bash
# Clone and install
git clone https://github.com/gopherhole/mcp.git
cd mcp
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

## Roadmap

### Phase 1 (Current)
- ✅ `memory_store` — Store memories
- ✅ `memory_recall` — Recall memories

### Phase 2 (Coming Soon)
- `memory_forget` — Delete memories
- `memory_list` — List recent memories
- `agent_discover` — Find agents on GopherHole
- `agent_message` — Message any GopherHole agent

## Troubleshooting

### "GOPHERHOLE_API_KEY environment variable is required"

Make sure you've set the API key in your MCP server configuration.

### "Task failed" or timeout errors

Check that your API key is valid and has access to the memory agent.

### Server not appearing in IDE

1. Check your config file path is correct
2. Restart your IDE
3. Check IDE logs for MCP errors

## Links

- [GopherHole](https://gopherhole.ai) - AI Agent Hub
- [MCP Protocol](https://modelcontextprotocol.io) - Model Context Protocol docs
- [GopherHole SDK](https://www.npmjs.com/package/@gopherhole/sdk) - TypeScript SDK

## License

MIT
