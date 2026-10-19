'use strict';

const { createHash } = require('node:crypto');

const OLD_LITERAL = '7aac5b75851189fc919f26f5f64ba48c4910237a8c1f0b349a039d346b9d4b61';
const NEW_LITERAL = '848556f38941670e90cdec3dc491d387b9c00a6f369cc6aa00002c64fb1dca07';
const PROFILES = [
  {
    bytes: 20210,
    afterSha256: 'd60181988fd81ac7f7645c9e1df5e49205df0e6fb1401bfccc12d114c0ffc6aa',
    afterBlob: 'c0c36bfae35ef0558eb70d80f12ee8c9be97a63f',
    beforeSha256: 'e4e18d9bae9d2c9add41424efb1423df8ba6dd490423fa7168dd62dd96f1864d',
    beforeBlob: 'aa9fdc099927df4385f5119a527b7afcbf15fe51',
  },
  {
    bytes: 62703,
    afterSha256: '12141298f58a5bcc1441295387132a64445ab0bd755bd12216f0af89830a4ed6',
    afterBlob: 'd89d03a2fd7dad25cb5512b928ef5cded854f55f',
    beforeSha256: '07811e59dacfd174647bc4beedbc91aec27536690db2649485067547647889c9',
    beforeBlob: '6a73fc57691fb11691009cf459da3b669b86519b',
  },
  {
    bytes: 24673,
    afterSha256: 'd01c4134bd859d6314b930ae4f16f6fbc10baa565908c640ff69c4da6e30a238',
    afterBlob: '0773eec72d89b611e2bb145c9babf430f87ce35a',
    beforeSha256: '4e0b216c07b2cb1ee64d19050295b23cb546e27c9b7b3bea79872778b9a9c7d1',
    beforeBlob: 'b6f6b0841c9a440e4e00ab9eb0113992165cf112',
  },
];

function identity(source) {
  const bytes = Buffer.from(source, 'utf8');
  return {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    blob: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'),
  };
}

function substituteUnique(source, from, to) {
  const at = source.indexOf(from);
  if (at < 0 || source.indexOf(from, at + 1) !== -1) {
    throw new Error('FEED_LIKE_APP_HTML_INVERSE_LITERAL_MISMATCH');
  }
  return source.slice(0, at) + to + source.slice(at + from.length);
}

function restoreOwnedFeedLikeAppHtml(source) {
  if (typeof source !== 'string') throw new TypeError('FEED_LIKE_APP_HTML_INVERSE_STRING_REQUIRED');
  const lf = source.replace(/\r\n/g, '\n');
  const crlf = source.includes('\r\n');
  if (lf.startsWith('\uFEFF') || lf.includes('\r') ||
      (crlf && source !== lf.replace(/\n/g, '\r\n')) ||
      Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const after = identity(lf);
  const matches = PROFILES.filter(row => after.sha256 === row.afterSha256 || after.blob === row.afterBlob);
  if (matches.length === 0) return source;
  if (matches.length !== 1) throw new Error('FEED_LIKE_APP_HTML_INVERSE_AMBIGUOUS_IDENTITY');
  const row = matches[0];
  if (after.bytes !== row.bytes || after.sha256 !== row.afterSha256 || after.blob !== row.afterBlob) {
    throw new Error('FEED_LIKE_APP_HTML_INVERSE_IDENTITY_MISMATCH');
  }
  // Only the one exact content hash changes after whole-file admission.
  const restored = substituteUnique(lf, NEW_LITERAL, OLD_LITERAL);
  const before = identity(restored);
  if (before.bytes !== row.bytes || before.sha256 !== row.beforeSha256 || before.blob !== row.beforeBlob) {
    throw new Error('FEED_LIKE_APP_HTML_INVERSE_RESTORED_IDENTITY_MISMATCH');
  }
  if (substituteUnique(restored, OLD_LITERAL, NEW_LITERAL) !== lf) {
    throw new Error('FEED_LIKE_APP_HTML_INVERSE_FORWARD_MISMATCH');
  }
  return crlf ? restored.replace(/\n/g, '\r\n') : restored;
}

module.exports = { restoreOwnedFeedLikeAppHtml };
