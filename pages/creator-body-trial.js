(function () {
  "use strict";
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const failure = kind => Object.assign(new Error("Author trial unavailable"), { kind });
  const ownerId = value => typeof value === "string" && Boolean(value.trim()) && value.length <= 320 && !/[\u0000-\u001f\u007f]/.test(value);
  const commandKey = value => typeof value === "string" && /^[A-Za-z0-9._:-]{8,120}$/.test(value);
  const journalLimit = 2048;
  const maxJournalRevision = 2147483646;
  const positive = value => Number.isSafeInteger(value) && value > 0;
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const money = value => typeof value === "string" && /^(0|[1-9][0-9]{0,11})\.[0-9]{6}$/.test(value);
  const micros = value => BigInt(value.replace(".", ""));
  const fixed = value => (value / 1000000n).toString() + "." + (value % 1000000n).toString().padStart(6, "0");
  const states = ["approval_required", "approval_expired", "release_changed", "cost_unknown", "budget_over_limit", "approval_recorded"];
  const copy = {
    ko: {
      title: "\uc791\uac00 \ubcf8\ubb38 \uc2dc\ud5d8", privacy: "\ube44\uacf5\uac1c \u00b7 \ubcf8\ubb38 \uc804\uc6a9", refresh: "\uc2dc\ud5d8 \uc0c1\ud0dc \uc0c8\ub85c\uace0\uce68", retry: "\uc774\uc804 \uc120\ud0dd \uc811\uc218 \ud655\uc778",
      recover: "\ucd5c\uadfc \uc694\uccad \ucc3e\uae30", recoveryEmpty: "\ucd5c\uadfc \uc694\uccad \uae30\ub85d\uc744 \ucc3e\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.", receiptResult: "\uc811\uc218 \uacb0\uacfc",
      ready: "\uc2dc\ud5d8 \uc0c1\ud0dc\ub97c \ud655\uc778\ud574 \uc8fc\uc138\uc694.", loading: "\uc2dc\ud5d8 \uc0c1\ud0dc \ud655\uc778 \uc911", submitting: "\uc120\ud0dd \uc811\uc218 \uc911", accepted: "\uc120\ud0dd\uc744 \uc811\uc218\ud588\uc2b5\ub2c8\ub2e4.",
      uncertain: "\uc811\uc218 \uacb0\uacfc \ud655\uc778 \ud544\uc694", unresolvedElsewhere: "\uc774\uc804 \uc791\ud488\uc758 \uc120\ud0dd \uc811\uc218 \ud655\uc778 \ud544\uc694", noWork: "\uc120\ud0dd\ub41c \uc791\ud488\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.", generationFailed: "\ubcf8\ubb38 \uc0dd\uc131 \uc2e4\ud328", generationTimeout: "\ubcf8\ubb38 \uc0dd\uc131 \uc2dc\uac04 \ucd08\uacfc",
      approval_required: "\ubcf8\ubb38 \uc2dc\ud5d8 \uc2b9\uc778 \ub4f1\ub85d \ud544\uc694", approval_expired: "\uc2dc\ud5d8 \uc2b9\uc778 \ub9cc\ub8cc", release_changed: "\uc2b9\uc778 \ud6c4 \uacf5\uac1c\ubcf8 \ubcc0\uacbd", cost_unknown: "\ubbf8\ud655\uc778 \uc0dd\uc131 \ube44\uc6a9 \uc788\uc74c", budget_over_limit: "\uc2b9\uc778 \uc608\uc0b0 \ucd08\uacfc", approval_recorded: "\uc2dc\ud5d8 \uc2b9\uc778 \ub4f1\ub85d\ub428",
      approved: "\uc2b9\uc778 \uc608\uc0b0", committed: "\uc0ac\uc6a9\u00b7\uc608\uc57d \ube44\uc6a9", remaining: "\uc794\uc5ec \uc608\uc0b0", unknown: "\ubbf8\ud655\uc778", choices: "\ud604\uc7ac \uc120\ud0dd\uc9c0", ending: "\uc5d4\ub529", generating: "\uc0dd\uc131 \ub300\uae30 \ub610\ub294 \uc0dd\uc131 \uc911", noProgress: "\uc800\uc7a5\ub41c \ub0b4 \uc9c4\ud589\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.", noScene: "\uc800\uc7a5\ub41c \ud604\uc7ac \uc7a5\uba74\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
      historicalUnknownSeparated: "\uacfc\uac70 \uae08\uc561 \ubbf8\ud655\uc778 2\uac74, \uc774\ubc88 \uc2dc\ud5d8 \ud55c\ub3c4 \ubc16 \ubcc4\ub3c4 \ubcf4\uc874",
      unauthenticated: "\ub85c\uadf8\uc778 \ud544\uc694", forbidden: "\uc774 \uc791\ud488\uc5d0 \ub300\ud55c \uad8c\ud55c \uc5c6\uc74c", notFound: "\uc791\ud488 \ub610\ub294 \uc9c4\ud589 \ucc3e\uc744 \uc218 \uc5c6\uc74c", conflict: "\uc9c4\ud589\u00b7\uc2b9\uc778\u00b7\ube44\uc6a9 \uc0c1\ud0dc \uc7ac\ud655\uc778 \ud544\uc694", invalid: "\uc751\ub2f5 \ud655\uc778 \uc2e4\ud328", transport: "\uc5f0\uacb0 \uc2e4\ud328", server: "\uc11c\ubc84 \uc751\ub2f5 \uc2e4\ud328", unavailable: "\ud604\uc7ac \uc2dc\ud5d8 \uc774\uc6a9 \ubd88\uac00", hidden: ""
    },
    en: {
      title: "Author text trial", privacy: "Private \u00b7 Text only", refresh: "Refresh trial state", retry: "Check previous choice receipt",
      recover: "Find recent request", recoveryEmpty: "No recent request record found.", receiptResult: "Receipt result",
      ready: "Check the trial state.", loading: "Checking trial state", submitting: "Submitting choice", accepted: "Choice accepted.", uncertain: "Choice receipt needs checking", unresolvedElsewhere: "A previous story's choice receipt needs checking", noWork: "No story selected.",
      generationFailed: "Text generation failed", generationTimeout: "Text generation timed out",
      approval_required: "Trial approval registration required", approval_expired: "Trial approval expired", release_changed: "Release changed after approval", cost_unknown: "Unconfirmed generation cost", budget_over_limit: "Approved budget exceeded", approval_recorded: "Trial approval recorded",
      approved: "Approved budget", committed: "Spent and reserved", remaining: "Remaining budget", unknown: "Unconfirmed", choices: "Current choices", ending: "Ending", generating: "Pending or generating", noProgress: "No saved progress of your own.", noScene: "No saved current scene.",
      historicalUnknownSeparated: "2 historical requests with unconfirmed costs, preserved separately outside this trial's budget limit",
      unauthenticated: "Sign-in required", forbidden: "No permission for this story", notFound: "Story or progress not found", conflict: "Progress, approval or cost needs checking", invalid: "Response verification failed", transport: "Connection failed", server: "Server response failed", unavailable: "Trial unavailable", hidden: ""
    },
    ja: {
      title: "\u4f5c\u8005\u306e\u672c\u6587\u30c6\u30b9\u30c8", privacy: "\u975e\u516c\u958b \u00b7 \u672c\u6587\u306e\u307f", refresh: "\u30c6\u30b9\u30c8\u72b6\u614b\u3092\u66f4\u65b0", retry: "\u524d\u306e\u9078\u629e\u306e\u53d7\u4ed8\u3092\u78ba\u8a8d",
      recover: "\u6700\u8fd1\u306e\u30ea\u30af\u30a8\u30b9\u30c8\u3092\u63a2\u3059", recoveryEmpty: "\u6700\u8fd1\u306e\u30ea\u30af\u30a8\u30b9\u30c8\u8a18\u9332\u306f\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3067\u3057\u305f\u3002", receiptResult: "\u53d7\u4ed8\u7d50\u679c",
      ready: "\u30c6\u30b9\u30c8\u72b6\u614b\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002", loading: "\u72b6\u614b\u3092\u78ba\u8a8d\u4e2d", submitting: "\u9078\u629e\u3092\u53d7\u4ed8\u4e2d", accepted: "\u9078\u629e\u3092\u53d7\u3051\u4ed8\u3051\u307e\u3057\u305f\u3002", uncertain: "\u53d7\u4ed8\u7d50\u679c\u306e\u78ba\u8a8d\u304c\u5fc5\u8981", unresolvedElsewhere: "\u524d\u306e\u4f5c\u54c1\u306e\u53d7\u4ed8\u78ba\u8a8d\u304c\u5fc5\u8981", noWork: "\u4f5c\u54c1\u672a\u9078\u629e",
      generationFailed: "\u672c\u6587\u751f\u6210\u5931\u6557", generationTimeout: "\u672c\u6587\u751f\u6210\u306e\u6642\u9593\u5207\u308c",
      approval_required: "\u30c6\u30b9\u30c8\u627f\u8a8d\u306e\u767b\u9332\u304c\u5fc5\u8981", approval_expired: "\u627f\u8a8d\u671f\u9650\u5207\u308c", release_changed: "\u627f\u8a8d\u5f8c\u306b\u516c\u958b\u7248\u304c\u5909\u66f4", cost_unknown: "\u672a\u78ba\u8a8d\u306e\u751f\u6210\u8cbb\u7528", budget_over_limit: "\u627f\u8a8d\u4e88\u7b97\u8d85\u904e", approval_recorded: "\u627f\u8a8d\u767b\u9332\u6e08\u307f",
      approved: "\u627f\u8a8d\u4e88\u7b97", committed: "\u4f7f\u7528\u30fb\u4e88\u7d04\u8cbb\u7528", remaining: "\u6b8b\u308a\u4e88\u7b97", unknown: "\u672a\u78ba\u8a8d", choices: "\u73fe\u5728\u306e\u9078\u629e\u80a2", ending: "\u30a8\u30f3\u30c7\u30a3\u30f3\u30b0", generating: "\u751f\u6210\u5f85\u3061\u30fb\u751f\u6210\u4e2d", noProgress: "\u81ea\u5206\u306e\u4fdd\u5b58\u9032\u884c\u306a\u3057", noScene: "\u73fe\u5728\u306e\u4fdd\u5b58\u5834\u9762\u306a\u3057",
      historicalUnknownSeparated: "\u904e\u53bb\u306e\u91d1\u984d\u672a\u78ba\u8a8d 2 \u4ef6\u3001\u4eca\u56de\u306e\u30c6\u30b9\u30c8\u306e\u4e88\u7b97\u4e0a\u9650\u5916\u3067\u5225\u9014\u4fdd\u6301",
      unauthenticated: "\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981", forbidden: "\u4f5c\u54c1\u306e\u6a29\u9650\u306a\u3057", notFound: "\u4f5c\u54c1\u30fb\u9032\u884c\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093", conflict: "\u9032\u884c\u30fb\u627f\u8a8d\u30fb\u8cbb\u7528\u306e\u518d\u78ba\u8a8d\u304c\u5fc5\u8981", invalid: "\u5fdc\u7b54\u78ba\u8a8d\u5931\u6557", transport: "\u63a5\u7d9a\u5931\u6557", server: "\u30b5\u30fc\u30d0\u30fc\u5fdc\u7b54\u5931\u6557", unavailable: "\u30c6\u30b9\u30c8\u5229\u7528\u4e0d\u53ef", hidden: ""
    },
    "zh-Hans": {
      title: "\u4f5c\u8005\u6b63\u6587\u6d4b\u8bd5", privacy: "\u79c1\u5bc6 \u00b7 \u4ec5\u6b63\u6587", refresh: "\u5237\u65b0\u6d4b\u8bd5\u72b6\u6001", retry: "\u786e\u8ba4\u4e0a\u6b21\u9009\u62e9\u56de\u6267",
      recover: "\u67e5\u627e\u6700\u8fd1\u8bf7\u6c42", recoveryEmpty: "\u672a\u627e\u5230\u6700\u8fd1\u7684\u8bf7\u6c42\u8bb0\u5f55\u3002", receiptResult: "\u53d7\u7406\u7ed3\u679c",
      ready: "\u8bf7\u786e\u8ba4\u6d4b\u8bd5\u72b6\u6001\u3002", loading: "\u6b63\u5728\u786e\u8ba4\u72b6\u6001", submitting: "\u6b63\u5728\u63d0\u4ea4\u9009\u62e9", accepted: "\u9009\u62e9\u5df2\u63a5\u6536\u3002", uncertain: "\u9700\u8981\u786e\u8ba4\u63d0\u4ea4\u7ed3\u679c", unresolvedElsewhere: "\u9700\u8981\u786e\u8ba4\u4e0a\u4e00\u4f5c\u54c1\u7684\u9009\u62e9", noWork: "\u672a\u9009\u62e9\u4f5c\u54c1",
      generationFailed: "\u6b63\u6587\u751f\u6210\u5931\u8d25", generationTimeout: "\u6b63\u6587\u751f\u6210\u8d85\u65f6",
      approval_required: "\u9700\u8981\u767b\u8bb0\u6d4b\u8bd5\u6279\u51c6", approval_expired: "\u6279\u51c6\u5df2\u8fc7\u671f", release_changed: "\u6279\u51c6\u540e\u53d1\u5e03\u7248\u5df2\u53d8\u66f4", cost_unknown: "\u6709\u672a\u786e\u8ba4\u751f\u6210\u8d39\u7528", budget_over_limit: "\u8d85\u51fa\u6279\u51c6\u9884\u7b97", approval_recorded: "\u6d4b\u8bd5\u6279\u51c6\u5df2\u767b\u8bb0",
      approved: "\u6279\u51c6\u9884\u7b97", committed: "\u5df2\u7528\u53ca\u9884\u7559", remaining: "\u5269\u4f59\u9884\u7b97", unknown: "\u672a\u786e\u8ba4", choices: "\u5f53\u524d\u9009\u9879", ending: "\u7ed3\u5c40", generating: "\u7b49\u5f85\u751f\u6210\u6216\u751f\u6210\u4e2d", noProgress: "\u6ca1\u6709\u81ea\u5df1\u7684\u5df2\u4fdd\u5b58\u8fdb\u5ea6", noScene: "\u6ca1\u6709\u5df2\u4fdd\u5b58\u5f53\u524d\u573a\u666f",
      historicalUnknownSeparated: "\u8fc7\u53bb\u91d1\u989d\u672a\u786e\u8ba4 2 \u7b14\uff0c\u5728\u672c\u6b21\u6d4b\u8bd5\u9884\u7b97\u9650\u989d\u5916\u5355\u72ec\u4fdd\u7559",
      unauthenticated: "\u9700\u8981\u767b\u5f55", forbidden: "\u65e0\u6b64\u4f5c\u54c1\u6743\u9650", notFound: "\u672a\u627e\u5230\u4f5c\u54c1\u6216\u8fdb\u5ea6", conflict: "\u9700\u91cd\u65b0\u786e\u8ba4\u8fdb\u5ea6\u3001\u6279\u51c6\u6216\u8d39\u7528", invalid: "\u54cd\u5e94\u9a8c\u8bc1\u5931\u8d25", transport: "\u8fde\u63a5\u5931\u8d25", server: "\u670d\u52a1\u5668\u54cd\u5e94\u5931\u8d25", unavailable: "\u6682\u65f6\u65e0\u6cd5\u6d4b\u8bd5", hidden: ""
    },
    "zh-Hant": {
      title: "\u4f5c\u8005\u6b63\u6587\u6e2c\u8a66", privacy: "\u79c1\u5bc6 \u00b7 \u50c5\u6b63\u6587", refresh: "\u91cd\u65b0\u6574\u7406\u6e2c\u8a66\u72c0\u614b", retry: "\u78ba\u8a8d\u4e0a\u6b21\u9078\u64c7\u56de\u57f7",
      recover: "\u5c0b\u627e\u6700\u8fd1\u8acb\u6c42", recoveryEmpty: "\u627e\u4e0d\u5230\u6700\u8fd1\u7684\u8acb\u6c42\u7d00\u9304\u3002", receiptResult: "\u53d7\u7406\u7d50\u679c",
      ready: "\u8acb\u78ba\u8a8d\u6e2c\u8a66\u72c0\u614b\u3002", loading: "\u6b63\u5728\u78ba\u8a8d\u72c0\u614b", submitting: "\u6b63\u5728\u63d0\u4ea4\u9078\u64c7", accepted: "\u9078\u64c7\u5df2\u63a5\u6536\u3002", uncertain: "\u9700\u8981\u78ba\u8a8d\u63d0\u4ea4\u7d50\u679c", unresolvedElsewhere: "\u9700\u8981\u78ba\u8a8d\u4e0a\u4e00\u4f5c\u54c1\u7684\u9078\u64c7", noWork: "\u672a\u9078\u64c7\u4f5c\u54c1",
      generationFailed: "\u6b63\u6587\u751f\u6210\u5931\u6557", generationTimeout: "\u6b63\u6587\u751f\u6210\u903e\u6642",
      approval_required: "\u9700\u8981\u767b\u8a18\u6e2c\u8a66\u6838\u51c6", approval_expired: "\u6838\u51c6\u5df2\u904e\u671f", release_changed: "\u6838\u51c6\u5f8c\u767c\u5e03\u7248\u5df2\u8b8a\u66f4", cost_unknown: "\u6709\u672a\u78ba\u8a8d\u751f\u6210\u8cbb\u7528", budget_over_limit: "\u8d85\u51fa\u6838\u51c6\u9810\u7b97", approval_recorded: "\u6e2c\u8a66\u6838\u51c6\u5df2\u767b\u8a18",
      approved: "\u6838\u51c6\u9810\u7b97", committed: "\u5df2\u7528\u53ca\u9810\u7559", remaining: "\u5269\u9918\u9810\u7b97", unknown: "\u672a\u78ba\u8a8d", choices: "\u76ee\u524d\u9078\u9805", ending: "\u7d50\u5c40", generating: "\u7b49\u5f85\u751f\u6210\u6216\u751f\u6210\u4e2d", noProgress: "\u6c92\u6709\u81ea\u5df1\u7684\u5df2\u5132\u5b58\u9032\u5ea6", noScene: "\u6c92\u6709\u5df2\u5132\u5b58\u76ee\u524d\u5834\u666f",
      historicalUnknownSeparated: "\u904e\u53bb\u91d1\u984d\u672a\u78ba\u8a8d 2 \u7b46\uff0c\u5728\u672c\u6b21\u6e2c\u8a66\u9810\u7b97\u9650\u984d\u5916\u55ae\u7368\u4fdd\u7559",
      unauthenticated: "\u9700\u8981\u767b\u5165", forbidden: "\u7121\u6b64\u4f5c\u54c1\u6b0a\u9650", notFound: "\u672a\u627e\u5230\u4f5c\u54c1\u6216\u9032\u5ea6", conflict: "\u9700\u91cd\u65b0\u78ba\u8a8d\u9032\u5ea6\u3001\u6838\u51c6\u6216\u8cbb\u7528", invalid: "\u56de\u61c9\u9a57\u8b49\u5931\u6557", transport: "\u9023\u7dda\u5931\u6557", server: "\u4f3a\u670d\u5668\u56de\u61c9\u5931\u6557", unavailable: "\u66ab\u6642\u7121\u6cd5\u6e2c\u8a66", hidden: ""
    }
  };
  const readLabels = {
    ko: ["\ubcf8\ubb38 \uc77d\uae30 \uc644\ub8cc", "\ubcf8\ubb38 \uc77d\uae30 \uae30\ub85d \ud544\uc694", "\uc77d\uae30 \uae30\ub85d \uc800\uc7a5 \uc911", "\uc77d\uae30 \uae30\ub85d \uacb0\uacfc \ud655\uc778 \ud544\uc694"],
    en: ["Mark text as read", "Reading record required", "Saving reading record", "Check reading record"],
    ja: ["\u672c\u6587\u3092\u8aad\u307f\u7d42\u3048\u305f", "\u8aad\u66f8\u8a18\u9332\u304c\u5fc5\u8981", "\u8aad\u66f8\u8a18\u9332\u3092\u4fdd\u5b58\u4e2d", "\u8aad\u66f8\u8a18\u9332\u306e\u78ba\u8a8d\u304c\u5fc5\u8981"],
    "zh-Hans": ["\u6b63\u6587\u5df2\u8bfb\u5b8c", "\u9700\u8981\u9605\u8bfb\u8bb0\u5f55", "\u6b63\u5728\u4fdd\u5b58\u9605\u8bfb\u8bb0\u5f55", "\u9700\u8981\u786e\u8ba4\u9605\u8bfb\u8bb0\u5f55"],
    "zh-Hant": ["\u6b63\u6587\u5df2\u8b80\u5b8c", "\u9700\u8981\u95b1\u8b80\u7d00\u9304", "\u6b63\u5728\u5132\u5b58\u95b1\u8b80\u7d00\u9304", "\u9700\u8981\u78ba\u8a8d\u95b1\u8b80\u7d00\u9304"]
  };
  const noChoiceLabels = {
    "ko": "\uc800\uc7a5\ub41c \ubcf8\ubb38\uc740 \uc77d\uc744 \uc218 \uc788\uc9c0\ub9cc \ub2e4\uc74c \uc120\ud0dd\uc9c0\uac00 \uc5c6\uc2b5\ub2c8\ub2e4. \ucd5c\uadfc \uc694\uccad\uc744 \ud655\uc778\ud574 \uc8fc\uc138\uc694.",
    "en": "The saved text is available, but there are no next choices. Check the recent request.",
    "ja": "\u4fdd\u5b58\u6e08\u307f\u306e\u672c\u6587\u306f\u8aad\u3081\u307e\u3059\u304c\u3001\u6b21\u306e\u9078\u629e\u80a2\u304c\u3042\u308a\u307e\u305b\u3093\u3002\u6700\u8fd1\u306e\u30ea\u30af\u30a8\u30b9\u30c8\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002",
    "zh-Hans": "\u5df2\u4fdd\u5b58\u7684\u6b63\u6587\u4ecd\u53ef\u9605\u8bfb\uff0c\u4f46\u6ca1\u6709\u4e0b\u4e00\u6b65\u9009\u9879\u3002\u8bf7\u68c0\u67e5\u6700\u8fd1\u7684\u8bf7\u6c42\u3002",
    "zh-Hant": "\u5df2\u5132\u5b58\u7684\u6b63\u6587\u4ecd\u53ef\u95b1\u8b80\uff0c\u4f46\u6c92\u6709\u4e0b\u4e00\u6b65\u9078\u9805\u3002\u8acb\u6aa2\u67e5\u6700\u8fd1\u7684\u8acb\u6c42\u3002",
  };
  const hasNoChoices = progress => progress?.status === "active" && progress.scene &&
    !progress.scene.endingType && progress.choices.length === 0;
  const nextCostLabels = {
    "ko": ["\ub2e4\uc74c \ubcf8\ubb38 \uc2dc\ud5d8 \ucd5c\ub300","\ub2e4\uc74c \ubcf8\ubb38 \uc2dc\ud5d8 \ucd5c\ub300 \ube44\uc6a9 \ud655\uc778 \ud544\uc694"],
    "en": ["Next text trial maximum","Next text trial maximum cost needs checking."],
    "ja": ["\u6b21\u306e\u672c\u6587\u30c6\u30b9\u30c8\u306e\u6700\u5927\u8cbb\u7528","\u6b21\u306e\u672c\u6587\u30c6\u30b9\u30c8\u306e\u6700\u5927\u8cbb\u7528\u306e\u78ba\u8a8d\u304c\u5fc5\u8981"],
    "zh-Hans": ["\u4e0b\u6b21\u6b63\u6587\u6d4b\u8bd5\u8d39\u7528\u4e0a\u9650","\u9700\u8981\u786e\u8ba4\u4e0b\u6b21\u6b63\u6587\u6d4b\u8bd5\u7684\u8d39\u7528\u4e0a\u9650"],
    "zh-Hant": ["\u4e0b\u6b21\u6b63\u6587\u6e2c\u8a66\u8cbb\u7528\u4e0a\u9650","\u9700\u8981\u78ba\u8a8d\u4e0b\u6b21\u6b63\u6587\u6e2c\u8a66\u7684\u8cbb\u7528\u4e0a\u9650"]
  };
  for (const language of locales) {
    const [recordRead, readRequired, recordingRead, readUncertain] = readLabels[language];
    const [nextCostMaximum, nextCostUnavailable] = nextCostLabels[language];
    Object.assign(copy[language], { recordRead, readRequired, recordingRead, readUncertain, noChoices: noChoiceLabels[language],
      nextCostMaximum, nextCostUnavailable });
  }
  const quoteReasons = ["approval_required", "approval_expired", "release_changed", "cost_unknown", "budget_over_limit",
    "pending_cost", "approval_pins_changed", "invalid_next_maximum", "next_cost_exceeds_remaining"];
  function nextCostQuote(value, state) {
    if (!["nextMaximumCostKrw", "nextCostQuoteState", "nextCostQuoteReason"].some(key => Object.prototype.hasOwnProperty.call(value, key))) return {};
    const withheld = reason => ({ nextMaximumCostKrw: null, nextCostQuoteState: "withheld", nextCostQuoteReason: reason });
    if (value.nextCostQuoteState !== "prepared" || value.nextCostQuoteReason !== null || !money(value.nextMaximumCostKrw) ||
        micros(value.nextMaximumCostKrw) <= 0n) {
      return withheld(value.nextCostQuoteState === "withheld" && value.nextMaximumCostKrw === null &&
        quoteReasons.includes(value.nextCostQuoteReason) ? value.nextCostQuoteReason : "invalid_next_maximum");
    }
    if (state.state !== "approval_recorded") return withheld(state.state);
    if (Date.parse(state.approval.expiresAt) <= Date.now()) return withheld("approval_expired");
    if (state.budget.unknownCostCount > 0) return withheld("cost_unknown");
    if (state.budget.pendingCount > 0 || micros(state.budget.reservedMaximumCostKrw) > 0n) return withheld("pending_cost");
    if (micros(value.nextMaximumCostKrw) > micros(state.budget.remainingBudgetKrw)) return withheld("next_cost_exceeds_remaining");
    return { nextMaximumCostKrw: value.nextMaximumCostKrw, nextCostQuoteState: "prepared", nextCostQuoteReason: null };
  }
  const sourceLabels = {
    "ko": ["\ubcf8\ubb38 \ucd9c\ucc98 \ud655\uc778", "\ubcf8\ubb38 \ucd9c\ucc98", "\ud604\uc7ac \ubcf8\ubb38 \ucd9c\ucc98 \uc77c\uce58", "\ud604\uc7ac \ubcf8\ubb38 \uae30\uc900 \ubcc0\uacbd", "\ud604\uc7ac AI \ubcf8\ubb38 \uc5c6\uc74c", "\ubcf8\ubb38 \uc0dd\uc131 \ub300\uae30", "\ucd9c\ucc98 \ud655\uc778 \uc911", "\uacf5\uac1c \ubc84\uc804", "\uc9c4\ud589 \uae30\uc900", "\ubcf8\ubb38 \ud310\ub2e8", "\uae30\ub85d \uc5c6\uc74c", "\ud68c\uc0ac \uc704\uc784 \uc2b9\uc778", "\uc791\uac00 \uac80\ud1a0 \uc2b9\uc778", "\ubc18\ub824", "\ucca0\ud68c", "\uc774\uc804 \uae30\ub85d"],
    "en": ["Check text source", "Text source", "Current text source matches", "Text source changed", "No current AI text", "Text generation pending", "Checking source", "Published version", "Progress revision", "Text decision", "No record", "Company-delegated approval", "Author-reviewed approval", "Rejected", "Withdrawn", "Previous record"],
    "ja": ["\u672c\u6587\u306e\u51fa\u5178\u3092\u78ba\u8a8d", "\u672c\u6587\u306e\u51fa\u5178", "\u73fe\u5728\u306e\u672c\u6587\u3068\u51fa\u5178\u304c\u4e00\u81f4", "\u672c\u6587\u306e\u51fa\u5178\u304c\u5909\u66f4", "\u73fe\u5728\u306eAI\u672c\u6587\u306a\u3057", "\u672c\u6587\u751f\u6210\u5f85\u3061", "\u51fa\u5178\u3092\u78ba\u8a8d\u4e2d", "\u516c\u958b\u30d0\u30fc\u30b8\u30e7\u30f3", "\u9032\u884c\u30ea\u30d3\u30b8\u30e7\u30f3", "\u672c\u6587\u306e\u5224\u65ad", "\u8a18\u9332\u306a\u3057", "\u4f1a\u793e\u59d4\u4efb\u306b\u3088\u308b\u627f\u8a8d", "\u4f5c\u8005\u78ba\u8a8d\u306b\u3088\u308b\u627f\u8a8d", "\u5374\u4e0b", "\u64a4\u56de", "\u904e\u53bb\u306e\u8a18\u9332"],
    "zh-Hans": ["\u786e\u8ba4\u6b63\u6587\u6765\u6e90", "\u6b63\u6587\u6765\u6e90", "\u5f53\u524d\u6b63\u6587\u6765\u6e90\u4e00\u81f4", "\u6b63\u6587\u6765\u6e90\u5df2\u53d8\u66f4", "\u65e0\u5f53\u524dAI\u6b63\u6587", "\u7b49\u5f85\u6b63\u6587\u751f\u6210", "\u6b63\u5728\u786e\u8ba4\u6765\u6e90", "\u53d1\u5e03\u7248\u672c", "\u8fdb\u5ea6\u7248\u672c", "\u6b63\u6587\u5ba1\u6838", "\u65e0\u8bb0\u5f55", "\u516c\u53f8\u59d4\u6258\u6279\u51c6", "\u4f5c\u8005\u5ba1\u6838\u6279\u51c6", "\u9a73\u56de", "\u64a4\u56de", "\u5386\u53f2\u8bb0\u5f55"],
    "zh-Hant": ["\u78ba\u8a8d\u6b63\u6587\u4f86\u6e90", "\u6b63\u6587\u4f86\u6e90", "\u76ee\u524d\u6b63\u6587\u4f86\u6e90\u4e00\u81f4", "\u6b63\u6587\u4f86\u6e90\u5df2\u8b8a\u66f4", "\u7121\u76ee\u524dAI\u6b63\u6587", "\u7b49\u5f85\u6b63\u6587\u751f\u6210", "\u6b63\u5728\u78ba\u8a8d\u4f86\u6e90", "\u767c\u5e03\u7248\u672c", "\u9032\u5ea6\u7248\u672c", "\u6b63\u6587\u5be9\u6838", "\u7121\u7d00\u9304", "\u516c\u53f8\u59d4\u8a17\u6838\u51c6", "\u4f5c\u8005\u5be9\u6838\u6838\u51c6", "\u99c1\u56de", "\u64a4\u56de", "\u6b77\u53f2\u7d00\u9304"]
  };
  function parseSourcePreparation(value, target, preview) {
    const bad = () => { throw failure("invalid"); };
    if (!record(target) || !uuid(target.workId) || !locales.includes(target.locale) ||
        !record(value) || value.contract !== "story-author-body-memory-preparation-v1" ||
        value.workId !== target.workId || value.locale !== target.locale || value.readOnly !== true ||
        ["generationStarted", "imageGenerationStarted", "publicationStarted", "sharedReuseAuthorized",
          "generatedEventApprovalSupported", "generatedEventReadProofAvailable", "chatCurrentIdentityClaimed",
          "readerMemoryApplied"].some(key => value[key] !== false) ||
        !["reviewable", "not_generated", "generation_pending", "source_changed"].includes(value.state) ||
        value.bodyReviewable !== (value.state === "reviewable")) bad();
    const empty = state => ({ state, releaseVersion: null, progressRevision: null, bodyReview: null });
    if (value.state !== "reviewable") {
      if (value.target !== null || value.sourcePins !== null || value.participantReference !== null) bad();
      return empty(value.state);
    }
    const pin = value.target, source = value.sourcePins, progress = preview?.progress;
    const digest = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
    if (!record(pin) || !record(source) || !uuid(pin.progressId) || !positive(pin.progressRevision) || !uuid(pin.sceneId) ||
        !digest(pin.sourceBindingHash) || !digest(pin.bodyChecksum) || typeof pin.ending !== "boolean" ||
        !positive(source.releaseVersion) || !count(source.releaseRevision) || !uuid(source.releaseId) ||
        !uuid(source.manuscriptVersionId) || !digest(source.releaseChecksum) || !digest(source.manuscriptHash)) bad();
    if (preview?.workId !== target.workId || preview?.locale !== target.locale || !progress?.scene?.isGenerated ||
        progress.progressId !== pin.progressId || progress.revision !== pin.progressRevision || progress.scene.id !== pin.sceneId ||
        progress.storyVersion !== source.releaseVersion ||
        Boolean(progress.scene.endingType) !== pin.ending) return empty("source_changed");
    let review = null;
    if (value.latestBodyReview !== null) {
      const row = value.latestBodyReview;
      if (!record(row) || !uuid(row.id) || !locales.includes(row.locale) || !positive(row.version) ||
          !["approve", "reject"].includes(row.decision) || !["human_review", "company_delegation"].includes(row.approvalBasis) ||
          !["current", "stale", "withdrawn", "superseded"].includes(row.applicability) ||
          ["styleReviewed", "charactersReviewed", "timelineReviewed"].some(key => typeof row[key] !== "boolean") ||
          (row.applicability === "current" && row.locale !== target.locale) ||
          (row.approvalBasis === "human_review" && row.decision === "approve" &&
            ["styleReviewed", "charactersReviewed", "timelineReviewed"].some(key => !row[key])) ||
          (row.approvalBasis === "company_delegation" && ["styleReviewed", "charactersReviewed", "timelineReviewed"].some(key => row[key]))) bad();
      review = { decision: row.decision, approvalBasis: row.approvalBasis, applicability: row.applicability };
    }
    return { state: "reviewable", releaseVersion: source.releaseVersion, progressRevision: pin.progressRevision, bodyReview: review };
  }
  function parseState(value, target) {
    const bad = () => { throw failure("invalid"); };
    if (!record(value) || !uuid(target?.workId) || value.contract !== "story-author-body-trial-state-v1" ||
        !uuid(value.workId) || value.workId.toLowerCase() !== target.workId.toLowerCase() || value.readOnly !== true ||
        value.generationAuthorized !== false || value.currentAuthorizationVerified !== false || value.imageGenerationStarted !== false || !states.includes(value.state)) bad();
    const base = { contract: value.contract, workId: value.workId.toLowerCase(), readOnly: true,
      generationAuthorized: false, currentAuthorizationVerified: false, imageGenerationStarted: false, state: value.state, approval: null, budget: null };
    if (value.state === "approval_required") {
      if (value.approval !== null || value.budget !== null) bad();
      return Object.assign(base, nextCostQuote(value, base));
    }
    const approval = value.approval, budget = value.budget;
    if (!record(approval) || !uuid(approval.id) || typeof approval.expiresAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(approval.expiresAt) ||
        !Number.isFinite(Date.parse(approval.expiresAt)) || new Date(approval.expiresAt).toISOString() !== approval.expiresAt || !record(budget)) bad();
    const amounts = ["knownActualCostKrw", "reservedMaximumCostKrw", "committedCostKrw", "approvedBudgetKrw"];
    const counts = ["requestCount", "pendingCount", "unknownCostCount", "verifiedSharedReuseCount"];
    const scopeFields = ["historicalUnknownCostCount", "costScope"];
    const scoped = scopeFields.some(key => Object.prototype.hasOwnProperty.call(budget, key));
    if (scoped && (!scopeFields.every(key => Object.prototype.hasOwnProperty.call(budget, key)) ||
        !count(budget.historicalUnknownCostCount) ||
        !((budget.costScope === "all_recommended_body_requests_for_author_work" && budget.historicalUnknownCostCount === 0) ||
          (budget.costScope === "approved_historical_unknown_separation" && budget.historicalUnknownCostCount === 2)))) bad();
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
    base.budget = Object.fromEntries([...amounts, ...counts, ...(scoped ? scopeFields : []), "remainingBudgetKrw", "evidenceReadyForBudgetCheck"].map(key => [key, budget[key]]));
    return Object.assign(base, nextCostQuote(value, base));
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
        (value.status === "completed" ? value.resultGeneratedSceneId === null : value.resultGeneratedSceneId !== null)) bad();
    return { ...result, continuationId: value.continuationId.toLowerCase(), progressApplied: value.progressApplied,
      resultGeneratedSceneId: value.resultGeneratedSceneId?.toLowerCase() || null, provenance: value.provenance };
  }
  function parseReceiptEnvelope(value, command) {
    if (!record(value) || value.contract !== "story-author-body-trial-receipt-v1" ||
        !["workId", "choiceId"].every(key => uuid(value[key]) && value[key] === command[key]) ||
        !["approvalId", "progressId"].every(key => uuid(value[key]) && value[key] === command.body[key]) ||
        !positive(value.sourceRevision) || value.sourceRevision !== command.body.expectedRevision ||
        !locales.includes(value.locale) || value.locale !== command.body.locale || value.readOnly !== true ||
        value.generationAuthorized !== false || value.generationStarted !== false || value.imageGenerationStarted !== false ||
        !record(value.receipt) || value.receipt.idempotentReplay !== true) throw failure("invalid");
    return parseReceipt(value.receipt, command);
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
  function exactFields(value, fields) {
    return record(value) && Reflect.ownKeys(value).length === fields.length && fields.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && Object.prototype.hasOwnProperty.call(descriptor, "value");
    });
  }
  function parseJournal(value, owner) {
    if (!exactFields(value, ["version", "ownerId", "workId", "choiceId", "key", "body"]) || value.version !== 1 ||
        !ownerId(value.ownerId) || value.ownerId !== owner || !commandKey(value.key) ||
        !["workId", "choiceId"].every(key => uuid(value[key]) && value[key] === value[key].toLowerCase()) ||
        !exactFields(value.body, ["approvalId", "progressId", "expectedRevision", "locale"]) ||
        !["approvalId", "progressId"].every(key => uuid(value.body[key]) && value.body[key] === value.body[key].toLowerCase()) ||
        !positive(value.body.expectedRevision) || value.body.expectedRevision > maxJournalRevision || !locales.includes(value.body.locale)) throw failure("unavailable");
    const result = { version: 1, ownerId: value.ownerId, workId: value.workId, choiceId: value.choiceId, key: value.key,
      body: { approvalId: value.body.approvalId, progressId: value.body.progressId,
        expectedRevision: value.body.expectedRevision, locale: value.body.locale } };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > journalLimit) throw failure("unavailable");
    return result;
  }
  const journalEntry = command => ({ version: 1, ownerId: command.ownerId, workId: command.workId,
    choiceId: command.choiceId, key: command.key, body: { ...command.body } });
  const matchesJournal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  function parseRecovery(value, target) {
    try {
      if (!exactFields(value, ["contract", "workId", "readOnly", "generationAuthorized", "generationStarted", "imageGenerationStarted", "command"]) ||
          value.contract !== "story-author-body-trial-recovery-v1" || !uuid(target?.workId) || !uuid(value.workId) ||
          value.workId !== target.workId.toLowerCase() || value.readOnly !== true || value.generationAuthorized !== false ||
          value.generationStarted !== false || value.imageGenerationStarted !== false) throw failure("invalid");
      if (value.command === null) return null;
      if (!exactFields(value.command, ["workId", "choiceId", "key", "body"]) || value.command.workId !== value.workId) throw failure("invalid");
      const parsed = parseJournal({ version: 1, ownerId: "recovery", ...value.command }, "recovery");
      return { workId: parsed.workId, choiceId: parsed.choiceId, key: parsed.key, body: parsed.body };
    } catch (_) { throw failure("invalid"); }
  }
  function sessionJournal() {
    const slot = owner => {
      if (!ownerId(owner)) throw failure("unavailable");
      return "lumina:author-body-trial:pending:v1:" + encodeURIComponent(owner);
    };
    function read(owner) {
      const raw = window.sessionStorage.getItem(slot(owner));
      if (raw === null) return null;
      if (typeof raw !== "string" || raw.length > journalLimit || new TextEncoder().encode(raw).byteLength > journalLimit) throw failure("unavailable");
      const value = JSON.parse(raw);
      // Only our bounded canonical JSON is accepted, including no duplicate keys.
      if (JSON.stringify(value) !== raw) throw failure("unavailable");
      return parseJournal(value, owner);
    }
    return {
      read,
      write(value) {
        const entry = parseJournal(value, value.ownerId);
        if (read(entry.ownerId) !== null) throw failure("unavailable");
        window.sessionStorage.setItem(slot(entry.ownerId), JSON.stringify(entry));
        if (!matchesJournal(read(entry.ownerId), entry)) throw failure("unavailable");
        return true;
      },
      remove(value) {
        const entry = parseJournal(value, value.ownerId);
        if (!matchesJournal(read(entry.ownerId), entry)) throw failure("unavailable");
        window.sessionStorage.removeItem(slot(entry.ownerId));
        if (read(entry.ownerId) !== null) throw failure("unavailable");
        return true;
      }
    };
  }
  function createController({ fetch, identity, isCurrent, context, locale, visible, onChange = () => {}, onDispatch = () => {}, onSettled = () => {}, journal,
    makeIdempotencyKey = () => window.crypto.randomUUID() }) {
    let scope = null, ticket = 0, phase = "idle", messageKey = "ready", data = null, receipt = null, request = null, command = null;
    let journalBlocked = false;
    let sourceInspection = null;
    function readScope() {
      let owner = null, value = {}, shown = false, language = "ko", rawLocale = "", available = false;
      try {
        value = context() || {}; shown = visible() === true; rawLocale = locale(); language = locales.includes(rawLocale) ? rawLocale : "ko";
        owner = identity(); available = typeof fetch === "function" && typeof isCurrent === "function" && typeof window.LuminaCreatorBodyPreview?.parsePreview === "function";
        if (!record(owner) || !ownerId(owner.ownerId) || !count(owner.epoch) || !isCurrent(owner)) owner = null;
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
    const canRecover = () => accessible() && !command && !journalBlocked && !busy();
    const canInspectSource = () => accessible() && phase === "ready" && !command && !journalBlocked && !busy() && Boolean(data?.preview.progress?.scene);
    const currentTrial = () => accessible() && phase === "ready" && !command && !journalBlocked && data?.approvalState.state === "approval_recorded" &&
      Date.parse(data.approvalState.approval.expiresAt) > Date.now();
    const activeTrial = () => currentTrial() && data.preview.progress?.status === "active" &&
      data.preview.progress.scene && !data.preview.progress.scene.endingType;
    const readableTrialBody = () => currentTrial() && data.preview.progress?.scene?.isGenerated === true &&
      (activeTrial() || (data.preview.progress.status === "completed" &&
        data.preview.progress.scene.endingType === "ai_generated" && data.preview.progress.choices.length === 0));
    const readComplete = () => !data?.preview.progress?.scene?.isGenerated ||
      Number.isSafeInteger(data.preview.progress.currentBeatPosition) &&
      data.preview.progress.currentBeatPosition >= data.preview.progress.scene.beats.at(-1).position;
    const canChoose = () => activeTrial() && readComplete() && data.preview.progress.choices.length > 0;
    const canRecordRead = () => readableTrialBody() &&
      Number.isSafeInteger(data.preview.progress.currentBeatPosition) && !readComplete();
    function state() {
      return clone({ ticket, phase, messageKey, locale: scope?.locale || "ko", data, receipt, sourceInspection, canInspectSource: Boolean(canInspectSource()), busy: busy(),
        canLoad: Boolean(accessible() && !busy()), canChoose: Boolean(canChoose()), canRecordRead: Boolean(canRecordRead()), canRetry: Boolean(sameCommand() && !busy()),
        canRecover: Boolean(canRecover()), unresolved: Boolean(command) });
    }
    const emit = () => onChange(state());
    // The injected journal is synchronous: read(ownerId), write(entry), remove(entry).
    // Writes/removals must return true; read-back confirms the exact owner and command.
    function readJournal(owner) {
      if (!["read", "write", "remove"].every(key => typeof journal?.[key] === "function")) throw failure("unavailable");
      const saved = journal.read(owner);
      return saved === null ? null : parseJournal(saved, owner);
    }
    function restoreJournal() {
      // A failed pre-dispatch draft stays unavailable until a fresh controller.
      if (journal === undefined || !scope?.owner || (journalBlocked && !command)) return;
      try {
        const saved = readJournal(scope.owner.ownerId);
        if (command?.ownerId === scope.owner.ownerId && !matchesJournal(saved, journalEntry(command))) throw failure("unavailable");
        if (saved && (!command || command.ownerId !== saved.ownerId)) {
          const { version, ...pending } = saved;
          command = pending;
        }
      } catch (_) { journalBlocked = true; }
    }
    function persistCommand() {
      if (journal === undefined) return;
      try {
        const entry = parseJournal(journalEntry(command), command.ownerId);
        if (readJournal(entry.ownerId) !== null || journal.write(clone(entry)) !== true ||
            !matchesJournal(readJournal(entry.ownerId), entry)) throw failure("unavailable");
      } catch (_) { journalBlocked = true; throw failure("unavailable"); }
    }
    function retireCommand(sending) {
      if (journal !== undefined) {
        try {
          const entry = journalEntry(sending);
          if (!matchesJournal(readJournal(sending.ownerId), entry) || journal.remove(clone(entry)) !== true ||
              readJournal(sending.ownerId) !== null) throw failure("unavailable");
        } catch (_) { journalBlocked = true; throw failure("unavailable"); }
      }
      command = null;
      journalBlocked = false;
    }
    function clear() {
      ticket++; data = null; receipt = null; sourceInspection = null; phase = "idle";
      const old = request; request = null; old?.abort();
      // An aborted POST may already have committed. Keep its exact key until a verified receipt.
    }
    function setInitialMessage() {
      messageKey = initial(scope);
      if (messageKey === "ready" && command) { phase = "uncertain"; messageKey = sameCommand() ? "uncertain" : "unresolvedElsewhere"; }
      else if (messageKey === "ready" && journalBlocked) { phase = "error"; messageKey = "unavailable"; }
    }
    function syncContext(notify = true) {
      const next = readScope();
      if (JSON.stringify(scope) === JSON.stringify(next)) return false;
      clear(); scope = next; restoreJournal(); setInitialMessage(); if (notify) emit(); return true;
    }
    function invalidate() { clear(); scope = readScope(); restoreJournal(); setInitialMessage(); emit(); }
    function snapshot() { syncContext(); return state(); }
    function start(nextPhase, nextMessage) {
      phase = nextPhase; messageKey = nextMessage; receipt = null; sourceInspection = null;
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
      const response = await fetch(url, { ...options, identity: active.owner, _retried: options.method !== "GET", cache: "no-store",
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
          progress.status !== "active" ? "generating" : !progress.scene ? "noScene" : !readComplete() ? "readRequired" :
          hasNoChoices(progress) ? "noChoices" : "approval_recorded";
        if (!command && journalBlocked) { phase = "error"; messageKey = "unavailable"; }
        emit(); return true;
      } catch (error) {
        if (!active.current()) return false;
        data = null; request = null; phase = command ? "uncertain" : "error";
        messageKey = command ? sameCommand() ? "uncertain" : "unresolvedElsewhere" : copy.ko[error?.kind] !== undefined ? error.kind : "transport";
        emit(); return false;
      }
    }
    async function inspectSource(expectedTicket = null) {
      syncContext();
      if ((expectedTicket !== null && expectedTicket !== ticket) || !canInspectSource()) return false;
      const target = { workId: scope.workId, locale: scope.sourceLocale }, preview = data.preview;
      const previousMessage = messageKey, active = start("loading", messageKey);
      sourceInspection = { phase: "loading", data: null, messageKey: null }; emit();
      try {
        const value = await responseValue("/api/v1/me/creator-studio/stories/" + encodeURIComponent(target.workId) +
          "/body-review/memory-preparation?locale=" + encodeURIComponent(target.locale), { method: "GET" }, active, 16384);
        if (!active.current()) return false;
        sourceInspection = { phase: "ready", data: parseSourcePreparation(value, target, preview), messageKey: null };
      } catch (error) {
        if (!active.current()) return false;
        sourceInspection = { phase: "error", data: null, messageKey: copy.ko[error?.kind] !== undefined ? error.kind : "transport" };
      }
      if (!active.current()) return false;
      request = null; phase = "ready"; messageKey = previousMessage; emit();
      return sourceInspection.phase === "ready";
    }
    async function recordRead(expectedTicket = null) {
      syncContext();
      if ((expectedTicket !== null && expectedTicket !== ticket) || !canRecordRead()) return false;
      restoreJournal();
      if (command || journalBlocked) { setInitialMessage(); emit(); return false; }
      const progress = data.preview.progress, workId = scope.workId;
      const body = { approvalId: data.approvalState.approval.id, progressId: progress.progressId,
        expectedRevision: progress.revision, locale: scope.sourceLocale };
      const beatPosition = progress.scene.beats.at(-1).position;
      let key;
      try { key = "read-" + makeIdempotencyKey(); } catch (_) { key = null; }
      if (!commandKey(key)) { data = null; phase = "error"; messageKey = "unavailable"; emit(); return false; }
      const active = start("submitting", "recordingRead"); data = null; emit();
      try {
        const value = await responseValue("/api/v1/me/creator-studio/stories/" + encodeURIComponent(workId) + "/body-trial/read-beats",
          { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) }, active, 16384);
        if (!active.current()) return false;
        if (!record(value) || value.contract !== "story-author-body-trial-read-v1" || value.workId !== workId ||
            value.progressId !== body.progressId || value.sourceRevision !== body.expectedRevision ||
            value.revision !== body.expectedRevision + 1 || value.beatPosition !== beatPosition ||
            typeof value.idempotentReplay !== "boolean" || value.generationStarted !== false ||
            value.imageGenerationStarted !== false || value.readOnly !== false) throw failure("invalid");
        request = null; phase = "accepted";
        onSettled();
        if (!active.current()) return false;
        return load();
      } catch (error) {
        if (!active.current()) return false;
        // A response can be lost after a read write. Only a fresh GET may unlock another choice.
        data = null; request = null; phase = "error";
        messageKey = [400, 401, 403, 404, 409, 422].includes(error?.status) ? error.kind : "readUncertain";
        emit(); return false;
      }
    }
    async function submit(replaying) {
      const active = start("submitting", replaying ? "loading" : "submitting"), sending = command; data = null; emit();
      try {
        const root = "/api/v1/me/creator-studio/stories/" + encodeURIComponent(sending.workId) +
          "/body-trial/choices/" + encodeURIComponent(sending.choiceId);
        const query = replaying ? "/receipt?" + ["approvalId", "progressId", "expectedRevision", "locale"]
          .map(key => key + "=" + encodeURIComponent(sending.body[key])).join("&") : "";
        const options = replaying ? { method: "GET", headers: { "Idempotency-Key": sending.key } } : { method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": sending.key }, body: JSON.stringify(sending.body) };
        const value = await responseValue(root + query, options, active, 16384);
        if (!active.current()) return false;
        const verified = replaying ? parseReceiptEnvelope(value, sending) : parseReceipt(value, sending);
        retireCommand(sending);
        receipt = verified; phase = "accepted"; request = null;
        messageKey = receipt.status === "failed" ? "generationFailed" : receipt.status === "timeout" ? "generationTimeout" :
          ["queued", "processing"].includes(receipt.status) ? "generating" :
          receipt.generationStarted === false && receipt.status === "completed" ? "ending" : "accepted";
        // A sibling may have reloaded the old route while the request was still pending.
        onSettled();
        if (!active.current()) return false;
        emit(); return true;
      } catch (error) {
        if (!active.current()) return false;
        let rejected = !replaying && [400, 401, 403, 404, 409, 422].includes(error?.status);
        if (rejected) { try { retireCommand(sending); } catch (_) { rejected = false; } }
        request = null; phase = rejected ? "error" : "uncertain";
        messageKey = rejected ? error.kind : "uncertain"; emit(); return false;
      }
    }
    async function choose(choiceId, expectedTicket = null) {
      syncContext();
      if ((expectedTicket !== null && expectedTicket !== ticket) || !canChoose() || !uuid(choiceId)) return false;
      restoreJournal();
      if (command || journalBlocked) { setInitialMessage(); emit(); return false; }
      const choice = data.preview.progress.choices.find(value => value.id === choiceId.toLowerCase());
      if (!choice) return false;
      const capturedTicket = ticket;
      let key;
      try { key = makeIdempotencyKey(); } catch (_) { key = null; }
      if (!commandKey(key)) {
        data = null; phase = "error"; messageKey = "unavailable"; emit(); return false;
      }
      command = { ownerId: scope.owner.ownerId, workId: scope.workId, choiceId: choice.id, key,
        body: { approvalId: data.approvalState.approval.id, progressId: data.preview.progress.progressId,
          expectedRevision: data.preview.progress.revision, locale: scope.sourceLocale } };
      const unsent = command;
      try { persistCommand(); } catch (_) {
        // No POST has been dispatched. Keep any stored entry, but do not claim this draft was submitted.
        if (command === unsent) command = null;
        data = null; phase = "error"; messageKey = "unavailable"; emit(); return false;
      }
      syncContext();
      if (ticket !== capturedTicket || !sameCommand()) { setInitialMessage(); emit(); return false; }
      return submit(false);
    }
    async function retry(expectedTicket = null) {
      syncContext();
      if ((expectedTicket !== null && expectedTicket !== ticket) || !sameCommand() || busy()) return false;
      return submit(true);
    }
    async function recover(expectedTicket = null) {
      syncContext();
      if ((expectedTicket !== null && expectedTicket !== ticket) || !canRecover()) return false;
      restoreJournal();
      if (!canRecover()) { setInitialMessage(); emit(); return false; }
      const target = { workId: scope.workId }, active = start("loading", "loading"); data = null; emit();
      try {
        const pending = parseRecovery(await responseValue("/api/v1/me/creator-studio/stories/" + encodeURIComponent(target.workId) +
          "/body-trial/recovery", { method: "GET" }, active, journalLimit), target);
        if (!active.current()) return false;
        // A local command may have appeared while the lookup was in flight. Never replace it, even with null.
        restoreJournal();
        if (!active.current()) return false;
        if (command || journalBlocked) { request = null; setInitialMessage(); emit(); return false; }
        if (pending === null) { request = null; phase = "idle"; messageKey = "recoveryEmpty"; emit(); return true; }
        command = { ownerId: active.owner.ownerId, ...pending };
        persistCommand();
        if (!active.current()) return false;
        request = null; phase = "uncertain"; messageKey = sameCommand() ? "uncertain" : "unresolvedElsewhere";
        emit(); return true;
      } catch (error) {
        if (!active.current()) return false;
        // Unlike an unsent paid draft, a recovered command already has server evidence; retain it on storage failure.
        request = null; phase = command ? "uncertain" : "error";
        messageKey = journalBlocked ? "unavailable" : command ? sameCommand() ? "uncertain" : "unresolvedElsewhere" :
          copy.ko[error?.kind] !== undefined ? error.kind : "transport";
        emit(); return false;
      }
    }
    syncContext(false);
    return { snapshot, syncContext, invalidate, load, choose, recordRead, retry, recover, inspectSource };
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
      if (!icon) icon = element("span", "", name === "RefreshCw" ? "\u21bb" : name === "History" ? "\u25f7" : name === "Info" ? "i" : "\u21a9");
      icon.setAttribute("aria-hidden", "true"); button.append(icon); tools.append(button); return button;
    }
    const refresh = iconButton("RefreshCw"), retry = iconButton("RotateCcw"), recover = iconButton("History");
    const inspect = iconButton("Info"); inspect.id = "writerBodyTrialSourceInspect";
    refresh.id = "writerBodyTrialRefresh"; retry.id = "writerBodyTrialRetry"; recover.id = "writerBodyTrialRecover";
    header.append(heading, tools);
    const status = element("p", "body-trial-state"), content = element("div", "body-trial-content");
    status.id = "writerBodyTrialState"; content.id = "writerBodyTrialContent";
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); host.replaceChildren(header, status, content);
    const visible = () => !shell.hidden && !section.hidden && !host.hidden && section.classList.contains("is-active") && document.visibilityState !== "hidden";
    const formatMoney = (value, maximum = false, unit = " KRW") => {
      // Only labels round: balances use nearest won, maxima round up; checks retain exact micro-won.
      const whole = ((micros(value) + (maximum ? 999999n : 500000n)) / 1000000n).toString();
      return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + unit;
    };
    let controller, expiryTimer = null;
    function scheduleExpiry(state) {
      if (expiryTimer !== null) { window.clearTimeout(expiryTimer); expiryTimer = null; }
      const trial = state.data?.approvalState;
      if (state.phase !== "ready" || state.busy || state.unresolved || trial?.state !== "approval_recorded" ||
          typeof window.setTimeout !== "function" || typeof window.clearTimeout !== "function") return;
      const expires = Date.parse(trial.approval.expiresAt), delay = expires - Date.now(), ticket = state.ticket;
      if (delay <= 0) return;
      // This deadline only refreshes local display; it never polls, dispatches, or extends approval.
      expiryTimer = window.setTimeout(() => {
        expiryTimer = null;
        const current = controller.snapshot();
        if (current.ticket !== ticket) return;
        render(current);
      }, Math.min(delay, 2147483647));
    }
    function render(state) {
      scheduleExpiry(state);
      const words = copy[state.locale]; title.textContent = words.title; privacy.textContent = words.privacy;
      host.lang = state.locale; host.setAttribute("aria-busy", String(state.busy));
      for (const [button, label, enabled] of [[refresh, words.refresh, state.canLoad], [retry, words.retry, state.canRetry], [recover, words.recover, state.canRecover]]) {
        button.title = label; button.setAttribute("aria-label", label); button.disabled = !enabled;
      }
      retry.hidden = !state.unresolved;
      inspect.title = sourceLabels[state.locale][0]; inspect.setAttribute("aria-label", inspect.title);
      inspect.disabled = !state.canInspectSource;
      const expired = state.phase === "ready" && !state.unresolved && state.data?.approvalState.state === "approval_recorded" &&
        Date.parse(state.data.approvalState.approval.expiresAt) <= Date.now();
      status.textContent = (state.receipt ? words.receiptResult + ": " : "") + words[expired ? "approval_expired" : state.messageKey];
      status.className = "body-trial-state" + (["error", "uncertain"].includes(state.phase) ? " is-error" : "");
      content.replaceChildren();
      const trial = state.data?.approvalState, budget = trial?.budget;
      if (budget) {
        const metadata = element("dl", "body-trial-budget");
        for (const [label, value] of [[words.approved, budget.approvedBudgetKrw], [words.committed, budget.committedCostKrw], [words.remaining, budget.remainingBudgetKrw]]) {
          const row = element("div"); row.append(element("dt", "", label), element("dd", "", value === null ? words.unknown : formatMoney(value))); metadata.append(row);
        }
        content.append(metadata);
        if (budget.costScope === "approved_historical_unknown_separation" && budget.historicalUnknownCostCount === 2) {
          const historical = element("p", "body-trial-state", words.historicalUnknownSeparated);
          historical.id = "writerBodyTrialHistoricalCosts"; historical.setAttribute("role", "note"); content.append(historical);
        }
      }
      if (trial) {
        const quote = nextCostQuote(trial, trial), prepared = state.phase === "ready" && !state.busy && !state.unresolved &&
          quote.nextCostQuoteState === "prepared";
        const reasonKey = { approval_required: "approval_required", approval_expired: "approval_expired", release_changed: "release_changed",
          cost_unknown: "cost_unknown", budget_over_limit: "budget_over_limit", pending_cost: "generating", approval_pins_changed: "conflict" }[quote.nextCostQuoteReason];
        const label = prepared ? words.nextCostMaximum + " " + formatMoney(quote.nextMaximumCostKrw, true, state.locale === "ko" ? "\uc6d0" : " KRW")
          : words.nextCostUnavailable + (reasonKey ? ": " + words[reasonKey] : "");
        const notice = element("p", "body-trial-state", label);
        notice.id = "writerBodyTrialNextCost"; notice.setAttribute("role", "note"); content.append(notice);
      }
      const inspected = state.sourceInspection, labels = sourceLabels[state.locale];
      if (inspected) {
        const panel = element("section", "body-trial-source-status"); panel.id = "writerBodyTrialSourceStatus";
        panel.append(element("h4", "", labels[1]));
        const message = inspected.phase === "loading" ? labels[6] : inspected.phase === "error" ? words[inspected.messageKey] :
          labels[{ reviewable: 2, source_changed: 3, not_generated: 4, generation_pending: 5 }[inspected.data.state]];
        const notice = element("p", "body-trial-state", message); notice.setAttribute("role", "status"); panel.append(notice);
        if (inspected.data?.state === "reviewable") {
          const review = inspected.data.bodyReview;
          const decision = !review ? labels[10] : review.applicability === "withdrawn" ? labels[14] :
            review.applicability !== "current" ? labels[15] : review.decision === "reject" ? labels[13] :
            labels[review.approvalBasis === "company_delegation" ? 11 : 12];
          const values = element("dl", "body-trial-budget");
          for (const [label, value] of [[labels[7], inspected.data.releaseVersion], [labels[8], inspected.data.progressRevision], [labels[9], decision]]) {
            const row = element("div"); row.append(element("dt", "", label), element("dd", "", String(value))); values.append(row);
          }
          panel.append(values);
        }
        content.append(panel);
      }
      const progress = state.data?.preview.progress;
      if (!progress) return;
      const source = element("div", "body-trial-source"); source.lang = state.data.preview.locale;
      if (progress.scene) {
        source.append(element("h4", "", progress.scene.title));
        for (const beat of progress.scene.beats) source.append(element("p", "body-trial-beat", beat.content));
      }
      if (state.canRecordRead) {
        const button = element("button", "body-trial-choice body-trial-read"); button.type = "button";
        button.id = "writerBodyTrialRead"; button.title = words.recordRead;
        try { if (window.lucide?.icons?.BookCheck) button.append(window.lucide.createElement(window.lucide.icons.BookCheck)); } catch (_) {}
        button.append(element("span", "", words.recordRead));
        const capturedTicket = state.ticket;
        button.addEventListener("click", () => controller.recordRead(capturedTicket)); source.append(button);
      }
      if (hasNoChoices(progress) && state.messageKey !== "noChoices" && !state.unresolved) {
        const note = element("p", "body-trial-state", words.noChoices);
        note.id = "writerBodyTrialNoChoices"; note.lang = state.locale; note.setAttribute("role", "note"); source.append(note);
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
        if (options.method === "GET") return window.LuminaCreatorStudioApi.fetch(url, options);
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
      onDispatch: () => window.dispatchEvent(new Event("lumina:author-body-trial-progress-changed")),
      onSettled: () => window.dispatchEvent(new Event("lumina:author-body-trial-progress-changed")), journal: sessionJournal()
    });
    refresh.addEventListener("click", () => { if (!refresh.disabled) return controller.load(controller.snapshot().ticket); });
    retry.addEventListener("click", () => { if (!retry.disabled) return controller.retry(controller.snapshot().ticket); });
    recover.addEventListener("click", () => { if (!recover.disabled) return controller.recover(controller.snapshot().ticket); });
    inspect.addEventListener("click", () => { if (!inspect.disabled) return controller.inspectSource(controller.snapshot().ticket); });
    const sync = () => { controller.syncContext(); render(controller.snapshot()); }, erase = () => controller.invalidate();
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
  window.LuminaCreatorBodyTrial = { createController, parseState, parseReceipt, parseRecovery, parseSourcePreparation, mount, copy };
  if (typeof document !== "undefined") mount(document.getElementById("writerBodyTrial"));
})();
