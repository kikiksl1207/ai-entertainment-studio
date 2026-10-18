'use strict';
const assert = require('node:assert/strict');
const { readFileSync, realpathSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const root = path.resolve(process.env.CREATOR_PAYOUT_STATUS_SOURCE_ROOT || path.join(__dirname, '..'));
const profile = process.env.CREATOR_PAYOUT_STATUS_PROFILE || 'current';
assert(['baseline', 'current'].includes(profile));
assert(!/[\\/]story-completion-20261003(?:[\\/]|$)/i.test(realpathSync.native(root)));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const OLD_CSS = 'f045903a3d4eacdf211b99ff64407b41a1bbd5d835e703584eb822461be7a1dc';
const OLD_HTML = '437da1c731b3387da0965f5d32a183644c6c31a7b9ef37ca3661ef05928b6649';
const NEW_CSS = 'ef37609791ed0594f94e061613f9007c9d9740e7ebc9a2fda9a749bc1af356df';
const NEW_HTML = '592d4c36d3f7503759d1c3e910c00054efb9027461f5e61ff9f7e0c0db34277a';
function source(file, expected) {
  const bytes = readFileSync(path.join(root, file));
  assert(bytes.length > 0 && bytes.length <= 1024 * 1024);
  const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert(!value.startsWith('\uFEFF')); assert(Buffer.from(value).equals(bytes));
  const lf = value.replace(/\r\n/g, '\n'); assert(!lf.includes('\r'));
  if (value.includes('\r\n')) assert(!value.replace(/\r\n/g, '').includes('\n'), 'Mixed checkout line endings rejected');
  assert.equal(hash(lf), expected); return lf;
}
const css = source('styles/creator-studio.css', profile === 'current' ? NEW_CSS : OLD_CSS);
const html = source('creator-studio/index.html', profile === 'current' ? NEW_HTML : OLD_HTML);
const addition = '/* Renderer status remains visible after the sample class is retired. */\n' +
  '#studioPayoutBreakdown[data-payout-state="estimate"] .payout-sample-badge,\n' +
  '#studioPayoutBreakdown[data-payout-state="loading"] .payout-sample-badge,\n' +
  '#studioPayoutBreakdown[data-payout-state="unavailable"] .payout-sample-badge {\n' +
  '  display: inline-block;\n}\n' +
  '#studioPayoutBreakdown[data-payout-state="estimate"] .payout-sample-note,\n' +
  '#studioPayoutBreakdown[data-payout-state="loading"] .payout-sample-note,\n' +
  '#studioPayoutBreakdown[data-payout-state="unavailable"] .payout-sample-note {\n' +
  '  display: block;\n}\n\n';
test('CREATOR.PAYOUT.STATUS.01 explicit status-only CSS delta preserves complete original styles and HTML', () => {
  assert.equal(css.split(addition).length, 2, 'PAYOUT_STATUS_VISIBLE_RULES: actual CSS lacks the exact scoped state rules');
  assert.equal(hash(css.replace(addition, '')), OLD_CSS, 'All other CSS bytes and legacy sample rules remain exact');
  const current = '/styles/creator-studio.css?v=payout-status-visibility-20261015';
  const before = '/styles/creator-studio.css?v=writer-final-20261001';
  assert.equal(html.split(current).length, 2);
  const submitEntry = '/pages/creator-studio.js?v=settlement-submit-outcome-20261016-v1';
  const previousEntry = '/pages/creator-studio.js?v=creator-payout-current-20261015';
  assert.equal(html.split(submitEntry).length, 2);
  const appSource = '/app.js?v=wallet-session-20261011';
  const appQuery = '&amp;content=6089683740bfbc19b3f85e1754169acf5c7576d6b851d4ed38314c423d2ea47c';
  assert.equal(html.split(appSource + appQuery).length, 2, 'Unique declared app source');
  assert.equal(html.split(appQuery).length, 2, 'Only one declared app hash query');
  const deliveryInverse = html.replace(appSource + appQuery, appSource);
  assert.equal(hash(deliveryInverse), '8c72858fb4de25647f3dd53502c35ef763997c833f55b8e08c08c5ef0267e9af',
    'Removing only the declared app hash query restores the complete prior HTML');
  assert.equal(hash(deliveryInverse.replace(submitEntry, previousEntry).replace(current, before)), OLD_HTML,
    'Only the declared submit entry and original stylesheet cache deltas are present');
  for (const id of ['studioPayoutBreakdown', 'studioPayoutSampleBadge', 'studioPayoutSampleNote',
    'studioPayoutGrossLumina', 'studioPayoutEligibleLumina', 'studioPayoutGrossKrw', 'studioPayoutTaxKrw', 'studioPayoutNetKrw']) {
    assert.equal(html.split('id="' + id + '"').length, 2);
  }
  assert.equal(html.split('/pages/creator-studio.js?v=settlement-submit-outcome-20261016-v1').length, 2);
});
