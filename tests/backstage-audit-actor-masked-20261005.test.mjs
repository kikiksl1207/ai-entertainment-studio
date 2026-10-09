import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
function excerpt(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}
const runtime = [
  excerpt('function creatorsNativeIsTable(', 'function creatorsNativeIsDetail('),
  excerpt('function normalizePage(', 'function readSectionSearch('),
  excerpt('function escapeHtml(', 'function firstRoleName('),
  excerpt('function statusBadge(', 'function renderSettlementChildren('),
  excerpt('function backstageErrorStatus(', 'function artistKnowledgeQueueErrorMessage('),
  excerpt('async function loadAdminsSection(', 'function renderUsersStatus('),
  excerpt('async function loadAuditPage(', 'function loadSection('),
  'this.api = { admins: loadAdminsSection, logs: loadAuditPage, escape: escapeHtml };',
].join('\n');

// Actual loader/renderer excerpts run with synthetic data and an in-memory DOM only.
function harness(surface) {
  const nodes = Object.fromEntries(['adminRows', 'adminRequestRows', 'logRows'].map(id => [id, {
    innerHTML: '', querySelector: () => null,
  }]));
  const calls = []; const merged = []; const more = []; const synced = [];
  const context = {
    backstageAuthEpoch: 0,
    URLSearchParams,
    document: { getElementById: id => nodes[id] },
    sectionState: { admins: {}, logs: { rows: [], cursor: null, hasMore: false } },
    getBackstageAuth: () => ({ accessToken: 'synthetic-token', user: { id: 'synthetic-operator' } }),
    dashboardView: { classList: { contains: () => false } },
    getCurrentSection: () => surface,
    canAccessBackstageSection: section => ['admins', 'logs'].includes(section),
    localHistoryRows: () => [],
    tableMeta: {
      adminRows: { type: 'Admin', labels: Array.from({ length: 6 }, (_, i) => `admin-${i}`) },
      adminRequestRows: { type: 'Audit', labels: Array.from({ length: 6 }, (_, i) => `audit-${i}`) },
      logRows: { type: 'Log', labels: Array.from({ length: 5 }, (_, i) => `log-${i}`) },
    },
    statusClassMap: { active: 'is-active' },
    adminApiPath: path => `/admin/api/v1${path}`,
    backstageFetch: (path, options) => new Promise((resolve, reject) => calls.push({ path, options, resolve, reject })),
    renderLoadingRow: (id, message = 'loading') => { nodes[id].innerHTML = message; },
    renderBackstageTables: () => assert.fail('Unexpected fallback'),
    renderFallbackNote: () => assert.fail('Unexpected fallback'),
    syncCurrentAdminContext: rows => synced.push(rows),
    localizeAdminRole: value => value, localizeAdminStatus: value => value,
    formatDate: value => value, summarizePermissions: value => value.join(', '),
    formatAuditAction: value => `action:${value}`,
    mergeLogRows: rows => { merged.push(rows); return rows; },
    setLoadMore: (section, value) => more.push([section, value]),
  };
  runInNewContext(runtime, context, { filename: 'backstage.js:audit-actor-synthetic' });
  return { context, nodes, calls, merged, more, synced, api: context.api,
    start: append => surface === 'admins' ? context.api.admins() : context.api.logs(append),
    complete(items, extra = {}) {
      const page = { items, hasMore: false, nextCursor: null, ...extra };
      if (surface === 'admins') {
        calls.find(call => call.path.endsWith('/admin-users')).resolve({ items: [] });
        calls.find(call => call.path.endsWith('/admin-roles')).resolve({ items: [] });
      }
      calls.find(call => call.path.includes('/audit-events?')).resolve(page);
      return page;
    },
    get rows() { return surface === 'admins' ? context.sectionState.admins.auditRows : context.sectionState.logs.rows; },
    get markup() { return nodes[surface === 'admins' ? 'adminRequestRows' : 'logRows'].innerHTML; },
    get actorIndex() { return surface === 'admins' ? 4 : 1; },
  };
}

const event = extra => ({ id: 'fixture-event-0001', actorUserId: 'fixture-actor-0001',
  action: 'fixture.action', targetType: 'admin_user', targetId: 'fixture-target-0001',
  createdAt: '2026-10-05T01:00:00.000Z', metadata: { reason: 'fixture reason' }, ...extra });
const frozenEvent = extra => {
  const value = event(extra);
  if (value.actorUser) Object.freeze(value.actorUser);
  Object.freeze(value.metadata);
  return Object.freeze(value);
};

