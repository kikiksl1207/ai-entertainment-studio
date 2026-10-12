(() => {
  "use strict";
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const maxBytes = 8192, readDeadlineMs = 30000;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) =>
    Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
  const clone = value => JSON.parse(JSON.stringify(value));
  const envelopeBytes = JSON.stringify({
    contract: "story-approved-profile-wire-envelope-v1", encoding: "gzip+base64", data: ""
  }).length;
  const rootKeys = ["contract", "sourceScope", "locale", "manuscriptVersion", "analysisVersion", "profileVersion",
    "reviewRevision", "readOnly", "providerCalls", "operatingWrites", "dispatchAuthorized", "semanticQualityVerified",
    "legalAuthorization", "paidApproval", "fixedInputTokenLimit", "fixedOutputTokenLimit", "diagnostic"];
  const diagnosticKeys = ["contract", "byteCap", "wholeCandidateViewBytes", "candidateViewFits", "gzipBytes",
    "base64Utf8Bytes", "wholeWireEnvelopeBytes", "normalizedApprovalPreserved", "byteExactRoundTrip", "modelInputFit",
    "semanticQualityVerified", "dispatchAuthorized", "providerCalls", "operatingWrites"];

  function dataRecord(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getOwnPropertySymbols(value).length) return false;
    const prototype = Object.getPrototypeOf(value), constructor = prototype && Object.getOwnPropertyDescriptor(prototype, "constructor");
    if (prototype !== null && (Object.getPrototypeOf(prototype) !== null || !constructor ||
        !Object.prototype.hasOwnProperty.call(constructor, "value") || typeof constructor.value !== "function" ||
        constructor.value.prototype !== prototype ||
        Function.prototype.toString.call(constructor.value) !== Function.prototype.toString.call(Object))) return false;
    return Object.getOwnPropertyNames(value).every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor.enumerable && Object.prototype.hasOwnProperty.call(descriptor, "value");
    });
  }
  const exact = (value, keys) => dataRecord(value) && Object.keys(value).length === keys.length &&
    keys.every(key => Object.prototype.hasOwnProperty.call(value, key));

  function parseWire(value) {
    try {
      if (!exact(value, rootKeys) || !exact(value.diagnostic, diagnosticKeys)) return null;
      const d = value.diagnostic;
      if (value.contract !== "story-author-approved-wire-v1" ||
          value.sourceScope !== "latest_owner_approved_profile_transport_only" || !locales.includes(value.locale) ||
          ["manuscriptVersion", "analysisVersion", "profileVersion", "reviewRevision"].some(key => !integer(value[key], 1, 2147483647)) ||
          value.readOnly !== true || value.providerCalls !== 0 || value.operatingWrites !== 0 ||
          value.dispatchAuthorized !== false || value.semanticQualityVerified !== false ||
          value.legalAuthorization !== "not_evaluated" || value.paidApproval !== "not_evaluated" ||
          value.fixedInputTokenLimit !== 32768 || value.fixedOutputTokenLimit !== 8192 ||
          d.contract !== "story-approved-profile-wire-metric-v1" || d.byteCap !== 16384 ||
          !integer(d.wholeCandidateViewBytes, 1, 262144) ||
          d.candidateViewFits !== (d.wholeCandidateViewBytes <= d.byteCap) || !integer(d.gzipBytes, 1, 524288) ||
          d.base64Utf8Bytes !== 4 * Math.ceil(d.gzipBytes / 3) ||
          d.wholeWireEnvelopeBytes !== d.base64Utf8Bytes + envelopeBytes ||
          d.normalizedApprovalPreserved !== true || d.byteExactRoundTrip !== true || d.modelInputFit !== "unmeasured" ||
          d.semanticQualityVerified !== false || d.dispatchAuthorized !== false || d.providerCalls !== 0 || d.operatingWrites !== 0) return null;
      const result = {};
      for (const key of rootKeys) if (key !== "diagnostic") result[key] = value[key];
      result.diagnostic = {};
      for (const key of diagnosticKeys) result.diagnostic[key] = d[key];
      Object.freeze(result.diagnostic);
      return Object.freeze(result);
    } catch (_) { return null; }
  }

  const ownErrors = new WeakSet();
  function failure(kind) {
    const error = new Error("Approved transport check unavailable");
    error.kind = kind; ownErrors.add(error); return error;
  }
  function cancel(response) {
    try { Promise.resolve(response?.body?.cancel?.()).catch(() => {}); } catch (_) {}
  }
  async function readBody(response, current, signal) {
    if (!current()) { cancel(response); throw failure("stale"); }
    const get = name => response.headers?.get?.(name);
    const type = get("content-type"), length = get("content-length"), cache = get("cache-control"), vary = get("vary");
    const directives = typeof cache === "string" ? cache.toLowerCase().split(",").map(item => item.trim()) : [];
    const varies = typeof vary === "string" ? vary.toLowerCase().split(",").map(item => item.trim()) : [];
    if (typeof type !== "string" || !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(type) ||
        (length !== null && length !== undefined && (typeof length !== "string" || !/^\d+$/.test(length) || Number(length) > maxBytes)) ||
        !directives.includes("private") || !directives.includes("no-store") || directives.includes("public") ||
        !varies.includes("authorization") || typeof response.body?.getReader !== "function") {
      cancel(response); throw failure("invalid");
    }
    const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
    let canceled = false, bytes = 0, text = "";
    const abortReader = () => {
      if (canceled) return;
      canceled = true;
      try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (_) {}
    };
    signal.addEventListener("abort", abortReader, { once: true });
    if (signal.aborted) abortReader();
    try {
      while (true) {
        if (!current()) throw failure("stale");
        const chunk = await reader.read();
        if (!current()) throw failure("stale");
        if (!chunk || typeof chunk.done !== "boolean") throw failure("invalid");
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) throw failure("invalid");
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) throw failure("invalid");
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      if (!current()) throw failure("stale");
      try { return JSON.parse(text); } catch (_) { throw failure("invalid"); }
    } catch (error) { abortReader(); throw error; }
    finally {
      signal.removeEventListener("abort", abortReader);
      try { reader.releaseLock(); } catch (_) {}
    }
  }

  function createController({ fetch, identity, isCurrent, context, locale = () => "ko", visible = () => true, onChange = () => {} }) {
    let scope = null, ticket = 0, request = null, data = null, phase = "idle", messageKey = "ready";
    function sample() {
      try {
        const target = context(), language = locale(), shown = visible() === true, owner = identity();
        const authenticated = owner !== null && typeof owner === "object" && typeof owner.ownerId === "string" &&
          uuid.test(owner.ownerId) && integer(owner.epoch) && isCurrent(owner) === true;
        return {
          workId: typeof target?.workId === "string" ? target.workId.toLowerCase() : "",
          sourceLocale: locales.includes(target?.locale) ? target.locale : null,
          selectedChoiceId: typeof target?.selectedChoiceId === "string" ? target.selectedChoiceId : "",
          locale: locales.includes(language) ? language : null, shown, available: typeof fetch === "function",
          owner: authenticated ? { ownerId: owner.ownerId, epoch: owner.epoch,
            ...(typeof owner.token === "string" ? { token: owner.token } : {}) } : null
        };
      } catch (_) { return { workId: "", sourceLocale: null, selectedChoiceId: "", locale: null, shown: false, available: false, owner: null }; }
    }
    function initial(s) {
      return !s.shown ? "hidden" : !s.available ? "unavailable" : !s.owner ? "unauthenticated" :
        !s.workId ? "noWork" : !uuid.test(s.workId) || !s.locale || !s.sourceLocale ? "invalid" : "ready";
    }
    function state() {
      return { ticket, phase, messageKey, locale: scope?.locale || "ko", data: data === null ? null : clone(data),
        busy: phase === "loading", canLoad: !!scope && initial(scope) === "ready" && phase !== "loading" };
    }
    function emit() { onChange(state()); }
    function reset(next) {
      const old = request; ++ticket; request = null; data = null; phase = "idle"; scope = next;
      messageKey = next ? initial(next) : "ready"; old?.abort();
    }
    function syncContext(notify = true) {
      const before = ticket, next = sample();
      if (before !== ticket) return state();
      if (JSON.stringify(scope) !== JSON.stringify(next)) { reset(next); if (notify) emit(); }
      return state();
    }
    function invalidate() { reset(null); syncContext(false); emit(); }
    async function load(expectedTicket = null) {
      syncContext();
      if (!state().canLoad || (expectedTicket !== null && expectedTicket !== ticket)) return false;
      const workId = scope.workId, owner = { ...scope.owner }, ownTicket = ++ticket, abort = new AbortController();
      let timer = null, finished = false, settle;
      const canceled = new Promise(resolve => { settle = resolve; });
      function finish() {
        finished = true;
        if (timer !== null) { clearTimeout(timer); timer = null; }
      }
      const gate = { abort() {
        if (finished) return;
        finish(); settle(false); abort.abort();
      } };
      request = gate; data = null; phase = "loading"; messageKey = "loading";
      const current = () => { syncContext(); return ticket === ownTicket && !abort.signal.aborted; };
      timer = setTimeout(() => {
        if (finished || request !== gate || !current()) return;
        finish(); request = null; data = null; phase = "error"; messageKey = "transport"; settle(false);
        try { emit(); } finally { abort.abort(); }
      }, readDeadlineMs);
      emit();
      const work = async () => {
        try {
          if (!current()) return false;
          const url = "/api/v1/me/creator-studio/stories/" + workId +
            "/generation-profile/approved-wire?measurement=gzip-base64-v1";
          const response = await fetch(url, { method: "GET", identity: owner, _retried: true, cache: "no-store",
            headers: { "Cache-Control": "no-store", "Accept": "application/json" }, signal: abort.signal });
          if (!current()) { cancel(response); return false; }
          if (!integer(response?.status, 100, 599) || response.redirected === true) { cancel(response); throw failure("invalid"); }
          if (response.status !== 200) {
            cancel(response);
            throw failure(response.status === 401 ? "unauthenticated" : response.status === 403 ? "forbidden" :
              response.status === 409 ? "changed" : response.status >= 500 ? "server" : "unavailable");
          }
          const raw = await readBody(response, current, abort.signal);
          if (!current()) return false;
          const parsed = parseWire(raw);
          if (!parsed) throw failure("invalid");
          if (!current()) return false;
          finish(); request = null; data = parsed; phase = "ready"; messageKey = "loaded"; emit(); return true;
        } catch (error) {
          if (!current()) return false;
          finish(); request = null; data = null; phase = "error";
          messageKey = ownErrors.has(error) ? error.kind : "transport"; emit(); return false;
        } finally {
          finish();
          if (request === gate) request = null;
        }
      };
      return Promise.race([work(), canceled]);
    }
    syncContext(false);
    return { snapshot: state, load, syncContext, invalidate };
  }

  const copy = {
    "ko": {
      "title": "\uc2b9\uc778\uc790\ub8cc \ud655\uc778",
      "load": "\uc0c8\ub85c \ud655\uc778",
      "ready": "\ub300\uae30",
      "loading": "\ud655\uc778 \uc911",
      "loaded": "\ud655\uc778\ub428",
      "hidden": "\uc228\uae40",
      "unavailable": "\uc0ac\uc6a9\ud560 \uc218 \uc5c6\uc74c",
      "noWork": "\uc791\ud488 \ubbf8\uc120\ud0dd",
      "unauthenticated": "\ub85c\uadf8\uc778 \ud544\uc694",
      "forbidden": "\uc811\uadfc\ud560 \uc218 \uc5c6\uc74c",
      "changed": "\uc2b9\uc778 \uc790\ub8cc \ubcc0\uacbd\ub428",
      "server": "\ud655\uc778\ud560 \uc218 \uc5c6\uc74c",
      "transport": "\uc5f0\uacb0 \uc624\ub958",
      "invalid": "\uc751\ub2f5\uc744 \ud655\uc778\ud560 \uc218 \uc5c6\uc74c",
      "sourceLocale": "\ucd5c\uc2e0 \uc6d0\uace0 \uc5b8\uc5b4",
      "manuscript": "\uc6d0\uace0 \ubc84\uc804",
      "analysis": "\ubd84\uc11d \ubc84\uc804",
      "profile": "\ud504\ub85c\ud544 \ubc84\uc804",
      "review": "\uac80\ud1a0 \ucc28\uc218",
      "rawBytes": "\uc2b9\uc778\uc790\ub8cc \ud06c\uae30",
      "gzipBytes": "\uc555\ucd95\ud30c\uc77c \ud06c\uae30",
      "base64Bytes": "\uc804\uc1a1\ub370\uc774\ud130 \ud06c\uae30",
      "envelopeBytes": "\uc804\uccb4 \uc804\uc1a1 \ud06c\uae30",
      "rawCap": "\uae30\uc874 \uc790\ub8cc \ud55c\ub3c4",
      "rawStatus": "\uc790\ub8cc \ud06c\uae30 \ud310\uc815",
      "withinRaw": "\ud55c\ub3c4 \uc774\ub0b4",
      "overRaw": "\ud55c\ub3c4 \ucd08\uacfc",
      "restored": "\uc790\ub8cc \ubcf5\uc6d0",
      "normalized": "\uc2b9\uc778 \uae30\uc900 \ubcf4\uc874",
      "confirmed": "\uc77c\uce58",
      "inputCap": "\uc785\ub825 \ud55c\ub3c4",
      "outputCap": "\ucd9c\ub825 \ud55c\ub3c4",
      "inputFit": "AI \uc785\ub825 \uc801\ud569\uc131",
      "unmeasured": "\ud655\uc778 \uc804",
      "semantic": "\ubb38\uccb4 \ud488\uc9c8",
      "notVerified": "\uac80\uc99d \uc804",
      "legal": "\ubc95\uc801 \uad8c\ud55c",
      "paid": "\uc720\ub8cc \uc2b9\uc778",
      "notEvaluated": "\ubbf8\ud3c9\uac00",
      "dispatch": "\uc2e4\ud589 \uc2b9\uc778",
      "notAllowed": "\ud5c8\uc6a9\ub418\uc9c0 \uc54a\uc74c"
    },
    "en": {
      "title": "Approved Data Check",
      "load": "Refresh",
      "ready": "Ready",
      "loading": "Checking",
      "loaded": "Checked",
      "hidden": "Hidden",
      "unavailable": "Unavailable",
      "noWork": "No work selected",
      "unauthenticated": "Sign-in required",
      "forbidden": "Access denied",
      "changed": "Approval source changed",
      "server": "Check unavailable",
      "transport": "Connection error",
      "invalid": "Invalid response",
      "sourceLocale": "Latest manuscript language",
      "manuscript": "Manuscript version",
      "analysis": "Analysis version",
      "profile": "Profile version",
      "review": "Review revision",
      "rawBytes": "Approved data size",
      "gzipBytes": "Compressed file size",
      "base64Bytes": "Transfer data size",
      "envelopeBytes": "Total transfer size",
      "rawCap": "Existing data limit",
      "rawStatus": "Data size check",
      "withinRaw": "Within cap",
      "overRaw": "Over cap",
      "restored": "Data restoration",
      "normalized": "Approval criteria preserved",
      "confirmed": "Equal",
      "inputCap": "Input limit",
      "outputCap": "Output limit",
      "inputFit": "AI input suitability",
      "unmeasured": "Awaiting check",
      "semantic": "Style quality",
      "notVerified": "Awaiting verification",
      "legal": "Legal authorization",
      "paid": "Paid approval",
      "notEvaluated": "Not evaluated",
      "dispatch": "Dispatch approval",
      "notAllowed": "Not allowed"
    },
    "ja": {
      "title": "\u627f\u8a8d\u8cc7\u6599\u306e\u78ba\u8a8d",
      "load": "\u518d\u78ba\u8a8d",
      "ready": "\u5f85\u6a5f",
      "loading": "\u78ba\u8a8d\u4e2d",
      "loaded": "\u78ba\u8a8d\u6e08\u307f",
      "hidden": "\u975e\u8868\u793a",
      "unavailable": "\u5229\u7528\u4e0d\u53ef",
      "noWork": "\u4f5c\u54c1\u672a\u9078\u629e",
      "unauthenticated": "\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981",
      "forbidden": "\u30a2\u30af\u30bb\u30b9\u4e0d\u53ef",
      "changed": "\u627f\u8a8d\u8cc7\u6599\u304c\u5909\u66f4\u3055\u308c\u307e\u3057\u305f",
      "server": "\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093",
      "transport": "\u63a5\u7d9a\u30a8\u30e9\u30fc",
      "invalid": "\u5fdc\u7b54\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093",
      "sourceLocale": "\u6700\u65b0\u539f\u7a3f\u306e\u8a00\u8a9e",
      "manuscript": "\u539f\u7a3f\u30d0\u30fc\u30b8\u30e7\u30f3",
      "analysis": "\u5206\u6790\u30d0\u30fc\u30b8\u30e7\u30f3",
      "profile": "\u30d7\u30ed\u30d5\u30a1\u30a4\u30eb\u30d0\u30fc\u30b8\u30e7\u30f3",
      "review": "\u78ba\u8a8d\u6539\u8a02",
      "rawBytes": "\u627f\u8a8d\u8cc7\u6599\u306e\u30b5\u30a4\u30ba",
      "gzipBytes": "\u5727\u7e2e\u30d5\u30a1\u30a4\u30eb\u306e\u30b5\u30a4\u30ba",
      "base64Bytes": "\u9001\u4fe1\u30c7\u30fc\u30bf\u306e\u30b5\u30a4\u30ba",
      "envelopeBytes": "\u9001\u4fe1\u5168\u4f53\u306e\u30b5\u30a4\u30ba",
      "rawCap": "\u65e2\u5b58\u306e\u8cc7\u6599\u4e0a\u9650",
      "rawStatus": "\u8cc7\u6599\u30b5\u30a4\u30ba\u306e\u5224\u5b9a",
      "withinRaw": "\u4e0a\u9650\u4ee5\u5185",
      "overRaw": "\u4e0a\u9650\u8d85\u904e",
      "restored": "\u8cc7\u6599\u306e\u5fa9\u5143",
      "normalized": "\u627f\u8a8d\u57fa\u6e96\u306e\u4fdd\u6301",
      "confirmed": "\u4e00\u81f4",
      "inputCap": "\u5165\u529b\u4e0a\u9650",
      "outputCap": "\u51fa\u529b\u4e0a\u9650",
      "inputFit": "AI\u5165\u529b\u306e\u9069\u5408\u6027",
      "unmeasured": "\u78ba\u8a8d\u524d",
      "semantic": "\u6587\u4f53\u54c1\u8cea",
      "notVerified": "\u691c\u8a3c\u524d",
      "legal": "\u6cd5\u7684\u6a29\u9650",
      "paid": "\u6709\u6599\u627f\u8a8d",
      "notEvaluated": "\u672a\u8a55\u4fa1",
      "dispatch": "\u5b9f\u884c\u627f\u8a8d",
      "notAllowed": "\u8a31\u53ef\u306a\u3057"
    },
    "zh-Hans": {
      "title": "\u6279\u51c6\u8d44\u6599\u786e\u8ba4",
      "load": "\u91cd\u65b0\u786e\u8ba4",
      "ready": "\u7b49\u5f85",
      "loading": "\u786e\u8ba4\u4e2d",
      "loaded": "\u5df2\u786e\u8ba4",
      "hidden": "\u9690\u85cf",
      "unavailable": "\u4e0d\u53ef\u7528",
      "noWork": "\u672a\u9009\u62e9\u4f5c\u54c1",
      "unauthenticated": "\u9700\u8981\u767b\u5f55",
      "forbidden": "\u65e0\u6cd5\u8bbf\u95ee",
      "changed": "\u6279\u51c6\u8d44\u6599\u5df2\u66f4\u6539",
      "server": "\u65e0\u6cd5\u786e\u8ba4",
      "transport": "\u8fde\u63a5\u9519\u8bef",
      "invalid": "\u65e0\u6cd5\u786e\u8ba4\u54cd\u5e94",
      "sourceLocale": "\u6700\u65b0\u7a3f\u4ef6\u8bed\u8a00",
      "manuscript": "\u7a3f\u4ef6\u7248\u672c",
      "analysis": "\u5206\u6790\u7248\u672c",
      "profile": "\u914d\u7f6e\u7248\u672c",
      "review": "\u5ba1\u6838\u4fee\u8ba2",
      "rawBytes": "\u6279\u51c6\u8d44\u6599\u5927\u5c0f",
      "gzipBytes": "\u538b\u7f29\u6587\u4ef6\u5927\u5c0f",
      "base64Bytes": "\u4f20\u8f93\u6570\u636e\u5927\u5c0f",
      "envelopeBytes": "\u603b\u4f20\u8f93\u5927\u5c0f",
      "rawCap": "\u73b0\u6709\u8d44\u6599\u4e0a\u9650",
      "rawStatus": "\u8d44\u6599\u5927\u5c0f\u5224\u5b9a",
      "withinRaw": "\u672a\u8d85\u4e0a\u9650",
      "overRaw": "\u8d85\u8fc7\u4e0a\u9650",
      "restored": "\u8d44\u6599\u8fd8\u539f",
      "normalized": "\u6279\u51c6\u6807\u51c6\u4fdd\u7559",
      "confirmed": "\u4e00\u81f4",
      "inputCap": "\u8f93\u5165\u4e0a\u9650",
      "outputCap": "\u8f93\u51fa\u4e0a\u9650",
      "inputFit": "AI\u8f93\u5165\u9002\u7528\u6027",
      "unmeasured": "\u5f85\u786e\u8ba4",
      "semantic": "\u6587\u4f53\u8d28\u91cf",
      "notVerified": "\u5f85\u9a8c\u8bc1",
      "legal": "\u6cd5\u5f8b\u6743\u9650",
      "paid": "\u4ed8\u8d39\u6279\u51c6",
      "notEvaluated": "\u672a\u8bc4\u4f30",
      "dispatch": "\u6267\u884c\u6279\u51c6",
      "notAllowed": "\u672a\u5141\u8bb8"
    },
    "zh-Hant": {
      "title": "\u6838\u51c6\u8cc7\u6599\u78ba\u8a8d",
      "load": "\u91cd\u65b0\u78ba\u8a8d",
      "ready": "\u7b49\u5f85",
      "loading": "\u78ba\u8a8d\u4e2d",
      "loaded": "\u5df2\u78ba\u8a8d",
      "hidden": "\u96b1\u85cf",
      "unavailable": "\u7121\u6cd5\u4f7f\u7528",
      "noWork": "\u672a\u9078\u64c7\u4f5c\u54c1",
      "unauthenticated": "\u9700\u8981\u767b\u5165",
      "forbidden": "\u7121\u6cd5\u5b58\u53d6",
      "changed": "\u6838\u51c6\u8cc7\u6599\u5df2\u8b8a\u66f4",
      "server": "\u7121\u6cd5\u78ba\u8a8d",
      "transport": "\u9023\u7dda\u932f\u8aa4",
      "invalid": "\u7121\u6cd5\u78ba\u8a8d\u56de\u61c9",
      "sourceLocale": "\u6700\u65b0\u7a3f\u4ef6\u8a9e\u8a00",
      "manuscript": "\u7a3f\u4ef6\u7248\u672c",
      "analysis": "\u5206\u6790\u7248\u672c",
      "profile": "\u8a2d\u5b9a\u7248\u672c",
      "review": "\u5be9\u6838\u4fee\u8a02",
      "rawBytes": "\u6838\u51c6\u8cc7\u6599\u5927\u5c0f",
      "gzipBytes": "\u58d3\u7e2e\u6a94\u6848\u5927\u5c0f",
      "base64Bytes": "\u50b3\u8f38\u8cc7\u6599\u5927\u5c0f",
      "envelopeBytes": "\u6574\u9ad4\u50b3\u8f38\u5927\u5c0f",
      "rawCap": "\u65e2\u6709\u8cc7\u6599\u4e0a\u9650",
      "rawStatus": "\u8cc7\u6599\u5927\u5c0f\u5224\u5b9a",
      "withinRaw": "\u672a\u8d85\u4e0a\u9650",
      "overRaw": "\u8d85\u904e\u4e0a\u9650",
      "restored": "\u8cc7\u6599\u9084\u539f",
      "normalized": "\u6838\u51c6\u6a19\u6e96\u4fdd\u7559",
      "confirmed": "\u4e00\u81f4",
      "inputCap": "\u8f38\u5165\u4e0a\u9650",
      "outputCap": "\u8f38\u51fa\u4e0a\u9650",
      "inputFit": "AI\u8f38\u5165\u9069\u7528\u6027",
      "unmeasured": "\u5f85\u78ba\u8a8d",
      "semantic": "\u6587\u9ad4\u54c1\u8cea",
      "notVerified": "\u5f85\u9a57\u8b49",
      "legal": "\u6cd5\u5f8b\u6b0a\u9650",
      "paid": "\u4ed8\u8cbb\u6838\u51c6",
      "notEvaluated": "\u672a\u8a55\u4f30",
      "dispatch": "\u57f7\u884c\u6838\u51c6",
      "notAllowed": "\u672a\u5141\u8a31"
    }
  };
  for (const language of locales) Object.freeze(copy[language]);
  Object.freeze(copy);
  const localeNames = { ko: "\ud55c\uad6d\uc5b4", en: "English", ja: "\u65e5\u672c\u8a9e", "zh-Hans": "\u7b80\u4f53\u4e2d\u6587", "zh-Hant": "\u7e41\u9ad4\u4e2d\u6587" };

  function mount(host) {
    if (!host || host.dataset.approvedWireMounted) return null;
    const shell = document.getElementById("studioShell"), section = document.getElementById("writer-manuscript");
    if (!shell || !section || !shell.contains(section) || !section.contains(host)) return null;
    host.dataset.approvedWireMounted = "true";
    function element(tag, name) { const node = document.createElement(tag); if (name) node.className = name; return node; }
    const header = element("div", "body-current-fit-header"), title = element("h3");
    title.id = "writerApprovedWireTitle";
    const load = element("button", "body-current-fit-button"); load.id = "writerApprovedWireLoad"; load.type = "button";
    let icon;
    try {
      if (typeof window.lucide?.createElement === "function" && window.lucide?.icons?.RefreshCw)
        icon = window.lucide.createElement(window.lucide.icons.RefreshCw);
    } catch (_) {}
    if (!icon) { icon = element("span"); icon.textContent = "\u21bb"; }
    icon.setAttribute("aria-hidden", "true"); load.append(icon); header.append(title, load);
    const status = element("p", "body-current-fit-state"), content = element("dl", "body-current-fit-metadata");
    status.id = "writerApprovedWireState"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    content.id = "writerApprovedWireContent"; host.replaceChildren(header, status, content);
    function render(state) {
      const c = copy[state.locale];
      host.lang = state.locale; title.textContent = c.title; load.title = c.load; load.setAttribute("aria-label", c.load);
      load.setAttribute("aria-busy", String(state.phase === "loading")); load.disabled = !state.canLoad;
      status.textContent = c[state.messageKey]; status.className = "body-current-fit-state" + (state.phase === "error" ? " is-error" : "");
      content.replaceChildren(); content.hidden = state.data === null;
      if (!state.data) return;
      const value = state.data, d = value.diagnostic, format = new Intl.NumberFormat(state.locale);
      function row(key, result) {
        const group = element("div"), dt = element("dt"), dd = element("dd");
        dt.textContent = c[key]; dd.textContent = String(result); group.append(dt, dd); content.append(group);
      }
      row("sourceLocale", localeNames[value.locale]);
      for (const [key, field] of [["manuscript", "manuscriptVersion"], ["analysis", "analysisVersion"],
        ["profile", "profileVersion"], ["review", "reviewRevision"]]) row(key, format.format(value[field]));
      for (const [key, field] of [["rawBytes", "wholeCandidateViewBytes"], ["gzipBytes", "gzipBytes"],
        ["base64Bytes", "base64Utf8Bytes"], ["envelopeBytes", "wholeWireEnvelopeBytes"], ["rawCap", "byteCap"]])
        row(key, format.format(d[field]) + " B");
      row("rawStatus", c[d.candidateViewFits ? "withinRaw" : "overRaw"]);
      row("restored", c.confirmed); row("normalized", c.confirmed);
      row("inputCap", format.format(value.fixedInputTokenLimit)); row("outputCap", format.format(value.fixedOutputTokenLimit));
      row("inputFit", c.unmeasured); row("semantic", c.notVerified); row("legal", c.notEvaluated);
      row("paid", c.notEvaluated); row("dispatch", c.notAllowed);
    }
    function token() {
      const auth = window.getAuth?.();
      const value = auth?.accessToken || auth?.access_token || auth?.token || auth?.tokens?.accessToken || auth?.tokens?.access_token;
      return typeof value === "string" && value ? value : null;
    }
    const controller = createController({
      fetch: (url, options) => {
        const owner = options.identity, api = window.LuminaCreatorStudioApi;
        if (!owner.token || token() !== owner.token || api?.isCurrent?.(owner) !== true || options.signal.aborted)
          throw failure("stale");
        return api.fetch(url, { ...options, identity: { ownerId: owner.ownerId, epoch: owner.epoch }, token: owner.token });
      },
      identity: () => {
        const owner = window.LuminaCreatorStudioApi?.identity?.(), accessToken = token();
        return owner && accessToken ? { ownerId: owner.ownerId, epoch: owner.epoch, token: accessToken } : null;
      },
      isCurrent: owner => typeof window.LuminaCreatorStudioApi?.fetch === "function" &&
        window.LuminaCreatorStudioApi.isCurrent?.(owner) === true && token() === owner.token,
      context: () => ({ workId: document.getElementById("writerManuscriptWork")?.value || "",
        locale: document.getElementById("writerManuscriptLocale")?.value,
        selectedChoiceId: document.getElementById("writerBodyCurrentFitChoice")?.value || "" }),
      locale: () => window.luminaI18n?.getLocale?.() || document.documentElement.lang || "ko",
      visible: () => !shell.hidden && !section.hidden && !host.hidden && host.isConnected !== false &&
        shell.contains(section) && section.contains(host) && section.classList.contains("is-active") && document.visibilityState !== "hidden",
      onChange: render
    });
    load.addEventListener("click", () => { if (!load.disabled) return controller.load(controller.snapshot().ticket); });
    const invalidate = () => controller.invalidate(), sync = () => controller.syncContext();
    for (const name of ["storage", "lumina:authchange", "lumina:auth-expired", "pagehide", "creator:manuscript-accepted",
      "creator:generation-profile-changed", "lumina:author-body-trial-progress-changed"]) window.addEventListener(name, invalidate);
    for (const name of ["focus", "pageshow", "lumina:localechange"]) window.addEventListener(name, sync);
    for (const name of ["visibilitychange", "lumina:auth-expired"]) document.addEventListener(name, invalidate);
    for (const name of ["input", "change"]) document.addEventListener(name, event => {
      if (["writerManuscriptWork", "writerManuscriptLocale", "writerBodyCurrentFitChoice"].includes(event.target?.id)) invalidate();
    }, true);
    document.addEventListener("click", event => {
      const tab = event.target?.closest?.("[data-section]");
      if (tab && tab.getAttribute("data-section") !== "writer-manuscript") invalidate();
    }, true);
    if (typeof MutationObserver === "function") {
      for (const [node, attributes] of [[shell, ["hidden"]], [section, ["class", "hidden", "style"]],
        [host, ["hidden"]], [document.documentElement, ["lang"]]]) {
        new MutationObserver(invalidate).observe(node, { attributes: true, attributeFilter: attributes });
      }
      for (const id of ["writerManuscriptWork", "writerManuscriptLocale", "writerBodyCurrentFitChoice"]) {
        const node = document.getElementById(id);
        if (node) new MutationObserver(sync).observe(node, { childList: true, subtree: true, attributes: true,
          attributeFilter: ["value", "selected", "disabled"] });
      }
      // Direct ancestor changes detect detachment without observing our rendered text.
      const ancestry = new MutationObserver(sync);
      for (let node = host.parentNode; node; node = node.parentNode) ancestry.observe(node, { childList: true });
    }
    render(controller.snapshot()); return controller;
  }
  window.LuminaCreatorApprovedWire = { createController, parseWire, mount, copy, maxBytes };
  if (typeof document !== "undefined") {
    const start = () => mount(document.getElementById("writerApprovedWire"));
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }
})();
