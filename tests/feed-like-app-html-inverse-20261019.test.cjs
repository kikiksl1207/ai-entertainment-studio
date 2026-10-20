'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const helperFile = path.join(__dirname, 'support/feed-like-app-html-inverse-20261019.cjs');
const editHelperFile = path.join(__dirname, 'support/feed-edit-app-html-inverse-20261020.cjs');
const cancelHelperFile = path.join(__dirname, 'support/creator-interaction-cancel-inverse-20261020.cjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const blob = value => createHash('sha1').update('blob ' + value.length + '\0').update(value).digest('hex');
const actualProfiles = [
  ['index.html', 20210, '13f9ad2655afda166c4f14ae873e32ba96bbd11ba0f74acda27393f9baeaca8e', '9c8e97cd753a4c959a1c00bc5a954169bdcee04a'],
  ['creator-studio/index.html', 62703, '03764953dfd8fbb359f185051070f6adf0a50e84c0f6071580abff52e133a5b8', '7211a8d47738a397d0453d5708a68e4e3a9682a1'],
  ['lumina-feed/index.html', 24673, '6cc3bf5ef12b525e7c01e212cd11429f5c009c5693db8078438667117b2ce6bc', '9bd1f484ada81e23db7c9d916124d41ef32a09c6'],
];
const rows = [
  ['index.html', 20210, '7b44ebef67fe443952c956f202d1caf70c52ed0fcf414368bd81a45fc9634b13',
    'e4e18d9bae9d2c9add41424efb1423df8ba6dd490423fa7168dd62dd96f1864d', 'aa9fdc099927df4385f5119a527b7afcbf15fe51'],
  ['creator-studio/index.html', 62703, '2d2d45c97fc20e33489e43a189211748beb6af7ffaf8080a8fcb28d12acd2543',
    '07811e59dacfd174647bc4beedbc91aec27536690db2649485067547647889c9', '6a73fc57691fb11691009cf459da3b669b86519b'],
  ['lumina-feed/index.html', 24673, 'de3458eb06217b8eac86faab4e6d6325c90ddeff957b2ee35015edda187bb635',
    '4e0b216c07b2cb1ee64d19050295b23cb546e27c9b7b3bea79872778b9a9c7d1', 'b6f6b0841c9a440e4e00ab9eb0113992165cf112'],
];
assert.ok([3419, 3496].includes(fs.statSync(helperFile).size), 'only pinned LF or uniform CRLF helper sizes');
assert.ok([6825, 6989].includes(fs.statSync(editHelperFile).size), 'only pinned LF or uniform CRLF edit HTML helper sizes');
const helperRaw = fs.readFileSync(helperFile);
let helperText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(helperRaw);
assert.equal(Buffer.from(helperText).equals(helperRaw), true);
assert.equal(helperText.startsWith('\uFEFF'), false);
if (helperText.includes('\r')) {
  const rest = helperText.replace(/\r\n/g, '');
  assert.equal(rest.includes('\r'), false);
  assert.equal(rest.includes('\n'), false);
  helperText = helperText.replace(/\r\n/g, '\n');
}
assert.equal(Buffer.byteLength(helperText), 3419);
assert.equal(sha(helperText), 'da77205835891dd62588eab8d54f1f39f2b74a357700c0f6477ef497a6d55bcd');
const cancelStat = fs.lstatSync(cancelHelperFile);
assert.ok(cancelStat.isFile() && !cancelStat.isSymbolicLink());
assert.ok([2382, 2435].includes(cancelStat.size), 'exact cancel helper size before allocation');
assert.equal(fs.realpathSync.native(cancelHelperFile).toLowerCase(), path.resolve(cancelHelperFile).toLowerCase());
const tracked = [helperFile, editHelperFile, __filename, ...rows.map(row => path.join(ROOT, row[0])), cancelHelperFile];
for (const row of rows) assert.ok(fs.statSync(path.join(ROOT, row[0])).size <= 128 * 1024);
const opening = tracked.map(file => sha(fs.readFileSync(file)));
const editRaw = fs.readFileSync(editHelperFile);
assert.equal(sha(editRaw), opening[1]);
let editText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(editRaw);
assert.equal(Buffer.from(editText).equals(editRaw), true);
assert.equal(editText.startsWith('\uFEFF'), false);
if (editText.includes('\r')) {
  const rest = editText.replace(/\r\n/g, '');
  assert.equal(rest.includes('\r'), false);
  assert.equal(rest.includes('\n'), false);
  editText = editText.replace(/\r\n/g, '\n');
}
assert.equal(Buffer.byteLength(editText), 6825);
assert.equal(sha(editText), '0aeab29505e13df2e9d0711a5e0172149a703dd2ee355bff757e460727e56fe6');
assert.equal(blob(editText), '72ee0f6d9cf99ceb159fc5e91b371c77278e003c');
const { restoreOwnedFeedEditAccountHtml } = require(editHelperFile);
const cancelRaw = fs.readFileSync(cancelHelperFile);
assert.equal(cancelRaw.length, cancelStat.size);
assert.equal(sha(cancelRaw), opening[6]);
assert.ok([
  [2382, '7a181fceda5853dd17dd3fbe604cd32d4098e629428771af5d2ab4cc381984c6', '9dfc855aca5dbc50ebdac3e8f6a92b928174c4bc'],
  [2435, 'ae2697cd3411c2b65e50263fd1e1c8ded29234ec2b1598cbd1dd697ecebf4061', '7a61ba03a275323a36722fb5094e992d36abf8b7'],
].some(([length, hash, git]) => cancelRaw.length === length && sha(cancelRaw) === hash && blob(cancelRaw) === git));
const cancelModule = require(cancelHelperFile);
assert.deepEqual(Object.keys(cancelModule), ['restoreCreatorInteractionCancelHtml']);
const { restoreCreatorInteractionCancelHtml } = cancelModule;
assert.equal(typeof restoreCreatorInteractionCancelHtml, 'function');
const inputs = rows.map((row, i) => {
  const file = path.join(ROOT, row[0]);
  const raw = fs.readFileSync(file);
  if (i === 1) {
    assert.ok([
      [62719, '41a27d40735a83e98d5a6977df20082748a3fa81e72fd3528c8240088cb6ef6a', '1a20a15b1f0814d722b97bb1abc12f32411c4e58'],
      [63523, '77123c64ff7c6ce94bf36868fcea6f8d2fa2e2e5451a36a7683aab2e6b5c131d', '10286286828722a4e8e6293dd77c75849e316992'],
    ].some(([length, hash, git]) => raw.length === length && sha(raw) === hash && blob(raw) === git),
    'exact new entry raw LF or CRLF before the historical view');
  }
  let text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  assert.equal(Buffer.from(text).equals(raw), true);
  assert.equal(text.startsWith('\uFEFF'), false);
  if (text.includes('\r')) {
    const rest = text.replace(/\r\n/g, '');
    assert.equal(rest.includes('\r'), false);
    assert.equal(rest.includes('\n'), false);
    text = text.replace(/\r\n/g, '\n');
  }
  text = restoreCreatorInteractionCancelHtml(text);
  assert.equal(actualProfiles[i][0], row[0]);
  assert.equal(Buffer.byteLength(text), actualProfiles[i][1]);
  assert.equal(sha(text), actualProfiles[i][2]);
  assert.equal(blob(Buffer.from(text, 'utf8')), actualProfiles[i][3]);
  text = restoreOwnedFeedEditAccountHtml(text);
  assert.equal(Buffer.byteLength(text), row[1]);
  assert.equal(sha(text), row[2]);
  return { row, text };
});
const helpers = require(helperFile);
assert.deepEqual(Object.keys(helpers), ['restoreOwnedFeedLikeAppHtml']);
const restore = helpers.restoreOwnedFeedLikeAppHtml;
const oldHash = '7aac5b75851189fc919f26f5f64ba48c4910237a8c1f0b349a039d346b9d4b61';
const newHash = '4730707c2fae82363401f6f11dc5dc3daa68b9bb88b151ffdcec37e65c5e73ff';

test('Three whole HTML profiles restore exactly in LF and uniform CRLF with full forward equality', () => {
  for (const { row, text } of inputs) {
    const before = restore(text);
    const bytes = Buffer.from(before);
    assert.equal(bytes.length, row[1]);
    assert.equal(sha(bytes), row[3]);
    assert.equal(blob(bytes), row[4]);
    assert.equal(before.split(oldHash).length, 2);
    assert.equal(before.replace(oldHash, newHash), text);
    assert.equal(restore(before), before);
    assert.equal(restore(text.replace(/\n/g, '\r\n')), before.replace(/\n/g, '\r\n'));
  }
});

test('Unknown tampered duplicate partial and malformed HTML cannot acquire a historical view', () => {
  for (const { text } of inputs) {
    const at = text.indexOf('\n');
    const bad = [text + ' ', text.slice(0, -1), text + newHash, '\uFEFF' + text, text + '\uD800',
      text.replace(newHash, oldHash.slice(0, -1) + '0'),
      text.slice(0, at) + '\r' + text.slice(at + 1),
      text.slice(0, at) + '\r\n' + text.slice(at + 1)];
    for (const value of bad) assert.equal(restore(value), value);
  }
  assert.equal(restore('synthetic unknown HTML'), 'synthetic unknown HTML');
  for (const value of [null, undefined, 0, false, {}, [], new String('synthetic'), Buffer.from('synthetic')]) {
    assert.throws(() => restore(value), TypeError);
  }
});

process.once('exit', () => {
  assert.deepEqual(tracked.map(file => sha(fs.readFileSync(file))), opening,
    'HTML helper and guard inputs remain unchanged');
});
