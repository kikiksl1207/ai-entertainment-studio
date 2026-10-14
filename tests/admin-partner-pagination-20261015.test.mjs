import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, resolve, win32 } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

// Author UNRUN. Extract actual functions/wiring, never import an autorunning old test or bootstrap.
const here = dirname(fileURLToPath(import.meta.url));
const qaLayout = basename(here) === 'new-tests' && basename(dirname(here)) === '20261015-admin-partner-pagination';
const repoRoot = resolve(here, qaLayout ? '../../..' : '..');
const serverRequire = createRequire(resolve(repoRoot, 'server/package.json'));
const { parse } = serverRequire('@babel/parser');
const ENV = ['LUMINA_ADMIN_PARTNER_JS_PATH', 'LUMINA_ADMIN_PARTNER_JS_SHA256',
  'LUMINA_ADMIN_PARTNER_HTML_PATH', 'LUMINA_ADMIN_PARTNER_HTML_SHA256'];
const PINS = { jsLf: 'a2ec8324573b8113b1f1f861f08dc46fd4b5e2de18e0dfd7b16be562a759c240',
  htmlLf: '0c45de8ceb7aad1018297dace7b8d5d4a250e76470429e85803141dd97d133e8',
  money: 'ae32bd3dba0528f3769473342c7dd6729e76f6c606c4d4096349d388a7e94aa6' };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const options = { timeout: 5000 };
const MAIN = '/admin/api/v1/backstage/operations/settlement-preview';
const PARTNER = '/admin/api/v1/backstage/operations/partner-settlement-preview';
const CONVERSIONS = '/admin/api/v1/backstage/settlement-conversions';
const TABLES = ['studioSettlementRows', 'settlementRows', 'settlementConversionRows'];
const PRIMARY_ERROR = /\uc815\uc0b0 \uc608\uc0c1\uce58\ub97c \ubd88\ub7ec\uc624\uc9c0 \ubabb/;
const PARTIAL_ERROR = /\uc77c\ubd80 \uc6b4\uc601\uc790 \ub0b4\uc5ed\uc744 \uc870\ud68c\ud558\uc9c0 \ubabb/;

function normalize(bytes, allowHtmlBom = false) {
  if (!allowHtmlBom) assert.equal(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false, 'No JS BOM');
  const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: allowHtmlBom }).decode(bytes);
  if (decoded.includes('\r')) assert.equal(/[\r\n]/.test(decoded.replaceAll('\r\n', '')), false, 'Uniform LF or CRLF only');
  const text = decoded.replace(/\r\n/g, '\n');
  assert.equal(text.includes('\r'), false, 'Only LF or equivalent CRLF'); return text;
}
function allowedPath(path) {
  assert.equal(typeof path, 'string'); assert.ok(path.length > 0 && (isAbsolute(path) || win32.isAbsolute(path)));
  assert.doesNotMatch(path, /^(?:\\\\|\/\/)/, 'No remote source path');
  assert.doesNotMatch(path.replace(/\\/g, '/'), /(?:^|\/)story-completion-20261003(?:\/|$)/i,
    'Shared CLEAN source is explicitly forbidden; select the frozen QA pair or the repository');
}
function selection(env) {
  const values = ENV.map(key => env[key]);
  if (values.every(value => value === undefined)) return null;
  assert.ok(values.every(value => typeof value === 'string' && value.length > 0), 'All four explicit path/RAW SHA values required');
  allowedPath(values[0]); allowedPath(values[2]);
  for (const value of [values[1], values[3]]) assert.match(value, /^[a-f0-9]{64}$/i);
  assert.equal(basename(values[0]), 'backstage.js');
  assert.equal(resolve(values[2]), resolve(dirname(values[0]), 'backstage/index.html'), 'One explicit source root, no mixed HTML/JS');
  return { jsPath: values[0], jsRaw: values[1].toLowerCase(), htmlPath: values[2], htmlRaw: values[3].toLowerCase() };
}
function readOne(path, rawPin, lfPin, allowHtmlBom = false) {
  allowedPath(path); const selectedPath = realpathSync(path); allowedPath(selectedPath);
  const stat = statSync(selectedPath); assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 1024 * 1024);
  const bytes = readFileSync(selectedPath), raw = digest(bytes), text = normalize(bytes, allowHtmlBom);
  if (rawPin) assert.equal(raw, rawPin, 'Explicit RAW source mismatch');
  else assert.equal(digest(text), lfPin, 'Repository default must contain this final product, not a stale source');
  return { path: selectedPath, raw, text, bytes: bytes.length };
}
const chosen = selection(Object.fromEntries(ENV.map(key => [key, process.env[key]])));
const selected = { js: readOne(chosen?.jsPath ?? resolve(repoRoot, 'backstage.js'), chosen?.jsRaw, PINS.jsLf, false),
  html: readOne(chosen?.htmlPath ?? resolve(repoRoot, 'backstage/index.html'), chosen?.htmlRaw, PINS.htmlLf, true) };
