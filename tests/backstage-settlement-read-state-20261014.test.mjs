import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { win32 } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

// Authored, not executed by the sidecar author. No product bootstrap or real IO in the VM.
const PATH_ENV = 'LUMINA_SETTLEMENT_READ_JS_PATH';
const SHA_ENV = 'LUMINA_SETTLEMENT_READ_JS_SHA256';
const defaultPath = fileURLToPath(new URL('../backstage.js', import.meta.url));
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const { parse } = serverRequire('@babel/parser');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const options = { timeout: 5000 };
const moneyRegionSha256 = 'ae32bd3dba0528f3769473342c7dd6729e76f6c606c4d4096349d388a7e94aa6';
const nonPayoutRenderSha256 = 'b28c6a122a2bcd1a1fe21652a98690de9d15f2649a38a4f06aa1cfd60afe9318';

function normalizeSource(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.equal(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, false, 'No UTF-8 BOM');
  const normalized = text.replace(/\r\n/g, '\n');
  assert.equal(normalized.includes('\r'), false, 'Only LF or equivalent CRLF source is accepted');
  return normalized;
}

function validateOverride(env) {
  const path = env[PATH_ENV], sha256 = env[SHA_ENV];
  if (path === undefined && sha256 === undefined) return null;
  assert.equal(typeof path, 'string', 'Override requires an explicit path and RAW SHA256 pair');
  assert.equal(typeof sha256, 'string', 'Override requires an explicit path and RAW SHA256 pair');
  assert.match(path, /^E:[\\/]/i, 'Override must be an absolute E-drive path');
  assert.ok(win32.isAbsolute(path), 'Override must be absolute');
  assert.equal(win32.extname(path).toLowerCase(), '.js', 'Override must select JavaScript');
  assert.match(sha256, /^[a-f0-9]{64}$/i, 'Override requires an exact RAW SHA256');
  return { path, sha256: sha256.toLowerCase() };
}

function verifyRaw(bytes, expected) {
  const actual = digest(bytes);
  assert.equal(actual, expected, 'Selected source RAW SHA256 mismatch');
  return actual;
}

function readSelectedSource(env) {
  const override = validateOverride(env);
  const path = override ? realpathSync(override.path) : defaultPath;
  if (override) assert.match(path, /^E:[\\/]/i, 'Resolved override must remain on E');
  const stat = statSync(path);
  assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 1024 * 1024, 'Source must be a bounded regular file');
  const bytes = readFileSync(path), rawSha256 = override ? verifyRaw(bytes, override.sha256) : digest(bytes);
  return { path, bytes: bytes.length, rawSha256, text: normalizeSource(bytes) };
}

const functionNames = [
  'settlementReadScope', 'settlementReadAmount', 'settlementReadPreviewItem', 'settlementReadPage',
  'renderSettlementReadRows', 'renderSettlementReadMessage', 'loadSettlementSection', 'loadSettlementPage', 'loadSettlementConversions',
  'normalizePage', 'currentSettlementPeriod', 'financialValue', 'won', 'settlementDeductions',
  'settlementMath', 'creatorNames', 'settlementChildrenFromItem', 'isStudioSettlementItem',
  'settlementRowFromItem', 'settlementKeyFromItem', 'settlementMetaFromItem', 'settlementEntryFromItem',
  'localizeSettlementStatus', 'localizeSettlementConversionStatus', 'settlementConversionRequester',
  'settlementConversionEntryFromItem', 'firstValue', 'escapeHtml', 'krw', 'formatCount',
  'currentAdminRoleName', 'adminPermissionList', 'currentAdminPermissions', 'canAccessBackstageSection',
  'getCurrentSection', 'renderRows', 'renderSettlementChildren', 'renderLoadingRow', 'renderErrorRow',
  'renderFallbackNote', 'setLoadMore', 'renderBackstageTables'
];

function productParts(text) {
  const ast = parse(text, { sourceType: 'script', errorRecovery: false });
  const nodes = new Map();
  for (const name of functionNames) {
    const matches = ast.program.body.filter(node => node.type === 'FunctionDeclaration' && node.id?.name === name);
    assert.equal(matches.length, 1, `Require exactly one actual top-level function: ${name}`);
    nodes.set(name, matches[0]);
  }
  const metadata = ast.program.body.filter(node => node.type === 'VariableDeclaration'
    && node.declarations.length === 1 && node.declarations[0].id.type === 'Identifier'
    && node.declarations[0].id.name === 'tableMeta');
  assert.equal(metadata.length, 1, 'Require actual standalone tableMeta declaration');
  assert.equal(metadata[0].declarations[0].init?.type, 'ObjectExpression', 'Require literal table metadata');
  const slice = node => text.slice(node.start, node.end);
  const moneyStart = nodes.get('financialValue').start, moneyEnd = nodes.get('localizeSettlementStatus').start;
  assert.ok(moneyEnd > moneyStart, 'Bounded unchanged money-helper region');
  assert.equal(digest(text.slice(moneyStart, moneyEnd).replace(/\n+$/u, '')), moneyRegionSha256,
    'Existing financial calculations and settlement entries must remain unchanged');
  const renderLines = slice(nodes.get('renderBackstageTables')).split('\n');
  const otherLines = renderLines.filter(line => !/^  render(?:Rows|LoadingRow)\("(?:studioSettlementRows|settlementRows|settlementConversionRows)"[,)]/.test(line));
  assert.equal(renderLines.length - otherLines.length, 3, 'Exactly three initial payout-table calls');
  assert.equal(digest(otherLines.join('\n')), nonPayoutRenderSha256, 'Non-payout renderer must retain the published baseline');
  return {
    code: [slice(metadata[0]), ...functionNames.map(name => slice(nodes.get(name)))].join('\n'),
    pins: functionNames.map(name => ({ name, line: nodes.get(name).loc.start.line, sha256: digest(slice(nodes.get(name))) })),
    nodes
  };
}

