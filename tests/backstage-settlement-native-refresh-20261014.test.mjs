import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { win32 } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

// Authored UNRUN: actual selected native functions, synthetic memory DOM/auth/fetch only.
const PATH_ENV = 'LUMINA_SETTLEMENT_READ_JS_PATH';
const SHA_ENV = 'LUMINA_SETTLEMENT_READ_JS_SHA256';
const defaultPath = fileURLToPath(new URL('../backstage.js', import.meta.url));
const { parse } = createRequire(new URL('../server/package.json', import.meta.url))('@babel/parser');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const timeout = { timeout: 5000 };
const MAIN = '/admin/api/v1/backstage/operations/settlement-preview';
const PARTNER = '/admin/api/v1/backstage/operations/partner-settlement-preview';
const CONVERSIONS = '/admin/api/v1/backstage/settlement-conversions';
const REFRESH = '/api/v1/auth/refresh';
const TABLES = ['studioSettlementRows', 'settlementRows', 'settlementConversionRows'];
const REVERIFY = '\uc6b4\uc601\uc790 \ud655\uc778\uc774 \ud544\uc694\ud569\ub2c8\ub2e4.';
const AUTH_KEY = 'lumina_backstage_auth';

function selection(env) {
  const path = env[PATH_ENV], pin = env[SHA_ENV];
  if (path === undefined && pin === undefined) return null;
  assert.equal(typeof path, 'string', 'Source override requires paired path and RAW SHA256');
  assert.equal(typeof pin, 'string', 'Source override requires paired path and RAW SHA256');
  assert.match(path, /^E:[\\/]/i); assert.ok(win32.isAbsolute(path));
  assert.equal(win32.extname(path).toLowerCase(), '.js'); assert.match(pin, /^[a-f0-9]{64}$/i);
  return { path, pin: pin.toLowerCase() };
}

function normalize(bytes) {
  assert.equal(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false, 'No source BOM');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const crlf = (text.match(/\r\n/g) || []).length, lf = (text.match(/\n/g) || []).length;
  assert.ok(crlf === 0 || crlf === lf, 'Mixed LF/CRLF source rejected');
  const normalized = text.replace(/\r\n/g, '\n'); assert.equal(normalized.includes('\r'), false);
  return normalized;
}

