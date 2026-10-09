import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const sourceUrl = new URL('../pages/character-chat.js', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const browserTest = readFileSync(new URL('./character-chat-send.browser.test.mjs', import.meta.url), 'utf8');
const marker = '  if (document.readyState === "loading") {';
assert.equal(source.split(marker).length, 2);
const expose = `  window.__routeScopeTest = {
    init, basicChatState, basicChatContext, basicChatStoryRouteScope, basicChatStoryProgressId,
    assertBasicChatContext, isBasicChatContextCurrent, isConversationListContextCurrent,
    basicChatRequest, loadBasicChatRoom, readBasicMessages, checkBasicChatMessages,
    fetchStarterPrompts, fetchCharacterCatalog, loadDmArtistList, loadConversationList,
    fetchPremiumJson, loadPremiumRoomDetailState, hydrateChatCms
  };
`;
const progressId = '12345678-1234-4123-8123-123456789abc';
const otherProgressId = 'abcdef12-1234-4123-8123-123456789abc';
const artistId = 'synthetic-artist';
const sessionId = 'synthetic-session';
const draft = 'Keep this synthetic route draft';
const owned = [{ id: sessionId, artistId, status: 'active', chatPersonaId: null }];
const history = [{ id: 'earlier', senderType: 'artist', body: 'Synthetic earlier conversation' }];
const reply = {
  generationStatus: 'completed',
  userMessage: { id: 'new-user', senderType: 'user', body: draft },
  message: { id: 'new-artist', senderType: 'artist', body: 'Synthetic reply' },
};
const unknownOutcomeLocales = [
  ['ko-KR', /이전 요청은 이미 시작/, /같은 메시지를 다시 보내지 마세요/],
  ['en-US', /earlier request already started/, /Do not resend the same message/],
  ['ja-JP', /以前のリクエストはすでに開始/, /同じメッセージを再送しないでください/],
  ['zh-CN', /之前的请求已开始/, /请勿重复发送同一条消息/],
  ['zh-Hant', /先前的請求已開始/, /請勿重複傳送同一則訊息/],
];
async function assertUnknownOutcomeCopy(h) {
  for (const [locale, alreadyStarted, noResend] of unknownOutcomeLocales) {
    await h.locale(locale);
    assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'routeRequestUnknown');
    assert.match(h.elements.chatSendStatus.textContent, alreadyStarted);
    assert.match(h.elements.chatSendStatus.textContent, noResend);
    assert.doesNotMatch(h.elements.chatSendStatus.textContent, /전송하지 않았|Nothing was sent|送信していません|未发送消息|未傳送訊息/);
    assert.equal(h.elements.chatSendBtn.disabled, true);
    assert.equal(h.elements.chatCheckMessages.hidden, true);
    assert.equal(h.elements.chatInput.value, draft);
  }
}
const tick = async () => { for (let i = 0; i < 64; i++) await Promise.resolve(); };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function events() {
  const handlers = new Map();
  return {
    addEventListener(type, callback) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(callback); },
    async emit(type, extra = {}) { for (const callback of handlers.get(type) || []) await callback({ type, preventDefault() {}, ...extra }); },
  };
}

async function harness({ query = '', boot = true, list = false, sessions = owned, intercept, interceptApi, token = 'synthetic-token-a', initialDraft = draft } = {}) {
  function element() {
    const classes = new Set();
    return {
      ...events(), children: [], value: '', text: '', style: { setProperty() {} }, dataset: {}, hidden: false, disabled: false,
      scrollHeight: 60, scrollTop: 0,
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value),
        toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); } },
      setAttribute(key, value) { this[key] = String(value); },
      get textContent() { return this.text + this.children.map(child => child.textContent).join(''); },
      set textContent(value) { this.text = String(value); this.children = []; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; this.text = ''; },
      querySelector() { return null; }, querySelectorAll() { return []; },
    };
  }
  const elements = Object.fromEntries([
    'chatInput', 'chatSendBtn', 'chatInputForm', 'chatSendStatus', 'chatCheckMessages',
    'chatThread', 'chatWelcomeBubble', 'chatWelcomeText', 'chatWelcomeTime', 'chatStage', 'chatBasicNote',
    'chatListItems', 'chatConversationStatus', 'chatListShell', 'chatRoomShell',
  ].map(id => [id, element()]));
  elements.chatInput.value = initialDraft;
  elements.chatCheckMessages.hidden = true;
  let account = token ? { accessToken: token, user: { id: 'synthetic-user-a' } } : null;
  let locale = 'en-US';
  const requests = [], timers = new Map();
  let timerId = 0;
  const window = {
    ...events(), LUMINA_API_BASE: 'https://synthetic.invalid',
    location: { search: (list ? '?' : '?slug=synthetic-artist&') + query, pathname: '/character-chat', hostname: 'synthetic.invalid' },
    getAccessToken: () => account?.accessToken || null, getAuth: () => account,
    luminaI18n: { getRegionalLocale: () => locale },
    LuminaStaticData: { characters: [], getChatTone: () => null },
    LuminaCms: { hydrate() { requests.push({ transport: 'cms', path: 'synthetic-cms' }); return Promise.resolve(); } },
    localStorage: { getItem() { return null; } },
  };
  window.dispatchEvent = event => window.emit(event.type, event);
  async function fetch(url, options = {}) {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://synthetic.invalid', 'All requests terminate at the synthetic spy');
    const request = { transport: 'fetch', path: parsed.pathname, query: parsed.search, method: options.method || 'GET',
      body: options.body ? JSON.parse(options.body) : undefined, signal: options.signal, headers: options.headers };
    requests.push(request);
    const intercepted = intercept?.(request);
    if (intercepted !== undefined) return intercepted;
    if (request.path === '/api/v1/artists') return response([{ id: artistId, slug: 'synthetic-artist', status: 'active' }]);
    if (request.path === '/api/v1/chat/sessions' && request.method === 'GET') return response(sessions);
    if (request.path === '/api/v1/chat/sessions' && request.method === 'POST') return response({ id: sessionId, artistId, status: 'active' });
    if (request.path.endsWith('/messages')) return response(history);
    if (request.path.endsWith('/generate')) return response(reply);
    if (request.path === '/api/v1/chat/premium-support-contract') return response({ policy: { walletMutationEnabled: false } });
    if (request.path === '/api/v1/chat/conversations') return response({ items: [] });
    if (['/api/v1/chat/character-catalog', '/api/v1/chat/starter-prompts'].includes(request.path)) return response(null);
    throw new Error('Unexpected synthetic request: ' + request.path);
  }
  const context = {
    window, document: { ...events(), readyState: 'loading', hidden: false, body: element(),
      documentElement: element(), getElementById: id => elements[id] || null,
      createElement: element, querySelectorAll: () => [], querySelector: () => null },
    URLSearchParams, AbortController, atob, fetch,
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    publicArtistsFromApi: rows => rows,
    async apiFetch(path, options = {}) {
      const request = { transport: 'api', path, method: options.method || 'GET' };
      requests.push(request);
      return interceptApi ? interceptApi(request) : path === '/api/v1/artists' ? [] : null;
    },
    openAuthModal() { throw new Error('Invalid scope must not open auth or downgrade into general chat'); },
  };
  // Run the real module in a synthetic VM, exposing closures without replacing product functions.
  vm.runInNewContext(source.replace(marker, () => expose + marker), context, { filename: sourceUrl.pathname, timeout: 3000 });
  const api = window.__routeScopeTest;
  if (boot) { await api.init(); await tick(); }
  return {
    api, window, elements, requests,
    submit: () => elements.chatInputForm.emit('submit'),
    check: () => api.checkBasicChatMessages(),
    async route(query, event = 'popstate') { window.location.search = '?slug=synthetic-artist&' + query; if (event) await window.emit(event); await tick(); },
    async locale(value) { locale = value; await window.emit('lumina:localechange'); await tick(); },
    async account(id = 'synthetic-user-a') { account = { accessToken: 'synthetic-rotated-' + id, user: { id } }; await window.emit('lumina:authchange'); await tick(); },
  };
}

