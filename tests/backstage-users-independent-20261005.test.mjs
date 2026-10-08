import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { sourceWithoutAsset409Delta } from './support/backstage-asset409-inverse-compat-20261007.mjs';
import { sourceWithoutCreatorsReadDelta } from './support/backstage-creators-read-inverse-compat-20261009.mjs';

const current = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
// Freeze the pre-feature oracle so commits and shallow CI checkouts cannot change it.
const before = readFileSync(new URL('./fixtures/backstage-users-baseline-20261005.txt', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
assert.equal(createHash('sha256').update(before).digest('hex'), '8433bf09af7ecc861f5b8624605621b55143d37c363b27cbe41292d7a65bf69a');
const html = readFileSync(new URL('../backstage/index.html', import.meta.url), 'utf8');
const resetBlock = [
  '    if (status === 401 || status === 403) {',
  '      state.rows = [];',
  '      state.riskRows = [];',
  '      state.cursor = null;',
  '      state.hasMore = false;',
  '      delete state.totalAccounts;',
  '      delete state.filteredAccounts;',
  '    }',
  '',
].join('\n');

function segment(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing independent source boundary: ${start}`);
  return source.slice(from, to);
}

function replaceExactly(source, from, to = '', count = 1) {
  assert.equal(source.split(from).length - 1, count, `Unexpected intentional feature anchor: ${from}`);
  return source.replaceAll(from, to);
}

function sourceWithoutFinanceTextDelta(source) {
  const finance = JSON.parse(readFileSync(new URL('./fixtures/backstage-finance-text-safe4-delta-20261006.json', import.meta.url), 'utf8'));
  assert.equal(finance.scope, 'safe4-finance-override-only');
  assert.equal(finance.beforeSHA256, 'b3eb3399b7b61f97899fcede3a29218fffac22259c3a5411d58fa89417079ed7');
  assert.equal(finance.afterSHA256, '62b920293ea88fc2f181d4c118eb725c60b214e298c8fa09ea7bea2a8034d26d');
  assert.equal(finance.fullTextFunctionCount, 2);
  assert.deepEqual(finance.names, ['settlementConversionEntryFromItem', 'renderDetailForm']);
  assert.deepEqual(finance.changes.map(change => change.name), finance.names);
  assert.equal(createHash('sha256').update(source).digest('hex'), finance.afterSHA256, 'Exact safe4 finance source before legacy classification inverse');
  for (const change of finance.changes) {
    assert.equal(createHash('sha256').update(change.beforeFullText).digest('hex'), change.beforeSHA256);
    assert.equal(createHash('sha256').update(change.afterFullText).digest('hex'), change.afterSHA256);
    source = replaceExactly(source, change.afterFullText, change.beforeFullText);
  }
  assert.equal(createHash('sha256').update(source).digest('hex'), finance.beforeSHA256, 'Every original800 byte restored before frozen8433/16 boundaries');
  return source;
}

// Remove only enumerated classification additions before comparing the frozen legacy source.
function sourceWithoutClassificationDelta(source) {
  source = sourceWithoutCreatorsReadDelta(source);
  source = sourceWithoutAsset409Delta(source);
  source = sourceWithoutFinanceTextDelta(source);
  for (const [start, end, expected] of [
    ['function setBackstageAuth(', 'function getSavedSection(', 'f69f197d003d0a1cb778f0cf89d27f755afbe97119766693a4753cd879f0bfe5'],
    ['async function backstageFetch(', 'window.LuminaBackstageApi =', '761a8ab40908305a450e5bca2651e2cbb8638db2ae23c42b9400b3d58a81c7e6'],
    ['async function refreshBackstageAuthOnce(', 'function applyAdminContext(', '36783787020add3b8f196fb04b187a9d8cffaa126b4b36fe68242702b04a8c99'],
    ['async function handleGoogleCredentialResponse(', 'async function handleGoogleLogin(', '233890f9666d7c28ad7723ef67a41cee9f08db4c87bcf832dcdd4a16f1fef084'],
    ['async function verifyAdminAccess(', 'function statusBadge(', '953c2e1d68380b0864972057ffea2fe1c38aa16ea34851cd8b6306d89d7d423c'],
    ['async function handleLogin(', 'async function bootstrapBackstage(', '50f4ce24f59ecd17294a6e01a3b586b5ebe4f9d414bc8117ae2db1eb20bbfc3c'],
    ['async function bootstrapBackstage(', 'document.querySelectorAll(".sidebar-nav a")', '40ba09cea7b3b39460e0a8bd98bd3fd71fd95790dd12041b91e6403dcb7420f6'],
    ['function mergeLogRows(', 'function setStatus(', '5ea4dd1f4757aa4eb3f0eb6a6fe8845169761cfc2f472c3eba4703ea0380a582'],
    ['function renderBackstageSummary(', 'function normalizeReadinessCategories(', '6fa0ae3782eae12e22b98d9b2ca66b0854d52018a1ab622c313ef9120853c2d3'],
    ['function selectDetailButton(', 'function collectDetailFormData(', 'e209ee816ecf56ce28b0a8ec41114e7a31c40b1dbea3b133401d2ac22c741a7d'],
    ['function showLogin(', 'function showDashboard(', '173d783a7e052e8e9ae9adfdac20c200db74d6af2a904e6cf63b0d93a1042353'],
    ['async function runAssetUploadRequest(', 'async function runBackstageRequest(', '970e703fe2d33caf6860d55cf24d5694c5e7e516220551e4c79e984e0ec50409'],
    ['async function runBackstageRequest(', 'async function reloadCurrentSectionAfterAction(', '9d3e9494264b31d0bd4728e257acfcde39b7550e160575c50eb3fcf292e17e4e'],
    ['async function runPreparedAction(', 'function renderBackstageTables(', '918e1826bc23cf80c368e9b642e92380d8d5d7044d6776944ea4bcfe256368c4'],
    ['async function loadAdminsSection(', 'function renderUsersStatus(', '29571f83ffb168c84534765fe44d812560d522647df5ddad794692d2260a6a3b'],
    ['async function loadAuditSection(', 'async function loadAuditPage(', '6ec9c51a665cf9d83fb169520a008eda1af5bab6d028ea05425f791cbd875af1'],
  ]) {
    const change = segment(source, start, end);
    assert.equal(createHash('sha256').update(change).digest('hex'), expected, `Exact separately tested boundary: ${start}`);
    source = replaceExactly(source, change, segment(before, start, end));
  }
  source = replaceExactly(source, 'let backstageAuthEpoch = 0;\n');
  const panel = segment(source, 'function renderDetailPanel(', 'function openQuickAction(');
  assert.equal(createHash('sha256').update(panel).digest('hex'),
    'eae261bd936602c26e071ff0f6ec30ddde81132c9af349a5d5a8a731787c0ef3');
  source = replaceExactly(source, '  detailTitle.textContent = typeof detail.titleText === "string"\n    ? detail.titleText : detail.row?.[2] || detail.row?.[0] || "상세 정보";',
    '  detailTitle.textContent = detail.row?.[2] || detail.row?.[0] || "상세 정보";');
  const users = segment(source, 'async function loadUsersSection(', 'async function loadCreatorsSection(');
  assert.equal(createHash('sha256').update(users).digest('hex'),
    '72259ac33731393eed5c15ea89070b85d938a80c744dc99e150791ff6953146f');
  let priorUsers = replaceExactly(users,
    '  const auth = getBackstageAuth();\n  if (!(auth?.accessToken || auth?.refreshToken) || !(auth.user?.id || auth.user?.userId)\n    || dashboardView.classList.contains("is-hidden") || !canAccessBackstageSection("users")) return;\n');
  priorUsers = replaceExactly(priorUsers, [
    '  const auth = getBackstageAuth();',
    '  const operatorId = auth?.user?.id || auth?.user?.userId;',
    '  const isCurrent = () => {',
    '    const current = getBackstageAuth();',
    '    return state === sectionState.users && classificationEpoch === (state.classificationEpoch || 0)',
    '      && Boolean(operatorId) && operatorId === (current?.user?.id || current?.user?.userId)',
    '      && Boolean(current?.accessToken || current?.refreshToken)',
    '      && !dashboardView.classList.contains("is-hidden") && canAccessBackstageSection("users");',
    '  };',
    '  if (!isCurrent() || state.loading || (append && (!state.hasMore || !state.cursor))) return;',
  ].join('\n'), '  if (state.loading || (append && (!state.hasMore || !state.cursor))) return;');
  priorUsers = replaceExactly(priorUsers, '    if (!isCurrent()) return;',
    '    if (state !== sectionState.users || classificationEpoch !== (state.classificationEpoch || 0)) return;', 2);
  priorUsers = replaceExactly(priorUsers, '    state.loading = false;\n    if (isCurrent()) {',
    '    if (state === sectionState.users) {\n      state.loading = false;');
  source = replaceExactly(source, users, priorUsers);
  // Pin the independently tested audit-only replacement; unrelated source remains byte-compared.
  const audit = segment(source, 'async function loadAuditPage(', 'function loadSection(');
  assert.equal(createHash('sha256').update(audit).digest('hex'),
    '2a4ad0c4ae7d082c734fad8c155e204985bf09f91cb89326221e77e9d29d2a18');
  source = replaceExactly(source, audit, segment(before, 'async function loadAuditPage(', 'function loadSection('));
  // The pinned admin/audit loaders above include their separately tested masked actor cells.
  const oldLabels = sourceLabels(before, 'userRows');
  const newLabels = sourceLabels(source, 'userRows');
  assert.deepEqual(newLabels, [...oldLabels.slice(0, -1), '계정 분류', oldLabels.at(-1)]);
  const oldLine = before.match(/^  userRows:.*$/m)[0];
  const newLine = source.match(/^  userRows:.*$/m)[0];
  const oldLiteral = `[${oldLabels.map(label => JSON.stringify(label)).join(', ')}]`;
  const newLiteral = `[${newLabels.map(label => JSON.stringify(label)).join(', ')}]`;
  assert.equal(newLine, oldLine.replace(oldLiteral, newLiteral));
  source = replaceExactly(source, newLine, oldLine);
  source = replaceExactly(source, '  syncUserClassificationPanel(detail);\n');
  source = replaceExactly(source, '    if (detail.tableId === "userRows" && index === 10) return "";\n');

  const sidecar = segment(source, '// Classification is a sidecar:', 'async function loadUsersSection(');
  const dashboardGuard = segment(sidecar, 'function userClassificationCurrent(', 'function invalidateUserClassificationContext(');
  assert.equal(createHash('sha256').update(dashboardGuard).digest('hex'),
    'a4e495a3372d4e319ca966212014a768f215740be2ce76a056787982946d8627');
  assert.deepEqual(Array.from(sidecar.matchAll(/^(?:async )?function (\w+)\(/gm), match => match[1]), [
    'userClassificationText', 'validUserClassificationTimestamp', 'normalizeUserClassification',
    'userClassificationLabel', 'userClassificationCounts', 'ensureUserClassificationControls',
    'userClassificationSession', 'userClassificationCurrent', 'invalidateUserClassificationContext',
    'userClassificationCommand', 'userClassificationCommandFailed', 'newUserClassificationKey',
    'fetchUserClassification', 'normalizeUserClassificationRead', 'renderUserClassificationPanel',
    'syncUserClassificationPanel', 'loadUserClassification', 'markUserClassificationListStale', 'saveUserClassification',
  ]);
  assert.ok(sidecar.includes('!currentAdminPermissions().includes("*")'));
  assert.ok(sidecar.includes('header.lastElementChild.before(cell)'));
  assert.ok(sidecar.includes('JSON.stringify(body) !== JSON.stringify(command)'));
  assert.ok(sidecar.includes('data.receipt?.revision !== command.expectedRevision + 1'));
  source = replaceExactly(source, sidecar);

  const status = segment(source, 'function renderUsersStatus(', 'async function loadUsersSection(');
  const countBlock = [
    '  const counts = state.classificationCounts;',
    '  const classificationSummary = counts',
    '    ? `${userClassificationText("globalTest")} ${formatCount(counts.globalTestAccounts)} · ${userClassificationText("globalUnclassified")} ${formatCount(counts.globalUnclassifiedAccounts)} · ${userClassificationText("filteredTest")} ${formatCount(counts.filteredTestAccounts)} · ${userClassificationText("filteredUnclassified")} ${formatCount(counts.filteredUnclassifiedAccounts)}`',
    '    : `${userClassificationText("countsUnavailable")} (계정 분류 정보 없음)`;',
    '',
  ].join('\n');
  let legacyStatus = replaceExactly(status, countBlock);
  legacyStatus = replaceExactly(legacyStatus, '${classificationSummary} · ${userClassificationText("noInference")}', classificationCopy.oldSummary);
  legacyStatus = replaceExactly(legacyStatus, '  ensureUserClassificationControls(section, status, state);\n');
  legacyStatus = replaceExactly(legacyStatus,
    '    status.append(" ", retry);\n  }\n  if (state.classificationStale || (state.error && state.rows.length)) {',
    '    status.append(" ", retry);\n    if (state.rows.length) {');
  legacyStatus = replaceExactly(legacyStatus,
    '      status.append(" ", reload);\n  }\n}', '      status.append(" ", reload);\n    }\n  }\n}');
  assert.equal(legacyStatus, segment(before, 'function renderUsersStatus(', 'async function loadUsersSection('));
  source = replaceExactly(source, status, legacyStatus);

  source = replaceExactly(source,
    'async function loadUsersSection(submittedSearch = readSectionSearch("users"), classification = sectionState.users.classification || "all") {',
    'async function loadUsersSection(submittedSearch = readSectionSearch("users")) {');
  source = replaceExactly(source,
    '  sectionState.users = { cursor: null, hasMore: false, rows: [], riskRows: [], search: submittedSearch,\n    classification: ["all", "test", "unclassified"].includes(classification) ? classification : "all",\n    classificationSupported: false };',
    '  sectionState.users = { cursor: null, hasMore: false, rows: [], riskRows: [], search: submittedSearch };');
  source = replaceExactly(source, '  const classificationEpoch = state.classificationEpoch || 0;\n');
  source = replaceExactly(source, '  const classificationFilter = document.getElementById("usersClassificationFilter");\n  if (classificationFilter) classificationFilter.disabled = true;\n');
  source = replaceExactly(source, '  query.set("classification", state.classification || "all");\n');
  source = replaceExactly(source,
    'if (state !== sectionState.users || classificationEpoch !== (state.classificationEpoch || 0)) return;',
    'if (state !== sectionState.users) return;', 2);
  source = replaceExactly(source,
    '    state.classificationCounts = userClassificationCounts(response);\n    state.classificationSupported = page.items.every((user) => normalizeUserClassification(user.testAccountClassification).available)\n      && Boolean(state.classificationCounts);\n    state.classificationStale = false;\n');
  source = replaceExactly(source, '        userClassificationLabel(user.testAccountClassification),\n');
  source = replaceExactly(source, ', testAccountClassification: user.testAccountClassification', '', 2);
  source = replaceExactly(source, '      state.classificationCounts = null;\n      state.classificationSupported = false;\n');
  source = replaceExactly(source,
    '    if (state === sectionState.users) {\n      state.loading = false;\n      const filter = document.getElementById("usersClassificationFilter");\n      if (filter) filter.disabled = !state.classificationSupported;\n    }',
    '    if (state === sectionState.users) state.loading = false;');
  const list = segment(source, 'async function loadUsersPage(', 'async function loadCreatorsSection(');
  let legacyList = list;
  for (const [expression, count] of [
    ['user.displayName || user.publicHandle || user.nickname || user.userId?.slice?.(0, 8) || user.id?.slice?.(0, 8) || "-"', 1],
    ['user.email || "-"', 1],
    ['user.loginType || user.loginTypes?.join(", ") || user.socialProvider || user.loginProvider || user.provider || "-"', 1],
    ['formatDate(user.lastSeenAt || user.lastLoginAt)', 1],
    ['localizeWorkflowStatus(user.status)', 2],
    ['user.displayName || user.publicHandle || user.email || user.userId?.slice?.(0, 8) || "-"', 1],
    ['user.latestReportReason || user.recentAction?.action || user.recentAction || "운영 확인"', 1],
    ['user.recentAction?.action || user.recentAction || (Number(user.sanctionCount || 0) > 0 ? `제재 ${formatCount(user.sanctionCount)}회` : "확인 필요")', 1],
  ]) {
    legacyList = replaceExactly(legacyList, `escapeHtml(${expression})`, expression, count);
  }
  source = replaceExactly(source, list, legacyList);
  source = replaceExactly(source, '    loadUsersSection("", "all");', '    loadUsersSection();');
  return source;
}

function runtime(source, transport) {
  return [
    segment(source, 'function publicApiPath(', 'async function verifyAdminAccess('),
    segment(source, 'function statusBadge(', 'function renderSettlementChildren('),
    segment(source, 'function normalizePage(', 'function currentSettlementPeriod('),
    segment(source, 'function setLoadMore(', 'function renderFallbackNote('),
    segment(source, 'function backstageErrorStatus(', 'function backstageUserFacingError('),
    segment(source, 'function renderUsersStatus(', 'async function loadCreatorsSection('),
    segment(source, 'document.addEventListener("click", (event) => {', 'detailCloseButton.addEventListener('),
    segment(source, 'document.querySelectorAll("[data-load-more]").forEach', 'fanMissionForm?.addEventListener('),
    ...(transport ? [
      ...(source.includes('let backstageAuthEpoch =')
        ? [segment(source, 'let backstageAuthEpoch =', 'const BACKSTAGE_SECTION_KEY =')] : []),
      segment(source, 'async function backstageFetch(', 'window.LuminaBackstageApi ='),
      segment(source, 'function normalizeAuthPayload(', 'function applyAdminContext('),
    ] : []),
    'this.load = loadUsersSection; this.appendPage = loadUsersPage;',
  ].join('\n');
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const denied = status => Object.assign(new Error('QA-only denied fixture'), { status });
const ids = rows => Array.from(rows, entry => entry.meta.userId);

function page(prefix, { more = true, total = 9, filtered = total } = {}) {
  return {
    items: [
      { id: `${prefix}-1`, status: 'active', openReportCount: 1 },
      { id: `${prefix}-2`, status: 'active' },
    ],
    totalAccounts: total,
    filteredAccounts: filtered,
    nextCursor: more ? `${prefix}-2` : null,
    hasMore: more,
  };
}

function classifiedPage(prefix, options = {}) {
  const fixture = page(prefix, options);
  fixture.items = fixture.items.map((item, index) => ({
    ...item, displayName: `${prefix}-name-${index}`, email: `${prefix}-${index}@example.invalid`,
    loginType: index ? 'password' : 'google', walletBalanceLumina: 17 + index,
    paidAmountKrw: 2300 + index, reportCount: 4 + index, sanctionCount: 2 + index,
    followingArtistCount: 6 + index, followerCount: 8 + index,
    lastSeenAt: `2026-10-05T02:00:0${index}.000Z`, status: index ? 'suspended' : 'active',
    latestReportReason: `${prefix}-report-${index}`, recentAction: { action: `${prefix}-action-${index}` },
    testAccountClassification: index
      ? { classification: 'unclassified', revision: 2, source: 'explicit_admin', updatedAt: '2026-10-05T02:00:00.000Z' }
      : { classification: 'test', revision: 1, source: 'explicit_admin', updatedAt: '2026-10-05T02:00:00.000Z' },
  }));
  const filteredTests = Math.min(3, Math.ceil(fixture.filteredAccounts / 2));
  fixture.summary = { globalTestAccounts: 3, globalUnclassifiedAccounts: fixture.totalAccounts - 3,
    filteredTestAccounts: filteredTests, filteredUnclassifiedAccounts: fixture.filteredAccounts - filteredTests };
  return fixture;
}

function sourceLabels(source, tableId) {
  const line = source.match(new RegExp(`^  ${tableId}: .*labels: (\\[[^\\n]+\\]) \\},$`, 'm'));
  assert.ok(line, `Missing actual ${tableId} labels`);
  return JSON.parse(line[1]);
}

const classificationCopy = {
  test: '시험계정', unclassified: '미분류', unavailable: '확인 불가',
  unavailableCounts: '분류 집계 확인 불가 (계정 분류 정보 없음)',
  noInference: '미분류는 실고객 판정이 아닙니다.',
  oldSummary: '테스트 계정 포함, 계정 분류 정보 없음',
};

function expectedClassificationLabel(value) {
  return value ? classificationCopy[value.classification]
    : `${classificationCopy.unclassified} · ${classificationCopy.unavailable}`;
}

// Assert the new cell/payload first, then remove only that cell for a full legacy comparison.
function legacyTableMarkup(markup, tableId, fixtures) {
  if (!markup.includes(`data-table-id="${tableId}"`)) {
    if (tableId === 'userRows') {
      assert.match(markup, /<td colspan="12">/);
      return markup.replace('<td colspan="12">', '<td colspan="11">');
    }
    return markup;
  }
  let rows = 0;
  const normalized = markup.replace(new RegExp(`<tr data-table-id="${tableId}">([\\s\\S]*?)</tr>`, 'g'), (whole, content) => {
    rows++;
    const cells = Array.from(content.matchAll(/<td>([\s\S]*?)<\/td>/g), match => match[0]);
    assert.equal(cells.length, tableId === 'userRows' ? 12 : 6);
    const encoded = content.match(/data-detail="([^"]+)"/);
    assert.ok(encoded, 'Keep the existing action payload in the comparison');
    const payload = JSON.parse(decodeURIComponent(encoded[1]));
    assert.equal(payload.tableId, tableId);
    const fixture = fixtures.get(payload.meta.userId);
    assert.ok(fixture, 'Every rendered row must belong to an explicitly supplied fixture');
    assert.deepEqual(payload.meta.testAccountClassification, fixture.testAccountClassification);
    delete payload.meta.testAccountClassification;
    if (tableId === 'userRows') {
      const label = expectedClassificationLabel(fixture.testAccountClassification);
      assert.equal(payload.row.length, 12);
      assert.equal(payload.row[10], label);
      assert.equal(cells[10], `<td>${label}</td>`);
      assert.equal(payload.labels.length, 12);
      assert.equal(payload.labels[10], '계정 분류');
      payload.row.splice(10, 1);
      payload.labels.splice(10, 1);
      cells.splice(10, 1);
    } else {
      assert.equal(payload.row.length, 6);
      assert.equal(payload.labels.length, 6);
    }
    return `<tr data-table-id="${tableId}">${cells.join('').replace(encoded[1], encodeURIComponent(JSON.stringify(payload)))}</tr>`;
  });
  assert.ok(rows > 0);
  return normalized;
}

function comparableSnapshot(h, source, fixtures, expectedCounts, expectedSupported = Boolean(expectedCounts)) {
  const snapshot = { ...h.snapshot(), inputDraft: h.input.value };
  if (source !== current) return snapshot;
  assert.equal(h.state.classification, 'all');
  assert.equal(Boolean(h.state.classificationSupported), expectedSupported);
  assert.deepEqual(h.state.classificationCounts ? JSON.parse(JSON.stringify(h.state.classificationCounts)) : null, expectedCounts);
  assert.equal(Boolean(h.state.classificationStale), false);
  const summary = expectedCounts
    ? `전체 시험계정 ${expectedCounts.globalTestAccounts} · 전체 미분류 ${expectedCounts.globalUnclassifiedAccounts} · 결과 시험계정 ${expectedCounts.filteredTestAccounts} · 결과 미분류 ${expectedCounts.filteredUnclassifiedAccounts}`
    : classificationCopy.unavailableCounts;
  const newText = `${summary} · ${classificationCopy.noInference}`;
  assert.equal(snapshot.statusText.split(newText).length, 2, 'Only the declared classification status delta can differ');
  snapshot.statusText = snapshot.statusText.replace(newText, classificationCopy.oldSummary);
  snapshot.usersMarkup = legacyTableMarkup(snapshot.usersMarkup, 'userRows', fixtures);
  snapshot.riskMarkup = legacyTableMarkup(snapshot.riskMarkup, 'userRiskRows', fixtures);
  return snapshot;
}

function comparableRequests(h, source) {
  return h.calls.map(call => {
    const url = new URL(call.path, 'https://qa-only.invalid');
    assert.equal(url.pathname, '/admin/api/v1/backstage/operations/users-overview');
    assert.deepEqual(JSON.parse(JSON.stringify(call.options)), { auth: true });
    assert.equal(url.searchParams.get('classification'), source === current ? 'all' : null);
    if (source === current) {
      assert.equal(url.searchParams.getAll('classification').length, 1);
      url.searchParams.delete('classification');
    }
    return url.pathname + url.search;
  });
}

// Only source excerpts run: no bootstrap, socket, storage, HTTP, real identity or browser.
function harness(source = current, { transport = false, realLabels = false } = {}) {
  let writes = 0;
  class Element {
    constructor(selectors = []) {
      this.selectors = new Set(selectors);
      this.dataset = {};
      this.children = [];
      this.listeners = {};
      this.attributes = {};
      this.value = '';
      this.classes = new Set();
      this.classList = {
        toggle: (name, enabled) => {
          writes++;
          if (enabled) this.classes.add(name);
          else this.classes.delete(name);
        },
        contains: name => this.classes.has(name),
      };
    }
    set innerHTML(value) { writes++; this.markup = value; this.children = []; }
    get innerHTML() { return this.markup || ''; }
    set textContent(value) { writes++; this.text = value; this.children = []; }
    get textContent() { return this.text || ''; }
    set disabled(value) { writes++; this.isDisabled = value; }
    get disabled() { return Boolean(this.isDisabled); }
    setAttribute(key, value) { writes++; this.attributes[key] = value; }
    append(...nodes) { writes++; this.children.push(...nodes); }
    addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
    matches(selector) {
      const attributes = {
        '[data-users-retry]': 'usersRetry',
        '[data-users-reload]': 'usersReload',
        '[data-users-show-all]': 'usersShowAll',
      };
      return this.selectors.has(selector)
        || (attributes[selector] && Object.hasOwn(this.dataset, attributes[selector]))
        || (selector === '.text-action' && this.className === 'text-action');
    }
    closest(selector) {
      if (this.matches(selector)) return this;
      if (selector === '.section-block') return section;
      if (selector === '.search-box') return searchBox;
      return null;
    }
  }

  const tables = { userRows: new Element(), userRiskRows: new Element() };
  const input = new Element(['.search-box input']);
  const searchButton = new Element(['.search-box .secondary-action']);
  const allButton = new Element();
  allButton.dataset.usersShowAll = '';
  allButton.className = 'text-action';
  const moreButton = new Element();
  moreButton.dataset.loadMore = 'users';
  const searchBox = { querySelector: selector => {
    assert.equal(selector, 'input');
    return input;
  } };
  let status;
  const section = {
    id: 'users',
    querySelector(selector) {
      if (selector === '[data-users-status]') return status;
      if (selector === '.section-title') return { after: node => { writes++; status = node; } };
      assert.fail(`Unexpected independent section selector: ${selector}`);
    },
  };
  const calls = [];
  const events = {};
  let memoryAuth = { accessToken: 'qa-only-access', refreshToken: 'qa-only-refresh', user: { id: 'synthetic-operator' } };
  function queue(path, options) {
    return new Promise((resolve, reject) => {
      const call = { path, options, settled: false };
      call.resolve = value => { assert.equal(call.settled, false); call.settled = true; resolve(value); };
      call.reject = error => { assert.equal(call.settled, false); call.settled = true; reject(error); };
      calls.push(call);
    });
  }
  const context = {
    URLSearchParams,
    BACKSTAGE_API_BASE: 'https://qa-only.invalid',
    sectionState: { users: { rows: [], riskRows: [], cursor: null, hasMore: false } },
    tableMeta: {
      userRows: { labels: realLabels ? sourceLabels(source, 'userRows') : Array(11).fill(''), type: 'qa-only' },
      userRiskRows: { labels: realLabels ? sourceLabels(source, 'userRiskRows') : Array(6).fill(''), type: 'qa-only' },
    },
    statusClassMap: {},
    document: {
      getElementById: id => id === 'users' ? section : tables[id],
      createElement: () => new Element(),
      querySelector(selector) {
        if (selector === '#users .search-box input') return input;
        if (selector === '[data-load-more="users"]') return moreButton;
        assert.fail(`Unexpected independent document selector: ${selector}`);
      },
      querySelectorAll(selector) {
        assert.equal(selector, '[data-load-more]');
        return [moreButton];
      },
      addEventListener: (name, callback) => { (events[name] ||= []).push(callback); },
    },
    formatCount: value => String(value ?? 0),
    krw: value => String(value ?? 0),
    formatDate: value => String(value ?? '-'),
    localizeWorkflowStatus: value => String(value ?? '-'),
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    fetch: queue,
    getBackstageAuth: () => memoryAuth,
    setBackstageAuth: value => { memoryAuth = value; },
    dashboardView: { classList: { contains: () => false } },
    canAccessBackstageSection: sectionId => sectionId === 'users',
    ...(!transport ? { backstageFetch: queue } : {}),
  };
  runInNewContext(runtime(source, transport), context, { filename: 'independent-users-source.vm.js' });

  const h = {
    calls, input, tables, moreButton,
    load: context.load,
    append: context.appendPage,
    get state() { return context.sectionState.users; },
    get writes() { return writes; },
    get status() { return status; },
    controls() {
      return status.children.filter(node => typeof node === 'object')
        .map(node => Object.keys(node.dataset)[0]);
    },
    click(action) {
      if (action === 'more') {
        assert.equal(moreButton.classes.has('is-hidden'), false, 'Only click an available more button');
        return moreButton.listeners.click[0]({ target: moreButton });
      }
      let target;
      if (action === 'search') target = searchButton;
      else if (action === 'all') target = allButton;
      else {
        const key = action === 'retry' ? 'usersRetry' : 'usersReload';
        target = status.children.find(node => typeof node === 'object' && Object.hasOwn(node.dataset, key));
        assert.ok(target, `Cannot fabricate missing ${action} control`);
      }
      for (const callback of events.click) callback({ target });
    },
    submit(value, action = 'enter') {
      input.value = value;
      if (action === 'search') return h.click('search');
      let prevented = false;
      for (const callback of events.keydown) {
        callback({ target: input, key: 'Enter', preventDefault: () => { prevented = true; } });
      }
      assert.equal(prevented, true);
    },
    async reply(call, body, httpStatus = 200) {
      call.resolve(transport ? { status: httpStatus, ok: httpStatus < 400, json: async () => body } : body);
      await flush();
    },
    async reject(call, error) { call.reject(error); await flush(); },
    snapshot() {
      return {
        rows: ids(h.state.rows), riskRows: ids(h.state.riskRows || []),
        cursor: h.state.cursor, hasMore: h.state.hasMore,
        totalAccounts: h.state.totalAccounts, filteredAccounts: h.state.filteredAccounts,
        ownsTotal: Object.hasOwn(h.state, 'totalAccounts'),
        ownsFiltered: Object.hasOwn(h.state, 'filteredAccounts'),
        search: h.state.search, loading: h.state.loading, error: h.state.error,
        usersMarkup: tables.userRows.innerHTML, riskMarkup: tables.userRiskRows.innerHTML,
        statusText: status.textContent, controls: h.controls(),
        moreHidden: moreButton.classes.has('is-hidden'), moreDisabled: moreButton.disabled,
      };
    },
    settled() { assert.ok(calls.every(call => call.settled), 'All synthetic requests must be settled'); },
  };
  return h;
}

function params(call) { return new URL(call.path, 'https://qa-only.invalid').searchParams; }

async function seed(h, prefix = 'qa-first', query = 'qa-submitted', makePage = page) {
  h.submit(query);
  await h.reply(h.calls.at(-1), makePage(prefix));
  assert.equal(h.state.loading, false);
}

function assertEmptyDenied(h) {
  assert.deepEqual(ids(h.state.rows), []);
  assert.deepEqual(ids(h.state.riskRows), []);
  assert.equal(h.state.cursor, null);
  assert.equal(h.state.hasMore, false);
  assert.equal(Object.hasOwn(h.state, 'totalAccounts'), false);
  assert.equal(Object.hasOwn(h.state, 'filteredAccounts'), false);
  assert.equal(h.state.loading, false);
  assert.equal(h.state.error, true);
  assert.match(h.tables.userRows.innerHTML, /role="alert"/);
  assert.match(h.tables.userRiskRows.innerHTML, /role="alert"/);
  assert.doesNotMatch(h.tables.userRows.innerHTML + h.tables.userRiskRows.innerHTML, /qa-first|qa-second/);
  assert.deepEqual(h.controls(), ['usersRetry']);
  assert.equal(h.moreButton.classes.has('is-hidden'), true);
}

test('comparison source differs only by ADMIN-01 authorization reset and submitted-search recovery', async t => {
  const legacyCurrent = sourceWithoutClassificationDelta(current);
  assert.equal(legacyCurrent.split(resetBlock).length, 2);
  const withoutRecovery = legacyCurrent.replace(resetBlock, '')
    .replace('async function loadUsersSection(submittedSearch = readSectionSearch("users")) {',
      'async function loadUsersSection() {')
    .replace('riskRows: [], search: submittedSearch };', 'riskRows: [], search: readSectionSearch("users") };')
    .replace('else loadUsersSection(sectionState.users.search || "");', 'else loadUsersSection();');
  assert.equal(withoutRecovery, before);
  t.diagnostic(`normalized current SHA256 ${createHash('sha256').update(current).digest('hex')}`);
  t.diagnostic(`Frozen dba3d4 source SHA256 ${createHash('sha256').update(before).digest('hex')}`);
  const from = html.indexOf('<section class="section-block" id="users">');
  const to = html.indexOf('</section>', from);
  assert.ok(from >= 0 && to > from);
  const usersHtml = html.slice(from, to);
  assert.match(usersHtml, /data-users-show-all/);
  assert.doesNotMatch(usersHtml, /data-section-filter/);
  const declared = classifiedPage('qa-declared', { more: false, total: 5, filtered: 3 });
  declared.items.push({ ...declared.items[1], id: 'qa-declared-baseline',
    testAccountClassification: { classification: 'unclassified', revision: 0, source: 'unclassified', updatedAt: null } });
  declared.summary = { globalTestAccounts: 1, globalUnclassifiedAccounts: 4, filteredTestAccounts: 1, filteredUnclassifiedAccounts: 2 };
  const legacy = classifiedPage('qa-legacy', { more: false });
  delete legacy.summary;
  legacy.items.forEach(item => { delete item.testAccountClassification; });
  for (const fixture of [declared, legacy]) {
    const fixtures = new Map(fixture.items.map(item => [item.id, item]));
    const oldHarness = harness(before, { realLabels: true });
    const newHarness = harness(current, { realLabels: true });
    for (const h of [oldHarness, newHarness]) {
      h.submit('qa-explicit');
      h.input.value = 'qa-unsubmitted-draft';
      await h.reply(h.calls.at(-1), fixture);
      assert.equal(h.state.search, 'qa-explicit');
      assert.equal(h.input.value, 'qa-unsubmitted-draft');
      h.settled();
    }
    assert.deepEqual(comparableSnapshot(newHarness, current, fixtures, fixture.summary ?? null),
      comparableSnapshot(oldHarness, before, fixtures, null));
    assert.deepEqual(comparableRequests(newHarness, current), comparableRequests(oldHarness, before));
  }
});

for (const status of [401, 403]) {
  test(`accumulated two-page cache -> ${status} -> 500 -> clean first-page recovery`, async () => {
    const h = harness();
    await seed(h);
    const second = h.click('more');
    await h.reply(h.calls.at(-1), page('qa-second'));
    await second;
    assert.equal(h.state.rows.length, 4);
    assert.equal(h.state.riskRows.length, 2);
    const failed = h.click('more');
    const deniedCall = h.calls.at(-1);
    const count = h.calls.length;
    await h.append();
    assert.equal(h.calls.length, count, 'Same-state loading guard prevents duplicate append');
    assert.equal(params(deniedCall).get('cursor'), 'qa-second-2');
    await h.reject(deniedCall, denied(status));
    await failed;
    assertEmptyDenied(h);
    await h.append();
    assert.equal(h.calls.length, count, 'Cleared continuation cannot start an append');
    h.click('retry');
    assert.equal(params(h.calls.at(-1)).get('cursor'), null);
    assert.deepEqual(h.controls(), [], 'First-page restart synchronously removes the retry control');
    await h.reject(h.calls.at(-1), denied(500));
    assertEmptyDenied(h);
    h.click('retry');
    assert.equal(params(h.calls.at(-1)).get('cursor'), null);
    await h.reply(h.calls.at(-1), page('qa-recovered', { more: false, total: 2 }));
    assert.deepEqual(ids(h.state.rows), ['qa-recovered-1', 'qa-recovered-2']);
    assert.deepEqual(ids(h.state.riskRows), ['qa-recovered-1']);
    assert.equal(h.state.totalAccounts, 2);
    assert.equal(h.state.error, false);
    h.settled();
  });

  test(`older success cannot resurrect cache after newer ${status}, including during retry`, async () => {
    const h = harness();
    await seed(h);
    const oldPending = h.click('more');
    const oldCall = h.calls.at(-1);
    h.submit('qa-new-submitted', 'search');
    await h.reject(h.calls.at(-1), denied(status));
    assertEmptyDenied(h);
    h.click('retry');
    const retry = h.calls.at(-1);
    const snapshot = h.snapshot();
    const writes = h.writes;
    await h.reply(oldCall, page('qa-old-success'));
    await oldPending;
    assert.deepEqual(h.snapshot(), snapshot);
    assert.equal(h.writes, writes, 'Obsolete success must not touch DOM or controls');
    assert.equal(h.state.loading, true, 'Obsolete finally must not unlock active retry');
    await h.reply(retry, page('qa-new-success', { more: false, total: 2 }));
    assert.deepEqual(ids(h.state.rows), ['qa-new-success-1', 'qa-new-success-2']);
    assert.equal(h.state.search, 'qa-new-submitted');
    h.settled();
  });

  test(`regression contract: ${status} retry must not implicitly submit a typed-only search`, async t => {
    async function observe(source) {
      const h = harness(source, { transport: true });
      await seed(h, 'qa-first', 'qa-submitted & / ?');
      h.input.value = '  qa-typed-only & / ?  ';
      const pending = h.click('more');
      await h.reply(h.calls.at(-1), { message: 'QA-only final denial' }, status);
      if (status === 401) {
        assert.equal(new URL(h.calls.at(-1).path).pathname, '/api/v1/auth/refresh');
        await h.reply(h.calls.at(-1), {}, 403);
      }
      await pending;
      h.click('retry');
      const retry = h.calls.at(-1);
      const observation = {
        query: params(retry).get('query'), cursor: params(retry).get('cursor'),
        stateSearch: h.state.search,
      };
      await h.reply(retry, page('qa-result', { more: false, total: 2 }));
      h.settled();
      return observation;
    }
    const oldResult = await observe(before);
    const newResult = await observe(current);
    assert.equal(oldResult.query, 'qa-submitted & / ?');
    assert.equal(newResult.cursor, null, 'First-page restart is intentional and must remain');
    t.diagnostic(`HEAD=${JSON.stringify(oldResult)} CURRENT=${JSON.stringify(newResult)}`);
    assert.equal(newResult.query, oldResult.query,
      'Authorization recovery changed retry into submission of an uncommitted draft search');
  });
}

const obsoleteOutcomes = [
  ['401', call => call.reject(denied(401))],
  ['403', call => call.reject(denied(403))],
  ['500', call => call.reject(denied(500))],
  ['network', call => call.reject(new TypeError('QA-only network failure'))],
  ['success', call => call.resolve(page('qa-obsolete'))],
  ['malformed', call => call.resolve({ items: null, totalAccounts: 123 })],
];

for (const [label, settle] of obsoleteOutcomes) {
  for (const replacement of ['search-pending', 'show-all-complete']) {
    test(`obsolete ${label} cannot mutate ${replacement} state, DOM, totals or loading lock`, async () => {
      const h = harness();
      await seed(h);
      const oldPending = h.click('more');
      const oldCall = h.calls.at(-1);
      if (replacement === 'search-pending') h.submit('  qa-replacement & / ?  ', 'search');
      else h.click('all');
      const activeCall = h.calls.at(-1);
      assert.equal(params(activeCall).get('cursor'), null);
      assert.equal(params(activeCall).get('query'), replacement === 'search-pending' ? 'qa-replacement & / ?' : null);
      if (replacement === 'show-all-complete') {
        await h.reply(activeCall, page('qa-active', { total: 7, filtered: 7 }));
        assert.equal(h.input.value, '');
      }
      const activeState = h.state;
      const snapshot = h.snapshot();
      const writes = h.writes;
      settle(oldCall);
      await oldPending;
      assert.equal(h.state, activeState);
      assert.deepEqual(h.snapshot(), snapshot);
      assert.equal(h.writes, writes);
      if (replacement === 'search-pending') {
        const count = h.calls.length;
        await h.append();
        assert.equal(h.calls.length, count);
        await h.reply(activeCall, page('qa-active', { total: 7, filtered: 3 }));
      }
      const activeMore = h.click('more');
      const next = h.calls.at(-1);
      assert.equal(params(next).get('cursor'), 'qa-active-2');
      assert.equal(params(next).get('query'), replacement === 'search-pending' ? 'qa-replacement & / ?' : null);
      await h.reply(next, page('qa-active-next', { more: false, total: 7, filtered: 3 }));
      await activeMore;
      assert.deepEqual(ids(h.state.rows), ['qa-active-1', 'qa-active-2', 'qa-active-next-1', 'qa-active-next-2']);
      h.settled();
    });
  }
}

for (const [label, error] of [
  ['500', () => denied(500)],
  ['network', () => new TypeError('QA-only network failure')],
]) {
  test(`differential ${label}: page-two failure/retry and submitted-filter replacement match HEAD`, async () => {
    async function journey(source) {
      const h = harness(source, { realLabels: true });
      const fixtures = new Map();
      const makePage = (prefix, options) => {
        const fixture = classifiedPage(prefix, options);
        fixture.items.forEach(item => fixtures.set(item.id, item));
        return fixture;
      };
      await seed(h, 'qa-first', 'qa-submitted', makePage);
      const second = h.click('more');
      const secondPage = makePage('qa-second');
      await h.reply(h.calls.at(-1), secondPage);
      await second;
      const rows = h.state.rows;
      const risks = h.state.riskRows;
      const totals = [h.state.totalAccounts, h.state.filteredAccounts];
      h.input.value = 'qa-not-submitted';
      const failed = h.click('more');
      const failedPath = h.calls.at(-1).path;
      await h.reject(h.calls.at(-1), error());
      await failed;
      assert.equal(h.state.rows, rows);
      assert.equal(h.state.riskRows, risks);
      assert.deepEqual([h.state.totalAccounts, h.state.filteredAccounts], totals);
      assert.equal(h.state.search, 'qa-submitted');
      assert.equal(h.input.value, 'qa-not-submitted');
      const preserved = comparableSnapshot(h, source, fixtures, secondPage.summary);
      h.click('retry');
      assert.equal(h.calls.at(-1).path, failedPath);
      const retryCount = h.calls.length;
      h.click('retry');
      assert.equal(h.calls.length, retryCount, 'Visible retry control must not duplicate an active append');
      assert.equal(h.state.loading, true);
      await h.reject(h.calls.at(-1), new TypeError('QA-only repeated network failure'));
      assert.equal(h.state.rows, rows);
      assert.equal(h.state.riskRows, risks);
      h.click('retry');
      const thirdPage = makePage('qa-third', { more: false });
      await h.reply(h.calls.at(-1), thirdPage);
      assert.equal(h.state.search, 'qa-submitted');
      assert.equal(h.input.value, 'qa-not-submitted');
      const recovered = comparableSnapshot(h, source, fixtures, thirdPage.summary);
      h.submit('qa-replacement');
      await h.reject(h.calls.at(-1), error());
      assert.deepEqual(ids(h.state.rows), [], 'A new submitted query must not preserve another query cache');
      assert.equal(Object.hasOwn(h.state, 'totalAccounts'), false);
      assert.equal(h.state.search, 'qa-replacement');
      assert.equal(h.input.value, 'qa-replacement');
      const replaced = comparableSnapshot(h, source, fixtures, null);
      h.settled();
      return { preserved, recovered, replaced, requests: comparableRequests(h, source) };
    }
    assert.deepEqual(await journey(current), await journey(before));
  });
}

test('normal three-way search replacement is differential with HEAD in reverse completion order', async () => {
  async function journey(source) {
    const h = harness(source, { realLabels: true });
    h.submit('qa-a');
    const a = h.calls.at(-1);
    h.submit('qa-b', 'search');
    const b = h.calls.at(-1);
    h.submit('qa-c');
    const c = h.calls.at(-1);
    h.input.value = 'qa-c-typed-only';
    const cPage = classifiedPage('qa-c', { more: false, total: 8, filtered: 2 });
    const fixtures = new Map(cPage.items.map(item => [item.id, item]));
    await h.reply(c, cPage);
    const snapshot = h.snapshot();
    const writes = h.writes;
    await h.reply(b, page('qa-b'));
    await h.reply(a, page('qa-a'));
    assert.deepEqual(h.snapshot(), snapshot);
    assert.equal(h.writes, writes);
    assert.equal(h.state.search, 'qa-c');
    assert.equal(h.input.value, 'qa-c-typed-only');
    h.settled();
    return { ...comparableSnapshot(h, source, fixtures, cPage.summary), requests: comparableRequests(h, source) };
  }
  assert.deepEqual(await journey(current), await journey(before));
});

test('actual fetch/refresh helpers: intermediate 401 then 200 must not invalidate cached pages', async () => {
  const h = harness(current, { transport: true });
  await seed(h);
  const rows = h.state.rows;
  const risks = h.state.riskRows;
  const pending = h.click('more');
  const original = h.calls.at(-1);
  await h.reply(original, { message: 'QA-only intermediate denial' }, 401);
  const refresh = h.calls.at(-1);
  assert.equal(new URL(refresh.path).pathname, '/api/v1/auth/refresh');
  assert.equal(refresh.options.method, 'POST');
  assert.equal(h.state.rows, rows);
  assert.equal(h.state.riskRows, risks);
  assert.equal(h.state.loading, true);
  await h.reply(refresh, { accessToken: 'qa-only-renewed' });
  const refetch = h.calls.at(-1);
  assert.equal(refetch.path, original.path);
  assert.equal(refetch.options.method, 'GET');
  await h.reply(refetch, page('qa-second', { more: false }));
  await pending;
  assert.equal(h.state.rows.length, 4);
  assert.equal(h.state.riskRows.length, 2);
  assert.equal(h.state.error, false);
  h.settled();
});

for (const status of [401, 403]) {
  test(`actual fetch/refresh helpers: 401 -> refresh -> final ${status} clears both caches`, async () => {
    const h = harness(current, { transport: true });
    await seed(h);
    const pending = h.click('more');
    await h.reply(h.calls.at(-1), {}, 401);
    await h.reply(h.calls.at(-1), { accessToken: 'qa-only-renewed' });
    await h.reply(h.calls.at(-1), { statusCode: 500 }, status);
    await pending;
    assertEmptyDenied(h);
    h.click('retry');
    assert.equal(params(h.calls.at(-1)).get('cursor'), null);
    await h.reply(h.calls.at(-1), page('qa-recovered', { more: false }));
    h.settled();
  });
}

test('actual fetch helper gives HTTP 500 precedence over a contradictory body statusCode 403', async () => {
  const h = harness(current, { transport: true });
  await seed(h);
  const rows = h.state.rows;
  const risks = h.state.riskRows;
  const pending = h.click('more');
  await h.reply(h.calls.at(-1), { statusCode: 403 }, 500);
  await pending;
  assert.equal(h.state.rows, rows);
  assert.equal(h.state.riskRows, risks);
  assert.equal(h.state.cursor, 'qa-first-2');
  assert.equal(h.state.totalAccounts, 9);
  assert.deepEqual(h.controls(), ['usersRetry', 'usersReload']);
  h.settled();
});

test('actual fetch/refresh helpers: refetch network failure after intermediate 401 preserves cache', async () => {
  const h = harness(current, { transport: true });
  await seed(h);
  const rows = h.state.rows;
  const risks = h.state.riskRows;
  const pending = h.click('more');
  const original = h.calls.at(-1);
  await h.reply(original, {}, 401);
  await h.reply(h.calls.at(-1), { accessToken: 'qa-only-renewed' });
  await h.reject(h.calls.at(-1), new TypeError('QA-only refetch network failure'));
  await pending;
  assert.equal(h.state.rows, rows);
  assert.equal(h.state.riskRows, risks);
  assert.equal(h.state.totalAccounts, 9);
  h.click('retry');
  assert.equal(h.calls.at(-1).path, original.path);
  await h.reply(h.calls.at(-1), page('qa-second', { more: false }));
  h.settled();
});

test('actual fetch/refresh helpers: failed refresh retains original final 401 semantics', async () => {
  const h = harness(current, { transport: true });
  await seed(h);
  const pending = h.click('more');
  await h.reply(h.calls.at(-1), {}, 401);
  await h.reject(h.calls.at(-1), new TypeError('QA-only refresh network failure'));
  await pending;
  assertEmptyDenied(h);
  h.settled();
});
