(function initStoryStagePage() {
  "use strict";

  const root = document.getElementById("storyStageRoot");
  if (!root) return;

  const API_ORIGIN = "https://api.lumina-stage.com";
  const COPY = {
    ko: {
      title: "스토리",
      description: "작품을 선택해 이야기를 시작하세요.",
      loading: "스토리를 불러오는 중입니다.",
      emptyTitle: "등록된 스토리가 없습니다",
      emptyBody: "공개된 작품은 이곳에 표시됩니다.",
      retry: "다시 불러오기",
      loadErrorTitle: "스토리를 불러오지 못했습니다",
      loadErrorBody: "잠시 후 다시 시도해 주세요.",
      completed: "완결",
      published: "공개 중",
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
      graphTitle: "Branch preview",
      graphDescription: "Current scene and direct next routes",
      graphFocus: "Current scene",
      graphChoices: "Choices",
      graphNext: "Next scene",
      graphEnding: "Ending",
      graphWarning: "This branch needs review before publication.",
      graphEmpty: "No direct branches are available for this scene.",
      graphFailed: "The branch preview could not be loaded.",
    },
    en: {
      title: "Stories",
      description: "Choose a story and begin reading.",
      loading: "Loading stories.",
      emptyTitle: "No stories are published yet",
      emptyBody: "Published stories appear here.",
      retry: "Try again",
      loadErrorTitle: "Stories could not be loaded",
      loadErrorBody: "Please try again shortly.",
      completed: "Completed",
      published: "Published",
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
      graphTitle: "Branch preview",
      graphDescription: "Current scene and direct next routes",
      graphFocus: "Current scene",
      graphChoices: "Choices",
      graphNext: "Next scene",
      graphEnding: "Ending",
      graphWarning: "This branch needs review before publication.",
      graphEmpty: "No direct branches are available for this scene.",
      graphFailed: "The branch preview could not be loaded.",
    },
    ja: {
      title: "ストーリー",
      description: "作品を選んで物語を始めましょう。",
      loading: "ストーリーを読み込んでいます。",
      emptyTitle: "公開中のストーリーはありません",
      emptyBody: "公開された作品がここに表示されます。",
      retry: "再読み込み",
      loadErrorTitle: "ストーリーを読み込めませんでした",
      loadErrorBody: "しばらくしてからもう一度お試しください。",
      completed: "完結",
      published: "公開中",
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
      graphTitle: "Branch preview",
      graphDescription: "Current scene and direct next routes",
      graphFocus: "Current scene",
      graphChoices: "Choices",
      graphNext: "Next scene",
      graphEnding: "Ending",
      graphWarning: "This branch needs review before publication.",
      graphEmpty: "No direct branches are available for this scene.",
      graphFailed: "The branch preview could not be loaded.",
    },
    "zh-Hans": {
      title: "故事",
      description: "选择作品，开始阅读。",
      loading: "正在加载故事。",
      emptyTitle: "暂无已发布的故事",
      emptyBody: "已发布的作品会显示在这里。",
      retry: "重新加载",
      loadErrorTitle: "无法加载故事",
      loadErrorBody: "请稍后重试。",
      completed: "已完结",
      published: "已发布",
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
      graphTitle: "Branch preview",
      graphDescription: "Current scene and direct next routes",
      graphFocus: "Current scene",
      graphChoices: "Choices",
      graphNext: "Next scene",
      graphEnding: "Ending",
      graphWarning: "This branch needs review before publication.",
      graphEmpty: "No direct branches are available for this scene.",
      graphFailed: "The branch preview could not be loaded.",
    },
    "zh-Hant": {
      title: "故事",
      description: "選擇作品，開始閱讀。",
      loading: "正在載入故事。",
      emptyTitle: "暫無已發布的故事",
      emptyBody: "已發布的作品會顯示在這裡。",
      retry: "重新載入",
      loadErrorTitle: "無法載入故事",
      loadErrorBody: "請稍後重試。",
      completed: "已完結",
      published: "已發佈",
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
      graphTitle: "Branch preview",
      graphDescription: "Current scene and direct next routes",
      graphFocus: "Current scene",
      graphChoices: "Choices",
      graphNext: "Next scene",
      graphEnding: "Ending",
      graphWarning: "This branch needs review before publication.",
      graphEmpty: "No direct branches are available for this scene.",
      graphFailed: "The branch preview could not be loaded.",
    },
  };

  const STORY_CONTROL_COPY = {
    ko: {
      other: "기타",
      customPrompt: "다음 행동을 직접 작성하세요",
      customPlaceholder: "다음 행동을 입력해 주세요",
      submitCustom: "선택 확정",
      customEmpty: "다음 행동을 입력해 주세요.",
      customUnavailable: "이 선택은 지금 이용할 수 없습니다.",
      resumeFrom: "마지막 기록부터 이어보기",
      resetProgress: "진행 초기화",
      resetAll: "전체 초기화",
      resetAct: "막 초기화",
      remaining: "남은 횟수",
      resetConfirm: "초기화 확인",
      resetCancel: "취소",
      resetApply: "초기화하기",
      resetComplete: "새 시작 위치로 이동했습니다.",
      sceneUnavailable: "지금은 이 장면을 이어갈 수 없습니다. 나중에 다시 방문해 주세요.",
      accessRequired: "이 작품의 이용 권한을 확인해 주세요.",
      progressChanged: "진행 기록이 변경되었습니다. 현재 장면을 확인해 주세요.",
      resetFailed: "초기화를 확인하지 못했습니다. 진행 기록을 다시 불러와 주세요.",
      resetSummary: "선택 기록 {count}개가 초기화됩니다. 발견한 엔딩은 유지됩니다.",
      resetDestination: "{act}막 시작",
      remainingAfter: "초기화 후 남은 횟수",
    },
    en: {
      other: "Other",
      customPrompt: "Write your next action",
      customPlaceholder: "Describe what you want to do next",
      submitCustom: "Confirm choice",
      customEmpty: "Enter your next action.",
      customUnavailable: "This choice is unavailable right now.",
      resumeFrom: "Continue from your last checkpoint",
      resetProgress: "Reset progress",
      resetAll: "Reset all",
      resetAct: "Reset act",
      remaining: "Remaining",
      resetConfirm: "Confirm reset",
      resetCancel: "Cancel",
      resetApply: "Reset progress",
      resetComplete: "You are back at the new starting point.",
      sceneUnavailable: "This scene is unavailable right now. Please come back later.",
      accessRequired: "Please check your access to this story.",
      progressChanged: "Your progress has changed. Please check the current scene.",
      resetFailed: "The reset could not be confirmed. Please reload your progress.",
      resetSummary: "{count} choice records will be cleared. Your discovered endings will be kept.",
      resetDestination: "Start of act {act}",
      remainingAfter: "Resets remaining afterward",
    },
    ja: {
      other: "その他",
      customPrompt: "次の行動を入力してください",
      customPlaceholder: "次にしたい行動を入力",
      submitCustom: "選択を確定",
      customEmpty: "次の行動を入力してください。",
      customUnavailable: "現在この選択は利用できません。",
      resumeFrom: "最後の記録から続ける",
      resetProgress: "進行をリセット",
      resetAll: "全体をリセット",
      resetAct: "幕をリセット",
      remaining: "残り回数",
      resetConfirm: "リセットの確認",
      resetCancel: "キャンセル",
      resetApply: "リセットする",
      resetComplete: "新しい開始位置に移動しました。",
      sceneUnavailable: "現在このシーンを続けることはできません。時間をおいてお戻りください。",
      accessRequired: "この作品の利用権をご確認ください。",
      progressChanged: "進行記録が変更されました。現在のシーンをご確認ください。",
      resetFailed: "リセットを確認できませんでした。進行記録を再読み込みしてください。",
      resetSummary: "選択記録が{count}件リセットされます。発見したエンディングは保持されます。",
      resetDestination: "第{act}幕の開始地点",
      remainingAfter: "リセット後の残り回数",
    },
    "zh-Hans": {
      other: "其他",
      customPrompt: "输入下一步行动",
      customPlaceholder: "请输入下一步想做的事",
      submitCustom: "确认选择",
      customEmpty: "请输入下一步行动。",
      customUnavailable: "暂时无法使用此选择。",
      resumeFrom: "从上次记录继续",
      resetProgress: "重置进度",
      resetAll: "全部重置",
      resetAct: "重置本幕",
      remaining: "剩余次数",
      resetConfirm: "确认重置",
      resetCancel: "取消",
      resetApply: "重置进度",
      resetComplete: "已回到新的开始位置。",
      sceneUnavailable: "暂时无法继续此场景，请过一段时间再来。",
      accessRequired: "请确认你对此作品的访问权限。",
      progressChanged: "阅读进度已更改，请确认当前场景。",
      resetFailed: "无法确认重置结果，请重新加载进度。",
      resetSummary: "将重置{count}条选择记录。已发现的结局会保留。",
      resetDestination: "第{act}幕起点",
      remainingAfter: "重置后的剩余次数",
    },
    "zh-Hant": {
      other: "其他",
      customPrompt: "輸入下一步行動",
      customPlaceholder: "請輸入下一步想做的事",
      submitCustom: "確認選擇",
      customEmpty: "請輸入下一步行動。",
      customUnavailable: "暫時無法使用此選擇。",
      resumeFrom: "從上次記錄繼續",
      resetProgress: "重設進度",
      resetAll: "全部重設",
      resetAct: "重設本幕",
      remaining: "剩餘次數",
      resetConfirm: "確認重設",
      resetCancel: "取消",
      resetApply: "重設進度",
      resetComplete: "已回到新的開始位置。",
      sceneUnavailable: "暫時無法繼續此場景，請過一段時間再來。",
      accessRequired: "請確認你對此作品的存取權限。",
      progressChanged: "閱讀進度已變更，請確認目前場景。",
      resetFailed: "無法確認重設結果，請重新載入進度。",
      resetSummary: "將重設{count}筆選擇記錄。已發現的結局會保留。",
      resetDestination: "第{act}幕起點",
      remainingAfter: "重設後的剩餘次數",
    },
  };

  const ACCESS_COPY = {
    ko: { filterLabel: "가격", all: "전체", loadMore: "더 보기", purchase: "구매", purchaseUnavailable: "현재 이 작품을 구매할 수 없습니다.", detailUnavailable: "작품 정보를 확인할 수 없습니다.", accessFailed: "이용 권한을 확인하지 못했습니다. 다시 시도해 주세요." },
    en: { filterLabel: "Price", all: "All", loadMore: "Load more", purchase: "Purchase", purchaseUnavailable: "This story is not available to purchase right now.", detailUnavailable: "Story details are unavailable.", accessFailed: "Your access could not be checked. Please try again." },
    ja: { filterLabel: "価格", all: "すべて", loadMore: "もっと見る", purchase: "購入", purchaseUnavailable: "現在この作品は購入できません。", detailUnavailable: "作品情報を確認できません。", accessFailed: "利用権限を確認できませんでした。もう一度お試しください。" },
    "zh-Hans": { filterLabel: "价格", all: "全部", loadMore: "加载更多", purchase: "购买", purchaseUnavailable: "目前无法购买此作品。", detailUnavailable: "无法查看作品信息。", accessFailed: "无法确认你的访问权限，请重试。" },
    "zh-Hant": { filterLabel: "價格", all: "全部", loadMore: "載入更多", purchase: "購買", purchaseUnavailable: "目前無法購買此作品。", detailUnavailable: "無法查看作品資訊。", accessFailed: "無法確認你的存取權限，請重試。" },
  };

  const state = {
    locale: resolveLocale(),
    packs: [],
    pack: null,
    sessionId: new URLSearchParams(location.search).get("sessionId") || "",
    graphWorkId: safeGraphId(new URLSearchParams(location.search).get("workId")),
    graphFocusSceneId: safeGraphId(new URLSearchParams(location.search).get("focusSceneId")),
    graph: null,
    scene: null,
    choices: [],
    busy: false,
    progress: null,
    customChoiceOpen: false,
    resetPreview: null,
    workId: safeGraphId(new URLSearchParams(location.search).get("workId")),
    controls: null,
    epoch: 0,
    minimumRevision: 0,
    localeDirty: false,
    operation: 0,
    catalogEpoch: 0,
    catalogStatus: "loading",
    catalogLocale: "",
    filter: "all",
    nextCursor: null,
    pageLoading: false,
    pageError: false,
    detailSlug: "",
    detailStatus: "",
    detailError: "",
    readerAccess: null,
    readerState: null,
    detailPending: false,
    dialog: null,
    returnFocus: null,
    returnScroll: 0,
  };

  // First release is suggested-only, including legacy paid custom=true metadata.
  const FIRST_RELEASE = true;

  function resolveLocale() {
    const value = window.luminaI18n?.getLocale?.() || "ko";
    if (value === "zh-CN") return "zh-Hans";
    if (value === "zh-TW" || value === "zh-HK") return "zh-Hant";
    return COPY[value] ? value : "ko";
  }

  function tr(key) {
    return COPY[state.locale]?.[key] || COPY.ko[key] || "";
  }

  function controlTr(key) {
    return STORY_CONTROL_COPY[state.locale]?.[key] || STORY_CONTROL_COPY.ko[key] || "";
  }

  function accessTr(key) {
    return ACCESS_COPY[state.locale]?.[key] || ACCESS_COPY.ko[key] || "";
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
    if (typeof value.value === "string") return textValue(value.value);
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
      error.body = await response.json().catch(() => ({}));
      throw error;
    }
    return response.status === 204 ? null : response.json();
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
    const value = pack?.cover?.publicAssetPath || pack?.cover?.publicUrl || pack?.cover?.url;
    if (typeof value !== "string" || /[\\\s]/.test(value)) return "";
    try {
      const url = new URL(value, location.origin);
      return url.protocol === "https:" || (value.startsWith("/") && !value.startsWith("//")) ? url.href : "";
    } catch (_) { return ""; }
  }

  function packTitle(pack) {
    return textValue(pack?.title);
  }

  function packSummary(pack) {
    return textValue(pack?.summary);
  }

  function packSlug(pack) {
    return typeof pack?.slug === "string" ? pack.slug : "";
  }

  function safeSessionId(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 160 ? value : "";
  }

  function safeGraphId(value) {
    const normalized = typeof value === "string" ? value.trim() : "";
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized) ? normalized : "";
  }

  function relativeStoryPath(value) {
    return typeof value === "string" && /^\/api\/v1\/me\/story-progress\//.test(value) ? value : "";
  }

  function customChoiceCapability(scene) {
    if (FIRST_RELEASE) return null;
    const capability = scene?.customChoiceCapability;
    const submitPath = relativeStoryPath(capability?.submitPath);
    const maxChars = Number(capability?.maxChars);
    return capability?.enabled === true && capability?.entitled === true && submitPath && Number.isInteger(maxChars) && maxChars > 0
      ? { submitPath, maxChars }
      : null;
  }

  function resetCapability(progress) {
    if (!state.sessionId || !Number.isInteger(progress?.revision)) return null;
    return state.controls;
  }

  function renderResetControls(progress) {
    const reset = resetCapability(progress);
    if (!reset) return "";
    const fullRemaining = Number.isInteger(reset.fullRemaining) ? reset.fullRemaining : "-";
    const actRemaining = Number.isInteger(reset.actRemaining) ? reset.actRemaining : "-";
    return `
      <section class="story-progress-controls" aria-label="${escapeHtml(controlTr("resetProgress"))}">
        <h3>${escapeHtml(controlTr("resetProgress"))}</h3>
        <div>
          <button type="button" class="story-button story-button-secondary" data-story-reset-preview="full" ${reset.canFullReset && fullRemaining > 0 ? "" : "disabled"}>${escapeHtml(controlTr("resetAll"))} · ${escapeHtml(controlTr("remaining"))} ${fullRemaining}</button>
          <button type="button" class="story-button story-button-secondary" data-story-reset-preview="act" ${reset.canActReset && actRemaining > 0 ? "" : "disabled"}>${escapeHtml(controlTr("resetAct"))} · ${escapeHtml(controlTr("remaining"))} ${actRemaining}</button>
        </div>
      </section>`;
  }

  function renderResetDialog() {
    const preview = state.resetPreview;
    if (!preview) return "";
    const summary = controlTr("resetSummary").replace("{count}", preview.invalidatedEventCount);
    const remaining = preview.remainingAfter;
    return `
      <div class="story-reset-dialog" role="dialog" aria-modal="true" aria-labelledby="storyResetTitle">
        <div class="story-reset-dialog-panel" tabindex="-1">
          <h2 id="storyResetTitle">${escapeHtml(controlTr("resetConfirm"))}</h2>
          <p>${escapeHtml(controlTr(preview.target === "full" ? "resetAll" : "resetAct"))} · ${escapeHtml(controlTr("resetDestination").replace("{act}", preview.targetAct))}</p>
          ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
          <p>${escapeHtml(controlTr("remainingAfter"))}: ${escapeHtml(String(remaining))}</p>
          <div>
            <button type="button" class="story-button story-button-secondary" data-story-reset-cancel>${escapeHtml(controlTr("resetCancel"))}</button>
            <button type="button" class="story-button story-button-primary" data-story-reset-confirm>${escapeHtml(controlTr("resetApply"))}</button>
          </div>
          <p class="story-action-status" data-story-dialog-status aria-live="polite"></p>
        </div>
      </div>`;
  }

  function renderCatalog() {
    updateHeading();
    let catalog = root.querySelector("[data-story-catalog-view]");
    if (!catalog) {
      catalog = document.createElement("div");
      catalog.dataset.storyCatalogView = "";
      root.prepend(catalog);
    }
    if (state.catalogStatus !== "ready") {
      catalog.innerHTML = `<section class="story-state" role="status"><h2>${escapeHtml(tr(state.catalogStatus === "loading" ? "loading" : "loadErrorTitle"))}</h2>${state.catalogStatus === "error" ? `<p>${escapeHtml(tr("loadErrorBody"))}</p><button class="story-button" data-story-retry>${escapeHtml(tr("retry"))}</button>` : ""}</section>`;
      return;
    }
    const visible = state.packs.filter((pack) => state.filter === "all" || (state.filter === "free" ? pack.access?.pricing?.free === true : pack.access?.pricing?.free === false));
    catalog.innerHTML = `
      <div class="story-catalog-tools"><label>${escapeHtml(accessTr("filterLabel"))}
        <select data-story-filter>${["all", "free", "paid"].map((value) => `<option value="${value}" ${value === state.filter ? "selected" : ""}>${escapeHtml(value === "all" ? accessTr("all") : tr(value))}</option>`).join("")}</select>
      </label><output>${visible.length} / ${state.packs.length}</output></div>
      <section class="story-catalog" aria-label="${escapeHtml(tr("title"))}">
        ${visible.map((pack) => {
          const title = packTitle(pack);
          const cover = coverUrl(pack);
          const slug = packSlug(pack);
          const pricing = priceText(pack.access);
          if (!title || !slug) return "";
          return `
            <article class="story-pack-card">
              <button type="button" class="story-pack-open" data-pack-slug="${escapeHtml(slug)}" aria-label="${escapeHtml(`${tr("open")}: ${title}`)}">
                <span class="story-pack-cover${cover ? " has-image" : ""}">${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" />` : ""}</span>
                <span class="story-pack-copy">
                  <span class="story-pack-status">${pricing ? `<em>${escapeHtml(pricing)}</em>` : ""}</span>
                  <strong>${escapeHtml(title)}</strong>
                  ${packSummary(pack) ? `<p>${escapeHtml(packSummary(pack))}</p>` : ""}
                </span>
              </button>
            </article>`;
        }).join("")}
      </section>
      ${!visible.length ? `<section class="story-state"><h2>${escapeHtml(state.packs.length ? "0" : tr("emptyTitle"))}</h2>${!state.packs.length ? `<p>${escapeHtml(tr("emptyBody"))}</p>` : ""}</section>` : ""}
      ${state.pageError ? `<p role="status">${escapeHtml(tr("loadErrorBody"))}</p>` : ""}
      ${state.nextCursor ? `<button class="story-button story-button-secondary story-load-more" data-story-more ${state.pageLoading ? "disabled" : ""}>${escapeHtml(state.pageLoading ? tr("loading") : state.pageError ? tr("retry") : accessTr("loadMore"))}</button>` : ""}`;
  }

  function priceText(access) {
    const pricing = access?.pricing;
    if (pricing?.currencyCode !== "LUMINA" || typeof pricing.amountLumina !== "string" || !/^\d+(\.\d+)?$/.test(pricing.amountLumina)) return "";
    if (pricing.free === true && Number(pricing.amountLumina) === 0) return tr("free");
    return pricing.free === false ? `${pricing.amountLumina} LUMINA` : "";
  }

  function releaseReady(capability) {
    return capability?.configStatus === "active" && capability.source === "active_release_capability" &&
      Number.isInteger(capability.revision) && capability.revision > 0 && capability.choicePolicy === "first_public_release" &&
      capability.fixedChoices === 3 && capability.customChoiceEnabled === false;
  }

  function signedIn() {
    return typeof window.isLoggedIn === "function" && window.isLoggedIn() === true;
  }

  function detailAction() {
    if (state.detailStatus !== "ready") return "unavailable";
    if (!signedIn()) return state.pack?.access?.actions?.authenticationRequired === true ? "sign_in" : "unavailable";
    const owner = state.readerAccess;
    const access = owner?.access;
    if (!access || access.actions?.authenticationRequired !== false || !priceText(access)) return "unavailable";
    if (access.actions.primary === "purchase" && access.actions.canPurchase === true && access.accessible === false && access.status === "purchase_required") return "purchase";
    if (!releaseReady(state.pack.releaseCapability) || !releaseReady(owner.aiCapability) ||
        state.pack.releaseCapability.revision !== owner.aiCapability.revision || access.accessible !== true ||
        !["free", "entitled"].includes(access.status) || access.actions.canPurchase !== false) return "unavailable";
    const progress = state.readerState;
    if (!state.pack.parts.length) return "unavailable";
    if (!progress || progress.storyAccess?.entitled !== true || !releaseReady(progress.releaseCapability) ||
        progress.releaseCapability.revision !== owner.aiCapability.revision) return "unavailable";
    if (access.actions.primary === "continue" && access.actions.canContinue === true && owner.replay?.continue === true &&
        progress.canResume === true && ["story.progress.status.ready", "story.progress.status.quotaExhausted"].includes(progress.statusKey)) return "continue";
    if (access.actions.primary === "start" && access.actions.canStart === true && owner.replay?.continue === false &&
        progress.statusKey === "story.progress.status.noProgress" && progress.canResume === false) return "start";
    return "unavailable";
  }

  function renderPack() {
    const dialog = state.dialog;
    if (!dialog || !state.detailSlug) return;
    const pack = state.pack;
    const title = packTitle(pack) || accessTr("detailUnavailable");
    const cover = coverUrl(pack);
    const action = detailAction();
    const active = document.activeElement;
    const focusAction = active?.dataset?.storyStart !== undefined;
    const scroll = dialog.querySelector(".story-detail-body")?.scrollTop || 0;
    dialog.innerHTML = `
      <header class="story-detail-header"><h2 id="storyDetailTitle">${escapeHtml(title)}</h2>
        <button type="button" class="story-detail-close" data-story-close aria-label="${escapeHtml(tr("close"))}" title="${escapeHtml(tr("close"))}">&times;</button></header>
      <div class="story-detail-body" tabindex="0">
        ${pack ? `<div class="story-detail-main">
          ${cover ? `<div class="story-detail-cover has-image"><img src="${escapeHtml(cover)}" alt="" /></div>` : ""}
          <div class="story-detail-copy">
            ${priceText(pack.access) ? `<p>${escapeHtml(priceText(pack.access))}</p>` : ""}
            ${packSummary(pack) ? `<h3>${escapeHtml(tr("synopsis"))}</h3><p class="story-synopsis">${escapeHtml(packSummary(pack))}</p>` : ""}
          </div></div>
          <section class="story-chapters"><h3>${escapeHtml(tr("chapterList"))} (${pack.parts.length})</h3>
            <ol>${pack.parts.map((part) => `<li><span>${escapeHtml(part.position)}</span><strong>${escapeHtml(textValue(part.title))}</strong><small>${escapeHtml(priceText(part.access))}</small></li>`).join("")}</ol>
          </section>` : ""}
      </div>
      <footer class="story-detail-actions" aria-busy="${state.detailPending}">
        <p data-story-detail-status role="status">${escapeHtml(state.detailStatus === "loading" || state.detailStatus === "access-loading" ? tr("loading") : state.detailStatus === "error" ? accessTr("detailUnavailable") : state.detailStatus === "access-error" ? state.detailError : action === "sign_in" ? tr("loginRequired") : action === "purchase" ? accessTr("purchaseUnavailable") : action === "unavailable" ? controlTr("sceneUnavailable") : "")}</p>
        <div>${action === "start" || action === "continue" ? `<button class="story-button story-button-primary" data-story-start ${state.detailPending ? "disabled" : ""}>${escapeHtml(state.detailPending ? tr("starting") : tr(action))}</button>` : action === "purchase" ? `<button class="story-button story-button-primary" disabled aria-describedby="storyPurchaseReason">${escapeHtml(accessTr("purchase"))}</button><span id="storyPurchaseReason" class="story-sr-only">${escapeHtml(accessTr("purchaseUnavailable"))}</span>` : ""}
        ${!["loading", "access-loading"].includes(state.detailStatus) ? `<button class="story-button story-button-secondary" data-story-detail-retry ${state.detailPending ? "disabled" : ""}>${escapeHtml(tr("retry"))}</button>` : ""}</div>
      </footer>`;
    dialog.querySelector(".story-detail-body").scrollTop = scroll;
    if (focusAction && !state.detailPending) dialog.querySelector("[data-story-start]")?.focus();
    else dialog.querySelector("[data-story-close]")?.focus({ preventScroll: true });
  }

  function openPack(slug, trigger, push = true) {
    if (state.dialog) return;
    state.returnFocus = trigger || document.getElementById("storyStageTitle");
    state.returnScroll = window.scrollY;
    if (push) {
      const url = new URL(location.href);
      url.searchParams.delete("pack");
      url.searchParams.set("slug", slug);
      history.pushState({ storyDetail: true }, "", url);
    }
    state.detailSlug = slug;
    const dialog = document.createElement("dialog");
    dialog.className = "story-detail-modal";
    dialog.setAttribute("aria-labelledby", "storyDetailTitle");
    dialog.setAttribute("aria-modal", "true");
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); closePack(); });
    state.dialog = dialog;
    root.append(dialog);
    document.body.classList.add("story-detail-open");
    dialog.showModal();
    return loadPack(slug);
  }

  function dismissPack() {
    ++state.epoch;
    state.dialog?.close();
    state.dialog?.remove();
    state.dialog = null;
    state.detailSlug = "";
    state.pack = null;
    state.readerAccess = null;
    state.readerState = null;
    document.body.classList.remove("story-detail-open");
    if (state.returnFocus?.isConnected) state.returnFocus.focus({ preventScroll: true });
    else document.getElementById("storyStageTitle")?.focus({ preventScroll: true });
    window.scrollTo({ left: 0, top: state.returnScroll, behavior: "instant" });
  }

  function closePack() {
    dismissPack();
    if (history.state?.storyDetail === true) history.back();
    else {
      const url = new URL(location.href);
      url.searchParams.delete("slug");
      url.searchParams.delete("pack");
      history.replaceState(null, "", url);
    }
  }

  function sceneBackground(scene) {
    return scene?.visualManifest?.background?.publicAssetPath || scene?.backgroundAsset?.publicUrl || scene?.backgroundAsset?.url || scene?.backgroundUrl || "";
  }

  function characterUrl(character) {
    return character?.publicAssetPath || character?.publicAssetUrl || character?.assetUrl || character?.imageUrl || "";
  }

  function sceneCharacters(scene) {
    const source = Array.isArray(scene?.characters)
      ? scene.characters
      : Array.isArray(scene?.visualManifest?.characters)
        ? scene.visualManifest.characters
        : [];
    return source.filter((character) => character?.placement !== "offscreen" && characterUrl(character));
  }

  function sceneCharacterSide(character, index) {
    const placement = character?.placement || character?.side;
    if (placement === "center") return "center";
    if (placement === "right") return "right";
    return index % 2 ? "right" : "left";
  }

  function sceneBeatText(scene, position) {
    const beats = Array.isArray(scene?.beats) ? scene.beats : [];
    const matchingBeat = beats.find((beat) => Number(beat?.position) === Number(position));
    const fallbackIndex = Math.max(0, Math.min(Number(position) || 0, beats.length - 1));
    const beat = matchingBeat || beats[fallbackIndex];
    return textValue(beat?.content) || textValue(beat?.text) || textValue(beat?.body) || textValue(scene?.sceneText) || textValue(scene?.body) || textValue(scene?.content);
  }

  function renderScene() {
    const scene = state.scene;
    if (!scene && state.progress?.status !== "completed") return renderState(tr("sceneFailed"), tr("loadErrorBody"), true);
    if (state.choices.length > 3) return blockScene(controlTr("sceneUnavailable"));
    const background = sceneBackground(scene);
    const characters = sceneCharacters(scene);
    const sceneText = sceneBeatText(scene, state.progress?.currentBeatPosition);
    const isEnding = state.progress?.status === "completed" || Boolean(scene?.ending || scene?.isEnding || scene?.endingType);
    const customChoice = customChoiceCapability(scene);
    const fixedChoices = state.choices;
    root.innerHTML = `
      <section class="story-player" data-has-background="${background ? "true" : "false"}">
        <a class="story-back" href="/story-stage">← ${escapeHtml(tr("backToStories"))}</a>
        <div class="story-player-stage">
          ${background ? `<img class="story-player-background" src="${escapeHtml(background)}" alt="" />` : `<div class="story-player-no-visual">${escapeHtml(tr("sceneNoVisual"))}</div>`}
          <div class="story-player-characters" aria-hidden="true">
            ${characters.map((character, index) => `<img src="${escapeHtml(characterUrl(character))}" alt="" data-side="${escapeHtml(sceneCharacterSide(character, index))}" />`).join("")}
          </div>
          <div class="story-player-copy" tabindex="-1" data-story-scene-focus>
            ${isEnding ? `<span class="story-ending-label">${escapeHtml(tr("ending"))}</span>` : ""}
            <p>${escapeHtml(sceneText)}</p>
          </div>
        </div>
        ${fixedChoices.length && !isEnding ? `
          <div class="story-choice-panel">
            <h2>${escapeHtml(tr("choices"))}</h2>
            <div class="story-choice-list">
              ${fixedChoices.map((choice, index) => {
                const label = textValue(choice.label) || textValue(choice.choiceBody) || textValue(choice.body) || String(index + 1);
                return `<button type="button" data-choice-id="${escapeHtml(choice.id || choice.choiceId || "")}" ${state.progress?.status === "active" && Number.isInteger(state.progress?.revision) ? "" : "disabled"} aria-label="${escapeHtml(label)}"><span aria-hidden="true">${index + 1}</span>${escapeHtml(label)}</button>`;
              }).join("")}
              ${customChoice ? `<button type="button" data-story-custom-choice>${escapeHtml(controlTr("other"))}</button>` : ""}
            </div>
            ${customChoice && state.customChoiceOpen ? `
              <form class="story-custom-choice" data-story-custom-form>
                <label for="storyCustomChoice">${escapeHtml(controlTr("customPrompt"))}</label>
                <textarea id="storyCustomChoice" name="customChoice" maxlength="${customChoice.maxChars}" placeholder="${escapeHtml(controlTr("customPlaceholder"))}" required></textarea>
                <div><span data-story-custom-count>0 / ${customChoice.maxChars}</span><button type="submit" class="story-button story-button-primary">${escapeHtml(controlTr("submitCustom"))}</button></div>
              </form>` : ""}
          </div>` : ""}
        <p class="story-action-status" data-story-action-status aria-live="polite">${state.progress?.status !== "active" && !isEnding ? escapeHtml(controlTr("sceneUnavailable")) : ""}</p>
        ${renderResetControls(state.progress)}
      </section>`;
    if (state.resetPreview) {
      root.querySelector(".story-player").inert = true;
      root.insertAdjacentHTML("beforeend", renderResetDialog());
      root.querySelector("[data-story-reset-cancel]")?.focus();
    }
  }

  function actionStatus(message) {
    const status = root.querySelector("[data-story-dialog-status]") || root.querySelector("[data-story-action-status]");
    if (status) status.textContent = message;
  }

  function setBusy(busy) {
    state.busy = busy;
    root.setAttribute("aria-busy", String(busy));
    root.querySelectorAll("button, textarea").forEach((element) => {
      if (busy) {
        element.dataset.wasDisabled = String(element.disabled);
        element.disabled = true;
      } else if (element.dataset.wasDisabled !== undefined) {
        element.disabled = element.dataset.wasDisabled === "true";
        delete element.dataset.wasDisabled;
      }
    });
    if (busy) root.querySelector(".story-reset-dialog-panel")?.focus();
  }

  function beginOperation() {
    setBusy(true);
    return ++state.operation;
  }

  async function finishOperation(operation) {
    if (operation !== state.operation) return;
    setBusy(false);
    await refreshChangedLocale();
  }

  function errorCode(error) {
    return error?.body?.error?.code || error?.body?.code || "";
  }

  function errorCopy(error, fallback = "sceneUnavailable") {
    if (error?.status === 401) return tr("loginRequired");
    if (errorCode(error) === "STORY_CUSTOM_CHOICE_DEFERRED") return controlTr("customUnavailable");
    if (error?.status === 403) return controlTr("accessRequired");
    if (errorCode(error) === "STORY_PROGRESS_STALE_REVISION") return controlTr("progressChanged");
    return controlTr(fallback);
  }

  function blockScene(message, retry = false) {
    state.scene = null;
    state.choices = [];
    state.controls = null;
    state.resetPreview = null;
    renderState(tr("sceneFailed"), message, retry);
    root.insertAdjacentHTML("beforeend", `<a class="story-back" href="/story-stage">${escapeHtml(tr("backToStories"))}</a>`);
    root.querySelector("h2")?.setAttribute("tabindex", "-1");
    root.querySelector("h2")?.focus();
  }

  function progressPath(suffix = "") {
    return `/api/v1/me/story-progress/${encodeURIComponent(state.sessionId)}${suffix}`;
  }

  function currentRequest(epoch, sessionId) {
    return epoch === state.epoch && sessionId === state.sessionId;
  }

  async function readControls(progress, sessionId, workId) {
    if (workId) {
      const projection = await request(`/api/v1/me/stories/${encodeURIComponent(workId)}/progress-state`, { auth: true });
      return {
        fullRemaining: projection.fullResetRemaining,
        actRemaining: projection.actResetRemaining,
        canFullReset: projection.canFullReset === true,
        canActReset: projection.canActReset === true,
      };
    }
    // Old session-only URLs have no work identity. Ask session-scoped previews only.
    const controls = {};
    for (const target of ["full", "act"]) {
      try {
        const params = new URLSearchParams({ target, locale: state.locale });
        if (target === "act") params.set("actNumber", progress.currentAct);
        const preview = await request(`/api/v1/me/story-progress/${encodeURIComponent(sessionId)}/reset-preview?${params}`, { auth: true });
        controls[`${target}Remaining`] = preview.remainingBefore;
        controls[target === "full" ? "canFullReset" : "canActReset"] = preview.canExecute === true && preview.expectedRevision === progress.revision && progress.status !== "ai_pending";
      } catch (_) {
        controls[`${target}Remaining`] = null;
      }
    }
    return controls;
  }

  function updateHeading() {
    const title = document.getElementById("storyStageTitle");
    const description = document.getElementById("storyStageDescription");
    if (title) title.textContent = tr("title");
    if (description) description.textContent = tr("description");
  }

  async function loadCatalog(more = false) {
    if (more && (state.pageLoading || !state.nextCursor)) return;
    const epoch = ++state.catalogEpoch;
    const locale = state.locale;
    const cursor = more ? state.nextCursor : null;
    state.sessionId = "";
    state.workId = "";
    state.progress = null;
    state.controls = null;
    state.minimumRevision = 0;
    state.pageLoading = more;
    state.pageError = false;
    if (!more) state.catalogStatus = "loading";
    renderCatalog();
    try {
      const params = new URLSearchParams({ locale, limit: "12" });
      if (cursor) params.set("cursor", cursor);
      const payload = await request(`/api/v1/stories?${params}`);
      if (epoch !== state.catalogEpoch || state.sessionId || state.graphWorkId) return;
      if (!Array.isArray(payload?.items) || !(payload.nextCursor === null || safeGraphId(payload.nextCursor)) || payload.nextCursor === cursor && cursor) throw new Error("Invalid catalog");
      const packs = payload.items.filter((pack) => safeGraphId(pack?.id) && packSlug(pack) && packTitle(pack));
      if (packs.length !== payload.items.length) throw new Error("Invalid catalog items");
      state.packs = [...new Map([...(more ? state.packs : []), ...packs].map((pack) => [pack.id, pack])).values()];
      state.nextCursor = payload.nextCursor;
      state.catalogLocale = locale;
      state.catalogStatus = "ready";
      state.pageLoading = false;
      renderCatalog();
    } catch (_) {
      if (epoch !== state.catalogEpoch || state.sessionId || state.graphWorkId) return;
      state.pageLoading = false;
      state.pageError = more;
      if (!more) state.catalogStatus = "error";
      renderCatalog();
    }
  }

  async function loadPack(slug) {
    const epoch = ++state.epoch;
    const locale = state.locale;
    const current = () => epoch === state.epoch && state.detailSlug === slug && locale === state.locale;
    state.detailStatus = "loading";
    state.pack = null;
    state.readerAccess = null;
    state.readerState = null;
    renderPack();
    try {
      // Public detail never opts into the shared helper's auth/refresh flow.
      const pack = await request(`/api/v1/stories/${encodeURIComponent(slug)}?locale=${encodeURIComponent(locale)}`);
      if (!current()) return;
      if (!safeGraphId(pack?.id) || pack.slug !== slug || !packTitle(pack) || !Array.isArray(pack.parts) ||
          pack.parts.some((part) => !safeGraphId(part?.id) || !Number.isInteger(part.position) || !textValue(part.title))) throw new Error("Invalid detail");
      state.pack = pack;
    } catch (_) {
      if (!current()) return;
      state.detailStatus = "error";
      renderPack();
      return;
    }
    state.detailStatus = signedIn() ? "access-loading" : "ready";
    renderPack();
    if (!signedIn()) return;
    const workId = state.pack.id;
    try {
      const owner = await request(`/api/v1/me/stories/${encodeURIComponent(workId)}/access?locale=${encodeURIComponent(locale)}`, { auth: true });
      if (!current()) return;
      if (owner?.workId !== workId || owner.slug !== slug || !owner.access) throw new Error("Invalid access");
      let progress = null;
      if (owner.access.accessible === true) {
        progress = await request(`/api/v1/me/stories/${encodeURIComponent(workId)}/progress-state`, { auth: true });
        if (!current()) return;
      }
      state.readerAccess = owner;
      state.readerState = progress;
      state.detailStatus = "ready";
    } catch (error) {
      if (!current()) return;
      state.detailStatus = "access-error";
      state.detailError = error?.status === 401 ? tr("loginRequired") : accessTr("accessFailed");
    }
    renderPack();
  }

  async function startStory() {
    const workId = safeGraphId(state.pack?.id);
    if (state.detailPending || !workId || !["start", "continue"].includes(detailAction())) return;
    const epoch = state.epoch;
    const locale = state.locale;
    state.detailPending = true;
    renderPack();
    try {
      const payload = await request(`/api/v1/stories/${encodeURIComponent(workId)}/progress`, {
        method: "POST",
        auth: true,
        body: { mode: "continue", locale },
      });
      const sessionId = safeGraphId(payload?.progressId);
      if (!sessionId || !Number.isInteger(payload.revision) || payload.revision < 1 || !Array.isArray(payload.choices) || payload.choices.length > 3) throw new Error("Invalid progress");
      if (epoch !== state.epoch || locale !== state.locale || !signedIn()) return;
      location.href = `/story-stage?sessionId=${encodeURIComponent(sessionId)}&workId=${encodeURIComponent(workId)}`;
    } catch (error) {
      if (epoch !== state.epoch) return;
      state.detailStatus = "access-error";
      state.readerAccess = null;
      state.detailError = error?.status === 401 ? tr("loginRequired") : tr("startFailed");
    } finally {
      state.detailPending = false;
      renderPack();
    }
  }

  async function loadScene() {
    const epoch = ++state.epoch;
    const sessionId = state.sessionId;
    state.controls = null;
    state.resetPreview = null;
    renderLoading(tr("sceneLoading"));
    try {
      const payload = await request(`/api/v1/story-sessions/${encodeURIComponent(sessionId)}/current-scene?locale=${encodeURIComponent(state.locale)}`, { auth: true });
      if (!currentRequest(epoch, sessionId)) return;
      if (payload?.progressId !== sessionId || !Number.isInteger(payload?.revision) || payload.revision < Math.max(1, state.minimumRevision)) throw new Error("Invalid progress projection");
      if (!Array.isArray(payload.choices)) throw new Error("Invalid choices projection");
      if (payload.choices.length > 3) return blockScene(controlTr("sceneUnavailable"));
      state.minimumRevision = payload.revision;
      state.scene = payload?.scene || null;
      state.choices = payload.choices;
      state.progress = payload;
      state.customChoiceOpen = false;
      const controls = await readControls(payload, sessionId, state.workId).catch(() => null);
      if (!currentRequest(epoch, sessionId)) return;
      state.controls = controls;
      renderScene();
      root.querySelector("[data-story-scene-focus]")?.focus();
    } catch (error) {
      if (!currentRequest(epoch, sessionId)) return;
      const terminal = errorCode(error) === "STORY_SUGGESTED_CHOICE_LIMIT_EXCEEDED" || error?.status === 401 || error?.status === 403;
      blockScene(errorCopy(error), !terminal);
    }
  }

  function graphTitle(value) {
    return textValue(value?.title) || "";
  }

  function graphFocusUrl() {
    const params = new URLSearchParams({ workId: state.graphWorkId });
    if (state.graphFocusSceneId) params.set("focusSceneId", state.graphFocusSceneId);
    return `/story-stage?${params.toString()}`;
  }

  function renderGraphChoice(choice, index) {
    const label = textValue(choice?.label) || `${tr("graphChoices")} ${index + 1}`;
    const nextTitle = graphTitle(choice?.nextScene);
    const targetId = safeGraphId(choice?.nextScene?.id || choice?.targetSceneId);
    const detail = nextTitle || (choice?.targetEndingKey ? tr("graphEnding") : tr("graphEmpty"));
    const body = `
      <span class="story-graph-choice-index">${index + 1}</span>
      <strong>${escapeHtml(label)}</strong>
      <small>${escapeHtml(detail)}</small>`;
    return targetId
      ? `<button type="button" class="story-graph-choice" data-story-graph-focus="${escapeHtml(targetId)}">${body}</button>`
      : `<article class="story-graph-choice">${body}</article>`;
  }

  function renderGraph() {
    const graph = state.graph;
    if (!graph?.focus) return renderState(tr("graphFailed"), tr("loadErrorBody"), true);
    const partTitle = graphTitle(graph.part);
    const focusTitle = graphTitle(graph.focus) || tr("graphEmpty");
    const choices = Array.isArray(graph.choices) ? graph.choices : [];
    const hasWarnings = Array.isArray(graph.validation?.warnings) && graph.validation.warnings.length > 0;
    root.innerHTML = `
      <section class="story-graph-preview" aria-label="${escapeHtml(tr("graphTitle"))}">
        <button type="button" class="story-back story-graph-back" data-story-graph-back>${escapeHtml(tr("backToStories"))}</button>
        <header class="story-graph-heading">
          <p>${escapeHtml(partTitle)}</p>
          <h2>${escapeHtml(tr("graphTitle"))}</h2>
          <span>${escapeHtml(tr("graphDescription"))}</span>
        </header>
        <div class="story-graph-flow">
          <section class="story-graph-focus">
            <span>${escapeHtml(tr("graphFocus"))}</span>
            <strong>${escapeHtml(focusTitle)}</strong>
          </section>
          <section class="story-graph-routes" aria-label="${escapeHtml(tr("graphChoices"))}">
            <h3>${escapeHtml(tr("graphNext"))}</h3>
            ${choices.length ? `<div class="story-graph-choice-list">${choices.map(renderGraphChoice).join("")}</div>` : `<p>${escapeHtml(tr("graphEmpty"))}</p>`}
          </section>
        </div>
        ${hasWarnings ? `<p class="story-graph-warning" role="status">${escapeHtml(tr("graphWarning"))}</p>` : ""}
      </section>`;
  }

  async function loadGraph() {
    if (!state.graphWorkId) return loadCatalog();
    const epoch = ++state.epoch;
    renderLoading();
    try {
      const params = new URLSearchParams({ locale: state.locale });
      if (state.graphFocusSceneId) params.set("focusSceneId", state.graphFocusSceneId);
      const graph = await request(`/api/v1/stories/${encodeURIComponent(state.graphWorkId)}/graph?${params.toString()}`, { auth: true });
      if (epoch !== state.epoch) return;
      state.graph = graph;
      history.replaceState(null, "", graphFocusUrl());
      renderGraph();
    } catch (_) {
      if (epoch !== state.epoch) return;
      renderState(tr("graphFailed"), tr("loadErrorBody"), true);
    }
  }

  async function submitChoice(choiceId) {
    if (state.busy || state.resetPreview || state.progress?.status !== "active" || !choiceId || !state.scene?.id || !Number.isInteger(state.progress?.revision) || state.choices.length > 3 || !state.choices.some((choice) => (choice.id || choice.choiceId) === choiceId)) return;
    const epoch = state.epoch;
    const sessionId = state.sessionId;
    const revision = state.progress.revision;
    const operation = beginOperation();
    actionStatus(tr("choosing"));
    try {
      const payload = await request(`${progressPath(`/choices/${encodeURIComponent(choiceId)}`)}?locale=${encodeURIComponent(state.locale)}`, {
        method: "POST",
        auth: true,
        body: { expectedRevision: revision },
      });
      if (!currentRequest(epoch, sessionId)) return;
      state.minimumRevision = Math.max(revision + 1, Number.isInteger(payload?.revision) ? payload.revision : 0);
      await loadScene();
    } catch (error) {
      if (!currentRequest(epoch, sessionId)) return;
      if (errorCode(error) === "STORY_SUGGESTED_CHOICE_LIMIT_EXCEEDED") {
        blockScene(controlTr("sceneUnavailable"));
      } else if (error?.status === 401 || error?.status === 403) {
        blockScene(errorCopy(error));
      } else {
        // A lost response may already have advanced progress. Never replay the POST.
        await loadScene();
        if (operation === state.operation) actionStatus(errorCode(error) === "STORY_PROGRESS_STALE_REVISION" ? controlTr("progressChanged") : tr("choiceFailed"));
      }
    } finally {
      await finishOperation(operation);
    }
  }

  async function submitCustomChoice(value) {
    const capability = customChoiceCapability(state.scene);
    const input = String(value || "").trim();
    const status = root.querySelector("[data-story-action-status]");
    if (!capability || !state.sessionId || !state.scene?.id || !Number.isInteger(state.progress?.revision)) {
      if (status) status.textContent = controlTr("customUnavailable");
      return;
    }
    if (!input) {
      if (status) status.textContent = controlTr("customEmpty");
      return;
    }
    if (state.busy) return;
    state.busy = true;
    if (status) status.textContent = tr("choosing");
    try {
      await request(capability.submitPath, {
        method: "POST",
        auth: true,
        headers: { "Idempotency-Key": `story-custom-choice-${crypto.randomUUID()}` },
        body: { input, expectedRevision: state.progress.revision },
      });
      state.busy = false;
      await loadScene();
    } catch (_) {
      if (status) status.textContent = tr("choiceFailed");
      state.busy = false;
    }
  }

  async function requestResetPreview(target) {
    const reset = resetCapability(state.progress);
    if (!reset || state.busy || state.resetPreview || !["full", "act"].includes(target) || !(target === "full" ? reset.canFullReset : reset.canActReset)) return;
    const epoch = state.epoch;
    const sessionId = state.sessionId;
    const operation = beginOperation();
    actionStatus(tr("loading"));
    try {
      const params = new URLSearchParams({ target, locale: state.locale });
      if (target === "act") params.set("actNumber", state.progress.currentAct);
      const preview = await request(`${progressPath("/reset-preview")}?${params}`, { auth: true });
      if (!currentRequest(epoch, sessionId)) return;
      if (!Number.isInteger(preview?.expectedRevision) || preview.expectedRevision < 1) throw new Error("Invalid preview revision");
      if (preview.expectedRevision !== state.progress.revision) {
        state.minimumRevision = Math.max(state.minimumRevision, preview.expectedRevision);
        await loadScene();
        if (operation === state.operation) actionStatus(controlTr("progressChanged"));
        return;
      }
      if (preview.target !== target || preview.canExecute !== true || !Number.isInteger(preview.remainingAfter) || !Number.isInteger(preview.targetAct) || !Number.isInteger(preview.invalidatedEventCount)) throw new Error("Invalid reset preview");
      state.resetPreview = { ...preview, idempotencyKey: `story-reset-${crypto.randomUUID()}` };
      renderScene();
    } catch (error) {
      if (currentRequest(epoch, sessionId)) actionStatus(errorCopy(error, "resetFailed"));
    } finally {
      await finishOperation(operation);
    }
  }

  async function confirmReset() {
    const reset = resetCapability(state.progress);
    if (!reset || !state.resetPreview?.target || state.busy || state.resetPreview.expectedRevision !== state.progress.revision) return;
    const preview = state.resetPreview;
    const epoch = state.epoch;
    const sessionId = state.sessionId;
    const operation = beginOperation();
    actionStatus(tr("loading"));
    try {
      const payload = await request(progressPath("/reset"), {
        method: "POST",
        auth: true,
        headers: { "Idempotency-Key": preview.idempotencyKey },
        body: { target: preview.target, ...(preview.target === "act" ? { actNumber: preview.targetAct } : {}), expectedRevision: preview.expectedRevision, locale: state.locale },
      });
      if (!currentRequest(epoch, sessionId)) return;
      // afterRevision is a receipt field, NOT an allowed StoryLocaleQueryDto field.
      if (!Number.isInteger(payload?.afterRevision) || payload.afterRevision < 1) throw new Error("Invalid reset receipt");
      state.minimumRevision = Math.max(state.minimumRevision, payload.afterRevision);
      await loadScene();
      if (operation === state.operation) actionStatus(controlTr("resetComplete"));
    } catch (error) {
      if (!currentRequest(epoch, sessionId)) return;
      await loadScene();
      if (operation === state.operation) actionStatus(errorCopy(error, "resetFailed"));
    } finally {
      await finishOperation(operation);
    }
  }

  async function refreshChangedLocale() {
    if (!state.localeDirty) return;
    state.localeDirty = false;
    if (state.sessionId) await loadScene();
  }

  function cancelReset() {
    if (state.busy) return;
    const target = state.resetPreview?.target;
    state.resetPreview = null;
    renderScene();
    root.querySelector(`[data-story-reset-preview="${target}"]`)?.focus();
  }

  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-story-close]")) return closePack();
    if (state.detailSlug && !event.target.closest(".story-detail-modal")) return;
    if (state.busy || event.target.closest("button:disabled")) return;
    if (state.resetPreview && !event.target.closest(".story-reset-dialog")) return;
    const packButton = event.target.closest("[data-pack-slug]");
    if (packButton) return openPack(packButton.dataset.packSlug, packButton);
    if (event.target.closest("[data-story-detail-retry]")) return loadPack(state.detailSlug);
    if (event.target.closest("[data-story-more]")) return loadCatalog(true);
    const graphFocusButton = event.target.closest("[data-story-graph-focus]");
    if (graphFocusButton) {
      state.graphFocusSceneId = safeGraphId(graphFocusButton.dataset.storyGraphFocus);
      return loadGraph();
    }
    if (event.target.closest("[data-story-graph-back]")) {
      state.graphWorkId = "";
      state.graphFocusSceneId = "";
      state.graph = null;
      history.replaceState(null, "", "/story-stage");
      return loadCatalog();
    }
    if (event.target.closest("[data-story-back]")) {
      ++state.epoch;
      state.pack = null;
      history.replaceState(null, "", "/story-stage");
      renderCatalog();
      return;
    }
    const startButton = event.target.closest("[data-story-start]");
    if (startButton) return startStory();
    const choiceButton = event.target.closest("[data-choice-id]");
    if (choiceButton) return submitChoice(choiceButton.dataset.choiceId);
    if (event.target.closest("[data-story-custom-choice]")) {
      if (!customChoiceCapability(state.scene)) return;
      state.customChoiceOpen = true;
      return renderScene();
    }
    const resetPreviewButton = event.target.closest("[data-story-reset-preview]");
    if (resetPreviewButton) return requestResetPreview(resetPreviewButton.dataset.storyResetPreview);
    if (event.target.closest("[data-story-reset-cancel]")) {
      return cancelReset();
    }
    if (event.target.closest("[data-story-reset-confirm]")) return confirmReset();
    if (event.target.closest("[data-story-retry]")) return state.sessionId ? loadScene() : state.graphWorkId ? loadGraph() : loadCatalog();
  });

  document.addEventListener("keydown", (event) => {
    if (state.dialog?.open && event.key === "Tab") {
      const targets = [...state.dialog.querySelectorAll("button:not(:disabled), [tabindex='0']")];
      const first = targets[0];
      const last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      return;
    }
    if (!state.resetPreview) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancelReset();
    }
    if (event.key === "Tab") {
      const buttons = [...root.querySelectorAll(".story-reset-dialog button:not(:disabled)")];
      event.preventDefault();
      if (!buttons.length) return;
      const index = buttons.indexOf(document.activeElement);
      buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
    }
  });

  root.addEventListener("input", (event) => {
    const input = event.target.closest("#storyCustomChoice");
    if (!input) return;
    const counter = root.querySelector("[data-story-custom-count]");
    if (counter) counter.textContent = `${input.value.length} / ${input.maxLength}`;
  });

  root.addEventListener("change", (event) => {
    if (!event.target.matches("[data-story-filter]") || state.detailSlug) return;
    state.filter = ["all", "free", "paid"].includes(event.target.value) ? event.target.value : "all";
    renderCatalog();
    root.querySelector("[data-story-filter]")?.focus({ preventScroll: true });
  });

  root.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-story-custom-form]");
    if (!form) return;
    event.preventDefault();
    submitCustomChoice(form.elements.customChoice?.value);
  });

  window.addEventListener("lumina:localechange", () => {
    const nextLocale = resolveLocale();
    if (nextLocale === state.locale) return;
    state.locale = nextLocale;
    updateHeading();
    if (state.detailSlug) {
      loadCatalog();
      return loadPack(state.detailSlug);
    }
    if (state.busy) {
      state.localeDirty = true;
      return;
    }
    if (state.sessionId) return loadScene();
    if (state.graphWorkId) return loadGraph();
    loadCatalog();
  });

  window.addEventListener("lumina:auth-expired", () => {
    if (!state.detailSlug) return;
    ++state.epoch;
    state.readerAccess = null;
    state.readerState = null;
    state.detailStatus = "access-error";
    state.detailError = tr("loginRequired");
    renderPack();
  });

  window.addEventListener("popstate", () => {
    if (state.dialog) dismissPack();
    ++state.epoch;
    ++state.operation;
    setBusy(false);
    const params = new URLSearchParams(location.search);
    state.sessionId = safeSessionId(params.get("sessionId"));
    state.workId = safeGraphId(params.get("workId"));
    state.graphWorkId = state.workId;
    state.graphFocusSceneId = safeGraphId(params.get("focusSceneId"));
    state.minimumRevision = 0;
    state.progress = null;
    state.scene = null;
    state.choices = [];
    state.controls = null;
    state.resetPreview = null;
    state.localeDirty = false;
    if (state.sessionId) return loadScene();
    if (state.graphWorkId) return loadGraph();
    if (!root.querySelector("[data-story-catalog-view]") || state.catalogLocale !== state.locale) loadCatalog();
    const slug = params.get("slug") || params.get("pack");
    if (slug) return openPack(slug, null, false);
  });

  updateHeading();
  if (state.sessionId) loadScene();
  else if (state.graphWorkId) loadGraph();
  else {
    loadCatalog();
    const params = new URLSearchParams(location.search);
    const slug = params.get("slug") || params.get("pack");
    if (slug) openPack(slug, null, false);
  }
})();
