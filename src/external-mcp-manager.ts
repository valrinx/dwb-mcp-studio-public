import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type ExternalMcpDefinition = {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  enabled: boolean;
  source?: 'custom' | 'catalog';
  catalogId?: string;
  packageName?: string;
  packageVersion?: string;
  installDirectory?: string;
};

type ConnectedServer = {
  client: Client;
  transport: StdioClientTransport;
};

type ToolRoute = {
  serverId: string;
  upstreamName: string;
};

type SessionRuntime = {
  closed: boolean;
  servers: Map<string, ConnectedServer>;
  starting: Map<string, Promise<ConnectedServer>>;
  routes: Map<string, ToolRoute>;
  failures: Map<string, string>;
};

const SERVER_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const MAX_TOOL_LIST_MS = 10_000;

function copiedDefinition(value: ExternalMcpDefinition): ExternalMcpDefinition {
  if (!value || typeof value !== 'object')
    throw new Error('MCP server definition must be an object');
  if (typeof value.id !== 'string' || !SERVER_ID.test(value.id))
    throw new Error(
      'MCP server ID must be 1–40 lowercase letters, digits, underscores, or hyphens',
    );
  if (typeof value.name !== 'string' || !value.name.trim())
    throw new Error(`MCP server ${value.id} requires a name`);
  if (typeof value.command !== 'string' || !value.command.trim())
    throw new Error(`MCP server ${value.id} requires an executable command`);
  if (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== 'string'))
    throw new Error(`MCP server ${value.id} args must be an array of strings`);
  if (value.cwd !== undefined && typeof value.cwd !== 'string')
    throw new Error(`MCP server ${value.id} working directory must be a string`);
  if (!value.env || typeof value.env !== 'object' || Array.isArray(value.env))
    throw new Error(`MCP server ${value.id} environment must be an object`);
  for (const [key, entry] of Object.entries(value.env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof entry !== 'string')
      throw new Error(`MCP server ${value.id} has an invalid environment entry`);
  }
  if (typeof value.enabled !== 'boolean')
    throw new Error(`MCP server ${value.id} enabled must be a boolean`);
  if (value.source !== undefined && value.source !== 'custom' && value.source !== 'catalog')
    throw new Error(`MCP server ${value.id} has an invalid source`);
  if (value.source === 'catalog') {
    if (
      typeof value.catalogId !== 'string' ||
      typeof value.packageName !== 'string' ||
      typeof value.packageVersion !== 'string' ||
      typeof value.installDirectory !== 'string' ||
      !value.installDirectory.trim()
    )
      throw new Error(`Catalog MCP server ${value.id} is missing installation metadata`);
  }
  return {
    id: value.id,
    name: value.name.trim(),
    command: value.command.trim(),
    args: [...value.args],
    ...(value.cwd?.trim() ? { cwd: value.cwd.trim() } : {}),
    env: { ...value.env },
    enabled: value.enabled,
    ...(value.source ? { source: value.source } : {}),
    ...(value.catalogId ? { catalogId: value.catalogId } : {}),
    ...(value.packageName ? { packageName: value.packageName } : {}),
    ...(value.packageVersion ? { packageVersion: value.packageVersion } : {}),
    ...(value.installDirectory ? { installDirectory: value.installDirectory } : {}),
  };
}

