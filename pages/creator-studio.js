(function guardCreatorStudioAccess() {
  const apiBase = (window.LUMINA_API_BASE || "https://api.lumina-stage.com").replace(/\/$/, "");
  const authKey = "lumina_auth";
  const authStorageKeys = ["lumina_auth", "lumina.session"];
  const studioHandoffKey = "lumina_creator_studio_handoff";
  const shell = document.getElementById("studioShell");
  const gate = document.getElementById("studioAccessGate");
  const kicker = document.getElementById("studioGateKicker");
  const title = document.getElementById("studioGateTitle");
  const body = document.getElementById("studioGateBody");
  const actions = document.getElementById("studioGateActions");
  let studioArtists = [];
  let settlementPreview = null;
  let studioModalConfirmHandler = null;
  let studioToastTimer = null;

  function readAuth() {
    for (const key of authStorageKeys) {
      try {
        const raw = localStorage.getItem(key);
        const normalized = normalizeAuth(raw ? JSON.parse(raw) : null);
        if (normalized?.accessToken || normalized?.refreshToken) {
          if (key !== authKey) writeAuth(normalized);
          return normalized;
        }
      } catch (_) {}
    }
    return null;
  }

  function writeAuth(auth) {
    try {
      if (auth) localStorage.setItem(authKey, JSON.stringify(auth));
      else localStorage.removeItem(authKey);
    } catch (_) {}
  }

  function normalizeAuth(auth) {
    if (!auth || typeof auth !== "object") return null;
    const accessToken = auth.accessToken || auth.access_token || auth.token || auth.tokens?.accessToken || auth.tokens?.access_token || null;
    const refreshToken = auth.refreshToken || auth.refresh_token || auth.tokens?.refreshToken || auth.tokens?.refresh_token || null;
    return {
      ...auth,
      accessToken,
      refreshToken,
      user: auth.user || auth.viewer || null
    };
  }

  function readStudioHandoff() {
    try {
      const raw = sessionStorage.getItem(studioHandoffKey);
      if (!raw) return null;
      const handoff = JSON.parse(raw);
      const recent = Date.now() - Number(handoff.savedAt || 0) < 5 * 60 * 1000;
      const auth = readAuth();
      const hasToken = Boolean(auth?.accessToken || auth?.refreshToken);
      const authEmail = auth?.user?.email || "";
      const sameUser = !handoff.viewerEmail || Boolean(authEmail && handoff.viewerEmail === authEmail);
      return recent && hasToken && sameUser && handoff.data?.access?.enabled === true ? handoff.data : null;
    } catch (_) {
      return null;
    }
  }

  async function refreshStudioAuthOnce() {
    const auth = readAuth();
    const refreshToken = auth?.refreshToken;
    if (!refreshToken) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(apiBase + "/api/v1/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        signal: controller.signal
      });
      if (!res.ok) {
        writeAuth(null);
        return null;
      }
      const data = await res.json().catch(() => null);
      const accessToken = data?.accessToken || data?.tokens?.accessToken || data?.access_token;
      const nextRefreshToken = data?.refreshToken || data?.tokens?.refreshToken || data?.refresh_token || refreshToken;
      if (!accessToken) {
        writeAuth(null);
        return null;
      }
      const nextAuth = normalizeAuth({
        ...auth,
        ...data,
        accessToken,
        refreshToken: nextRefreshToken,
        user: data?.user || auth.user
      });
      writeAuth(nextAuth);
      return nextAuth;
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function showGateActions() {
    if (!actions) return;
    actions.hidden = false;
    /* #222 v3 — `다시 확인` 버튼은 HTML 에 정적 정의됨(data-studio-retry).
     * JS 는 click handler 만 한 번 바인딩한다. (정적 버튼이 없을 경우에만 prepend 보강) */
    let retry = actions.querySelector("[data-studio-retry]");
    if (!retry) {
      retry = document.createElement("button");
      retry.type = "button";
      retry.className = "primary-action";
      retry.dataset.studioRetry = "true";
      retry.textContent = "다시 확인";
      actions.prepend(retry);
    }
    if (!retry.dataset.bound) {
      retry.dataset.bound = "true";
      retry.addEventListener("click", () => {
        actions.hidden = true;
        verify();
      });
    }
  }

  async function fetchStudioBootstrap(token, signal) {
    return fetchCreatorStudioApi("/api/v1/me/creator-studio", {
      token,
      signal
    });
  }

  async function fetchCreatorStudioApi(path, options = {}) {
    let auth = readAuth();
    if (!options.token && !auth?.accessToken && auth?.refreshToken) {
      auth = await refreshStudioAuthOnce();
    }
    const token = options.token || auth?.accessToken;
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = "Bearer " + token;
    if (options.body) headers["Content-Type"] = "application/json";
    let res = await fetch(apiBase + path, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal
    });
    if (res.status === 401 && !options._retried) {
      const refreshed = await refreshStudioAuthOnce();
      if (refreshed?.accessToken) {
        res = await fetchCreatorStudioApi(path, {
          ...options,
          token: refreshed.accessToken,
          _retried: true
        });
      }
    }
    return res;
  }

  function authEmail() {
    const user = readAuth()?.user || {};
    return user.email || user.displayName || user.id || "";
  }

  function setGateChecking() {
    const email = authEmail();
    if (kicker) kicker.textContent = "Checking";
    if (title) title.textContent = "스튜디오 권한을 확인하고 있습니다.";
    if (body) body.textContent = email
      ? "현재 로그인 계정 " + email + " 기준으로 Creator Studio 권한을 확인하고 있습니다."
      : "현재 브라우저에서 로그인 계정을 찾지 못했습니다.";
  }

  function markStudioReady() {
    document.documentElement.classList.remove("is-booting");
    document.documentElement.classList.add("is-ready");
    document.body.classList.remove("is-booting");
    document.body.classList.add("is-ready");
  }

  function deny(message) {
    if (shell) shell.hidden = true;
    if (gate) gate.hidden = false;
    if (kicker) kicker.textContent = "Access Required";
    if (title) title.textContent = "스튜디오 접근 권한이 필요합니다.";
    if (body) body.textContent = message || "승인된 크리에이터 계정만 스튜디오 스테이지에 들어올 수 있습니다.";
    showGateActions();
    markStudioReady();
  }

  window.addEventListener("error", function () {
    deny("스튜디오 화면 스크립트 실행 중 오류가 발생했습니다. 새로고침 후에도 반복되면 배포 파일을 확인해야 합니다.");
  });

  window.addEventListener("unhandledrejection", function () {
    deny("스튜디오 권한 확인 중 오류가 발생했습니다. 새로고침 후에도 반복되면 로그인 상태를 확인해 주세요.");
  });

  function allow(data) {
    if (gate) gate.hidden = true;
    if (shell) shell.hidden = false;
    const email = data?.access?.accountEmail || readAuth()?.user?.email;
    // #362 — sidebar 접속 계정 projection 으로 채우기. 실패/로딩 시 "로그인한 크리에이터" fallback.
    const account = document.getElementById("studioAccountEmail") || document.querySelector(".studio-account strong");
    if (account) account.textContent = email || "로그인한 크리에이터";
    const roleEl = document.getElementById("studioAccountRole");
    const roleLabel = data?.access?.roleLabel || data?.access?.accountTypeLabel || "크리에이터";
    if (roleEl) roleEl.textContent = roleLabel;
    markStudioReady();
    hydrateStudio(data);
    loadSettlementPreview();
    loadSettlementConversions();
    loadKnowledgeUrls();
  }

  function openStudioShellPending() {
    if (gate) gate.hidden = true;
    if (shell) shell.hidden = false;
    const email = readAuth()?.user?.email;
    const account = document.getElementById("studioAccountEmail") || document.querySelector(".studio-account strong");
    if (account) account.textContent = email || "계정 정보를 불러오는 중입니다.";
    markStudioReady();
  }

  function text(id, value) {
    const el = document.getElementById(id);
    if (el && value !== undefined && value !== null) el.textContent = value;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number.toLocaleString("ko-KR") : "0";
  }

  function formatKrw(value) {
    return formatNumber(Math.round(Number(value || 0))) + "원";
  }

  function firstNumber(...values) {
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return 0;
  }

  function showToast(message) {
    const el = document.getElementById("studioToast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("is-visible");
    clearTimeout(studioToastTimer);
    studioToastTimer = setTimeout(() => el.classList.remove("is-visible"), 2200);
  }

  function setActiveSection(sectionId) {
    if (!sectionId) return;
    const target = document.getElementById(sectionId);
    if (!target?.classList.contains("studio-section")) return;
    document.querySelectorAll(".studio-nav button").forEach(button => {
      const active = button.dataset.section === sectionId;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    document.querySelectorAll(".studio-section").forEach(section => {
      section.classList.toggle("is-active", section.id === sectionId);
    });
    history.replaceState(null, "", `#${sectionId}`);
    document.querySelector(".studio-main")?.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  function closeStudioModal() {
    const modal = document.getElementById("studioModal");
    if (modal) modal.classList.add("is-hidden");
    studioModalConfirmHandler = null;
  }

  function openStudioModal({ type = "확인", title = "확인", message = "", summaryHtml = "", confirmText = "확인", cancelText = "취소", onConfirm = null } = {}) {
    const modal = document.getElementById("studioModal");
    if (!modal) return;
    text("studioModalType", type);
    text("studioModalTitle", title);
    text("studioModalMessage", message);
    const summary = document.getElementById("studioModalSummary");
    if (summary) summary.innerHTML = summaryHtml;
    const confirm = document.getElementById("studioModalConfirm");
    const cancel = document.getElementById("studioModalCancel");
    if (confirm) confirm.textContent = confirmText;
    if (cancel) cancel.textContent = cancelText;
    studioModalConfirmHandler = onConfirm;
    modal.classList.remove("is-hidden");
  }

  function modalRow(label, value) {
    return "<div><strong>" + escapeHtml(label) + "</strong><span>" + escapeHtml(value) + "</span></div>";
  }

  function currentPeriod() {
    const now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  }

  function artistImage(artist) {
    return artist?.thumbnailImage?.url || artist?.thumbnailUrl || artist?.coverImage?.url || artist?.coverUrl || "./assets/brand/lumina-stage-logo.png";
  }

  function artistName(item) {
    return item?.artist?.displayName || item?.artist?.name || item?.displayName || "이름 미정";
  }

  function artistId(item) {
    return item?.artist?.id || item?.artistId || item?.id || "";
  }

  function artistStatusLabel(status) {
    return {
      active: "공개",
      draft: "작성중",
      private: "비공개",
      paused: "휴식기",
      inactive: "비활성"
    }[status] || status || "확인 중";
  }

  function hydrateStudio(data) {
    const artists = Array.isArray(data?.artists) ? data.artists : [];
    studioArtists = artists;
    const summary = data?.summary || {};
    const slotPolicy = data?.policy?.slotPolicy || {};
    const usedSlots = Number(summary.usedSlots ?? slotPolicy.usedSlots ?? artists.length ?? 0);
    const slotLimit = Number(summary.slotLimit ?? slotPolicy.initialSlotLimit ?? 10);
    const activeCount = Number(summary.activeArtistCount ?? artists.filter(item => item?.artist?.status === "active").length);
    const needsAttention = Number(summary.needsAttentionCount ?? summary.openImageRequestCount ?? 0);

    text("studioMetricArtists", formatNumber(summary.ownedArtistCount ?? artists.length) + "명");
    text("studioMetricArtistsSub", "활동 " + formatNumber(activeCount) + " · 확인 필요 " + formatNumber(needsAttention));
    text("studioSlotText", formatNumber(usedSlots) + " / " + formatNumber(slotLimit) + " 사용");
    const slotBar = document.querySelector("#studioSlotBar span");
    if (slotBar && slotLimit > 0) slotBar.style.width = Math.min(100, Math.max(0, usedSlots / slotLimit * 100)) + "%";

    if (needsAttention > 0) {
      text("studioAttentionTitle", "확인 필요한 운영 항목 " + formatNumber(needsAttention) + "건");
      text("studioAttentionBody", "프로필, 피드, 정산 정보 중 보완이 필요한 항목을 먼저 확인해주세요.");
    } else {
      text("studioAttentionTitle", "오늘의 필수 확인 항목 없음");
      text("studioAttentionBody", "새 피드 예약과 정산 정보만 가볍게 확인하면 됩니다.");
    }

    renderArtists(artists, usedSlots, slotLimit);
    populateProfileEditor(artists);
    populateKnowledgeUrlArtistSelect(artists);
  }

  function renderArtists(artists, usedSlots, slotLimit) {
    const cardRoot = document.getElementById("studioArtistCards");
    const rowRoot = document.getElementById("studioArtistRows");
    if (!artists.length) return;

    if (cardRoot) {
      cardRoot.innerHTML = artists.map(item => {
        const artist = item.artist || item;
        const status = artistStatusLabel(artist.status);
        const summary = artist.publicProfile?.tagline || artist.publicProfile?.summary || "프로필을 보완해 주세요.";
        const badgeClass = artist.status === "active" ? "is-good" : artist.status === "paused" ? "is-warn" : "";
        return '<article class="artist-card">' +
          '<img class="artist-thumb" src="' + escapeHtml(artistImage(artist)) + '" alt="' + escapeHtml(artistName(item)) + '" />' +
          '<div><h3>' + escapeHtml(artistName(item)) + '</h3><p>' + escapeHtml(summary) + '</p><div class="badge-row"><span class="badge ' + badgeClass + '">' + escapeHtml(status) + '</span><span class="badge">슬롯 ' + formatNumber(item?.artist?.sortOrder || 1) + '</span></div></div>' +
          '<button class="secondary-action" type="button" data-profile-artist="' + escapeHtml(artistId(item)) + '">관리</button>' +
        '</article>';
      }).join("");
    }

    if (rowRoot) {
      rowRoot.innerHTML = artists.map((item, index) => {
        const artist = item.artist || item;
        const status = artistStatusLabel(artist.status);
        const recent = item?.imageRequests?.open ? "이미지 요청 " + formatNumber(item.imageRequests.open) + "건" : "최근 상태 확인";
        const action = artist.status === "active" ? "운영 유지" : "프로필 보완";
        return "<tr><td>" + escapeHtml(artistName(item)) + "</td><td><span class=\"badge\">" + escapeHtml(status) + "</span></td><td>" + escapeHtml(recent) + "</td><td>" + escapeHtml(action) + "</td><td>" + formatNumber(index + 1) + " / " + formatNumber(slotLimit || usedSlots || artists.length) + "</td></tr>";
      }).join("");
    }
  }

  function splitKeywords(value) {
    return String(value || "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);
  }

  function joinKeywords(value) {
    return Array.isArray(value) ? value.join(", ") : "";
  }

  function setProfileState(message, tone) {
    const el = document.getElementById("studioProfileSaveState");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("is-good", tone === "good");
    el.classList.toggle("is-danger", tone === "danger");
  }

  function selectedProfileItem() {
    const select = document.getElementById("studioProfileArtistSelect");
    const selectedId = select?.value || artistId(studioArtists[0]);
    return studioArtists.find(item => artistId(item) === selectedId) || studioArtists[0] || null;
  }

  function populateProfileEditor(artists) {
    const select = document.getElementById("studioProfileArtistSelect");
    if (!select || !artists.length) return;
    select.innerHTML = artists.map(item => '<option value="' + escapeHtml(artistId(item)) + '">' + escapeHtml(artistName(item)) + '</option>').join("");
    fillProfileEditor(artists[0]);
  }

  function fillProfileEditor(item) {
    if (!item) {
      setProfileState("등록된 아티스트가 없습니다.", "danger");
      return;
    }
    const artist = item.artist || item;
    const publicProfile = artist.publicProfile || {};
    const visualProfile = artist.visualProfile || {};
    const contentProfile = artist.contentProfile || {};
    const fields = {
      studioProfileTagline: publicProfile.tagline || "",
      studioProfileSummary: publicProfile.summary || "",
      studioProfileStory: publicProfile.publicStory || "",
      studioProfilePersonality: joinKeywords(publicProfile.personalityKeywords),
      studioProfilePrimaryColor: visualProfile.primaryColor || "",
      studioProfileSecondaryColor: visualProfile.secondaryColor || "",
      studioProfileVisual: joinKeywords(visualProfile.visualKeywords),
      studioProfileStyleNotes: visualProfile.styleNotes || "",
      studioProfileTone: contentProfile.contentTone || "",
      studioProfileAllowedTopics: joinKeywords(contentProfile.allowedTopics),
      studioProfileBlockedTopics: joinKeywords(contentProfile.blockedTopics),
      studioProfileNotes: contentProfile.operatingNotes || ""
    };
    Object.entries(fields).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    });
    setProfileState(artistName(item) + " 프로필을 불러왔습니다.", "good");
  }

  function profilePayload() {
    return {
      publicProfile: {
        tagline: document.getElementById("studioProfileTagline")?.value.trim() || "",
        summary: document.getElementById("studioProfileSummary")?.value.trim() || "",
        personalityKeywords: splitKeywords(document.getElementById("studioProfilePersonality")?.value),
        publicStory: document.getElementById("studioProfileStory")?.value.trim() || ""
      },
      visualProfile: {
        primaryColor: document.getElementById("studioProfilePrimaryColor")?.value.trim() || "",
        secondaryColor: document.getElementById("studioProfileSecondaryColor")?.value.trim() || "",
        visualKeywords: splitKeywords(document.getElementById("studioProfileVisual")?.value),
        styleNotes: document.getElementById("studioProfileStyleNotes")?.value.trim() || ""
      },
      contentProfile: {
        contentTone: document.getElementById("studioProfileTone")?.value.trim() || "",
        allowedTopics: splitKeywords(document.getElementById("studioProfileAllowedTopics")?.value),
        blockedTopics: splitKeywords(document.getElementById("studioProfileBlockedTopics")?.value),
        operatingNotes: document.getElementById("studioProfileNotes")?.value.trim() || ""
      }
    };
  }

  async function saveProfileEditor() {
    const token = readAuth()?.accessToken;
    const item = selectedProfileItem();
    const id = artistId(item);
    if (!token || !id) {
      setProfileState("저장할 아티스트나 로그인 정보가 없습니다.", "danger");
      return;
    }
    setProfileState("프로필을 저장하는 중입니다.", "");
    try {
      const res = await fetch(apiBase + "/api/v1/me/creator-studio/artists/" + encodeURIComponent(id) + "/profile", {
        method: "PATCH",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(profilePayload())
      });
      if (!res.ok) throw new Error("save failed");
      setProfileState("프로필이 저장되었습니다.", "good");
    } catch (_) {
      setProfileState("프로필 저장에 실패했습니다. 잠시 후 다시 시도해주세요.", "danger");
    }
  }

  async function loadSettlementPreview() {
    const token = readAuth()?.accessToken;
    if (!token) return;
    try {
      const res = await fetch(apiBase + "/api/v1/me/creator-studio/settlement-preview?period=" + currentPeriod(), {
        headers: { Authorization: "Bearer " + token }
      });
      if (!res.ok) return;
      const data = await res.json();
      renderSettlement(data);
    } catch (_) {
      // Preview is optional; keep the static fallback when unavailable.
    }
  }

  async function loadSettlementConversions() {
    const token = readAuth()?.accessToken;
    const rows = document.getElementById("studioSettlementConversionRows");
    if (!token || !rows) return;
    rows.innerHTML = '<tr><td colspan="5">접수된 정산금 충전 신청을 불러오는 중입니다.</td></tr>';
    try {
      const params = new URLSearchParams({ period: currentPeriod(), status: "requested" });
      const res = await fetch(apiBase + "/api/v1/me/creator-studio/settlement-conversions?" + params, {
        headers: { Authorization: "Bearer " + token }
      });
      if (!res.ok) throw new Error("load failed");
      const data = await res.json().catch(() => null);
      const items = Array.isArray(data) ? data : data?.items || data?.requests || [];
      renderSettlementConversions(items);
    } catch (_) {
      rows.innerHTML = '<tr><td colspan="5">신청 목록을 불러오지 못했습니다. 잠시 후 다시 확인해주세요.</td></tr>';
    }
  }

  function conversionStatusLabel(status) {
    const labels = {
      requested: "확인 대기",
      approved: "승인됨",
      credited: "반영 완료",
      rejected: "반려",
      canceled: "취소"
    };
    return labels[status] || "확인 대기";
  }

  function renderSettlementConversions(items = []) {
    const rows = document.getElementById("studioSettlementConversionRows");
    const state = document.getElementById("studioSettlementConversionState");
    if (!rows) return;
    if (!items.length) {
      rows.innerHTML = '<tr><td colspan="5">아직 접수된 정산금 충전 신청이 없습니다.</td></tr>';
      if (state) state.textContent = "정산금 충전 신청은 승인 후에만 지갑에 반영됩니다.";
      return;
    }
    rows.innerHTML = items.map(item => {
      const amount = Number(item.amountKrw || 0);
      const lumina = Number(item.requestedLumina || Math.floor(amount / 10));
      return "<tr><td>" + escapeHtml(item.settlementKey || "-") + "</td><td>" + formatKrw(amount) + "</td><td>" + formatNumber(lumina) + "L</td><td><span class=\"badge is-warn\">" + escapeHtml(conversionStatusLabel(item.status || "requested")) + "</span></td><td>" + escapeHtml(item.note || "-") + "</td></tr>";
    }).join("");
    if (state) state.textContent = "표시된 신청은 관리자/회계 확인 대기 흐름입니다. 승인 전 지갑 잔액은 늘어나지 않습니다.";
  }

  function renderSettlement(data) {
    settlementPreview = data || null;
    const total = Number(data?.totals?.creatorShareKrw || 0);
    if (total) text("studioMetricSettlement", formatKrw(total));
    renderPayoutBreakdown(data);
    renderSettlementProfile(data?.settlementProfile || data?.payoutProfile || data?.profile);
    const rows = document.getElementById("studioSettlementRows");
    if (rows && Array.isArray(data?.items) && data.items.length) {
      rows.innerHTML = [
        "<tr><td>전체 합산</td><td>" + formatNumber(data.items.length) + "명 합산</td><td>" + formatKrw(data.totals?.grossRevenueKrw) + "</td><td>" + formatKrw(data.totals?.riskReserveKrw) + "</td><td class=\"money\">" + formatKrw(data.totals?.creatorShareKrw) + "</td><td><span class=\"badge is-warn\">예상치</span></td></tr>",
        ...data.items.map(item => {
          const name = item?.artist?.displayName || item?.artist?.slug || "아티스트";
          return "<tr><td>캐릭터별</td><td>" + escapeHtml(name) + "</td><td>" + formatKrw(item?.financials?.grossRevenueKrw) + "</td><td>" + formatKrw(item?.financials?.riskReserveKrw) + "</td><td class=\"money\">" + formatKrw(item?.financials?.creatorShareKrw) + "</td><td><span class=\"badge\">예상</span></td></tr>";
        })
      ].join("");
    }

    const revenueRows = document.getElementById("studioRevenueRows");
    const breakdown = aggregateBreakdown(data?.items || []);
    if (revenueRows && breakdown.length) {
      revenueRows.innerHTML = breakdown.map(item => "<tr><td>" + escapeHtml(item.label) + "</td><td>" + formatNumber(item.eventCount) + "</td><td>" + formatNumber(item.grossLumina) + "L</td><td>" + formatKrw(item.grossRevenueKrw) + "</td><td>완료 건만 포함</td></tr>").join("");
    }
  }

  function renderPayoutBreakdown(data) {
    const card = document.getElementById("studioPayoutBreakdown");
    if (!card || !data?.totals) return;

    const policy = data.policy || {};
    const totals = data.totals || {};
    const settlementRateBps = firstNumber(policy.settlementRateBps, 7000);
    const unitPriceKrw = firstNumber(policy.unitPriceKrw, 10);
    const withholdingRateBps = firstNumber(policy.withholdingTaxRateBps, policy.taxRateBps, 330);
    const grossLumina = firstNumber(totals.grossLumina, totals.receivedLumina);
    const grossKrw = firstNumber(totals.creatorShareKrw, totals.payoutGrossKrw, totals.grossPayoutKrw);
    const eligibleLumina = firstNumber(
      totals.eligibleLumina,
      totals.settlementLumina,
      grossLumina * settlementRateBps / 10000,
      unitPriceKrw ? grossKrw / unitPriceKrw : 0
    );
    const taxKrw = firstNumber(totals.withholdingTaxKrw, totals.taxKrw, grossKrw * withholdingRateBps / 10000);
    const netKrw = firstNumber(totals.netPayoutKrw, totals.payoutNetKrw, Math.max(0, grossKrw - taxKrw));
    const hasRealAmount = grossLumina > 0 || grossKrw > 0;

    card.classList.toggle("is-payout-sample", !hasRealAmount);
    card.dataset.payoutState = hasRealAmount ? "estimate" : "sample";
    card.querySelectorAll("[data-payout-sample]").forEach(el => {
      el.dataset.payoutSample = hasRealAmount ? "false" : "true";
    });

    if (!hasRealAmount) return;

    text("studioPayoutGrossLumina", formatNumber(grossLumina) + "L");
    text("studioPayoutEligibleLumina", formatNumber(Math.floor(eligibleLumina)) + "L");
    text("studioPayoutGrossKrw", formatKrw(grossKrw));
    text("studioPayoutTaxKrw", formatKrw(taxKrw));
    text("studioPayoutNetKrw", formatKrw(netKrw));
    text("studioPayoutCurrencyLabel", data.currencyLabel || policy.payoutCurrencyLabel || "KRW · 한국 원");
    text("studioPayoutFxLabel", data.fxSnapshotLabel || policy.fxSnapshotLabel || "주간 기준환율 + 3~5% 안전마진");
  }

  function renderSettlementProfile(profile = {}) {
    const identityVerified = Boolean(profile.identityVerified || profile.verifiedIdentity || profile.kycVerified);
    const accountRegistered = Boolean(profile.bankAccountRegistered || profile.accountRegistered || profile.bankAccount?.status === "verified");
    const accountMatched = profile.bankAccountOwnerMatched ?? profile.accountOwnerMatched ?? profile.bankAccount?.ownerMatched;
    const taxAddressReady = Boolean(profile.taxAddressRegistered || profile.taxAddressReady || profile.taxAddress?.status === "registered");
    const exceptionApproved = Boolean(profile.accountExceptionApproved || profile.exceptionApproved);

    text("studioSettlementIdentity", identityVerified ? "완료" : "확인 필요");
    text("studioSettlementIdentityHelp", identityVerified ? "본인인증이 확인되었습니다." : "정산 신청 전 본인인증을 완료해야 합니다.");
    text("studioSettlementAccount", accountRegistered ? (accountMatched === false ? "명의 확인 필요" : "등록 완료") : "등록 전");
    text("studioSettlementAccountHelp", accountRegistered
      ? (accountMatched === false ? "본인인증 이름과 예금주가 일치해야 합니다." : "계좌 정보가 등록되었습니다.")
      : "본인인증 이름과 예금주가 일치해야 합니다.");
    text("studioSettlementTaxAddress", taxAddressReady ? "입력 완료" : "입력 대기");
    text("studioSettlementException", exceptionApproved ? "예외 승인" : "고객센터 문의");
  }

  // ── #409 — 아티스트 자료 URL 등록 ──────────────────────────────────────

  function isValidKnowledgeUrl(value) {
    if (!value) return false;
    try {
      const u = new URL(value);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch (_) {
      return false;
    }
  }

  function setKnowledgeUrlState(message, tone) {
    const el = document.getElementById("knowledgeUrlFormState");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("is-good", tone === "good");
    el.classList.toggle("is-danger", tone === "danger");
  }

  function setKnowledgeSubmitLocked(locked) {
    const btn = document.getElementById("knowledgeUrlSubmit");
    if (!btn) return;
    btn.disabled = locked;
    btn.setAttribute("aria-disabled", locked ? "true" : "false");
    btn.style.opacity = locked ? "0.45" : "";
    btn.style.cursor = locked ? "not-allowed" : "";
  }

  function knowledgeUrlStatusLabel(status) {
    return { pending: "승인 대기", approved: "승인됨", rejected: "반려", archived: "보관", processing: "처리 중" }[status] || "승인 대기";
  }

  function knowledgeUrlStatusClass(status) {
    return { pending: "is-warn", approved: "is-good", rejected: "is-error", archived: "", processing: "" }[status] || "is-warn";
  }

  function knowledgeUrlTypeLabel(type) {
    return { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", blog: "블로그", notice: "공지", other: "기타" }[type] || "기타";
  }

  function populateKnowledgeUrlArtistSelect(artists) {
    const select = document.getElementById("knowledgeUrlArtistSelect");
    if (!select || !artists.length) return;
    select.innerHTML = artists.map(item => '<option value="' + escapeHtml(artistId(item)) + '">' + escapeHtml(artistName(item)) + '</option>').join("");
  }

  function renderKnowledgeUrls(items) {
    const rows = document.getElementById("knowledgeUrlRows");
    if (!rows) return;
    const navBadge = document.querySelector('[data-section="knowledge-url"] b');
    if (navBadge) navBadge.textContent = String(items.length);
    if (!items.length) {
      rows.innerHTML = '<tr><td colspan="6">등록된 자료 URL이 없습니다. 위 폼으로 첫 번째 자료를 등록해보세요.</td></tr>';
      return;
    }
    rows.innerHTML = items.map(item => {
      const rawUrl = String(item.url || "");
      const urlTrunc = rawUrl.replace(/^https?:\/\//, "").slice(0, 40) + (rawUrl.length > 40 ? "…" : "");
      const rawDesc = String(item.description || item.summary || "");
      const descTrunc = rawDesc.slice(0, 60) + (rawDesc.length > 60 ? "…" : "");
      const allowRef = item.allowChatRef !== false;
      const chatLabel = !allowRef ? "미허용" : (item.status === "approved" ? "참고 가능" : "승인 대기");
      const chatClass = !allowRef ? "" : (item.status === "approved" ? "is-good" : "is-warn");
      const statusLabel = knowledgeUrlStatusLabel(item.status || "pending");
      const statusClass = knowledgeUrlStatusClass(item.status || "pending");
      const typeLabel = knowledgeUrlTypeLabel(item.type || "other");
      const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }) : "-";
      return "<tr>" +
        "<td><span class=\"badge\">" + escapeHtml(typeLabel) + "</span></td>" +
        "<td><a class=\"knowledge-url-link\" href=\"" + escapeHtml(rawUrl || "#") + "\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"" + escapeHtml(rawUrl) + "\">" + escapeHtml(urlTrunc || "-") + "</a></td>" +
        "<td>" + escapeHtml(descTrunc || "-") + "</td>" +
        "<td><span class=\"badge " + escapeHtml(chatClass) + "\">" + escapeHtml(chatLabel) + "</span></td>" +
        "<td><span class=\"badge " + escapeHtml(statusClass) + "\">" + escapeHtml(statusLabel) + "</span></td>" +
        "<td>" + escapeHtml(dateStr) + "</td>" +
      "</tr>";
    }).join("");
  }

  async function loadKnowledgeUrls() {
    const auth = readAuth();
    const rows = document.getElementById("knowledgeUrlRows");
    if ((!auth?.accessToken && !auth?.refreshToken) || !rows) return;
    rows.innerHTML = '<tr><td colspan="6">자료 URL 목록을 불러오는 중입니다.</td></tr>';
    try {
      const params = new URLSearchParams();
      const artistSel = document.getElementById("knowledgeUrlArtistSelect");
      if (artistSel?.value) params.set("artistId", artistSel.value);
      const res = await fetchCreatorStudioApi("/api/v1/me/creator-studio/knowledge-urls?" + params);
      if (res.status === 404 || res.status === 501) {
        rows.innerHTML = '<tr><td colspan="6">자료 URL 등록 기능은 운영팀 안내 후 이용할 수 있어요. 폼 구성은 미리 확인할 수 있습니다.</td></tr>';
        setKnowledgeSubmitLocked(true);
        setKnowledgeUrlState("자료 URL 등록 기능은 운영팀 안내 후 이용할 수 있어요.", "danger");
        return;
      }
      if (!res.ok) throw new Error("load failed");
      const data = await res.json().catch(() => null);
      const items = Array.isArray(data) ? data : (data?.items || data?.urls || []);
      setKnowledgeSubmitLocked(false);
      setKnowledgeUrlState("", "");
      renderKnowledgeUrls(items);
    } catch (_) {
      if (rows) rows.innerHTML = '<tr><td colspan="6">목록을 불러오지 못했습니다. 잠시 후 다시 확인해주세요.</td></tr>';
    }
  }

  async function submitKnowledgeUrl() {
    const auth = readAuth();
    const artistSel = document.getElementById("knowledgeUrlArtistSelect");
    const typeSel = document.getElementById("knowledgeUrlType");
    const urlInput = document.getElementById("knowledgeUrlInput");
    const descEl = document.getElementById("knowledgeUrlDesc");
    const allowChatEl = document.getElementById("knowledgeUrlAllowChat");
    const submitBtn = document.getElementById("knowledgeUrlSubmit");

    const url = urlInput?.value.trim() || "";
    const description = descEl?.value.trim() || "";
    const type = typeSel?.value || "other";
    const allowChatRef = allowChatEl?.checked ?? true;
    const selectedArtistId = artistSel?.value || "";

    if (!url) {
      setKnowledgeUrlState("URL을 입력해주세요.", "danger");
      urlInput?.focus();
      return;
    }
    if (!isValidKnowledgeUrl(url)) {
      setKnowledgeUrlState("올바른 URL 형식이 아닙니다. https://로 시작하는 주소를 입력해주세요.", "danger");
      urlInput?.focus();
      return;
    }
    if (!description) {
      setKnowledgeUrlState("캐릭터가 참고할 설명을 입력해주세요.", "danger");
      descEl?.focus();
      return;
    }
    if (!auth?.accessToken && !auth?.refreshToken) {
      setKnowledgeUrlState("로그인 정보가 없습니다. 다시 로그인해주세요.", "danger");
      return;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "등록 중"; }
    setKnowledgeUrlState("등록 신청 중입니다.", "");

    try {
      const res = await fetchCreatorStudioApi("/api/v1/me/creator-studio/knowledge-urls", {
        method: "POST",
        body: { artistId: selectedArtistId, type, url, description, allowChatRef }
      });
      if (res.status === 404 || res.status === 501) {
        setKnowledgeUrlState("자료 URL 등록 기능은 운영팀 안내 후 이용할 수 있어요.", "danger");
        return;
      }
      if (!res.ok) {
        setKnowledgeUrlState("등록에 실패했습니다. 잠시 후 다시 시도해주세요.", "danger");
        return;
      }
      setKnowledgeUrlState("자료 URL이 등록되었습니다. 관리자 검토 후 승인 대기 상태로 전환됩니다.", "good");
      if (urlInput) urlInput.value = "";
      if (descEl) descEl.value = "";
      showToast("등록 신청이 접수되었습니다. 검토 후 안내드립니다.");
      loadKnowledgeUrls();
    } catch (_) {
      setKnowledgeUrlState("등록 요청 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.", "danger");
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "등록 신청"; }
    }
  }

  // ────────────────────────────────────────────────────────────────────────

  function aggregateBreakdown(items) {
    const labels = {
      chat: "채팅",
      gift: "선물",
      paid_like: "유료 좋아요",
      premium_video: "프리미엄 영상",
      fan_letter: "팬레터"
    };
    const bucket = {};
    items.forEach(item => {
      Object.entries(item?.productBreakdown || {}).forEach(([key, value]) => {
        bucket[key] ||= { label: labels[key] || key, eventCount: 0, grossLumina: 0, grossRevenueKrw: 0 };
        bucket[key].eventCount += Number(value?.eventCount || 0);
        bucket[key].grossLumina += Number(value?.grossLumina || 0);
        bucket[key].grossRevenueKrw += Number(value?.grossRevenueKrw || 0);
      });
    });
    return Object.values(bucket).filter(item => item.eventCount || item.grossLumina || item.grossRevenueKrw);
  }

  function settlementOptions() {
    const period = settlementPreview?.period?.label || currentPeriod();
    return (settlementPreview?.items || []).map(item => {
      const artist = item.artist || {};
      const id = artist.id || item.targetArtistId || "";
      const key = item.settlementKey || (id ? "artist:" + id + ":" + period : "");
      const available = Math.floor(Number(item?.financials?.creatorShareKrw || 0));
      return {
        key,
        name: artist.displayName || artist.slug || "아티스트",
        available
      };
    }).filter(item => item.key && item.available >= 1000);
  }

  function openSettlementRequestModal() {
    const total = Number(settlementPreview?.totals?.creatorShareKrw || 0);
    openStudioModal({
      type: "SETTLEMENT",
      title: "정산 신청 전 확인",
      message: "표시 금액은 예상 정산액입니다. 최종 지급은 환불, 결제 취소, 세무·회계 검토 후 확정됩니다.",
      summaryHtml: [
        modalRow("이번 달 예상", formatKrw(total)),
        modalRow("본인인증", document.getElementById("studioSettlementIdentity")?.textContent || "확인 필요"),
        modalRow("정산 계좌", document.getElementById("studioSettlementAccount")?.textContent || "등록 전"),
        modalRow("세무 주소", document.getElementById("studioSettlementTaxAddress")?.textContent || "입력 대기")
      ].join(""),
      confirmText: "정산 탭 확인",
      onConfirm: () => {
        closeStudioModal();
        setActiveSection("settlement");
        showToast("정산 프로필을 먼저 확인해주세요.");
      }
    });
  }

  function openSettlementConversionModal() {
    const options = settlementOptions();
    const minAmount = 1000;
    if (!options.length) {
      showToast("충전 요청 가능한 예상 정산액이 아직 없습니다.");
      return;
    }
    const first = options[0];
    const maxAmount = Math.max(0, Math.floor(first.available / 1000) * 1000);
    openStudioModal({
      type: "CHARGE REQUEST",
      title: "정산금으로 충전",
      message: "정산금으로 충전은 요청만 접수됩니다. 관리자/회계 확인 후 루미나가 지급되며, 즉시 지갑에 반영되지 않습니다. 1 Lumina = 10원 기준입니다.",
      summaryHtml:
        '<div class="modal-form-grid">' +
          '<label class="is-wide"><span>대상 정산</span><select id="studioConversionSettlement">' +
            options.map(item => '<option value="' + escapeHtml(item.key) + '" data-available="' + escapeHtml(item.available) + '">' + escapeHtml(item.name + " · 가능 " + formatKrw(item.available)) + '</option>').join("") +
          '</select></label>' +
          '<label><span>요청 금액</span><input id="studioConversionAmount" type="number" min="' + minAmount + '" step="1000" max="' + maxAmount + '" value="' + Math.max(minAmount, maxAmount) + '" /></label>' +
          '<label><span>예상 루미나</span><input id="studioConversionLumina" value="' + formatNumber(Math.floor(Math.max(minAmount, maxAmount) / 10)) + 'L" readonly /></label>' +
          '<label class="is-wide"><span>메모</span><input id="studioConversionNote" maxlength="120" placeholder="선택 입력" /></label>' +
        '</div>',
      confirmText: "충전 요청",
      onConfirm: submitSettlementConversion
    });
    const select = document.getElementById("studioConversionSettlement");
    const amount = document.getElementById("studioConversionAmount");
    const lumina = document.getElementById("studioConversionLumina");
    function syncLimit() {
      const available = Number(select?.selectedOptions?.[0]?.dataset.available || 0);
      const max = Math.max(0, Math.floor(available / 1000) * 1000);
      if (amount) {
        amount.max = String(max);
        amount.value = String(Math.max(minAmount, Math.min(Number(amount.value || max), max)));
      }
      if (lumina) lumina.value = formatNumber(Math.floor(Number(amount?.value || 0) / 10)) + "L";
    }
    select?.addEventListener("change", syncLimit);
    amount?.addEventListener("input", () => {
      if (lumina) lumina.value = formatNumber(Math.floor(Number(amount.value || 0) / 10)) + "L";
    });
  }

  async function submitSettlementConversion() {
    const token = readAuth()?.accessToken;
    const settlementKey = document.getElementById("studioConversionSettlement")?.value || "";
    const amountKrw = Number(document.getElementById("studioConversionAmount")?.value || 0);
    const note = document.getElementById("studioConversionNote")?.value.trim() || "";
    if (!token || !settlementKey || amountKrw < 1000) {
      showToast("충전 요청 금액은 1,000원 이상이어야 합니다.");
      return;
    }
    const confirm = document.getElementById("studioModalConfirm");
    if (confirm) {
      confirm.disabled = true;
      confirm.textContent = "요청 중";
    }
    try {
      const res = await fetch(apiBase + "/api/v1/me/creator-studio/settlement-conversions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          settlementKey,
          amountKrw: String(amountKrw),
          note,
          idempotencyKey: "studio-" + Date.now() + "-" + Math.random().toString(16).slice(2)
        })
      });
      if (!res.ok) {
        let msg = "충전 요청에 실패했습니다.";
        try {
          const error = await res.json();
          const remaining = error?.remainingKrw ?? error?.availableKrw ?? error?.maxAmountKrw ?? error?.details?.remainingKrw ?? error?.details?.availableKrw;
          if (remaining !== undefined) msg = "요청 가능 금액을 초과했습니다. 남은 예상 금액: " + formatKrw(remaining);
        } catch (_) {}
        throw new Error(msg);
      }
      closeStudioModal();
      showToast("정산금으로 충전 요청이 접수되었습니다. 관리자/회계 확인 후 반영됩니다.");
      loadSettlementConversions();
    } catch (err) {
      showToast(err?.message || "충전 요청에 실패했습니다.");
    } finally {
      if (confirm) {
        confirm.disabled = false;
        confirm.textContent = "충전 요청";
      }
    }
  }

  function openTonePreview() {
    const body = document.getElementById("feedBody")?.value.trim() || "";
    const item = selectedProfileItem();
    const tone = item?.artist?.contentProfile?.contentTone || document.getElementById("studioProfileTone")?.value || "팬에게 공개 가능한 차분한 톤";
    const preview = body
      ? body + "\n\n" + "오늘의 감정은 크게 흔들리지 않게, 그래도 팬들에게 닿을 만큼은 선명하게 남겨둘게요."
      : "본문을 입력하면 선택한 아티스트의 톤앤매너 기준으로 미리보기합니다.";
    openStudioModal({
      type: "TONE PREVIEW",
      title: "톤앤매너 미리보기",
      message: "실제 변환 기능 연결 전, 현재 저장된 톤 기준을 확인하는 미리보기입니다.",
      summaryHtml: [
        modalRow("아티스트", artistName(item)),
        modalRow("톤 기준", tone),
        modalRow("미리보기", preview)
      ].join(""),
      confirmText: "확인"
    });
  }

  document.getElementById("studioProfileArtistSelect")?.addEventListener("change", () => {
    fillProfileEditor(selectedProfileItem());
  });
  document.getElementById("studioProfileResetButton")?.addEventListener("click", () => {
    fillProfileEditor(selectedProfileItem());
  });
  document.getElementById("studioProfileSaveButton")?.addEventListener("click", saveProfileEditor);
  document.querySelectorAll(".studio-nav button[data-section]").forEach(button => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      setActiveSection(button.dataset.section);
    });
  });
  document.querySelectorAll("[data-section-jump]").forEach(button => {
    button.addEventListener("click", () => setActiveSection(button.dataset.sectionJump));
  });
  ["studioModalClose", "studioModalCancel"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", closeStudioModal);
  });
  document.getElementById("studioModal")?.addEventListener("click", event => {
    if (event.target === event.currentTarget) closeStudioModal();
  });
  document.getElementById("studioModalConfirm")?.addEventListener("click", () => {
    if (typeof studioModalConfirmHandler === "function") {
      studioModalConfirmHandler();
    } else {
      closeStudioModal();
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeStudioModal();
  });
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-profile-artist]");
    if (!button) return;
    const select = document.getElementById("studioProfileArtistSelect");
    if (select) select.value = button.getAttribute("data-profile-artist");
    fillProfileEditor(selectedProfileItem());
    document.getElementById("studioProfileArtistSelect")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  document.addEventListener("click", event => {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    if (action === "tone") {
      openTonePreview();
    } else if (action === "settlement-request") {
      openSettlementRequestModal();
    } else if (action === "settlement-conversion") {
      openSettlementConversionModal();
    } else if (action === "toast") {
      showToast(actionButton.textContent.trim() + " 기능은 다음 연결 단계에서 활성화합니다.");
    }
  });

  // #409 — 자료 URL 등록 이벤트
  document.getElementById("knowledgeUrlSubmit")?.addEventListener("click", submitKnowledgeUrl);
  document.getElementById("knowledgeUrlReset")?.addEventListener("click", () => {
    const urlInput = document.getElementById("knowledgeUrlInput");
    const descEl = document.getElementById("knowledgeUrlDesc");
    if (urlInput) urlInput.value = "";
    if (descEl) descEl.value = "";
    setKnowledgeUrlState("URL과 설명을 입력한 뒤 등록하면 관리자 검토 대기 상태로 접수됩니다.", "");
  });
  document.getElementById("knowledgeUrlRefresh")?.addEventListener("click", loadKnowledgeUrls);
  document.getElementById("knowledgeUrlArtistSelect")?.addEventListener("change", loadKnowledgeUrls);

  const initialSection = location.hash.replace("#", "");
  if (initialSection) setActiveSection(initialSection);

  async function verify() {
    const handoff = readStudioHandoff();
    if (handoff) {
      allow(handoff);
      return;
    }

    openStudioShellPending();
    let completed = false;
    const softTimeoutId = setTimeout(() => {
      if (!completed && body) {
        body.textContent = "권한 확인 응답을 기다리고 있습니다. 계속 멈춰 있으면 아래 다시 확인을 눌러 주세요.";
        showGateActions();
      }
    }, 4000);
    const hardTimeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        showToast("Studio verification is still loading. The workspace is open while we check again.");
      }
    }, 8000);
    const auth = readAuth();
    if (!auth?.accessToken && !auth?.refreshToken) {
      completed = true;
      clearTimeout(hardTimeoutId);
      deny("로그인 후 승인된 크리에이터 계정으로만 접근할 수 있습니다.");
      return;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      let res = await fetchStudioBootstrap(auth.accessToken, controller.signal);
      if (res.status === 401) {
        const refreshed = await refreshStudioAuthOnce();
        if (refreshed?.accessToken) {
          res = await fetchStudioBootstrap(refreshed.accessToken, controller.signal);
        }
      }
      if (!res.ok) {
        if (res.status === 401) {
          deny("Login session expired. Please sign in again.");
        } else {
          showToast("Studio verification could not finish. The workspace is open while we check again.");
        }
        return;
      }
      const data = await res.json();
      if (data?.access?.enabled === true) {
        completed = true;
        clearTimeout(hardTimeoutId);
        allow(data);
        return;
      }
      // #190 — access.enabled !== true 면 fail-closed (이전엔 toast만 보이고 shell이 열려 권한 우회됨)
      completed = true;
      clearTimeout(hardTimeoutId);
      deny("스튜디오 접근 권한이 없어요. 운영팀 승인 후 다시 시도해 주세요.");
      return;
    } catch (error) {
      completed = true;
      clearTimeout(hardTimeoutId);
      // #190 — 에러 시에도 fail-closed (이전엔 toast만 보이고 shell이 열려 권한 우회됨)
      deny(error?.name === "AbortError"
        ? "스튜디오 권한 확인이 지연됐어요. 잠시 후 다시 시도해 주세요."
        : "스튜디오 권한 확인에 실패했어요. 다시 시도해 주세요.");
    } finally {
      completed = true;
      clearTimeout(softTimeoutId);
      clearTimeout(timeoutId);
      clearTimeout(hardTimeoutId);
    }
  }

  verify();
})();
