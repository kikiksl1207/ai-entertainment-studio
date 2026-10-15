import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TextDecoder, TextEncoder } from "node:util";
import vm from "node:vm";
import { decodePinnedReadingSource } from "./support/owner-reading-source-pin-20261015.mjs";

// Author UNRUN. Shared CLEAN requires an explicit QA snapshot or source capsule.
const SOURCE_ROOT_ENV = "LUMINA_VISIBLE_WORKS_SOURCE_ROOT";
const SHARED_CLEAN = "E:/Codex/LuminaStage/story-completion-20261003";
const PINS = [
  ["creator-studio/approved-reading/index.html", "c3ea1239c1d7fd8c73065ac14542fafcf85c48f0", "da077207f5ebe1ffc2b857b1963a69f51ac658cd835fa688264b752a79c494a5"],
  ["pages/creator-approved-reading-entry.css", "c33455729244c6d321eedddb50afde091be82f6f", "62bb9eb9671e08fe2f85d885c7262c5d3c9b082466ae3ec1c8b892262a268d2f"],
  ["pages/creator-approved-readonly-transport.js", "580c990aaf88623aa18d27b7f8c00c106c753f0f", "d2e052cffc269e53549c81b9a50b0f5b34075bc93f0f6d70d005ee29d63afc33"],
  ["pages/creator-approved-reading-handoff.js", "3c89000c313c43dbf4a78bac97d63bf769b43e11", "68d1dedcedbf3ae7b259e29924836a45a1703954f0f2fe825c924250dfe9f067"],
  ["pages/creator-approved-reading-catalog.js", "71a9d600df2307473e6b1a05d3b1fb1d770cab6d", "69e34934bb77cb38461944062c6732fcdbf8a5406a80f1b5b1e5885e9b704ad5"],
  ["pages/creator-approved-reading-entry.js", "efb15c91c202e08241dafd8cb55827dce10a554a", "c0b4a61accec55e12375ce9c5cf76d90a6f7c7d459738079e4e837694690e144"],
  ["pages/creator-approved-section-bytes.js", "19762358292026ef27d33f59133d8bb573edd2af", "72d2caf3d363979e7662f717ae19abf2d851750a24185874352e1a3225bfc9da"],
  ["pages/creator-body-preview.js", "7b879d10c613ff358f98a34a8562c0afbe727ef9", "04e8e6eebf68be3f382f6d03d1b369a145cb184aa9333a5f13ccea6aba229610"],
  ["pages/creator-approved-reading-body.js", "f32133fc9c4d877eaa66cfda0d5e30c6a503459a", "3670f84937ad2d7527d51f003e6f31082230c74e6955a0ee49cdcf059e8c0977"],
];
let admittedSources;
function sources() {
  if (admittedSources) return admittedSources;
  const chosen = Object.hasOwn(process.env, SOURCE_ROOT_ENV)
    ? process.env[SOURCE_ROOT_ENV] : fileURLToPath(new URL("..", import.meta.url));
  assert(typeof chosen === "string" && chosen.length > 0 && chosen.length <= 4096 && !chosen.includes("\0") && isAbsolute(chosen),
    "A bounded absolute QA source root is required");
  const root = realpathSync(resolve(chosen)), shared = resolve(SHARED_CLEAN);
  const outsideShared = path => { const suffix = relative(shared, path);
    return isAbsolute(suffix) || suffix === ".." || suffix.startsWith(".." + sep); };
  assert(outsideShared(root), "Shared CLEAN product sources are not admitted");
  admittedSources = new Map(PINS.map(([name, blob, sha256]) => {
    const path = realpathSync(resolve(root, name));
    assert(outsideShared(path), "Shared CLEAN source aliases are not admitted");
    const stat = statSync(path); assert(stat.isFile() && stat.size > 0 && stat.size <= 131072, "Bounded reader source required");
    const raw = readFileSync(path); assert.equal(raw.byteLength, stat.size, "Source changed during selection");
    return [name, decodePinnedReadingSource(raw, blob, sha256)];
  }));
  return admittedSources;
}

