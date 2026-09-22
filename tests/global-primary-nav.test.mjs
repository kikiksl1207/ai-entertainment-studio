import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const expected = ['/', '/characters', '/story-stage', '/ott', '/lumina-feed', '/lumina-pick'];

test('every public page uses the same primary navigation order', () => {
  const files = execFileSync('git', ['grep', '-l', '<nav class="main-nav"', '--', '*.html'], {
    cwd: root,
    encoding: 'utf8',
  }).trim().split(/\r?\n/).filter(Boolean);

  assert.ok(files.length > 0);
  for (const file of files) {
    const html = readFileSync(`${root}/${file}`, 'utf8');
    const nav = html.match(/<nav class="main-nav"[\s\S]*?<\/nav>/)?.[0];
    assert.ok(nav, `${file}: primary nav is missing`);
    const hrefs = [...nav.matchAll(/<a\s+href="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(hrefs, expected, file);
  }
});

test('runtime navigation normalizer keeps desktop and mobile order aligned', () => {
  const script = readFileSync(`${root}/app.js`, 'utf8');
  const functionBody = script.match(/function normalizePublicDiscoveryNavigation\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(functionBody);
  for (const href of expected) assert.match(functionBody, new RegExp(`href="${href.replace('/', '\\/')}"`));
  assert.match(functionBody, /data-tab-key="lumina-pick"/);
});
