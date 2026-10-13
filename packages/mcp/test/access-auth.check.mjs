import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const marker = 'server.setRequestHandler(CallToolRequestSchema, ';
const start = source.indexOf(marker) + marker.length;
const end = source.indexOf('\n  });\n\n  // Start server', start);
assert.ok(start >= marker.length && end > start);
const code = ts.transpileModule(`const run = ${source.slice(start, end)}\n  };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }, reportDiagnostics: true,
});
assert.equal(code.diagnostics?.length, 0);
for (const args of [undefined, {}, { agentId: 'test-target', scopes: ['message:send'] }]) {
  test(`access request fails closed before authentication/network: ${JSON.stringify(args)}`, async () => {
    const forbidden = () => { throw Error('Unexpected network/authentication/credential access'); };
    const handler = vm.runInNewContext(`${code.outputText}\nrun`, {
      ensureClient: forbidden, handleAdminTool: forbidden, fetch: forbidden,
      loadStoredAccessToken: forbidden, bootstrapAuth: forbidden,
    });
    const result = await handler({ params: { name: 'agent_request_access', arguments: args } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /verified management session/);
    assert.match(result.content[0].text, /signed-in GopherHole dashboard/);
  });
}
test('unrelated admin tool still delegates to its existing handler', async () => {
  const handler = vm.runInNewContext(`${code.outputText}\nrun`, {
    appUrl: 'https://example.invalid', apiUrl: 'https://hub.example.invalid',
    handleAdminTool: async (name, args) => ({ name, args }),
  });
  assert.equal((await handler({ params: { name: 'admin_agents_list' } })).name, 'admin_agents_list');
});
for (const [name, args, method] of [
  ['workspace_list', undefined, 'workspaceList'],
  ['workspace_create', { name: 'test-workspace' }, 'workspaceCreate'],
]) {
  test(`${name} scope denial is returned without admin/OAuth/key fallback`, async () => {
    const forbidden = () => { throw Error('Unexpected privilege expansion or credential access'); };
    let calls = 0;
    const handler = vm.runInNewContext(`${code.outputText}\nrun`, {
      ensureClient: async () => ({ [method]: async () => { calls++; throw Error('insufficient_scope'); } }),
      fetch: forbidden, handleAdminTool: forbidden, bootstrapAuth: forbidden,
      refreshAdminToken: forbidden, loadStoredAccessToken: forbidden,
    });
    const result = await handler({ params: { name, arguments: args } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /insufficient_scope/);
    assert.equal(calls, 1);
  });
}
