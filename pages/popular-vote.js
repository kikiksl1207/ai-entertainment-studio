(function initPopularVotePageLayer() {
let _popularVote = {
  mainPick: null,         // { campaign, leader, rankings }
  monthlyPicks: [],       // 월간 1위 배열 (해당 연도)
  monthlyPicksLoaded: false,
  yearChampion: null,     // { year, champion, rankings, rule }
  yearChampionLoaded: false,
  archiveYear: null,
  monthKey: null,
  loaded: false
};
let popularVoteRefresh = null;
let rankingsExpanded = false;
let archiveSettlementRefreshKey = null;

function pickText(key, fallback, values = {}) {
  const translated = window.luminaI18n?.t?.(key);
  return (translated && translated !== key ? translated : fallback)
    .replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

function pickHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function pickDetailUrl(slug) {
  return `/character-detail?slug=${encodeURIComponent(String(slug ?? ""))}`;
}

function pickAccent(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#9f8bc7";
}

function formatPickCount(value) {
  const locale = window.luminaI18n?.getRegionalLocale?.();
  const number = Number(value);
  if (!locale || !Number.isFinite(number)) return formatLikeCount(value);
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(number);
}

function kstPickScope() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", hourCycle: "h23"
  }).formatToParts(new Date()).map(part => [part.type, Number(part.value)]));
  const monthKey = `${parts.year}-${parts.month}`;
  const archiveSettling = parts.day === 1 && parts.hour === 0 && parts.minute < 10;
  return { year: parts.year, month: parts.month, monthKey, archiveSettling,
    queryKey: `${monthKey}:${archiveSettling ? "settling" : "settled"}` };
}

function kstCurrentYear() {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));
}

function kstCurrentMonth() {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", month: "numeric" }).format(new Date()));
}

function isMonthlyArchiveSettling(year, month) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23"
  }).formatToParts(new Date()).map(part => [part.type, Number(part.value)]));
  const currentMonth = kstCurrentMonth();
  const previousYear = currentMonth === 1 ? kstCurrentYear() - 1 : kstCurrentYear();
  const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  return year === previousYear && month === previousMonth && parts.day === 1 && parts.hour === 0 && parts.minute < 10;
}

