import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const controllerUrl = new URL('../dist/external-mcp-controller.js', import.meta.url);
const storeUrl = new URL('../dist/external-mcp-store.js', import.meta.url);
const managerUrl = new URL('../dist/external-mcp-manager.js', import.meta.url);
let controllerModule: any = null;
let storeModule: any = null;
let managerModule: any = null;
try {
  [controllerModule, storeModule, managerModule] = await Promise.all([
    import(controllerUrl.href),
    import(storeUrl.href),
    import(managerUrl.href),
  ]);
} catch {
  // The RED assertion identifies the missing management controller.
}

test('saves, lists, and removes MCP server definitions through the manager control plane', async () => {
  assert.ok(
    controllerModule?.ExternalMcpController,
    'ExternalMcpController export is not implemented',
  );
  assert.ok(storeModule?.ExternalMcpStore);
  assert.ok(managerModule?.ExternalMcpManager);

  const root = mkdtempSync(join(tmpdir(), 'dwb-external-mcp-controller-'));
  const definition = {
    id: 'local-tools',
    name: 'Local Tools',
    command: 'node',
    args: ['server.js'],
    cwd: root,
    env: { API_TOKEN: 'controller-secret' },
    enabled: false,
  };
  const store = new storeModule.ExternalMcpStore(join(root, 'servers.json'));
  const manager = new managerModule.ExternalMcpManager();
  const controller = new controllerModule.ExternalMcpController(store, manager);
  try {
    const saved = await controller.handle({ action: 'save', servers: [definition] });
    assert.deepEqual(saved.servers, [definition]);
    assert.deepEqual(saved.status, [
      { id: 'local-tools', name: 'Local Tools', enabled: false, runningSessions: 0, error: null },
    ]);

    const listed = await controller.handle({ action: 'list' });
    assert.deepEqual(listed.servers, [definition]);

    const removed = await controller.handle({ action: 'remove', id: 'local-tools' });
    assert.deepEqual(removed.servers, []);
  } finally {
    await manager.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
});

test('removing a catalog server releases manager ownership before uninstalling its files', async () => {
  assert.ok(
    controllerModule?.ExternalMcpController,
    'ExternalMcpController export is not implemented',
  );
  assert.ok(managerModule?.ExternalMcpManager);
  const definition = {
    id: 'filesystem',
    name: 'Filesystem',
    command: 'node',
    args: ['filesystem.js'],
    env: {},
    enabled: false,
    source: 'catalog',
    catalogId: 'filesystem',
    packageName: '@modelcontextprotocol/server-filesystem',
    packageVersion: '2026.8.31',
    installDirectory: 'C:\\dwb-test\\filesystem',
  };
  let persisted = [definition];
  const store = {
    async load() {
      return structuredClone(persisted);
    },
    async save(definitions: typeof persisted) {
      persisted = structuredClone(definitions);
    },
  };
  const manager = new managerModule.ExternalMcpManager([definition]);
  let definitionsAtUninstall: string[] | null = null;
  let removedId = '';
  const installer = {
    async removeInstallation(candidate: typeof definition) {
      removedId = candidate.id;
      definitionsAtUninstall = manager.getDefinitions().map((server: { id: string }) => server.id);
    },
  };
  const controller = new controllerModule.ExternalMcpController(store, manager, installer);
  try {
    const result = await controller.handle({ action: 'remove', id: 'filesystem' });
    assert.equal(removedId, 'filesystem');
    assert.deepEqual(definitionsAtUninstall, []);
    assert.deepEqual(persisted, []);
    assert.deepEqual(result.servers, []);
  } finally {
    await manager.shutdown();
  }
});

test('removing a GitHub server releases manager ownership before deleting its repository', async () => {
  assert.ok(controllerModule?.ExternalMcpController);
  assert.ok(managerModule?.ExternalMcpManager);
  const definition = {
    id: 'raven-roblox-mcp',
    name: 'Raven Roblox MCP',
    command: 'node',
    args: ['C:\\DWB\\raven\\dist\\src\\cli.js'],
    cwd: 'C:\\DWB\\raven',
    env: {},
    enabled: false,
    source: 'github',
    repositoryUrl: 'https://github.com/valrinx/raven-roblox-mcp',
    repositoryRef: 'HEAD',
    packageName: 'raven-roblox-mcp',
    packageVersion: '0.5.0',
    installDirectory: 'C:\\DWB\\raven',
  };
  let persisted = [definition];
  const store = {
    async load() {
      return structuredClone(persisted);
    },
    async save(definitions: typeof persisted) {
      persisted = structuredClone(definitions);
    },
  };
  const manager = new managerModule.ExternalMcpManager([definition]);
  let definitionsAtUninstall: string[] | null = null;
  const installer = {
    async removeInstallation() {
      definitionsAtUninstall = manager.getDefinitions().map((server: { id: string }) => server.id);
    },
  };
  const controller = new controllerModule.ExternalMcpController(store, manager, installer);
  try {
    const result = await controller.handle({ action: 'remove', id: definition.id });
    assert.deepEqual(definitionsAtUninstall, []);
    assert.deepEqual(persisted, []);
    assert.deepEqual(result.servers, []);
  } finally {
    await manager.shutdown();
  }
});