const functionNames = [
  'settlementReadScope', 'settlementReadAmount', 'settlementReadPreviewItem', 'settlementReadPage',
  'renderSettlementReadRows', 'renderSettlementReadMessage', 'loadSettlementSection', 'loadSettlementPage',
  'loadSettlementPartners', 'loadSettlementConversions', 'normalizePage', 'currentSettlementPeriod',
  'financialValue', 'won', 'settlementDeductions', 'settlementMath', 'creatorNames', 'settlementChildrenFromItem',
  'isStudioSettlementItem', 'settlementRowFromItem', 'settlementKeyFromItem', 'settlementMetaFromItem',
  'settlementEntryFromItem', 'localizeSettlementStatus', 'localizeSettlementConversionStatus',
  'settlementConversionRequester', 'settlementConversionEntryFromItem', 'firstValue', 'escapeHtml', 'krw', 'formatCount',
  'currentAdminRoleName', 'adminPermissionList', 'currentAdminPermissions', 'canAccessBackstageSection',
  'getCurrentSection', 'renderRows', 'renderSettlementChildren', 'renderLoadingRow', 'setLoadMore',
];
function walk(node, visit) {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
  visit(node); for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
function parts(text) {
  const ast = parse(text, { sourceType: 'script', errorRecovery: false }), nodes = new Map(), missing = [];
  const slice = node => text.slice(node.start, node.end);
  for (const name of functionNames) {
    const matches = ast.program.body.filter(node => node.type === 'FunctionDeclaration' && node.id?.name === name);
    assert.ok(matches.length <= 1, 'No duplicate actual function: ' + name);
    if (!matches.length) missing.push(name); else nodes.set(name, matches[0]);
  }
  const tables = ast.program.body.filter(node => node.type === 'VariableDeclaration' && node.declarations.length === 1
    && node.declarations[0].id.name === 'tableMeta');
  assert.equal(tables.length, 1); assert.equal(tables[0].declarations[0].init.type, 'ObjectExpression');
  const wires = ast.program.body.filter(node => node.type === 'ExpressionStatement'
    && node.expression.type === 'CallExpression' && node.expression.callee.type === 'MemberExpression'
    && node.expression.callee.property.name === 'forEach'
    && node.expression.callee.object.type === 'CallExpression'
    && node.expression.callee.object.callee.object?.name === 'document'
    && node.expression.callee.object.callee.property?.name === 'querySelectorAll'
    && node.expression.callee.object.arguments[0]?.value === '[data-load-more]');
  assert.equal(wires.length, 1, 'One actual load-more wiring block');
  const money = nodes.has('financialValue') && nodes.has('localizeSettlementStatus')
    ? digest(text.slice(nodes.get('financialValue').start, nodes.get('localizeSettlementStatus').start).replace(/\n+$/u, '')) : null;
  return { missing, nodes, money, wireNode: wires[0], wire: slice(wires[0]),
    code: [slice(tables[0]), ...[...nodes.values()].map(slice)].join('\n'),
    pins: [...nodes].map(([name, node]) => ({ name, line: node.loc.start.line, sha256: digest(slice(node)) })) };
}
// Missing new function remains an oracle failure in case 01, not a fabricated baseline helper.
const product = parts(selected.js.text);
export const sourcePins = { sourceMode: chosen ? 'explicit_raw_pair' : 'repository_default_uniform_newline',
  js: { path: selected.js.path, sha256: selected.js.raw }, html: { path: selected.html.path, sha256: selected.html.raw },
  defaultCanonical: PINS, functionPins: product.pins, wiringSha256: digest(product.wire), oldTestsImported: 0 };

const authFor = (suffix = 'a') => ({ accessToken: 'synthetic-access-' + suffix, refreshToken: 'synthetic-refresh-' + suffix,
  user: { id: 'synthetic-operator-' + suffix, adminUser: { id: 'synthetic-admin-' + suffix,
    status: 'active', roleName: 'settlement_admin', permissions: ['payments:read'] } } });
const financials = value => ({ grossRevenueKrw: value, netRevenueKrw: value, creatorShareKrw: value });
const artist = (id = 'synthetic-main-artist') => ({ id, period: '2026-10', artist: { id, displayName: id },
  creators: [{ id: 'synthetic-creator', displayName: 'Synthetic creator' }], status: 'estimated',
  eventCount: 2, grossLumina: 12, financials: financials(120) });
const partner = (id = 'synthetic-partner', key = id + ':2026-10') => ({ type: 'studio_operator', period: '2026-10',
  settlementKey: key, partner: { userId: id, displayName: id }, artists: [artist('synthetic-child-' + id)],
  status: 'estimated', grossLumina: 12, financials: financials(120) });
const mainStudio = id => ({ ...partner(id), partner: { id, displayName: id } });
const conversion = id => ({ id, requester: { displayName: id }, settlementKey: id + ':2026-10',
  amountKrw: 120, requestedLumina: 12, status: 'requested' });
const page = (items = [], nextCursor = null, hasMore = false) => ({ items, nextCursor, hasMore });
const keys = rows => plain(rows.map(row => row.meta.settlementKey));
function sink(loadMore) {
  const classes = new Set(), handlers = new Map();
  return { innerHTML: '', textContent: '', disabled: false, dataset: { loadMore }, handlers,
    addEventListener(name, handler) { assert.equal(name, 'click'); assert.equal(handlers.has(name), false); handlers.set(name, handler); },
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value),
      toggle(value, force) { const add = force === undefined ? !classes.has(value) : Boolean(force);
        if (add) classes.add(value); else classes.delete(value); return add; } } };
}
function harness(t) {
  assert.deepEqual(product.missing, [], 'Actual product required, no substitute new helper');
  let auth = authFor(), section = 'payouts';
  const clock = { period: '2026-10' }, nodes = new Map(), requests = [], tasks = [], violations = [], renders = [];
  const dashboard = sink(), mainMore = sink('settlement'), partnerMore = sink('settlement-partners');
  const node = id => { if (!nodes.has(id)) nodes.set(id, sink()); return nodes.get(id); };
  TABLES.forEach(node); node('settlementNotice');
  for (const id of ['userRows', 'creatorRows', 'logRows', 'overviewQueueRows']) node(id).innerHTML = 'synthetic-unrelated-' + id;
  const unrelated = () => plain(Object.fromEntries(['userRows', 'creatorRows', 'logRows', 'overviewQueueRows'].map(id => [id,
    { innerHTML: node(id).innerHTML, textContent: node(id).textContent }])));
  const otherBefore = unrelated();
  const forbidden = label => { violations.push(label); throw new Error('Forbidden synthetic fixture side effect: ' + label); };
  const context = createContext({ URLSearchParams,
    Date: class extends Date { constructor(...args) { if (args.length) super(...args); else super(clock.period + '-01T12:00:00Z'); } },
    sectionState: { settlement: {} }, backstageAuthEpoch: 1, dashboardView: dashboard, getBackstageAuth: () => auth,
    document: { getElementById: node,
      querySelector(selector) {
        if (selector === '.dashboard-main') return { getAttribute(name) { assert.equal(name, 'data-active-section'); return section; } };
        if (selector === '[data-load-more="settlement"]' || selector === '.load-more-action[data-load-more="settlement"]') return mainMore;
        if (selector === '[data-load-more="settlement-partners"]') return partnerMore;
        return forbidden('unexpected DOM selector');
      },
      querySelectorAll(selector) { assert.equal(selector, '[data-load-more]'); return [mainMore, partnerMore]; } },
    adminApiPath: path => '/admin/api/v1' + path,
    backstageFetch(path, fetchOptions = {}) {
      try {
        assert.ok(requests.length < 16, 'At most 16 controlled GETs per memory fixture');
        const url = new URL(path, 'https://synthetic.invalid');
        assert.equal(url.origin, 'https://synthetic.invalid'); assert.ok([MAIN, PARTNER, CONVERSIONS].includes(url.pathname));
        assert.equal(fetchOptions.method || 'GET', 'GET'); assert.equal(fetchOptions.auth, true);
        assert.equal(fetchOptions.body, undefined); assert.equal(fetchOptions.headers, undefined);
        assert.equal(typeof fetchOptions.isCurrent, 'function'); assert.equal(fetchOptions.isCurrent(), true);
        assert.equal(url.searchParams.get('period'), clock.period); assert.equal(url.searchParams.get('take'), '20');
        const expected = url.pathname === CONVERSIONS ? ['period', 'status', 'take', 'type']
          : url.pathname === PARTNER ? ['period', 'settlementRateBps', 'take'] : ['period', 'take'];
        if (url.searchParams.has('cursor')) { assert.notEqual(url.pathname, CONVERSIONS); expected.push('cursor'); }
        assert.deepEqual([...url.searchParams.keys()].sort(), expected.sort());
        if (url.pathname === PARTNER) assert.equal(url.searchParams.get('settlementRateBps'), '5000');
        if (url.pathname === CONVERSIONS) {
          assert.equal(url.searchParams.get('type'), 'artist'); assert.equal(url.searchParams.get('status'), 'requested');
        }
        let yes, no; const promise = new Promise((resolve, reject) => { yes = resolve; no = reject; });
        const request = { url, options: fetchOptions, pending: true,
          reply(value) { assert.equal(request.pending, true); request.pending = false; yes(value); },
          fail(error = new Error('Synthetic unavailable')) { assert.equal(request.pending, true); request.pending = false; no(error); } };
        requests.push(request); return promise;
      } catch (error) { violations.push(error.message); throw error; }
    },
    creatorsNativeReadonlyCurrent: () => false, creatorsNativeIsTable: () => false, creatorsNativeReadonlyRestricted: () => false,
    localizeWorkflowStatus: value => String(value || '-'), statusBadge: value => '<span>' + String(value) + '</span>',
    console: { warn: () => forbidden('console warn'), log: () => forbidden('console log') },
    fetch: () => forbidden('native fetch'), setBackstageAuth: () => forbidden('auth write'),
    refreshBackstageAuthOnce: () => forbidden('auth refresh'), loadUsersPage: () => forbidden('unrelated user read'),
    loadAuditPage: () => forbidden('unrelated audit read'), getSavedSection: () => forbidden('saved-section read'),
    localStorage: new Proxy({}, { get: () => forbidden('storage') }),
    window: new Proxy({}, { get: () => forbidden('window or navigation') }),
    setTimeout: () => forbidden('timer or retry'), setInterval: () => forbidden('timer or interval'),
  }, { codeGeneration: { strings: false, wasm: false } });
  runInContext(product.code + '\n' + product.wire, context, { timeout: 1000, filename: selected.js.path });
  const actualRender = context.renderRows;
  context.renderRows = (id, rows, statusIndex) => { renders.push({ id, rows: plain(rows), statusIndex }); return actualRender(id, rows, statusIndex); };
  const track = value => { if (value && typeof value.then === 'function') tasks.push(value); return value; };
  const invoke = (name, ...args) => {
    assert.ok(functionNames.includes(name)); context.fixtureArgs = args;
    try { return track(runInContext(name + '(...fixtureArgs)', context, { timeout: 1000 })); }
    finally { delete context.fixtureArgs; }
  };
  const click = which => { const control = which === 'partner' ? partnerMore : mainMore;
    assert.equal(typeof control.handlers.get('click'), 'function'); return track(control.handlers.get('click')()); };
  const pending = (route, from = 0) => { const found = requests.slice(from).find(request => request.pending && request.url.pathname === route);
    assert.ok(found, 'Missing controlled GET'); return found; };
  const state = () => context.sectionState.settlement;
  const visible = id => node(id).innerHTML + '\n' + node(id).textContent;
  const dom = () => plain({ tables: Object.fromEntries([...nodes].map(([id, element]) => [id,
    { innerHTML: element.innerHTML, textContent: element.textContent }])),
    mainPager: { disabled: mainMore.disabled, hidden: mainMore.classList.contains('is-hidden') },
    partnerPager: { disabled: partnerMore.disabled, hidden: partnerMore.classList.contains('is-hidden') } });
  t.after(async () => {
    for (const request of requests) if (request.pending) request.fail();
    await Promise.allSettled(tasks);
    assert.deepEqual(violations, []); assert.deepEqual(unrelated(), otherBefore, 'No unrelated/private-other-table changes');
    assert.ok(requests.every(request => !request.pending));
    assert.equal(digest(readFileSync(selected.js.path)), selected.js.raw, 'JS source remains frozen');
    assert.equal(digest(readFileSync(selected.html.path)), selected.html.raw, 'HTML source remains frozen');
  });
  return { context, clock, requests, renders, mainMore, partnerMore, dashboard, node, state, visible, dom, invoke, click, pending,
    get auth() { return auth; }, set auth(value) { auth = value; }, get section() { return section; }, set section(value) { section = value; } };
}
async function ready(h, main = page([artist()]), partners = page([partner()], 'partner-A', true)) {
  const start = h.requests.length, work = h.invoke('loadSettlementSection');
  assert.equal(h.requests.length - start, 3, 'First load retains exactly three original reads');
  assert.deepEqual(h.requests.slice(start).map(request => request.url.pathname), [MAIN, PARTNER, CONVERSIONS]);
  for (const request of h.requests.slice(start)) assert.equal(request.url.searchParams.has('cursor'), false);
  h.pending(MAIN, start).reply(main); h.pending(PARTNER, start).reply(partners);
  h.pending(CONVERSIONS, start).reply(page([conversion('synthetic-conversion')])); await work; return h.state();
}
function known(h) {
  const state = h.state(); return plain({ rows: state.rows, studioRows: state.studioRows, partnerRows: state.partnerRows,
    mainStudioRows: state.mainStudioRows, conversionRows: state.conversionRows, cursor: state.cursor, hasMore: state.hasMore,
    partnerCursor: state.partnerCursor, partnerHasMore: state.partnerHasMore, partnerCursors: state.partnerCursors,
    readContext: state.readContext });
}
function closed(h) {
  const state = h.state();
  for (const key of ['rows', 'studioRows', 'partnerRows', 'mainStudioRows', 'conversionRows', 'partnerCursors']) assert.deepEqual(plain(state[key]), []);
  assert.equal(state.cursor, null); assert.equal(state.partnerCursor, null); assert.equal(state.hasMore, false);
  assert.equal(state.partnerHasMore, false); assert.equal(state.readContext, null);
  assert.equal(h.mainMore.classList.contains('is-hidden'), true); assert.equal(h.partnerMore.classList.contains('is-hidden'), true);
  for (const id of TABLES) assert.doesNotMatch(h.visible(id), /synthetic-(?:partner|main|conversion)/);
}

