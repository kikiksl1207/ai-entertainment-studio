(function initStoryStagePage() {
  "use strict";

  const root = document.getElementById("storyStageRoot");
  if (!root) return;

  const API_ORIGIN = "https://api.lumina-stage.com";
  const COPY = {
    ko: {
      title: "스토리",
      description: "완성된 작품을 선택해 이야기를 시작하세요.",
      loading: "스토리를 불러오는 중입니다.",
      emptyTitle: "등록된 스토리가 없습니다",
      emptyBody: "최종 검수를 마친 작품이 공개되면 이곳에 표시됩니다.",
      retry: "다시 불러오기",
      loadErrorTitle: "스토리를 불러오지 못했습니다",
      loadErrorBody: "잠시 후 다시 시도해 주세요.",
      completed: "완결",
      serializing: "연재 중",
      hiatus: "휴재",
      seasonEnded: "시즌 완결",
      chapters: "파트",
      free: "무료",
      paid: "유료",
      mixed: "일부 무료",
      open: "작품 보기",
      close: "닫기",
      synopsis: "작품 소개",
      chapterList: "파트 목록",
      start: "스토리 시작",
      continue: "이어보기",
      starting: "시작하는 중입니다.",
      startFailed: "지금은 스토리를 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      sceneLoading: "장면을 불러오는 중입니다.",
      sceneFailed: "장면을 불러오지 못했습니다.",
      sceneNoVisual: "장면 이미지가 등록되지 않았습니다.",
      choices: "선택",
      choosing: "다음 장면을 불러오는 중입니다.",
      choiceFailed: "선택을 반영하지 못했습니다. 다시 시도해 주세요.",
      ending: "엔딩",
      backToStories: "스토리 목록",
      loginRequired: "로그인 후 시작할 수 있습니다.",
    },
    en: {
      title: "Stories",
      description: "Choose a completed story and begin your journey.",
      loading: "Loading stories.",
      emptyTitle: "No stories are published yet",
      emptyBody: "Stories appear here after final review and publication.",
      retry: "Try again",
      loadErrorTitle: "Stories could not be loaded",
      loadErrorBody: "Please try again shortly.",
      completed: "Completed",
      serializing: "Ongoing",
      hiatus: "On hiatus",
      seasonEnded: "Season complete",
      chapters: "Parts",
      free: "Free",
      paid: "Paid",
      mixed: "Free chapters",
      open: "View story",
      close: "Close",
      synopsis: "Synopsis",
      chapterList: "Parts",
      start: "Start story",
      continue: "Continue",
      starting: "Starting story.",
      startFailed: "This story cannot be started right now. Please try again shortly.",
      sceneLoading: "Loading scene.",
      sceneFailed: "The scene could not be loaded.",
      sceneNoVisual: "No scene image is registered.",
      choices: "Choose",
      choosing: "Loading the next scene.",
      choiceFailed: "Your choice could not be applied. Please try again.",
      ending: "Ending",
      backToStories: "All stories",
      loginRequired: "Log in to start this story.",
    },
    ja: {
      title: "ストーリー",
      description: "完成した作品を選んで物語を始めましょう。",
      loading: "ストーリーを読み込んでいます。",
      emptyTitle: "公開中のストーリーはありません",
      emptyBody: "最終確認を終えた作品が公開されると、ここに表示されます。",
      retry: "再読み込み",
      loadErrorTitle: "ストーリーを読み込めませんでした",
      loadErrorBody: "しばらくしてからもう一度お試しください。",
      completed: "完結",
      serializing: "連載中",
      hiatus: "休載",
      seasonEnded: "シーズン完結",
      chapters: "パート",
      free: "無料",
      paid: "有料",
      mixed: "一部無料",
      open: "作品を見る",
      close: "閉じる",
      synopsis: "作品紹介",
      chapterList: "パート一覧",
      start: "ストーリー開始",
      continue: "続きから",
      starting: "ストーリーを開始しています。",
      startFailed: "現在このストーリーを開始できません。しばらくしてからお試しください。",
      sceneLoading: "シーンを読み込んでいます。",
      sceneFailed: "シーンを読み込めませんでした。",
      sceneNoVisual: "シーン画像が登録されていません。",
      choices: "選択",
      choosing: "次のシーンを読み込んでいます。",
      choiceFailed: "選択を反映できませんでした。もう一度お試しください。",
      ending: "エンディング",
      backToStories: "ストーリー一覧",
      loginRequired: "ログイン後に開始できます。",
    },
    "zh-Hans": {
      title: "故事",
      description: "选择已完成的作品，开始你的故事。",
      loading: "正在加载故事。",
      emptyTitle: "暂无已发布的故事",
      emptyBody: "通过最终审核并发布的作品会显示在这里。",
      retry: "重新加载",
      loadErrorTitle: "无法加载故事",
      loadErrorBody: "请稍后重试。",
      completed: "已完结",
      serializing: "连载中",
      hiatus: "暂停更新",
      seasonEnded: "本季完结",
      chapters: "章节",
      free: "免费",
      paid: "付费",
      mixed: "部分免费",
      open: "查看作品",
      close: "关闭",
      synopsis: "作品介绍",
      chapterList: "章节列表",
      start: "开始故事",
      continue: "继续阅读",
      starting: "正在开始故事。",
      startFailed: "暂时无法开始此故事，请稍后重试。",
      sceneLoading: "正在加载场景。",
      sceneFailed: "无法加载场景。",
      sceneNoVisual: "尚未上传场景图片。",
      choices: "选择",
      choosing: "正在加载下一个场景。",
      choiceFailed: "无法应用你的选择，请重试。",
      ending: "结局",
      backToStories: "故事列表",
      loginRequired: "登录后即可开始。",
    },
    "zh-Hant": {
      title: "故事",
      description: "選擇已完成的作品，開始你的故事。",
      loading: "正在載入故事。",
      emptyTitle: "暫無已發布的故事",
      emptyBody: "通過最終審核並發布的作品會顯示在這裡。",
      retry: "重新載入",
      loadErrorTitle: "無法載入故事",
      loadErrorBody: "請稍後重試。",
      completed: "已完結",
      serializing: "連載中",
      hiatus: "暫停更新",
      seasonEnded: "本季完結",
      chapters: "章節",
      free: "免費",
      paid: "付費",
      mixed: "部分免費",
      open: "查看作品",
      close: "關閉",
      synopsis: "作品介紹",
      chapterList: "章節列表",
      start: "開始故事",
      continue: "繼續閱讀",
      starting: "正在開始故事。",
      startFailed: "暫時無法開始此故事，請稍後重試。",
      sceneLoading: "正在載入場景。",
      sceneFailed: "無法載入場景。",
      sceneNoVisual: "尚未上傳場景圖片。",
      choices: "選擇",
      choosing: "正在載入下一個場景。",
      choiceFailed: "無法套用你的選擇，請重試。",
      ending: "結局",
      backToStories: "故事列表",
      loginRequired: "登入後即可開始。",
    },
  };

  const state = {
    locale: resolveLocale(),
    packs: [],
    pack: null,
    sessionId: new URLSearchParams(location.search).get("sessionId") || "",
    scene: null,
    choices: [],
    busy: false,
  };

  function resolveLocale() {
    const value = window.luminaI18n?.getLocale?.() || "ko";
    if (value === "zh-CN") return "zh-Hans";
    if (value === "zh-TW" || value === "zh-HK") return "zh-Hant";
    return COPY[value] ? value : "ko";
  }

  function tr(key) {
    return COPY[state.locale]?.[key] || COPY.ko[key] || key;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function textValue(value) {
    if (typeof value === "string") return value.includes(".") && !value.includes(" ") ? "" : value;
    if (!value || typeof value !== "object") return "";
    const regional = state.locale === "ko" ? "ko-KR" : state.locale === "en" ? "en-US" : state.locale === "ja" ? "ja-JP" : state.locale === "zh-Hans" ? "zh-CN" : "zh-Hant";
    return value[state.locale] || value[regional] || value.ko || value["ko-KR"] || value.en || value["en-US"] || "";
  }

  async function request(path, options = {}) {
    if (typeof window.apiFetch === "function") {
      return window.apiFetch(path, { ...options, throwOnError: true });
    }
    const response = await fetch(API_ORIGIN + path, {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }

  function listFrom(payload) {
    if (Array.isArray(payload)) return payload;
    const candidate = payload?.items || payload?.storyPacks || payload?.packs || payload?.data;
    return Array.isArray(candidate) ? candidate : [];
  }

  function lifecycleLabel(status) {
    return tr({ completed: "completed", serializing: "serializing", hiatus: "hiatus", season_ended: "seasonEnded" }[status] || "completed");
  }

  function pricingLabel(mode) {
    return tr(mode === "paid" ? "paid" : mode === "mixed" ? "mixed" : "free");
  }

  function renderLoading(message = tr("loading")) {
    root.innerHTML = `<div class="story-state" role="status"><span class="story-spinner" aria-hidden="true"></span><p>${escapeHtml(message)}</p></div>`;
  }

  function renderState(title, body, retry) {
    root.innerHTML = `
      <section class="story-state">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(body)}</p>
        ${retry ? `<button type="button" class="story-button story-button-secondary" data-story-retry>${escapeHtml(tr("retry"))}</button>` : ""}
      </section>`;
  }

  function coverUrl(pack) {
    return pack?.coverImageUrl || pack?.coverUrl || pack?.cover?.publicUrl || "";
  }

  function packTitle(pack) {
    return textValue(pack?.title) || textValue(pack?.displayTitle);
  }

  function packSummary(pack) {
    return textValue(pack?.summary) || textValue(pack?.synopsis);
  }

  function packSlug(pack) {
    return pack?.slug || pack?.packSlug || "";
  }

  function renderCatalog() {
    updateHeading();
    if (!state.packs.length) {
      renderState(tr("emptyTitle"), tr("emptyBody"), false);
      return;
    }
    root.innerHTML = `
      <section class="story-catalog" aria-label="${escapeHtml(tr("title"))}">
        ${state.packs.map((pack) => {
          const title = packTitle(pack);
          const cover = coverUrl(pack);
          const slug = packSlug(pack);
          if (!title || !slug) return "";
          return `
            <article class="story-pack-card">
              <button type="button" class="story-pack-open" data-pack-slug="${escapeHtml(slug)}" aria-label="${escapeHtml(`${tr("open")}: ${title}`)}">
                <span class="story-pack-cover${cover ? " has-image" : ""}">${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" />` : ""}</span>
                <span class="story-pack-copy">
                  <span class="story-pack-status"><b>${escapeHtml(lifecycleLabel(pack.lifecycleStatus))}</b><em>${escapeHtml(pricingLabel(pack.pricingMode))}</em></span>
                  <strong>${escapeHtml(title)}</strong>
                  ${packSummary(pack) ? `<p>${escapeHtml(packSummary(pack))}</p>` : ""}
                  <small>${escapeHtml(`${Number(pack.chapterCount || pack.partCount || 0)} ${tr("chapters")}`)}</small>
                </span>
              </button>
            </article>`;
        }).join("")}
      </section>`;
  }

  function renderPack() {
    const pack = state.pack;
    if (!pack) return renderCatalog();
    const title = packTitle(pack);
    const cover = coverUrl(pack);
    const chapters = Array.isArray(pack.chapters) ? pack.chapters : [];
    root.innerHTML = `
      <section class="story-pack-detail">
        <button type="button" class="story-back" data-story-back>← ${escapeHtml(tr("backToStories"))}</button>
        <div class="story-detail-main">
          <div class="story-detail-cover${cover ? " has-image" : ""}">${cover ? `<img src="${escapeHtml(cover)}" alt="${escapeHtml(title)}" />` : ""}</div>
          <div class="story-detail-copy">
            <div class="story-pack-status"><b>${escapeHtml(lifecycleLabel(pack.lifecycleStatus))}</b><em>${escapeHtml(pricingLabel(pack.pricingMode))}</em></div>
            <h2>${escapeHtml(title)}</h2>
            ${packSummary(pack) ? `<h3>${escapeHtml(tr("synopsis"))}</h3><p>${escapeHtml(packSummary(pack))}</p>` : ""}
            <button type="button" class="story-button story-button-primary" data-story-start data-pack-slug="${escapeHtml(packSlug(pack))}">${escapeHtml(tr("start"))}</button>
            <p class="story-action-status" data-story-action-status aria-live="polite"></p>
          </div>
        </div>
        ${chapters.length ? `
          <section class="story-chapters">
            <h3>${escapeHtml(tr("chapterList"))}</h3>
            <ol>${chapters.map((chapter) => `<li><span>${escapeHtml(String(chapter.chapterNo || chapter.partNo || chapter.no || ""))}</span><strong>${escapeHtml(textValue(chapter.title) || textValue(chapter.summary))}</strong></li>`).join("")}</ol>
          </section>` : ""}
      </section>`;
  }

  function sceneBackground(scene) {
    return scene?.backgroundAsset?.publicUrl || scene?.backgroundAsset?.url || scene?.backgroundUrl || "";
  }

  function characterUrl(character) {
    return character?.publicAssetUrl || character?.assetUrl || character?.imageUrl || "";
  }

  function renderScene() {
    const scene = state.scene;
    if (!scene) return renderState(tr("sceneFailed"), tr("loadErrorBody"), true);
    const background = sceneBackground(scene);
    const characters = Array.isArray(scene.characters) ? scene.characters.filter((item) => characterUrl(item)) : [];
    const sceneText = textValue(scene.sceneText) || textValue(scene.body) || textValue(scene.content);
    const isEnding = Boolean(scene.ending || scene.isEnding || scene.endingType);
    root.innerHTML = `
      <section class="story-player" data-has-background="${background ? "true" : "false"}">
        <a class="story-back" href="/story-stage">← ${escapeHtml(tr("backToStories"))}</a>
        <div class="story-player-stage">
          ${background ? `<img class="story-player-background" src="${escapeHtml(background)}" alt="" />` : `<div class="story-player-no-visual">${escapeHtml(tr("sceneNoVisual"))}</div>`}
          <div class="story-player-characters" aria-hidden="true">
            ${characters.map((character, index) => `<img src="${escapeHtml(characterUrl(character))}" alt="" data-side="${escapeHtml(character.side || (index % 2 ? "right" : "left"))}" />`).join("")}
          </div>
          <div class="story-player-copy">
            ${isEnding ? `<span class="story-ending-label">${escapeHtml(tr("ending"))}</span>` : ""}
            <p>${escapeHtml(sceneText)}</p>
          </div>
        </div>
        ${state.choices.length && !isEnding ? `
          <div class="story-choice-panel">
            <h2>${escapeHtml(tr("choices"))}</h2>
            <div class="story-choice-list">
              ${state.choices.map((choice) => `<button type="button" data-choice-id="${escapeHtml(choice.choiceId || choice.id || "")}">${escapeHtml(textValue(choice.label) || textValue(choice.choiceBody) || textValue(choice.body))}</button>`).join("")}
            </div>
            <p class="story-action-status" data-story-action-status aria-live="polite"></p>
          </div>` : ""}
      </section>`;
  }

  function updateHeading() {
    const title = document.getElementById("storyStageTitle");
    const description = document.getElementById("storyStageDescription");
    if (title) title.textContent = tr("title");
    if (description) description.textContent = tr("description");
  }

  async function loadCatalog() {
    state.pack = null;
    renderLoading();
    try {
      const payload = await request(`/api/v1/story-packs?locale=${encodeURIComponent(state.locale)}`);
      state.packs = listFrom(payload).filter((pack) => packSlug(pack) && packTitle(pack));
      const requestedSlug = new URLSearchParams(location.search).get("slug") || new URLSearchParams(location.search).get("pack");
      if (requestedSlug) return loadPack(requestedSlug);
      renderCatalog();
    } catch (_) {
      state.packs = [];
      renderCatalog();
    }
  }

  async function loadPack(slug) {
    renderLoading();
    try {
      state.pack = await request(`/api/v1/story-packs/${encodeURIComponent(slug)}?locale=${encodeURIComponent(state.locale)}`);
    } catch (_) {
      state.pack = state.packs.find((pack) => packSlug(pack) === slug) || null;
    }
    if (!state.pack) return renderState(tr("loadErrorTitle"), tr("loadErrorBody"), true);
    history.replaceState(null, "", `/story-stage?slug=${encodeURIComponent(slug)}`);
    renderPack();
  }

  async function startStory(slug) {
    if (state.busy || !slug) return;
    state.busy = true;
    const status = root.querySelector("[data-story-action-status]");
    if (status) status.textContent = tr("starting");
    try {
      const payload = await request(`/api/v1/story-packs/${encodeURIComponent(slug)}/sessions`, {
        method: "POST",
        auth: true,
        headers: { "Idempotency-Key": `story-start-${slug}-${Date.now()}` },
        body: { locale: state.locale },
      });
      const sessionId = payload?.sessionId || payload?.id || payload?.session?.id;
      if (!sessionId) throw new Error("Missing session id");
      location.href = `/story-stage?sessionId=${encodeURIComponent(sessionId)}`;
    } catch (error) {
      if (status) status.textContent = error?.status === 401 ? tr("loginRequired") : tr("startFailed");
      state.busy = false;
    }
  }

  async function loadScene() {
    renderLoading(tr("sceneLoading"));
    try {
      state.scene = await request(`/api/v1/story-sessions/${encodeURIComponent(state.sessionId)}/current-scene`, { auth: true });
      state.choices = Array.isArray(state.scene?.choices) ? state.scene.choices : listFrom(await request(`/api/v1/story-sessions/${encodeURIComponent(state.sessionId)}/choices`, { auth: true }));
      renderScene();
    } catch (_) {
      renderState(tr("sceneFailed"), tr("loadErrorBody"), true);
    }
  }

  async function submitChoice(choiceId) {
    if (state.busy || !choiceId || !state.scene?.sceneId) return;
    state.busy = true;
    const status = root.querySelector("[data-story-action-status]");
    if (status) status.textContent = tr("choosing");
    try {
      await request(`/api/v1/story-sessions/${encodeURIComponent(state.sessionId)}/scenes/${encodeURIComponent(state.scene.sceneId)}/choices`, {
        method: "POST",
        auth: true,
        headers: { "Idempotency-Key": `story-choice-${state.sessionId}-${state.scene.sceneId}-${choiceId}` },
        body: { choiceId },
      });
      state.busy = false;
      await loadScene();
    } catch (_) {
      if (status) status.textContent = tr("choiceFailed");
      state.busy = false;
    }
  }

  root.addEventListener("click", (event) => {
    const packButton = event.target.closest("[data-pack-slug]");
    if (packButton && !packButton.matches("[data-story-start]")) return loadPack(packButton.dataset.packSlug);
    if (event.target.closest("[data-story-back]")) {
      state.pack = null;
      history.replaceState(null, "", "/story-stage");
      renderCatalog();
      return;
    }
    const startButton = event.target.closest("[data-story-start]");
    if (startButton) return startStory(startButton.dataset.packSlug);
    const choiceButton = event.target.closest("[data-choice-id]");
    if (choiceButton) return submitChoice(choiceButton.dataset.choiceId);
    if (event.target.closest("[data-story-retry]")) return state.sessionId ? loadScene() : loadCatalog();
  });

  updateHeading();
  if (state.sessionId) loadScene();
  else loadCatalog();
})();
