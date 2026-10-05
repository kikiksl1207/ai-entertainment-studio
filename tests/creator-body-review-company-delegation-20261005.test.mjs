import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../pages/creator-body-review.js', import.meta.url), 'utf8');
const previewSource = readFileSync(new URL('../pages/creator-body-preview.js', import.meta.url), 'utf8');
test('company body entry invalidates the previous review script URL', () => {
  const html = readFileSync(new URL('../creator-studio/index.html', import.meta.url), 'utf8');
  assert.match(html, /src="\/pages\/creator-body-review\.js\?v=body-review-company-20261005"/);
  assert.doesNotMatch(html, /src="\/pages\/creator-body-review\.js\?v=body-review-20261004"/);
});
const clone = value => JSON.parse(JSON.stringify(value));
const id = value => `${String(value).padStart(8, '0')}-1111-4111-8111-${String(value).padStart(12, '0')}`;
const fields = ['styleReviewed', 'charactersReviewed', 'timelineReviewed'];
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const scope = { workId: id(1), locale: 'ko' };
const createdAt = '2026-10-05T01:00:00.000Z', withdrawnAt = '2026-10-05T02:00:00.000Z';
const binding = 'ab'.repeat(32), checksum = 'cd'.repeat(32);
const checked = value => Object.fromEntries(fields.map(field => [field, value]));
const flags = { generationStarted: false, imageGenerationStarted: false, publicationStarted: false, sharedReuseAuthorized: false };
const row = (extra = {}) => ({ id: id(7), locale: 'ko', version: 1, decision: 'approve',
  approvalBasis: 'company_delegation', ...checked(false), createdAt, withdrawnAt: null, applicability: 'current', ...extra });
const human = (extra = {}) => row({ approvalBasis: 'human_review', ...checked(true), ...extra });
const legacy = (extra = {}) => { const value = human(extra); delete value.approvalBasis; return value; };
const review = (target = scope, extra = {}) => ({ contract: 'story-author-body-review-v1', ...target, ...flags, readOnly: true,
  state: 'reviewable', target: { progressId: id(2), progressRevision: 2, sceneId: id(3),
    sourceBindingHash: binding, bodyChecksum: checksum, ending: false }, latestReview: row({ locale: target.locale }), ...extra });
const preview = (target = scope) => ({ contract: 'story-author-body-preview-v1', ...target, readOnly: true, imageGenerationStarted: false,
  progress: { progressId: id(2), revision: 2, storyVersion: 1, status: 'active',
    scene: { id: id(3), isGenerated: true, title: 'SYNTHETIC COMPANY SCENE', endingType: null,
      beats: [{ id: id(4), position: 1, type: 'paragraph', content: 'SYNTHETIC PRIVATE BODY ONLY' }] }, choices: [] } });
const receipt = (item = row(), target = scope, replay = false) => ({ contract: 'story-author-body-review-v1', ...target, ...flags,
  idempotentReplay: replay, review: item });
const response = (value, status = 200) => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(value) });
const bodyOf = call => typeof call.options.body === 'string' ? JSON.parse(call.options.body) : clone(call.options.body);
const posts = view => view.calls.filter(call => call.options.method === 'POST');
const manualBody = (decision = 'approve', values = checked(true)) => ({ locale: 'ko', sourceBindingHash: binding,
  expectedProgressRevision: 2, expectedReviewId: id(7), decision, ...values });
const withdrawCommand = (locale = 'ko') => ({ kind: 'withdraw', workId: id(1), locale: 'ko', receiptLocale: locale, reviewId: id(7), body: {} });
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const invalid = error => error?.kind === 'invalid';

class Element {
  constructor(tag = 'div', name = '') {
    this.tagName = tag.toUpperCase(); this.id = name; this.children = []; this.listeners = new Map();
    this.attributes = {}; this.style = {}; this.dataset = {}; this.className = ''; this.hidden = false;
    this.disabled = false; this.checked = false; this.value = ''; this._text = '';
    const classes = new Set();
    this.classList = { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this._text = ''; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, callback) { this.listeners.set(type, [...(this.listeners.get(type) || []), callback]); }
  removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== callback)); }
  fire(type, event = {}) {
    let result;
    for (const callback of this.listeners.get(type) || []) result = callback({ type, target: this, ...event });
    return result;
  }
  closest(selector) { return selector === '[data-section]' && this.getAttribute('data-section') !== null ? this : null; }
}
const walk = node => [node, ...node.children.flatMap(walk)];

