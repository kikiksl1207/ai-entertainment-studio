import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { setImmediate as tick } from 'node:timers/promises';

const source = (await readFile(new URL('../pages/story-stage.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const canonical = await readFile(new URL('../pages/story-canonical-read.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../story-stage/index.html', import.meta.url), 'utf8');
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const sentences = { ko: '합성 결말입니다.', en: 'Synthetic ending.', ja: '合成の結末です。',
  'zh-Hans': '合成结局。', 'zh-Hant': '合成結局。' };
const labels = { ko: ['읽기 완료', '읽기 완료됨'], en: ['Mark as read', 'Read'], ja: ['読了する', '読了済み'],
  'zh-Hans': ['标记为已读', '已读'], 'zh-Hant': ['標記為已讀', '已讀'] };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const decode = value => String(value).replace(/&#13;/g, '\r').replace(/&#39;/g, "'")
  .replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

function projection(locale = 'en', positions = [1, 2, 3, 4, 5, 6], position = positions.at(-1)) {
  return { progressId: id(2), workId: id(3), revision: 7, status: 'completed', storyVersion: 1,
    activeReleaseId: id(4), releaseCapability: { revision: 1, source: 'approved' },
    currentGeneratedSceneId: id(5), currentAct: 1, currentBeatPosition: position, part: { id: id(6) }, choices: [],
    scene: { id: id(5), title: { value: 'Synthetic ending scene' }, isGenerated: true, deliveryState: 'ready',
      endingType: 'ai_generated', beats: positions.map((position, index) => ({ id: id(10 + index), position,
        type: 'paragraph', content: { value: `${sentences[locale]} ${index + 1}.`, locale, fallback: false } })) } };
}

// Small synthetic DOM surface, not a browser or a visual/attention simulation.
// The complete current IIFE, real renderScene, event listeners and request helper run below.
function host() {
  let markup = '', nodes = [];
  const listeners = new Map();
  const element = (tag, attributes = '', text = '') => {
    const attrs = Object.fromEntries(Array.from(attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g),
      match => [match[1], decode(match[2] ?? '')]));
    const dataset = Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-'))
      .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
    return { tag, attrs, dataset, textContent: decode(text), isConnected: true, disabled: 'disabled' in attrs,
      hidden: false, inert: false, scrollTop: 0, paragraphs: [], focus() {}, scrollIntoView() {},
      setAttribute(key, value) { this.attrs[key] = value; },
      matches(selector) { return selector.split(',').some(part => {
        part = part.trim();
        if (part === tag) return true;
        if (part.startsWith('.')) return (attrs.class || '').split(' ').includes(part.slice(1));
        const match = part.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
        return Boolean(match && match[1] in attrs && (match[2] === undefined || attrs[match[1]] === match[2]));
      }); },
      closest(selector) { return selector === '[hidden], [inert]' ? this.hidden || this.inert ? this : null
        : this.matches(selector) ? this : null; },
      querySelectorAll(selector) { return selector === 'p' ? this.paragraphs : []; },
    };
  };
  const root = { isConnected: true, attrs: {},
    addEventListener: (name, callback) => listeners.set(name, callback),
    setAttribute(key, value) { this.attrs[key] = value; },
    contains: node => root.isConnected && nodes.includes(node),
    querySelector: selector => nodes.find(node => node.matches(selector)) || null,
    querySelectorAll: selector => nodes.filter(node => node.matches(selector)),
    insertAdjacentHTML: () => {},
    click: selector => {
      const target = root.querySelector(selector);
      assert.ok(target, `Missing mounted button ${selector}`);
      if (target.disabled) return;
      return listeners.get('click')({ target, preventDefault() {} });
    },
    get innerHTML() { return markup; },
    set innerHTML(value) {
      for (const node of nodes) node.isConnected = false;
      markup = value;
      nodes = Array.from(value.matchAll(/<(button|article|output|h2|div|p|section)\b([^>]*)>/g),
        match => element(match[1], match[2]));
      for (const node of nodes) {
        const attribute = Object.keys(node.attrs).find(key => key.startsWith('data-story-ending-read') && key.endsWith('status'));
        if (node.tag === 'button' || attribute) {
          const marker = node.tag === 'button' ? 'button' : 'p';
          const found = Array.from(value.matchAll(new RegExp(`<${marker}\\b([^>]*)>([\\s\\S]*?)<\\/${marker}>`, 'g')))
            .find(match => Object.entries(node.attrs).every(([key, val]) => match[1].includes(val ? `${key}="${val}"` : key)));
          if (found) node.textContent = decode(found[2].replace(/<[^>]*>/g, ''));
        }
      }
      const article = root.querySelector('[data-story-scene-focus]');
      const contents = value.match(/<article\b[^>]*>([\s\S]*?)<\/article>/)?.[1];
      if (article && contents) article.paragraphs = Array.from(contents.matchAll(/<p>([\s\S]*?)<\/p>/g),
        match => ({ textContent: decode(match[1]) }));
    },
  };
  return root;
}

function fixture(options = {}) {
  const root = host();
  const listeners = new Map(), timers = new Map(), calls = [], failures = [];
  let timerId = 0, locale = options.locale || 'en';
  let auth = { user: { id: id(1) }, accessToken: 'synthetic-reader-token' };
  const location = { origin: 'https://fixture.invalid', pathname: '/story-stage',
    search: `?sessionId=${id(2)}&workId=${id(3)}`, hash: '' };
  const f = { root, location, calls, failures, receipts: new Map(),
    server: plain(options.progress || projection(locale, options.positions, options.position)),
    auth: () => auth,
    setAuth: value => { auth = value; },
    emit: (name, event = {}) => Promise.all((listeners.get(name) || []).map(callback => callback(event))),
    setLocale: value => { locale = value; },
    posts: () => calls.filter(call => call.method === 'POST'),
    reviews: () => calls.filter(call => call.path.includes('/generated-ending-read?')),
    expire: () => {
      const last = Array.from(timers.values()).at(-1);
      assert.ok(last, 'Expected a registered local deadline');
      last();
    },
  };
  f.review = entry => {
    const url = new URL(entry.path, location.origin);
    const fromPosition = Number(url.searchParams.get('fromPosition') ?? entry.body.fromPosition);
    const selected = f.server.scene.beats.filter(beat => beat.position >= fromPosition).sort((a, b) => a.position - b.position);
    const memberText = beat => (typeof beat.content === 'string' ? beat.content : beat.content?.value) || beat.text || beat.body || '';
    const sourceTextHash = hash(JSON.stringify(selected.map(beat => [beat.id, beat.position,
      memberText(beat).replace(/\\r\\n|\\n|\\r/gu, '\n')])));
    const scopeChecksum = hash(JSON.stringify([auth?.user.id, f.server.progressId, f.server.workId,
      f.server.scene.id, f.server.activeReleaseId, location.search, url.searchParams.get('locale') ?? entry.body.locale,
      fromPosition, sourceTextHash]));
    const value = { contract: 'story-generated-ending-read-review-v1', progressId: f.server.progressId,
      workId: f.server.workId, sceneId: f.server.scene.id, locale: url.searchParams.get('locale') ?? entry.body.locale,
      fromPosition, throughPosition: selected.at(-1).position, expectedRevision: f.server.revision,
      scopeChecksum, sourceTextHash, confirmation: f.receipts.get(scopeChecksum) || null };
    return value;
  };
  f.receipt = preview => ({ contract: 'story-generated-ending-read-receipt-v1', receiptId: id(50),
    ...Object.fromEntries(['progressId', 'workId', 'sceneId', 'locale', 'fromPosition', 'throughPosition',
      'scopeChecksum', 'sourceTextHash'].map(key => [key, preview[key]])),
    progressRevision: preview.expectedRevision, confirmedAt: '2026-10-05T16:20:00.000Z', idempotentReplay: false,
    progressMutated: false, generationStarted: false, imageGenerationStarted: false,
    meaningApproved: false, qualityApproved: false, publicationStarted: false });
  f.commit = entry => {
    const preview = f.review(entry);
    const receipt = f.receipt(preview);
    f.receipts.set(preview.scopeChecksum, receipt);
    return plain(receipt);
  };
  const dispatch = async (path, config, transport) => {
    const entry = { path, method: config.method || 'GET', signal: config.signal, cache: config.cache,
      headers: config.headers || {}, transport, body: config.body && (typeof config.body === 'string' ? JSON.parse(config.body) : plain(config.body)) };
    calls.push(entry);
    if (path.includes('/current-scene?')) return options.onScene ? options.onScene(entry, f) : plain(f.server);
    if (path.endsWith('/progress-state')) return { fullResetRemaining: 2, actResetRemaining: 2,
      canFullReset: true, canActReset: true };
    if (path.endsWith('/generated-ending-read/confirm')) return options.onPost ? options.onPost(entry, f) : f.commit(entry);
    if (path.includes('/generated-ending-read?')) {
      const preview = f.review(entry);
      return options.onReview ? options.onReview(preview, entry, f) : preview;
    }
    if (path.includes('/beat?') && entry.method === 'POST') {
      assert.deepEqual(Object.keys(entry.body).sort(), ['expectedRevision', 'position']);
      assert.equal(entry.body.expectedRevision, f.server.revision);
      f.server.currentBeatPosition = entry.body.position;
      f.server.revision += 1;
      return plain(f.server);
    }
    if (path.includes('/reset-preview?')) return { expectedRevision: f.server.revision, target: 'full',
      canExecute: true, remainingAfter: 1, targetAct: 1, invalidatedEventCount: 0 };
    if (path.endsWith('/reset')) {
      f.server = projection(locale, undefined, 0);
      f.server.revision += 10;
      f.server.scene.id = id(90);
      f.server.currentGeneratedSceneId = id(90);
      f.receipts.clear();
      return { afterRevision: f.server.revision };
    }
    assert.fail(`Unexpected external/action request ${entry.method} ${path}`);
  };
  const window = { crypto: options.crypto || webcrypto, getAuth: () => auth,
    isLoggedIn: () => Boolean(auth), luminaI18n: { getLocale: () => locale },
    addEventListener(name, callback) { listeners.set(name, [...listeners.get(name) || [], callback]); },
    apiFetch: (path, config) => dispatch(path, config, 'helper'),
  };
  const fetch = async (url, config) => {
    try {
      const body = await dispatch(new URL(url).pathname + new URL(url).search, config, 'fetch');
      return { ok: true, status: 200, json: async () => options.onJson ? options.onJson(plain(body), config, f) : plain(body) };
    } catch (error) {
      if (!error.status) throw error;
      return { ok: false, status: error.status, json: async () => ({ error: { code: error.code || 'SYNTHETIC_FAILURE', message: 'INTERNAL_DO_NOT_RENDER' } }) };
    }
  };
  const document = { activeElement: null,
    getElementById: name => name === 'storyStageRoot' ? root : { textContent: '', focus() {} },
    querySelector: () => null, addEventListener() {} };
  const context = { window, document, location, URL, URLSearchParams, TextEncoder, ArrayBuffer, Uint8Array,
    AbortController, crypto: window.crypto, fetch,
    setTimeout: (callback, milliseconds) => { assert.ok([15000, 45000].includes(milliseconds)); timers.set(++timerId, callback); return timerId; },
    clearTimeout: value => timers.delete(value),
  };
  const anchor = '\n  updateHeading();\n  if (state.sessionId) loadScene();';
  assert.equal(source.split(anchor).length, 2, 'Expose real functions only at the current bootstrap');
  const instrumented = source.replace(anchor,
    '\n  window.testApi = { state, loadScene, renderScene, readableBeats, endingReadTarget, confirmEndingRead, checkEndingRead, cancelEndingRead, canonicalReadTarget, turnBeat, requestResetPreview, confirmReset };' + anchor);
  runInNewContext(canonical + '\n' + instrumented, context, { timeout: 1000 });
  f.api = window.testApi;
  f.state = f.api.state;
  f.ready = async () => {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      await tick();
      if (!f.state.scenePending && !f.state.endingReadOperation && (f.state.progress || f.root.innerHTML.includes('<h2>'))) return;
    }
    assert.fail('Synthetic reader did not settle');
  };
  f.confirm = () => f.root.click('[data-story-ending-read]');
  f.button = () => f.root.querySelector('[data-story-ending-read]');
  return f;
}

function assertReadPost(f, locale, fromPosition, expectedRevision) {
  const posts = f.posts().filter(call => call.path.endsWith('/generated-ending-read/confirm'));
  assert.equal(posts.length, 1);
  const post = posts[0];
  assert.equal(post.path, `/api/v1/me/story-progress/${id(2)}/generated-ending-read/confirm`);
  assert.deepEqual(Object.keys(post.body).sort(), ['displayedAndRead', 'expectedRevision', 'expectedScopeChecksum',
    'expectedSourceTextHash', 'fromPosition', 'idempotencyKey', 'locale']);
  assert.equal(post.body.locale, locale);
  assert.equal(post.body.fromPosition, fromPosition);
  assert.equal(post.body.expectedRevision, expectedRevision);
  assert.equal(post.body.displayedAndRead, true);
  assert.match(post.body.expectedScopeChecksum, /^[0-9a-f]{64}$/);
  assert.match(post.body.expectedSourceTextHash, /^[0-9a-f]{64}$/);
  assert.match(post.body.idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(post.transport, 'fetch');
  assert.equal(post.cache, 'no-store');
  assert.equal(post.headers.Authorization, 'Bearer synthetic-reader-token');
  assert.ok(post.signal);
  const generatedCalls = f.calls.filter(call => call.path.includes('/generated-ending-read'));
  assert.ok(generatedCalls.every(call => call.transport === 'fetch' && call.cache === 'no-store' && call.signal));
  assert.ok(!f.root.innerHTML.includes('INTERNAL_DO_NOT_RENDER'));
  return post;
}

for (const locale of locales) {
  test(`${locale}: real mount GET is readonly; explicit click preflights, hashes raw final members and confirms independently`, async () => {
    const f = fixture({ locale });
    await f.ready();
    assert.equal(f.posts().length, 0);
    assert.equal(f.reviews().length, 1);
    assert.equal(f.reviews()[0].path, `/api/v1/me/story-progress/${id(2)}/generated-ending-read?locale=${locale}&fromPosition=5`);
    assert.equal(f.button().textContent, labels[locale][0]);
    assert.equal(f.button().disabled, false);
    const before = plain(f.state.progress);
    await f.confirm();
    const post = assertReadPost(f, locale, 5, 7);
    assert.equal(f.reviews().length, 2, 'An explicit click always gets a fresh review');
    assert.equal(post.body.expectedSourceTextHash, hash(JSON.stringify(f.server.scene.beats.slice(-2)
      .map(beat => [beat.id, beat.position, beat.content.value]))));
    assert.equal(f.state.endingRead.status, 'saved');
    assert.equal(f.button().textContent, labels[locale][1]);
    assert.equal(f.button().disabled, true);
    assert.deepEqual(plain(f.state.progress), before, 'Receipt never updates cursor, revision, status or choices');
    assert.equal(f.state.minimumRevision, 7);
    assert.equal(f.api.canonicalReadTarget(), null);
    await f.confirm();
    assert.equal(f.posts().length, 1);
  });
}

test('ordinary navigation to the final page is not a confirmation, even with the last cursor already saved', async () => {
  const f = fixture({ position: 0 });
  await f.ready();
  assert.equal(f.button(), null);
  assert.equal(f.reviews().length, 0);
  await f.api.turnBeat(1);
  await f.api.turnBeat(1);
  await f.ready();
  assert.equal(f.state.progress.currentBeatPosition, 6);
  assert.equal(f.state.progress.revision, 9);
  assert.equal(f.state.endingRead.status, 'idle');
  assert.equal(f.button().textContent, labels.en[0]);
  assert.deepEqual(f.posts().map(call => call.body.position), [4, 6]);
  await f.confirm();
  assertReadPost(f, 'en', 5, 9);
  assert.equal(f.state.progress.currentBeatPosition, 6);
  assert.equal(f.state.progress.revision, 9);
});

test('verified older receipt survives pagination only after a fresh server GET, not a cursor or revision comparison', async () => {
  const f = fixture();
  await f.ready();
  await f.confirm();
  const key = f.state.endingRead.key;
  const receiptId = f.state.endingRead.receipt.receiptId;
  await f.api.turnBeat(-1);
  assert.equal(f.state.endingRead.key, key);
  assert.equal(f.state.endingRead.receipt, null);
  assert.equal(f.button(), null);
  await f.api.turnBeat(1);
  await f.ready();
  assert.equal(f.state.endingRead.key, key);
  assert.equal(f.state.endingRead.receipt.receiptId, receiptId);
  assert.equal(f.state.endingRead.receipt.progressRevision, 7);
  assert.equal(f.state.progress.revision, 9);
  assert.equal(f.state.endingRead.status, 'saved');
  assert.equal(f.reviews().length, 3);
  assert.equal(f.posts().filter(call => call.path.endsWith('/confirm')).length, 1);
  f.receipts.clear();
  await f.api.turnBeat(-1);
  await f.api.turnBeat(1);
  await f.ready();
  assert.equal(f.state.endingRead.status, 'unknown');
  assert.equal(f.state.endingRead.receipt, null, 'Server null must remove the previous saved label');
  await f.confirm();
  assert.equal(f.posts().filter(call => call.path.endsWith('/confirm')).length, 1, 'Unknown confirmation is GET-only');
});

test('initial final-page GET can recover a valid old receipt without any POST', async () => {
  const f = fixture({ onReview: (preview, entry, f) => ({ ...preview,
    ownuserId: id(1), userId: id(1),
    confirmation: { ...f.receipt(preview), progressRevision: 2, idempotentReplay: true } }) });
  await f.ready();
  assert.equal(f.state.endingRead.status, 'saved');
  assert.equal(f.button().textContent, labels.en[1]);
  assert.equal(f.posts().length, 0);
});

test('lost POST reconciles a historical receipt whose revision is below the current review revision', async () => {
  const f = fixture({ onPost: (entry, f) => {
    const preview = f.review(entry);
    f.receipts.set(preview.scopeChecksum, { ...f.receipt(preview), progressRevision: 2 });
    throw new Error('Synthetic response loss');
  } });
  await f.ready();
  await f.confirm();
  assert.equal(f.state.endingRead.status, 'saved');
  assert.equal(f.state.endingRead.receipt.progressRevision, 2);
  assert.equal(f.state.progress.revision, 7);
  assert.equal(f.reviews().length, 3);
  assertReadPost(f, 'en', 5, 7);
});

test('POST receipt must have the confirmation revision even if idempotentReplay is true', async () => {
  const f = fixture({ onPost: (entry, f) => ({ ...f.receipt(f.review(entry)), progressRevision: 2, idempotentReplay: true }) });
  await f.ready();
  await f.confirm();
  assert.equal(f.state.endingRead.status, 'unknown');
  assert.equal(f.state.endingRead.receipt, null);
  assert.equal(f.reviews().length, 3);
  assertReadPost(f, 'en', 5, 7);
});

for (const [field, value] of Object.entries({
  contract: 'other', progressId: id(99), workId: id(99), sceneId: id(99), locale: 'ko',
  fromPosition: 4, throughPosition: 5, expectedRevision: 6, sourceTextHash: 'e'.repeat(64), scopeChecksum: 'invalid',
  confirmation: undefined,
})) {
  test(`invalid review ${field}: fresh preflight prevents POST and any saved label`, async () => {
    const f = fixture({ onReview: (preview, entry, f) => f.reviews().length === 2 ? { ...preview, [field]: value } : preview });
    await f.ready();
    await f.confirm();
    assert.equal(f.state.endingRead.status, 'changed');
    assert.equal(f.state.endingRead.receipt, null);
    assert.equal(f.posts().length, 0);
    assert.equal(f.reviews().length, 2);
  });
}

test('pending initial review is aborted by pagination and cannot set a late saved label', async () => {
  const gate = deferred(), started = deferred();
  const f = fixture({ onReview: async (preview, entry, f) => {
    if (f.reviews().length === 1) {
      started.resolve();
      await gate.promise;
      return { ...preview, confirmation: f.receipt(preview) };
    }
    return preview;
  } });
  await started.promise;
  const first = f.reviews()[0];
  await f.api.turnBeat(-1);
  assert.equal(first.signal.aborted, true);
  gate.resolve();
  await tick();
  assert.equal(f.state.endingRead.receipt, null);
  await f.api.turnBeat(1);
  await f.ready();
  assert.equal(f.state.endingRead.status, 'idle');
  assert.equal(f.button().textContent, labels.en[0]);
  assert.equal(f.posts().filter(call => call.path.endsWith('/confirm')).length, 0);
});

test('remounting the same page aborts the old lookup and verifies only the fresh mounted article', async () => {
  const gate = deferred(), started = deferred();
  const f = fixture({ onReview: async (preview, entry, f) => {
    if (f.reviews().length === 1) {
      started.resolve();
      await gate.promise;
      return { ...preview, confirmation: f.receipt(preview) };
    }
    return preview;
  } });
  await started.promise;
  const first = f.reviews()[0];
  f.api.renderScene();
  assert.equal(first.signal.aborted, true);
  gate.resolve();
  await f.ready();
  assert.equal(f.state.endingRead.status, 'idle');
  assert.equal(f.button().disabled, false);
  assert.equal(f.reviews().length, 2);
  assert.equal(f.posts().length, 0);
});

test('initial zero cursor and sparse positive raw positions hash escaped CR/LF exactly, including merged paragraphs', async () => {
  const p = projection('en', [1, 4], 0);
  p.scene.beats[0].content = 'Raw\\r\\n\\nline without punctuation ';
  p.scene.beats[1].content = 'continues\\nthen ends.\r\n\r\nLast paragraph.  ';
  const f = fixture({ progress: p });
  await f.ready();
  assert.equal(f.api.readableBeats().beats.length, 1);
  assert.deepEqual(f.root.querySelector('[data-story-scene-focus]').paragraphs.map(paragraph => paragraph.textContent),
    ['Raw', 'line without punctuation continues\nthen ends.\r', 'Last paragraph.']);
  await f.confirm();
  const post = assertReadPost(f, 'en', 1, 7);
  assert.equal(post.body.expectedSourceTextHash, hash(JSON.stringify([
    [id(10), 1, 'Raw\n\nline without punctuation '],
    [id(11), 4, 'continues\nthen ends.\r\n\r\nLast paragraph.  '],
  ])));
});

test('double click serializes the fresh review and sends one POST with a stable UUID', async () => {
  const gate = deferred(), started = deferred();
  const f = fixture({ onReview: async (preview, entry, f) => {
    if (f.reviews().length === 2) { started.resolve(); await gate.promise; }
    return preview;
  } });
  await f.ready();
  const first = f.api.confirmEndingRead();
  await started.promise;
  await f.api.confirmEndingRead();
  assert.equal(f.state.busy, true);
  assert.equal(f.reviews().length, 2);
  assert.equal(f.posts().length, 0);
  gate.resolve();
  await first;
  assertReadPost(f, 'en', 5, 7);
  assert.equal(f.state.endingRead.idempotencyKey, f.posts()[0].body.idempotencyKey);
  assert.equal(f.state.busy, false);
});

for (const outcome of ['committed-lost', 'not-committed', 'invalid-post', 'reconcile-failure', 'deadline']) {
  test(`${outcome}: lost/invalid POST reconciles readonly and never replays a write`, async () => {
    const started = deferred();
    const f = fixture({ onPost: async (entry, f) => {
      const receipt = outcome === 'not-committed' || outcome === 'reconcile-failure' ? null : f.commit(entry);
      if (outcome === 'invalid-post') return { ...receipt, progressMutated: true };
      if (outcome === 'deadline') {
        started.resolve();
        return new Promise((resolve, reject) => entry.signal.addEventListener('abort',
          () => reject(Object.assign(new Error('Synthetic deadline'), { name: 'AbortError' })), { once: true }));
      }
      throw new Error('Synthetic response loss');
    }, onReview: (preview, entry, f) => {
      if (outcome === 'reconcile-failure' && f.reviews().length > 2) throw new Error('Synthetic GET failure');
      return preview;
    } });
    await f.ready();
    const before = plain(f.state.progress);
    const confirming = f.confirm();
    if (outcome === 'deadline') { await started.promise; f.expire(); }
    await confirming;
    const saved = ['committed-lost', 'invalid-post', 'deadline'].includes(outcome);
    assert.equal(f.state.endingRead.status, saved ? 'saved' : 'unknown');
    assert.equal(Boolean(f.state.endingRead.receipt), saved);
    assert.equal(f.reviews().length, 3);
    assertReadPost(f, 'en', 5, 7);
    assert.deepEqual(plain(f.state.progress), before);
    if (!saved) { await f.confirm(); assert.equal(f.posts().length, 1); }
  });
}

for (const status of [401, 403]) {
  test(`${status} first readonly GET: blocks without native-to-helper auth replay or confirmation writes`, async () => {
    const f = fixture({ onReview: () => { throw { status }; } });
    await f.ready();
    assert.equal(f.state.scene, null);
    assert.equal(f.state.endingRead, null);
    assert.equal(f.state.endingReadOperation, null);
    assert.equal(f.reviews().length, 1);
    assert.equal(f.reviews()[0].transport, 'fetch');
    assert.equal(f.posts().length, 0);
    assert.equal(f.state.progress.revision, 7);
    assert.ok(!f.root.innerHTML.includes('INTERNAL_DO_NOT_RENDER'));
  });
  for (const phase of ['review', 'post']) {
    test(`${status} ${phase}: auth denial blocks the scene without helper auth replay or a second POST`, async () => {
      const f = fixture({ onReview: (preview, entry, f) => {
        if (phase === 'review' && f.reviews().length === 2) throw { status };
        return preview;
      }, onPost: () => { throw { status }; } });
      await f.ready();
      await f.confirm();
      assert.equal(f.state.scene, null);
      assert.equal(f.state.endingRead, null);
      assert.equal(f.state.busy, false);
      assert.equal(f.posts().length, phase === 'post' ? 1 : 0);
      assert.equal(f.reviews().length, 2);
      assert.ok(f.calls.filter(call => call.path.includes('/generated-ending-read')).every(call => call.transport === 'fetch'));
      assert.ok(!f.root.innerHTML.includes('INTERNAL_DO_NOT_RENDER'));
    });
  }
}

for (const phase of ['review', 'post']) {
  test(`stale ${phase} revision blocks confirmation with no POST replay or cursor write`, async () => {
    const f = fixture({ onReview: (preview, entry, f) => f.reviews().length === 2 && phase === 'review'
      ? { ...preview, expectedRevision: 8 } : preview,
    onPost: () => { throw { status: 409 }; } });
    await f.ready();
    await f.confirm();
    assert.equal(f.state.endingRead.status, 'changed');
    assert.equal(f.state.progress.revision, 7);
    assert.equal(f.state.progress.currentBeatPosition, 6);
    assert.equal(f.posts().length, phase === 'post' ? 1 : 0);
    assert.equal(f.reviews().length, 2);
    await f.api.confirmEndingRead();
    assert.equal(f.reviews().length, 2);
    assert.ok(f.root.querySelector('[data-story-ending-read-refresh]'));
  });
}

const invalidReceipts = {
  contract: 'other', receiptId: '', progressId: id(99), workId: id(99), sceneId: id(99), locale: 'ko',
  fromPosition: 4, throughPosition: 5, scopeChecksum: 'f'.repeat(64), sourceTextHash: 'f'.repeat(64),
  progressRevision: 8, confirmedAt: 'not-iso', idempotentReplay: 'false', progressMutated: true,
  generationStarted: true, imageGenerationStarted: true, meaningApproved: true, qualityApproved: true, publicationStarted: true,
};
for (const [field, value] of Object.entries(invalidReceipts)) {
  test(`invalid receipt ${field}: neither GET nor POST claims a saved confirmation`, async () => {
    const initial = fixture({ onReview: (preview, entry, f) => ({ ...preview,
      confirmation: { ...f.receipt(preview), [field]: value } }) });
    await initial.ready();
    assert.equal(initial.state.endingRead.status, 'unknown');
    assert.equal(initial.state.endingRead.receipt, null);
    assert.equal(initial.posts().length, 0);
    assert.notEqual(initial.button().textContent, labels.en[1]);
    const post = fixture({ onPost: (entry, f) => ({ ...f.receipt(f.review(entry)), [field]: value }) });
    await post.ready();
    await post.confirm();
    assert.equal(post.state.endingRead.status, 'unknown');
    assert.equal(post.state.endingRead.receipt, null);
    assert.equal(post.posts().length, 1);
    assert.equal(post.reviews().length, 3);
  });
}

for (const [name, change] of Object.entries({
  text: article => { article.paragraphs[0].textContent += ' Altered.'; },
  missing: article => { article.paragraphs.pop(); },
  extra: article => { article.paragraphs.push({ textContent: 'Injected paragraph.' }); },
  hidden: article => { article.hidden = true; },
  inert: article => { article.inert = true; },
  disconnected: article => { article.isConnected = false; },
  key: article => { article.dataset.readingKey = 'other'; },
})) {
  test(`display mismatch ${name}: explicit confirmation refuses before GET/POST`, async () => {
    const f = fixture();
    await f.ready();
    change(f.root.querySelector('[data-story-scene-focus]'));
    await f.api.confirmEndingRead();
    assert.equal(f.posts().length, 0);
    assert.equal(f.reviews().length, 1);
  });
}

for (const phase of ['review', 'post']) {
  test(`${phase}: body or DOM changes during the request invalidate late responses`, async () => {
    for (const mutate of [f => { f.state.scene.beats[4].content.value += ' Altered.'; },
      f => { f.root.querySelector('[data-story-scene-focus]').paragraphs[0].textContent += ' Altered.'; }]) {
      const gate = deferred(), started = deferred();
      const f = fixture({ onReview: async (preview, entry, f) => {
        if (phase === 'review' && f.reviews().length === 2) { started.resolve(); await gate.promise; }
        return preview;
      }, onPost: async (entry, f) => { const receipt = f.receipt(f.review(entry)); started.resolve(); await gate.promise; return receipt; } });
      await f.ready();
      const pending = f.confirm();
      await started.promise;
      mutate(f);
      gate.resolve();
      await pending;
      assert.equal(f.state.endingRead, null);
      assert.equal(f.posts().length, phase === 'review' ? 0 : 1);
      assert.equal(f.state.progress.revision, 7);
      assert.equal(f.state.busy, false);
    }
  });
}

for (const [name, change] of Object.entries({
  owner: f => f.setAuth({ user: { id: id(99) }, accessToken: 'other-token' }),
  token: f => f.setAuth({ user: { id: id(1) }, accessToken: 'changed-token' }),
  progress: f => { f.state.sessionId = id(99); },
  payloadProgress: f => { f.state.progress.progressId = id(99); },
  locale: f => { f.state.locale = 'ja'; },
  scene: f => { f.state.scene.id = id(99); },
  release: f => { f.state.progress.activeReleaseId = id(99); },
  part: f => { f.state.progress.part.id = id(99); },
  revision: f => { f.state.progress.revision += 1; },
  route: f => { f.location.hash = '#changed'; },
  arrival: f => { f.state.progress.path = [{ generatedSceneId: id(99) }]; },
  root: f => { f.root.isConnected = false; },
  epoch: f => { f.state.epoch += 1; },
  reset: f => { f.state.resetPreview = { expectedRevision: 7 }; },
})) {
  test(`late ${name} response is ignored before POST and after POST`, async () => {
    for (const phase of ['review', 'post']) {
      const gate = deferred(), started = deferred();
      const f = fixture({ onReview: async (preview, entry, f) => {
        if (phase === 'review' && f.reviews().length === 2) { started.resolve(); await gate.promise; }
        return preview;
      }, onPost: async (entry, f) => { const receipt = f.receipt(f.review(entry)); started.resolve(); await gate.promise; return receipt; } });
      await f.ready();
      const pending = f.confirm();
      await started.promise;
      change(f);
      const before = plain(f.state.progress);
      gate.resolve();
      await pending;
      assert.equal(f.state.endingRead, null);
      assert.equal(f.posts().length, phase === 'review' ? 0 : 1);
      assert.deepEqual(plain(f.state.progress), before);
      assert.equal(f.state.busy, false);
    }
  });
}

test('auth changes during actual request JSON resolution cannot promote a stale review or receipt', async () => {
  for (const phase of ['review', 'post']) {
    const gate = deferred(), started = deferred();
    const f = fixture({ onJson: async (body, config, f) => {
      if ((phase === 'review' && body.contract === 'story-generated-ending-read-review-v1' && f.reviews().length === 2) ||
          (phase === 'post' && body.contract === 'story-generated-ending-read-receipt-v1')) {
        started.resolve();
        await gate.promise;
      }
      return body;
    } });
    await f.ready();
    const confirming = f.confirm();
    await started.promise;
    f.setAuth({ user: { id: id(99) }, accessToken: 'other-json-reader-token' });
    gate.resolve();
    await confirming;
    assert.equal(f.state.endingRead, null);
    assert.equal(f.posts().length, phase === 'review' ? 0 : 1);
    assert.equal(f.state.progress.revision, 7);
    assert.equal(f.state.busy, false);
  }
});

test('first GET deadline leaves an unsaved status; manual read-only recovery never automatically confirms', async () => {
  const started = deferred();
  const f = fixture({ onReview: (preview, entry, f) => {
    if (f.reviews().length > 1) return preview;
    started.resolve();
    return new Promise((resolve, reject) => entry.signal.addEventListener('abort',
      () => reject(Object.assign(new Error('Synthetic GET deadline'), { name: 'AbortError' })), { once: true }));
  } });
  await started.promise;
  f.expire();
  await f.ready();
  assert.equal(f.state.endingRead.status, 'unknown');
  assert.equal(f.posts().length, 0);
  await f.confirm();
  assert.equal(f.state.endingRead.status, 'idle');
  assert.equal(f.posts().length, 0);
  assert.equal(f.reviews().length, 2);
});

test('late success after a readonly GET deadline is ignored, not shown as saved', async () => {
  const gate = deferred(), started = deferred();
  const f = fixture({ onReview: async (preview, entry, f) => {
    started.resolve();
    await gate.promise;
    return { ...preview, confirmation: f.receipt(preview) };
  } });
  await started.promise;
  f.expire();
  gate.resolve();
  await f.ready();
  assert.equal(f.state.endingRead.status, 'unknown');
  assert.equal(f.state.endingRead.receipt, null);
  assert.equal(f.posts().length, 0);
  assert.equal(f.reviews().length, 1);
});

test('real locale/auth/pagehide/popstate listeners abort pending writes and scrub the private receipt', async () => {
  for (const event of ['lumina:localechange', 'lumina:auth-expired', 'lumina:authchange', 'storage', 'pagehide', 'popstate']) {
    const gate = deferred(), started = deferred();
    const f = fixture({ onPost: async (entry, f) => {
      const receipt = f.receipt(f.review(entry)); started.resolve(); await gate.promise; return receipt;
    } });
    await f.ready();
    const pending = f.confirm();
    await started.promise;
    const post = f.posts()[0];
    if (event === 'lumina:localechange') {
      f.setLocale('ja');
      f.server = projection('ja');
    }
    if (event === 'lumina:authchange' || event === 'storage') f.setAuth(null);
    if (event === 'popstate') { f.location.search = `?sessionId=${id(2)}&workId=${id(3)}`; f.server = projection('en', undefined, 0); }
    await f.emit(event, { key: 'lumina_auth' });
    assert.equal(post.signal.aborted, true, event);
    gate.resolve();
    await pending;
    assert.equal(f.posts().length, 1);
    assert.equal(f.state.endingRead?.receipt ?? null, null);
    assert.equal(f.state.busy, false);
  }
});

test('reset preview hides confirmation; applied reset reloads and drops the prior ending receipt', async () => {
  const f = fixture();
  await f.ready();
  await f.confirm();
  await f.api.requestResetPreview('full');
  assert.equal(f.state.endingRead?.receipt ?? null, null);
  const before = f.posts().length;
  await f.api.confirmEndingRead();
  assert.equal(f.posts().length, before);
  await f.api.confirmReset();
  await f.ready();
  assert.equal(f.state.scene.id, id(90));
  assert.equal(f.state.endingRead?.receipt ?? null, null);
  assert.equal(f.posts().filter(call => call.path.endsWith('/generated-ending-read/confirm')).length, 1);
});

test('canonical completed pagination remains local and retains the actual canonical confirmation target', async () => {
  const p = projection('en', [1, 2, 3], 1);
  p.currentGeneratedSceneId = null;
  p.scene.isGenerated = false;
  p.scene.deliveryState = undefined;
  p.scene.endingType = 'author_main';
  const f = fixture({ progress: p });
  await f.ready();
  const before = plain(f.state.progress);
  assert.ok(f.api.canonicalReadTarget());
  assert.ok(f.root.querySelector('[data-story-canonical-read]'));
  await f.api.turnBeat(1);
  await f.api.turnBeat(1);
  assert.ok(f.api.canonicalReadTarget());
  assert.equal(f.api.readableBeats().index, 2);
  assert.equal(f.button(), null);
  assert.deepEqual(plain(f.state.progress), before);
  assert.equal(f.posts().length, 0);
  assert.equal(f.reviews().length, 0);
});

test('active generated pagination retains ordinary beat writes and never mounts ending confirmation', async () => {
  const p = projection('en', undefined, 0);
  p.status = 'active';
  p.scene.endingType = null;
  p.choices = [{ id: id(70), label: { value: 'Next synthetic route' }, available: true }];
  const f = fixture({ progress: p });
  await f.ready();
  await f.api.turnBeat(1);
  assert.equal(f.state.progress.status, 'active');
  assert.deepEqual(plain(f.state.choices), p.choices);
  assert.equal(f.posts().length, 1);
  assert.match(f.posts()[0].path, /\/beat\?locale=en$/);
  assert.equal(f.button(), null);
  assert.equal(f.reviews().length, 0);
});

test('artwork-pending/unavailable gate and trimmed/generated-ineligible content never request read confirmation', async () => {
  for (const mutate of [
    p => { p.scene.deliveryState = 'artwork_pending'; },
    p => { p.scene.deliveryState = 'artwork_unavailable'; },
    p => { p.scene.beats.at(-1).content.value = 'Complete sentence. Unfinished'; },
    p => { p.scene.beats.at(-1).id = ''; },
    p => { p.scene.beats[0].content.fallback = true; },
    p => { p.scene.beats.at(-1).content.locale = 'ko'; },
    p => { p.scene.beats.at(-1).position = 41; },
    p => { p.workId = id(99); },
    p => { p.scene.endingType = 'author_main'; },
  ]) {
    const p = projection();
    mutate(p);
    const f = fixture({ progress: p });
    await f.ready();
    assert.equal(f.button(), null);
    assert.equal(f.reviews().length, 0);
    assert.equal(f.posts().length, 0);
  }
});

test('review failures remain unsaved, and manual check is GET-only before a new explicit mark', async () => {
  let fail = true;
  const f = fixture({ onReview: preview => { if (fail) throw new Error('Synthetic read failure'); return preview; } });
  await f.ready();
  assert.equal(f.state.endingRead.status, 'unknown');
  fail = false;
  await f.confirm();
  assert.equal(f.state.endingRead.status, 'idle');
  assert.equal(f.posts().length, 0);
  await f.confirm();
  assertReadPost(f, 'en', 5, 7);
});

test('missing WebCrypto disables confirmation and entry HTML invalidates ending script/style cache keys', async () => {
  const f = fixture({ crypto: {} });
  await f.ready();
  assert.equal(f.state.endingRead.status, 'unavailable');
  assert.equal(f.button().disabled, true);
  assert.equal(f.reviews().length, 0);
  assert.equal(f.posts().length, 0);
  assert.match(html, /pages\/story-stage\.js\?v=story-generated-ending-read-20261006/);
  assert.match(html, /pages\/story-canonical-read\.js\?v=story-canonical-read-20261002/);
  assert.match(html, /styles\/story-stage\.css\?v=story-generated-ending-read-20261006/);
});
