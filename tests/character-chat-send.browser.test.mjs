import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const repo = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://chat-send.test';
const artistId = 'artist-public-1';
const sessionId = 'session-owned-1';
const progressId = '12345678-1234-4123-8123-123456789abc';
let browser;
const appSource = readFileSync(path.join(repo, 'app.js'), 'utf8');
const authStart = appSource.indexOf('const AUTH_STORAGE_KEY = "lumina_auth";');
const authEnd = appSource.indexOf('/* ═', authStart);
assert.ok(authStart >= 0 && authEnd > authStart, 'app auth storage functions are missing');
const authRuntime = appSource.slice(authStart, authEnd);

before(async () => {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' }),
  });
});
after(async () => browser?.close());

function message(id, senderType, body) {
  return { id, senderType, body, createdAt: '2026-09-29T00:00:00.000Z' };
}

const runtime = `
  window.LUMINA_API_BASE = '${origin}';
  window.LuminaStaticData = { characters: [], getChatTone: () => null };
  window.luminaI18n = { getRegionalLocale: () => window.testLocale || 'en-US' };
  let _refreshCompleted = null;
  ${authRuntime}
  async function refreshAuthOnce() {
    setAuth({ ...getAuth(), accessToken: 'refreshed-jwt' });
    return { accessToken: getAccessToken() };
  }
  async function apiFetch(path) { return path.includes('/chat/starter-prompts') ? window.mockStarterResponse || null : null; }
  function openAuthModal() { window.authOpened = true; }
  document.body.classList.remove('is-booting');
`;