function library(extra = {}) {
  const forbidden = () => { throw new Error('Real network, timers and storage are forbidden'); };
  const storage = { getItem: forbidden, setItem: forbidden, removeItem: forbidden };
  const window = new Element();
  Object.assign(window, { crypto: { randomUUID: () => id(90) }, fetch: forbidden,
    localStorage: storage, sessionStorage: storage, indexedDB: { open: forbidden }, setTimeout: forbidden, setInterval: forbidden });
  const vm = createContext({ window, TextEncoder, TextDecoder, AbortController, fetch: forbidden,
    setTimeout: forbidden, setInterval: forbidden, ...extra });
  runInContext(previewSource, vm); runInContext(source, vm);
  return { api: vm.window.LuminaCreatorBodyReview, window: vm.window };
}
function screen(handler = ({ reply }) => reply(), settings = {}) {
  const document = new Element(), shell = new Element('main', 'studioShell');
  const section = new Element('section', 'writer-manuscript'), host = new Element('section', 'writerBodyReview');
  const work = new Element('select', 'writerManuscriptWork'), sourceLocale = new Element('select', 'writerManuscriptLocale');
  section.classList.add('is-active'); work.value = id(1); sourceLocale.value = 'ko';
  document.documentElement = new Element('html'); document.documentElement.lang = 'ko'; document.visibilityState = 'visible';
  document.getElementById = name => [shell, section, work, sourceLocale].find(node => node.id === name) || null;
  document.createElement = tag => new Element(tag);
  class Event { constructor(type) { this.type = type; } }
  const { api, window } = library(settings.mounted ? { document, Event } : {});
  let owner = { ownerId: id(8), epoch: 1 }, language = 'ko', shown = true, latest = row(), keys = 0;
  const calls = [], states = [], dispatches = [];
  const fetch = async (url, options) => {
    const kind = options.method === 'POST' ? url.endsWith('/withdraw') ? 'withdraw' : 'decision' : url.includes('/body-review') ? 'review' : 'preview';
    const target = { workId: work.value, locale: sourceLocale.value }, call = { url, options, kind }; calls.push(call);
    const reply = () => {
      if (kind === 'review') return response(review(target, { latestReview: { ...latest, locale: target.locale } }));
      if (kind === 'preview') return response(preview(target));
      if (kind === 'withdraw') latest = { ...latest, withdrawnAt, applicability: 'withdrawn' };
      else {
        const body = bodyOf(call);
        latest = human({ id: id(10), version: 2, locale: target.locale, decision: body.decision,
          ...Object.fromEntries(fields.map(field => [field, body[field]])) });
      }
      return response(receipt(latest, { ...target, locale: latest.locale }), kind === 'decision' ? 201 : 200);
    };
    return handler({ ...call, target, reply });
  };
  const identity = () => owner, isCurrent = value => owner && value.ownerId === owner.ownerId && value.epoch === owner.epoch;
  const options = { fetch, identity, isCurrent, context: () => ({ workId: work.value, locale: sourceLocale.value }),
    locale: () => language, visible: () => shown, onChange: state => states.push(clone(state)),
    onDispatch: () => dispatches.push(true), makeIdempotencyKey: () => `delegation-ui-${++keys}` };
  window.getAuth = () => ({ accessToken: 'synthetic-access-token' }); window.luminaI18n = { getLocale: () => language };
  window.LuminaCreatorStudioApi = { fetch, identity, isCurrent };
  window.dispatchEvent = event => { dispatches.push(event.type); window.fire(event.type); return true; };
  const controller = settings.mounted ? api.mount(host, { makeIdempotencyKey: options.makeIdempotencyKey }) : api.createController(options);
  const node = name => walk(host).find(item => item.id === `writerBodyReview${name}`);
  return { api, controller, window, document, shell, section, host, work, sourceLocale, calls, states, dispatches, node,
    load: () => controller.load(), snapshot: () => controller.snapshot(), keys: () => keys,
    check: field => {
      if (!settings.mounted) return controller.setReviewed(field, true);
      const input = node(`-${field}`); input.checked = true; return input.fire('change');
    },
    set: { owner: value => { owner = value; }, language: value => { language = value; },
      shown: value => { shown = value; }, latest: value => { latest = value; } }
  };
}
function assertUnchecked(view) {
  assert.deepEqual(clone(view.snapshot().reviewed), checked(false));
  if (view.host.children.length) for (const field of fields) assert.equal(view.node(`-${field}`).checked, false);
}
function assertCleared(view) {
  const state = view.snapshot(); assert.equal(state.data, null); assert.equal(state.receipt, null); assertUnchecked(view);
  assert.equal(state.canReview, false); assert.equal(state.canApprove, false); assert.equal(state.canWithdraw, false);
  assert.doesNotMatch(JSON.stringify(state) + view.host.textContent, /SYNTHETIC COMPANY SCENE|SYNTHETIC PRIVATE BODY/);
}

