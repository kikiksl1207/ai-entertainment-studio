import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TextDecoder, TextEncoder } from "node:util";
import vm from "node:vm";

// Author UNRUN: actual catalog and readonly transport in a VM; synthetic memory and inert I/O only.
const catalogSource = readFileSync(new URL("../pages/creator-approved-reading-catalog.js", import.meta.url), "utf8");
const transportSource = readFileSync(new URL("../pages/creator-approved-readonly-transport.js", import.meta.url), "utf8");
const OWNER_A = "00000000-0000-4000-8000-000000001101";
const OWNER_B = "00000000-0000-4000-8000-000000001102";
const WORK_A = "00000000-0000-4000-800a-000000001103";
const WORK_B = "00000000-0000-4000-800a-000000001104";
const TOKEN_A = "synthetic.reading.fixture.a";
const TOKEN_B = "synthetic.reading.fixture.b";
const AUTH_KEY = "lumina_auth";
const PATH = "/api/v1/me/creator-studio/approved-reading-catalog?locale=ko&limit=12";
const OPTIONS = { timeout: 2000 };
const auth = (owner = OWNER_A, token = TOKEN_A) => ({ accessToken: token, user: { id: owner } });
const packet = (workId = WORK_A) => ({
  contract: "story-owner-approved-reading-catalog-v1",
  sourceScope: "owner_work_records_only",
  readOnly: true,
  providerCalls: 0,
  operatingWrites: 0,
  items: [{ workId, title: { value: "Synthetic reading fixture", locale: "ko", fallback: false, bounded: false },
    defaultLocale: "ko", recordedState: { workStatus: "draft", approval: "not_checked" } }],
  nextCursor: null,
});

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

async function flush() {
  for (let index = 0; index < 32; ++index) await Promise.resolve();
}

function controlledClock() {
  let now = 0, nextId = 0;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      assert(Number.isInteger(delay) && delay >= 1 && delay <= 30000);
      const id = ++nextId;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(milliseconds) {
      assert(Number.isInteger(milliseconds) && milliseconds >= 0 && milliseconds <= 30000);
      const until = now + milliseconds;
      let dispatched = 0;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        assert(++dispatched <= 64, "Synthetic clock dispatch bound");
        const [id, timer] = next;
        timers.delete(id); now = timer.at; timer.callback();
      }
      now = until;
    },
    pending: () => timers.size,
  };
}

function response(value, { status = 200, headers = {}, raw } = {}) {
  const bytes = new TextEncoder().encode(raw === undefined ? JSON.stringify(value) : raw);
  assert(bytes.byteLength <= 8193, "Synthetic response byte bound");
  const fields = new Map(Object.entries({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
    Vary: "Authorization",
    "Content-Length": String(bytes.byteLength),
    ...headers,
  }).map(([name, value]) => [name.toLowerCase(), value]));
  const stats = { canceled: 0, readers: 0, reads: 0, readerCanceled: 0, released: 0 };
  const chunks = bytes.byteLength > 256 ? [bytes.subarray(0, 256), bytes.subarray(256)] : [bytes];
  return {
    status,
    headers: { get: name => fields.get(name.toLowerCase()) ?? null },
    body: {
      cancel() { ++stats.canceled; return Promise.resolve(); },
      getReader() {
        assert.equal(++stats.readers, 1);
        let index = 0;
        return {
          read() {
            assert(++stats.reads <= chunks.length + 1, "Synthetic reader dispatch bound");
            return Promise.resolve(index < chunks.length ? { done: false, value: chunks[index++] } : { done: true });
          },
          cancel() { ++stats.readerCanceled; return Promise.resolve(); },
          releaseLock() { ++stats.released; },
        };
      },
    },
    stats,
  };
}