async function openChat(options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width || 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(({ token, locale, starter }) => {
    if (token) localStorage.setItem('lumina_auth', JSON.stringify({ accessToken: token, user: { id: 'user-a' } }));
    else localStorage.removeItem('lumina_auth');
    window.testLocale = locale;
    window.mockStarterResponse = starter;
  }, { token: options.token === undefined ? 'mock-jwt' : options.token, locale: options.locale || 'en-US', starter: options.starter || null });
  const posts = [];
  const reads = [];
  const messages = options.messages || [];
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/v1/')) {
      const entry = { path: url.pathname, query: url.search, method: request.method(), headers: request.headers(), body: request.postDataJSON?.() };
      (entry.method === 'POST' ? posts : reads).push(entry);
      if (url.pathname === '/api/v1/artists') return route.fulfill({ json: options.artists ?? [{ id: artistId, slug: 'public-artist', status: 'active' }] });
      if (url.pathname === '/api/v1/chat/sessions' && entry.method === 'GET') {
        if (options.onSessions) return options.onSessions(route, entry);
        return route.fulfill({ json: options.sessions ?? [] });
      }
      if (url.pathname === '/api/v1/chat/sessions' && entry.method === 'POST') {
        if (options.onCreate) return options.onCreate(route, entry);
        return route.fulfill({ json: { id: 'session-new-1', artistId, status: 'active' } });
      }
      if (url.pathname === '/api/v1/chat/conversations') {
        if (options.onConversations) return options.onConversations(route, entry);
        return route.fulfill({ json: { items: [] } });
      }
      if (/^\/api\/v1\/chat\/sessions\/[^/]+\/messages$/.test(url.pathname)) {
        if (options.onMessages) return options.onMessages(route, entry);
        return route.fulfill({ json: messages });
      }
      if (url.pathname.endsWith('/generate')) {
        if (options.onGenerate) return options.onGenerate(route, { messages, entry });
        return route.fulfill({ json: {
          userMessage: message('user-new-1', 'user', entry.body.body),
          message: message('artist-new-1', 'artist', '<img src=x onerror=alert(1)>')
        } });
      }
      return route.fulfill({ status: 404, body: '' });
    }
    if (url.pathname === '/app.js') return route.fulfill({ body: runtime, contentType: 'text/javascript' });
    if (['/data/characters.js', '/data/character-chat-tones.js', '/cms-bootstrap.js', '/pages/premium-chat-support.js', '/pages/premium-chat-hub.js'].includes(url.pathname)) {
      return route.fulfill({ body: '', contentType: 'text/javascript' });
    }
    const files = {
      '/character-chat': options.flatPage ? 'character-chat.html' : 'character-chat/index.html',
      '/styles.css': 'styles.css',
      '/styles/character-chat.css': 'styles/character-chat.css',
      '/pages/character-chat.js': 'pages/character-chat.js'
    };
    const file = files[url.pathname];
    if (!file) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: await readFile(path.join(repo, file)), contentType: file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/character-chat${options.listMode ? '' : '?slug=public-artist'}${options.query || ''}`);
  await page.locator(options.listMode ? '#chatListItems' : '#chatInputForm').waitFor();
  return { page, context, posts, reads, messages, errors, close: () => context.close() };
}

test('empty drafts cannot send; logged-out drafts ask for login without creating a session', async () => {
  const view = await openChat({ token: null, flatPage: true });
  try {
    const { page, posts } = view;
    assert.equal(await page.locator('#chatSendBtn').isDisabled(), true);
    await page.locator('#chatInput').fill('   ');
    assert.equal(await page.locator('#chatSendBtn').isDisabled(), true);
    await page.locator('#chatInput').fill('Hello');
    assert.equal(await page.locator('#chatSendBtn').isEnabled(), true);
    await page.locator('#chatSendBtn').click();
    assert.equal(await page.evaluate(() => window.authOpened), true);
    assert.match(await page.locator('#chatSendStatus').innerText(), /Sign in/);
    assert.equal(posts.length, 0);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('a selected first greeting enables sending and displays the generated reply', async () => {
  const view = await openChat({ starter: { sets: [{ options: [
    { key: 'A', label: '무대의 여운 묻기', message: '오늘 무대에서 가장 오래 남은 순간은 뭐였어?' },
  ] }] } });
  try {
    const starter = view.page.locator('[data-chat-starter-choice]').first();
    await starter.waitFor();
    await starter.click();
    assert.ok((await view.page.locator('#chatInput').inputValue()).trim().length > 0);
    assert.equal(await view.page.locator('#chatSendBtn').isEnabled(), true);
    await view.page.locator('#chatSendBtn').click();
    await view.page.locator('#chatThread').getByText('<img src=x onerror=alert(1)>').waitFor();
    assert.equal(view.posts.filter((entry) => entry.path.endsWith('/generate')).length, 1);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('composer state follows all five locales without a reload', async () => {
  const view = await openChat({ token: null });
  try {
    await view.page.locator('#chatInput').fill('Hello');
    await view.page.locator('#chatSendBtn').click();
    for (const [locale, expected] of [
      ['ko-KR', '로그인'], ['en-US', 'Sign in'], ['ja-JP', 'ログイン'],
      ['zh-CN', '登录'], ['zh-Hant', '登入']
    ]) {
      await view.page.evaluate(value => {
        window.testLocale = value;
        window.dispatchEvent(new CustomEvent('lumina:localechange'));
      }, locale);
      assert.match(await view.page.locator('#chatSendStatus').innerText(), new RegExp(expected));
      assert.ok((await view.page.locator('#chatInput').getAttribute('placeholder')).length > 0);
    }
    assert.equal(view.posts.length, 0);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('owned basic session loads safe text and sends once with explicit valid story scope', async () => {
  let releaseGeneration;
  const gate = new Promise(resolve => { releaseGeneration = resolve; });
  const view = await openChat({
    query: `&sessionId=${sessionId}&storyProgressId=${progressId}`,
    sessions: [
      { id: 'other-artist', artistId: 'other', status: 'active', chatPersonaId: null },
      { id: sessionId, artistId, status: 'active', chatPersonaId: null }
    ],
    messages: [message('old-1', 'artist', '<svg onload=alert(1)>')],
    onGenerate: async (route, { entry }) => {
      await gate;
      return route.fulfill({ json: {
        userMessage: message('new-1', 'user', entry.body.body),
        message: message('new-2', 'artist', '<img src=x onerror=alert(1)>')
      } });
    }
  });
  try {
    const { page, posts } = view;
    await page.locator('#chatThread .dm-bubble-text').first().waitFor();
    assert.equal(await page.locator('#chatThread svg, #chatThread img').count(), 0);
    await page.locator('#chatInput').fill('  Hello  ');
    await page.locator('#chatSendBtn').click();
    await page.waitForFunction(() => document.querySelector('#chatSendStatus')?.textContent?.includes('Waiting'));
    await page.evaluate(() => document.querySelector('#chatInputForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(await page.locator('#chatSendBtn').isDisabled(), true);
    releaseGeneration();
    await page.waitForFunction(() => document.querySelector('#chatSendStatus')?.textContent === 'Message sent.');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].path, `/api/v1/chat/sessions/${sessionId}/generate`);
    assert.deepEqual(posts[0].body, { body: 'Hello', storyProgressId: progressId });
    assert.ok(view.reads.some(read => read.path === `/api/v1/chat/sessions/${sessionId}/messages` &&
      read.query === `?storyProgressId=${progressId}`));
    assert.equal(posts[0].headers.authorization, 'Bearer mock-jwt');
    assert.equal(await page.locator('#chatThread .dm-bubble-text').count(), 3);
    assert.equal(await page.locator('#chatThread img, #chatThread svg').count(), 0);
    assert.match(await page.locator('#chatThread').innerText(), /<img src=x onerror=alert\(1\)>/);
    assert.equal(await page.locator('#chatInput').inputValue(), '');
    assert.deepEqual(view.errors, []);
  } finally { releaseGeneration(); await view.close(); }
});

test('new session is created on send only and invalid story scope is omitted', async () => {
  const view = await openChat({ query: '&storyProgressId=not-a-uuid', messages: [message('opening-1', 'artist', 'Welcome')] });
  try {
    const { page, posts } = view;
    await page.locator('#chatInput').fill('Hi');
    assert.equal(posts.length, 0);
    await page.locator('#chatSendBtn').click();
    await page.waitForFunction(() => document.querySelector('#chatSendStatus')?.textContent === 'Message sent.');
    assert.deepEqual(posts.map(post => post.path), ['/api/v1/chat/sessions', '/api/v1/chat/sessions/session-new-1/generate']);
    assert.deepEqual(posts[0].body, { artistId });
    assert.deepEqual(posts[1].body, { body: 'Hi' });
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('foreign or premium session URL never creates or generates', async () => {
  const view = await openChat({ query: '&sessionId=foreign', sessions: [{ id: 'foreign', artistId, status: 'active', chatPersonaId: 'premium-persona' }] });
  try {
    await view.page.locator('#chatInput').fill('Hello');
    await view.page.locator('#chatSendBtn').click();
    await view.page.waitForFunction(() => document.querySelector('#chatSendStatus')?.textContent?.includes('not your basic chat'));
    assert.equal(view.posts.length, 0);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('unpublished artist cannot start a session even from a direct URL', async () => {
  const view = await openChat({ artists: [{ id: artistId, slug: 'public-artist', status: 'planned' }] });
  try {
    await view.page.locator('#chatInput').fill('Hello');
    await view.page.locator('#chatSendBtn').click();
    await view.page.waitForFunction(() => document.querySelector('#chatSendStatus')?.textContent?.includes('public artist'));
    assert.equal(view.posts.length, 0);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('definite generation rejection shows an error and permits a deliberate retry', async () => {
  let attempts = 0;
  const view = await openChat({
    sessions: [{ id: sessionId, artistId, status: 'active', chatPersonaId: null }],
    onGenerate: (route, { entry }) => {
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 429, json: { message: 'cooldown' } });
      return route.fulfill({ json: {
        userMessage: message('retry-1', 'user', entry.body.body),
        message: message('retry-2', 'artist', 'Hello back')
      } });
    }
  });
  try {
    await view.page.locator('#chatInput').fill('Hello');
    await view.page.locator('#chatSendBtn').click();
    await view.page.waitForFunction(() => document.querySelector('#chatSendStatus')?.textContent?.includes('not sent'));
    assert.equal(await view.page.locator('#chatSendBtn').isEnabled(), true);
    assert.equal(await view.page.locator('#chatCheckMessages').isHidden(), true);
    await view.page.locator('#chatSendBtn').click();
    await view.page.waitForFunction(() => document.querySelector('#chatSendStatus')?.textContent === 'Message sent.');
    assert.equal(view.posts.length, 2);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('expired access token refreshes once after a rejected request without duplicating a message', async () => {
  let attempts = 0;
  const view = await openChat({ sessions: [{ id: sessionId, artistId, status: 'active', chatPersonaId: null }],
    onGenerate: (route, { entry }) => {
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 401, json: { message: 'expired' } });
      return route.fulfill({ json: {
        userMessage: message('refresh-user', 'user', entry.body.body),
        message: message('refresh-artist', 'artist', 'Welcome back')
      } });
    }
  });
  try {
    await view.page.locator('#chatInput').fill('Remember us?');
    await view.page.locator('#chatSendBtn').click();
    await view.page.waitForFunction(() => document.querySelector('#chatSendStatus')?.textContent === 'Message sent.');
    assert.equal(attempts, 2);
    assert.deepEqual(view.posts.map(post => post.headers.authorization), ['Bearer mock-jwt', 'Bearer refreshed-jwt']);
    assert.equal(await view.page.locator('#chatThread .dm-bubble-user').count(), 1);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('changed story route explains the scope rejection without claiming the message was sent', async () => {
  const view = await openChat({ query: `&storyProgressId=${progressId}`,
    sessions: [{ id: sessionId, artistId, status: 'active', chatPersonaId: null }],
    onGenerate: route => route.fulfill({ status: 409, json: { code: 'STORY_CHAT_ROUTE_CHANGED' } })
  });
  try {
    await view.page.locator('#chatInput').fill('Our old route');
    await view.page.locator('#chatSendBtn').click();
    await view.page.waitForFunction(() => document.querySelector('#chatSendStatus')?.textContent?.includes('route changed'));
    assert.equal(view.posts.length, 1);
    assert.equal(await view.page.locator('#chatInput').inputValue(), 'Our old route');
    assert.equal(await view.page.locator('#chatThread .dm-bubble-user').count(), 0);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('stale story route does not display an older session transcript on load', async () => {
  const view = await openChat({
    query: `&sessionId=${sessionId}&storyProgressId=${progressId}`,
    sessions: [{ id: sessionId, artistId, status: 'active', chatPersonaId: null }],
    onMessages: route => route.fulfill({ status: 409, json: { code: 'STORY_CHAT_ROUTE_CHANGED' } })
  });
  try {
    await view.page.waitForFunction(() => document.querySelector('#chatSendStatus')?.textContent?.includes('route changed'));
    assert.equal(await view.page.locator('#chatThread .dm-bubble-text').count(), 0);
    assert.ok(view.reads.some(read => read.path === `/api/v1/chat/sessions/${sessionId}/messages` &&
      read.query === `?storyProgressId=${progressId}`));
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

for (const [locale, copy] of [
  ['ko-KR', '스토리 추억의 확인 기준이 바뀌었어요. 현재 기준으로 다시 보내 주세요.'],
  ['en-US', 'Your story memory evidence changed. Please send again using the current evidence.'],
  ['ja-JP', '物語の思い出の確認基準が変わりました。現在の基準でもう一度送信してください。'],
  ['zh-CN', '故事回忆的确认依据已变更，请按当前依据重新发送。'],
  ['zh-Hant', '故事回憶的確認依據已變更，請依目前依據重新傳送。'],
]) {
  test(`memory evidence conflict in ${locale} preserves the draft/history and requires manual retry`, async () => {
    const view = await openChat({ locale, query: `&storyProgressId=${progressId}`,
      sessions: [{ id: sessionId, artistId, status: 'active', chatPersonaId: null }],
      messages: [message('earlier-message', 'artist', 'Earlier conversation remains visible')],
      onGenerate: route => route.fulfill({ status: 409, json: locale === 'en-US'
        ? { error: { code: 'STORY_CHAT_MEMORY_CHANGED' } }
        : { code: 'STORY_CHAT_MEMORY_CHANGED' } }),
    });
    try {
      await view.page.locator('#chatThread .dm-bubble-text').filter({ hasText: 'Earlier conversation remains visible' }).waitFor();
      await view.page.locator('#chatInput').fill('Our current memory');
      await view.page.locator('#chatSendBtn').click();
      await view.page.waitForFunction(expected => document.querySelector('#chatSendStatus')?.textContent === expected, copy);
      assert.equal(view.posts.length, 1);
      assert.equal(view.posts[0].body.storyProgressId, progressId);
      assert.equal(await view.page.locator('#chatInput').inputValue(), 'Our current memory');
      assert.equal(await view.page.locator('#chatThread .dm-bubble-user').count(), 0);
      assert.equal(await view.page.locator('#chatThread .dm-bubble-text').filter({ hasText: 'Earlier conversation remains visible' }).count(), 1);
      await view.page.locator('#chatSendBtn').click();
      await view.page.waitForFunction(expected => document.querySelector('#chatSendStatus')?.textContent === expected, copy);
      assert.equal(view.posts.length, 2);
      assert.deepEqual(view.errors, []);
    } finally { await view.close(); }
  });
}

test('ambiguous generation failure locks resends and checks history with GET only', async () => {
  const view = await openChat({
    sessions: [{ id: sessionId, artistId, status: 'active', chatPersonaId: null }],
    onGenerate: route => route.abort('failed')
  });
  try {
    const { page, posts, messages } = view;
    await page.locator('#chatInput').fill('Could this arrive?');
    await page.locator('#chatSendBtn').click();
    await page.waitForFunction(() => document.querySelector('#chatCheckMessages')?.hidden === false);
    assert.equal(await page.locator('#chatSendBtn').isDisabled(), true);
    await page.evaluate(() => document.querySelector('#chatInputForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(posts.length, 1);
    await page.locator('#chatCheckMessages').click();
    await page.waitForFunction(() => document.querySelector('#chatSendStatus')?.textContent?.includes('still unknown'));
    assert.equal(await page.locator('#chatSendBtn').isDisabled(), true);
    assert.equal(posts.length, 1);
    messages.push(message('reconciled-1', 'user', 'Could this arrive?'), message('reconciled-2', 'artist', 'Yes'));
    await page.locator('#chatCheckMessages').click();
    await page.waitForFunction(() => document.querySelector('#chatSendStatus')?.textContent === 'Message sent.');
    assert.equal(posts.length, 1);
    assert.equal(await page.locator('#chatInput').inputValue(), '');
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('uncertain session creation is reconciled before any generation', async () => {
  const sessions = [];
  const view = await openChat({ sessions, onCreate: route => route.abort('failed') });
  try {
    const { page, posts } = view;
    await page.locator('#chatInput').fill('Hello');
    await page.locator('#chatSendBtn').click();
    await page.waitForFunction(() => document.querySelector('#chatCheckMessages')?.hidden === false);
    assert.deepEqual(posts.map(post => post.path), ['/api/v1/chat/sessions']);
    sessions.push({ id: sessionId, artistId, status: 'active', chatPersonaId: null });
    await page.locator('#chatCheckMessages').click();
    await page.waitForFunction(() => document.querySelector('#chatCheckMessages')?.hidden === true);
    assert.equal(await page.locator('#chatSendBtn').isEnabled(), true);
    assert.equal(posts.length, 1);
    await page.locator('#chatSendBtn').click();
    await page.waitForFunction(() => document.querySelector('#chatSendStatus')?.textContent === 'Message sent.');
    assert.deepEqual(posts.map(post => post.path), ['/api/v1/chat/sessions', `/api/v1/chat/sessions/${sessionId}/generate`]);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('same-tab account swap clears old history and draft before using the new session', async () => {
  const view = await openChat({
    onSessions: (route, entry) => route.fulfill({ json: [{
      id: entry.headers.authorization === 'Bearer user-b-jwt' ? 'session-b' : sessionId,
      artistId, status: 'active', chatPersonaId: null
    }] }),
    onMessages: (route, entry) => route.fulfill({ json: [message(
      entry.path.includes('session-b') ? 'message-b' : 'message-a', 'artist',
      entry.path.includes('session-b') ? 'Private B history' : 'Private A history'
    )] })
  });
  try {
    const { page, posts } = view;
    await page.getByText('Private A history').waitFor();
    await page.locator('#chatInput').fill('A private draft');
    const cleared = await page.evaluate(() => {
      setAuth({ accessToken: 'user-b-jwt', user: { id: 'user-b' } });
      return { history: document.querySelector('#chatThread').textContent, draft: document.querySelector('#chatInput').value };
    });
    assert.equal(cleared.history, '');
    assert.equal(cleared.draft, '');
    await page.getByText('Private B history').waitFor();
    assert.doesNotMatch(await page.locator('#chatThread').innerText(), /Private A/);
    await page.locator('#chatInput').fill('B message');
    await page.locator('#chatSendBtn').click();
    await page.waitForFunction(() => document.querySelector('#chatSendStatus')?.textContent === 'Message sent.');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].path, '/api/v1/chat/sessions/session-b/generate');
    assert.equal(posts[0].headers.authorization, 'Bearer user-b-jwt');
    await page.evaluate(() => window.dispatchEvent(new Event('lumina:auth-expired')));
    assert.equal(await page.locator('#chatThread .dm-bubble').count(), 0);
    assert.equal(await page.locator('#chatInput').inputValue(), '');
    await page.locator('#chatInput').fill('Do not send');
    await page.locator('#chatSendBtn').click();
    assert.equal(posts.length, 1);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('cross-tab storage change clears the visible account history', async () => {
  const view = await openChat({
    onSessions: (route, entry) => route.fulfill({ json: [{
      id: entry.headers.authorization === 'Bearer user-b-jwt' ? 'session-b' : sessionId,
      artistId, status: 'active', chatPersonaId: null
    }] }),
    onMessages: (route, entry) => route.fulfill({ json: [message(
      entry.path.includes('session-b') ? 'message-b' : 'message-a', 'artist',
      entry.path.includes('session-b') ? 'B only' : 'A only'
    )] })
  });
  try {
    await view.page.getByText('A only').waitFor();
    const second = await view.context.newPage();
    await second.goto(`${origin}/character-chat?slug=public-artist`);
    await second.evaluate(() => setAuth({ accessToken: 'user-b-jwt', user: { id: 'user-b' } }));
    await view.page.getByText('B only').waitFor();
    assert.doesNotMatch(await view.page.locator('#chatThread').innerText(), /A only/);
    await second.evaluate(() => clearAuth());
    await view.page.waitForFunction(() => document.querySelector('#chatThread')?.children.length === 0);
    assert.equal(view.posts.length, 0);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('late old-account generation response cannot render or choose the new account session', async () => {
  let releaseOld;
  let oldStarted;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  const started = new Promise(resolve => { oldStarted = resolve; });
  const view = await openChat({
    onSessions: (route, entry) => route.fulfill({ json: [{
      id: entry.headers.authorization === 'Bearer user-b-jwt' ? 'session-b' : sessionId,
      artistId, status: 'active', chatPersonaId: null
    }] }),
    onMessages: (route, entry) => route.fulfill({ json: [message(
      entry.path.includes('session-b') ? 'message-b' : 'message-a', 'artist',
      entry.path.includes('session-b') ? 'B history' : 'A history'
    )] }),
    onGenerate: async (route, { entry }) => {
      if (entry.path.includes(sessionId)) {
        oldStarted();
        await oldGate;
        return route.fulfill({ json: {
          userMessage: message('late-user-a', 'user', entry.body.body),
          message: message('late-artist-a', 'artist', 'Late A secret')
        } }).catch(() => {});
      }
      return route.fulfill({ json: {
        userMessage: message('user-b', 'user', entry.body.body),
        message: message('artist-b', 'artist', 'B reply')
      } });
    }
  });
  try {
    const { page, posts } = view;
    await page.getByText('A history').waitFor();
    await page.locator('#chatInput').fill('A pending message');
    await page.locator('#chatSendBtn').click();
    await started;
    await page.evaluate(() => setAuth({ accessToken: 'user-b-jwt', user: { id: 'user-b' } }));
    releaseOld();
    await page.getByText('B history').waitFor();
    assert.doesNotMatch(await page.locator('#chatThread').innerText(), /A history|Late A secret|A pending message/);
    await page.locator('#chatInput').fill('B new message');
    await page.locator('#chatSendBtn').click();
    await page.waitForFunction(() => document.querySelector('#chatSendStatus')?.textContent === 'Message sent.');
    assert.deepEqual(posts.map(post => post.path), [
      `/api/v1/chat/sessions/${sessionId}/generate`, '/api/v1/chat/sessions/session-b/generate'
    ]);
    assert.equal(posts[1].headers.authorization, 'Bearer user-b-jwt');
    assert.doesNotMatch(await page.locator('#chatThread').innerText(), /Late A secret/);
    assert.deepEqual(view.errors, []);
  } finally { releaseOld(); await view.close(); }
});

test('conversation list drops old previews and ignores a late old-account list response', async () => {
  let releaseArchive;
  let archiveStarted;
  const gate = new Promise(resolve => { releaseArchive = resolve; });
  const started = new Promise(resolve => { archiveStarted = resolve; });
  const item = (id, preview) => ({ id, status: 'active', artist: { slug: 'public-artist', displayName: 'Public Artist' }, lastMessage: { bodyPreview: preview } });
  const view = await openChat({ listMode: true, onConversations: async (route, entry) => {
    if (entry.headers.authorization === 'Bearer user-a-jwt' && entry.query.includes('box=archive')) {
      archiveStarted();
      await gate;
      return route.fulfill({ json: { items: [item('session-a', 'Late A preview')] } }).catch(() => {});
    }
    return route.fulfill({ json: { items: [entry.headers.authorization === 'Bearer user-b-jwt'
      ? item('session-b', 'B preview') : item('session-a', 'A preview')] } });
  }, token: 'user-a-jwt' });
  try {
    await view.page.getByText('A preview').waitFor();
    await view.page.locator('[data-chat-conversation-box="archive"]').click();
    await started;
    const cleared = await view.page.evaluate(() => {
      setAuth({ accessToken: 'user-b-jwt', user: { id: 'user-b' } });
      return document.querySelector('#chatListItems').textContent;
    });
    assert.equal(cleared, '');
    releaseArchive();
    await view.page.getByText('B preview').waitFor();
    assert.doesNotMatch(await view.page.locator('#chatListItems').innerText(), /A preview|Late A preview/);
    assert.equal(view.posts.length, 0);
    assert.deepEqual(view.errors, []);
  } finally { releaseArchive(); await view.close(); }
});

test('passive JWT expiry clears visible history without another API request', async () => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 4 })).toString('base64url');
  const token = `header.${payload}.signature`;
  const view = await openChat({ token,
    sessions: [{ id: sessionId, artistId, status: 'active', chatPersonaId: null }],
    messages: [message('before-expiry', 'artist', 'Private until expiry')]
  });
  try {
    await view.page.getByText('Private until expiry').waitFor();
    await view.page.locator('#chatInput').fill('Private draft');
    const readsBefore = view.reads.length;
    await view.page.waitForFunction(() => document.querySelector('#chatThread')?.children.length === 0, null, { timeout: 6000 });
    assert.equal(await view.page.locator('#chatInput').inputValue(), '');
    assert.match(await view.page.locator('#chatSendStatus').innerText(), /Sign in/);
    assert.equal(view.reads.length, readsBefore);
    assert.equal(view.posts.length, 0);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('late premium room status from an old account cannot replace the new account panel', async () => {
  let releaseOld;
  let oldStarted;
  let oldFulfilled;
  const gate = new Promise(resolve => { releaseOld = resolve; });
  const started = new Promise(resolve => { oldStarted = resolve; });
  const fulfilled = new Promise(resolve => { oldFulfilled = resolve; });
  const view = await openChat({ onConversations: async (route, entry) => {
    if (entry.headers.authorization === 'Bearer mock-jwt' && entry.query.includes('box=all')) {
      oldStarted();
      await gate;
      await route.fulfill({ json: { items: [{ id: 'premium-a', status: 'reported', artist: { slug: 'public-artist' } }] } });
      oldFulfilled();
      return;
    }
    return route.fulfill({ json: { items: [] } });
  } });
  try {
    await started;
    await view.page.evaluate(() => setAuth({ accessToken: 'user-b-jwt', user: { id: 'user-b' } }));
    await view.page.waitForFunction(() => document.querySelector('#premiumChatRoomStatusTitle')?.textContent?.includes('오픈 예정'));
    releaseOld();
    await fulfilled;
    await view.page.waitForTimeout(50);
    assert.doesNotMatch(await view.page.locator('#premiumChatRoomStatusTitle').innerText(), /일시정지/);
    assert.deepEqual(view.errors, []);
  } finally { releaseOld(); await view.close(); }
});

test('a stale archive button cannot post an old session after auth storage changes', async () => {
  const view = await openChat({ listMode: true, onConversations: (route, entry) => route.fulfill({ json: { items: [{
    id: entry.headers.authorization === 'Bearer user-b-jwt' ? 'session-b' : 'session-a',
    status: 'active', artist: { slug: 'public-artist', displayName: 'Public Artist' },
    lastMessage: { bodyPreview: entry.headers.authorization === 'Bearer user-b-jwt' ? 'B preview' : 'A preview' }
  }] } }) });
  try {
    await view.page.getByText('A preview').waitFor();
    await view.page.evaluate(() => {
      localStorage.setItem('lumina_auth', JSON.stringify({ accessToken: 'user-b-jwt', user: { id: 'user-b' } }));
      document.querySelector('[data-chat-conversation-action]').click();
    });
    await view.page.getByText('B preview').waitFor();
    assert.equal(view.posts.length, 0);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});

test('JWT subject change clears a session even when stored user metadata is stale', async () => {
  const jwt = sub => `header.${Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.signature`;
  const tokenA = jwt('user-a');
  const tokenB = jwt('user-b');
  const view = await openChat({ token: tokenA,
    onSessions: (route, entry) => route.fulfill({ json: [{
      id: entry.headers.authorization === `Bearer ${tokenB}` ? 'session-b' : sessionId,
      artistId, status: 'active', chatPersonaId: null
    }] }),
    onMessages: (route, entry) => route.fulfill({ json: [message(
      entry.path.includes('session-b') ? 'message-b' : 'message-a', 'artist',
      entry.path.includes('session-b') ? 'B subject history' : 'A subject history'
    )] })
  });
  try {
    await view.page.getByText('A subject history').waitFor();
    const cleared = await view.page.evaluate(nextToken => {
      setAuth({ accessToken: nextToken, user: { id: 'user-a' } });
      return document.querySelector('#chatThread').textContent;
    }, tokenB);
    assert.equal(cleared, '');
    await view.page.getByText('B subject history').waitFor();
    await view.page.locator('#chatInput').fill('B only');
    await view.page.locator('#chatSendBtn').click();
    await view.page.waitForFunction(() => document.querySelector('#chatSendStatus')?.textContent === 'Message sent.');
    assert.equal(view.posts.length, 1);
    assert.equal(view.posts[0].path, '/api/v1/chat/sessions/session-b/generate');
    assert.equal(view.posts[0].headers.authorization, `Bearer ${tokenB}`);
    assert.deepEqual(view.errors, []);
  } finally { await view.close(); }
});