const selected = readSelectedSource(process.env);
const product = productParts(selected.text);
export const sourcePins = {
  path: selected.path, rawSha256: selected.rawSha256, bytes: selected.bytes,
  moneyRegionSha256, nonPayoutRenderSha256, functions: product.pins
};

const MAIN = '/admin/api/v1/backstage/operations/settlement-preview';
const PARTNER = '/admin/api/v1/backstage/operations/partner-settlement-preview';
const CONVERSIONS = '/admin/api/v1/backstage/settlement-conversions';
const tables = ['studioSettlementRows', 'settlementRows', 'settlementConversionRows'];
const primaryUnavailable = /\uc815\uc0b0 \uc608\uc0c1\uce58\ub97c \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4/;
const studioUnavailable = /\uc2a4\ud29c\ub514\uc624 \uc6b4\uc601\uc790 \uc815\uc0b0 \ub0b4\uc5ed\uc744 \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4/;
const conversionUnavailable = /\uc815\uc0b0\uae08 \ucda9\uc804 \uc2e0\uccad\uc744 \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4/;
const partialUnavailable = /\uc77c\ubd80 \uc6b4\uc601\uc790 \ub0b4\uc5ed\uc744 \uc870\ud68c\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4/;
const appendUnavailable = /\ub2e4\uc74c \uc815\uc0b0 \ub0b4\uc5ed\uc744 \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4/;
const freshAuth = () => ({ accessToken: 'synthetic-access-only', refreshToken: 'synthetic-refresh-only',
  user: { id: 'synthetic-operator-a', adminUser: { id: 'synthetic-admin-a', status: 'active',
    roleName: 'settlement_admin', permissions: ['payments:read'] } } });
const money = value => ({ grossRevenueKrw: value, netRevenueKrw: value, creatorShareKrw: value });
const preview = (id = 'synthetic-artist-a', overrides = {}) => ({ id, period: '2026-10',
  artist: { id, displayName: id }, creators: [{ id: 'synthetic-creator', displayName: 'Synthetic creator' }],
  status: 'estimated', eventCount: 2, grossLumina: 12, financials: money(120), ...overrides });
const studio = (id = 'synthetic-studio-a', overrides = {}) => preview(id, { type: 'studio_operator',
  partner: { id, displayName: id }, artists: [preview('synthetic-child')], ...overrides });
const conversion = (id = 'synthetic-conversion-a', overrides = {}) => ({ id,
  requester: { displayName: id }, settlementKey: 'synthetic-key:2026-10',
  amountKrw: 120, requestedLumina: 12, status: 'requested', ...overrides });
const page = (items = [], extra = {}) => ({ items, hasMore: false, nextCursor: null, ...extra });

function sink() {
  const classes = new Set();
  return { innerHTML: '', textContent: '', disabled: false, classList: {
    add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value),
    toggle(value, force) {
      const add = force === undefined ? !classes.has(value) : Boolean(force);
      if (add) classes.add(value); else classes.delete(value);
      return add;
    }
  } };
}

