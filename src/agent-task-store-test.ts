import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { AgentTaskStore } from './agent-task-store.js';
import { CoreStore } from './core-store.js';
import { WorkspaceStore } from './workspace-store.js';

test('claims independent tasks in one workspace and rejects overlapping file scopes', async () => {
  const root = resolve('logs', `agent-tasks-${randomUUID()}`);
  await mkdir(resolve(root, 'src'), { recursive: true });
  const db = new CoreStore(resolve(root, 'core.db'));
  const workspaces = new WorkspaceStore(db);
  const workspace = await workspaces.register({ path: root, name: 'shared' });
  const tasks = new AgentTaskStore(db, workspaces);
  try {
    const first = tasks.registerAgent('session-a', workspace.id, {
      name: 'builder',
      role: 'backend',
    });
    const second = tasks.registerAgent('session-b', workspace.id, { name: 'tester', role: 'qa' });
    const api = tasks.createTask(workspace.id, {
      title: 'Build API',
      description: 'Implement the API layer',
      fileScopes: ['src/api/**'],
    });
    const ui = tasks.createTask(workspace.id, {
      title: 'Build UI',
      description: 'Implement the UI layer',
      fileScopes: ['src/ui/**'],
    });

    assert.equal(tasks.claimTask(api.id, first.id).assignedAgentId, first.id);
    assert.equal(tasks.claimTask(ui.id, second.id).assignedAgentId, second.id);

    const conflicting = tasks.createTask(workspace.id, {
      title: 'API tests',
      fileScopes: ['src/api/auth.ts'],
    });
    assert.throws(() => tasks.claimTask(conflicting.id, second.id), /DWB_TASK_SCOPE_CONFLICT/);
    assert.equal(tasks.getTask(conflicting.id)?.status, 'queued');
  } finally {
    db.close();
  }
});

