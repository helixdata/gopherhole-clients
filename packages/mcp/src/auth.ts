/**
 * Native OAuth bootstrap for the stdio MCP server. Tool traffic still uses an
 * API key; OAuth is used only to provision it or explicitly authorize admin tools.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const CREDENTIALS_DIR = join(homedir(), '.config', 'gopherhole');
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, 'mcp-credentials.json');
const HTTP_TIMEOUT_MS = 15_000;

interface StoredCredentials {
  apiKey?: string;
  agentId?: string;
  alias?: string;
  ide?: string;
  createdAt?: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
  accessTokenIssuer?: string;
  accessTokenResource?: string;
  accessTokenScope?: string;
  // Retained for client-bound revocation; never use a client ID as authority.
  accessTokenClientId?: string;
}

function readCredentials(): StoredCredentials | null {
  try {
    if (!existsSync(CREDENTIALS_FILE)) return null;
    const value: unknown = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf-8'));
    return isObject(value) ? value as StoredCredentials : null;
  } catch {
    return null;
  }
}

export function loadStoredApiKey(): string | null {
  const key = readCredentials()?.apiKey;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

export function loadStoredAccessToken(appUrl: string): string | null {
  try {
    const data = readCredentials();
    const issuer = normalizeAppUrl(appUrl);
    if (!data || !isNonemptyString(data.accessToken) || !data.accessTokenExpiresAt) return null;
    const expiry = Date.parse(data.accessTokenExpiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return null;
    // Legacy unbound OAuth tokens must be refreshed, but saved API keys still work.
    if (data.accessTokenIssuer !== issuer || data.accessTokenResource !== `${issuer}/api`) return null;
    if (!hasScopes(data.accessTokenScope, 'admin')) return null;
    return data.accessToken;
  } catch {
    return null;
  }
}

export function storeAccessToken(accessToken: string, expiresIn: number, appUrl: string, scope: string, clientId: string): void {
  const issuer = normalizeAppUrl(appUrl);
  storeCredentials({
    ...readCredentials(),
    accessToken,
    accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    accessTokenIssuer: issuer,
    accessTokenResource: `${issuer}/api`,
    accessTokenScope: scope,
    accessTokenClientId: clientId,
  });
}

/** Explicit admin step-up: never creates or replaces an agent/API key. */
export async function refreshAdminToken(appUrl: string): Promise<{ accessToken: string; expiresAt: string }> {
  const token = await authorizeNative(appUrl, 'admin');
  storeAccessToken(token.access_token, token.expires_in, appUrl, token.scope, token.clientId);
  return { accessToken: token.access_token, expiresAt: token.expiresAt };
}