function harness(t) {
  let auth = freshAuth(), section = 'payouts';
  const clock = { period: '2026-10' }, nodes = new Map(), requests = [], tasks = [], violations = [], warnings = [], renders = [];
  const dashboard = sink(), more = sink();
  const node = id => { if (!nodes.has(id)) nodes.set(id, sink()); return nodes.get(id); };
  tables.forEach(node); node('settlementNotice');
  const forbidden = label => { violations.push(label); throw new Error(`Forbidden fixture side effect: ${label}`); };
  const sampleRows = {};
  for (const key of ['admins', 'adminRequests', 'overviewQueue', 'risk', 'creators', 'creatorImageRequests',
    'aiCreators', 'contentAnomalies', 'reportCancels', 'aiSettlement', 'logs']) {
    sampleRows[key] = [[`synthetic-unrelated-${key}`, 'verified-sentinel']];
  }
  for (const key of ['studioSettlement', 'settlement', 'settlementConversions']) {
    Object.defineProperty(sampleRows, key, { get() { return forbidden(`sample payout rows: ${key}`); } });
  }
  const context = createContext({
    URLSearchParams,
    Date: class extends Date {
      constructor() { super(`${clock.period}-01T12:00:00Z`); }
      getFullYear() { return Number(clock.period.slice(0, 4)); }
      getMonth() { return Number(clock.period.slice(5, 7)) - 1; }
    },
    sectionState: { settlement: {} }, backstageAuthEpoch: 1, dashboardView: dashboard, backstageRows: sampleRows,
    getBackstageAuth: () => auth,
    document: {
      getElementById: node,
      querySelector(selector) {
        if (selector === '.dashboard-main') return { getAttribute: name => {
          assert.equal(name, 'data-active-section'); return section;
        } };
        if (selector === '[data-load-more="settlement"]') return more;
        return forbidden(`unexpected DOM selector: ${selector}`);
      }
    },
    adminApiPath: path => `/admin/api/v1${path}`,
    backstageFetch(path, fetchOptions = {}) {
      try {
        assert.ok(requests.length < 16, 'Bounded deferred reads per fixture');
        const url = new URL(path, 'https://synthetic.invalid');
        assert.equal(url.origin, 'https://synthetic.invalid');
        assert.ok([MAIN, PARTNER, CONVERSIONS].includes(url.pathname), 'Only the three scoped read endpoints');
        assert.equal(fetchOptions.method || 'GET', 'GET', 'No mutation or auth endpoints');
        assert.equal(fetchOptions.auth, true);
        assert.equal(typeof fetchOptions.isCurrent, 'function');
        assert.equal(fetchOptions.isCurrent(), true, 'Read begins in current context');
        assert.equal(fetchOptions.body, undefined, 'No request bodies');
        assert.equal(url.searchParams.get('period'), clock.period);
        assert.equal(url.searchParams.get('take'), '20');
        const keys = [...url.searchParams.keys()].sort();
        assert.deepEqual(keys, (url.pathname === CONVERSIONS ? ['period', 'status', 'take', 'type']
          : url.pathname === PARTNER ? ['period', 'settlementRateBps', 'take']
            : url.searchParams.has('cursor') ? ['cursor', 'period', 'take'] : ['period', 'take']).sort());
        if (url.pathname === CONVERSIONS) {
          assert.equal(url.searchParams.get('type'), 'artist'); assert.equal(url.searchParams.get('status'), 'requested');
        }
        if (url.pathname === PARTNER) assert.equal(url.searchParams.get('settlementRateBps'), '5000');
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        const request = { path, url, options: fetchOptions, pending: true,
          reply(value) { assert.equal(request.pending, true); request.pending = false; resolve(value); },
          fail() { assert.equal(request.pending, true); request.pending = false; reject(new Error('Synthetic read unavailable')); }
        };
        requests.push(request);
        return promise;
      } catch (error) { violations.push(error.message); throw error; }
    },
    creatorsNativeReadonlyCurrent: () => false, creatorsNativeIsTable: () => false,
    creatorsNativeReadonlyRestricted: () => false, mergeLogRows: rows => rows,
    localizeWorkflowStatus: value => String(value || '-'), statusBadge: value => `<span>${String(value)}</span>`,
    console: { warn: (...args) => warnings.push(args.join(' ')), log: () => forbidden('console.log') },
    fetch: () => forbidden('native fetch'), setBackstageAuth: () => forbidden('auth write'),
    getSavedSection: () => forbidden('saved section read'),
    localStorage: new Proxy({}, { get: () => forbidden('storage') }),
    window: new Proxy({}, { get: () => forbidden('window or navigation') }),
    setTimeout: () => forbidden('timer'), setInterval: () => forbidden('interval')
  }, { codeGeneration: { strings: false, wasm: false } });
  runInContext(product.code, context, { timeout: 1000, filename: selected.path });
  const actualRenderRows = context.renderRows;
  context.renderRows = (id, rows, statusIndex) => {
    renders.push({ id, rows, statusIndex });
    return actualRenderRows(id, rows, statusIndex);
  };
  const invoke = (name, ...args) => {
    assert.ok(functionNames.includes(name), 'Only extracted functions may be invoked');
    context.fixtureArgs = args;
    try {
      const value = runInContext(`${name}(...fixtureArgs)`, context, { timeout: 1000 });
      if (value && typeof value.then === 'function') tasks.push(value);
      return value;
    } finally { delete context.fixtureArgs; }
  };
  const request = (kind, from = 0) => {
    const found = requests.slice(from).find(item => item.pending && item.url.pathname === kind);
    assert.ok(found, `Missing deferred read: ${kind}`); return found;
  };
  const visible = id => `${node(id).innerHTML}\n${node(id).textContent}`;
  const dom = () => plain(Object.fromEntries([...nodes].map(([id, value]) => [id,
    { innerHTML: value.innerHTML, textContent: value.textContent }])));
  const state = () => context.sectionState.settlement;
  const start = () => invoke('loadSettlementSection');
  const settle = (main = page([preview()]), partner = page([studio()]), conversions = page([conversion()]), from = 0) => {
    request(MAIN, from).reply(main); request(PARTNER, from).reply(partner); request(CONVERSIONS, from).reply(conversions);
  };
  t.after(async () => {
    for (const item of requests) if (item.pending) item.fail();
    await Promise.allSettled(tasks);
    assert.deepEqual(violations, [], 'No forbidden side effects or malformed fixture requests');
    assert.equal(requests.some(item => item.pending), false, 'Every synthetic request is drained');
  });
  return { context, clock, nodes, node, dashboard, more, requests, warnings, renders, sampleRows,
    invoke, request, visible, dom, state, start, settle,
    get auth() { return auth; }, set auth(value) { auth = value; },
    get section() { return section; }, set section(value) { section = value; }
  };
}

async function ready(h, main = page([preview()]), partner = page([studio()]), conversions = page([conversion()])) {
  const from = h.requests.length, work = h.start();
  assert.equal(h.requests.length - from, 3);
  h.settle(main, partner, conversions, from); await work;
  return h.state();
}

function assertOnlyVerifiedRows(h, counts = [1, 1, 1]) {
  assert.deepEqual([h.state().studioRows.length, h.state().rows.length, h.state().conversionRows.length], counts);
  for (const id of tables) assert.doesNotMatch(h.visible(id), /synthetic-unrelated|\uc0d8\ud50c/);
}

