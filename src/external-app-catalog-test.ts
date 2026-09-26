import assert from 'node:assert/strict';
import { test } from 'node:test';

const catalogUrl = new URL('../dist/external-app-catalog.js', import.meta.url);
let catalogModule: any = null;
try {
  catalogModule = await import(catalogUrl.href);
} catch {
  // The RED assertion identifies the missing separate app catalog.
}

test('keeps app integrations separate from official reference servers', () => {
  assert.ok(catalogModule?.listExternalAppCatalog, 'app integration catalog is not implemented');
  const entries = catalogModule.listExternalAppCatalog();
  assert.ok(entries.length >= 8);
  assert.deepEqual(
    entries.map((entry: any) => entry.id),
    [
      'figma',
      'github',
      'linear',
      'atlassian',
      'supabase',
      'vercel',
      'cloudflare',
      'canva',
      'capcut',
    ],
  );
  assert.ok(entries.every((entry: any) => entry.id !== 'filesystem'));
  assert.ok(entries.filter((entry: any) => entry.kind === 'official-remote').length >= 7);
  const capcut = entries.find((entry: any) => entry.id === 'capcut');
  assert.deepEqual(
    {
      kind: capcut.kind,
      auth: capcut.auth,
      sourceUrl: capcut.sourceUrl,
    },
    {
      kind: 'community-local',
      auth: 'local-uv',
      sourceUrl: 'https://github.com/bchenner/capcut-mcp',
    },
  );
  const linear = entries.find((entry: any) => entry.id === 'linear');
  assert.equal(linear.endpoint, 'https://mcp.linear.app/mcp');
  assert.equal(linear.official, true);
});
