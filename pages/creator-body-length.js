(function () {
  "use strict";
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const maxBytes = 16 * 1024;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const clone = value => JSON.parse(JSON.stringify(value));
  const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
  const ownErrors = new WeakSet();
  function failure(kind) { const error = new Error(kind); error.kind = kind; ownErrors.add(error); return error; }
  const reasons = {
    fixed_cap_narrative_within_original_bounds: "within",
    continuation_output_underlength: "under",
    continuation_output_overlength: "over",
    fixed_cap_narrative_unmeasured: "unmeasured",
    author_length_profile_invalid: "invalidBounds",
    author_length_locale_mismatch: "invalidLocale",
    author_length_locale_unsupported: "invalidLocale",
    author_length_beats_invalid: "invalidText",
    author_length_beat_type_invalid: "invalidText",
    author_length_text_invalid: "invalidText",
    author_length_byte_limit: "invalidBytes",
    author_length_unicode_invalid: "invalidText"
  };
  const copy = {
    ko: {
      title: "\uc800\uc7a5 \ubd84\uae30 \ubd84\ub7c9", check: "\ubd84\ub7c9 \ud655\uc778", snapshot: "\uc77d\uae30 \uc2dc\uc810\uc758 \uac8c\uc2dc \uc6d0\uc791\ubd80 \uae30\uc900", ready: "\ubd84\ub7c9 \ud655\uc778 \ub300\uae30", loading: "\ubd84\ub7c9 \ud655\uc778 \uc911",
      hidden: "", unauthenticated: "\ub85c\uadf8\uc778\uc774 \ud544\uc694\ud569\ub2c8\ub2e4.", noWork: "\uc120\ud0dd\ub41c \uc791\ud488\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.", unavailable: "\ubd84\ub7c9 \ud655\uc778\uc744 \uc0ac\uc6a9\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.",
      forbidden: "\uc774 \ubd84\ub7c9\uc744 \ud655\uc778\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.", conflict: "\ud604\uc7ac \uacbd\ub85c\uac00 \ubcc0\uacbd\ub418\uc5c8\uc2b5\ub2c8\ub2e4.", server: "\ubd84\ub7c9\uc744 \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.", transport: "\uc5f0\uacb0\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.", invalid: "\ubd84\ub7c9 \uc751\ub2f5\uc744 \ud655\uc778\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.",
      no_saved_body: "\uc800\uc7a5\ub41c \ubcf8\ubb38 \uc5c6\uc74c", canonical_body_only: "\uc6d0\uc791 \ubcf8\ubb38 \u00b7 \ubd84\uae30 \ubd84\ub7c9 \uc5c6\uc74c", original_reference_unavailable: "\uac8c\uc2dc \uc6d0\uc791\ubd80 \uae30\uc900 \ubd84\ub7c9 \ubbf8\ud655\uc778",
      within: "\uc6d0\uc791 \uae30\uc900 \ubd84\ub7c9 \ubc94\uc704 \ub0b4", under: "\uc6d0\uc791 \uae30\uc900\ubcf4\ub2e4 \uc9e7\uc74c", over: "\uc6d0\uc791 \uae30\uc900\ubcf4\ub2e4 \uae34 \ubd84\ub7c9", unmeasured: "\ubd84\ub7c9 \ubbf8\ud655\uc778", invalidBounds: "\uae30\uc900 \ubd84\ub7c9 \ubbf8\ud655\uc778",
      invalidLocale: "\ubcf8\ubb38 \uc5b8\uc5b4 \ubbf8\ud655\uc778", invalidText: "\ubcf8\ubb38 \ud615\uc2dd \ubbf8\ud655\uc778", invalidBytes: "\ubcf8\ubb38 \ubc14\uc774\ud2b8 \ubc94\uc704 \ubbf8\ud655\uc778",
      source: "\ubcf8\ubb38 \uc5b8\uc5b4", scope: "\uae30\uc900", published: "\ud604\uc7ac \uac8c\uc2dc \uc6d0\uc791\ubd80", revision: "\uac80\uc0ac \uacbd\ub85c \ubc84\uc804", status: "\ubd84\ub7c9 \uc0c1\ud0dc", measurement: "\uacc4\uc0b0 \ub2e8\uc704", units: "\uacf5\ubc31\u00b7\uc81c\uc5b4 \ubb38\uc790 \uc81c\uc678 \ubb38\uc790 \uc218",
      reference: "\uc6d0\uc791 \uae30\uc900 \ubb38\uc790 \uc218", range: "\uc6d0\uc791 \uae30\uc900 80-120%", target: "\uae30\uc900 \ubaa9\ud45c \ubb38\uc790 \uc218", measured: "\uc800\uc7a5 \ubd84\uae30 \ubb38\uc790 \uc218", bytes: "\ubcf8\ubb38 UTF-8 \ubc14\uc774\ud2b8", beats: "\ubcf8\ubb38 \ube14\ub85d \uc218", unknown: "\ubbf8\ud655\uc778"
    },
    en: {
      title: "Saved Branch Length", check: "Check length", snapshot: "Published original part at read time", ready: "Length check pending", loading: "Checking length",
      hidden: "", unauthenticated: "Sign-in required.", noWork: "No work selected.", unavailable: "Length check unavailable.",
      forbidden: "This length is not accessible.", conflict: "The current path changed.", server: "Could not load length.", transport: "Could not connect.", invalid: "Length response could not be verified.",
      no_saved_body: "No saved body", canonical_body_only: "Original body \u00b7 no branch length", original_reference_unavailable: "Published original reference unavailable",
      within: "Within original length range", under: "Shorter than original range", over: "Longer than original range", unmeasured: "Length unmeasured", invalidBounds: "Reference length unverified",
      invalidLocale: "Body language unverified", invalidText: "Body format unverified", invalidBytes: "Body byte range unverified",
      source: "Body language", scope: "Reference", published: "Current published original part", revision: "Checked path revision", status: "Length status", measurement: "Counting unit", units: "Characters excluding whitespace and control characters",
      reference: "Original reference characters", range: "80-120% of original", target: "Reference target characters", measured: "Saved branch characters", bytes: "Body UTF-8 bytes", beats: "Body blocks", unknown: "Unmeasured"
    },
    ja: {
      title: "\u4fdd\u5b58\u5206\u5c90\u306e\u5206\u91cf", check: "\u5206\u91cf\u3092\u78ba\u8a8d", snapshot: "\u8aad\u53d6\u6642\u70b9\u306e\u516c\u958b\u539f\u4f5c\u30d1\u30fc\u30c8\u57fa\u6e96", ready: "\u5206\u91cf\u78ba\u8a8d\u5f85\u3061", loading: "\u5206\u91cf\u78ba\u8a8d\u4e2d",
      hidden: "", unauthenticated: "\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981\u3067\u3059\u3002", noWork: "\u4f5c\u54c1\u304c\u9078\u629e\u3055\u308c\u3066\u3044\u307e\u305b\u3093\u3002", unavailable: "\u5206\u91cf\u78ba\u8a8d\u3092\u5229\u7528\u3067\u304d\u307e\u305b\u3093\u3002",
      forbidden: "\u3053\u306e\u5206\u91cf\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3002", conflict: "\u73fe\u5728\u306e\u7d4c\u8def\u304c\u5909\u66f4\u3055\u308c\u307e\u3057\u305f\u3002", server: "\u5206\u91cf\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002", transport: "\u63a5\u7d9a\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002", invalid: "\u5206\u91cf\u306e\u5fdc\u7b54\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3002",
      no_saved_body: "\u4fdd\u5b58\u672c\u6587\u306a\u3057", canonical_body_only: "\u539f\u4f5c\u672c\u6587\u30fb\u5206\u5c90\u5206\u91cf\u306a\u3057", original_reference_unavailable: "\u516c\u958b\u539f\u4f5c\u30d1\u30fc\u30c8\u306e\u57fa\u6e96\u5206\u91cf\u672a\u78ba\u8a8d",
      within: "\u539f\u4f5c\u57fa\u6e96\u306e\u5206\u91cf\u7bc4\u56f2\u5185", under: "\u539f\u4f5c\u57fa\u6e96\u3088\u308a\u77ed\u3044", over: "\u539f\u4f5c\u57fa\u6e96\u3088\u308a\u9577\u3044", unmeasured: "\u5206\u91cf\u672a\u78ba\u8a8d", invalidBounds: "\u57fa\u6e96\u5206\u91cf\u672a\u78ba\u8a8d",
      invalidLocale: "\u672c\u6587\u8a00\u8a9e\u672a\u78ba\u8a8d", invalidText: "\u672c\u6587\u5f62\u5f0f\u672a\u78ba\u8a8d", invalidBytes: "\u672c\u6587\u30d0\u30a4\u30c8\u7bc4\u56f2\u672a\u78ba\u8a8d",
      source: "\u672c\u6587\u8a00\u8a9e", scope: "\u57fa\u6e96", published: "\u73fe\u5728\u306e\u516c\u958b\u539f\u4f5c\u30d1\u30fc\u30c8", revision: "\u78ba\u8a8d\u7d4c\u8def\u30d0\u30fc\u30b8\u30e7\u30f3", status: "\u5206\u91cf\u72b6\u614b", measurement: "\u8a08\u7b97\u5358\u4f4d", units: "\u7a7a\u767d\u30fb\u5236\u5fa1\u6587\u5b57\u3092\u9664\u304f\u6587\u5b57\u6570",
      reference: "\u539f\u4f5c\u57fa\u6e96\u6587\u5b57\u6570", range: "\u539f\u4f5c\u57fa\u6e9680-120%", target: "\u57fa\u6e96\u76ee\u6a19\u6587\u5b57\u6570", measured: "\u4fdd\u5b58\u5206\u5c90\u6587\u5b57\u6570", bytes: "\u672c\u6587UTF-8\u30d0\u30a4\u30c8", beats: "\u672c\u6587\u30d6\u30ed\u30c3\u30af\u6570", unknown: "\u672a\u78ba\u8a8d"
    },
    "zh-Hans": {
      title: "\u5df2\u4fdd\u5b58\u5206\u652f\u7bc7\u5e45", check: "\u68c0\u67e5\u7bc7\u5e45", snapshot: "\u8bfb\u53d6\u65f6\u7684\u5df2\u53d1\u5e03\u539f\u4f5c\u90e8\u5206\u57fa\u51c6", ready: "\u7bc7\u5e45\u5f85\u68c0\u67e5", loading: "\u6b63\u5728\u68c0\u67e5\u7bc7\u5e45",
      hidden: "", unauthenticated: "\u9700\u8981\u767b\u5f55\u3002", noWork: "\u672a\u9009\u62e9\u4f5c\u54c1\u3002", unavailable: "\u65e0\u6cd5\u68c0\u67e5\u7bc7\u5e45\u3002",
      forbidden: "\u65e0\u6cd5\u67e5\u770b\u6b64\u7bc7\u5e45\u3002", conflict: "\u5f53\u524d\u8def\u5f84\u5df2\u53d8\u66f4\u3002", server: "\u65e0\u6cd5\u8bfb\u53d6\u7bc7\u5e45\u3002", transport: "\u65e0\u6cd5\u8fde\u63a5\u3002", invalid: "\u65e0\u6cd5\u786e\u8ba4\u7bc7\u5e45\u54cd\u5e94\u3002",
      no_saved_body: "\u6ca1\u6709\u5df2\u4fdd\u5b58\u6b63\u6587", canonical_body_only: "\u539f\u4f5c\u6b63\u6587 \u00b7 \u65e0\u5206\u652f\u7bc7\u5e45", original_reference_unavailable: "\u5df2\u53d1\u5e03\u539f\u4f5c\u90e8\u5206\u7684\u57fa\u51c6\u7bc7\u5e45\u672a\u786e\u8ba4",
      within: "\u5728\u539f\u4f5c\u57fa\u51c6\u7bc7\u5e45\u8303\u56f4\u5185", under: "\u77ed\u4e8e\u539f\u4f5c\u57fa\u51c6\u8303\u56f4", over: "\u957f\u4e8e\u539f\u4f5c\u57fa\u51c6\u8303\u56f4", unmeasured: "\u7bc7\u5e45\u672a\u786e\u8ba4", invalidBounds: "\u57fa\u51c6\u7bc7\u5e45\u672a\u786e\u8ba4",
      invalidLocale: "\u6b63\u6587\u8bed\u8a00\u672a\u786e\u8ba4", invalidText: "\u6b63\u6587\u683c\u5f0f\u672a\u786e\u8ba4", invalidBytes: "\u6b63\u6587\u5b57\u8282\u8303\u56f4\u672a\u786e\u8ba4",
      source: "\u6b63\u6587\u8bed\u8a00", scope: "\u57fa\u51c6", published: "\u5f53\u524d\u5df2\u53d1\u5e03\u539f\u4f5c\u90e8\u5206", revision: "\u68c0\u67e5\u8def\u5f84\u7248\u672c", status: "\u7bc7\u5e45\u72b6\u6001", measurement: "\u8ba1\u6570\u5355\u4f4d", units: "\u4e0d\u542b\u7a7a\u767d\u548c\u63a7\u5236\u5b57\u7b26\u7684\u5b57\u7b26\u6570",
      reference: "\u539f\u4f5c\u57fa\u51c6\u5b57\u7b26\u6570", range: "\u539f\u4f5c\u57fa\u51c680-120%", target: "\u57fa\u51c6\u76ee\u6807\u5b57\u7b26\u6570", measured: "\u5df2\u4fdd\u5b58\u5206\u652f\u5b57\u7b26\u6570", bytes: "\u6b63\u6587UTF-8\u5b57\u8282", beats: "\u6b63\u6587\u5757\u6570", unknown: "\u672a\u786e\u8ba4"
    },
    "zh-Hant": {
      title: "\u5df2\u5132\u5b58\u5206\u652f\u7bc7\u5e45", check: "\u6aa2\u67e5\u7bc7\u5e45", snapshot: "\u8b80\u53d6\u6642\u7684\u5df2\u767c\u5e03\u539f\u4f5c\u90e8\u5206\u57fa\u6e96", ready: "\u7bc7\u5e45\u5f85\u6aa2\u67e5", loading: "\u6b63\u5728\u6aa2\u67e5\u7bc7\u5e45",
      hidden: "", unauthenticated: "\u9700\u8981\u767b\u5165\u3002", noWork: "\u672a\u9078\u64c7\u4f5c\u54c1\u3002", unavailable: "\u7121\u6cd5\u6aa2\u67e5\u7bc7\u5e45\u3002",
      forbidden: "\u7121\u6cd5\u67e5\u770b\u6b64\u7bc7\u5e45\u3002", conflict: "\u76ee\u524d\u8def\u5f91\u5df2\u8b8a\u66f4\u3002", server: "\u7121\u6cd5\u8b80\u53d6\u7bc7\u5e45\u3002", transport: "\u7121\u6cd5\u9023\u7dda\u3002", invalid: "\u7121\u6cd5\u78ba\u8a8d\u7bc7\u5e45\u56de\u61c9\u3002",
      no_saved_body: "\u6c92\u6709\u5df2\u5132\u5b58\u6b63\u6587", canonical_body_only: "\u539f\u4f5c\u6b63\u6587 \u00b7 \u7121\u5206\u652f\u7bc7\u5e45", original_reference_unavailable: "\u5df2\u767c\u5e03\u539f\u4f5c\u90e8\u5206\u7684\u57fa\u6e96\u7bc7\u5e45\u672a\u78ba\u8a8d",
      within: "\u5728\u539f\u4f5c\u57fa\u6e96\u7bc7\u5e45\u7bc4\u570d\u5167", under: "\u77ed\u65bc\u539f\u4f5c\u57fa\u6e96\u7bc4\u570d", over: "\u9577\u65bc\u539f\u4f5c\u57fa\u6e96\u7bc4\u570d", unmeasured: "\u7bc7\u5e45\u672a\u78ba\u8a8d", invalidBounds: "\u57fa\u6e96\u7bc7\u5e45\u672a\u78ba\u8a8d",
      invalidLocale: "\u6b63\u6587\u8a9e\u8a00\u672a\u78ba\u8a8d", invalidText: "\u6b63\u6587\u683c\u5f0f\u672a\u78ba\u8a8d", invalidBytes: "\u6b63\u6587\u4f4d\u5143\u7d44\u7bc4\u570d\u672a\u78ba\u8a8d",
      source: "\u6b63\u6587\u8a9e\u8a00", scope: "\u57fa\u6e96", published: "\u76ee\u524d\u5df2\u767c\u5e03\u539f\u4f5c\u90e8\u5206", revision: "\u6aa2\u67e5\u8def\u5f91\u7248\u672c", status: "\u7bc7\u5e45\u72c0\u614b", measurement: "\u8a08\u6578\u55ae\u4f4d", units: "\u4e0d\u542b\u7a7a\u767d\u8207\u63a7\u5236\u5b57\u5143\u7684\u5b57\u5143\u6578",
      reference: "\u539f\u4f5c\u57fa\u6e96\u5b57\u5143\u6578", range: "\u539f\u4f5c\u57fa\u6e9680-120%", target: "\u57fa\u6e96\u76ee\u6a19\u5b57\u5143\u6578", measured: "\u5df2\u5132\u5b58\u5206\u652f\u5b57\u5143\u6578", bytes: "\u6b63\u6587UTF-8\u4f4d\u5143\u7d44", beats: "\u6b63\u6587\u5340\u584a\u6578", unknown: "\u672a\u78ba\u8a8d"
    }
  };
  const localeNames = { ko: "\ud55c\uad6d\uc5b4", en: "English", ja: "\u65e5\u672c\u8a9e", "zh-Hans": "\u7b80\u4f53\u4e2d\u6587", "zh-Hant": "\u7e41\u9ad4\u4e2d\u6587" };

  function parseDiagnostic(value, sourceLocale) {
    const keys = ["contract", "locale", "readOnly", "referenceScope", "progressRevision", "currentApprovalVerified", "semanticQualityVerified", "dispatchAuthorized", "providerCalls", "operatingWrites", "outcome", "diagnostic"];
    if (!locales.includes(sourceLocale) || !exact(value, keys) || value.contract !== "story-author-body-length-v1" || value.locale !== sourceLocale ||
        value.readOnly !== true || value.referenceScope !== "current_published_original_part" || value.currentApprovalVerified !== false ||
        value.semanticQualityVerified !== false || value.dispatchAuthorized !== false || value.providerCalls !== 0 || value.operatingWrites !== 0 ||
        !(value.progressRevision === null || integer(value.progressRevision, 0, Number.MAX_SAFE_INTEGER))) throw failure("invalid");
    if (value.outcome !== "no_saved_body" && value.progressRevision === null) throw failure("invalid");
    if (["no_saved_body", "canonical_body_only", "original_reference_unavailable"].includes(value.outcome)) {
      if (value.diagnostic !== null) throw failure("invalid");
    } else if (value.outcome === "generated_body_checked") {
      const d = value.diagnostic;
      if (!exact(d, ["version", "narrativeFit", "reason", "measuredUnits", "utf8Bytes", "beatCount", "expectedBounds", "currentApprovalVerified", "providerReceiptVerified", "semanticQualityVerified", "dispatchAuthorized", "providerCalls"]) ||
          d.version !== "story-fixed-cap-narrative-v1" || typeof d.reason !== "string" || !Object.prototype.hasOwnProperty.call(reasons, d.reason) ||
          d.currentApprovalVerified !== false || d.providerReceiptVerified !== false || d.semanticQualityVerified !== false || d.dispatchAuthorized !== false || d.providerCalls !== 0) throw failure("invalid");
      const b = d.expectedBounds;
      if (b !== null && (!exact(b, ["referenceUnits", "minUnits", "targetUnits", "maxUnits"]) || !integer(b.referenceUnits, 1, 256000) ||
          b.targetUnits !== b.referenceUnits || b.minUnits !== Math.ceil(b.referenceUnits * 4 / 5) || b.maxUnits !== Math.floor(b.referenceUnits * 6 / 5))) throw failure("invalid");
      const fit = d.reason === "fixed_cap_narrative_within_original_bounds" ? "within_original_bounds"
        : d.reason === "continuation_output_underlength" ? "underlength" : d.reason === "continuation_output_overlength" ? "overlength" : "unmeasured";
      if (d.narrativeFit !== fit || (b === null && !["author_length_profile_invalid", "fixed_cap_narrative_unmeasured"].includes(d.reason)) ||
          (d.reason === "author_length_profile_invalid" && b !== null)) throw failure("invalid");
      if (fit === "within_original_bounds") {
        if (!b || !integer(d.measuredUnits, b.minUnits, b.maxUnits) || !integer(d.utf8Bytes, d.measuredUnits, 100000) || !integer(d.beatCount, 1, 40)) throw failure("invalid");
      } else if (d.measuredUnits !== null || d.utf8Bytes !== null || d.beatCount !== null) throw failure("invalid");
    } else throw failure("invalid");
    return clone(value);
  }

  async function cancel(response) { try { await response?.body?.cancel?.(); } catch (_) {} }
  async function readBody(response, current) {
    const length = response.headers?.get?.("content-length");
    if (length !== null && length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes)) { await cancel(response); throw failure("invalid"); }
    if (typeof response.body?.getReader !== "function") { await cancel(response); throw failure("invalid"); }
    const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0, text = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (!current()) throw failure("stale");
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) throw failure("invalid");
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) throw failure("invalid");
        try { text += decoder.decode(chunk.value, { stream: true }); } catch (_) { throw failure("invalid"); }
      }
      try { text += decoder.decode(); } catch (_) { throw failure("invalid"); }
      if (!current()) throw failure("stale");
      try { return JSON.parse(text); } catch (_) { throw failure("invalid"); }
    } catch (error) { try { await reader.cancel(); } catch (_) {} throw error; }
    finally { reader.releaseLock(); }
  }

  function createController({ fetch, identity, isCurrent, context, locale = () => "ko", visible = () => true, onChange = () => {} }) {
    let scope = null, ticket = 0, data = null, phase = "idle", messageKey = "ready", request = null;
    function sample() {
      try {
        const target = context(), language = locale(), shown = visible() === true, owner = identity();
        const authenticated = record(owner) && typeof owner.ownerId === "string" && uuid.test(owner.ownerId) && integer(owner.epoch, 0, Number.MAX_SAFE_INTEGER) && isCurrent(owner) === true;
        return { workId: typeof target?.workId === "string" ? target.workId : "", sourceLocale: locales.includes(target?.locale) ? target.locale : null,
          locale: locales.includes(language) ? language : "ko", shown, available: typeof fetch === "function",
          owner: authenticated ? { ownerId: owner.ownerId, epoch: owner.epoch } : null };
      } catch (_) { return { workId: "", sourceLocale: null, locale: "ko", shown: false, available: false, owner: null }; }
    }
    function initial(s) { return !s.shown ? "hidden" : !s.available ? "unavailable" : !s.owner ? "unauthenticated" : !s.workId ? "noWork" : !uuid.test(s.workId) || !locales.includes(s.sourceLocale) ? "invalid" : "ready"; }
    function state() { return { ticket, phase, messageKey, locale: scope?.locale || "ko", data: data === null ? null : clone(data), busy: phase === "loading", canLoad: !!scope && initial(scope) === "ready" && phase !== "loading" }; }
    function emit() { onChange(state()); }
    function reset(next) {
      const old = request; ++ticket; request = null; data = null; phase = "idle"; scope = next; messageKey = next ? initial(next) : "ready";
      old?.abort();
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
      const target = { workId: scope.workId, locale: scope.sourceLocale }, owner = { ...scope.owner }, ownTicket = ++ticket;
      const abort = new AbortController(); request = abort; data = null; phase = "loading"; messageKey = "loading";
      const current = () => { syncContext(); return ticket === ownTicket; };
      emit();
      try {
        if (!current()) return false;
        const response = await fetch(`/api/v1/me/creator-studio/stories/${target.workId}/body-preview/length-diagnostic?locale=${target.locale}`, {
          method: "GET", identity: owner, _retried: true, cache: "no-store", headers: { "Cache-Control": "no-store" }, signal: abort.signal
        });
        if (!current()) { await cancel(response); return false; }
        if (!integer(response?.status, 100, 599)) { await cancel(response); throw failure("invalid"); }
        if (response.status !== 200) {
          await cancel(response);
          throw failure(response.status === 401 ? "unauthenticated" : response.status === 403 ? "forbidden" : response.status === 409 ? "conflict" : response.status >= 500 ? "server" : "unavailable");
        }
        const raw = await readBody(response, current);
        if (!current()) return false;
        const parsed = parseDiagnostic(raw, target.locale);
        if (!current()) return false;
        data = parsed; phase = "ready"; request = null;
        messageKey = parsed.diagnostic ? reasons[parsed.diagnostic.reason] : parsed.outcome;
        emit(); return current();
      } catch (error) {
        if (!current()) return false;
        data = null; request = null; phase = "error";
        messageKey = ownErrors.has(error) && ["invalid", "unauthenticated", "forbidden", "conflict", "server", "unavailable"].includes(error.kind) ? error.kind : "transport";
        emit(); return false;
      }
    }
    return { snapshot: () => syncContext(), syncContext, invalidate, load };
  }

  function mount(host) {
    if (!host || host.dataset.bodyLengthMounted) return null;
    const shell = document.getElementById("studioShell"), section = document.getElementById("writer-manuscript");
    if (!shell || !section) return null;
    host.dataset.bodyLengthMounted = "true";
    function element(tag, name) { const node = document.createElement(tag); if (name) node.className = name; return node; }
    const header = element("div", "body-length-header"), heading = element("div"), title = element("h3"), snapshot = element("p", "body-length-snapshot");
    title.id = "writerBodyLengthTitle"; heading.append(title, snapshot);
    const button = element("button", "body-length-check"); button.id = "writerBodyLengthCheck"; button.type = "button";
    let icon;
    try {
      if (typeof window.lucide?.createElement === "function" && window.lucide?.icons?.Ruler) icon = window.lucide.createElement(window.lucide.icons.Ruler);
    } catch (_) { /* An optional icon must not prevent lifecycle invalidation. */ }
    if (!icon) { icon = element("span"); icon.textContent = "\u2194"; }
    icon.setAttribute("aria-hidden", "true"); button.append(icon);
    header.append(heading, button);
    const status = element("p", "body-length-state"), content = element("dl", "body-length-metadata");
    status.id = "writerBodyLengthState"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); content.id = "writerBodyLengthContent";
    host.replaceChildren(header, status, content);
    function render(state) {
      const c = copy[state.locale]; host.lang = state.locale; title.textContent = c.title; snapshot.textContent = c.snapshot;
      button.title = c.check; button.setAttribute("aria-label", c.check); button.setAttribute("aria-busy", String(state.busy)); button.disabled = !state.canLoad;
      status.textContent = c[state.messageKey]; status.className = "body-length-state" + (state.phase === "error" ? " is-error" : "");
      content.replaceChildren(); content.hidden = state.data === null;
      if (!state.data) return;
      const b = state.data.diagnostic?.expectedBounds, d = state.data.diagnostic;
      function row(label, value) { const group = element("div"), dt = element("dt"), dd = element("dd"); dt.textContent = c[label]; dd.textContent = value === null ? c.unknown : String(value); group.append(dt, dd); content.append(group); }
      row("source", localeNames[state.data.locale]); row("scope", c.published); row("revision", state.data.progressRevision); row("status", c[state.messageKey]);
      if (d) {
        row("measurement", c.units); row("reference", b?.referenceUnits ?? null); row("range", b ? `${b.minUnits} - ${b.maxUnits}` : null); row("target", b?.targetUnits ?? null);
        row("measured", d.measuredUnits); row("bytes", d.utf8Bytes); row("beats", d.beatCount);
      }
    }
    const controller = createController({
      fetch: (url, options) => {
        const auth = window.getAuth?.(), token = auth?.accessToken || auth?.access_token || auth?.token || auth?.tokens?.accessToken || auth?.tokens?.access_token;
        if (typeof token !== "string" || !token) throw failure("unauthenticated");
        const authorized = window.LuminaCreatorStudioApi?.isCurrent?.(options.identity) === true;
        controller.syncContext();
        if (!authorized || options.signal.aborted) throw failure("stale");
        return window.LuminaCreatorStudioApi.fetch(url, { ...options, token });
      },
      identity: () => window.LuminaCreatorStudioApi?.identity?.(),
      isCurrent: owner => typeof window.LuminaCreatorStudioApi?.fetch === "function" && window.LuminaCreatorStudioApi?.isCurrent?.(owner) === true,
      context: () => ({ workId: document.getElementById("writerManuscriptWork")?.value || "", locale: document.getElementById("writerManuscriptLocale")?.value }),
      locale: () => window.luminaI18n?.getLocale?.() || document.documentElement.lang || "ko",
      visible: () => !shell.hidden && !section.hidden && !host.hidden && host.isConnected !== false && section.classList.contains("is-active") && document.visibilityState !== "hidden",
      onChange: render
    });
    button.addEventListener("click", () => controller.load(controller.snapshot().ticket));
    const invalidate = () => controller.invalidate(), sync = () => controller.syncContext();
    for (const name of ["storage", "lumina:authchange", "lumina:auth-expired", "pagehide", "creator:manuscript-accepted", "lumina:author-body-trial-progress-changed"]) window.addEventListener(name, invalidate);
    for (const name of ["focus", "pageshow", "lumina:localechange"]) window.addEventListener(name, sync);
    for (const name of ["visibilitychange", "lumina:auth-expired"]) document.addEventListener(name, invalidate);
    const selects = ["writerManuscriptWork", "writerManuscriptLocale"].map(id => document.getElementById(id)).filter(Boolean);
    for (const select of selects) for (const name of ["input", "change"]) select.addEventListener(name, invalidate);
    document.addEventListener("click", event => { const tab = event.target?.closest?.("[data-section]"); if (tab && tab.getAttribute("data-section") !== "writer-manuscript") invalidate(); }, true);
    if (typeof MutationObserver === "function") {
      for (const [node, attributes] of [[shell, ["hidden"]], [section, ["class", "hidden", "style"]], [host, ["hidden"]], [document.documentElement, ["lang"]]]) {
        new MutationObserver(invalidate).observe(node, { attributes: true, attributeFilter: attributes });
      }
      for (const select of selects) new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "selected", "disabled"] });
    }
    render(controller.snapshot());
    return controller;
  }
  window.LuminaCreatorBodyLength = { createController, parseDiagnostic, mount, copy, maxBytes };
  if (typeof document !== "undefined") mount(document.getElementById("writerBodyLength"));
})();
