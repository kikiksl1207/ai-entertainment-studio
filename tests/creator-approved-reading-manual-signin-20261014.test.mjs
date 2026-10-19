import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TextDecoder, TextEncoder } from "node:util";
import vm from "node:vm";

// Author UNRUN: actual entry, catalog and transport; bounded memory I/O, no browser or root app.
const HTML_PATH_ENV = "LUMINA_READING_MANUAL_SIGNIN_HTML_PATH";
const HTML_SHA_ENV = "LUMINA_READING_MANUAL_SIGNIN_HTML_SHA256";
const LOGIN_HTML = '<a id="readingCatalogLogin" href="/#login" target="_blank" rel="noopener noreferrer" hidden>\ub85c\uadf8\uc778 (\uc0c8 \ud0ed)</a>';
const STATUS_HTML = '<p id="readingCatalogState" role="status" aria-live="polite"></p>';
const LOCALES = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
const LABELS = {
  ko: "\ub85c\uadf8\uc778 (\uc0c8 \ud0ed)", en: "Sign in (new tab)",
  ja: "\u30ed\u30b0\u30a4\u30f3 (\u65b0\u3057\u3044\u30bf\u30d6)",
  "zh-Hans": "\u767b\u5f55 (\u65b0\u6807\u7b7e\u9875)", "zh-Hant": "\u767b\u5165 (\u65b0\u5206\u9801)",
};
const OPTIONS = { timeout: 3000 };
const OWNER_A = "00000000-0000-4000-8000-000000001201";
const OWNER_B = "00000000-0000-4000-8000-000000001202";
const WORK = "00000000-0000-4000-800a-000000001203";
const TOKEN_A = "synthetic.manual.signin.a", TOKEN_B = "synthetic.manual.signin.b";
const AUTH_KEY = "lumina_auth", TITLE = "PRIVATE_SYNTHETIC_READING_TITLE";
const auth = (owner = OWNER_A, token = TOKEN_A) => ({ accessToken: token, user: { id: owner } });
const sourceNames = ["creator-approved-readonly-transport.js", "creator-approved-reading-catalog.js", "creator-approved-reading-entry.js"];
const sources = sourceNames.map(name => readFileSync(new URL("../pages/" + name, import.meta.url), "utf8"));

function selectedHtml(env = process.env) {
  const hasPath = Object.hasOwn(env, HTML_PATH_ENV), hasSha = Object.hasOwn(env, HTML_SHA_ENV);
  assert.equal(hasPath, hasSha, "HTML override requires both path and raw SHA256; no fallback");
  const path = hasPath ? env[HTML_PATH_ENV] : new URL("../creator-studio/approved-reading/index.html", import.meta.url);
  if (hasPath) {
    assert(path.length > 0 && path.length <= 4096 && !path.includes("\0") && isAbsolute(path), "HTML override must be a bounded absolute path");
    assert.match(env[HTML_SHA_ENV], /^[a-fA-F0-9]{64}$/, "HTML override requires a raw SHA256");
  }
  const stat = statSync(path);
  assert(stat.isFile() && stat.size > 0 && stat.size <= 16384, "Reader HTML must be a bounded regular file");
  const raw = readFileSync(path);
  assert.equal(raw.byteLength, stat.size, "Reader HTML changed during selection");
  const sha256 = createHash("sha256").update(raw).digest("hex");
  if (hasPath) assert.equal(sha256, env[HTML_SHA_ENV].toLowerCase(), "HTML override raw SHA256 mismatch");
  const html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  validateHtml(html);
  return { html, sha256, overridden: hasPath, path };
}

