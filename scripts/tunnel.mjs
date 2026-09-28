#!/usr/bin/env node
/**
 * tunnel.mjs — expose the local bridge on a public https URL.
 *
 * Uses the cloudflared binary managed by `npm run setup` (bin/, gitignored)
 * and the bridge port from bridge.config.json:
 *
 *   npm run tunnel
 *
 * Prints the public URL; keep it running while remote clients connect.
 */

import { spawn } from 'node:child_process';
import { stat, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBridgeConfig, cloudflaredBinary } from './bridge-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const cfg = await loadBridgeConfig(ROOT);
const port = cfg.port ?? 3000;
const bin = cloudflaredBinary(ROOT);

try {
  await stat(bin);
} catch {
  console.error(`[tunnel] cloudflared not found at ${bin}`);
  console.error('[tunnel] run `npm run setup` first.');
  process.exit(1);
}

// Ephemeral public URL, read by the Muse AI dashboard screen (gitignored).
const TUNNEL_URL_FILE = join(ROOT, 'tunnel.url');

console.error(`[tunnel] forwarding http://127.0.0.1:${port} — waiting for public URL…`);
const child = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${port}`], { stdio: ['inherit', 'inherit', 'pipe'] });
let urlSaved = false;
child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  if (urlSaved) return;
  const m = /https:\/\/[a-z0-9.-]+\.trycloudflare\.com/i.exec(chunk.toString());
  if (m) {
    urlSaved = true;
    writeFile(TUNNEL_URL_FILE, m[0] + '\n').then(
      () => console.error(`[tunnel] public URL saved to tunnel.url`),
      () => {},
    );
  }
});
child.on('exit', (code, signal) => {
  unlink(TUNNEL_URL_FILE).catch(() => {});
  console.error(`[tunnel] exited (code=${code} signal=${signal})`);
  process.exit(code ?? 0);
});
