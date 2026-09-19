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
