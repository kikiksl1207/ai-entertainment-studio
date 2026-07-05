(function initStoryUploadPage() {
  "use strict";

  const root = document.getElementById("storyUploadRoot");
  if (!root) return;

  const LOCALES = [
    { code: "ko", label: "KO" },
    { code: "en", label: "EN" },
    { code: "ja", label: "JA" },
    { code: "zh-Hans", label: "简" },
    { code: "zh-Hant", label: "繁" },
  ];

  const LOCALE_HTML = {
    ko: "ko-KR",
    en: "en-US",
    ja: "ja-JP",
    "zh-Hans": "zh-CN",
    "zh-Hant": "zh-Hant",
  };

  const COPY = {
    ko: {
      title: "작품 업로드",
      eyebrow: "Story upload",
      meta: "작품 기본 정보",
      scenes: "장면 목록",
      endings: "결말 요약",
      endingListLabel: "결말 목록",
      form: "장면 입력",
      import: "가져오기 미리보기",
      statusTitle: "검수 상태",
      status: {
        locale_ready: "다국어 문구 확인",
        qa_ready: "모바일 QA 준비",
        pm_review: "PM 확인",
        ok: "확인 완료",
      },
      statusHint: "에밀리가 다국어 문구와 길이를 확인하고, 뷰어가 모바일 화면을 이어서 봅니다.",
      handoff: ["에밀리 문구", "뷰어 화면", "QA 모바일"],
      labels: {
        storyTitle: "제목",
        genre: "장르",
        free: "무료 범위",
        minimum: "최소 구성",
        sceneId: "장면 ID",
        sceneTitle: "장면 제목",
        background: "배경",
        bgMemo: "배경 이미지 메모",
        cast: "등장 캐릭터",
        body: "본문",
        choices: "선택지",
        nextScene: "다음 장면",
        endingLink: "결말 연결",
        saveSoon: "저장 준비중",
        addChoice: "선택지 추가",
      },
      sample: {
        storyTitle: "임진왜란: 난중일기 프롤로그",
        genre: "역사 튜토리얼",
        free: "무료 프롤로그",
        minimum: "장면 3개 이상",
        background: "전장의 기록 사이로 북소리가 낮게 울립니다.",
        bgMemo: "촛불, 종이 지도, 낮은 연기",
        body: "긴 본문 원고를 먼저 붙여 넣고, 분기점과 이어질 장면을 선택지로 정리합니다.",
      },
      planTitle: "파트와 분기 기준",
      partLength: "1파트 10,000자 안팎",
      branchSummary: "분기 설명은 2,000자 이내",
      partCount: "10파트 단편극",
      branchTitle: "나무뿌리형 분기 결과",
      branchNote: "선택마다 관계, 위험, 아이템, 정보, 결말 조건의 차이를 남기고 필요할 때 다시 합류합니다.",
      onboardingTitle: "작가 업로드 안내",
      onboardingBody: "긴 원고는 본문에 두고, 독자가 고를 지점만 선택지로 표시합니다.",
      onboardingSteps: ["본문 원고", "분기점", "장면 연결"],
      referenceTitle: "검수용 바로가기",
      referenceNote: "읽기 전용 확인 화면입니다. 서비스 CTA가 아니며 저장이나 생성 요청을 실행하지 않습니다.",
      referenceLinks: [
        { label: "일일 보드", href: "/story-upload?cloudQa=pm-daily" },
        { label: "업로드 화면", href: "/story-upload?cloudQa=upload-panel" },
        { label: "장면 미리보기", href: "/story-stage?storySceneFixturePreview=1" },
      ],
      previewTitle: "작가 업로드 미리보기",
      previewBody: "원고 분량, 분기 설명, 결말 후보를 저장 없이 확인합니다.",
      ruleHead: "원고 기준",
      rulePart: "파트 분량",
      ruleBranch: "분기 설명",
      ruleStructure: "기본 구성",
      endingHead: "결말 설정",
      safeAssetHead: "공개 가능한 장면 자료",
      characterLabel: "캐릭터",
      authorEndingBasis: "작가 결말 기준",
      authorEndingText: "기본 결말 1개와 보조 결말 2-10개까지 확인합니다.",
      aiEndingBasis: "AI 보조 결말 기준",
      aiEndingText: "작가 결말이 없는 분기에서만 보조 후보로 표시하며 업로드 미리보기에서는 생성 요청을 실행하지 않습니다.",
      aiFallback: {
        title: "AI 보조 결말 안내",
        conditionText: "작가 결말이 없는 분기에서만 보조 결말 후보로 표시합니다.",
        branchLabel: "분기 상태",
        branchText: "B-C 분기는 작가 결말이 아직 설정되지 않았습니다.",
        providerLabel: "생성 상태",
        providerText: "가져오기 미리보기에서는 AI/provider를 실행하지 않습니다.",
      },
      endingLabels: {
        author_main: "작가 기본 결말",
        author_sub: "작가 보조 결말",
        ai_fallback: "AI 보조 결말",
      },
      endingCards: [
        { type: "author_main", title: "작가 기본 결말", body: "작가가 정한 중심 루트의 결말입니다." },
        { type: "author_sub", title: "작가 보조 결말", body: "작가가 별도로 준비한 선택 루트 결말입니다." },
        { type: "ai", title: "AI 보조 결말", body: "작가 결말이 없는 분기에서만 임시 후보로 이어집니다." },
      ],
      endings: ["E-MAIN · 작가 기본 결말", "E-SUB · 작가 보조 결말", "E-AI · AI 보조 결말"],
      choices: [
        { label: "A", tone: "info", text: "기록을 먼저 확인한다", next: "S05", result: "정보 획득 + 신뢰 상승", rejoin: "S09에서 합류", tags: ["정보", "신뢰"] },
        { label: "B", tone: "risk", text: "전령을 따라간다", next: "S06", result: "위험 증가 + 아이템 획득", rejoin: "S09에서 합류", tags: ["위험", "아이템"] },
        { label: "C", tone: "ending", text: "해안으로 우회한다", next: "S07", result: "관계 변화 + 보조 결말 조건", rejoin: "E-AI 후보", tags: ["관계", "결말"] },
      ],
      importHead: ["장면", "분기", "결말", "파트 수", "분기 설명 제한", "상태"],
      importState: { ok: "확인 완료", pm: "PM 확인" },
      importFlags: ["배경과 등장 캐릭터 누락 여부를 확인합니다.", "저작권 확인이 필요한 항목은 PM에게 보냅니다.", "실제 저장이나 결제 요청은 실행하지 않습니다."],
      importSave: "가져오기 준비중",
      sceneTitleValue: "새 분기 장면",
      castValue: "이순신, 기록관, 전령",
    },
    en: {
      title: "Story Upload",
      eyebrow: "Story upload",
      meta: "Story basics",
      scenes: "Scene list",
      endings: "Ending summary",
      endingListLabel: "Ending list",
      form: "Scene input",
      import: "Import preview",
      statusTitle: "Review status",
      status: { locale_ready: "Locale review", qa_ready: "QA ready", pm_review: "PM review", ok: "Checked" },
      statusHint: "Emily checks copy length, then Viewer reviews the mobile screen.",
      handoff: ["Emily copy", "Viewer screen", "QA mobile"],
      labels: {
        storyTitle: "Title",
        genre: "Genre",
        free: "Free scope",
        minimum: "Minimum",
        sceneId: "Scene ID",
        sceneTitle: "Scene title",
        background: "Background",
        bgMemo: "Image note",
        cast: "Cast",
        body: "Body",
        choices: "Choices",
        nextScene: "Next scene",
        endingLink: "Ending link",
        saveSoon: "Save soon",
        addChoice: "Add choice",
      },
      sample: {
        storyTitle: "Imjin War: Nanjung Diary Prologue",
        genre: "History tutorial",
        free: "Free prologue",
        minimum: "At least 3 scenes",
        background: "A low drumbeat moves through wartime records.",
        bgMemo: "Candlelight, paper map, low smoke",
        body: "Paste the long manuscript first, then organize branch points and next scenes as choices.",
      },
      planTitle: "Part and branch rules",
      partLength: "About 10,000 characters per part",
      branchSummary: "Branch summary stays within 2,000 characters",
      partCount: "10-part short drama",
      branchTitle: "Root-style branch outcomes",
      branchNote: "Each choice keeps relation, risk, item, info, and ending-condition changes before any rejoin.",
      onboardingTitle: "Writer upload guide",
      onboardingBody: "Keep the long manuscript in body text and mark only reader choice points.",
      onboardingSteps: ["Manuscript", "Branch points", "Scene links"],
      referenceTitle: "Review links",
      referenceNote: "Read-only checkpoints for reviewers. These are not service CTAs and nothing is saved.",
      referenceLinks: [
        { label: "Daily board", href: "/story-upload?cloudQa=pm-daily" },
        { label: "Story upload", href: "/story-upload?cloudQa=upload-panel" },
        { label: "Scene preview", href: "/story-stage?storySceneFixturePreview=1" },
      ],
      previewTitle: "Writer upload preview",
      previewBody: "Check manuscript length, branch summaries, and ending candidates without saving.",
      ruleHead: "Manuscript rules",
      rulePart: "Part length",
      ruleBranch: "Branch summary",
      ruleStructure: "Base structure",
      endingHead: "Ending setup",
      safeAssetHead: "Public scene assets",
      characterLabel: "Character",
      authorEndingBasis: "Writer ending rule",
      authorEndingText: "Confirm 1 primary ending and 2-10 side endings when needed.",
      aiEndingBasis: "AI-assisted ending rule",
      aiEndingText: "Only shown as a helper candidate when a branch has no writer ending. This preview never runs generation.",
      aiFallback: {
        title: "AI-assisted ending note",
        conditionText: "Shown only for branches without a writer ending.",
        branchLabel: "Branch status",
        branchText: "Branch B-C has no writer ending configured.",
        providerLabel: "Generation state",
        providerText: "This import preview does not run AI/provider output.",
      },
      endingLabels: { author_main: "Writer primary ending", author_sub: "Writer side ending", ai_fallback: "AI-assisted ending" },
      endingCards: [
        { type: "author_main", title: "Writer primary ending", body: "The writer's primary route ending." },
        { type: "author_sub", title: "Writer side ending", body: "A writer-prepared ending for a side route." },
        { type: "ai", title: "AI-assisted ending", body: "A helper ending only for branches without writer endings." },
      ],
      endings: ["E-MAIN · Writer primary ending", "E-SUB · Writer side ending", "E-AI · AI-assisted ending"],
      choices: [
        { label: "A", tone: "info", text: "Check the record first", next: "S05", result: "Info + trust up", rejoin: "Rejoins at S09", tags: ["Info", "Trust"] },
        { label: "B", tone: "risk", text: "Follow the messenger", next: "S06", result: "Risk + item gained", rejoin: "Rejoins at S09", tags: ["Risk", "Item"] },
        { label: "C", tone: "ending", text: "Detour to the shore", next: "S07", result: "Relation shift + helper ending rule", rejoin: "E-AI candidate", tags: ["Relation", "Ending"] },
      ],
      importHead: ["Scene", "Branch", "Ending", "Part count", "Branch summary limit", "State"],
      importState: { ok: "Checked", pm: "PM check" },
      importFlags: ["Check missing background and cast fields.", "Send copyright-sensitive items to PM.", "No save or payment request is executed."],
      importSave: "Import soon",
      sceneTitleValue: "New branch scene",
      castValue: "Yi Sun-sin, archivist, messenger",
    },
  };

  COPY.ja = COPY.en;
  COPY["zh-Hans"] = COPY.en;
  COPY["zh-Hant"] = COPY.en;

  const sampleScenes = [
    { id: "S01", title: "기록의 밤", state: "pm_review" },
    { id: "S02", title: "첫 분기", state: "locale_ready" },
    { id: "S03", title: "공통 장면", state: "qa_ready" },
    { id: "S09", title: "합류 장면", state: "qa_ready" },
  ];

  const importRows = [
    { scene: "S01", branch: "ROOT", ending: "author_main", part: "10", summary: "<= 2,000", state: "ok" },
    { scene: "S05", branch: "B-A", ending: "author_sub", part: "10", summary: "<= 2,000", state: "ok" },
    { scene: "S07", branch: "B-C", ending: "ai_fallback", part: "10", summary: "<= 2,000", state: "pm" },
  ];

  const aiFallbackEvidence = {
    ending: "ai_fallback",
    providerGeneratedAtIntake: "false",
    fallbackReason: "writer_ending_missing",
  };

  const endingValidationEvidence = {
    authorMainCount: "1",
    authorSubCount: "2",
    authorSubMin: "2",
    authorSubMax: "10",
    aiFallbackPolicy: "writer-ending-missing-only",
    writerEndingConfigured: "false",
    providerGeneratedAtIntake: "false",
  };

  const AUTHOR_PREVIEW_FIXTURE = {
    partLength: "10000",
    branchSummaryLimit: "2000",
    shortDramaParts: "10",
    endings: [
      { label: "작가 기본 결말", count: "1", state: "configured", stateLabel: "설정됨" },
      { label: "작가 보조 결말", count: "2", state: "configured", stateLabel: "설정됨" },
      { label: "AI 보조 결말", count: "1", state: "missing-writer-ending-only", stateLabel: "작가 결말 없을 때만" },
    ],
    backgrounds: [
      { scene: "S05", assetId: "bg-war-room-map", label: "작전 지도실" },
      { scene: "S06", assetId: "bg-harbor-night", label: "밤 항구 추적" },
      { scene: "S07", assetId: "bg-fog-shore", label: "안개 해안 우회" },
    ],
    characters: [
      { assetId: "character.cha-dohyun.reference-final-03", label: "차도현 안내 컷" },
      { assetId: "none", label: "S07은 캐릭터 없이 진행 가능" },
    ],
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function field(label, value) {
    return `<li><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></li>`;
  }

  function copyFor(localeCode) {
    return COPY[localeCode] || COPY.ko;
  }

  function renderAuthorGuide(copy) {
    return `
      <div class="su-author-guide">
        <div>
          <h3>${escapeHtml(copy.onboardingTitle)}</h3>
          <p>${escapeHtml(copy.onboardingBody)}</p>
        </div>
        <ol>
          ${copy.onboardingSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
        </ol>
      </div>
    `;
  }

  function renderReferencePanel(copy) {
    return `
      <aside class="su-reference-panel" aria-label="${escapeHtml(copy.referenceTitle)}">
        <div>
          <h2>${escapeHtml(copy.referenceTitle)}</h2>
          <p>${escapeHtml(copy.referenceNote)}</p>
        </div>
        <nav>
          ${copy.referenceLinks.map((link) => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join("")}
        </nav>
      </aside>
    `;
  }

  function endingLabel(copy, value) {
    return copy.endingLabels?.[value] || copy.endingLabels.ai_fallback;
  }

  function renderUploadWorkspace(localeCode) {
    const activeLocale = COPY[localeCode] ? localeCode : "ko";
    const copy = copyFor(activeLocale);
    document.documentElement.lang = LOCALE_HTML[activeLocale] || "ko-KR";

    root.innerHTML = `
      <div class="su-shell" data-story-upload-locale="${escapeHtml(activeLocale)}">
        <header class="su-header">
          <div class="su-title-group">
            <p class="su-eyebrow">${escapeHtml(copy.eyebrow)}</p>
            <h1 class="su-title">${escapeHtml(copy.title)}</h1>
          </div>
          <div class="su-locale" aria-label="Story upload locale">
            ${LOCALES.map((item) => `<button type="button" data-su-locale="${item.code}" aria-pressed="${item.code === activeLocale ? "true" : "false"}">${item.label}</button>`).join("")}
          </div>
        </header>

        <section class="su-grid" aria-label="Story upload overview">
          <div class="su-section">
            <h2>${escapeHtml(copy.meta)}</h2>
            <ul class="su-meta-list">
              ${field(copy.labels.storyTitle, copy.sample.storyTitle)}
              ${field(copy.labels.genre, copy.sample.genre)}
              ${field(copy.labels.free, copy.sample.free)}
              ${field(copy.labels.minimum, copy.sample.minimum)}
              ${field(copy.planTitle, `${copy.partLength} · ${copy.partCount}`)}
              ${field(copy.labels.choices, copy.branchSummary)}
            </ul>
            ${renderAuthorGuide(copy)}
          </div>
          <div class="su-panel su-review-status" data-status="locale_ready">
            <h2>${escapeHtml(copy.statusTitle)}</h2>
            <span class="su-status-pill">${escapeHtml(copy.status.locale_ready)}</span>
            <p class="su-status-hint">${escapeHtml(copy.statusHint)}</p>
            <div class="su-status-handoff">${copy.handoff.map((item) => `<span class="su-chip">${escapeHtml(item)}</span>`).join("")}</div>
          </div>
        </section>

        <section class="su-section su-author-preview-panel"
                 data-author-upload-preview-panel="true"
                 data-part-length="${escapeHtml(AUTHOR_PREVIEW_FIXTURE.partLength)}"
                 data-branch-summary-limit="${escapeHtml(AUTHOR_PREVIEW_FIXTURE.branchSummaryLimit)}"
                 data-short-drama-parts="${escapeHtml(AUTHOR_PREVIEW_FIXTURE.shortDramaParts)}">
          <div class="su-author-preview-head">
            <h2>${escapeHtml(copy.previewTitle)}</h2>
            <p>${escapeHtml(copy.previewBody)}</p>
          </div>
          <div class="su-preview-grid">
            <article class="su-preview-card" data-preview-kind="length">
              <strong>${escapeHtml(copy.ruleHead)}</strong>
              <dl>
                <div><dt>${escapeHtml(copy.rulePart)}</dt><dd>10,000자</dd></div>
                <div><dt>${escapeHtml(copy.ruleBranch)}</dt><dd>2,000자 이내</dd></div>
                <div><dt>${escapeHtml(copy.ruleStructure)}</dt><dd>10파트 단편극</dd></div>
              </dl>
            </article>
            <article class="su-preview-card" data-preview-kind="ending">
              <strong>${escapeHtml(copy.endingHead)}</strong>
              <ul>
                ${AUTHOR_PREVIEW_FIXTURE.endings.map((ending) => `
                  <li data-ending-state="${escapeHtml(ending.state)}">
                    <span>${escapeHtml(ending.label)}</span>
                    <b>${escapeHtml(ending.count)}</b>
                    <em>${escapeHtml(ending.stateLabel)}</em>
                  </li>
                `).join("")}
              </ul>
            </article>
            <article class="su-preview-card" data-preview-kind="safe-assets">
              <strong>${escapeHtml(copy.safeAssetHead)}</strong>
              <dl>
                ${AUTHOR_PREVIEW_FIXTURE.backgrounds.map((asset) => `
                  <div data-safe-background-id="${escapeHtml(asset.assetId)}">
                    <dt>${escapeHtml(asset.scene)}</dt>
                    <dd>${escapeHtml(asset.label)}</dd>
                  </div>
                `).join("")}
                ${AUTHOR_PREVIEW_FIXTURE.characters.map((asset) => `
                  <div data-safe-character-id="${escapeHtml(asset.assetId)}">
                    <dt>${escapeHtml(copy.characterLabel)}</dt>
                    <dd>${escapeHtml(asset.label)}</dd>
                  </div>
                `).join("")}
              </dl>
            </article>
          </div>
        </section>

        <section class="su-grid">
          <div class="su-section">
            <h2>${escapeHtml(copy.scenes)}</h2>
            <ul class="su-scene-list">
              ${sampleScenes.map((scene) => `<li class="su-scene-item"><span>${escapeHtml(scene.id)}</span><strong>${escapeHtml(scene.title)} · ${escapeHtml(copy.status[scene.state] || copy.status.ok)}</strong></li>`).join("")}
            </ul>
          </div>
          <div class="su-section">
            <h2>${escapeHtml(copy.endings)}</h2>
            <div class="su-ending-summary su-ending-cards">
              ${copy.endingCards.map((ending) => `
                <article class="su-ending-card" data-ending="${escapeHtml(ending.type)}">
                  <span class="su-ending-badge" data-ending="${escapeHtml(ending.type)}">${escapeHtml(ending.title)}</span>
                  <p>${escapeHtml(ending.body)}</p>
                </article>
              `).join("")}
            </div>
            <details class="su-ending-list">
              <summary>${escapeHtml(copy.endingListLabel || copy.endings)} <b>${copy.endings.length}</b></summary>
              <ul>
                ${copy.endings.map((ending) => `<li>${escapeHtml(ending)}</li>`).join("")}
              </ul>
            </details>
            <dl class="su-ai-fallback-evidence"
                data-ending="${escapeHtml(aiFallbackEvidence.ending)}"
                data-ai-fallback-policy="writer-ending-missing-only"
                data-writer-ending-configured="false"
                data-provider-generated-at-intake="${escapeHtml(aiFallbackEvidence.providerGeneratedAtIntake)}"
                data-fallback-reason-key="${escapeHtml(aiFallbackEvidence.fallbackReason)}">
              <dt>${escapeHtml(copy.aiFallback.title)}</dt>
              <dd>${escapeHtml(copy.aiFallback.conditionText)}</dd>
              <dt>${escapeHtml(copy.aiFallback.branchLabel)}</dt>
              <dd>${escapeHtml(copy.aiFallback.branchText)}</dd>
              <dt>${escapeHtml(copy.aiFallback.providerLabel)}</dt>
              <dd>${escapeHtml(copy.aiFallback.providerText)}</dd>
            </dl>
            <dl class="su-ending-validation-evidence"
                data-author-main-count="${escapeHtml(endingValidationEvidence.authorMainCount)}"
                data-author-sub-count="${escapeHtml(endingValidationEvidence.authorSubCount)}"
                data-author-sub-min="${escapeHtml(endingValidationEvidence.authorSubMin)}"
                data-author-sub-max="${escapeHtml(endingValidationEvidence.authorSubMax)}"
                data-ai-fallback-policy="${escapeHtml(endingValidationEvidence.aiFallbackPolicy)}"
                data-writer-ending-configured="${escapeHtml(endingValidationEvidence.writerEndingConfigured)}"
                data-provider-generated-at-intake="${escapeHtml(endingValidationEvidence.providerGeneratedAtIntake)}">
              <dt>${escapeHtml(copy.authorEndingBasis)}</dt>
              <dd>${escapeHtml(copy.authorEndingText)}</dd>
              <dt>${escapeHtml(copy.aiEndingBasis)}</dt>
              <dd>${escapeHtml(copy.aiEndingText)}</dd>
            </dl>
          </div>
        </section>

        <section class="su-section">
          <h2>${escapeHtml(copy.form)}</h2>
          <form class="su-scene-form" aria-label="Scene upload preview form">
            <div class="su-row">
              <label class="su-field"><span>${escapeHtml(copy.labels.sceneId)}</span><input name="sceneId" value="S04" readonly /></label>
              <label class="su-field"><span>${escapeHtml(copy.labels.sceneTitle)}</span><input name="sceneTitle" value="${escapeHtml(copy.sceneTitleValue)}" readonly /></label>
            </div>
            <details open>
              <summary>${escapeHtml(copy.labels.background)}</summary>
              <div>
                <textarea name="background" rows="2" readonly>${escapeHtml(copy.sample.background)}</textarea>
                <input name="bgImageMemo" value="${escapeHtml(copy.sample.bgMemo)}" readonly />
              </div>
            </details>
            <details>
              <summary>${escapeHtml(copy.labels.cast)}</summary>
              <div><input value="${escapeHtml(copy.castValue)}" readonly /></div>
            </details>
            <label class="su-field"><span>${escapeHtml(copy.labels.body)}</span><textarea name="body" rows="8" class="su-body" readonly>${escapeHtml(copy.sample.body)}</textarea></label>
            <div class="su-choices" aria-label="${escapeHtml(copy.labels.choices)}">
              ${copy.choices.map((choice) => `<div class="su-choice-row"><input value="${escapeHtml(choice.label)}" readonly /><input value="${escapeHtml(choice.text)}" readonly /><input value="${escapeHtml(choice.next)}" readonly /></div>`).join("")}
              <button class="su-action" type="button" disabled aria-disabled="true">${escapeHtml(copy.labels.addChoice)}</button>
            </div>
            <div class="su-row">
              <label class="su-field"><span>${escapeHtml(copy.labels.nextScene)}</span><input name="nextScene" value="S05" readonly /></label>
              <label class="su-field"><span>${escapeHtml(copy.labels.endingLink)}</span><input value="E-SUB-01" readonly /></label>
            </div>
            <button type="button" class="su-save" disabled aria-disabled="true">${escapeHtml(copy.labels.saveSoon)}</button>
          </form>
        </section>

        <section class="su-section">
          <h2>${escapeHtml(copy.branchTitle)}</h2>
          <p class="su-muted">${escapeHtml(copy.branchNote)}</p>
          <div class="su-branch-tree">
            ${copy.choices.map((choice) => `
              <article class="su-branch-card" data-branch-tone="${escapeHtml(choice.tone)}">
                <div class="su-branch-head">
                  <b>${escapeHtml(choice.label)}</b>
                  <strong>${escapeHtml(choice.next)}</strong>
                </div>
                <p>${escapeHtml(choice.text)}</p>
                <span>${escapeHtml(choice.result)}</span>
                <div class="su-branch-tags">${choice.tags.map((tag) => `<small>${escapeHtml(tag)}</small>`).join("")}</div>
                <em>${escapeHtml(choice.rejoin)}</em>
              </article>
            `).join("")}
          </div>
        </section>

        ${renderReferencePanel(copy)}

        <section class="su-section">
          <h2>${escapeHtml(copy.import)}</h2>
          <div class="su-import-wrap">
            <table class="su-import-preview">
              <thead><tr>${copy.importHead.map((head) => `<th>${escapeHtml(head)}</th>`).join("")}</tr></thead>
              <tbody>
                ${importRows.map((row) => `
                  <tr
                    data-ending-type="${escapeHtml(row.ending)}"
                    data-ai-fallback-policy="${row.ending === "ai_fallback" ? "writer-ending-missing-only" : "writer-route-wins"}"
                    data-writer-ending-configured="${row.ending === "ai_fallback" ? "false" : "true"}"
                    data-provider-generated-at-intake="false"
                  >
                    <td>${escapeHtml(row.scene)}</td>
                    <td>${escapeHtml(row.branch)}</td>
                    <td data-ending-type="${escapeHtml(row.ending)}">${escapeHtml(endingLabel(copy, row.ending))}</td>
                    <td>${escapeHtml(row.part)}</td>
                    <td>${escapeHtml(row.summary)}</td>
                    <td>${escapeHtml(copy.importState[row.state] || copy.status.ok)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <ul class="su-import-flags">
            ${copy.importFlags.map((flag) => `<li>${escapeHtml(flag)}</li>`).join("")}
          </ul>
          <button type="button" class="su-import-save" disabled aria-disabled="true">${escapeHtml(copy.importSave)}</button>
        </section>
      </div>
    `;

    root.querySelectorAll("[data-su-locale]").forEach((button) => {
      button.addEventListener("click", () => renderUploadWorkspace(button.dataset.suLocale));
    });
  }

  window.renderUploadWorkspace = renderUploadWorkspace;
  renderUploadWorkspace("ko");
})();
