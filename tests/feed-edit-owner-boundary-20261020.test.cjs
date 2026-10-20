'use strict';

// AUTHOR/UNRUN. Three native groups, eleven isolated worlds; candidate FIRST0.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app.js');
const FEED = path.join(ROOT, 'pages/lumina-feed.js');
const TS = path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const profiles = [
  { file: APP, cap: 1024 * 1024, bytes: 435410,
    sha: '22437069572d993e76a8f0f7ca7055ed6f7d46fd98feb38a8175eb406860e33c',
    blob: '495f192c1236b9d45e3cbcb6710433f1cbf3e1ed' },
  { file: FEED, cap: 512 * 1024, bytes: 141156,
    sha: '67de05ce0342e26be6a06e2261d1380f8f81a49e6bcaf52ba09e900d7102b207',
    blob: '4ee9e314b7e34059b007adeb252f8dd8f76e9f06' }
];
function readBounded(file, cap) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.ok(stat.size > 0 && stat.size <= cap, 'bound before allocation');
  assert.equal(fs.realpathSync.native(file).toLowerCase(), path.resolve(file).toLowerCase());
  const raw = fs.readFileSync(file);
  assert.equal(raw.length, stat.size);
  return raw;
}
const tracked = [...profiles, { file: TS, cap: 16 * 1024 * 1024 },
  { file: __filename, cap: 256 * 1024 }];
const opening = tracked.map(row => readBounded(row.file, row.cap));
after(() => {
  for (let i = 0; i < tracked.length; i++) {
    assert.equal(readBounded(tracked[i].file, tracked[i].cap).equals(opening[i]), true,
      'closing raw dependency/self identity');
  }
});
function canonical(raw, profile) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  assert.equal(Buffer.from(text, 'utf8').equals(raw), true);
  assert.notEqual(text.charCodeAt(0), 0xFEFF);
  assert.equal(/\r(?!\n)/.test(text), false, 'no bare CR');
  const lf = text.replace(/\r\n/g, '\n');
  assert.equal(text === lf || text === lf.replace(/\n/g, '\r\n'), true, 'LF or uniform CRLF only');
  const bytes = Buffer.from(lf, 'utf8');
  assert.equal(bytes.length, profile.bytes);
  assert.equal(sha(bytes), profile.sha, 'whole canonical identity BEFORE parser/VM');
  assert.equal(blob(bytes), profile.blob);
  return lf;
}
const appSource = canonical(opening[0], profiles[0]);
const feedSource = canonical(opening[1], profiles[1]);
assert.equal(opening[2].length, 9112572);
assert.equal(sha(opening[2]), '3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675');
const ts = require(TS);
function parse(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(tree.parseDiagnostics.length, 0);
  return tree;
}
const appTree = parse(APP, appSource);
const feedTree = parse(FEED, feedSource);
assert.equal(feedTree.statements.length, 1, 'one genuine feed IIFE');
const feedStatement = feedTree.statements[0];
assert.ok(ts.isExpressionStatement(feedStatement) && ts.isCallExpression(feedStatement.expression));
const feedCall = feedStatement.expression;
assert.equal(feedCall.arguments.length, 0);
let feedFunction = feedCall.expression;
while (ts.isParenthesizedExpression(feedFunction)) feedFunction = feedFunction.expression;
assert.ok(ts.isFunctionExpression(feedFunction) && feedFunction.parameters.length === 0);
const feedScope = feedFunction.body;
assert.equal(feedScope.statements[0].getText(feedTree), '"use strict";');

