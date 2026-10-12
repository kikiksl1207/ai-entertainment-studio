import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Synthetic DTOs, DOM and in-memory transport only; no API, real account or persisted ballot/reward writes.
const source = readFileSync(new URL('../pages/fan-engagement.js', import.meta.url), 'utf8');
const missionId = '11111111-1111-4111-8111-111111111111';
const voteId = '22222222-2222-4222-8222-222222222222';
const artistId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const url = `https://api.lumina-stage.com/api/v1/fan-engagement/concept-votes?status=active&locale=ko&take=20&artistId=${artistId}`;
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
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
function response(address, body, { status = 200, type = 'application/json; charset=utf-8', gate, headers = {} } = {}) {
  const bytes = new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body));
  let read = false, cancelled = false;
  return { ok: status >= 200 && status < 300, status, url: address, headers: { get(name) {
    if (Object.hasOwn(headers, name)) return headers[name];
    return name === 'content-type' ? type : name === 'cache-control' ? 'private, no-store' : name === 'vary' ? 'Authorization' : null;
  } },
    body: { async cancel() { cancelled = true; }, getReader() { return {
      async read() { if (gate) await gate; if (read || cancelled) return { done: true }; read = true; return { done: false, value: bytes }; },
      async cancel() { cancelled = true; }
    }; } } };
}
function harness({ items = [mission()], account = null, concept = address => response(address, data([vote()])),
  ownedConcept, post, get, cryptoMissing = false } = {}) {
  const handlers = new Map(), rootHandlers = new Map(), timers = new Map(), calls = [], controls = new Map();
  let html = '', context, renderCount = 0;
  const root = { isConnected: true, dataset: {}, setAttribute() {},
    addEventListener(name, fn) { rootHandlers.set(name, fn); }, contains(element) { return element?.root === root; },
    get innerHTML() { return html; }, set innerHTML(value) { html = value; renderCount++; controls.clear(); if (context) context.document.activeElement = null; },
    querySelector(selector) {
      const opening = [...html.matchAll(/<(?:button|input)\b[^>]*>/g)].map(match => match[0]).find(text =>
        [...selector.matchAll(/\[([^=]+)="([^"]+)"\]/g)].every(match => text.includes(`${match[1]}="${match[2]}"`)));
      if (!opening) return null;
      if (!controls.has(opening)) {
        const attributes = Object.fromEntries([...opening.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
        const element = { root, attributes, type: attributes.type, value: attributes.value,
          disabled: /\sdisabled(?:\s|>)/.test(opening), checked: /\schecked(?:\s|>)/.test(opening),
          dataset: { conceptOption: attributes['data-concept-option'], conceptSubmit: attributes['data-concept-submit'],
            missionParticipate: attributes['data-mission-participate'] },
          hasAttribute(name) { return Object.hasOwn(attributes, name); },
          setAttribute(name, value) { attributes[name] = String(value); }, closest() { return this; } };
        controls.set(opening, element);
      }
      return controls.get(opening);
    } };
  let currentAuth = account, currentItems = items, nextTimer = 0, reader = concept, ownerReader = ownedConcept, writer = post, missionReader = get, keyCount = 0;
  context = vm.createContext({ window: { location: { href: 'https://www.lumina-stage.com/' },
    crypto: cryptoMissing ? {} : { randomUUID() { return `00000000-0000-4000-8000-${String(++keyCount).padStart(12, '0')}`; } },
    addEventListener(name, fn) { handlers.set(name, fn); } },
    document: { readyState: 'complete', visibilityState: 'visible', activeElement: null, documentElement: { lang: 'ko' }, getElementById() { return root; } },
    getAuth: () => currentAuth, AbortController, TextDecoder, Uint8Array,
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch(address, options) { calls.push({ address, options });
      if (options.method === 'POST') return Promise.resolve(writer ? writer(address, options) : Promise.reject(new Error('No synthetic write is permitted')));
      if (options.method !== 'GET') throw new Error('Unexpected synthetic method');
      return Promise.resolve(address.includes('/concept-votes?')
        ? (options.headers.Authorization && ownerReader ? ownerReader : reader)(address, options)
        : missionReader ? missionReader(address, options) : response(address, { items: currentItems })); }
  });
  vm.runInContext(source, context, { filename: 'fan-engagement.js' });
  return { root, calls, context, emit(name, event = {}) { handlers.get(name)?.(event); },
    setItems(value) { currentItems = value; }, setConcept(value) { reader = value; },
    setOwnedConcept(value) { ownerReader = value; }, setPost(value) { writer = value; }, setGet(value) { missionReader = value; },
    setAuth(value, emit = true) { currentAuth = value; if (emit) handlers.get('lumina:authchange')(); },
    expire() { for (const fn of [...timers.values()]) fn(); },
    concepts() { return calls.filter(call => call.address.includes('/concept-votes?')); },
    posts() { return calls.filter(call => call.options.method === 'POST'); },
    get keyCount() { return keyCount; },
    get renderCount() { return renderCount; },
    button(id = missionId, general = false) { return root.querySelector(`[data-${general ? 'mission-participate' : 'concept-submit'}="${id}"]`); },
    radio(id, forMission = missionId) { return root.querySelector(`[data-concept-option="${forMission}"][value="${id}"]`); },
    select(id, trusted = true) {
      const target = this.radio(id); if (!target) return false;
      target.checked = true; context.document.activeElement = target;
      rootHandlers.get('change')?.({ isTrusted: trusted, target }); return true;
    },
    click(id = missionId, trusted = true, general = false) {
      const target = this.button(id, general); if (!target) return false;
      rootHandlers.get('click')?.({ isTrusted: trusted, target, preventDefault() {} }); return true;
    }, dispatch(name, event) { rootHandlers.get(name)?.(event); } };
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

const auth = (token = 'synthetic-ballot-token', id = userId) => ({ user: { id }, accessToken: token });
function ballotMission(extra = {}) {
  return mission({ resetPolicy: 'once', action: { type: 'concept_vote', method: 'POST', requiresAuth: true,
    endpoint: `/api/v1/fan-engagement/concept-votes/${voteId}/ballots`,
    bodyHint: { optionId: 'uuid', missionId, idempotencyKey: 'client-generated-key' } }, ...extra });
}
function completedMission() { return ballotMission({ participation: { status: 'accepted', remainingCount: 0 } }); }
function ballotReceipt(body, extra = {}) {
  return { ballot: { id: otherId, voteId, optionId: body.optionId },
    viewer: { hasVoted: true, selectedOptionId: body.optionId },
    missionParticipation: { id: otherId, missionId, status: 'accepted' },
    rewards: { pointsGranted: 99999 }, idempotentReplay: false, ...extra };
}
function ballotHarness({ items = [ballotMission()], options = [option(1), option(2)], account = auth(),
  concept, ownedConcept, post, get, cryptoMissing = false } = {}) {
  let stored = null, h;
  const owned = address => response(address, data([vote({ options,
    viewer: { hasVoted: stored !== null, selectedOptionId: stored },
    resultsPreview: stored === null ? null : { visible: true, totalBallots: 1, options: [] } })]));
  h = harness({ items, account, cryptoMissing, get,
    concept: concept || (address => response(address, data([vote({ options })]))),
    ownedConcept: ownedConcept || owned, post: post || ((address, request) => {
      const body = JSON.parse(request.body); stored = body.optionId; h.setItems([completedMission()]);
      return response(address, ballotReceipt(body), { status: 201 });
    }) });
  h.store = value => { stored = value; }; h.ownerReply = owned;
  return h;
}

test('ballot: actual option IDs and six-source order reach empty native radios only after the current owner read', async () => {
  const options = [option(6, '<img src=x onerror=alert(1)>'), option(4), option(5), option(1), option(3), option(2)];
  const h = ballotHarness({ options }); await flush();
  assert.equal(h.concepts().length, 2);
  assert.equal(h.concepts()[0].options.headers.Authorization, undefined);
  assert.equal(h.concepts()[1].options.headers.Authorization, 'Bearer synthetic-ballot-token');
  for (const call of h.concepts()) { assert.equal(call.address, url); assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.headers.Cookie, undefined); assert.equal(call.options.redirect, 'error'); }
  const ids = [...h.root.innerHTML.matchAll(/<input\b[^>]*type="radio"[^>]*>/g)].map(match => /\bvalue="([^"]+)"/.exec(match[0])[1]);
  assert.deepEqual(ids, options.map(item => item.id));
  assert(options.every(item => !h.radio(item.id).checked && !h.radio(item.id).disabled));
  assert(h.root.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;')); assert(!h.root.innerHTML.includes('<img src=x'));
  assert.equal(h.button().disabled, true); assert.equal(h.posts().length, 0); assert.equal(h.keyCount, 0);
});

test('ballot: trusted radio changes preserve the same focused DOM and do not mint a key or submit', async () => {
  const h = ballotHarness(); await flush(); const renders = h.renderCount;
  h.select(option(1).id, false); assert.equal(h.button().disabled, true);
  h.select(option(2).id); const focused = h.context.document.activeElement;
  assert.equal(h.renderCount, renders); assert.equal(h.radio(option(2).id), focused);
  h.select(option(1).id); assert.equal(h.context.document.activeElement, h.radio(option(1).id));
  assert.equal(h.renderCount, renders);
  assert.equal(h.button().disabled, false); assert.equal(h.posts().length, 0); assert.equal(h.keyCount, 0);
  assert.equal(h.concepts().length, 2);
});

test('ballot: one explicit trusted submit uses the exact selected body and fresh concept plus mission truth', async () => {
  const h = ballotHarness(); await flush(); h.select(option(2).id); h.click(); await flush();
  assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1); const call = h.posts()[0], body = JSON.parse(call.options.body);
  assert.equal(call.address, `https://api.lumina-stage.com/api/v1/fan-engagement/concept-votes/${voteId}/ballots`);
  assert.deepEqual(Object.keys(body), ['optionId', 'missionId', 'idempotencyKey']);
  assert.equal(body.optionId, option(2).id); assert.equal(body.missionId, missionId); assert.match(body.idempotencyKey, /^[0-9a-f-]{36}$/);
  assert.equal(call.options.headers.Authorization, 'Bearer synthetic-ballot-token'); assert.equal(call.options.credentials, 'omit');
  assert.equal(call.options.redirect, 'error'); assert.equal(call.options.cache, 'no-store');
  assert(h.calls.slice(h.calls.indexOf(call) + 1).some(item => item.address.includes('/missions?')));
  assert.equal(h.concepts().filter(item => item.options.headers.Authorization).length, 2);
  assert(h.root.innerHTML.includes('is-completed')); assert(h.radio(option(2).id).checked); assert(h.button().disabled);
  assert(!h.root.innerHTML.includes('99999'));
});

test('ballot: anonymous, malformed hints and unknown mission eligibility never obtain a writable command', async () => {
  const variants = [ballotMission({ participation: { status: 'unknown', remainingCount: 1 } }),
    ballotMission({ participation: { status: 'not_started', remainingCount: 2 } }),
    ballotMission({ participation: { status: 'submitted', remainingCount: 0 } })];
  for (const field of ['optionId', 'idempotencyKey']) { const m = ballotMission(); delete m.action.bodyHint[field]; variants.push(m); }
  const extra = ballotMission(); extra.action.bodyHint.action = 'complete'; variants.push(extra);
  for (const m of variants) {
    const h = ballotHarness({ items: [m] }); await flush(); h.select(option(1).id); h.click(); await flush();
    assert.equal(h.posts().length, 0); assert.equal(h.keyCount, 0);
  }
  for (const account of [null, { user: { id: userId }, accessToken: 'synthetic\r\nheader' }]) {
    const h = ballotHarness({ account }); await flush(); h.select(option(1).id); h.click(); await flush();
    assert.equal(h.concepts().length, 1); assert.equal(h.posts().length, 0); assert.equal(h.keyCount, 0);
  }
});

test('ballot: owner-only malformed, changed-choice and unprotected responses cannot enable selection', async () => {
  const replies = [address => response(address, data([vote({ viewer: { hasVoted: false, selectedOptionId: null, userId } })])),
    address => response(address, data([vote({ options: [option(3)] })])),
    address => response(address, data([vote()]), { headers: { 'cache-control': null } }),
    address => response(address, data([vote()]), { headers: { vary: 'Accept' } }),
    address => response(address, data([vote({ viewer: { hasVoted: true, selectedOptionId: otherId }, resultsPreview: {} })]))];
  for (const ownedConcept of replies) {
    const h = ballotHarness({ ownedConcept }); await flush(); h.select(option(1).id); h.click(); await flush();
    assert.equal(h.posts().length, 0); assert.equal(h.keyCount, 0); assert(h.button().disabled);
  }
});

test('ballot: untrusted or foreign commands and non-source option IDs cannot submit', async () => {
  const h = ballotHarness(); await flush(); h.select(option(1).id); h.click(missionId, false); await flush();
  const button = h.button(); h.dispatch('click', { isTrusted: true, target: { ...button, root: {} }, preventDefault() {} });
  h.dispatch('change', { isTrusted: true, target: { ...h.radio(option(1).id), value: otherId, checked: true } });
  assert.equal(h.posts().length, 0); assert.equal(h.keyCount, 0);
});

test('ballot: double clicks and general participation share one global in-flight fence in both directions', async () => {
  const daily = { id: otherId, missionType: 'daily_signal', status: 'active', resetPolicy: 'once',
    participation: { status: 'not_started', remainingCount: 1 }, action: { type: 'mission_participation', method: 'POST', requiresAuth: true,
      endpoint: `/api/v1/fan-engagement/missions/${otherId}/participations`, bodyHint: { action: 'complete', idempotencyKey: 'client-generated-key' } } };
  for (const firstGeneral of [false, true]) {
    const pending = deferred(), h = ballotHarness({ items: [ballotMission(), daily], post: () => pending.promise }); await flush();
    h.select(option(1).id); h.click(firstGeneral ? otherId : missionId, true, firstGeneral);
    h.click(); h.click(otherId, true, true); await flush();
    assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1);
    const call = h.posts()[0]; pending.resolve(response(call.address, firstGeneral
      ? { participation: { id: otherId, missionId: otherId, status: 'accepted' }, idempotentReplay: false }
      : ballotReceipt(JSON.parse(call.options.body)))); await flush();
  }
});

test('ballot: timeout keeps the immutable tuple and key for an explicit same-body replay only', async () => {
  const h = ballotHarness({ post: (address, request) => new Promise((resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(new Error('synthetic timeout')), { once: true });
  }) }); await flush(); h.select(option(1).id); h.click(); await flush();
  const original = h.posts()[0].options.body; h.expire(); await flush();
  assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1); assert(h.root.innerHTML.includes('is-indeterminate'));
  assert(h.radio(option(2).id).disabled); h.select(option(2).id); await flush(); assert.equal(h.posts().length, 1);
  h.setPost((address, request) => { h.store(JSON.parse(request.body).optionId); h.setItems([completedMission()]);
    return response(address, ballotReceipt(JSON.parse(request.body), { missionParticipation: null, idempotentReplay: true })); });
  h.click(); await flush(); assert.equal(h.posts().length, 2); assert.equal(h.keyCount, 1);
  assert.equal(h.posts()[1].options.body, original); assert(h.root.innerHTML.includes('is-completed'));
});

