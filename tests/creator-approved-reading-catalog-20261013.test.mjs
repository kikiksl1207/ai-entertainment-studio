import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../pages/creator-approved-reading-catalog.js", import.meta.url), "utf8");
const transportSource = readFileSync(new URL("../pages/creator-approved-readonly-transport.js", import.meta.url), "utf8");
const owner = "11111111-1111-4111-8111-111111111111";
const workId = index => "33333333-3333-4333-8333-" + index.toString(16).padStart(12, "0");
const item = index => ({ workId: workId(index), title: { value: "합성 작품 " + index, locale: "ko", fallback: false, bounded: false },
  defaultLocale: "ko", recordedState: { workStatus: "draft", approval: "not_checked" } });
const packet = (count = 1, start = 1, next = false) => ({ contract: "story-owner-approved-reading-catalog-v1", sourceScope: "owner_work_records_only",
  readOnly: true, providerCalls: 0, operatingWrites: 0, items: Array.from({ length: count }, (_, i) => item(start + i)), nextCursor: next ? workId(start + count - 1) : null });
const response = (value, headers = {}, status = 200) => new Response(JSON.stringify(value), { status,
  headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", Vary: "Authorization", ...headers } });
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture({ send = async () => response(packet()), authenticated = true, deadlineMs = 30000 } = {}) {
  let auth = authenticated ? { accessToken: "synthetic.token", user: { id: owner } } : null, locale = "ko";
  const calls = [], writes = [], states = [], listeners = new Map();
  const window = { localStorage: { getItem: () => auth ? JSON.stringify(auth) : null,
    setItem: (...x) => writes.push(x), removeItem: (...x) => writes.push(x), clear: () => writes.push("clear") },
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); } };
  const context = vm.createContext({ window, AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout });
  vm.runInContext(transportSource, context); vm.runInContext(source, context);
  const options = { storage: window.localStorage, eventTarget: window, fetch: (url, opts) => { calls.push({ url, opts }); return send(url, opts); } };
  const transport = window.LuminaCreatorApprovedReadonlyTransport.createCatalog(options);
  const controller = window.LuminaCreatorApprovedReadingCatalog.create({ transport, locale: () => locale,
    deadlineMs, onChange: state => states.push(state) });
  return { controller, transport, calls, writes, states, parse: window.LuminaCreatorApprovedReadingCatalog.parse,
    defaultTransport: () => window.LuminaCreatorApprovedReadonlyTransport.create(options),
    auth(next) { auth = next; for (const callback of listeners.get("lumina:authchange") || []) callback({ type: "lumina:authchange" }); },
    locale(value) { locale = value; }, latest: () => states.at(-1),
    dispose() { controller.dispose(); transport.dispose(); } };
}

