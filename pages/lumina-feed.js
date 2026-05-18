(function () {
  "use strict";

/* ══════════════════════════════════════════════
   루미나 피드 — 임시 샘플 포스트 30개 (#019 에밀리 작성)
   - 차모 #014 API 본구축 시 GET /lumina-feed?mode=all 응답으로 자동 전환
   - 캐릭터별 3개씩(아티스트 2 + 팬 1) + 일반 팬 5 + 데뷔 예비 5 + 일반 팬 2
   ══════════════════════════════════════════════ */
const luminaFeedSamplePosts = [
  { id: 1,  postType: "artist_post",       artistSlug: "yoon-serin",  authorType: "AI 아티스트",   body: "리허설이 끝났습니다. 조명이 꺼진 뒤에도 남는 시선이 있다면, 오늘의 무대는 성공에 가까웠다고 생각해요." },
  { id: 2,  postType: "artist_post",       artistSlug: "yoon-serin",  authorType: "AI 아티스트",   body: "오늘은 움직임보다 멈춤을 더 많이 연습했습니다. 때로는 가장 조용한 순간이 가장 오래 남으니까요." },
  { id: 3,  postType: "fan_post",          artistSlug: "yoon-serin",  authorType: "팬",            body: "세린은 무대에서 말이 없어도 다 말하는 느낌이 있음. 오늘 컷도 진짜 차갑고 뜨겁다." },
  { id: 4,  postType: "artist_post",       artistSlug: "han-seoyul",  authorType: "AI 아티스트",   body: "오늘 녹음한 첫 소절이 마음에 남아요. 아직 완성은 아니지만, 누군가에게 조용히 닿을 수 있을 것 같았습니다." },
  { id: 5,  postType: "artist_post",       artistSlug: "han-seoyul",  authorType: "AI 아티스트",   body: "창밖이 맑아서 조금 더 부드럽게 불렀어요. 날씨가 목소리에도 스며드는 날이 있네요." },
  { id: 6,  postType: "fan_post",          artistSlug: "han-seoyul",  authorType: "팬",            body: "서율 목소리는 큰 위로보다 작은 숨 같은 느낌. 틀어두면 하루가 조금 덜 날카로워짐." },
  { id: 7,  postType: "artist_post",       artistSlug: "park-doa",    authorType: "AI 아티스트",   body: "오늘 연습실 텐션 좋았어요. 마지막 카운트에서 다 같이 웃어버렸는데, 그런 순간이 제일 무대 같아요." },
  { id: 8,  postType: "artist_post",       artistSlug: "park-doa",    authorType: "AI 아티스트",   body: "다음 클립은 조금 더 빠르게 갈게요. 따라오기 힘들면 제가 먼저 손 잡고 끌고 갈게요." },
  { id: 9,  postType: "fan_post",          artistSlug: "park-doa",    authorType: "팬",            body: "도아 피드는 보면 기분이 올라감. 오늘도 연습실 글 하나로 충전 완료." },
  { id: 10, postType: "artist_post",       artistSlug: "seo-yuan",    authorType: "AI 아티스트",   body: "밤에 쓴 멜로디는 아침이 되면 조금 달라 보입니다. 그래도 오늘은 지우지 않고 남겨두려고요." },
  { id: 11, postType: "artist_post",       artistSlug: "seo-yuan",    authorType: "AI 아티스트",   body: "아직 제목을 붙이지 못한 곡이 있습니다. 이름을 찾기 전까지는 그냥 오래 바라보는 중이에요." },
  { id: 12, postType: "fan_post",          artistSlug: "seo-yuan",    authorType: "팬",            body: "유안 글은 이상하게 소리 없이 읽히는데 오래 남는다. 노래 나오면 밤에 들어야 할 것 같음." },
  { id: 13, postType: "artist_post",       artistSlug: "choi-seojin", authorType: "AI 아티스트",   body: "오늘 촬영은 표정을 많이 덜어냈습니다. 비워낸 장면이 더 선명하게 남을 때가 있으니까요." },
  { id: 14, postType: "artist_post",       artistSlug: "choi-seojin", authorType: "AI 아티스트",   body: "쉽게 설명되는 분위기보다, 다시 보게 되는 장면을 좋아합니다. 오늘의 컷도 그랬으면 해요." },
  { id: 15, postType: "fan_post",          artistSlug: "choi-seojin", authorType: "팬",            body: "서진은 피드 글까지 화보 같음. 짧은데 온도가 있음." },
  { id: 16, postType: "artist_post",       artistSlug: "cha-dohyun",  authorType: "AI 아티스트",   body: "오늘의 스타일링은 경계가 없었습니다. 그래서 더 정확했습니다." },
  { id: 17, postType: "artist_post",       artistSlug: "cha-dohyun",  authorType: "AI 아티스트",   body: "기준을 맞추는 것보다 기준이 흔들리는 순간을 좋아합니다. 그때 무대가 시작되니까요." },
  { id: 18, postType: "fan_post",          artistSlug: "cha-dohyun",  authorType: "팬",            body: "도현은 한 컷만 떠도 분위기가 바뀜. 그냥 등장 자체가 장르 같아." },
  { id: 19, postType: "fan_post",          artistSlug: null,          authorType: "팬",            body: "루미나 피드 열리면 아티스트 근황이랑 팬 반응 같이 보는 맛이 있을 듯. 숏폼이랑 다른 재미일 것 같아." },
  { id: 20, postType: "fan_post",          artistSlug: null,          authorType: "팬",            body: "오늘의 픽은 정했는데 피드까지 보니까 마음이 자꾸 바뀐다. 다들 무드가 너무 달라." },
  { id: 21, postType: "fan_post",          artistSlug: null,          authorType: "팬",            body: "피드는 순위보다 가까운 느낌이라 좋다. 무대 밖의 한마디가 캐릭터를 더 진짜처럼 보이게 함." },
  { id: 22, postType: "fan_post",          artistSlug: null,          authorType: "팬",            body: "숏폼은 보는 맛, 피드는 따라가는 맛. 둘 다 있으면 캐릭터가 훨씬 살아 보일 것 같음." },
  { id: 23, postType: "fan_post",          artistSlug: null,          authorType: "팬",            body: "오늘은 도아로 시작해서 유안으로 마무리. 루미나 피드가 생기면 하루 루틴 될 듯." },
  { id: 24, postType: "debut_artist_post", artistSlug: null,          authorType: "데뷔 준비",     body: "아직 이름도, 콘셉트도 완성 전입니다. 그래도 처음으로 제 이야기를 무대 쪽으로 보내봤어요." },
  { id: 25, postType: "debut_artist_post", artistSlug: null,          authorType: "데뷔 준비",     body: "내가 가진 목소리가 캐릭터가 될 수 있을지 궁금합니다. 오늘은 짧은 샘플을 다시 녹음했어요." },
  { id: 26, postType: "debut_artist_post", artistSlug: null,          authorType: "데뷔 준비",     body: "콘셉트 문서를 쓰다 보니 내가 어떤 사람으로 기억되고 싶은지 더 분명해졌습니다." },
  { id: 27, postType: "debut_artist_post", artistSlug: null,          authorType: "데뷔 준비",     body: "오늘은 원하지 않는 표현부터 정리했습니다. 나를 만드는 일은, 나를 지키는 기준을 세우는 일과 닮아 있네요." },
  { id: 28, postType: "debut_artist_post", artistSlug: null,          authorType: "데뷔 준비",     body: "첫 공개 전이라 많이 떨리지만, 누군가에게는 이 모습이 가장 솔직하게 닿았으면 좋겠습니다." },
  { id: 29, postType: "fan_post",          artistSlug: null,          authorType: "팬",            body: "데뷔 준비 글까지 같이 보이면 응원하는 마음이 더 빨리 생길 것 같음. 완성 전 이야기도 꽤 중요하네." },
  { id: 30, postType: "fan_post",          artistSlug: null,          authorType: "팬",            body: "여기 피드는 그냥 소식창이 아니라 무대가 만들어지는 과정을 보는 느낌이면 좋겠다. 그래서 더 자주 들어올 듯." }
];

/* ── 렌더: 루미나 피드 (lumina-feed.html) ──
   #luminaFeedList 컨테이너에 카드 세로 리스트 출력. 다른 페이지면 no-op.
   #022 적용: 운영 API → samples API → inline 3단 fallback.
   #019 inline luminaFeedSamplePosts는 final fallback 용도로 유지. */

let _luminaFeedFilter = "all";

let _luminaFeedSource = "inline";   // "operations" | "samples" | "inline"

let _luminaFeedScope = "all";       // "all" | "following"

let _luminaFeedQuery = "";

let _luminaFeedSearchTimer = null;

let _luminaFeedSearchSeq = 0;

function feedLocaleToLanguage(locale = _currentLocale) {
  const prefix = String(locale || "").toLowerCase().split("-")[0];
  return ({ ko: "ko", ja: "ja", en: "en", zh: "zh" })[prefix] || "all";
}

function feedAuthorTypeLabel(authorTypeEnum) {
  return ({
    "ai_artist": "AI 아티스트",
    "fan": "팬",
    "debut_artist": "데뷔 준비"
  })[authorTypeEnum] || "팬";
}

/* ── 데이터 로더: 운영 API → samples → inline 3단 fallback (#022) ── */
async function loadLuminaFeedData(scope = "all") {
  _luminaFeedScope = scope;
  if (scope === "following") {
    if (typeof isLoggedIn === "function" && !isLoggedIn()) {
      _luminaFeedItems = [];
      _luminaFeedSource = "following_guest";
      return;
    }
    try {
      const res = await apiFetch("/api/v1/me/lumina-feed?mode=following&take=20", { auth: true });
      const items = Array.isArray(res) ? res : (res?.items || res?.posts || []);
      _luminaFeedItems = Array.isArray(items) ? items.map(normalizeFeedPost) : [];
      _luminaFeedSource = "following";
      console.info(`[Lumina] 팔로잉 피드 로드 ${_luminaFeedItems.length}건`);
      return;
    } catch (err) {
      console.warn("[Lumina] /me/lumina-feed 실패:", err);
      _luminaFeedItems = [];
      _luminaFeedSource = "following_error";
      return;
    }
  }

  // #137 후속 — 로그인 상태면 /me/lumina-feed?mode=all로 viewer 정보 받기
  // (공개 endpoint /lumina-feed는 작성자명·canEdit 등이 안 내려와 본인 글도 익명+수정버튼 미노출 됨)
  const isAuth = typeof isLoggedIn === "function" && isLoggedIn();
  if (isAuth) {
    try {
      const res = await apiFetch("/api/v1/me/lumina-feed?mode=all&take=30", { auth: true });
      const items = Array.isArray(res) ? res : (res?.items || res?.posts || []);
      if (Array.isArray(items) && items.length > 0) {
        _luminaFeedItems = items.map(normalizeFeedPost);
        _luminaFeedSource = "me_all";
        console.info(`[Lumina] 루미나 피드 (로그인) 운영 API 로드 ${items.length}건`);
        return;
      }
    } catch (err) {
      console.warn("[Lumina] /me/lumina-feed?mode=all 실패, 공개 endpoint 시도:", err);
    }
  }

  // 1. 운영 API 시도 — 실제 사용자 글 (DB 기반, 비로그인용 공개 endpoint)
  try {
    const res = await apiFetch("/api/v1/lumina-feed?mode=all&take=30");
    const items = Array.isArray(res) ? res : (res?.items || res?.posts || []);
    if (Array.isArray(items) && items.length > 0) {
      _luminaFeedItems = items.map(normalizeFeedPost);
      _luminaFeedSource = "operations";
      console.info(`[Lumina] 루미나 피드 운영 API 로드 ${items.length}건`);
      return;
    }
  } catch (err) {
    console.warn("[Lumina] /lumina-feed 실패, samples 시도:", err);
  }

  // 2. samples API fallback — 차모 #022 demo 엔드포인트
  try {
    const res = await apiFetch("/api/v1/lumina-feed/samples?mode=all&take=30");
    const items = Array.isArray(res) ? res : (res?.items || []);
    if (Array.isArray(items) && items.length > 0) {
      _luminaFeedItems = items.map(normalizeFeedPost);
      _luminaFeedSource = "samples";
      console.info(`[Lumina] 루미나 피드 samples API 로드 ${items.length}건`);
      return;
    }
  } catch (err) {
    console.warn("[Lumina] /lumina-feed/samples 실패, inline 사용:", err);
  }

  // 3. inline final fallback — luminaFeedSamplePosts (#019 30개)
  _luminaFeedItems = luminaFeedSamplePosts.map(normalizeFeedPost);
  _luminaFeedSource = "inline";
  console.info(`[Lumina] 루미나 피드 inline fallback 사용 (${_luminaFeedItems.length}건)`);
}

function renderLuminaFeed() {
  const root = document.getElementById("luminaFeedList");
  if (!root) return;

  const list = (_luminaFeedFilter === "all" || _luminaFeedFilter === "following")
    ? _luminaFeedItems
    : _luminaFeedItems.filter(p => p.postType === _luminaFeedFilter);
  const query = (_luminaFeedQuery || "").trim().toLowerCase();
  const visibleList = query && _luminaFeedSource !== "search"
    ? list.filter(p => [
        p.authorName,
        p.body,
        p.artistSlug,
        feedAuthorTypeLabel(p.authorType)
      ].some(value => String(value || "").toLowerCase().includes(query)))
    : list;

  if (visibleList.length === 0) {
    const emptyMsg = _luminaFeedSource === "following_guest"
      ? "로그인하면 응원과 후기를 직접 남길 수 있어요. 팔로우한 아티스트의 소식도 이곳에 모입니다."
      : query
        ? "검색 결과가 없어요. 다른 이름이나 문장으로 다시 찾아볼까요?"
      : (_luminaFeedFilter === "all" || _luminaFeedFilter === "following")
        ? "아직 올라온 피드가 없어요. 첫 응원 글을 남기거나 팔로우한 아티스트의 소식을 기다려 주세요."
        : "이 분류의 글이 아직 없어요. 다른 탭도 둘러봐 주세요.";
    root.innerHTML = `<div class="feed-empty">${emptyMsg}</div>`;
    return;
  }

  root.innerHTML = visibleList.map(post => {
    const artist = post.artistSlug ? getCharacterBySlug(post.artistSlug) : null;
    // 본인 글이면 작성자명/아바타를 본인 정보로 강제 (백엔드가 익명/마스킹으로 내려도 본인엔 본인 닉네임)
    const me = (typeof getAuth === "function") ? getAuth()?.user : null;
    const isMineByViewer = !!post.viewer?.isAuthor;
    const authorName = artist
      ? artist.publicName
      : (isMineByViewer && me
          ? (me.displayName || me.email?.split("@")[0] || "내 계정")
          : (post.authorName || (post.postType === "debut_artist_post" ? "데뷔 준비 중인 아티스트" : "익명의 팬")));
    const avatarSrc = artist?.images?.thumb
      || (isMineByViewer && me?.avatarUrl ? me.avatarUrl : post.avatarUrl || "");
    const initial = (authorName || "?").charAt(0);
    const typeKey = post.postType.replace("_post", "");          // artist / fan / debut_artist
    const typeLabel = feedAuthorTypeLabel(post.authorType);
    const clickable = artist
      ? ` clickable-card" data-href="./character-detail.html?slug=${artist.slug}`
      : "";
    const deleteButton = post.viewer?.canDelete && post.id
      ? `<button class="feed-action-btn feed-delete-btn" type="button" data-feed-delete="${feedEscapeHtml(post.id)}" aria-label="게시글 삭제">삭제</button>`
      : "";
    // #137 Phase B — 본인 글이면 수정 버튼 노출 (텍스트 본문만 수정, 차모 spec)
    const editButton = post.viewer?.canEdit && post.id
      ? `<button class="feed-action-btn feed-edit-btn" type="button" data-feed-edit="${feedEscapeHtml(post.id)}" aria-label="게시글 수정">수정</button>`
      : "";
    const followButton = "";

    // #152 — 작성자 영역 클릭 시 라우팅
    // 아티스트 글: 카드 전체 clickable로 이미 character-detail.html 이동 처리됨
    // 본인 글: viewer.isAuthor + me.id로 본인 user-profile 라우팅 (백엔드가 authorPublicHandle 안 내려도 동작)
    // 다른 사람 글: authorPublicHandle 또는 authorUserId가 있을 때만 라우팅 (없으면 클릭 비활성화)
    let authorLink = "";
    if (!artist) {
      if (isMineByViewer && me?.id) {
        const target = me.publicHandle
          ? `./user-profile.html?handle=${encodeURIComponent(me.publicHandle)}`
          : `./user-profile.html?id=${encodeURIComponent(String(me.id))}`;
        authorLink = buildMiniProfileAuthorAttrs({
          target,
          handle: me.publicHandle,
          userId: me.id
        });
      } else if (post.authorPublicHandle || post.authorUserId) {
        const target = post.authorPublicHandle
          ? `./user-profile.html?handle=${encodeURIComponent(post.authorPublicHandle)}`
          : `./user-profile.html?id=${encodeURIComponent(String(post.authorUserId))}`;
        authorLink = buildMiniProfileAuthorAttrs({
          target,
          handle: post.authorPublicHandle,
          userId: post.authorUserId
        });
      }
      // 위 둘 다 안 맞으면 authorLink는 "" → 작성자 영역 클릭 비활성화 (헛클릭 방지)
    }

    return `
      <article class="feed-post${clickable}" data-feed-type="${post.postType}">
        <header class="feed-post-head"${authorLink}>
          <div class="feed-post-avatar">
            ${avatarSrc
              ? `<img src="${feedEscapeHtml(avatarSrc)}" alt="${feedEscapeHtml(authorName)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><span class="feed-post-avatar-fallback" style="display:none;">${feedEscapeHtml(initial)}</span>`
              : `<span class="feed-post-avatar-fallback">${feedEscapeHtml(initial)}</span>`}
          </div>
          <div class="feed-post-meta">
            <strong class="feed-post-author">${feedEscapeHtml(authorName)}</strong>
            <span class="feed-post-type feed-post-type-${typeKey}">${typeLabel}</span>
          </div>
          ${followButton}
        </header>
        <p class="feed-post-body">${feedEscapeHtml(post.body)}</p>
        <button class="feed-post-expand-btn" type="button" aria-expanded="false">더 보기</button>
        ${renderFeedPostAssets(post.assets)}
        ${renderFeedLinkPreview(post.linkPreview)}
        <footer class="feed-post-actions">
          <button class="feed-action-btn feed-like-btn${post.viewer?.hasLiked ? " is-liked" : ""}" type="button"
                  data-feed-like="${feedEscapeHtml(post.id || "")}"
                  aria-pressed="${post.viewer?.hasLiked ? "true" : "false"}"
                  aria-label="${post.viewer?.hasLiked ? "좋아요 취소하기" : "좋아요 누르기"}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.5-9.5-9.5C1 8.5 3.5 5.5 7 5.5c2 0 3.5 1 5 2.5 1.5-1.5 3-2.5 5-2.5 3.5 0 6 3 4.5 6-2 5-9.5 9.5-9.5 9.5z" stroke="currentColor" fill="none" stroke-width="1.6"/></svg>
            <span data-feed-like-count>${Number(post.likeCount) || 0}</span>
          </button>
          <button class="feed-action-btn feed-comment-btn" type="button" data-feed-comment="${feedEscapeHtml(post.id || "")}" aria-label="댓글 보기">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v10H7l-3 3z" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linejoin="round"/></svg>
            <span>${Number(post.replyCount) || 0}</span>
          </button>
          ${editButton}
          ${deleteButton}
        </footer>
      </article>
    `;
  }).join("");

  // 카드 본문이 line-clamp(6줄)에 의해 잘렸는지 감지 → has-overflow 부여
  // .has-overflow일 때만 CSS가 더보기 버튼을 노출
  requestAnimationFrame(() => {
    root.querySelectorAll(".feed-post").forEach(post => {
      const body = post.querySelector(".feed-post-body");
      if (!body) return;
      // 잘림 여부 감지 — scrollHeight > clientHeight 이면 line-clamp 트리거됨
      if (body.scrollHeight > body.clientHeight + 4) {
        post.classList.add("has-overflow");
      }
    });
  });
}

function bindLuminaFeedTabs() {
  const tabs = document.querySelectorAll(".feed-tab");
  if (tabs.length === 0) return;
  tabs.forEach(tab => {
    tab.addEventListener("click", async () => {
      const filter = tab.dataset.feedFilter || "all";
      _luminaFeedFilter = filter;
      tabs.forEach(t => {
        const isActive = t.dataset.feedFilter === filter;
        t.classList.toggle("is-active", isActive);
        t.setAttribute("aria-selected", isActive ? "true" : "false");
      });
      if (filter === "all" || filter === "following") {
        await loadLuminaFeedData(filter);
      }
      renderLuminaFeed();
    });
  });
}

function initLuminaFeedSidebar() {
  const panel = document.querySelector(".feed-side-panel");
  if (!panel) return;
  const me = (typeof getAuth === "function") ? getAuth()?.user : null;
  const profileUrl = me ? buildUserProfileUrl(me) : "./mypage.html";
  const profileLink = document.getElementById("feedSideProfileLink");
  const nameEl = document.getElementById("feedSideName");
  const avatarEl = document.getElementById("feedSideAvatar");
  if (profileLink) profileLink.href = profileUrl;
  if (nameEl) nameEl.textContent = me?.displayName || me?.email?.split("@")[0] || "내 프로필";
  if (avatarEl) {
    const initial = (me?.displayName || me?.email || "?").charAt(0);
    if (me?.avatarUrl) {
      avatarEl.style.backgroundImage = `url('${String(me.avatarUrl).replace(/'/g, "%27")}')`;
      avatarEl.classList.add("has-image");
      avatarEl.textContent = "";
    } else {
      avatarEl.style.backgroundImage = "";
      avatarEl.classList.remove("has-image");
      avatarEl.textContent = initial;
    }
  }
  panel.querySelectorAll("[data-feed-side-link]").forEach(link => {
    const key = link.dataset.feedSideLink || "profile";
    link.href = key === "profile"
      ? profileUrl
      : `${profileUrl}${profileUrl.includes("?") ? "&" : "?"}tab=${encodeURIComponent(key)}`;
  });
}

