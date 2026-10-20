'use strict';
const assert = require('node:assert/strict');
const { readFileSync, realpathSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const { htmlWithoutNaverStateAppCacheDelta: cancelCompatOldProjection } = require('./support/feed-search-locale-html-inverse-20261015.cjs');
const cancelCompatFs = require('node:fs');
const cancelCompatPath = require('node:path');
const { createHash: cancelCompatCreateHash } = require('node:crypto');
const { after: cancelCompatAfter } = require('node:test');

const cancelCompatRequire = require;
const cancelCompatSelf = __filename;
function cancelCompatIdentity(raw) {
  return { bytes: raw.length,
    sha256: cancelCompatCreateHash('sha256').update(raw).digest('hex'),
    blob: cancelCompatCreateHash('sha1').update('blob ' + raw.length + '\0').update(raw).digest('hex') };
}
function cancelCompatMatches(raw, expected) {
  const value = cancelCompatIdentity(raw);
  return value.bytes === expected.bytes && value.sha256 === expected.sha256 && value.blob === expected.blob;
}
const cancelCompatHelperProfiles = [
  { bytes: 2382, sha256: '7a181fceda5853dd17dd3fbe604cd32d4098e629428771af5d2ab4cc381984c6',
    blob: '9dfc855aca5dbc50ebdac3e8f6a92b928174c4bc' },
  { bytes: 2435, sha256: 'ae2697cd3411c2b65e50263fd1e1c8ded29234ec2b1598cbd1dd697ecebf4061',
    blob: '7a61ba03a275323a36722fb5094e992d36abf8b7' },
];
const cancelCompatEntryProfiles = [
  { bytes: 62719, sha256: '41a27d40735a83e98d5a6977df20082748a3fa81e72fd3528c8240088cb6ef6a',
    blob: '1a20a15b1f0814d722b97bb1abc12f32411c4e58' },
  { bytes: 63523, sha256: '77123c64ff7c6ce94bf36868fcea6f8d2fa2e2e5451a36a7683aab2e6b5c131d',
    blob: '10286286828722a4e8e6293dd77c75849e316992' },
];
const cancelCompatBeforeProfiles = [
  { bytes: 62703, sha256: '03764953dfd8fbb359f185051070f6adf0a50e84c0f6071580abff52e133a5b8',
    blob: '7211a8d47738a397d0453d5708a68e4e3a9682a1' },
  { bytes: 63507, sha256: 'd43cb981b40be46c548cc10a51a3b544281134207400d1c0110b024616447be4',
    blob: 'e58b4deb1d87c84006f6c811c22046e109d5c1c5' },
];
const cancelCompatTracked = new Map();
function cancelCompatRead(file, sizes) {
  const stat = cancelCompatFs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), 'ordinary cancel compatibility input');
  assert(stat.size > 0 && stat.size <= 128 * 1024, 'cancel input cap before allocation');
  if (sizes) assert(sizes.includes(stat.size), 'exact cancel input size before allocation');
  assert.equal(cancelCompatFs.realpathSync.native(file).toLowerCase(),
    cancelCompatPath.resolve(file).toLowerCase(), 'no cancel input path redirection');
  const raw = cancelCompatFs.readFileSync(file);
  assert.equal(raw.length, stat.size, 'cancel input length remains stable');
  return raw;
}
function cancelCompatText(raw) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  assert(Buffer.from(text, 'utf8').equals(raw), 'cancel input exact UTF8');
  assert.notEqual(text.charCodeAt(0), 0xFEFF, 'cancel input no BOM');
  const lf = text.replace(/\r\n/g, '\n');
  assert(!lf.includes('\r') && (text === lf || text === lf.replace(/\n/g, '\r\n')),
    'cancel input LF or uniform CRLF');
  return { text, lf };
}
function cancelCompatTrack(file, raw, sizes) {
  const previous = cancelCompatTracked.get(file);
  if (previous) assert(raw.equals(previous.raw), 'cancel input unchanged between reads');
  else cancelCompatTracked.set(file, { raw, sizes });
}
const cancelCompatQPath = cancelCompatPath.join(cancelCompatPath.dirname(cancelCompatSelf),
  'support/creator-interaction-cancel-inverse-20261020.cjs');