function verify(bytes, pin) { assert.equal(digest(bytes), pin, 'Selected source RAW bytes must match'); }
const override = selection(process.env);
const sourcePath = override ? realpathSync(override.path) : defaultPath;
if (override) assert.match(sourcePath, /^E:[\\/]/i, 'Resolved override must remain on E');
const stat = lstatSync(sourcePath);
assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 1024 * 1024);
const sourceBytes = readFileSync(sourcePath);
if (override) verify(sourceBytes, override.pin);
const source = normalize(sourceBytes), ast = parse(source, { sourceType: 'script', errorRecovery: false });
const slice = node => source.slice(node.start, node.end);
function oneFunction(name) {
  const matches = ast.program.body.filter(node => node.type === 'FunctionDeclaration' && node.id?.name === name);
  assert.equal(matches.length, 1, 'Actual unique top-level function required: ' + name); return matches[0];
}
function walk(node, visit) {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
function declaration(name) {
  const matches = ast.program.body.filter(node => node.type === 'VariableDeclaration')
    .flatMap(node => node.declarations).filter(node => node.id.type === 'Identifier' && node.id.name === name);
  assert.equal(matches.length, 1); return matches[0].init;
}
function literal(node, allowAuthKey = false) {
  if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral'].includes(node.type)) return;
  if (allowAuthKey && node.type === 'Identifier' && node.name === 'BACKSTAGE_AUTH_KEY') return;
  if (node.type === 'ArrayExpression') { node.elements.forEach(child => { assert.ok(child); literal(child, allowAuthKey); }); return; }
  assert.equal(node.type, 'ObjectExpression');
  node.properties.forEach(prop => {
    assert.ok(prop.type === 'ObjectProperty' && !prop.computed && !prop.shorthand);
    assert.ok(['Identifier', 'StringLiteral'].includes(prop.key.type)); literal(prop.value, allowAuthKey);
  });
}
const functionNames = ['getBackstageAuth', 'setBackstageAuth', 'normalizeAuthPayload',
  'backstageFetch', 'refreshBackstageAuthOnce', 'publicApiPath', 'adminApiPath',
  'settlementReadScope', 'settlementReadAmount', 'settlementReadPreviewItem', 'settlementReadPage',
  'renderSettlementReadRows', 'renderSettlementReadMessage', 'loadSettlementSection', 'loadSettlementPage', 'loadSettlementConversions',
  'normalizePage', 'currentSettlementPeriod', 'currentAdminRoleName', 'adminPermissionList',
  'currentAdminPermissions', 'canAccessBackstageSection', 'getCurrentSection', 'firstValue',
  'renderRows', 'renderSettlementChildren', 'renderLoadingRow', 'setLoadMore', 'statusBadge',
  'creatorsNativeIsTable', 'escapeHtml'];
const metadata = ['BACKSTAGE_AUTH_KEY', 'SHARED_AUTH_KEYS', 'statusClassMap'].map(name => {
  const init = declaration(name); literal(init, name === 'SHARED_AUTH_KEYS');
  return 'const ' + name + ' = ' + slice(init) + ';';
});
const table = declaration('tableMeta'); assert.equal(table.type, 'ObjectExpression');
metadata.push('const tableMeta = {' + TABLES.map(id => {
  const matches = table.properties.filter(prop => (prop.key.name || prop.key.value) === id);
  assert.equal(matches.length, 1); literal(matches[0].value); return slice(matches[0]);
}).join(',\n') + '};');
const productCode = [...metadata, ...functionNames.map(name => slice(oneFunction(name)))].join('\n');
const bootstrapNode = oneFunction('bootstrapBackstage'); // Static logout witness only; not evaluated.
export const sourcePins = { path: sourcePath, rawSha256: digest(sourceBytes), bytes: sourceBytes.length,
  normalizedSha256: digest(source), overrideSelected: Boolean(override),
  functions: [...functionNames, 'bootstrapBackstage'].map(name => {
    const node = oneFunction(name); return { name, line: node.loc.start.line, sha256: digest(slice(node)),
      evaluated: name !== 'bootstrapBackstage' };
  }) };

const verifiedUser = () => ({ id: 'synthetic-operator-a', displayName: 'QA operator',
  adminUser: { id: 'synthetic-admin-a', status: 'active', roleName: 'settlement_admin', permissions: ['payments:read'] } });
const originalAuth = () => ({ accessToken: 'synthetic-token-1', refreshToken: 'synthetic-refresh-1', user: verifiedUser() });
const refreshed = (user = { id: 'synthetic-operator-a', displayName: 'QA ordinary user' }) => ({
  accessToken: 'synthetic-token-2', refreshToken: 'synthetic-refresh-2', user });
const emptyPage = () => ({ items: [], hasMore: false, nextCursor: null });

function sink(id, writes) {
  const classes = new Set(); let html = '';
  return { id, disabled: false, textContent: '',
    get innerHTML() { return html; }, set innerHTML(value) { html = value; writes.push(id); },
    classList: { add: value => classes.add(value), remove: value => classes.delete(value),
      contains: value => classes.has(value), toggle(value, force) {
        const add = force === undefined ? !classes.has(value) : Boolean(force);
        if (add) classes.add(value); else classes.delete(value); return add;
      } } };
}

function harness(t, initialAuth = originalAuth()) {
  const memory = new Map([[AUTH_KEY, JSON.stringify(initialAuth)]]), storageWrites = [], writes = [], requests = [], violations = [];
  let section = 'payouts', onStore = null;
  const clock = { period: '2026-10' }, nodes = new Map(TABLES.map(id => [id, sink(id, writes)]));
  nodes.set('settlementNotice', sink('settlementNotice', writes));
  const dashboard = sink('dashboard', writes), more = sink('more', writes);
  const forbidden = name => { violations.push(name); throw new Error('Forbidden synthetic fixture branch: ' + name); };
  const context = createContext({ BACKSTAGE_API_BASE: 'https://synthetic.invalid', backstageAuthEpoch: 1,
    sectionState: { settlement: {} }, dashboardView: dashboard, URLSearchParams,
    Date: class extends Date {
      constructor() { super(clock.period + '-01T12:00:00Z'); }
      getFullYear() { return Number(clock.period.slice(0, 4)); } getMonth() { return Number(clock.period.slice(5, 7)) - 1; }
    },
    localStorage: {
      getItem(key) { assert.ok([AUTH_KEY, 'lumina_auth', 'lumina.session'].includes(key)); return memory.get(key) ?? null; },
      setItem(key, value) { assert.equal(key, AUTH_KEY); memory.set(key, value); storageWrites.push(key); onStore?.(); },
      removeItem(key) { assert.equal(key, AUTH_KEY); memory.delete(key); storageWrites.push(key); },
    },
    document: { getElementById(id) { return nodes.get(id) || forbidden('unknown DOM id'); },
      querySelector(selector) {
        if (selector === '.dashboard-main') return { getAttribute(name) { assert.equal(name, 'data-active-section'); return section; } };
        if (['[data-load-more="settlement"]', '.load-more-action[data-load-more="settlement"]'].includes(selector)) return more;
        return forbidden('unknown DOM selector');
      } },
    async fetch(input, options = {}) {
      const url = new URL(input); assert.equal(url.origin, 'https://synthetic.invalid');
      const method = options.method || 'GET'; assert.ok(requests.length < 8, 'Finite memory requests');
      assert.ok(method === 'POST' && url.pathname === REFRESH || method === 'GET' && [MAIN, PARTNER, CONVERSIONS].includes(url.pathname));
      if (method === 'POST') assert.deepEqual(JSON.parse(options.body), { refreshToken: 'synthetic-refresh-1' });
      else { assert.equal(options.body, undefined); assert.match(options.headers.Authorization, /^Bearer synthetic-token-[12]$/); }
      return new Promise(resolve => requests.push({ route: url.pathname, method, options, resolve, settled: false }));
    },
    console: { log: () => forbidden('logging'), warn: () => forbidden('logging'), error: () => forbidden('logging') },
    getSavedSection: () => forbidden('saved navigation'),
    creatorsNativeReadonlyCurrent: () => forbidden('unrelated native permissions'),
    creatorsNativeReadonlyRestricted: () => forbidden('unrelated native permissions'),
    settlementEntryFromItem: () => forbidden('financial mapping'),
    settlementConversionEntryFromItem: () => forbidden('financial mapping'),
    isStudioSettlementItem: () => forbidden('financial mapping'),
    setTimeout: () => forbidden('scheduled retries'), window: Object.freeze({}),
  });
  runInContext(productCode, context, { timeout: 2000 });
  const call = (name, ...args) => {
    context.__args = args;
    try { return runInContext(name + '(...__args)', context, { timeout: 2000 }); }
    finally { delete context.__args; }
  };
  async function wait(route, occurrence = 0, method = route === REFRESH ? 'POST' : 'GET') {
    for (let n = 0; n < 32; n++) {
      const found = requests.filter(row => row.route === route && row.method === method)[occurrence];
      if (found) return found; await Promise.resolve();
    }
    assert.fail('Expected finite synthetic request: ' + method + ' ' + route);
  }
  function reply(row, status = 200, body = emptyPage()) {
    assert.equal(row.settled, false); row.settled = true;
    row.resolve({ status, ok: status >= 200 && status < 300, async json() { return plain(body); } });
  }
  function seed() {
    const row = label => ({ row: [label, 'QA owner', 'QA event', '0L', '0 KRW', '0 KRW', '0 KRW', 'estimated', 'QA detail'], children: [], meta: {} });
    const state = { rows: [row('synthetic-private-creator')], studioRows: [row('synthetic-private-studio')],
      conversionRows: [['synthetic-private-conversion']], cursor: 'synthetic-cursor', hasMore: true,
      pageLoading: false, conversionLoading: false, partnerReadUnavailable: false };
    context.sectionState.settlement = state; state.readContext = call('settlementReadScope').identityKey;
    call('renderSettlementReadRows', state); nodes.get('settlementConversionRows').innerHTML = 'synthetic-private-conversion';
    more.classList.remove('is-hidden'); more.disabled = true; return state;
  }
  function snapshot(state = context.sectionState.settlement) {
    return { state, rows: state.rows, studioRows: state.studioRows, conversionRows: state.conversionRows,
      cursor: state.cursor, hasMore: state.hasMore, readContext: state.readContext,
      dom: TABLES.map(id => nodes.get(id).innerHTML), writes: writes.length,
      disabled: more.disabled, hidden: more.classList.contains('is-hidden') };
  }
  function unchanged(before) {
    for (const key of ['rows', 'studioRows', 'conversionRows', 'cursor', 'hasMore', 'readContext']) assert.equal(before.state[key], before[key], key);
    assert.deepEqual(TABLES.map(id => nodes.get(id).innerHTML), before.dom);
    assert.equal(writes.length, before.writes); assert.equal(more.disabled, before.disabled);
    assert.equal(more.classList.contains('is-hidden'), before.hidden);
  }
  function closed() {
    const state = context.sectionState.settlement;
    for (const key of ['rows', 'studioRows', 'conversionRows']) assert.equal(state[key].length, 0, key);
    assert.equal(state.cursor, null); assert.equal(state.hasMore, false); assert.equal(state.readContext, null);
    for (const id of TABLES) {
      assert.ok(nodes.get(id).innerHTML.includes(REVERIFY));
      assert.equal(nodes.get(id).innerHTML.includes('synthetic-private'), false);
    }
    assert.equal(more.classList.contains('is-hidden'), true); assert.equal(more.disabled, false);
    assert.equal(state.pageLoading, false); assert.equal(state.conversionLoading, false);
    assert.deepEqual(plain(call('currentAdminPermissions')), []);
    assert.equal(call('canAccessBackstageSection', 'payouts'), false);
    assert.equal(call('getBackstageAuth').user.adminUser, undefined);
    assert.equal(call('getBackstageAuth').user.adminPermissions, undefined);
  }
  t.after(() => {
    const pending = requests.filter(row => !row.settled); pending.forEach(row => reply(row, 503, {}));
    assert.equal(pending.length, 0, 'All synthetic requests settled'); assert.deepEqual(violations, []);
    assert.equal(digest(readFileSync(sourcePath)), sourcePins.rawSha256, 'Source stable after fixture');
  });
  return { context, call, wait, reply, seed, snapshot, unchanged, closed, more, dashboard, requests, storageWrites,
    auth: () => call('getBackstageAuth'), injectAuth: auth => memory.set(AUTH_KEY, JSON.stringify(auth)),
    onStore: fn => { onStore = fn; }, setSection: value => { section = value; }, clock };
}

async function ordinaryRefresh(h, route, operation) {
  h.reply(await h.wait(route), 401, {});
  h.reply(await h.wait(REFRESH), 200, refreshed());
  await operation;
  assert.equal(h.requests.filter(row => row.method === 'POST').length, 1);
  assert.equal(h.requests.filter(row => row.route === route).length, 1, 'No protected GET replay after context loss');
  assert.deepEqual(h.storageWrites, [AUTH_KEY], 'Native refreshed auth only; no cached grant restore');
}

test('NR01 source selection and native replacement/recovery/logout SOURCE witnesses', timeout, () => {
  assert.equal(selection({}), null, 'Default uses repository source, not a historical Git object or required E path');
  for (const env of [{ [PATH_ENV]: 'E:/qa/source.js' }, { [SHA_ENV]: 'a'.repeat(64) },
    { [PATH_ENV]: 'C:/qa/source.js', [SHA_ENV]: 'a'.repeat(64) },
    { [PATH_ENV]: 'E:/qa/source.txt', [SHA_ENV]: 'a'.repeat(64) }]) assert.throws(() => selection(env));
  const lf = Buffer.from('function synthetic() {}\n'), crlf = Buffer.from('function synthetic() {}\r\n');
  verify(lf, digest(lf)); verify(crlf, digest(crlf)); assert.throws(() => verify(crlf, digest(lf)));
  assert.equal(normalize(lf), normalize(crlf)); assert.throws(() => normalize(Buffer.from('a\r\nb\n')));
  let replacement = 0, logout = 0, restoration = 0;
  walk(oneFunction('refreshBackstageAuthOnce'), node => {
    if (node.type === 'ObjectProperty' && node.key.name === 'user' && node.value.type === 'LogicalExpression') {
      assert.equal(node.value.operator, '||'); assert.equal(slice(node.value.left), 'payload.user');
      assert.equal(slice(node.value.right), 'current.user'); replacement++;
    }
    if (node.type === 'CallExpression' && node.callee.name === 'setBackstageAuth') {
      assert.equal(node.arguments[0]?.name, 'refreshed'); restoration++;
    }
  });
  assert.equal(replacement, 1); assert.equal(restoration, 1);
  for (const name of ['loadSettlementPage', 'loadSettlementConversions']) {
    let recovery = 0;
    walk(oneFunction(name), node => {
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' &&
          node.callee.object.name === 'scope' && node.callee.property.name === 'recoverMissingAdminContext') recovery++;
    });
    assert.equal(recovery, 2, 'Source wires both post-await stale success and catch; native transport normally rejects first');
  }
  walk(bootstrapNode, node => {
    if (node.type === 'CallExpression' && node.callee.name === 'setBackstageAuth' && node.arguments[0]?.type === 'NullLiteral') logout++;
  });
  assert.equal(logout, 1, 'Existing bootstrap logout is a static witness, not an executed bootstrap claim');
});