const OPTIONS = { timeout: 3000 }, AUTH_KEY = "lumina_auth", AUTH_EVENT = "creator:approved-section-auth-state";
const OWNER_A = "00000000-0000-4000-8000-000000003101", OWNER_B = "00000000-0000-4000-8000-000000003102";
const WORKS = [3, 4, 5, 6].map(index => "00000000-0000-4000-8000-" + String(3100 + index).padStart(12, "0"));
const TOKEN_A = "synthetic.visible.works.a", TOKEN_B = "synthetic.visible.works.b";
const TITLE = id => "Synthetic <b>work " + (WORKS.indexOf(id) + 1) + "</b>";
const auth = (owner, token) => JSON.stringify({ access_token: token, viewer: { userId: owner } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function flush() { for (let index = 0; index < 32; ++index) await Promise.resolve(); }
const catalogPath = (locale = "ko", cursor = null) => "/api/v1/me/creator-studio/approved-reading-catalog?locale=" + locale + "&limit=12" +
  (cursor === null ? "" : "&cursor=" + cursor);
function packet(ids = WORKS.slice(0, 2), nextCursor = null) {
  return { contract: "story-owner-approved-reading-catalog-v1", sourceScope: "owner_work_records_only", readOnly: true,
    providerCalls: 0, operatingWrites: 0, items: ids.map(workId => ({ workId,
      title: { value: TITLE(workId), locale: "ko", fallback: false, bounded: false }, defaultLocale: "ko",
      recordedState: { workStatus: "draft", approval: "not_checked" } })), nextCursor };
}
function response(value, status = 200) {
  const bytes = new TextEncoder().encode(JSON.stringify(value)); assert(bytes.byteLength <= 8192);
  const headers = new Map([["content-type", "application/json; charset=utf-8"], ["cache-control", "private, no-store"],
    ["vary", "Authorization"], ["content-length", String(bytes.byteLength)]]);
  const stats = { canceled: 0, readers: 0, reads: 0 }, cancel = () => { ++stats.canceled; return Promise.resolve(); };
  return { status, redirected: false, stats, headers: { get: key => headers.get(key.toLowerCase()) ?? null },
    json() { assert.fail("Unbounded JSON fallback forbidden"); }, text() { assert.fail("Unbounded text fallback forbidden"); },
    body: { cancel, getReader() {
      assert.equal(++stats.readers, 1); let sent = false;
      return { read() { assert(++stats.reads <= 2); if (sent) return Promise.resolve({ done: true });
        sent = true; return Promise.resolve({ done: false, value: bytes }); }, cancel, releaseLock() {} };
    } } };
}
function clock() {
  let sequence = 0; const timers = new Map(), watchers = new Map();
  return {
    setTimeout(fn, delay) { assert.equal(delay, 30000); const id = ++sequence; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, delay) { assert.equal(delay, 1000); const id = ++sequence; watchers.set(id, fn); return id; },
    clearInterval(id) { watchers.delete(id); },
    expire() { assert.equal(timers.size, 1); for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
    pulse() { assert.equal(watchers.size, 1); for (const fn of [...watchers.values()]) fn(); },
    pending: () => timers.size, watching: () => watchers.size,
  };
}
function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn, options) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push({ fn, once: !!options?.once }); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(item => item.fn !== fn)); },
    dispatchEvent(event) {
      let result;
      for (const listener of [...(listeners.get(event.type) || [])]) {
        if (listener.once) this.removeEventListener(event.type, listener.fn); result = listener.fn(event);
      }
      return result;
    },
  };
}
function readerDom(html, forbidden, omitWorks) {
  let document;
  function element(tag) {
    const attributes = new Map(); let text = "";
    return { ...eventTarget(), tagName: tag.toUpperCase(), id: "", className: "", value: "", type: "", hidden: false, disabled: false,
      dataset: {}, children: [], parentNode: null,
      get textContent() { return text + this.children.map(child => child.textContent).join(""); },
      set textContent(value) { this.replaceChildren(); text = String(value); },
      get isConnected() { return this === root || !!this.parentNode?.isConnected; },
      get classList() { return { contains: name => this.className.split(/\s+/).includes(name) }; },
      getAttribute: key => attributes.get(key) ?? null,
      setAttribute(key, value) { attributes.set(key, String(value));
        if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value); },
      set innerHTML(value) { forbidden("HTML insertion")(value); },
      contains(node) { for (let item = node; item; item = item.parentNode) if (item === this) return true; return false; },
      removeChild(child) { assert(this.children.includes(child));
        if (document?.activeElement && child.contains(document.activeElement)) document.activeElement = document.body;
        this.children = this.children.filter(item => item !== child); child.parentNode = null; return child; },
      append(...nodes) { text = ""; for (const child of nodes) { if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this; this.children.push(child); } },
      appendChild(child) { this.append(child); return child; },
      replaceChildren(...nodes) { text = ""; for (const child of [...this.children]) this.removeChild(child); this.append(...nodes); },
      remove() { this.parentNode?.removeChild(this); },
      focus() { if (this.isConnected && !this.disabled) document.activeElement = this; },
      closest() { return null; },
      emit(type) { const event = { type, target: this, isTrusted: false }; document.dispatchEvent(event); return this.dispatchEvent(event); },
    };
  }
  const root = element("html"), body = element("body"), nodes = new Map(); root.lang = "ko"; root.append(body);
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    if (omitWorks && match[3] === "readingCatalogWorks") continue;
    const node = element(match[1]); node.id = match[3]; assert.equal(nodes.has(node.id), false);
    for (const attribute of match[2].matchAll(/([a-z][a-z0-9-]*)="([^"]*)"/g)) node.setAttribute(attribute[1], attribute[2]);
    node.className = node.getAttribute("class") || ""; node.value = node.getAttribute("value") || ""; node.type = node.getAttribute("type") || "";
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
  document = { ...eventTarget(), body, documentElement: root, activeElement: body, readyState: "complete", visibilityState: "visible", title: "",
    createElement: element, getElementById(id) {
      function find(node) { if (node.id === id) return node; for (const child of node.children) { const found = find(child); if (found) return found; } return null; }
      return find(root);
    } };
  return document;
}
function fixture(t, steps, { omitWorks = false } = {}) {
  const source = sources(), time = clock(), calls = [], choices = [], states = [], effects = [], writes = [], reads = [];
  const memory = new Map([[AUTH_KEY, auth(OWNER_A, TOKEN_A)], ["synthetic_draft", "ORIGINAL_DRAFT"]]);
  let canonicalToken = TOKEN_A, hidden = false, creates = 0;
  const forbidden = name => () => { effects.push(name); throw new Error("Forbidden synthetic side effect: " + name); };
  const document = readerDom(source.get(PINS[0][0]), forbidden, omitWorks), target = eventTarget();
  const window = { ...target, opener: null, crypto: { randomUUID: () => "00000000-0000-4000-8000-000000003107" },
    location: Object.freeze({ origin: "https://synthetic.invalid", reload: forbidden("reload"), assign: forbidden("navigate"), replace: forbidden("navigate") }),
    open: forbidden("open"), refreshToken: forbidden("refresh"), logout: forbidden("logout"), signIn: forbidden("sign-in"),
    localStorage: { getItem(key) { reads.push(key); return memory.get(key) ?? null; },
      setItem() { writes.push("set"); forbidden("storage write")(); }, removeItem() { writes.push("remove"); forbidden("storage remove")(); },
      clear() { writes.push("clear"); forbidden("storage clear")(); } },
    fetch(url, options) {
      const step = steps[calls.length]; if (!step) { effects.push("unplanned GET"); assert.fail("No automatic or extra read"); }
      assert.equal(url === "https://api.lumina-stage.com" + (step.path || catalogPath()), true, "Only the exact planned free catalog route");
      assert.equal(options.method, "GET"); assert.equal(Object.hasOwn(options, "body"), false);
      assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
      assert.equal(options.referrerPolicy, "no-referrer");
      assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "Authorization", "Cache-Control"]);
      assert.equal(options.headers.Accept, "application/json"); assert.equal(options.headers["Cache-Control"], "no-store");
      assert.equal(options.headers.Authorization === "Bearer " + canonicalToken, true, "Canonical synthetic credential passthrough");
      calls.push({ signal: options.signal }); return step.answer;
    },
  };
  const context = vm.createContext({ window, document, location: window.location, AbortController, Event, TextEncoder, TextDecoder, Uint8Array,
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout, setInterval: time.setInterval, clearInterval: time.clearInterval });
  const evaluate = name => vm.runInContext(source.get("pages/" + name), context, { filename: name, timeout: 1000 });
  evaluate("creator-approved-readonly-transport.js"); evaluate("creator-approved-reading-handoff.js"); evaluate("creator-approved-reading-catalog.js");
  const actualCatalog = window.LuminaCreatorApprovedReadingCatalog;
  // Observe calls and forward to the real controller without replacing its scope policy.
  window.LuminaCreatorApprovedReadingCatalog = Object.freeze({ ...actualCatalog, create(options) {
    ++creates; const actual = actualCatalog.create({ ...options, onChange(state) { states.push(state); options.onChange(state); } });
    return Object.freeze({ ...actual, choose(workId) { choices.push("choose"); return actual.choose(workId); } });
  } });
  evaluate("creator-approved-reading-entry.js");
  document.readyState = "loading"; evaluate("creator-approved-section-bytes.js");
  const numeric = window.LuminaCreatorApprovedSectionBytes.mount(document.getElementById("writerApprovedSectionBytes"));
  document.readyState = "complete"; assert(numeric); assert.equal(creates, 1); assert.equal(calls.length, 0);
  const node = id => { const value = document.getElementById(id); assert(value, "Actual mounted node required"); return value; };
  function hide() { if (!hidden) { hidden = true; window.dispatchEvent({ type: "pagehide", persisted: false }); } }
  t.after(async () => {
    hide(); await flush(); assert.equal(time.pending(), 0); assert.equal(time.watching(), 0);
    assert.equal(writes.length, 0); assert.equal(effects.length, 0); assert(reads.every(key => key === AUTH_KEY));
    assert.equal(memory.get("synthetic_draft"), "ORIGINAL_DRAFT"); assert.equal(calls.length, steps.length);
  });
  return { window, document, node, calls, time, hide, numeric,
    rows: () => document.getElementById("readingCatalogWorks")?.children || [],
    buttons: () => (document.getElementById("readingCatalogWorks")?.children || []).map(row => row.children[0]),
    button(workId) { const button = this.buttons().find(item => item.dataset.workId === workId); assert(button, "Synthetic loaded button required"); return button; },
    latest: () => states.at(-1), chooseCount: () => choices.length, rawAuth: () => memory.get(AUTH_KEY),
    scope: () => window.LuminaCreatorApprovedReadingScope.snapshot(), current: value => window.LuminaCreatorApprovedReadingScope.isCurrent(value),
    emit(type) { return window.dispatchEvent({ type }); },
    replaceAuth() { canonicalToken = TOKEN_B; memory.set(AUTH_KEY, auth(OWNER_B, TOKEN_B)); },
    load() { assert.equal(node("readingCatalogLoad").disabled, false); return node("readingCatalogLoad").emit("click"); },
    next() { assert.equal(node("readingCatalogNext").disabled, false); return node("readingCatalogNext").emit("click"); },
    select(workId) { assert.equal(node("readingCatalogWork").disabled, false); node("readingCatalogWork").value = workId; return node("readingCatalogWork").emit("change"); },
    locale() { node("readingLocale").value = "en"; return node("readingLocale").emit("change"); },
  };
}
function flatRows(f, ids, selected = null) {
  const list = f.node("readingCatalogWorks"); assert.equal(list.tagName, "UL"); assert(list.classList.contains("reading-catalog-works"));
  assert.equal(list.hidden, false); assert.equal(list.isConnected, true); assert.equal(f.node("readingCatalog").hidden, false);
  assert.equal(f.rows().length, ids.length);
  f.rows().forEach((row, index) => {
    assert.equal(row.tagName, "LI"); assert.equal(row.children.length, 1); const button = row.children[0];
    assert.equal(button.tagName, "BUTTON"); assert.equal(button.type, "button"); assert(button.classList.contains("reading-work-button"));
    assert.equal(button.isConnected, true); assert.equal(button.hidden, false); assert.equal(button.disabled, false);
    assert.equal(button.dataset.workId === ids[index], true); assert.equal(button.textContent === TITLE(ids[index]), true);
    assert.equal(button.children.length, 0); assert.equal(button.getAttribute("aria-pressed"), String(ids[index] === selected));
  });
  assert.equal(f.node("readingCatalogWork").tagName, "SELECT"); assert.equal(f.node("readingCatalogWork").children.length, ids.length + 1);
}
function noOldTitles(f, ids = WORKS.slice(0, 2)) {
  assert.equal(f.rows().length, 0);
  const text = f.node("readingCatalogWork").textContent + f.node("readingWorkTitle").textContent + f.node("readingCatalogWorks").textContent;
  assert.equal(ids.some(id => text.includes(TITLE(id))), false, "No stale synthetic titles remain");
}

