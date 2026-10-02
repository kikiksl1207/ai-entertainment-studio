(function () {
  "use strict";
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
  const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const sameId = (left, right) => uuid(left) && uuid(right) && left.toLowerCase() === right.toLowerCase();
  const clone = value => JSON.parse(JSON.stringify(value));
  function validText(value, limit, blank = false) {
    if (typeof value !== "string" || value.length > limit || value.includes("\0") || (!blank && !value.trim())) return false;
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++index);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      } else if (code >= 0xdc00 && code <= 0xdfff) return false;
    }
    return true;
  }
  const validPrompt = value => validText(value, 32000);
  const byteLength = value => new TextEncoder().encode(value).byteLength;
  const copy = {
    ko: {
      title: "공유 분기 이미지 지침 검토", catalog: "내 공개 작품 새로고침", work: "공개 작품", choose: "작품 선택", load: "공유 분기 불러오기",
      idle: "공개 작품을 선택해 주세요.", catalogLoading: "내 공개 작품을 확인하고 있습니다.", emptyCatalog: "현재 공개 중인 내 작품이 없습니다.",
      loading: "공유 분기를 확인하고 있습니다.", empty: "이 페이지에 검토 가능한 공유 분기가 없습니다.", ready: "검토할 분기를 열어 주세요.",
      opening: "분기 원문과 이미지 지침을 확인하고 있습니다.", opened: "원문과 이미지 지침을 확인해 주세요.", open: "검토 열기", reopen: "검토 다시 열기",
      prose: "공유 분기 원문", prompt: "이미지 지침", proposed: "미승인 제안", unreviewed: "미검토", draft: "초안 저장됨", approved: "이 지침 승인됨",
      save: "초안 저장", retry: "같은 초안 저장 재시도", approve: "저장한 지침 승인", saving: "초안을 저장하고 있습니다.", approving: "저장한 지침을 승인하고 있습니다.",
      saved: "초안을 저장했습니다. 아직 승인되지 않았습니다.", done: "이 분기의 저장한 지침을 승인했습니다. 이미지 생성이나 공개는 시작하지 않았습니다.",
      ack: "이 분기 원문을 직접 읽고, 지침의 등장인물·그림체·의미·시간 흐름이 원문과 맞는지 확인했습니다.",
      dirty: "변경한 지침은 저장되지 않았습니다.", invalidPrompt: "지침은 공백만으로 작성할 수 없으며, 올바른 문자로 32,000자 이내여야 합니다.",
      failed: "결과를 확인하지 못했습니다. 검토를 다시 열기 전에는 편집하거나 승인할 수 없습니다.", retryFailed: "저장 결과를 확인하지 못했습니다. 같은 내용을 재시도하거나 검토를 다시 열어 주세요. 자동 재요청은 하지 않습니다.",
      unavailable: "지금은 공유 분기 검토를 이용할 수 없습니다. 목록이 비어 있다는 뜻은 아닙니다.", conflict: "공개본이나 검토 기준이 바뀌었습니다. 작품과 분기를 다시 불러와 검토를 열어 주세요.",
      session: "접속 상태가 바뀌었습니다. 내 공개 작품부터 다시 확인해 주세요.", discard: "저장하지 않은 지침을 버릴까요?", previous: "이전 페이지", next: "다음 페이지", page: "{count}페이지", sourceLocale: "원문 언어"
    },
    en: {
      title: "Shared Branch Visual Review", catalog: "Refresh My Published Stories", work: "Published Story", choose: "Select a Story", load: "Load Shared Branches",
      idle: "Select a published story.", catalogLoading: "Checking your published stories.", emptyCatalog: "You have no currently published stories.",
      loading: "Checking shared branches.", empty: "There are no reviewable shared branches on this page.", ready: "Open a branch to review it.",
      opening: "Checking the branch prose and visual guidance.", opened: "Review the prose and visual guidance.", open: "Open Review", reopen: "Reopen Review",
      prose: "Shared Branch Prose", prompt: "Visual Guidance", proposed: "Unapproved Proposal", unreviewed: "Not Reviewed", draft: "Draft Saved", approved: "This Guidance Is Approved",
      save: "Save Draft", retry: "Retry the Same Save", approve: "Approve Saved Guidance", saving: "Saving the draft.", approving: "Approving the saved guidance.",
      saved: "Draft saved. It has not been approved.", done: "The saved guidance for this branch is approved. No image generation or publication was started.",
      ack: "I read this branch's prose and checked that the cast, visual style, meaning, and timeline in the guidance match it.",
      dirty: "Your guidance changes have not been saved.", invalidPrompt: "Guidance must contain valid text, not just whitespace, and be at most 32,000 characters.",
      failed: "The result could not be verified. Reopen the review before editing or approving.", retryFailed: "The save could not be confirmed. Retry the same text or reopen the review. There is no automatic retry.",
      unavailable: "Shared branch review is currently unavailable. This does not mean the list is empty.", conflict: "The release or review criteria changed. Reload the story and branches, then reopen the review.",
      session: "Your session or context changed. Check your published stories again.", discard: "Discard your unsaved guidance?", previous: "Previous Page", next: "Next Page", page: "Page {count}", sourceLocale: "Prose Language"
    },
    ja: {
      title: "共有分岐の画像指示を確認", catalog: "自分の公開作品を更新", work: "公開作品", choose: "作品を選択", load: "共有分岐を読み込む",
      idle: "公開作品を選んでください。", catalogLoading: "公開作品を確認しています。", emptyCatalog: "現在公開中の自分の作品はありません。",
      loading: "共有分岐を確認しています。", empty: "このページに確認できる共有分岐はありません。", ready: "確認する分岐を開いてください。",
      opening: "分岐の本文と画像指示を確認しています。", opened: "本文と画像指示を確認してください。", open: "確認を開く", reopen: "確認を開き直す",
      prose: "共有分岐の本文", prompt: "画像指示", proposed: "未承認の提案", unreviewed: "未確認", draft: "下書き保存済み", approved: "この指示は承認済み",
      save: "下書きを保存", retry: "同じ内容で保存を再試行", approve: "保存した指示を承認", saving: "下書きを保存しています。", approving: "保存した指示を承認しています。",
      saved: "下書きを保存しました。まだ承認されていません。", done: "この分岐の保存済み指示を承認しました。画像生成や公開は開始していません。",
      ack: "この分岐の本文を自分で読み、指示の登場人物・画風・意味・時間の流れが本文と一致することを確認しました。",
      dirty: "変更した指示は未保存です。", invalidPrompt: "指示は空白のみではなく、正しい文字で32,000文字以内にしてください。",
      failed: "結果を確認できませんでした。編集や承認を行う前に確認を開き直してください。", retryFailed: "保存結果を確認できませんでした。同じ内容で再試行するか、確認を開き直してください。自動再送は行いません。",
      unavailable: "現在、共有分岐の確認は利用できません。一覧が空という意味ではありません。", conflict: "公開版または確認基準が変わりました。作品と分岐を再読込し、確認を開き直してください。",
      session: "接続状態または対象が変わりました。公開作品を再確認してください。", discard: "未保存の指示を破棄しますか？", previous: "前のページ", next: "次のページ", page: "{count}ページ", sourceLocale: "本文の言語"
    },
    "zh-Hans": {
      title: "共享分支图像指引审阅", catalog: "刷新我的公开作品", work: "公开作品", choose: "选择作品", load: "加载共享分支",
      idle: "请选择公开作品。", catalogLoading: "正在检查您的公开作品。", emptyCatalog: "目前没有公开中的个人作品。",
      loading: "正在检查共享分支。", empty: "本页没有可审阅的共享分支。", ready: "请打开要审阅的分支。",
      opening: "正在检查分支原文和图像指引。", opened: "请核对原文和图像指引。", open: "打开审阅", reopen: "重新打开审阅",
      prose: "共享分支原文", prompt: "图像指引", proposed: "未批准的建议", unreviewed: "未审阅", draft: "草稿已保存", approved: "此指引已批准",
      save: "保存草稿", retry: "重试保存相同内容", approve: "批准已保存的指引", saving: "正在保存草稿。", approving: "正在批准已保存的指引。",
      saved: "草稿已保存，尚未批准。", done: "已批准此分支保存的指引。未启动图像生成或公开发布。",
      ack: "我已亲自阅读此分支原文，并确认指引中的人物、画风、含义和时间顺序与原文一致。",
      dirty: "指引更改尚未保存。", invalidPrompt: "指引不能仅包含空白，须使用有效字符，且不超过32,000个字符。",
      failed: "无法确认结果。请重新打开审阅后再编辑或批准。", retryFailed: "无法确认保存结果。请重试相同内容或重新打开审阅。不会自动重试。",
      unavailable: "共享分支审阅暂时不可用，并不表示列表为空。", conflict: "公开版本或审阅依据已更改。请重新加载作品和分支，再打开审阅。",
      session: "会话或目标已更改。请重新检查公开作品。", discard: "放弃尚未保存的指引？", previous: "上一页", next: "下一页", page: "第{count}页", sourceLocale: "原文语言"
    },
    "zh-Hant": {
      title: "共享分支圖像指引審閱", catalog: "重新整理我的公開作品", work: "公開作品", choose: "選擇作品", load: "載入共享分支",
      idle: "請選擇公開作品。", catalogLoading: "正在檢查您的公開作品。", emptyCatalog: "目前沒有公開中的個人作品。",
      loading: "正在檢查共享分支。", empty: "本頁沒有可審閱的共享分支。", ready: "請開啟要審閱的分支。",
      opening: "正在檢查分支原文和圖像指引。", opened: "請核對原文和圖像指引。", open: "開啟審閱", reopen: "重新開啟審閱",
      prose: "共享分支原文", prompt: "圖像指引", proposed: "未核准的建議", unreviewed: "未審閱", draft: "草稿已儲存", approved: "此指引已核准",
      save: "儲存草稿", retry: "重試儲存相同內容", approve: "核准已儲存的指引", saving: "正在儲存草稿。", approving: "正在核准已儲存的指引。",
      saved: "草稿已儲存，尚未核准。", done: "已核准此分支儲存的指引。未啟動圖像生成或公開發布。",
      ack: "我已親自閱讀此分支原文，並確認指引中的人物、畫風、含義及時間順序與原文一致。",
      dirty: "指引變更尚未儲存。", invalidPrompt: "指引不能僅包含空白，須使用有效字元，且不超過32,000個字元。",
      failed: "無法確認結果。請重新開啟審閱後再編輯或核准。", retryFailed: "無法確認儲存結果。請重試相同內容或重新開啟審閱。不會自動重試。",
      unavailable: "共享分支審閱暫時無法使用，並不表示清單為空。", conflict: "公開版本或審閱依據已變更。請重新載入作品和分支，再開啟審閱。",
      session: "工作階段或目標已變更。請重新檢查公開作品。", discard: "捨棄尚未儲存的指引？", previous: "上一頁", next: "下一頁", page: "第{count}頁", sourceLocale: "原文語言"
    }
  };
  const localeNames = { ko: "한국어", en: "English", ja: "日本語", "zh-Hans": "简体中文", "zh-Hant": "繁體中文" };
  const failure = (status, kind = "http") => Object.assign(new Error("Review request failed"), { status, kind });
  function parseList(value, target) {
    if (value?.contract !== "story-shared-branch-visual-list-v1" || !sameId(value.workId, target.id) ||
        !sameId(value.releaseId, target.releaseId) || !hash(value.releaseChecksum) || !Array.isArray(value.items) || value.items.length > 8 ||
        !(value.nextCursor === null || uuid(value.nextCursor))) throw failure(0, "invalid");
    const seen = new Set();
    const items = value.items.map(item => {
      if (!uuid(item?.sharedResultId) || !validText(item.title, 1000) || !locales.includes(item.locale) ||
          !hash(item.sourceChecksum) || !hash(item.profilePinHash) || !["unreviewed", "draft", "approved"].includes(item.status) ||
          seen.has(item.sharedResultId.toLowerCase())) throw failure(0, "invalid");
      seen.add(item.sharedResultId.toLowerCase());
      return { sharedResultId: item.sharedResultId.toLowerCase(), title: item.title, locale: item.locale,
        sourceChecksum: item.sourceChecksum, profilePinHash: item.profilePinHash, status: item.status };
    });
    return { workId: target.id, releaseId: target.releaseId, releaseChecksum: value.releaseChecksum, items,
      nextCursor: value.nextCursor?.toLowerCase() || null };
  }
  async function promptDigest(text) {
    if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function") return null;
    const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  async function parseBatch(value, target, item, expected = {}) {
    if (value?.contract !== "story-branch-visual-review-batch-v1" || !uuid(value.batchId) || !sameId(value.workId, target.id) ||
        !sameId(value.sharedResultId, item.sharedResultId) || value.sourceChecksum !== item.sourceChecksum || value.profilePinHash !== item.profilePinHash ||
        !hash(value.batchChecksum) || !hash(value.promptSha256) || !validPrompt(value.promptText) ||
        !Number.isSafeInteger(value.batchVersion) || value.batchVersion < 1 || value.generationStarted !== false || value.published !== false ||
        !["draft", "approved"].includes(value.status) ||
        (value.status === "draft" ? value.revision !== 1 || value.approvedAt !== null : value.revision !== 2 ||
          typeof value.approvedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value.approvedAt) || !Number.isFinite(Date.parse(value.approvedAt)))) throw failure(0, "invalid");
    for (const [key, wanted] of Object.entries(expected)) {
      if (key === "batchId" ? !sameId(value[key], wanted) : value[key] !== wanted) throw failure(0, "invalid");
    }
    const digest = await promptDigest(value.promptText);
    if (digest !== null && digest !== value.promptSha256) throw failure(0, "invalid");
    return { contract: value.contract, batchId: value.batchId.toLowerCase(), workId: target.id, sharedResultId: item.sharedResultId,
      sourceChecksum: value.sourceChecksum, profilePinHash: value.profilePinHash, batchChecksum: value.batchChecksum,
      batchVersion: value.batchVersion, revision: value.revision, status: value.status, promptText: value.promptText,
      promptSha256: value.promptSha256, approvedAt: value.approvedAt, generationStarted: false, published: false };
  }
  async function parseDetail(value, target, item) {
    if (value?.contract !== "story-shared-branch-visual-review-v1" || !sameId(value.workId, target.id) ||
        !sameId(value.sharedResultId, item.sharedResultId) || value.locale !== item.locale || value.sourceChecksum !== item.sourceChecksum ||
        value.profilePinHash !== item.profilePinHash || !validText(value.title, 1000) || !validText(value.prose, 100000) || byteLength(value.prose) > 100000 ||
        !validPrompt(value.proposedPrompt) || value.proposalApproved !== false || value.generationStarted !== false || value.published !== false ||
        !(value.currentBatch === null || typeof value.currentBatch === "object" && value.currentBatch)) throw failure(0, "invalid");
    const batch = value.currentBatch === null ? null : await parseBatch(value.currentBatch, target, item);
    return { workId: target.id, sharedResultId: item.sharedResultId, locale: value.locale, sourceChecksum: value.sourceChecksum,
      profilePinHash: value.profilePinHash, title: value.title, prose: value.prose, proposedPrompt: value.proposedPrompt, currentBatch: batch };
  }
  function createController({ fetch, identity, isCurrent, locale = () => "ko", context = () => "", confirmDiscard = () => false, onChange = () => {} }) {
    let owner = null, language = null, contextKey = null, revision = 0, phase = "idle", messageKey = "idle";
    let catalog = [], catalogVerified = false, target = null, list = null, pages = [], pageIndex = -1, releaseChecksum = null;
    let selected = null, detail = null, batch = null, prompt = "", baseline = "", checked = false, locked = false, attempt = null;
    const busy = () => ["catalog", "list", "detail", "saving", "approving"].includes(phase);
    const editable = () => Boolean(detail && phase === "ready" && !locked);
    const canApprove = () => Boolean(editable() && checked && batch?.status === "draft" && prompt === batch.promptText);
    const snapshot = () => clone({ revision, phase, messageKey, locale: language || normalizedLocale(), catalog, catalogVerified, target, list,
      pageIndex, selected, detail, batch, prompt, checked, dirty: Boolean(detail && prompt !== baseline), busy: busy(),
      editable: editable(), canSave: editable() && validPrompt(prompt) && (!batch || prompt !== batch.promptText), canApprove: canApprove(),
      canRetry: Boolean(phase === "error" && attempt && locked), validPrompt: validPrompt(prompt) });
    const emit = () => onChange(snapshot());
    const normalizedLocale = () => locales.includes(locale()) ? locale() : "ko";
    function clearDetail() { detail = null; batch = null; prompt = ""; baseline = ""; checked = false; locked = false; attempt = null; }
    function clearList() { list = null; pages = []; pageIndex = -1; releaseChecksum = null; selected = null; clearDetail(); }
    function invalidate(key = "session") {
      revision++; catalog = []; catalogVerified = false; target = null; clearList(); phase = "idle"; messageKey = key; emit();
    }
    function syncContext() {
      const next = identity(), nextLanguage = normalizedLocale(), nextContext = context();
      const valid = Boolean(next?.ownerId && Number.isSafeInteger(next.epoch) && isCurrent(next));
      if (valid && owner?.ownerId === next.ownerId && owner.epoch === next.epoch && language === nextLanguage && contextKey === nextContext) return true;
      if (!valid && !owner && language === nextLanguage && contextKey === nextContext) return false;
      owner = valid ? { ownerId: next.ownerId, epoch: next.epoch } : null; language = nextLanguage; contextKey = nextContext;
      invalidate(); return false;
    }
    const current = ticket => syncContext() && ticket === revision;
    const allowed = expectedRevision => syncContext() && expectedRevision === revision;
    function discard() { return !(detail && (prompt !== baseline || attempt)) || confirmDiscard(copy[language].discard) === true; }
    const targetReady = () => Boolean(catalogVerified && target && catalog.some(work => sameId(work.id, target.id) && sameId(work.releaseId, target.releaseId)));
    async function request(url, options) {
      let response;
      try { response = await fetch(url, { ...options, _retried: true }); }
      catch { throw failure(0, "transport"); }
      if (!response || typeof response.ok !== "boolean" || !Number.isInteger(response.status) || typeof response.json !== "function") throw failure(0, "invalid");
      if (!response.ok) throw failure(response.status);
      try {
        const length = Number(response.headers?.get?.("Content-Length"));
        if (length > 256 * 1024) throw failure(0, "invalid");
        if (response.body?.getReader) {
          const reader = response.body.getReader(), chunks = []; let size = 0;
          try {
            while (true) {
              const chunk = await reader.read(); if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > 256 * 1024) { await reader.cancel(); throw failure(0, "invalid"); }
              chunks.push(chunk.value);
            }
          } finally { reader.releaseLock(); }
          const bytes = new Uint8Array(size); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        }
        const data = await response.json();
        if (byteLength(JSON.stringify(data)) > 256 * 1024) throw failure(0, "invalid");
        return data;
      } catch { throw failure(0, "invalid"); }
    }
    function fail(error, saving = false) {
      revision++; checked = false; locked = true;
      if (error.status === 401) { owner = null; invalidate("session"); return; }
      if (error.status === 409) { clearList(); phase = "conflict"; messageKey = "conflict"; }
      else if (error.status === 503) { clearDetail(); selected = null; list = null; phase = "unavailable"; messageKey = "unavailable"; }
      else {
        if (!(saving && attempt && (error.kind === "transport" || error.status >= 500))) attempt = null;
        batch = null; phase = "error"; messageKey = attempt ? "retryFailed" : "failed";
      }
      emit();
    }
    async function readCatalog(capturedOwner, capturedLanguage, ticket) {
      const rows = [], ids = new Set(), cursors = new Set(); let cursor = null, count = 0;
      do {
        if (!current(ticket)) throw failure(0, "stale");
        const params = new URLSearchParams({ locale: capturedLanguage, limit: "30" });
        if (cursor) params.set("cursor", cursor);
        const data = await request(`/api/v1/me/creator-studio/stories?${params}`, { method: "GET", identity: capturedOwner });
        if (!current(ticket)) throw failure(0, "stale");
        if (!Array.isArray(data?.items) || data.items.length > 30 || !(data.nextCursor === null || uuid(data.nextCursor))) throw failure(0, "invalid");
        for (const row of data.items) {
          if (!uuid(row?.workId) || !validText(row.title?.value, 1000) || typeof row.publication?.published !== "boolean" ||
              !(row.publication.activeReleaseId === null || uuid(row.publication.activeReleaseId)) ||
              row.publication.published && !uuid(row.publication.activeReleaseId) || ids.has(row.workId.toLowerCase())) throw failure(0, "invalid");
          ids.add(row.workId.toLowerCase());
          if (row.publication.published === true) rows.push({ id: row.workId.toLowerCase(), releaseId: row.publication.activeReleaseId.toLowerCase(), title: row.title.value });
        }
        cursor = data.nextCursor?.toLowerCase() || null;
        if (++count > 40 || ids.size > 1000 || cursor && cursors.has(cursor)) throw failure(0, "invalid");
        if (cursor) cursors.add(cursor);
      } while (cursor);
      return rows;
    }
    async function loadCatalog(expectedRevision = revision) {
      const incomingRevision = revision;
      syncContext(); if (!owner || expectedRevision !== incomingRevision || busy() || !discard()) return;
      const capturedOwner = owner, capturedLanguage = language, ticket = ++revision;
      catalog = []; catalogVerified = false; target = null; clearList(); phase = "catalog"; messageKey = "catalogLoading"; emit();
      try {
        const rows = await readCatalog(capturedOwner, capturedLanguage, ticket);
        if (!current(ticket)) return;
        catalog = rows; catalogVerified = true; phase = "idle"; messageKey = rows.length ? "idle" : "emptyCatalog"; emit();
      } catch (error) { if (current(ticket)) fail(error); }
    }
    function selectWork(id, expectedRevision = revision) {
      if (!allowed(expectedRevision) || !catalogVerified || !discard()) { emit(); return; }
      revision++; target = catalog.find(work => sameId(work.id, id)) || null; clearList(); phase = "idle"; messageKey = "idle"; emit();
    }
    async function loadList(direction = "first", expectedRevision = revision) {
      if (!allowed(expectedRevision) || !targetReady() || busy() || !discard()) return;
      let index = 0, cursor = null;
      if (direction === "next") {
        if (!list?.nextCursor || pageIndex < 0 || pageIndex >= 99) return;
        index = pageIndex + 1; cursor = list.nextCursor;
      } else if (direction === "previous") {
        if (pageIndex <= 0) return;
        index = pageIndex - 1; cursor = pages[index].cursor;
      } else if (direction !== "first") return;
      if (direction === "first") clearList();
      const scope = target, capturedOwner = owner, ticket = ++revision;
      list = null; selected = null; clearDetail(); phase = "list"; messageKey = "loading"; emit();
      try {
        const params = new URLSearchParams({ limit: "8" }); if (cursor) params.set("cursor", cursor);
        const value = parseList(await request(`/api/v1/me/creator-studio/stories/${scope.id}/shared-branches?${params}`,
          { method: "GET", identity: capturedOwner }), scope);
        if (!current(ticket)) return;
        if (releaseChecksum && value.releaseChecksum !== releaseChecksum) throw failure(409);
        if (value.nextCursor && (value.nextCursor === cursor || pages.slice(0, index + 1).some(page => page.cursor === value.nextCursor)) ||
            pages[index + 1] && value.nextCursor !== pages[index + 1].cursor || value.items.some(item =>
              pages.some((page, position) => position !== index && page.ids.includes(item.sharedResultId)))) throw failure(0, "invalid");
        releaseChecksum = value.releaseChecksum; pages[index] = { cursor, ids: value.items.map(item => item.sharedResultId) };
        pages.length = Math.max(index + 1, pages.length); pageIndex = index; list = value; phase = "idle"; messageKey = value.items.length ? "ready" : "empty"; emit();
      } catch (error) { if (current(ticket)) fail(error); }
    }
    async function openItem(id, expectedRevision = revision) {
      if (!allowed(expectedRevision) || !targetReady() || busy() || !discard()) return;
      const item = list?.items.find(row => sameId(row.sharedResultId, id)); if (!item) return;
      const scope = target, capturedOwner = owner, ticket = ++revision;
      clearDetail(); selected = item.sharedResultId; phase = "detail"; messageKey = "opening"; emit();
      try {
        const value = await parseDetail(await request(`/api/v1/me/creator-studio/stories/${scope.id}/shared-branches/${item.sharedResultId}/visual-review`,
          { method: "GET", identity: capturedOwner }), scope, item);
        if (!current(ticket)) return;
        detail = value; batch = value.currentBatch; prompt = batch?.promptText ?? value.proposedPrompt; baseline = prompt;
        list.items.find(row => row.sharedResultId === selected).status = batch?.status || "unreviewed";
        phase = "ready"; messageKey = "opened"; emit();
      } catch (error) { if (current(ticket)) fail(error); }
    }
    function edit(text, expectedRevision = revision) {
      if (!allowed(expectedRevision) || !editable() || typeof text !== "string") return;
      revision++; prompt = text; checked = false; attempt = null; messageKey = validPrompt(text) ? text === baseline ? "opened" : "dirty" : "invalidPrompt"; emit();
    }
    function acknowledge(value, expectedRevision = revision) {
      if (!allowed(expectedRevision) || !editable() || batch?.status !== "draft" || prompt !== batch.promptText) return;
      revision++; checked = value === true; emit();
    }
    async function verifyRelease(scope, capturedOwner, capturedLanguage, ticket) {
      const latest = await readCatalog(capturedOwner, capturedLanguage, ticket);
      if (!latest.some(work => sameId(work.id, scope.id) && sameId(work.releaseId, scope.releaseId))) throw failure(409);
    }
    async function save(expectedRevision = revision, retry = false) {
      if (!allowed(expectedRevision) || !targetReady() || busy()) return;
      if (retry ? !(phase === "error" && attempt && locked) : !(editable() && validPrompt(prompt) && (!batch || prompt !== batch.promptText))) return;
      const scope = target, item = list.items.find(row => row.sharedResultId === selected), capturedOwner = owner, capturedLanguage = language;
      if (!retry) {
        const key = globalThis.crypto?.randomUUID?.(); if (!uuid(key)) { fail(failure(0, "invalid")); return; }
        attempt = { body: { expectedSourceChecksum: detail.sourceChecksum, expectedProfilePinHash: detail.profilePinHash, idempotencyKey: key, promptText: prompt } };
      }
      const body = clone(attempt.body), ticket = ++revision;
      checked = false; phase = "saving"; messageKey = "saving"; emit();
      try {
        await verifyRelease(scope, capturedOwner, capturedLanguage, ticket); if (!current(ticket)) return;
        const value = await parseBatch(await request(`/api/v1/me/creator-studio/stories/${scope.id}/shared-branches/${item.sharedResultId}/visual-review/drafts`,
          { method: "POST", identity: capturedOwner, body }), scope, item, { status: "draft", promptText: body.promptText });
        if (!current(ticket)) return;
        batch = value; detail.currentBatch = value; baseline = prompt = value.promptText; attempt = null; locked = false;
        list.items.find(row => row.sharedResultId === selected).status = "draft"; phase = "ready"; messageKey = "saved"; emit();
      } catch (error) { if (current(ticket)) fail(error, true); }
    }
    async function approve(expectedRevision = revision) {
      if (!allowed(expectedRevision) || !targetReady() || !canApprove()) return;
      const scope = target, item = list.items.find(row => row.sharedResultId === selected), saved = clone(batch), capturedOwner = owner, capturedLanguage = language;
      const body = { expectedSourceChecksum: detail.sourceChecksum, expectedProfilePinHash: detail.profilePinHash,
        expectedBatchChecksum: saved.batchChecksum, expectedRevision: saved.revision, sceneReviewed: true };
      const ticket = ++revision; checked = false; phase = "approving"; messageKey = "approving"; emit();
      try {
        await verifyRelease(scope, capturedOwner, capturedLanguage, ticket); if (!current(ticket)) return;
        const value = await parseBatch(await request(`/api/v1/me/creator-studio/stories/${scope.id}/shared-branches/${item.sharedResultId}/visual-review/drafts/${saved.batchId}/approve`,
          { method: "POST", identity: capturedOwner, body }), scope, item,
          { status: "approved", batchId: saved.batchId, batchChecksum: saved.batchChecksum, batchVersion: saved.batchVersion, promptText: saved.promptText, promptSha256: saved.promptSha256 });
        if (!current(ticket)) return;
        batch = value; detail.currentBatch = value; list.items.find(row => row.sharedResultId === selected).status = "approved";
        phase = "ready"; messageKey = "done"; emit();
      } catch (error) { if (current(ticket)) fail(error); }
    }
    return { snapshot, syncContext, invalidate, loadCatalog, selectWork, loadList, openItem, edit, acknowledge, save, approve };
  }
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  function mount(host) {
    const api = window.LuminaCreatorStudioApi, shell = document.getElementById("studioShell"), section = document.getElementById("writer-manuscript");
    if (!host || host.dataset.branchReviewMounted || !api?.fetch || !api.identity || !api.isCurrent || !shell || !section) return null;
    host.dataset.branchReviewMounted = "true";
    const visible = () => !shell.hidden && section.classList.contains("is-active");
    const locale = () => window.luminaI18n?.getLocale?.() || document.documentElement.lang || "ko";
    let controller, composing = false, pendingFocus = null;
    function render(state) {
      const words = copy[state.locale], t = (key, count) => (words[key] || "").replace("{count}", String(count));
      // Keep the live input node during IME composition, but revoke approval immediately.
      if (composing && state.detail && state.editable && host.querySelector("[data-branch-prompt]")) {
        for (const node of host.querySelectorAll("[data-branch-revision]")) node.dataset.branchRevision = String(state.revision);
        const ack = host.querySelector("[data-branch-ack]"); if (ack) { ack.checked = false; ack.disabled = true; }
        for (const node of host.querySelectorAll('[data-branch-action="save"], [data-branch-action="approve"]')) node.disabled = true;
        return;
      }
      if (!state.detail) composing = false;
      const active = document.activeElement, focusKey = host.contains(active) ? active?.dataset.branchFocus : null;
      const selection = focusKey === "prompt" ? [active.selectionStart, active.selectionEnd] : null;
      if (state.messageKey === "session") pendingFocus = null;
      if (state.busy && focusKey && focusKey !== "status") pendingFocus = { key: focusKey };
      const restorePending = !state.busy && pendingFocus && (focusKey === "status" || active === document.body);
      const wantedFocus = state.busy && pendingFocus ? "status" : restorePending ? pendingFocus.key : focusKey;
      const rev = `data-branch-revision="${state.revision}"`;
      const button = (action, label, disabled = false, extra = "", focus = action) => `<button type="button" data-branch-action="${action}" data-branch-focus="${focus}" ${rev} ${extra} ${disabled ? "disabled" : ""}>${escapeHtml(label)}</button>`;
      const ackEnabled = state.editable && state.batch?.status === "draft" && state.prompt === state.batch.promptText;
      host.setAttribute("aria-busy", String(state.busy)); host.lang = state.locale;
      host.innerHTML = `<header class="branch-review-header"><h3 id="writerBranchVisualReviewTitle">${t("title")}</h3>${button("catalog", t("catalog"), state.busy)}</header>
        <div class="branch-review-target"><label for="writerBranchVisualReviewWork">${t("work")}<select id="writerBranchVisualReviewWork" data-branch-work data-branch-focus="work" ${rev} ${!state.catalogVerified || state.busy ? "disabled" : ""}>
        <option value="">${t("choose")}</option>${state.catalog.map(work => `<option value="${work.id}" ${work.id === state.target?.id ? "selected" : ""}>${escapeHtml(work.title)}</option>`).join("")}</select></label>${button("list", t("load"), !state.target || !state.catalogVerified || state.busy)}</div>
        <p class="branch-review-state ${["error", "conflict", "unavailable"].includes(state.phase) ? "is-error" : ""}" role="status" aria-live="polite" tabindex="-1" data-branch-focus="status">${t(state.messageKey)}</p>
        ${state.list ? `<ul class="branch-review-list">${state.list.items.map(item => `<li ${item.sharedResultId === state.selected ? 'aria-current="true"' : ""}><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(localeNames[item.locale])} · ${t(item.status)}</span></div>${button("open", item.sharedResultId === state.selected ? t("reopen") : t("open"), state.busy, `data-branch-id="${item.sharedResultId}"`, `open:${item.sharedResultId}`)}</li>`).join("")}</ul>
        <nav class="branch-review-pages" aria-label="${t("title")}">${button("previous", "&larr;", state.busy || state.pageIndex <= 0)}<span>${t("page", state.pageIndex + 1)}</span>${button("next", "&rarr;", state.busy || !state.list.nextCursor || state.pageIndex >= 99)}</nav>` : ""}
        ${state.detail ? `<div class="branch-review-heading"><h4>${escapeHtml(state.detail.title)}</h4><span>${t("sourceLocale")}: ${escapeHtml(localeNames[state.detail.locale])}</span></div>
        <div class="branch-review-columns"><section class="branch-review-source" aria-labelledby="writerBranchProseTitle"><h4 id="writerBranchProseTitle">${t("prose")}</h4><div class="branch-review-prose" lang="${state.detail.locale}"></div></section>
        <section class="branch-review-guidance" aria-labelledby="writerBranchPromptLabel"><div class="branch-review-guidance-heading"><label id="writerBranchPromptLabel" for="writerBranchVisualPrompt">${t("prompt")}</label><span>${state.dirty ? t("dirty") : t(state.batch?.status || "proposed")}</span></div>
        <textarea id="writerBranchVisualPrompt" data-branch-prompt data-branch-focus="prompt" ${rev} lang="${state.detail.locale}" maxlength="32000" rows="12" spellcheck="true" aria-describedby="writerBranchPromptState" ${state.editable ? "" : "readonly"}></textarea>
        <p id="writerBranchPromptState" class="branch-review-prompt-state">${state.validPrompt ? `${state.prompt.length.toLocaleString(state.locale)} / 32,000` : t("invalidPrompt")}</p></section></div>
        <div class="branch-review-actions">${button("save", t("save"), !state.canSave)}${state.canRetry ? button("retry", t("retry")) : ""}</div>
        <label class="branch-review-ack"><input type="checkbox" data-branch-ack data-branch-focus="ack" ${rev} ${state.checked ? "checked" : ""} ${ackEnabled ? "" : "disabled"}><span>${t("ack")}</span></label>
        <div class="branch-review-actions">${button("approve", t("approve"), !state.canApprove)}</div>` : ""}`;
      const prose = host.querySelector(".branch-review-prose");
      if (prose) prose.textContent = state.detail.prose;
      // Preserve exact server text in state; textarea values normalize line endings visually.
      const input = host.querySelector("[data-branch-prompt]");
      if (input) { input.value = state.prompt; input.style.height = "auto"; input.style.height = `${Math.max(input.scrollHeight + 2, 320)}px`; }
      for (const action of ["previous", "next"]) {
        const node = host.querySelector(`[data-branch-action="${action}"]`);
        if (node) { node.innerHTML = action === "previous" ? "&larr;" : "&rarr;"; node.setAttribute("aria-label", t(action)); node.title = t(action); }
      }
      if (wantedFocus && visible()) {
        const controls = Array.from(host.querySelectorAll("[data-branch-focus]"));
        const fallback = wantedFocus === "save" && ackEnabled ? "ack" : wantedFocus === "approve" || !state.editable ? "status" : "prompt";
        const replacement = controls.find(node => node.dataset.branchFocus === wantedFocus && !node.disabled) ||
          controls.find(node => node.dataset.branchFocus === fallback && !node.disabled);
        if (!state.busy) pendingFocus = null;
        replacement?.focus({ preventScroll: true });
        if (selection && replacement === input) input.setSelectionRange(...selection);
      }
      if (!state.busy) pendingFocus = null;
    }
    controller = createController({ fetch: (url, options) => api.fetch(url, options), identity: () => visible() ? api.identity() : null,
      isCurrent: value => visible() && api.isCurrent(value), locale,
      context: () => JSON.stringify([document.getElementById("writerManuscriptWork")?.value || "", document.getElementById("writerManuscriptLocale")?.value || ""]),
      confirmDiscard: message => window.confirm(message), onChange: render });
    host.addEventListener("change", event => {
      const node = event.target, rev = Number(node.dataset.branchRevision);
      if (node.matches("[data-branch-work]")) controller.selectWork(node.value, rev);
      if (node.matches("[data-branch-ack]")) controller.acknowledge(node.checked, rev);
    });
    host.addEventListener("input", event => {
      const node = event.target;
      if (!composing && !event.isComposing && node.matches("[data-branch-prompt]")) controller.edit(node.value, Number(node.dataset.branchRevision));
    });
    host.addEventListener("compositionstart", event => {
      const node = event.target; if (!node.matches("[data-branch-prompt]")) return;
      composing = true; controller.acknowledge(false, Number(node.dataset.branchRevision));
      for (const button of host.querySelectorAll('[data-branch-action="save"], [data-branch-action="approve"]')) button.disabled = true;
    });
    host.addEventListener("compositionend", event => {
      composing = false;
      const node = event.target;
      if (node.matches("[data-branch-prompt]")) controller.edit(node.value, Number(node.dataset.branchRevision));
    });
    host.addEventListener("click", event => {
      const node = event.target.closest("[data-branch-action]"); if (!node || !host.contains(node) || node.disabled) return;
      const rev = Number(node.dataset.branchRevision);
      const actions = { catalog: () => controller.loadCatalog(rev), list: () => controller.loadList("first", rev), open: () => controller.openItem(node.dataset.branchId, rev),
        previous: () => controller.loadList("previous", rev), next: () => controller.loadList("next", rev), save: () => controller.save(rev), retry: () => controller.save(rev, true), approve: () => controller.approve(rev) };
      actions[node.dataset.branchAction]?.();
    });
    const sync = () => controller.syncContext();
    document.addEventListener("focusin", event => {
      if (pendingFocus && (!host.contains(event.target) || event.target.dataset.branchFocus !== "status")) pendingFocus = null;
    });
    document.addEventListener("pointerdown", event => { if (!host.contains(event.target)) pendingFocus = null; }, true);
    // Ask before user navigation; forced session/visibility changes always erase private state.
    document.addEventListener("click", event => {
      const node = event.target.closest?.("a[href], [data-section]");
      if (!visible() || !node || host.contains(node) || node.getAttribute("data-section") === "writer-manuscript") return;
      const state = controller.snapshot();
      if (state.dirty || state.canRetry) {
        if (!window.confirm(copy[state.locale].discard)) { event.preventDefault(); event.stopImmediatePropagation(); }
        else controller.invalidate();
      }
    }, true);
    window.addEventListener("beforeunload", event => {
      const state = controller.snapshot(); if (visible() && (state.dirty || state.canRetry)) { event.preventDefault(); event.returnValue = ""; }
    });
    for (const name of ["storage", "focus", "lumina:localechange"]) window.addEventListener(name, sync);
    for (const name of ["pagehide", "lumina:auth-expired"]) window.addEventListener(name, () => controller.invalidate());
    document.addEventListener("lumina:auth-expired", () => controller.invalidate());
    document.addEventListener("visibilitychange", sync);
    for (const id of ["writerManuscriptWork", "writerManuscriptLocale"]) document.getElementById(id)?.addEventListener("change", sync);
    if (typeof MutationObserver === "function") {
      new MutationObserver(sync).observe(shell, { attributes: true, attributeFilter: ["hidden"] });
      new MutationObserver(sync).observe(section, { attributes: true, attributeFilter: ["class"] });
      new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    }
    render(controller.snapshot()); sync(); return controller;
  }
  window.LuminaCreatorBranchVisualReview = { createController, mount };
  if (typeof document !== "undefined") mount(document.getElementById("writerBranchVisualReview"));
})();
