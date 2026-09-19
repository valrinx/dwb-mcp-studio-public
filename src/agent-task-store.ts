import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { CoreStore } from './core-store.js';
import { WorkspaceStore, pathWithin, type WorkspaceView } from './workspace-store.js';

export type AgentStatus = 'active' | 'paused';
export type TaskStatus = 'queued' | 'doing' | 'done' | 'blocked' | 'cancelled';

export type AgentView = {
  id: string;
  workspaceId: string;
  sessionId: string;
  name: string;
  role: string | null;
  capabilities: string[];
  status: AgentStatus;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskView = {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  requiredRole: string | null;
  requiredCapabilities: string[];
  priority: number;
  status: TaskStatus;
  assignedAgentId: string | null;
  fileScopes: string[];
  dependsOn: string[];
  result: unknown;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type TaskEventView = {
  id: number;
  taskId: string;
  timestamp: string;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus;
  agentId: string | null;
  details: Record<string, unknown>;
};

type AgentInput = { name: unknown; role?: unknown; capabilities?: unknown };
type TaskInput = {
  title: unknown;
  description?: unknown;
  fileScopes?: unknown;
  dependsOn?: unknown;
  requiredRole?: unknown;
  requiredCapabilities?: unknown;
  priority?: unknown;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : [];
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return value == null ? fallback : (JSON.parse(String(value)) as T);
  } catch {
    return fallback;
  }
}

function scopeRoot(scope: string): string {
  const wildcard = scope.search(/[?*]/);
  return (wildcard < 0 ? scope : scope.slice(0, wildcard)).replace(/\/+$/, '');
}

function scopeOverlaps(left: string, right: string): boolean {
  if (!left || !right) return true;
  const a = scopeRoot(left);
  const b = scopeRoot(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function scopeMatches(scope: string, target: string): boolean {
  const escaped = scope
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((piece) =>
          piece
            .split('?')
            .map((value) => value.replace(/[|\\{}()[\]^$+\-.]/g, '\\$&'))
            .join('[^/]'),
        )
        .join('[^/]*'),
    )
    .join('.*');
  const regex = new RegExp(`^${escaped}(?:/.*)?$`, 'i');
  return regex.test(target);
}

export class AgentTaskStore {
  private readonly agentLeaseMs = Math.max(
    5_000,
    Number.isFinite(Number(process.env.DWB_AGENT_LEASE_MS))
      ? Number(process.env.DWB_AGENT_LEASE_MS)
      : 2 * 60_000,
  );

  constructor(
    private readonly db: CoreStore,
    private readonly workspaces: WorkspaceStore,
  ) {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS workspace_agents (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT,
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        last_seen_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    try {
      this.db.run('ALTER TABLE workspace_agents ADD COLUMN last_seen_at TEXT');
    } catch {}
    try {
      this.db.run(
        "ALTER TABLE workspace_agents ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]'",
      );
    } catch {}
    this.db.run(`
      CREATE TABLE IF NOT EXISTS workspace_tasks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        required_role TEXT,
        required_capabilities_json TEXT NOT NULL DEFAULT '[]',
        priority INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        assigned_agent_id TEXT,
        file_scopes_json TEXT NOT NULL,
        depends_on_json TEXT NOT NULL,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      )
    `);
    for (const column of [
      'ALTER TABLE workspace_tasks ADD COLUMN required_role TEXT',
      "ALTER TABLE workspace_tasks ADD COLUMN required_capabilities_json TEXT NOT NULL DEFAULT '[]'",
      'ALTER TABLE workspace_tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0',
    ]) {
      try {
        this.db.run(column);
      } catch {}
    }
    this.db.run(`
      CREATE TABLE IF NOT EXISTS workspace_task_events (
        id INTEGER PRIMARY KEY,
        task_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        ts TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        agent_id TEXT,
        details_json TEXT
      )
    `);
  }

  private workspace(id: string): WorkspaceView {
    return this.workspaces.resolveRef(id);
  }

  private agentRow(id: string) {
    return this.db.one<any>('SELECT * FROM workspace_agents WHERE id=?', [id]);
  }

  private taskRow(id: string) {
    return this.db.one<any>('SELECT * FROM workspace_tasks WHERE id=?', [id]);
  }

  private agentView(row: any): AgentView {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      sessionId: String(row.session_id),
      name: String(row.name),
      role: row.role == null ? null : String(row.role),
      capabilities: parseJson<string[]>(row.capabilities_json, []),
      status: String(row.status) as AgentStatus,
      lastSeenAt: String(row.last_seen_at ?? row.updated_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private taskView(row: any): TaskView {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      title: String(row.title),
      description: String(row.description),
      requiredRole: row.required_role == null ? null : String(row.required_role),
      requiredCapabilities: parseJson<string[]>(row.required_capabilities_json, []),
      priority: Number(row.priority ?? 0),
      status: String(row.status) as TaskStatus,
      assignedAgentId: row.assigned_agent_id == null ? null : String(row.assigned_agent_id),
      fileScopes: parseJson<string[]>(row.file_scopes_json, []),
      dependsOn: parseJson<string[]>(row.depends_on_json, []),
      result: parseJson(row.result_json, null),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      completedAt: row.completed_at == null ? null : String(row.completed_at),
    };
  }

  private normalizeScopes(workspace: WorkspaceView, value: unknown): string[] {
    return list(value)
      .map((raw) => {
        const normalized = raw.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/');
        if (!normalized || normalized === '.') return '';
        if (isAbsolute(raw) || normalized.split('/').some((part) => part === '..'))
          throw new Error(
            'Task file scopes must stay inside the workspace and use relative paths.',
          );
        const root = resolve(workspace.root, normalized.replaceAll('/', sep));
        if (!pathWithin(workspace.root, root))
          throw new Error('Task file scopes must stay inside the workspace.');
        return normalized.replace(/\/$/, '');
      })
      .filter(Boolean);
  }

  private requireAgent(id: string, workspaceId: string): AgentView {
    const row = this.agentRow(id);
    if (!row || String(row.workspace_id) !== workspaceId)
      throw new Error('Unknown agent for this workspace.');
    if (String(row.status) !== 'active') throw new Error('Agent is not active.');
    return this.agentView(row);
  }

  private taskEvent(
    task: any,
    fromStatus: TaskStatus | null,
    toStatus: TaskStatus,
    agentId: string | null,
    details: Record<string, unknown> = {},
  ): void {
    this.db.run(
      'INSERT INTO workspace_task_events(task_id,workspace_id,ts,from_status,to_status,agent_id,details_json) VALUES (?,?,?,?,?,?,?)',
      [
        String(task.id),
        String(task.workspace_id),
        new Date().toISOString(),
        fromStatus,
        toStatus,
        agentId,
        JSON.stringify(details),
      ],
    );
  }

  registerAgent(sessionId: string, workspaceId: string, input: AgentInput): AgentView {
    this.workspace(workspaceId);
    const name = text(input.name);
    if (!name) throw new Error('Agent name is required.');
    const role = text(input.role) || null;
    const capabilities = list(input.capabilities);
    return this.db.transaction(() => {
      const now = new Date().toISOString();
      const existing = this.db.one<any>('SELECT * FROM workspace_agents WHERE session_id=?', [
        sessionId,
      ]);
      if (existing) {
        if (String(existing.workspace_id) !== workspaceId) {
          const active = this.db.one<any>(
            "SELECT id FROM workspace_tasks WHERE assigned_agent_id=? AND status='doing'",
            [existing.id],
          );
          if (active) throw new Error('Agent has an active task and cannot change workspace.');
        }
        this.db.run(
          'UPDATE workspace_agents SET workspace_id=?,name=?,role=?,capabilities_json=?,status=?,last_seen_at=?,updated_at=? WHERE session_id=?',
          [workspaceId, name, role, JSON.stringify(capabilities), 'active', now, now, sessionId],
        );
        return this.agentView(this.agentRow(String(existing.id)));
      }
      const id = `agent_${randomUUID().slice(0, 8)}`;
      this.db.run(
        'INSERT INTO workspace_agents(id,workspace_id,session_id,name,role,capabilities_json,status,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [
          id,
          workspaceId,
          sessionId,
          name,
          role,
          JSON.stringify(capabilities),
          'active',
          now,
          now,
          now,
        ],
      );
      return this.agentView(this.agentRow(id));
    });
  }

  agentForSession(sessionId: string, workspaceId: string): AgentView | null {
    const row = this.db.one<any>(
      'SELECT * FROM workspace_agents WHERE session_id=? AND workspace_id=?',
      [sessionId, workspaceId],
    );
    return row ? this.agentView(row) : null;
  }

  heartbeatAgent(sessionId: string, workspaceId: string): AgentView {
    const row = this.db.one<any>(
      'SELECT * FROM workspace_agents WHERE session_id=? AND workspace_id=?',
      [sessionId, workspaceId],
    );
    if (!row) throw new Error('Unknown agent for this workspace.');
    const now = new Date().toISOString();
    this.db.run('UPDATE workspace_agents SET status=?,last_seen_at=?,updated_at=? WHERE id=?', [
      'active',
      now,
      now,
      row.id,
    ]);
    return this.agentView(this.agentRow(String(row.id)));
  }

  touchAgent(sessionId: string, workspaceId: string): AgentView | null {
    const row = this.db.one<any>(
      'SELECT * FROM workspace_agents WHERE session_id=? AND workspace_id=?',
      [sessionId, workspaceId],
    );
    if (!row) return null;
    const now = new Date().toISOString();
    this.db.run('UPDATE workspace_agents SET last_seen_at=?,updated_at=? WHERE id=?', [
      now,
      now,
      row.id,
    ]);
    return this.agentView(this.agentRow(String(row.id)));
  }

  listAgents(workspaceId: string): AgentView[] {
    this.workspace(workspaceId);
    return this.db
      .query<any>('SELECT * FROM workspace_agents WHERE workspace_id=? ORDER BY created_at,id', [
        workspaceId,
      ])
      .map((row) => this.agentView(row));
  }

  createTask(workspaceId: string, input: TaskInput): TaskView {
    const workspace = this.workspace(workspaceId);
    const title = text(input.title);
    if (!title) throw new Error('Task title is required.');
    const description = text(input.description);
    const fileScopes = this.normalizeScopes(workspace, input.fileScopes);
    const dependsOn = list(input.dependsOn);
    const requiredRole = text(input.requiredRole) || null;
    const requiredCapabilities = list(input.requiredCapabilities);
    const priorityValue = Number(input.priority ?? 0);
    const priority = Number.isFinite(priorityValue) ? Math.trunc(priorityValue) : 0;
    return this.db.transaction(() => {
      for (const dependency of dependsOn) {
        const row = this.taskRow(dependency);
        if (!row || String(row.workspace_id) !== workspaceId)
          throw new Error(`Unknown task dependency: ${dependency}`);
      }
      const now = new Date().toISOString();
      const id = `task_${randomUUID().slice(0, 8)}`;
      this.db.run(
        'INSERT INTO workspace_tasks(id,workspace_id,title,description,required_role,required_capabilities_json,priority,status,assigned_agent_id,file_scopes_json,depends_on_json,result_json,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          id,
          workspaceId,
          title,
          description,
          requiredRole,
          JSON.stringify(requiredCapabilities),
          priority,
          'queued',
          null,
          JSON.stringify(fileScopes),
          JSON.stringify(dependsOn),
          null,
          now,
          now,
          null,
        ],
      );
      return this.taskView(this.taskRow(id));
    });
  }

  getTask(id: string): TaskView | null {
    const row = this.taskRow(id);
    return row ? this.taskView(row) : null;
  }

  listTaskEvents(taskId: string): TaskEventView[] {
    if (!this.taskRow(taskId)) throw new Error('Unknown task.');
    return this.db
      .query<any>('SELECT * FROM workspace_task_events WHERE task_id=? ORDER BY id', [taskId])
      .map((row) => ({
        id: Number(row.id),
        taskId: String(row.task_id),
        timestamp: String(row.ts),
        fromStatus: row.from_status == null ? null : (String(row.from_status) as TaskStatus),
        toStatus: String(row.to_status) as TaskStatus,
        agentId: row.agent_id == null ? null : String(row.agent_id),
        details: parseJson<Record<string, unknown>>(row.details_json, {}),
      }));
  }

  listTasks(workspaceId: string, status?: TaskStatus): TaskView[] {
    this.workspace(workspaceId);
    const rows = status
      ? this.db.query<any>(
          'SELECT * FROM workspace_tasks WHERE workspace_id=? AND status=? ORDER BY priority DESC,created_at,id',
          [workspaceId, status],
        )
      : this.db.query<any>(
          'SELECT * FROM workspace_tasks WHERE workspace_id=? ORDER BY priority DESC,created_at,id',
          [workspaceId],
        );
    return rows.map((row) => this.taskView(row));
  }

  dispatchTask(taskId: string): TaskView {
    const row = this.taskRow(taskId);
    if (!row) throw new Error('Unknown task.');
    if (String(row.status) !== 'queued' || row.assigned_agent_id)
      throw new Error('Task is not available to dispatch.');
    const requiredRole =
      row.required_role == null ? null : String(row.required_role).toLocaleLowerCase();
    const requiredCapabilities = parseJson<string[]>(row.required_capabilities_json, []).map(
      (item) => item.toLocaleLowerCase(),
    );
    const candidates = this.db.query<any>(
      "SELECT * FROM workspace_agents WHERE workspace_id=? AND status='active' ORDER BY last_seen_at DESC,created_at,id",
      [String(row.workspace_id)],
    );
    for (const candidate of candidates) {
      const role = candidate.role == null ? '' : String(candidate.role).toLocaleLowerCase();
      if (requiredRole && role !== requiredRole) continue;
      const capabilities = parseJson<string[]>(candidate.capabilities_json, []).map((item) =>
        item.toLocaleLowerCase(),
      );
      if (!requiredCapabilities.every((item) => capabilities.includes(item))) continue;
      const busy = this.db.one<any>(
        "SELECT id FROM workspace_tasks WHERE assigned_agent_id=? AND status='doing' LIMIT 1",
        [candidate.id],
      );
      if (busy) continue;
      return this.claimTask(taskId, String(candidate.id));
    }
    throw new Error(
      `DWB_TASK_NO_AGENT: no available active agent matches task role/capabilities for ${taskId}.`,
    );
  }

  dispatchQueuedTasks(): number {
    const queued = this.db.query<any>(
      "SELECT id FROM workspace_tasks WHERE status='queued' AND (required_role IS NOT NULL OR required_capabilities_json <> '[]') ORDER BY priority DESC,created_at,id",
    );
    let dispatched = 0;
    for (const task of queued) {
      try {
        this.dispatchTask(String(task.id));
        dispatched += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          !message.startsWith('DWB_TASK_NO_AGENT:') &&
          !message.startsWith('DWB_TASK_SCOPE_CONFLICT:')
        )
          throw error;
      }
    }
    return dispatched;
  }

  claimTask(taskId: string, agentId: string): TaskView {
    return this.db.transaction(() => {
      const row = this.taskRow(taskId);
      if (!row) throw new Error('Unknown task.');
      const agent = this.requireAgent(agentId, String(row.workspace_id));
      if (String(row.status) !== 'queued' || row.assigned_agent_id)
        throw new Error('Task is not available to claim.');
      const dependencies = parseJson<string[]>(row.depends_on_json, []);
      const incomplete = dependencies.find((id) => this.taskRow(id)?.status !== 'done');
      if (incomplete) throw new Error(`Task dependency is not complete: ${incomplete}`);
      const scopes = parseJson<string[]>(row.file_scopes_json, []);
      const active = this.db.query<any>(
        "SELECT * FROM workspace_tasks WHERE workspace_id=? AND status='doing' AND assigned_agent_id IS NOT NULL",
        [String(row.workspace_id)],
      );
      for (const other of active) {
        const otherScopes = parseJson<string[]>(other.file_scopes_json, []);
        if (
          !scopes.length ||
          !otherScopes.length ||
          scopes.some((left) => otherScopes.some((right) => scopeOverlaps(left, right)))
        )
          throw new Error(`DWB_TASK_SCOPE_CONFLICT: task overlaps active task ${other.id}.`);
      }
      const now = new Date().toISOString();
      this.db.run(
        'UPDATE workspace_tasks SET status=?,assigned_agent_id=?,updated_at=? WHERE id=? AND status=?',
        ['doing', agent.id, now, taskId, 'queued'],
      );
      this.taskEvent(row, 'queued', 'doing', agent.id);
      return this.taskView(this.taskRow(taskId));
    });
  }

  completeTask(taskId: string, agentId: string, result?: unknown): TaskView {
    return this.db.transaction(() => {
      const row = this.taskRow(taskId);
      if (!row) throw new Error('Unknown task.');
      this.requireAgent(agentId, String(row.workspace_id));
      if (String(row.assigned_agent_id) !== agentId)
        throw new Error('Only the assigned agent can complete this task.');
      if (String(row.status) !== 'doing') throw new Error('Only a doing task can be completed.');
      const now = new Date().toISOString();
      this.db.run(
        'UPDATE workspace_tasks SET status=?,result_json=?,updated_at=?,completed_at=? WHERE id=?',
        ['done', result === undefined ? null : JSON.stringify(result), now, now, taskId],
      );
      this.taskEvent(row, 'doing', 'done', agentId, result === undefined ? {} : { result });
      return this.taskView(this.taskRow(taskId));
    });
  }

  releaseTask(taskId: string, agentId: string): TaskView {
    return this.db.transaction(() => {
      const row = this.taskRow(taskId);
      if (!row) throw new Error('Unknown task.');
      this.requireAgent(agentId, String(row.workspace_id));
      if (String(row.assigned_agent_id) !== agentId)
        throw new Error('Only the assigned agent can release this task.');
      if (String(row.status) !== 'doing') throw new Error('Only a doing task can be released.');
      const now = new Date().toISOString();
      this.db.run(
        'UPDATE workspace_tasks SET status=?,assigned_agent_id=NULL,updated_at=? WHERE id=?',
        ['queued', now, taskId],
      );
      this.taskEvent(row, 'doing', 'queued', agentId, { reason: 'released' });
      return this.taskView(this.taskRow(taskId));
    });
  }

  blockTask(taskId: string, agentId: string, reason = ''): TaskView {
    return this.db.transaction(() => {
      const row = this.taskRow(taskId);
      if (!row) throw new Error('Unknown task.');
      this.requireAgent(agentId, String(row.workspace_id));
      if (String(row.assigned_agent_id) !== agentId)
        throw new Error('Only the assigned agent can block this task.');
      if (String(row.status) !== 'doing') throw new Error('Only a doing task can be blocked.');
      const now = new Date().toISOString();
      this.db.run(
        'UPDATE workspace_tasks SET status=?,assigned_agent_id=NULL,updated_at=? WHERE id=?',
        ['blocked', now, taskId],
      );
      this.taskEvent(row, 'doing', 'blocked', agentId, { reason: reason.trim() });
      return this.taskView(this.taskRow(taskId));
    });
  }

  cancelTask(taskId: string, agentId: string): TaskView {
    return this.db.transaction(() => {
      const row = this.taskRow(taskId);
      if (!row) throw new Error('Unknown task.');
      this.requireAgent(agentId, String(row.workspace_id));
      if (row.assigned_agent_id && String(row.assigned_agent_id) !== agentId)
        throw new Error('Only the assigned agent can cancel this task.');
      const fromStatus = String(row.status) as TaskStatus;
      if (!['queued', 'doing', 'blocked'].includes(fromStatus))
        throw new Error('Only queued, doing, or blocked tasks can be cancelled.');
      const now = new Date().toISOString();
      this.db.run(
        'UPDATE workspace_tasks SET status=?,assigned_agent_id=NULL,updated_at=? WHERE id=?',
        ['cancelled', now, taskId],
      );
      this.taskEvent(row, fromStatus, 'cancelled', agentId);
      return this.taskView(this.taskRow(taskId));
    });
  }

  reopenTask(taskId: string, agentId: string): TaskView {
    return this.db.transaction(() => {
      const row = this.taskRow(taskId);
      if (!row) throw new Error('Unknown task.');
      const agent = this.requireAgent(agentId, String(row.workspace_id));
      const fromStatus = String(row.status) as TaskStatus;
      if (!['blocked', 'cancelled'].includes(fromStatus))
        throw new Error('Only blocked or cancelled tasks can be reopened.');
      const now = new Date().toISOString();
      this.db.run(
        'UPDATE workspace_tasks SET status=?,assigned_agent_id=NULL,updated_at=?,completed_at=NULL WHERE id=?',
        ['queued', now, taskId],
      );
      this.taskEvent(row, fromStatus, 'queued', agent.id, { reason: 'reopened' });
      return this.taskView(this.taskRow(taskId));
    });
  }

  reclaimStaleAgents(now = new Date()): { agents: number; tasks: number } {
    const cutoff = new Date(now.getTime() - this.agentLeaseMs).toISOString();
    return this.db.transaction(() => {
      const stale = this.db.query<any>(
        "SELECT * FROM workspace_agents WHERE status='active' AND COALESCE(last_seen_at,updated_at) < ?",
        [cutoff],
      );
      let tasks = 0;
      const stampedAt = new Date().toISOString();
      for (const agent of stale) {
        this.db.run('UPDATE workspace_agents SET status=?,updated_at=? WHERE id=?', [
          'paused',
          stampedAt,
          agent.id,
        ]);
        const assigned = this.db.query<any>(
          "SELECT * FROM workspace_tasks WHERE assigned_agent_id=? AND status='doing'",
          [agent.id],
        );
        for (const task of assigned) {
          this.db.run(
            'UPDATE workspace_tasks SET status=?,assigned_agent_id=NULL,updated_at=? WHERE id=?',
            ['queued', stampedAt, task.id],
          );
          this.taskEvent(task, 'doing', 'queued', null, {
            reason: 'agent_lease_expired',
            agentId: String(agent.id),
          });
          tasks += 1;
        }
      }
      return { agents: stale.length, tasks };
    });
  }

  mutationGate(input: { sessionId: string; workspaceId: string; paths: string[] }) {
    const agent = this.agentForSession(input.sessionId, input.workspaceId);
    if (!agent) return { allowed: true, message: '' };
    if (agent.status !== 'active')
      return {
        allowed: false,
        message:
          'DWB_AGENT_LEASE: this agent lease has expired. Send dwb_agent action=heartbeat or register again before mutating the workspace.',
      };
    const task = this.db.one<any>(
      "SELECT * FROM workspace_tasks WHERE workspace_id=? AND assigned_agent_id=? AND status='doing' ORDER BY updated_at DESC LIMIT 1",
      [input.workspaceId, agent.id],
    );
    if (!task) return { allowed: true, message: '' };
    const scopes = parseJson<string[]>(task.file_scopes_json, []);
    if (!scopes.length) return { allowed: true, message: '' };
    const workspace = this.workspace(input.workspaceId);
    const outside = input.paths.filter((path) => {
      if (!pathWithin(workspace.root, path)) return true;
      const target = relative(workspace.root, path).replaceAll('\\', '/');
      return !scopes.some((scope) => scopeMatches(scope, target));
    });
    if (!outside.length) return { allowed: true, message: '' };
    return {
      allowed: false,
      message: `DWB_TASK_SCOPE: agent ${agent.name} may only mutate files in task ${task.id} scopes (${scopes.join(', ')}).\n${outside.join('\n')}`,
    };
  }

  dashboardSnapshot() {
    const agents = this.db
      .query<any>('SELECT * FROM workspace_agents ORDER BY status DESC,updated_at DESC,created_at,id')
      .map((row) => this.agentView(row));
    const tasks = this.db
      .query<any>('SELECT * FROM workspace_tasks ORDER BY priority DESC,updated_at DESC,created_at,id')
      .map((row) => this.taskView(row));
    return { summary: this.summary(), agents, tasks };
  }

  summary(workspaceId?: string) {
    const agents = workspaceId
      ? this.listAgents(workspaceId)
      : this.db.query<any>('SELECT * FROM workspace_agents').map((row) => this.agentView(row));
    const tasks = workspaceId
      ? this.listTasks(workspaceId)
      : this.db.query<any>('SELECT * FROM workspace_tasks').map((row) => this.taskView(row));
    return {
      agents: agents.length,
      activeAgents: agents.filter((agent) => agent.status === 'active').length,
      tasks: tasks.length,
      queuedTasks: tasks.filter((task) => task.status === 'queued').length,
      doingTasks: tasks.filter((task) => task.status === 'doing').length,
      doneTasks: tasks.filter((task) => task.status === 'done').length,
      blockedTasks: tasks.filter((task) => task.status === 'blocked').length,
      cancelledTasks: tasks.filter((task) => task.status === 'cancelled').length,
    };
  }
}
