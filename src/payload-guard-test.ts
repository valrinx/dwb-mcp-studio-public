import assert from 'node:assert/strict';
import { access, readFile, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EventLog } from './event-log.js';
import { PayloadGuard } from './payload-guard.js';

const root = resolve('logs', 'payload-test');
process.env.DWB_TELEMETRY_ENABLED = 'false';
await rm(root, { recursive: true, force: true });
const log = new EventLog(resolve(root, 'events.jsonl'));
const guard = new PayloadGuard(log, {
  enabled: true,
  maxBytes: 64 * 1024,
  warnBytes: 32 * 1024,
  previewBytes: 8 * 1024,
  archiveOversized: true,
  archiveMode: 'redacted',
  archiveRetentionDays: 7,
  archiveMaxFiles: 2,
  archiveDir: resolve(root, 'payloads'),
});

const small = { content: [{ type: 'text', text: 'hello' }] };
const smallApplied = await guard.apply('read_file', { path: 'small.txt' }, small);
assert.equal(smallApplied.guarded, false);
assert.deepEqual(smallApplied.result, small);

const hugeImage = {
  content: [
    { type: 'text', text: 'token=super-secret-value Bearer abcdefghijklmnopqrstuvwxyz' },
    { type: 'image', mimeType: 'image/png', data: 'A'.repeat(2 * 1024 * 1024) },
  ],
};
const imageApplied = await guard.apply('read_file', { path: 'huge.png' }, hugeImage);
assert.equal(imageApplied.guarded, true);
assert.ok(imageApplied.originalBytes > 2 * 1024 * 1024);
assert.ok(imageApplied.forwardedBytes < 64 * 1024);
assert.ok(imageApplied.archivePath);
await access(imageApplied.archivePath!);
const redactedArchive = await readFile(imageApplied.archivePath!, 'utf8');
assert.match(redactedArchive, /OMITTED_BINARY/);
assert.doesNotMatch(redactedArchive, /super-secret-value/);
assert.doesNotMatch(redactedArchive, /abcdefghijklmnopqrstuvwxyz/);
const imageForwarded = JSON.stringify(imageApplied.result);
assert.match(imageForwarded, /N3zuui Payload Guard intercepted/);
assert.doesNotMatch(imageForwarded, /A{1000}/);

const hugeStructured = {
  content: [{ type: 'text', text: 'structured test' }],
  structuredContent: { rows: 'Z'.repeat(128 * 1024) },
};
const structuredApplied = await guard.apply('some_structured_tool', {}, hugeStructured);
assert.equal(structuredApplied.guarded, true);
assert.ok(structuredApplied.forwardedBytes < 64 * 1024);
assert.equal((structuredApplied.result as any).isError, true);
assert.equal((structuredApplied.result as any).structuredContent, undefined);
await guard.apply(
  'third_tool',
  {},
  { content: [{ type: 'text', text: 'third\n' + 'Q'.repeat(128 * 1024) }] },
);
const archives = (await readdir(resolve(root, 'payloads'))).filter((name) =>
  name.endsWith('.json'),
);
assert.ok(archives.length <= 2, `archive retention max-files failed: ${archives.length}`);
// --- UTF-8 safe preview truncation ----------------------------------------
// A byte-wise slice cuts multi-byte characters in half and leaves U+FFFD in the
// preview; Thai characters are 3 bytes each, so this is not an edge case.
// Several budgets are exercised because any single one may land on a character
// boundary by luck and pass against a byte-wise implementation.
const thaiText = 'สวัสดีครับ ทดสอบภาษาไทย '.repeat(1200);
for (const previewBytes of [999, 1000, 1001, 1002, 1003, 1004, 1005]) {
  const thaiGuard = new PayloadGuard(log, {
    enabled: true,
    maxBytes: 32 * 1024,
    warnBytes: 16 * 1024,
    previewBytes,
    archiveOversized: false,
    archiveMode: 'off',
    archiveRetentionDays: 7,
    archiveMaxFiles: 2,
    archiveDir: resolve(root, 'payloads'),
  });
  const thaiApplied = await thaiGuard.apply(
    'read_file',
    { path: 'thai.txt' },
    {
      content: [{ type: 'text', text: thaiText }],
    },
  );
  assert.equal(thaiApplied.guarded, true);
  const thaiForwarded = JSON.stringify(thaiApplied.result);
  assert.doesNotMatch(
    thaiForwarded,
    /\uFFFD/,
    `preview truncated mid-character at previewBytes=${previewBytes}`,
  );
  assert.match(thaiForwarded, /สวัสดีครับ/, 'Thai preview text was lost');
}