function validateHtml(html) {
  assert.match(html, /^<!doctype html>\s*<html lang="ko">/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow"\s*\/>/);
  assert.match(html, /<meta name="referrer" content="no-referrer"\s*\/>/);
  assert.match(html, /<main id="studioShell">/);
  assert.match(html, /<section id="writer-manuscript" class="is-active">/);
  assert.match(html, /<section id="readingCatalog" class="reading-catalog" aria-labelledby="readingCatalogTitle" hidden>/);
  assert.equal(html.split('id="readingCatalogLogin"').length - 1, 1, "Exactly one optional native link");
  assert.equal(html.split(LOGIN_HTML).length - 1, 1, "Only fixed native anchor attributes and initial Korean label");
  assert.match(html, /<p id="readingCatalogState" role="status" aria-live="polite"><\/p>\s*<p id="readingAuthConnectionState" role="status" aria-live="polite"><\/p>\s*<a id="readingCatalogLogin"/);
  assert.equal(html.split(STATUS_HTML).length - 1, 1);
  assert.doesNotMatch(html, /\bon[a-z]+\s*=|javascript:|<(?:base|iframe|object|embed|form)\b/i);
  const expectedScripts = [
    "creator-approved-readonly-transport.js", "creator-approved-reading-handoff.js", "creator-approved-reading-catalog.js",
    "creator-approved-auth-connection.js", "creator-approved-reading-entry.js", "creator-approved-section-bytes.js", "creator-body-preview.js", "creator-approved-reading-body.js",
  ];
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, expectedScripts.length);
  assert.equal((html.match(/<script\b/gi) || []).length, scripts.length);
  for (const [index, script] of scripts.entries()) {
    assert.equal(script[2], "", "No inline script or root application initialization");
    const attributes = script[1].match(/^\s+defer\s+src="([^\"]+)"\s*$/);
    assert(attributes, "Only deferred reader script sources");
    const url = new URL(attributes[1], "https://synthetic.invalid");
    assert.equal(url.origin, "https://synthetic.invalid");
    assert.equal(url.pathname, "/pages/" + expectedScripts[index]);
    assert.match(attributes[1], /^\/pages\/[a-z-]+\.js\?v=[a-zA-Z0-9.-]+$/);
  }
  for (const [tag, id] of [["h2", "readingCatalogTitle"], ["span", "readingCatalogWorkLabel"], ["select", "readingCatalogWork"],
    ["button", "readingCatalogLoad"], ["button", "readingCatalogNext"], ["select", "readingLocale"],
    ["input", "writerManuscriptWork"], ["input", "writerManuscriptLocale"], ["section", "readingSavedBody"], ["section", "writerApprovedSectionBytes"]]) {
    assert.equal(html.split('id="' + id + '"').length - 1, 1, "Unique reader node: " + id);
    assert.match(html, new RegExp("<" + tag + "\\b[^>]*\\bid=\"" + id + "\""));
  }
  const localeSelect = html.match(/<select id="readingLocale">([\s\S]*?)<\/select>/);
  assert(localeSelect);
  assert.deepEqual([...localeSelect[1].matchAll(/<option value="([^\"]+)">/g)].map(match => match[1]), LOCALES);
  assert.doesNotMatch(html, /(?:src|href)="[^\"]*(?:\/app\.js|\/auth\.js)/i);
}

const HTML = selectedHtml();

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

async function flush() { for (let index = 0; index < 32; ++index) await Promise.resolve(); }

function clock() {
  let now = 0, nextId = 0;
  const timers = new Map(), intervals = new Map();
  return {
    setTimeout(fn, delay) {
      assert(Number.isInteger(delay) && delay >= 1 && delay <= 30000);
      const id = ++nextId; timers.set(id, { at: now + delay, fn }); return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, delay) { assert.equal(delay, 1000); const id = ++nextId; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
    pulse() { assert(intervals.size <= 1); for (const fn of [...intervals.values()]) fn(); },
    advance(milliseconds) {
      assert(Number.isInteger(milliseconds) && milliseconds >= 0 && milliseconds <= 30000);
      const until = now + milliseconds;
      let count = 0;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        assert(++count <= 64, "Synthetic timer dispatch bound");
        const [id, timer] = next; timers.delete(id); now = timer.at; timer.fn();
      }
      now = until;
    },
    pending: () => timers.size, watching: () => intervals.size,
  };
}

function packet({ empty = false } = {}) {
  return { contract: "story-owner-approved-reading-catalog-v1", sourceScope: "owner_work_records_only", readOnly: true,
    providerCalls: 0, operatingWrites: 0, items: empty ? [] : [{ workId: WORK,
      title: { value: TITLE, locale: "ja", fallback: false, bounded: false }, defaultLocale: "ja",
      recordedState: { workStatus: "draft", approval: "not_checked" } }], nextCursor: null };
}

function response(value = packet(), status = 200) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  assert(bytes.byteLength <= 8192);
  const fields = new Map([["content-type", "application/json; charset=utf-8"], ["cache-control", "private, no-store"],
    ["vary", "Authorization"], ["content-length", String(bytes.byteLength)]]);
  const stats = { canceled: 0, readers: 0, reads: 0 };
  return { status, headers: { get: key => fields.get(key.toLowerCase()) ?? null }, stats,
    body: { cancel() { ++stats.canceled; return Promise.resolve(); }, getReader() {
      assert.equal(++stats.readers, 1); let sent = false;
      return { read() { assert(++stats.reads <= 2); if (sent) return Promise.resolve({ done: true });
        sent = true; return Promise.resolve({ done: false, value: bytes }); },
        cancel() { ++stats.canceled; return Promise.resolve(); }, releaseLock() {} };
    } } };
}