test('NR02 initial three-read native 401 refresh closes same-owner missing admin context', timeout, async t => {
  const h = harness(t), operation = h.call('loadSettlementSection');
  const main = await h.wait(MAIN), partner = await h.wait(PARTNER), conversion = await h.wait(CONVERSIONS);
  assert.equal(h.requests.length, 3); h.reply(main, 401, {});
  h.reply(await h.wait(REFRESH), 200, refreshed());
  h.reply(partner); h.reply(conversion); await operation; h.closed();
  assert.equal(h.requests.length, 4); assert.deepEqual(h.storageWrites, [AUTH_KEY]);
  assert.equal(h.context.backstageAuthEpoch, 1, 'Same-ID native replacement retains epoch');
  const count = h.requests.length;
  await h.call('loadSettlementSection'); await h.call('loadSettlementPage', true); await h.call('loadSettlementConversions');
  assert.equal(h.requests.length, count, 'No automatic reverify, replay or authority grant');
});

test('NR03 refresh-only starting auth closes before any protected GET', timeout, async t => {
  const auth = originalAuth(); auth.accessToken = null;
  const h = harness(t, auth); h.seed();
  const operation = h.call('loadSettlementConversions');
  h.reply(await h.wait(REFRESH), 200, refreshed()); await operation; h.closed();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].method, 'POST');
  assert.deepEqual(h.storageWrites, [AUTH_KEY]);
});