test('SETTLEMENT.READ.01 repository default and paired RAW override fail closed', options, () => {
  assert.equal(validateOverride({}), null);
  const pinned = { [PATH_ENV]: 'E:/synthetic/backstage.js', [SHA_ENV]: 'a'.repeat(64) };
  assert.deepEqual(validateOverride(pinned), { path: pinned[PATH_ENV], sha256: pinned[SHA_ENV] });
  for (const env of [{ [PATH_ENV]: pinned[PATH_ENV] }, { [SHA_ENV]: pinned[SHA_ENV] },
    { ...pinned, [PATH_ENV]: '' }, { ...pinned, [PATH_ENV]: 'backstage.js' },
    { ...pinned, [PATH_ENV]: 'C:/synthetic/backstage.js' }, { ...pinned, [PATH_ENV]: 'E:backstage.js' },
    { ...pinned, [PATH_ENV]: 'E:/synthetic/backstage.json' }, { ...pinned, [SHA_ENV]: '' },
    { ...pinned, [SHA_ENV]: 'sha256:' + pinned[SHA_ENV] }]) assert.throws(() => validateOverride(env));
  assert.equal(normalizeSource(Buffer.from('function f() {}\n')), normalizeSource(Buffer.from('function f() {}\r\n')));
  assert.throws(() => normalizeSource(Buffer.from('x\ry')));
  assert.throws(() => normalizeSource(Buffer.from([0xff])));
  assert.throws(() => normalizeSource(Buffer.from([0xef, 0xbb, 0xbf, 0x61])));
  const lf = Buffer.from('synthetic\n'), crlf = Buffer.from('synthetic\r\n');
  assert.equal(verifyRaw(lf, digest(lf)), digest(lf));
  assert.throws(() => verifyRaw(lf, digest(crlf)), /RAW SHA256 mismatch/);
  assert.equal(normalizeSource(lf), normalizeSource(crlf));
  if (process.env[PATH_ENV] !== undefined) {
    const wrong = selected.rawSha256 === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
    assert.throws(() => readSelectedSource({ [PATH_ENV]: selected.path, [SHA_ENV]: wrong }), /RAW SHA256 mismatch/);
  } else assert.equal(selected.path, defaultPath);
});

test('SETTLEMENT.READ.02 parsed actual functions and unchanged baseline money region are pinned', options, t => {
  t.diagnostic(JSON.stringify(sourcePins));
  assert.equal(product.pins.length, 42);
  assert.throws(() => productParts('function settlementReadScope() {}'), /actual top-level function/);
  assert.throws(() => productParts(selected.text + '\nfunction settlementReadScope() {}'));
  const node = product.nodes.get('financialValue');
  const changed = selected.text.slice(0, node.start) + ' ' + selected.text.slice(node.start, node.end - 1)
    + ' /* changed money helper */ }' + selected.text.slice(node.end);
  assert.throws(() => productParts(changed), /financial calculations/);
});

test('SETTLEMENT.READ.03 initial three payout tables exclude samples; unrelated render rows remain original', options, t => {
  const h = harness(t); h.invoke('renderBackstageTables');
  const expected = [
    ['adminRows', 'admins', 2], ['adminRequestRows', 'adminRequests', 3], ['overviewQueueRows', 'overviewQueue', 3],
    ['riskRows', 'risk', 3], ['creatorRows', 'creators', 7], ['creatorImageRequestRows', 'creatorImageRequests', 5],
    ['aiCreatorRows', 'aiCreators', 5], ['contentAnomalyRows', 'contentAnomalies', 3],
    ['reportCancelRows', 'reportCancels', 3], ['aiSettlementRows', 'aiSettlement', -1], ['logRows', 'logs', -1]
  ];
  assert.deepEqual(h.renders.map(({ id, statusIndex }) => [id, statusIndex]), expected.map(([id, , index]) => [id, index]));
  expected.forEach(([id, key], index) => {
    assert.equal(h.renders[index].rows, h.sampleRows[key]);
    assert.match(h.visible(id), new RegExp(`synthetic-unrelated-${key}`));
  });
  for (const id of tables) {
    assert.doesNotMatch(h.visible(id), /data-table-id=|synthetic-unrelated|\uc0d8\ud50c|0\uc6d0/);
    assert.match(h.visible(id), /\uc815\uc0b0 \ucc98\ub9ac \ud0ed\uc5d0\uc11c \uc2e4\uc81c/);
  }
  assert.equal(h.requests.length, 0);
});

test('SETTLEMENT.READ.04 explicit normal read renders verified primary, partner, children and conversions', options, async t => {
  const h = harness(t), work = h.start();
  assert.equal(h.requests.length, 3);
  assert.ok(tables.every(id => /\ub370\uc774\ud130\ub97c \ubd88\ub7ec\uc624\ub294 \uc911/.test(h.visible(id))));
  assertOnlyVerifiedRows(h, [0, 0, 0]);
  h.settle(page([preview()], { notice: 'Synthetic verified notice' })); await work;
  assertOnlyVerifiedRows(h);
  assert.match(h.visible('settlementRows'), /synthetic-artist-a/);
  assert.match(h.visible('studioSettlementRows'), /synthetic-studio-a|synthetic-child/);
  assert.match(h.visible('settlementConversionRows'), /synthetic-conversion-a/);
  assert.equal(h.node('settlementNotice').textContent, 'Synthetic verified notice');
  assert.equal(h.state().pageLoading, false); assert.equal(h.state().conversionLoading, false);
  assert.equal(h.more.classList.contains('is-hidden'), true);
  assert.equal(h.requests.length, 3);
});