test('legacy omission remains human-only and preserves the old projection shape', () => {
  const { api } = library();
  for (const item of [legacy(), legacy({ decision: 'reject', charactersReviewed: false, timelineReviewed: false })]) {
    assert.deepEqual(clone(api.parseReview(review(scope, { latestReview: item }), scope).latestReview), item);
    assert.equal(Object.hasOwn(api.parseReview(review(scope, { latestReview: item }), scope).latestReview, 'approvalBasis'), false);
  }
  const unreviewed = row(); delete unreviewed.approvalBasis;
  assert.throws(() => api.parseReview(review(scope, { latestReview: unreviewed }), scope), invalid);
  assert.throws(() => api.parseReceipt(receipt({ ...unreviewed, withdrawnAt, applicability: 'withdrawn' }), withdrawCommand()), invalid);
});

test('explicit human basis is retained for approved and partially reviewed rejected rows', () => {
  const { api } = library();
  for (const item of [human(), human({ decision: 'reject', charactersReviewed: false, timelineReviewed: false })]) {
    assert.deepEqual(clone(api.parseReview(review(scope, { latestReview: item }), scope).latestReview), item);
    const command = { workId: id(1), body: manualBody(item.decision, Object.fromEntries(fields.map(key => [key, item[key]]))) };
    assert.deepEqual(clone(api.parseReceipt(receipt(item), command).review), item);
  }
});

for (const applicability of ['current', 'stale', 'superseded', 'withdrawn']) test(`delegated ${applicability} is accepted without inventing human review`, () => {
  const { api } = library(), item = row({ applicability, withdrawnAt: applicability === 'withdrawn' ? withdrawnAt : null, privateNote: 'discard' });
  const parsed = clone(api.parseReview(review(scope, { latestReview: item }), scope).latestReview);
  const expected = clone(item); delete expected.privateNote;
  assert.deepEqual(parsed, expected); assert.equal(parsed.decision, 'approve');
  assert.ok(fields.every(field => parsed[field] === false));
});

const invalidRows = {
  'unknown basis': value => { value.approvalBasis = 'automatic'; },
  'empty basis': value => { value.approvalBasis = ''; },
  'null basis': value => { value.approvalBasis = null; },
  'numeric basis': value => { value.approvalBasis = 1; },
  'boolean basis': value => { value.approvalBasis = true; },
  'object basis': value => { value.approvalBasis = {}; },
  'case-altered basis': value => { value.approvalBasis = 'Company_delegation'; },
  'delegated rejection': value => { value.decision = 'reject'; },
  'human approval without reviews': value => { value.approvalBasis = 'human_review'; },
  'legacy approval without reviews': value => { delete value.approvalBasis; },
  'invalid id': value => { value.id = 'bad'; },
  'invalid locale': value => { value.locale = 'fr'; },
  'invalid version': value => { value.version = 0; },
  'invalid decision': value => { value.decision = 'publish'; },
  'invalid creation date': value => { value.createdAt = '2026-02-30T01:00:00Z'; },
  'invalid withdrawal date': value => { value.withdrawnAt = 'bad'; },
  'premature withdrawal': value => { value.withdrawnAt = '2026-10-04T01:00:00Z'; value.applicability = 'withdrawn'; },
  'missing withdrawal time': value => { value.applicability = 'withdrawn'; },
  'withdrawn time on current row': value => { value.withdrawnAt = withdrawnAt; },
  'unknown applicability': value => { value.applicability = 'unknown'; }
};
for (let mask = 1; mask < 8; mask++) invalidRows[`mixed true flags ${mask}`] = value => {
  fields.forEach((field, index) => { value[field] = Boolean(mask & (1 << index)); });
};
for (const field of fields) {
  invalidRows[`missing ${field}`] = value => { delete value[field]; };
  invalidRows[`nonboolean ${field}`] = value => { value[field] = 0; };
}
for (const [name, corrupt] of Object.entries(invalidRows)) test(`invalid delegation fails closed before preview or mutation: ${name}`, async () => {
  const item = row(); corrupt(item);
  const { api } = library();
  assert.throws(() => api.parseReview(review(scope, { latestReview: item }), scope), invalid);
  assert.throws(() => api.parseReceipt(receipt(item), { workId: id(1), locale: 'ko' }), invalid);
  const view = screen(({ kind, reply }) => kind === 'review' ? response(review(scope, { latestReview: item })) : reply());
  assert.equal(await view.load(), false); assert.equal(view.snapshot().messageKey, 'invalid'); assertCleared(view);
  assert.equal(view.calls.length, 1); assert.equal(await view.controller.withdraw(), false);
  assert.equal(await view.controller.decide('approve'), false); assert.equal(posts(view).length, 0); assert.equal(view.keys(), 0);
});

