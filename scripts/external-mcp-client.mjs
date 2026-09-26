import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { ExternalMcpStore } from '../dist/external-mcp-store.js';
import { ExternalMcpInstaller } from '../dist/external-mcp-installer.js';
import { brokerEndpoint } from '../dist/broker-protocol.js';

const action = process.argv[2] ?? '';
const store = new ExternalMcpStore();
const installer = new ExternalMcpInstaller();
const offlineCodes = new Set(['ENOENT', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE']);

async function readInput() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('MCP management request is too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('MCP management input must be an object');
  return value;
}

function requestBroker(params) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(brokerEndpoint());
    const id = randomUUID();
    let buffer = '';
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      const error = new Error('Timed out connecting to DWB broker');
      error.code = 'ETIMEDOUT';
      finish(error);
    }, 4_000);
    socket.setEncoding('utf8');
    socket.once('connect', () =>
      socket.write(JSON.stringify({ id, method: 'external_mcp_manage', params }) + '\n'),
    );
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 2 * 1024 * 1024) return finish(new Error('Broker response is too large'));
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        const reply = JSON.parse(buffer.slice(0, newline));
        if (reply.id !== id) throw new Error('Unexpected broker response ID');
        if (!reply.ok) {
          const error = new Error(reply.error?.message ?? 'Broker MCP management request failed');
          error.code = 'BROKER_REQUEST_FAILED';
          finish(error);
        } else finish(null, reply.result);
      } catch (error) {
        finish(error);
      }
    });
    socket.once('error', (error) => finish(error));
  });
}

async function offlineResult(request) {
  if (request.action === 'list')
    return { servers: await store.load(), status: [], brokerRunning: false };
  if (request.action === 'save') {
    await store.save(request.servers);
    return { servers: await store.load(), status: [], brokerRunning: false };
  }
  if (request.action === 'remove') {
    if (typeof request.id !== 'string') throw new Error('MCP server ID is required');
    const servers = await store.load();
    const removed = servers.find((server) => server.id === request.id);
    if (!removed) throw new Error(`Unknown MCP server: ${request.id}`);
    const next = servers.filter((server) => server.id !== request.id);
    await store.save(next);
    try {
      await installer.removeInstallation(removed);
    } catch (error) {
      await store.save(servers).catch(() => {});
      throw error;
    }
    return { servers: await store.load(), status: [], brokerRunning: false };
  }
  throw new Error('Action must be list, save, or remove');
}

try {
  if (!['catalog', 'install', 'install-github', 'list', 'save', 'remove'].includes(action))
    throw new Error('Action must be catalog, install, install-github, list, save, or remove');
  if (action === 'catalog') {
    process.stdout.write(
      JSON.stringify({ catalog: installer.listCatalog(), status: [], brokerRunning: false }),
    );
    process.exitCode = 0;
  } else if (action === 'install') {
    const input = await readInput();
    if (typeof input.catalogId !== 'string')
      throw new Error('Choose an MCP catalog package to install');
    const existing = await store.load();
    if (existing.some((server) => server.id === input.catalogId))
      throw new Error(`MCP server ID already exists: ${input.catalogId}`);
    const installed = await installer.install(input.catalogId, {
      ...(typeof input.allowedDirectory === 'string'
        ? { allowedDirectory: input.allowedDirectory }
        : {}),
    });
    try {
      try {
        const result = await requestBroker({ action: 'save', servers: [...existing, installed] });
        process.stdout.write(JSON.stringify({ ...result, brokerRunning: true }));
      } catch (error) {
        if (!offlineCodes.has(error?.code)) throw error;
        await store.save([...existing, installed]);
        process.stdout.write(
          JSON.stringify({ servers: await store.load(), status: [], brokerRunning: false }),
        );
      }
    } catch (error) {
      await installer.removeInstallation(installed).catch(() => {});
      throw error;
    }
  } else if (action === 'install-github') {
    const input = await readInput();
    if (typeof input.repositoryUrl !== 'string')
      throw new Error('Paste a GitHub repository URL first.');
    const existing = await store.load();
    const repositoryId = installer.getGitHubRepositoryId(input.repositoryUrl);
    if (existing.some((server) => server.id === repositoryId))
      throw new Error('This GitHub MCP repository is already registered.');
    const installed = await installer.installGitHubRepository(input.repositoryUrl);
    try {
      try {
        const result = await requestBroker({ action: 'save', servers: [...existing, installed] });
        process.stdout.write(JSON.stringify({ ...result, brokerRunning: true, installedId: installed.id }));
      } catch (error) {
        if (!offlineCodes.has(error?.code)) throw error;
        await store.save([...existing, installed]);
        process.stdout.write(
          JSON.stringify({
            servers: await store.load(),
            status: [],
            brokerRunning: false,
            installedId: installed.id,
          }),
        );
      }
    } catch (error) {
      await installer.removeInstallation(installed).catch(() => {});
      throw error;
    }
  } else {
    const input = await readInput();
    const request = { ...input, action };
    try {
      const result = await requestBroker(request);
      process.stdout.write(JSON.stringify({ ...result, brokerRunning: true }));
    } catch (error) {
      const code = error?.code;
      if (!offlineCodes.has(code)) throw error;
      process.stdout.write(JSON.stringify(await offlineResult(request)));
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
