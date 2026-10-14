import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

// SOURCE-authored, UNRUN by the author. Actual product IIFE/handlers, synthetic effects only.
const frozenSha = '8ecdef980c15d25d15ef7b6a9f5661bb1c0dab07ad69d18665754d4cf297a532';
const defaultSource = fileURLToPath(new URL('../pages/character-chat.js', import.meta.url));
function selectProduct(selectedSource, selectedSha) {
  assert.ok(selectedSource === undefined ? selectedSha === undefined :
    typeof selectedSource === 'string' && selectedSource && /^[a-f0-9]{64}$/i.test(selectedSha || ''),
  'Explicit source requires its raw SHA256');
  const path = selectedSource === undefined ? defaultSource : selectedSource;
  const bytes = readFileSync(path), sha = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha, selectedSha === undefined ? frozenSha : selectedSha.toLowerCase(), 'Source raw SHA256');
  assert.equal(sha, frozenSha, 'Only the frozen product is selected');
  return { path, sha, source: bytes.toString('utf8') };
}
const product = selectProduct(process.env.CHAT_CANON_PENDING_SOURCE, process.env.CHAT_CANON_PENDING_SHA256);
const marker = '  if (document.readyState === "loading") {';
assert.equal(product.source.split(marker).length, 2, 'One existing DOM-ready marker');
const expose = `  window.__canonOutcomeTest = {
    basicChatState, basicChatContext, isBasicChatContextCurrent, isBasicChatCanonPending,
    isBasicChatCanonSourceChanged, bindBasicChatComposer, bindInputAutoGrow, renderBasicMessages
  };\n`;
const sourceCode = 'CHAT_ARTIST_PERSONA_SOURCE_CHANGED';
const approvalCode = 'CHAT_ARTIST_PERSONA_APPROVAL_REQUIRED';
const shapes = ['top', 'nested'];
const bodyFor = (code, shape = 'top') => shape === 'nested' ? { error: { code } } : { code };
const outcomeCopy = {
  'ko-KR': '\ub300\ud654 \ucc98\ub9ac \uc911 \uce90\ub9ad\ud130 \uae30\uc900\uc774 \ubc14\ub00c\uc5b4 \uacb0\uacfc\ub97c \ud655\uc778\ud560 \uc218 \uc5c6\uc5b4\uc694. \uac19\uc740 \uba54\uc2dc\uc9c0\ub97c \ub2e4\uc2dc \ubcf4\ub0b4\uc9c0 \ub9c8\uc138\uc694.',
  'en-US': 'The character settings changed while your message was being processed. Its result is unconfirmed. Do not resend the same message.',
  'ja-JP': '\u30e1\u30c3\u30bb\u30fc\u30b8\u306e\u51e6\u7406\u4e2d\u306b\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u8a2d\u5b9a\u304c\u5909\u308f\u308a\u3001\u7d50\u679c\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3002\u540c\u3058\u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u518d\u9001\u3057\u306a\u3044\u3067\u304f\u3060\u3055\u3044\u3002',
  'zh-CN': '\u6d88\u606f\u5904\u7406\u671f\u95f4\u89d2\u8272\u8bbe\u5b9a\u53d1\u751f\u53d8\u5316\uff0c\u65e0\u6cd5\u786e\u8ba4\u7ed3\u679c\u3002\u8bf7\u52ff\u91cd\u590d\u53d1\u9001\u540c\u4e00\u6761\u6d88\u606f\u3002',
  'zh-Hant': '\u8a0a\u606f\u8655\u7406\u671f\u9593\u89d2\u8272\u8a2d\u5b9a\u767c\u751f\u8b8a\u5316\uff0c\u7121\u6cd5\u78ba\u8a8d\u7d50\u679c\u3002\u8acb\u52ff\u91cd\u8907\u50b3\u9001\u540c\u4e00\u5247\u8a0a\u606f\u3002',
};
const slug = 'synthetic-outcome-artist', artistId = 'synthetic-outcome-artist-id', sessionId = 'synthetic-outcome-session';
const progressId = '12345678-1234-4123-8123-123456789abc';
const changedProgressId = '12345678-1234-4123-8123-123456789abd';
const draft = 'Synthetic held draft <em>literal</em>', newerDraft = 'Synthetic newer unsent draft';
const history = [{ id: 'old-user', senderType: 'user', body: 'Synthetic earlier message' },
  { id: 'old-artist', senderType: 'artist', body: 'Synthetic saved response' }];
