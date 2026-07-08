(function () {
  "use strict";

  function renderMainArtists() {
    const root = document.getElementById("mainArtistGrid");
    if (!root) return;

    const list = _artists.filter(isPublicLineup);
    list.sort(compareByPublicLineupOrder);

    root.innerHTML = list.map(a => `
      <article class="artist-card clickable-card" data-href="/character-detail?slug=${a.slug}"
        style="--char-accent: ${a.colorAccent || "#9f8bc7"}">
        <div class="artist-media artist-media-${a.slug}">
          <img class="artist-media-image artist-media-image-${a.slug}"
            src="${a.images.thumb || a.images.cover}" alt="${a.publicName}"
            onerror="this.style.display='none'" />
          <div class="artist-media-copy">
            <span class="artist-role">${a.role}</span>
            <strong>${a.name}</strong>
          </div>
        </div>
        <div class="artist-body">
          <p>${artistToneCopy(a)}</p>
          <div class="tag-list">${a.tags.map(t => `<span>${t}</span>`).join("")}</div>
          <a class="text-link" href="/character-detail?slug=${a.slug}">무드 보기</a>
        </div>
      </article>
    `).join("");
  }

  function renderHeroFeature() {
    const root = document.getElementById("heroFeature");
    if (!root) return;

    const candidates = _artists.filter(isPublicLineup);
    if (!candidates.length) return;

    const sorted = [...candidates].sort((a, b) => getLikesCount(b.slug) - getLikesCount(a.slug));
    const top = sorted[0];
    const likes = getLikesCount(top.slug);
    const label = likes > 0 ? `이달의 픽 · ${formatLikeCount(likes)} 응원` : "이달의 아티스트";
    const tagsHTML = (top.tags || []).slice(0, 3).map(t => `<li>${t}</li>`).join("");

    root.innerHTML = `
      <div class="hero-feature-media">
        <img src="${top.images.thumb || top.images.cover}" alt="${top.publicName} 프로필" />
      </div>
      <div class="hero-feature-body">
        <span class="hero-feature-label">${label}</span>
        <strong>${top.publicName}</strong>
        <p class="hero-feature-summary">${top.summary || ""}</p>
        <p>${artistToneCopy(top) || top.intro || ""}</p>
        <ul class="hero-feature-tags">${tagsHTML}</ul>
        <a class="text-link hero-feature-link" href="/character-detail?slug=${top.slug}">${top.publicName} 무드 보기</a>
      </div>
    `;
  }

  function renderDebutLine() {
    const root = document.getElementById("debutLineGrid");
    if (!root) return;

    const list = _artists.filter(isHiddenLineupArtist);
    if (!list.length) { root.closest("section")?.setAttribute("hidden", ""); return; }

    root.innerHTML = list.map(a => {
      const isMale = a.gender === "male";
      const silhouetteClass = isMale ? "silhouette-male" : "silhouette-female";
      const silhouetteLabel = isMale ? "HIDDEN<br>STAGE" : "NEW<br>STAGE";
      // #362/#980 — "곧/준비 중" 내부어 제거. 실서비스 톤: "공개 예정 라인업".
      const silhouetteText = isMale ? "공개 예정 남성 아티스트 라인업" : "공개 예정 여성 아티스트 라인업";

      return `
      <article class="debut-card clickable-card" data-href="/character-detail?slug=${a.slug}"
        style="--char-accent: ${a.colorAccent || "#9f8bc7"}">
        <div class="debut-card-media ${silhouetteClass}">
          <div class="debut-silhouette">
            <span>${silhouetteLabel}</span>
            <small>${silhouetteText}</small>
          </div>
          <div class="debut-gender-badge">${isMale ? "♂" : "♀"}</div>
        </div>
        <div class="debut-card-body">
          <span class="debut-card-type eyebrow">${a.type}</span>
          <strong>${a.publicName}</strong>
          <p>${artistToneCopy(a)}</p>
          <a class="text-link" href="/character-detail?slug=${a.slug}">무드 보기</a>
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
    const featured = _artists.filter(a => ["yoon-serin", "han-seoyul", "park-doa", "choi-seojin"].includes(a.slug));
    root.innerHTML = featured.map(a => `
      <article class="roster-card ${statusMeta[a.status].className} clickable-card"
        data-href="/character-detail?slug=${a.slug}"
        data-secret="${a.status === "secret"}">
        <div class="roster-media roster-media-${a.status}"${mediaStyle(a.images.thumb || a.images.cover)}>
          <strong>${a.publicName}</strong>
        </div>
        <div class="roster-body">
          <div class="roster-meta">
            <span class="eyebrow">${a.type}</span>
            <span class="status-badge status-badge-${a.status}" data-i18n="${statusMeta[a.status].labelKey || ""}">${statusMeta[a.status].label}</span>
          </div>
          <p>${artistToneCopy(a)}</p>
          <a class="text-link ${a.status === "secret" ? "is-dimmed" : ""}" href="/character-detail?slug=${a.slug}">무드 보기</a>
        </div>
      </article>`).join("");
    window.luminaI18n?.apply?.(root);
  }

  window.renderMainArtists = renderMainArtists;
  window.renderHeroFeature = renderHeroFeature;
  window.renderDebutLine = renderDebutLine;
  window.bindDebutLineCarousel = bindDebutLineCarousel;
  window.renderRoster = renderRoster;
})();
