(function initStoryStagePage() {
  "use strict";

  const STORY_FIXTURE = Object.freeze({
    prologue: {
      title: "무료 프롤로그",
      summary: "계정당 1회, 본인 또는 동반 캐릭터 한 명과 함께 첫 이야기를 무료로 열어볼 수 있어요.",
      runtime: "약 10분 분량",
      freePerAccount: 1,
      companionMax: 1,
    },
    chapters: [
      { no: 1, title: "첫 무대의 떨림", priceLumina: 120, summary: "데뷔 직전, 무대 뒤에서 시작되는 첫 장면." },
      { no: 2, title: "흔들리는 스포트라이트", priceLumina: 150, summary: "예상치 못한 사고로 달라지는 선택." },
      { no: 3, title: "다시, 처음처럼", priceLumina: 150, summary: "무너진 자리에서 다시 서로를 마주하는 순간." },
    ],
    season: {
      title: "시즌 1 · 데뷔의 계절",
      chapterCount: 8,
      bundlePriceLumina: 880,
      singleSumLumina: 1120,
    },
    video: {
      perClipLumina: 60,
      note: "장면을 영상으로 만들 때만 드는 선택 비용이에요. 챕터 구매와 별개이고, 만들지 않으면 청구되지 않아요.",
    },
    reactions: {
      chapters: [
        { no: 1, rating: 4.7, readers: 312, comments: 48 },
        { no: 2, rating: 4.5, readers: 268, comments: 33 },
        { no: 3, rating: 4.8, readers: 241, comments: 51 },
      ],
      storyComments: [
        { author: "별빛_수아", paid: true, completed: true, text: "프롤로그만 보려다 시즌까지 갔어요. 장면마다 분위기가 달라서 몰입돼요." },
        { author: "조용한 관객", paid: true, completed: false, text: "챕터마다 선택지가 달라지는 게 좋아요. 다음 장면을 기다리게 돼요." },
        { author: "오늘의러너", paid: true, completed: true, text: "캐릭터가 없는 장면도 배경이 바뀌니까 흐름이 끊기지 않았어요." },
      ],
    },
  });

  const STORY_SCENE_COPY = Object.freeze({
    "storyStage.scene.assetFallback.default": {
      "ko-KR": "장면 연출을 준비 중이에요.",
      "ja-JP": "シーン演出を準備中です。",
      "en-US": "Preparing scene visuals.",
      "zh-CN": "正在准备场景演出。",
      "zh-Hant": "正在準備場景演出。",
    },
    "storyStage.scene.background.loading": {
      "ko-KR": "배경을 불러오는 중이에요.",
      "ja-JP": "背景を読み込み中です。",
      "en-US": "Loading background.",
      "zh-CN": "正在加载背景。",
      "zh-Hant": "正在載入背景。",
    },
    "storyStage.scene.background.missing": {
      "ko-KR": "기본 배경으로 장면을 이어갈게요.",
      "ja-JP": "基本の背景で続けます。",
      "en-US": "Using default background.",
      "zh-CN": "使用默认背景继续。",
      "zh-Hant": "使用預設背景繼續。",
    },
    "storyStage.scene.background.altDefault": {
      "ko-KR": "스토리 기본 배경",
      "ja-JP": "ストーリー基本背景",
      "en-US": "Default background",
      "zh-CN": "故事默认背景",
      "zh-Hant": "故事預設背景",
    },
    "storyStage.scene.character.loading": {
      "ko-KR": "캐릭터를 불러오는 중이에요.",
      "ja-JP": "キャラクターを読み込み中です。",
      "en-US": "Loading character.",
      "zh-CN": "正在加载角色。",
      "zh-Hant": "正在載入角色。",
    },
    "storyStage.scene.character.missing": {
      "ko-KR": "캐릭터 없이 장면을 이어갈게요.",
      "ja-JP": "キャラクターなしで続けます。",
      "en-US": "No character in this scene.",
      "zh-CN": "本场景没有角色。",
      "zh-Hant": "本場景沒有角色。",
    },
    "storyStage.scene.character.altDefault": {
      "ko-KR": "캐릭터 기본 이미지",
      "ja-JP": "キャラクター基本画像",
      "en-US": "Default character",
      "zh-CN": "角色默认图片",
      "zh-Hant": "角色預設圖片",
    },
    "storyStage.scene.visual.unavailable": {
      "ko-KR": "장면 연출을 불러오지 못했어요.",
      "ja-JP": "シーン演出を読み込めませんでした。",
      "en-US": "Scene could not load.",
      "zh-CN": "无法加载场景演出。",
      "zh-Hant": "無法載入場景演出。",
    },
    "storyStage.scene.preview.prev": {
      "ko-KR": "이전 장면",
      "ja-JP": "前のシーン",
      "en-US": "Previous scene",
      "zh-CN": "上一场景",
      "zh-Hant": "上一場景",
    },
    "storyStage.scene.preview.next": {
      "ko-KR": "다음 장면",
      "ja-JP": "次のシーン",
      "en-US": "Next scene",
      "zh-CN": "下一场景",
      "zh-Hant": "下一場景",
    },
    "storyStage.scene.retry": {
      "ko-KR": "다시 시도",
      "ja-JP": "再試行",
      "en-US": "Retry",
      "zh-CN": "重试",
      "zh-Hant": "重試",
    },
    "storyStage.preview.notice.title": {
      "ko-KR": "미리보기 화면",
      "ja-JP": "プレビュー画面",
      "en-US": "Preview screen",
      "zh-CN": "预览画面",
      "zh-Hant": "預覽畫面",
    },
    "storyStage.preview.notice.body": {
      "ko-KR": "이 화면은 저장되지 않는 읽기 전용 미리보기예요.",
      "ja-JP": "この画面は保存されない読み取り専用プレビューです。",
      "en-US": "This is a read-only preview and nothing is saved.",
      "zh-CN": "这是不会保存内容的只读预览。",
      "zh-Hant": "這是不會儲存內容的唯讀預覽。",
    },
    "storyStage.setup.visibility.private": {
      "ko-KR": "나만 보는 미리보기",
      "ja-JP": "自分だけのプレビュー",
      "en-US": "Private preview",
      "zh-CN": "仅自己可见的预览",
      "zh-Hant": "僅自己可見的預覽",
    },
    "storyStage.setup.eyebrow": {
      "ko-KR": "나 + AI",
      "ja-JP": "自分 + AI",
      "en-US": "Me + AI",
      "zh-CN": "我 + AI",
      "zh-Hant": "我 + AI",
    },
    "storyStage.scene.fixture.01": {
      "ko-KR": "첫 리허설 조명이 켜지고, 도현이 무대 중앙으로 걸어 나옵니다.",
      "ja-JP": "最初のリハーサル照明が灯り、ドヒョンがステージ中央へ歩き出します。",
      "en-US": "The first rehearsal light turns on, and Dohyun walks to center stage.",
      "zh-CN": "第一次排练灯亮起，道贤走向舞台中央。",
      "zh-Hant": "第一次排練燈亮起，道賢走向舞台中央。",
    },
    "storyStage.scene.fixture.02": {
      "ko-KR": "객석 불빛만 남은 장면입니다. 캐릭터 없이 감정의 여백을 보여줍니다.",
      "ja-JP": "客席の灯りだけが残るシーンです。キャラクターなしで余韻を見せます。",
      "en-US": "Only the audience lights remain, leaving room for the emotion without a character.",
      "zh-CN": "只剩观众席的灯光，没有角色也保留情绪的余白。",
      "zh-Hant": "只剩觀眾席的燈光，沒有角色也保留情緒的餘白。",
    },
    "storyStage.scene.fixture.03": {
      "ko-KR": "배경 에셋이 아직 준비되지 않아도 기본 장면으로 이야기를 이어갑니다.",
      "ja-JP": "背景アセットが未準備でも、基本シーンで物語を続けます。",
      "en-US": "If a background asset is not ready, the story continues with the default scene.",
      "zh-CN": "即使背景素材尚未准备好，也会用默认场景继续故事。",
      "zh-Hant": "即使背景素材尚未準備好，也會用預設場景繼續故事。",
    },
  });

  const STORY_LOCALES = [
    { code: "ko", label: "KO" },
    { code: "en", label: "EN" },
    { code: "ja", label: "JA" },
    { code: "zh-Hans", label: "简" },
    { code: "zh-Hant", label: "繁" },
  ];

  const STORY_DISCOVERY_ITEMS = [
    {
      id: "imjin",
      titleKey: "storyStage.discovery.card.imjin.title",
      summaryKey: "storyStage.discovery.card.imjin.summary",
      statusKey: "storyStage.discovery.status.free",
      tags: ["History", "Tutorial"],
      metric: "4.8 · 1.2k",
      image: "/assets/brand/lumina-stage-banner.png",
    },
    {
      id: "stage",
      titleKey: "storyStage.discovery.card.stage.title",
      summaryKey: "storyStage.discovery.card.stage.summary",
      statusKey: "storyStage.discovery.status.ready",
      tags: ["Stage", "AI"],
      metric: "4.7 · 840",
      image: "/assets/characters/cha-dohyun/reference-final-03.png",
    },
    {
      id: "myth",
      titleKey: "storyStage.discovery.card.myth.title",
      summaryKey: "storyStage.discovery.card.myth.summary",
      statusKey: "storyStage.discovery.status.ready",
      tags: ["Myth", "Safe"],
      metric: "4.6 · 620",
      image: "/assets/characters/choi-seojin/cover.png",
    },
  ];

  const STORY_SCENE_FALLBACKS = [
    {
      sceneId: "fixture-scene-01",
      sceneTextKey: "storyStage.scene.fixture.01",
      sceneText: "첫 리허설 조명이 켜지고, 도현이 무대 중앙으로 걸어 나옵니다.",
      backgroundState: "ready",
      backgroundAsset: {
        assetId: "scene.background.rehearsal",
        url: "/assets/brand/lumina-stage-banner.png",
        labelKey: "storyStage.scene.background.altDefault",
      },
      fallbackKey: "storyStage.scene.assetFallback.default",
      characters: [
        {
          characterId: "cha-dohyun",
          artistSlug: "cha-dohyun",
          displayNameKey: "storyStage.scene.character.altDefault",
          assetId: "character.cha-dohyun.reference",
          url: "/assets/characters/cha-dohyun/reference-final-03.png",
          characterPose: "neutral",
          characterLayer: "foreground",
          entranceState: "entered",
        },
      ],
    },
    {
      sceneId: "fixture-scene-02",
      sceneTextKey: "storyStage.scene.fixture.02",
      sceneText: "객석 불빛만 남은 장면입니다. 캐릭터 없이 감정의 여백을 보여줍니다.",
      backgroundState: "ready",
      backgroundAsset: {
        assetId: "scene.background.quiet-stage",
        url: "/assets/characters/choi-seojin/cover.png",
        labelKey: "storyStage.scene.background.altDefault",
      },
      fallbackKey: "storyStage.scene.character.missing",
      characters: [],
    },
    {
      sceneId: "fixture-scene-03",
      sceneTextKey: "storyStage.scene.fixture.03",
      sceneText: "배경 에셋이 아직 준비되지 않아도 기본 장면으로 이야기를 이어갑니다.",
      backgroundState: "fallback",
      backgroundAsset: null,
      fallbackKey: "storyStage.scene.background.missing",
      characters: [
        {
          characterId: "choi-seojin",
          artistSlug: "choi-seojin",
          displayNameKey: "storyStage.scene.character.altDefault",
          assetId: "character.choi-seojin.placeholder",
          url: "/assets/characters/choi-seojin/thumb.png",
          characterPose: "listening",
          characterLayer: "midground",
          entranceState: "entered",
        },
      ],
    },
  ];

  const STORY_BRANCH_IMPLEMENTATION_FIXTURE = [
    {
      label: "A",
      choiceKey: "storyUpload.choice.recordFirst",
      nextSceneId: "S05",
      sceneTitle: "Archive map room",
      bodySummary: "The player checks the record first and unlocks a safer clue path.",
      stateDelta: "infoGained + trustUp",
      endingRoute: "E-SUB-01",
      endingType: "writer_sub_ending",
      backgroundState: "bg-war-room-map",
      rejoin: "S09",
    },
    {
      label: "B",
      choiceKey: "storyUpload.choice.followMessenger",
      nextSceneId: "S06",
      sceneTitle: "Night harbor pursuit",
      bodySummary: "The player follows the messenger and takes a higher-risk item route.",
      stateDelta: "riskRaised + itemGained",
      endingRoute: "E-SUB-02",
      endingType: "writer_sub_ending",
      backgroundState: "bg-harbor-night",
      rejoin: "S09",
    },
    {
      label: "C",
      choiceKey: "storyUpload.choice.shoreDetour",
      nextSceneId: "S07",
      sceneTitle: "Fog shore detour",
      bodySummary: "The player detours to the shore and enters an unresolved branch.",
      stateDelta: "relationshipShift + aiFallbackCondition",
      endingRoute: "E-AI-01",
      endingType: "ai_fallback_ending",
      backgroundState: "bg-fog-shore",
      rejoin: "No rejoin before fallback review",
    },
  ];

  let _storyScenes = STORY_SCENE_FALLBACKS.slice();
  let _storySceneIndex = 0;

  function lumina(n) {
    return (Number(n) || 0).toLocaleString("ko-KR") + " L";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function storyLocale() {
    const locale = window.luminaI18n?.getRegionalLocale?.() || window.luminaI18n?.getLocale?.();
    if (locale) return locale;
    return document.documentElement.lang || "ko-KR";
  }

  function storyT(key) {
    const liveValue = window.luminaI18n?.t?.(key);
    if (liveValue && liveValue !== key) return liveValue;
    const locale = storyLocale();
    const entry = STORY_SCENE_COPY[key];
    return entry?.[locale] || entry?.["ko-KR"] || key;
  }

  function storyLocalT(key) {
    const locale = storyLocale();
    const entry = STORY_SCENE_COPY[key];
    return entry?.[locale] || entry?.["ko-KR"] || storyT(key);
  }

  function companionOptions() {
    const data = window.LuminaStaticData || null;
    const all = data && Array.isArray(data.characters) ? data.characters : [];
    return all
      .filter(a => a && (a.status === "public" || a.status === "debut"))
      .slice(0, 6)
      .map(a => ({ slug: a.slug, name: a.publicName || a.name || a.slug }));
  }

  function isFixturePreview() {
    const params = new URLSearchParams(window.location.search || "");
    return params.get("storySceneFixturePreview") === "1"
      || params.get("storyfixture") === "1"
      || params.get("scenefixture") === "1";
  }

  function normalizeAssetUrl(url) {
    const value = String(url || "").trim();
    if (!value) return "";
    if (value.startsWith("./assets/")) return "/" + value.slice(2);
    if (value.startsWith("assets/")) return "/" + value;
    return value;
  }

  function normalizeScene(scene, index) {
    const safeScene = scene && typeof scene === "object" ? scene : {};
    const bg = safeScene.backgroundAsset && typeof safeScene.backgroundAsset === "object"
      ? Object.assign({}, safeScene.backgroundAsset, { url: normalizeAssetUrl(safeScene.backgroundAsset.url || safeScene.backgroundAsset.publicUrl) })
      : null;
    const characters = Array.isArray(safeScene.characters) ? safeScene.characters : [];
    return {
      sceneId: String(safeScene.sceneId || safeScene.id || "scene-" + (index + 1)),
      sceneTextKey: safeScene.sceneTextKey ? String(safeScene.sceneTextKey) : "",
      sceneText: String(safeScene.sceneText || safeScene.text || ""),
      backgroundState: String(safeScene.backgroundState || (bg?.url ? "ready" : "fallback")),
      backgroundAsset: bg,
      fallbackKey: String(safeScene.fallbackKey || "storyStage.scene.assetFallback.default"),
      characters: characters.slice(0, 4).map((character, i) => ({
        characterId: String(character.characterId || character.id || "character-" + i),
        artistSlug: String(character.artistSlug || ""),
        displayNameKey: String(character.displayNameKey || "storyStage.scene.character.altDefault"),
        assetId: String(character.assetId || ""),
        url: normalizeAssetUrl(character.url || character.publicUrl || character.assetUrl),
        characterPose: String(character.characterPose || character.pose || "neutral"),
        characterLayer: String(character.characterLayer || character.layer || "midground"),
        entranceState: String(character.entranceState || "entered"),
      })),
    };
  }

  async function loadScenePreviewFixtures() {
    if (!isFixturePreview()) return STORY_SCENE_FALLBACKS.slice();
    try {
      const path = "/api/v1/story-sessions/fixtures/story-scene-preview/scenes";
      let response = null;
      if (typeof window.apiFetch === "function") {
        response = await window.apiFetch(path, { throwOnError: true });
      } else {
        const res = await fetch(path, { credentials: "omit" });
        if (res.ok) response = await res.json();
      }
      const scenes = Array.isArray(response) ? response : response?.scenes;
      if (Array.isArray(scenes) && scenes.length) return scenes.map(normalizeScene);
    } catch (_) {
      // Fixture preview must stay usable even before the backend branch is reflected on main.
    }
    return STORY_SCENE_FALLBACKS.slice();
  }

  function sceneStatusI18nKey(scene) {
    const bgState = String(scene?.backgroundState || "");
    if (bgState === "loading") return "storyStage.scene.background.loading";
    if (bgState === "missing" || bgState === "fallback") return "storyStage.scene.background.missing";
    if (!scene?.characters || scene.characters.length === 0) return "storyStage.scene.character.missing";
    return "";
  }

  function renderStoryScene(scene) {
    const stage = document.querySelector("[data-story-scene-stage]");
    if (!stage) return;

    const activeScene = normalizeScene(scene || STORY_SCENE_FALLBACKS[0], 0);
    const bg = activeScene.backgroundAsset;
    const hasBackground = bg && bg.url && activeScene.backgroundState === "ready";
    const visibleCharacters = activeScene.characters.filter(c => c.characterLayer !== "offscreen");
    const characterWithAsset = visibleCharacters.filter(c => c.url);
    const statusKey = sceneStatusI18nKey(activeScene);

    stage.dataset.sceneId = activeScene.sceneId;
    stage.dataset.bgState = hasBackground ? "ready" : "fallback";
    stage.dataset.hasCharacters = characterWithAsset.length > 0 ? "true" : "false";
    const bgWrap = stage.querySelector("[data-scene-bg]");
    const bgImg = stage.querySelector("[data-scene-bg-img]");
    const chars = stage.querySelector("[data-scene-characters]");
    const text = stage.querySelector("[data-scene-text]");
    const status = stage.querySelector("[data-scene-visual-status]");
    const fallback = stage.querySelector("[data-scene-fallback]");
    const fallbackCopy = stage.querySelector("[data-scene-fallback-copy]");
    const fallbackRetry = stage.querySelector("[data-scene-retry]");

    if (bgWrap) bgWrap.dataset.bgState = hasBackground ? "ready" : "fallback";
    if (bgImg) {
      if (hasBackground) {
        bgImg.hidden = false;
        bgImg.src = bg.url;
      } else {
        bgImg.hidden = true;
        bgImg.removeAttribute("src");
      }
      bgImg.alt = storyT(bg?.labelKey || "storyStage.scene.background.altDefault");
      bgImg.setAttribute("data-i18n-alt", bg?.labelKey || "storyStage.scene.background.altDefault");
    }

    if (chars) {
      chars.innerHTML = characterWithAsset.map((character, index) => {
        const side = index % 2 === 0 ? "left" : "right";
        return (
          '<img class="scene-char" src="' + escapeHtml(character.url) + '" ' +
          'data-layer="' + escapeHtml(character.characterLayer) + '" ' +
          'data-pose="' + escapeHtml(character.characterPose) + '" ' +
          'data-side="' + side + '" ' +
          'alt="' + escapeHtml(storyT(character.displayNameKey || "storyStage.scene.character.altDefault")) + '" ' +
          'data-i18n-alt="' + escapeHtml(character.displayNameKey || "storyStage.scene.character.altDefault") + '" ' +
          'loading="lazy" decoding="async" />'
        );
      }).join("");
    }

    if (text) text.textContent = activeScene.sceneTextKey ? storyT(activeScene.sceneTextKey) : activeScene.sceneText;
    if (status) {
      if (statusKey) {
        status.hidden = false;
        status.textContent = storyT(statusKey);
        status.dataset.i18n = statusKey;
      } else {
        status.hidden = true;
        status.textContent = "";
        status.removeAttribute("data-i18n");
      }
    }
    if (fallback) {
      const showFallback = !hasBackground || (visibleCharacters.length > 0 && characterWithAsset.length === 0);
      fallback.hidden = !showFallback;
      fallback.dataset.bgState = hasBackground ? "ready" : "fallback";
      if (fallbackCopy) {
        const fallbackKey = statusKey || activeScene.fallbackKey || "storyStage.scene.assetFallback.default";
        fallbackCopy.textContent = storyT(fallbackKey);
        fallbackCopy.dataset.i18n = fallbackKey;
      }
      if (fallbackRetry) {
        fallbackRetry.textContent = storyT("storyStage.scene.retry");
        fallbackRetry.dataset.i18n = "storyStage.scene.retry";
      }
    }

    const count = document.querySelector("[data-scene-count]");
    if (count) count.textContent = (_storySceneIndex + 1) + " / " + _storyScenes.length;
    window.luminaI18n?.apply?.(stage);
  }

  function renderScenePreviewShell(fixtureMode) {
    return `
      <section class="story-section story-scene-section" aria-labelledby="storySceneTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-scene">Scene Visual</span>
          <h2 id="storySceneTitle">장면 연출 미리보기</h2>
        </div>
        <section class="story-scene-stage" data-story-scene-stage data-scene-id="" aria-label="스토리 장면" aria-live="polite">
          <div class="scene-bg" data-scene-bg data-bg-state="ready">
            <img class="scene-bg-img" alt="" data-scene-bg-img data-i18n-alt="storyStage.scene.background.altDefault" />
          </div>
          <div class="scene-characters" data-scene-characters></div>
          <div class="scene-text-overlay">
            <p class="scene-text" data-scene-text></p>
          </div>
          <p class="scene-visual-status" data-scene-visual-status role="status" hidden></p>
          <div class="scene-fallback" data-scene-fallback data-bg-state="missing" hidden>
            <p class="scene-fallback-copy" data-scene-fallback-copy data-i18n="storyStage.scene.background.missing">기본 배경으로 장면을 이어갈게요.</p>
            <button class="scene-retry" type="button" data-scene-retry data-i18n="storyStage.scene.retry">다시 시도</button>
          </div>
        </section>
        <nav class="scene-preview-nav" data-fixture-only ${fixtureMode ? "" : "hidden"}>
          <button type="button" data-scene-prev data-i18n="storyStage.scene.preview.prev">이전 장면</button>
          <span class="scene-preview-count" data-scene-count>1 / 3</span>
          <button type="button" data-scene-next data-i18n="storyStage.scene.preview.next">다음 장면</button>
        </nav>
      </section>
    `;
  }

  function renderLocaleQaShell() {
    return `
      <section class="story-section story-locale-section" aria-labelledby="storyLocaleTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-extra">i18n</span>
          <h2 id="storyLocaleTitle" data-i18n="storyStage.locale.heading">언어 QA</h2>
        </div>
        <div class="story-locale-panel">
          <p data-i18n="storyStage.locale.note">스토리 화면 문구를 5개 언어로 즉시 전환해 길이와 줄바꿈을 확인해요.</p>
          <div class="story-locale-buttons" role="group" aria-label="Story locale QA">
            ${STORY_LOCALES.map(locale => `
              <button type="button" data-story-locale="${locale.code}" aria-pressed="false">${locale.label}</button>
            `).join("")}
          </div>
        </div>
      </section>
    `;
  }

  function renderDiscoveryShell() {
    const filters = [
      "storyStage.discovery.filter.recommended",
      "storyStage.discovery.filter.taste",
      "storyStage.discovery.filter.new",
      "storyStage.discovery.filter.ranking",
      "storyStage.discovery.filter.today",
      "storyStage.discovery.filter.genre",
    ];
    return `
      <section class="story-section story-discovery-section" aria-labelledby="storyDiscoveryTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-free">Discovery</span>
          <h2 id="storyDiscoveryTitle" data-i18n="storyStage.discovery.heading">스토리 찾기</h2>
        </div>
        <div class="story-filter-row" role="list" aria-label="Story filters">
          ${filters.map((key, index) => `
            <button type="button" class="story-filter-chip${index === 0 ? " is-active" : ""}" data-i18n="${key}" aria-pressed="${index === 0 ? "true" : "false"}">${storyT(key)}</button>
          `).join("")}
        </div>
        <div class="story-discovery-grid">
          ${STORY_DISCOVERY_ITEMS.map(item => `
            <article class="story-discovery-card" data-story-detail="${escapeHtml(item.id)}" tabindex="0" role="button" aria-label="${escapeHtml(storyT(item.titleKey))}">
              <div class="story-discovery-cover" style="background-image: linear-gradient(180deg, rgba(8,5,18,0.04), rgba(8,5,18,0.52)), url('${escapeHtml(item.image)}')"></div>
              <div class="story-discovery-body">
                <span class="story-discovery-status" data-i18n="${item.statusKey}">${storyT(item.statusKey)}</span>
                <h3 data-i18n="${item.titleKey}">${storyT(item.titleKey)}</h3>
                <p data-i18n="${item.summaryKey}">${storyT(item.summaryKey)}</p>
                <div class="story-discovery-meta">
                  <span>${escapeHtml(item.metric)}</span>
                  <span>${item.tags.map(escapeHtml).join(" · ")}</span>
                </div>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderDetailShell() {
    return `
      <section class="story-detail-sheet" data-story-detail-sheet hidden aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="storyDetailTitle">
        <button class="story-detail-close" type="button" data-story-detail-close data-i18n-aria="storyStage.detail.close" aria-label="닫기">×</button>
        <div class="story-detail-cover" aria-hidden="true"></div>
        <div class="story-detail-body">
          <span class="story-eyebrow story-eyebrow-scene" data-i18n="storyStage.detail.heading">스토리 상세</span>
          <h2 id="storyDetailTitle" data-i18n="storyStage.discovery.card.imjin.title">임진왜란: 난중일기 프롤로그</h2>
          <p data-i18n="storyStage.discovery.card.imjin.summary">전장의 기록 사이로 들어가 첫 선택을 해요.</p>
          <dl class="story-detail-list">
            <div><dt data-i18n="storyStage.detail.creator">AI 아티스트</dt><dd>Cha Dohyun</dd></div>
            <div><dt data-i18n="storyStage.detail.profile">대화 프로필</dt><dd data-i18n="storyStage.setup.note">무료 프롤로그는 나 또는 AI 아티스트 1명과 시작해요.</dd></div>
            <div><dt data-i18n="storyStage.detail.prologue">프롤로그 미리보기</dt><dd data-i18n="storyStage.tutorial.detail">역사 기록의 결을 살린 짧은 프롤로그예요. 외부 번역문이나 특정 게임 문구를 쓰지 않고, Lumina의 장면형 선택 흐름으로 시작합니다.</dd></div>
            <div><dt data-i18n="storyStage.detail.similar">비슷한 스토리</dt><dd data-i18n="storyStage.discovery.card.stage.title">첫 무대의 떨림</dd></div>
          </dl>
          <div class="story-detail-actions">
            <button class="story-cta story-cta-free" type="button" aria-disabled="true" data-i18n="storyStage.detail.cta.free">무료 프롤로그 시작</button>
            <button class="story-cta story-cta-extra" type="button" aria-disabled="true" data-i18n="storyStage.detail.cta.continue">이어하기</button>
            <button class="story-cta story-cta-paid" type="button" aria-disabled="true" data-i18n="storyStage.detail.cta.locked">구매 필요</button>
          </div>
        </div>
      </section>
      <div class="story-detail-backdrop" data-story-detail-backdrop hidden></div>
    `;
  }

  function renderSetupShell() {
    return `
      <section class="story-section story-setup-section" aria-labelledby="storySetupTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-free">${storyLocalT("storyStage.setup.eyebrow")}</span>
          <h2 id="storySetupTitle" data-i18n="storyStage.setup.heading">나 + AI 동반 설정</h2>
        </div>
        <div class="story-setup-grid">
          <article class="story-setup-item">
            <strong data-i18n="storyStage.setup.profile">대화 프로필</strong>
            <p data-i18n="storyStage.setup.note">무료 프롤로그는 나 또는 AI 아티스트 1명과 시작해요.</p>
          </article>
          <article class="story-setup-item">
            <strong data-i18n="storyStage.setup.start">시작 설정</strong>
            <p data-i18n="storyStage.tutorial.status">프롤로그를 준비 중이에요.</p>
          </article>
          <article class="story-setup-item">
            <strong data-i18n="storyStage.setup.companion">동반 AI</strong>
            <p data-i18n="storyStage.player.status">배경 위에 대화와 선택지를 겹치지 않게 보여줘요.</p>
          </article>
          <article class="story-setup-item">
            <strong data-i18n="storyStage.setup.visibility">공개 범위</strong>
            <p>${storyLocalT("storyStage.setup.visibility.private")}</p>
          </article>
        </div>
      </section>
    `;
  }

  function renderPlayerShell() {
    return `
      <section class="story-section story-player-section" aria-labelledby="storyPlayerTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-scene">Immersive MVP</span>
          <h2 id="storyPlayerTitle" data-i18n="storyStage.player.heading">장면 속에서 대화하기</h2>
        </div>
        <div class="story-player-shell" aria-label="몰입형 스토리 플레이어 미리보기">
          <div class="story-player-bg" role="img" aria-label="스토리 장면 배경"></div>
          <img class="story-player-character" src="/assets/characters/cha-dohyun/reference-final-03.png" alt="캐릭터 기본 이미지" data-i18n-alt="storyStage.scene.character.altDefault" loading="lazy" decoding="async" />
          <div class="story-player-overlay">
            <p class="story-player-status" data-i18n="storyStage.player.status">배경 위에 대화와 선택지를 겹치지 않게 보여줘요.</p>
            <div class="story-player-chat" role="log" aria-live="polite">
              <p class="story-player-bubble is-ai" data-i18n="storyStage.player.aiLine">조명이 바뀌었어요. 다음 선택을 같이 골라볼까요?</p>
            </div>
            <div class="story-player-choices" role="group" aria-label="스토리 선택지">
              <button type="button" data-i18n="storyStage.player.choice.focus" aria-disabled="true">무대 쪽으로 다가간다</button>
              <button type="button" data-i18n="storyStage.player.choice.listen" aria-disabled="true">잠시 더 지켜본다</button>
            </div>
            <label class="story-player-input">
              <span data-i18n="storyStage.player.userPlaceholder">내 반응을 짧게 남기기</span>
              <input type="text" disabled aria-disabled="true" data-i18n-attr="placeholder:storyStage.player.userPlaceholder" placeholder="내 반응을 짧게 남기기" />
            </label>
          </div>
        </div>
      </section>
    `;
  }

  function renderBranchImplementationShell() {
    return `
      <section class="story-section story-branch-implementation" aria-labelledby="storyBranchImplementationTitle" data-story-stage-fixture-preview="1">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-scene">Branch fixture</span>
          <h2 id="storyBranchImplementationTitle">A/B/C branch result states</h2>
        </div>
        <p class="story-muted">Same branch point, three different scene bodies, state deltas, backgrounds, and ending routes. Rejoin is allowed only after the choice result remains visible.</p>
        <div class="story-branch-implementation-grid">
          ${STORY_BRANCH_IMPLEMENTATION_FIXTURE.map((choice) => `
            <article
              class="story-branch-implementation-card"
              data-story-branch-fixture-card="true"
              data-choice="${escapeHtml(choice.label)}"
              data-next-scene="${escapeHtml(choice.nextSceneId)}"
              data-ending-route="${escapeHtml(choice.endingRoute)}"
              data-background-state="${escapeHtml(choice.backgroundState)}"
            >
              <strong>${escapeHtml(choice.label)} · ${escapeHtml(choice.nextSceneId)}</strong>
              <span>${escapeHtml(choice.sceneTitle)}</span>
              <p>${escapeHtml(choice.bodySummary)}</p>
              <dl>
                <div><dt>State</dt><dd>${escapeHtml(choice.stateDelta)}</dd></div>
                <div><dt>Ending</dt><dd>${escapeHtml(choice.endingType)} · ${escapeHtml(choice.endingRoute)}</dd></div>
                <div><dt>Background</dt><dd>${escapeHtml(choice.backgroundState)}</dd></div>
                <div><dt>Rejoin</dt><dd>${escapeHtml(choice.rejoin)}</dd></div>
              </dl>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderTutorialShell() {
    return `
      <section class="story-section story-tutorial-section" aria-labelledby="storyTutorialTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-react">Tutorial</span>
          <h2 id="storyTutorialTitle" data-i18n="storyStage.tutorial.title">임진왜란: 난중일기 프롤로그</h2>
        </div>
        <article class="story-card story-tutorial-card">
          <p class="story-card-summary" data-i18n="storyStage.tutorial.short">첫 무료 장면에서 바다와 기록의 긴장을 따라가요.</p>
          <p class="story-muted" data-i18n="storyStage.tutorial.detail">역사 기록의 결을 살린 짧은 프롤로그예요. 외부 번역문이나 특정 게임 문구를 쓰지 않고, Lumina의 장면형 선택 흐름으로 시작합니다.</p>
          <button class="story-cta story-cta-free" type="button" aria-disabled="true" data-i18n="storyStage.tutorial.cta">무료 프롤로그 보기</button>
        </article>
      </section>
    `;
  }

  function renderStoryStage() {
    const root = document.getElementById("storyStageRoot");
    if (!root) return;

    const f = STORY_FIXTURE;
    const fixtureMode = isFixturePreview();
    const companions = companionOptions();
    const seasonSaving = Math.max(0, f.season.singleSumLumina - f.season.bundlePriceLumina);
    const companionChips = companions.length
      ? companions.map((c, i) => `
          <button class="story-companion-chip${i === 0 ? " is-selected" : ""}" type="button"
                  aria-pressed="${i === 0 ? "true" : "false"}" data-story-companion="${escapeHtml(c.slug)}">
            ${escapeHtml(c.name)}
          </button>`).join("")
      : `<p class="story-muted">공개 아티스트가 준비되면 동반 캐릭터로 선택할 수 있어요.</p>`;

    const firstScenePreview = fixtureMode ? renderScenePreviewShell(fixtureMode) : renderDiscoveryShell();
    const laterScenePreview = fixtureMode ? renderDiscoveryShell() : renderScenePreviewShell(fixtureMode);
    const localeQa = renderLocaleQaShell();

    root.innerHTML = `
      <div class="story-preview-banner" role="note">
        <strong>${storyLocalT("storyStage.preview.notice.title")}</strong>
        <span>${storyLocalT("storyStage.preview.notice.body")}</span>
      </div>

      ${fixtureMode ? firstScenePreview : localeQa}

      ${fixtureMode ? localeQa : firstScenePreview}

      ${renderDetailShell()}

      ${laterScenePreview}

      ${renderPlayerShell()}

      ${renderBranchImplementationShell()}

      ${renderSetupShell()}

      ${renderTutorialShell()}

      <section class="story-section" aria-labelledby="storyPrologueTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-free">무료 · 계정당 1회</span>
          <h2 id="storyPrologueTitle">${escapeHtml(f.prologue.title)}</h2>
        </div>
        <div class="story-card story-card-prologue">
          <p class="story-card-summary">${escapeHtml(f.prologue.summary)}</p>
          <ul class="story-meta-list">
            <li><strong>비용</strong><span class="story-free-pill">무료</span></li>
            <li><strong>제공</strong><span>계정당 ${f.prologue.freePerAccount}회</span></li>
            <li><strong>분량</strong><span>${escapeHtml(f.prologue.runtime)}</span></li>
          </ul>
          <div class="story-companion">
            <p class="story-companion-label">함께할 캐릭터 · 본인 또는 동반 1명</p>
            <div class="story-companion-chips" role="group" aria-label="동반 캐릭터 선택">
              <button class="story-companion-chip is-self is-selected" type="button" aria-pressed="true" data-story-companion="self">나</button>
              ${companionChips}
            </div>
            <p class="story-muted story-companion-hint">동반은 최대 ${f.prologue.companionMax}명까지 선택할 수 있어요.</p>
          </div>
          <button class="story-cta story-cta-free" type="button" aria-disabled="true" data-story-preview="prologue">무료로 시작 (미리보기)</button>
        </div>
      </section>

      <section class="story-section" aria-labelledby="storyChaptersTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-paid">유료 · 챕터별 구매</span>
          <h2 id="storyChaptersTitle">이어지는 챕터</h2>
        </div>
        <ul class="story-chapter-list">
          ${f.chapters.map(c => `
            <li class="story-chapter-item">
              <span class="story-chapter-no">CH.${c.no}</span>
              <div class="story-chapter-body">
                <strong class="story-chapter-title">${escapeHtml(c.title)}</strong>
                <p class="story-chapter-summary">${escapeHtml(c.summary)}</p>
              </div>
              <div class="story-chapter-buy">
                <span class="story-price">${lumina(c.priceLumina)}</span>
                <button class="story-cta story-cta-paid" type="button" aria-disabled="true" data-story-preview="chapter-${c.no}">구매 (미리보기)</button>
              </div>
            </li>`).join("")}
        </ul>
      </section>

      <section class="story-section" aria-labelledby="storySeasonTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-paid">유료 · 시즌 묶음</span>
          <h2 id="storySeasonTitle">${escapeHtml(f.season.title)}</h2>
        </div>
        <div class="story-card story-card-season">
          <p class="story-card-summary">챕터 ${f.season.chapterCount}편을 한 번에. 이미 구매한 챕터가 있으면 그만큼 제외하고 결제해요.</p>
          <div class="story-season-price">
            <span class="story-price story-price-lg">${lumina(f.season.bundlePriceLumina)}</span>
            <span class="story-price-strike">${lumina(f.season.singleSumLumina)}</span>
            ${seasonSaving > 0 ? `<span class="story-save-pill">${lumina(seasonSaving)} 절약</span>` : ""}
          </div>
          <button class="story-cta story-cta-paid" type="button" aria-disabled="true" data-story-preview="season">시즌 구매 (미리보기)</button>
        </div>
      </section>

      <section class="story-section" aria-labelledby="storyVideoTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-extra">선택 · 추가 비용</span>
          <h2 id="storyVideoTitle">장면을 영상으로</h2>
        </div>
        <div class="story-card story-card-video">
          <div class="story-video-row">
            <span class="story-price">${lumina(f.video.perClipLumina)} <small>/ 1개</small></span>
            <button class="story-cta story-cta-extra" type="button" aria-disabled="true" data-story-preview="video">영상 만들기 (미리보기)</button>
          </div>
          <p class="story-note-extra">${escapeHtml(f.video.note)}</p>
        </div>
      </section>

      <section class="story-section" aria-labelledby="storyReactTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-react">반응 · 읽은 사람</span>
          <h2 id="storyReactTitle">이야기 반응</h2>
        </div>
        <ul class="story-chapter-react-list">
          ${f.reactions.chapters.map(r => `
            <li class="story-chapter-react">
              <span class="story-chapter-no">CH.${r.no}</span>
              <div class="story-react-meta">
                <span class="story-rating" aria-label="평점 ${r.rating}점">★ ${r.rating.toFixed(1)}</span>
                <span class="story-read-badge">완독 ${r.readers.toLocaleString("ko-KR")}명</span>
                <span class="story-react-count">댓글 ${r.comments}</span>
              </div>
            </li>`).join("")}
        </ul>
        <div class="story-comments">
          <p class="story-comments-head">스토리 전체 댓글 <span class="story-muted">· 구매한 사람만 남길 수 있어요</span></p>
          ${f.reactions.storyComments.map(cm => `
            <div class="story-comment">
              <div class="story-comment-top">
                <strong class="story-comment-author">${escapeHtml(cm.author)}</strong>
                ${cm.paid ? `<span class="story-buyer-badge">결제함</span>` : ""}
                ${cm.completed ? `<span class="story-read-badge is-done">완독</span>` : ""}
              </div>
              <p class="story-comment-text">${escapeHtml(cm.text)}</p>
            </div>`).join("")}
          <button class="story-cta story-cta-extra" type="button" aria-disabled="true" data-story-preview="comment">댓글 남기기 (구매 후 가능 · 미리보기)</button>
        </div>
      </section>
    `;

    bindStoryPreview(root);
    loadScenePreviewFixtures().then(scenes => {
      _storyScenes = scenes.map(normalizeScene);
      _storySceneIndex = 0;
      renderStoryScene(_storyScenes[0]);
    });
    window.luminaI18n?.apply?.(root);
  }

  function bindStoryPreview(root) {
    if (root._storyPreviewBound) return;
    root._storyPreviewBound = true;

    root.addEventListener("click", (event) => {
      const chip = event.target.closest(".story-companion-chip");
      if (chip) {
        const group = chip.closest(".story-companion-chips");
        if (group) group.querySelectorAll(".story-companion-chip").forEach(c => {
          c.classList.remove("is-selected");
          c.setAttribute("aria-pressed", "false");
        });
        chip.classList.add("is-selected");
        chip.setAttribute("aria-pressed", "true");
        return;
      }

      if (event.target.closest("[data-scene-prev]")) {
        _storySceneIndex = (_storySceneIndex + _storyScenes.length - 1) % _storyScenes.length;
        renderStoryScene(_storyScenes[_storySceneIndex]);
        return;
      }
      if (event.target.closest("[data-scene-next]")) {
        _storySceneIndex = (_storySceneIndex + 1) % _storyScenes.length;
        renderStoryScene(_storyScenes[_storySceneIndex]);
        return;
      }
      if (event.target.closest("[data-scene-retry]")) {
        renderStoryScene(_storyScenes[_storySceneIndex] || STORY_SCENE_FALLBACKS[0]);
        return;
      }

      const localeButton = event.target.closest("[data-story-locale]");
      if (localeButton) {
        const nextLocale = localeButton.dataset.storyLocale;
        root.querySelectorAll("[data-story-locale]").forEach(button => {
          button.setAttribute("aria-pressed", button === localeButton ? "true" : "false");
        });
        Promise.resolve(window.luminaI18n?.setLocale?.(nextLocale)).finally(() => {
          window.luminaI18n?.apply?.(root);
          renderStoryScene(_storyScenes[_storySceneIndex] || STORY_SCENE_FALLBACKS[0]);
        });
        return;
      }

      const detailCard = event.target.closest("[data-story-detail]");
      if (detailCard) {
        event.preventDefault();
        openStoryDetail(root, detailCard.dataset.storyDetail);
        return;
      }

      if (event.target.closest("[data-story-detail-close]") || event.target.closest("[data-story-detail-backdrop]")) {
        event.preventDefault();
        closeStoryDetail(root);
        return;
      }

      const cta = event.target.closest("[data-story-preview]");
      if (cta) {
        event.preventDefault();
        showStoryPreviewToast();
      }
    });

    root.addEventListener("keydown", (event) => {
      const card = event.target.closest("[data-story-detail]");
      if (card && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        openStoryDetail(root, card.dataset.storyDetail);
      }
      if (event.key === "Escape") closeStoryDetail(root);
    });
  }

  function openStoryDetail(root, itemId) {
    const sheet = root.querySelector("[data-story-detail-sheet]");
    const backdrop = root.querySelector("[data-story-detail-backdrop]");
    if (!sheet || !backdrop) return;
    const item = STORY_DISCOVERY_ITEMS.find(story => story.id === itemId) || STORY_DISCOVERY_ITEMS[0];
    const title = sheet.querySelector("#storyDetailTitle");
    const cover = sheet.querySelector(".story-detail-cover");
    if (title) {
      title.dataset.i18n = item.titleKey;
      title.textContent = storyT(item.titleKey);
    }
    if (cover) {
      cover.style.backgroundImage = "linear-gradient(180deg, rgba(8,5,18,0.04), rgba(8,5,18,0.62)), url('" + item.image + "')";
    }
    sheet.hidden = false;
    sheet.setAttribute("aria-hidden", "false");
    backdrop.hidden = false;
    window.luminaI18n?.apply?.(sheet);
    requestAnimationFrame(() => sheet.querySelector("[data-story-detail-close]")?.focus({ preventScroll: true }));
  }

  function closeStoryDetail(root) {
    const sheet = root.querySelector("[data-story-detail-sheet]");
    const backdrop = root.querySelector("[data-story-detail-backdrop]");
    if (sheet) {
      sheet.hidden = true;
      sheet.setAttribute("aria-hidden", "true");
    }
    if (backdrop) backdrop.hidden = true;
  }

  let _storyToastTimer = null;
  function showStoryPreviewToast() {
    let toast = document.getElementById("storyPreviewToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "storyPreviewToast";
      toast.className = "story-toast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.textContent = "미리보기 화면에서는 결제, 정식 진행, 생성 요청을 실행하지 않습니다.";
    toast.classList.add("is-visible");
    clearTimeout(_storyToastTimer);
    _storyToastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderStoryStage);
  } else {
    renderStoryStage();
  }

  window.renderStoryStage = renderStoryStage;
  window.renderStoryScene = renderStoryScene;
  window.sceneStatusI18nKey = sceneStatusI18nKey;
})();