const invalidQueries = [
  ['empty', 'storyProgressId='],
  ['malformed', 'storyProgressId=not-a-uuid'],
  ['identical duplicate', `storyProgressId=${progressId}&storyProgressId=${progressId}`],
  ['conflicting duplicate', `storyProgressId=${progressId}&storyProgressId=${otherProgressId}`],
];

test('absent scope remains general; one exact UUID-v4 is preserved, including case', async () => {
  const h = await harness({ boot: false });
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.basicChatStoryRouteScope(''))), { kind: 'general', storyProgressId: null });
  for (const id of [progressId, progressId.toUpperCase()]) {
    assert.deepEqual(JSON.parse(JSON.stringify(h.api.basicChatStoryRouteScope('?storyProgressId=' + id))), { kind: 'story', storyProgressId: id });
  }
});

test('parser rejects all explicit invalid inputs and both duplicate orders, without first-value selection', async () => {
  const h = await harness({ boot: false });
  for (const query of [
    ...invalidQueries.map(([, query]) => query),
    `storyProgressId=${progressId}&storyProgressId=bad`, `storyProgressId=bad&storyProgressId=${progressId}`,
    `storyProgressId=%20${progressId}`, `storyProgressId=${progressId}%20`,
    `storyProgressId=${progressId.replace('-4123-', '-3123-')}`, `storyProgressId=${progressId.replace('-8123-', '-7123-')}`,
    'storyProgressId=%3Cscript%3E', 'storyProgressId',
  ]) assert.equal(h.api.basicChatStoryRouteScope('?' + query).kind, 'invalid', query);
});

for (const [label, query] of invalidQueries) test('explicit ' + label + ' scope blocks boot/load/send/check and every request adapter', async () => {
  for (const list of [false, true]) {
    const h = await harness({ query, list });
    assert.equal(h.requests.length, 0, 'No artist/session/message/premium/starter/catalog/CMS requests on boot');
    assert.equal(h.elements.chatInput.value, draft, 'Invalid boot must preserve a pre-existing draft');
    const captured = h.api.basicChatContext();
    for (const call of [
      () => h.api.basicChatRequest('/api/v1/artists', { auth: false }, 0, captured),
      () => h.api.basicChatRequest('/api/v1/chat/sessions', { method: 'POST', body: { artistId } }, 0, captured),
      () => h.api.basicChatRequest('/api/v1/chat/sessions/' + sessionId + '/generate', { method: 'POST', body: { body: draft } }, 0, captured),
      () => h.api.loadBasicChatRoom('synthetic-artist', captured),
      () => h.api.readBasicMessages(captured),
      () => h.api.fetchPremiumJson('/api/v1/chat/premium-support-contract', captured),
    ]) await assert.rejects(call, error => error.chatRouteInvalid === true);
    await h.api.loadDmArtistList(captured);
    await h.api.loadConversationList('recent', captured);
    await h.api.loadPremiumRoomDetailState('synthetic-artist', captured);
    await h.api.fetchCharacterCatalog('synthetic-artist', captured);
    await h.api.fetchStarterPrompts('synthetic-artist', captured);
    h.api.hydrateChatCms('synthetic-artist');
    h.api.basicChatState.uncertain = true;
    await h.check();
    if (!list) await h.submit();
    assert.equal(h.requests.length, 0);
    assert.equal(h.elements.chatInput.value, draft);
    assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'routeInvalid');
    assert.equal(h.elements.chatSendBtn.disabled, true);
  }
});