test('present undefined or unknown human basis is not treated as legacy omission', () => {
  const { api } = library();
  for (const approvalBasis of [undefined, null, '', 'human', [], {}]) {
    assert.throws(() => api.parseReview(review(scope, { latestReview: human({ approvalBasis }) }), scope), invalid);
    assert.throws(() => api.parseReceipt(receipt(human({ approvalBasis })), { workId: id(1), body: manualBody() }), invalid);
  }
});

test('human and legacy flag requirements stay strict', () => {
  const { api } = library();
  for (const factory of [human, legacy]) {
    for (const field of fields) assert.throws(() => api.parseReview(review(scope, { latestReview: factory({ [field]: false }) }), scope), invalid);
    assert.throws(() => api.parseReview(review(scope, { latestReview: factory({ decision: 'reject', ...checked(false) }) }), scope), invalid);
  }
});

const delegationLabels = { ko: '\uD68C\uC0AC \uC704\uC784 \uC2B9\uC778', en: 'Company-delegated approval',
  ja: '\u4F1A\u793E\u306E\u59D4\u4EFB\u306B\u3088\u308B\u627F\u8A8D',
  'zh-Hans': '\u516C\u53F8\u59D4\u6258\u6279\u51C6', 'zh-Hant': '\u516C\u53F8\u59D4\u8A17\u6838\u51C6' };
for (const language of locales) test(`mounted ${language} clearly labels current delegated approval with unchecked human controls`, async () => {
  const view = screen(undefined, { mounted: true }); view.set.language(language); view.sourceLocale.value = 'ja';
  view.window.fire('lumina:localechange'); assert.equal(await view.load(), true);
  const words = view.api.copy[language], latest = walk(view.host).find(node => node.className === 'body-review-latest');
  assert.equal(words.companyDelegated, delegationLabels[language]);
  assert.equal(latest.textContent, `${words.current}: ${delegationLabels[language]}`);
  assert.equal(view.host.lang, language); assert.equal(view.snapshot().data.review.latestReview.locale, 'ja');
  assert.equal(walk(view.host).find(node => node.className === 'body-review-source').lang, 'ja');
  assertUnchecked(view); assert.equal(view.node('Approve').disabled, true); assert.equal(view.node('Reject').disabled, true);
  assert.equal(view.node('Withdraw').disabled, false); assert.equal(view.snapshot().canReview, true);
  assert.equal(await view.node('Approve').fire('click'), undefined); assert.equal(posts(view).length, 0); assert.equal(view.dispatches.length, 0);
  assert.ok(view.calls.every(call => call.url.endsWith('?locale=ja')));
});