for (const surface of ['admins', 'logs']) {
  test(`${surface}: masked actor field is authoritative, raw field ignored and other cells unchanged`, async () => {
    const h = harness(surface);
    const fixture = frozenEvent({ actorUser: { emailMasked: 'fixture-***', email: 'raw-fixture-never-display' } });
    const pending = h.start(false); const page = h.complete(Object.freeze([fixture])); await pending;
    assert.equal(h.rows[0][h.actorIndex], 'fixture-***');
    assert.ok(h.markup.includes('fixture-***')); assert.ok(!h.markup.includes('raw-fixture-never-display'));
    assert.equal(page.items[0], fixture);
    assert.equal(fixture.actorUser.emailMasked, 'fixture-***');
    if (surface === 'admins') {
      assert.deepEqual(Array.from(h.rows[0]), ['fixture-', 'action:fixture.action', 'admin_user', '\uC644\uB8CC', 'fixture-***', '\uC0C1\uC138']);
      assert.match(h.markup, /<span class="status-badge is-review">/);
      assert.equal(h.calls.length, 3);
    } else {
      assert.deepEqual(Array.from(h.rows[0]).slice(2), ['fixture.action', 'admin_user', 'fixture reason']);
      assert.equal(h.calls.length, 1);
    }
    assert.match(h.markup, /<button class="row-action"/);
    for (const call of h.calls) {
      if (surface === 'logs') {
        assert.deepEqual(Object.keys(call.options).sort(), ['auth', 'isCurrent']);
        assert.equal(call.options.auth, true); assert.equal(call.options.isCurrent(), true);
      } else assert.deepEqual({ ...call.options }, { auth: true });
    }
  });

  test(`${surface}: complete selected masked value is HTML encoded by the actual renderer boundary`, async () => {
    const h = harness(surface);
    const malicious = ['<img src=x onerror="fixture()">', "<svg onload='fixture()'>", '<script>fixture()</script>', '&<>"\''];
    const fixtures = malicious.map(emailMasked => frozenEvent({ actorUser: { emailMasked, email: '<raw-field-never-display>' } }));
    const pending = h.start(false); h.complete(fixtures); await pending;
    malicious.forEach((value, index) => {
      const encoded = h.api.escape(value);
      assert.equal(h.rows[index][h.actorIndex], encoded);
      assert.ok(h.markup.includes(encoded));
      const detailPayload = [...h.markup.matchAll(/data-detail="([^"]+)"/g)][index][1];
      assert.equal(JSON.parse(decodeURIComponent(detailPayload)).row[h.actorIndex], encoded);
    });
    assert.doesNotMatch(h.markup, /<(?:img|svg|script|raw-field)\b/i);
    assert.equal((h.markup.match(/<button class="row-action"/g) || []).length, fixtures.length);
    assert.equal(fixtures[0].actorUser.emailMasked, malicious[0]);
  });

  test(`${surface}: missing/empty masked actor retains encoded ID or system fallback, never raw email`, async () => {
    const h = harness(surface);
    const fixtures = [
      frozenEvent({ actorUser: null }),
      frozenEvent({ actorUser: { email: 'raw-fixture-never-display' } }),
      frozenEvent({ actorUser: { emailMasked: '', email: 'raw-fixture-never-display' } }),
      frozenEvent({ actorUser: undefined, actorUserId: null }),
      frozenEvent({ actorUser: null, actorUserId: '<svg>&xy-rest' }),
      frozenEvent({ actorUser: { emailMasked: null, email: 'raw-fixture-never-display' }, actorUserId: null }),
      frozenEvent({ actorUser: null, actorUserId: '' }),
    ];
    const pending = h.start(false); h.complete(fixtures); await pending;
    const expected = ['fixture-', 'fixture-', 'fixture-', 'system', '&lt;svg&gt;&amp;xy', 'system', 'system'];
    assert.deepEqual(Array.from(h.rows, row => row[h.actorIndex]), expected);
    assert.doesNotMatch(h.markup, /raw-fixture-never-display|<svg\b/);
  });

  test(`${surface}: delayed response preserves input/page references and existing pagination behavior`, async () => {
    const h = harness(surface);
    const fixture = frozenEvent({ actorUser: { emailMasked: '<late-fixture>', email: 'raw-fixture-never-display' } });
    const items = Object.freeze([fixture]);
    const oldRow = Object.freeze(['prior-date', 'prior-actor', 'prior-action', 'prior-target', 'prior-reason']);
    const state = h.context.sectionState.logs;
    const oldRows = [oldRow]; state.rows = oldRows; state.cursor = 'prior-cursor'; state.hasMore = true;
    const pending = h.start(true);
    assert.equal(state.rows, oldRows); assert.equal(state.cursor, 'prior-cursor'); assert.equal(state.hasMore, true);
    const call = h.calls.find(value => value.path.includes('/audit-events?'));
    const params = new URL(call.path, 'https://fixture.invalid');
    assert.equal(params.searchParams.get('take'), surface === 'admins' ? '10' : '20');
    assert.equal(params.searchParams.get('cursor'), surface === 'admins' ? null : 'prior-cursor');
    const page = h.complete(items, { hasMore: true, nextCursor: 'next-cursor' });
    await pending;
    assert.equal(page.items, items); assert.equal(page.items[0], fixture);
    assert.equal(fixture.actorUser.emailMasked, '<late-fixture>');
    assert.equal(h.rows.at(-1)[h.actorIndex], '&lt;late-fixture&gt;');
    if (surface === 'logs') {
      assert.equal(h.context.sectionState.logs, state); assert.equal(state.rows[0], oldRow);
      assert.equal(state.rows.length, 2); assert.equal(state.cursor, 'next-cursor'); assert.equal(state.hasMore, true);
      assert.deepEqual(h.more, [['logs', false], ['logs', true], ['logs', true]]);
    } else {
      assert.equal(state.rows, oldRows); assert.equal(h.rows.length, 1); assert.equal(h.synced.length, 1);
    }
  });
}
