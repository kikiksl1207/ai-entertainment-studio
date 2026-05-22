(function initCharacterDetailPage() {
/* ── 렌더링: 캐릭터 상세 ─────────────────────── */
/* ── 캐릭터 상세 페이지 갤러리 비동기 갱신 (#031) ──
   목록 API `/api/v1/artists`에 assets[]이 빠져있을 가능성 대비.
   상세 페이지 진입 시 개별 `/api/v1/artists/{slug}` 호출 → 정확한 gallery로 갱신.
   에밀리 권장 패턴: artist.assets.filter(usageType=gallery).map(url) */
async function fetchAndUpdateDetailGallery(slug, artistName) {
  if (!slug) return;
  if (shouldKeepLocalGallery(slug)) return;
  try {
    const full = await apiFetch(`/api/v1/artists/${encodeURIComponent(slug)}`);
    if (!full || !Array.isArray(full.assets) || full.assets.length === 0) return;

    const galleryItems = full.assets
      .filter(a => a.usageType === "gallery")
      .map(a => ({ caption: a.caption || "Gallery", src: normalizeAssetUrl(a.url) }));

    if (galleryItems.length === 0) return;

    // _artists 캐시 갱신 (다음 진입 시 빠르게)
    const cached = _artists.find(a => a.slug === slug);
    if (cached) {
      cached.assets = full.assets;
      cached.gallery = galleryItems;
      // cover/thumb도 최신 운영 데이터로 갱신
      const fullCover = full.assets.find(a => a.usageType === "cover");
      const fullThumb = full.assets.find(a => a.usageType === "thumb");
      if (fullCover?.url) cached.images.cover = normalizeAssetUrl(fullCover.url);
      if (fullThumb?.url) cached.images.thumb = normalizeAssetUrl(fullThumb.url);
    }

    // 슬라이더/라이트박스 새 데이터로 다시 그리기
    initGallerySlider(galleryItems, artistName);
    initLightbox(galleryItems, artistName);
    console.info(`[Lumina] 상세 갤러리 갱신: ${slug} (${galleryItems.length}장)`);
  } catch (err) {
    console.warn(`[Lumina] 개별 아티스트 fetch 실패 (${slug}) — 기존 갤러리 유지:`, err);
  }
}

/* #150 — 아티스트 상세 viewer/stats 조회 + 팔로우 버튼 갱신 (차모 #149 spec)
   - GET /api/v1/artists/:slug (Authorization 있으면 viewer 힌트 같이 옴)
   - 비로그인이면 followerCount만 갱신, 팔로우 버튼은 hidden 유지
   - 로그인이면 viewer.canFollow/canUnfollow에 따라 토글 */
let _detailArtistData = null;
async function fetchArtistDetailViewer(slug) {
  if (!slug) return;
  try {
    const isAuth = typeof isLoggedIn === "function" && isLoggedIn();
    const res = await apiFetch(`/api/v1/artists/${encodeURIComponent(slug)}`, {
      auth: isAuth // 로그인 상태면 토큰 첨부 → viewer 힌트 받음
    });
    if (!res?.id) return;
    _detailArtistData = res;
    applyArtistDetailViewer(res);
  } catch (err) {
    console.warn("[#150 artist detail viewer] 조회 실패:", err?.status, err?.message);
  }
}
function applyArtistDetailViewer(data) {
  const followerEl = document.querySelector("[data-detail-follower-count]");
  if (followerEl && typeof data?.stats?.followerCount === "number") {
    followerEl.textContent = `팔로워 ${data.stats.followerCount.toLocaleString("ko-KR")}`;
  }
  const btn = document.querySelector("[data-detail-follow]");
  if (!btn) return;
  const v = data?.viewer || {};
  if (v.isAuthenticated && (v.canFollow || v.canUnfollow)) {
    btn.hidden = false;
    btn.dataset.artistId = data.id || "";
    if (v.isFollowing || v.canUnfollow) {
      btn.classList.add("is-following");
      const label = btn.querySelector("[data-detail-follow-label]");
      if (label) label.textContent = "팔로잉 해제";
      btn.setAttribute("aria-label", "팔로잉 해제");
      btn.title = "팔로잉 해제";
      btn.dataset.following = "1";
    } else {
      btn.classList.remove("is-following");
      const label = btn.querySelector("[data-detail-follow-label]");
      if (label) label.textContent = "팔로우";
      btn.setAttribute("aria-label", "팔로우");
      btn.title = "팔로우";
      btn.dataset.following = "0";
    }
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
      alert("로그인하면 팔로우할 수 있어요.");
      return;
    }
    const artistId = btn.dataset.artistId;
    if (!artistId) {
      alert("아티스트 정보를 불러오지 못했어요. 새로고침 후 다시 시도해주세요.");
      return;
    }
    const wasFollowing = btn.dataset.following === "1";
    btn.dataset.busy = "1";
    // 낙관적 토글
    btn.classList.toggle("is-following", !wasFollowing);
    btn.dataset.following = wasFollowing ? "0" : "1";
    const label = btn.querySelector("[data-detail-follow-label]");
    if (label) label.textContent = wasFollowing ? "팔로우" : "팔로잉 해제";
    btn.setAttribute("aria-label", wasFollowing ? "팔로우" : "팔로잉 해제");
    btn.title = wasFollowing ? "팔로우" : "팔로잉 해제";
    // 팔로워 수 즉시 +1/-1
    const countEl = btn.querySelector("[data-detail-follower-count]");
    if (countEl) {
      const m = countEl.textContent.match(/[\d,]+/);
      if (m) {
        const cur = parseInt(m[0].replace(/,/g, ""), 10) || 0;
        const next = wasFollowing ? Math.max(0, cur - 1) : cur + 1;
        countEl.textContent = `팔로워 ${next.toLocaleString("ko-KR")}`;
      }
    }
    try {
      const res = await apiFetch(`/api/v1/artists/${encodeURIComponent(artistId)}/follow`, {
        method: wasFollowing ? "DELETE" : "POST",
        auth: true,
        throwOnError: true
      });
      // #153 — 응답에 stats/viewer 포함됨. 정확한 값으로 최종 동기화
      if (res?.stats?.followerCount !== undefined && countEl) {
        countEl.textContent = `팔로워 ${Number(res.stats.followerCount).toLocaleString("ko-KR")}`;
      }
      if (res?.viewer) {
        const isFollowing = res.viewer.isFollowing || res.viewer.canUnfollow;
        btn.classList.toggle("is-following", !!isFollowing);
        btn.dataset.following = isFollowing ? "1" : "0";
        if (label) label.textContent = isFollowing ? "팔로잉 해제" : "팔로우";
        btn.setAttribute("aria-label", isFollowing ? "팔로잉 해제" : "팔로우");
        btn.title = isFollowing ? "팔로잉 해제" : "팔로우";
      }
    } catch (err) {
      // 롤백
      btn.classList.toggle("is-following", wasFollowing);
      btn.dataset.following = wasFollowing ? "1" : "0";
      if (label) label.textContent = wasFollowing ? "팔로잉 해제" : "팔로우";
      btn.setAttribute("aria-label", wasFollowing ? "팔로잉 해제" : "팔로우");
      btn.title = wasFollowing ? "팔로잉 해제" : "팔로우";
      console.warn("[#150 detail follow] 실패", { status: err?.status, body: err?.body });
      alert(err?.message || "팔로우 처리에 실패했어요.");
      // 팔로워 수 원복
      if (countEl) {
        const m = countEl.textContent.match(/[\d,]+/);
        if (m) {
          const cur = parseInt(m[0].replace(/,/g, ""), 10) || 0;
          const next = wasFollowing ? cur + 1 : Math.max(0, cur - 1);
          countEl.textContent = `팔로워 ${next.toLocaleString("ko-KR")}`;
        }
      }
    } finally {
      btn.dataset.busy = "0";
    }
  });
}