function declaration(tree, scope, name, variable = false) {
  const all = [];
  function visit(node) {
    if (!variable && ts.isFunctionDeclaration(node) && node.name?.text === name) all.push(node);
    if (variable && ts.isVariableStatement(node) && node.declarationList.declarations.some(
      row => ts.isIdentifier(row.name) && row.name.text === name)) all.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(all.length, 1, 'unique genuine declaration ' + name);
  assert.equal(all[0].parent, scope, 'original lexical scope ' + name);
  if (variable) assert.equal(all[0].declarationList.declarations.length, 1);
  return all[0];
}
function functions(tree, scope, names) {
  return names.map(name => declaration(tree, scope, name));
}
function variables(tree, scope, names) {
  return names.map(name => declaration(tree, scope, name, true));
}
function joinOriginal(tree, source, nodes) {
  assert.equal(new Set(nodes).size, nodes.length);
  nodes.sort((a, b) => a.getStart(tree) - b.getStart(tree));
  for (let i = 1; i < nodes.length; i++) assert.ok(nodes[i - 1].end <= nodes[i].getStart(tree));
  return nodes.map(node => {
    const text = source.slice(node.getStart(tree), node.end);
    assert.equal(text, node.getText(tree));
    return text;
  }).join('\n');
}
const appNames = [
  'authRequestSession', 'authRequestSessionCurrent', 'apiFetch', 'refreshAuthOnce',
  'notifyAuthExpired', 'getAuth', 'setAuth', 'clearAuth', 'isLoggedIn',
  'getAccessToken', 'getRefreshToken', 'pickOwnerId',
  'normalizeFeedAuthorType', 'normalizeFeedThread', 'normalizeFeedPost',
  'feedEditModalCurrent', 'retireFeedEditOnAccountChange',
  'openFeedEditModal', 'closeFeedEditModal', 'bindLuminaFeedEdit',
  'closeFeedThreadModal', 'closeFeedCommentModal'
];
const appNodes = functions(appTree, appTree, appNames);
const sharedPins = [
  ['normalizeFeedAuthorType', 326302, 364, 'aaa79d39de4f1e38a019095f46fb9e9704e3978db1130165d95e97761e9f9ae0'],
  ['normalizeFeedThread', 327432, 1625, 'b19077ab2869081e6d2833bdb073c86bebd569023e2872f1396f84f03dcf0110'],
  ['normalizeFeedPost', 329058, 3152, 'cdf4475191773878e3442120096488abe77d73cea87512c8322dcd8a80eab8d8'],
  ['openFeedEditModal', 332925, 2678, '47e381f0276d2c07f377581e264fe8e8d981df73626e557f4769005b4f8f1560'],
  ['closeFeedEditModal', 335603, 293, 'a18ef62423b40fe2760e44ee295410c958904a37c8b9c4d0905642c9054936d3'],
  ['bindLuminaFeedEdit', 335896, 3376, '4622d222ef4ff2db88c29e868e97f387a592cb171fab2aaab84f0fa2f6b15821']
];
for (const [name, start, bytes, pin] of sharedPins) {
  const node = declaration(appTree, appTree, name);
  assert.equal(Buffer.byteLength(appSource.slice(0, node.getStart(appTree))), start);
  const raw = Buffer.from(node.getText(appTree) + '\n', 'utf8');
  assert.equal(raw.length, bytes);
  assert.equal(sha(raw), pin);
}
appNodes.push(...variables(appTree, appTree, [
  'API_BASE', 'AUTH_STORAGE_KEY', '_refreshInFlight', '_refreshCompleted',
  '_luminaFeedItems', '_feedEditModalEl', '_feedThreadModalEl',
  '_feedCommentModalEl', '_feedCommentLoadSeq'
]));
const appProgram = joinOriginal(appTree, appSource, appNodes) + '\n' +
  'globalThis.subject={bind:bindLuminaFeedEdit,close:closeFeedEditModal,' +
  'retireEdit:retireFeedEditOnAccountChange,' +
  'getAuth,setAuth,clearAuth,pickOwnerId,closeThread:closeFeedThreadModal,' +
  'closeComment:closeFeedCommentModal,live(){return _feedEditModalEl;},' +
  'seed(value){_luminaFeedItems=JSON.parse(JSON.stringify(value));},' +
  'cache(){return _luminaFeedItems;}};';

const feedNodes = functions(feedTree, feedScope, [
  'feedViewerKey', 'invalidateFeedReads', 'feedReadsBlockedForViewer',
  'closeProtectedFeedDetails', 'feedResponseItems', 'loadLuminaFeedData',
  'closeFeedPostDetail', 'clearFeedOnAccountChange',
  'repostAccountKey', 'retireRepostOnAccountChange', 'closeRepostModal'
]);
feedNodes.push(...variables(feedTree, feedScope, [
  '_luminaFeedSource', '_luminaFeedScope', '_luminaFeedQuery', '_luminaFeedSearchTimer',
  '_luminaFeedSearchSeq', '_feedListLoadSeq', '_feedDetailLoadSeq', '_feedBlockWriteOwner',
  '_feedDetailOpen', '_feedLastViewerKey', 'repostReturnFocus', 'repostLifetime'
]));
for (const type of ['lumina:authchange', 'lumina:auth-expired', 'storage']) {
  const matches = feedScope.statements.filter(node => {
    if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return false;
    const call = node.expression, callee = call.expression;
    return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) &&
      callee.expression.text === 'window' && callee.name.text === 'addEventListener' &&
      ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === type;
  });
  assert.equal(matches.length, 1, 'unique genuine feed event registration ' + type);
  feedNodes.push(matches[0]);
}
const detailExports = feedScope.statements.filter(node =>
  node.getText(feedTree) === 'window.closeFeedPostDetail = closeFeedPostDetail;');
assert.equal(detailExports.length, 1);
feedNodes.push(detailExports[0]);
const feedProgram = '(function(){' + feedScope.statements[0].getText(feedTree) + '\n' +
  joinOriginal(feedTree, feedSource, feedNodes) + '\n' +
  'return {owner(){return _feedLastViewerKey;},viewer:feedViewerKey,' +
  'fixtureSetLast(value){_feedLastViewerKey=value;}};})();';

