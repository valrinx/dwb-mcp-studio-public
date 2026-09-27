import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeTestBaseConfig } from './test-policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const adapterEntry = resolve(root, 'dist', 'index.js');
const testDir = resolve(root, 'logs', 'broker-recovery');
await rm(testDir, { recursive: true, force: true });
await mkdir(testDir, { recursive: true });
const baseConfig = await writeTestBaseConfig(testDir);
const pipe =
  process.platform === 'win32'
    ? `\\\\.\\pipe\\dwb-recovery-${process.pid}-${Date.now()}`
    : resolve(testDir, 'broker.sock');
const statePath = resolve(testDir, 'broker-state.json');
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter((x): x is [string, string] => typeof x[1] === 'string'),
  ),
  DWB_BROKER_PIPE: pipe,
  DWB_BROKER_STATE_PATH: statePath,
  DWB_BROKER_RESTORE_MAX_AGE_MS: '600000',
  DWB_WORKER_CAP: '2',
  DWB_TELEMETRY_ENABLED: 'false',
  DWB_EVENT_LOG_PATH: resolve(testDir, 'events.jsonl'),
  DWB_RUNTIME_DIR: resolve(testDir, 'runtime'),
  DWB_BASE_DC_CONFIG: baseConfig,
};

function structured<T = any>(result: any): T {
  return result.structuredContent as T;
}
function text(result: any): string {
  return Array.isArray(result?.content)
    ? result.content
        .filter((x: any) => x?.type === 'text')
        .map((x: any) => String(x.text ?? ''))
        .join('\n')
    : '';
}
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [adapterEntry],
  cwd: testDir,
  env,
  stderr: 'pipe',
});
transport.stderr?.on('data', (chunk) => process.stderr.write(String(chunk)));
const client = new Client({ name: 'dwb-broker-recovery-test', version: '0.1.0' });
let brokerPid: number | null = null;
try {
  await client.connect(transport);
  await client.listTools(undefined, { timeout: 20_000 });
  const before = structured<any>(
    await client.callTool({ name: 'dwb_bridge_status', arguments: {} }),
  );
  brokerPid = before.broker.brokerPid;
  const sessionId = before.sessionId as string;
  const oldWorkerPid = before.workerPid as number;

  const fixture = resolve(testDir, 'recovery.txt');
  await writeFile(fixture, 'before\n', 'utf8');
  const observed = await client.callTool({ name: 'read_file', arguments: { path: fixture } });
  assert.notEqual(observed.isError, true);
  await new Promise((r) => setTimeout(r, 100));

  process.kill(brokerPid!);
  await new Promise((r) => setTimeout(r, 700));
  await writeFile(fixture, 'external-after-crash\n', 'utf8');

  const after = structured<any>(
    await client.callTool({ name: 'dwb_bridge_status', arguments: {} }),
  );
  assert.notEqual(
    after.broker.brokerPid,
    brokerPid,
    'Broker PID should change after crash recovery',
  );
  assert.equal(after.sessionId, sessionId, 'Adapter should reclaim persisted N3zuui session ID');
  brokerPid = after.broker.brokerPid;

  const stale = await client.callTool({
    name: 'write_file',
    arguments: { path: fixture, content: 'stale-write\n', mode: 'rewrite' },
  });
  assert.equal(stale.isError, true);
  assert.match(text(stale), /stale-write protection/i);
  assert.equal(await readFile(fixture, 'utf8'), 'external-after-crash\n');
  await client.callTool({ name: 'read_file', arguments: { path: fixture } });
  const fresh = await client.callTool({
    name: 'write_file',
    arguments: { path: fixture, content: 'after-recovery\n', mode: 'rewrite' },
  });
  assert.notEqual(fresh.isError, true);
  assert.equal(await readFile(fixture, 'utf8'), 'after-recovery\n');
  const finalStatus = structured<any>(
    await client.callTool({ name: 'dwb_bridge_status', arguments: {} }),
  );
  assert.equal(finalStatus.sessionId, sessionId);
  assert.equal(typeof finalStatus.workerPid, 'number');
  assert.notEqual(
    finalStatus.workerPid,
    oldWorkerPid,
    'Broker crash should create a fresh worker process',
  );

  console.log(
    'BROKER_RECOVERY_PASS',
    JSON.stringify({
      oldBrokerPid: before.broker.brokerPid,
      newBrokerPid: finalStatus.broker.brokerPid,
      sessionId,
      oldWorkerPid,
      newWorkerPid: finalStatus.workerPid,
      staleWritePreserved: true,
    }),
  );
} finally {
  await client.close().catch(() => {});
  await transport.close().catch(() => {});
  if (brokerPid) {
    try {
      process.kill(brokerPid);
    } catch {}
  }
}
