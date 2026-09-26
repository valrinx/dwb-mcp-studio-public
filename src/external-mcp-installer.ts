import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { externalMcpCatalog, type ExternalMcpCatalogEntry } from './external-mcp-catalog.js';
import type { ExternalMcpDefinition } from './external-mcp-manager.js';
import { dataDir } from './paths.js';

type InstallOptions = { allowedDirectory?: string };
type GitHubRepository = {
  id: string;
  owner: string;
  repo: string;
  repositoryUrl: string;
  ref: string;
};
type GitHubInstallMarker = {
  version: 1;
  id: string;
  repositoryUrl: string;
  repositoryRef: string;
  packageName: string;
  packageVersion: string;
  entryPoint: string;
};
type InstallerOptions = {
  rootDir?: string;
  catalog?: readonly ExternalMcpCatalogEntry[];
  installPackage?: (stageDirectory: string, packageName: string, version: string) => Promise<void>;
  prepareGitHubRepository?: (
    stageDirectory: string,
    repositoryUrl: string,
    ref: string,
  ) => Promise<void>;
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

async function prepareGitHubRepository(
  stage: string,
  repositoryUrl: string,
  ref: string,
): Promise<void> {
  const cloneArgs = ['clone', '--depth', '1'];
  if (ref !== 'HEAD') cloneArgs.push('--branch', ref);
  cloneArgs.push(`${repositoryUrl}.git`, stage);
  const clone = spawnSync('git', cloneArgs, {
    cwd: dirname(stage),
    env: { ...process.env },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (clone.error || clone.status !== 0)
    throw new Error('Could not download the GitHub repository. Check Git, the URL, and network access.');

  const install = spawnSync(
    process.execPath,
    [npmCliPath(), 'install', '--no-audit', '--no-fund', '--package-lock=false'],
    {
      cwd: stage,
      env: { ...process.env },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 600_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (install.error || install.status !== 0)
    throw new Error('Could not install this repository. Check its npm scripts and dependencies.');
}

function parseGitHubRepository(input: string): GitHubRepository {
  if (typeof input !== 'string' || !input.trim())
    throw new Error('Paste a GitHub repository URL first.');
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Enter a repository URL such as https://github.com/owner/repo.');
  }
  if (
    url.protocol !== 'https:' ||
    !['github.com', 'www.github.com'].includes(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    url.search
  )
    throw new Error('Only public GitHub HTTPS repository URLs are supported.');

  let segments: string[];
  let ref = 'HEAD';
  try {
    segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (url.hash) ref = decodeURIComponent(url.hash.slice(1));
  } catch {
    throw new Error('The GitHub repository URL contains invalid encoding.');
  }
  let owner: string;
  let repo: string;
  if (segments.length === 2) {
    [owner, repo] = segments;
  } else if (segments.length === 4 && segments[2].toLowerCase() === 'tree') {
    [owner, repo] = segments;
    if (url.hash) throw new Error('Specify a branch either in the URL path or after #, not both.');
    ref = segments[3];
  } else {
    throw new Error('Paste the repository page URL, optionally ending in /tree/branch.');
  }
  repo = repo.replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner))
    throw new Error('The GitHub owner name is invalid.');
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(repo) || repo.includes('..'))
    throw new Error('The GitHub repository name is invalid.');
  if (
    ref !== 'HEAD' &&
    (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(ref) ||
      ref.split('/').some((part) => !part || part === '.' || part === '..'))
  )
    throw new Error('The repository branch or tag name is invalid.');

  const identity = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  const slug = repo.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+/, '');
  const suffix = createHash('sha256').update(identity).digest('hex').slice(0, 8);
  const id = `${(slug || 'mcp').slice(0, 31)}-${suffix}`;
  return { id, owner, repo, repositoryUrl: `https://github.com/${owner}/${repo}`, ref };
}

function githubInstallTarget(rootDir: string, repository: GitHubRepository): string {
  const installRoot = resolve(rootDir, 'mcp-servers', 'installations', 'github', repository.id);
  const refKey = createHash('sha256').update(repository.ref).digest('hex').slice(0, 12);
  const target = resolve(installRoot, refKey);
  if (!isWithin(installRoot, target)) throw new Error('GitHub installation path escaped its owner directory');
  return target;
}

function packageBin(manifest: Record<string, unknown>, packageName: string): string {
  const value = manifest.bin;
  let candidates: Array<[string, unknown]>;
  if (typeof value === 'string') candidates = [[packageName, value]];
  else if (value && typeof value === 'object' && !Array.isArray(value))
    candidates = Object.entries(value as Record<string, unknown>);
  else throw new Error('No executable was found in this repository package.json.');

  const primaryName = packageName.split('/').at(-1);
  const selected =
    candidates.find(([name]) => name === packageName || name === primaryName) ??
    (candidates.length === 1 ? candidates[0] : undefined);
  if (!selected || typeof selected[1] !== 'string')
    throw new Error('This repository has multiple executables and DWB could not choose an MCP entry automatically.');
  const entryPoint = selected[1];
  if (
    isAbsolute(entryPoint) ||
    entryPoint.split(/[\\/]/).some((part) => part === '..') ||
    !/\.(?:c|m)?js$/i.test(entryPoint)
  )
    throw new Error('The selected repository executable is not a safe Node.js entry point.');
  return entryPoint;
}

function packageLooksLikeMcp(manifest: Record<string, unknown>, packageName: string): boolean {
  const descriptions = [packageName, manifest.description];
  if (Array.isArray(manifest.keywords)) descriptions.push(...manifest.keywords);
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const dependencies = manifest[section];
    if (dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies))
      descriptions.push(...Object.keys(dependencies));
  }
  return descriptions.some(
    (value) =>
      typeof value === 'string' && /\bmcp\b|model[\s_-]*context[\s_-]*protocol/i.test(value),
  );
}

