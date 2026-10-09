import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require(process.env.CHAT_CATALOG_TYPESCRIPT || '../../server/node_modules/typescript');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function selected(prefix, fallback) {
  const file = process.env[prefix + '_SOURCE'], expected = process.env[prefix + '_SHA'];
  assert.ok(file === undefined ? expected === undefined : file && /^[a-f0-9]{64}$/.test(expected || ''), 'Explicit source selectors require a matching SHA pair');
  const filename = file || fileURLToPath(new URL(fallback, import.meta.url)), bytes = readFileSync(filename);
  if (file !== undefined) assert.equal(sha(bytes), expected, 'Frozen source SHA pair');
  const source = bytes.toString('utf8'), ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0);
  return { filename, bytes, source, ast };
}
const page = selected('CHAT_CATALOG_PAGE', '../../pages/character-chat.js');
const app = selected('CHAT_CATALOG_APP', '../../app.js');
export const sourcePins = { page: sha(page.bytes), app: sha(app.bytes) };
function find(input, predicate, label) {
  const matches = [];
  function visit(node) { if (predicate(node)) matches.push(node); ts.forEachChild(node, visit); }
  visit(input.ast); assert.equal(matches.length, 1, label); return matches[0];
}
const declaration = name => find(page, node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(page.ast) === name), name).getText(page.ast);
const fn = (input, name) => find(input, node => ts.isFunctionDeclaration(node) && node.name?.text === name, name).getText(input.ast);
const pageFunctions = ['basicChatTokenPayload', 'chatAuthToken', 'basicChatAccountKey', 'basicChatContext',
  'basicChatStoryRouteScope', 'isBasicChatRouteScopeCurrent', 'syncBasicChatRouteScope', 'assertBasicChatRouteScope',
  'assertBasicChatContext', 'syncBasicChatAccount', 'scheduleBasicChatExpiry', 'basicChatTokenExpiry', 'setConversationStatus',
  'basicChatRequest', 'basicChatRouteStatusKey',
  'isBasicChatContextCurrent', 'isConversationListContextCurrent', 'basicChatCopy', 'fetchCharacterCatalog',
  'fetchStarterPrompts', 'applyStarterResponse', 'setText', 'setFallback', 'showStarterCard', 'renderWelcomeBubble',
  'getCharacterTone', 'buildStarterOptions', 'renderStarterOptions', 'shouldPreferLocalStarters', 'applyChatEmptyForSlug',
  'updateBasicSendButton', 'setBasicChatBusy', 'showBasicChatCheck', 'setBasicChatStatus',
  'renderBasicMessages', 'basicChatMessageElement', 'invalidateBasicStoryRoute'];
let entryGuard = '';
const guards = [];
function guardVisit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'isCharacterRoomEntryContextCurrent') guards.push(node); ts.forEachChild(node, guardVisit); }
guardVisit(page.ast); assert.ok(guards.length <= 1);
if (guards.length) entryGuard = guards[0].getText(page.ast);
const init = find(page, node => ts.isFunctionDeclaration(node) && node.name?.text === 'init', 'Actual init');
const start = init.body.statements.findIndex(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(item => item.name.getText(page.ast) === 'entryContext'));
assert.ok(start >= 0);
const suffix = init.body.statements.slice(start).map(node => node.getText(page.ast)).join('\n');
const callback = find(page, node => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
  && node.expression.name.text === 'then' && ts.isCallExpression(node.expression.expression)
  && node.expression.expression.expression.getText(page.ast) === 'fetchCharacterCatalog', 'Actual catalog callback').arguments[0].getText(page.ast);
const last = init.body.statements.at(-1);
assert.ok(ts.isIfStatement(last) && last.getText(page.ast).includes('applyStarterResponse'));
const actual = [declaration('CHAT_API_BASE'), declaration('basicChatState'), declaration('conversationListState'), declaration('STARTER_MAX'), declaration('BASIC_CHAT_COPY'), declaration('STARTER_FALLBACK_OPTIONS'),
  ...pageFunctions.map(name => fn(page, name)), entryGuard,
  fn(app, 'apiFetch'), fn(app, 'authRequestSession'), fn(app, 'authRequestSessionCurrent'),
  `async function runRoomEntry(slug){${suffix}}`,
  `function catalogCallbackFor(slug,entryContext){return (${callback});}`,
  `function applyFinalStarter(slug,entryContext,data){${last.getText(page.ast)}}`,
  `globalThis.actualApi={basicChatState,basicChatContext,isBasicChatContextCurrent,isConversationListContextCurrent,
    basicChatStoryRouteScope,assertBasicChatRouteScope,
    fetchCharacterCatalog,fetchStarterPrompts,runRoomEntry,catalogCallbackFor,applyFinalStarter,
    invalidateBasicStoryRoute,renderWelcomeBubble};`,
].join('\n');
export const actualSourceGraph = { pageFunctions, newEntryGuard: guards.length === 1,
  appFunctions: ['apiFetch', 'authRequestSession', 'authRequestSessionCurrent'],
  initSuffix: suffix, catalogCallback: callback, finalStarterCondition: last.getText(page.ast) };
