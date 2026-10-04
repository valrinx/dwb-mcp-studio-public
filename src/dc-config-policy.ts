import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PERSISTED_KEYS = new Set([
  'blockedCommands',
  'allowedDirectories',
  'defaultShell',
  'telemetryEnabled',
  'fileReadLineLimit',
  'fileWriteLineLimit',
]);

export async function persistBaseDcConfigValue(key: string, value: unknown): Promise<boolean> {
  const source = process.env.DWB_BASE_DC_CONFIG;
  if (!source || !PERSISTED_KEYS.has(key)) return false;

  const path = resolve(source);
  const current = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  current[key] = value;
  if (key === 'allowedDirectories') current.n3zuuiWorkspacePolicy = { version: 1, mode: 'custom' };

  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(current, null, 2) + '\n', 'utf8');
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  return true;
}
