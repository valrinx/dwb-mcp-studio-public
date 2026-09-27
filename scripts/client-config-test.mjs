import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildServerEntry,
  getClientCatalog,
  installClientConfig,
  mergeClientConfig,
  resolveClientConfigPath,
} from './client-config.mjs';

const fixtureRoots = {
  homeDir: 'C:\\Users\\tester',
  appDataDir: 'C:\\Users\\tester\\AppData\\Roaming',
  dataDir: 'C:\\Users\\tester\\AppData\\Local\\DWB-MCP-Studio',
  workspace: 'C:\\work\\project',
};

test('client catalog resolves official local config locations without guessing app internals', () => {
  assert.equal(
    resolveClientConfigPath('claude', fixtureRoots),
    'C:\\Users\\tester\\AppData\\Roaming\\Claude\\claude_desktop_config.json',
  );
  assert.equal(
    resolveClientConfigPath('cursor', fixtureRoots),
    'C:\\Users\\tester\\.cursor\\mcp.json',
  );
  assert.equal(
    resolveClientConfigPath('windsurf', fixtureRoots),
    'C:\\Users\\tester\\.codeium\\windsurf\\mcp_config.json',
  );
  assert.equal(
    resolveClientConfigPath('copilot', fixtureRoots),
    'C:\\Users\\tester\\.copilot\\mcp-config.json',
  );
  assert.equal(
    resolveClientConfigPath('vscode-workspace', fixtureRoots),
    'C:\\work\\project\\.vscode\\mcp.json',
  );

  const catalog = getClientCatalog(fixtureRoots);
  assert.deepEqual(
    catalog.map(({ id, format }) => [id, format]),
    [
      ['generic', 'mcpServers'],
      ['claude', 'mcpServers'],
      ['cursor', 'mcpServers'],
      ['windsurf', 'mcpServers'],
      ['copilot', 'mcpServers'],
      ['vscode-workspace', 'servers'],
      ['portable', 'mcpServers'],
      ['vscode', 'servers'],
    ],
  );
});

test('server entries use the client transport shape and preserve DWB runtime paths', () => {
  const common = {
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    startScript: 'C:\\Program Files\\DWB\\scripts\\start.mjs',
    configFile: 'C:\\Users\\tester\\AppData\\Local\\DWB-MCP-Studio\\config.json',
    dataDir: 'C:\\Users\\tester\\AppData\\Local\\DWB-MCP-Studio',
  };

  assert.deepEqual(buildServerEntry({ ...common, clientId: 'claude' }), {
    command: common.nodePath,
    args: [common.startScript],
    env: {
      DWB_CONFIG_FILE: common.configFile,
      DWB_DATA_DIR: common.dataDir,
    },
  });
  assert.deepEqual(buildServerEntry({ ...common, clientId: 'cursor' }), {
    type: 'stdio',
    command: common.nodePath,
    args: [common.startScript],
    env: {
      DWB_CONFIG_FILE: common.configFile,
      DWB_DATA_DIR: common.dataDir,
    },
  });
  assert.deepEqual(buildServerEntry({ ...common, clientId: 'copilot' }), {
    type: 'local',
    command: common.nodePath,
    args: [common.startScript],
    env: {
      DWB_CONFIG_FILE: common.configFile,
      DWB_DATA_DIR: common.dataDir,
    },
    tools: ['*'],
  });
  assert.deepEqual(buildServerEntry({ ...common, clientId: 'vscode' }), {
    type: 'stdio',
    command: common.nodePath,
    args: [common.startScript],
    env: {
      DWB_CONFIG_FILE: common.configFile,
      DWB_DATA_DIR: common.dataDir,
    },
  });
});

test('merge renames the legacy DWB entry to N3zuui, preserves unrelated servers, and accepts JSONC', () => {
  const input = `{
    // Existing client settings stay intact.
    "mcpServers": {
      "other": { "command": "other-server", },
      "dwb-core": { "command": "old-node", "args": ["old-start.mjs"] }
    },
    "theme": "keep-me"
  }`;
  const merged = mergeClientConfig(input, {
    clientId: 'claude',
    entry: {
      command: 'new-node',
      args: ['new-start.mjs'],
      env: { DWB_CONFIG_FILE: 'config.json' },
    },
  });
  assert.deepEqual(merged, {
    mcpServers: {
      other: { command: 'other-server' },
      'n3zuui-core': {
        command: 'new-node',
        args: ['new-start.mjs'],
        env: { DWB_CONFIG_FILE: 'config.json' },
      },
    },
    theme: 'keep-me',
  });

  const vscode = mergeClientConfig('{"servers":{"other":{"type":"stdio"}}}', {
    clientId: 'vscode',
    entry: { type: 'stdio', command: 'node', args: ['start.mjs'] },
  });
  assert.deepEqual(vscode.servers.other, { type: 'stdio' });
  assert.deepEqual(vscode.servers['n3zuui-core'], {
    type: 'stdio',
    command: 'node',
    args: ['start.mjs'],
  });
});

test('install creates the target, backs up existing config, and writes a readable merged file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dwb-client-config-'));
  const target = join(root, 'client', 'mcp.json');
  try {
    await mkdir(join(root, 'client'), { recursive: true });
    await writeFile(
      target,
      JSON.stringify({
        mcpServers: { 'dwb-core': { command: 'old-node' }, other: { command: 'keep' } },
      }),
    );
    await installClientConfig({
      clientId: 'cursor',
      configFile: target,
      nodePath: 'node.exe',
      startScript: 'start.mjs',
      dwbConfigFile: 'config.json',
      dataDir: root,
    });
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), {
      mcpServers: {
        other: { command: 'keep' },
        'n3zuui-core': {
          type: 'stdio',
          command: 'node.exe',
          args: ['start.mjs'],
          env: { DWB_CONFIG_FILE: 'config.json', DWB_DATA_DIR: root },
        },
      },
    });

    await installClientConfig({
      clientId: 'cursor',
      configFile: target,
      nodePath: 'node-2.exe',
      startScript: 'start-2.mjs',
      dwbConfigFile: 'config-2.json',
      dataDir: root,
    });
    const backups = (await import('node:fs/promises')).readdir(root, { recursive: true });
    const names = await backups;
    assert.equal(
      names.some((name) => String(name).includes('mcp.json.bak-')),
      true,
    );
    assert.equal((await stat(target)).isFile(), true);
    assert.equal(
      JSON.parse(await readFile(target, 'utf8')).mcpServers['n3zuui-core'].command,
      'node-2.exe',
    );
    assert.equal(JSON.parse(await readFile(target, 'utf8')).mcpServers['dwb-core'], undefined);
    await access(target);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
