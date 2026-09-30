#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBridgeConfig } from './bridge-config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

try {
  await ensureBridgeConfig(root);
  console.log('[setup] bridge config ready');
} catch (error) {
  console.error(`[setup] bridge config failed: ${error.message}`);
  process.exitCode = 1;
}