test('ballot: 5xx and unknown or wrong receipts never optimistically complete or replace their request key', async () => {
  const replies = [(address, body) => response(address, { message: 'synthetic private failure' }, { status: 500 }),
    (address, body) => response(address, ballotReceipt(body, { ballot: { id: otherId, voteId: otherId, optionId: body.optionId } })),
    (address, body) => response(address, ballotReceipt(body, { viewer: { hasVoted: true, selectedOptionId: otherId } })),
    (address, body) => response(address, ballotReceipt(body, { missionParticipation: { id: otherId, missionId, status: 'unknown' } })),
    (address, body) => response(address, ballotReceipt(body, { idempotentReplay: 'yes' })),
    (address, body) => response(address, ' '.repeat(65537))];
  for (const reply of replies) {
    const h = ballotHarness({ post: (address, request) => reply(address, JSON.parse(request.body)) }); await flush();
    h.select(option(1).id); h.click(); await flush();
    assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1); assert(!h.root.innerHTML.includes('is-completed'));
    assert(!h.root.innerHTML.includes('synthetic private failure')); assert(!h.root.innerHTML.includes('99999'));
    const original = h.posts()[0].options.body; h.click(); await flush();
    assert.equal(h.posts().length, 2); assert.equal(h.posts()[1].options.body, original); assert.equal(h.keyCount, 1);
  }
});

