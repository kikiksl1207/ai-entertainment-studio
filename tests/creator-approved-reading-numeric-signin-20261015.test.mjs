import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TextDecoder, TextEncoder } from "node:util";
import vm from "node:vm";
import { decodePinnedReadingSource } from "./support/owner-reading-source-pin-20261015.mjs";

// Author UNRUN: four new registrations; parent owns first focused execution.
// Reuses the existing memory/DOM mount pattern, not its autorunning test module.
const SOURCE_ROOT_ENV = "LUMINA_READING_SECTION_AUTH_SOURCE_ROOT";
const PINS = [
  ["creator-studio/approved-reading/index.html", "316fa2fabeaa1a67c8ed06c9f00c7331f7eb67fc", "f658cdf4966cbd7bb30ae0a5b0f10f4245b3cb826e82a61f0bd9e635c4ce7098"],
  ["pages/creator-approved-readonly-transport.js", "580c990aaf88623aa18d27b7f8c00c106c753f0f", "d2e052cffc269e53549c81b9a50b0f5b34075bc93f0f6d70d005ee29d63afc33"],
  ["pages/creator-approved-reading-handoff.js", "3c89000c313c43dbf4a78bac97d63bf769b43e11", "68d1dedcedbf3ae7b259e29924836a45a1703954f0f2fe825c924250dfe9f067"],
  ["pages/creator-approved-reading-catalog.js", "fc8d009cd7e546df0c253d4c9ca080a10c2983e4", "69da822d55237f040e9b324c6732d7a2e7038ea3dcc3dd45372bec398bd2fa9f"],
  ["pages/creator-approved-reading-entry.js", "3d4cef2f15abc5e8f6f74f3de27d13f6553853ce", "e8e05992f82a86b15365bd6ae1259d0ab8f3781aa6424044dcdd0665cc885848"],
  ["pages/creator-approved-section-bytes.js", "19762358292026ef27d33f59133d8bb573edd2af", "72d2caf3d363979e7662f717ae19abf2d851750a24185874352e1a3225bfc9da"],
];
function pinnedSources() {
  const root = Object.hasOwn(process.env, SOURCE_ROOT_ENV)
    ? process.env[SOURCE_ROOT_ENV] : fileURLToPath(new URL("../", import.meta.url));
  assert(typeof root === "string" && root.length > 0 && root.length <= 4096 && !root.includes("\0") && isAbsolute(root),
    "Source root must be a bounded absolute path");
  return PINS.map(([name, blob, sha256]) => {
    const path = resolve(root, name), stat = statSync(path);
    assert(stat.isFile() && stat.size > 0 && stat.size <= 131072, "Bounded regular reader source required");
    const raw = readFileSync(path); assert.equal(raw.byteLength, stat.size, "Source changed during selection");
    return decodePinnedReadingSource(raw, blob, sha256);
  });
}
const [HTML, ...SOURCES] = pinnedSources();
const OPTIONS = { timeout: 3000 }, AUTH_KEY = "lumina_auth", AUTH_EVENT = "creator:approved-section-auth-state";
const OWNER_A = "00000000-0000-4000-8000-000000002401", OWNER_B = "00000000-0000-4000-8000-000000002402";
const WORK_A = "00000000-0000-4000-8000-000000002403", WORK_B = "00000000-0000-4000-8000-000000002404";
const TOKEN_A = "synthetic.numeric.signin.a", TOKEN_B = "synthetic.numeric.signin.b";
const CATALOG_PATH = "/api/v1/me/creator-studio/approved-reading-catalog?locale=ko&limit=12";
const SECTION_PATH = "/api/v1/me/creator-studio/stories/" + WORK_A + "/generation-profile/approved-section-bytes?measurement=json-utf8-v1";
const memoryAuth = (owner, token) => ({ access_token: token, viewer: { userId: owner } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function flush() { for (let index = 0; index < 32; ++index) await Promise.resolve(); }

function clock() {
  let sequence = 0;
  const timers = new Map(), watchers = new Map();
  return {
    setTimeout(fn, delay) { assert.equal(delay, 30000); const id = ++sequence; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, delay) { assert.equal(delay, 1000); const id = ++sequence; watchers.set(id, fn); return id; },
    clearInterval(id) { watchers.delete(id); },
    pulse() { assert.equal(watchers.size, 1); for (const fn of [...watchers.values()]) fn(); },
    pending: () => timers.size, watching: () => watchers.size,
  };
}

function catalogPacket() {
  return { contract: "story-owner-approved-reading-catalog-v1", sourceScope: "owner_work_records_only",
    readOnly: true, providerCalls: 0, operatingWrites: 0, items: [WORK_A, WORK_B].map(workId => ({ workId,
      title: { value: "Synthetic catalog work", locale: "ko", fallback: false, bounded: false }, defaultLocale: "ko",
      recordedState: { workStatus: "draft", approval: "not_checked" } })), nextCursor: null };
}
function response(value, status = 200) {
  const bytes = new TextEncoder().encode(JSON.stringify(value)); assert(bytes.byteLength <= 8192);
  const headers = new Map([["content-type", "application/json; charset=utf-8"], ["cache-control", "private, no-store"],
    ["vary", "Authorization"], ["content-length", String(bytes.byteLength)]]);
  const stats = { canceled: 0, readers: 0, reads: 0 }, cancel = () => { ++stats.canceled; return Promise.resolve(); };
  return { status, redirected: false, stats, headers: { get: key => headers.get(key.toLowerCase()) ?? null },
    json() { assert.fail("No unbounded JSON fallback"); }, text() { assert.fail("No unbounded text fallback"); },
    body: { cancel, getReader() {
      assert.equal(++stats.readers, 1); let sent = false;
      return { read() { assert(++stats.reads <= 2); if (sent) return Promise.resolve({ done: true });
        sent = true; return Promise.resolve({ done: false, value: bytes }); }, cancel, releaseLock() {} };
    } } };
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn, options) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push({ fn, once: !!options?.once }); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(item => item.fn !== fn)); },
    listenerCount: type => (listeners.get(type) || []).length,
    dispatchEvent(event) {
      let result;
      for (const listener of [...(listeners.get(event.type) || [])]) {
        if (listener.once) this.removeEventListener(event.type, listener.fn); result = listener.fn(event);
      }
      return result;
    },
  };
}

