import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const options = { timeout: 2500 };
const hash = text => createHash('sha256').update(text).digest('hex');
function actualFunction(signature) {
  const anchor = signature + ' {';
  assert.equal(app.split(anchor).length, 2, 'Unique actual function anchor');
  const start = app.indexOf(anchor), end = app.indexOf('\n}', start) + 2;
  assert(end > start, 'Actual top-level function boundary');
  return app.slice(start, end);
}
const helper = actualFunction('function awaitPaidLikeSettlement(request)');
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function observe(promise) {
  const state = { phase: 'pending', value: undefined, reason: undefined };
  const done = Promise.resolve(promise).then(value => {
    state.phase = 'fulfilled'; state.value = value; return state;
  }, reason => {
    state.phase = 'rejected'; state.reason = reason; return state;
  });
  return { state, done };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

// Only the actual helper runs. Requests are local promises and the clock is synthetic.
function harness() {
  const active = new Map(), created = [], cleared = [];
  let now = 0, sequence = 0, abortCalls = 0;
  const context = {
    Promise, Error,
    setTimeout(callback, delay) {
      assert.equal(typeof callback, 'function'); assert.equal(delay, 8000);
      const timer = { id: ++sequence, callback, delay, due: now + delay };
      active.set(timer.id, timer); created.push(timer); return timer.id;
    },
    clearTimeout(id) { cleared.push(id); active.delete(id); },
    AbortController: class {
      constructor() { abortCalls++; throw new Error('Synthetic abort dependency forbidden'); }
    }
  };
  runInNewContext(helper, context, { filename: 'app.js:actual-paid-settlement-helper' });
  return {
    active, created, cleared, get abortCalls() { return abortCalls; },
    call: request => context.awaitPaidLikeSettlement(request),
    advance(milliseconds) {
      now += milliseconds;
      for (const timer of [...active.values()].sort((a, b) => a.due - b.due)) {
        if (timer.due <= now && active.has(timer.id)) { active.delete(timer.id); timer.callback(); }
      }
    },
    fireRetired: id => { const timer = created.find(row => row.id === id); assert(timer); timer.callback(); }
  };
}
function timedOut(result) {
  assert.equal(result.phase, 'rejected'); assert(result.reason instanceof Error);
  assert.equal(result.reason.message, 'Paid-like response outcome unavailable');
}

test('paid body deadline retains generic API and wraps quota and POST with server priced quantities', options, () => {
  const paidStart = app.indexOf('const PAID_LIKE_BUNDLES = [');
  assert(paidStart >= 0 && app.indexOf(helper) > paidStart);
  const quota = actualFunction('async function loadPaidLikeQuota()');
  const modal = actualFunction('async function openPaidLikeModal(slug)');
  assert.match(quota, /const data = await awaitPaidLikeSettlement\(apiFetch\("\/api\/v1\/me\/paid-like-quota", \{ auth: true \}\)\)/);
  assert.match(modal, /const result = await awaitPaidLikeSettlement\(apiFetch\(`\/api\/v1\/boost-campaigns\/\$\{campaignId\}\/paid-like`, \{/);
  assert.match(modal, /quantity: attempt\.quantity,[\s\S]*idempotencyKey\s*\}\s*\}\)\);/);
  const apiSource = actualFunction('async function apiFetch(path, options = {}, _retryDepth = 0)');
  const catalogDeadline = [
    '    // Keep the existing deadline through JSON for the credential-free public catalog.',
    '    if (!(path === "/api/v1/ott" && method === "GET" && auth === false &&',
    '      body === undefined && Object.keys(headers).length === 0)) clearTimeout(timer);',
  ].join('\n');
  assert.equal(apiSource.split(catalogDeadline).length, 2, 'Exact separate public catalog deadline delta');
  assert.equal(hash(apiSource.replace(catalogDeadline, '    clearTimeout(timer);')),
    '9bf7fa29a431cb46ba4f214975880632f460c2a291fe324aba5898f4aa61d9d0');
  assert.match(app.slice(paidStart, app.indexOf('];', paidStart) + 2), /^const PAID_LIKE_BUNDLES = \[\s*\{ quantity: 1 \},\s*\{ quantity: 5 \},\s*\{ quantity: 10, recommended: true \},\s*\{ quantity: 20 \}\s*\];$/);
  assert.equal((quota.match(/awaitPaidLikeSettlement\(/g) || []).length, 1);
  assert.equal((modal.match(/awaitPaidLikeSettlement\(/g) || []).length, 1);
  const offline = /if \(isLikelyOffline\(\)\) \{([\s\S]*?)\n    \}/.exec(modal);
  assert(offline, 'Actual pre-dispatch offline branch');
  const messages = /setMessage\(attempt\?\.key\s*\?\s*"([^"\n]+)"\s*:\s*"([^"\n]+)"\);/.exec(offline[1]);
  assert(messages, 'Existing intent and fresh intent have separate offline messages');
  for (const message of messages.slice(1)) assert.match(message, /\uc774\ubc88 \uc694\uccad\uc740 \ubcf4\ub0b4\uc9c0 \uc54a/);
  assert.match(messages[1], /\uc774\uc804 \uc694\uccad\uc758 \uacb0\uacfc\uc640 \ucc28\uac10 \uc5ec\ubd80\ub294 \uacc4\uc18d \ubbf8\ud655\uc778/);
  assert.doesNotMatch(offline[1], /\ucc28\uac10\ub418\uc9c0 \uc54a|\ucc28\uac10\uc548\ub428|no charge|not charged|never charged/i);
  assert.match(offline[1], /\breturn;/);
});

test('paid body deadline forwards successful settlement by identity', options, async () => {
  const h = harness(), value = Object.freeze({ synthetic: true });
  const result = await h.call(Promise.resolve(value));
  assert.equal(result, value); assert.equal(h.active.size, 0); assert.equal(h.created.length, 1);
});

test('paid body deadline forwards the original rejection by identity', options, async () => {
  const h = harness(), reason = new Error('Synthetic request rejection');
  const result = await observe(h.call(Promise.reject(reason))).done;
  assert.equal(result.phase, 'rejected'); assert.equal(result.reason, reason); assert.equal(h.active.size, 0);
});

test('paid body deadline rejects a permanently pending request at eight seconds', options, async () => {
  const h = harness(), request = deferred(), observed = observe(h.call(request.promise));
  h.advance(7999); await flush(); assert.equal(observed.state.phase, 'pending');
  h.advance(1); timedOut(await observed.done); assert.equal(h.active.size, 0);
});

test('paid body deadline still settles after headers when the JSON body never completes', options, async () => {
  const h = harness(), headers = deferred(), body = deferred();
  const request = headers.promise.then(() => body.promise);
  const observed = observe(h.call(request));
  headers.resolve({ syntheticHeaders: true }); await flush(); h.advance(7999);
  assert.equal(observed.state.phase, 'pending'); h.advance(1); timedOut(await observed.done);
  assert.equal(h.active.size, 0);
});

test('paid body deadline does not depend on AbortController to settle the caller', options, async () => {
  const h = harness(), request = deferred(), observed = observe(h.call(request.promise));
  h.advance(8000); timedOut(await observed.done);
  assert.equal(h.abortCalls, 0); assert.equal(h.active.size, 0);
});

test('paid body deadline consumes late body success without replacing its timeout', options, async () => {
  const h = harness(), body = deferred(), observed = observe(h.call(body.promise));
  h.advance(8000); const expired = await observed.done; timedOut(expired);
  const reason = expired.reason; body.resolve({ syntheticLateBody: true }); await flush();
  assert.equal(observed.state.phase, 'rejected'); assert.equal(observed.state.reason, reason);
  assert.equal(h.active.size, 0); assert.equal(h.cleared.length, 1);
});

test('paid body deadline consumes late rejection without an unhandled rejection', options, async () => {
  const h = harness(), body = deferred(), unhandled = [];
  const listener = reason => unhandled.push(reason);
  process.on('unhandledRejection', listener);
  try {
    const observed = observe(h.call(body.promise)); h.advance(8000); timedOut(await observed.done);
    body.reject(new Error('Synthetic late body rejection'));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, []); assert.equal(h.active.size, 0); assert.equal(h.cleared.length, 1);
  } finally { process.off('unhandledRejection', listener); }
});

test('paid body deadline clears its timer exactly once after success', options, async () => {
  const h = harness(), request = deferred(), value = { syntheticSuccess: true };
  const observed = observe(h.call(request.promise)), id = h.created[0].id;
  request.resolve(value); assert.equal((await observed.done).value, value);
  assert.deepEqual(h.cleared, [id]); h.fireRetired(id); await flush();
  assert.equal(observed.state.phase, 'fulfilled'); assert.equal(observed.state.value, value);
  assert.deepEqual(h.cleared, [id]); assert.equal(h.active.size, 0);
});

test('paid body deadline clears its timer exactly once after rejection', options, async () => {
  const h = harness(), request = deferred(), reason = new Error('Synthetic early rejection');
  const observed = observe(h.call(request.promise)), id = h.created[0].id;
  request.reject(reason); assert.equal((await observed.done).reason, reason);
  assert.deepEqual(h.cleared, [id]); h.fireRetired(id); await flush();
  assert.equal(observed.state.phase, 'rejected'); assert.equal(observed.state.reason, reason);
  assert.deepEqual(h.cleared, [id]); assert.equal(h.active.size, 0);
});

test('paid body deadline uses one eight-second timer and clears it once on timeout', options, async () => {
  const h = harness(), request = deferred(), observed = observe(h.call(request.promise));
  assert.equal(h.created.length, 1); assert.equal(h.created[0].delay, 8000); assert.equal(h.active.size, 1);
  h.advance(8000); timedOut(await observed.done);
  request.resolve({ syntheticAfterTimeout: true }); await flush();
  assert.deepEqual(h.cleared, [h.created[0].id]); assert.equal(h.active.size, 0); assert.equal(h.created.length, 1);
});

test('paid body deadline keeps consecutive requests and retired callbacks isolated', options, async () => {
  const h = harness(), first = deferred(), second = deferred();
  const earlier = observe(h.call(first.promise)), oldId = h.created[0].id;
  first.resolve('synthetic first'); await earlier.done;
  const later = observe(h.call(second.promise)), newId = h.created[1].id;
  assert.notEqual(newId, oldId); h.fireRetired(oldId); await flush();
  assert.equal(later.state.phase, 'pending'); assert(h.active.has(newId));
  h.advance(8000); timedOut(await later.done);
  assert.deepEqual(h.cleared, [oldId, newId]); assert.equal(h.active.size, 0);
});
