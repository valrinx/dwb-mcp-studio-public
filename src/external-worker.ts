import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

export function externalWorker(entry = process.env.DWB_WORKER_ENTRY) {
  if (!entry || !isAbsolute(entry))
    throw new Error(
      'Set DWB_WORKER_ENTRY to the absolute dist/index.js path of your separately installed Desktop Commander. Open N3zuui Studio.exe to complete Setup, or run npm run configure.',
    );
  const actualEntry = realpathSync(entry);
  const root = resolve(dirname(actualEntry), '..');
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  if (pkg.name !== '@wonderwhy-er/desktop-commander' || pkg.version !== '0.2.50')
    throw new Error(
      'This beta supports separately installed @wonderwhy-er/desktop-commander 0.2.50 only. Other versions need compatibility testing.',
    );
  if (actualEntry !== realpathSync(resolve(root, 'dist', 'index.js')))
    throw new Error('Worker entry must be Desktop Commander dist/index.js.');
  const config = realpathSync(resolve(root, 'dist', 'config.js'));
  const source = readFileSync(config, 'utf8');
  if (
    !source.includes('export const USER_HOME = os.homedir();') &&
    !source.includes('export const USER_HOME = process.env.DWB_DC_CONFIG_HOME || os.homedir();')
  )
    throw new Error(
      'Desktop Commander config layout is incompatible with worker isolation. External installation was not modified.',
    );
  return { entry: actualEntry, config, version: String(pkg.version) };
}
