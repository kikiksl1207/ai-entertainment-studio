import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../pages/creator-approved-reading-catalog.js", import.meta.url), "utf8");
const transportSource = readFileSync(new URL("../pages/creator-approved-readonly-transport.js", import.meta.url), "utf8");
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const emoji = "\uD83D\uDE00";
const path = "/api/v1/me/creator-studio/approved-reading-catalog?locale=ko&limit=12";
const workId = index => "33333333-3333-4333-8333-" + index.toString(16).padStart(12, "0");
const item = (index, title = "Synthetic title " + index) => ({ workId: workId(index),
  title: { value: title, locale: "ko", fallback: false, bounded: false }, defaultLocale: "ko",
  recordedState: { workStatus: "draft", approval: "not_checked" } });
const packet = (count = 1, start = 1, next = false, title) => ({
  contract: "story-owner-approved-reading-catalog-v1", sourceScope: "owner_work_records_only",
  readOnly: true, providerCalls: 0, operatingWrites: 0,
  items: Array.from({ length: count }, (_, index) => item(start + index, title)),
  nextCursor: next ? workId(start + count - 1) : null
});
const headers = { "Content-Type": "application/json", "Cache-Control": "private, no-store", Vary: "Authorization" };
const response = (value, extra = {}, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } });
const bytes = value => Buffer.byteLength(JSON.stringify(value), "utf8");
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function streamed(text, extra = {}) {
  const data = new TextEncoder().encode(text); let offset = 0, cancelled = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (offset === data.length) { controller.close(); return; }
      const end = Math.min(offset + 8192, data.length);
      controller.enqueue(data.slice(offset, end)); offset = end;
    },
    cancel() { ++cancelled; }
  }, { highWaterMark: 0 });
  return { response: new Response(body, { headers: { ...headers, ...extra } }), cancelled: () => cancelled };
}
function fixture({ send = async () => response(packet()), authenticated = true, deadlineMs = 30000 } = {}) {
  let auth = authenticated ? { accessToken: "synthetic.token", user: { id: owner } } : null, locale = "ko";
  const calls = [], writes = [], states = [], listeners = new Map();
  const window = {
    localStorage: { getItem: () => auth ? JSON.stringify(auth) : null,
      setItem: (...args) => writes.push(args), removeItem: (...args) => writes.push(args), clear: () => writes.push("clear") },
    fetch() { throw new Error("Unmocked network forbidden"); },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); }
  };
  const context = vm.createContext({ window, AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout });
  vm.runInContext(transportSource, context); vm.runInContext(source, context);
  const options = { storage: window.localStorage, eventTarget: window,
    fetch: (url, opts) => { calls.push({ url, opts }); return send(url, opts); } };
  const transport = window.LuminaCreatorApprovedReadonlyTransport.createCatalog(options);
  const controller = window.LuminaCreatorApprovedReadingCatalog.create({ transport, locale: () => locale,
    deadlineMs, onChange: state => states.push(state) });
  return { controller, transport, calls, writes, states, parse: window.LuminaCreatorApprovedReadingCatalog.parse,
    defaultTransport: () => window.LuminaCreatorApprovedReadonlyTransport.create(options),
    auth(next) { auth = next; for (const callback of listeners.get("lumina:authchange") || []) callback({ type: "lumina:authchange" }); },
    locale(next) { locale = next; }, latest: () => states.at(-1),
    dispose() { controller.dispose(); transport.dispose(); } };
}

test("byte pages use actual modules without bootstrap, storage writes or an automatic request", t => {
  const f = fixture(); t.after(() => f.dispose());
  assert.equal(f.latest().phase, "idle"); assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0);
});

for (const count of [1, 6, 11, 12]) test("byte pages accept a nonempty " + count + "-row page whose cursor is exactly its last ID", t => {
  const f = fixture(); t.after(() => f.dispose()); const p = packet(count, 1, true);
  const parsed = f.parse(p); assert(parsed); assert.equal(parsed.items.length, count);
  assert.equal(parsed.nextCursor, workId(count)); assert(Object.isFrozen(parsed.items));
});

