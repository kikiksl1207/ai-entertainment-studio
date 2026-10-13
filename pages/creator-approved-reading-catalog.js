(function () {
  "use strict";
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  function exact(value, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Reflect.ownKeys(value).length !== keys.length) return false;
    return keys.every(key => {
      const d = Object.getOwnPropertyDescriptor(value, key);
      return d?.enumerable && Object.prototype.hasOwnProperty.call(d, "value");
    });
  }
  function parse(value) {
    try {
      if (!exact(value, ["contract", "sourceScope", "readOnly", "providerCalls", "operatingWrites", "items", "nextCursor"]) ||
          value.contract !== "story-owner-approved-reading-catalog-v1" || value.sourceScope !== "owner_work_records_only" ||
          value.readOnly !== true || value.providerCalls !== 0 || Object.is(value.providerCalls, -0) ||
          value.operatingWrites !== 0 || Object.is(value.operatingWrites, -0) || !Array.isArray(value.items) || value.items.length > 12 ||
          Reflect.ownKeys(value.items).length !== value.items.length + 1) return null;
      const ids = new Set(), items = [];
      for (let index = 0; index < value.items.length; ++index) {
        const descriptor = Object.getOwnPropertyDescriptor(value.items, index);
        if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, "value")) return null;
        const item = descriptor.value;
        if (!exact(item, ["workId", "title", "defaultLocale", "recordedState"]) || typeof item.workId !== "string" ||
            !uuid.test(item.workId) || ids.has(item.workId) || !locales.includes(item.defaultLocale) ||
            !exact(item.title, ["value", "locale", "fallback", "bounded"]) || typeof item.title.value !== "string" ||
            [...item.title.value].length > 256 || /[\p{Cc}\p{Cf}]/u.test(item.title.value) || !locales.includes(item.title.locale) ||
            typeof item.title.fallback !== "boolean" || typeof item.title.bounded !== "boolean" ||
            !exact(item.recordedState, ["workStatus", "approval"]) || item.recordedState.approval !== "not_checked" ||
            typeof item.recordedState.workStatus !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(item.recordedState.workStatus)) return null;
        ids.add(item.workId);
        items.push(Object.freeze({ workId: item.workId, title: Object.freeze({ ...item.title }), defaultLocale: item.defaultLocale,
          recordedState: Object.freeze({ ...item.recordedState }) }));
      }
      if (value.nextCursor !== null && (items.length !== 12 || value.nextCursor !== items.at(-1)?.workId)) return null;
      return Object.freeze({ items: Object.freeze(items), nextCursor: value.nextCursor });
    } catch (_) { return null; }
  }
  const failure = kind => Object.assign(new Error("Readonly catalog unavailable"), { kind });
  function cancel(response) { try { Promise.resolve(response?.body?.cancel?.()).catch(() => {}); } catch (_) {} }
  async function body(response, current, signal) {
    if (!current()) { cancel(response); throw failure("stale"); }
    const header = key => response.headers?.get?.(key), directives = (header("cache-control") || "").toLowerCase().split(",").map(x => x.trim());
    const vary = (header("vary") || "").toLowerCase().split(",").map(x => x.trim()), length = header("content-length");
    if (response.status !== 200) { cancel(response); throw failure(response.status === 401 ? "unauthenticated" : "unavailable"); }
    if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(header("content-type") || "") ||
        !directives.includes("private") || !directives.includes("no-store") || directives.includes("public") || !vary.includes("authorization") ||
        (length !== null && length !== undefined && (!/^\d+$/.test(length) || Number(length) > 8192)) || typeof response.body?.getReader !== "function") {
      cancel(response); throw failure("invalid");
    }
    const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0, text = "";
    const stop = () => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (_) {} };
    signal.addEventListener("abort", stop, { once: true });
    try {
      for (;;) {
        if (!current()) throw failure("stale");
        const chunk = await reader.read();
        if (!current()) throw failure("stale");
        if (!chunk || typeof chunk.done !== "boolean") throw failure("invalid");
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) throw failure("invalid");
        bytes += chunk.value.byteLength; if (bytes > 8192) throw failure("invalid");
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode(); return JSON.parse(text);
    } catch (error) { stop(); throw error; }
    finally { signal.removeEventListener("abort", stop); try { reader.releaseLock(); } catch (_) {} }
  }
  function create({ transport, locale, onChange = () => {}, deadlineMs = 30000 }) {
    if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 30000) throw failure("invalid");
    let disposed = false, scope = null, request = null, ticket = 0, data = null, selected = null, phase = "idle", seen = new Set();
    function sample() {
      try {
        const owner = transport.identity(), language = locale();
        return owner && typeof owner.ownerId === "string" && uuid.test(owner.ownerId.toLowerCase()) &&
          Number.isSafeInteger(owner.epoch) && owner.epoch >= 0 && transport.isCurrent(owner) && locales.includes(language) ? { owner, locale: language } : null;
      } catch (_) { return null; }
    }
    const same = (a, b) => a === null && b === null || !!a && !!b && a.owner.ownerId === b.owner.ownerId && a.owner.epoch === b.owner.epoch && a.locale === b.locale;
    function notify() { onChange(Object.freeze({ phase, items: data?.items || Object.freeze([]), nextCursor: data?.nextCursor || null, selected })); }
    function reset() {
      ++ticket; request?.abort(); request = null; data = null; selected = null; seen = new Set();
      scope = sample(); phase = scope ? "idle" : "unauthenticated"; notify();
    }
    function sync() { if (!disposed && !same(scope, sample())) reset(); }
    function selectionCurrent(value) { sync(); return !disposed && value !== null && selected === value && same(scope, sample()); }
    async function load(cursor = null) {
      if (disposed) return false;
      sync(); if (request || !scope) return false;
      if (cursor !== null && (!data || cursor !== data.nextCursor || !uuid.test(cursor))) return false;
      if (cursor === null) seen = new Set();
      const before = scope, number = ++ticket, abort = new AbortController(); request = abort;
      data = null; selected = null; phase = "loading"; notify();
      const current = () => !disposed && ticket === number && !abort.signal.aborted && same(before, sample());
      let timeout;
      try {
        const complete = (async () => {
          const auth = transport.getAuth(); if (!auth || !current()) throw failure("stale");
          const path = "/api/v1/me/creator-studio/approved-reading-catalog?locale=" + before.locale + "&limit=12" + (cursor === null ? "" : "&cursor=" + cursor);
          const response = await transport.fetch(path, { method: "GET", identity: before.owner, token: auth.accessToken,
            _retried: true, cache: "no-store", headers: { Accept: "application/json", "Cache-Control": "no-store" }, signal: abort.signal });
          const result = await body(response, current, abort.signal), packet = parse(result);
          if (!packet || packet.items.some(item => seen.has(item.workId))) throw failure("invalid");
          if (!current()) throw failure("stale"); return packet;
        })();
        const expired = new Promise((_, reject) => { timeout = setTimeout(() => { reject(failure("timeout")); abort.abort(); }, deadlineMs); });
        const packet = await Promise.race([complete, expired]);
        if (!current()) throw failure("stale");
        data = packet; for (const item of data.items) seen.add(item.workId);
        phase = data.items.length ? "ready" : "empty"; notify(); return true;
      } catch (error) {
        if (number === ticket && !disposed) {
          data = null; selected = null;
          phase = !same(before, sample()) ? "stale" : ["timeout", "unauthenticated"].includes(error?.kind) ? error.kind : "unavailable";
          notify();
        }
        return false;
      } finally { clearTimeout(timeout); abort.abort(); if (request === abort) request = null; }
    }
    function choose(workId) {
      sync(); if (disposed || request || !scope || !data) return false;
      if (workId === "") { selected = null; notify(); return true; }
      const item = data.items.find(item => item.workId === workId); if (!item) return false;
      selected = Object.freeze({ ownerId: scope.owner.ownerId, workId: item.workId, sourceLocale: item.defaultLocale, workLabel: item.title.value });
      notify(); return true;
    }
    function dispose() {
      if (disposed) return;
      disposed = true; ++ticket; request?.abort(); request = null; data = null; selected = null; seen = new Set(); scope = null;
      phase = "unauthenticated"; notify();
    }
    reset();
    return Object.freeze({ load, choose, sync, selection: () => { sync(); return selected; }, isSelectionCurrent: selectionCurrent, dispose });
  }
  window.LuminaCreatorApprovedReadingCatalog = Object.freeze({ parse, create });
})();