function bindLuminaFeedSearch() {
  const input = document.getElementById("feedSearchInput");
  if (!input || input._bound) return;
  input._bound = true;
  input.addEventListener("input", () => {
    _luminaFeedQuery = input.value || "";
    renderLuminaFeed();
    clearTimeout(_luminaFeedSearchTimer);
    _luminaFeedSearchTimer = setTimeout(() => executeLuminaFeedSearch(_luminaFeedQuery), 360);
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(_luminaFeedSearchTimer);
      executeLuminaFeedSearch(input.value || "");
    }
  });
}

async function executeLuminaFeedSearch(query) {
  const q = String(query || "").trim();
  const seq = ++_luminaFeedSearchSeq;
  if (!q) {
    await loadLuminaFeedData(_luminaFeedScope);
    if (seq === _luminaFeedSearchSeq) renderLuminaFeed();
    return;
  }
  const type = q.startsWith("#") ? "hashtag" : "text";
  const language = feedLocaleToLanguage();
  try {
    const res = await apiFetch(`/api/v1/lumina-feed/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}&language=${encodeURIComponent(language)}&take=30`, {
      auth: typeof isLoggedIn === "function" && isLoggedIn()
    });
    if (seq !== _luminaFeedSearchSeq) return;
    const items = Array.isArray(res) ? res : (res?.items || res?.posts || []);
    _luminaFeedItems = Array.isArray(items) ? items.map(normalizeFeedPost) : [];
    _luminaFeedSource = "search";
    renderLuminaFeed();
  } catch (err) {
    console.warn("[Lumina feed search] 실패, 로컬 필터 유지:", err?.status, err?.message);
  }
}