function fixture(t, { initialAuth = auth(), send = () => response(packet()), deadlineMs = 25 } = {}) {
  const values = new Map();
  if (initialAuth !== null) values.set(AUTH_KEY, JSON.stringify(initialAuth));
  const reads = [], writes = [], calls = [], requests = [], states = [], listeners = new Map();
  const clock = controlledClock();
  const storage = {
    getItem(key) { reads.push(key); return values.get(key) ?? null; },
    setItem(...args) { writes.push(["set", ...args]); throw new Error("Synthetic storage write forbidden"); },
    removeItem(...args) { writes.push(["remove", ...args]); throw new Error("Synthetic storage removal forbidden"); },
    clear() { writes.push(["clear"]); throw new Error("Synthetic storage clear forbidden"); },
  };
  const eventTarget = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) { for (const listener of [...(listeners.get(event.type) || [])]) listener(event); },
  };
  const inertFetch = (url, options) => {
    calls.push({ url, options });
    return send(url, options);
  };
  const window = { ...eventTarget, localStorage: storage, fetch: inertFetch };
  const context = vm.createContext({ window, AbortController, TextDecoder, Uint8Array,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  vm.runInContext(transportSource, context, { filename: "creator-approved-readonly-transport.js", timeout: 1000 });
  vm.runInContext(catalogSource, context, { filename: "creator-approved-reading-catalog.js", timeout: 1000 });
  const transport = window.LuminaCreatorApprovedReadonlyTransport.createCatalog({ storage, eventTarget, fetch: inertFetch });
  // Observe request arguments while delegating all transport behavior to the original implementation.
  const observed = Object.freeze({ ...transport, fetch(path, options) {
    requests.push({ path, options }); return transport.fetch(path, options);
  } });
  const catalog = window.LuminaCreatorApprovedReadingCatalog.create({ transport: observed, locale: () => "ko",
    deadlineMs, onChange: state => states.push(state) });
  t.after(() => {
    catalog.dispose(); transport.dispose();
    assert.equal(writes.length, 0);
    assert(reads.every(key => key === AUTH_KEY));
    assert.equal(clock.pending(), 0);
    assert([...listeners.values()].every(set => set.size === 0));
    for (const { url, options } of calls) {
      assert.equal(url, "https://api.lumina-stage.com" + PATH);
      assert.equal(options.method, "GET");
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      assert.equal(options.referrerPolicy, "no-referrer");
      assert.equal(Object.hasOwn(options, "body"), false);
    }
  });
  return { catalog, transport, clock, calls, requests, states, writes,
    parse: window.LuminaCreatorApprovedReadingCatalog.parse,
    latest: () => states.at(-1), snapshot: () => [...values.entries()],
    setAuth(value) { if (value === null) values.delete(AUTH_KEY); else values.set(AUTH_KEY, JSON.stringify(value)); },
    emit(type) { eventTarget.dispatchEvent({ type }); },
  };
}

function exactRequest(f, index, owner = OWNER_A, token = TOKEN_A, epoch = 0) {
  const request = f.requests[index], call = f.calls[index];
  assert.equal(request.path, PATH);
  assert.equal(request.options.identity.ownerId, owner);
  assert.equal(request.options.identity.epoch, epoch);
  assert.equal(request.options.token, token);
  assert.equal(request.options._retried, true);
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.cache, "no-store");
  assert.equal(request.options.headers.Accept, "application/json");
  assert.equal(request.options.headers["Cache-Control"], "no-store");
  assert.deepEqual(Object.keys(request.options.headers).sort(), ["Accept", "Cache-Control"]);
  assert.equal(call.options.headers.Authorization, "Bearer " + token);
  assert.deepEqual(Object.keys(call.options.headers).sort(), ["Accept", "Authorization", "Cache-Control"]);
  assert.equal(Object.hasOwn(call.options, "identity"), false);
  assert.equal(Object.hasOwn(call.options, "token"), false);
}

function cleared(f, oldSelection = null) {
  assert.equal(f.latest().items.length, 0);
  assert.equal(f.latest().nextCursor, null);
  assert.equal(f.catalog.selection(), null);
  assert.equal(f.catalog.choose(WORK_A), false);
  if (oldSelection !== null) assert.equal(f.catalog.isSelectionCurrent(oldSelection), false);
}

test("reading auth-rejection: missing or invalid initial identity remains unauthenticated with no GET", OPTIONS, async t => {
  for (const initialAuth of [null, { accessToken: TOKEN_A, user: { id: "synthetic-invalid-owner" } }]) {
    const f = fixture(t, { initialAuth });
    assert.equal(f.latest().phase, "unauthenticated");
    assert.equal(f.transport.getAuth(), null);
    assert.equal(f.transport.identity(), null);
    assert.equal(await f.catalog.load(), false);
    f.catalog.sync(); await flush();
    cleared(f);
    assert.equal(f.calls.length, 0);
    assert.equal(f.requests.length, 0);
    assert.equal(f.writes.length, 0);
  }
});

