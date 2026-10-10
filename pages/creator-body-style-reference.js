(function () {
  "use strict";
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"], maxBytes = 8 * 1024;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
  const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
  const clone = value => JSON.parse(JSON.stringify(value)), ownErrors = new WeakSet();
  function failure(kind) { const error = new Error(kind); error.kind = kind; ownErrors.add(error); return error; }
  const reasonKeys = {
    body_style_reference_same_approval_pin: "same", body_style_reference_different_approval_pin: "different",
    body_style_reference_no_saved_body: "none", body_style_reference_canonical_body: "canonical",
    body_style_reference_origin_unavailable: "origin", body_style_reference_reused_origin_unavailable: "reused",
    body_style_reference_pin_unavailable: "pin", body_style_reference_unavailable: "unknown"
  };
  const fields = ["title", "check", "ready", "loading", "unauthenticated", "noWork", "unavailable", "forbidden", "conflict", "server", "transport", "invalid", "same", "different", "none", "canonical", "origin", "reused", "pin", "unknown", "source", "revision", "profile", "review", "quality", "unverified"];
  const translations = {
    ko: ["저장 본문 승인 기준", "기준 확인", "기준 확인 대기", "기준 확인 중", "로그인이 필요합니다.", "선택된 작품이 없습니다.", "승인 기준을 확인할 수 없습니다.", "이 승인 기준에 접근할 수 없습니다.", "현재 경로가 변경되었습니다.", "기준을 불러오지 못했습니다.", "연결하지 못했습니다.", "응답을 확인할 수 없습니다.", "현재 승인과 같은 기록", "현재 승인과 다른 기록", "저장된 본문 없음", "원작 본문 · 생성 승인 비교 없음", "생성 기록 미확인", "공유 재사용 · 원 생성 기준 미확인", "승인 기준 기록 미확인", "미확인", "본문 언어", "읽은 경로 버전", "현재 승인 프로필 버전", "현재 검토 버전", "본문 문체 의미 검수", "미확인"],
    en: ["Saved Body Approval Reference", "Check reference", "Reference check pending", "Checking reference", "Sign-in required.", "No work selected.", "Approval reference unavailable.", "This approval reference is not accessible.", "The current path changed.", "Could not load reference.", "Could not connect.", "Response could not be verified.", "Same record as current approval", "Different record from current approval", "No saved body", "Original body · no generation approval comparison", "Generation record unverified", "Shared reuse · original generation reference unverified", "Approval record unverified", "Unverified", "Body language", "Read path revision", "Current approved profile version", "Current review revision", "Body style meaning review", "Unverified"],
    ja: ["保存本文の承認基準", "基準を確認", "基準確認待ち", "基準確認中", "ログインが必要です。", "作品が選択されていません。", "承認基準を確認できません。", "この承認基準にアクセスできません。", "現在の経路が変更されました。", "基準を読み込めませんでした。", "接続できませんでした。", "応答を確認できません。", "現在の承認と同じ記録", "現在の承認と異なる記録", "保存本文なし", "原作本文・生成承認の比較なし", "生成記録は未確認", "共有再利用・元の生成基準は未確認", "承認基準の記録は未確認", "未確認", "本文言語", "読取経路の版", "現在の承認プロファイル版", "現在のレビュー版", "本文文体の意味審査", "未確認"],
    "zh-Hans": ["已保存正文审批基准", "检查基准", "基准待检查", "正在检查基准", "需要登录。", "未选择作品。", "无法检查审批基准。", "无法访问此审批基准。", "当前路径已更改。", "无法读取基准。", "无法连接。", "无法确认响应。", "与当前审批相同的记录", "与当前审批不同的记录", "没有已保存正文", "原作正文 · 无生成审批比较", "生成记录未确认", "共享复用 · 原始生成基准未确认", "审批基准记录未确认", "未确认", "正文语言", "读取的路径版本", "当前审批档案版本", "当前审阅版本", "正文文风含义审阅", "未确认"],
    "zh-Hant": ["已儲存正文審批基準", "檢查基準", "基準待檢查", "正在檢查基準", "需要登入。", "未選擇作品。", "無法檢查審批基準。", "無法存取此審批基準。", "目前路徑已更改。", "無法讀取基準。", "無法連線。", "無法確認回應。", "與目前審批相同的記錄", "與目前審批不同的記錄", "沒有已儲存正文", "原作正文 · 無生成審批比較", "生成記錄未確認", "共用重用 · 原始生成基準未確認", "審批基準記錄未確認", "未確認", "正文語言", "讀取的路徑版本", "目前審批檔案版本", "目前審閱版本", "正文文風含義審閱", "未確認"]
  };
  const copy = Object.fromEntries(locales.map(locale => [locale, Object.fromEntries(fields.map((field, index) => [field, translations[locale][index]]))]));
  const localeNames = { ko: "한국어", en: "English", ja: "日本語", "zh-Hans": "简体中文", "zh-Hant": "繁體中文" };
  function parseDiagnostic(value, sourceLocale) {
    const keys = ["contract", "locale", "sourceScope", "progressRevision", "readOnly", "providerCalls", "operatingWrites", "bodySourceAligned", "semanticQualityVerified", "dispatchAuthorized", "currentSourceState", "currentProfileVersion", "currentReviewRevision", "diagnostic"];
    if (!exact(value, keys) || !locales.includes(sourceLocale) || value.locale !== sourceLocale || value.contract !== "story-author-body-style-reference-read-v1" ||
        value.sourceScope !== "current_saved_body_and_latest_private_approval" || value.readOnly !== true || value.providerCalls !== 0 || value.operatingWrites !== 0 ||
        value.bodySourceAligned !== false || value.semanticQualityVerified !== false || value.dispatchAuthorized !== false ||
        !(value.progressRevision === null || integer(value.progressRevision)) || !["not_checked", "unavailable", "validated"].includes(value.currentSourceState)) throw failure("invalid");
    const validated = value.currentSourceState === "validated", d = value.diagnostic;
    if (validated ? !integer(value.currentProfileVersion, 1) || !integer(value.currentReviewRevision, 1)
      : value.currentProfileVersion !== null || value.currentReviewRevision !== null) throw failure("invalid");
    const diagnosticKeys = ["version", "referenceScope", "contextSource", "comparison", "reason", "readOnly", "currentApprovalVerified", "originalGenerationApprovalVerified", "semanticQualityVerified", "generatedBodyQualityVerified", "bodySourceAligned", "dispatchAuthorized", "providerCalls", "operatingWrites"];
    if (!exact(d, diagnosticKeys) || d.version !== "story-author-body-style-reference-v1" || d.referenceScope !== "stored_completed_origin_request_pin" ||
        d.contextSource !== "caller_supplied_metadata" || d.readOnly !== true || d.providerCalls !== 0 || d.operatingWrites !== 0 ||
        ["currentApprovalVerified", "originalGenerationApprovalVerified", "semanticQualityVerified", "generatedBodyQualityVerified", "bodySourceAligned", "dispatchAuthorized"].some(key => d[key] !== false) ||
        typeof d.reason !== "string" || !Object.prototype.hasOwnProperty.call(reasonKeys, d.reason)) throw failure("invalid");
    const key = reasonKeys[d.reason], expected = key === "same" ? "same_approval_pin" : key === "different" ? "different_approval_pin" : "unavailable";
    if (d.comparison !== expected || (expected !== "unavailable" && (!validated || value.progressRevision === null)) ||
        (key !== "none" && value.progressRevision === null) ||
        (["none", "canonical", "origin", "reused", "unknown"].includes(key) && value.currentSourceState !== "not_checked") ||
        (key === "pin" && value.currentSourceState === "not_checked")) throw failure("invalid");
    return clone(value);
  }
  async function cancel(response) { try { await response?.body?.cancel?.(); } catch (_) {} }
  async function readBody(response, current) {
    const length = response.headers?.get?.("content-length");
    if (length != null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) { await cancel(response); throw failure("invalid"); }
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
        const authenticated = record(owner) && typeof owner.ownerId === "string" && uuid.test(owner.ownerId) && integer(owner.epoch) && isCurrent(owner) === true;
        return { workId: typeof target?.workId === "string" ? target.workId : "", sourceLocale: locales.includes(target?.locale) ? target.locale : null,
          locale: locales.includes(language) ? language : "ko", shown, available: typeof fetch === "function", owner: authenticated ? { ownerId: owner.ownerId, epoch: owner.epoch } : null };
      } catch (_) { return { workId: "", sourceLocale: null, locale: "ko", shown: false, available: false, owner: null }; }
    }
    function initial(s) { return !s.shown ? "hidden" : !s.available ? "unavailable" : !s.owner ? "unauthenticated" : !s.workId ? "noWork" : !uuid.test(s.workId) || !locales.includes(s.sourceLocale) ? "invalid" : "ready"; }
    function state() { return { ticket, phase, messageKey, locale: scope?.locale || "ko", data: data === null ? null : clone(data), busy: phase === "loading", canLoad: !!scope && initial(scope) === "ready" && phase !== "loading" }; }
    function emit() { onChange(state()); }
    function reset(next) { const old = request; ++ticket; request = null; data = null; phase = "idle"; scope = next; messageKey = next ? initial(next) : "ready"; old?.abort(); }
    function syncContext(notify = true) { const before = ticket, next = sample(); if (before !== ticket) return state(); if (JSON.stringify(scope) !== JSON.stringify(next)) { reset(next); if (notify) emit(); } return state(); }
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
        const response = await fetch(`/api/v1/me/creator-studio/stories/${target.workId}/body-preview/style-reference?locale=${target.locale}`, {
          method: "GET", identity: owner, _retried: true, cache: "no-store", headers: { "Cache-Control": "no-store" }, signal: abort.signal
        });
        if (!current()) { await cancel(response); return false; }
        if (!integer(response?.status, 100) || response.status > 599) { await cancel(response); throw failure("invalid"); }
        if (response.status !== 200) { await cancel(response); throw failure(response.status === 401 ? "unauthenticated" : response.status === 403 ? "forbidden" : response.status === 409 ? "conflict" : response.status >= 500 ? "server" : "unavailable"); }
        const raw = await readBody(response, current);
        if (!current()) return false;
        const parsed = parseDiagnostic(raw, target.locale);
        if (!current()) return false;
        data = parsed; phase = "ready"; request = null; messageKey = reasonKeys[parsed.diagnostic.reason]; emit(); return current();
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
    if (!host || host.dataset.bodyStyleReferenceMounted) return null;
    const shell = document.getElementById("studioShell"), section = document.getElementById("writer-manuscript");
    if (!shell || !section) return null;
    host.dataset.bodyStyleReferenceMounted = "true";
    function element(tag, name) { const node = document.createElement(tag); if (name) node.className = name; return node; }
    const header = element("div", "body-style-reference-header"), title = element("h3"), button = element("button", "body-style-reference-check");
    title.id = "writerBodyStyleReferenceTitle"; button.id = "writerBodyStyleReferenceCheck"; button.type = "button";
    let icon; try { if (typeof window.lucide?.createElement === "function" && window.lucide?.icons?.ListChecks) icon = window.lucide.createElement(window.lucide.icons.ListChecks); } catch (_) {}
    if (!icon) { icon = element("span"); icon.textContent = "\u2261"; }
    icon.setAttribute("aria-hidden", "true"); button.append(icon); header.append(title, button);
    const status = element("p", "body-style-reference-state"), content = element("dl", "body-style-reference-metadata");
    status.id = "writerBodyStyleReferenceState"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); content.id = "writerBodyStyleReferenceContent";
    host.replaceChildren(header, status, content);
    function render(state) {
      const c = copy[state.locale]; host.lang = state.locale; title.textContent = c.title;
      button.title = c.check; button.setAttribute("aria-label", c.check); button.setAttribute("aria-busy", String(state.busy)); button.disabled = !state.canLoad;
      status.textContent = c[state.messageKey] || ""; status.className = "body-style-reference-state" + (state.phase === "error" ? " is-error" : "");
      content.replaceChildren(); content.hidden = state.data === null;
      if (!state.data) return;
      function row(label, value) { const group = element("div"), dt = element("dt"), dd = element("dd"); dt.textContent = c[label]; dd.textContent = value === null ? c.unverified : String(value); group.append(dt, dd); content.append(group); }
      row("source", localeNames[state.data.locale]); row("revision", state.data.progressRevision);
      row("profile", state.data.currentProfileVersion); row("review", state.data.currentReviewRevision); row("quality", c.unverified);
    }
    const controller = createController({
      fetch: (url, options) => {
        const auth = window.getAuth?.(), token = auth?.accessToken || auth?.access_token || auth?.token || auth?.tokens?.accessToken || auth?.tokens?.access_token;
        if (typeof token !== "string" || !token) throw failure("unauthenticated");
        const authorized = window.LuminaCreatorStudioApi?.isCurrent?.(options.identity) === true;
        controller.syncContext(); if (!authorized || options.signal.aborted) throw failure("stale");
        return window.LuminaCreatorStudioApi.fetch(url, { ...options, token });
      }, identity: () => window.LuminaCreatorStudioApi?.identity?.(),
      isCurrent: owner => typeof window.LuminaCreatorStudioApi?.fetch === "function" && window.LuminaCreatorStudioApi?.isCurrent?.(owner) === true,
      context: () => ({ workId: document.getElementById("writerManuscriptWork")?.value || "", locale: document.getElementById("writerManuscriptLocale")?.value }),
      locale: () => window.luminaI18n?.getLocale?.() || document.documentElement.lang || "ko",
      visible: () => !shell.hidden && !section.hidden && !host.hidden && host.isConnected !== false && section.classList.contains("is-active") && document.visibilityState !== "hidden", onChange: render
    });
    button.addEventListener("click", () => controller.load(controller.snapshot().ticket));
    const invalidate = () => controller.invalidate(), sync = () => controller.syncContext();
    for (const name of ["storage", "lumina:authchange", "lumina:auth-expired", "pagehide", "creator:manuscript-accepted", "creator:generation-profile-changed", "lumina:author-body-trial-progress-changed"]) window.addEventListener(name, invalidate);
    for (const name of ["focus", "pageshow", "lumina:localechange"]) window.addEventListener(name, sync);
    for (const name of ["visibilitychange", "lumina:auth-expired"]) document.addEventListener(name, invalidate);
    const selects = ["writerManuscriptWork", "writerManuscriptLocale"].map(id => document.getElementById(id)).filter(Boolean);
    for (const select of selects) for (const name of ["input", "change"]) select.addEventListener(name, invalidate);
    document.addEventListener("click", event => { const tab = event.target?.closest?.("[data-section]"); if (tab && tab.getAttribute("data-section") !== "writer-manuscript") invalidate(); }, true);
    if (typeof MutationObserver === "function") {
      for (const [node, attributes] of [[shell, ["hidden"]], [section, ["class", "hidden", "style"]], [host, ["hidden"]], [document.documentElement, ["lang"]]]) new MutationObserver(invalidate).observe(node, { attributes: true, attributeFilter: attributes });
      for (const select of selects) new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "selected", "disabled"] });
    }
    render(controller.snapshot()); return controller;
  }
  window.LuminaCreatorBodyStyleReference = { createController, parseDiagnostic, mount, copy, maxBytes };
  if (typeof document !== "undefined") mount(document.getElementById("writerBodyStyleReference"));
})();