test('SETTLEMENT.READ.05 genuine verified zero remains zero in all three tables', options, async t => {
  const h = harness(t);
  await ready(h, page([preview('synthetic-zero-artist', { financials: money('0'), grossLumina: 0 })]),
    page([studio('synthetic-zero-studio', { financials: money(0), artists: [], grossLumina: 0 })]),
    page([conversion('synthetic-zero-conversion', { amountKrw: '0', requestedLumina: 0 })]));
  assertOnlyVerifiedRows(h);
  for (const id of tables) assert.match(h.visible(id), /0\uc6d0/);
  assert.equal(h.state().rows[0].meta.settlementKrw, 0);
  assert.equal(h.state().studioRows[0].meta.settlementKrw, 0);
  assert.equal(h.state().conversionRows[0].meta.amountKrw, '0');
  assert.doesNotMatch(tables.map(h.visible).join('\n'), /\ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4/);
});

test('SETTLEMENT.READ.06 successful empty arrays and pages display empty, not failed, zero or samples', options, async t => {
  for (const data of [[], page([])]) {
    const h = harness(t); await ready(h, data, data, data);
    assertOnlyVerifiedRows(h, [0, 0, 0]);
    assert.match(h.visible('studioSettlementRows'), /\ud45c\uc2dc\ud560 \uc2a4\ud29c\ub514\uc624 \uc6b4\uc601\uc790 \uc815\uc0b0 \uc608\uc0c1\uce58\uac00 \uc5c6\uc2b5\ub2c8\ub2e4/);
    assert.match(h.visible('settlementRows'), /\ud45c\uc2dc\ud560 \uc815\uc0b0 \uc608\uc0c1\uce58\uac00 \uc5c6\uc2b5\ub2c8\ub2e4/);
    assert.match(h.visible('settlementConversionRows'), /\ucc98\ub9ac \ub300\uae30 \uc911\uc778 \uc815\uc0b0\uae08 \ucda9\uc804 \uc2e0\uccad\uc774 \uc5c6\uc2b5\ub2c8\ub2e4/);
    for (const id of tables) assert.doesNotMatch(h.visible(id), /\ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4|data-table-id=|0\uc6d0|\uc0d8\ud50c/);
  }
});

test('SETTLEMENT.READ.07 primary rejection does not manufacture settlement rows; verified conversions remain', options, async t => {
  const h = harness(t), work = h.start();
  h.request(MAIN).fail(); h.request(PARTNER).reply(page([studio()])); h.request(CONVERSIONS).reply(page([conversion()]));
  await work; assertOnlyVerifiedRows(h, [0, 0, 1]);
  assert.match(h.visible('settlementRows'), primaryUnavailable);
  assert.match(h.visible('studioSettlementRows'), studioUnavailable);
  assert.match(h.visible('settlementConversionRows'), /synthetic-conversion-a/);
  assert.equal(h.state().cursor, null); assert.equal(h.state().hasMore, false);
  assert.equal(h.requests.length, 3);
});

test('SETTLEMENT.READ.08 partner rejection without verified studio rows is visibly unavailable, not empty', options, async t => {
  const h = harness(t), work = h.start();
  h.request(MAIN).reply(page([preview()])); h.request(PARTNER).fail(); h.request(CONVERSIONS).reply(page([]));
  await work; assertOnlyVerifiedRows(h, [0, 1, 0]);
  assert.equal(h.state().partnerReadUnavailable, true);
  assert.match(h.visible('studioSettlementRows'), studioUnavailable);
  assert.doesNotMatch(h.visible('studioSettlementRows'), /\uc608\uc0c1\uce58\uac00 \uc5c6\uc2b5\ub2c8\ub2e4/);
  assert.match(h.visible('settlementRows'), /synthetic-artist-a/);
});

test('SETTLEMENT.READ.09 partner rejection retains verified main studio rows WITH a visible partial warning', options, async t => {
  const h = harness(t), work = h.start();
  h.request(MAIN).reply(page([preview(), studio('synthetic-main-studio')]));
  h.request(PARTNER).fail(); h.request(CONVERSIONS).reply(page([])); await work;
  assertOnlyVerifiedRows(h, [1, 1, 0]);
  assert.equal(h.state().partnerReadUnavailable, true);
  assert.match(h.visible('studioSettlementRows'), /synthetic-main-studio/);
  assert.equal(h.requests.length, 3);
  // Console output is not an operator-visible partial state. Do not stub this into a DOM note.
  assert.match(h.visible('studioSettlementRows'), partialUnavailable,
    'Verified studio rows must also visibly identify the unavailable partner read');
});

test('SETTLEMENT.READ.10 conversion rejection visibly fails only conversions, preserving verified preview', options, async t => {
  const h = harness(t), work = h.start();
  h.request(MAIN).reply(page([preview()])); h.request(PARTNER).reply(page([studio()])); h.request(CONVERSIONS).fail();
  await work; assertOnlyVerifiedRows(h, [1, 1, 0]);
  assert.match(h.visible('settlementConversionRows'), conversionUnavailable);
  assert.doesNotMatch(h.visible('settlementConversionRows'), /data-table-id=|0\uc6d0/);
  assert.match(h.visible('studioSettlementRows'), /synthetic-studio-a/);
  assert.match(h.visible('settlementRows'), /synthetic-artist-a/);
});

test('SETTLEMENT.READ.11 malformed primary items and money cannot become sample or zero fallback', options, async t => {
  const invalidMoney = [null, true, '', ' ', 'not-money', Infinity, NaN];
  const cases = [null, {}, { items: null }, { items: {} }, page([null]), page([[]]),
    ...invalidMoney.map(value => page([preview('synthetic-invalid', { financials: { ...money(120), creatorShareKrw: value } })])),
    page([preview('synthetic-invalid', { financials: null })]),
    page([preview('synthetic-invalid', { financials: { grossRevenueKrw: 120, creatorShareKrw: 120 } })])];
  for (const data of cases) {
    const h = harness(t); await ready(h, data, page([studio()]), page([conversion()]));
    assertOnlyVerifiedRows(h, [0, 0, 1]);
    assert.match(h.visible('settlementRows'), primaryUnavailable);
    assert.match(h.visible('studioSettlementRows'), studioUnavailable);
    assert.doesNotMatch(h.visible('settlementRows'), /data-table-id=|0\uc6d0/);
  }
});

