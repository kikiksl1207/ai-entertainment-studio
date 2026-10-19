'use strict';

// AUTHOR/UNRUN. Default-entry candidate only; same three synthetic modal-lifetime cases.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app.js');
const TS = path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js');
const sha = value => createHash('sha256').update(value).digest('hex');
const blob = value => createHash('sha1').update('blob ' + value.length + '\0').update(value).digest('hex');
const expectedSource = '4730707c2fae82363401f6f11dc5dc3daa68b9bb88b151ffdcec37e65c5e73ff';
const profile = Object.freeze({
  bytes: 434800, blob: 'b83bdd503d1ad80c11cc7724a3e6f3ee2bb268d2',
  binderBytes: 3339, binderSha: 'c1091b68db869cdef05b562de2ebb7fc0c64970509af292080bd7c0ead5623da'
});

function readBounded(file, cap) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.ok(stat.size > 0 && stat.size <= cap, 'bound precedes buffer allocation');
  assert.equal(fs.realpathSync.native(file).toLowerCase(), path.resolve(file).toLowerCase());
  const raw = fs.readFileSync(file);
  assert.equal(raw.length, stat.size);
  return raw;
}
const tracked = [
  { file: APP, cap: 1024 * 1024 },
  { file: TS, cap: 16 * 1024 * 1024 },
  { file: __filename, cap: 256 * 1024 }
];
const opening = tracked.map(row => readBounded(row.file, row.cap));
after(() => {
  for (let i = 0; i < tracked.length; i++) {
    assert.equal(readBounded(tracked[i].file, tracked[i].cap).equals(opening[i]), true,
      'physical input closing identity');
  }
});
const physicalApp = opening[0];
const decodedApp = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(physicalApp);
assert.equal(Buffer.from(decodedApp, 'utf8').equals(physicalApp), true);
assert.notEqual(decodedApp.charCodeAt(0), 0xFEFF);
assert.equal(/\r(?!\n)/.test(decodedApp), false, 'bare CR is not admitted');
// Physical inputs stay untouched; only this admitted EOL view reaches extraction.
const source = decodedApp.replace(/\r\n/g, '\n');
assert.equal(decodedApp === source || decodedApp === source.replace(/\n/g, '\r\n'), true,
  'only LF or uniform CRLF is admitted');
const canonicalApp = Buffer.from(source, 'utf8');
assert.equal(canonicalApp.length, profile.bytes);
assert.equal(sha(canonicalApp), expectedSource, 'only the frozen candidate whole app');
assert.equal(blob(canonicalApp), profile.blob);
assert.equal(opening[1].length, 9112572);
assert.equal(sha(opening[1]), '3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675');