const matching = [...history, { id: 'new-user', senderType: 'user', body: draft }];
const completed = { generationStatus: 'completed', userMessage: matching.at(-1),
  message: { id: 'new-artist', senderType: 'artist', body: 'Synthetic completed response' } };
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
    async emit(type, fields = {}) {
      for (const callback of handlers.get(type) || []) await callback({ type, preventDefault() {}, ...fields });
    },
  };
}
async function harness({ sessions = true, entry = false, intercept } = {}) {
  const requests = [], accessories = [], effects = [], timers = new Map();
  const forbidden = name => () => { effects.push(name); throw new Error('Forbidden effect: ' + name); };
  function element(tag = 'div') {
    return { ...events(), tagName: tag.toUpperCase(), children: [], text: '', value: '', dataset: {}, style: {},
      hidden: false, disabled: false, scrollHeight: 96, scrollTop: 0,
      get textContent() { return this.text + this.children.map(child => child.textContent).join(''); },
      set textContent(value) { this.text = String(value); this.children = []; },
      set innerHTML(_) { forbidden('HTML write')(); },
      setAttribute(key, value) { this[key] = String(value); },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.text = ''; this.children = children; },
    };
  }
  const elements = Object.fromEntries(['chatInput', 'chatSendBtn', 'chatInputForm', 'chatSendStatus',
    'chatCheckMessages', 'chatThread', 'chatWelcomeBubble', 'chatStage', 'chatBasicNote'].map(id => [id, element()]));
  elements.chatCheckMessages.hidden = true;
  let account = { user: { id: 'synthetic-user-a' }, accessToken: 'synthetic-token-a' }, locale = 'en-US', timerId = 0;
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
      assert.equal(parsed.origin, 'https://synthetic.invalid', 'In-memory transport only');
      const request = { path: parsed.pathname, query: parsed.search, method, signal: options.signal,
        body: options.body ? JSON.parse(options.body) : undefined, headers: options.headers };
      // Isolate the unchanged account binder's accessory reads; no premium behavior is under test.
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
      if (request.path.endsWith('/messages')) assert.equal(request.query, '?storyProgressId=' + progressId);
      if (method === 'POST') assert.deepEqual(request.body, request.path.endsWith('/generate') ? { body: draft, storyProgressId: progressId } : { artistId });
      requests.push(request);
      const intercepted = intercept?.(request);
      if (intercepted !== undefined) return intercepted;
      if (request.path === '/api/v1/artists') return response([{ id: artistId, slug, status: 'active' }]);
      if (request.path === '/api/v1/chat/sessions') return method === 'GET'
        ? response(sessions || isB ? [{ id: currentSession, artistId, status: 'active', chatPersonaId: null }] : [])
        : response({ id: currentSession, artistId });
      if (request.path.endsWith('/messages')) return response(isB ? [{ id: 'saved-b', senderType: 'artist', body: 'Synthetic B-only history' }] : history);
      return response(completed);
    },
  };
  // Inject only closure references before DOM-ready. Do not replace functions or invoke init.
  vm.runInNewContext(product.source.replace(marker, () => expose + marker), context, { filename: product.path, timeout: 3000 });
  const api = window.__canonOutcomeTest;
  api.basicChatState.accountKey = entry ? null : 'user:synthetic-user-a';
  api.basicChatState.epoch = 7; api.basicChatState.routeEpoch = 2;
  api.basicChatState.artistId = artistId; api.basicChatState.sessionId = sessions ? sessionId : null;
  api.renderBasicMessages(history); api.bindBasicChatComposer(slug); api.bindInputAutoGrow();
  elements.chatInput.value = draft;
  await elements.chatInput.emit('input'); await settle();
  return { api, window, elements, requests, accessories, effects, timers,
    submit: () => elements.chatInputForm.emit('submit'), check: () => elements.chatCheckMessages.emit('click'),
    async input(value) { elements.chatInput.value = value; await elements.chatInput.emit('input'); },
    async locale(value) { locale = value; await window.emit('lumina:localechange'); await settle(); },
    async account(id = 'synthetic-user-a') {
      account = { user: { id }, accessToken: id === 'synthetic-user-b' ? 'synthetic-token-b' : 'synthetic-rotated-token-a' };
      await window.emit('lumina:authchange'); await settle();
    },
    async route(search) { window.location.search = search; await window.emit('popstate'); await settle(); },
  };
}
const generates = h => h.requests.filter(request => request.path.endsWith('/generate'));
const posts = h => h.requests.filter(request => request.method === 'POST');
const transcript = h => h.elements.chatThread.textContent;
function status(h, key, state = 'error') {
  assert.equal(h.elements.chatSendStatus.dataset.copyKey, key);
  assert.equal(h.elements.chatSendStatus.dataset.state, state);
}
function held(h, visibleDraft = draft) {
  status(h, 'canonOutcomeUnknown');
  assert.equal(h.api.basicChatState.uncertain, true); assert.equal(h.api.basicChatState.uncertainKind, 'canon_changed');
  assert.equal(h.api.basicChatState.uncertainBody, draft); assert.equal(h.api.basicChatState.busy, false);
  assert.equal(h.api.basicChatState.routeInvalidated, false); assert.equal(h.elements.chatInput.value, visibleDraft);
  assert.equal(h.elements.chatSendBtn.disabled, true); assert.equal(h.elements.chatSendBtn['aria-disabled'], 'true');
  assert.equal(h.elements.chatInputForm['aria-busy'], 'false'); assert.equal(h.elements.chatCheckMessages.hidden, false);
}
function noEffects(h) {
  assert.deepEqual(h.effects, []); assert.equal(h.timers.size, 0); assert.equal(h.api.basicChatState.controllers.size, 0);
}
function snapshot(h) {
  const state = h.api.basicChatState;
  return { key: state.accountKey, epoch: state.epoch, routeEpoch: state.routeEpoch, sessionId: state.sessionId,
    uncertain: state.uncertain, kind: state.uncertainKind, body: state.uncertainBody, busy: state.busy,
    routeInvalidated: state.routeInvalidated, knownIds: Array.from(state.knownMessageIds), text: transcript(h),
    draft: h.elements.chatInput.value, height: h.elements.chatInput.style.height,
    status: h.elements.chatSendStatus.dataset.copyKey, statusState: h.elements.chatSendStatus.dataset.state,
    disabled: h.elements.chatSendBtn.disabled, checkHidden: h.elements.chatCheckMessages.hidden,
    requestCount: h.requests.length, accessoryCount: h.accessories.length };
}
async function startHold(shape = 'top', checkResult = () => response(history)) {
  let checking = false;
  const h = await harness({ intercept: request => request.path.endsWith('/generate') ? response(bodyFor(sourceCode, shape), 409) :
    checking && request.path.endsWith('/messages') ? checkResult(request) : undefined });
  await h.submit(); held(h);
  return { h, async check() { checking = true; await h.check(); await settle(); } };
}