function readerDom(forbidden, omitLogin) {
  function element(tag) {
    const attributes = new Map(); let text = "";
    return { ...eventTarget(), tagName: tag.toUpperCase(), id: "", className: "", value: "", hidden: false, disabled: false,
      dataset: {}, children: [], parentNode: null,
      get textContent() { return text + this.children.map(child => child.textContent).join(""); },
      set textContent(value) { this.replaceChildren(); text = String(value); },
      get isConnected() { return this === root || !!this.parentNode?.isConnected; },
      get classList() { return { contains: name => this.className.split(/\s+/).includes(name) }; },
      getAttribute: key => attributes.get(key) ?? null, setAttribute(key, value) { attributes.set(key, String(value)); },
      set innerHTML(value) { forbidden("HTML insertion")(value); },
      contains(node) { for (let item = node; item; item = item.parentNode) if (item === this) return true; return false; },
      append(...nodes) { text = ""; for (const child of nodes) { child.parentNode = this; this.children.push(child); } },
      appendChild(child) { this.append(child); return child; },
      replaceChildren(...nodes) { text = ""; for (const child of this.children) child.parentNode = null; this.children = []; this.append(...nodes); },
      closest() { return null; },
      emit(type) { const event = { type, target: this, isTrusted: false }; document.dispatchEvent(event); return this.dispatchEvent(event); },
    };
  }
  const root = element("html"), body = element("body"), nodes = new Map(); root.lang = "ko"; root.append(body);
  for (const match of HTML.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    if (omitLogin && match[3] === "readingCatalogLogin") continue;
    const node = element(match[1]); node.id = match[3]; assert.equal(nodes.has(node.id), false);
    for (const attribute of match[2].matchAll(/([a-z][a-z0-9-]*)="([^"]*)"/g)) node.setAttribute(attribute[1], attribute[2]);
    node.className = node.getAttribute("class") || ""; node.value = node.getAttribute("value") || "";
    node.hidden = /\shidden(?:\s|$)/.test(match[2]); node.disabled = /\sdisabled(?:\s|$)/.test(match[2]); nodes.set(node.id, node);
  }
  const shell = nodes.get("studioShell"), manuscript = nodes.get("writer-manuscript"), catalog = nodes.get("readingCatalog");
  assert(shell && manuscript && catalog && nodes.get("writerApprovedSectionBytes"));
  body.append(shell); shell.append(manuscript); manuscript.append(catalog);
  for (const [id, node] of nodes) {
    if (["studioShell", "writer-manuscript", "readingCatalog"].includes(id)) continue;
    (id.startsWith("readingCatalog") ? catalog : manuscript).append(node);
  }
  nodes.get("readingLocale").value = "ko";
  const document = { ...eventTarget(), body, documentElement: root, readyState: "complete", visibilityState: "visible", title: "",
    createElement: element, getElementById(id) {
      function find(node) { if (node.id === id) return node; for (const child of node.children) { const found = find(child); if (found) return found; } return null; }
      return find(root);
    } };
  return document;
}