function fixture(t, { initialAuth = auth(), locale = "ko", oldHtml = false, opener = null, send = () => response() } = {}) {
  const memory = new Map([["synthetic_studio_draft", "ORIGINAL_PRIVATE_DRAFT"], ["synthetic_studio_tabs", "writer,manuscript"]]);
  if (initialAuth !== null) memory.set(AUTH_KEY, JSON.stringify(initialAuth));
  const elements = new Map(), handlers = new Map(), calls = [], writes = [], reads = [], effects = [], states = [], time = clock();
  const studioBefore = opener === null ? null : JSON.stringify(opener);
  let disposed = false, observer = null, catalogCreates = 0;
  const forbidden = name => (...args) => { effects.push([name, ...args]); throw new Error("Forbidden synthetic side effect: " + name); };
  function element(id, tagName = "DIV") {
    const attributes = new Map([["id", id]]), listeners = new Map();
    return { id, tagName, value: "", textContent: "", disabled: false, hidden: false, children: [], listeners,
      getAttribute: key => attributes.get(key) ?? null, setAttribute(key, value) { attributes.set(key, String(value)); },
      appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; this.value = ""; },
      set innerHTML(value) { forbidden("HTML insertion")(value); },
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
      emit(type) { let result; for (const fn of [...(listeners.get(type) || [])]) result = fn({ type, isTrusted: false }); return result; },
    };
  }
  for (const id of ["writerManuscriptWork", "writerManuscriptLocale", "readingWorkTitle", "readingConnectionState", "readingLocale",
    "readingTitle", "readingStudioLink", "readingLocaleLabel", "readingCatalog", "readingCatalogWork", "readingCatalogLoad",
    "readingCatalogNext", "readingCatalogTitle", "readingCatalogWorkLabel", "readingCatalogState"]) elements.set(id, element(id));
  elements.get("readingLocale").value = locale;
  if (!oldHtml) {
    const link = element("readingCatalogLogin", "A"); link.hidden = true;
    for (const [key, value] of [["href", "/#login"], ["target", "_blank"], ["rel", "noopener noreferrer"], ["hidden", ""]]) link.setAttribute(key, value);
    elements.set(link.id, link); assert.equal(link.hidden, true);
  }
  const window = { opener, crypto: { randomUUID: () => "00000000-0000-4000-8000-000000001204" },
    localStorage: { getItem(key) { reads.push(key); return memory.get(key) ?? null; },
      setItem: (...args) => { writes.push(["set", ...args]); forbidden("storage write")(...args); },
      removeItem: (...args) => { writes.push(["remove", ...args]); forbidden("storage removal")(...args); },
      clear: () => { writes.push(["clear"]); forbidden("storage clear")(); } },
    location: Object.freeze({ reload: forbidden("reload"), assign: forbidden("navigation"), replace: forbidden("navigation") }),
    open: forbidden("window.open"), logout: forbidden("logout"), refreshToken: forbidden("refresh"), signIn: forbidden("sign-in API"),
    addEventListener(type, fn, options) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push({ fn, once: !!options?.once }); },
    removeEventListener(type, fn) { handlers.set(type, (handlers.get(type) || []).filter(handler => handler.fn !== fn)); },
    dispatchEvent(event) {
      for (const handler of [...(handlers.get(event.type) || [])]) {
        handler.fn(event); if (handler.once) window.removeEventListener(event.type, handler.fn);
      }
    },
    fetch(url, options) {
      calls.push({ url, options }); assert(calls.length <= 8, "Synthetic request count bound");
      assert.match(url, /^https:\/\/api\.lumina-stage\.com\/api\/v1\/me\/creator-studio\/approved-reading-catalog\?locale=(?:ko|en|ja|zh-Hans|zh-Hant)&limit=12$/);
      assert.equal(options.method, "GET"); assert.equal(Object.hasOwn(options, "body"), false);
      return send(url, options);
    },
    LuminaCreatorApprovedReadingHandoff: { createReceiver: () => ({ start() {}, snapshot: () => null,
      invalidate() {}, dispose() {}, validate: async () => false }) },
  };
  const document = { readyState: "complete", documentElement: { lang: "ko" }, title: "",
    getElementById: id => elements.get(id) || null, createElement: tag => element("", tag.toUpperCase()) };
  function hide(persisted = false) {
    if (!disposed) { disposed = true; window.dispatchEvent({ type: "pagehide", persisted }); }
  }
  t.after(async () => {
    hide(); await flush(); assert.equal(time.pending(), 0); assert.equal(time.watching(), 0);
    assert.equal(writes.length, 0); assert.equal(effects.length, 0); assert(reads.every(key => key === AUTH_KEY));
    assert.equal(memory.get("synthetic_studio_draft"), "ORIGINAL_PRIVATE_DRAFT");
    assert.equal(memory.get("synthetic_studio_tabs"), "writer,manuscript");
    assert.equal(opener === null ? null : JSON.stringify(opener), studioBefore);
    for (const { url, options } of calls) {
      assert.match(url, /^https:\/\/api\.lumina-stage\.com\/api\/v1\/me\/creator-studio\/approved-reading-catalog\?locale=(?:ko|en|ja|zh-Hans|zh-Hant)&limit=12$/);
      assert.equal(options.method, "GET"); assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store"); assert.equal(options.referrerPolicy, "no-referrer");
      assert.equal(Object.hasOwn(options, "body"), false);
      assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "Authorization", "Cache-Control"]);
    }
  });
  const context = vm.createContext({ window, document, AbortController, TextDecoder, Uint8Array, Event,
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout, setInterval: time.setInterval, clearInterval: time.clearInterval });
  for (let index = 0; index < 2; ++index) vm.runInContext(sources[index], context, { filename: sourceNames[index], timeout: 1000 });
  const actualCatalog = window.LuminaCreatorApprovedReadingCatalog;
  // Observe the actual controller; only the UI matrix below injects observer states, not auth or transport policy.
  window.LuminaCreatorApprovedReadingCatalog = Object.freeze({ ...actualCatalog, create(options) {
    ++catalogCreates; observer = options.onChange;
    return actualCatalog.create({ ...options, deadlineMs: 25, onChange(state) { states.push(state); observer(state); } });
  } });
  vm.runInContext(sources[2], context, { filename: sourceNames[2], timeout: 1000 });
  return { elements, calls, states, writes, effects, window, time, hide,
    latest: () => states.at(-1), snapshot: () => [...memory.entries()], creates: () => catalogCreates,
    emit(type, extra = {}) { window.dispatchEvent({ type, ...extra }); },
    setAuth(value) { if (value === null) memory.delete(AUTH_KEY); else memory.set(AUTH_KEY, JSON.stringify(value)); },
    setLocale(value) { assert(LOCALES.includes(value)); elements.get("readingLocale").value = value; elements.get("readingLocale").emit("change"); },
    load() { assert.equal(elements.get("readingCatalogLoad").disabled, false); return elements.get("readingCatalogLoad").emit("click"); },
    publish(phase) { assert(observer); observer(Object.freeze({ phase, items: [], nextCursor: null, selected: null })); },
    linkEvent() {
      const link = elements.get("readingCatalogLogin"); assert(link); assert.equal(link.listeners.size, 0);
      // Dispatch only to the inert element: no native navigation, root app, popup, or production login.
      assert.equal(link.emit("click"), undefined); assert.equal((handlers.get("click") || []).length, 0);
    },
  };
}

