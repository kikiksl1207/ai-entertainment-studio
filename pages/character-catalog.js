(function initCharacterCatalogPage() {
/* ── 렌더링: 캐릭터 카탈로그 ────────────────── */
function renderCatalogMedia(a) {
  const s = statusMeta[a.status];
  if (a.status === "secret" || a.status === "pending") {
    return `<div class="catalog-media catalog-media-${a.tier} catalog-media-${a.status}">
      <div class="catalog-overlay">
        <span class="eyebrow">${a.type}</span>
        <strong>${a.publicName}</strong>
        <em class="catalog-status-caption">${s.summaryLabel}</em>
      </div></div>`;
  }
  return `<div class="catalog-media catalog-media-${a.tier} catalog-media-${a.status}">
    <img class="catalog-image catalog-image-${a.slug}" src="${a.images.thumb || a.images.cover}" alt="${a.publicName}" onerror="this.style.display='none'" />
    <div class="catalog-overlay"><em class="catalog-status-caption">${s.summaryLabel}</em></div>
  </div>`;
}

function renderCharacterCatalog(filter = "all", tagFilter = "", statusFilter = "all") {
  const root = document.getElementById("characterCatalog");
  if (!root) return;

  const tierLabel = { main: "메인", premium: "프리미엄", sub: "서브", experiment: "실험" };
  // 5개 메인 type — 여기에 안 잡히면 "기타" 필터에서 자동 노출 (향후 새 type 추가 시점 판단용)
  const KNOWN_TYPES = ["아티스트", "모델", "배우", "엔터테이너", "스포츠"];

  let list;
  if (filter === "all") {
    list = _artists;
  } else if (filter === "기타") {
    list = _artists.filter(a => !KNOWN_TYPES.includes(a.type));
  } else {
    list = _artists.filter(a => a.type === filter || a.tier === filter);
  }
  if (tagFilter) list = list.filter(a => a.tags.includes(tagFilter));
  // status 필터 (사용자 클릭 시) — type 필터와 독립적으로 AND 적용
  if (statusFilter && statusFilter !== "all") {
    list = list.filter(a => a.status === statusFilter);
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

  // #080 — 빈상태: 필터 결과가 0이면 안내 카드
  if (list.length === 0) {
    // #362 — 빈상태 카피 톤다운. "준비 중" 반복 없이 실서비스 안내.
    root.innerHTML = `<div class="catalog-empty" style="grid-column:1/-1;padding:48px 24px;text-align:center;color:rgba(240,238,248,0.62);background:rgba(10,8,18,0.32);border:1px dashed rgba(255,20,147,0.18);border-radius:14px;">
      <strong style="display:block;font-size:15px;color:var(--ink);margin-bottom:6px;">아직 이 카테고리에 공개된 아티스트가 없어요</strong>
      새 아티스트 라인업은 공지로 안내드릴게요.
    </div>`;
    return;
  }

  root.innerHTML = list.map(a => `
    <article class="catalog-card ${statusMeta[a.status].className} clickable-card"
      data-href="/character-detail?slug=${a.slug}"
      data-secret="${a.status === "secret" || a.status === "pending"}"
      style="--char-accent: ${a.colorAccent || "#9f8bc7"}">
      ${renderCatalogMedia(a)}
      ${(a.status === "public" || a.status === "debut") ? likeButtonHTML(a.slug, "like-btn-large like-btn-catalog") : ""}
      <div class="catalog-body">
        <h3 class="catalog-name">${a.publicName}</h3>
        <div class="catalog-meta">
          <span>${statusMeta[a.status].label}</span>
          <span>${tierLabel[a.tier] || a.tier}</span>
        </div>
        <p class="catalog-summary">${artistToneCopy(a)}</p>
        <dl class="catalog-details">
          <div><dt>팬 포인트</dt><dd>${a.fandom}</dd></div>
          <div><dt>브랜드 무드</dt><dd>${a.business}</dd></div>
        </dl>
        <div class="tag-list">${a.tags.map(t => `<span>${t}</span>`).join("")}</div>
        <a class="text-link ${(a.status === "secret" || a.status === "pending") ? "is-dimmed" : ""}" href="/character-detail?slug=${a.slug}">무드 보기</a>
      </div>
    </article>`).join("");

  const note = document.getElementById("activeFilterNote");
  if (note) {
    const parts = [];
    if (tagFilter) parts.push(`태그: <strong>${tagFilter}</strong>`);
    if (filter && filter !== "all") parts.push(`분류: <strong>${filter}</strong>`);
    if (statusFilter && statusFilter !== "all") {
      const statusLabelMap = { public: "공개 활동 중", candidate: "데뷔 예정", secret: "비공개 라인", pending: "공개 준비 중" };
      parts.push(`상태: <strong>${statusLabelMap[statusFilter] || statusFilter}</strong>`);
    }
    if (parts.length === 0) {
      note.innerHTML = "";
    } else {
      note.innerHTML = `<span>현재 필터: ${parts.join(" / ")}</span>` +
        (tagFilter ? `<a href="/characters" class="text-link">필터 해제</a>` : "");
    }
  }
}

function bindCharacterFilters() {
  const filterRoot = document.getElementById("characterFilters");
  const statusRoot = document.getElementById("characterStatusFilters");
  if (!filterRoot && !statusRoot) return;

  const typeBtns = filterRoot ? [...filterRoot.querySelectorAll("[data-filter]")] : [];
  const statusBtns = statusRoot ? [...statusRoot.querySelectorAll("[data-status-filter]")] : [];
  const activeTag = new URLSearchParams(window.location.search).get("tag") || "";

  // 현재 활성 상태 — 두 필터바 모두 추적
  const getCurrentType = () => filterRoot?.querySelector(".is-active")?.dataset.filter || "all";
  const getCurrentStatus = () => statusRoot?.querySelector(".is-active")?.dataset.statusFilter || "all";

  typeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      typeBtns.forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      renderCharacterCatalog(btn.dataset.filter, activeTag, getCurrentStatus());
    });
  });
  statusBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      statusBtns.forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      renderCharacterCatalog(getCurrentType(), activeTag, btn.dataset.statusFilter);
    });
  });
  if (activeTag) renderCharacterCatalog("all", activeTag, getCurrentStatus());
}

window.renderCharacterCatalog = renderCharacterCatalog;
window.bindCharacterFilters = bindCharacterFilters;
})();
