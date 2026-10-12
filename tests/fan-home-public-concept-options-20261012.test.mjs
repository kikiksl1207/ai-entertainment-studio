import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Synthetic public DTOs and DOM only; no API, account, ballot or reward writes.
const source = readFileSync(new URL('../pages/fan-engagement.js', import.meta.url), 'utf8');
const missionId = '11111111-1111-4111-8111-111111111111';
const voteId = '22222222-2222-4222-8222-222222222222';
const artistId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const url = `https://api.lumina-stage.com/api/v1/fan-engagement/concept-votes?status=active&locale=ko&take=20&artistId=${artistId}`;
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function mission(extra = {}) {
  return { id: missionId, artist: { id: artistId }, missionType: 'vote_concept', status: 'active',
    participation: { status: 'not_started', remainingCount: 1 },
    action: { type: 'concept_vote', method: 'POST', requiresAuth: true,
      endpoint: `/api/v1/fan-engagement/concept-votes/${voteId}/ballots`, bodyHint: { missionId } }, ...extra };
}
function option(number, label = `공개 선택지 ${number}`) {
  return { id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(number).padStart(12, '0')}`, optionKey: `option-${number}`,
    labels: { ko: { label } }, sortOrder: number };
}
function vote(extra = {}) {
  return { id: voteId, artist: { id: artistId }, status: 'active', visibility: 'public',
    viewer: { hasVoted: false, selectedOptionId: null }, resultsPreview: null,
    mission: { id: missionId, participationStatus: 'not_started' }, options: [option(1), option(2)], ...extra };
}
const data = items => ({ locale: 'ko', generatedAt: '2026-10-12T05:00:00.000Z', items });
function response(address, body, { status = 200, type = 'application/json; charset=utf-8', gate } = {}) {
  const bytes = new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body));
  let read = false, cancelled = false;
  return { ok: status === 200, status, url: address, headers: { get(name) { return name === 'content-type' ? type : null; } },
    body: { async cancel() { cancelled = true; }, getReader() { return {
      async read() { if (gate) await gate; if (read || cancelled) return { done: true }; read = true; return { done: false, value: bytes }; },
      async cancel() { cancelled = true; }
    }; } } };
}
function harness({ items = [mission()], account = null, concept = address => response(address, data([vote()])) } = {}) {
  const handlers = new Map(), timers = new Map(), calls = [];
  const root = { isConnected: true, dataset: {}, innerHTML: '', setAttribute() {}, addEventListener() {} };
  let currentAuth = account, currentItems = items, nextTimer = 0, reader = concept;
  const context = vm.createContext({ window: { location: { href: 'https://www.lumina-stage.com/' },
    addEventListener(name, fn) { handlers.set(name, fn); } },
    document: { readyState: 'complete', documentElement: { lang: 'ko' }, getElementById() { return root; } },
    getAuth: () => currentAuth, AbortController, TextDecoder, Uint8Array,
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch(address, options) { calls.push({ address, options });
      if (options.method !== 'GET') throw new Error('No synthetic write is permitted');
      return Promise.resolve(address.includes('/concept-votes?') ? reader(address, options)
        : response(address, { items: currentItems })); }
  });
  vm.runInContext(source, context, { filename: 'fan-engagement.js' });
  return { root, calls, context, emit(name, event = {}) { handlers.get(name)?.(event); },
    setItems(value) { currentItems = value; }, setConcept(value) { reader = value; },
    setAuth(value, emit = true) { currentAuth = value; if (emit) handlers.get('lumina:authchange')(); },
    expire() { for (const fn of [...timers.values()]) fn(); },
    concepts() { return calls.filter(call => call.address.includes('/concept-votes?')); } };
}
const hasState = (h, state) => h.root.innerHTML.includes(`data-concept-state="${state}"`);
const noExamples = h => { for (const label of ['무대 의상', '화보 무드', '숏폼 콘셉트']) assert(!h.root.innerHTML.includes(label)); };

test('public options use a fixed anonymous GET even when the mission read is authenticated', async () => {
  const h = harness({ account: { user: { id: userId }, accessToken: 'synthetic-token' } }); await flush();
  assert.equal(h.concepts().length, 1); const call = h.concepts()[0]; assert.equal(call.address, url);
  assert.equal(call.options.method, 'GET'); assert.equal(call.options.credentials, 'omit');
  assert.equal(call.options.redirect, 'error'); assert.equal(call.options.cache, 'no-store');
  assert.equal(call.options.headers.Authorization, undefined); assert.equal(call.options.headers.Cookie, undefined);
  assert(hasState(h, 'ready')); assert(h.root.innerHTML.includes('공개 선택지 1'));
  assert(h.root.innerHTML.includes('공개 선택지 2')); assert(h.calls.every(call => call.options.method === 'GET')); noExamples(h);
});

test('more than four real options preserve all server order and escape markup without local selection', async () => {
  const options = [option(6, '<img src=x onerror=alert(1)>'), option(4), option(5), option(1), option(3), option(2)];
  const h = harness({ concept: address => response(address, data([vote({ options })])) }); await flush();
  assert(hasState(h, 'ready')); assert(h.root.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert(!h.root.innerHTML.includes('<img src=x')); const positions = [4, 5, 1, 3, 2].map(i => h.root.innerHTML.indexOf(`공개 선택지 ${i}`));
  assert(positions.every((position, i) => position >= 0 && (i === 0 || position > positions[i - 1])));
  assert.equal((h.root.innerHTML.match(/<button type="button" disabled>/g) || []).length, 6); noExamples(h);
});

test('stored title/name label fields are displayed without invented option names', async () => {
  const options = [option(1), option(2)]; options[0].labels.ko = { title: '정본 제목' }; options[1].labels.ko = { name: '정본 이름' };
  const h = harness({ concept: address => response(address, data([vote({ options })])) }); await flush();
  assert(hasState(h, 'ready')); assert(h.root.innerHTML.includes('정본 제목')); assert(h.root.innerHTML.includes('정본 이름')); noExamples(h);
});

test('invalid descriptor, missing artist and other-source cards never start a concept request', async () => {
  for (const mutate of [m => { m.id = 'mock'; }, m => { m.artist = null; }, m => { m.status = 'closed'; },
    m => { m.action.bodyHint.missionId = otherId; }, m => { m.action.requiresAuth = false; },
    m => { m.action.method = 'GET'; }, m => { m.action.type = 'mission_participation'; },
    m => { m.action.endpoint = 'https://other.invalid' + m.action.endpoint; },
    m => { m.action.endpoint += '?x=1'; }, m => { m.action.endpoint += '#x'; },
    m => { m.action.endpoint = m.action.endpoint.replace('/ballots', '/%62allots'); },
    m => { m.action.endpoint = m.action.endpoint.toUpperCase(); }]) {
    const m = mission(); mutate(m); const h = harness({ items: [m] }); await flush();
    assert.equal(h.concepts().length, 0); assert(hasState(h, 'unavailable')); noExamples(h);
  }
});

test('empty list, absent target and empty choices remain distinct non-example states', async () => {
  for (const [items, state] of [[[], 'empty'], [[vote({ id: otherId })], 'unavailable'], [[vote({ options: [] })], 'empty']]) {
    const h = harness({ concept: address => response(address, data(items)) }); await flush(); assert(hasState(h, state)); noExamples(h);
  }
});

test('wrong mission or artist never renders someone else public choices', async () => {
  for (const extra of [{ mission: { id: otherId } }, { mission: null }, { artist: { id: otherId } }]) {
    const h = harness({ concept: address => response(address, data([vote(extra)])) }); await flush();
    assert(hasState(h, 'error')); assert(!h.root.innerHTML.includes('공개 선택지 1')); noExamples(h);
  }
});

test('personalized, private or non-active responses are rejected, including an unrelated personalized row', async () => {
  for (const extra of [{ viewer: { hasVoted: true, selectedOptionId: option(1).id } },
    { viewer: { hasVoted: false, selectedOptionId: null, userId } }, { viewer: null },
    { resultsPreview: { totalBallots: 10 } }, { visibility: 'private' }, { status: 'closed' }, { email: 'synthetic@invalid.test' }]) {
    const h = harness({ concept: address => response(address, data([vote(extra)])) }); await flush();
    assert(hasState(h, 'error')); assert(!h.root.innerHTML.includes('synthetic@invalid.test')); noExamples(h);
  }
  const h = harness({ concept: address => response(address, data([vote(), vote({ id: otherId, resultsPreview: {} })])) });
  await flush(); assert(hasState(h, 'error'));
});

test('duplicate IDs, missing labels, controls, oversized labels and option overflow cannot become partial success', async () => {
  const malformed = [[option(1), option(1)], [{ ...option(1), labels: undefined }], [option(1, '')],
    [option(1, '가'.repeat(161))], [option(1, '비공개\u0000문자')],
    [option(1), { ...option(2), voterEmail: 'synthetic@invalid.test' }], Array.from({ length: 21 }, (_, i) => option(i + 1))];
  for (const options of malformed) {
    const h = harness({ concept: address => response(address, data([vote({ options })])) }); await flush();
    assert(hasState(h, 'error')); assert(!hasState(h, 'ready')); noExamples(h);
  }
  const h = harness({ concept: address => response(address, data([vote(), vote()])) }); await flush(); assert(hasState(h, 'error'));
});

test('HTTP, redirects, MIME, invalid JSON and oversized bodies fail without exposing error text or retrying', async () => {
  const replies = [address => response(address, { message: 'synthetic private error' }, { status: 500 }),
    address => response(address + '&redirect=1', data([vote()])),
    address => response(address, data([vote()]), { type: 'text/html' }),
    address => response(address, '{not JSON'), address => response(address, ' '.repeat(262145))];
  for (const concept of replies) {
    const h = harness({ concept }); await flush(); assert(hasState(h, 'error')); assert.equal(h.concepts().length, 1);
    assert(!h.root.innerHTML.includes('synthetic private error')); noExamples(h);
  }
});

test('timeout has no automatic retry and a late response cannot install options', async () => {
  const pending = deferred(); const h = harness({ concept: () => pending.promise }); await flush();
  assert(hasState(h, 'loading')); h.expire(); pending.resolve(response(url, data([vote()]))); await flush();
  assert(hasState(h, 'error')); assert.equal(h.concepts().length, 1); noExamples(h);
});

test('auth change cancels the old anonymous options read and accepts only the new mission generation', async () => {
  const old = deferred(); let first = true;
  const h = harness({ concept: address => first ? (first = false, old.promise) : response(address, data([vote({ options: [option(3)] })])) });
  await flush(); h.setAuth({ user: { id: userId }, accessToken: 'synthetic-current' }); await flush();
  old.resolve(response(url, data([vote()]))); await flush(); assert(hasState(h, 'ready'));
  assert(h.root.innerHTML.includes('공개 선택지 3')); assert(!h.root.innerHTML.includes('공개 선택지 1'));
  assert(h.concepts().every(call => call.options.headers.Authorization === undefined));
});

test('detached roots, silent auth, locale and page changes discard late body reads', async () => {
  for (const mutate of [h => { h.root.isConnected = false; }, h => h.setAuth({ user: { id: userId }, accessToken: 'synthetic-other' }, false),
    h => { h.context.document.documentElement.lang = 'en'; }, h => { h.context.window.location.href += '?changed=1'; }]) {
    const gate = deferred(); const h = harness({ concept: address => response(address, data([vote()]), { gate: gate.promise }) });
    await flush(); mutate(h); gate.resolve(); await flush(); assert(!hasState(h, 'ready')); noExamples(h);
  }
});

test('page hide clears ready options, and a persisted restore gets fresh data without any POST', async () => {
  const h = harness(); await flush(); assert(hasState(h, 'ready')); h.emit('pagehide');
  assert(!h.root.innerHTML.includes('공개 선택지 1'));
  h.setConcept(address => response(address, data([vote({ options: [option(4)] })])));
  h.emit('pageshow', { persisted: true }); await flush(); assert(h.root.innerHTML.includes('공개 선택지 4'));
  assert(!h.root.innerHTML.includes('공개 선택지 1')); assert(h.calls.every(call => call.options.method === 'GET'));
});

test('refresh failure clears old ready options and never uses mission-side options as a replacement', async () => {
  const h = harness({ items: [mission({ options: ['무대 의상', '화보 무드'] })] }); await flush(); assert(hasState(h, 'ready'));
  h.setConcept(() => Promise.reject(new Error('synthetic fetch failure'))); h.emit('focus'); await flush();
  assert(hasState(h, 'error')); assert(!h.root.innerHTML.includes('공개 선택지 1')); noExamples(h);
});
