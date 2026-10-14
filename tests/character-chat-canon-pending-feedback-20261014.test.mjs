import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

// SOURCE-authored, UNRUN by the independent author. No init, browser or real transport.
const selectedSource = process.env.CHAT_CANON_PENDING_SOURCE;
const selectedSha = process.env.CHAT_CANON_PENDING_SHA256;
assert.ok(selectedSource === undefined ? selectedSha === undefined :
  selectedSource && /^[a-f0-9]{64}$/i.test(selectedSha || ''), 'Explicit source requires its raw SHA256');
const sourcePath = selectedSource || fileURLToPath(new URL('../pages/character-chat.js', import.meta.url));
const sourceBytes = readFileSync(sourcePath);
if (selectedSource !== undefined) assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), selectedSha.toLowerCase());
const source = sourceBytes.toString('utf8');
const marker = '  if (document.readyState === "loading") {';
assert.equal(source.split(marker).length, 2, 'One existing DOM-ready marker');
const expose = `  window.__canonPendingTest = {
    basicChatState, basicChatContext, isBasicChatContextCurrent, isBasicChatCanonPending,
    bindBasicChatComposer, renderBasicMessages
  };\n`;
const codes = ['CHAT_ARTIST_PERSONA_APPROVAL_REQUIRED', 'CHAT_ARTIST_PERSONA_SOURCE_CHANGED'];
const shapes = ['top', 'nested'];
const bodyFor = (code, shape = 'top') => shape === 'nested' ? { error: { code } } : { code };
const copy = {
  'ko-KR': '\uce90\ub9ad\ud130 \uc124\uc815\uc744 \ud655\uc778\ud558\uace0 \uc788\uc5b4\uc694. \ud655\uc778\uc774 \ub05d\ub098\uba74 \ub2e4\uc2dc \uc774\uc6a9\ud574 \uc8fc\uc138\uc694.',
  'en-US': 'The character settings are being checked. Please use chat again once the check is complete.',
  'ja-JP': '\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u8a2d\u5b9a\u3092\u78ba\u8a8d\u3057\u3066\u3044\u307e\u3059\u3002\u78ba\u8a8d\u304c\u7d42\u308f\u3063\u3066\u304b\u3089\u3001\u307e\u305f\u3054\u5229\u7528\u304f\u3060\u3055\u3044\u3002',
  'zh-CN': '\u6b63\u5728\u786e\u8ba4\u89d2\u8272\u8bbe\u5b9a\u3002\u8bf7\u5728\u786e\u8ba4\u5b8c\u6210\u540e\u518d\u4f7f\u7528\u804a\u5929\u3002',
  'zh-Hant': '\u6b63\u5728\u78ba\u8a8d\u89d2\u8272\u8a2d\u5b9a\u3002\u8acb\u5728\u78ba\u8a8d\u5b8c\u6210\u5f8c\u518d\u4f7f\u7528\u804a\u5929\u3002',
};
const outcomeCopy = {
  'ko-KR': '\ub300\ud654 \ucc98\ub9ac \uc911 \uce90\ub9ad\ud130 \uae30\uc900\uc774 \ubc14\ub00c\uc5b4 \uacb0\uacfc\ub97c \ud655\uc778\ud560 \uc218 \uc5c6\uc5b4\uc694. \uac19\uc740 \uba54\uc2dc\uc9c0\ub97c \ub2e4\uc2dc \ubcf4\ub0b4\uc9c0 \ub9c8\uc138\uc694.',
  'en-US': 'The character settings changed while your message was being processed. Its result is unconfirmed. Do not resend the same message.',
  'ja-JP': '\u30e1\u30c3\u30bb\u30fc\u30b8\u306e\u51e6\u7406\u4e2d\u306b\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u8a2d\u5b9a\u304c\u5909\u308f\u308a\u3001\u7d50\u679c\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3002\u540c\u3058\u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u518d\u9001\u3057\u306a\u3044\u3067\u304f\u3060\u3055\u3044\u3002',
  'zh-CN': '\u6d88\u606f\u5904\u7406\u671f\u95f4\u89d2\u8272\u8bbe\u5b9a\u53d1\u751f\u53d8\u5316\uff0c\u65e0\u6cd5\u786e\u8ba4\u7ed3\u679c\u3002\u8bf7\u52ff\u91cd\u590d\u53d1\u9001\u540c\u4e00\u6761\u6d88\u606f\u3002',
  'zh-Hant': '\u8a0a\u606f\u8655\u7406\u671f\u9593\u89d2\u8272\u8a2d\u5b9a\u767c\u751f\u8b8a\u5316\uff0c\u7121\u6cd5\u78ba\u8a8d\u7d50\u679c\u3002\u8acb\u52ff\u91cd\u8907\u50b3\u9001\u540c\u4e00\u5247\u8a0a\u606f\u3002',
};
const slug = 'synthetic-artist', artistId = 'synthetic-artist-id', sessionId = 'synthetic-session';
const progressId = '12345678-1234-4123-8123-123456789abc';
const draft = 'Synthetic unsent draft <em>literal</em>';
const newerDraft = 'Synthetic newer same-account draft';
const history = [
  { id: 'saved-greeting', senderType: 'artist', messageType: 'opening_greeting', body: 'Saved greeting <b>literal</b>', createdAt: '2026-09-27T10:11:12.000Z' },
  { id: 'saved-message', senderType: 'user', body: 'Earlier saved message', createdAt: '2026-09-27T10:12:12.000Z' },
];
const completed = { generationStatus: 'completed',
  userMessage: { id: 'new-user', senderType: 'user', body: draft },
  message: { id: 'new-artist', senderType: 'artist', body: 'Synthetic completed reply' } };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const settle = async () => { for (let tick = 0; tick < 64; tick++) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function events() {
  const handlers = new Map();
  return {
    addEventListener(type, callback) { const list = handlers.get(type) || []; list.push(callback); handlers.set(type, list); },
    async emit(type) { for (const callback of handlers.get(type) || []) await callback({ type, preventDefault() {} }); },
  };
}
async function harness({ sessions = true, entry = false, intercept } = {}) {
  const effects = [], requests = [], accessories = [], timers = new Map();
  const forbidden = name => () => { effects.push(name); throw new Error('Forbidden effect: ' + name); };
  function element(tag = 'div') {
    return { ...events(), tagName: tag.toUpperCase(), children: [], text: '', value: '', dataset: {}, style: {},
      hidden: false, disabled: false, scrollHeight: 80, scrollTop: 0,
      get textContent() { return this.text + this.children.map(child => child.textContent).join(''); },
      set textContent(value) { this.text = String(value); this.children = []; },
      set innerHTML(_) { forbidden('HTML write')(); },
      setAttribute(key, value) { this[key] = String(value); },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.text = ''; this.children = children; },
    };
  }
  const elements = Object.fromEntries(['chatInput', 'chatSendBtn', 'chatInputForm', 'chatSendStatus',
    'chatCheckMessages', 'chatThread', 'chatWelcomeBubble', 'chatWelcomeText', 'chatWelcomeTime', 'chatStage', 'chatBasicNote']
    .map(id => [id, element()]));
  elements.chatCheckMessages.hidden = true;
  let locale = 'en-US', account = { user: { id: 'synthetic-user-a' }, accessToken: 'synthetic-token-a' }, timerId = 0;
  const storage = { getItem: forbidden('storage read'), setItem: forbidden('storage write'), removeItem: forbidden('storage remove') };
  const window = { ...events(), LUMINA_API_BASE: 'https://synthetic.invalid',
    location: { search: '?slug=' + slug + '&storyProgressId=' + progressId, pathname: '/character-chat', hostname: 'synthetic.invalid' },
    getAccessToken: () => account?.accessToken || null, getAuth: () => account,
    luminaI18n: { getRegionalLocale: () => locale }, localStorage: storage, sessionStorage: storage,
    LuminaCms: { hydrate: forbidden('CMS') }, fetch: forbidden('window.fetch'), apiFetch: forbidden('window.apiFetch') };
  const context = { window,
    document: { ...events(), readyState: 'loading', hidden: false, getElementById: id => elements[id] || null,
      createElement: element, querySelectorAll: () => [], querySelector: () => null },
    URLSearchParams, AbortController, atob, localStorage: storage, sessionStorage: storage,
    apiFetch: forbidden('apiFetch'), setInterval: forbidden('interval'),
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    async fetch(url, options = {}) {
      const parsed = new URL(url), method = options.method || 'GET';
      assert.equal(parsed.origin, 'https://synthetic.invalid', 'Transport is an in-memory spy only');
      const request = { path: parsed.pathname, query: parsed.search, method, signal: options.signal,
        body: options.body ? JSON.parse(options.body) : undefined, headers: options.headers };
      // The unchanged account binder's two accessory reads are isolated, not expanded or exercised.
      if (['/api/v1/chat/premium-support-contract', '/api/v1/chat/conversations'].includes(request.path)) {
        assert.equal(method, 'GET'); accessories.push(request);
        return response(request.path.endsWith('premium-support-contract') ? { policy: { walletMutationEnabled: false } } : { items: [] });
      }
      const isB = request.headers?.Authorization?.includes('synthetic-token-b');
      const currentSession = isB ? 'synthetic-session-b' : sessionId;
      const allowed = request.path === '/api/v1/artists' && method === 'GET' ||
        request.path === '/api/v1/chat/sessions' && ['GET', 'POST'].includes(method) ||
        request.path === '/api/v1/chat/sessions/' + currentSession + '/messages' && method === 'GET' ||
        request.path === '/api/v1/chat/sessions/' + currentSession + '/generate' && method === 'POST';
      assert.ok(allowed, 'No wallet, order, greeting, provider or unrelated endpoint: ' + request.path);
      requests.push(request);
      const intercepted = intercept?.(request);
      if (intercepted !== undefined) return intercepted;
      if (request.path === '/api/v1/artists') return response([{ id: artistId, slug, status: 'active' }]);
      if (request.path === '/api/v1/chat/sessions') return method === 'GET'
        ? response(sessions ? [{ id: currentSession, artistId, status: 'active', chatPersonaId: null }] : [])
        : response({ id: currentSession, artistId });
      if (request.path.endsWith('/messages')) {
        assert.equal(request.query, '?storyProgressId=' + progressId);
        return response(isB ? [{ id: 'saved-b', senderType: 'artist', body: 'Synthetic B-only saved history' }] : history);
      }
      assert.deepEqual(request.body, { body: draft, storyProgressId: progressId });
      return response(completed);
    },
  };
  // Expose real closures before DOM-ready, without replacing product functions or running init.
  vm.runInNewContext(source.replace(marker, () => expose + marker), context, { filename: sourcePath, timeout: 3000 });
  const api = window.__canonPendingTest;
  api.basicChatState.accountKey = entry ? null : 'user:synthetic-user-a';
  api.basicChatState.epoch = 7; api.basicChatState.routeEpoch = 2;
  api.basicChatState.artistId = artistId; api.basicChatState.sessionId = sessions ? sessionId : null;
  api.renderBasicMessages(history);
  api.bindBasicChatComposer(slug);
  elements.chatInput.value = draft;
  await elements.chatInput.emit('input'); await settle();
  return { api, window, elements, requests, accessories, effects, timers,
    submit: () => elements.chatInputForm.emit('submit'), check: () => elements.chatCheckMessages.emit('click'),
    async locale(value) { locale = value; await window.emit('lumina:localechange'); await settle(); },
    async account(id = 'synthetic-user-a') {
      account = { user: { id }, accessToken: id === 'synthetic-user-b' ? 'synthetic-token-b' : 'synthetic-rotated-token-a' };
      await window.emit('lumina:authchange'); await settle();
    },
    async route(search) { window.location.search = search; await window.emit('popstate'); await settle(); },
  };
}
function status(h, key) {
  assert.equal(h.elements.chatSendStatus.dataset.copyKey, key);
  assert.equal(h.elements.chatSendStatus.dataset.state, key === 'sent' ? 'success' : 'error');
}
function saved(h) { return h.elements.chatThread.textContent; }
function noEffects(h) { assert.deepEqual(h.effects, []); assert.equal(h.timers.size, 0); }
async function assertLocalizedPending(h, key = 'canonPending') {
  const expectedCopy = key === 'canonOutcomeUnknown' ? outcomeCopy : copy;
  const count = h.requests.length, accessoryCount = h.accessories.length, transcript = saved(h);
  const currentDraft = h.elements.chatInput.value, height = h.elements.chatInput.style.height;
  for (const [locale, expected] of Object.entries(expectedCopy)) {
    await h.locale(locale); status(h, key);
    assert.equal(h.elements.chatSendStatus.textContent, expected);
    assert.equal(h.elements.chatInput.value, currentDraft); assert.equal(h.elements.chatInput.style.height, height);
    assert.equal(saved(h), transcript);
  }
  await h.locale('fr-FR'); assert.equal(h.elements.chatSendStatus.textContent, expectedCopy['ko-KR']);
  await h.account(); await settle(); status(h, key);
  assert.equal(h.requests.length, count, 'Locale and same-account changes cannot fetch or retry');
  assert.equal(h.accessories.length, accessoryCount);
}

