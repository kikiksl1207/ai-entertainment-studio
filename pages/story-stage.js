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
      sceneNoVisual: "장면 이미지를 표시할 수 없습니다.",
      sceneImageGenerating: "장면 이미지를 준비하고 있습니다.",
      choices: "선택",
      choosing: "다음 장면을 불러오는 중입니다.",
      choiceFailed: "선택을 반영하지 못했습니다. 다시 시도해 주세요.",
      aiQueued: "선택을 받았습니다. 다음 장면 생성을 기다리고 있습니다.",
      aiProcessing: "다음 장면을 생성하고 있습니다. 다른 화면으로 이동해도 괜찮습니다.",
      aiRetryWait: "생성을 다시 준비하고 있습니다. 잠시만 기다려 주세요.",
      aiLost: "요청 결과를 확인하지 못했습니다. 새 요청을 만들지 않고 기존 요청을 확인할 수 있습니다.",
      aiRecover: "기존 요청 확인",
      aiChecking: "기존 생성 요청을 확인하고 있습니다.",
      aiFailed: "장면을 생성하지 못해 이전 진행 상태로 복구했습니다. 현재 선택을 확인한 뒤 다시 시도해 주세요.",
      aiTimedOut: "장면 생성 시간이 초과되어 이전 진행 상태로 복구했습니다. 현재 선택을 확인한 뒤 다시 시도해 주세요.",
      aiPollTimedOut: "생성이 예상보다 오래 걸리고 있습니다. 새 요청을 만들지 않고 상태를 다시 확인해 주세요.",
      aiUnavailable: "현재 생성 제공자를 사용할 수 없어 이 선택을 진행할 수 없습니다.",
      aiLegalUnavailable: "이 작품의 AI 생성 이용 승인이 활성화되지 않아 이 선택을 진행할 수 없습니다.",
      aiAuthRequired: "로그인이 만료되어 생성 상태를 확인할 수 없습니다. 다시 로그인한 뒤 기존 요청을 확인해 주세요.",
      aiAccessRequired: "생성 상태를 확인할 권한이 없습니다. 작품 이용 권한을 확인한 뒤 기존 요청을 다시 확인해 주세요.",
      aiSharedPending: "동일한 장면을 준비하고 있습니다. 새 요청을 만들지 않고 기존 요청을 다시 확인해 주세요.",
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
      sceneNoVisual: "Scene image unavailable.",
      sceneImageGenerating: "Preparing the scene image.",
      choices: "Choose",
      choosing: "Loading the next scene.",
      choiceFailed: "Your choice could not be applied. Please try again.",
      aiQueued: "Your choice was received. Waiting to generate the next scene.",
      aiProcessing: "Generating the next scene. You can continue using the rest of the site.",
      aiRetryWait: "Preparing another generation attempt. Please wait.",
      aiLost: "The request result could not be confirmed. Check the existing request without creating a new one.",
      aiRecover: "Check existing request",
      aiChecking: "Checking the existing generation request.",
      aiFailed: "The scene could not be generated, so your prior progress was restored. Review the current choice and try again.",
      aiTimedOut: "Scene generation timed out, so your prior progress was restored. Review the current choice and try again.",
      aiPollTimedOut: "Generation is taking longer than expected. Check its status again without creating a new request.",
      aiUnavailable: "This choice cannot continue because the generation provider is unavailable.",
      aiLegalUnavailable: "This choice cannot continue because AI generation approval is not active for this story.",
      aiAuthRequired: "Your sign-in expired before the generation status could be confirmed. Sign in again, then check the existing request.",
      aiAccessRequired: "You do not have permission to confirm the generation status. Check your story access, then check the existing request again.",
      aiSharedPending: "The same scene is being prepared. Check the existing request again without creating a new one.",
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
      sceneNoVisual: "シーン画像を表示できません。",
      sceneImageGenerating: "シーン画像を準備しています。",
      choices: "選択",
      choosing: "次のシーンを読み込んでいます。",
      choiceFailed: "選択を反映できませんでした。もう一度お試しください。",
      aiQueued: "選択を受け付けました。次のシーンの生成を待っています。",
      aiProcessing: "次のシーンを生成しています。この間もほかの画面を利用できます。",
      aiRetryWait: "生成を再準備しています。しばらくお待ちください。",
      aiLost: "リクエスト結果を確認できませんでした。新しいリクエストを作らず、既存のリクエストを確認できます。",
      aiRecover: "既存のリクエストを確認",
      aiChecking: "既存の生成リクエストを確認しています。",
      aiFailed: "シーンを生成できなかったため、以前の進行状態に戻しました。現在の選択を確認して再度お試しください。",
      aiTimedOut: "シーン生成がタイムアウトしたため、以前の進行状態に戻しました。現在の選択を確認して再度お試しください。",
      aiPollTimedOut: "生成に通常より時間がかかっています。新しいリクエストを作らず、状態を再確認してください。",
      aiUnavailable: "生成プロバイダーを利用できないため、この選択を進められません。",
      aiLegalUnavailable: "この作品のAI生成利用承認が有効でないため、この選択を進められません。",
      aiAuthRequired: "ログインの有効期限が切れたため生成状態を確認できません。再ログイン後、既存のリクエストを確認してください。",
      aiAccessRequired: "生成状態を確認する権限がありません。作品の利用権を確認後、既存のリクエストを再確認してください。",
      aiSharedPending: "同じシーンを準備しています。新しいリクエストを作らず、既存のリクエストを再確認してください。",
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
      sceneNoVisual: "场景图片不可用。",
      sceneImageGenerating: "正在准备场景图片。",
      choices: "选择",
      choosing: "正在加载下一个场景。",
      choiceFailed: "无法应用你的选择，请重试。",
      aiQueued: "已收到你的选择，正在等待生成下一个场景。",
      aiProcessing: "正在生成下一个场景。期间你仍可使用网站的其他页面。",
      aiRetryWait: "正在准备重新生成，请稍候。",
      aiLost: "无法确认请求结果。你可以在不创建新请求的情况下检查原请求。",
      aiRecover: "检查原请求",
      aiChecking: "正在检查原生成请求。",
      aiFailed: "场景生成失败，已恢复之前的阅读进度。请确认当前选择后重试。",
      aiTimedOut: "场景生成超时，已恢复之前的阅读进度。请确认当前选择后重试。",
      aiPollTimedOut: "生成时间比预期更长。请在不创建新请求的情况下再次检查状态。",
      aiUnavailable: "生成服务目前不可用，无法继续此选择。",
      aiLegalUnavailable: "此作品尚未启用AI生成授权，无法继续此选择。",
      aiAuthRequired: "登录已过期，无法确认生成状态。请重新登录后检查原请求。",
      aiAccessRequired: "你无权确认生成状态。请确认作品访问权限后再次检查原请求。",
      aiSharedPending: "相同场景正在准备中。请在不创建新请求的情况下再次检查原请求。",
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
      sceneNoVisual: "場景圖片無法顯示。",
      sceneImageGenerating: "正在準備場景圖片。",
      choices: "選擇",
      choosing: "正在載入下一個場景。",
      choiceFailed: "無法套用你的選擇，請重試。",
      aiQueued: "已收到你的選擇，正在等待生成下一個場景。",
      aiProcessing: "正在生成下一個場景。期間你仍可使用網站的其他頁面。",
      aiRetryWait: "正在準備重新生成，請稍候。",
      aiLost: "無法確認請求結果。你可以在不建立新請求的情況下檢查原請求。",
      aiRecover: "檢查原請求",
      aiChecking: "正在檢查原生成請求。",
      aiFailed: "場景生成失敗，已恢復之前的閱讀進度。請確認目前選擇後重試。",
      aiTimedOut: "場景生成逾時，已恢復之前的閱讀進度。請確認目前選擇後重試。",
      aiPollTimedOut: "生成時間比預期更長。請在不建立新請求的情況下再次檢查狀態。",
      aiUnavailable: "生成服務目前無法使用，無法繼續此選擇。",
      aiLegalUnavailable: "此作品尚未啟用AI生成授權，無法繼續此選擇。",
      aiAuthRequired: "登入已過期，無法確認生成狀態。請重新登入後檢查原請求。",
      aiAccessRequired: "你無權確認生成狀態。請確認作品存取權限後再次檢查原請求。",
      aiSharedPending: "相同場景正在準備中。請在不建立新請求的情況下再次檢查原請求。",
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
    ko: { filterLabel: "가격", all: "전체", loadMore: "더 보기", purchase: "구매", detailUnavailable: "작품 정보를 확인할 수 없습니다.", accessFailed: "이용 권한을 확인하지 못했습니다. 다시 시도해 주세요." },
    en: { filterLabel: "Price", all: "All", loadMore: "Load more", purchase: "Purchase", detailUnavailable: "Story details are unavailable.", accessFailed: "Your access could not be checked. Please try again." },
    ja: { filterLabel: "価格", all: "すべて", loadMore: "もっと見る", purchase: "購入", detailUnavailable: "作品情報を確認できません。", accessFailed: "利用権限を確認できませんでした。もう一度お試しください。" },
    "zh-Hans": { filterLabel: "价格", all: "全部", loadMore: "加载更多", purchase: "购买", detailUnavailable: "无法查看作品信息。", accessFailed: "无法确认你的访问权限，请重试。" },
    "zh-Hant": { filterLabel: "價格", all: "全部", loadMore: "載入更多", purchase: "購買", detailUnavailable: "無法查看作品資訊。", accessFailed: "無法確認你的存取權限，請重試。" },
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
    readerIdentity: "",
    purchaseConfirming: false,
    purchaseNotice: "",
    dialog: null,
    returnFocus: null,
    returnScroll: 0,
    aiNotice: null,
    aiPollGeneration: 0,
    aiPollTimer: null,
    aiPollResolve: null,
    aiPollController: null,
    sceneIdentity: "",
    beatOperation: null,
    completedBeat: null,
    readingScroll: null,
    beatNotice: "",
    visualRequestKey: "",
  };

  const READER_COPY = {
    ko: { previous: "이전 페이지", next: "다음 페이지", page: "{current} / {total} 페이지", text: "이야기 본문", saving: "읽는 위치를 저장하고 있습니다.", unconfirmed: "읽는 위치를 확인하지 못해 최신 진행 상황을 다시 불러왔습니다." },
    en: { previous: "Previous page", next: "Next page", page: "Page {current} of {total}", text: "Story text", saving: "Saving reading position.", unconfirmed: "The reading position could not be confirmed. The latest progress has been reloaded." },
    ja: { previous: "前のページ", next: "次のページ", page: "{total}ページ中{current}ページ", text: "物語の本文", saving: "読んでいる位置を保存しています。", unconfirmed: "読んでいる位置を確認できなかったため、最新の進行状況を再読み込みしました。" },
    "zh-Hans": { previous: "上一页", next: "下一页", page: "第 {current} 页，共 {total} 页", text: "故事正文", saving: "正在保存阅读位置。", unconfirmed: "无法确认阅读位置，已重新加载最新进度。" },
    "zh-Hant": { previous: "上一頁", next: "下一頁", page: "第 {current} 頁，共 {total} 頁", text: "故事正文", saving: "正在儲存閱讀位置。", unconfirmed: "無法確認閱讀位置，已重新載入最新進度。" },
  };

  function readerTr(key) {
    return READER_COPY[state.locale]?.[key] || READER_COPY.en[key] || "";
  }

  // First release is suggested-only, including legacy paid custom=true metadata.
  const FIRST_RELEASE = true;
  const AI_PENDING_STORAGE_PREFIX = "lumina:story-ai-pending:v1";
  const AI_SESSION_SCOPE_KEY = "lumina:story-ai-session-scope:v1";
  const AI_PENDING_STATUSES = new Set(["queued", "processing", "retry_wait"]);
  const AI_POLL_TIMEOUT_MS = 30000;
  const PURCHASE_STORAGE_PREFIX = "lumina:story-purchase:v1:";
  const purchaseOperations = new Map();
  const PURCHASE_COPY = {
    ko: { confirm: "{price} LUMINA 결제 확인", consent: "이 작품을 {price} LUMINA에 구매하시겠어요?", cancel: "취소", pending: "구매 결과를 확인하고 있습니다.", unknown: "구매 결과를 확인하지 못했습니다. 이용 권한을 확인하거나 같은 구매를 다시 확인해 주세요.", retry: "같은 구매 다시 확인", check: "이용 권한 확인", stale: "가격 또는 공개 버전이 변경되었습니다. 최신 가격을 확인하고 다시 동의해 주세요.", unavailable: "구매 정보를 확인할 수 없습니다. 새로 확인해 주세요.", success: "구매가 확인되었습니다. 이야기를 시작할 수 있습니다.", inactive: "이전 구매의 이용 권한이 유효하지 않습니다. 다시 구매하려면 최신 가격을 확인해 주세요.", balance: "LUMINA 잔액이 부족합니다.", denied: "구매할 수 없습니다. 로그인 상태와 이용 권한을 확인해 주세요.", failed: "구매를 완료하지 못했습니다. 다시 확인해 주세요.", storage: "구매 확인 정보를 안전하게 저장할 수 없습니다. 브라우저 저장 공간을 확인해 주세요." },
    en: { confirm: "Confirm {price} LUMINA", consent: "Purchase this story for {price} LUMINA?", cancel: "Cancel", pending: "Checking your purchase result.", unknown: "The purchase result is unknown. Check access or retry the same purchase.", retry: "Retry same purchase", check: "Check access", stale: "The price or release changed. Review the latest price and confirm again.", unavailable: "Purchase information is unavailable. Please refresh it.", success: "Purchase confirmed. You can start the story.", inactive: "The previous purchase no longer grants access. Review the latest price before purchasing again.", balance: "Your LUMINA balance is insufficient.", denied: "Purchase unavailable. Check your sign-in and access.", failed: "The purchase could not be completed. Please check again.", storage: "Purchase confirmation cannot be saved safely. Check your browser storage." },
    ja: { confirm: "{price} LUMINAの支払いを確定", consent: "この作品を{price} LUMINAで購入しますか？", cancel: "キャンセル", pending: "購入結果を確認しています。", unknown: "購入結果を確認できません。利用権限を確認するか、同じ購入を再確認してください。", retry: "同じ購入を再確認", check: "利用権限を確認", stale: "価格または公開版が変更されました。最新の価格を確認し、改めて同意してください。", unavailable: "購入情報を確認できません。再読み込みしてください。", success: "購入を確認しました。物語を開始できます。", inactive: "以前の購入による利用権限は無効です。再購入する前に最新の価格を確認してください。", balance: "LUMINAの残高が不足しています。", denied: "購入できません。ログイン状態と利用権限を確認してください。", failed: "購入を完了できませんでした。再確認してください。", storage: "購入確認情報を安全に保存できません。ブラウザーの保存領域を確認してください。" },
    "zh-Hans": { confirm: "确认支付 {price} LUMINA", consent: "以 {price} LUMINA 购买此作品？", cancel: "取消", pending: "正在确认购买结果。", unknown: "无法确认购买结果。请检查访问权限或重试同一笔购买。", retry: "重试同一笔购买", check: "检查访问权限", stale: "价格或发布版本已更改。请查看最新价格并重新确认。", unavailable: "无法确认购买信息，请刷新。", success: "购买已确认，可以开始故事。", inactive: "此前购买的访问权限已失效。再次购买前请查看最新价格。", balance: "LUMINA 余额不足。", denied: "无法购买，请检查登录状态和访问权限。", failed: "未能完成购买，请重新确认。", storage: "无法安全保存购买确认信息，请检查浏览器存储空间。" },
    "zh-Hant": { confirm: "確認支付 {price} LUMINA", consent: "以 {price} LUMINA 購買此作品？", cancel: "取消", pending: "正在確認購買結果。", unknown: "無法確認購買結果。請檢查存取權限或重試同一筆購買。", retry: "重試同一筆購買", check: "檢查存取權限", stale: "價格或發布版本已變更。請查看最新價格並重新確認。", unavailable: "無法確認購買資訊，請重新整理。", success: "購買已確認，可以開始故事。", inactive: "先前購買的存取權限已失效。再次購買前請查看最新價格。", balance: "LUMINA 餘額不足。", denied: "無法購買，請檢查登入狀態和存取權限。", failed: "未能完成購買，請重新確認。", storage: "無法安全儲存購買確認資訊，請檢查瀏覽器儲存空間。" },
  };

  function purchaseTr(key) {
    return PURCHASE_COPY[state.locale]?.[key] || PURCHASE_COPY.en[key] || "";
  }

  function readerIdentity() {
    if (!signedIn()) return "";
    const auth = window.getAuth?.();
    return String(auth?.user?.id || auth?.user?.userId || "");
  }

  function purchaseQuote(value) {
    if (!value || typeof value.priceLumina !== "string" ||
        !/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/.test(value.priceLumina) || !/[1-9]/.test(value.priceLumina) ||
        !safeGraphId(value.releaseId) || !Number.isSafeInteger(value.releaseRevision) || value.releaseRevision < 1) return null;
    return { priceLumina: value.priceLumina, releaseId: value.releaseId, releaseRevision: value.releaseRevision };
  }

  function purchaseStorageKey(workId, identity = readerIdentity()) {
    return PURCHASE_STORAGE_PREFIX + encodeURIComponent(identity) + ":" + workId;
  }

  function pendingPurchase(workId = state.pack?.id) {
    if (!workId || !readerIdentity()) return null;
    const storageKey = purchaseStorageKey(workId);
    if (purchaseOperations.has(storageKey)) return purchaseOperations.get(storageKey);
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey));
      if (!saved) return null;
      if (!purchaseQuote(saved.quote) || !/^story-purchase-[A-Za-z0-9-]{8,}$/.test(saved.key)) return { blocked: true };
      const operation = { storageKey, key: saved.key, quote: purchaseQuote(saved.quote), pending: false };
      purchaseOperations.set(storageKey, operation);
      return operation;
    } catch (_) { return { blocked: true }; }
  }

  function finishPurchase(operation) {
    // If storage cannot be cleared, keep the original key for safe replay.
    try { sessionStorage.removeItem(operation.storageKey); } catch (_) { return; }
    purchaseOperations.delete(operation.storageKey);
  }

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
    if (options.signal) {
      const auth = window.getAuth?.();
      const token = auth?.accessToken || auth?.tokens?.accessToken || auth?.access_token;
      const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
      if (options.auth && token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(API_ORIGIN + path, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        error.body = await response.json().catch(() => ({}));
        throw error;
      }
      return response.status === 204 ? null : response.json();
    }
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
    return typeof value === "string" && !/\s/.test(value) ? visualAssetUrl(value) : "";
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

  function requestId(prefix = "story-choice") {
    if (typeof crypto?.randomUUID === "function") return `${prefix}-${crypto.randomUUID()}`;
    if (typeof crypto?.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return `${prefix}-${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function opaqueScope(value) {
    const hashes = [2166136261, 2246822507, 3266489909, 668265263];
    for (const character of String(value)) {
      const code = character.charCodeAt(0);
      hashes.forEach((hash, index) => {
        hashes[index] = Math.imul(hash ^ (code + index * 97), 16777619 + index * 2);
      });
    }
    return hashes.map((hash) => (hash >>> 0).toString(36).padStart(7, "0")).join("");
  }

  function aiSessionScope() {
    const user = window.getAuth?.()?.user;
    const userId = user?.id || user?.userId;
    if (typeof userId === "string" && userId) return `user-${opaqueScope(userId)}`;
    try {
      const existing = sessionStorage.getItem(AI_SESSION_SCOPE_KEY);
      if (existing) return existing;
      const created = requestId("session");
      sessionStorage.setItem(AI_SESSION_SCOPE_KEY, created);
      return created;
    } catch (_) {
      return "session-unavailable";
    }
  }

  function aiOperationStorageKey(operation) {
    const workId = operation.workId || "session-only";
    return [AI_PENDING_STORAGE_PREFIX, aiSessionScope(), workId, operation.progressId, operation.choiceId, operation.revision]
      .map((value) => encodeURIComponent(String(value)))
      .join(":");
  }

  function aiProgressStoragePrefix(operation) {
    return [AI_PENDING_STORAGE_PREFIX, aiSessionScope(), operation.workId || "session-only", operation.progressId]
      .map((value) => encodeURIComponent(String(value)))
      .join(":") + ":";
  }

  function validAiOperation(value) {
    return value?.version === 1 &&
      value.progressId === state.sessionId &&
      value.workId === (state.workId || "") &&
      typeof value.choiceId === "string" && value.choiceId.length > 0 && value.choiceId.length <= 160 &&
      Number.isInteger(value.revision) && value.revision > 0 &&
      Number.isFinite(value.createdAt) && value.createdAt > 0 &&
      Object.hasOwn(COPY, value.locale) &&
      typeof value.idempotencyKey === "string" && /^story-choice-[A-Za-z0-9-]{8,}$/.test(value.idempotencyKey) &&
      (value.continuationId === null || safeSessionId(value.continuationId));
  }

  function saveAiOperation(operation) {
    try {
      sessionStorage.setItem(aiOperationStorageKey(operation), JSON.stringify(operation));
      return true;
    } catch (_) {
      return false;
    }
  }

  function removeAiOperation(operation) {
    const prefix = aiProgressStoragePrefix(operation);
    try {
      const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index));
      keys.forEach((key) => {
        if (!key?.startsWith(prefix)) return;
        try {
          const encodedRevision = key.slice(prefix.length).split(":").at(-1);
          if (decodeURIComponent(encodedRevision || "") === String(operation.revision)) sessionStorage.removeItem(key);
        } catch (_) {}
      });
    } catch (_) {}
  }

  function findAiOperation() {
    const scopePrefix = aiProgressStoragePrefix({ workId: state.workId || "", progressId: state.sessionId });
    const matches = [];
    try {
      const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index));
      for (const key of keys) {
        if (!key?.startsWith(scopePrefix)) continue;
        try {
          const value = JSON.parse(sessionStorage.getItem(key));
          if (validAiOperation(value)) matches.push(value);
        } catch (_) {
          sessionStorage.removeItem(key);
        }
      }
    } catch (_) { return null; }
    return matches.sort((left, right) => right.createdAt - left.createdAt)[0] || null;
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
          <button type="button" class="story-button story-button-secondary" data-story-reset-preview="full" ${reset.canFullReset && fullRemaining > 0 && !aiRequestOpen() ? "" : "disabled"}>${escapeHtml(controlTr("resetAll"))} · ${escapeHtml(controlTr("remaining"))} ${fullRemaining}</button>
          <button type="button" class="story-button story-button-secondary" data-story-reset-preview="act" ${reset.canActReset && actRemaining > 0 && !aiRequestOpen() ? "" : "disabled"}>${escapeHtml(controlTr("resetAct"))} · ${escapeHtml(controlTr("remaining"))} ${actRemaining}</button>
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
    if (pricing.free === true && /^0+(\.0+)?$/.test(pricing.amountLumina)) return tr("free");
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
    if (state.readerIdentity !== readerIdentity()) return "unavailable";
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
    const continueAction = access.actions.primary === "continue" && access.actions.canContinue === true && owner.replay?.continue === true;
    const startAction = access.actions.primary === "start" && access.actions.canStart === true && owner.replay?.continue === false;
    // canResume describes active scenes, not permission to read an existing ending.
    // Quota exhaustion takes precedence over completed in the server status key.
    if (owner.replay?.reset === true && (continueAction || startAction) && progress.canResume === false &&
        ["story.progress.status.completed", "story.progress.status.quotaExhausted"].includes(progress.statusKey)) return "continue";
    if (continueAction &&
        progress.canResume === true && ["story.progress.status.ready", "story.progress.status.quotaExhausted"].includes(progress.statusKey)) return "continue";
    if (startAction &&
        progress.statusKey === "story.progress.status.noProgress" && progress.canResume === false) return "start";
    return "unavailable";
  }

  function detailRetryVisible(operation) {
    if (["loading", "access-loading"].includes(state.detailStatus)) return false;
    return !(state.purchaseConfirming && !operation && state.detailStatus === "ready" && !state.purchaseNotice);
  }

  function renderPack() {
    const dialog = state.dialog;
    if (!dialog || !state.detailSlug) return;
    const pack = state.pack;
    const title = packTitle(pack) || accessTr("detailUnavailable");
    const cover = coverUrl(pack);
    const action = detailAction();
    const active = document.activeElement;
    const focusSelector = ["data-story-start", "data-story-purchase", "data-story-purchase-confirm", "data-story-purchase-retry", "data-story-purchase-cancel", "data-story-detail-retry"].find((attribute) => active?.hasAttribute(attribute));
    const operation = pendingPurchase();
    const quote = operation?.quote || purchaseQuote(state.readerAccess?.access?.purchaseConfirmation);
    const purchaseBusy = operation?.pending === true;
    const purchaseDisabled = !quote || !readerIdentity() || operation?.blocked || state.detailPending || purchaseBusy;
    const purchaseStatus = purchaseBusy ? purchaseTr("pending") : operation?.blocked ? purchaseTr("storage") : operation ? [state.purchaseNotice !== "unknown" ? purchaseTr(state.purchaseNotice) : "", purchaseTr("unknown")].filter(Boolean).join(" ") : state.purchaseNotice ? purchaseTr(state.purchaseNotice === "success" && !["start", "continue"].includes(action) ? "unavailable" : state.purchaseNotice) : action === "purchase" ? purchaseTr(quote ? "consent" : "unavailable").replace("{price}", quote?.priceLumina || "") : "";
    const scroll = dialog.querySelector(".story-detail-body")?.scrollTop || 0;
    dialog.innerHTML = `
      <header class="story-detail-header"><h2 id="storyDetailTitle">${escapeHtml(title)}</h2>
        <button type="button" class="story-detail-close" data-story-close aria-label="${escapeHtml(tr("close"))}" title="${escapeHtml(tr("close"))}">&times;</button></header>
      <div class="story-detail-body" tabindex="0">
        ${pack ? `<div class="story-detail-main">
          ${cover ? `<div class="story-detail-cover has-image"><img src="${escapeHtml(cover)}" alt="" /></div>` : ""}
          <div class="story-detail-copy">
            ${priceText(state.readerAccess?.access || pack.access) ? `<p>${escapeHtml(priceText(state.readerAccess?.access || pack.access))}</p>` : ""}
            ${packSummary(pack) ? `<h3>${escapeHtml(tr("synopsis"))}</h3><p class="story-synopsis">${escapeHtml(packSummary(pack))}</p>` : ""}
          </div></div>
          <section class="story-chapters"><h3>${escapeHtml(tr("chapterList"))} (${pack.parts.length})</h3>
            <ol>${pack.parts.map((part) => `<li><span>${escapeHtml(part.position)}</span><strong>${escapeHtml(textValue(part.title))}</strong><small>${escapeHtml(priceText(part.access))}</small></li>`).join("")}</ol>
          </section>` : ""}
      </div>
      <footer class="story-detail-actions" aria-busy="${state.detailPending || purchaseBusy}">
        <p id="storyPurchaseStatus" data-story-detail-status role="status">${escapeHtml(state.detailStatus === "loading" || state.detailStatus === "access-loading" ? tr("loading") : state.detailStatus === "error" ? accessTr("detailUnavailable") : state.detailStatus === "access-error" ? state.detailError : action === "sign_in" ? tr("loginRequired") : purchaseStatus || (action === "unavailable" ? controlTr("sceneUnavailable") : ""))}</p>
        ${action === "purchase" && quote && (state.purchaseConfirming || operation) ? `<p class="story-purchase-price" data-story-purchase-price>${escapeHtml(quote.priceLumina)} LUMINA</p>` : ""}
        <div>${action === "start" || action === "continue" ? `<button class="story-button story-button-primary" data-story-start ${state.detailPending || purchaseBusy ? "disabled" : ""}>${escapeHtml(state.detailPending ? tr("starting") : tr(action))}</button>` : action === "purchase" ? `<button class="story-button story-button-primary" ${operation ? "data-story-purchase-retry" : state.purchaseConfirming ? "data-story-purchase-confirm" : "data-story-purchase"} ${purchaseDisabled ? "disabled" : ""} aria-describedby="storyPurchaseStatus">${escapeHtml(operation ? purchaseTr("retry") : state.purchaseConfirming ? purchaseTr("confirm").replace("{price}", quote?.priceLumina || "") : accessTr("purchase"))}</button>${state.purchaseConfirming && !operation ? `<button class="story-button story-button-secondary" data-story-purchase-cancel>${escapeHtml(purchaseTr("cancel"))}</button>` : ""}` : ""}
        ${detailRetryVisible(operation) ? `<button class="story-button story-button-secondary" data-story-detail-retry ${state.detailPending || purchaseBusy ? "disabled" : ""}>${escapeHtml(operation ? purchaseTr("check") : tr("retry"))}</button>` : ""}</div>
      </footer>`;
    dialog.querySelector(".story-detail-body").scrollTop = scroll;
    const focusTarget = focusSelector && !state.detailPending && !purchaseBusy
      ? dialog.querySelector(`[${focusSelector}]:not(:disabled)`) || dialog.querySelector("[data-story-purchase-confirm]:not(:disabled)") || dialog.querySelector("[data-story-purchase]:not(:disabled)") || dialog.querySelector("[data-story-start]:not(:disabled)")
      : null;
    (focusTarget || dialog.querySelector("[data-story-close]"))?.focus({ preventScroll: true });
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
    state.purchaseConfirming = false;
    state.purchaseNotice = "";
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

  function visualAssetUrl(value) {
    if (typeof value !== "string" || !value.trim() || value.includes("\\")) return "";
    try {
      const url = new URL(value, location.origin);
      const apiOrigin = new URL(API_ORIGIN).origin;
      if (url.username || url.password || ![location.origin, apiOrigin].includes(url.origin)) return "";
      if (value.startsWith("/api/v1/") && !value.startsWith("//")) return API_ORIGIN + value;
      return /^https:\/\//i.test(value) || (value.startsWith("/") && !value.startsWith("//") && url.origin === location.origin) ? value : "";
    } catch (_) { return ""; }
  }

  function readingVisualKey(reading) {
    const context = reading?.beats?.[reading.index]?.visualContext;
    if (context != null) {
      if (context.generationAvailable !== true || context.assetReadiness !== "missing" ||
          context.manifest?.sceneKey !== context.sourceSceneKey ||
          context.manifest?.background?.state !== "fallback") return "";
    } else if (state.scene?.visualGenerationAvailable !== true) return "";
    const key = context?.sourceSceneKey || state.scene?.sceneKey;
    return typeof key === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(key) ? key : "";
  }

  async function ensureReadingVisual(reading, visual) {
    const sourceSceneKey = readingVisualKey(reading);
    const scopedKey = `${state.sessionId}:${sourceSceneKey}`;
    if (visual.ready || !sourceSceneKey || !signedIn() || state.visualRequestKey === scopedKey) return;
    const sessionId = state.sessionId;
    const identity = readerIdentity();
    const readingKey = reading.key;
    state.visualRequestKey = scopedKey;
    actionStatus(tr("sceneImageGenerating"));
    try {
      const result = await request(`/api/v1/me/story-progress/${encodeURIComponent(sessionId)}/scene-visual`, {
        method: "POST",
        auth: true,
        body: { sourceSceneKey },
      });
      if (sessionId !== state.sessionId || identity !== readerIdentity() || readingKey !== readableBeats()?.key) return;
      if (result?.status === "ready") await loadScene({ restorePending: false });
      else if (result?.status === "processing") setTimeout(() => {
        if (state.visualRequestKey === scopedKey) state.visualRequestKey = "";
        const currentReading = readableBeats();
        if (currentReading?.key === readingKey) ensureReadingVisual(currentReading, readingVisual(currentReading));
      }, 5000);
    } catch (_) {
      // Image generation is optional; the story remains readable with its fallback.
    } finally {
      if (state.visualRequestKey === scopedKey) state.visualRequestKey = "";
    }
  }

  function sceneBackground(scene) {
    return visualAssetUrl(scene?.visualManifest?.background?.publicAssetPath || scene?.backgroundAsset?.publicUrl || scene?.backgroundAsset?.url || scene?.backgroundUrl);
  }

  function characterUrl(character) {
    return visualAssetUrl(character?.publicAssetPath || character?.publicAssetUrl || character?.assetUrl || character?.imageUrl);
  }

  function sceneCharacters(scene) {
    const source = Array.isArray(scene?.characters)
      ? scene.characters
      : Array.isArray(scene?.visualManifest?.characters)
        ? scene.visualManifest.characters
        : [];
    return source.filter((character) => character?.placement !== "offscreen" && character?.fallbackUsed !== true && characterUrl(character));
  }

  function sceneCharacterSide(character, index) {
    const placement = character?.placement || character?.side;
    if (placement === "left") return "left";
    if (placement === "center") return "center";
    if (placement === "right") return "right";
    return index % 2 ? "right" : "left";
  }

  function readerScope(progress = state.progress) {
    return JSON.stringify([readerIdentity(), state.sessionId, state.workId, progress?.storyVersion,
      progress?.activeReleaseId || progress?.releaseId, progress?.releaseCapability?.revision,
      progress?.releaseCapability?.source, progress?.scene?.id, progress?.currentGeneratedSceneId]);
  }

  function beatContent(value) {
    if (typeof value === "string") return value;
    if (typeof value?.value === "string") return value.value;
    return textValue(value);
  }

  function readableBeats() {
    const source = state.scene?.beats;
    if (source != null && !Array.isArray(source)) return null;
    const beats = source?.length ? source.map((beat) => ({ position: beat?.position, visualContext: beat?.visualContext,
      text: beatContent(beat?.content) || beatContent(beat?.text) || beatContent(beat?.body) }))
      : [{ position: 0, text: beatContent(state.scene?.sceneText) || beatContent(state.scene?.body) || beatContent(state.scene?.content) }];
    if (beats.some((beat) => !Number.isSafeInteger(beat.position) || beat.position < 0) ||
        new Set(beats.map((beat) => beat.position)).size !== beats.length) return null;
    beats.sort((left, right) => left.position - right.position);
    const scope = readerScope();
    const position = state.progress?.status === "completed" && state.completedBeat?.scope === scope
      ? state.completedBeat.position : state.progress?.currentBeatPosition ?? 0;
    let index = beats.findIndex((beat) => beat.position === position);
    // Canonical releases can start at 1 while new progress still stores the sentinel 0.
    if (index < 0 && position === 0) index = 0;
    if (index < 0) return null;
    return { beats, index, scope, key: JSON.stringify([scope, beats[index].position]) };
  }

  function rememberReadingScroll() {
    const region = root.querySelector("[data-story-scene-focus]");
    if (region?.dataset.readingKey) state.readingScroll = { key: region.dataset.readingKey, top: region.scrollTop };
  }

  function readingVisual(reading) {
    const context = reading.beats[reading.index].visualContext;
    let source = state.scene;
    if (context != null) {
      // A supplied but invalid beat binding must not borrow another scene's art.
      if (typeof context.sourceSceneKey !== "string" || !context.sourceSceneKey.trim() ||
          context.manifest?.sceneKey !== context.sourceSceneKey || !["missing", "ready"].includes(context.assetReadiness) ||
          (context.assetReadiness === "ready") !== (context.manifest?.background?.state === "ready")) {
        return { background: "", characters: [], ready: false };
      }
      source = { visualManifest: context.manifest };
    }
    const background = sceneBackground(source);
    const backgroundState = source?.visualManifest?.background?.state;
    return { background, characters: sceneCharacters(source),
      ready: Boolean(background) && (context ? context.assetReadiness === "ready" : backgroundState == null || backgroundState === "ready") };
  }

  function bindReadingImages(reading, visual) {
    const stage = root.querySelector(".story-player-stage");
    if (!stage) return;
    const epoch = state.epoch;
    const sessionId = state.sessionId;
    const identity = readerIdentity();
    const locale = state.locale;
    const current = () => stage.isConnected && root.contains(stage) && currentRequest(epoch, sessionId) &&
      identity === readerIdentity() && locale === state.locale && reading.key === readableBeats()?.key;
    const fallback = stage.querySelector(".story-player-no-visual");
    stage.querySelectorAll("img").forEach((element) => {
      const background = element.classList.contains("story-player-background");
      const settle = (loaded) => {
        if (!current() || !stage.contains(element)) return;
        if (loaded && element.naturalWidth > 0) {
          element.hidden = false;
          if (background) {
            stage.dataset.visualStatus = visual.ready ? "ready" : "fallback";
            stage.closest(".story-player").dataset.hasBackground = "true";
            fallback.hidden = visual.ready;
          }
        } else if (!loaded) {
          element.remove();
          if (background) {
            stage.dataset.visualStatus = "missing";
            stage.closest(".story-player").dataset.hasBackground = "false";
            fallback.hidden = false;
          }
        }
      };
      element.addEventListener("load", () => settle(true), { once: true });
      element.addEventListener("error", () => settle(false), { once: true });
      // Cached images may have settled before their scoped listeners were attached.
      if (element.complete) settle(element.naturalWidth > 0);
    });
  }

  function cancelBeatNavigation() {
    if (!state.beatOperation) return;
    state.beatOperation.controller.abort();
    state.beatOperation = null;
    ++state.operation;
    setBusy(false);
  }

  async function turnBeat(direction) {
    const reading = readableBeats();
    if (!reading || ![-1, 1].includes(direction) || state.busy || aiRequestOpen() || state.resetPreview ||
        state.sceneIdentity !== readerIdentity() || !["active", "completed"].includes(state.progress?.status)) return;
    const target = reading.beats[reading.index + direction];
    if (!target) return;
    if (state.progress.status === "completed") {
      state.completedBeat = { scope: reading.scope, position: target.position };
      renderScene();
      root.querySelector("[data-story-scene-focus]")?.focus({ preventScroll: true });
      return;
    }
    const epoch = state.epoch;
    const sessionId = state.sessionId;
    const identity = readerIdentity();
    const locale = state.locale;
    const revision = state.progress.revision;
    if (!Number.isSafeInteger(revision) || revision < 1) return;
    const operation = beginOperation();
    const pending = { controller: new AbortController() };
    state.beatOperation = pending;
    state.beatNotice = "";
    const current = () => state.beatOperation === pending && operation === state.operation && currentRequest(epoch, sessionId) &&
      identity === readerIdentity() && locale === state.locale && reading.scope === readerScope();
    actionStatus(readerTr("saving"));
    const timer = setTimeout(() => pending.controller.abort(), 15000);
    try {
      const payload = await request(`${progressPath("/beat")}?locale=${encodeURIComponent(locale)}`, {
        method: "POST", auth: true, signal: pending.controller.signal,
        body: { position: target.position, expectedRevision: revision },
      });
      if (!current()) return;
      if (payload?.progressId !== sessionId || !Number.isSafeInteger(payload.revision) || payload.revision <= revision ||
          payload.currentBeatPosition !== target.position || readerScope(payload) !== reading.scope ||
          !Array.isArray(payload.choices) || payload.choices.length > 3 || payload.status !== "active") throw new Error("Invalid beat projection");
      state.minimumRevision = Math.max(state.minimumRevision, payload.revision);
      state.progress = payload;
      state.scene = payload.scene;
      state.choices = payload.choices;
    } catch (error) {
      if (!current()) return;
      if (error?.status === 401 || error?.status === 403) return blockScene(errorCopy(error));
      // A timed-out write may have committed. Refetch, never replay the position POST.
      await loadScene({ restorePending: false });
      if (operation === state.operation && identity === readerIdentity() && sessionId === state.sessionId && locale === state.locale && state.scene) {
        state.beatNotice = errorCode(error) === "STORY_PROGRESS_STALE_REVISION" ? controlTr("progressChanged") : readerTr("unconfirmed");
      }
    } finally {
      clearTimeout(timer);
      if (state.beatOperation === pending) {
        state.beatOperation = null;
        await finishOperation(operation);
        if (operation === state.operation && identity === readerIdentity() && sessionId === state.sessionId && locale === state.locale && state.scene) {
          renderScene();
          root.querySelector("[data-story-scene-focus]")?.focus({ preventScroll: true });
        }
      }
    }
  }

  function aiRequestOpen() {
    return ["queued", "processing", "retry_wait", "lost", "checking", "poll-timeout", "auth", "access", "shared-pending"].includes(state.aiNotice?.kind);
  }

  function aiNoticeCopy() {
    const key = {
      queued: "aiQueued",
      processing: "aiProcessing",
      retry_wait: "aiRetryWait",
      lost: "aiLost",
      checking: "aiChecking",
      failed: "aiFailed",
      timeout: "aiTimedOut",
      "poll-timeout": "aiPollTimedOut",
      unavailable: "aiUnavailable",
      legal: "aiLegalUnavailable",
      auth: "aiAuthRequired",
      access: "aiAccessRequired",
      "shared-pending": "aiSharedPending",
    }[state.aiNotice?.kind];
    return key ? tr(key) : "";
  }

  function renderAiNotice() {
    if (!state.aiNotice) return '<div data-story-ai-notice hidden></div>';
    const pending = AI_PENDING_STATUSES.has(state.aiNotice.kind) || state.aiNotice.kind === "checking";
    const recoverable = ["lost", "poll-timeout", "auth", "access", "shared-pending"].includes(state.aiNotice.kind);
    return `
      <section class="story-ai-notice" data-story-ai-notice data-tone="${pending ? "pending" : "attention"}" role="status" aria-live="polite">
        ${pending ? '<span class="story-spinner" aria-hidden="true"></span>' : ""}
        <p>${escapeHtml(aiNoticeCopy())}</p>
        ${recoverable ? `<button type="button" class="story-button story-button-secondary" data-story-ai-recover>${escapeHtml(tr("aiRecover"))}</button>` : ""}
      </section>`;
  }

  function updateAiNotice() {
    const current = root.querySelector("[data-story-ai-notice]");
    if (current) current.outerHTML = renderAiNotice();
  }

  function renderScene() {
    const scene = state.scene;
    if (!scene && state.progress?.status !== "completed") return renderState(tr("sceneFailed"), tr("loadErrorBody"), true);
    if (state.choices.length > 3) return blockScene(controlTr("sceneUnavailable"));
    const reading = readableBeats();
    const isEnding = state.progress?.status === "completed";
    if (!reading || (isEnding && state.choices.length) || (state.progress?.status === "active" && !state.choices.length && (scene?.ending || scene?.isEnding || scene?.endingType))) return blockScene(controlTr("sceneUnavailable"));
    const visual = readingVisual(reading);
    const { background, characters } = visual;
    const sceneText = reading.beats[reading.index].text;
    const lastBeat = reading.index === reading.beats.length - 1;
    const navigationBlocked = state.busy || aiRequestOpen() || !["active", "completed"].includes(state.progress?.status);
    rememberReadingScroll();
    const restoreFocus = document.activeElement?.matches("[data-story-scene-focus]");
    const customChoice = customChoiceCapability(scene);
    const fixedChoices = state.choices;
    root.innerHTML = `
      <section class="story-player" data-has-background="false">
        <a class="story-back" href="/story-stage">← ${escapeHtml(tr("backToStories"))}</a>
        ${!scene && isEnding ? `<div class="story-completed" tabindex="-1" data-story-scene-focus>
          <span class="story-ending-label">${escapeHtml(tr("ending"))}</span>
          <h2>${escapeHtml(tr("completed"))}</h2>
        </div>` : `<div class="story-player-stage" data-visual-status="${background ? "loading" : "missing"}">
          <div class="story-player-no-visual" ${background && visual.ready ? "hidden" : ""}>${escapeHtml(tr("sceneNoVisual"))}</div>
          ${background ? `<img class="story-player-background" src="${escapeHtml(background)}" alt="" hidden />` : ""}
          <div class="story-player-characters" aria-hidden="true">
            ${characters.map((character, index) => `<img src="${escapeHtml(characterUrl(character))}" alt="" data-side="${escapeHtml(sceneCharacterSide(character, index))}" hidden />`).join("")}
          </div>
          <div class="story-player-copy" tabindex="0" role="region" aria-label="${escapeHtml(readerTr("text"))}" data-story-scene-focus data-reading-key="${escapeHtml(reading.key)}">
            ${isEnding ? `<span class="story-ending-label">${escapeHtml(tr("ending"))}</span>` : ""}
            <p>${escapeHtml(sceneText)}</p>
          </div>
        </div>`}
        ${reading.beats.length > 1 ? `<nav class="story-beat-navigation" aria-label="${escapeHtml(readerTr("page").replace("{current}", reading.index + 1).replace("{total}", reading.beats.length))}">
          <button type="button" data-story-beat="previous" aria-label="${escapeHtml(readerTr("previous"))}" title="${escapeHtml(readerTr("previous"))}" ${navigationBlocked || reading.index === 0 ? "disabled" : ""}><span aria-hidden="true">&#8592;</span></button>
          <output data-story-beat-counter aria-live="polite">${reading.index + 1} / ${reading.beats.length}</output>
          <button type="button" data-story-beat="next" aria-label="${escapeHtml(readerTr("next"))}" title="${escapeHtml(readerTr("next"))}" ${navigationBlocked || lastBeat ? "disabled" : ""}><span aria-hidden="true">&#8594;</span></button>
        </nav>` : ""}
        ${fixedChoices.length && !isEnding && lastBeat ? `
          <div class="story-choice-panel">
            <h2>${escapeHtml(tr("choices"))}</h2>
            <div class="story-choice-list">
              ${fixedChoices.map((choice, index) => {
                const label = textValue(choice.label) || textValue(choice.choiceBody) || textValue(choice.body) || String(index + 1);
                return `<button type="button" data-choice-id="${escapeHtml(choice.id || choice.choiceId || "")}" ${state.progress?.status === "active" && Number.isInteger(state.progress?.revision) && !aiRequestOpen() ? "" : "disabled"} aria-label="${escapeHtml(label)}"><span aria-hidden="true">${index + 1}</span>${escapeHtml(label)}</button>`;
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
        ${renderAiNotice()}
        <p class="story-action-status" data-story-action-status aria-live="polite">${escapeHtml(state.beatNotice || (state.progress?.status !== "active" && !isEnding && !aiRequestOpen() ? controlTr("sceneUnavailable") : ""))}</p>
        ${renderResetControls(state.progress)}
      </section>`;
    bindReadingImages(reading, visual);
    ensureReadingVisual(reading, visual);
    const readingRegion = root.querySelector("[data-story-scene-focus]");
    readingRegion.scrollTop = state.readingScroll?.key === reading.key ? state.readingScroll.top : 0;
    if (restoreFocus) readingRegion.focus({ preventScroll: true });
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
    return epoch === state.epoch && sessionId === state.sessionId && state.sceneIdentity === readerIdentity();
  }

  function cancelAiPolling() {
    state.aiPollGeneration += 1;
    state.aiPollController?.abort();
    state.aiPollController = null;
    if (state.aiPollTimer !== null) clearTimeout(state.aiPollTimer);
    state.aiPollTimer = null;
    state.aiPollResolve?.(false);
    state.aiPollResolve = null;
  }

  function aiPollDelay(milliseconds, generation, epoch, sessionId) {
    return new Promise((resolve) => {
      state.aiPollResolve = resolve;
      state.aiPollTimer = setTimeout(() => {
        state.aiPollTimer = null;
        state.aiPollResolve = null;
        resolve(generation === state.aiPollGeneration && currentRequest(epoch, sessionId));
      }, milliseconds);
    });
  }

  function setAiNotice(kind, operation) {
    state.aiNotice = { kind, operation };
    if (state.scene || state.progress?.status === "completed") renderScene();
    else updateAiNotice();
  }

  async function refreshSceneAfterAi(kind, operation, minimumRevision = 0) {
    if (minimumRevision > 0) state.minimumRevision = Math.max(state.minimumRevision, minimumRevision);
    state.aiNotice = { kind, operation };
    await loadScene({ restorePending: false });
  }

  async function handleAiReceipt(payload, operation) {
    const continuationId = safeSessionId(payload?.continuationId);
    const status = typeof payload?.status === "string" ? payload.status : "";
    if (!continuationId || ![...AI_PENDING_STATUSES, "completed", "failed", "timeout"].includes(status)) {
      throw new Error("Invalid continuation receipt");
    }
    operation.continuationId = continuationId;
    operation.status = status;
    operation.updatedAt = Date.now();
    if (Number.isInteger(payload.revisionAfterRequest)) operation.revisionAfterRequest = payload.revisionAfterRequest;
    saveAiOperation(operation);
    if (AI_PENDING_STATUSES.has(status)) {
      setAiNotice(status, operation);
      void pollAiContinuation(operation);
      return;
    }
    removeAiOperation(operation);
    if (status === "completed") {
      state.aiNotice = null;
      state.minimumRevision = Math.max(state.minimumRevision, operation.revisionAfterRequest || operation.revision + 1);
      await loadScene({ restorePending: false });
      return;
    }
    await refreshSceneAfterAi(status, operation);
  }

  async function pollAiContinuation(operation) {
    if (!validAiOperation(operation) || !operation.continuationId) return;
    cancelAiPolling();
    const generation = state.aiPollGeneration;
    const epoch = state.epoch;
    const sessionId = state.sessionId;
    const deadlineAt = Date.now() + AI_POLL_TIMEOUT_MS;
    let attempt = 0;
    while (Date.now() < deadlineAt) {
      const delay = Math.min(3000, 1000 + attempt * 1000, deadlineAt - Date.now());
      if (!await aiPollDelay(delay, generation, epoch, sessionId)) return;
      attempt += 1;
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) break;
      const controller = new AbortController();
      state.aiPollController = controller;
      const deadlineTimer = setTimeout(() => controller.abort(), remaining);
      try {
        const payload = await request(`${progressPath(`/ai-continuations/${encodeURIComponent(operation.continuationId)}`)}`, { auth: true, signal: controller.signal });
        if (generation !== state.aiPollGeneration || !currentRequest(epoch, sessionId)) return;
        if (Date.now() >= deadlineAt) break;
        const status = typeof payload?.status === "string" ? payload.status : "";
        if (payload?.continuationId !== operation.continuationId || ![...AI_PENDING_STATUSES, "completed", "failed", "timeout"].includes(status)) {
          throw new Error("Invalid continuation status");
        }
        operation.status = status;
        operation.updatedAt = Date.now();
        if (Number.isInteger(payload.revisionAfterRequest)) operation.revisionAfterRequest = payload.revisionAfterRequest;
        saveAiOperation(operation);
        if (AI_PENDING_STATUSES.has(status)) {
          if (state.aiNotice?.kind !== status) setAiNotice(status, operation);
          continue;
        }
        removeAiOperation(operation);
        if (status === "completed") {
          state.aiNotice = null;
          state.minimumRevision = Math.max(state.minimumRevision, operation.revisionAfterRequest || operation.revision + 1);
          await loadScene({ restorePending: false });
        } else {
          await refreshSceneAfterAi(status, operation);
        }
        return;
      } catch (error) {
        if (generation !== state.aiPollGeneration || !currentRequest(epoch, sessionId)) return;
        if (error?.status === 401 || error?.status === 403) {
          setAiNotice(error.status === 401 ? "auth" : "access", operation);
          return;
        }
      } finally {
        clearTimeout(deadlineTimer);
        if (state.aiPollController === controller) state.aiPollController = null;
      }
    }
    if (generation !== state.aiPollGeneration || !currentRequest(epoch, sessionId)) return;
    await refreshSceneAfterAi("poll-timeout", operation);
  }

  function restoreAiOperation() {
    const operation = findAiOperation();
    if (!operation) return;
    if (!operation.continuationId && state.progress?.revision > operation.revision && state.progress?.status !== "ai_pending") {
      removeAiOperation(operation);
      return;
    }
    if (operation.continuationId) {
      const status = AI_PENDING_STATUSES.has(operation.status) ? operation.status : "queued";
      setAiNotice(status, operation);
      void pollAiContinuation(operation);
      return;
    }
    setAiNotice(operation.status === "shared_pending" ? "shared-pending" : "lost", operation);
  }

  function aiUnavailableKind(error) {
    const code = errorCode(error);
    if (["STORY_AI_LEGAL_ACTIVATION_REQUIRED", "STORY_AI_GENERATION_NOT_AUTHORIZED"].includes(code)) return "legal";
    if (code === "STORY_CHOICE_GENERATION_UNAVAILABLE") return "unavailable";
    return "";
  }

  function keepSharedPending(error, operation) {
    if (errorCode(error) !== "STORY_AI_SHARED_RESULT_PENDING" || error?.status !== 409) return false;
    operation.status = "shared_pending";
    operation.updatedAt = Date.now();
    saveAiOperation(operation);
    setAiNotice("shared-pending", operation);
    return true;
  }

  async function recoverAiOperation() {
    const operation = state.aiNotice?.operation || findAiOperation();
    if (state.busy || !validAiOperation(operation)) return;
    if (operation.continuationId) {
      setAiNotice(operation.status && AI_PENDING_STATUSES.has(operation.status) ? operation.status : "queued", operation);
      void pollAiContinuation(operation);
      return;
    }
    const epoch = state.epoch;
    const sessionId = state.sessionId;
    const uiOperation = beginOperation();
    setAiNotice("checking", operation);
    try {
      const payload = await request(`${progressPath(`/choices/${encodeURIComponent(operation.choiceId)}`)}?locale=${encodeURIComponent(operation.locale)}`, {
        method: "POST",
        auth: true,
        headers: { "Idempotency-Key": operation.idempotencyKey },
        body: { expectedRevision: operation.revision },
      });
      if (!currentRequest(epoch, sessionId)) return;
      if (payload?.continuationId) await handleAiReceipt(payload, operation);
      else {
        removeAiOperation(operation);
        state.aiNotice = null;
        state.minimumRevision = Math.max(operation.revision + 1, Number.isInteger(payload?.revision) ? payload.revision : 0);
        await loadScene({ restorePending: false });
      }
    } catch (error) {
      if (!currentRequest(epoch, sessionId)) return;
      if (keepSharedPending(error, operation)) return;
      const unavailable = aiUnavailableKind(error);
      if (unavailable) {
        removeAiOperation(operation);
        await refreshSceneAfterAi(unavailable, operation);
      } else {
        await loadScene({ restorePending: false });
        if (currentRequest(state.epoch, sessionId)) setAiNotice("lost", operation);
      }
    } finally {
      await finishOperation(uiOperation);
    }
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

  async function loadPack(slug, purchaseNotice = "") {
    const epoch = ++state.epoch;
    const locale = state.locale;
    const identity = readerIdentity();
    const current = () => epoch === state.epoch && state.detailSlug === slug && locale === state.locale && identity === readerIdentity();
    state.purchaseConfirming = false;
    state.purchaseNotice = purchaseNotice;
    state.readerIdentity = identity;
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
      const operation = pendingPurchase(workId);
      if (owner.access.accessible === true && ["free", "entitled"].includes(owner.access.status) && operation && !operation.pending && !operation.blocked) {
        finishPurchase(operation);
        if (state.purchaseNotice === "unknown") state.purchaseNotice = "";
      }
    } catch (error) {
      if (!current()) return;
      state.detailStatus = "access-error";
      state.detailError = error?.status === 401 ? tr("loginRequired") : accessTr("accessFailed");
    }
    renderPack();
  }

  async function purchaseStory(retry = false) {
    const workId = safeGraphId(state.pack?.id);
    const identity = readerIdentity();
    if (!workId || !identity || state.detailPending || detailAction() !== "purchase") return;
    let operation = pendingPurchase(workId);
    if (operation?.pending || operation?.blocked || (operation && !retry)) return;
    if (!operation) {
      if (retry || !state.purchaseConfirming) return;
      const quote = purchaseQuote(state.readerAccess?.access?.purchaseConfirmation);
      if (!quote) return;
      operation = { storageKey: purchaseStorageKey(workId, identity), quote, key: requestId("story-purchase"), pending: false };
      // Persist before transmission. An uncertain response must never mint another key.
      try { sessionStorage.setItem(operation.storageKey, JSON.stringify({ key: operation.key, quote })); }
      catch (_) { state.purchaseNotice = "storage"; renderPack(); return; }
      purchaseOperations.set(operation.storageKey, operation);
    }
    const epoch = state.epoch;
    const slug = state.detailSlug;
    const locale = state.locale;
    const current = () => epoch === state.epoch && slug === state.detailSlug && locale === state.locale && identity === readerIdentity();
    operation.pending = true;
    state.purchaseConfirming = false;
    renderPack();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let notice = "unknown";
    try {
      const result = await request(`/api/v1/stories/${encodeURIComponent(workId)}/purchase`, {
        method: "POST", auth: true, signal: controller.signal,
        headers: { "Idempotency-Key": operation.key },
        body: { confirmedPriceLumina: operation.quote.priceLumina, expectedReleaseId: operation.quote.releaseId, expectedReleaseRevision: operation.quote.releaseRevision },
      });
      const noCharge = result?.charged === false && result.chargedAmountLumina === "0" && result.idempotentReplay === true;
      const purchased = result?.outcome === "purchased" && result.entitled === true && result.charged === true && result.idempotentReplay === false && result.chargedAmountLumina === operation.quote.priceLumina;
      const replayed = noCharge && result.outcome === "replayed" && result.entitled === true && purchaseQuote({ ...operation.quote, priceLumina: result.originalPurchaseAmountLumina });
      const inactive = noCharge && result.outcome === "entitlement_inactive" && result.entitled === false;
      if (purchased || replayed || inactive || (noCharge && result.entitled === true && ["free", "already_entitled"].includes(result.outcome))) {
        finishPurchase(operation);
        notice = inactive ? "inactive" : "success";
      }
    } catch (error) {
      const body = error?.body?.error || error?.body || {};
      const code = body.code;
      if (error.status === 409 && ["STORY_PURCHASE_CONFIRMATION_STALE", "STORY_PURCHASE_CONFIRMATION_REQUIRED"].includes(code) && (body.walletMutation === false || body.details?.walletMutation === false)) {
        finishPurchase(operation);
        notice = "stale";
      } else if ([400, 401, 403, 404, 422].includes(error.status)) {
        if (body.walletMutation === false || body.details?.walletMutation === false) finishPurchase(operation);
        notice = error.status === 401 || error.status === 403 ? "denied" : /INSUFFICIENT/.test(code || "") ? "balance" : "failed";
      }
    } finally {
      clearTimeout(timer);
      operation.pending = false;
    }
    // Read access/progress again; a purchase response is never a reader entitlement.
    if (current()) await loadPack(slug, notice);
    else if (identity === readerIdentity() && state.pack?.id === workId && state.detailSlug) await loadPack(state.detailSlug);
  }

  async function startStory() {
    const workId = safeGraphId(state.pack?.id);
    if (state.detailPending || !workId || !["start", "continue"].includes(detailAction())) return;
    const epoch = state.epoch;
    const locale = state.locale;
    const identity = readerIdentity();
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
      if (epoch !== state.epoch || locale !== state.locale || !signedIn() || identity !== readerIdentity()) return;
      location.href = `/story-stage?sessionId=${encodeURIComponent(sessionId)}&workId=${encodeURIComponent(workId)}`;
    } catch (error) {
      if (epoch !== state.epoch || identity !== readerIdentity()) return;
      state.detailStatus = "access-error";
      state.readerAccess = null;
      state.detailError = error?.status === 401 ? tr("loginRequired") : tr("startFailed");
    } finally {
      state.detailPending = false;
      renderPack();
    }
  }

  async function loadScene(options = {}) {
    cancelAiPolling();
    const restorePending = options.restorePending !== false;
    const epoch = ++state.epoch;
    const sessionId = state.sessionId;
    const identity = readerIdentity();
    const locale = state.locale;
    const workId = state.workId;
    const current = () => currentRequest(epoch, sessionId) && identity === readerIdentity() && locale === state.locale && workId === state.workId;
    state.sceneIdentity = identity;
    state.beatNotice = "";
    state.controls = null;
    state.resetPreview = null;
    rememberReadingScroll();
    renderLoading(tr("sceneLoading"));
    try {
      const payload = await request(`/api/v1/story-sessions/${encodeURIComponent(sessionId)}/current-scene?locale=${encodeURIComponent(locale)}`, { auth: true });
      if (!current()) return;
      if (payload?.progressId !== sessionId || !Number.isInteger(payload?.revision) || payload.revision < Math.max(1, state.minimumRevision)) throw new Error("Invalid progress projection");
      if (!Array.isArray(payload.choices)) throw new Error("Invalid choices projection");
      if (payload.choices.length > 3) return blockScene(controlTr("sceneUnavailable"));
      state.minimumRevision = payload.revision;
      state.scene = payload?.scene || null;
      state.choices = payload.choices;
      state.progress = payload;
      state.customChoiceOpen = false;
      const controls = await readControls(payload, sessionId, state.workId).catch(() => null);
      if (!current()) return;
      state.controls = controls;
      renderScene();
      if (restorePending) restoreAiOperation();
      root.querySelector("[data-story-scene-focus]")?.focus({ preventScroll: true });
    } catch (error) {
      if (!current()) return;
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
    const reading = readableBeats();
    if (!reading || reading.index !== reading.beats.length - 1 || state.sceneIdentity !== readerIdentity()) return;
    if (state.busy || aiRequestOpen() || state.resetPreview || state.progress?.status !== "active" || !choiceId || !state.scene?.id || !Number.isInteger(state.progress?.revision) || state.choices.length > 3 || !state.choices.some((choice) => (choice.id || choice.choiceId) === choiceId)) return;
    const epoch = state.epoch;
    const sessionId = state.sessionId;
    const revision = state.progress.revision;
    const pending = {
      version: 1,
      workId: state.workId || "",
      progressId: sessionId,
      choiceId,
      revision,
      locale: state.locale,
      idempotencyKey: requestId("story-choice"),
      continuationId: null,
      status: "requesting",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (!saveAiOperation(pending)) {
      actionStatus(tr("choiceFailed"));
      return;
    }
    state.aiNotice = null;
    const operation = beginOperation();
    actionStatus(tr("choosing"));
    try {
      const payload = await request(`${progressPath(`/choices/${encodeURIComponent(choiceId)}`)}?locale=${encodeURIComponent(state.locale)}`, {
        method: "POST",
        auth: true,
        headers: { "Idempotency-Key": pending.idempotencyKey },
        body: { expectedRevision: revision },
      });
      if (!currentRequest(epoch, sessionId)) return;
      if (payload?.continuationId) {
        await handleAiReceipt(payload, pending);
      } else {
        removeAiOperation(pending);
        state.minimumRevision = Math.max(revision + 1, Number.isInteger(payload?.revision) ? payload.revision : 0);
        await loadScene({ restorePending: false });
      }
    } catch (error) {
      if (!currentRequest(epoch, sessionId)) return;
      if (keepSharedPending(error, pending)) return;
      const unavailable = aiUnavailableKind(error);
      if (unavailable) {
        removeAiOperation(pending);
        await refreshSceneAfterAi(unavailable, pending);
      } else if (errorCode(error) === "STORY_SUGGESTED_CHOICE_LIMIT_EXCEEDED") {
        removeAiOperation(pending);
        blockScene(controlTr("sceneUnavailable"));
      } else if (error?.status === 401 || error?.status === 403) {
        removeAiOperation(pending);
        blockScene(errorCopy(error));
      } else if (error?.status >= 400 && error?.status < 500) {
        removeAiOperation(pending);
        await loadScene({ restorePending: false });
        actionStatus(errorCode(error) === "STORY_PROGRESS_STALE_REVISION" ? controlTr("progressChanged") : tr("choiceFailed"));
      } else {
        // The request may have committed. Keep its exact key and require explicit recovery.
        await loadScene({ restorePending: false });
        if (state.sessionId !== sessionId) return;
        if (state.progress?.revision > revision && state.progress?.status !== "ai_pending") {
          removeAiOperation(pending);
          state.aiNotice = null;
          renderScene();
        } else {
          setAiNotice("lost", pending);
        }
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
    if (!reset || state.busy || aiRequestOpen() || state.resetPreview || !["full", "act"].includes(target) || !(target === "full" ? reset.canFullReset : reset.canActReset)) return;
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
    if (event.target.closest("[data-story-purchase]")) {
      if (detailAction() !== "purchase" || !purchaseQuote(state.readerAccess?.access?.purchaseConfirmation) || pendingPurchase()) return;
      state.purchaseConfirming = true;
      state.purchaseNotice = "";
      return renderPack();
    }
    if (event.target.closest("[data-story-purchase-cancel]")) { state.purchaseConfirming = false; return renderPack(); }
    if (event.target.closest("[data-story-purchase-confirm]")) return purchaseStory();
    if (event.target.closest("[data-story-purchase-retry]")) return purchaseStory(true);
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
    const beatButton = event.target.closest("[data-story-beat]");
    if (beatButton) return turnBeat(beatButton.dataset.storyBeat === "previous" ? -1 : 1);
    if (event.target.closest("[data-story-ai-recover]")) return recoverAiOperation();
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
    if (state.beatOperation) {
      cancelBeatNavigation();
      state.localeDirty = false;
      return loadScene();
    }
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
    cancelAiPolling();
    cancelBeatNavigation();
    if (state.sessionId) {
      ++state.epoch;
      state.aiNotice = null;
      return blockScene(tr("loginRequired"));
    }
    if (!state.detailSlug) return;
    ++state.epoch;
    state.readerAccess = null;
    state.readerState = null;
    state.purchaseConfirming = false;
    state.purchaseNotice = "";
    state.detailStatus = "access-error";
    state.detailError = tr("loginRequired");
    renderPack();
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== "lumina_auth" && event.key !== null) return;
    if (state.sessionId) {
      cancelBeatNavigation();
      cancelAiPolling();
      ++state.epoch;
      ++state.operation;
      setBusy(false);
      state.minimumRevision = 0;
      state.aiNotice = null;
      state.progress = null;
      state.completedBeat = null;
      state.readingScroll = null;
      blockScene(tr("loginRequired"));
      if (signedIn()) return loadScene();
      return;
    }
    if (state.detailSlug) loadPack(state.detailSlug);
  });

  window.addEventListener("popstate", () => {
    if (state.dialog) dismissPack();
    cancelBeatNavigation();
    cancelAiPolling();
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
    state.aiNotice = null;
    state.localeDirty = false;
    if (state.sessionId) return loadScene();
    if (state.graphWorkId) return loadGraph();
    if (!root.querySelector("[data-story-catalog-view]") || state.catalogLocale !== state.locale) loadCatalog();
    const slug = params.get("slug") || params.get("pack");
    if (slug) return openPack(slug, null, false);
  });

  window.addEventListener("pagehide", cancelAiPolling);
  window.addEventListener("pagehide", cancelBeatNavigation);

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