for (const [codePoints, lengths] of [[120, [11, 1]], [256, [6, 6]]]) {
  test("byte pages collect all 12 full " + codePoints + "-code-point four-byte titles through short-page last-ID cursors", async t => {
    const title = emoji.repeat(codePoints), pages = [packet(lengths[0], 1, true, title), packet(lengths[1], lengths[0] + 1, false, title)];
    assert(bytes(packet(12, 1, false, title)) > 8192);
    assert(bytes(packet(lengths[0] + 1, 1, true, title)) > 8192);
    let sent = 0;
    const f = fixture({ send: async () => { assert(sent < pages.length); return response(pages[sent++]); } });
    t.after(() => f.dispose()); const visited = [], literalSizes = pages.map(bytes);
    assert(Math.min(...literalSizes) > 0); assert(Math.max(...literalSizes) <= 8192);
    assert.equal(await f.controller.load(), true);
    for (let page = 0; page < pages.length; page++) {
      const current = f.latest(); assert.equal(current.phase, "ready");
      assert.equal(current.items.length, lengths[page]); assert.equal(current.nextCursor, pages[page].nextCursor);
      for (const record of current.items) {
        visited.push(record.workId); assert.equal(record.title.value, title);
        assert.equal([...record.title.value].length, codePoints); assert.equal(record.title.bounded, false);
        assert.equal(record.recordedState.approval, "not_checked");
        assert.equal(f.controller.choose(record.workId), true); assert.equal(f.controller.selection().workLabel, title);
      }
      if (current.nextCursor !== null) {
        const selected = f.controller.selection();
        assert.equal(await f.controller.load(workId(99)), false); assert.equal(f.calls.length, page + 1);
        assert.equal(f.controller.selection(), selected);
        assert.equal(await f.controller.load(current.nextCursor), true); assert.equal(f.controller.selection(), null);
        assert.equal(f.controller.isSelectionCurrent(selected), false);
      }
    }
    assert.deepEqual(visited, Array.from({ length: 12 }, (_, index) => workId(index + 1)));
    assert.equal(new Set(visited).size, 12); assert.equal(f.latest().nextCursor, null);
    assert.equal(f.calls.length, 2); assert.equal(f.calls[0].url, "https://api.lumina-stage.com" + path);
    assert.equal(f.calls[1].url, "https://api.lumina-stage.com" + path + "&cursor=" + workId(lengths[0]));
    for (const call of f.calls) {
      assert.equal(call.opts.method, "GET"); assert.equal(call.opts.credentials, "omit"); assert.equal(call.opts.redirect, "error");
      assert.equal(call.opts.cache, "no-store"); assert.equal(call.opts.referrerPolicy, "no-referrer");
      assert.equal(call.opts.headers.Authorization, "Bearer synthetic.token"); assert(!Object.hasOwn(call.opts, "body"));
    }
    assert.equal(f.writes.length, 0);
  });
}

test("byte pages still collect a normal 12-row page plus a final no-cursor work", async t => {
  let sent = 0; const pages = [packet(12, 1, true), packet(1, 13)];
  const f = fixture({ send: async () => response(pages[sent++]) }); t.after(() => f.dispose());
  assert.equal(await f.controller.load(), true); const visited = Array.from(f.latest().items, item => item.workId);
  assert.equal(await f.controller.load(f.latest().nextCursor), true); visited.push(...f.latest().items.map(item => item.workId));
  assert.deepEqual(visited, Array.from({ length: 13 }, (_, index) => workId(index + 1)));
  assert.equal(f.latest().nextCursor, null); assert.equal(await f.controller.load(workId(13)), false); assert.equal(f.calls.length, 2);
});

test("byte pages keep the catalog-only GET transport exact without widening the UI's fixed limit", async t => {
  const f = fixture(), normal = f.defaultTransport(); t.after(() => { normal.dispose(); f.dispose(); });
  const options = adapter => ({ method: "GET", identity: adapter.identity(), token: adapter.getAuth().accessToken,
    _retried: true, cache: "no-store", headers: { Accept: "application/json", "Cache-Control": "no-store" }, signal: new AbortController().signal });
  await assert.rejects(normal.fetch(path, options(normal)), { code: "invalid_request" });
  for (const forbidden of [path.replace("limit=12", "limit=20"), path.replace("limit=12", "limit=1"),
    path + "&owner=" + owner, path + "&limit=12", path + "#fragment", " " + path,
    path + "&cursor=" + workId(15).toUpperCase(), path + "&cursor=" + workId(1) + "&cursor=" + workId(2),
    "https://api.lumina-stage.com" + path, "/api/v1/me/creator-studio", "/api/v1/wallet", "/api/v1/auth/refresh",
    "/api/v1/me/creator-studio/stories/" + workId(1) + "/generation-profile/approved-section-bytes?measurement=json-utf8-v1",
    "/api/v1/me/creator-studio/stories/" + workId(1) + "/body-preview?locale=ko"]) {
    await assert.rejects(f.transport.fetch(forbidden, options(f.transport)), { code: "invalid_request" });
  }
  for (const method of ["HEAD", "POST", "PUT", "DELETE"]) {
    await assert.rejects(f.transport.fetch(path, { ...options(f.transport), method }), { code: "invalid_request" });
  }
  await assert.rejects(f.transport.fetch(path, { ...options(f.transport), body: "synthetic" }), { code: "invalid_request" });
  assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0);
});