async function readPackageManifest(packageRoot: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Installed package manifest is invalid');
  return value as Record<string, unknown>;
}

async function packageMetadata(packageRoot: string): Promise<{ name: string; version: string }> {
  const value = await readPackageManifest(packageRoot);
  if (!value || typeof value.name !== 'string' || typeof value.version !== 'string')
    throw new Error('Installed package manifest is invalid');
  return { name: value.name, version: value.version };
}

export class ExternalMcpInstaller {
  private readonly rootDir: string;
  private readonly catalog: readonly ExternalMcpCatalogEntry[];
  private readonly installPackage: InstallerOptions['installPackage'];
  private readonly prepareRepository: NonNullable<InstallerOptions['prepareGitHubRepository']>;

  constructor(options: InstallerOptions = {}) {
    this.rootDir = resolve(options.rootDir ?? dataDir());
    this.catalog = options.catalog ?? externalMcpCatalog;
    this.installPackage = options.installPackage ?? npmInstall;
    this.prepareRepository = options.prepareGitHubRepository ?? prepareGitHubRepository;
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

  getGitHubRepositoryId(input: string): string {
    return parseGitHubRepository(input).id;
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

  async installGitHubRepository(input: string): Promise<ExternalMcpDefinition> {
    const repository = parseGitHubRepository(input);
    const target = githubInstallTarget(this.rootDir, repository);
    if (existsSync(target)) return this.verifyGitHubInstallation(repository, target);

    const installRoot = dirname(target);
    await mkdir(installRoot, { recursive: true });
    const stage = resolve(installRoot, `.${randomUUID()}.staging`);
    if (!isWithin(installRoot, stage))
      throw new Error('GitHub staging path escaped its owner directory');
    await mkdir(stage, { recursive: true });
    try {
      await this.prepareRepository(stage, repository.repositoryUrl, repository.ref);
      const manifest = await readPackageManifest(stage);
      const metadata = await packageMetadata(stage);
      if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(metadata.name))
        throw new Error('The repository package name is invalid.');
      if (!packageLooksLikeMcp(manifest, metadata.name))
        throw new Error('This package does not appear to be an MCP server.');
      const relativeEntry = packageBin(manifest, metadata.name).replace(/\\/g, '/');
      const entryPoint = resolve(stage, ...relativeEntry.split('/'));
      if (!isWithin(stage, entryPoint))
        throw new Error('Repository executable escaped its installation directory.');
      const entry = await stat(entryPoint).catch(() => null);
      if (!entry?.isFile()) throw new Error('The repository executable was not produced by its build.');

      const marker: GitHubInstallMarker = {
        version: 1,
        id: repository.id,
        repositoryUrl: repository.repositoryUrl,
        repositoryRef: repository.ref,
        packageName: metadata.name,
        packageVersion: metadata.version,
        entryPoint: relativeEntry,
      };
      await writeFile(resolve(stage, '.dwb-mcp-github.json'), JSON.stringify(marker), {
        encoding: 'utf8',
        flag: 'wx',
      });
      await rename(stage, target);
      return this.githubDefinition(repository, target, marker);
    } catch (error) {
      await rm(stage, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async removeInstallation(definition: ExternalMcpDefinition): Promise<void> {
    if (definition.source === 'github') {
      await this.removeGitHubInstallation(definition);
      return;
    }
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

  private async removeGitHubInstallation(definition: ExternalMcpDefinition): Promise<void> {
    if (
      typeof definition.repositoryUrl !== 'string' ||
      typeof definition.repositoryRef !== 'string' ||
      typeof definition.installDirectory !== 'string'
    )
      throw new Error('GitHub MCP server is missing installation metadata');
    const reference = definition.repositoryRef === 'HEAD' ? '' : `#${definition.repositoryRef}`;
    const repository = parseGitHubRepository(`${definition.repositoryUrl}${reference}`);
    if (repository.id !== definition.id)
      throw new Error('Refusing to remove a GitHub installation with a mismatched repository ID');
    const expected = githubInstallTarget(this.rootDir, repository);
    if (resolve(definition.installDirectory).toLowerCase() !== expected.toLowerCase())
      throw new Error('Refusing to remove a path outside the GitHub installation directory');
    const marker = await this.readGitHubMarker(expected);
    if (
      marker.id !== definition.id ||
      marker.repositoryUrl !== repository.repositoryUrl ||
      marker.repositoryRef !== repository.ref ||
      marker.packageName !== definition.packageName ||
      marker.packageVersion !== definition.packageVersion
    )
      throw new Error('Refusing to remove a GitHub installation whose identity does not match');
    await this.verifyGitHubInstallation(repository, expected);
    await rm(expected, { recursive: true, force: true });
  }

  private async verifyGitHubInstallation(
    repository: GitHubRepository,
    directory: string,
  ): Promise<ExternalMcpDefinition> {
    const marker = await this.readGitHubMarker(directory);
    if (
      marker.id !== repository.id ||
      marker.repositoryUrl !== repository.repositoryUrl ||
      marker.repositoryRef !== repository.ref
    )
      throw new Error('Installed GitHub repository identity does not match the requested source');
    const manifest = await readPackageManifest(directory);
    const metadata = await packageMetadata(directory);
    if (metadata.name !== marker.packageName || metadata.version !== marker.packageVersion)
      throw new Error('Installed GitHub package identity changed');
    const expectedEntry = packageBin(manifest, metadata.name).replace(/\\/g, '/');
    if (expectedEntry !== marker.entryPoint)
      throw new Error('Installed GitHub executable does not match its package manifest');
    const entryPoint = resolve(directory, ...marker.entryPoint.split('/'));
    if (!isWithin(directory, entryPoint))
      throw new Error('Installed GitHub executable escaped its owner directory');
    const details = await stat(entryPoint).catch(() => null);
    if (!details?.isFile()) throw new Error('Installed GitHub executable is missing');
    return this.githubDefinition(repository, directory, marker);
  }

  private async readGitHubMarker(directory: string): Promise<GitHubInstallMarker> {
    let marker: unknown;
    try {
      marker = JSON.parse(await readFile(resolve(directory, '.dwb-mcp-github.json'), 'utf8'));
    } catch {
      throw new Error('GitHub installation ownership marker is missing or invalid');
    }
    if (
      !marker ||
      typeof marker !== 'object' ||
      (marker as GitHubInstallMarker).version !== 1 ||
      typeof (marker as GitHubInstallMarker).id !== 'string' ||
      typeof (marker as GitHubInstallMarker).repositoryUrl !== 'string' ||
      typeof (marker as GitHubInstallMarker).repositoryRef !== 'string' ||
      typeof (marker as GitHubInstallMarker).packageName !== 'string' ||
      typeof (marker as GitHubInstallMarker).packageVersion !== 'string' ||
      typeof (marker as GitHubInstallMarker).entryPoint !== 'string'
    )
      throw new Error('GitHub installation ownership marker is invalid');
    return marker as GitHubInstallMarker;
  }

  private githubDefinition(
    repository: GitHubRepository,
    directory: string,
    marker: GitHubInstallMarker,
  ): ExternalMcpDefinition {
    return {
      id: repository.id,
      name: marker.packageName,
      command: process.execPath,
      args: [resolve(directory, ...marker.entryPoint.split('/'))],
      cwd: directory,
      env: {},
      enabled: false,
      source: 'github',
      repositoryUrl: repository.repositoryUrl,
      repositoryRef: repository.ref,
      packageName: marker.packageName,
      packageVersion: marker.packageVersion,
      installDirectory: directory,
    };
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
