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
const nativeContextStart = source.indexOf('let creatorsNativeReadProof =');
const nativeContextEnd = source.indexOf('function syncCurrentAdminContext(', nativeContextStart);
assert.ok(nativeContextStart >= 0 && nativeContextEnd > nativeContextStart, 'Missing actual creators context declarations');
const nativeContextSource = source.slice(nativeContextStart, nativeContextEnd);
const runtime = [
  nativeContextSource,
  excerpt('getCurrentSection', 'saveActiveSection'),
  excerpt('localHistoryRows', 'mergeLogRows'),
  excerpt('mergeLogRows', 'setStatus'),
  excerpt('formatHistoryTime', 'renderDetailHistory'),
  excerpt('escapeHtml', 'firstRoleName'),
  excerpt('statusBadge', 'renderSettlementChildren'),
  excerpt('formatCount', 'renderSummaryKpis'),
  excerpt('renderBackstageSummary', 'normalizeReadinessCategories'),
  excerpt('appendActionHistory', 'renderDetailPanel'),
  excerpt('renderBackstageTables', 'setActiveSection'),
  `const actualRenderRows = renderRows;
   renderRows = (id, rows, status) => { captures.push({ id, rows, status }); actualRenderRows(id, rows, status); };
   this.api = { merge: mergeLogRows, summary: renderBackstageSummary, render: renderRows,
     append: appendActionHistory, tables: renderBackstageTables, time: formatHistoryTime };`,
].join('\n');

const encode = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
})[char]);
const decodeOnce = value => value.replace(/&(amp|lt|gt|quot|#039);/g, (_, entity) => ({
  amp: '&', lt: '<', gt: '>', quot: '"', '#039': "'",
})[entity]);
const plain = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function cells(markup) {
  return [...markup.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/g)].map(match =>
    decodeOnce(match[1].replace(/<\/?(?:button|span)\b[^>]*>/g, '')));
}
function safeMarkup(markup, rowCount) {
  assert.doesNotMatch(markup, /<(?:img|svg|script|iframe|fixture-tag)\b/i);
  assert.equal((markup.match(/<tr\b/g) || []).length, rowCount);
  assert.equal((markup.match(/<td\b/g) || []).length, rowCount * 5);
  assert.equal((markup.match(/<button class="row-action"/g) || []).length, rowCount);
}

// Real mapper/helper/renderer excerpts; only storage and surrounding DOM/services are synthetic.
function harness({ history = [], serverRows = [], operator = 'operator@example.invalid' } = {}) {
  let stored = history;
  const nodes = Object.fromEntries(['logRows', 'overviewQueueRows', 'riskRows'].map(id => [id, { innerHTML: '' }]));
  const captures = [];
  const forwarded = [];
  const backstageRows = Object.fromEntries(['admins', 'adminRequests', 'overviewQueue', 'risk', 'creators',
    'creatorImageRequests', 'aiCreators', 'contentAnomalies', 'reportCancels', 'studioSettlement',
    'settlement', 'settlementConversions', 'aiSettlement'].map(key => [key, []]));
  backstageRows.logs = serverRows;
  const context = {
    captures, backstageRows, sectionState: { logs: { rows: serverRows } }, selectedDetail: null,
    document: { getElementById: id => nodes[id] || null, querySelector(selector) {
      assert.equal(selector, '.dashboard-main');
      return { getAttribute(name) { assert.equal(name, 'data-active-section'); return 'overview'; } };
    } },
    tableMeta: Object.fromEntries(Object.keys(nodes).map(id => [id, { type: 'synthetic',
      labels: ['time', 'actor', 'action', 'target', 'reason'] }])),
    statusClassMap: { hidden: 'is-hidden', submitted: 'is-review' },
    readActionHistory: () => stored,
    writeActionHistory: rows => { stored = rows; },
    currentOperatorLabel: () => operator,
    actionChangeLabel: preview => preview.actionLabel || 'Review',
    detailHistoryKey: () => 'synthetic-detail',
    renderDetailHistory: () => assert.fail('Unexpected detail render'),
    renderLoadingRow: () => undefined,
    renderSummaryKpis: value => forwarded.push({ kind: 'kpis', value }),
    renderSummaryAlerts: value => forwarded.push({ kind: 'alerts', value }),
  };
  runInNewContext(runtime, context, { filename: 'backstage.js:overview-audit-synthetic', timeout: 1000 });
  return { api: context.api, nodes, captures, forwarded, context,
    get stored() { return stored; },
    last(id) { return captures.filter(value => value.id === id).at(-1); } };
}

