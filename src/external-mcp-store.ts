import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { dataDir } from './paths.js';
import {
  normalizeExternalMcpDefinitions,
  type ExternalMcpDefinition,
} from './external-mcp-manager.js';

type PersistedDefinition = Omit<ExternalMcpDefinition, 'env'> & { envProtected: string };
type PersistedFile = { version: 1; servers: PersistedDefinition[] };

const dpapiScript = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Security',
  '$inputText = [Console]::In.ReadToEnd()',
  '$bytes = [Convert]::FromBase64String($inputText)',
  "if ($env:DWB_DPAPI_ACTION -eq 'protect') {",
  '  $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  "} elseif ($env:DWB_DPAPI_ACTION -eq 'unprotect') {",
  '  $protected = [Convert]::FromBase64String([Text.Encoding]::UTF8.GetString($bytes))',
  '  $result = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  "} else { throw 'Invalid DPAPI operation' }",
  '[Console]::Out.Write([Convert]::ToBase64String($result))',
].join('\n');

function protectWithDpapi(action: 'protect' | 'unprotect', input: string): string {
  if (process.platform !== 'win32')
    throw new Error('MCP environment secrets require Windows DPAPI');
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-NoLogo',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      dpapiScript,
    ],
    {
      input: Buffer.from(input, 'utf8').toString('base64'),
      encoding: 'utf8',
      env: { ...process.env, DWB_DPAPI_ACTION: action },
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    const diagnostic = result.error?.message ?? result.stderr.trim().replace(/\s+/g, ' ');
    throw new Error(
      `Windows DPAPI ${action} failed${diagnostic ? `: ${diagnostic.slice(0, 900)}` : ''}`,
    );
  }
  try {
    const bytes = Buffer.from(result.stdout.trim(), 'base64');
    return action === 'protect' ? bytes.toString('base64') : bytes.toString('utf8');
  } catch {
    throw new Error(`Windows DPAPI ${action} returned invalid data`);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('MCP server config file must contain an object');
  return value as Record<string, unknown>;
}

/** Stores MCP server definitions in user data and encrypts every env map with CurrentUser DPAPI. */
export class ExternalMcpStore {
  readonly path: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(path = resolve(dataDir(), 'mcp-servers.json')) {
    this.path = resolve(path);
  }

  async load(): Promise<ExternalMcpDefinition[]> {
    let serialized: string;
    try {
      serialized = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = record(JSON.parse(serialized));
    } catch (error) {
      throw new Error(
        `Cannot read MCP server config: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (parsed.version !== 1 || !Array.isArray(parsed.servers))
      throw new Error('Unsupported MCP server config version');
    const definitions = parsed.servers.map((raw) => {
      const entry = record(raw);
      if (typeof entry.envProtected !== 'string')
        throw new Error('MCP server config is missing encrypted environment data');
      const envText = protectWithDpapi('unprotect', entry.envProtected);
      let env: unknown;
      try {
        env = JSON.parse(envText);
      } catch {
        throw new Error('MCP server config contains invalid encrypted environment data');
      }
      const { envProtected: _envProtected, ...definition } = entry;
      return { ...definition, env };
    });
    return normalizeExternalMcpDefinitions(definitions);
  }

  async save(definitions: ExternalMcpDefinition[]): Promise<void> {
    const normalized = normalizeExternalMcpDefinitions(definitions);
    const operation = this.writeChain.then(() => this.write(normalized));
    this.writeChain = operation.catch(() => {});
    await operation;
  }

  private async write(definitions: ExternalMcpDefinition[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const servers: PersistedDefinition[] = definitions.map(({ env, ...definition }) => ({
      ...definition,
      envProtected: protectWithDpapi('protect', JSON.stringify(env)),
    }));
    const contents: PersistedFile = { version: 1, servers };
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(contents, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporary, this.path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }
}
