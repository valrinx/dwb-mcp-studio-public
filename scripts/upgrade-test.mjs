import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { previousInstall, migrate, ready, mark, needsBuild } from './upgrade.mjs';

await mkdir('logs', { recursive: true });
const root = await mkdtemp(resolve('logs/upgrade-test-'));
const old = join(root, 'old app');
const next = join(root, 'new app');
const worker = join(old, 'external/desktop-commander/node_modules/@wonderwhy-er/desktop-commander');
await mkdir(join(worker, 'dist'), { recursive: true });
await mkdir(next);
const save = (path, value) => writeFile(path, JSON.stringify(value));
await save(join(old, 'package.json'), { name: 'another-app' });
await save(join(worker, 'package.json'), {
  name: '@wonderwhy-er/desktop-commander',
  version: '0.2.50',
});
await writeFile(join(worker, 'dist/index.js'), '// fixture');
const config = join(root, 'config.json');
await save(config, { workerEntry: join(worker, 'dist/index.js') });
assert.equal(await previousInstall(config, next), null, 'must reject other apps');
await save(join(old, 'package.json'), { name: 'dwb-mcp-studio-core' });
await save(join(next, 'package.json'), { name: 'n3zuui-mcp-studio-core' });
assert.equal(
  await previousInstall(config, next),
  old,
  'new N3zuui release must recognize legacy DWB installations',
);
assert.equal(await previousInstall(config, old), null);
await save(join(old, 'package.json'), { name: 'n3zuui-mcp-studio-core' });
assert.equal(
  await previousInstall(config, next),
  old,
  'future N3zuui releases must recognize N3zuui installations',
);
await save(join(old, 'package.json'), { name: 'dwb-mcp-studio-core' });
assert.deepEqual(await migrate(config, next), ['desktop-commander']);
assert.equal(
  await readFile(
    join(
      next,
      'external/desktop-commander/node_modules/@wonderwhy-er/desktop-commander/dist/index.js',
    ),
    'utf8',
  ),
  '// fixture',
);
assert.deepEqual(await migrate(config, next), [], 'repeat must preserve existing target');
await mkdir(join(next, 'dist'));
await writeFile(join(next, 'dist/index.js'), '// compiled fixture');
await mark(next);
assert.equal(await needsBuild(next), false);
assert.equal(await ready(next), true);
await mkdir(join(next, 'src'));
await writeFile(join(next, 'src/index.ts'), '// changed source');
assert.equal(await ready(next), false, 'Git source changes must invalidate setup');
assert.equal(await needsBuild(next), true, 'changed source with stale dist must rebuild');
await mark(next);
await mkdir(join(next, 'scripts'));
await writeFile(join(next, 'scripts/start.mjs'), '// changed launcher');
assert.equal(await ready(next), false, 'launcher changes must invalidate setup');
assert.equal(
  await needsBuild(next),
  false,
  'launcher-only update must reuse production dependencies',
);
const linked = join(root, 'linked app');
await mkdir(linked);
await symlink(join(old, 'external'), join(linked, 'external'), 'junction');
await assert.rejects(migrate(config, linked), /junction/);
console.log(
  'UPGRADE_TEST_PASS: own install discovery, idempotent copy, link refusal, Git/build freshness.',
);
