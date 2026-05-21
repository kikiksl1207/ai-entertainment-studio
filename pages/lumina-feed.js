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

// #358 — repost 원글 reference card 렌더. originalPost가 있으면 임베드, tombstone이면 안전 안내.
// 원문 body는 backend가 tombstone/hidden/private/blocked 케이스에서 null로 내려주므로 그대로 표시해도 안전.
function renderFeedRepostSource(repost) {
  if (!repost || typeof repost !== "object") return "";
  if (!repost.isRepost) return "";
  // tombstone / 비공개 / 차단 케이스
  if (repost.tombstone || repost.originalState === "unavailable" || !repost.originalPost) {
    var reasonLabel = "원글을 볼 수 없어요";
    var unavailable = repost.unavailableReason || "";
    var subnote = unavailable === "deleted" ? "원글이 삭제됐어요."
      : unavailable === "hidden" ? "원글이 운영자에 의해 숨겨졌어요."
      : unavailable === "private" ? "원글이 비공개 처리됐어요."
      : unavailable === "blocked" ? "차단된 사용자의 글이라 원글이 표시되지 않아요."
      : "원글이 더 이상 제공되지 않아요.";
    return (
      '<aside class="feed-post-repost-source is-tombstone" aria-label="원글 참조 (표시 불가)">' +
        '<span class="feed-post-repost-eyebrow">원글 참조</span>' +
        '<strong class="feed-post-repost-tombstone-title">' + feedEscapeHtml(reasonLabel) + '</strong>' +
        '<p class="feed-post-repost-tombstone-body">' + feedEscapeHtml(subnote) + '</p>' +
      '</aside>'
    );
  }
  var orig = repost.originalPost || {};
  var origAuthor = orig.authorName || orig.author?.displayName || orig.author?.nickname || "Lumina 사용자";
  var origBody = orig.body || orig.content || "";
  var origId = orig.id || repost.originalPostId || "";
  var origUrl = origId ? ("/lumina-feed?postId=" + encodeURIComponent(String(origId))) : "/lumina-feed";
  return (
    '<aside class="feed-post-repost-source" aria-label="원글 참조">' +
      '<span class="feed-post-repost-eyebrow">원글 참조</span>' +
      '<div class="feed-post-repost-source-head">' +
        '<strong>' + feedEscapeHtml(origAuthor) + '</strong>' +
        '<a class="feed-post-repost-source-link" href="' + feedEscapeHtml(origUrl) + '">원글 보기 →</a>' +
      '</div>' +
      '<p class="feed-post-repost-source-body">' + feedEscapeHtml(origBody) + '</p>' +
    '</aside>'
  );
}