for (const code of codes) for (const shape of shapes) test('exact classifier: ' + code + ' / ' + shape, async () => {
  const h = await harness();
  assert.equal(h.api.isBasicChatCanonPending({ status: 409, body: bodyFor(code, shape) }), true);
  assert.equal(h.requests.length, 0); noEffects(h);
});
test('classifier rejects non-exact status, unknown/malformed codes and unrelated error fields', async () => {
  const h = await harness(), classify = h.api.isBasicChatCanonPending;
  for (const code of codes) for (const shape of shapes) for (const status of [undefined, null, '409', 200, 400, 401, 403, 408, 500])
    assert.equal(classify({ status, body: bodyFor(code, shape) }), false);
  for (const error of [null, {}, { status: 409 }, { status: 409, code: codes[0] },
    { status: 409, body: { message: codes[0] } }, { status: 409, body: { error: codes[0] } },
    { status: 409, body: { code: 'UNKNOWN', error: { code: codes[0] } } },
    ...[undefined, null, '', 'OTHER_CONFLICT', codes[0].toLowerCase(), codes[0] + ' ', true, 409, [], {}]
      .flatMap(code => shapes.map(shape => ({ status: 409, body: bodyFor(code, shape) })))]) assert.equal(classify(error), false);
  assert.equal(h.requests.length, 0); noEffects(h);
});

