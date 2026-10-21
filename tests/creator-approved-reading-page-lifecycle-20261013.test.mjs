import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const sources = ["creator-approved-readonly-transport.js", "creator-approved-reading-catalog.js", "creator-approved-reading-entry.js"]
  .map(file => readFileSync(new URL("../pages/" + file, import.meta.url), "utf8"));
const owner = "11111111-1111-4111-8111-111111111111", work = "33333333-3333-4333-8333-333333333333";
const data = { contract: "story-owner-approved-reading-catalog-v1", sourceScope: "owner_work_records_only", readOnly: true, providerCalls: 0, operatingWrites: 0,
  items: [{ workId: work, title: { value: "PRIVATE_SYNTHETIC_TITLE", locale: "ko", fallback: false, bounded: false }, defaultLocale: "ko", recordedState: { workStatus: "draft", approval: "not_checked" } }], nextCursor: null };
function fixture({ oldHtml = false, opener = null } = {}) {
  const elements = new Map(), handlers = new Map(), calls = [], profileEvents = [], intervals = new Set();
  let auth = { accessToken: "synthetic.token", user: { id: owner } }, reloads = 0;
  function element(id = "") { return { id, value: "", textContent: "", disabled: false, hidden: false, children: [], listeners: new Map(),
    appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; this.value = ""; }, setAttribute() {},
    addEventListener(type, fn) { this.listeners.set(type, fn); }, emit(type) { return this.listeners.get(type)?.(); } }; }
  for (const id of ["writerManuscriptWork", "writerManuscriptLocale", "readingWorkTitle", "readingConnectionState", "readingLocale", "readingTitle", "readingStudioLink", "readingLocaleLabel",
    ...oldHtml ? [] : ["readingCatalog", "readingCatalogWork", "readingCatalogLoad", "readingCatalogNext", "readingCatalogTitle", "readingCatalogWorkLabel", "readingCatalogState"]]) elements.set(id, element(id));
  elements.get("readingLocale").value = "ko";
  const window = { opener, crypto: { randomUUID: () => "44444444-4444-4444-8444-444444444444" },
    location: { reload() { ++reloads; } }, localStorage: { getItem: () => auth ? JSON.stringify(auth) : null },
    addEventListener(type, fn, options) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push({ fn, once: !!options?.once }); },
    removeEventListener(type, fn) { handlers.set(type, (handlers.get(type) || []).filter(x => x.fn !== fn)); },
    dispatchEvent(event) { if (event.type === "creator:generation-profile-changed") profileEvents.push(elements.get("writerManuscriptWork").value);
      for (const h of [...(handlers.get(event.type) || [])]) { h.fn(event); if (h.once) window.removeEventListener(event.type, h.fn); } },
    fetch: async (url, options) => { calls.push({ url, method: options.method }); return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", Vary: "Authorization" } }); },
    LuminaCreatorApprovedReadingHandoff: { createReceiver: () => ({ start() {}, snapshot: () => null, invalidate() {}, dispose() {}, validate: async () => false }) } };
  const document = { readyState: "complete", documentElement: { lang: "ko" }, title: "", getElementById: id => elements.get(id) || null, createElement: () => element() };
  const context = vm.createContext({ window, document, AbortController, TextDecoder, Uint8Array, Event, setTimeout, clearTimeout,
    setInterval(fn) { intervals.add(fn); return fn; }, clearInterval(fn) { intervals.delete(fn); } });
  for (const source of sources) vm.runInContext(source, context);
  return { elements, calls, profileEvents, intervals, window, reloads: () => reloads,
    authChanged() { auth = { accessToken: "synthetic.B", user: { id: "22222222-2222-4222-8222-222222222222" } }; window.dispatchEvent({ type: "lumina:authchange" }); } };
}
test("Actual standalone entry loads and selects without opener, automatic GET or DOM HTML insertion", async () => {
  const f = fixture(); assert.equal(f.calls.length, 0); assert.equal(f.elements.get("readingCatalog").hidden, false);
  assert.equal(f.elements.get("readingCatalogState").textContent, "작품 조회 전");
  await f.elements.get("readingCatalogLoad").emit("click"); assert.equal(f.calls.length, 1);
  f.elements.get("readingCatalogWork").value = work; f.elements.get("readingCatalogWork").emit("change");
  assert.equal(f.elements.get("readingWorkTitle").textContent, "PRIVATE_SYNTHETIC_TITLE"); assert.equal(f.elements.get("writerManuscriptWork").value, work);
  assert(f.profileEvents.includes(work)); assert.equal(f.elements.get("readingCatalogWork").children[1].textContent, "PRIVATE_SYNTHETIC_TITLE");
  f.window.dispatchEvent({ type: "pagehide", persisted: false });
});
test("BFCache hide clears owner titles, options and hidden context; restore reloads without an automatic API request", async () => {
  const f = fixture(); await f.elements.get("readingCatalogLoad").emit("click");
  f.elements.get("readingCatalogWork").value = work; f.elements.get("readingCatalogWork").emit("change");
  f.window.dispatchEvent({ type: "pagehide", persisted: true }); f.authChanged();
  assert.equal(f.elements.get("writerManuscriptWork").value, ""); assert(!f.elements.get("readingWorkTitle").textContent.includes("PRIVATE_SYNTHETIC"));
  assert.equal(f.elements.get("readingCatalogWork").children.length, 1); assert.equal(f.elements.get("readingCatalogLoad").disabled, true);
  assert.equal(f.intervals.size, 0); f.window.dispatchEvent({ type: "pageshow", persisted: true });
  assert.equal(f.reloads(), 1); assert.equal(f.calls.length, 1);
  await f.elements.get("readingCatalogLoad").emit("click"); assert.equal(f.calls.length, 1);
});
test("Normal pageshow does not reload, install duplicate intervals or fetch", () => {
  const f = fixture(); f.window.dispatchEvent({ type: "pageshow", persisted: false });
  assert.equal(f.reloads(), 0); assert.equal(f.intervals.size, 1); assert.equal(f.calls.length, 0); f.window.dispatchEvent({ type: "pagehide" });
});
test("An older cached HTML without catalog nodes still keeps the existing opener mode usable", () => {
  const f = fixture({ oldHtml: true, opener: {} }); assert.equal(f.calls.length, 0);
  assert.equal(f.elements.get("writerManuscriptWork").value, ""); f.window.dispatchEvent({ type: "pagehide" });
});
