'use strict';
const { htmlWithoutFeedSearchLocaleDelta } = require('./support/feed-search-locale-html-inverse-20261015.cjs');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, realpathSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { runInNewContext } = require('node:vm');
const { TextDecoder } = require('node:util');

const CASE1 = 'NOTIFICATION.PAGEHIDE.01 retained GET header/body settlements stay retired until explicit fresh open';
const CASE2 = 'NOTIFICATION.PAGEHIDE.02 pending PATCH keeps sent lock without replay or stale rows and cannot release a different operation';
const profile = process.env.LUMINA_NOTIFICATION_LIFETIME_PROFILE || 'current';
const selected = process.env.LUMINA_NOTIFICATION_LIFETIME_CASES || 'both';
assert(['current', 'baseline'].includes(profile));
assert(['first', 'both'].includes(selected));
assert.equal(selected, profile === 'baseline' ? 'first' : 'both');
const sourceRoot = path.resolve(process.env.LUMINA_NOTIFICATION_LIFETIME_SOURCE_ROOT || path.join(__dirname, '..'));
if (profile === 'baseline') {
  assert.equal(selected, 'first');
  assert.match(sourceRoot.replace(/\\/g, '/'),
    /^E:\/Codex\/LuminaStage\/ai-entertainment-studio-git\/qa\/20261015-notification-page-lifetime\/baseline-[a-f0-9]{12}\/capsule$/i);
  assert.match((process.env.RELEASE_QA_GUARD_REPORT || '').replace(/\\/g, '/'),
    /^E:\/Codex\/LuminaStage\/ai-entertainment-studio-git\/qa\/20261015-notification-page-lifetime\/baseline-[a-f0-9]{12}\/guards\.json$/i);
}
const pins = {
  current: {
    script: ['ef2e556d094a94906ab1907e937c17490548ce3f2ecc6ba0bd14c979f56af809', 'f6650471312d03472263dee40b68e0bb0eb881e2'],
    html: ['d96758293441989728c303b98280e502cbf43a62d458049c7bb4acd9c721753b', 'c40eecdf38f35093c4b54c49f1b00080f451e3e4'],
    cache: 'notification-pagehide-20261015',
  },
  baseline: {
    script: ['c712369fc565e3f58fc0fe6916ee45f1d65351aa589eca194644f229e06df3b4', '366acdb47d93f8ec2270df59940895f4d17d3998'],
    html: ['ec998aa5cc500ba639787abf0220f0e8aac30b6d8b43a8be4b809957a82672c8', 'ff344c34eb8b39e70e17015c584934da09cf3b1b'],
    cache: 'notification-read-20261008',
  },
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
function admitted(relative, expected) {
  const file = path.resolve(sourceRoot, relative);
  assert.equal(path.resolve(realpathSync(file)).toLowerCase(), file.toLowerCase());
  const bytes = readFileSync(file);
  assert(bytes.length > 0 && bytes.length <= 131072);
  assert(!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), 'SOURCE_BOM_DENIED');
  const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const text = profile === 'current' && relative === 'lumina-feed/index.html'
    ? htmlWithoutFeedSearchLocaleDelta(decoded) : decoded;
  assert(!text.startsWith('\uFEFF') && !/\r(?!\n)/.test(text), 'SOURCE_LINE_ENDING_DENIED');
  assert(!(text.includes('\r\n') && text.replace(/\r\n/g, '').includes('\n')), 'SOURCE_MIXED_ENDING_DENIED');
  const lf = text.replace(/\r\n/g, '\n');
  const variants = [bytes, Buffer.from(lf), Buffer.from(lf.replace(/\n/g, '\r\n'))];
  assert(variants.some(value => sha(value) === expected[0] && blob(value) === expected[1]), 'EXACT_SOURCE_PIN_REQUIRED');
  return text;
}
const source = admitted('pages/feed-notifications.js', pins[profile].script);
const html = admitted('lumina-feed/index.html', pins[profile].html);
assert.equal(html.split('data-feed-notifications-root').length - 1, 1);
assert.equal(html.split('id="feedNotificationsOpen"').length - 1, 1);
assert.equal(html.split('/pages/feed-notifications.js?v=' + pins[profile].cache).length - 1, 1);

