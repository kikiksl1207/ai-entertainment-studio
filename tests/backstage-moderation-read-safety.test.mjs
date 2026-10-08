import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { source, segment, runtime } from './backstage-moderation-test-support.mjs';

const moderationSource = segment('let moderationReadGeneration =', 'function fanMissionStatusLabel(');

const targets = {
  posts: 'moderationRows', reports: 'moderationReportRows',
  analytics: 'feedSearchRows', blocked: 'feedBlockedTermRows',
};
const emptyText = {
  posts: '확인 필요한 콘텐츠가 없습니다.', reports: '접수된 범용 신고가 없습니다.',
  analytics: '최근 피드 검색어 분석 데이터가 없습니다.', blocked: '공개 탐색에서 제외 중인 검색어가 없습니다.',
};
const failedPrivateText = 'private-person@example.test Bearer secret-token SELECT private_report /internal/path';
const authKey = 'lumina_backstage_auth';
const flush = () => new Promise(resolve => setImmediate(resolve));
const clone = value => JSON.parse(JSON.stringify(value));

function adminAuth(role = 'super_admin', permissions = ['*']) {
  return { accessToken: 'operator-session-a', user: {
    id: 'operator-a', adminRole: role, adminPermissions: permissions,
    adminUser: { id: 'admin-a', status: 'active' },
  } };
}

// Synthetic API fixtures stay in this test; none are used as product fallback data.
function payloads(label = 'current') {
  const postId = `post-${label}-0001`;
  return {
    posts: { items: [{ id: postId, authorUserId: 'author-a',
      author: { email: `author-${label}@example.test` }, reportCount: 2, status: 'published' }] },
    reports: { items: [{ id: `report-${label}-0001`, postId,
      post: { id: postId, status: 'published', author: { id: 'author-a', email: `author-${label}@example.test` } },
      reporterUserId: 'reporter-a', reporter: { profile: { displayName: `Reporter ${label}` } },
      reason: 'spam', status: 'submitted', detail: `detail ${label}` }], hasMore: false, nextCursor: null },
    analytics: { items: [{ keyword: `query-${label}`, type: 'text', language: 'ko',
      searchCount: 3, averageResultCount: 2 }], summary: { totalEvents: 3, zeroResultCount: 1 } },
    blocked: { items: [{ id: `term-${label}-0001`, keyword: `blocked-${label}`, type: 'text',
      language: 'all', status: 'active', reason: 'reviewed' }] },
  };
}

function harness(auth = adminAuth()) {
  const storage = new Map();
  if (auth) storage.set(authKey, JSON.stringify(auth));
  const roots = Object.fromEntries([...Object.values(targets), 'feedSearchSummary', 'userRows', 'adminRows']
    .map(id => [id, { innerHTML: `untouched-${id}`, textContent: `untouched-${id}` }]));
  const calls = [], logs = [];
  let hidden = false;
  const context = {
    window: { LUMINA_API_BASE: 'https://moderation.invalid' },
    document: { getElementById: id => roots[id] || null },
    dashboardView: { classList: { contains: name => name === 'is-hidden' && hidden } },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key),
    },
    console: Object.fromEntries(['log', 'warn', 'error', 'info', 'debug'].map(level =>
      [level, (...args) => logs.push({ level, args })])),
    fetch(url, options) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const path = new URL(url).pathname;
      const kind = path.endsWith('/community/posts') ? 'posts' : path.endsWith('/community/reports') ? 'reports'
        : path.endsWith('/feed-search-analytics') ? 'analytics'
          : path.endsWith('/feed-search-blocked-terms') ? 'blocked' : 'refresh';
      calls.push({ url, options, kind, reject,
        reply(body, status = 200) { resolve({ ok: status >= 200 && status < 300, status, json: async () => body }); },
        malformed() { resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError(failedPrivateText); } }); },
      });
      return promise;
    },
    renderBackstageTables() { assert.fail('Moderation must never restore global sample tables'); },
    renderFallbackNote() { assert.fail('Moderation must never invoke sample fallback logging'); },
  };
  runInNewContext(`"use strict";\n${runtime}\nthis.load = loadModerationSection;`, context,
    { filename: 'backstage.js:moderation-read-safety' });
  const snapshot = () => clone(roots);
  return {
    load: context.load, roots, calls, logs, storage, snapshot,
    setAuth(value, key = authKey) {
      if (value) storage.set(key, JSON.stringify(value)); else storage.delete(key);
    },
    hideDashboard() { hidden = true; },
    settle(values = payloads(), reads = calls) { reads.forEach(call => call.reply(values[call.kind])); },
  };
}