for (const stage of ['generate', 'create', 'read']) for (const code of codes) for (const shape of shapes)
  test('submit pending: ' + stage + ' / ' + code + ' / ' + shape, async () => {
    const h = await harness({ sessions: stage !== 'create', intercept: request =>
      (stage === 'generate' && request.path.endsWith('/generate') || stage === 'create' && request.path === '/api/v1/chat/sessions' && request.method === 'POST' ||
       stage === 'read' && request.path.endsWith('/messages')) ? response(bodyFor(code, shape), 409) : undefined });
    const before = h.api.basicChatContext(), transcript = saved(h);
    const held = stage === 'generate' && code === codes[1];
    const key = held ? 'canonOutcomeUnknown' : 'canonPending';
    await h.submit(); await settle(); status(h, key);
    assert.equal(h.elements.chatInput.value, draft); assert.equal(h.elements.chatSendBtn.disabled, held);
    assert.equal(h.api.basicChatState.busy, false); assert.equal(h.api.basicChatState.uncertain, held);
    if (held) {
      assert.equal(h.api.basicChatState.uncertainKind, 'canon_changed');
      assert.equal(h.api.basicChatState.uncertainBody, draft);
    }
    assert.equal(h.elements.chatCheckMessages.hidden, !held); assert.equal(h.api.isBasicChatContextCurrent(before), true);
    assert.equal(h.api.basicChatState.routeInvalidated, false);
    assert.equal(h.requests.filter(request => request.method === 'POST').length, stage === 'read' ? 0 : 1);
    assert.equal(h.requests.filter(request => request.path.endsWith('/generate')).length, stage === 'generate' ? 1 : 0);
    const post = h.requests.find(request => request.method === 'POST');
    if (post) assert.deepEqual(post.body, stage === 'create' ? { artistId } : { body: draft, storyProgressId: progressId });
    if (stage !== 'create') { assert.equal(saved(h), transcript); assert.equal(h.api.basicChatState.knownMessageIds.size, history.length); }
    const count = h.requests.length;
    await h.check(); await assertLocalizedPending(h, key);
    assert.equal(h.requests.length, count + (held ? 1 : 0), 'Held SOURCE permits only the deliberate history GET');
    assert.equal(h.api.basicChatState.uncertain, held);
    assert.equal(h.elements.chatInput.value, draft); assert.equal(h.elements.chatSendBtn.disabled, held); noEffects(h);
  });

