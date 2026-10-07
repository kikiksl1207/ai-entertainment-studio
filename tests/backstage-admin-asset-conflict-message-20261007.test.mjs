import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
function fragment(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0);
  const end = source.slice(start + 1).search(/^(?:(?:async )?function |const |let |window\.|document\.)/m);
  return source.slice(start, end < 0 ? source.length : start + 1 + end);
}
const context = createContext({});
runInContext(fragment('backstageErrorStatus') + '\n' + fragment('backstageUserFacingError'), context);
const recognized = { status: 409, body: { error: { code: 'ADMIN_ASSET_STORAGE_CONFLICT', message: '<script>private key</script>' } } };

test('actual API error body is translated to literal asset-conflict text without provider/private details', () => {
  const message = context.backstageUserFacingError(recognized);
  assert.equal(message, '이미 등록된 자산이에요. 기존 자산을 확인해 주세요.');
  assert(!message.includes('private') && !message.includes('<script>'));
  assert.deepEqual(recognized.body.error, { code: 'ADMIN_ASSET_STORAGE_CONFLICT', message: '<script>private key</script>' });
});
for (const status of [400, 401, 403, 500]) test(`status ${status} does not turn into a duplicate notice`, () => {
  const message = context.backstageUserFacingError({ ...recognized, status }, 'original fallback');
  assert(!message.includes('이미 등록된 자산'));
  if (status === 401) assert(message.includes('세션이 만료'));
  else if (status === 403) assert(message.includes('권한'));
  else assert.equal(message, 'original fallback');
});
for (const body of [null, {}, { code: 'ADMIN_ASSET_STORAGE_CONFLICT' }, { error: {} },
  { error: { code: 'OTHER_CONFLICT' } }, { error: { code: 'admin_asset_storage_conflict' } }]) {
  test('a different/missing API code preserves the original fallback', () => {
    assert.equal(context.backstageUserFacingError({ status: 409, body }, 'original fallback'), 'original fallback');
  });
}
test('error-shaped transport exception without server response cannot claim confirmed asset duplication', () => {
  assert.equal(context.backstageUserFacingError({ status: 409, code: 'ADMIN_ASSET_STORAGE_CONFLICT' }, 'original fallback'), 'original fallback');
});
