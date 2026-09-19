import { spawn as spawnProcess, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentStatus, TaskStatus } from './agent-task-store.js';
import { dataDir } from './paths.js';

export type AutonomousAgentSnapshot = {
  agents: Array<{
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
  }>;
  tasks: Array<{
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
    handoff: unknown;
    updatedAt: string;
  }>;
};

export type AutonomousAgentProfile = {
  name: string;
  role: string;
  capabilities: string[];
  workspaceRoot: string;
  workspaceId?: string;
  agentId?: string;
};

export type AutonomousAgentCommand = {
  executable: string;
  args: string[];
  prompt: string;
};

type WorkspaceResolver = {
  resolveRef(ref: string): { root: string };
};

type TaskSource = {
  dashboardSnapshot(): AutonomousAgentSnapshot;
  pauseAgent?(agentId: string, reason?: string): unknown;
};

type SpawnFunction = (file: string, args: string[], options: SpawnOptions) => ChildProcess;

type RunnerEvent = {
  type: 'started' | 'exited' | 'error';
  key: string;
  profile: AutonomousAgentProfile;
  code?: number | null;
  error?: string;
};

export type AutonomousAgentRunnerOptions = {
  enabled?: boolean;
  executable?: string;
  startScript?: string;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  retryMs?: number;
  spawn?: SpawnFunction;
  onEvent?: (event: RunnerEvent) => void;
};

type LaunchRecord = {
  child: ChildProcess;
  profile: AutonomousAgentProfile;
  agentId?: string;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalized(value: unknown): string {
  return text(value).toLocaleLowerCase();
}

function tomlString(value: string): string {
  // TOML basic strings become unreliable after Windows command-line escaping.
  // Literal strings preserve backslashes and still compose correctly in arrays.
  return `'${value.replaceAll("'", "''")}'`;
}

function sandboxFromEnvironment(): AutonomousAgentRunnerOptions['sandbox'] {
  const value = text(process.env.DWB_AUTONOMOUS_SANDBOX);
  return value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access'
    ? value
    : undefined;
}

function capabilitiesMatch(required: string[], available: string[]): boolean {
  const values = new Set(available.map(normalized));
  return required.every((item) => values.has(normalized(item)));
}

function roleMatch(required: string | null, available: string | null): boolean {
  return !required || normalized(required) === normalized(available);
}

function workerPrompt(profile: AutonomousAgentProfile): string {
  const capabilities = profile.capabilities.length ? profile.capabilities.join(', ') : '(none)';
  return [
    'You are an autonomous worker managed by DWB MCP Studio.',
    `Agent name: ${profile.name}`,
    `Agent role: ${profile.role}`,
    `Agent capabilities: ${capabilities}`,
    `Workspace: ${profile.workspaceRoot}`,
    '',
    'Start by calling workspace with action="bind" and this absolute path, then call',
    'dwb_agent with action="register" using the exact name, role, and capabilities above.',
    'Stay available for work. Call dwb_agent action="wait" with timeout_ms=120000,',
    'acknowledge task_assigned messages, perform the assigned task inside its file scopes,',
    'and complete it with summary, changed_files, test_result, and result. After completion,',
    'call wait again. If wait times out without messages, call wait again immediately.',
    'Do not finish the session merely because the inbox is empty. Do not spawn another agent.',
  ].join('\n');
}

export function buildAutonomousAgentCommand(
  profile: AutonomousAgentProfile,
  options: Pick<AutonomousAgentRunnerOptions, 'executable' | 'startScript' | 'sandbox'> = {},
): AutonomousAgentCommand {
  const executable = options.executable || process.env.DWB_CODEX_EXECUTABLE || 'codex';
  const startScript =
    options.startScript ||
    resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'autonomous-mcp.mjs');
  const configFile = process.env.DWB_CONFIG_FILE || resolve(dataDir(), 'config.json');
  const sandbox = options.sandbox || 'workspace-write';
  const args = [
    'exec',
    '--ephemeral',
    '--json',
    '--skip-git-repo-check',
    '-C',
    profile.workspaceRoot,
    '--sandbox',
    sandbox,
    '-c',
    `mcp_servers.dwb_core.command=${tomlString(process.execPath)}`,
    '-c',
    `mcp_servers.dwb_core.args=[${[startScript, configFile].map(tomlString).join(',')}]`,
    workerPrompt(profile),
  ];
  const sandboxIndex = args.indexOf('--sandbox');
  if (sandbox === 'workspace-write') args.splice(sandboxIndex, 2, '--approve-for-me');
  if (sandbox === 'danger-full-access')
    args.splice(sandboxIndex, 2, '--dangerously-bypass-approvals-and-sandbox');
  return { executable, args, prompt: workerPrompt(profile) };
}

export class AutonomousAgentSupervisor {
  private readonly launches = new Map<string, LaunchRecord>();
  private readonly retryAt = new Map<string, number>();
  private readonly enabled: boolean;
  private readonly executable: string;
  private readonly startScript?: string;
  private readonly sandbox: AutonomousAgentRunnerOptions['sandbox'];
  private readonly retryMs: number;
  private readonly spawn: SpawnFunction;
  private readonly onEvent?: (event: RunnerEvent) => void;

