import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const catalogSource = readFileSync(new URL("../pages/creator-approved-reading-catalog.js", import.meta.url), "utf8");
const transportSource = readFileSync(new URL("../pages/creator-approved-readonly-transport.js", import.meta.url), "utf8");
const lowerOwner = "abcdefab-cdef-4000-8000-000000001414";
const upperOwner = lowerOwner.toUpperCase();
const otherOwner = "fedcba98-7654-4321-8123-000000001415";
const canonicalToken = "synthetic.canonical.token";
const catalogPath = "/api/v1/me/creator-studio/approved-reading-catalog?locale=ko&limit=12";
const auth = (owner = lowerOwner, token = canonicalToken) => ({ accessToken: token, user: { id: owner } });
const workId = index => "abcdef00-1234-4234-8234-" + index.toString(16).padStart(12, "0");
const packet = (count = 1, start = 1, next = false) => ({
  contract: "story-owner-approved-reading-catalog-v1", sourceScope: "owner_work_records_only",
  readOnly: true, providerCalls: 0, operatingWrites: 0,
  items: Array.from({ length: count }, (_, index) => ({ workId: workId(start + index),
    title: { value: "Synthetic work " + (start + index), locale: "ko", fallback: false, bounded: false },
    defaultLocale: "ko", recordedState: { workStatus: "draft", approval: "not_checked" } })),
  nextCursor: next ? workId(start + count - 1) : null,
});
const response = value => new Response(JSON.stringify(value), {
  headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", Vary: "Authorization" },
});
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function trackedResponse(value) {
  const actual = response(value);
  let canceled = 0, readers = 0;
  return {
    status: actual.status, headers: actual.headers,
    body: {
      cancel() { ++canceled; return actual.body.cancel(); },
      getReader() { ++readers; return actual.body.getReader(); },
    },
    canceled: () => canceled, readers: () => readers,
  };
}

function fixture(t, { initialAuth = auth(), send = async () => response(packet()) } = {}) {
  const values = new Map();
  if (initialAuth !== null) values.set("lumina_auth", JSON.stringify(initialAuth));
  const reads = [], writes = [], requests = [], calls = [], states = [], listeners = new Map();
  const storage = {
    getItem(key) { reads.push(key); return values.get(key) ?? null; },
    setItem(...args) { writes.push(["set", ...args]); throw new Error("Synthetic storage writes forbidden"); },
    removeItem(...args) { writes.push(["remove", ...args]); throw new Error("Synthetic storage writes forbidden"); },
    clear() { writes.push(["clear"]); throw new Error("Synthetic storage writes forbidden"); },
  };
  const eventTarget = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) { for (const listener of [...(listeners.get(event.type) || [])]) listener(event); },
  };
  const nativeFetch = (url, options) => { calls.push({ url, options }); return send(url, options); };
  const window = { ...eventTarget, localStorage: storage, fetch: nativeFetch };
  const context = vm.createContext({ window, AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout });
  vm.runInContext(transportSource, context, { filename: "creator-approved-readonly-transport.js" });
  vm.runInContext(catalogSource, context, { filename: "creator-approved-reading-catalog.js" });
  const transport = window.LuminaCreatorApprovedReadonlyTransport.createCatalog({ storage, eventTarget, fetch: nativeFetch });
  // Observe catalog options, then call the unchanged real transport; no auth, route or currentness implementation is replaced.
  const observed = Object.freeze({ ...transport, fetch(path, options) {
    requests.push({ path, options }); return transport.fetch(path, options);
  } });
  const catalog = window.LuminaCreatorApprovedReadingCatalog.create({ transport: observed, locale: () => "ko",
    deadlineMs: 1000, onChange: state => states.push(state) });
  t.after(() => {
    catalog.dispose(); transport.dispose();
    assert.equal(writes.length, 0);
    assert.equal(reads.every(key => key === "lumina_auth"), true);
    for (const call of calls) {
      assert.equal(call.options.method, "GET");
      assert.equal(call.options.credentials, "omit");
      assert.equal(call.options.redirect, "error");
      assert.equal(call.options.cache, "no-store");
      assert.equal(call.options.referrerPolicy, "no-referrer");
      assert.equal(Object.hasOwn(call.options, "body"), false);
      assert.equal(call.url.startsWith("https://api.lumina-stage.com" + catalogPath), true);
    }
    assert.equal([...listeners.values()].every(set => set.size === 0), true);
  });
  return { transport, catalog, requests, calls, writes, states,
    parse: window.LuminaCreatorApprovedReadingCatalog.parse, latest: () => states.at(-1),
    setAuth(value) { if (value === null) values.delete("lumina_auth"); else values.set("lumina_auth", JSON.stringify(value)); },
    emit(type, fields = {}) { eventTarget.dispatchEvent({ type, ...fields }); },
  };
}