const POST = '81000000-0000-4000-8000-000000000001';
const OWNER = '82000000-0000-4000-8000-000000000001';
const OTHER_OWNER = '82000000-0000-4000-8000-000000000002';
const DRAFT = '  account boundary draft  ';
const INITIAL = 'original visible body';
const FRESH = 'fresh authorized read body';
const SERVER = 'authorized synthetic response body';
const A = Object.freeze({ accessToken: 'fixture-a1', refreshToken: 'fixture-r1', user: { id: OWNER } });
const A2 = Object.freeze({ accessToken: 'fixture-a2', refreshToken: 'fixture-r2', user: { id: OWNER } });
const A3 = Object.freeze({ accessToken: 'fixture-a3', refreshToken: 'fixture-r3', user: { id: OWNER } });
const B = Object.freeze({ accessToken: 'fixture-b1', refreshToken: 'fixture-br1', user: { id: OTHER_OWNER } });
function post(body = INITIAL) {
  return { id: POST, body, authorUserId: OWNER, authorType: 'fan', authorName: 'Fixture',
    likeCount: 2, replyCount: 3, assets: [], viewer: { isAuthor: true, canEdit: true },
    permissions: { canEdit: true, editScope: 'body_only_mvp' } };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.then(() => {}, () => {});
  return { promise, resolve, reject };
}
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), 1000);
    })]);
  } finally { clearTimeout(timer); }
}
async function waitFor(predicate, label) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, label);
    await new Promise(resolve => setImmediate(resolve));
  }
}

function phasedError(message, records) {
  const phases = Object.freeze(records.map(row => row.phase));
  const error = new AggregateError(records.map(row => row.error),
    message + ' [' + phases.join(', ') + ']');
  Object.defineProperty(error, 'phases', { value: phases, enumerable: true });
  return error;
}

