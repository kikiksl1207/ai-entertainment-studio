(function initCharacterChatModule() {
  /* #208 — 캐릭터챗 초보자 starter prompt UI
     - URL: character-chat.html?slug=<artistSlug>
     - 차모 API: GET /api/v1/chat/starter-prompts?artistSlug=<slug>
     - 실제 LLM 호출 비활성 (전송 버튼 disabled 유지)
     - 카드 선택 → 입력창에 문장 채움 (전송 안 함)
     - '바로 입력할게요' → 카드 collapsed + 입력창 focus
     - '다시 보지 않기' → localStorage 저장 + 카드 hidden (같은 slug에서 안 보임)
     - API 실패 시 fallback 문구 (raw enum/messageKey 숨김) */

  const MUTE_KEY_PREFIX = "chatStarter.muted.";

  function $(id) { return document.getElementById(id); }

  function escapeText(value) {
    if (value == null) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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
    if (!slug) return null;
    return MUTE_KEY_PREFIX + slug;
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
      if (value) {
        window.localStorage?.setItem(key, "1");
      } else {
        window.localStorage?.removeItem(key);
      }
    } catch (_) {
      // localStorage 미지원 환경에서는 세션만 유지
    }
  }

  function renderHero(slug) {
    const nameEl = $("chatHeroName");
    const summaryEl = $("chatHeroSummary");
    const profileEl = $("chatHeroProfile");
    if (profileEl && slug) {
      profileEl.href = "./character-detail.html?slug=" + encodeURIComponent(slug);
    }
    // 캐릭터 표시명/요약은 starter-prompts 응답의 artist 정보로 채움 (renderStarterCard에서)
    if (!slug && nameEl) {
      nameEl.textContent = "대화 상대를 선택해 주세요.";
      if (summaryEl) summaryEl.textContent = "캐릭터 상세에서 '대화하기' 버튼으로 들어와 주세요.";
    }
  }

  function renderHeroFromArtist(artist) {
    if (!artist) return;
    const nameEl = $("chatHeroName");
    const avatarEl = $("chatHeroAvatar");
    const summaryEl = $("chatHeroSummary");
    if (nameEl) nameEl.textContent = artist.displayName || artist.name || artist.slug || "AI 아티스트";
    if (avatarEl && artist.avatarUrl) {
      avatarEl.style.backgroundImage = "url('" + String(artist.avatarUrl).replace(/'/g, "%27") + "')";
    } else if (avatarEl && artist.thumbnailUrl) {
      avatarEl.style.backgroundImage = "url('" + String(artist.thumbnailUrl).replace(/'/g, "%27") + "')";
    }
    if (summaryEl && artist.summary) summaryEl.textContent = artist.summary;
  }

  function renderStarterOptions(options) {
    const wrap = $("chatStarterOptions");
    if (!wrap) return;
    if (!Array.isArray(options) || !options.length) {
      wrap.innerHTML = "";
      return;
    }
    // 최대 2개만 표시 (#200 시안 + #201 policy.maxVisibleOptions=2)
    const visible = options.slice(0, 2);
    wrap.innerHTML = visible.map(function (opt, idx) {
      const key = opt.key || (idx === 0 ? "A" : "B");
      const label = opt.label || ("선택지 " + key);
      const message = opt.message || "";
      return (
        '<button class="chat-starter-option" type="button" ' +
        'data-chat-starter-choice="' + escapeText(key) + '" ' +
        'data-chat-starter-fill="' + escapeText(message) + '">' +
          '<span class="chat-starter-option-label">' + escapeText(key) + '</span>' +
          '<span class="chat-starter-option-text">' + escapeText(label) + '</span>' +
        '</button>'
      );
    }).join("");
  }

  function setFallback(messageOrNull) {
    const fb = $("chatStarterFallback");
    if (!fb) return;
    if (messageOrNull) {
      fb.textContent = messageOrNull;
      fb.hidden = false;
    } else {
      fb.textContent = "";
      fb.hidden = true;
    }
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
    if (typeof message === "string" && message.length) {
      input.value = message;
      // 자동 높이 (간단 패턴)
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 140) + "px";
    }
    input.focus({ preventScroll: false });
  }

  function bindStarterCardEvents() {
    const card = $("chatStarterCard");
    if (!card) return;
    const slug = getArtistSlug();

    // 옵션 선택 (이벤트 위임)
    card.addEventListener("click", function (event) {
      const optionBtn = event.target.closest("[data-chat-starter-choice]");
      if (optionBtn) {
        const fill = optionBtn.getAttribute("data-chat-starter-fill") || "";
        fillInputAndFocus(fill);
        collapseStarterCard("choice");
        return;
      }
      if (event.target.closest("[data-chat-starter-dismiss]")) {
        collapseStarterCard("dismiss");
        return;
      }
      if (event.target.closest("[data-chat-starter-direct]")) {
        const input = $("chatInput");
        if (input) input.focus({ preventScroll: false });
        collapseStarterCard("direct");
        return;
      }
    });

    // mute 체크
    const muteInput = card.querySelector("[data-chat-starter-mute]");
    if (muteInput) {
      muteInput.addEventListener("change", function () {
        if (muteInput.checked) {
          setMuted(slug, true);
          collapseStarterCard("muted");
        } else {
          setMuted(slug, false);
        }
      });
    }
  }

  function bindInputAutoGrow() {
    const input = $("chatInput");
    if (!input) return;
    input.addEventListener("input", function () {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 140) + "px";
    });
  }

  function bindSubmitGuard() {
    // 1차에서는 LLM 호출 비활성 — submit을 막고 fallback 안내
    const form = $("chatInputForm");
    if (!form) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      // 전송 버튼이 disabled라 사실상 도달 안 하지만, 안전 차원에서 막음
    });
  }

  async function fetchStarterPrompts(slug) {
    if (!slug) {
      setFallback("대화 상대 정보를 찾지 못했어요. 아티스트 목록에서 다시 들어와 주세요.");
      return null;
    }
    if (typeof apiFetch !== "function") {
      setFallback("연결 환경이 준비되지 않아 시작 지문을 불러오지 못했어요.");
      return null;
    }
    try {
      const res = await apiFetch(
        "/api/v1/chat/starter-prompts?artistSlug=" + encodeURIComponent(slug),
        { auth: true, throwOnError: true }
      );
      return res || null;
    } catch (err) {
      // 401 / 403 / 404 / 5xx 모두 사용자 친화 fallback (raw enum/messageKey 미노출)
      console.warn("[#208 chat starter-prompts] 실패", { status: err?.status });
      if (err?.status === 401 || err?.status === 403) {
        setFallback("로그인 후에 시작 지문을 불러올 수 있어요.");
      } else if (err?.status === 404) {
        setFallback("이 아티스트의 시작 지문이 아직 준비되지 않았어요.");
      } else {
        setFallback("시작 지문을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
      return null;
    }
  }

  function applyStarterResponse(data) {
    if (!data) {
      // fetch 실패 — fallback만 보여주고 카드 자체는 노출
      showStarterCard();
      return;
    }
    if (data.artist) renderHeroFromArtist(data.artist);

    const set = Array.isArray(data.sets) ? data.sets[0] : null;
    if (!set) {
      setFallback("이 아티스트의 시작 지문이 아직 준비되지 않았어요.");
      showStarterCard();
      return;
    }

    const promptEl = $("chatStarterPrompt");
    if (promptEl && set.guideText) promptEl.textContent = set.guideText;

    renderStarterOptions(set.options || []);
    // directInput 라벨이 응답에 있으면 카드 footer의 direct 버튼 텍스트 갱신
    if (set.directInput && set.directInput.label) {
      const direct = document.querySelector("[data-chat-starter-direct]");
      if (direct) direct.textContent = set.directInput.label;
    }

    setFallback(null); // 정상 응답 시 fallback 제거
    showStarterCard();
  }

  async function init() {
    const slug = getArtistSlug();
    renderHero(slug);

    bindStarterCardEvents();
    bindInputAutoGrow();
    bindSubmitGuard();

    if (!slug) return;
    if (isMuted(slug)) {
      // mute된 상태 — 카드 노출 X
      return;
    }
    const data = await fetchStarterPrompts(slug);
    applyStarterResponse(data);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
