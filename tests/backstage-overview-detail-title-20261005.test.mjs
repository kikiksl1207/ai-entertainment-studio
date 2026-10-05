import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
function excerpt(name, next) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${next}(`, start + 1);
  assert.ok(start >= 0 && end > start, `Missing actual function boundary: ${name}`);
  return source.slice(start, end);
}
const runtime = [
  excerpt('escapeHtml', 'firstRoleName'),
  excerpt('localHistoryRows', 'mergeLogRows'),
  excerpt('mergeLogRows', 'setStatus'),
  excerpt('formatHistoryTime', 'renderDetailHistory'),
  excerpt('statusBadge', 'renderSettlementChildren'),
  excerpt('formatCount', 'renderSummaryKpis'),
  excerpt('renderBackstageSummary', 'normalizeReadinessCategories'),
  excerpt('selectDetailButton', 'collectDetailFormData'),
  excerpt('renderDetailPanel', 'openQuickAction'),
  'this.api = { select: selectDetailButton, detail: renderDetailPanel, summary: renderBackstageSummary, render: renderRows };',
].join('\n');
const encode = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
})[char]);
const plain = value => JSON.parse(JSON.stringify(value));
function classes(initial = []) {
  const values = new Set(initial);
  return { add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value) };
}
function textNode() {
  return { textContent: '', set innerHTML(_) { assert.fail('A title/type must use textContent, never innerHTML'); } };
}

// Cell text is declared independently, not decoded or parsed from encoded HTML.
function rowNode(texts) {
  return { cells: texts.map(textContent => ({ textContent })), classList: classes() };
}
function harness(history = []) {
  const nodes = Object.fromEntries(['overviewQueueRows', 'riskRows', 'logRows', 'otherTable'].map(id => [id, { innerHTML: '' }]));
  const previousRow = rowNode([]);
  previousRow.classList.add('is-selected');
  const title = textNode();
  const body = { innerHTML: '' };
  const calls = [];
  const context = {
    selectedDetail: null,
    detailPanel: { classList: classes(['is-hidden']) }, detailTitle: title,
    detailType: textNode(), detailList: body, detailMemo: { value: 'old synthetic draft' },
    document: {
      getElementById: id => nodes[id] || null,
      querySelectorAll: selector => { assert.equal(selector, 'tr.is-selected'); return [previousRow]; },
    },
    tableMeta: Object.fromEntries(Object.keys(nodes).map(id => [id, {
      type: 'Synthetic', labels: ['first', 'second', 'title', 'status', 'action'],
    }])),
    statusClassMap: {}, readActionHistory: () => history,
    renderSummaryKpis: () => {}, renderSummaryAlerts: () => {},
    renderDetailForm: detail => calls.push(['form', detail]),
    renderDetailHistory: detail => calls.push(['history', detail]),
    updateDetailActions: detail => calls.push(['actions', detail]),
    syncUserClassificationPanel: detail => calls.push(['classification', detail]),
  };
  runInNewContext(runtime, context, { filename: 'backstage.js:detail-title-synthetic', timeout: 1000 });
  function buttonFor(id, cellTexts, index = 0) {
    const payloads = [...nodes[id].innerHTML.matchAll(/data-detail="([^"]+)"/g)];
    assert.ok(payloads[index], `Missing actual renderer payload: ${id}`);
    const row = cellTexts === null ? null : rowNode(cellTexts);
    const encodedPayload = payloads[index][1];
    return { row, payload: JSON.parse(decodeURIComponent(encodedPayload)),
      button: { dataset: { detail: encodedPayload }, closest: selector => { assert.equal(selector, 'tr'); return row; } } };
  }
  return { api: context.api, context, nodes, previousRow, title, body, calls, buttonFor };
}
function assertSafeBody(h, value) {
  assert.ok(h.body.innerHTML.includes(`<dd>${encode(value)}</dd>`));
  assert.doesNotMatch(h.body.innerHTML, /<(?:img|script|svg|iframe)\b/i);
  assert.equal((h.body.innerHTML.match(/<dd>/g) || []).length, h.context.selectedDetail.row.length);
}
const createdAt = '2026-10-05T01:00:00.000Z';

test('overview queue title uses displayed row text for ampersands, angle brackets and literal entities', () => {
  for (const value of ['Synthetic & <name> "quoted"', 'Literal &amp; &lt;tag&gt; &#039;']) {
    const h = harness();
    h.api.summary({ tables: { recentDebutApplications: [{ id: 'synthetic-queue', displayName: value, status: 'submitted' }] } });
    const selected = h.buttonFor('overviewQueueRows', ['syntheti', 'Debut', value, 'submitted', 'View']);
    assert.equal(selected.payload.row[2], encode(value));
    h.api.select(selected.button);
    assertSafeBody(h, value);
    assert.equal(h.title.textContent, value);
  }
});

test('risk title keeps the actual summary report-count display text without extra decoding', () => {
  const count = 'Synthetic & <count> &amp;';
  const title = `\uc2e0\uace0 ${count}\uac74`;
  const h = harness();
  h.api.summary({ tables: { highRiskPosts: [{ id: 'synthetic-risk', postType: 'post', reportCount: count, status: 'hidden' }] } });
  const selected = h.buttonFor('riskRows', ['syntheti', 'post', title, 'Hidden', 'Restore']);
  assert.equal(selected.payload.row[2], encode(title));
  h.api.select(selected.button);
  assertSafeBody(h, title);
  assert.equal(h.title.textContent, title);
});

test('log title is displayed action text for both already-escaped summary rows and local merge rows', () => {
  const localAction = 'Local & <action> &lt;literal&gt;';
  const serverAction = 'Summary & <action> &amp;';
  const h = harness([{ createdAt, actor: 'synthetic@example.invalid', actionLabel: localAction, target: 'user', note: 'synthetic' }]);
  h.api.summary({ tables: { recentAuditEvents: [{ createdAt, actorUser: { email: 'synthetic@example.invalid' }, action: serverAction, targetType: 'user', reason: 'synthetic' }] } });
  for (const [index, value] of [localAction, serverAction].entries()) {
    const selected = h.buttonFor('logRows', ['time', 'synthetic@example.invalid', value, 'user', 'synthetic'], index);
    assert.equal(selected.payload.row[2], encode(value));
    h.api.select(selected.button);
    assertSafeBody(h, value);
    assert.equal(h.title.textContent, value);
  }
});

test('selected malicious-looking text remains text while encoded row, metadata and selection contracts are preserved', () => {
  const value = '<img src=x onerror="synthetic()"><script>synthetic()</script> &amp;';
  const h = harness();
  const row = ['synthetic', 'kind', value, 'submitted', 'View'].map(encode);
  const meta = { synthetic: true, applicationId: 'synthetic-application', nested: { revision: 3 } };
  h.api.render('overviewQueueRows', [{ row, meta }], 3);
  const selected = h.buttonFor('overviewQueueRows', ['synthetic', 'kind', value, 'submitted', 'View']);
  const originalPayload = selected.button.dataset.detail;
  h.api.select(selected.button);
  assertSafeBody(h, value);
  const actual = plain(h.context.selectedDetail);
  const { titleText, ...unchanged } = actual;
  assert.deepEqual(unchanged, selected.payload);
  assert.deepEqual(row, selected.payload.row);
  assert.deepEqual(meta, selected.payload.meta);
  assert.equal(selected.button.dataset.detail, originalPayload);
  assert.equal(selected.row.classList.contains('is-selected'), true);
  assert.equal(h.previousRow.classList.contains('is-selected'), false);
  assert.equal(h.context.detailPanel.classList.contains('is-hidden'), false);
  assert.equal(h.context.detailMemo.value, '');
  assert.deepEqual(h.calls.map(([name]) => name), ['form', 'history', 'actions', 'classification']);
  h.calls.forEach(([, detail]) => assert.equal(detail, h.context.selectedDetail));
  assert.equal(titleText, value);
  assert.equal(h.title.textContent, value);
});

test('other-table selection and direct quickAction calls keep the old row title fallback', () => {
  const h = harness();
  const row = ['first', 'second', 'Legacy &amp; literal', 'status', 'action'];
  h.api.render('otherTable', [row], -1);
  const selected = h.buttonFor('otherTable', ['first', 'second', 'Different DOM text', 'status', 'action']);
  h.api.select(selected.button);
  assert.equal(h.title.textContent, row[2]);
  assert.deepEqual(plain(h.context.selectedDetail), selected.payload);
  assert.equal(Object.hasOwn(h.context.selectedDetail, 'titleText'), false);
  for (const directRow of [row, ['first &amp; literal', 'second', ''], []]) {
    const detail = { tableId: 'quickAction', type: 'Synthetic', row: directRow };
    h.api.detail(detail);
    assert.equal(h.context.selectedDetail, detail);
    assert.equal(h.title.textContent, directRow[2] || directRow[0] || '\uc0c1\uc138 \uc815\ubcf4');
    assert.equal(Object.hasOwn(detail, 'titleText'), false);
  }
});

test('missing row/cells keep the old title; absent or empty third cell falls back to first displayed cell', () => {
  for (const tableId of ['overviewQueueRows', 'riskRows', 'logRows']) {
    const h = harness();
    const row = ['first &amp; encoded', 'kind', 'third &lt;encoded&gt;', 'status', 'action'];
    h.api.render(tableId, [row], -1);
    for (const texts of [null, [], ['', 'kind', '']]) {
      const selected = h.buttonFor(tableId, texts);
      h.api.select(selected.button);
      assert.equal(h.title.textContent, row[2]);
      assert.deepEqual(plain(h.context.selectedDetail.row), row);
    }
    for (const texts of [['Displayed & <first>'], ['Displayed & <first>', 'kind', '']]) {
      const selected = h.buttonFor(tableId, texts);
      h.api.select(selected.button);
      assert.equal(h.title.textContent, texts[0]);
      assert.deepEqual(plain(h.context.selectedDetail.row), row);
    }
  }
});

test('explicit titleText is used only for strings, including empty string, without HTML decoding', () => {
  const h = harness();
  for (const titleText of ['Explicit & <text> &amp; &lt;tag&gt;', '']) {
    h.api.detail({ tableId: 'overviewQueueRows', titleText, row: ['first', 'second', 'old title'] });
    assert.equal(h.title.textContent, titleText);
  }
  for (const titleText of [undefined, null, 0, false, { synthetic: true }]) {
    h.api.detail({ tableId: 'overviewQueueRows', titleText, row: ['first', 'second', 'old title'] });
    assert.equal(h.title.textContent, 'old title');
  }
});

test('missing buttons remain no-ops and malformed payload retains the safe existing error fallback', () => {
  const h = harness();
  for (const button of [undefined, {}, { dataset: {} }, { dataset: { detail: '' } }]) h.api.select(button);
  assert.equal(h.context.selectedDetail, null);
  assert.equal(h.calls.length, 0);
  const row = rowNode(['synthetic']);
  h.api.select({ dataset: { detail: '%malformed-synthetic' }, closest: () => row });
  assert.equal(h.context.selectedDetail.type, 'Detail');
  assert.equal(h.context.selectedDetail.row.length, 1);
  assert.equal(h.title.textContent, h.context.selectedDetail.row[0]);
  assert.equal(Object.hasOwn(h.context.selectedDetail, 'titleText'), false);
  assert.doesNotMatch(h.body.innerHTML, /<(?:img|script|svg|iframe)\b/i);
});