test('invalid scope stays latched across URL removal, token metadata updates and all five locales', async () => {
  const h = await harness({ query: 'storyProgressId=bad' });
  await h.route('');
  await h.account();
  const copies = new Set();
  for (const locale of ['ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'zh-Hant']) {
    await h.locale(locale);
    copies.add(h.elements.chatSendStatus.textContent);
    assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'routeInvalid');
    assert.equal(h.elements.chatSendBtn.disabled, true);
    await h.submit(); await h.check();
  }
  assert.equal(copies.size, 5);
  assert.equal(h.elements.chatInput.value, draft);
  await h.account('synthetic-user-b');
  assert.equal(h.elements.chatInput.value, '', 'Real account changes retain the existing private-draft cleanup policy');
  assert.equal(h.requests.length, 0);
  assert.equal(h.api.basicChatState.routeScopeError, 'routeInvalid');
});

test('list-mode invalid-route notice also follows locale without starting requests', async () => {
  const h = await harness({ query: 'storyProgressId=', list: true });
  const original = h.elements.chatConversationStatus.textContent;
  await h.locale('ja-JP');
  assert.notEqual(h.elements.chatConversationStatus.textContent, original);
  assert.equal(h.requests.length, 0);
});

test('logged-out invalid scope is blocked before auth prompts or any request', async () => {
  for (const [, query] of invalidQueries) {
    const h = await harness({ query, token: null });
    await h.submit(); await h.check();
    assert.equal(h.requests.length, 0);
    assert.equal(h.elements.chatInput.value, draft);
    assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'routeInvalid');
  }
});

test('general chat preserves lazy session creation, unscoped message reads and exact generation body', async () => {
  const h = await harness({ sessions: [] });
  assert.equal(h.requests.filter(request => request.method === 'POST').length, 0);
  h.elements.chatInput.value = draft;
  await h.submit();
  const posts = h.requests.filter(request => request.method === 'POST');
  assert.deepEqual(posts.map(request => request.path), ['/api/v1/chat/sessions', '/api/v1/chat/sessions/' + sessionId + '/generate']);
  assert.deepEqual(posts.map(request => request.body), [{ artistId }, { body: draft }]);
  assert(h.requests.some(request => request.path.endsWith('/messages') && request.query === ''));
  assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'sent');
});

for (const id of [progressId, progressId.toUpperCase()]) test('one exact scope is retained for reads and generation: ' + id, async () => {
  const h = await harness({ query: 'storyProgressId=' + id });
  h.elements.chatInput.value = draft;
  await h.submit();
  const reads = h.requests.filter(request => request.path.endsWith('/messages'));
  assert(reads.length > 0);
  for (const request of reads) assert.equal(request.query, '?storyProgressId=' + id);
  assert.deepEqual(h.requests.find(request => request.path.endsWith('/generate')).body, { body: draft, storyProgressId: id });
  assert.equal(h.elements.chatInput.value, '');
});

for (const next of ['', 'storyProgressId=bad', 'storyProgressId=' + otherProgressId]) test('changed URL cannot silently select another scope or general chat: ' + next, async () => {
  const h = await harness({ query: 'storyProgressId=' + progressId });
  h.elements.chatInput.value = draft;
  const captured = h.api.basicChatContext(), before = h.requests.length;
  await h.route(next, null);
  await h.submit(); await h.check();
  await assert.rejects(() => h.api.basicChatRequest('/api/v1/chat/sessions', {}, 0, captured), error => error.chatRouteInvalid === true);
  await h.route('storyProgressId=' + progressId);
  await h.account(); await h.locale('en-US'); await h.submit();
  assert.equal(h.requests.length, before);
  assert.equal(h.elements.chatInput.value, draft);
  assert.equal(h.elements.chatThread.children.length, 0);
  assert.equal(h.elements.chatSendBtn.disabled, true);
});

for (const boundary of ['artists', 'sessions', 'messages']) test('scope invalidation while awaiting ' + boundary + ' prevents all following request stages', async () => {
  const gate = deferred();
  const h = await harness({ boot: false, query: 'storyProgressId=' + progressId,
    intercept: request => request.path.endsWith('/' + boundary) ? gate.promise : undefined });
  h.api.basicChatState.accountKey = 'user:synthetic-user-a';
  const pending = h.api.loadBasicChatRoom('synthetic-artist').then(() => null, error => error);
  await tick();
  const before = h.requests.length;
  await h.route('storyProgressId=bad', null);
  gate.resolve(response(boundary === 'artists' ? [{ id: artistId, slug: 'synthetic-artist', status: 'active' }] : boundary === 'sessions' ? owned : history));
  const error = await pending;
  assert.equal(error.chatRouteInvalid, true);
  assert.equal(h.requests.length, before);
  assert.equal(h.elements.chatInput.value, draft);
  assert.equal(h.elements.chatThread.children.length, 0);
  assert.equal(h.requests.find(request => request.path.endsWith('/' + boundary))?.signal.aborted, true);
});

test('invalid URL before boot blocks even when the captured original scope was valid', async () => {
  const h = await harness({ boot: false, query: 'storyProgressId=' + progressId });
  await h.route('storyProgressId=bad', null);
  await h.api.init(); await tick();
  assert.equal(h.requests.length, 0);
  assert.equal(h.elements.chatInput.value, draft);
  assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'routeInvalid');
});

test('scope invalidation after synthetic session creation starts prevents message reads and generation', async () => {
  const gate = deferred();
  const h = await harness({ query: 'storyProgressId=' + progressId, sessions: [],
    intercept: request => request.path === '/api/v1/chat/sessions' && request.method === 'POST' ? gate.promise : undefined });
  h.elements.chatInput.value = draft;
  const pending = h.submit(); await tick();
  assert.equal(h.requests.filter(request => request.method === 'POST').length, 1);
  const before = h.requests.length;
  await h.route('storyProgressId=');
  await assertUnknownOutcomeCopy(h);
  gate.resolve(response({ id: sessionId, artistId, status: 'active' }));
  await pending;
  assert.equal(h.requests.length, before);
  assert.equal(h.elements.chatInput.value, draft);
  assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'routeRequestUnknown');
});