test('ADMIN.PARTNER.01 actual independent pager, HTML control, portable admission and unchanged money helpers', options, t => {
  assert.equal(normalize(Buffer.from('one\r\ntwo\r\n')), 'one\ntwo\n');
  assert.throws(() => normalize(Buffer.from('one\ntwo\r\n')), /Uniform/);
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<html>')]);
  assert.throws(() => normalize(bom), /No JS BOM/);
  assert.equal(normalize(bom, true), '\uFEFF<html>');
  t.diagnostic(JSON.stringify(sourcePins));
  assert.deepEqual(product.missing, [], 'Baseline RED: require the actual new partner loader');
  assert.equal(product.money, PINS.money, 'No money/helper policy change');
  const buttons = [...selected.html.text.matchAll(/<button\b([^>]*\bdata-load-more=["']settlement-partners["'][^>]*)>([\s\S]*?)<\/button>/g)];
  assert.equal(buttons.length, 1); assert.match(buttons[0][1], /\btype=["']button["']/);
  assert.match(buttons[0][1], /\bclass=["'][^"']*load-more-action[^"']*is-hidden/);
  assert.equal(buttons[0][2].trim(), '\uc6b4\uc601\uc790 \ub354 \ubcf4\uae30');
  assert.match(selected.html.text, /backstage\.js\?v=admin-partner-pagination-20261015/);
  const calls = [], disables = [], branches = []; walk(product.wireNode, node => {
    if (node.type === 'CallExpression' && node.callee.name === 'loadSettlementPartners') calls.push(node);
    if (node.type === 'AssignmentExpression' && node.left.object?.name === 'button' && node.left.property?.name === 'disabled') disables.push(node);
    if (node.type === 'IfStatement' && ['settlement', 'settlement-partners'].includes(node.test.right?.value)) branches.push(node);
  });
  assert.equal(calls.length, 1); assert.equal(calls[0].arguments.length, 1); assert.equal(calls[0].arguments[0].value, true);
  assert.equal(disables.length, 1); assert.equal(branches.length, 2);
  for (const branch of branches) {
    assert.ok(branch.end < disables[0].start, 'Settlement branches bypass shared button mutation');
    assert.equal(branch.consequent.type, 'BlockStatement'); assert.equal(branch.consequent.body.at(-1).type, 'ReturnStatement');
  }
  assert.equal(selection({}), null);
  const explicit = { [ENV[0]]: selected.js.path, [ENV[1]]: selected.js.raw, [ENV[2]]: selected.html.path, [ENV[3]]: selected.html.raw };
  assert.ok(selection(explicit)); for (const key of ENV) { const incomplete = { ...explicit }; delete incomplete[key]; assert.throws(() => selection(incomplete)); }
  assert.throws(() => allowedPath(resolve(repoRoot, 'story-completion-20261003/backstage.js')), /Shared CLEAN/);
  assert.throws(() => selection({ ...explicit, [ENV[1]]: 'not-a-sha' }));
  assert.equal(normalize(Buffer.from('synthetic\n')), normalize(Buffer.from('synthetic\r\n')));
  assert.throws(() => normalize(Buffer.from('synthetic\rbroken')));
});

test('ADMIN.PARTNER.02 first 20 partner rows have an independent explicit next GET when main has no more', options, async t => {
  const h = harness(t), first = Array.from({ length: 20 }, (_, i) => partner('synthetic-partner-' + i));
  await ready(h, page([artist()]), page(first, 'partner-A', true));
  assert.equal(h.state().partnerRows.length, 20); assert.equal(h.state().rows.length, 1);
  assert.equal(h.state().partnerCursor, 'partner-A'); assert.equal(h.state().cursor, null);
  assert.equal(h.mainMore.classList.contains('is-hidden'), true); assert.equal(h.partnerMore.classList.contains('is-hidden'), false);
  const savedMain = plain(h.state().rows), work = h.click('partner'); assert.equal(h.requests.length, 4);
  assert.equal(h.partnerMore.disabled, true); assert.equal(h.partnerMore.classList.contains('is-hidden'), false);
  const request = h.pending(PARTNER, 3); assert.equal(request.url.searchParams.get('cursor'), 'partner-A');
  assert.equal(request.url.searchParams.get('period'), '2026-10'); assert.equal(request.url.searchParams.get('take'), '20');
  assert.equal(request.url.searchParams.get('settlementRateBps'), '5000');
  request.reply(page([partner('synthetic-partner-20')], 'partner-B', true)); await work;
  assert.equal(h.state().partnerRows.length, 21); assert.deepEqual(plain(h.state().rows), savedMain);
  assert.equal(h.state().partnerCursor, 'partner-B'); assert.equal(h.state().hasMore, false);
  assert.equal(h.requests.length, 4, 'No automatic all-pages read');
  assert.match(h.visible('studioSettlementRows'), /synthetic-partner-20/);
});

test('ADMIN.PARTNER.03 terminal and empty terminal partner pages preserve rows and close only the partner pager', options, async t => {
  for (const finalItems of [[], [partner('synthetic-partner-last')]]) {
    const h = harness(t); await ready(h, page([artist()], 'main-A', true));
    const before = known(h), work = h.click('partner'); h.pending(PARTNER, 3).reply(page(finalItems)); await work;
    assert.equal(h.state().partnerRows.length, 1 + finalItems.length); assert.equal(h.state().partnerCursor, null);
    assert.equal(h.state().partnerHasMore, false); assert.equal(h.state().partnerLoading, false);
    assert.equal(h.partnerMore.classList.contains('is-hidden'), true); assert.equal(h.partnerMore.disabled, false);
    assert.equal(h.state().cursor, before.cursor); assert.equal(h.state().hasMore, true);
    await h.invoke('loadSettlementPartners', true); assert.equal(h.requests.length, 4);
    assert.doesNotMatch(h.visible('studioSettlementRows'), PARTIAL_ERROR);
  }
});

test('ADMIN.PARTNER.04 main append, double clicks and blocked interleaving retain independent studio rows and cursors', options, async t => {
  const h = harness(t); await ready(h, page([artist(), mainStudio('synthetic-main-studio-1')], 'main-A', true));
  const first = keys(h.state().partnerRows), mainWork = h.click('main');
  assert.equal(h.mainMore.disabled, true); assert.equal(h.partnerMore.disabled, false);
  await h.click('partner'); assert.equal(h.requests.length, 4);
  assert.equal(h.partnerMore.disabled, false, 'Main pending cross-click cannot strand partner button');
  assert.equal(h.partnerMore.classList.contains('is-hidden'), false);
  assert.equal(h.pending(MAIN, 3).url.searchParams.get('cursor'), 'main-A');
  h.pending(MAIN, 3).reply(page([artist('synthetic-main-artist-2'), mainStudio('synthetic-main-studio-2')], 'main-B', true)); await mainWork;
  assert.deepEqual(keys(h.state().partnerRows), first); assert.equal(h.state().mainStudioRows.length, 2);
  assert.equal(h.state().studioRows.length, 3); assert.equal(h.state().partnerCursor, 'partner-A');
  const state = h.state(), partnerWork = h.click('partner');
  assert.equal(h.partnerMore.disabled, true); assert.equal(h.mainMore.disabled, false);
  await h.click('partner'); await h.click('main'); await h.invoke('loadSettlementSection');
  assert.equal(h.requests.length, 5); assert.equal(h.state(), state, 'Full refresh blocked during current partner read');
  assert.equal(h.mainMore.disabled, false, 'Partner pending cross-click cannot strand main button');
  assert.equal(h.partnerMore.disabled, true); assert.equal(h.partnerMore.classList.contains('is-hidden'), false);
  h.pending(PARTNER, 4).reply(page([partner('synthetic-partner-2')], 'partner-B', true)); await partnerWork;
  assert.equal(h.state().rows.length, 2); assert.equal(h.state().mainStudioRows.length, 2);
  assert.equal(h.state().studioRows.length, 4); assert.equal(h.state().cursor, 'main-B');
  assert.equal(h.state().partnerCursor, 'partner-B'); assert.equal(h.requests.length, 5);
  assert.equal(h.mainMore.disabled, false); assert.equal(h.partnerMore.disabled, false);
});

test('ADMIN.PARTNER.05 failure, malformed, no-advance, empty-more and A-B-A cycle keep known data for explicit retry', options, async t => {
  const bad = [null, { items: [partner('synthetic-invalid')], hasMore: 'yes', nextCursor: 'partner-B' },
    { items: [{ ...partner('synthetic-invalid'), financials: null }], hasMore: false, nextCursor: null },
    page([partner('synthetic-invalid')], 'partner-A', true), page([], 'partner-B', true),
    page([partner('synthetic-all-known', 'synthetic-partner:2026-10')], 'partner-B', true)];
  for (const response of bad) {
    const h = harness(t); await ready(h); const before = known(h), work = h.click('partner');
    if (response === null) h.pending(PARTNER, 3).fail(); else h.pending(PARTNER, 3).reply(response); await work;
    assert.deepEqual(known(h), before); assert.equal(h.state().partnerReadUnavailable, true);
    assert.match(h.visible('studioSettlementRows'), PARTIAL_ERROR); assert.equal(h.requests.length, 4);
    assert.equal(h.partnerMore.classList.contains('is-hidden'), false); assert.equal(h.partnerMore.disabled, false);
    const retry = h.click('partner'); assert.equal(h.pending(PARTNER, 4).url.searchParams.get('cursor'), 'partner-A');
    h.pending(PARTNER, 4).reply(page([partner('synthetic-retry-ok')])); await retry;
    assert.equal(h.state().partnerRows.length, 2); assert.equal(h.state().partnerReadUnavailable, false);
    assert.equal(h.requests.length, 5); assert.doesNotMatch(h.visible('studioSettlementRows'), PARTIAL_ERROR);
  }
  const h = harness(t); await ready(h);
  const advance = h.click('partner'); h.pending(PARTNER, 3).reply(page([partner('synthetic-partner-b')], 'partner-B', true)); await advance;
  const before = known(h), cycle = h.click('partner');
  h.pending(PARTNER, 4).reply(page([partner('synthetic-cycle-rejected')], 'partner-A', true)); await cycle;
  assert.deepEqual(known(h), before); assert.match(h.visible('studioSettlementRows'), PARTIAL_ERROR);
  const retry = h.click('partner'); assert.equal(h.pending(PARTNER, 5).url.searchParams.get('cursor'), 'partner-B');
  h.pending(PARTNER, 5).reply(page([partner('synthetic-cycle-retry-ok')])); await retry;
  assert.equal(h.state().partnerRows.length, 3); assert.equal(h.requests.length, 6);
});

test('ADMIN.PARTNER.06 late success cannot commit after identity, permission, month, section, hidden view, state replacement or ABA', options, async t => {
  const changes = [h => { h.auth = authFor('b'); }, h => { h.auth.user.adminUser.permissions = ['unrelated:read']; },
    h => { h.clock.period = '2026-11'; }, h => { h.section = 'overview'; }, h => { h.dashboard.classList.add('is-hidden'); },
    h => { h.context.sectionState.settlement = { syntheticNewState: true }; },
    h => { h.auth = authFor('b'); h.context.backstageAuthEpoch++; h.auth = authFor('a'); h.context.backstageAuthEpoch++; }];
  for (const change of changes) {
    const h = harness(t); await ready(h); const work = h.click('partner'), request = h.pending(PARTNER, 3);
    change(h); const current = plain(h.state()), dom = h.dom(); assert.equal(request.options.isCurrent(), false);
    request.reply(page([partner('synthetic-late-forbidden')])); await work;
    const after = plain(h.state()); delete after.partnerLoading; delete current.partnerLoading;
    assert.deepEqual(after, current); assert.deepEqual(h.dom(), dom); assert.equal(h.requests.length, 4);
    assert.doesNotMatch(h.visible('studioSettlementRows'), /synthetic-late-forbidden/);
  }
});

test('ADMIN.PARTNER.07 missing refreshed admin context clears both pagers and all private rows without auth actions', options, async t => {
  const h = harness(t); await ready(h, page([artist(), mainStudio('synthetic-main-studio')], 'main-A', true));
  const work = h.click('partner'), request = h.pending(PARTNER, 3);
  h.auth = { accessToken: 'synthetic-replaced-token', refreshToken: 'synthetic-refresh-only', user: { id: h.auth.user.id } };
  assert.equal(request.options.isCurrent(), false); request.reply(page([partner('synthetic-late-forbidden')])); await work;
  closed(h); await h.invoke('loadSettlementPartners', true); assert.equal(h.requests.length, 4);
});

test('ADMIN.PARTNER.08 current partner 401 or 403 clears private data while late old-owner denial cannot clear fresh data', options, async t => {
  for (const error of [{ status: 401 }, { body: { statusCode: 403 } }]) {
    const h = harness(t); await ready(h, page([artist(), mainStudio('synthetic-main-studio')], 'main-A', true));
    const auth = JSON.stringify(h.auth), work = h.click('partner'); h.pending(PARTNER, 3).fail(error); await work;
    closed(h); assert.equal(JSON.stringify(h.auth), auth); assert.equal(h.requests.length, 4);
  }
  const h = harness(t); await ready(h); const old = h.click('partner'), denied = h.pending(PARTNER, 3);
  h.auth = authFor('b'); h.context.backstageAuthEpoch++;
  await ready(h, page([artist('synthetic-fresh-owner-main')]), page([partner('synthetic-fresh-owner-partner')], 'fresh-A', true));
  const before = known(h), dom = h.dom(); denied.fail({ status: 401 }); await old;
  assert.deepEqual(known(h), before); assert.deepEqual(h.dom(), dom); assert.equal(h.requests.length, 7);
});

test('ADMIN.PARTNER.09 initial 401 or 403 on each of the three reads closes private state without replay', options, async t => {
  for (const route of [MAIN, PARTNER, CONVERSIONS]) for (const status of [401, 403]) {
    const h = harness(t), work = h.invoke('loadSettlementSection'); assert.equal(h.requests.length, 3);
    for (const request of h.requests) {
      if (request.url.pathname === route) request.fail({ status });
      else request.reply(request.url.pathname === MAIN ? page([artist('synthetic-main-sensitive')])
        : request.url.pathname === PARTNER ? page([partner('synthetic-partner-sensitive')], 'partner-A', true)
          : page([conversion('synthetic-conversion-sensitive')]));
    }
    await work; closed(h); assert.equal(h.requests.length, 3);
  }
});

test('ADMIN.PARTNER.10 initial failed main preserves good partner page and keeps main failure visible after partner next', options, async t => {
  for (const failedMain of ['reject', 'malformed']) {
    const h = harness(t), work = h.invoke('loadSettlementSection');
    if (failedMain === 'reject') h.pending(MAIN).fail(); else h.pending(MAIN).reply({ items: 'not-a-page' });
    h.pending(PARTNER).reply(page([partner('synthetic-partner-good')], 'partner-A', true));
    h.pending(CONVERSIONS).reply(page([conversion('synthetic-conversion-good')])); await work;
    assert.equal(h.requests.length, 3); assert.equal(h.state().partnerRows.length, 1); assert.equal(h.state().studioRows.length, 1);
    assert.equal(h.state().mainStudioRows.length, 0); assert.equal(h.state().rows.length, 0);
    assert.equal(h.state().primaryReadUnavailable, true); assert.equal(h.state().partnerCursor, 'partner-A');
    assert.equal(h.partnerMore.classList.contains('is-hidden'), false); assert.match(h.visible('settlementRows'), PRIMARY_ERROR);
    assert.match(h.visible('studioSettlementRows'), /synthetic-partner-good/);
    const next = h.click('partner'); h.pending(PARTNER, 3).reply(page([partner('synthetic-partner-next')])); await next;
    assert.equal(h.state().studioRows.length, 2); assert.equal(h.state().conversionRows.length, 1);
    assert.equal(h.state().primaryReadUnavailable, true); assert.match(h.visible('settlementRows'), PRIMARY_ERROR);
    assert.equal(h.requests.length, 4); assert.equal(h.state().hasMore, false);
  }
});

test('ADMIN.PARTNER.11 initial partner failure or empty-more preserves verified main studio rows with no invented cursor', options, async t => {
  for (const initial of ['reject', 'empty_more']) {
    const h = harness(t), work = h.invoke('loadSettlementSection');
    h.pending(MAIN).reply(page([artist(), mainStudio('synthetic-main-studio-good')], 'main-A', true));
    if (initial === 'reject') h.pending(PARTNER).fail(); else h.pending(PARTNER).reply(page([], 'partner-A', true));
    h.pending(CONVERSIONS).reply(page([conversion('synthetic-conversion-good')])); await work;
    assert.equal(h.state().rows.length, 1); assert.equal(h.state().mainStudioRows.length, 1); assert.equal(h.state().studioRows.length, 1);
    assert.equal(h.state().partnerRows.length, 0); assert.equal(h.state().partnerCursor, null); assert.equal(h.state().partnerHasMore, false);
    assert.equal(h.partnerMore.classList.contains('is-hidden'), true); assert.equal(h.state().cursor, 'main-A');
    assert.match(h.visible('studioSettlementRows'), PARTIAL_ERROR); await h.invoke('loadSettlementPartners', true);
    assert.equal(h.requests.length, 3, 'No automatic or guessed first-partner retry');
  }
});

test('ADMIN.PARTNER.12 backend settlementKey dedup retains known rows; non-payout or missing grants begin no read', options, async t => {
  const h = harness(t); await ready(h); const first = plain(h.state().partnerRows), work = h.click('partner');
  h.pending(PARTNER, 3).reply(page([partner('synthetic-changed-duplicate', 'synthetic-partner:2026-10'),
    partner('synthetic-distinct'), partner('synthetic-distinct-duplicate', 'synthetic-distinct:2026-10')])); await work;
  assert.equal(h.state().partnerRows.length, 2); assert.deepEqual(plain(h.state().partnerRows[0]), first[0]);
  assert.deepEqual(keys(h.state().partnerRows), ['synthetic-partner:2026-10', 'synthetic-distinct:2026-10']);
  assert.doesNotMatch(h.visible('studioSettlementRows'), /synthetic-changed-duplicate|synthetic-distinct-duplicate/);
  for (const change of [fixture => { fixture.section = 'overview'; }, fixture => { fixture.dashboard.classList.add('is-hidden'); },
    fixture => { fixture.auth = { ...authFor(), user: { id: 'synthetic-operator-a', adminUser: { id: 'synthetic-admin-a',
      status: 'active', roleName: 'cs_admin', permissions: [] } } }; }]) {
    const fixture = harness(t); change(fixture); const dom = fixture.dom();
    await fixture.invoke('loadSettlementSection'); await fixture.invoke('loadSettlementPartners', true);
    assert.equal(fixture.requests.length, 0); assert.deepEqual(fixture.dom(), dom);
  }
});