for (const applicability of ['stale', 'superseded', 'withdrawn']) test(`mounted delegated ${applicability} never becomes current approval`, async () => {
  const view = screen(undefined, { mounted: true }); view.set.language('en');
  view.set.latest(row({ applicability, withdrawnAt: applicability === 'withdrawn' ? withdrawnAt : null }));
  assert.equal(await view.load(), true);
  const latest = walk(view.host).find(node => node.className === 'body-review-latest'), words = view.api.copy.en;
  assert.equal(latest.textContent, `${words[applicability]}: ${delegationLabels.en}`);
  assert.ok(!latest.textContent.includes(words.current)); assertUnchecked(view);
  assert.equal(view.node('Withdraw').hidden, applicability === 'withdrawn');
  assert.equal(posts(view).length, 0);
});

for (const factory of [human, legacy]) test(`mounted ${factory.name} approval is not relabeled as delegation or prechecked`, async () => {
  const view = screen(undefined, { mounted: true }); view.set.language('en'); view.set.latest(factory());
  assert.equal(await view.load(), true);
  assert.equal(walk(view.host).find(node => node.className === 'body-review-latest').textContent, `${view.api.copy.en.current}: ${view.api.copy.en.approved}`);
  assert.ok(!view.host.textContent.includes(delegationLabels.en)); assertUnchecked(view);
});

for (const decision of ['approve', 'reject']) test(`manual ${decision} after delegation keeps human checks and exact payload without approvalBasis`, async () => {
  const view = screen(undefined, { mounted: true }); assert.equal(await view.load(), true);
  assert.equal(await view.controller.decide(decision), false); assert.equal(posts(view).length, 0);
  view.check('styleReviewed'); assert.equal(view.node('Approve').disabled, true); assert.equal(view.node('Reject').disabled, false);
  assert.equal(await view.controller.decide('approve'), false);
  if (decision === 'approve') for (const field of fields.slice(1)) view.check(field);
  assert.equal(await view.node(decision === 'approve' ? 'Approve' : 'Reject').fire('click'), true);
  assert.equal(posts(view).length, 1);
  const body = bodyOf(posts(view)[0]);
  assert.deepEqual(body, manualBody(decision, decision === 'approve' ? checked(true) : { ...checked(false), styleReviewed: true }));
  assert.equal(Object.hasOwn(body, 'approvalBasis'), false);
  assert.equal(view.snapshot().receipt.review.approvalBasis, 'human_review');
  assert.equal(view.snapshot().data.review.latestReview.approvalBasis, 'human_review');
  assertUnchecked(view); assert.equal(view.snapshot().unresolved, false);
  assert.equal(view.dispatches.length, 1);
});

test('a delegated receipt cannot acknowledge a manual human command, even with matching false flags', () => {
  const { api } = library();
  for (const values of [checked(true), checked(false)]) for (const replay of [false, true]) {
    assert.throws(() => api.parseReceipt(receipt(row(), scope, replay), { workId: id(1), body: manualBody('approve', values) }), invalid);
  }
});

test('delegated withdrawal keeps false review flags, exact target and empty payload', async () => {
  const view = screen(undefined, { mounted: true }); assert.equal(await view.load(), true);
  assert.equal(await view.node('Withdraw').fire('click'), true);
  assert.equal(posts(view).length, 1); assert.deepEqual(bodyOf(posts(view)[0]), {});
  assert.ok(posts(view)[0].url.endsWith(`/${id(7)}/withdraw`));
  assert.equal(view.snapshot().receipt.review.approvalBasis, 'company_delegation');
  assert.deepEqual(clone(view.snapshot().receipt.review), row({ withdrawnAt, applicability: 'withdrawn' }));
  assert.equal(view.node('Withdraw').hidden, true); assertUnchecked(view);
  assert.equal(view.snapshot().unresolved, false);
});

test('withdrawal still verifies review identity and receipt locale for delegated rows', () => {
  const { api } = library(), item = row({ withdrawnAt, applicability: 'withdrawn' });
  for (const changed of [{ id: id(9) }, { locale: 'ja' }, { withdrawnAt: null, applicability: 'current' }]) {
    assert.throws(() => api.parseReceipt(receipt({ ...item, ...changed }), withdrawCommand()), invalid);
  }
  assert.equal(api.parseReceipt(receipt({ ...item, locale: 'ja' }, { workId: id(1), locale: 'ja' }), withdrawCommand('ja')).review.approvalBasis, 'company_delegation');
});

