import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TextDecoder, TextEncoder } from "node:util";
import vm from "node:vm";
import { decodePinnedReadingSource } from "./support/owner-reading-source-pin-20261015.mjs";

// Follow-up Author UNRUN: parent targets only the changed same-owner 401 case.
// Baseline reader pins plus the parent-owned numeric sign-in UI RAW/blob overlay.
const SOURCE_ROOT_ENV = "LUMINA_READING_SECTION_AUTH_SOURCE_ROOT";
const PINS = [
  ["creator-studio/approved-reading/index.html", "af1a65b207150771f8b9494b8730e8802dbcdf2f", "e67f0b1543b4da44c7e96c44fcb610f89afb694ce0a62a286bf91da38fa5a700"],
  ["pages/creator-approved-readonly-transport.js", "46314689c89aa1bfbc404af2bfb5aa4fefc41e72", "dc1b8ae160470c3cd4f3909f07d53638d8d9a8df8598413b39b4f590ffa0b632"],
  ["pages/creator-approved-reading-handoff.js", "3c89000c313c43dbf4a78bac97d63bf769b43e11", "68d1dedcedbf3ae7b259e29924836a45a1703954f0f2fe825c924250dfe9f067"],
  ["pages/creator-approved-reading-catalog.js", "fc8d009cd7e546df0c253d4c9ca080a10c2983e4", "69da822d55237f040e9b324c6732d7a2e7038ea3dcc3dd45372bec398bd2fa9f"],
  ["pages/creator-approved-reading-entry.js", "bf06cbc577d8170221eeaa7dc5030066f1eb6e62", "683e262ca34cf0727c2a0e6e6d3673783eb7e7540d36fb335ae84deadc81d444"],
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
    const raw = readFileSync(path);
    assert.equal(raw.byteLength, stat.size, "Reader source changed during selection");
    return decodePinnedReadingSource(raw, blob, sha256);
  });
}
const [HTML, ...SOURCES] = pinnedSources();
const OPTIONS = { timeout: 3000 };
const OWNER_A = "00000000-0000-4000-8000-000000002301";
const OWNER_B = "00000000-0000-4000-8000-000000002302";
const WORK_A = "00000000-0000-4000-8000-000000002303";
const WORK_B = "00000000-0000-4000-8000-000000002304";
const UNKNOWN_WORK = "00000000-0000-4000-8000-000000002305";
const TOKEN_A = "synthetic.section.catalog.a", TOKEN_B = "synthetic.section.catalog.b";
const AUTH_KEY = "lumina_auth", API_ORIGIN = "https://api.lumina-stage.com";
const CATALOG_PATH = "/api/v1/me/creator-studio/approved-reading-catalog?locale=ko&limit=12";
const sectionPath = work => "/api/v1/me/creator-studio/stories/" + work + "/generation-profile/approved-section-bytes?measurement=json-utf8-v1";
const clone = value => JSON.parse(JSON.stringify(value));
const memoryAuth = (owner, token) => ({ access_token: token, viewer: { userId: owner } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function flush() { for (let index = 0; index < 32; ++index) await Promise.resolve(); }

function clock() {
  let now = 0, sequence = 0;
  const jobs = new Map(), watchers = new Map();
  return {
    setTimeout(fn, delay) {
      assert.equal(delay, 30000, "Actual whole-request deadline is unchanged");
      const id = ++sequence; jobs.set(id, { fn, at: now + delay }); return id;
    },
    clearTimeout(id) { jobs.delete(id); },
    setInterval(fn, delay) { assert.equal(delay, 1000); const id = ++sequence; watchers.set(id, fn); return id; },
    clearInterval(id) { watchers.delete(id); },
    pulse() { assert.equal(watchers.size, 1); for (const fn of [...watchers.values()]) fn(); },
    advance(milliseconds) {
      assert(Number.isInteger(milliseconds) && milliseconds >= 0 && milliseconds <= 30000);
      const until = now + milliseconds; let dispatched = 0;
      for (;;) {
        const next = [...jobs.entries()].filter(([, job]) => job.at <= until)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        assert(++dispatched <= 16, "Synthetic timer bound");
        jobs.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = until;
    },
    pending: () => jobs.size, watching: () => watchers.size,
  };
}

function catalogPacket(work = WORK_A) {
  return { contract: "story-owner-approved-reading-catalog-v1", sourceScope: "owner_work_records_only",
    readOnly: true, providerCalls: 0, operatingWrites: 0, items: [{ workId: work,
      title: { value: "Synthetic catalog work", locale: "ko", fallback: false, bounded: false }, defaultLocale: "ko",
      recordedState: { workStatus: "draft", approval: "not_checked" } }], nextCursor: null };
}

// Same positive numeric fixture/accounting as creator-approved-section-bytes.test.mjs.
function sectionPacket(serverInterpretationBytes = 100) {
  const keys = ["branch_behavior", "canon", "narrative_devices", "scene_scale", "timeline", "visual_cast", "visual_direction", "writing_style"];
  const sections = keys.map((key, index) => ({ key, authorSectionBytes: 100 + index,
    authorValueBytes: 50 + index, approvalEvidenceEntryBytes: 40 + index }));
  const authorObjectFramingBytes = new TextEncoder().encode(JSON.stringify({
    schemaVersion: "creator-generation-profile-v1", kind: "story", sections: [],
  })).byteLength - 2;
  const d = { contract: "story-approved-profile-section-byte-metric-v1", byteCap: 16384,
    wholeCandidateViewBytes: 0, authorDataBytes: sections.reduce((sum, row) => sum + row.authorSectionBytes, 0) + 9 + authorObjectFramingBytes,
    approvalEvidenceBytes: sections.reduce((sum, row) => sum + row.approvalEvidenceEntryBytes, 0) + 9,
    serverInterpretationBytes, approvalPinBytes: 259, framingBytes: 114, sections, sectionsArrayFramingBytes: 9,
    authorObjectFramingBytes, approvalEvidenceArrayFramingBytes: 9, writingStyleSectionBytes: sections[7].authorSectionBytes,
    writingStyleValueBytes: sections[7].authorValueBytes, modelInputFit: "unmeasured", semanticQualityVerified: false,
    dispatchAuthorized: false, providerCalls: 0, operatingWrites: 0 };
  d.wholeCandidateViewBytes = d.authorDataBytes + d.approvalEvidenceBytes + d.serverInterpretationBytes + d.approvalPinBytes + d.framingBytes;
  return { contract: "story-author-approved-section-bytes-v1", sourceScope: "latest_owner_approved_profile_section_bytes_only",
    locale: "ko", manuscriptVersion: 1, analysisVersion: 2, profileVersion: 3, reviewRevision: 4,
    readOnly: true, providerCalls: 0, operatingWrites: 0, dispatchAuthorized: false, semanticQualityVerified: false,
    legalAuthorization: "not_evaluated", paidApproval: "not_evaluated", fixedInputTokenLimit: 32768, fixedOutputTokenLimit: 8192, diagnostic: d };
}

function response(value, status = 200) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  assert(bytes.byteLength <= 8192);
  const headers = new Map([["content-type", "application/json; charset=utf-8"], ["cache-control", "private, no-store"],
    ["vary", "Authorization"], ["content-length", String(bytes.byteLength)]]);
  const stats = { canceled: 0, readers: 0, reads: 0 };
  const cancel = () => { ++stats.canceled; return Promise.resolve(); };
  return { status, redirected: false, stats, headers: { get: key => headers.get(key.toLowerCase()) ?? null },
    json() { assert.fail("No unbounded JSON fallback"); }, text() { assert.fail("No unbounded text fallback"); },
    body: { cancel, getReader() {
      assert.equal(++stats.readers, 1); let sent = false;
      return { read() {
        assert(++stats.reads <= 2, "Synthetic stream bound");
        if (sent) return Promise.resolve({ done: true });
        sent = true; return Promise.resolve({ done: false, value: bytes });
      }, cancel, releaseLock() {} };
    } } };
}
const catalogStep = (work = WORK_A, token = TOKEN_A) => ({ kind: "catalog", path: CATALOG_PATH, token, answer: response(catalogPacket(work)) });
const sectionStep = (answer = response(sectionPacket()), work = WORK_A, token = TOKEN_A) => ({ kind: "section", path: sectionPath(work), token, answer });

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn, options) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ fn, once: !!options?.once });
    },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(item => item.fn !== fn)); },
    dispatchEvent(event) {
      let result;
      for (const listener of [...(listeners.get(event.type) || [])]) {
        if (listener.once) this.removeEventListener(event.type, listener.fn);
        result = listener.fn(event);
      }
      return result;
    },
  };
}

