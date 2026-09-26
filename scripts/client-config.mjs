import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_NAME = 'dwb-core';

function defaultRoots() {
  const homeDir = homedir();
  const appDataDir = process.env.APPDATA || join(homeDir, '.config');
  const dataDir = process.env.DWB_DATA_DIR || join(appDataDir, 'DWB-MCP-Studio');
  return { homeDir, appDataDir, dataDir, workspace: process.env.DWB_WORKSPACE };
}

function rootsWithDefaults(roots = {}) {
  const defaults = defaultRoots();
  return {
    homeDir: roots.homeDir || defaults.homeDir,
    appDataDir: roots.appDataDir || defaults.appDataDir,
    dataDir: roots.dataDir || defaults.dataDir,
    workspace: roots.workspace || defaults.workspace,
  };
}

const CLIENTS = [
  {
    id: 'generic',
    name: 'Generic MCP (generated file)',
    format: 'mcpServers',
    description: 'Portable mcpServers JSON for clients that let you choose a config file.',
  },
  {
    id: 'claude',
    name: 'Claude Desktop',
    format: 'mcpServers',
    description: 'Claude Desktop user configuration.',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    format: 'mcpServers',
    description: 'Cursor global MCP configuration.',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    format: 'mcpServers',
    description: 'Windsurf user MCP configuration.',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    format: 'mcpServers',
    description: 'GitHub Copilot CLI user MCP configuration.',
  },
  {
    id: 'vscode-workspace',
    name: 'VS Code workspace',
    format: 'servers',
    description: 'VS Code .vscode/mcp.json for one workspace.',
  },
  {
    id: 'portable',
    name: 'Portable MCP (.mcp.json)',
    format: 'mcpServers',
    description: 'Workspace-root portable MCP configuration.',
  },
  {
    id: 'vscode',
    name: 'VS Code custom config',
    format: 'servers',
    description: 'VS Code servers schema at a path you explicitly provide.',
  },
];

function clientDefinition(clientId) {
  const client = CLIENTS.find((candidate) => candidate.id === clientId);
  if (!client) throw new Error(`Unknown MCP client: ${clientId}`);
  return client;
}

export function getClientCatalog(roots = {}) {
  const resolved = rootsWithDefaults(roots);
  return CLIENTS.map((client) => ({
    ...client,
    configFile: (() => {
      try {
        return resolveClientConfigPath(client.id, resolved);
      } catch (error) {
        if (client.id === 'vscode-workspace' || client.id === 'portable') return null;
        throw error;
      }
    })(),
    requiresExplicitConfig: client.id === 'vscode',
  }));
}

export function resolveClientConfigPath(clientId, roots = {}) {
  const resolved = rootsWithDefaults(roots);
  switch (clientId) {
    case 'generic':
      return join(resolved.dataDir, 'mcp-client.json');
    case 'claude':
      return join(resolved.appDataDir, 'Claude', 'claude_desktop_config.json');
    case 'cursor':
      return join(resolved.homeDir, '.cursor', 'mcp.json');
    case 'windsurf':
      return join(resolved.homeDir, '.codeium', 'windsurf', 'mcp_config.json');
    case 'copilot':
      return join(resolved.homeDir, '.copilot', 'mcp-config.json');
    case 'vscode-workspace':
      if (!resolved.workspace)
        throw new Error('Provide --workspace for VS Code workspace installation.');
      return join(resolved.workspace, '.vscode', 'mcp.json');
    case 'portable':
      if (!resolved.workspace)
        throw new Error('Provide --workspace for portable workspace installation.');
      return join(resolved.workspace, '.mcp.json');
    case 'vscode':
      return null;
    default:
      throw new Error(`Unknown MCP client: ${clientId}`);
  }
}