test("visible works: only explicit load reveals flat buttons and click selects without another GET", OPTIONS, async t => {
  const source = sources(), f = fixture(t, [{ answer: response(packet()) }]), raw = f.rawAuth();
  assert.match(source.get(PINS[1][0]), /\.reading-catalog-works\s*\{/);
  assert.match(source.get(PINS[1][0]), /\.reading-work-button\s*\{/);
  assert.match(source.get(PINS[0][0]), /creator-approved-reading-entry\.(?:js|css)\?v=20261015-visible-works-v1/);
  assert.equal(f.rows().length, 0); assert.equal(f.calls.length, 0); assert.equal(f.latest().phase, "idle"); assert.equal(f.scope(), null);
  assert.equal(await f.load(), true); assert.equal(f.latest().phase, "ready"); flatRows(f, WORKS.slice(0, 2));
  const oldButton = f.button(WORKS[0]); oldButton.focus(); oldButton.emit("click");
  const scope = f.scope(); assert(scope); assert.equal(scope.ownerId === OWNER_A && scope.workId === WORKS[0], true); assert.equal(f.current(scope), true);
  flatRows(f, WORKS.slice(0, 2), WORKS[0]); assert.equal(f.node("readingCatalogWork").value === WORKS[0], true);
  assert.equal(f.document.activeElement === f.button(WORKS[0]), true); assert.equal(oldButton.isConnected, false);
  assert.equal(f.chooseCount(), 1); assert.equal(f.calls.length, 1); assert.equal(f.numeric.snapshot().data, null); assert.equal(f.rawAuth() === raw, true);
  f.emit("focus"); f.time.pulse(); await flush(); assert.equal(f.calls.length, 1);
});

test("visible works: owner locale reset and disposal retire old rows and late responses before selection", OPTIONS, async t => {
  for (const change of ["owner", "locale", "reset", "dispose"]) {
    const waiting = deferred(), late = response(packet()), f = fixture(t, [{ answer: response(packet()) }, { answer: waiting.promise }]);
    assert.equal(await f.load(), true); f.button(WORKS[0]).emit("click");
    const oldScope = f.scope(), oldButton = f.button(WORKS[0]), count = f.chooseCount();
    const pending = f.load(); await flush(); assert.equal(f.latest().phase, "loading"); noOldTitles(f);
    if (change === "owner") { f.replaceAuth(); f.emit("lumina:authchange"); }
    else if (change === "locale") f.locale();
    else if (change === "reset") f.emit("lumina:auth-expired");
    else f.hide();
    assert.equal(await pending, false); await flush(); noOldTitles(f); assert.equal(f.scope(), null); assert.equal(f.current(oldScope), false);
    assert.equal(oldButton.isConnected, false); oldButton.emit("click"); assert.equal(f.chooseCount(), count); assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].signal.aborted, true); const state = f.latest(); waiting.resolve(late); await flush();
    assert.equal(f.latest() === state, true); noOldTitles(f); assert.equal(late.stats.canceled, 1); assert.equal(late.stats.readers, 0);
    oldButton.emit("click"); assert.equal(f.chooseCount(), count); assert.equal(f.calls.length, 2);
  }
  // No notification: the connected button must sync and recheck before forwarding choose.
  const f = fixture(t, [{ answer: response(packet()) }]); assert.equal(await f.load(), true);
  const button = f.button(WORKS[0]), state = f.latest(); f.replaceAuth();
  assert.equal(button.isConnected, true); assert.equal(f.latest() === state, true); button.emit("click");
  assert.equal(f.latest().phase, "idle"); noOldTitles(f); assert.equal(f.scope(), null); assert.equal(f.chooseCount(), 0); assert.equal(f.calls.length, 1);
});

