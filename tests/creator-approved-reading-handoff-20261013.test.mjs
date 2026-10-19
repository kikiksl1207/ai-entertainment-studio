import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../pages/creator-approved-reading-handoff.js', import.meta.url), 'utf8');
const entrySource = readFileSync(new URL('../pages/creator-approved-reading-entry.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../creator-studio/approved-reading/index.html', import.meta.url), 'utf8');
const id = n => String(n).padStart(8, '0') + '-1111-4111-8111-' + String(n).padStart(12, '0');
const nonce = id(10), origin = 'https://www.lumina-stage.com';
const flush = async () => { for (let i = 0; i < 12; ++i) await Promise.resolve(); };
function target() {
  const listeners = new Map();
  return { addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(f => f !== fn)); },
    emit(type, event) { for (const fn of [...listeners.get(type) || []]) fn(event); },
    count(type) { return (listeners.get(type) || []).length; } };
}
function fixture() {
  const parent = target(), child = target(), queue = [], packets = [], states = [], timers = new Map();
  let owner = id(1), epoch = 0, work = id(2), seq = 0, popup = true;
  const identity = () => ({ ownerId: owner, epoch });
  const isCurrent = value => value?.ownerId === owner && value?.epoch === epoch;
  parent.closed = false; child.closed = false;
  parent.postMessage = (data, destination) => { assert.equal(destination, origin); packets.push(data); queue.push(() => parent.emit('message', { data, origin, source: child })); };
  child.postMessage = (data, destination) => { assert.equal(destination, origin); packets.push(data); queue.push(() => child.emit('message', { data, origin, source: parent })); };
  const global = {};
  runInNewContext(source, { window: global });
  const sender = global.LuminaCreatorApprovedReadingHandoff.createSender({ target: parent, origin,
    readContext: () => ({ identity: identity(), context: { ownerId: owner, workId: work, sourceLocale: 'ko', workLabel: '원작 <script> 텍스트' } }),
    isCurrent, open: (url, name) => { assert.equal(url, '/creator-studio/approved-reading/'); assert.equal(name, '_blank'); return popup ? child : null; } });
  const receiverOptions = { target: child, origin, opener: parent, nonce, identity, isCurrent, onChange: s => states.push(s),
    timers: { setTimeout(fn) { timers.set(++seq, fn); return seq; }, clearTimeout(key) { timers.delete(key); } } };
  const receiver = global.LuminaCreatorApprovedReadingHandoff.createReceiver(receiverOptions);
  function pump() { for (let count = 0; queue.length && count < 100; count++) queue.shift()(); assert.equal(queue.length, 0); }
  function connected() { assert.equal(sender.openCurrent(), true); assert.equal(receiver.start(), true); pump(); assert.equal(receiver.snapshot().workId, id(2)); }
  return { sender, receiver, receiverOptions, parent, child, queue, packets, timers, states, global, identity, isCurrent, pump, connected,
    work(value) { work = value; }, owner(value) { owner = value; epoch++; }, popup(value) { popup = value; } };
}
test('manual handoff preserves the source selection and never puts work or auth into the URL', async () => {
  const h = fixture(); assert.equal(h.packets.length, 0); h.connected();
  const scope = h.receiver.snapshot(); assert.equal(scope.workLabel, '원작 <script> 텍스트');
  const validating = h.receiver.validate(new AbortController().signal); h.pump(); assert.equal(await validating, true);
  assert.equal(h.packets.some(p => Object.hasOwn(p, 'token') || Object.hasOwn(p, 'accessToken')), false);
  h.receiver.dispose(); h.sender.dispose();
});
test('wrong origin and wrong window cannot supply work or validate a read', () => {
  const h = fixture(); h.sender.openCurrent();
  const packet = { type: 'lumina-approved-reading-handoff-v1', nonce, context: { ownerId: id(1), workId: id(2), sourceLocale: 'ko', workLabel: 'Foreign' } };
  h.child.emit('message', { data: packet, origin: 'https://attacker.invalid', source: h.parent });
  h.child.emit('message', { data: packet, origin, source: {} });
  assert.equal(h.receiver.snapshot(), null); h.connected(); h.receiver.dispose(); h.sender.dispose();
});
test('handoff with extra credential or invalid work fields fails closed', () => {
  for (const change of [{ token: 'never-forwarded' }, { workId: id(2) + '\n' }, { sourceLocale: 'zh' }, { ownerId: id(3) }]) {
    const h = fixture(), context = { ownerId: id(1), workId: id(2), sourceLocale: 'ko', workLabel: 'Work', ...change };
    h.child.emit('message', { data: { type: 'lumina-approved-reading-handoff-v1', nonce, context }, origin, source: h.parent });
    assert.equal(h.receiver.snapshot(), null); h.receiver.dispose(); h.sender.dispose();
  }
});
test('work change before the explicit GET check revokes old work', async () => {
  const h = fixture(); h.connected(); h.work(id(3));
  const validating = h.receiver.validate(new AbortController().signal); h.pump();
  assert.equal(await validating, false); assert.equal(h.receiver.snapshot(), null); h.receiver.dispose(); h.sender.dispose();
});
test('owner A to B to A before initial handoff cannot reuse the original epoch', () => {
  const h = fixture(); h.owner(id(4)); h.owner(id(1));
  h.child.emit('message', { data: { type: 'lumina-approved-reading-handoff-v1', nonce,
    context: { ownerId: id(1), workId: id(2), sourceLocale: 'ko', workLabel: 'Old' } }, origin, source: h.parent });
  assert.equal(h.receiver.snapshot(), null); h.receiver.dispose(); h.sender.dispose();
});
test('replaying initial handoff after invalidation never restores private work', () => {
  const h = fixture(); h.connected(); const original = h.packets.find(p => p.type === 'lumina-approved-reading-handoff-v1');
  h.receiver.invalidate(); h.child.emit('message', { data: original, origin, source: h.parent });
  assert.equal(h.receiver.snapshot(), null); h.receiver.dispose(); h.sender.dispose();
});
test('each check requires its own request ID rather than a late earlier acknowledgement', async () => {
  const h = fixture(); h.connected(); const first = h.receiver.validate(new AbortController().signal);
  const sendFirst = h.queue.shift(); sendFirst(); const oldAck = h.queue.shift();
  for (const fn of [...h.timers.values()]) fn(); assert.equal(await first, false); assert.equal(h.receiver.snapshot(), null);
  oldAck(); assert.equal(h.receiver.snapshot(), null); h.receiver.dispose(); h.sender.dispose();
});
test('a parallel check cannot create two outstanding validation requests', async () => {
  const h = fixture(); h.connected(); const first = h.receiver.validate(new AbortController().signal);
  assert.equal(await h.receiver.validate(new AbortController().signal), false);
  h.pump(); assert.equal(await first, true); h.receiver.dispose(); h.sender.dispose();
});
test('caller abort settles the pending check and a late acknowledgement cannot succeed', async () => {
  const h = fixture(); h.connected(); const abort = new AbortController(), promise = h.receiver.validate(abort.signal);
  abort.abort(); assert.equal(await promise, false); h.pump(); assert.equal(h.timers.size, 0); h.receiver.dispose(); h.sender.dispose();
});
test('closed source window clears the linked work and pending check', async () => {
  const h = fixture(); h.connected(); const promise = h.receiver.validate(new AbortController().signal);
  h.parent.closed = true; assert.equal(h.receiver.snapshot(), null); assert.equal(await promise, false);
  h.receiver.dispose(); h.sender.dispose();
});
test('blocked popup opens no hidden fallback and disposal removes only owned listeners', () => {
  const h = fixture(); h.popup(false); assert.equal(h.sender.openCurrent(), false); assert.equal(h.packets.length, 0);
  h.receiver.dispose(); h.sender.dispose(); assert.equal(h.parent.count('message'), 0); assert.equal(h.child.count('message'), 0);
  assert.equal(h.receiver.start(), false);
});
test('standalone page without an opener stays unlinked without issuing a request', () => {
  const h = fixture(); const standalone = h.global.LuminaCreatorApprovedReadingHandoff.createReceiver({ ...h.receiverOptions, opener: null });
  assert.equal(standalone.start(), false); assert.equal(standalone.snapshot(), null); assert.equal(h.packets.length, 0);
  standalone.dispose(); h.receiver.dispose(); h.sender.dispose();
});
test('entry ships only the fixed reader dependencies and no whole Studio, analytics or shared app', () => {
  const scripts = [...html.matchAll(/<script defer src="([^"?]+)(?:\?[^" ]+)?"><\/script>/g)].map(r => r[1]);
  assert.deepEqual(scripts, ['/pages/creator-approved-readonly-transport.js', '/pages/creator-approved-reading-handoff.js',
    '/pages/creator-approved-reading-catalog.js', '/pages/creator-approved-auth-connection.js', '/pages/creator-approved-reading-entry.js', '/pages/creator-approved-section-bytes.js', '/pages/creator-body-preview.js', '/pages/creator-approved-reading-body.js']);
  for (const forbidden of ['gtag', 'app.js', 'creator-studio.js', 'localStorage', 'sessionStorage', 'history.replaceState']) assert.equal(html.includes(forbidden), false);
  assert.match(html, /name="referrer" content="no-referrer"/);
});
test('reader bridge has no storage write, refresh, discovery, token message or paid fallback', () => {
  for (const forbidden of ['setItem(', 'removeItem(', 'auth/refresh', '/wallet', '/messages', '/paid-like', 'window.opener.document', 'window.opener.localStorage']) {
    assert.equal((source + entrySource).includes(forbidden), false, forbidden);
  }
  assert.match(entrySource, /await receiver\.validate\(options\.signal\)/);
  assert.match(entrySource, /receiver\.snapshot\(\) !== before/);
});
test('an acknowledgement of an aborted check cannot satisfy the next check', async () => {
  const h = fixture(); h.connected(); const abort = new AbortController(), first = h.receiver.validate(abort.signal);
  h.queue.shift()(); const lateFirst = h.queue.shift(); abort.abort(); assert.equal(await first, false);
  let settled = false; const second = h.receiver.validate(new AbortController().signal).then(value => { settled = true; return value; });
  lateFirst(); await Promise.resolve(); await Promise.resolve(); assert.equal(settled, false);
  h.pump(); assert.equal(await second, true); h.receiver.dispose(); h.sender.dispose();
});
test('actual entry and readonly transport boot without API calls and recheck current work before one GET', async () => {
  const h = fixture(); h.receiver.dispose(); h.sender.openCurrent();
  const nodes = Object.fromEntries(['writerManuscriptWork', 'writerManuscriptLocale', 'readingWorkTitle', 'readingConnectionState',
    'readingLocale', 'readingTitle', 'readingStudioLink', 'readingLocaleLabel'].map(key => [key, { ...target(), value: key === 'readingLocale' ? 'ko' : '', textContent: '', tagName: 'INPUT', dataset: {} }]));
  const listeners = [], calls = [], intervals = new Map(); let nextInterval = 0;
  const window = { ...h.child, opener: h.parent, crypto: { randomUUID: () => nonce },
    localStorage: { getItem(key) { assert.equal(key, 'lumina_auth'); return JSON.stringify({ accessToken: 'synthetic-reader-token', user: { id: id(1) } }); },
      setItem() { assert.fail('No storage write'); }, removeItem() { assert.fail('No storage delete'); } },
    setTimeout: h.receiverOptions.timers.setTimeout, clearTimeout: h.receiverOptions.timers.clearTimeout,
    fetch(url, options) { calls.push({ url, options }); return Promise.resolve({ status: 401 }); },
    dispatchEvent() {} };
  const document = { readyState: 'loading', documentElement: { lang: 'ko' }, body: { classList: { contains: () => false } },
    addEventListener(type, fn) { assert.equal(type, 'DOMContentLoaded'); listeners.push(fn); }, getElementById(id) { return nodes[id] || null; } };
  const globals = { window, document, location: { origin }, AbortController, Event,
    setInterval(fn) { intervals.set(++nextInterval, fn); return nextInterval; }, clearInterval(key) { intervals.delete(key); } };
  runInNewContext(readFileSync(new URL('../pages/creator-approved-readonly-transport.js', import.meta.url), 'utf8'), globals);
  runInNewContext(source, globals); runInNewContext(entrySource, globals);
  for (const start of listeners) start(); assert.equal(calls.length, 0); h.pump();
  assert.equal(nodes.writerManuscriptWork.value, id(2)); assert.equal(nodes.readingWorkTitle.textContent, '원작 <script> 텍스트');
  const owner = window.LuminaCreatorStudioApi.identity();
  function read() { return window.LuminaCreatorStudioApi.fetch('/api/v1/me/creator-studio/stories/' + id(2) + '/generation-profile/approved-section-bytes?measurement=json-utf8-v1',
    { method: 'GET', identity: owner, token: window.getAuth().accessToken, _retried: true, cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' }, signal: new AbortController().signal }); }
  const first = read(); await flush(); h.pump(); assert.equal((await first).status, 401); assert.equal(calls.length, 1);
  h.work(id(3)); const stale = read(); await flush(); h.pump(); await assert.rejects(stale, /context changed/);
  assert.equal(calls.length, 1); assert.equal(nodes.writerManuscriptWork.value, '');
  window.emit('pagehide', {}); assert.equal(intervals.size, 0); h.sender.dispose();
});
