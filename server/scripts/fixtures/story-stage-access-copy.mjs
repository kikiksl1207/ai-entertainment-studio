// Private QA source excerpts from pages/story-stage.js at
// 79a11d697bad64cae7fdb87ae84e07e540fdfcb7; escapes preserve the original text.
export const accessCopySource = `  const ACCESS_COPY = {
    ko: {
      priceLabel: "\uac00\uaca9",
      entitlementReady: "\uc774\uc6a9 \uac00\ub2a5",
      purchaseReady: "\uad6c\ub9e4 \ud544\uc694",
      freeAccess: "\ubb34\ub8cc \uc774\uc6a9 \uac00\ub2a5",
      aiAvailable: "AI \uc120\ud0dd \uac00\ub2a5",
      aiUnavailable: "AI \uc120\ud0dd \uc5c6\uc74c",
      replayReady: "\uc774\uc5b4\ubcf4\uae30\uc640 \ub2e4\uc2dc \uc2dc\uc791\uc744 \uc0ac\uc6a9\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.",
      purchaseNotice: "\uad6c\ub9e4\ub294 \uc2b9\uc778\ub41c \uacb0\uc81c \ud750\ub984\uc5d0\uc11c\ub9cc \uc9c4\ud589\ub429\ub2c8\ub2e4.",
      modalLabel: "\uc791\ud488 \uc0c1\uc138",
    },
    en: {
      priceLabel: "Price",
      entitlementReady: "Available",
      purchaseReady: "Purchase required",
      freeAccess: "Free access",
      aiAvailable: "AI choice available",
      aiUnavailable: "AI choice unavailable",
      replayReady: "Continue and restart are available.",
      purchaseNotice: "Purchases run only through the approved payment flow.",
      modalLabel: "Story detail",
    },
    ja: {
      priceLabel: "\u4fa1\u683c",
      entitlementReady: "\u5229\u7528\u53ef\u80fd",
      purchaseReady: "\u8cfc\u5165\u304c\u5fc5\u8981",
      freeAccess: "\u7121\u6599\u3067\u5229\u7528\u53ef\u80fd",
      aiAvailable: "AI\u9078\u629e\u304c\u5229\u7528\u53ef\u80fd",
      aiUnavailable: "AI\u9078\u629e\u306a\u3057",
      replayReady: "\u7d9a\u304d\u304b\u3089\u518d\u958b\u3068\u6700\u521d\u304b\u3089\u518d\u958b\u3092\u5229\u7528\u3067\u304d\u307e\u3059\u3002",
      purchaseNotice: "\u8cfc\u5165\u306f\u627f\u8a8d\u3055\u308c\u305f\u6c7a\u6e08\u30d5\u30ed\u30fc\u3067\u306e\u307f\u9032\u884c\u3057\u307e\u3059\u3002",
      modalLabel: "\u4f5c\u54c1\u8a73\u7d30",
    },
    "zh-Hans": {
      priceLabel: "\u4ef7\u683c",
      entitlementReady: "\u53ef\u4f7f\u7528",
      purchaseReady: "\u9700\u8981\u8d2d\u4e70",
      freeAccess: "\u53ef\u514d\u8d39\u4f7f\u7528",
      aiAvailable: "\u53ef\u4f7f\u7528 AI \u9009\u62e9",
      aiUnavailable: "\u65e0 AI \u9009\u62e9",
      replayReady: "\u53ef\u7ee7\u7eed\u9605\u8bfb\u6216\u91cd\u65b0\u5f00\u59cb\u3002",
      purchaseNotice: "\u8d2d\u4e70\u4ec5\u901a\u8fc7\u5df2\u6279\u51c6\u7684\u652f\u4ed8\u6d41\u7a0b\u8fdb\u884c\u3002",
      modalLabel: "\u4f5c\u54c1\u8be6\u60c5",
    },
    "zh-Hant": {
      priceLabel: "\u50f9\u683c",
      entitlementReady: "\u53ef\u4f7f\u7528",
      purchaseReady: "\u9700\u8981\u8cfc\u8cb7",
      freeAccess: "\u53ef\u514d\u8cbb\u4f7f\u7528",
      aiAvailable: "\u53ef\u4f7f\u7528 AI \u9078\u64c7",
      aiUnavailable: "\u7121 AI \u9078\u64c7",
      replayReady: "\u53ef\u7e7c\u7e8c\u95b1\u8b80\u6216\u91cd\u65b0\u958b\u59cb\u3002",
      purchaseNotice: "\u8cfc\u8cb7\u50c5\u900f\u904e\u5df2\u6838\u51c6\u7684\u4ed8\u6b3e\u6d41\u7a0b\u9032\u884c\u3002",
      modalLabel: "\u4f5c\u54c1\u8a73\u60c5",
    },
  };

`;

export const accessTranslatorSource = `  function accessTr(key) {
    return ACCESS_COPY[state.locale]?.[key] || ACCESS_COPY.ko[key] || "";
  }

`;
