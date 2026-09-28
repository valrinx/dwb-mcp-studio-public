import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const BRIDGE_CONFIG_FILE = 'bridge.config.json';

/** Bridge defaults from <repo-root>/bridge.config.json ({} when absent). */
export async function loadBridgeConfig(root) {
  try {
    const raw = await readFile(join(root, BRIDGE_CONFIG_FILE), 'utf8');
    const cfg = JSON.parse(raw);
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
      throw new Error('config must be a JSON object');
    }
    return cfg;
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`Cannot read ${BRIDGE_CONFIG_FILE}: ${err.message}`);
  }
}

/** Local cloudflared binary managed by `npm run setup` (bin/ is gitignored). */
export function cloudflaredBinary(root) {
  return join(root, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
}

/** Default stdio command the bridge exposes (the studio itself). */
export function studioCommand(root) {
  return [process.execPath, join(root, 'scripts', 'start.mjs')];
}
