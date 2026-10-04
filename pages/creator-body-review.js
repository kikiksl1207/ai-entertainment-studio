(function () {
  "use strict";
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const fields = ["styleReviewed", "charactersReviewed", "timelineReviewed"];
  const flags = ["generationStarted", "imageGenerationStarted", "publicationStarted", "sharedReuseAuthorized"];
  const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
  const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const positive = value => Number.isSafeInteger(value) && value > 0;
  const clone = value => JSON.parse(JSON.stringify(value));
  const failure = kind => Object.assign(new Error("Private body review unavailable"), { kind });
  const rejectionCodes = {
    review: ["STORY_AUTHOR_BODY_REVIEW_SOURCE_CHANGED", "STORY_AUTHOR_BODY_REVIEW_HEAD_CHANGED"],
    withdraw: ["STORY_AUTHOR_BODY_REVIEW_ALREADY_WITHDRAWN"]
  };
  function definitiveRejection(value, status, command) {
    return status === 409 && record(value) && value.success === false && record(value.error) &&
      value.error.statusCode === status && value.error.path === command?.url &&
      rejectionCodes[command?.kind]?.includes(value.error.code) === true &&
      (!Object.hasOwn(value.error, "message") || typeof value.error.message === "string") &&
      (!Object.hasOwn(value.error, "timestamp") || iso(value.error.timestamp));
  }
  // Keep uncertain commands across auth changes and unmounts, without retaining private prose.
  const commands = new Map(), maxCommands = 16, mounts = new WeakMap();
  const copy = {
    ko: {
      title: "\ube44\uacf5\uac1c \ubcf8\ubb38 \uac80\ud1a0", privacy: "\uacf5\uac1c\u00b7\uacf5\uc720 \uc7ac\uc0ac\uc6a9 \ud5c8\uac00\ub294 \ubcc4\ub3c4",
      refresh: "\uac80\ud1a0 \uc0c1\ud0dc \uc0c8\ub85c\uace0\uce68", retry: "\uc774\uc804 \uac80\ud1a0 \uc811\uc218 \ud655\uc778", approve: "\ubcf8\ubb38 \uc2b9\uc778", reject: "\ubcf8\ubb38 \ubc18\ub824", withdraw: "\uac80\ud1a0 \ucca0\ud68c",
      scope: "\uc0dd\uc131 \ubcf8\ubb38 \uac80\ud1a0", styleReviewed: "\ubb38\uccb4 \uac80\ud1a0\ud568", charactersReviewed: "\uc778\ubb3c \uc77c\uad00\uc131 \uac80\ud1a0\ud568", timelineReviewed: "\uc2dc\uac04\uc120 \uac80\ud1a0\ud568",
      ready: "\uac80\ud1a0 \uc0c1\ud0dc \ud655\uc778 \ud544\uc694", loading: "\uac80\ud1a0 \uc0c1\ud0dc \ud655\uc778 \uc911", submitting: "\uac80\ud1a0 \uc811\uc218 \uc911", reviewable: "\uac80\ud1a0 \uac00\ub2a5", not_generated: "\uc0dd\uc131\ub41c \ubcf8\ubb38 \uc5c6\uc74c", generation_pending: "\ubcf8\ubb38 \uc0dd\uc131 \ub300\uae30 \ub610\ub294 \uc9c4\ud589 \uc911", ending: "\uc5d4\ub529",
      source_changed: "\uc6d0\ubcf8 \ubcc0\uacbd \u00b7 \uc774\uc804 \uac80\ud1a0\ub294 \ud604\uc7ac \ubcf8\ubb38\uc5d0 \uc801\uc6a9\ub418\uc9c0 \uc54a\uc74c",
      uncertain: "\uac80\ud1a0 \uc811\uc218 \uacb0\uacfc \ud655\uc778 \ud544\uc694", unresolvedElsewhere: "\uc774\uc804 \uc791\ud488\u00b7\uc6d0\ubb38 \uc5b8\uc5b4\uc758 \uac80\ud1a0 \uc811\uc218 \ud655\uc778 \ud544\uc694",
      current: "\ud604\uc7ac \ubcf8\ubb38 \uac80\ud1a0", stale: "\ubcc0\uacbd \uc804 \ubcf8\ubb38 \uac80\ud1a0", superseded: "\ub300\uccb4\ub41c \uac80\ud1a0", withdrawn: "\ucca0\ud68c\ub41c \uac80\ud1a0", approved: "\uc2b9\uc778", rejected: "\ubc18\ub824",
      receipt: "\uac80\ud1a0 \uc811\uc218 \ud655\uc778\ub428", noWork: "\uc120\ud0dd\ub41c \uc791\ud488 \uc5c6\uc74c", unauthenticated: "\ub85c\uadf8\uc778 \ud544\uc694", forbidden: "\uc791\ud488 \uad8c\ud55c \uc5c6\uc74c", notFound: "\uc791\ud488\u00b7\uac80\ud1a0 \ucc3e\uc744 \uc218 \uc5c6\uc74c", conflict: "\ubcf8\ubb38\u00b7\uac80\ud1a0 \uc0c1\ud0dc \uc7ac\ud655\uc778 \ud544\uc694", invalid: "\uc751\ub2f5 \ud655\uc778 \uc2e4\ud328", transport: "\uc5f0\uacb0 \uc2e4\ud328", server: "\uc11c\ubc84 \uc751\ub2f5 \uc2e4\ud328", unavailable: "\uac80\ud1a0 \uc774\uc6a9 \ubd88\uac00", hidden: ""
    },
    en: {
      title: "Private body review", privacy: "Publication and shared reuse permission are separate",
      refresh: "Refresh review state", retry: "Check previous review receipt", approve: "Approve body", reject: "Reject body", withdraw: "Withdraw review",
      scope: "Generated body review", styleReviewed: "Style reviewed", charactersReviewed: "Character consistency reviewed", timelineReviewed: "Timeline reviewed",
      ready: "Review state needs checking", loading: "Checking review state", submitting: "Submitting review", reviewable: "Ready for review", not_generated: "No generated body", generation_pending: "Body generation pending or in progress", ending: "Ending",
      source_changed: "Source changed; earlier review does not apply to the current body",
      uncertain: "Review receipt needs checking", unresolvedElsewhere: "A previous story or source language's review receipt needs checking",
      current: "Current body review", stale: "Review of an earlier body", superseded: "Superseded review", withdrawn: "Withdrawn review", approved: "Approved", rejected: "Rejected",
      receipt: "Review receipt verified", noWork: "No story selected", unauthenticated: "Sign-in required", forbidden: "No permission for this story", notFound: "Story or review not found", conflict: "Body or review state needs checking", invalid: "Response verification failed", transport: "Connection failed", server: "Server response failed", unavailable: "Review unavailable", hidden: ""
    },
    ja: {
      title: "\u975e\u516c\u958b\u672c\u6587\u306e\u30ec\u30d3\u30e5\u30fc", privacy: "\u516c\u958b\u30fb\u5171\u6709\u518d\u5229\u7528\u306e\u8a31\u53ef\u306f\u5225\u9014",
      refresh: "\u30ec\u30d3\u30e5\u30fc\u72b6\u614b\u3092\u66f4\u65b0", retry: "\u524d\u306e\u30ec\u30d3\u30e5\u30fc\u306e\u53d7\u4ed8\u3092\u78ba\u8a8d", approve: "\u672c\u6587\u3092\u627f\u8a8d", reject: "\u672c\u6587\u3092\u5374\u4e0b", withdraw: "\u30ec\u30d3\u30e5\u30fc\u3092\u64a4\u56de",
      scope: "\u751f\u6210\u672c\u6587\u306e\u30ec\u30d3\u30e5\u30fc", styleReviewed: "\u6587\u4f53\u3092\u78ba\u8a8d\u6e08\u307f", charactersReviewed: "\u767b\u5834\u4eba\u7269\u306e\u4e00\u8cab\u6027\u3092\u78ba\u8a8d\u6e08\u307f", timelineReviewed: "\u6642\u7cfb\u5217\u3092\u78ba\u8a8d\u6e08\u307f",
      ready: "\u30ec\u30d3\u30e5\u30fc\u72b6\u614b\u306e\u78ba\u8a8d\u304c\u5fc5\u8981", loading: "\u72b6\u614b\u3092\u78ba\u8a8d\u4e2d", submitting: "\u30ec\u30d3\u30e5\u30fc\u53d7\u4ed8\u4e2d", reviewable: "\u30ec\u30d3\u30e5\u30fc\u53ef\u80fd", not_generated: "\u751f\u6210\u672c\u6587\u306a\u3057", generation_pending: "\u672c\u6587\u751f\u6210\u5f85\u3061\u30fb\u751f\u6210\u4e2d", ending: "\u30a8\u30f3\u30c7\u30a3\u30f3\u30b0",
      source_changed: "\u539f\u6587\u5909\u66f4\u6e08\u307f\u30fb\u524d\u306e\u30ec\u30d3\u30e5\u30fc\u306f\u73fe\u5728\u306e\u672c\u6587\u306b\u9069\u7528\u3055\u308c\u307e\u305b\u3093",
      uncertain: "\u30ec\u30d3\u30e5\u30fc\u53d7\u4ed8\u7d50\u679c\u306e\u78ba\u8a8d\u304c\u5fc5\u8981", unresolvedElsewhere: "\u524d\u306e\u4f5c\u54c1\u30fb\u539f\u6587\u8a00\u8a9e\u306e\u53d7\u4ed8\u78ba\u8a8d\u304c\u5fc5\u8981",
      current: "\u73fe\u5728\u306e\u672c\u6587\u30ec\u30d3\u30e5\u30fc", stale: "\u5909\u66f4\u524d\u306e\u672c\u6587\u30ec\u30d3\u30e5\u30fc", superseded: "\u7f6e\u63db\u6e08\u307f\u30ec\u30d3\u30e5\u30fc", withdrawn: "\u64a4\u56de\u6e08\u307f\u30ec\u30d3\u30e5\u30fc", approved: "\u627f\u8a8d", rejected: "\u5374\u4e0b",
      receipt: "\u53d7\u4ed8\u78ba\u8a8d\u6e08\u307f", noWork: "\u4f5c\u54c1\u672a\u9078\u629e", unauthenticated: "\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981", forbidden: "\u4f5c\u54c1\u306e\u6a29\u9650\u306a\u3057", notFound: "\u4f5c\u54c1\u30fb\u30ec\u30d3\u30e5\u30fc\u306a\u3057", conflict: "\u672c\u6587\u30fb\u30ec\u30d3\u30e5\u30fc\u306e\u518d\u78ba\u8a8d\u304c\u5fc5\u8981", invalid: "\u5fdc\u7b54\u78ba\u8a8d\u5931\u6557", transport: "\u63a5\u7d9a\u5931\u6557", server: "\u30b5\u30fc\u30d0\u30fc\u5fdc\u7b54\u5931\u6557", unavailable: "\u30ec\u30d3\u30e5\u30fc\u5229\u7528\u4e0d\u53ef", hidden: ""
    },
    "zh-Hans": {
      title: "\u79c1\u5bc6\u6b63\u6587\u5ba1\u6838", privacy: "\u53d1\u5e03\u548c\u5171\u4eab\u590d\u7528\u8bb8\u53ef\u9700\u53e6\u884c\u6388\u6743",
      refresh: "\u5237\u65b0\u5ba1\u6838\u72b6\u6001", retry: "\u786e\u8ba4\u4e0a\u6b21\u5ba1\u6838\u56de\u6267", approve: "\u6279\u51c6\u6b63\u6587", reject: "\u9a73\u56de\u6b63\u6587", withdraw: "\u64a4\u56de\u5ba1\u6838",
      scope: "\u751f\u6210\u6b63\u6587\u5ba1\u6838", styleReviewed: "\u5df2\u5ba1\u6838\u6587\u98ce", charactersReviewed: "\u5df2\u5ba1\u6838\u4eba\u7269\u4e00\u81f4\u6027", timelineReviewed: "\u5df2\u5ba1\u6838\u65f6\u95f4\u7ebf",
      ready: "\u9700\u8981\u786e\u8ba4\u5ba1\u6838\u72b6\u6001", loading: "\u6b63\u5728\u786e\u8ba4\u5ba1\u6838\u72b6\u6001", submitting: "\u6b63\u5728\u63d0\u4ea4\u5ba1\u6838", reviewable: "\u53ef\u5ba1\u6838", not_generated: "\u65e0\u751f\u6210\u6b63\u6587", generation_pending: "\u6b63\u6587\u7b49\u5f85\u751f\u6210\u6216\u751f\u6210\u4e2d", ending: "\u7ed3\u5c40",
      source_changed: "\u539f\u6587\u5df2\u66f4\u6539\uff1b\u65e7\u5ba1\u6838\u4e0d\u9002\u7528\u4e8e\u5f53\u524d\u6b63\u6587",
      uncertain: "\u9700\u8981\u786e\u8ba4\u5ba1\u6838\u56de\u6267", unresolvedElsewhere: "\u9700\u8981\u786e\u8ba4\u4e0a\u4e00\u4f5c\u54c1\u6216\u539f\u6587\u8bed\u8a00\u7684\u5ba1\u6838\u56de\u6267",
      current: "\u5f53\u524d\u6b63\u6587\u5ba1\u6838", stale: "\u65e7\u6b63\u6587\u5ba1\u6838", superseded: "\u5df2\u66ff\u4ee3\u7684\u5ba1\u6838", withdrawn: "\u5df2\u64a4\u56de\u7684\u5ba1\u6838", approved: "\u5df2\u6279\u51c6", rejected: "\u5df2\u9a73\u56de",
      receipt: "\u5ba1\u6838\u56de\u6267\u5df2\u786e\u8ba4", noWork: "\u672a\u9009\u62e9\u4f5c\u54c1", unauthenticated: "\u9700\u8981\u767b\u5f55", forbidden: "\u65e0\u4f5c\u54c1\u6743\u9650", notFound: "\u672a\u627e\u5230\u4f5c\u54c1\u6216\u5ba1\u6838", conflict: "\u9700\u8981\u91cd\u65b0\u786e\u8ba4\u6b63\u6587\u6216\u5ba1\u6838\u72b6\u6001", invalid: "\u54cd\u5e94\u9a8c\u8bc1\u5931\u8d25", transport: "\u8fde\u63a5\u5931\u8d25", server: "\u670d\u52a1\u5668\u54cd\u5e94\u5931\u8d25", unavailable: "\u5ba1\u6838\u4e0d\u53ef\u7528", hidden: ""
    },
    "zh-Hant": {
      title: "\u79c1\u5bc6\u6b63\u6587\u5be9\u6838", privacy: "\u767c\u5e03\u548c\u5171\u4eab\u518d\u5229\u7528\u8a31\u53ef\u9700\u53e6\u884c\u6388\u6b0a",
      refresh: "\u91cd\u65b0\u6574\u7406\u5be9\u6838\u72c0\u614b", retry: "\u78ba\u8a8d\u4e0a\u6b21\u5be9\u6838\u56de\u57f7", approve: "\u6838\u51c6\u6b63\u6587", reject: "\u99c1\u56de\u6b63\u6587", withdraw: "\u64a4\u56de\u5be9\u6838",
      scope: "\u751f\u6210\u6b63\u6587\u5be9\u6838", styleReviewed: "\u5df2\u5be9\u6838\u6587\u98a8", charactersReviewed: "\u5df2\u5be9\u6838\u4eba\u7269\u4e00\u81f4\u6027", timelineReviewed: "\u5df2\u5be9\u6838\u6642\u9593\u7dda",
      ready: "\u9700\u8981\u78ba\u8a8d\u5be9\u6838\u72c0\u614b", loading: "\u6b63\u5728\u78ba\u8a8d\u5be9\u6838\u72c0\u614b", submitting: "\u6b63\u5728\u63d0\u4ea4\u5be9\u6838", reviewable: "\u53ef\u5be9\u6838", not_generated: "\u7121\u751f\u6210\u6b63\u6587", generation_pending: "\u6b63\u6587\u7b49\u5f85\u751f\u6210\u6216\u751f\u6210\u4e2d", ending: "\u7d50\u5c40",
      source_changed: "\u539f\u6587\u5df2\u8b8a\u66f4\uff1b\u820a\u5be9\u6838\u4e0d\u9069\u7528\u65bc\u76ee\u524d\u6b63\u6587",
      uncertain: "\u9700\u8981\u78ba\u8a8d\u5be9\u6838\u56de\u57f7", unresolvedElsewhere: "\u9700\u8981\u78ba\u8a8d\u4e0a\u4e00\u4f5c\u54c1\u6216\u539f\u6587\u8a9e\u8a00\u7684\u5be9\u6838\u56de\u57f7",
      current: "\u76ee\u524d\u6b63\u6587\u5be9\u6838", stale: "\u820a\u6b63\u6587\u5be9\u6838", superseded: "\u5df2\u53d6\u4ee3\u7684\u5be9\u6838", withdrawn: "\u5df2\u64a4\u56de\u7684\u5be9\u6838", approved: "\u5df2\u6838\u51c6", rejected: "\u5df2\u99c1\u56de",
      receipt: "\u5be9\u6838\u56de\u57f7\u5df2\u78ba\u8a8d", noWork: "\u672a\u9078\u64c7\u4f5c\u54c1", unauthenticated: "\u9700\u8981\u767b\u5165", forbidden: "\u7121\u4f5c\u54c1\u6b0a\u9650", notFound: "\u672a\u627e\u5230\u4f5c\u54c1\u6216\u5be9\u6838", conflict: "\u9700\u8981\u91cd\u65b0\u78ba\u8a8d\u6b63\u6587\u6216\u5be9\u6838\u72c0\u614b", invalid: "\u56de\u61c9\u9a57\u8b49\u5931\u6557", transport: "\u9023\u7dda\u5931\u6557", server: "\u4f3a\u670d\u5668\u56de\u61c9\u5931\u6557", unavailable: "\u5be9\u6838\u4e0d\u53ef\u7528", hidden: ""
    }
  };
  function iso(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
    const day = value.slice(0, 10), time = value.slice(11, 19);
    return new Date(day + "T" + time + "Z").toISOString().slice(0, 19) === day + "T" + time;
  }
  function parseRow(value) {
    if (!record(value) || !uuid(value.id) || !locales.includes(value.locale) || !positive(value.version) || !["approve", "reject"].includes(value.decision) ||
        fields.some(key => typeof value[key] !== "boolean") ||
        (value.decision === "approve" ? !fields.every(key => value[key]) : !fields.some(key => value[key])) ||
        !iso(value.createdAt) || !(value.withdrawnAt === null || iso(value.withdrawnAt)) ||
        (value.withdrawnAt !== null && Date.parse(value.withdrawnAt) < Date.parse(value.createdAt)) ||
        !["current", "stale", "superseded", "withdrawn"].includes(value.applicability) ||
        (value.applicability === "withdrawn") !== (value.withdrawnAt !== null)) throw failure("invalid");
    return { id: value.id.toLowerCase(), locale: value.locale, version: value.version, decision: value.decision,
      ...Object.fromEntries(fields.map(key => [key, value[key]])), createdAt: value.createdAt,
      withdrawnAt: value.withdrawnAt, applicability: value.applicability };
  }
  function envelope(value, target) {
    if (!record(value) || !uuid(target?.workId) || !locales.includes(target.locale) ||
        value.contract !== "story-author-body-review-v1" || !uuid(value.workId) ||
        value.workId.toLowerCase() !== target.workId.toLowerCase() || value.locale !== target.locale ||
        flags.some(key => value[key] !== false)) throw failure("invalid");
    return { contract: value.contract, workId: value.workId.toLowerCase(), locale: value.locale,
      ...Object.fromEntries(flags.map(key => [key, false])) };
  }
  function parseReview(value, scope) {
    const result = envelope(value, scope);
    if (value.readOnly !== true || !["reviewable", "not_generated", "generation_pending", "source_changed"].includes(value.state) ||
        (value.state === "reviewable" ? !record(value.target) : value.target !== null)) throw failure("invalid");
    let target = null;
    if (value.target !== null) {
      const item = value.target;
      if (!uuid(item.progressId) || !positive(item.progressRevision) || !uuid(item.sceneId) ||
          !hash(item.sourceBindingHash) || !hash(item.bodyChecksum) || typeof item.ending !== "boolean") throw failure("invalid");
      target = { progressId: item.progressId.toLowerCase(), progressRevision: item.progressRevision, sceneId: item.sceneId.toLowerCase(),
        sourceBindingHash: item.sourceBindingHash, bodyChecksum: item.bodyChecksum, ending: item.ending };
    }
    const latestReview = value.latestReview === null ? null : parseRow(value.latestReview);
    if ((latestReview?.applicability === "current" && (!target || latestReview.locale !== result.locale)) ||
        (value.state === "source_changed" && latestReview && !["stale", "withdrawn"].includes(latestReview.applicability))) throw failure("invalid");
    return { ...result, readOnly: true, state: value.state, target, latestReview };
  }
  function parseReceipt(value, command) {
    const scope = { workId: command?.workId, locale: command?.receiptLocale || command?.body?.locale || command?.locale };
    const result = envelope(value, scope), review = parseRow(value.review);
    if (typeof value.idempotentReplay !== "boolean" || review.locale !== result.locale) throw failure("invalid");
    if (command?.kind === "withdraw" || command?.reviewId) {
      if (!uuid(command.reviewId) || review.id !== command.reviewId.toLowerCase() || review.withdrawnAt === null) throw failure("invalid");
    } else if (command?.body) {
      const body = command.body;
      if (!hash(body.sourceBindingHash) || !positive(body.expectedProgressRevision) ||
          !(body.expectedReviewId === null || uuid(body.expectedReviewId)) || review.decision !== body.decision ||
          fields.some(key => typeof body[key] !== "boolean" || body[key] !== review[key]) ||
          (!value.idempotentReplay && review.withdrawnAt !== null)) throw failure("invalid");
    }
    return { ...result, idempotentReplay: value.idempotentReplay, review };
  }
  async function readJson(response, limit, current) {
    const size = response.headers?.get?.("content-length");
    if (size && (!/^\d+$/.test(size) || Number(size) > limit)) {
      try { await response.body?.cancel?.(); } catch (_) {}
      throw failure("invalid");
    }
    let text = "";
    if (typeof response.body?.getReader === "function") {
      const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (!current()) throw failure("invalid");
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > limit) throw failure("invalid");
          try { text += decoder.decode(chunk.value, { stream: true }); } catch (_) { throw failure("invalid"); }
        }
        try { text += decoder.decode(); } catch (_) { throw failure("invalid"); }
      } finally {
        try { await reader.cancel(); } catch (_) {}
        reader.releaseLock?.();
      }
    } else {
      if (typeof response.text !== "function") throw failure("invalid");
      text = await response.text();
      if (typeof text !== "string" || text.length > limit || new TextEncoder().encode(text).byteLength > limit) throw failure("invalid");
    }
    if (!current()) throw failure("invalid");
    try { return JSON.parse(text); } catch (_) { throw failure("invalid"); }
  }
  function createController({ fetch, identity, isCurrent, context, locale = () => "ko", visible = () => true,
    parsePreview, onChange = () => {}, onDispatch = () => {}, makeIdempotencyKey = () => window.crypto.randomUUID() } = {}) {
    const verifiedRejections = new WeakSet();
    let scope = null, ticket = 0, phase = "idle", messageKey = "ready", data = null, receipt = null, request = null, destroyed = false;
    let reviewed = Object.fromEntries(fields.map(key => [key, false]));
    const previewParser = () => parsePreview || window.LuminaCreatorBodyPreview?.parsePreview;
    function readScope() {
      let value = {}, owner = null, shown = false, rawLocale = "ko", available = false;
      try {
        value = context() || {}; shown = visible() === true; rawLocale = locale(); owner = identity();
        available = typeof fetch === "function" && typeof isCurrent === "function" && typeof previewParser() === "function";
        if (!record(owner) || typeof owner.ownerId !== "string" || !owner.ownerId.trim() || owner.ownerId.length > 320 ||
            /[\u0000-\u001f\u007f]/.test(owner.ownerId) || !Number.isSafeInteger(owner.epoch) || owner.epoch < 0 || !isCurrent(owner)) owner = null;
      } catch (_) { owner = null; }
      return { owner: owner ? { ownerId: owner.ownerId, epoch: owner.epoch } : null,
        workId: typeof value.workId === "string" ? value.workId.toLowerCase() : "", sourceLocale: value.locale,
        locale: locales.includes(rawLocale) ? rawLocale : "ko", rawLocale: typeof rawLocale === "string" ? rawLocale : "",
        visible: shown, available };
    }
    const initial = value => destroyed || !value.visible ? "hidden" : !value.available ? "unavailable" : !value.owner ? "unauthenticated" :
      !value.workId ? "noWork" : !uuid(value.workId) || !locales.includes(value.sourceLocale) ? "invalid" : "ready";
    const accessible = () => scope && initial(scope) === "ready";
    const pending = () => scope?.owner ? commands.get(scope.owner.ownerId) : null;
    const sameCommand = () => accessible() && pending()?.workId === scope.workId && pending()?.locale === scope.sourceLocale;
    const busy = () => phase === "loading" || phase === "submitting";
    const canMutate = () => accessible() && phase === "ready" && !pending() && commands.size < maxCommands;
    const canReview = () => canMutate() && data?.review.state === "reviewable" && data?.preview?.progress?.scene?.isGenerated === true;
    const canWithdraw = () => canMutate() && data?.review.latestReview && data.review.latestReview.withdrawnAt === null;
    function state() {
      return clone({ ticket, phase, messageKey, locale: scope?.locale || "ko", data, receipt, reviewed, busy: busy(),
        canLoad: Boolean(accessible() && !busy()), canReview: Boolean(canReview()),
        canApprove: Boolean(canReview() && fields.every(key => reviewed[key])), canReject: Boolean(canReview() && fields.some(key => reviewed[key])),
        canWithdraw: Boolean(canWithdraw()), canRetry: Boolean(sameCommand() && !busy() && !pending().flight), unresolved: Boolean(pending()) });
    }
    const emit = () => onChange(state());
    function clear() {
      ticket++; data = null; receipt = null; reviewed = Object.fromEntries(fields.map(key => [key, false])); phase = "idle";
      const old = request; request = null;
      if (old?.command && old.command.flight === old) old.command.flight = null;
      old?.abort.abort();
    }
    function setInitial() {
      messageKey = initial(scope);
      if (messageKey === "ready" && pending()) { phase = "uncertain"; messageKey = sameCommand() ? "uncertain" : "unresolvedElsewhere"; }
    }
    function syncContext(notify = true) {
      if (destroyed) return false;
      const next = readScope();
      if (JSON.stringify(scope) === JSON.stringify(next)) return false;
      clear(); scope = next; setInitial(); if (notify) emit(); return true;
    }
    function invalidate() { if (!destroyed) { clear(); scope = readScope(); setInitial(); emit(); } }
    function snapshot() { syncContext(); return state(); }
    function destroy() { if (!destroyed) { clear(); destroyed = true; scope = null; messageKey = "hidden"; emit(); } }
    function start(nextPhase, nextMessage, command = null) {
      phase = nextPhase; messageKey = nextMessage;
      const ownTicket = ++ticket, owner = { ...scope.owner }, abort = new AbortController();
      const active = { owner, abort, command, current: () => { syncContext(); return !destroyed && ticket === ownTicket; } };
      request = active; if (command) command.flight = active;
      return active;
    }
    const root = workId => "/api/v1/me/creator-studio/stories/" + encodeURIComponent(workId) + "/body-review";
    const errorKey = status => ({ 400: "invalid", 401: "unauthenticated", 403: "forbidden", 404: "notFound", 409: "conflict", 422: "invalid" })[status] || (status >= 500 ? "server" : "unavailable");
    async function responseValue(url, options, active, limit) {
      if (!active.current()) throw failure("invalid");
      if (options.method === "POST") onDispatch();
      if (!active.current()) throw failure("invalid");
      const response = await fetch(url, { ...options, identity: active.owner, _retried: true, cache: "no-store",
        headers: { "Cache-Control": "no-store", ...options.headers }, signal: active.abort.signal });
      if (!active.current()) { try { await response?.body?.cancel?.(); } catch (_) {} throw failure("invalid"); }
      if (!response || !Number.isInteger(response.status)) throw failure("invalid");
      if (options.method === "GET" ? response.status !== 200 : ![200, 201].includes(response.status)) {
        const error = Object.assign(failure(errorKey(response.status)), { status: response.status });
        if (options.method === "POST" && response.status === 409 && active.command?.url === url) {
          try {
            const value = await readJson(response, 4096, active.current);
            if (definitiveRejection(value, response.status, active.command)) {
              error.code = value.error.code; verifiedRejections.add(error);
            }
          } catch (_) { /* Unverified diagnostics cannot retire a possibly committed command. */ }
        } else { try { await response.body?.cancel?.(); } catch (_) {} }
        if (!active.current()) throw failure("invalid");
        throw error;
      }
      return readJson(response, limit, active.current);
    }
    async function load(expectedTicket = null) {
      syncContext();
      if ((expectedTicket !== null && expectedTicket !== ticket) || !accessible() || busy()) return false;
      data = null; reviewed = Object.fromEntries(fields.map(key => [key, false]));
      const target = { workId: scope.workId, locale: scope.sourceLocale }, active = start("loading", "loading"); emit();
      try {
        const review = parseReview(await responseValue(root(target.workId) + "?locale=" + encodeURIComponent(target.locale), { method: "GET" }, active, 16384), target);
        if (!active.current()) return false;
        let preview = null;
        try {
          preview = previewParser()(await responseValue("/api/v1/me/creator-studio/stories/" + encodeURIComponent(target.workId) +
            "/body-preview?locale=" + encodeURIComponent(target.locale), { method: "GET" }, active, 256 * 1024), target);
        } catch (error) {
          // A verified stale head remains withdrawable when the published preview no longer exists.
          if (review.state !== "source_changed" || ![404, 409].includes(error?.status)) throw error;
        }
        if (!active.current()) return false;
        if (review.target) {
          const item = review.target, progress = preview.progress, scene = progress?.scene;
          if (!progress || progress.progressId !== item.progressId || progress.revision !== item.progressRevision ||
              !scene || scene.id !== item.sceneId || scene.isGenerated !== true || !["active", "completed"].includes(progress.status) ||
              (scene.endingType !== null || progress.status === "completed") !== item.ending) throw failure("conflict");
        }
        data = { review, preview: review.state === "source_changed" ? null : preview }; request = null; phase = pending() ? "uncertain" : "ready";
        messageKey = pending() ? sameCommand() ? "uncertain" : "unresolvedElsewhere" : review.state;
        emit(); return true;
      } catch (error) {
        if (!active.current()) return false;
        data = null; request = null; phase = pending() ? "uncertain" : "error";
        messageKey = pending() ? sameCommand() ? "uncertain" : "unresolvedElsewhere" : Object.hasOwn(copy.ko, error?.kind) ? error.kind : "transport";
        emit(); return false;
      }
    }
    function setReviewed(field, value, expectedTicket = null) {
      syncContext();
      if ((expectedTicket !== null && expectedTicket !== ticket) || !canReview() || !fields.includes(field) || typeof value !== "boolean") return false;
      reviewed[field] = value; emit(); return true;
    }
    async function submit(command) {
      data = null; receipt = null; reviewed = Object.fromEntries(fields.map(key => [key, false]));
      const active = start("submitting", "submitting", command); emit();
      try {
        const value = await responseValue(command.url, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": command.key },
          body: command.json }, active, 16384);
        if (!active.current()) return false;
        const verified = parseReceipt(value, command);
        if (!active.current()) return false;
        receipt = verified; commands.delete(command.ownerId); command.flight = null; request = null; phase = "accepted"; messageKey = "receipt";
        const acceptedTicket = ticket; emit();
        await load(acceptedTicket);
        return true;
      } catch (error) {
        if (!active.current()) return false;
        if (verifiedRejections.has(error) && commands.get(command.ownerId) === command && command.flight === active) {
          commands.delete(command.ownerId); command.flight = null; request = null; phase = "error"; messageKey = "conflict";
          emit(); return false;
        }
        command.flight = null; request = null; phase = "uncertain"; messageKey = "uncertain"; emit(); return false;
      }
    }
    function newCommand(kind, body, reviewId = null, receiptLocale = scope.sourceLocale) {
      const capturedTicket = ticket;
      let key;
      try { key = makeIdempotencyKey(); } catch (_) { key = null; }
      syncContext();
      if (destroyed || capturedTicket !== ticket || !canMutate()) return null;
      if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,120}$/.test(key)) {
        clear(); phase = "error"; messageKey = "unavailable"; emit(); return null;
      }
      const command = { kind, ownerId: scope.owner.ownerId, workId: scope.workId, locale: scope.sourceLocale, receiptLocale, reviewId,
        key, body, json: JSON.stringify(body), url: root(scope.workId) + (kind === "withdraw" ? "/" + encodeURIComponent(reviewId) + "/withdraw" : ""), flight: null };
      commands.set(command.ownerId, command); return command;
    }
    async function decide(decision, expectedTicket = null) {
      syncContext();
      if ((expectedTicket !== null && expectedTicket !== ticket) || !canReview() || !["approve", "reject"].includes(decision) ||
          (decision === "approve" ? !fields.every(key => reviewed[key]) : !fields.some(key => reviewed[key]))) return false;
      const body = { locale: scope.sourceLocale, sourceBindingHash: data.review.target.sourceBindingHash,
        expectedProgressRevision: data.review.target.progressRevision, expectedReviewId: data.review.latestReview?.id || null, decision, ...reviewed };
      const command = newCommand("review", body); return command ? submit(command) : false;
    }
    async function withdraw(expectedTicket = null) {
      syncContext();
      if ((expectedTicket !== null && expectedTicket !== ticket) || !canWithdraw()) return false;
      const latest = data.review.latestReview;
      const command = newCommand("withdraw", {}, latest.id, latest.locale); return command ? submit(command) : false;
    }
    async function retry(expectedTicket = null) {
      syncContext();
      if ((expectedTicket !== null && expectedTicket !== ticket) || !sameCommand() || busy() || pending().flight) return false;
      return submit(pending());
    }
    syncContext(false);
    return { invalidate, load, syncContext, snapshot, destroy, setReviewed, decide, withdraw, retry };
  }
  function mount(host, options = {}) {
    if (!host || mounts.has(host) || host.dataset.bodyReviewMounted) return null;
    const shell = document.getElementById("studioShell"), section = document.getElementById("writer-manuscript");
    host.dataset.bodyReviewMounted = "true";
    const cleanups = [], observers = [];
    const element = (tag, className, text) => {
      const node = document.createElement(tag); if (className) node.className = className;
      if (text !== undefined) node.textContent = text; return node;
    };
    const header = element("header", "body-review-header"), heading = element("div"), title = element("h3"), privacy = element("p", "body-review-private");
    title.id = "writerBodyReviewTitle"; heading.append(title, privacy);
    const tools = element("div", "body-review-tools");
    function iconButton(name) {
      const button = element("button", "body-review-tool"); button.type = "button";
      button.style.width = "44px"; button.style.height = "44px";
      let icon;
      try { if (window.lucide?.icons?.[name]) icon = window.lucide.createElement(window.lucide.icons[name]); } catch (_) {}
      if (!icon) icon = element("span", "", name === "RefreshCw" ? "\u21bb" : "\u21a9");
      icon.setAttribute("aria-hidden", "true"); button.append(icon); tools.append(button); return button;
    }
    const refresh = iconButton("RefreshCw"), retry = iconButton("RotateCcw");
    refresh.id = "writerBodyReviewRefresh"; retry.id = "writerBodyReviewRetry"; header.append(heading, tools);
    const status = element("p", "body-review-state"), content = element("div", "body-review-content"), receiptStatus = element("p", "body-review-receipt");
    status.id = "writerBodyReviewState"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    content.id = "writerBodyReviewContent";
    const checks = element("fieldset", "body-review-checks"), legend = element("legend"), inputs = {}, labels = {};
    checks.append(legend);
    for (const field of fields) {
      const label = element("label"), input = element("input"), text = element("span");
      input.type = "checkbox"; input.id = "writerBodyReview-" + field; input.name = field;
      label.append(input, text); checks.append(label); inputs[field] = input; labels[field] = text;
    }
    const actions = element("div", "body-review-actions");
    actions.style.display = "flex"; actions.style.flexWrap = "wrap"; actions.style.gap = "8px";
    const approve = element("button"), reject = element("button"), withdraw = element("button");
    for (const [button, name] of [[approve, "Approve"], [reject, "Reject"], [withdraw, "Withdraw"]]) {
      button.type = "button"; button.id = "writerBodyReview" + name; button.style.minHeight = "44px";
      button.style.whiteSpace = "normal"; button.style.overflowWrap = "anywhere"; actions.append(button);
    }
    host.style.minWidth = "0"; host.style.overflowWrap = "anywhere"; host.style.letterSpacing = "0";
    host.setAttribute("aria-labelledby", title.id); host.replaceChildren(header, status, receiptStatus, content, checks, actions);
    const defaultVisible = () => !host.hidden && (!shell || !shell.hidden) && (!section || (!section.hidden && section.classList.contains("is-active"))) && document.visibilityState !== "hidden";
    let controller, renderedTicket = 0;
    function render(state) {
      const words = copy[state.locale]; renderedTicket = state.ticket;
      host.lang = state.locale; host.setAttribute("aria-busy", String(state.busy)); title.textContent = words.title; privacy.textContent = words.privacy;
      for (const [button, label, enabled] of [[refresh, words.refresh, state.canLoad], [retry, words.retry, state.canRetry]]) {
        button.title = label; button.setAttribute("aria-label", label); button.disabled = !enabled;
      }
      retry.hidden = !state.unresolved; status.textContent = words[state.messageKey];
      receiptStatus.hidden = !state.receipt; receiptStatus.textContent = state.receipt ? words.receipt : "";
      legend.textContent = words.scope; checks.hidden = !state.data?.review.target; checks.disabled = !state.canReview;
      for (const field of fields) { inputs[field].checked = state.reviewed[field]; inputs[field].disabled = !state.canReview; labels[field].textContent = words[field]; }
      for (const [button, key, enabled] of [[approve, "approve", state.canApprove], [reject, "reject", state.canReject], [withdraw, "withdraw", state.canWithdraw]]) {
        button.textContent = words[key]; button.disabled = !enabled;
      }
      approve.hidden = reject.hidden = !state.data?.review.target;
      withdraw.hidden = !state.data?.review.latestReview || state.data.review.latestReview.withdrawnAt !== null;
      content.replaceChildren();
      const latest = state.data?.review.latestReview;
      if (latest) content.append(element("p", "body-review-latest", words[latest.applicability] + ": " + words[latest.decision === "approve" ? "approved" : "rejected"]));
      const scene = state.data?.review.target && state.data?.preview.progress?.scene;
      if (scene) {
        const source = element("div", "body-review-source"); source.lang = state.data.review.locale;
        source.append(element("h4", "", scene.title));
        for (const beat of scene.beats) {
          const paragraph = element("p", "body-review-beat", beat.content); paragraph.style.whiteSpace = "pre-wrap"; source.append(paragraph);
        }
        if (state.data.review.target.ending) source.append(element("p", "body-review-ending", words.ending));
        content.append(source);
      }
      options.onChange?.(state);
    }
    const defaultFetch = (url, settings) => {
      const auth = window.getAuth?.(), token = auth?.accessToken || auth?.access_token || auth?.token || auth?.tokens?.accessToken || auth?.tokens?.access_token;
      if (typeof token !== "string" || !token) throw failure("unauthenticated");
      return window.LuminaCreatorStudioApi.fetch(url, { ...settings, token,
        ...(settings.method === "POST" ? { body: JSON.parse(settings.body) } : {}) });
    };
    controller = createController({ ...options, fetch: options.fetch || defaultFetch,
      identity: options.identity || (() => window.LuminaCreatorStudioApi?.identity?.()),
      isCurrent: options.isCurrent || (owner => typeof window.LuminaCreatorStudioApi?.fetch === "function" && window.LuminaCreatorStudioApi?.isCurrent?.(owner) === true),
      context: options.context || (() => ({ workId: document.getElementById("writerManuscriptWork")?.value || "", locale: document.getElementById("writerManuscriptLocale")?.value || "" })),
      locale: options.locale || (() => window.luminaI18n?.getLocale?.() || document.documentElement.lang || "ko"),
      visible: options.visible || defaultVisible, onChange: render,
      onDispatch: options.onDispatch || (() => window.dispatchEvent(new Event("lumina:author-body-review-changed"))) });
    function listen(node, name, callback, capture = false) {
      if (!node) return; node.addEventListener(name, callback, capture); cleanups.push(() => node.removeEventListener(name, callback, capture));
    }
    listen(refresh, "click", () => { if (!refresh.disabled) return controller.load(renderedTicket); });
    listen(retry, "click", () => { if (!retry.disabled) return controller.retry(renderedTicket); });
    listen(approve, "click", () => { if (!approve.disabled) return controller.decide("approve", renderedTicket); });
    listen(reject, "click", () => { if (!reject.disabled) return controller.decide("reject", renderedTicket); });
    listen(withdraw, "click", () => { if (!withdraw.disabled) return controller.withdraw(renderedTicket); });
    for (const field of fields) listen(inputs[field], "change", () => controller.setReviewed(field, inputs[field].checked, renderedTicket));
    const sync = () => controller.syncContext(), erase = () => controller.invalidate();
    for (const name of ["storage", "lumina:authchange", "lumina:auth-expired", "pagehide", "lumina:author-body-trial-progress-changed"]) listen(window, name, erase);
    for (const name of ["focus", "lumina:localechange", "pageshow"]) listen(window, name, sync);
    listen(document, "lumina:auth-expired", erase); listen(document, "visibilitychange", erase);
    for (const id of ["writerManuscriptWork", "writerManuscriptLocale"]) {
      const control = document.getElementById(id); for (const name of ["input", "change"]) listen(control, name, erase);
    }
    listen(document, "click", event => {
      const target = event.target.closest?.("[data-section]"); if (target && target.getAttribute("data-section") !== "writer-manuscript") erase();
    }, true);
    if (typeof MutationObserver === "function") {
      function observe(node, settings, callback) {
        if (!node) return; const observer = new MutationObserver(callback); observer.observe(node, settings); observers.push(observer);
      }
      for (const [node, attributes] of [[section, ["class", "hidden", "style"]], [shell, ["hidden"]], [host, ["hidden"]], [document.documentElement, ["lang"]]]) {
        observe(node, { attributes: true, attributeFilter: attributes }, erase);
      }
      for (const id of ["writerManuscriptWork", "writerManuscriptLocale"]) observe(document.getElementById(id),
        { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "selected"] }, sync);
    }
    const destroy = controller.destroy;
    controller.destroy = () => {
      for (const cleanup of cleanups.splice(0)) cleanup(); for (const observer of observers.splice(0)) observer.disconnect();
      destroy(); host.replaceChildren(); delete host.dataset.bodyReviewMounted; mounts.delete(host);
    };
    mounts.set(host, controller); render(controller.snapshot()); return controller;
  }
  window.LuminaCreatorBodyReview = { parseReview, parseReceipt, createController, mount, copy };
  if (typeof document !== "undefined") mount(document.getElementById("writerBodyReview"));
})();
