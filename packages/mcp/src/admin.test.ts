import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ stored: vi.fn(), refresh: vi.fn() }));
vi.mock('./auth.js', () => ({ loadStoredAccessToken: auth.stored, refreshAdminToken: auth.refresh }));
const ctx = { appUrl: 'https://gopherhole.example', apiUrl: 'https://hub.example' };

beforeEach(() => {
  vi.resetModules();
  auth.stored.mockReset().mockReturnValue(null);
  auth.refresh.mockReset().mockResolvedValue({ accessToken: 'ghat_new_admin_test', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('admin OAuth token lifecycle', () => {
  it('uses stored tokens only in the configured app context', async () => {
    const { ensureAdminToken } = await import('./admin.js');
    auth.stored.mockReturnValue('ghat_stored_test');
    await expect(ensureAdminToken(ctx)).resolves.toBe('ghat_stored_test');
    expect(auth.stored).toHaveBeenCalledWith(ctx.appUrl);
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it('does not reuse a cached admin token for another issuer', async () => {
    const { ensureAdminToken } = await import('./admin.js');
    await expect(ensureAdminToken(ctx)).rejects.toThrow('Admin authorization');
    await expect(ensureAdminToken(ctx)).resolves.toBe('ghat_new_admin_test');
    const otherCtx = { ...ctx, appUrl: 'https://other.example' };
    await expect(ensureAdminToken(otherCtx)).rejects.toThrow('Admin authorization');
    expect(auth.refresh).toHaveBeenCalledWith(otherCtx.appUrl);
  });

  it('reauthorizes after a cached token expires', async () => {
    vi.useFakeTimers();
    const { ensureAdminToken } = await import('./admin.js');
    await expect(ensureAdminToken(ctx)).rejects.toThrow('Admin authorization');
    await expect(ensureAdminToken(ctx)).resolves.toBe('ghat_new_admin_test');
    vi.setSystemTime(Date.now() + 61_000);
    await expect(ensureAdminToken(ctx)).rejects.toThrow('Admin authorization');
    expect(auth.refresh).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent authorization attempts', async () => {
    auth.refresh.mockReturnValue(new Promise(() => {}));
    const { ensureAdminToken } = await import('./admin.js');
    await expect(ensureAdminToken(ctx)).rejects.toThrow('Admin authorization');
    await expect(ensureAdminToken(ctx)).rejects.toThrow('Admin authorization');
    expect(auth.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not keep retrying a stored token after the backend rejects it', async () => {
    auth.stored.mockReturnValue('ghat_revoked_test');
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const { ensureAdminToken, handleAdminTool } = await import('./admin.js');
    const response = await handleAdminTool('admin_agents_list', undefined, ctx);
    expect(response.isError).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(`${ctx.appUrl}/api/agents`, expect.objectContaining({ redirect: 'error' }));
    await expect(ensureAdminToken(ctx)).rejects.toThrow('Admin authorization');
    expect(auth.refresh).toHaveBeenCalledOnce();
  });
});
