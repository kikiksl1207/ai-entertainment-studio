(function () {
  "use strict";
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const maxBytes = 192 * 1024;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const record = v => v !== null && typeof v === "object" && !Array.isArray(v);
  const exact = (v, keys) => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));
  const integer = v => Number.isSafeInteger(v) && v > 0;
  const text = v => typeof v === "string" && v.length <= 8000;
  const clone = v => JSON.parse(JSON.stringify(v));
  function boundedJson(v, depth = 0) {
    if (depth > 8) return false;
    if (v === null || typeof v === "boolean") return true;
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v === "string") return text(v);
    if (Array.isArray(v)) return v.length <= 200 && v.every(item => boundedJson(item, depth + 1));
    if (!record(v)) return false;
    const entries = Object.entries(v);
    return entries.length <= 100 && entries.every(([key, item]) => key.length > 0 && key.length <= 120 &&
      !["__proto__", "constructor", "prototype"].includes(key) && boundedJson(item, depth + 1));
  }
  function structuredStyle(v) {
    return Object.keys(v).length > 0 && Object.keys(v).every(k => ["summary", "observations", "categories", "imitationBoundary"].includes(k)) &&
      (v.summary === undefined || text(v.summary)) && (v.imitationBoundary === undefined || text(v.imitationBoundary)) &&
      (v.observations === undefined || (Array.isArray(v.observations) && v.observations.every(row => record(row) &&
        Object.keys(row).every(k => ["title", "detail", "sourceRef"].includes(k)) && text(row.title) && text(row.detail) &&
        (row.sourceRef === undefined || text(row.sourceRef))))) &&
      (v.categories === undefined || (Array.isArray(v.categories) && v.categories.every(row => exact(row, ["category", "observations"]) &&
        text(row.category) && Array.isArray(row.observations) && row.observations.every(text))));
  }
  const copy = {
    ko: { title: "승인된 작가 문체", load: "문체 지침 읽기", basis: "최신 비공개 원고 · 완료 분석 · 승인 프로필 기준", ready: "문체 지침 확인 대기", loading: "문체 지침 읽는 중", loaded: "현재 승인 지침", unauthenticated: "로그인이 필요합니다.", unavailable: "승인 문체를 읽을 수 없습니다.", conflict: "현재 원고와 승인 프로필을 확인해 주세요.", invalid: "문체 응답을 확인할 수 없습니다.", transport: "문체 지침을 불러오지 못했습니다.", noWork: "선택된 작품이 없습니다.", hidden: "", language: "원고 언어", manuscript: "원고 버전", analysis: "분석 버전", profile: "프로필 버전", review: "검토 버전", summary: "문체 요약", observations: "문체 관측", categories: "문체 범주", boundary: "모방 범위", evidence: "승인 근거", empty: "등록된 항목 없음" },
    en: { title: "Approved Author Style", load: "Read style rules", basis: "Latest private manuscript · completed analysis · approved profile", ready: "Style rules not loaded", loading: "Reading style rules", loaded: "Current approved rules", unauthenticated: "Sign in required.", unavailable: "Approved style is unavailable.", conflict: "Check the current manuscript and approved profile.", invalid: "The style response could not be verified.", transport: "Style rules could not be loaded.", noWork: "No work selected.", hidden: "", language: "Manuscript language", manuscript: "Manuscript version", analysis: "Analysis version", profile: "Profile version", review: "Review version", summary: "Style summary", observations: "Style observations", categories: "Style categories", boundary: "Imitation boundary", evidence: "Approved evidence", empty: "No recorded items" },
    ja: { title: "承認された作家文体", load: "文体指針を読む", basis: "最新の非公開原稿 · 完了分析 · 承認プロファイル", ready: "文体指針の確認待ち", loading: "文体指針を読込中", loaded: "現在の承認指針", unauthenticated: "ログインが必要です。", unavailable: "承認文体を読み込めません。", conflict: "現在の原稿と承認プロファイルを確認してください。", invalid: "文体応答を確認できません。", transport: "文体指針を取得できませんでした。", noWork: "作品が選択されていません。", hidden: "", language: "原稿言語", manuscript: "原稿版", analysis: "分析版", profile: "プロファイル版", review: "検討版", summary: "文体要約", observations: "文体観測", categories: "文体分類", boundary: "模倣範囲", evidence: "承認根拠", empty: "登録項目なし" },
    "zh-Hans": { title: "已批准作者文风", load: "读取文风规则", basis: "最新私有稿件 · 已完成分析 · 已批准档案", ready: "文风规则待读取", loading: "正在读取文风规则", loaded: "当前批准规则", unauthenticated: "需要登录。", unavailable: "无法读取已批准文风。", conflict: "请检查当前稿件与已批准档案。", invalid: "无法验证文风响应。", transport: "无法加载文风规则。", noWork: "未选择作品。", hidden: "", language: "稿件语言", manuscript: "稿件版本", analysis: "分析版本", profile: "档案版本", review: "审核版本", summary: "文风摘要", observations: "文风观察", categories: "文风类别", boundary: "模仿范围", evidence: "批准依据", empty: "无记录项" },
    "zh-Hant": { title: "已核准作者文風", load: "讀取文風規則", basis: "最新私有稿件 · 已完成分析 · 已核准檔案", ready: "文風規則待讀取", loading: "正在讀取文風規則", loaded: "目前核准規則", unauthenticated: "需要登入。", unavailable: "無法讀取已核准文風。", conflict: "請檢查目前稿件與已核准檔案。", invalid: "無法驗證文風回應。", transport: "無法載入文風規則。", noWork: "未選擇作品。", hidden: "", language: "稿件語言", manuscript: "稿件版本", analysis: "分析版本", profile: "檔案版本", review: "審核版本", summary: "文風摘要", observations: "文風觀察", categories: "文風類別", boundary: "模仿範圍", evidence: "核准依據", empty: "無紀錄項目" }
  };
  const languageNames = { ko: "한국어", en: "English", ja: "日本語", "zh-Hans": "简体中文", "zh-Hant": "繁體中文" };
  const errors = new WeakSet();
  function fail(kind) { const e = new Error(kind); e.kind = kind; errors.add(e); return e; }
  function parseStyle(v) {
    if (!exact(v, ["version", "sourceScope", "locale", "manuscriptVersion", "analysisVersion", "profileVersion", "reviewRevision", "section", "readOnly", "providerCalls", "operatingWrites", "bodySourceAligned", "semanticQualityVerified"]) ||
      v.version !== "story-author-approved-style-v1" || v.sourceScope !== "latest_private_manuscript_completed_analysis" || !locales.includes(v.locale) ||
      !["manuscriptVersion", "analysisVersion", "profileVersion", "reviewRevision"].every(k => integer(v[k])) ||
      v.readOnly !== true || v.providerCalls !== 0 || v.operatingWrites !== 0 || v.bodySourceAligned !== false || v.semanticQualityVerified !== false) throw fail("invalid");
    const s = v.section, value = s?.value;
    if (!exact(s, ["key", "decision", "value", "evidence"]) || s.key !== "writing_style" || !["accepted", "edited"].includes(s.decision) ||
      !record(value) || !boundedJson(value) || !Array.isArray(s.evidence) || s.evidence.length > 20 ||
      new TextEncoder().encode(JSON.stringify(s)).byteLength > 128 * 1024) throw fail("invalid");
    for (const row of s.evidence) {
      if (!exact(row, ["sourceType", "sourceRef", "summary"]) || !["manuscript", "metadata", "visual", "profile"].includes(row.sourceType) ||
        !text(row.sourceRef) || !row.sourceRef.trim() || row.sourceRef.length > 300 ||
        !text(row.summary) || !row.summary.trim() || row.summary.length > 1000) throw fail("invalid");
    }
    return clone(v);
  }
  async function cancel(response) { try { await response?.body?.cancel?.(); } catch (_) {} }
  async function readBody(response, current) {
    const length = response.headers?.get?.("content-length");
    if (length != null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) { await cancel(response); throw fail("invalid"); }
    if (typeof response.body?.getReader !== "function") { await cancel(response); throw fail("invalid"); }
    const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
    let count = 0, body = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (!current()) throw fail("stale");
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) throw fail("invalid");
        count += chunk.value.byteLength;
        if (count > maxBytes) throw fail("invalid");
        try { body += decoder.decode(chunk.value, { stream: true }); } catch (_) { throw fail("invalid"); }
      }
      try { body += decoder.decode(); } catch (_) { throw fail("invalid"); }
      if (!current()) throw fail("stale");
      try { return JSON.parse(body); } catch (_) { throw fail("invalid"); }
    } catch (e) { try { await reader.cancel(); } catch (_) {} throw e; }
    finally { reader.releaseLock(); }
  }
  function createController({ fetch, identity, isCurrent, context, locale = () => "ko", visible = () => true, onChange = () => {} }) {
    let scope = null, ticket = 0, data = null, phase = "idle", messageKey = "ready", request = null;
    function sample() {
      try {
        const target = context(), language = locale(), owner = identity(), shown = visible() === true;
        const authenticated = record(owner) && typeof owner.ownerId === "string" && uuid.test(owner.ownerId) && Number.isSafeInteger(owner.epoch) && owner.epoch >= 0 && isCurrent(owner) === true;
        return { workId: typeof target?.workId === "string" ? target.workId : "", sourceLocale: locales.includes(target?.locale) ? target.locale : null,
          locale: locales.includes(language) ? language : "ko", shown, available: typeof fetch === "function",
          owner: authenticated ? { ownerId: owner.ownerId, epoch: owner.epoch } : null };
      } catch (_) { return { workId: "", sourceLocale: null, locale: "ko", shown: false, available: false, owner: null }; }
    }
    function initial(s) { return !s.shown ? "hidden" : !s.available ? "unavailable" : !s.owner ? "unauthenticated" : !s.workId ? "noWork" : !uuid.test(s.workId) || !s.sourceLocale ? "invalid" : "ready"; }
    function state() { return { ticket, phase, messageKey, locale: scope?.locale || "ko", data: data === null ? null : clone(data), busy: phase === "loading", canLoad: !!scope && initial(scope) === "ready" && phase !== "loading" }; }
    function reset(next) { const old = request; ++ticket; request = null; data = null; phase = "idle"; scope = next; messageKey = next ? initial(next) : "ready"; old?.abort(); }
    function syncContext(notify = true) { const before = ticket, next = sample(); if (before !== ticket) return state(); if (JSON.stringify(scope) !== JSON.stringify(next)) { reset(next); if (notify) onChange(state()); } return state(); }
    function invalidate() { reset(null); syncContext(false); onChange(state()); }
    async function load(expectedTicket = null) {
      syncContext();
      if (!state().canLoad || (expectedTicket !== null && expectedTicket !== ticket)) return false;
      const workId = scope.workId, owner = { ...scope.owner }, ownTicket = ++ticket, abort = new AbortController();
      request = abort; data = null; phase = "loading"; messageKey = "loading";
      const current = () => { syncContext(); return ticket === ownTicket; };
      onChange(state());
      try {
        if (!current()) return false;
        const response = await fetch("/api/v1/me/creator-studio/stories/" + workId + "/generation-profile/approved-style",
          { method: "GET", identity: owner, _retried: true, cache: "no-store", headers: { "Cache-Control": "no-store" }, signal: abort.signal });
        if (!current()) { await cancel(response); return false; }
        if (!Number.isInteger(response?.status)) { await cancel(response); throw fail("invalid"); }
        if (response.status !== 200) { await cancel(response); throw fail(response.status === 401 ? "unauthenticated" : response.status === 409 ? "conflict" : "unavailable"); }
        const raw = await readBody(response, current);
        if (!current()) return false;
        const parsed = parseStyle(raw);
        if (!current()) return false;
        data = parsed; phase = "ready"; messageKey = "loaded"; request = null; onChange(state()); return current();
      } catch (e) {
        if (!current()) return false;
        data = null; request = null; phase = "error";
        messageKey = errors.has(e) && ["invalid", "unauthenticated", "conflict", "unavailable"].includes(e.kind) ? e.kind : "transport";
        onChange(state()); return false;
      }
    }
    return { snapshot: () => syncContext(), syncContext, invalidate, load };
  }
  function mount(host) {
    if (!host || host.dataset.approvedStyleMounted) return null;
    const shell = document.getElementById("studioShell"), section = document.getElementById("writer-manuscript");
    if (!shell || !section) return null;
    host.dataset.approvedStyleMounted = "true";
    const node = (tag, name) => { const el = document.createElement(tag); if (name) el.className = name; return el; };
    const header = node("div", "approved-style-header"), heading = node("div"), title = node("h3"), basis = node("p", "approved-style-basis");
    title.id = "writerApprovedStyleTitle"; heading.append(title, basis);
    const button = node("button", "approved-style-check"); button.id = "writerApprovedStyleCheck"; button.type = "button";
    let icon;
    try { if (typeof window.lucide?.createElement === "function" && window.lucide?.icons?.BookOpen) icon = window.lucide.createElement(window.lucide.icons.BookOpen); } catch (_) {}
    if (!icon) { icon = node("span"); icon.textContent = "\u2261"; }
    icon.setAttribute("aria-hidden", "true"); button.append(icon); header.append(heading, button);
    const status = node("p", "approved-style-state"), content = node("div");
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); content.id = "writerApprovedStyleContent";
    host.replaceChildren(header, status, content);
    function render(state) {
      const c = copy[state.locale]; host.lang = state.locale; title.textContent = c.title; basis.textContent = c.basis;
      button.title = c.load; button.setAttribute("aria-label", c.load); button.setAttribute("aria-busy", String(state.busy)); button.disabled = !state.canLoad;
      status.textContent = c[state.messageKey]; content.replaceChildren(); content.hidden = state.data === null;
      if (!state.data) return;
      const value = state.data.section.value, versions = node("dl", "approved-style-versions");
      for (const [key, value] of [["language", languageNames[state.data.locale]], ["manuscript", state.data.manuscriptVersion], ["analysis", state.data.analysisVersion], ["profile", state.data.profileVersion], ["review", state.data.reviewRevision]]) {
        const group = node("div"), label = node("dt"), text = node("dd"); label.textContent = c[key]; text.textContent = String(value); group.append(label, text); versions.append(group);
      }
      content.append(versions);
      function paragraph(label, text) { const heading = node("h4"), p = node("p", "approved-style-rule"); heading.textContent = c[label]; p.textContent = text; content.append(heading, p); }
      if (!structuredStyle(value)) {
        const p = node("pre", "approved-style-rule"); p.textContent = JSON.stringify(value, null, 2); content.append(p);
      } else {
      if (value.summary !== undefined) paragraph("summary", value.summary);
      if (value.observations !== undefined) {
      const observationsTitle = node("h4"), observations = node("ol", "approved-style-observations"); observationsTitle.textContent = c.observations;
      for (const row of value.observations) { const li = node("li"), h = node("h4"), p = node("p"); h.textContent = row.title; p.textContent = row.detail; li.append(h, p); observations.append(li); }
      if (!value.observations.length) { const li = node("li"); li.textContent = c.empty; observations.append(li); }
      content.append(observationsTitle, observations);
      }
      if (value.categories !== undefined) {
      const categoryTitle = node("h4"), categories = node("ol", "approved-style-categories"); categoryTitle.textContent = c.categories;
      for (const row of value.categories) { const li = node("li"), h = node("h4"), list = node("ul"); h.textContent = row.category; for (const observation of row.observations) { const child = node("li"); child.textContent = observation; list.append(child); } li.append(h, list); categories.append(li); }
      if (!value.categories.length) { const li = node("li"); li.textContent = c.empty; categories.append(li); }
      content.append(categoryTitle, categories);
      }
      if (value.imitationBoundary !== undefined) paragraph("boundary", value.imitationBoundary);
      }
      const evidenceTitle = node("h4"), evidence = node("ul"); evidenceTitle.textContent = c.evidence;
      for (const row of state.data.section.evidence) { const li = node("li"); li.textContent = row.summary; evidence.append(li); }
      if (!state.data.section.evidence.length) { const li = node("li"); li.textContent = c.empty; evidence.append(li); }
      content.append(evidenceTitle, evidence);
    }
    const controller = createController({
      fetch: (url, options) => {
        const auth = window.getAuth?.(), token = auth?.accessToken || auth?.access_token || auth?.token || auth?.tokens?.accessToken || auth?.tokens?.access_token;
        if (typeof token !== "string" || !token) throw fail("unauthenticated");
        const authorized = window.LuminaCreatorStudioApi?.isCurrent?.(options.identity) === true;
        controller.syncContext();
        if (!authorized || options.signal.aborted) throw fail("stale");
        return window.LuminaCreatorStudioApi.fetch(url, { ...options, token });
      },
      identity: () => window.LuminaCreatorStudioApi?.identity?.(),
      isCurrent: owner => typeof window.LuminaCreatorStudioApi?.fetch === "function" && window.LuminaCreatorStudioApi?.isCurrent?.(owner) === true,
      context: () => ({ workId: document.getElementById("writerManuscriptWork")?.value || "", locale: document.getElementById("writerManuscriptLocale")?.value }),
      locale: () => window.luminaI18n?.getLocale?.() || document.documentElement.lang || "ko",
      visible: () => !shell.hidden && !section.hidden && !host.hidden && host.isConnected !== false && section.classList.contains("is-active") && document.visibilityState !== "hidden",
      onChange: render
    });
    button.addEventListener("click", () => controller.load(controller.snapshot().ticket));
    const invalidate = () => controller.invalidate(), sync = () => controller.syncContext();
    for (const name of ["storage", "lumina:authchange", "lumina:auth-expired", "pagehide", "creator:manuscript-accepted", "lumina:author-body-trial-progress-changed"]) window.addEventListener(name, invalidate);
    for (const name of ["focus", "pageshow", "lumina:localechange"]) window.addEventListener(name, sync);
    for (const name of ["visibilitychange", "lumina:auth-expired"]) document.addEventListener(name, invalidate);
    const selects = ["writerManuscriptWork", "writerManuscriptLocale"].map(id => document.getElementById(id)).filter(Boolean);
    for (const select of selects) for (const name of ["input", "change"]) select.addEventListener(name, invalidate);
    document.addEventListener("click", event => { const tab = event.target?.closest?.("[data-section]"); if (tab && tab.getAttribute("data-section") !== "writer-manuscript") invalidate(); }, true);
    if (typeof MutationObserver === "function") {
      for (const [el, attributes] of [[shell, ["hidden"]], [section, ["class", "hidden", "style"]], [host, ["hidden"]], [document.documentElement, ["lang"]]]) new MutationObserver(invalidate).observe(el, { attributes: true, attributeFilter: attributes });
      for (const select of selects) new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "selected", "disabled"] });
    }
    render(controller.snapshot()); return controller;
  }
  window.LuminaCreatorApprovedStyle = { createController, parseStyle, mount, copy, maxBytes };
  if (typeof document !== "undefined") mount(document.getElementById("writerApprovedStyle"));
})();