const ts = require(TS);
const tree = ts.createSourceFile(APP, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(tree.parseDiagnostics.length, 0);
function oneFunction(name) {
  const found = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(found.length, 1, 'unique genuine ' + name);
  assert.equal(found[0].parent, tree, 'top-level genuine declaration');
  return found[0];
}
function oneVariable(name, kind) {
  const found = tree.statements.filter(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(row => ts.isIdentifier(row.name) && row.name.text === name));
  assert.equal(found.length, 1, 'unique genuine variable ' + name);
  assert.equal(found[0].declarationList.declarations.length, 1);
  const init = found[0].declarationList.declarations[0].initializer;
  if (kind === 'array') {
    assert.ok(ts.isArrayLiteralExpression(init));
    assert.equal(init.elements.length, 0);
  } else assert.equal(init.kind, ts.SyntaxKind.NullKeyword);
  return found[0];
}
const shared = [
  ['normalizeFeedAuthorType', 326302, 364, 'aaa79d39de4f1e38a019095f46fb9e9704e3978db1130165d95e97761e9f9ae0'],
  ['normalizeFeedThread', 327432, 1625, 'b19077ab2869081e6d2833bdb073c86bebd569023e2872f1396f84f03dcf0110'],
  ['normalizeFeedPost', 329058, 3152, 'cdf4475191773878e3442120096488abe77d73cea87512c8322dcd8a80eab8d8'],
  ['openFeedEditModal', 332577, 2499, 'b4826adc93bbfd2c4ca811b82f9e4d91e52df782bfa43dd1cbfacbd0ffcd7d8f'],
  ['closeFeedEditModal', 335076, 247, '3dc0a9c46b4b36dc2df86b613374c7f7e841a43aeaf78a5b6186be46693ffd8d'],
  ['bindLuminaFeedEdit', 335323, profile.binderBytes, profile.binderSha]
];
const nodes = shared.map(([name, start, size, pin]) => {
  const node = oneFunction(name);
  assert.equal(Buffer.byteLength(source.slice(0, node.getStart(tree))), start);
  const text = source.slice(node.getStart(tree), node.end);
  assert.equal(text, node.getText(tree));
  const raw = Buffer.from(text + '\n');
  assert.equal(raw.length, size);
  assert.equal(sha(raw), pin);
  return node;
});
nodes.push(oneVariable('_luminaFeedItems', 'array'), oneVariable('_feedEditModalEl', 'null'));
nodes.sort((a, b) => a.getStart(tree) - b.getStart(tree));
for (let i = 1; i < nodes.length; i++) assert.ok(nodes[i - 1].end <= nodes[i].getStart(tree));
// Original node text/order, no printer, whole-app boot or injected strict directive.
const genuine = nodes.map(node => node.getText(tree)).join('\n') + '\n' +
  '({bind:bindLuminaFeedEdit,close:closeFeedEditModal,live(){return _feedEditModalEl;},' +
  'seed(value){_luminaFeedItems=JSON.parse(JSON.stringify(value));},cache(){return _luminaFeedItems;}});';

const POST = '81000000-0000-4000-8000-000000000001';
const OTHER = '81000000-0000-4000-8000-000000000002';
const OWNER = '82000000-0000-4000-8000-000000000001';
const DRAFT = '  changed body  ';
const NEW_DRAFT = 'replacement draft';
const SERVER_BODY = 'server accepted body';
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixturePost(id, body) {
  return { id, body, authorUserId: OWNER, authorType: 'fan', authorName: 'Fixture',
    likeCount: 2, replyCount: 3, assets: [], viewer: { isAuthor: true, canEdit: true },
    permissions: { canEdit: true, editScope: 'body_only_mvp' } };
}

function world(t) {
  const stats = { attempts: 0, valid: 0, validationFailures: 0, domErrors: 0,
    handlerErrors: 0, renders: 0, toasts: 0, warnings: 0, alerts: 0 };
  const writes = [], allNodes = [], listeners = new Map(), uiTimers = new Map();
  const realTimers = new Set(), jobs = new Set();
  const entered = deferred(), response = deferred();
  let settled = false, serial = 0, timerSerial = 0, subject;
  const bodyChildren = [];
  function record(node, field) { writes.push({ node: node.id, field }); }
  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
  }
  function off(type, fn) { listeners.get(type)?.delete(fn); }
  function attach(node, connected) {
    node.isConnected = connected;
    for (const child of node.children) attach(child, connected);
  }
  class Node {
    constructor(kind) {
      this.id = ++serial;
      this.kind = kind;
      this.dataset = {};
      this.attributes = new Map();
      this.children = [];
      this.controls = new Map();
      this.events = new Map();
      this.isConnected = false;
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
        this.controls.set(selector, child);
        this.children.push(child);
      }
      this.cancel = new Node('cancel');
      this.children.push(this.cancel);
    }
    remove() {
      record(this, 'remove');
      const at = bodyChildren.indexOf(this);
      if (at >= 0) bodyChildren.splice(at, 1);
      attach(this, false);
    }
    focus() { record(this, 'focus'); document.activeElement = this; }
    setSelectionRange(start, end) {
      record(this, 'selection');
      this.selection = [start, end];
    }
  }
  const document = {
    activeElement: null,
    createElement(tag) {
      if (tag !== 'div') { stats.domErrors++; throw new Error('FIXTURE_ELEMENT'); }
      return new Node('modal');
    },
    body: { appendChild(node) { record(node, 'append'); bodyChildren.push(node); attach(node, true); } },
    addEventListener: on, removeEventListener: off
  };
  function flushUiTimers() {
    let count = 0;
    while (uiTimers.size) {
      assert.ok(++count <= 8, 'finite fixture UI timer drain');
      const [id, fn] = uiTimers.entries().next().value;
      uiTimers.delete(id);
      fn();
    }
  }
  function apiFetch(route, options) {
    stats.attempts++;
    try {
      assert.equal(stats.attempts, 1);
      assert.equal(route, '/api/v1/lumina-feed/posts/' + encodeURIComponent(POST));
      assert.equal(options.method, 'PATCH');
      assert.equal(options.auth, true);
      assert.equal(options.throwOnError, true);
      assert.equal(JSON.stringify(Object.keys(options.body)), '["body"]');
      assert.equal(options.body.body, DRAFT.trim());
      stats.valid++;
    } catch {
      stats.validationFailures++;
      entered.resolve();
      throw new Error('FIXTURE_API_VALIDATION');
    }
    entered.resolve();
    return response.promise;
  }
  async function bounded(promise, code) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(code)), 1000);
        realTimers.add(timer);
      })]);
    } finally { clearTimeout(timer); realTimers.delete(timer); }
  }
  function settle(value, fail = false) {
    assert.equal(settled, false, 'single synthetic response');
    settled = true;
    if (fail) response.reject(value); else response.resolve(value);
  }
  function fire(target) {
    const values = [];
    const event = { target, preventDefault() {}, stopPropagation() {} };
    for (const fn of [...(listeners.get('click') || [])]) values.push(fn(event));
    const job = Promise.all(values);
    jobs.add(job);
    job.then(() => jobs.delete(job), () => { jobs.delete(job); stats.handlerErrors++; });
    return job;
  }
  function snapshot() {
    return sha(JSON.stringify({ cache: subject.cache(), live: subject.live()?.id || null,
      nodes: allNodes.map(node => ({ id: node.id, connected: node.isConnected, value: node.value,
        text: node.textContent, disabled: node.disabled, hidden: node.hidden,
        attrs: [...node.attributes], dataset: node.dataset, selection: node.selection || null })),
      renders: stats.renders, toasts: stats.toasts, warnings: stats.warnings, alerts: stats.alerts,
      writes: writes.length }));
  }
  function counts() {
    assert.equal(stats.attempts, 1, 'attempts counted before fake API validation');
    assert.equal(stats.valid, 1);
    assert.equal(stats.validationFailures, 0, 'product catch cannot hide fake validation failure');
    assert.equal(stats.domErrors, 0);
    assert.equal(stats.handlerErrors, 0);
    assert.equal(stats.alerts, 0);
  }
  t.after(async () => {
    try {
      if (!settled) settle({ post: { id: POST, body: SERVER_BODY } });
      await bounded(Promise.allSettled([...jobs]), 'HANDLER_CLEANUP_TIMEOUT');
      if (subject) subject.close();
    } finally {
      for (const timer of realTimers) clearTimeout(timer);
      realTimers.clear();
      uiTimers.clear();
      listeners.clear();
      for (const node of bodyChildren.slice()) node.remove();
    }
    counts();
    assert.equal(bodyChildren.length, 0);
    assert.equal(realTimers.size + uiTimers.size + listeners.size + jobs.size, 0);
  });
  const context = vm.createContext({ document, apiFetch,
    getAuth: () => ({ user: { id: OWNER } }),
    renderLuminaFeed: () => { stats.renders++; },
    showLuminaToast: () => { stats.toasts++; },
    alert: () => { stats.alerts++; },
    console: { warn() { stats.warnings++; }, log() {}, error() {}, info() {} },
    setTimeout(fn, delay) {
      assert.equal(delay, 0, 'only genuine open-focus timer is scheduled');
      const id = ++timerSerial;
      uiTimers.set(id, fn);
      return id;
    },
    clearTimeout(id) { uiTimers.delete(id); }
  }, { codeGeneration: { strings: false, wasm: false } });
  subject = new vm.Script(genuine, { filename: 'genuine-feed-edit-fragments.js' })
    .runInContext(context, { timeout: 1000 });
  subject.seed([fixturePost(POST, 'initial body'), fixturePost(OTHER, 'other body')]);
  subject.bind();
  subject.bind();
  assert.equal(listeners.get('click')?.size, 2, 'genuine duplicate binding guard');
  return {
    stats, writes, subject, snapshot, counts, fire, settle,
    async open() {
      const card = new Node('edit');
      card.dataset.feedEdit = POST;
      await fire(card);
      flushUiTimers();
      const modal = subject.live();
      assert.ok(modal && modal.isConnected);
      assert.equal(modal.attributes.get('role'), 'dialog');
      return modal;
    },
    type(modal, value) {
      const node = modal.querySelector('textarea');
      node.value = value;
      for (const fn of node.events.get('input') || []) fn({ target: node });
    },
    async entry() { await bounded(entered.promise, 'API_ENTRY_TIMEOUT'); counts(); },
    async replace(old) {
      await fire(old.cancel);
      assert.equal(subject.live(), null, 'genuine delegated cancel calls genuine close');
      assert.equal(old.isConnected, false);
      const card = new Node('edit');
      card.dataset.feedEdit = POST;
      await fire(card);
      flushUiTimers();
      const next = subject.live();
      assert.ok(next && next !== old && next.isConnected, 'same post, genuinely new modal');
      return next;
    }
  };
}

