import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'n3zuui-skill-contract-'));
Object.assign(process.env, {
  DWB_DATA_DIR: join(root, 'data'),
  DWB_RUNTIME_DIR: join(root, 'runtime'),
  DWB_WORKSPACE_DB: join(root, 'workspaces.db'),
  DWB_BROKER_STATE_PATH: join(root, 'broker-state.json'),
  DWB_EVENT_LOG_PATH: join(root, 'events.jsonl'),
  DWB_BROKER_PIPE:
    process.platform === 'win32'
      ? `\\\\.\\pipe\\n3zuui-skill-contract-${randomUUID()}`
      : join(root, 'broker.sock'),
  DWB_BROKER_ALLOW_SHUTDOWN: 'true',
  DWB_BROKER_AUTOSTART: 'true',
});

const { BrokerClient } = await import('./broker-client.js');
const client = await BrokerClient.connect(root);
try {
  const catalog = await client.callTool('skills', { action: 'catalog' });
  assert.ok(
    Array.isArray(catalog.structuredContent?.skills) && catalog.structuredContent.skills.length > 0,
    'catalog must be returned by the broker without starting a Desktop Commander worker',
  );
} finally {
  try {
    await client.shutdownForTests();
  } finally {
    await client.close();
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rm(root, { recursive: true, force: true });
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(code ?? '') || attempt >= 39) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
}
console.log('SKILL_BROKER_CONTRACT_PASS: catalog is served by the local N3zuui broker');
