(function initCharacterChatModule() {
  const MUTE_KEY_PREFIX = "chatStarter.muted.";
  const STARTER_MAX = 5;
  const CONVERSATION_BOXES = ["recent", "archive", "all"];
  const CONVERSATION_BOX_LABELS = {
    recent: "최근",
    archive: "보관함",
    all: "전체"
  };
  const conversationListState = {
    box: "recent",
    busyId: null,
    bound: false
  };

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

  function getConversationBoxFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      const box = params.get("box") || "";
      return CONVERSATION_BOXES.includes(box) ? box : "recent";
    } catch (_) {
      return "recent";
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
      // #315 — slug 없는 상태에서는 starter card 도 generic 안내로 복귀
      setText("chatStarterEyebrow", "처음이라 어색하죠?");
      return;
    }

    // #315 — 캐릭터별 starter card 헤더 + 히어로 summary 톤. 이름과 statusLine 을 사용해
    // 모든 캐릭터가 같은 generic 문구로 보이는 문제를 해소.
    const displayName = artist?.displayName || artist?.name || slug;
    const tone = getCharacterTone(slug);
    setText("chatStarterEyebrow", `${displayName}에게 첫 인사 골라보기`);
    setText("chatHeroName", displayName);
    setText("chatHeroSummary", artist?.statusLine || tone?.statusLine || "활동 중 · 메시지를 기다리고 있어요");
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
    // #315 — artist 객체가 없거나 welcomeMessage 가 비어 있으면 캐릭터별 정적 tone 으로 fallback.
    // 모든 캐릭터가 같은 generic 문장으로 보이지 않도록 chatTones 데이터를 우선 사용한다.
    const tone = getCharacterTone(slug);
    const greeting = artist?.welcomeMessage
      || tone?.welcomeMessage
      || artist?.summary
      || "메시지 보내줘서 고마워요. 오늘은 어떤 이야기로 시작해볼까요?";
    setText("chatWelcomeText", greeting);
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    setText("chatWelcomeTime", `${hh}:${mm}`);
    bubble.hidden = false;
  }

  /* #315 — chatEmpty 영역도 캐릭터별 정적 fallback 으로 메시지 차별화.
     welcome bubble 이 안 그려지는 극단 케이스(데이터 미도착, 정적 fallback 도 실패)에서도
     "아티스트가 답장 준비 중이에요" 같은 generic 문구가 모든 캐릭터에 동일하게 보이지 않게 한다. */
  function applyChatEmptyForSlug(slug, artist) {
    const empty = $("chatEmpty");
    if (!empty) return;
    const para = empty.querySelector("p");
    if (!para) return;
    if (!slug) {
      para.textContent = "아티스트 프로필에서 대화하기 버튼으로 들어와 주세요.";
      return;
    }
    const tone = getCharacterTone(slug);
    const displayName = artist?.displayName || artist?.name || tone?.name || "";
    const status = tone?.statusLine || "활동 중";
    const namePrefix = displayName ? `${displayName} · ` : "";
    para.textContent = `${namePrefix}${status}. 곧 한 마디 건네드릴게요.`;
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
    // #315 — chatEmpty fallback 도 항상 캐릭터별로 갱신 (welcome 이 그려지면 보이지 않지만,
    // 안 그려지는 극단 케이스에서 generic 문구 노출을 막는 안전망)
    applyChatEmptyForSlug(slug, data?.artist || null);
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
      applyChatEmptyForSlug(slug, null);
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
      applyChatEmptyForSlug(slug, null);
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

  /* #216 v2 — DM 리스트 모드 (slug 없음) / 1:1 채팅 모드 (slug 있음) 분기 */
  function showListMode() {
    const listShell = $("chatListShell");
    const roomShell = $("chatRoomShell");
    if (listShell) listShell.hidden = false;
    if (roomShell) roomShell.hidden = true;
  }
  function showRoomMode() {
    const listShell = $("chatListShell");
    const roomShell = $("chatRoomShell");
    if (listShell) listShell.hidden = true;
    if (roomShell) roomShell.hidden = false;
  }

  /* 캐릭터별 DM 톤을 가져온다. data/character-chat-tones.js 가 채움. */
  function getCharacterTone(slug) {
    const getter = window.LuminaStaticData?.getChatTone;
    if (typeof getter === "function") return getter(slug);
    return null;
  }

  /* #226 — character-catalog read-only API 가 머지되면 자동으로 사용한다.
   * 응답 스키마(greeting/status/starterOptions/directInput/tone/policy)를 chatTones 와 동일 키로 매핑.
   * 실패 시 null 을 반환하면 호출자는 로컬 fallback (chatTones) 으로 떨어진다.
   * mutation 없음. read-only GET. */
  async function fetchCharacterCatalog(slug) {
    if (!slug) return null;
    if (typeof apiFetch !== "function") return null;
    try {
      const data = await apiFetch(
        "/api/v1/chat/character-catalog?artistSlug=" + encodeURIComponent(slug),
        { auth: false, throwOnError: true }
      );
      if (!data || typeof data !== "object") return null;
      // 응답에서 톤만 추려서 chatTones 형태로 정규화
      return {
        statusLine: data.status || data.statusLine || null,
        welcomeMessage: data.greeting || data.welcomeMessage || null,
        lastMessagePreview: data.greetingPreview || data.lastMessagePreview || data.greeting || null,
        starters: Array.isArray(data.starterOptions)
          ? data.starterOptions.slice(0, STARTER_MAX).map((opt, idx) => ({
              key: opt.key || String.fromCharCode(65 + idx),
              label: opt.label || ("선택지 " + (idx + 1)),
              message: opt.message || opt.text || ""
            }))
          : null,
        policy: data.policy || null
      };
    } catch (_) {
      /* 404/네트워크 실패: 로컬 fallback 사용 */
      return null;
    }
  }

  /* 캐릭터 마스터에서 공개 캐릭터만 추려 DM 리스트 행 데이터로 만든다. */
  function getDmListCharacters() {
    const raw = (window.LuminaStaticData && window.LuminaStaticData.characters) || [];
    return raw
      .filter(c => c && c.slug && c.status !== "secret" && c.status !== "hidden")
      .slice(0, 16);
  }

  function setConversationStatus(message) {
    const status = $("chatConversationStatus");
    if (status) status.textContent = message || "";
  }

  function setConversationTabs(box) {
    document.querySelectorAll("[data-chat-conversation-box]").forEach((tab) => {
      const active = tab.dataset.chatConversationBox === box;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function conversationItemAvatar(item) {
    const slug = item?.artist?.slug || "";
    const chars = (window.LuminaStaticData && window.LuminaStaticData.characters) || [];
    const character = slug ? chars.find(c => c && c.slug === slug) : null;
    return character?.images?.thumb
      || character?.images?.cover
      || (slug ? "./assets/characters/" + slug + "/thumb.png" : "");
  }

  function conversationItemTitle(item) {
    return item?.artist?.displayName
      || item?.artist?.name
      || item?.artist?.slug
      || "대화";
  }

  function conversationItemPreview(item) {
    return item?.lastMessage?.bodyPreview
      || item?.emptyState?.defaultMessageKo
      || "아직 표시할 메시지가 없어요.";
  }

  function conversationActionForItem(item) {
    const archived = item?.status === "archived" || item?.box === "archive";
    return archived
      ? { action: "restore", label: "되돌리기", busy: "되돌리는 중" }
      : { action: "archive", label: "보관", busy: "보관 중" };
  }

  function renderConversationRows(items, box) {
    const wrap = $("chatListItems");
    if (!wrap) return;
    wrap.textContent = "";

    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "dm-list-empty";
      empty.textContent = box === "archive"
        ? "보관한 대화가 아직 없어요."
        : "아직 시작한 대화가 없어요. 아래 아티스트 목록에서 첫 인사를 골라보세요.";
      wrap.append(empty);
      if (box !== "archive") appendStaticDmListRows(wrap);
      return;
    }

    items.forEach((item) => {
      const li = document.createElement("li");
      li.className = "dm-list-row dm-list-row-conversation";
      li.setAttribute("role", "listitem");

      const row = document.createElement("div");
      row.className = "dm-list-row-link";

      const avatar = document.createElement("span");
      avatar.className = "dm-list-row-avatar";
      const imgUrl = conversationItemAvatar(item);
      if (imgUrl) avatar.style.backgroundImage = "url(\"" + String(imgUrl).replace(/"/g, "%22") + "\")";
      avatar.setAttribute("aria-hidden", "true");

      const body = document.createElement("span");
      body.className = "dm-list-row-body";

      const head = document.createElement("span");
      head.className = "dm-list-row-head";
      const name = document.createElement("span");
      name.className = "dm-list-row-name";
      name.textContent = conversationItemTitle(item);
      const state = document.createElement("span");
      state.className = "dm-list-row-time";
      state.textContent = item?.status === "archived" ? "보관됨" : "최근";
      head.append(name, state);

      const preview = document.createElement("span");
      preview.className = "dm-list-row-preview";
      preview.textContent = conversationItemPreview(item);

      body.append(head, preview);

      const open = document.createElement("a");
      open.className = "dm-list-open";
      const slug = item?.artist?.slug || "";
      open.href = slug
        ? "./character-chat.html?slug=" + encodeURIComponent(slug) + "&sessionId=" + encodeURIComponent(item.id || "")
        : "./character-chat.html";
      open.setAttribute("aria-label", conversationItemTitle(item) + " 대화 열기");
      open.textContent = "열기";

      const actionMeta = conversationActionForItem(item);
      const action = document.createElement("button");
      action.className = "dm-list-action";
      action.type = "button";
      action.dataset.chatConversationAction = actionMeta.action;
      action.dataset.chatConversationId = item.id || "";
      action.disabled = !item.id || conversationListState.busyId === item.id;
      action.textContent = conversationListState.busyId === item.id ? actionMeta.busy : actionMeta.label;

      const actions = document.createElement("span");
      actions.className = "dm-list-row-actions";
      actions.append(open, action);

      row.append(avatar, body, actions);
      li.append(row);
      wrap.append(li);
    });
  }

  function appendStaticDmListRows(wrap) {
    const chars = getDmListCharacters();
    chars.slice(0, 6).forEach((char) => {
      const tone = getCharacterTone(char.slug);
      const li = document.createElement("li");
      li.className = "dm-list-row dm-list-row-suggestion";
      li.setAttribute("role", "listitem");

      const link = document.createElement("a");
      link.className = "dm-list-row-link";
      link.href = "./character-chat.html?slug=" + encodeURIComponent(char.slug);
      link.setAttribute("aria-label", (char.name || char.slug) + "와의 대화 시작");

      const avatar = document.createElement("span");
      avatar.className = "dm-list-row-avatar";
      const imgUrl = char.images?.thumb || char.images?.cover || ("./assets/characters/" + char.slug + "/thumb.png");
      avatar.style.backgroundImage = "url(\"" + String(imgUrl).replace(/"/g, "%22") + "\")";
      if (char.colorAccent) {
        avatar.style.boxShadow = "0 0 0 2px " + char.colorAccent + " inset, 0 0 0 3px rgba(0,0,0,0.18)";
      }
      avatar.setAttribute("aria-hidden", "true");

      const body = document.createElement("span");
      body.className = "dm-list-row-body";
      const head = document.createElement("span");
      head.className = "dm-list-row-head";
      const name = document.createElement("span");
      name.className = "dm-list-row-name";
      name.textContent = char.name || char.slug;
      const time = document.createElement("span");
      time.className = "dm-list-row-time";
      time.textContent = "새 대화";
      head.append(name, time);
      const preview = document.createElement("span");
      preview.className = "dm-list-row-preview";
      preview.textContent = tone?.lastMessagePreview || tone?.welcomeMessage || "처음 인사를 기다리고 있어요.";
      body.append(head, preview);
      link.append(avatar, body);
      li.append(link);
      wrap.append(li);
    });
  }

  function renderDmList() {
    const wrap = $("chatListItems");
    if (!wrap) return;
    const chars = getDmListCharacters();
    if (!chars.length) {
      wrap.innerHTML = '<li class="dm-list-empty">아직 메시지를 시작할 아티스트가 준비 중이에요.</li>';
      return;
    }
    wrap.textContent = "";
    chars.forEach((char) => {
      const tone = getCharacterTone(char.slug);
      const li = document.createElement("li");
      li.className = "dm-list-row";
      li.setAttribute("role", "listitem");

      const link = document.createElement("a");
      link.className = "dm-list-row-link";
      link.href = "./character-chat.html?slug=" + encodeURIComponent(char.slug);
      link.setAttribute("aria-label", (char.name || char.slug) + "와의 대화 열기");

      const avatar = document.createElement("span");
      avatar.className = "dm-list-row-avatar";
      const imgUrl = char.images?.thumb || char.images?.cover || ("./assets/characters/" + char.slug + "/thumb.png");
      avatar.style.backgroundImage = "url(\"" + String(imgUrl).replace(/"/g, "%22") + "\")";
      if (char.colorAccent) {
        avatar.style.boxShadow = "0 0 0 2px " + char.colorAccent + " inset, 0 0 0 3px rgba(0,0,0,0.18)";
      }
      avatar.setAttribute("aria-hidden", "true");

      const body = document.createElement("span");
      body.className = "dm-list-row-body";

      const head = document.createElement("span");
      head.className = "dm-list-row-head";
      const name = document.createElement("span");
      name.className = "dm-list-row-name";
      name.textContent = char.name || char.slug;
      const time = document.createElement("span");
      time.className = "dm-list-row-time";
      // #315 — "준비 중" 단일 라벨이 모든 캐릭터에 동일 노출되는 문제 해소.
      // tone.statusLine 짧은 한 줄을 사용하고, 좁은 화면 보호를 위해 12자에서 자른다.
      const moodText = (tone?.statusLine || "새 대화").trim();
      const shortMood = moodText.length > 12 ? moodText.slice(0, 11) + "…" : moodText;
      time.textContent = shortMood;
      time.title = moodText; // 전체 문구는 title attribute 로 hover/long-press 확인
      head.append(name, time);

      const preview = document.createElement("span");
      preview.className = "dm-list-row-preview";
      // 캐릭터별 lastMessagePreview/welcomeMessage 가 없을 때도 일반 안내가 아닌
      // 작품 라인업 안내로 폴백.
      preview.textContent = tone?.lastMessagePreview
        || tone?.welcomeMessage
        || (char.role ? `${char.role}로 활동 중이에요.` : "첫 인사를 골라보세요.");

      body.append(head, preview);
      link.append(avatar, body);
      li.append(link);
      wrap.append(li);
    });
  }

  async function loadConversationList(box = conversationListState.box) {
    const wrap = $("chatListItems");
    if (!wrap) return;
    const safeBox = CONVERSATION_BOXES.includes(box) ? box : "recent";
    conversationListState.box = safeBox;
    setConversationTabs(safeBox);

    if (typeof apiFetch !== "function") {
      setConversationStatus("대화 API를 사용할 수 없어 아티스트 목록을 보여드려요.");
      renderDmList();
      return;
    }

    wrap.innerHTML = '<li class="dm-list-skeleton">대화 목록을 불러오는 중이에요…</li>';
    setConversationStatus(CONVERSATION_BOX_LABELS[safeBox] + " 대화함을 확인하고 있어요.");

    try {
      const data = await apiFetch(
        "/api/v1/chat/conversations?box=" + encodeURIComponent(safeBox) + "&take=20",
        { auth: true, throwOnError: true }
      );
      const items = Array.isArray(data?.items) ? data.items : [];
      renderConversationRows(items, safeBox);
      setConversationStatus(items.length
        ? CONVERSATION_BOX_LABELS[safeBox] + " 대화 " + items.length + "개를 불러왔어요."
        : CONVERSATION_BOX_LABELS[safeBox] + " 대화함이 비어 있어요.");
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        setConversationStatus("로그인하면 최근 대화와 보관함을 볼 수 있어요.");
      } else {
        setConversationStatus("대화 목록을 잠시 불러오지 못해 아티스트 목록을 보여드려요.");
      }
      renderDmList();
    }
  }

  async function mutateConversationStatus(sessionId, action) {
    if (!sessionId || !["archive", "restore"].includes(action) || typeof apiFetch !== "function") return;
    conversationListState.busyId = sessionId;
    setConversationStatus(action === "archive" ? "대화를 보관하고 있어요." : "대화를 되돌리고 있어요.");
    try {
      const result = await apiFetch(
        "/api/v1/chat/conversations/" + encodeURIComponent(sessionId) + "/" + action,
        { method: "POST", auth: true, throwOnError: true }
      );
      const changed = result?.changed !== false;
      setConversationStatus(changed
        ? (action === "archive" ? "대화를 보관했어요." : "대화를 최근 대화로 되돌렸어요.")
        : "이미 반영된 상태예요.");
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        if (typeof openAuthModal === "function") openAuthModal("login");
        setConversationStatus("로그인이 필요해요. 다시 로그인한 뒤 시도해주세요.");
      } else if (error?.status === 404) {
        setConversationStatus("대화를 찾을 수 없거나 접근 권한이 없어요.");
      } else {
        setConversationStatus("대화 상태를 바꾸지 못했어요. 잠시 후 다시 시도해주세요.");
      }
    } finally {
      conversationListState.busyId = null;
      await loadConversationList(conversationListState.box);
    }
  }

  function bindConversationListEvents() {
    if (conversationListState.bound) return;
    conversationListState.bound = true;

    document.querySelectorAll("[data-chat-conversation-box]").forEach((tab) => {
      tab.addEventListener("click", () => {
        loadConversationList(tab.dataset.chatConversationBox || "recent");
      });
    });

    const wrap = $("chatListItems");
    if (wrap) {
      wrap.addEventListener("click", (event) => {
        const button = event.target.closest("[data-chat-conversation-action]");
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) return;
        button.disabled = true;
        button.textContent = button.dataset.chatConversationAction === "archive" ? "보관 중" : "되돌리는 중";
        mutateConversationStatus(button.dataset.chatConversationId, button.dataset.chatConversationAction);
      });
    }
  }

  /* 받은 이미지 보관함 시트 (대화 중 받은 이미지만 보관). 결제/주문 호출 없음. */
  function bindInboxSheet() {
    const open = $("chatInboxOpen");
    const sheet = $("chatInboxSheet");
    const backdrop = $("chatInboxBackdrop");
    if (!open || !sheet || !backdrop) return;
    function openSheet() {
      sheet.hidden = false;
      backdrop.hidden = false;
      document.body.classList.add("is-sheet-open");
      // 보관함의 "공식 갤러리는 아티스트 상세에서" 안내 링크에 현재 slug 연결
      const link = $("chatInboxArtistGalleryLink");
      const slug = getArtistSlug();
      if (link && slug) {
        link.href = "./character-detail.html?slug=" + encodeURIComponent(slug) + "#detailGallery";
      }
    }
    function closeSheet() {
      sheet.hidden = true;
      backdrop.hidden = true;
      document.body.classList.remove("is-sheet-open");
    }
    open.addEventListener("click", openSheet);
    backdrop.addEventListener("click", closeSheet);
    sheet.querySelectorAll("[data-inbox-close]").forEach((el) => {
      el.addEventListener("click", closeSheet);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !sheet.hidden) closeSheet();
    });
  }

  /* 선택 캐릭터를 채팅방 상단의 큰 대표 카드(featured peer)로 강조한다. */
  function renderFeaturedPeer(slug, character, tone) {
    const wrap = $("chatFeaturedPeer");
    if (!wrap || !character) return;
    wrap.hidden = false;
    const avatar = $("chatFeaturedAvatar");
    if (avatar) {
      const imgUrl = character.images?.cover || character.images?.thumb || ("./assets/characters/" + slug + "/cover.png");
      avatar.style.backgroundImage = "url(\"" + String(imgUrl).replace(/"/g, "%22") + "\")";
      if (character.colorAccent) {
        avatar.style.boxShadow = "0 0 0 3px " + character.colorAccent + " inset, 0 12px 28px rgba(0,0,0,0.32)";
      }
    }
    setText("chatFeaturedName", character.name || slug);
    setText("chatFeaturedSummary", tone?.statusLine || character.summary || "메시지를 기다리고 있어요");
    const tagsEl = $("chatFeaturedTags");
    if (tagsEl) {
      tagsEl.textContent = "";
      (character.tags || []).slice(0, 3).forEach((tag) => {
        const li = document.createElement("li");
        li.textContent = "#" + tag;
        tagsEl.append(li);
      });
    }
    const profile = $("chatFeaturedProfile");
    if (profile) profile.href = "./character-detail.html?slug=" + encodeURIComponent(slug);
  }

  /* 캐릭터별 톤을 hero/welcome/starter card 에 주입. fetchStarterPrompts API 실패 시 fallback. */
  function applyCharacterToneToRoom(slug) {
    if (!slug) return;
    const tone = getCharacterTone(slug);
    const chars = (window.LuminaStaticData && window.LuminaStaticData.characters) || [];
    const character = chars.find(c => c && c.slug === slug) || null;

    // featured peer (대표 대화 카드, 큰 카드)
    if (character) renderFeaturedPeer(slug, character, tone);

    // hero: 캐릭터별 status line
    if (character) {
      const profile = $("chatHeroProfile");
      if (profile) profile.href = "./character-detail.html?slug=" + encodeURIComponent(slug);
      setText("chatHeroName", character.name || slug);
      setText("chatHeroSummary", tone?.statusLine || "활동 중 · 메시지를 기다리고 있어요");
      setHeroAvatar(slug, { displayName: character.name, avatarUrl: character.images?.thumb });
    }

    // welcome bubble: 캐릭터별 인사말
    renderWelcomeBubble(slug, {
      welcomeMessage: tone?.welcomeMessage,
      summary: character?.summary
    });

    // starter card: 캐릭터별 starter 사용 (서버 응답 도착 전 미리 채움)
    if (tone && Array.isArray(tone.starters) && tone.starters.length) {
      setText("chatStarterPrompt", "이렇게 말을 걸어볼까요?");
      const wrap = $("chatStarterOptions");
      if (wrap) {
        wrap.textContent = "";
        tone.starters.slice(0, STARTER_MAX).forEach((opt, idx) => {
          const key = opt.key || String.fromCharCode(65 + idx);
          const button = document.createElement("button");
          button.className = "chat-starter-option";
          button.type = "button";
          button.dataset.chatStarterChoice = key;
          button.dataset.chatStarterFill = opt.message || "";
          const keyEl = document.createElement("span");
          keyEl.className = "chat-starter-option-label";
          keyEl.textContent = key;
          const textEl = document.createElement("span");
          textEl.className = "chat-starter-option-text";
          textEl.textContent = opt.label || ("선택지 " + key);
          button.append(keyEl, textEl);
          wrap.append(button);
        });
      }
      showStarterCard();
    }
  }

  async function init() {
    const slug = getArtistSlug();

    if (!slug) {
      /* DM 리스트 모드: 캐릭터 목록 그리고 종료. starter/sheet/cleanmode 초기화는 X. */
      showListMode();
      bindConversationListEvents();
      await loadConversationList(getConversationBoxFromUrl());
      return;
    }

    /* 1:1 채팅 모드 */
    showRoomMode();
    renderHero(slug, null);
    renderWelcomeBubble(slug, null);
    applyCharacterToneToRoom(slug);
    bindStarterCardEvents();
    bindInputAutoGrow();
    bindSubmitGuard();
    bindRequestSheet();
    bindInboxSheet();
    applyCleanModeIfReady();

    // #226 character-catalog 백엔드 머지되면 자동으로 캐릭터별 톤이 덮어쓰여짐.
    fetchCharacterCatalog(slug).then((catalogTone) => {
      if (!catalogTone) return;
      const chars = (window.LuminaStaticData && window.LuminaStaticData.characters) || [];
      const character = chars.find(c => c && c.slug === slug) || null;
      if (catalogTone.statusLine) setText("chatHeroSummary", catalogTone.statusLine);
      if (catalogTone.welcomeMessage) {
        renderWelcomeBubble(slug, { welcomeMessage: catalogTone.welcomeMessage, summary: character?.summary });
      }
      if (Array.isArray(catalogTone.starters) && catalogTone.starters.length) {
        renderStarterOptions(catalogTone.starters);
        showStarterCard();
      }
    });

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