test('source selection is paired, byte-pinned and fails before product evaluation', () => {
  const explicit = selectProduct(product.path, frozenSha.toUpperCase());
  assert.equal(explicit.path, product.path); assert.equal(explicit.sha, frozenSha); assert.equal(explicit.source, product.source);
  for (const [path, sha] of [[undefined, frozenSha], [product.path, undefined], ['', frozenSha], [product.path, 'bad']])
    assert.throws(() => selectProduct(path, sha), /Explicit source requires its raw SHA256/);
  assert.throws(() => selectProduct(product.path, '0'.repeat(64)), /Source raw SHA256/);
});
test('wrong owner, epoch, route or incomplete context cannot be current', async () => {
  const h = await harness(), current = h.api.basicChatContext();
  assert.equal(h.api.isBasicChatContextCurrent(current), true);
  for (const context of [null, {}, { ...current, key: 'user:synthetic-user-b' }, { ...current, epoch: current.epoch + 1 },
    { ...current, routeEpoch: current.routeEpoch + 1 }, { ...current, storyProgressId: changedProgressId }])
    assert.equal(h.api.isBasicChatContextCurrent(context), false);
  assert.equal(h.requests.length, 0); assert.equal(h.api.basicChatState.uncertain, false); noEffects(h);
});
test('exact source helper keeps numeric 409, both body shapes and truthy top-code precedence', async () => {
  const h = await harness(), classify = h.api.isBasicChatCanonSourceChanged;
  for (const shape of shapes) {
    assert.equal(classify({ status: 409, body: bodyFor(sourceCode, shape) }), true);
    assert.equal(classify({ status: 409, body: bodyFor(approvalCode, shape) }), false);
    for (const status of [undefined, null, '409', 200, 400, 401, 403, 408, 500])
      assert.equal(classify({ status, body: bodyFor(sourceCode, shape) }), false);
  }
  for (const top of ['OTHER_CONFLICT', approvalCode, true, 1, [], {}])
    assert.equal(classify({ status: 409, body: { code: top, error: { code: sourceCode } } }), false);
  for (const top of [undefined, null, '', false, 0])
    assert.equal(classify({ status: 409, body: { code: top, error: { code: sourceCode } } }), true);
  assert.equal(classify({ status: 409, body: { code: sourceCode, error: { code: approvalCode } } }), true);
  for (const error of [null, {}, { status: 409 }, { status: 409, code: sourceCode }, { status: 409, body: { message: sourceCode } },
    { status: 409, body: { error: sourceCode } }, ...[sourceCode.toLowerCase(), sourceCode + ' ', true, 409, [], {}]
      .flatMap(code => shapes.map(shape => ({ status: 409, body: bodyFor(code, shape) })))]) assert.equal(classify(error), false);
  for (const stage of ['before_provider', 'after_provider', 'unknown'])
    assert.equal(classify({ status: 409, body: { code: sourceCode, stage, outcome: 'unverified' } }), true, 'No error-stage contract is inferred');
  assert.equal(h.requests.length, 0); noEffects(h);
});
for (const shape of shapes) test('POST source holds draft and blocks future synthetic submission: ' + shape, async () => {
  const { h } = await startHold(shape), count = h.requests.length, text = transcript(h), context = h.api.basicChatContext();
  assert.equal(generates(h).length, 1); assert.equal(posts(h).length, 1);
  assert.equal(h.api.isBasicChatContextCurrent(context), true); assert.equal(text, 'Synthetic earlier messageSynthetic saved response');
  for (const value of [draft, newerDraft, draft]) { await h.input(value); await h.submit(); held(h, value); }
  assert.equal(h.requests.length, count, 'Held submit does not even perform preflight reads');
  assert.equal(transcript(h), text); noEffects(h);
});
test('outcome copy has five exact locales and fallback without fetching or changing the hold', async () => {
  const { h } = await startHold(), before = snapshot(h);
  for (const [locale, expected] of Object.entries(outcomeCopy)) {
    await h.locale(locale); held(h); assert.equal(h.elements.chatSendStatus.textContent, expected);
  }
  await h.locale('fr-FR'); held(h); assert.equal(h.elements.chatSendStatus.textContent, outcomeCopy['ko-KR']);
  await h.account(); held(h); await h.submit();
  assert.deepEqual(snapshot(h), before); noEffects(h);
});
for (const result of ['empty', 'matching']) test('current-view history cannot settle provider outcome: ' + result, async () => {
  const rows = result === 'empty' ? [] : matching;
  const p = await startHold('top', () => response(rows)), h = p.h, before = h.api.basicChatContext(), count = h.requests.length;
  for (let check = 0; check < 2; check++) {
    await p.check(); held(h); assert.equal(h.api.isBasicChatContextCurrent(before), true);
    assert.equal(transcript(h), rows.map(row => row.body).join(''));
    assert.deepEqual(Array.from(h.api.basicChatState.knownMessageIds), rows.map(row => row.id));
    await h.submit(); assert.equal(generates(h).length, 1);
  }
  assert.equal(h.requests.length, count + 2);
  for (const request of h.requests.slice(count)) { assert.equal(request.method, 'GET'); assert.ok(request.path.endsWith('/messages')); }
  assert.equal(h.elements.chatInput.style.height, '96px'); noEffects(h);
});
const checkErrors = [
  ['source-top', () => response(bodyFor(sourceCode), 409)],
  ['source-nested', () => response(bodyFor(sourceCode, 'nested'), 409)],
  ['approval', () => response(bodyFor(approvalCode), 409)],
  ['synthetic-auth-flag', () => Promise.reject(Object.assign(new Error('Synthetic auth error'), { chatAuthChanged: true, status: 403 }))],
  ['forbidden', () => response({}, 403)],
  ['server', () => response({}, 500)],
];
for (const [name, checkResult] of checkErrors) test('readonly failure preserves existing canon hold: ' + name, async () => {
  const p = await startHold('nested', checkResult), h = p.h, before = snapshot(h);
  await p.check(); held(h); await h.submit();
  assert.deepEqual(snapshot(h), { ...before, requestCount: before.requestCount + 1 });
  assert.equal(h.requests.at(-1).method, 'GET'); assert.equal(generates(h).length, 1); noEffects(h);
});
test('readonly route conflict takes priority over an existing canon hold', async () => {
  const p = await startHold('top', () => response(bodyFor('STORY_CHAT_ROUTE_CHANGED', 'nested'), 409)), h = p.h;
  const before = h.api.basicChatContext(), count = h.requests.length;
  await p.check(); status(h, 'routeChanged');
  assert.equal(h.api.basicChatState.routeInvalidated, true); assert.equal(h.api.basicChatState.uncertain, false);
  assert.equal(h.api.basicChatState.uncertainKind, null); assert.equal(h.api.basicChatState.uncertainBody, null);
  assert.equal(h.api.isBasicChatContextCurrent(before), false); assert.equal(h.elements.chatInput.value, draft);
  assert.equal(h.elements.chatCheckMessages.hidden, true); assert.equal(h.elements.chatSendBtn.disabled, true); assert.equal(transcript(h), '');
  await h.submit(); await h.check(); assert.equal(h.requests.length, count + 1); assert.equal(generates(h).length, 1); noEffects(h);
});
const preGeneration = [['generate', approvalCode], ['read', sourceCode], ['read', approvalCode], ['create', sourceCode], ['create', approvalCode]];
for (const [stage, code] of preGeneration) test('no new source hold outside source POST generation: ' + stage + ' / ' + code, async () => {
  for (const shape of shapes) {
    const h = await harness({ sessions: stage !== 'create', intercept: request =>
      (stage === 'generate' && request.path.endsWith('/generate') || stage === 'read' && request.path.endsWith('/messages') ||
       stage === 'create' && request.path === '/api/v1/chat/sessions' && request.method === 'POST') ? response(bodyFor(code, shape), 409) : undefined });
    await h.submit(); status(h, 'canonPending');
    assert.equal(h.api.basicChatState.uncertain, false); assert.notEqual(h.api.basicChatState.uncertainKind, 'canon_changed');
    assert.equal(h.elements.chatInput.value, draft); assert.equal(h.elements.chatCheckMessages.hidden, true); assert.equal(h.elements.chatSendBtn.disabled, false);
    assert.equal(generates(h).length, stage === 'generate' ? 1 : 0); assert.equal(posts(h).length, stage === 'read' ? 0 : 1);
    const count = h.requests.length; await h.check(); assert.equal(h.requests.length, count); noEffects(h);
  }
});
for (const code of [sourceCode, approvalCode]) test('entry readonly canon rejection never creates a POST hold: ' + code, async () => {
  const h = await harness({ entry: true, intercept: request => request.path.endsWith('/messages') ? response(bodyFor(code, 'nested'), 409) : undefined });
  status(h, 'canonPending'); assert.equal(posts(h).length, 0); assert.equal(h.api.basicChatState.uncertain, false);
  assert.notEqual(h.api.basicChatState.uncertainKind, 'canon_changed'); assert.equal(h.elements.chatInput.value, draft);
  assert.equal(h.elements.chatCheckMessages.hidden, true); noEffects(h);
});
test('malformed JSON keeps failed 409 and ordinary unknown successful-response parsing separate', async () => {
  for (const httpStatus of [409, 200]) {
    const h = await harness({ intercept: request => request.path.endsWith('/generate') ?
      { ...response({}, httpStatus), json: async () => { throw new Error('Synthetic JSON parse failure'); } } : undefined });
    await h.submit(); status(h, httpStatus === 409 ? 'failed' : 'uncertain');
    assert.equal(h.api.basicChatState.uncertain, httpStatus === 200);
    if (httpStatus === 200) assert.equal(h.api.basicChatState.uncertainKind, 'generate');
    assert.notEqual(h.api.basicChatState.uncertainKind, 'canon_changed'); assert.equal(h.elements.chatInput.value, draft);
    assert.equal(generates(h).length, 1); noEffects(h);
  }
});
test('transport error routing keeps exact status and existing top-code precedence', async () => {
  const cases = [['409', bodyFor(sourceCode), 'failed', null],
    [409, { code: 'OTHER_CONFLICT', error: { code: sourceCode } }, 'failed', null],
    [409, { code: approvalCode, error: { code: sourceCode } }, 'canonPending', null],
    [409, { code: '', error: { code: sourceCode } }, 'canonOutcomeUnknown', 'canon_changed'],
    [409, { message: sourceCode }, 'failed', null], [500, bodyFor(sourceCode), 'uncertain', 'generate'],
    [408, bodyFor(sourceCode), 'uncertain', 'generate']];
  for (const [httpStatus, body, key, kind] of cases) {
    const h = await harness({ intercept: request => request.path.endsWith('/generate') ? response(body, httpStatus) : undefined });
    await h.submit(); status(h, key); assert.equal(h.api.basicChatState.uncertain, kind !== null);
    if (kind !== null) assert.equal(h.api.basicChatState.uncertainKind, kind);
    else assert.notEqual(h.api.basicChatState.uncertainKind, 'canon_changed');
    assert.equal(generates(h).length, 1); assert.equal(h.elements.chatInput.value, draft); noEffects(h);
  }
});
test('JSON-stage POST source uses submitted body and preserves a newer current draft', async () => {
  const gate = deferred();
  const h = await harness({ intercept: request => request.path.endsWith('/generate') ? { ...response({}, 409), json: () => gate.promise } : undefined });
  const pending = h.submit(); await settle(); assert.equal(generates(h).length, 1);
  await h.input(newerDraft); const height = h.elements.chatInput.style.height;
  await h.submit(); assert.equal(generates(h).length, 1);
  gate.resolve(bodyFor(sourceCode, 'nested')); await pending; await settle(); held(h, newerDraft);
  assert.equal(h.elements.chatInput.style.height, height); assert.equal(transcript(h).includes(newerDraft), false);
  const count = h.requests.length; await h.check(); held(h, newerDraft); await h.submit();
  assert.equal(h.requests.length, count + 1); assert.equal(generates(h).length, 1); noEffects(h);
});
test('ordinary 500 recovery retains matching-receipt and empty-history behavior', async () => {
  for (const result of ['matching', 'empty']) {
    let checking = false;
    const h = await harness({ intercept: request => request.path.endsWith('/generate') ? response({}, 500) :
      checking && request.path.endsWith('/messages') ? response(result === 'matching' ? matching : []) : undefined });
    await h.submit(); status(h, 'uncertain'); assert.equal(h.api.basicChatState.uncertainKind, 'generate');
    checking = true; const count = h.requests.length; await h.check();
    status(h, result === 'matching' ? 'receiptConfirmed' : 'stillUncertain', result === 'matching' ? '' : 'error');
    assert.equal(h.api.basicChatState.uncertain, result === 'empty'); assert.equal(h.elements.chatCheckMessages.hidden, result === 'matching');
    assert.equal(h.elements.chatInput.value, result === 'matching' ? '' : draft); assert.equal(h.requests.length, count + 1);
    await h.submit(); assert.equal(generates(h).length, 1); noEffects(h);
  }
});
test('ordinary uncertain create still recovers an owned session without generating', async () => {
  let recovering = false;
  const h = await harness({ sessions: false, intercept: request => request.path === '/api/v1/chat/sessions' ?
    request.method === 'POST' ? response({}, 500) : recovering ? response([{ id: sessionId, artistId, status: 'active', chatPersonaId: null }]) : undefined : undefined });
  await h.submit(); status(h, 'uncertain'); assert.equal(h.api.basicChatState.uncertainKind, 'create');
  recovering = true; await h.check(); status(h, '', '');
  assert.equal(h.api.basicChatState.uncertain, false); assert.equal(h.api.basicChatState.sessionId, sessionId);
  assert.equal(h.elements.chatCheckMessages.hidden, true); assert.equal(h.elements.chatSendBtn.disabled, false);
  assert.equal(h.elements.chatInput.value, draft); assert.equal(posts(h).length, 1); assert.equal(generates(h).length, 0); noEffects(h);
});
test('normal completed response keeps existing-session and create-then-generate settlement', async () => {
  for (const sessions of [true, false]) {
    const h = await harness({ sessions }); await h.submit(); status(h, 'sent', 'success');
    assert.equal(h.elements.chatInput.value, ''); assert.equal(h.api.basicChatState.uncertain, false);
    assert.equal(h.elements.chatThread.children.length, history.length + 2); assert.equal(h.elements.chatCheckMessages.hidden, true);
    assert.equal(posts(h).length, sessions ? 1 : 2); assert.equal(generates(h).length, 1);
    const count = h.requests.length; await h.submit(); await h.check(); await h.locale('ja-JP'); await h.account();
    assert.equal(h.requests.length, count); status(h, 'sent', 'success'); noEffects(h);
  }
});
test('fallback and unverified completed-shaped responses keep their existing outcome statuses', async () => {
  for (const generationStatus of ['fallback', undefined]) {
    const h = await harness({ intercept: request => request.path.endsWith('/generate') ? response({ ...completed, generationStatus }) : undefined });
    await h.submit(); status(h, generationStatus === 'fallback' ? 'fallbackReply' : 'replyUnverified', '');
    assert.equal(h.api.basicChatState.uncertain, false); assert.equal(h.elements.chatInput.value, '');
    assert.equal(h.elements.chatThread.children.length, history.length + 2); assert.equal(generates(h).length, 1); noEffects(h);
  }
});
for (const phase of ['generate', 'check']) for (const boundary of ['account', 'route']) for (const point of ['fetch', 'json'])
  test('retired response cannot replace current owner/route state: ' + phase + ' / ' + boundary + ' / ' + point, async () => {
    for (const result of phase === 'check' ? ['source', 'matching'] : ['source']) {
      const gate = deferred(); let checking = false;
      const payload = result === 'matching' ? matching : bodyFor(sourceCode, 'nested'), httpStatus = result === 'matching' ? 200 : 409;
      const delayed = point === 'json' ? { ...response({}, httpStatus), json: () => gate.promise } : gate.promise;
      const h = await harness({ intercept: request => {
        if (request.headers?.Authorization?.includes('synthetic-token-b')) return undefined;
        if (request.path.endsWith('/generate')) return phase === 'generate' ? delayed : response(bodyFor(sourceCode), 409);
        if (checking && request.path.endsWith('/messages')) return delayed;
        return undefined;
      } });
      let pending;
      if (phase === 'generate') pending = h.submit();
      else { await h.submit(); held(h); checking = true; pending = h.check(); }
      await settle(); const before = h.api.basicChatContext(), pendingRequest = h.requests.at(-1);
      assert.equal(pendingRequest.path.endsWith(phase === 'generate' ? '/generate' : '/messages'), true);
      if (boundary === 'account') { await h.account('synthetic-user-b'); await h.input('Synthetic private B draft'); }
      else await h.route('?slug=' + slug + '&storyProgressId=' + changedProgressId);
      assert.equal(h.api.isBasicChatContextCurrent(before), false); assert.equal(pendingRequest.signal.aborted, true);
      const retired = snapshot(h);
      gate.resolve(point === 'json' ? payload : response(payload, httpStatus)); await pending; await settle();
      assert.deepEqual(snapshot(h), retired); assert.notEqual(retired.status, 'canonOutcomeUnknown');
      assert.equal(generates(h).length, 1);
      if (boundary === 'account') {
        assert.equal(h.api.basicChatState.accountKey, 'user:synthetic-user-b');
        assert.equal(transcript(h), 'Synthetic B-only history'); assert.equal(h.elements.chatInput.value, 'Synthetic private B draft');
      } else { status(h, 'routeChanged'); assert.equal(h.api.basicChatState.routeInvalidated, true); }
      noEffects(h);
    }
  });
