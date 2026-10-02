(function initCharacterCatalogPage() {
const catalogLoad = { phase: "idle", artists: [] };
let catalogFilters = { type: "all", tag: new URLSearchParams(window.location.search).get("tag") || "", status: "all" };

async function loadCharacterCatalog() {
  if (catalogLoad.phase === "loading") return;
  catalogLoad.phase = "loading";
  catalogLoad.artists = [];
  renderCharacterCatalog();
  try {
    const response = await apiFetch("/api/v1/artists", { throwOnError: true });
    if (!Array.isArray(response)) throw new Error("Invalid public artist list");
    const artists = publicArtistsFromApi(response);
    if (response.length && !artists.length) throw new Error("Invalid public artist list");
    catalogLoad.artists = artists;
    _artists = artists;
    catalogLoad.phase = "ready";
  } catch {
    catalogLoad.phase = "error";
  }
  renderCharacterCatalog();
}

/* ── 렌더링: 캐릭터 카탈로그 ────────────────── */
function catalogStatusCopy(status, type = "label") {
  const s = statusMeta[status] || {};
  const key = type === "summary" ? s.summaryKey : s.labelKey;
  const fallback = type === "summary" ? s.summaryLabel : s.label;
  return window.luminaI18n?.t?.(key) || fallback || status;
}

function catalogText(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function catalogHasValue(value) {
  return value !== null && value !== undefined &&
    String(value).trim() !== "" && !/^(?:-|—|N\/A|TBD)$/i.test(String(value).trim());
}

function catalogStatusMatches(artist, statusFilter) {
  if (statusFilter === "candidate") return artist.tier === "candidate" && artist.status === "public";
  return artist.status === statusFilter;
}

function renderCatalogMedia(a) {
  const s = statusMeta[a.status] || {};
  if (a.status === "secret" || a.status === "pending") {
    return `<div class="catalog-media catalog-media-${a.tier} catalog-media-${a.status}">
      <div class="catalog-overlay">
        <span class="eyebrow">${catalogText(a.type)}</span>
        <strong>${catalogText(a.publicName)}</strong>
        <em class="catalog-status-caption" data-i18n="${s.summaryKey || ""}">${catalogStatusCopy(a.status, "summary")}</em>
      </div></div>`;
  }
  const primary = a.images?.thumb || a.images?.cover;
  const fallback = a.images?.thumb && a.images?.cover && a.images.thumb !== a.images.cover ? a.images.cover : "";
  return `<div class="catalog-media catalog-media-${a.tier} catalog-media-${a.status}${primary ? "" : " is-image-unavailable"}">
    ${primary ? `<img class="catalog-image catalog-image-${catalogText(a.slug)}" src="${catalogText(primary)}" data-fallback-src="${catalogText(fallback)}" alt="${catalogText(a.publicName)}" />` : ""}
    <strong class="catalog-image-fallback">${catalogText(a.publicName)}</strong>
    <div class="catalog-overlay"><em class="catalog-status-caption" data-i18n="${s.summaryKey || ""}">${catalogStatusCopy(a.status, "summary")}</em></div>
  </div>`;
}

function renderCharacterCatalog(filter = catalogFilters.type,
  tagFilter = catalogFilters.tag,
  statusFilter = catalogFilters.status) {
  const root = document.getElementById("characterCatalog");
  if (!root) return;
  catalogFilters = { type: filter, tag: tagFilter, status: statusFilter };
  if (catalogLoad.phase === "idle") {
    loadCharacterCatalog();
    return;
  }
  _artists = catalogLoad.artists;
  window.refreshPublicArtistLocale?.();
  root.dataset.publicArtistsState = catalogLoad.phase;
  root.setAttribute("aria-busy", String(catalogLoad.phase === "loading"));
  if (catalogLoad.phase !== "ready") {
    root.innerHTML = `<div class="catalog-empty" role="status" aria-live="polite" style="grid-column:1/-1;">
      <p>${catalogText(window.luminaI18n?.t?.(catalogLoad.phase === "loading" ? "artist.public.loading" : "artist.public.error") ||
        (catalogLoad.phase === "loading" ? "공개 아티스트를 불러오는 중입니다." : "공개 아티스트를 불러오지 못했습니다."))}</p>
      ${catalogLoad.phase === "error" ? `<button type="button" data-artist-retry>${catalogText(window.luminaI18n?.t?.("artist.public.retry") || "다시 확인")}</button>` : ""}</div>`;
    root.querySelector("[data-artist-retry]")?.addEventListener("click", loadCharacterCatalog);
    return;
  }

  const tierLabel = { main: "메인", premium: "프리미엄", sub: "서브", experiment: "실험", candidate: "신규" };
  // 5개 메인 type — 여기에 안 잡히면 "기타" 필터에서 자동 노출 (향후 새 type 추가 시점 판단용)
  const KNOWN_TYPES = ["아티스트", "모델", "배우", "엔터테이너", "스포츠"];

  let list;
  if (filter === "all") {
    list = catalogLoad.artists;
  } else if (filter === "기타") {
    list = catalogLoad.artists.filter(a => !KNOWN_TYPES.includes(a.type));
  } else {
    list = catalogLoad.artists.filter(a => a.type === filter || a.tier === filter);
  }
  if (tagFilter) list = list.filter(a => (a.tags || []).includes(tagFilter));
  // status 필터 (사용자 클릭 시) — type 필터와 독립적으로 AND 적용
  if (statusFilter && statusFilter !== "all") {
    list = list.filter(a => catalogStatusMatches(a, statusFilter));
  }

  // 정렬: 공개 라인업은 운영 순서를 우선하고, 라인업 밖 항목만 같은 그룹 안에서 좋아요 순으로 보조 정렬
  // #601 — pending: 공개 준비 중. secret/candidate 뒤에 정렬, 목록에는 표시되나 dimmed.
  const statusOrder = { public: 0, debut: 0, candidate: 1, secret: 2, pending: 3 };
  list = [...list].sort((a, b) => {
    const so = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
    if (so !== 0) return so;
    const lineupOrder = compareByPublicLineupOrder(a, b);
    if (lineupOrder !== 0) return lineupOrder;
    return getLikesCount(b.slug) - getLikesCount(a.slug);
  });

  const note = document.getElementById("activeFilterNote");
  if (note) {
    const parts = [];
    if (tagFilter) parts.push(`태그: <strong>${catalogText(tagFilter)}</strong>`);
    if (filter && filter !== "all") parts.push(`분류: <strong>${catalogText(filter)}</strong>`);
    if (statusFilter && statusFilter !== "all") {
      const label = statusFilter === "candidate"
        ? window.luminaI18n?.t?.("character.filter.newArtists") || "신규 아티스트"
        : catalogStatusCopy(statusFilter);
      parts.push(`상태: <strong>${catalogText(label)}</strong>`);
    }
    note.innerHTML = parts.length
      ? `<span>현재 필터: ${parts.join(" / ")}</span><a href="/characters" class="text-link">필터 해제</a>`
      : "";
  }

  // #080 — 빈상태: 필터 결과가 0이면 안내 카드
  if (list.length === 0) {
    // #362 — 빈상태 카피 톤다운. "준비 중" 반복 없이 실서비스 안내.
    root.innerHTML = `<div class="catalog-empty" style="grid-column:1/-1;padding:48px 24px;text-align:center;color:rgba(240,238,248,0.62);background:rgba(10,8,18,0.32);border:1px dashed rgba(255,20,147,0.18);border-radius:14px;">
      <strong style="display:block;font-size:15px;color:var(--ink);margin-bottom:6px;">${catalogText(window.luminaI18n?.t?.(catalogLoad.artists.length ? "artist.public.noMatch" : "artist.public.empty") ||
        (catalogLoad.artists.length ? "선택한 조건에 맞는 공개 아티스트가 없습니다." : "현재 공개된 아티스트가 없습니다."))}</strong>
      <button type="button" data-artist-retry>${catalogText(window.luminaI18n?.t?.("artist.public.retry") || "다시 확인")}</button>
    </div>`;
    root.querySelector("[data-artist-retry]")?.addEventListener("click", loadCharacterCatalog);
    return;
  }

  root.innerHTML = list.map(a => `
    <article class="catalog-card ${statusMeta[a.status].className} clickable-card"
      data-href="/character-detail?slug=${encodeURIComponent(a.slug)}"
      data-secret="${a.status === "secret" || a.status === "pending"}"
      style="--char-accent: ${a.colorAccent || "#9f8bc7"}">
      ${renderCatalogMedia(a)}
      ${(a.status === "public" || a.status === "debut") ? likeButtonHTML(a.slug, "like-btn-large like-btn-catalog") : ""}
      <div class="catalog-body">
        <h3 class="catalog-name">${catalogText(a.publicName)}</h3>
        <div class="catalog-meta">
          <span data-i18n="${statusMeta[a.status].labelKey || ""}">${catalogStatusCopy(a.status)}</span>
          <span>${catalogText(tierLabel[a.tier] || a.tier)}</span>
        </div>
        ${catalogHasValue(artistToneCopy(a)) ? `<p class="catalog-summary">${catalogText(artistToneCopy(a))}</p>` : ""}
        ${catalogHasValue(a.fandom) || catalogHasValue(a.business) ? `<dl class="catalog-details">
          ${catalogHasValue(a.fandom) ? `<div><dt>팬 포인트</dt><dd>${catalogText(a.fandom)}</dd></div>` : ""}
          ${catalogHasValue(a.business) ? `<div><dt>브랜드 무드</dt><dd>${catalogText(a.business)}</dd></div>` : ""}
        </dl>` : ""}
        ${(a.tags || []).length ? `<div class="tag-list">${a.tags.map(t => `<span>${catalogText(t)}</span>`).join("")}</div>` : ""}
        <a class="text-link ${(a.status === "secret" || a.status === "pending") ? "is-dimmed" : ""}" href="/character-detail?slug=${encodeURIComponent(a.slug)}">무드 보기</a>
      </div>
    </article>`).join("");
  root.querySelectorAll(".catalog-image").forEach(img => {
    img.addEventListener("error", () => {
      if (img.dataset.fallbackSrc && img.src !== new URL(img.dataset.fallbackSrc, window.location.href).href) {
        img.src = img.dataset.fallbackSrc;
      } else {
        img.closest(".catalog-media").classList.add("is-image-unavailable");
        img.remove();
      }
    });
  });
  window.luminaI18n?.apply?.(root);
}

function bindCharacterFilters() {
  const filterRoot = document.getElementById("characterFilters");
  const statusRoot = document.getElementById("characterStatusFilters");
  if (!filterRoot && !statusRoot) return;

  const typeBtns = filterRoot ? [...filterRoot.querySelectorAll("[data-filter]")] : [];
  const statusBtns = statusRoot ? [...statusRoot.querySelectorAll("[data-status-filter]")] : [];
  const activeTag = () => new URLSearchParams(window.location.search).get("tag") || "";

  // 현재 활성 상태 — 두 필터바 모두 추적
  const getCurrentType = () => filterRoot?.querySelector(".is-active")?.dataset.filter || "all";
  const getCurrentStatus = () => statusRoot?.querySelector(".is-active")?.dataset.statusFilter || "all";

  typeBtns.forEach(btn => {
    if (btn.dataset.filterBound) return;
    btn.dataset.filterBound = "1";
    btn.addEventListener("click", () => {
      typeBtns.forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      renderCharacterCatalog(btn.dataset.filter, activeTag(), getCurrentStatus());
    });
  });
  statusBtns.forEach(btn => {
    if (btn.dataset.filterBound) return;
    btn.dataset.filterBound = "1";
    btn.addEventListener("click", () => {
      statusBtns.forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      renderCharacterCatalog(getCurrentType(), activeTag(), btn.dataset.statusFilter);
    });
  });
  renderCharacterCatalog(getCurrentType(), activeTag(), getCurrentStatus());
}

window.addEventListener("popstate", () => {
  renderCharacterCatalog(catalogFilters.type,
    new URLSearchParams(window.location.search).get("tag") || "", catalogFilters.status);
});
window.renderCharacterCatalog = renderCharacterCatalog;
window.bindCharacterFilters = bindCharacterFilters;
})();