test('NR04 append native refresh removes prior private rows and resets hidden disabled load-more', timeout, async t => {
  const h = harness(t); h.seed();
  await ordinaryRefresh(h, MAIN, h.call('loadSettlementPage', true)); h.closed();
  assert.equal(h.requests.length, 2, 'Append does not reload partner/conversions/admin me');
});

test('NR05 conversion native refresh also closes all three private arrays and tables', timeout, async t => {
  const h = harness(t); h.seed();
  await ordinaryRefresh(h, CONVERSIONS, h.call('loadSettlementConversions')); h.closed();
  assert.equal(h.requests.length, 2);
});

test('NR06 operator epoch state hidden view and month changes suppress recovery writes', timeout, async t => {
  for (const kind of ['operator', 'epoch', 'state', 'hidden', 'section', 'month']) {
    const h = harness(t), state = h.seed(), before = h.snapshot(state);
    let replacementState;
    h.onStore(() => {
      if (kind === 'operator') h.injectAuth({ ...refreshed(), user: { id: 'synthetic-operator-b' } });
      if (kind === 'epoch') h.context.backstageAuthEpoch++;
      if (kind === 'state') {
        replacementState = { rows: ['synthetic-new-owner'], studioRows: ['synthetic-new-studio'],
          conversionRows: ['synthetic-new-conversion'], cursor: 'synthetic-new-cursor', hasMore: true, readContext: 'synthetic-new-context' };
        h.context.sectionState.settlement = replacementState;
      }
      if (kind === 'hidden') h.dashboard.classList.add('is-hidden');
      if (kind === 'section') h.setSection('logs');
      if (kind === 'month') h.clock.period = '2026-11';
    });
    await ordinaryRefresh(h, MAIN, h.call('loadSettlementPage', true));
    h.unchanged(before); assert.equal(state.pageLoading, false, 'Old finally releases its own loading flag only');
    if (replacementState) {
      assert.deepEqual(replacementState.rows, ['synthetic-new-owner']);
      assert.equal(replacementState.cursor, 'synthetic-new-cursor');
      assert.equal(replacementState.readContext, 'synthetic-new-context');
    }
  }
});