function renderCharacterDetail() {
  const hero = document.getElementById("detailHero");
  if (!hero) return;

  const slug   = new URLSearchParams(window.location.search).get("slug");
  const artist = slug ? getCharacterBySlug(slug) : null;

  // #080 후속 — slug 누락 또는 일치 없음 → 빈상태 안내 (이전: _artists[0] fallback이라 다른 캐릭터가 보였음)
  if (!artist) {
    hero.className = "detail-hero-card";
    hero.innerHTML = `<div class="detail-hero-secret"><strong>아티스트 정보를 찾을 수 없어요</strong><p style="margin-top:8px;color:rgba(240,238,248,0.62);font-size:14px;">URL을 다시 확인하거나 아티스트 목록에서 다시 들어와 주세요.</p><a class="text-link" href="/characters" style="margin-top:12px;display:inline-block;">아티스트 목록으로 돌아가기 →</a></div>`;
    const intro = document.getElementById("detailIntro");
    if (intro) intro.innerHTML = "";
    const meta = document.getElementById("detailMeta");
    if (meta) meta.innerHTML = "";
    const gallery = document.getElementById("detailGallery");
    if (gallery) gallery.innerHTML = "";
    const shorts = document.getElementById("detailShorts");
    if (shorts) shorts.innerHTML = "";
    document.title = "아티스트를 찾을 수 없어요 — Lumina Stage";
    return;
  }
  const status = statusMeta[artist.status];

  document.title = `${artist.publicName} — Lumina Stage`;

  // 캐릭터 컬러 CSS 변수 주입
  if (artist.colorAccent) {
    document.documentElement.style.setProperty("--char-accent", artist.colorAccent);
    document.documentElement.style.setProperty("--char-accent-soft", artist.colorAccent + "22");
  }

  hero.className = `detail-hero-card ${status.className}`;
  hero.innerHTML = artist.status === "secret"
    ? `<div class="detail-hero-secret"><span class="eyebrow">${artist.type}</span><strong>${artist.publicName}</strong><em class="catalog-status-caption">${status.label}</em></div>`
    : `<div class="detail-hero-frame"><img class="detail-hero-image detail-hero-image-${artist.slug}" src="${artist.images.thumb || artist.images.cover}" alt="${artist.publicName}" /></div>`;

  const intro = document.getElementById("detailIntro");
  if (intro) {
    intro.innerHTML = `
      <p class="eyebrow">공식 프로필</p>
      <h1 data-cms-key="character-detail.intro.publicName">${artist.publicName}</h1>
      <p class="detail-summary" data-cms-key="character-detail.intro.summary" data-cms-field="body">${artist.summary}</p>
      <div class="detail-bio">
        <p data-cms-key="character-detail.intro.body" data-cms-field="body">${artist.intro}</p>
        <p class="detail-concept" data-cms-key="character-detail.intro.concept" data-cms-field="body">${artist.concept}</p>
      </div>
      <div class="detail-intro-bottom">
        <div class="detail-sns-section">
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
            ${artist.tags.map(t => `<span class="detail-hashtag">#${t}</span>`).join("")}
          </div>
        </div>
      </div>`;
  }

  const meta = document.getElementById("detailMeta");
  if (meta) {
    const tierLabel = { main: "메인", premium: "프리미엄", sub: "서브", experiment: "실험" };
    meta.innerHTML = `
      <span class="status-badge status-badge-${artist.status}">${status.label}</span>
      <span class="detail-type-tag">${artist.type}</span>
      <span class="detail-tier-tag">${tierLabel[artist.tier] || artist.tier}</span>
      <button class="detail-share-btn" type="button" data-share-character="${artist.slug}" aria-label="이 아티스트 공유하기">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>
        공유하기
      </button>`;
  }

  const gallery = document.getElementById("detailGallery");
  if (gallery) {
    const galleryItems = artist.gallery?.length
      ? artist.gallery.map(item => Array.isArray(item)
        ? { caption: item[0] || "Gallery", src: item[1] }
        : item)
      : [
          { caption: "Cover", src: artist.images.cover },
          { caption: "Thumbnail", src: artist.images.thumb }
        ];

    // detail-body-grid 인라인 스타일 직접 적용 (CSS 충돌 완전 차단)
    const bodyGrid = gallery.closest(".detail-body-grid");
    if (bodyGrid) {
      Object.assign(bodyGrid.style, {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "24px",
        alignItems: "stretch",
        marginBottom: "40px"
      });
    }

    gallery.innerHTML = artist.status === "secret" ? "" : `
      <div id="galleryHeader" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:8px;flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);">포토 갤러리</span>
          <strong style="font-size:17px;font-weight:700;color:var(--ink);">공식 이미지</strong>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button id="galleryPrev" aria-label="이전" style="background:var(--panel);border:1px solid var(--line);color:var(--ink);width:36px;height:36px;border-radius:50%;font-size:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;">‹</button>
          <span id="galleryCounter" style="font-size:12px;color:var(--muted);min-width:64px;text-align:center;"></span>
          <button id="galleryNext" aria-label="다음" style="background:var(--panel);border:1px solid var(--line);color:var(--ink);width:36px;height:36px;border-radius:50%;font-size:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;">›</button>
        </div>
      </div>
      <div id="gallerySlider" style="width:100%;flex:1;min-height:0;overflow:hidden;border-radius:14px;background:#16122a;">
        <div id="galleryTrack" style="display:flex;height:100%;"></div>
      </div>`;

    initGallerySlider(galleryItems, artist.publicName);
    initLightbox(galleryItems, artist.publicName);

    // #031: 운영 API에서 정확한 gallery 가져와서 갱신 (에밀리 코드 패턴 적용)
    // /api/v1/artists 목록 응답에 assets가 빠져있는 경우 대비 → 개별 API 호출
    fetchAndUpdateDetailGallery(artist.slug, artist.publicName);
  }

  const profile = document.getElementById("detailProfile");
  if (profile) {
    profile.innerHTML = Object.entries(artist.profile)
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
  }

  const shortsRoot = document.getElementById("detailShorts");
  if (shortsRoot) {
    shortsRoot.innerHTML = artist.shorts.map(item => `
      <article class="detail-short-card">
        <div class="detail-short-media ${status.className}"${mediaStyle(artist.images.thumb)}>
          <span class="eyebrow">${artist.publicName}</span>
          <strong>${item.title}</strong>
        </div>
        <div class="detail-short-body"><span>${item.metric}</span></div>
      </article>`).join("");
  }

  const cta = document.getElementById("detailCta");
  if (cta) {
    // #150 — 차모 spec: viewer.canFollow / canUnfollow / isFollowing / stats.followerCount
    // 초기 렌더는 캐릭터 시드 데이터로 일단 표시, fetchArtistDetailViewer()가 비동기로 갱신
    const followerCount = artist._stats?.followerCount;
    const followerText = typeof followerCount === "number"
      ? `<small data-detail-follower-count>팔로워 ${followerCount.toLocaleString("ko-KR")}</small>`
      : `<small data-detail-follower-count></small>`;
    const followBtn = artist.status === "secret"
      ? ""
      : `<button class="cta-btn cta-btn-follow" type="button" data-detail-follow="${feedEscapeHtml(artist.slug)}" hidden>
           <span class="cta-btn-icon">+</span>
           <span class="cta-btn-label"><strong data-detail-follow-label>팔로우</strong>${followerText}</span>
         </button>`;
    cta.innerHTML = artist.status === "secret"
      ? `<div class="detail-cta-card is-secret"><strong>아직 베일 속에 있는 아티스트입니다</strong><p>첫 공개 순간에 가장 잘 어울리는 장면으로 찾아올게요.</p></div>`
      : `<div class="detail-cta-card">
           <div class="detail-cta-info">
             <strong>${artist.publicName}의 다음 무대를 응원하세요</strong>
             <p>오늘의 응원은 순위와 콘텐츠 반응에 반영되어 다음 장면을 여는 힘이 됩니다.</p>
           </div>
           <div class="detail-cta-actions">
             ${followBtn}
             <button class="cta-btn cta-btn-support" disabled>
               <span class="cta-btn-icon">💜</span>
               <span class="cta-btn-label"><strong>후원하기</strong><small>곧 공개</small></span>
             </button>
             <a class="cta-btn cta-btn-chat cta-btn-link" href="/character-chat?slug=${encodeURIComponent(artist.slug)}">
               <span class="cta-btn-icon">💬</span>
               <span class="cta-btn-label"><strong>프리미엄챗</strong><small>대화/방 보기</small></span>
             </a>
           </div>
         </div>`;
    // 비동기로 viewer/stats 받아 팔로우 버튼·팔로워 수 갱신
    if (artist.status !== "secret") {
      fetchArtistDetailViewer(artist.slug);
    }
  }

  const tagNav = document.getElementById("detailTagNavigation");
  if (tagNav) {
    tagNav.innerHTML = artist.tags
      .map(t => `<a class="tag-link" href="/characters?tag=${encodeURIComponent(t)}">${t}</a>`).join("");
  }

  // #324 — 운영자가 Backstage CMS에서 수정한 캐릭터별 문구가 있으면 덮어쓰기.
  // CMS 실패/키 누락 시 위에서 렌더한 정적 fallback 유지.
  if (window.LuminaCms && typeof window.LuminaCms.hydrate === "function") {
    window.LuminaCms.hydrate({ pageKey: "character-detail", characterSlug: artist.slug }).catch(function () {});
  }
}

window.renderCharacterDetail = renderCharacterDetail;
window.bindArtistDetailFollow = bindArtistDetailFollow;
})();