function assertNoLeak(h) {
  assert.deepEqual(h.logs, [], 'No errors, report bodies, identities or credentials may be logged');
  for (const root of Object.values(h.roots)) {
    assert.doesNotMatch(`${root.innerHTML} ${root.textContent}`,
      /private-person|secret-token|SELECT private_report|\/internal\/path/);
  }
  assert.equal(h.roots.userRows.innerHTML, 'untouched-userRows');
  assert.equal(h.roots.adminRows.innerHTML, 'untouched-adminRows');
}

function assertReady(h, kind, label = 'current') {
  const html = h.roots[targets[kind]].innerHTML;
  assert.match(html, /data-detail=/);
  assert.doesNotMatch(html, /role="alert"/);
  assert.ok(html.includes(label), `${kind} preserves its successful data`);
}

function detail(h, kind) {
  const encoded = h.roots[targets[kind]].innerHTML.match(/data-detail="([^"]+)"/);
  assert.ok(encoded, `${kind} retains its existing row action payload`);
  return JSON.parse(decodeURIComponent(encoded[1]));
}

test('normal reads retain deployed GET routes, permissions, localized reports and actionable metadata', async () => {
  const h = harness();
  const pending = h.load();
  assert.deepEqual(h.calls.map(call => call.kind), ['posts', 'reports', 'analytics', 'blocked']);
  assert.deepEqual(h.calls.map(call => new URL(call.url).pathname), [
    '/admin/api/v1/community/posts', '/admin/api/v1/community/reports',
    '/admin/api/v1/backstage/operations/feed-search-analytics',
    '/admin/api/v1/backstage/operations/feed-search-blocked-terms',
  ]);
  for (const call of h.calls) {
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.headers.Authorization, 'Bearer operator-session-a');
    assert.equal(call.options.body, undefined);
    assert.equal(new URL(call.url).searchParams.get('take'), '20');
  }
  const postsQuery = new URL(h.calls[0].url).searchParams;
  assert.equal(postsQuery.get('status'), 'published');
  assert.equal(postsQuery.get('minReports'), '1');
  assert.equal(postsQuery.get('sort'), 'reports');
  h.settle(); await pending;
  for (const kind of Object.keys(targets)) assertReady(h, kind);
  assert.equal(detail(h, 'posts').row.at(-1), '숨김');
  assert.deepEqual(detail(h, 'posts').meta, { postId: 'post-current-0001', authorUserId: 'author-a', status: 'published' });
  assert.equal(detail(h, 'reports').row[3], '스팸/반복 홍보');
  assert.equal(detail(h, 'reports').row[4], '접수');
  assert.equal(detail(h, 'reports').row.at(-1), '검토');
  assert.deepEqual(detail(h, 'reports').meta, { reportId: 'report-current-0001', postId: 'post-current-0001',
    targetId: 'post-current-0001', status: 'submitted' });
  assert.equal(detail(h, 'blocked').row.at(-1), '비활성');
  assert.equal(detail(h, 'blocked').meta.termId, 'term-current-0001');
  assert.match(h.roots.feedSearchSummary.textContent, /검색 3회/);
  assertNoLeak(h);
});

test('existing restore and resolved/dismissed detail actions match the community report enum', async () => {
  for (const status of ['resolved', 'dismissed']) {
    const h = harness(), values = payloads();
    values.posts.items[0].status = 'hidden'; values.reports.items[0].status = status;
    const pending = h.load(); h.settle(values); await pending;
    assert.equal(detail(h, 'posts').row.at(-1), '복구');
    assert.equal(detail(h, 'reports').row.at(-1), '상세');
    assertNoLeak(h);
  }
});