test('ballot: a stored ballot with a lost response is reconciled from current owner reads without another POST', async () => {
  let h; h = ballotHarness({ post: (address, request) => {
    h.store(JSON.parse(request.body).optionId); h.setItems([completedMission()]); return Promise.reject(new Error('synthetic lost response'));
  } }); await flush(); h.select(option(1).id); h.click(); await flush();
  assert(h.root.innerHTML.includes('is-completed')); assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1);
  h.click(); await flush(); assert.equal(h.posts().length, 1);
});

test('ballot: a same-vote replay of another option shows the stored choice, never success for the requested choice', async () => {
  let h; h = ballotHarness({ post: (address, request) => {
    h.store(option(1).id); h.setItems([completedMission()]);
    return response(address, ballotReceipt({ optionId: option(1).id }, { missionParticipation: null, idempotentReplay: true }));
  } }); await flush(); h.select(option(2).id); h.click(); await flush();
  assert(h.root.innerHTML.includes('is-ballot_conflict')); assert(!h.root.innerHTML.includes('is-completed'));
  assert(h.radio(option(1).id).checked); assert(!h.radio(option(2).id).checked); assert(h.button().disabled);
  assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1);
});

test('ballot: duplicate rejection uses fresh reads only and adds no generic participation or reward request', async () => {
  let h; h = ballotHarness({ post: (address, request) => {
    h.store(JSON.parse(request.body).optionId); h.setItems([completedMission()]);
    return response(address, { code: 'ALREADY_VOTED' }, { status: 400 });
  } }); await flush(); h.select(option(1).id); h.click(); await flush();
  assert(h.root.innerHTML.includes('is-completed')); assert.equal(h.posts().length, 1);
  assert(h.posts().every(call => call.address.endsWith('/ballots'))); assert(!h.root.innerHTML.includes('99999'));
});

