import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dataDir } from './paths.js';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Load saved DWB settings when the broker is started directly by an MCP client. */
export function applySavedBrokerConfig(configFile = process.env.DWB_CONFIG_FILE || resolve(dataDir(), 'config.json')): void {
  const path = resolve(configFile);
  if (!process.env.DWB_CONFIG_FILE) process.env.DWB_CONFIG_FILE = path;
  try {
    const config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (!process.env.DWB_WORKER_ENTRY && text(config.workerEntry))
      process.env.DWB_WORKER_ENTRY = text(config.workerEntry);
    if (process.env.DWB_WORKER_CAP === undefined && Number.isFinite(Number(config.workerCap)))
      process.env.DWB_WORKER_CAP = String(config.workerCap);
    if (process.env.DWB_BASE_DC_CONFIG === undefined && text(config.basePolicy))
      process.env.DWB_BASE_DC_CONFIG = text(config.basePolicy);
    if (process.env.DWB_AUTONOMOUS_AGENTS === undefined && config.autonomousAgents === true)
      process.env.DWB_AUTONOMOUS_AGENTS = 'true';
  } catch {
    // Keep the broker available so the dashboard can report setup/configuration errors.
  }
}
