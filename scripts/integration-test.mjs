import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { externalWorker } from '../dist/external-worker.js';

const worker = externalWorker();
const hash = async () =>
  createHash('sha256')
    .update(await readFile(worker.config))
    .digest('hex');
const before = await hash();
const root = new URL('../', import.meta.url);
const logs = fileURLToPath(new URL('logs/', root));
await mkdir(logs, { recursive: true });
const testData = await mkdtemp(resolve(logs, 'integration-data-'));
const suites = [
  'smoke-test',
  'payload-smoke-test',
  'multi-session-test',
  'broker-recovery-test',
  'logical-context-test',
  'protocol-negotiation-test',
  'workspace-integration-test',
  'resume-routing-test',
];
const selected = process.argv.slice(2);
if (selected.some((suite) => !suites.includes(suite)))
  throw new Error('Unknown integration suite.');
for (const suite of selected.length ? selected : suites) {
  console.log(`RUN ${suite}`);
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', `src/${suite}.ts`], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        DWB_DATA_DIR: testData,
        DWB_CONFIG_FILE: resolve(testData, 'config.json'),
      },
    });
    child.on('error', reject);
    child.on('exit', resolveExit);
  });
  if (code !== 0) throw new Error(`${suite} failed (${code})`);
}
if (before !== (await hash()))
  throw new Error('External Desktop Commander config.js was modified.');
console.log('EXTERNAL_INSTALL_UNCHANGED_PASS');