function world(t) {
  const stats = { attempts: 0, valid: 0, validationFailures: 0, gets: 0, patches: 0,
    active: 0, domErrors: 0, handlerErrors: 0, eventErrors: 0, timerErrors: 0, storageErrors: 0,
    renders: 0, toasts: 0, warnings: 0, alerts: 0, events: Object.create(null) };
  const requests = [], writes = [], allNodes = [], bodyChildren = [];
  const listeners = new Map(), nativeListeners = [], timers = new Map(), jobs = new Set();
  const storage = new Map([['lumina_auth', JSON.stringify(A)]]);
  const gates = [], entered = deferred(), failures = [];
  function capture(phase, error) { failures.push({ phase, error }); }
  const window = new EventTarget();
  window.location = { hostname: 'fixture.invalid', pathname: '/lumina-feed',
    origin: 'https://fixture.invalid', search: '' };
  let subject, feed, serial = 0, cleanupPromise;
  const nativeAdd = window.addEventListener.bind(window);
  const nativeRemove = window.removeEventListener.bind(window);
  function track(job) {
    jobs.add(job);
    job.then(() => jobs.delete(job), error => {
      jobs.delete(job); stats.handlerErrors++; capture('track.reject', error);
    });
    return job;
  }
  window.addEventListener = (type, fn, options) => {
    const wrapped = event => {
      stats.events[type] = (stats.events[type] || 0) + 1;
      try {
        const value = fn.call(window, event);
        if (value && typeof value.then === 'function') track(Promise.resolve(value));
      } catch (error) { stats.eventErrors++; capture('event.callback:' + type, error); }
    };
    nativeListeners.push({ type, fn, wrapped, options });
    nativeAdd(type, wrapped, options);
  };
  window.removeEventListener = (type, fn, options) => {
    const row = nativeListeners.find(row => row.type === type && row.fn === fn);
    if (row) nativeRemove(type, row.wrapped, options);
  };
  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
  }
  function off(type, fn) { listeners.get(type)?.delete(fn); }
  function record(node, field) { writes.push({ node: node.id, field }); }
  function attach(node, value) {
    node.isConnected = value;
    for (const child of node.children) attach(child, value);
  }
  class Node {
    constructor(kind) {
      this.id = ++serial; this.kind = kind; this.dataset = {};
      this.attributes = new Map(); this.children = []; this.controls = new Map();
      this.events = new Map(); this.isConnected = false;
      for (const [field, initial] of [['value', ''], ['textContent', ''], ['disabled', false], ['hidden', false]]) {
        let value = initial;
        Object.defineProperty(this, field, { enumerable: true, get: () => value,
          set: next => { record(this, field); value = typeof initial === 'boolean' ? Boolean(next) : String(next); } });
      }
      allNodes.push(this);
    }
    setAttribute(key, value) { record(this, 'attribute'); this.attributes.set(key, String(value)); }
    addEventListener(type, fn) {
      if (!this.events.has(type)) this.events.set(type, new Set());
      this.events.get(type).add(fn);
    }
    querySelector(selector) {
      if (!this.controls.has(selector)) { stats.domErrors++; throw new Error('FIXTURE_SELECTOR'); }
      return this.controls.get(selector);
    }
    closest(selector) {
      return (selector === '[data-feed-edit]' && this.kind === 'edit') ||
        (selector === '[data-feed-edit-save]' && this.kind === 'save') ||
        (selector === '[data-feed-edit-cancel]' && this.kind === 'cancel') ? this : null;
    }
    set innerHTML(value) {
      record(this, 'innerHTML');
      if (this.kind !== 'modal' || !String(value).includes('data-feed-edit-save') ||
          !String(value).includes('maxlength="2200"')) {
        stats.domErrors++; throw new Error('FIXTURE_MODAL_MARKUP');
      }
      for (const [selector, kind] of [['textarea', 'textarea'], ['.feed-edit-modal-counter', 'counter'],
        ['.feed-edit-modal-error', 'error'], ['[data-feed-edit-save]', 'save']]) {
        const child = new Node(kind);
        if (kind === 'error') child.hidden = true;
        this.controls.set(selector, child); this.children.push(child);
      }
      this.cancel = new Node('cancel'); this.children.push(this.cancel);
    }
    remove() {
      record(this, 'remove');
      const index = bodyChildren.indexOf(this);
      if (index >= 0) bodyChildren.splice(index, 1);
      attach(this, false);
    }
    focus() { record(this, 'focus'); document.activeElement = this; }
    setSelectionRange(start, end) { record(this, 'selection'); this.selection = [start, end]; }
  }
  const feedRoot = Object.freeze({ fixture: 'feed-list-root' });
  let feedRootVisible = true;
  const document = {
    activeElement: null,
    createElement(tag) {
      if (tag !== 'div') { stats.domErrors++; throw new Error('FIXTURE_ELEMENT'); }
      return new Node('modal');
    },
    getElementById(id) {
      if (id === 'luminaFeedList') return feedRootVisible ? feedRoot : null;
      if (['feedPostDetail', 'feedRepostBackdrop', 'feedRepostModal'].includes(id)) return null;
      stats.domErrors++; throw new Error('FIXTURE_ID');
    },
    querySelector(selector) {
      if (selector === '.feed-main-column') return null;
      stats.domErrors++; throw new Error('FIXTURE_DOCUMENT_SELECTOR');
    },
    body: { style: {}, appendChild(node) {
      record(node, 'append'); bodyChildren.push(node); attach(node, true);
    } },
    addEventListener: on, removeEventListener: off
  };
  function productTimeout(fn, delay) {
    if (![0, 3000, 8000].includes(delay)) { stats.timerErrors++; throw new Error('FIXTURE_TIMER_DELAY'); }
    const handle = setTimeout(() => {
      timers.delete(handle);
      try { fn(); } catch (error) { stats.timerErrors++; capture('timer.callback', error); }
    }, delay);
    timers.set(handle, delay);
    return handle;
  }
  function productClear(handle) { clearTimeout(handle); timers.delete(handle); }
  const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value),
    { status, headers: { 'content-type': 'application/json' } });
  async function fakeFetch(url, options) {
    stats.attempts++;
    const row = { attempt: stats.attempts, url: String(url), method: options?.method,
      authorization: options?.headers?.Authorization || null, body: options?.body || null };
    requests.push(row);
    let kind;
    try {
      assert.ok(options && options.signal instanceof AbortSignal);
      const live = subject.getAuth();
      const token = live?.accessToken;
      if (url === 'https://api.lumina-stage.com/api/v1/me/lumina-feed?mode=all&take=30') {
        kind = 'get'; assert.equal(options.method, 'GET');
        assert.ok(token); assert.equal(row.authorization, 'Bearer ' + token);
        assert.equal(options.body, undefined);
        assert.deepEqual(Object.keys(options.headers), ['Authorization']);
      } else if (url === 'https://api.lumina-stage.com/api/v1/lumina-feed?mode=all&take=30') {
        kind = 'get'; assert.equal(options.method, 'GET'); assert.equal(row.authorization, null);
        assert.equal(options.body, undefined); assert.equal(Object.keys(options.headers).length, 0);
      } else {
        kind = 'patch';
        assert.equal(url, 'https://api.lumina-stage.com/api/v1/lumina-feed/posts/' + POST);
        assert.equal(options.method, 'PATCH');
        assert.equal(options.headers['Content-Type'], 'application/json');
        assert.equal(row.authorization, token ? 'Bearer ' + token : null);
        assert.deepEqual(Object.keys(options.headers).sort(),
          token ? ['Authorization', 'Content-Type'] : ['Content-Type']);
        const body = JSON.parse(options.body);
        assert.deepEqual(Object.keys(body), ['body']); assert.equal(body.body, DRAFT.trim());
        assert.equal(gates.length, 0, 'at most one PATCH per isolated world');
      }
      stats.valid++;
    } catch (error) {
      stats.validationFailures++; capture('fetch.validation', error); entered.resolve();
      throw error;
    }
    if (kind === 'get') {
      stats.gets++;
      return jsonResponse({ items: subject.pickOwnerId() === OWNER ? [post(FRESH)] : [] });
    }
    stats.patches++; stats.active++;
    const gate = deferred(); gate.settled = false; gates.push(gate); entered.resolve();
    let abort;
    try {
      return await new Promise((resolve, reject) => {
        abort = () => reject(Object.assign(new Error('fixture native abort'), { name: 'AbortError' }));
        options.signal.addEventListener('abort', abort, { once: true });
        if (options.signal.aborted) abort();
        gate.promise.then(resolve, reject);
      });
    } finally {
      options.signal.removeEventListener('abort', abort);
      stats.active--;
    }
  }
  function settle(failure = false) {
    assert.equal(gates.length, 1);
    const gate = gates[0]; assert.equal(gate.settled, false); gate.settled = true;
    gate.resolve(failure ? jsonResponse({ message: 'fixture-save-failure' }, 500) :
      jsonResponse({ post: { id: POST, body: SERVER } }));
  }
  function snapshot() {
    return sha(JSON.stringify({ cache: subject.cache(), live: subject.live()?.id || null,
      nodes: allNodes.map(node => ({ id: node.id, connected: node.isConnected, value: node.value,
        text: node.textContent, disabled: node.disabled, hidden: node.hidden,
        attrs: [...node.attributes], dataset: node.dataset, selection: node.selection || null })),
      renders: stats.renders, toasts: stats.toasts, warnings: stats.warnings,
      alerts: stats.alerts, writes: writes.length }));
  }
  function controls() {
    const causes = failures.slice();
    const check = (phase, fn) => {
      try { fn(); } catch (error) { causes.push({ phase, error }); }
    };
    check('controls.failure-counts', () => {
      assert.equal(stats.validationFailures + stats.domErrors + stats.handlerErrors +
        stats.eventErrors + stats.timerErrors + stats.storageErrors, 0, 'no swallowed fixture/handler failure');
    });
    check('controls.valid-count', () => assert.equal(stats.attempts, stats.valid));
    check('controls.request-count', () => assert.equal(stats.attempts, stats.gets + stats.patches));
    check('controls.alert-count', () => assert.equal(stats.alerts, 0));
    if (causes.length) throw phasedError('Fixture controls failed', causes);
  }
  function fire(target) {
    if (!target.isConnected || target.disabled) return Promise.resolve();
    const values = [];
    const event = { target, preventDefault() {}, stopPropagation() {} };
    for (const fn of [...(listeners.get('click') || [])]) {
      try { values.push(fn(event)); }
      catch (error) { stats.handlerErrors++; capture('click.delegate', error); values.push(Promise.reject(error)); }
    }
    return track(Promise.all(values));
  }
  async function idle(gets, renders, pendingPatch = 0) {
    await waitFor(() => stats.gets === gets && stats.renders === renders &&
      stats.active === pendingPatch && [...timers.values()].every(delay => delay !== 0),
    'GENUINE_FEED_OR_UI_DRAIN');
    controls();
    assert.equal(feed.owner(), feed.viewer(), 'real feed callback observed current owner');
  }
  async function cleanup() {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      const causes = [];
      const attempt = (phase, fn) => {
        try { fn(); } catch (error) { causes.push({ phase, error }); }
      };
      for (let i = 0; i < gates.length; i++) attempt('cleanup.settle:' + i, () => {
        const gate = gates[i];
        if (!gate.settled) {
          gate.settled = true; gate.resolve(jsonResponse({ post: { id: POST, body: SERVER } }));
        }
      });
      try {
        await bounded(Promise.allSettled([...jobs]), 'HANDLER_CLEANUP_TIMEOUT');
      } catch (error) { causes.push({ phase: 'cleanup.handlers', error }); }
      try {
        await waitFor(() => stats.active === 0 && timers.size === 0, 'PRODUCT_TIMER_CLEANUP');
      } catch (error) { causes.push({ phase: 'cleanup.product-timers', error }); }
      attempt('cleanup.subject-close', () => { if (subject) subject.close(); });
      let handles = [], registrations = [], roots = [];
      attempt('cleanup.timer-snapshot', () => { handles = [...timers.keys()]; });
      for (let i = 0; i < handles.length; i++) {
        attempt('cleanup.timer-clear:' + i, () => clearTimeout(handles[i]));
      }
      attempt('cleanup.timers-map-clear', () => timers.clear());
      attempt('cleanup.listener-snapshot', () => { registrations = nativeListeners.slice(); });
      for (let i = 0; i < registrations.length; i++) attempt('cleanup.native-listener:' + i, () => {
        const row = registrations[i]; nativeRemove(row.type, row.wrapped, row.options);
      });
      attempt('cleanup.native-listeners-clear', () => { nativeListeners.length = 0; });
      attempt('cleanup.document-listeners-clear', () => listeners.clear());
      attempt('cleanup.root-snapshot', () => { roots = bodyChildren.slice(); });
      for (let i = 0; i < roots.length; i++) {
        attempt('cleanup.root-remove:' + i, () => roots[i].remove());
      }
      for (let i = 0; i < allNodes.length; i++) {
        attempt('cleanup.node-detach:' + i, () => attach(allNodes[i], false));
        attempt('cleanup.node-events:' + i, () => allNodes[i].events.clear());
      }
      attempt('cleanup.controls', () => controls());
      attempt('cleanup.disconnected-check', () =>
        assert.equal(allNodes.every(node => node.isConnected === false), true));
      attempt('cleanup.empty-check', () =>
        assert.equal(jobs.size + timers.size + listeners.size + nativeListeners.length + bodyChildren.length, 0));
      attempt('cleanup.active-check', () => assert.equal(stats.active, 0));
      if (causes.length) throw phasedError('Fixture cleanup failed', causes);
    })();
    return cleanupPromise;
  }
  t.after(cleanup);
  function storageKey(key) {
    if (key !== 'lumina_auth') { stats.storageErrors++; throw new Error('FIXTURE_STORAGE_KEY'); }
  }
  const localStorage = {
    getItem(key) { storageKey(key); return storage.get(key) ?? null; },
    setItem(key, value) { storageKey(key); storage.set(key, String(value)); },
    removeItem(key) { storageKey(key); storage.delete(key); }
  };
  const context = vm.createContext({ document, window, localStorage,
    Event, CustomEvent, AbortController, AbortSignal, fetch: fakeFetch,
    setTimeout: productTimeout, clearTimeout: productClear,
    // Presentation-only adapters; no owner, lifetime, cache or request decisions here.
    renderLuminaFeed() { stats.renders++; },
    showLuminaToast() { stats.toasts++; },
    alert() { stats.alerts++; },
    console: { warn() { stats.warnings++; }, log() {}, info() {}, error() {} }
  }, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(appProgram, { filename: 'genuine-account-edit-app.js' })
    .runInContext(context, { timeout: 1000 });
  subject = context.subject;
  window.retireFeedEditOnAccountChange = subject.retireEdit;
  assert.equal(window.retireFeedEditOnAccountChange, context.retireFeedEditOnAccountChange,
    'Window bridge is the same selected genuine function, not a fixture decision');
  window.closeFeedThreadModal = subject.closeThread;
  window.closeFeedCommentModal = subject.closeComment;
  feed = new vm.Script(feedProgram, { filename: 'genuine-feed-auth-callbacks.js' })
    .runInContext(context, { timeout: 1000 });
  subject.seed([post()]); subject.bind(); subject.bind();
  assert.equal(listeners.get('click')?.size, 2);
  assert.equal(nativeListeners.length, 3);
  assert.equal(subject.pickOwnerId(), OWNER);
  assert.equal(feed.owner(), OWNER);
  return {
    subject, feed, stats, requests, writes, snapshot, controls, fire, settle, idle, cleanup,
    beginOpen() {
      const card = new Node('edit'); card.dataset.feedEdit = POST; attach(card, true);
      const job = fire(card);
      return { job, modal: subject.live() };
    },
    rawAuth(auth) {
      if (auth) storage.set('lumina_auth', JSON.stringify(auth)); else storage.delete('lumina_auth');
    },
    setRootVisible(value) {
      assert.equal(typeof value, 'boolean'); feedRootVisible = value;
    },
    hasFeedRoot() { return document.getElementById('luminaFeedList') !== null; },
    nodeCount(kind) { return allNodes.filter(node => node.kind === kind).length; },
    pendingFocus() { return [...timers.values()].filter(delay => delay === 0).length; },
    async drainFocus() {
      await waitFor(() => [...timers.values()].every(delay => delay !== 0), 'FOCUS_TIMER_DRAIN');
      controls();
    },
    async open() {
      const card = new Node('edit'); card.dataset.feedEdit = POST; attach(card, true);
      await fire(card); await idle(0, 0);
      const modal = subject.live();
      assert.ok(modal && modal.isConnected);
      const textarea = modal.querySelector('textarea'); textarea.value = DRAFT;
      for (const fn of textarea.events.get('input') || []) fn({ target: textarea });
      assert.equal(textarea.value, DRAFT);
      return modal;
    },
    storageAuth(auth) {
      if (auth) storage.set('lumina_auth', JSON.stringify(auth)); else storage.delete('lumina_auth');
      const event = new Event('storage'); Object.defineProperty(event, 'key', { value: 'lumina_auth' });
      window.dispatchEvent(event);
    },
    async entry() {
      await bounded(entered.promise, 'PATCH_ENTRY_TIMEOUT');
      controls(); assert.equal(stats.patches, 1); assert.equal(gates.length, 1);
    }
  };
}
async function usingWorld(t, fn) {
  const w = world(t), failures = [];
  let value;
  try { value = await fn(w); }
  catch (error) { failures.push({ phase: 'usingWorld.fn', error }); }
  try { await w.cleanup(); }
  catch (error) { failures.push({ phase: 'usingWorld.cleanup', error }); }
  if (failures.length === 1) throw failures[0].error;
  if (failures.length > 1) throw phasedError('World body and cleanup failed', failures);
  return value;
}

