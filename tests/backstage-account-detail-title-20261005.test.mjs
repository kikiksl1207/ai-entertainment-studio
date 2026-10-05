import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(process.env.BACKSTAGE_ACCOUNT_TITLE_SOURCE || new URL('../backstage.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../backstage/index.html', import.meta.url), 'utf8');
const start = source.indexOf('function selectDetailButton(');
const end = source.indexOf('function collectDetailFormData(', start);
assert.ok(start >= 0 && end > start);
function select(tableId, firstText, thirdText = '-') {
  const calls = [];
  const row = { cells: firstText === null ? [] : [{ textContent: firstText }, {}, { textContent: thirdText }],
    classList: { add() {} } };
  const context = { document: { querySelectorAll: () => [] }, renderDetailPanel: detail => calls.push(detail) };
  runInNewContext(source.slice(start, end) + '\nthis.select = selectDetailButton;', context);
  const detail = { tableId, type: 'Synthetic QA', labels: ['name', 'email', 'login'],
    row: ['Synthetic &amp; &lt;account&gt;', 'synthetic@example.invalid', '-'] };
  context.select({ dataset: { detail: encodeURIComponent(JSON.stringify(detail)) }, closest: () => row });
  assert.equal(calls.length, 1);
  return JSON.parse(JSON.stringify(calls[0]));
}

for (const tableId of ['userRows', 'userRiskRows', 'adminRows']) {
  test(`ACCOUNT-TITLE ${tableId}: displayed account name is the title, not login/status`, () => {
    for (const name of ['Synthetic QA account', 'Synthetic & <account>', 'Literal &amp; &lt;account&gt;']) {
      const detail = select(tableId, name);
      assert.equal(detail.titleText, name);
      assert.equal(detail.row[2], '-');
      assert.equal(detail.row[0], 'Synthetic &amp; &lt;account&gt;');
    }
  });
}
test('ACCOUNT-TITLE existing overview title still comes from displayed third cell', () => {
  assert.equal(select('overviewQueueRows', 'id', 'Existing & <title>').titleText, 'Existing & <title>');
});
test('ACCOUNT-TITLE unrelated tables keep their established title fallback', () => {
  assert.equal(Object.hasOwn(select('otherTable', 'not-a-new-title'), 'titleText'), false);
});
test('ACCOUNT-TITLE missing or empty account cells do not manufacture a title', () => {
  assert.equal(Object.hasOwn(select('userRows', null), 'titleText'), false);
  assert.equal(Object.hasOwn(select('userRows', ''), 'titleText'), false);
});
for (const section of ['users', 'admins']) {
  test(`ACCOUNT-MENU ${section}: no fixed sample number beside actual account menu`, () => {
    const link = html.match(new RegExp(`<a[^>]+href="#${section}"[^>]*>([\\s\\S]*?)</a>`));
    assert.ok(link);
    assert.doesNotMatch(link[1], /<b\b|<span\b|\d/);
  });
}