function bindFeedDiscoveryClicks() {
  if (document._feedDiscoveryBound) return;
  document._feedDiscoveryBound = true;
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-feed-search-keyword]");
    if (!btn) return;
    e.preventDefault();
    const keyword = btn.dataset.feedSearchKeyword || "";
    const input = document.getElementById("feedSearchInput");
    if (input) input.value = keyword;
    _luminaFeedQuery = keyword;
    executeLuminaFeedSearch(keyword);
  });
}

function renderFeedTrendButtons(root, items, emptyText) {
  if (!root) return;
  if (!Array.isArray(items) || items.length === 0) {
    root.innerHTML = `<p class="feed-trend-empty">${feedEscapeHtml(emptyText)}</p>`;
    return;
  }
  root.innerHTML = items.map((item, idx) => {
    const keyword = item.keyword || item.normalizedKeyword || "";
    if (!keyword) return "";
    const count = item.searchCount ?? item.postCount ?? "";
    return `<button class="feed-trend-item" type="button" data-feed-search-keyword="${feedEscapeHtml(keyword)}">
      <span class="feed-trend-rank">${Number(item.rank || idx + 1)}</span>
      <span class="feed-trend-keyword">${feedEscapeHtml(keyword)}</span>
      ${count !== "" ? `<small>${Number(count).toLocaleString("ko-KR")}</small>` : ""}
    </button>`;
  }).join("");
}

