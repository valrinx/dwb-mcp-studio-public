import { externalAppCatalog, type ExternalAppCatalogEntry } from './external-app-catalog.js';
import type { ExternalMcpDefinition } from './external-mcp-manager.js';

function findApp(appId: string): ExternalAppCatalogEntry {
  const entry = externalAppCatalog.find((candidate) => candidate.id === appId);
  if (!entry) throw new Error(`Unknown app integration: ${appId}`);
  return entry;
}

/** Creates a disabled MCP definition without storing OAuth/API secrets. */
export function createExternalAppDefinition(appId: string): ExternalMcpDefinition {
  const entry = findApp(appId);
  if (entry.id === 'capcut' && entry.kind === 'community-local')
    return {
      id: entry.id,
      name: entry.name,
      command: 'uv',
      args: ['run', '--from', `git+${entry.sourceUrl}`, 'python', '-m', 'capcut_mcp.server'],
      env: {},
      enabled: false,
      source: 'app',
      appId: entry.id,
    };
  if (entry.kind !== 'official-remote')
    throw new Error(`${entry.name} is a community local integration and requires local setup.`);
  if (!entry.endpoint)
    throw new Error(`${entry.name} does not expose a fixed endpoint for Quick Install.`);
  return {
    id: entry.id,
    name: entry.name,
    command: '',
    args: [],
    env: {},
    enabled: false,
    transport: 'streamable-http',
    url: entry.endpoint,
    source: 'app',
    appId: entry.id,
  };
}
