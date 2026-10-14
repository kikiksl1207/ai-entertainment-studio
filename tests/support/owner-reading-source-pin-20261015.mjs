import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

export function decodePinnedReadingSource(raw, blob, sha256) {
  assert(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= 131072);
  assert.match(blob, /^[a-f0-9]{40}$/);
  assert.match(sha256, /^[a-f0-9]{64}$/);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  assert(!text.startsWith('\uFEFF'), 'Reader source BOM is not an admitted representation');
  assert(!/\r(?!\n)/.test(text), 'Reader source has a lone carriage return');
  if (text.includes('\r\n')) {
    assert(!text.replace(/\r\n/g, '').includes('\n'), 'Mixed reader source line endings are not admitted');
  }
  const lf = text.replace(/\r\n/g, '\n');
  const representations = [Buffer.from(lf), Buffer.from(lf.replace(/\n/g, '\r\n'))];
  assert(representations.some(bytes =>
    createHash('sha256').update(bytes).digest('hex') === sha256 &&
    createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex') === blob),
  'Published reader content pin mismatch');
  return text;
}
