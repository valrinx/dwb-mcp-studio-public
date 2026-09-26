import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

type BrokerReply = { id: string; ok: boolean; result?: any; error?: { message: string } };

function request(endpoint: string, message: Record<string, unknown>): Promise<BrokerReply> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timed out waiting for broker IPC response'));
    }, 5_000);
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(JSON.stringify(message) + '\n'));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      socket.end();
      try {
        resolve(JSON.parse(buffer.slice(0, newline)) as BrokerReply);
      } catch (error) {
        reject(error);
      }
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function waitForBroker(endpoint: string, child: ChildProcess): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Broker exited before ready (${child.exitCode})`);
    try {
      const reply = await request(endpoint, { id: 'ready', method: 'ping' });
      if (reply.ok) return;
      lastError = new Error(reply.error?.message ?? 'Broker ping failed');
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError instanceof Error ? lastError : new Error('Broker did not become ready');
}

function openChannel(endpoint: string) {
  const socket = createConnection(endpoint);
  let buffer = '';
  let pending: ((reply: BrokerReply) => void) | null = null;
  const connected = new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', reject);
  });
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const reply = JSON.parse(line) as BrokerReply;
      const resolve = pending;
      pending = null;
      resolve?.(reply);
    }
  });
  return {
    async request(message: Record<string, unknown>): Promise<BrokerReply> {
      await connected;
      return new Promise((resolve, reject) => {
        if (pending) return reject(new Error('Only one broker request may be pending'));
        pending = resolve;
        socket.write(JSON.stringify(message) + '\n');
        setTimeout(() => {
          if (pending === resolve) {
            pending = null;
            reject(new Error('Timed out waiting for broker IPC response'));
          }
        }, 5_000).unref();
      });
    },
    close(): void {
      socket.destroy();
    },
  };
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    delay(5_000).then(() => {
      child.kill('SIGKILL');
    }),
  ]);
}

test('broker exposes local MCP server management before a chat session attaches', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dwb-external-mcp-broker-'));
  const endpoint = `\\\\.\\pipe\\dwb-external-mcp-test-${process.pid}`;
  const brokerEntry = fileURLToPath(new URL('../dist/broker-server.js', import.meta.url));
  const child = spawn(process.execPath, [brokerEntry], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DWB_BROKER_PIPE: endpoint,
      DWB_DATA_DIR: root,
      DWB_RUNTIME_DIR: join(root, 'runtime'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-4000);
  });
  t.after(async () => {
    await stop(child);
    rmSync(root, { recursive: true, force: true });
  });

  await waitForBroker(endpoint, child).catch((error) => {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${stderr}`);
  });
  const saved = await request(endpoint, {
    id: 'save-server',
    method: 'external_mcp_manage',
    params: {
      action: 'save',
      servers: [
        {
          id: 'fixture',
          name: 'Fixture',
          command: process.execPath,
          args: ['fixture.mjs'],
          cwd: root,
          env: { FIXTURE_TOKEN: 'encrypted-value' },
          enabled: false,
        },
      ],
    },
  });
  assert.equal(saved.ok, true, saved.error?.message);

  const listed = await request(endpoint, {
    id: 'list-servers',
    method: 'external_mcp_manage',
    params: { action: 'list' },
  });
  assert.equal(listed.ok, true, listed.error?.message);
  assert.equal(listed.result.servers[0].id, 'fixture');
  assert.equal(listed.result.servers[0].env.FIXTURE_TOKEN, 'encrypted-value');
});

