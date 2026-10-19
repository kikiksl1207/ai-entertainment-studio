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
    const catalogLogin = document.getElementById("readingCatalogLogin");
    const catalogConnect = document.getElementById("readingCatalogConnect");
    const catalogRestart = document.getElementById("readingCatalogRestart");
    const authConnectionStatus = document.getElementById("readingAuthConnectionState");
    const catalogWorks = document.getElementById("readingCatalogWorks");
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
      ko: { title: "내 작품", choose: "작품 선택", load: "작품 불러오기", next: "다음 작품", login: "로그인 (새 탭)", untitled: "제목 없음", idle: "", loading: "조회 중", ready: "승인 상태: 미확인", empty: "등록된 작품 없음", unauthenticated: "로그인 필요", auth_rejected: "읽기 로그인을 다시 확인해 주세요", stale: "다시 조회 필요", timeout: "응답 시간 초과", unavailable: "조회 실패" },
      en: { title: "My Works", choose: "Select a work", load: "Load works", next: "Next works", login: "Sign in (new tab)", untitled: "Untitled", idle: "", loading: "Loading", ready: "Approval: not checked", empty: "No works", unauthenticated: "Sign-in required", auth_rejected: "Check sign-in for this read", stale: "Reload required", timeout: "Request timed out", unavailable: "Unavailable" },
      ja: { title: "自分の作品", choose: "作品を選択", load: "作品を取得", next: "次の作品", login: "ログイン (新しいタブ)", untitled: "無題", idle: "", loading: "取得中", ready: "承認状態: 未確認", empty: "作品なし", unauthenticated: "ログインが必要", auth_rejected: "読み取りに使うログインを確認してください", stale: "再取得が必要", timeout: "応答時間超過", unavailable: "取得失敗" },
      "zh-Hans": { title: "我的作品", choose: "选择作品", load: "加载作品", next: "下一页", login: "登录 (新标签页)", untitled: "未命名", idle: "", loading: "加载中", ready: "审批状态：未检查", empty: "暂无作品", unauthenticated: "请登录", auth_rejected: "请确认读取所用的登录", stale: "请重新加载", timeout: "请求超时", unavailable: "加载失败" },
      "zh-Hant": { title: "我的作品", choose: "選擇作品", load: "載入作品", next: "下一頁", login: "登入 (新分頁)", untitled: "未命名", idle: "", loading: "載入中", ready: "審批狀態：未檢查", empty: "暫無作品", unauthenticated: "請登入", auth_rejected: "請確認讀取所用的登入", stale: "請重新載入", timeout: "請求逾時", unavailable: "載入失敗" }
    };
    const catalogAuthCopy = {
      ko: { AUTH_TOKEN_EXPIRED: "읽기에 보낸 로그인 정보가 만료되었습니다", AUTH_CONFIG_UNAVAILABLE: "서버 인증 설정을 확인할 수 없습니다", AUTH_LOOKUP_UNAVAILABLE: "서버에서 로그인 상태를 확인할 수 없습니다" },
      en: { AUTH_TOKEN_EXPIRED: "The sign-in sent for this read has expired", AUTH_CONFIG_UNAVAILABLE: "Server authentication settings are unavailable", AUTH_LOOKUP_UNAVAILABLE: "The server cannot check sign-in right now" },
      ja: { AUTH_TOKEN_EXPIRED: "読み取りに送信したログイン情報の期限が切れています", AUTH_CONFIG_UNAVAILABLE: "サーバーの認証設定を確認できません", AUTH_LOOKUP_UNAVAILABLE: "サーバーでログイン状態を確認できません" },
      "zh-Hans": { AUTH_TOKEN_EXPIRED: "本次读取使用的登录信息已过期", AUTH_CONFIG_UNAVAILABLE: "无法确认服务器认证设置", AUTH_LOOKUP_UNAVAILABLE: "服务器暂时无法确认登录状态" },
      "zh-Hant": { AUTH_TOKEN_EXPIRED: "本次讀取使用的登入資訊已過期", AUTH_CONFIG_UNAVAILABLE: "無法確認伺服器驗證設定", AUTH_LOOKUP_UNAVAILABLE: "伺服器暫時無法確認登入狀態" }
    };
    let catalogState = { phase: "idle", items: [], nextCursor: null, selected: null, authReason: null };
    let pageDisposed = false;
    let authConnection = null, authConnectionState = { phase: "idle", canConnect: false };
    const authConnectionCopy = {
      ko: { connect: "인증 연결", connecting: "인증 연결 중", connected: "인증 연결됨", rejected: "인증 연결 거절", uncertain: "인증 처리 상태 확인 필요", changed: "로그인 정보 변경됨", unavailable: "인증 연결 불가", confirm: "로그인 인증을 갱신하고 현재 읽기 선택을 해제하시겠습니까? 작품은 자동 조회하지 않습니다." },
      en: { connect: "Connect sign-in", connecting: "Connecting sign-in", connected: "Sign-in connected", rejected: "Connection rejected", uncertain: "Connection outcome needs review", changed: "Sign-in changed", unavailable: "Connection unavailable", confirm: "Renew sign-in and clear the current reading selection? Works will not be loaded automatically." },
      ja: { connect: "認証を接続", connecting: "認証を接続中", connected: "認証接続済み", rejected: "認証接続が拒否されました", uncertain: "認証処理の確認が必要です", changed: "ログイン情報が変更されました", unavailable: "認証接続不可", confirm: "認証を更新し、現在の閲覧選択を解除しますか？作品は自動取得しません。" },
      "zh-Hans": { connect: "连接认证", connecting: "正在连接认证", connected: "认证已连接", rejected: "认证连接被拒绝", uncertain: "需要确认认证处理状态", changed: "登录信息已更改", unavailable: "无法连接认证", confirm: "更新登录认证并清除当前阅读选择吗？不会自动加载作品。" },
      "zh-Hant": { connect: "連接驗證", connecting: "正在連接驗證", connected: "驗證已連接", rejected: "驗證連接遭拒", uncertain: "需要確認驗證處理狀態", changed: "登入資訊已變更", unavailable: "無法連接驗證", confirm: "更新登入驗證並清除目前閱讀選擇嗎？不會自動載入作品。" }
    };
    const connectionLocksRead = () => ["connecting", "uncertain", "rejected", "changed"].includes(authConnectionState.phase);
    const restartCopy = { ko: "읽기 화면 다시 열기", en: "Reopen reading", ja: "閲覧画面を開き直す", "zh-Hans": "重新打开阅读页面", "zh-Hant": "重新開啟閱讀頁面" };
    let authTimeBusy = false, authTimeRetired = false;
    function removeAuthTimeHint() {
      try { document.documentElement.removeAttribute("data-unverified-auth-time"); } catch (_) {}
    }
    function retireAuthTimeHint() {
      authTimeRetired = true;
      removeAuthTimeHint();
    }
    function renderAuthTimeHint() {
      if (authTimeRetired) return;
      if (pageDisposed) { retireAuthTimeHint(); return; }
      if (authTimeBusy) { authTimeRetired = true; return; }
      authTimeBusy = true;
      try {
        const inspector = window.LuminaCreatorApprovedUnverifiedAuthTime?.inspect;
        const observed = typeof inspector === "function" ? inspector() : undefined;
        const hint = typeof observed === "string" && ["expired", "future", "unknown"].includes(observed) ? observed : "unknown";
        if (pageDisposed || authTimeRetired) return;
        const root = document.documentElement;
        const previous = root.getAttribute("data-unverified-auth-time");
        if (pageDisposed || authTimeRetired) return;
        if (previous !== hint) root.setAttribute("data-unverified-auth-time", hint);
      } catch (_) { authTimeRetired = true; }
      finally {
        if (pageDisposed) authTimeRetired = true;
        if (authTimeRetired) removeAuthTimeHint();
        authTimeBusy = false;
      }
    }
    let authLifetimeBusy = false, authLifetimeRetired = false;
    function removeAuthLifetimeHint() {
      try { document.documentElement.removeAttribute("data-unverified-auth-lifetime"); } catch (_) {}
    }
    function retireAuthLifetimeHint() {
      authLifetimeRetired = true;
      removeAuthLifetimeHint();
    }
    function renderAuthLifetimeHint() {
      if (authLifetimeRetired) return;
      if (pageDisposed) { retireAuthLifetimeHint(); return; }
      if (authLifetimeBusy) { authLifetimeRetired = true; return; }
      authLifetimeBusy = true;
      try {
        const inspector = window.LuminaCreatorApprovedUnverifiedAuthLifetime?.inspect;
        const observed = typeof inspector === "function" ? inspector() : undefined;
        const hint = typeof observed === "string" && ["unknown", "nonpositive", "under-minute", "minute-or-longer"].includes(observed) ? observed : "unknown";
        if (pageDisposed || authLifetimeRetired) return;
        const root = document.documentElement;
        const previous = root.getAttribute("data-unverified-auth-lifetime");
        if (pageDisposed || authLifetimeRetired) return;
        if (previous !== hint) root.setAttribute("data-unverified-auth-lifetime", hint);
      } catch (_) { authLifetimeRetired = true; }
      finally {
        if (pageDisposed) authLifetimeRetired = true;
        if (authLifetimeRetired) removeAuthLifetimeHint();
        authLifetimeBusy = false;
      }
    }
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
      renderAuthTimeHint();
      renderAuthLifetimeHint();
      const connectionCopy = authConnectionCopy[language.value] || authConnectionCopy.ko;
      if (catalogConnect) {
        catalogConnect.hidden = !standalone;
        catalogConnect.textContent = connectionCopy.connect;
        catalogConnect.disabled = pageDisposed || !standalone || !authConnectionState.canConnect;
      }
      if (authConnectionStatus) authConnectionStatus.textContent = pageDisposed ? "" : connectionCopy[authConnectionState.phase] || "";
      const recovery = ["uncertain", "rejected", "changed"].includes(authConnectionState.phase);
      if (catalogRestart) {
        catalogRestart.textContent = restartCopy[language.value] || restartCopy.ko;
        catalogRestart.hidden = pageDisposed || !standalone || !(recovery || catalogState.phase === "auth_rejected" && !authConnectionState.canConnect);
      }
      if (!standalone || !catalogReady) return;
      const c = catalogCopy[language.value] || catalogCopy.ko;
      document.getElementById("readingCatalogTitle").textContent = c.title;
      document.getElementById("readingCatalogWorkLabel").textContent = c.choose;
      catalogLoad.textContent = c.load; catalogNext.title = c.next; catalogNext.setAttribute("aria-label", c.next);
      catalogLoad.disabled = connectionLocksRead() || ["loading", "unauthenticated", "auth_rejected"].includes(catalogState.phase);
      catalogNext.disabled = connectionLocksRead() || !catalogState.nextCursor || catalogState.phase === "loading";
      catalogSelect.disabled = connectionLocksRead() || catalogState.items.length === 0 || catalogState.phase === "loading";
      catalogSelect.replaceChildren();
      const empty = document.createElement("option"); empty.value = ""; empty.textContent = c.choose; catalogSelect.appendChild(empty);
      for (const item of catalogState.items) {
        const option = document.createElement("option"); option.value = item.workId;
        option.textContent = item.title.value || c.untitled; catalogSelect.appendChild(option);
      }
      catalogSelect.value = catalogState.selected?.workId || "";
      if (catalogWorks) {
        const focused = document.activeElement;
        const focusId = catalogWorks.contains(focused) ? focused?.dataset?.workId : null;
        const renderedState = catalogState;
        catalogWorks.replaceChildren();
        catalogWorks.hidden = pageDisposed || renderedState.phase !== "ready" || !renderedState.items.length;
        if (!catalogWorks.hidden) for (const item of renderedState.items) {
          const row = document.createElement("li"), button = document.createElement("button");
          button.type = "button"; button.className = "reading-work-button"; button.dataset.workId = item.workId;
          button.textContent = item.title.value || c.untitled;
          button.setAttribute("aria-pressed", String(item.workId === renderedState.selected?.workId));
          button.addEventListener("click", () => {
            if (pageDisposed || connectionLocksRead() || !button.isConnected || catalogState !== renderedState) return;
            catalogController?.sync();
            if (!pageDisposed && button.isConnected && catalogState === renderedState) catalogController?.choose(item.workId);
          });
          row.appendChild(button); catalogWorks.appendChild(row);
          if (focusId === item.workId) button.focus();
        }
      }
      const catalogStatus = document.getElementById("readingCatalogState");
      const reason = !pageDisposed && (catalogState.phase === "auth_rejected" && catalogState.authReason === "AUTH_TOKEN_EXPIRED" ||
        catalogState.phase === "unavailable" && ["AUTH_CONFIG_UNAVAILABLE", "AUTH_LOOKUP_UNAVAILABLE"].includes(catalogState.authReason)) ? catalogState.authReason : null;
      catalogStatus.textContent = (catalogAuthCopy[language.value] || catalogAuthCopy.ko)[reason] ?? c[catalogState.phase] ?? c.unavailable;
      const receipt = pageDisposed ? null : catalogState.requestReceipt;
      const diagnosticData = catalogStatus.dataset;
      if (diagnosticData && typeof diagnosticData === "object") {
        for (const key of ["requestPhase", "responseStatus", "nativeFetchInvoked", "requestReceiptContract", "receiptAuthority"]) delete diagnosticData[key];
        if (receipt) {
          diagnosticData.requestPhase = receipt.phase;
          diagnosticData.responseStatus = receipt.responseStatus;
          diagnosticData.nativeFetchInvoked = String(receipt.nativeFetchInvoked);
          diagnosticData.requestReceiptContract = receipt.contract;
          diagnosticData.receiptAuthority = receipt.authority;
        }
      }
      if (catalogLogin) {
        catalogLogin.textContent = c.login;
        const selected = catalogState.selected;
        const numericRejected = !!selected && catalogController?.isSelectionCurrent(selected) === true &&
          document.getElementById("writerApprovedSectionBytes")?.dataset?.readAuthRejected === "true";
        catalogLogin.hidden = pageDisposed || (!["unauthenticated", "auth_rejected"].includes(catalogState.phase) && !numericRejected && !recovery);
      }
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
      catalogLoad.addEventListener("click", () => { if (!connectionLocksRead()) return catalogController.load(); });
      catalogNext.addEventListener("click", () => { if (!connectionLocksRead()) return catalogController.load(catalogState.nextCursor); });
      catalogSelect.addEventListener("change", () => { if (!connectionLocksRead()) return catalogController.choose(catalogSelect.value); });
    } else if (!standalone) {
      receiver = window.LuminaCreatorApprovedReadingHandoff.createReceiver({ opener: window.opener, nonce,
        identity: transport.identity, isCurrent: transport.isCurrent, onChange: changed });
      const originalReceiver = receiver; let validationTail = Promise.resolve();
      receiver = Object.freeze({ ...originalReceiver, validate: signal => (validationTail = validationTail.catch(() => false).then(() => originalReceiver.validate(signal))) });
      receiver.start();
    }
    if (standalone && catalogConnect && window.LuminaCreatorApprovedAuthConnection) {
      try {
        authConnection = window.LuminaCreatorApprovedAuthConnection.create({ onChange(value) { authConnectionState = value; renderCatalog(); } });
        authConnectionState = authConnection.state();
      } catch (_) { authConnectionState = { phase: "unavailable", canConnect: false }; }
      catalogConnect.addEventListener("click", () => {
        if (pageDisposed || !authConnection || !authConnection.state().canConnect) return;
        try {
          const identity = transport.identity(), raw = window.localStorage.getItem("lumina_auth");
          if (!identity || !raw) return;
          const confirmed = window.confirm((authConnectionCopy[language.value] || authConnectionCopy.ko).confirm);
          if (confirmed === true && !pageDisposed && transport.isCurrent(identity) && window.localStorage.getItem("lumina_auth") === raw) {
            void authConnection.connect(true);
          }
        } catch (_) {}
      });
    }
    changed(null); translated();
    language.addEventListener("change", () => { translated();
      catalogController?.sync();
      window.dispatchEvent(new Event("lumina:localechange")); });
    const sample = () => { authConnection?.sync(); if (standalone) catalogController?.sync(); else receiver?.snapshot(); renderAuthTimeHint(); renderAuthLifetimeHint(); };
    for (const name of ["storage", "lumina:authchange", "lumina:auth-expired", "creator:approved-auth-connection-start"]) window.addEventListener(name, () => {
      if (standalone) catalogController?.sync(); else receiver?.invalidate(); });
    window.addEventListener("focus", sample);
    window.addEventListener("creator:approved-section-auth-state", renderCatalog);
    const watch = setInterval(sample, 1000);
    window.addEventListener("pagehide", () => { pageDisposed = true; authConnection?.dispose(); retireAuthTimeHint(); retireAuthLifetimeHint(); clearInterval(watch); receiver?.dispose(); catalogController?.dispose();
      catalogTransport?.dispose(); transport.dispose(); changed(null);
      if (catalogReady) { catalogSelect.disabled = true; catalogLoad.disabled = true; catalogNext.disabled = true; }
      if (catalogLogin) catalogLogin.hidden = true;
      if (catalogConnect) catalogConnect.disabled = true;
      if (catalogRestart) catalogRestart.hidden = true;
    }, { once: true });
    window.addEventListener("pageshow", event => {
      // BFCache restores disposed readers; a fresh document has no selected work or automatic API request.
      if (event.persisted) window.location.reload();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
