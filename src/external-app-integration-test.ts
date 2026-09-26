import assert from 'node:assert/strict';
import { test } from 'node:test';

const integrationUrl = new URL('../dist/external-app-integration.js', import.meta.url);
let integrationModule: any = null;
try {
  integrationModule = await import(integrationUrl.href);
} catch {
  // The RED assertion identifies the missing app quick-install behavior.
}

test('creates a disabled remote MCP definition for an official app integration', () => {
  assert.ok(
    integrationModule?.createExternalAppDefinition,
    'app quick-install factory is not implemented',
  );
  const definition = integrationModule.createExternalAppDefinition('linear');
  assert.deepEqual(
    {
      id: definition.id,
      name: definition.name,
      source: definition.source,
      appId: definition.appId,
      transport: definition.transport,
      url: definition.url,
      enabled: definition.enabled,
    },
    {
      id: 'linear',
      name: 'Linear',
      source: 'app',
      appId: 'linear',
      transport: 'streamable-http',
      url: 'https://mcp.linear.app/mcp',
      enabled: false,
    },
  );
});

test('creates a local uv launcher for the community CapCut integration', () => {
  assert.ok(integrationModule?.createExternalAppDefinition);
  const definition = integrationModule.createExternalAppDefinition('capcut');
  assert.deepEqual(
    {
      id: definition.id,
      source: definition.source,
      appId: definition.appId,
      transport: definition.transport,
      command: definition.command,
      args: definition.args,
      enabled: definition.enabled,
    },
    {
      id: 'capcut',
      source: 'app',
      appId: 'capcut',
      transport: undefined,
      command: 'uv',
      args: [
        'run',
        '--from',
        'git+https://github.com/bchenner/capcut-mcp',
        'python',
        '-m',
        'capcut_mcp.server',
      ],
      enabled: false,
    },
  );
});

test('keeps app quick install disabled when an integration has no fixed install target', () => {
  assert.ok(integrationModule?.createExternalAppDefinition);
  assert.throws(
    () => integrationModule.createExternalAppDefinition('canva'),
    /does not expose a fixed endpoint/i,
  );
});