for (const language of locales) test(`source-changed delegated head in ${language} stays old-locale withdrawable without private body`, async () => {
  const item = row({ locale: 'ja', applicability: 'stale' });
  const view = screen(({ kind, reply }) => {
    if (kind === 'review') return response(review(scope, { state: 'source_changed', target: null, latestReview: item }));
    if (kind === 'preview') return response({}, 409);
    if (kind === 'withdraw') return response(receipt({ ...item, withdrawnAt, applicability: 'withdrawn' }, { workId: id(1), locale: 'ja' }));
    return reply();
  }, { mounted: true });
  view.set.language(language); assert.equal(await view.load(), true);
  assert.equal(view.node('Approve').hidden, true); assert.equal(view.node('Reject').hidden, true);
  assert.equal(view.node('Withdraw').disabled, false); assertUnchecked(view);
  assert.doesNotMatch(view.host.textContent, /SYNTHETIC COMPANY SCENE|SYNTHETIC PRIVATE BODY/);
  assert.equal(walk(view.host).find(node => node.className === 'body-review-latest').textContent,
    `${view.api.copy[language].stale}: ${delegationLabels[language]}`);
  assert.equal(await view.node('Withdraw').fire('click'), true);
  assert.equal(view.snapshot().receipt.locale, 'ja'); assert.deepEqual(bodyOf(posts(view)[0]), {});
});

test('invalid delegated withdrawal receipt remains uncertain and retries only the original empty command', async () => {
  let attempts = 0;
  const view = screen(({ kind, reply }) => {
    if (kind !== 'withdraw') return reply();
    return response(receipt(row({ withdrawnAt, applicability: 'withdrawn', approvalBasis: ++attempts === 1 ? 'unknown' : 'company_delegation' }), scope, attempts > 1));
  });
  assert.equal(await view.load(), true); assert.equal(await view.controller.withdraw(), false);
  assertCleared(view); assert.equal(view.snapshot().unresolved, true); assert.equal(view.snapshot().canRetry, true);
  assert.equal(await view.controller.decide('approve'), false); assert.equal(posts(view).length, 1);
  assert.equal(await view.controller.retry(), true);
  assert.equal(posts(view).length, 2); assert.equal(posts(view)[0].options.body, posts(view)[1].options.body);
  assert.equal(posts(view)[0].options.headers['Idempotency-Key'], posts(view)[1].options.headers['Idempotency-Key']);
  assert.equal(view.snapshot().unresolved, false); assert.equal(view.keys(), 1); assertUnchecked(view);
});

test('a fresh delegated head never reconciles a lost manual receipt or bypasses human checks', async () => {
  let attempts = 0;
  const view = screen(({ kind, reply }) => {
    if (kind === 'decision') {
      if (++attempts === 1) throw new Error('Synthetic lost receipt');
      return response(receipt(human({ id: id(10), version: 2 }), scope, true));
    }
    return reply();
  });
  assert.equal(await view.load(), true); for (const field of fields) view.check(field);
  assert.equal(await view.controller.decide('approve'), false); assert.equal(view.snapshot().unresolved, true);
  assert.equal(await view.load(), true); assert.equal(view.snapshot().data.review.latestReview.approvalBasis, 'company_delegation');
  assert.equal(view.snapshot().canReview, false); assert.equal(view.snapshot().canWithdraw, false); assertUnchecked(view);
  assert.equal(await view.controller.retry(), true); assert.equal(posts(view).length, 2);
  assert.equal(posts(view)[0].options.body, posts(view)[1].options.body);
  assert.equal(posts(view)[0].options.headers['Idempotency-Key'], posts(view)[1].options.headers['Idempotency-Key']);
  assert.equal(Object.hasOwn(bodyOf(posts(view)[1]), 'approvalBasis'), false); assert.equal(view.keys(), 1);
});