test('actual CommunityReport postId/post/reporter shape displays the public post target and actual post author', async () => {
  for (const status of ['submitted', 'reviewing', 'resolved', 'dismissed']) {
    const h = harness(), values = payloads('prisma'), report = values.reports.items[0];
    report.status = status;
    assert.equal(Object.hasOwn(report, 'targetId'), false);
    assert.equal(Object.hasOwn(report, 'targetType'), false);
    assert.equal(Object.hasOwn(values.posts.items[0], 'authorUser'), false);
    const pending = h.load(); h.settle(values); await pending;
    const row = detail(h, 'reports');
    assert.equal(row.row[1], `피드 글 / ${report.postId.slice(0, 8)}`);
    assert.equal(row.row[2], 'Reporter prisma');
    assert.equal(row.meta.postId, report.postId);
    assert.equal(row.meta.targetId, report.postId);
    assert.equal(row.row.at(-1), ['resolved', 'dismissed'].includes(status) ? '상세' : '검토');
    assert.equal(detail(h, 'posts').row[1], 'author-prisma@example.test');
    assertNoLeak(h);
  }
});

test('successful empty arrays/pages remain empty, without actions, samples or error rows', async () => {
  for (const array of [false, true]) {
    const h = harness(), pending = h.load();
    h.settle(Object.fromEntries(Object.keys(targets).map(kind => [kind, array ? [] : { items: [] }])));
    await pending;
    for (const [kind, id] of Object.entries(targets)) {
      assert.ok(h.roots[id].innerHTML.includes(emptyText[kind]));
      assert.doesNotMatch(h.roots[id].innerHTML, /data-detail=|role="alert"/);
    }
    assertNoLeak(h);
  }
});

for (const status of [401, 403, 503]) test(`reports HTTP ${status} is a Korean error, never successful empty or sample fallback`, async () => {
  const h = harness(), pending = h.load(), values = payloads();
  for (const call of h.calls) call.reply(call.kind === 'reports' ? { message: failedPrivateText } : values[call.kind],
    call.kind === 'reports' ? status : 200);
  await pending;
  const html = h.roots.moderationReportRows.innerHTML;
  assert.match(html, /role="alert"/);
  assert.match(html, status === 401 ? /세션이 만료/ : status === 403 ? /운영자 권한이 없/ : /신고 목록을 불러오지 못/);
  assert.doesNotMatch(html, /접수된 범용 신고가 없습니다|data-detail=/);
  for (const kind of ['posts', 'analytics', 'blocked']) assertReady(h, kind);
  assertNoLeak(h);
});

for (const [label, body] of [
  ['null', null], ['missing items', {}], ['error envelope', { message: failedPrivateText }],
  ['non-array items', { items: { id: 'report-invalid' } }], ['null row', { items: [null] }],
  ['string row', { items: [failedPrivateText] }], ['array row', { items: [['sample']] }],
  ['missing identity', { items: [{}] }], ['blank identity', { items: [{ id: ' ' }] }],
  ['missing public post target', { items: [{ ...payloads().reports.items[0], postId: undefined }] }],
  ['generic report instead of community report', { items: [{ id: 'generic-report', targetType: 'user', targetId: 'user-a', status: 'submitted' }] }],
  ['invalid report status', { items: [{ ...payloads().reports.items[0], status: 'archived' }] }],
  ['mixed valid/invalid rows', { items: [payloads().reports.items[0], null] }],
]) test(`malformed reports (${label}) fail their region without erasing successful reads`, async () => {
  const h = harness(), pending = h.load(), values = payloads();
  h.settle({ ...values, reports: body }); await pending;
  assert.match(h.roots.moderationReportRows.innerHTML, /role="alert".*신고 목록을 불러오지 못/);
  assert.doesNotMatch(h.roots.moderationReportRows.innerHTML, /접수된 범용 신고가 없습니다|data-detail=/);
  for (const kind of ['posts', 'analytics', 'blocked']) assertReady(h, kind);
  assertNoLeak(h);
});

test('invalid JSON reports is not silently treated as a successful empty page', async () => {
  const h = harness(), pending = h.load(), values = payloads();
  for (const call of h.calls) {
    if (call.kind === 'reports') call.malformed(); else call.reply(values[call.kind]);
  }
  await pending;
  assert.match(h.roots.moderationReportRows.innerHTML, /role="alert".*신고 목록을 불러오지 못/);
  assertNoLeak(h);
});