test('same known-owner rotation preserves draft and genuine current-auth save', { timeout: 5000 }, async t => {
  await usingWorld(t, async w => {
    const modal = await w.open(), before = w.snapshot();
    w.subject.setAuth(A2); w.storageAuth(A3);
    await w.idle(0, 0);
    assert.equal(w.subject.pickOwnerId(), OWNER);
    assert.equal(w.subject.live(), modal);
    assert.equal(modal.querySelector('textarea').value, DRAFT);
    assert.equal(w.snapshot(), before, 'rotation must not always retire/reject edits');
    assert.equal(w.stats.events['lumina:authchange'], 1);
    assert.equal(w.stats.events.storage, 1);
    const job = w.fire(modal.querySelector('[data-feed-edit-save]'));
    await w.entry();
    assert.equal(w.requests[0].authorization, 'Bearer ' + A3.accessToken);
    assert.equal(w.requests[0].body, JSON.stringify({ body: DRAFT.trim() }));
    w.settle(); await bounded(job, 'NORMAL_SAVE_DRAIN'); await w.idle(0, 1);
    assert.equal(w.stats.attempts, 1); assert.equal(w.stats.patches, 1);
    assert.equal(w.subject.cache()[0].body, SERVER);
    assert.equal(w.subject.live(), null); assert.equal(modal.isConnected, false);
    assert.equal(w.stats.toasts, 1); assert.equal(w.stats.warnings, 0);
    t.diagnostic(JSON.stringify({ phase: 'rotation-positive', requests: w.requests,
      events: w.stats.events, rendered: w.stats.renders, toasts: w.stats.toasts }));
  });
  await usingWorld(t, async w => {
    const unknown = { accessToken: 'fixture-unknown', refreshToken: 'fixture-unknown-r', user: {} };
    w.rawAuth(unknown);
    assert.equal(w.subject.pickOwnerId(), null);
    assert.equal(w.subject.cache()[0].id, POST, 'cached editable post still exists');
    const opened = w.beginOpen();
    await bounded(opened.job, 'UNKNOWN_OPEN_DRAIN'); await w.drainFocus();
    assert.equal(opened.modal, null); assert.equal(w.subject.live(), null);
    assert.equal(w.nodeCount('modal'), 0, 'unknown owner refuses creation, not merely SAVE');
    assert.equal(w.pendingFocus(), 0);
    assert.equal(w.stats.attempts, 0); assert.equal(w.requests.length, 0);
    assert.equal(w.stats.patches, 0); assert.equal(w.stats.gets, 0);
    assert.equal(Object.keys(w.stats.events).length, 0);
    assert.equal(w.subject.getAuth().accessToken, unknown.accessToken, 'no automatic auth change');
    w.controls();
    t.diagnostic(JSON.stringify({ phase: 'unknown-opening-qualification',
      modalCreations: w.nodeCount('modal'), attempts: w.stats.attempts, events: w.stats.events }));
  });
  await usingWorld(t, async w => {
    const opened = w.beginOpen(), modal = opened.modal;
    assert.ok(modal && modal.isConnected);
    assert.equal(modal._feedEditOwnerId, OWNER);
    assert.equal(w.pendingFocus(), 1, 'real zero-focus callback is queued before any await');
    const textarea = modal.querySelector('textarea'), initialValue = textarea.value;
    assert.equal(w.writes.filter(row => row.node === textarea.id &&
      ['focus', 'selection'].includes(row.field)).length, 0);
    w.subject.close();
    assert.equal(modal._feedEditOwnerId, null);
    const writesAfterClose = w.writes.length;
    await bounded(opened.job, 'CLOSE_BEFORE_FOCUS_DRAIN'); await w.idle(0, 0);
    assert.equal(w.subject.live(), null); assert.equal(modal.isConnected, false);
    assert.equal(textarea.value, initialValue);
    assert.equal(w.writes.length, writesAfterClose, 'retired textarea receives no late focus/selection');
    assert.equal(w.stats.attempts, 0); assert.equal(w.requests.length, 0);
    t.diagnostic(JSON.stringify({ phase: 'close-before-focus-qualification',
      retired: modal.isConnected === false, lateWrites: w.writes.length - writesAfterClose,
      attempts: w.stats.attempts }));
  });
});

