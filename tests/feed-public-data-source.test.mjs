import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(`${root}/pages/lumina-feed.js`, 'utf8');
const profileSource = readFileSync(`${root}/pages/user-profile.js`, 'utf8');
const appSource = readFileSync(`${root}/app.js`, 'utf8');

test('public feed cannot be replaced with sample posts by a URL flag', () => {
  assert.doesNotMatch(source, /feedfixture|fixture_flag|feedFixtureForced/);
  assert.match(source, /h === "localhost" \|\| h === "127\.0\.0\.1"/);
  assert.match(source, /_luminaFeedSource = "operations"/);
});

test('sample profile and authentication fixtures remain local-only', () => {
  assert.match(source, /if \(!\(host === "localhost" \|\| host === "127\.0\.0\.1"/);
  assert.match(profileSource, /return isLocal && params\.get\("followfixture"\) === "1"/);
  assert.match(profileSource, /if \(!isLocal\) return false/);
  assert.match(appSource, /if \(!\(host === "localhost" \|\| host === "127\.0\.0\.1"/);
});
