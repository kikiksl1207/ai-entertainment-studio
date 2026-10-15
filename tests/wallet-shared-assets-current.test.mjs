import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { publicationFiles } from '../scripts/build-public-site.mjs';

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
      "/pages/fan-engagement.js?v=20261013-home-mission-deadline-v1",
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
      "/pages/character-detail.js?v=portrait-current-20261011",
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
      "/pages/creator-studio.js?v=creator-trial-cache-20261002",
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
      "/pages/lumina-feed.js?v=feed-search-owner-20261009-deadline-20261011",
      "/pages/feed-report.js?v=feed-report-safety-20261001",
      "/pages/premium-chat-hub.js",
      "/app.js?v=feed-report-safety-20261001",
      "/pages/feed-notifications.js?v=notification-read-20261008"
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
      "/pages/popular-vote.js?v=pick-response-scope-20261001",
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
      "/pages/mypage-titles.js"
    ]
  },
  {
    "file": "ott/index.html",
    "previousSrc": "/app.js",
    "beforeScripts": [
      "/data/characters.js",
      "/app.js",
      "/pages/ott.js?v=ott-clip-seek-20261015"
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
      "/pages/user-profile.js",
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
  const scripts = scriptSources(html);
  assert.equal(scripts.filter(src => src === appSource).length, 1, consumer.file + ' exact current app once');
  assert.deepEqual(scripts.filter(isAppSource), [appSource], consumer.file + ' no alternate app source');
  for (const previous of previousAppSources) assert(!scripts.includes(previous), consumer.file + ' no previous app URL');
  assert.deepEqual(scripts.map(src => src === appSource ? consumer.previousSrc : src), consumer.beforeScripts,
    consumer.file + ' only app URL changed; every outside script and its order is unchanged');
}
function html(file) { return readFileSync(new URL('../' + file, import.meta.url), 'utf8'); }

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


test('approved reading is outside wallet consumers with only the explicit readonly scripts', () => {
  const file = 'creator-studio/approved-reading/index.html';
  assert(!consumers.some(row => row.file === file));
  assert.deepEqual(scriptSources(html(file)), [
    '/pages/creator-approved-readonly-transport.js?v=20261015-read-receipt-v1',
    '/pages/creator-approved-reading-handoff.js?v=20261013-v1',
    '/pages/creator-approved-reading-catalog.js?v=20261015-read-receipt-v1',
    '/pages/creator-approved-reading-entry.js?v=20261015-read-receipt-v1',
    '/pages/creator-approved-section-bytes.js?v=approved-section-bytes-20261013-v1',
    '/pages/creator-body-preview.js?v=author-body-preview-20261002-v1',
    '/pages/creator-approved-reading-body.js?v=20261013-body-v1',
  ]);
  assert(!scriptSources(html(file)).some(isAppSource));
});