test('observed replacement loss and return retire pre-SAVE intent without a stale request', { timeout: 8000 }, async t => {
  const facts = [];
  for (const mode of ['replacement-storage', 'loss-authchange', 'observed-return']) {
    facts.push(await usingWorld(t, async w => {
      const old = await w.open(), save = old.querySelector('[data-feed-edit-save]');
      let gets = 1, renders = 2;
      if (mode === 'replacement-storage') w.storageAuth(B); else w.subject.clearAuth();
      await w.idle(gets, renders);
      assert.equal(w.subject.pickOwnerId(), mode === 'replacement-storage' ? OTHER_OWNER : null);
      if (mode === 'observed-return') {
        w.subject.setAuth(A2); gets++; renders += 2; await w.idle(gets, renders);
        assert.equal(w.subject.pickOwnerId(), OWNER);
        assert.equal(w.stats.events['lumina:authchange'], 2, 'loss and return separately observed');
      }
      const retiredBeforeSave = w.subject.live() !== old && old.isConnected === false;
      const patchBefore = w.stats.patches;
      const job = w.fire(save);
      if (w.stats.patches > patchBefore) { await w.entry(); w.settle(); }
      await bounded(job, 'PRE_SAVE_CLICK_DRAIN');
      w.controls();
      assert.equal(w.stats.gets, gets);
      const fact = { mode, retiredBeforeSave, staleRequests: w.stats.patches - patchBefore,
        requests: w.requests, events: w.stats.events, validationFailures: w.stats.validationFailures };
      t.diagnostic(JSON.stringify({ phase: 'pre-save-safety', ...fact }));
      return fact;
    }));
  }
  assert.deepEqual(facts.map(row => ({ retired: row.retiredBeforeSave, staleRequests: row.staleRequests })),
    facts.map(() => ({ retired: true, staleRequests: 0 })),
    'SAFETY: every observed boundary retires old modal and sends no stale pre-SAVE PATCH');
  await usingWorld(t, async w => {
    const old = await w.open();
    w.setRootVisible(false); assert.equal(w.hasFeedRoot(), false);
    w.subject.clearAuth(); await w.idle(0, 0);
    assert.equal(w.subject.pickOwnerId(), null); assert.equal(w.feed.owner(), '');
    assert.equal(w.subject.live(), null); assert.equal(old.isConnected, false);
    assert.equal(old._feedEditOwnerId, null);
    assert.equal(w.stats.events['lumina:authchange'], 1);
    assert.equal(w.stats.attempts, 0); assert.equal(w.requests.length, 0);
    assert.equal(w.stats.gets, 0); assert.equal(w.stats.renders, 0);
    t.diagnostic(JSON.stringify({ phase: 'root-absent-loss-qualification',
      retired: old.isConnected === false, attempts: w.stats.attempts, events: w.stats.events }));
  });
  await usingWorld(t, async w => {
    w.feed.fixtureSetLast(OTHER_OWNER);
    assert.equal(w.feed.owner(), OTHER_OWNER); assert.equal(w.feed.viewer(), OWNER);
    const opened = w.beginOpen(), old = opened.modal;
    assert.ok(old && old.isConnected); assert.equal(old._feedEditOwnerId, OWNER);
    await bounded(opened.job, 'STALE_VIEWER_OPEN_DRAIN'); await w.drainFocus();
    assert.equal(w.subject.live(), old); assert.equal(w.subject.pickOwnerId(), OWNER);
    assert.equal(w.feed.owner(), OTHER_OWNER, 'stale key exists before observing B');
    w.storageAuth(B); await w.idle(0, 0);
    assert.equal(w.feed.owner(), OTHER_OWNER); assert.equal(w.feed.viewer(), OTHER_OWNER);
    assert.equal(w.subject.live(), null); assert.equal(old.isConnected, false);
    assert.equal(old._feedEditOwnerId, null);
    assert.equal(w.stats.events.storage, 1);
    assert.equal(w.stats.attempts, 0); assert.equal(w.requests.length, 0);
    assert.equal(w.stats.gets, 0); assert.equal(w.stats.renders, 0);
    t.diagnostic(JSON.stringify({ phase: 'unchanged-stale-viewer-qualification',
      retired: old.isConnected === false, attempts: w.stats.attempts,
      feedLastViewer: w.feed.owner(), events: w.stats.events }));
  });
  await usingWorld(t, async w => {
    const old = await w.open(), save = old.querySelector('[data-feed-edit-save]');
    w.rawAuth(B);
    assert.equal(w.subject.pickOwnerId(), OTHER_OWNER);
    assert.equal(w.feed.owner(), OWNER); assert.equal(w.feed.viewer(), OTHER_OWNER);
    assert.equal(Object.keys(w.stats.events).length, 0, 'no boundary notification was dispatched');
    const job = w.fire(save);
    await bounded(job, 'UNOBSERVED_RAW_SAVE_DRAIN'); w.controls();
    assert.equal(w.subject.live(), null); assert.equal(old.isConnected, false);
    assert.equal(old._feedEditOwnerId, null, 'genuine current helper retires before request');
    assert.equal(w.stats.attempts, 0); assert.equal(w.requests.length, 0);
    assert.equal(w.stats.patches, 0); assert.equal(w.stats.gets, 0);
    assert.equal(w.feed.owner(), OWNER, 'fixture did not synthesize feed observation');
    assert.equal(w.subject.getAuth().accessToken, B.accessToken);
    t.diagnostic(JSON.stringify({ phase: 'raw-auth-before-save-qualification',
      retired: old.isConnected === false, attempts: w.stats.attempts, events: w.stats.events }));
  });
});

