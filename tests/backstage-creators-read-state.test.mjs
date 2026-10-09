import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
function extract(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert(first >= 0 && last > first, `Source anchors: ${start}`);
  assert.equal(source.indexOf(start, first + 1), -1, `Unique source anchor: ${start}`);
  return source.slice(first, last);
}
const parts = [
  extract('const BACKSTAGE_API_BASE =', 'const loginView ='),
  extract('function getBackstageAuth()', 'function getSavedSection()'),
  extract('async function backstageFetch(', 'window.LuminaBackstageApi ='),
  extract('function normalizeAuthPayload(', 'function loadGoogleSDK()'),
  extract('function publicApiPath(', 'async function verifyAdminAccess()'),
  extract('function currentAdminRoleName()', 'function syncCurrentAdminContext('),
  extract('function canAccessBackstageSection(', 'function applyPermissionVisibility()'),
  extract('function normalizePage(', 'function readSectionSearch('),
  extract('function firstValue(', 'function splitTargetUsers('),
  extract('function normalizeArtistSlugValue(', 'function slugSafePart('),
  extract('function creatorNameParts(', 'function firstRoleName('),
  extract('function backstageErrorStatus(', 'function formatHistoryTime('),
  extract('async function loadCreatorsSection()', 'async function loadAiContentSection()')
];
const options = { timeout: 2000 };
const MAIN = '/admin/api/v1/backstage/operations/creators';
const IMAGES = '/admin/api/v1/creator-image-requests';
const KNOWLEDGE = '/admin/api/v1/backstage/operations/artist-knowledge-urls';
const ME = '/admin/api/v1/me';
const REFRESH = '/api/v1/auth/refresh';
const tables = ['creatorRows', 'creatorImageRequestRows', 'artistKnowledgeUrlRows', 'aiCreatorRows'];
const plain = value => JSON.parse(JSON.stringify(value));
const page = (items = []) => ({ items, hasMore: false, nextCursor: null });
function auth(owner = 'a', permissions = ['*'], role = 'content_admin', suffix = 'original') {
  return {
    accessToken: `synthetic-access-${owner}-${suffix}`, refreshToken: `synthetic-refresh-${owner}-${suffix}`,
    user: { id: `synthetic-operator-${owner}`, adminRole: role, adminPermissions: permissions,
      adminUser: { id: `synthetic-admin-${owner}`, status: 'active', permissions, role: { name: role, permissions } } }
  };
}
function body(label = 'current', { contact = false } = {}) {
  return {
    applications: page([{ id: `synthetic-application-${label}`, userId: 'synthetic-applicant', status: 'submitted',
      realName: contact ? 'Synthetic private name' : null, applicantName: contact ? 'Synthetic private name' : null,
      stageName: `Synthetic public ${label}`, displayName: `Synthetic public ${label}`,
      contactAccessAllowed: contact, contactMasked: !contact,
      contactEmail: contact ? 'synthetic-private@example.invalid' : 's***@example.invalid',
      user: { id: 'synthetic-applicant', email: contact ? 'synthetic-login@example.invalid' : null,
        profile: { displayName: 'Synthetic profile public name' }, artists: [] } }]),
    activeCreators: [], aiArtists: [], permissions: { contactAccessAllowed: contact }
  };
}
function adminMe(owner = 'a', permissions = ['*'], role = 'content_admin') {
  return { user: { id: `synthetic-operator-${owner}` },
    admin: { id: `synthetic-admin-${owner}`, status: 'active', role, permissions } };
}
async function tick() { for (let n = 0; n < 32; n++) await Promise.resolve(); }