test("visible works: failed timeout and empty reloads never retain stale titles or retry reads", OPTIONS, async t => {
  for (const mode of ["failed", "auth", "timeout", "empty"]) {
    const waiting = deferred(), late = response(packet());
    const answer = mode === "timeout" ? waiting.promise : response(mode === "empty" ? packet([]) : {}, mode === "failed" ? 503 : mode === "auth" ? 401 : 200);
    const f = fixture(t, [{ answer: response(packet()) }, { answer }]), raw = f.rawAuth();
    assert.equal(await f.load(), true); f.button(WORKS[0]).emit("click"); const old = f.button(WORKS[0]), count = f.chooseCount();
    const pending = f.load(); await flush(); noOldTitles(f); if (mode === "timeout") f.time.expire();
    assert.equal(await pending, mode === "empty"); await flush();
    assert.equal(f.latest().phase, mode === "failed" ? "unavailable" : mode === "auth" ? "auth_rejected" : mode);
    noOldTitles(f); assert.equal(f.scope(), null); assert.equal(f.node("readingCatalogWorks").hidden, true);
    old.emit("click"); assert.equal(f.chooseCount(), count); assert.equal(f.calls.length, 2); assert.equal(f.rawAuth() === raw, true);
    if (mode === "timeout") { waiting.resolve(late); await flush(); noOldTitles(f); assert.equal(late.stats.canceled, 1); assert.equal(late.stats.readers, 0); }
    f.emit("focus"); f.time.pulse(); await flush(); assert.equal(f.calls.length, 2);
  }
});

