import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  buildServerEntry,
  getClientCatalog,
  installClientConfig,
  mergeClientConfig,
} from './client-config.mjs';

function parseCli() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      client: { type: 'string' },
      config: { type: 'string' },
      workspace: { type: 'string' },
      'data-dir': { type: 'string' },
      'home-dir': { type: 'string' },
      'appdata-dir': { type: 'string' },
      node: { type: 'string' },
      start: { type: 'string' },
      'dwb-config': { type: 'string' },
      all: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  return { command: positionals[0] || 'help', values };
}

function rootsFrom(values) {
  return {
    workspace: values.workspace,
    dataDir: values['data-dir'],
    homeDir: values['home-dir'],
    appDataDir: values['appdata-dir'],
  };
}

async function exists(path) {
  if (!path) return false;
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function detected(catalog) {
  const results = [];
  for (const client of catalog) {
    if (client.id === 'generic' || (await isDetected(client))) {
      results.push(client);
    }
  }
  return results;
}

async function isDetected(client) {
  return Boolean(
    client.configFile &&
    ((await exists(client.configFile)) || (await exists(dirname(client.configFile)))),
  );
}

function runtimeValues(values, roots) {
  const dataDir = roots.dataDir || process.env.DWB_DATA_DIR || catalogDataDir();
  return {
    dataDir,
    nodePath: values.node || process.execPath,
    startScript: values.start || fileURLToPath(new URL('./start.mjs', import.meta.url)),
    dwbConfigFile:
      values['dwb-config'] || process.env.DWB_CONFIG_FILE || join(dataDir, 'config.json'),
  };
}

function catalogDataDir() {
  const home = process.env.APPDATA || process.env.HOME || process.env.USERPROFILE || '.';
  return join(home, 'DWB-MCP-Studio');
}

function printHelp() {
  console.log(`DWB MCP Studio AI client connector

Commands:
  node scripts/connect.mjs list
  node scripts/connect.mjs install --client <id> [--config <file>]
  node scripts/connect.mjs install --all
  node scripts/connect.mjs export --client <id> [--config <file>]

Options:
  --workspace <dir>     Workspace for VS Code workspace and portable configs
  --data-dir <dir>      DWB data directory
  --config <file>       Explicit target config path (required for vscode)
  --json                Print machine-readable JSON

The installer merges only the dwb-core entry and creates a timestamped .bak copy before updating an existing file.`);
}

async function main() {
  const { command, values } = parseCli();
  if (values.help || command === 'help') {
    printHelp();
    return;
  }
  const roots = rootsFrom(values);
  const catalog = getClientCatalog(roots);
  if (command === 'list') {
    const entries = await Promise.all(
      catalog.map(async (client) => ({
        ...client,
        detected: client.id === 'generic' || (await isDetected(client)),
      })),
    );
    if (values.json) console.log(JSON.stringify(entries, null, 2));
    else {
      console.log('Supported MCP clients:');
      for (const client of entries) {
        const path = client.configFile || 'provide --config';
        console.log(
          `- ${client.id.padEnd(17)} ${client.name} · ${client.detected ? 'detected' : 'not detected'} · ${path}`,
        );
      }
    }
    return;
  }
  if (!['install', 'export'].includes(command)) throw new Error(`Unknown command: ${command}`);
  if (values.all && command !== 'install') throw new Error('--all is supported only with install.');
  if (values.all && values.client) throw new Error('Use --all or --client, not both.');
  if (!values.all && !values.client) throw new Error('Provide --client <id> or use --all.');
  const runtime = runtimeValues(values, roots);

  if (command === 'export') {
    const clientId = values.client;
    const client = catalog.find((candidate) => candidate.id === clientId);
    if (!client) throw new Error(`Unknown MCP client: ${clientId}`);
    const configFile = values.config || client.configFile;
    if (!configFile) throw new Error(`Provide --config for ${client.name}.`);
    const entry = buildServerEntry({ clientId, ...runtime, configFile: runtime.dwbConfigFile });
    const result = mergeClientConfig('', { clientId, entry });
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else console.log(JSON.stringify(result, null, 2));
    return;
  }

  const selected = values.all
    ? await detected(catalog)
    : [catalog.find((candidate) => candidate.id === values.client)];
  if (selected.some((client) => !client)) throw new Error(`Unknown MCP client: ${values.client}`);
  if (!selected.length)
    throw new Error(
      'No installed MCP client was detected. Use --client <id> to choose one explicitly.',
    );
  const results = [];
  for (const client of selected) {
    results.push(
      await installClientConfig({
        clientId: client.id,
        configFile: values.config && !values.all ? values.config : client.configFile,
        ...roots,
        ...runtime,
      }),
    );
  }
  if (values.json) console.log(JSON.stringify(values.all ? results : results[0], null, 2));
  else {
    for (const result of results) {
      console.log(`Connected ${result.client} → ${result.configFile}`);
      if (result.backupFile) console.log(`Backup: ${result.backupFile}`);
    }
    console.log('Restart or reload the AI client so it starts dwb-core.');
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
