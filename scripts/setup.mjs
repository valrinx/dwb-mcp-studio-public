#!/usr/bin/env node
/**
 * setup.mjs — self-configuring install for the remote bridge.
 *
 * Runs automatically on `npm install` (postinstall) and manually via
 * `npm run setup`. Non-interactive, idempotent, and safe to re-run:
 *
 *   1. Builds the project when dist/ is missing.
 *   2. Downloads the cloudflared binary into bin/ (gitignored) when missing.
 *   3. Creates bridge.config.json with a random bearer token when missing.
 *
 * In postinstall mode every step degrades to a warning instead of failing
 * the install. Outside postinstall, real errors throw.
 *
 * Overrides: --port N | --path P | --token T | --no-token |
 *             --skip-build | --skip-cloudflared
 * Env:        BRIDGE_PORT, BRIDGE_PATH, BRIDGE_TOKEN
 */

import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { loadBridgeConfig, cloudflaredBinary, BRIDGE_CONFIG_FILE } from './bridge-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);
const POSTINSTALL = process.env.npm_lifecycle_event === 'postinstall';

function parseSetupArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skip-build') flags['skip-build'] = true;
    else if (a === '--skip-cloudflared') flags['skip-cloudflared'] = true;
    else if (a === '--no-token') flags['no-token'] = true;
    else if (a === '--port') flags.port = Number(argv[++i]);
    else if (a === '--path') flags.path = argv[++i];
    else if (a === '--token') flags.token = argv[++i];
    else if (a.startsWith('--port=')) flags.port = Number(a.slice(7));
    else if (a.startsWith('--path=')) flags.path = a.slice(7);
    else if (a.startsWith('--token=')) flags.token = a.slice(8);
    else throw new Error(`Unknown flag: ${a}`);
  }
  if (flags.port !== undefined && !Number.isFinite(flags.port)) throw new Error('Invalid --port');
  return flags;
}

function failOrWarn(step, err) {
  const msg = `[setup] ${step}: ${err.message} — continuing without it. Run \`npm run setup\` later to retry.`;
  if (POSTINSTALL) {
    console.warn(`warning: ${msg}`);
    return false;
  }
  throw new Error(msg);
}

async function ensureBuilt() {
  try {
    await stat(join(ROOT, 'dist', 'index.js'));
    console.error('[setup] build: dist/ already present');
    return true;
  } catch {
    // fall through to build
  }
  const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  try {
    await stat(tsc);
  } catch {
    console.error('[setup] build: skipping (typescript not installed — run `npm install` first)');
    return false;
  }
  try {
    console.error('[setup] build: compiling with tsc…');
    await execFileAsync(process.execPath, [tsc, '-p', join(ROOT, 'tsconfig.json')], { cwd: ROOT });
    console.error('[setup] build: done');
    return true;
  } catch (err) {
    return failOrWarn('build', err);
  }
}

function cloudflaredAsset() {
  const p = process.platform;
  const a = process.arch;
  if (p === 'win32' && a === 'x64') return 'cloudflared-windows-amd64.exe';
  if (p === 'linux' && a === 'x64') return 'cloudflared-linux-amd64';
  if (p === 'linux' && a === 'arm64') return 'cloudflared-linux-arm64';
  if (p === 'darwin' && a === 'x64') return 'cloudflared-darwin-amd64';
  if (p === 'darwin' && a === 'arm64') return 'cloudflared-darwin-arm64';
  return null;
}

async function ensureCloudflared() {
  const bin = cloudflaredBinary(ROOT);
  try {
    await stat(bin);
    console.error('[setup] cloudflared: already present');
    return true;
  } catch {
    // fall through to download
  }
  const asset = cloudflaredAsset();
  if (!asset) return failOrWarn('cloudflared', new Error(`unsupported platform ${process.platform}/${process.arch}`));
  try {
    console.error(`[setup] cloudflared: downloading ${asset}…`);
    const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`;
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await mkdir(join(ROOT, 'bin'), { recursive: true });
    await pipeline(res.body, createWriteStream(bin, { mode: 0o755 }));
    await chmod(bin, 0o755);
    console.error('[setup] cloudflared: downloaded');
    return true;
  } catch (err) {
    return failOrWarn('cloudflared', err);
  }
}

async function ensureBridgeConfig(flags) {
  const prev = await loadBridgeConfig(ROOT);
  const hadFile = Object.keys(prev).length > 0;
  const next = {
    port: flags.port ?? (process.env.BRIDGE_PORT ? Number(process.env.BRIDGE_PORT) : undefined) ?? prev.port ?? 3000,
    path: flags.path ?? process.env.BRIDGE_PATH ?? prev.path ?? '/mcp',
    token: flags['no-token'] ? null : (flags.token ?? process.env.BRIDGE_TOKEN ?? prev.token ?? randomBytes(24).toString('hex')),
  };
  const changed = !hadFile || next.port !== prev.port || next.path !== prev.path || next.token !== prev.token;
  if (changed) {
    await writeFile(join(ROOT, BRIDGE_CONFIG_FILE), JSON.stringify(next, null, 2) + '\n');
  }
  console.error(`[setup] bridge config: ${BRIDGE_CONFIG_FILE} (${hadFile ? (changed ? 'updated' : 'unchanged') : 'created'})`);
  return next;
}

async function main() {
  const flags = parseSetupArgs(process.argv.slice(2));
  if (!flags['skip-build']) await ensureBuilt();
  if (!flags['skip-cloudflared']) await ensureCloudflared();
  const cfg = await ensureBridgeConfig(flags);
  console.error('');
  console.error('[setup] ready:');
  console.error(`[setup]   bridge : npm run bridge   ->  http://127.0.0.1:${cfg.port}${cfg.path}`);
  console.error(`[setup]   token  : ${cfg.token === null ? '(none — bearer auth disabled)' : cfg.token}`);
  console.error('[setup]   tunnel : npm run tunnel   ->  public https URL for the bridge');
}

try {
  await main();
} catch (err) {
  if (POSTINSTALL) {
    console.warn(`warning: [setup] ${err.message}`);
    process.exit(0);
  }
  console.error(`[setup] failed: ${err.message}`);
  process.exit(1);
}
