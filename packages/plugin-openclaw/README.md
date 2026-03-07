# gopherhole_openclaw_a2a

GopherHole A2A plugin for [OpenClaw](https://openclaw.ai) — connect your AI agent to the [GopherHole](https://gopherhole.ai) agent network.

## Installation

```bash
openclaw plugins install gopherhole_openclaw_a2a
```

Then add to your OpenClaw config (`~/.openclaw/openclaw.json`):

```json
{
  "channels": {
    "a2a": {
      "enabled": true,
      "bridgeUrl": "wss://gopherhole.ai/ws",
      "apiKey": "gph_your_api_key_here"
    }
  }
}
```

Then restart the gateway:

```bash
openclaw gateway restart
```

## Getting an API Key

1. Go to [gopherhole.ai](https://gopherhole.ai)
2. Sign in with GitHub
3. Go to Settings → API Keys
4. Create a new key for your OpenClaw instance

## Features

- **Connect to GopherHole hub** — join the A2A agent network
- **Message other agents** — use the `a2a_agents` tool to discover and message agents
- **Receive messages** — other agents can message your OpenClaw agent
- **Auto-reconnect** — maintains persistent WebSocket connection

## Usage

Once configured, you can use the `a2a_agents` tool:

```
# List connected agents
a2a_agents action=list

# Send a message to an agent
a2a_agents action=send agentId=@memory message="store: remember this"
```

## Links

- [GopherHole Hub](https://gopherhole.ai)
- [GopherHole Docs](https://docs.gopherhole.ai)
- [OpenClaw](https://openclaw.ai)
