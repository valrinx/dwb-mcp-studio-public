import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applySavedBrokerConfig } from './broker-config.js';

test('broker loads worker and autonomous settings from the saved config', () => {
  const root = mkdtempSync(join(tmpdir(), 'dwb-broker-config-'));
  const configFile = join(root, 'config.json');
  const workerEntry = join(root, 'desktop-commander', 'dist', 'index.js');
  const basePolicy = join(root, 'base-policy.json');
  writeFileSync(
    configFile,
    JSON.stringify({ workerEntry, workerCap: 7, basePolicy, autonomousAgents: true }),
  );
  const names = ['DWB_CONFIG_FILE', 'DWB_WORKER_ENTRY', 'DWB_WORKER_CAP', 'DWB_BASE_DC_CONFIG', 'DWB_AUTONOMOUS_AGENTS'];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    applySavedBrokerConfig(configFile);
    assert.equal(process.env.DWB_CONFIG_FILE, configFile);
    assert.equal(process.env.DWB_WORKER_ENTRY, workerEntry);
    assert.equal(process.env.DWB_WORKER_CAP, '7');
    assert.equal(process.env.DWB_BASE_DC_CONFIG, basePolicy);
    assert.equal(process.env.DWB_AUTONOMOUS_AGENTS, 'true');
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    rmSync(root, { recursive: true, force: true });
  }
});
