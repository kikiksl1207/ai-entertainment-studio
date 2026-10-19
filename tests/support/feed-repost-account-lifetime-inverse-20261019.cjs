'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const changes = [
  [
    "  function clearFeedOnAccountChange() {\n    retireRepostOnAccountChange();\n",
    "  function clearFeedOnAccountChange() {\n"
  ],
  [
    "  var repostReturnFocus = null;\n  var repostLifetime = null;\n  function repostAccountKey() {\n    var auth = typeof getAuth === \"function\" ? getAuth() : null;\n    var user = auth && auth.user;\n    var id = user && (user.id || user.userId);\n    if (!auth || !auth.accessToken) return \"\";\n    if (typeof id === \"string\") return id.trim() ? id : \"\";\n    return typeof id === \"number\" && Number.isFinite(id) ? String(id) : \"\";\n  }\n  function retireRepostOnAccountChange() {\n    if (repostLifetime && repostLifetime.owner !== repostAccountKey()) closeRepostModal();\n  }\n",
    "  var repostReturnFocus = null;\n"
  ],
  [
    "  function closeRepostModal() {\n    repostLifetime = null;\n",
    "  function closeRepostModal() {\n"
  ],
  [
    "  function openRepostModal(postInfo) {\n    var backdrop = document.getElementById(\"feedRepostBackdrop\");\n    var modal = document.getElementById(\"feedRepostModal\");\n    if (!modal || !backdrop) return;\n    var owner = repostAccountKey();\n    repostLifetime = null;\n    if (!owner) {\n      closeRepostModal();\n      return;\n    }\n",
    "  function openRepostModal(postInfo) {\n    var backdrop = document.getElementById(\"feedRepostBackdrop\");\n    var modal = document.getElementById(\"feedRepostModal\");\n    if (!modal || !backdrop) return;\n"
  ],
  [
    "    modal.dataset.busy = \"0\";\n    repostLifetime = { owner: owner };\n    modal.hidden = false;\n",
    "    modal.dataset.busy = \"0\";\n    modal.hidden = false;\n"
  ],
  [
    "  async function submitRepost() {\n    var modal = document.getElementById(\"feedRepostModal\");\n    if (!modal) return;\n    var lifetime = repostLifetime;\n    if (!lifetime || lifetime.owner !== repostAccountKey()) {\n      closeRepostModal();\n      return;\n    }\n    if (modal.dataset.busy === \"1\") return;\n",
    "  async function submitRepost() {\n    var modal = document.getElementById(\"feedRepostModal\");\n    if (!modal || modal.dataset.busy === \"1\") return;\n"
  ],
  [
    "      return lifetime === repostLifetime && lifetime.owner === repostAccountKey() &&\n        !!ta && !modal.hidden && modal.querySelector(\"[data-feed-repost-input]\") === ta;\n",
    "      return !!ta && !modal.hidden && modal.querySelector(\"[data-feed-repost-input]\") === ta;\n"
  ]
];

function feedWithoutRepostAccountLifetimeDelta(source) {
  if (typeof source !== 'string') throw new TypeError('REPOST_ACCOUNT_INVERSE_STRING_REQUIRED');
  const lf = source.replace(/\r\n/g, '\n'), crlf = source.includes('\r\n');
  if (lf.startsWith('\uFEFF') || lf.includes('\r') ||
      (crlf && source !== lf.replace(/\n/g, '\r\n')) ||
      Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const bytes = Buffer.from(lf, 'utf8'), actualSha = sha(bytes), actualBlob = blob(bytes);
  const expectedSha = '4f026d788f7e1dfeae1fe36df495070d78a85540830325484094c14b66dac91b';
  const expectedBlob = 'c26788917d62a5517190764ca8fa74269be25f25';
  if (actualSha !== expectedSha && actualBlob !== expectedBlob) return source;
  assert(bytes.length === 141110 && actualSha === expectedSha && actualBlob === expectedBlob,
    'Exact whole repost account source SHA/blob/length required');
  let restored = lf;
  for (const [current, previous] of changes) {
    assert.equal(restored.split(current).length, 2, 'One exact owned repost source span');
    restored = restored.replace(current, previous);
  }
  const previousBytes = Buffer.from(restored, 'utf8');
  assert.equal(previousBytes.length, 140113);
  assert.equal(sha(previousBytes), '29537a1f381992c63ffd6b1c40255d1466918a1a287dcf5cf2fdc16c27b0d1e4');
  assert.equal(blob(previousBytes), '4698f985e99ee52f0a630984cdf51f75c36c7f3a');
  let forwarded = restored;
  for (const [current, previous] of [...changes].reverse()) {
    assert.equal(forwarded.split(previous).length, 2, 'One exact prior repost source span');
    forwarded = forwarded.replace(previous, current);
  }
  assert.equal(forwarded, lf, 'Exact whole repost account source forward');
  return crlf ? restored.replace(/\n/g, '\r\n') : restored;
}

module.exports = Object.freeze({ feedWithoutRepostAccountLifetimeDelta });
