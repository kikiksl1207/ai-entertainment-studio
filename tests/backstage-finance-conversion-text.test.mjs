import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const ts = serverRequire('typescript');
const sourcePath = process.env.BACKSTAGE_FINANCE_TEXT_SOURCE
  || fileURLToPath(new URL('../backstage.js', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(ast.parseDiagnostics.length, 0, 'Finance source must parse');
const names = ['escapeHtml', 'won', 'krw', 'formatCount', 'localizeWorkflowStatus',
  'localizeSettlementConversionStatus', 'settlementConversionRequester', 'settlementConversionEntryFromItem',
  'statusBadge', 'renderRows', 'selectDetailButton', 'renderDetailPanel', 'detailInput', 'detailTextarea', 'detailSelect', 'renderDetailForm'];
const currentSectionNode = ast.statements.find(statement => ts.isFunctionDeclaration(statement)
  && statement.name?.text === 'getCurrentSection');
assert.ok(currentSectionNode, 'Missing actual current-section helper');
const currentSectionSource = source.slice(currentSectionNode.getStart(ast), currentSectionNode.end);
const nativeContextStart = source.indexOf('let creatorsNativeReadProof =');
const nativeContextEnd = source.indexOf('function syncCurrentAdminContext(', nativeContextStart);
assert.ok(nativeContextStart >= 0 && nativeContextEnd > nativeContextStart, 'Missing actual creators context declarations');
const nativeContextSource = source.slice(nativeContextStart, nativeContextEnd);
const excerpts = names.map(name => {
  const node = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(node, `Missing exact product function: ${name}`);
  const start = node.getStart(ast), body = source.slice(start, node.end);
  return { name, line: ast.getLineAndCharacterOfPosition(start).line + 1,
    sha256: createHash('sha256').update(body).digest('hex'), body };
});
const metaStatement = ast.statements.find(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(declaration => declaration.name.getText(ast) === 'tableMeta'));
assert.ok(metaStatement, 'Missing actual table labels');
const metaSource = source.slice(metaStatement.getStart(ast), metaStatement.end);
export const sourcePins = { sourcePath, sha256: createHash('sha256').update(source).digest('hex'),
  functions: excerpts.map(({ body, ...pin }) => pin),
  tableMetaSha256: createHash('sha256').update(metaSource).digest('hex') };

let JSDOM;
if (process.env.BACKSTAGE_FINANCE_DOM_MODULE) {
  assert.match(process.env.BACKSTAGE_FINANCE_DOM_MODULE, /^E:[\\/]/i, 'Use only an existing absolute E-drive jsdom module');
  ({ JSDOM } = serverRequire(process.env.BACKSTAGE_FINANCE_DOM_MODULE));
  assert.equal(typeof JSDOM, 'function', 'Configured module must export JSDOM');
}
const domOptions = { skip: JSDOM ? false : 'No existing jsdom: real DOM assertions NOT executed; no browser substituted' };
const plain = value => JSON.parse(JSON.stringify(value));
const htmlText = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
})[character]);
const requester = 'Requester "\' & <img src=x onerror="qaRequester=true"> &lt;literal&gt;';
const settlementKey = 'artist:"\' & <svg onload="qaKey=true">:2026-10';
const note = 'Note "\' & </textarea><img src=x onerror="qaNote=true"><script>qaNote=true</script> &lt;literal&gt;';
const adminNote = 'Admin "\' & </textarea><input name="injected" autofocus onfocus="qaAdmin=true"> &amp;literal';
const conversionId = 'synthetic-"\' data-injected="true" <img src=x>';
const item = overrides => ({ id: conversionId, requester: { displayName: requester,
  email: 'synthetic-finance@example.invalid', avatarAssetId: null }, settlementKey,
  amountKrw: '12.34', requestedLumina: '123.45', status: 'requested', note, adminNote,
  walletLedgerId: null, ...overrides });