function readerDom(forbidden) {
  function element(tag) {
    const attributes = new Map(); let text = "";
    return { ...eventTarget(), tagName: tag.toUpperCase(), id: "", className: "", value: "", hidden: false, disabled: false,
      dataset: {}, children: [], parentNode: null,
      get textContent() { return text + this.children.map(child => child.textContent).join(""); },
      set textContent(value) { this.replaceChildren(); text = String(value); },
      get isConnected() { return this === root || !!this.parentNode?.isConnected; },
      get classList() { return { contains: name => this.className.split(/\s+/).includes(name) }; },
      getAttribute: key => attributes.get(key) ?? null,
      setAttribute(key, value) { attributes.set(key, String(value)); },
      set innerHTML(value) { forbidden("HTML insertion")(value); },
      contains(node) { for (let item = node; item; item = item.parentNode) if (item === this) return true; return false; },
      append(...nodes) { text = ""; for (const child of nodes) { child.parentNode = this; this.children.push(child); } },
      appendChild(child) { this.append(child); return child; },
      replaceChildren(...nodes) { text = ""; for (const child of this.children) child.parentNode = null; this.children = []; this.append(...nodes); },
      closest() { return null; },
      emit(type) { const event = { type, target: this, isTrusted: false }; document.dispatchEvent(event); return this.dispatchEvent(event); },
    };
  }
  const root = element("html"), body = element("body"); root.lang = "ko"; root.append(body);
  const nodes = new Map();
  for (const match of HTML.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = element(match[1]); node.id = match[3];
    assert.equal(nodes.has(node.id), false, "Unique source HTML node");
    for (const attribute of match[2].matchAll(/([a-z][a-z0-9-]*)="([^"]*)"/g)) node.setAttribute(attribute[1], attribute[2]);
    node.className = node.getAttribute("class") || ""; node.value = node.getAttribute("value") || "";
    node.hidden = /\shidden(?:\s|$)/.test(match[2]); node.disabled = /\sdisabled(?:\s|$)/.test(match[2]); nodes.set(node.id, node);
  }
  const shell = nodes.get("studioShell"), manuscript = nodes.get("writer-manuscript"), catalog = nodes.get("readingCatalog");
  assert(shell && manuscript && catalog && nodes.get("writerApprovedSectionBytes"), "Actual reader ownership hierarchy required");
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

function fixture(t, plan) {
  assert(plan.length >= 2 && plan.length <= 4);
  const time = clock(), calls = [], bridgeCalls = [], catalogStates = [], writes = [], effects = [], reads = [], events = [];
  const memory = new Map([[AUTH_KEY, JSON.stringify(memoryAuth(OWNER_A, TOKEN_A))], ["synthetic_draft", "ORIGINAL_DRAFT"]]);
  let expectedOwner = OWNER_A, canonicalToken = TOKEN_A, creates = 0, hidden = false;
  const forbidden = name => () => { effects.push(name); throw new Error("Forbidden synthetic side effect: " + name); };
  const document = readerDom(forbidden);
  const target = eventTarget();
  const window = { ...target, opener: null, crypto: { randomUUID: () => "00000000-0000-4000-8000-000000002306" },
    location: Object.freeze({ origin: "https://synthetic.invalid", reload: forbidden("reload"), assign: forbidden("navigate"), replace: forbidden("navigate") }),
    open: forbidden("open"), refreshToken: forbidden("refresh"), logout: forbidden("logout"), signIn: forbidden("sign-in"),
    localStorage: { getItem(key) { reads.push(key); return memory.get(key) ?? null; },
      setItem() { writes.push("set"); forbidden("storage write")(); },
      removeItem() { writes.push("remove"); forbidden("storage remove")(); },
      clear() { writes.push("clear"); forbidden("storage clear")(); } },
    dispatchEvent(event) { events.push(event.type); return target.dispatchEvent(event); },
    fetch(url, options) {
      const step = plan[calls.length]; assert(step, "No automatic or extra native read");
      assert.equal(url === API_ORIGIN + step.path, true, "Only the exact planned free GET route");
      assert.equal(options.method, "GET"); assert.equal(Object.hasOwn(options, "body"), false);
      assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store"); assert.equal(options.referrerPolicy, "no-referrer");
      assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "Authorization", "Cache-Control"]);
      assert.equal(options.headers.Accept, "application/json"); assert.equal(options.headers["Cache-Control"], "no-store");
      assert.equal(options.headers.Authorization === "Bearer " + step.token, true, "Canonical credential passthrough at native transport");
      assert.equal(step.token === canonicalToken, true, "Native read belongs to the current synthetic credential");
      calls.push({ kind: step.kind, signal: options.signal });
      return step.answer;
    },
  };
  const context = vm.createContext({ window, document, location: window.location, AbortController, Event, TextEncoder, TextDecoder, Uint8Array,
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout, setInterval: time.setInterval, clearInterval: time.clearInterval });
  const evaluate = index => vm.runInContext(SOURCES[index], context, { filename: PINS[index + 1][0], timeout: 1000 });
  evaluate(0); evaluate(1); evaluate(2);
  const actualCatalog = window.LuminaCreatorApprovedReadingCatalog;
  window.LuminaCreatorApprovedReadingCatalog = Object.freeze({ ...actualCatalog, create(options) {
    ++creates;
    return actualCatalog.create({ ...options, onChange(state) { catalogStates.push(state); options.onChange(state); } });
  } });
  evaluate(3);
  const originalBridge = window.LuminaCreatorStudioApi;
  assert.equal(Object.isFrozen(originalBridge), true);
  // Observation only: always invoke the entry's original guarded bridge unchanged.
  window.LuminaCreatorStudioApi = Object.freeze({ identity: originalBridge.identity, isCurrent: originalBridge.isCurrent,
    fetch(path, options) {
      assert.equal(options.token === canonicalToken, true, "Canonical credential passthrough from actual section mount");
      assert.equal(options.identity?.ownerId === expectedOwner, true, "Bridge request belongs to the current synthetic owner");
      assert.equal(originalBridge.isCurrent(options.identity), true, "Actual section identity remains current at the bridge");
      assert.equal(options._retried, true); assert.equal(Object.hasOwn(options, "body"), false);
      bridgeCalls.push("section"); return originalBridge.fetch(path, options);
    } });
  // Explicitly mount the actual exported widget to retain its controller for assertions.
  // No substituted fetch adapter, synthetic controller, or rewritten product source.
  document.readyState = "loading"; evaluate(4);
  const controller = window.LuminaCreatorApprovedSectionBytes.mount(document.getElementById("writerApprovedSectionBytes"));
  document.readyState = "complete"; assert(controller);
  assert.equal(creates, 1); assert.equal(calls.length, 0); assert.equal(bridgeCalls.length, 0);
  const node = id => { const value = document.getElementById(id); assert(value, "Mounted source node required"); return value; };
  function hide() { if (!hidden) { hidden = true; window.dispatchEvent({ type: "pagehide", persisted: false }); } }
  t.after(async () => {
    hide(); await flush();
    assert.equal(time.pending(), 0); assert.equal(time.watching(), 0);
    assert.equal(writes.length, 0); assert.equal(effects.length, 0); assert(reads.every(key => key === AUTH_KEY));
    assert.equal(memory.get("synthetic_draft"), "ORIGINAL_DRAFT");
    assert.equal(calls.length, plan.length, "Exact planned native read count");
    assert.deepEqual(calls.map(call => call.kind), plan.map(step => step.kind));
    assert.equal(bridgeCalls.length, plan.filter(step => step.kind === "section").length, "Every section read traversed the actual entry bridge");
    assert.equal(events.includes("lumina:auth-expired"), false, "No manufactured auth expiry event");
  });
  return { window, document, controller, node, calls, time, catalogStates,
    scope: () => window.LuminaCreatorApprovedReadingScope.snapshot(),
    current: scope => window.LuminaCreatorApprovedReadingScope.isCurrent(scope),
    latestCatalog: () => catalogStates.at(-1), rawAuth: () => memory.get(AUTH_KEY),
    emit(type) { window.dispatchEvent({ type }); },
    replaceAuth(owner, token) { expectedOwner = owner; canonicalToken = token; memory.set(AUTH_KEY, JSON.stringify(memoryAuth(owner, token))); },
    loadCatalog() { assert.equal(node("readingCatalogLoad").disabled, false); return node("readingCatalogLoad").emit("click"); },
    choose(work) { assert.equal(node("readingCatalogWork").disabled, false); node("readingCatalogWork").value = work; return node("readingCatalogWork").emit("change"); },
    loadSection() { assert.equal(node("writerApprovedSectionBytesLoad").disabled, false); return node("writerApprovedSectionBytesLoad").emit("click"); },
  };
}

