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