  constructor(
    private readonly tasks: TaskSource,
    private readonly workspaces: WorkspaceResolver,
    options: AutonomousAgentRunnerOptions = {},
  ) {
    this.enabled = options.enabled ?? process.env.DWB_AUTONOMOUS_AGENTS === 'true';
    this.executable = options.executable || process.env.DWB_CODEX_EXECUTABLE || 'codex';
    this.startScript = options.startScript;
    this.sandbox = options.sandbox || sandboxFromEnvironment() || 'workspace-write';
    this.retryMs = Math.max(0, Math.trunc(options.retryMs ?? 5_000));
    this.spawn = options.spawn || spawnProcess;
    this.onEvent = options.onEvent;
  }

  status() {
    return {
      enabled: this.enabled,
      running: this.launches.size,
      queuedLaunches: this.launches.size + this.retryAt.size,
    };
  }

  reconcile(): number {
    if (!this.enabled) return 0;
    const snapshot = this.tasks.dashboardSnapshot();
    this.bindLaunchAgents(snapshot);
    const queued = snapshot.tasks
      .filter(
        (task) =>
          task.status === 'queued' &&
          (task.requiredRole !== null || task.requiredCapabilities.length > 0),
      )
      .sort((left, right) => right.priority - left.priority || left.updatedAt.localeCompare(right.updatedAt));
    let started = 0;
    for (const task of queued) {
      if (this.ensureWorkerForTask(snapshot, task)) started += 1;
    }
    return started;
  }

  stopAll(): void {
    for (const [key, launch] of this.launches) {
      launch.child.kill();
      this.launches.delete(key);
    }
    this.retryAt.clear();
  }

  private ensureWorkerForTask(
    snapshot: AutonomousAgentSnapshot,
    task: AutonomousAgentSnapshot['tasks'][number],
  ): boolean {
    const candidates = snapshot.agents.filter(
      (agent) =>
        agent.workspaceId === task.workspaceId &&
        agent.role !== 'main' &&
        roleMatch(task.requiredRole, agent.role) &&
        capabilitiesMatch(task.requiredCapabilities, agent.capabilities) &&
        !snapshot.tasks.some(
          (other) =>
            other.status === 'doing' && other.assignedAgentId === agent.id,
        ),
    );
    const active = candidates.find((agent) => agent.status === 'active');
    if (active) return false;
    const paused = candidates.find((agent) => agent.status === 'paused');
    const role = text(task.requiredRole) || 'worker';
    const capabilities = [...new Set(task.requiredCapabilities.map(text).filter(Boolean))];
    const profile = paused
      ? {
          name: paused.name,
          role: text(paused.role) || role,
          capabilities: paused.capabilities,
          workspaceRoot: '',
          workspaceId: task.workspaceId,
          agentId: paused.id,
        }
      : {
          name: `Auto ${role}`,
          role,
          capabilities,
          workspaceRoot: '',
          workspaceId: task.workspaceId,
        };
    const key = paused
      ? `agent:${paused.id}`
      : `task:${task.id}:${task.workspaceId}:${role.toLocaleLowerCase()}`;
    if (this.launches.has(key)) return false;
    const retry = this.retryAt.get(key);
    if (retry !== undefined && retry > Date.now()) return false;
    const workspace = this.workspaces.resolveRef(task.workspaceId);
    const launchProfile = { ...profile, workspaceRoot: resolve(workspace.root) };
    const command = buildAutonomousAgentCommand(launchProfile, {
      executable: this.executable,
      startScript: this.startScript,
      sandbox: this.sandbox,
    });
    const child = this.spawn(command.executable, command.args, {
      cwd: launchProfile.workspaceRoot,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.launches.set(key, { child, profile: launchProfile, agentId: launchProfile.agentId });
    this.retryAt.delete(key);
    let output = '';
    const capture = (chunk: unknown) => {
      output = (output + String(chunk)).slice(-4_000);
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    child.once('exit', (code) => {
      const launch = this.launches.get(key);
      this.launches.delete(key);
      if (launch?.agentId) this.tasks.pauseAgent?.(launch.agentId, 'autonomous_worker_exit');
      if (code !== 0) this.retryAt.set(key, Date.now() + this.retryMs);
      this.onEvent?.({
        type: 'exited',
        key,
        profile: launchProfile,
        code,
        ...(output ? { error: output } : {}),
      });
    });
    child.once('error', (error) => {
      const launch = this.launches.get(key);
      this.launches.delete(key);
      if (launch?.agentId) this.tasks.pauseAgent?.(launch.agentId, 'autonomous_worker_error');
      this.retryAt.set(key, Date.now() + this.retryMs);
      this.onEvent?.({ type: 'error', key, profile: launchProfile, error: String(error) });
    });
    this.onEvent?.({ type: 'started', key, profile: launchProfile });
    return true;
  }

  private bindLaunchAgents(snapshot: AutonomousAgentSnapshot): void {
    for (const launch of this.launches.values()) {
      if (launch.agentId) continue;
      const match = snapshot.agents.find(
        (agent) =>
          agent.workspaceId === launch.profile.workspaceId &&
          normalized(agent.name) === normalized(launch.profile.name) &&
          normalized(agent.role) === normalized(launch.profile.role) &&
          agent.status === 'active',
      );
      if (match) launch.agentId = match.id;
    }
  }
}