function exactRequest(f, owner, token, epoch, cursor = null) {
  const recorded = f.requests.at(-1), sent = f.calls.at(-1);
  const path = catalogPath + (cursor === null ? "" : "&cursor=" + cursor);
  assert.equal(recorded.path, path);
  assert.equal(recorded.options.identity.ownerId, owner);
  assert.equal(recorded.options.identity.epoch, epoch);
  assert.equal(recorded.options.token, token);
  assert.equal(recorded.options._retried, true);
  assert.equal(recorded.options.method, "GET");
  assert.equal(recorded.options.cache, "no-store");
  assert.equal(sent.url, "https://api.lumina-stage.com" + path);
  assert.equal(sent.options.headers.Authorization, "Bearer " + token);
  assert.equal(sent.options.headers.Accept, "application/json");
  assert.equal(sent.options.headers["Cache-Control"], "no-store");
  assert.deepEqual(Object.keys(sent.options.headers).sort(), ["Accept", "Authorization", "Cache-Control"]);
  assert.equal(Object.hasOwn(sent.options, "identity"), false);
  assert.equal(Object.hasOwn(sent.options, "token"), false);
}

test("owner-case: uppercase v4 owner reaches idle with real canonical auth and epoch zero without automatic GET", t => {
  const f = fixture(t, { initialAuth: auth(upperOwner) });
  const current = f.transport.identity(), supplied = f.transport.getAuth();
  assert.equal(current.ownerId, upperOwner); assert.equal(current.epoch, 0);
  assert.equal(f.transport.isCurrent(current), true);
  assert.equal(supplied.accessToken, canonicalToken); assert.equal(supplied.user.id, upperOwner);
  assert.equal(f.latest().phase, "idle"); assert.equal(f.catalog.selection(), null);
  assert.equal(f.requests.length, 0); assert.equal(f.calls.length, 0);
});

test("owner-case: explicit uppercase-owner load preserves original owner token and epoch zero then selects the lowercase work", async t => {
  const f = fixture(t, { initialAuth: auth(upperOwner) });
  assert.equal(await f.catalog.load(), true);
  assert.equal(f.requests.length, 1); assert.equal(f.calls.length, 1);
  exactRequest(f, upperOwner, canonicalToken, 0);
  assert.equal(f.latest().phase, "ready"); assert.equal(f.catalog.choose(workId(1)), true);
  const selection = f.catalog.selection();
  assert.equal(selection.ownerId, upperOwner); assert.equal(selection.workId, workId(1));
  assert.equal(f.catalog.isSelectionCurrent(selection), true); assert.equal(Object.isFrozen(selection), true);
  assert.equal(f.transport.identity().ownerId, upperOwner); assert.equal(f.transport.identity().epoch, 0);
});

test("owner-case: lowercase-equivalent canonical auth retains existing idle load selection and epoch-zero behavior", async t => {
  const f = fixture(t);
  assert.equal(f.latest().phase, "idle"); assert.equal(f.calls.length, 0);
  assert.equal(await f.catalog.load(), true); exactRequest(f, lowerOwner, canonicalToken, 0);
  assert.equal(f.catalog.choose(workId(1)), true);
  const selection = f.catalog.selection();
  assert.equal(selection.ownerId, lowerOwner); assert.equal(selection.workId, workId(1));
  assert.equal(f.catalog.isSelectionCurrent(selection), true);
  assert.equal(f.latest().items[0].recordedState.approval, "not_checked");
  assert.equal(f.calls.length, 1);
});

test("owner-case: malformed or missing owner stays fail-closed in actual transport and catalog", async t => {
  for (const user of [{ id: "not-a-uuid" }, { id: upperOwner + "\n" }, {}]) {
    const f = fixture(t, { initialAuth: { accessToken: canonicalToken, user } });
    assert.equal(f.transport.getAuth(), null); assert.equal(f.transport.identity(), null);
    assert.equal(f.latest().phase, "unauthenticated"); assert.equal(await f.catalog.load(), false);
    assert.equal(f.requests.length, 0); assert.equal(f.calls.length, 0);
  }
});

test("owner-case: absent auth missing token and malformed token cannot borrow owner-case acceptance", async t => {
  for (const initialAuth of [null, { user: { id: upperOwner } }, auth(upperOwner, canonicalToken + "\r")]) {
    const f = fixture(t, { initialAuth });
    assert.equal(f.transport.getAuth(), null); assert.equal(f.transport.identity(), null);
    assert.equal(f.latest().phase, "unauthenticated"); assert.equal(await f.catalog.load(), false);
    assert.equal(f.requests.length, 0); assert.equal(f.calls.length, 0);
  }
});

test("owner-case: uppercase work IDs remain parser-invalid rather than broadening the shared work regex", t => {
  const f = fixture(t), valid = packet(), invalid = packet();
  assert.notEqual(f.parse(valid), null);
  invalid.items[0].workId = invalid.items[0].workId.toUpperCase();
  assert.equal(f.parse(invalid), null);
  assert.equal(f.calls.length, 0);
});

