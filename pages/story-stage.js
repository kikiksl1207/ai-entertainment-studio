(function initStoryStagePage() {
  "use strict";

  const rootId = "storyStageRoot";

  const STORY_FIXTURE = Object.freeze({
    prologue: {
      title: "임진왜란: 난중일기 프롤로그",
      summary: "전장의 기록 사이로 들어가 첫 선택을 고르는 무료 프롤로그입니다.",
      runtime: "약 10분",
      freePerAccount: 1,
      companionMax: 1,
    },
    chapters: [
      { no: 1, title: "첫 무대의 떨림", priceLumina: 120, summary: "전령이 남긴 기록을 따라 첫 분기점에 도착합니다." },
      { no: 2, title: "흔들리는 항구", priceLumina: 150, summary: "위험을 감수할지, 안전한 단서를 먼저 볼지 결정합니다." },
      { no: 3, title: "다시 합류하는 길", priceLumina: 150, summary: "선택의 흔적을 남긴 채 공통 장면으로 돌아옵니다." },
    ],
    season: {
      title: "시즌 1 · 전장의 계절",
      chapterCount: 8,
      bundlePriceLumina: 880,
      singleSumLumina: 1120,
    },
    video: {
      perClipLumina: 60,
      note: "장면을 영상으로 만들 때만 선택 비용을 확인합니다. 여기서는 결제나 생성 요청을 실행하지 않습니다.",
    },
    reactions: {
      chapters: [
        { no: 1, rating: 4.7, readers: 312, comments: 48 },
        { no: 2, rating: 4.5, readers: 268, comments: 33 },
        { no: 3, rating: 4.8, readers: 241, comments: 51 },
      ],
      storyComments: [
        { author: "별빛_서아", paid: true, completed: true, text: "프롤로그만 보려고 했는데 장면마다 분위기가 달라 계속 읽게 돼요." },
        { author: "조용한 관객", paid: true, completed: false, text: "선택지가 결과에 영향을 주는 느낌이 분명해서 다음 장면이 기다려져요." },
        { author: "오늘의러너", paid: true, completed: true, text: "캐릭터가 없는 장면도 배경과 문구가 자연스럽게 이어져 좋았습니다." },
      ],
    },
  });

  const FALLBACK_COPY = Object.freeze({
    ko: {
      previewTitle: "미리보기 화면",
      previewBody: "읽기 전용 미리보기입니다. 저장, 결제, 생성 요청은 실행하지 않습니다.",
      sceneEyebrow: "Scene visual",
      sceneTitle: "장면 연출 미리보기",
      sceneLabel: "스토리 장면",
      sceneReady: "장면을 준비했습니다.",
      scenePreparing: "장면 연출을 준비하고 있어요.",
      bgLoading: "배경을 불러오는 중입니다.",
      bgMissing: "기본 배경으로 장면을 이어갈게요.",
      charMissing: "캐릭터 없이 감정 흐름을 보여줍니다.",
      retry: "다시 확인",
      prev: "이전 장면",
      next: "다음 장면",
      localeTitle: "언어 선택",
      localeNote: "번역이 비어 있어도 화면에는 자연스러운 기본 문구가 표시됩니다.",
      discoveryTitle: "스토리 찾기",
      emptyTitle: "조건에 맞는 스토리가 아직 없어요.",
      emptyBody: "필터를 넓히거나 무료 프롤로그에서 먼저 분위기를 확인해 보세요.",
      emptyCta: "추천 스토리 보기",
      detailHeading: "스토리 상세",
      close: "닫기",
      creator: "AI 아티스트",
      profile: "대화 프로필",
      settings: "시작 설정",
      updates: "업데이트",
      prologuePreview: "프롤로그 미리보기",
      similar: "비슷한 스토리",
      endingGuide: "결말 구분",
      startFree: "무료 프롤로그 시작",
      continueStory: "이어하기",
      locked: "구매 필요",
      setupTitle: "나 + AI 동반 설정",
      playerTitle: "장면 속에서 대화하기",
      playerStatus: "배경, 대화, 선택지가 겹치지 않게 이어집니다.",
      inputPlaceholder: "내 반응을 짧게 남기기",
      choiceTitle: "선택 결과 미리보기",
      choiceNote: "선택 후 장면, 관계, 위험, 정보, 결말 후보가 달라질 수 있습니다.",
      event: "사건",
      relation: "관계",
      risk: "위험",
      info: "정보",
      endingCandidate: "결말 후보",
      rejoin: "합류",
      tutorialShort: "첫 무료 장면에서 바다와 기록의 긴장을 따라갑니다.",
      tutorialDetail: "역사 기록의 결을 살린 짧은 프롤로그입니다. Lumina의 장면형 선택 흐름으로 시작합니다.",
      tutorialCta: "무료 프롤로그 보기",
    },
    en: {
      previewTitle: "Preview screen",
      previewBody: "This read-only preview does not save, charge, or run generation.",
      sceneEyebrow: "Scene visual",
      sceneTitle: "Scene preview",
      sceneLabel: "Story scene",
      sceneReady: "Scene is ready.",
      scenePreparing: "Preparing scene visuals.",
      bgLoading: "Loading background.",
      bgMissing: "Continuing with a default background.",
      charMissing: "Showing the emotional beat without a character.",
      retry: "Check again",
      prev: "Previous scene",
      next: "Next scene",
      localeTitle: "Language",
      localeNote: "If a translation is missing, the screen falls back to natural default copy.",
      discoveryTitle: "Find a story",
      emptyTitle: "No stories match this view yet.",
      emptyBody: "Widen the filter or start with a free prologue.",
      emptyCta: "Show recommended",
      detailHeading: "Story detail",
      close: "Close",
      creator: "AI artist",
      profile: "Chat profile",
      settings: "Start settings",
      updates: "Updates",
      prologuePreview: "Prologue preview",
      similar: "Similar story",
      endingGuide: "Ending types",
      startFree: "Start free prologue",
      continueStory: "Continue",
      locked: "Purchase needed",
      setupTitle: "Me + AI companion",
      playerTitle: "Chat inside the scene",
      playerStatus: "Background, dialogue, and choices stay readable.",
      inputPlaceholder: "Leave a short reaction",
      choiceTitle: "Choice outcome preview",
      choiceNote: "A choice can change the next scene, relation, risk, info, and ending candidate.",
      event: "Event",
      relation: "Relation",
      risk: "Risk",
      info: "Info",
      endingCandidate: "Ending candidate",
      rejoin: "Rejoin",
      tutorialShort: "Follow the tension between sea and records in the first free scene.",
      tutorialDetail: "A short prologue shaped around historical records and Lumina choice flow.",
      tutorialCta: "View free prologue",
    },
  });

  const LOCALES = [
    { code: "ko", label: "KO" },
    { code: "en", label: "EN" },
    { code: "ja", label: "JA" },
    { code: "zh-Hans", label: "简" },
    { code: "zh-Hant", label: "繁" },
  ];

  const STORY_DISCOVERY_ITEMS = [
    {
      id: "imjin",
      title: "임진왜란: 난중일기 프롤로그",
      summary: "전장의 기록 사이로 들어가 첫 선택을 고릅니다.",
      status: "무료 프롤로그",
      tags: ["History", "Tutorial"],
      metric: "4.8 · 1.2k",
      startSetting: "무료 프롤로그 · 동반 AI 1명 · 비공개 미리보기",
      updateText: "최근 장면과 선택지 검수 완료",
      creator: "Cha Dohyun",
      similarTitle: "첫 무대의 떨림",
      image: "/assets/brand/lumina-stage-banner.png",
    },
    {
      id: "stage",
      title: "첫 무대의 떨림",
      summary: "공연 전야의 감정을 따라가며 장면을 선택합니다.",
      status: "준비됨",
      tags: ["Stage", "AI"],
      metric: "4.7 · 840",
      startSetting: "무료 시작 · 나 또는 AI 1명 · 저장 없는 미리보기",
      updateText: "무대 배경과 하단 CTA 검수 완료",
      creator: "Cha Dohyun",
      similarTitle: "임진왜란: 난중일기 프롤로그",
      image: "/assets/characters/cha-dohyun/reference-final-03.png",
    },
    {
      id: "myth",
      title: "달빛 숲의 약속",
      summary: "신화풍 숲에서 안전한 선택 흐름을 먼저 확인합니다.",
      status: "미리보기",
      tags: ["Myth", "Safe"],
      metric: "4.6 · 620",
      startSetting: "읽기 전용 · 동반 AI 1명 · 구매 없음",
      updateText: "민감한 표현 검수 완료",
      creator: "Choi Seojin",
      similarTitle: "첫 무대의 떨림",
      image: "/assets/characters/choi-seojin/cover.png",
    },
  ];

  const STORY_SCENE_FALLBACKS = [
    {
      sceneId: "scene-01",
      sceneText: "첫 리허설 조명이 켜지고, 차도현이 무대 중앙으로 걸어 나옵니다.",
      backgroundState: "ready",
      backgroundAsset: { url: "/assets/brand/lumina-stage-banner.png", label: "리허설 무대" },
      fallbackType: "ready",
      characters: [
        {
          characterId: "cha-dohyun",
          assetId: "character.cha-dohyun.reference",
          url: "/assets/characters/cha-dohyun/reference-final-03.png",
          label: "차도현",
          characterPose: "neutral",
          characterLayer: "foreground",
        },
      ],
    },
    {
      sceneId: "scene-02",
      sceneText: "객석 불빛만 남은 장면입니다. 캐릭터 없이 감정의 여백을 보여줍니다.",
      backgroundState: "ready",
      backgroundAsset: { url: "/assets/characters/choi-seojin/cover.png", label: "조용한 객석" },
      fallbackType: "character",
      characters: [],
    },
    {
      sceneId: "scene-03",
      sceneText: "배경 자료가 아직 준비되지 않아 기본 장면으로 이야기를 이어갑니다.",
      backgroundState: "fallback",
      backgroundAsset: null,
      fallbackType: "background",
      characters: [
        {
          characterId: "choi-seojin",
          assetId: "character.choi-seojin.placeholder",
          url: "/assets/characters/choi-seojin/thumb.png",
          label: "최서진",
          characterPose: "listening",
          characterLayer: "midground",
        },
      ],
    },
  ];

  const BRANCH_CHOICES = [
    {
      label: "A",
      tone: "info",
      title: "기록을 먼저 확인",
      userSceneLabel: "기록 보관실",
      bodySummary: "숨은 단서를 확인해 더 안전한 경로로 이동합니다.",
      eventLabel: "기록 단서가 열립니다.",
      relationLabel: "전령의 신뢰가 높아집니다.",
      riskLabel: "낮은 위험으로 증거를 확인합니다.",
      infoLabel: "숨은 문서 단서를 얻습니다.",
      stateLabel: "정보 획득 · 신뢰 상승",
      endingLabel: "작가 보조 결말 후보",
      endingType: "writer_sub_ending",
      endingRoute: "E-SUB-01",
      rejoinLabel: "공통 장면에서 다시 합류",
      backgroundLabel: "작전 지도실",
      backgroundId: "bg-war-room-map",
      backgroundState: "ready",
      backgroundAssetUrl: "/assets/brand/lumina-stage-banner.png",
      characterAssetId: "character.cha-dohyun.reference-final-03",
      characterAssetLabel: "차도현 안내 컷",
      characterImage: "/assets/characters/cha-dohyun/reference-final-03.png",
      chatLine: "기록 보관실에 불이 들어오고 더 안전한 단서 경로가 열립니다.",
    },
    {
      label: "B",
      tone: "risk",
      title: "전령을 따라 이동",
      userSceneLabel: "밤 항구 추적",
      bodySummary: "위험은 커지지만 봉인된 지도를 얻는 경로입니다.",
      eventLabel: "전령을 따라 항구로 이동합니다.",
      relationLabel: "신뢰는 흔들리지만 관계는 이어집니다.",
      riskLabel: "위험이 커지고 아이템을 얻습니다.",
      infoLabel: "봉인된 지도 단서를 확보합니다.",
      stateLabel: "위험 증가 · 아이템 획득",
      endingLabel: "작가 보조 결말 후보",
      endingType: "writer_sub_ending",
      endingRoute: "E-SUB-02",
      rejoinLabel: "공통 장면에서 다시 합류",
      backgroundLabel: "밤 항구",
      backgroundId: "bg-harbor-night",
      backgroundState: "ready",
      backgroundAssetUrl: "/assets/characters/cha-dohyun/cover.png",
      characterAssetId: "character.cha-dohyun.reference-final-08",
      characterAssetLabel: "차도현 추적 컷",
      characterImage: "/assets/characters/cha-dohyun/reference-final-08.png",
      chatLine: "항구 바람이 거세지고, 추적 선택의 위험이 커집니다.",
    },
    {
      label: "C",
      tone: "ending",
      title: "해안으로 우회",
      userSceneLabel: "안개 해안",
      bodySummary: "작가 결말이 없는 분기라 AI 보조 결말 후보만 안내합니다.",
      eventLabel: "우회로가 합류 전 갈라집니다.",
      relationLabel: "관계의 흐름이 새 방향으로 바뀝니다.",
      riskLabel: "중간 위험의 미해결 경로입니다.",
      infoLabel: "작가 결말 확인이 필요한 분기입니다.",
      stateLabel: "관계 변화 · 보조 결말 조건",
      endingLabel: "AI 보조 결말 후보",
      endingType: "ai_fallback_ending",
      endingRoute: "E-AI-01",
      rejoinLabel: "보조 결말 검수 후 합류 여부 결정",
      backgroundLabel: "안개 해안",
      backgroundId: "bg-fog-shore",
      backgroundState: "ready",
      backgroundAssetUrl: "/assets/characters/choi-seojin/cover.png",
      characterAssetId: "none",
      characterAssetLabel: "캐릭터 없음",
      characterImage: "",
      chatLine: "해안이 조용해지고 이 분기는 보조 결말 검수가 필요합니다.",
    },
  ];

  const ENDING_GUIDE = [
    { type: "author-main", title: "작가 기본 결말", body: "작가가 지정한 중심 루트의 결말입니다." },
    { type: "author-sub", title: "작가 보조 결말", body: "분기 루트를 위해 작가가 별도로 준비한 결말입니다." },
    { type: "ai-assisted", title: "AI 보조 결말", body: "작가 결말이 없는 분기에서만 후보로 표시합니다." },
  ];

  let _storyScenes = STORY_SCENE_FALLBACKS.slice();
  let _storySceneIndex = 0;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function lumina(n) {
    return (Number(n) || 0).toLocaleString("ko-KR") + " L";
  }

  function storyLocale() {
    const locale = window.luminaI18n?.getLocale?.() || window.luminaI18n?.getRegionalLocale?.() || document.documentElement.lang || "ko";
    if (String(locale).startsWith("ko")) return "ko";
    return "en";
  }

  function copy() {
    return FALLBACK_COPY[storyLocale()] || FALLBACK_COPY.ko;
  }

  function routeHandoffHref(storyId, entry) {
    return "/story-stage?storyId=" + encodeURIComponent(storyId || "imjin") + "&entry=" + encodeURIComponent(entry || "card");
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
      sceneText: String(safeScene.sceneText || safeScene.text || STORY_SCENE_FALLBACKS[index % STORY_SCENE_FALLBACKS.length]?.sceneText || copy().scenePreparing),
      backgroundState: String(safeScene.backgroundState || (bg?.url ? "ready" : "fallback")),
      backgroundAsset: bg,
      fallbackType: String(safeScene.fallbackType || (!bg?.url ? "background" : "ready")),
      characters: characters.slice(0, 4).map((character, i) => ({
        characterId: String(character.characterId || character.id || "character-" + i),
        assetId: String(character.assetId || ""),
        url: normalizeAssetUrl(character.url || character.publicUrl || character.assetUrl),
        label: String(character.label || character.displayName || "등장 캐릭터"),
        characterPose: String(character.characterPose || character.pose || "neutral"),
        characterLayer: String(character.characterLayer || character.layer || "midground"),
      })),
    };
  }

  async function loadScenePreviewFixtures() {
    if (!isFixturePreview()) return STORY_SCENE_FALLBACKS.slice();
    try {
      const path = "/api/v1/story-sessions/fixtures/story-scene-preview/scenes";
      const res = await fetch(path, { credentials: "omit" });
      if (!res.ok) return STORY_SCENE_FALLBACKS.slice();
      const response = await res.json();
      const scenes = Array.isArray(response) ? response : response?.scenes;
      if (Array.isArray(scenes) && scenes.length) return scenes.map(normalizeScene);
    } catch (_) {
      return STORY_SCENE_FALLBACKS.slice();
    }
    return STORY_SCENE_FALLBACKS.slice();
  }

  function branchChoice(label) {
    return BRANCH_CHOICES.find((choice) => choice.label === label) || BRANCH_CHOICES[0];
  }

  function branchBackgroundStyle(choice) {
    const safeChoice = choice || BRANCH_CHOICES[0];
    const url = safeChoice.backgroundAssetUrl || "/assets/brand/lumina-stage-banner.png";
    return "linear-gradient(180deg, rgba(8, 5, 18, 0.04), rgba(8, 5, 18, 0.62)), url('" + escapeHtml(url) + "')";
  }

  function sceneStatusText(scene, hasBackground, hasCharacters) {
    const t = copy();
    if (scene.backgroundState === "loading") return t.bgLoading;
    if (!hasBackground) return t.bgMissing;
    if (!hasCharacters) return t.charMissing;
    return "";
  }

  function renderStoryScene(scene) {
    const stage = document.querySelector("[data-story-scene-stage]");
    if (!stage) return;
    const t = copy();
    const activeScene = normalizeScene(scene || STORY_SCENE_FALLBACKS[0], 0);
    const bg = activeScene.backgroundAsset;
    const hasBackground = !!(bg && bg.url && activeScene.backgroundState === "ready");
    const visibleCharacters = activeScene.characters.filter((character) => character.characterLayer !== "offscreen");
    const characterWithAsset = visibleCharacters.filter((character) => character.url);
    const statusText = sceneStatusText(activeScene, hasBackground, characterWithAsset.length > 0);

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
      bgImg.alt = bg?.label || t.sceneLabel;
    }
    if (chars) {
      chars.innerHTML = characterWithAsset.map((character, index) => {
        const side = index % 2 === 0 ? "left" : "right";
        return (
          '<img class="scene-char" src="' + escapeHtml(character.url) + '" ' +
          'data-layer="' + escapeHtml(character.characterLayer) + '" ' +
          'data-pose="' + escapeHtml(character.characterPose) + '" ' +
          'data-side="' + side + '" ' +
          'alt="' + escapeHtml(character.label) + '" loading="lazy" decoding="async" />'
        );
      }).join("");
    }
    if (text) text.textContent = activeScene.sceneText;
    if (status) {
      status.hidden = !statusText;
      status.textContent = statusText;
    }
    if (fallback) {
      const showFallback = !hasBackground || (visibleCharacters.length > 0 && characterWithAsset.length === 0);
      fallback.hidden = !showFallback;
      fallback.dataset.bgState = hasBackground ? "ready" : "fallback";
      if (fallbackCopy) fallbackCopy.textContent = statusText || t.scenePreparing;
      if (fallbackRetry) fallbackRetry.textContent = t.retry;
    }
    const count = document.querySelector("[data-scene-count]");
    if (count) count.textContent = (_storySceneIndex + 1) + " / " + _storyScenes.length;
  }

  function renderScenePreviewShell(fixtureMode) {
    const t = copy();
    return `
      <section class="story-section story-scene-section" aria-labelledby="storySceneTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-scene">${escapeHtml(t.sceneEyebrow)}</span>
          <h2 id="storySceneTitle">${escapeHtml(t.sceneTitle)}</h2>
        </div>
        <section class="story-scene-stage" data-story-scene-stage data-scene-id="" aria-label="${escapeHtml(t.sceneLabel)}" aria-live="polite">
          <div class="scene-bg" data-scene-bg data-bg-state="ready">
            <img class="scene-bg-img" alt="" data-scene-bg-img />
          </div>
          <div class="scene-characters" data-scene-characters></div>
          <div class="scene-text-overlay">
            <p class="scene-text" data-scene-text></p>
          </div>
          <p class="scene-visual-status" data-scene-visual-status role="status" hidden></p>
          <div class="scene-fallback" data-scene-fallback data-bg-state="missing" hidden>
            <p class="scene-fallback-copy" data-scene-fallback-copy>${escapeHtml(t.bgMissing)}</p>
            <button class="scene-retry" type="button" data-scene-retry>${escapeHtml(t.retry)}</button>
          </div>
        </section>
        <nav class="scene-preview-nav" data-fixture-only ${fixtureMode ? "" : "hidden"}>
          <button type="button" data-scene-prev>${escapeHtml(t.prev)}</button>
          <span class="scene-preview-count" data-scene-count>1 / 3</span>
          <button type="button" data-scene-next>${escapeHtml(t.next)}</button>
        </nav>
      </section>
    `;
  }

  function renderDiscoveryShell() {
    const t = copy();
    const filters = [
      { key: "recommended", label: "추천" },
      { key: "taste", label: "취향" },
      { key: "new", label: "신작" },
      { key: "ranking", label: "랭킹" },
      { key: "today-empty", label: "오늘" },
      { key: "genre", label: "장르" },
    ];
    return `
      <section class="story-section story-discovery-section" aria-labelledby="storyDiscoveryTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-free">Discovery</span>
          <h2 id="storyDiscoveryTitle">${escapeHtml(t.discoveryTitle)}</h2>
        </div>
        <div class="story-filter-row" role="list" aria-label="Story filters">
          ${filters.map((filter, index) => `
            <button type="button"
                    class="story-filter-chip${index === 0 ? " is-active" : ""}"
                    data-story-filter="${escapeHtml(filter.key)}"
                    aria-pressed="${index === 0 ? "true" : "false"}">${escapeHtml(filter.label)}</button>
          `).join("")}
        </div>
        <div class="story-discovery-empty" data-story-discovery-empty hidden>
          <strong>${escapeHtml(t.emptyTitle)}</strong>
          <p>${escapeHtml(t.emptyBody)}</p>
          <button type="button" class="story-cta story-cta-free" data-story-reset-filter>${escapeHtml(t.emptyCta)}</button>
        </div>
        <div class="story-discovery-grid" data-story-discovery-grid>
          ${STORY_DISCOVERY_ITEMS.map((item) => `
            <article class="story-discovery-card" data-story-detail="${escapeHtml(item.id)}" data-story-id="${escapeHtml(item.id)}" tabindex="0" role="button" aria-label="${escapeHtml(item.title)}">
              <div class="story-discovery-cover" style="background-image: linear-gradient(180deg, rgba(8,5,18,0.04), rgba(8,5,18,0.52)), url('${escapeHtml(item.image)}')"></div>
              <div class="story-discovery-body">
                <span class="story-discovery-status">${escapeHtml(item.status)}</span>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.summary)}</p>
                <div class="story-discovery-meta">
                  <span>${escapeHtml(item.metric)}</span>
                  <span>${item.tags.map(escapeHtml).join(" · ")}</span>
                </div>
                <div class="story-discovery-actions">
                  <a class="story-cta story-cta-free story-route-link"
                     href="${escapeHtml(routeHandoffHref(item.id, "card"))}"
                     data-story-route-handoff="card"
                     data-story-id="${escapeHtml(item.id)}">${escapeHtml(t.startFree)}</a>
                  <button class="story-detail-open" type="button" data-story-detail-open="${escapeHtml(item.id)}">상세 보기</button>
                </div>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderDetailShell() {
    const t = copy();
    return `
      <section class="story-detail-sheet" data-story-detail-sheet hidden aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="storyDetailTitle">
        <button class="story-detail-close" type="button" data-story-detail-close aria-label="${escapeHtml(t.close)}">×</button>
        <div class="story-detail-cover" aria-hidden="true"></div>
        <div class="story-detail-body">
          <span class="story-eyebrow story-eyebrow-scene">${escapeHtml(t.detailHeading)}</span>
          <h2 id="storyDetailTitle">임진왜란: 난중일기 프롤로그</h2>
          <p data-story-detail-summary>전장의 기록 사이로 들어가 첫 선택을 고릅니다.</p>
          <div class="story-detail-chip-row" data-story-detail-tags></div>
          <div class="story-detail-stat-row" data-story-detail-stats></div>
          <dl class="story-detail-list">
            <div><dt>${escapeHtml(t.creator)}</dt><dd data-story-detail-creator>Cha Dohyun</dd></div>
            <div><dt>${escapeHtml(t.profile)}</dt><dd>무료 프롤로그는 나 또는 AI 아티스트 1명과 시작합니다.</dd></div>
            <div><dt>${escapeHtml(t.settings)}</dt><dd data-story-detail-settings>무료 프롤로그 · 동반 AI 1명 · 비공개 미리보기</dd></div>
            <div><dt>${escapeHtml(t.updates)}</dt><dd data-story-detail-updates>최근 장면과 선택지 검수 완료</dd></div>
            <div><dt>${escapeHtml(t.prologuePreview)}</dt><dd>${escapeHtml(t.tutorialDetail)}</dd></div>
            <div><dt>${escapeHtml(t.similar)}</dt><dd data-story-detail-similar>첫 무대의 떨림</dd></div>
          </dl>
          <section class="story-detail-ending-copy" aria-label="${escapeHtml(t.endingGuide)}">
            <h3>${escapeHtml(t.endingGuide)}</h3>
            <div class="story-detail-ending-grid">
              ${ENDING_GUIDE.map((ending) => `
                <article data-ending-copy="${escapeHtml(ending.type)}">
                  <strong>${escapeHtml(ending.title)}</strong>
                  <p>${escapeHtml(ending.body)}</p>
                </article>
              `).join("")}
            </div>
          </section>
          <div class="story-detail-actions">
            <a class="story-cta story-cta-free story-route-link" href="${escapeHtml(routeHandoffHref("imjin", "detail"))}" data-story-route-handoff="detail-start" data-story-detail-start>${escapeHtml(t.startFree)}</a>
            <a class="story-cta story-cta-extra story-route-link" href="${escapeHtml(routeHandoffHref("imjin", "continue"))}" data-story-route-handoff="detail-continue" data-story-detail-continue>${escapeHtml(t.continueStory)}</a>
            <a class="story-cta story-cta-paid story-route-link" href="${escapeHtml(routeHandoffHref("imjin", "locked-preview"))}" data-story-route-handoff="detail-locked" data-story-detail-locked>${escapeHtml(t.locked)}</a>
          </div>
        </div>
      </section>
      <div class="story-detail-backdrop" data-story-detail-backdrop hidden></div>
    `;
  }

  function renderSetupShell() {
    const t = copy();
    return `
      <section class="story-section story-setup-section" aria-labelledby="storySetupTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-free">Me + AI</span>
          <h2 id="storySetupTitle">${escapeHtml(t.setupTitle)}</h2>
        </div>
        <div class="story-setup-grid">
          <article class="story-setup-item"><strong>${escapeHtml(t.profile)}</strong><p>나 또는 AI 아티스트 1명과 무료 프롤로그를 시작합니다.</p></article>
          <article class="story-setup-item"><strong>${escapeHtml(t.settings)}</strong><p>프롤로그를 읽기 전용 미리보기로 준비합니다.</p></article>
          <article class="story-setup-item"><strong>동반 AI</strong><p>${escapeHtml(t.playerStatus)}</p></article>
          <article class="story-setup-item"><strong>공개 범위</strong><p>나만 보는 비공개 미리보기</p></article>
        </div>
      </section>
    `;
  }

  function renderPlayerShell() {
    const t = copy();
    const activeChoice = BRANCH_CHOICES[0];
    return `
      <section class="story-section story-player-section" aria-labelledby="storyPlayerTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-scene">Immersive MVP</span>
          <h2 id="storyPlayerTitle">${escapeHtml(t.playerTitle)}</h2>
        </div>
        <div class="story-player-shell"
             aria-label="몰입형 스토리 플레이어 미리보기"
             data-story-mode-chat-shell="true"
             data-active-choice="${escapeHtml(activeChoice.label)}"
             data-scene-id="${escapeHtml(activeChoice.userSceneLabel)}"
             data-background-id="${escapeHtml(activeChoice.backgroundId)}"
             data-character-asset-id="${escapeHtml(activeChoice.characterAssetId)}">
          <div class="story-player-bg" role="img" aria-label="스토리 장면 배경" data-story-player-bg style="background-image: ${branchBackgroundStyle(activeChoice)}"></div>
          <img class="story-player-character" src="${escapeHtml(activeChoice.characterImage)}" alt="${escapeHtml(activeChoice.characterAssetLabel)}" data-story-player-character loading="lazy" decoding="async" />
          <div class="story-player-scene-pill" data-story-player-scene>${escapeHtml(activeChoice.userSceneLabel)} · ${escapeHtml(activeChoice.backgroundLabel)}</div>
          <div class="story-player-overlay">
            <p class="story-player-status">${escapeHtml(t.playerStatus)}</p>
            <div class="story-player-chat" role="log" aria-live="polite">
              <p class="story-player-bubble is-ai" data-story-player-bubble>${escapeHtml(activeChoice.chatLine)}</p>
            </div>
            <div class="story-player-choices" role="group" aria-label="스토리 선택지">
              ${BRANCH_CHOICES.map((choice, index) => `
                <button type="button"
                        data-story-player-choice="${escapeHtml(choice.label)}"
                        aria-pressed="${index === 0 ? "true" : "false"}"
                        class="${index === 0 ? "is-active" : ""}">
                  <span>${escapeHtml(choice.label)}</span>
                  <strong>${escapeHtml(choice.title)}</strong>
                </button>
              `).join("")}
            </div>
            <label class="story-player-input">
              <span>${escapeHtml(t.inputPlaceholder)}</span>
              <input type="text" disabled aria-disabled="true" placeholder="${escapeHtml(t.inputPlaceholder)}" />
            </label>
          </div>
        </div>
      </section>
    `;
  }

  function renderBranchImplementationShell() {
    const t = copy();
    const activeChoice = BRANCH_CHOICES[0];
    return `
      <section class="story-section story-branch-implementation" aria-labelledby="storyBranchImplementationTitle" data-story-stage-fixture-preview="1">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-scene">선택 결과</span>
          <h2 id="storyBranchImplementationTitle">${escapeHtml(t.choiceTitle)}</h2>
        </div>
        <p class="story-muted">${escapeHtml(t.choiceNote)}</p>
        <div class="story-branch-nav" role="group" aria-label="선택 결과 미리보기">
          ${BRANCH_CHOICES.map((choice, index) => `
            <button type="button"
                    data-story-branch-choice="${escapeHtml(choice.label)}"
                    aria-pressed="${index === 0 ? "true" : "false"}"
                    class="${index === 0 ? "is-active" : ""}">
              <span>${escapeHtml(choice.label)}</span>
              <strong>${escapeHtml(choice.title)}</strong>
            </button>
          `).join("")}
        </div>
        <article class="story-choice-result"
                 data-story-choice-result
                 data-active-choice="${escapeHtml(activeChoice.label)}"
                 data-scene-id="${escapeHtml(activeChoice.userSceneLabel)}"
                 data-background-id="${escapeHtml(activeChoice.backgroundId)}">
          <div class="story-choice-result-bg" data-choice-result-bg style="background-image: ${branchBackgroundStyle(activeChoice)}"></div>
          <div class="story-choice-result-body">
            <strong data-choice-result-scene>${escapeHtml(activeChoice.title)} · ${escapeHtml(activeChoice.userSceneLabel)}</strong>
            <p data-choice-result-summary>${escapeHtml(activeChoice.bodySummary)}</p>
            <dl class="story-choice-summary">
              <div><dt>${escapeHtml(t.event)}</dt><dd data-choice-result-event>${escapeHtml(activeChoice.eventLabel)}</dd></div>
              <div><dt>${escapeHtml(t.relation)}</dt><dd data-choice-result-relation>${escapeHtml(activeChoice.relationLabel)}</dd></div>
              <div><dt>${escapeHtml(t.risk)}</dt><dd data-choice-result-risk>${escapeHtml(activeChoice.riskLabel)}</dd></div>
              <div><dt>${escapeHtml(t.info)}</dt><dd data-choice-result-info>${escapeHtml(activeChoice.infoLabel)}</dd></div>
              <div><dt>${escapeHtml(t.endingCandidate)}</dt><dd data-choice-result-ending>${escapeHtml(activeChoice.endingLabel)}</dd></div>
              <div><dt>${escapeHtml(t.rejoin)}</dt><dd data-choice-result-rejoin>${escapeHtml(activeChoice.rejoinLabel)}</dd></div>
            </dl>
          </div>
        </article>
        <div class="story-branch-implementation-grid">
          ${BRANCH_CHOICES.map((choice) => `
            <article
              class="story-branch-implementation-card"
              data-story-branch-fixture-card="true"
              data-choice="${escapeHtml(choice.label)}"
              data-next-scene="${escapeHtml(choice.userSceneLabel)}"
              data-state-delta="${escapeHtml(choice.stateLabel)}"
              data-ending-type="${escapeHtml(choice.endingType)}"
              data-ending-route="${escapeHtml(choice.endingRoute)}"
              data-background-id="${escapeHtml(choice.backgroundId)}"
              data-background-state="${escapeHtml(choice.backgroundState)}"
              data-character-asset-id="${escapeHtml(choice.characterAssetId)}">
              <strong>선택 ${escapeHtml(choice.label)} · ${escapeHtml(choice.title)}</strong>
              <span>${escapeHtml(choice.backgroundLabel)}</span>
              <p>${escapeHtml(choice.bodySummary)}</p>
              <dl>
                <div><dt>변화</dt><dd>${escapeHtml(choice.stateLabel)}</dd></div>
                <div><dt>결말 후보</dt><dd>${escapeHtml(choice.endingLabel)}</dd></div>
                <div><dt>결과</dt><dd>${escapeHtml(choice.eventLabel)}</dd></div>
                <div><dt>합류</dt><dd>${escapeHtml(choice.rejoinLabel)}</dd></div>
              </dl>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderTutorialShell() {
    const t = copy();
    return `
      <section class="story-section story-tutorial-section" aria-labelledby="storyTutorialTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-react">Tutorial</span>
          <h2 id="storyTutorialTitle">임진왜란: 난중일기 프롤로그</h2>
        </div>
        <article class="story-card story-tutorial-card">
          <p class="story-card-summary">${escapeHtml(t.tutorialShort)}</p>
          <p class="story-muted">${escapeHtml(t.tutorialDetail)}</p>
          <button class="story-cta story-cta-free" type="button" aria-disabled="true">${escapeHtml(t.tutorialCta)}</button>
        </article>
      </section>
    `;
  }

  function renderStoryStage() {
    const root = document.getElementById(rootId);
    if (!root) return;
    const t = copy();
    const f = STORY_FIXTURE;
    const fixtureMode = isFixturePreview();
    const seasonSaving = Math.max(0, f.season.singleSumLumina - f.season.bundlePriceLumina);
    const firstScenePreview = fixtureMode ? renderScenePreviewShell(fixtureMode) : renderDiscoveryShell();
    const laterScenePreview = fixtureMode ? renderDiscoveryShell() : renderScenePreviewShell(fixtureMode);

    root.innerHTML = `
      <div class="story-preview-banner" role="note">
        <strong>${escapeHtml(t.previewTitle)}</strong>
        <span>${escapeHtml(t.previewBody)}</span>
      </div>

      ${firstScenePreview}
      ${fixtureMode ? renderLocaleShell() : ""}
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
              <button class="story-companion-chip" type="button" aria-pressed="false" data-story-companion="cha-dohyun">Cha Dohyun</button>
              <button class="story-companion-chip" type="button" aria-pressed="false" data-story-companion="choi-seojin">Choi Seojin</button>
            </div>
            <p class="story-muted story-companion-hint">동반은 최대 ${f.prologue.companionMax}명까지 선택할 수 있습니다.</p>
          </div>
          <a class="story-cta story-cta-free story-route-link" href="${escapeHtml(routeHandoffHref("imjin", "prologue"))}" data-story-route-handoff="prologue-start" data-story-id="imjin">무료로 시작</a>
        </div>
      </section>

      <section class="story-section" aria-labelledby="storyChaptersTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-paid">유료 · 챕터별 구매</span>
          <h2 id="storyChaptersTitle">이어지는 챕터</h2>
        </div>
        <ul class="story-chapter-list">
          ${f.chapters.map((chapter) => `
            <li class="story-chapter-item">
              <span class="story-chapter-no">CH.${chapter.no}</span>
              <div class="story-chapter-body">
                <strong class="story-chapter-title">${escapeHtml(chapter.title)}</strong>
                <p class="story-chapter-summary">${escapeHtml(chapter.summary)}</p>
              </div>
              <div class="story-chapter-buy">
                <span class="story-price">${lumina(chapter.priceLumina)}</span>
                <button class="story-cta story-cta-paid" type="button" aria-disabled="true" data-story-preview="chapter-${chapter.no}">구매 미리보기</button>
              </div>
            </li>
          `).join("")}
        </ul>
      </section>

      <section class="story-section" aria-labelledby="storySeasonTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-paid">유료 · 시즌 묶음</span>
          <h2 id="storySeasonTitle">${escapeHtml(f.season.title)}</h2>
        </div>
        <div class="story-card story-card-season">
          <p class="story-card-summary">챕터 ${f.season.chapterCount}개를 한 번에 이어 봅니다. 이미 구매한 챕터는 결제 전 제외됩니다.</p>
          <div class="story-season-price">
            <span class="story-price story-price-lg">${lumina(f.season.bundlePriceLumina)}</span>
            <span class="story-price-strike">${lumina(f.season.singleSumLumina)}</span>
            ${seasonSaving > 0 ? `<span class="story-save-pill">${lumina(seasonSaving)} 절약</span>` : ""}
          </div>
          <button class="story-cta story-cta-paid" type="button" aria-disabled="true" data-story-preview="season">시즌 구매 미리보기</button>
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
            <button class="story-cta story-cta-extra" type="button" aria-disabled="true" data-story-preview="video">영상 만들기 미리보기</button>
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
          ${f.reactions.chapters.map((reaction) => `
            <li class="story-chapter-react">
              <span class="story-chapter-no">CH.${reaction.no}</span>
              <div class="story-react-meta">
                <span class="story-rating" aria-label="평점 ${reaction.rating}점">★ ${reaction.rating.toFixed(1)}</span>
                <span class="story-read-badge">완독 ${reaction.readers.toLocaleString("ko-KR")}명</span>
                <span class="story-react-count">댓글 ${reaction.comments}</span>
              </div>
            </li>
          `).join("")}
        </ul>
        <div class="story-comments">
          <p class="story-comments-head">스토리 전체 댓글 <span class="story-muted">· 구매한 사람만 남길 수 있습니다</span></p>
          ${f.reactions.storyComments.map((comment) => `
            <div class="story-comment">
              <div class="story-comment-top">
                <strong class="story-comment-author">${escapeHtml(comment.author)}</strong>
                ${comment.paid ? `<span class="story-buyer-badge">구매자</span>` : ""}
                ${comment.completed ? `<span class="story-read-badge is-done">완독</span>` : ""}
              </div>
              <p class="story-comment-text">${escapeHtml(comment.text)}</p>
            </div>
          `).join("")}
          <button class="story-cta story-cta-extra" type="button" aria-disabled="true" data-story-preview="comment">댓글 남기기 미리보기</button>
        </div>
      </section>
    `;

    bindStoryPreview(root);
    setStoryBranchChoice(root, "A");
    loadScenePreviewFixtures().then((scenes) => {
      _storyScenes = scenes.map(normalizeScene);
      _storySceneIndex = 0;
      renderStoryScene(_storyScenes[0]);
    });
  }

  function renderLocaleShell() {
    const t = copy();
    return `
      <section class="story-section story-locale-section" aria-labelledby="storyLocaleTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-extra">언어</span>
          <h2 id="storyLocaleTitle">${escapeHtml(t.localeTitle)}</h2>
        </div>
        <div class="story-locale-panel">
          <p>${escapeHtml(t.localeNote)}</p>
          <div class="story-locale-buttons" role="group" aria-label="Story language selector">
            ${LOCALES.map((locale) => `<button type="button" data-story-locale="${locale.code}" aria-pressed="false">${locale.label}</button>`).join("")}
          </div>
        </div>
      </section>
    `;
  }

  function setStoryBranchChoice(root, label) {
    const choice = branchChoice(label);
    if (!root || !choice) return;
    root.querySelectorAll("[data-story-branch-choice], [data-story-player-choice]").forEach((button) => {
      const buttonLabel = button.dataset.storyBranchChoice || button.dataset.storyPlayerChoice;
      const active = buttonLabel === choice.label;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    root.querySelectorAll("[data-story-branch-fixture-card]").forEach((card) => {
      card.classList.toggle("is-active", card.dataset.choice === choice.label);
    });

    const shell = root.querySelector("[data-story-mode-chat-shell]");
    if (shell) {
      shell.dataset.activeChoice = choice.label;
      shell.dataset.sceneId = choice.userSceneLabel;
      shell.dataset.backgroundId = choice.backgroundId;
      shell.dataset.characterAssetId = choice.characterAssetId;
    }
    const playerBg = root.querySelector("[data-story-player-bg]");
    if (playerBg) playerBg.style.backgroundImage = branchBackgroundStyle(choice);
    const playerScene = root.querySelector("[data-story-player-scene]");
    if (playerScene) playerScene.textContent = choice.userSceneLabel + " · " + choice.backgroundLabel;
    const playerBubble = root.querySelector("[data-story-player-bubble]");
    if (playerBubble) playerBubble.textContent = choice.chatLine;
    const playerCharacter = root.querySelector("[data-story-player-character]");
    if (playerCharacter) {
      if (choice.characterImage) {
        playerCharacter.hidden = false;
        playerCharacter.src = choice.characterImage;
      } else {
        playerCharacter.hidden = true;
        playerCharacter.removeAttribute("src");
      }
      playerCharacter.alt = choice.characterAssetLabel;
      playerCharacter.dataset.characterAssetId = choice.characterAssetId;
    }

    const result = root.querySelector("[data-story-choice-result]");
    if (result) {
      result.dataset.activeChoice = choice.label;
      result.dataset.sceneId = choice.userSceneLabel;
      result.dataset.backgroundId = choice.backgroundId;
    }
    const resultBg = root.querySelector("[data-choice-result-bg]");
    if (resultBg) resultBg.style.backgroundImage = branchBackgroundStyle(choice);
    const slots = [
      ["[data-choice-result-scene]", choice.title + " · " + choice.userSceneLabel],
      ["[data-choice-result-summary]", choice.bodySummary],
      ["[data-choice-result-event]", choice.eventLabel],
      ["[data-choice-result-relation]", choice.relationLabel],
      ["[data-choice-result-risk]", choice.riskLabel],
      ["[data-choice-result-info]", choice.infoLabel],
      ["[data-choice-result-ending]", choice.endingLabel],
      ["[data-choice-result-rejoin]", choice.rejoinLabel],
    ];
    slots.forEach(([selector, value]) => {
      const node = root.querySelector(selector);
      if (node) node.textContent = value;
    });
  }

  function setDiscoveryEmpty(root, isEmpty) {
    const grid = root.querySelector("[data-story-discovery-grid]");
    const empty = root.querySelector("[data-story-discovery-empty]");
    if (grid) grid.hidden = isEmpty;
    if (empty) empty.hidden = !isEmpty;
  }

  function bindStoryPreview(root) {
    if (root._storyPreviewBound) return;
    root._storyPreviewBound = true;

    root.addEventListener("click", (event) => {
      const branchButton = event.target.closest("[data-story-branch-choice], [data-story-player-choice]");
      if (branchButton) {
        event.preventDefault();
        setStoryBranchChoice(root, branchButton.dataset.storyBranchChoice || branchButton.dataset.storyPlayerChoice);
        return;
      }

      const chip = event.target.closest(".story-companion-chip");
      if (chip) {
        const group = chip.closest(".story-companion-chips");
        if (group) group.querySelectorAll(".story-companion-chip").forEach((button) => {
          button.classList.remove("is-selected");
          button.setAttribute("aria-pressed", "false");
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
        root.querySelectorAll("[data-story-locale]").forEach((button) => {
          button.setAttribute("aria-pressed", button === localeButton ? "true" : "false");
        });
        document.documentElement.lang = localeButton.dataset.storyLocale || "ko";
        renderStoryStage();
        return;
      }

      const filterChip = event.target.closest(".story-filter-chip");
      if (filterChip) {
        const row = filterChip.closest(".story-filter-row");
        if (row) row.querySelectorAll(".story-filter-chip").forEach((button) => {
          const active = button === filterChip;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
        });
        setDiscoveryEmpty(root, filterChip.dataset.storyFilter === "today-empty");
        return;
      }

      if (event.target.closest("[data-story-reset-filter]")) {
        const first = root.querySelector("[data-story-filter='recommended']");
        first?.click();
        return;
      }

      const detailButton = event.target.closest("[data-story-detail-open]");
      if (detailButton) {
        event.preventDefault();
        openStoryDetail(root, detailButton.dataset.storyDetailOpen);
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
    const item = STORY_DISCOVERY_ITEMS.find((story) => story.id === itemId) || STORY_DISCOVERY_ITEMS[0];
    const title = sheet.querySelector("#storyDetailTitle");
    const cover = sheet.querySelector(".story-detail-cover");
    const summary = sheet.querySelector("[data-story-detail-summary]");
    const tags = sheet.querySelector("[data-story-detail-tags]");
    const stats = sheet.querySelector("[data-story-detail-stats]");
    const creator = sheet.querySelector("[data-story-detail-creator]");
    const settings = sheet.querySelector("[data-story-detail-settings]");
    const updates = sheet.querySelector("[data-story-detail-updates]");
    const similar = sheet.querySelector("[data-story-detail-similar]");

    if (title) title.textContent = item.title;
    if (summary) summary.textContent = item.summary;
    if (tags) tags.innerHTML = item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
    if (stats) stats.innerHTML = String(item.metric || "Preview").split("·").map((piece) => `<span>${escapeHtml(piece.trim())}</span>`).join("");
    if (creator) creator.textContent = item.creator || "Lumina AI";
    if (settings) settings.textContent = item.startSetting || "읽기 전용 미리보기";
    if (updates) updates.textContent = item.updateText || "최근 QA 완료";
    if (similar) similar.textContent = item.similarTitle || STORY_DISCOVERY_ITEMS[0].title;
    if (cover) cover.style.backgroundImage = "linear-gradient(180deg, rgba(8,5,18,0.04), rgba(8,5,18,0.62)), url('" + item.image + "')";

    const startLink = sheet.querySelector("[data-story-detail-start]");
    if (startLink) {
      startLink.href = routeHandoffHref(item.id, "detail");
      startLink.dataset.storyId = item.id;
    }
    const continueLink = sheet.querySelector("[data-story-detail-continue]");
    if (continueLink) {
      continueLink.href = routeHandoffHref(item.id, "continue");
      continueLink.dataset.storyId = item.id;
    }
    const lockedLink = sheet.querySelector("[data-story-detail-locked]");
    if (lockedLink) {
      lockedLink.href = routeHandoffHref(item.id, "locked-preview");
      lockedLink.dataset.storyId = item.id;
    }
    sheet.hidden = false;
    sheet.setAttribute("aria-hidden", "false");
    backdrop.hidden = false;
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderStoryStage);
  } else {
    renderStoryStage();
  }

  window.renderStoryStage = renderStoryStage;
  window.renderStoryScene = renderStoryScene;
})();
