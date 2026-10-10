(function () {
  "use strict";
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const maxBytes = 256 * 1024;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const integer = (value, min) => Number.isSafeInteger(value) && value >= min;
  const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length &&
    keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
  const clone = value => JSON.parse(JSON.stringify(value));
  const ownErrors = new WeakSet();
  function failure(kind) { const error = new Error(kind); error.kind = kind; ownErrors.add(error); return error; }
  function text(value, limit) {
    return typeof value === "string" && value.trim().length > 0 && value.length <= limit &&
      !value.includes("\0") && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
  }
  const copy = {
    ko: {
      title: "원작 파트와 저장 본문", load: "원문 조회", ready: "원문 조회 대기", loading: "원문 조회 중",
      hidden: "", unauthenticated: "로그인이 필요합니다.", noWork: "선택된 작품이 없습니다.",
      unavailable: "현재 원문을 조회할 수 없습니다.", forbidden: "이 원문을 조회할 수 없습니다.",
      conflict: "현재 원문 기준을 확인할 수 없습니다.", server: "원문을 불러오지 못했습니다.",
      transport: "연결하지 못했습니다.", invalid: "원문 응답을 확인할 수 없습니다.",
      no_saved_body: "저장된 본문 없음", reference_ready: "현재 원문 조회됨",
      original: "현재 발행 원작 파트", saved: "현재 저장 본문", generated: "저장된 생성 본문",
      canonical: "저장된 원작 본문", revision: "조회 경로 버전", unverified: "의미·문체 품질 미확인", unknown: "미확인"
    },
    en: {
      title: "Original Part and Saved Body", load: "Read texts", ready: "Texts not loaded", loading: "Reading texts",
      hidden: "", unauthenticated: "Sign-in required.", noWork: "No work selected.",
      unavailable: "Current texts are unavailable.", forbidden: "These texts are not accessible.",
      conflict: "The current text reference could not be verified.", server: "Could not load texts.",
      transport: "Could not connect.", invalid: "The text response could not be verified.",
      no_saved_body: "No saved body", reference_ready: "Current texts loaded",
      original: "Current published original part", saved: "Current saved body", generated: "Saved generated body",
      canonical: "Saved original body", revision: "Read path revision", unverified: "Meaning and style quality unverified", unknown: "Unverified"
    },
    ja: {
      title: "原作パートと保存本文", load: "本文を読む", ready: "本文未読込", loading: "本文を読込中",
      hidden: "", unauthenticated: "ログインが必要です。", noWork: "作品が選択されていません。",
      unavailable: "現在の本文を読み込めません。", forbidden: "この本文を閲覧できません。",
      conflict: "現在の本文の参照基準を確認できません。", server: "本文を読み込めませんでした。",
      transport: "接続できませんでした。", invalid: "本文の応答を確認できません。",
      no_saved_body: "保存本文なし", reference_ready: "現在の本文を読込済み",
      original: "現在公開中の原作パート", saved: "現在の保存本文", generated: "保存された生成本文",
      canonical: "保存された原作本文", revision: "閲覧経路の版", unverified: "意味・文体の品質未確認", unknown: "未確認"
    },
    "zh-Hans": {
      title: "原作部分与已保存正文", load: "读取原文", ready: "原文待读取", loading: "正在读取原文",
      hidden: "", unauthenticated: "需要登录。", noWork: "未选择作品。",
      unavailable: "无法读取当前原文。", forbidden: "无法查看此原文。",
      conflict: "无法确认当前原文的参考依据。", server: "无法加载原文。",
      transport: "无法连接。", invalid: "无法验证原文响应。",
      no_saved_body: "没有已保存正文", reference_ready: "已读取当前原文",
      original: "当前已发布的原作部分", saved: "当前已保存正文", generated: "已保存的生成正文",
      canonical: "已保存的原作正文", revision: "读取路径版本", unverified: "含义与文风质量未验证", unknown: "未验证"
    },
    "zh-Hant": {
      title: "原作部分與已儲存正文", load: "讀取原文", ready: "原文待讀取", loading: "正在讀取原文",
      hidden: "", unauthenticated: "需要登入。", noWork: "未選擇作品。",
      unavailable: "無法讀取目前原文。", forbidden: "無法查看此原文。",
      conflict: "無法確認目前原文的參考依據。", server: "無法載入原文。",
      transport: "無法連線。", invalid: "無法驗證原文回應。",
      no_saved_body: "沒有已儲存正文", reference_ready: "已讀取目前原文",
      original: "目前已發布的原作部分", saved: "目前已儲存正文", generated: "已儲存的生成正文",
      canonical: "已儲存的原作正文", revision: "讀取路徑版本", unverified: "含義與文風品質未驗證", unknown: "未驗證"
    }
  };

  function beats(value, limit) {
    if (!Array.isArray(value) || value.length < 1 || value.length > limit) throw failure("invalid");
    let previous = 0;
    for (const beat of value) {
      if (!exact(beat, ["position", "type", "content"]) || !integer(beat.position, 1) ||
          beat.position <= previous || !text(beat.type, 64) || !text(beat.content, 64000)) throw failure("invalid");
      previous = beat.position;
    }
  }
  function parseReference(value, target) {
    const keys = ["contract", "workId", "locale", "readOnly", "referenceScope", "progressRevision",
      "semanticQualityVerified", "bodySourceAligned", "dispatchAuthorized", "providerCalls", "operatingWrites",
      "outcome", "original", "savedBody"];
    if (!record(target) || typeof target.workId !== "string" || !uuid.test(target.workId) || !locales.includes(target.locale) ||
        !exact(value, keys) || value.contract !== "story-author-body-original-reference-v1" ||
        typeof value.workId !== "string" || !uuid.test(value.workId) || value.workId.toLowerCase() !== target.workId.toLowerCase() ||
        value.locale !== target.locale || value.readOnly !== true || value.referenceScope !== "current_published_original_part" ||
        value.semanticQualityVerified !== false || value.bodySourceAligned !== false || value.dispatchAuthorized !== false ||
        value.providerCalls !== 0 || value.operatingWrites !== 0 ||
        !(value.progressRevision === null || integer(value.progressRevision, 0))) throw failure("invalid");
    if (value.outcome === "no_saved_body") {
      if (value.original !== null || value.savedBody !== null) throw failure("invalid");
    } else if (value.outcome === "reference_ready") {
      if (!integer(value.progressRevision, 0) || !exact(value.original, ["scenes"]) || !Array.isArray(value.original.scenes) ||
          value.original.scenes.length < 1 || value.original.scenes.length > 100 ||
          !exact(value.savedBody, ["isGenerated", "title", "beats"]) ||
          typeof value.savedBody.isGenerated !== "boolean" || !text(value.savedBody.title, 1000)) throw failure("invalid");
      let previous = 0, total = 0;
      for (const scene of value.original.scenes) {
        if (!exact(scene, ["position", "title", "beats"]) || !integer(scene.position, 1) ||
            scene.position <= previous || !text(scene.title, 1000)) throw failure("invalid");
        previous = scene.position;
        beats(scene.beats, 1000);
        total += scene.beats.length;
        if (total > 1000) throw failure("invalid");
      }
      beats(value.savedBody.beats, 40);
    } else throw failure("invalid");
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maxBytes) throw failure("invalid");
    return clone(value);
  }

  async function cancel(response) { try { await response?.body?.cancel?.(); } catch (_) {} }
  async function readBody(response, current, signal) {
    const length = response.headers?.get?.("content-length");
    if (length !== null && length !== undefined && (!/^\d+$/.test(length) ||
        !integer(Number(length), 0) || Number(length) > maxBytes)) { await cancel(response); throw failure("invalid"); }
    if (typeof response.body?.getReader !== "function") { await cancel(response); throw failure("invalid"); }
    const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0, result = "", cancelled = false;
    async function stop() { if (!cancelled) { cancelled = true; try { await reader.cancel(); } catch (_) {} } }
    const onAbort = () => { void stop(); };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (signal.aborted) throw failure("stale");
      while (true) {
        const chunk = await reader.read();
        if (!current()) throw failure("stale");
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) throw failure("invalid");
        size += chunk.value.byteLength;
        if (size > maxBytes) throw failure("invalid");
        try { result += decoder.decode(chunk.value, { stream: true }); } catch (_) { throw failure("invalid"); }
      }
      try { result += decoder.decode(); } catch (_) { throw failure("invalid"); }
      if (!current()) throw failure("stale");
      try { return JSON.parse(result); } catch (_) { throw failure("invalid"); }
    } catch (error) { await stop(); throw error; }
    finally { signal.removeEventListener("abort", onAbort); reader.releaseLock(); }
  }

  function createController({ fetch, identity, isCurrent, context, locale = () => "ko", visible = () => true, onChange = () => {} }) {
    let scope = null, ticket = 0, data = null, phase = "idle", messageKey = "ready", request = null;
    function sample() {
      try {
        const target = context(), language = locale(), shown = visible() === true, owner = identity();
        const authenticated = record(owner) && typeof owner.ownerId === "string" && uuid.test(owner.ownerId) &&
          integer(owner.epoch, 0) && isCurrent(owner) === true;
        return { workId: typeof target?.workId === "string" ? target.workId : "",
          sourceLocale: locales.includes(target?.locale) ? target.locale : null, locale: locales.includes(language) ? language : "ko",
          shown, available: typeof fetch === "function", owner: authenticated ? { ownerId: owner.ownerId, epoch: owner.epoch } : null };
      } catch (_) { return { workId: "", sourceLocale: null, locale: "ko", shown: false, available: false, owner: null }; }
    }
    function initial(s) { return !s.shown ? "hidden" : !s.available ? "unavailable" : !s.owner ? "unauthenticated" :
      !s.workId ? "noWork" : !uuid.test(s.workId) || !locales.includes(s.sourceLocale) ? "invalid" : "ready"; }
    function state() { return { ticket, phase, messageKey, locale: scope?.locale || "ko", data: data === null ? null : clone(data),
      busy: phase === "loading", canLoad: !!scope && initial(scope) === "ready" && phase !== "loading" }; }
    function emit() { onChange(state()); }
    function reset(next) {
      const old = request; ++ticket; request = null; data = null; phase = "idle"; scope = next;
      messageKey = next ? initial(next) : "ready"; old?.abort();
    }
    function syncContext(notify = true) {
      const before = ticket, next = sample();
      if (before !== ticket) return state();
      if (JSON.stringify(scope) !== JSON.stringify(next)) { reset(next); if (notify) emit(); }
      return state();
    }
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
        const response = await fetch("/api/v1/me/creator-studio/stories/" + encodeURIComponent(target.workId) +
          "/body-preview/original-reference?locale=" + encodeURIComponent(target.locale), {
          method: "GET", identity: owner, _retried: true, cache: "no-store", redirect: "error", headers: { "Cache-Control": "no-store" }, signal: abort.signal
        });
        if (!current()) { await cancel(response); return false; }
        if (!integer(response?.status, 100) || response.status > 599) { await cancel(response); throw failure("invalid"); }
        if (response.status !== 200) {
          await cancel(response);
          throw failure(response.status === 401 ? "unauthenticated" : response.status === 403 ? "forbidden" :
            response.status === 409 ? "conflict" : response.status >= 500 ? "server" : "unavailable");
        }
        const raw = await readBody(response, current, abort.signal);
        if (!current()) return false;
        const parsed = parseReference(raw, target);
        if (!current()) return false;
        data = parsed; request = null; phase = "ready"; messageKey = parsed.outcome; emit(); return current();
      } catch (error) {
        if (!current()) return false;
        data = null; request = null; phase = "error";
        messageKey = ownErrors.has(error) && ["invalid", "unauthenticated", "forbidden", "conflict", "server", "unavailable"].includes(error.kind)
          ? error.kind : "transport";
        emit(); return false;
      }
    }
    return { snapshot: () => syncContext(), syncContext, invalidate, load };
  }

  function mount(host) {
    if (!host || host.dataset.bodyOriginalReferenceMounted) return null;
    const shell = document.getElementById("studioShell"), section = document.getElementById("writer-manuscript");
    if (!shell || !section) return null;
    host.dataset.bodyOriginalReferenceMounted = "true";
    function element(tag, name, value) {
      const node = document.createElement(tag); if (name) node.className = name;
      if (value !== undefined) node.textContent = value; return node;
    }
    const header = element("div", "body-original-header"), title = element("h3"), button = element("button", "body-original-read");
    title.id = "writerBodyOriginalReferenceTitle"; button.id = "writerBodyOriginalReferenceRead"; button.type = "button";
    let icon;
    try {
      if (typeof window.lucide?.createElement === "function" && window.lucide?.icons?.ArrowLeftRight) {
        icon = window.lucide.createElement(window.lucide.icons.ArrowLeftRight);
      }
    } catch (_) { /* Missing optional icons must not break privacy invalidation. */ }
    if (!icon) icon = element("span", "", "\u2194");
    icon.setAttribute("aria-hidden", "true"); button.append(icon); header.append(title, button);
    const status = element("p", "body-original-state"), metadata = element("p", "body-original-meta");
    status.id = "writerBodyOriginalReferenceState"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const content = element("div", "body-original-columns"); content.id = "writerBodyOriginalReferenceContent";
    host.setAttribute("aria-labelledby", title.id); host.replaceChildren(header, status, metadata, content);
    function render(state) {
      const c = copy[state.locale]; host.lang = state.locale; title.textContent = c.title;
      host.setAttribute("aria-busy", String(state.busy)); button.disabled = !state.canLoad;
      button.title = c.load; button.setAttribute("aria-label", c.load);
      status.textContent = c[state.messageKey]; status.className = "body-original-state" + (state.phase === "error" ? " is-error" : "");
      metadata.textContent = ""; metadata.hidden = !state.data || state.data.outcome !== "reference_ready";
      content.replaceChildren(); content.hidden = metadata.hidden;
      if (content.hidden) return;
      metadata.textContent = c.revision + ": " + (state.data.progressRevision === null ? c.unknown : String(state.data.progressRevision)) +
        " · " + c.unverified;
      function pane(label, id) {
        const group = element("div", "body-original-pane"), heading = element("h4", "", label);
        heading.id = id; const prose = element("div", "body-original-prose"); prose.lang = state.data.locale;
        prose.tabIndex = 0; prose.setAttribute("role", "region"); prose.setAttribute("aria-labelledby", id);
        group.append(heading, prose); content.append(group); return prose;
      }
      const original = pane(c.original, "writerBodyOriginalReferenceOriginalTitle");
      for (const scene of state.data.original.scenes) {
        const group = element("div", "body-original-scene");
        group.append(element("h5", "", String(scene.position) + ". " + scene.title));
        for (const beat of scene.beats) group.append(element("p", "body-original-beat", beat.content));
        original.append(group);
      }
      const saved = pane(c.saved, "writerBodyOriginalReferenceSavedTitle");
      saved.append(element("p", "body-original-kind", state.data.savedBody.isGenerated ? c.generated : c.canonical));
      saved.append(element("h5", "", state.data.savedBody.title));
      for (const beat of state.data.savedBody.beats) saved.append(element("p", "body-original-beat", beat.content));
    }
    const controller = createController({
      fetch: (url, options) => {
        const auth = window.getAuth?.(), token = auth?.accessToken || auth?.access_token || auth?.token ||
          auth?.tokens?.accessToken || auth?.tokens?.access_token;
        if (typeof token !== "string" || !token) throw failure("unauthenticated");
        const authorized = window.LuminaCreatorStudioApi?.isCurrent?.(options.identity) === true;
        controller.syncContext();
        if (!authorized || options.signal.aborted) throw failure("stale");
        return window.LuminaCreatorStudioApi.fetch(url, { ...options, token });
      },
      identity: () => window.LuminaCreatorStudioApi?.identity?.(),
      isCurrent: owner => typeof window.LuminaCreatorStudioApi?.fetch === "function" && window.LuminaCreatorStudioApi?.isCurrent?.(owner) === true,
      context: () => ({ workId: document.getElementById("writerManuscriptWork")?.value || "",
        locale: document.getElementById("writerManuscriptLocale")?.value }),
      locale: () => window.luminaI18n?.getLocale?.() || document.documentElement.lang || "ko",
      visible: () => !shell.hidden && !section.hidden && !host.hidden && host.isConnected !== false &&
        section.classList.contains("is-active") && document.visibilityState !== "hidden",
      onChange: render
    });
    button.addEventListener("click", () => controller.load(controller.snapshot().ticket));
    const invalidate = () => controller.invalidate(), sync = () => controller.syncContext();
    for (const name of ["storage", "lumina:authchange", "lumina:auth-expired", "pagehide", "popstate", "hashchange",
      "creator:manuscript-accepted", "creator:generation-profile-changed", "lumina:author-body-trial-progress-changed"]) window.addEventListener(name, invalidate);
    for (const name of ["focus", "pageshow", "lumina:localechange"]) window.addEventListener(name, sync);
    for (const name of ["visibilitychange", "lumina:auth-expired"]) document.addEventListener(name, invalidate);
    const selects = ["writerManuscriptWork", "writerManuscriptLocale"].map(id => document.getElementById(id)).filter(Boolean);
    for (const select of selects) for (const name of ["input", "change"]) select.addEventListener(name, invalidate);
    document.addEventListener("click", event => {
      const tab = event.target?.closest?.("[data-section]"); if (tab && tab.getAttribute("data-section") !== "writer-manuscript") invalidate();
    }, true);
    if (typeof MutationObserver === "function") {
      for (const [node, attributes] of [[shell, ["hidden"]], [section, ["class", "hidden", "style"]],
        [host, ["hidden"]], [document.documentElement, ["lang"]]]) {
        new MutationObserver(invalidate).observe(node, { attributes: true, attributeFilter: attributes });
      }
      for (const select of selects) new MutationObserver(sync).observe(select, {
        childList: true, subtree: true, attributes: true, attributeFilter: ["value", "selected", "disabled"]
      });
    }
    render(controller.snapshot()); return controller;
  }
  window.LuminaCreatorBodyOriginalReference = { createController, parseReference, mount, copy, maxBytes };
  if (typeof document !== "undefined") mount(document.getElementById("writerBodyOriginalReference"));
})();