for (const kind of Object.keys(targets)) for (const mode of ['network', 'malformed']) {
  test(`${kind} ${mode} failure stays regional, with no private error rendering or logging`, async () => {
    const h = harness(), pending = h.load(), values = payloads();
    for (const call of h.calls) {
      if (call.kind !== kind) call.reply(values[call.kind]);
      else if (mode === 'network') call.reject(Object.assign(new Error(failedPrivateText), { body: { message: failedPrivateText } }));
      else call.reply({ items: 'malformed', message: failedPrivateText });
    }
    await pending;
    assert.match(h.roots[targets[kind]].innerHTML, /role="alert"/);
    assert.doesNotMatch(h.roots[targets[kind]].innerHTML, /data-detail=/);
    for (const other of Object.keys(targets).filter(other => other !== kind)) assertReady(h, other);
    if (kind === 'analytics') assert.match(h.roots.feedSearchSummary.textContent, /검색어 분석을 불러오지 못/);
    assertNoLeak(h);
  });
}

test('successful regions render even while reports are still pending', async () => {
  const h = harness(), pending = h.load(), values = payloads();
  for (const call of h.calls.filter(call => call.kind !== 'reports')) call.reply(values[call.kind]);
  await flush();
  for (const kind of ['posts', 'analytics', 'blocked']) assertReady(h, kind);
  assert.match(h.roots.moderationReportRows.innerHTML, /불러오는 중/);
  h.calls.find(call => call.kind === 'reports').reply({ message: failedPrivateText }, 503);
  await pending;
  for (const kind of ['posts', 'analytics', 'blocked']) assertReady(h, kind);
  assertNoLeak(h);
});

for (const [label, change] of [
  ['account id', auth => { auth.user.id = 'operator-b'; }],
  ['access token', auth => { auth.accessToken = 'session-b'; }],
  ['refresh token', auth => { auth.refreshToken = 'refresh-b'; }],
  ['admin identity', auth => { auth.user.adminUser.id = 'admin-b'; }],
  ['admin status', auth => { auth.user.adminUser.status = 'suspended'; }],
  ['role', auth => { auth.user.adminRole = 'content_admin'; }],
  ['permissions despite retained role access', auth => { auth.user.adminPermissions = ['community:read']; }],
  ['permissions revoked', auth => { auth.user.adminRole = null; auth.user.adminPermissions = []; }],
  ['no token', auth => { delete auth.accessToken; }],
  ['no identity', auth => { delete auth.user.id; delete auth.user.adminUser.id; }],
]) for (const result of ['success', 'failure']) test(`late ${result} after changed ${label} cannot render`, async () => {
  const initial = adminAuth(), h = harness(initial), pending = h.load();
  const next = clone(initial); change(next); h.setAuth(next);
  const before = h.snapshot();
  if (result === 'success') h.settle(payloads('old-owner'));
  else h.calls.forEach(call => call.reject(new Error(failedPrivateText)));
  await pending;
  assert.deepEqual(h.snapshot(), before);
  assertNoLeak(h);
});

for (const mode of ['logout', 'hidden-dashboard', 'shared-auth-account-change']) test(`${mode} blocks old callbacks`, async () => {
  const h = harness(), pending = h.load();
  if (mode === 'hidden-dashboard') h.hideDashboard();
  else if (mode === 'logout') h.setAuth(null);
  else {
    h.setAuth(null);
    const next = adminAuth(); next.user.id = 'shared-operator-b'; h.setAuth(next, 'lumina_auth');
  }
  const before = h.snapshot(); h.settle(payloads('old-owner')); await pending;
  assert.deepEqual(h.snapshot(), before);
  assertNoLeak(h);
});

for (const result of ['success', 'failure']) test(`older ${result} cannot overwrite a newer successful request`, async () => {
  const h = harness(), old = h.load(), oldCalls = h.calls.slice();
  const current = h.load(), currentCalls = h.calls.slice(4);
  h.settle(payloads('newest'), currentCalls); await current;
  const before = h.snapshot();
  if (result === 'success') h.settle(payloads('older'), oldCalls);
  else oldCalls.forEach(call => call.reject(new Error(failedPrivateText)));
  await old;
  assert.deepEqual(h.snapshot(), before);
  assertNoLeak(h);
});

