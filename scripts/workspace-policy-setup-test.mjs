import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'n3zuui-workspace-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const a = join(root, 'project A');
  const b = join(root, 'project B');
  const worker = join(root, 'worker');
  await Promise.all([mkdir(a), mkdir(b), mkdir(join(worker, 'dist'), { recursive: true })]);
  await writeFile(
    join(worker, 'package.json'),
    JSON.stringify({ name: '@wonderwhy-er/desktop-commander', version: '0.2.50' }),
  );
  await writeFile(join(worker, 'dist', 'index.js'), '// fixture');
  await writeFile(join(worker, 'dist', 'config.js'), 'export const USER_HOME = os.homedir();');
  const config = join(root, 'config.json');
  const policy = join(root, 'base-policy.json');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('DWB_')),
  );
  env.DWB_CONFIG_FILE = config;
  function configure(workspace) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('configure.mjs', import.meta.url)),
        '--worker-entry',
        join(worker, 'dist', 'index.js'),
        '--workspace',
        workspace,
      ],
      { env, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
  }
  return { root, a, b, config, policy, configure };
}

test('changing the Setup folder moves its managed filesystem grant', async (t) => {
  const f = await fixture(t);
  f.configure(f.a);
  f.configure(f.b);
  assert.equal(JSON.parse(await readFile(f.config, 'utf8')).workspace, f.b);
  assert.deepEqual(JSON.parse(await readFile(f.policy, 'utf8')).allowedDirectories, [f.b]);
  f.configure(f.b);
  assert.deepEqual(JSON.parse(await readFile(f.policy, 'utf8')).allowedDirectories, [f.b]);
});

test('Setup repairs a legacy generated policy whose only root predates the saved folder', async (t) => {
  const f = await fixture(t);
  f.configure(f.a);
  await writeFile(
    f.policy,
    JSON.stringify({
      allowedDirectories: [join(f.root, 'old project')],
      defaultShell: 'powershell.exe',
      telemetryEnabled: false,
    }),
  );
  f.configure(f.b);
  assert.deepEqual(JSON.parse(await readFile(f.policy, 'utf8')).allowedDirectories, [f.b]);
});

test('moving a managed grant keeps separately granted folders and other custom settings', async (t) => {
  const f = await fixture(t);
  f.configure(f.a);
  const shared = join(f.root, 'shared');
  const policy = JSON.parse(await readFile(f.policy, 'utf8'));
  Object.assign(policy, {
    allowedDirectories: [f.a, shared],
    blockedCommands: ['shutdown'],
    fileReadLineLimit: 777,
  });
  await writeFile(f.policy, JSON.stringify(policy));
  f.configure(f.b);
  const changed = JSON.parse(await readFile(f.policy, 'utf8'));
  assert.deepEqual(changed.allowedDirectories, [f.b, shared]);
  assert.deepEqual(changed.blockedCommands, ['shutdown']);
  assert.equal(changed.fileReadLineLimit, 777);
});

test('Setup preserves a separately supplied filesystem policy byte for byte', async (t) => {
  const f = await fixture(t);
  f.configure(f.a);
  const custom = join(f.root, 'custom-policy.json');
  const contents = JSON.stringify({
    allowedDirectories: [f.a],
    blockedCommands: ['shutdown'],
    fileWriteLineLimit: 20,
  });
  await writeFile(custom, contents);
  const config = JSON.parse(await readFile(f.config, 'utf8'));
  config.basePolicy = custom;
  await writeFile(f.config, JSON.stringify(config));
  f.configure(f.b);
  assert.equal(await readFile(custom, 'utf8'), contents);
});

test('Setup preserves an explicit allowedDirectories override in its standard policy file', async (t) => {
  const f = await fixture(t);
  f.configure(f.a);
  const contents = JSON.stringify({
    allowedDirectories: [f.a],
    n3zuuiWorkspacePolicy: { version: 1, mode: 'custom' },
    blockedCommands: ['shutdown'],
  });
  await writeFile(f.policy, contents);
  f.configure(f.b);
  assert.equal(await readFile(f.policy, 'utf8'), contents);
});
