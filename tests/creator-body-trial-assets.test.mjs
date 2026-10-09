import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Studio uses the current output limit advice script without changing the styles or preview revision', () => {
  const html = readFileSync(new URL('../creator-studio/index.html', import.meta.url), 'utf8');
  const assets = ['/pages/creator-body-trial.css', '/pages/creator-body-preview.js', '/pages/creator-body-trial.js'];
  const tags = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => new URL(match[1], 'https://lumina-stage.com'));
  for (const asset of assets) {
    const matches = tags.filter(url => url.pathname === asset);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].searchParams.get('v'), asset === '/pages/creator-body-preview.js' ?
      'body-selected-scope-20261008' : asset === '/pages/creator-body-trial.js' ?
        'body-output-limit-advice-20261009' : 'body-failure-advice-20261009');
  }
  assert.equal(tags.filter(url => url.pathname === '/pages/creator-studio.js').length, 1);
  assert(html.indexOf('/pages/creator-studio.js') < html.indexOf('/pages/creator-body-trial.js'));
  assert(html.indexOf('/pages/creator-body-preview.js') < html.indexOf('/pages/creator-body-trial.js'));
});
