import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  installGitHubSkill,
  installRecommendedSkill,
  RECOMMENDED_SKILLS,
  parseGitHubSkillUrl,
} from './skill-sources.js';
import { SkillStore } from './skill-store.js';

test('GitHub repository URL defaults to HEAD and auto-discovery', () => {
  assert.deepEqual(parseGitHubSkillUrl('https://github.com/mikehasa/golive-skill'), {
    owner: 'mikehasa',
    repo: 'golive-skill',
    ref: 'HEAD',
    path: undefined,
    repository: 'https://github.com/mikehasa/golive-skill',
  });
});

test('GitHub tree URL preserves pinned ref and skill path', () => {
  assert.deepEqual(
    parseGitHubSkillUrl(
      'https://github.com/mikehasa/golive-skill/tree/v0.1.0-alpha.5/skills/golive',
    ),
    {
      owner: 'mikehasa',
      repo: 'golive-skill',
      ref: 'v0.1.0-alpha.5',
      path: 'skills/golive',
      repository: 'https://github.com/mikehasa/golive-skill',
    },
  );
});
test('GitHub URL supports explicit ref and path query parameters', () => {
  const parsed = parseGitHubSkillUrl(
    'https://github.com/example/skills?ref=release-1&path=skills/demo',
  );
  assert.equal(parsed.ref, 'release-1');
  assert.equal(parsed.path, 'skills/demo');
});

test('remote source parser rejects unsupported hosts and traversal', () => {
  assert.throws(
    () => parseGitHubSkillUrl('https://example.com/owner/repo'),
    /Only https:\/\/github\.com/,
  );
  assert.throws(
    () => parseGitHubSkillUrl('https://github.com/owner/repo?path=../secret'),
    /stay inside the repository/,
  );
});

test('recommended catalog pins GoLive to ASK and a concrete release', () => {
  const golive = RECOMMENDED_SKILLS.find((item) => item.id === 'golive');
  assert.ok(golive);
  assert.equal(golive.defaultPolicy, 'ask');
  assert.match(golive.ref, /^v\d/);
  assert.equal(golive.verify?.expectedVersion, golive.version);
});

test('recommended catalog pins BRAG Slim to MANUAL and an immutable commit', () => {
  const brag = RECOMMENDED_SKILLS.find((item) => item.id === 'brag-slim');
  assert.ok(brag);
  assert.equal(brag.defaultPolicy, 'manual');
  assert.equal(brag.path, 'skills/brag-slim');
  assert.match(brag.ref, /^[0-9a-f]{40}$/);
  assert.equal(brag.version, '0.4.0');
});

test('recommended catalog offers the pinned REA skill with ASK approval', () => {
  const rea = RECOMMENDED_SKILLS.find((item) => item.id === 'reverse-engineer-anything');
  assert.ok(rea);
  assert.equal(rea.repository, 'https://github.com/morluto/rea');
  assert.equal(rea.ref, 'rea-agents-6.4.0');
  assert.equal(rea.path, '.agents/skills/reverse-engineer-anything');
  assert.equal(rea.version, '6.4.0');
  assert.equal(rea.license, 'MIT');
  assert.equal(rea.defaultPolicy, 'ask');
});

