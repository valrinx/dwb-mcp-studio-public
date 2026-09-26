import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { externalMcpCatalog, type ExternalMcpCatalogEntry } from './external-mcp-catalog.js';
import type { ExternalMcpDefinition } from './external-mcp-manager.js';
import { dataDir } from './paths.js';

type InstallOptions = { allowedDirectory?: string };
type InstallerOptions = {
  rootDir?: string;
  catalog?: readonly ExternalMcpCatalogEntry[];
  installPackage?: (stageDirectory: string, packageName: string, version: string) => Promise<void>;
};

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function npmCliPath(): string {
  const candidates = [
    process.env.npm_execpath,
    resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('npm CLI was not found next to Node.js');
  return found;
}

async function npmInstall(stage: string, packageName: string, version: string): Promise<void> {
  const result = spawnSync(
    process.execPath,
    [
      npmCliPath(),
      'install',
      '--prefix',
      stage,
      '--no-save',
      '--ignore-scripts',
      '--package-lock=false',
      '--no-audit',
      '--no-fund',
      `${packageName}@${version}`,
    ],
    {
      cwd: stage,
      env: { ...process.env },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 300_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      `Pinned npm install failed${result.status === null ? '' : ` (exit ${result.status})`}`,
    );
}

async function packageMetadata(packageRoot: string): Promise<{ name: string; version: string }> {
  const value = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
  if (!value || typeof value.name !== 'string' || typeof value.version !== 'string')
    throw new Error('Installed package manifest is invalid');
  return { name: value.name, version: value.version };
}

export class ExternalMcpInstaller {
  private readonly rootDir: string;
  private readonly catalog: readonly ExternalMcpCatalogEntry[];
  private readonly installPackage: InstallerOptions['installPackage'];

  constructor(options: InstallerOptions = {}) {
    this.rootDir = resolve(options.rootDir ?? dataDir());
    this.catalog = options.catalog ?? externalMcpCatalog;
    this.installPackage = options.installPackage ?? npmInstall;
    const ids = new Set<string>();
    for (const entry of this.catalog) {
      if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(entry.id) || ids.has(entry.id))
        throw new Error(`Invalid or duplicate catalog ID: ${entry.id}`);
      ids.add(entry.id);
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(entry.version))
        throw new Error(`Catalog package ${entry.id} must use an exact version`);
      if (isAbsolute(entry.entryPoint) || entry.entryPoint.split(/[\\/]/).includes('..'))
        throw new Error(`Catalog package ${entry.id} has an invalid entry point`);
    }
  }

  listCatalog(): ExternalMcpCatalogEntry[] {
    return this.catalog.map((entry) => ({ ...entry }));
  }

  async install(catalogId: string, options: InstallOptions = {}): Promise<ExternalMcpDefinition> {
    const entry = this.catalog.find((candidate) => candidate.id === catalogId);
    if (!entry) throw new Error(`Unknown MCP catalog entry: ${catalogId}`);
    let allowedDirectory: string | undefined;
    if (entry.allowedDirectoryArg) {
      if (!options.allowedDirectory || !isAbsolute(options.allowedDirectory))
        throw new Error(`Choose an absolute allowed directory for ${entry.name}`);
      allowedDirectory = resolve(options.allowedDirectory);
      const details = await stat(allowedDirectory).catch(() => null);
      if (!details?.isDirectory())
        throw new Error('The allowed path must be an existing directory');
    }

    const installRoot = resolve(this.rootDir, 'mcp-servers', 'installations', entry.id);
    const target = resolve(installRoot, entry.version);
    if (!isWithin(installRoot, target))
      throw new Error('Catalog installation path escaped its owner directory');
    const packageRoot = resolve(target, 'node_modules', ...entry.packageName.split('/'));
    const entryPoint = resolve(packageRoot, entry.entryPoint);
    if (!isWithin(packageRoot, entryPoint))
      throw new Error('Catalog entry point escaped its package');

    if (existsSync(target)) {
      await this.verifyPackage(packageRoot, entry, entryPoint);
      return this.definition(entry, target, entryPoint, allowedDirectory);
    }

    await mkdir(installRoot, { recursive: true });
    const stage = resolve(installRoot, `.${entry.version}.${randomUUID()}.staging`);
    if (!isWithin(installRoot, stage))
      throw new Error('Catalog staging path escaped its owner directory');
    await mkdir(stage, { recursive: true });
    try {
      await this.installPackage!(stage, entry.packageName, entry.version);
      await this.verifyPackage(
        resolve(stage, 'node_modules', ...entry.packageName.split('/')),
        entry,
        resolve(stage, 'node_modules', ...entry.packageName.split('/'), entry.entryPoint),
      );
      await rename(stage, target);
      return this.definition(entry, target, entryPoint, allowedDirectory);
    } catch (error) {
      await rm(stage, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async removeInstallation(definition: ExternalMcpDefinition): Promise<void> {
    if (definition.source !== 'catalog') return;
    const entry = this.catalog.find((candidate) => candidate.id === definition.catalogId);
    if (
      !entry ||
      entry.packageName !== definition.packageName ||
      entry.version !== definition.packageVersion
    )
      throw new Error('Refusing to remove an installation not owned by the current catalog');
    const expected = resolve(this.rootDir, 'mcp-servers', 'installations', entry.id, entry.version);
    if (resolve(definition.installDirectory ?? '').toLowerCase() !== expected.toLowerCase())
      throw new Error('Refusing to remove a path outside the catalog installation directory');
    const packageRoot = resolve(expected, 'node_modules', ...entry.packageName.split('/'));
    await this.verifyPackage(packageRoot, entry, resolve(packageRoot, entry.entryPoint));
    await rm(expected, { recursive: true, force: true });
  }

  private async verifyPackage(
    packageRoot: string,
    entry: ExternalMcpCatalogEntry,
    entryPoint: string,
  ): Promise<void> {
    const metadata = await packageMetadata(packageRoot);
    if (metadata.name !== entry.packageName || metadata.version !== entry.version)
      throw new Error(`Installed package identity mismatch for ${entry.id}`);
    if (!isWithin(packageRoot, entryPoint))
      throw new Error(`Installed entry point escaped ${entry.id}`);
    const details = await stat(entryPoint).catch(() => null);
    if (!details?.isFile()) throw new Error(`Installed entry point is missing for ${entry.id}`);
  }

  private definition(
    entry: ExternalMcpCatalogEntry,
    installDirectory: string,
    entryPoint: string,
    allowedDirectory?: string,
  ): ExternalMcpDefinition {
    return {
      id: entry.id,
      name: entry.name,
      command: process.execPath,
      args: [entryPoint, ...(allowedDirectory ? [allowedDirectory] : [])],
      ...(allowedDirectory ? { cwd: allowedDirectory } : {}),
      env: {},
      enabled: false,
      source: 'catalog',
      catalogId: entry.id,
      packageName: entry.packageName,
      packageVersion: entry.version,
      installDirectory,
    };
  }
}
