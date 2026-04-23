const characters = [
  {
    name: "윤세린",
    publicName: "윤세린",
    slug: "yoon-serin",
    type: "아이돌",
    tier: "main",
    status: "public",
    reference: "카리나 결",
    summary: "냉미녀 퍼포먼스형 메인 비주얼",
    fandom: "강한 비주얼 입덕형",
    business: "뷰티, 향수, 패션 필름",
    tags: ["시크", "퍼포먼스", "뷰티"],
    note: "메인 A / 카리나 결"
  },
  {
    name: "한서율",
    publicName: "한서율",
    slug: "han-seoyul",
    type: "아이돌",
    tier: "main",
    status: "public",
    reference: "장원영 결",
    summary: "센터형 대중성과 하이틴 무드",
    fandom: "대중형 확장형",
    business: "패션, 음료, 라이프스타일",
    tags: ["센터", "하이틴", "대중성"],
    note: "메인 B / 장원영 결"
  },
  {
    name: "박도아",
    publicName: "박도아",
    slug: "park-doa",
    type: "스트리머",
    tier: "main",
    status: "public",
    reference: "쯔양 결",
    summary: "친근함과 생활감이 강한 커뮤니티형 스타",
    fandom: "댓글·호감 전환형",
    business: "푸드, 라이프, 커머스",
    tags: ["친근함", "리액션", "생활형"],
    note: "메인 C / 쯔양 결"
  },
  {
    name: "최서진",
    publicName: "최서진",
    slug: "choi-seojin",
    type: "배우",
    tier: "premium",
    status: "public",
    reference: "김혜수 결",
    summary: "럭셔리·에디토리얼에 강한 프리미엄 메인",
    fandom: "프리미엄 선망형",
    business: "주얼리, 럭셔리 뷰티, 에디토리얼",
    tags: ["럭셔리", "에디토리얼", "프리미엄"],
    note: "프리미엄 메인 / 김혜수 결"
  },
  {
    name: "오해린",
    publicName: "오해린",
    slug: "oh-haerin",
    type: "아이돌",
    tier: "sub",
    status: "debut",
    reference: "태연 결",
    summary: "감성 보컬 중심의 청아한 라인",
    fandom: "감성 몰입형",
    business: "음향, 감성 캠페인, 뷰티",
    tags: ["보컬", "감성", "청아함"],
    note: "감성형 보컬 라인"
  },
  {
    name: "민채온",
    publicName: "민채온",
    slug: "min-chaeon",
    type: "아이돌",
    tier: "sub",
    status: "debut",
    reference: "전효성 결",
    summary: "성숙한 섹시 러블리 포지션",
    fandom: "직관적 매력 소비형",
    business: "패션, 뷰티, 퍼포먼스형 광고",
    tags: ["성숙함", "러블리", "무대형"],
    note: "성숙한 섹시 러블리형"
  },
  {
    name: "서유안",
    publicName: "서유안",
    slug: "seo-yuan",
    type: "모델",
    tier: "sub",
    status: "debut",
    reference: "한효주 결",
    summary: "내추럴 럭셔리 톤의 뷰티 모델",
    fandom: "호감·선망형",
    business: "스킨케어, 리빙, 뷰티",
    tags: ["내추럴", "우아함", "뷰티"],
    note: "내추럴 럭셔리형"
  },
  {
    name: "강시아",
    publicName: "Secret Trainee 01",
    slug: "kang-sia",
    type: "모델",
    tier: "sub",
    status: "secret",
    reference: "신민아 결",
    summary: "도시적이고 세련된 패션 라인",
    fandom: "공개 전",
    business: "비공개",
    tags: ["Secret", "Model", "Soon"],
    note: "시크릿 / 모델 라인"
  },
  {
    name: "이지원",
    publicName: "Secret Trainee 02",
    slug: "lee-jiwon",
    type: "배우",
    tier: "experiment",
    status: "secret",
    reference: "전지현 결",
    summary: "고급스럽고 대중적인 톱스타 포지션",
    fandom: "공개 전",
    business: "비공개",
    tags: ["Secret", "Actor", "Soon"],
    note: "시크릿 / 배우 라인"
  },
  {
    name: "하윤아",
    publicName: "Secret Trainee 03",
    slug: "ha-yuna",
    type: "배우",
    tier: "experiment",
    status: "secret",
    reference: "나나 결",
    summary: "도회적이고 스타일리시한 올라운더",
    fandom: "공개 전",
    business: "비공개",
    tags: ["Secret", "Style", "Soon"],
    note: "시크릿 / 스타일형"
  }
];

const statusMeta = {
  public: {
    label: "공개 활동 중",
    summaryLabel: "공개 중",
    className: "is-public"
  },
  debut: {
    label: "데뷔 예정",
    summaryLabel: "Debut Soon",
    className: "is-debut"
  },
  secret: {
    label: "시크릿",
    summaryLabel: "Secret",
    className: "is-secret"
  }
};

