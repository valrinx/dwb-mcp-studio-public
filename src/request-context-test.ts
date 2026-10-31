import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextDiagnostic, resolveLogicalRequestContext } from './request-context.js';

const a = resolveLogicalRequestContext({
  request_id: 'wfr_ephemeral_turn_123456',
  openai: { conversation_id: 'conv-z3-1234567890' },
});
assert.ok(a);
assert.equal(a.source, 'meta.openai.conversation_id');
assert.match(a.key, /^meta\.openai\.conversation_id:sha256:/);
assert.ok(!a.key.includes('conv-z3-1234567890'));

const chatGpt = resolveLogicalRequestContext({
  'openai/session': 'v1/anonymized-conversation-1234567890',
  'openai/subject': 'v1/anonymized-user-1234567890',
});
assert.ok(chatGpt);
assert.equal(chatGpt.source, 'meta.openai/session');
assert.match(chatGpt.key, /^meta\.openai\/session:sha256:/);
assert.ok(!chatGpt.key.includes('anonymized-conversation'));

const b = resolveLogicalRequestContext({
  request_id: 'wfr_ephemeral_turn_abcdef',
  thread_id: 'thread-z6-abcdef123456',
});
assert.ok(b);
assert.equal(b.source, 'meta.thread_id');

const none = resolveLogicalRequestContext({
  request_id: 'wfr_only_ephemeral_123456',
  traceparent: '00-1234567890abcdef1234567890abcdef-1234567890abcdef-01',
});
assert.equal(none, null);

const diag = contextDiagnostic({ custom: { foo: 'bar-value-123456' } });
for (const meta of [
  { conversation: { request_id: 'request-000001' } },
  { conversation: { title: 'A title that can change' } },
  { chat: { trace_id: 'trace-00000001' } },
  { trace: { conversation_id: 'conversation-in-trace' } },
  { run_id: 'run-per-request-123' },
])
  assert.equal(resolveLogicalRequestContext(meta), null, JSON.stringify(meta));
const nested = resolveLogicalRequestContext({
  conversation: { id: 'chat-fixed-123', request_id: 'request-11111' },
});
assert.ok(nested);
assert.equal(nested.source, 'meta.conversation.id');
assert.equal(
  nested.key,
  resolveLogicalRequestContext({
    conversation: { id: 'chat-fixed-123', request_id: 'request-22222' },
  })?.key,
);
assert.ok(diag.keys.includes('meta.custom.foo'));
console.log('REQUEST_CONTEXT_PASS', JSON.stringify({ a: a.preview, b: b.preview }));

test('agents in one conversation have separate stable request contexts', () => {
  const meta = { 'openai/session': 'conversation-shared-123456' };
  const first = resolveLogicalRequestContext({ ...meta, agent_id: 'agent-coder-123456' });
  const second = resolveLogicalRequestContext({ ...meta, agent_id: 'agent-reviewer-123456' });
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.key, second.key);
  assert.notEqual(first.key, resolveLogicalRequestContext(meta)?.key);
  assert.equal(
    first.key,
    resolveLogicalRequestContext({
      ...meta,
      agent_id: 'agent-coder-123456',
      request_id: 'new-request-123456',
      run_id: 'new-run-123456',
    })?.key,
  );
  assert.ok(!first.key.includes('agent-coder'));
});

test('thread identity separates agents sharing the OpenAI session', () => {
  const meta = { 'openai/session': 'conversation-shared-123456' };
  const first = resolveLogicalRequestContext(meta, { thread_id: 'thread-coder-123456' });
  const second = resolveLogicalRequestContext(meta, { thread_id: 'thread-reviewer-123456' });
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.key, second.key);
  assert.equal(
    first.key,
    resolveLogicalRequestContext(meta, {
      thread_id: 'thread-coder-123456',
      run_id: 'another-run-123456',
    })?.key,
  );
});
