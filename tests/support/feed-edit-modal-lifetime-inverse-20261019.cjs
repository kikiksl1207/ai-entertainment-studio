'use strict';

const { createHash } = require('node:crypto');

const AFTER = {
  bytes: 434800,
  sha256: '4730707c2fae82363401f6f11dc5dc3daa68b9bb88b151ffdcec37e65c5e73ff',
  blob: 'b83bdd503d1ad80c11cc7724a3e6f3ee2bb268d2',
  functionBytes: 3339,
  functionSha256: 'c1091b68db869cdef05b562de2ebb7fc0c64970509af292080bd7c0ead5623da',
};
const BEFORE = {
  bytes: 434541,
  sha256: '848556f38941670e90cdec3dc491d387b9c00a6f369cc6aa00002c64fb1dca07',
  blob: '15ba461156f1cd41389201b685dda668c6009414',
  functionBytes: 3080,
  functionSha256: '85495252e466b9ab05e53263063bfde10cb086a8cb5c60f1cf26de207a47331e',
};
const START = 335323;
const MARKER = 'function bindLuminaFeedEdit() {\n';
const PORTS = [
  [
    "    const textarea = _feedEditModalEl.querySelector(\"textarea\");\n    const errorEl = _feedEditModalEl.querySelector(\".feed-edit-modal-error\");",
    "    const modal = _feedEditModalEl;\n    const current = () => modal === _feedEditModalEl &&\n      modal.querySelector(\"[data-feed-edit-save]\") === saveBtn && saveBtn.dataset.postId === postId;\n    if (!current()) return;\n    const textarea = modal.querySelector(\"textarea\");\n    const errorEl = modal.querySelector(\".feed-edit-modal-error\");"
  ],
  [
    "        body: { body: newBody }\n      });\n      const updatedPost",
    "        body: { body: newBody }\n      });\n      if (!current()) return;\n      const updatedPost"
  ],
  [
    "    } catch (err) {\n      console.warn(\"[#137 edit] 실패\",",
    "    } catch (err) {\n      if (!current()) return;\n      console.warn(\"[#137 edit] 실패\","
  ]
];

function identity(source) {
  const bytes = Buffer.from(source, 'utf8');
  return {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    blob: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'),
  };
}

function ownedFunction(source, profile) {
  const bytes = Buffer.from(source, 'utf8');
  const at = bytes.indexOf(MARKER);
  const owned = bytes.subarray(START, START + profile.functionBytes).toString('utf8');
  const pin = identity(owned);
  if (at !== START || bytes.indexOf(MARKER, at + 1) !== -1 ||
      !owned.startsWith(MARKER) || !owned.endsWith('\n}\n') ||
      pin.bytes !== profile.functionBytes || pin.sha256 !== profile.functionSha256) {
    throw new Error('FEED_EDIT_MODAL_LIFETIME_INVERSE_FUNCTION_MISMATCH');
  }
  return owned;
}

function substituteUnique(source, from, to) {
  const at = source.indexOf(from);
  if (!from || at < 0 || source.indexOf(from, at + 1) !== -1) {
    throw new Error('FEED_EDIT_MODAL_LIFETIME_INVERSE_SUBSTITUTION_MISMATCH');
  }
  return source.slice(0, at) + to + source.slice(at + from.length);
}

function restoreOwnedFeedEditModalLifetime(source) {
  if (typeof source !== 'string') throw new TypeError('FEED_EDIT_MODAL_LIFETIME_INVERSE_STRING_REQUIRED');
  const lf = source.replace(/\r\n/g, '\n');
  const crlf = source.includes('\r\n');
  if (lf.startsWith('\uFEFF') || lf.includes('\r') ||
      (crlf && source !== lf.replace(/\n/g, '\r\n')) ||
      Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const after = identity(lf);
  if (after.sha256 !== AFTER.sha256 && after.blob !== AFTER.blob) return source;
  if (after.bytes !== AFTER.bytes || after.sha256 !== AFTER.sha256 || after.blob !== AFTER.blob) {
    throw new Error('FEED_EDIT_MODAL_LIFETIME_INVERSE_IDENTITY_MISMATCH');
  }

  const owned = ownedFunction(lf, AFTER);
  let previous = owned;
  for (let i = PORTS.length - 1; i >= 0; i--) {
    previous = substituteUnique(previous, PORTS[i][1], PORTS[i][0]);
  }
  // All substitutions are confined to the admitted binder; keep other bytes intact.
  const bytes = Buffer.from(lf, 'utf8');
  const restored = Buffer.concat([bytes.subarray(0, START), Buffer.from(previous, 'utf8'),
    bytes.subarray(START + AFTER.functionBytes)]).toString('utf8');
  const before = identity(restored);
  if (before.bytes !== BEFORE.bytes || before.sha256 !== BEFORE.sha256 || before.blob !== BEFORE.blob) {
    throw new Error('FEED_EDIT_MODAL_LIFETIME_INVERSE_RESTORED_IDENTITY_MISMATCH');
  }
  if (ownedFunction(restored, BEFORE) !== previous) {
    throw new Error('FEED_EDIT_MODAL_LIFETIME_INVERSE_RESTORED_FUNCTION_MISMATCH');
  }
  let forward = previous;
  for (const [oldText, newText] of PORTS) forward = substituteUnique(forward, oldText, newText);
  const restoredBytes = Buffer.from(restored, 'utf8');
  const rebuilt = Buffer.concat([restoredBytes.subarray(0, START), Buffer.from(forward, 'utf8'),
    restoredBytes.subarray(START + BEFORE.functionBytes)]).toString('utf8');
  if (forward !== owned || rebuilt !== lf) {
    throw new Error('FEED_EDIT_MODAL_LIFETIME_INVERSE_FORWARD_MISMATCH');
  }
  return crlf ? restored.replace(/\n/g, '\r\n') : restored;
}

module.exports = { restoreOwnedFeedEditModalLifetime };
