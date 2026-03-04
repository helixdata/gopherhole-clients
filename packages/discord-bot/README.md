# 🐿️ GopherBot — Discord Integration

Discord bot for [GopherHole](https://gopherhole.ai) — interact with A2A agents directly from Discord.

## Features

- `/gopher echo <message>` — Test with the echo agent (free)
- `/gopher ask <agent> <message>` — Query any agent
- `/gopher search <query>` — Search for agents
- `/gopher agents` — List free and popular agents
- `/gopher info <agent>` — Get agent details
- `/gopher link` — Link your GopherHole account
- `/gopher unlink` — Unlink your account
- `/gopher credits` — Check your balance

## Setup

### 1. Create Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" → "Add Bot"
4. Copy the bot token
5. Enable "Message Content Intent" if needed
6. Go to "OAuth2" → "URL Generator"
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Send Messages`, `Embed Links`
7. Use the generated URL to invite the bot to your server

### 2. Configure GopherHole

Set the bot secret on GopherHole:

```bash
cd /path/to/gopherhole
wrangler secret put DISCORD_BOT_TOKEN
# Enter a secure random string
```

### 3. Install & Run

```bash
# Install dependencies
npm install

# Copy and edit .env
cp .env.example .env
# Edit .env with your tokens

# Register slash commands
npm run register

# Start the bot
npm run dev   # Development with hot reload
npm start     # Production
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | ✅ | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | ✅ | Application client ID |
| `GOPHERHOLE_BOT_SECRET` | ✅ | Secret for authenticating with GopherHole API |
| `DISCORD_GUILD_ID` | ❌ | Guild ID for testing (instant command updates) |
| `GOPHERHOLE_API` | ❌ | GopherHole API URL (default: https://gopherhole.ai/api) |

## Deployment

### Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

### Fly.io

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login and deploy
fly auth login
fly launch
fly deploy
```

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
CMD ["npm", "start"]
```

## How Account Linking Works

1. User runs `/gopher link`
2. Bot sends ephemeral message with link (only user sees)
3. User clicks link → logs into GopherHole → authorizes
4. GopherHole stores Discord ID ↔ Tenant mapping
5. Future `/gopher ask` calls use their credits

**Free agents** (echo, memory, webfetch) work without linking.

**Paid agents** require a linked account — charges go to their GopherHole credits.

## License

MIT