function fixture(t, sectionAnswer, { omitLogin = false } = {}) {
  const time = clock(), calls = [], bridgeCalls = [], catalogStates = [], writes = [], effects = [], reads = [], events = [];
  const plan = [{ kind: "catalog", path: CATALOG_PATH, answer: response(catalogPacket()) }, { kind: "section", path: SECTION_PATH, answer: sectionAnswer }];
  const memory = new Map([[AUTH_KEY, JSON.stringify(memoryAuth(OWNER_A, TOKEN_A))], ["synthetic_draft", "ORIGINAL_DRAFT"]]);
  let expectedOwner = OWNER_A, canonicalToken = TOKEN_A, creates = 0, hidden = false;
  const forbidden = name => () => { effects.push(name); throw new Error("Forbidden synthetic side effect: " + name); };
  const document = readerDom(forbidden, omitLogin), target = eventTarget();
  const window = { ...target, opener: null, crypto: { randomUUID: () => "00000000-0000-4000-8000-000000002405" },
    location: Object.freeze({ origin: "https://synthetic.invalid", reload: forbidden("reload"), assign: forbidden("navigate"), replace: forbidden("navigate") }),
    open: forbidden("open"), refreshToken: forbidden("refresh"), logout: forbidden("logout"), signIn: forbidden("sign-in"),
    localStorage: { getItem(key) { reads.push(key); return memory.get(key) ?? null; },
      setItem() { writes.push("set"); forbidden("storage write")(); }, removeItem() { writes.push("remove"); forbidden("storage remove")(); },
      clear() { writes.push("clear"); forbidden("storage clear")(); } },
    dispatchEvent(event) { events.push(event.type); return target.dispatchEvent(event); },
    fetch(url, options) {
      const step = plan[calls.length]; assert(step, "No automatic or extra native read");
      assert.equal(url === "https://api.lumina-stage.com" + step.path, true, "Only the exact planned free GET route");
      assert.equal(options.method, "GET"); assert.equal(Object.hasOwn(options, "body"), false);
      assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
      assert.equal(options.referrerPolicy, "no-referrer");
      assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "Authorization", "Cache-Control"]);
      assert.equal(options.headers.Accept, "application/json"); assert.equal(options.headers["Cache-Control"], "no-store");
      assert.equal(options.headers.Authorization === "Bearer " + TOKEN_A, true, "Canonical synthetic credential passthrough");
      assert.equal(canonicalToken === TOKEN_A, true, "No request after synthetic credential replacement");
      calls.push({ kind: step.kind, signal: options.signal }); return step.answer;
    },
  };
  const context = vm.createContext({ window, document, location: window.location, AbortController, Event, TextEncoder, TextDecoder, Uint8Array,
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout, setInterval: time.setInterval, clearInterval: time.clearInterval });
  const evaluate = index => vm.runInContext(SOURCES[index], context, { filename: PINS[index + 1][0], timeout: 1000 });
  evaluate(0); evaluate(1); evaluate(2);
  const actualCatalog = window.LuminaCreatorApprovedReadingCatalog;
  window.LuminaCreatorApprovedReadingCatalog = Object.freeze({ ...actualCatalog, create(options) {
    ++creates; return actualCatalog.create({ ...options, onChange(state) { catalogStates.push(state); options.onChange(state); } });
  } });
  evaluate(3);
  const originalBridge = window.LuminaCreatorStudioApi; assert.equal(Object.isFrozen(originalBridge), true);
  // Observe and forward the actual guarded entry bridge, never replace its policy.
  window.LuminaCreatorStudioApi = Object.freeze({ identity: originalBridge.identity, isCurrent: originalBridge.isCurrent,
    fetch(path, options) {
      assert.equal(options.token === canonicalToken, true); assert.equal(options.identity?.ownerId === expectedOwner, true);
      assert.equal(originalBridge.isCurrent(options.identity), true); assert.equal(options._retried, true);
      bridgeCalls.push("section"); return originalBridge.fetch(path, options);
    } });
  document.readyState = "loading"; evaluate(4);
  const controller = window.LuminaCreatorApprovedSectionBytes.mount(document.getElementById("writerApprovedSectionBytes"));
  document.readyState = "complete"; assert(controller); assert.equal(creates, 1); assert.equal(calls.length, 0);
  const node = id => { const value = document.getElementById(id); assert(value, "Actual mounted node required"); return value; };
  function hide(persisted = false) { if (!hidden) { hidden = true; window.dispatchEvent({ type: "pagehide", persisted }); } }
  t.after(async () => {
    hide(); await flush(); assert.equal(time.pending(), 0); assert.equal(time.watching(), 0);
    assert.equal(writes.length, 0); assert.equal(effects.length, 0); assert(reads.every(key => key === AUTH_KEY));
    assert.equal(memory.get("synthetic_draft"), "ORIGINAL_DRAFT");
    assert.equal(calls.length, 2); assert.deepEqual(calls.map(call => call.kind), ["catalog", "section"]); assert.equal(bridgeCalls.length, 1);
    assert.equal(events.includes("lumina:auth-expired"), false);
  });
  return { window, document, controller, node, calls, time, hide,
    marker: () => node("writerApprovedSectionBytes").dataset.readAuthRejected,
    markerEvents: () => events.filter(type => type === AUTH_EVENT).length,
    scope: () => window.LuminaCreatorApprovedReadingScope.snapshot(), current: scope => window.LuminaCreatorApprovedReadingScope.isCurrent(scope),
    latestCatalog: () => catalogStates.at(-1), rawAuth: () => memory.get(AUTH_KEY),
    emit(type) { window.dispatchEvent({ type }); },
    replaceAuth() { expectedOwner = OWNER_B; canonicalToken = TOKEN_B; memory.set(AUTH_KEY, JSON.stringify(memoryAuth(OWNER_B, TOKEN_B))); },
    loadCatalog() { assert.equal(node("readingCatalogLoad").disabled, false); return node("readingCatalogLoad").emit("click"); },
    choose(work) { assert.equal(node("readingCatalogWork").disabled, false); node("readingCatalogWork").value = work; return node("readingCatalogWork").emit("change"); },
    changeLocale() { node("readingLocale").value = "en"; return node("readingLocale").emit("change"); },
    loadSection() { assert.equal(node("writerApprovedSectionBytesLoad").disabled, false); return node("writerApprovedSectionBytesLoad").emit("click"); },
  };
}