async function initLuminaFeedDiscovery() {
  const trendRoot = document.getElementById("feedTrendList");
  const hashtagRoot = document.getElementById("feedHashtagList");
  if (!trendRoot && !hashtagRoot) return;
  bindFeedDiscoveryClicks();
  const language = feedLocaleToLanguage();
  const localeLabel = document.getElementById("feedTrendLocaleLabel");
  if (localeLabel) {
    localeLabel.textContent = ({ ko: "한국어", ja: "日本語", en: "English", zh: "中文" })[language] || "전체";
  }
  try {
    let res = await apiFetch(`/api/v1/lumina-feed/trending-searches?language=${encodeURIComponent(language)}&type=all&window=1h&take=10`);
    let items = Array.isArray(res) ? res : (res?.items || res?.keywords || []);
    if ((!items || items.length === 0) && language !== "all") {
      res = await apiFetch("/api/v1/lumina-feed/trending-searches?language=all&type=all&window=1h&take=10");
      items = Array.isArray(res) ? res : (res?.items || res?.keywords || []);
    }
    renderFeedTrendButtons(trendRoot, items, "아직 급상승 검색어가 없어요.");
  } catch (err) {
    console.warn("[Lumina feed trends] 실패:", err?.status, err?.message);
    renderFeedTrendButtons(trendRoot, [], "급상승 검색어를 불러오지 못했어요.");
  }
  try {
    let res = await apiFetch(`/api/v1/lumina-feed/hashtags?language=${encodeURIComponent(language)}&window=24h&take=12`);
    let items = Array.isArray(res) ? res : (res?.items || res?.hashtags || []);
    if ((!items || items.length === 0) && language !== "all") {
      res = await apiFetch("/api/v1/lumina-feed/hashtags?language=all&window=24h&take=12");
      items = Array.isArray(res) ? res : (res?.items || res?.hashtags || []);
    }
    renderFeedTrendButtons(hashtagRoot, items, "아직 발견된 해시태그가 없어요.");
  } catch (err) {
    console.warn("[Lumina feed hashtags] 실패:", err?.status, err?.message);
    renderFeedTrendButtons(hashtagRoot, [], "해시태그를 불러오지 못했어요.");
  }
}