const local = extra => ({ createdAt: '2026-10-05T01:00:00.000Z', actor: 'operator@example.invalid',
  actionLabel: 'Review', target: 'Synthetic target', note: 'Synthetic reason', ...extra });
const audit = extra => ({ createdAt: '2026-10-05T01:00:00.000Z', actorUser: { email: 'operator@example.invalid' },
  action: 'user.self_delete', targetType: 'user', metadata: { reason: 'Synthetic reason' }, ...extra });
const auditTime = value => new Date(value).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

test('merge: raw local history is encoded once through the actual renderer, with original storage untouched', () => {
  const entry = freeze(local({ actor: 'operator&<svg onload="synthetic()">@example.invalid',
    actionLabel: '</td><script>synthetic()</script>', target: '<img src=x onerror="synthetic()">',
    note: '<iframe src="javascript:synthetic()"></iframe> & "quoted" \'single\'' }));
  const history = freeze([entry]);
  const h = harness({ history });
  const merged = h.api.merge([]);
  const expected = [h.api.time(entry.createdAt), entry.actor, entry.actionLabel, entry.target, entry.note];
  assert.deepEqual(Array.from(merged[0]), expected.map(encode));
  h.api.render('logRows', merged, -1);
  safeMarkup(h.nodes.logRows.innerHTML, 1);
  assert.deepEqual(cells(h.nodes.logRows.innerHTML), expected);
  assert.equal(h.stored, history);
  assert.equal(h.stored[0], entry);
});

test('merge: local-first20/total40 keeps cached encoded server row references and never mutates/double-escapes them', () => {
  const history = freeze(Array.from({ length: 25 }, (_, index) => local({ actor: `Local ${index}` })));
  const serverRows = freeze(Array.from({ length: 45 }, (_, index) => [
    `server-${index}`, 'server &amp; literal &amp;lt;tag&amp;gt;', '&lt;safe-action&gt;', 'user', 'encoded &quot;reason&quot;',
  ]));
  const snapshot = plain(serverRows);
  const h = harness({ history, serverRows });
  for (let repeat = 0; repeat < 2; repeat++) {
    const merged = h.api.merge(serverRows);
    assert.equal(merged.length, 40);
    for (let index = 0; index < 20; index++) {
      assert.equal(merged[index][1], `Local ${index}`);
      assert.equal(merged[index + 20], serverRows[index]);
      assert.equal(merged[index + 20][1], serverRows[index][1]);
    }
    h.api.render('logRows', merged, -1);
    safeMarkup(h.nodes.logRows.innerHTML, 40);
  }
  assert.deepEqual(plain(serverRows), snapshot);
  assert.equal(h.context.sectionState.logs.rows, serverRows);
  assert.equal(h.context.backstageRows.logs, serverRows);
  assert.equal(h.stored, history);
  const emptyLocal = harness();
  assert.equal(emptyLocal.api.merge(serverRows)[0], serverRows[0]);
  assert.equal(emptyLocal.api.merge(null).length, 0);
});

