import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('character chat loads the current route, receipt and draft script once', () => {
  const html = readFileSync(new URL('../character-chat/index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(match => match[1]);
  assert.deepEqual(scripts.filter(src => src.split('?')[0] === '/pages/character-chat.js'), [
    '/pages/character-chat.js?v=20261009-route-receipt-draft',
  ]);
  assert(scripts.indexOf('/app.js') < scripts.indexOf('/pages/character-chat.js?v=20261009-route-receipt-draft'));
});