test('quick-installs the pinned REA skill package into the skill library', async () => {
  const originalFetch = globalThis.fetch;
  const temp = await mkdtemp(join(tmpdir(), 'dwb-skill-rea-quick-install-'));
  const store = new SkillStore({
    dbPath: join(temp, 'skills.db'),
    libraryRoot: join(temp, 'skills'),
  });
  const skillText =
    '---\nname: reverse-engineer-anything\ndescription: REA test skill.\n---\n\n# REA\n';
  const files = new Map([
    ['.agents', { path: '.agents', mode: '040000', type: 'tree', sha: 'agents-tree' }],
    ['skills', { path: 'skills', mode: '040000', type: 'tree', sha: 'skills-tree' }],
    [
      'reverse-engineer-anything',
      {
        path: 'reverse-engineer-anything',
        mode: '040000',
        type: 'tree',
        sha: 'rea-skill-tree',
      },
    ],
  ]);
  globalThis.fetch = (async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const json = (value: unknown) =>
      new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    if (url.endsWith('/commits/rea-agents-6.4.0'))
      return json({ sha: 'rea-commit', commit: { tree: { sha: 'root-tree' } } });
    if (url.endsWith('/git/trees/root-tree'))
      return json({ sha: 'root-tree', tree: [files.get('.agents')] });
    if (url.endsWith('/git/trees/agents-tree'))
      return json({ sha: 'agents-tree', tree: [files.get('skills')] });
    if (url.endsWith('/git/trees/skills-tree'))
      return json({ sha: 'skills-tree', tree: [files.get('reverse-engineer-anything')] });
    if (url.endsWith('/git/trees/rea-skill-tree?recursive=1'))
      return json({
        sha: 'rea-skill-tree',
        tree: [
          {
            path: 'SKILL.md',
            mode: '100644',
            type: 'blob',
            sha: 'rea-skill-file',
            size: Buffer.byteLength(skillText),
          },
        ],
      });
    if (url.endsWith('/rea-commit/.agents/skills/reverse-engineer-anything/SKILL.md'))
      return new Response(skillText, { status: 200 });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const installed = await installRecommendedSkill(store, 'reverse-engineer-anything');
    assert.equal(installed.id, 'reverse-engineer-anything');
    assert.equal(installed.defaultPolicy, 'ask');
    assert.equal(
      installed.sourceRef,
      'https://github.com/morluto/rea/tree/rea-agents-6.4.0/.agents/skills/reverse-engineer-anything',
    );
    assert.equal(
      store.list().some((skill: any) => skill.id === installed.id),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('GitHub installer fetches only the selected skill directory', async () => {
  const ref = '1111111111111111111111111111111111111111';
  const skillText = '---\nname: demo\ndescription: targeted download test\n---\n\n# Demo\n';
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  const temp = await mkdtemp(join(tmpdir(), 'dwb-skill-source-test-'));
  const store = new SkillStore({
    dbPath: join(temp, 'skills.db'),
    libraryRoot: join(temp, 'skills'),
  });

  globalThis.fetch = (async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    const json = (value: unknown) =>
      new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    if (url.endsWith(`/commits/${ref}`))
      return json({ sha: ref, commit: { tree: { sha: 'root-tree' } } });
    if (url.endsWith('/git/trees/root-tree'))
      return json({
        sha: 'root-tree',
        tree: [{ path: 'skills', mode: '040000', type: 'tree', sha: 'skills-tree' }],
      });
    if (url.endsWith('/git/trees/skills-tree'))
      return json({
        sha: 'skills-tree',
        tree: [{ path: 'demo', mode: '040000', type: 'tree', sha: 'demo-tree' }],
      });
    if (url.endsWith('/git/trees/demo-tree?recursive=1'))
      return json({
        sha: 'demo-tree',
        tree: [
          {
            path: 'SKILL.md',
            mode: '100644',
            type: 'blob',
            sha: 'skill-blob',
            size: Buffer.byteLength(skillText),
          },
        ],
      });
    if (url.includes('raw.githubusercontent.com/example/skills/'))
      return new Response(skillText, { status: 200 });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const installed = await installGitHubSkill(
      store,
      `https://github.com/example/skills/tree/${ref}/skills/demo`,
      { defaultPolicy: 'manual', expectedId: 'demo' },
    );
    assert.equal(installed.id, 'demo');
    assert.equal(installed.defaultPolicy, 'manual');
    assert.equal(installed.sourceRef, `https://github.com/example/skills/tree/${ref}/skills/demo`);
    assert.equal(
      requested.some((url) => url.includes('codeload.github.com')),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
    await rm(temp, { recursive: true, force: true });
  }
});