test('NR07 missing user info alone empty token adminUser or array grants cannot trigger recovery', timeout, t => {
  for (const kind of ['unchanged-token', 'empty-token', 'null-token', 'admin-user', 'array-permissions']) {
    const h = harness(t), state = h.seed(), scope = h.call('settlementReadScope'), before = h.snapshot(state);
    const current = refreshed();
    if (kind === 'unchanged-token') current.accessToken = 'synthetic-token-1';
    if (kind === 'empty-token') current.accessToken = '';
    if (kind === 'null-token') current.accessToken = null;
    if (kind === 'admin-user') current.user.adminUser = {};
    if (kind === 'array-permissions') current.user.adminPermissions = [];
    h.injectAuth(current);
    assert.equal(scope.recoverMissingAdminContext(), false, kind); h.unchanged(before);
    assert.equal(h.requests.length, 0); assert.deepEqual(h.storageWrites, []);
  }
});

test('NR08 explicitly verified refresh wire user retains native authorized one-time GET retry', timeout, async t => {
  const h = harness(t), state = h.seed();
  const operation = h.call('loadSettlementConversions');
  h.reply(await h.wait(CONVERSIONS), 401, {});
  h.reply(await h.wait(REFRESH), 200, refreshed(verifiedUser()));
  h.reply(await h.wait(CONVERSIONS, 1), 200, emptyPage()); await operation;
  assert.equal(h.requests.length, 3); assert.deepEqual(h.storageWrites, [AUTH_KEY]);
  assert.equal(h.call('canAccessBackstageSection', 'payouts'), true);
  assert.deepEqual(plain(h.auth().user), verifiedUser(), 'Context is supplied by synthetic refresh wire, not merged from cache');
  assert.equal(state.conversionRows.length, 0); assert.equal(state.rows.length, 1); assert.equal(state.studioRows.length, 1);
  assert.notEqual(state.readContext, null); assert.equal(state.conversionLoading, false);
  for (const id of TABLES) assert.equal(h.snapshot().dom[TABLES.indexOf(id)].includes(REVERIFY), false);
});

