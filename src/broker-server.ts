import { RequestLifetime } from './request-lifetime.js';
import { createServer, type Socket } from 'node:net';
import { unlink } from 'node:fs/promises';
import {
  brokerEndpoint,
  BROKER_PROTOCOL_VERSION,
  type BrokerLogicalContext,
  type BrokerRequest,
  type BrokerResponse,
} from './broker-protocol.js';
import { brokerTools, textResult, NOT_A_CONTROL_TOOL } from './broker-tools.js';
import { EventLog } from './event-log.js';
import { SessionRegistry } from './session-registry.js';
import { CoreStore } from './core-store.js';
import { WorkspaceStore } from './workspace-store.js';
import { AgentTaskStore, type TaskStatus } from './agent-task-store.js';

const endpoint = brokerEndpoint();
const log = new EventLog();
let coreDb: CoreStore;
let workspaceStore: WorkspaceStore;
let agentTasks: AgentTaskStore;
let registry: SessionRegistry;
const sockets = new Set<Socket>();
let markReady!: () => void;
const ready = new Promise<void>((resolve) => {
  markReady = resolve;
});

type ConnectionContext = {
  sessionId: string | null;
  adapterPid: number | null;
  initializing: boolean;
  closed: boolean;
  routingChange: Promise<void> | null;
};

function response(socket: Socket, message: BrokerResponse): void {
  if (!socket.destroyed) socket.write(JSON.stringify(message) + '\n');
}

function errorResponse(id: string, error: unknown): BrokerResponse {
  const err = error instanceof Error ? error : new Error(String(error));
  return { id, ok: false, error: { code: err.name || 'BROKER_ERROR', message: err.message } };
}

function callParams(message: BrokerRequest) {
  const params = message.params ?? {};
  if (typeof params.name !== 'string') throw new Error('call_tool requires a tool name');
  return { name: params.name, arguments: (params.arguments ?? {}) as Record<string, unknown> };
}

function requestContext(message: BrokerRequest): BrokerLogicalContext | null {
  const raw = message.params?.context;
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.key !== 'string' || !value.key.trim()) return null;
  return {
    key: value.key.trim(),
    source: typeof value.source === 'string' ? value.source : 'unknown',
    preview: typeof value.preview === 'string' ? value.preview : undefined,
    metaKeys: Array.isArray(value.metaKeys)
      ? value.metaKeys.filter((x): x is string => typeof x === 'string').slice(0, 40)
      : undefined,
  };
}

