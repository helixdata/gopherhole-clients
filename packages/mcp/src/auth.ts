/**
 * OAuth bootstrap flow for GopherHole MCP.
 *
 * When no API key is available, opens a browser to authenticate via OTP,
 * catches the OAuth callback on a local HTTP server, exchanges the code
 * for an access token, and provisions an MCP agent.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const CREDENTIALS_DIR = join(homedir(), '.config', 'gopherhole');
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, 'mcp-credentials.json');

interface StoredCredentials {
  apiKey: string;
  agentId: string;
  alias: string;
  ide: string;
  createdAt: string;
}

export function loadStoredApiKey(): string | null {
  try {
    if (!existsSync(CREDENTIALS_FILE)) return null;
    const data = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf-8')) as StoredCredentials;
    return data.apiKey || null;
  } catch {
    return null;
  }
}

function storeCredentials(creds: StoredCredentials): void {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

function base64url(buf: Buffer): string {
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function detectIde(): string {
  const env = process.env;
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return 'claude-code';
  if (env.CURSOR_SESSION_ID || env.CURSOR_TRACE_ID) return 'cursor';
  if (env.WINDSURF_SESSION_ID) return 'windsurf';
  if (env.TERM_PROGRAM === 'vscode' || env.VSCODE_PID) return 'vscode';
  return 'mcp';
}

/**
 * Run the OAuth browser flow and return an API key.
 * Exits the process if the user cancels or auth fails.
 */
export async function bootstrapAuth(appUrl: string): Promise<string> {
  const ide = detectIde();
  const { verifier, challenge } = generatePKCE();
  const state = base64url(randomBytes(16));

  // Start local HTTP server to catch the callback
  const { port, waitForCallback, close } = await startCallbackServer();

  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const clientId = `gopherhole-mcp-${ide}`;

  const authorizeUrl = new URL(`${appUrl}/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'agent:create');

  // Open browser
  console.error('');
  console.error('  GopherHole MCP: No API key found. Opening browser to authenticate...');
  console.error(`  If the browser doesn't open, visit:`);
  console.error(`  ${authorizeUrl.toString()}`);
  console.error('');

  await openBrowser(authorizeUrl.toString());

  // Wait for OAuth callback
  let callbackResult: { code: string; state: string };
  try {
    callbackResult = await waitForCallback();
  } catch (err) {
    console.error('  Authentication failed or was cancelled.');
    close();
    process.exit(1);
  }

  close();

  if (callbackResult.state !== state) {
    console.error('  OAuth state mismatch — possible CSRF attack. Aborting.');
    process.exit(1);
  }

  // Exchange code for access token
  console.error('  Exchanging authorization code...');

  const tokenRes = await fetch(`${appUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: callbackResult.code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({})) as { error_description?: string };
    console.error(`  Token exchange failed: ${err.error_description || tokenRes.statusText}`);
    process.exit(1);
  }

  const tokenData = await tokenRes.json() as { access_token: string };

  // Create/retrieve MCP agent
  console.error('  Provisioning agent...');

  const agentRes = await fetch(`${appUrl}/oauth/mcp/agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenData.access_token}`,
    },
    body: JSON.stringify({ ide }),
  });

  if (!agentRes.ok) {
    const err = await agentRes.json().catch(() => ({})) as { error?: string };
    console.error(`  Agent provisioning failed: ${err.error || agentRes.statusText}`);
    process.exit(1);
  }

  const agentData = await agentRes.json() as {
    agent_id: string;
    alias: string;
    api_key: string | null;
    created: boolean;
  };

  if (!agentData.api_key) {
    console.error('  Agent exists but API key is unavailable. Regenerate via the GopherHole dashboard.');
    process.exit(1);
  }

  // Store credentials
  storeCredentials({
    apiKey: agentData.api_key,
    agentId: agentData.agent_id,
    alias: agentData.alias,
    ide,
    createdAt: new Date().toISOString(),
  });

  console.error(`  Authenticated! Agent: @${agentData.alias} (${agentData.agent_id})`);
  console.error(`  Credentials saved to ${CREDENTIALS_FILE}`);
  console.error('');

  return agentData.api_key;
}

// ============================================
// Local HTTP callback server
// ============================================

function startCallbackServer(): Promise<{
  port: number;
  waitForCallback: () => Promise<{ code: string; state: string }>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    let callbackResolve: (value: { code: string; state: string }) => void;
    let callbackReject: (reason: Error) => void;
    const callbackPromise = new Promise<{ code: string; state: string }>((res, rej) => {
      callbackResolve = res;
      callbackReject = rej;
    });

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://127.0.0.1`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(callbackHtml(false, error));
          callbackReject(new Error(error));
          return;
        }

        if (code && state) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(callbackHtml(true));
          callbackResolve({ code, state });
          return;
        }

        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing code or state');
        return;
      }

      res.writeHead(404);
      res.end();
    });

    // Listen on random available port
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to start callback server'));
        return;
      }
      resolve({
        port: addr.port,
        waitForCallback: () => callbackPromise,
        close: () => server.close(),
      });
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      callbackReject(new Error('Authentication timed out'));
      server.close();
    }, 5 * 60 * 1000);
  });
}

// ============================================
// Browser opener (cross-platform)
// ============================================

async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('node:child_process');
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open'
    : platform === 'win32' ? 'start ""'
    : 'xdg-open';

  exec(`${cmd} "${url}"`, (err) => {
    if (err) {
      // Swallow — user can manually visit the URL (printed above)
    }
  });
}

// ============================================
// Callback page HTML
// ============================================

function callbackHtml(success: boolean, error?: string): string {
  const title = success ? 'Connected!' : 'Authentication Failed';
  const message = success
    ? 'GopherHole is now connected to your IDE. You can close this tab.'
    : `Something went wrong: ${error || 'Unknown error'}. Please try again from your IDE.`;
  const color = success ? '#10b981' : '#ef4444';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${title} — GopherHole</title>
<style>
  body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .c{text-align:center;max-width:400px;padding:2rem}
  h1{color:${color};margin-bottom:0.5rem}
  p{color:#999;font-size:0.95rem}
</style></head>
<body><div class="c">
  <h1>${title}</h1>
  <p>${message}</p>
</div></body></html>`;
}