function linkState(f, visible, locale = f.elements.get("readingLocale").value) {
  const link = f.elements.get("readingCatalogLogin"); assert(link);
  assert.equal(link.tagName, "A"); assert.equal(link.hidden, !visible); assert.equal(link.textContent, LABELS[locale]);
  assert.equal(link.getAttribute("href"), "/#login"); assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener noreferrer"); assert.equal(link.listeners.size, 0);
  const url = new URL(link.getAttribute("href"), "https://synthetic.invalid");
  assert.equal(url.pathname, "/"); assert.equal(url.search, ""); assert.equal(url.hash, "#login");
  for (const privateValue of [TOKEN_A, TOKEN_B, OWNER_A, OWNER_B, WORK, TITLE, "sourceLocale", "return", "token"]) {
    assert.equal(link.getAttribute("href").includes(privateValue), false);
  }
}

test("manual sign-in: selected product HTML is a pinned ordinary new-tab anchor, without app/auth scripts", OPTIONS, () => {
  validateHtml(HTML.html); assert.match(HTML.sha256, /^[a-f0-9]{64}$/);
  assert.equal(HTML.overridden, Object.hasOwn(process.env, HTML_PATH_ENV));
  const path = HTML.overridden ? HTML.path : fileURLToPath(HTML.path);
  assert.throws(() => selectedHtml({ [HTML_PATH_ENV]: path }), /both path and raw SHA256/);
  assert.throws(() => selectedHtml({ [HTML_SHA_ENV]: HTML.sha256 }), /both path and raw SHA256/);
  assert.throws(() => selectedHtml({ [HTML_PATH_ENV]: "", [HTML_SHA_ENV]: HTML.sha256 }), /bounded absolute path/);
  assert.throws(() => selectedHtml({ [HTML_PATH_ENV]: "index.html", [HTML_SHA_ENV]: HTML.sha256 }), /bounded absolute path/);
  assert.throws(() => selectedHtml({ [HTML_PATH_ENV]: path, [HTML_SHA_ENV]: "" }), /requires a raw SHA256/);
  assert.throws(() => selectedHtml({ [HTML_PATH_ENV]: path, [HTML_SHA_ENV]: "0".repeat(64) }), /raw SHA256 mismatch/);
  for (const altered of [
    HTML.html.replace('href="/#login"', 'href="/#login?token=synthetic"'),
    HTML.html.replace('target="_blank"', 'target="_self"'),
    HTML.html.replace('rel="noopener noreferrer"', 'rel="noreferrer"'),
    HTML.html.replace(LOGIN_HTML, LOGIN_HTML.replace(" hidden>", ">")),
    HTML.html.replace('/pages/creator-approved-reading-entry.js?', '/app.js?'),
    HTML.html.replace("</head>", '<script>window.open("/#login")</script></head>'),
  ]) assert.throws(() => validateHtml(altered), "Changed link/script semantics must fail closed");
});