async function controlTool(
  ctx: ConnectionContext,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
  requestId?: string,
): Promise<unknown | typeof NOT_A_CONTROL_TOOL> {
  if (!ctx.sessionId) throw new Error('MCP session is not initialized');
  if (name === 'dwb_bridge_status') {
    const session = registry.sessionStatus(sessionId) as any;
    const worker = session.workerStatus ?? {};
    const logicalWorkspace = workspaceStore.current(sessionId);
    return textResult({
      ...worker,
      ...session,
      logicalWorkspace,
      broker: registry.status,
      session: { ...session, logicalWorkspace },
    });
  }
  if (name === 'dwb_broker_status')
    return textResult({ ...registry.status, agentTasks: agentTasks.summary() });
  if (name === 'dwb_session_status') {
    const logicalWorkspace = workspaceStore.current(sessionId);
    return textResult({
      ...registry.sessionStatus(sessionId),
      logicalWorkspace,
      agent: logicalWorkspace ? agentTasks.agentForSession(sessionId, logicalWorkspace.id) : null,
      tasks: logicalWorkspace ? agentTasks.listTasks(logicalWorkspace.id) : [],
    });
  }
  if (name === 'dwb_restart_worker') return textResult(await registry.restartWorker(sessionId));
  if (name === 'dwb_list_sessions')
    return textResult({
      sessions: registry.listSessions().map((session: any) => ({
        ...session,
        logicalWorkspace: workspaceStore.current(String(session.sessionId)),
      })),
    });
  if (name === 'dwb_list_detached_sessions') {
    return textResult({
      sessions: registry.listDetached().map((session: any) => ({
        ...session,
        logicalWorkspace: workspaceStore.current(String(session.sessionId)),
      })),
    });
  }
  if (name === 'workspace') return textResult(await registry.workspace(sessionId, args));
  if (name === 'dwb_agent' || name === 'dwb_task') {
    const workspace = workspaceStore.current(sessionId);
    if (!workspace) throw new Error('Bind a workspace before using agent/task coordination.');
    const action = typeof args.action === 'string' ? args.action.trim() : '';
    if (name === 'dwb_agent') {
      if (action === 'register')
        return textResult({
          agent: agentTasks.registerAgent(sessionId, workspace.id, args as any),
        });
      if (action === 'heartbeat')
        return textResult({ agent: agentTasks.heartbeatAgent(sessionId, workspace.id) });
      if (action === 'status')
        return textResult({ agent: agentTasks.agentForSession(sessionId, workspace.id) });
      if (action === 'list') return textResult({ agents: agentTasks.listAgents(workspace.id) });
      throw new Error('dwb_agent.action must be one of: register, heartbeat, status, list.');
    }
    agentTasks.touchAgent(sessionId, workspace.id);
    if (action === 'create')
      return textResult({
        task: agentTasks.createTask(workspace.id, {
          title: args.title,
          description: args.description,
          fileScopes: args.file_scopes,
          dependsOn: args.depends_on,
        }),
      });
    if (action === 'list') {
      const status = typeof args.status === 'string' ? args.status : undefined;
      if (status && !['queued', 'doing', 'done', 'blocked', 'cancelled'].includes(status))
        throw new Error('dwb_task.status must be queued, doing, done, blocked, or cancelled.');
      return textResult({
        tasks: agentTasks.listTasks(workspace.id, status as TaskStatus | undefined),
        agent: agentTasks.agentForSession(sessionId, workspace.id),
      });
    }
    const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
    if (!taskId) throw new Error('task_id is required.');
    const agent = agentTasks.agentForSession(sessionId, workspace.id);
    if (!agent) throw new Error('Register an agent before claiming or updating tasks.');
    if (action === 'claim') return textResult({ task: agentTasks.claimTask(taskId, agent.id) });
    if (action === 'complete')
      return textResult({ task: agentTasks.completeTask(taskId, agent.id, args.result) });
    if (action === 'release') return textResult({ task: agentTasks.releaseTask(taskId, agent.id) });
    if (action === 'block')
      return textResult({
        task: agentTasks.blockTask(
          taskId,
          agent.id,
          typeof args.reason === 'string' ? args.reason : '',
        ),
      });
    if (action === 'cancel') return textResult({ task: agentTasks.cancelTask(taskId, agent.id) });
    if (action === 'reopen') return textResult({ task: agentTasks.reopenTask(taskId, agent.id) });
    if (action === 'history')
      return textResult({
        task: agentTasks.getTask(taskId),
        events: agentTasks.listTaskEvents(taskId),
      });
    throw new Error(
      'dwb_task.action must be one of: create, list, claim, complete, release, block, cancel, reopen, history.',
    );
  }
  if (name === 'dwb_resume_session') {
    const target = args.session_id;
    if (typeof target !== 'string' || !target) throw new Error('session_id is required');
    let resumedId: string;
    ctx.routingChange = registry.resume(sessionId, target, ctx.adapterPid).then(async (id) => {
      resumedId = id;
      if (sessionId === ctx.sessionId) ctx.sessionId = id;
      if (ctx.closed && ctx.sessionId) await registry.detach(ctx.sessionId);
    });
    try {
      await ctx.routingChange;
      return textResult({ resumed: true, session: registry.sessionStatus(resumedId!) });
    } finally {
      ctx.routingChange = null;
    }
  }
  return NOT_A_CONTROL_TOOL;
}