export function buildServerEntry({ clientId, nodePath, startScript, configFile, dataDir }) {
  if (!nodePath || !startScript || !configFile) {
    throw new Error('nodePath, startScript, and configFile are required to build an MCP entry.');
  }
  const entry = {
    command: nodePath,
    args: [startScript],
    env: {
      DWB_CONFIG_FILE: configFile,
      ...(dataDir ? { DWB_DATA_DIR: dataDir } : {}),
    },
  };
  if (clientId === 'copilot') return { type: 'local', ...entry, tools: ['*'] };
  if (['cursor', 'windsurf', 'vscode', 'vscode-workspace'].includes(clientId)) {
    return { type: 'stdio', ...entry };
  }
  return entry;
}

function stripJsonCommentsAndTrailingCommas(source) {
  let output = '';
  let quote = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n' || char === '\r') {
        lineComment = false;
        output += char;
      }
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      } else if (char === '\n' || char === '\r') {
        output += char;
      }
      continue;
    }
    if (!quote && char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (!quote && char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    output += char;
    if (char === '"' && !escaped) quote = !quote;
    escaped = char === '\\' && !escaped;
    if (char !== '\\') escaped = false;
  }

  let cleaned = '';
  quote = false;
  escaped = false;
  for (let index = 0; index < output.length; index += 1) {
    const char = output[index];
    if (char === '"' && !escaped) quote = !quote;
    if (!quote && char === ',') {
      let next = index + 1;
      while (/\s/.test(output[next] || '')) next += 1;
      if (output[next] === '}' || output[next] === ']') continue;
    }
    cleaned += char;
    escaped = char === '\\' && !escaped;
    if (char !== '\\') escaped = false;
  }
  return cleaned;
}

function parseConfig(source) {
  const text = source.trim();
  if (!text) return {};
  let value;
  try {
    value = JSON.parse(stripJsonCommentsAndTrailingCommas(text));
  } catch (error) {
    throw new Error(`Cannot parse MCP client config: ${error.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MCP client config must contain a JSON object at the root.');
  }
  return value;
}

export function mergeClientConfig(source, { clientId, entry, serverName = SERVER_NAME }) {
  const client = clientDefinition(clientId);
  const config = parseConfig(source);
  const key = client.format;
  if (config[key] === undefined) config[key] = {};
  if (!config[key] || typeof config[key] !== 'object' || Array.isArray(config[key])) {
    throw new Error(`MCP client config must contain an object at top-level ${key}.`);
  }
  config[key][serverName] = entry;
  return config;
}

async function readExistingConfig(configFile) {
  try {
    return await readFile(configFile, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw new Error(`Cannot read MCP client config ${configFile}: ${error.message}`);
  }
}

async function backupExistingConfig(configFile) {
  try {
    await access(configFile);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const backupFile = `${configFile}.bak-${stamp}-${process.pid}`;
  await writeFile(backupFile, await readFile(configFile));
  return backupFile;
}

export async function installClientConfig({
  clientId,
  configFile,
  workspace,
  homeDir,
  appDataDir,
  dataDir,
  nodePath = process.execPath,
  startScript,
  dwbConfigFile,
  serverName = SERVER_NAME,
}) {
  const roots = rootsWithDefaults({ workspace, homeDir, appDataDir, dataDir });
  const client = clientDefinition(clientId);
  const target = configFile || resolveClientConfigPath(clientId, roots);
  if (!target) throw new Error(`Provide --config for ${client.name}.`);
  const runtimeConfig = dwbConfigFile || join(roots.dataDir, 'config.json');
  const launcher = startScript || fileURLToPath(new URL('./start.mjs', import.meta.url));
  const resolvedStartScript = launcher;
  const entry = buildServerEntry({
    clientId,
    nodePath,
    startScript: resolvedStartScript,
    configFile: runtimeConfig,
    dataDir: roots.dataDir,
  });
  const merged = mergeClientConfig(await readExistingConfig(target), {
    clientId,
    entry,
    serverName,
  });
  await mkdir(dirname(target), { recursive: true });
  const backupFile = await backupExistingConfig(target);
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
  } catch (error) {
    try {
      await rm(temporary, { force: true });
    } catch {
      // Preserve the original error; the backup remains available if a write failed.
    }
    throw new Error(`Cannot write MCP client config ${target}: ${error.message}`);
  }
  return { clientId, client: client.name, configFile: target, backupFile, entry };
}

export { SERVER_NAME };