async function selectKnown(f, work = WORK_A) {
  assert.equal(await f.loadCatalog(), true); assert.equal(f.latestCatalog().phase, "ready");
  assert.equal(f.scope(), null, "Catalog success is not automatic work selection");
  assert.equal(f.controller.snapshot().data, null); assert.equal(f.choose(work), true);
  const selected = f.scope(); assert(selected);
  assert.equal(selected.workId === work, true, "Only the explicitly chosen synthetic catalog work");
  assert.equal(f.node("writerManuscriptWork").value === work, true, "Entry handed the chosen work to the actual widget");
  assert.equal(f.current(selected), true); assert.equal(f.node("writerManuscriptLocale").value, "ko");
  assert.equal(await f.window.LuminaCreatorApprovedReadingScope.validate(selected, new AbortController().signal), true);
  return selected;
}

function loaded(f, expected = sectionPacket()) {
  const state = f.controller.snapshot();
  assert.equal(state.phase, "ready"); assert.equal(state.messageKey, "loaded");
  assert.deepEqual(clone(state.data), expected, "Actual strict parser supplied the numeric result");
  assert.equal(state.data.dispatchAuthorized, false); assert.equal(state.data.semanticQualityVerified, false);
  assert.equal(state.data.diagnostic.modelInputFit, "unmeasured");
  assert.equal(f.node("writerApprovedSectionBytesContent").hidden, false); assert.equal(f.node("writerApprovedSectionBytesTable").hidden, false);
  const rows = f.node("writerApprovedSectionBytesRows").children;
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.map(row => row.dataset.sectionKey), expected.diagnostic.sections.map(row => row.key));
  assert.deepEqual(rows.map(row => row.children.slice(1).map(cell => Number(cell.textContent))),
    expected.diagnostic.sections.map(row => [row.authorSectionBytes, row.authorValueBytes, row.approvalEvidenceEntryBytes]));
  assert.equal(f.time.pending(), 0);
}