function linkState(f, visible) {
  const link = f.node("readingCatalogLogin");
  assert.equal(link.tagName, "A"); assert.equal(link.hidden, !visible); assert.equal(link.listenerCount("click"), 0);
  assert.equal(link.getAttribute("href"), "/#login"); assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener noreferrer");
  const url = new URL(link.getAttribute("href"), "https://synthetic.invalid");
  assert.equal(url.pathname, "/"); assert.equal(url.search, ""); assert.equal(url.hash, "#login");
  assert.equal([TOKEN_A, TOKEN_B, OWNER_A, OWNER_B, WORK_A, WORK_B].some(value => link.getAttribute("href").includes(value)), false);
}
function noNumericData(f) {
  assert.equal(f.controller.snapshot().data, null);
  assert.equal(f.node("writerApprovedSectionBytesContent").hidden, true); assert.equal(f.node("writerApprovedSectionBytesTable").hidden, true);
  assert.equal(f.node("writerApprovedSectionBytesContent").children.length, 0); assert.equal(f.node("writerApprovedSectionBytesRows").children.length, 0);
}
async function selectKnown(f) {
  assert.equal(await f.loadCatalog(), true); assert.equal(f.latestCatalog().phase, "ready"); assert.equal(f.scope(), null);
  assert.equal(f.choose(WORK_A), true); const scope = f.scope(); assert(scope); assert.equal(f.current(scope), true); return scope;
}