test('old A success and error after observed loss return cannot apply local effects', { timeout: 8000 }, async t => {
  const facts = [];
  for (const outcome of ['success', 'error']) {
    facts.push(await usingWorld(t, async w => {
      const old = await w.open(), save = old.querySelector('[data-feed-edit-save]');
      const job = w.fire(save); await w.entry();
      assert.equal(w.requests[0].authorization, 'Bearer ' + A.accessToken);
      w.subject.clearAuth(); await w.idle(1, 2, 1);
      assert.equal(w.subject.pickOwnerId(), null);
      w.subject.setAuth(A2); await w.idle(2, 4, 1);
      assert.equal(w.subject.pickOwnerId(), OWNER);
      assert.equal(w.stats.events['lumina:authchange'], 2);
      assert.equal(w.subject.cache()[0].body, FRESH, 'genuine authorized read completed after return');
      const retiredAtBoundary = w.subject.live() !== old && old.isConnected === false;
      const before = w.snapshot(), writes = w.writes.length;
      w.settle(outcome === 'error'); await bounded(job, 'LATE_HANDLER_DRAIN');
      w.controls();
      assert.equal(w.stats.attempts, 3); assert.equal(w.stats.gets, 2); assert.equal(w.stats.patches, 1);
      const fact = { outcome, retiredAtBoundary, sameSnapshot: w.snapshot() === before,
        lateWrites: w.writes.length - writes, requests: w.requests, events: w.stats.events,
        validationFailures: w.stats.validationFailures };
      t.diagnostic(JSON.stringify({ phase: 'settlement-safety', ...fact }));
      return fact;
    }));
  }
  assert.deepEqual(facts.map(row => ({ retired: row.retiredAtBoundary,
    sameSnapshot: row.sameSnapshot, lateWrites: row.lateWrites })),
  facts.map(() => ({ retired: true, sameSnapshot: true, lateWrites: 0 })),
  'SAFETY: old success/error after observed loss return cannot change any captured local effects');
});
