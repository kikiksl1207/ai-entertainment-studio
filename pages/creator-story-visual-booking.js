(function () {
  "use strict";
  const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
  const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const nullableHash = value => value === null || hash(value);
  const sameId = (left, right) => uuid(left) && uuid(right) && left.toLowerCase() === right.toLowerCase();
  const sceneKey = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const copy = {
    ko: {
      title: "공개 작품 이미지 예약", catalog: "내 공개 작품 새로고침", target: "작품 / 공개본", choose: "작품 선택", load: "예약 확인",
      idle: "공개 작품을 선택한 뒤 예약을 확인해 주세요.", catalogLoading: "내 작품을 확인하고 있습니다.", loading: "예약을 확인하고 있습니다.",
      emptyCatalog: "현재 공개 중인 내 작품이 없습니다.", empty: "이 페이지에 예약이 없습니다.", ready: "예약을 확인했습니다.",
      unsupported: "이 작품은 아직 예약 재준비 지원 대상이 아닙니다.", changed: "접속 상태나 대상이 바뀌었습니다. 내 작품부터 다시 확인해 주세요.",
      catalogFailed: "작품 목록을 확인하지 못했습니다. 다시 불러와 주세요.", readFailed: "예약 기준을 확인하지 못했습니다. 다시 확인하기 전에는 재준비할 수 없습니다.",
      submitting: "현재 공개본을 대조하고 예약을 재준비하고 있습니다.", done: "예약을 재준비했습니다. 이미 설정된 자동 작업자가 생성할 수 있습니다. 상태를 다시 확인해 주세요.",
      failed: "재준비 결과를 확인하지 못했습니다. 자동으로 재요청하지 않습니다. 예약을 다시 확인해 주세요.",
      warning: "이미 요청되었거나 청구 가능성이 있는 작업은 다시 시작하지 않습니다. 재준비 후 기존 승인 범위의 자동 작업자가 그림을 생성할 수 있음을 확인했습니다.",
      prepare: "선택 작업 재준비", confirmTitle: "예약 재준비 확인", confirm: "이 작업만 재준비", cancel: "취소",
      workId: "작품 ID", release: "공개본 ID", checksum: "공개본 체크섬", generation: "작업 ID", scene: "장면", attempts: "시도 {count}회",
      previous: "이전 페이지", next: "다음 페이지", page: "{count}페이지", details: "예약 식별 기준", reviewHash: "검토 SHA", currentHash: "현재 예약 SHA", bookedHash: "저장된 예약 SHA", promptHash: "프롬프트 SHA", none: "없음",
      pending: "대기", generating: "생성 중", readyStatus: "생성 완료", failedStatus: "실패", blockedStatus: "차단",
      unbound: "예약 기준이 연결되지 않았습니다.", changedReason: "현재 승인 기준과 예약 기준이 다릅니다.", current: "현재 기준과 일치합니다. 재준비가 필요하지 않습니다.",
      in_progress: "진행 중인 작업은 다시 시작하지 않습니다.", attempted: "이미 요청되었거나 청구 가능성이 있어 재준비하지 않습니다.", asset_present: "이미 생성된 그림은 이 화면에서 교체하지 않습니다.", blocked: "현재 승인 범위에서는 재준비할 수 없습니다.", source_changed: "원고나 장면 기준이 변경되었습니다. 원본을 확인해 주세요."
    },
    en: {
      title: "Published Story Image Bookings", catalog: "Refresh My Published Stories", target: "Story / Release", choose: "Select Story", load: "Review Bookings",
      idle: "Select a published story to review its bookings.", catalogLoading: "Checking your stories.", loading: "Checking bookings.", emptyCatalog: "You have no currently published stories.", empty: "There are no bookings on this page.", ready: "Bookings reviewed.",
      unsupported: "Repreparation is not supported for this story yet.", changed: "Your session or target changed. Check your stories again.", catalogFailed: "The story list could not be confirmed. Reload it.", readFailed: "Booking criteria could not be confirmed. Review them again before repreparing.",
      submitting: "Checking the current release and repreparing the booking.", done: "Booking reprepared. An already configured worker may generate the image. Review the status again.", failed: "The result could not be confirmed. No automatic retry is made. Review bookings again.",
      warning: "Previously requested or potentially charged jobs will not restart. I acknowledge that an existing worker may generate images within the existing approval scope after repreparation.",
      prepare: "Reprepare Selected Job", confirmTitle: "Confirm Booking Repreparation", confirm: "Reprepare This Job Only", cancel: "Cancel",
      workId: "Story ID", release: "Release ID", checksum: "Release Checksum", generation: "Job ID", scene: "Scene", attempts: "Attempts: {count}", previous: "Previous Page", next: "Next Page", page: "Page {count}", details: "Booking Identity", reviewHash: "Review SHA", currentHash: "Current Booking SHA", bookedHash: "Saved Booking SHA", promptHash: "Prompt SHA", none: "None",
      pending: "Pending", generating: "Generating", readyStatus: "Generated", failedStatus: "Failed", blockedStatus: "Blocked",
      unbound: "No booking criteria are bound.", changedReason: "The booking differs from the current approved criteria.", current: "The booking is current; no repreparation is needed.", in_progress: "An active job will not restart.", attempted: "Already requested or potentially charged; no repreparation.", asset_present: "Existing images are not replaced here.", blocked: "Current approvals do not permit repreparation.", source_changed: "The manuscript or scene criteria changed. Check the source."
    },
    ja: {
      title: "公開作品の画像予約", catalog: "自分の公開作品を更新", target: "作品 / 公開版", choose: "作品を選択", load: "予約を確認",
      idle: "公開作品を選び、予約を確認してください。", catalogLoading: "作品を確認しています。", loading: "予約を確認しています。", emptyCatalog: "現在公開中の自分の作品はありません。", empty: "このページに予約はありません。", ready: "予約を確認しました。",
      unsupported: "この作品はまだ予約の再準備に対応していません。", changed: "接続状態または対象が変わりました。作品を再確認してください。", catalogFailed: "作品一覧を確認できませんでした。再読込してください。", readFailed: "予約基準を確認できませんでした。再確認するまで再準備できません。",
      submitting: "現在の公開版を照合し、予約を再準備しています。", done: "予約を再準備しました。設定済みの作業者が画像を生成する場合があります。状態を再確認してください。", failed: "結果を確認できませんでした。自動再送は行いません。予約を再確認してください。",
      warning: "依頼済み、または課金の可能性がある作業は再開しません。再準備後、既存の承認範囲で設定済みの作業者が画像を生成する場合があることを確認しました。",
      prepare: "選択した作業を再準備", confirmTitle: "予約再準備の確認", confirm: "この作業のみ再準備", cancel: "キャンセル",
      workId: "作品 ID", release: "公開版 ID", checksum: "公開版チェックサム", generation: "作業 ID", scene: "シーン", attempts: "試行 {count}回", previous: "前のページ", next: "次のページ", page: "{count}ページ", details: "予約識別基準", reviewHash: "確認 SHA", currentHash: "現在の予約 SHA", bookedHash: "保存済み予約 SHA", promptHash: "指示 SHA", none: "なし",
      pending: "待機", generating: "生成中", readyStatus: "生成済み", failedStatus: "失敗", blockedStatus: "停止",
      unbound: "予約基準が関連付けられていません。", changedReason: "現在の承認基準と予約基準が異なります。", current: "現在の基準と一致し、再準備は不要です。", in_progress: "進行中の作業は再開しません。", attempted: "依頼済みか課金の可能性があり、再準備しません。", asset_present: "生成済み画像はここでは交換しません。", blocked: "現在の承認範囲では再準備できません。", source_changed: "原稿またはシーン基準が変更されました。原文を確認してください。"
    },
    "zh-Hans": {
      title: "公开作品图像预约", catalog: "刷新我的公开作品", target: "作品 / 公开版本", choose: "选择作品", load: "检查预约",
      idle: "请选择公开作品并检查预约。", catalogLoading: "正在检查您的作品。", loading: "正在检查预约。", emptyCatalog: "目前没有公开中的个人作品。", empty: "本页没有预约。", ready: "已检查预约。",
      unsupported: "此作品尚不支持重新准备预约。", changed: "会话或目标已更改。请重新检查作品。", catalogFailed: "无法确认作品列表。请重新加载。", readFailed: "无法确认预约依据。重新检查前不能重新准备。",
      submitting: "正在核对当前公开版本并重新准备预约。", done: "预约已重新准备。已配置的工作程序可能生成图像。请再次检查状态。", failed: "无法确认结果。不会自动重试。请重新检查预约。",
      warning: "已请求或可能产生费用的任务不会重新启动。我已确认重新准备后，已有工作程序可能在既有批准范围内生成图像。",
      prepare: "重新准备所选任务", confirmTitle: "确认重新准备预约", confirm: "仅重新准备此任务", cancel: "取消",
      workId: "作品 ID", release: "公开版本 ID", checksum: "公开版本校验和", generation: "任务 ID", scene: "场景", attempts: "已尝试 {count}次", previous: "上一页", next: "下一页", page: "第{count}页", details: "预约识别依据", reviewHash: "审阅 SHA", currentHash: "当前预约 SHA", bookedHash: "已保存预约 SHA", promptHash: "指示 SHA", none: "无",
      pending: "等待", generating: "生成中", readyStatus: "已生成", failedStatus: "失败", blockedStatus: "已阻止",
      unbound: "预约依据尚未绑定。", changedReason: "预约依据与当前批准依据不同。", current: "与当前依据一致，无需重新准备。", in_progress: "进行中的任务不会重新启动。", attempted: "已请求或可能产生费用，不重新准备。", asset_present: "此处不替换已生成的图像。", blocked: "当前批准范围不允许重新准备。", source_changed: "稿件或场景依据已更改。请检查原文。"
    },
    "zh-Hant": {
      title: "公開作品圖像預約", catalog: "重新整理我的公開作品", target: "作品 / 公開版本", choose: "選擇作品", load: "檢查預約",
      idle: "請選擇公開作品並檢查預約。", catalogLoading: "正在檢查您的作品。", loading: "正在檢查預約。", emptyCatalog: "目前沒有公開中的個人作品。", empty: "本頁沒有預約。", ready: "已檢查預約。",
      unsupported: "此作品尚不支援重新準備預約。", changed: "工作階段或目標已變更。請重新檢查作品。", catalogFailed: "無法確認作品清單。請重新載入。", readFailed: "無法確認預約依據。重新檢查前不能重新準備。",
      submitting: "正在核對目前公開版本並重新準備預約。", done: "預約已重新準備。已設定的工作程序可能生成圖像。請再次檢查狀態。", failed: "無法確認結果。不會自動重試。請重新檢查預約。",
      warning: "已請求或可能產生費用的工作不會重新啟動。我已確認重新準備後，既有工作程序可能在既有核准範圍內生成圖像。",
      prepare: "重新準備所選工作", confirmTitle: "確認重新準備預約", confirm: "僅重新準備此工作", cancel: "取消",
      workId: "作品 ID", release: "公開版本 ID", checksum: "公開版本檢查碼", generation: "工作 ID", scene: "場景", attempts: "已嘗試 {count}次", previous: "上一頁", next: "下一頁", page: "第{count}頁", details: "預約識別依據", reviewHash: "審閱 SHA", currentHash: "目前預約 SHA", bookedHash: "已儲存預約 SHA", promptHash: "指示 SHA", none: "無",
      pending: "等待", generating: "生成中", readyStatus: "已生成", failedStatus: "失敗", blockedStatus: "已阻止",
      unbound: "預約依據尚未綁定。", changedReason: "預約依據與目前核准依據不同。", current: "與目前依據一致，無需重新準備。", in_progress: "進行中的工作不會重新啟動。", attempted: "已請求或可能產生費用，不重新準備。", asset_present: "此處不替換已生成的圖像。", blocked: "目前核准範圍不允許重新準備。", source_changed: "稿件或場景依據已變更。請檢查原文。"
    }
  };
  function actionable(item) {
    return Boolean(item?.canReprepare && ["unbound", "changed"].includes(item.reason) && item.attemptCount === 0 &&
      ["pending", "failed"].includes(item.status) && hash(item.reviewSha256) && hash(item.currentBookingIdentitySha256));
  }
  function parseReview(value, target) {
    if (!value || !sameId(value.workId, target.id) || !sameId(value.releaseId, target.activeReleaseId) ||
        !hash(value.releaseChecksum) || typeof value.eligible !== "boolean" || !Array.isArray(value.items) || value.items.length > 8 ||
        !(value.nextAfterId === null || uuid(value.nextAfterId)) || (!value.eligible && (value.items.length || value.nextAfterId)) ||
        (!value.items.length && value.nextAfterId)) throw new Error("review");
    const statuses = ["pending", "generating", "ready", "failed", "blocked"];
    const reasons = ["unbound", "changed", "current", "in_progress", "attempted", "asset_present", "blocked", "source_changed"];
    const seen = new Set();
    const items = value.items.map(item => {
      if (!item || !uuid(item.generationId) || !sceneKey(item.sourceSceneKey) || !statuses.includes(item.status) || !reasons.includes(item.reason) ||
          !Number.isSafeInteger(item.attemptCount) || item.attemptCount < 0 || typeof item.canReprepare !== "boolean" ||
          ![item.reviewSha256, item.currentBookingIdentitySha256, item.bookedIdentitySha256].every(nullableHash) || !hash(item.promptSha256) ||
          (item.canReprepare && (!value.eligible || !actionable(item)))) throw new Error("item");
      const generationId = item.generationId.toLowerCase();
      if (seen.has(generationId)) throw new Error("duplicate");
      seen.add(generationId);
      return { generationId, sourceSceneKey: item.sourceSceneKey, status: item.status, reason: item.reason, attemptCount: item.attemptCount,
        canReprepare: item.canReprepare, reviewSha256: item.reviewSha256, currentBookingIdentitySha256: item.currentBookingIdentitySha256,
        bookedIdentitySha256: item.bookedIdentitySha256, promptSha256: item.promptSha256 };
    });
    return { workId: target.id, releaseId: target.activeReleaseId, releaseChecksum: value.releaseChecksum,
      eligible: value.eligible, items, nextAfterId: value.nextAfterId?.toLowerCase() || null };
  }
  function createController({ fetch, identity, isCurrent, locale = () => "ko", onChange = () => {} }) {
    let owner = null, language = null, revision = 0, phase = "idle", messageKey = "idle";
    let catalog = [], catalogVerified = false, target = null, review = null, selected = null, checked = false, confirmation = null;
    let pages = [], pageIndex = -1, checksum = null;
    const emit = () => onChange(snapshot());
    const normalizedLocale = () => locales.includes(locale()) ? locale() : "ko";
    const snapshot = () => clone({ revision, phase, messageKey, locale: language || normalizedLocale(), catalog, catalogVerified,
      target, review, selected, checked, confirmation, pageIndex, busy: ["catalog", "reading", "mutating"].includes(phase) });
    const clearReview = () => { review = null; selected = null; checked = false; confirmation = null; };
    const clearPages = () => { pages = []; pageIndex = -1; checksum = null; };
    function invalidate(key = "changed") {
      revision++; catalog = []; catalogVerified = false; target = null; clearReview(); clearPages(); phase = "idle"; messageKey = key; emit();
    }
    function syncContext() {
      const current = identity(), nextLanguage = normalizedLocale();
      const valid = current?.ownerId && Number.isSafeInteger(current.epoch) && isCurrent(current);
      if (valid && owner?.ownerId === current.ownerId && owner.epoch === current.epoch && language === nextLanguage) return true;
      owner = valid ? { ownerId: current.ownerId, epoch: current.epoch } : null;
      language = nextLanguage;
      invalidate();
      return false;
    }
    const current = ticket => syncContext() && ticket === revision;
    const targetReady = () => catalogVerified && target && catalog.some(work => sameId(work.id, target.id) && sameId(work.activeReleaseId, target.activeReleaseId));
    const selectedItem = () => phase === "ready" && review?.eligible && targetReady() ? review.items.find(item => sameId(item.generationId, selected)) : null;
    function fail(key) { revision++; clearReview(); clearPages(); phase = "error"; messageKey = key; emit(); }
    async function readCatalog(capturedOwner, capturedLanguage) {
      const rows = [], ids = new Set(), cursors = new Set();
      let cursor = null, count = 0;
      do {
        if (!isCurrent(capturedOwner)) throw new Error("owner");
        const params = new URLSearchParams({ locale: capturedLanguage, limit: "30" });
        if (cursor) params.set("cursor", cursor);
        const data = await fetch(`/api/v1/me/creator-studio/stories?${params}`, { method: "GET", identity: capturedOwner });
        if (!isCurrent(capturedOwner) || !data || !Array.isArray(data.items) || data.items.length > 30 ||
            !(data.nextCursor === null || uuid(data.nextCursor))) throw new Error("catalog");
        for (const row of data.items) {
          const publication = row?.publication;
          if (!uuid(row?.workId) || typeof row.slug !== "string" || !row.slug.trim() || row.slug.length > 256 || row.slug.includes("\0") || typeof publication?.status !== "string" ||
              typeof publication.published !== "boolean" || !(publication.activeReleaseId === null || uuid(publication.activeReleaseId)) ||
              publication.published !== (publication.status === "published" && uuid(publication.activeReleaseId)) ||
              typeof row.title?.value !== "string" || !row.title.value.trim() || row.title.value.length > 1000 || row.title.value.includes("\0") ||
              ids.has(row.workId.toLowerCase())) throw new Error("catalog row");
          ids.add(row.workId.toLowerCase());
          if (publication.published) rows.push({ id: row.workId.toLowerCase(), activeReleaseId: publication.activeReleaseId.toLowerCase(), title: row.title.value, slug: row.slug });
        }
        cursor = data.nextCursor?.toLowerCase() || null;
        if ((cursor && (!data.items.length || cursors.has(cursor))) || ids.size > 1000 || ++count > 40) throw new Error("catalog cursor");
        if (cursor) cursors.add(cursor);
      } while (cursor);
      return rows;
    }
    const signature = rows => JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)));
    async function loadCatalog() {
      syncContext(); if (!owner) return;
      const prior = target, capturedOwner = owner, capturedLanguage = language, ticket = ++revision;
      catalog = []; catalogVerified = false; target = null; clearReview(); clearPages(); phase = "catalog"; messageKey = "catalogLoading"; emit();
      try {
        const rows = await readCatalog(capturedOwner, capturedLanguage);
        if (!current(ticket)) return;
        catalog = rows; catalogVerified = true;
        target = prior ? rows.find(work => sameId(work.id, prior.id) && sameId(work.activeReleaseId, prior.activeReleaseId)) || null : null;
        phase = "idle"; messageKey = rows.length ? "idle" : "emptyCatalog"; emit();
      } catch { if (current(ticket)) fail("catalogFailed"); }
    }
    function selectWork(id, expectedRevision) {
      if (!syncContext() || expectedRevision !== revision || !catalogVerified) return;
      revision++; target = catalog.find(work => sameId(work.id, id)) || null; clearReview(); clearPages(); phase = "idle"; messageKey = "idle"; emit();
    }
    async function loadReview(direction = "first", expectedRevision = revision) {
      if (!syncContext() || expectedRevision !== revision || !targetReady() || ["catalog", "reading", "mutating"].includes(phase)) return;
      let index = 0, afterId = null;
      if (direction === "next") {
        if (!review?.nextAfterId || pageIndex < 0) return;
        index = pageIndex + 1; afterId = review.nextAfterId;
      } else if (direction === "previous") {
        if (pageIndex <= 0) return;
        index = pageIndex - 1; afterId = pages[index].afterId;
      } else if (direction !== "first") return;
      if (direction === "first") clearPages();
      const scope = target, capturedOwner = owner, ticket = ++revision;
      clearReview(); phase = "reading"; messageKey = "loading"; emit();
      try {
        const query = afterId ? `?afterId=${encodeURIComponent(afterId)}` : "";
        const value = parseReview(await fetch(`/api/v1/me/creator-studio/stories/${scope.id}/visual-bookings${query}`,
          { method: "GET", identity: capturedOwner }), scope);
        if (!current(ticket)) return;
        if ((checksum && checksum !== value.releaseChecksum) || (value.nextAfterId && (value.nextAfterId === afterId ||
            pages.slice(0, index + 1).some(page => page.afterId === value.nextAfterId))) ||
            (pages[index + 1] && value.nextAfterId !== pages[index + 1].afterId) ||
            value.items.some(item => pages.some((page, position) => position !== index && page.ids.includes(item.generationId)))) throw new Error("page changed");
        checksum = value.releaseChecksum; pages[index] = { afterId, ids: value.items.map(item => item.generationId) }; pageIndex = index;
        review = value; phase = "ready"; messageKey = !value.eligible ? "unsupported" : value.items.length ? "ready" : "empty"; emit();
      } catch { if (current(ticket)) fail("readFailed"); }
    }
    function selectItem(id, expectedRevision) {
      if (!syncContext() || expectedRevision !== revision || !review || phase !== "ready") return;
      revision++; selected = review.items.find(item => sameId(item.generationId, id))?.generationId || null;
      checked = false; confirmation = null; emit();
    }
    function acknowledge(value, expectedRevision) {
      if (!syncContext() || expectedRevision !== revision || !actionable(selectedItem())) return;
      revision++; checked = value === true; confirmation = null; emit();
    }
    function requestConfirmation(expectedRevision) {
      if (!syncContext() || expectedRevision !== revision || !checked || !actionable(selectedItem())) return;
      confirmation = { generationId: selected, revision }; emit();
    }
    function cancelConfirmation() { revision++; checked = false; confirmation = null; emit(); }
    async function reprepare(expectedRevision) {
      if (!syncContext() || expectedRevision !== revision || confirmation?.revision !== revision || !sameId(confirmation.generationId, selected) ||
          !checked || !actionable(selectedItem())) return;
      const item = selectedItem(), scope = target, capturedOwner = owner, capturedLanguage = language, catalogSignature = signature(catalog);
      const body = { generationId: item.generationId, releaseId: review.releaseId, releaseChecksum: review.releaseChecksum,
        sourceSceneKey: item.sourceSceneKey, promptSha256: item.promptSha256, expectedReviewSha256: item.reviewSha256,
        expectedCurrentBookingIdentitySha256: item.currentBookingIdentitySha256, confirmedResume: true };
      const ticket = ++revision; clearReview(); clearPages(); phase = "mutating"; messageKey = "submitting"; emit();
      try {
        const latest = await readCatalog(capturedOwner, capturedLanguage);
        if (!current(ticket)) return;
        if (signature(latest) !== catalogSignature) { invalidate(); return; }
        // Never replay a confirmed command after an authentication refresh or an uncertain reply.
        const result = await fetch(`/api/v1/me/creator-studio/stories/${scope.id}/visual-bookings/reprepare`,
          { method: "POST", identity: capturedOwner, _retried: true, body });
        if (!current(ticket)) return;
        if (!result || !sameId(result.workId, scope.id) || !sameId(result.releaseId, body.releaseId) || result.releaseChecksum !== body.releaseChecksum ||
            !sameId(result.generationId, body.generationId) || result.sourceSceneKey !== body.sourceSceneKey || result.status !== "pending" ||
            result.generationStarted !== false || result.bookingIdentitySha256 !== body.expectedCurrentBookingIdentitySha256) throw new Error("result");
        phase = "done"; messageKey = "done"; emit();
      } catch { if (current(ticket)) fail("failed"); }
    }
    return { snapshot, syncContext, invalidate, loadCatalog, selectWork, loadReview, selectItem, acknowledge, requestConfirmation, cancelConfirmation, reprepare };
  }
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  function mount(host) {
    const api = window.LuminaCreatorStudioApi, shell = document.getElementById("studioShell"), section = document.getElementById("writer-manuscript");
    if (!host || host.dataset.bookingMounted || !api?.fetch || !api.identity || !api.isCurrent || !shell || !section) return null;
    host.dataset.bookingMounted = "true";
    const visible = () => !shell.hidden && section.classList.contains("is-active");
    const locale = () => window.luminaI18n?.getLocale?.() || document.documentElement.lang || "ko";
    let controller, deferredFocus = null;
    function render(state) {
      const words = copy[state.locale] || copy.ko;
      const t = (key, count) => (words[key] || "").replace("{count}", String(count));
      const active = state.review?.items.find(item => item.generationId === state.selected);
      const rev = `data-writer-booking-revision="${state.revision}"`;
      const canAct = !state.busy && actionable(active);
      const focus = document.activeElement, focusKey = host.contains(focus) ? focus?.dataset.writerBookingFocus : null;
      const button = (action, label, disabled = false) => `<button type="button" data-writer-booking-action="${action}" data-writer-booking-focus="${action}" ${rev} ${disabled ? "disabled" : ""}>${escapeHtml(label)}</button>`;
      const binding = pairs => `<dl class="writer-booking-binding">${pairs.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || t("none"))}</dd></div>`).join("")}</dl>`;
      host.innerHTML = `<header><h3 id="writerVisualBookingTitle">${t("title")}</h3>${button("catalog", t("catalog"), state.busy)}</header>
        <div class="writer-booking-target"><label for="writerVisualBookingWork">${t("target")}<select id="writerVisualBookingWork" data-writer-booking-work data-writer-booking-focus="work" ${rev} ${!state.catalogVerified || state.busy ? "disabled" : ""}>
        <option value="">${t("choose")}</option>${state.catalog.map(work => `<option value="${work.id}" ${work.id === state.target?.id ? "selected" : ""}>${escapeHtml(work.title)}</option>`).join("")}</select></label>${button("load", t("load"), !state.target || !state.catalogVerified || state.busy)}</div>
        ${state.target ? binding([[t("workId"), state.target.id], [t("release"), state.target.activeReleaseId], ...(state.review ? [[t("checksum"), state.review.releaseChecksum]] : [])]) : ""}
        <p class="writer-booking-state ${state.phase === "error" ? "is-error" : ""}" role="status" aria-live="polite">${t(state.messageKey)}</p>
        ${state.review?.items.length ? `<ul class="writer-booking-items">${state.review.items.map(item => `<li><label class="writer-booking-choice"><input type="radio" name="writer-visual-booking-item" data-writer-booking-item="${item.generationId}" data-writer-booking-focus="${item.generationId}" ${rev} ${state.selected === item.generationId ? "checked" : ""} />
          <span><strong>${escapeHtml(item.sourceSceneKey)}</strong><small>${t(({ ready: "readyStatus", failed: "failedStatus", blocked: "blockedStatus" })[item.status] || item.status)} · ${t("attempts", item.attemptCount)}</small></span></label>
          <p>${t(item.reason === "changed" ? "changedReason" : item.reason)}</p><details><summary>${t("details")}</summary>${binding([[t("generation"), item.generationId], [t("reviewHash"), item.reviewSha256], [t("currentHash"), item.currentBookingIdentitySha256], [t("bookedHash"), item.bookedIdentitySha256], [t("promptHash"), item.promptSha256]])}</details></li>`).join("")}</ul>` : ""}
        ${state.review ? `<nav class="writer-booking-pages" aria-label="${t("title")}">${button("previous", "←", state.pageIndex <= 0)}<span>${t("page", state.pageIndex + 1)}</span>${button("next", "→", !state.review.nextAfterId)}</nav>` : ""}
        ${active ? `<div class="writer-booking-approval"><strong>${t("scene")}: ${escapeHtml(active.sourceSceneKey)}</strong><label class="writer-booking-choice"><input type="checkbox" data-writer-booking-ack data-writer-booking-focus="ack" ${rev} ${state.checked ? "checked" : ""} ${canAct ? "" : "disabled"} /><span>${t("warning")}</span></label>${button("prepare", t("prepare"), !canAct || !state.checked)}</div>` : ""}
        ${state.confirmation && active ? `<dialog class="writer-booking-dialog" aria-labelledby="writerBookingConfirmTitle"><h4 id="writerBookingConfirmTitle">${t("confirmTitle")}</h4>
          ${binding([[t("target"), state.target.title], [t("release"), state.target.activeReleaseId], [t("scene"), active.sourceSceneKey], [t("generation"), active.generationId]])}
          <p>${t("warning")}</p><div class="writer-booking-dialog-actions">${button("cancel", t("cancel"))}${button("confirm", t("confirm"))}</div></dialog>` : ""}`;
      for (const action of ["previous", "next"]) {
        const node = host.querySelector(`[data-writer-booking-action="${action}"]`);
        node?.setAttribute("aria-label", t(action)); node?.setAttribute("title", t(action));
      }
      if (state.confirmation) {
        const dialog = host.querySelector("dialog");
        dialog.addEventListener("cancel", event => { event.preventDefault(); controller.cancelConfirmation(); });
        dialog.showModal();
      } else if (visible() && (focusKey || (!state.busy && deferredFocus && focus === document.body))) {
        const controls = Array.from(host.querySelectorAll("[data-writer-booking-focus]"));
        const fallback = state.selected ? "ack" : state.target ? "load" : "catalog";
        const wanted = focusKey || deferredFocus;
        const node = controls.find(control => control.dataset.writerBookingFocus === wanted && !control.disabled) ||
          controls.find(control => control.dataset.writerBookingFocus === fallback && !control.disabled);
        if (node) { node.focus(); deferredFocus = null; }
        else if (state.busy) deferredFocus = fallback;
      }
      if (!state.busy || !visible()) deferredFocus = null;
    }
    controller = createController({ identity: () => visible() ? api.identity() : null, isCurrent: value => visible() && api.isCurrent(value), locale,
      fetch: async (url, options) => {
        const response = await api.fetch(url, options);
        if (!response.ok) throw new Error("request failed");
        return response.json();
      }, onChange: render });
    host.addEventListener("change", event => {
      const node = event.target, rev = Number(node.dataset.writerBookingRevision);
      if (node.matches("[data-writer-booking-work]")) controller.selectWork(node.value, rev);
      if (node.matches("[data-writer-booking-item]")) controller.selectItem(node.dataset.writerBookingItem, rev);
      if (node.matches("[data-writer-booking-ack]")) controller.acknowledge(node.checked, rev);
    });
    host.addEventListener("click", event => {
      const node = event.target.closest("[data-writer-booking-action]");
      if (!node || !host.contains(node) || node.disabled) return;
      const rev = Number(node.dataset.writerBookingRevision);
      const actions = { catalog: () => controller.loadCatalog(), load: () => controller.loadReview("first", rev), previous: () => controller.loadReview("previous", rev),
        next: () => controller.loadReview("next", rev), prepare: () => controller.requestConfirmation(rev), cancel: () => controller.cancelConfirmation(), confirm: () => controller.reprepare(rev) };
      actions[node.dataset.writerBookingAction]?.();
    });
    const sync = () => controller.syncContext();
    window.addEventListener("storage", sync); window.addEventListener("focus", sync); window.addEventListener("lumina:localechange", sync);
    document.addEventListener("visibilitychange", sync);
    if (typeof MutationObserver === "function") {
      new MutationObserver(sync).observe(shell, { attributes: true, attributeFilter: ["hidden"] });
      new MutationObserver(sync).observe(section, { attributes: true, attributeFilter: ["class"] });
      new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    }
    document.getElementById("writerManuscriptWork")?.addEventListener("change", () => controller.invalidate());
    render(controller.snapshot()); sync();
    return controller;
  }
  window.LuminaCreatorVisualBooking = { createController, mount };
  if (typeof document !== "undefined") mount(document.getElementById("writerVisualBooking"));
})();
