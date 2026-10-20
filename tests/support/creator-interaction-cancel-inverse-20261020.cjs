'use strict';

const { createHash } = require('node:crypto');

const BEFORE_HTML = {
  bytes: 62703,
  sha256: '03764953dfd8fbb359f185051070f6adf0a50e84c0f6071580abff52e133a5b8',
  blob: '7211a8d47738a397d0453d5708a68e4e3a9682a1',
};
const AFTER_HTML = {
  bytes: 62719,
  sha256: '41a27d40735a83e98d5a6977df20082748a3fa81e72fd3528c8240088cb6ef6a',
  blob: '1a20a15b1f0814d722b97bb1abc12f32411c4e58',
};
const OLD_URL = '/pages/creator-story-interactions.js?v=interactions-20261001';
const NEW_URL = '/pages/creator-story-interactions.js?v=interactions-cancel-20261020-6eb98ed7';

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
    throw new Error('CREATOR_INTERACTION_CANCEL_HTML_INVERSE_LITERAL_MISMATCH');
  }
  return source.slice(0, at) + to + source.slice(at + from.length);
}

function restoreCreatorInteractionCancelHtml(source) {
  if (typeof source !== 'string') throw new TypeError('CREATOR_INTERACTION_CANCEL_HTML_INVERSE_STRING_REQUIRED');
  const lf = source.replace(/\r\n/g, '\n');
  const crlf = source.includes('\r\n');
  if (lf.startsWith('\uFEFF') || lf.includes('\r') ||
      (crlf && source !== lf.replace(/\n/g, '\r\n')) ||
      Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const current = identity(lf);
  if (current.sha256 !== AFTER_HTML.sha256 && current.blob !== AFTER_HTML.blob) return source;
  const matches = (value, expected) => value.bytes === expected.bytes &&
    value.sha256 === expected.sha256 && value.blob === expected.blob;
  if (!matches(current, AFTER_HTML)) throw new Error('CREATOR_INTERACTION_CANCEL_HTML_INVERSE_IDENTITY');
  const restored = substituteUnique(lf, NEW_URL, OLD_URL);
  if (!matches(identity(restored), BEFORE_HTML)) throw new Error('CREATOR_INTERACTION_CANCEL_HTML_INVERSE_RESTORED');
  if (substituteUnique(restored, OLD_URL, NEW_URL) !== lf) throw new Error('CREATOR_INTERACTION_CANCEL_HTML_INVERSE_FORWARD');
  return crlf ? restored.replace(/\n/g, '\r\n') : restored;
}

module.exports = { restoreCreatorInteractionCancelHtml };