// These capture actual product sink strings; they do not parse or simulate a DOM.
function sink() {
  const classes = new Set();
  return { innerHTML: '', textContent: '', value: '', dataset: {}, classList: {
    add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name)
  } };
}
function harness() {
  const nodes = { settlementConversionRows: sink() };
  const context = createContext({ document: { getElementById: id => nodes[id] || null, querySelectorAll: () => [],
    querySelector(selector) {
      assert.equal(selector, '.dashboard-main');
      return { getAttribute(name) { assert.equal(name, 'data-active-section'); return 'payouts'; } };
    } },
    detailPanel: sink(), detailType: sink(), detailTitle: sink(), detailList: sink(),
    detailForm: sink(), detailMemo: sink(), selectedDetail: null, statusClassMap: {},
    canWriteBackstageDetail: () => false, canAccessBackstageSection: () => true,
    renderSettlementChildren: () => { throw new Error('Not a conversion sink'); },
    detailDraftKey: () => 'synthetic-finance-draft', restoreDetailDraft: () => {},
    renderDetailHistory: () => {}, updateDetailActions: () => {}, syncUserClassificationPanel: () => {} });
  runInContext(metaSource + '\n' + nativeContextSource + '\n' + currentSectionSource + '\n'
    + excerpts.map(excerpt => excerpt.body).join('\n'), context);
  const detail = entry => ({ tableId: 'settlementConversionRows', type: 'Synthetic finance',
    labels: ['Requester', 'Settlement key', 'Amount', 'Lumina', 'Status', 'Note', 'Action'],
    row: entry.row, meta: entry.meta });
  const render = input => {
    const entry = context.settlementConversionEntryFromItem(input);
    context.renderRows('settlementConversionRows', [entry], 4);
    context.renderDetailPanel(detail(entry));
    return { entry, table: nodes.settlementConversionRows.innerHTML, list: context.detailList.innerHTML,
      form: context.detailForm.innerHTML };
  };
  return { context, nodes, detail, render };
}
function expectedInput(name, value) {
  return `name="${name}" value="${htmlText(value)}" placeholder=""`;
}
function assertTextarea(form, value) {
  assert.ok(form.includes(`<textarea name="adminNote" placeholder="">${htmlText(value)}</textarea>`));
  assert.equal((form.match(/<textarea\b/g) || []).length, 1);
  assert.equal((form.match(/<\/textarea>/g) || []).length, 1);
  assert.doesNotMatch(form, /<img\b|<script\b|<svg\b|<input name="injected"/i);
}

test('FINANCE.TEXT.01 raw finance row is encoded exactly once and raw metadata is unchanged', t => {
  t.diagnostic(JSON.stringify(sourcePins));
  const input = item(), before = plain(input), h = harness(), entry = h.context.settlementConversionEntryFromItem(input);
  assert.equal(entry.row[0], htmlText(requester));
  assert.equal(entry.row[1], htmlText(settlementKey));
  assert.equal(entry.row[2], '12\uC6D0');
  assert.equal(entry.row[5], htmlText(note));
  assert.equal(entry.meta.note, note);
  assert.equal(entry.meta.adminNote, adminNote);
  assert.equal(entry.meta.settlementKey, settlementKey);
  assert.equal(entry.meta.conversionId, conversionId);
  assert.equal(entry.meta.amountKrw, '12.34');
  assert.equal(entry.meta.requestedLumina, '123.45');
  assert.deepEqual(plain(input), before);
});

test('FINANCE.TEXT.02 actual renderRows inserts encoded requester/key/note without executable tags', () => {
  const { table } = harness().render(item());
  for (const value of [requester, settlementKey, note]) assert.ok(table.includes(`<td>${htmlText(value)}</td>`));
  assert.doesNotMatch(table, /<img\b|<script\b|<svg\b/i);
  assert.ok(table.includes('12\uC6D0'));
});

test('FINANCE.TEXT.03 detailList consumes existing escaped rows without a second encoding', () => {
  const { list } = harness().render(item());
  for (const value of [requester, settlementKey, note]) assert.ok(list.includes(`<dd>${htmlText(value)}</dd>`));
  assert.doesNotMatch(list, /<img\b|<script\b|<svg\b/i);
  assert.ok(list.includes('&amp;lt;literal&amp;gt;'));
});

test('FINANCE.TEXT.04 requester fallback attribution is encoded once at the row boundary', () => {
  const h = harness();
  for (const attribution of [{ requester: { displayName: requester } }, { requester: { publicHandle: requester } },
    { requester: { email: requester } }, { requester: {}, requesterEmail: requester }]) {
    assert.equal(h.context.settlementConversionEntryFromItem(item(attribution)).row[0], htmlText(requester));
  }
  assert.equal(h.context.settlementConversionEntryFromItem(item({ requester: {}, requesterUserId: 'synthetic-user' })).row[0], 'syntheti');
  assert.equal(h.context.settlementConversionEntryFromItem({}).row[0], '-');
});

