'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const changes = [
  [
    '    modal.dataset.busy = "0";\n    modal.hidden = false;\n    backdrop.hidden = false;\n    document.body.classList.add("is-feed-repost-open");',
    '    modal.hidden = false;\n    backdrop.hidden = false;\n    document.body.classList.add("is-feed-repost-open");',
  ],
  [
    '    var submitBtn = modal.querySelector("[data-feed-repost-submit]");\n    function ownsComposer() {\n      return !!ta && !modal.hidden && modal.querySelector("[data-feed-repost-input]") === ta;\n    }\n    modal.dataset.busy = "1";',
    '    var submitBtn = modal.querySelector("[data-feed-repost-submit]");\n    modal.dataset.busy = "1";',
  ],
  [
    '      if (!ownsComposer()) return;\n      modal.dataset.busy = "0";\n      closeRepostModal();\n      if (typeof loadLuminaFeedData === "function" && typeof renderLuminaFeed === "function") {',
    '      closeRepostModal();\n      if (typeof loadLuminaFeedData === "function" && typeof renderLuminaFeed === "function") {',
  ],
  [
    '    } catch (err) {\n      if (!ownsComposer()) return;\n      console.warn("[#357 repost submit]", { status: err && err.status });',
    '    } catch (err) {\n      console.warn("[#357 repost submit]", { status: err && err.status });',
  ],
  [
    '    } finally {\n      if (ownsComposer()) modal.dataset.busy = "0";\n    }\n  }\n\n  function bindFeedCardSocialActions()',
    '    } finally {\n      modal.dataset.busy = "0";\n    }\n  }\n\n  function bindFeedCardSocialActions()',
  ],
];

function feedWithoutRepostComposerLifetimeDelta(source) {
  if (typeof source !== 'string') throw new TypeError('REPOST_COMPOSER_INVERSE_STRING_REQUIRED');
  const lf = source.replace(/\r\n/g, '\n'), crlf = source.includes('\r\n');
  if (lf.startsWith('\uFEFF') || lf.includes('\r') ||
      (crlf && source !== lf.replace(/\n/g, '\r\n')) ||
      Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const bytes = Buffer.from(lf, 'utf8'), actualSha = sha(bytes), actualBlob = blob(bytes);
  const expectedSha = '29537a1f381992c63ffd6b1c40255d1466918a1a287dcf5cf2fdc16c27b0d1e4';
  const expectedBlob = '4698f985e99ee52f0a630984cdf51f75c36c7f3a';
  if (actualSha !== expectedSha && actualBlob !== expectedBlob) return source;
  assert(bytes.length === 140113 && actualSha === expectedSha && actualBlob === expectedBlob,
    'Exact whole repost composer source SHA/blob/length required');
  let restored = lf;
  for (const [current, previous] of changes) {
    assert.equal(restored.split(current).length, 2, 'One exact owned repost source span');
    restored = restored.replace(current, previous);
  }
  const previousBytes = Buffer.from(restored, 'utf8');
  assert.equal(previousBytes.length, 139831);
  assert.equal(sha(previousBytes), 'ee7c440a7e84c54924c686b6c0016f690247f53b90ec076714ecba860b499fbe');
  assert.equal(blob(previousBytes), 'eaa0ffbbae0cd3b7b0121b0c79a92d4244bcbcb5');
  let forwarded = restored;
  for (const [current, previous] of [...changes].reverse()) {
    assert.equal(forwarded.split(previous).length, 2, 'One exact prior repost source span');
    forwarded = forwarded.replace(previous, current);
  }
  assert.equal(forwarded, lf, 'Exact whole repost composer source forward');
  return crlf ? restored.replace(/\n/g, '\r\n') : restored;
}

module.exports = Object.freeze({ feedWithoutRepostComposerLifetimeDelta });