for (const code of codes) for (const shape of shapes) test('manual recheck pending: ' + code + ' / ' + shape, async () => {
  let checking = false;
  const h = await harness({ intercept: request => request.path.endsWith('/generate') ? response({}, 500) :
    checking && request.path.endsWith('/messages') ? response(bodyFor(code, shape), 409) : undefined });
  await h.submit(); status(h, 'uncertain');
  const before = h.api.basicChatContext(), transcript = saved(h), count = h.requests.length;
  checking = true; await h.check(); await settle(); status(h, 'canonPending');
  assert.equal(h.requests.length, count + 1); assert.equal(h.requests.at(-1).method, 'GET');
  assert.equal(h.api.basicChatState.uncertain, true); assert.equal(h.api.basicChatState.uncertainBody, draft);
  assert.equal(h.api.basicChatState.uncertainKind, 'generate'); assert.equal(h.api.isBasicChatContextCurrent(before), true);
  assert.equal(h.elements.chatInput.value, draft); assert.equal(saved(h), transcript);
  assert.equal(h.elements.chatCheckMessages.hidden, false); assert.equal(h.elements.chatSendBtn.disabled, true);
  await h.submit(); await assertLocalizedPending(h);
  assert.equal(h.requests.length, count + 1, 'Uncertain guard prevents a POST; no automatic recheck'); noEffects(h);
});
for (const code of codes) for (const shape of shapes) test('entry read pending: ' + code + ' / ' + shape, async () => {
  const h = await harness({ entry: true, intercept: request => request.path.endsWith('/messages') ? response(bodyFor(code, shape), 409) : undefined });
  status(h, 'canonPending');
  assert.equal(h.requests.filter(request => request.method === 'POST').length, 0);
  assert.equal(h.requests.filter(request => request.path.endsWith('/messages')).length, 1);
  assert.equal(h.api.basicChatState.uncertain, false); assert.equal(h.api.basicChatState.routeInvalidated, false);
  assert.equal(h.elements.chatInput.value, draft); await assertLocalizedPending(h); noEffects(h);
});