test('invalid scope during send-time message reading stops before synthetic generation', async () => {
  const gate = deferred();
  let reads = 0;
  const h = await harness({ query: 'storyProgressId=' + progressId,
    intercept: request => request.path.endsWith('/messages') && ++reads === 2 ? gate.promise : undefined });
  h.elements.chatInput.value = draft;
  const pending = h.submit(); await tick();
  assert.equal(reads, 2);
  await h.route('storyProgressId=bad', null);
  const before = h.requests.length;
  gate.resolve(response(history)); await pending;
  assert.equal(h.requests.length, before);
  assert.equal(h.requests.filter(request => request.path.endsWith('/generate')).length, 0);
  assert.equal(h.elements.chatInput.value, draft);
});

test('scope assertions after JSON reading and token refresh prevent acceptance or request replay', async () => {
  for (const phase of ['json', 'refresh']) {
    const gate = deferred();
    const h = await harness({ boot: false, query: 'storyProgressId=' + progressId, intercept: () => phase === 'json'
      ? { ok: true, status: 200, json: () => gate.promise } : response({}, 401) });
    h.api.basicChatState.accountKey = 'user:synthetic-user-a';
    h.window.refreshAuthOnce = () => gate.promise;
    const pending = h.api.basicChatRequest('/api/v1/chat/sessions').then(() => null, error => error);
    await tick();
    await h.route('', null);
    gate.resolve(phase === 'json' ? owned : true);
    const error = await pending;
    assert.equal(error.chatRouteInvalid, true);
    assert.equal(h.requests.length, 1, phase);
    assert.equal(h.elements.chatInput.value, draft);
  }
});

for (const method of ['fetchCharacterCatalog', 'fetchStarterPrompts']) test('late ' + method + ' response latches invalid URL without applying fallback or requesting again', async () => {
  const gate = deferred();
  const h = await harness({ boot: false, query: 'storyProgressId=' + progressId, intercept: () => gate.promise });
  h.api.basicChatState.accountKey = 'user:synthetic-user-a';
  const pending = h.api[method]('synthetic-artist'); await tick();
  await h.route('storyProgressId=bad', null);
  gate.resolve(response(null)); await pending;
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].transport, 'fetch', 'Authenticated GET must use the guarded product request adapter');
  assert.equal(h.api.basicChatState.routeScopeError, 'routeInvalid');
  assert.equal(h.elements.chatInput.value, draft);
});

test('late synthetic generation cannot render, clear a draft or reenable a retired invalid route', async () => {
  const gate = deferred();
  const h = await harness({ query: 'storyProgressId=' + progressId,
    intercept: request => request.path.endsWith('/generate') ? gate.promise : undefined });
  h.elements.chatInput.value = draft;
  const pending = h.submit(); await tick();
  assert.equal(h.requests.filter(request => request.path.endsWith('/generate')).length, 1);
  const before = h.requests.length;
  await h.route('storyProgressId=bad');
  await assertUnknownOutcomeCopy(h);
  gate.resolve(response(reply)); await pending;
  await h.route(''); await h.account(); await h.locale('ja-JP'); await h.submit(); await h.check();
  assert.equal(h.requests.length, before);
  assert.equal(h.elements.chatThread.children.length, 0);
  assert.equal(h.elements.chatInput.value, draft);
  assert.equal(h.elements.chatSendBtn.disabled, true);
  assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'routeRequestUnknown');
});

test('guarded init/read/create/send 401 after an invalid URL starts neither refresh nor replay', async () => {
  for (const [path, options] of [
    ['/api/v1/artists', { auth: false }],
    ['/api/v1/chat/sessions', {}],
    ['/api/v1/chat/sessions/' + sessionId + '/messages?storyProgressId=' + progressId, {}],
    ['/api/v1/chat/sessions', { method: 'POST', body: { artistId } }],
    ['/api/v1/chat/sessions/' + sessionId + '/generate', { method: 'POST', body: { body: draft, storyProgressId: progressId } }],
  ]) {
    const gate = deferred();
    const h = await harness({ boot: false, query: 'storyProgressId=' + progressId, intercept: () => gate.promise });
    h.api.basicChatState.accountKey = 'user:synthetic-user-a';
    let refreshes = 0;
    h.window.refreshAuthOnce = async () => { refreshes++; return true; };
    const pending = h.api.basicChatRequest(path, options).then(() => null, error => error);
    await tick(); assert.equal(h.requests.length, 1);
    await h.route('storyProgressId=bad', null);
    gate.resolve(response({}, 401));
    assert.equal((await pending).chatRouteInvalid, true, path);
    assert.equal(refreshes, 0, path);
    assert.equal(h.requests.length, 1, 'Only the already-started synthetic request exists');
    assert.equal(h.elements.chatInput.value, draft);
    assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'routeRequestUnknown');
  }
});

test('guarded 401 replay preserves captured scope and exact method/body after same-account token rotation', async () => {
  for (const storyProgressId of [null, progressId.toUpperCase()]) {
    let attempts = 0, refreshes = 0;
    const h = await harness({ boot: false, query: storyProgressId ? 'storyProgressId=' + storyProgressId : '',
      intercept: () => ++attempts === 1 ? response({}, 401) : response(reply) });
    h.api.basicChatState.accountKey = 'user:synthetic-user-a';
    const context = h.api.basicChatContext();
    h.window.refreshAuthOnce = async () => { refreshes++; await h.account(); return true; };
    const body = { body: draft, ...(storyProgressId ? { storyProgressId } : {}) };
    const result = await h.api.basicChatRequest('/api/v1/chat/sessions/' + sessionId + '/generate', { method: 'POST', body }, 0, context);
    assert.deepEqual(result, reply);
    assert.equal(refreshes, 1);
    assert.equal(h.requests.length, 2);
    for (const request of h.requests) {
      assert.equal(request.method, 'POST'); assert.deepEqual(request.body, body);
      assert.equal(request.path, '/api/v1/chat/sessions/' + sessionId + '/generate');
    }
    assert.notEqual(h.requests[0].headers.Authorization, h.requests[1].headers.Authorization);
    assert.equal(h.api.isBasicChatContextCurrent(context), true);
    assert.equal(h.elements.chatInput.value, draft);
  }
});

