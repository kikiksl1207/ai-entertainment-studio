(function () {
  "use strict";
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const localeNames = { ko: "한국어", en: "English", ja: "日本語", "zh-Hans": "简体中文", "zh-Hant": "繁體中文" };
  const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
  const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const text = (value, max) => typeof value === "string" && Array.from(value.trim()).length >= 2 && value.length <= max &&
    !value.includes("\0") && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const copy = {
    ko: { title: "원작 속 캐릭터 사건 검토", works: "내 공개 작품", refresh: "작품 새로고침", choose: "선택", sourceLocale: "검토할 원문 언어", load: "원문 확인", source: "원문", artist: "캐릭터", search: "이름 검색", searchButton: "검색", unready: "준비 전", review: "사건 검토", extract: "선택한 원문 적용", evidence: "근거 원문", kind: "사건 종류", action: "행동", dialogue: "대사", memory: "확인한 사건 요약", acknowledge: "이 캐릭터가 위 원문에서 실제로 행동하거나 대화했음을 확인했습니다.", approve: "사건 승인", approvals: "현재 기준의 확인 기록", revoke: "철회", revokeTitle: "이 사건 승인을 철회할까요?", cancel: "취소", confirm: "철회하기", previous: "이전 원문", next: "다음 원문", approved: "승인됨", revoked: "철회됨", part: "파트", scene: "장면", beat: "본문", idle: "공개 작품을 확인해 주세요.", loading: "확인 중입니다.", empty: "현재 표시할 원문이 없습니다.", ready: "검토할 원문과 캐릭터를 선택해 주세요.", reviewing: "원문 구간을 선택하고 사건을 확인해 주세요.", saved: "사건 승인을 저장했습니다.", withdrawn: "사건 승인을 철회했습니다.", failed: "결과를 확인하지 못했습니다. 다시 확인해 주세요.", changed: "접속 상태나 검토 기준이 바뀌었습니다. 원문부터 다시 확인해 주세요.", missing: "이 언어의 원문이 없습니다.", boundary: "독자의 읽기 기록·캐릭터챗 반영: 미연결", more: "표시 한도를 넘는 확인 기록이 있습니다." },
    en: { title: "Canonical Character Event Review", works: "My Published Stories", refresh: "Refresh Stories", choose: "Select", sourceLocale: "Source Language", load: "Load Source", source: "Source", artist: "Character", search: "Search Name", searchButton: "Search", unready: "Not Ready", review: "Review Event", extract: "Use Selected Passage", evidence: "Source Evidence", kind: "Event Type", action: "Action", dialogue: "Dialogue", memory: "Reviewed Event Summary", acknowledge: "I confirm that this character acted or spoke in the source passage above.", approve: "Approve Event", approvals: "Current Review Records", revoke: "Withdraw", revokeTitle: "Withdraw this event approval?", cancel: "Cancel", confirm: "Withdraw Approval", previous: "Previous Source", next: "Next Source", approved: "Approved", revoked: "Withdrawn", part: "Part", scene: "Scene", beat: "Passage", idle: "Check your published stories.", loading: "Checking.", empty: "No source passages on this page.", ready: "Select a passage and character to review.", reviewing: "Select a source passage and review the event.", saved: "Event approval saved.", withdrawn: "Event approval withdrawn.", failed: "The result could not be confirmed. Check again.", changed: "Your session or review criteria changed. Check the source again.", missing: "Source unavailable in this language.", boundary: "Reader receipts and character chat: not connected", more: "Additional review records exceed the display limit." },
    ja: { title: "原作のキャラクター事件確認", works: "自分の公開作品", refresh: "作品を更新", choose: "選択", sourceLocale: "原文の言語", load: "原文を確認", source: "原文", artist: "キャラクター", search: "名前検索", searchButton: "検索", unready: "準備前", review: "事件を確認", extract: "選択した原文を使用", evidence: "根拠の原文", kind: "事件の種類", action: "行動", dialogue: "台詞", memory: "確認した事件の要約", acknowledge: "このキャラクターが上記の原文で実際に行動または会話したことを確認しました。", approve: "事件を承認", approvals: "現在の確認記録", revoke: "撤回", revokeTitle: "この事件の承認を撤回しますか？", cancel: "キャンセル", confirm: "承認を撤回", previous: "前の原文", next: "次の原文", approved: "承認済み", revoked: "撤回済み", part: "パート", scene: "シーン", beat: "本文", idle: "公開作品を確認してください。", loading: "確認中です。", empty: "このページに原文はありません。", ready: "原文とキャラクターを選択してください。", reviewing: "原文の範囲を選び、事件を確認してください。", saved: "事件の承認を保存しました。", withdrawn: "事件の承認を撤回しました。", failed: "結果を確認できませんでした。再確認してください。", changed: "接続状態または確認基準が変わりました。原文から再確認してください。", missing: "この言語の原文がありません。", boundary: "読者の閲覧記録・キャラクターチャット：未接続", more: "表示上限を超える確認記録があります。" },
    "zh-Hans": { title: "原作角色事件审核", works: "我的公开作品", refresh: "刷新作品", choose: "选择", sourceLocale: "原文语言", load: "查看原文", source: "原文", artist: "角色", search: "搜索名字", searchButton: "搜索", unready: "尚未准备", review: "审核事件", extract: "使用选中原文", evidence: "原文依据", kind: "事件类型", action: "行动", dialogue: "台词", memory: "已审核事件摘要", acknowledge: "我确认该角色在上述原文中确实行动或说话。", approve: "批准事件", approvals: "当前审核记录", revoke: "撤回", revokeTitle: "撤回此事件的批准？", cancel: "取消", confirm: "撤回批准", previous: "上一页原文", next: "下一页原文", approved: "已批准", revoked: "已撤回", part: "部分", scene: "场景", beat: "段落", idle: "请查看您的公开作品。", loading: "正在检查。", empty: "本页没有原文。", ready: "请选择原文和角色。", reviewing: "请选择原文范围并审核事件。", saved: "已保存事件批准。", withdrawn: "已撤回事件批准。", failed: "无法确认结果。请重新检查。", changed: "会话或审核依据已更改。请重新查看原文。", missing: "此语言没有原文。", boundary: "读者阅读记录及角色聊天：未连接", more: "审核记录超过显示上限。" },
    "zh-Hant": { title: "原作角色事件審核", works: "我的公開作品", refresh: "重新整理作品", choose: "選擇", sourceLocale: "原文語言", load: "查看原文", source: "原文", artist: "角色", search: "搜尋名字", searchButton: "搜尋", unready: "尚未準備", review: "審核事件", extract: "使用選取原文", evidence: "原文依據", kind: "事件類型", action: "行動", dialogue: "台詞", memory: "已審核事件摘要", acknowledge: "我確認此角色在上述原文中確實行動或說話。", approve: "核准事件", approvals: "目前審核記錄", revoke: "撤回", revokeTitle: "撤回此事件的核准？", cancel: "取消", confirm: "撤回核准", previous: "上一頁原文", next: "下一頁原文", approved: "已核准", revoked: "已撤回", part: "部分", scene: "場景", beat: "段落", idle: "請查看您的公開作品。", loading: "正在檢查。", empty: "本頁沒有原文。", ready: "請選擇原文和角色。", reviewing: "請選取原文範圍並審核事件。", saved: "已儲存事件核准。", withdrawn: "已撤回事件核准。", failed: "無法確認結果。請重新檢查。", changed: "工作階段或審核依據已變更。請重新查看原文。", missing: "此語言沒有原文。", boundary: "讀者閱讀記錄及角色聊天：未連接", more: "審核記錄超過顯示上限。" }
  };
  function createController({ fetch, identity, isCurrent, locale = () => "ko", randomUUID = () => globalThis.crypto.randomUUID(), onChange = () => {} }) {
    let owner = null, language = null, sourceLocale = "ko", ticket = 0, revision = 0, pending = null;
    let state = { busy: false, message: "idle", works: [], work: null, catalog: null, pages: [], pageIndex: -1,
      beatId: null, artists: [], artistId: null, review: null, kind: "action", evidenceStart: null,
      evidenceText: "", memoryText: "", checked: false, revokeId: null };
    const snapshot = () => clone({ ...state, revision, locale: language || "ko", sourceLocale });
    const emit = () => onChange(snapshot());
    const clearReview = () => Object.assign(state, { review: null, kind: "action", evidenceStart: null, evidenceText: "", memoryText: "", checked: false, revokeId: null });
    function invalidate(message = "changed") {
      ticket++; revision++; pending = null;
      state = { busy: false, message, works: [], work: null, catalog: null, pages: [], pageIndex: -1,
        beatId: null, artists: [], artistId: null, review: null, kind: "action", evidenceStart: null,
        evidenceText: "", memoryText: "", checked: false, revokeId: null };
      emit();
    }
    function syncContext() {
      const current = identity(), nextLocale = locales.includes(locale()) ? locale() : "ko";
      if (!current?.ownerId || !isCurrent(current) || !owner || owner.ownerId !== current.ownerId || owner.epoch !== current.epoch || language !== nextLocale) {
        owner = current?.ownerId && isCurrent(current) ? clone(current) : null;
        language = nextLocale; invalidate(owner ? "idle" : "changed");
      }
      return Boolean(owner && isCurrent(owner));
    }
    const active = rev => syncContext() && !state.busy && (rev === undefined || rev === revision);
    const path = () => `/api/v1/me/creator-studio/stories/${state.work.id}/interactions`;
    async function run(operation) {
      const serial = ++ticket, current = clone(owner);
      state.busy = true; state.message = "loading"; revision++; emit();
      const valid = () => serial === ticket && isCurrent(current) && owner?.ownerId === current.ownerId && owner?.epoch === current.epoch;
      const request = async (url, options) => {
        if (!valid()) throw new Error("context");
        const value = await fetch(url, options);
        if (!valid()) throw new Error("context");
        return value;
      };
      try { const apply = await operation(current, request); if (valid()) { apply(); revision++; } }
      catch { if (valid()) { clearReview(); state.message = "failed"; revision++; } }
      finally { if (valid()) { state.busy = false; emit(); } else syncContext(); }
    }
    async function loadWorks() {
      if (!active()) return;
      state.work = null; state.catalog = null; state.works = []; state.pages = []; state.pageIndex = -1; state.artists = [];
      state.beatId = null; state.artistId = null; clearReview(); pending = null;
      await run(async (current, request) => {
        const works = [], ids = new Set(), cursors = new Set(); let cursor = null;
        for (let page = 0; page < 40; page++) {
          const params = new URLSearchParams({ locale: language, limit: "30" }); if (cursor) params.set("cursor", cursor);
          const value = await request(`/api/v1/me/creator-studio/stories?${params}`, { identity: current });
          if (!Array.isArray(value?.items) || value.items.length > 30 || !(value.nextCursor === null || uuid(value.nextCursor))) throw new Error("catalog");
          for (const item of value.items) {
            if (!uuid(item.workId) || ids.has(item.workId) || typeof item.title?.value !== "string" || !item.publication) throw new Error("work");
            ids.add(item.workId);
            if (item.publication.published === true && item.publication.status === "published") {
              if (!uuid(item.publication.activeReleaseId)) throw new Error("release");
              works.push({ id: item.workId, title: item.title.value, releaseId: item.publication.activeReleaseId });
            }
          }
          cursor = value.nextCursor;
          if (!cursor) return () => { state.works = works; state.message = works.length ? "ready" : "empty"; };
          if (cursors.has(cursor)) throw new Error("cursor cycle"); cursors.add(cursor);
        }
        throw new Error("catalog incomplete");
      });
    }
    function selectWork(id, rev) {
      if (!active(rev)) return;
      state.work = state.works.find(work => work.id === id) || null; state.catalog = null; state.pages = []; state.pageIndex = -1;
      state.beatId = null; state.artistId = null; state.artists = []; clearReview(); pending = null; revision++; emit();
    }
    function setSourceLocale(value, rev) {
      if (!active(rev) || !locales.includes(value) || value === sourceLocale) return;
      sourceLocale = value; state.catalog = null; state.pages = []; state.pageIndex = -1; state.beatId = null;
      clearReview(); pending = null; revision++; emit();
    }
    function parseCatalog(value, work, current, expected) {
      if (value?.contract !== "story-canonical-interaction-catalog-v1" || value.ownerUserId !== current.ownerId || value.workId !== work.id ||
          value.releaseId !== work.releaseId || value.locale !== sourceLocale || !hash(value.releaseChecksum) || !uuid(value.manuscriptVersionId) || !hash(value.manuscriptHash) ||
          !Array.isArray(value.items) || value.items.length > 8 || !(value.nextAfterBeatId === null || uuid(value.nextAfterBeatId)) ||
          (expected && (expected.releaseId !== value.releaseId || expected.releaseChecksum !== value.releaseChecksum))) throw new Error("source catalog");
      const seen = new Set();
      for (const item of value.items) {
        if (![item.beatId, item.sceneId, item.partId].every(uuid) || seen.has(item.beatId) ||
            ![item.partPosition, item.scenePosition, item.beatPosition].every(n => Number.isSafeInteger(n) && n >= 0) ||
            !["paragraph", "narration", "dialogue"].includes(item.beatType) || typeof item.sourceAvailable !== "boolean" ||
            (item.sourceAvailable ? !text(item.sourceText, 64000) : item.sourceText !== null)) throw new Error("source item");
        seen.add(item.beatId);
      }
      if (value.nextAfterBeatId && (!value.items.length || value.nextAfterBeatId !== value.items.at(-1).beatId)) throw new Error("source cursor");
      return clone(value);
    }
    async function loadBeats(direction = "first", rev) {
      if (!active(rev) || !state.work) return;
      const work = clone(state.work), old = state.catalog;
      let index = direction === "previous" ? state.pageIndex - 1 : direction === "next" ? state.pageIndex + 1 : 0;
      if (index < 0 || (direction === "next" && !old?.nextAfterBeatId)) return;
      const after = index ? state.pages[index] || (direction === "next" ? old.nextAfterBeatId : null) : null;
      const expected = index ? old : null;
      if (direction === "first") { state.pages = [null]; state.pageIndex = -1; }
      state.catalog = null; state.beatId = null; clearReview(); pending = null;
      await run(async (current, request) => {
        const params = new URLSearchParams({ locale: sourceLocale });
        if (after) { params.set("afterBeatId", after); params.set("expectedReleaseId", expected.releaseId); params.set("expectedReleaseChecksum", expected.releaseChecksum); }
        const value = parseCatalog(await request(`${path()}/beats?${params}`, { identity: current }), work, current, expected);
        if (value.nextAfterBeatId && state.pages.includes(value.nextAfterBeatId)) throw new Error("source cycle");
        return () => { state.catalog = value; state.pages[index] = after; state.pageIndex = index; state.message = value.items.length ? "ready" : "empty"; };
      });
    }
    async function searchArtists(query, rev) {
      if (!active(rev) || !state.work || typeof query !== "string" || query.trim().length > 80) return;
      state.artists = []; state.artistId = null; clearReview(); pending = null;
      await run(async (current, request) => {
        const params = new URLSearchParams({ q: query.trim(), take: "30" });
        const value = await request(`/api/v1/me/stories/${state.work.id}/artist-candidates?${params}`, { identity: current });
        if (!Array.isArray(value?.engaged) || !Array.isArray(value?.searchResults) || value.engaged.length > 400 || value.searchResults.length > 30) throw new Error("artists");
        const rows = new Map();
        for (const row of [...value.engaged, ...value.searchResults]) {
          if (!uuid(row.artistId) || typeof row.displayName !== "string" || !row.displayName.trim() || row.displayName.length > 120 || typeof row.visualIdentityReady !== "boolean") throw new Error("artist");
          const previous = rows.get(row.artistId);
          if (previous && (previous.displayName !== row.displayName || previous.visualIdentityReady !== row.visualIdentityReady)) throw new Error("artist changed");
          rows.set(row.artistId, { id: row.artistId, displayName: row.displayName, ready: row.visualIdentityReady });
        }
        return () => { state.artists = [...rows.values()]; state.message = state.artists.length ? "ready" : "empty"; };
      });
    }
    function selectBeat(id, rev) {
      if (!active(rev)) return;
      state.beatId = state.catalog?.items.find(item => item.beatId === id && item.sourceAvailable)?.beatId || null;
      clearReview(); pending = null; revision++; emit();
    }
    function selectArtist(id, rev) {
      if (!active(rev)) return;
      state.artistId = state.artists.find(item => item.id === id && item.ready)?.id || null;
      clearReview(); pending = null; revision++; emit();
    }
    function parseApproval(row, review) {
      const pin = review.identity;
      if (row?.contract !== "story-canonical-interaction-approval-v1" || !uuid(row.approvalId) || row.workId !== pin.workId || row.beatId !== pin.beatId ||
          row.artistId !== pin.artistId || row.locale !== pin.locale || row.sourceChecksum !== pin.sourceChecksum || row.identityPinHash !== pin.identityPinHash ||
          !hash(row.approvalChecksum) || row.readerMemoryApplied !== false || !["action", "dialogue"].includes(row.interactionKind) ||
          !Number.isSafeInteger(row.evidenceStart) || row.evidenceStart < 0 || !text(row.evidenceText, 2000) || !text(row.memoryText, 400) ||
          review.sourceText.slice(row.evidenceStart, row.evidenceStart + row.evidenceText.length) !== row.evidenceText ||
          (row.interactionKind === "dialogue" && row.memoryText !== row.evidenceText) ||
          !((row.status === "approved" && row.revision === 1 && row.revokedAt === null) || (row.status === "revoked" && row.revision === 2 && typeof row.revokedAt === "string"))) throw new Error("approval");
      return clone(row);
    }
    async function loadReview(rev) {
      if (!active(rev) || !state.work || !state.catalog || !state.beatId || !state.artistId) return;
      const beat = state.catalog.items.find(item => item.beatId === state.beatId), artist = state.artists.find(item => item.id === state.artistId);
      if (!beat?.sourceAvailable || !artist?.ready) return;
      clearReview();
      await run(async (current, request) => {
        const params = new URLSearchParams({ artistId: artist.id, locale: sourceLocale });
        const value = await request(`${path()}/beats/${beat.beatId}?${params}`, { identity: current });
        const pin = value?.identity;
        if (value?.contract !== "story-canonical-interaction-review-v1" || value.proposalApproved !== false || value.readerMemoryApplied !== false ||
            pin?.ownerUserId !== current.ownerId || pin.workId !== state.work.id || pin.releaseId !== state.catalog.releaseId || pin.releaseChecksum !== state.catalog.releaseChecksum ||
            pin.manuscriptVersionId !== state.catalog.manuscriptVersionId || pin.manuscriptHash !== state.catalog.manuscriptHash ||
            pin.beatId !== beat.beatId || pin.sceneId !== beat.sceneId || pin.partId !== beat.partId || pin.artistId !== artist.id || pin.locale !== sourceLocale ||
            !uuid(pin.identityProfileId) || !hash(pin.identityPinHash) || !hash(pin.sourceChecksum) || value.sourceText !== beat.sourceText ||
            value.artistDisplayName !== artist.displayName || !Array.isArray(value.approvals) || value.approvals.length > 50 || typeof value.moreApprovals !== "boolean") throw new Error("review");
        const seen = new Set();
        const approvals = value.approvals.map(row => { const parsed = parseApproval(row, value); if (seen.has(parsed.approvalId)) throw new Error("duplicate approval"); seen.add(parsed.approvalId); return parsed; });
        return () => { state.review = { ...clone(value), approvals }; state.message = "reviewing"; };
      });
    }
    function setEvidence(start, end, rev) {
      if (!active(rev) || !state.review || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > state.review.sourceText.length) return;
      const selected = state.review.sourceText.slice(start, end);
      if (!text(selected, 2000)) return;
      state.evidenceStart = start; state.evidenceText = selected; state.checked = false;
      if (state.kind === "dialogue") state.memoryText = selected.length <= 400 ? selected : "";
      revision++; emit();
    }
    function setKind(value, rev) {
      if (!active(rev) || !state.review || !["action", "dialogue"].includes(value)) return;
      state.kind = value; state.checked = false; state.memoryText = value === "dialogue" && state.evidenceText.length <= 400 ? state.evidenceText : ""; revision++; emit();
    }
    function setMemory(value, rev) {
      if (!active(rev) || !state.review || state.kind !== "action" || typeof value !== "string" || value.length > 400) return;
      state.memoryText = value; state.checked = false; revision++; emit();
    }
    function acknowledge(value, rev) {
      if (!active(rev) || !state.review) return; state.checked = value === true; revision++; emit();
    }
    async function approve(rev) {
      if (!active(rev) || !state.review || !state.checked || !text(state.evidenceText, 2000) || !text(state.memoryText, 400) ||
          (state.kind === "dialogue" && state.memoryText !== state.evidenceText)) return;
      const review = clone(state.review), pin = review.identity;
      const body = { artistId: pin.artistId, locale: pin.locale, expectedSourceChecksum: pin.sourceChecksum,
        expectedIdentityPinHash: pin.identityPinHash, interactionKind: state.kind, evidenceStart: state.evidenceStart,
        evidenceText: state.evidenceText, memoryText: state.memoryText, interactionReviewed: true };
      const signature = JSON.stringify(body);
      try {
        if (!pending || pending.signature !== signature) pending = { signature, key: randomUUID() };
        if (!uuid(pending.key)) throw new Error("request key");
      } catch { state.checked = false; state.message = "failed"; revision++; emit(); return; }
      state.checked = false;
      await run(async (current, request) => {
        const value = parseApproval(await request(`${path()}/beats/${pin.beatId}/approve`, {
          identity: current, method: "POST", _retried: true, body: { ...body, idempotencyKey: pending.key },
        }), review);
        if (value.interactionKind !== body.interactionKind || value.evidenceStart !== body.evidenceStart || value.evidenceText !== body.evidenceText || value.memoryText !== body.memoryText) throw new Error("approval receipt");
        return () => { state.review = { ...review, approvals: [value, ...review.approvals.filter(row => row.approvalId !== value.approvalId)].slice(0, 50) };
          state.evidenceText = ""; state.memoryText = ""; state.evidenceStart = null; state.message = value.status === "approved" ? "saved" : "withdrawn"; };
      });
    }
    function requestRevoke(id, rev) {
      if (!active(rev) || !state.review?.approvals.some(row => row.approvalId === id && row.status === "approved")) return;
      state.revokeId = id; revision++; emit();
    }
    function cancelRevoke() { if (!state.busy) { state.revokeId = null; revision++; emit(); } }
    async function confirmRevoke(rev) {
      if (!active(rev)) return;
      const review = clone(state.review), row = review?.approvals.find(item => item.approvalId === state.revokeId && item.status === "approved");
      if (!row) return; state.revokeId = null;
      await run(async (current, request) => {
        const value = parseApproval(await request(`${path()}/${row.approvalId}/revoke`, { identity: current,
          method: "POST", _retried: true, body: { expectedApprovalChecksum: row.approvalChecksum, expectedRevision: 1 } }), review);
        if (value.approvalId !== row.approvalId || value.status !== "revoked" || value.approvalChecksum !== row.approvalChecksum) throw new Error("withdrawal receipt");
        return () => { state.review = { ...review, approvals: review.approvals.map(item => item.approvalId === value.approvalId ? value : item) }; state.message = "withdrawn"; state.checked = false; };
      });
    }
    return { snapshot, syncContext, invalidate, loadWorks, selectWork, setSourceLocale, loadBeats, searchArtists, selectBeat, selectArtist,
      loadReview, setEvidence, setKind, setMemory, acknowledge, approve, requestRevoke, cancelRevoke, confirmRevoke };
  }
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function mount(host) {
    const api = window.LuminaCreatorStudioApi, shell = document.getElementById("studioShell"), section = document.getElementById("writer-manuscript");
    if (!host || host.dataset.interactionsMounted || !api?.fetch || !api.identity || !api.isCurrent || !shell || !section) return null;
    host.dataset.interactionsMounted = "true";
    const visible = () => !shell.hidden && section.classList.contains("is-active");
    let controller, searchValue = "", searchContext = null;
    function render(state) {
      const t = copy[state.locale] || copy.ko, rev = `data-interaction-revision="${state.revision}"`;
      const focused = document.activeElement, focusKey = host.contains(focused) ? focused.dataset.interactionFocus : null;
      const selection = focusKey === "memory" ? [focused.selectionStart, focused.selectionEnd] : null;
      const button = (action, label, disabled = false) => `<button type="button" data-interaction-action="${action}" data-interaction-focus="${action}" ${rev} ${disabled || state.busy ? "disabled" : ""}>${escape(label)}</button>`;
      const selected = state.catalog?.items.find(item => item.beatId === state.beatId);
      host.innerHTML = `<header><h3 id="writerInteractionsTitle">${t.title}</h3>${button("works", t.refresh)}</header>
        <div class="writer-interaction-controls"><label>${t.works}<select data-interaction-work data-interaction-focus="work" ${rev} ${state.busy ? "disabled" : ""}><option value="">${t.choose}</option>${state.works.map(work => `<option value="${work.id}" ${work.id === state.work?.id ? "selected" : ""}>${escape(work.title)}</option>`).join("")}</select></label>
        <label>${t.sourceLocale}<select data-interaction-locale data-interaction-focus="locale" ${rev} ${state.busy ? "disabled" : ""}>${locales.map(locale => `<option value="${locale}" ${locale === state.sourceLocale ? "selected" : ""}>${localeNames[locale]}</option>`).join("")}</select></label>${button("source", t.load, !state.work)}</div>
        <p class="writer-interaction-state" role="status" aria-live="polite">${t[state.message]}</p>
        ${state.catalog ? `<div class="writer-interaction-controls"><label>${t.source}<select data-interaction-beat data-interaction-focus="beat" ${rev} ${state.busy ? "disabled" : ""}><option value="">${t.choose}</option>${state.catalog.items.map(item => `<option value="${item.beatId}" ${item.sourceAvailable ? "" : "disabled"} ${item.beatId === state.beatId ? "selected" : ""}>${t.part} ${item.partPosition} · ${t.scene} ${item.scenePosition} · ${t.beat} ${item.beatPosition}${item.sourceAvailable ? "" : ` · ${t.missing}`}</option>`).join("")}</select></label><nav>${button("previous", "←", state.pageIndex <= 0)}<span>${state.pageIndex + 1}</span>${button("next", "→", !state.catalog.nextAfterBeatId)}</nav></div>` : ""}
        ${selected && !state.review ? `<label class="writer-interaction-source">${t.source}<textarea data-interaction-source readonly rows="8">${escape(selected.sourceText)}</textarea></label>` : ""}
        ${state.work ? `<div class="writer-interaction-controls"><label>${t.search}<input data-interaction-search data-interaction-focus="searchInput" maxlength="80" value="${escape(searchValue)}" /></label>${button("search", t.searchButton)}<label>${t.artist}<select data-interaction-artist data-interaction-focus="artist" ${rev} ${state.busy ? "disabled" : ""}><option value="">${t.choose}</option>${state.artists.map(artist => `<option value="${artist.id}" ${artist.ready ? "" : "disabled"} ${artist.id === state.artistId ? "selected" : ""}>${escape(artist.displayName)}${artist.ready ? "" : ` · ${t.unready}`}</option>`).join("")}</select></label>${button("review", t.review, !state.beatId || !state.artistId)}</div>` : ""}
        ${state.review ? `<div class="writer-interaction-editor"><h4>${escape(state.review.artistDisplayName)}</h4><label>${t.source}<textarea data-interaction-evidence-source rows="8" readonly>${escape(state.review.sourceText)}</textarea></label>${button("extract", t.extract)}
        <label>${t.evidence}<textarea data-interaction-evidence rows="3" readonly>${escape(state.evidenceText)}</textarea></label>
        <label>${t.kind}<select data-interaction-kind data-interaction-focus="kind" ${rev} ${state.busy ? "disabled" : ""}><option value="action" ${state.kind === "action" ? "selected" : ""}>${t.action}</option><option value="dialogue" ${state.kind === "dialogue" ? "selected" : ""}>${t.dialogue}</option></select></label>
        <label>${t.memory}<textarea data-interaction-memory data-interaction-focus="memory" rows="3" maxlength="400" ${rev} ${state.kind === "dialogue" ? "readonly" : ""} ${state.busy ? "disabled" : ""}>${escape(state.memoryText)}</textarea></label>
        <label class="writer-interaction-check"><input type="checkbox" data-interaction-ack data-interaction-focus="ack" ${rev} ${state.checked ? "checked" : ""} ${state.busy ? "disabled" : ""} /><span>${t.acknowledge}</span></label>${button("approve", t.approve, !state.checked || !text(state.evidenceText, 2000) || !text(state.memoryText, 400))}</div>
        <h4>${t.approvals}</h4><ul class="writer-interaction-records">${state.review.approvals.map(row => `<li><strong>${t[row.status]} · ${t[row.interactionKind]}</strong><blockquote>${escape(row.evidenceText)}</blockquote><p>${escape(row.memoryText)}</p>${row.status === "approved" ? `<button type="button" data-interaction-revoke="${row.approvalId}" ${rev} ${state.busy ? "disabled" : ""}>${t.revoke}</button>` : ""}</li>`).join("")}</ul>${state.review.moreApprovals ? `<p>${t.more}</p>` : ""}` : ""}
        <p class="writer-interaction-boundary">${t.boundary}</p>
        ${state.revokeId ? `<dialog aria-labelledby="writerInteractionRevokeTitle"><h4 id="writerInteractionRevokeTitle">${t.revokeTitle}</h4>${button("cancel", t.cancel)}${button("confirm", t.confirm)}</dialog>` : ""}`;
      for (const name of ["previous", "next"]) { const node = host.querySelector(`[data-interaction-action="${name}"]`); node?.setAttribute("aria-label", t[name]); node?.setAttribute("title", t[name]); }
      if (state.revokeId) { const dialog = host.querySelector("dialog"); dialog.addEventListener("cancel", event => { event.preventDefault(); controller.cancelRevoke(); }); dialog.showModal(); }
      else if (focusKey) { const node = [...host.querySelectorAll("[data-interaction-focus]")].find(item => item.dataset.interactionFocus === focusKey && !item.disabled); if (node) { node.focus(); if (selection) node.setSelectionRange(...selection); } }
    }
    controller = createController({ identity: () => visible() ? api.identity() : null, isCurrent: value => visible() && api.isCurrent(value),
      locale: () => window.luminaI18n?.getLocale?.() || document.documentElement.lang || "ko", onChange: render,
      fetch: async (url, options) => { const response = await api.fetch(url, options); if (!response.ok) throw new Error("request"); return response.json(); } });
    host.addEventListener("change", event => {
      const node = event.target, rev = Number(node.dataset.interactionRevision);
      if (node.matches("[data-interaction-work]")) controller.selectWork(node.value, rev);
      if (node.matches("[data-interaction-locale]")) controller.setSourceLocale(node.value, rev);
      if (node.matches("[data-interaction-beat]")) controller.selectBeat(node.value, rev);
      if (node.matches("[data-interaction-artist]")) controller.selectArtist(node.value, rev);
      if (node.matches("[data-interaction-kind]")) controller.setKind(node.value, rev);
      if (node.matches("[data-interaction-ack]")) controller.acknowledge(node.checked, rev);
    });
    host.addEventListener("input", event => { const node = event.target;
      if (node.matches("[data-interaction-search]")) searchValue = node.value;
      if (node.matches("[data-interaction-memory]")) controller.setMemory(node.value, Number(node.dataset.interactionRevision));
    });
    host.addEventListener("click", event => {
      const node = event.target.closest("[data-interaction-action], [data-interaction-revoke]");
      if (!node || !host.contains(node) || node.disabled) return;
      const rev = Number(node.dataset.interactionRevision);
      if (node.dataset.interactionRevoke) return controller.requestRevoke(node.dataset.interactionRevoke, rev);
      const actions = { works: () => controller.loadWorks(), source: () => controller.loadBeats("first", rev), previous: () => controller.loadBeats("previous", rev), next: () => controller.loadBeats("next", rev),
        search: () => controller.searchArtists(searchValue, rev), review: () => controller.loadReview(rev), extract: () => { const source = host.querySelector("[data-interaction-evidence-source]"); controller.setEvidence(source.selectionStart, source.selectionEnd, rev); },
        approve: () => controller.approve(rev), cancel: () => controller.cancelRevoke(), confirm: () => controller.confirmRevoke(rev) };
      actions[node.dataset.interactionAction]?.();
    });
    const sync = () => {
      const current = api.identity(), uiLocale = window.luminaI18n?.getLocale?.() || document.documentElement.lang || "ko";
      const context = visible() && api.isCurrent(current) ? JSON.stringify([current.ownerId, current.epoch, uiLocale]) : null;
      if (context !== searchContext || context === null) searchValue = "";
      searchContext = context; controller.syncContext();
    };
    for (const name of ["storage", "focus", "lumina:localechange"]) window.addEventListener(name, sync);
    document.addEventListener("visibilitychange", sync);
    if (typeof MutationObserver === "function") {
      new MutationObserver(sync).observe(shell, { attributes: true, attributeFilter: ["hidden"] });
      new MutationObserver(sync).observe(section, { attributes: true, attributeFilter: ["class"] });
      new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    }
    render(controller.snapshot()); sync(); return controller;
  }
  window.LuminaCreatorInteractions = { createController, mount };
  if (typeof document !== "undefined") mount(document.getElementById("writerInteractions"));
})();
