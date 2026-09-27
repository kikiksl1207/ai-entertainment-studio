(function () {
  "use strict";

  const copy = {
    ko: { name: "루미나 선택극장", catalog: "공개 작품", note: "현재 공개 기준을 충족한 작품을 확인할 수 있습니다.", loading: "공개 작품을 확인하고 있어요.", emptyTitle: "아직 공개된 작품이 없습니다.", emptyBody: "감상 가능한 작품이 공개되면 이곳에 표시됩니다.", errorTitle: "작품 목록을 불러오지 못했습니다.", errorBody: "잠시 후 다시 확인해 주세요.", by: "제작", details: "작품 정보", back: "작품 목록", unavailable: "현재 이 작품의 감상 이용은 제공되지 않습니다." },
    en: { name: "Lumina Choice Theater", catalog: "Released titles", note: "Browse titles that currently meet the public release requirements.", loading: "Checking released titles.", emptyTitle: "No titles are public right now.", emptyBody: "Titles will appear here when they are cleared for viewing.", errorTitle: "The catalog could not be loaded.", errorBody: "Please check again shortly.", by: "Created by", details: "Title details", back: "All titles", unavailable: "Viewing is not currently available for this title." },
    ja: { name: "ルミナ選択劇場", catalog: "公開作品", note: "現在の公開基準を満たす作品を確認できます。", loading: "公開作品を確認しています。", emptyTitle: "現在公開中の作品はありません。", emptyBody: "視聴可能な作品が公開されると、ここに表示されます。", errorTitle: "作品一覧を読み込めませんでした。", errorBody: "しばらくしてからもう一度ご確認ください。", by: "制作", details: "作品情報", back: "作品一覧", unavailable: "現在、この作品の視聴は提供されていません。" },
    "zh-Hans": { name: "Lumina 选择剧场", catalog: "公开作品", note: "查看目前符合公开标准的作品。", loading: "正在确认公开作品。", emptyTitle: "目前没有公开的作品。", emptyBody: "可观看作品公开后会显示在这里。", errorTitle: "无法加载作品列表。", errorBody: "请稍后再试。", by: "制作", details: "作品信息", back: "作品列表", unavailable: "目前暂不提供此作品的观看服务。" },
    "zh-Hant": { name: "Lumina 選擇劇場", catalog: "公開作品", note: "查看目前符合公開標準的作品。", loading: "正在確認公開作品。", emptyTitle: "目前沒有公開的作品。", emptyBody: "可觀看作品公開後會顯示在這裡。", errorTitle: "無法載入作品列表。", errorBody: "請稍後再試。", by: "製作", details: "作品資訊", back: "作品列表", unavailable: "目前暫不提供此作品的觀看服務。" },
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
  const jokerCopy = {
    ko: { title: "조커의 선택", synopsis: "조커를 고르는 순간, 이야기는 두 결말로 갈라진다.", meta: "한국어 음성 · 선택형 시연", prompt: "어떤 결말을 선택할까요?", again: "다른 결말을 선택해 보세요.", embrace: "조커를 고른다", ignore: "조커를 안 고른다" },
    en: { title: "The Joker Choice", synopsis: "One card leads to two different endings.", meta: "Korean audio · interactive preview", prompt: "Which ending will you choose?", again: "Choose the other ending.", embrace: "Choose the Joker", ignore: "Do not choose the Joker" },
    ja: { title: "ジョーカーの選択", synopsis: "一枚のカードから二つの結末へ。", meta: "韓国語音声・選択型プレビュー", prompt: "どちらの結末を選びますか？", again: "もう一つの結末を選んでください。", embrace: "ジョーカーを選ぶ", ignore: "ジョーカーを選ばない" },
    "zh-Hans": { title: "小丑牌的选择", synopsis: "一张牌通向两种结局。", meta: "韩语音频 · 互动预览", prompt: "你会选择哪种结局？", again: "试试另一种结局。", embrace: "选择小丑牌", ignore: "不选择小丑牌" },
    "zh-Hant": { title: "小丑牌的選擇", synopsis: "一張牌通向兩種結局。", meta: "韓語音訊 · 互動預覽", prompt: "你會選擇哪種結局？", again: "試試另一種結局。", embrace: "選擇小丑牌", ignore: "不選擇小丑牌" },
  };
  const controlsCopy = {
    ko: { play: "재생", pause: "일시정지", mute: "음소거", unmute: "음소거 해제", fullscreen: "전체화면", exitFullscreen: "전체화면 종료", seek: "재생 위치" },
    en: { play: "Play", pause: "Pause", mute: "Mute", unmute: "Unmute", fullscreen: "Fullscreen", exitFullscreen: "Exit fullscreen", seek: "Seek" },
    ja: { play: "再生", pause: "一時停止", mute: "ミュート", unmute: "ミュート解除", fullscreen: "全画面表示", exitFullscreen: "全画面表示を終了", seek: "再生位置" },
    "zh-Hans": { play: "播放", pause: "暂停", mute: "静音", unmute: "取消静音", fullscreen: "全屏", exitFullscreen: "退出全屏", seek: "播放进度" },
    "zh-Hant": { play: "播放", pause: "暫停", mute: "靜音", unmute: "取消靜音", fullscreen: "全螢幕", exitFullscreen: "退出全螢幕", seek: "播放進度" },
  };
  const browse = document.getElementById("ottBrowse");
  const posterButtons = Array.from(document.querySelectorAll("[data-ott-demo]"));
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
  const works = {
    mother: {
      root: "/assets/ott/mothers-choice/", poster: "/assets/ott/mothers-choice/poster-common.jpg", copy: demoCopy,
      clips: { common: "01-common-to-choice.mp4", embrace: "02-branch-embrace-original.mp4", ignore: "03-branch-ignore.mp4", hesitate: "04-branch-daughter-resists-final.mp4" },
      branches: ["embrace", "ignore", "hesitate"], initiallyAvailable: ["embrace"],
    },
    joker: {
      root: "/assets/ott/joker-choice/", poster: "/assets/ott/joker-choice/poster.jpg", copy: jokerCopy,
      clips: { common: "01-common.mp4", embrace: "02-original-ending.mp4", ignore: "03-alternate-ending.mp4" },
      branches: ["embrace", "ignore"], initiallyAvailable: [],
    },
  };
  let selectedWork = "mother";
  let activePoster = posterButtons[0];
  let availableBranches = new Set(works.mother.initiallyAvailable);
  let currentClip = "common";
  let catalogHasItems = false;
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
  const work = () => works[selectedWork];
  const workCopy = () => ({ ...(demoCopy[locale()] || demoCopy.ko), ...(work().copy[locale()] || work().copy.ko) });
  const text = (value) => value?.[locale()] || value?.ko || value?.en || "";
  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const posterPath = (value) => typeof value === "string" && /^\/assets\/ott\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.(?:webp|png|jpg|jpeg)$/.test(value) ? value : "";
  const detailPath = (item) => `/ott?title=${encodeURIComponent(item.slug)}`;
  const requestedSlug = () => new URLSearchParams(location.search).get("title");

  function poster(item) {
    const path = posterPath(item.posterPath);
    return path ? `<img src="${escapeHtml(path)}" alt="" loading="lazy" />` : '<span class="ott-card-art-fallback">LUMINA STAGE</span>';
  }

  function bindPosterFallbacks() {
    root.querySelectorAll(".ott-card-art img, .ott-detail-art img").forEach((img) => {
      const showFallback = () => {
        const fallback = document.createElement("span");
        fallback.className = "ott-card-art-fallback";
        fallback.textContent = "LUMINA STAGE";
        img.replaceWith(fallback);
      };
      img.addEventListener("error", showFallback, { once: true });
      if (img.complete && img.naturalWidth === 0) showFallback();
    });
  }

  function applyCopy() {
    document.documentElement.lang = locale();
    const demo = workCopy();
    const mother = demoCopy[locale()] || demoCopy.ko;
    const joker = jokerCopy[locale()] || jokerCopy.ko;
    document.getElementById("ottTitle").textContent = tr("name");
    document.title = `${tr("name")} | Lumina Stage`;
    document.getElementById("ottDescription").textContent = demo.description;
    document.getElementById("ottBrowseTitle").textContent = demo.browse;
    document.getElementById("ottPosterTitle").textContent = mother.title;
    document.getElementById("ottPosterSynopsis").textContent = mother.synopsis;
    document.getElementById("ottPosterMeta").textContent = mother.meta;
    document.getElementById("ottPosterWatch").textContent = demo.watch;
    document.getElementById("ottJokerTitle").textContent = joker.title;
    document.getElementById("ottJokerSynopsis").textContent = joker.synopsis;
    document.getElementById("ottJokerMeta").textContent = joker.meta;
    document.getElementById("ottJokerWatch").textContent = demo.watch;
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
    demoVideo.poster = work().poster;
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
    const demo = workCopy();
    choiceOverlay.querySelectorAll("[data-ott-branch]").forEach((button) => {
      button.hidden = !work().branches.includes(button.dataset.ottBranch);
      if (button.hidden) return;
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
    const selected = work();
    await Promise.all(selected.branches.map(async (key) => {
      let available = false;
      try {
        const response = await fetch(selected.root + selected.clips[key], { method: "HEAD", cache: "no-store" });
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
    if (!Object.prototype.hasOwnProperty.call(work().clips, key) || (key !== "common" && !availableBranches.has(key))) return;
    currentClip = key;
    choiceOverlay.hidden = true;
    videoError.hidden = true;
    playerControls.hidden = false;
    demoVideo.src = work().root + work().clips[key];
    demoVideo.load();
    syncPlayerControls();
    demoVideo.play().catch(syncPlayerControls);
  }

  function showChoices() {
    if (!choiceOverlay.hidden) return;
    void refreshBranchAvailability();
    const demo = workCopy();
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

  posterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedWork = button.dataset.ottDemo;
      activePoster = button;
      currentClip = "common";
      availableBranches = new Set(work().initiallyAvailable);
      ++availabilityRequestId;
      choiceOverlay.querySelectorAll("[data-ott-branch]").forEach((choice) => {
        choice.disabled = !availableBranches.has(choice.dataset.ottBranch);
      });
      applyCopy();
      void refreshBranchAvailability();
      browse.hidden = true;
      catalog.hidden = true;
      demoSection.hidden = false;
      playClip("common");
      demoSection.scrollIntoView({ block: "start" });
      demoVideo.focus({ preventScroll: true });
    });
  });
  backToList.addEventListener("click", async () => {
    demoVideo.pause();
    await exitPlayerFullscreen();
    choiceOverlay.hidden = true;
    videoError.hidden = true;
    demoSection.hidden = true;
    browse.hidden = false;
    catalog.hidden = !catalogHasItems;
    activePoster.focus();
  });
  demoVideo.addEventListener("timeupdate", () => {
    syncPlayerControls();
    if (selectedWork === "mother" && currentClip === "common" && Number.isFinite(demoVideo.duration) && demoVideo.duration - demoVideo.currentTime <= 2) showChoices();
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
    catalogHasItems = items.length > 0;
    document.body.classList.remove("ott-detail-view");
    if (!catalogHasItems) {
      catalog.hidden = true;
      return;
    }
    catalog.hidden = browse.hidden;
    root.innerHTML = `<div class="ott-grid">${items.map((item) => `<article class="ott-card">
      <a class="ott-card-art" href="${escapeHtml(detailPath(item))}" aria-label="${escapeHtml(text(item.title))} · ${escapeHtml(tr("details"))}">${poster(item)}</a>
      <div class="ott-card-body"><h3><a href="${escapeHtml(detailPath(item))}">${escapeHtml(text(item.title))}</a></h3><p>${escapeHtml(text(item.synopsis))}</p>
      <div class="ott-card-meta"><span>${escapeHtml(tr("by"))} ${escapeHtml(text(item.creatorName))}</span><span>${escapeHtml(new Date(item.publishedAt).toLocaleDateString(locale()))}</span></div>
      <a class="ott-detail-button" href="${escapeHtml(detailPath(item))}">${escapeHtml(tr("details"))}</a></div></article>`).join("")}</div>`;
    bindPosterFallbacks();
  }

  function renderDetail(item) {
    document.body.classList.add("ott-detail-view");
    catalog.hidden = false;
    root.innerHTML = `<div class="ott-detail">
      <a class="ott-back" href="/ott">← ${escapeHtml(tr("back"))}</a>
      <div class="ott-detail-layout"><div class="ott-detail-art">${poster(item)}</div>
      <div class="ott-detail-copy"><h2>${escapeHtml(text(item.title))}</h2>
      <p class="ott-detail-creator">${escapeHtml(tr("by"))} ${escapeHtml(text(item.creatorName))}</p>
      <p>${escapeHtml(text(item.synopsis))}</p>
      <p class="ott-boundary" role="status">${escapeHtml(tr("unavailable"))}</p></div></div></div>`;
    bindPosterFallbacks();
  }

  async function load() {
    const slug = requestedSlug();
    if (slug) {
      document.body.classList.add("ott-detail-view");
      catalog.hidden = false;
      status(tr("loading"));
    } else catalog.hidden = true;
    try {
      if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("invalid title");
      const payload = await apiFetch(slug ? `/api/v1/ott/${encodeURIComponent(slug)}` : "/api/v1/ott", { throwOnError: true });
      if (slug) renderDetail(payload);
      else render(Array.isArray(payload?.items) ? payload.items : []);
    } catch {
      catalog.hidden = false;
      status(tr("errorTitle"), tr("errorBody"));
    }
  }

  applyCopy();
  void refreshBranchAvailability();
  window.addEventListener("lumina:localechange", () => { applyCopy(); load(); });
  load();
})();