test('appendActionHistory and renderBackstageTables actual callsites protect local reasons without escaping cached page rows again', () => {
  const cached = freeze([['server-time', 'masked-***', '&lt;server-action&gt;', 'user', 'reason &amp; detail']]);
  const h = harness({ serverRows: cached, operator: 'operator&name@example.invalid' });
  const entry = h.api.append({ target: '<svg onload="synthetic()">',
    note: '</td><img src=x onerror="synthetic()"> & reason', actionLabel: 'Review' });
  assert.equal(h.last('logRows').rows[0][4], encode(entry.note));
  assert.equal(h.last('logRows').rows[1], cached[0]);
  safeMarkup(h.nodes.logRows.innerHTML, 2);
  const firstMarkup = h.nodes.logRows.innerHTML;
  h.api.tables();
  assert.equal(h.last('logRows').rows[1], cached[0]);
  assert.equal(h.nodes.logRows.innerHTML, firstMarkup);
  safeMarkup(h.nodes.logRows.innerHTML, 2);
  assert.equal(h.stored[0].note, entry.note);
  assert.equal(h.context.sectionState.logs.rows, cached);
});

test('summary audit: selected raw actor/action/target/direct-or-metadata reason are text, not masked-contract substitutions', () => {
  const events = freeze([
    audit({ actorUser: { email: 'raw&<fixture-tag>@example.invalid', emailMasked: 'DO_NOT_SELECT_MASK' },
      action: 'user.self_delete<script>synthetic()</script>', targetType: '<svg onload="synthetic()">',
      reason: '<img src=x onerror="synthetic()"> & primary', metadata: { reason: 'Unselected reason' } }),
    audit({ actorUser: { email: '', emailMasked: 'DO_NOT_SELECT_MASK' }, action: '', targetType: '',
      reason: '', metadata: { reason: '<iframe src="javascript:synthetic()"></iframe>' } }),
    audit({ actorUser: null, metadata: {} }),
  ]);
  const summary = freeze({ tables: { recentAuditEvents: events } });
  const h = harness({ history: freeze([local()]) });
  h.api.summary(summary);
  const rows = h.last('logRows').rows;
  const expected = events.map(item => [auditTime(item.createdAt), item.actorUser?.email || 'system',
    item.action || '-', item.targetType || '-', item.reason || item.metadata?.reason || '-']);
  expected.forEach((row, index) => assert.deepEqual(Array.from(rows[index + 1]), row.map(encode)));
  safeMarkup(h.nodes.logRows.innerHTML, 4);
  assert.deepEqual(cells(h.nodes.logRows.innerHTML).slice(5), expected.flat());
  assert.doesNotMatch(h.nodes.logRows.innerHTML, /DO_NOT_SELECT_MASK|Unselected reason/);
  assert.equal(summary.tables.recentAuditEvents, events);
});

test('summary debut: chosen display/applicant/contact fallback and status are encoded without changing priority', () => {
  const selected = ['<img src=x onerror="synthetic()"> & display', '<svg onload="synthetic()"> applicant',
    'contact&<fixture-tag>@example.invalid'];
  const items = freeze([
    { id: 'debut-fixture-1', displayName: selected[0], applicantName: 'Unselected applicant', contactEmail: 'unselected@example.invalid', status: 'submitted' },
    { id: 'debut-fixture-2', displayName: '', applicantName: selected[1], contactEmail: 'unselected@example.invalid', status: 'reviewing' },
    { id: 'debut-fixture-3', applicantName: '', contactEmail: selected[2], status: '<script>synthetic()</script>' },
  ]);
  const h = harness();
  h.api.summary(freeze({ tables: { recentDebutApplications: items } }));
  const rows = h.last('overviewQueueRows').rows;
  selected.forEach((value, index) => {
    assert.equal(rows[index][2], encode(value));
    assert.equal(rows[index][0], items[index].id.slice(0, 8));
    assert.equal(rows[index][3], encode(items[index].status));
  });
  safeMarkup(h.nodes.overviewQueueRows.innerHTML, 3);
  assert.deepEqual(cells(h.nodes.overviewQueueRows.innerHTML).filter((_, index) => index % 5 === 2), selected);
  assert.doesNotMatch(h.nodes.overviewQueueRows.innerHTML, /Unselected applicant|unselected@example/);
});