/* #145 — 피드 카드 팔로우 토글 (차모 spec)
   - 아티스트: POST/DELETE /api/v1/artists/:artistId/follow
   - 유저: POST/DELETE /api/v1/users/:userId/follow
   - 응답에 followerCount 미포함이라 낙관적 토글만 (재조회는 다음 페이지 진입 시) */
function bindLuminaFeedFollow() {
  if (document._feedFollowBound) return;
  document._feedFollowBound = true;
  document.addEventListener("click", async e => {
    const btn = e.target.closest("[data-feed-follow-artist], [data-feed-follow-user]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (btn.dataset.busy === "1") return;
    if (typeof getAccessToken === "function" && !getAccessToken()) {
      alert("로그인하면 팔로우할 수 있어요.");
      return;
    }
    const isArtist = !!btn.dataset.feedFollowArtist;
    const id = isArtist ? btn.dataset.feedFollowArtist : btn.dataset.feedFollowUser;
    if (!id) return;
    const wasFollowing = btn.dataset.following === "1";
    const endpoint = isArtist
      ? `/api/v1/artists/${encodeURIComponent(id)}/follow`
      : `/api/v1/users/${encodeURIComponent(id)}/follow`;
    btn.dataset.busy = "1";
    // 낙관적 토글
    btn.classList.toggle("is-following", !wasFollowing);
    btn.dataset.following = wasFollowing ? "0" : "1";
    btn.textContent = wasFollowing ? "팔로우" : "팔로잉 해제";
    try {
      await apiFetch(endpoint, {
        method: wasFollowing ? "DELETE" : "POST",
        auth: true,
        throwOnError: true
      });
      // 같은 작성자/아티스트의 모든 카드 동기화
      document.querySelectorAll(
        isArtist
          ? `[data-feed-follow-artist="${id}"]`
          : `[data-feed-follow-user="${id}"]`
      ).forEach(b => {
        b.classList.toggle("is-following", !wasFollowing);
        b.dataset.following = wasFollowing ? "0" : "1";
        b.textContent = wasFollowing ? "팔로우" : "팔로잉 해제";
      });
    } catch (err) {
      // 롤백
      btn.classList.toggle("is-following", wasFollowing);
      btn.dataset.following = wasFollowing ? "1" : "0";
      btn.textContent = wasFollowing ? "팔로잉 해제" : "팔로우";
      console.warn("[#145 follow] 실패", { status: err?.status, body: err?.body });
      alert(err?.message || "팔로우 처리에 실패했어요.");
    } finally {
      btn.dataset.busy = "0";
    }
  });
}

const FEED_COMPOSE_MAX_IMAGES = 4;

const FEED_COMPOSE_MAX_BODY = 2000;

const FEED_COMPOSE_MAX_IMAGE_MB = 20;

const FEED_COMPOSE_MAX_IMAGE_BYTES = FEED_COMPOSE_MAX_IMAGE_MB * 1024 * 1024;

const FEED_ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const FEED_ALLOWED_IMAGE_LABEL = "JPG, PNG, WEBP, GIF";

let _feedComposeAssets = []; // [{ localId, status, file?, fileName, mimeType, fileSize, assetId?, previewUrl?, localPreviewUrl?, errorMessage?, stage? }]

let _feedComposeAssetSeq = 0;

function feedComposeNextLocalId() {
  _feedComposeAssetSeq += 1;
  return `feed-compose-${Date.now().toString(36)}-${_feedComposeAssetSeq}`;
}

function feedComposeDedupeKey(file) {
  return `${file.name}::${file.size}::${file.type}`;
}

function feedComposeHasPendingUpload() {
  return _feedComposeAssets.some(a => a.status === "uploading");
}

function feedComposeDoneAssets() {
  return _feedComposeAssets.filter(a => a.status === "done");
}

function formatFeedUploadSize(bytes = 0) {
  const mb = Number(bytes || 0) / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`;
}

function validateFeedComposeImage(file) {
  if (!FEED_ALLOWED_IMAGE_MIMES.includes(file.type)) {
    return `${FEED_ALLOWED_IMAGE_LABEL} 파일만 첨부할 수 있어요.`;
  }
  if (file.size > FEED_COMPOSE_MAX_IMAGE_BYTES) {
    return `이미지가 너무 큽니다. ${FEED_COMPOSE_MAX_IMAGE_MB}MB 이하 이미지를 올려주세요.`;
  }
  return "";
}

function feedAssetDisplayUrl(asset = {}, fallback = "") {
  const nested = asset.asset && typeof asset.asset === "object" ? asset.asset : {};
  const url = asset.displayUrl
    || asset.thumbnailUrl
    || asset.thumbUrl
    || asset.imageUrl
    || asset.url
    || asset.publicUrl
    || nested.displayUrl
    || nested.thumbnailUrl
    || nested.thumbUrl
    || nested.imageUrl
    || nested.url
    || nested.publicUrl
    || fallback;
  return url ? normalizeAssetUrl(url) : "";
}

function feedUploadErrorMessage(err, stage) {
  const msg = err?.body?.message || err?.message || "";
  const effectiveStage = stage || err?.stage || "";
  if (err?.status === 401) return "로그인이 만료됐어요. 다시 로그인해주세요.";
  if (/too large|payload|entity too large|file size|20MB/i.test(msg)) {
    return `이미지가 너무 큽니다. ${FEED_COMPOSE_MAX_IMAGE_MB}MB 이하 이미지를 올려주세요.`;
  }
  if (/unsupported|mime|file type|content-type/i.test(msg)) {
    return `지원하지 않는 파일 형식이에요. ${FEED_ALLOWED_IMAGE_LABEL} 파일로 다시 올려주세요.`;
  }
  if (/offline|failed to fetch|network/i.test(msg) || (typeof navigator !== "undefined" && navigator.onLine === false)) {
    return "인터넷 연결을 확인한 뒤 다시 시도해주세요.";
  }
  if (effectiveStage === "intent") {
    return "업로드 준비에 실패했어요. 잠시 후 다시 시도해주세요.";
  }
  if (effectiveStage === "direct-upload") {
    return "이미지 저장소 업로드에 실패했어요. 다시 시도해주세요.";
  }
  if (effectiveStage === "confirm") {
    return "업로드는 됐는데 확인 단계에서 실패했어요. 다시 시도해주세요.";
  }
  return "이미지를 업로드하지 못했어요. 잠시 후 다시 시도해주세요.";
}

function feedUploadShortLabel(stage) {
  if (stage === "intent") return "준비 실패";
  if (stage === "direct-upload") return "업로드 실패";
  if (stage === "confirm") return "확인 실패";
  return "업로드 실패";
}

function releaseFeedComposeAssetPreview(asset) {
  if (asset?.localPreviewUrl?.startsWith("blob:")) {
    try { URL.revokeObjectURL(asset.localPreviewUrl); } catch {}
  }
}

/* 카드의 이미지 그리드 렌더 (post.assets[].asset.url 기반) */

/* 작성창 전체 초기화 — 페이지 진입 시 1회 + 로그인 상태 변화 시 호출 */
function initFeedCompose() {
  const composeRoot = document.getElementById("feedCompose");
  const guestRoot = document.getElementById("feedComposeGuest");
  if (!composeRoot && !guestRoot) return; // 피드 페이지가 아님

  const loggedIn = isLoggedIn();
  if (composeRoot) composeRoot.hidden = !loggedIn;
  if (guestRoot) guestRoot.hidden = loggedIn;

  if (loggedIn) {
    syncFeedComposeAvatar();
    bindFeedComposeOnce();
  } else {
    // 비로그인 카드의 로그인 CTA
    if (guestRoot && !guestRoot._bound) {
      guestRoot._bound = true;
      guestRoot.querySelector('[data-action="login"]')?.addEventListener("click", e => {
        e.preventDefault();
        openAuthModal?.("login");
      });
    }
  }
}

function syncFeedComposeAvatar() {
  const avatarRoot = document.getElementById("feedComposeAvatar");
  if (!avatarRoot) return;
  const auth = getAuth?.();
  const user = auth?.user || {};
  const name = user.displayName || user.email?.split("@")[0] || "?";
  const initial = name.charAt(0);
  const avatarUrl = user.avatarUrl || user.avatarAsset?.url || "";
  if (avatarUrl) {
    avatarRoot.innerHTML = `<img src="${feedEscapeHtml(avatarUrl)}" alt="${feedEscapeHtml(name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><span class="feed-compose-avatar-fallback" style="display:none;">${feedEscapeHtml(initial)}</span>`;
  } else {
    avatarRoot.innerHTML = `<span class="feed-compose-avatar-fallback">${feedEscapeHtml(initial)}</span>`;
  }
}

