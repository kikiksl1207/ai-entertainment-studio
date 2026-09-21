import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(new URL('../pages/story-stage.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles/story-stage.css', import.meta.url), 'utf8');

test('five locales carry complete AI wait and recovery copy', () => {
  for (const key of ['aiQueued', 'aiProcessing', 'aiRetryWait', 'aiLost', 'aiRecover', 'aiFailed', 'aiTimedOut', 'aiPollTimedOut', 'aiUnavailable', 'aiLegalUnavailable', 'aiAuthRequired', 'aiAccessRequired', 'aiSharedPending']) {
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
  assert.match(source, /Math\.min\(3000, 1000 \+ attempt \* 1000, deadlineAt - Date\.now\(\)\)/);
  assert.match(source, /ai-continuations\/\$\{encodeURIComponent\(operation\.continuationId\)\}/);
  assert.match(source, /generation !== state\.aiPollGeneration \|\| !currentRequest\(epoch, sessionId\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /state\.aiPollController\?\.abort\(\)/);
  assert.match(source, /const deadlineAt = Date\.now\(\) \+ AI_POLL_TIMEOUT_MS/);
  assert.match(source, /window\.addEventListener\("pagehide", cancelAiPolling\)/);
});

test('completed receipts set the revision floor and scoped storage cleanup isolates corrupt entries', () => {
  const receiptStart = source.indexOf('async function handleAiReceipt(');
  const receiptEnd = source.indexOf('\n  async function pollAiContinuation', receiptStart);
  const receipt = source.slice(receiptStart, receiptEnd);
  assert.match(receipt, /state\.minimumRevision = Math\.max\(state\.minimumRevision, operation\.revisionAfterRequest \|\| operation\.revision \+ 1\)/);
  assert.match(source, /const keys = Array\.from\(\{ length: sessionStorage\.length \}/);
  assert.match(source, /catch \(_\) \{\s*sessionStorage\.removeItem\(key\);\s*\}/);
  assert.match(source, /return matches\.sort\(\(left, right\) => right\.createdAt - left\.createdAt\)\[0\] \|\| null/);
  assert.match(source, /decodeURIComponent\(encodedRevision \|\| ""\) === String\(operation\.revision\)/);
});

test('terminal poll auth states remain unresolved and block new choices', () => {
  assert.match(source, /"poll-timeout", "auth", "access"/);
  assert.match(source, /setAiNotice\(error\.status === 401 \? "auth" : "access", operation\)/);
  assert.match(source, /\["lost", "poll-timeout", "auth", "access", "shared-pending"\]/);
  assert.match(source, /errorCode\(error\) !== "STORY_AI_SHARED_RESULT_PENDING"/);
  assert.match(source, /operation\.status = "shared_pending"/);
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
