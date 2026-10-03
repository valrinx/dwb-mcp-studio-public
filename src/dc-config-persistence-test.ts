import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = await mkdtemp(resolve('logs', `n3zuui-config-persist-${randomUUID()}-`));
const workerRoot = join(root, 'node_modules', '@wonderwhy-er', 'desktop-commander');
const workerDist = join(workerRoot, 'dist');
const baseConfigPath = join(root, 'base-dc-config.json');
const config = {
  blockedCommands: ['shutdown'],
  defaultShell: 'powershell.exe',
  allowedDirectories: [],
  telemetryEnabled: false,
  fileWriteLineLimit: 50,
  fileReadLineLimit: 1000,
  pendingWelcomeOnboarding: false,
  welcomeOnboardingEligible: false,
};

await mkdir(workerDist, { recursive: true });
await writeFile(
  join(workerRoot, 'package.json'),
  JSON.stringify({
    name: '@wonderwhy-er/desktop-commander',
    version: '0.2.50',
  }),
);
await writeFile(
  join(workerDist, 'config.js'),
  "import * as os from 'node:os';\nexport const USER_HOME = os.homedir();\n",
);
await writeFile(
  join(workerDist, 'index.js'),
  [
    "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';",
    "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';",
    "import { z } from 'zod';",
    "import './config.js';",
    "const server = new McpServer({ name: 'config-persistence-fixture', version: '1.0.0' });",
    "server.registerTool('set_config_value', { inputSchema: { key: z.string(), value: z.any() } }, async ({ key }) => ({ content: [{ type: 'text', text: 'saved ' + key }] }));",
    'await server.connect(new StdioServerTransport());',
  ].join('\n'),
);
await writeFile(baseConfigPath, JSON.stringify(config, null, 2));
Object.assign(process.env, {
  DWB_DATA_DIR: join(root, 'data'),
  DWB_RUNTIME_DIR: join(root, 'runtime'),
  DWB_WORKSPACE_DB: join(root, 'workspaces.db'),
  DWB_BROKER_STATE_PATH: join(root, 'broker-state.json'),
  DWB_EVENT_LOG_PATH: join(root, 'events.jsonl'),
  DWB_BROKER_PIPE:
    process.platform === 'win32'
      ? `\\\\.\\pipe\\n3zuui-config-persist-${randomUUID()}`
      : join(root, 'broker.sock'),
  DWB_BROKER_ALLOW_SHUTDOWN: 'true',
  DWB_BROKER_AUTOSTART: 'true',
  DWB_WORKER_ENTRY: join(workerDist, 'index.js'),
  DWB_BASE_DC_CONFIG: baseConfigPath,
  DWB_WORKER_CAP: '1',
});

const { BrokerClient } = await import('./broker-client.js');
const client = await BrokerClient.connect(root);
try {
  const changed = await client.callTool('set_config_value', {
    key: 'fileReadLineLimit',
    value: 777,
  });
  assert.notEqual(changed.isError, true, 'the live worker accepted its configuration change');
  assert.equal(
    JSON.parse(await readFile(baseConfigPath, 'utf8')).fileReadLineLimit,
    777,
    'the accepted Desktop Commander setting must survive a worker restart',
  );
} finally {
  try {
    await client.shutdownForTests();
  } finally {
    await client.close();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
    await rm(root, { recursive: true, force: true });
  }
}
console.log('DC_CONFIG_PERSISTENCE_PASS: accepted settings survive a worker restart');