function noNumericData(f) {
  assert.equal(f.controller.snapshot().data, null);
  assert.equal(f.node("writerApprovedSectionBytesContent").hidden, true); assert.equal(f.node("writerApprovedSectionBytesTable").hidden, true);
  assert.equal(f.node("writerApprovedSectionBytesContent").children.length, 0); assert.equal(f.node("writerApprovedSectionBytesRows").children.length, 0);
}

function retired(f, oldScope) {
  assert.equal(f.scope(), null); assert.equal(f.current(oldScope), false);
  assert.equal(f.latestCatalog().phase, "idle"); assert.equal(f.latestCatalog().selected, null); assert.equal(f.latestCatalog().items.length, 0);
  assert.equal(f.node("writerManuscriptWork").value, ""); assert.equal(f.node("readingCatalogWork").value, "");
  assert.equal(f.controller.snapshot().phase, "idle"); assert.equal(f.controller.snapshot().messageKey, "noWork");
  noNumericData(f); assert.equal(f.time.pending(), 0);
}

test("catalog/section auth: catalog 200 and explicit known selection reach actual mounted numeric loaded 200", OPTIONS, async t => {
  const catalogReply = response(catalogPacket()), sectionReply = response(sectionPacket());
  const f = fixture(t, [{ ...catalogStep(), answer: catalogReply }, sectionStep(sectionReply)]);
  assert.equal(f.controller.snapshot().messageKey, "noWork"); assert.equal(await f.controller.load(), false); assert.equal(f.calls.length, 0);
  assert.equal(await f.loadCatalog(), true); assert.equal(f.scope(), null); assert.equal(f.calls.length, 1);
  assert.equal(f.choose(UNKNOWN_WORK), false); assert.equal(f.scope(), null);
  assert.equal(await f.controller.load(), false); assert.equal(f.calls.length, 1);
  assert.equal(f.choose(WORK_A), true);
  const scope = f.scope(), identity = f.window.LuminaCreatorStudioApi.identity();
  assert.equal(f.current(scope), true); assert.equal(await f.loadSection(), true); loaded(f);
  assert.equal(f.scope() === scope, true); assert.equal(f.current(scope), true);
  assert.equal(f.window.LuminaCreatorStudioApi.isCurrent(identity), true); assert.equal(f.latestCatalog().phase, "ready");
  assert.equal(f.latestCatalog().selected === scope, true); assert.equal(f.calls.length, 2);
  assert.equal(catalogReply.stats.reads, 2); assert.equal(sectionReply.stats.reads, 2);
  assert.equal(sectionReply.stats.canceled, 0);
  f.emit("focus"); f.time.pulse(); await flush(); loaded(f); assert.equal(f.calls.length, 2);
});

