import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const helper = fileURLToPath(new URL('./external-mcp-client.mjs', import.meta.url));

function invoke(action, payload, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [helper, action], { env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: error.message }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

test('offline server management helper persists definitions without exposing env values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dwb-external-mcp-client-'));
  const secret = 'offline-helper-secret';
  const env = {
    ...process.env,
    DWB_DATA_DIR: root,
    DWB_RUNTIME_DIR: join(root, 'runtime'),
    DWB_BROKER_PIPE: `\\\\.\\pipe\\dwb-no-broker-${process.pid}`,
  };
  const definition = {
    id: 'offline',
    name: 'Offline',
    command: process.execPath,
    args: ['server.mjs'],
    cwd: root,
    env: { PRIVATE_TOKEN: secret },
    enabled: false,
  };
  try {
    const saved = await invoke('save', { servers: [definition] }, env);
    assert.equal(saved.code, 0, saved.stderr);
    assert.deepEqual(JSON.parse(saved.stdout).servers, [definition]);

    const file = await readFile(join(root, 'mcp-servers.json'), 'utf8');
    assert.equal(file.includes(secret), false);
    const listed = await invoke('list', {}, env);
    assert.equal(listed.code, 0, listed.stderr);
    assert.deepEqual(JSON.parse(listed.stdout).servers, [definition]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('catalog action exposes the pinned official reference servers for the manager UI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dwb-external-mcp-catalog-'));
  try {
    const result = await invoke(
      'catalog',
      {},
      {
        ...process.env,
        DWB_DATA_DIR: root,
        DWB_BROKER_PIPE: `\\\\.\\pipe\\dwb-no-catalog-broker-${process.pid}`,
      },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).catalog, [
      {
        id: 'everything',
        name: 'Everything',
        description:
          'Official reference server for testing tools, resources, prompts, and notifications.',
        packageName: '@modelcontextprotocol/server-everything',
        version: '2026.8.31',
        entryPoint: 'dist/index.js',
        allowedDirectoryArg: false,
        permissionSummary:
          'Reference/test server that exposes demonstration MCP capabilities; do not enable it for untrusted workspaces.',
        official: true,
        sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everything',
      },
      {
        id: 'filesystem',
        name: 'Filesystem',
        description: 'Browse and edit files within a directory you explicitly select.',
        packageName: '@modelcontextprotocol/server-filesystem',
        version: '2026.8.31',
        entryPoint: 'dist/index.js',
        allowedDirectoryArg: true,
        permissionSummary:
          'Can read, write, create, move, and delete files under the selected directory. Runs with this Windows account\u2019s permissions.',
        official: true,
        sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
      },
      {
        id: 'memory',
        name: 'Memory',
        description:
          'Official knowledge-graph memory server for persistent context across sessions.',
        packageName: '@modelcontextprotocol/server-memory',
        version: '2026.8.31',
        entryPoint: 'dist/index.js',
        allowedDirectoryArg: false,
        permissionSummary:
          'Stores MCP memory data in the managed installation directory and exposes it to connected agents.',
        official: true,
        sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
      },
      {
        id: 'sequential-thinking',
        name: 'Sequential Thinking',
        description:
          'Official structured-thinking server for reflective step-by-step problem solving.',
        packageName: '@modelcontextprotocol/server-sequential-thinking',
        version: '2026.8.31',
        entryPoint: 'dist/index.js',
        allowedDirectoryArg: false,
        permissionSummary:
          'Provides a reasoning workflow tool; it does not read or write files by itself.',
        official: true,
        sourceUrl:
          'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('apps-catalog action exposes app integrations separately from package installs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dwb-external-app-catalog-'));
  try {
    const result = await invoke(
      'apps-catalog',
      {},
      {
        ...process.env,
        DWB_DATA_DIR: root,
        DWB_BROKER_PIPE: `\\\\.\\pipe\\dwb-no-app-catalog-broker-${process.pid}`,
      },
    );
    assert.equal(result.code, 0, result.stderr);
    const catalog = JSON.parse(result.stdout).appsCatalog;
    assert.deepEqual(
      catalog.map((entry) => entry.id),
      [
        'figma',
        'github',
        'linear',
        'atlassian',
        'supabase',
        'vercel',
        'cloudflare',
        'canva',
        'capcut',
      ],
    );
    assert.equal(
      catalog.some((entry) => entry.id === 'filesystem'),
      false,
    );
    assert.equal(catalog.find((entry) => entry.id === 'capcut').kind, 'community-local');
    assert.equal(
      catalog.find((entry) => entry.id === 'linear').endpoint,
      'https://mcp.linear.app/mcp',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('offline app quick install registers an official remote server disabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dwb-external-app-install-'));
  try {
    const result = await invoke(
      'install-app',
      { appId: 'linear' },
      {
        ...process.env,
        DWB_DATA_DIR: root,
        DWB_BROKER_PIPE: `\\\\.\\pipe\\dwb-no-app-install-broker-${process.pid}`,
      },
    );
    assert.equal(result.code, 0, result.stderr);
    const installed = JSON.parse(result.stdout).servers[0];
    assert.equal(installed.id, 'linear');
    assert.equal(installed.source, 'app');
    assert.equal(installed.transport, 'streamable-http');
    assert.equal(installed.url, 'https://mcp.linear.app/mcp');
    assert.equal(installed.enabled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('offline app quick install registers the CapCut local uv launcher disabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dwb-external-capcut-install-'));
  try {
    const result = await invoke(
      'install-app',
      { appId: 'capcut' },
      {
        ...process.env,
        DWB_DATA_DIR: root,
        DWB_BROKER_PIPE: `\\\\.\\pipe\\dwb-no-capcut-install-broker-${process.pid}`,
      },
    );
    assert.equal(result.code, 0, result.stderr);
    const installed = JSON.parse(result.stdout).servers[0];
    assert.equal(installed.id, 'capcut');
    assert.equal(installed.source, 'app');
    assert.equal(installed.command, 'uv');
    assert.deepEqual(installed.args, [
      'run',
      '--from',
      'git+https://github.com/bchenner/capcut-mcp',
      'python',
      '-m',
      'capcut_mcp.server',
    ]);
    assert.equal(installed.enabled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('offline install stages the selected catalog server and persists it disabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dwb-external-mcp-install-'));
  const npmCli = join(root, 'fake-npm-cli.mjs');
  const env = {
    ...process.env,
    DWB_DATA_DIR: root,
    DWB_RUNTIME_DIR: join(root, 'runtime'),
    DWB_BROKER_PIPE: `\\\\.\\pipe\\dwb-no-install-broker-${process.pid}`,
    npm_execpath: npmCli,
  };
  await writeFile(
    npmCli,
    [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      'const args = process.argv.slice(2);',
      "const prefix = args[args.indexOf('--prefix') + 1];",
      'const spec = args.at(-1);',
      "const split = spec.lastIndexOf('@');",
      'const packageName = spec.slice(0, split);',
      'const version = spec.slice(split + 1);',
      "const packageRoot = join(prefix, 'node_modules', '@modelcontextprotocol', 'server-filesystem');",
      "mkdirSync(join(packageRoot, 'dist'), { recursive: true });",
      "writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: packageName, version }));",
      "writeFileSync(join(packageRoot, 'dist', 'index.js'), 'process.exit(0);');",
    ].join('\n'),
  );
  try {
    const result = await invoke(
      'install',
      { catalogId: 'filesystem', allowedDirectory: root },
      env,
    );
    assert.equal(result.code, 0, result.stderr);
    const installed = JSON.parse(result.stdout).servers[0];
    assert.equal(installed.id, 'filesystem');
    assert.equal(installed.enabled, false);
    assert.equal(installed.packageVersion, '2026.8.31');
    assert.equal(
      installed.installDirectory,
      join(root, 'mcp-servers', 'installations', 'filesystem', '2026.8.31'),
    );
    const persisted = await readFile(join(root, 'mcp-servers.json'), 'utf8');
    assert.equal(persisted.includes('fake-npm-cli'), false);
    const listed = await invoke('list', {}, env);
    assert.equal(listed.code, 0, listed.stderr);
    assert.equal(JSON.parse(listed.stdout).servers[0].enabled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
