import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../backstage.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../backstage/index.html', import.meta.url), 'utf8');

// Preserve offsets while hiding comments/strings; validate balanced CSS tokens.
function syntaxMask(input) {
  const out = [...input];
  const stack = [];
  let quote = null;
  let comment = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];
    if (comment) {
      out[i] = ' ';
      if (char === '*' && next === '/') { out[++i] = ' '; comment = false; }
      continue;
    }
    if (quote) {
      out[i] = ' ';
      if (char === '\\') { assert.ok(next !== undefined, 'Trailing string escape'); out[++i] = ' '; }
      else if (char === quote) quote = null;
      else assert.ok(char !== '\n' && char !== '\r', 'Unescaped string newline');
      continue;
    }
    if (char === '/' && next === '*') { out[i] = out[++i] = ' '; comment = true; continue; }
    if (char === '"' || char === "'") { quote = char; out[i] = ' '; continue; }
    if (char === '\\') { assert.ok(next !== undefined, 'Trailing CSS escape'); out[i] = out[++i] = ' '; continue; }
    if ('([{'.includes(char)) stack.push(char);
    if (')]}'.includes(char)) assert.equal(stack.pop(), ({ ')': '(', ']': '[', '}': '{' })[char], 'Mismatched CSS delimiter');
  }
  assert.equal(comment, false, 'Unclosed CSS comment');
  assert.equal(quote, null, 'Unclosed CSS string');
  assert.equal(stack.length, 0, 'Unclosed CSS delimiter');
  return out.join('');
}
function topPositions(mask, character) {
  let depth = 0;
  const found = [];
  for (let i = 0; i < mask.length; i++) {
    if ('(['.includes(mask[i])) depth++;
    if (')]'.includes(mask[i])) depth--;
    if (!depth && mask[i] === character) found.push(i);
  }
  return found;
}
function parseCss(input) {
  const masked = syntaxMask(input);
  const rules = [];
  function walk(start, end, media = []) {
    let cursor = start;
    while (masked.slice(cursor, end).trim()) {
      const open = masked.indexOf('{', cursor);
      assert.ok(open >= cursor && open < end, 'Rule requires a block');
      const selector = masked.slice(cursor, open).trim();
      assert.ok(selector && !selector.includes(';'), 'Invalid rule prelude');
      let depth = 1;
      let close = open + 1;
      while (close < end && depth) {
        if (masked[close] === '{') depth++;
        if (masked[close] === '}') depth--;
        close++;
      }
      assert.equal(depth, 0, 'Unclosed rule');
      if (selector.startsWith('@')) {
        assert.match(selector, /^@media\s+\(max-width:\s*\d+px\)$/);
        walk(open + 1, close - 1, [...media, Number(selector.match(/(\d+)px/)[1])]);
      } else {
        const body = input.slice(open + 1, close - 1);
        const bodyMask = masked.slice(open + 1, close - 1);
        assert.doesNotMatch(bodyMask, /[{}]/, 'Unexpected nested declaration block');
        const ends = [...topPositions(bodyMask, ';'), body.length];
        const declarations = {};
        let from = 0;
        for (const until of ends) {
          const fragmentMask = bodyMask.slice(from, until);
          const fragment = body.slice(from, until);
          from = until + 1;
          if (!fragmentMask.trim()) continue;
          const colon = topPositions(fragmentMask, ':')[0];
          assert.ok(colon !== undefined, 'Declaration requires colon');
          const property = fragmentMask.slice(0, colon).trim();
          const value = fragment.slice(colon + 1).trim();
          assert.match(property, /^(?:--)?[a-zA-Z_][a-zA-Z0-9_-]*$/);
          assert.ok(value && !/!important\s+\S/.test(value), 'Declaration requires a valid nonempty value');
          declarations[property] = value;
        }
        rules.push({ selector, declarations, media });
      }
      cursor = close;
    }
  }
  walk(0, input.length);
  return rules;
}
const rules = parseCss(css);
const widths = [320, 390, 760, 761, 1440];
function declarations(selector, width) {
  return Object.assign({}, ...rules.filter(rule => rule.media.every(max => width <= max)
    && rule.selector.split(',').map(value => value.trim()).includes(selector)).map(rule => rule.declarations));
}