test("catalog/section auth: same-owner section 401 classifies only that read, not storage or owner expiry", OPTIONS, async t => {
  const rejected = response({}, 401), f = fixture(t, [catalogStep(), sectionStep(rejected)]);
  const scope = await selectKnown(f), identity = f.window.LuminaCreatorStudioApi.identity(), raw = f.rawAuth();
  assert.equal(await f.loadSection(), false);
  assert.equal(f.controller.snapshot().phase, "error"); assert.equal(f.controller.snapshot().messageKey, "unauthenticated");
  noNumericData(f); assert.equal(f.controller.snapshot().canLoad, true);
  assert.equal(f.scope() === scope, true); assert.equal(f.current(scope), true); assert.equal(f.latestCatalog().phase, "ready");
  assert.equal(f.latestCatalog().selected === scope, true); assert.equal(f.window.LuminaCreatorStudioApi.isCurrent(identity), true);
  assert.equal(f.rawAuth() === raw, true, "A request-local rejection never rewrites auth memory");
  assert.equal(f.node("readingCatalogLogin").hidden, false); assert.equal(rejected.stats.canceled, 1); assert.equal(rejected.stats.readers, 0);
  f.emit("focus"); f.time.pulse(); f.time.advance(30000); await flush();
  assert.equal(f.calls.length, 2); assert.equal(f.current(scope), true); assert.equal(f.controller.snapshot().messageKey, "unauthenticated");
});

