(function initCharacterChatModule() {
  const MUTE_KEY_PREFIX = "chatStarter.muted.";

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
      // localStorage를 사용할 수 없는 환경에서는 이번 세션 동작만 유지합니다.
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
      input.style.height = Math.min(input.scrollHeight, 140) + "px";
    }
    input.focus({ preventScroll: false });
  }

  function setHeroAvatar(slug, artist) {
    const avatar = $("chatHeroAvatar");
    if (!avatar) return;
    const imageUrl = artist?.avatarUrl || artist?.thumbnailUrl || (slug ? `./assets/characters/${slug}/thumb.png` : "");
    if (imageUrl) avatar.style.backgroundImage = `url("${String(imageUrl).replace(/"/g, "%22")}")`;
    const name = artist?.displayName || artist?.name || artist?.slug || slug || "L";
    avatar.setAttribute("data-initial", name.trim().slice(0, 1).toUpperCase());
  }

  function renderHero(slug, artist) {
    const profile = $("chatHeroProfile");
    if (profile) {
      profile.href = slug ? `./character-detail.html?slug=${encodeURIComponent(slug)}` : "./characters.html";
    }

    if (!slug) {
      setText("chatHeroName", "아티스트를 선택해 주세요");
      setText("chatHeroSummary", "아티스트 상세 페이지에서 대화하기 버튼으로 다시 들어오면 시작 지문을 볼 수 있어요.");
      setHeroAvatar(slug, null);
      return;
    }

    const displayName = artist?.displayName || artist?.name || slug;
    setText("chatHeroName", displayName);
    setText("chatHeroSummary", artist?.summary || "초보자 시작 지문으로 첫 마디를 가볍게 준비해보세요.");
    setHeroAvatar(slug, artist);
  }

  function renderStarterOptions(options) {
    const wrap = $("chatStarterOptions");
    if (!wrap) return;
    wrap.textContent = "";

    const visible = Array.isArray(options) ? options.slice(0, 2) : [];
    visible.forEach((option, index) => {
      const key = option?.key || (index === 0 ? "A" : "B");
      const label = option?.label || `선택지 ${key}`;
      const message = option?.message || "";
      const button = document.createElement("button");
      button.className = "chat-starter-option";
      button.type = "button";
      button.dataset.chatStarterChoice = key;
      button.dataset.chatStarterFill = message;

      const keyEl = document.createElement("span");
      keyEl.className = "chat-starter-option-label";
      keyEl.textContent = key;

      const textEl = document.createElement("span");
      textEl.className = "chat-starter-option-text";
      textEl.textContent = label;

      button.append(keyEl, textEl);
      wrap.append(button);
    });
  }

  function applyStarterResponse(slug, data) {
    if (data?.artist) renderHero(slug, data.artist);
    const firstSet = Array.isArray(data?.sets) ? data.sets[0] : null;

    if (!firstSet) {
      setFallback("이 아티스트의 시작 지문이 아직 준비되지 않았어요.");
      showStarterCard();
      return;
    }

    setText("chatStarterPrompt", firstSet.guideText || "어떤 말로 시작해볼까요?");
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
      setFallback("아티스트 정보가 없어 시작 지문을 불러오지 못했어요. 아티스트 목록에서 다시 들어와 주세요.");
      showStarterCard();
      return null;
    }

    if (typeof apiFetch !== "function") {
      setFallback("연결 환경을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.");
      showStarterCard();
      return null;
    }

    try {
      return await apiFetch(
        `/api/v1/chat/starter-prompts?artistSlug=${encodeURIComponent(slug)}`,
        { auth: true, throwOnError: true }
      );
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        setFallback("로그인 후에 시작 지문을 불러올 수 있어요.");
      } else if (error?.status === 404) {
        setFallback("이 아티스트의 시작 지문이 아직 준비되지 않았어요.");
      } else {
        setFallback("시작 지문을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
      showStarterCard();
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
      input.style.height = Math.min(input.scrollHeight, 140) + "px";
    });
  }

  function bindSubmitGuard() {
    const form = $("chatInputForm");
    if (!form) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
    });
  }

  async function init() {
    const slug = getArtistSlug();
    renderHero(slug, null);
    bindStarterCardEvents();
    bindInputAutoGrow();
    bindSubmitGuard();

    if (!slug) {
      setFallback("아티스트 상세 페이지에서 대화하기 버튼으로 들어오면 시작 지문을 볼 수 있어요.");
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
