import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setImmediate as tick, setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import type { WorkerSupervisor } from './worker-supervisor.js';

process.env.DWB_BROKER_STATE_PATH = resolve('logs', `lifecycle-${randomUUID()}`, 'state.json');
process.env.DWB_WORKER_CAP = '1';
process.env.DWB_IDLE_WORKER_MS = '250';
const { SessionRegistry } = await import('./session-registry.js');
const { EventLog } = await import('./event-log.js');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function until(check: () => boolean) {
  for (let i = 0; i < 1000; i++) {
    if (check()) return;
    await tick();
  }
  assert.fail('Expected lifecycle transition did not happen');
}

function fixture(startGate: Promise<void> = Promise.resolve()) {
  let live = 0;
  let peak = 0;
  const workers: FakeWorker[] = [];
  class FakeWorker {
    status = { workerPid: workers.length + 1 };
    stopped = false;
    read = deferred<{ contents: [] }>();
    probe: Promise<boolean> = Promise.resolve(false);
    startGate = startGate;
    stopGate: Promise<void> = Promise.resolve();
    async start() {
      await this.startGate;
      live++;
      peak = Math.max(peak, live);
    }
    async stop() {
      await this.stopGate;
      if (!this.stopped) {
        this.stopped = true;
        live--;
      }
    }
    async hasActiveWork() {
      return this.probe;
    }
    async listTools() {
      assert.equal(this.stopped, false);
      return { tools: [] };
    }
    async readResource() {
      return this.read.promise;
    }
  }
  const log = new EventLog();
  log.write = async () => {};
  const registry = new SessionRegistry(log, undefined, () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as WorkerSupervisor;
  });
  return {
    registry,
    workers,
    get live() {
      return live;
    },
    get peak() {
      return peak;
    },
  };
}

test('concurrent requests never oversubscribe a reclaimed worker slot', async () => {
  const f = fixture();
  try {
    const old = await f.registry.attach(process.cwd(), 1);
    await f.registry.listTools(old);
    const a = await f.registry.attach(process.cwd(), 2);
    const b = await f.registry.attach(process.cwd(), 3);
    await delay(300);
    const results = [f.registry.listTools(a), f.registry.listTools(b)];
    const settled = Promise.allSettled(results);
    await until(() => f.workers.length >= 2);
    // Drain microtasks so both contenders have a chance to start.
    for (let i = 0; i < 20; i++) await tick();
    assert.equal(f.peak, 1, 'worker cap includes all starting workers');
    assert.equal(f.registry.status.queueDepth, 1);
    const running = f.registry.listSessions().find((s) => s.workerPid !== null)!;
    await results[running.sessionId === a ? 0 : 1];
    await f.registry.detach(running.sessionId);
    await until(() => f.workers.length === 3);
    assert.deepEqual(
      (await settled).map((r) => r.status),
      ['fulfilled', 'fulfilled'],
    );
    assert.equal(f.peak, 1);
  } finally {
    await f.registry.shutdown();
  }
});

test('shutdown waits for a starting worker and releases its reserved slot', async () => {
  const gate = deferred<void>();
  const f = fixture(gate.promise);
  const id = await f.registry.attach(process.cwd(), 1);
  const request = assert.rejects(f.registry.listTools(id), /shutting down/);
  await until(() => f.workers.length === 1);
  const stopping = f.registry.shutdown();
  gate.resolve();
  await Promise.all([stopping, request]);
  assert.equal(f.live, 0);
  assert.equal(f.registry.status.startingWorkers, 0);
  assert.equal(f.registry.status.sessions, 0);
  await assert.rejects(f.registry.attach(process.cwd(), 2), /shutting down/);
});

