'use strict';

const { createHash } = require('node:crypto');

const AFTER = {
  bytes: 434541,
  sha256: '848556f38941670e90cdec3dc491d387b9c00a6f369cc6aa00002c64fb1dca07',
  blob: '15ba461156f1cd41389201b685dda668c6009414',
  functionBytes: 4115,
  functionSha256: '2e1f2b57478c5a27e35f506f6cbb67a9406a92f5fa4729b5983d67b835bef3ab',
};
const BEFORE = {
  bytes: 433479,
  sha256: '7aac5b75851189fc919f26f5f64ba48c4910237a8c1f0b349a039d346b9d4b61',
  blob: '892c0bd98d93e90f9ec257be57ba5ab7ac6cd75f',
  functionBytes: 3053,
  functionSha256: '176eaaebddf0abb19afb79a949d8770de9c4a3e10a13cbc5b7de9f71fb0f04a4',
};
const START = 347042;
const MARKER = 'function bindLuminaFeedLike() {\n';
const PORTS = [
  [
    '  document._feedLikeBound = true;\n',
    '  document._feedLikeBound = true;\n  const pending = new WeakMap();\n',
  ],
  [
    '    const wasLiked = btn.classList.contains("is-liked");',
    '    const owner = feedModalViewerKey();\n' +
    '    if (!owner) return;\n' +
    '    const flight = { current: true };\n' +
    '    const observeOwner = () => {\n' +
    '      if (owner !== feedModalViewerKey()) flight.current = false;\n' +
    '    };\n' +
    '    const observeStorage = event => {\n' +
    '      if (event.key === "lumina_auth" || event.key === null) observeOwner();\n' +
    '    };\n' +
    '    const current = () => flight.current && pending.get(btn) === flight &&\n' +
    '      owner === feedModalViewerKey() && btn.isConnected !== false;\n' +
    '    window.addEventListener("lumina:authchange", observeOwner);\n' +
    '    window.addEventListener("lumina:auth-expired", observeOwner);\n' +
    '    window.addEventListener("storage", observeStorage);\n' +
    '    pending.set(btn, flight);\n' +
    '    const wasLiked = btn.classList.contains("is-liked");',
  ],
  [
    '      });\n      // #191',
    '      });\n      if (!current()) return;\n      // #191',
  ],
  [
    '    } catch (err) {\n',
    '    } catch (err) {\n      if (!current()) return;\n',
  ],
  [
    '    } finally {\n      btn.dataset.busy = "0";\n',
    '    } finally {\n' +
    '      window.removeEventListener("lumina:authchange", observeOwner);\n' +
    '      window.removeEventListener("lumina:auth-expired", observeOwner);\n' +
    '      window.removeEventListener("storage", observeStorage);\n' +
    '      if (pending.get(btn) === flight) {\n' +
    '        pending.delete(btn);\n' +
    '        btn.dataset.busy = "0";\n' +
    '      }\n',
  ],
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
    throw new Error('FEED_LIKE_LIFETIME_INVERSE_FUNCTION_MISMATCH');
  }
  return owned;
}

function substituteUnique(source, from, to) {
  const at = source.indexOf(from);
  if (!from || at < 0 || source.indexOf(from, at + 1) !== -1) {
    throw new Error('FEED_LIKE_LIFETIME_INVERSE_SUBSTITUTION_MISMATCH');
  }
  return source.slice(0, at) + to + source.slice(at + from.length);
}

function restoreOwnedFeedLikeLifetime(source) {
  if (typeof source !== 'string') throw new TypeError('FEED_LIKE_LIFETIME_INVERSE_STRING_REQUIRED');
  const lf = source.replace(/\r\n/g, '\n');
  const crlf = source.includes('\r\n');
  if (lf.startsWith('\uFEFF') || lf.includes('\r') ||
      (crlf && source !== lf.replace(/\n/g, '\r\n')) ||
      Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const after = identity(lf);
  if (after.sha256 !== AFTER.sha256 && after.blob !== AFTER.blob) return source;
  if (after.bytes !== AFTER.bytes || after.sha256 !== AFTER.sha256 || after.blob !== AFTER.blob) {
    throw new Error('FEED_LIKE_LIFETIME_INVERSE_IDENTITY_MISMATCH');
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
    throw new Error('FEED_LIKE_LIFETIME_INVERSE_RESTORED_IDENTITY_MISMATCH');
  }
  if (ownedFunction(restored, BEFORE) !== previous) {
    throw new Error('FEED_LIKE_LIFETIME_INVERSE_RESTORED_FUNCTION_MISMATCH');
  }
  let forward = previous;
  for (const [oldText, newText] of PORTS) forward = substituteUnique(forward, oldText, newText);
  const restoredBytes = Buffer.from(restored, 'utf8');
  const rebuilt = Buffer.concat([restoredBytes.subarray(0, START), Buffer.from(forward, 'utf8'),
    restoredBytes.subarray(START + BEFORE.functionBytes)]).toString('utf8');
  if (forward !== owned || rebuilt !== lf) {
    throw new Error('FEED_LIKE_LIFETIME_INVERSE_FORWARD_MISMATCH');
  }
  return crlf ? restored.replace(/\n/g, '\r\n') : restored;
}

module.exports = { restoreOwnedFeedLikeLifetime };