test('existing server route and memory conflicts keep their separate UI contracts', async () => {
  for (const code of ['STORY_CHAT_ROUTE_CHANGED', 'STORY_CHAT_MEMORY_CHANGED']) {
    const h = await harness({ query: 'storyProgressId=' + progressId,
      intercept: request => request.path.endsWith('/generate') ? response({ code }, 409) : undefined });
    h.elements.chatInput.value = draft;
    const captured = h.api.basicChatContext();
    await h.submit();
    assert.equal(h.elements.chatInput.value, draft);
    assert.equal(h.api.basicChatState.routeScopeError, null, 'Server conflicts do not rewrite explicit URL intent');
    assert.equal(h.api.isConversationListContextCurrent(captured), true);
    assert.equal(h.elements.chatSendStatus.dataset.copyKey, code === 'STORY_CHAT_ROUTE_CHANGED' ? 'routeChanged' : 'memoryChanged');
    assert.equal(h.elements.chatSendBtn.disabled, code === 'STORY_CHAT_ROUTE_CHANGED');
  }
});

const outcomeLocaleCopy = [
  ['ko-KR', /대체 안내/, /생성 상태는 확인할 수 없어요/, /메시지 내역에서 전송을 확인/],
  ['en-US', /A fallback reply is shown/, /generation status is unverified/, /message was found in history/],
  ['ja-JP', /代替の案内/, /生成状態を確認できません/, /履歴でメッセージを確認/],
  ['zh-CN', /备用提示/, /无法确认其生成状态/, /消息记录中找到/],
  ['zh-Hant', /替代提示/, /無法確認其生成狀態/, /訊息紀錄中找到/],
];

function assertAcceptedOutcome(h, key, state = '') {
  assert.equal(h.elements.chatSendStatus.dataset.copyKey, key);
  assert.equal(h.elements.chatSendStatus.dataset.state, state);
  assert.equal(h.api.basicChatState.busy, false);
  assert.equal(h.api.basicChatState.uncertain, false);
  assert.equal(h.elements.chatInput.value, '');
  assert.equal(h.elements.chatSendBtn.disabled, true, 'The acknowledged draft is empty, not an implicit retry');
  assert.equal(h.elements.chatCheckMessages.hidden, true);
  assert.equal(h.elements.chatThread.children.length, history.length + 2);
  assert(h.elements.chatThread.textContent.includes(reply.message.body));
  assert.equal(h.requests.filter(request => request.path.endsWith('/generate')).length, 1);
  assert.equal(h.requests.at(-1).path.endsWith('/generate'), true, 'Settlement cannot start an implicit GET or retry');
}

test('generation status: explicit completed retains normal success and exact scope/body, including an alternate model', async () => {
  for (const storyProgressId of [null, progressId.toUpperCase()]) {
    for (const httpStatus of [200, 201]) {
      const result = { ...reply, usage: { model: 'synthetic-secondary-model' },
        safetyMetadata: { generationStatus: 'completed', fallbackModelUsed: true } };
      const h = await harness({ query: storyProgressId ? 'storyProgressId=' + storyProgressId : '',
        intercept: request => request.path.endsWith('/generate') ? response(result, httpStatus) : undefined });
      h.elements.chatInput.value = draft;
      await h.submit(); await tick();
      assertAcceptedOutcome(h, 'sent', 'success');
      assert.deepEqual(h.requests.at(-1).body, { body: draft, ...(storyProgressId ? { storyProgressId } : {}) });
    }
  }
});

for (const [generationStatus, key, patternIndex] of [['fallback', 'fallbackReply', 1], [undefined, 'replyUnverified', 2]]) {
  for (const entry of outcomeLocaleCopy) test('generation status: ' + key + ' is neutral without implicit requests in ' + entry[0], async () => {
    for (const httpStatus of [200, 201]) {
      const { generationStatus: _completed, ...pair } = reply;
      const result = generationStatus === undefined ? pair : { ...pair, generationStatus };
      const h = await harness({ query: 'storyProgressId=' + progressId,
        intercept: request => request.path.endsWith('/generate') ? response(result, httpStatus) : undefined });
      await h.locale(entry[0]);
      h.elements.chatInput.value = draft;
      await h.submit(); await tick();
      assertAcceptedOutcome(h, key);
      assert.match(h.elements.chatSendStatus.textContent, entry[patternIndex]);
      assert.doesNotMatch(h.elements.chatSendStatus.textContent, /무료|환불|비용이 없|free|refund|zero.?cost|no charge|無料|返金|免费|退款|免費/);
      const settledCount = h.requests.length;
      await h.submit(); await h.check(); await h.account();
      assert.equal(h.requests.length, settledCount, 'Same-account metadata does not erase the outcome or start a request');
      assert.equal(h.elements.chatSendStatus.dataset.copyKey, key);
      h.elements.chatInput.value = 'A genuinely new synthetic draft';
      await h.elements.chatInput.emit('input');
      for (const localeEntry of outcomeLocaleCopy) {
        await h.locale(localeEntry[0]);
        assert.equal(h.elements.chatSendStatus.dataset.copyKey, key);
        assert.equal(h.elements.chatSendStatus.dataset.state, '');
        assert.match(h.elements.chatSendStatus.textContent, localeEntry[patternIndex]);
        assert.equal(h.elements.chatInput.value, 'A genuinely new synthetic draft');
      }
      assert.equal(h.elements.chatSendBtn.disabled, false, 'Existing controls still permit a deliberate new message');
      assert.equal(h.requests.length, settledCount);
    }
  });
}