const ID = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const auth = () => ({ user: { id: ID(1) }, accessToken: 'synthetic-notification-access',
  refreshToken: 'synthetic-notification-refresh' });
const row = (n, read = false) => ({ id: ID(n), title: n < 20 ? 'Retired inbox item' : 'Current inbox item',
  body: null, createdAt: '2026-10-15T00:00:00.000Z', readAt: read ? '2026-10-15T01:00:00.000Z' : null });
const page = (notifications = [], unreadCount = notifications.filter(value => value.readAt === null).length) =>
  ({ notifications, unreadCount, nextCursor: null });
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function tick() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

function harness() {
  let savedAuth = auth();
  const requests = [], events = new Map(), documentEvents = new Map();
  const metrics = { storage: 0, network: 0, headers: 0 };
  const document = { activeElement: null, documentElement: { lang: 'en' }, readyState: 'complete' };
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
      this.attributes = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.handlers = new Map();
      this._text = ""; this.className = ""; this.id = ""; this.open = false;
      this.classList = { toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        const enabled = force ?? !names.has(name);
        if (enabled) names.add(name); else names.delete(name);
        this.className = [...names].join(" "); return enabled;
      } };
    }
    get isConnected() { return this === document.body || !!this.parentNode?.isConnected; }
    set textContent(text) { this.replaceChildren(); this._text = String(text); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
    set innerHTML(_) { throw new Error("Raw HTML is forbidden in this fixture"); }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ""; this.append(...nodes); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === "open") this.open = true; }
    removeAttribute(name) { delete this.attributes[name]; if (name === "open") this.open = false; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener(name, callback) { const list = this.handlers.get(name) || []; list.push(callback); this.handlers.set(name, list); }
    querySelectorAll(selector) {
      const found = [];
      const matches = node => selector.startsWith("#") ? node.id === selector.slice(1)
        : selector === "[data-feed-notifications-root]" ? Object.hasOwn(node.dataset, "feedNotificationsRoot")
          : node.tagName === selector.toUpperCase();
      const visit = node => { for (const child of node.children) { if (matches(child)) found.push(child); visit(child); } };
      visit(this); return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    focus() { if (this.isConnected) document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    fire(name, extra = {}) {
      const event = { target: this, key: "", defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const callback of this.handlers.get(name) || []) callback(event);
      return event;
    }
    click() { if (!this.disabled && !this.hidden) this.fire("click"); }
  }
  document.body = new Element("body");
  document.createElement = tag => new Element(tag);
  document.querySelector = selector => document.body.querySelector(selector);
  document.addEventListener = (name, callback) => {
    const handlers = documentEvents.get(name) || []; handlers.push(callback); documentEvents.set(name, handlers);
  };
  const root = new Element('div'); root.dataset.feedNotificationsRoot = '';
  const open = new Element('button'); open.id = 'feedNotificationsOpen'; open.hidden = true;
  root.append(open); document.body.append(root);
  const window = { addEventListener(name, callback) {
    const handlers = events.get(name) || []; handlers.push(callback); events.set(name, handlers);
  } };
  const storageDenied = () => { metrics.storage++; throw new Error('STORAGE_OUTSIDE_FIXTURE'); };
  Object.defineProperty(window, 'localStorage', { get: storageDenied });
  Object.defineProperty(window, 'sessionStorage', { get: storageDenied });
  const context = { document, window, URLSearchParams, Intl, Date,
    getAuth: () => plain(savedAuth),
    fetch() { metrics.network++; throw new Error('NETWORK_OUTSIDE_FIXTURE'); },
    apiFetch(route, options, retryDepth) {
      const method = options?.method || 'GET';
      if (method === 'GET') {
        assert.equal(route, '/api/v1/me/notifications?take=20');
        assert.deepEqual(plain(options), { auth: true, throwOnError: true });
        assert.equal(retryDepth, undefined);
      } else {
        assert.equal(method, 'PATCH');
        assert(/^\/api\/v1\/me\/notifications\/(?:read-all|00000000-0000-4000-8000-0000000000(?:10|20)\/read)$/.test(route));
        assert.deepEqual(plain(options), { auth: true, throwOnError: true, method: 'PATCH', body: {} });
        assert.equal(retryDepth, 1);
      }
      const headers = deferred(), body = deferred();
      const request = { route, method, retryDepth, headers, body, headersReleased: false };
      requests.push(request);
      // Synthetic transport phases only: actual apiFetch and browser HTTP are not loaded.
      return (async () => { await headers.promise; metrics.headers++; return await body.promise; })();
    },
  };
  Object.defineProperty(context, 'localStorage', { get: storageDenied });
  Object.defineProperty(context, 'sessionStorage', { get: storageDenied });
  runInNewContext(source, context, { filename: 'pages/feed-notifications.js', timeout: 1000 });
  return { root, open, document, requests, metrics,
    node: id => document.querySelector('#feedNotifications' + id),
    readers: () => root.querySelectorAll('button').filter(node => node.dataset.notificationId),
    emit(name, value = {}) { for (const callback of events.get(name) || []) callback(value); },
    renewSameOwner() { savedAuth = auth(); this.emit('lumina:authchange'); },
    async headers(index) {
      const request = requests[index]; assert(request);
      if (!request.headersReleased) { request.headersReleased = true; request.headers.resolve(); }
      await tick();
    },
    async failHeaders(index) {
      const request = requests[index]; assert(request && !request.headersReleased);
      request.headersReleased = true;
      request.headers.reject({ status: 500, message: 'SYNTHETIC_RETIRED_ERROR' });
      await tick();
    },
    async finish(index, data, reject = false) {
      await this.headers(index); // Attach the body consumer before rejecting a deferred body.
      if (reject) requests[index].body.reject({ status: 500, message: 'SYNTHETIC_RETIRED_ERROR' });
      else requests[index].body.resolve(data);
      await tick();
    },
  };
}
function noRevival(h) {
  assert.equal(h.node('List').textContent.includes('Retired inbox item'), false, 'NOTIFICATION_PAGEHIDE_RETIRED_GET');
  assert.equal(h.node('List').textContent, '');
  assert.equal(h.node('Count').textContent, '');
  assert.equal(h.node('Panel').hidden, true);
  assert.equal(h.node('Panel').getAttribute('aria-busy'), 'false');
  assert(!h.root.textContent.includes('SYNTHETIC_RETIRED_ERROR'));
}
function quiet(h, gets, patches) {
  assert.equal(h.requests.filter(value => value.method === 'GET').length, gets);
  assert.equal(h.requests.filter(value => value.method === 'PATCH').length, patches);
  assert.equal(h.metrics.storage, 0); assert.equal(h.metrics.network, 0);
}
function hideRestore(h) {
  h.emit('pagehide', { persisted: true });
  h.emit('pageshow', { persisted: true });
}

test(CASE1, { timeout: 10000 }, async () => {
  for (const phase of ['before-headers', 'after-headers']) for (const finish of ['receipt', 'error']) {
    const h = harness();
    quiet(h, 0, 0); h.open.click();
    assert.equal(h.requests.length, 1);
    assert.equal(h.node('Panel').getAttribute('aria-busy'), 'true');
    if (phase === 'after-headers') await h.headers(0);
    hideRestore(h);
    quiet(h, 1, 0);
    if (phase === 'before-headers' && finish === 'error') await h.failHeaders(0);
    else await h.finish(0, page([row(10)]), finish === 'error');
    // Baseline reaches this actual DOM oracle, not a pin/fixture/bootstrap failure.
    noRevival(h);
    h.open.click();
    quiet(h, 2, 0);
    await h.finish(1, page([row(20)]));
    assert.equal(h.node('Panel').hidden, false);
    assert(h.node('List').textContent.includes('Current inbox item'));
    assert(!h.node('List').textContent.includes('Retired inbox item'));
    assert.equal(h.node('Count').textContent, '1 unread');
    assert.equal(h.node('Panel').getAttribute('aria-busy'), 'false');
    assert.equal(h.readers()[0].disabled, false);
    quiet(h, 2, 0);
  }
});

if (selected === 'both') test(CASE2, { timeout: 10000 }, async () => {
  for (const all of [false, true]) for (const finish of ['receipt', 'error']) {
    const h = harness(); h.open.click(); await h.finish(0, page([row(10)]));
    const retained = h.readers()[0];
    if (all) h.node('ReadAll').click(); else retained.click();
    quiet(h, 1, 1);
    await h.headers(1);
    hideRestore(h);
    assert.equal(h.node('Panel').hidden, true);
    assert.equal(h.node('List').textContent, ''); assert.equal(h.node('Count').textContent, '');
    h.open.click();
    // A possibly sent same-session PATCH still owns the lock: reopening is not permission to replay.
    quiet(h, 1, 1);
    assert.equal(h.node('Panel').getAttribute('aria-busy'), 'true');
    assert.equal(h.node('Refresh').disabled, true);
    assert(h.node('Status').textContent.includes('Saving'));
    retained.fire('click'); h.node('ReadAll').fire('click'); h.node('Refresh').fire('click');
    quiet(h, 1, 1);
    await h.finish(1, all ? { ok: true, updatedCount: 1 } : { notification: row(10, true) }, finish === 'error');
    // Existing finally may unlock/render the empty current panel; that is legitimate, not old-row revival.
    assert.equal(h.node('List').textContent, ''); assert.equal(h.node('Count').textContent, '');
    assert.equal(h.node('Panel').getAttribute('aria-busy'), 'false');
    assert.equal(h.node('Refresh').disabled, false);
    assert(!h.root.textContent.includes('SYNTHETIC_RETIRED_ERROR'));
    quiet(h, 1, 1);
    h.node('Refresh').click(); quiet(h, 2, 1);
    await h.finish(2, page([row(20)]));
    assert(h.node('List').textContent.includes('Current inbox item'));
    assert.equal(h.node('Count').textContent, '1 unread');
    quiet(h, 2, 1);
  }
  for (const finish of ['receipt', 'error']) {
    const h = harness(); h.open.click(); await h.finish(0, page([row(10)]));
    h.readers()[0].click(); hideRestore(h);
    // Preservation control: same identity/key, but an existing auth epoch reset permits a different operation.
    h.renewSameOwner(); h.open.click(); await h.finish(2, page([row(20)]));
    h.readers()[0].click();
    quiet(h, 2, 2);
    await h.finish(1, { notification: row(10, true) }, finish === 'error');
    assert.equal(h.node('Panel').getAttribute('aria-busy'), 'true');
    assert.equal(h.node('Refresh').disabled, true);
    assert.equal(h.node('Count').textContent, '1 unread');
    assert(h.node('List').textContent.includes('Current inbox item'));
    assert(!h.root.textContent.includes('Retired inbox item'));
    assert(!h.root.textContent.includes('SYNTHETIC_RETIRED_ERROR'));
    h.node('ReadAll').fire('click'); quiet(h, 2, 2);
    await h.finish(3, { notification: row(20, true) });
    assert.equal(h.node('Count').textContent, '0 unread');
    assert.equal(h.node('Panel').getAttribute('aria-busy'), 'false');
    assert.equal(h.readers().length, 0);
    quiet(h, 2, 2);
  }
});