function storeCredentials(creds: StoredCredentials): void {
  if (!existsSync(CREDENTIALS_DIR)) mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasScopes(value: unknown, required: string): value is string {
  if (typeof value !== 'string') return false;
  const scopes = new Set(value.split(' '));
  return required.split(' ').every(scope => scopes.has(scope));
}

function matchesScopes(value: unknown, expected: string): value is string {
  return hasScopes(value, expected) && new Set(value.split(' ')).size === new Set(expected.split(' ')).size;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

/** HTTPS is mandatory except for explicitly configured loopback development. */
function normalizeAppUrl(appUrl: string): string {
  const url = new URL(appUrl);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.href.includes('?') || url.href.includes('#')) {
    throw new Error('GOPHERHOLE_APP_URL must be an HTTPS URL without credentials, query, or fragment (HTTP loopback is allowed for local development).');
  }
  return url.href.replace(/\/+$/, '');
}

function trustedEndpoint(value: unknown, issuer: string): string {
  if (!isNonemptyString(value)) throw new Error('OAuth metadata is missing a required endpoint.');
  const url = new URL(value);
  // This first-party native bootstrap deliberately supports only same-origin
  // endpoints. Do not leak codes or tokens through discovery or HTTP redirects.
  if (url.origin !== new URL(issuer).origin || url.username || url.password || url.href.includes('#')) {
    throw new Error('OAuth metadata contains an untrusted endpoint.');
  }
  return url.href;
}

async function fetchJson(url: string, options: RequestInit, operation: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${operation} failed (HTTP ${response.status}).`);
  if (!isObject(data)) throw new Error(`${operation} returned an invalid JSON response.`);
  return data;
}

interface AuthorizationMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
}

async function discoverAuthorizationServer(issuer: string): Promise<AuthorizationMetadata> {
  const issuerUrl = new URL(issuer);
  const metadataUrl = `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname === '/' ? '' : issuerUrl.pathname}`;
  const metadata = await fetchJson(metadataUrl, { headers: { Accept: 'application/json' } }, 'OAuth discovery');
  if (metadata.issuer !== issuer) throw new Error('OAuth metadata issuer mismatch.');
  if (!isStringArray(metadata.code_challenge_methods_supported) || !metadata.code_challenge_methods_supported.includes('S256')) {
    throw new Error('OAuth server must advertise PKCE S256 support.');
  }
  if (metadata.authorization_response_iss_parameter_supported !== true) {
    throw new Error('OAuth server must advertise authorization response issuer support.');
  }
  return {
    issuer,
    authorizationEndpoint: trustedEndpoint(metadata.authorization_endpoint, issuer),
    tokenEndpoint: trustedEndpoint(metadata.token_endpoint, issuer),
    registrationEndpoint: trustedEndpoint(metadata.registration_endpoint, issuer),
  };
}

function detectIde(): string {
  const env = process.env;
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return 'claude-code';
  if (env.CURSOR_SESSION_ID || env.CURSOR_TRACE_ID) return 'cursor';
  if (env.WINDSURF_SESSION_ID) return 'windsurf';
  if (env.TERM_PROGRAM === 'vscode' || env.VSCODE_PID) return 'vscode';
  return 'mcp';
}

interface NativeToken {
  clientId: string;
  access_token: string;
  expires_in: number;
  scope: string;
  expiresAt: string;
}

async function authorizeNative(appUrl: string, scope: string): Promise<NativeToken> {
  const issuer = normalizeAppUrl(appUrl);
  const resource = `${issuer}/api`;
  const metadata = await discoverAuthorizationServer(issuer);
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(32).toString('base64url');
  const callback = await startCallbackServer(state, metadata.issuer);

  try {
    // Register only after listen() has selected and bound the actual port.
    const redirectUri = `http://127.0.0.1:${callback.port}/callback`;
    const registration = await fetchJson(metadata.registrationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_name: `GopherHole MCP (${detectIde()})`,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope,
      }),
    }, 'OAuth client registration');
    if (!isNonemptyString(registration.client_id) || registration.token_endpoint_auth_method !== 'none' ||
        registration.client_secret !== undefined || !isStringArray(registration.redirect_uris) ||
        registration.redirect_uris.length !== 1 || registration.redirect_uris[0] !== redirectUri ||
        !isStringArray(registration.grant_types) || registration.grant_types.length !== 1 || registration.grant_types[0] !== 'authorization_code' ||
        !isStringArray(registration.response_types) || registration.response_types.length !== 1 || registration.response_types[0] !== 'code' ||
        !matchesScopes(registration.scope, scope)) {
      throw new Error('OAuth client registration returned incompatible client metadata.');
    }

    const authorizeUrl = new URL(metadata.authorizationEndpoint);
    authorizeUrl.search = new URLSearchParams({
      client_id: registration.client_id,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      response_type: 'code',
      scope,
      resource,
    }).toString();

    console.error('');
    console.error(`  GopherHole MCP: Opening browser to authorize ${scope === 'admin' ? 'admin tools' : 'agent setup'}...`);
    console.error("  If the browser doesn't open, visit:");
    console.error(`  ${authorizeUrl.toString()}`);
    console.error('');
    await openBrowser(authorizeUrl.toString());

    const { code } = await callback.waitForCallback();
    await callback.close();
    console.error('  Exchanging authorization code...');
    const token = await fetchJson(metadata.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: registration.client_id,
        redirect_uri: redirectUri,
        resource,
      }),
    }, 'Token exchange');
    if (!isNonemptyString(token.access_token) || !/^[A-Za-z0-9\-._~+/]+=*$/.test(token.access_token) ||
        typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer' ||
        typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0 ||
        !matchesScopes(token.scope, scope) || token.resource !== resource) {
      throw new Error('Token exchange returned an invalid or unbound access token.');
    }
    const expiresAt = new Date(Date.now() + token.expires_in * 1000);
    if (!Number.isFinite(expiresAt.getTime())) throw new Error('Token exchange returned an invalid token expiry.');
    return { clientId: registration.client_id, access_token: token.access_token, expires_in: token.expires_in, scope: token.scope, expiresAt: expiresAt.toISOString() };
  } finally {
    await callback.close();
  }
}

export interface AuthResult {
  apiKey: string;
  accessToken: string;
  accessTokenExpiresAt: string;
}

