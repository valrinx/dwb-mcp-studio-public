import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(resolve(root, 'logs'), { recursive: true });
const testDir = await mkdtemp(resolve(root, 'logs', 'public-core-'));
const relocated = resolve(testDir, 'relocated core with spaces');
for (const name of ['dist', 'scripts'])
  await cp(resolve(root, name), resolve(relocated, name), { recursive: true });
await cp(resolve(root, 'package.json'), resolve(relocated, 'package.json'));
const fixture = resolve(testDir, 'user installed worker', 'dist');
await mkdir(fixture, { recursive: true });
// This fixture is our own test double, not Desktop Commander source.
await writeFile(
  resolve(fixture, '..', 'package.json'),
  JSON.stringify({ name: '@wonderwhy-er/desktop-commander', version: '0.2.50', type: 'module' }),
);
const original = "import os from 'node:os';\nexport const USER_HOME = os.homedir();\n";
await writeFile(resolve(fixture, 'config.js'), original);
await writeFile(
  resolve(fixture, 'index.js'),
  `
import os from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { USER_HOME } from './config.js';
const server = new Server({name:'dwb-test-double', version:'1'}, {capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema, async () => ({tools:['get_config','read_file','write_file'].map(name=>({name,inputSchema:{type:'object',additionalProperties:true}}))}));
server.setRequestHandler(CallToolRequestSchema, async request => {
 const args=request.params.arguments || {};
 let value;
 if(request.params.name === 'get_config') value={configHome:USER_HOME,osHome:os.homedir(),pid:process.pid,cwd:process.cwd()};
 else if(request.params.name === 'list_sessions') value='No active sessions';
 else if(request.params.name === 'list_searches') value='No active searches';
 else if(request.params.name === 'read_file') value=await readFile(args.path,'utf8');
 else if(request.params.name === 'write_file') { if(args.delay) await new Promise(r=>setTimeout(r,args.delay)); await writeFile(args.path,args.content); value='written'; }
 else value=[];
 return {content:[{type:'text',text:JSON.stringify(value)}]};
});
await server.connect(new StdioServerTransport());
`,
);
const env = {
  ...process.env,
  DWB_DATA_DIR: resolve(testDir, 'user data'),
  DWB_CONFIG_FILE: resolve(testDir, 'user data', 'config.json'),
  DWB_BROKER_ALLOW_SHUTDOWN: 'true',
  DWB_RUNTIME_DIR: resolve(testDir, 'runtime'),
  DWB_BROKER_STATE_PATH: resolve(testDir, 'runtime', 'broker-state.json'),
  DWB_WORKSPACE_DB: resolve(testDir, 'runtime', 'workspaces.db'),
  DWB_EVENT_LOG_PATH: resolve(testDir, 'events.jsonl'),
};
for (const key of [
  'DWB_WORKER_ENTRY',
  'DWB_WORKER_CAP',
  'DWB_WORKSPACE',
  'DWB_BASE_DC_CONFIG',
  'DWB_BROKER_PIPE',
])
  delete env[key];
function run(script, args = [], expected = 0) {
  const result = spawnSync(process.execPath, [resolve(relocated, 'scripts', script), ...args], {
    env,
    encoding: 'utf8',
    timeout: 20000,
    windowsHide: true,
  });
  assert.equal(result.status, expected, result.stderr || result.error?.message);
  return result;
}
assert.match(run('doctor.mjs', [], 1).stderr, /DWB_WORKER_ENTRY/);
run('configure.mjs', [
  '--worker-entry',
  resolve(fixture, 'index.js'),
  '--workspace',
  testDir,
  '--worker-cap',
  '2',
]);
const report = JSON.parse(run('doctor.mjs').stdout);
assert.equal(report.ok, true);
assert.equal(report.workerCap, 2);
assert.equal(report.runtime.state, 'stopped');
assert.equal(JSON.parse(run('dashboard-probe.mjs').stdout).state, 'stopped');
assert.ok(report.brokerEndpoint.includes('dwb-mcp-studio-core'));
const policyPath = resolve(testDir, 'user data', 'base-policy.json');
const customPolicy = { allowedDirectories: [testDir], fileReadLineLimit: 123 };
await writeFile(policyPath, JSON.stringify(customPolicy));
run('configure.mjs', ['--worker-entry', resolve(fixture, 'index.js'), '--workspace', testDir]);
assert.deepEqual(
  JSON.parse(await readFile(policyPath)),
  customPolicy,
  'Configure must preserve a user-edited policy.',
);
const clientConfig = JSON.parse(await readFile(resolve(testDir, 'user data', 'mcp-client.json')))
  .mcpServers['dwb-core'];