test("reading auth-rejection: one manual cached-identity 401 clears prior items and selection without changing auth or storage", OPTIONS, async t => {
  const rejected = response({ syntheticError: "reading authentication check" }, { status: 401 });
  let sent = 0;
  const f = fixture(t, { send: () => ++sent === 1 ? response(packet()) : rejected });
  assert.equal(await f.catalog.load(), true);
  assert.equal(f.catalog.choose(WORK_A), true);
  const oldSelection = f.catalog.selection(), beforeAuth = f.transport.getAuth();
  const beforeIdentity = f.transport.identity(), beforeStorage = f.snapshot(), beforeCalls = f.calls.length;
  assert.equal(await f.catalog.load(), false);
  cleared(f, oldSelection);
  assert.equal(f.calls.length - beforeCalls, 1);
  assert.equal(f.calls.length, 2);
  exactRequest(f, 1);
  assert.deepEqual(f.transport.getAuth(), beforeAuth);
  assert.deepEqual(f.transport.identity(), beforeIdentity);
  assert.deepEqual(f.snapshot(), beforeStorage);
  assert.equal(rejected.stats.canceled, 0);
  assert.equal(rejected.stats.readers, 1);
  assert.equal(rejected.stats.readerCanceled, 1);
  assert.equal(rejected.stats.released, 1);
  assert.equal(f.latest().authReason, null);
  f.catalog.sync(); await flush(); f.clock.advance(100); await flush();
  assert.equal(f.calls.length, 2);
  assert.equal(f.writes.length, 0);
  assert.equal(f.latest().phase, "auth_rejected");
});

test("reading auth-rejection: HTTP 403 remains generic unavailable rather than auth_rejected", OPTIONS, async t => {
  const denied = response({ syntheticError: "generic rejection" }, { status: 403 });
  let sent = 0;
  const f = fixture(t, { send: () => ++sent === 1 ? response(packet()) : denied });
  assert.equal(await f.catalog.load(), true);
  assert.equal(f.catalog.choose(WORK_A), true);
  const selection = f.catalog.selection(), beforeAuth = f.transport.getAuth(), beforeStorage = f.snapshot();
  assert.equal(await f.catalog.load(), false);
  assert.equal(f.latest().phase, "unavailable");
  assert.notEqual(f.latest().phase, "auth_rejected");
  cleared(f, selection);
  assert.deepEqual(f.transport.getAuth(), beforeAuth);
  assert.deepEqual(f.snapshot(), beforeStorage);
  assert.equal(denied.stats.canceled, 1);
  assert.equal(denied.stats.readers, 0);
  await flush(); assert.equal(f.calls.length, 2);
});

test("reading auth-rejection: a new auth context resets cached 401 to idle without GET before manual success", OPTIONS, async t => {
  let sent = 0;
  const f = fixture(t, { send: () => ++sent === 1 ? response({}, { status: 401 }) : response(packet(WORK_B)) });
  const oldIdentity = f.transport.identity();
  assert.equal(await f.catalog.load(), false);
  assert.equal(f.latest().phase, "auth_rejected");
  assert.equal(f.calls.length, 1);
  f.setAuth(auth(OWNER_B, TOKEN_B)); f.emit("lumina:authchange"); f.catalog.sync();
  assert.equal(f.latest().phase, "idle");
  cleared(f);
  assert.equal(f.transport.isCurrent(oldIdentity), false);
  assert.equal(f.transport.identity().epoch, 1);
  assert.equal(f.transport.getAuth().accessToken, TOKEN_B);
  await flush(); assert.equal(f.calls.length, 1);
  const newStorage = f.snapshot();
  assert.equal(await f.catalog.load(), true);
  exactRequest(f, 1, OWNER_B, TOKEN_B, 1);
  assert.equal(f.latest().phase, "ready");
  assert.equal(f.catalog.choose(WORK_B), true);
  assert.equal(f.catalog.selection().ownerId, OWNER_B);
  assert.deepEqual(f.snapshot(), newStorage);
  assert.equal(f.calls.length, 2);
});

test("reading auth-rejection: auth changing during a deferred 401 yields stale without an old-context auth_rejected", OPTIONS, async t => {
  const wait = deferred();
  let sent = 0;
  const f = fixture(t, { send: () => ++sent === 1 ? response(packet()) : wait.promise });
  assert.equal(await f.catalog.load(), true);
  assert.equal(f.catalog.choose(WORK_A), true);
  const selection = f.catalog.selection(), identity = f.transport.identity(), pending = f.catalog.load();
  assert.equal(f.calls.length, 2);
  f.setAuth(auth(OWNER_B, TOKEN_B)); f.emit("lumina:authchange");
  const late = response({}, { status: 401 }); wait.resolve(late);
  assert.equal(await pending, false); await flush();
  assert.equal(f.latest().phase, "stale");
  assert.equal(f.states.some(state => state.phase === "auth_rejected"), false);
  assert.equal(f.calls[1].options.signal.aborted, true);
  assert.equal(late.stats.canceled, 1);
  assert.equal(late.stats.readers, 0);
  assert.equal(f.transport.isCurrent(identity), false);
  cleared(f, selection);
  assert.equal(f.latest().phase, "idle");
  assert.equal(f.transport.getAuth().user.id, OWNER_B);
  assert.equal(f.calls.length, 2);
});

