(function initPopularVotePageLayer() {
let _popularVote = {
  mainPick: null,         // { campaign, leader, rankings }
  monthlyPicks: [],       // 월간 1위 배열 (해당 연도)
  yearChampion: null,     // { year, champion, rankings, rule }
  loaded: false
};

async function loadPopularVoteState() {
  const year = new Date().getFullYear();
  try {
    const [mainPick, monthlyPicks, yearChampion] = await Promise.all([
      apiFetch("/api/v1/popular-vote/main-pick").catch(err => {
        console.warn("[Lumina] main-pick 로드 실패:", err);
        return null;
      }),
      apiFetch(`/api/v1/popular-vote/hall-of-fame/monthly-picks?year=${year}`).catch(err => {
        console.warn("[Lumina] monthly-picks 로드 실패:", err);
        return null;
      }),
      apiFetch(`/api/v1/popular-vote/hall-of-fame/year-champion?year=${year}`).catch(err => {
        console.warn("[Lumina] year-champion 로드 실패:", err);
        return null;
      })
    ]);
    // 응답 형식이 배열일 수도 있고 { items: [] } 일 수도 — 양쪽 다 처리
    const monthlyArr = Array.isArray(monthlyPicks)
      ? monthlyPicks
      : (monthlyPicks?.items || monthlyPicks?.picks || []);
    _popularVote = {
      mainPick,
      monthlyPicks: monthlyArr,
      // year-champion 응답: { year, champion, rankings, rule } — 객체 통째로 저장
      yearChampion: yearChampion,
      loaded: true
    };
  } catch (err) {
    console.warn("[Lumina] 루미나 픽 로드 실패:", err);
    _popularVote.loaded = true; // 실패해도 fallback 렌더링은 진행
  }
}

/* ── 렌더: Main Pick 탭 ──
   백엔드 응답이 비어있으면 _artists 메인 + _rankings로 fallback */
function renderMainPickTab() {
  const leaderRoot = document.getElementById("mainPickLeader");
  const rankingsRoot = document.getElementById("mainPickRankings");
  if (!leaderRoot || !rankingsRoot) return;

  // 데이터 소스 결정: API 우선, 없으면 로컬 fallback
  const apiLeader = _popularVote.mainPick?.leader;
  const apiRankings = _popularVote.mainPick?.rankings;

  let leaderArtist = null;
  let rankingsList = [];

  if (apiLeader && Array.isArray(apiRankings) && apiRankings.length > 0) {
    // API 데이터 사용 — 차모 답변(2026-05-02 Q4) 기준 row 구조:
    // { rankNo, artist, totalFreeLikes, totalLuminaBoosts, totalWeightedScore }
    leaderArtist = getCharacterBySlug(apiLeader.artist?.slug || apiLeader.slug || apiLeader.artistSlug);
    rankingsList = apiRankings.map(r => ({
      artist: getCharacterBySlug(r.artist?.slug || r.slug || r.artistSlug),
      likes: r.totalFreeLikes ?? r.totalWeightedScore ?? r.totalLikes ?? r.likes ?? r.score ?? 0
    })).filter(r => r.artist);
  } else {
    // Fallback: 초기 공개 6명 라인업을 좋아요 순으로
    const mainList = _artists
      .filter(isPublicLineup)
      .map(a => ({ artist: a, likes: getLikesCount(a.slug) }))
      .sort((a, b) => b.likes - a.likes);
    if (mainList.length > 0) {
      leaderArtist = mainList[0].artist;
      rankingsList = mainList;
    }
  }

  // 헤더 패널 leader 이름 갱신
  const heroLeaderEl = document.getElementById("heroLeaderName");
  if (heroLeaderEl && leaderArtist) heroLeaderEl.textContent = leaderArtist.publicName;

  // 헤더 패널 캠페인 이름 자동 갱신 (백엔드 boost 캠페인 데이터 있으면 사용)
  const heroCampaignEl = document.getElementById("heroCampaignLabel");
  if (heroCampaignEl) {
    const campaignName = _currentCampaign?.name
      || _popularVote.mainPick?.campaign?.name
      || "응원 레이스";
    heroCampaignEl.textContent = campaignName;
  }

  if (!leaderArtist) {
    leaderRoot.innerHTML = `<div class="vote-empty">아직 첫 응원이 도착하기 전이에요. 이달의 주인공은 팬의 첫 선택에서 시작됩니다.</div>`;
    rankingsRoot.innerHTML = "";
    return;
  }

  // 1위 큰 카드
  const leaderLikes = rankingsList[0]?.likes ?? getLikesCount(leaderArtist.slug);
  // 이달의 픽 1위 카드는 팬이 바로 읽을 수 있도록 항상 수상소감 톤을 노출
  const messages = getCharacterMessages(leaderArtist.slug);
  const tribute = messages.tributeMessage;

  leaderRoot.innerHTML = `
    <article class="vote-leader-card clickable-card" data-href="/character-detail?slug=${leaderArtist.slug}">
      <div class="vote-leader-media">
        <img src="${leaderArtist.images.cover || leaderArtist.images.thumb}" alt="${leaderArtist.publicName}" />
        <div class="vote-leader-crown">👑</div>
      </div>
      <div class="vote-leader-body">
        <span class="vote-leader-label">이달의 픽 · ${formatLikeCount(leaderLikes)} 응원</span>
        <strong>${leaderArtist.publicName}</strong>
        <blockquote class="vote-leader-tribute">
          <p>${tribute}</p>
          <cite>— ${leaderArtist.publicName}</cite>
        </blockquote>
        <a class="text-link" href="/character-detail?slug=${leaderArtist.slug}">${leaderArtist.publicName} 무드 보기</a>
      </div>
    </article>
  `;

  // 2~N위 리스트 (1위 제외)
  const rest = rankingsList.slice(1);
  if (rest.length === 0) {
    rankingsRoot.innerHTML = "";
  } else {
    // 5위(=list 4번째)까지만 기본 표시, 나머지는 더보기 토글
    const VISIBLE_LIMIT = 4; // 2위~5위 = 4명
    const initiallyVisible = rest.slice(0, VISIBLE_LIMIT);
    const hidden = rest.slice(VISIBLE_LIMIT);

    const renderRow = (r, idx) => {
      const rankNum = idx + 2; // list 첫 항목이 2위
      // 1~3위는 금은동 메달, 4위 이후는 숫자만
      const medal = rankNum === 2 ? "🥈" : rankNum === 3 ? "🥉" : "";
      return `
        <li class="vote-ranking-row clickable-card" data-href="/character-detail?slug=${r.artist.slug}">
          <span class="vote-rank-label">
            ${medal ? `<span class="vote-rank-medal">${medal}</span>` : ""}
            <span class="vote-rank-num">${rankNum}위</span>
          </span>
          <img class="vote-rank-thumb" src="${r.artist.images.thumb || r.artist.images.cover}" alt="${r.artist.publicName}" />
          <div class="vote-rank-info">
            <strong>${r.artist.publicName}</strong>
            <small>${r.artist.summary || ""}</small>
          </div>
          <span class="vote-rank-likes">${formatLikeCount(r.likes)}</span>
        </li>
      `;
    };

    rankingsRoot.innerHTML = `
      <h3 class="vote-section-subtitle">응원 순위</h3>
      <ol class="vote-ranking-rows">
        ${initiallyVisible.map(renderRow).join("")}
        ${hidden.length > 0 ? `
          <div class="vote-ranking-hidden" hidden>
            ${hidden.map((r, i) => renderRow(r, i + VISIBLE_LIMIT)).join("")}
          </div>
        ` : ""}
      </ol>
      ${hidden.length > 0 ? `
        <button class="vote-rankings-more" type="button" data-action="toggle-rankings">
          <span class="vote-more-text">${hidden.length}명 더보기 ↓</span>
        </button>
      ` : ""}
    `;

    // 더보기 토글
    const moreBtn = rankingsRoot.querySelector(".vote-rankings-more");
    if (moreBtn) {
      moreBtn.addEventListener("click", () => {
        const hiddenBlock = rankingsRoot.querySelector(".vote-ranking-hidden");
        if (!hiddenBlock) return;
        const isOpen = !hiddenBlock.hasAttribute("hidden");
        if (isOpen) {
          hiddenBlock.setAttribute("hidden", "");
          moreBtn.querySelector(".vote-more-text").textContent = `${hidden.length}명 더보기 ↓`;
        } else {
          hiddenBlock.removeAttribute("hidden");
          moreBtn.querySelector(".vote-more-text").textContent = "접기 ↑";
        }
      });
    }
  }
}

/* ── 렌더: Debut Race 탭 ──
   status=public인 모든 활동 중 캐릭터를 좋아요 순으로 + 좋아요 버튼 작동
   (메인/프리미엄/sub 모두 포함 — 루미나 픽은 진짜 응원하는 곳) */
function renderDebutRaceTab() {
  const root = document.getElementById("debutRaceGrid");
  if (!root) return;

  const list = _artists
    .filter(a => a.status === "public")
    .map(a => ({ artist: a, likes: getLikesCount(a.slug) }))
    .sort((a, b) => b.likes - a.likes);

  if (list.length === 0) {
    root.innerHTML = `<div class="vote-empty">아직 진행 중인 픽이 없어요. 다음 라운드가 열리면 이곳에서 바로 응원할 수 있습니다.</div>`;
    return;
  }

  // URL ?artist=slug로 강조 대상 결정
  const highlightSlug = new URLSearchParams(window.location.search).get("artist");

  root.innerHTML = list.map((r, i) => {
    const a = r.artist;
    const isHighlighted = a.slug === highlightSlug;
    const rankNum = i + 1;
    // 1~3위 금은동 메달
    const medal = rankNum === 1 ? "🥇" : rankNum === 2 ? "🥈" : rankNum === 3 ? "🥉" : "";
    // 캐릭터별 1인칭 투표 독려 멘트
    const appeal = getCharacterMessages(a.slug).voteAppeal;
    return `
      <article class="vote-debut-card clickable-card${isHighlighted ? " is-highlighted" : ""}"
        data-href="/character-detail?slug=${a.slug}"
        style="--char-accent: ${a.colorAccent || "#9f8bc7"}">
        <div class="vote-debut-rank-badge${medal ? " has-medal" : ""}">
          ${medal ? `<span class="vote-debut-medal">${medal}</span>` : ""}
          <span class="vote-debut-rank-num">${rankNum}위</span>
        </div>
        <div class="vote-debut-media">
          <img src="${a.images.thumb || a.images.cover}" alt="${a.publicName}" onerror="this.style.display='none'" />
          ${likeButtonHTML(a.slug, "like-btn-large like-btn-vote")}
        </div>
        <div class="vote-debut-body">
            <strong>${a.publicName}</strong>
            <small>${a.summary || ""}</small>
            <p class="vote-debut-appeal">"${appeal}"</p>
        </div>
      </article>
    `;
  }).join("");
}

/* ── 렌더: Hall of Fame 탭 ──
   Year Champion 큰 배너 + Monthly Picks 그리드 */
function renderHallOfFameTab() {
  const championRoot = document.getElementById("yearChampion");
  const monthlyRoot = document.getElementById("monthlyPicksGrid");
  if (!championRoot || !monthlyRoot) return;

  const year = new Date().getFullYear();

  // Year Champion (1년 누적 1위 — 연말에만 결정)
  // 차모 답변(2026-05-02 Q4) 기준 응답: { year, champion, rankings, rule }
  // champion은 row 구조: { rankNo, artist, totalFreeLikes, totalLuminaBoosts, totalWeightedScore } 또는 null
  const championWrapper = _popularVote.yearChampion;
  const champion = championWrapper?.champion || null;
  if (champion) {
    const championArtist = getCharacterBySlug(champion.artist?.slug || champion.slug || champion.artistSlug);
    if (championArtist) {
      const championScore = champion.totalWeightedScore ?? champion.totalFreeLikes ?? champion.totalScore ?? champion.score ?? 0;
      championRoot.innerHTML = `
        <article class="vote-year-champion-card clickable-card" data-href="/character-detail?slug=${championArtist.slug}">
          <div class="vote-year-trophy">🏆</div>
          <div class="vote-year-info">
            <span class="vote-year-label">${year} 연간 챔피언</span>
            <strong>${championArtist.publicName}</strong>
            <p>1년 누적 응원 ${formatLikeCount(championScore)}점으로 ${year}년 가장 빛난 이름이 되었습니다.</p>
          </div>
          <div class="vote-year-media">
            <img src="${championArtist.images.cover || championArtist.images.thumb}" alt="${championArtist.publicName}" />
          </div>
        </article>
      `;
    } else {
      championRoot.innerHTML = renderHallOfFameWaiting(year);
    }
  } else {
    championRoot.innerHTML = renderHallOfFameWaiting(year);
  }

  // Monthly Picks (해당 연도 월간 1위들)
  const picks = _popularVote.monthlyPicks || [];
  if (picks.length === 0) {
    monthlyRoot.innerHTML = `<div class="vote-empty">${year}년 첫 월간 1위는 팬들의 응원이 모이는 순간 이곳에 기록됩니다.</div>`;
    return;
  }

  // 월 내림차순 정렬 (최근 월 먼저)
  // 차모 답변 기준: MonthlyPickWinner row에 campaign, artist include
  const sorted = [...picks].sort((a, b) => (b.month || 0) - (a.month || 0));
  monthlyRoot.innerHTML = sorted.map(pick => {
    const artist = getCharacterBySlug(pick.artist?.slug || pick.slug || pick.artistSlug);
    const monthLabel = `${year}.${String(pick.month || "?").padStart(2, "0")}`;
    const score = pick.totalWeightedScore ?? pick.totalFreeLikes ?? pick.totalScore ?? pick.score ?? 0;
    if (!artist) {
      return `
        <div class="vote-monthly-card vote-monthly-card-unknown">
          <span class="vote-monthly-month">${monthLabel}</span>
          <strong>알 수 없는 아티스트</strong>
        </div>
      `;
    }
    return `
      <article class="vote-monthly-card clickable-card" data-href="/character-detail?slug=${artist.slug}">
        <div class="vote-monthly-media">
          <img src="${artist.images.thumb || artist.images.cover}" alt="${artist.publicName}" />
        </div>
        <div class="vote-monthly-info">
          <span class="vote-monthly-month">${monthLabel}</span>
          <strong>${artist.publicName}</strong>
          <small>${formatLikeCount(score)} 응원</small>
        </div>
      </article>
    `;
  }).join("");
}

function renderHallOfFameWaiting(year) {
  return `
    <div class="vote-year-waiting">
      <div class="vote-year-trophy" aria-hidden="true">🏆</div>
      <h3>${year} 연간 챔피언</h3>
      <p>이 자리는 올해 가장 오래 사랑받은 아티스트에게 열립니다. 매일의 응원이 1년의 영광으로 이어집니다.</p>
    </div>
  `;
}

/* ── 탭 전환 ── */
function bindVoteTabs() {
  const root = document.getElementById("voteTabs");
  if (!root) return;
  const buttons = [...root.querySelectorAll(".vote-tab-btn")];
  const panels = {
    "main-pick":   document.getElementById("tabMainPick"),
    "debut-race":  document.getElementById("tabDebutRace"),
    "hall-of-fame": document.getElementById("tabHallOfFame")
  };
  function activate(tabKey) {
    buttons.forEach(b => {
      const isActive = b.dataset.tab === tabKey;
      b.classList.toggle("is-active", isActive);
      b.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    Object.entries(panels).forEach(([k, panel]) => {
      if (!panel) return;
      const isActive = k === tabKey;
      panel.classList.toggle("is-active", isActive);
      if (isActive) panel.removeAttribute("hidden");
      else          panel.setAttribute("hidden", "");
    });
  }
  buttons.forEach(b => {
    b.addEventListener("click", () => activate(b.dataset.tab));
  });
  // URL ?tab=...로 초기 탭 결정
  const initialTab = new URLSearchParams(window.location.search).get("tab");
  if (initialTab && panels[initialTab]) {
    activate(initialTab);
  }
}

/* ── 루미나 픽 페이지 init ── */
async function initPopularVotePage() {
  // 캠페인/랭킹 + 루미나 픽 데이터 + 무료 좋아요 잔여 한도 병렬 로드
  await Promise.all([
    loadBoostState().catch(() => {}),
    loadPopularVoteState(),
    loadFreeLikeQuota()
  ]);
  renderMainPickTab();
  renderDebutRaceTab();
  renderHallOfFameTab();
  updateHeroQuotaDisplay();
  bindVoteTabs();
}


window.initPopularVotePage = initPopularVotePage;
})();