async function loadPopularVoteState() {
  const scope = kstPickScope();
  const year = _popularVote.archiveYear || scope.year;
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
    if (scope.queryKey !== kstPickScope().queryKey) return;
    // 응답 형식이 배열일 수도 있고 { items: [] } 일 수도 — 양쪽 다 처리
    const monthlyArr = Array.isArray(monthlyPicks)
      ? monthlyPicks
      : (monthlyPicks?.items || monthlyPicks?.picks || []);
    _popularVote = {
      mainPick,
      monthlyPicks: monthlyArr,
      monthlyPicksLoaded: monthlyPicks !== null,
      // year-champion 응답: { year, champion, rankings, rule } — 객체 통째로 저장
      yearChampion: yearChampion,
      yearChampionLoaded: yearChampion !== null,
      archiveYear: year,
      monthKey: scope.monthKey,
      loaded: true
    };
  } catch (err) {
    if (scope.queryKey !== kstPickScope().queryKey) return;
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

  // 집계 실패나 0표인 달에 이전 달의 로컬 누적값을 1위로 표시하지 않는다.
  const apiLeader = _popularVote.mainPick?.leader;
  const apiRankings = _popularVote.mainPick?.rankings;

  let leaderArtist = null;
  let rankingsList = [];

  if (_popularVote.mainPick && Array.isArray(apiRankings)) {
    // API 데이터 사용 — 차모 답변(2026-05-02 Q4) 기준 row 구조:
    // { rankNo, artist, totalFreeLikes, totalLuminaBoosts, totalWeightedScore }
    leaderArtist = apiLeader ? getCharacterBySlug(apiLeader.artist?.slug || apiLeader.slug || apiLeader.artistSlug) : null;
    rankingsList = apiRankings.map(r => ({
      artist: getCharacterBySlug(r.artist?.slug || r.slug || r.artistSlug),
      likes: typeof getRankingLikes === "function"
        ? getRankingLikes(r)
        : (r.totalWeightedScore ?? r.totalFreeLikes ?? r.totalLikes ?? r.likes ?? r.score ?? 0)
    })).filter(r => r.artist);
  }

  // 헤더 패널 leader 이름 갱신
  const heroLeaderEl = document.getElementById("heroLeaderName");
  if (heroLeaderEl) heroLeaderEl.textContent = leaderArtist?.publicName || (_popularVote.loaded
    ? _popularVote.mainPick && !apiLeader
      ? pickText("pick.status.awaitingVote", "첫 응원 대기")
      : pickText("pick.status.unavailable", "집계 확인 불가")
    : pickText("pick.status.loading", "불러오는 중…"));

  // 헤더 패널 캠페인 이름 자동 갱신 (백엔드 boost 캠페인 데이터 있으면 사용)
  const heroCampaignEl = document.getElementById("heroCampaignLabel");
  if (heroCampaignEl) {
    const campaignName = _currentCampaign?.name
      || _popularVote.mainPick?.campaign?.name
      || pickText("pick.tab.race", "응원 레이스");
    heroCampaignEl.textContent = campaignName;
  }

  if (!leaderArtist) {
    leaderRoot.innerHTML = `<div class="vote-empty">${_popularVote.mainPick
      ? pickText("pick.monthly.noVotes", "아직 첫 응원이 도착하기 전이에요. 이달의 주인공은 팬의 첫 선택에서 시작됩니다.")
      : pickText("pick.monthly.loadError", "이달의 집계를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.")}</div>`;
    rankingsRoot.innerHTML = "";
    return;
  }

  // 1위 큰 카드
  const leaderLikes = rankingsList[0]?.likes ?? getLikesCount(leaderArtist.slug);
  // 이달의 픽 1위 카드는 팬이 바로 읽을 수 있도록 항상 수상소감 톤을 노출
  const messages = getCharacterMessages(leaderArtist.slug);
  const tribute = messages.tributeMessage;

  leaderRoot.innerHTML = `
    <article class="vote-leader-card clickable-card" data-href="${pickHtml(pickDetailUrl(leaderArtist.slug))}">
      <div class="vote-leader-media">
        <img src="${pickHtml(leaderArtist.images.cover || leaderArtist.images.thumb)}" alt="${pickHtml(leaderArtist.publicName)}" />
        <div class="vote-leader-crown">👑</div>
      </div>
      <div class="vote-leader-body">
        <span class="vote-leader-label">${pickText("pick.tab.monthly", "이달의 픽")} · ${pickText("pick.rank.support", "{count} 응원", { count: formatPickCount(leaderLikes) })}</span>
        <strong>${pickHtml(leaderArtist.publicName)}</strong>
        <blockquote class="vote-leader-tribute">
          <p>${pickHtml(tribute)}</p>
          <cite>— ${pickHtml(leaderArtist.publicName)}</cite>
        </blockquote>
        <div class="vote-card-actions">
          <a class="text-link" href="${pickHtml(pickDetailUrl(leaderArtist.slug))}">${pickHtml(pickText("pick.action.mood", "{name} 무드 보기", { name: leaderArtist.publicName }))}</a>
          <a class="vote-premium-chat-link" href="/character-chat?slug=${pickHtml(encodeURIComponent(leaderArtist.slug))}">${pickText("pick.action.chat", "AI 캐릭터챗")}</a>
        </div>
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
        <li class="vote-ranking-row clickable-card" data-href="${pickHtml(pickDetailUrl(r.artist.slug))}">
          <span class="vote-rank-label">
            ${medal ? `<span class="vote-rank-medal">${medal}</span>` : ""}
            <span class="vote-rank-num">${pickText("pick.rank.label", "{rank}위", { rank: rankNum })}</span>
          </span>
          <img class="vote-rank-thumb" src="${pickHtml(r.artist.images.thumb || r.artist.images.cover)}" alt="${pickHtml(r.artist.publicName)}" />
          <div class="vote-rank-info">
            <strong>${pickHtml(r.artist.publicName)}</strong>
            <small>${pickHtml(r.artist.summary)}</small>
          </div>
          <span class="vote-rank-likes">${formatPickCount(r.likes)}</span>
        </li>
      `;
    };

    rankingsRoot.innerHTML = `
      <h3 class="vote-section-subtitle">${pickText("pick.rank.heading", "응원 순위")}</h3>
      <ol class="vote-ranking-rows">
        ${initiallyVisible.map(renderRow).join("")}
        ${hidden.length > 0 ? `
          <div class="vote-ranking-hidden" ${rankingsExpanded ? "" : "hidden"}>
            ${hidden.map((r, i) => renderRow(r, i + VISIBLE_LIMIT)).join("")}
          </div>
        ` : ""}
      </ol>
      ${hidden.length > 0 ? `
        <button class="vote-rankings-more" type="button" data-action="toggle-rankings">
          <span class="vote-more-text">${rankingsExpanded
            ? pickText("pick.rank.less", "접기 ↑")
            : pickText("pick.rank.more", "{count}명 더보기 ↓", { count: hidden.length })}</span>
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
        rankingsExpanded = !isOpen;
        if (isOpen) {
          hiddenBlock.setAttribute("hidden", "");
          moreBtn.querySelector(".vote-more-text").textContent = pickText("pick.rank.more", "{count}명 더보기 ↓", { count: hidden.length });
        } else {
          hiddenBlock.removeAttribute("hidden");
          moreBtn.querySelector(".vote-more-text").textContent = pickText("pick.rank.less", "접기 ↑");
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
    root.innerHTML = `<div class="vote-empty">${pickText("pick.race.empty", "아직 진행 중인 픽이 없어요. 다음 라운드가 열리면 이곳에서 바로 응원할 수 있습니다.")}</div>`;
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
        data-href="${pickHtml(pickDetailUrl(a.slug))}"
        style="--char-accent: ${pickAccent(a.colorAccent)}">
        <div class="vote-debut-rank-badge${medal ? " has-medal" : ""}">
          ${medal ? `<span class="vote-debut-medal">${medal}</span>` : ""}
          <span class="vote-debut-rank-num">${pickText("pick.rank.label", "{rank}위", { rank: rankNum })}</span>
        </div>
        <div class="vote-debut-media">
          <img src="${pickHtml(a.images.thumb || a.images.cover)}" alt="${pickHtml(a.publicName)}" onerror="this.style.display='none'" />
          ${likeButtonHTML(a.slug, "like-btn-large like-btn-vote")}
        </div>
        <div class="vote-debut-body">
            <strong>${pickHtml(a.publicName)}</strong>
            <small>${pickHtml(a.summary)}</small>
            <p class="vote-debut-appeal">"${pickHtml(appeal)}"</p>
            ${a.id ? `<a class="vote-premium-chat-link" href="/character-chat?slug=${pickHtml(encodeURIComponent(a.slug))}">${pickText("pick.action.chat", "AI 캐릭터챗")}</a>` : ""}
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

  const year = _popularVote.archiveYear || kstCurrentYear();

  // Year Champion (1년 누적 1위 — 연말에만 결정)
  // 차모 답변(2026-05-02 Q4) 기준 응답: { year, champion, rankings, rule }
  // champion은 row 구조: { rankNo, artist, totalFreeLikes, totalLuminaBoosts, totalWeightedScore } 또는 null
  const championWrapper = _popularVote.yearChampion;
  const champion = championWrapper?.champion || null;
  if (!_popularVote.yearChampionLoaded) {
    championRoot.innerHTML = `<div class="vote-empty">${_popularVote.loaded
      ? pickText("pick.status.unavailable", "집계 확인 불가")
      : pickText("pick.status.loading", "불러오는 중…")}</div>`;
  } else if (champion) {
    const championArtist = getCharacterBySlug(champion.artist?.slug || champion.slug || champion.artistSlug);
    if (championArtist) {
      const championScore = champion.totalWeightedScore ?? champion.totalFreeLikes ?? champion.totalScore ?? champion.score ?? 0;
      championRoot.innerHTML = `
        <article class="vote-year-champion-card clickable-card" data-href="${pickHtml(pickDetailUrl(championArtist.slug))}">
          <div class="vote-year-trophy">🏆</div>
          <div class="vote-year-info">
            <span class="vote-year-label">${pickText("pick.year.champion", "{year} 연간 챔피언", { year })}</span>
            <strong>${pickHtml(championArtist.publicName)}</strong>
            <p>${pickText("pick.year.score", "1년 누적 응원 {score}점으로 {year}년 가장 빛난 이름이 되었습니다.", { score: formatPickCount(championScore), year })}</p>
          </div>
          <div class="vote-year-media">
            <img src="${pickHtml(championArtist.images.cover || championArtist.images.thumb)}" alt="${pickHtml(championArtist.publicName)}" />
          </div>
        </article>
      `;
    } else {
      championRoot.innerHTML = renderHallOfFameWaiting(year);
    }
  } else {
    championRoot.innerHTML = renderHallOfFameWaiting(year);
  }

  // Closed months remain visible even when no winner was recorded.
  if (!_popularVote.monthlyPicksLoaded) {
    monthlyRoot.innerHTML = `<div class="vote-empty">${pickText("pick.archive.loadError", "월간 기록을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.")}</div>`;
    return;
  }
  const picks = _popularVote.monthlyPicks || [];
  const campaignStart = _popularVote.mainPick?.campaign?.startsAt || picks[0]?.campaign?.startsAt;
  const campaignDate = campaignStart ? new Date(campaignStart) : null;
  const campaignYear = campaignDate && !Number.isNaN(campaignDate.getTime())
    ? Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric" }).format(campaignDate))
    : null;
  const campaignMonth = campaignDate && !Number.isNaN(campaignDate.getTime())
    ? Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", month: "numeric" }).format(campaignDate))
    : null;
  const winnerMonths = picks.map(pick => Number(pick.month)).filter(month => Number.isInteger(month) && month >= 1 && month <= 12);
  const firstMonth = Math.min(
    ...(campaignYear === year && campaignMonth ? [campaignMonth] : []),
    ...winnerMonths,
    13
  );
  const lastClosedMonth = year < kstCurrentYear() ? 12 : kstCurrentMonth() - 1;
  if (firstMonth > lastClosedMonth) {
    monthlyRoot.innerHTML = `<div class="vote-empty">${year === kstCurrentYear()
      ? pickText("pick.archive.firstPending", "{year}년 첫 월간 1위는 팬들의 응원이 모이는 순간 이곳에 기록됩니다.", { year })
      : pickText("pick.archive.noYear", "{year}년 월간 선정 기록이 없습니다.", { year })}</div>`;
    return;
  }

  const picksByMonth = new Map(picks.map(pick => [Number(pick.month), pick]));
  const months = Array.from({ length: lastClosedMonth - firstMonth + 1 }, (_, index) => lastClosedMonth - index);
  monthlyRoot.innerHTML = months.map(month => {
    const pick = picksByMonth.get(month);
    const monthLabel = `${year}.${String(month).padStart(2, "0")}`;
    if (!pick) {
      return `<div class="vote-monthly-card vote-monthly-card-empty"><span class="vote-monthly-month">${monthLabel}</span><strong>${isMonthlyArchiveSettling(year, month)
        ? pickText("pick.archive.settling", "집계 확정 중")
        : pickText("pick.archive.noRecord", "선정 기록 없음")}</strong></div>`;
    }
    const artist = getCharacterBySlug(pick.artist?.slug || pick.slug || pick.artistSlug);
    const score = pick.totalWeightedScore ?? pick.totalFreeLikes ?? pick.totalScore ?? pick.score ?? 0;
    if (!artist) {
      return `
        <div class="vote-monthly-card vote-monthly-card-unknown">
          <span class="vote-monthly-month">${monthLabel}</span>
          <strong>${pickText("pick.archive.unknownArtist", "알 수 없는 아티스트")}</strong>
        </div>
      `;
    }
    return `
      <article class="vote-monthly-card clickable-card" data-href="${pickHtml(pickDetailUrl(artist.slug))}">
        <div class="vote-monthly-media">
          <img src="${pickHtml(artist.images.thumb || artist.images.cover)}" alt="${pickHtml(artist.publicName)}" />
        </div>
        <div class="vote-monthly-info">
          <span class="vote-monthly-month">${monthLabel}</span>
          <strong>${pickHtml(artist.publicName)}</strong>
          <small>${pickText("pick.rank.support", "{count} 응원", { count: formatPickCount(score) })}</small>
        </div>
      </article>
    `;
  }).join("");
}

