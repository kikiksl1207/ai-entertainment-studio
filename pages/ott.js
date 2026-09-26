(function () {
  "use strict";

  const copy = {
    ko: { name: "루미나 선택극장", description: "공개와 감상 권한이 확인된 작품만 소개합니다.", catalog: "공개 작품", note: "현재 공개 기준을 충족한 작품을 확인할 수 있습니다.", loading: "공개 작품을 확인하고 있어요.", emptyTitle: "지금 공개된 선택극장 작품이 없습니다.", emptyBody: "감상 가능한 작품이 공개되면 이곳에 표시됩니다.", errorTitle: "작품 목록을 불러오지 못했습니다.", errorBody: "잠시 후 다시 확인해 주세요.", by: "제작", details: "작품 정보", unavailable: "현재 이 작품의 감상 이용은 제공되지 않습니다." },
    en: { name: "Lumina Choice Theater", description: "Only titles cleared for public release and viewing are listed.", catalog: "Released titles", note: "Browse titles that currently meet the public release requirements.", loading: "Checking released titles.", emptyTitle: "No Choice Theater titles are public right now.", emptyBody: "Titles will appear here when they are cleared for viewing.", errorTitle: "The catalog could not be loaded.", errorBody: "Please check again shortly.", by: "Created by", details: "Title details", unavailable: "Viewing is not currently available for this title." },
    ja: { name: "ルミナ選択劇場", description: "公開と視聴の権利が確認された作品のみ掲載します。", catalog: "公開作品", note: "現在の公開基準を満たす作品を確認できます。", loading: "公開作品を確認しています。", emptyTitle: "現在公開中の選択劇場作品はありません。", emptyBody: "視聴可能な作品が公開されると、ここに表示されます。", errorTitle: "作品一覧を読み込めませんでした。", errorBody: "しばらくしてからもう一度ご確認ください。", by: "制作", details: "作品情報", unavailable: "現在、この作品の視聴は提供されていません。" },
    "zh-Hans": { name: "Lumina 选择剧场", description: "这里只展示已确认公开和观看授权的作品。", catalog: "公开作品", note: "查看目前符合公开标准的作品。", loading: "正在确认公开作品。", emptyTitle: "目前没有公开的选择剧场作品。", emptyBody: "可观看作品公开后会显示在这里。", errorTitle: "无法加载作品列表。", errorBody: "请稍后再试。", by: "制作", details: "作品信息", unavailable: "目前暂不提供此作品的观看服务。" },
    "zh-Hant": { name: "Lumina 選擇劇場", description: "這裡只展示已確認公開與觀看授權的作品。", catalog: "公開作品", note: "查看目前符合公開標準的作品。", loading: "正在確認公開作品。", emptyTitle: "目前沒有公開的選擇劇場作品。", emptyBody: "可觀看作品公開後會顯示在這裡。", errorTitle: "無法載入作品列表。", errorBody: "請稍後再試。", by: "製作", details: "作品資訊", unavailable: "目前暫不提供此作品的觀看服務。" },
  };

  const root = document.getElementById("ottCatalogRoot");
  const catalog = document.getElementById("ottCatalog");
  const demoCopy = {
    ko: { description: "선택에 따라 달라지는 영상을 만나보세요.", browse: "영상 작품", watch: "시청하기", back: "작품 목록", kicker: "인터랙티브 영상 시연", title: "엄마의 선택", synopsis: "도망치던 엄마 앞에 아이가 쓰러진다.", meta: "한국어 음성 · 선택형 시연", prompt: "아이가 쓰러졌다. 엄마는 어떻게 할까?", again: "다른 선택을 해보세요.", embrace: "돌아가 아이를 안아준다", ignore: "아이를 외면하고 계속 도망간다", hesitate: "그 자리에서 망설인다", pending: "아직 선택할 수 없습니다.", restart: "처음부터 다시 보기", error: "영상을 불러오지 못했어요.", retry: "다시 시도" },
    en: { description: "Watch a story change with your choice.", browse: "Video titles", watch: "Watch", back: "All titles", kicker: "Interactive video preview", title: "A Mother's Choice", synopsis: "A fleeing mother sees her child fall.", meta: "Korean audio · interactive preview", prompt: "The child has fallen. What will her mother do?", again: "Make another choice.", embrace: "Go back and hold her child", ignore: "Leave her child and keep running", hesitate: "Stop and hesitate", pending: "This choice is not available yet.", restart: "Watch from the beginning", error: "The video could not be loaded.", retry: "Try again" },
    ja: { description: "選択によって変わる映像をお楽しみください。", browse: "映像作品", watch: "視聴する", back: "作品一覧", kicker: "インタラクティブ映像プレビュー", title: "母の選択", synopsis: "逃げる母の前で子どもが倒れる。", meta: "韓国語音声・選択型プレビュー", prompt: "子どもが倒れた。母はどうする？", again: "別の選択をしてください。", embrace: "戻って子どもを抱きしめる", ignore: "子どもを置いて逃げ続ける", hesitate: "その場でためらう", pending: "まだ選択できません。", restart: "最初から見る", error: "映像を読み込めませんでした。", retry: "再試行" },
    "zh-Hans": { description: "观看因选择而改变的故事。", browse: "视频作品", watch: "观看", back: "作品列表", kicker: "互动视频预览", title: "母亲的选择", synopsis: "逃跑的母亲看到孩子倒下。", meta: "韩语音频 · 互动预览", prompt: "孩子倒下了。母亲会怎么做？", again: "做出另一个选择。", embrace: "回去拥抱孩子", ignore: "不理会孩子，继续逃跑", hesitate: "停下脚步犹豫", pending: "暂时无法选择。", restart: "从头观看", error: "视频加载失败。", retry: "重试" },
    "zh-Hant": { description: "觀看因選擇而改變的故事。", browse: "影片作品", watch: "觀看", back: "作品列表", kicker: "互動影片預覽", title: "母親的選擇", synopsis: "逃跑的母親看見孩子倒下。", meta: "韓語音訊 · 互動預覽", prompt: "孩子倒下了。母親會怎麼做？", again: "做出另一個選擇。", embrace: "回去擁抱孩子", ignore: "不理會孩子，繼續逃跑", hesitate: "停下腳步猶豫", pending: "暫時無法選擇。", restart: "從頭觀看", error: "影片載入失敗。", retry: "重試" },
  };
  const controlsCopy = {
    ko: { play: "재생", pause: "일시정지", mute: "음소거", unmute: "음소거 해제", fullscreen: "전체화면", exitFullscreen: "전체화면 종료", seek: "재생 위치" },
    en: { play: "Play", pause: "Pause", mute: "Mute", unmute: "Unmute", fullscreen: "Fullscreen", exitFullscreen: "Exit fullscreen", seek: "Seek" },
    ja: { play: "再生", pause: "一時停止", mute: "ミュート", unmute: "ミュート解除", fullscreen: "全画面表示", exitFullscreen: "全画面表示を終了", seek: "再生位置" },
    "zh-Hans": { play: "播放", pause: "暂停", mute: "静音", unmute: "取消静音", fullscreen: "全屏", exitFullscreen: "退出全屏", seek: "播放进度" },
    "zh-Hant": { play: "播放", pause: "暫停", mute: "靜音", unmute: "取消靜音", fullscreen: "全螢幕", exitFullscreen: "退出全螢幕", seek: "播放進度" },
  };
  const browse = document.getElementById("ottBrowse");
  const openDemo = document.getElementById("ottOpenDemo");
  const demoSection = document.getElementById("ottDemo");
  const backToList = document.getElementById("ottBackToList");
  const demoVideo = document.getElementById("ottDemoVideo");
  const playerWrap = document.querySelector(".ott-video-wrap");
  const playerControls = document.getElementById("ottPlayerControls");
  const togglePlayback = document.getElementById("ottTogglePlayback");
  const seek = document.getElementById("ottSeek");
  const time = document.getElementById("ottTime");
  const toggleMute = document.getElementById("ottToggleMute");
  const toggleFullscreen = document.getElementById("ottToggleFullscreen");
  const fullscreenExit = document.getElementById("ottFullscreenExit");
  const choiceOverlay = document.getElementById("ottChoiceOverlay");
  const videoError = document.getElementById("ottVideoError");
  const restart = document.getElementById("ottRestart");
  const clipRoot = "/assets/ott/mothers-choice/";
  const clips = { common: "01-common-to-choice.mp4", embrace: "02-branch-embrace-original.mp4", ignore: "03-branch-ignore.mp4", hesitate: "04-branch-hesitate.mp4" };
  const availableBranches = new Set(["embrace"]);
  let currentClip = "common";
  let availabilityRequestId = 0;
  let orientationLocked = false;
  const locale = () => {
    const value = String(window.LuminaI18n?.getLocale?.() || localStorage.getItem("lumina_locale") || navigator.language || "ko");
    if (value.startsWith("ja")) return "ja";
    if (value.startsWith("zh-Hant") || /zh-(TW|HK|MO)/i.test(value)) return "zh-Hant";
    if (value.startsWith("zh")) return "zh-Hans";
    if (value.startsWith("en")) return "en";
    return "ko";
  };
  const tr = (key) => copy[locale()]?.[key] || copy.ko[key];
  const text = (value) => value?.[locale()] || value?.ko || value?.en || "";
  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

  function applyCopy() {
    document.documentElement.lang = locale();
    const demo = demoCopy[locale()] || demoCopy.ko;
    document.getElementById("ottTitle").textContent = tr("name");
    document.title = `${tr("name")} | Lumina Stage`;
    document.getElementById("ottDescription").textContent = demo.description;
    document.getElementById("ottBrowseTitle").textContent = demo.browse;
    document.getElementById("ottPosterTitle").textContent = demo.title;
    document.getElementById("ottPosterSynopsis").textContent = demo.synopsis;
    document.getElementById("ottPosterMeta").textContent = demo.meta;
    document.getElementById("ottPosterWatch").textContent = demo.watch;
    backToList.textContent = demo.back;
    document.getElementById("ottDemoKicker").textContent = demo.kicker;
    document.getElementById("ottDemoTitle").textContent = demo.title;
    document.getElementById("ottDemoSynopsis").textContent = demo.synopsis;
    document.getElementById("ottDemoMeta").textContent = demo.meta;
    document.getElementById("ottChoicePrompt").textContent = currentClip === "common" ? demo.prompt : demo.again;
    syncBranchButtons();
    document.getElementById("ottRestart").textContent = demo.restart;
    document.getElementById("ottVideoErrorText").textContent = demo.error;
    document.getElementById("ottVideoRetry").textContent = demo.retry;
    demoVideo.setAttribute("aria-label", demo.title);
    syncPlayerControls();
    document.getElementById("ottCatalogTitle").textContent = tr("catalog");
    document.getElementById("ottCatalogNote").textContent = tr("note");
  }

  const formatTime = (seconds) => {
    const whole = Math.floor(Number.isFinite(seconds) ? seconds : 0);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  };
  const isFullscreen = () => document.fullscreenElement === playerWrap || playerWrap.classList.contains("is-pseudo-fullscreen");
  function syncBranchButtons() {
    const demo = demoCopy[locale()] || demoCopy.ko;
    choiceOverlay.querySelectorAll("[data-ott-branch]").forEach((button) => {
      const label = document.getElementById(`ottChoice${button.dataset.ottBranch[0].toUpperCase()}${button.dataset.ottBranch.slice(1)}`);
      label.textContent = demo[button.dataset.ottBranch] + (button.disabled ? ` · ${demo.pending}` : "");
      button.title = button.disabled ? demo.pending : "";
    });
  }
  function syncPlayerControls() {
    const labels = controlsCopy[locale()] || controlsCopy.ko;
    const playing = !demoVideo.paused && !demoVideo.ended;
    togglePlayback.dataset.playing = String(playing);
    togglePlayback.title = togglePlayback.ariaLabel = playing ? labels.pause : labels.play;
    toggleMute.dataset.muted = String(demoVideo.muted);
    toggleMute.title = toggleMute.ariaLabel = demoVideo.muted ? labels.unmute : labels.mute;
    const fullscreenLabel = isFullscreen() ? labels.exitFullscreen : labels.fullscreen;
    toggleFullscreen.title = toggleFullscreen.ariaLabel = fullscreenLabel;
    fullscreenExit.textContent = labels.exitFullscreen;
    fullscreenExit.hidden = !isFullscreen() || (choiceOverlay.hidden && videoError.hidden);
    seek.ariaLabel = labels.seek;
    const duration = Number.isFinite(demoVideo.duration) ? demoVideo.duration : 0;
    seek.disabled = duration <= 0;
    seek.max = String(duration || 100);
    seek.value = String(Math.min(demoVideo.currentTime || 0, duration || 100));
    time.textContent = `${formatTime(demoVideo.currentTime)} / ${formatTime(duration)}`;
  }

  async function exitPlayerFullscreen() {
    if (document.fullscreenElement === playerWrap) {
      try { await document.exitFullscreen(); } catch { /* Keep the player usable if the browser rejects exit. */ }
    }
    unlockOrientation();
    playerWrap.classList.remove("is-pseudo-fullscreen");
    document.body.classList.remove("ott-fullscreen-active");
    syncPlayerControls();
  }

  function unlockOrientation() {
    if (!orientationLocked) return;
    orientationLocked = false;
    try { screen.orientation.unlock(); } catch { /* The browser may have already restored orientation. */ }
  }

  async function togglePlayerFullscreen() {
    if (isFullscreen()) return exitPlayerFullscreen();
    try {
      if (!playerWrap.requestFullscreen) throw new Error("element fullscreen unavailable");
      await playerWrap.requestFullscreen();
      if (document.fullscreenElement !== playerWrap) throw new Error("player was not fullscreened");
      if (navigator.maxTouchPoints > 0 && typeof screen.orientation?.lock === "function") {
        try {
          await screen.orientation.lock("landscape");
          orientationLocked = true;
          if (document.fullscreenElement !== playerWrap) unlockOrientation();
        } catch { /* Orientation lock is not supported by every mobile browser. */ }
      }
    } catch {
      playerWrap.classList.add("is-pseudo-fullscreen");
      document.body.classList.add("ott-fullscreen-active");
    }
    syncPlayerControls();
  }

  async function refreshBranchAvailability() {
    const requestId = ++availabilityRequestId;
    await Promise.all(["ignore", "hesitate"].map(async (key) => {
      let available = false;
      try {
        const response = await fetch(clipRoot + clips[key], { method: "HEAD", cache: "no-store" });
        available = response.ok && /^video\/mp4(?:;|$)/i.test(response.headers.get("content-type") || "")
          && Number(response.headers.get("content-length")) > 0;
      } catch { /* Keep an unavailable branch disabled. */ }
      if (requestId !== availabilityRequestId) return;
      if (available) availableBranches.add(key);
      else availableBranches.delete(key);
      const button = choiceOverlay.querySelector(`[data-ott-branch="${key}"]`);
      button.disabled = !available;
      syncBranchButtons();
    }));
  }

  function playClip(key) {
    if (!Object.prototype.hasOwnProperty.call(clips, key) || (key !== "common" && !availableBranches.has(key))) return;
    currentClip = key;
    choiceOverlay.hidden = true;
    videoError.hidden = true;
    playerControls.hidden = false;
    demoVideo.src = clipRoot + clips[key];
    demoVideo.load();
    syncPlayerControls();
    demoVideo.play().catch(syncPlayerControls);
  }

  function showChoices() {
    if (!choiceOverlay.hidden) return;
    void refreshBranchAvailability();
    const demo = demoCopy[locale()] || demoCopy.ko;
    document.getElementById("ottChoicePrompt").textContent = currentClip === "common" ? demo.prompt : demo.again;
    restart.hidden = currentClip === "common";
    videoError.hidden = true;
    playerControls.hidden = true;
    choiceOverlay.hidden = false;
    syncPlayerControls();
    if (!isFullscreen()) choiceOverlay.scrollIntoView({ block: "center", behavior: "auto" });
    choiceOverlay.querySelector("[data-ott-branch]").focus({ preventScroll: true });
  }

  togglePlayback.addEventListener("click", () => {
    if (demoVideo.paused) demoVideo.play().catch(syncPlayerControls);
    else demoVideo.pause();
  });
  seek.addEventListener("input", () => { if (!seek.disabled) demoVideo.currentTime = Number(seek.value); });
  toggleMute.addEventListener("click", () => { demoVideo.muted = !demoVideo.muted; syncPlayerControls(); });
  toggleFullscreen.addEventListener("click", () => { void togglePlayerFullscreen(); });
  fullscreenExit.addEventListener("click", () => { void exitPlayerFullscreen(); });
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement !== playerWrap) unlockOrientation();
    syncPlayerControls();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && playerWrap.classList.contains("is-pseudo-fullscreen")) void exitPlayerFullscreen();
  });
  for (const event of ["loadedmetadata", "durationchange", "play", "pause", "volumechange"]) demoVideo.addEventListener(event, syncPlayerControls);

  openDemo.addEventListener("click", () => {
    browse.hidden = true;
    demoSection.hidden = false;
    playClip("common");
    demoSection.scrollIntoView({ block: "start" });
    demoVideo.focus({ preventScroll: true });
  });
  backToList.addEventListener("click", async () => {
    demoVideo.pause();
    await exitPlayerFullscreen();
    choiceOverlay.hidden = true;
    videoError.hidden = true;
    demoSection.hidden = true;
    browse.hidden = false;
    openDemo.focus();
  });
  demoVideo.addEventListener("timeupdate", () => {
    syncPlayerControls();
    if (currentClip === "common" && Number.isFinite(demoVideo.duration) && demoVideo.duration - demoVideo.currentTime <= 2) showChoices();
  });
  demoVideo.addEventListener("ended", showChoices);
  demoVideo.addEventListener("error", () => {
    choiceOverlay.hidden = true;
    videoError.hidden = false;
    playerControls.hidden = true;
    syncPlayerControls();
  });
  choiceOverlay.querySelectorAll("[data-ott-branch]").forEach((button) => {
    button.addEventListener("click", () => playClip(button.dataset.ottBranch));
  });
  restart.addEventListener("click", () => playClip("common"));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refreshBranchAvailability(); });
  document.getElementById("ottVideoRetry").addEventListener("click", () => {
    videoError.hidden = true;
    playerControls.hidden = false;
    demoVideo.load();
    demoVideo.play().catch(syncPlayerControls);
    syncPlayerControls();
  });

  function status(title, body = "") {
    root.innerHTML = `<div class="ott-status"><div><strong>${escapeHtml(title)}</strong>${body ? `<p>${escapeHtml(body)}</p>` : ""}</div></div>`;
  }

  function render(items) {
    catalog.hidden = false;
    if (!items.length) {
      status(tr("emptyTitle"), tr("emptyBody"));
      return;
    }
    root.innerHTML = `<div class="ott-grid">${items.map((item) => `<article class="ott-card">
      <div class="ott-card-art" aria-hidden="true">LUMINA STAGE</div>
      <div class="ott-card-body"><h3>${escapeHtml(text(item.title))}</h3><p>${escapeHtml(text(item.synopsis))}</p>
      <div class="ott-card-meta"><span>${escapeHtml(tr("by"))} ${escapeHtml(text(item.creatorName))}</span><span>${escapeHtml(new Date(item.publishedAt).toLocaleDateString(locale()))}</span></div>
      <button class="ott-detail-button" type="button">${escapeHtml(tr("details"))}</button>
      <p class="ott-boundary" hidden>${escapeHtml(tr("unavailable"))}</p></div></article>`).join("")}</div>`;
    root.querySelectorAll(".ott-detail-button").forEach((button) => button.addEventListener("click", () => {
      const boundary = button.nextElementSibling;
      boundary.hidden = !boundary.hidden;
    }));
  }

  async function load() {
    catalog.hidden = false;
    status(tr("loading"));
    try {
      const response = await fetch("/api/v1/ott", { headers: { Accept: "application/json" }, credentials: "omit" });
      if (!response.ok) throw new Error("catalog unavailable");
      const payload = await response.json();
      render(Array.isArray(payload?.items) ? payload.items : []);
    } catch {
      status(tr("errorTitle"), tr("errorBody"));
    }
  }

  applyCopy();
  void refreshBranchAvailability();
  window.addEventListener("lumina:localechange", () => { applyCopy(); load(); });
  load();
})();