test('one queued request reclaims only one idle worker', async () => {
  process.env.DWB_WORKER_CAP = '2';
  const f = fixture();
  process.env.DWB_WORKER_CAP = '1';
  try {
    const a = await f.registry.attach(process.cwd(), 1);
    const b = await f.registry.attach(process.cwd(), 2);
    await f.registry.listTools(a);
    await f.registry.listTools(b);
    await delay(300);
    const c = await f.registry.attach(process.cwd(), 3);
    await f.registry.listTools(c);
    for (let i = 0; i < 20; i++) await tick();
    assert.equal(f.registry.status.activeWorkers, 2);
    assert.equal(f.workers.filter((w) => w.stopped).length, 1);
  } finally {
    await f.registry.shutdown();
  }
});

test('disconnect during worker startup does not leave an orphan process', async () => {
  const gate = deferred<void>();
  const f = fixture(gate.promise);
  try {
    const id = await f.registry.attach(process.cwd(), 1);
    const request = assert.rejects(f.registry.listTools(id), /detached/);
    await until(() => f.workers.length === 1);
    await f.registry.detach(id);
    gate.resolve();
    await request;
    assert.equal(f.live, 0);
    assert.equal(f.registry.status.startingWorkers, 0);
  } finally {
    gate.resolve();
    await f.registry.shutdown();
  }
});

test('retiring processes still count toward the cap until they have stopped', async () => {
  const f = fixture();
  const stop = deferred<void>();
  try {
    const old = await f.registry.attach(process.cwd(), 1);
    await f.registry.listTools(old);
    f.workers[0].stopGate = stop.promise;
    await f.registry.detach(old);
    const id = await f.registry.attach(process.cwd(), 2);
    const pending = f.registry.listTools(id);
    await until(() => f.registry.status.stoppingWorkers === 1);
    assert.equal(f.workers.length, 1);
    assert.equal(f.registry.sessionStatus(id).queuePosition, 1);
    stop.resolve();
    await pending;
    assert.equal(f.peak, 1);
  } finally {
    stop.resolve();
    await f.registry.shutdown();
  }
});

test('manual restart and resume reject while a resource request is running', async () => {
  const f = fixture();
  try {
    const id = await f.registry.attach(process.cwd(), 1);
    const target = await f.registry.attach(process.cwd(), 2);
    await f.registry.detach(target);
    await f.registry.listTools(id);
    const request = f.registry.readResource(id, 'test://resource');
    await assert.rejects(f.registry.restartWorker(id), /busy/);
    await assert.rejects(f.registry.resume(id, target, 1), /busy/);
    f.workers[0].read.resolve({ contents: [] });
    await request;
  } finally {
    await f.registry.shutdown();
  }
});

test('resumed logical sessions stay in the current transport family', async () => {
  const f = fixture();
  try {
    const root = await f.registry.attach(process.cwd(), 1);
    await f.registry.resolveContext(root, { key: 'a', source: 'test' });
    const logical = await f.registry.resolveContext(root, { key: 'b', source: 'test' });
    const target = await f.registry.attach(process.cwd(), 2);
    await f.registry.detach(target);
    await f.registry.resume(logical, target, 1);
    await f.registry.detach(root);
    assert.equal(f.registry.sessionStatus(target).state, 'detached');
  } finally {
    await f.registry.shutdown();
  }
});

test('independently reconnected logical sessions do not detach each other', async () => {
  const f = fixture();
  try {
    const root = await f.registry.attach(process.cwd(), 1);
    const mainContext = { key: 'main-chat-123', source: 'test' };
    const workerContext = { key: 'worker-chat-456', source: 'test' };
    await f.registry.resolveContext(root, mainContext);
    const child = await f.registry.resolveContext(root, workerContext);
    await f.registry.detach(root);

    assert.equal(await f.registry.attach(process.cwd(), 2, root), root);
    assert.equal(await f.registry.attach(process.cwd(), 3, child), child);
    await f.registry.detach(root);

    assert.equal(f.registry.sessionStatus(child).state, 'attached');
    assert.equal(await f.registry.resolveContext(child, workerContext), child);
    assert.equal(f.registry.sessionStatus(child).adapterPid, 3);
  } finally {
    await f.registry.shutdown();
  }
});

