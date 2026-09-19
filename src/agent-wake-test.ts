import assert from 'node:assert/strict';
import { AgentWakeQueue } from './agent-wake.js';

const queue = new AgentWakeQueue();

const notified = queue.wait('agent-a', 500);
queue.notify('agent-a');
assert.equal(await notified, true);

assert.equal(await queue.wait('agent-a', 0), false);

const timeoutStarted = Date.now();
assert.equal(await queue.wait('agent-a', 20), false);
assert.ok(Date.now() - timeoutStarted >= 10);

const controller = new AbortController();
const aborted = queue.wait('agent-a', 500, controller.signal);
controller.abort(new Error('test cancelled'));
await assert.rejects(aborted, /test cancelled/);

console.log('AGENT_WAKE_PASS');