const boundaries = {
  work: view => { view.work.value = id(9); }, source: view => { view.sourceLocale.value = 'en'; },
  language: view => { view.set.language('en'); }, logout: view => { view.set.owner(null); },
  owner: view => { view.set.owner({ ownerId: id(9), epoch: 2 }); }, epoch: view => { view.set.owner({ ownerId: id(8), epoch: 2 }); },
  hidden: view => { view.set.shown(false); }, destroy: view => view.controller.destroy(), invalidate: view => view.controller.invalidate()
};
for (const stage of ['review', 'preview', 'withdraw']) for (const [name, change] of Object.entries(boundaries)) {
  test(`late delegated ${stage} response cannot restore private state after ${name}`, async () => {
    const delayed = deferred(), entered = deferred();
    const view = screen(({ kind, reply }) => {
      if (kind !== stage) return reply();
      entered.resolve(); return delayed.promise;
    });
    let task;
    if (stage === 'withdraw') { assert.equal(await view.load(), true); task = view.controller.withdraw(); }
    else task = view.load();
    assert.equal(await Promise.race([entered.promise.then(() => true), task.then(() => false)]), true);
    const request = view.calls.at(-1); change(view); view.controller.syncContext(); assertCleared(view);
    delayed.resolve(response(stage === 'review' ? review() : stage === 'preview' ? preview() : receipt(row({ withdrawnAt, applicability: 'withdrawn' }))));
    assert.equal(await task, false); assertCleared(view); assert.equal(request.options.signal.aborted, true);
    assert.equal(view.calls.length, stage === 'review' ? 1 : stage === 'preview' ? 2 : 3);
  });
}

test('late cross-owner delegated withdrawal cannot settle the original uncertain command; returning owner retries its key', async () => {
  const delayed = deferred(); let attempts = 0;
  const view = screen(({ kind, reply }) => kind !== 'withdraw' ? reply() : ++attempts === 1 ? delayed.promise
    : response(receipt(row({ withdrawnAt, applicability: 'withdrawn' }), scope, true)));
  assert.equal(await view.load(), true); const task = view.controller.withdraw();
  view.set.owner({ ownerId: id(9), epoch: 2 }); view.controller.syncContext(); assertCleared(view);
  delayed.resolve(response(receipt(row({ withdrawnAt, applicability: 'withdrawn' }))));
  assert.equal(await task, false); assert.equal(view.snapshot().unresolved, false); assert.equal(view.snapshot().receipt, null);
  view.set.owner({ ownerId: id(8), epoch: 3 }); view.controller.syncContext(); assert.equal(view.snapshot().canRetry, true);
  assert.equal(await view.controller.retry(), true);
  assert.equal(posts(view)[0].options.body, posts(view)[1].options.body);
  assert.equal(posts(view)[0].options.headers['Idempotency-Key'], posts(view)[1].options.headers['Idempotency-Key']);
  assert.equal(posts(view)[1].options.identity.epoch, 3); assert.equal(view.keys(), 1);
});

for (const name of ['auth', 'expired', 'work', 'source', 'visibility', 'progress', 'pagehide', 'language']) {
  test(`mounted delegated status and human selections clear on ${name}`, async () => {
    const view = screen(undefined, { mounted: true }); assert.equal(await view.load(), true); view.check('styleReviewed');
    if (name === 'auth') { view.set.owner(null); view.window.fire('lumina:authchange'); }
    if (name === 'expired') view.window.fire('lumina:auth-expired');
    if (name === 'work') { view.work.value = id(9); view.work.fire('change'); }
    if (name === 'source') { view.sourceLocale.value = 'en'; view.sourceLocale.fire('input'); }
    if (name === 'visibility') { view.document.visibilityState = 'hidden'; view.document.fire('visibilitychange'); }
    if (name === 'progress') view.window.fire('lumina:author-body-trial-progress-changed');
    if (name === 'pagehide') view.window.fire('pagehide');
    if (name === 'language') { view.set.language('en'); view.window.fire('lumina:localechange'); }
    assertCleared(view); assert.equal(walk(view.host).some(node => node.className === 'body-review-latest'), false);
    assert.equal(view.node('Approve').disabled, true); assert.equal(view.node('Withdraw').disabled, true);
    assert.equal(posts(view).length, 0);
  });
}

test('stale action tickets cannot approve or withdraw a newly loaded delegated head', async () => {
  const view = screen(); assert.equal(await view.load(), true); const oldTicket = view.snapshot().ticket;
  view.controller.invalidate(); assert.equal(await view.load(), true);
  assert.equal(view.controller.setReviewed('styleReviewed', true, oldTicket), false);
  for (const field of fields) view.check(field);
  assert.equal(await view.controller.decide('approve', oldTicket), false); assert.equal(await view.controller.withdraw(oldTicket), false);
  assert.equal(posts(view).length, 0); assert.equal(view.keys(), 0);
});