export function normalizeExternalMcpDefinitions(value: unknown): ExternalMcpDefinition[] {
  if (!Array.isArray(value)) throw new Error('MCP server definitions must be an array');
  const normalized: ExternalMcpDefinition[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    const definition = copiedDefinition(entry as ExternalMcpDefinition);
    if (ids.has(definition.id)) throw new Error(`Duplicate MCP server ID: ${definition.id}`);
    ids.add(definition.id);
    normalized.push(definition);
  }
  return normalized;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function closeConnection(connection: ConnectedServer): Promise<void> {
  try {
    await connection.client.close();
  } catch {}
  try {
    await connection.transport.close();
  } catch {}
}

/** Manages isolated stdio MCP child processes for each DWB session. */
export class ExternalMcpManager {
  private definitions = new Map<string, ExternalMcpDefinition>();
  private sessions = new Map<string, SessionRuntime>();
  private stopped = false;
  private readonly maxServersPerSession: number;

  constructor(
    definitions: ExternalMcpDefinition[] = [],
    options: { maxServersPerSession?: number } = {},
  ) {
    const cap = options.maxServersPerSession ?? Number(process.env.DWB_EXTERNAL_MCP_CAP ?? 12);
    this.maxServersPerSession = Number.isFinite(cap) ? Math.max(1, Math.floor(cap)) : 12;
    this.definitions = this.indexDefinitions(definitions);
  }

  private indexDefinitions(
    definitions: ExternalMcpDefinition[],
  ): Map<string, ExternalMcpDefinition> {
    return new Map(
      normalizeExternalMcpDefinitions(definitions).map((definition) => [definition.id, definition]),
    );
  }

  getDefinitions(): ExternalMcpDefinition[] {
    return [...this.definitions.values()].map(copiedDefinition);
  }

  getStatus() {
    return this.getDefinitions().map((definition) => {
      const failures = [...this.sessions.values()]
        .map((runtime) => runtime.failures.get(definition.id))
        .filter((failure): failure is string => Boolean(failure));
      return {
        id: definition.id,
        name: definition.name,
        enabled: definition.enabled,
        runningSessions: [...this.sessions.values()].filter((runtime) =>
          runtime.servers.has(definition.id),
        ).length,
        error: failures[0] ?? null,
      };
    });
  }

  async updateDefinitions(definitions: ExternalMcpDefinition[]): Promise<void> {
    this.assertRunning();
    const next = this.indexDefinitions(definitions);
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.closeSession(sessionId)));
    this.definitions = next;
  }

  async listTools(sessionId: string, reservedNames: Iterable<string> = []): Promise<Tool[]> {
    this.assertSession(sessionId);
    const runtime = this.runtime(sessionId);
    const usedNames = new Set(reservedNames);
    const tools: Tool[] = [];
    const routes = new Map<string, ToolRoute>();
    const definitions = [...this.definitions.values()].filter((definition) => definition.enabled);

    await Promise.all(
      definitions.map(async (definition) => {
        try {
          const connection = await this.ensureServer(runtime, definition);
          const result = await connection.client.listTools(undefined, {
            timeout: MAX_TOOL_LIST_MS,
          });
          runtime.failures.delete(definition.id);
          for (const tool of result.tools) {
            const baseName = `${definition.id}__${tool.name}`;
            let publicName = baseName;
            if (usedNames.has(publicName)) publicName = `mcp__${baseName}`;
            let suffix = 2;
            while (usedNames.has(publicName)) publicName = `mcp__${baseName}__${suffix++}`;
            usedNames.add(publicName);
            routes.set(publicName, { serverId: definition.id, upstreamName: tool.name });
            tools.push({ ...tool, name: publicName });
          }
        } catch (error) {
          runtime.failures.set(definition.id, errorText(error));
        }
      }),
    );

    runtime.routes = routes;
    return tools;
  }

  async callTool(
    sessionId: string,
    publicName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    this.assertSession(sessionId);
    const runtime = this.runtime(sessionId);
    let route = runtime.routes.get(publicName);
    if (!route) {
      await this.listTools(sessionId);
      route = runtime.routes.get(publicName);
    }
    if (!route) throw new Error(`Unknown external MCP tool: ${publicName}`);
    const connection = runtime.servers.get(route.serverId);
    if (!connection) throw new Error(`MCP server ${route.serverId} is not running`);
    return connection.client.callTool({ name: route.upstreamName, arguments: args }, undefined, {
      timeout: 120_000,
    });
  }

  isManagedTool(sessionId: string, publicName: string): boolean {
    if (this.sessions.get(sessionId)?.routes.has(publicName)) return true;
    return [...this.definitions.values()].some(
      (definition) =>
        definition.enabled &&
        (publicName.startsWith(`${definition.id}__`) ||
          publicName.startsWith(`mcp__${definition.id}__`)),
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) return;
    runtime.closed = true;
    this.sessions.delete(sessionId);
    await Promise.allSettled([...runtime.starting.values()]);
    await Promise.all([...runtime.servers.values()].map(closeConnection));
    runtime.servers.clear();
    runtime.routes.clear();
  }

  async shutdown(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.closeSession(sessionId)));
  }

  private runtime(sessionId: string): SessionRuntime {
    let runtime = this.sessions.get(sessionId);
    if (!runtime) {
      runtime = {
        closed: false,
        servers: new Map(),
        starting: new Map(),
        routes: new Map(),
        failures: new Map(),
      };
      this.sessions.set(sessionId, runtime);
    }
    return runtime;
  }

  private async ensureServer(
    runtime: SessionRuntime,
    definition: ExternalMcpDefinition,
  ): Promise<ConnectedServer> {
    if (runtime.closed) throw new Error('MCP session is closing');
    const connected = runtime.servers.get(definition.id);
    if (connected) return connected;
    const pending = runtime.starting.get(definition.id);
    if (pending) return pending;
    if (runtime.servers.size + runtime.starting.size >= this.maxServersPerSession)
      throw new Error(`External MCP server limit reached (${this.maxServersPerSession})`);

    const starting = this.startServer(runtime, definition);
    runtime.starting.set(definition.id, starting);
    try {
      return await starting;
    } finally {
      if (runtime.starting.get(definition.id) === starting) runtime.starting.delete(definition.id);
    }
  }

  private async startServer(
    runtime: SessionRuntime,
    definition: ExternalMcpDefinition,
  ): Promise<ConnectedServer> {
    const transport = new StdioClientTransport({
      command: definition.command,
      args: [...definition.args],
      ...(definition.cwd ? { cwd: definition.cwd } : {}),
      env: { ...definition.env },
      stderr: 'ignore',
      maxBufferSize: 10 * 1024 * 1024,
    });
    const client = new Client({ name: 'dwb-external-mcp', version: '0.1.0' });
    try {
      await client.connect(transport, { timeout: 8_000 });
      await client.listTools(undefined, { timeout: MAX_TOOL_LIST_MS });
      if (runtime.closed) throw new Error('MCP session is closing');
      const connection = { client, transport };
      runtime.servers.set(definition.id, connection);
      runtime.failures.delete(definition.id);
      return connection;
    } catch (error) {
      runtime.failures.set(definition.id, errorText(error));
      await closeConnection({ client, transport });
      throw error;
    }
  }

  private assertRunning(): void {
    if (this.stopped) throw new Error('External MCP manager is stopped');
  }

  private assertSession(sessionId: string): void {
    this.assertRunning();
    if (typeof sessionId !== 'string' || !sessionId.trim())
      throw new Error('MCP session ID is required');
  }
}
