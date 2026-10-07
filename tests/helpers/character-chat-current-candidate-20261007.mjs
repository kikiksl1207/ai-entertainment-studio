import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const overrideSource = process.env.CHAT_ROUTE_UNIT_SOURCE;
const expectedSourceSha = process.env.CHAT_ROUTE_UNIT_SOURCE_SHA256;
if (overrideSource !== undefined) {
  assert(overrideSource.length > 0, 'Explicit source selector must not be empty');
  assert.match(expectedSourceSha || '', /^[a-f0-9]{64}$/i, 'Explicit source selector requires its matching SHA256');
} else {
  assert.equal(expectedSourceSha, undefined, 'Source SHA selector requires an explicit source selector');
}
const sourcePath = overrideSource || fileURLToPath(new URL('../../pages/character-chat.js', import.meta.url));
const sourceBytes = readFileSync(sourcePath);
if (overrideSource !== undefined) {
  assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), expectedSourceSha.toLowerCase(), 'Selected source SHA256 mismatch');
}
const source = sourceBytes.toString('utf8');
const marker = '  if (document.readyState === "loading") {';
assert.equal(source.split(marker).length, 2);
const expose = `  window.__minimalRouteUnit = {
    basicChatState, basicChatContext, isBasicChatContextCurrent, isConversationListContextCurrent,
    bindBasicChatComposer, readBasicMessages, checkBasicChatMessages, renderBasicMessages,
    applyStarterResponse, updateBasicSendButton
  };
`;

export const draft = 'Keep this synthetic unsent draft';
export const history = [{ id: 'old-message', senderType: 'artist', body: 'Synthetic earlier route' }];
export const sessionId = 'owned-session';
export const progressId = '12345678-1234-4123-8123-123456789abc';
export const success = {
  userMessage: { id: 'new-user', senderType: 'user', body: draft },
  message: { id: 'new-artist', senderType: 'artist', body: 'Synthetic reply' },
};
export function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
export function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

export async function harness({ generate = () => response(success), readHistory = () => response(history) } = {}) {
  function element() {
    const listeners = new Map();
    return {
      children: [], value: '', style: {}, dataset: {}, hidden: false, textContent: '',
      scrollHeight: 60, scrollTop: 0,
      setAttribute(key, value) { this[key] = value; },
      append(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
      addEventListener(name, callback) {
        const list = listeners.get(name) || []; list.push(callback); listeners.set(name, list);
      },
      async dispatch(name) {
        const callbacks = listeners.get(name) || [];
        assert.equal(callbacks.length, 1, `Expected one actual ${name} handler`);
        for (const callback of callbacks) await callback({ preventDefault() {} });
      },
    };
  }
  const elements = Object.fromEntries(['chatInput', 'chatSendBtn', 'chatInputForm', 'chatSendStatus',
    'chatCheckMessages', 'chatThread', 'chatWelcomeBubble', 'chatWelcomeText', 'chatWelcomeTime', 'chatStage']
    .map(id => [id, element()]));
  elements.chatCheckMessages.hidden = true;
  const requests = [], accessoryRequests = [];
  const context = {
    window: {
      LUMINA_API_BASE: 'https://unit.invalid',
      location: { search: `?storyProgressId=${progressId}&sessionId=${sessionId}`, pathname: '/character-chat', hostname: 'unit.invalid' },
      getAccessToken: () => 'synthetic-non-jwt',
      getAuth: () => ({ user: { id: 'unit-user' }, accessToken: 'synthetic-non-jwt' }),
      luminaI18n: { getRegionalLocale: () => 'en-US' },
      addEventListener() {},
    },
    document: {
      readyState: 'loading', hidden: false, addEventListener() {},
      getElementById: id => elements[id] || null,
      createElement: element, querySelectorAll: () => [], querySelector: () => null,
    },
    URLSearchParams, AbortController, atob,
    setTimeout: () => 1, clearTimeout() {},
    async fetch(url, options = {}) {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://unit.invalid');
      const method = options.method || 'GET';
      const request = { method, path: parsed.pathname + parsed.search, signal: options.signal };
      if (parsed.pathname === '/api/v1/chat/premium-support-contract') {
        accessoryRequests.push(request); return response({ policy: { walletMutationEnabled: false } });
      }
      if (parsed.pathname === '/api/v1/chat/conversations') {
        accessoryRequests.push(request); return response({ items: [] });
      }
      requests.push(request);
      if (parsed.pathname === '/api/v1/artists' && method === 'GET') {
        return response([{ id: 'public-artist', slug: 'synthetic-artist', status: 'active' }]);
      }
      if (parsed.pathname === '/api/v1/chat/sessions' && method === 'GET') {
        return response([{ id: sessionId, artistId: 'public-artist', status: 'active', chatPersonaId: null }]);
      }
      if (parsed.pathname === `/api/v1/chat/sessions/${sessionId}/messages` && method === 'GET') {
        assert.equal(parsed.searchParams.get('storyProgressId'), progressId);
        return readHistory(request);
      }
      if (parsed.pathname === `/api/v1/chat/sessions/${sessionId}/generate` && method === 'POST') {
        const body = JSON.parse(options.body);
        assert.deepEqual(body, { body: draft, storyProgressId: progressId });
        return generate(request);
      }
      throw new Error(`Unexpected synthetic VM request: ${method} ${request.path}`);
    },
  };
  // Expose existing closures before the unchanged DOM-ready branch; do not replace functions.
  vm.runInNewContext(source.replace(marker, () => expose + marker), context, { filename: sourcePath, timeout: 3000 });
  const api = context.window.__minimalRouteUnit;
  api.basicChatState.accountKey = 'user:unit-user';
  api.basicChatState.epoch = 7;
  api.basicChatState.sessionId = sessionId;
  api.basicChatState.artistId = 'public-artist';
  api.renderBasicMessages(history);
  elements.chatInput.value = draft;
  api.bindBasicChatComposer('synthetic-artist');
  for (let tick = 0; tick < 12; tick++) await Promise.resolve();
  return {
    api, elements, requests, accessoryRequests,
    submit: () => elements.chatInputForm.dispatch('submit'),
    check: () => elements.chatCheckMessages.dispatch('click'),
  };
}
