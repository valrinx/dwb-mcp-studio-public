import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const storeModuleUrl = new URL('../dist/external-mcp-store.js', import.meta.url);
let storeModule: any = null;
try {
  storeModule = await import(storeModuleUrl.href);
} catch {
  // The RED assertion identifies the missing persistent store.
}

test('persists server definitions while protecting environment values at rest', async () => {
  assert.ok(storeModule?.ExternalMcpStore, 'ExternalMcpStore export is not implemented');

  const root = mkdtempSync(join(tmpdir(), 'dwb-external-mcp-store-'));
  const secret = 'fixture-secret-that-must-not-be-written';
  const definition = {
    id: 'private-api',
    name: 'Private API',
    command: 'node',
    args: ['server.js'],
    cwd: root,
    env: { API_TOKEN: secret },
    enabled: true,
  };
  try {
    const store = new storeModule.ExternalMcpStore(join(root, 'servers.json'));
    await store.save([definition]);
    const serialized = readFileSync(join(root, 'servers.json'), 'utf8');
    assert.equal(serialized.includes(secret), false);
    assert.deepEqual(await store.load(), [definition]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
