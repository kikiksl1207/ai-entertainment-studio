import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const sourceUrl = new URL('../pages/character-chat.js', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const marker = '  if (document.readyState === "loading") {';
assert.equal(source.split(marker).length, 2);
const expose = `  window.__conversationOwnerTest = {
    conversationListState, basicChatState, basicChatContext, basicChatAccountKey,
    loadConversationList, bindConversationListEvents, syncBasicChatAccount,
    syncBasicChatRouteScope,
    prime(coldArtists) {
      basicChatState.accountKey = basicChatAccountKey();
      if (!coldArtists) publicDmArtists = [];
    }
  };
`;
const progressId = '12345678-1234-4123-8123-123456789abc';
const otherProgressId = 'abcdef12-1234-4123-8123-123456789abc';
const settle = async () => { for (let i = 0; i < 64; i++) await Promise.resolve(); };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const item = (label, box = 'recent') => ({ id: 'synthetic-' + label, status: box === 'archive' ? 'archived' : 'active',
  artist: { slug: 'synthetic-artist', displayName: label }, lastMessage: { bodyPreview: 'Synthetic ' + label } });
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function events() {
  const handlers = new Map();
  return {
    addEventListener(type, callback) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(callback); },
    emit(type, extra = {}) { for (const callback of handlers.get(type) || []) callback({ type, preventDefault() {}, stopPropagation() {}, ...extra }); },
    count(type) { return (handlers.get(type) || []).length; },
  };
}

function harness({ token = 'synthetic-token-a', query = '', coldArtists = false,
  reply = () => response({ items: [] }), artistReply = () => [], refresh } = {}) {
  let displayWrites = 0;
  let listWrites = 0;
  function element(observed = false) {
    const classes = new Set();
    let text = '', html = '';
    const changed = () => { if (observed) displayWrites++; if (observed === 'list') listWrites++; };
    return {
      ...events(), children: [], dataset: {}, style: { setProperty() {} }, value: '', hidden: false, disabled: false,
      classList: { add(value) { classes.add(value); }, remove(value) { classes.delete(value); },
        contains: value => classes.has(value), toggle(value, enabled) { changed(); if (enabled) classes.add(value); else classes.delete(value); } },
      setAttribute(key, value) { changed(); this[key] = String(value); },
      get textContent() { return text + this.children.map(child => child.textContent).join(''); },
      set textContent(value) { changed(); text = String(value); html = ''; this.children = []; },
      get innerHTML() { return html; },
      set innerHTML(value) { changed(); html = String(value); text = ''; this.children = []; },
      append(...children) { changed(); this.children.push(...children); },
      replaceChildren(...children) { changed(); this.children = children; text = ''; html = ''; },
      querySelector() { return null; }, querySelectorAll() { return []; },
    };
  }
  const elements = Object.fromEntries(['chatListItems', 'chatConversationStatus', 'chatInput', 'chatSendBtn',
    'chatSendStatus', 'chatCheckMessages', 'chatThread', 'chatWelcomeBubble'].map(id => [id,
    element(id === 'chatListItems' ? 'list' : id === 'chatConversationStatus')]));
  const tabs = ['recent', 'archive', 'all'].map(box => {
    const tab = element(true); tab.dataset.chatConversationBox = box; return tab;
  });
  let account = token ? { accessToken: token, user: { id: 'synthetic-user-a' } } : null;
  let locale = 'en-US';
  let refreshCalls = 0;
  const calls = [], artistCalls = [], unexpected = [], timers = new Map();
  let timerId = 0;
  const window = {
    ...events(), LUMINA_API_BASE: 'https://synthetic.invalid',
    location: { search: query, pathname: '/character-chat', hostname: 'synthetic.invalid' },
    getAccessToken: () => account?.accessToken || null, getAuth: () => account,
    localStorage: { getItem() { return null; } },
    LuminaStaticData: { characters: [], getChatTone: () => null },
    luminaI18n: { getRegionalLocale: () => locale },
  };
  if (refresh) window.refreshAuthOnce = async () => {
    refreshCalls++;
    return refresh({ rotateToken(value) { account.accessToken = value; } });
  };
  const context = {
    window, document: { ...events(), readyState: 'loading', hidden: false, body: element(),
      getElementById: id => elements[id] || null, createElement: () => element(),
      querySelectorAll: selector => selector === '[data-chat-conversation-box]' ? tabs : [] },
    URLSearchParams, AbortController, atob,
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    publicArtistsFromApi: rows => rows,
    async apiFetch(path, options) {
      artistCalls.push({ path, auth: options.auth });
      assert.equal(path, '/api/v1/artists');
      return artistReply(artistCalls.length - 1);
    },
    async fetch(url, options) {
      const parsed = new URL(url);
      const request = { path: parsed.pathname, query: parsed.search, method: options.method,
        body: options.body, authorization: options.headers.Authorization, cache: options.cache };
      calls.push(request);
      const allowed = parsed.origin === 'https://synthetic.invalid' &&
        (request.path === '/api/v1/chat/conversations' && request.method === 'GET' ||
        /^\/api\/v1\/chat\/conversations\/synthetic-[a-z-]+\/(archive|restore)$/.test(request.path) && request.method === 'POST');
      if (!allowed) { unexpected.push(request); throw new Error('Unexpected synthetic transport'); }
      return reply(request, calls.length - 1);
    },
    openAuthModal() { throw new Error('No auth prompt expected in this fixture'); },
  };
  // Execute the real module and handlers; only DOM and transport terminate in memory.
  vm.runInNewContext(source.replace(marker, () => expose + marker), context, { filename: sourceUrl.pathname, timeout: 3000 });
  const api = window.__conversationOwnerTest;
  api.prime(coldArtists);
  api.bindConversationListEvents();
  return {
    api, calls, artistCalls, tabs, elements, window,
    click(box) { tabs.find(tab => tab.dataset.chatConversationBox === box).emit('click'); },
    snapshot() { return { box: api.conversationListState.box, list: elements.chatListItems.textContent,
      html: elements.chatListItems.innerHTML, status: elements.chatConversationStatus.textContent,
      selected: tabs.map(tab => tab['aria-selected']), displayWrites, listWrites }; },
    account(id) { account = id ? { accessToken: 'synthetic-token-' + id, user: { id } } : null; api.syncBasicChatAccount(); },
    metadata() { account = { ...account, accessToken: 'synthetic-rotated-token', user: { ...account.user, displayName: 'Synthetic metadata' } }; api.syncBasicChatAccount(); },
    locale(value) { locale = value; api.syncBasicChatRouteScope(); },
    route(value) { window.location.search = value; api.syncBasicChatRouteScope(); },
    action(action) {
      const button = element(); button.dataset = { chatConversationAction: action, chatConversationId: 'synthetic-current' };
      elements.chatListItems.emit('click', { target: { closest: () => button } }); return button;
    },
    assertSafe() { assert.deepEqual(unexpected, []); assert.equal(timers.size, 0); },
    get refreshCalls() { return refreshCalls; },
  };
}