test("Constructing the catalog performs no operating read, storage migration or bootstrap", () => {
  const f = fixture(); assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0); assert.equal(f.latest().phase, "idle"); f.dispose();
});
test("Explicit catalog GET is separate from numeric inspection and binds owner without URL credentials", async () => {
  const f = fixture(); assert.equal(await f.controller.load(), true); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://api.lumina-stage.com/api/v1/me/creator-studio/approved-reading-catalog?locale=ko&limit=12");
  assert.equal(f.calls[0].opts.method, "GET"); assert.equal(f.calls[0].opts.credentials, "omit"); assert.equal(f.calls[0].opts.redirect, "error");
  assert.equal(f.calls[0].opts.headers.Authorization, "Bearer synthetic.token"); assert(!Object.hasOwn(f.calls[0].opts, "body"));
  assert.equal(f.controller.choose(workId(1)), true); const selected = f.controller.selection();
  assert.equal(selected.ownerId, owner); assert.equal(selected.sourceLocale, "ko"); assert.equal(f.controller.isSelectionCurrent(selected), true);
  assert(Object.isFrozen(selected)); assert.equal(f.writes.length, 0); f.dispose();
});
test("Default transport still rejects catalog, and catalog transport rejects numeric/API/write endpoints", async () => {
  const f = fixture(), normal = f.defaultTransport();
  const options = adapter => ({ method: "GET", identity: adapter.identity(), token: adapter.getAuth().accessToken,
    _retried: true, cache: "no-store", headers: { Accept: "application/json", "Cache-Control": "no-store" }, signal: new AbortController().signal });
  await assert.rejects(normal.fetch("/api/v1/me/creator-studio/approved-reading-catalog?locale=ko&limit=12", options(normal)), { code: "invalid_request" });
  for (const path of ["/api/v1/me/creator-studio", "/api/v1/me/creator-studio/stories", "/api/v1/wallet", "/api/v1/auth/refresh",
    "/api/v1/me/creator-studio/stories/" + workId(1) + "/generation-profile/approved-section-bytes?measurement=json-utf8-v1",
    "/api/v1/me/creator-studio/approved-reading-catalog?locale=ko&limit=20",
    "/api/v1/me/creator-studio/approved-reading-catalog?locale=ko&limit=12&owner=" + owner]) {
    await assert.rejects(f.transport.fetch(path, options(f.transport)), { code: "invalid_request" });
  }
  await assert.rejects(f.transport.fetch("/api/v1/me/creator-studio/approved-reading-catalog?locale=ko&limit=12", { ...options(f.transport), method: "POST" }), { code: "invalid_request" });
  assert.equal(f.calls.length, 0); normal.dispose(); f.dispose();
});
for (const [label, change] of [
  ["extra root data", p => { p.email = "synthetic"; }], ["provider count", p => { p.providerCalls = 1; }],
  ["negative zero", p => { p.operatingWrites = -0; }], ["false readonly", p => { p.readOnly = false; }],
  ["too many rows", p => { p.items = packet(13).items; }], ["duplicate IDs", p => { p.items.push(p.items[0]); }],
  ["unknown source", p => { p.sourceScope = "public"; }], ["invalid UUID", p => { p.items[0].workId = "not-a-work"; }],
  ["fake approval", p => { p.items[0].recordedState.approval = "approved"; }], ["unknown locale", p => { p.items[0].defaultLocale = "xx"; }],
  ["unbounded title", p => { p.items[0].title.value = "😀".repeat(257); }], ["title controls", p => { p.items[0].title.value = "a\nsecret"; }],
  ["bad status", p => { p.items[0].recordedState.workStatus = "APPROVED"; }], ["invented cursor", p => { p.nextCursor = workId(99); }],
  ["extra title metadata", p => { p.items[0].title.body = "synthetic"; }], ["sparse rows", p => { p.items = Array(1); }]
]) test("Catalog parser rejects " + label, () => { const f = fixture(), p = packet(); change(p); assert.equal(f.parse(p), null); f.dispose(); });
test("Parser preserves a bounded title and not_checked state without claiming semantic approval", () => {
  const f = fixture(), p = packet(); p.items[0].title.value = "😀".repeat(256); p.items[0].title.bounded = true;
  const parsed = f.parse(p); assert(parsed); assert.equal(parsed.items[0].title.value, p.items[0].title.value);
  assert.equal(parsed.items[0].recordedState.approval, "not_checked"); assert(Object.isFrozen(parsed.items)); f.dispose();
});
test("Getter title values are rejected without being invoked", () => {
  const f = fixture(), p = packet(); let invoked = 0; Object.defineProperty(p.items[0].title, "value", { enumerable: true, get() { ++invoked; throw Error(); } });
  assert.equal(f.parse(p), null); assert.equal(invoked, 0); f.dispose();
});
test("Empty page has no selectable work", async () => { const f = fixture({ send: async () => response(packet(0)) });
  assert.equal(await f.controller.load(), true); assert.equal(f.latest().phase, "empty"); assert.equal(f.controller.choose(workId(1)), false); f.dispose(); });
test("Missing authentication never calls fetch", async () => { const f = fixture({ authenticated: false });
  assert.equal(f.latest().phase, "unauthenticated"); assert.equal(await f.controller.load(), false); assert.equal(f.calls.length, 0); f.dispose(); });