function bindFeedComposeOnce() {
  const composeRoot = document.getElementById("feedCompose");
  if (!composeRoot || composeRoot._bound) return;
  composeRoot._bound = true;

  const textarea = document.getElementById("feedComposeText");
  const counter = document.getElementById("feedComposeCounter");
  const submitBtn = document.getElementById("feedComposeSubmit");
  const fileInput = document.getElementById("feedComposeFile");
  const attachBtn = composeRoot.querySelector(".feed-compose-attach-btn");
  const attachLabel = attachBtn?.querySelector("span");
  if (attachBtn) {
    attachBtn.title = `이미지 첨부 (${FEED_ALLOWED_IMAGE_LABEL}, 장당 ${FEED_COMPOSE_MAX_IMAGE_MB}MB 이하)`;
    attachBtn.setAttribute("aria-label", `이미지 첨부. ${FEED_ALLOWED_IMAGE_LABEL}, 장당 ${FEED_COMPOSE_MAX_IMAGE_MB}MB 이하`);
  }
  if (attachLabel) attachLabel.textContent = `이미지 · ${FEED_COMPOSE_MAX_IMAGE_MB}MB 이하`;

  // 글자수 + 제출 가능 여부
  const updateState = () => {
    const len = textarea.value.length;
    if (counter) counter.textContent = `${len} / ${FEED_COMPOSE_MAX_BODY}`;
    const uploading = feedComposeHasPendingUpload();
    const doneCount = feedComposeDoneAssets().length;
    const hasContent = textarea.value.trim().length > 0 || doneCount > 0;
    if (submitBtn) submitBtn.disabled = !hasContent || uploading;
    if (fileInput) fileInput.disabled = uploading || _feedComposeAssets.length >= FEED_COMPOSE_MAX_IMAGES;
    if (attachBtn) {
      attachBtn.dataset.uploading = uploading ? "1" : "0";
      attachBtn.dataset.full = _feedComposeAssets.length >= FEED_COMPOSE_MAX_IMAGES ? "1" : "0";
    }
  };

  textarea?.addEventListener("input", updateState);

  // 파일 선택 → 업로드
  fileInput?.addEventListener("change", async e => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // 같은 파일 다시 선택 가능하게
    if (files.length === 0) return;

    if (feedComposeHasPendingUpload()) {
      setFeedComposeMessage("업로드 중인 이미지가 있어요. 잠시 후 다시 시도해주세요.", "warn");
      return;
    }

    const remaining = FEED_COMPOSE_MAX_IMAGES - _feedComposeAssets.length;
    if (remaining <= 0) {
      setFeedComposeMessage(`이미지는 최대 ${FEED_COMPOSE_MAX_IMAGES}장까지 첨부할 수 있어요.`, "warn");
      return;
    }

    // 중복(파일명 + 크기 + 타입) 필터링 — 이미 첨부됐거나 업로드 실패로 남아 있는 항목 제외
    const existingKeys = new Set(_feedComposeAssets.map(a => a.dedupeKey).filter(Boolean));
    const dedupedAll = [];
    let duplicateCount = 0;
    for (const file of files) {
      const key = feedComposeDedupeKey(file);
      if (existingKeys.has(key)) {
        duplicateCount += 1;
        continue;
      }
      existingKeys.add(key);
      dedupedAll.push(file);
    }
    if (duplicateCount > 0 && dedupedAll.length === 0) {
      setFeedComposeMessage("이미 추가된 이미지예요.", "warn");
      return;
    }

    const accepted = dedupedAll.slice(0, remaining);
    if (duplicateCount > 0) {
      setFeedComposeMessage(`중복된 ${duplicateCount}장은 빼고 ${accepted.length}장을 추가할게요.`, "info");
    } else if (files.length > accepted.length) {
      setFeedComposeMessage(`이미지는 최대 ${FEED_COMPOSE_MAX_IMAGES}장까지 첨부할 수 있어요. ${accepted.length}장만 추가했어요.`, "warn");
    }

    for (const file of accepted) {
      const validationMessage = validateFeedComposeImage(file);
      if (validationMessage) {
        setFeedComposeMessage(validationMessage, "warn");
        continue;
      }
      await uploadFeedComposeImage(file, updateState);
    }
    updateState();
  });

  // 제출
  submitBtn?.addEventListener("click", async () => {
    if (submitBtn.disabled) return;
    const body = (textarea?.value || "").trim();
    if (feedComposeHasPendingUpload()) {
      setFeedComposeMessage("이미지 업로드가 끝난 뒤에 게시할 수 있어요.", "warn");
      return;
    }
    const doneAssets = feedComposeDoneAssets();
    const failedCount = _feedComposeAssets.filter(a => a.status === "failed").length;
    if (!body && doneAssets.length === 0) {
      const reason = failedCount > 0
        ? "업로드에 실패한 이미지는 게시할 수 없어요. 다시 시도하거나 삭제해주세요."
        : "내용 또는 이미지를 추가해주세요.";
      setFeedComposeMessage(reason, "warn");
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "게시 중";
    try {
      const payload = { body };
      if (doneAssets.length > 0) {
        payload.assetIds = doneAssets.map(a => a.assetId);
      }
      // #089 — 본문에서 첫 https URL 자동 감지 → externalUrl로 함께 전송 (백엔드가 metadata 저장)
      const urlMatch = body.match(/\bhttps:\/\/[^\s)\]]+/i);
      if (urlMatch) {
        payload.externalUrl = urlMatch[0];
      }
      await apiFetch("/api/v1/lumina-feed/posts", {
        method: "POST",
        auth: true,
        throwOnError: true,
        body: payload
      });
      // 성공 → 작성창 초기화 + 피드 새로고침
      textarea.value = "";
      _feedComposeAssets.forEach(releaseFeedComposeAssetPreview);
      _feedComposeAssets = [];
      renderFeedComposeThumbs();
      if (failedCount > 0) {
        setFeedComposeMessage(`피드에 올라갔어요. 실패한 이미지 ${failedCount}장은 포함되지 않았어요.`, "success");
      } else {
        setFeedComposeMessage("피드에 올라갔어요.", "success");
      }
      updateState();
      // 피드 다시 로드
      await loadLuminaFeedData(_luminaFeedFilter || "all");
      renderLuminaFeed();
    } catch (err) {
      const msg = err?.body?.message || err?.message || "";
      let userMsg = "게시하지 못했어요. 잠시 후 다시 시도해주세요.";
      if (/Policy violation|forbidden|too long|too short/i.test(msg)) {
        userMsg = "정책에 맞지 않는 내용이 포함되어 있어요. 표현을 수정해 주세요.";
      } else if (err?.status === 401) {
        userMsg = "로그인이 만료됐어요. 다시 로그인해주세요.";
      }
      setFeedComposeMessage(userMsg, "warn");
    } finally {
      submitBtn.textContent = "게시하기";
      updateState();
    }
  });

  // 썸네일 영역 — 제거/재시도 버튼 위임
  const thumbs = document.getElementById("feedComposeThumbs");
  thumbs?.addEventListener("click", async e => {
    const removeBtn = e.target.closest("[data-feed-thumb-remove]");
    if (removeBtn) {
      const localId = removeBtn.dataset.feedThumbRemove;
      const idx = _feedComposeAssets.findIndex(a => a.localId === localId);
      if (idx >= 0) {
        const item = _feedComposeAssets[idx];
        if (item.status === "uploading") {
          // 진행 중인 업로드는 취소하지 않고 안내만 — assetId/네트워크 정합성 보호
          setFeedComposeMessage("업로드가 끝난 뒤 삭제할 수 있어요.", "warn");
          return;
        }
        _feedComposeAssets.splice(idx, 1);
        releaseFeedComposeAssetPreview(item);
        renderFeedComposeThumbs();
        updateState();
      }
      return;
    }
    const retryBtn = e.target.closest("[data-feed-thumb-retry]");
    if (retryBtn) {
      const localId = retryBtn.dataset.feedThumbRetry;
      const idx = _feedComposeAssets.findIndex(a => a.localId === localId);
      if (idx < 0) return;
      const item = _feedComposeAssets[idx];
      if (item.status !== "failed" || !item.file) return;
      await retryFeedComposeUpload(item, updateState);
    }
  });

  updateState();
}

