import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';
import { runtimeIdentity } from './runtime-identity.js';

test('broker client reconnects in the background and resumes its session', async () => {
  const endpoint =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\dwb-broker-client-test-${process.pid}-${randomUUID()}`
      : `/tmp/dwb-broker-client-test-${process.pid}-${randomUUID()}`;
  process.env.DWB_BROKER_PIPE = endpoint;
  process.env.DWB_BROKER_AUTOSTART = 'false';
  const { BrokerClient } = await import(`./broker-client.js?test=${randomUUID()}`);
  const sessions: Array<string | null> = [];
  let connections = 0;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      while (true) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const request = JSON.parse(line) as { id: string; method: string; params?: any };
        if (request.method !== 'hello') continue;
        connections += 1;
        sessions.push(typeof request.params?.sessionId === 'string' ? request.params.sessionId : null);
        socket.write(
          JSON.stringify({
            id: request.id,
            ok: true,
            result: {
              protocolVersion: 1,
              sessionId: 'session-reconnected',
              broker: { runtime: runtimeIdentity },
            },
          }) + '\n',
        );
        if (connections === 1) setTimeout(() => socket.destroy(), 25).unref();
      }
    });
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(endpoint, resolveListen);
  });

  let client: InstanceType<typeof BrokerClient> | null = null;
  try {
    client = await BrokerClient.connect(process.cwd());
    assert.equal(connections, 1);
    const deadline = Date.now() + 4_000;
    while (connections < 2 && Date.now() < deadline)
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    assert.equal(connections, 2, 'client should reconnect without another request');
    assert.deepEqual(sessions, [null, 'session-reconnected']);
  } finally {
    await client?.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    if (process.platform !== 'win32') await rm(endpoint, { force: true });
    delete process.env.DWB_BROKER_PIPE;
    delete process.env.DWB_BROKER_AUTOSTART;
  }
});
