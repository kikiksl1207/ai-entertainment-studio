(function () {
  "use strict";
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const maxBytes = 16 * 1024;
  const previewMaxBytes = 256 * 1024;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
  const clone = value => JSON.parse(JSON.stringify(value));
  const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
  const ownErrors = new WeakSet();
  function failure(kind) { const error = new Error("Current request check unavailable"); error.kind = kind; ownErrors.add(error); return error; }
  const unavailableReasons = {
    progress_unavailable: "noProgress", progress_changed: "changed", release_unavailable: "sourceUnavailable",
    approval_unavailable: "approvalUnavailable", source_scope_mismatch: "sourceMismatch", source_unavailable: "sourceUnavailable",
    approved_profile_context_too_large: "approvedProfileContextTooLarge",
    choice_unavailable: "noChoice", source_not_fully_read: "notRead", capability_unavailable: "capabilityUnavailable",
    fixed_cap_settings_mismatch: "capabilityUnavailable", context_unavailable: "sourceUnavailable"
  };
  const diagnosticReasons = new Set([
    "fixed_cap_request_limits_mismatch", "provider_pin_mismatch", "provider_version_mismatch", "provider_locale_invalid",
    "provider_request_limits_invalid", "provider_context_invalid", "provider_model_encoding_unknown",
    "provider_input_bound_exceeded", "author_length_profile_invalid", "author_length_locale_unsupported",
    "author_length_beats_invalid", "author_length_beat_type_invalid", "author_length_locale_mismatch",
    "author_length_text_invalid", "author_length_byte_limit", "author_length_unicode_invalid", "author_length_reference_empty",
    "provider_narrative_schema_unavailable"
  ]);
  const copy = {
    ko: {
      title: "\ud604\uc7ac \uc120\ud0dd\uc758 \uc785\ub825 \ud655\uc778", refresh: "\ud604\uc7ac \uc120\ud0dd \uc0c8\ub85c\uace0\uce68", check: "\uc120\ud0dd \uc785\ub825 \ud655\uc778", choice: "\uac80\uc0ac\ud560 \uc120\ud0dd", choose: "\ubbf8\uc120\ud0dd",
      ready: "\ud604\uc7ac \uc120\ud0dd \ud655\uc778 \ub300\uae30", loadingPreview: "\ud604\uc7ac \uc120\ud0dd \ud655\uc778 \uc911", loadingCheck: "\uc120\ud0dd \uc785\ub825 \ud655\uc778 \uc911", selectChoice: "\uc120\ud0dd \uc785\ub825 \ud655\uc778 \ub300\uae30",
      noProgress: "\ud604\uc7ac \ub3c5\uc790 \uc9c4\ud589 \uc5c6\uc74c", noScene: "\ud604\uc7ac \uc7a5\uba74 \uc5c6\uc74c", noChoice: "\uac80\uc0ac \uac00\ub2a5\ud55c \uc120\ud0dd \uc5c6\uc74c", notRead: "\ud604\uc7ac \uc7a5\uba74 \uc77d\uae30 \ubbf8\uc644\ub8cc", ended: "\uc644\ub8cc\ub41c \uacbd\ub85c",
      changed: "\ud604\uc7ac \uacbd\ub85c \ubcc0\uacbd\ub428", sourceUnavailable: "\ud604\uc7ac \uc6d0\uace0\u00b7\uacbd\ub85c \ud655\uc778 \ubd88\uac00", sourceMismatch: "\uc2b9\uc778 \uc6d0\uace0\uc640 \ud604\uc7ac \uc6d0\uc791 \ubd88\uc77c\uce58", approvalUnavailable: "\ucd5c\uc2e0 \uc2b9\uc778 \uae30\uc900 \ud655\uc778 \ubd88\uac00",
      approvedProfileContextTooLarge: "\uc2b9\uc778\ub41c \uc124\uc815\uc774 \ud604\uc7ac \ucee8\ud14d\uc2a4\ud2b8 \ud55c\ub3c4\uc5d0 \ub9de\uc9c0 \uc54a\uc74c",
      capabilityUnavailable: "\ud604\uc7ac \uc785\ub825 \ud5c8\uc6a9\ub7c9 \ud655\uc778 \ubd88\uac00", hidden: "", unauthenticated: "\ub85c\uadf8\uc778 \ud544\uc694", noWork: "\uc120\ud0dd\ub41c \uc791\ud488 \uc5c6\uc74c",
      unavailable: "\ud604\uc7ac \uc785\ub825 \ud655\uc778 \ubd88\uac00", forbidden: "\uc774 \uc791\ud488\uc758 \uc785\ub825 \ud655\uc778 \uad8c\ud55c \uc5c6\uc74c", server: "\ud604\uc7ac \uc785\ub825\uc744 \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud568", transport: "\uc5f0\uacb0 \uc2e4\ud328", invalid: "\uc751\ub2f5 \ud655\uc778 \ubd88\uac00",
      within: "\uc785\ub825 \ud5c8\uc6a9\ub7c9 \uc774\ub0b4", exceeds: "\uc785\ub825 \ud5c8\uc6a9\ub7c9 \ucd08\uacfc", unmeasured: "\ubbf8\uce21\uc815", notVerified: "\ud488\uc9c8 \ubbf8\uac80\uc99d", notEvaluated: "\ubbf8\ud3c9\uac00", notAuthorized: "\uc2e4\ud589 \ubbf8\uc2b9\uc778",
      source: "\ubcf8\ubb38 \uc5b8\uc5b4", revision: "\uac80\uc0ac \uacbd\ub85c \ubc84\uc804", story: "\uacf5\uac1c \uc6d0\uc791 \ubc84\uc804", manuscript: "\uc6d0\uace0 \ubc84\uc804", analysis: "\ubd84\uc11d \ubc84\uc804", profile: "\uc2b9\uc778 \uc124\uc815 \ubc84\uc804", review: "\uac80\ud1a0 \ubc84\uc804",
      reference: "\uc6d0\uc791 \uae30\uc900 \ubb38\uc790 \uc218", range: "\uc6d0\uc791 \uae30\uc900 80-120%", input: "\uc785\ub825 \ud5c8\uc6a9\ub7c9", budget: "\uc785\ub825 \uc608\uc0b0 \ud1a0\ud070", output: "\ucd9c\ub825 \ubd84\ub7c9", style: "\ubb38\uccb4 \ud488\uc9c8", legal: "\ubc95\uc801 \uc2b9\uc778", paid: "\uc720\ub8cc \uc2b9\uc778", dispatch: "\uc0dd\uc131 \uc2e4\ud589"
    },
    en: {
      title: "Current Choice Input", refresh: "Refresh current choices", check: "Check selected input", choice: "Choice to check", choose: "Not selected",
      ready: "Current choices pending", loadingPreview: "Checking current choices", loadingCheck: "Checking selected input", selectChoice: "Selected input pending",
      noProgress: "No current reader progress", noScene: "No current scene", noChoice: "No eligible choice", notRead: "Current scene not fully read", ended: "Completed path",
      changed: "Current path changed", sourceUnavailable: "Current source unavailable", sourceMismatch: "Approved manuscript and current original differ", approvalUnavailable: "Latest approval unavailable",
      approvedProfileContextTooLarge: "Approved settings do not fit the current context limit",
      capabilityUnavailable: "Current input allowance unavailable", hidden: "", unauthenticated: "Sign-in required", noWork: "No work selected",
      unavailable: "Current input check unavailable", forbidden: "This input check is not accessible", server: "Could not load current input", transport: "Connection failed", invalid: "Response unverified",
      within: "Within input allowance", exceeds: "Input allowance exceeded", unmeasured: "Unmeasured", notVerified: "Quality unverified", notEvaluated: "Not evaluated", notAuthorized: "Execution not authorized",
      source: "Body language", revision: "Checked path revision", story: "Published original version", manuscript: "Manuscript version", analysis: "Analysis version", profile: "Approved settings version", review: "Review revision",
      reference: "Original reference characters", range: "80-120% of original", input: "Input allowance", budget: "Input budget tokens", output: "Output length", style: "Writing style quality", legal: "Legal authorization", paid: "Paid approval", dispatch: "Generation"
    },
    ja: {
      title: "\u73fe\u5728\u306e\u9078\u629e\u306e\u5165\u529b\u78ba\u8a8d", refresh: "\u73fe\u5728\u306e\u9078\u629e\u3092\u66f4\u65b0", check: "\u9078\u629e\u5165\u529b\u3092\u78ba\u8a8d", choice: "\u78ba\u8a8d\u3059\u308b\u9078\u629e", choose: "\u672a\u9078\u629e",
      ready: "\u73fe\u5728\u306e\u9078\u629e\u306e\u78ba\u8a8d\u5f85\u3061", loadingPreview: "\u73fe\u5728\u306e\u9078\u629e\u3092\u78ba\u8a8d\u4e2d", loadingCheck: "\u9078\u629e\u5165\u529b\u3092\u78ba\u8a8d\u4e2d", selectChoice: "\u9078\u629e\u5165\u529b\u306e\u78ba\u8a8d\u5f85\u3061",
      noProgress: "\u73fe\u5728\u306e\u8aad\u8005\u9032\u884c\u306a\u3057", noScene: "\u73fe\u5728\u306e\u30b7\u30fc\u30f3\u306a\u3057", noChoice: "\u78ba\u8a8d\u3067\u304d\u308b\u9078\u629e\u306a\u3057", notRead: "\u73fe\u5728\u306e\u30b7\u30fc\u30f3\u306f\u672a\u8aad\u4e86", ended: "\u5b8c\u4e86\u3057\u305f\u7d4c\u8def",
      changed: "\u73fe\u5728\u306e\u7d4c\u8def\u304c\u5909\u66f4\u3055\u308c\u307e\u3057\u305f", sourceUnavailable: "\u73fe\u5728\u306e\u539f\u7a3f\u30fb\u7d4c\u8def\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093", sourceMismatch: "\u627f\u8a8d\u539f\u7a3f\u3068\u73fe\u5728\u306e\u539f\u4f5c\u304c\u4e0d\u4e00\u81f4", approvalUnavailable: "\u6700\u65b0\u306e\u627f\u8a8d\u57fa\u6e96\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093",
      approvedProfileContextTooLarge: "\u627f\u8a8d\u6e08\u307f\u8a2d\u5b9a\u304c\u73fe\u5728\u306e\u30b3\u30f3\u30c6\u30ad\u30b9\u30c8\u4e0a\u9650\u306b\u53ce\u307e\u3089\u306a\u3044",
      capabilityUnavailable: "\u73fe\u5728\u306e\u5165\u529b\u4e0a\u9650\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093", hidden: "", unauthenticated: "\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981", noWork: "\u4f5c\u54c1\u304c\u672a\u9078\u629e",
      unavailable: "\u73fe\u5728\u306e\u5165\u529b\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093", forbidden: "\u3053\u306e\u4f5c\u54c1\u306e\u5165\u529b\u3092\u78ba\u8a8d\u3059\u308b\u6a29\u9650\u304c\u3042\u308a\u307e\u305b\u3093", server: "\u73fe\u5728\u306e\u5165\u529b\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093", transport: "\u63a5\u7d9a\u5931\u6557", invalid: "\u5fdc\u7b54\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093",
      within: "\u5165\u529b\u4e0a\u9650\u4ee5\u5185", exceeds: "\u5165\u529b\u4e0a\u9650\u3092\u8d85\u904e", unmeasured: "\u672a\u6e2c\u5b9a", notVerified: "\u54c1\u8cea\u672a\u691c\u8a3c", notEvaluated: "\u672a\u8a55\u4fa1", notAuthorized: "\u5b9f\u884c\u672a\u627f\u8a8d",
      source: "\u672c\u6587\u8a00\u8a9e", revision: "\u78ba\u8a8d\u7d4c\u8def\u30d0\u30fc\u30b8\u30e7\u30f3", story: "\u516c\u958b\u539f\u4f5c\u30d0\u30fc\u30b8\u30e7\u30f3", manuscript: "\u539f\u7a3f\u30d0\u30fc\u30b8\u30e7\u30f3", analysis: "\u5206\u6790\u30d0\u30fc\u30b8\u30e7\u30f3", profile: "\u627f\u8a8d\u8a2d\u5b9a\u30d0\u30fc\u30b8\u30e7\u30f3", review: "\u78ba\u8a8d\u30d0\u30fc\u30b8\u30e7\u30f3",
      reference: "\u539f\u4f5c\u57fa\u6e96\u6587\u5b57\u6570", range: "\u539f\u4f5c\u57fa\u6e9680-120%", input: "\u5165\u529b\u4e0a\u9650", budget: "\u5165\u529b\u4e88\u7b97\u30c8\u30fc\u30af\u30f3", output: "\u51fa\u529b\u5206\u91cf", style: "\u6587\u4f53\u54c1\u8cea", legal: "\u6cd5\u7684\u627f\u8a8d", paid: "\u6709\u6599\u627f\u8a8d", dispatch: "\u751f\u6210\u5b9f\u884c"
    },
    "zh-Hans": {
      title: "\u5f53\u524d\u9009\u62e9\u7684\u8f93\u5165\u68c0\u67e5", refresh: "\u5237\u65b0\u5f53\u524d\u9009\u62e9", check: "\u68c0\u67e5\u6240\u9009\u8f93\u5165", choice: "\u5f85\u68c0\u67e5\u7684\u9009\u62e9", choose: "\u672a\u9009\u62e9",
      ready: "\u5f53\u524d\u9009\u62e9\u5f85\u68c0\u67e5", loadingPreview: "\u6b63\u5728\u68c0\u67e5\u5f53\u524d\u9009\u62e9", loadingCheck: "\u6b63\u5728\u68c0\u67e5\u6240\u9009\u8f93\u5165", selectChoice: "\u6240\u9009\u8f93\u5165\u5f85\u68c0\u67e5",
      noProgress: "\u6ca1\u6709\u5f53\u524d\u8bfb\u8005\u8fdb\u5ea6", noScene: "\u6ca1\u6709\u5f53\u524d\u573a\u666f", noChoice: "\u6ca1\u6709\u53ef\u68c0\u67e5\u7684\u9009\u62e9", notRead: "\u5f53\u524d\u573a\u666f\u5c1a\u672a\u8bfb\u5b8c", ended: "\u8def\u5f84\u5df2\u5b8c\u6210",
      changed: "\u5f53\u524d\u8def\u5f84\u5df2\u6539\u53d8", sourceUnavailable: "\u65e0\u6cd5\u786e\u8ba4\u5f53\u524d\u7a3f\u4ef6\u4e0e\u8def\u5f84", sourceMismatch: "\u5df2\u6279\u51c6\u7a3f\u4ef6\u4e0e\u5f53\u524d\u539f\u4f5c\u4e0d\u4e00\u81f4", approvalUnavailable: "\u65e0\u6cd5\u786e\u8ba4\u6700\u65b0\u6279\u51c6\u6807\u51c6",
      approvedProfileContextTooLarge: "\u5df2\u6279\u51c6\u8bbe\u7f6e\u65e0\u6cd5\u9002\u914d\u5f53\u524d\u4e0a\u4e0b\u6587\u9650\u5236",
      capabilityUnavailable: "\u65e0\u6cd5\u786e\u8ba4\u5f53\u524d\u8f93\u5165\u9650\u989d", hidden: "", unauthenticated: "\u9700\u8981\u767b\u5f55", noWork: "\u672a\u9009\u62e9\u4f5c\u54c1",
      unavailable: "\u65e0\u6cd5\u68c0\u67e5\u5f53\u524d\u8f93\u5165", forbidden: "\u65e0\u6743\u68c0\u67e5\u6b64\u4f5c\u54c1\u7684\u8f93\u5165", server: "\u65e0\u6cd5\u52a0\u8f7d\u5f53\u524d\u8f93\u5165", transport: "\u8fde\u63a5\u5931\u8d25", invalid: "\u65e0\u6cd5\u786e\u8ba4\u54cd\u5e94",
      within: "\u8f93\u5165\u672a\u8d85\u9650", exceeds: "\u8f93\u5165\u8d85\u8fc7\u9650\u989d", unmeasured: "\u672a\u6d4b\u91cf", notVerified: "\u8d28\u91cf\u672a\u9a8c\u8bc1", notEvaluated: "\u672a\u8bc4\u4f30", notAuthorized: "\u6267\u884c\u672a\u83b7\u6279\u51c6",
      source: "\u6b63\u6587\u8bed\u8a00", revision: "\u68c0\u67e5\u8def\u5f84\u7248\u672c", story: "\u5df2\u53d1\u5e03\u539f\u4f5c\u7248\u672c", manuscript: "\u7a3f\u4ef6\u7248\u672c", analysis: "\u5206\u6790\u7248\u672c", profile: "\u6279\u51c6\u8bbe\u7f6e\u7248\u672c", review: "\u5ba1\u6838\u7248\u672c",
      reference: "\u539f\u4f5c\u57fa\u51c6\u5b57\u7b26\u6570", range: "\u539f\u4f5c\u57fa\u51c680-120%", input: "\u8f93\u5165\u9650\u989d", budget: "\u8f93\u5165\u9884\u7b97\u8bcd\u5143", output: "\u8f93\u51fa\u7bc7\u5e45", style: "\u6587\u4f53\u8d28\u91cf", legal: "\u6cd5\u5f8b\u6388\u6743", paid: "\u4ed8\u8d39\u6279\u51c6", dispatch: "\u751f\u6210\u6267\u884c"
    },
    "zh-Hant": {
      title: "\u76ee\u524d\u9078\u64c7\u7684\u8f38\u5165\u6aa2\u67e5", refresh: "\u91cd\u65b0\u6574\u7406\u76ee\u524d\u9078\u64c7", check: "\u6aa2\u67e5\u6240\u9078\u8f38\u5165", choice: "\u5f85\u6aa2\u67e5\u7684\u9078\u64c7", choose: "\u672a\u9078\u64c7",
      ready: "\u76ee\u524d\u9078\u64c7\u5f85\u6aa2\u67e5", loadingPreview: "\u6b63\u5728\u6aa2\u67e5\u76ee\u524d\u9078\u64c7", loadingCheck: "\u6b63\u5728\u6aa2\u67e5\u6240\u9078\u8f38\u5165", selectChoice: "\u6240\u9078\u8f38\u5165\u5f85\u6aa2\u67e5",
      noProgress: "\u6c92\u6709\u76ee\u524d\u8b80\u8005\u9032\u5ea6", noScene: "\u6c92\u6709\u76ee\u524d\u5834\u666f", noChoice: "\u6c92\u6709\u53ef\u6aa2\u67e5\u7684\u9078\u64c7", notRead: "\u76ee\u524d\u5834\u666f\u5c1a\u672a\u8b80\u5b8c", ended: "\u8def\u5f91\u5df2\u5b8c\u6210",
      changed: "\u76ee\u524d\u8def\u5f91\u5df2\u6539\u8b8a", sourceUnavailable: "\u7121\u6cd5\u78ba\u8a8d\u76ee\u524d\u7a3f\u4ef6\u8207\u8def\u5f91", sourceMismatch: "\u5df2\u6838\u51c6\u7a3f\u4ef6\u8207\u76ee\u524d\u539f\u4f5c\u4e0d\u4e00\u81f4", approvalUnavailable: "\u7121\u6cd5\u78ba\u8a8d\u6700\u65b0\u6838\u51c6\u6a19\u6e96",
      approvedProfileContextTooLarge: "\u5df2\u6838\u51c6\u8a2d\u5b9a\u7121\u6cd5\u7b26\u5408\u76ee\u524d\u4e0a\u4e0b\u6587\u9650\u5236",
      capabilityUnavailable: "\u7121\u6cd5\u78ba\u8a8d\u76ee\u524d\u8f38\u5165\u9650\u984d", hidden: "", unauthenticated: "\u9700\u8981\u767b\u5165", noWork: "\u672a\u9078\u64c7\u4f5c\u54c1",
      unavailable: "\u7121\u6cd5\u6aa2\u67e5\u76ee\u524d\u8f38\u5165", forbidden: "\u7121\u6b0a\u6aa2\u67e5\u6b64\u4f5c\u54c1\u7684\u8f38\u5165", server: "\u7121\u6cd5\u8f09\u5165\u76ee\u524d\u8f38\u5165", transport: "\u9023\u7dda\u5931\u6557", invalid: "\u7121\u6cd5\u78ba\u8a8d\u56de\u61c9",
      within: "\u8f38\u5165\u672a\u8d85\u9650", exceeds: "\u8f38\u5165\u8d85\u904e\u9650\u984d", unmeasured: "\u672a\u6e2c\u91cf", notVerified: "\u54c1\u8cea\u672a\u9a57\u8b49", notEvaluated: "\u672a\u8a55\u4f30", notAuthorized: "\u57f7\u884c\u672a\u7372\u6838\u51c6",
      source: "\u6b63\u6587\u8a9e\u8a00", revision: "\u6aa2\u67e5\u8def\u5f91\u7248\u672c", story: "\u5df2\u767c\u5e03\u539f\u4f5c\u7248\u672c", manuscript: "\u7a3f\u4ef6\u7248\u672c", analysis: "\u5206\u6790\u7248\u672c", profile: "\u6838\u51c6\u8a2d\u5b9a\u7248\u672c", review: "\u5be9\u6838\u7248\u672c",
      reference: "\u539f\u4f5c\u57fa\u6e96\u5b57\u5143\u6578", range: "\u539f\u4f5c\u57fa\u6e9680-120%", input: "\u8f38\u5165\u9650\u984d", budget: "\u8f38\u5165\u9810\u7b97\u8a5e\u5143", output: "\u8f38\u51fa\u7bc7\u5e45", style: "\u6587\u9ad4\u54c1\u8cea", legal: "\u6cd5\u5f8b\u6388\u6b0a", paid: "\u4ed8\u8cbb\u6838\u51c6", dispatch: "\u751f\u6210\u57f7\u884c"
    }
  };
  const localeNames = { ko: "\ud55c\uad6d\uc5b4", en: "English", ja: "\u65e5\u672c\u8a9e", "zh-Hans": "\u7b80\u4f53\u4e2d\u6587", "zh-Hant": "\u7e41\u9ad4\u4e2d\u6587" };

  function parseDiagnostic(value, sourceLocale, expectedRevision) {
    const keys = ["contract", "locale", "sourceScope", "readOnly", "providerCalls", "operatingWrites", "dispatchAuthorized", "semanticQualityVerified",
      "legalAuthorization", "paidApproval", "outcome", "currentSourceState", "approvalReferenceVerified", "progressRevision",
      "manuscriptVersion", "analysisVersion", "profileVersion", "reviewRevision", "diagnostic"];
    if (!locales.includes(sourceLocale) || !integer(expectedRevision, 0, 2147483647) || !record(value) ||
        !exact(value, value.outcome === "current_source_unavailable" ? [...keys, "reason"] : keys) ||
        value.contract !== "story-author-current-fit-v1" || value.locale !== sourceLocale ||
        value.sourceScope !== "latest_private_approval_and_current_reader_source" || value.readOnly !== true ||
        value.providerCalls !== 0 || value.operatingWrites !== 0 || value.dispatchAuthorized !== false || value.semanticQualityVerified !== false ||
        value.legalAuthorization !== "not_evaluated" || value.paidApproval !== "not_evaluated") throw failure("invalid");
    const versions = ["manuscriptVersion", "analysisVersion", "profileVersion", "reviewRevision"];
    if (value.outcome === "current_source_unavailable") {
      if (value.currentSourceState !== "unavailable" || value.approvalReferenceVerified !== false ||
          value.progressRevision !== null || value.diagnostic !== null || versions.some(key => value[key] !== null) ||
          typeof value.reason !== "string" || !Object.prototype.hasOwnProperty.call(unavailableReasons, value.reason)) throw failure("invalid");
      return clone(value);
    }
    if (value.outcome !== "request_checked" || value.currentSourceState !== "validated" || value.approvalReferenceVerified !== true ||
        value.progressRevision !== expectedRevision || versions.some(key => !integer(value[key], 1, 2147483647))) throw failure("invalid");
    const d = value.diagnostic;
    if (!exact(d, ["version", "budgetMethod", "contextSource", "fixedInputTokenLimit", "fixedOutputTokenLimit", "inputFit", "reason",
      "inputTokenBudget", "requestBytes", "narrativeLength", "writingStylePresent", "outputFit", "multiStageFit", "currentApprovalVerified",
      "dispatchAuthorized", "semanticQualityVerified", "providerCalls"]) ||
        d.version !== "story-fixed-cap-fit-v1" || d.budgetMethod !== "js_tiktoken_o200k_base_v1" || d.contextSource !== "caller_supplied_context" ||
        d.fixedInputTokenLimit !== 32768 || d.fixedOutputTokenLimit !== 8192 || d.outputFit !== "unmeasured" || d.multiStageFit !== "unimplemented" ||
        d.currentApprovalVerified !== false || d.dispatchAuthorized !== false || d.semanticQualityVerified !== false || d.providerCalls !== 0) throw failure("invalid");
    if (d.inputFit === "unmeasured") {
      if (!diagnosticReasons.has(d.reason) || d.inputTokenBudget !== null || d.requestBytes !== null ||
          d.narrativeLength !== null || d.writingStylePresent !== null) throw failure("invalid");
    } else {
      const within = d.inputFit === "within_policy_bound", b = d.narrativeLength;
      if ((!within && d.inputFit !== "exceeds_policy_bound") ||
          d.reason !== (within ? "fixed_cap_input_policy_fit" : "provider_input_bound_exceeded") ||
          !integer(d.inputTokenBudget, 1) || (d.inputTokenBudget <= 32768) !== within ||
          !integer(d.requestBytes, 1) || typeof d.writingStylePresent !== "boolean" ||
          !exact(b, ["measurement", "referenceUnits", "minUnits", "targetUnits", "maxUnits"]) ||
          b.measurement !== "narrative-nonwhite-codepoints-v1" || !integer(b.referenceUnits, 1, 256000) ||
          b.targetUnits !== b.referenceUnits || b.minUnits !== Math.ceil(b.referenceUnits * 4 / 5) ||
          b.maxUnits !== Math.floor(b.referenceUnits * 6 / 5)) throw failure("invalid");
    }
    return clone(value);
  }

  async function cancel(response) { try { await response?.body?.cancel?.(); } catch (_) {} }
  async function readBody(response, current, ceiling) {
    const length = response.headers?.get?.("content-length"), type = response.headers?.get?.("content-type");
    if (!current()) { await cancel(response); throw failure("stale"); }
    if ((length !== null && length !== undefined && (!/^\d+$/.test(length) || Number(length) > ceiling)) ||
        (type !== null && type !== undefined && !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(type)) ||
        typeof response.body?.getReader !== "function") { await cancel(response); throw failure("invalid"); }
    const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0, text = "";
    try {
      while (true) {
        if (!current()) throw failure("stale");
        const chunk = await reader.read();
        if (!current()) throw failure("stale");
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) throw failure("invalid");
        bytes += chunk.value.byteLength;
        if (bytes > ceiling) throw failure("invalid");
        try { text += decoder.decode(chunk.value, { stream: true }); } catch (_) { throw failure("invalid"); }
      }
      try { text += decoder.decode(); } catch (_) { throw failure("invalid"); }
      if (!current()) throw failure("stale");
      try { return JSON.parse(text); } catch (_) { throw failure("invalid"); }
    } catch (error) { try { await reader.cancel(); } catch (_) {} throw error; }
    finally { reader.releaseLock(); }
  }

  function createController({ fetch, identity, isCurrent, context, locale = () => "ko", visible = () => true, onChange = () => {} }) {
    let scope = null, ticket = 0, choices = [], selectedChoiceId = "", progressRevision = null, storyVersion = null;
    let data = null, phase = "idle", messageKey = "ready", request = null;
    const busy = () => phase === "loadingPreview" || phase === "loadingCheck";
    function sample() {
      try {
        const target = context(), language = locale(), shown = visible() === true, owner = identity();
        const authenticated = record(owner) && typeof owner.ownerId === "string" && uuid.test(owner.ownerId) &&
          integer(owner.epoch) && isCurrent(owner) === true;
        return { workId: typeof target?.workId === "string" ? target.workId.toLowerCase() : "",
          sourceLocale: locales.includes(target?.locale) ? target.locale : null, locale: locales.includes(language) ? language : null,
          shown, available: typeof fetch === "function" && typeof window.LuminaCreatorBodyPreview?.parsePreview === "function",
          owner: authenticated ? { ownerId: owner.ownerId, epoch: owner.epoch } : null };
      } catch (_) { return { workId: "", sourceLocale: null, locale: null, shown: false, available: false, owner: null }; }
    }
    function initial(s) { return !s.shown ? "hidden" : !s.available ? "unavailable" : !s.owner ? "unauthenticated" : !s.workId ? "noWork" :
      !uuid.test(s.workId) || !s.sourceLocale || !s.locale ? "invalid" : "ready"; }
    function state() {
      const enabled = !!scope && initial(scope) === "ready";
      return { ticket, phase, messageKey, locale: scope?.locale || "ko", sourceLocale: scope?.sourceLocale || null,
        choices: clone(choices), selectedChoiceId, progressRevision, storyVersion, data: data === null ? null : clone(data), busy: busy(),
        canRefresh: enabled && !busy(), canSelect: enabled && choices.length > 0 && phase !== "loadingPreview",
        canCheck: enabled && !busy() && integer(progressRevision, 0, 2147483647) && choices.some(item => item.id === selectedChoiceId) };
    }
    function emit() { onChange(state()); }
    function clear() { choices = []; selectedChoiceId = ""; progressRevision = null; storyVersion = null; data = null; }
    function reset(next) {
      const old = request; ++ticket; request = null; clear(); phase = "idle"; scope = next; messageKey = next ? initial(next) : "ready"; old?.abort();
    }
    function syncContext(notify = true) {
      const before = ticket, next = sample();
      if (before !== ticket) return state();
      if (JSON.stringify(scope) !== JSON.stringify(next)) { reset(next); if (notify) emit(); }
      return state();
    }
    function invalidate() { reset(null); syncContext(false); emit(); }
    function selectChoice(id, expectedTicket = null) {
      syncContext();
      if (!state().canSelect || (expectedTicket !== null && expectedTicket !== ticket) || typeof id !== "string") return false;
      const next = id.toLowerCase();
      if (next && (!uuid.test(next) || !choices.some(item => item.id === next))) return false;
      if (next === selectedChoiceId) return true;
      const old = request; ++ticket; request = null; selectedChoiceId = next; data = null; phase = "ready"; messageKey = "selectChoice";
      old?.abort(); emit(); return selectedChoiceId === next;
    }
    async function run(mode, expectedTicket) {
      syncContext();
      if (!(mode === "refresh" ? state().canRefresh : state().canCheck) || (expectedTicket !== null && expectedTicket !== ticket)) return false;
      const target = { workId: scope.workId, locale: scope.sourceLocale }, owner = { ...scope.owner };
      const choiceId = selectedChoiceId, revision = progressRevision, ownTicket = ++ticket, abort = new AbortController();
      request = abort; data = null;
      if (mode === "refresh") clear();
      phase = mode === "refresh" ? "loadingPreview" : "loadingCheck"; messageKey = phase;
      const current = () => { syncContext(); return ticket === ownTicket && !abort.signal.aborted; };
      emit();
      try {
        if (!current()) return false;
        const path = "/api/v1/me/creator-studio/stories/" + target.workId + "/body-preview";
        const url = mode === "refresh" ? path + "?locale=" + target.locale
          : path + "/current-fit?locale=" + target.locale + "&choiceId=" + choiceId + "&expectedProgressRevision=" + revision;
        const response = await fetch(url, { method: "GET", identity: owner, _retried: true, cache: "no-store",
          headers: { "Cache-Control": "no-store", "Accept": "application/json" }, signal: abort.signal });
        if (!current()) { await cancel(response); return false; }
        if (!integer(response?.status, 100, 599)) { await cancel(response); throw failure("invalid"); }
        if (response.status !== 200) {
          await cancel(response);
          throw failure(response.status === 401 ? "unauthenticated" : response.status === 403 ? "forbidden" :
            response.status === 409 ? "changed" : response.status >= 500 ? "server" : "unavailable");
        }
        const raw = await readBody(response, current, mode === "refresh" ? previewMaxBytes : maxBytes);
        if (!current()) return false;
        if (mode === "refresh") {
          let preview;
          try { preview = window.LuminaCreatorBodyPreview.parsePreview(raw, target); } catch (_) { throw failure("invalid"); }
          if (!current()) return false;
          const progress = preview.progress;
          if (!progress) messageKey = "noProgress";
          else {
            progressRevision = progress.revision; storyVersion = progress.storyVersion;
            if (progress.status === "completed") messageKey = "ended";
            else if (progress.status !== "active") messageKey = "noProgress";
            else if (!progress.scene) messageKey = "noScene";
            else if (progress.scene.endingType !== null) messageKey = "ended";
            else if (!integer(progress.revision, 0, 2147483647) || !integer(progress.currentBeatPosition, 1, 40) ||
              progress.scene.beats.some((beat, index) => beat.position !== index + 1) ||
              progress.currentBeatPosition !== progress.scene.beats.length) messageKey = "notRead";
            else {
              choices = progress.choices.filter(item => item.routeKind === "generation_required").map(item => {
                if (!uuid.test(item.id)) throw failure("invalid");
                return { id: item.id, label: item.label };
              });
              messageKey = choices.length ? "selectChoice" : "noChoice";
            }
          }
        } else {
          const parsed = parseDiagnostic(raw, target.locale, revision);
          if (!current()) return false;
          if (parsed.outcome === "current_source_unavailable") {
            clear(); data = parsed; messageKey = unavailableReasons[parsed.reason];
          } else {
            data = parsed; messageKey = parsed.diagnostic.inputFit === "within_policy_bound" ? "within" :
              parsed.diagnostic.inputFit === "exceeds_policy_bound" ? "exceeds" : "unmeasured";
          }
        }
        if (!current()) return false;
        phase = "ready"; request = null; emit(); return current();
      } catch (error) {
        if (!current()) return false;
        clear(); request = null; phase = "error";
        messageKey = ownErrors.has(error) && ["invalid", "unauthenticated", "forbidden", "changed", "server", "unavailable"].includes(error.kind) ? error.kind : "transport";
        emit(); return false;
      }
    }
    return { snapshot: () => syncContext(), syncContext, invalidate, selectChoice,
      refresh: (expectedTicket = null) => run("refresh", expectedTicket), check: (expectedTicket = null) => run("check", expectedTicket) };
  }

  function mount(host) {
    if (!host || host.dataset.bodyCurrentFitMounted) return null;
    const shell = document.getElementById("studioShell"), section = document.getElementById("writer-manuscript");
    if (!shell || !section) return null;
    host.dataset.bodyCurrentFitMounted = "true";
    function element(tag, name) { const node = document.createElement(tag); if (name) node.className = name; return node; }
    function iconButton(id, name, symbol) {
      const button = element("button", "body-current-fit-button"); button.id = id; button.type = "button";
      let icon;
      try { if (typeof window.lucide?.createElement === "function" && window.lucide?.icons?.[name]) icon = window.lucide.createElement(window.lucide.icons[name]); } catch (_) {}
      if (!icon) { icon = element("span"); icon.textContent = symbol; }
      icon.setAttribute("aria-hidden", "true"); button.append(icon); return button;
    }
    const header = element("div", "body-current-fit-header"), title = element("h3");
    title.id = "writerBodyCurrentFitTitle";
    const refresh = iconButton("writerBodyCurrentFitRefresh", "RefreshCw", "\u21bb");
    header.append(title, refresh);
    const toolbar = element("div", "body-current-fit-toolbar"), field = element("div", "body-current-fit-field");
    const label = element("label"), select = element("select"); select.id = "writerBodyCurrentFitChoice"; label.setAttribute("for", select.id);
    field.append(label, select);
    const check = iconButton("writerBodyCurrentFitCheck", "ClipboardCheck", "\u2713"); toolbar.append(field, check);
    const status = element("p", "body-current-fit-state"), content = element("dl", "body-current-fit-metadata");
    status.id = "writerBodyCurrentFitState"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    content.id = "writerBodyCurrentFitContent"; host.replaceChildren(header, toolbar, status, content);
    let renderedChoices = null;
    function render(state) {
      const c = copy[state.locale]; host.lang = state.locale; title.textContent = c.title; label.textContent = c.choice;
      for (const [button, key, enabled, loading] of [[refresh, "refresh", state.canRefresh, "loadingPreview"], [check, "check", state.canCheck, "loadingCheck"]]) {
        button.title = c[key]; button.setAttribute("aria-label", c[key]); button.setAttribute("aria-busy", String(state.phase === loading)); button.disabled = !enabled;
      }
      const listKey = JSON.stringify([state.locale, state.choices]);
      if (renderedChoices !== listKey) {
        renderedChoices = listKey; select.replaceChildren();
        const placeholder = element("option"); placeholder.value = ""; placeholder.textContent = c.choose; select.append(placeholder);
        for (const choice of state.choices) { const option = element("option"); option.value = choice.id; option.textContent = choice.label; select.append(option); }
      }
      select.value = state.selectedChoiceId; select.disabled = !state.canSelect;
      select.title = state.choices.find(item => item.id === state.selectedChoiceId)?.label || c.choice;
      status.textContent = c[state.messageKey]; status.className = "body-current-fit-state" + (state.phase === "error" ? " is-error" : "");
      content.replaceChildren(); content.hidden = state.progressRevision === null && state.data === null;
      if (content.hidden) return;
      function row(key, value) {
        const group = element("div"), dt = element("dt"), dd = element("dd");
        dt.textContent = c[key]; dd.textContent = value === null ? c.unmeasured : String(value); group.append(dt, dd); content.append(group);
      }
      row("source", localeNames[state.sourceLocale]); row("revision", state.data?.progressRevision ?? state.progressRevision); row("story", state.storyVersion);
      if (!state.data) return;
      for (const [key, value] of [["manuscript", "manuscriptVersion"], ["analysis", "analysisVersion"], ["profile", "profileVersion"], ["review", "reviewRevision"]]) row(key, state.data[value]);
      const diagnostic = state.data.diagnostic, bounds = diagnostic?.narrativeLength;
      row("reference", bounds?.referenceUnits ?? null); row("range", bounds ? bounds.minUnits + " - " + bounds.maxUnits : null);
      row("input", diagnostic?.fixedInputTokenLimit ?? null); row("budget", diagnostic?.inputTokenBudget ?? null);
      row("output", c.unmeasured); row("style", c.notVerified); row("legal", c.notEvaluated); row("paid", c.notEvaluated); row("dispatch", c.notAuthorized);
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
      visible: () => !shell.hidden && !section.hidden && !host.hidden && host.isConnected !== false &&
        section.classList.contains("is-active") && document.visibilityState !== "hidden",
      onChange: render
    });
    refresh.addEventListener("click", () => { if (!refresh.disabled) return controller.refresh(controller.snapshot().ticket); });
    check.addEventListener("click", () => { if (!check.disabled) return controller.check(controller.snapshot().ticket); });
    select.addEventListener("change", () => controller.selectChoice(select.value, controller.snapshot().ticket));
    const invalidate = () => controller.invalidate(), sync = () => controller.syncContext();
    for (const name of ["storage", "lumina:authchange", "lumina:auth-expired", "pagehide", "creator:manuscript-accepted",
      "creator:generation-profile-changed", "lumina:author-body-trial-progress-changed"]) window.addEventListener(name, invalidate);
    for (const name of ["focus", "pageshow", "lumina:localechange"]) window.addEventListener(name, sync);
    for (const name of ["visibilitychange", "lumina:auth-expired"]) document.addEventListener(name, invalidate);
    const selects = ["writerManuscriptWork", "writerManuscriptLocale"].map(id => document.getElementById(id)).filter(Boolean);
    for (const control of selects) for (const name of ["input", "change"]) control.addEventListener(name, invalidate);
    document.addEventListener("click", event => {
      const tab = event.target?.closest?.("[data-section]"); if (tab && tab.getAttribute("data-section") !== "writer-manuscript") invalidate();
    }, true);
    if (typeof MutationObserver === "function") {
      for (const [node, attributes] of [[shell, ["hidden"]], [section, ["class", "hidden", "style"]], [host, ["hidden"]], [document.documentElement, ["lang"]]]) {
        new MutationObserver(invalidate).observe(node, { attributes: true, attributeFilter: attributes });
      }
      for (const control of selects) new MutationObserver(sync).observe(control, { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "selected", "disabled"] });
    }
    render(controller.snapshot()); return controller;
  }
  window.LuminaCreatorBodyCurrentFit = { createController, parseDiagnostic, mount, copy, maxBytes, previewMaxBytes };
  if (typeof document !== "undefined") mount(document.getElementById("writerBodyCurrentFit"));
})();
