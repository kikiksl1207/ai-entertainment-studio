(function () {
  "use strict";
  const REQUIRED = ["mypageTitleChips", "mypageTitleHeading", "mypageTitleFilter",
    "mypageEquippedTitle", "mypageTitleEmpty", "mypageTitleFoot", "mypageTitlesRetry"];
  if (window.LuminaMypageTitles || REQUIRED.some(id => !document.getElementById(id))) return;
  const $ = id => document.getElementById(id);
  const READY_TIMEOUT_MS = 30000;
  function awaitLocaleReady(signal) {
    return new Promise((resolve, reject) => {
      let settled = false, observer, timer;
      function finish(error) {
        if (settled) return;
        settled = true; observer?.disconnect(); clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
        if (error) reject(error); else resolve();
      }
      function aborted() { finish(new Error("FAN_READY_CANCELLED")); }
      if (signal.aborted) { aborted(); return; }
      signal.addEventListener("abort", aborted, { once: true });
      timer = setTimeout(() => finish(new Error("FAN_READY_TIMEOUT")), READY_TIMEOUT_MS);
      try {
        if (typeof window.luminaI18n?.whenReady === "function") {
          const pending = window.luminaI18n.whenReady();
          if (!pending || typeof pending.then !== "function") throw new Error("FAN_READY_UNAVAILABLE");
          Promise.resolve(pending).then(() => finish(), () => finish(new Error("FAN_READY_FAILED")));
          return;
        }
        // CLEAN exposes only the existing full-bootstrap completion marker.
        const root = document.documentElement;
        const check = () => { if (root?.classList.contains("is-ready")) finish(); };
        check();
        if (settled) return;
        if (!root || typeof MutationObserver !== "function") throw new Error("FAN_READY_UNAVAILABLE");
        observer = new MutationObserver(check);
        observer.observe(root, { attributes: true, attributeFilter: ["class"] });
        check();
      } catch (_) { finish(new Error("FAN_READY_FAILED")); }
    });
  }
  const TEXT = {
    ko: { heading: "보유 칭호", all: "전체", owned: "보유", locked: "사용 불가", rare: "희귀", equipped: "대표",
      empty: "표시할 보유 칭호가 없어요.", login: "로그인 후 보유 칭호를 확인할 수 있어요.", loading: "칭호를 확인하고 있어요.",
      failed: "칭호를 확인하지 못했어요.", saving: "대표 칭호를 저장하고 있어요.", updated: "대표 칭호가 저장됐어요.",
      uncertain: "저장 결과를 확인하지 못했어요. 다시 조회해 주세요.", notChanged: "대표 칭호가 변경되지 않았어요.", nameMissing: "칭호 이름 확인 필요", retry: "다시 조회", noTitle: "대표 칭호 없음", choose: "대표 칭호 선택" },
    en: { heading: "Owned titles", all: "All", owned: "Owned", locked: "Unavailable", rare: "Rare", equipped: "Featured",
      empty: "No owned titles to display.", login: "Sign in to view your titles.", loading: "Checking your titles.",
      failed: "Could not verify your titles.", saving: "Saving your featured title.", updated: "Featured title saved.",
      uncertain: "Could not verify the saved result. Refresh your titles.", notChanged: "Featured title was not changed.", nameMissing: "Title name unavailable", retry: "Refresh", noTitle: "No featured title", choose: "Select featured title" },
    ja: { heading: "所持称号", all: "すべて", owned: "所持", locked: "利用不可", rare: "レア", equipped: "代表",
      empty: "表示できる所持称号はありません。", login: "ログインして称号を確認してください。", loading: "称号を確認しています。",
      failed: "称号を確認できませんでした。", saving: "代表称号を保存しています。", updated: "代表称号を保存しました。",
      uncertain: "保存結果を確認できませんでした。再取得してください。", notChanged: "代表称号は変更されませんでした。", nameMissing: "称号名を確認できません", retry: "再取得", noTitle: "代表称号なし", choose: "代表称号を選択" },
    "zh-Hans": { heading: "已拥有称号", all: "全部", owned: "已拥有", locked: "不可用", rare: "稀有", equipped: "代表",
      empty: "没有可显示的称号。", login: "登录后查看称号。", loading: "正在确认称号。",
      failed: "无法确认称号。", saving: "正在保存代表称号。", updated: "已保存代表称号。",
      uncertain: "无法确认保存结果，请重新查询。", notChanged: "代表称号未更改。", nameMissing: "称号名称不可用", retry: "重新查询", noTitle: "未选择代表称号", choose: "选择代表称号" },
    "zh-Hant": { heading: "已擁有稱號", all: "全部", owned: "已擁有", locked: "不可用", rare: "稀有", equipped: "代表",
      empty: "沒有可顯示的稱號。", login: "登入後查看稱號。", loading: "正在確認稱號。",
      failed: "無法確認稱號。", saving: "正在儲存代表稱號。", updated: "已儲存代表稱號。",
      uncertain: "無法確認儲存結果，請重新查詢。", notChanged: "代表稱號未更改。", nameMissing: "稱號名稱不可用", retry: "重新查詢", noTitle: "未選擇代表稱號", choose: "選擇代表稱號" }
  };
  const state = { summary: null, reason: "loading", note: "", filter: "all", loading: false, busy: false,
    uncertain: false, request: 0, operation: 0, account: null, accountVersion: 0, initialized: false, promise: null,
    activity: null, activityReason: "loading", achievements: null, achievementReason: "loading", readiness: null,
    pendingSelection: null };
  const FAN_TEXT = {
    ko: { heading: "팬 활동", balance: "팬 포인트", earned: "누적 획득", today: "오늘 참여", streak: "연속 참여", accepted: "전체 참여", failed: "팬 활동을 확인하지 못했어요." },
    en: { heading: "Fan activity", balance: "Fan points", earned: "Lifetime earned", today: "Today", streak: "Streak", accepted: "Total participation", failed: "Could not verify fan activity." },
    ja: { heading: "ファン活動", balance: "ファンポイント", earned: "累計獲得", today: "今日の参加", streak: "連続参加", accepted: "参加合計", failed: "ファン活動を確認できませんでした。" },
    "zh-Hans": { heading: "粉丝活动", balance: "粉丝积分", earned: "累计获得", today: "今日参与", streak: "连续参与", accepted: "参与总数", failed: "无法确认粉丝活动。" },
    "zh-Hant": { heading: "粉絲活動", balance: "粉絲積分", earned: "累計獲得", today: "今日參與", streak: "連續參與", accepted: "參與總數", failed: "無法確認粉絲活動。" }
  };
  const ACHIEVEMENT_TEXT = {
    ko: { heading: "업적", earned: "달성", unavailable: "상태 확인 불가", empty: "확인된 업적이 없어요.", login: "로그인 후 업적을 확인할 수 있어요.", loading: "업적을 확인하고 있어요.", failed: "업적을 확인하지 못했어요.", retry: "다시 조회", progress: "진행", earnedAt: "달성일" },
    en: { heading: "Achievements", earned: "Earned", unavailable: "Status unavailable", empty: "No recorded achievements.", login: "Sign in to view your achievements.", loading: "Checking your achievements.", failed: "Could not verify your achievements.", retry: "Refresh", progress: "Progress", earnedAt: "Earned on" },
    ja: { heading: "実績", earned: "達成", unavailable: "状態を確認できません", empty: "確認された実績はありません。", login: "ログインして実績を確認してください。", loading: "実績を確認しています。", failed: "実績を確認できませんでした。", retry: "再取得", progress: "進行", earnedAt: "達成日" },
    "zh-Hans": { heading: "成就", earned: "已达成", unavailable: "状态无法确认", empty: "没有已记录的成就。", login: "登录后查看成就。", loading: "正在确认成就。", failed: "无法确认成就。", retry: "重新查询", progress: "进度", earnedAt: "达成日期" },
    "zh-Hant": { heading: "成就", earned: "已達成", unavailable: "狀態無法確認", empty: "沒有已記錄的成就。", login: "登入後查看成就。", loading: "正在確認成就。", failed: "無法確認成就。", retry: "重新查詢", progress: "進度", earnedAt: "達成日期" }
  };
  function locale() {
    const value = window.luminaI18n?.getLocale?.() || "ko";
    return TEXT[value] ? value : ({ "ko-KR": "ko", "en-US": "en", "ja-JP": "ja", "zh-CN": "zh-Hans", "zh-TW": "zh-Hant" }[value] || "ko");
  }
  const copy = () => TEXT[locale()];
  const token = () => typeof getAccessToken === "function" ? getAccessToken() : null;
  const session = () => typeof authRequestSession === "function" ? authRequestSession() : token();
  const sessionCurrent = value => typeof authRequestSessionCurrent === "function" ? authRequestSessionCurrent(value) : session() === value;
  function current(scope) { return scope && scope.account === state.accountVersion && sessionCurrent(state.account) && !!token(); }
  function name(item) {
    const labels = item?.copy?.labels;
    const label = labels?.[locale()] || labels?.ko;
    if (typeof label?.displayName === "string" && label.displayName.trim()) return label.displayName;
    const key = item?.copy?.displayNameKey;
    if (typeof key === "string" && typeof window.luminaI18n?.t === "function") {
      try {
        const translated = window.luminaI18n.t(key);
        if (typeof translated === "string" && translated.trim() && translated !== key) return translated;
      } catch (_) {}
    }
    return null;
  }
  function normalize(data) {
    if (!data?.titles || !Array.isArray(data.titles.items) ||
        !(data.titles.equipped === null || (typeof data.titles.equipped === "object" &&
          typeof data.titles.equipped?.code === "string"))) return null;
    const seen = new Set();
    for (const item of data.titles.items) {
      if (!item || typeof item.code !== "string" || !item.code.trim() || item.code.length > 128 || seen.has(item.code) ||
          typeof item.status !== "string" || !item.status.trim() || typeof item.equipped !== "boolean" || typeof item.canEquip !== "boolean" ||
          (!name(item) && !(typeof item.copy?.displayNameKey === "string" && item.copy.displayNameKey.trim())) ||
          (item.canEquip && item.status !== "active") || (item.equipped && !item.canEquip)) return null;
      seen.add(item.code);
    }
    const equipped = data.titles.items.filter(item => item.equipped);
    if (equipped.length > 1 || (data.titles.equipped === null ? equipped.length !== 0 :
      equipped.length !== 1 || data.titles.equipped.code !== equipped[0].code)) return null;
    return data.titles;
  }
  function normalizeActivity(data) {
    const points = data?.points, participation = data?.participationSummary;
    if (typeof data?.generatedAt !== "string" || !Number.isFinite(Date.parse(data.generatedAt)) ||
        !points || !participation || !["cashLike", "transferable", "settlementEligible", "luminaConvertible"].every(key => points[key] === false) ||
        !Number.isSafeInteger(points.balance) || !Number.isSafeInteger(points.lifetimeEarned) || points.lifetimeEarned < 0 ||
        !["completedTodayCount", "currentStreakDays", "totalAcceptedCount"].every(key => Number.isSafeInteger(participation[key]) && participation[key] >= 0) ||
        participation.completedTodayCount > participation.totalAcceptedCount || participation.currentStreakDays > participation.totalAcceptedCount) return null;
    return { balance: points.balance, earned: points.lifetimeEarned, today: participation.completedTodayCount,
      streak: participation.currentStreakDays, accepted: participation.totalAcceptedCount };
  }
  function achievementCopyText(value, field) {
    for (const language of [locale(), "ko"]) {
      const label = value?.labels?.[language]?.[field];
      if (typeof label === "string" && label.trim()) return label;
    }
    const key = value?.[field + "Key"];
    if (typeof key === "string" && key.trim() && typeof window.luminaI18n?.t === "function") {
      try {
        const translated = window.luminaI18n.t(key);
        if (typeof translated === "string" && translated.trim() && translated !== key) return translated;
      } catch (_) {}
    }
    return null;
  }
  function normalizeAchievements(data) {
    if (!Array.isArray(data?.achievements)) return null;
    const record = value => value && typeof value === "object" && !Array.isArray(value);
    const seen = new Set(), items = [];
    for (const row of data.achievements) {
      if (!record(row) || typeof row.code !== "string" || !row.code.trim() || row.code.length > 128 || seen.has(row.code) ||
          typeof row.status !== "string" || !row.status.trim() || !record(row.copy) || !record(row.progress) ||
          !Number.isSafeInteger(row.progress.current) || row.progress.current < 0 ||
          !Number.isSafeInteger(row.progress.target) || row.progress.target < 0 ||
          !(row.earnedAt === null || (typeof row.earnedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.earnedAt) &&
            Number.isFinite(Date.parse(row.earnedAt)) && new Date(row.earnedAt).toISOString() === row.earnedAt))) return null;
      const labels = {};
      for (const language of Object.keys(ACHIEVEMENT_TEXT)) {
        const label = row.copy.labels?.[language];
        if (record(label)) labels[language] = { title: typeof label.title === "string" ? label.title : null,
          description: typeof label.description === "string" ? label.description : null };
      }
      const itemCopy = { labels, titleKey: typeof row.copy.titleKey === "string" ? row.copy.titleKey : null,
        descriptionKey: typeof row.copy.descriptionKey === "string" ? row.copy.descriptionKey : null };
      const title = achievementCopyText(itemCopy, "title");
      if (!title) return null;
      seen.add(row.code);
      items.push({ copy: itemCopy, title, earned: row.status === "earned", current: row.progress.current,
        target: row.progress.target, earnedAt: row.earnedAt });
    }
    return items;
  }
  function renderAchievements() {
    if (!$("mypageAchievementHeading")) return;
    const text = ACHIEVEMENT_TEXT[locale()], list = $("mypageAchievementList");
    $("mypageAchievementHeading").textContent = text.heading;
    list.replaceChildren();
    for (const item of state.achievements || []) {
      const row = document.createElement("li"); row.className = "mypage-achievement";
      const heading = document.createElement("div"); heading.className = "mypage-achievement-head";
      const title = document.createElement("span"); title.className = "mypage-achievement-name";
      title.textContent = achievementCopyText(item.copy, "title") || item.title;
      const status = document.createElement("span"); status.className = "mypage-achievement-state";
      status.textContent = item.earned ? text.earned : text.unavailable; heading.append(title, status); row.append(heading);
      const descriptionText = achievementCopyText(item.copy, "description");
      if (descriptionText) { const description = document.createElement("p"); description.className = "mypage-achievement-description"; description.textContent = descriptionText; row.append(description); }
      const metadata = document.createElement("div"); metadata.className = "mypage-achievement-meta";
      const progress = document.createElement("span"); progress.textContent = text.progress + ": " + item.current.toLocaleString(locale()) + " / " + item.target.toLocaleString(locale()); metadata.append(progress);
      if (item.earned && item.earnedAt !== null) {
        const date = document.createElement("time"); date.setAttribute("datetime", item.earnedAt);
        date.textContent = text.earnedAt + ": " + new Date(item.earnedAt).toLocaleDateString(locale(), { year: "numeric", month: "2-digit", day: "2-digit" }); metadata.append(date);
      }
      row.append(metadata); list.append(row);
    }
    $("mypageAchievementStatus").textContent = state.loading ? text.loading : state.achievementReason === "failed" ? text.failed :
      state.achievementReason === "login" ? text.login : state.achievementReason === "ok" && state.achievements.length === 0 ? text.empty : "";
    const retry = $("mypageAchievementRetry"); retry.hidden = state.achievementReason !== "failed";
    retry.disabled = state.loading || state.busy; retry.textContent = text.retry;
  }
  function renderActivity() {
    if (!$("mypageFanHeading")) return;
    const text = FAN_TEXT[locale()];
    $("mypageFanHeading").textContent = text.heading;
    for (const [key, suffix] of [["balance", "Balance"], ["earned", "Earned"], ["today", "Today"], ["streak", "Streak"], ["accepted", "Accepted"]]) {
      $("mypageFan" + suffix + "Label").textContent = text[key];
      $("mypageFan" + suffix).textContent = state.activity ? state.activity[key].toLocaleString(locale()) : "";
    }
    $("mypageFanStatus").textContent = state.loading ? copy().loading : state.activityReason === "failed" ? text.failed : state.activityReason === "login" ? copy().login : "";
    const retry = $("mypageFanRetry"); retry.hidden = state.activityReason !== "failed"; retry.disabled = state.loading || state.busy; retry.textContent = copy().retry;
  }
  function render() {
    renderActivity();
    renderAchievements();
    const text = copy(), wrap = $("mypageTitleChips");
    const focusedCode = document.activeElement?.dataset?.titleCode;
    if (!wrap) return;
    $("mypageTitleHeading").textContent = text.heading;
    document.querySelectorAll("#mypageTitleFilter [data-title-filter]").forEach(button => {
      const active = button.dataset.titleFilter === state.filter;
      button.textContent = text[button.dataset.titleFilter];
      button.classList.toggle("is-active", active); button.setAttribute("aria-selected", String(active)); button.tabIndex = active ? 0 : -1;
    });
    wrap.replaceChildren();
    const items = state.summary?.items || [], shown = items.filter(item =>
      state.filter === "all" || (state.filter === "owned" && item.status === "active") ||
      (state.filter === "locked" && !item.canEquip) || (state.filter === "rare" && ["rare", "epic", "legendary", "spotlight"].includes(item.rarity)));
    shown.sort((a, b) => Number(b.equipped) - Number(a.equipped));
    for (const item of shown) {
      const button = document.createElement("button");
      button.type = "button"; button.className = "mypage-title-chip " + (item.canEquip ? "is-owned" : "is-locked") + (item.equipped ? " is-equipped" : "");
      button.dataset.titleCode = item.code;
      button.dataset.titleAccountVersion = String(state.accountVersion);
      const labelText = name(item);
      button.disabled = state.loading || state.busy || state.uncertain || !item.canEquip || item.equipped || !labelText;
      button.setAttribute("aria-pressed", String(item.equipped)); button.setAttribute("aria-label", text.choose + ": " + (labelText || text.nameMissing));
      const label = document.createElement("span"); label.className = "mypage-title-chip-label"; label.textContent = labelText || text.nameMissing;
      const badge = document.createElement("span"); badge.className = "mypage-title-chip-state";
      badge.textContent = item.equipped ? text.equipped : item.canEquip && labelText ? text.owned : text.locked;
      button.append(label, badge); wrap.append(button);
    }
    const equipped = items.find(item => item.equipped);
    $("mypageEquippedTitle").textContent = state.summary ? (equipped ? text.equipped + ": " + (name(equipped) || text.nameMissing) : text.noTitle) : "";
    const empty = $("mypageTitleEmpty"); empty.hidden = state.reason !== "ok" || shown.length !== 0; empty.textContent = text.empty;
    $("mypageTitleFoot").textContent = text[state.busy ? "saving" : state.loading ? "loading" : state.uncertain ? "uncertain" : state.reason !== "ok" ? state.reason : state.note] || "";
    const retry = $("mypageTitlesRetry"); retry.hidden = state.reason !== "failed" && !state.uncertain;
    retry.disabled = state.loading || state.busy; retry.textContent = text.retry;
    if (focusedCode) {
      const next = [...wrap.children].find(button => button.dataset.titleCode === focusedCode && !button.disabled);
      if (next) next.focus();
      else { $("mypageTitleHeading").setAttribute("tabindex", "-1"); $("mypageTitleHeading").focus(); }
    }
  }
  async function load(options = {}) {
    if (state.busy && !options.fromMutation) return;
    if (state.promise) return state.promise;
    if (!state.initialized) { state.account = session(); state.initialized = true; }
    if (!token()) { state.summary = null; state.reason = "login"; state.activity = null; state.activityReason = "login"; state.achievements = null; state.achievementReason = "login"; render(); return; }
    const scope = { account: state.accountVersion, request: ++state.request };
    const readiness = new AbortController(); state.readiness = readiness;
    state.loading = true; state.reason = state.summary ? "ok" : "loading"; render();
    const pending = Promise.resolve().then(async () => {
      try {
        await awaitLocaleReady(readiness.signal);
        if (!current(scope) || scope.request !== state.request) return;
        const data = await apiFetch("/api/v1/me/fan-engagement/summary?locale=" + encodeURIComponent(locale()), { auth: true, throwOnError: true });
        if (!current(scope) || scope.request !== state.request) return;
        state.achievements = normalizeAchievements(data); state.achievementReason = state.achievements ? "ok" : "failed";
        state.activity = normalizeActivity(data); state.activityReason = state.activity ? "ok" : "failed";
        const titles = normalize(data);
        state.summary = titles; state.reason = titles ? "ok" : "failed";
        if (titles) {
          const selection = state.pendingSelection;
          const matched = selection && titles.equipped?.code === selection.code;
          if (!selection) state.uncertain = false;
          else if (matched || selection.acknowledged || selection.rejected) {
            state.uncertain = false; state.note = matched ? "updated" : "notChanged";
            state.pendingSelection = null;
          } else { state.uncertain = true; state.note = "uncertain"; }
        }
      } catch (_) {
        if (!current(scope) || scope.request !== state.request) return;
        state.summary = null; state.reason = "failed"; state.activity = null; state.activityReason = "failed";
        state.achievements = null; state.achievementReason = "failed";
      } finally {
        if (state.readiness === readiness) state.readiness = null;
        if (scope.request === state.request) { state.loading = false; state.promise = null; if (!current(scope)) accountChanged(); else render(); }
      }
    });
    state.promise = pending; return pending;
  }
  async function select(code) {
    const item = state.summary?.items.find(row => row.code === code);
    if (!item?.canEquip || !name(item) || item.equipped || state.loading || state.busy || state.uncertain || !token() || !sessionCurrent(state.account)) return;
    const scope = { account: state.accountVersion, operation: ++state.operation };
    const selection = { code, acknowledged: false, rejected: false };
    state.pendingSelection = selection;
    state.busy = true; state.note = ""; render();
    try {
      const receipt = await apiFetch("/api/v1/me/fan-engagement/title", { method: "PATCH", auth: true, throwOnError: true, body: { titleCode: code } }, 1);
      if (!current(scope) || scope.operation !== state.operation) return;
      selection.acknowledged = receipt?.equipped?.code === code;
    } catch (error) {
      if (!current(scope) || scope.operation !== state.operation) return;
      selection.rejected = [400, 401, 403, 404].includes(error?.status);
    }
    if (!current(scope) || scope.operation !== state.operation) return;
    state.uncertain = true; state.note = "uncertain";
    // An old snapshot cannot settle a write whose acknowledgement was lost.
    await load({ fromMutation: true });
    if (!current(scope) || scope.operation !== state.operation) return;
    state.busy = false;
    state.note = state.uncertain ? "uncertain" : state.summary?.equipped?.code === code ? "updated" : "notChanged";
    render();
  }
  function accountChanged() {
    if (!state.initialized) return;
    if (sessionCurrent(state.account)) { state.account = session(); return; }
    state.readiness?.abort(); state.readiness = null;
    state.account = session(); state.accountVersion++; state.request++; state.operation++;
    state.summary = null; state.promise = null; state.loading = false; state.busy = false; state.uncertain = false; state.note = ""; state.filter = "all";
    state.pendingSelection = null;
    state.activity = null; state.activityReason = token() ? "loading" : "login";
    state.achievements = null; state.achievementReason = token() ? "loading" : "login";
    state.reason = token() ? "loading" : "login"; render(); if (token()) void load();
  }
  function setFilter(filter) {
    if (!["all", "owned", "locked", "rare"].includes(filter)) return;
    state.filter = filter; render();
  }
  const filter = $("mypageTitleFilter");
  filter.addEventListener("click", event => { const button = event.target.closest("[data-title-filter]"); if (button) setFilter(button.dataset.titleFilter); });
  filter.addEventListener("keydown", event => {
    if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
    const buttons = [...filter.querySelectorAll("[data-title-filter]")], index = buttons.findIndex(button => button === event.target);
    if (index === -1) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    setFilter(buttons[next].dataset.titleFilter); buttons[next].focus();
  });
  $("mypageTitleChips").addEventListener("click", event => {
    const button = event.target.closest("[data-title-code]");
    if (button?.isConnected && button.dataset.titleAccountVersion === String(state.accountVersion)) void select(button.dataset.titleCode);
  });
  $("mypageTitlesRetry").addEventListener("click", () => { state.note = ""; void load(); });
  $("mypageFanRetry")?.addEventListener("click", () => { void load(); });
  $("mypageAchievementRetry")?.addEventListener("click", () => { void load(); });
  window.addEventListener("lumina:authchange", accountChanged);
  window.addEventListener("lumina:auth-expired", accountChanged);
  window.addEventListener("storage", event => { if (event.key === "lumina_auth" || event.key === null) accountChanged(); });
  window.addEventListener("lumina:localechange", () => { if (sessionCurrent(state.account)) render(); });
  window.LuminaMypageTitles = { load, select };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { void load(); });
  else void load();
})();