test("catalog/section auth: same-owner section 503 is server failure with current catalog selection and no fabricated data", OPTIONS, async t => {
  const unavailable = response({}, 503), f = fixture(t, [catalogStep(), sectionStep(unavailable)]);
  const scope = await selectKnown(f), identity = f.window.LuminaCreatorStudioApi.identity(), raw = f.rawAuth();
  assert.equal(await f.loadSection(), false);
  assert.equal(f.controller.snapshot().phase, "error"); assert.equal(f.controller.snapshot().messageKey, "server");
  noNumericData(f); assert.equal(f.controller.snapshot().canLoad, true);
  assert.equal(f.scope() === scope, true); assert.equal(f.current(scope), true); assert.equal(f.latestCatalog().phase, "ready");
  assert.equal(f.latestCatalog().selected === scope, true); assert.equal(f.window.LuminaCreatorStudioApi.isCurrent(identity), true);
  assert.equal(f.rawAuth() === raw, true, "A server failure never rewrites auth memory");
  assert.equal(f.node("readingCatalogLogin").hidden, true); assert.equal(unavailable.stats.canceled, 1); assert.equal(unavailable.stats.readers, 0);
  f.emit("focus"); f.time.pulse(); f.time.advance(30000); await flush();
  assert.equal(f.calls.length, 2); assert.equal(f.current(scope), true); assert.equal(f.controller.snapshot().messageKey, "server");
});