test("Unchanged unauthenticated polling does not repeatedly reset the reading screen", () => {
  const f = fixture({ authenticated: false }), before = f.states.length;
  for (let i = 0; i < 10; ++i) f.controller.sync();
  assert.equal(f.states.length, before); assert.equal(f.calls.length, 0); f.dispose();
});
test("Invalid scope locale fails closed", () => {
  const f = fixture(); f.locale("invalid"); f.controller.sync();
  assert.equal(f.controller.selection(), null); assert.equal(f.latest().phase, "unauthenticated"); f.dispose();
});
test("A throwing scope callback is caught without a fetch or stale selection", () => {
  const f = fixture(); let reads = 0;
  const callbackController = vm.runInNewContext(source + ";window.LuminaCreatorApprovedReadingCatalog", {
    window: {}, AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout
  }).create({ transport: { identity() { ++reads; throw new Error("synthetic internal exception"); }, isCurrent() { throw new Error(); } }, locale: () => "ko" });
  assert.doesNotThrow(() => callbackController.sync()); assert.equal(callbackController.selection(), null);
  assert(reads > 0); callbackController.dispose(); assert.equal(f.calls.length, 0); f.dispose();
});
test("Locale exceptions and forged epoch values cannot create a selected scope", () => {
  const exported = vm.runInNewContext(source + ";window.LuminaCreatorApprovedReadingCatalog", {
    window: {}, AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout
  });
  for (const epoch of [-1, NaN, 0.5, "0"]) {
    const states = [], controller = exported.create({ transport: { identity: () => ({ ownerId: owner, epoch }), isCurrent: () => true },
      locale: () => "ko", onChange: state => states.push(state) });
    assert.equal(states.at(-1).phase, "unauthenticated"); assert.equal(controller.selection(), null); controller.dispose();
  }
  const controller = exported.create({ transport: { identity: () => ({ ownerId: owner, epoch: 0 }), isCurrent: () => true },
    locale: () => { throw new Error("synthetic locale exception"); } });
  assert.equal(controller.selection(), null); controller.dispose();
});
test("Concurrent clicks do not dispatch duplicate catalog requests", async () => {
  const wait = deferred(), f = fixture({ send: () => wait.promise }); const first = f.controller.load();
  assert.equal(await f.controller.load(), false); assert.equal(f.calls.length, 1); wait.resolve(response(packet())); assert.equal(await first, true); f.dispose();
});
test("Owner A-B-A invalidates a waiting response and cannot restore selected work", async () => {
  const wait = deferred(), f = fixture({ send: () => wait.promise }); const pending = f.controller.load();
  f.auth({ accessToken: "synthetic.B", user: { id: "22222222-2222-4222-8222-222222222222" } });
  f.auth({ accessToken: "synthetic.token", user: { id: owner } }); f.controller.sync(); wait.resolve(response(packet()));
  assert.equal(await pending, false); assert.equal(f.controller.selection(), null); assert.equal(f.controller.choose(workId(1)), false); f.dispose();
});
test("Locale change clears selected work and never triggers automatic GET", async () => {
  const f = fixture(); await f.controller.load(); f.controller.choose(workId(1)); const selection = f.controller.selection();
  f.locale("en"); f.controller.sync(); assert.equal(f.controller.selection(), null); assert.equal(f.controller.isSelectionCurrent(selection), false); assert.equal(f.calls.length, 1); f.dispose();
});
test("Only returned next cursor can be used and old selection is cleared", async () => {
  let n = 0; const f = fixture({ send: async () => response(++n === 1 ? packet(12, 1, true) : packet(1, 20)) });
  await f.controller.load(); f.controller.choose(workId(1)); assert.equal(await f.controller.load(workId(999)), false);
  assert.equal(await f.controller.load(workId(12)), true); assert.equal(f.controller.selection(), null);
  assert(f.calls[1].url.endsWith("&cursor=" + workId(12))); assert.equal(f.controller.choose(workId(20)), true); f.dispose();
});
test("Cross-page duplicate IDs fail closed instead of implying a whole-list snapshot", async () => {
  let n = 0; const f = fixture({ send: async () => response(++n === 1 ? packet(12, 1, true) : packet()) });
  await f.controller.load(); assert.equal(await f.controller.load(workId(12)), false); assert.equal(f.latest().phase, "unavailable"); assert.equal(f.controller.selection(), null); f.dispose();
});
for (const [label, headers] of [["missing private", { "Cache-Control": "no-store" }], ["missing no-store", { "Cache-Control": "private" }],
  ["public cache", { "Cache-Control": "private, no-store, public" }], ["missing auth vary", { Vary: "Origin" }],
  ["wrong content type", { "Content-Type": "text/plain" }], ["oversize header", { "Content-Length": "8193" }]]) {
  test("Read rejects " + label, async () => { const f = fixture({ send: async () => response(packet(), headers) });
    assert.equal(await f.controller.load(), false); assert.equal(f.latest().phase, "unavailable"); assert.equal(f.controller.selection(), null); f.dispose(); });
}
test("Oversize streamed body is rejected without adopting data", async () => {
  const f = fixture({ send: async () => response({ ...packet(), junk: "x".repeat(9000) }) });
  assert.equal(await f.controller.load(), false); assert.equal(f.controller.selection(), null); f.dispose();
});
test("401 is not an auth refresh, retry, logout or storage write", async () => {
  const f = fixture({ send: async () => response({ secret: "synthetic" }, {}, 401) });
  assert.equal(await f.controller.load(), false); assert.equal(f.latest().phase, "unauthenticated"); assert.equal(f.calls.length, 1); assert.equal(f.writes.length, 0); f.dispose();
});
test("Deadline bounds a provider that ignores abort", async () => {
  const f = fixture({ send: () => new Promise(() => {}), deadlineMs: 10 });
  assert.equal(await f.controller.load(), false); assert.equal(f.latest().phase, "timeout"); assert.equal(f.calls.length, 1); assert.equal(f.controller.selection(), null); f.dispose();
});
test("Deadline also bounds a body that never settles", async () => {
  const f = fixture({ deadlineMs: 10, send: async () => new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", Vary: "Authorization" } }) });
  assert.equal(await f.controller.load(), false); assert.equal(f.latest().phase, "timeout"); f.dispose();
});
test("Disposed readers never adopt late data or start again", async () => {
  const wait = deferred(), f = fixture({ send: () => wait.promise }); const pending = f.controller.load();
  f.controller.dispose(); wait.resolve(response(packet())); assert.equal(await pending, false); assert.equal(await f.controller.load(), false); assert.equal(f.controller.selection(), null); f.dispose();
});
test("Entry only renders titles through text nodes and never invents handoff validation", () => {
  const entry = readFileSync(new URL("../pages/creator-approved-reading-entry.js", import.meta.url), "utf8");
  assert(entry.includes("const standalone = window.opener === null;")); assert(entry.includes("catalogController.isSelectionCurrent(before)"));
  assert(entry.includes("option.textContent = item.title.value")); assert(!/innerHTML|document\.write|setItem\(|refreshToken|bootstrap/.test(entry));
  assert(entry.includes("!await receiver.validate(options.signal) || receiver.snapshot() !== before"));
});
