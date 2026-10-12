import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const styles = readFileSync(new URL('../styles.css', import.meta.url));
const source = styles.toString('utf8');
const eol = source.includes('\r\n') ? '\r\n' : '\n';
const addedLines = [
  '  max-height: calc(100vh - 44px);',
  '  max-height: calc(100dvh - 44px);',
  '  overflow-y: auto;'
];
const beforeHashes = {
  '\r\n': 'd000878d425076967d2dd07d4db000cb37955cb5d87fb99d24373c475c6a4685',
  '\n': 'ca06b1582a2cea9e651e9188d122f25372a972e2b2b154a3fd209077814bb1fa'
};

function modalRule() {
  const matches = [...source.matchAll(/^\.paid-like-modal \{\r?\n[^}]*\}/gm)];
  assert.equal(matches.length, 1, 'Exactly one standalone paid modal rule');
  return matches[0][0];
}

test('paid modal keeps the 44px vh fallback in its own rule', () => {
  const lines = modalRule().split(/\r?\n/);
  assert.equal(lines.filter(line => line === addedLines[0]).length, 1);
});

test('paid modal declares dvh after vh with the same 44px allowance', () => {
  const lines = modalRule().split(/\r?\n/);
  assert.deepEqual(lines.filter(line => /^\s*max-height:/.test(line)), addedLines.slice(0, 2));
  assert(lines.indexOf(addedLines[0]) < lines.indexOf(addedLines[1]));
});

test('paid modal scrolls vertically without an overflow-hiding override', () => {
  const lines = modalRule().split(/\r?\n/);
  assert.deepEqual(lines.filter(line => /^\s*overflow(?:-[xy])?:/.test(line)), [addedLines[2]]);
});

test('paid modal addition inverses to the full pinned CSS with no other delta', () => {
  const block = Buffer.from(addedLines.join(eol) + eol, 'utf8');
  assert(modalRule().includes(block.toString('utf8')));
  const start = styles.indexOf(block);
  assert(start >= 0, 'Exact inline addition exists');
  assert.equal(styles.indexOf(block, start + block.length), -1, 'Only one addition');
  const withoutModal = Buffer.concat([styles.subarray(0, start), styles.subarray(start + block.length)]);
  const actions = [...source.matchAll(/^\.paid-like-actions \.button-primary,\r?\n\.paid-like-actions \.button-secondary \{\r?\n[^}]*\}/gm)];
  assert.equal(actions.length, 1, 'Exactly one scoped paid action button rule');
  const actionBlock = Buffer.from(['  min-height: 64px;', '  word-break: keep-all;'].join(eol) + eol, 'utf8');
  assert(actions[0][0].includes(actionBlock.toString('utf8')));
  const actionStart = withoutModal.indexOf(actionBlock);
  assert(actionStart >= 0, 'Exact inline button addition exists');
  assert.equal(withoutModal.indexOf(actionBlock, actionStart + actionBlock.length), -1, 'Only one button addition');
  const restored = Buffer.concat([withoutModal.subarray(0, actionStart), withoutModal.subarray(actionStart + actionBlock.length)]);
  // Pin raw CRLF and its separately measured Git LF representation; never normalize the tested bytes.
  assert.equal(createHash('sha256').update(restored).digest('hex'), beforeHashes[eol]);
});