const mainArtists = [
  {
    name: "윤세린",
    role: "Main Visual A",
    description: "냉미녀 퍼포먼스형. 첫 유입과 강한 비주얼 각인을 담당하는 메인 간판.",
    tags: ["카리나 결", "퍼포먼스", "뷰티/향수"]
  },
  {
    name: "한서율",
    role: "Main Visual B",
    description: "센터형 대중성. 안정적인 팬 확장과 엔터사 메인 아티스트 포지션에 적합.",
    tags: ["장원영 결", "센터형", "대중성"]
  },
  {
    name: "박도아",
    role: "Community Hook",
    description: "친근하고 생활감 있는 캐릭터. 댓글 반응과 향후 팬덤 전환에 강함.",
    tags: ["쯔양 결", "친근함", "생활형"]
  },
  {
    name: "최서진",
    role: "Premium Main",
    description: "고급감과 존재감을 살린 프리미엄 라인. 광고와 화보형 무드에 강함.",
    tags: ["김혜수 결", "럭셔리", "프리미엄"]
  }
];

const shortforms = [
  { title: "메인 비주얼 티저", artist: "윤세린", metric: "조회 12.4만", tone: "강한 첫인상과 표정 변화 중심" },
  { title: "센터 무드 스냅", artist: "한서율", metric: "조회 9.7만", tone: "정면 비주얼과 대중성 중심" },
  { title: "친근 리액션 포맷", artist: "박도아", metric: "조회 15.3만", tone: "생활형 리액션과 팬서비스 중심" },
  { title: "에디토리얼 컷 무드", artist: "최서진", metric: "조회 6.2만", tone: "화보형 무드와 광고 적합도 강조" },
  { title: "콘셉트 퍼포먼스", artist: "윤세린", metric: "조회 11.8만", tone: "세련된 콘셉트와 퍼포먼스 무드" },
  { title: "하이틴 센터 포맷", artist: "한서율", metric: "조회 10.1만", tone: "밝고 반짝이는 센터형 무드" }
];

const roster = characters.map((artist) => ({
  name: artist.publicName,
  type: artist.type,
  note: artist.note,
  status: artist.status
}));

function renderMainArtists() {
  const root = document.getElementById("mainArtistGrid");
  if (!root) return;
  root.innerHTML = mainArtists
    .map(
      (artist) => `
        <article class="artist-card">
          <div class="artist-media">
            <div>
              <span class="eyebrow">${artist.role}</span>
              <strong>${artist.name}</strong>
            </div>
          </div>
          <div class="artist-body">
            <p>${artist.description}</p>
            <div class="tag-list">
              ${artist.tags.map((tag) => `<span>${tag}</span>`).join("")}
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderShortforms() {
  const root = document.getElementById("shortformGrid");
  if (!root) return;
  root.innerHTML = shortforms
    .map(
      (item) => `
        <article class="short-card">
          <div class="short-media">
            <span class="eyebrow">${item.artist}</span>
            <strong>${item.title}</strong>
          </div>
          <div class="short-body">
            <div class="short-meta">
              <span>${item.metric}</span>
              <span>${item.artist}</span>
            </div>
            <p>${item.tone}</p>
          </div>
        </article>
      `
    )
    .join("");
}

function renderRoster() {
  const root = document.getElementById("rosterGrid");
  if (!root) return;
  root.innerHTML = roster
    .map(
      (artist) => `
        <article class="roster-card ${statusMeta[artist.status].className}">
          <div class="roster-media roster-media-${artist.status}">
            <strong>${artist.name}</strong>
          </div>
          <div class="roster-body">
            <div class="roster-meta">
              <span class="eyebrow">${artist.type}</span>
              <span class="status-badge status-badge-${artist.status}">${statusMeta[artist.status].label}</span>
            </div>
            <p>${artist.note}</p>
          </div>
        </article>
      `
    )
    .join("");
}

function renderCharacterCatalog(filter = "all") {
  const root = document.getElementById("characterCatalog");
  if (!root) return;

  const filtered = filter === "all"
    ? characters
    : characters.filter((artist) => artist.type === filter || artist.tier === filter);

  root.innerHTML = filtered
    .map(
      (artist) => `
        <article class="catalog-card ${statusMeta[artist.status].className}">
          <div class="catalog-media catalog-media-${artist.tier} catalog-media-${artist.status}">
            <span class="eyebrow">${artist.type}</span>
            <strong>${artist.publicName}</strong>
            <em class="catalog-status-caption">${statusMeta[artist.status].summaryLabel}</em>
          </div>
          <div class="catalog-body">
            <div class="catalog-meta">
              <span>${statusMeta[artist.status].label}</span>
              <span>${artist.tier}</span>
            </div>
            <p class="catalog-summary">${artist.summary}</p>
            <dl class="catalog-details">
              <div>
                <dt>팬 포인트</dt>
                <dd>${artist.fandom}</dd>
              </div>
              <div>
                <dt>광고 적합</dt>
                <dd>${artist.business}</dd>
              </div>
            </dl>
            <div class="tag-list">
              ${artist.tags.map((tag) => `<span>${tag}</span>`).join("")}
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function bindCharacterFilters() {
  const filterRoot = document.getElementById("characterFilters");
  if (!filterRoot) return;

  const buttons = [...filterRoot.querySelectorAll("[data-filter]")];

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      renderCharacterCatalog(button.dataset.filter);
    });
  });
}

renderMainArtists();
renderShortforms();
renderRoster();
renderCharacterCatalog();
bindCharacterFilters();
