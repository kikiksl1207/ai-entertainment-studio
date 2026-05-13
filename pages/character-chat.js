(function initCharacterChatModule() {
  const MUTE_KEY_PREFIX = "chatStarter.muted.";
  const STARTER_MAX = 5;

  // 시작 지문 fallback — API 가 1~2개만 줄 때 채워서 3~5개 보장.
  // 모든 항목은 단순 텍스트만 사용. API 가 보내준 항목이 있다면 그것을 우선한다.
  const STARTER_FALLBACK_OPTIONS = [
    { key: "A", label: "오늘 하루 어땠는지 물어보기", message: "오늘 하루 어떻게 보냈어요? 무대 준비는 잘 되고 있어요?" },
    { key: "B", label: "응원 한마디 보내기", message: "당신의 무대를 항상 응원하고 있어요. 오늘도 빛나주세요." },
    { key: "C", label: "요즘 듣는 음악 물어보기", message: "요즘 자주 듣는 노래나 즐겨 보는 영상 있어요?" },
    { key: "D", label: "다음 무대 궁금해하기", message: "다음 무대에서는 어떤 모습을 보여줄 거예요?" },
    { key: "E", label: "조용히 안부 인사", message: "그냥 안녕 한마디 건네러 왔어요. 잘 지내고 있어요?" }
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function getArtistSlug() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("slug") || params.get("artistSlug") || "";
    } catch (_) {
      return "";
    }
  }

  function getMuteKey(slug) {
    return slug ? MUTE_KEY_PREFIX + slug : null;
  }

  function isMuted(slug) {
    const key = getMuteKey(slug);
    if (!key) return false;
    try {
      return window.localStorage?.getItem(key) === "1";
    } catch (_) {
      return false;
    }
  }

  function setMuted(slug, value) {
    const key = getMuteKey(slug);
    if (!key) return;
    try {
      if (value) window.localStorage?.setItem(key, "1");
      else window.localStorage?.removeItem(key);
    } catch (_) {
      /* localStorage 불가 환경에서는 세션 한정 동작 */
    }
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value || "";
  }

  function setFallback(message) {
    const fallback = $("chatStarterFallback");
    if (!fallback) return;
    fallback.hidden = !message;
    fallback.textContent = message || "";
  }

  function showStarterCard() {
    const card = $("chatStarterCard");
    if (!card) return;
    card.hidden = false;
    card.setAttribute("data-state", "default");
  }

  function collapseStarterCard(reason) {
    const card = $("chatStarterCard");
    if (!card) return;
    card.setAttribute("data-state", reason === "muted" ? "muted" : "collapsed");
    card.hidden = true;
  }

  function fillInputAndFocus(message) {
    const input = $("chatInput");
    if (!input) return;
    if (typeof message === "string" && message.trim()) {
      input.value = message;
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
    }
    input.focus({ preventScroll: false });
  }

  function avatarUrlFromArtist(slug, artist) {
    return artist?.avatarUrl
      || artist?.thumbnailUrl
      || (slug ? `./assets/characters/${slug}/thumb.png` : "");
  }

  function setHeroAvatar(slug, artist) {
    const avatar = $("chatHeroAvatar");
    if (!avatar) return;
    const imageUrl = avatarUrlFromArtist(slug, artist);
    if (imageUrl) avatar.style.backgroundImage = `url("${String(imageUrl).replace(/"/g, "%22")}")`;
    const name = artist?.displayName || artist?.name || artist?.slug || slug || "L";
    avatar.setAttribute("data-initial", name.trim().slice(0, 1).toUpperCase());

    const bubbleAvatar = $("chatWelcomeAvatar");
    if (bubbleAvatar && imageUrl) {
      bubbleAvatar.style.backgroundImage = `url("${String(imageUrl).replace(/"/g, "%22")}")`;
    }
  }

  function renderHero(slug, artist) {
    const profile = $("chatHeroProfile");
    if (profile) {
      profile.href = slug ? `./character-detail.html?slug=${encodeURIComponent(slug)}` : "./characters.html";
    }

    if (!slug) {
      setText("chatHeroName", "아티스트를 선택해 주세요");
      setText("chatHeroSummary", "아티스트 프로필에서 대화하기 버튼으로 들어오면 추천 첫 인사를 볼 수 있어요.");
      setHeroAvatar(slug, null);
      return;
    }

    const displayName = artist?.displayName || artist?.name || slug;
    setText("chatHeroName", displayName);
    // DM 상단의 status 라인은 "활동 중" 같은 친근한 톤
    setText("chatHeroSummary", artist?.statusLine || "활동 중 · 메시지를 기다리고 있어요");
    setHeroAvatar(slug, artist);

    // 갤러리 액션 링크: 같은 아티스트 상세 페이지의 갤러리로 이동
    const galleryLink = $("chatGalleryLink");
    if (galleryLink) {
      galleryLink.href = `./character-detail.html?slug=${encodeURIComponent(slug)}#detailGallery`;
    }
  }

  function renderWelcomeBubble(slug, artist) {
    const bubble = $("chatWelcomeBubble");
    if (!bubble) return;
    if (!slug) {
      bubble.hidden = true;
      return;
    }
    const greeting = artist?.welcomeMessage
      || artist?.summary
      || "메시지 보내줘서 고마워요. 오늘은 어떤 이야기로 시작해볼까요?";
    setText("chatWelcomeText", greeting);
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    setText("chatWelcomeTime", `${hh}:${mm}`);
    bubble.hidden = false;
  }

  function buildStarterOptions(serverOptions) {
    const out = [];
    const used = new Set();

    if (Array.isArray(serverOptions)) {
      serverOptions.forEach((option, index) => {
        if (!option || out.length >= STARTER_MAX) return;
        const key = option.key || String.fromCharCode(65 + out.length);
        const label = option.label || `선택지 ${key}`;
        const message = option.message || "";
        out.push({ key, label, message });
        used.add(label);
      });
    }

    // 부족분은 fallback 으로 채워 3~5개를 보장
    for (const fb of STARTER_FALLBACK_OPTIONS) {
      if (out.length >= STARTER_MAX) break;
      if (used.has(fb.label)) continue;
      out.push({
        key: String.fromCharCode(65 + out.length),
        label: fb.label,
        message: fb.message
      });
    }

    return out.slice(0, STARTER_MAX);
  }

  function renderStarterOptions(options) {
    const wrap = $("chatStarterOptions");
    if (!wrap) return;
    wrap.textContent = "";

    const visible = buildStarterOptions(options);
    visible.forEach((option) => {
      const button = document.createElement("button");
      button.className = "chat-starter-option";
      button.type = "button";
      button.dataset.chatStarterChoice = option.key;
      button.dataset.chatStarterFill = option.message || "";

      const keyEl = document.createElement("span");
      keyEl.className = "chat-starter-option-label";
      keyEl.textContent = option.key;

      const textEl = document.createElement("span");
      textEl.className = "chat-starter-option-text";
      textEl.textContent = option.label;

      button.append(keyEl, textEl);
      wrap.append(button);
    });
  }

  function applyStarterResponse(slug, data) {
    if (data?.artist) {
      renderHero(slug, data.artist);
      renderWelcomeBubble(slug, data.artist);
    }
    const firstSet = Array.isArray(data?.sets) ? data.sets[0] : null;

    if (!firstSet) {
      // API 가 0개 보내도 fallback 으로 3~5개 보여줌
      setText("chatStarterPrompt", "이렇게 말을 걸어볼까요?");
      renderStarterOptions([]);
      setFallback(null);
      showStarterCard();
      return;
    }

    setText("chatStarterPrompt", firstSet.guideText || "이렇게 말을 걸어볼까요?");
    renderStarterOptions(firstSet.options || []);

    const direct = document.querySelector("[data-chat-starter-direct]");
    if (direct && firstSet.directInput?.label) {
      direct.textContent = firstSet.directInput.label;
    }

    setFallback(null);
    showStarterCard();
  }

  async function fetchStarterPrompts(slug) {
    if (!slug) {
      setFallback("아티스트 정보가 없어 추천 인사말을 불러오지 못했어요. 아티스트 목록에서 다시 들어와 주세요.");
      // 그래도 fallback 5종은 보여줌
      setText("chatStarterPrompt", "이렇게 말을 걸어볼까요?");
      renderStarterOptions([]);
      showStarterCard();
      return null;
    }

    if (typeof apiFetch !== "function") {
      // 백엔드 미연결 환경: 로컬 fallback 으로 동작
      setFallback(null);
      setText("chatStarterPrompt", "이렇게 말을 걸어볼까요?");
      renderStarterOptions([]);
      showStarterCard();
      renderWelcomeBubble(slug, null);
      return null;
    }

    try {
      return await apiFetch(
        `/api/v1/chat/starter-prompts?artistSlug=${encodeURIComponent(slug)}`,
        { auth: true, throwOnError: true }
      );
    } catch (error) {
      // 401/403/404/기타 — fallback 5종을 보여주고 안내만 표시
      if (error?.status === 401 || error?.status === 403) {
        setFallback("로그인하면 아티스트 맞춤 첫 인사를 받을 수 있어요. 지금은 추천 인사말을 먼저 보여드릴게요.");
      } else if (error?.status === 404) {
        setFallback(null);
      } else {
        setFallback("추천 인사말을 잠시 가져오지 못했어요. 아래 인사로 먼저 시작해 보세요.");
      }
      setText("chatStarterPrompt", "이렇게 말을 걸어볼까요?");
      renderStarterOptions([]);
      showStarterCard();
      renderWelcomeBubble(slug, null);
      return null;
    }
  }

  function bindStarterCardEvents() {
    const card = $("chatStarterCard");
    if (!card) return;
    const slug = getArtistSlug();

    card.addEventListener("click", (event) => {
      const optionButton = event.target.closest("[data-chat-starter-choice]");
      if (optionButton) {
        fillInputAndFocus(optionButton.dataset.chatStarterFill || "");
        collapseStarterCard("choice");
        return;
      }

      if (event.target.closest("[data-chat-starter-dismiss]")) {
        collapseStarterCard("dismiss");
        return;
      }

      if (event.target.closest("[data-chat-starter-direct]")) {
        fillInputAndFocus("");
        collapseStarterCard("direct");
      }
    });

    const muteInput = card.querySelector("[data-chat-starter-mute]");
    if (muteInput) {
      muteInput.addEventListener("change", () => {
        setMuted(slug, muteInput.checked);
        if (muteInput.checked) collapseStarterCard("muted");
      });
    }
  }

  function bindInputAutoGrow() {
    const input = $("chatInput");
    if (!input) return;
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
    });
  }

  function bindSubmitGuard() {
    const form = $("chatInputForm");
    if (!form) return;
    form.addEventListener("submit", (event) => {
      // 백엔드 연결 전: send 차단. 추후 backend 계약 확정되면 실제 호출로 교체.
      event.preventDefault();
    });
  }

  /* 이미지/영상 요청 바텀시트 ─ 결제/주문 API 호출 금지.
   * #216, #217 기준: 결제 시스템 준비 전에는 예약 요청서만 받는 stub 흐름.
   * 선택한 tier 는 추후 백엔드 product SKU 매핑 시점에 다시 연결한다.
   */
  function bindRequestSheet() {
    const openBtn = $("chatRequestOpen");
    const sheet = $("chatRequestSheet");
    const backdrop = $("chatRequestBackdrop");
    const submit = $("chatRequestSubmit");
    const submitLabel = $("chatRequestSubmitLabel");
    const tierGrid = $("chatRequestTiers");
    if (!openBtn || !sheet || !backdrop) return;

    const tierMeta = {
      image_basic: { name: "기본 이미지", price: "30L" },
      image_premium: { name: "고급 이미지", price: "100L" },
      video_short: { name: "짧은 영상", price: "300L" }
    };

    let activeTier = null;
    let submitted = false;

    function updateSubmitState() {
      if (!submit || !submitLabel) return;
      if (!activeTier) {
        submit.disabled = true;
        submit.setAttribute("aria-disabled", "true");
        submitLabel.textContent = "원하는 요청을 골라주세요";
        return;
      }
      const meta = tierMeta[activeTier];
      submit.disabled = false;
      submit.setAttribute("aria-disabled", "false");
      submitLabel.textContent = submitted
        ? "요청서 접수됨"
        : `${meta.name} 요청서 보내기 · ${meta.price}`;
    }

    function openSheet() {
      sheet.hidden = false;
      backdrop.hidden = false;
      document.body.classList.add("is-sheet-open");
      submitted = false;
      activeTier = null;
      tierGrid?.querySelectorAll("[data-request-tier]").forEach((btn) => {
        btn.setAttribute("aria-checked", "false");
      });
      updateSubmitState();
    }

    function closeSheet() {
      sheet.hidden = true;
      backdrop.hidden = true;
      document.body.classList.remove("is-sheet-open");
    }

    openBtn.addEventListener("click", openSheet);
    backdrop.addEventListener("click", closeSheet);
    sheet.querySelectorAll("[data-request-close]").forEach((el) => {
      el.addEventListener("click", closeSheet);
    });

    if (tierGrid) {
      tierGrid.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-request-tier]");
        if (!btn) return;
        activeTier = btn.dataset.requestTier;
        tierGrid.querySelectorAll("[data-request-tier]").forEach((el) => {
          el.setAttribute("aria-checked", el === btn ? "true" : "false");
        });
        submitted = false;
        updateSubmitState();
      });
    }

    if (submit) {
      submit.addEventListener("click", () => {
        if (!activeTier) return;
        // 실제 결제/주문 API 호출 없음. 예약 요청서 접수 안내만 표시.
        submitted = true;
        const meta = tierMeta[activeTier];
        submitLabel.textContent = `요청 접수됨 · ${meta.name} (${meta.price})`;
        submit.disabled = true;
        submit.setAttribute("aria-disabled", "true");
        // 본 메시지를 사용자의 DM 흐름에도 시스템 안내 버블로 띄울 수 있도록
        // 추후 백엔드 image-request 엔드포인트 확정 시 여기서 호출하면 됨.
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !sheet.hidden) closeSheet();
    });
  }

  /* 클린모드 노출 토글 — 미성년자 안전 정책 도착 시
   * window.LuminaCleanMode = { active: true, message: "..." } 로 활성화하면 배너 노출.
   * 백엔드 정책 API 확정 전에는 자동 노출하지 않음.
   */
  function applyCleanModeIfReady() {
    try {
      const flag = window.LuminaCleanMode;
      if (!flag || !flag.active) return;
      const notice = $("chatCleanNotice");
      const text = $("chatCleanText");
      if (!notice) return;
      if (text && flag.message) text.textContent = flag.message;
      notice.hidden = false;
    } catch (_) {
      /* noop */
    }
  }

  async function init() {
    const slug = getArtistSlug();
    renderHero(slug, null);
    renderWelcomeBubble(slug, null);
    bindStarterCardEvents();
    bindInputAutoGrow();
    bindSubmitGuard();
    bindRequestSheet();
    applyCleanModeIfReady();

    if (!slug) {
      setFallback("아티스트 프로필에서 대화하기 버튼으로 들어오면 맞춤 첫 인사를 볼 수 있어요. 아래 추천 인사말도 시작에 좋아요.");
      setText("chatStarterPrompt", "이렇게 말을 걸어볼까요?");
      renderStarterOptions([]);
      showStarterCard();
      return;
    }

    if (isMuted(slug)) return;
    const data = await fetchStarterPrompts(slug);
    if (data) applyStarterResponse(slug, data);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