test("manual sign-in: actual entry shows only the two catalog phases in all five UI locales", OPTIONS, t => {
  const f = fixture(t), before = f.snapshot();
  for (const locale of LOCALES) {
    f.setLocale(locale);
    for (const phase of ["unauthenticated", "idle", "auth_rejected", "loading", "ready", "empty", "stale", "timeout", "unavailable", "unknown"]) {
      f.publish(phase); linkState(f, ["unauthenticated", "auth_rejected"].includes(phase), locale);
      assert.equal(f.elements.get("readingCatalogLoad").disabled, ["loading", "unauthenticated", "auth_rejected"].includes(phase));
    }
  }
  assert.equal(f.calls.length, 0); assert.deepEqual(f.snapshot(), before);
});

test("manual sign-in: missing auth and inert link events never query; changed auth still needs explicit Load in all five locales", OPTIONS, async t => {
  for (const locale of LOCALES) {
    const wait = deferred(), f = fixture(t, { initialAuth: null, locale, send: () => wait.promise });
    linkState(f, true); assert.equal(f.latest().phase, "unauthenticated");
    assert.equal(f.elements.get("readingCatalogLoad").disabled, true);
    const before = f.snapshot(); f.linkEvent(); f.emit("focus"); f.time.pulse(); await flush();
    assert.equal(f.calls.length, 0); assert.deepEqual(f.snapshot(), before);
    f.setAuth(auth()); f.emit("lumina:authchange"); await flush();
    linkState(f, false); assert.equal(f.latest().phase, "idle"); assert.equal(f.calls.length, 0);
    const pending = f.load(); linkState(f, false); assert.equal(f.latest().phase, "loading"); assert.equal(f.calls.length, 1);
    wait.resolve(response()); await pending;
    linkState(f, false); assert.equal(f.latest().phase, "ready"); assert.equal(f.calls.length, 1);
    f.elements.get("readingCatalogWork").value = WORK; f.elements.get("readingCatalogWork").emit("change");
    assert.equal(f.elements.get("writerManuscriptLocale").value, "ja");
    assert.equal(f.elements.get("readingWorkTitle").textContent, TITLE); linkState(f, false);
  }
});

