import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import {
  AutonomousAgentSupervisor,
  buildAutonomousAgentCommand,
  type AutonomousAgentSnapshot,
} from './autonomous-agent-runner.js';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

const snapshot = (overrides: Partial<AutonomousAgentSnapshot> = {}): AutonomousAgentSnapshot => ({
  agents: [
    {
      id: 'agent-planner',
      workspaceId: 'workspace-1',
      sessionId: 'old-session',
      name: 'Planner',
      role: 'planner',
      capabilities: ['requirements-analysis'],
      status: 'paused',
      lastSeenAt: '',
      createdAt: '',
      updatedAt: '',
    },
  ],
  tasks: [
    {
      id: 'task-1',
      workspaceId: 'workspace-1',
      title: 'Plan the work',
      description: 'Read the code and create a plan.',
      requiredRole: 'planner',
      requiredCapabilities: ['requirements-analysis'],
      priority: 10,
      status: 'queued',
      assignedAgentId: null,
      fileScopes: ['backend/**'],
      dependsOn: [],
      result: null,
      handoff: null,
      updatedAt: '',
    },
  ],
  ...overrides,
});

test('builds a local Codex worker command with the DWB MCP server', () => {
  const command = buildAutonomousAgentCommand(
    {
      name: 'Planner',
      role: 'planner',
      capabilities: ['requirements-analysis'],
      workspaceRoot: 'C:\\work\\baccarat',
    },
    {
      executable: 'codex.exe',
      startScript: 'C:\\dwb\\scripts\\start.mjs',
    },
  );

  assert.equal(command.executable, 'codex.exe');
  assert.deepEqual(command.args.slice(0, 4), ['exec', '--ephemeral', '--json', '--skip-git-repo-check']);
  assert.ok(command.args.includes('--approve-for-me'));
  assert.ok(command.args.some((arg) => arg.startsWith('mcp_servers.dwb_core.command=')));
  const mcpArgs = command.args.find((arg) => arg.includes('mcp_servers.dwb_core.args='));
  assert.ok(mcpArgs);
  assert.match(mcpArgs, /dwb.*scripts.*start\.mjs/);
  assert.match(mcpArgs, /config\.json/);
  assert.match(command.prompt, /Planner/);
  assert.match(command.prompt, /planner/);
  assert.match(command.prompt, /requirements-analysis/);
  assert.match(command.prompt, /wait/);
});

test('starts one autonomous worker for a queued task and does not duplicate it', () => {
  const child = new FakeChild();
  const calls: Array<{ file: string; args: string[]; cwd?: string }> = [];
  const supervisor = new AutonomousAgentSupervisor(
    {
      dashboardSnapshot: () => snapshot(),
    },
    {
      resolveRef: () => ({ root: 'C:\\work\\baccarat' }),
    },
    {
      enabled: true,
      executable: 'codex.exe',
      startScript: 'C:\\dwb\\scripts\\start.mjs',
      retryMs: 0,
      spawn: (file, args, options) => {
        calls.push({ file, args, cwd: options.cwd?.toString() });
        return child as any;
      },
    },
  );

  assert.equal(supervisor.reconcile(), 1);
  assert.equal(supervisor.reconcile(), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'codex.exe');
  assert.equal(calls[0].cwd, 'C:\\work\\baccarat');
  assert.deepEqual(supervisor.status(), { enabled: true, running: 1, queuedLaunches: 1 });
});

test('retries a failed autonomous worker after it exits', () => {
  const first = new FakeChild();
  const second = new FakeChild();
  const children = [first, second];
  let launches = 0;
  const supervisor = new AutonomousAgentSupervisor(
    {
      dashboardSnapshot: () => snapshot(),
    },
    {
      resolveRef: () => ({ root: 'C:\\work\\baccarat' }),
    },
    {
      enabled: true,
      retryMs: 0,
      spawn: () => children[launches++] as any,
    },
  );

  assert.equal(supervisor.reconcile(), 1);
  first.emit('exit', 1, null);
  assert.equal(supervisor.reconcile(), 0);
  assert.equal(launches, 2);
});

test('rebinds a just-registered worker before recovering its unfinished task on exit', () => {
  const child = new FakeChild();
  let current = snapshot({ agents: [] });
  const paused: string[] = [];
  const supervisor = new AutonomousAgentSupervisor(
    {
      dashboardSnapshot: () => current,
      pauseAgent: (agentId) => {
        paused.push(agentId);
        return { agents: 1, tasks: 1 };
      },
    },
    {
      resolveRef: () => ({ root: 'C:\\work\\baccarat' }),
    },
    {
      enabled: true,
      retryMs: 0,
      spawn: () => child as any,
    },
  );

  assert.equal(supervisor.reconcile(), 1);
  current = snapshot({
    agents: [
      {
        id: 'agent-auto-planner',
        workspaceId: 'workspace-1',
        sessionId: 'new-session',
        name: 'Auto planner',
        role: 'planner',
        capabilities: ['requirements-analysis'],
        status: 'active',
        lastSeenAt: '',
        createdAt: '',
        updatedAt: '',
      },
    ],
    tasks: [
      {
        ...snapshot().tasks[0],
        status: 'doing',
        assignedAgentId: 'agent-auto-planner',
      },
    ],
  });

  child.emit('exit', 0, null);
  assert.deepEqual(paused, ['agent-auto-planner']);
});
