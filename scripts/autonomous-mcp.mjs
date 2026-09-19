#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dataDir } from '../dist/paths.js';

const configFile = resolve(
  process.argv[2] || process.env.DWB_CONFIG_FILE || resolve(dataDir(), 'config.json'),
);

process.env.DWB_CONFIG_FILE = configFile;
try {
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  if (typeof config.workerEntry === 'string' && config.workerEntry.trim()) {
    process.env.DWB_WORKER_ENTRY = config.workerEntry;
  }
} catch {
  // scripts/start.mjs reports the actionable configuration error.
}

await import('./start.mjs');