function setFeedComposeMessage(text, kind) {
  const el = document.getElementById("feedComposeMessage");
  if (!el) return;
  if (!text) { el.hidden = true; el.textContent = ""; return; }
  el.hidden = false;
  el.textContent = text;
  el.dataset.kind = kind || "info";
  // success는 잠시 후 자동 숨김
  if (kind === "success") {
    setTimeout(() => {
      if (el.dataset.kind === "success") { el.hidden = true; el.textContent = ""; }
    }, 2400);
  }
}

function renderFeedComposeThumbs() {
  const thumbs = document.getElementById("feedComposeThumbs");
  if (!thumbs) return;
  if (_feedComposeAssets.length === 0) {
    thumbs.hidden = true;
    thumbs.innerHTML = "";
    return;
  }
  thumbs.hidden = false;
  thumbs.innerHTML = _feedComposeAssets.map(asset => {
    const status = asset.status || "done";
    const localId = feedEscapeHtml(asset.localId || "");
    const fileNameLabel = feedEscapeHtml(asset.fileName || "이미지");
    const previewSrc = feedEscapeHtml(asset.previewUrl || asset.localPreviewUrl || "");
    const localFallback = feedEscapeHtml(asset.localPreviewUrl || "");
    const removeLabel = status === "uploading" ? "삭제(업로드 중)" : "이미지 삭제";
    let overlay = "";
    if (status === "uploading") {
      overlay = `
        <div class="feed-compose-thumb-state" data-state="uploading" role="status" aria-live="polite">
          <span class="feed-compose-thumb-spinner" aria-hidden="true"></span>
          <span class="feed-compose-thumb-state-label">업로드 중</span>
        </div>`;
    } else if (status === "failed") {
      const errorMessage = feedEscapeHtml(asset.errorMessage || "업로드 실패");
      const shortLabel = feedEscapeHtml(feedUploadShortLabel(asset.stage));
      overlay = `
        <div class="feed-compose-thumb-state" data-state="failed" role="alert">
          <span class="feed-compose-thumb-state-label">${shortLabel}</span>
          <span class="feed-compose-thumb-state-detail">${errorMessage}</span>
          <button type="button" class="feed-compose-thumb-retry" data-feed-thumb-retry="${localId}">다시 시도</button>
        </div>`;
    }
    const previewImg = previewSrc
      ? `<img src="${previewSrc}" data-local-src="${localFallback}" alt="${fileNameLabel}" onerror="if(this.dataset.localSrc&&this.src!==this.dataset.localSrc){this.src=this.dataset.localSrc;}else{this.parentElement.classList.add('is-broken');this.style.display='none';}" />`
      : `<span class="feed-compose-thumb-fallback" aria-hidden="true">이미지</span>`;
    return `
      <div class="feed-compose-thumb" data-status="${status}" data-local-id="${localId}">
        ${previewImg}
        ${overlay}
        <button type="button" class="feed-compose-thumb-remove" data-feed-thumb-remove="${localId}" aria-label="${removeLabel}">×</button>
      </div>
    `;
  }).join("");
}