test('only the assigned agent can complete a task and completed scopes become available', async () => {
  const root = resolve('logs', `agent-tasks-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const db = new CoreStore(resolve(root, 'core.db'));
  const workspaces = new WorkspaceStore(db);
  const workspace = await workspaces.register({ path: root });
  const tasks = new AgentTaskStore(db, workspaces);
  try {
    const owner = tasks.registerAgent('session-owner', workspace.id, { name: 'owner' });
    const other = tasks.registerAgent('session-other', workspace.id, { name: 'other' });
    const task = tasks.createTask(workspace.id, { title: 'Fix config', fileScopes: ['config/**'] });
    tasks.claimTask(task.id, owner.id);

    assert.throws(() => tasks.completeTask(task.id, other.id), /assigned agent/);
    assert.equal(tasks.completeTask(task.id, owner.id).status, 'done');

    const followUp = tasks.createTask(workspace.id, {
      title: 'Review config',
      fileScopes: ['config/app.json'],
    });
    assert.equal(tasks.claimTask(followUp.id, other.id).status, 'doing');
  } finally {
    db.close();
  }
});

test('active task scope blocks an agent from mutating another task area', async () => {
  const root = resolve('logs', `agent-tasks-${randomUUID()}`);
  await mkdir(resolve(root, 'src'), { recursive: true });
  const db = new CoreStore(resolve(root, 'core.db'));
  const workspaces = new WorkspaceStore(db);
  const workspace = await workspaces.register({ path: root });
  const tasks = new AgentTaskStore(db, workspaces);
  try {
    const agent = tasks.registerAgent('session-scoped', workspace.id, { name: 'scoped' });
    const task = tasks.createTask(workspace.id, { title: 'API only', fileScopes: ['src/api/**'] });
    tasks.claimTask(task.id, agent.id);

    assert.equal(
      tasks.mutationGate({
        sessionId: agent.sessionId,
        workspaceId: workspace.id,
        paths: [resolve(root, 'src', 'api', 'users.ts')],
      }).allowed,
      true,
    );
    const blocked = tasks.mutationGate({
      sessionId: agent.sessionId,
      workspaceId: workspace.id,
      paths: [resolve(root, 'src', 'ui', 'app.tsx')],
    });
    assert.equal(blocked.allowed, false);
    assert.match(blocked.message, /DWB_TASK_SCOPE/);
  } finally {
    db.close();
  }
});

test('workspace-wide task blocks every other active task scope', async () => {
  const root = resolve('logs', `agent-tasks-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const db = new CoreStore(resolve(root, 'core.db'));
  const workspaces = new WorkspaceStore(db);
  const workspace = await workspaces.register({ path: root });
  const tasks = new AgentTaskStore(db, workspaces);
  try {
    const first = tasks.registerAgent('session-wide', workspace.id, { name: 'wide' });
    const second = tasks.registerAgent('session-narrow', workspace.id, { name: 'narrow' });
    const wholeWorkspace = tasks.createTask(workspace.id, { title: 'Whole workspace review' });
    const narrow = tasks.createTask(workspace.id, {
      title: 'Narrow change',
      fileScopes: ['src/**'],
    });
    tasks.claimTask(wholeWorkspace.id, first.id);
    assert.throws(() => tasks.claimTask(narrow.id, second.id), /DWB_TASK_SCOPE_CONFLICT/);
  } finally {
    db.close();
  }
});

test('task lifecycle records transitions and allows blocked work to be reopened', async () => {
  const root = resolve('logs', `agent-tasks-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const db = new CoreStore(resolve(root, 'core.db'));
  const workspaces = new WorkspaceStore(db);
  const workspace = await workspaces.register({ path: root });
  const tasks = new AgentTaskStore(db, workspaces);
  try {
    const agent = tasks.registerAgent('session-lifecycle', workspace.id, { name: 'lifecycle' });
    const task = tasks.createTask(workspace.id, { title: 'Lifecycle task' });

    tasks.claimTask(task.id, agent.id);
    assert.equal(tasks.blockTask(task.id, agent.id, 'Waiting for credentials').status, 'blocked');
    assert.equal(tasks.getTask(task.id)?.assignedAgentId, null);
    assert.equal(tasks.reopenTask(task.id, agent.id).status, 'queued');
    assert.equal(tasks.claimTask(task.id, agent.id).status, 'doing');
    assert.equal(tasks.cancelTask(task.id, agent.id).status, 'cancelled');
    assert.equal(tasks.reopenTask(task.id, agent.id).status, 'queued');

    const history = tasks.listTaskEvents(task.id);
    assert.deepEqual(
      history.map((event) => [event.fromStatus, event.toStatus]),
      [
        ['queued', 'doing'],
        ['doing', 'blocked'],
        ['blocked', 'queued'],
        ['queued', 'doing'],
        ['doing', 'cancelled'],
        ['cancelled', 'queued'],
      ],
    );
    assert.equal(
      history.find((event) => event.toStatus === 'blocked')?.details.reason,
      'Waiting for credentials',
    );
  } finally {
    db.close();
  }
});

test('task dependencies prevent a claim until the dependency is complete', async () => {
  const root = resolve('logs', `agent-tasks-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const db = new CoreStore(resolve(root, 'core.db'));
  const workspaces = new WorkspaceStore(db);
  const workspace = await workspaces.register({ path: root });
  const tasks = new AgentTaskStore(db, workspaces);
  try {
    const agent = tasks.registerAgent('session-dependency', workspace.id, { name: 'dependency' });
    const foundation = tasks.createTask(workspace.id, { title: 'Foundation' });
    const followUp = tasks.createTask(workspace.id, {
      title: 'Follow up',
      dependsOn: [foundation.id],
    });
    assert.throws(() => tasks.claimTask(followUp.id, agent.id), /dependency is not complete/);
    tasks.claimTask(foundation.id, agent.id);
    tasks.completeTask(foundation.id, agent.id);
    assert.equal(tasks.claimTask(followUp.id, agent.id).status, 'doing');
  } finally {
    db.close();
  }
});

test('stale agents are paused and their active tasks return to the queue', async () => {
  const root = resolve('logs', `agent-tasks-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const db = new CoreStore(resolve(root, 'core.db'));
  const workspaces = new WorkspaceStore(db);
  const workspace = await workspaces.register({ path: root });
  const tasks = new AgentTaskStore(db, workspaces);
  try {
    const agent = tasks.registerAgent('session-stale', workspace.id, { name: 'stale' });
    const task = tasks.createTask(workspace.id, { title: 'Recover me', fileScopes: ['src/**'] });
    tasks.claimTask(task.id, agent.id);

    const reclaimed = tasks.reclaimStaleAgents(new Date(Date.now() + 10 * 60_000));
    assert.equal(reclaimed.agents, 1);
    assert.equal(reclaimed.tasks, 1);
    assert.equal(tasks.listAgents(workspace.id)[0].status, 'paused');
    assert.equal(tasks.getTask(task.id)?.status, 'queued');
    const pausedGate = tasks.mutationGate({
      sessionId: agent.sessionId,
      workspaceId: workspace.id,
      paths: [resolve(root, 'src', 'recovered.ts')],
    });
    assert.equal(pausedGate.allowed, false);
    assert.match(pausedGate.message, /DWB_AGENT_LEASE/);
    assert.equal(tasks.heartbeatAgent(agent.sessionId, workspace.id).status, 'active');
    assert.equal(tasks.claimTask(task.id, agent.id).status, 'doing');
  } finally {
    db.close();
  }
});

test('dispatch selects an available agent matching role and capabilities', async () => {
  const root = resolve('logs', `agent-tasks-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const db = new CoreStore(resolve(root, 'core.db'));
  const workspaces = new WorkspaceStore(db);
  const workspace = await workspaces.register({ path: root });
  const tasks = new AgentTaskStore(db, workspaces);
  try {
    const backend = tasks.registerAgent('session-backend', workspace.id, {
      name: 'backend',
      role: 'backend',
      capabilities: ['typescript', 'api'],
    } as any);
    tasks.registerAgent('session-frontend', workspace.id, {
      name: 'frontend',
      role: 'frontend',
      capabilities: ['typescript', 'ui'],
    } as any);
    const task = tasks.createTask(workspace.id, {
      title: 'Dispatch API task',
      fileScopes: ['src/api/**'],
      requiredRole: 'backend',
      requiredCapabilities: ['typescript', 'api'],
      priority: 10,
    } as any);

    const dispatched = tasks.dispatchTask(task.id);
    assert.equal(dispatched.status, 'doing');
    assert.equal(dispatched.assignedAgentId, backend.id);
  } finally {
    db.close();
  }
});

test('automatic dispatch assigns eligible queued tasks and leaves unmatched tasks queued', async () => {
  const root = resolve('logs', `agent-tasks-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const db = new CoreStore(resolve(root, 'core.db'));
  const workspaces = new WorkspaceStore(db);
  const workspace = await workspaces.register({ path: root });
  const tasks = new AgentTaskStore(db, workspaces);
  try {
    const agent = tasks.registerAgent('session-auto', workspace.id, {
      name: 'auto-backend',
      role: 'backend',
      capabilities: ['api'],
    } as any);
    const eligible = tasks.createTask(workspace.id, {
      title: 'Eligible',
      requiredRole: 'backend',
      requiredCapabilities: ['api'],
      priority: 20,
    } as any);
    const unmatched = tasks.createTask(workspace.id, {
      title: 'Unmatched',
      requiredRole: 'frontend',
      priority: 10,
    } as any);

    assert.equal(tasks.dispatchQueuedTasks(), 1);
    assert.equal(tasks.getTask(eligible.id)?.assignedAgentId, agent.id);
    assert.equal(tasks.getTask(unmatched.id)?.status, 'queued');
  } finally {
    db.close();
  }
});

test('dashboard snapshot exposes agents and tasks without changing their state', async () => {
  const root = resolve('logs', `agent-tasks-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const db = new CoreStore(resolve(root, 'core.db'));
  const workspaces = new WorkspaceStore(db);
  const workspace = await workspaces.register({ path: root });
  const tasks = new AgentTaskStore(db, workspaces);
  try {
    const agent = tasks.registerAgent('session-dashboard', workspace.id, {
      name: 'dashboard-agent',
      role: 'reviewer',
      capabilities: ['review'],
    } as any);
    const task = tasks.createTask(workspace.id, {
      title: 'Dashboard task',
      requiredRole: 'reviewer',
    } as any);
    const before = tasks.getTask(task.id);
    const snapshot = tasks.dashboardSnapshot();

    assert.equal(snapshot.agents[0].id, agent.id);
    assert.equal(snapshot.tasks[0].id, task.id);
    assert.equal(tasks.getTask(task.id)?.status, before?.status);
  } finally {
    db.close();
  }
});

test('completed task exposes a validated handoff for the next agent', async () => {
  const root = resolve('logs', `agent-tasks-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const db = new CoreStore(resolve(root, 'core.db'));
  const workspaces = new WorkspaceStore(db);
  const workspace = await workspaces.register({ path: root });
  const tasks = new AgentTaskStore(db, workspaces);
  try {
    const producer = tasks.registerAgent('session-producer', workspace.id, {
      name: 'producer',
      role: 'backend',
    } as any);
    tasks.registerAgent('session-consumer', workspace.id, {
      name: 'consumer',
      role: 'reviewer',
    } as any);
    const task = tasks.createTask(workspace.id, {
      title: 'Implement API',
      fileScopes: ['src/api/**'],
    } as any);
    tasks.claimTask(task.id, producer.id);

    const completed = tasks.completeTask(
      task.id,
      producer.id,
      { artifact: 'api-ready' },
      {
        summary: 'Implemented the API endpoint and validation.',
        changedFiles: ['src/api/routes.ts', 'src/api/routes.test.ts'],
        testResult: { command: 'npm test -- api', passed: true },
      },
    );

    assert.deepEqual(completed.result, { artifact: 'api-ready' });
    assert.deepEqual(completed.handoff, {
      summary: 'Implemented the API endpoint and validation.',
      changedFiles: ['src/api/routes.ts', 'src/api/routes.test.ts'],
      testResult: { command: 'npm test -- api', passed: true },
    });
    assert.deepEqual(tasks.getTaskHandoff(task.id), {
      task: completed,
      handoff: completed.handoff,
    });
    const invalid = tasks.createTask(workspace.id, {
      title: 'Reject outside changed file',
      fileScopes: ['src/other/**'],
    } as any);
    tasks.claimTask(invalid.id, producer.id);
    assert.throws(
      () =>
        tasks.completeTask(invalid.id, producer.id, undefined, {
          changedFiles: ['src/unclaimed.txt'],
        }),
      /Task handoff changed files must stay inside the task scopes/,
    );
    assert.throws(
      () =>
        tasks.completeTask(invalid.id, producer.id, undefined, {
          changedFiles: ['..\\outside.txt'],
        }),
      /Task changed files must stay inside the workspace/,
    );
  } finally {
    db.close();
  }
});

test('dependent agents exchange a persisted handoff and acknowledgement', async () => {
  const root = resolve('logs', `agent-tasks-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const db = new CoreStore(resolve(root, 'core.db'));
  const workspaces = new WorkspaceStore(db);
  const workspace = await workspaces.register({ path: root });
  const tasks = new AgentTaskStore(db, workspaces);
  try {
    const producer = tasks.registerAgent('session-message-producer', workspace.id, {
      name: 'producer',
      role: 'backend',
      capabilities: ['api'],
    } as any);
    const reviewer = tasks.registerAgent('session-message-reviewer', workspace.id, {
      name: 'reviewer',
      role: 'reviewer',
      capabilities: ['review'],
    } as any);
    const source = tasks.createTask(workspace.id, {
      title: 'Build API',
      fileScopes: ['src/api/**'],
    } as any);
    const followUp = tasks.createTask(workspace.id, {
      title: 'Review API',
      fileScopes: ['src/review/**'],
      dependsOn: [source.id],
      requiredRole: 'reviewer',
      requiredCapabilities: ['review'],
    } as any);
    tasks.claimTask(source.id, producer.id);
    tasks.completeTask(
      source.id,
      producer.id,
      { artifact: 'api-ready' },
      {
        summary: 'API is ready for review.',
        changedFiles: ['src/api/routes.ts'],
        testResult: { passed: true },
      },
    );

    assert.equal(tasks.dispatchQueuedTasks(), 1);
    assert.equal(tasks.getTask(followUp.id)?.assignedAgentId, reviewer.id);
    const created = tasks.syncHandoffMessages();
    assert.equal(created.length, 1);
    const message = created[0];
    assert.equal(message.kind, 'task_handoff');
    assert.equal(message.fromAgentId, producer.id);
    assert.equal(message.toAgentId, reviewer.id);
    assert.equal(message.status, 'pending');
    assert.deepEqual(message.payload, {
      sourceTaskId: source.id,
      targetTaskId: followUp.id,
      handoff: tasks.getTask(source.id)?.handoff,
      result: { artifact: 'api-ready' },
    });
    assert.deepEqual(tasks.listAgentMessages(workspace.id, reviewer.id), [message]);
    assert.equal(tasks.syncHandoffMessages().length, 0);

    const acknowledgement = tasks.acknowledgeAgentMessage(message.id, reviewer.id);
    assert.equal(acknowledgement.message.status, 'acknowledged');
    assert.equal(acknowledgement.response?.kind, 'handoff_ack');
    assert.equal(acknowledgement.response?.fromAgentId, reviewer.id);
    assert.equal(acknowledgement.response?.toAgentId, producer.id);
    assert.deepEqual(tasks.listAgentMessages(workspace.id, producer.id), [
      acknowledgement.response,
    ]);
    assert.deepEqual(tasks.listAgentMessages(workspace.id, reviewer.id), []);
  } finally {
    db.close();
  }
});