export const plain = value => JSON.parse(JSON.stringify(value));
export function deferred() {
  let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
export const SLUG = 'synthetic-catalog-artist';
export const DRAFT = 'Synthetic unsent catalog draft';
export function catalog() {
  return { artist: { id: 'RAM_PRIVATE_ID', slug: SLUG, displayName: 'Synthetic Artist' },
    status: { key: 'active', labelKo: 'Synthetic status', descriptionKo: 'Synthetic description', private: 'PRIVATE_MARKER' },
    greeting: { text: 'Synthetic greeting', source: 'site_content', private: 'PRIVATE_MARKER' },
    starterOptions: [{ key: 'A', label: 'Synthetic choice', message: 'Synthetic message', private: 'PRIVATE_MARKER' }],
    policy: { private: 'PRIVATE_MARKER' }, unknownPrivateBody: 'PRIVATE_MARKER' };
}
export function starters() {
  return { artist: { slug: SLUG, displayName: 'Synthetic Artist' }, sets: [{ id: 'synthetic-set',
    guideText: 'Synthetic starter guide', options: [{ key: 'A', label: 'Synthetic starter', message: 'Synthetic message' }] }] };
}
export function response(value, status = 200) { return { status, ok: status >= 200 && status < 300, json: async () => plain(value) }; }

function element(tag, writes) {
  let text = '';
  const selected = new Map();
  const node = { tag, children: [], hidden: false, disabled: false, value: '', style: {}, dataset: {},
    append(...items) { this.children.push(...items); writes.push({ operation: 'append', tag }); },
    replaceChildren(...items) { text = ''; this.children = items; writes.push({ operation: 'replace', tag }); },
    setAttribute(name, value) { this[name] = value; writes.push({ operation: 'attribute', tag }); },
    querySelector(selector) { if (!selected.has(selector)) selected.set(selector, element(selector, writes)); return selected.get(selector); },
  };
  Object.defineProperty(node, 'textContent', { get() { return text + this.children.map(item => item.textContent).join(''); },
    set(value) { assert.equal(typeof value, 'string', 'DOM text must not coerce object payloads'); text = value; this.children = []; writes.push({ operation: 'text', tag }); } });
  Object.defineProperty(node, 'innerHTML', { set() { throw new Error('No arbitrary HTML rendering'); } });
  return node;
}

export function harness({ signedIn = true, search = '', catalogReply = () => response(catalog()), starterReply = () => response(starters()), refreshReply = async () => null } = {}) {
  const elements = new Map(), calls = [], writes = [], refreshCalls = [];
  const $ = id => { if (!elements.has(id)) elements.set(id, element(id, writes)); return elements.get(id); };
  $('chatInput').value = DRAFT; $('chatStarterCard').hidden = true;
  let session = signedIn ? { user: { id: 'synthetic-owner' }, accessToken: 'synthetic-ram-token', refreshToken: 'synthetic-ram-refresh' } : null;
  function refreshAuthOnce() { refreshCalls.push({ search: ctx.window.location.search }); return refreshReply(); }
  const tone = { welcomeMessage: 'Synthetic local preview', statusLine: 'Synthetic local status', starters: [] };
  const ctx = vm.createContext({ $, API_BASE: 'https://memory.invalid', getAuth: () => session,
    getRefreshToken: auth => auth?.refreshToken || '', _refreshCompleted: null,
    refreshAuthOnce, AbortController, encodeURIComponent, URLSearchParams,
    atob: value => Buffer.from(value, 'base64').toString('utf8'), setTimeout: () => 1, clearTimeout() {},
    window: { LUMINA_API_BASE: 'https://memory.invalid', refreshAuthOnce,
      getAuth: () => session, getAccessToken: () => session?.accessToken || null,
      location: { search, pathname: '/character-chat', hostname: 'memory.invalid' },
      luminaI18n: { getRegionalLocale: () => 'ko-KR' }, LuminaStaticData: { characters: [], getChatTone: () => tone },
      localStorage: { getItem: () => null } },
    document: { createElement: tag => element(tag, writes), querySelector: selector => $(selector) },
    renderHero(_slug, artist) { $('chatHeroSummary').textContent = artist?.statusLine || tone.statusLine; },
    injectSampleImageThread() {}, hydrateChatCms() {}, isMuted: () => false,
    fetch(url, options) {
      const address = new URL(url); assert.equal(address.origin, 'https://memory.invalid');
      const call = { path: address.pathname, method: options.method || 'GET',
        hasAuthorization: options.headers?.Authorization === 'Bearer ' + session?.accessToken,
        hasBody: options.body !== undefined };
      assert.equal(call.method, 'GET', 'Focused transport cannot call generation/auth/provider POST');
      assert.equal(call.hasBody, false); calls.push(call);
      if (call.path === '/api/v1/chat/character-catalog') return catalogReply(call);
      if (call.path === '/api/v1/chat/starter-prompts') return starterReply(call);
      throw new Error('Unexpected memory-only endpoint');
    },
  });
  vm.runInContext(actual, ctx, { filename: page.filename });
  const api = ctx.actualApi;
  api.basicChatState.accountKey = signedIn ? 'user:synthetic-owner' : null;
  api.basicChatState.epoch = 1; api.basicChatState.routeEpoch = 3; api.basicChatState.roomSlug = SLUG;
  return { api, $, calls, writes, tone, refreshCalls, start: () => api.runRoomEntry(SLUG),
    changeSearch(value) { ctx.window.location.search = value; },
    rotateToken() { session = { ...session, accessToken: 'synthetic-rotated-ram-token' }; return session; },
    switchAccount() { session = { ...session, user: { id: 'different-owner' }, accessToken: 'different-ram-token' };
      api.basicChatState.accountKey = 'user:different-owner'; api.basicChatState.epoch++; },
    snapshot() { return { status: $('chatSendStatus').textContent, hero: $('chatHeroSummary').textContent,
      starter: $('chatStarterOptions').textContent, starterHidden: $('chatStarterCard').hidden,
      fallback: $('chatStarterFallback').textContent, welcome: $('chatWelcomeText').textContent,
      welcomeHidden: $('chatWelcomeBubble').hidden, draft: $('chatInput').value,
      sendDisabled: $('chatSendBtn').disabled, writes: writes.length }; },
  };
}
