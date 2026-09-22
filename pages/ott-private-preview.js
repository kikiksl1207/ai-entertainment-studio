(function initPrivateOttPreview() {
  "use strict";

  const entryParams = new URLSearchParams(location.search);
  if (entryParams.has("manifestId") || entryParams.has("previewId")) return;

  const apiBase = (window.LUMINA_API_BASE || "https://api.lumina-stage.com").replace(/\/$/, "");
  const fileIds = new URLSearchParams(location.search).getAll("fileId");
  const fileId = fileIds[0] || "";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const locales = ["ko", "en", "ja", "zh-Hans", "zh-Hant"];
  const copy = {
    ko: { title: "비공개 영상 미리보기", private: "소유자 전용", language: "언어", studio: "작가 스튜디오", loading: "비공개 영상을 확인하고 있습니다.", missing: "미리볼 영상이 지정되지 않았습니다.", invalid: "영상 주소가 올바르지 않습니다.", secure: "이 미리보기는 허용된 HTTPS 연결에서만 열 수 있습니다.", signIn: "로그인한 소유자 계정으로 작가 스튜디오에서 다시 열어 주세요.", denied: "이 영상에 접근할 수 없습니다. 소유자 계정을 확인해 주세요.", unavailable: "이 영상은 아직 미리볼 수 없습니다.", failed: "영상 정보를 확인하지 못했습니다. 다시 시도해 주세요.", ready: "비공개 영상을 재생할 수 있습니다.", connecting: "재생 권한을 갱신하고 있습니다.", paused: "재생을 일시정지했습니다.", hidden: "화면을 다시 열었습니다. 계속하려면 재생을 눌러 주세요.", switched: "계정이 변경되어 재생을 중단했습니다. 다시 열어 주세요.", mediaFailed: "재생을 계속할 수 없습니다. 다시 시도해 주세요.", play: "미리보기 재생", resume: "다시 재생", retry: "다시 확인", duration: "길이 {value}", subtitles: "자막 {value}", noSubtitles: "사용 가능한 자막 없음" },
    en: { title: "Private video preview", private: "Owner only", language: "Language", studio: "Writer Studio", loading: "Checking the private video.", missing: "No video was specified for preview.", invalid: "The video link is invalid.", secure: "This preview requires an approved HTTPS connection.", signIn: "Open this again from Writer Studio with the owner account signed in.", denied: "You cannot access this video. Check the owner account.", unavailable: "This video is not ready for preview.", failed: "Could not check the video. Please retry.", ready: "The private video is ready to play.", connecting: "Refreshing playback access.", paused: "Playback paused.", hidden: "The page is visible again. Press play to continue.", switched: "The account changed, so playback stopped. Open the preview again.", mediaFailed: "Playback cannot continue. Please retry.", play: "Play preview", resume: "Resume preview", retry: "Retry", duration: "Duration {value}", subtitles: "Subtitles {value}", noSubtitles: "No available subtitles" },
    ja: { title: "非公開動画のプレビュー", private: "所有者専用", language: "言語", studio: "作家スタジオ", loading: "非公開動画を確認しています。", missing: "プレビューする動画が指定されていません。", invalid: "動画のリンクが正しくありません。", secure: "このプレビューには許可されたHTTPS接続が必要です。", signIn: "所有者のアカウントでログインし、作家スタジオから開き直してください。", denied: "この動画にアクセスできません。所有者のアカウントを確認してください。", unavailable: "この動画はまだプレビューできません。", failed: "動画を確認できませんでした。再試行してください。", ready: "非公開動画を再生できます。", connecting: "再生権限を更新しています。", paused: "再生を一時停止しました。", hidden: "画面に戻りました。続けるには再生を押してください。", switched: "アカウントが変更されたため再生を停止しました。開き直してください。", mediaFailed: "再生を続けられません。再試行してください。", play: "プレビューを再生", resume: "再開", retry: "再試行", duration: "長さ {value}", subtitles: "字幕 {value}", noSubtitles: "利用可能な字幕なし" },
    "zh-Hans": { title: "私密视频预览", private: "仅限所有者", language: "语言", studio: "作者工作室", loading: "正在检查私密视频。", missing: "未指定要预览的视频。", invalid: "视频链接无效。", secure: "此预览需要获准的 HTTPS 连接。", signIn: "请使用所有者账号登录后，从作者工作室重新打开。", denied: "无法访问此视频。请检查所有者账号。", unavailable: "此视频尚不能预览。", failed: "无法检查视频，请重试。", ready: "私密视频可以播放。", connecting: "正在更新播放权限。", paused: "播放已暂停。", hidden: "页面已重新显示。请点击播放以继续。", switched: "账号已更改，播放已停止。请重新打开预览。", mediaFailed: "无法继续播放，请重试。", play: "播放预览", resume: "继续播放", retry: "重试", duration: "时长 {value}", subtitles: "字幕 {value}", noSubtitles: "无可用字幕" },
    "zh-Hant": { title: "私人影片預覽", private: "僅限擁有者", language: "語言", studio: "作家工作室", loading: "正在檢查私人影片。", missing: "未指定要預覽的影片。", invalid: "影片連結無效。", secure: "此預覽需要獲准的 HTTPS 連線。", signIn: "請使用擁有者帳號登入，再從作家工作室重新開啟。", denied: "無法存取此影片。請確認擁有者帳號。", unavailable: "此影片尚未開放預覽。", failed: "無法確認影片，請重試。", ready: "私人影片可以播放。", connecting: "正在更新播放權限。", paused: "播放已暫停。", hidden: "頁面已重新顯示。請按播放以繼續。", switched: "帳號已變更，播放已停止。請重新開啟預覽。", mediaFailed: "無法繼續播放，請重試。", play: "播放預覽", resume: "繼續播放", retry: "重試", duration: "片長 {value}", subtitles: "字幕 {value}", noSubtitles: "沒有可用字幕" }
  };
  const languageNames = { ko: "한국어", en: "English", ja: "日本語", "zh-Hans": "简体中文", "zh-Hant": "繁體中文" };
  const elements = Object.fromEntries(["previewLocale", "localeLabel", "studioLink", "privateLabel", "previewTitle", "previewState", "previewPlayer", "privateVideo", "previewDuration", "previewSubtitles", "previewStart", "previewRetry"].map(id => [id, document.getElementById(id)]));
  const video = elements.privateVideo;
  const initialLocale = (() => { try { return localStorage.getItem("lumina_locale"); } catch { return null; } })();
  let locale = ({ "ko-KR": "ko", "en-US": "en", "ja-JP": "ja", "zh-CN": "zh-Hans", "zh-Hant": "zh-Hant" })[initialLocale] || (locales.includes(initialLocale) ? initialLocale : "ko");
  let state = { key: "loading", values: {}, error: false };
  let ownerIdentity = null;
  let ownerToken = null;
  let preview = null;
  let session = null;
  let timer = null;
  let controller = null;
  let requestId = 0;
  let playhead = 0;
  let desiredPlaying = false;
  let internalPlay = false;
  let restoringSeek = false;
  let ignoringMediaError = false;
  let recoveryUsed = false;
  let subtitleUrls = [];

  function t(key, values = {}) {
    return (copy[locale][key] || key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
  }

  function setState(key, values = {}, error = false) {
    state = { key, values, error };
    elements.previewState.textContent = t(key, values);
    elements.previewState.classList.toggle("is-error", error);
  }

  function renderLocale() {
    document.documentElement.lang = locale;
    document.title = t("title") + " | Lumina Stage";
    elements.previewLocale.value = locale;
    elements.localeLabel.textContent = t("language");
    elements.studioLink.textContent = t("studio");
    elements.privateLabel.textContent = t("private");
    elements.previewTitle.textContent = t("title");
    elements.previewStart.textContent = t(session ? "resume" : "play");
    elements.previewRetry.textContent = t("retry");
    if (preview) renderDetails();
    setState(state.key, state.values, state.error);
  }

  function auth() {
    for (const key of ["lumina_auth", "lumina.session"]) {
      try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        const accessToken = value?.accessToken || value?.access_token || value?.token || value?.tokens?.accessToken || value?.tokens?.access_token;
        if (accessToken) {
          return { key, value, accessToken,
            refreshToken: value.refreshToken || value.refresh_token || value.tokens?.refreshToken || value.tokens?.refresh_token || null };
        }
      } catch (_) {}
    }
    return null;
  }

  function identity(current) {
    const user = current?.value?.user || current?.value?.viewer;
    return user?.id || user?.email || current?.accessToken || null;
  }

  function sameOwner() {
    const current = auth();
    if (!current || !ownerIdentity || identity(current) !== ownerIdentity || current.accessToken !== ownerToken) {
      lock(current ? "switched" : "signIn");
      return false;
    }
    return true;
  }

  async function refreshAuth(current, signal) {
    if (!current?.refreshToken) return null;
    const response = await fetch(apiBase + "/api/v1/auth/refresh", {
      method: "POST", credentials: "include", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: current.refreshToken }), signal
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    const accessToken = data?.accessToken || data?.access_token || data?.tokens?.accessToken || data?.tokens?.access_token;
    if (!accessToken) return null;
    const updated = { ...current.value, ...data, accessToken,
      refreshToken: data?.refreshToken || data?.refresh_token || data?.tokens?.refreshToken || data?.tokens?.refresh_token || current.refreshToken,
      user: data?.user || current.value.user };
    if (ownerIdentity && identity({ value: updated, accessToken }) !== ownerIdentity) return null;
    localStorage.setItem(current.key, JSON.stringify(updated));
    ownerToken = accessToken;
    return { ...current, value: updated, accessToken, refreshToken: updated.refreshToken };
  }

  async function apiRequest(path, method, signal) {
    let current = auth();
    if (!current) return { status: 401, ok: false };
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(apiBase + path, {
        method, credentials: "include", cache: "no-store", signal,
        headers: { Authorization: "Bearer " + current.accessToken,
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
        ...(method === "POST" ? { body: "{}" } : {})
      });
      if (response.status !== 401 || attempt) return response;
      current = await refreshAuth(current, signal);
      if (!current) return response;
    }
  }

  function clearTimer() { if (timer) clearTimeout(timer); timer = null; }

  function stopMedia() {
    clearTimer();
    requestId++;
    controller?.abort();
    controller = null;
    desiredPlaying = false;
    if (Number.isFinite(video.currentTime)) playhead = video.currentTime;
    ignoringMediaError = true;
    video.pause();
    video.removeAttribute("src");
    video.load();
    session = null;
    queueMicrotask(() => { ignoringMediaError = false; });
    elements.previewStart.textContent = t("resume");
  }

  function clearSubtitles() {
    video.querySelectorAll("track").forEach(track => track.remove());
    subtitleUrls.forEach(item => URL.revokeObjectURL(item.url));
    subtitleUrls = [];
  }

  function lock(key) {
    stopMedia();
    clearSubtitles();
    ownerIdentity = null;
    ownerToken = null;
    preview = null;
    elements.previewPlayer.hidden = true;
    elements.previewRetry.hidden = true;
    setState(key, {}, true);
  }

  function statusError(status) {
    if (status === 401) return "signIn";
    if (status === 403 || status === 404) return "denied";
    if (status === 409) return "unavailable";
    return "failed";
  }

  function duration(ms) {
    const seconds = Math.floor(ms / 1000);
    return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  }

  function validTrack(track, available, durationMs) {
    if (track?.status !== "available" || track.format !== "json-cues" ||
        !locales.includes(track.locale) || !available.includes(track.locale) ||
        !Array.isArray(track.cues) || !track.cues.length || track.cues.length > 2000) return false;
    let end = 0;
    let totalText = 0;
    return track.cues.every(cue => {
      if (!Number.isSafeInteger(cue?.startMs) || !Number.isSafeInteger(cue?.endMs) ||
          cue.startMs < end || cue.endMs <= cue.startMs || cue.endMs > durationMs ||
          typeof cue.text !== "string" || !cue.text.trim() || cue.text.length > 2000 ||
          /[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(cue.text)) return false;
      totalText += cue.text.length;
      if (totalText > 100000) return false;
      end = cue.endMs;
      return true;
    });
  }

  function vttTime(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor(ms / 60000) % 60;
    const seconds = Math.floor(ms / 1000) % 60;
    return [hours, minutes, seconds].map(value => String(value).padStart(2, "0")).join(":") + "." + String(ms % 1000).padStart(3, "0");
  }

  function buildVtt(cues) {
    return "WEBVTT\n\n" + cues.map(cue => vttTime(cue.startMs) + " --> " + vttTime(cue.endMs) +
      "\n" + cue.text.replace(/&/g, "&amp;").replace(/-->/g, "--&gt;").replace(/[\r\n]+/g, " ") + "\n").join("\n");
  }

  function renderDetails() {
    elements.previewDuration.textContent = t("duration", { value: duration(preview.media.durationMs) });
    const names = subtitleUrls.map(item => languageNames[item.locale]).join(", ");
    elements.previewSubtitles.textContent = names ? t("subtitles", { value: names }) : t("noSubtitles");
  }

  function installSubtitles(data) {
    clearSubtitles();
    const available = Array.isArray(data.availableSubtitleLocales) ? data.availableSubtitleLocales : [];
    const seen = new Set();
    for (const track of Array.isArray(data.subtitles) ? data.subtitles.slice(0, 5) : []) {
      if (seen.has(track?.locale) || !validTrack(track, available, data.media.durationMs)) continue;
      seen.add(track.locale);
      const url = URL.createObjectURL(new Blob([buildVtt(track.cues)], { type: "text/vtt" }));
      const element = document.createElement("track");
      element.kind = "subtitles";
      element.srclang = track.locale;
      element.label = languageNames[track.locale];
      element.src = url;
      element.default = track.locale === locale;
      video.append(element);
      subtitleUrls.push({ url, locale: track.locale });
    }
  }

  async function loadPreview() {
    elements.previewRetry.hidden = true;
    if (fileIds.length === 0) return setState("missing", {}, true);
    if (fileIds.length !== 1 || !uuid.test(fileId)) return setState("invalid", {}, true);
    if (location.protocol !== "https:" || !/^https:\/\//.test(apiBase)) return setState("secure", {}, true);
    const current = auth();
    if (!current) return setState("signIn", {}, true);
    ownerIdentity = identity(current);
    ownerToken = current.accessToken;
    setState("loading");
    const pending = new AbortController();
    const timeout = setTimeout(() => pending.abort(), 12000);
    try {
      const response = await apiRequest(`/api/v1/me/ott-media/files/${fileId}/preview`, "GET", pending.signal);
      if (!sameOwner()) return;
      if (!response.ok) {
        const key = statusError(response.status);
        if (key === "signIn" || key === "denied") return lock(key);
        setState(key, {}, true);
        elements.previewRetry.hidden = false;
        return;
      }
      const data = await response.json();
      if (!sameOwner()) return;
      if (data?.fileId !== fileId || data.status !== "confirmed" || data.visibility !== "private" ||
          data.media?.mimeType !== "video/mp4" || !Number.isSafeInteger(data.media.durationMs) || data.media.durationMs <= 0 ||
          data.browserPlayback?.sessionPath !== `/api/v1/me/ott-media/files/${fileId}/playback-session` ||
          data.browserPlayback.method !== "POST" || data.browserPlayback.mode !== "secure_http_only_cookie") {
        return lock("unavailable");
      }
      preview = data;
      installSubtitles(data);
      renderDetails();
      elements.previewPlayer.hidden = false;
      elements.previewStart.textContent = t("play");
      setState("ready");
    } catch (_) {
      if (ownerIdentity) { setState("failed", {}, true); elements.previewRetry.hidden = false; }
    } finally {
      clearTimeout(timeout);
    }
  }

  function scheduleRefresh() {
    clearTimer();
    if (!desiredPlaying || !session || document.hidden) return;
    timer = setTimeout(() => { if (desiredPlaying) renewSession({ reload: false, resume: true, position: video.currentTime }); },
      Math.max(1000, session.expiresAt - Date.now() - 40000));
  }

  function startNative() {
    if (!sameOwner() || document.hidden || !session || session.expiresAt <= Date.now() + 40000) return;
    desiredPlaying = true;
    internalPlay = true;
    Promise.resolve(video.play()).then(scheduleRefresh, () => {
      desiredPlaying = false;
      clearTimer();
      setState("mediaFailed", {}, true);
    }).finally(() => { internalPlay = false; });
  }

  function attachMedia(path, position, resume, id) {
    ignoringMediaError = true;
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.addEventListener("loadedmetadata", () => {
      if (id !== requestId || !sameOwner()) return;
      const target = Math.min(Math.max(0, position), Math.max(0, video.duration - 0.1));
      playhead = target;
      if (target > 0) {
        restoringSeek = true;
        video.addEventListener("seeked", () => {
          if (id !== requestId || !sameOwner()) return;
          restoringSeek = false;
          if (resume && desiredPlaying) startNative();
        }, { once: true });
        video.currentTime = target;
        setTimeout(() => { if (id === requestId) restoringSeek = false; }, 1500);
      } else if (resume && desiredPlaying) startNative();
    }, { once: true });
    video.src = apiBase + path;
    video.load();
    queueMicrotask(() => { ignoringMediaError = false; });
  }

  async function renewSession({ reload, resume, position }) {
    if (!preview || !sameOwner() || document.hidden) return;
    desiredPlaying = Boolean(resume);
    clearTimer();
    const id = ++requestId;
    controller?.abort();
    controller = new AbortController();
    const pending = controller;
    const timeout = setTimeout(() => pending.abort(), 12000);
    elements.previewStart.disabled = true;
    setState("connecting");
    try {
      const response = await apiRequest(preview.browserPlayback.sessionPath, "POST", pending.signal);
      if (id !== requestId || !sameOwner()) return;
      if (!response.ok) {
        const key = statusError(response.status);
        if (key === "signIn" || key === "denied") return lock(key);
        stopMedia();
        return setState(key, {}, true);
      }
      const data = await response.json();
      if (id !== requestId || !sameOwner()) return;
      const playback = data?.playback;
      const expected = `/api/v1/ott-media/private-files/${fileId}/delivery`;
      const expiry = Date.parse(playback?.expiresAt);
      if (playback?.path !== expected || playback.mode !== "secure_http_only_cookie" ||
          playback.rangeSupported !== true || !Number.isFinite(expiry) ||
          expiry <= Date.now() + 40000 || expiry > Date.now() + 70000) {
        stopMedia();
        return setState("failed", {}, true);
      }
      session = { path: playback.path, expiresAt: expiry };
      elements.previewStart.textContent = t("resume");
      if (reload || !video.getAttribute("src")) attachMedia(session.path, position, resume, id);
      else if (resume && desiredPlaying && video.paused) startNative();
      setState(desiredPlaying ? "ready" : "paused");
      scheduleRefresh();
    } catch (_) {
      if (id === requestId) { stopMedia(); setState("failed", {}, true); }
    } finally {
      clearTimeout(timeout);
      if (id === requestId) controller = null;
      if (id === requestId || controller === null) elements.previewStart.disabled = false;
    }
  }

  function beginPlayback() {
    if (!preview || !sameOwner() || document.hidden) return;
    recoveryUsed = false;
    if (session && session.expiresAt > Date.now() + 40000 && video.getAttribute("src")) startNative();
    else renewSession({ reload: true, resume: true, position: playhead });
  }

  elements.previewLocale.addEventListener("change", () => {
    if (locales.includes(elements.previewLocale.value)) locale = elements.previewLocale.value;
    renderLocale();
  });
  elements.previewStart.addEventListener("click", beginPlayback);
  elements.previewRetry.addEventListener("click", loadPreview);
  video.addEventListener("play", () => {
    if (internalPlay) return;
    video.pause();
    playhead = video.currentTime;
    beginPlayback();
  });
  video.addEventListener("pause", () => {
    if (!video.paused || internalPlay || ignoringMediaError) return;
    desiredPlaying = false;
    clearTimer();
    if (preview && !document.hidden && !ignoringMediaError) setState("paused");
  });
  video.addEventListener("seeking", () => {
    if (restoringSeek || !session || document.hidden) return;
    const position = video.currentTime;
    const resume = desiredPlaying || !video.paused;
    video.pause();
    playhead = position;
    renewSession({ reload: true, resume, position });
  });
  video.addEventListener("timeupdate", () => { if (Number.isFinite(video.currentTime)) playhead = video.currentTime; });
  video.addEventListener("ended", () => { desiredPlaying = false; clearTimer(); });
  video.addEventListener("error", () => {
    if (ignoringMediaError || !session || document.hidden) return;
    if (controller) { stopMedia(); setState("mediaFailed", {}, true); return; }
    const position = playhead;
    const resume = desiredPlaying;
    video.pause();
    if (recoveryUsed) { stopMedia(); setState("mediaFailed", {}, true); return; }
    recoveryUsed = true;
    renewSession({ reload: true, resume, position });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && preview) { stopMedia(); setState("hidden"); }
  });
  window.addEventListener("storage", event => { if (event.key === "lumina_auth" || event.key === "lumina.session") sameOwner(); });
  window.addEventListener("focus", () => { if (ownerIdentity) sameOwner(); });
  window.addEventListener("pagehide", () => { stopMedia(); clearSubtitles(); clearInterval(authWatch); });
  const authWatch = setInterval(() => { if (ownerIdentity) sameOwner(); }, 1000);
  renderLocale();
  loadPreview();
})();
