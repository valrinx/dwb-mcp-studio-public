#!/usr/bin/env node
/**
 * stdio-http-bridge.mjs
 *
 * Exposes a stdio-based MCP server (default: N3zuui Studio Core via
 * scripts/start.mjs) over Streamable HTTP so that remote MCP clients can
 * connect to it over the network.
 *
 * Usage (run from the repository root):
 *   npm run build
 *   node scripts/stdio-http-bridge.mjs [--port 3000] [--path /mcp]
 *       [--token SECRET] [--timeout-ms 120000] [-- command args...]
 *
 * Defaults to spawning: <node> scripts/start.mjs
 *
 * Protocol notes:
 * - Speaks newline-delimited JSON-RPC with the child process over stdio
 *   (standard MCP stdio framing).
 * - HTTP POST /mcp accepts one JSON-RPC message or a batch array and answers
 *   with plain JSON (no SSE) — valid Streamable HTTP.
 * - Messages with an "id" are correlated with child stdout by id.
 *   Notifications (no "id") are forwarded and answered with HTTP 202.
 * - Child-initiated requests the bridge cannot serve get a JSON-RPC
 *   "Method not found" reply so the child never blocks waiting.
 * - GET /health answers {"ok":true} for readiness checks / tunnel health.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function parseArgs(argv) {
  const opts = {
    port: 3000,
    path: '/mcp',
    token: null,
    timeoutMs: 120000,
    command: null, // [cmd, ...args]; default below
  };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--') {
      opts.command = argv.slice(i + 1);
      break;
    }
    const next = argv[i + 1];
    if (a === '--port') opts.port = Number(next);
    else if (a === '--path') opts.path = next;
    else if (a === '--token') opts.token = next;
    else if (a === '--timeout-ms') opts.timeoutMs = Number(next);
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
    i += 2;
  }
  if (!opts.command || opts.command.length === 0) {
    opts.command = [process.execPath, join(ROOT, 'scripts', 'start.mjs')];
  }
  if (!Number.isFinite(opts.port) || opts.port <= 0) {
    console.error('Invalid --port');
    process.exit(2);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------------------
// Child process (the stdio MCP server)
// ---------------------------------------------------------------------------

const pending = new Map(); // id -> { resolve, settled }
let childDead = false;
let stdoutBuf = '';

const child = spawn(opts.command[0], opts.command.slice(1), {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: ROOT,
  windowsHide: true,
});

child.on('error', (err) => {
  console.error(`[bridge] failed to spawn child: ${err.message}`);
  failAll(new Error('stdio server failed to start'));
});

child.on('exit', (code, signal) => {
  childDead = true;
  console.error(`[bridge] child exited (code=${code} signal=${signal})`);
  failAll(new Error('stdio server exited'));
});

child.stderr.on('data', (d) => {
  process.stderr.write(`[child] ${d}`);
});

function failAll(err) {
  for (const [, entry] of pending) {
    if (!entry.settled) {
      entry.settled = true;
      entry.resolve({ error: toJsonRpcError(entry.id, -32000, `Bridge: ${err.message}`) });
    }
  }
  pending.clear();
}

child.stdout.on('data', (chunk) => {
  stdoutBuf += chunk.toString('utf8');
  let nl;
  while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
    const line = stdoutBuf.slice(0, nl).trim();
    stdoutBuf = stdoutBuf.slice(nl + 1);
    if (line) handleChildLine(line);
  }
});

function handleChildLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    console.error(`[bridge] non-JSON line on child stdout: ${line.slice(0, 200)}`);
    return;
  }
  const messages = Array.isArray(msg) ? msg : [msg];
  for (const m of messages) {
    if (m && typeof m === 'object' && m.id !== undefined && pending.has(cacheKey(m.id))) {
      const entry = pending.get(cacheKey(m.id));
      pending.delete(cacheKey(m.id));
      if (!entry.settled) {
        entry.settled = true;
        entry.resolve({ response: m });
      }
    } else if (m && typeof m === 'object' && m.method !== undefined) {
      // Child-initiated message. Notifications: ignore. Requests: answer
      // "Method not found" so the child never hangs waiting on the bridge.
      if (m.id !== undefined) {
        writeChild({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
      }
    }
    // else: response for an unknown/expired id — drop it.
  }
}

function cacheKey(id) {
  return `${typeof id}:${String(id)}`;
}

function toJsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function writeChild(obj) {
  if (childDead) return false;
  return child.stdin.write(JSON.stringify(obj) + '\n');
}

// ---------------------------------------------------------------------------
// HTTP server (Streamable HTTP, JSON responses)
// ---------------------------------------------------------------------------

function authorized(req) {
  if (!opts.token) return true;
  const got = req.headers.authorization || '';
  const want = `Bearer ${opts.token}`;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = obj === null ? '' : JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function handleMcpPost(req, res) {
  if (!authorized(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    sendJson(res, 400, { error: err.message });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: 'invalid JSON' });
    return;
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  if (messages.length === 0 || messages.some((m) => typeof m !== 'object' || m === null)) {
    sendJson(res, 400, { error: 'expected a JSON-RPC message or batch array' });
    return;
  }
  if (childDead) {
    sendJson(res, 503, { error: 'stdio server not running' });
    return;
  }

  const jobs = []; // in request order: { id } for requests needing a response
  for (const m of messages) {
    if (m.id !== undefined) {
      jobs.push(
        new Promise((resolve) => {
          pending.set(cacheKey(m.id), { resolve, settled: false, id: m.id });
        }),
      );
    }
    if (!writeChild(m)) {
      sendJson(res, 503, { error: 'stdio server not running' });
      return;
    }
  }

  if (jobs.length === 0) {
    // Notifications only.
    res.writeHead(202);
    res.end();
    return;
  }

  const timer = setTimeout(() => {
    for (const m of messages) {
      if (m.id !== undefined && pending.has(cacheKey(m.id))) {
        const entry = pending.get(cacheKey(m.id));
        pending.delete(cacheKey(m.id));
        if (!entry.settled) {
          entry.settled = true;
          entry.resolve({ error: toJsonRpcError(m.id, -32000, 'Bridge: timed out waiting for stdio server') });
        }
      }
    }
  }, opts.timeoutMs);
  // Don't keep the process alive just for the timer.
  timer.unref?.();

  const settled = await Promise.all(jobs);
  clearTimeout(timer);

  const out = settled.map((s) => s.response ?? s.error);
  sendJson(res, 200, messages.length === 1 && !Array.isArray(parsed) ? out[0] : out);
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, childDead ? 503 : 200, { ok: !childDead });
    return;
  }
  if (url.pathname === opts.path) {
    if (req.method === 'POST') {
      handleMcpPost(req, res).catch((err) => {
        console.error(`[bridge] request failed: ${err.message}`);
        if (!res.headersSent) sendJson(res, 500, { error: 'bridge internal error' });
      });
      return;
    }
    // Streamable HTTP GET/DELETE (SSE streams, session termination) are not
    // needed for the JSON-response POST flow this bridge serves.
    sendJson(res, 405, { error: 'only POST is supported on this endpoint' });
    return;
  }
  sendJson(res, 404, { error: 'not found' });
});

server.on('clientError', (err, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

function shutdown() {
  console.error('[bridge] shutting down');
  try {
    child.kill();
  } catch {
    // already gone
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(opts.port, '127.0.0.1', () => {
  console.error(
    `[bridge] listening on http://127.0.0.1:${opts.port}${opts.path} ` +
      `(child: ${opts.command.join(' ')})${opts.token ? ' [auth on]' : ''}`,
  );
});