// #358 — thread continuation 카드를 root 카드 뒤에 묶어주는 reorder.
// 원본 순서(보통 최신순)는 유지하면서 continuation만 root 바로 뒤로 이동시킨다.
// continuation의 rootPostId가 visible list에 없으면 원래 위치 유지(고아 방지).
function sortFeedListWithThreadContinuations(list) {
  if (!Array.isArray(list) || list.length <= 1) return list;
  var indexById = Object.create(null);
  list.forEach(function (post, idx) {
    if (post && post.id) indexById[String(post.id)] = idx;
  });
  var grouped = [];
  var consumed = Object.create(null);
  list.forEach(function (post, idx) {
    if (consumed[idx]) return;
    var continuation = post && post.threadContinuation;
    var rootId = continuation && (continuation.rootPostId || continuation.parentPostId);
    var isContinuation = !!(continuation && (continuation.isContinuation || rootId));
    // continuation이고 root가 같은 list에 존재 + root 인덱스가 이 위치보다 앞이면 이미 root 다음에 배치됨.
    // root가 뒤에 있거나 같은 그룹에서 처음 만나는 root면 root + 모든 continuation 묶음을 push.
    if (isContinuation && rootId != null && indexById[String(rootId)] != null) {
      // root를 아직 안 넣었으면 우선 root 발견 위치까지 진행하지 말고 skip — root 차례에 묶을 것.
      // 단, root가 visible list 범위 밖이면 자기만 push (예외적 케이스).
      return;
    }
    grouped.push(post);
    consumed[idx] = true;
    // 이 post가 root 후보 → 자신을 root로 가진 continuation들을 같이 push (원본 순서대로).
    list.forEach(function (other, otherIdx) {
      if (consumed[otherIdx]) return;
      var oc = other && other.threadContinuation;
      var oRoot = oc && (oc.rootPostId || oc.parentPostId);
      if (oc && (oc.isContinuation || oRoot) && oRoot != null && String(oRoot) === String(post.id)) {
        grouped.push(other);
        consumed[otherIdx] = true;
      }
    });
  });
  // root 없는 continuation들은 마지막에 그대로 (rare)
  list.forEach(function (post, idx) {
    if (!consumed[idx]) grouped.push(post);
  });
  return grouped;
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

  const baseList = (_luminaFeedFilter === "all" || _luminaFeedFilter === "following")
    ? _luminaFeedItems
    : _luminaFeedItems.filter(p => p.postType === _luminaFeedFilter);
  // #358 — thread continuation 카드는 root 바로 뒤에 묶여서 X-style 하위 타래로 보이도록 reorder.
  // 원본 시간순(보통 최신순)은 그대로 두되, continuation 만 root post id 뒤로 이동시킨다.
  const list = sortFeedListWithThreadContinuations(baseList);
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
      ? ` clickable-card" data-href="/character-detail?slug=${artist.slug}`
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
          ? `/user-profile?handle=${encodeURIComponent(me.publicHandle)}`
          : `/user-profile?id=${encodeURIComponent(String(me.id))}`;
        authorLink = buildMiniProfileAuthorAttrs({
          target,
          handle: me.publicHandle,
          userId: me.id
        });
      } else if (post.authorPublicHandle || post.authorUserId) {
        const target = post.authorPublicHandle
          ? `/user-profile?handle=${encodeURIComponent(post.authorPublicHandle)}`
          : `/user-profile?id=${encodeURIComponent(String(post.authorUserId))}`;
        authorLink = buildMiniProfileAuthorAttrs({
          target,
          handle: post.authorPublicHandle,
          userId: post.authorUserId
        });
      }
      // 위 둘 다 안 맞으면 authorLink는 "" → 작성자 영역 클릭 비활성화 (헛클릭 방지)
    }

    // #358 — thread continuation 시각화: X-style 좌측 세로 연결선 + 들여쓰기, "이어쓴 글" 배지.
    const isThreadContinuation = !!(post.threadContinuation && (post.threadContinuation.isContinuation || post.threadContinuation.rootPostId));
    const continuationRootId = isThreadContinuation
      ? (post.threadContinuation.rootPostId || post.threadContinuation.parentPostId || "")
      : "";
    const continuationClass = isThreadContinuation ? " feed-post-continuation is-thread-continuation" : "";
    const continuationConnector = isThreadContinuation
      ? '<span class="feed-post-continuation-connector" aria-hidden="true"></span>'
        + '<span class="feed-post-continuation-badge" data-continuation-root="' + feedEscapeHtml(continuationRootId) + '">이어쓴 글</span>'
      : "";

    // #358 — repost 카드 안에 원글 reference embed. tombstone 케이스도 안전 안내.
    const repostEmbed = renderFeedRepostSource(post.repost);

    return `
      <article class="feed-post${clickable}${continuationClass}" data-feed-type="${post.postType}"${isThreadContinuation ? ' data-feed-continuation-root="' + feedEscapeHtml(continuationRootId) + '"' : ""}>
        ${continuationConnector}
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
        ${repostEmbed}
        ${renderFeedPostThreadBadge(post)}
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
          <!-- #357 — 타래 잇기: 작성된 글 아래에 이어지는 piece를 POST로 추가. -->
          <button class="feed-action-btn feed-thread-extend-btn" type="button"
                  data-feed-thread-extend="${feedEscapeHtml(post.id || "")}"
                  aria-label="이 글에 타래 이어 쓰기">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v14a3 3 0 0 0 3 3h7" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round"/><circle cx="7" cy="4" r="2" stroke="currentColor" fill="none" stroke-width="1.6"/><circle cx="17" cy="21" r="2" stroke="currentColor" fill="none" stroke-width="1.6"/></svg>
            <span>타래 잇기</span>
          </button>
          <!-- #357 — 리포스트: 원글 참조 카드 + 내 코멘트. 단순 복사가 아니라 referenceCard 유지. -->
          <button class="feed-action-btn feed-repost-btn" type="button"
                  data-feed-repost="${feedEscapeHtml(post.id || "")}"
                  aria-label="이 글 리포스트하기">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3l4 4-4 4M3 14l4 4 4-4M21 7H8a4 4 0 0 0-4 4v3M3 17h13a4 4 0 0 0 4-4v-3" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>리포스트</span>
          </button>
          <!-- #356 — 공유: Web Share 우선, 미지원 시 클립보드 fallback. POST/wallet/settlement mutation 0. -->
          <button class="feed-action-btn feed-share-btn" type="button"
                  data-feed-share="${feedEscapeHtml(post.id || "")}"
                  aria-label="이 글 공유하기">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 9l5-5m0 0v4m0-4h-4M10 15l-5 5m0 0v-4m0 4h4" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 4l-7 7M5 20l7-7" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round"/></svg>
            <span>공유</span>
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
  const profileUrl = me ? buildUserProfileUrl(me) : "/mypage";
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

const FEED_COMPOSE_MAX_BODY = 500;

// 백엔드 /api/v1/lumina-feed/posts contract — 501자 이상이면 HTTP 400. 큐알 QA 2026-05-19 확인.

// #309 — 타래 정책 (차모 2026-05-19 확정): 조각당 500자, root 포함 최대 10조각, 총 5000자.
// 백엔드 POST /lumina-feed/posts/thread 계약에 맞춰 사용자가 직접 나눈 조각만 제출한다.
const FEED_THREAD_MAX_ITEMS = 10;
const FEED_THREAD_AGGREGATE_MAX = 5000;
const FEED_THREAD_ITEM_MAX_BODY = FEED_COMPOSE_MAX_BODY;

const FEED_COMPOSE_MAX_IMAGE_MB = 20;

const FEED_COMPOSE_MAX_IMAGE_BYTES = FEED_COMPOSE_MAX_IMAGE_MB * 1024 * 1024;

const FEED_ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const FEED_ALLOWED_IMAGE_LABEL = "JPG, PNG, WEBP, GIF";

let _feedComposeAssets = []; // [{ localId, status, file?, fileName, mimeType, fileSize, assetId?, previewUrl?, localPreviewUrl?, errorMessage?, stage? }]

let _feedComposeAssetSeq = 0;

// #309 — 타래 모드 상태. POST /api/v1/lumina-feed/posts/thread 계약으로 게시.
let _feedComposeThreadMode = false;
let _feedComposeThreadItems = []; // [{ localId, body }]
let _feedComposeThreadItemSeq = 0;
// #333 — 단문 게시 후 "이어서 쓰기" CTA에서 사용할 직전 본문 캐시. 자동 분할/자동 게시는 하지 않고 사용자가 다시 누를 때만 채워 넣는다.
let _feedComposeLastSubmittedBody = "";

function feedComposeNextThreadLocalId() {
  _feedComposeThreadItemSeq += 1;
  return `feed-thread-${Date.now().toString(36)}-${_feedComposeThreadItemSeq}`;
}

function feedThreadAggregateLength(rootBodyLen) {
  return _feedComposeThreadItems.reduce((sum, it) => sum + (it.body?.length || 0), Number(rootBodyLen) || 0);
}

function feedThreadItemCount() {
  // root 1개 + 이어글 N개
  return 1 + _feedComposeThreadItems.length;
}

function feedThreadCleanItems(rootBody) {
  return [
    { body: String(rootBody || "").trim() },
    ..._feedComposeThreadItems.map(item => ({ body: String(item.body || "").trim() }))
  ];
}

function feedThreadValidation(rootBody) {
  const items = feedThreadCleanItems(rootBody);
  const aggregate = items.reduce((sum, item) => sum + item.body.length, 0);
  if (!items[0].body) {
    return { ok: false, message: "타래의 첫 글을 입력해 주세요." };
  }
  if (items.length < 2) {
    return { ok: false, message: "이어글을 1개 이상 추가해 주세요." };
  }
  if (items.length > FEED_THREAD_MAX_ITEMS) {
    return { ok: false, message: `타래는 첫 글 포함 ${FEED_THREAD_MAX_ITEMS}개까지 작성할 수 있어요.` };
  }
  const invalidIndex = items.findIndex(item => !item.body || item.body.length > FEED_THREAD_ITEM_MAX_BODY);
  if (invalidIndex >= 0) {
    return {
      ok: false,
      message: `${invalidIndex + 1}번째 조각을 1-${FEED_THREAD_ITEM_MAX_BODY}자로 맞춰 주세요.`
    };
  }
  if (aggregate > FEED_THREAD_AGGREGATE_MAX) {
    return { ok: false, message: `타래 전체는 ${FEED_THREAD_AGGREGATE_MAX}자까지 작성할 수 있어요.` };
  }
  return { ok: true, items, aggregate };
}

function feedThreadPostPayload(rootBody) {
  const validation = feedThreadValidation(rootBody);
  if (!validation.ok) return validation;
  const payload = { items: validation.items };
  const doneAssets = feedComposeDoneAssets();
  if (doneAssets.length > 0) {
    payload.assetIds = doneAssets.map(a => a.assetId);
  }
  const allText = validation.items.map(item => item.body).join(" ");
  const urlMatch = allText.match(/\bhttps:\/\/[^\s)\]]+/i);
  if (urlMatch) {
    payload.externalUrl = urlMatch[0];
  }
  return { ...validation, payload };
}

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

/* 피드 게시 실패 문구 매핑 — 비로그인/권한/네트워크/validation/용량/속도/서버 분기 */
function feedComposeSubmitErrorMessage(err) {
  const msg = err?.body?.message || err?.message || "";
  const status = err?.status;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "인터넷 연결을 확인한 뒤 다시 시도해주세요. 작성한 내용은 그대로 남아 있어요.";
  }
  if (status === 401) {
    return "로그인이 만료됐어요. 다시 로그인하면 작성한 내용을 그대로 올릴 수 있어요.";
  }
  if (status === 403) {
    return "지금은 이 글을 게시할 수 없어요. 권한 확인 후 다시 시도해주세요.";
  }
  if (status === 413 || /payload too large|entity too large|too large/i.test(msg)) {
    return "내용 또는 첨부 파일이 너무 커요. 글자나 이미지를 줄인 뒤 다시 시도해주세요.";
  }
  if (status === 429) {
    return "너무 자주 게시하고 있어요. 잠시 후 다시 시도해주세요.";
  }
  if (typeof status === "number" && status >= 500) {
    return "서버 연결이 일시적으로 불안정해요. 잠시 후 다시 시도해주세요.";
  }
  if (/too long/i.test(msg)) {
    return `본문은 ${FEED_COMPOSE_MAX_BODY}자 이하로 작성해주세요.`;
  }
  if (/too short|empty|required/i.test(msg)) {
    return "내용을 더 입력하거나 이미지를 추가해주세요.";
  }
  if (/policy violation|forbidden|profanity|disallowed|invalid/i.test(msg)) {
    return "정책에 맞지 않는 표현이 있어요. 내용을 수정한 뒤 다시 시도해주세요.";
  }
  if (status === 400 || /validation|invalid body/i.test(msg)) {
    return "내용을 다시 확인해 주세요. 일부 입력이 올바르지 않아요.";
  }
  if (/failed to fetch|network|timeout/i.test(msg)) {
    return "네트워크가 불안정해요. 연결을 확인한 뒤 다시 시도해주세요.";
  }
  return "게시하지 못했어요. 잠시 후 다시 시도해주세요. 작성한 내용은 그대로 남아 있어요.";
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
    bindFeedThreadFollowupCta();
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
    if (counter) {
      counter.textContent = `${len} / ${FEED_COMPOSE_MAX_BODY}`;
      const warnThreshold = Math.ceil(FEED_COMPOSE_MAX_BODY * 0.9);
      let state = "ok";
      if (len >= FEED_COMPOSE_MAX_BODY) state = "danger";
      else if (len >= warnThreshold) state = "warn";
      counter.dataset.state = state;
      if (state === "danger") {
        counter.setAttribute("title", `${FEED_COMPOSE_MAX_BODY}자까지 작성할 수 있어요. 더 쓰려면 줄여주세요.`);
      } else if (state === "warn") {
        counter.setAttribute("title", `${FEED_COMPOSE_MAX_BODY - len}자 남았어요.`);
      } else {
        counter.removeAttribute("title");
      }
    }
    const uploading = feedComposeHasPendingUpload();
    const doneCount = feedComposeDoneAssets().length;
    const hasContent = textarea.value.trim().length > 0 || doneCount > 0;
    const overLimit = len > FEED_COMPOSE_MAX_BODY; // maxlength로 막히지만 paste/조합 안전망
    const threadToggle = document.getElementById("feedComposeThreadToggle");
    if (threadToggle) {
      threadToggle.dataset.suggested = overLimit && !_feedComposeThreadMode ? "1" : "0";
    }
    const messageEl = document.getElementById("feedComposeMessage");
    if (overLimit && !_feedComposeThreadMode) {
      setFeedComposeMessage(
        `500자를 넘었어요. 첫 글은 ${FEED_COMPOSE_MAX_BODY}자 안으로 줄이고, 이어지는 내용은 타래로 이어쓰기에서 직접 나눠 주세요.`,
        "warn",
        "thread-over-limit"
      );
    } else if (messageEl?.dataset.reason === "thread-over-limit") {
      setFeedComposeMessage("");
    }
    // #309 — 타래 모드일 때는 단문 게시 버튼 비활성 (게시는 타래 submit 버튼이 담당)
    if (submitBtn) submitBtn.disabled = !hasContent || uploading || overLimit || _feedComposeThreadMode;
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
    if (!isLoggedIn?.()) {
      setFeedComposeMessage("로그인 후 작성할 수 있어요.", "warn");
      return;
    }
    const rawBody = textarea?.value || "";
    const body = rawBody.trim();
    if (feedComposeHasPendingUpload()) {
      setFeedComposeMessage("이미지 업로드가 끝난 뒤에 게시할 수 있어요.", "warn");
      return;
    }
    if (rawBody.length > FEED_COMPOSE_MAX_BODY) {
      setFeedComposeMessage(`본문은 ${FEED_COMPOSE_MAX_BODY}자 이하로 작성해주세요. (현재 ${rawBody.length}자)`, "warn");
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
      // #309 — 단문 게시 성공 시 타래 모드 상태도 정리 (이번 작성에 쓰지 않은 잔여 상태가 다음 게시에 끼지 않게)
      _feedComposeThreadMode = false;
      _feedComposeThreadItems = [];
      const threadComposerEl = document.getElementById("feedThreadComposer");
      if (threadComposerEl) threadComposerEl.hidden = true;
      const threadToggleEl = document.getElementById("feedComposeThreadToggle");
      if (threadToggleEl) {
        threadToggleEl.classList.remove("is-active");
        threadToggleEl.setAttribute("aria-pressed", "false");
      }
      renderFeedComposeThumbs();
      // #333 — 직전 단문 본문을 캐시했다가 "이어서 쓰기" CTA에서 첫 조각으로 복원한다. 자동 분할은 하지 않는다.
      _feedComposeLastSubmittedBody = String(body || "");
      if (failedCount > 0) {
        setFeedComposeMessage(`피드에 올라갔어요. 실패한 이미지 ${failedCount}장은 포함되지 않았어요.`, "success");
      } else {
        setFeedComposeMessage("피드에 올라갔어요.", "success");
      }
      // #333 — 단문 게시 직후 "이어서 쓰기" CTA를 보여준다. 클릭 시 thread 모드로 전환하면서 직전 본문을 item 1에 복원.
      showFeedThreadFollowupCta(_feedComposeLastSubmittedBody);
      updateState();
      // 피드 다시 로드
      await loadLuminaFeedData(_luminaFeedFilter || "all");
      renderLuminaFeed();
    } catch (err) {
      console.warn("[#305 feed submit]", { status: err?.status || null });
      setFeedComposeMessage(feedComposeSubmitErrorMessage(err), "warn");
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

  // #309 — 타래 작성 모드 바인딩
  bindFeedComposeThreadMode(textarea, updateState);

  updateState();
}

/* ── #309 타래 작성 UX ──────────────────────────
   - 정책: 조각당 500자, 총 10조각(root 포함), aggregate 5000자.
   - 자동 분할 없음. 사용자가 명시적으로 진입/추가/삭제.
   - POST /api/v1/lumina-feed/posts/thread 로 사용자가 확인한 조각을 제출한다.
*/
function bindFeedComposeThreadMode(textarea, parentUpdateState) {
  const toggle = document.getElementById("feedComposeThreadToggle");
  const composer = document.getElementById("feedThreadComposer");
  const itemsRoot = document.getElementById("feedThreadItems");
  const aggregateEl = document.getElementById("feedThreadAggregate");
  const addBtn = document.getElementById("feedThreadAddBtn");
  const cancelBtn = document.getElementById("feedThreadCancelBtn");
  const submitBtn = document.getElementById("feedThreadSubmitBtn");
  if (!toggle || !composer || !itemsRoot) return;

  const composeSubmitBtn = document.getElementById("feedComposeSubmit");

  function syncToggleVisualState() {
    toggle.classList.toggle("is-active", _feedComposeThreadMode);
    toggle.setAttribute("aria-pressed", _feedComposeThreadMode ? "true" : "false");
    composer.hidden = !_feedComposeThreadMode;
    if (composeSubmitBtn) composeSubmitBtn.hidden = _feedComposeThreadMode;
  }

  function renderThreadItems() {
    if (_feedComposeThreadItems.length === 0) {
      itemsRoot.innerHTML = `
        <p class="feed-thread-empty-hint">
          아직 이어글이 없어요. 아래 <strong>+ 이어글 추가</strong> 버튼으로 한 조각씩 적어보세요.
        </p>
      `;
      return;
    }
    itemsRoot.innerHTML = _feedComposeThreadItems.map((item, idx) => {
      const len = item.body?.length || 0;
      const warnThreshold = Math.ceil(FEED_THREAD_ITEM_MAX_BODY * 0.9);
      let state = "ok";
      if (len >= FEED_THREAD_ITEM_MAX_BODY) state = "danger";
      else if (len >= warnThreshold) state = "warn";
      const orderLabel = idx + 2; // root가 1번이므로 이어글은 2번부터
      return `
        <div class="feed-thread-item" data-thread-item-id="${feedEscapeHtml(item.localId)}">
          <div class="feed-thread-item-head">
            <span class="feed-thread-item-order">${orderLabel}/${FEED_THREAD_MAX_ITEMS}</span>
            <button type="button" class="feed-thread-item-remove" data-thread-remove="${feedEscapeHtml(item.localId)}" aria-label="이어글 ${orderLabel}번 삭제">×</button>
          </div>
          <textarea
            class="feed-thread-item-input"
            rows="2"
            maxlength="${FEED_THREAD_ITEM_MAX_BODY}"
            data-thread-input="${feedEscapeHtml(item.localId)}"
            placeholder="이어쓸 내용을 적어주세요. (${FEED_THREAD_ITEM_MAX_BODY}자 이하)"
            aria-label="이어글 ${orderLabel}번"
          >${feedEscapeHtml(item.body || "")}</textarea>
          <span class="feed-thread-item-counter" data-state="${state}">${len} / ${FEED_THREAD_ITEM_MAX_BODY}자</span>
        </div>
      `;
    }).join("");
  }

  function updateThreadState() {
    const rootBodyLen = (textarea?.value || "").length;
    const aggregate = feedThreadAggregateLength(rootBodyLen);
    const itemCount = feedThreadItemCount();
    if (aggregateEl) {
      const aggregateState = aggregate > FEED_THREAD_AGGREGATE_MAX
        ? "danger"
        : aggregate >= Math.ceil(FEED_THREAD_AGGREGATE_MAX * 0.9) ? "warn" : "ok";
      aggregateEl.dataset.state = aggregateState;
      aggregateEl.textContent = `총 ${aggregate} / ${FEED_THREAD_AGGREGATE_MAX}자 · 조각 ${itemCount} / ${FEED_THREAD_MAX_ITEMS}`;
    }
    if (addBtn) {
      const atItemCap = itemCount >= FEED_THREAD_MAX_ITEMS;
      const atAggregateCap = aggregate >= FEED_THREAD_AGGREGATE_MAX;
      addBtn.disabled = atItemCap || atAggregateCap;
      addBtn.dataset.reason = atItemCap ? "items" : atAggregateCap ? "aggregate" : "";
      if (atItemCap) {
        addBtn.title = `이어글은 최대 ${FEED_THREAD_MAX_ITEMS}조각까지 추가할 수 있어요.`;
      } else if (atAggregateCap) {
        addBtn.title = `타래 전체는 ${FEED_THREAD_AGGREGATE_MAX}자까지예요.`;
      } else {
        addBtn.removeAttribute("title");
      }
    }
    if (submitBtn) {
      const rootEmpty = !(textarea?.value || "").trim();
      const hasEmptyItem = _feedComposeThreadItems.some(it => !(it.body || "").trim());
      const overItemCap = _feedComposeThreadItems.some(it => (it.body?.length || 0) > FEED_THREAD_ITEM_MAX_BODY);
      const overAggregateCap = aggregate > FEED_THREAD_AGGREGATE_MAX;
      const overRootCap = rootBodyLen > FEED_COMPOSE_MAX_BODY;
      const ready = !rootEmpty
        && !hasEmptyItem
        && !overItemCap
        && !overAggregateCap
        && !overRootCap
        && _feedComposeThreadItems.length > 0
        && !feedComposeHasPendingUpload();
      submitBtn.dataset.ready = ready ? "1" : "0";
      submitBtn.disabled = !ready;
    }
    parentUpdateState?.();
  }

  toggle.addEventListener("click", () => {
    _feedComposeThreadMode = !_feedComposeThreadMode;
    if (_feedComposeThreadMode && _feedComposeThreadItems.length === 0) {
      // 진입 직후 빈 이어글 한 줄을 제공해 사용자가 곧바로 작성 가능
      _feedComposeThreadItems.push({ localId: feedComposeNextThreadLocalId(), body: "" });
    }
    syncToggleVisualState();
    renderThreadItems();
    updateThreadState();
  });

  cancelBtn?.addEventListener("click", () => {
    if (_feedComposeThreadItems.some(it => (it.body || "").trim())) {
      const ok = confirm("작성한 이어글 내용이 모두 지워져요. 타래를 취소할까요?");
      if (!ok) return;
    }
    _feedComposeThreadMode = false;
    _feedComposeThreadItems = [];
    syncToggleVisualState();
    renderThreadItems();
    updateThreadState();
  });

  addBtn?.addEventListener("click", () => {
    if (feedThreadItemCount() >= FEED_THREAD_MAX_ITEMS) return;
    _feedComposeThreadItems.push({ localId: feedComposeNextThreadLocalId(), body: "" });
    renderThreadItems();
    updateThreadState();
    // 새로 추가된 textarea에 포커스
    const last = itemsRoot.querySelector(".feed-thread-item:last-child .feed-thread-item-input");
    last?.focus();
  });

  // 이어글 입력 이벤트 위임 (textarea + remove button)
  itemsRoot.addEventListener("input", e => {
    const input = e.target.closest("[data-thread-input]");
    if (!input) return;
    const localId = input.dataset.threadInput;
    const item = _feedComposeThreadItems.find(it => it.localId === localId);
    if (!item) return;
    item.body = input.value;
    // 카운터만 가볍게 갱신 — 전체 re-render는 피해서 포커스 유지
    const wrap = input.closest(".feed-thread-item");
    const counter = wrap?.querySelector(".feed-thread-item-counter");
    if (counter) {
      const len = item.body.length;
      counter.textContent = `${len} / ${FEED_THREAD_ITEM_MAX_BODY}자`;
      const warnThreshold = Math.ceil(FEED_THREAD_ITEM_MAX_BODY * 0.9);
      counter.dataset.state = len >= FEED_THREAD_ITEM_MAX_BODY
        ? "danger"
        : len >= warnThreshold ? "warn" : "ok";
    }
    updateThreadState();
  });

  itemsRoot.addEventListener("click", e => {
    const removeBtn = e.target.closest("[data-thread-remove]");
    if (!removeBtn) return;
    const localId = removeBtn.dataset.threadRemove;
    const idx = _feedComposeThreadItems.findIndex(it => it.localId === localId);
    if (idx < 0) return;
    const item = _feedComposeThreadItems[idx];
    if ((item.body || "").trim()) {
      const ok = confirm("이 이어글을 삭제할까요?");
      if (!ok) return;
    }
    _feedComposeThreadItems.splice(idx, 1);
    renderThreadItems();
    updateThreadState();
  });

  submitBtn?.addEventListener("click", async () => {
    if (submitBtn.disabled) return;
    if (!isLoggedIn?.()) {
      setFeedComposeMessage("로그인 후 타래를 게시할 수 있어요.", "warn");
      return;
    }
    if (feedComposeHasPendingUpload()) {
      setFeedComposeMessage("이미지 업로드가 끝난 뒤 타래를 게시할 수 있어요.", "warn");
      return;
    }
    const payloadResult = feedThreadPostPayload(textarea?.value || "");
    if (!payloadResult.ok) {
      setFeedComposeMessage(payloadResult.message, "warn");
      updateThreadState();
      return;
    }
    const failedCount = _feedComposeAssets.filter(a => a.status === "failed").length;
    submitBtn.disabled = true;
    submitBtn.textContent = "타래 게시 중";
    try {
      await apiFetch("/api/v1/lumina-feed/posts/thread", {
        method: "POST",
        auth: true,
        throwOnError: true,
        body: payloadResult.payload
      });
      if (textarea) textarea.value = "";
      _feedComposeAssets.forEach(releaseFeedComposeAssetPreview);
      _feedComposeAssets = [];
      _feedComposeThreadMode = false;
      _feedComposeThreadItems = [];
      syncToggleVisualState();
      renderThreadItems();
      renderFeedComposeThumbs();
      setFeedComposeMessage(
        failedCount > 0
          ? `타래를 올렸어요. 업로드 실패 이미지 ${failedCount}개는 포함하지 않았어요.`
          : "타래를 올렸어요.",
        "success"
      );
      await loadLuminaFeedData(_luminaFeedFilter || "all");
      renderLuminaFeed();
    } catch (err) {
      console.warn("[#309 thread submit]", { status: err?.status || null });
      setFeedComposeMessage(feedComposeSubmitErrorMessage(err), "warn");
    } finally {
      submitBtn.textContent = "타래 게시";
      updateThreadState();
      parentUpdateState?.();
    }
  });

  // 루트 textarea 글자수 변화 시에도 aggregate 갱신
  textarea?.addEventListener("input", updateThreadState);

  syncToggleVisualState();
  renderThreadItems();
  updateThreadState();
}

// #333 — 단문 게시 후 "이어서 쓰기" CTA. 클릭 시 textarea에 직전 본문을 복원하고 thread 모드로 전환한다.
function showFeedThreadFollowupCta(body) {
  const cta = document.getElementById("feedComposeFollowupCta");
  if (!cta) return;
  const safeBody = String(body || "").slice(0, FEED_COMPOSE_MAX_BODY);
  if (!safeBody) {
    cta.hidden = true;
    return;
  }
  cta.hidden = false;
  cta.dataset.body = safeBody;
}

function dismissFeedThreadFollowupCta() {
  const cta = document.getElementById("feedComposeFollowupCta");
  if (!cta) return;
  cta.hidden = true;
  delete cta.dataset.body;
}

function applyFeedThreadFollowupContinue() {
  const cta = document.getElementById("feedComposeFollowupCta");
  const body = String((cta && cta.dataset.body) || _feedComposeLastSubmittedBody || "").slice(0, FEED_COMPOSE_MAX_BODY);
  if (!body) {
    dismissFeedThreadFollowupCta();
    return;
  }
  // 원본 본문을 root textarea로 복원해 사용자가 편집 가능한 시작점으로 만든다.
  // 작성창 textarea id는 lumina-feed/index.html 기준 #feedComposeText.
  const textarea = document.getElementById("feedComposeText");
  if (textarea) {
    textarea.value = body;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
  }
  // thread 모드가 아직 꺼져 있으면 toggle 클릭으로 진입. 이미 켜져 있으면 그대로.
  if (!_feedComposeThreadMode) {
    const toggle = document.getElementById("feedComposeThreadToggle");
    toggle?.click();
  }
  dismissFeedThreadFollowupCta();
}

function bindFeedThreadFollowupCta() {
  if (document._feedThreadFollowupBound) return;
  document._feedThreadFollowupBound = true;
  document.addEventListener("click", e => {
    if (e.target.closest("[data-feed-followup-continue]")) {
      e.preventDefault();
      applyFeedThreadFollowupContinue();
      return;
    }
    if (e.target.closest("[data-feed-followup-dismiss]")) {
      e.preventDefault();
      dismissFeedThreadFollowupCta();
    }
  });
}

function setFeedComposeMessage(text, kind, reason = "") {
  const el = document.getElementById("feedComposeMessage");
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    delete el.dataset.reason;
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.dataset.kind = kind || "info";
  if (reason) el.dataset.reason = reason;
  else delete el.dataset.reason;
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

  // #356 — 타래 잇기 / 리포스트 / 공유 액션 핸들러. event delegation으로 동적 카드까지 커버한다.
  // 타래 append / repost는 백엔드 contract 도착 전이라 submit 잠금 + 안내 노출, 공유는 실제 동작.
  function findPostFromCard(target) {
    var card = target && target.closest ? target.closest("[data-feed-type]") : null;
    if (!card) return null;
    var likeBtn = card.querySelector("[data-feed-like]");
    var postId = likeBtn ? likeBtn.getAttribute("data-feed-like") : "";
    var author = card.querySelector(".feed-post-author");
    var bodyEl = card.querySelector(".feed-post-body");
    return {
      card: card,
      postId: postId,
      authorName: author ? author.textContent.trim() : "",
      body: bodyEl ? bodyEl.textContent.trim() : "",
    };
  }

  function buildPostShareUrl(postId) {
    var origin = (window.location && window.location.origin) || "https://www.lumina-stage.com";
    return origin + "/lumina-feed?postId=" + encodeURIComponent(String(postId || ""));
  }

  function showFeedShareToast(text) {
    var toast = document.getElementById("feedShareToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "feedShareToast";
      toast.className = "feed-share-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add("is-visible");
    if (toast._hideTimer) clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(function () { toast.classList.remove("is-visible"); }, 1800);
  }

  async function handleFeedShare(postInfo) {
    if (!postInfo || !postInfo.postId) {
      showFeedShareToast("이 글의 공유 정보를 찾지 못했어요.");
      return;
    }
    var url = buildPostShareUrl(postInfo.postId);
    var title = postInfo.authorName ? postInfo.authorName + " — Lumina Feed" : "Lumina Feed";
    var snippet = postInfo.body ? postInfo.body.slice(0, 120) : "";
    if (navigator.share && navigator.canShare && navigator.canShare({ url: url })) {
      try {
        await navigator.share({ title: title, text: snippet, url: url });
        return;
      } catch (_) { /* user cancel or share fail → clipboard fallback */ }
    } else if (navigator.share) {
      try { await navigator.share({ title: title, text: snippet, url: url }); return; } catch (_) {}
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        showFeedShareToast("링크가 복사되었어요.");
        return;
      }
    } catch (_) {}
    // 최후 fallback — textarea로 복사
    try {
      var ta = document.createElement("textarea");
      ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand && document.execCommand("copy");
      document.body.removeChild(ta);
      showFeedShareToast("링크가 복사되었어요.");
    } catch (_) {
      showFeedShareToast("공유 링크: " + url);
    }
  }

  // #357 — 타래/리포스트 submit 활성화. 사용자 화면에서 보이던 "준비 중" 안내는 모두 제거하고,
  // 실패 시에만 status 영역에 사용자 카피로 분기. POST는 #355 contract의 thread-continuations / reposts.
  function setPanelStatus(rootEl, message, kind) {
    if (!rootEl) return;
    var statusEl = rootEl.querySelector("[data-feed-status]");
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.dataset.kind = message ? (kind || "info") : "";
    statusEl.hidden = !message;
  }

  function feedSubmitErrorMessage(err, opts) {
    var status = err && err.status;
    var ctx = opts && opts.context;
    if (status === 401) return "로그인 후 다시 시도해 주세요.";
    if (status === 403) {
      if (ctx === "thread") return "타래 이어쓰기는 원글 작성자만 추가할 수 있어요.";
      return "이 글에는 추가 작업을 진행할 수 없어요.";
    }
    if (status === 404) {
      if (ctx === "thread") return "원글을 찾을 수 없어요. 새로고침 후 다시 시도해 주세요.";
      if (ctx === "repost") return "원글이 비공개·삭제됐어요. 다른 글을 리포스트해 주세요.";
      return "글을 찾을 수 없어요. 새로고침 후 다시 시도해 주세요.";
    }
    if (status === 409) return "방금 같은 요청이 처리 중이에요. 잠시 후 다시 시도해 주세요.";
    if (status === 429) return "요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.";
    if (err && (err.name === "AbortError" || (err.message && err.message.includes("Failed to fetch")))) {
      return "네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
    }
    return "게시에 실패했어요. 잠시 후 다시 시도해 주세요.";
  }

  function toggleThreadExtendPanel(card, postInfo) {
    if (!card) return;
    var existing = card.querySelector(".feed-thread-extend-panel");
    if (existing) {
      existing.remove();
      return;
    }
    var panel = document.createElement("section");
    panel.className = "feed-thread-extend-panel";
    panel.setAttribute("aria-label", "타래 이어 쓰기");
    panel.dataset.postId = postInfo.postId || "";
    panel.innerHTML =
      '<div class="feed-thread-extend-connector" aria-hidden="true"></div>' +
      '<div class="feed-thread-extend-body">' +
        '<label class="feed-thread-extend-field">' +
          '<span>이어쓰기 본문</span>' +
          '<textarea maxlength="500" rows="3" placeholder="원글에 이어서 쓸 내용을 적어주세요." data-feed-thread-extend-input></textarea>' +
        '</label>' +
        '<p class="feed-pending-banner" data-feed-status hidden role="status" aria-live="polite"></p>' +
        '<div class="feed-thread-extend-actions">' +
          '<button type="button" class="feed-thread-extend-cancel" data-feed-thread-extend-cancel>취소</button>' +
          '<button type="button" class="feed-thread-extend-submit" data-feed-thread-extend-submit>이어쓰기 게시</button>' +
        '</div>' +
      '</div>';
    card.appendChild(panel);
    var ta = panel.querySelector("textarea");
    if (ta) ta.focus();
  }

  async function submitThreadContinuation(panel) {
    if (!panel || panel.dataset.busy === "1") return;
    var postId = panel.dataset.postId || "";
    if (!postId) return;
    var ta = panel.querySelector("[data-feed-thread-extend-input]");
    var body = (ta && ta.value || "").trim();
    if (!body) {
      setPanelStatus(panel, "이어쓸 본문을 입력해 주세요.", "warn");
      ta && ta.focus();
      return;
    }
    if (typeof isLoggedIn === "function" && !isLoggedIn()) {
      setPanelStatus(panel, "로그인 후 다시 시도해 주세요.", "warn");
      return;
    }
    var submitBtn = panel.querySelector("[data-feed-thread-extend-submit]");
    panel.dataset.busy = "1";
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "게시 중"; }
    setPanelStatus(panel, "", "info");
    try {
      await apiFetch(
        "/api/v1/lumina-feed/posts/" + encodeURIComponent(postId) + "/thread-continuations",
        { method: "POST", auth: true, throwOnError: true, body: { body: body } }
      );
      // 성공 — panel 제거 + 피드 reload
      if (ta) ta.value = "";
      panel.remove();
      if (typeof loadLuminaFeedData === "function" && typeof renderLuminaFeed === "function") {
        try {
          await loadLuminaFeedData(typeof _luminaFeedFilter !== "undefined" ? _luminaFeedFilter : "all");
          renderLuminaFeed();
        } catch (_) { /* render 실패는 silent — 다음 사용자 액션에서 복구 */ }
      }
    } catch (err) {
      console.warn("[#357 thread-continuation submit]", { status: err && err.status });
      setPanelStatus(panel, feedSubmitErrorMessage(err, { context: "thread" }), "error");
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "이어쓰기 게시"; }
    } finally {
      panel.dataset.busy = "0";
    }
  }

  function closeRepostModal() {
    var backdrop = document.getElementById("feedRepostBackdrop");
    var modal = document.getElementById("feedRepostModal");
    if (backdrop) backdrop.hidden = true;
    if (modal) { modal.hidden = true; modal.innerHTML = ""; modal.dataset.postId = ""; }
    document.body.classList.remove("is-feed-repost-open");
  }

  function openRepostModal(postInfo) {
    var backdrop = document.getElementById("feedRepostBackdrop");
    var modal = document.getElementById("feedRepostModal");
    if (!modal || !backdrop) return;
    var body = feedEscapeHtml(postInfo.body || "");
    var author = feedEscapeHtml(postInfo.authorName || "Lumina 사용자");
    var postUrl = buildPostShareUrl(postInfo.postId);
    modal.dataset.postId = postInfo.postId || "";
    modal.innerHTML =
      '<header class="feed-repost-head">' +
        '<h2>리포스트</h2>' +
        '<button type="button" class="feed-repost-close" aria-label="리포스트 창 닫기" data-feed-repost-close>×</button>' +
      '</header>' +
      '<div class="feed-repost-body">' +
        '<label class="feed-repost-field">' +
          '<span>내 코멘트 (선택)</span>' +
          '<textarea maxlength="500" rows="3" placeholder="원글에 덧붙일 내 한마디를 적어주세요." data-feed-repost-input></textarea>' +
        '</label>' +
        '<article class="feed-repost-reference" aria-label="원글 참조">' +
          '<header><strong>' + author + '</strong><a href="' + feedEscapeHtml(postUrl) + '" class="feed-repost-reference-link">원글 보기 →</a></header>' +
          '<p>' + body + '</p>' +
        '</article>' +
        '<p class="feed-pending-banner" data-feed-status hidden role="status" aria-live="polite"></p>' +
      '</div>' +
      '<footer class="feed-repost-foot">' +
        '<button type="button" class="feed-repost-cancel" data-feed-repost-close>취소</button>' +
        '<button type="button" class="feed-repost-submit" data-feed-repost-submit>리포스트 게시</button>' +
      '</footer>';
    modal.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add("is-feed-repost-open");
    var ta = modal.querySelector("textarea");
    if (ta) ta.focus();
  }

  async function submitRepost() {
    var modal = document.getElementById("feedRepostModal");
    if (!modal || modal.dataset.busy === "1") return;
    var postId = modal.dataset.postId || "";
    if (!postId) return;
    if (typeof isLoggedIn === "function" && !isLoggedIn()) {
      setPanelStatus(modal, "로그인 후 다시 시도해 주세요.", "warn");
      return;
    }
    var ta = modal.querySelector("[data-feed-repost-input]");
    var body = (ta && ta.value || "").trim();
    var submitBtn = modal.querySelector("[data-feed-repost-submit]");
    modal.dataset.busy = "1";
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "게시 중"; }
    setPanelStatus(modal, "", "info");
    try {
      // body는 선택. 빈 본문이면 {}로 보내고, 있으면 quote repost로 전송.
      var payload = body ? { body: body } : {};
      await apiFetch(
        "/api/v1/lumina-feed/posts/" + encodeURIComponent(postId) + "/reposts",
        { method: "POST", auth: true, throwOnError: true, body: payload }
      );
      closeRepostModal();
      if (typeof loadLuminaFeedData === "function" && typeof renderLuminaFeed === "function") {
        try {
          await loadLuminaFeedData(typeof _luminaFeedFilter !== "undefined" ? _luminaFeedFilter : "all");
          renderLuminaFeed();
        } catch (_) {}
      }
    } catch (err) {
      console.warn("[#357 repost submit]", { status: err && err.status });
      setPanelStatus(modal, feedSubmitErrorMessage(err, { context: "repost" }), "error");
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "리포스트 게시"; }
    } finally {
      modal.dataset.busy = "0";
    }
  }

  function bindFeedCardSocialActions() {
    if (document._feedSocialActionsBound) return;
    document._feedSocialActionsBound = true;
    document.addEventListener("click", function (e) {
      // 타래 잇기
      var threadBtn = e.target.closest("[data-feed-thread-extend]");
      if (threadBtn) {
        e.preventDefault();
        var info = findPostFromCard(threadBtn);
        if (info) toggleThreadExtendPanel(info.card, info);
        return;
      }
      if (e.target.closest("[data-feed-thread-extend-cancel]")) {
        e.preventDefault();
        var panel = e.target.closest(".feed-thread-extend-panel");
        if (panel) panel.remove();
        return;
      }
      // #357 — 타래 이어쓰기 실제 제출
      var threadSubmit = e.target.closest("[data-feed-thread-extend-submit]");
      if (threadSubmit) {
        e.preventDefault();
        var threadPanel = threadSubmit.closest(".feed-thread-extend-panel");
        if (threadPanel) submitThreadContinuation(threadPanel);
        return;
      }
      // 리포스트
      var repostBtn = e.target.closest("[data-feed-repost]");
      if (repostBtn) {
        e.preventDefault();
        var rInfo = findPostFromCard(repostBtn);
        if (rInfo) openRepostModal(rInfo);
        return;
      }
      if (e.target.closest("[data-feed-repost-close]")) {
        e.preventDefault();
        closeRepostModal();
        return;
      }
      // #357 — 리포스트 실제 제출
      if (e.target.closest("[data-feed-repost-submit]")) {
        e.preventDefault();
        submitRepost();
        return;
      }
      // 공유
      var shareBtn = e.target.closest("[data-feed-share]");
      if (shareBtn) {
        e.preventDefault();
        var sInfo = findPostFromCard(shareBtn);
        handleFeedShare(sInfo);
        return;
      }
    });
    var backdrop = document.getElementById("feedRepostBackdrop");
    if (backdrop && !backdrop.dataset.bound) {
      backdrop.dataset.bound = "1";
      backdrop.addEventListener("click", closeRepostModal);
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeRepostModal();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindFeedCardSocialActions);
  } else {
    bindFeedCardSocialActions();
  }
  window.bindFeedCardSocialActions = bindFeedCardSocialActions;
})();
