import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../pages/story-stage.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles/story-stage.css', import.meta.url), 'utf8');
const service = await readFile(new URL('../server/src/story-production/story-production.service.ts', import.meta.url), 'utf8');
const visuals = await readFile(new URL('../server/src/story-production/story-visual-generation.service.ts', import.meta.url), 'utf8');
const schema = await readFile(new URL('../server/prisma/schema.prisma', import.meta.url), 'utf8');

test('generated prose remains hidden until its matching artwork is ready', () => {
  assert.match(service, /deliveryState !== 'ready'/);
  assert.match(service, /title: null/);
  assert.match(service, /beats: \[\]/);
  assert.match(service, /choices: \[\]/);
  assert.match(page, /scene\?\.deliveryState === "artwork_pending"/);
  assert.match(page, /data-story-paired-retry/);
  assert.match(page, /ensurePairedSceneVisual/);
  assert.match(page, /state\.pairedVisualStatus = "idle";\s*state\.pairedVisualStartedAt = Date\.now\(\)/);
  assert.doesNotMatch(page, /scene\?\.deliveryState === "artwork_unavailable" \? "failed"/);
  assert.match(page, /state\.pairedVisualTransportFailures \+= 1/);
  assert.match(page, /loadScene\(\{ restorePending: false \}\)/);
  assert.match(css, /\.story-paired-delivery-panel/);
});

test('participant identity creates an isolated visual variant and reference-image edit request', () => {
  assert.match(schema, /variantKey\s+String\s+@default\("default"\)/);
  assert.match(schema, /@@unique\(\[workId, releaseId, sourceSceneKey, variantKey\]/);
  assert.match(visuals, /`artist:\$\{participant\.participantFingerprint\}`/);
  assert.match(visuals, /v1\/images\/edits/);
  assert.match(visuals, /form\.append\('image\[\]'/);
  assert.match(visuals, /STORY_VISUAL_REFERENCE_CHANGED/);
});

test('paired delivery copy is complete for all supported locales', () => {
  assert.equal((page.match(/pairedPreparing:/g) || []).length, 5);
  assert.equal((page.match(/pairedFailed:/g) || []).length, 5);
  assert.equal((page.match(/pairedRetry:/g) || []).length, 5);
});
