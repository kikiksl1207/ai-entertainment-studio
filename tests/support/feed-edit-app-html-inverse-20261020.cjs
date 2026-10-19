'use strict';

const { createHash } = require('node:crypto');

const OLD_LITERAL = '848556f38941670e90cdec3dc491d387b9c00a6f369cc6aa00002c64fb1dca07';
const NEW_LITERAL = '4730707c2fae82363401f6f11dc5dc3daa68b9bb88b151ffdcec37e65c5e73ff';
const PROFILES = [
  {
    bytes: 20210,
    afterSha256: '7b44ebef67fe443952c956f202d1caf70c52ed0fcf414368bd81a45fc9634b13',
    afterBlob: '1b6fa9bea72d812a4fa8114617022562ee78e1bb',
    beforeSha256: 'd60181988fd81ac7f7645c9e1df5e49205df0e6fb1401bfccc12d114c0ffc6aa',
    beforeBlob: 'c0c36bfae35ef0558eb70d80f12ee8c9be97a63f',
  },
  {
    bytes: 62703,
    afterSha256: '2d2d45c97fc20e33489e43a189211748beb6af7ffaf8080a8fcb28d12acd2543',
    afterBlob: '066cae438ba07f5f9abac3f84d456568f0fb3fb8',
    beforeSha256: '12141298f58a5bcc1441295387132a64445ab0bd755bd12216f0af89830a4ed6',
    beforeBlob: 'd89d03a2fd7dad25cb5512b928ef5cded854f55f',
  },
  {
    bytes: 24673,
    afterSha256: 'de3458eb06217b8eac86faab4e6d6325c90ddeff957b2ee35015edda187bb635',
    afterBlob: '50101004cccc3ccc9d73c65f9385834d6febb87f',
    beforeSha256: 'd01c4134bd859d6314b930ae4f16f6fbc10baa565908c640ff69c4da6e30a238',
    beforeBlob: '0773eec72d89b611e2bb145c9babf430f87ce35a',
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
    throw new Error('FEED_EDIT_APP_HTML_INVERSE_LITERAL_MISMATCH');
  }
  return source.slice(0, at) + to + source.slice(at + from.length);
}

function restoreOwnedFeedEditAppHtml(source) {
  if (typeof source !== 'string') throw new TypeError('FEED_EDIT_APP_HTML_INVERSE_STRING_REQUIRED');
  const lf = source.replace(/\r\n/g, '\n');
  const crlf = source.includes('\r\n');
  if (lf.startsWith('\uFEFF') || lf.includes('\r') ||
      (crlf && source !== lf.replace(/\n/g, '\r\n')) ||
      Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const after = identity(lf);
  const matches = PROFILES.filter(row => after.sha256 === row.afterSha256 || after.blob === row.afterBlob);
  if (matches.length === 0) return source;
  if (matches.length !== 1) throw new Error('FEED_EDIT_APP_HTML_INVERSE_AMBIGUOUS_IDENTITY');
  const row = matches[0];
  if (after.bytes !== row.bytes || after.sha256 !== row.afterSha256 || after.blob !== row.afterBlob) {
    throw new Error('FEED_EDIT_APP_HTML_INVERSE_IDENTITY_MISMATCH');
  }
  // A test view restores only the admitted query; served HTML stays untouched.
  const restored = substituteUnique(lf, NEW_LITERAL, OLD_LITERAL);
  const before = identity(restored);
  if (before.bytes !== row.bytes || before.sha256 !== row.beforeSha256 || before.blob !== row.beforeBlob) {
    throw new Error('FEED_EDIT_APP_HTML_INVERSE_RESTORED_IDENTITY_MISMATCH');
  }
  if (substituteUnique(restored, OLD_LITERAL, NEW_LITERAL) !== lf) {
    throw new Error('FEED_EDIT_APP_HTML_INVERSE_FORWARD_MISMATCH');
  }
  return crlf ? restored.replace(/\n/g, '\r\n') : restored;
}

module.exports = { restoreOwnedFeedEditAppHtml };