test('older data cannot replace the newer loading or successful empty states', async () => {
  const h = harness(), old = h.load(), oldCalls = h.calls.slice();
  const current = h.load(), currentCalls = h.calls.slice(4), loading = h.snapshot();
  h.settle(payloads('older'), oldCalls); await old;
  assert.deepEqual(h.snapshot(), loading);
  h.settle(Object.fromEntries(Object.keys(targets).map(kind => [kind, { items: [] }])), currentCalls);
  await current;
  for (const [kind, id] of Object.entries(targets)) assert.ok(h.roots[id].innerHTML.includes(emptyText[kind]));
  assertNoLeak(h);
});

test('a rejected new read invalidates older callbacks even if the same account returns', async () => {
  const initial = adminAuth(), h = harness(initial), old = h.load(), oldCalls = h.calls.slice();
  h.setAuth(null); await h.load();
  assert.equal(h.calls.length, 4, 'Unauthenticated new read never sends requests');
  const before = h.snapshot(); h.setAuth(initial);
  h.settle(payloads('older'), oldCalls); await old;
  assert.deepEqual(h.snapshot(), before);
  assertNoLeak(h);
});

test('direct reads fail closed without a current operator or moderation section access', async () => {
  for (const auth of [null, { accessToken: 'missing-user' }, adminAuth('finance_admin', ['payments:read'])]) {
    const h = harness(auth); await h.load();
    assert.equal(h.calls.length, 0);
    for (const id of Object.values(targets)) assert.match(h.roots[id].innerHTML, /role="alert".*세션과 조회 권한/);
    assertNoLeak(h);
  }
});

test('existing moderation role and permission grants still allow reads', async () => {
  for (const [role, permissions] of [
    ['cs_admin', []], ['support_admin', []], ['content_admin', []],
    [null, ['*']], [null, ['community:read']], [null, ['community:write']], [null, ['reports:read']],
  ]) {
    const h = harness(adminAuth(role, permissions)), pending = h.load();
    assert.equal(h.calls.length, 4); h.settle(); await pending;
    for (const kind of Object.keys(targets)) assertReady(h, kind);
    assertNoLeak(h);
  }
});

test('moderation source never restores samples or emits raw diagnostic output', () => {
  assert.doesNotMatch(moderationSource, /backstageRows|renderBackstageTables|renderFallbackNote|console\./);
  assert.doesNotMatch(moderationSource, /\.catch\(\(\) => null\)|error\.(message|body|stack)/);
});

test('the four initial moderation tables render loading notices without reading any sample rows or adding actions', () => {
  const initial = segment('function renderBackstageTables()', 'function setActiveSection(');
  const sampleKeys = new Set(['moderation', 'moderationReports', 'feedSearches', 'feedBlockedTerms']);
  const roots = Object.fromEntries(Object.values(targets).map(id => [id, { innerHTML: '' }]));
  const context = {
    document: { getElementById: id => roots[id] || null },
    backstageRows: new Proxy({}, { get(_target, key) {
      assert.equal(sampleKeys.has(key), false, `Initial rendering must not access sample ${key}`);
      return [];
    } }),
    sectionState: {},
    mergeLogRows: rows => rows,
    renderRows(id) { assert.equal(Object.values(targets).includes(id), false, `No initial row actions for ${id}`); },
  };
  runInNewContext([
    segment('const tableMeta =', 'const sectionLoaders ='),
    segment('function renderLoadingRow(', 'function renderFallbackNote('),
    segment('let creatorsNativeReadProof =', 'function syncCurrentAdminContext('),
    initial, 'renderBackstageTables();',
  ].join('\n'), context);
  for (const root of Object.values(roots)) {
    assert.match(root.innerHTML, /불러오는 중/);
    assert.doesNotMatch(root.innerHTML, /data-detail=|row-action/);
  }
});

test('existing AI-content source extraction remains declaration-only for new moderation helpers', () => {
  const aiRuntime = segment('async function loadAiContentSection()', 'async function loadModerationSection()');
  assert.ok(aiRuntime.includes('let moderationReadGeneration = 0;'));
  assert.ok(aiRuntime.includes('function moderationReadContext()'));
  runInNewContext(aiRuntime, {}, { filename: 'backstage.js:ai-extractor-boundary' });
});