test('feed edit normal save keeps route/body/normalization/close/render/toast behavior', { timeout: 5000 }, async t => {
  const w = world(t);
  const modal = await w.open();
  w.type(modal, DRAFT);
  const save = modal.querySelector('[data-feed-edit-save]');
  const otherBefore = sha(JSON.stringify(w.subject.cache()[1]));
  const job = w.fire(save);
  await w.entry();
  assert.equal(save.disabled, true);
  w.settle({ post: { id: POST, body: SERVER_BODY } });
  await job;
  w.counts();
  assert.equal(w.subject.live(), null);
  assert.equal(modal.isConnected, false);
  assert.equal(w.subject.cache()[0].body, SERVER_BODY);
  assert.equal(sha(JSON.stringify(w.subject.cache()[1])), otherBefore);
  assert.equal(w.stats.renders, 1);
  assert.equal(w.stats.toasts, 1);
  assert.equal(w.stats.warnings, 0);
  t.diagnostic(JSON.stringify({ phase: 'normal', attempts: w.stats.attempts,
    valid: w.stats.valid, renders: w.stats.renders, toasts: w.stats.toasts }));
});

test('old edit success after genuine close/reopen must preserve replacement modal and cache', { timeout: 5000 }, async t => {
  const w = world(t);
  const old = await w.open();
  w.type(old, DRAFT);
  const job = w.fire(old.querySelector('[data-feed-edit-save]'));
  await w.entry();
  const replacement = await w.replace(old);
  w.type(replacement, NEW_DRAFT);
  const before = w.snapshot();
  const writeCount = w.writes.length;
  w.settle({ post: { id: POST, body: SERVER_BODY } });
  await job;
  w.counts();
  t.diagnostic(JSON.stringify({ phase: 'stale-success', attempts: w.stats.attempts,
    valid: w.stats.valid, replacementCurrent: w.subject.live() === replacement,
    lateWrites: w.writes.length - writeCount, renders: w.stats.renders, toasts: w.stats.toasts }));
  assert.equal(w.subject.live() === replacement, true, 'old success must not close replacement');
  assert.equal(w.snapshot() === before, true, 'new draft/cache/render/toast and detached nodes stay unchanged');
  assert.equal(w.writes.length - writeCount, 0);
});

test('old edit failure after replacement must not touch detached nodes or release old busy state', { timeout: 5000 }, async t => {
  const w = world(t);
  const old = await w.open();
  w.type(old, DRAFT);
  const oldSave = old.querySelector('[data-feed-edit-save]');
  const job = w.fire(oldSave);
  await w.entry();
  const replacement = await w.replace(old);
  w.type(replacement, NEW_DRAFT);
  const before = w.snapshot();
  const writeCount = w.writes.length;
  w.settle(Object.assign(new Error('synthetic save failure'), { status: 500 }), true);
  await job;
  w.counts();
  t.diagnostic(JSON.stringify({ phase: 'stale-failure', attempts: w.stats.attempts,
    valid: w.stats.valid, lateWrites: w.writes.length - writeCount,
    oldDisabled: oldSave.disabled, warnings: w.stats.warnings }));
  assert.equal(w.writes.length - writeCount, 0, 'old catch must not write detached nodes');
  assert.equal(oldSave.disabled, true, 'old failure must not re-enable its retired save button');
  assert.equal(w.subject.live() === replacement, true);
  assert.equal(w.snapshot() === before, true);
});
