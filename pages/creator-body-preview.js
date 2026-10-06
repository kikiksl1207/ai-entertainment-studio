(function () {
  "use strict";
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const maxBytes = 256 * 1024;
  const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const positive = value => Number.isSafeInteger(value) && value > 0;
  const token = value => typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/i.test(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const failure = kind => Object.assign(new Error("Body preview unavailable"), { kind });
  const copy = {
    ko: {
      title: "\uc800\uc7a5\ub41c \ub3c5\uc790 \ubcf8\ubb38", privacy: "\ube44\uacf5\uac1c \u00b7 \uc77d\uae30 \uc804\uc6a9", refresh: "\uc800\uc7a5\ub41c \ubcf8\ubb38 \uc0c8\ub85c\uace0\uce68",
      ready: "\uc800\uc7a5\ub41c \ubcf8\ubb38\uc744 \ud655\uc778\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.", noWork: "\uc120\ud0dd\ub41c \uc791\ud488\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.", loading: "\uc800\uc7a5\ub41c \ubcf8\ubb38\uc744 \ud655\uc778\ud558\uace0 \uc788\uc2b5\ub2c8\ub2e4.",
      noProgress: "\uc774 \uc791\ud488\uc758 \ub0b4 \ub3c5\uc790 \uc9c4\ud589\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.", noScene: "\ud604\uc7ac \uc9c4\ud589\uc5d0 \uc800\uc7a5\ub41c \uc7a5\uba74\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
      generating: "\ud604\uc7ac \uc9c4\ud589\uc740 \uc0dd\uc131 \ub300\uae30 \ub610\ub294 \uc0dd\uc131 \uc911\uc785\ub2c8\ub2e4.", ending: "\uc5d4\ub529", body: "\ubcf8\ubb38", choices: "\uc800\uc7a5\ub41c \uc120\ud0dd\uc9c0",
      status: "\uc9c4\ud589 \uc0c1\ud0dc", revision: "\uacbd\ub85c \ubc84\uc804", version: "\uc2a4\ud1a0\ub9ac \ubc84\uc804", source: "\uc6d0\ubb38 \uc5b8\uc5b4",
      statusActive: "\uc77d\ub294 \uc911", statusPending: "\uc0dd\uc131 \ub300\uae30 \ub610\ub294 \uc0dd\uc131 \uc911", statusCompleted: "\uc5d4\ub529 \ub3c4\ub2ec", statusOther: "\uc0c1\ud0dc \ud655\uc778 \ud544\uc694",
      endingOriginal: "\uc6d0\uc791 \uc5d4\ub529", endingAlternate: "\ub2e4\ub978 \uc6d0\uc791 \uc5d4\ub529", endingGenerated: "AI \ubd84\uae30 \uc5d4\ub529", endingOther: "\uc774\uc57c\uae30 \uc5d4\ub529",
      routeOriginal: "\uc6d0\uc791 \uacbd\ub85c", routeGeneration: "\uc0dd\uc131\uc774 \ud544\uc694\ud55c \ubd84\uae30", routeBranch: "\ubd84\uae30 \uacbd\ub85c", routeRejoin: "\uc6d0\uc791\uc73c\ub85c \ud569\ub958", routeEnding: "\uc5d4\ub529 \uacbd\ub85c", routeOther: "\ub2e4\ub978 \uacbd\ub85c",
      unauthenticated: "\ub85c\uadf8\uc778\uc774 \ud544\uc694\ud569\ub2c8\ub2e4. \ud604\uc7ac \ub85c\uadf8\uc778 \uc0c1\ud0dc\ub97c \ud655\uc778\ud574 \uc8fc\uc138\uc694.", forbidden: "\uc774 \uc791\ud488\uc758 \ubcf8\ubb38\uc744 \ud655\uc778\ud560 \uad8c\ud55c\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.",
      notFound: "\uc791\ud488 \ub610\ub294 \uc800\uc7a5\ub41c \uc9c4\ud589\uc744 \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.", conflict: "\ud604\uc7ac \uc9c4\ud589\uc758 \uc6d0\ubb38 \uc5b8\uc5b4\ub97c \ud655\uc778\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4. \uc800\uc7a5\ub41c \ubcf8\ubb38\uc744 \uc9c0\uc6e0\uc2b5\ub2c8\ub2e4.",
      server: "\uc11c\ubc84 \ubb38\uc81c\ub85c \ud604\uc7ac \ubcf8\ubb38\uc744 \ud655\uc778\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.", transport: "\uc5f0\uacb0 \ubb38\uc81c\ub85c \ud604\uc7ac \ubcf8\ubb38\uc744 \ud655\uc778\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.",
      invalid: "\ubcf8\ubb38 \uc751\ub2f5\uc744 \uac80\uc99d\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.", unavailable: "\ud604\uc7ac \ubcf8\ubb38 \ud655\uc778\uc744 \uc774\uc6a9\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.", hidden: ""
    },
    en: {
      title: "Saved reader text", privacy: "Private \u00b7 Read only", refresh: "Refresh saved text",
      ready: "Saved text is available to check.", noWork: "No story is selected.", loading: "Checking saved text.",
      noProgress: "You have no reader progress for this story.", noScene: "There is no saved scene in your current progress.",
      generating: "Your current progress is pending or generating.", ending: "Ending", body: "Text", choices: "Saved choices",
      status: "Progress status", revision: "Path version", version: "Story version", source: "Original language",
      statusActive: "Reading", statusPending: "Pending or generating", statusCompleted: "Ending reached", statusOther: "Status needs checking",
      endingOriginal: "Original ending", endingAlternate: "Alternate original ending", endingGenerated: "AI branch ending", endingOther: "Story ending",
      routeOriginal: "Original path", routeGeneration: "Branch requiring generation", routeBranch: "Branch path", routeRejoin: "Rejoin the original", routeEnding: "Ending path", routeOther: "Other path",
      unauthenticated: "Sign-in is required. Check your current session.", forbidden: "You do not have permission to view this story's text.",
      notFound: "The story or saved progress was not found.", conflict: "The original language is unavailable for the current progress. Saved text was cleared.",
      server: "A server error prevented checking the current text.", transport: "A connection error prevented checking the current text.",
      invalid: "The text response could not be verified.", unavailable: "Text preview is currently unavailable.", hidden: ""
    },
    ja: {
      title: "\u4fdd\u5b58\u3055\u308c\u305f\u8aad\u8005\u672c\u6587", privacy: "\u975e\u516c\u958b \u00b7 \u8aad\u307f\u53d6\u308a\u5c02\u7528", refresh: "\u4fdd\u5b58\u3055\u308c\u305f\u672c\u6587\u3092\u66f4\u65b0",
      ready: "\u4fdd\u5b58\u3055\u308c\u305f\u672c\u6587\u3092\u78ba\u8a8d\u3067\u304d\u307e\u3059\u3002", noWork: "\u4f5c\u54c1\u304c\u9078\u629e\u3055\u308c\u3066\u3044\u307e\u305b\u3093\u3002", loading: "\u4fdd\u5b58\u3055\u308c\u305f\u672c\u6587\u3092\u78ba\u8a8d\u3057\u3066\u3044\u307e\u3059\u3002",
      noProgress: "\u3053\u306e\u4f5c\u54c1\u306e\u81ea\u5206\u306e\u8aad\u8005\u9032\u884c\u306f\u3042\u308a\u307e\u305b\u3093\u3002", noScene: "\u73fe\u5728\u306e\u9032\u884c\u306b\u4fdd\u5b58\u3055\u308c\u305f\u30b7\u30fc\u30f3\u306f\u3042\u308a\u307e\u305b\u3093\u3002",
      generating: "\u73fe\u5728\u306e\u9032\u884c\u306f\u751f\u6210\u5f85\u3061\u3001\u307e\u305f\u306f\u751f\u6210\u4e2d\u3067\u3059\u3002", ending: "\u30a8\u30f3\u30c7\u30a3\u30f3\u30b0", body: "\u672c\u6587", choices: "\u4fdd\u5b58\u3055\u308c\u305f\u9078\u629e\u80a2",
      status: "\u9032\u884c\u72b6\u614b", revision: "\u7d4c\u8def\u306e\u30d0\u30fc\u30b8\u30e7\u30f3", version: "\u30b9\u30c8\u30fc\u30ea\u30fc\u30d0\u30fc\u30b8\u30e7\u30f3", source: "\u539f\u6587\u306e\u8a00\u8a9e",
      statusActive: "\u8aad\u66f8\u4e2d", statusPending: "\u751f\u6210\u5f85\u3061\u3001\u307e\u305f\u306f\u751f\u6210\u4e2d", statusCompleted: "\u30a8\u30f3\u30c7\u30a3\u30f3\u30b0\u306b\u5230\u9054", statusOther: "\u72b6\u614b\u306e\u78ba\u8a8d\u304c\u5fc5\u8981",
      endingOriginal: "\u539f\u4f5c\u306e\u30a8\u30f3\u30c7\u30a3\u30f3\u30b0", endingAlternate: "\u5225\u306e\u539f\u4f5c\u30a8\u30f3\u30c7\u30a3\u30f3\u30b0", endingGenerated: "AI\u5206\u5c90\u306e\u30a8\u30f3\u30c7\u30a3\u30f3\u30b0", endingOther: "\u7269\u8a9e\u306e\u30a8\u30f3\u30c7\u30a3\u30f3\u30b0",
      routeOriginal: "\u539f\u4f5c\u306e\u7d4c\u8def", routeGeneration: "\u751f\u6210\u304c\u5fc5\u8981\u306a\u5206\u5c90", routeBranch: "\u5206\u5c90\u306e\u7d4c\u8def", routeRejoin: "\u539f\u4f5c\u306b\u5408\u6d41", routeEnding: "\u30a8\u30f3\u30c7\u30a3\u30f3\u30b0\u3078\u306e\u7d4c\u8def", routeOther: "\u5225\u306e\u7d4c\u8def",
      unauthenticated: "\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981\u3067\u3059\u3002\u73fe\u5728\u306e\u30ed\u30b0\u30a4\u30f3\u72b6\u614b\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002", forbidden: "\u3053\u306e\u4f5c\u54c1\u306e\u672c\u6587\u3092\u78ba\u8a8d\u3059\u308b\u6a29\u9650\u304c\u3042\u308a\u307e\u305b\u3093\u3002",
      notFound: "\u4f5c\u54c1\u307e\u305f\u306f\u4fdd\u5b58\u3055\u308c\u305f\u9032\u884c\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002", conflict: "\u73fe\u5728\u306e\u9032\u884c\u306e\u539f\u6587\u8a00\u8a9e\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3002\u4fdd\u5b58\u3055\u308c\u305f\u672c\u6587\u3092\u6d88\u53bb\u3057\u307e\u3057\u305f\u3002",
      server: "\u30b5\u30fc\u30d0\u30fc\u306e\u554f\u984c\u3067\u73fe\u5728\u306e\u672c\u6587\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002", transport: "\u63a5\u7d9a\u306e\u554f\u984c\u3067\u73fe\u5728\u306e\u672c\u6587\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002",
      invalid: "\u672c\u6587\u306e\u5fdc\u7b54\u3092\u691c\u8a3c\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002", unavailable: "\u73fe\u5728\u3001\u672c\u6587\u306e\u78ba\u8a8d\u306f\u5229\u7528\u3067\u304d\u307e\u305b\u3093\u3002", hidden: ""
    },
    "zh-Hans": {
      title: "\u5df2\u4fdd\u5b58\u7684\u8bfb\u8005\u6b63\u6587", privacy: "\u79c1\u5bc6 \u00b7 \u53ea\u8bfb", refresh: "\u5237\u65b0\u5df2\u4fdd\u5b58\u7684\u6b63\u6587",
      ready: "\u53ef\u4ee5\u67e5\u770b\u5df2\u4fdd\u5b58\u7684\u6b63\u6587\u3002", noWork: "\u672a\u9009\u62e9\u4f5c\u54c1\u3002", loading: "\u6b63\u5728\u68c0\u67e5\u5df2\u4fdd\u5b58\u7684\u6b63\u6587\u3002",
      noProgress: "\u60a8\u5728\u6b64\u4f5c\u54c1\u4e2d\u6ca1\u6709\u8bfb\u8005\u8fdb\u5ea6\u3002", noScene: "\u5f53\u524d\u8fdb\u5ea6\u4e2d\u6ca1\u6709\u5df2\u4fdd\u5b58\u7684\u573a\u666f\u3002",
      generating: "\u5f53\u524d\u8fdb\u5ea6\u6b63\u5728\u7b49\u5f85\u751f\u6210\u6216\u751f\u6210\u4e2d\u3002", ending: "\u7ed3\u5c40", body: "\u6b63\u6587", choices: "\u5df2\u4fdd\u5b58\u7684\u9009\u9879",
      status: "\u8fdb\u5ea6\u72b6\u6001", revision: "\u8def\u7ebf\u7248\u672c", version: "\u6545\u4e8b\u7248\u672c", source: "\u539f\u6587\u8bed\u8a00",
      statusActive: "\u9605\u8bfb\u4e2d", statusPending: "\u7b49\u5f85\u751f\u6210\u6216\u751f\u6210\u4e2d", statusCompleted: "\u5df2\u5230\u8fbe\u7ed3\u5c40", statusOther: "\u72b6\u6001\u9700\u8981\u786e\u8ba4",
      endingOriginal: "\u539f\u4f5c\u7ed3\u5c40", endingAlternate: "\u5176\u4ed6\u539f\u4f5c\u7ed3\u5c40", endingGenerated: "AI\u5206\u652f\u7ed3\u5c40", endingOther: "\u6545\u4e8b\u7ed3\u5c40",
      routeOriginal: "\u539f\u4f5c\u8def\u7ebf", routeGeneration: "\u9700\u8981\u751f\u6210\u7684\u5206\u652f", routeBranch: "\u5206\u652f\u8def\u7ebf", routeRejoin: "\u56de\u5f52\u539f\u4f5c", routeEnding: "\u7ed3\u5c40\u8def\u7ebf", routeOther: "\u5176\u4ed6\u8def\u7ebf",
      unauthenticated: "\u9700\u8981\u767b\u5f55\u3002\u8bf7\u68c0\u67e5\u5f53\u524d\u767b\u5f55\u72b6\u6001\u3002", forbidden: "\u60a8\u65e0\u6743\u67e5\u770b\u6b64\u4f5c\u54c1\u7684\u6b63\u6587\u3002",
      notFound: "\u672a\u627e\u5230\u4f5c\u54c1\u6216\u5df2\u4fdd\u5b58\u7684\u8fdb\u5ea6\u3002", conflict: "\u5f53\u524d\u8fdb\u5ea6\u7684\u539f\u6587\u8bed\u8a00\u4e0d\u53ef\u7528\u3002\u5df2\u6e05\u9664\u4fdd\u5b58\u7684\u6b63\u6587\u3002",
      server: "\u670d\u52a1\u5668\u9519\u8bef\u5bfc\u81f4\u65e0\u6cd5\u68c0\u67e5\u5f53\u524d\u6b63\u6587\u3002", transport: "\u8fde\u63a5\u9519\u8bef\u5bfc\u81f4\u65e0\u6cd5\u68c0\u67e5\u5f53\u524d\u6b63\u6587\u3002",
      invalid: "\u65e0\u6cd5\u9a8c\u8bc1\u6b63\u6587\u54cd\u5e94\u3002", unavailable: "\u6b63\u6587\u9884\u89c8\u6682\u65f6\u4e0d\u53ef\u7528\u3002", hidden: ""
    },
    "zh-Hant": {
      title: "\u5df2\u5132\u5b58\u7684\u8b80\u8005\u6b63\u6587", privacy: "\u79c1\u5bc6 \u00b7 \u552f\u8b80", refresh: "\u91cd\u65b0\u6574\u7406\u5df2\u5132\u5b58\u7684\u6b63\u6587",
      ready: "\u53ef\u4ee5\u67e5\u770b\u5df2\u5132\u5b58\u7684\u6b63\u6587\u3002", noWork: "\u672a\u9078\u64c7\u4f5c\u54c1\u3002", loading: "\u6b63\u5728\u6aa2\u67e5\u5df2\u5132\u5b58\u7684\u6b63\u6587\u3002",
      noProgress: "\u60a8\u5728\u6b64\u4f5c\u54c1\u4e2d\u6c92\u6709\u8b80\u8005\u9032\u5ea6\u3002", noScene: "\u76ee\u524d\u9032\u5ea6\u4e2d\u6c92\u6709\u5df2\u5132\u5b58\u7684\u5834\u666f\u3002",
      generating: "\u76ee\u524d\u9032\u5ea6\u6b63\u5728\u7b49\u5f85\u751f\u6210\u6216\u751f\u6210\u4e2d\u3002", ending: "\u7d50\u5c40", body: "\u6b63\u6587", choices: "\u5df2\u5132\u5b58\u7684\u9078\u9805",
      status: "\u9032\u5ea6\u72c0\u614b", revision: "\u8def\u7dda\u7248\u672c", version: "\u6545\u4e8b\u7248\u672c", source: "\u539f\u6587\u8a9e\u8a00",
      statusActive: "\u95b1\u8b80\u4e2d", statusPending: "\u7b49\u5f85\u751f\u6210\u6216\u751f\u6210\u4e2d", statusCompleted: "\u5df2\u5230\u9054\u7d50\u5c40", statusOther: "\u72c0\u614b\u9700\u8981\u78ba\u8a8d",
      endingOriginal: "\u539f\u4f5c\u7d50\u5c40", endingAlternate: "\u5176\u4ed6\u539f\u4f5c\u7d50\u5c40", endingGenerated: "AI\u5206\u652f\u7d50\u5c40", endingOther: "\u6545\u4e8b\u7d50\u5c40",
      routeOriginal: "\u539f\u4f5c\u8def\u7dda", routeGeneration: "\u9700\u8981\u751f\u6210\u7684\u5206\u652f", routeBranch: "\u5206\u652f\u8def\u7dda", routeRejoin: "\u56de\u6b78\u539f\u4f5c", routeEnding: "\u7d50\u5c40\u8def\u7dda", routeOther: "\u5176\u4ed6\u8def\u7dda",
      unauthenticated: "\u9700\u8981\u767b\u5165\u3002\u8acb\u6aa2\u67e5\u76ee\u524d\u767b\u5165\u72c0\u614b\u3002", forbidden: "\u60a8\u7121\u6b0a\u67e5\u770b\u6b64\u4f5c\u54c1\u7684\u6b63\u6587\u3002",
      notFound: "\u672a\u627e\u5230\u4f5c\u54c1\u6216\u5df2\u5132\u5b58\u7684\u9032\u5ea6\u3002", conflict: "\u76ee\u524d\u9032\u5ea6\u7684\u539f\u6587\u8a9e\u8a00\u7121\u6cd5\u4f7f\u7528\u3002\u5df2\u6e05\u9664\u5132\u5b58\u7684\u6b63\u6587\u3002",
      server: "\u4f3a\u670d\u5668\u932f\u8aa4\u5c0e\u81f4\u7121\u6cd5\u6aa2\u67e5\u76ee\u524d\u6b63\u6587\u3002", transport: "\u9023\u7dda\u932f\u8aa4\u5c0e\u81f4\u7121\u6cd5\u6aa2\u67e5\u76ee\u524d\u6b63\u6587\u3002",
      invalid: "\u7121\u6cd5\u9a57\u8b49\u6b63\u6587\u56de\u61c9\u3002", unavailable: "\u6b63\u6587\u9810\u89bd\u66ab\u6642\u7121\u6cd5\u4f7f\u7528\u3002", hidden: ""
    }
  };
  const localeNames = { ko: "\ud55c\uad6d\uc5b4", en: "English", ja: "\u65e5\u672c\u8a9e", "zh-Hans": "\u7b80\u4f53\u4e2d\u6587", "zh-Hant": "\u7e41\u9ad4\u4e2d\u6587" };
  const pending = status => status === "ai_pending" || /^(pending|generating)/i.test(status);
  function validText(value, limit) {
    if (typeof value !== "string" || value.length > limit || !value.trim() ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return false;
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++index);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      } else if (code >= 0xdc00 && code <= 0xdfff) return false;
    }
    return true;
  }
  function parsePreview(value, target) {
    const bad = () => { throw failure("invalid"); };
    if (!record(value) || !uuid(target?.workId) || !locales.includes(target.locale) ||
        value.contract !== "story-author-body-preview-v1" || !uuid(value.workId) ||
        value.workId.toLowerCase() !== target.workId.toLowerCase() || value.locale !== target.locale ||
        value.readOnly !== true || value.imageGenerationStarted !== false ||
        new TextEncoder().encode(JSON.stringify(value)).byteLength > maxBytes) bad();
    const result = { contract: value.contract, workId: value.workId.toLowerCase(), locale: value.locale,
      readOnly: true, imageGenerationStarted: false, progress: null };
    if (value.progress === null) return result;
    const progress = value.progress;
    const hasReadPosition = Object.prototype.hasOwnProperty.call(progress || {}, "currentBeatPosition");
    if (!record(progress) || !uuid(progress.progressId) || !positive(progress.revision) || !positive(progress.storyVersion) ||
        !token(progress.status) || !Array.isArray(progress.choices) || progress.choices.length > 3 ||
        (hasReadPosition && (!Number.isSafeInteger(progress.currentBeatPosition) || progress.currentBeatPosition < 0 || progress.currentBeatPosition > 40)) ||
        ((progress.scene === null || progress.status === "completed") && progress.choices.length !== 0)) bad();
    let scene = null;
    if (progress.scene !== null) {
      const source = progress.scene;
      if (!record(source) || !uuid(source.id) || typeof source.isGenerated !== "boolean" || !validText(source.title, 1000) ||
          !(source.endingType === null || token(source.endingType)) || !Array.isArray(source.beats) || !source.beats.length || source.beats.length > 40) bad();
      const ids = new Set(); let lastPosition = 0;
      const beats = source.beats.map(beat => {
        if (!record(beat) || !uuid(beat.id) || ids.has(beat.id.toLowerCase()) || !positive(beat.position) ||
            beat.position > 40 || beat.position <= lastPosition || !token(beat.type) || !validText(beat.content, 64000)) bad();
        ids.add(beat.id.toLowerCase()); lastPosition = beat.position;
        return { id: beat.id.toLowerCase(), position: beat.position, type: beat.type, content: beat.content };
      });
      scene = { id: source.id.toLowerCase(), isGenerated: source.isGenerated, title: source.title, beats, endingType: source.endingType };
      if (hasReadPosition && source.isGenerated && progress.currentBeatPosition > lastPosition) bad();
    }
    const ids = new Set();
    const choices = progress.choices.map(choice => {
      if (!record(choice) || !uuid(choice.id) || ids.has(choice.id.toLowerCase()) ||
          !validText(choice.label, 1000) || !token(choice.routeKind)) bad();
      ids.add(choice.id.toLowerCase());
      return { id: choice.id.toLowerCase(), label: choice.label, routeKind: choice.routeKind };
    });
    result.progress = { progressId: progress.progressId.toLowerCase(), revision: progress.revision,
      status: progress.status, storyVersion: progress.storyVersion, scene, choices,
      ...(hasReadPosition ? { currentBeatPosition: progress.currentBeatPosition } : {}) };
    return result;
  }
  async function readBody(response, current) {
    const size = response.headers?.get?.("content-length");
    if (size && (!/^\d+$/.test(size) || Number(size) > maxBytes)) {
      try { await response.body?.cancel?.(); } catch (_) { /* Do not consume a rejected response. */ }
      throw failure("invalid");
    }
    let text;
    if (typeof response.body?.getReader === "function") {
      const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0; const parts = [];
      try {
        while (true) {
          const chunk = await reader.read();
          if (!current()) throw failure("stale");
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > maxBytes) throw failure("invalid");
          try { parts.push(decoder.decode(chunk.value, { stream: true })); } catch (_) { throw failure("invalid"); }
        }
        try { parts.push(decoder.decode()); } catch (_) { throw failure("invalid"); }
        text = parts.join("");
      } catch (error) {
        try { await reader.cancel(); } catch (_) { /* Cancellation must not restore private text. */ }
        throw error;
      } finally { reader.releaseLock(); }
    } else if (typeof response.text === "function") {
      text = await response.text();
      if (!current()) throw failure("stale");
      if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > maxBytes) throw failure("invalid");
    } else throw failure("invalid");
    try { return JSON.parse(text); } catch (_) { throw failure("invalid"); }
  }
  function createController({ fetch, identity, isCurrent, context, locale = () => "ko", visible = () => true, onChange = () => {} }) {
    let scope = null, ticket = 0, phase = "idle", messageKey = "ready", data = null, request = null;
    function readScope() {
      let value = {}, owner = null, shown = false, rawLocale = "ko", available = false;
      try {
        value = context() || {}; shown = visible() === true; rawLocale = locale();
        owner = identity();
        available = typeof fetch === "function" && typeof isCurrent === "function";
        if (!record(owner) || !validText(owner.ownerId, 320) || !Number.isSafeInteger(owner.epoch) || owner.epoch < 0 || !isCurrent(owner)) owner = null;
      } catch (_) { owner = null; }
      return { workId: typeof value.workId === "string" ? value.workId : "", sourceLocale: value.locale,
        locale: locales.includes(rawLocale) ? rawLocale : "ko", rawLocale: typeof rawLocale === "string" ? rawLocale : "",
        visible: shown, available, owner: owner ? { ownerId: owner.ownerId, epoch: owner.epoch } : null };
    }
    const initialMessage = value => !value.visible ? "hidden" : !value.available ? "unavailable" : !value.owner ? "unauthenticated" :
      !value.workId ? "noWork" : !uuid(value.workId) || !locales.includes(value.sourceLocale) ? "invalid" : "ready";
    const canLoad = () => scope && initialMessage(scope) === "ready" && phase !== "loading";
    const state = () => clone({ ticket, phase, messageKey, locale: scope?.locale || "ko", data, busy: phase === "loading", canLoad: Boolean(canLoad()) });
    const emit = () => onChange(state());
    function clear() {
      ticket++; data = null; phase = "idle";
      const old = request; request = null; old?.abort();
    }
    function syncContext(notify = true) {
      const next = readScope();
      if (JSON.stringify(scope) === JSON.stringify(next)) return false;
      clear(); scope = next; messageKey = initialMessage(scope);
      if (notify) emit();
      return true;
    }
    function invalidate() {
      clear(); scope = readScope(); messageKey = initialMessage(scope); emit();
    }
    function snapshot() { syncContext(); return state(); }
    async function load(expectedTicket = null) {
      syncContext();
      if ((expectedTicket !== null && expectedTicket !== ticket) || !canLoad()) return false;
      data = null; phase = "loading"; messageKey = "loading";
      const ownTicket = ++ticket, target = { workId: scope.workId, locale: scope.sourceLocale }, owner = { ...scope.owner };
      const abort = typeof AbortController === "function" ? new AbortController() : null;
      request = abort; emit();
      const current = () => { syncContext(); return ticket === ownTicket; };
      try {
        if (!current()) return false;
        const response = await fetch("/api/v1/me/creator-studio/stories/" + encodeURIComponent(target.workId) +
          "/body-preview?locale=" + encodeURIComponent(target.locale), {
          method: "GET", identity: owner, _retried: true, cache: "no-store", headers: { "Cache-Control": "no-store" }, ...(abort ? { signal: abort.signal } : {})
        });
        if (!current()) {
          try { await response?.body?.cancel?.(); } catch (_) { /* Ignore stale response cleanup errors. */ }
          return false;
        }
        if (!response || !Number.isInteger(response.status)) throw failure("invalid");
        if (response.status !== 200) {
          const errors = { 401: "unauthenticated", 403: "forbidden", 404: "notFound", 409: "conflict" };
          try { await response.body?.cancel?.(); } catch (_) { /* Error diagnostics are not private preview content. */ }
          throw failure(errors[response.status] || (response.status >= 500 ? "server" : "unavailable"));
        }
        const value = await readBody(response, current);
        if (!current()) return false;
        const parsed = parsePreview(value, target);
        data = parsed; phase = "ready";
        const progress = parsed.progress;
        messageKey = !progress ? "noProgress" : pending(progress.status) ? "generating" :
          progress.scene?.endingType || progress.status === "completed" ? "ending" : !progress.scene ? "noScene" : "body";
        request = null; emit(); return true;
      } catch (error) {
        if (!current()) return false;
        data = null; phase = "error"; request = null;
        messageKey = ["unauthenticated", "forbidden", "notFound", "conflict", "server", "transport", "invalid", "unavailable"].includes(error?.kind) ? error.kind : "transport";
        emit(); return false;
      }
    }
    syncContext(false);
    return { snapshot, syncContext, invalidate, load };
  }
  function mount(host) {
    if (!host || host.dataset.bodyPreviewMounted) return null;
    const shell = document.getElementById("studioShell"), section = document.getElementById("writer-manuscript");
    if (!shell || !section) return null;
    host.dataset.bodyPreviewMounted = "true";
    const element = (tag, className, text) => {
      const node = document.createElement(tag); if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const header = element("header", "body-preview-header"), heading = element("div"), title = element("h3"), privacy = element("p", "body-preview-private");
    title.id = "writerBodyPreviewTitle"; heading.append(title, privacy);
    const button = element("button", "body-preview-refresh"); button.id = "writerBodyPreviewRefresh"; button.type = "button";
    let icon;
    try {
      if (window.lucide?.icons?.RefreshCw && typeof window.lucide.createElement === "function") icon = window.lucide.createElement(window.lucide.icons.RefreshCw);
    } catch (_) { /* A missing optional icon library must not prevent private-state cleanup. */ }
    if (!icon) icon = element("span", "body-preview-icon", "\u21bb");
    icon.setAttribute("aria-hidden", "true"); button.append(icon); header.append(heading, button);
    const status = element("p", "body-preview-state"), content = element("div", "body-preview-content");
    status.id = "writerBodyPreviewState"; content.id = "writerBodyPreviewContent";
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    host.replaceChildren(header, status, content);
    const visible = () => !shell.hidden && !section.hidden && !host.hidden && section.classList.contains("is-active") && document.visibilityState !== "hidden";
    function render(state) {
      const words = copy[state.locale];
      title.textContent = words.title; privacy.textContent = words.privacy;
      button.title = words.refresh; button.setAttribute("aria-label", words.refresh); button.disabled = !state.canLoad;
      host.lang = state.locale; host.setAttribute("aria-busy", String(state.busy));
      status.textContent = words[state.messageKey]; status.className = "body-preview-state" + (state.phase === "error" ? " is-error" : "");
      content.replaceChildren(); content.removeAttribute("lang");
      const progress = state.data?.progress; if (!progress) return;
      const metadata = element("dl", "body-preview-metadata");
      const progressLabel = words[progress.status === "active" ? "statusActive" : pending(progress.status) ? "statusPending" :
        progress.status === "completed" ? "statusCompleted" : "statusOther"];
      for (const [label, text] of [[words.status, progressLabel], [words.revision, progress.revision],
        [words.version, progress.storyVersion], [words.source, localeNames[state.data.locale]]]) {
        const row = element("div"); row.append(element("dt", "", label), element("dd", "", String(text))); metadata.append(row);
      }
      content.append(metadata);
      const source = element("div", "body-preview-source"); source.lang = state.data.locale;
      if (progress.scene) {
        source.append(element("h4", "body-preview-scene-title", progress.scene.title));
        const prose = element("div", "body-preview-prose");
        for (const beat of progress.scene.beats) prose.append(element("p", "body-preview-beat", beat.content));
        source.append(prose);
        if (progress.scene.endingType !== null) {
          const endings = { original: "endingOriginal", author_main: "endingOriginal", author_sub: "endingAlternate", ai_generated: "endingGenerated" };
          source.append(element("p", "body-preview-ending", words[Object.hasOwn(endings, progress.scene.endingType) ? endings[progress.scene.endingType] : "endingOther"]));
        }
      }
      content.append(source);
      if (progress.choices.length) {
        const choicesHeading = element("h4", "body-preview-choices-title", words.choices), choices = element("ol", "body-preview-choices");
        choices.lang = state.data.locale;
        for (const choice of progress.choices) {
          const routes = { writer_original: "routeOriginal", generation_required: "routeGeneration", branch: "routeBranch", rejoin: "routeRejoin", ending: "routeEnding" };
          const routeLabel = words[Object.hasOwn(routes, choice.routeKind) ? routes[choice.routeKind] : "routeOther"];
          const item = element("li"); item.append(element("span", "body-preview-choice-label", choice.label), element("small", "body-preview-route", routeLabel));
          choices.append(item);
        }
        content.append(choicesHeading, choices);
      }
    }
    const controller = createController({
      // Passing an existing token also bypasses the shared API's preflight auth-refresh POST.
      fetch: (url, options) => {
        const auth = window.getAuth?.();
        const accessToken = auth?.accessToken || auth?.access_token || auth?.token || auth?.tokens?.accessToken || auth?.tokens?.access_token;
        if (typeof accessToken !== "string" || !accessToken) throw failure("unauthenticated");
        return window.LuminaCreatorStudioApi.fetch(url, { ...options, token: accessToken });
      },
      identity: () => window.LuminaCreatorStudioApi?.identity?.(),
      isCurrent: owner => typeof window.LuminaCreatorStudioApi?.fetch === "function" && window.LuminaCreatorStudioApi?.isCurrent?.(owner) === true,
      context: () => ({ workId: document.getElementById("writerManuscriptWork")?.value || "", locale: document.getElementById("writerManuscriptLocale")?.value || "" }),
      locale: () => window.luminaI18n?.getLocale?.() || document.documentElement.lang || "ko", visible, onChange: render
    });
    button.addEventListener("click", () => { if (!button.disabled) return controller.load(controller.snapshot().ticket); });
    const sync = () => controller.syncContext(), erase = () => controller.invalidate();
    for (const name of ["storage", "lumina:authchange", "lumina:auth-expired", "pagehide", "lumina:author-body-trial-progress-changed"]) window.addEventListener(name, erase);
    for (const name of ["focus", "lumina:localechange", "pageshow"]) window.addEventListener(name, sync);
    document.addEventListener("lumina:auth-expired", erase);
    document.addEventListener("visibilitychange", erase);
    for (const id of ["writerManuscriptWork", "writerManuscriptLocale"]) {
      const control = document.getElementById(id);
      for (const name of ["input", "change"]) control?.addEventListener(name, erase);
    }
    document.addEventListener("click", event => {
      const target = event.target.closest?.("[data-section]");
      if (target && target.getAttribute("data-section") !== "writer-manuscript") erase();
    }, true);
    if (typeof MutationObserver === "function") {
      new MutationObserver(records => {
        // Even hide/show within one task must invalidate the old ticket.
        if (records.length) erase();
      }).observe(section, { attributes: true, attributeFilter: ["class", "hidden", "style"] });
      new MutationObserver(erase).observe(shell, { attributes: true, attributeFilter: ["hidden"] });
      new MutationObserver(erase).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
      new MutationObserver(erase).observe(host, { attributes: true, attributeFilter: ["hidden"] });
      for (const id of ["writerManuscriptWork", "writerManuscriptLocale"]) {
        const control = document.getElementById(id);
        if (control) new MutationObserver(sync).observe(control, { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "selected"] });
      }
    }
    render(controller.snapshot()); return controller;
  }
  window.LuminaCreatorBodyPreview = { createController, parsePreview, mount, copy, maxBytes };
  if (typeof document !== "undefined") mount(document.getElementById("writerBodyPreview"));
})();