for (const [label, change] of [
  ["empty page with cursor", p => { p.items = []; }],
  ["forged last ID", p => { p.nextCursor = workId(99); }],
  ["duplicate work IDs", p => { p.items[1] = p.items[0]; }],
  ["13 rows even without cursor", p => { p.items = packet(13).items; p.nextCursor = null; }]
]) test("byte pages reject " + label + " before adopting or selecting data", async t => {
  const p = packet(2, 1, true); change(p); assert(bytes(p) <= 8192);
  const f = fixture({ send: async () => response(p) }); t.after(() => f.dispose());
  assert.equal(f.parse(p), null); assert.equal(await f.controller.load(), false);
  assert.equal(f.latest().phase, "unavailable"); assert.equal(f.latest().items.length, 0);
  assert.equal(f.controller.selection(), null); assert.equal(f.controller.choose(workId(1)), false);
  assert.equal(f.calls.length, 1); assert.equal(f.writes.length, 0);
});

test("byte pages reject a cross-page duplicate after a valid short-page cursor", async t => {
  let sent = 0; const f = fixture({ send: async () => response(++sent === 1 ? packet(6, 1, true) : packet(1, 6)) });
  t.after(() => f.dispose()); assert.equal(await f.controller.load(), true); assert.equal(f.controller.choose(workId(1)), true);
  assert.equal(await f.controller.load(workId(6)), false); assert.equal(f.latest().phase, "unavailable");
  assert.equal(f.latest().items.length, 0); assert.equal(f.controller.selection(), null); assert.equal(f.calls.length, 2);
});

test("byte pages preserve the existing full 256-code-point display title and bounded flag in the selection", async t => {
  const p = packet(1, 1, false, emoji.repeat(256)); p.items[0].title.bounded = true;
  const f = fixture({ send: async () => response(p) }); t.after(() => f.dispose());
  assert.equal(await f.controller.load(), true); assert.equal(f.latest().items[0].title.value, p.items[0].title.value);
  assert.equal(f.latest().items[0].title.bounded, true); assert.equal(f.controller.choose(workId(1)), true);
  assert.equal(f.controller.selection().workLabel, p.items[0].title.value);
});

test("byte pages accept exactly 8192 literal JSON UTF-8 bytes with a short-page cursor", async t => {
  const p = packet(6, 1, true, emoji.repeat(256)), json = JSON.stringify(p);
  const body = json + " ".repeat(8192 - Buffer.byteLength(json, "utf8")); assert.equal(Buffer.byteLength(body, "utf8"), 8192);
  const f = fixture({ send: async () => streamed(body, { "Content-Length": "8192" }).response }); t.after(() => f.dispose());
  assert.equal(await f.controller.load(), true); assert.equal(f.latest().items.length, 6); assert.equal(f.latest().nextCursor, workId(6));
  assert.equal(f.latest().items[0].title.value, emoji.repeat(256));
});

test("byte pages reject Content-Length 8193 and cancel the unread body", async t => {
  const wire = streamed(JSON.stringify(packet()), { "Content-Length": "8193" });
  const f = fixture({ send: async () => wire.response }); t.after(() => f.dispose());
  assert.equal(await f.controller.load(), false); assert.equal(f.latest().phase, "unavailable");
  assert.equal(f.controller.selection(), null); assert.equal(wire.cancelled(), 1); assert.equal(f.calls.length, 1);
});

