import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const installerUrl = new URL('../dist/external-mcp-installer.js', import.meta.url);
let installerModule: any = null;
try {
  installerModule = await import(installerUrl.href);
} catch {
  // The RED assertion identifies the missing staged installer.
}

test('stages a catalog package, verifies its identity, and activates it disabled', async () => {
  assert.ok(
    installerModule?.ExternalMcpInstaller,
    'ExternalMcpInstaller export is not implemented',
  );

  const root = mkdtempSync(join(tmpdir(), 'dwb-external-mcp-installer-'));
  const expectedPackage = '@modelcontextprotocol/server-filesystem';
  const expectedVersion = '2026.8.31';
  const installer = new installerModule.ExternalMcpInstaller({
    rootDir: root,
    installPackage: async (stage: string, packageName: string, version: string) => {
      assert.equal(packageName, expectedPackage);
      assert.equal(version, expectedVersion);
      const packageRoot = join(stage, 'node_modules', ...packageName.split('/'));
      mkdirSync(join(packageRoot, 'dist'), { recursive: true });
      writeFileSync(
        join(packageRoot, 'package.json'),
        JSON.stringify({ name: packageName, version, type: 'module' }),
      );
      writeFileSync(join(packageRoot, 'dist', 'index.js'), 'process.exit(0);');
    },
  });
  try {
    const installed = await installer.install('filesystem', { allowedDirectory: root });
    const expectedEntry = join(
      root,
      'mcp-servers',
      'installations',
      'filesystem',
      '2026.8.31',
      'node_modules',
      '@modelcontextprotocol',
      'server-filesystem',
      'dist',
      'index.js',
    );
    assert.equal(installed.id, 'filesystem');
    assert.equal(installed.command, process.execPath);
    assert.deepEqual(installed.args, [expectedEntry, root]);
    assert.equal(installed.enabled, false);
    assert.equal(installed.packageName, expectedPackage);
    assert.equal(installed.packageVersion, expectedVersion);
    assert.equal(
      installed.installDirectory,
      join(root, 'mcp-servers', 'installations', 'filesystem', expectedVersion),
    );
    assert.equal(existsSync(expectedEntry), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('uses the same per-user data directory as the server store when no install root is supplied', async () => {
  assert.ok(
    installerModule?.ExternalMcpInstaller,
    'ExternalMcpInstaller export is not implemented',
  );
  const localAppData = mkdtempSync(join(tmpdir(), 'dwb-external-mcp-default-root-'));
  const oldDataDir = process.env.DWB_DATA_DIR;
  const oldLocalAppData = process.env.LOCALAPPDATA;
  delete process.env.DWB_DATA_DIR;
  process.env.LOCALAPPDATA = localAppData;
  try {
    const expectedRoot = join(localAppData, 'DWB-MCP-Studio');
    const installer = new installerModule.ExternalMcpInstaller({
      installPackage: async (stage: string, packageName: string, version: string) => {
        const packageRoot = join(stage, 'node_modules', ...packageName.split('/'));
        mkdirSync(join(packageRoot, 'dist'), { recursive: true });
        writeFileSync(
          join(packageRoot, 'package.json'),
          JSON.stringify({ name: packageName, version }),
        );
        writeFileSync(join(packageRoot, 'dist', 'index.js'), 'process.exit(0);');
      },
    });
    const installed = await installer.install('filesystem', { allowedDirectory: localAppData });
    assert.equal(
      installed.installDirectory,
      join(expectedRoot, 'mcp-servers', 'installations', 'filesystem', '2026.8.31'),
    );
  } finally {
    if (oldDataDir === undefined) delete process.env.DWB_DATA_DIR;
    else process.env.DWB_DATA_DIR = oldDataDir;
    if (oldLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = oldLocalAppData;
    rmSync(localAppData, { recursive: true, force: true });
  }
});

test('installs a GitHub MCP repository and selects its matching executable automatically', async () => {
  assert.ok(installerModule?.ExternalMcpInstaller);
  const root = mkdtempSync(join(tmpdir(), 'dwb-external-mcp-github-'));
  let receivedRepositoryUrl = '';
  let receivedRef = '';
  const installer = new installerModule.ExternalMcpInstaller({
    rootDir: root,
    prepareGitHubRepository: async (stage: string, repositoryUrl: string, ref: string) => {
      receivedRepositoryUrl = repositoryUrl;
      receivedRef = ref;
      mkdirSync(join(stage, 'dist', 'src'), { recursive: true });
      writeFileSync(
        join(stage, 'package.json'),
        JSON.stringify({
          name: 'raven-roblox-mcp',
          version: '0.5.0',
          bin: {
            'raven-roblox-mcp': 'dist/src/cli.js',
            'raven-roblox-daemon': 'dist/src/index.js',
          },
        }),
      );
      writeFileSync(join(stage, 'dist', 'src', 'cli.js'), 'process.exit(0);');
      writeFileSync(join(stage, 'dist', 'src', 'index.js'), 'process.exit(0);');
    },
  });
  try {
    const installed = await installer.installGitHubRepository(
      'https://github.com/valrinx/raven-roblox-mcp',
    );
    assert.equal(receivedRepositoryUrl, 'https://github.com/valrinx/raven-roblox-mcp');
    assert.equal(receivedRef, 'HEAD');
    assert.equal(installed.name, 'raven-roblox-mcp');
    assert.equal(
      installer.getGitHubRepositoryId('https://github.com/valrinx/raven-roblox-mcp'),
      installed.id,
    );
    assert.equal(installed.source, 'github');
    assert.equal(installed.repositoryUrl, 'https://github.com/valrinx/raven-roblox-mcp');
    assert.equal(installed.repositoryRef, 'HEAD');
    assert.equal(installed.packageName, 'raven-roblox-mcp');
    assert.equal(installed.packageVersion, '0.5.0');
    assert.equal(installed.command, process.execPath);
    assert.deepEqual(installed.args, [
      join(
        installed.installDirectory,
        'dist',
        'src',
        'cli.js',
      ),
    ]);
    assert.equal(installed.enabled, false);
    assert.equal(existsSync(installed.args[0]), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a GitHub CLI repository that does not identify itself as an MCP package', async () => {
  assert.ok(installerModule?.ExternalMcpInstaller);
  const root = mkdtempSync(join(tmpdir(), 'dwb-external-mcp-github-not-mcp-'));
  const installer = new installerModule.ExternalMcpInstaller({
    rootDir: root,
    prepareGitHubRepository: async (stage: string) => {
      mkdirSync(join(stage, 'dist'), { recursive: true });
      writeFileSync(
        join(stage, 'package.json'),
        JSON.stringify({ name: 'ordinary-cli', version: '1.0.0', bin: 'dist/cli.js' }),
      );
      writeFileSync(join(stage, 'dist', 'cli.js'), 'process.exit(0);');
    },
  });
  try {
    await assert.rejects(
      installer.installGitHubRepository('https://github.com/example/ordinary-cli'),
      /does not appear to be an MCP server/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
