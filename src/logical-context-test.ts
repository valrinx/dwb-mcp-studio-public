import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeTestBaseConfig } from './test-policy.js';

const root = resolve(import.meta.dirname, '..');
const testDir = resolve(root, 'logs', 'logical-context');
await rm(testDir, { recursive: true, force: true });
await mkdir(testDir, { recursive: true });
const baseConfig = await writeTestBaseConfig(testDir);
const pipe =
  process.platform === 'win32'
    ? `\\\\.\\pipe\\dwb-context-test-${process.pid}-${Date.now()}`
    : resolve(testDir, 'broker.sock');

process.env.DWB_BROKER_PIPE = pipe;
process.env.DWB_WORKER_CAP = '2';
process.env.DWB_IDLE_WORKER_MS = '300';
process.env.DWB_BROKER_AUTOSTART = 'true';
process.env.DWB_BROKER_ALLOW_SHUTDOWN = 'true';
process.env.DWB_EVENT_LOG_PATH = resolve(testDir, 'events.jsonl');
process.env.DWB_WORKSPACE_DB = resolve(testDir, 'telemetry.db');
process.env.DWB_RUNTIME_DIR = resolve(testDir, 'runtime');
process.env.DWB_BASE_DC_CONFIG = baseConfig;
const { BrokerClient } = await import('./broker-client.js');
let client = await BrokerClient.connect(testDir);
let brokerPid: number | null = null;
let adapter: Client | undefined;
try {
  const a = {
    key: 'meta.conversation_id:chat-z3',
    source: 'meta.conversation_id',
    preview: 'chat-z3#aaa',
  };
  const b = {
    key: 'meta.conversation_id:chat-z6',
    source: 'meta.conversation_id',
    preview: 'chat-z6#bbb',
  };
  await client.listTools(a);
  const statusA: any = await client.callTool('dwb_session_status', {}, a);
  await client.listTools(b);
  const statusB: any = await client.callTool('dwb_session_status', {}, b);
  const broker: any = await client.callTool('dwb_broker_status', {}, a);
  brokerPid = broker.structuredContent.brokerPid;
  assert.notEqual(statusA.structuredContent.sessionId, statusB.structuredContent.sessionId);
  assert.notEqual(statusA.structuredContent.workerPid, statusB.structuredContent.workerPid);
  assert.equal(broker.structuredContent.activeWorkers, 2);
  const listed: any = await client.callTool('dwb_list_sessions', {}, a);
  const live = listed.structuredContent.sessions.filter((s: any) => s.state === 'attached');
  assert.equal(live.length, 2);
  assert.deepEqual(
    new Set(live.map((s: any) => s.contextPreview)),
    new Set([a.preview, b.preview]),
  );

  await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
  const c = {
    key: 'meta.conversation_id:chat-new',
    source: 'meta.conversation_id',
    preview: 'chat-new#ccc',
  };
  await client.listTools(c);
  const statusC: any = await client.callTool('dwb_session_status', {}, c);
  const afterIdleReclaim: any = await client.callTool('dwb_broker_status', {}, c);
  assert.ok(statusC.structuredContent.workerPid, 'new active context should receive a worker');
  assert.equal(
    afterIdleReclaim.structuredContent.activeWorkers,
    2,
    'idle context worker should be reclaimed at capacity',
  );
  const afterList: any = await client.callTool('dwb_list_sessions', {}, c);
  const attached = afterList.structuredContent.sessions.filter((s: any) => s.state === 'attached');
  assert.equal(attached.length, 3, 'idle logical context should remain resumable');
  assert.equal(
    attached.filter((s: any) => s.workerPid).length,
    2,
    'only two workers should remain allocated',
  );

  const aSessionId = statusA.structuredContent.sessionId;
  await client.close();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  client = await BrokerClient.connect(testDir);
  await client.listTools(a);
  const recovered: any = await client.callTool('dwb_session_status', {}, a);
  assert.equal(
    recovered.structuredContent.sessionId,
    aSessionId,
    'logical conversation should survive transport replacement',
  );
  await client.close();

  // Exercise actual MCP metadata through the adapter, including file observations.
  adapter = new Client({ name: 'same-workspace-agents', version: '1.0.0' });
  await adapter.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve(root, 'dist', 'index.js')],
      cwd: testDir,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
      stderr: 'pipe',
    }),
  );
  const callAgent = (agentId: string, name: string, args: Record<string, unknown> = {}) =>
    adapter!.callTool({
      name,
      arguments: args,
      _meta: { 'openai/session': 'shared-conversation-123456', agent_id: agentId },
    });
  const statuses: any[] = [];
  for (const agent of ['agent-coder-123456', 'agent-reviewer-123456']) {
    const bound = await callAgent(agent, 'workspace', { action: 'bind', path: testDir });
    assert.notEqual(bound.isError, true);
    const config = await callAgent(agent, 'get_config');
    assert.notEqual(config.isError, true);
    // Capture each allocated worker before this suite's 300ms idle reclamation.
    statuses.push((await callAgent(agent, 'dwb_session_status')).structuredContent);
  }
  assert.notEqual(statuses[0].sessionId, statuses[1].sessionId);
  assert.notEqual(statuses[0].workerPid, statuses[1].workerPid);
  for (const status of statuses) {
    assert.ok(status.workerPid, JSON.stringify(status));
    assert.equal(status.workingDirectory, testDir);
  }

  const sharedFile = resolve(testDir, 'shared-agent-file.txt');
  await writeFile(sharedFile, 'initial\n');
  for (const agent of ['agent-coder-123456', 'agent-reviewer-123456']) {
    assert.notEqual((await callAgent(agent, 'read_file', { path: sharedFile })).isError, true);
  }
  assert.notEqual(
    (
      await callAgent('agent-coder-123456', 'write_file', {
        path: sharedFile,
        content: 'coder update\n',
        mode: 'rewrite',
      })
    ).isError,
    true,
  );
  const stale = await callAgent('agent-reviewer-123456', 'write_file', {
    path: sharedFile,
    content: 'stale reviewer update\n',
    mode: 'rewrite',
  });
  assert.equal(stale.isError, true, 'agents must keep independent stale-write observations');
  assert.match(JSON.stringify(stale), /stale-write protection/i);
  assert.equal(await readFile(sharedFile, 'utf8'), 'coder update\n');
  console.log(
    'LOGICAL_CONTEXT_PASS',
    JSON.stringify({
      workers: broker.structuredContent.activeWorkers,
      recovered: true,
      sameWorkspaceAgents: statuses.length,
      staleWritePrevented: true,
    }),
  );
} finally {
  await adapter?.close().catch(() => {});
  await client.close().catch(() => {});
  if (brokerPid) {
    try {
      process.kill(brokerPid);
    } catch {}
  }
}