test("byte pages reject a streamed 8193rd byte even when it is valid JSON whitespace with no length header", async t => {
  const json = JSON.stringify(packet(6, 1, true, emoji.repeat(256)));
  const text = json + " ".repeat(8193 - Buffer.byteLength(json, "utf8")); assert.equal(Buffer.byteLength(text, "utf8"), 8193);
  const wire = streamed(text), f = fixture({ send: async () => wire.response }); t.after(() => f.dispose());
  assert.equal(await f.controller.load(), false); assert.equal(f.latest().phase, "unavailable");
  assert.equal(f.latest().items.length, 0); assert.equal(f.controller.selection(), null); assert.equal(wire.cancelled(), 1);
});

for (const scope of ["owner A-B-A", "locale"]) test("byte pages invalidate a waiting continuation after " + scope + " change without auto-loading", async t => {
  const wait = deferred(); let sent = 0;
  const f = fixture({ send: () => ++sent === 1 ? response(packet(6, 1, true)) : wait.promise }); t.after(() => f.dispose());
  assert.equal(await f.controller.load(), true); assert.equal(f.controller.choose(workId(1)), true);
  const selected = f.controller.selection(), pending = f.controller.load(workId(6));
  if (scope === "owner A-B-A") {
    f.auth({ accessToken: "synthetic.other", user: { id: other } });
    f.auth({ accessToken: "synthetic.token", user: { id: owner } });
  } else f.locale("en");
  f.controller.sync(); const late = streamed(JSON.stringify(packet(6, 7))); wait.resolve(late.response);
  assert.equal(await pending, false); assert.equal(f.calls[1].opts.signal.aborted, true);
  assert.equal(late.cancelled(), 1); assert.equal(f.controller.isSelectionCurrent(selected), false);
  assert.equal(f.controller.selection(), null); assert.equal(f.latest().items.length, 0);
  assert.equal(f.controller.choose(workId(7)), false); assert.equal(f.calls.length, 2); assert.equal(f.writes.length, 0);
});

test("byte pages disposal cancels a pending request and its late stream without restarting", async t => {
  const wait = deferred(), f = fixture({ send: () => wait.promise }); t.after(() => f.dispose());
  const pending = f.controller.load(); f.controller.dispose();
  const late = streamed(JSON.stringify(packet(6, 1, true))); wait.resolve(late.response);
  assert.equal(await pending, false); assert.equal(f.calls[0].opts.signal.aborted, true); assert.equal(late.cancelled(), 1);
  assert.equal(await f.controller.load(), false); assert.equal(f.controller.selection(), null); assert.equal(f.calls.length, 1);
});

test("byte pages timeout bounds a fetch that ignores cancellation without retry or auth refresh", async t => {
  const f = fixture({ send: () => new Promise(() => {}), deadlineMs: 10 }); t.after(() => f.dispose());
  assert.equal(await f.controller.load(), false); assert.equal(f.latest().phase, "timeout");
  assert.equal(f.calls[0].opts.signal.aborted, true); assert.equal(f.controller.selection(), null);
  assert.equal(f.calls.length, 1); assert.equal(f.writes.length, 0);
});

test("byte pages timeout also cancels a response body that never settles", async t => {
  let cancelled = 0;
  const body = new ReadableStream({ pull: () => new Promise(() => {}), cancel() { ++cancelled; } }, { highWaterMark: 0 });
  const f = fixture({ send: async () => new Response(body, { headers }), deadlineMs: 10 }); t.after(() => f.dispose());
  assert.equal(await f.controller.load(), false); assert.equal(f.latest().phase, "timeout");
  assert.equal(cancelled, 1); assert.equal(f.controller.selection(), null); assert.equal(f.calls.length, 1);
});

test("byte pages 401 adopts no rows and never refreshes, retries, logs out or writes authentication", async t => {
  const f = fixture({ send: async () => response(packet(6, 1, true), {}, 401) }); t.after(() => f.dispose());
  assert.equal(await f.controller.load(), false); assert.equal(f.latest().phase, "auth_rejected");
  assert.equal(f.latest().items.length, 0); assert.equal(f.controller.selection(), null);
  assert.equal(f.calls.length, 1); assert.equal(f.writes.length, 0); assert.equal(f.transport.identity().ownerId, owner);
});

test("byte pages missing authentication never starts a request", async t => {
  const f = fixture({ authenticated: false }); t.after(() => f.dispose());
  assert.equal(await f.controller.load(), false); assert.equal(f.latest().phase, "unauthenticated");
  assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0);
});