test("visible works: pagination selection and same-state numeric notifications make old buttons inert", OPTIONS, async t => {
  const waiting = deferred(), f = fixture(t, [{ answer: response(packet(WORKS.slice(0, 2), WORKS[1])) },
    { path: catalogPath("ko", WORKS[1]), answer: waiting.promise }]);
  assert.equal(await f.load(), true); flatRows(f, WORKS.slice(0, 2)); f.button(WORKS[0]).emit("click");
  const old = f.button(WORKS[0]), oldRow = old.parentNode, oldScope = f.scope(), count = f.chooseCount();
  const pending = f.next(); await flush(); noOldTitles(f); assert.equal(f.scope(), null); old.emit("click"); assert.equal(f.chooseCount(), count);
  waiting.resolve(response(packet(WORKS.slice(2)))); assert.equal(await pending, true); flatRows(f, WORKS.slice(2));
  assert.equal(f.current(oldScope), false); assert.equal(f.node("readingCatalogNext").disabled, true);
  // Reconnecting a previous-page row cannot make its captured catalog state current.
  f.node("readingCatalogWorks").appendChild(oldRow); assert.equal(old.isConnected, true); old.emit("click");
  assert.equal(f.chooseCount(), count); assert.equal(f.scope(), null); oldRow.remove();
  f.button(WORKS[2]).emit("click"); flatRows(f, WORKS.slice(2), WORKS[2]);
  const selected = f.scope(), held = f.button(WORKS[2]), state = f.latest(), selectedCount = f.chooseCount(); held.focus();
  f.emit(AUTH_EVENT); assert.equal(f.latest() === state, true); assert.equal(f.scope() === selected, true);
  assert.equal(held.isConnected, false); assert.equal(f.document.activeElement === f.button(WORKS[2]), true);
  held.emit("click"); assert.equal(f.chooseCount(), selectedCount); flatRows(f, WORKS.slice(2), WORKS[2]);
  assert.equal(f.select(WORKS[3]), true); flatRows(f, WORKS.slice(2), WORKS[3]); assert.equal(f.calls.length, 2);
  const disposed = f.button(WORKS[3]), disposedCount = f.chooseCount(); f.hide(); f.emit(AUTH_EVENT); disposed.emit("click");
  noOldTitles(f, WORKS); assert.equal(f.scope(), null); assert.equal(f.chooseCount(), disposedCount); assert.equal(f.calls.length, 2);
  // Omit only the optional UL from the pinned current HTML; do not import legacy HTML.
  const legacy = fixture(t, [{ answer: response(packet()) }], { omitWorks: true });
  assert.equal(legacy.document.getElementById("readingCatalogWorks"), null); assert.equal(await legacy.load(), true);
  assert.equal(legacy.select(WORKS[0]), true); assert.equal(legacy.current(legacy.scope()), true); assert.equal(legacy.calls.length, 1);
});
