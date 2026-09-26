export type ExternalMcpCatalogEntry = {
  id: string;
  name: string;
  description: string;
  packageName: string;
  version: string;
  entryPoint: string;
  allowedDirectoryArg: boolean;
  permissionSummary: string;
};

/** Curated packages are deliberately pinned; installs never resolve a floating tag. */
export const externalMcpCatalog: readonly ExternalMcpCatalogEntry[] = [
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
  },
];
