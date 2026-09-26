import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const match = source.match(/function syncLateNavigationUI\(\) \{([\s\S]*?)\n\}/);

test('late translation leaves a signed-in header in its account state', () => {
  assert.ok(match, 'late navigation sync function is missing');
  const header = { label: 'account', action: 'menu' };
  const calls = [];
  const run = new Function(
    'window', 'document', 'updateAuthUI', 'activateCurrentNavItem', 'openAuthBridgeFixtureIfNeeded',
    match[1],
  );
  run(
    { luminaI18n: { apply() { calls.push('translate'); header.label = 'login'; header.action = 'login'; } } },
    { body: {} },
    () => { calls.push('auth'); header.label = 'account'; header.action = 'menu'; },
    () => calls.push('nav'),
    () => calls.push('bridge'),
  );
  assert.deepEqual(calls, ['translate', 'auth', 'nav', 'bridge']);
  assert.deepEqual(header, { label: 'account', action: 'menu' });
});
