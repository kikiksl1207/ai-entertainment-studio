import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(new URL('../pages/story-stage.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles/story-stage.css', import.meta.url), 'utf8');

test('five locales carry complete AI wait and recovery copy', () => {
  for (const key of ['aiQueued', 'aiProcessing', 'aiRetryWait', 'aiLost', 'aiRecover', 'aiFailed', 'aiTimedOut', 'aiPollTimedOut', 'aiUnavailable', 'aiLegalUnavailable']) {
    assert.equal(source.match(new RegExp(`\\b${key}:`, 'g'))?.length, 5, `${key} must exist in all locales`);
  }
});

test('logical choice persists a scoped operation before one keyed POST', () => {
  const start = source.indexOf('async function submitChoice(');
  const end = source.indexOf('\n  async function submitCustomChoice', start);
  const submit = source.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.ok(submit.indexOf('saveAiOperation(pending)') < submit.indexOf('await request('));
  assert.match(submit, /idempotencyKey: requestId\("story-choice"\)/);
  assert.match(submit, /headers: \{ "Idempotency-Key": pending\.idempotencyKey \}/);
  assert.match(source, /AI_PENDING_STORAGE_PREFIX, aiSessionScope\(\), workId, operation\.progressId, operation\.choiceId, operation\.revision/);
  assert.doesNotMatch(submit.slice(submit.indexOf('const pending ='), submit.indexOf('if \(!saveAiOperation')), /token|email|input|prompt|text/i);
});

test('recovery reuses the stored key and polling is bounded and cancellable', () => {
  const start = source.indexOf('async function recoverAiOperation(');
  const end = source.indexOf('\n  async function readControls', start);
  const recovery = source.slice(start, end);
  assert.match(recovery, /headers: \{ "Idempotency-Key": operation\.idempotencyKey \}/);
  assert.doesNotMatch(recovery, /requestId\(/);
  assert.match(source, /AI_POLL_TIMEOUT_MS = 30000/);
  assert.match(source, /Math\.min\(3000, 1000 \+ attempt \* 1000\)/);
  assert.match(source, /ai-continuations\/\$\{encodeURIComponent\(operation\.continuationId\)\}/);
  assert.match(source, /generation !== state\.aiPollGeneration \|\| !currentRequest\(epoch, sessionId\)/);
  assert.match(source, /window\.addEventListener\("pagehide", cancelAiPolling\)/);
});

test('terminal and fail-closed states reload current progress without custom input', () => {
  assert.match(source, /await refreshSceneAfterAi\(status, operation\)/);
  assert.match(source, /STORY_AI_LEGAL_ACTIVATION_REQUIRED/);
  assert.match(source, /STORY_CHOICE_GENERATION_UNAVAILABLE/);
  assert.match(source, /if \(FIRST_RELEASE\) return null/);
  assert.doesNotMatch(source, /SYNTHETIC|mock generation|fake generation/i);
});

test('wait notice remains responsive at the mobile breakpoint', () => {
  assert.match(css, /\.story-ai-notice\s*\{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\) auto/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.story-ai-notice \{ grid-template-columns: auto minmax\(0, 1fr\); \}/);
  assert.match(css, /@media \(max-width: 400px\)/);
  assert.ok(repo.match(/[\\/]cloud-1879-ai-wait-ui-20260921[\\/]$/));
});
