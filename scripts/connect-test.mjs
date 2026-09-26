import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const helper = fileURLToPath(new URL('./connect.mjs', import.meta.url));

function invoke(args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [helper, ...args], { env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: error.message }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('connect CLI installs one client config with a machine-readable result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dwb-connect-'));
  const target = join(root, 'cursor', 'mcp.json');
  try {
    const first = await invoke([
      'install',
      '--client',
      'cursor',
      '--config',
      target,
      '--data-dir',
      root,
      '--node',
      'node.exe',
      '--start',
      'start.mjs',
      '--dwb-config',
      join(root, 'config.json'),
      '--json',
    ]);
    assert.equal(first.code, 0, first.stderr);
    const firstResult = JSON.parse(first.stdout);
    assert.equal(firstResult.clientId, 'cursor');
    assert.equal(firstResult.backupFile, null);
    assert.equal(JSON.parse(await readFile(target, 'utf8')).mcpServers['dwb-core'].type, 'stdio');

    const second = await invoke([
      'install',
      '--client',
      'cursor',
      '--config',
      target,
      '--data-dir',
      root,
      '--node',
      'node-2.exe',
      '--start',
      'start-2.mjs',
      '--dwb-config',
      join(root, 'config-2.json'),
      '--json',
    ]);
    assert.equal(second.code, 0, second.stderr);
    const secondResult = JSON.parse(second.stdout);
    assert.equal(typeof secondResult.backupFile, 'string');
    assert.equal(
      JSON.parse(await readFile(target, 'utf8')).mcpServers['dwb-core'].command,
      'node-2.exe',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('connect CLI lists the supported client adapters', async () => {
  const result = await invoke(['list']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Claude Desktop/);
  assert.match(result.stdout, /Cursor/);
  assert.match(result.stdout, /VS Code workspace/);
});