test("numeric sign-in: current section 401 shows only the fixed native link while catalog scope stays ready", OPTIONS, async t => {
  const rejected = response({}, 401), f = fixture(t, rejected), raw = f.rawAuth();
  linkState(f, false); assert.equal(f.marker(), "false"); const count = f.markerEvents(); assert.equal(count, 1);
  const scope = await selectKnown(f), identity = f.window.LuminaCreatorStudioApi.identity();
  assert.equal(await f.loadSection(), false); assert.equal(f.controller.snapshot().phase, "error");
  assert.equal(f.controller.snapshot().messageKey, "unauthenticated"); assert.equal(f.marker(), "true");
  assert.equal(f.markerEvents(), count + 1); linkState(f, true); noNumericData(f);
  assert.equal(f.latestCatalog().phase, "ready"); assert.equal(f.latestCatalog().selected === scope, true);
  assert.equal(f.scope() === scope, true); assert.equal(f.current(scope), true); assert.equal(f.window.LuminaCreatorStudioApi.isCurrent(identity), true);
  assert.equal(f.rawAuth() === raw, true); assert.equal(rejected.stats.canceled, 1); assert.equal(rejected.stats.readers, 0);
  // Inert dispatch checks absence of reader-side click actions; it never follows the native link.
  assert.equal(f.node("readingCatalogLogin").emit("click"), undefined);
  f.emit("focus"); f.time.pulse(); f.controller.syncContext(); await flush();
  linkState(f, true); assert.equal(f.markerEvents(), count + 1); assert.equal(f.calls.length, 2); assert.equal(f.rawAuth() === raw, true);
});

test("numeric sign-in: initial no-work and numeric 503 never advertise numeric authentication rejection", OPTIONS, async t => {
  const unavailable = response({}, 503), f = fixture(t, unavailable), raw = f.rawAuth();
  assert.equal(f.controller.snapshot().messageKey, "noWork"); assert.equal(f.marker(), "false"); linkState(f, false);
  assert.equal(await f.controller.load(), false); assert.equal(f.calls.length, 0);
  assert.equal(await f.loadCatalog(), true); assert.equal(f.scope(), null); linkState(f, false);
  assert.equal(await f.controller.load(), false); assert.equal(f.calls.length, 1);
  assert.equal(f.choose(WORK_A), true); const scope = f.scope(), count = f.markerEvents();
  assert.equal(await f.loadSection(), false); assert.equal(f.controller.snapshot().phase, "error");
  assert.equal(f.controller.snapshot().messageKey, "server"); assert.equal(f.marker(), "false"); assert.equal(f.markerEvents(), count);
  noNumericData(f); linkState(f, false); assert.equal(f.current(scope), true); assert.equal(f.latestCatalog().phase, "ready");
  assert.equal(f.rawAuth() === raw, true); assert.equal(unavailable.stats.readers, 0);
  f.emit("focus"); f.time.pulse(); await flush(); linkState(f, false); assert.equal(f.calls.length, 2);
});