assert.equal(clientConfig.args[0], resolve(relocated, 'scripts', 'start.mjs'));

const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
const { LoggingMessageNotificationSchema } = await import('@modelcontextprotocol/sdk/types.js');
const clients = [];
let brokerPid;
const call = (client, name, args = {}) => client.callTool({ name, arguments: args });
const waitFor = async (predicate, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error('Timed out waiting for broker notification');
};
try {
  for (let n = 0; n < 2; n++) {
    const transport = new StdioClientTransport({
      command: clientConfig.command,
      args: clientConfig.args,
      env,
      stderr: 'pipe',
    });
    const client = new Client({ name: `public-core-${n}`, version: '1' });
    clients.push({ client, transport });
    await client.connect(transport);
  }
  const [a, b] = clients.map((c) => c.client);
  const notifications = { a: [], b: [] };
  a.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
    notifications.a.push(notification.params.data);
  });
  b.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
    notifications.b.push(notification.params.data);
  });
  brokerPid = (await call(a, 'dwb_broker_status')).structuredContent.brokerPid;
  const beforeDoctor = (await call(a, 'dwb_broker_status')).structuredContent;
  const liveReport = JSON.parse(run('doctor.mjs').stdout);
  assert.equal(liveReport.runtime.state, 'running');
  assert.equal(liveReport.runtime.brokerPid, brokerPid);
  assert.equal(
    liveReport.runtime.sessions,
    beforeDoctor.sessions,
    'Doctor must not attach a session',
  );
  assert.equal(
    liveReport.runtime.activeWorkers,
    beforeDoctor.activeWorkers,
    'Doctor must not spawn a worker',
  );
  const dashboard = JSON.parse(run('dashboard-probe.mjs').stdout);
  assert.equal(dashboard.state, 'running');
  assert.equal(dashboard.broker.sessions, beforeDoctor.sessions, 'Dashboard must not attach');
  assert.equal(
    dashboard.broker.activeWorkers,
    beforeDoctor.activeWorkers,
    'Dashboard must not allocate',
  );
  assert.equal(dashboard.sessions.length, beforeDoctor.sessions);
  assert.equal(dashboard.sessions[0].workingDirectory, testDir);
  const secondSnapshot = JSON.parse(run('dashboard-probe.mjs').stdout);
  assert.deepEqual(
    secondSnapshot.sessions.map((s) => s.lastActivityAt),
    dashboard.sessions.map((s) => s.lastActivityAt),
    'Dashboard polling must not keep idle workers alive',
  );
  const surface = (await a.listTools()).tools.map((t) => t.name);
  assert.deepEqual(
    surface.filter((n) => !['get_config', 'read_file', 'write_file'].includes(n)).sort(),
    [
      'dwb_bridge_status',
      'dwb_broker_status',
      'dwb_session_status',
      'dwb_restart_worker',
      'dwb_list_sessions',
      'dwb_list_detached_sessions',
      'dwb_resume_session',
      'dwb_agent',
      'dwb_task',
      'workspace',
    ].sort(),
  );
  const configA = JSON.parse((await call(a, 'get_config')).content[0].text);
  const configB = JSON.parse((await call(b, 'get_config')).content[0].text);
  assert.notEqual(configA.pid, configB.pid);
  const activeDashboard = JSON.parse(run('dashboard-probe.mjs').stdout);
  assert.equal(activeDashboard.broker.activeWorkers, 2);
  assert.deepEqual(
    activeDashboard.sessions.map((s) => s.workerPid).sort(),
    [configA.pid, configB.pid].sort(),
  );
  await writeFile(resolve(testDir, 'dashboard-snapshot.json'), JSON.stringify(activeDashboard));
  assert.notEqual(configA.configHome, configB.configHome);
  assert.equal(configA.osHome, homedir());
  assert.equal(configB.osHome, homedir());
  assert.equal(await readFile(resolve(fixture, 'config.js'), 'utf8'), original);
  const bound = resolve(testDir, 'workspace');
  await mkdir(bound);
  await call(a, 'workspace', { action: 'bind', workspace: bound });
  const reboundConfig = JSON.parse((await call(a, 'get_config')).content[0].text);
  assert.equal(reboundConfig.cwd, bound);
  assert.notEqual(reboundConfig.pid, configA.pid);
  assert.equal(JSON.parse((await call(b, 'get_config')).content[0].text).pid, configB.pid);
  await call(a, 'write_file', { path: 'relative.txt', content: 'in the bound workspace' });
  assert.equal(await readFile(resolve(bound, 'relative.txt'), 'utf8'), 'in the bound workspace');
  const outside = await call(a, 'write_file', {
    path: resolve(testDir, 'outside.txt'),
    content: 'must not write',
  });
  assert.equal(outside.isError, true);
  assert.match(outside.content[0].text, /DWB_WORKSPACE_BOUNDARY/);
  const file = resolve(bound, 'shared.txt');
  await writeFile(file, 'one');
  await call(a, 'read_file', { path: file });
  await call(b, 'write_file', { path: file, content: 'two' });
  assert.equal((await call(a, 'write_file', { path: file, content: 'stale' })).isError, true);
  assert.equal(await readFile(file, 'utf8'), 'two');
  await call(a, 'read_file', { path: file });
  assert.notEqual(
    (await call(a, 'write_file', { path: file, content: 'reconciled' })).isError,
    true,
  );
  assert.equal(await readFile(file, 'utf8'), 'reconciled');
  await call(b, 'workspace', { action: 'bind', workspace: bound });
  await mkdir(resolve(bound, 'src', 'backend'), { recursive: true });
  await mkdir(resolve(bound, 'src', 'frontend'), { recursive: true });
  const agentA = (
    await call(a, 'dwb_agent', {
      action: 'register',
      name: 'backend-agent',
      role: 'backend',
      capabilities: ['typescript', 'api'],
    })
  ).structuredContent.agent;
  const agentB = (
    await call(b, 'dwb_agent', {
      action: 'register',
      name: 'frontend-agent',
      role: 'frontend',
      capabilities: ['typescript', 'ui'],
    })
  ).structuredContent.agent;
  assert.equal(agentA.workspaceId, agentB.workspaceId);
  const waitingForDirectMessage = call(b, 'dwb_agent', { action: 'wait', timeout_ms: 2000 });
  const directMessage = (
    await call(a, 'dwb_agent', {
      action: 'send',
      to_agent_id: agentB.id,
      message: 'Please report your current progress.',
    })
  ).structuredContent.message;
  assert.equal(directMessage.kind, 'agent_message');
  assert.equal(directMessage.payload.text, 'Please report your current progress.');
  const waitedDirectMessage = (await waitingForDirectMessage).structuredContent;
  assert.ok(waitedDirectMessage.messages.some((message) => message.id === directMessage.id));
  const directAcknowledgement = (
    await call(b, 'dwb_agent', { action: 'ack', message_id: directMessage.id })
  ).structuredContent;
  assert.equal(directAcknowledgement.response.kind, 'agent_message_ack');
  const backendTask = (
    await call(a, 'dwb_task', {
      action: 'create',
      title: 'Backend lane',
      file_scopes: ['src/backend/**'],
    })
  ).structuredContent.task;
  const frontendTask = (
    await call(a, 'dwb_task', {
      action: 'create',
      title: 'Frontend lane',
      file_scopes: ['src/frontend/**'],
    })
  ).structuredContent.task;
  assert.deepEqual(
    (await call(a, 'dwb_agent', { action: 'list' })).structuredContent.agents.map((agent) => ({
      role: agent.role,
      status: agent.status,
      capabilities: agent.capabilities,
    })),
    [
      { role: 'backend', status: 'active', capabilities: ['typescript', 'api'] },
      { role: 'frontend', status: 'active', capabilities: ['typescript', 'ui'] },
    ],
  );
  const waitingForAssignment = call(b, 'dwb_agent', { action: 'wait', timeout_ms: 2000 });
  const delegatedTask = (
    await call(a, 'dwb_task', {
      action: 'delegate',
      title: 'Delegated frontend lane',
      description: 'Main agent delegated this lane to the frontend worker.',
      file_scopes: ['src/delegated/**'],
      required_role: 'frontend',
      required_capabilities: ['ui'],
    })
  ).structuredContent;
  assert.equal(delegatedTask.task.status, 'doing');
  assert.equal(delegatedTask.dispatched, true);
  const waitedAssignment = (await waitingForAssignment).structuredContent;
  assert.ok(
    waitedAssignment.messages.some(
      (message) =>
        message.kind === 'task_assigned' && message.targetTaskId === delegatedTask.task.id,
    ),
  );
  await waitFor(() =>
    notifications.b.some(
      (data) => data?.type === 'agent_message' && data.message?.kind === 'task_assigned',
    ),
  );
  const assignmentNotification = notifications.b.find(
    (data) => data?.type === 'agent_message' && data.message?.kind === 'task_assigned',
  );
  assert.equal(assignmentNotification.message.targetTaskId, delegatedTask.task.id);
  const assignmentAck = (
    await call(b, 'dwb_agent', {
      action: 'ack',
      message_id: assignmentNotification.message.id,
    })
  ).structuredContent;
  assert.equal(assignmentAck.message.status, 'acknowledged');
  assert.equal(assignmentAck.response.kind, 'task_assignment_ack');
  await waitFor(() =>
    notifications.a.some(
      (data) => data?.type === 'agent_message' && data.message?.kind === 'task_assignment_ack',
    ),
  );
  assert.equal(
    (
      await call(b, 'dwb_task', {
        action: 'complete',
        task_id: delegatedTask.task.id,
        changed_files: ['src/delegated/index.ts'],
        summary: 'Delegated lane completed.',
        test_result: { passed: true },
      })
    ).structuredContent.task.status,
    'done',
  );
  assert.equal(
    (await call(a, 'dwb_task', { action: 'claim', task_id: backendTask.id })).structuredContent.task
      .status,
    'doing',
  );
  assert.equal(
    (await call(b, 'dwb_task', { action: 'claim', task_id: frontendTask.id })).structuredContent
      .task.status,
    'doing',
  );
  assert.notEqual(
    (
      await call(a, 'write_file', {
        path: resolve(bound, 'src', 'backend', 'index.ts'),
        content: 'backend',
      })
    ).isError,
    true,
  );
  const wrongLane = await call(a, 'write_file', {
    path: resolve(bound, 'src', 'frontend', 'index.ts'),
    content: 'must be blocked',
  });
  assert.equal(wrongLane.isError, true);
  assert.match(wrongLane.content[0].text, /DWB_TASK_SCOPE/);
  assert.notEqual(
    (
      await call(b, 'write_file', {
        path: resolve(bound, 'src', 'frontend', 'index.ts'),
        content: 'frontend',
      })
    ).isError,
    true,
  );
  const backendCompletion = await call(a, 'dwb_task', {
    action: 'complete',
    task_id: backendTask.id,
    result: { artifact: 'backend-ready' },
    summary: 'Implemented the backend lane and added coverage.',
    changed_files: ['src/backend/index.ts'],
    test_result: { command: 'npm test -- backend', passed: true },
  });
  assert.equal(backendCompletion.structuredContent.task.status, 'done');
  assert.deepEqual(backendCompletion.structuredContent.task.handoff, {
    summary: 'Implemented the backend lane and added coverage.',
    changedFiles: ['src/backend/index.ts'],
    testResult: { command: 'npm test -- backend', passed: true },
  });
  const backendHandoff = await call(b, 'dwb_task', {
    action: 'handoff',
    task_id: backendTask.id,
  });
  assert.deepEqual(
    backendHandoff.structuredContent.handoff,
    backendCompletion.structuredContent.task.handoff,
  );
  assert.equal(backendHandoff.structuredContent.task.result.artifact, 'backend-ready');
  assert.equal(
    (await call(b, 'dwb_task', { action: 'complete', task_id: frontendTask.id })).structuredContent
      .task.status,
    'done',
  );
  const reviewTask = (
    await call(a, 'dwb_task', {
      action: 'create',
      title: 'Review backend handoff',
      file_scopes: ['src/review/**'],
      depends_on: [backendTask.id],
      required_role: 'frontend',
      required_capabilities: ['ui'],
    })
  ).structuredContent.task;
  const dispatchedReview = (
    await call(a, 'dwb_task', { action: 'dispatch', task_id: reviewTask.id })
  ).structuredContent.task;
  assert.equal(dispatchedReview.assignedAgentId, agentB.id);
  await waitFor(() =>
    notifications.b.some(
      (data) => data?.type === 'agent_message' && data.message?.kind === 'task_handoff',
    ),
  );
  const handoffNotification = notifications.b.find(
    (data) => data?.type === 'agent_message' && data.message?.kind === 'task_handoff',
  );
  assert.equal(handoffNotification.message.targetTaskId, reviewTask.id);
  const inbox = (await call(b, 'dwb_agent', { action: 'inbox' })).structuredContent.messages;
  assert.ok(inbox.some((message) => message.id === handoffNotification.message.id));
  const acknowledgement = (
    await call(b, 'dwb_agent', {
      action: 'ack',
      message_id: handoffNotification.message.id,
    })
  ).structuredContent;
  assert.equal(acknowledgement.message.status, 'acknowledged');
  await waitFor(() =>
    notifications.a.some(
      (data) => data?.type === 'agent_message' && data.message?.kind === 'handoff_ack',
    ),
  );
  const dispatchTask = (
    await call(a, 'dwb_task', {
      action: 'create',
      title: 'Dispatched API lane',
      file_scopes: ['src/dispatch/**'],
      required_role: 'backend',
      required_capabilities: ['typescript', 'api'],
      priority: 20,
    })
  ).structuredContent.task;
  assert.equal(
    (await call(a, 'dwb_task', { action: 'dispatch', task_id: dispatchTask.id })).structuredContent
      .task.assignedAgentId,
    agentA.id,
  );
  assert.equal(
    (await call(a, 'dwb_agent', { action: 'heartbeat' })).structuredContent.agent.status,
    'active',
  );
  const lifecycleTask = (
    await call(a, 'dwb_task', {
      action: 'create',
      title: 'Lifecycle lane',
      file_scopes: ['src/lifecycle/**'],
    })
  ).structuredContent.task;
  assert.equal(
    (await call(a, 'dwb_task', { action: 'claim', task_id: lifecycleTask.id })).structuredContent
      .task.status,
    'doing',
  );
  assert.equal(
    (
      await call(a, 'dwb_task', {
        action: 'block',
        task_id: lifecycleTask.id,
        reason: 'Waiting for review',
      })
    ).structuredContent.task.status,
    'blocked',
  );
  assert.equal(
    (await call(a, 'dwb_task', { action: 'reopen', task_id: lifecycleTask.id })).structuredContent
      .task.status,
    'queued',
  );
  assert.equal(
    (await call(a, 'dwb_task', { action: 'claim', task_id: lifecycleTask.id })).structuredContent
      .task.status,
    'doing',
  );
  assert.equal(
    (await call(a, 'dwb_task', { action: 'cancel', task_id: lifecycleTask.id })).structuredContent
      .task.status,
    'cancelled',
  );
  const history = (await call(a, 'dwb_task', { action: 'history', task_id: lifecycleTask.id }))
    .structuredContent.events;
  assert.ok(history.some((event) => event.toStatus === 'blocked'));
  const stateBefore = await readFile(env.DWB_BROKER_STATE_PATH, 'utf8');
  const duplicate = spawnSync(process.execPath, [resolve(relocated, 'dist', 'broker-server.js')], {
    env,
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  assert.equal(duplicate.status, 0, duplicate.stderr);
  assert.equal(
    await readFile(env.DWB_BROKER_STATE_PATH, 'utf8'),
    stateBefore,
    'A losing broker startup must not rewrite the live broker state',
  );
  const replies = await new Promise((resolveReplies, reject) => {
    const socket = createConnection(report.brokerEndpoint);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Duplicate hello timed out'));
    }, 5000);
    let buffer = '';
    const messages = [];
    socket.setEncoding('utf8');
    socket.on('connect', () =>
      socket.write(
        [1, 2]
          .map((id) =>
            JSON.stringify({
              id: String(id),
              method: 'hello',
              params: { cwd: testDir },
            }),
          )
          .join('\n') + '\n',
      ),
    );
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        messages.push(JSON.parse(buffer.slice(0, newline)));
        buffer = buffer.slice(newline + 1);
      }
      if (messages.length === 2) {
        clearTimeout(timer);
        socket.destroy();
        resolveReplies(messages);
      }
    });
  });
  assert.equal(
    replies.filter((message) => message.ok).length,
    1,
    'One connection can attach only once',
  );
  // Exercise deadlines over the real broker wire, including its response contract.
  const socket = createConnection(report.brokerEndpoint);
  socket.setEncoding('utf8');
  await new Promise((done, reject) => {
    socket.once('connect', done);
    socket.once('error', reject);
  });
  let wireBuffer = '';
  let nextId = 0;
  const pending = new Map();
  const counts = new Map();
  socket.on('data', (chunk) => {
    wireBuffer += chunk;
    let end;
    while ((end = wireBuffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(wireBuffer.slice(0, end));
      wireBuffer = wireBuffer.slice(end + 1);
      counts.set(message.id, (counts.get(message.id) ?? 0) + 1);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  const rpc = (method, params = {}, timeout = 5000) =>
    new Promise((done, reject) => {
      const id = 'wire-' + ++nextId;
      const timer = setTimeout(() => reject(new Error('Wire request timed out: ' + method)), 8000);
      pending.set(id, (value) => {
        clearTimeout(timer);
        done(value);
      });
      socket.write(JSON.stringify({ id, method, params, deadline: Date.now() + timeout }) + '\n');
    });
  try {
    assert.equal((await rpc('hello', { cwd: testDir })).ok, true);
    const queuedPath = resolve(testDir, 'cancelled-before-dispatch.txt');
    const queued = await rpc(
      'call_tool',
      { name: 'write_file', arguments: { path: queuedPath, content: 'must not exist' } },
      40,
    );
    assert.equal(queued.error.code, 'DWB_REQUEST_CANCELLED');
    await assert.rejects(readFile(queuedPath), { code: 'ENOENT' });
    assert.equal((await rpc('inspect')).result.broker.queueDepth, 0);
    for (const entry of clients) await entry.client.close();
    await rpc('call_tool', { name: 'get_config' });
    const delayedPath = resolve(testDir, 'completed-after-deadline.txt');
    const dispatched = await rpc(
      'call_tool',
      {
        name: 'write_file',
        arguments: { path: delayedPath, content: 'completed once', delay: 250 },
      },
      75,
    );
    assert.equal(dispatched.error.code, 'DWB_OUTCOME_PENDING');
    const busy = await rpc('prepare_upgrade');
    assert.match(busy.error.message, /DWB_UPGRADE_BUSY/);
    await new Promise((done) => setTimeout(done, 350));
    assert.equal(await readFile(delayedPath, 'utf8'), 'completed once');
    assert.equal(
      counts.get(dispatched.id),
      1,
      'A deadline must not produce a second reply after completion',
    );
    assert.equal((await rpc('inspect')).result.broker.inFlightCalls, 0);
    const prepared = await rpc('prepare_upgrade');
    assert.equal(prepared.ok, true);
    assert.equal(prepared.result.shuttingDown, true);
  } finally {
    socket.destroy();
  }
  console.log(
    'PUBLIC_CORE_PASS: relocated launcher, generated config, missing dependency, read-only Doctor, core-only tools, 2 isolated workers, real OS home, unchanged external files, workspace boundary, stale-write protection, broker singleton, duplicate hello',
  );
} finally {
  if (brokerPid) {
    try {
      process.kill(brokerPid);
    } catch {}
  }
  for (const { client, transport } of clients) {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}