test('FINANCE.TEXT.05 conversion detailInput keeps raw ID/key and preescaped requester inside one value attribute', () => {
  const { form } = harness().render(item());
  for (const [name, value] of [['conversionId', conversionId], ['requester', requester], ['settlementKey', settlementKey]]) {
    assert.ok(form.includes(expectedInput(name, value)), name);
  }
  assert.equal((form.match(/name="requester"/g) || []).length, 1);
  assert.doesNotMatch(form, /"\s+(?:data-injected|onerror|onload)=|<img\b|<svg\b/i);
});

test('FINANCE.TEXT.06 raw adminNote and note fallback cannot close textarea and preserve entity-looking text', () => {
  for (const [overrides, expected] of [[{}, adminNote], [{ adminNote: null }, note], [{ adminNote: '', note: adminNote }, adminNote]]) {
    assertTextarea(harness().render(item(overrides)).form, expected);
  }
});

test('FINANCE.TEXT.07 legacy escaped row requester/key remains once encoded with absent raw key', () => {
  const h = harness(), entry = { row: [requester, settlementKey, '12\uC6D0', '123.45L', 'Legacy', note, 'Detail'].map(htmlText),
    meta: { conversionId, amountKrw: '12.34', requestedLumina: '123.45', note, adminNote: null } };
  const before = plain(entry);
  h.context.renderRows('settlementConversionRows', [entry], 4);
  h.context.renderDetailPanel(h.detail(entry));
  for (const [name, value] of [['requester', requester], ['settlementKey', settlementKey]]) {
    assert.ok(h.context.detailForm.innerHTML.includes(expectedInput(name, value)));
    assert.ok(h.context.detailList.innerHTML.includes(`<dd>${htmlText(value)}</dd>`));
  }
  assertTextarea(h.context.detailForm.innerHTML, note);
  assert.deepEqual(plain(entry), before);
});

test('FINANCE.TEXT.08 event data-detail JSON attribute roundtrips encoded row and raw metadata without attribute breakout', () => {
  const h = harness(), { entry, table } = h.render(item());
  const matches = [...table.matchAll(/data-detail="([^"]*)"/g)];
  assert.equal(matches.length, 1);
  const encoded = matches[0][1];
  assert.doesNotMatch(encoded, /["<>\s]/);
  const payload = JSON.parse(decodeURIComponent(encoded));
  assert.deepEqual(payload.row, plain(entry.row));
  assert.deepEqual(payload.meta, plain(entry.meta));
  assert.equal(payload.meta.note, note);
  assert.equal(payload.meta.settlementKey, settlementKey);
  assert.equal(payload.tableId, 'settlementConversionRows');
  assert.equal(encoded, encodeURIComponent(JSON.stringify(payload)));
  h.context.selectDetailButton({ dataset: { detail: encoded }, closest: selector => selector === '.section-block'
    ? { id: 'payouts' } : { classList: { add() {} } } });
  assert.deepEqual(plain(h.context.selectedDetail), payload);
  assertTextarea(h.context.detailForm.innerHTML, adminNote);
});

function parsedSinks(rendered) {
  // No script execution, external resources, App, or browser process is enabled.
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const document = dom.window.document;
  const table = document.createElement('table'), body = document.createElement('tbody');
  table.append(body); document.body.append(table); body.innerHTML = rendered.table;
  const list = document.createElement('dl'); document.body.append(list); list.innerHTML = rendered.list;
  const form = document.createElement('form'); document.body.append(form); form.innerHTML = rendered.form;
  return { dom, document, body, list, form };
}
function assertNoInjectedDom(document) {
  assert.equal(document.querySelectorAll('img, script, svg, [name="injected"], [data-injected]').length, 0);
  for (const element of document.querySelectorAll('*')) {
    assert.ok([...element.attributes].every(attribute => !/^on/i.test(attribute.name)), element.tagName);
  }
}

test('FINANCE.DOM.09 real DOM row/detail/input/textarea text and event JSON preserve exact raw strings', domOptions, () => {
  const rendered = harness().render(item()), parsed = parsedSinks(rendered);
  try {
    const { document, body, list, form } = parsed;
    assertNoInjectedDom(document);
    const cells = body.querySelectorAll('td'), values = list.querySelectorAll('dd');
    for (const [index, expected] of [[0, requester], [1, settlementKey], [2, '12\uC6D0'], [5, note]]) {
      assert.equal(cells[index].textContent, expected);
      assert.equal(values[index].textContent, expected);
    }
    for (const [name, expected] of [['conversionId', conversionId], ['requester', requester], ['settlementKey', settlementKey]]) {
      const field = form.querySelector(`[name="${name}"]`);
      assert.equal(field.value, expected);
      assert.equal(field.getAttribute('value'), expected);
    }
    assert.equal(form.querySelector('[name="adminNote"]').value, adminNote);
    const payload = JSON.parse(decodeURIComponent(body.querySelector('[data-detail]').getAttribute('data-detail')));
    assert.deepEqual(payload.meta, plain(rendered.entry.meta));
    assert.deepEqual(payload.row, plain(rendered.entry.row));
  } finally { parsed.dom.window.close(); }
});

test('FINANCE.DOM.10 real DOM preserves legacy escaped rows and raw note fallback without entity decoding twice', domOptions, () => {
  const h = harness(), legacy = { row: [requester, settlementKey, '12\uC6D0', '123.45L', 'Legacy', note, 'Detail'].map(htmlText),
    meta: { conversionId, amountKrw: '12.34', requestedLumina: '123.45', note, adminNote: null } };
  h.context.renderRows('settlementConversionRows', [legacy], 4);
  h.context.renderDetailPanel(h.detail(legacy));
  const parsed = parsedSinks({ table: h.nodes.settlementConversionRows.innerHTML,
    list: h.context.detailList.innerHTML, form: h.context.detailForm.innerHTML });
  try {
    assertNoInjectedDom(parsed.document);
    assert.equal(parsed.body.querySelector('td').textContent, requester);
    assert.equal(parsed.list.querySelector('dd').textContent, requester);
    assert.equal(parsed.form.querySelector('[name="requester"]').value, requester);
    assert.equal(parsed.form.querySelector('[name="settlementKey"]').value, settlementKey);
    assert.equal(parsed.form.querySelector('[name="adminNote"]').value, note);
  } finally { parsed.dom.window.close(); }
});