test('generation status: dedicated absent/malformed/unknown values are not promoted by nested metadata or HTTP success', async () => {
  for (const candidate of [
    { label: 'absent' },
    ...[undefined, null, '', 'ready', 'failed', 'COMPLETED', 'completed ', 'fallback ', true, false, 0, 1, [], {},
      { generationStatus: 'completed' }].map(value => ({ label: JSON.stringify(value) || 'undefined', value, present: true })),
  ]) {
    for (const httpStatus of [200, 201]) {
      const { generationStatus: _completed, ...pair } = reply;
      const result = { ...pair, usage: { model: 'fallback', estimatedCostKrw: '0.00' }, requestId: 'synthetic-only-request',
        message: { ...pair.message, safetyMetadata: { generationStatus: 'completed' } },
        ...(candidate.present ? { generationStatus: candidate.value } : {}) };
      const h = await harness({ intercept: request => request.path.endsWith('/generate') ? response(result, httpStatus) : undefined });
      h.elements.chatInput.value = draft;
      await h.submit(); await tick();
      assertAcceptedOutcome(h, 'replyUnverified');
      assert.match(h.elements.chatSendStatus.textContent, /generation status is unverified/, candidate.label);
      assert.doesNotMatch(h.elements.chatSendStatus.textContent, /Message sent|fallback reply is shown|free|refund|zero.?cost/);
    }
  }
});

for (const [locale, _fallbackPattern, _unknownPattern, receiptPattern] of outcomeLocaleCopy) test('history receipt: a user-only match is neutral and never proves generation in ' + locale, async () => {
  let historyPhase = 'original';
  const h = await harness({ query: 'storyProgressId=' + progressId, intercept: request => {
    if (request.path.endsWith('/generate')) throw new Error('Synthetic transport result unknown');
    if (request.path.endsWith('/messages')) return response(historyPhase === 'original' ? history : [
      ...history, historyPhase === 'artist'
        ? { id: 'synthetic-artist-only', senderType: 'artist', body: draft }
        : { id: 'synthetic-user-receipt', senderType: 'user', body: draft },
    ]);
    return undefined;
  } });
  await h.locale(locale);
  h.elements.chatInput.value = draft;
  await h.submit(); await tick();
  assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'uncertain');
  assert.equal(h.elements.chatInput.value, draft);
  assert.equal(h.elements.chatSendBtn.disabled, true);
  const uncertainCount = h.requests.length;
  await h.submit(); await tick();
  assert.equal(h.requests.length, uncertainCount, 'Uncertain delivery blocks duplicate POST');
  historyPhase = 'artist';
  await h.check();
  assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'stillUncertain', 'An artist message does not prove a user receipt');
  assert.equal(h.elements.chatInput.value, draft);
  historyPhase = 'user';
  const beforeCheck = h.requests.length;
  await h.check(); await tick();
  assert.equal(h.requests.length, beforeCheck + 1, 'Only the explicitly requested synthetic history GET');
  assert.equal(h.requests.at(-1).method, 'GET');
  assert.equal(h.requests.at(-1).query, '?storyProgressId=' + progressId);
  assert.equal(h.requests.filter(request => request.path.endsWith('/generate')).length, 1);
  assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'receiptConfirmed');
  assert.equal(h.elements.chatSendStatus.dataset.state, '');
  assert.match(h.elements.chatSendStatus.textContent, receiptPattern);
  assert.equal(h.elements.chatInput.value, '');
  assert.equal(h.api.basicChatState.uncertain, false);
  assert.equal(h.elements.chatCheckMessages.hidden, true);
  const confirmedCount = h.requests.length;
  for (const entry of outcomeLocaleCopy) {
    await h.locale(entry[0]);
    assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'receiptConfirmed');
    assert.equal(h.elements.chatSendStatus.dataset.state, '');
    assert.match(h.elements.chatSendStatus.textContent, entry[3]);
  }
  assert.equal(h.requests.length, confirmedCount);
});

test('generation status: missing/invalid pairs cannot bypass the existing uncertain flow using a status label', async () => {
  for (const result of [
    { generationStatus: 'completed' },
    { generationStatus: 'fallback', userMessage: null, message: reply.message },
    { ...reply, generationStatus: 'fallback', message: { ...reply.message, body: {} } },
    { ...reply, generationStatus: 'completed', message: { ...reply.message, senderType: 'system' } },
  ]) {
    const h = await harness({ intercept: request => request.path.endsWith('/generate') ? response(result) : undefined });
    h.elements.chatInput.value = draft;
    await h.submit(); await tick();
    assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'uncertain');
    assert.equal(h.elements.chatSendStatus.dataset.state, 'error');
    assert.equal(h.elements.chatInput.value, draft);
    assert.equal(h.elements.chatSendBtn.disabled, true);
    assert.equal(h.elements.chatCheckMessages.hidden, false);
    const beforeRetry = h.requests.length;
    await h.submit(); await tick();
    assert.equal(h.requests.length, beforeRetry);
    assert.equal(h.requests.filter(request => request.path.endsWith('/generate')).length, 1);
  }
});

test('generation status: non-success HTTP responses retain definite and uncertain error contracts even with fallback fields', async () => {
  for (const status of [429, 408, 500, 503]) {
    const h = await harness({ intercept: request => request.path.endsWith('/generate') ? response({ ...reply, generationStatus: 'fallback' }, status) : undefined });
    h.elements.chatInput.value = draft;
    await h.submit(); await tick();
    assert.equal(h.elements.chatSendStatus.dataset.copyKey, status === 429 ? 'failed' : 'uncertain');
    assert.equal(h.elements.chatSendStatus.dataset.state, 'error');
    assert.equal(h.elements.chatInput.value, draft);
    assert.equal(h.api.basicChatState.uncertain, status !== 429);
    assert.equal(h.elements.chatCheckMessages.hidden, status === 429);
    assert.equal(h.requests.filter(request => request.path.endsWith('/generate')).length, 1);
    assert.equal(h.requests.at(-1).path.endsWith('/generate'), true);
  }
});