test('SETTLEMENT.READ.12 malformed partner and child shapes retain only verified primary rows', options, async t => {
  const cases = [null, { items: 'bad' }, page([null]), page([studio('synthetic-invalid', { artists: {} })]),
    page([studio('synthetic-invalid', { artists: [null] })]),
    page([studio('synthetic-invalid', { artists: [{ financials: { grossRevenueKrw: 1 } }] })]),
    page([studio('synthetic-invalid', { artists: [preview('synthetic-invalid-child', { financials: money('bad') })] })])];
  for (const data of cases) {
    const h = harness(t); await ready(h, page([preview()]), data, page([]));
    assertOnlyVerifiedRows(h, [0, 1, 0]);
    assert.equal(h.state().partnerReadUnavailable, true);
    assert.match(h.visible('studioSettlementRows'), studioUnavailable);
    assert.match(h.visible('settlementRows'), /synthetic-artist-a/);
    assert.doesNotMatch(h.visible('studioSettlementRows'), /synthetic-invalid|data-table-id=|0\uc6d0/);
  }
});

test('SETTLEMENT.READ.13 malformed conversion identity, items and amounts are unavailable, not valid zero', options, async t => {
  const cases = [null, { items: false }, page([null]), page([[]]),
    ...[{ id: '' }, { settlementKey: '' }, { status: null }, { amountKrw: null }, { amountKrw: false },
      { amountKrw: 'bad' }, { requestedLumina: '' }, { requestedLumina: Infinity }].map(value => page([conversion('synthetic-invalid', value)]))];
  for (const data of cases) {
    const h = harness(t); await ready(h, page([preview()]), page([studio()]), data);
    assertOnlyVerifiedRows(h, [1, 1, 0]);
    assert.match(h.visible('settlementConversionRows'), conversionUnavailable);
    assert.doesNotMatch(h.visible('settlementConversionRows'), /synthetic-invalid|data-table-id=|0\uc6d0/);
  }
});

test('SETTLEMENT.READ.14 string-false hasMore and invalid cursor envelopes fail closed for every read', options, async t => {
  const envelopes = [{ hasMore: 'false' }, { hasMore: 0 }, { hasMore: true, nextCursor: null },
    { hasMore: true, nextCursor: '' }, { nextCursor: ' ' }, { nextCursor: 123 }, { nextCursor: {} }];
  for (const kind of [MAIN, PARTNER, CONVERSIONS]) for (const extra of envelopes) {
    const h = harness(t), work = h.start();
    h.settle(page([preview()], kind === MAIN ? extra : {}), page([studio()], kind === PARTNER ? extra : {}),
      page([conversion()], kind === CONVERSIONS ? extra : {})); await work;
    if (kind === MAIN) {
      assertOnlyVerifiedRows(h, [0, 0, 1]); assert.match(h.visible('settlementRows'), primaryUnavailable);
      assert.equal(h.state().hasMore, false); assert.equal(h.state().cursor, null);
    } else if (kind === PARTNER) {
      assertOnlyVerifiedRows(h, [0, 1, 1]); assert.match(h.visible('studioSettlementRows'), studioUnavailable);
    } else {
      assertOnlyVerifiedRows(h, [1, 1, 0]); assert.match(h.visible('settlementConversionRows'), conversionUnavailable);
    }
  }
});

test('SETTLEMENT.READ.15 absent auth, operator, access, hidden dashboard or other section make zero calls', options, async t => {
  const mutations = [h => { h.auth = null; }, h => { h.auth = {}; },
    h => { delete h.auth.accessToken; delete h.auth.refreshToken; }, h => { delete h.auth.user.id; },
    h => { h.auth.user.adminUser.roleName = 'support_admin'; h.auth.user.adminUser.permissions = ['users:read']; },
    h => h.dashboard.classList.add('is-hidden'), h => { h.section = 'overview'; }];
  for (const mutate of mutations) {
    const h = harness(t); mutate(h); const before = h.dom();
    await h.start(); await h.invoke('loadSettlementPage', false); await h.invoke('loadSettlementConversions');
    assert.equal(h.requests.length, 0); assert.deepEqual(h.dom(), before);
  }
});

test('SETTLEMENT.READ.16 same-context duplicate section, page and conversion reads are suppressed', options, async t => {
  const h = harness(t), work = h.start(), state = h.state();
  await h.start(); await h.invoke('loadSettlementPage', false); await h.invoke('loadSettlementConversions');
  assert.equal(h.state(), state); assert.equal(h.requests.length, 3);
  h.request(CONVERSIONS).reply(page([conversion()]));
  await Promise.resolve(); await Promise.resolve();
  await h.start(); assert.equal(h.requests.length, 3, 'Pending page still prevents duplicate section reload');
  h.request(MAIN).reply(page([preview()])); h.request(PARTNER).reply(page([studio()])); await work;
  assertOnlyVerifiedRows(h); assert.equal(h.requests.length, 3, 'Settling data never auto-queries');
});

