import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../pages/creator-body-trial.js', import.meta.url), 'utf8');
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-${String(n).padStart(12, '0')}`;
const target = { workId: id(1) };
function library(now) {
  const forbid = () => { throw new Error('No network or storage during parser checks'); };
  const window = { fetch: forbid, localStorage: { getItem: forbid, setItem: forbid }, setTimeout: forbid };
  const context = createContext({ window, TextEncoder, AbortController,
    ...(now === undefined ? {} : { Date: class extends Date { static now() { return now; } } }) });
  runInContext(source, context); return window.LuminaCreatorBodyTrial;
}
function held() {
  return { contract: 'story-author-body-trial-state-v1', workId: target.workId, readOnly: true,
    generationAuthorized: false, currentAuthorizationVerified: false, imageGenerationStarted: false,
    state: 'approval_recorded_with_provisional_hold', approval: { id: id(2), expiresAt: '2099-12-31T23:59:59.000Z' },
    nextMaximumCostKrw: '300.000000', nextCostQuoteState: 'prepared', nextCostQuoteReason: null,
    budget: { requestCount: 2, pendingCount: 0, unknownCostCount: 1, verifiedSharedReuseCount: 0,
      knownActualCostKrw: '228.132000', reservedMaximumCostKrw: '0.000000', committedCostKrw: '228.132000',
      approvedBudgetKrw: '10000.000000', remainingBudgetKrw: null, evidenceReadyForBudgetCheck: false,
      costScope: 'approved_historical_unknown_separation', historicalUnknownCostCount: 2,
      provisionalHeldAmountKrw: '300.000000', provisionalHeldCount: 1, unresolvedUnheldCount: 0,
      budgetCommittedIncludingHoldsKrw: '528.132000', remainingBudgetIncludingHoldsKrw: '9471.868000',
      provisionalHoldExpiresAt: '2099-12-31T23:59:59.000Z',
      budgetCheckPassed: true, holdIsProviderCharge: false, holdIsGuaranteedLiabilityCeiling: false } };
}
test('held state preserves unknown/null rather than reporting a settled balance or a dispatch grant', () => {
  const parsed = library().parseState(held(), target);
  assert.equal(parsed.state, 'approval_recorded_with_provisional_hold');
  assert.equal(parsed.budget.remainingBudgetKrw, null);
  assert.equal(parsed.budget.unknownCostCount, 1);
  assert.equal(parsed.budget.historicalUnknownCostCount, 2);
  assert.equal(parsed.budget.evidenceReadyForBudgetCheck, false);
  assert.equal(parsed.nextMaximumCostKrw, '300.000000');
  assert.equal(parsed.generationAuthorized, false);
});
for (const [key, value] of [
  ['provisionalHeldAmountKrw', '300.000001'], ['provisionalHeldAmountKrw', '0.000000'],
  ['provisionalHeldCount', 2], ['unknownCostCount', 0], ['unresolvedUnheldCount', 1],
  ['remainingBudgetKrw', '9471.868000'], ['remainingBudgetIncludingHoldsKrw', '9471.868001'],
  ['budgetCommittedIncludingHoldsKrw', '228.132000'], ['evidenceReadyForBudgetCheck', true],
  ['holdIsProviderCharge', true], ['holdIsGuaranteedLiabilityCeiling', true], ['budgetCheckPassed', false],
]) test(`rejects a contradictory provisional response field: ${key}/${String(value)}`, () => {
  const state = held(); state.budget[key] = value;
  assert.throws(() => library().parseState(state, target));
});
for (const key of ['provisionalHeldAmountKrw', 'provisionalHeldCount', 'unresolvedUnheldCount',
  'remainingBudgetIncludingHoldsKrw', 'provisionalHoldExpiresAt', 'holdIsProviderCharge']) test(`does not accept a partial hold response: ${key}`, () => {
  const state = held(); delete state.budget[key]; assert.throws(() => library().parseState(state, target));
});
test('a quote above held remaining is withheld using exact micro-won arithmetic', () => {
  const state = held(); state.nextMaximumCostKrw = '9471.868001';
  const parsed = library().parseState(state, target);
  assert.equal(parsed.nextCostQuoteState, 'withheld'); assert.equal(parsed.nextCostQuoteReason, 'next_cost_exceeds_remaining');
});
test('a quote at held remaining stays prepared without authorizing generation', () => {
  const state = held(); state.nextMaximumCostKrw = '9471.868000';
  const parsed = library().parseState(state, target);
  assert.equal(parsed.nextCostQuoteState, 'prepared'); assert.equal(parsed.generationAuthorized, false);
});
test('expiration in transit withholds the quote without discarding the unknown-cost record', () => {
  const state = held(); state.approval.expiresAt = '2000-01-01T00:00:00.000Z';
  state.budget.provisionalHoldExpiresAt = state.approval.expiresAt;
  const parsed = library().parseState(state, target);
  assert.equal(parsed.nextCostQuoteReason, 'approval_expired'); assert.equal(parsed.budget.unknownCostCount, 1);
});
test('expires the cached quote at the shorter hold deadline, retaining the original approval deadline', () => {
  const state = held(), start = Date.parse('2099-12-31T23:58:00.000Z');
  state.budget.provisionalHoldExpiresAt = '2099-12-31T23:58:10.000Z';
  assert.equal(library(start).parseState(state, target).nextCostQuoteState, 'prepared');
  const parsed = library(start + 10000).parseState(state, target);
  assert.equal(parsed.nextCostQuoteReason, 'approval_expired');
  assert.equal(parsed.approval.expiresAt, state.approval.expiresAt);
  assert.equal(parsed.budget.unknownCostCount, 1);
});
for (const expiresAt of ['2099-12-31', '2100-01-01T00:00:00.000Z', null]) test(`rejects malformed or extended hold deadline: ${String(expiresAt)}`, () => {
  const state = held(); state.budget.provisionalHoldExpiresAt = expiresAt;
  assert.throws(() => library().parseState(state, target));
});
test('a second unknown remains unheld, keeping the next quote blocked', () => {
  const state = held(); state.state = 'cost_unknown'; state.budget.requestCount = 3; state.budget.unknownCostCount = 2;
  state.budget.unresolvedUnheldCount = 1; state.budget.budgetCheckPassed = false;
  const parsed = library().parseState(state, target);
  assert.equal(parsed.nextCostQuoteReason, 'cost_unknown'); assert.equal(parsed.budget.unresolvedUnheldCount, 1);
});
for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) test(`has separate financial-state labels in ${locale}`, () => {
  const words = library().copy[locale];
  for (const key of ['provisionalHold', 'provisionalRemaining', 'approval_recorded_with_provisional_hold']) {
    assert.equal(typeof words[key], 'string'); assert.ok(words[key].length > 0);
  }
  assert.notEqual(words.provisionalHold, words.committed);
});