test("manual sign-in: actual 401 keeps cached auth unchanged and Load disabled until new auth, with no retry in all five locales", OPTIONS, async t => {
  for (const locale of LOCALES) {
    let sent = 0;
    const f = fixture(t, { locale, send: () => ++sent === 1 ? response({}, 401) : response() });
    linkState(f, false); const before = f.snapshot(), beforeAuth = f.window.getAuth();
    await f.load(); assert.equal(f.latest().phase, "auth_rejected"); linkState(f, true);
    assert.equal(f.elements.get("readingCatalogLoad").disabled, true);
    f.linkEvent(); f.emit("focus"); f.time.pulse(); f.time.advance(100); await flush();
    assert.equal(f.calls.length, 1); assert.deepEqual(f.snapshot(), before); assert.deepEqual(f.window.getAuth(), beforeAuth);
    f.setAuth(auth(OWNER_A, TOKEN_B)); f.emit("lumina:authchange"); await flush();
    assert.equal(f.latest().phase, "idle"); linkState(f, false); assert.equal(f.calls.length, 1);
    await f.load(); linkState(f, false); assert.equal(f.latest().phase, "ready"); assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].options.headers.Authorization, "Bearer " + TOKEN_B);
  }
});

test("manual sign-in: actual empty, generic failures and timeout hide the link, including ignored late 401", OPTIONS, async t => {
  for (const [name, send, expected] of [
    ["empty", () => response(packet({ empty: true })), "empty"], ["403", () => response({}, 403), "unavailable"],
    ["503", () => response({}, 503), "unavailable"], ["network", () => Promise.reject(new Error("Synthetic failure")), "unavailable"],
    ["invalid", () => response({ wrong: "contract" }), "unavailable"],
  ]) {
    const f = fixture(t, { send }); await f.load(); assert.equal(f.latest().phase, expected, name); linkState(f, false);
    f.emit("focus"); f.time.pulse(); await flush(); assert.equal(f.calls.length, 1);
  }
  const wait = deferred(), f = fixture(t, { send: () => wait.promise }), pending = f.load();
  f.time.advance(25); await pending; assert.equal(f.latest().phase, "timeout"); linkState(f, false);
  const late = response({}, 401); wait.resolve(late); await flush();
  assert.equal(f.latest().phase, "timeout"); linkState(f, false); assert.equal(late.stats.canceled, 1); assert.equal(late.stats.readers, 0);
  assert.equal(f.calls.length, 1);
});

test("manual sign-in: auth events, focus and existing watcher clear selected work and never automatically query", OPTIONS, async t => {
  for (const event of ["lumina:authchange", "lumina:auth-expired", "storage", "focus", "watch"]) {
    const f = fixture(t); await f.load();
    f.elements.get("readingCatalogWork").value = WORK; f.elements.get("readingCatalogWork").emit("change");
    const scope = f.window.LuminaCreatorApprovedReadingScope.snapshot(); assert(scope);
    const sample = () => event === "watch" ? f.time.pulse() : f.emit(event, event === "storage" ? { key: AUTH_KEY } : {});
    f.setAuth(null); sample(); await flush();
    assert.equal(f.latest().phase, "unauthenticated"); linkState(f, true);
    assert.equal(f.window.LuminaCreatorApprovedReadingScope.isCurrent(scope), false);
    assert.equal(f.elements.get("writerManuscriptWork").value, ""); assert.equal(f.calls.length, 1);
    f.setAuth(auth(OWNER_B, TOKEN_B)); sample(); await flush();
    assert.equal(f.latest().phase, "idle"); linkState(f, false); assert.equal(f.calls.length, 1);
    await f.load(); assert.equal(f.latest().phase, "ready"); linkState(f, false); assert.equal(f.calls.length, 2);
  }
});