const otherErrors = [[409, { code: 'OTHER_CONFLICT' }], ...codes.flatMap(code => [400, 401, 403, 408, 500].map(status => [status, bodyFor(code)]))];
test('non-pending submit errors retain existing failed/login/uncertain flows', async () => {
  for (const [httpStatus, body] of otherErrors) {
    const h = await harness({ intercept: request => request.path.endsWith('/generate') ? response(body, httpStatus) : undefined });
    await h.submit(); await settle();
    const uncertain = httpStatus === 408 || httpStatus >= 500;
    status(h, httpStatus === 401 || httpStatus === 403 ? 'login' : uncertain ? 'uncertain' : 'failed');
    assert.equal(h.api.basicChatState.uncertain, uncertain);
    assert.equal(h.elements.chatInput.value, httpStatus === 401 ? '' : draft);
    assert.equal(h.elements.chatCheckMessages.hidden, !uncertain);
    assert.equal(h.requests.filter(request => request.path.endsWith('/generate')).length, 1); noEffects(h);
  }
});
test('non-pending manual read errors retain stillUncertain or expired-login flow', async () => {
  for (const [httpStatus, body] of otherErrors) {
    let checking = false;
    const h = await harness({ intercept: request => request.path.endsWith('/generate') ? response({}, 500) :
      checking && request.path.endsWith('/messages') ? response(body, httpStatus) : undefined });
    await h.submit(); checking = true; await h.check(); await settle();
    status(h, httpStatus === 401 ? 'login' : 'stillUncertain');
    assert.equal(h.api.basicChatState.uncertain, httpStatus !== 401);
    assert.equal(h.requests.filter(request => request.path.endsWith('/generate')).length, 1); noEffects(h);
  }
});
test('non-pending entry read errors retain loadError or expired-login flow', async () => {
  for (const [httpStatus, body] of otherErrors) {
    const h = await harness({ entry: true, intercept: request => request.path.endsWith('/messages') ? response(body, httpStatus) : undefined });
    status(h, httpStatus === 401 ? 'login' : 'loadError');
    assert.equal(h.requests.filter(request => request.method === 'POST').length, 0); noEffects(h);
  }
});
test('existing route and memory conflict dispatch remains separate', async () => {
  for (const [code, key] of [['STORY_CHAT_ROUTE_CHANGED', 'routeChanged'], ['STORY_CHAT_MEMORY_CHANGED', 'memoryChanged']]) {
    const h = await harness({ intercept: request => request.path.endsWith('/generate') ? response(bodyFor(code, 'nested'), 409) : undefined });
    await h.submit(); status(h, key);
    assert.equal(h.api.basicChatState.routeInvalidated, key === 'routeChanged'); assert.equal(h.elements.chatInput.value, draft);
    assert.equal(h.requests.filter(request => request.method === 'POST').length, 1); noEffects(h);
  }
});
test('existing 401 replay is unchanged and is not a new pending retry', async () => {
  let attempts = 0, refreshes = 0;
  const h = await harness({ intercept: request => request.path.endsWith('/generate') ?
    ++attempts === 1 ? response(bodyFor(codes[0]), 401) : response(bodyFor(codes[1], 'nested'), 409) : undefined });
  h.window.refreshAuthOnce = async () => { refreshes++; await h.account(); return true; };
  await h.submit(); await settle(); status(h, 'canonOutcomeUnknown');
  assert.equal(refreshes, 1); assert.equal(attempts, 2);
  const generates = h.requests.filter(request => request.path.endsWith('/generate'));
  assert.notEqual(generates[0].headers.Authorization, generates[1].headers.Authorization);
  assert.equal(h.elements.chatInput.value, draft);
  assert.equal(h.api.basicChatState.uncertain, true); assert.equal(h.api.basicChatState.uncertainKind, 'canon_changed');
  await assertLocalizedPending(h, 'canonOutcomeUnknown'); assert.equal(attempts, 2); noEffects(h);
});