test('ballot: an accepted response alone cannot complete until both owner concept and linked mission reads finish', async () => {
  const fresh = deferred(), h = ballotHarness(); await flush(); h.select(option(1).id);
  h.setGet(() => fresh.promise); h.click(); await flush();
  assert.equal(h.posts().length, 1); assert(!h.root.innerHTML.includes('is-completed'));
  fresh.resolve(response('https://api.lumina-stage.com/api/v1/fan-engagement/missions?surface=home&scope=today&take=3', { items: [completedMission()] }));
  await flush(); assert(h.root.innerHTML.includes('is-completed'));
});

test('ballot: confirmed ballot and unconfirmed mission stay distinct even though concept mission says not_started', async () => {
  let h; h = ballotHarness({ post: (address, request) => {
    h.store(JSON.parse(request.body).optionId); return response(address, ballotReceipt(JSON.parse(request.body), { missionParticipation: null }));
  } }); await flush(); h.select(option(1).id); h.click(); await flush();
  assert(h.root.innerHTML.includes('is-ballot_recorded')); assert(!h.root.innerHTML.includes('is-completed')); assert(h.button().disabled);
  h.setItems([completedMission()]); h.emit('focus'); await flush(); assert(h.root.innerHTML.includes('is-completed'));
  assert.equal(h.posts().length, 1);
});