test('tab binding is once-only and invalid boxes retain the existing recent default', async () => {
  const h = harness(); h.api.bindConversationListEvents();
  assert.deepEqual(h.tabs.map(tab => tab.count('click')), [1, 1, 1]);
  await h.api.loadConversationList('invalid-box');
  assert.equal(h.calls[0].query, '?box=recent&take=20'); h.assertSafe();
});

for (const box of ['recent', 'archive', 'all']) test('current ' + box + ' tab keeps its existing GET, rows and selected state', async () => {
  const h = harness({ reply: () => response({ items: [item('current', box)] }) });
  h.click(box); await settle();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0], { path: '/api/v1/chat/conversations', query: '?box=' + box + '&take=20',
    method: 'GET', body: undefined, authorization: 'Bearer synthetic-token-a', cache: 'no-store' });
  assert.match(h.snapshot().list, /Synthetic current/);
  assert.equal(h.snapshot().selected[['recent', 'archive', 'all'].indexOf(box)], 'true'); h.assertSafe();
});

for (const outcome of ['success', '403', '500', 'network']) test('new archive tab rejects late recent ' + outcome + ' without a display commit', async () => {
  const old = deferred();
  const h = harness({ reply: (_request, index) => index === 0 ? old.promise : response({ items: [item('new-archive', 'archive')] }) });
  h.click('recent'); await settle(); h.click('archive'); await settle();
  const current = h.snapshot(); assert.match(current.list, /new-archive/);
  if (outcome === 'network') old.reject(new Error('Synthetic late network error'));
  else old.resolve(outcome === 'success' ? response({ items: [item('old-recent')] }) : response({}, Number(outcome)));
  await settle();
  assert.deepEqual(h.snapshot(), current); assert.equal(h.calls.length, 2); h.assertSafe();
});

