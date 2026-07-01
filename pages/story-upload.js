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

  const UI = {
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
      ending: {
        authorMain: "작가 기본",
        authorSub: "작가 서브",
        ai: "AI 엔딩",
        subCount: "서브 엔딩",
      },
      importHead: ["장면", "분기", "엔딩", "배경", "등장", "상태"],
      importState: {
        ok: "확인됨",
        missing: "누락",
        copyright: "저작권 확인",
        pm: "PM 확인",
      },
      importFlags: [
        "배경/등장 누락 항목이 있어요.",
        "저작권 확인이 필요해요.",
        "PM 확인이 필요해요.",
      ],
      importSave: "가져오기 (준비 중)",
      sample: {
        storyTitle: "임진왜란: 난중일기 프롤로그",
        genre: "역사 튜토리얼",
        free: "무료 프롤로그",
        minimum: "장면 3개 이상",
        background: "전장 기록 사이로 낮은 북소리가 들려요.",
        bgMemo: "촛불, 종이 지도, 낮은 연기",
        body: "긴 본문 원고를 먼저 붙여 넣고, 분기점과 이어질 장면을 아래 선택지로 정리해요.",
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
      ending: {
        authorMain: "Main",
        authorSub: "Sub",
        ai: "AI ending",
        subCount: "Sub endings",
      },
      importHead: ["Scene", "Branch", "Ending", "Background", "Cast", "State"],
      importState: {
        ok: "Checked",
        missing: "Missing",
        copyright: "Copyright",
        pm: "PM check",
      },
      importFlags: [
        "Some background or cast fields are missing.",
        "Copyright review is required.",
        "PM confirmation is required.",
      ],
      importSave: "Import (soon)",
      sample: {
        storyTitle: "Imjin War: Nanjung Diary Prologue",
        genre: "History tutorial",
        free: "Free prologue",
        minimum: "At least 3 scenes",
        background: "A low drumbeat moves through wartime records.",
        bgMemo: "Candlelight, paper map, low smoke",
        body: "Paste the long manuscript first, then organize branch points and next scenes as choices.",
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
      ending: {
        authorMain: "作家基本",
        authorSub: "作家サブ",
        ai: "AI終了",
        subCount: "サブ終了",
      },
      importHead: ["シーン", "分岐", "終了", "背景", "登場", "状態"],
      importState: {
        ok: "確認済み",
        missing: "不足",
        copyright: "権利確認",
        pm: "PM確認",
      },
      importFlags: [
        "背景または登場人物に不足があります。",
        "著作権確認が必要です。",
        "PM確認が必要です。",
      ],
      importSave: "取り込み（準備中）",
      sample: {
        storyTitle: "壬辰倭乱：乱中日記プロローグ",
        genre: "歴史チュートリアル",
        free: "無料プロローグ",
        minimum: "3シーン以上",
        background: "戦記の間に低い太鼓の音が響きます。",
        bgMemo: "ろうそく、紙の地図、薄い煙",
        body: "長い本文原稿を先に入れ、分岐点と次のシーンを選択肢で整理します。",
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
      ending: {
        authorMain: "作者主线",
        authorSub: "作者支线",
        ai: "AI结局",
        subCount: "支线结局",
      },
      importHead: ["场景", "分支", "结局", "背景", "登场", "状态"],
      importState: {
        ok: "已确认",
        missing: "缺失",
        copyright: "版权确认",
        pm: "PM确认",
      },
      importFlags: [
        "存在背景或登场角色缺失项。",
        "需要进行版权确认。",
        "需要PM确认。",
      ],
      importSave: "导入（准备中）",
      sample: {
        storyTitle: "壬辰倭乱：乱中日记序章",
        genre: "历史教程",
        free: "免费序章",
        minimum: "至少3个场景",
        background: "战时记录之间传来低沉鼓声。",
        bgMemo: "烛光、纸地图、低烟",
        body: "先粘贴长篇正文稿，再用选项整理分支点和后续场景。",
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
      ending: {
        authorMain: "作者主線",
        authorSub: "作者支線",
        ai: "AI結局",
        subCount: "支線結局",
      },
      importHead: ["場景", "分支", "結局", "背景", "登場", "狀態"],
      importState: {
        ok: "已確認",
        missing: "缺失",
        copyright: "版權確認",
        pm: "PM確認",
      },
      importFlags: [
        "存在背景或登場角色缺失項。",
        "需要進行版權確認。",
        "需要PM確認。",
      ],
      importSave: "匯入（準備中）",
      sample: {
        storyTitle: "壬辰倭亂：亂中日記序章",
        genre: "歷史教程",
        free: "免費序章",
        minimum: "至少3個場景",
        background: "戰時記錄之間傳來低沉鼓聲。",
        bgMemo: "燭光、紙地圖、低煙",
        body: "先貼上長篇正文稿，再用選項整理分支點與後續場景。",
      },
    },
  };

  const sampleScenes = [
    { id: "S01", title: "기록의 방", state: "pm_review" },
    { id: "S02", title: "첫 분기", state: "locale_ready" },
    { id: "S03", title: "공통 장면", state: "qa_ready" },
  ];

  const importRows = [
    { scene: "S01", branch: "B01", ending: "-", background: "OK", cast: "OK", state: "ok" },
    { scene: "S02", branch: "B02", ending: "E-A", background: "missing", cast: "OK", state: "missing" },
    { scene: "S03", branch: "B03", ending: "E-AI", background: "OK", cast: "missing", state: "pm" },
  ];

  const localeMap = {
    ko: "ko-KR",
    en: "en-US",
    ja: "ja-JP",
    "zh-Hans": "zh-CN",
    "zh-Hant": "zh-Hant",
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

  function renderUploadWorkspace(localeCode) {
    const locale = UI[localeCode] || UI.ko;
    document.documentElement.lang = localeMap[localeCode] || "ko-KR";

    root.innerHTML = `
      <div class="su-shell">
        <header class="su-header">
          <div class="su-title-group">
            <p class="su-eyebrow">${escapeHtml(locale.eyebrow)}</p>
            <h1 class="su-title">${escapeHtml(locale.title)}</h1>
          </div>
          <div class="su-locale" aria-label="Story upload locale">
            ${LOCALES.map((item) => `<button type="button" data-su-locale="${item.code}" aria-pressed="${item.code === localeCode ? "true" : "false"}">${item.label}</button>`).join("")}
          </div>
        </header>

        <section class="su-grid" aria-label="Story upload overview">
          <div class="su-section">
            <h2>${escapeHtml(locale.meta)}</h2>
            <ul class="su-meta-list">
              ${field(locale.labels.storyTitle, locale.sample.storyTitle)}
              ${field(locale.labels.genre, locale.sample.genre)}
              ${field(locale.labels.free, locale.sample.free)}
              ${field(locale.labels.minimum, locale.sample.minimum)}
            </ul>
          </div>
          <div class="su-panel su-review-status" data-status="locale_ready">
            <h2>${escapeHtml(locale.statusTitle)}</h2>
            <span class="su-status-pill">${escapeHtml(locale.status.locale_ready)}</span>
            <p class="su-status-hint">${escapeHtml(locale.statusHint.locale_ready)}</p>
            <div class="su-status-handoff">${locale.handoff.map((item) => `<span class="su-chip">${escapeHtml(item)}</span>`).join("")}</div>
          </div>
        </section>

        <section class="su-grid">
          <div class="su-section">
            <h2>${escapeHtml(locale.scenes)}</h2>
            <ul class="su-scene-list">
              ${sampleScenes.map((scene) => `<li class="su-scene-item"><span>${escapeHtml(scene.id)}</span><strong>${escapeHtml(scene.title)} · ${escapeHtml(locale.status[scene.state])}</strong></li>`).join("")}
            </ul>
          </div>
          <div class="su-section">
            <h2>${escapeHtml(locale.endings)}</h2>
            <div class="su-ending-summary">
              <span class="su-ending-badge" data-ending="author_main">${escapeHtml(locale.ending.authorMain)}</span>
              <span class="su-ending-badge" data-ending="author_sub">${escapeHtml(locale.ending.authorSub)}</span>
              <span class="su-ending-badge" data-ending="ai">AI · ${escapeHtml(locale.ending.ai)}</span>
            </div>
            <details class="su-ending-list">
              <summary>${escapeHtml(locale.ending.subCount)} <b>7</b></summary>
              <ul>
                <li>E-S1 · ${escapeHtml(locale.ending.authorSub)}</li>
                <li>E-S2 · ${escapeHtml(locale.ending.authorSub)}</li>
                <li>E-AI · ${escapeHtml(locale.ending.ai)}</li>
              </ul>
            </details>
          </div>
        </section>

        <section class="su-section">
          <h2>${escapeHtml(locale.form)}</h2>
          <form class="su-scene-form" aria-label="Scene upload preview form">
            <div class="su-row">
              <label class="su-field"><span>${escapeHtml(locale.labels.sceneId)}</span><input name="sceneId" value="S04" readonly /></label>
              <label class="su-field"><span>${escapeHtml(locale.labels.sceneTitle)}</span><input name="sceneTitle" value="새 분기 장면" readonly /></label>
            </div>
            <details open>
              <summary>${escapeHtml(locale.labels.background)}</summary>
              <div>
                <textarea name="background" rows="2" readonly>${escapeHtml(locale.sample.background)}</textarea>
                <input name="bgImageMemo" value="${escapeHtml(locale.sample.bgMemo)}" readonly />
              </div>
            </details>
            <details>
              <summary>${escapeHtml(locale.labels.cast)}</summary>
              <div><input value="이순신, 기록관, 전령" readonly /></div>
            </details>
            <label class="su-field"><span>${escapeHtml(locale.labels.body)}</span><textarea name="body" rows="8" class="su-body" readonly>${escapeHtml(locale.sample.body)}</textarea></label>
            <div class="su-choices" aria-label="${escapeHtml(locale.labels.choices)}">
              <div class="su-choice-row"><input value="A" readonly /><input value="기록을 먼저 확인한다" readonly /><input value="S05" readonly /></div>
              <div class="su-choice-row"><input value="B" readonly /><input value="전령을 따라간다" readonly /><input value="S06" readonly /></div>
              <button class="su-action" type="button" disabled aria-disabled="true">${escapeHtml(locale.labels.addChoice)}</button>
            </div>
            <div class="su-row">
              <label class="su-field"><span>${escapeHtml(locale.labels.nextScene)}</span><input name="nextScene" value="S05" readonly /></label>
              <label class="su-field"><span>${escapeHtml(locale.labels.endingLink)}</span><input value="E-S1" readonly /></label>
            </div>
            <button type="button" class="su-save" disabled aria-disabled="true">${escapeHtml(locale.labels.saveSoon)}</button>
          </form>
        </section>

        <section class="su-section">
          <h2>${escapeHtml(locale.import)}</h2>
          <div class="su-import-wrap">
            <table class="su-import-preview">
              <thead><tr>${locale.importHead.map((head) => `<th>${escapeHtml(head)}</th>`).join("")}</tr></thead>
              <tbody>
                ${importRows.map((row) => `
                  <tr>
                    <td>${escapeHtml(row.scene)}</td>
                    <td>${escapeHtml(row.branch)}</td>
                    <td>${escapeHtml(row.ending)}</td>
                    <td>${row.background === "missing" ? `<span class="su-miss">${escapeHtml(locale.importState.missing)}</span>` : escapeHtml(row.background)}</td>
                    <td>${row.cast === "missing" ? `<span class="su-miss">${escapeHtml(locale.importState.missing)}</span>` : escapeHtml(row.cast)}</td>
                    <td>${escapeHtml(locale.importState[row.state])}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <ul class="su-import-flags">
            ${locale.importFlags.map((flag) => `<li>${escapeHtml(flag)}</li>`).join("")}
          </ul>
          <button type="button" class="su-import-save" disabled aria-disabled="true">${escapeHtml(locale.importSave)}</button>
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
