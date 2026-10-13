(function () {
  "use strict";
  const transport = window.LuminaCreatorApprovedReadonlyTransport?.create();
  if (!transport || !window.LuminaCreatorApprovedReadingHandoff) return;
  let receiver;
  window.getAuth = transport.getAuth;
  window.LuminaCreatorStudioApi = Object.freeze({ identity: transport.identity, isCurrent: transport.isCurrent,
    async fetch(path, options) {
      const before = receiver?.snapshot();
      if (!before || before.ownerId !== options.identity?.ownerId ||
        path !== "/api/v1/me/creator-studio/stories/" + before.workId.toLowerCase() +
          "/generation-profile/approved-section-bytes?measurement=json-utf8-v1" ||
        !await receiver.validate(options.signal) || receiver.snapshot() !== before) throw new Error("Readonly context changed");
      return transport.fetch(path, options);
    } });
  function start() {
    const work = document.getElementById("writerManuscriptWork"), sourceLocale = document.getElementById("writerManuscriptLocale");
    const label = document.getElementById("readingWorkTitle"), state = document.getElementById("readingConnectionState");
    const language = document.getElementById("readingLocale");
    const copy = {
      ko: { title: "\uc2b9\uc778\uc790\ub8cc \ud655\uc778", studio: "\uc2a4\ud29c\ub514\uc624", language: "\uc5b8\uc5b4", empty: "\uc791\ud488 \uc5f0\uacb0 \uc5c6\uc74c" },
      en: { title: "Approved material", studio: "Studio", language: "Language", empty: "No work connected" },
      ja: { title: "\u627f\u8a8d\u8cc7\u6599", studio: "\u30b9\u30bf\u30b8\u30aa", language: "\u8a00\u8a9e", empty: "\u4f5c\u54c1\u672a\u63a5\u7d9a" },
      "zh-Hans": { title: "\u5df2\u6279\u51c6\u8d44\u6599", studio: "\u5de5\u4f5c\u5ba4", language: "\u8bed\u8a00", empty: "\u672a\u8fde\u63a5\u4f5c\u54c1" },
      "zh-Hant": { title: "\u5df2\u6838\u51c6\u8cc7\u6599", studio: "\u5de5\u4f5c\u5ba4", language: "\u8a9e\u8a00", empty: "\u672a\u9023\u63a5\u4f5c\u54c1" }
    };
    let currentScope = null;
    let nonce;
    try { nonce = window.crypto.randomUUID(); } catch (_) { nonce = null; }
    function changed(scope) {
      currentScope = scope;
      const c = copy[language.value] || copy.ko;
      work.value = scope?.workId || ""; sourceLocale.value = scope?.sourceLocale || "ko";
      label.textContent = scope?.workLabel || c.empty;
      state.textContent = "";
      window.dispatchEvent(new Event("creator:generation-profile-changed"));
    }
    function translated() {
      const c = copy[language.value] || copy.ko;
      document.documentElement.lang = language.value;
      document.getElementById("readingTitle").textContent = c.title;
      document.getElementById("readingStudioLink").textContent = c.studio;
      document.getElementById("readingLocaleLabel").textContent = c.language;
      document.title = c.title + " | Lumina Stage";
      label.textContent = currentScope?.workLabel || c.empty;
    }
    receiver = window.LuminaCreatorApprovedReadingHandoff.createReceiver({ opener: window.opener, nonce,
      identity: transport.identity, isCurrent: transport.isCurrent, onChange: changed });
    changed(null); translated(); receiver.start();
    language.addEventListener("change", () => { translated();
      window.dispatchEvent(new Event("lumina:localechange")); });
    for (const name of ["storage", "lumina:authchange", "lumina:auth-expired"]) window.addEventListener(name, () => receiver.invalidate());
    window.addEventListener("focus", () => receiver.snapshot());
    const watch = setInterval(() => receiver.snapshot(), 1000);
    window.addEventListener("pagehide", () => { clearInterval(watch); receiver.dispose(); transport.dispose(); }, { once: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