test("reading auth-rejection: ignored late 401 after cancellation or controlled timeout cannot overwrite state or retain old results", OPTIONS, async t => {
  for (const terminal of ["cancel", "timeout"]) {
    const wait = deferred();
    let sent = 0;
    const f = fixture(t, { send: () => ++sent === 1 ? response(packet()) : wait.promise });
    assert.equal(await f.catalog.load(), true);
    assert.equal(f.catalog.choose(WORK_A), true);
    const selection = f.catalog.selection(), beforeStorage = f.snapshot(), pending = f.catalog.load();
    if (terminal === "cancel") f.catalog.dispose(); else f.clock.advance(25);
    assert.equal(await pending, false);
    assert.equal(f.latest().phase, terminal === "cancel" ? "unauthenticated" : "timeout");
    cleared(f, selection);
    const terminalState = f.latest(), stateCount = f.states.length;
    const late = response({}, { status: 401 }); wait.resolve(late); await flush();
    assert.equal(late.stats.canceled, 1);
    assert.equal(late.stats.readers, 0);
    assert.equal(f.latest(), terminalState);
    assert.equal(f.states.length, stateCount);
    assert.equal(f.states.some(state => state.phase === "auth_rejected"), false);
    assert.equal(f.calls[1].options.signal.aborted, true);
    assert.deepEqual(f.snapshot(), beforeStorage);
    assert.equal(f.calls.length, 2);
    assert.equal(f.clock.pending(), 0);
  }
});

test("reading auth-rejection: explicit repeats while pending are suppressed with no automatic 401 retry", OPTIONS, async t => {
  const wait = deferred(), f = fixture(t, { send: () => wait.promise });
  const beforeStorage = f.snapshot(), pending = f.catalog.load();
  assert.equal(f.latest().phase, "loading");
  for (let index = 0; index < 3; ++index) assert.equal(await f.catalog.load(), false);
  f.clock.advance(10); await flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.requests.length, 1);
  assert.equal(f.latest().phase, "loading");
  wait.resolve(response({}, { status: 401 }));
  assert.equal(await pending, false);
  f.catalog.sync(); f.clock.advance(100); await flush();
  cleared(f);
  assert.equal(f.calls.length, 1);
  assert.equal(f.requests.length, 1);
  exactRequest(f, 0);
  assert.deepEqual(f.snapshot(), beforeStorage);
  assert.equal(f.clock.pending(), 0);
  assert.equal(f.latest().phase, "auth_rejected");
});

test("reading auth-rejection: 200 keeps original strict catalog parsing and private no-store Authorization Vary guards", OPTIONS, async t => {
  const good = response(packet(), { headers: { Vary: "Origin, Authorization, Accept-Encoding" } });
  const f = fixture(t, { send: () => good });
  assert.equal(await f.catalog.load(), true);
  exactRequest(f, 0);
  assert.equal(f.latest().phase, "ready");
  assert.equal(f.latest().items[0].recordedState.approval, "not_checked");
  assert.equal(Object.isFrozen(f.latest().items), true);
  assert.equal(good.stats.readers, 1);
  assert.equal(good.stats.released, 1);
  assert.equal(f.catalog.choose(WORK_A), true);
  assert.equal(f.catalog.isSelectionCurrent(f.catalog.selection()), true);
  const getterPacket = packet();
  let invoked = 0;
  Object.defineProperty(getterPacket.items[0].title, "value", { enumerable: true,
    get() { ++invoked; throw new Error("Synthetic getter must not run"); } });
  assert.equal(f.parse(getterPacket), null);
  assert.equal(invoked, 0);
  const extra = packet(); extra.extra = "synthetic";
  const uppercase = packet(WORK_A.toUpperCase());
  const approval = packet(); approval.items[0].recordedState.approval = "approved";
  const badReplies = [
    response(packet(), { headers: { "Cache-Control": "private" } }),
    response(packet(), { headers: { "Cache-Control": "no-store" } }),
    response(packet(), { headers: { Vary: "Origin, Accept-Encoding" } }),
    response(packet(), { headers: { "Content-Type": "text/plain" } }),
    response(extra), response(uppercase), response(approval),
    response(null, { raw: "x".repeat(8193), headers: { "Content-Length": "8192" } }),
  ];
  for (const rejected of badReplies) {
    const failed = fixture(t, { send: () => rejected });
    assert.equal(await failed.catalog.load(), false);
    assert.equal(failed.latest().phase, "unavailable");
    cleared(failed);
    assert.equal(failed.calls.length, 1);
    assert.equal(failed.states.some(state => state.phase === "auth_rejected"), false);
  }
});