test('broker removes only a verified catalog installation when its definition is removed', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dwb-external-mcp-uninstall-'));
  const endpoint = `\\\\.\\pipe\\dwb-external-mcp-uninstall-${process.pid}`;
  const brokerEntry = fileURLToPath(new URL('../dist/broker-server.js', import.meta.url));
  const installDirectory = join(root, 'mcp-servers', 'installations', 'filesystem', '2026.8.31');
  const packageRoot = join(
    installDirectory,
    'node_modules',
    '@modelcontextprotocol',
    'server-filesystem',
  );
  mkdirSync(join(packageRoot, 'dist'), { recursive: true });
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: '@modelcontextprotocol/server-filesystem', version: '2026.8.31' }),
  );
  writeFileSync(join(packageRoot, 'dist', 'index.js'), 'process.exit(0);');
  const child = spawn(process.execPath, [brokerEntry], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DWB_BROKER_PIPE: endpoint,
      DWB_DATA_DIR: root,
      DWB_RUNTIME_DIR: join(root, 'runtime'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-4000);
  });
  t.after(async () => {
    await stop(child);
    rmSync(root, { recursive: true, force: true });
  });

  await waitForBroker(endpoint, child).catch((error) => {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${stderr}`);
  });
  const saved = await request(endpoint, {
    id: 'save-catalog-server',
    method: 'external_mcp_manage',
    params: {
      action: 'save',
      servers: [
        {
          id: 'filesystem',
          name: 'Filesystem',
          command: process.execPath,
          args: [join(packageRoot, 'dist', 'index.js'), root],
          cwd: root,
          env: {},
          enabled: false,
          source: 'catalog',
          catalogId: 'filesystem',
          packageName: '@modelcontextprotocol/server-filesystem',
          packageVersion: '2026.8.31',
          installDirectory,
        },
      ],
    },
  });
  assert.equal(saved.ok, true, saved.error?.message);
  const removed = await request(endpoint, {
    id: 'remove-catalog-server',
    method: 'external_mcp_manage',
    params: { action: 'remove', id: 'filesystem' },
  });
  assert.equal(removed.ok, true, removed.error?.message);
  assert.equal(existsSync(installDirectory), false);
  assert.deepEqual(removed.result.servers, []);
});

test('broker exposes and routes external MCP tools even when Desktop Commander cannot start', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dwb-external-mcp-public-'));
  const endpoint = `\\\\.\\pipe\\dwb-external-mcp-public-${process.pid}`;
  const brokerEntry = fileURLToPath(new URL('../dist/broker-server.js', import.meta.url));
  const child = spawn(process.execPath, [brokerEntry], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DWB_BROKER_PIPE: endpoint,
      DWB_DATA_DIR: root,
      DWB_RUNTIME_DIR: join(root, 'runtime'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-4000);
  });
  let channel: ReturnType<typeof openChannel> | null = null;
  t.after(async () => {
    channel?.close();
    await stop(child);
    rmSync(root, { recursive: true, force: true });
  });

  await waitForBroker(endpoint, child).catch((error) => {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${stderr}`);
  });
  channel = openChannel(endpoint);
  const fixture = `
    import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
    import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
    import { z } from 'zod';
    const server = new McpServer({ name: 'broker-fixture', version: '1.0.0' });
    server.registerTool('identify', { inputSchema: { value: z.string() } }, async ({ value }) => ({
      content: [{ type: 'text', text: 'external:' + value }],
    }));
    await server.connect(new StdioServerTransport());
  `;
  const saved = await request(endpoint, {
    id: 'save-enabled-server',
    method: 'external_mcp_manage',
    params: {
      action: 'save',
      servers: [
        {
          id: 'fixture',
          name: 'Fixture',
          command: process.execPath,
          args: ['--input-type=module', '-e', fixture],
          cwd: process.cwd(),
          env: {},
          enabled: true,
        },
      ],
    },
  });
  assert.equal(saved.ok, true, saved.error?.message);

  const hello = await channel.request({
    id: 'hello',
    method: 'hello',
    params: { cwd: root, adapterPid: process.pid },
  });
  assert.equal(hello.ok, true, hello.error?.message);

  const listed = await channel.request({ id: 'list-tools', method: 'list_tools' });
  assert.equal(listed.ok, true, listed.error?.message);
  assert.ok(
    listed.result.tools.some((tool: { name: string }) => tool.name === 'fixture__identify'),
  );

  const called = await channel.request({
    id: 'call-tool',
    method: 'call_tool',
    params: { name: 'fixture__identify', arguments: { value: 'through-broker' } },
  });
  assert.equal(called.ok, true, called.error?.message);
  assert.equal(called.result.content[0].text, 'external:through-broker');

  const replaceWithBrokenServer = await request(endpoint, {
    id: 'save-broken-server',
    method: 'external_mcp_manage',
    params: {
      action: 'save',
      servers: [
        {
          id: 'broken',
          name: 'Broken server',
          command: join(root, 'missing-mcp-server.exe'),
          args: [],
          cwd: root,
          env: {},
          enabled: true,
        },
      ],
    },
  });
  assert.equal(replaceWithBrokenServer.ok, true, replaceWithBrokenServer.error?.message);

  const degradedList = await channel.request({
    id: 'list-tools-with-broken-server',
    method: 'list_tools',
  });
  assert.equal(degradedList.ok, true, degradedList.error?.message);
  assert.ok(
    degradedList.result.tools.some((tool: { name: string }) => tool.name === 'dwb_broker_status'),
  );
  const degradedStatus = await channel.request({
    id: 'list-broken-server-status',
    method: 'external_mcp_manage',
    params: { action: 'list' },
  });
  assert.ok(
    degradedStatus.result.status.find((status: { id: string }) => status.id === 'broken')?.error,
  );
});
