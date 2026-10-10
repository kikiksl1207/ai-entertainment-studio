(function initWriterAnalysis() {
  "use strict";
  const api = window.LuminaCreatorStudioApi;
  const manuscript = window.LuminaCreatorManuscript;
  const panel = document.getElementById("writerAnalysis");
  if (!api || !manuscript || !panel) return;
  const root = "/api/v1/me/creator-studio";
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const languageNames = { ko: "한국어", en: "English", ja: "日本語", "zh-Hans": "简体中文", "zh-Hant": "繁體中文" };
  const el = Object.fromEntries(["Version", "State", "Progress", "Counts", "Start", "Check", "Recover", "RecoverState", "Boundary", "Views", "Semantic", "Structural", "Empty", "Evidence", "Pages", "Previous", "Next", "PageCount"].map(name => [name, document.getElementById("writerAnalysis" + name)]));
  const generation = {
    entry: document.getElementById("writerGenerationEntry"),
    open: document.getElementById("writerGenerationReviewOpen"),
    entryState: document.getElementById("writerGenerationReviewState"),
    modal: document.getElementById("writerGenerationModal"),
    eyebrow: document.getElementById("writerGenerationEyebrow"),
    title: document.getElementById("writerGenerationTitle"),
    intro: document.getElementById("writerGenerationIntro"),
    status: document.getElementById("writerGenerationStatus"),
    sections: document.getElementById("writerGenerationSections"),
    close: document.getElementById("writerGenerationClose"),
    cancel: document.getElementById("writerGenerationCancel"),
    save: document.getElementById("writerGenerationSave"),
    approve: document.getElementById("writerGenerationApprove")
  };
  const restore = {
    button: document.getElementById("writerAnalysisRestore"),
    state: document.getElementById("writerAnalysisRestoreState")
  };
  const generationSectionOrder = ["writing_style", "scene_scale", "canon", "timeline", "narrative_devices", "branch_behavior", "visual_direction", "visual_cast"];
  const generationOptional = new Set(["narrative_devices", "visual_direction", "visual_cast"]);
  let visualValidationId = 0;
  const generationCopy = {
    ko: {
      eyebrow: "AI 분석 결과", title: "스토리 생성 설정 검토", intro: "원고 전체에서 찾은 기준입니다. 각 항목을 확인하거나 필요한 부분만 고쳐주세요.",
      close: "닫기", later: "나중에", save: "임시 저장", approve: "확인 후 적용", open: "생성 설정 검토",
      loading: "원고 분석 결과를 생성 설정으로 정리하고 있습니다.", ready: "생성 전에 확인할 설정이 준비되었습니다.", approved: "이 원고의 생성 설정이 적용되었습니다.",
      saved: "수정 내용이 저장되었습니다.", saveFailed: "설정을 저장하지 못했습니다. 다시 시도해주세요.", approveFailed: "모든 필수 항목을 확인한 뒤 적용해주세요.",
      discardedCount: "확인 불가 분석 {count}건 제외",
      restore: "저장된 분석 보기", restoreLoading: "기존 분석을 확인하고 있습니다.",
      restoreMissing: "이 작품에 저장된 원고가 없습니다.", restoreFailed: "기존 분석을 불러오지 못했습니다. 다시 시도해 주세요.",
      recover: "생성 설정 복구", recoverReady: "완료된 분석 근거로 생성 설정 초안만 다시 정리합니다. 원고 AI를 다시 요청하거나 자동 승인하지 않습니다.",
      recoverLoading: "완료된 분석 근거에서 생성 설정 초안을 복구하고 있습니다. 자동으로 적용되지 않습니다.",
      recoverCompleted: "생성 설정 초안을 복구했습니다. 검토 후 직접 적용해 주세요.",
      recoverFailed: "생성 설정 초안을 복구하지 못했습니다. 상태를 다시 확인한 뒤 복구 버튼으로 재시도해 주세요.",
      recoverUnknown: "복구 완료 여부를 확인하지 못했습니다. 상태를 다시 확인해 주세요. 복구는 버튼을 눌렀을 때만 재시도합니다.",
      accept: "맞음", edit: "수정해서 사용", remove: "이 항목 제외", evidence: "판단 근거 보기", noEvidence: "직접 확인이 필요한 기본 기준입니다.",
      era: "시대와 배경", artStyle: "그림 스타일", palette: "색상 기준", prohibited: "피해야 할 시각 요소", character: "등장인물 {number}", characterName: "이름", appearance: "외형", addCharacter: "등장인물 추가", removeCharacter: "등장인물 삭제", emptyCast: "등록된 등장인물이 없습니다.",
      visualTextLimit: "최대 {limit}자까지 입력할 수 있습니다.", prohibitedLimit: "피해야 할 요소는 최대 24줄, 각 줄 240자까지 입력할 수 있습니다.", castLimit: "등장인물은 최대 16명입니다. 초과한 인물을 삭제한 뒤 저장해 주세요.", visualInvalid: "표시된 시각 설정을 확인해 주세요. 입력 내용은 유지됩니다.",
      characterNameRequired: "등장인물 이름을 입력해 주세요.", appearanceRequired: "등장인물 외형을 입력해 주세요.", characterNameUnique: "등장인물마다 다른 이름을 입력해 주세요.", visualTextInvalid: "지원하지 않는 제어 문자를 삭제해 주세요.",
      writing_style: "작가 문체", scene_scale: "장면 분량", canon: "세계관과 고정 설정", timeline: "시간 흐름", narrative_devices: "복선과 회수", branch_behavior: "선택 후 전개", visual_direction: "배경과 그림 분위기", visual_cast: "등장인물 외형"
    },
    en: {
      eyebrow: "AI analysis", title: "Review story generation settings", intro: "These settings were derived from the complete manuscript. Confirm or edit each item.",
      close: "Close", later: "Later", save: "Save draft", approve: "Approve and apply", open: "Review generation settings",
      loading: "Preparing generation settings from the manuscript analysis.", ready: "Generation settings are ready for review.", approved: "Generation settings are active for this manuscript.",
      saved: "Your changes were saved.", saveFailed: "Settings could not be saved. Try again.", approveFailed: "Confirm every required item before applying.",
      discardedCount: "{count} unverifiable findings excluded",
      restore: "View saved analysis", restoreLoading: "Checking the saved analysis.",
      restoreMissing: "No saved manuscript was found for this work.", restoreFailed: "Could not load the saved analysis. Try again.",
      recover: "Recover generation settings", recoverReady: "Rebuild only the settings draft from completed analysis. This does not request manuscript AI again or approve settings automatically.",
      recoverLoading: "Recovering the settings draft from completed analysis. Settings will not be applied automatically.",
      recoverCompleted: "The settings draft was recovered. Review it before applying.",
      recoverFailed: "Could not recover the settings draft. Check the status, then use the recovery button to try again.",
      recoverUnknown: "Recovery could not be confirmed. Check the status again. Recovery is retried only when you press the recovery button.",
      accept: "Confirm", edit: "Use my edit", remove: "Exclude item", evidence: "View supporting analysis", noEvidence: "This default needs your confirmation.",
      era: "Era and setting", artStyle: "Art style", palette: "Color palette", prohibited: "Prohibited visual elements", character: "Character {number}", characterName: "Name", appearance: "Appearance", addCharacter: "Add character", removeCharacter: "Remove character", emptyCast: "No characters added.",
      visualTextLimit: "Maximum {limit} characters.", prohibitedLimit: "Use at most 24 lines of prohibited elements, with at most 240 characters per line.", castLimit: "The cast limit is 16. Remove extra characters before saving.", visualInvalid: "Check the highlighted visual fields. Your entries have been retained.",
      characterNameRequired: "Enter a character name.", appearanceRequired: "Enter this character's appearance.", characterNameUnique: "Each character needs a unique name.", visualTextInvalid: "Remove unsupported control characters.",
      writing_style: "Writing style", scene_scale: "Scene length", canon: "Canon and world rules", timeline: "Timeline", narrative_devices: "Foreshadowing and payoff", branch_behavior: "Branch behavior", visual_direction: "Background and visual mood", visual_cast: "Character appearance"
    },
    ja: {
      eyebrow: "AI分析結果", title: "ストーリー生成設定の確認", intro: "原稿全体から抽出した基準です。各項目を確認または修正してください。",
      close: "閉じる", later: "あとで", save: "下書き保存", approve: "確認して適用", open: "生成設定を確認",
      loading: "原稿分析から生成設定を整理しています。", ready: "生成前に確認する設定が準備できました。", approved: "この原稿の生成設定を適用しました。",
      saved: "修正内容を保存しました。", saveFailed: "設定を保存できませんでした。もう一度お試しください。", approveFailed: "必須項目をすべて確認してから適用してください。",
      discardedCount: "確認できない分析 {count} 件を除外",
      restore: "保存済みの分析を見る", restoreLoading: "保存済みの分析を確認しています。",
      restoreMissing: "この作品に保存済みの原稿はありません。", restoreFailed: "保存済みの分析を読み込めませんでした。もう一度お試しください。",
      recover: "生成設定を復旧", recoverReady: "完了した分析の根拠から設定の下書きだけを整理し直します。原稿AIへの再依頼や自動承認は行いません。",
      recoverLoading: "完了した分析の根拠から設定の下書きを復旧しています。自動適用は行いません。",
      recoverCompleted: "設定の下書きを復旧しました。確認してから適用してください。",
      recoverFailed: "設定の下書きを復旧できませんでした。状態を再確認し、復旧ボタンで再試行してください。",
      recoverUnknown: "復旧の完了を確認できませんでした。状態を再確認してください。復旧はボタンを押した場合のみ再試行します。",
      accept: "正しい", edit: "修正して使用", remove: "この項目を除外", evidence: "判断根拠を見る", noEvidence: "確認が必要な基本設定です。",
      era: "時代と舞台", artStyle: "画風", palette: "配色", prohibited: "避ける視覚要素", character: "登場人物 {number}", characterName: "名前", appearance: "外見", addCharacter: "登場人物を追加", removeCharacter: "登場人物を削除", emptyCast: "登場人物は登録されていません。",
      visualTextLimit: "最大{limit}文字です。", prohibitedLimit: "避ける要素は最大24行、各行240文字までです。", castLimit: "登場人物は最大16人です。超過分を削除してから保存してください。", visualInvalid: "表示された視覚設定を確認してください。入力内容は保持されています。",
      characterNameRequired: "登場人物の名前を入力してください。", appearanceRequired: "登場人物の外見を入力してください。", characterNameUnique: "登場人物ごとに異なる名前を入力してください。", visualTextInvalid: "対応していない制御文字を削除してください。",
      writing_style: "作家の文体", scene_scale: "場面の分量", canon: "世界観と固定設定", timeline: "時間の流れ", narrative_devices: "伏線と回収", branch_behavior: "選択後の展開", visual_direction: "背景と画面の雰囲気", visual_cast: "登場人物の外見"
    },
    "zh-Hans": {
      eyebrow: "AI 分析结果", title: "核对故事生成设置", intro: "这些标准来自完整稿件。请逐项确认或修改。",
      close: "关闭", later: "稍后", save: "保存草稿", approve: "确认并应用", open: "核对生成设置",
      loading: "正在根据稿件分析整理生成设置。", ready: "生成设置已准备好，等待核对。", approved: "已应用此稿件的生成设置。",
      saved: "修改内容已保存。", saveFailed: "无法保存设置，请重试。", approveFailed: "请确认所有必填项后再应用。",
      discardedCount: "已排除 {count} 条无法核实的分析",
      restore: "查看已保存的分析", restoreLoading: "正在检查已保存的分析。",
      restoreMissing: "未找到此作品已保存的稿件。", restoreFailed: "无法加载已保存的分析，请重试。",
      recover: "恢复生成设置", recoverReady: "仅根据已完成的分析依据重新整理设置草稿，不会再次请求稿件 AI，也不会自动批准。",
      recoverLoading: "正在根据已完成的分析依据恢复设置草稿，不会自动应用。",
      recoverCompleted: "设置草稿已恢复，请核对后再应用。",
      recoverFailed: "无法恢复设置草稿。请重新检查状态，再使用恢复按钮重试。",
      recoverUnknown: "无法确认恢复是否完成。请重新检查状态。只有点击恢复按钮才会重试恢复。",
      accept: "正确", edit: "修改后使用", remove: "排除此项", evidence: "查看判断依据", noEvidence: "这是需要确认的默认标准。",
      era: "时代与背景", artStyle: "画风", palette: "配色", prohibited: "禁止的视觉元素", character: "人物 {number}", characterName: "姓名", appearance: "外观", addCharacter: "添加人物", removeCharacter: "删除人物", emptyCast: "尚未添加人物。",
      visualTextLimit: "最多 {limit} 个字符。", prohibitedLimit: "禁止元素最多 24 行，每行最多 240 个字符。", castLimit: "最多 16 位人物，请删除多余人物后保存。", visualInvalid: "请检查标出的视觉设置，已保留输入内容。",
      characterNameRequired: "请输入人物姓名。", appearanceRequired: "请输入人物外观。", characterNameUnique: "每位人物的姓名必须不同。", visualTextInvalid: "请删除不支持的控制字符。",
      writing_style: "作者文风", scene_scale: "场景篇幅", canon: "世界观与固定设定", timeline: "时间线", narrative_devices: "伏笔与回收", branch_behavior: "选择后的发展", visual_direction: "背景与画面氛围", visual_cast: "人物外观"
    },
    "zh-Hant": {
      eyebrow: "AI 分析結果", title: "核對故事生成設定", intro: "這些標準來自完整稿件。請逐項確認或修改。",
      close: "關閉", later: "稍後", save: "儲存草稿", approve: "確認並套用", open: "核對生成設定",
      loading: "正在根據稿件分析整理生成設定。", ready: "生成設定已準備好，等待核對。", approved: "已套用此稿件的生成設定。",
      saved: "修改內容已儲存。", saveFailed: "無法儲存設定，請重試。", approveFailed: "請確認所有必填項後再套用。",
      discardedCount: "已排除 {count} 條無法核實的分析",
      restore: "查看已儲存的分析", restoreLoading: "正在檢查已儲存的分析。",
      restoreMissing: "找不到此作品已儲存的稿件。", restoreFailed: "無法載入已儲存的分析，請重試。",
      recover: "復原生成設定", recoverReady: "僅根據已完成的分析依據重新整理設定草稿，不會再次請求稿件 AI，也不會自動核准。",
      recoverLoading: "正在根據已完成的分析依據復原設定草稿，不會自動套用。",
      recoverCompleted: "設定草稿已復原，請核對後再套用。",
      recoverFailed: "無法復原設定草稿。請重新檢查狀態，再使用復原按鈕重試。",
      recoverUnknown: "無法確認復原是否完成。請重新檢查狀態。只有點擊復原按鈕才會重試復原。",
      accept: "正確", edit: "修改後使用", remove: "排除此項", evidence: "查看判斷依據", noEvidence: "這是需要確認的預設標準。",
      era: "時代與背景", artStyle: "畫風", palette: "配色", prohibited: "禁止的視覺元素", character: "人物 {number}", characterName: "姓名", appearance: "外觀", addCharacter: "新增人物", removeCharacter: "刪除人物", emptyCast: "尚未新增人物。",
      visualTextLimit: "最多 {limit} 個字元。", prohibitedLimit: "禁止元素最多 24 行，每行最多 240 個字元。", castLimit: "最多 16 位人物，請刪除多餘人物後儲存。", visualInvalid: "請檢查標出的視覺設定，已保留輸入內容。",
      characterNameRequired: "請輸入人物姓名。", appearanceRequired: "請輸入人物外觀。", characterNameUnique: "每位人物的姓名必須不同。", visualTextInvalid: "請刪除不支援的控制字元。",
      writing_style: "作者文風", scene_scale: "場景篇幅", canon: "世界觀與固定設定", timeline: "時間線", narrative_devices: "伏筆與回收", branch_behavior: "選擇後的發展", visual_direction: "背景與畫面氛圍", visual_cast: "人物外觀"
    }
  };
  let scope = null;
  let receipt = null;
  let job = null;
  let requestKey = null;
  let analysisId = null;
  let epoch = 0;
  let busy = false;
  let starting = false;
  let recovering = false;
  let recoveryState = null;
  let phase = "ready";
  let page = emptyPage();
  let evidenceView = "semantic";
  let history = [];
  let poll = null;
  let pollDelay = 2500;
  let renderedIds = [];
  let renderedCursor;
  let renderedEpoch = -1;
  let generationResponse = null;
  let generationBusy = false;
  let generationReadEpoch = null;
  let generationLoadedFor = null;
  let restoring = false;
  const controllers = new Set();

  function t(key, values = {}) {
    const value = window.luminaI18n.t("writerAnalysis." + key);
    return value.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  }
  function gt(key, values = {}) {
    const language = window.luminaI18n?.getLocale?.() || "ko";
    const locale = { "ko-KR": "ko", "en-US": "en", "ja-JP": "ja", "zh-CN": "zh-Hans", "zh-TW": "zh-Hant" }[language] || language;
    return (generationCopy[locale]?.[key] || generationCopy.ko[key] || key)
      .replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  }
  function emptyPage() { return { cursor: null, start: 0, rows: [], endCursor: null, hasMore: false, nextCursor: null, totalCount: 0 }; }
  function context() { return { ...manuscript.context(), identity: api.identity() }; }
  function sameContext(left, right) {
    return Boolean(left && right && left.workId === right.workId && left.sourceLocale === right.sourceLocale &&
      left.identity.ownerId === right.identity.ownerId && left.identity.epoch === right.identity.epoch);
  }
  function current(stamp = epoch) {
    if (stamp !== epoch || !scope) return false;
    if (!api.isCurrent(scope.identity) || !sameContext(scope, context())) { invalidate(); return false; }
    return true;
  }
  function stopRequests() {
    epoch++;
    if (generationReadEpoch !== null) {
      generationReadEpoch = null;
      generationBusy = false;
    }
    controllers.forEach(controller => controller.abort());
    controllers.clear();
    clearTimeout(poll);
    poll = null;
    busy = false;
    recovering = false;
  }
  function invalidate() {
    stopRequests();
    scope = null; receipt = null; job = null; analysisId = null; requestKey = null;
    starting = false; page = emptyPage(); history = []; evidenceView = "semantic";
    recoveryState = null; el.Recover.hidden = true; el.RecoverState.hidden = true; el.RecoverState.textContent = "";
    panel.hidden = true;
    el.Evidence.replaceChildren();
    el.State.textContent = ""; el.Counts.textContent = ""; el.Version.textContent = "";
    generationResponse = null; generationBusy = false; generationLoadedFor = null;
    generation.entry.hidden = true; generation.sections.replaceChildren();
    closeGenerationModal();
    renderRestore();
  }
  function renderRestore() {
    if (!restore.button) return;
    restore.button.hidden = Boolean(receipt) || !uuid.test(scope?.workId || "") ||
      Boolean(document.getElementById("writerManuscriptBody")?.value);
    restore.button.disabled = restoring;
    restore.button.textContent = gt("restore");
  }
  function receiptKey() { return `lumina.writer.analysis:${scope.identity.ownerId}:${receipt.id}`; }
  function pointerKey() { return `lumina.writer.resume:${scope.identity.ownerId}:${scope.workId}:${scope.sourceLocale}`; }
  function remember() {
    // Store only scoped identifiers and the original request key, never source, quotes, or evidence.
    try {
      sessionStorage.setItem(receiptKey(), JSON.stringify({ requestKey, analysisId }));
      sessionStorage.setItem(pointerKey(), JSON.stringify({ manuscriptId: receipt.id }));
      return true;
    } catch (_) { return false; }
  }
  function savedRequest() {
    try {
      const value = JSON.parse(sessionStorage.getItem(receiptKey()) || "null");
      const validKey = /^[A-Za-z0-9_-]{8,200}$/.test(value?.requestKey || "");
      if ((validKey || uuid.test(value?.analysisId || "")) && (!value.analysisId || uuid.test(value.analysisId))) return value;
    } catch (_) {}
    return null;
  }
  function receive(value, { fromSubmit = false, existingAnalysisId = null } = {}) {
    if (receipt?.id === value?.id && value.workId === scope?.workId &&
        value.sourceLocale === scope?.sourceLocale && api.isCurrent(value.identity) &&
        sameContext(scope, context()) && api.isCurrent(scope.identity) && (!existingAnalysisId || analysisId === existingAnalysisId)) {
      if (fromSubmit) start();
      return;
    }
    invalidate();
    scope = context();
    if (!scope.identity.ownerId || !uuid.test(value?.id || "") || value.workId !== scope.workId ||
        value.sourceLocale !== scope.sourceLocale || !api.isCurrent(value.identity)) return invalidate();
    receipt = { ...value };
    const saved = savedRequest();
    requestKey = saved?.requestKey || null;
    analysisId = existingAnalysisId || saved?.analysisId || null;
    phase = analysisId ? "loading" : requestKey ? "unknown" : "ready";
    restore.state.textContent = "";
    renderRestore();
    render();
    if (analysisId) loadPage(null, 0);
    else if (fromSubmit) start();
  }
  function contextChanged() {
    const next = context();
    if (sameContext(scope, next)) return;
    invalidate();
    restore.state.textContent = "";
    if (!next.identity.ownerId || !uuid.test(next.workId) || !locales.includes(next.sourceLocale)) return;
    const retained = manuscript.receipt();
    if (retained?.workId === next.workId && retained.sourceLocale === next.sourceLocale && api.isCurrent(retained.identity)) return receive(retained);
    if (document.getElementById("writerManuscriptBody")?.value) return;
    scope = next;
    renderRestore();
    try {
      const pointer = JSON.parse(sessionStorage.getItem(pointerKey()) || "null");
      if (!uuid.test(pointer?.manuscriptId || "")) return;
      receive({ id: pointer.manuscriptId, workId: next.workId, sourceLocale: next.sourceLocale, identity: next.identity });
    } catch (_) {}
  }
  async function restoreExisting() {
    if (restoring || receipt || !scope || !current() || document.getElementById("writerManuscriptBody")?.value) return;
    const stamp = epoch;
    restoring = true;
    restore.state.textContent = gt("restoreLoading");
    renderRestore();
    try {
      const sourcePage = await request(`/stories/${scope.workId}/manuscripts?limit=1`, {}, stamp);
      if (sourcePage?.workId !== scope.workId || !Array.isArray(sourcePage.items) || sourcePage.items.length > 1) throw new Error("source projection");
      const source = sourcePage.items[0];
      if (!source || source.locale !== scope.sourceLocale) { restore.state.textContent = gt("restoreMissing"); return; }
      if (!uuid.test(source.id) || source.workId !== scope.workId || !Number.isSafeInteger(source.version) || source.version < 1 ||
          !/^[a-f0-9]{64}$/i.test(source.contentHash || "")) throw new Error("source projection");
      const analysisPage = await request(`/manuscripts/${source.id}/analyses?limit=30`, {}, stamp);
      if (analysisPage?.manuscriptVersionId !== source.id || !Array.isArray(analysisPage.items) || analysisPage.items.length > 30) throw new Error("analysis projection");
      const latest = analysisPage.items.find(item => item?.kind === "semantic_extraction_v1" &&
        ["queued", "running", "completed", "failed"].includes(item.status) && item.sourceLocale === source.locale &&
        item.sourceContentHash === source.contentHash && uuid.test(item.id || ""));
      receive({ id: source.id, workId: source.workId, sourceLocale: source.locale, version: source.version,
        contentHash: source.contentHash, identity: scope.identity }, latest
        ? { existingAnalysisId: latest.id }
        : {});
    } catch (_) { if (current(stamp)) restore.state.textContent = gt("restoreFailed"); }
    finally { restoring = false; renderRestore(); }
  }
  async function request(path, options = {}, stamp = epoch) {
    if (!current(stamp)) throw new Error("stale");
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await api.fetch(root + path, { ...options, signal: controller.signal, identity: scope.identity });
      const data = await response.json().catch(() => null);
      if (!current(stamp)) throw new Error("stale");
      if (!response.ok) throw Object.assign(new Error("request"), { status: response.status, code: data?.error?.code || data?.code || "" });
      return data;
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  function validJob(value) {
    const semantic = value?.kind === "semantic_extraction_v1";
    return value && uuid.test(value.id) && value.manuscriptVersionId === receipt.id &&
      (!analysisId || value.id === analysisId) && ["queued", "running", "completed", "failed"].includes(value.status) &&
      (semantic ? value.sourceLocale === scope.sourceLocale && /^[0-9a-f]{64}$/i.test(value.sourceContentHash || "") &&
        (!receipt.contentHash || value.sourceContentHash === receipt.contentHash) : value.kind === "structural_legacy") &&
      Number.isSafeInteger(value.evidenceCount) && value.evidenceCount >= 0;
  }
  function acceptJob(value) {
    if (!validJob(value)) throw new Error("projection");
    job = value; analysisId = value.id; remember();
    if (value.kind !== "semantic_extraction_v1") { phase = "structural"; evidenceView = "structural"; }
    else if (value.status === "completed") phase = value.semanticCompleted && value.progress?.coverageComplete ? "completed" : "incomplete";
    else if (value.status === "failed") phase = value.budget?.usageUnobserved ? "failedUnknown" : "failed";
    else phase = value.status === "queued" ? "queued" : ["planning", "extracting", "finalizing"].includes(value.phase) ? value.phase : "queued";
    if (recoveryState && !recovering && phase === "completed") recoveryState = "recoverCompleted";
  }
  function canRecoverProfile() {
    const progress = job?.progress;
    return Boolean(job && validJob(job) && job.kind === "semantic_extraction_v1" && job.status === "failed" &&
      job.profileRecovery?.available === true && job.profileRecovery.mode === "local_settings_only" &&
      job.budget?.usageUnobserved !== true && job.errorCode !== "provider_outcome_unknown" &&
      Number.isSafeInteger(progress?.totalParagraphs) && progress.totalParagraphs > 0 &&
      progress.plannedParagraphs === progress.totalParagraphs && progress.completedParagraphs === progress.totalParagraphs &&
      Number.isSafeInteger(progress.plannedChunks) && progress.plannedChunks > 0 && progress.completedChunks === progress.plannedChunks);
  }
  async function recoverProfile() {
    if (busy || recovering || generationBusy || !current() || !canRecoverProfile()) return;
    clearTimeout(poll);
    const stamp = epoch;
    const expectedSourceContentHash = job.sourceContentHash;
    busy = true; recovering = true; recoveryState = "recoverLoading"; render();
    try {
      const value = await request(`/analyses/${analysisId}/recover-profile`, {
        method: "POST", body: { expectedSourceContentHash }
      }, stamp);
      // A nonterminal or unbound reply must never resume analysis polling or dispatch.
      if (!validJob(value) || value.kind !== "semantic_extraction_v1" || value.sourceContentHash !== expectedSourceContentHash ||
          !["completed", "failed"].includes(value.status) || typeof value.profileRecovery?.available !== "boolean" ||
          value.profileRecovery.mode !== "local_settings_only" ||
          (value.status === "completed" && (value.semanticCompleted !== true || value.progress?.coverageComplete !== true ||
            value.profileRecovery.available || value.budget?.usageUnobserved === true || value.errorCode === "provider_outcome_unknown"))) throw new Error("recovery projection");
      acceptJob(value);
      recoveryState = value.status === "completed" ? "recoverCompleted" : "recoverFailed";
      if (phase === "completed" && current(stamp)) {
        generationResponse = null; generationLoadedFor = null;
        evidenceView = "semantic"; history = [];
        busy = false;
        await loadPage(null, 0);
      }
    } catch (error) {
      if (current(stamp)) {
        if ([401, 403, 404].includes(error.status)) { invalidate(); return; }
        recoveryState = error.status && error.status < 500 ? "recoverFailed" : "recoverUnknown";
      }
    } finally {
      if (current(stamp)) { busy = false; recovering = false; render(); }
    }
  }
  function handleError(error, isStart = false) {
    if ([401, 403, 404].includes(error.status)) { invalidate(); return; }
    if (isStart && error.code === "ANALYSIS_VERSION_ALREADY_RESERVED") phase = "reserved";
    else if (isStart && error.code === "SEMANTIC_ANALYSIS_UNAVAILABLE") phase = "unavailable";
    else phase = isStart ? "unknown" : "loadFailed";
    render();
  }
  async function start() {
    if (!receipt || analysisId || busy || phase === "reserved" || !current()) return;
    clearTimeout(poll);
    if (!requestKey) requestKey = crypto.randomUUID();
    if (!remember()) { phase = "storageUnavailable"; render(); return; }
    const stamp = epoch;
    busy = true; starting = true; phase = "starting"; render();
    try {
      acceptJob(await request(`/manuscripts/${receipt.id}/analyses`, { method: "POST", headers: { "Idempotency-Key": requestKey } }, stamp));
      if (current(stamp)) { busy = false; starting = false; await loadPage(null, 0); }
    } catch (error) { if (current(stamp)) handleError(error, true); }
    finally { if (current(stamp)) { busy = false; starting = false; render(); } }
  }
  function validEvidence(row) {
    if (!row || !uuid.test(row.id) || !["semantic_candidate", "structural_only", "structural_legacy"].includes(row.provenance)) return false;
    return row.provenance !== "semantic_candidate" || (row.interpretation === "model_inference" && row.factualTruthApproved === false &&
      row.sourceLocale === scope.sourceLocale && typeof row.title === "string" && row.title.length <= 120 &&
      typeof row.observation === "string" && row.observation.length <= 1200 && Array.isArray(row.citations) && row.citations.length > 0 && row.citations.length <= 4);
  }
  function validatePage(data, cursor) {
    if (!validJob(data?.job) || data.view !== evidenceView || !Number.isSafeInteger(data.totalCount) || data.totalCount < 0 ||
        !Array.isArray(data.evidence) || data.evidence.length > 100 ||
        !data.evidence.every(validEvidence) || new Set(data.evidence.map(row => row.id)).size !== data.evidence.length ||
        data.evidence.some(row => evidenceView === "semantic" ? row.provenance !== "semantic_candidate" : row.provenance === "semantic_candidate") ||
        typeof data.hasMore !== "boolean" || data.endCursor !== (data.evidence.at(-1)?.id || cursor) ||
        (data.hasMore ? !data.evidence.length || data.nextCursor !== data.endCursor : data.nextCursor !== null) ||
        data.evidence.some(row => row.id === cursor)) throw new Error("page");
    return data;
  }
  async function loadPage(cursor, startIndex, { append = false, pollOnly = false, navigation = null } = {}) {
    if (!analysisId || busy || !current()) return;
    clearTimeout(poll);
    const stamp = epoch;
    busy = true; renderControls();
    try {
      const query = "?" + new URLSearchParams({ view: evidenceView, ...(cursor ? { cursor } : {}) });
      const data = validatePage(await request(`/analyses/${analysisId}${query}`, {}, stamp), cursor);
      if (!current(stamp)) return;
      acceptJob(data.job);
      if (!pollOnly) {
        const rows = append ? [...page.rows, ...data.evidence] : data.evidence;
        if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("duplicate evidence");
        const visible = rows.slice(0, 100);
        const more = rows.length > 100 || data.hasMore;
        if (navigation === "next") history.push({ cursor: page.cursor, start: page.start });
        if (navigation === "previous") history.pop();
        page = { cursor: append ? page.cursor : cursor, start: startIndex, rows: visible, totalCount: data.totalCount,
          endCursor: visible.at(-1)?.id || cursor, hasMore: more, nextCursor: more ? visible.at(-1)?.id : null };
      }
      pollDelay = 2500;
      render();
    } catch (error) { if (current(stamp)) { pollDelay = Math.min(pollDelay * 2, 15000); handleError(error); } }
    finally { if (current(stamp)) { busy = false; renderControls(); schedulePoll(); } }
  }
  function schedulePoll() {
    clearTimeout(poll);
    if (!current() || document.hidden || !["queued", "running"].includes(job?.status) || busy || recovering) return;
    poll = setTimeout(() => loadPage(page.endCursor, page.start, { append: !page.hasMore, pollOnly: page.hasMore }), pollDelay);
  }
  function renderControls() {
    panel.hidden = !receipt;
    el.Start.hidden = Boolean(job) || !["ready", "unavailable", "storageUnavailable"].includes(phase);
    el.Start.disabled = busy;
    el.Check.hidden = !analysisId && phase !== "unknown";
    el.Check.disabled = busy;
    el.Check.textContent = t(analysisId ? "check" : "checkRequest");
    const recoverable = canRecoverProfile();
    el.Recover.hidden = !recoverable;
    el.Recover.disabled = busy || recovering || generationBusy;
    el.Recover.textContent = gt("recover");
    el.RecoverState.hidden = !recoverable && !recoveryState;
    el.RecoverState.textContent = el.RecoverState.hidden ? "" : gt(recoveryState || "recoverReady");
    el.RecoverState.classList.toggle("is-danger", ["recoverFailed", "recoverUnknown"].includes(recoveryState));
    el.Previous.disabled = busy || !history.length;
    el.Next.disabled = busy || !page.hasMore;
    el.Previous.title = t("previous"); el.Previous.setAttribute("aria-label", t("previous"));
    el.Next.title = t("next"); el.Next.setAttribute("aria-label", t("next"));
    el.Pages.setAttribute("aria-label", t("evidence"));
    el.Pages.hidden = !job || !page.rows.length;
    el.Views.hidden = !job || job.kind !== "semantic_extraction_v1";
    el.Semantic.disabled = busy; el.Structural.disabled = busy;
    el.Semantic.setAttribute("aria-pressed", String(evidenceView === "semantic"));
    el.Structural.setAttribute("aria-pressed", String(evidenceView === "structural"));
    el.Semantic.textContent = t("semanticView"); el.Structural.textContent = t("structuralView");
    el.Views.setAttribute("aria-label", t("views"));
  }
  function render() {
    if (!receipt) return;
    renderControls();
    el.Version.textContent = t(receipt.version ? "version" : "savedVersion", { version: receipt.version, language: languageNames[scope.sourceLocale] });
    el.State.textContent = t(phase);
    el.State.classList.toggle("is-danger", ["unknown", "failed", "failedUnknown", "unavailable", "loadFailed", "incomplete", "reserved", "storageUnavailable"].includes(phase));
    el.Boundary.hidden = !job;
    const counters = job?.progress;
    const total = counters?.totalParagraphs;
    const done = job?.phase === "planning" ? counters?.plannedParagraphs : counters?.completedParagraphs;
    el.Progress.hidden = !job || job.kind !== "semantic_extraction_v1";
    if (Number.isSafeInteger(total) && total > 0 && Number.isSafeInteger(done) && done >= 0 && done <= total) {
      el.Progress.max = total; el.Progress.value = done;
      const counts = t("counts", { done, total, evidence: job.evidenceCount });
      const discarded = Number.isSafeInteger(job.discardedEvidenceCount) && job.discardedEvidenceCount > 0
        ? gt("discardedCount", { count: job.discardedEvidenceCount }) : "";
      el.Counts.textContent = discarded ? `${counts} · ${discarded}` : counts;
    } else { el.Progress.removeAttribute("value"); el.Counts.textContent = ""; }
    el.Progress.setAttribute("aria-label", t("title"));
    generation.entry.hidden = phase !== "completed";
    generation.open.textContent = gt("open");
    if (phase === "completed" && generationLoadedFor !== analysisId && !generationBusy) {
      generationLoadedFor = analysisId;
      queueMicrotask(() => loadGenerationProfile(true));
    }
    el.PageCount.textContent = t("pageCount", { from: page.start + 1, to: page.start + page.rows.length, total: page.totalCount });
    el.Empty.hidden = !job || page.rows.length > 0 || !["completed", "structural"].includes(phase);
    el.Empty.textContent = !el.Empty.hidden ? t(evidenceView === "semantic" ? "semanticEmpty" : "structuralEmpty") : "";
    // Evidence is append-only on the server. Preserve open quotes and focus during status polling.
    if (renderedEpoch !== epoch || renderedCursor !== page.cursor || renderedIds.length > page.rows.length ||
        renderedIds.some((id, index) => id !== page.rows[index]?.id)) {
      el.Evidence.replaceChildren(); renderedIds = [];
    }
    el.Evidence.append(...page.rows.slice(renderedIds.length).map(evidenceElement));
    renderedIds = page.rows.map(row => row.id); renderedCursor = page.cursor; renderedEpoch = epoch;
  }
  function evidenceElement(row) {
    const item = document.createElement("article"); item.className = "writer-analysis-item";
    const heading = document.createElement("h3"); heading.textContent = row.title || t("structure");
    const text = document.createElement("p"); text.textContent = row.observation || t("structureNote");
    const provenance = document.createElement("p"); provenance.className = "writer-analysis-meta";
    provenance.textContent = t(row.provenance === "semantic_candidate" ? "inference" : "structure");
    item.append(heading, provenance, text);
    if (row.provenance === "semantic_candidate") {
      const button = document.createElement("button"); button.type = "button"; button.className = "secondary-action"; button.textContent = t("source");
      const quote = document.createElement("div"); quote.hidden = true;
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", () => {
        if (!quote.hidden && !quote.dataset.failed) { quote.replaceChildren(); quote.hidden = true; button.setAttribute("aria-expanded", "false"); return; }
        loadQuote(row, quote, button);
      });
      item.append(button, quote);
    }
    return item;
  }
  async function loadQuote(row, target, button) {
    if (!current() || button.disabled) return;
    const stamp = epoch;
    delete target.dataset.failed;
    button.disabled = true; target.hidden = false; target.textContent = t("loading"); button.setAttribute("aria-expanded", "true");
    try {
      const data = await request(`/analyses/${analysisId}/evidence/${row.id}/source`, {}, stamp);
      if (!current(stamp) || !target.isConnected) return;
      if (data?.evidenceId !== row.id || data.manuscriptVersionId !== receipt.id || data.sourceLocale !== scope.sourceLocale ||
          !Array.isArray(data.citations) || data.citations.length !== row.citations.length || !data.citations.length || data.citations.length > 4) throw new Error("citation");
      const fragments = data.citations.map((citation, index) => {
        const expected = row.citations[index];
        if (!["partIndex", "partKey", "paragraphIndex", "start", "end", "quoteHash"].every(key => citation[key] === expected[key]) ||
            !Number.isSafeInteger(citation.partIndex) || !Number.isSafeInteger(citation.paragraphIndex) ||
            citation.partIndex < 0 || citation.paragraphIndex < 0 || !Number.isSafeInteger(citation.start) ||
            !Number.isSafeInteger(citation.end) || citation.start < 0 || citation.end <= citation.start ||
            !/^[a-f0-9]{64}$/.test(citation.quoteHash) || typeof citation.quote !== "string" ||
            citation.quote.length !== citation.end - citation.start || citation.quote.length > 512) throw new Error("citation");
        const fragment = document.createElement("div");
        const label = document.createElement("p"); label.className = "writer-analysis-meta";
        label.textContent = t("location", { part: citation.partIndex + 1, paragraph: citation.paragraphIndex + 1 });
        const quote = document.createElement("blockquote"); quote.textContent = citation.quote;
        fragment.append(label, quote); return fragment;
      });
      target.replaceChildren(...fragments);
    } catch (error) {
      if (current(stamp) && target.isConnected) {
        if ([401, 403, 404].includes(error.status)) { invalidate(); return; }
        target.textContent = t("quoteFailed"); target.dataset.failed = "true";
      }
    }
    finally { if (current(stamp) && target.isConnected) button.disabled = false; }
  }

  function validGenerationResponse(value) {
    const profile = value?.profile;
    const settings = profile?.status === "approved" ? profile.approvedSettings : profile?.draftSettings;
    return value?.workId === scope?.workId && value?.analysis?.id === analysisId && profile &&
      /^[0-9a-f-]{36}$/i.test(profile.id || "") && /^[a-f0-9]{64}$/i.test(profile.sourceFingerprint || "") &&
      settings?.schemaVersion === "creator-generation-profile-v1" && settings?.kind === "story" &&
      Array.isArray(settings.sections) && settings.sections.length === generationSectionOrder.length &&
      generationSectionOrder.every(key => settings.sections.some(section => section?.key === key));
  }

  function setGenerationCopy() {
    generation.eyebrow.textContent = gt("eyebrow"); generation.title.textContent = gt("title");
    generation.intro.textContent = gt("intro"); generation.close.textContent = gt("close");
    generation.cancel.textContent = gt("later"); generation.save.textContent = gt("save");
    generation.approve.textContent = gt("approve"); generation.open.textContent = gt("open");
  }

  async function loadGenerationProfile(autoOpen) {
    if (!analysisId || phase !== "completed" || generationBusy || !current()) return;
    const stamp = epoch;
    generationReadEpoch = stamp;
    generationBusy = true; setGenerationCopy();
    generation.entryState.textContent = gt("loading");
    try {
      const value = await request(`/stories/${encodeURIComponent(scope.workId)}/generation-profile`, {}, stamp);
      if (!validGenerationResponse(value)) throw new Error("profile projection");
      generationResponse = value;
      generation.entryState.textContent = value.profile.status === "approved" ? gt("approved") : gt("ready");
      if (autoOpen && value.profile.status !== "approved") openGenerationModal();
      else if (!autoOpen) openGenerationModal();
    } catch (_) {
      if (current(stamp)) generation.entryState.textContent = gt("saveFailed");
    } finally {
      if (generationReadEpoch === stamp && current(stamp)) {
        generationReadEpoch = null;
        generationBusy = false;
      }
    }
  }

  function activeGenerationSettings() {
    const profile = generationResponse?.profile;
    return profile?.status === "approved" ? profile.approvedSettings : profile?.draftSettings;
  }

  function openGenerationModal() {
    if (!generationResponse) return;
    setGenerationCopy(); renderGenerationSections();
    generation.modal.classList.remove("is-hidden");
    document.body.style.overflow = "hidden";
    generation.close.focus();
  }

  function closeGenerationModal() {
    retainGenerationEdits();
    generation.modal?.classList.add("is-hidden");
    if (!document.querySelector(".studio-modal:not(.is-hidden)")) document.body.style.overflow = "";
  }

  function renderGenerationSections() {
    const settings = activeGenerationSettings();
    const approved = generationResponse.profile.status === "approved";
    generation.sections.replaceChildren(...generationSectionOrder.map(key => {
      const section = settings.sections.find(item => item.key === key);
      const article = document.createElement("article"); article.className = "writer-generation-section"; article.dataset.key = key;
      const header = document.createElement("header");
      const heading = document.createElement("h3"); heading.textContent = gt(key);
      const state = document.createElement("p"); state.textContent = section.decision === "proposed" ? gt("ready") : section.decision === "removed" ? gt("remove") : gt(section.decision === "edited" ? "edit" : "accept");
      header.append(heading, state);
      const textarea = document.createElement("textarea"); textarea.value = String(section.value?.summary || ""); textarea.maxLength = 8000; textarea.disabled = approved;
      textarea.className = "writer-generation-summary";
      textarea.addEventListener("input", () => selectGenerationDecision(article, section, "edited"));
      const controls = document.createElement("div"); controls.className = "writer-generation-decisions";
      controls.append(decisionButton(article, section, "accepted", "accept", approved), decisionButton(article, section, "edited", "edit", approved));
      if (generationOptional.has(key)) controls.append(decisionButton(article, section, "removed", "remove", approved));
      const details = document.createElement("details"); details.className = "writer-generation-evidence";
      const summary = document.createElement("summary"); summary.textContent = gt("evidence");
      const list = document.createElement("ul");
      const evidence = Array.isArray(section.evidence) ? section.evidence.slice(0, 20) : [];
      if (!evidence.length) { const item = document.createElement("li"); item.textContent = gt("noEvidence"); list.append(item); }
      else evidence.forEach(source => { const item = document.createElement("li"); item.textContent = source.summary || gt("noEvidence"); list.append(item); });
      details.append(summary, list); article.append(header, textarea);
      if (key === "visual_direction" && section.value?.visualBible && typeof section.value.visualBible === "object" && !Array.isArray(section.value.visualBible)) {
        article.append(visualDirectionControls(article, section, approved));
      }
      if (key === "visual_cast" && Array.isArray(section.value?.characters)) article.append(visualCastControls(article, section, approved));
      article.append(controls, details); return article;
    }));
    generation.sections.querySelectorAll(".writer-generation-section").forEach(validateVisualControls);
    generation.status.textContent = approved ? gt("approved") : gt("ready");
    generation.save.disabled = approved; generation.approve.disabled = approved;
  }

  function visualField(article, section, key, label, value, limit, approved) {
    const field = document.createElement("label"); field.className = "writer-generation-visual-field";
    const text = document.createElement("span"); text.textContent = gt(label);
    const input = document.createElement("textarea"); input.dataset.visualField = key;
    input.value = typeof value === "string" ? value : ""; input.maxLength = limit;
    input.rows = key === "name" ? 1 : 3; input.disabled = approved;
    const error = document.createElement("small"); error.className = "writer-generation-visual-error";
    error.id = `writerGenerationVisualError-${++visualValidationId}`; error.hidden = true; error.setAttribute("aria-live", "polite");
    input.setAttribute("aria-describedby", error.id);
    input.addEventListener("input", () => {
      selectGenerationDecision(article, section, "edited");
      validateVisualControls(article);
    });
    field.append(text, input, error); return field;
  }

  function visualDirectionControls(article, section, approved) {
    const fields = document.createElement("div"); fields.className = "writer-generation-visual-world";
    const bible = section.value.visualBible;
    for (const key of ["era", "artStyle", "palette"]) fields.append(visualField(article, section, key, key, bible[key], 800, approved));
    fields.append(visualField(article, section, "prohibited", "prohibited", Array.isArray(bible.prohibited) ? bible.prohibited.join("\n") : "", 5783, approved));
    return fields;
  }

  function visualIconButton(label, symbol, approved) {
    const button = document.createElement("button"); button.type = "button";
    button.className = "secondary-action writer-generation-visual-icon";
    button.textContent = symbol; button.title = gt(label); button.setAttribute("aria-label", gt(label)); button.disabled = approved;
    return button;
  }

  function visualCastControls(article, section, approved) {
    const cast = document.createElement("div"); cast.className = "writer-generation-visual-cast";
    const list = document.createElement("div"); list.className = "writer-generation-visual-cast-list";
    const status = document.createElement("p"); status.className = "writer-generation-visual-cast-status";
    status.setAttribute("role", "status");
    const add = visualIconButton("addCharacter", "+", approved);
    const update = () => {
      const rows = list.querySelectorAll(".writer-generation-visual-character");
      add.disabled = approved || rows.length >= 16;
      status.textContent = rows.length > 16 ? gt("castLimit") : rows.length ? `${rows.length}/16` : gt("emptyCast");
      rows.forEach((row, index) => { row.querySelector("h4").textContent = gt("character", { number: index + 1 }); });
    };
    const append = character => {
      const row = document.createElement("div"); row.className = "writer-generation-visual-character";
      const header = document.createElement("div"); header.className = "writer-generation-visual-character-heading";
      const heading = document.createElement("h4");
      const remove = visualIconButton("removeCharacter", "-", approved);
      remove.addEventListener("click", () => {
        if (approved) return;
        row.remove(); update(); selectGenerationDecision(article, section, "edited"); validateVisualControls(article); add.focus();
      });
      header.append(heading, remove);
      row.append(header, visualField(article, section, "name", "characterName", character.name, 120, approved),
        visualField(article, section, "appearance", "appearance", character.appearance, 600, approved));
      list.append(row); update(); return row;
    };
    // Keep every supplied row visible, including over-limit drafts that need correction.
    section.value.characters.forEach(character => append(character));
    add.addEventListener("click", () => {
      if (approved || list.children.length >= 16) return;
      const row = append({ name: "", appearance: "" });
      selectGenerationDecision(article, section, "edited"); validateVisualControls(article); row.querySelector("textarea").focus();
    });
    update(); cast.append(list, status, add); return cast;
  }

  function prohibitedLines(value) { return value.split(/\r\n|\r|\n/).filter(line => line.trim()); }

  function validateVisualControls(article) {
    let valid = true;
    const names = new Map();
    article.querySelectorAll('.writer-generation-visual-character [data-visual-field="name"]').forEach(input => {
      const name = input.value.trim(); if (name) names.set(name, (names.get(name) || 0) + 1);
    });
    article.querySelectorAll(".writer-generation-visual-field").forEach(field => {
      const input = field.querySelector("textarea"), error = field.querySelector(".writer-generation-visual-error");
      const lines = input.dataset.visualField === "prohibited" ? prohibitedLines(input.value) : null;
      let message = lines ? (lines.length > 24 || lines.some(line => line.length > 240) ? gt("prohibitedLimit") : "")
        : input.value.length > input.maxLength ? gt("visualTextLimit", { limit: input.maxLength }) : "";
      if (!message && input.value.includes("\0")) message = gt("visualTextInvalid");
      if (!message && ["name", "appearance"].includes(input.dataset.visualField) && !input.value.trim()) {
        message = gt(input.dataset.visualField === "name" ? "characterNameRequired" : "appearanceRequired");
      }
      if (!message && input.dataset.visualField === "name" && names.get(input.value.trim()) > 1) message = gt("characterNameUnique");
      input.setCustomValidity(message); input.setAttribute("aria-invalid", String(Boolean(message)));
      error.textContent = message; error.hidden = !message;
      if (message) valid = false;
    });
    return valid && article.querySelectorAll(".writer-generation-visual-character").length <= 16;
  }

  function retainGenerationEdits() {
    if (!generationResponse || generationResponse.profile.status === "approved" || generation.modal.classList.contains("is-hidden")) return;
    generationResponse.profile.draftSettings = collectGenerationSettings(false);
  }

  function decisionButton(article, section, decision, label, disabled) {
    const button = document.createElement("button"); button.type = "button"; button.className = "secondary-action";
    button.textContent = gt(label); button.disabled = disabled;
    button.classList.toggle("is-selected", section.decision === decision);
    button.addEventListener("click", () => {
      selectGenerationDecision(article, section, decision);
      if (decision === "edited") article.querySelector("textarea")?.focus();
    });
    return button;
  }

  function selectGenerationDecision(article, section, decision) {
    if (generationResponse?.profile?.status === "approved") return;
    section.decision = decision;
    article.querySelectorAll(".writer-generation-decisions button").forEach((button, index) => {
      const values = generationOptional.has(section.key) ? ["accepted", "edited", "removed"] : ["accepted", "edited"];
      button.classList.toggle("is-selected", values[index] === decision);
    });
    article.querySelector("header p").textContent = gt(decision === "removed" ? "remove" : decision === "edited" ? "edit" : "accept");
  }

  function collectGenerationSettings(validate = true) {
    const settings = structuredClone(activeGenerationSettings());
    let invalidArticle = null;
    for (const section of settings.sections) {
      const article = generation.sections.querySelector(`[data-key="${section.key}"]`);
      const live = activeGenerationSettings().sections.find(item => item.key === section.key);
      section.decision = live.decision;
      const summary = article?.querySelector(".writer-generation-summary")?.value.trim() || section.value.summary;
      if (section.decision === "edited" && summary !== section.value.summary) {
        section.value.observations = [];
        if (Array.isArray(section.value.categories)) section.value.categories = [];
      }
      section.value.summary = summary;
      if (!article) continue;
      if (validate && !validateVisualControls(article)) invalidArticle ||= article;
      const world = article.querySelector(".writer-generation-visual-world");
      if (world) {
        section.value.visualBible = { ...section.value.visualBible };
        world.querySelectorAll("textarea").forEach(input => {
          section.value.visualBible[input.dataset.visualField] = input.dataset.visualField === "prohibited" ? prohibitedLines(input.value) : input.value;
        });
        section.value.visualReviewVersion = "story-visual-review-v1";
      }
      const cast = article.querySelector(".writer-generation-visual-cast");
      if (cast) {
        section.value.characters = Array.from(cast.querySelectorAll(".writer-generation-visual-character"), row => {
          const fields = row.querySelectorAll("textarea");
          return { name: validate ? fields[0].value.trim() : fields[0].value,
            appearance: validate ? fields[1].value.trim() : fields[1].value };
        });
        section.value.visualReviewVersion = "story-visual-review-v1";
      }
    }
    if (invalidArticle) {
      const input = invalidArticle.querySelector('[aria-invalid="true"]');
      if (input) { input.scrollIntoView({ block: "center" }); input.focus(); input.reportValidity(); }
      else invalidArticle.querySelector(".writer-generation-visual-cast-status")?.scrollIntoView({ block: "nearest" });
      throw Object.assign(new Error("visual field limits"), { visualValidation: true });
    }
    return settings;
  }

  async function saveGenerationProfile(approve) {
    if (!generationResponse || generationBusy || generationResponse.profile.status === "approved" || !current()) return;
    const stamp = epoch; generationBusy = true;
    generation.save.disabled = true; generation.approve.disabled = true; generation.status.textContent = gt("loading");
    try {
      const saved = await request(`/stories/${encodeURIComponent(scope.workId)}/generation-profile`, {
        method: "PATCH", body: { settings: collectGenerationSettings() }
      }, stamp);
      if (!validGenerationResponse(saved)) throw new Error("profile projection");
      generationResponse = saved;
      if (approve) {
        const approved = await request(`/stories/${encodeURIComponent(scope.workId)}/generation-profile/approve`, {
          method: "POST", body: { expectedDraftFingerprint: saved.profile.draftFingerprint }
        }, stamp);
        if (!validGenerationResponse(approved) || approved.profile.status !== "approved") throw new Error("approval projection");
        generationResponse = approved; generation.entryState.textContent = gt("approved"); renderGenerationSections();
      } else {
        generation.status.textContent = gt("saved"); renderGenerationSections();
      }
    } catch (error) {
      if (current(stamp)) generation.status.textContent = error.visualValidation ? gt("visualInvalid") : approve ? gt("approveFailed") : gt("saveFailed");
    } finally {
      if (current(stamp)) {
        generationBusy = false;
        const approved = generationResponse?.profile?.status === "approved";
        generation.save.disabled = approved; generation.approve.disabled = approved;
      }
    }
  }

  el.Start.addEventListener("click", start);
  el.Recover.addEventListener("click", recoverProfile);
  el.Check.addEventListener("click", () => analysisId ? loadPage(page.cursor, page.start) : start());
  function changeEvidenceView(next) {
    if (!analysisId || busy || evidenceView === next) return;
    evidenceView = next; page = emptyPage(); history = []; render(); loadPage(null, 0);
  }
  el.Semantic.addEventListener("click", () => changeEvidenceView("semantic"));
  el.Structural.addEventListener("click", () => changeEvidenceView("structural"));
  el.Next.addEventListener("click", () => {
    if (busy || !page.hasMore || !page.nextCursor || history.some(item => item.cursor === page.nextCursor)) return;
    loadPage(page.nextCursor, page.start + page.rows.length, { navigation: "next" });
  });
  el.Previous.addEventListener("click", () => {
    if (busy || !history.length) return;
    const previous = history.at(-1); loadPage(previous.cursor, previous.start, { navigation: "previous" });
  });
  generation.open.addEventListener("click", () => generationResponse ? openGenerationModal() : loadGenerationProfile(false));
  restore.button?.addEventListener("click", restoreExisting);
  document.getElementById("writerManuscriptBody")?.addEventListener("input", renderRestore);
  generation.close.addEventListener("click", closeGenerationModal);
  generation.cancel.addEventListener("click", closeGenerationModal);
  generation.save.addEventListener("click", () => saveGenerationProfile(false));
  generation.approve.addEventListener("click", () => saveGenerationProfile(true));
  generation.modal.addEventListener("click", event => { if (event.target === generation.modal) closeGenerationModal(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !generation.modal.classList.contains("is-hidden")) closeGenerationModal(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(poll); else if (current()) schedulePoll(); });
  window.addEventListener("lumina:localechange", () => {
    if (!receipt) return;
    retainGenerationEdits();
    const wasStarting = starting;
    const wasRecovering = recovering;
    stopRequests(); starting = false;
    if (wasStarting) phase = "unknown";
    if (wasRecovering) recoveryState = "recoverUnknown";
    render();
    if (!generation.modal.classList.contains("is-hidden") && generationResponse) { setGenerationCopy(); renderGenerationSections(); }
    if (job) loadPage(page.cursor, page.start);
    renderRestore();
  });
  window.addEventListener("storage", event => { if (["lumina_auth", "lumina.session", null].includes(event.key)) current(); });
  window.addEventListener("lumina:auth-expired", invalidate);
  window.addEventListener("pagehide", invalidate);
  window.addEventListener("focus", () => current());
  setInterval(() => { if (scope) current(); }, 1000);
  window.LuminaCreatorAnalysis = { receive, invalidate, contextChanged,
    completed: () => phase === "completed" && job?.status === "completed" && receipt && current()
      ? { manuscriptVersionId: receipt.id, workId: scope.workId, analysisJobId: job.id,
        identity: scope.identity } : null };
  if (manuscript.receipt()) receive(manuscript.receipt()); else contextChanged();
})();