test('summary risk: post type and formatCount string fallback are text while hidden/review controls retain semantics', () => {
  const items = freeze([
    { id: 'risk-fixture-1', postType: '<img src=x onerror="synthetic()">', reportCount: 3, status: 'hidden' },
    { id: 'risk-fixture-2', postType: '', reportCount: '<svg onload="synthetic()">', status: 'published' },
  ]);
  const h = harness();
  h.api.summary(freeze({ tables: { highRiskPosts: items } }));
  const rows = h.last('riskRows').rows;
  assert.equal(rows[0][1], encode(items[0].postType));
  assert.equal(rows[0][2], '\uC2E0\uACE0 3\uAC74');
  assert.equal(rows[0][3], '\uC228\uAE40');
  assert.equal(rows[0][4], '\uBCF5\uAD6C');
  assert.equal(rows[1][1], '\uD53C\uB4DC');
  assert.equal(rows[1][2], encode(`\uC2E0\uACE0 ${items[1].reportCount}\uAC74`));
  assert.equal(rows[1][3], '\uD655\uC778\uC911');
  assert.equal(rows[1][4], '\uC228\uAE40');
  safeMarkup(h.nodes.riskRows.innerHTML, 2);
  assert.equal(cells(h.nodes.riskRows.innerHTML)[7], `\uC2E0\uACE0 ${items[1].reportCount}\uAC74`);
});

test('healthy summary: cell order/status badges/actions/time and exact KPI/alert argument references are preserved', () => {
  const summary = freeze({ kpis: [{ key: 'synthetic-kpi', value: 3 }], alerts: [{ key: 'synthetic-alert', count: 1 }], tables: {
    recentAuditEvents: [audit()], recentDebutApplications: [{ id: 'debut-fixture', displayName: 'Healthy applicant', status: 'submitted' }],
    highRiskPosts: [{ id: 'risk-fixture', postType: 'feed', reportCount: 2, status: 'hidden' }],
  } });
  const original = plain(summary);
  const h = harness();
  h.api.summary(summary);
  assert.equal(h.forwarded[0].value, summary.kpis);
  assert.equal(h.forwarded[1].value, summary.alerts);
  assert.deepEqual(cells(h.nodes.logRows.innerHTML), [auditTime(summary.tables.recentAuditEvents[0].createdAt),
    'operator@example.invalid', 'user.self_delete', 'user', 'Synthetic reason']);
  assert.deepEqual(cells(h.nodes.overviewQueueRows.innerHTML), ['debut-fi', '\uB370\uBDD4 \uC2E0\uCCAD', 'Healthy applicant', 'submitted', '\uBCF4\uAE30']);
  assert.deepEqual(cells(h.nodes.riskRows.innerHTML), ['risk-fix', 'feed', '\uC2E0\uACE0 2\uAC74', '\uC228\uAE40', '\uBCF5\uAD6C']);
  assert.match(h.nodes.overviewQueueRows.innerHTML, /<span class="status-badge is-review">submitted<\/span>/);
  for (const node of Object.values(h.nodes)) safeMarkup(node.innerHTML, 1);
  assert.deepEqual(plain(summary), original);
});

test('summary repeated raw entity text stays literal; null/empty tables preserve existing no-render behavior', () => {
  const h = harness();
  for (const [id, node] of Object.entries(h.nodes)) node.innerHTML = `prior-${id}`;
  h.api.summary(null);
  h.api.summary({ tables: {} });
  assert.equal(h.captures.length, 0);
  for (const [id, node] of Object.entries(h.nodes)) assert.equal(node.innerHTML, `prior-${id}`);
  const item = freeze(audit({ actorUser: { email: '&lt;literal&gt;@example.invalid' },
    metadata: { reason: 'literal &amp; &quot; text' } }));
  const summary = freeze({ tables: { recentAuditEvents: [item] } });
  h.api.summary(summary);
  const first = h.nodes.logRows.innerHTML;
  assert.equal(h.last('logRows').rows[0][1], encode(item.actorUser.email));
  assert.equal(h.last('logRows').rows[0][4], encode(item.metadata.reason));
  h.api.summary(summary);
  assert.equal(h.nodes.logRows.innerHTML, first);
  assert.equal(cells(first)[1], item.actorUser.email);
  assert.equal(cells(first)[4], item.metadata.reason);
  assert.equal(summary.tables.recentAuditEvents[0], item);
});