test('new chat stays on the resumed session for subsequent metadata-routed requests', async () => {
  const f = fixture();
  try {
    const old = await f.registry.attach(process.cwd(), 1);
    await f.registry.resolveContext(old, { key: 'chat-old-123', source: 'test' });
    await f.registry.detach(old);
    const fresh = await f.registry.attach(process.cwd(), 2);
    const newContext = { key: 'chat-new-456', source: 'test' };
    await f.registry.resolveContext(fresh, newContext);
    const resumed = await f.registry.resume(fresh, old, 2);
    assert.equal(await f.registry.resolveContext(resumed, newContext), old);
    assert.equal(f.registry.status.sessions, 1);
  } finally {
    await f.registry.shutdown();
  }
});

test('resume refuses to discard a current worker with background work and can retry later', async () => {
  const f = fixture();
  try {
    const target = await f.registry.attach(process.cwd(), 1);
    await f.registry.detach(target);
    const current = await f.registry.attach(process.cwd(), 2);
    await f.registry.listTools(current);
    f.workers[0].probe = Promise.resolve(true);
    await assert.rejects(f.registry.resume(current, target, 2), /active processes/);
    assert.equal(f.workers[0].stopped, false);
    assert.equal(f.registry.sessionStatus(target).state, 'detached');
    assert.equal(f.registry.status.inFlightCalls, 0);
    f.workers[0].probe = Promise.resolve(false);
    assert.equal(await f.registry.resume(current, target, 2), target);
  } finally {
    await f.registry.shutdown();
  }
});

test('resuming one logical chat preserves sibling chat routing', async () => {
  const f = fixture();
  try {
    const old = await f.registry.attach(process.cwd(), 1);
    await f.registry.resolveContext(old, { key: 'old-chat', source: 'test' });
    await f.registry.detach(old);
    const root = await f.registry.attach(process.cwd(), 2);
    const siblingContext = { key: 'sibling-chat', source: 'test' };
    const newContext = { key: 'new-chat', source: 'test' };
    await f.registry.resolveContext(root, siblingContext);
    const logical = await f.registry.resolveContext(root, newContext);
    await f.registry.resume(logical, old, 2);
    assert.equal(await f.registry.resolveContext(root, newContext), old);
    assert.equal(await f.registry.resolveContext(root, siblingContext), root);
  } finally {
    await f.registry.shutdown();
  }
});

test('resource reads count as active work and survive idle reclamation', async () => {
  const f = fixture();
  const realNow = Date.now;
  try {
    const id = await f.registry.attach(process.cwd(), 1);
    await f.registry.listTools(id);
    const reading = f.registry.readResource(id, 'test://resource');
    await tick();
    Date.now = () => realNow() + 1000;
    assert.equal(f.registry.status.inFlightCalls, 1);
    assert.equal(await f.registry.reclaimIdleWorkers(), 0);
    assert.equal(f.workers[0].stopped, false);
    f.workers[0].read.resolve({ contents: [] });
    await reading;
  } finally {
    Date.now = realNow;
    await f.registry.shutdown();
  }
});

test('new work arriving during an idle probe prevents retirement', async () => {
  const f = fixture();
  const realNow = Date.now;
  try {
    const id = await f.registry.attach(process.cwd(), 1);
    await f.registry.listTools(id);
    const probe = deferred<boolean>();
    f.workers[0].probe = probe.promise;
    Date.now = () => realNow() + 1000;
    const reclaiming = f.registry.reclaimIdleWorkers();
    const reading = f.registry.readResource(id, 'test://resource');
    await tick();
    probe.resolve(false);
    assert.equal(await reclaiming, 0);
    assert.equal(f.workers[0].stopped, false);
    f.workers[0].read.resolve({ contents: [] });
    await reading;
  } finally {
    Date.now = realNow;
    await f.registry.shutdown();
  }
});
