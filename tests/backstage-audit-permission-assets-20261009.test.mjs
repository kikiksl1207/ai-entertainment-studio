import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { sourceWithoutAuditPermissionDelta } from './support/backstage-audit-permission-inverse-20261009.mjs';

const entry = readFileSync(new URL('../backstage/index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');

test('audit permission entry has exactly one current runtime and preserves existing native creator guards', () => {
  const scripts = [...entry.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)]
    .map(match => new URL(match[1], 'https://synthetic.invalid'))
    .filter(url => url.pathname === '/backstage.js');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].searchParams.get('v'), 'audit-permission-current-20261009');
  assert.doesNotMatch(entry, /backstage\.js\?v=(?:creators-native-readonly|admin-audit-rows)/);
  assert.match(entry, /backstage\.css\?v=login-width-20261009/);
  assert.match(source, /BEGIN creators-native-readonly-20261009/);
  assert.match(source, /END creators-native-readonly-20261009/);
});

test('enumerated audit inverse restores the frozen baseline and rejects unrelated source changes', () => {
  const previous = sourceWithoutAuditPermissionDelta(source);
  assert.match(previous, /sectionId === "overview" \|\| sectionId === "logs"/);
  assert.throws(() => sourceWithoutAuditPermissionDelta(source + '\n// synthetic unexpected delta\n'));
  const delta = JSON.parse(readFileSync(new URL('./fixtures/backstage-audit-permission-exact-delta-v2-20261009.json', import.meta.url), 'utf8'));
  delta.changes[0].before += '\n// synthetic altered baseline\n';
  assert.throws(() => sourceWithoutAuditPermissionDelta(source, delta));
});
