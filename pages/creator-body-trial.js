(function () {
  "use strict";
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const failure = kind => Object.assign(new Error("Author trial unavailable"), { kind });
  const positive = value => Number.isSafeInteger(value) && value > 0;
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const money = value => typeof value === "string" && /^(0|[1-9][0-9]{0,11})\.[0-9]{6}$/.test(value);
  const micros = value => BigInt(value.replace(".", ""));
  const fixed = value => (value / 1000000n).toString() + "." + (value % 1000000n).toString().padStart(6, "0");
  const states = ["approval_required", "approval_expired", "release_changed", "cost_unknown", "budget_over_limit", "approval_recorded"];
  const copy = {
    ko: {
      title: "\uc791\uac00 \ubcf8\ubb38 \uc2dc\ud5d8", privacy: "\ube44\uacf5\uac1c \u00b7 \ubcf8\ubb38 \uc804\uc6a9", refresh: "\uc2dc\ud5d8 \uc0c1\ud0dc \uc0c8\ub85c\uace0\uce68", retry: "\uc774\uc804 \uc120\ud0dd \uc811\uc218 \ud655\uc778",
      ready: "\uc2dc\ud5d8 \uc0c1\ud0dc\ub97c \ud655\uc778\ud574 \uc8fc\uc138\uc694.", loading: "\uc2dc\ud5d8 \uc0c1\ud0dc \ud655\uc778 \uc911", submitting: "\uc120\ud0dd \uc811\uc218 \uc911", accepted: "\uc120\ud0dd\uc744 \uc811\uc218\ud588\uc2b5\ub2c8\ub2e4.",
      uncertain: "\uc811\uc218 \uacb0\uacfc \ud655\uc778 \ud544\uc694", unresolvedElsewhere: "\uc774\uc804 \uc791\ud488\uc758 \uc120\ud0dd \uc811\uc218 \ud655\uc778 \ud544\uc694", noWork: "\uc120\ud0dd\ub41c \uc791\ud488\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.", generationFailed: "\ubcf8\ubb38 \uc0dd\uc131 \uc2e4\ud328", generationTimeout: "\ubcf8\ubb38 \uc0dd\uc131 \uc2dc\uac04 \ucd08\uacfc",
      approval_required: "\ubcf8\ubb38 \uc2dc\ud5d8 \uc2b9\uc778 \ub4f1\ub85d \ud544\uc694", approval_expired: "\uc2dc\ud5d8 \uc2b9\uc778 \ub9cc\ub8cc", release_changed: "\uc2b9\uc778 \ud6c4 \uacf5\uac1c\ubcf8 \ubcc0\uacbd", cost_unknown: "\ubbf8\ud655\uc778 \uc0dd\uc131 \ube44\uc6a9 \uc788\uc74c", budget_over_limit: "\uc2b9\uc778 \uc608\uc0b0 \ucd08\uacfc", approval_recorded: "\uc2dc\ud5d8 \uc2b9\uc778 \ub4f1\ub85d\ub428",
      approved: "\uc2b9\uc778 \uc608\uc0b0", committed: "\uc0ac\uc6a9\u00b7\uc608\uc57d \ube44\uc6a9", remaining: "\uc794\uc5ec \uc608\uc0b0", unknown: "\ubbf8\ud655\uc778", choices: "\ud604\uc7ac \uc120\ud0dd\uc9c0", ending: "\uc5d4\ub529", generating: "\uc0dd\uc131 \ub300\uae30 \ub610\ub294 \uc0dd\uc131 \uc911", noProgress: "\uc800\uc7a5\ub41c \ub0b4 \uc9c4\ud589\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.", noScene: "\uc800\uc7a5\ub41c \ud604\uc7ac \uc7a5\uba74\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
      unauthenticated: "\ub85c\uadf8\uc778 \ud544\uc694", forbidden: "\uc774 \uc791\ud488\uc5d0 \ub300\ud55c \uad8c\ud55c \uc5c6\uc74c", notFound: "\uc791\ud488 \ub610\ub294 \uc9c4\ud589 \ucc3e\uc744 \uc218 \uc5c6\uc74c", conflict: "\uc9c4\ud589\u00b7\uc2b9\uc778\u00b7\ube44\uc6a9 \uc0c1\ud0dc \uc7ac\ud655\uc778 \ud544\uc694", invalid: "\uc751\ub2f5 \ud655\uc778 \uc2e4\ud328", transport: "\uc5f0\uacb0 \uc2e4\ud328", server: "\uc11c\ubc84 \uc751\ub2f5 \uc2e4\ud328", unavailable: "\ud604\uc7ac \uc2dc\ud5d8 \uc774\uc6a9 \ubd88\uac00", hidden: ""
    },
    en: {
      title: "Author text trial", privacy: "Private \u00b7 Text only", refresh: "Refresh trial state", retry: "Check previous choice receipt",
      ready: "Check the trial state.", loading: "Checking trial state", submitting: "Submitting choice", accepted: "Choice accepted.", uncertain: "Choice receipt needs checking", unresolvedElsewhere: "A previous story's choice receipt needs checking", noWork: "No story selected.",
      generationFailed: "Text generation failed", generationTimeout: "Text generation timed out",
      approval_required: "Trial approval registration required", approval_expired: "Trial approval expired", release_changed: "Release changed after approval", cost_unknown: "Unconfirmed generation cost", budget_over_limit: "Approved budget exceeded", approval_recorded: "Trial approval recorded",
      approved: "Approved budget", committed: "Spent and reserved", remaining: "Remaining budget", unknown: "Unconfirmed", choices: "Current choices", ending: "Ending", generating: "Pending or generating", noProgress: "No saved progress of your own.", noScene: "No saved current scene.",
      unauthenticated: "Sign-in required", forbidden: "No permission for this story", notFound: "Story or progress not found", conflict: "Progress, approval or cost needs checking", invalid: "Response verification failed", transport: "Connection failed", server: "Server response failed", unavailable: "Trial unavailable", hidden: ""
    },
    ja: {
      title: "\u4f5c\u8005\u306e\u672c\u6587\u30c6\u30b9\u30c8", privacy: "\u975e\u516c\u958b \u00b7 \u672c\u6587\u306e\u307f", refresh: "\u30c6\u30b9\u30c8\u72b6\u614b\u3092\u66f4\u65b0", retry: "\u524d\u306e\u9078\u629e\u306e\u53d7\u4ed8\u3092\u78ba\u8a8d",
      ready: "\u30c6\u30b9\u30c8\u72b6\u614b\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002", loading: "\u72b6\u614b\u3092\u78ba\u8a8d\u4e2d", submitting: "\u9078\u629e\u3092\u53d7\u4ed8\u4e2d", accepted: "\u9078\u629e\u3092\u53d7\u3051\u4ed8\u3051\u307e\u3057\u305f\u3002", uncertain: "\u53d7\u4ed8\u7d50\u679c\u306e\u78ba\u8a8d\u304c\u5fc5\u8981", unresolvedElsewhere: "\u524d\u306e\u4f5c\u54c1\u306e\u53d7\u4ed8\u78ba\u8a8d\u304c\u5fc5\u8981", noWork: "\u4f5c\u54c1\u672a\u9078\u629e",
      generationFailed: "\u672c\u6587\u751f\u6210\u5931\u6557", generationTimeout: "\u672c\u6587\u751f\u6210\u306e\u6642\u9593\u5207\u308c",
      approval_required: "\u30c6\u30b9\u30c8\u627f\u8a8d\u306e\u767b\u9332\u304c\u5fc5\u8981", approval_expired: "\u627f\u8a8d\u671f\u9650\u5207\u308c", release_changed: "\u627f\u8a8d\u5f8c\u306b\u516c\u958b\u7248\u304c\u5909\u66f4", cost_unknown: "\u672a\u78ba\u8a8d\u306e\u751f\u6210\u8cbb\u7528", budget_over_limit: "\u627f\u8a8d\u4e88\u7b97\u8d85\u904e", approval_recorded: "\u627f\u8a8d\u767b\u9332\u6e08\u307f",
      approved: "\u627f\u8a8d\u4e88\u7b97", committed: "\u4f7f\u7528\u30fb\u4e88\u7d04\u8cbb\u7528", remaining: "\u6b8b\u308a\u4e88\u7b97", unknown: "\u672a\u78ba\u8a8d", choices: "\u73fe\u5728\u306e\u9078\u629e\u80a2", ending: "\u30a8\u30f3\u30c7\u30a3\u30f3\u30b0", generating: "\u751f\u6210\u5f85\u3061\u30fb\u751f\u6210\u4e2d", noProgress: "\u81ea\u5206\u306e\u4fdd\u5b58\u9032\u884c\u306a\u3057", noScene: "\u73fe\u5728\u306e\u4fdd\u5b58\u5834\u9762\u306a\u3057",
      unauthenticated: "\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981", forbidden: "\u4f5c\u54c1\u306e\u6a29\u9650\u306a\u3057", notFound: "\u4f5c\u54c1\u30fb\u9032\u884c\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093", conflict: "\u9032\u884c\u30fb\u627f\u8a8d\u30fb\u8cbb\u7528\u306e\u518d\u78ba\u8a8d\u304c\u5fc5\u8981", invalid: "\u5fdc\u7b54\u78ba\u8a8d\u5931\u6557", transport: "\u63a5\u7d9a\u5931\u6557", server: "\u30b5\u30fc\u30d0\u30fc\u5fdc\u7b54\u5931\u6557", unavailable: "\u30c6\u30b9\u30c8\u5229\u7528\u4e0d\u53ef", hidden: ""
    },
    "zh-Hans": {
      title: "\u4f5c\u8005\u6b63\u6587\u6d4b\u8bd5", privacy: "\u79c1\u5bc6 \u00b7 \u4ec5\u6b63\u6587", refresh: "\u5237\u65b0\u6d4b\u8bd5\u72b6\u6001", retry: "\u786e\u8ba4\u4e0a\u6b21\u9009\u62e9\u56de\u6267",
      ready: "\u8bf7\u786e\u8ba4\u6d4b\u8bd5\u72b6\u6001\u3002", loading: "\u6b63\u5728\u786e\u8ba4\u72b6\u6001", submitting: "\u6b63\u5728\u63d0\u4ea4\u9009\u62e9", accepted: "\u9009\u62e9\u5df2\u63a5\u6536\u3002", uncertain: "\u9700\u8981\u786e\u8ba4\u63d0\u4ea4\u7ed3\u679c", unresolvedElsewhere: "\u9700\u8981\u786e\u8ba4\u4e0a\u4e00\u4f5c\u54c1\u7684\u9009\u62e9", noWork: "\u672a\u9009\u62e9\u4f5c\u54c1",
      generationFailed: "\u6b63\u6587\u751f\u6210\u5931\u8d25", generationTimeout: "\u6b63\u6587\u751f\u6210\u8d85\u65f6",
      approval_required: "\u9700\u8981\u767b\u8bb0\u6d4b\u8bd5\u6279\u51c6", approval_expired: "\u6279\u51c6\u5df2\u8fc7\u671f", release_changed: "\u6279\u51c6\u540e\u53d1\u5e03\u7248\u5df2\u53d8\u66f4", cost_unknown: "\u6709\u672a\u786e\u8ba4\u751f\u6210\u8d39\u7528", budget_over_limit: "\u8d85\u51fa\u6279\u51c6\u9884\u7b97", approval_recorded: "\u6d4b\u8bd5\u6279\u51c6\u5df2\u767b\u8bb0",
      approved: "\u6279\u51c6\u9884\u7b97", committed: "\u5df2\u7528\u53ca\u9884\u7559", remaining: "\u5269\u4f59\u9884\u7b97", unknown: "\u672a\u786e\u8ba4", choices: "\u5f53\u524d\u9009\u9879", ending: "\u7ed3\u5c40", generating: "\u7b49\u5f85\u751f\u6210\u6216\u751f\u6210\u4e2d", noProgress: "\u6ca1\u6709\u81ea\u5df1\u7684\u5df2\u4fdd\u5b58\u8fdb\u5ea6", noScene: "\u6ca1\u6709\u5df2\u4fdd\u5b58\u5f53\u524d\u573a\u666f",
      unauthenticated: "\u9700\u8981\u767b\u5f55", forbidden: "\u65e0\u6b64\u4f5c\u54c1\u6743\u9650", notFound: "\u672a\u627e\u5230\u4f5c\u54c1\u6216\u8fdb\u5ea6", conflict: "\u9700\u91cd\u65b0\u786e\u8ba4\u8fdb\u5ea6\u3001\u6279\u51c6\u6216\u8d39\u7528", invalid: "\u54cd\u5e94\u9a8c\u8bc1\u5931\u8d25", transport: "\u8fde\u63a5\u5931\u8d25", server: "\u670d\u52a1\u5668\u54cd\u5e94\u5931\u8d25", unavailable: "\u6682\u65f6\u65e0\u6cd5\u6d4b\u8bd5", hidden: ""
    },
    "zh-Hant": {
      title: "\u4f5c\u8005\u6b63\u6587\u6e2c\u8a66", privacy: "\u79c1\u5bc6 \u00b7 \u50c5\u6b63\u6587", refresh: "\u91cd\u65b0\u6574\u7406\u6e2c\u8a66\u72c0\u614b", retry: "\u78ba\u8a8d\u4e0a\u6b21\u9078\u64c7\u56de\u57f7",
      ready: "\u8acb\u78ba\u8a8d\u6e2c\u8a66\u72c0\u614b\u3002", loading: "\u6b63\u5728\u78ba\u8a8d\u72c0\u614b", submitting: "\u6b63\u5728\u63d0\u4ea4\u9078\u64c7", accepted: "\u9078\u64c7\u5df2\u63a5\u6536\u3002", uncertain: "\u9700\u8981\u78ba\u8a8d\u63d0\u4ea4\u7d50\u679c", unresolvedElsewhere: "\u9700\u8981\u78ba\u8a8d\u4e0a\u4e00\u4f5c\u54c1\u7684\u9078\u64c7", noWork: "\u672a\u9078\u64c7\u4f5c\u54c1",
      generationFailed: "\u6b63\u6587\u751f\u6210\u5931\u6557", generationTimeout: "\u6b63\u6587\u751f\u6210\u903e\u6642",
      approval_required: "\u9700\u8981\u767b\u8a18\u6e2c\u8a66\u6838\u51c6", approval_expired: "\u6838\u51c6\u5df2\u904e\u671f", release_changed: "\u6838\u51c6\u5f8c\u767c\u5e03\u7248\u5df2\u8b8a\u66f4", cost_unknown: "\u6709\u672a\u78ba\u8a8d\u751f\u6210\u8cbb\u7528", budget_over_limit: "\u8d85\u51fa\u6838\u51c6\u9810\u7b97", approval_recorded: "\u6e2c\u8a66\u6838\u51c6\u5df2\u767b\u8a18",
      approved: "\u6838\u51c6\u9810\u7b97", committed: "\u5df2\u7528\u53ca\u9810\u7559", remaining: "\u5269\u9918\u9810\u7b97", unknown: "\u672a\u78ba\u8a8d", choices: "\u76ee\u524d\u9078\u9805", ending: "\u7d50\u5c40", generating: "\u7b49\u5f85\u751f\u6210\u6216\u751f\u6210\u4e2d", noProgress: "\u6c92\u6709\u81ea\u5df1\u7684\u5df2\u5132\u5b58\u9032\u5ea6", noScene: "\u6c92\u6709\u5df2\u5132\u5b58\u76ee\u524d\u5834\u666f",
      unauthenticated: "\u9700\u8981\u767b\u5165", forbidden: "\u7121\u6b64\u4f5c\u54c1\u6b0a\u9650", notFound: "\u672a\u627e\u5230\u4f5c\u54c1\u6216\u9032\u5ea6", conflict: "\u9700\u91cd\u65b0\u78ba\u8a8d\u9032\u5ea6\u3001\u6838\u51c6\u6216\u8cbb\u7528", invalid: "\u56de\u61c9\u9a57\u8b49\u5931\u6557", transport: "\u9023\u7dda\u5931\u6557", server: "\u4f3a\u670d\u5668\u56de\u61c9\u5931\u6557", unavailable: "\u66ab\u6642\u7121\u6cd5\u6e2c\u8a66", hidden: ""
    }
  };
  function parseState(value, target) {
    const bad = () => { throw failure("invalid"); };
    if (!record(value) || !uuid(target?.workId) || value.contract !== "story-author-body-trial-state-v1" ||
        !uuid(value.workId) || value.workId.toLowerCase() !== target.workId.toLowerCase() || value.readOnly !== true ||
        value.generationAuthorized !== false || value.currentAuthorizationVerified !== false || value.imageGenerationStarted !== false || !states.includes(value.state)) bad();
    const base = { contract: value.contract, workId: value.workId.toLowerCase(), readOnly: true,
      generationAuthorized: false, currentAuthorizationVerified: false, imageGenerationStarted: false, state: value.state, approval: null, budget: null };
    if (value.state === "approval_required") {
      if (value.approval !== null || value.budget !== null) bad();
      return base;
    }
    const approval = value.approval, budget = value.budget;
    if (!record(approval) || !uuid(approval.id) || typeof approval.expiresAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(approval.expiresAt) ||
        !Number.isFinite(Date.parse(approval.expiresAt)) || new Date(approval.expiresAt).toISOString() !== approval.expiresAt || !record(budget)) bad();
    const amounts = ["knownActualCostKrw", "reservedMaximumCostKrw", "committedCostKrw", "approvedBudgetKrw"];
    const counts = ["requestCount", "pendingCount", "unknownCostCount", "verifiedSharedReuseCount"];
    if (amounts.some(key => !money(budget[key])) || counts.some(key => !count(budget[key])) ||
        budget.pendingCount + budget.verifiedSharedReuseCount > budget.requestCount ||
        budget.unknownCostCount + budget.verifiedSharedReuseCount > budget.requestCount ||
        budget.evidenceReadyForBudgetCheck !== (budget.unknownCostCount === 0)) bad();
    const cap = micros(budget.approvedBudgetKrw), committed = micros(budget.committedCostKrw), known = budget.unknownCostCount === 0;
    if (cap <= 0n || cap > 10000000000n || committed !== micros(budget.knownActualCostKrw) + micros(budget.reservedMaximumCostKrw) ||
        (known ? !money(budget.remainingBudgetKrw) || budget.remainingBudgetKrw !== fixed(cap > committed ? cap - committed : 0n) : budget.remainingBudgetKrw !== null) ||
        (value.state === "approval_recorded" && (!known || committed > cap)) ||
        (value.state === "cost_unknown" && known) || (value.state === "budget_over_limit" && (!known || committed <= cap))) bad();
    base.approval = { id: approval.id.toLowerCase(), expiresAt: approval.expiresAt };
    base.budget = Object.fromEntries([...amounts, ...counts, "remainingBudgetKrw", "evidenceReadyForBudgetCheck"].map(key => [key, budget[key]]));
    return base;
  }
  function parseReceipt(value, command) {
    const bad = () => { throw failure("invalid"); };
    const body = command?.body || command;
    if (!record(value) || !record(body) || !uuid(body.progressId) || !positive(body.expectedRevision) ||
        value.contract !== "story-author-body-trial-choice-v1" || value.imageGenerationStarted !== false ||
        typeof value.idempotentReplay !== "boolean" || value.revisionAfterRequest !== body.expectedRevision + 1) bad();
    const result = { contract: value.contract, imageGenerationStarted: false, idempotentReplay: value.idempotentReplay,
      revisionAfterRequest: value.revisionAfterRequest, status: value.status };
    if (value.continuationId === undefined) {
      if (!uuid(value.progressId) || value.progressId.toLowerCase() !== body.progressId.toLowerCase() ||
          value.generationStarted !== false || !["active", "completed"].includes(value.status)) bad();
      return { ...result, progressId: value.progressId.toLowerCase(), generationStarted: false };
    }
    if (!uuid(value.continuationId) || !["queued", "processing", "completed", "failed", "timeout"].includes(value.status) ||
        value.privateInputReturned !== false || value.providerPayloadReturned !== false || value.internalCostReturned !== false ||
        value.progressApplied !== (value.status === "completed") || !["ai_generated", "ai_reused"].includes(value.provenance) ||
        !(value.resultGeneratedSceneId === null || uuid(value.resultGeneratedSceneId)) ||
        (value.status === "completed" && value.resultGeneratedSceneId === null)) bad();
    return { ...result, continuationId: value.continuationId.toLowerCase(), progressApplied: value.progressApplied,
      resultGeneratedSceneId: value.resultGeneratedSceneId?.toLowerCase() || null, provenance: value.provenance };
  }
  async function readJson(response, limit, current) {
    const size = response.headers?.get?.("content-length");
    if (size && (!/^\d+$/.test(size) || Number(size) > limit)) {
      try { await response.body?.cancel?.(); } catch (_) { /* Reject oversized private data without consuming it. */ }
      throw failure("invalid");
    }
    let text;
    if (response.body?.getReader) {
      const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0; text = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (!current()) throw failure("invalid");
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > limit) throw failure("invalid");
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { try { await reader.cancel(); } catch (_) { /* A closed stream needs no cleanup. */ } }
    } else {
      text = await response.text();
      if (typeof text !== "string" || text.length > limit || new TextEncoder().encode(text).byteLength > limit) throw failure("invalid");
    }
    if (!current()) throw failure("invalid");
    try { return JSON.parse(text); } catch (_) { throw failure("invalid"); }
  }
  function createController({ fetch, identity, isCurrent, context, locale, visible, onChange = () => {}, onDispatch = () => {},
    makeIdempotencyKey = () => window.crypto.randomUUID() }) {
    let scope = null, ticket = 0, phase = "idle", messageKey = "ready", data = null, receipt = null, request = null, command = null;
    function readScope() {
      let owner = null, value = {}, shown = false, language = "ko", rawLocale = "", available = false;
      try {
        value = context() || {}; shown = visible() === true; rawLocale = locale(); language = locales.includes(rawLocale) ? rawLocale : "ko";
        owner = identity(); available = typeof fetch === "function" && typeof isCurrent === "function" && typeof window.LuminaCreatorBodyPreview?.parsePreview === "function";
        if (!record(owner) || typeof owner.ownerId !== "string" || !owner.ownerId.trim() || owner.ownerId.length > 320 ||
            /[\u0000-\u001f\u007f]/.test(owner.ownerId) || !count(owner.epoch) || !isCurrent(owner)) owner = null;
      } catch (_) { owner = null; }
      return { owner: owner ? { ownerId: owner.ownerId, epoch: owner.epoch } : null,
        workId: typeof value.workId === "string" ? value.workId.toLowerCase() : "", sourceLocale: value.locale,
        locale: language, rawLocale, visible: shown, available };
    }
    const initial = value => !value.visible ? "hidden" : !value.available ? "unavailable" : !value.owner ? "unauthenticated" :
      !value.workId ? "noWork" : !uuid(value.workId) || !locales.includes(value.sourceLocale) ? "invalid" : "ready";
    const busy = () => phase === "loading" || phase === "submitting";
    const accessible = () => scope && initial(scope) === "ready";
    const sameCommand = () => command && accessible() && command.ownerId === scope.owner.ownerId &&
      command.workId === scope.workId && command.body.locale === scope.sourceLocale;
    const canChoose = () => accessible() && phase === "ready" && !command && data?.approvalState.state === "approval_recorded" &&
      Date.parse(data.approvalState.approval.expiresAt) > Date.now() && data.preview.progress?.status === "active" &&
      data.preview.progress.scene && !data.preview.progress.scene.endingType && data.preview.progress.choices.length > 0;
    function state() {
      return clone({ ticket, phase, messageKey, locale: scope?.locale || "ko", data, receipt, busy: busy(),
        canLoad: Boolean(accessible() && !busy()), canChoose: Boolean(canChoose()), canRetry: Boolean(sameCommand() && !busy()), unresolved: Boolean(command) });
    }
    const emit = () => onChange(state());
    function clear() {
      ticket++; data = null; receipt = null; phase = "idle";
      const old = request; request = null; old?.abort();
      // An aborted POST may already have committed. Keep its exact key until a verified receipt.
    }
    function setInitialMessage() {
      messageKey = initial(scope);
      if (messageKey === "ready" && command) { phase = "uncertain"; messageKey = sameCommand() ? "uncertain" : "unresolvedElsewhere"; }
    }
    function syncContext(notify = true) {
      const next = readScope();
      if (JSON.stringify(scope) === JSON.stringify(next)) return false;
      clear(); scope = next; setInitialMessage(); if (notify) emit(); return true;
    }
    function invalidate() { clear(); scope = readScope(); setInitialMessage(); emit(); }
    function snapshot() { syncContext(); return state(); }
    function start(nextPhase, nextMessage) {
      phase = nextPhase; messageKey = nextMessage; receipt = null;
      const ownTicket = ++ticket, owner = { ...scope.owner }, abort = new AbortController();
      request = abort;
      const current = () => { syncContext(); return ticket === ownTicket; };
      return { owner, abort, current };
    }
    const errorKey = status => ({ 400: "invalid", 401: "unauthenticated", 403: "forbidden", 404: "notFound", 409: "conflict" })[status] || (status >= 500 ? "server" : "unavailable");
    async function responseValue(url, options, active, limit) {
      if (!active.current()) throw failure("invalid");
      if (options.method === "POST") onDispatch();
      if (!active.current()) throw failure("invalid");
      const response = await fetch(url, { ...options, identity: active.owner, _retried: true, cache: "no-store",
        headers: { "Cache-Control": "no-store", ...options.headers }, signal: active.abort.signal });
      if (!active.current()) { try { await response?.body?.cancel?.(); } catch (_) {} throw failure("invalid"); }
      if (!response || !Number.isInteger(response.status)) throw failure("invalid");
      if (response.status < 200 || response.status > 201 || (options.method === "GET" && response.status !== 200)) {
        try { await response.body?.cancel?.(); } catch (_) { /* Never display server diagnostics or private payloads. */ }
        throw Object.assign(failure(errorKey(response.status)), { status: response.status });
      }
      return readJson(response, limit, active.current);
    }
    async function load(expectedTicket = null) {
      syncContext();
      if ((expectedTicket !== null && expectedTicket !== ticket) || !accessible() || busy()) return false;
      data = null;
      const target = { workId: scope.workId, locale: scope.sourceLocale }, active = start("loading", "loading"); emit();
      try {
        const root = "/api/v1/me/creator-studio/stories/" + encodeURIComponent(target.workId);
        const approvalState = parseState(await responseValue(root + "/body-trial-state", { method: "GET" }, active, 16384), target);
        if (!active.current()) return false;
        const preview = window.LuminaCreatorBodyPreview.parsePreview(await responseValue(root + "/body-preview?locale=" + encodeURIComponent(target.locale),
          { method: "GET" }, active, 256 * 1024), target);
        if (!active.current()) return false;
        data = { approvalState, preview }; request = null; phase = command ? "uncertain" : "ready";
        const progress = preview.progress;
        messageKey = command ? sameCommand() ? "uncertain" : "unresolvedElsewhere" : approvalState.state !== "approval_recorded" ? approvalState.state :
          !progress ? "noProgress" : progress.status === "completed" || progress.scene?.endingType ? "ending" :
          progress.status !== "active" ? "generating" : !progress.scene ? "noScene" : "approval_recorded";
        emit(); return true;
      } catch (error) {
        if (!active.current()) return false;
        data = null; request = null; phase = command ? "uncertain" : "error";
        messageKey = command ? sameCommand() ? "uncertain" : "unresolvedElsewhere" : copy.ko[error?.kind] !== undefined ? error.kind : "transport";
        emit(); return false;
      }
    }
    async function submit(replaying) {
      const active = start("submitting", "submitting"), sending = command; data = null; emit();
      try {
        const value = await responseValue("/api/v1/me/creator-studio/stories/" + encodeURIComponent(sending.workId) +
          "/body-trial/choices/" + encodeURIComponent(sending.choiceId), { method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": sending.key }, body: JSON.stringify(sending.body) }, active, 16384);
        if (!active.current()) return false;
        receipt = parseReceipt(value, sending); command = null; phase = "accepted"; request = null;
        messageKey = receipt.status === "failed" ? "generationFailed" : receipt.status === "timeout" ? "generationTimeout" :
          ["queued", "processing"].includes(receipt.status) ? "generating" :
          receipt.generationStarted === false && receipt.status === "completed" ? "ending" : "accepted";
        emit(); return true;
      } catch (error) {
        if (!active.current()) return false;
        const rejected = !replaying && [400, 401, 403, 404, 409, 422].includes(error?.status);
        if (rejected) command = null;
        request = null; phase = rejected ? "error" : "uncertain";
        messageKey = rejected ? error.kind : "uncertain"; emit(); return false;
      }
    }
    async function choose(choiceId, expectedTicket = null) {
      syncContext();
      if ((expectedTicket !== null && expectedTicket !== ticket) || !canChoose() || !uuid(choiceId)) return false;
      const choice = data.preview.progress.choices.find(value => value.id === choiceId.toLowerCase());
      if (!choice) return false;
      let key;
      try { key = makeIdempotencyKey(); } catch (_) { key = null; }
      if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,120}$/.test(key)) {
        data = null; phase = "error"; messageKey = "unavailable"; emit(); return false;
      }
      command = { ownerId: scope.owner.ownerId, workId: scope.workId, choiceId: choice.id, key,
        body: { approvalId: data.approvalState.approval.id, progressId: data.preview.progress.progressId,
          expectedRevision: data.preview.progress.revision, locale: scope.sourceLocale } };
      return submit(false);
    }
    async function retry(expectedTicket = null) {
      syncContext();
      if ((expectedTicket !== null && expectedTicket !== ticket) || !sameCommand() || busy()) return false;
      return submit(true);
    }
    syncContext(false);
    return { snapshot, syncContext, invalidate, load, choose, retry };
  }
  function mount(host) {
    if (!host || host.dataset.bodyTrialMounted) return null;
    const shell = document.getElementById("studioShell"), section = document.getElementById("writer-manuscript");
    if (!shell || !section) return null;
    host.dataset.bodyTrialMounted = "true";
    const element = (tag, className, text) => {
      const node = document.createElement(tag); if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const header = element("header", "body-trial-header"), heading = element("div"), title = element("h3"), privacy = element("p", "body-trial-private");
    title.id = "writerBodyTrialTitle"; heading.append(title, privacy);
    const tools = element("div", "body-trial-tools");
    function iconButton(name) {
      const button = element("button", "body-trial-tool"); button.type = "button";
      let icon;
      try { if (window.lucide?.icons?.[name]) icon = window.lucide.createElement(window.lucide.icons[name]); } catch (_) {}
      if (!icon) icon = element("span", "", name === "RefreshCw" ? "\u21bb" : "\u21a9");
      icon.setAttribute("aria-hidden", "true"); button.append(icon); tools.append(button); return button;
    }
    const refresh = iconButton("RefreshCw"), retry = iconButton("RotateCcw");
    refresh.id = "writerBodyTrialRefresh"; retry.id = "writerBodyTrialRetry";
    header.append(heading, tools);
    const status = element("p", "body-trial-state"), content = element("div", "body-trial-content");
    status.id = "writerBodyTrialState"; content.id = "writerBodyTrialContent";
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); host.replaceChildren(header, status, content);
    const visible = () => !shell.hidden && !section.hidden && !host.hidden && section.classList.contains("is-active") && document.visibilityState !== "hidden";
    const formatMoney = value => {
      const [whole, fraction] = value.split(".");
      const suffix = fraction.replace(/0+$/, "");
      return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (suffix ? "." + suffix : "") + " KRW";
    };
    let controller;
    function render(state) {
      const words = copy[state.locale]; title.textContent = words.title; privacy.textContent = words.privacy;
      host.lang = state.locale; host.setAttribute("aria-busy", String(state.busy));
      for (const [button, label, enabled] of [[refresh, words.refresh, state.canLoad], [retry, words.retry, state.canRetry]]) {
        button.title = label; button.setAttribute("aria-label", label); button.disabled = !enabled;
      }
      retry.hidden = !state.unresolved;
      status.textContent = words[state.messageKey]; status.className = "body-trial-state" + (["error", "uncertain"].includes(state.phase) ? " is-error" : "");
      content.replaceChildren();
      const budget = state.data?.approvalState.budget;
      if (budget) {
        const metadata = element("dl", "body-trial-budget");
        for (const [label, value] of [[words.approved, budget.approvedBudgetKrw], [words.committed, budget.committedCostKrw], [words.remaining, budget.remainingBudgetKrw]]) {
          const row = element("div"); row.append(element("dt", "", label), element("dd", "", value === null ? words.unknown : formatMoney(value))); metadata.append(row);
        }
        content.append(metadata);
      }
      const progress = state.data?.preview.progress;
      if (!progress) return;
      const source = element("div", "body-trial-source"); source.lang = state.data.preview.locale;
      if (progress.scene) {
        source.append(element("h4", "", progress.scene.title));
        for (const beat of progress.scene.beats) source.append(element("p", "body-trial-beat", beat.content));
      }
      if (progress.choices.length) {
        const choices = element("ol", "body-trial-choices"); source.append(element("h4", "", words.choices), choices);
        for (const choice of progress.choices) {
          const item = element("li"), button = element("button", "body-trial-choice", choice.label);
          button.type = "button"; button.disabled = !state.canChoose;
          const capturedTicket = state.ticket;
          button.addEventListener("click", () => { if (!button.disabled) return controller.choose(choice.id, capturedTicket); });
          item.append(button); choices.append(item);
        }
      }
      content.append(source);
    }
    controller = createController({
      fetch: (url, options) => {
        const auth = window.getAuth?.();
        const accessToken = auth?.accessToken || auth?.access_token || auth?.token || auth?.tokens?.accessToken || auth?.tokens?.access_token;
        if (typeof accessToken !== "string" || !accessToken) throw failure("unauthenticated");
        // The shared studio API serializes structured bodies itself.
        const forwarded = { ...options, token: accessToken };
        if (options.method === "POST") forwarded.body = JSON.parse(options.body);
        return window.LuminaCreatorStudioApi.fetch(url, forwarded);
      },
      identity: () => window.LuminaCreatorStudioApi?.identity?.(),
      isCurrent: owner => typeof window.LuminaCreatorStudioApi?.fetch === "function" && window.LuminaCreatorStudioApi?.isCurrent?.(owner) === true,
      context: () => ({ workId: document.getElementById("writerManuscriptWork")?.value || "", locale: document.getElementById("writerManuscriptLocale")?.value || "" }),
      locale: () => window.luminaI18n?.getLocale?.() || document.documentElement.lang || "ko", visible, onChange: render,
      onDispatch: () => window.dispatchEvent(new Event("lumina:author-body-trial-progress-changed"))
    });
    refresh.addEventListener("click", () => { if (!refresh.disabled) return controller.load(controller.snapshot().ticket); });
    retry.addEventListener("click", () => { if (!retry.disabled) return controller.retry(controller.snapshot().ticket); });
    const sync = () => controller.syncContext(), erase = () => controller.invalidate();
    for (const name of ["storage", "lumina:authchange", "lumina:auth-expired", "pagehide"]) window.addEventListener(name, erase);
    for (const name of ["focus", "lumina:localechange", "pageshow"]) window.addEventListener(name, sync);
    document.addEventListener("lumina:auth-expired", erase); document.addEventListener("visibilitychange", erase);
    for (const id of ["writerManuscriptWork", "writerManuscriptLocale"]) {
      const control = document.getElementById(id);
      for (const name of ["input", "change"]) control?.addEventListener(name, erase);
    }
    document.addEventListener("click", event => {
      const target = event.target.closest?.("[data-section]");
      if (target && target.getAttribute("data-section") !== "writer-manuscript") erase();
    }, true);
    if (typeof MutationObserver === "function") {
      for (const [node, attributes] of [[section, ["class", "hidden", "style"]], [shell, ["hidden"]], [host, ["hidden"]], [document.documentElement, ["lang"]]]) {
        new MutationObserver(erase).observe(node, { attributes: true, attributeFilter: attributes });
      }
      for (const id of ["writerManuscriptWork", "writerManuscriptLocale"]) {
        const control = document.getElementById(id);
        if (control) new MutationObserver(sync).observe(control, { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "selected"] });
      }
    }
    render(controller.snapshot()); return controller;
  }
  window.LuminaCreatorBodyTrial = { createController, parseState, parseReceipt, mount, copy };
  if (typeof document !== "undefined") mount(document.getElementById("writerBodyTrial"));
})();