const invalidations = [
  ['same user refreshed grants', h => { h.auth = { ...freshAuth(), accessToken: 'synthetic-refreshed',
    user: { ...h.auth.user, adminUser: { ...h.auth.user.adminUser, permissions: ['payments:read', 'payout:read'] } } }; }],
  ['permission denied', h => { h.auth.user.adminUser.roleName = 'support_admin'; h.auth.user.adminUser.permissions = ['users:read']; }],
  ['admin identity changed', h => { h.auth.user.adminUser.id = 'synthetic-admin-b'; }],
  ['other operator', h => { h.auth.user.id = 'synthetic-operator-b'; }],
  ['epoch', h => { h.context.backstageAuthEpoch++; }],
  ['section', h => { h.section = 'users'; }],
  ['hidden', h => h.dashboard.classList.add('is-hidden')],
  ['month', h => { h.clock.period = '2026-11'; }],
  ['superseded state', h => { h.context.sectionState.settlement = { marker: 'synthetic-replacement' }; }],
  ['no auth', h => { h.auth = null; }]
];

test('SETTLEMENT.READ.17 every stale context suppresses late success with no implicit fresh read', options, async t => {
  for (const [label, mutate] of invalidations) {
    const h = harness(t), work = h.start(); mutate(h);
    const replacement = h.state(), before = h.dom();
    assert.ok(h.requests.every(request => request.options.isCurrent() === false), label);
    h.settle(); await work;
    assert.deepEqual(h.dom(), before, label); assert.equal(h.state(), replacement, label);
    assert.equal(h.requests.length, 3, label);
    if (replacement.rows) assertOnlyVerifiedRows(h, [0, 0, 0]);
  }
});

test('SETTLEMENT.READ.18 every stale context suppresses late failure without overwriting current UI', options, async t => {
  for (const [label, mutate] of invalidations) {
    const h = harness(t), work = h.start(); mutate(h); const before = h.dom();
    h.requests.forEach(request => request.fail()); await work;
    assert.deepEqual(h.dom(), before, label); assert.equal(h.warnings.length, 0, label);
    assert.equal(h.requests.length, 3, label);
  }
});

test('SETTLEMENT.READ.19 same-user refreshed permission context needs explicit new section read', options, async t => {
  const h = harness(t), oldWork = h.start(), oldState = h.state();
  invalidations[0][1](h);
  assert.equal(h.requests.length, 3); const newWork = h.start(), current = h.state();
  assert.notEqual(current, oldState); assert.notEqual(current.readContext, oldState.readContext);
  assert.equal(h.requests.length, 6);
  h.settle(page([preview('synthetic-refreshed-artist')]), page([]), page([]), 3); await newWork;
  const before = h.dom(); h.settle(); await oldWork;
  assert.equal(h.state(), current); assert.deepEqual(h.dom(), before);
  assert.match(h.visible('settlementRows'), /synthetic-refreshed-artist/);
  assert.doesNotMatch(h.visible('settlementRows'), /synthetic-artist-a/);
});

test('SETTLEMENT.READ.20 cross-operator section refresh discards verified prior rows and rejects old late failure', options, async t => {
  const h = harness(t); await ready(h);
  const oldWork = h.invoke('loadSettlementPage', false), oldState = h.state();
  h.auth = freshAuth(); h.auth.user.id = 'synthetic-operator-b'; h.auth.user.adminUser.id = 'synthetic-admin-b';
  const newWork = h.start(), current = h.state();
  assert.notEqual(current, oldState); assertOnlyVerifiedRows(h, [0, 0, 0]);
  assert.doesNotMatch(tables.map(h.visible).join('\n'), /synthetic-artist-a|synthetic-studio-a|synthetic-conversion-a/);
  h.settle(page([preview('synthetic-operator-b-artist')]), page([]), page([]), 5); await newWork;
  const before = h.dom(); h.request(MAIN, 3).fail(); h.request(PARTNER, 3).fail(); await oldWork;
  assert.deepEqual(h.dom(), before); assert.equal(h.state(), current); assert.equal(h.requests.length, 8);
});

test('SETTLEMENT.READ.21 explicit same-context superseding state owns results regardless of response order', options, async t => {
  for (const oldFirst of [true, false]) {
    const h = harness(t), oldWork = h.start(), oldState = h.state();
    h.context.sectionState.settlement = {}; const newWork = h.start(), current = h.state();
    assert.notEqual(current, oldState);
    const finishOld = () => h.settle(page([preview('synthetic-old')]), page([studio('synthetic-old-studio')]), page([]), 0);
    const finishNew = () => h.settle(page([preview('synthetic-new')]), page([]), page([]), 3);
    if (oldFirst) { finishOld(); await oldWork; finishNew(); await newWork; }
    else { finishNew(); await newWork; const before = h.dom(); finishOld(); await oldWork; assert.deepEqual(h.dom(), before); }
    assert.equal(h.state(), current); assert.match(h.visible('settlementRows'), /synthetic-new/);
    assert.doesNotMatch(tables.map(h.visible).join('\n'), /synthetic-old/);
  }
});

test('SETTLEMENT.READ.22 a late partner cannot publish primary rows after its scope has changed', options, async t => {
  const h = harness(t), work = h.start();
  h.request(MAIN).reply(page([preview()])); h.request(CONVERSIONS).reply(page([]));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.state().rows.length, 0, 'Primary waits for its paired partner outcome');
  h.section = 'overview'; const before = h.dom();
  h.request(PARTNER).reply(page([studio('synthetic-late-partner')])); await work;
  assert.deepEqual(h.dom(), before); assert.equal(h.state().rows.length, 0);
  assert.doesNotMatch(tables.map(h.visible).join('\n'), /synthetic-late-partner/);
});