test('ballot: silent token or account changes before submit clear the old selection without posting', async () => {
  for (const account of [auth('synthetic-rotated'), auth('synthetic-other-user', otherId), null]) {
    const h = ballotHarness(); await flush(); h.select(option(1).id); h.setAuth(account, false); h.click(); await flush();
    assert.equal(h.posts().length, 0); assert.equal(h.keyCount, 0); assert(!h.root.innerHTML.includes(' checked'));
  }
});

test('ballot: sign-out during a POST cannot install its late receipt or show another viewer completion', async () => {
  const pending = deferred(), h = ballotHarness({ post: () => pending.promise }); await flush(); h.select(option(1).id); h.click();
  const call = h.posts()[0]; h.setAuth(null); await flush(); pending.resolve(response(call.address, ballotReceipt(JSON.parse(call.options.body))));
  await flush(); assert(!h.root.innerHTML.includes('is-completed')); assert(!h.root.innerHTML.includes(' checked'));
  assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1);
});

test('ballot: late old-token failures cannot undo a newer same-user confirmed read', async () => {
  const pending = deferred(), h = ballotHarness({ post: () => pending.promise }); await flush(); h.select(option(1).id); h.click();
  h.store(option(1).id); h.setItems([completedMission()]); h.setAuth(auth('synthetic-rotated')); await flush();
  assert(h.root.innerHTML.includes('is-completed')); pending.reject(new Error('synthetic old-token failure')); await flush();
  assert(h.root.innerHTML.includes('is-completed')); assert(h.button().disabled); assert.equal(h.posts().length, 1);
});