// --- PDPA redaction in archives -------------------------------------------
const piiGuard = new PayloadGuard(log, {
  enabled: true,
  maxBytes: 2 * 1024,
  warnBytes: 1024,
  previewBytes: 256,
  archiveOversized: true,
  archiveMode: 'redacted',
  archiveRetentionDays: 7,
  archiveMaxFiles: 20,
  archiveDir: resolve(root, 'pii-payloads'),
});
const record = {
  citizen_id: '1103701234567',
  idCardFormatted: '1-1037-01234-56-7',
  passport: 'AB1234567',
  email: 'somchai.jai@kmutt.ac.th',
  phone: '081-234-5678',
  full_name: 'สมชาย ใจดี',
  home_address: '126 ถนนประชาอุทิศ บางมด',
  bank_account: '1234567890123456',
};
const piiApplied = await piiGuard.apply(
  'read_file',
  { path: '/secure/students.json' },
  { content: [{ type: 'text', text: JSON.stringify(record) + ' '.repeat(4096) }] },
);
assert.equal(piiApplied.guarded, true);
assert.ok(piiApplied.archivePath, 'PII archive was not written');
const piiArchive = await readFile(piiApplied.archivePath!, 'utf8');
for (const secret of [
  '1103701234567',
  '1-1037-01234-56-7',
  'AB1234567',
  'somchai.jai@kmutt.ac.th',
  '081-234-5678',
  'สมชาย',
  'ประชาอุทิศ',
]) {
  assert.ok(!piiArchive.includes(secret), `PII leaked into archive: ${secret}`);
}
// Over-redaction would make an archive useless, so ordinary values must survive.
const benignApplied = await piiGuard.apply(
  'read_file',
  { path: 'notes.txt' },
  {
    content: [{ type: 'text', text: 'order #12345 shipped in 2026\n' + 'x'.repeat(4096) }],
  },
);
const benignArchive = await readFile(benignApplied.archivePath!, 'utf8');
assert.match(benignArchive, /12345/);
assert.match(benignArchive, /2026/);

// --- Redaction must stay linear -------------------------------------------
// An unbounded quantifier wrapped around the key alternation, or an optional
// separator inside a {13,19} repeat, turns this into a multi-minute stall.
const adversarial = [
  'a'.repeat(200_000),
  '1'.repeat(200_000),
  'full_name' + 'a'.repeat(100_000),
  'The quick brown fox jumps over the lazy dog. '.repeat(20_000),
];
for (const text of adversarial) {
  const started = performance.now();
  await piiGuard.apply(
    'read_file',
    { path: 'adversarial.txt' },
    {
      content: [{ type: 'text', text }],
    },
  );
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs < 5_000, `redaction took ${Math.round(elapsedMs)}ms; pattern backtracks`);
}

const status = guard.status;
assert.equal(status.guardedCount, 3);
assert.equal(status.lastGuardedTool, 'third_tool');
assert.ok(status.guardedOriginalBytes > status.guardedForwardedBytes);

console.log(
  'PAYLOAD_GUARD_UNIT_PASS',
  JSON.stringify({
    guardedCount: status.guardedCount,
    imageOriginalBytes: imageApplied.originalBytes,
    imageForwardedBytes: imageApplied.forwardedBytes,
    structuredOriginalBytes: structuredApplied.originalBytes,
    structuredForwardedBytes: structuredApplied.forwardedBytes,
  }),
);