test('invalid route retires a held attempt and prevents further synthetic requests', async () => {
  const { h } = await startHold(), count = h.requests.length, before = h.api.basicChatContext();
  await h.route('?slug=' + slug + '&storyProgressId=invalid'); status(h, 'routeRequestUnknown');
  assert.equal(h.api.isBasicChatContextCurrent(before), false); assert.equal(h.api.basicChatState.routeInvalidated, true);
  assert.equal(h.api.basicChatState.uncertain, false); assert.equal(h.elements.chatInput.value, draft);
  assert.equal(h.elements.chatCheckMessages.hidden, true); assert.equal(h.elements.chatSendBtn.disabled, true);
  await h.submit(); await h.check(); assert.equal(h.requests.length, count); assert.equal(generates(h).length, 1); noEffects(h);
});
test('synthetic 401 expiry follows the existing owner boundary instead of restoring an old hold', async () => {
  const p = await startHold('top', () => response({}, 401)), h = p.h, before = h.api.basicChatContext();
  await p.check(); status(h, 'login'); assert.equal(h.api.isBasicChatContextCurrent(before), false);
  assert.equal(h.api.basicChatState.accountKey, null); assert.equal(h.api.basicChatState.uncertain, false);
  assert.equal(h.api.basicChatState.uncertainKind, null); assert.equal(h.elements.chatInput.value, '');
  assert.equal(h.elements.chatCheckMessages.hidden, true); assert.equal(generates(h).length, 1); noEffects(h);
});
