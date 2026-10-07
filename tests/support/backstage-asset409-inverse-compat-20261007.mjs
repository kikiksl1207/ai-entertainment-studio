import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const pinned = Object.freeze({
  "scope": "backstage-asset409-exact-three-line-only",
  "beforeSHA256": "62b920293ea88fc2f181d4c118eb725c60b214e298c8fa09ea7bea2a8034d26d",
  "afterSHA256": "1843ebacfa7779c72756263196e930c2b8a45d5211bca617fa3d7f629bbfb409",
  "branchCount": 1,
  "addedLineCount": 3,
  "branchSHA256": "a8ab66371c5a4da24cd76235572851a4b7891a74cd2917de8e9fdd1ae844a7b7",
  "beforeFullText": "",
  "afterFullText": "  if (status === 409 && error?.body?.error?.code === \"ADMIN_ASSET_STORAGE_CONFLICT\") {\n    return \"\uc774\ubbf8 \ub4f1\ub85d\ub41c \uc790\uc0b0\uc774\uc5d0\uc694. \uae30\uc874 \uc790\uc0b0\uc744 \ud655\uc778\ud574 \uc8fc\uc138\uc694.\";\n  }\n"
});
const fixture = Object.freeze(JSON.parse(readFileSync(
  new URL('../fixtures/backstage-asset409-exact3-delta-20261007.json', import.meta.url), 'utf8')));
const sha = source => createHash('sha256').update(source).digest('hex');

export function sourceWithoutAsset409Delta(source, delta = fixture) {
  assert.deepEqual(delta, pinned, 'Exact asset409 inverse fixture pins');
  assert.equal(sha(delta.afterFullText), pinned.branchSHA256, 'Exact asset409 three-line branch SHA256');
  assert.equal(delta.afterFullText.split('\n').length - 1, 3, 'Exact asset409 added line count');
  const anchoredBranch = '\n' + delta.afterFullText;
  assert.equal(source.split(anchoredBranch).length - 1, 1, 'Exact asset409 branch count');
  assert.equal(sha(source), pinned.afterSHA256, 'Exact asset409 current full-source SHA256');
  const restored = source.replace(anchoredBranch, '\n' + delta.beforeFullText);
  assert.equal(sha(restored), pinned.beforeSHA256, 'Every original080 byte restored before finance/classification inverse');
  return restored;
}
