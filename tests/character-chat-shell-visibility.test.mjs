import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../styles/character-chat.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../character-chat/index.html', import.meta.url), 'utf8');

test('hidden chat room stays hidden despite its flex layout', () => {
  assert.ok(/\.chat-shell\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;\s*\}/.test(css), 'hidden room must override flex');
  assert.ok(/\.chat-shell\s*\{\s*display:\s*flex\s*;/.test(css), 'visible room keeps its flex layout');
});

test('both shells start hidden and use the current page-only stylesheet', () => {
  for (const id of ['chatListShell', 'chatRoomShell']) {
    assert.ok(new RegExp('<(?:section|div)\\b[^>]*\\bid="' + id + '"[^>]*\\bhidden(?:\\s|>)').test(html), id + ' starts hidden');
  }
  const refs = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/g)].map(match => match[1]);
  assert.deepEqual(refs.filter(src => src.split('?')[0] === '/styles/character-chat.css'), [
    '/styles/character-chat.css?v=20261009-shell-visibility',
  ]);
});

test('room visibility repair does not weaken the existing list hidden rule', () => {
  assert.ok(/\.dm-list-shell\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;\s*\}/.test(css), 'list hidden rule stays intact');
});
