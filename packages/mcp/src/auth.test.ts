import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { request } from 'node:http';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => ({ file: null as string | null, spawn: vi.fn() }));
vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  existsSync: vi.fn(() => mocks.file !== null),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => mocks.file ?? ''),
  writeFileSync: vi.fn((_path: unknown, data: string) => { mocks.file = data; }),
}));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

import { bootstrapAuth, loadStoredAccessToken, loadStoredApiKey, refreshAdminToken, startCallbackServer } from './auth.js';

const ISSUER = 'https://gopherhole.example';
const RESOURCE = `${ISSUER}/api`;
const STATE = 'local-test-state';
const servers: Awaited<ReturnType<typeof startCallbackServer>>[] = [];
let browserRequests: Promise<unknown>[] = [];
let redirectUri = '';
let authorizeUrl: URL;
let registrationBody: Record<string, any>;
let tokenRequest: URLSearchParams;
let fetchMock: Mock<[input: string, init?: RequestInit], Promise<Response>>;
let overrideMetadata: Record<string, unknown>;
let overrideRegistration: Record<string, unknown>;
let overrideToken: Record<string, unknown>;
let registrationFails: boolean;
let provisioningStatus: number;

function localRequest(url: string, options: { method?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { ...options, agent: false }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function callbackUrl(port: number, changes: Record<string, string | null> = {}): string {
  const url = new URL(`http://127.0.0.1:${port}/callback`);
  const params: Record<string, string | null> = { code: 'test-code', state: STATE, iss: ISSUER, ...changes };
  for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value);
  return url.toString();
}

async function newServer(timeoutMs?: number) {
  const server = await startCallbackServer(STATE, ISSUER, timeoutMs);
  servers.push(server);
  return server;
}

beforeEach(() => {
  mocks.file = null;
  browserRequests = [];
  redirectUri = '';
  overrideMetadata = {};
  overrideRegistration = {};
  overrideToken = {};
  registrationFails = false;
  provisioningStatus = 200;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.spawn.mockReset().mockImplementation((_cmd, args: string[]) => {
    authorizeUrl = new URL(args[args.length - 1]);
    const url = new URL(authorizeUrl.searchParams.get('redirect_uri')!);
    url.search = new URLSearchParams({ code: 'authorization-test-code', state: authorizeUrl.searchParams.get('state')!, iss: ISSUER }).toString();
    browserRequests.push(localRequest(url.toString()));
    return { on: vi.fn(), unref: vi.fn() };
  });
  fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const url = String(input);
    if (url.endsWith('/.well-known/oauth-authorization-server')) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth/authorize`,
        token_endpoint: `${ISSUER}/oauth/token`,
        registration_endpoint: `${ISSUER}/oauth/register`,
        code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true,
        ...overrideMetadata,
      });
    }
    if (url.endsWith('/oauth/register')) {
      registrationBody = JSON.parse(init.body as string);
      redirectUri = registrationBody.redirect_uris[0];
      // The listener must already own this exact port at registration time.
      expect((await localRequest(redirectUri.replace('/callback', '/not-a-callback'))).status).toBe(404);
      if (registrationFails) return Response.json({ error: 'invalid_client_metadata' }, { status: 400 });
      return Response.json({ client_id: 'server-issued-native-client', ...registrationBody, ...overrideRegistration }, { status: 201 });
    }
    if (url.endsWith('/oauth/token')) {
      tokenRequest = init.body as URLSearchParams;
      return Response.json({ access_token: 'ghat_unit_test_only', token_type: 'Bearer', expires_in: 3600,
        scope: registrationBody.scope, resource: RESOURCE, ...overrideToken });
    }
    if (url.endsWith('/oauth/mcp/agent')) {
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ghat_unit_test_only');
      if (provisioningStatus !== 200) return Response.json({ error: 'insufficient_scope' }, { status: provisioningStatus });
      return Response.json({ agent_id: 'test-agent', alias: 'test-alias', api_key: 'gph_unit_test_only', created: true });
    }
    throw new Error(`Unexpected test URL: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(browserRequests);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('native OAuth bootstrap', () => {
  it('registers the listening redirect and binds S256, client, issuer, resource and scope end-to-end', async () => {
    const result = await bootstrapAuth(`${ISSUER}/`);
    expect(result.apiKey).toBe('gph_unit_test_only');
    expect(registrationBody.token_endpoint_auth_method).toBe('none');
    expect(registrationBody.grant_types).toEqual(['authorization_code']);
    expect(registrationBody.response_types).toEqual(['code']);
    expect(registrationBody.scope).toBe('agent:create');
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(authorizeUrl.searchParams.get('client_id')).toBe('server-issued-native-client');
    expect(authorizeUrl.searchParams.get('resource')).toBe(RESOURCE);
    expect(authorizeUrl.searchParams.get('scope')).toBe('agent:create');
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizeUrl.searchParams.get('code_challenge')).toBe(createHash('sha256').update(tokenRequest.get('code_verifier')!).digest('base64url'));
    expect(tokenRequest.get('resource')).toBe(RESOURCE);
    expect(tokenRequest.get('client_id')).toBe('server-issued-native-client');
    expect(tokenRequest.get('redirect_uri')).toBe(redirectUri);
    expect(tokenRequest.get('code')).toBe('authorization-test-code');
    expect(mocks.spawn).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ shell: false }));
    expect(loadStoredApiKey()).toBe('gph_unit_test_only');
    expect(loadStoredAccessToken(ISSUER)).toBeNull(); // agent:create is never promoted to admin
    expect(JSON.parse(mocks.file!).accessTokenResource).toBe(RESOURCE);
    expect(JSON.parse(mocks.file!).accessTokenClientId).toBe('server-issued-native-client');
    await expect(localRequest(redirectUri)).rejects.toThrow();
  });

  it('admin reauthorization preserves the API key and does not provision an agent', async () => {
    mocks.file = JSON.stringify({ apiKey: 'gph_existing_test_key', agentId: 'existing-agent' });
    const token = await refreshAdminToken(ISSUER);
    expect(registrationBody.scope).toBe('admin');
    expect(authorizeUrl.searchParams.get('scope')).toBe('admin');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/oauth/mcp/agent'))).toBe(false);
    expect(loadStoredApiKey()).toBe('gph_existing_test_key');
    expect(loadStoredAccessToken(ISSUER)).toBe(token.accessToken);
    expect(JSON.parse(mocks.file!).accessTokenClientId).toBe('server-issued-native-client');
    expect(loadStoredAccessToken('https://other.example')).toBeNull();
  });

  it('preserves an existing key when provisioning is denied and never requests broader authority', async () => {
    const existing = JSON.stringify({ apiKey: 'gph_existing_test_key', agentId: 'existing-agent' });
    mocks.file = existing;
    provisioningStatus = 403;
    await expect(bootstrapAuth(ISSUER)).rejects.toThrow('Agent provisioning failed (HTTP 403)');
    expect(mocks.file).toBe(existing);
    expect(registrationBody.scope).toBe('agent:create');
    expect(authorizeUrl.searchParams.get('scope')).toBe('agent:create');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/oauth/register'))).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/api-keys'))).toBe(false);
  });

  it('preserves an existing key when admin consent fails', async () => {
    const existing = JSON.stringify({ apiKey: 'gph_existing_test_key', agentId: 'existing-agent' });
    mocks.file = existing;
    registrationFails = true;
    await expect(refreshAdminToken(ISSUER)).rejects.toThrow('registration failed');
    expect(mocks.file).toBe(existing);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('rejects registration failure and closes the listener before opening a browser', async () => {
    registrationFails = true;
    await expect(bootstrapAuth(ISSUER)).rejects.toThrow('registration failed');
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.file).toBeNull();
    await expect(localRequest(redirectUri)).rejects.toThrow();
  });

  it.each([
    { client_id: '' }, { token_endpoint_auth_method: 'client_secret_basic' }, { client_secret: 'unexpected' },
    { redirect_uris: ['http://127.0.0.1:1/callback'] }, { grant_types: ['client_credentials'] },
    { response_types: ['token'] }, { scope: 'admin' }, { scope: 'agent:create admin' },
    { grant_types: ['authorization_code', 'refresh_token'] }, { response_types: ['code', 'token'] },
  ])('rejects incompatible registration metadata %j', async override => {
    overrideRegistration = override;
    await expect(bootstrapAuth(ISSUER)).rejects.toThrow('incompatible client metadata');
    expect(mocks.spawn).not.toHaveBeenCalled();
    await expect(localRequest(redirectUri)).rejects.toThrow();
  });

  it.each([
    { issuer: 'https://other.example' }, { code_challenge_methods_supported: ['plain'] },
    { code_challenge_methods_supported: undefined }, { authorization_response_iss_parameter_supported: false },
    { token_endpoint: 'https://other.example/oauth/token' }, { registration_endpoint: 'https://user:pass@gopherhole.example/oauth/register' },
  ])('rejects untrusted or incompatible discovery %j', async override => {
    overrideMetadata = override;
    await expect(bootstrapAuth(ISSUER)).rejects.toThrow(/OAuth/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it.each([
    { access_token: '' }, { access_token: 'token\r\ninjected' }, { token_type: 'Basic' },
    { expires_in: 0 }, { expires_in: -1 }, { expires_in: '3600' }, { expires_in: 1e100 },
    { resource: `${ISSUER}/mcp` }, { resource: undefined }, { scope: 'admin' }, { scope: 'agent:create admin' },
  ])('rejects malformed or unbound tokens %j', async override => {
    overrideToken = override;
    await expect(bootstrapAuth(ISSUER)).rejects.toThrow(/Token exchange returned/);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/oauth/mcp/agent'))).toBe(false);
    expect(mocks.file).toBeNull();
    await expect(localRequest(redirectUri)).rejects.toThrow();
  });

  it('closes the listener if launching the browser throws', async () => {
    mocks.spawn.mockImplementation(() => { throw new Error('spawn failed'); });
    await expect(bootstrapAuth(ISSUER)).rejects.toThrow('spawn failed');
    await expect(localRequest(redirectUri)).rejects.toThrow();
  });

  it.each(['http://gopherhole.example', 'https://user:pass@gopherhole.example', `${ISSUER}?a=1`, `${ISSUER}#frag`, `${ISSUER}?`, `${ISSUER}#`])('rejects unsafe app URL %s before network traffic', async appUrl => {
    await expect(bootstrapAuth(appUrl)).rejects.toThrow('GOPHERHOLE_APP_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('loopback callback', () => {
  it('requires the correct path, method and host before accepting a callback', async () => {
    const server = await newServer();
    expect((await localRequest(`http://127.0.0.1:${server.port}/wrong`)).status).toBe(404);
    expect((await localRequest(callbackUrl(server.port), { method: 'POST' })).status).toBe(405);
    expect((await localRequest(callbackUrl(server.port), { headers: { host: 'attacker.example' } })).status).toBe(400);
    const response = await localRequest(callbackUrl(server.port));
    expect(response.status).toBe(200);
    await expect(server.waitForCallback()).resolves.toEqual({ code: 'test-code' });
    expect((await localRequest(callbackUrl(server.port))).status).toBe(409);
  });

  it.each([
    [{ state: 'wrong' }, /state mismatch/], [{ state: null }, /state mismatch/],
    [{ iss: 'https://attacker.example' }, /issuer mismatch/], [{ iss: null }, /issuer mismatch/],
    [{ code: null }, /Invalid OAuth callback/], [{ error: 'access_denied' }, /Invalid OAuth callback/],
  ] as const)('rejects an invalid callback %j', async (changes, message) => {
    const server = await newServer();
    expect((await localRequest(callbackUrl(server.port, changes))).status).toBe(400);
    await expect(server.waitForCallback()).rejects.toThrow(message);
  });

  it('rejects duplicate security parameters', async () => {
    const server = await newServer();
    expect((await localRequest(`${callbackUrl(server.port)}&state=${STATE}`)).status).toBe(400);
    await expect(server.waitForCallback()).rejects.toThrow('duplicate parameters');
  });

  it('validates issuer/state for errors and never renders untrusted HTML', async () => {
    const server = await newServer();
    const response = await localRequest(callbackUrl(server.port, { code: null, error: '<script>alert(1)</script>' }));
    expect(response.status).toBe(200);
    expect(response.body).not.toContain('<script>');
    await expect(server.waitForCallback()).rejects.toThrow('denied or cancelled');
  });

  it('times out, rejects pending callbacks and closes the socket', async () => {
    const server = await newServer(15);
    await expect(server.waitForCallback()).rejects.toThrow('timed out');
    await server.close();
    await expect(localRequest(callbackUrl(server.port))).rejects.toThrow();
  });

  it('cancels safely before anyone awaits the callback and clears its timeout', async () => {
    const server = await newServer(100);
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    await server.close();
    await server.close();
    expect(clear).toHaveBeenCalled();
    await expect(server.waitForCallback()).rejects.toThrow('cancelled');
    await expect(localRequest(callbackUrl(server.port))).rejects.toThrow();
  });
});

describe('stored credentials', () => {
  it('keeps legacy API keys usable but requires bound, unexpired admin tokens', () => {
    const credentials = { apiKey: 'gph_existing_test', accessToken: 'old-test-token', accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString() };
    mocks.file = JSON.stringify(credentials);
    expect(loadStoredApiKey()).toBe('gph_existing_test');
    expect(loadStoredAccessToken(ISSUER)).toBeNull();
    mocks.file = JSON.stringify({ ...credentials, accessTokenIssuer: ISSUER, accessTokenResource: RESOURCE, accessTokenScope: 'admin' });
    expect(loadStoredAccessToken(ISSUER)).toBe('old-test-token');
    mocks.file = JSON.stringify({ ...JSON.parse(mocks.file), accessTokenExpiresAt: 'not-a-date' });
    expect(loadStoredAccessToken(ISSUER)).toBeNull();
    mocks.file = JSON.stringify({ ...JSON.parse(mocks.file), accessTokenExpiresAt: new Date(Date.now() - 1).toISOString() });
    expect(loadStoredAccessToken(ISSUER)).toBeNull();
  });
});