for (const [generationStatus, key] of [['fallback', 'fallbackReply'], [undefined, 'replyUnverified']]) {
  test('generation status: pending ' + key + ' keeps duplicate and same-account guards without an implicit request', async () => {
    const gate = deferred();
    const h = await harness({ intercept: request => request.path.endsWith('/generate') ? gate.promise : undefined });
    h.elements.chatInput.value = draft;
    const pending = h.submit(); await tick();
    assert.equal(h.api.basicChatState.busy, true);
    assert.equal(h.elements.chatInput.value, draft);
    const dispatchedCount = h.requests.length;
    await h.submit(); await h.account(); await h.locale('ja-JP');
    assert.equal(h.requests.length, dispatchedCount);
    assert.equal(h.elements.chatInput.value, draft);
    gate.resolve(response({ ...reply, generationStatus }));
    await pending; await tick();
    assertAcceptedOutcome(h, key);
    assert.equal(h.requests.length, dispatchedCount);
  });

  test('generation status: late ' + key + ' cannot revive invalid or changed URL scope or clear its draft', async () => {
    for (const nextQuery of ['storyProgressId=bad', '', 'storyProgressId=' + otherProgressId]) {
      const gate = deferred();
      const h = await harness({ query: 'storyProgressId=' + progressId,
        intercept: request => request.path.endsWith('/generate') ? gate.promise : undefined });
      h.elements.chatInput.value = draft;
      const pending = h.submit(); await tick();
      const dispatchedCount = h.requests.length;
      await h.route(nextQuery);
      const retiredCopy = h.elements.chatSendStatus.dataset.copyKey;
      gate.resolve(response({ ...reply, generationStatus }));
      await pending; await tick();
      assert.equal(h.requests.length, dispatchedCount);
      assert.equal(h.elements.chatSendStatus.dataset.copyKey, retiredCopy);
      assert.equal(retiredCopy, nextQuery === 'storyProgressId=bad' ? 'routeRequestUnknown' : 'routeChanged');
      assert.equal(h.elements.chatInput.value, draft);
      assert.equal(h.elements.chatThread.children.length, 0);
      assert.equal(h.elements.chatSendBtn.disabled, true);
    }
  });

  test('generation status: late old-account ' + key + ' cannot overwrite the new account transcript or draft', async () => {
    const gate = deferred();
    const h = await harness({ intercept: request => {
      if (request.path.endsWith('/generate')) return gate.promise;
      const newAccount = request.headers?.Authorization?.includes('synthetic-user-b');
      if (newAccount && request.path === '/api/v1/chat/sessions') return response([{ ...owned[0], id: 'synthetic-session-b' }]);
      if (newAccount && request.path.endsWith('/messages')) return response([{ id: 'synthetic-history-b', senderType: 'artist', body: 'Synthetic B-only history' }]);
      return undefined;
    } });
    h.elements.chatInput.value = draft;
    const pending = h.submit(); await tick();
    await h.account('synthetic-user-b');
    h.elements.chatInput.value = 'Synthetic private B draft';
    await h.elements.chatInput.emit('input');
    const newHistory = h.elements.chatThread.textContent, newCopy = h.elements.chatSendStatus.dataset.copyKey;
    assert(newHistory.includes('Synthetic B-only history'));
    const newAccountCount = h.requests.length;
    gate.resolve(response({ ...reply, generationStatus }));
    await pending; await tick();
    assert.equal(h.requests.length, newAccountCount);
    assert.equal(h.elements.chatThread.textContent, newHistory);
    assert.equal(h.elements.chatInput.value, 'Synthetic private B draft');
    assert.equal(h.elements.chatSendStatus.dataset.copyKey, newCopy);
    assert.equal(h.api.basicChatState.sessionId, 'synthetic-session-b');
    assert.equal(h.requests.filter(request => request.path.endsWith('/generate')).length, 1);
  });

  test('generation status: existing 401 retry preserves the ' + key + ' category after token rotation', async () => {
    let attempts = 0, refreshes = 0;
    const h = await harness({ query: 'storyProgressId=' + progressId.toUpperCase(),
      intercept: request => request.path.endsWith('/generate') ? ++attempts === 1 ? response({}, 401) : response({ ...reply, generationStatus }) : undefined });
    h.window.refreshAuthOnce = async () => { refreshes++; await h.account(); return true; };
    h.elements.chatInput.value = draft;
    await h.submit(); await tick();
    assert.equal(refreshes, 1); assert.equal(attempts, 2);
    const generates = h.requests.filter(request => request.path.endsWith('/generate'));
    assert.equal(generates.length, 2, 'One existing 401 replay, never a retry caused by fallback/unknown settlement');
    for (const request of generates) assert.deepEqual(request.body, { body: draft, storyProgressId: progressId.toUpperCase() });
    assert.notEqual(generates[0].headers.Authorization, generates[1].headers.Authorization);
    assert.equal(h.elements.chatSendStatus.dataset.copyKey, key);
    assert.equal(h.elements.chatSendStatus.dataset.state, '');
    assert.equal(h.elements.chatInput.value, '');
    const settledCount = h.requests.length;
    await h.submit(); await h.check(); await tick();
    assert.equal(h.requests.length, settledCount);
  });
}

