(function initPrivateOttGraph() {
  "use strict";

  const params = new URLSearchParams(location.search);
  if (!params.has("manifestId") && !params.has("previewId")) return;

  const apiBase = (window.LUMINA_API_BASE || "https://api.lumina-stage.com").replace(/\/$/, "");
  const root = "/api/v1/me/ott-media";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const names = { ko: "한국어", en: "English", ja: "日本語", "zh-Hans": "简体中文", "zh-Hant": "繁體中文" };
  const copy = {
    ko: { title: "비공개 영상 미리보기", private: "소유자 전용", language: "언어", studio: "작가 스튜디오", loading: "비공개 영상을 확인하고 있습니다.", invalid: "영상 주소가 올바르지 않습니다.", secure: "이 미리보기는 허용된 HTTPS 연결에서만 열 수 있습니다.", signIn: "소유자 계정으로 로그인한 뒤 작가 스튜디오에서 다시 열어 주세요.", denied: "이 영상에 접근할 수 없습니다. 소유자 계정을 확인해 주세요.", unavailable: "이 언어로 영상을 미리볼 수 없습니다. 영상과 번역을 확인해 주세요.", failed: "영상 정보를 확인하지 못했습니다. 다시 시도해 주세요.", ready: "비공개 영상을 재생할 수 있습니다.", connecting: "재생 권한을 확인하고 있습니다.", paused: "재생을 일시정지했습니다.", switched: "계정이 변경되어 재생을 중단했습니다. 다시 열어 주세요.", mediaFailed: "영상을 재생할 수 없습니다. 다시 확인해 주세요.", expired: "재생 권한이 만료되었습니다. 다시 확인해 주세요.", play: "미리보기 재생", resume: "계속 재생", replay: "이 장면 다시 재생", retry: "다시 확인", check: "저장 확인 및 재시도", branches: "다음 장면", ending: "완료: {value}", saving: "진행 상황을 저장하고 있습니다.", saved: "진행 상황이 저장되었습니다.", unknown: "저장 결과를 확인하지 못했습니다. 계속하기 전에 다시 확인해 주세요.", conflict: "다른 화면에서 변경된 진행 상황을 불러왔습니다.", hidden: "재생을 중단했습니다. 계속하려면 재생을 눌러 주세요.", duration: "장면 길이 {value}", subtitles: "자막 {value}", noSubtitles: "사용 가능한 자막 없음" },
    en: { title: "Private video preview", private: "Owner only", language: "Language", studio: "Writer Studio", loading: "Checking the private video.", invalid: "The video link is invalid.", secure: "This preview requires an approved HTTPS connection.", signIn: "Sign in with the owner account and open this again from Writer Studio.", denied: "You cannot access this video. Check the owner account.", unavailable: "This video cannot be previewed in this language. Check its media and translations.", failed: "Could not check the video. Please retry.", ready: "The private video is ready to play.", connecting: "Checking playback access.", paused: "Playback paused.", switched: "The account changed, so playback stopped. Open the preview again.", mediaFailed: "The video cannot play. Please retry.", expired: "Playback access expired. Please retry.", play: "Play preview", resume: "Resume preview", replay: "Replay this scene", retry: "Retry", check: "Check save and retry", branches: "Next scene", ending: "Completed: {value}", saving: "Saving progress.", saved: "Progress saved.", unknown: "The save result is unknown. Check again before continuing.", conflict: "Loaded progress changed in another window.", hidden: "Playback stopped. Press play to continue.", duration: "Scene duration {value}", subtitles: "Subtitles {value}", noSubtitles: "No available subtitles" },
    ja: { title: "非公開動画のプレビュー", private: "所有者専用", language: "言語", studio: "作家スタジオ", loading: "非公開動画を確認しています。", invalid: "動画のリンクが正しくありません。", secure: "このプレビューには許可されたHTTPS接続が必要です。", signIn: "所有者のアカウントでログインし、作家スタジオから開き直してください。", denied: "この動画にアクセスできません。所有者のアカウントを確認してください。", unavailable: "この言語ではプレビューできません。動画と翻訳を確認してください。", failed: "動画を確認できませんでした。再試行してください。", ready: "非公開動画を再生できます。", connecting: "再生権限を確認しています。", paused: "再生を一時停止しました。", switched: "アカウントが変更されたため再生を停止しました。開き直してください。", mediaFailed: "動画を再生できません。再試行してください。", expired: "再生権限の期限が切れました。再試行してください。", play: "プレビューを再生", resume: "再開", replay: "このシーンを再生", retry: "再試行", check: "保存を確認して再試行", branches: "次のシーン", ending: "完了：{value}", saving: "進行状況を保存しています。", saved: "進行状況を保存しました。", unknown: "保存結果を確認できませんでした。続行前に再確認してください。", conflict: "別の画面で変更された進行状況を読み込みました。", hidden: "再生を停止しました。続けるには再生を押してください。", duration: "シーンの長さ {value}", subtitles: "字幕 {value}", noSubtitles: "利用可能な字幕なし" },
    "zh-Hans": { title: "私密视频预览", private: "仅限所有者", language: "语言", studio: "作者工作室", loading: "正在检查私密视频。", invalid: "视频链接无效。", secure: "此预览需要获准的 HTTPS 连接。", signIn: "请使用所有者账号登录后，从作者工作室重新打开。", denied: "无法访问此视频。请检查所有者账号。", unavailable: "无法使用此语言预览。请检查视频和翻译。", failed: "无法检查视频，请重试。", ready: "私密视频可以播放。", connecting: "正在检查播放权限。", paused: "播放已暂停。", switched: "账号已更改，播放已停止。请重新打开。", mediaFailed: "视频无法播放，请重试。", expired: "播放权限已过期，请重试。", play: "播放预览", resume: "继续播放", replay: "重播此场景", retry: "重试", check: "检查保存并重试", branches: "下一场景", ending: "已完成：{value}", saving: "正在保存进度。", saved: "进度已保存。", unknown: "无法确认保存结果。请先重新检查再继续。", conflict: "已载入其他页面更改的进度。", hidden: "播放已停止。请点击播放以继续。", duration: "场景时长 {value}", subtitles: "字幕 {value}", noSubtitles: "无可用字幕" },
    "zh-Hant": { title: "私人影片預覽", private: "僅限擁有者", language: "語言", studio: "作家工作室", loading: "正在檢查私人影片。", invalid: "影片連結無效。", secure: "此預覽需要獲准的 HTTPS 連線。", signIn: "請使用擁有者帳號登入，再從作家工作室重新開啟。", denied: "無法存取此影片。請確認擁有者帳號。", unavailable: "無法使用此語言預覽。請檢查影片與翻譯。", failed: "無法確認影片，請重試。", ready: "私人影片可以播放。", connecting: "正在確認播放權限。", paused: "播放已暫停。", switched: "帳號已變更，播放已停止。請重新開啟。", mediaFailed: "影片無法播放，請重試。", expired: "播放權限已過期，請重試。", play: "播放預覽", resume: "繼續播放", replay: "重播此場景", retry: "重試", check: "確認儲存並重試", branches: "下一場景", ending: "已完成：{value}", saving: "正在儲存進度。", saved: "進度已儲存。", unknown: "無法確認儲存結果。請先重新確認再繼續。", conflict: "已載入其他頁面變更的進度。", hidden: "播放已停止。請按播放以繼續。", duration: "場景片長 {value}", subtitles: "字幕 {value}", noSubtitles: "沒有可用字幕" }
  };
  const el = Object.fromEntries(["previewLocale", "localeLabel", "studioLink", "privateLabel", "previewTitle", "previewState", "previewPlayer", "previewDuration", "previewSubtitles", "previewStart", "previewRetry", "graphBranches", "graphBranchTitle", "graphChoices", "graphEnding", "graphSaveState"].map(id => [id, document.getElementById(id)]));
  let video = document.getElementById("privateVideo");
  let locale = storedLocale();
  let epoch = 0;
  let mediaEpoch = 0;
  let owner = null;
  let manifest = null;
  let progress = null;
  let operation = null;
  let sending = false;
  let opening = false;
  let unknown = false;
  let blocked = false;
  let session = null;
  let sessionBusy = false;
  let sessionAttempt = null;
  let refreshing = null;
  let renewing = null;
  let saveTimer = null;
  let queuedPosition = null;
  let playhead = 0;
  let desiredPlaying = false;
  let mediaReady = false;
  let internalMedia = false;
  let tracks = [];
  const requests = new Set();
  const internalPauses = new WeakMap();

  function storedLocale() {
    try {
      const value = localStorage.getItem("lumina_locale");
      return ({ "ko-KR": "ko", "en-US": "en", "ja-JP": "ja", "zh-CN": "zh-Hans", "zh-TW": "zh-Hant" })[value] || (locales.includes(value) ? value : "ko");
    } catch { return "ko"; }
  }
  function t(key, values = {}) { return copy[locale][key].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? "")); }
  function state(key, error = false) {
    el.previewState.textContent = t(key);
    el.previewState.classList.toggle("is-error", error);
  }
  function localize() {
    document.documentElement.lang = locale;
    document.title = t("title") + " | Lumina Stage";
    el.previewLocale.value = locale;
    for (const [id, key] of [["localeLabel", "language"], ["studioLink", "studio"], ["privateLabel", "private"], ["previewTitle", "title"], ["graphBranchTitle", "branches"]]) el[id].textContent = t(key);
    el.previewPlayer.setAttribute("aria-label", t("title"));
    video.setAttribute("aria-label", t("title"));
    controls();
  }
  function auth() {
    for (const key of ["lumina_auth", "lumina.session"]) {
      try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        const token = value?.accessToken || value?.access_token || value?.token || value?.tokens?.accessToken || value?.tokens?.access_token;
        if (token) return { key, value, token, id: value.user?.id || value.viewer?.id || null,
          refresh: value.refreshToken || value.refresh_token || value.tokens?.refreshToken || value.tokens?.refresh_token };
      } catch (_) {}
    }
    return null;
  }
  function sameAuth(a, b) { return Boolean(a && b && a.key === b.key && a.id === b.id && a.token === b.token); }
  function alive(stamp) {
    if (stamp !== epoch || !owner) return false;
    if (!sameAuth(owner, auth())) { lock(auth() ? "switched" : "signIn"); return false; }
    return true;
  }
  function invalidate() {
    epoch++;
    for (const request of requests) if (!request.keepalive) request.controller.abort();
    clearTimeout(saveTimer);
    queuedPosition = null;
    stopMedia();
    operation = null;
    sending = false;
    unknown = false;
    opening = false;
    refreshing = null;
  }
  function lock(key) {
    invalidate();
    owner = null;
    manifest = null;
    progress = null;
    blocked = true;
    el.previewPlayer.hidden = true;
    el.graphChoices.replaceChildren();
    el.graphEnding.textContent = "";
    el.graphSaveState.textContent = "";
    el.previewRetry.hidden = true;
    state(key, true);
  }
  async function request(path, { method = "GET", body, key, keepalive = false } = {}, stamp = epoch) {
    if (!alive(stamp)) throw new Error("stale");
    const pending = { controller: new AbortController(), keepalive };
    requests.add(pending);
    const timeout = setTimeout(() => pending.controller.abort(), 12000);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = owner;
        const response = await fetch(apiBase + root + path, {
          method, credentials: "include", cache: "no-store", signal: pending.controller.signal, keepalive,
          headers: { Authorization: "Bearer " + current.token, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(key ? { "Idempotency-Key": key } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        if (!alive(stamp)) throw new Error("stale");
        if (response.status === 401 && !attempt && current.refresh) {
          if (current.token !== owner.token) continue;
          if (!refreshing) refreshing = refreshOwner(current, pending.controller.signal, stamp);
          const task = refreshing;
          let renewed;
          try { renewed = await task; } finally { if (refreshing === task) refreshing = null; }
          if (!alive(stamp)) throw new Error("stale");
          if (renewed) continue;
        }
        const data = await response.json().catch(() => null);
        if (!alive(stamp)) throw new Error("stale");
        if (!response.ok) {
          const code = data?.error?.code ?? data?.code;
          throw Object.assign(new Error("request"), { status: response.status, code: typeof code === "string" ? code : "" });
        }
        return data;
      }
    } finally { clearTimeout(timeout); requests.delete(pending); }
  }
  async function refreshOwner(current, signal, stamp) {
    const response = await fetch(apiBase + "/api/v1/auth/refresh", {
      method: "POST", credentials: "include", cache: "no-store", signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: current.refresh })
    });
    const data = await response.json().catch(() => null);
    if (!alive(stamp) || !sameAuth(current, auth())) return false;
    const token = data?.accessToken || data?.access_token || data?.tokens?.accessToken || data?.tokens?.access_token;
    if (!response.ok || !token || (data.user?.id && data.user.id !== current.id)) return false;
    const value = { ...current.value, ...data, accessToken: token, user: data.user || current.value.user,
      refreshToken: data.refreshToken || data.refresh_token || data.tokens?.refreshToken || data.tokens?.refresh_token || current.refresh };
    localStorage.setItem(current.key, JSON.stringify(value));
    owner = auth();
    return true;
  }
  function errorKey(error) {
    if (error.status === 401) return "signIn";
    if (error.status === 403 || error.status === 404) return "denied";
    if (error.status === 410) return "expired";
    if (error.status === 409) return "unavailable";
    return "failed";
  }
  function fail(error) {
    const key = errorKey(error);
    if (key === "signIn" || key === "denied") return lock(key);
    stopMedia();
    blocked = true;
    state(key, true);
    controls();
  }
  function validProgress(data, expected = {}) {
    const node = data?.node;
    const clip = node?.clip;
    return data?.visibility === "private" && data.source === "authored_uploaded_clips" &&
      [data.progressId, data.previewId, data.manifestId, clip?.fileId, clip?.mediaVersionId].every(value => typeof value === "string" && uuid.test(value)) &&
      Object.entries(expected).every(([key, value]) => data[key] === value) &&
      Number.isSafeInteger(data.graphRevision) && data.graphRevision > 0 && Number.isSafeInteger(data.revision) && data.revision >= 0 &&
      locales.includes(data.locale) && ["active", "completed"].includes(data.status) &&
      typeof node.key === "string" && node.key.length > 0 &&
      Number.isSafeInteger(clip.startMs) && Number.isSafeInteger(clip.endMs) && clip.startMs >= 0 && clip.endMs > clip.startMs &&
      Number.isSafeInteger(data.positionMs) && data.positionMs >= clip.startMs && data.positionMs <= clip.endMs &&
      Array.isArray(node.choices) && node.choices.length <= 3 && new Set(node.choices.map(choice => choice.key)).size === node.choices.length &&
      node.choices.every(choice => typeof choice.key === "string" && choice.key && typeof choice.label === "string" && choice.label.trim()) &&
      (node.ending ? typeof node.ending.key === "string" && typeof node.ending.label === "string" && node.ending.label.trim() && !node.choices.length : node.choices.length > 0) &&
      (data.status !== "completed" || (node.ending && data.positionMs === clip.endMs)) &&
      data.browserPlayback?.sessionPath === `${root}/files/${clip.fileId}/playback-session` &&
      data.browserPlayback.method === "POST" && data.browserPlayback.mode === "secure_http_only_cookie";
  }
  function expectedProgress() { return { progressId: progress.progressId, previewId: progress.previewId, manifestId: manifest.manifestId, graphRevision: manifest.graphRevision, locale }; }
  function requireProgress(data, expected) {
    if (!validProgress(data, expected)) throw Object.assign(new Error("projection"), { status: 409 });
    if (progress && data.progressId === progress.progressId && data.revision < progress.revision) throw new Error("old snapshot");
    return data;
  }
  function commandStorageKey() {
    // No credentials or full progress snapshots are persisted. Scope receipts to this owner and locale pin.
    return owner?.id && progress ? `lumina.ott.command:${owner.id}:${progress.previewId}` : null;
  }
  function rememberCommand() {
    const key = commandStorageKey();
    if (!key) return;
    try { if (operation) sessionStorage.setItem(key, JSON.stringify(operation)); else sessionStorage.removeItem(key); } catch (_) {}
  }
  function recoverCommand() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(commandStorageKey()) || "null");
      if (!saved) return;
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(saved.key) || !["position", "choice"].includes(saved.kind) || saved.progressId !== progress.progressId ||
          saved.body?.manifestId !== progress.manifestId || !Number.isSafeInteger(saved.body.expectedRevision) ||
          typeof saved.body.nodeKey !== "string" || (saved.kind === "choice" ? typeof saved.body.choiceKey !== "string" : !Number.isSafeInteger(saved.body.positionMs))) return;
      if (progress.revision > saved.body.expectedRevision) { operation = null; rememberCommand(); return; }
      operation = saved;
      unknown = true;
    } catch (_) {}
  }
  function duration(ms) { const seconds = Math.floor(ms / 1000); return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0"); }
  function controls() {
    const busy = opening || sending || sessionBusy;
    el.previewStart.disabled = busy || unknown || blocked || !progress;
    el.previewStart.textContent = t(progress && playhead >= progress.node.clip.endMs ? "replay" : session || progress?.positionMs > progress?.node.clip.startMs ? "resume" : "play");
    el.previewRetry.hidden = !(unknown || blocked);
    el.previewRetry.disabled = busy;
    el.previewRetry.textContent = t(unknown ? "check" : "retry");
    el.graphChoices.querySelectorAll("button").forEach(button => { button.disabled = busy || unknown || blocked; });
    video.controls = !busy && !unknown && !blocked;
    el.graphSaveState.hidden = !progress;
    el.graphSaveState.textContent = unknown ? t("unknown") : sending ? t("saving") : progress?.saved ? t("saved") : "";
  }
  function renderProgress() {
    const node = progress.node;
    el.previewPlayer.hidden = false;
    el.previewDuration.textContent = t("duration", { value: duration(node.clip.endMs - node.clip.startMs) });
    el.graphBranches.hidden = !node.choices.length;
    el.graphChoices.replaceChildren(...node.choices.map(choice => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = choice.label;
      const stamp = epoch;
      const revision = progress.revision;
      button.addEventListener("click", () => {
        if (alive(stamp) && progress.revision === revision) choose(choice.key);
      });
      return button;
    }));
    el.graphEnding.hidden = progress.status !== "completed";
    el.graphEnding.textContent = progress.status === "completed" ? t("ending", { value: node.ending.label }) : "";
    controls();
  }
  function accept(data, { reload = false, saved = false } = {}) {
    const changed = !progress || progress.node.key !== data.node.key || progress.node.clip.fileId !== data.node.clip.fileId;
    if (changed || reload) stopMedia();
    progress = { ...data, saved };
    if (changed || reload || !mediaReady) playhead = data.positionMs;
    if (changed || reload) installTracks();
    renderProgress();
  }
  async function open(selectedLocale) {
    const knownManifest = manifest?.manifestId;
    invalidate();
    blocked = false;
    progress = null;
    manifest = null;
    el.previewPlayer.hidden = true;
    el.graphChoices.replaceChildren();
    localize();
    const entries = ["fileId", "manifestId", "previewId"].flatMap(key => params.getAll(key).map(value => ({ key, value })));
    if (entries.length !== 1 || !uuid.test(entries[0].value) || entries[0].key === "fileId") return lock("invalid");
    if (location.protocol !== "https:" || !/^https:\/\//.test(apiBase)) return lock("secure");
    owner = auth();
    if (!owner) return lock("signIn");
    const stamp = epoch;
    opening = true;
    state("loading");
    controls();
    try {
      let resumed = null;
      let manifestId = knownManifest || (entries[0].key === "manifestId" ? entries[0].value : null);
      if (!manifestId) {
        resumed = requireProgress(await request(`/playback-previews/${entries[0].value}/progress`, { method: "POST", body: {} }, stamp), { previewId: entries[0].value });
        manifestId = resumed.manifestId;
        if (!selectedLocale) locale = resumed.locale;
      }
      const data = await request(`/playback-manifests/${manifestId}`, {}, stamp);
      if (data?.manifestId !== manifestId || data.visibility !== "private" || !Number.isSafeInteger(data.graphRevision) || data.graphRevision < 1 || typeof data.checksum !== "string") throw new Error("projection");
      manifest = data;
      if (!data.readiness?.previewReadyByLocale?.[locale]) throw Object.assign(new Error("not ready"), { status: 409 });
      if (!resumed || resumed.locale !== locale) {
        const pin = await request(`/playback-manifests/${manifestId}/preview-pins`, { method: "POST", body: { locale } }, stamp);
        if (!uuid.test(pin?.previewId) || pin.manifestId !== manifestId || pin.graphRevision !== data.graphRevision || pin.checksum !== data.checksum || pin.locale !== locale || pin.visibility !== "private" || pin.publication !== "not_authorized") throw new Error("pin");
        resumed = requireProgress(await request(`/playback-previews/${pin.previewId}/progress`, { method: "POST", body: {} }, stamp), { previewId: pin.previewId, manifestId, graphRevision: data.graphRevision, locale });
      } else requireProgress(resumed, { manifestId, graphRevision: data.graphRevision, locale });
      if (!alive(stamp)) return;
      accept(resumed, { reload: true });
      recoverCommand();
      localize();
      state(unknown ? "unknown" : "ready", unknown);
    } catch (error) { if (alive(stamp)) fail(error); }
    finally { if (alive(stamp)) { opening = false; controls(); } }
  }

  async function readCurrent(stamp) {
    const data = await request(`/playback-progress/${progress.progressId}`, {}, stamp);
    return requireProgress(data, expectedProgress());
  }
  function pauseInternal() {
    desiredPlaying = false;
    clearTimeout(renewing);
    internalMedia = true;
    if (!video.paused) internalPauses.set(video, (internalPauses.get(video) || 0) + 1);
    video.pause();
    internalMedia = false;
  }
  function markUnknown() {
    unknown = true;
    queuedPosition = null;
    pauseInternal();
    state("unknown", true);
    controls();
  }
  async function sendCommand({ keepalive = false } = {}) {
    if (!operation || sending || !alive(epoch)) return;
    const stamp = epoch;
    const command = operation;
    sending = true;
    controls();
    try {
      const result = await request(`/playback-progress/${command.progressId}/${command.kind === "choice" ? "choices" : "position"}`, {
        method: command.kind === "choice" ? "POST" : "PUT", body: command.body, key: command.key, keepalive
      }, stamp);
      if (!validProgress(result, expectedProgress()) || result.revision !== command.body.expectedRevision + 1) throw new Error("receipt");
      // Receipts can describe historical state. Read the current server revision before applying any replay.
      const current = result.idempotentReplay ? await readCurrent(stamp) : result;
      if (!alive(stamp) || operation !== command) return;
      operation = null;
      rememberCommand();
      unknown = false;
      blocked = false;
      accept(current, { reload: command.kind === "choice" || result.idempotentReplay, saved: true });
      state("ready");
    } catch (error) {
      if (!alive(stamp)) return;
      if (error.status === 409 && error.code === "OTT_CONFLICT") {
        try {
          const current = await readCurrent(stamp);
          operation = null;
          rememberCommand();
          queuedPosition = null;
          unknown = false;
          accept(current, { reload: true });
          state("conflict");
        } catch (readError) { if (alive(stamp)) { markUnknown(); if ([401, 403, 404].includes(readError.status)) fail(readError); } }
      } else if (error.status && error.status < 500) {
        operation = null;
        rememberCommand();
        fail(error);
      } else markUnknown();
    } finally {
      if (alive(stamp)) { sending = false; controls(); if (!unknown && !blocked) drainPosition(); }
    }
  }
  function command(kind, extra, options) {
    if (!progress || operation || sending || blocked || unknown || !alive(epoch)) return;
    const key = crypto.randomUUID();
    operation = { key, kind, progressId: progress.progressId, body: { manifestId: progress.manifestId, expectedRevision: progress.revision, nodeKey: progress.node.key, ...extra } };
    rememberCommand();
    return sendCommand(options);
  }
  function choose(key) {
    if (opening || sending || sessionBusy || unknown || blocked || !progress.node.choices.some(choice => choice.key === key)) return;
    clearTimeout(saveTimer);
    queuedPosition = null;
    pauseInternal();
    command("choice", { choiceKey: key });
  }
  function drainPosition(options) {
    if (!queuedPosition || sending || operation || unknown || blocked) return;
    const next = queuedPosition;
    queuedPosition = null;
    if (next.nodeKey !== progress?.node.key || next.positionMs === progress.positionMs) return;
    return command("position", { positionMs: next.positionMs }, options);
  }
  function savePosition(immediate = false, keepalive = false) {
    if (!progress || !alive(epoch) || blocked || unknown) return;
    queuedPosition = { nodeKey: progress.node.key, positionMs: clampPosition(playhead) };
    clearTimeout(saveTimer);
    if (immediate) return drainPosition({ keepalive });
    saveTimer = setTimeout(() => drainPosition(), 350);
  }
  async function retry() {
    if (opening || sending || sessionBusy) return;
    if (!unknown || !operation) return open(locale);
    const stamp = epoch;
    sending = true;
    controls();
    try {
      const current = await readCurrent(stamp);
      if (current.revision > operation.body.expectedRevision) {
        operation = null;
        rememberCommand();
        unknown = false;
        blocked = false;
        accept(current, { reload: true });
        state("ready");
      }
    } catch (error) { if (alive(stamp)) { if ([401, 403, 404].includes(error.status)) fail(error); else markUnknown(); } return; }
    finally { if (alive(stamp)) { sending = false; controls(); } }
    if (alive(stamp) && operation) await sendCommand();
  }

  function stopMedia() {
    mediaEpoch++;
    clearTimeout(renewing);
    pauseInternal();
    mediaReady = false;
    session = null;
    sessionBusy = false;
    sessionAttempt = null;
    video.removeAttribute("src");
    video.load();
    tracks.forEach(track => URL.revokeObjectURL(track.url));
    tracks = [];
    video.querySelectorAll("track").forEach(track => track.remove());
  }
  function clampPosition(value) { return Math.min(progress.node.clip.endMs, Math.max(progress.node.clip.startMs, Math.round(value))); }
  function vttTime(ms) {
    return [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60].map(value => String(value).padStart(2, "0")).join(":") + "." + String(ms % 1000).padStart(3, "0");
  }
  function installTracks() {
    tracks.forEach(track => URL.revokeObjectURL(track.url));
    tracks = [];
    video.querySelectorAll("track").forEach(track => track.remove());
    const clip = progress.node.clip;
    for (const track of (Array.isArray(progress.subtitles) ? progress.subtitles : []).slice(0, 5)) {
      if (track?.status !== "available" || !locales.includes(track.locale) || !progress.availableSubtitleLocales?.includes(track.locale) || tracks.some(item => item.locale === track.locale) || !Array.isArray(track.cues) || !track.cues.length || track.cues.length > 2000) continue;
      let end = clip.startMs;
      let total = 0;
      if (!track.cues.every(cue => {
        if (!Number.isSafeInteger(cue.startMs) || !Number.isSafeInteger(cue.endMs) || cue.startMs < end || cue.endMs <= cue.startMs || cue.endMs > clip.endMs || typeof cue.text !== "string" || !cue.text.trim() || cue.text.length > 2000 || /[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(cue.text)) return false;
        end = cue.endMs;
        total += cue.text.length;
        return total <= 100000;
      })) continue;
      const text = "WEBVTT\n\n" + track.cues.map(cue => `${vttTime(cue.startMs)} --> ${vttTime(cue.endMs)}\n${cue.text.replace(/&/g, "&amp;").replace(/-->/g, "--&gt;").replace(/[\r\n]+/g, " ")}\n`).join("\n");
      const url = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
      const element = document.createElement("track");
      element.kind = "subtitles";
      element.srclang = track.locale;
      element.label = names[track.locale];
      element.src = url;
      element.default = track.locale === locale;
      video.append(element);
      tracks.push({ url, locale: track.locale });
    }
    el.previewSubtitles.textContent = tracks.length ? t("subtitles", { value: tracks.map(track => names[track.locale]).join(", ") }) : t("noSubtitles");
  }
  function mediaAlive(element, stamp, generation) { return element === video && element.isConnected && stamp === epoch && generation === mediaEpoch && alive(stamp); }
  function renewLater() {
    clearTimeout(renewing);
    if (desiredPlaying && session && !document.hidden) renewing = setTimeout(() => renew(false), Math.max(1000, session.expiresAt - Date.now() - 40000));
  }
  async function nativePlay() {
    if (!alive(epoch) || unknown || blocked || sending || document.hidden || !session || !mediaReady) return;
    if (session.expiresAt <= Date.now() + 1000) return renew(false);
    const element = video;
    const stamp = epoch;
    const generation = mediaEpoch;
    desiredPlaying = true;
    internalMedia = true;
    try { await element.play(); if (mediaAlive(element, stamp, generation)) { state("ready"); renewLater(); } }
    catch (_) { if (mediaAlive(element, stamp, generation)) { desiredPlaying = false; state("mediaFailed", true); } }
    finally { if (mediaAlive(element, stamp, generation)) internalMedia = false; }
  }
  function attachMedia(path) {
    const old = video;
    stopMedia();
    video = document.createElement("video");
    video.id = "privateVideo";
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.setAttribute("aria-label", t("title"));
    old.replaceWith(video);
    installTracks();
    const element = video;
    const stamp = epoch;
    const generation = mediaEpoch;
    let restoring = false;
    let atBoundary = false;
    const current = () => mediaAlive(element, stamp, generation);
    const seek = position => {
      restoring = true;
      element.currentTime = position / 1000;
    };
    const boundary = () => {
      if (!current() || !mediaReady || restoring || unknown || blocked) return;
      playhead = clampPosition(element.currentTime * 1000);
      const clip = progress.node.clip;
      if (element.currentTime * 1000 < clip.startMs) { seek(clip.startMs); return; }
      if (element.currentTime * 1000 >= clip.endMs) {
        pauseInternal();
        if (element.currentTime * 1000 > clip.endMs) seek(clip.endMs);
        if (!atBoundary) { atBoundary = true; savePosition(true); }
        controls();
      } else atBoundary = false;
    };
    const frame = () => {
      if (!current() || element.paused) return;
      boundary();
      if (!element.paused) element.requestVideoFrameCallback?.(frame);
    };
    element.addEventListener("loadedmetadata", () => {
      if (!current()) return;
      if (!Number.isFinite(element.duration) || element.duration * 1000 + 100 < progress.node.clip.endMs) return mediaFailure();
      mediaReady = true;
      if (Math.abs(element.currentTime * 1000 - playhead) < 1) {
        if (desiredPlaying) nativePlay();
      } else seek(playhead);
    }, { once: true });
    element.addEventListener("seeked", () => {
      if (!current() || !mediaReady) return;
      if (restoring) {
        restoring = false;
        boundary();
        if (desiredPlaying && playhead < progress.node.clip.endMs) nativePlay();
        return;
      }
      boundary();
      savePosition();
    });
    element.addEventListener("seeking", () => {
      if (!current() || !mediaReady || restoring) return;
      const target = clampPosition(element.currentTime * 1000);
      playhead = target;
      if (element.currentTime * 1000 !== target) seek(target);
      savePosition();
    });
    element.addEventListener("play", () => {
      if (!current()) return;
      if (!internalMedia) { pauseInternal(); begin(); return; }
      element.requestVideoFrameCallback?.(frame);
    });
    element.addEventListener("pause", () => {
      const pauses = internalPauses.get(element) || 0;
      if (pauses) { internalPauses.set(element, pauses - 1); return; }
      if (!current() || internalMedia || !mediaReady || !element.paused) return;
      desiredPlaying = false;
      clearTimeout(renewing);
      playhead = clampPosition(element.currentTime * 1000);
      savePosition();
      if (!unknown && !blocked) state("paused");
    });
    element.addEventListener("timeupdate", boundary);
    element.addEventListener("ended", boundary);
    element.addEventListener("error", () => { if (current()) mediaFailure(); });
    element.src = apiBase + path;
    element.load();
  }
  function mediaFailure() { stopMedia(); blocked = true; state("mediaFailed", true); controls(); }
  async function renew(reload) {
    if (!progress || !alive(epoch) || document.hidden || sessionBusy || unknown || blocked) return;
    const stamp = epoch;
    const generation = mediaEpoch;
    const fileId = progress.node.clip.fileId;
    const attempt = {};
    sessionAttempt = attempt;
    sessionBusy = true;
    clearTimeout(renewing);
    state("connecting");
    controls();
    try {
      const data = await request(`/files/${fileId}/playback-session`, { method: "POST", body: {} }, stamp);
      if (!alive(stamp) || generation !== mediaEpoch) return;
      const playback = data?.playback;
      const expiresAt = Date.parse(playback?.expiresAt);
      if (playback?.path !== `/api/v1/ott-media/private-files/${fileId}/delivery` || playback.mode !== "secure_http_only_cookie" || playback.rangeSupported !== true || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 40000 || expiresAt > Date.now() + 70000) throw new Error("session");
      const resume = desiredPlaying;
      if (reload || !video.getAttribute("src")) attachMedia(playback.path);
      sessionAttempt = attempt;
      session = { expiresAt };
      desiredPlaying = resume;
      if (mediaReady && resume) nativePlay();
      state(resume ? "ready" : "paused");
      renewLater();
    } catch (error) { if (alive(stamp) && generation === mediaEpoch) fail(error); }
    finally { if (alive(stamp) && sessionAttempt === attempt) { sessionAttempt = null; sessionBusy = false; controls(); } }
  }
  async function begin() {
    if (!progress || opening || sending || unknown || blocked || sessionBusy || !alive(epoch) || document.hidden) return;
    if (playhead >= progress.node.clip.endMs) {
      playhead = progress.node.clip.startMs;
      const stamp = epoch;
      await command("position", { positionMs: playhead });
      if (!alive(stamp) || unknown || blocked) return;
      stopMedia();
    }
    desiredPlaying = true;
    if (session && mediaReady && session.expiresAt > Date.now() + 40000) nativePlay();
    else renew(!mediaReady);
  }

  el.previewStart.addEventListener("click", begin);
  el.previewRetry.addEventListener("click", retry);
  el.previewLocale.addEventListener("change", () => {
    if (!locales.includes(el.previewLocale.value)) return;
    locale = el.previewLocale.value;
    open(locale);
  });
  window.addEventListener("storage", event => {
    if (event.key === "lumina_auth" || event.key === "lumina.session" || event.key === null) { if (owner) alive(epoch); }
    if (event.key === "lumina_locale" && owner && storedLocale() !== locale) { locale = storedLocale(); open(locale); }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && progress && alive(epoch)) {
      if (mediaReady) playhead = clampPosition(video.currentTime * 1000);
      savePosition(true, true);
      stopMedia();
      if (!unknown && !blocked) state("hidden");
    }
  });
  window.addEventListener("focus", () => { if (owner) alive(epoch); });
  window.addEventListener("pagehide", () => {
    if (progress && mediaReady && alive(epoch)) { playhead = clampPosition(video.currentTime * 1000); savePosition(true, true); }
    invalidate();
  });
  window.addEventListener("pageshow", event => { if (event.persisted) open(locale); });
  setInterval(() => { if (owner) alive(epoch); }, 1000);
  open();
})();
