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

  const TEXT = {
    ko: {
      title: "작품 업로드",
      eyebrow: "Story upload",
      meta: "작품 기본 정보",
      scenes: "장면 목록",
      endings: "엔딩 요약",
      form: "장면 입력",
      import: "가져오기 미리보기",
      statusTitle: "검수 상태",
      status: {
        draft: "작성 중",
        needs_revision: "수정 필요",
        pm_review: "PM 검수",
        locale_ready: "다국어 준비",
        qa_ready: "QA 준비",
        publish_ready: "발행 준비",
        blocked: "막힘",
      },
      statusHint: {
        draft: "작가가 원고와 장면 정보를 정리 중이에요.",
        needs_revision: "수정 요청을 확인하고 장면 정보를 보완해요.",
        pm_review: "PM이 저작권과 구조를 확인 중이에요.",
        locale_ready: "에밀리가 다국어 문구와 길이를 확인해요.",
        qa_ready: "뷰어와 큐알이 모바일 화면을 확인해요.",
        publish_ready: "발행 전 최종 확인만 남았어요.",
        blocked: "막힌 사유를 확인해야 다음 단계로 갈 수 있어요.",
      },
      handoff: ["에밀리 다국어", "뷰어 visual", "큐알 QA"],
      labels: {
        storyTitle: "제목",
        genre: "장르",
        free: "무료 여부",
        minimum: "최소 분량",
        sceneId: "장면 ID",
        sceneTitle: "장면 제목",
        background: "배경",
        bgMemo: "배경 이미지 메모",
        cast: "등장 캐릭터",
        body: "본문",
        choices: "선택지",
        nextScene: "다음 장면",
        endingLink: "엔딩 연결",
        saveSoon: "저장 (준비 중)",
        addChoice: "선택지 추가",
      },
      ending: { author_main: "작가 기본", author_sub: "작가 서브", ai: "AI 엔딩", subCount: "서브 엔딩" },
      importHead: ["장면", "분기", "엔딩", "배경", "등장", "상태"],
      importState: { ok: "확인됨", missing: "누락", copyright: "저작권 확인", pm: "PM 확인" },
      importFlags: ["배경/등장 누락 항목이 있어요.", "저작권 확인이 필요해요.", "PM 확인이 필요해요."],
      importSave: "가져오기 (준비 중)",
      sample: {
        title: "임진왜란: 난중일기 프롤로그",
        genre: "역사 튜토리얼",
        free: "무료 프롤로그",
        minimum: "장면 3개 이상",
        background: "전장 기록 사이로 낮은 북소리가 들려요.",
        bgMemo: "촛불, 종이 지도, 낮은 연기",
        body: "긴 본문 원고를 먼저 붙여 넣고, 분기점과 이어질 장면을 아래 선택지로 정리해요.",
        sceneTitle: "새 분기 장면",
        cast: "이순신, 기록관, 전령",
        choiceA: "기록을 먼저 확인한다",
        choiceB: "전령을 따라간다",
      },
    },
    en: {
      title: "Story Upload",
      eyebrow: "Story upload",
      meta: "Story basics",
      scenes: "Scene list",
      endings: "Ending summary",
      form: "Scene input",
      import: "Import preview",
      statusTitle: "Review status",
      status: {
        draft: "Draft",
        needs_revision: "Revise",
        pm_review: "PM review",
        locale_ready: "Locale ready",
        qa_ready: "QA ready",
        publish_ready: "Ready",
        blocked: "Blocked",
      },
      statusHint: {
        draft: "The writer is preparing manuscript and scene notes.",
        needs_revision: "Review requested changes before the next pass.",
        pm_review: "PM is checking copyright and structure.",
        locale_ready: "Emily checks localized copy and text length.",
        qa_ready: "Viewer and QA check mobile screens.",
        publish_ready: "Only final confirmation remains.",
        blocked: "Resolve the blocking reason before moving on.",
      },
      handoff: ["Emily locale", "Viewer visual", "QA mobile"],
      labels: {
        storyTitle: "Title",
        genre: "Genre",
        free: "Free status",
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
        saveSoon: "Save (soon)",
        addChoice: "Add choice",
      },
      ending: { author_main: "Main", author_sub: "Sub", ai: "AI ending", subCount: "Sub endings" },
      importHead: ["Scene", "Branch", "Ending", "Background", "Cast", "State"],
      importState: { ok: "Checked", missing: "Missing", copyright: "Copyright", pm: "PM check" },
      importFlags: ["Some background or cast fields are missing.", "Copyright review is required.", "PM confirmation is required."],
      importSave: "Import (soon)",
      sample: {
        title: "Imjin War: Nanjung Diary Prologue",
        genre: "History tutorial",
        free: "Free prologue",
        minimum: "At least 3 scenes",
        background: "A low drumbeat moves through wartime records.",
        bgMemo: "Candlelight, paper map, low smoke",
        body: "Paste the long manuscript first, then organize branch points and next scenes as choices.",
        sceneTitle: "New branch scene",
        cast: "Lee Soon-shin, Recorder, Messenger",
        choiceA: "Check the record first",
        choiceB: "Follow the messenger",
      },
    },
    ja: {
      title: "作品アップロード",
      eyebrow: "Story upload",
      meta: "作品基本情報",
      scenes: "シーン一覧",
      endings: "エンディング要約",
      form: "シーン入力",
      import: "取り込みプレビュー",
      statusTitle: "確認ステータス",
      status: {
        draft: "作成中",
        needs_revision: "修正必要",
        pm_review: "PM確認",
        locale_ready: "多言語準備",
        qa_ready: "QA準備",
        publish_ready: "公開準備",
        blocked: "停止中",
      },
      statusHint: {
        draft: "作家が原稿とシーン情報を整理しています。",
        needs_revision: "修正依頼を確認して補完します。",
        pm_review: "PMが著作権と構成を確認しています。",
        locale_ready: "エミリーが多言語文言と長さを確認します。",
        qa_ready: "ビューアとQAがモバイル画面を確認します。",
        publish_ready: "公開前の最終確認だけが残っています。",
        blocked: "停止理由の確認が必要です。",
      },
      handoff: ["エミリー多言語", "ビューア確認", "QA確認"],
      labels: {
        storyTitle: "タイトル",
        genre: "ジャンル",
        free: "無料状態",
        minimum: "最小分量",
        sceneId: "シーンID",
        sceneTitle: "シーン名",
        background: "背景",
        bgMemo: "背景画像メモ",
        cast: "登場人物",
        body: "本文",
        choices: "選択肢",
        nextScene: "次シーン",
        endingLink: "終了接続",
        saveSoon: "保存（準備中）",
        addChoice: "選択肢追加",
      },
      ending: { author_main: "作家基本", author_sub: "作家サブ", ai: "AI終了", subCount: "サブ終了" },
      importHead: ["シーン", "分岐", "終了", "背景", "登場", "状態"],
      importState: { ok: "確認済み", missing: "不足", copyright: "権利確認", pm: "PM確認" },
      importFlags: ["背景または登場人物に不足があります。", "著作権確認が必要です。", "PM確認が必要です。"],
      importSave: "取り込み（準備中）",
      sample: {
        title: "壬辰倭乱：乱中日記プロローグ",
        genre: "歴史チュートリアル",
        free: "無料プロローグ",
        minimum: "3シーン以上",
        background: "戦記の間に低い太鼓の音が響きます。",
        bgMemo: "ろうそく、紙の地図、薄い煙",
        body: "長い本文原稿を先に入れ、分岐点と次のシーンを選択肢で整理します。",
        sceneTitle: "新しい分岐シーン",
        cast: "李舜臣、記録官、伝令",
        choiceA: "記録を先に確認する",
        choiceB: "伝令について行く",
      },
    },
    "zh-Hans": {
      title: "作品上传",
      eyebrow: "Story upload",
      meta: "作品信息",
      scenes: "场景列表",
      endings: "结局摘要",
      form: "场景输入",
      import: "导入预览",
      statusTitle: "审核状态",
      status: {
        draft: "编写中",
        needs_revision: "需修改",
        pm_review: "PM审核",
        locale_ready: "多语言准备",
        qa_ready: "QA准备",
        publish_ready: "待发布",
        blocked: "受阻",
      },
      statusHint: {
        draft: "作者正在整理稿件和场景信息。",
        needs_revision: "请确认修改请求并补充信息。",
        pm_review: "PM正在确认版权和结构。",
        locale_ready: "Emily确认多语言文案和长度。",
        qa_ready: "Viewer和QA确认移动端画面。",
        publish_ready: "只剩发布前最终确认。",
        blocked: "需要先确认阻塞原因。",
      },
      handoff: ["Emily多语言", "Viewer视觉", "QA移动端"],
      labels: {
        storyTitle: "标题",
        genre: "类型",
        free: "免费状态",
        minimum: "最低量",
        sceneId: "场景ID",
        sceneTitle: "场景标题",
        background: "背景",
        bgMemo: "背景图备注",
        cast: "登场角色",
        body: "正文",
        choices: "选项",
        nextScene: "下一场景",
        endingLink: "连接结局",
        saveSoon: "保存（准备中）",
        addChoice: "添加选项",
      },
      ending: { author_main: "作者主线", author_sub: "作者支线", ai: "AI结局", subCount: "支线结局" },
      importHead: ["场景", "分支", "结局", "背景", "登场", "状态"],
      importState: { ok: "已确认", missing: "缺失", copyright: "版权确认", pm: "PM确认" },
      importFlags: ["存在背景或登场角色缺失项。", "需要进行版权确认。", "需要PM确认。"],
      importSave: "导入（准备中）",
      sample: {
        title: "壬辰倭乱：乱中日记序章",
        genre: "历史教程",
        free: "免费序章",
        minimum: "至少3个场景",
        background: "战时记录之间传来低沉鼓声。",
        bgMemo: "烛光、纸地图、低烟",
        body: "先粘贴长篇正文稿，再用选项整理分支点和后续场景。",
        sceneTitle: "新的分支场景",
        cast: "李舜臣、记录官、传令",
        choiceA: "先确认记录",
        choiceB: "跟随传令",
      },
    },
    "zh-Hant": {
      title: "作品上傳",
      eyebrow: "Story upload",
      meta: "作品資訊",
      scenes: "場景列表",
      endings: "結局摘要",
      form: "場景輸入",
      import: "匯入預覽",
      statusTitle: "審核狀態",
      status: {
        draft: "撰寫中",
        needs_revision: "需修改",
        pm_review: "PM審核",
        locale_ready: "多語準備",
        qa_ready: "QA準備",
        publish_ready: "待發布",
        blocked: "受阻",
      },
      statusHint: {
        draft: "作者正在整理稿件與場景資訊。",
        needs_revision: "請確認修改要求並補充資訊。",
        pm_review: "PM正在確認版權與結構。",
        locale_ready: "Emily確認多語文案與長度。",
        qa_ready: "Viewer與QA確認行動版畫面。",
        publish_ready: "只剩發布前最終確認。",
        blocked: "需要先確認阻塞原因。",
      },
      handoff: ["Emily多語", "Viewer視覺", "QA行動版"],
      labels: {
        storyTitle: "標題",
        genre: "類型",
        free: "免費狀態",
        minimum: "最低量",
        sceneId: "場景ID",
        sceneTitle: "場景標題",
        background: "背景",
        bgMemo: "背景圖備註",
        cast: "登場角色",
        body: "正文",
        choices: "選項",
        nextScene: "下一場景",
        endingLink: "連接結局",
        saveSoon: "儲存（準備中）",
        addChoice: "新增選項",
      },
      ending: { author_main: "作者主線", author_sub: "作者支線", ai: "AI結局", subCount: "支線結局" },
      importHead: ["場景", "分支", "結局", "背景", "登場", "狀態"],
      importState: { ok: "已確認", missing: "缺失", copyright: "版權確認", pm: "PM確認" },
      importFlags: ["存在背景或登場角色缺失項。", "需要進行版權確認。", "需要PM確認。"],
      importSave: "匯入（準備中）",
      sample: {
        title: "壬辰倭亂：亂中日記序章",
        genre: "歷史教程",
        free: "免費序章",
        minimum: "至少3個場景",
        background: "戰時記錄之間傳來低沉鼓聲。",
        bgMemo: "燭光、紙地圖、低煙",
        body: "先貼上長篇正文稿，再用選項整理分支點與後續場景。",
        sceneTitle: "新的分支場景",
        cast: "李舜臣、記錄官、傳令",
        choiceA: "先確認記錄",
        choiceB: "跟隨傳令",
      },
    },
  };

  const LOCALE_TO_REGION = {
    ko: "ko-KR",
    en: "en-US",
    ja: "ja-JP",
    "zh-Hans": "zh-CN",
    "zh-Hant": "zh-Hant",
  };

  const DEFAULT_UPLOAD_STORY = Object.freeze({
    meta: { reviewStatus: "locale_ready" },
    scenes: [{
      sceneId: "S04",
      title: "",
      background: "",
      bgImageMemo: "",
      cast: [],
      body: "",
      choices: [
        { label: "A", text: "", nextScene: "S05" },
        { label: "B", text: "", nextScene: "S06" },
      ],
      nextScene: "S05",
      isEnding: false,
    }],
    endings: [
      { type: "author_main", label: "Main" },
      { type: "author_sub", label: "Sub" },
      { type: "ai", label: "AI" },
    ],
    importFlags: { missing: ["background", "cast"], copyright: true, pmReview: true },
  });

  let currentStory = window.LuminaStoryUploadFixture || DEFAULT_UPLOAD_STORY;
  let currentLocale = "ko";

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

  function safeStatus(status) {
    return ["draft", "needs_revision", "pm_review", "locale_ready", "qa_ready", "publish_ready", "blocked"].includes(status)
      ? status
      : "locale_ready";
  }

  function normalizeStory(story, copy) {
    const source = story && typeof story === "object" ? story : DEFAULT_UPLOAD_STORY;
    const meta = source.meta || {};
    const scenes = Array.isArray(source.scenes) && source.scenes.length ? source.scenes : DEFAULT_UPLOAD_STORY.scenes;
    const first = scenes[0] || DEFAULT_UPLOAD_STORY.scenes[0];
    const endings = Array.isArray(source.endings) && source.endings.length ? source.endings : DEFAULT_UPLOAD_STORY.endings;
    const reviewStatus = safeStatus(meta.reviewStatus);
    return {
      meta: {
        title: meta.title || copy.sample.title,
        genre: meta.genre || copy.sample.genre,
        free: typeof meta.isFree === "boolean" ? (meta.isFree ? copy.sample.free : "Paid preview") : copy.sample.free,
        minimum: meta.minLength || copy.sample.minimum,
        reviewStatus,
      },
      scenes: scenes.slice(0, 8).map((scene, index) => ({
        id: scene.sceneId || scene.id || `S0${index + 1}`,
        title: scene.title || copy.sample.sceneTitle,
        status: safeStatus(scene.reviewStatus || scene.state || reviewStatus),
      })),
      firstScene: {
        sceneId: first.sceneId || first.id || "S04",
        title: first.title || copy.sample.sceneTitle,
        background: first.background || copy.sample.background,
        bgImageMemo: first.bgImageMemo || first.backgroundImageMemo || copy.sample.bgMemo,
        cast: Array.isArray(first.cast) && first.cast.length ? first.cast.join(", ") : copy.sample.cast,
        body: first.body || copy.sample.body,
        choices: Array.isArray(first.choices) && first.choices.length ? first.choices : DEFAULT_UPLOAD_STORY.scenes[0].choices,
        nextScene: first.nextScene || "S05",
        endingLink: first.isEnding ? "E-S1" : "E-S1",
      },
      endings: endings.slice(0, 10),
      importRows: scenes.slice(0, 3).map((scene, index) => ({
        scene: scene.sceneId || scene.id || `S0${index + 1}`,
        branch: scene.branchId || `B0${index + 1}`,
        ending: index === 0 ? "-" : index === 1 ? "E-A" : "E-AI",
        background: scene.background ? "OK" : "missing",
        cast: Array.isArray(scene.cast) && scene.cast.length ? "OK" : "missing",
        state: index === 0 ? "ok" : scene.background ? "pm" : "missing",
      })),
    };
  }

  function endingLabel(copy, type) {
    if (type === "author_main") return copy.ending.author_main;
    if (type === "ai") return copy.ending.ai;
    return copy.ending.author_sub;
  }

  function displayEndingLabel(copy, ending) {
    return ending.label || endingLabel(copy, ending.type);
  }

  function renderUploadWorkspace(storyOrLocale, maybeLocale) {
    if (typeof storyOrLocale === "string") {
      currentLocale = storyOrLocale;
    } else if (storyOrLocale && typeof storyOrLocale === "object") {
      currentStory = storyOrLocale;
      currentLocale = maybeLocale || currentLocale;
    } else if (maybeLocale) {
      currentLocale = maybeLocale;
    }

    const copy = TEXT[currentLocale] || TEXT.ko;
    const view = normalizeStory(currentStory, copy);
    document.documentElement.lang = LOCALE_TO_REGION[currentLocale] || "ko-KR";

    root.innerHTML = `
      <div class="su-shell">
        <header class="su-header">
          <div class="su-title-group">
            <p class="su-eyebrow">${escapeHtml(copy.eyebrow)}</p>
            <h1 class="su-title">${escapeHtml(copy.title)}</h1>
          </div>
          <div class="su-locale" aria-label="Story upload locale">
            ${LOCALES.map((item) => `<button type="button" data-su-locale="${item.code}" aria-pressed="${item.code === currentLocale ? "true" : "false"}">${item.label}</button>`).join("")}
          </div>
        </header>

        <section class="su-grid" aria-label="Story upload overview">
          <div class="su-section">
            <h2>${escapeHtml(copy.meta)}</h2>
            <ul class="su-meta-list">
              ${field(copy.labels.storyTitle, view.meta.title)}
              ${field(copy.labels.genre, view.meta.genre)}
              ${field(copy.labels.free, view.meta.free)}
              ${field(copy.labels.minimum, view.meta.minimum)}
            </ul>
          </div>
          <div class="su-panel su-review-status" data-status-label="${escapeHtml(copy.status[view.meta.reviewStatus])}">
            <h2>${escapeHtml(copy.statusTitle)}</h2>
            <span class="su-status-pill">${escapeHtml(copy.status[view.meta.reviewStatus])}</span>
            <p class="su-status-hint">${escapeHtml(copy.statusHint[view.meta.reviewStatus])}</p>
            <div class="su-status-handoff">${copy.handoff.map((item) => `<span class="su-chip">${escapeHtml(item)}</span>`).join("")}</div>
          </div>
        </section>

        <section class="su-grid">
          <div class="su-section">
            <h2>${escapeHtml(copy.scenes)}</h2>
            <ul class="su-scene-list">
              ${view.scenes.map((scene) => `<li class="su-scene-item"><span>${escapeHtml(scene.id)}</span><strong>${escapeHtml(scene.title)} · ${escapeHtml(copy.status[scene.status])}</strong></li>`).join("")}
            </ul>
          </div>
          <div class="su-section">
            <h2>${escapeHtml(copy.endings)}</h2>
            <div class="su-ending-summary">
              ${view.endings.map((ending) => {
                const type = ending.type || "author_sub";
                return `<span class="su-ending-badge">${type === "ai" ? "AI · " : ""}${escapeHtml(displayEndingLabel(copy, ending))}</span>`;
              }).join("")}
            </div>
            <details class="su-ending-list">
              <summary>${escapeHtml(copy.ending.subCount)} <b>${view.endings.length}</b></summary>
              <ul>
                ${view.endings.map((ending, index) => `<li>E-${index + 1} · ${escapeHtml(displayEndingLabel(copy, ending))}</li>`).join("")}
              </ul>
            </details>
          </div>
        </section>

        <section class="su-section">
          <h2>${escapeHtml(copy.form)}</h2>
          <form class="su-scene-form" aria-label="Scene upload preview form">
            <div class="su-row">
              <label class="su-field"><span>${escapeHtml(copy.labels.sceneId)}</span><input name="sceneId" value="${escapeHtml(view.firstScene.sceneId)}" readonly /></label>
              <label class="su-field"><span>${escapeHtml(copy.labels.sceneTitle)}</span><input name="sceneTitle" value="${escapeHtml(view.firstScene.title)}" readonly /></label>
            </div>
            <details open>
              <summary>${escapeHtml(copy.labels.background)}</summary>
              <div>
                <textarea name="background" rows="2" readonly>${escapeHtml(view.firstScene.background)}</textarea>
                <input name="bgImageMemo" value="${escapeHtml(view.firstScene.bgImageMemo)}" readonly />
              </div>
            </details>
            <details>
              <summary>${escapeHtml(copy.labels.cast)}</summary>
              <div><input value="${escapeHtml(view.firstScene.cast)}" readonly /></div>
            </details>
            <label class="su-field"><span>${escapeHtml(copy.labels.body)}</span><textarea name="body" rows="8" class="su-body" readonly>${escapeHtml(view.firstScene.body)}</textarea></label>
            <div class="su-choices" aria-label="${escapeHtml(copy.labels.choices)}">
              ${view.firstScene.choices.map((choice, index) => `<div class="su-choice-row"><input value="${escapeHtml(choice.label || String.fromCharCode(65 + index))}" readonly /><input value="${escapeHtml(choice.text || (index === 0 ? copy.sample.choiceA : copy.sample.choiceB))}" readonly /><input value="${escapeHtml(choice.nextScene || view.firstScene.nextScene)}" readonly /></div>`).join("")}
              <button class="su-action" type="button" disabled aria-disabled="true">${escapeHtml(copy.labels.addChoice)}</button>
            </div>
            <div class="su-row">
              <label class="su-field"><span>${escapeHtml(copy.labels.nextScene)}</span><input name="nextScene" value="${escapeHtml(view.firstScene.nextScene)}" readonly /></label>
              <label class="su-field"><span>${escapeHtml(copy.labels.endingLink)}</span><input value="${escapeHtml(view.firstScene.endingLink)}" readonly /></label>
            </div>
            <button type="button" class="su-save" disabled aria-disabled="true">${escapeHtml(copy.labels.saveSoon)}</button>
          </form>
        </section>

        <section class="su-section">
          <h2>${escapeHtml(copy.import)}</h2>
          <div class="su-import-wrap">
            <table class="su-import-preview">
              <thead><tr>${copy.importHead.map((head) => `<th>${escapeHtml(head)}</th>`).join("")}</tr></thead>
              <tbody>
                ${view.importRows.map((row) => `
                  <tr>
                    <td>${escapeHtml(row.scene)}</td>
                    <td>${escapeHtml(row.branch)}</td>
                    <td>${escapeHtml(row.ending)}</td>
                    <td>${row.background === "missing" ? `<span class="su-miss">${escapeHtml(copy.importState.missing)}</span>` : escapeHtml(row.background)}</td>
                    <td>${row.cast === "missing" ? `<span class="su-miss">${escapeHtml(copy.importState.missing)}</span>` : escapeHtml(row.cast)}</td>
                    <td>${escapeHtml(copy.importState[row.state] || copy.importState.ok)}</td>
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

  window.LuminaStoryUploadFixture = window.LuminaStoryUploadFixture || DEFAULT_UPLOAD_STORY;
  window.renderUploadWorkspace = renderUploadWorkspace;
  renderUploadWorkspace(window.LuminaStoryUploadFixture, "ko");
})();
