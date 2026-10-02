(function () {
  "use strict";

  const catalogEndpoint = "/admin/api/v1/backstage/story-publication/submissions";
  const uuid = (value) => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
  const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const nullableHash = (value) => value === null || hash(value);
  const sameId = (left, right) => uuid(left) && uuid(right) && left.toLowerCase() === right.toLowerCase();
  const sceneKey = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(value);
  const statuses = { pending: "대기", generating: "생성 중", ready: "생성 완료", failed: "실패", blocked: "차단" };
  const reasons = {
    unbound: "예약 기준이 연결되지 않았습니다.",
    changed: "현재 승인 기준과 예약 기준이 다릅니다.",
    current: "현재 예약 기준과 일치합니다. 재준비가 필요하지 않습니다.",
    in_progress: "작업이 진행 중입니다. 다시 시작하지 않습니다.",
    attempted: "이미 요청되었거나 청구 가능성이 있는 작업입니다. 다시 시작하지 않습니다.",
    asset_present: "기존 생성 자산이 있습니다. 이 패널에서 교체하지 않습니다.",
    blocked: "현재 승인 범위에서는 재준비할 수 없습니다.",
    source_changed: "원고나 장면 기준이 변경되었습니다. 먼저 원본을 확인해 주세요."
  };
  const warning = "이미 요청/청구된 작업은 다시 시작하지 않습니다. 재준비 후 기존 승인 범위의 자동 작업자가 생성할 수 있습니다.";
  const policy = "재준비는 권한 부여, 공개, 시도 횟수 초기화가 아닙니다. 이 패널은 유료 생성 호출을 하지 않습니다.";
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function catalogTitle(title, slug) {
    if (typeof title === "string" && title.trim()) return title.trim();
    if (title && typeof title === "object" && !Array.isArray(title)) {
      const preferred = ["ko", "en", "ja"].filter((key) => Object.hasOwn(title, key)).map((key) => title[key]);
      const text = [...preferred, ...Object.values(title)].find((value) => typeof value === "string" && value.trim());
      if (text) return text.trim();
    }
    return slug;
  }

  function parseCatalog(value) {
    if (!value || !Array.isArray(value.publishedWorks)) throw new Error("catalog");
    const seen = new Set();
    return value.publishedWorks.map((work) => {
      if (!work || !uuid(work.id) || typeof work.slug !== "string" || !work.slug.trim() ||
          typeof work.status !== "string" || (work.activeReleaseId != null && !uuid(work.activeReleaseId))) throw new Error("catalog");
      const id = work.id.toLowerCase();
      if (seen.has(id)) throw new Error("duplicate catalog");
      seen.add(id);
      return { id, activeReleaseId: work.activeReleaseId?.toLowerCase() || null, slug: work.slug,
        status: work.status, title: catalogTitle(work.title, work.slug) };
    }).filter((work) => work.status === "published" && work.activeReleaseId);
  }

  function catalogSignature(works) {
    return JSON.stringify([...works].sort((left, right) => left.id.localeCompare(right.id)));
  }

  function parseReview(value, target) {
    if (!value || !sameId(value.workId, target.id) || !sameId(value.releaseId, target.activeReleaseId) ||
        !hash(value.releaseChecksum) || typeof value.eligible !== "boolean" || !Array.isArray(value.items) ||
        value.items.length > 8 || !(value.nextAfterId === null || uuid(value.nextAfterId)) ||
        (!value.eligible && (value.items.length || value.nextAfterId !== null)) ||
        (!value.items.length && value.nextAfterId !== null)) throw new Error("review binding");
    const seen = new Set();
    const items = value.items.map((item) => {
      if (!item || !uuid(item.generationId) || !sceneKey(item.sourceSceneKey) ||
          !Object.hasOwn(statuses, item.status) || !Object.hasOwn(reasons, item.reason) ||
          !Number.isSafeInteger(item.attemptCount) || item.attemptCount < 0 || typeof item.canReprepare !== "boolean" ||
          !nullableHash(item.reviewSha256) || !nullableHash(item.currentBookingIdentitySha256) ||
          !nullableHash(item.bookedIdentitySha256) || !hash(item.promptSha256)) throw new Error("review shape");
      if (item.canReprepare && (!value.eligible || !actionable(item))) throw new Error("inconsistent reprepare gate");
      const generationId = item.generationId.toLowerCase();
      if (seen.has(generationId)) throw new Error("duplicate generation");
      seen.add(generationId);
      return { generationId, sourceSceneKey: item.sourceSceneKey, status: item.status,
        attemptCount: item.attemptCount, reason: item.reason, canReprepare: item.canReprepare,
        reviewSha256: item.reviewSha256, currentBookingIdentitySha256: item.currentBookingIdentitySha256,
        bookedIdentitySha256: item.bookedIdentitySha256, promptSha256: item.promptSha256 };
    });
    return { workId: value.workId, releaseId: value.releaseId, releaseChecksum: value.releaseChecksum,
      eligible: value.eligible, items, nextAfterId: value.nextAfterId?.toLowerCase() || null };
  }

  function actionable(item) {
    return Boolean(item?.canReprepare && ["unbound", "changed"].includes(item.reason) && item.attemptCount === 0 &&
      ["pending", "failed"].includes(item.status) && hash(item.reviewSha256) && hash(item.currentBookingIdentitySha256));
  }

  function validMutation(value, target, body) {
    return value && sameId(value.workId, target.id) && sameId(value.releaseId, body.releaseId) &&
      value.releaseChecksum === body.releaseChecksum && sameId(value.generationId, body.generationId) &&
      value.sourceSceneKey === body.sourceSceneKey && value.status === "pending" && value.generationStarted === false &&
      hash(value.bookingIdentitySha256) && value.bookingIdentitySha256 === body.expectedCurrentBookingIdentitySha256;
  }

  function createController({ fetch, session, onChange = () => {} }) {
    let auth = session();
    let revision = 0;
    let catalog = [], catalogVerified = false, target = null, review = null, phase = "idle";
    let selected = null, checked = false, confirmation = null, pages = [], pageIndex = -1, checksum = null;
    let message = "작품 목록을 확인한 뒤 대상 작품과 공개본을 선택해 주세요.";
    const emit = () => onChange(snapshot());
    function snapshot() {
      return clone({ revision, catalog, catalogVerified, target, review, phase, selected, checked, confirmation,
        pageIndex, pageCount: pages.length, message, busy: ["catalog", "reading", "mutating"].includes(phase) });
    }
    function clearReview() {
      review = null; selected = null; checked = false; confirmation = null;
    }
    function clearPages() { pages = []; pageIndex = -1; checksum = null; }
    function syncSession() {
      const current = session();
      if (current === auth) return Boolean(current);
      auth = current; revision += 1; catalogVerified = false; catalog = []; target = null;
      clearReview(); clearPages(); phase = "idle";
      message = "접속 상태가 변경되었습니다. 작품 목록부터 다시 확인해 주세요.";
      emit();
      return false;
    }
    function current(ticket) { return syncSession() && ticket === revision; }
    function invalidate(text = "대상이나 목록이 변경되었습니다. 작품 목록부터 다시 확인해 주세요.") {
      revision += 1; catalogVerified = false; catalog = []; target = null;
      clearReview(); clearPages(); phase = "idle"; message = text; emit();
    }
    function fail(text) { revision += 1; clearReview(); clearPages(); phase = "error"; message = text; emit(); }
    function targetReady() {
      return catalogVerified && target && catalog.filter((work) => sameId(work.id, target.id) &&
        sameId(work.activeReleaseId, target.activeReleaseId)).length === 1;
    }
    function selectedItem() {
      return phase === "ready" && review?.eligible && targetReady()
        ? review.items.find((item) => sameId(item.generationId, selected)) : null;
    }
    async function loadCatalog() {
      if (!syncSession()) { emit(); return; }
      const previous = target;
      const ticket = ++revision;
      catalogVerified = false; clearReview(); clearPages(); phase = "catalog";
      message = "서버 작품 목록을 확인하고 있습니다."; emit();
      try {
        const value = parseCatalog(await fetch(catalogEndpoint, { auth: true }));
        if (!current(ticket)) return;
        catalog = value; catalogVerified = true;
        target = previous ? catalog.find((work) => sameId(work.id, previous.id) &&
          sameId(work.activeReleaseId, previous.activeReleaseId)) || null : null;
        phase = "idle";
        message = catalog.length ? "대상 작품과 공개본을 선택한 뒤 예약 검토를 불러와 주세요." : "서버 목록에 선택 가능한 공개 작품이 없습니다.";
        emit();
      } catch {
        if (!current(ticket)) return;
        catalog = []; target = null; catalogVerified = false;
        fail("작품 목록을 확인하지 못했습니다. 재준비할 수 없습니다. 목록을 다시 확인해 주세요.");
      }
    }
    function selectWork(id, expectedRevision) {
      if (!syncSession() || expectedRevision !== revision || !catalogVerified) return;
      revision += 1; target = catalog.find((work) => sameId(work.id, id)) || null;
      clearReview(); clearPages(); phase = "idle";
      message = "선택한 공개본의 예약 검토를 불러와 주세요."; emit();
    }
    async function loadReview(direction = "first", expectedRevision = revision) {
      if (!syncSession() || expectedRevision !== revision || !targetReady() || ["catalog", "reading", "mutating"].includes(phase)) return;
      let index = 0, afterId = null;
      if (direction === "next") {
        if (!review?.nextAfterId || pageIndex < 0) return;
        index = pageIndex + 1; afterId = review.nextAfterId;
      } else if (direction === "previous") {
        if (pageIndex <= 0) return;
        index = pageIndex - 1; afterId = pages[index].afterId;
      } else if (direction !== "first") return;
      if (direction === "first") clearPages();
      const scope = target, ticket = ++revision;
      clearReview(); phase = "reading"; message = "예약 검토를 확인하고 있습니다."; emit();
      try {
        const query = afterId ? `?afterId=${encodeURIComponent(afterId)}` : "";
        const value = parseReview(await fetch(`/admin/api/v1/story-visuals/${encodeURIComponent(scope.id)}/booking-review${query}`, { auth: true }), scope);
        if (!current(ticket)) return;
        if ((checksum && checksum !== value.releaseChecksum) || (value.nextAfterId &&
            (value.nextAfterId === afterId || pages.slice(0, index + 1).some((page) => page.afterId === value.nextAfterId))) ||
            (pages[index + 1] && value.nextAfterId !== pages[index + 1].afterId) ||
            value.items.some((item) => pages.some((page, position) => position !== index && page.ids.includes(item.generationId)))) throw new Error("pagination changed");
        checksum = value.releaseChecksum;
        pages[index] = { afterId, ids: value.items.map((item) => item.generationId) };
        pageIndex = index; review = value; phase = "ready";
        message = !value.eligible ? "이 작품의 작업 큐는 예약 재준비 지원 범위가 아닙니다." :
          value.items.length ? "예약 검토를 확인했습니다." : "이 페이지에 검토할 예약 작업이 없습니다.";
        emit();
      } catch {
        if (current(ticket)) fail("예약 검토를 확인하지 못했거나 대상·페이지 기준이 변경되었습니다. 다시 불러오기 전에는 재준비할 수 없습니다.");
      }
    }
    function selectItem(id, expectedRevision) {
      if (!syncSession() || expectedRevision !== revision || !review || phase !== "ready") return;
      revision += 1;
      selected = review.items.find((item) => sameId(item.generationId, id))?.generationId || null;
      checked = false; confirmation = null; emit();
    }
    function acknowledge(value, expectedRevision) {
      if (!syncSession() || expectedRevision !== revision || !actionable(selectedItem())) return;
      revision += 1;
      checked = value === true; confirmation = null; emit();
    }
    function requestConfirmation(expectedRevision) {
      if (!syncSession() || expectedRevision !== revision || !checked || !actionable(selectedItem())) return;
      confirmation = { generationId: selected, revision }; emit();
    }
    function cancelConfirmation() { revision += 1; checked = false; confirmation = null; emit(); }
    async function reprepare(expectedRevision) {
      if (!syncSession() || expectedRevision !== revision || confirmation?.revision !== revision ||
          !sameId(confirmation.generationId, selected) || !checked || !actionable(selectedItem())) return;
      const item = selectedItem(), scope = target;
      const signature = catalogSignature(catalog);
      const body = { generationId: item.generationId, releaseId: review.releaseId, releaseChecksum: review.releaseChecksum,
        sourceSceneKey: item.sourceSceneKey, promptSha256: item.promptSha256, expectedReviewSha256: item.reviewSha256,
        expectedCurrentBookingIdentitySha256: item.currentBookingIdentitySha256, confirmedResume: true };
      const ticket = ++revision;
      clearReview(); clearPages(); phase = "mutating";
      message = "대상 일치를 확인하고 예약을 재준비하고 있습니다."; emit();
      try {
        // Recheck the real catalog before using a confirmed review; the server checks the review hashes atomically.
        const latest = parseCatalog(await fetch(catalogEndpoint, { auth: true }));
        if (!current(ticket)) return;
        if (catalogSignature(latest) !== signature) {
          invalidate("작품 목록이나 공개본이 변경되었습니다. 새 대상을 확인한 뒤 다시 검토해 주세요."); return;
        }
        const result = await fetch(`/admin/api/v1/story-visuals/${encodeURIComponent(scope.id)}/reprepare-booking`,
          { method: "POST", auth: true, _retried: true, body });
        if (!current(ticket)) return;
        if (!validMutation(result, scope, body)) throw new Error("mutation binding");
        phase = "done";
        message = "예약을 재준비했습니다. 여기서 생성은 시작하지 않았습니다. 기존 승인 범위의 자동 작업자가 생성할 수 있습니다. 상태는 다시 불러와 확인해 주세요.";
        emit();
      } catch {
        if (current(ticket)) fail("재준비 결과를 확인하지 못했습니다. 자동으로 다시 요청하지 않습니다. 예약 검토를 다시 불러와 상태를 확인해 주세요.");
      }
    }
    return { snapshot, syncSession, invalidate, loadCatalog, selectWork, loadReview, selectItem,
      acknowledge, requestConfirmation, cancelConfirmation, reprepare };
  }

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  function mount(host) {
    if (!host || host.dataset.bookingMounted) return null;
    const api = window.LuminaBackstageApi;
    if (!api?.fetch) {
      host.textContent = "운영자 접속과 서버 연결을 확인한 뒤 예약 검토를 사용할 수 있습니다.";
      return null;
    }
    host.dataset.bookingMounted = "true";
    host.classList.add("story-visual-booking");
    const dashboard = document.getElementById("backstageDashboardView");
    const main = document.querySelector(".dashboard-main");
    const visible = () => dashboard && !dashboard.classList.contains("is-hidden") && main?.dataset.activeSection === "story-publication";
    const session = () => {
      if (!visible() || typeof getBackstageAuth !== "function") return null;
      const auth = getBackstageAuth();
      return auth?.accessToken || auth?.refreshToken ? JSON.stringify(auth) : null;
    };
    let controller;
    function render(state) {
      const active = state.review?.items.find((item) => item.generationId === state.selected);
      const canAct = !state.busy && actionable(active);
      const revision = `data-booking-revision="${state.revision}"`;
      const focus = document.activeElement;
      const focusKey = host.contains(focus) ? focus?.dataset.bookingFocus : null;
      host.innerHTML = `<header class="booking-header"><h3 id="storyVisualBookingTitle">이미지 예약 재준비</h3>
        <button type="button" class="secondary-action" data-booking-action="catalog" data-booking-focus="catalog" ${state.busy ? "disabled" : ""}>작품 목록 새로고침</button></header>
        <p class="booking-policy">${policy}</p>
        <div class="booking-target-controls"><label for="storyVisualBookingWork">작품 / 공개본
          <select id="storyVisualBookingWork" data-booking-work data-booking-focus="work" ${revision} ${!state.catalogVerified || state.busy ? "disabled" : ""}>
            <option value="">대상 작품 선택</option>${state.catalog.map((work) => `<option value="${escapeHtml(work.id)}" ${work.id === state.target?.id ? "selected" : ""}>${escapeHtml(work.title)} / ${escapeHtml(work.activeReleaseId)}</option>`).join("")}
          </select></label><button type="button" class="secondary-action" data-booking-action="load" data-booking-focus="load" ${revision} ${!state.target || !state.catalogVerified || state.busy ? "disabled" : ""}>예약 검토 불러오기</button></div>
        ${state.target ? `<dl class="booking-binding"><div><dt>작품 ID</dt><dd>${escapeHtml(state.target.id)}</dd></div>
          <div><dt>공개본 ID</dt><dd>${escapeHtml(state.target.activeReleaseId)}</dd></div>
          ${state.review ? `<div><dt>공개본 체크섬</dt><dd>${escapeHtml(state.review.releaseChecksum)}</dd></div>` : ""}</dl>` : ""}
        <p class="booking-state ${state.phase === "error" ? "is-error" : ""}" role="status" aria-live="polite">${escapeHtml(state.message)}</p>
        ${state.review?.items.length ? `<ul class="booking-items">${state.review.items.map((item) => `<li class="booking-item">
          <label class="booking-item-selector"><input type="radio" name="story-visual-booking-item" data-booking-item="${item.generationId}" data-booking-focus="${item.generationId}" ${revision} ${state.selected === item.generationId ? "checked" : ""} />
            <span><strong>${escapeHtml(item.sourceSceneKey)}</strong><small>${statuses[item.status]} · 시도 ${item.attemptCount}회</small></span></label>
          <p>${reasons[item.reason]}</p><details><summary>예약 식별 기준</summary><dl class="booking-binding">
            ${[["작업 ID", item.generationId], ["검토 SHA", item.reviewSha256], ["현재 예약 SHA", item.currentBookingIdentitySha256],
              ["저장된 예약 SHA", item.bookedIdentitySha256], ["프롬프트 SHA", item.promptSha256]].map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value || "없음")}</dd></div>`).join("")}
          </dl></details></li>`).join("")}</ul>` : ""}
        ${state.review ? `<nav class="booking-pagination" aria-label="예약 검토 페이지"><button type="button" class="secondary-action" data-booking-action="previous" data-booking-focus="previous" ${revision} ${state.pageIndex <= 0 ? "disabled" : ""}>이전</button>
          <span>${state.pageIndex + 1}페이지</span><button type="button" class="secondary-action" data-booking-action="next" data-booking-focus="next" ${revision} ${!state.review.nextAfterId ? "disabled" : ""}>다음</button></nav>` : ""}
        ${active ? `<div class="booking-approval"><strong>선택 장면: ${escapeHtml(active.sourceSceneKey)}</strong>
          <label><input type="checkbox" data-booking-ack data-booking-focus="ack" ${revision} ${state.checked ? "checked" : ""} ${!canAct ? "disabled" : ""} /><span>${warning}</span></label>
          <button type="button" class="primary-action" data-booking-action="prepare" data-booking-focus="prepare" ${revision} ${!canAct || !state.checked ? "disabled" : ""}>선택 작업 재준비 검토</button></div>` : ""}
        ${state.confirmation && active ? `<dialog class="booking-dialog" aria-labelledby="bookingConfirmTitle"><h4 id="bookingConfirmTitle">예약 재준비 확인</h4>
          <dl class="booking-binding"><div><dt>작품</dt><dd>${escapeHtml(state.target.title)}</dd></div><div><dt>공개본</dt><dd>${escapeHtml(state.target.activeReleaseId)}</dd></div>
            <div><dt>장면</dt><dd>${escapeHtml(active.sourceSceneKey)}</dd></div><div><dt>작업 ID</dt><dd>${escapeHtml(active.generationId)}</dd></div></dl>
          <p>${warning}</p><p class="booking-policy">${policy}</p><div class="booking-dialog-actions"><button type="button" class="secondary-action" data-booking-action="cancel">취소</button>
            <button type="button" class="primary-action" data-booking-action="confirm" ${revision}>이 작업만 재준비</button></div></dialog>` : ""}`;
      if (state.confirmation) {
        const dialog = host.querySelector("dialog");
        dialog.addEventListener("cancel", (event) => { event.preventDefault(); controller.cancelConfirmation(); });
        dialog.showModal();
      } else if (focusKey) {
        Array.from(host.querySelectorAll("[data-booking-focus]")).find((element) => element.dataset.bookingFocus === focusKey)?.focus();
      }
    }
    controller = createController({ fetch: (url, options) => api.fetch(url, options), session, onChange: render });
    host.addEventListener("change", (event) => {
      const control = event.target;
      if (!host.contains(control)) return;
      const revision = Number(control.dataset.bookingRevision);
      if (control.matches("[data-booking-work]")) controller.selectWork(control.value, revision);
      if (control.matches("[data-booking-item]")) controller.selectItem(control.dataset.bookingItem, revision);
      if (control.matches("[data-booking-ack]")) controller.acknowledge(control.checked, revision);
    });
    host.addEventListener("click", (event) => {
      const button = event.target.closest("[data-booking-action]");
      if (!button || !host.contains(button) || button.disabled) return;
      const revision = Number(button.dataset.bookingRevision);
      const actions = { catalog: () => controller.loadCatalog(), load: () => controller.loadReview("first", revision),
        next: () => controller.loadReview("next", revision), previous: () => controller.loadReview("previous", revision),
        prepare: () => controller.requestConfirmation(revision), cancel: () => controller.cancelConfirmation(),
        confirm: () => controller.reprepare(revision) };
      actions[button.dataset.bookingAction]?.();
    });
    const onContext = () => {
      controller.syncSession();
      if (visible() && !controller.snapshot().catalogVerified && controller.snapshot().phase === "idle") controller.loadCatalog();
    };
    if (typeof MutationObserver === "function") {
      if (dashboard) new MutationObserver(onContext).observe(dashboard, { attributes: true, attributeFilter: ["class"] });
      if (main) new MutationObserver(onContext).observe(main, { attributes: true, attributeFilter: ["data-active-section"] });
    }
    window.addEventListener("storage", () => controller.syncSession());
    window.addEventListener("focus", () => controller.syncSession());
    document.addEventListener("visibilitychange", () => controller.syncSession());
    document.getElementById("backstageLogoutButton")?.addEventListener("click", () => controller.invalidate("로그아웃되었습니다. 다시 접속해 주세요."));
    for (const id of ["storyPublicationRefreshButton", "backstageRefreshButton"]) {
      document.getElementById(id)?.addEventListener("click", () => {
        controller.invalidate();
        if (visible()) controller.loadCatalog();
      });
    }
    render(controller.snapshot()); onContext();
    return controller;
  }

  window.LuminaBackstageStoryVisualBooking = { createController, mount };
  if (typeof document !== "undefined") mount(document.getElementById("storyVisualBookingPanel"));
})();