test("catalog/section auth: owner swap, late 401 and same-owner token change retire old scope and numeric data", OPTIONS, async t => {
  const waiting = deferred(), late = response({}, 401), next = sectionPacket(102);
  const f = fixture(t, [catalogStep(), sectionStep(waiting.promise), catalogStep(WORK_B, TOKEN_B), sectionStep(response(next), WORK_B, TOKEN_B)]);
  const old = await selectKnown(f), oldIdentity = f.window.LuminaCreatorStudioApi.identity(), pending = f.loadSection(); await flush();
  assert.equal(f.calls.length, 2); assert.equal(f.controller.snapshot().phase, "loading"); noNumericData(f);
  f.replaceAuth(OWNER_B, TOKEN_B); f.emit("lumina:authchange");
  assert.equal(await pending, false); await flush(); retired(f, old);
  assert.equal(f.window.LuminaCreatorStudioApi.isCurrent(oldIdentity), false);
  assert.equal(f.calls[1].signal.aborted, true); assert.equal(f.calls.length, 2);
  const current = await selectKnown(f, WORK_B); assert.equal(await f.loadSection(), true); loaded(f, next);
  const state = clone(f.controller.snapshot()), catalogCount = f.catalogStates.length;
  waiting.resolve(late); await flush();
  assert.equal(late.stats.canceled, 1); assert.equal(late.stats.readers, 0); assert.equal(late.stats.reads, 0);
  assert.deepEqual(clone(f.controller.snapshot()), state); assert.equal(f.catalogStates.length, catalogCount);
  assert.equal(f.scope() === current, true); assert.equal(f.current(current), true); assert.equal(f.current(old), false);
  assert.equal(f.latestCatalog().phase, "ready"); assert.equal(f.node("readingCatalogLogin").hidden, true);
  assert.equal(f.calls.length, 4); loaded(f, next);
  const identity = f.window.LuminaCreatorStudioApi.identity(), ticket = f.controller.snapshot().ticket;
  f.replaceAuth(OWNER_B, TOKEN_A); f.time.pulse(); await flush(); retired(f, current);
  const changed = f.window.LuminaCreatorStudioApi.identity();
  assert.equal(changed.ownerId === identity.ownerId, true, "The owner is unchanged while credential epoch advances");
  assert.equal(changed.epoch > identity.epoch, true); assert.equal(f.window.LuminaCreatorStudioApi.isCurrent(identity), false);
  assert.equal(f.window.getAuth().accessToken === TOKEN_A, true, "Changed canonical credential is checked without printing it");
  assert.equal(await f.controller.load(ticket), false); assert.equal(await f.controller.load(), false);
  f.emit("focus"); f.time.pulse(); f.time.advance(30000); await flush(); retired(f, current); assert.equal(f.calls.length, 4);
});
