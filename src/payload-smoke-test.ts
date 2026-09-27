import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeTestBaseConfig } from './test-policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const bridgeEntry = resolve(root, 'dist', 'index.js');
const testDir = resolve(root, 'logs', 'payload-smoke');
const archiveDir = resolve(testDir, 'archives');
await rm(testDir, { recursive: true, force: true });
await mkdir(testDir, { recursive: true });
const baseConfig = await writeTestBaseConfig(testDir);

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nK0AAAAASUVORK5CYII=',
  'base64',
);
const fixtureA = resolve(testDir, 'large-a.png');
const fixtureB = resolve(testDir, 'large-b.png');
await writeFile(fixtureA, Buffer.concat([tinyPng, randomBytes(1536 * 1024)]));
await writeFile(fixtureB, Buffer.concat([tinyPng, randomBytes(1536 * 1024)]));

const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
);
const testPipe =
  process.platform === 'win32'
    ? `\\\\.\\pipe\\dwb-payload-${process.pid}-${Date.now()}`
    : resolve(testDir, 'broker.sock');
const bridgeEnv = {
  ...inheritedEnv,
  DWB_BROKER_PIPE: testPipe,
  DWB_WORKER_CAP: '1',
  DWB_BROKER_ALLOW_SHUTDOWN: 'true',
  DWB_TELEMETRY_ENABLED: 'false',
  DWB_EVENT_LOG_PATH: resolve(testDir, 'bridge-events.jsonl'),
  DWB_RUNTIME_DIR: resolve(testDir, 'runtime'),
  DWB_BASE_DC_CONFIG: baseConfig,
  DWB_PAYLOAD_MAX_BYTES: String(128 * 1024),
  DWB_PAYLOAD_WARN_BYTES: String(64 * 1024),
  DWB_PAYLOAD_PREVIEW_BYTES: String(8 * 1024),
  DWB_PAYLOAD_ARCHIVE: 'true',
  DWB_PAYLOAD_ARCHIVE_MODE: 'raw',
  DWB_PAYLOAD_ARCHIVE_DIR: archiveDir,
};

function statusFrom(result: Awaited<ReturnType<Client['callTool']>>) {
  return result.structuredContent as {
    ready: boolean;
    workerPid: number;
    broker: { brokerPid: number };
    payloadGuard: {
      enabled: boolean;
      maxBytes: number;
      guardedCount: number;
      guardedOriginalBytes: number;
      guardedForwardedBytes: number;
      lastGuardedTool: string | null;
    };
  };
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [bridgeEntry],
  cwd: root,
  env: bridgeEnv,
  stderr: 'pipe',
});
transport.stderr?.on('data', (chunk) => process.stderr.write(String(chunk)));
const client = new Client({ name: 'dwb-payload-smoke', version: '0.1.0' });
let brokerPid: number | null = null;

try {
  await client.connect(transport);
  const tools = await client.listTools(undefined, { timeout: 10_000 });
  assert.ok(tools.tools.some((tool) => tool.name === 'read_multiple_files'));

  const before = statusFrom(
    await client.callTool({
      name: 'dwb_bridge_status',
      arguments: {},
    }),
  );
  brokerPid = before.broker.brokerPid;
  assert.equal(before.payloadGuard.enabled, true);
  assert.equal(before.payloadGuard.maxBytes, 128 * 1024);

  const result = await client.callTool({
    name: 'read_multiple_files',
    arguments: { paths: [fixtureA, fixtureB] },
  });
  const forwardedBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  assert.ok(forwardedBytes < 128 * 1024, `forwarded ${forwardedBytes} bytes`);
  const resultContent = (result.content ?? []) as any[];
  const text = resultContent
    .filter((item: any) => item.type === 'text')
    .map((item: any) => item.text)
    .join('\n');
  assert.match(text, /N3zuui Payload Guard intercepted/);
  assert.match(text, /read only the specific file needed/i);
  assert.match(text, /large-a\.png/);
  assert.equal(
    resultContent.some((item: any) => item.type === 'image'),
    false,
  );
  const archiveFiles = await readdir(archiveDir);
  assert.ok(archiveFiles.length >= 1, 'Expected archived oversized payload');
  const archiveStat = await stat(resolve(archiveDir, archiveFiles[0]));
  assert.ok(archiveStat.size > 3 * 1024 * 1024, `archive only ${archiveStat.size} bytes`);

  const configAfter = await client.callTool({ name: 'get_config', arguments: {} });
  assert.equal(configAfter.isError, undefined);
  const after = statusFrom(
    await client.callTool({
      name: 'dwb_bridge_status',
      arguments: {},
    }),
  );
  assert.ok(after.ready);
  assert.ok(after.payloadGuard.guardedCount >= 1);
  assert.equal(after.payloadGuard.lastGuardedTool, 'read_multiple_files');
  assert.ok(after.payloadGuard.guardedOriginalBytes > after.payloadGuard.guardedForwardedBytes);

  console.log(
    'PAYLOAD_SMOKE_PASS',
    JSON.stringify({
      workerPid: after.workerPid,
      originalBytes: after.payloadGuard.guardedOriginalBytes,
      forwardedBytes: after.payloadGuard.guardedForwardedBytes,
      observedResponseBytes: forwardedBytes,
      archiveBytes: archiveStat.size,
      guardedCount: after.payloadGuard.guardedCount,
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
