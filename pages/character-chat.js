(function initCharacterChatModule() {
  const MUTE_KEY_PREFIX = "chatStarter.muted.";
  const STARTER_MAX = 5;
  const CONVERSATION_BOXES = ["recent", "archive", "all"];
  const CONVERSATION_BOX_LABELS = {
    recent: "최근",
    archive: "보관함",
    all: "전체"
  };
  const CHAT_API_BASE = (window.LUMINA_API_BASE || "https://api.lumina-stage.com").replace(/\/$/, "");
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

  function getSessionIdFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("sessionId") || params.get("roomId") || "";
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
      profile.href = slug ? `/character-detail?slug=${encodeURIComponent(slug)}` : "/characters";
    }

    if (!slug) {
      setText("chatHeroName", "아티스트를 선택해 주세요");
      setText("chatHeroSummary", "아티스트 프로필에서 대화하기 버튼으로 들어오면 추천 첫 인사를 볼 수 있어요.");
      setHeroAvatar(slug, null);
      // #315 — slug 없는 상태에서는 starter card 도 generic 안내로 복귀
      // #557 — "캐릭터챗" 맥락 명시하여 프리미엄챗 혼동 방지
      setText("chatStarterEyebrow", "캐릭터챗에서 이렇게 시작해보세요");
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
      galleryLink.href = `/character-detail?slug=${encodeURIComponent(slug)}#detailGallery`;
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
    injectSampleImageThread(slug, artist);
  }

  function chatIsPreviewEnv() {
    try {
      const h = window.location.hostname;
      return h === "localhost" || h === "127.0.0.1" || h === "" || h.endsWith(".local");
    } catch (_) { return false; }
  }

  /* #1162/#1181/#1190 — 검수용 카톡형 이미지 말풍선 read-only 샘플 대화.
     #chatThread는 운영 JS가 채우지 않는 빈 컨테이너라, preview/검수 env(localhost 등)에서만 1회
     샘플을 주입해 이미지 말풍선(아티스트 좌·유저 우) + 캡션 흐름을 시각 확인할 수 있게 한다.
     실제 전송/이미지 요청/mutation/네트워크 호출은 발생하지 않는다(운영 host에서는 미주입). */
  function injectSampleImageThread(slug, artist) {
    if (!chatIsPreviewEnv()) return;
    const thread = $("chatThread");
    if (!thread || thread.dataset.sampleInjected === "1") return;
    thread.dataset.sampleInjected = "1";
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const img = (artist && artist.images && (artist.images.cover || artist.images.thumb)) || `/assets/characters/${slug}/cover.png`;
    const name = (artist && (artist.publicName || artist.name)) || "아티스트";
    const safe = (s) => String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;");
    thread.insertAdjacentHTML("beforeend", `
      <li class="dm-bubble dm-bubble-user"><div class="dm-bubble-body"><p class="dm-bubble-text">오늘 무대 사진 한 장만 보여줄 수 있어요?</p><span class="dm-bubble-time">${time}</span></div></li>
      <li class="dm-bubble dm-bubble-artist dm-bubble-image"><div class="dm-bubble-avatar" aria-hidden="true"></div><div class="dm-bubble-body"><img class="dm-bubble-img" src="${safe(img)}" alt="${safe(name)} 무대 사진 샘플" onerror="this.style.display='none'" /><p class="dm-bubble-caption">리허설 끝나고 한 컷 찍었어요. 조명이 예뻐서요.</p><span class="dm-bubble-time">${time}</span></div></li>
      <li class="dm-bubble dm-bubble-artist"><div class="dm-bubble-avatar" aria-hidden="true"></div><div class="dm-bubble-body"><p class="dm-bubble-text">보내줘서 고마워요. 이런 순간이 오래 기억에 남아요.</p><span class="dm-bubble-time">${time}</span></div></li>
    `);
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
    para.textContent = `${namePrefix}${status}. 먼저 첫 인사를 건네보세요.`;
  }

  function buildStarterOptions(serverOptions, slug) {
    const out = [];
    const used = new Set();

    if (Array.isArray(serverOptions)) {
      serverOptions.forEach((option, index) => {
        if (!option || out.length >= STARTER_MAX) return;
        const key = option.key || String.fromCharCode(65 + out.length);
        const label = option.label || `선택지 ${key}`;
        // #559 — message 없으면 label을 fallback으로 사용 (API 응답에 message 누락 시 선택해도 입력창 빈 채로 남는 UX FAIL 방지)
        const message = option.message || option.label || "";
        out.push({ key, label, message });
        used.add(label);
      });
    }

    // #315 v2 — 큐알2 QA FAIL 후속: 부족분은 캐릭터별 tone.starters 로만 채운다.
    // 이전 구현은 generic STARTER_FALLBACK_OPTIONS 가 여러 캐릭터에 동일하게 노출되어
    // 4명+ 캐릭터가 같은 5개 starter 를 받음. tone 이 있는 slug 는 generic 폴백을 건너뛴다.
    let toneFilled = false;
    if (slug && out.length < STARTER_MAX) {
      const tone = getCharacterTone(slug);
      const toneStarters = Array.isArray(tone?.starters) ? tone.starters : [];
      if (toneStarters.length > 0) {
        toneFilled = true;
        for (const opt of toneStarters) {
          if (out.length >= STARTER_MAX) break;
          if (!opt || used.has(opt.label)) continue;
          out.push({
            key: opt.key || String.fromCharCode(65 + out.length),
            label: opt.label,
            message: opt.message || ""
          });
          used.add(opt.label);
        }
      }
    }

    // 마지막 안전망 — slug 가 없거나 tone 이 0개 starter 인 경우에만 generic 으로 채운다.
    // tone.starters 로 4개라도 채워졌다면 generic 을 섞지 않아 캐릭터별 차별화 유지.
    if (!toneFilled) {
      for (const fb of STARTER_FALLBACK_OPTIONS) {
        if (out.length >= STARTER_MAX) break;
        if (used.has(fb.label)) continue;
        out.push({
          key: String.fromCharCode(65 + out.length),
          label: fb.label,
          message: fb.message
        });
      }
    }

    return out.slice(0, STARTER_MAX);
  }

  function renderStarterOptions(options, slug) {
    const wrap = $("chatStarterOptions");
    if (!wrap) return;
    wrap.textContent = "";

    const visible = buildStarterOptions(options, slug);
    // #557 — aria-label + title 추가로 접근성·모바일 터치 텍스트 명확화
    visible.forEach((option) => {
      const button = document.createElement("button");
      button.className = "chat-starter-option";
      button.type = "button";
      button.dataset.chatStarterChoice = option.key;
      button.dataset.chatStarterFill = option.message || "";
      // 보조 기술(스크린 리더)에서 버튼 목적이 명확하게 읽히도록
      button.setAttribute("aria-label", option.label + " - 이 인사말로 시작하기");
      if (option.message) button.title = option.message;

      const keyEl = document.createElement("span");
      keyEl.className = "chat-starter-option-label";
      keyEl.setAttribute("aria-hidden", "true");
      keyEl.textContent = option.key;

      const textEl = document.createElement("span");
      textEl.className = "chat-starter-option-text";
      textEl.textContent = option.label;

      button.append(keyEl, textEl);
      wrap.append(button);
    });
  }

  function hydrateChatCms(slug) {
    if (!slug || !window.LuminaCms || typeof window.LuminaCms.hydrate !== "function") return;
    window.LuminaCms.hydrate({ pageKey: "character-chat", characterSlug: slug }).catch(function () {});
  }

  function applyStarterResponse(slug, data) {
    if (data?.artist) {
      renderHero(slug, data.artist);
      renderWelcomeBubble(slug, data.artist);
    }
    // #315 — chatEmpty fallback 도 항상 캐릭터별로 갱신 (welcome 이 그려지면 보이지 않지만,
    // 안 그려지는 극단 케이스에서 generic 문구 노출을 막는 안전망)
    applyChatEmptyForSlug(slug, data?.artist || null);
    // #324 — 캐릭터별 운영자 CMS 문구가 있으면 위 정적 setText 결과를 덮어쓴다. 실패 시 그대로 fallback.
    hydrateChatCms(slug);
    const firstSet = Array.isArray(data?.sets) ? data.sets[0] : null;

    if (!firstSet) {
      // API 가 0개 보내도 fallback 으로 3~5개 보여줌 (#315 v2: tone.starters 우선)
      setText("chatStarterPrompt", "이렇게 말을 걸어볼까요?");
      renderStarterOptions([], slug);
      setFallback(null);
      showStarterCard();
      return;
    }

    setText("chatStarterPrompt", firstSet.guideText || "이렇게 말을 걸어볼까요?");
    renderStarterOptions(firstSet.options || [], slug);

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
      // slug 없음 — tone 도 모르니 generic fallback 그대로 유지
      setText("chatStarterPrompt", "이렇게 말을 걸어볼까요?");
      renderStarterOptions([], null);
      showStarterCard();
      return null;
    }

    if (typeof apiFetch !== "function") {
      // 백엔드 미연결 환경: 로컬 fallback 으로 동작 — #315 v2: slug 기반 tone.starters 우선
      setFallback(null);
      setText("chatStarterPrompt", "이렇게 말을 걸어볼까요?");
      renderStarterOptions([], slug);
      showStarterCard();
      renderWelcomeBubble(slug, null);
      applyChatEmptyForSlug(slug, null);
      hydrateChatCms(slug);
      return null;
    }

    if (!chatAuthToken()) {
      // Keep the read-only preview usable for logged-out visitors. Calling the
      // authenticated starter endpoint without a token opens the global auth
      // modal, which blocks the mobile + action menu before the user taps it.
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
      // #315 v2 — API 실패 시에도 캐릭터별 tone.starters 가 우선 노출되어 4명+ 캐릭터가
      // 같은 generic starter 를 받는 문제를 막는다.
      renderStarterOptions([], slug);
      showStarterCard();
      renderWelcomeBubble(slug, null);
      applyChatEmptyForSlug(slug, null);
      hydrateChatCms(slug);
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

  /* #918 — 카톡형 + 액션 메뉴 토글.
   * 보관함/새 요청/후원 버튼은 기존 id(chatInboxOpen/chatRequestOpen/chatDonationOpen)를
   * 그대로 유지하므로 각 시트 열기 핸들러는 변경 없이 동작한다.
   * 여기서는 + 버튼으로 메뉴 열고 닫기, 바깥 클릭/ESC/항목 선택 시 닫기만 담당한다. */
  /* #918/#1088 — 카톡형 + 액션 메뉴 토글.
   * live에서 "+ 클릭해도 메뉴가 안 열림(hidden 유지)" 재발 방지를 위해 document 이벤트 위임으로 바인딩한다.
   * 직접 element 바인딩은 init 시점에 dock이 아직 없거나 재렌더되면 핸들러가 사라져 실패할 수 있다.
   * 위임은 바인딩 시점/재렌더와 무관하게 동작하고 중복 바인딩도 막는다.
   * hidden 속성 + is-open class를 함께 토글해 [hidden]/specificity 충돌에도 확실히 표시한다. */
  function bindActionMenu() {
    if (document._chatActionMenuBound) return; // 위임은 1회면 충분
    document._chatActionMenuBound = true;

    function closeMenu() {
      const menu = $("chatActionMenu");
      const toggle = $("chatPlusToggle");
      if (!menu || menu.hidden) return;
      menu.hidden = true;
      menu.classList.remove("is-open");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    }
    function openMenu() {
      const menu = $("chatActionMenu");
      const toggle = $("chatPlusToggle");
      if (!menu) return;
      menu.hidden = false;
      menu.classList.add("is-open");
      if (toggle) toggle.setAttribute("aria-expanded", "true");
    }

    document.addEventListener("click", (event) => {
      // + 버튼(또는 내부 svg) 클릭 → 토글
      if (event.target.closest("#chatPlusToggle")) {
        const menu = $("chatActionMenu");
        if (menu && menu.hidden) openMenu();
        else closeMenu();
        return;
      }
      // 메뉴 항목 선택 → 메뉴 닫기(각 항목의 시트 열기 핸들러는 그대로 동작)
      const item = event.target.closest(".dm-action-menu-item");
      if (item && !item.disabled) { closeMenu(); return; }
      // 메뉴 바깥 클릭 → 닫기
      const openEl = $("chatActionMenu");
      if (openEl && !openEl.hidden && !event.target.closest("#chatActionMenu")) closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
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
        const confirmEl = document.getElementById("chatRequestConfirm");
        const confirmLabel = document.getElementById("chatRequestConfirmLabel");
        if (confirmEl) {
          if (confirmLabel) confirmLabel.textContent = `요청 접수됨 · ${meta.name} (${meta.price})`;
          confirmEl.hidden = false;
        }
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
      // #601 — pending(공개 보류) 캐릭터는 DM 목록에 노출 금지
      .filter(c => c && c.slug && c.status !== "secret" && c.status !== "hidden" && c.status !== "pending")
      .slice(0, 16);
  }

  function setConversationStatus(message) {
    const status = $("chatConversationStatus");
    if (status) status.textContent = message || "";
  }

  function chatAuthToken() {
    try {
      if (typeof window.getAccessToken === "function") {
        const currentToken = window.getAccessToken();
        if (currentToken) return currentToken;
      }
    } catch (_) {}
    try {
      const keys = ["lumina_auth", "lumina.session"];
      for (const key of keys) {
        const raw = window.localStorage?.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const token = parsed?.accessToken ||
          parsed?.token ||
          parsed?.access_token ||
          parsed?.tokens?.accessToken ||
          parsed?.tokens?.access_token;
        if (token) return token;
      }
    } catch (_) {}
    return null;
  }

  async function fetchPremiumJson(path) {
    const token = chatAuthToken();
    if (!token) {
      const error = new Error("auth required");
      error.status = 401;
      throw error;
    }
    const response = await fetch(CHAT_API_BASE + path, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: { Authorization: "Bearer " + token }
    });
    if (!response.ok) {
      const error = new Error("http " + response.status);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  const PREMIUM_REVIEW_PAUSED_STATUSES = new Set([
    "blocked",
    "under_review",
    "reported",
    "blinded",
    "admin_review",
    "suspended",
    "paused_by_report"
  ]);
  const PREMIUM_REFUND_STATUSES = new Set([
    "refund_review",
    "refund_pending",
    "refund_limited_70",
    "refund_limited_50",
    "refunded"
  ]);
  const PREMIUM_CLOSED_STATUSES = new Set([
    "closed",
    "artist_closed",
    "closed_by_artist",
    "closed_by_operator",
    "expired"
  ]);

  function setDonationActionState(locked, tagText, reason) {
    const button = $("chatDonationOpen");
    if (!button) return;
    button.disabled = !!locked;
    button.classList.toggle("is-disabled", !!locked);
    button.setAttribute("aria-disabled", locked ? "true" : "false");
    button.setAttribute("aria-describedby", "premiumChatRoomStatus");
    button.title = reason || (locked ? "후원 기능은 서비스 오픈 후 열려요." : "스타에게 후원하기");
    const tag = button.querySelector(".dm-action-tag");
    if (tag) tag.textContent = tagText || (locked ? "준비" : "유료");
  }

  function renderPremiumRoomStatus({ state = "pending", title, body, badges = [] } = {}) {
    const wrap = $("premiumChatRoomStatus");
    if (!wrap) return;
    const titleEl = $("premiumChatRoomStatusTitle");
    const bodyEl = $("premiumChatRoomStatusBody");
    const badgeList = $("premiumChatRoomStatusBadges");
    wrap.hidden = false;
    wrap.dataset.state = state;
    if (titleEl) titleEl.textContent = title || "프리미엄챗 상태 확인 중";
    if (bodyEl) bodyEl.textContent = body || "방 상태와 후원 가능 여부를 확인하고 있어요.";
    if (badgeList) {
      badgeList.textContent = "";
      badges.filter(Boolean).forEach((badge) => {
        const li = document.createElement("li");
        li.textContent = badge;
        badgeList.append(li);
      });
    }
  }

  function premiumRoomStatusKey(item) {
    return String(
      item?.roomStatus ||
      item?.status?.key ||
      item?.status ||
      item?.room?.status?.key ||
      item?.lockState?.reasonKey ||
      "active"
    ).trim().toLowerCase();
  }

  function premiumRoomRemainingDays(item) {
    const raw = item?.remainingDays ??
      item?.remainingPeriod?.remainingDays ??
      item?.remainingPeriod?.daysRemaining ??
      item?.room?.remainingPeriod?.remainingDays ??
      item?.duration?.remainingDays;
    if (raw != null && Number.isFinite(Number(raw))) {
      return Math.max(0, Number(raw));
    }
    const expiresAt = item?.expiresAt ||
      item?.expiredAt ||
      item?.duration?.expiresAt ||
      item?.room?.duration?.expiresAt ||
      item?.remainingPeriod?.expiresAt;
    if (!expiresAt) return null;
    const diff = new Date(expiresAt) - Date.now();
    if (!Number.isFinite(diff)) return null;
    return Math.max(0, Math.ceil(diff / 86400000));
  }

  function premiumRoomHasUnanswered(item) {
    const responseKey = String(item?.lastResponseStatus?.key || item?.responseStatus?.key || "").toLowerCase();
    return !!(
      item?.artistUnresponded ||
      item?.hasUnansweredMessage ||
      item?.unanswered ||
      item?.unansweredRefundCandidate ||
      responseKey === "waiting_artist"
    );
  }

  function conversationArtistSlug(item) {
    return item?.artist?.slug || item?.artistSlug || item?.slug || item?.room?.artist?.artistSlug || "";
  }

  function matchPremiumRoomItem(items, slug, sessionId) {
    if (!Array.isArray(items)) return null;
    if (sessionId) {
      const bySession = items.find((item) =>
        [item?.id, item?.sessionId, item?.chatSessionId, item?.roomId].filter(Boolean).includes(sessionId)
      );
      if (bySession) return bySession;
    }
    if (!slug) return null;
    return items.find((item) => conversationArtistSlug(item) === slug) || null;
  }

  function roomStatusPresentation(item, mutationOpen) {
    const statusKey = premiumRoomStatusKey(item);
    const remainingDays = premiumRoomRemainingDays(item);
    const unanswered = premiumRoomHasUnanswered(item);
    const badges = [];
    if (remainingDays != null && remainingDays > 0) {
      badges.push(`${remainingDays}일 남음${remainingDays <= 3 ? " · 만료 임박" : ""}`);
    }
    if (unanswered) badges.push("아티스트 답변 대기 중");
    if (PREMIUM_REVIEW_PAUSED_STATUSES.has(statusKey)) {
      badges.push("신고·운영 검토 중");
      return {
        state: "paused",
        locked: true,
        tag: "중단",
        title: "프리미엄챗 일시정지",
        body: "프리미엄챗은 아티스트 직접 답변 유료 채팅이에요. 신고 또는 운영 검토 중이라 이 방의 대화 진입과 후원은 잠시 멈춰 있어요.",
        badges
      };
    }
    if (PREMIUM_REFUND_STATUSES.has(statusKey)) {
      badges.push(statusKey === "refunded" ? "환불 완료" : "환불 검토 중");
      return {
        state: "refund",
        locked: true,
        tag: "검토",
        title: statusKey === "refunded" ? "환불 완료된 방" : "환불 검토 중",
        body: "프리미엄챗은 아티스트 직접 답변 유료 채팅이에요. 환불 상태가 확인 중인 방이라 후원은 일시 중단돼요.",
        badges
      };
    }
    if (PREMIUM_CLOSED_STATUSES.has(statusKey) || remainingDays === 0) {
      badges.push(statusKey === "expired" || remainingDays === 0 ? "프리미엄 기간 만료" : "방 종료");
      return {
        state: "closed",
        locked: true,
        tag: "종료",
        title: statusKey === "expired" || remainingDays === 0 ? "프리미엄챗 기간 만료" : "프리미엄챗 종료",
        body: "프리미엄챗은 아티스트 직접 답변 유료 채팅이에요. 이 방의 프리미엄 상태가 종료되어 후원은 사용할 수 없어요.",
        badges
      };
    }
    badges.push(mutationOpen ? "후원 가능" : "후원 오픈 예정");
    badges.push("프로필 보기 가능");
    return {
      state: remainingDays != null && remainingDays <= 3 ? "expiring" : "active",
      locked: !mutationOpen,
      tag: mutationOpen ? "유료" : "준비",
      title: "프리미엄챗 상태",
      body: mutationOpen
        ? "아티스트 직접 답변 유료 채팅이에요. AI 응답이 아닙니다. 후원은 선택 금액 확인 뒤 진행할 수 있어요."
        : "아티스트 직접 답변 유료 채팅이에요. AI 응답이 아닙니다. 후원은 서비스 오픈 후 활성화돼요.",
      badges
    };
  }

  async function loadPremiumRoomDetailState(slug) {
    renderPremiumRoomStatus({
      state: "pending",
      title: "프리미엄챗 상태 확인 중",
      body: "방 상태와 후원 가능 여부를 확인하고 있어요.",
      badges: ["read-only 확인"]
    });
    setDonationActionState(true, "준비", "후원 가능 여부를 확인하고 있어요.");

    let mutationOpen = false;
    try {
      const contractData = await fetchPremiumJson("/api/v1/chat/premium-support-contract");
      const contract = contractData?.contract || contractData?.data?.contract || contractData;
      mutationOpen = !!contract?.policy?.walletMutationEnabled;
    } catch (_) {
      mutationOpen = false;
    }

    try {
      const data = await fetchPremiumJson("/api/v1/chat/conversations?box=all&take=20");
      const items = Array.isArray(data?.items) ? data.items : [];
      const item = matchPremiumRoomItem(items, slug, getSessionIdFromUrl());
      if (!item) {
        renderPremiumRoomStatus({
          state: "pending",
          title: "프리미엄챗 오픈 예정",
          body: "프리미엄챗은 아티스트 직접 답변 유료 채팅이에요. AI 응답이 아닙니다. 이 아티스트의 열린 방을 찾지 못했어요.",
          badges: ["AI 캐릭터챗 진입 가능", mutationOpen ? "후원 가능" : "후원 오픈 예정"]
        });
        setDonationActionState(!mutationOpen, mutationOpen ? "유료" : "준비", mutationOpen ? "스타에게 후원하기" : "후원 기능은 서비스 오픈 후 열려요.");
        return;
      }
      const view = roomStatusPresentation(item, mutationOpen);
      renderPremiumRoomStatus(view);
      setDonationActionState(view.locked, view.tag, view.locked ? view.body : "스타에게 후원하기");
    } catch (error) {
      const loginNeeded = error?.status === 401 || error?.status === 403;
      renderPremiumRoomStatus({
        state: "pending",
        title: loginNeeded ? "로그인 후 방 상태 확인 가능" : "프리미엄챗 상태 확인 지연",
        // #598 — 비로그인 포함 모든 오류 상태에서 아티스트 직접 답변·AI 아님 명시
        body: loginNeeded
          ? "아티스트 직접 답변 유료 채팅이에요. AI 응답이 아닙니다. 내 방의 만료·미답변·검토 상태는 로그인 후 확인할 수 있어요."
          : "아티스트 직접 답변 유료 채팅이에요. 방 상태를 잠시 불러오지 못해 후원은 준비 상태로 유지돼요.",
        badges: [loginNeeded ? "로그인 필요" : "다시 확인 필요", "후원 오픈 예정"]
      });
      setDonationActionState(true, "준비", "방 상태 확인 후 후원을 이용할 수 있어요.");
    }
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
        ? "/character-chat?slug=" + encodeURIComponent(slug) + "&sessionId=" + encodeURIComponent(item.id || "")
        : "/character-chat";
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
      link.href = "/character-chat?slug=" + encodeURIComponent(char.slug);
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
      // #362 — "준비 중" 반복 톤다운. 실서비스 안내.
      wrap.innerHTML = '<li class="dm-list-empty">대화를 시작할 수 있는 아티스트가 아직 없습니다.</li>';
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
      link.href = "/character-chat?slug=" + encodeURIComponent(char.slug);
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

  /* #627 — 프리미엄챗 후원 바텀시트.
   * HTML: chatDonationSheet / chatDonationOpen / chatDonationBackdrop
   * 실제 차감 API 미연결 (walletMutationEnabled false이면 확인 버튼 disabled 유지).
   * 금액 선택 → 합계 표시 → 확인 버튼 활성화 흐름만 연결. */
  const DONATION_FIXED_AMOUNTS = [10, 50, 100, 500, 1000, 5000, 10000, 50000];

  function renderDonationFixedAmounts(mutationOpen) {
    const grid = $("donationFixedAmounts");
    if (!grid) return;
    grid.textContent = "";
    DONATION_FIXED_AMOUNTS.forEach((amount) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "donation-amount";
      btn.dataset.donationAmount = String(amount);
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", "false");
      btn.disabled = !mutationOpen;
      btn.setAttribute("aria-disabled", mutationOpen ? "false" : "true");
      if (amount >= 10000) btn.dataset.highValue = "1";
      btn.innerHTML = `<span class="donation-amount-value">${amount.toLocaleString("ko-KR")}</span><span class="donation-amount-unit">L</span>`;
      grid.append(btn);
    });
  }

  function updateDonationSummary(amount) {
    const summary = $("donationSummary");
    const label = summary?.querySelector(".donation-summary-amount");
    if (!label) return;
    if (!amount || amount < 1) {
      label.textContent = "금액을 선택하면 합계가 표시됩니다.";
    } else {
      label.textContent = `${Number(amount).toLocaleString("ko-KR")}L 후원 예정`;
    }
  }

  function bindDonationSheet() {
    const openBtn = $("chatDonationOpen");
    const sheet = $("chatDonationSheet");
    const backdrop = $("chatDonationBackdrop");
    const confirmBtn = $("donationConfirmBtn");
    const confirmLabel = $("donationConfirmLabel");
    const customInput = $("donationCustomAmount");
    const msgTextarea = $("donationMessage");
    const msgCounter = $("donationMessageCounter");
    if (!openBtn || !sheet || !backdrop) return;

    let selectedAmount = 0;
    // walletMutationEnabled 상태는 setDonationActionState에서 button.disabled로 표현됨
    const mutationOpen = !openBtn.disabled;

    function openSheet() {
      sheet.hidden = false;
      backdrop.hidden = false;
      document.body.classList.add("is-sheet-open");
      renderDonationFixedAmounts(mutationOpen);
      selectedAmount = 0;
      if (customInput) customInput.value = "";
      updateDonationSummary(0);
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.setAttribute("aria-disabled", "true");
        if (confirmLabel) confirmLabel.textContent = mutationOpen ? "금액을 선택해 주세요" : "후원 오픈 예정";
      }
    }

    function closeSheet() {
      sheet.hidden = true;
      backdrop.hidden = true;
      document.body.classList.remove("is-sheet-open");
    }

    function setSelectedAmount(amount) {
      selectedAmount = amount;
      updateDonationSummary(amount);
      if (confirmBtn && confirmLabel) {
        const valid = mutationOpen && amount >= 1;
        confirmBtn.disabled = !valid;
        confirmBtn.setAttribute("aria-disabled", valid ? "false" : "true");
        confirmLabel.textContent = valid
          ? `${Number(amount).toLocaleString("ko-KR")}L 후원하기`
          : (mutationOpen ? "금액을 선택해 주세요" : "후원 오픈 예정");
      }
    }

    openBtn.addEventListener("click", openSheet);
    backdrop.addEventListener("click", closeSheet);
    sheet.querySelectorAll("[data-donation-close]").forEach((el) => {
      el.addEventListener("click", closeSheet);
    });

    // 고정 금액 버튼
    const grid = $("donationFixedAmounts");
    if (grid) {
      grid.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-donation-amount]");
        if (!btn || btn.disabled) return;
        grid.querySelectorAll("[data-donation-amount]").forEach((b) => {
          b.setAttribute("aria-checked", "false");
          b.classList.remove("is-active");
        });
        btn.setAttribute("aria-checked", "true");
        btn.classList.add("is-active");
        if (customInput) customInput.value = "";
        setSelectedAmount(Number(btn.dataset.donationAmount));
      });
    }

    // 직접 입력
    if (customInput) {
      customInput.addEventListener("input", () => {
        const val = Math.min(Math.max(Math.floor(Number(customInput.value) || 0), 0), 50000);
        if (grid) grid.querySelectorAll("[data-donation-amount]").forEach((b) => b.setAttribute("aria-checked", "false"));
        setSelectedAmount(val);
      });
    }

    // 메시지 카운터
    if (msgTextarea && msgCounter) {
      msgTextarea.addEventListener("input", () => {
        msgCounter.textContent = `${msgTextarea.value.length} / 200`;
      });
    }

    // 확인 버튼 — 결제 API 미연결, 접수 안내만
    if (confirmBtn) {
      confirmBtn.addEventListener("click", () => {
        if (!mutationOpen || selectedAmount < 1) return;
        if (confirmLabel) confirmLabel.textContent = "후원 기능은 서비스 오픈 후 이용할 수 있어요";
        confirmBtn.disabled = true;
        confirmBtn.setAttribute("aria-disabled", "true");
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !sheet.hidden) closeSheet();
    });
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
        link.href = "/character-detail?slug=" + encodeURIComponent(slug) + "#detailGallery";
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
    if (profile) profile.href = "/character-detail?slug=" + encodeURIComponent(slug);
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
      if (profile) profile.href = "/character-detail?slug=" + encodeURIComponent(slug);
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

    /* #601 — pending(공개 보류) 캐릭터는 직접 URL 진입 시 채팅방 대신 준비중 안내를 표시.
       getDmListCharacters에서 이미 제외되지만 URL 직접 접근은 막지 못해 FAIL 재발.
       로컬 정적 데이터 기준으로만 체크하고, API 응답은 건드리지 않음. */
    const chars = (window.LuminaStaticData && window.LuminaStaticData.characters) || [];
    const enteredChar = chars.find(c => c && c.slug === slug) || null;
    if (enteredChar && enteredChar.status === "pending") {
      showRoomMode();
      setText("chatHeroName", enteredChar.name || slug);
      setText("chatHeroSummary", "공개 예정");
      setHeroAvatar(slug, null);
      const empty = $("chatEmpty");
      if (empty) {
        const para = empty.querySelector("p");
        if (para) para.textContent = `${enteredChar.name || slug}은(는) 아직 공개 전이에요. 이미지와 프로필이 공개되면 채팅이 열려요.`;
        empty.hidden = false;
      }
      // starter card 및 입력창 숨김
      const starterCard = $("chatStarterCard");
      if (starterCard) starterCard.hidden = true;
      const inputForm = $("chatInputForm");
      if (inputForm) inputForm.hidden = true;
      return;
    }

    /* 1:1 채팅 모드 */
    showRoomMode();
    renderHero(slug, null);
    renderWelcomeBubble(slug, null);
    applyCharacterToneToRoom(slug);
    void loadPremiumRoomDetailState(slug);
    bindStarterCardEvents();
    bindInputAutoGrow();
    bindSubmitGuard();
    bindActionMenu();
    bindRequestSheet();
    bindDonationSheet();
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
        renderStarterOptions(catalogTone.starters, slug);
        showStarterCard();
      }
      hydrateChatCms(slug);
    });

    hydrateChatCms(slug);

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