function renderHallOfFameWaiting(year) {
  return `
    <div class="vote-year-waiting">
      <div class="vote-year-trophy" aria-hidden="true">🏆</div>
      <h3>${pickText("pick.year.champion", "{year} 연간 챔피언", { year })}</h3>
      <p>${pickText("pick.year.waiting", "이 자리는 올해 가장 오래 사랑받은 아티스트에게 열립니다. 매일의 응원이 1년의 영광으로 이어집니다.")}</p>
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
      b.tabIndex = isActive ? 0 : -1;
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
    b.addEventListener("click", () => {
      activate(b.dataset.tab);
      refreshPopularVotePageIfMonthChanged();
    });
  });
  root.addEventListener("keydown", event => {
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    let nextIndex;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % buttons.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = buttons.length - 1;
    else return;
    event.preventDefault();
    const next = buttons[nextIndex];
    activate(next.dataset.tab);
    next.focus();
    refreshPopularVotePageIfMonthChanged();
  });
  // URL ?tab=...로 초기 탭 결정
  const initialTab = new URLSearchParams(window.location.search).get("tab");
  if (initialTab && panels[initialTab]) {
    activate(initialTab);
  }
}

function renderArchiveYearOptions() {
  const select = document.getElementById("voteArchiveYear");
  if (!select) return;
  const currentYear = kstCurrentYear();
  select.innerHTML = Array.from({ length: currentYear - 2026 + 1 }, (_, index) => currentYear - index)
    .map(year => `<option value="${year}">${pickText("pick.archive.yearOption", "{year}년", { year })}</option>`).join("");
  select.value = String(_popularVote.archiveYear || currentYear);
  if (!select.dataset.bound) {
    select.dataset.bound = "1";
    select.addEventListener("change", async () => {
      const year = Number(select.value);
      if (!Number.isInteger(year) || year < 2026 || year > kstCurrentYear()) return;
      if (popularVoteRefresh) await popularVoteRefresh;
      if (Number(select.value) !== year) return;
      _popularVote.archiveYear = year;
      renderArchiveLoading();
      await refreshPopularVotePage();
    });
  }
}

function renderArchiveLoading() {
  for (const id of ["yearChampion", "monthlyPicksGrid"]) {
    const root = document.getElementById(id);
    if (root) root.innerHTML = `<div class="vote-empty">${pickText("pick.status.loading", "불러오는 중…")}</div>`;
  }
}

function refreshPopularVotePage() {
  if (popularVoteRefresh) return popularVoteRefresh;
  popularVoteRefresh = (async () => {
    // A boundary can pass during a slow read. Allow one catch-up, not an endless refresh loop.
    for (let attempt = 0; attempt < 2; attempt++) {
      const scope = kstPickScope();
      await Promise.all([
        loadBoostState().catch(() => {}),
        loadPopularVoteState(),
        loadFreeLikeQuota()
      ]);
      const latest = kstPickScope();
      if (scope.queryKey !== latest.queryKey) {
        _popularVote = { ..._popularVote, mainPick: null, monthlyPicks: [], monthlyPicksLoaded: false,
          yearChampion: null, yearChampionLoaded: false,
          archiveYear: scope.monthKey !== latest.monthKey ? latest.year : _popularVote.archiveYear,
          monthKey: null, loaded: false };
        archiveSettlementRefreshKey = null;
        renderMainPickTab();
        renderArchiveLoading();
        renderArchiveYearOptions();
        continue;
      }
      archiveSettlementRefreshKey = !latest.archiveSettling && _popularVote.monthlyPicksLoaded ? latest.monthKey : null;
      renderMainPickTab();
      renderDebutRaceTab();
      renderHallOfFameTab();
      updateHeroQuotaDisplay();
      return;
    }
  })().finally(() => { popularVoteRefresh = null; });
  return popularVoteRefresh;
}

function refreshPopularVotePageIfMonthChanged() {
  const scope = kstPickScope();
  const monthKey = scope.monthKey;
  if (_popularVote.monthKey !== monthKey) {
    archiveSettlementRefreshKey = null;
    _popularVote.archiveYear = scope.year;
    const select = document.getElementById("voteArchiveYear");
    if (select) renderArchiveYearOptions();
    return refreshPopularVotePage();
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23"
  }).formatToParts(new Date()).map(part => [part.type, Number(part.value)]));
  if (parts.day === 1 && parts.hour === 0 && parts.minute >= 10 && archiveSettlementRefreshKey !== monthKey) {
    archiveSettlementRefreshKey = monthKey;
    return refreshPopularVotePage().then(() => {
      if (!_popularVote.monthlyPicksLoaded) archiveSettlementRefreshKey = null;
    });
  }
}

function renderPopularVoteLocale() {
  renderMainPickTab();
  renderDebutRaceTab();
  if (popularVoteRefresh) renderArchiveLoading();
  else renderHallOfFameTab();
  renderArchiveYearOptions();
  updateHeroQuotaDisplay();
}

/* ── 루미나 픽 페이지 init ── */
async function initPopularVotePage() {
  await refreshPopularVotePage();
  bindVoteTabs();
  renderArchiveYearOptions();
  if (typeof window.setInterval === "function") window.setInterval(refreshPopularVotePageIfMonthChanged, 60000);
  if (typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshPopularVotePageIfMonthChanged();
    });
  }
  if (typeof window.addEventListener === "function") {
    window.addEventListener("lumina:localechange", renderPopularVoteLocale);
  }
}


window.initPopularVotePage = initPopularVotePage;
window.refreshPopularVotePage = refreshPopularVotePage;
})();