test("numeric sign-in: account work or locale change retires pending scope before its late 401", OPTIONS, async t => {
  for (const change of ["account", "work", "locale"]) {
    const waiting = deferred(), late = response({}, 401), f = fixture(t, waiting.promise);
    const old = await selectKnown(f), pending = f.loadSection(); await flush();
    assert.equal(f.controller.snapshot().phase, "loading"); assert.equal(f.marker(), "false"); linkState(f, false);
    if (change === "account") { f.replaceAuth(); f.emit("lumina:authchange"); }
    else if (change === "work") assert.equal(f.choose(WORK_B), true);
    else f.changeLocale();
    assert.equal(await pending, false); await flush(); assert.equal(f.current(old), false);
    if (change === "work") { assert.equal(f.current(f.scope()), true); assert.equal(f.scope().workId === WORK_B, true); }
    else assert.equal(f.scope(), null);
    assert.equal(f.calls[1].signal.aborted, true); assert.equal(f.marker(), "false"); noNumericData(f); linkState(f, false);
    const ticket = f.controller.snapshot().ticket, count = f.markerEvents();
    waiting.resolve(late); await flush();
    assert.equal(late.stats.canceled, 1); assert.equal(late.stats.readers, 0); assert.equal(f.controller.snapshot().ticket, ticket);
    assert.equal(f.markerEvents(), count); assert.equal(f.marker(), "false"); noNumericData(f); linkState(f, false);
    f.emit("focus"); f.time.pulse(); await flush(); assert.equal(f.calls.length, 2); linkState(f, false);
  }
});

test("numeric sign-in: pagehide cannot resurrect its disposed link and cached DOM may omit the optional anchor", OPTIONS, async t => {
  for (const mode of ["rejected", "pending", "cached"]) {
    const waiting = deferred(), rejected = response({}, 401), omitLogin = mode === "cached";
    const f = fixture(t, mode === "pending" ? waiting.promise : rejected, { omitLogin });
    const scope = await selectKnown(f); let pending;
    if (mode === "pending") { pending = f.loadSection(); await flush(); }
    else { assert.equal(await f.loadSection(), false); assert.equal(f.marker(), "true"); }
    if (omitLogin) assert.equal(f.document.getElementById("readingCatalogLogin"), null);
    else linkState(f, mode === "rejected");
    f.hide(mode === "pending"); if (pending) assert.equal(await pending, false); await flush();
    assert.equal(f.window.getAuth(), null); assert.equal(f.latestCatalog().phase, "unauthenticated");
    assert.equal(f.scope(), null); assert.equal(f.current(scope), false); assert.equal(f.controller.snapshot().messageKey, "unauthenticated");
    assert.equal(f.marker(), "false"); noNumericData(f); assert.equal(f.time.pending(), 0); assert.equal(f.time.watching(), 0);
    assert.equal(f.node("readingCatalogLoad").disabled, true); assert.equal(f.node("readingCatalogWork").disabled, true);
    if (pending) { waiting.resolve(rejected); await flush(); assert.equal(rejected.stats.canceled, 1); assert.equal(rejected.stats.readers, 0); }
    // Notification only: no forged marker, scope, controller state or authentication authority.
    f.emit(AUTH_EVENT); f.emit("focus"); await flush();
    assert.equal(f.latestCatalog().phase, "unauthenticated"); assert.equal(f.marker(), "false"); assert.equal(f.calls.length, 2);
    if (omitLogin) assert.equal(f.document.getElementById("readingCatalogLogin"), null);
    else { linkState(f, false); assert.equal(f.node("readingCatalogLogin").emit("click"), undefined); linkState(f, false); }
  }
});
