import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { test } from 'node:test';
import { publicationFiles } from '../scripts/build-public-site.mjs';

const root = new URL('../', import.meta.url);
const entry = readFileSync(new URL('creator-studio/index.html', root), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('scripts/public-site-manifest.json', root), 'utf8'));
const files = new Set(publicationFiles(manifest));

test('actual creator entry references trial assets that are both present and publicly allowlisted', () => {
  for (const asset of ['pages/creator-body-trial.js', 'pages/creator-body-trial.css', 'pages/creator-body-preview.js']) {
    assert.ok(files.has(asset));
    assert.ok(existsSync(fileURLToPath(new URL(asset, root))));
    assert.ok(entry.includes('/' + asset + '?v='));
  }
  assert.equal((entry.match(/id="writerBodyTrial"/g) || []).length, 1);
  assert.match(entry, /src="\/pages\/creator-body-preview\.js\?v=body-selected-scope-20261008"/);
  assert.ok(entry.indexOf('src="/pages/creator-body-preview.js') < entry.indexOf('src="/pages/creator-body-trial.js'));
});

test('all local creator entry scripts and styles remain in the real publication inventory', () => {
  const references = [...entry.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="\/([^"?]+)(?:\?[^\"]*)?"/g)]
    .map(match => match[1]).filter(file => /\.(js|css)$/.test(file));
  assert.ok(references.length > 20);
  for (const file of references) {
    assert.ok(files.has(file), 'Unpublished creator asset: ' + file);
    assert.ok(existsSync(fileURLToPath(new URL(file, root))));
  }
  assert.ok([...files].every(file => !/(^|\/)(server|docs|qa-artifacts|tests|scripts)\//.test(file)));
});

for (const file of ['pages/creator-body-trial.js', 'pages/creator-body-preview.js']) {
  test(`actual ${file} has valid JavaScript syntax`, () => {
    assert.doesNotThrow(() => new Script(readFileSync(new URL(file, root), 'utf8'), { filename: file }));
  });
}