test("owner-case: returned cursor and matching work stay strictly lowercase and only exact lowercase cursor can dispatch", async t => {
  const invalid = packet(12, 1, true);
  invalid.items.at(-1).workId = invalid.items.at(-1).workId.toUpperCase();
  invalid.nextCursor = invalid.items.at(-1).workId;
  let sent = 0;
  const f = fixture(t, { send: async () => response(++sent === 1 ? packet(12, 1, true) : packet(1, 20)) });
  assert.equal(f.parse(invalid), null);
  assert.equal(await f.catalog.load(), true);
  const cursor = f.latest().nextCursor;
  assert.equal(cursor, workId(12));
  assert.equal(await f.catalog.load(cursor.toUpperCase()), false); assert.equal(f.calls.length, 1);
  assert.equal(await f.catalog.load(cursor), true); assert.equal(f.calls.length, 2);
  exactRequest(f, lowerOwner, canonicalToken, 0, cursor);
  assert.equal(f.latest().items[0].workId, workId(20));
});

test("owner-case: token change clears a ready selection without normalizing owner or automatically fetching", async t => {
  const f = fixture(t);
  assert.equal(await f.catalog.load(), true); assert.equal(f.catalog.choose(workId(1)), true);
  const old = f.catalog.selection(), identity = f.transport.identity();
  f.setAuth(auth(lowerOwner, "synthetic.rotated.token")); f.catalog.sync();
  assert.equal(f.catalog.selection(), null); assert.equal(f.catalog.isSelectionCurrent(old), false);
  assert.equal(f.transport.isCurrent(identity), false); assert.equal(f.transport.identity().epoch, 1);
  assert.equal(f.latest().phase, "idle"); assert.equal(f.latest().items.length, 0);
  assert.equal(f.catalog.choose(workId(1)), false); assert.equal(f.calls.length, 1);
});

test("owner-case: owner change clears a ready selection and binds the next explicit load only to the new owner", async t => {
  const f = fixture(t);
  assert.equal(await f.catalog.load(), true); assert.equal(f.catalog.choose(workId(1)), true);
  const old = f.catalog.selection(), identity = f.transport.identity();
  f.setAuth(auth(otherOwner, "synthetic.other.token")); f.catalog.sync();
  assert.equal(f.catalog.selection(), null); assert.equal(f.catalog.isSelectionCurrent(old), false);
  assert.equal(f.transport.isCurrent(identity), false); assert.equal(f.transport.identity().epoch, 1);
  assert.equal(f.latest().phase, "idle"); assert.equal(f.calls.length, 1);
  assert.equal(await f.catalog.load(), true); exactRequest(f, otherOwner, "synthetic.other.token", 1);
  assert.equal(f.catalog.choose(workId(1)), true); assert.equal(f.catalog.selection().ownerId, otherOwner);
  assert.equal(f.calls.length, 2);
});

test("owner-case: token replacement cancels pending real transport work and cannot adopt a late ignored-abort response", async t => {
  const wait = deferred(), f = fixture(t, { send: () => wait.promise });
  const identity = f.transport.identity(), pending = f.catalog.load();
  assert.equal(f.calls.length, 1);
  f.setAuth(auth(lowerOwner, "synthetic.rotated.token")); f.catalog.sync();
  assert.equal(f.calls[0].options.signal.aborted, true); assert.equal(await pending, false);
  assert.equal(f.transport.isCurrent(identity), false);
  const late = trackedResponse(packet()); wait.resolve(late);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(late.canceled(), 1); assert.equal(late.readers(), 0);
  assert.equal(f.latest().phase, "idle"); assert.equal(f.latest().items.length, 0);
  assert.equal(f.catalog.selection(), null); assert.equal(f.catalog.choose(workId(1)), false);
  assert.equal(f.calls.length, 1);
});

test("owner-case: owner replacement retires pending identity and rejects late data without exposing the old work", async t => {
  const wait = deferred(), f = fixture(t, { send: () => wait.promise });
  const identity = f.transport.identity(), pending = f.catalog.load();
  f.setAuth(auth(otherOwner, "synthetic.other.token"));
  f.emit("storage", { key: "lumina_auth" }); f.catalog.sync();
  assert.equal(f.calls[0].options.signal.aborted, true); assert.equal(await pending, false);
  assert.equal(f.transport.isCurrent(identity), false);
  assert.equal(f.transport.identity().ownerId, otherOwner); assert.equal(f.transport.identity().epoch, 1);
  const late = trackedResponse(packet()); wait.resolve(late);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(late.canceled(), 1); assert.equal(late.readers(), 0);
  assert.equal(f.latest().phase, "idle"); assert.equal(f.latest().items.length, 0);
  assert.equal(f.catalog.selection(), null); assert.equal(f.catalog.choose(workId(1)), false);
  assert.equal(f.calls.length, 1);
});

test("owner-case: real transport keeps canonical token and user ahead of contradictory synthetic aliases", async t => {
  const initialAuth = { ...auth(), access_token: "synthetic.alias.token", token: "synthetic.legacy.token",
    tokens: { accessToken: "synthetic.nested.token" }, viewer: { id: otherOwner } };
  const f = fixture(t, { initialAuth });
  assert.equal(f.transport.getAuth().accessToken, canonicalToken);
  assert.equal(f.transport.getAuth().user.id, lowerOwner); assert.equal(f.transport.identity().epoch, 0);
  assert.equal(await f.catalog.load(), true); exactRequest(f, lowerOwner, canonicalToken, 0);
  assert.equal(f.calls.length, 1);
});
