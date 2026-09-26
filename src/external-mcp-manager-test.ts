import assert from 'node:assert/strict';
import { test } from 'node:test';

const managerModuleUrl = new URL('../dist/external-mcp-manager.js', import.meta.url);
let managerModule: any = null;
try {
  managerModule = await import(managerModuleUrl.href);
} catch {
  // The first RED run proves the feature is absent through the assertion below.
}

function fixtureSource(identity: string): string {
  return `
    import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
    import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
    import { z } from 'zod';
    const server = new McpServer({ name: 'external-fixture', version: '1.0.0' });
    server.registerTool('identify', {
      inputSchema: { value: z.string() },
    }, async ({ value }) => ({ content: [{ type: 'text', text: '${identity}:' + value }] }));
    await server.connect(new StdioServerTransport());
  `;
}

test('namespaces duplicate external tools and routes each call to its owning stdio server', async (t) => {
  assert.ok(managerModule?.ExternalMcpManager, 'ExternalMcpManager export is not implemented');

  const manager = new managerModule.ExternalMcpManager([
    {
      id: 'alpha',
      name: 'Alpha',
      command: process.execPath,
      args: ['--input-type=module', '-e', fixtureSource('alpha')],
      cwd: process.cwd(),
      env: {},
      enabled: true,
    },
    {
      id: 'beta',
      name: 'Beta',
      command: process.execPath,
      args: ['--input-type=module', '-e', fixtureSource('beta')],
      cwd: process.cwd(),
      env: {},
      enabled: true,
    },
  ]);
  t.after(() => manager.shutdown());

  const tools = await manager.listTools('session-one');
  assert.deepEqual(tools.map((tool: { name: string }) => tool.name).sort(), [
    'alpha__identify',
    'beta__identify',
  ]);

  const alpha = await manager.callTool('session-one', 'alpha__identify', { value: 'first' });
  const beta = await manager.callTool('session-one', 'beta__identify', { value: 'second' });
  assert.equal(alpha.content[0].text, 'alpha:first');
  assert.equal(beta.content[0].text, 'beta:second');
});

test('accepts an app integration as a validated streamable HTTP server definition', () => {
  assert.ok(managerModule?.normalizeExternalMcpDefinitions);
  const [definition] = managerModule.normalizeExternalMcpDefinitions([
    {
      id: 'linear',
      name: 'Linear',
      command: '',
      args: [],
      env: {},
      enabled: false,
      source: 'app',
      appId: 'linear',
      transport: 'streamable-http',
      url: 'https://mcp.linear.app/mcp',
    },
  ]);
  assert.equal(definition.transport, 'streamable-http');
  assert.equal(definition.url, 'https://mcp.linear.app/mcp');
  assert.equal(definition.source, 'app');
  assert.throws(
    () =>
      managerModule.normalizeExternalMcpDefinitions([
        {
          id: 'unsafe-app',
          name: 'Unsafe',
          command: '',
          args: [],
          env: {},
          enabled: false,
          source: 'app',
          appId: 'unsafe-app',
          transport: 'streamable-http',
          url: 'http://127.0.0.1:3000/mcp',
        },
      ]),
    /HTTPS URL/,
  );
});
