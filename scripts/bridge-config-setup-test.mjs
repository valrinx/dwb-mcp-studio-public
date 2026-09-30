import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ensureBridgeConfig } from './bridge-config.mjs';

test('creates a usable bridge config and preserves it on a later setup', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'n3zuui-bridge-setup-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const created = await ensureBridgeConfig(root);
  assert.equal(created.port, 3000);
  assert.equal(created.path, '/mcp');
  assert.match(created.token, /^[a-f0-9]{48}$/);

  const file = join(root, 'bridge.config.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(saved, created);

  saved.port = 4321;
  saved.path = '/custom-mcp';
  await writeFile(file, JSON.stringify(saved));
  assert.deepEqual(await ensureBridgeConfig(root), saved);
});

test('setup overrides retain their explicit no-token setting', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'n3zuui-bridge-setup-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const created = await ensureBridgeConfig(root, {
    port: 4123,
    path: '/custom',
    noToken: true,
  });
  assert.deepEqual(created, { port: 4123, path: '/custom', token: null });
});