/** Provision the stdio API key with least privilege; admin tools step up separately. */
export async function bootstrapAuth(appUrl: string): Promise<AuthResult> {
  const issuer = normalizeAppUrl(appUrl);
  const ide = detectIde();
  const token = await authorizeNative(issuer, 'agent:create');
  console.error('  Provisioning agent...');
  const agent = await fetchJson(`${issuer}/oauth/mcp/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.access_token}` },
    body: JSON.stringify({ ide }),
  }, 'Agent provisioning');
  if (!isNonemptyString(agent.api_key)) {
    throw new Error('Agent exists but API key is unavailable. Regenerate via the GopherHole dashboard.');
  }
  if (!isNonemptyString(agent.agent_id) || !isNonemptyString(agent.alias)) {
    throw new Error('Agent provisioning returned an invalid response.');
  }
  storeCredentials({
    apiKey: agent.api_key,
    agentId: agent.agent_id,
    alias: agent.alias,
    ide,
    createdAt: new Date().toISOString(),
    accessToken: token.access_token,
    accessTokenExpiresAt: token.expiresAt,
    accessTokenIssuer: issuer,
    accessTokenResource: `${issuer}/api`,
    accessTokenScope: token.scope,
    accessTokenClientId: token.clientId,
  });
  console.error(`  Authenticated! Agent: @${agent.alias} (${agent.agent_id})`);
  console.error(`  Credentials saved to ${CREDENTIALS_FILE}`);
  console.error('');
  return { apiKey: agent.api_key, accessToken: token.access_token, accessTokenExpiresAt: token.expiresAt };
}

interface CallbackServer {
  port: number;
  waitForCallback: () => Promise<{ code: string }>;
  close: () => Promise<void>;
}

/** @internal Exported for local protocol regression tests. */
export function startCallbackServer(expectedState: string, expectedIssuer: string, timeoutMs = 5 * 60 * 1000): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let callbackResolve!: (value: { code: string }) => void;
    let callbackReject!: (reason: Error) => void;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closePromise: Promise<void> | undefined;
    const callbackPromise = new Promise<{ code: string }>((res, rej) => {
      callbackResolve = res;
      callbackReject = rej;
    });
    // Registration can fail or time out before the flow starts awaiting a callback.
    void callbackPromise.catch(() => {});
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callbackReject(new Error(message));
    };
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const addr = server.address();
      if (!addr || typeof addr === 'string' || req.headers.host !== `127.0.0.1:${addr.port}`) {
        res.writeHead(400).end('Invalid callback host');
        return;
      }
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET' }).end('Method not allowed');
        return;
      }
      let url: URL;
      try { url = new URL(req.url || '/', 'http://127.0.0.1'); }
      catch { res.writeHead(400).end('Invalid callback URL'); return; }
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      if (settled) { res.writeHead(409).end('Callback already handled'); return; }
      const params = url.searchParams;
      const invalid = (message: string) => {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(callbackHtml(false));
        fail(message);
      };
      if (['state', 'iss', 'code', 'error'].some(name => params.getAll(name).length > 1)) {
        invalid('OAuth callback contains duplicate parameters.');
        return;
      }
      if (params.get('state') !== expectedState) { invalid('OAuth state mismatch.'); return; }
      if (params.get('iss') !== expectedIssuer) { invalid('OAuth issuer mismatch.'); return; }
      const code = params.get('code');
      const error = params.get('error');
      if ((code && error) || (!code && !error)) { invalid('Invalid OAuth callback.'); return; }
      if (error) {
        // Never interpolate untrusted errors into HTML or terminal output.
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(callbackHtml(false));
        fail('Authorization was denied or cancelled.');
        return;
      }
      settled = true;
      clearTimeout(timer);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(callbackHtml(true));
      callbackResolve({ code: code! });
    });
    const close = (): Promise<void> => {
      if (!closePromise) {
        fail('Authentication was cancelled.');
        clearTimeout(timer);
        closePromise = new Promise(done => {
          server.close(() => done());
          server.closeAllConnections();
        });
      }
      return closePromise;
    };
    server.on('error', err => {
      fail('OAuth callback server failed.');
      reject(err);
      void close();
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to start callback server.'));
        void close();
        return;
      }
      timer = setTimeout(() => {
        fail('Authentication timed out.');
        void close();
      }, timeoutMs);
      timer.unref();
      resolve({ port: addr.port, waitForCallback: () => callbackPromise, close });
    });
  });
}

async function openBrowser(url: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  const platform = process.platform;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  // No shell interpolation. A failed opener is recoverable using the printed URL.
  const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false });
  child.on('error', () => {});
  child.unref();
}

function callbackHtml(success: boolean): string {
  const title = success ? 'Authorization received' : 'Authentication failed';
  const message = success
    ? 'You can close this tab. Your IDE will finish connecting to GopherHole.'
    : 'Authentication could not be completed. Please try again from your IDE.';
  const color = success ? '#10b981' : '#ef4444';
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${title} — GopherHole</title>
<style>
  body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .c{text-align:center;max-width:400px;padding:2rem}
  h1{color:${color};margin-bottom:0.5rem}
  p{color:#999;font-size:0.95rem}
</style></head>
<body><div class="c"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}