async function handle(
  ctx: ConnectionContext,
  message: BrokerRequest,
  lifetime: RequestLifetime,
): Promise<unknown> {
  await ready;
  await ctx.routingChange?.catch(() => {});
  lifetime.check();
  if (ctx.closed || shuttingDown) throw new Error('Broker connection is closing');
  if (message.method === 'hello') {
    if (ctx.sessionId || ctx.initializing) throw new Error('Connection already initialized');
    ctx.initializing = true;
    const cwd = typeof message.params?.cwd === 'string' ? message.params.cwd : process.cwd();
    const adapterPid =
      typeof message.params?.adapterPid === 'number' ? message.params.adapterPid : null;
    const preferredSessionId =
      typeof message.params?.sessionId === 'string' ? message.params.sessionId : null;
    ctx.adapterPid = adapterPid;
    try {
      ctx.sessionId = await registry.attach(cwd, adapterPid, preferredSessionId);
      if (ctx.closed) await registry.detach(ctx.sessionId);
    } finally {
      ctx.initializing = false;
    }
    return {
      protocolVersion: BROKER_PROTOCOL_VERSION,
      sessionId: ctx.sessionId,
      broker: registry.status,
    };
  }
  if (message.method === 'prepare_upgrade') {
    lifetime.begin();
    await registry.prepareUpgrade();
    setTimeout(() => void shutdown(0), 25).unref();
    return { shuttingDown: true, broker: registry.status };
  }
  if (message.method === 'ping') return { pong: true, broker: registry.status };
  // Local monitoring must not attach a session, allocate a worker or refresh activity.
  if (message.method === 'inspect') {
    const sessions = registry.listSessions();
    return {
      broker: registry.status,
      agentTasks: agentTasks.summary(),
      totalSessions: sessions.length,
      sessions: sessions.slice(0, 200).map((session) => ({
        sessionId: session.sessionId,
        state: session.state,
        workingDirectory: session.workingDirectory,
        workspaceName: workspaceStore.current(session.sessionId)?.name ?? null,
        workerPid: session.workerPid,
        ready: session.workerStatus?.ready ?? false,
        inFlight: session.inFlight,
        queued: session.queued,
        queuePosition: session.queuePosition,
        lastActivityAt: session.lastActivityAt,
        restartCount: session.workerStatus?.restartCount ?? 0,
      })),
    };
  }
  if (!ctx.sessionId) throw new Error('hello must be sent before broker requests');
  const sessionId = await registry.resolveContext(ctx.sessionId, requestContext(message));
  if (message.method === 'list_tools') {
    const upstream = await registry.listTools(sessionId, lifetime);
    return { ...upstream, tools: [...upstream.tools, ...brokerTools] };
  }
  if (message.method === 'call_tool') {
    const params = callParams(message);
    lifetime.check();
    const isControl = brokerTools.some((tool) => tool.name === params.name);
    if (isControl) lifetime.begin();
    const controlled = await controlTool(ctx, sessionId, params.name, params.arguments, message.id);
    if (controlled !== NOT_A_CONTROL_TOOL) return controlled;
    return registry.callTool(sessionId, message.id, params, lifetime);
  }
  if (message.method === 'list_resources') return registry.listResources(sessionId, lifetime);
  if (message.method === 'list_resource_templates')
    return registry.listResourceTemplates(sessionId, lifetime);
  if (message.method === 'read_resource') {
    const uri = message.params?.uri;
    if (typeof uri !== 'string' || !uri) throw new Error('read_resource requires uri');
    return registry.readResource(sessionId, uri, lifetime);
  }
  if (message.method === 'shutdown') {
    if (process.env.DWB_BROKER_ALLOW_SHUTDOWN !== 'true')
      throw new Error('Broker shutdown is disabled');
    setTimeout(() => void shutdown(0), 25).unref();
    return { shuttingDown: true };
  }
  throw new Error(`Unsupported broker method: ${message.method}`);
}

