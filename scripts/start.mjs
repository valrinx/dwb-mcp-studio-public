#!/usr/bin/env node
import { readConfig, validateConfig, applyConfig } from './config.mjs';

try {
  const config = await validateConfig(await readConfig());
  applyConfig(config);
  await import('../dist/index.js');
} catch (error) {
  console.error(`N3zuui Core: ${error.message}`);
  process.exitCode = 1;
}
