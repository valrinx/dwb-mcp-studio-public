export type ExternalMcpCatalogEntry = {
  id: string;
  name: string;
  description: string;
  packageName: string;
  version: string;
  entryPoint: string;
  allowedDirectoryArg: boolean;
  permissionSummary: string;
  official: boolean;
  sourceUrl: string;
};

/** Curated packages are deliberately pinned; installs never resolve a floating tag. */
export const externalMcpCatalog: readonly ExternalMcpCatalogEntry[] = [
  {
    id: 'everything',
    name: 'Everything',
    description:
      'Official reference server for testing tools, resources, prompts, and notifications.',
    packageName: '@modelcontextprotocol/server-everything',
    version: '2026.8.31',
    entryPoint: 'dist/index.js',
    allowedDirectoryArg: false,
    permissionSummary:
      'Reference/test server that exposes demonstration MCP capabilities; do not enable it for untrusted workspaces.',
    official: true,
    sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everything',
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Browse and edit files within a directory you explicitly select.',
    packageName: '@modelcontextprotocol/server-filesystem',
    version: '2026.8.31',
    entryPoint: 'dist/index.js',
    allowedDirectoryArg: true,
    permissionSummary:
      'Can read, write, create, move, and delete files under the selected directory. Runs with this Windows account’s permissions.',
    official: true,
    sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Official knowledge-graph memory server for persistent context across sessions.',
    packageName: '@modelcontextprotocol/server-memory',
    version: '2026.8.31',
    entryPoint: 'dist/index.js',
    allowedDirectoryArg: false,
    permissionSummary:
      'Stores MCP memory data in the managed installation directory and exposes it to connected agents.',
    official: true,
    sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Official structured-thinking server for reflective step-by-step problem solving.',
    packageName: '@modelcontextprotocol/server-sequential-thinking',
    version: '2026.8.31',
    entryPoint: 'dist/index.js',
    allowedDirectoryArg: false,
    permissionSummary:
      'Provides a reasoning workflow tool; it does not read or write files by itself.',
    official: true,
    sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
];