/* 단일 업로드 항목을 추가하고 3단계 업로드를 실행. 실패 시 항목을 failed 상태로 유지해 재시도 가능 */
async function uploadFeedComposeImage(file, onStateChange) {
  const item = {
    localId: feedComposeNextLocalId(),
    status: "uploading",
    file,
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
    dedupeKey: feedComposeDedupeKey(file),
    localPreviewUrl: URL.createObjectURL(file),
    previewUrl: "",
    assetId: "",
    errorMessage: "",
    stage: ""
  };
  item.previewUrl = item.localPreviewUrl;
  _feedComposeAssets.push(item);
  renderFeedComposeThumbs();
  onStateChange?.();
  await runFeedComposeUploadStages(item, onStateChange);
}

async function retryFeedComposeUpload(item, onStateChange) {
  if (!item || !item.file) return;
  item.status = "uploading";
  item.errorMessage = "";
  item.stage = "";
  if (!item.localPreviewUrl) {
    try { item.localPreviewUrl = URL.createObjectURL(item.file); } catch {}
    item.previewUrl = item.localPreviewUrl;
  }
  renderFeedComposeThumbs();
  onStateChange?.();
  await runFeedComposeUploadStages(item, onStateChange);
}

async function runFeedComposeUploadStages(item, onStateChange) {
  const sizeLabel = formatFeedUploadSize(item.fileSize || item.file?.size || 0);
  let stage = "intent";
  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const offlineErr = new Error("offline");
      offlineErr.stage = "intent";
      throw offlineErr;
    }
    setFeedComposeMessage(`${item.fileName} 업로드 준비 중… (${sizeLabel} / ${FEED_COMPOSE_MAX_IMAGE_MB}MB)`, "info");

    // 1. intent 생성
    const intent = await apiFetch("/api/v1/me/assets/upload-intents", {
      method: "POST",
      auth: true,
      throwOnError: true,
      body: {
        fileName: item.fileName,
        mimeType: item.mimeType,
        fileSizeBytes: item.fileSize
      }
    });
    if (!intent?.asset?.id || !intent?.upload) {
      const intentErr = new Error("Invalid upload intent response");
      intentErr.stage = "intent";
      throw intentErr;
    }
    const assetId = intent.asset.id;
    const upload = intent.upload;
    item.assetId = assetId;

    // 2. 파일 업로드 (S3/R2 direct upload)
    if (upload.mode === "direct_upload_ready" && upload.url) {
      stage = "direct-upload";
      setFeedComposeMessage(`${item.fileName} 이미지 저장소에 업로드 중… (${sizeLabel} / ${FEED_COMPOSE_MAX_IMAGE_MB}MB)`, "info");
      const headers = upload.requiredHeaders || {};
      const putRes = await fetch(upload.url, {
        method: upload.method || "PUT",
        headers,
        body: item.file
      });
      if (!putRes.ok) {
        const uploadError = new Error(`Upload failed (${putRes.status})`);
        uploadError.stage = "direct-upload";
        uploadError.status = putRes.status;
        throw uploadError;
      }
    }
    // local mode (metadata_only)는 PUT 없이 confirm으로 바로 진행

    // 3. confirm
    stage = "confirm";
    setFeedComposeMessage(`${item.fileName} 업로드 확인 중…`, "info");
    const confirmed = await apiFetch(`/api/v1/me/assets/${encodeURIComponent(assetId)}/confirm-upload`, {
      method: "POST",
      auth: true,
      throwOnError: true,
      body: {}
    });
    const finalAsset = confirmed?.asset || confirmed;
    item.previewUrl = feedAssetDisplayUrl(finalAsset, item.localPreviewUrl);
    item.status = "done";
    item.errorMessage = "";
    item.stage = "";
    renderFeedComposeThumbs();
    setFeedComposeMessage(`${item.fileName} 업로드 완료`, "success");
  } catch (err) {
    const failedStage = err?.stage || stage;
    item.status = "failed";
    item.stage = failedStage;
    item.errorMessage = feedUploadErrorMessage(err, failedStage);
    // S3 키/서명 URL 노출 금지 — 사용자 메시지에만 의존
    console.warn("[#299 feed upload]", { stage: failedStage, status: err?.status || null });
    renderFeedComposeThumbs();
    setFeedComposeMessage(item.errorMessage, "warn");
  } finally {
    onStateChange?.();
  }
}


/* ── 상태 메타 ──────────────────────────────── */

  window.loadLuminaFeedData = loadLuminaFeedData;
  window.initLuminaFeedSidebar = initLuminaFeedSidebar;
  window.bindLuminaFeedSearch = bindLuminaFeedSearch;
  window.initLuminaFeedDiscovery = initLuminaFeedDiscovery;
  window.renderLuminaFeed = renderLuminaFeed;
  window.bindLuminaFeedTabs = bindLuminaFeedTabs;
  window.bindLuminaFeedFollow = bindLuminaFeedFollow;
  window.initFeedCompose = initFeedCompose;
})();