test('claim before the artist await retires old work before any private list dispatch', async () => {
  const artists = [deferred(), deferred()];
  const h = harness({ coldArtists: true, artistReply: index => artists[index].promise,
    reply: () => response({ items: [item('new-archive', 'archive')] }) });
  h.click('recent'); h.click('archive');
  assert.equal(h.api.conversationListState.box, 'archive', 'Latest intent owns the box before first await');
  assert.equal(h.calls.length, 0);
  artists[1].resolve([]); await settle(); const current = h.snapshot();
  artists[0].resolve([]); await settle();
  assert.deepEqual(h.snapshot(), current);
  assert.deepEqual(h.calls.map(call => call.query), ['?box=archive&take=20']); h.assertSafe();
});

for (const sequence of [['archive', 'archive'], ['recent', 'archive', 'recent']]) {
  for (const failure of [false, true]) test('distinct request owner protects ' + sequence.join('-') + (failure ? ' from old error' : ' from old success'), async () => {
    const pending = sequence.map(() => deferred());
    const h = harness({ reply: (_request, index) => pending[index].promise });
    for (const box of sequence) { h.click(box); await settle(); }
    pending.at(-1).resolve(response({ items: [item('latest', sequence.at(-1))] })); await settle();
    const current = h.snapshot();
    for (const earlier of pending.slice(0, -1)) earlier.resolve(failure ? response({}, 500) : response({ items: [item('old')] }));
    await settle(); assert.deepEqual(h.snapshot(), current); assert.equal(h.calls.length, sequence.length); h.assertSafe();
  });
}

for (const failure of [false, true]) test('previous account ' + (failure ? 'error' : 'success') + ' cannot overwrite the current account list', async () => {
  const old = deferred();
  const h = harness({ reply: (_request, index) => index === 0 ? old.promise : response({ items: [item('new-account')] }) });
  h.click('recent'); await settle(); h.account('synthetic-user-b'); await settle();
  const current = h.snapshot(); assert.match(current.list, /new-account/);
  old.resolve(failure ? response({}, 500) : response({ items: [item('old-account')] })); await settle();
  assert.deepEqual(h.snapshot(), current); assert.equal(h.calls.length, 2); h.assertSafe();
});

test('changed account during artist wait prevents the old private dispatch', async () => {
  const artists = [deferred(), deferred()];
  const h = harness({ coldArtists: true, artistReply: index => artists[index].promise });
  h.click('recent'); h.account('synthetic-user-b');
  artists[1].resolve([]); await settle(); const current = h.snapshot();
  artists[0].resolve([]); await settle();
  assert.deepEqual(h.snapshot(), current); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].authorization, 'Bearer synthetic-token-synthetic-user-b'); h.assertSafe();
});

for (const next of ['', '?storyProgressId=', '?storyProgressId=' + otherProgressId]) test('changed URL ' + next + ' rejects late rows and errors without downgrading scope', async () => {
  for (const failure of [false, true]) {
    const old = deferred(); const h = harness({ query: '?storyProgressId=' + progressId, reply: () => old.promise });
    h.click('recent'); await settle(); h.route(next); const retired = h.snapshot();
    old.resolve(failure ? response({}, 500) : response({ items: [item('old-scope')] })); await settle();
    // Existing route assertions may reassert the identical latched notice, never rows or tab state.
    assert.deepEqual({ ...h.snapshot(), displayWrites: retired.displayWrites }, retired);
    h.click('archive'); await settle();
    assert.equal(h.calls.length, 1); h.assertSafe();
  }
});

test('explicit invalid boot scope never dispatches the artist catalog or private list', async () => {
  for (const query of ['?storyProgressId=', '?storyProgressId=bad', '?storyProgressId=' + progressId + '&storyProgressId=' + progressId]) {
    const h = harness({ query, coldArtists: true }); h.click('archive'); await settle();
    assert.equal(h.artistCalls.length, 0); assert.equal(h.calls.length, 0); h.assertSafe();
  }
});

test('stale supplied context cannot retire a current pending list or claim its box', async () => {
  const pending = deferred(); const h = harness({ reply: () => pending.promise });
  h.click('archive'); await settle(); const current = h.snapshot();
  const stale = { ...h.api.basicChatContext(), epoch: h.api.basicChatState.epoch - 1 };
  await h.api.loadConversationList('all', stale);
  assert.deepEqual(h.snapshot(), current); assert.equal(h.calls.length, 1);
  pending.resolve(response({ items: [item('current', 'archive')] })); await settle(); h.assertSafe();
});

