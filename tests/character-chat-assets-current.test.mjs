import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function assertChatScripts(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(match => match[1]);
  assert.deepEqual(scripts.filter(src => src.split('?')[0] === '/pages/character-chat.js'), [
    '/pages/character-chat.js?v=20261009-conversation-list-owner',
  ]);
  assert.deepEqual(scripts.filter(src => src.split(/[?#]/)[0] === '/app.js'), ['/app.js?v=wallet-session-20261011']);
  assert.equal(scripts.filter(src => src === '/app.js?v=wallet-session-20261011').length, 1);
  assert(scripts.indexOf('/app.js?v=wallet-session-20261011') < scripts.indexOf('/pages/character-chat.js?v=20261009-conversation-list-owner'));
}

test('character chat loads the current route, receipt and draft script once after its app', () => {
  assertChatScripts(readFileSync(new URL('../character-chat/index.html', import.meta.url), 'utf8'));
});

test('character chat asset guard rejects a missing app rather than accepting its negative index', () => {
  const html = readFileSync(new URL('../character-chat/index.html', import.meta.url), 'utf8');
  const appTag = '<script src="/app.js?v=wallet-session-20261011"></script>';
  assert.equal(html.split(appTag).length - 1, 1);
  assert.throws(() => assertChatScripts(html.replace(appTag, '')));
});