test('NR09 synthetic refresh rejection keeps existing scoped failure and does not invent logout', timeout, async t => {
  const h = harness(t), state = h.seed(), initial = plain(h.auth());
  const operation = h.call('loadSettlementConversions');
  h.reply(await h.wait(CONVERSIONS), 401, {}); h.reply(await h.wait(REFRESH), 401, {}); await operation;
  assert.equal(h.requests.length, 2); assert.deepEqual(h.storageWrites, []); assert.deepEqual(plain(h.auth()), initial);
  assert.equal(state.conversionRows.length, 0); assert.equal(state.rows.length, 1); assert.equal(state.studioRows.length, 1);
  assert.equal(state.conversionLoading, false); assert.notEqual(state.readContext, null);
  const conversionHtml = h.snapshot().dom[2]; assert.equal(conversionHtml.includes(REVERIFY), false);
  assert.ok(conversionHtml.includes('\ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4'));
});

test('NR10 scoped status renderer escapes labels and keeps bounded sticky message markup', timeout, t => {
  const h = harness(t); h.seed();
  h.call('renderSettlementReadMessage', TABLES[0], '<script>synthetic</script>');
  const html = h.snapshot().dom[0];
  assert.ok(html.includes('role="status"'));
  assert.ok(html.includes('position:sticky;left:12px;max-width:calc(100vw - 96px)'));
  assert.ok(html.includes('&lt;script&gt;synthetic&lt;/script&gt;'));
  assert.equal(html.includes('<script>'), false);
  assert.equal(h.requests.length, 0); assert.deepEqual(h.storageWrites, []);
});