async function pendingStage(stage, code, settlePoint = 'fetch') {
  const gate = deferred(); let checking = false;
  const pendingResponse = settlePoint === 'json' ? { ...response({}, 409), json: () => gate.promise } : gate.promise;
  const h = await harness({ entry: stage === 'entry', sessions: stage !== 'create', intercept: request => {
    if (request.headers?.Authorization?.includes('synthetic-token-b')) return undefined;
    if (stage === 'check' && request.path.endsWith('/generate')) return response({}, 500);
    if (stage === 'generate' && request.path.endsWith('/generate') ||
        stage === 'create' && request.path === '/api/v1/chat/sessions' && request.method === 'POST' ||
        (stage === 'entry' || stage === 'check' && checking) && request.path.endsWith('/messages')) return pendingResponse;
    return undefined;
  } });
  let pending = Promise.resolve();
  if (stage === 'check') { await h.submit(); checking = true; pending = h.check(); }
  else if (stage !== 'entry') pending = h.submit();
  await settle();
  return { h, finish: async () => {
    gate.resolve(settlePoint === 'json' ? bodyFor(code, 'nested') : response(bodyFor(code, 'nested'), 409));
    await pending; await settle();
  } };
}
for (const code of codes) test('pending preserves a newer same-account draft: ' + code, async () => {
  for (const stage of ['generate', 'create', 'check', 'entry']) {
    const p = await pendingStage(stage, code), h = p.h, count = h.requests.length;
    h.elements.chatInput.value = newerDraft; h.elements.chatInput.scrollHeight = 112;
    await h.elements.chatInput.emit('input'); const height = h.elements.chatInput.style.height;
    if (stage !== 'entry') { await h.submit(); assert.equal(h.requests.length, count, 'Busy/uncertain duplicate guard remains'); }
    const key = stage === 'generate' && code === codes[1] ? 'canonOutcomeUnknown' : 'canonPending';
    await h.locale('ja-JP'); await p.finish(); status(h, key);
    assert.equal(h.elements.chatInput.value, newerDraft); assert.equal(h.elements.chatInput.style.height, height);
    assert.equal(saved(h).includes(newerDraft), false); assert.equal(h.requests.length, count);
    await assertLocalizedPending(h, key); noEffects(h);
  }
});
for (const boundary of ['account', 'route']) for (const stage of ['generate', 'create', 'check', 'entry'])
  test('late pending cannot overwrite changed ' + boundary + ': ' + stage, async () => {
    for (const code of codes) for (const settlePoint of ['fetch', 'json']) {
      const p = await pendingStage(stage, code, settlePoint), h = p.h, before = h.api.basicChatContext();
      if (boundary === 'account') {
        await h.account('synthetic-user-b'); h.elements.chatInput.value = 'Synthetic private B draft';
        await h.elements.chatInput.emit('input');
      } else await h.route('?slug=' + slug + '&storyProgressId=invalid');
      assert.equal(h.api.isBasicChatContextCurrent(before), false);
      const retired = { text: saved(h), draft: h.elements.chatInput.value, key: h.elements.chatSendStatus.dataset.copyKey,
        epoch: h.api.basicChatState.epoch, routeEpoch: h.api.basicChatState.routeEpoch, count: h.requests.length,
        disabled: h.elements.chatSendBtn.disabled };
      await p.finish();
      assert.equal(saved(h), retired.text); assert.equal(h.elements.chatInput.value, retired.draft);
      assert.equal(h.elements.chatSendStatus.dataset.copyKey, retired.key); assert.notEqual(retired.key, 'canonPending');
      assert.equal(h.api.basicChatState.epoch, retired.epoch); assert.equal(h.api.basicChatState.routeEpoch, retired.routeEpoch);
      assert.equal(h.requests.length, retired.count); assert.equal(h.elements.chatSendBtn.disabled, retired.disabled);
      if (boundary === 'account') assert.equal(h.api.basicChatState.accountKey, 'user:synthetic-user-b');
      else { status(h, 'routeRequestUnknown'); assert.equal(h.elements.chatInput.value, draft); }
      noEffects(h);
    }
  });
test('ordinary completed settlement preserves saved history and does not replay on copy sync or empty submit', async () => {
  const h = await harness(), transcript = saved(h);
  await h.submit(); status(h, 'sent');
  assert.equal(h.elements.chatInput.value, ''); assert.equal(saved(h).startsWith(transcript), true);
  assert.equal(h.elements.chatThread.children.length, history.length + 2);
  const count = h.requests.length;
  for (const locale of Object.keys(copy)) await h.locale(locale);
  await h.account(); await h.submit(); await h.check(); await settle(); status(h, 'sent');
  assert.equal(h.requests.length, count); assert.equal(h.api.basicChatState.uncertain, false); noEffects(h);
});
