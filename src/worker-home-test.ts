import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { prepareWorkerHome } from './worker-home.js';

async function fixture(t: { after: (fn: () => Promise<void>) => void }, policy: object) {
  const root = await mkdtemp(join(tmpdir(), 'n3zuui-worker-policy-'));
  const previousRuntime = process.env.DWB_RUNTIME_DIR;
  const previousPolicy = process.env.DWB_BASE_DC_CONFIG;
  process.env.DWB_RUNTIME_DIR = join(root, 'runtime');
  process.env.DWB_BASE_DC_CONFIG = join(root, 'policy.json');
  await writeFile(process.env.DWB_BASE_DC_CONFIG, JSON.stringify(policy));
  t.after(async () => {
    if (previousRuntime === undefined) delete process.env.DWB_RUNTIME_DIR;
    else process.env.DWB_RUNTIME_DIR = previousRuntime;
    if (previousPolicy === undefined) delete process.env.DWB_BASE_DC_CONFIG;
    else process.env.DWB_BASE_DC_CONFIG = previousPolicy;
    await rm(root, { recursive: true, force: true });
  });
  return async (workspace: string) => {
    const home = await prepareWorkerHome('session', workspace);
    return JSON.parse(
      await readFile(join(home, '.claude-server-commander', 'config.json'), 'utf8'),
    );
  };
}

test('managed worker grants follow the bound folder after creation and restart', async (t) => {
  const initial = join(tmpdir(), 'initial-project');
  const selected = join(tmpdir(), 'selected-project');
  const shared = join(tmpdir(), 'shared-project');
  const create = await fixture(t, {
    allowedDirectories: [initial, shared],
    n3zuuiWorkspacePolicy: { version: 1, mode: 'managed', root: initial },
    blockedCommands: ['shutdown'],
    fileReadLineLimit: 777,
  });
  for (let i = 0; i < 2; i++) {
    const config = await create(selected);
    assert.deepEqual(config.allowedDirectories, [selected, shared]);
    assert.deepEqual(config.blockedCommands, ['shutdown']);
    assert.equal(config.fileReadLineLimit, 777);
  }
});

test('custom worker restrictions are retained when binding a different folder', async (t) => {
  const allowed = join(tmpdir(), 'custom-allowed');
  const create = await fixture(t, {
    allowedDirectories: [allowed],
    n3zuuiWorkspacePolicy: { version: 1, mode: 'custom' },
  });
  assert.deepEqual((await create(join(tmpdir(), 'other-project'))).allowedDirectories, [allowed]);
});

test('a manual removal of the managed grant is respected instead of silently granting it again', async (t) => {
  const allowed = join(tmpdir(), 'custom-allowed');
  const create = await fixture(t, {
    allowedDirectories: [allowed],
    n3zuuiWorkspacePolicy: { version: 1, mode: 'managed', root: join(tmpdir(), 'removed-project') },
  });
  assert.deepEqual((await create(join(tmpdir(), 'other-project'))).allowedDirectories, [allowed]);
});
