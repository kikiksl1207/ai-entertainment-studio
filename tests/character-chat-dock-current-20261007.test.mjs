import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const html = read('character-chat/index.html');
const css = read('styles/character-chat.css');
const js = read('pages/character-chat.js');

test('route notice and explicit check remain within the chat composer', () => {
  const start = html.indexOf('id="chatInputForm"');
  const end = html.indexOf('</form>', start);
  assert(start >= 0 && end > start);
  for (const id of ['chatInput', 'chatSendBtn', 'chatSendStatus', 'chatCheckMessages']) {
    const at = html.indexOf('id="' + id + '"');
    assert(at > start && at < end, id);
    assert.equal(html.indexOf('id="' + id + '"', at + 1), -1);
  }
});

test('composer feedback spans the full grid and an empty notice consumes no row', () => {
  assert(css.includes('.dm-dock .dm-send-feedback { grid-column: 1 / -1; margin: 0; }'));
  assert(css.includes('.dm-dock .dm-send-feedback:has(> #chatSendStatus:empty):has(> #chatCheckMessages[hidden]) { display: none; }'));
  assert(css.includes('padding-bottom: var(--chat-dock-space, 80px);'));
});

test('observed composer height reserves mobile space without a network call', () => {
  const start = js.indexOf('  function bindBasicChatComposer(');
  const end = js.indexOf('    const input = $("chatInput");', start);
  assert(start >= 0 && end > start);
  const setup = js.slice(start, end);
  assert(setup.includes('typeof ResizeObserver === "function"'));
  assert(setup.includes('Math.max(80, Math.ceil(form.getBoundingClientRect().height) + 16)'));
  assert(setup.includes('document.documentElement.style.setProperty("--chat-dock-space", space + "px")'));
  assert(setup.includes('dockObserver.observe(form);'));
  assert(!/\b(?:fetch|apiFetch|basicChatRequest)\s*\(/.test(setup));
});