const cancelCompatQSizes = cancelCompatHelperProfiles.map(row => row.bytes);
const cancelCompatQRaw = cancelCompatRead(cancelCompatQPath, cancelCompatQSizes);
assert(cancelCompatHelperProfiles.some(row => cancelCompatMatches(cancelCompatQRaw, row)),
  'exact whole raw cancel helper before require');
const cancelCompatQView = cancelCompatText(cancelCompatQRaw);
assert(cancelCompatMatches(Buffer.from(cancelCompatQView.lf, 'utf8'), cancelCompatHelperProfiles[0]),
  'exact whole canonical cancel helper');
cancelCompatTrack(cancelCompatQPath, cancelCompatQRaw, cancelCompatQSizes);
cancelCompatTrack(cancelCompatSelf, cancelCompatRead(cancelCompatSelf), undefined);
cancelCompatAfter(() => {
  const errors = [];
  for (const [file, row] of cancelCompatTracked) {
    try {
      const closing = cancelCompatRead(file, row.sizes);
      assert(closing.equals(row.raw), 'closing cancel compatibility raw bytes');
      assert.deepEqual(cancelCompatIdentity(closing), cancelCompatIdentity(row.raw),
        'closing cancel compatibility length/SHA/blob');
    } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'All cancel compatibility closing inputs attempted');
});
const cancelCompatQModule = cancelCompatRequire(cancelCompatQPath);
assert.deepEqual(Object.keys(cancelCompatQModule), ['restoreCreatorInteractionCancelHtml']);
assert.equal(typeof cancelCompatQModule.restoreCreatorInteractionCancelHtml, 'function');
function cancelCompatProjection(text) {
  if (typeof text !== 'string') return cancelCompatOldProjection(text);
  const raw = Buffer.from(text, 'utf8');
  const index = cancelCompatEntryProfiles.findIndex(row => cancelCompatMatches(raw, row));
  if (index === -1) return cancelCompatOldProjection(text);
  const file = cancelCompatPath.join(root, 'creator-studio/index.html');
  const sizes = cancelCompatEntryProfiles.map(row => row.bytes);
  const physical = cancelCompatRead(file, sizes);
  assert(cancelCompatMatches(physical, cancelCompatEntryProfiles[index]),
    'exact physical new entry before historical query view');
  assert(physical.equals(raw), 'projection sees the same physical new entry');
  assert.equal(cancelCompatText(physical).text, text, 'new entry physical text preserved');
  cancelCompatTrack(file, physical, sizes);
  const restored = cancelCompatQModule.restoreCreatorInteractionCancelHtml(text);
  assert.equal(typeof restored, 'string');
  assert(cancelCompatMatches(Buffer.from(restored, 'utf8'), cancelCompatBeforeProfiles[index]),
    'exact old entry after query-only view');
  const before = '/pages/creator-story-interactions.js?v=interactions-20261001';
  const after = '/pages/creator-story-interactions.js?v=interactions-cancel-20261020-6eb98ed7';
  assert.equal(restored.split(before).length, 2, 'one restored interaction query');
  assert.equal(restored.replace(before, after), text, 'whole query view forward');
  return cancelCompatOldProjection(restored);
}
const htmlWithoutNaverStateAppCacheDelta = cancelCompatProjection;
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
  let lf = value.replace(/\r\n/g, '\n'); assert(!lf.includes('\r'));
  if (value.includes('\r\n')) assert(!value.replace(/\r\n/g, '').includes('\n'), 'Mixed checkout line endings rejected');
  if (file === 'creator-studio/index.html') lf = htmlWithoutNaverStateAppCacheDelta(value).replace(/\r\n/g, '\n');
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
