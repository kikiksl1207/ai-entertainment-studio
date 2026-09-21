import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { loadStoryServerContract } from './story-stage-server-contract.mjs';
import { verifyStoryStageSource } from '../server/scripts/verify-story-stage-no-raw-key.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(new URL('../pages/story-stage.js', import.meta.url), 'utf8');
const contract = loadStoryServerContract(repo);
const confirmation = (c) => {
  const q = c.access.access.purchaseConfirmation;
  return { confirmedPriceLumina: q.priceLumina, expectedReleaseId: q.releaseId, expectedReleaseRevision: q.releaseRevision };
};

test('purchase source: clean consent omits retry; unknown/errors and legacy ready detail retain it', () => {
  const start = source.indexOf('function detailRetryVisible(');
  const end = source.indexOf('\n  function renderPack(', start);
  assert.ok(start > 0 && end > start);
  const evaluate = (overrides = {}, operation = null) => runInNewContext(`(${source.slice(start, end)})(operation)`, {
    state: { detailStatus: 'ready', purchaseConfirming: true, purchaseNotice: '', ...overrides }, operation,
  });
  assert.equal(evaluate(), false);
  assert.equal(evaluate({}, { key: 'same-key' }), true);
  for (const purchaseNotice of ['unknown', 'failed', 'balance', 'storage', 'stale']) assert.equal(evaluate({ purchaseNotice }), true);
  for (const detailStatus of ['error', 'access-error']) assert.equal(evaluate({ detailStatus }), true);
  for (const detailStatus of ['loading', 'access-loading']) assert.equal(evaluate({ detailStatus }), false);
  assert.equal(evaluate({ purchaseConfirming: false }), true);
  assert.match(source, /detailRetryVisible\(operation\) \? `<button[^`]*data-story-detail-retry/);
});

test('purchase source: five locales are complete, raw diagnostics and raw-key fallback rejected', () => {
  const result = verifyStoryStageSource(source);
  assert.equal(result.fiveLocalePurchase, true);
  assert.equal(result.safePurchaseValues, true);
  assert.equal(result.rawKeyFallbackBlocked, true);
  assert.equal(verifyStoryStageSource(source.replace('Purchase this story for {price} LUMINA?', 'story.purchase.raw')).safePurchaseValues, false);
  assert.equal(verifyStoryStageSource(source.replace('PURCHASE_COPY.en[key] || ""', 'PURCHASE_COPY.en[key] || key')).rawKeyFallbackBlocked, false);
});

test('purchase source: persistence precedes POST and prices never use floating point conversion', () => {
  const purchase = source.slice(source.indexOf('async function purchaseStory('), source.indexOf('async function startStory('));
  assert.ok(purchase.indexOf('sessionStorage.setItem') < purchase.indexOf('await request('));
  assert.match(purchase, /signal: controller.signal/);
  assert.match(purchase, /15000/);
  assert.match(purchase, /identity === readerIdentity\(\)/);
  assert.doesNotMatch(purchase, /location\.|startStory\(/);
  assert.doesNotMatch(source, /Number\([^)]*(?:price|amountLumina)|parseFloat\(/);
});

test('purchase source contract: missing and changed confirmations cause no writes', async () => {
  const c = await contract({ free: false });
  await assert.rejects(c.purchase('key-missing'), (e) => e.getResponse().code === 'STORY_PURCHASE_CONFIRMATION_REQUIRED' && e.getResponse().walletMutation === false);
  const original = confirmation(c);
  c.changePrice('126.25');
  await assert.rejects(c.purchase('key-stale', original), (e) => e.getResponse().code === 'STORY_PURCHASE_CONFIRMATION_STALE' && e.getResponse().walletMutation === false);
  assert.deepEqual(c.writes, []);
  assert.equal((await c.readAccess()).access.purchaseConfirmation.priceLumina, '126.25');
});

test('purchase source contract: replay reports zero current debit and inactive grants never regrant', async () => {
  const c = await contract({ free: false });
  const first = await c.purchase('original-key', confirmation(c));
  assert.equal(first.chargedAmountLumina, '125.5');
  c.changePrice('987.65');
  const replay = await c.purchase('original-key');
  assert.equal(replay.chargedAmountLumina, '0');
  assert.equal(replay.originalPurchaseAmountLumina, '125.5');
  c.revoke();
  const inactive = await c.purchase('original-key');
  assert.equal(inactive.outcome, 'entitlement_inactive');
  assert.equal(inactive.entitled, false);
  assert.deepEqual(c.writes, ['wallet-debit', 'purchase-ledger', 'purchase-grant']);
});