test('actual dialog HTML keeps title/close siblings and detail list as a direct flex-card child', () => {
  const start = html.indexOf('<aside class="detail-panel');
  const end = html.indexOf('</aside>', start);
  assert.ok(start >= 0 && end > start);
  const panel = html.slice(start, end);
  assert.match(panel, /id="backstageDetailPanel"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="detailTitle"/);
  assert.match(panel, /<div class="detail-card">\s*<header>\s*<div>[\s\S]*?<h2 id="detailTitle">[^<]*<\/h2>\s*<\/div>\s*<button class="text-action"[^>]*id="detailCloseButton">[^<]+<\/button>\s*<\/header>\s*<dl class="detail-list" id="detailList">/);
  assert.match(html, /href="\/backstage\.css(?:\?[^"\s]*)?"/);
});

test('whole CSS token/block/declaration syntax and parser rejection guards remain valid', () => {
  assert.ok(rules.length > 100);
  assert.doesNotThrow(() => parseCss('.probe { content: "{};:/*literal*/"; width: calc(100% - 2px); }'));
  for (const invalid of ['.probe { color: red;', '.probe { width: calc(1px; }', '.probe { content: "bad; }',
    '/* unfinished', '.probe { color red; }', '.probe { color: ; }', '.probe { width: [1px); }']) {
    assert.throws(() => parseCss(invalid));
  }
});

test('existing desktop/mobile card dimensions, internal scroll and visual design stay bounded', () => {
  for (const width of widths) {
    const panel = declarations('.detail-panel', width);
    const card = declarations('.detail-card', width);
    assert.equal(panel.position, 'fixed');
    assert.equal(panel.inset, '0');
    assert.equal(panel.padding, '24px');
    assert.equal(panel['z-index'], '90');
    assert.equal(card.width, 'min(680px, 100%)');
    assert.equal(card['max-height'], 'min(760px, calc(100vh - 48px))');
    assert.equal(card.display, 'flex');
    assert.equal(card['flex-direction'], 'column');
    assert.equal(card['overflow-y'], 'auto');
    assert.equal(card.padding, '24px');
    assert.equal(card.gap, '16px');
    assert.equal(card['border-radius'], '8px');
    assert.equal(card.background, '#fff');
    assert.equal(declarations('.detail-panel h2', width)['font-size'], '22px');
    assert.equal(declarations('.detail-panel h2', width)['letter-spacing'], '0');
  }
  assert.match(css, /\.is-hidden\s*\{\s*display:\s*none\s*!important;/);
});

test('header title flex item can narrow and long unbroken title can wrap at every width boundary', () => {
  for (const width of widths) {
    assert.equal(declarations('.detail-card > header > div', width)['min-width'], '0');
    assert.equal(declarations('.detail-panel h2', width)['overflow-wrap'], 'anywhere');
    assert.equal(declarations('.detail-panel header', width).display, 'flex');
    assert.equal(declarations('.detail-panel header', width).gap, '14px');
  }
});

test('only the root detail close control is nonshrinking and single-line', () => {
  for (const width of widths) {
    const close = declarations('.detail-card > header > .text-action', width);
    assert.equal(close['flex-shrink'], '0');
    assert.equal(close['white-space'], 'nowrap');
    assert.equal(declarations('.text-action', width)['min-height'], '32px');
    assert.equal(declarations('.text-action', width).padding, '0 10px');
    assert.notEqual(declarations('.text-action', width)['white-space'], 'nowrap');
  }
});

test('card direct children keep intrinsic height instead of shrinking the clipped list under max-height', () => {
  for (const width of widths) {
    assert.equal(declarations('.detail-card > *', width)['flex-shrink'], '0');
    const list = declarations('.detail-list', width);
    assert.equal(list.display, 'grid');
    assert.equal(list.overflow, 'hidden');
    assert.equal(list['border-radius'], '8px');
    assert.equal(list.height, undefined);
    assert.equal(list['max-height'], undefined);
    assert.equal(declarations('.detail-list div', width)['min-height'], '42px');
  }
});

test('detail value grid can narrow while long literal text wraps without changing label geometry', () => {
  for (const width of widths) {
    assert.equal(declarations('.detail-list div', width)['grid-template-columns'], '96px minmax(0, 1fr)');
    const value = declarations('.detail-list dd', width);
    assert.equal(value['min-width'], '0');
    assert.equal(value['overflow-wrap'], 'anywhere');
    assert.equal(value['word-break'], 'keep-all');
    assert.equal(declarations('.detail-list dt', width).padding, '11px 12px');
    assert.equal(value.padding, '11px 12px');
  }
});
