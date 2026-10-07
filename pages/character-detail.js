(function initCharacterDetailPage() {
const detailLoad = { phase: "idle", slug: null, artist: null, request: 0 };
let detailShortsRequest = 0;

async function loadDetailArtist(slug) {
  if (detailLoad.slug === slug && detailLoad.phase === "loading") return;
  const request = ++detailLoad.request;
  detailLoad.slug = slug;
  detailLoad.artist = null;
  detailLoad.phase = "loading";
  _detailArtistData = null;
  renderCharacterDetail();
  try {
    const response = await apiFetch(`/api/v1/artists/${encodeURIComponent(slug)}`, {
      auth: typeof isLoggedIn === "function" && isLoggedIn(),
      throwOnError: true
    });
    if (request !== detailLoad.request) return;
    if (!response || response.slug !== slug || !response.id) throw new Error("Invalid public artist detail");
    if (response.status !== "active") {
      detailLoad.phase = "not-found";
    } else {
      const [artist] = publicArtistsFromApi([response]);
      if (!artist) throw new Error("Incomplete public artist detail");
      // Only the approved local galleries may supplement the public response.
      if (!shouldKeepLocalGallery(slug)) {
        artist.gallery = (Array.isArray(response.assets) ? response.assets : [])
          .filter(asset => asset.usageType === "gallery")
          .map(asset => ({ caption: asset.caption || "Gallery", src: normalizeAssetUrl(asset.url) }))
          .filter(item => item.src);
      }
      detailLoad.artist = artist;
      _artists = _artists.filter(item => item.slug !== slug).concat(artist);
      _detailArtistData = response;
      detailLoad.phase = "ready";
    }
  } catch (err) {
    if (request !== detailLoad.request) return;
    detailLoad.phase = err?.status === 404 ? "not-found" : "error";
  }
  renderCharacterDetail();
}

function detailText(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function detailHasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "" &&
    !/^(?:-|—|N\/A|TBD)$/i.test(String(value).trim());
}

const DETAIL_PROFILE_EMPTY_COPY = {
  ko: "공개된 프로필 정보가 없습니다.",
  en: "No public profile information is available.",
  ja: "公開されているプロフィール情報はありません。",
  "zh-Hans": "暂无公开的个人资料。",
  "zh-Hant": "暫無公開的個人資料。"
};

function renderLocalizedDetailProfile(artist) {
  const profile = document.getElementById("detailProfile");
  if (!profile || !artist) return;
  const locale = window.luminaI18n?.getLocale?.() || "ko";
  const catalog = window.LuminaStaticData?.artistProfileByLocale?.[artist.slug];
  const localized = Array.isArray(catalog?.[locale]) ? catalog[locale] : catalog?.ko;
  const korean = new Map((catalog?.ko || []).map((row) => [row.key, row]));
  const currentProfile = artist.profile || {};
  const entries = Array.isArray(localized)
    ? localized.map((row) => {
        if (row.key === "팬덤명" && artist.fandomNameApproved !== true) return null;
        if (!Object.prototype.hasOwnProperty.call(currentProfile, row.key)) return null;
        if (row.status === "pending") return row;
        const current = currentProfile[row.key];
        if (current != null && typeof current !== "string" && typeof current !== "number") {
          return { ...row, value: null };
        }
        if (!detailHasValue(current)) return { ...row, value: null };
        const known = korean.get(row.key)?.value;
        const sourceMatches = current === known ||
          (row.key === "생년월일" && String(current).startsWith(`${known} (`));
        return sourceMatches ? row : { ...row, value: current };
      }).concat(Object.entries(currentProfile)
        .filter(([key, value]) => !korean.has(key) &&
          (key !== "팬덤명" || artist.fandomNameApproved === true) &&
          (typeof value === "string" || typeof value === "number"))
        .map(([key, value]) => ({ key, label: key, value })))
    : Object.entries(currentProfile)
        .filter(([key, value]) => (key !== "팬덤명" || artist.fandomNameApproved === true) &&
          (typeof value === "string" || typeof value === "number"))
        .map(([key, value]) => ({ key, label: key, value }));
  const visible = entries.filter((row) => detailHasValue(row?.label) && detailHasValue(row?.value));
  profile.innerHTML = visible.length
    ? visible.map((row) => `<div class="${row.status === "pending" ? "is-pending" : ""}"><dt>${detailText(row.label)}</dt><dd>${detailText(row.value)}</dd></div>`).join("")
    : `<p class="detail-profile-empty">${detailText(DETAIL_PROFILE_EMPTY_COPY[locale] || DETAIL_PROFILE_EMPTY_COPY.ko)}</p>`;
}

function detailT(key, fallback) {
  return window.luminaI18n?.t?.(key) || fallback;
}

function detailFormat(key, fallback, values) {
  return detailT(key, fallback).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
}

function setDetailFollowerCount(el, count) {
  if (!el || !Number.isFinite(Number(count))) return;
  el.dataset.count = String(count);
  const locale = window.luminaI18n?.getRegionalLocale?.() || "ko-KR";
  const formatted = Number(count).toLocaleString(locale);
  el.textContent = detailFormat("detail.follow.count", "팔로워 {count}", { count: formatted });
}

function setDetailFollowLabel(btn, isFollowing) {
  const key = isFollowing ? "feed.follow.cancel" : "feed.follow.action";
  const value = detailT(key, isFollowing ? "팔로우 취소" : "팔로우");
  const label = btn.querySelector("[data-detail-follow-label]");
  if (label) label.textContent = value;
  btn.setAttribute("aria-label", value);
  btn.title = value;
}

function refreshDetailArtistLocale() {
  window.refreshPublicArtistLocale?.();
  const slug = new URLSearchParams(window.location.search).get("slug");
  const artist = detailLoad.phase === "ready" && detailLoad.slug === slug ? detailLoad.artist : null;
  const introRoot = document.getElementById("detailIntro");
  if (!artist) {
    renderCharacterDetail();
    return;
  }
  // The shared list may no longer contain this verified detail object.
  if (typeof _artistCopySources !== "undefined" && typeof localizedArtistCopy === "function") {
    const source = _artistCopySources.get(artist);
    if (source) Object.assign(artist, localizedArtistCopy(source));
  }
  if (!introRoot?.querySelector) return;

  document.title = `${artist.publicName} — Lumina Stage`;
  const hero = document.getElementById("detailHero");
  const heroName = hero?.querySelector?.(".detail-image-fallback, .detail-hero-secret strong");
  if (heroName) heroName.textContent = artist.publicName;
  const heroImage = hero?.querySelector?.(".detail-hero-image");
  if (heroImage) heroImage.alt = artist.publicName;
  const heading = introRoot.querySelector?.('h1[data-cms-key="character-detail.intro.publicName"]');
  if (heading) heading.textContent = artist.publicName;

  const summary = introRoot.querySelector?.(".detail-summary");
  if (detailHasValue(artist.summary)) {
    const node = summary || document.createElement("p");
    if (!summary) {
      node.className = "detail-summary";
      node.dataset.cmsKey = "character-detail.intro.summary";
      node.dataset.cmsField = "body";
      introRoot.insertBefore(node, introRoot.querySelector(".detail-bio"));
    }
    node.textContent = artist.summary;
  } else summary?.remove();

  const bio = introRoot.querySelector?.(".detail-bio");
  const story = bio?.querySelector?.('[data-cms-key="character-detail.intro.body"]');
  if (bio && detailHasValue(artist.intro)) {
    const node = story || document.createElement("p");
    if (!story) {
      node.dataset.cmsKey = "character-detail.intro.body";
      node.dataset.cmsField = "body";
      bio.prepend(node);
    }
    node.textContent = artist.intro;
  } else story?.remove();

  const support = document.querySelector("[data-detail-support-heading]");
  if (support) support.dataset.artistName = artist.publicName;
  document.querySelectorAll?.("[data-detail-artist-name]").forEach(node => { node.textContent = artist.publicName; });
  document.querySelectorAll?.("[data-detail-artist-title]").forEach(node => { node.textContent = artist.publicName; });
  document.querySelectorAll?.("[data-detail-artist-title-link]").forEach(node => { node.setAttribute("aria-label", artist.publicName); });
  const lightboxImage = document.querySelector(".encar-lightbox.is-open .encar-main-img");
  const lightboxCaption = document.querySelector(".encar-lightbox.is-open .encar-caption");
  if (lightboxImage && lightboxCaption) lightboxImage.alt = `${artist.publicName} ${lightboxCaption.textContent}`;
  renderLocalizedDetailProfile(artist);
}

function refreshDetailActionLocale() {
  refreshDetailArtistLocale();
  const btn = document.querySelector("[data-detail-follow]");
  if (btn) setDetailFollowLabel(btn, btn.dataset.following === "1");
  const count = document.querySelector("[data-detail-follower-count]");
  if (count?.dataset.count) setDetailFollowerCount(count, count.dataset.count);
  const heading = document.querySelector("[data-detail-support-heading]");
  if (heading) heading.textContent = detailFormat("detail.support.heading", "{name}의 다음 무대를 응원하세요", {
    name: heading.dataset.artistName || ""
  });
  for (const id of ["detailChatSection", "detailCta", "detailGallery"]) {
    const root = document.getElementById(id);
    if (root) window.luminaI18n?.apply?.(root);
  }
}

window.addEventListener("lumina:localechange", refreshDetailActionLocale);

function bindDetailPortraitFallback(hero, artist) {
  const img = hero.querySelector(".detail-hero-image");
  if (!img) return;
  const fallback = artist.images?.thumb && artist.images?.cover && artist.images.thumb !== artist.images.cover
    ? artist.images.thumb : "";
  img.addEventListener("error", () => {
    if (fallback && img.src !== new URL(fallback, window.location.href).href) img.src = fallback;
    else {
      hero.classList.add("is-image-unavailable");
      img.remove();
    }
  });
}

/* ── 렌더링: 캐릭터 상세 ─────────────────────── */
function detailPublicMediaUrl(value) {
  return typeof value === "string" && /^(?:https?:\/\/|\/(?!\/))/i.test(value) &&
    !/[<>"'\\\r\n\t]/.test(value) ? value : "";
}

function setDetailShortsVisibility(shortsRoot, visible) {
  const block = shortsRoot.closest?.(".detail-shorts-block");
  if (block) block.hidden = !visible;
}

async function fetchAndUpdateDetailShorts(artist, shortsRoot) {
  const request = ++detailShortsRequest;
  const detailRequest = detailLoad.request;
  try {
    const shortforms = await apiFetch("/api/v1/shortforms");
    if (request !== detailShortsRequest || detailRequest !== detailLoad.request ||
        shortsRoot.dataset.artistSlug !== artist.slug || !Array.isArray(shortforms)) return;
    const playable = shortforms.map(item => {
      if (item?.status !== "published" || item.artist?.slug !== artist.slug) return null;
      const assets = Array.isArray(item.assets) ? item.assets : [];
      const video = assets.find(asset => asset?.assetType === "video" &&
        /^video\//i.test(asset.mimeType || "") && detailPublicMediaUrl(asset.url));
      if (!video) return null;
      const thumbnail = assets.find(asset => asset?.assetType === "image" &&
        /^image\//i.test(asset.mimeType || "") && detailPublicMediaUrl(asset.url));
      return { item, videoUrl: video.url, thumbnailUrl: thumbnail?.url || artist.images?.thumb };
    }).filter(Boolean);
    shortsRoot.innerHTML = playable.map(({ item, videoUrl, thumbnailUrl }) => `
      <a class="detail-short-card" href="${detailText(videoUrl)}" aria-label="${detailText(item.title || artist.publicName)}"${item.title ? "" : " data-detail-artist-title-link"}>
        <div class="detail-short-media"${mediaStyle(thumbnailUrl)}>
          <span class="eyebrow" data-detail-artist-name>${detailText(artist.publicName)}</span>
          <strong${item.title ? "" : " data-detail-artist-title"}>${detailText(item.title || artist.publicName)}</strong>
        </div>
        ${item.description ? `<div class="detail-short-body"><span>${detailText(item.description)}</span></div>` : ""}
      </a>`).join("");
    setDetailShortsVisibility(shortsRoot, playable.length > 0);
  } catch (err) {
    console.warn("[Lumina] 공개 숏폼 조회 실패:", err);
  }
}

let _detailArtistData = null;
function applyArtistDetailViewer(data) {
  const followerEl = document.querySelector("[data-detail-follower-count]");
  if (followerEl && typeof data?.stats?.followerCount === "number") {
    setDetailFollowerCount(followerEl, data.stats.followerCount);
  }
  const btn = document.querySelector("[data-detail-follow]");
  if (!btn) return;
  const v = data?.viewer || {};
  if (v.isAuthenticated && (v.canFollow || v.canUnfollow)) {
    btn.hidden = false;
    btn.dataset.artistId = data.id || "";
    if (v.isFollowing || v.canUnfollow) {
      btn.classList.add("is-following");
      btn.dataset.following = "1";
    } else {
      btn.classList.remove("is-following");
      btn.dataset.following = "0";
    }
    setDetailFollowLabel(btn, btn.dataset.following === "1");
  } else {
    // 비로그인 — 버튼은 hidden 유지 (팔로워 수만 보여줌)
    btn.hidden = true;
  }
}

function bindArtistDetailFollow() {
  if (document._detailFollowBound) return;
  document._detailFollowBound = true;
  document.addEventListener("click", async e => {
    const btn = e.target.closest("[data-detail-follow]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (btn.dataset.busy === "1") return;
    if (typeof getAccessToken === "function" && !getAccessToken()) {
      if (typeof openAuthModal === "function") {
        openAuthModal("login", { returnTo: { href: window.location.pathname + window.location.search, label: detailT("detail.follow.authReturn", "아티스트 팔로우 이어가기") } });
      } else {
        alert(detailT("detail.follow.loginRequired", "로그인하면 팔로우할 수 있어요."));
      }
      return;
    }
    const artistId = btn.dataset.artistId;
    if (!artistId) {
      alert(detailT("detail.follow.artistUnavailable", "아티스트 정보를 불러오지 못했어요. 새로고침 후 다시 시도해주세요."));
      return;
    }
    const wasFollowing = btn.dataset.following === "1";
    const request = detailLoad.request;
    btn.dataset.busy = "1";
    // 낙관적 토글
    btn.classList.toggle("is-following", !wasFollowing);
    btn.dataset.following = wasFollowing ? "0" : "1";
    setDetailFollowLabel(btn, !wasFollowing);
    // 팔로워 수 즉시 +1/-1
    const countEl = btn.querySelector("[data-detail-follower-count]");
    const previousCount = countEl?.dataset.count === undefined ? null : Number(countEl.dataset.count);
    if (previousCount !== null) setDetailFollowerCount(countEl, wasFollowing ? Math.max(0, previousCount - 1) : previousCount + 1);
    try {
      const res = await apiFetch(`/api/v1/artists/${encodeURIComponent(artistId)}/follow`, {
        method: wasFollowing ? "DELETE" : "POST",
        auth: true,
        throwOnError: true
      });
      if (request !== detailLoad.request) return;
      // #153 — 응답에 stats/viewer 포함됨. 정확한 값으로 최종 동기화
      if (res?.stats?.followerCount !== undefined && countEl) {
        setDetailFollowerCount(countEl, res.stats.followerCount);
      }
      if (res?.viewer) {
        const isFollowing = res.viewer.isFollowing || res.viewer.canUnfollow;
        btn.classList.toggle("is-following", !!isFollowing);
        btn.dataset.following = isFollowing ? "1" : "0";
        setDetailFollowLabel(btn, !!isFollowing);
      }
    } catch (err) {
      if (request !== detailLoad.request) return;
      // 롤백
      btn.classList.toggle("is-following", wasFollowing);
      btn.dataset.following = wasFollowing ? "1" : "0";
      setDetailFollowLabel(btn, wasFollowing);
      console.warn("[#150 detail follow] 실패", { status: err?.status });
      alert(detailT("detail.follow.error", "팔로우 처리에 실패했어요."));
      // 팔로워 수 원복
      if (previousCount !== null) setDetailFollowerCount(countEl, previousCount);
    } finally {
      btn.dataset.busy = "0";
    }
  });
}

function renderCharacterDetail() {
  const hero = document.getElementById("detailHero");
  if (!hero) return;

  const slug   = new URLSearchParams(window.location.search).get("slug");
  if (slug && (detailLoad.slug !== slug || detailLoad.phase === "idle")) {
    loadDetailArtist(slug);
    return;
  }
  if (!slug && detailLoad.slug !== null) {
    detailLoad.request++;
    detailLoad.slug = null;
    detailLoad.artist = null;
    detailLoad.phase = "idle";
    _detailArtistData = null;
  }
  const artist = slug && detailLoad.phase === "ready" ? detailLoad.artist : null;
  hero.dataset.publicArtistState = slug ? detailLoad.phase : "no-slug";
  hero.setAttribute("aria-busy", String(detailLoad.phase === "loading"));
  const routeSections = ["detailChatSection", "detailBodySection", "detailCtaSection", "detailTagSection"];
  routeSections.forEach(id => {
    const section = document.getElementById(id);
    if (section) section.hidden = !artist || (id === "detailChatSection" && ["secret", "pending"].includes(artist.status));
  });

  if (!artist) {
    const lightbox = document.querySelector(".encar-lightbox");
    if (lightbox) {
      if (lightbox.classList.contains("is-open")) lightbox.querySelector(".encar-close")?.click();
      lightbox.remove();
    }
    const copy = !slug ? detailT("artist.public.choose", "아티스트를 선택해 주세요")
      : detailLoad.phase === "loading" ? detailT("artist.public.loading", "공개 아티스트를 불러오는 중입니다.")
      : detailLoad.phase === "not-found" ? detailT("artist.public.notFound", "공개된 아티스트를 찾을 수 없습니다.")
      : detailT("artist.public.error", "공개 아티스트를 불러오지 못했습니다.");
    hero.className = "detail-hero-card";
    hero.innerHTML = `<div class="detail-hero-secret" role="status" aria-live="polite"><strong>${detailText(copy)}</strong>
      ${slug && detailLoad.phase !== "loading" ? `<button type="button" data-artist-retry>${detailText(detailT("artist.public.retry", "다시 확인"))}</button>` : ""}
      <a class="text-link" href="/characters" style="margin-top:12px;display:inline-block;">${detailText(detailT("artist.public.catalog", "아티스트 목록 보러 가기"))} →</a></div>`;
    hero.querySelector("[data-artist-retry]")?.addEventListener("click", () => loadDetailArtist(slug));
    const intro = document.getElementById("detailIntro");
    if (intro) intro.innerHTML = "";
    const meta = document.getElementById("detailMeta");
    if (meta) meta.innerHTML = "";
    const gallery = document.getElementById("detailGallery");
    if (gallery) gallery.innerHTML = "";
    const shorts = document.getElementById("detailShorts");
    if (shorts) {
      shorts.innerHTML = "";
      setDetailShortsVisibility(shorts, false);
      shorts.dataset.artistSlug = "";
    }
    const profile = document.getElementById("detailProfile");
    if (profile) profile.innerHTML = "";
    const cta = document.getElementById("detailCta");
    if (cta) cta.innerHTML = "";
    const tags = document.getElementById("detailTagNavigation");
    if (tags) tags.innerHTML = "";
    document.title = `${copy} — Lumina Stage`;
    return;
  }
  const status = statusMeta[artist.status];

  document.title = `${artist.publicName} — Lumina Stage`;

  // 캐릭터 컬러 CSS 변수 주입
  if (artist.colorAccent) {
    document.documentElement.style.setProperty("--char-accent", artist.colorAccent);
    document.documentElement.style.setProperty("--char-accent-soft", artist.colorAccent + "22");
  }

  // #601 — pending(공개 보류)도 secret과 동일하게 hero/gallery/CTA를 잠금 모드로 처리
  const isHidden = artist.status === "secret" || artist.status === "pending";
  hero.className = `detail-hero-card ${status.className}`;
  hero.innerHTML = isHidden
    ? `<div class="detail-hero-secret"><span class="eyebrow">${detailText(artist.type)}</span><strong>${detailText(artist.publicName)}</strong><em class="catalog-status-caption">${detailText(status.label)}</em></div>`
    : `<div class="detail-hero-frame">${artist.images?.cover || artist.images?.thumb ? `<img class="detail-hero-image detail-hero-image-${detailText(artist.slug)}" src="${detailText(artist.images.cover || artist.images.thumb)}" alt="${detailText(artist.publicName)}" />` : ""}<strong class="detail-image-fallback">${detailText(artist.publicName)}</strong></div>`;
  if (!isHidden) {
    if (!artist.images?.cover && !artist.images?.thumb) hero.classList.add("is-image-unavailable");
    bindDetailPortraitFallback(hero, artist);
  }

  const intro = document.getElementById("detailIntro");
  if (intro) {
    intro.innerHTML = `
      <p class="eyebrow">공식 프로필</p>
      <h1 data-cms-key="character-detail.intro.publicName">${detailText(artist.publicName)}</h1>
      ${detailHasValue(artist.summary) ? `<p class="detail-summary" data-cms-key="character-detail.intro.summary" data-cms-field="body">${detailText(artist.summary)}</p>` : ""}
      <div class="detail-bio">
        ${detailHasValue(artist.intro) ? `<p data-cms-key="character-detail.intro.body" data-cms-field="body">${detailText(artist.intro)}</p>` : ""}
        ${detailHasValue(artist.concept) ? `<p class="detail-concept" data-cms-key="character-detail.intro.concept" data-cms-field="body">${detailText(artist.concept)}</p>` : ""}
      </div>
      <div class="detail-intro-bottom">
        <div class="detail-sns-section" hidden>
          <span class="detail-section-label">SNS</span>
          <div class="detail-sns-buttons">
            <a class="detail-sns-btn detail-sns-btn-youtube" href="#" aria-label="유튜브">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.6 5.8a3 3 0 0 0 2.1 2.1C4.5 20.5 12 20.5 12 20.5s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.8 15.5V8.5l6.3 3.5-6.3 3.5z"/></svg>유튜브
            </a>
            <a class="detail-sns-btn detail-sns-btn-insta" href="#" aria-label="인스타그램">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8 0 3.2 0 3.6-.1 4.8-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.9.1-3.2 0-3.6 0-4.8-.1-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12c0-3.2 0-3.6.1-4.8C2.4 3.9 4 2.3 7.2 2.3c1.2-.1 1.6-.1 4.8-.1zm0-2.2C8.7 0 8.3 0 7.1.1 2.7.3.3 2.7.1 7.1.1 8.3 0 8.7 0 12c0 3.3 0 3.7.1 4.9.2 4.4 2.6 6.8 7 7C8.3 24 8.7 24 12 24c3.3 0 3.7 0 4.9-.1 4.4-.2 6.8-2.6 7-7 .1-1.2.1-1.6.1-4.9 0-3.3 0-3.7-.1-4.9-.2-4.4-2.6-6.8-7-7C15.7 0 15.3 0 12 0zm0 5.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.8a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z"/></svg>인스타그램
            </a>
            <a class="detail-sns-btn detail-sns-btn-tiktok" href="#" aria-label="틱톡">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19.6 3.3A4.5 4.5 0 0 1 15.2 0h-3.3v16.4a2.7 2.7 0 0 1-2.7 2.3 2.7 2.7 0 0 1-2.7-2.7 2.7 2.7 0 0 1 2.7-2.7c.3 0 .5 0 .8.1V9.9a6 6 0 0 0-.8-.1 6 6 0 0 0-6 6 6 6 0 0 0 6 6 6 6 0 0 0 6-6V8.2a7.8 7.8 0 0 0 4.5 1.4V6.3a4.5 4.5 0 0 1-2.1-3z"/></svg>틱톡
            </a>
          </div>
        </div>
        <div class="detail-tags-section">
          <span class="detail-section-label">태그</span>
          <div class="detail-hashtags">
            ${(artist.tags || []).map(t => `<span class="detail-hashtag">#${detailText(t)}</span>`).join("")}
          </div>
        </div>
      </div>`;
  }

  const meta = document.getElementById("detailMeta");
  if (meta) {
    const tierLabel = { main: "메인", premium: "프리미엄", sub: "서브", experiment: "실험", candidate: "신규" };
    meta.innerHTML = `
      <span class="status-badge status-badge-${detailText(artist.status)}">${detailText(status.label)}</span>
      <span class="detail-type-tag">${detailText(artist.type)}</span>
      <span class="detail-tier-tag">${detailText(tierLabel[artist.tier] || artist.tier)}</span>
      <button class="detail-share-btn" type="button" data-share-character="${detailText(artist.slug)}" aria-label="이 아티스트 공유하기">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>
        공유하기
      </button>`;
  }

  const gallery = document.getElementById("detailGallery");
  if (gallery) {
    const galleryItems = (artist.gallery?.length
      ? artist.gallery.map(item => Array.isArray(item)
        ? { caption: item[0] || "Gallery", src: item[1] }
        : item)
      : []).filter(item => item?.src);
    const galleryUnavailable = artist.galleryMode === "hidden" || galleryItems.length === 0;
    const bodyGrid = gallery.closest(".detail-body-grid");
    bodyGrid?.classList.toggle("is-gallery-unavailable", galleryUnavailable);

    if (galleryUnavailable) {
      gallery.hidden = true;
      gallery.innerHTML = "";
    } else {
      gallery.hidden = false;
      gallery.innerHTML = isHidden ? "" : `
        <div id="galleryHeader" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:8px;flex-shrink:0;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);" data-i18n="detail.gallery.photo">포토 갤러리</span>
            <strong style="font-size:17px;font-weight:700;color:var(--ink);" data-i18n="detail.gallery.official">공식 이미지</strong>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button id="galleryPrev" aria-label="이전" data-i18n-aria="detail.gallery.previous" style="background:var(--panel);border:1px solid var(--line);color:var(--ink);width:36px;height:36px;border-radius:50%;font-size:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;">‹</button>
            <span id="galleryCounter" style="font-size:12px;color:var(--muted);min-width:64px;text-align:center;"></span>
            <button id="galleryNext" aria-label="다음" data-i18n-aria="detail.gallery.next" style="background:var(--panel);border:1px solid var(--line);color:var(--ink);width:36px;height:36px;border-radius:50%;font-size:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;">›</button>
          </div>
        </div>
        <div id="gallerySlider" style="width:100%;flex:1;min-height:0;overflow:hidden;border-radius:14px;background:#16122a;">
          <div id="galleryTrack" style="display:flex;height:100%;"></div>
        </div>`;
      if (!gallery.dataset.imageFallbackBound) {
        gallery.dataset.imageFallbackBound = "1";
        gallery.addEventListener("error", event => {
          const img = event.target;
          if (img.matches(".gallery-slide img") && img.dataset.retried === "1") {
            const slide = img.closest(".gallery-slide");
            // The slider keeps its image attached for explicit recovery.
            if (slide.querySelector("[data-gallery-recovery]")) return;
            slide.classList.add("is-image-unavailable");
            slide.removeAttribute("data-lightbox");
            slide.style.cursor = "default";
            img.remove();
          }
        }, { capture: true });
      }

      if (!isHidden) {
        initGallerySlider(galleryItems, artist.publicName);
        initLightbox(galleryItems, () => artist.publicName);

      }
    }
  }

  renderLocalizedDetailProfile(artist);

  const shortsRoot = document.getElementById("detailShorts");
  if (shortsRoot) {
    shortsRoot.innerHTML = "";
    setDetailShortsVisibility(shortsRoot, false);
    shortsRoot.dataset.artistSlug = artist.slug;
    if (!isHidden) fetchAndUpdateDetailShorts(artist, shortsRoot);
  }

  const cta = document.getElementById("detailCta");
  if (cta) {
    const followerCount = _detailArtistData?.stats?.followerCount;
    const followerText = typeof followerCount === "number"
      ? `<small data-detail-follower-count data-count="${followerCount}">${detailFormat("detail.follow.count", "팔로워 {count}", { count: followerCount.toLocaleString(window.luminaI18n?.getRegionalLocale?.() || "ko-KR") })}</small>`
      : `<small data-detail-follower-count></small>`;
    const followBtn = isHidden
      ? ""
      : `<button class="cta-btn cta-btn-follow" type="button" data-detail-follow="${feedEscapeHtml(artist.slug)}" hidden>
           <span class="cta-btn-icon">+</span>
           <span class="cta-btn-label"><strong data-detail-follow-label>${detailT("feed.follow.action", "팔로우")}</strong>${followerText}</span>
         </button>`;
    cta.innerHTML = isHidden
      ? `<div class="detail-cta-card is-secret"><strong>${artist.status === "pending" ? "공개 예정 아티스트입니다" : "아직 베일 속에 있는 아티스트입니다"}</strong><p>${artist.status === "pending" ? "조건을 갖추면 캐릭터챗·후원 등 모든 기능이 열려요." : "첫 공개 순간에 가장 잘 어울리는 장면으로 찾아올게요."}</p></div>`
      : `<div class="detail-cta-card">
           <div class="detail-cta-info">
             <strong data-detail-support-heading data-artist-name="${detailText(artist.publicName)}">${detailText(detailFormat("detail.support.heading", "{name}의 다음 무대를 응원하세요", { name: artist.publicName }))}</strong>
             <p data-i18n="detail.support.description">오늘의 응원은 순위와 콘텐츠 반응에 반영되어 다음 장면을 여는 힘이 됩니다.</p>
           </div>
           <div class="detail-cta-actions">
             ${followBtn}
             <button class="cta-btn cta-btn-support" disabled>
               <span class="cta-btn-icon">💜</span>
               <span class="cta-btn-label"><strong data-i18n="detail.support.action">후원하기</strong><small data-i18n="detail.chat.comingSoon">오픈 예정</small></span>
             </button>
             <!-- #500 — 캐릭터챗(AI)·프리미엄챗(아티스트 직접) 진입점 분리.
                  기존 "프리미엄챗" 라벨이 /character-chat(AI챗)으로 연결되어 오인 유발 → AI챗 라벨로 교체.
                  프리미엄챗은 API·화면 준비 전이므로 disabled 상태로 별도 표시. AI챗으로 대체 연결 금지. -->
             <!-- #538 — 설명 문구 강화: AI챗/프리미엄챗 차이 명확화 -->
             <!-- #607 — AI 캐릭터챗/프리미엄챗 두 갈래 UX: 유형·유료 여부 명확히 표시 -->
             <a class="cta-btn cta-btn-chat cta-btn-link" href="/character-chat?slug=${encodeURIComponent(artist.slug)}" title="AI 캐릭터챗: AI가 캐릭터 톤앤매너로 답합니다. 무료로 언제든 이용할 수 있어요." data-i18n-attr="title:detail.chat.aiTooltip">
               <span class="cta-btn-icon">💬</span>
               <span class="cta-btn-label"><strong data-i18n="detail.chat.ai">AI 캐릭터챗</strong><small data-i18n="detail.chat.aiCtaDescription">AI가 캐릭터 톤으로 답하는 일반 대화</small></span>
             </a>
             <button class="cta-btn cta-btn-premium" disabled aria-disabled="true" title="프리미엄챗: 아티스트가 직접 답변하는 유료 채팅이에요. 방 오픈 시 이용할 수 있어요." data-i18n-attr="title:detail.chat.premiumTooltip">
               <span class="cta-btn-icon">⭐</span>
               <span class="cta-btn-label"><strong data-i18n="detail.chat.premium">프리미엄챗</strong><small data-i18n="detail.chat.premiumCtaDescription">아티스트 직접 답변 · 유료 · 오픈 예정</small></span>
             </button>
           </div>
         </div>`;
    if (!isHidden) applyArtistDetailViewer(_detailArtistData);
  }

  // #601 — pending(공개 보류) 캐릭터는 채팅 CTA 카드(detailChatSelect)도 잠금 처리.
  // 이전 구현은 detailCta 영역만 교체해서 채팅 CTA 섹션이 활성 링크로 남는 FAIL 발생.
  const chatSelect = document.getElementById("detailChatSelect");
  if (chatSelect) {
    if (isHidden) {
      chatSelect.style.display = "none";
    } else {
      chatSelect.style.display = "";
    }
  }
  const chatStartLink = document.getElementById("chatStartLink");
  if (chatStartLink && !isHidden) chatStartLink.href = `/character-chat?slug=${encodeURIComponent(artist.slug)}`;

  const tagNav = document.getElementById("detailTagNavigation");
  if (tagNav) {
    tagNav.innerHTML = (artist.tags || [])
      .map(t => `<a class="tag-link" href="/characters?tag=${encodeURIComponent(t)}">${detailText(t)}</a>`).join("");
  }

  // #324 — 운영자가 Backstage CMS에서 수정한 캐릭터별 문구가 있으면 덮어쓰기.
  // CMS 실패/키 누락 시 위에서 렌더한 정적 fallback 유지.
  if (window.LuminaCms && typeof window.LuminaCms.hydrate === "function") {
    window.LuminaCms.hydrate({ pageKey: "character-detail", characterSlug: artist.slug }).catch(function () {});
  }
  refreshDetailActionLocale();
}

window.renderCharacterDetail = renderCharacterDetail;
window.bindArtistDetailFollow = bindArtistDetailFollow;
window.addEventListener("popstate", renderCharacterDetail);
})();