test('ballot: page, locale, detach and hidden-state changes during receipt reading discard stale completion', async () => {
  for (const mutate of [h => h.emit('pagehide'), h => { h.context.document.documentElement.lang = 'en'; },
    h => { h.context.window.location.href += '?other=1'; }, h => { h.root.isConnected = false; },
    h => { h.context.document.visibilityState = 'hidden'; }]) {
    const gate = deferred(), h = ballotHarness({ post: (address, request) => response(address, ballotReceipt(JSON.parse(request.body)), { gate: gate.promise }) });
    await flush(); h.select(option(1).id); h.click(); await flush(); mutate(h); gate.resolve(); await flush();
    assert(!h.root.innerHTML.includes('is-completed')); assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1);
  }
});

test('ballot: a newer option generation cannot reuse an unresolved intent for a removed choice', async () => {
  const pending = deferred(), h = ballotHarness({ post: () => pending.promise }); await flush(); h.select(option(1).id); h.click();
  h.setConcept(address => response(address, data([vote({ options: [option(3)] })])));
  h.setOwnedConcept(address => response(address, data([vote({ options: [option(3)] })])));
  h.emit('lumina:authchange'); await flush();
  pending.reject(new Error('synthetic prior-generation failure')); await flush();
  assert(h.radio(option(3).id).disabled); h.select(option(3).id); h.click(); await flush();
  assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1); assert(!h.root.innerHTML.includes('is-completed'));
});

test('ballot: changed mission binding cannot turn one unresolved vote intent into a fresh-key request', async () => {
  const h = ballotHarness({ post: address => response(address, {}, { status: 500 }) }); await flush(); h.select(option(1).id); h.click(); await flush();
  const changed = ballotMission({ id: otherId }); changed.action.bodyHint.missionId = otherId;
  h.setItems([changed]); h.setConcept(address => response(address, data([vote({ mission: { id: otherId, participationStatus: 'not_started' } })])));
  h.setOwnedConcept(address => response(address, data([vote({ mission: { id: otherId, participationStatus: 'not_started' } })])));
  h.emit('focus'); await flush(); assert(h.radio(option(1).id, otherId).disabled); h.click(otherId); await flush();
  assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1);
});

test('ballot: missing crypto and a fresh mission-day reset never invent a new ballot key', async () => {
  const missing = ballotHarness({ cryptoMissing: true }); await flush(); missing.select(option(1).id); missing.click(); await flush();
  assert.equal(missing.posts().length, 0); assert.equal(missing.keyCount, 0);
  const h = ballotHarness(); await flush(); h.select(option(1).id); h.click(); await flush();
  h.setItems([ballotMission({ resetPolicy: 'daily' })]); h.emit('focus'); await flush();
  assert(h.root.innerHTML.includes('is-ballot_recorded')); assert(h.radio(option(1).id).disabled); h.click(); await flush();
  assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1);
});
