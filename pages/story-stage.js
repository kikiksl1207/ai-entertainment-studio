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
  });

  const STORY_SCENE_FALLBACKS = [
    {
      sceneId: "fixture-scene-01",
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

    if (text) text.textContent = activeScene.sceneText;
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

  function renderSetupShell() {
    return `
      <section class="story-section story-setup-section" aria-labelledby="storySetupTitle">
        <div class="story-section-head">
          <span class="story-eyebrow story-eyebrow-free">Personal + AI</span>
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
            <p>Private preview</p>
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

    root.innerHTML = `
      <div class="story-preview-banner" role="note">
        <strong>미리보기 화면</strong>
        <span>실제 결제, 정식 스토리 진행, provider 생성은 실행하지 않습니다.</span>
      </div>

      ${renderScenePreviewShell(fixtureMode)}

      ${renderPlayerShell()}

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

      const cta = event.target.closest("[data-story-preview]");
      if (cta) {
        event.preventDefault();
        showStoryPreviewToast();
      }
    });
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
