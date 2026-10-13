(function () {
  "use strict";
  const transport = window.LuminaCreatorApprovedReadonlyTransport?.create();
  if (!transport || !window.LuminaCreatorApprovedReadingHandoff) return;
  const standalone = window.opener === null;
  const catalogTransport = standalone ? window.LuminaCreatorApprovedReadonlyTransport.createCatalog?.() : null;
  let receiver, catalogController;
  const readingScope = () => standalone ? catalogController?.selection() : receiver?.snapshot();
  function scopeCurrent(scope) {
    try {
      if (!scope || readingScope() !== scope || transport.identity()?.ownerId !== scope.ownerId) return false;
      return standalone ? catalogController.isSelectionCurrent(scope) : receiver.snapshot() === scope;
    } catch (_) { return false; }
  }
  window.LuminaCreatorApprovedReadingScope = Object.freeze({
    snapshot: readingScope,
    isCurrent: scopeCurrent,
    async validate(scope, signal) {
      if (!scopeCurrent(scope) || signal?.aborted) return false;
      if (!standalone && !await receiver.validate(signal)) return false;
      return !signal?.aborted && scopeCurrent(scope);
    }
  });
  window.getAuth = transport.getAuth;
  window.LuminaCreatorStudioApi = Object.freeze({ identity: transport.identity, isCurrent: transport.isCurrent,
    async fetch(path, options) {
      const before = standalone ? catalogController?.selection() : receiver?.snapshot();
      if (!before || before.ownerId !== options.identity?.ownerId ||
        path !== "/api/v1/me/creator-studio/stories/" + before.workId.toLowerCase() +
          "/generation-profile/approved-section-bytes?measurement=json-utf8-v1" ||
        (standalone ? !catalogController.isSelectionCurrent(before) || !transport.isCurrent(options.identity) :
          !await receiver.validate(options.signal) || receiver.snapshot() !== before)) throw new Error("Readonly context changed");
      return transport.fetch(path, options);
    } });
  function start() {
    const work = document.getElementById("writerManuscriptWork"), sourceLocale = document.getElementById("writerManuscriptLocale");
    const label = document.getElementById("readingWorkTitle"), state = document.getElementById("readingConnectionState");
    const language = document.getElementById("readingLocale");
    const catalog = document.getElementById("readingCatalog"), catalogSelect = document.getElementById("readingCatalogWork");
    const catalogLoad = document.getElementById("readingCatalogLoad"), catalogNext = document.getElementById("readingCatalogNext");
    const catalogReady = !!(catalog && catalogSelect && catalogLoad && catalogNext && document.getElementById("readingCatalogTitle") &&
      document.getElementById("readingCatalogWorkLabel") && document.getElementById("readingCatalogState"));
    const copy = {
      ko: { title: "\uc2b9\uc778\uc790\ub8cc \ud655\uc778", studio: "\uc2a4\ud29c\ub514\uc624", language: "\uc5b8\uc5b4", empty: "\uc791\ud488 \uc5f0\uacb0 \uc5c6\uc74c" },
      en: { title: "Approved material", studio: "Studio", language: "Language", empty: "No work connected" },
      ja: { title: "\u627f\u8a8d\u8cc7\u6599", studio: "\u30b9\u30bf\u30b8\u30aa", language: "\u8a00\u8a9e", empty: "\u4f5c\u54c1\u672a\u63a5\u7d9a" },
      "zh-Hans": { title: "\u5df2\u6279\u51c6\u8d44\u6599", studio: "\u5de5\u4f5c\u5ba4", language: "\u8bed\u8a00", empty: "\u672a\u8fde\u63a5\u4f5c\u54c1" },
      "zh-Hant": { title: "\u5df2\u6838\u51c6\u8cc7\u6599", studio: "\u5de5\u4f5c\u5ba4", language: "\u8a9e\u8a00", empty: "\u672a\u9023\u63a5\u4f5c\u54c1" }
    };
    const catalogCopy = {
      ko: { title: "내 작품", choose: "작품 선택", load: "작품 불러오기", next: "다음 작품", untitled: "제목 없음", idle: "", loading: "조회 중", ready: "승인 상태: 미확인", empty: "등록된 작품 없음", unauthenticated: "로그인 필요", auth_rejected: "읽기 로그인을 다시 확인해 주세요", stale: "다시 조회 필요", timeout: "응답 시간 초과", unavailable: "조회 실패" },
      en: { title: "My Works", choose: "Select a work", load: "Load works", next: "Next works", untitled: "Untitled", idle: "", loading: "Loading", ready: "Approval: not checked", empty: "No works", unauthenticated: "Sign-in required", auth_rejected: "Check sign-in for this read", stale: "Reload required", timeout: "Request timed out", unavailable: "Unavailable" },
      ja: { title: "自分の作品", choose: "作品を選択", load: "作品を取得", next: "次の作品", untitled: "無題", idle: "", loading: "取得中", ready: "承認状態: 未確認", empty: "作品なし", unauthenticated: "ログインが必要", auth_rejected: "読み取りに使うログインを確認してください", stale: "再取得が必要", timeout: "応答時間超過", unavailable: "取得失敗" },
      "zh-Hans": { title: "我的作品", choose: "选择作品", load: "加载作品", next: "下一页", untitled: "未命名", idle: "", loading: "加载中", ready: "审批状态：未检查", empty: "暂无作品", unauthenticated: "请登录", auth_rejected: "请确认读取所用的登录", stale: "请重新加载", timeout: "请求超时", unavailable: "加载失败" },
      "zh-Hant": { title: "我的作品", choose: "選擇作品", load: "載入作品", next: "下一頁", untitled: "未命名", idle: "", loading: "載入中", ready: "審批狀態：未檢查", empty: "暫無作品", unauthenticated: "請登入", auth_rejected: "請確認讀取所用的登入", stale: "請重新載入", timeout: "請求逾時", unavailable: "載入失敗" }
    };
    let catalogState = { phase: "idle", items: [], nextCursor: null, selected: null };
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
      window.dispatchEvent(new Event("creator:approved-reading-scope-changed"));
    }
    function renderCatalog() {
      if (!standalone || !catalogReady) return;
      const c = catalogCopy[language.value] || catalogCopy.ko;
      document.getElementById("readingCatalogTitle").textContent = c.title;
      document.getElementById("readingCatalogWorkLabel").textContent = c.choose;
      catalogLoad.textContent = c.load; catalogNext.title = c.next; catalogNext.setAttribute("aria-label", c.next);
      catalogLoad.disabled = ["loading", "unauthenticated", "auth_rejected"].includes(catalogState.phase);
      catalogNext.disabled = !catalogState.nextCursor || catalogState.phase === "loading";
      catalogSelect.disabled = catalogState.items.length === 0 || catalogState.phase === "loading";
      catalogSelect.replaceChildren();
      const empty = document.createElement("option"); empty.value = ""; empty.textContent = c.choose; catalogSelect.appendChild(empty);
      for (const item of catalogState.items) {
        const option = document.createElement("option"); option.value = item.workId;
        option.textContent = item.title.value || c.untitled; catalogSelect.appendChild(option);
      }
      catalogSelect.value = catalogState.selected?.workId || "";
      document.getElementById("readingCatalogState").textContent = c[catalogState.phase] ?? c.unavailable;
    }
    function translated() {
      const c = copy[language.value] || copy.ko;
      document.documentElement.lang = language.value;
      document.getElementById("readingTitle").textContent = c.title;
      document.getElementById("readingStudioLink").textContent = c.studio;
      document.getElementById("readingLocaleLabel").textContent = c.language;
      document.title = c.title + " | Lumina Stage";
      label.textContent = currentScope?.workLabel || c.empty;
      renderCatalog();
    }
    if (catalog) catalog.hidden = !standalone;
    if (standalone && catalogReady && catalogTransport && window.LuminaCreatorApprovedReadingCatalog) {
      catalogController = window.LuminaCreatorApprovedReadingCatalog.create({ transport: catalogTransport, locale: () => language.value,
        onChange(value) { catalogState = value; changed(value.selected); renderCatalog(); } });
      catalogLoad.addEventListener("click", () => catalogController.load());
      catalogNext.addEventListener("click", () => catalogController.load(catalogState.nextCursor));
      catalogSelect.addEventListener("change", () => catalogController.choose(catalogSelect.value));
    } else if (!standalone) {
      receiver = window.LuminaCreatorApprovedReadingHandoff.createReceiver({ opener: window.opener, nonce,
        identity: transport.identity, isCurrent: transport.isCurrent, onChange: changed });
      const originalReceiver = receiver; let validationTail = Promise.resolve();
      receiver = Object.freeze({ ...originalReceiver, validate: signal => (validationTail = validationTail.catch(() => false).then(() => originalReceiver.validate(signal))) });
      receiver.start();
    }
    changed(null); translated();
    language.addEventListener("change", () => { translated();
      catalogController?.sync();
      window.dispatchEvent(new Event("lumina:localechange")); });
    const sample = () => { if (standalone) catalogController?.sync(); else receiver?.snapshot(); };
    for (const name of ["storage", "lumina:authchange", "lumina:auth-expired"]) window.addEventListener(name, () => {
      if (standalone) catalogController?.sync(); else receiver?.invalidate(); });
    window.addEventListener("focus", sample);
    const watch = setInterval(sample, 1000);
    window.addEventListener("pagehide", () => { clearInterval(watch); receiver?.dispose(); catalogController?.dispose();
      catalogTransport?.dispose(); transport.dispose(); changed(null);
      if (catalogReady) { catalogSelect.disabled = true; catalogLoad.disabled = true; catalogNext.disabled = true; }
    }, { once: true });
    window.addEventListener("pageshow", event => {
      // BFCache restores disposed readers; a fresh document has no selected work or automatic API request.
      if (event.persisted) window.location.reload();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
