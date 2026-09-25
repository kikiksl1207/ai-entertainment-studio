import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../backstage-story-publication.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../backstage-story-publication.css', import.meta.url), 'utf8');

test('backstage replaces stale visuals sequentially and reports completion', () => {
  assert.match(source, /visualIdentityManaged: true/g);
  assert.match(source, /\/admin\/api\/v1\/story-visuals\/\$\{encodeURIComponent\(work\.id\)\}\/replacement-status/);
  assert.match(source, /\/admin\/api\/v1\/story-visuals\/\$\{encodeURIComponent\(work\.id\)\}\/replace-stale/);
  assert.match(source, /for \(const item of items\)/);
  assert.match(source, /장면 그림 \$\{completed\}장을 새 기준으로 모두 교체/);
  assert.match(source, /표지와 같은 화풍·인물 기준/);
  assert.doesNotMatch(source, /Promise\.all\([^)]*replace-stale/);
});

test('visual replacement controls stay inside the publication card on desktop and mobile', () => {
  assert.match(css, /\.story-fixed-release-controls \{\s*display: grid;/);
  assert.match(css, /\.story-visual-replace-button \{[^}]*width: 100%;[^}]*min-height: 38px;/);
  assert.match(css, /\.story-ai-activation,\s*\.story-fixed-release-controls \{ grid-column: 1 \/ -1; \}/);
});

test('backstage can review and replace one stale image for the fifth work', () => {
  assert.match(source, /key: "inheritor"[\s\S]*?visualIdentityManaged: true/);
  assert.match(source, /story-visual-assets\/\$\{escapeHtml\(assetId\)\}/);
  assert.match(source, /data-story-visual-scene=/);
  assert.match(source, /staleItems\.filter\(\(item\) => item\.sourceSceneKey === selectedKey\)/);
});