function harness({ permissions = ['*'], role = 'content_admin', loggedIn = true } = {}) {
  const values = new Map(loggedIn ? [['lumina_backstage_auth', JSON.stringify(auth('a', permissions, role))]] : []);
  const requests = [], writes = [], views = new Map(), detail = { tableId: 'creatorRows', marker: 'synthetic-selected-detail' };
  let hidden = false, section = 'creators', previewCalls = 0;
  const context = {
    window: {}, localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)
    },
    dashboardView: { classList: { contains: name => name === 'is-hidden' && hidden } },
    getCurrentSection: () => section,
    sectionState: { creators: { rows: [] } }, selectedDetail: detail,
    renderRows(id, rows) { const view = { kind: 'rows', rows: plain(rows) }; views.set(id, view); writes.push({ id, ...view }); },
    renderLoadingRow(id, label) { const view = { kind: label ? 'empty' : 'loading', label }; views.set(id, view); writes.push({ id, ...view }); },
    renderErrorRow(id, label) { const view = { kind: 'error', label }; views.set(id, view); writes.push({ id, ...view }); },
    backstageRows: new Proxy({}, { get() { previewCalls++; throw new Error('Preview fixture access forbidden'); } }),
    renderFallbackNote() { previewCalls++; throw new Error('Preview substitution forbidden'); },
    localizeWorkflowStatus: value => value,
    localizeCreatorImageType: value => value,
    localizeCreatorImageStatus: value => value,
    localizeModerationStatus: value => value,
    creatorImageRequester: () => 'Synthetic requester', creatorImageCostLabel: () => 'Synthetic cost',
    creatorImageRevisionLabel: () => 'Synthetic revision', countLabel: value => String(value),
    missingSummary: () => 'Synthetic missing', compactText: value => String(value ?? ''),
    localizeArtistKnowledgeStatus: value => value, localizeArtistKnowledgeType: value => value,
    formatDate: () => 'synthetic-date',
    fetch(url, requestOptions) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const request = { path: new URL(url).pathname, options: requestOptions, done: false };
      request.respond = (data, status = 200, jsonPending = null) => {
        request.done = true; resolve({ status, ok: status >= 200 && status < 300,
          json: () => jsonPending || Promise.resolve(data) });
      };
      request.fail = error => { request.done = true; reject(error); };
      requests.push(request); return promise;
    }
  };
  for (const part of parts) runInNewContext(part, context, { filename: 'backstage.js:creator-read-extraction' });
  const h = {
    context, requests, writes, views, values, detail,
    get previewCalls() { return previewCalls; },
    load: () => context.loadCreatorsSection(),
    state: () => plain(context.sectionState.creators),
    switch: next => context.setBackstageAuth(next),
    hide: value => { hidden = value; }, section: value => { section = value; },
    respondGroup(start = 0, data = body(), overrides = {}) {
      for (const request of requests.slice(start).filter(item => !item.done)) {
        if (![MAIN, IMAGES, KNOWLEDGE].includes(request.path)) continue;
        const replacement = overrides[request.path];
        if (replacement?.error) request.fail(replacement.error);
        else request.respond(replacement?.body ?? (request.path === MAIN ? data : page()), replacement?.status ?? 200);
      }
    },
    assertNoPreview() { assert.equal(previewCalls, 0); },
    async rotatedRead({ me = adminMe(), failMe = false, beforeMe } = {}) {
      const pending = h.load();
      h.respondGroup(0, body('rotated'), { [MAIN]: { status: 401, body: { message: 'Synthetic expired access' } } });
      await tick(); assert.equal(requests.at(-1).path, REFRESH);
      requests.at(-1).respond({ user: { id: 'synthetic-operator-a', status: 'active' },
        accessToken: 'synthetic-access-a-rotated', refreshToken: 'synthetic-refresh-a-rotated' });
      await tick(); assert.equal(requests.at(-1).path, MAIN);
      requests.at(-1).respond(body('rotated')); await tick();
      assert.equal(requests.at(-1).path, ME); if (beforeMe) beforeMe();
      requests.at(-1).respond(failMe ? {} : me, failMe ? 500 : 200);
      await pending;
    }
  };
  return h;
}