test('SETTLEMENT.READ.23 valid append uses one GET and preserves verified partner and conversion rows', options, async t => {
  const h = harness(t); await ready(h, page([preview()], { hasMore: true, nextCursor: 'synthetic-cursor-a' }));
  const partnerBefore = plain(h.state().studioRows), conversionsBefore = plain(h.state().conversionRows);
  assert.equal(h.more.classList.contains('is-hidden'), false);
  const work = h.invoke('loadSettlementPage'); assert.equal(h.requests.length, 4);
  await h.invoke('loadSettlementPage'); assert.equal(h.requests.length, 4);
  assert.equal(h.request(MAIN, 3).url.searchParams.get('cursor'), 'synthetic-cursor-a');
  h.request(MAIN, 3).reply(page([preview('synthetic-appended')], { hasMore: true, nextCursor: 'synthetic-cursor-b' })); await work;
  assertOnlyVerifiedRows(h, [1, 2, 1]); assert.deepEqual(plain(h.state().studioRows), partnerBefore);
  assert.deepEqual(plain(h.state().conversionRows), conversionsBefore);
  assert.equal(h.state().cursor, 'synthetic-cursor-b'); assert.equal(h.state().hasMore, true);
  assert.equal(h.requests.filter(request => request.url.pathname === PARTNER).length, 1);
  assert.match(h.visible('settlementRows'), /synthetic-appended/);
});

test('SETTLEMENT.READ.24 append failure preserves rows and cursor for manual GET retry WITH visible warning', options, async t => {
  const h = harness(t); await ready(h, page([preview()], { hasMore: true, nextCursor: 'synthetic-retry-cursor' }));
  const before = plain({ rows: h.state().rows, studioRows: h.state().studioRows, conversionRows: h.state().conversionRows });
  const work = h.invoke('loadSettlementPage'); h.request(MAIN, 3).fail(); await work;
  assert.deepEqual(plain({ rows: h.state().rows, studioRows: h.state().studioRows, conversionRows: h.state().conversionRows }), before);
  assert.equal(h.state().cursor, 'synthetic-retry-cursor'); assert.equal(h.state().hasMore, true);
  assert.equal(h.state().pageLoading, false); assert.equal(h.more.classList.contains('is-hidden'), false);
  assert.equal(h.more.disabled, false); assert.equal(h.requests.length, 4, 'Failure does not retry automatically');
  const failedStudio = h.visible('studioSettlementRows'), failedPrimary = h.visible('settlementRows');
  const retry = h.invoke('loadSettlementPage'); assert.equal(h.requests.length, 5);
  assert.equal(h.request(MAIN, 4).url.searchParams.get('cursor'), 'synthetic-retry-cursor');
  h.request(MAIN, 4).reply(page([preview('synthetic-manual-retry')])); await retry;
  assertOnlyVerifiedRows(h, [1, 2, 1]); assert.equal(h.state().cursor, null); assert.equal(h.state().hasMore, false);
  assert.match(h.visible('settlementRows'), /synthetic-manual-retry/);
  assert.doesNotMatch(tables.map(h.visible).join('\n'), appendUnavailable);
  assert.match(failedStudio, appendUnavailable, 'The preserved studio table must visibly report append failure');
  assert.match(failedPrimary, appendUnavailable, 'The preserved primary table must visibly report append failure');
});

test('SETTLEMENT.READ.25 malformed append preserves prior proof and retry cursor; no partner reread', options, async t => {
  for (const data of [null, page([preview('synthetic-bad-append', { financials: money('bad') })]),
    page([preview('synthetic-bad-append')], { hasMore: 'false' }), page([preview('synthetic-bad-append')], { nextCursor: {} })]) {
    const h = harness(t); await ready(h, page([preview()], { hasMore: true, nextCursor: 'synthetic-cursor' }));
    const state = h.state(), rows = plain(state.rows), studioRows = plain(state.studioRows);
    const work = h.invoke('loadSettlementPage'); h.request(MAIN, 3).reply(data); await work;
    assert.equal(h.state(), state); assert.deepEqual(plain(state.rows), rows); assert.deepEqual(plain(state.studioRows), studioRows);
    assert.equal(state.cursor, 'synthetic-cursor'); assert.equal(state.hasMore, true); assert.equal(state.pageLoading, false);
    assert.equal(h.requests.length, 4); assert.doesNotMatch(tables.map(h.visible).join('\n'), /synthetic-bad-append/);
  }
});

test('SETTLEMENT.READ.26 changed auth cannot reuse another context through direct page or conversion calls', options, async t => {
  const h = harness(t); await ready(h);
  const before = h.dom(); h.auth.user.id = 'synthetic-operator-b';
  await h.invoke('loadSettlementPage', false); await h.invoke('loadSettlementConversions');
  assert.equal(h.requests.length, 3); assert.deepEqual(h.dom(), before);
  const work = h.start(); assertOnlyVerifiedRows(h, [0, 0, 0]);
  h.settle(page([preview('synthetic-new-context')]), page([]), page([]), 3); await work;
  assert.match(h.visible('settlementRows'), /synthetic-new-context/);
});

test('SETTLEMENT.READ.27 completed same-context refresh remains explicit and starts only three new reads', options, async t => {
  const h = harness(t); await ready(h); const prior = h.state();
  assert.equal(h.requests.length, 3); const work = h.start();
  assert.equal(h.requests.length, 6); assert.notEqual(h.state(), prior);
  assert.equal(h.state().readContext, prior.readContext); assertOnlyVerifiedRows(h, [0, 0, 0]);
  h.settle(page([]), page([]), page([]), 3); await work;
  assertOnlyVerifiedRows(h, [0, 0, 0]); assert.equal(h.requests.length, 6);
});