const newerDraft = 'A newer same-account synthetic draft';
for (const [generationStatus, key, state] of [
  ['completed', 'sent', 'success'], ['fallback', 'fallbackReply', ''], [undefined, 'replyUnverified', ''],
]) for (const changed of [true, false]) {
  test('draft protection: pending ' + key + (changed ? ' preserves newer B' : ' clears unchanged A'), async () => {
    const gate = deferred();
    const { generationStatus: _completed, ...pair } = reply;
    const result = generationStatus === undefined ? pair : { ...pair, generationStatus };
    const h = await harness({ query: 'storyProgressId=' + progressId,
      intercept: request => request.path.endsWith('/generate') ? gate.promise : undefined });
    h.elements.chatInput.value = draft;
    h.elements.chatInput.scrollHeight = 88;
    await h.elements.chatInput.emit('input');
    const pending = h.submit(); await tick();
    assert.equal(h.api.basicChatState.busy, true);
    const dispatchedCount = h.requests.length;
    h.elements.chatInput.value = changed ? newerDraft : '  ' + draft + '  ';
    h.elements.chatInput.scrollHeight = changed ? 112 : 88;
    await h.elements.chatInput.emit('input');
    const currentDraft = h.elements.chatInput.value, currentHeight = h.elements.chatInput.style.height;
    await h.submit(); await h.account(); await h.locale('ja-JP');
    assert.equal(h.requests.length, dispatchedCount);
    assert.equal(h.elements.chatInput.value, currentDraft);
    assert.equal(h.elements.chatInput.style.height, currentHeight);
    gate.resolve(response(result)); await pending; await tick();
    assert.equal(h.elements.chatInput.value, changed ? currentDraft : '');
    assert.equal(h.elements.chatInput.style.height, changed ? currentHeight : 'auto');
    assert.equal(h.elements.chatSendStatus.dataset.copyKey, key);
    assert.equal(h.elements.chatSendStatus.dataset.state, state);
    assert.equal(h.api.basicChatState.busy, false);
    assert.equal(h.api.basicChatState.uncertain, false);
    assert.equal(h.elements.chatCheckMessages.hidden, true);
    assert.equal(h.elements.chatSendBtn.disabled, !changed);
    assert.equal(h.elements.chatThread.children.length, history.length + 2);
    assert.equal(h.elements.chatThread.textContent.includes(newerDraft), false, 'B was never submitted or acknowledged');
    const generates = h.requests.filter(request => request.path.endsWith('/generate'));
    assert.equal(generates.length, 1);
    assert.deepEqual(generates[0].body, { body: draft, storyProgressId: progressId });
    for (const [locale] of outcomeLocaleCopy) {
      await h.locale(locale);
      assert.equal(h.elements.chatSendStatus.dataset.copyKey, key);
      assert.equal(h.elements.chatInput.value, changed ? currentDraft : '');
      assert.equal(h.elements.chatInput.style.height, changed ? currentHeight : 'auto');
    }
    assert.equal(h.requests.length, dispatchedCount, 'Settlement and locale changes cannot repeat A or send B');
  });
}

for (const changed of [true, false]) test('draft protection: pending history confirmation' + (changed ? ' preserves newer B' : ' clears unchanged A'), async () => {
  const gate = deferred(); let checking = false;
  const h = await harness({ query: 'storyProgressId=' + progressId, intercept: request => {
    if (request.path.endsWith('/generate')) throw new Error('Synthetic transport result unknown');
    if (request.path.endsWith('/messages') && checking) return gate.promise;
    return undefined;
  } });
  h.elements.chatInput.value = draft;
  h.elements.chatInput.scrollHeight = 88;
  await h.elements.chatInput.emit('input');
  await h.submit(); await tick();
  assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'uncertain');
  assert.equal(h.api.basicChatState.uncertainBody, draft);
  const beforeCheck = h.requests.length;
  const previousReads = h.requests.filter(request => request.path.endsWith('/messages')).length;
  checking = true;
  const pending = h.check(); await tick();
  assert.equal(h.api.basicChatState.busy, true);
  h.elements.chatInput.value = changed ? newerDraft : '  ' + draft + '  ';
  h.elements.chatInput.scrollHeight = changed ? 112 : 88;
  await h.elements.chatInput.emit('input');
  const currentDraft = h.elements.chatInput.value, currentHeight = h.elements.chatInput.style.height;
  await h.submit(); await h.check(); await h.account(); await h.locale('ja-JP');
  assert.equal(h.requests.length, beforeCheck + 1);
  assert.equal(h.elements.chatInput.value, currentDraft);
  assert.equal(h.elements.chatInput.style.height, currentHeight);
  gate.resolve(response([...history, { id: 'synthetic-confirmed-original-A', senderType: 'user', body: draft }]));
  await pending; await tick();
  assert.equal(h.elements.chatInput.value, changed ? currentDraft : '');
  assert.equal(h.elements.chatInput.style.height, currentHeight, 'History confirmation preserves existing height behavior');
  assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'receiptConfirmed');
  assert.equal(h.elements.chatSendStatus.dataset.state, '', 'A user receipt does not prove reply completion');
  assert.equal(h.api.basicChatState.busy, false);
  assert.equal(h.api.basicChatState.uncertain, false);
  assert.equal(h.elements.chatCheckMessages.hidden, true);
  assert.equal(h.elements.chatSendBtn.disabled, !changed);
  assert.equal(h.elements.chatThread.textContent.includes(newerDraft), false);
  assert.equal(h.requests.filter(request => request.path.endsWith('/generate')).length, 1);
  assert.equal(h.requests.filter(request => request.path.endsWith('/messages')).length, previousReads + 1);
  assert.equal(h.requests.at(-1).method, 'GET');
  assert.equal(h.requests.at(-1).query, '?storyProgressId=' + progressId);
  for (const [locale] of outcomeLocaleCopy) {
    await h.locale(locale);
    assert.equal(h.elements.chatSendStatus.dataset.copyKey, 'receiptConfirmed');
    assert.equal(h.elements.chatSendStatus.dataset.state, '');
    assert.equal(h.elements.chatInput.value, changed ? currentDraft : '');
    assert.equal(h.elements.chatInput.style.height, currentHeight);
  }
  assert.equal(h.requests.length, beforeCheck + 1, 'Only the explicit history GET runs; A and B are not resent');
});

test('browser expectations have valid module grammar; this does not execute or launch their browser harness', () => {
  const checked = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: browserTest, encoding: 'utf8' });
  assert.equal(checked.error, undefined);
  assert.equal(checked.status, 0, checked.stderr);
  assert.doesNotMatch(browserTest, /invalid story scope is omitted/);
});
