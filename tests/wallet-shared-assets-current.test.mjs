import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { publicationFiles } from '../scripts/build-public-site.mjs';
import cancelCompatOldModule from './support/feed-search-locale-html-inverse-20261015.cjs';
import * as cancelCompatFs from 'node:fs';
import * as cancelCompatPath from 'node:path';
import { createHash as cancelCompatCreateHash } from 'node:crypto';
import { createRequire as cancelCompatCreateRequire } from 'node:module';
import { fileURLToPath as cancelCompatFileURLToPath } from 'node:url';
import { after as cancelCompatAfter } from 'node:test';

const cancelCompatRequire = cancelCompatCreateRequire(import.meta.url);
const cancelCompatSelf = cancelCompatFileURLToPath(import.meta.url);
const cancelCompatOldProjection = cancelCompatOldModule.htmlWithoutNaverStateAppCacheDelta;
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
  const file = cancelCompatFileURLToPath(new URL('../creator-studio/index.html', import.meta.url));
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
const htmlInverse = Object.freeze({ ...cancelCompatOldModule,
  htmlWithoutNaverStateAppCacheDelta: cancelCompatProjection });

const appSource = '/app.js?v=wallet-session-20261011';
const previousAppSources = ['/app.js', '/app.js?v=studio-auth-20261001', '/app.js?v=feed-report-safety-20261001'];
// The 25 consumers are explicit SOURCE scope; other script values and their order remain pinned.
const consumers = [
  {
    "file": "index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/data/lineup.js",
      "/data/shortforms.js",
      "/data/characters.js",
      "/data/fan-engagement-copy.js",
      "/pages/shortform.js",
      "/pages/home.js",
      "/pages/fan-engagement.js?v=20261015-home-page-lifetime-v1",
      "/cms-bootstrap.js",
      "/app.js"
    ]
  },
  {
    "file": "character-chat.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/data/characters.js",
      "/data/character-chat-tones.js",
      "/cms-bootstrap.js",
      "/app.js",
      "/pages/character-chat.js?v=20261013-greeting-origin",
      "/pages/premium-chat-support.js",
      "/pages/premium-chat-hub.js"
    ]
  },
  {
    "file": "business/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/data/business-packages.js",
      "/data/characters.js",
      "/pages/business.js",
      "/app.js"
    ]
  },
  {
    "file": "character-chat/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/data/characters.js",
      "/data/character-chat-tones.js",
      "/cms-bootstrap.js",
      "/app.js",
      "/pages/character-chat.js?v=20261013-greeting-origin",
      "/pages/premium-chat-support.js",
      "/pages/premium-chat-hub.js"
    ]
  },
  {
    "file": "character-detail/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/data/characters.js",
      "/data/artist-profile-locales.js?v=20260929",
      "/pages/character-detail.js?v=public-core-20261021",
      "/cms-bootstrap.js",
      "/app.js"
    ]
  },
  {
    "file": "characters/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/data/characters.js",
      "/pages/character-catalog.js?v=artist-readiness-20260926",
      "/cms-bootstrap.js",
      "/app.js"
    ]
  },
  {
    "file": "charge/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/data/characters.js",
      "/pages/charge.js",
      "/cms-bootstrap.js",
      "/app.js"
    ]
  },
  {
    "file": "chat-rankings/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "/cms-bootstrap.js",
      "/app.js",
      "/pages/chat-rankings.js"
    ]
  },
  {
    "file": "creator-studio/index.html",
    "previousSrc": "/app.js?v=studio-auth-20261001",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/pages/creator-studio.js?v=settlement-submit-outcome-20261016-v1",
      "/data/characters.js",
      "/app.js?v=studio-auth-20261001",
      "/pages/creator-analysis-review.js",
      "/pages/creator-story-visual-references.js?v=visual-references-20260930",
      "/pages/creator-story-visual-review.js?v=visual-review-20260930",
      "/pages/creator-story-visual-booking.js?v=visual-booking-20261001",
      "/pages/creator-branch-visual-review.js?v=branch-visual-review-20261001",
      "/pages/creator-story-choice-consent-review.js?v=choice-consent-20261001",
      "/pages/creator-story-interactions.js?v=interactions-20261001",
      "/pages/creator-story-finalize.js?v=company-final-submission-20261005",
      "/pages/content-rights-contract-ui.js",
      "/pages/creator-content-rights.js",
      "/pages/creator-body-preview.js?v=body-origin-20261009",
      "/pages/creator-body-length.js?v=body-length-20261010",
      "/pages/creator-body-current-fit.js?v=20261012-read-deadline",
      "/pages/creator-approved-wire.js?v=approved-wire-20261012-v1",
      "/pages/creator-approved-section-bytes.js?v=approved-section-bytes-20261013-v1",
      "/pages/creator-body-original-reference.js?v=original-reference-20261012-deadline",
      "/pages/creator-approved-style.js?v=approved-style-20261012-read-deadline",
      "/pages/creator-body-style-reference.js?v=body-style-reference-20261010",
      "/pages/creator-body-trial.js?v=body-profile-fit-20261010",
      "/pages/creator-body-review.js?v=body-review-company-20261005",
      "/pages/creator-approved-readonly-transport.js?v=20261013-v1",
      "/pages/creator-approved-reading-handoff.js?v=20261013-v1"
    ]
  },
  {
    "file": "debut/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/data/characters.js",
      "/cms-bootstrap.js",
      "/app.js"
    ]
  },
  {
    "file": "debut-terms/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/data/characters.js",
      "/app.js"
    ]
  },
  {
    "file": "lumina-feed/index.html",
    "previousSrc": "/app.js?v=feed-report-safety-20261001",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/data/characters.js",
      "/data/shortforms.js",
      "/pages/lumina-feed.js?v=feed-search-locale-20261015",
      "/pages/feed-report.js?v=feed-report-safety-20261001",
      "/pages/premium-chat-hub.js",
      "/app.js?v=feed-report-safety-20261001",
      "/pages/feed-notifications.js?v=notification-pagehide-20261015"
    ]
  },
  {
    "file": "lumina-pick/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/data/character-messages.js",
      "/data/lineup.js",
      "/data/characters.js",
      "/pages/popular-vote.js?v=pick-archive-locale-intent-20261017",
      "/cms-bootstrap.js",
      "/app.js"
    ]
  },
  {
    "file": "mypage/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/data/characters.js",
      "/data/achievement-titles.js",
      "/pages/mypage.js",
      "/app.js",
      "/pages/mypage-titles.js?v=mypage-title-locale-20261018"
    ]
  },
  {
    "file": "ott/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "/data/characters.js",
      "/app.js",
      "/pages/ott.js?v=ott-catalog-retry-20261016"
    ]
  },
  {
    "file": "premium-chat-support/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "/app.js",
      "/pages/premium-chat-support.js"
    ]
  },
  {
    "file": "privacy/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/data/characters.js",
      "/app.js"
    ]
  },
  {
    "file": "refund-policy/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/data/characters.js",
      "/app.js"
    ]
  },
  {
    "file": "reset-password/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/app.js"
    ]
  },
  {
    "file": "shortform/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/data/shortforms.js",
      "/data/characters.js",
      "/pages/shortform.js",
      "/cms-bootstrap.js",
      "/app.js"
    ]
  },
  {
    "file": "story-stage/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "/data/characters.js",
      "/app.js",
      "/pages/story-canonical-read.js?v=story-canonical-read-20261002",
      "/pages/story-stage.js?v=story-paired-visual-current-20261011"
    ]
  },
  {
    "file": "story-upload/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "/app.js",
      "/pages/story-upload.js?v=story-final-data-only-20260711"
    ]
  },
  {
    "file": "terms/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/data/characters.js",
      "/app.js"
    ]
  },
  {
    "file": "user-profile/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/data/characters.js",
      "/pages/user-profile.js?v=public-profile-post-payload-truth-20261016",
      "/app.js"
    ]
  },
  {
    "file": "verify-email/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "https://www.googletagmanager.com/gtag/js?id=G-1L7TCBQ0N4",
      "/app.js"
    ]
  }
];
const publicHtml = [
  "404.html",
  "backstage.html",
  "backstage/index.html",
  "business.html",
  "business/index.html",
  "character-chat.html",
  "character-chat/index.html",
  "character-detail.html",
  "character-detail/index.html",
  "characters.html",
  "characters/index.html",
  "charge.html",
  "charge/index.html",
  "chat-rankings/index.html",
  "creator-studio.html",
  "creator-studio/approved-reading/index.html",
  "creator-studio/index.html",
  "debut-terms.html",
  "debut-terms/index.html",
  "debut.html",
  "debut/index.html",
  "index.html",
  "lumina-feed.html",
  "lumina-feed/index.html",
  "lumina-pick/index.html",
  "mypage.html",
  "mypage/index.html",
  "ott-private-preview/index.html",
  "ott/index.html",
  "popular-vote.html",
  "popular-vote/index.html",
  "premium-chat-hub/index.html",
  "premium-chat-support/index.html",
  "privacy.html",
  "privacy/index.html",
  "refund-policy.html",
  "refund-policy/index.html",
  "reset-password.html",
  "reset-password/index.html",
  "shortform.html",
  "shortform/index.html",
  "story-stage/index.html",
  "story-upload/index.html",
  "terms.html",
  "terms/index.html",
  "user-profile.html",
  "user-profile/index.html",
  "verify-email.html",
  "verify-email/index.html"
];
function scriptSources(html) {
  return [...html.matchAll(/<script\b[^>]*\ssrc=(?:"([^"]*)"|'([^']*)')[^>]*>/gi)].map(match => match[1] ?? match[2]);
}
const isAppSource = src => src.split(/[?#]/)[0] === '/app.js';
function assertWalletScripts(html, consumer) {
  const expectedAppSource = ['index.html', 'creator-studio/index.html', 'lumina-feed/index.html'].includes(consumer.file)
    ? appSource + '&amp;content=6089683740bfbc19b3f85e1754169acf5c7576d6b851d4ed38314c423d2ea47c'
    : consumer.file === 'ott/index.html'
    ? '/app.js?v=ott-catalog-body-deadline-20261016' : appSource;
  const scripts = scriptSources(html);
  assert.equal(scripts.filter(src => src === expectedAppSource).length, 1, consumer.file + ' exact current app once');
  assert.deepEqual(scripts.filter(isAppSource), [expectedAppSource], consumer.file + ' no alternate app source');
  for (const previous of previousAppSources) assert(!scripts.includes(previous), consumer.file + ' no previous app URL');
  assert.deepEqual(scripts.map(src => src === expectedAppSource ? consumer.previousSrc : src), consumer.beforeScripts,
    consumer.file + ' only app URL changed; every outside script and its order is unchanged');
}
function html(file) {
  if (!['index.html', 'creator-studio/index.html', 'lumina-feed/index.html'].includes(file)) {
    return readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  }
  const bytes = readFileSync(new URL('../' + file, import.meta.url));
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert(!text.startsWith('\uFEFF'), file + ' no source BOM');
  assert(Buffer.from(text).equals(bytes), file + ' exact physical UTF8');
  const lf = text.replace(/\r\n/g, '\n');
  assert(!lf.includes('\r') && (text === lf || text === lf.replace(/\n/g, '\r\n')), file + ' uniform physical EOL');
  return htmlInverse.htmlWithoutNaverStateAppCacheDelta(text);
}

test('wallet cache consumer scope is exactly the explicit25 within manifest HTML49', () => {
  const manifest = JSON.parse(readFileSync(new URL('../scripts/public-site-manifest.json', import.meta.url), 'utf8'));
  const files = publicationFiles(manifest).filter(file => file.endsWith('.html'));
  assert.equal(files.length, 49);
  assert.deepEqual(files, publicHtml);
  assert.equal(consumers.length, 25);
  assert.equal(new Set(consumers.map(row => row.file)).size, 25);
  const expected = consumers.map(row => row.file).sort();
  assert(expected.every(file => files.includes(file)));
  assert.deepEqual(files.filter(file => scriptSources(html(file)).some(isAppSource)), expected);
});

for (const consumer of consumers) test('wallet shared cache URL and outside scripts: ' + consumer.file, () => {
  assertWalletScripts(html(consumer.file), consumer);
});


test('approved reading is outside wallet consumers with explicit connection and readonly scripts', () => {
  const file = 'creator-studio/approved-reading/index.html';
  assert(!consumers.some(row => row.file === file));
  assert.deepEqual(scriptSources(html(file)), [
    '/pages/creator-approved-readonly-transport.js?v=20261020-explicit-v1',
    '/pages/creator-approved-reading-handoff.js?v=20261013-v1',
    '/pages/creator-approved-reading-catalog.js?v=20261015-auth-reason-v1',
    '/pages/creator-approved-auth-connection.js?v=20261023-refresh-domain-v1',
    '/pages/creator-approved-reading-entry.js?v=20261022-idle-status-v1',
    '/pages/creator-approved-section-bytes.js?v=approved-section-bytes-20261013-v1',
    '/pages/creator-body-preview.js?v=author-body-preview-20261002-v1',
    '/pages/creator-approved-reading-body.js?v=20261013-body-v1',
  ]);
  assert(!scriptSources(html(file)).some(isAppSource));
});
