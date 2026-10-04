import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runtimeDir } from './paths.js';
import { workerAllowedDirectories } from './workspace-policy.js';

export async function prepareWorkerHome(
  sessionId: string,
  workspace = process.cwd(),
): Promise<string> {
  const runtimeRoot = runtimeDir();
  const home = resolve(runtimeRoot, 'sessions', sessionId, 'home');
  const configDir = resolve(home, '.claude-server-commander');
  await mkdir(configDir, { recursive: true });
  let source: any = {};
  try {
    if (process.env.DWB_BASE_DC_CONFIG)
      source = JSON.parse(await readFile(resolve(process.env.DWB_BASE_DC_CONFIG), 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read DWB_BASE_DC_CONFIG: ${String(error)}`);
  }
  const config = {
    blockedCommands: source.blockedCommands,
    defaultShell: source.defaultShell,
    allowedDirectories: workerAllowedDirectories(source, workspace),
    telemetryEnabled: false,
    fileWriteLineLimit: source.fileWriteLineLimit,
    fileReadLineLimit: source.fileReadLineLimit,
    pendingWelcomeOnboarding: false,
    welcomeOnboardingEligible: false,
  };
  await writeFile(resolve(configDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
  return home;
}
