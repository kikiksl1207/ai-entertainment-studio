(function () {
  "use strict";

  const homeLoad = { phase: "idle", artists: [] };

  async function loadHomeArtists() {
    if (homeLoad.phase === "loading") return;
    homeLoad.phase = "loading";
    homeLoad.artists = [];
    renderHomeArtists();
    try {
      const response = await apiFetch("/api/v1/artists", { throwOnError: true });
      if (!Array.isArray(response)) throw new Error("Invalid public artist list");
      const artists = publicArtistsFromApi(response);
      if (response.length && !artists.length) throw new Error("Invalid public artist list");
      homeLoad.artists = artists;
      _artists = artists;
      homeLoad.phase = "ready";
    } catch {
      homeLoad.phase = "error";
    }
    renderHomeArtists();
  }

  function renderHomeArtists() {
    renderMainArtists();
    renderHeroFeature();
    renderPremiumFeature();
    renderDebutLine();
    renderRoster();
  }

  function homeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);
  }

  function homeAccent(value) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#9f8bc7";
  }

  function renderMainArtists() {
    const root = document.getElementById("mainArtistGrid");
    if (!root) return;
    if (homeLoad.phase === "idle") {
      loadHomeArtists();
      return;
    }
    _artists = homeLoad.artists;
    window.refreshPublicArtistLocale?.();

    const list = homeLoad.artists.filter(isPublicLineup);
    list.sort(compareByPublicLineupOrder);
    const count = document.getElementById("homePublicArtistCount");
    if (count) count.textContent = homeLoad.phase === "ready" ? `${list.length}명` : "";
    root.dataset.publicArtistsState = homeLoad.phase;
    root.setAttribute("aria-busy", String(homeLoad.phase === "loading"));
    if (homeLoad.phase !== "ready" || !list.length) {
      const key = homeLoad.phase === "loading" ? "artist.public.loading"
        : homeLoad.phase === "error" ? "artist.public.error" : "artist.public.empty";
      const fallback = homeLoad.phase === "loading" ? "공개 아티스트를 불러오는 중입니다."
        : homeLoad.phase === "error" ? "공개 아티스트를 불러오지 못했습니다." : "현재 공개된 아티스트가 없습니다.";
      const copy = window.luminaI18n?.t?.(key) || fallback;
      root.innerHTML = `<div role="status" aria-live="polite" style="grid-column:1/-1;"><p>${homeText(copy)}</p>
        ${homeLoad.phase !== "loading" ? `<button type="button" data-artist-retry>${homeText(window.luminaI18n?.t?.("artist.public.retry") || "다시 확인")}</button>` : ""}</div>`;
      root.querySelector("[data-artist-retry]")?.addEventListener("click", loadHomeArtists);
      return;
    }

    root.innerHTML = list.map(a => `
      <article class="artist-card clickable-card" data-href="/character-detail?slug=${encodeURIComponent(a.slug)}"
        style="--char-accent: ${homeAccent(a.colorAccent)}">
        <div class="artist-media artist-media-${homeText(a.slug)}">
          <img class="artist-media-image artist-media-image-${homeText(a.slug)}"
            src="${homeText(a.images.thumb || a.images.cover)}" alt="${homeText(a.publicName)}" loading="lazy" decoding="async"
            onerror="this.style.display='none'" />
          <div class="artist-media-copy">
            <span class="artist-role">${homeText(a.role)}</span>
            <strong>${homeText(a.name)}</strong>
          </div>
        </div>
        <div class="artist-body">
          <p>${homeText(artistToneCopy(a))}</p>
          <div class="tag-list">${(a.tags || []).map(t => `<span>${homeText(t)}</span>`).join("")}</div>
          <a class="text-link" href="/character-detail?slug=${encodeURIComponent(a.slug)}">무드 보기</a>
        </div>
      </article>
    `).join("");
  }

  function renderHeroFeature() {
    const root = document.getElementById("heroFeature");
    if (!root) return;
    const featuredMetric = document.getElementById("homeFeaturedArtistMetric");
    const featuredName = document.getElementById("homeFeaturedArtistName");

    const candidates = homeLoad.artists.filter(isPublicLineup);
    if (!candidates.length) {
      root.hidden = true;
      root.innerHTML = "";
      if (featuredName) featuredName.textContent = "";
      if (featuredMetric) featuredMetric.hidden = true;
      return;
    }
    root.hidden = false;

    const sorted = [...candidates].sort((a, b) => getLikesCount(b.slug) - getLikesCount(a.slug));
    const top = sorted[0];
    if (featuredName) featuredName.textContent = top.publicName;
    if (featuredMetric) featuredMetric.hidden = false;
    const likes = getLikesCount(top.slug);
    const label = likes > 0 ? `이달의 픽 · ${formatLikeCount(likes)} 응원` : "대표 아티스트";
    const tagsHTML = (top.tags || []).slice(0, 3).map(t => `<li>${homeText(t)}</li>`).join("");

    root.innerHTML = `
      <div class="hero-feature-media">
        <img src="${homeText(top.images.thumb || top.images.cover)}" alt="${homeText(top.publicName)} 프로필" />
      </div>
      <div class="hero-feature-body">
        <span class="hero-feature-label">${label}</span>
        <strong>${homeText(top.publicName)}</strong>
        <p class="hero-feature-summary">${homeText(top.summary)}</p>
        <p>${homeText(artistToneCopy(top) || top.intro)}</p>
        <ul class="hero-feature-tags">${tagsHTML}</ul>
        <a class="text-link hero-feature-link" href="/character-detail?slug=${encodeURIComponent(top.slug)}">${homeText(top.publicName)} 무드 보기</a>
      </div>
    `;
  }

  function renderPremiumFeature() {
    const root = document.getElementById("premium");
    if (!root) return;
    root.hidden = !homeLoad.artists.some(a => a.slug === "choi-seojin" && isPublicLineup(a));
  }

  function renderDebutLine() {
    const root = document.getElementById("debutLineGrid");
    if (!root) return;

    const list = homeLoad.artists.filter(isHiddenLineupArtist);
    const section = root.closest("section");
    if (section) section.hidden = !list.length;
    if (!list.length) { root.innerHTML = ""; return; }

    root.innerHTML = list.map(a => {
      const isMale = a.gender === "male";
      const silhouetteClass = isMale ? "silhouette-male" : "silhouette-female";
      const silhouetteLabel = isMale ? "HIDDEN<br>STAGE" : "NEW<br>STAGE";
      // #362/#980 — "곧/준비 중" 내부어 제거. 실서비스 톤: "공개 예정 라인업".
      const silhouetteText = isMale ? "공개 예정 남성 아티스트 라인업" : "공개 예정 여성 아티스트 라인업";

      return `
      <article class="debut-card clickable-card" data-href="/character-detail?slug=${encodeURIComponent(a.slug)}"
        style="--char-accent: ${homeAccent(a.colorAccent)}">
        <div class="debut-card-media ${silhouetteClass}">
          <div class="debut-silhouette">
            <span>${silhouetteLabel}</span>
            <small>${silhouetteText}</small>
          </div>
          <div class="debut-gender-badge">${isMale ? "♂" : "♀"}</div>
        </div>
        <div class="debut-card-body">
          <span class="debut-card-type eyebrow">${homeText(a.type)}</span>
          <strong>${homeText(a.publicName)}</strong>
          <p>${homeText(artistToneCopy(a))}</p>
          <a class="text-link" href="/character-detail?slug=${encodeURIComponent(a.slug)}">무드 보기</a>
        </div>
      </article>`;
    }).join("");

    bindDebutLineCarousel();
  }

  function bindDebutLineCarousel() {
    const root = document.getElementById("debutLineGrid");
    const prev = document.getElementById("debutLinePrev");
    const next = document.getElementById("debutLineNext");
    if (!root || !prev || !next || root.dataset.carouselBound === "true") return;
    root.dataset.carouselBound = "true";

    const scrollByCard = direction => {
      const card = root.querySelector(".debut-card");
      const gap = parseFloat(getComputedStyle(root).columnGap || "16") || 16;
      const width = card ? card.getBoundingClientRect().width + gap : root.clientWidth;
      const maxScrollLeft = Math.max(0, root.scrollWidth - root.clientWidth);
      const edgeThreshold = 4;
      const atStart = root.scrollLeft <= edgeThreshold;
      const atEnd = root.scrollLeft >= maxScrollLeft - edgeThreshold;

      if (direction < 0 && atStart) {
        root.scrollTo({ left: maxScrollLeft, behavior: "smooth" });
        return;
      }
      if (direction > 0 && atEnd) {
        root.scrollTo({ left: 0, behavior: "smooth" });
        return;
      }
      root.scrollBy({ left: direction * width, behavior: "smooth" });
    };

    prev.addEventListener("click", () => scrollByCard(-1));
    next.addEventListener("click", () => scrollByCard(1));
  }

  function renderRoster() {
    const root = document.getElementById("rosterGrid");
    if (!root) return;
    const featured = homeLoad.artists.filter(a => ["yoon-serin", "han-seoyul", "park-doa", "choi-seojin"].includes(a.slug));
    root.innerHTML = featured.map(a => `
      <article class="roster-card ${statusMeta[a.status].className} clickable-card"
        data-href="/character-detail?slug=${encodeURIComponent(a.slug)}"
        data-secret="${a.status === "secret"}">
        <div class="roster-media roster-media-${a.status}"${mediaStyle(a.images.thumb || a.images.cover)}>
          <strong>${homeText(a.publicName)}</strong>
        </div>
        <div class="roster-body">
          <div class="roster-meta">
            <span class="eyebrow">${homeText(a.type)}</span>
            <span class="status-badge status-badge-${a.status}" data-i18n="${statusMeta[a.status].labelKey || ""}">${statusMeta[a.status].label}</span>
          </div>
          <p>${homeText(artistToneCopy(a))}</p>
          <a class="text-link ${a.status === "secret" ? "is-dimmed" : ""}" href="/character-detail?slug=${encodeURIComponent(a.slug)}">무드 보기</a>
        </div>
      </article>`).join("");
    window.luminaI18n?.apply?.(root);
  }

  window.renderMainArtists = renderMainArtists;
  window.renderHeroFeature = renderHeroFeature;
  window.renderPremiumFeature = renderPremiumFeature;
  window.renderDebutLine = renderDebutLine;
  window.bindDebutLineCarousel = bindDebutLineCarousel;
  window.renderRoster = renderRoster;
})();
