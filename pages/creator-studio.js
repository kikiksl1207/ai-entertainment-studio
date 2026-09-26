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
  let storyIntakeRequestKey = null;
  let writerFileRead = 0;
  let writerCatalogRequest = 0;
  const writerMaxBytes = 16 * 1024 * 1024;
  const writerMaxManifestBytes = 128 * 1024;
  let writerParts = [];
  let writerBoundariesReviewed = false;
  let writerReview = null;
  let writerFeedback = null;
  let writerSubmitting = false;
  let writerSubmitted = false;
  let writerReceipt = null;
  let studioAuthMarker = null;
  let studioAuthEpoch = 0;
  let artistIdentityResponse = null;
  let artistIdentityBusy = false;
  let artistIdentityRequestEpoch = 0;

  const artistIdentityCopy = {
    ko: {
      title: "스토리 이미지 정체성", artist: "대상 아티스트", unset: "설정 전", review: "검토 필요", approved: "적용 완료",
      select: "기준 이미지를 1~8장 선택해 주세요.", noImages: "분석할 공개 이미지가 없습니다.", analyze: "선택 이미지 분석", open: "설정 검토",
      analyzing: "이미지를 분석하고 있습니다.", loading: "설정을 불러오고 있습니다.", ready: "분석 결과를 확인해 주세요.", saved: "임시 저장했습니다.",
      failed: "분석 또는 저장을 완료하지 못했습니다.", count: "선택 {count}/8", modalTitle: "아티스트 이미지 기준 검토",
      modalIntro: "고정할 외형과 스토리에 맞게 바꿀 요소를 확인해 주세요.", close: "닫기", later: "나중에", save: "임시 저장", approve: "확인 후 적용",
      fixed_identity: "항상 유지할 외형", adaptable_presentation: "스토리별 변형 범위", accept: "맞음", edit: "수정해서 사용", evidence: "판단 근거",
      summary: "요약", faceTraits: "얼굴 특징", hairTraits: "머리 특징", bodySilhouette: "체형·실루엣", distinctiveMarks: "고유 표식", basePalette: "기본 색상",
      mutableAttributes: "바꿀 수 있는 요소", forbiddenChanges: "바꾸면 안 되는 요소", storyAdaptationRule: "스토리 적용 규칙"
    },
    en: {
      title: "Story visual identity", artist: "Artist", unset: "Not set", review: "Review required", approved: "Applied",
      select: "Select 1-8 reference images.", noImages: "No public images are available for analysis.", analyze: "Analyze images", open: "Review settings",
      analyzing: "Analyzing images.", loading: "Loading settings.", ready: "Review the analysis result.", saved: "Draft saved.", failed: "Analysis or save could not be completed.",
      count: "Selected {count}/8", modalTitle: "Review artist image rules", modalIntro: "Confirm fixed identity and story-specific adaptations.", close: "Close", later: "Later", save: "Save draft", approve: "Apply after review",
      fixed_identity: "Fixed appearance", adaptable_presentation: "Story adaptations", accept: "Correct", edit: "Edit", evidence: "Evidence",
      summary: "Summary", faceTraits: "Face", hairTraits: "Hair", bodySilhouette: "Body silhouette", distinctiveMarks: "Distinctive marks", basePalette: "Base palette",
      mutableAttributes: "Mutable attributes", forbiddenChanges: "Forbidden changes", storyAdaptationRule: "Story adaptation rule"
    },
    ja: {
      title: "ストーリー画像アイデンティティ", artist: "対象アーティスト", unset: "未設定", review: "確認が必要", approved: "適用済み",
      select: "基準画像を1〜8枚選択してください。", noImages: "分析できる公開画像がありません。", analyze: "画像を分析", open: "設定を確認",
      analyzing: "画像を分析しています。", loading: "設定を読み込んでいます。", ready: "分析結果を確認してください。", saved: "下書きを保存しました。", failed: "分析または保存を完了できませんでした。",
      count: "選択 {count}/8", modalTitle: "アーティスト画像基準の確認", modalIntro: "固定する外見とストーリー別の変更範囲を確認してください。", close: "閉じる", later: "後で", save: "下書き保存", approve: "確認して適用",
      fixed_identity: "常に維持する外見", adaptable_presentation: "ストーリー別の変更範囲", accept: "正しい", edit: "修正", evidence: "判断根拠",
      summary: "要約", faceTraits: "顔の特徴", hairTraits: "髪の特徴", bodySilhouette: "体型・シルエット", distinctiveMarks: "固有の特徴", basePalette: "基本色",
      mutableAttributes: "変更可能な要素", forbiddenChanges: "変更禁止の要素", storyAdaptationRule: "ストーリー適用ルール"
    },
    "zh-Hans": {
      title: "故事视觉身份", artist: "目标艺人", unset: "未设置", review: "需要审核", approved: "已应用",
      select: "请选择1至8张参考图。", noImages: "没有可供分析的公开图片。", analyze: "分析图片", open: "审核设置",
      analyzing: "正在分析图片。", loading: "正在加载设置。", ready: "请审核分析结果。", saved: "草稿已保存。", failed: "未能完成分析或保存。",
      count: "已选 {count}/8", modalTitle: "审核艺人图像规则", modalIntro: "确认固定外观和故事适配范围。", close: "关闭", later: "稍后", save: "保存草稿", approve: "审核后应用",
      fixed_identity: "固定外观", adaptable_presentation: "故事适配范围", accept: "正确", edit: "修改", evidence: "判断依据",
      summary: "摘要", faceTraits: "面部特征", hairTraits: "发型特征", bodySilhouette: "体型轮廓", distinctiveMarks: "独特标记", basePalette: "基础配色",
      mutableAttributes: "可变元素", forbiddenChanges: "禁止变更", storyAdaptationRule: "故事适配规则"
    },
    "zh-Hant": {
      title: "故事視覺身份", artist: "目標藝人", unset: "未設定", review: "需要審核", approved: "已套用",
      select: "請選擇1至8張參考圖。", noImages: "沒有可供分析的公開圖片。", analyze: "分析圖片", open: "審核設定",
      analyzing: "正在分析圖片。", loading: "正在載入設定。", ready: "請審核分析結果。", saved: "草稿已儲存。", failed: "未能完成分析或儲存。",
      count: "已選 {count}/8", modalTitle: "審核藝人圖像規則", modalIntro: "確認固定外觀和故事適配範圍。", close: "關閉", later: "稍後", save: "儲存草稿", approve: "審核後套用",
      fixed_identity: "固定外觀", adaptable_presentation: "故事適配範圍", accept: "正確", edit: "修改", evidence: "判斷依據",
      summary: "摘要", faceTraits: "臉部特徵", hairTraits: "髮型特徵", bodySilhouette: "體型輪廓", distinctiveMarks: "獨特標記", basePalette: "基礎配色",
      mutableAttributes: "可變元素", forbiddenChanges: "禁止變更", storyAdaptationRule: "故事適配規則"
    }
  };

  const storyIntakeFileRules = {
    manuscripts: { maxCount: 10, maxBytes: 50 * 1024 * 1024, extensions: new Set([".md", ".txt", ".docx", ".pdf", ".json"]) },
    metadata: { maxCount: 10, maxBytes: 10 * 1024 * 1024, extensions: new Set([".json", ".csv"]) },
    visuals: { maxCount: 20, maxBytes: 25 * 1024 * 1024, extensions: new Set([".jpg", ".jpeg", ".png", ".webp"]) }
  };

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
      if (auth) {
        localStorage.setItem(authKey, JSON.stringify(auth));
      } else {
        authStorageKeys.forEach(key => localStorage.removeItem(key));
      }
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

  function sameStudioAuth(left, right) {
    return Boolean(left && right && left.accessToken === right.accessToken && left.refreshToken === right.refreshToken &&
      (left.user?.id || left.user?.email) === (right.user?.id || right.user?.email));
  }

  function studioIdentity() {
    const auth = readAuth();
    if (!sameStudioAuth(studioAuthMarker, auth)) studioAuthEpoch++;
    studioAuthMarker = auth;
    return { ownerId: auth?.user?.id || auth?.user?.email || null, epoch: studioAuthEpoch };
  }

  function currentStudioIdentity(identity) {
    const current = studioIdentity();
    return Boolean(identity?.ownerId && current.ownerId === identity.ownerId && current.epoch === identity.epoch);
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
      const hasFullBootstrap = Array.isArray(handoff.data?.artists);
      return recent && hasToken && sameUser && hasFullBootstrap && handoff.data?.access?.enabled === true ? handoff.data : null;
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
      if (!sameStudioAuth(auth, readAuth())) return null;
      if (!res.ok) {
        writeAuth(null);
        return null;
      }
      const data = await res.json().catch(() => null);
      if (!sameStudioAuth(auth, readAuth())) return null;
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
      if ((nextAuth.user?.id || nextAuth.user?.email) !== (auth.user?.id || auth.user?.email)) return null;
      writeAuth(nextAuth);
      studioAuthMarker = nextAuth;
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
    if (options.identity && !currentStudioIdentity(options.identity)) throw new DOMException("Context changed", "AbortError");
    let auth = readAuth();
    if (!options.token && !auth?.accessToken && auth?.refreshToken) {
      auth = await refreshStudioAuthOnce();
    }
    if (options.identity && !currentStudioIdentity(options.identity)) throw new DOMException("Context changed", "AbortError");
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
    if (options.identity && !currentStudioIdentity(options.identity)) throw new DOMException("Context changed", "AbortError");
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

  window.LuminaCreatorStudioApi = {
    fetch: fetchCreatorStudioApi,
    currentUser: () => readAuth()?.user || null,
    identity: studioIdentity,
    isCurrent: currentStudioIdentity
  };

  window.LuminaCreatorManuscript = {
    receipt: () => writerReceipt,
    context: () => ({ workId: document.getElementById("writerManuscriptWork")?.value || "",
      sourceLocale: document.getElementById("writerManuscriptLocale")?.value || "ko" })
  };

  async function fetchStoryIntake(formData, idempotencyKey, options = {}) {
    let auth = readAuth();
    if (!options.token && !auth?.accessToken && auth?.refreshToken) {
      auth = await refreshStudioAuthOnce();
    }
    const token = options.token || auth?.accessToken;
    const headers = { "Idempotency-Key": idempotencyKey };
    if (token) headers.Authorization = "Bearer " + token;
    let res = await fetch(apiBase + "/api/v1/story-upload/intake", {
      method: "POST",
      headers,
      body: formData
    });
    if (res.status === 401 && !options._retried) {
      const refreshed = await refreshStudioAuthOnce();
      if (refreshed?.accessToken) {
        res = await fetchStoryIntake(formData, idempotencyKey, {
          ...options,
          token: refreshed.accessToken,
          _retried: true
        });
      }
    }
    return res;
  }

  async function fetchWriterPaste(workId, formData, options = {}) {
    if (!currentStudioIdentity(options.identity)) return null;
    let auth = readAuth();
    if (!options.token && !auth?.accessToken && auth?.refreshToken) auth = await refreshStudioAuthOnce();
    if (!currentStudioIdentity(options.identity)) return null;
    const token = options.token || auth?.accessToken;
    if (!token) return null;
    const res = await fetch(apiBase + "/api/v1/me/creator-studio/stories/" + encodeURIComponent(workId) + "/manuscripts/paste", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: formData
    });
    if (!currentStudioIdentity(options.identity)) return null;
    if (res.status === 401 && !options._retried) {
      const refreshed = await refreshStudioAuthOnce();
      if (refreshed?.accessToken) return fetchWriterPaste(workId, formData, { ...options, token: refreshed.accessToken, _retried: true });
    }
    return res;
  }

  function authEmail() {
    const user = readAuth()?.user || {};
    return user.email || user.displayName || user.id || "";
  }

  function setGateChecking() {
    const email = authEmail();
    if (kicker) kicker.textContent = "권한 확인 중";
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
    if (kicker) kicker.textContent = "접근 확인 필요";
    if (title) title.textContent = "스튜디오 접근 권한이 필요합니다.";
    if (body) body.textContent = message || "승인된 크리에이터 계정만 스튜디오 스테이지에 들어올 수 있습니다.";
    showGateActions();
    markStudioReady();
  }

  window.addEventListener("error", function () {
    // #460 — "배포 파일을 확인해야 합니다" 개발 투명 문구 → 서비스 톤으로 교체
    deny("스튜디오 화면을 불러오는 중 문제가 생겼어요. 새로고침 후에도 계속되면 고객센터에 문의해 주세요.");
  });

  window.addEventListener("unhandledrejection", function () {
    deny("스튜디오 권한 확인 중 오류가 발생했습니다. 새로고침 후에도 반복되면 로그인 상태를 확인해 주세요.");
  });

  function allow(data) {
    if (gate) gate.hidden = true;
    if (shell) shell.hidden = false;
    const email = data?.viewer?.email || readAuth()?.user?.email;
    // #362 — sidebar 접속 계정 projection 으로 채우기. 실패/로딩 시 "로그인한 크리에이터" fallback.
    const account = document.getElementById("studioAccountEmail") || document.querySelector(".studio-account strong");
    if (account) account.textContent = email || "로그인한 크리에이터";
    const roleEl = document.getElementById("studioAccountRole");
    const roleLabel = {
      personal_creator: "개인 크리에이터",
      studio_operator: "스튜디오 운영자",
      admin_operator: "운영 관리자"
    }[data?.access?.type] || "승인된 계정";
    if (roleEl) roleEl.textContent = roleLabel;
    markStudioReady();
    hydrateStudio(data);
    loadWalletBalance();
    loadSettlementPreview();
    loadPayoutSummary();
    loadSettlementConversions();
    loadKnowledgeUrls();
    if (document.getElementById("writer-manuscript")?.classList.contains("is-active")) loadWriterWorks();
  }

  function openStudioShellPending() {
    if (gate) gate.hidden = false;
    if (shell) shell.hidden = true;
    setGateChecking();
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

  function formatKnownKrw(value) {
    return value == null || !Number.isFinite(Number(value)) ? "조회 불가" : formatKrw(value);
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
    if (sectionId === "writer-manuscript" && !shell?.hidden) loadWriterWorks();
    if (sectionId === "content-rights" && !shell?.hidden) window.LuminaCreatorContentRights?.load?.();
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
    const usedSlots = summary.usedSlots ?? slotPolicy.usedSlots;
    const slotLimit = summary.slotLimit ?? slotPolicy.initialSlotLimit;
    const activeCount = summary.activeArtistCount;
    const openImageRequests = summary.openImageRequestCount;

    text("studioMetricArtists", formatNumber(summary.ownedArtistCount ?? artists.length) + "명");
    text("studioMetricArtistsSub", Number.isFinite(Number(activeCount)) && activeCount !== undefined
      ? "활동 " + formatNumber(activeCount) + "명" : "활동 상태 집계 없음");
    text("studioSlotText", Number.isFinite(Number(usedSlots)) && Number.isFinite(Number(slotLimit)) && usedSlots != null && slotLimit != null
      ? formatNumber(usedSlots) + " / " + formatNumber(slotLimit) + " 사용" : "조회 불가");
    const slotBar = document.querySelector("#studioSlotBar span");
    if (slotBar && Number(slotLimit) > 0 && usedSlots != null) slotBar.style.width = Math.min(100, Math.max(0, Number(usedSlots) / Number(slotLimit) * 100)) + "%";
    document.getElementById("studioSlotBar")?.setAttribute("aria-label", document.getElementById("studioSlotText")?.textContent || "운영 슬롯 조회 불가");

    if (openImageRequests == null || !Number.isFinite(Number(openImageRequests))) {
      text("studioAttentionTitle", "운영 항목 조회 불가");
      text("studioAttentionBody", "현재 확인할 일의 전체 집계는 제공되지 않습니다.");
    } else if (Number(openImageRequests) > 0) {
      text("studioAttentionTitle", "열린 이미지 요청 " + formatNumber(openImageRequests) + "건");
      text("studioAttentionBody", "이미지 요청 상태를 확인해 주세요. 다른 운영 항목은 이 화면에 집계되지 않습니다.");
    } else {
      text("studioAttentionTitle", "열린 이미지 요청 없음");
      text("studioAttentionBody", "다른 운영 항목은 이 화면에 집계되지 않습니다.");
    }

    renderArtists(artists);
    renderMedia(artists);
    populateProfileEditor(artists);
    populateArtistIdentityEditor(artists);
    populateKnowledgeUrlArtistSelect(artists);
  }

  function renderArtists(artists) {
    const cardRoot = document.getElementById("studioArtistCards");
    const rowRoot = document.getElementById("studioArtistRows");
    if (!artists.length) {
      if (cardRoot) cardRoot.innerHTML = '<p class="studio-form-state">이 계정에 연결된 아티스트가 없습니다.</p>';
      if (rowRoot) rowRoot.innerHTML = '<tr><td colspan="3">연결된 아티스트가 없습니다.</td></tr>';
      return;
    }

    if (cardRoot) {
      cardRoot.innerHTML = artists.map(item => {
        const artist = item.artist || item;
        const status = artistStatusLabel(artist.status);
        const summary = artist.publicProfile?.tagline || artist.publicProfile?.summary || "프로필을 보완해 주세요.";
        const badgeClass = artist.status === "active" ? "is-good" : artist.status === "paused" ? "is-warn" : "";
        return '<article class="artist-card">' +
          '<img class="artist-thumb" src="' + escapeHtml(artistImage(artist)) + '" alt="' + escapeHtml(artistName(item)) + '" />' +
          '<div><h3>' + escapeHtml(artistName(item)) + '</h3><p>' + escapeHtml(summary) + '</p><div class="badge-row"><span class="badge ' + badgeClass + '">' + escapeHtml(status) + '</span></div></div>' +
          '<button class="secondary-action" type="button" data-profile-artist="' + escapeHtml(artistId(item)) + '">관리</button>' +
        '</article>';
      }).join("");
    }

    if (rowRoot) {
      rowRoot.innerHTML = artists.map(item => {
        const artist = item.artist || item;
        const status = artistStatusLabel(artist.status);
        const openRequests = item?.imageRequests?.open;
        return "<tr><td>" + escapeHtml(artistName(item)) + "</td><td><span class=\"badge\">" + escapeHtml(status) + "</span></td><td>" + (openRequests == null ? "조회 불가" : formatNumber(openRequests) + "건") + "</td></tr>";
      }).join("");
    }
  }

  function renderMedia(artists) {
    const root = document.getElementById("studioMediaGrid");
    if (!root) return;
    const assets = artists.flatMap(item => {
      const artist = item.artist || item;
      return (Array.isArray(artist.assets) ? artist.assets : [])
        .filter(asset => asset.assetType === "image" && asset.url)
        .map(asset => ({ asset, name: artistName(item) }));
    });
    root.innerHTML = assets.length ? assets.map(({ asset, name }) =>
      '<article class="media-tile"><img src="' + escapeHtml(asset.url) + '" alt="' + escapeHtml(name) + '" /><footer><span>' + escapeHtml(name) + '</span><span>' + escapeHtml(asset.usageType || "이미지") + '</span></footer></article>'
    ).join("") : '<p class="studio-form-state">이 계정에서 확인할 수 있는 공개 이미지가 없습니다.</p>';
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
    if (!select) return;
    const available = artists.length > 0;
    select.disabled = !available;
    document.querySelectorAll("#artists .form-grid input, #artists .form-grid textarea").forEach(field => { field.disabled = !available; });
    ["studioProfileSaveButton", "studioProfileResetButton"].forEach(id => {
      const button = document.getElementById(id);
      if (button) button.disabled = !available;
    });
    if (!available) {
      select.innerHTML = '<option value="">연결된 아티스트 없음</option>';
      setProfileState("등록된 아티스트가 없습니다.", "");
      return;
    }
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

  function artistIdentityLocale() {
    const locale = window.luminaI18n?.getLocale?.() || window.luminaI18n?.getRegionalLocale?.() || document.documentElement.lang || "ko";
    const normalized = String(locale).replace("_", "-").toLowerCase();
    if (normalized.startsWith("zh-hant") || normalized.includes("tw") || normalized.includes("hk")) return "zh-Hant";
    if (normalized.startsWith("zh")) return "zh-Hans";
    if (normalized.startsWith("ja")) return "ja";
    if (normalized.startsWith("en")) return "en";
    return "ko";
  }

  function ait(key, values = {}) {
    let value = artistIdentityCopy[artistIdentityLocale()]?.[key] || artistIdentityCopy.ko[key] || key;
    Object.entries(values).forEach(([name, replacement]) => { value = value.replace(`{${name}}`, String(replacement)); });
    return value;
  }

  function selectedArtistIdentityItem() {
    const id = document.getElementById("artistIdentityArtistSelect")?.value;
    return studioArtists.find(item => artistId(item) === id) || studioArtists[0] || null;
  }

  function populateArtistIdentityEditor(artists) {
    const select = document.getElementById("artistIdentityArtistSelect");
    if (!select) return;
    select.innerHTML = artists.map(item => `<option value="${escapeHtml(artistId(item))}">${escapeHtml(artistName(item))}</option>`).join("");
    applyArtistIdentityCopy();
    loadArtistIdentityProfile();
  }

  function applyArtistIdentityCopy() {
    text("artistIdentityPanelTitle", ait("title"));
    text("artistIdentityArtistLabel", ait("artist"));
    text("artistIdentityAnalyze", ait("analyze"));
    text("artistIdentityReview", ait("open"));
    text("artistIdentityModalTitle", ait("modalTitle"));
    text("artistIdentityModalIntro", ait("modalIntro"));
    text("artistIdentityClose", ait("close"));
    text("artistIdentityLater", ait("later"));
    text("artistIdentitySave", ait("save"));
    text("artistIdentityApprove", ait("approve"));
    if (artistIdentityResponse) renderArtistIdentityStatus();
    if (!document.getElementById("artistIdentityModal")?.classList.contains("is-hidden")) renderArtistIdentitySections();
  }

  function validArtistIdentityProfileResponse(value, id) {
    if (!value || value.artistId !== id) return false;
    if (value.profile === null) return value.setupRequired === true;
    const profile = value.profile;
    const settings = profile.status === "approved" ? profile.approvedSettings : profile.draftSettings;
    return /^[0-9a-f-]{36}$/i.test(profile.id || "") && /^[a-f0-9]{64}$/i.test(profile.sourceFingerprint || "") &&
      Array.isArray(profile.referenceAssetIds) && profile.referenceAssetIds.length >= 1 && profile.referenceAssetIds.length <= 8 &&
      settings?.schemaVersion === "creator-generation-profile-v1" && settings?.kind === "artist" &&
      Array.isArray(settings.sections) && ["fixed_identity", "adaptable_presentation"].every(key => settings.sections.some(section => section?.key === key));
  }

  async function artistIdentityRequest(id, suffix = "", options = {}) {
    const token = readAuth()?.accessToken;
    if (!token) throw new Error("auth");
    const response = await fetch(`${apiBase}/api/v1/me/creator-studio/artists/${encodeURIComponent(id)}/story-identity-profile${suffix}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
    const value = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(value?.message || value?.code || "request failed");
      error.status = response.status;
      error.code = value?.code || value?.error?.code;
      throw error;
    }
    return value;
  }

  function renderArtistIdentityAssets(selectedIds = null) {
    const root = document.getElementById("artistIdentityAssets");
    const item = selectedArtistIdentityItem();
    const assets = Array.isArray(item?.artist?.assets) ? item.artist.assets.filter(asset => asset.assetType === "image" && asset.url).slice(0, 24) : [];
    if (!root) return;
    if (!assets.length) {
      root.replaceChildren();
      text("artistIdentityState", ait("noImages"));
      document.getElementById("artistIdentityAnalyze").disabled = true;
      return;
    }
    const selected = new Set(selectedIds || assets.filter(asset => asset.isPrimary).map(asset => asset.id));
    if (!selected.size) assets.slice(0, Math.min(3, assets.length)).forEach(asset => selected.add(asset.id));
    root.innerHTML = assets.map(asset => `
      <label class="artist-identity-asset">
        <input type="checkbox" value="${escapeHtml(asset.id)}" ${selected.has(asset.id) ? "checked" : ""} />
        <img src="${escapeHtml(asset.url)}" alt="" loading="lazy" />
        <span>${escapeHtml(asset.usageType || "image")}</span>
      </label>`).join("");
    root.querySelectorAll("input").forEach(input => input.addEventListener("change", () => {
      const checked = [...root.querySelectorAll("input:checked")];
      if (checked.length > 8) input.checked = false;
      text("artistIdentityState", ait("count", { count: root.querySelectorAll("input:checked").length }));
      document.getElementById("artistIdentityAnalyze").disabled = root.querySelectorAll("input:checked").length < 1 || artistIdentityBusy;
    }));
    text("artistIdentityState", ait("count", { count: root.querySelectorAll("input:checked").length }));
    document.getElementById("artistIdentityAnalyze").disabled = false;
  }

  function selectedArtistIdentityAssetIds() {
    return [...document.querySelectorAll("#artistIdentityAssets input:checked")].map(input => input.value).slice(0, 8);
  }

  function renderArtistIdentityStatus() {
    const profile = artistIdentityResponse?.profile;
    const approved = profile?.status === "approved";
    text("artistIdentityBadge", approved ? ait("approved") : profile ? ait("review") : ait("unset"));
    text("artistIdentityState", approved ? ait("approved") : profile ? ait("ready") : ait("select"));
    const review = document.getElementById("artistIdentityReview");
    if (review) review.disabled = !profile || artistIdentityBusy;
  }

  async function loadArtistIdentityProfile() {
    const item = selectedArtistIdentityItem();
    const id = artistId(item);
    const requestEpoch = ++artistIdentityRequestEpoch;
    artistIdentityResponse = null;
    renderArtistIdentityAssets();
    if (!id) return;
    artistIdentityBusy = true;
    text("artistIdentityState", ait("loading"));
    try {
      const value = await artistIdentityRequest(id);
      if (requestEpoch !== artistIdentityRequestEpoch || !validArtistIdentityProfileResponse(value, id)) return;
      artistIdentityResponse = value;
      renderArtistIdentityAssets(value.profile?.referenceAssetIds || null);
      renderArtistIdentityStatus();
    } catch (_) {
      if (requestEpoch === artistIdentityRequestEpoch) text("artistIdentityState", ait("failed"));
    } finally {
      if (requestEpoch === artistIdentityRequestEpoch) {
        artistIdentityBusy = false;
        const count = selectedArtistIdentityAssetIds().length;
        document.getElementById("artistIdentityAnalyze").disabled = count < 1;
        document.getElementById("artistIdentityReview").disabled = !artistIdentityResponse?.profile;
      }
    }
  }

  async function analyzeArtistIdentity() {
    const id = artistId(selectedArtistIdentityItem());
    const referenceAssetIds = selectedArtistIdentityAssetIds();
    if (!id || !referenceAssetIds.length || artistIdentityBusy) return;
    artistIdentityBusy = true;
    document.getElementById("artistIdentityAnalyze").disabled = true;
    document.getElementById("artistIdentityReview").disabled = true;
    text("artistIdentityState", ait("analyzing"));
    try {
      const value = await artistIdentityRequest(id, "/draft", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ referenceAssetIds })
      });
      if (!validArtistIdentityProfileResponse(value, id)) throw new Error("projection");
      artistIdentityResponse = value;
      renderArtistIdentityStatus();
      openArtistIdentityModal();
    } catch (_) {
      text("artistIdentityState", ait("failed"));
    } finally {
      artistIdentityBusy = false;
      document.getElementById("artistIdentityAnalyze").disabled = selectedArtistIdentityAssetIds().length < 1;
      document.getElementById("artistIdentityReview").disabled = !artistIdentityResponse?.profile;
    }
  }

  function activeArtistIdentitySettings() {
    const profile = artistIdentityResponse?.profile;
    return profile?.status === "approved" ? profile.approvedSettings : profile?.draftSettings;
  }

  function openArtistIdentityModal() {
    if (!activeArtistIdentitySettings()) return;
    applyArtistIdentityCopy();
    renderArtistIdentitySections();
    document.getElementById("artistIdentityModal")?.classList.remove("is-hidden");
    document.body.style.overflow = "hidden";
    document.getElementById("artistIdentityClose")?.focus();
  }

  function closeArtistIdentityModal() {
    document.getElementById("artistIdentityModal")?.classList.add("is-hidden");
    if (!document.querySelector(".studio-modal:not(.is-hidden)")) document.body.style.overflow = "";
  }

  function artistIdentityFieldNames(key) {
    return key === "fixed_identity"
      ? ["summary", "faceTraits", "hairTraits", "bodySilhouette", "distinctiveMarks", "basePalette"]
      : ["summary", "mutableAttributes", "forbiddenChanges", "storyAdaptationRule"];
  }

  function renderArtistIdentitySections() {
    const settings = activeArtistIdentitySettings();
    const root = document.getElementById("artistIdentitySections");
    if (!settings || !root) return;
    const approved = artistIdentityResponse.profile.status === "approved";
    root.replaceChildren(...["fixed_identity", "adaptable_presentation"].map(key => {
      const section = settings.sections.find(item => item.key === key);
      const article = document.createElement("article"); article.className = "writer-generation-section"; article.dataset.key = key;
      const header = document.createElement("header");
      const heading = document.createElement("h3"); heading.textContent = ait(key);
      const state = document.createElement("p"); state.textContent = section.decision === "edited" ? ait("edit") : section.decision === "accepted" ? ait("accept") : ait("review");
      header.append(heading, state); article.append(header);
      artistIdentityFieldNames(key).forEach(field => {
        const label = document.createElement("label");
        const name = document.createElement("span"); name.textContent = ait(field);
        const textarea = document.createElement("textarea"); textarea.dataset.field = field; textarea.disabled = approved; textarea.maxLength = 8000;
        const value = section.value?.[field]; textarea.value = Array.isArray(value) ? value.join("\n") : String(value || "");
        textarea.addEventListener("input", () => selectArtistIdentityDecision(article, section, "edited"));
        label.append(name, textarea); article.append(label);
      });
      const controls = document.createElement("div"); controls.className = "writer-generation-decisions";
      [["accepted", "accept"], ["edited", "edit"]].forEach(([decision, label]) => {
        const button = document.createElement("button"); button.type = "button"; button.className = "secondary-action"; button.textContent = ait(label); button.disabled = approved;
        button.classList.toggle("is-selected", section.decision === decision);
        button.addEventListener("click", () => selectArtistIdentityDecision(article, section, decision));
        controls.append(button);
      });
      const details = document.createElement("details"); details.className = "writer-generation-evidence";
      const summary = document.createElement("summary"); summary.textContent = ait("evidence");
      const list = document.createElement("ul"); (section.evidence || []).forEach(evidence => { const li = document.createElement("li"); li.textContent = evidence.summary || evidence.sourceRef; list.append(li); });
      details.append(summary, list); article.append(controls, details); return article;
    }));
    text("artistIdentityModalStatus", approved ? ait("approved") : ait("ready"));
    document.getElementById("artistIdentitySave").disabled = approved;
    document.getElementById("artistIdentityApprove").disabled = approved;
  }

  function selectArtistIdentityDecision(article, section, decision) {
    if (artistIdentityResponse?.profile?.status === "approved") return;
    section.decision = decision;
    article.querySelectorAll(".writer-generation-decisions button").forEach((button, index) => button.classList.toggle("is-selected", ["accepted", "edited"][index] === decision));
    article.querySelector("header p").textContent = ait(decision === "edited" ? "edit" : "accept");
  }

  function collectArtistIdentitySettings() {
    const settings = structuredClone(activeArtistIdentitySettings());
    settings.sections.forEach(section => {
      const article = document.querySelector(`#artistIdentitySections [data-key="${section.key}"]`);
      artistIdentityFieldNames(section.key).forEach(field => {
        const value = article?.querySelector(`[data-field="${field}"]`)?.value.trim() || "";
        section.value[field] = Array.isArray(section.value[field]) ? value.split("\n").map(item => item.trim()).filter(Boolean) : value;
      });
      section.decision = activeArtistIdentitySettings().sections.find(item => item.key === section.key).decision;
    });
    return settings;
  }

  async function saveArtistIdentity(approve) {
    const id = artistId(selectedArtistIdentityItem());
    const profile = artistIdentityResponse?.profile;
    if (!id || !profile || profile.status === "approved" || artistIdentityBusy) return;
    artistIdentityBusy = true;
    document.getElementById("artistIdentitySave").disabled = true;
    document.getElementById("artistIdentityApprove").disabled = true;
    text("artistIdentityModalStatus", ait("loading"));
    try {
      let value = await artistIdentityRequest(id, "", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceAssetIds: profile.referenceAssetIds, settings: collectArtistIdentitySettings() })
      });
      if (!validArtistIdentityProfileResponse(value, id)) throw new Error("projection");
      artistIdentityResponse = value;
      if (approve) {
        value = await artistIdentityRequest(id, "/approve", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedDraftFingerprint: value.profile.draftFingerprint })
        });
        if (!validArtistIdentityProfileResponse(value, id) || value.profile.status !== "approved") throw new Error("approval");
        artistIdentityResponse = value;
      }
      renderArtistIdentityStatus(); renderArtistIdentitySections();
      text("artistIdentityModalStatus", approve ? ait("approved") : ait("saved"));
    } catch (_) {
      text("artistIdentityModalStatus", ait("failed"));
    } finally {
      artistIdentityBusy = false;
      const approved = artistIdentityResponse?.profile?.status === "approved";
      document.getElementById("artistIdentitySave").disabled = approved;
      document.getElementById("artistIdentityApprove").disabled = approved;
    }
  }

  async function loadSettlementPreview() {
    const identity = studioIdentity();
    try {
      const res = await fetchCreatorStudioApi("/api/v1/me/creator-studio/settlement-preview?period=" + currentPeriod(), { identity });
      if (!currentStudioIdentity(identity)) return;
      if (!res.ok) throw new Error("preview unavailable");
      const data = await res.json();
      if (!currentStudioIdentity(identity)) return;
      renderSettlement(data);
    } catch (_) {
      if (!currentStudioIdentity(identity)) return;
      text("studioMetricSettlement", "조회 불가");
      text("studioMetricSettlementSub", "예상 정산액을 불러오지 못했습니다.");
      document.getElementById("studioSettlementRows").innerHTML = '<tr><td colspan="6">예상 정산 내역을 불러오지 못했습니다.</td></tr>';
      document.getElementById("studioRevenueRows").innerHTML = '<tr><td colspan="5">수익원별 집계를 불러오지 못했습니다.</td></tr>';
    }
  }

  async function loadWalletBalance() {
    const identity = studioIdentity();
    try {
      const res = await fetchCreatorStudioApi("/api/v1/wallet", { identity });
      if (!currentStudioIdentity(identity)) return;
      if (!res.ok) throw new Error("wallet unavailable");
      const wallet = await res.json();
      if (!currentStudioIdentity(identity)) return;
      const balance = wallet?.cachedBalance;
      if (balance == null || !Number.isFinite(Number(balance))) throw new Error("balance unavailable");
      text("studioMetricLumina", formatNumber(balance) + "L");
      text("studioMetricLuminaSub", "현재 지갑 잔액");
    } catch (_) {
      if (!currentStudioIdentity(identity)) return;
      text("studioMetricLumina", "조회 불가");
      text("studioMetricLuminaSub", "지갑 잔액을 불러오지 못했습니다.");
    }
  }

  async function loadPayoutSummary() {
    const identity = studioIdentity();
    try {
      const res = await fetchCreatorStudioApi("/api/v1/me/creator-studio/payout-summary?period=" + currentPeriod(), { identity });
      if (!currentStudioIdentity(identity)) return;
      if (!res.ok) throw new Error("payout unavailable");
      const data = await res.json();
      if (currentStudioIdentity(identity)) renderPayoutBreakdown(data);
    } catch (_) {
      if (!currentStudioIdentity(identity)) return;
      text("studioPayoutSampleBadge", "조회 불가");
      const note = document.getElementById("studioPayoutSampleNote");
      if (note) note.textContent = "정산 요약을 불러오지 못했습니다.";
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
      requested: "요청됨 · 승인 필요",
      approved: "승인됨 · 지갑 반영 대기",
      credited: "지갑 반영 완료",
      rejected: "반려",
      canceled: "취소"
    };
    return labels[status] || "상태 확인 불가";
  }

  function renderSettlementConversions(items = []) {
    const rows = document.getElementById("studioSettlementConversionRows");
    const state = document.getElementById("studioSettlementConversionState");
    if (!rows) return;
    if (!items.length) {
      rows.innerHTML = '<tr><td colspan="5">아직 접수된 정산금 충전 신청이 없습니다.</td></tr>';
      if (state) state.textContent = "정산금 충전 신청은 요청됨 상태로 접수되며 승인 후에만 지갑에 반영됩니다.";
      return;
    }
    rows.innerHTML = items.map(item => {
      const amount = item.amountKrw;
      const lumina = item.requestedLumina;
      return "<tr><td>" + escapeHtml(item.settlementKey || "-") + "</td><td>" + (amount == null ? "-" : formatKrw(amount)) + "</td><td>" + (lumina == null ? "-" : formatNumber(lumina) + "L") + "</td><td><span class=\"badge is-warn\">" + escapeHtml(item.status ? conversionStatusLabel(item.status) : "상태 확인 불가") + "</span></td><td>" + escapeHtml(item.note || "-") + "</td></tr>";
    }).join("");
    if (state) state.textContent = "표시된 신청은 요청됨/승인 필요 흐름입니다. 승인 전 지갑 잔액은 늘어나지 않습니다.";
  }

  function renderSettlement(data) {
    settlementPreview = data || null;
    const total = data?.totals?.creatorShareKrw;
    text("studioMetricSettlement", total != null && Number.isFinite(Number(total)) ? formatKrw(total) : "조회 불가");
    text("studioMetricSettlementSub", total != null && Number.isFinite(Number(total))
      ? "환불·세무 검토 전 예상치" : "예상 정산액이 제공되지 않았습니다.");
    const conversionButton = document.querySelector('[data-action="settlement-conversion"]');
    if (conversionButton) conversionButton.disabled = settlementOptions().length === 0;
    const rows = document.getElementById("studioSettlementRows");
    if (rows && Array.isArray(data?.items) && data.items.length) {
      rows.innerHTML = [
        "<tr><td>전체 합산</td><td>" + formatNumber(data.items.length) + "명 합산</td><td>" + formatKnownKrw(data.totals?.grossRevenueKrw) + "</td><td>" + formatKnownKrw(data.totals?.riskReserveKrw) + "</td><td class=\"money\">" + formatKnownKrw(data.totals?.creatorShareKrw) + "</td><td><span class=\"badge is-warn\">예상치</span></td></tr>",
        ...data.items.map(item => {
          const name = item?.artist?.displayName || item?.artist?.slug || "아티스트";
          return "<tr><td>캐릭터별</td><td>" + escapeHtml(name) + "</td><td>" + formatKnownKrw(item?.financials?.grossRevenueKrw) + "</td><td>" + formatKnownKrw(item?.financials?.riskReserveKrw) + "</td><td class=\"money\">" + formatKnownKrw(item?.financials?.creatorShareKrw) + "</td><td><span class=\"badge\">예상</span></td></tr>";
        })
      ].join("");
    } else if (rows) {
      rows.innerHTML = '<tr><td colspan="6">해당 기간 예상 정산 내역이 없습니다.</td></tr>';
    }

    const revenueRows = document.getElementById("studioRevenueRows");
    const breakdown = aggregateBreakdown(data?.items || []);
    if (revenueRows && breakdown.length) {
      revenueRows.innerHTML = breakdown.map(item => "<tr><td>" + escapeHtml(item.label) + "</td><td>" + formatNumber(item.eventCount) + "</td><td>" + formatNumber(item.grossLumina) + "L</td><td>" + formatKrw(item.grossRevenueKrw) + "</td><td>완료 건만 포함</td></tr>").join("");
    } else if (revenueRows) {
      revenueRows.innerHTML = '<tr><td colspan="5">해당 기간 수익원별 집계가 없습니다.</td></tr>';
    }
  }

  function renderPayoutBreakdown(data) {
    const card = document.getElementById("studioPayoutBreakdown");
    if (!card || !data?.totals) return;
    if (data.policy?.hidePayoutRow === true) {
      text("studioPayoutSampleBadge", "표시 대상 없음");
      const note = document.getElementById("studioPayoutSampleNote");
      if (note) note.textContent = "이 계정에는 표시 가능한 정산 요약이 없습니다.";
      return;
    }
    const totals = data.totals;
    const values = {
      studioPayoutGrossLumina: totals.grossLumina,
      studioPayoutEligibleLumina: totals.eligibleLumina,
      studioPayoutGrossKrw: totals.grossAmount?.amount,
      studioPayoutTaxKrw: totals.taxAmount?.amount,
      studioPayoutNetKrw: totals.netAmount?.amount
    };
    const hasAmounts = Object.values(values).some(value => value != null && Number.isFinite(Number(value)));
    if (!hasAmounts) {
      const note = document.getElementById("studioPayoutSampleNote");
      if (note) note.textContent = "표시 가능한 예상 정산 금액이 없습니다.";
      return;
    }
    card.classList.remove("is-payout-sample");
    card.dataset.payoutState = "estimate";
    text("studioPayoutSampleBadge", "예상치");
    card.querySelectorAll("[data-payout-sample]").forEach(el => {
      el.dataset.payoutSample = "false";
      el.removeAttribute("aria-label");
    });
    for (const [id, value] of Object.entries(values)) {
      if (value != null && Number.isFinite(Number(value))) {
        text(id, id.endsWith("Lumina") ? formatNumber(value) + "L" : formatKrw(value));
      }
    }
    text("studioPayoutCurrencyLabel", totals.currency || data.currency || "통화 정보 없음");
    text("studioPayoutFxLabel", data.fxSnapshot?.snapshotStatus === "krw_base_no_fx" ? "KRW 기준 · 환전 없음" : "환율 정보 없음");
    const note = document.getElementById("studioPayoutSampleNote");
    if (note) note.textContent = "조회된 금액은 예상치이며 최종 정산액이 아닙니다.";
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
    // #547 — processing: "AI 처리 중"으로 명확화. pending/rejected/archived 라벨 유지.
    return { pending: "승인 대기", approved: "승인됨", rejected: "반려", archived: "보관", processing: "AI 처리 중" }[status] || "승인 대기";
  }

  function knowledgeUrlStatusClass(status) {
    // #837 — processing: 파랑(is-processing), archived: 회색(is-archived) 추가.
    return { pending: "is-warn", approved: "is-good", rejected: "is-error", archived: "is-archived", processing: "is-processing" }[status] || "is-warn";
  }

  function knowledgeUrlTypeLabel(type) {
    return { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", blog: "블로그", notice: "공지", other: "기타" }[type] || "기타";
  }

  function populateKnowledgeUrlArtistSelect(artists) {
    const select = document.getElementById("knowledgeUrlArtistSelect");
    if (!select) return;
    if (!artists.length) {
      select.innerHTML = '<option value="">운영 아티스트 연결 대기 중</option>';
      return;
    }
    select.innerHTML = artists.map(item => '<option value="' + escapeHtml(artistId(item)) + '">' + escapeHtml(artistName(item)) + '</option>').join("");
  }

  function canSubmitKnowledgeUrl() {
    return studioArtists.some(item => Boolean(artistId(item)));
  }

  function syncKnowledgeUrlAvailability() {
    if (canSubmitKnowledgeUrl()) return false;
    setKnowledgeSubmitLocked(true);
    // #440 — 아티스트 미연결은 사용자 오류가 아니라 계정 준비 단계. danger 대신 중립 톤.
    setKnowledgeUrlState("운영 아티스트 연결이 완료되면 자료 URL을 등록할 수 있어요. 계정 승인 상태는 유지됩니다.", "");
    return true;
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
      // #440 — 반려·보관 항목은 "승인 대기"가 아닌 실제 상태에 맞는 문구로 안내.
      // #547 — processing(AI 처리 중) 상태도 구분. 반려 사유는 tooltip으로 표시.
      const isRejectedOrArchived = item.status === "rejected" || item.status === "archived";
      const isProcessing = item.status === "processing";
      const chatLabel = !allowRef ? "미허용"
        : (item.status === "approved" ? "참고 가능"
        : isRejectedOrArchived ? "참고 불가"
        : isProcessing ? "처리 중"
        : "승인 대기");
      const chatClass = !allowRef ? ""
        : (item.status === "approved" ? "is-good"
        : isRejectedOrArchived ? "is-error"
        : isProcessing ? "is-warn"
        : "is-warn");
      const statusLabel = knowledgeUrlStatusLabel(item.status || "pending");
      const statusClass = knowledgeUrlStatusClass(item.status || "pending");
      const typeLabel = knowledgeUrlTypeLabel(item.type || "other");
      const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }) : "-";
      // 반려 사유(rejectReason)가 있으면 상태 배지 tooltip으로 표시
      const rejectReason = escapeHtml(item.rejectReason || item.adminNote || "");
      const statusBadgeAttr = rejectReason ? (' title="' + rejectReason + '"') : "";
      return "<tr>" +
        "<td><span class=\"badge\">" + escapeHtml(typeLabel) + "</span></td>" +
        "<td><a class=\"knowledge-url-link\" href=\"" + escapeHtml(rawUrl || "#") + "\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"" + escapeHtml(rawUrl) + "\">" + escapeHtml(urlTrunc || "-") + "</a></td>" +
        "<td>" + escapeHtml(descTrunc || "-") + "</td>" +
        "<td><span class=\"badge " + escapeHtml(chatClass) + "\">" + escapeHtml(chatLabel) + "</span></td>" +
        "<td><span class=\"badge " + escapeHtml(statusClass) + "\"" + statusBadgeAttr + ">" + escapeHtml(statusLabel) + "</span></td>" +
        "<td>" + escapeHtml(dateStr) + "</td>" +
      "</tr>";
    }).join("");
  }

  async function loadKnowledgeUrls() {
    const auth = readAuth();
    const rows = document.getElementById("knowledgeUrlRows");
    if ((!auth?.accessToken && !auth?.refreshToken) || !rows) return;
    if (syncKnowledgeUrlAvailability()) {
      rows.innerHTML = '<tr><td colspan="6">운영 아티스트 연결 후 등록 자료 목록을 확인할 수 있어요.</td></tr>';
      return;
    }
    rows.innerHTML = '<tr><td colspan="6">자료 URL 목록을 불러오는 중입니다.</td></tr>';
    try {
      const params = new URLSearchParams();
      const artistSel = document.getElementById("knowledgeUrlArtistSelect");
      if (artistSel?.value) params.set("artistId", artistSel.value);
      const res = await fetchCreatorStudioApi("/api/v1/me/creator-studio/knowledge-urls?" + params);
      // #460 — API 미개방(404/501)과 권한 없음(403) 구분
      if (res.status === 403) {
        rows.innerHTML = '<tr><td colspan="6">이 기능 사용 권한이 없어요. 운영팀 안내 후 이용할 수 있습니다.</td></tr>';
        setKnowledgeSubmitLocked(true);
        setKnowledgeUrlState("이 기능 사용 권한이 없어요. 운영팀 안내 후 이용할 수 있습니다.", "");
        return;
      }
      if (res.status === 404 || res.status === 501) {
        // #464 — "폼 구성은 미리 확인할 수 있습니다" 개발 투명 문구 제거
        rows.innerHTML = '<tr><td colspan="6">자료 URL 등록 기능은 운영팀 안내 후 이용할 수 있어요.</td></tr>';
        setKnowledgeSubmitLocked(true);
        // #440 — 기능 미개방은 사용자 오류가 아니므로 danger 대신 중립 톤.
        setKnowledgeUrlState("자료 URL 등록 기능은 운영팀 안내 후 이용할 수 있어요.", "");
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

    if (!selectedArtistId) {
      setKnowledgeUrlState("운영 아티스트 연결이 완료되면 자료 URL을 등록할 수 있어요.", "danger");
      artistSel?.focus();
      return;
    }
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
      // #460 — API 미개방(404/501)과 권한 없음(403) 구분
      if (res.status === 403) {
        setKnowledgeUrlState("이 기능 사용 권한이 없어요. 운영팀 안내 후 이용할 수 있습니다.", "");
        return;
      }
      if (res.status === 404 || res.status === 501) {
        // #440 — 기능 미개방은 사용자 오류가 아니므로 danger 대신 중립 톤.
        setKnowledgeUrlState("자료 URL 등록 기능은 운영팀 안내 후 이용할 수 있어요.", "");
        return;
      }
      if (!res.ok) {
        setKnowledgeUrlState("등록에 실패했습니다. 잠시 후 다시 시도해주세요.", "danger");
        return;
      }
      // #464 — "승인 대기 상태로 전환됩니다" 흐름 오류 수정: 제출 즉시 승인 대기 상태, 이후 검토 완료 시 목록 상태 변경
      setKnowledgeUrlState("등록 신청이 접수되었습니다. 목록에서 검토 상태를 확인할 수 있어요.", "good");
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

  // The paste route stores the exact UTF-8 source only after explicit review and confirmation.
  function writerText(key, values = {}) {
    const fullKey = "writerManuscript." + key;
    const translated = window.luminaI18n?.t?.(fullKey);
    const template = translated && translated !== fullKey ? translated : fullKey;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  }

  function writerState(key, tone, values) {
    const state = document.getElementById("writerManuscriptState");
    if (!state) return;
    state.textContent = writerText(key, values);
    state.classList.toggle("is-danger", tone === "danger");
  }

  function writerWellFormed(value) {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = value.charCodeAt(++i);
        if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
      } else if (code >= 0xdc00 && code <= 0xdfff) return false;
    }
    return true;
  }

  function writerInput() {
    const workId = document.getElementById("writerManuscriptWork")?.value || "";
    const locale = document.getElementById("writerManuscriptLocale")?.value || "";
    const body = document.getElementById("writerManuscriptBody")?.value || "";
    const expectedRaw = document.getElementById("writerManuscriptExpected")?.value || "";
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(workId)) return { error: "chooseWork" };
    if (!["ko", "en", "ja", "zh-Hans", "zh-Hant"].includes(locale)) return { error: "reviewRequired" };
    if (!body.trim()) return { error: "empty" };
    if (body.includes("\0") || !writerWellFormed(body)) return { error: "invalidUnicode" };
    const bytes = new TextEncoder().encode(body);
    if (bytes.byteLength > writerMaxBytes) return { error: "tooLarge" };
    if (writerParts.length < 1 || writerParts.length > 1000 ||
        (expectedRaw && (!Number.isInteger(Number(expectedRaw)) || Number(expectedRaw) < 1 ||
          Number(expectedRaw) > 1000 || Number(expectedRaw) !== writerParts.length))) {
      return { error: "partMismatch", values: { count: writerParts.length, expected: expectedRaw } };
    }
    const parts = [];
    for (let index = 0; index < writerParts.length; index++) {
      const { offset: start, title } = writerParts[index];
      const end = writerParts[index + 1]?.offset ?? body.length;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
          start !== (parts[index - 1]?.end ?? 0) || end <= start || end > body.length ||
          (start > 0 && body[start - 1] === "\r" && body[start] === "\n") ||
          (start > 0 && body.charCodeAt(start - 1) >= 0xd800 && body.charCodeAt(start - 1) <= 0xdbff)) {
        return { error: "invalidBoundary" };
      }
      if (!title.trim() || title.length > 240 || !body.slice(start, end).trim()) return { error: "partIncomplete" };
      if (title.includes("\0") || !writerWellFormed(title)) return { error: "invalidUnicode" };
      parts.push({ partKey: "part-" + (index + 1), title, start, end });
    }
    const manifest = { locale, confirmed: true, parts };
    if (new TextEncoder().encode(JSON.stringify(manifest)).byteLength > writerMaxManifestBytes) {
      return { error: "tooLarge" };
    }
    return { workId, locale, body, expectedRaw, bytes, manifest };
  }

  function writerMatchesReview(review) {
    if (!review || !writerBoundariesReviewed || review !== writerReview) return false;
    if (!currentStudioIdentity(review.identity)) return false;
    const current = writerInput();
    return !current.error && current.workId === review.workId && current.locale === review.locale &&
      current.body === review.body && current.expectedRaw === review.expectedRaw &&
      JSON.stringify(current.manifest) === JSON.stringify(review.manifest);
  }

  function syncWriterSubmit() {
    const confirm = document.getElementById("writerManuscriptConfirm");
    const submit = document.getElementById("writerManuscriptSubmit");
    const auth = readAuth();
    if (confirm) confirm.disabled = writerSubmitting || !writerReview || !writerBoundariesReviewed || writerSubmitted;
    if (submit) submit.disabled = writerSubmitting || writerSubmitted || !confirm?.checked ||
      !writerMatchesReview(writerReview) || shell?.hidden || !(auth?.accessToken || auth?.refreshToken);
  }

  function invalidateWriterReview(clearReceipt = true) {
    if (clearReceipt) {
      writerReceipt = null;
      window.LuminaCreatorAnalysis?.invalidate?.();
    }
    writerBoundariesReviewed = false;
    writerReview = null;
    writerFeedback = null;
    writerSubmitted = false;
    const confirm = document.getElementById("writerManuscriptConfirm");
    if (confirm) { confirm.checked = false; confirm.disabled = true; }
    syncWriterSubmit();
  }

  function setWriterSubmitting(value) {
    writerSubmitting = value;
    const controls = document.querySelectorAll("#writer-manuscript input, #writer-manuscript select, #writer-manuscript textarea, #writer-manuscript button");
    controls.forEach(control => {
      if (value) {
        control.dataset.writerWasDisabled = control.disabled ? "true" : "false";
        control.disabled = true;
      } else {
        control.disabled = control.dataset.writerWasDisabled === "true";
        delete control.dataset.writerWasDisabled;
      }
    });
    syncWriterSubmit();
  }

  function writerSourceChanged() {
    const body = document.getElementById("writerManuscriptBody")?.value || "";
    const work = document.getElementById("writerManuscriptWork")?.value;
    const boundary = document.getElementById("writerManuscriptBoundary");
    if (boundary) boundary.hidden = !body;
    if (!work) return writerState("chooseWork", "danger");
    if (!body) return writerState("empty", "");
    const bytes = new TextEncoder().encode(body).byteLength;
    if (bytes > writerMaxBytes) return writerState("tooLarge", "danger");
    const lines = body.split(/\r\n|\n|\r/).length;
    const expected = document.getElementById("writerManuscriptExpected")?.value;
    if (expected && Number(expected) !== writerParts.length) {
      return writerState("partMismatch", "danger", { count: writerParts.length, expected });
    }
    if (writerFeedback) return writerState(writerFeedback.key, writerFeedback.tone, writerFeedback.values);
    writerState(writerBoundariesReviewed ? "boundariesReviewed" : "localReview", "", {
      bytes: bytes.toLocaleString(), lines: lines.toLocaleString(), count: writerParts.length
    });
  }

  function renderWriterParts() {
    const root = document.getElementById("writerManuscriptParts");
    const body = document.getElementById("writerManuscriptBody");
    if (!root || !body) return;
    root.replaceChildren();
    writerParts.forEach((part, index) => {
      const end = writerParts[index + 1]?.offset ?? body.value.length;
      const section = document.createElement("div");
      section.className = "writer-manuscript-part";
      const header = document.createElement("div");
      header.className = "writer-manuscript-part-header";
      const label = document.createElement("strong");
      label.textContent = writerText("partNumber", { number: index + 1 });
      const view = document.createElement("button");
      view.type = "button";
      view.className = "secondary-action";
      view.textContent = writerText("viewPart");
      view.addEventListener("click", () => {
        body.focus();
        body.setSelectionRange(part.offset, end);
      });
      header.append(label, view);
      if (index > 0) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "secondary-action";
        remove.textContent = writerText("removePart");
        remove.addEventListener("click", () => {
          writerParts.splice(index, 1);
          invalidateWriterReview();
          renderWriterParts();
          writerSourceChanged();
        });
        header.append(remove);
      }
      const title = document.createElement("label");
      title.className = "writer-manuscript-part-title";
      const titleLabel = document.createElement("span");
      titleLabel.textContent = writerText("partTitle");
      const input = document.createElement("input");
      input.maxLength = 240;
      input.value = part.title;
      input.addEventListener("input", () => {
        part.title = input.value;
        invalidateWriterReview();
        writerSourceChanged();
      });
      title.append(titleLabel, input);
      const preview = document.createElement("pre");
      preview.className = "writer-manuscript-part-preview";
      const excerpt = body.value.slice(part.offset, Math.min(end, part.offset + 300));
      preview.textContent = excerpt + (end - part.offset > 300 ? "…" : "");
      section.append(header, title, preview);
      root.append(section);
    });
  }

  function writerBodyEdited() {
    ++writerFileRead;
    const value = document.getElementById("writerManuscriptBody")?.value || "";
    if (!value) writerParts = [];
    else if (!writerParts.length) writerParts = [{ offset: 0, title: "" }];
    invalidateWriterReview();
    renderWriterParts();
    writerSourceChanged();
  }

  function addWriterPart() {
    const body = document.getElementById("writerManuscriptBody");
    const offset = body?.selectionStart ?? 0;
    const value = body?.value || "";
    if (!value || offset <= 0 || offset >= value.length || writerParts.length >= 1000 ||
        writerParts.some(part => part.offset === offset) ||
        (value.charCodeAt(offset - 1) >= 0xd800 && value.charCodeAt(offset - 1) <= 0xdbff) ||
        (value[offset - 1] === "\r" && value[offset] === "\n")) {
      return writerState("invalidBoundary", "danger");
    }
    writerParts.push({ offset, title: "" });
    writerParts.sort((a, b) => a.offset - b.offset);
    invalidateWriterReview();
    renderWriterParts();
    writerSourceChanged();
  }

  function reviewWriterParts() {
    if (writerSubmitting) return;
    const review = writerInput();
    if (review.error) return writerState(review.error, "danger", review.values);
    writerReview = review;
    writerReview.identity = studioIdentity();
    writerBoundariesReviewed = true;
    syncWriterSubmit();
    writerSourceChanged();
  }

  async function submitWriterManuscript() {
    const confirm = document.getElementById("writerManuscriptConfirm");
    const review = writerReview;
    if (writerSubmitting || writerSubmitted) return;
    if (!confirm?.checked || !writerMatchesReview(review)) {
      writerState("reviewRequired", "danger");
      syncWriterSubmit();
      return;
    }
    if (shell?.hidden) return writerState("authRequired", "danger");
    const formData = new FormData();
    formData.append("manuscript", new Blob([review.bytes], { type: "text/plain" }), "manuscript.txt");
    formData.append("manifest", JSON.stringify(review.manifest));
    setWriterSubmitting(true);
    writerFeedback = { key: "submitting", tone: "" };
    writerSourceChanged();
    try {
      const response = await fetchWriterPaste(review.workId, formData, { identity: review.identity });
      if (!writerMatchesReview(review)) return;
      if (!response) {
        writerFeedback = { key: "authRequired", tone: "danger" };
      } else if (!response.ok) {
        writerFeedback = response.status === 401
          ? { key: "authRequired", tone: "danger" }
          : { key: "rejected", tone: "danger", values: { status: response.status } };
      } else {
        const receipt = await response.json().catch(() => null);
        if (!writerMatchesReview(review)) return;
        if (receipt?.manuscript?.workId !== review.workId || receipt.manuscript.locale !== review.locale ||
            !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(receipt.manuscript.id || "") ||
            !/^[0-9a-f]{64}$/i.test(receipt.manuscript.contentHash || "") ||
            !Number.isSafeInteger(receipt.manuscript.version) || receipt.manuscript.version < 1 ||
            receipt?.received?.sourceKind !== "utf8_paste" ||
            receipt.received.byteLength !== review.bytes.byteLength ||
            receipt.received.parts !== review.manifest.parts.length ||
            receipt.analysisStarted !== false || typeof receipt.idempotentReplay !== "boolean") {
          writerFeedback = { key: "invalidReceipt", tone: "danger" };
        } else {
          writerReceipt = Object.freeze({ id: receipt.manuscript.id, workId: review.workId,
            sourceLocale: review.locale, version: receipt.manuscript.version,
            contentHash: receipt.manuscript.contentHash, identity: review.identity });
          writerSubmitted = true;
          confirm.checked = false;
          writerFeedback = {
            key: receipt.idempotentReplay ? "receivedReplay" : "received",
            tone: "",
            values: { version: receipt.manuscript.version, count: receipt.received.parts,
              bytes: receipt.received.byteLength.toLocaleString() }
          };
          window.LuminaCreatorAnalysis?.receive?.(writerReceipt);
        }
      }
    } catch (_) {
      if (writerMatchesReview(review)) writerFeedback = { key: "requestFailed", tone: "danger" };
    } finally {
      setWriterSubmitting(false);
      if (writerMatchesReview(review)) writerSourceChanged();
    }
  }

  async function loadWriterWorks() {
    const select = document.getElementById("writerManuscriptWork");
    if (!select || writerSubmitting) return;
    invalidateWriterReview(false);
    const request = ++writerCatalogRequest;
    const identity = studioIdentity();
    const previous = select.value;
    select.disabled = true;
    select.replaceChildren(new Option(writerText("loading"), ""));
    writerState("loading", "");
    try {
      const works = [];
      const seen = new Set();
      let cursor = null;
      do {
        const params = new URLSearchParams({ locale: document.getElementById("writerManuscriptLocale")?.value || "ko", limit: "30" });
        if (cursor) params.set("cursor", cursor);
        const response = await fetchCreatorStudioApi("/api/v1/me/creator-studio/stories?" + params, { identity });
        if (!response.ok) throw new Error("catalog");
        const page = await response.json();
        if (!Array.isArray(page?.items)) throw new Error("catalog");
        works.push(...page.items.filter(item => item?.permissions?.createManuscript === true && item.workId));
        cursor = page.nextCursor || null;
        if (cursor && seen.has(cursor)) throw new Error("catalog");
        if (cursor) seen.add(cursor);
        if (works.length > 1000) throw new Error("catalog");
      } while (cursor);
      if (request !== writerCatalogRequest || !currentStudioIdentity(identity)) return;
      select.replaceChildren(new Option(writerText("chooseWork"), ""));
      works.forEach(item => select.add(new Option(item.title?.value || item.slug || item.workId, item.workId)));
      select.disabled = !works.length;
      if (works.some(item => item.workId === previous)) select.value = previous;
      writerState(works.length ? "chooseWork" : "noWorks", works.length ? "" : "danger");
      if (select.value) writerSourceChanged();
      window.LuminaCreatorAnalysis?.contextChanged?.();
    } catch (_) {
      if (request !== writerCatalogRequest || !currentStudioIdentity(identity)) return;
      select.replaceChildren(new Option(writerText("catalogFailed"), ""));
      writerState("catalogFailed", "danger");
    }
  }

  async function readWriterTextFile() {
    const file = document.getElementById("writerManuscriptFile")?.files?.[0];
    const body = document.getElementById("writerManuscriptBody");
    const request = ++writerFileRead;
    if (!file || !body) return;
    invalidateWriterReview();
    if (!/\.(txt|md)$/i.test(file.name)) return writerState("fileType", "danger");
    if (!file.size || file.size > writerMaxBytes) return writerState("tooLarge", "danger");
    try {
      const bytes = await file.arrayBuffer();
      if (request !== writerFileRead) return;
      const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      if (!content) return writerState("empty", "danger");
      body.value = content;
      if (body.value !== content) {
        body.value = "";
        writerBodyEdited();
        return writerState("lineEndings", "danger");
      }
      writerParts = [];
      writerBodyEdited();
    } catch (_) {
      writerState("invalidUtf8", "danger");
    }
  }

  function clearWriterManuscript() {
    ++writerFileRead;
    const file = document.getElementById("writerManuscriptFile");
    const body = document.getElementById("writerManuscriptBody");
    if (file) file.value = "";
    if (body) body.value = "";
    writerBodyEdited();
  }

  // ── #1831 — 라이브 원고 접수 (검토용 multipart intake) ────────────────

  function storyIntakeText(key, values = {}) {
    const fullKey = "storyIntake." + key;
    const translated = window.luminaI18n?.t?.(fullKey);
    const template = translated && translated !== fullKey ? translated : fullKey;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  }

  function setStoryIntakeState(messageKey, tone, values) {
    const el = document.getElementById("storyIntakeFormState");
    if (!el) return;
    el.textContent = storyIntakeText(messageKey, values);
    el.classList.toggle("is-good", tone === "good");
    el.classList.toggle("is-danger", tone === "danger");
  }

  function setStoryIntakeSubmitting(submitting) {
    const button = document.getElementById("storyIntakeSubmit");
    if (!button) return;
    button.disabled = submitting;
    button.setAttribute("aria-disabled", submitting ? "true" : "false");
    button.textContent = storyIntakeText(submitting ? "submit.pending" : "submit");
    document.querySelectorAll("#storyIntakeForm input, #storyIntakeForm select, #storyIntakeReset").forEach(control => {
      if (control !== button) control.disabled = submitting;
    });
  }

  function syncStoryIntakeRightsField() {
    const source = document.getElementById("storyIntakeSourceClass");
    const field = document.getElementById("storyIntakeRightsField");
    const input = document.getElementById("storyIntakeRightsReference");
    const required = source?.value === "licensed_ip";
    if (field) field.hidden = !required;
    if (input) input.required = required;
  }

  function storyIntakeFiles(name) {
    return Array.from(document.getElementById("storyIntake" + name)?.files || []);
  }

  function storyIntakeExtension(file) {
    const name = String(file?.name || "");
    const dot = name.lastIndexOf(".");
    return dot >= 0 ? name.slice(dot).toLowerCase() : "";
  }

  function validateStoryIntakeFiles(groups) {
    let totalCount = 0;
    let totalBytes = 0;
    for (const [field, files] of Object.entries(groups)) {
      const rule = storyIntakeFileRules[field];
      totalCount += files.length;
      if (files.length > rule.maxCount) return { key: "state.files.tooMany" };
      for (const file of files) {
        totalBytes += Number(file.size || 0);
        if (!rule.extensions.has(storyIntakeExtension(file))) return { key: "state.files.type" };
        if (file.size < 1 || file.size > rule.maxBytes) return { key: "state.files.size" };
      }
    }
    if (totalCount > 40 || totalBytes > 150 * 1024 * 1024) return { key: "state.files.total" };
    return null;
  }

  function createStoryIntakeRequestKey() {
    if (globalThis.crypto?.randomUUID) return "story-intake-" + globalThis.crypto.randomUUID();
    return "story-intake-" + Date.now() + "-" + Math.random().toString(36).slice(2, 12);
  }

  function formatStoryIntakeReceivedAt(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return storyIntakeText("receipt.receivedAt.unknown");
    const locale = window.luminaI18n?.getRegionalLocale?.() || document.documentElement.lang || "ko-KR";
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function renderStoryIntakeReceipt(receipt) {
    const root = document.getElementById("storyIntakeReceipt");
    if (!root) return;
    const fileCount = Number(receipt?.fileCount || 0);
    text("storyIntakeReceiptStatus", storyIntakeText("receipt.status.received"));
    text("storyIntakeReceiptFiles", storyIntakeText("receipt.files.value", { count: fileCount }));
    text("storyIntakeReceiptReceivedAt", formatStoryIntakeReceivedAt(receipt?.receivedAt));
    root.hidden = false;
  }

  function clearStoryIntake() {
    document.getElementById("storyIntakeForm")?.reset();
    storyIntakeRequestKey = null;
    syncStoryIntakeRightsField();
    setStoryIntakeState("state.idle", "");
  }

  async function submitStoryIntake(event) {
    event.preventDefault();
    const titleInput = document.getElementById("storyIntakeTitle");
    const localeSelect = document.getElementById("storyIntakeLocale");
    const sourceSelect = document.getElementById("storyIntakeSourceClass");
    const rightsInput = document.getElementById("storyIntakeRightsReference");
    const title = titleInput?.value.trim() || "";
    const originalLocale = localeSelect?.value || "ko";
    const sourceClass = sourceSelect?.value || "original";
    const rightsReference = rightsInput?.value.trim() || "";
    const groups = {
      manuscripts: storyIntakeFiles("Manuscripts"),
      metadata: storyIntakeFiles("Metadata"),
      visuals: storyIntakeFiles("Visuals")
    };

    if (!title) {
      setStoryIntakeState("state.titleRequired", "danger");
      titleInput?.focus();
      return;
    }
    if (!groups.manuscripts.length) {
      setStoryIntakeState("state.manuscriptRequired", "danger");
      document.getElementById("storyIntakeManuscripts")?.focus();
      return;
    }
    if (sourceClass === "licensed_ip" && !rightsReference) {
      setStoryIntakeState("state.rightsRequired", "danger");
      rightsInput?.focus();
      return;
    }
    const fileError = validateStoryIntakeFiles(groups);
    if (fileError) {
      setStoryIntakeState(fileError.key, "danger");
      return;
    }
    const auth = readAuth();
    if (!auth?.accessToken && !auth?.refreshToken) {
      setStoryIntakeState("state.authRequired", "danger");
      return;
    }

    const formData = new FormData();
    formData.append("title", title);
    formData.append("originalLocale", originalLocale);
    formData.append("sourceClass", sourceClass);
    formData.append("submissionType", "final");
    if (rightsReference) formData.append("rightsReference", rightsReference);
    Object.entries(groups).forEach(([field, files]) => {
      files.forEach(file => formData.append(field, file));
    });
    storyIntakeRequestKey ||= createStoryIntakeRequestKey();
    setStoryIntakeSubmitting(true);
    setStoryIntakeState("state.submitting", "");

    try {
      const res = await fetchStoryIntake(formData, storyIntakeRequestKey);
      if (res.status === 401) {
        setStoryIntakeState("state.authRequired", "danger");
        return;
      }
      if (res.status === 403) {
        setStoryIntakeState("state.forbidden", "");
        return;
      }
      if (res.status === 413) {
        setStoryIntakeState("state.files.total", "danger");
        return;
      }
      if (res.status === 409) {
        setStoryIntakeState("state.conflict", "danger");
        return;
      }
      if (!res.ok) {
        setStoryIntakeState("state.failed", "danger");
        return;
      }
      const receipt = await res.json().catch(() => null);
      if (receipt?.status !== "received") {
        setStoryIntakeState("state.failed", "danger");
        return;
      }
      renderStoryIntakeReceipt(receipt);
      setStoryIntakeState("state.received", "good");
      storyIntakeRequestKey = null;
      document.getElementById("storyIntakeForm")?.reset();
      syncStoryIntakeRightsField();
    } catch (_) {
      setStoryIntakeState("state.network", "danger");
    } finally {
      setStoryIntakeSubmitting(false);
    }
  }

  // ── #545 — AI 프리미엄 콘텐츠 요청 상태 UI skeleton ──────────────────────
  // 8개 처리 상태: submitted / preparing / generating / reviewing /
  //                ready / info_needed / failed / rejected
  // provider not configured → 404/501 fail-closed (기능 미개방 중립 안내)

  function aiContentRequestStatusLabel(status) {
    return ({
      submitted:   "요청 접수",
      preparing:   "생성 준비",
      generating:  "생성 중",
      reviewing:   "검수 중",
      ready:       "준비 완료",
      info_needed: "추가 정보 필요",
      failed:      "실패",
      rejected:    "반려"
    })[status] || "상태 확인 불가";
  }

  function aiContentRequestStatusClass(status) {
    return ({
      submitted:   "is-warn",
      preparing:   "is-warn",
      generating:  "is-warn",
      reviewing:   "is-warn",
      ready:       "is-good",
      info_needed: "is-error",
      failed:      "is-danger",
      rejected:    "is-error"
    })[status] || "is-warn";
  }

  function renderAiContentRequests(items) {
    const rows = document.getElementById("studioImageRequestRows");
    if (!rows) return;
    if (!items.length) {
      rows.innerHTML = '<tr><td colspan="6">이미지 요청 이력이 없습니다.</td></tr>';
      return;
    }
    rows.innerHTML = items.map(item => {
      const reqId = escapeHtml(item.requestId || item.id || "-");
      const artistDisplay = escapeHtml(item.artistName || item.artist?.displayName || item.artist?.slug || "-");
      const purpose = escapeHtml(item.purpose || item.usagePurpose || "-");
      const method = escapeHtml(item.method || "-");
      const status = String(item.status || "");
      const statusLabel = aiContentRequestStatusLabel(status);
      const statusClass = aiContentRequestStatusClass(status);
      // info_needed/rejected 에는 admin note를 tooltip으로 표시
      const adminNote = escapeHtml(item.adminNote || item.memo || item.rejectReason || "");
      const badgeTitle = adminNote ? (' title="' + adminNote + '"') : "";
      return "<tr>" +
        "<td>" + reqId + "</td>" +
        "<td>" + artistDisplay + "</td>" +
        "<td>" + purpose + "</td>" +
        "<td>" + method + "</td>" +
        "<td><span class=\"badge " + statusClass + "\"" + badgeTitle + ">" + escapeHtml(statusLabel) + "</span></td>" +
        "<td>" + (adminNote || "-") + "</td>" +
      "</tr>";
    }).join("");
  }

  async function loadAiContentRequests() {
    const auth = readAuth();
    const rows = document.getElementById("studioImageRequestRows");
    if (!rows) return;
    if (!auth?.accessToken && !auth?.refreshToken) {
      rows.innerHTML = '<tr><td colspan="6">로그인 정보가 없어요. 다시 로그인해주세요.</td></tr>';
      return;
    }
    rows.innerHTML = '<tr><td colspan="6">요청 이력을 불러오는 중입니다.</td></tr>';
    try {
      const res = await fetchCreatorStudioApi("/api/v1/me/creator-studio/ai-content-requests");
      // #545 — 404/501 = provider 미연결·기능 미개방. fail-closed, 사용자 오류 아님.
      if (res.status === 404 || res.status === 501) {
        rows.innerHTML = '<tr><td colspan="6">이미지 요청 기능은 운영팀 안내 후 이용할 수 있어요.</td></tr>';
        return;
      }
      if (res.status === 403) {
        rows.innerHTML = '<tr><td colspan="6">이 기능 사용 권한이 없어요. 운영팀 안내 후 이용할 수 있습니다.</td></tr>';
        return;
      }
      if (!res.ok) throw new Error("load failed");
      const data = await res.json().catch(() => null);
      const items = Array.isArray(data) ? data : (data?.items || data?.requests || []);
      renderAiContentRequests(items);
    } catch (_) {
      if (rows) rows.innerHTML = '<tr><td colspan="6">이력을 불러오지 못했습니다. 잠시 후 다시 확인해주세요.</td></tr>';
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
    return (settlementPreview?.items || []).map(item => {
      const artist = item.artist || {};
      const key = item.settlementKey || "";
      const available = Math.floor(Number(item?.financials?.creatorShareKrw || 0));
      return {
        key,
        name: artist.displayName || artist.slug || "아티스트",
        available
      };
    }).filter(item => item.key && item.available >= 1000);
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
      message: "정산금으로 충전은 요청만 접수됩니다. 상태는 요청됨/승인 필요로 시작하며, 관리자/회계 확인 후에만 루미나가 지급됩니다. 즉시 지갑에 반영되지 않습니다. 1 Lumina = 10원 기준입니다.",
      summaryHtml:
        '<div class="modal-form-grid">' +
          '<p class="studio-modal-safe-note is-wide">settlementKey는 정산 미리보기에서 자동 선택됩니다. 아티스트 slug를 직접 입력하지 않습니다.</p>' +
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

  document.getElementById("studioProfileArtistSelect")?.addEventListener("change", () => {
    fillProfileEditor(selectedProfileItem());
  });
  document.getElementById("artistIdentityArtistSelect")?.addEventListener("change", loadArtistIdentityProfile);
  document.getElementById("artistIdentityAnalyze")?.addEventListener("click", analyzeArtistIdentity);
  document.getElementById("artistIdentityReview")?.addEventListener("click", openArtistIdentityModal);
  document.getElementById("artistIdentityClose")?.addEventListener("click", closeArtistIdentityModal);
  document.getElementById("artistIdentityLater")?.addEventListener("click", closeArtistIdentityModal);
  document.getElementById("artistIdentitySave")?.addEventListener("click", () => saveArtistIdentity(false));
  document.getElementById("artistIdentityApprove")?.addEventListener("click", () => saveArtistIdentity(true));
  document.getElementById("artistIdentityModal")?.addEventListener("click", event => {
    if (event.target === event.currentTarget) closeArtistIdentityModal();
  });
  document.getElementById("studioProfileResetButton")?.addEventListener("click", () => {
    fillProfileEditor(selectedProfileItem());
  });
  document.getElementById("studioProfileSaveButton")?.addEventListener("click", saveProfileEditor);
  document.getElementById("storyIntakeForm")?.addEventListener("submit", submitStoryIntake);
  document.getElementById("writerManuscriptFile")?.addEventListener("change", readWriterTextFile);
  document.getElementById("writerManuscriptBody")?.addEventListener("input", writerBodyEdited);
  document.getElementById("writerManuscriptWork")?.addEventListener("change", () => {
    invalidateWriterReview();
    writerSourceChanged();
    window.LuminaCreatorAnalysis?.contextChanged?.();
  });
  document.getElementById("writerManuscriptLocale")?.addEventListener("change", () => {
    invalidateWriterReview();
    loadWriterWorks();
  });
  document.getElementById("writerManuscriptExpected")?.addEventListener("input", () => {
    invalidateWriterReview();
    writerSourceChanged();
  });
  document.getElementById("writerManuscriptAddPart")?.addEventListener("click", addWriterPart);
  document.getElementById("writerManuscriptReview")?.addEventListener("click", reviewWriterParts);
  document.getElementById("writerManuscriptConfirm")?.addEventListener("change", syncWriterSubmit);
  document.getElementById("writerManuscriptSubmit")?.addEventListener("click", submitWriterManuscript);
  document.getElementById("writerManuscriptClear")?.addEventListener("click", clearWriterManuscript);
  window.addEventListener("lumina:localechange", () => {
    renderWriterParts();
    if (!document.getElementById("writerManuscriptWork")?.disabled) writerSourceChanged();
    syncWriterSubmit();
    applyArtistIdentityCopy();
  });
  document.getElementById("storyIntakeReset")?.addEventListener("click", clearStoryIntake);
  document.getElementById("storyIntakeSourceClass")?.addEventListener("change", () => {
    storyIntakeRequestKey = null;
    syncStoryIntakeRightsField();
  });
  document.querySelectorAll("#storyIntakeForm input, #storyIntakeForm select").forEach(input => {
    input.addEventListener("change", () => { storyIntakeRequestKey = null; });
    input.addEventListener("input", () => { storyIntakeRequestKey = null; });
  });
  syncStoryIntakeRightsField();
  document.querySelectorAll(".studio-nav button[data-section]").forEach(button => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      setActiveSection(button.dataset.section);
      // #545 — image-lab 탭 클릭 시 요청 이력 lazy-load
      if (button.dataset.section === "image-lab") loadAiContentRequests();
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
    if (event.key === "Escape") {
      closeStudioModal();
      closeArtistIdentityModal();
    }
  });
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-profile-artist]");
    if (!button) return;
    const select = document.getElementById("studioProfileArtistSelect");
    if (select) select.value = button.getAttribute("data-profile-artist");
    const identitySelect = document.getElementById("artistIdentityArtistSelect");
    if (identitySelect) identitySelect.value = button.getAttribute("data-profile-artist");
    fillProfileEditor(selectedProfileItem());
    loadArtistIdentityProfile();
    document.getElementById("studioProfileArtistSelect")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  document.addEventListener("click", event => {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    if (action === "settlement-conversion") {
      openSettlementConversionModal();
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
        showToast("스튜디오 권한 확인이 지연되고 있어요. 잠시 후 다시 확인해 주세요.");
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
          deny("로그인 시간이 만료됐어요. 다시 로그인한 뒤 스튜디오를 열어 주세요.");
        } else deny("스튜디오 권한 확인을 마치지 못했어요. 잠시 후 다시 확인해 주세요.");
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