test("manual sign-in: changed owner aborts pending load and late 401 cannot show the link or auto-query", OPTIONS, async t => {
  const wait = deferred(), f = fixture(t, { send: () => wait.promise }), pending = f.load();
  f.setAuth(auth(OWNER_B, TOKEN_B)); f.emit("lumina:authchange");
  await pending; assert.equal(f.latest().phase, "idle"); linkState(f, false);
  const count = f.states.length, late = response({}, 401); wait.resolve(late); await flush();
  assert.equal(f.states.length, count); assert.equal(f.latest().phase, "idle"); linkState(f, false);
  assert.equal(late.stats.canceled, 1); assert.equal(late.stats.readers, 0); assert.equal(f.calls[0].options.signal.aborted, true);
  assert.equal(f.calls.length, 1);
});

test("manual sign-in: actual entry pagehide once ends hidden after dispose emits unauthenticated, also for BFCache and pending failure", OPTIONS, async t => {
  for (const persisted of [false, true]) {
    for (const phase of ["unauthenticated", "auth_rejected", "loading"]) {
      const wait = deferred(), f = fixture(t, { initialAuth: phase === "unauthenticated" ? null : auth(),
        send: () => phase === "auth_rejected" ? response({}, 401) : wait.promise });
      let pending;
      if (phase === "auth_rejected") await f.load(); else if (phase === "loading") pending = f.load();
      assert.equal(f.latest().phase, phase); linkState(f, phase !== "loading");
      f.hide(persisted); if (pending) await pending;
      assert.equal(f.latest().phase, "unauthenticated", "Existing controller disposal notification is unchanged");
      linkState(f, false); assert.equal(f.elements.get("readingCatalogLoad").disabled, true);
      assert.equal(f.elements.get("readingCatalogNext").disabled, true); assert.equal(f.elements.get("readingCatalogWork").disabled, true);
      assert.equal(f.elements.get("writerManuscriptWork").value, ""); assert.equal(f.time.watching(), 0);
      if (pending) {
        const late = response({}, 401); wait.resolve(late); await flush();
        assert.equal(late.stats.canceled, 1); assert.equal(late.stats.readers, 0); linkState(f, false);
      }
      assert.equal(f.calls.length, phase === "unauthenticated" ? 0 : 1);
    }
  }
});

test("manual sign-in: old cached HTML missing only the optional link still supports unauthenticated, rejected, changed auth and dispose", OPTIONS, async t => {
  let sent = 0;
  const f = fixture(t, { oldHtml: true, initialAuth: null, send: () => ++sent === 1 ? response({}, 401) : response() });
  assert.equal(f.elements.get("readingCatalogLogin"), undefined); assert.equal(f.latest().phase, "unauthenticated");
  for (const locale of LOCALES) f.setLocale(locale);
  assert.equal(f.calls.length, 0); f.setAuth(auth()); f.emit("lumina:authchange");
  await f.load(); assert.equal(f.latest().phase, "auth_rejected"); assert.equal(f.elements.get("readingCatalogLoad").disabled, true);
  f.setAuth(auth(OWNER_B, TOKEN_B)); f.emit("lumina:authchange"); assert.equal(f.calls.length, 1);
  await f.load(); assert.equal(f.latest().phase, "ready"); assert.equal(f.calls.length, 2); f.hide(true);
});

test("manual sign-in: existing opener reader keeps catalog and link hidden, without changing original Studio draft or tabs", OPTIONS, t => {
  const opener = Object.freeze({ draft: "ORIGINAL_PRIVATE_DRAFT", tabs: Object.freeze(["writer", "manuscript"]), activeTab: "manuscript" });
  const f = fixture(t, { opener, initialAuth: null });
  assert.equal(f.elements.get("readingCatalog").hidden, true); assert.equal(f.elements.get("readingCatalogLogin").hidden, true);
  assert.equal(f.creates(), 0); assert.equal(f.calls.length, 0);
  for (const locale of LOCALES) { f.setLocale(locale); assert.equal(f.elements.get("readingCatalogLogin").hidden, true); }
  f.emit("lumina:authchange"); f.emit("focus"); f.time.pulse(); assert.equal(f.calls.length, 0); f.hide();
  assert.equal(f.elements.get("readingCatalogLogin").hidden, true);
});