test('same-account metadata, token rotation and locale changes retain a current pending response', async () => {
  const pending = deferred(); const h = harness({ reply: () => pending.promise });
  h.click('all'); await settle(); h.metadata();
  for (const locale of ['ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'zh-Hant']) h.locale(locale);
  pending.resolve(response({ items: [item('current')] })); await settle();
  assert.match(h.snapshot().list, /Synthetic current/); assert.equal(h.calls.length, 1); h.assertSafe();
});

test('existing current 401 refresh preserves one same-account GET replay and body-free contract', async () => {
  const h = harness({ reply: (_request, index) => index === 0 ? response({}, 401) : response({ items: [item('current')] }),
    refresh: ({ rotateToken }) => { rotateToken('synthetic-refreshed-token'); return true; } });
  h.click('archive'); await settle();
  assert.equal(h.refreshCalls, 1); assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls.map(call => [call.query, call.method, call.body]),
    [['?box=archive&take=20', 'GET', undefined], ['?box=archive&take=20', 'GET', undefined]]);
  assert.equal(h.calls[1].authorization, 'Bearer synthetic-refreshed-token');
  assert.match(h.snapshot().list, /Synthetic current/); h.assertSafe();
});

test('retired 401 response neither refreshes auth nor replays an old box GET', async () => {
  const old = deferred();
  const h = harness({ reply: (_request, index) => index === 0 ? old.promise : response({ items: [item('new-archive', 'archive')] }),
    refresh: () => true });
  h.click('recent'); await settle(); h.click('archive'); await settle(); const current = h.snapshot();
  old.resolve(response({}, 401)); await settle();
  assert.deepEqual(h.snapshot(), current); assert.equal(h.refreshCalls, 0); assert.equal(h.calls.length, 2); h.assertSafe();
});

test('retirement while auth refresh awaits prevents the old private GET replay', async () => {
  const refreshed = deferred();
  const h = harness({ reply: (_request, index) => index === 0 ? response({}, 401) : response({ items: [item('new-archive', 'archive')] }),
    refresh: async ({ rotateToken }) => { await refreshed.promise; rotateToken('synthetic-refreshed-token'); return true; } });
  h.click('recent'); await settle(); assert.equal(h.refreshCalls, 1);
  h.click('archive'); await settle(); const current = h.snapshot();
  refreshed.resolve(); await settle();
  assert.deepEqual(h.snapshot(), current); assert.equal(h.calls.length, 2); h.assertSafe();
});

for (const status of [403, 500]) test('current ' + status + ' retains the existing failure fallback without automatic retries', async () => {
  const h = harness({ reply: () => response({}, status) }); h.click('archive'); await settle();
  assert.equal(h.calls.length, 1); assert.ok(h.snapshot().status);
  assert.match(h.snapshot().html, /dm-list-empty/); h.assertSafe();
});

test('current empty archive is not a failure; anonymous tabs never dispatch a private request', async () => {
  const h = harness(); h.click('archive'); await settle();
  assert.equal(h.calls.length, 1); assert.match(h.snapshot().list, /보관한 대화가 아직 없어요/); h.assertSafe();
  const anonymous = harness({ token: null }); anonymous.click('archive'); await settle();
  assert.equal(anonymous.calls.length, 0); assert.equal(anonymous.snapshot().selected[1], 'true'); anonymous.assertSafe();
});

for (const action of ['archive', 'restore']) test('existing ' + action + ' action remains one POST followed by the current-box list GET', async () => {
  const h = harness({ reply: request => request.method === 'POST' ? response({ changed: true }) : response({ items: [item('current', 'archive')] }) });
  h.click('archive'); await settle(); const button = h.action(action); await settle();
  assert.equal(button.disabled, true);
  assert.deepEqual(h.calls.map(call => [call.path, call.query, call.method, call.body]), [
    ['/api/v1/chat/conversations', '?box=archive&take=20', 'GET', undefined],
    ['/api/v1/chat/conversations/synthetic-current/' + action, '', 'POST', undefined],
    ['/api/v1/chat/conversations', '?box=archive&take=20', 'GET', undefined],
  ]);
  assert.equal(h.api.conversationListState.busyId, null); assert.match(h.snapshot().list, /Synthetic current/); h.assertSafe();
});