test('uses native auth/API/predicate and exact creator read source without source substitutions', options, () => {
  assert.match(parts[2], /async function backstageFetch/);
  assert.match(parts[3], /async function refreshBackstageAuthOnce/);
  assert.match(parts[6], /function canAccessBackstageSection/);
  assert.match(parts[12], /read.transportCurrent/);
  assert(parts[12].startsWith('async function loadCreatorsSection() {'));
  assert.doesNotMatch(parts[12], /backstageRows\.|renderFallbackNote\(/);
});

test('normal current list and auxiliary empty pages use API result state', options, async () => {
  const h = harness(), pending = h.load(); h.respondGroup(); await pending;
  assert.equal(h.state().status, 'ready'); assert.equal(h.state().loading, false);
  assert.equal(h.views.get('creatorRows').rows[0].row[1], 'Synthetic public current');
  assert.equal(h.state().imageStatus, 'ready'); assert.equal(h.state().knowledgeStatus, 'ready');
  assert.equal(h.requests.length, 3); assert(h.requests.every(request => request.options.method === 'GET'));
  assert.equal(h.context.selectedDetail, h.detail); h.assertNoPreview();
});

test('confirmed empty main response stays empty instead of unknown or preview', options, async () => {
  const h = harness(), pending = h.load();
  h.respondGroup(0, { applications: page(), activeCreators: [], aiArtists: [], permissions: { contactAccessAllowed: false } }); await pending;
  assert.equal(h.state().status, 'ready'); assert.deepEqual(h.state().rows, []);
  assert(tables.every(id => h.views.get(id).kind === 'empty')); h.assertNoPreview();
});

test('401 without refresh, 403, and 500 clear only current list state and show errors', options, async () => {
  for (const status of [401, 403, 500]) {
    const h = harness(); h.switch({ ...auth(), refreshToken: null });
    const pending = h.load(); h.respondGroup(0, body(), { [MAIN]: { status, body: { message: 'Synthetic denial' } } }); await pending;
    assert.equal(h.state().status, 'unknown'); assert.deepEqual(h.state().rows, []);
    assert(tables.every(id => h.views.get(id).kind === 'error')); assert.equal(h.context.selectedDetail, h.detail); h.assertNoPreview();
  }
});

test('null, missing arrays, malformed item, and contradictory cursor fail closed', options, async () => {
  const invalid = [null, {}, { ...body(), aiArtists: null }, { ...body(), activeCreators: null },
    { ...body(), aiArtists: [null] }, { ...body(), applications: page([null]) },
    { ...body(), applications: { items: [], hasMore: true, nextCursor: null } },
    { ...body(), applications: { items: [], hasMore: true, nextCursor: ' ' } }];
  for (const data of invalid) {
    const h = harness(), pending = h.load();
    for (const request of h.requests) request.respond(request.path === MAIN ? data : page());
    await pending; assert.equal(h.state().status, 'unknown'); assert.equal(h.views.get('creatorRows').kind, 'error'); h.assertNoPreview();
  }
});

test('image failure is unknown while valid applications remain available', options, async () => {
  const h = harness(), pending = h.load();
  h.respondGroup(0, body(), { [IMAGES]: { status: 403, body: {} } }); await pending;
  assert.equal(h.state().status, 'ready'); assert.equal(h.state().imageStatus, 'unknown');
  assert.equal(h.views.get('creatorImageRequestRows').kind, 'error'); assert.equal(h.views.get('creatorRows').kind, 'rows'); h.assertNoPreview();
});

test('knowledge failure and malformed auxiliary 200 are unknown rather than empty', options, async () => {
  for (const replacement of [{ status: 500, body: {} }, { status: 200, body: {} }]) {
    const h = harness(), pending = h.load(); h.respondGroup(0, body(), { [KNOWLEDGE]: replacement, [IMAGES]: { body: {} } }); await pending;
    assert.equal(h.state().imageStatus, 'unknown'); assert.equal(h.state().knowledgeStatus, 'unknown');
    assert.equal(h.views.get('artistKnowledgeUrlRows').kind, 'error'); assert.equal(h.views.get('creatorImageRequestRows').kind, 'error');
  }
});

test('creator-only grants do not dispatch private auxiliary requests or call them empty', options, async () => {
  const h = harness({ permissions: ['creators:read'] }), pending = h.load(); h.respondGroup(); await pending;
  assert.deepEqual(h.requests.map(request => request.path), [MAIN]);
  assert.equal(h.state().imageStatus, 'restricted'); assert.equal(h.state().knowledgeStatus, 'restricted');
  assert.equal(h.views.get('creatorImageRequestRows').kind, 'error'); assert.equal(h.views.get('artistKnowledgeUrlRows').kind, 'error');
});

test('auxiliary read/write/wildcard implications match existing server resource scopes only', options, async () => {
  for (const resource of ['assets', 'artists']) {
    for (const action of ['read', 'write', '*']) {
      const h = harness({ permissions: ['creators:read', `${resource}:${action}`] }), pending = h.load(); h.respondGroup(); await pending;
      assert.deepEqual(h.requests.map(request => request.path), [MAIN, resource === 'assets' ? IMAGES : KNOWLEDGE]);
    }
  }
});

test('existing forbidden role, anonymous session, hidden dashboard, and other section dispatch nothing', options, async () => {
  for (const kind of ['role', 'anonymous', 'hidden', 'section']) {
    const h = harness(kind === 'role' ? { permissions: [], role: 'cs_admin' } : kind === 'anonymous' ? { loggedIn: false } : {});
    if (kind === 'hidden') h.hide(true); if (kind === 'section') h.section('users');
    await h.load(); assert.equal(h.requests.length, 0); assert.equal(h.writes.length, 0);
  }
});

test('newest same-operator read wins over older success and catch', options, async () => {
  for (const failed of [false, true]) {
    const h = harness(), old = h.load(), current = h.load(); h.respondGroup(3, body('newest')); await current;
    const count = h.writes.length;
    h.respondGroup(0, body('old'), failed ? { [MAIN]: { status: 500, body: {} } } : {}); await old;
    assert.equal(h.writes.length, count); assert.equal(h.views.get('creatorRows').rows[0].row[1], 'Synthetic public newest');
  }
});

test('operator replacement discards late success and failure without touching the new view', options, async () => {
  for (const failed of [false, true]) {
    const h = harness(), old = h.load(); h.switch(auth('b')); const count = h.writes.length;
    h.respondGroup(0, body('old-owner'), failed ? { [MAIN]: { status: 500, body: {} } } : {}); await old;
    assert.equal(h.writes.length, count); assert.equal(h.context.getBackstageAuth().user.id, 'synthetic-operator-b');
  }
});

test('same-operator grants, role, and admin status changes discard old results', options, async () => {
  for (const kind of ['grants', 'role', 'status']) {
    const h = harness(), pending = h.load(), next = auth();
    if (kind === 'grants') { next.user.adminPermissions = []; next.user.adminUser.permissions = []; next.user.adminUser.role.permissions = []; }
    if (kind === 'role') { next.user.adminRole = 'artist_ops_admin'; next.user.adminUser.role.name = 'artist_ops_admin'; }
    if (kind === 'status') next.user.adminUser.status = 'suspended';
    h.switch(next); const count = h.writes.length; h.respondGroup(); await pending; assert.equal(h.writes.length, count);
  }
});

test('logout then same-user re-login still invalidates the old epoch', options, async () => {
  const h = harness(), old = h.load(); h.switch(null); h.switch(auth()); const count = h.writes.length;
  h.respondGroup(0, body('old-login')); await old; assert.equal(h.writes.length, count);
});

test('section departure and dashboard hiding discard success and catch', options, async () => {
  for (const kind of ['section', 'hidden']) {
    const h = harness(), pending = h.load(); if (kind === 'section') h.section('users'); else h.hide(true);
    const count = h.writes.length; h.respondGroup(0, body(), { [MAIN]: { status: 500, body: {} } }); await pending;
    assert.equal(h.writes.length, count);
  }
});

test('delayed JSON parse cannot apply data after the latest read changes', options, async () => {
  const h = harness(), old = h.load(); let resolveJson;
  const delayed = new Promise(resolve => { resolveJson = resolve; });
  h.requests[0].respond(null, 200, delayed); h.requests[1].respond(page()); h.requests[2].respond(page());
  await tick(); const current = h.load(); h.respondGroup(3, body('new-json')); await current;
  const count = h.writes.length; resolveJson(body('old-json')); await old; assert.equal(h.writes.length, count);
});

test('native normal-user refresh revalidates exact admin context once before applying data', options, async () => {
  const h = harness(); await h.rotatedRead();
  assert.equal(h.state().status, 'ready'); assert.equal(h.state().loading, false);
  assert.equal(h.views.get('creatorRows').rows[0].row[1], 'Synthetic public rotated');
  assert.equal(h.requests.filter(request => request.path === ME).length, 1);
  assert.equal(h.requests.filter(request => request.path === REFRESH).length, 1);
  assert.equal(h.context.getBackstageAuth().user.adminUser.status, 'active'); h.assertNoPreview();
});

test('normal token rotation retaining unchanged context and grant reordering remain current', options, async () => {
  const h = harness({ permissions: ['creators:read', 'assets:read'] }), pending = h.load();
  h.switch(auth('a', ['assets:read', 'creators:read'], 'content_admin', 'rotated')); h.respondGroup(); await pending;
  assert.equal(h.state().status, 'ready'); assert.equal(h.requests.some(request => request.path === ME), false);
});

test('failed or wrong-operator refresh readback cannot restore old grants or display rows', options, async () => {
  for (const failed of [false, true]) {
    const h = harness(); await h.rotatedRead({ me: adminMe('b'), failMe: failed });
    assert.equal(h.state().status, 'unknown'); assert.equal(h.context.getBackstageAuth().user.adminUser, undefined);
    assert.equal(h.views.get('creatorRows').kind, 'error'); h.assertNoPreview();
  }
});

test('different verified grants after refresh end as unknown/error without a cached permission rewrite', options, async () => {
  const h = harness(); await h.rotatedRead({ me: adminMe('a', ['creators:read']) });
  assert.equal(h.context.getBackstageAuth().user.adminUser, undefined);
  assert.deepEqual(plain(h.context.currentAdminPermissions()), []);
  assert.equal(h.state().status, 'unknown'); assert.equal(h.state().loading, false);
  assert.equal(h.state().imageStatus, 'unknown'); assert.equal(h.state().knowledgeStatus, 'unknown');
  assert.deepEqual(h.state().rows, []); assert.deepEqual(h.state().accessRows, []);
  assert.deepEqual(h.state().artistOptions, []); assert.deepEqual(h.state().knowledgeRows, []);
  for (const id of tables) {
    assert.equal(h.views.get(id).kind, 'error');
    assert.equal(h.views.get(id).label, '운영자 권한이 변경되었습니다. 문맥을 다시 확인해 주세요.');
  }
  h.assertNoPreview();
});

test('account replacement during refresh readback cannot apply the original context', options, async () => {
  const h = harness(); let count;
  await h.rotatedRead({ beforeMe: () => { h.switch(auth('b')); count = h.writes.length; } });
  assert.equal(h.writes.length, count); assert.equal(h.context.getBackstageAuth().user.id, 'synthetic-operator-b');
});

test('contact-denied projection stays null without real-name/login-email reconstruction', options, async () => {
  const h = harness({ permissions: ['creators:read'] }), pending = h.load(); h.respondGroup(0, body('public-only')); await pending;
  const entry = h.views.get('creatorRows').rows[0];
  assert.equal(entry.row[0], '-'); assert.equal(entry.row[3], '-'); assert.equal(entry.meta.realName, null);
  assert.equal(entry.meta.email, null); assert.equal(entry.row[4], 's***@example.invalid');
  assert.equal(entry.row[1], 'Synthetic public public-only'); assert.equal(h.context.selectedDetail, h.detail);
});

test('native contact flag must be present, boolean, and consistent with every application', options, async () => {
  for (const kind of ['missing-envelope', 'nonboolean-envelope', 'missing-item', 'inconsistent-item']) {
    const data = body();
    if (kind === 'missing-envelope') delete data.permissions;
    if (kind === 'nonboolean-envelope') data.permissions.contactAccessAllowed = 'false';
    if (kind === 'missing-item') delete data.applications.items[0].contactAccessAllowed;
    if (kind === 'inconsistent-item') data.applications.items[0].contactAccessAllowed = true;
    const h = harness(), pending = h.load(); h.respondGroup(0, data); await pending;
    assert.equal(h.state().status, 'unknown'); assert.deepEqual(h.state().rows, []);
    assert.equal(h.views.get('creatorRows').kind, 'error'); h.assertNoPreview();
  }
});

test('denied native nulls cannot be replaced by legacy private fields or email-linked access', options, async () => {
  const data = body('no-private-fallback'), item = data.applications.items[0];
  item.email = 'synthetic-legacy@example.invalid';
  item.user.email = 'synthetic-legacy@example.invalid';
  item.metadata = { realName: 'Synthetic metadata private name' };
  data.activeCreators = [{ userId: 'synthetic-other-applicant', artistId: 'synthetic-other-artist', status: 'active',
    user: { email: 'synthetic-legacy@example.invalid' }, artist: { slug: 'synthetic-other-artist' } }];
  const h = harness(), pending = h.load(); h.respondGroup(0, data); await pending;
  const entry = h.views.get('creatorRows').rows[0];
  assert.equal(entry.row[0], '-'); assert.equal(entry.row[3], '-');
  assert.equal(entry.meta.realName, null); assert.equal(entry.meta.email, null);
  assert.equal(entry.meta.artistExists, false); assert.equal(entry.meta.studioAccessStatus, 'none');
  assert.equal(entry.row[1], 'Synthetic public no-private-fallback');
});

test('existing allowed-contact row projection is unchanged; no commands are generated', options, async () => {
  const h = harness(), pending = h.load(); h.respondGroup(0, body('allowed', { contact: true })); await pending;
  const entry = h.views.get('creatorRows').rows[0];
  assert.equal(entry.row[0], 'Synthetic private name'); assert.equal(entry.row[3], 'synthetic-login@example.invalid');
  assert.equal(entry.row[4], 'synthetic-private@example.invalid'); assert(h.requests.every(request => request.options.method === 'GET'));
  assert.equal(h.context.selectedDetail, h.detail);
});

test('AI readiness rejects absent or malformed native evidence instead of showing completion', options, async () => {
  const valid = { id: 'synthetic-ai-artist', slug: 'synthetic-ai', displayName: 'Synthetic AI', status: 'active', missing: [] };
  for (const item of [{}, { ...valid, missing: undefined }, { ...valid, missing: 'public_profile' },
    { ...valid, missing: [null] }, { ...valid, missing: [''] }, { ...valid, id: '' },
    { ...valid, slug: null }, { ...valid, status: null }]) {
    const data = body(); data.aiArtists = [item];
    const h = harness(), pending = h.load(); h.respondGroup(0, data); await pending;
    assert.equal(h.state().status, 'unknown');
    assert.equal(h.views.get('aiCreatorRows').kind, 'error');
    assert.deepEqual(h.state().artistOptions, []); h.assertNoPreview();
  }
});

test('AI readiness accepts native empty omissions and preserves actual missing sections', options, async () => {
  const data = body();
  data.aiArtists = [
    { id: 'synthetic-ai-complete', slug: 'synthetic-complete', displayName: 'Synthetic Complete', status: 'active', missing: [] },
    { id: 'synthetic-ai-missing', slug: 'synthetic-missing', displayName: 'Synthetic Missing', status: 'draft', missing: ['public_profile'] },
  ];
  const h = harness(), pending = h.load(); h.respondGroup(0, data); await pending;
  assert.equal(h.state().status, 'ready');
  const rows = h.views.get('aiCreatorRows').rows;
  assert.equal(rows[0].row[3], '완료'); assert.equal(rows[0].row[4], '완료');
  assert.equal(rows[1].row[3], '누락');
  assert.equal(h.state().artistOptions.length, 2); h.assertNoPreview();
});

test('creator read entry loads the current script version exactly once', options, () => {
  const entry = readFileSync(new URL('../backstage/index.html', import.meta.url), 'utf8');
  assert.match(entry, /<script src="\/backstage\.js\?v=audit-permission-current-20261009"><\/script>/);
  assert.match(entry, /<link rel="stylesheet" href="\/backstage\.css\?v=login-width-20261009"\s*\/>/);
  assert.equal((entry.match(/<script\b[^>]*\bsrc="\/backstage\.js(?:\?|"|\/)/g) || []).length, 1);
  assert.doesNotMatch(entry, /admin-audit-rows-20261005/);
});