function accept(socket: Socket): void {
  sockets.add(socket);
  const ctx: ConnectionContext = {
    sessionId: null,
    adapterPid: null,
    initializing: false,
    closed: false,
    routingChange: null,
  };
  const requests = new Map<string, RequestLifetime>();
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 8 * 1024 * 1024) {
      socket.destroy();
      return;
    }
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message: BrokerRequest;
      try {
        message = JSON.parse(line);
      } catch (error) {
        response(socket, errorResponse('invalid-json', error));
        continue;
      }
      if (!message?.id || !message?.method) {
        response(socket, {
          id: message?.id ?? 'invalid-request',
          ok: false,
          error: { code: 'INVALID_REQUEST', message: 'id and method are required' },
        });
        continue;
      }
      if (message.method === 'cancel') {
        requests.get(String(message.params?.requestId))?.cancel();
        continue;
      }
      if (requests.has(message.id) || requests.size >= 128) {
        response(
          socket,
          errorResponse(
            message.id,
            new Error('DWB_REQUEST_LIMIT: duplicate ID or too many pending requests'),
          ),
        );
        continue;
      }
      const deadline =
        typeof message.deadline === 'number' && Number.isFinite(message.deadline)
          ? message.deadline
          : Date.now() + 120_000;
      const lifetime = new RequestLifetime(deadline);
      requests.set(message.id, lifetime);
      let replied = false;
      const reply = (value: BrokerResponse) => {
        if (!replied) {
          replied = true;
          response(socket, value);
        }
      };
      lifetime.signal.addEventListener(
        'abort',
        () => reply(errorResponse(message.id, lifetime.error())),
        { once: true },
      );
      const timer = setTimeout(
        () => lifetime.cancel(),
        Math.max(0, Math.min(deadline - Date.now(), 120_000)),
      );
      if (deadline <= Date.now()) lifetime.cancel();
      void handle(ctx, message, lifetime)
        .then((result) =>
          reply({
            id: message.id,
            ok: true,
            result,
            sessionId: ctx.sessionId ?? undefined,
          }),
        )
        .catch((error) => reply(errorResponse(message.id, error)))
        .finally(() => {
          clearTimeout(timer);
          requests.delete(message.id);
        });
    }
  });
  socket.on('close', () => {
    sockets.delete(socket);
    ctx.closed = true;
    for (const request of requests.values()) request.cancel();
    if (ctx.sessionId) void registry.detach(ctx.sessionId).catch(() => {});
  });
  socket.on('error', () => {});
}

const server = createServer(accept);
let shuttingDown = false;
let heartbeat: NodeJS.Timeout | null = null;

async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  for (const socket of sockets) socket.destroy();
  await registry?.shutdown().catch(() => {});
  await log
    .write({ type: 'broker_stopped', details: { brokerPid: process.pid, endpoint } })
    .catch(() => {});
  await closed;
  try {
    coreDb?.close();
  } catch {}
  if (process.platform !== 'win32') await unlink(endpoint).catch(() => {});
  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

async function main(): Promise<void> {
  if (process.platform !== 'win32') await unlink(endpoint).catch(() => {});
  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(endpoint);
  });
  // Claim the endpoint before opening SQLite: simultaneous cold starts must not
  // race journal/schema initialization or rewrite the live broker's state.
  coreDb = new CoreStore();
  workspaceStore = new WorkspaceStore(coreDb);
  agentTasks = new AgentTaskStore(coreDb, workspaceStore);
  registry = new SessionRegistry(log, workspaceStore, undefined, agentTasks);
  await registry.restore();
  markReady();
  await log.write({
    type: 'broker_started',
    details: {
      endpoint,
      protocolVersion: BROKER_PROTOCOL_VERSION,
      ...registry.status,
      sessionList: registry.listSessions(),
    },
  });
  heartbeat = setInterval(() => {
    void (async () => {
      await registry.reclaimIdleWorkers();
      const reclaimed = agentTasks.reclaimStaleAgents();
      if (reclaimed.agents || reclaimed.tasks)
        await log.write({ type: 'agent_lease_reclaimed', details: reclaimed });
      await log.write({
        type: 'broker_heartbeat',
        details: { endpoint, ...registry.status, sessionList: registry.listSessions() },
      });
    })().catch(() => {});
  }, 15_000);
  heartbeat.unref();
  console.error(`DWB_BROKER_READY ${endpoint} PID ${process.pid}`);
}

main().catch(async (error: any) => {
  if (error?.code === 'EADDRINUSE') process.exit(0);
  await log
    .write({
      type: 'broker_fatal',
      ok: false,
      details: { brokerPid: process.pid, endpoint, error: String(error) },
    })
    .catch(() => {});
  console.error('[dwb-desktop-broker] fatal:', error);
  process.exit(1);
});
