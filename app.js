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
    note: "메인 A / 카리나 결",
    intro: "첫 유입을 책임지는 메인 비주얼. 차가운 무드와 강한 퍼포먼스를 함께 잡는 센터형 아이돌입니다.",
    concept: "시크하고 미래적인 무드, 뷰티와 향수 캠페인에 특히 강한 캐릭터.",
    profile: {
      포지션: "메인 비주얼 / 퍼포먼스",
      팬포인트: "강한 시선과 무대 장악력",
      운영상태: "주간 메인 노출",
      광고축: "뷰티 · 향수 · 패션 필름"
    },
    shorts: [
      { title: "메인 비주얼 티저", metric: "조회 12.4만" },
      { title: "콘셉트 퍼포먼스", metric: "조회 11.8만" },
      { title: "뷰티 무드 컷", metric: "저장 4.2천" }
    ]
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
    note: "메인 B / 장원영 결",
    intro: "대중성과 센터 감각이 강한 메인 아이돌. 밝고 반짝이는 무드로 팬 확장력이 높은 캐릭터입니다.",
    concept: "하이틴과 럭셔리 사이를 오가며 브랜드 친화력이 높은 확장형 아이돌.",
    profile: {
      포지션: "메인 아이돌 / 센터형",
      팬포인트: "정면 비주얼과 대중성",
      운영상태: "메인 2순위 노출",
      광고축: "패션 · 음료 · 라이프스타일"
    },
    shorts: [
      { title: "센터 무드 스냅", metric: "조회 9.7만" },
      { title: "하이틴 센터 포맷", metric: "조회 10.1만" },
      { title: "팬서비스 포토무드", metric: "좋아요 2.8만" }
    ]
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
    note: "메인 C / 쯔양 결",
    intro: "가장 친근하게 반응을 끌어오는 생활밀착형 스타. 댓글 전환과 커뮤니티 반응에 강한 캐릭터입니다.",
    concept: "친근함, 먹방/리액션, 생활형 포맷에 최적화된 팬덤 전환 캐릭터.",
    profile: {
      포지션: "커뮤니티 훅 / 스트리머",
      팬포인트: "리액션과 친근함",
      운영상태: "팬덤 전환 우선",
      광고축: "푸드 · 커머스 · 라이프"
    },
    shorts: [
      { title: "친근 리액션 포맷", metric: "조회 15.3만" },
      { title: "생활형 브이로그컷", metric: "댓글 1.1천" },
      { title: "먹방 리액션 티저", metric: "저장 3.7천" }
    ]
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
    note: "프리미엄 메인 / 김혜수 결",
    intro: "엔터 전체에 무게감을 부여하는 프리미엄 메인. 광고와 화보형 협업에 가장 먼저 연결되는 간판입니다.",
    concept: "럭셔리, 에디토리얼, 하이엔드 뷰티와 주얼리에 최적화된 브랜드형 캐릭터.",
    profile: {
      포지션: "프리미엄 메인 / 배우",
      팬포인트: "고급감과 존재감",
      운영상태: "광고·화보 우선",
      광고축: "주얼리 · 럭셔리 뷰티 · 에디토리얼"
    },
    shorts: [
      { title: "에디토리얼 컷 무드", metric: "조회 6.2만" },
      { title: "럭셔리 화보 티저", metric: "저장 2.1천" },
      { title: "브랜드 무드 필름", metric: "완주율 68%" }
    ]
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
    note: "감성형 보컬 라인",
    intro: "청아한 보컬 감성을 중심으로 데뷔를 준비 중인 라인입니다.",
    concept: "감정 몰입형 숏폼과 무드형 콘텐츠에 적합한 예비 아이돌.",
    profile: {
      포지션: "서브 아이돌 / 보컬",
      팬포인트: "청아함과 감성선",
      운영상태: "데뷔 예정",
      광고축: "감성 캠페인 · 뷰티"
    },
    shorts: [
      { title: "Debut Soon Mood", metric: "준비 중" }
    ]
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
    note: "성숙한 섹시 러블리형",
    intro: "성숙한 매력과 러블리함을 함께 가진 데뷔 예정 라인입니다.",
    concept: "무대형 퍼포먼스와 스타일링 확장이 가능한 보조 아이돌 포지션.",
    profile: {
      포지션: "서브 아이돌 / 무대형",
      팬포인트: "성숙함과 무대감",
      운영상태: "데뷔 예정",
      광고축: "패션 · 뷰티"
    },
    shorts: [
      { title: "Debut Soon Performance", metric: "준비 중" }
    ]
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
    note: "내추럴 럭셔리형",
    intro: "자연스러운 고급감을 보여주는 데뷔 예정 모델 라인입니다.",
    concept: "뷰티와 리빙 브랜드에 맞는 잔잔하고 우아한 무드.",
    profile: {
      포지션: "서브 모델",
      팬포인트: "호감형 우아함",
      운영상태: "데뷔 예정",
      광고축: "스킨케어 · 리빙"
    },
    shorts: [
      { title: "Debut Soon Beauty", metric: "준비 중" }
    ]
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
    note: "시크릿 / 모델 라인",
    intro: "공개 전 시크릿 라인입니다. 정체와 구체 설정은 아직 열리지 않았습니다.",
    concept: "티저와 실루엣만 먼저 공개되는 시크릿 모델 포지션.",
    profile: {
      포지션: "시크릿 모델",
      팬포인트: "비공개",
      운영상태: "시크릿",
      광고축: "비공개"
    },
    shorts: [
      { title: "Secret Teaser", metric: "비공개" }
    ]
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
    note: "시크릿 / 배우 라인",
    intro: "배우 라인의 시크릿 포지션으로, 공개 전까지 실루엣만 유지합니다.",
    concept: "고급감 있는 티저 운영 전용 시크릿 배우 포지션.",
    profile: {
      포지션: "시크릿 배우",
      팬포인트: "비공개",
      운영상태: "시크릿",
      광고축: "비공개"
    },
    shorts: [
      { title: "Secret Teaser", metric: "비공개" }
    ]
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
    note: "시크릿 / 스타일형",
    intro: "스타일 라인의 실험형 시크릿 캐릭터입니다.",
    concept: "차후 반응을 보고 공개 여부를 정하는 스타일형 후보.",
    profile: {
      포지션: "시크릿 스타일형",
      팬포인트: "비공개",
      운영상태: "시크릿",
      광고축: "비공개"
    },
    shorts: [
      { title: "Secret Teaser", metric: "비공개" }
    ]
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

const businessPackages = [
  {
    name: "Shortform Campaign",
    target: "뷰티 / 패션 / 커머스",
    summary: "메인 캐릭터를 활용한 숏폼 광고 세트와 SNS 노출 패키지",
    deliverables: ["숏폼 3종", "썸네일 3종", "브랜드 컷 1세트"]
  },
  {
    name: "Premium Editorial",
    target: "주얼리 / 럭셔리 / 에디토리얼",
    summary: "프리미엄 라인 중심의 화보형 콘텐츠와 브랜드 무드 연출",
    deliverables: ["에디토리얼 컷", "브랜드 티저", "룩북형 이미지"]
  },
  {
    name: "Character Branding",
    target: "브랜드 콜라보 / IP 협업",
    summary: "캐릭터 설정, 세계관, 반복 노출 구조를 함께 설계하는 브랜딩형 패키지",
    deliverables: ["캐릭터 협업안", "콘텐츠 콘셉트", "운영 제안"]
  }
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
        <article class="artist-card clickable-card" data-href="./character-detail.html?slug=${artist.slug || characters.find((item) => item.name === artist.name)?.slug || ""}">
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
            <a class="text-link" href="./character-detail.html?slug=${artist.slug || characters.find((item) => item.name === artist.name)?.slug || ""}">상세 보기</a>
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

function renderShortformHub() {
  const root = document.getElementById("shortformHub");
  if (!root) return;

  root.innerHTML = shortforms
    .map(
      (item) => `
        <article class="feed-card">
          <div class="feed-card-media">
            <span class="eyebrow">${item.artist}</span>
            <strong>${item.title}</strong>
          </div>
          <div class="feed-card-body">
            <div class="short-meta">
              <span>${item.metric}</span>
              <span>${item.artist}</span>
            </div>
            <p>${item.tone}</p>
            <a class="text-link" href="./characters.html">캐릭터 보기</a>
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
        <article class="roster-card ${statusMeta[artist.status].className} clickable-card" data-href="./character-detail.html?slug=${characters.find((item) => item.publicName === artist.name)?.slug || ""}" data-secret="${artist.status === "secret" ? "true" : "false"}">
          <div class="roster-media roster-media-${artist.status}">
            <strong>${artist.name}</strong>
          </div>
          <div class="roster-body">
            <div class="roster-meta">
              <span class="eyebrow">${artist.type}</span>
              <span class="status-badge status-badge-${artist.status}">${statusMeta[artist.status].label}</span>
            </div>
            <p>${artist.note}</p>
            <a class="text-link ${artist.status === "secret" ? "is-dimmed" : ""}" href="./character-detail.html?slug=${characters.find((item) => item.publicName === artist.name)?.slug || ""}">프로필 보기</a>
          </div>
        </article>
      `
    )
    .join("");
}

function renderCharacterCatalog(filter = "all", tagFilter = "") {
  const root = document.getElementById("characterCatalog");
  if (!root) return;

  let filtered = filter === "all"
    ? characters
    : characters.filter((artist) => artist.type === filter || artist.tier === filter);

  if (tagFilter) {
    filtered = filtered.filter((artist) => artist.tags.includes(tagFilter));
  }

  root.innerHTML = filtered
    .map(
      (artist) => `
        <article class="catalog-card ${statusMeta[artist.status].className} clickable-card" data-href="./character-detail.html?slug=${artist.slug}" data-secret="${artist.status === "secret" ? "true" : "false"}">
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
            <a class="text-link ${artist.status === "secret" ? "is-dimmed" : ""}" href="./character-detail.html?slug=${artist.slug}">상세 페이지</a>
          </div>
        </article>
      `
    )
    .join("");

  const note = document.getElementById("activeFilterNote");
  if (!note) return;

  if (tagFilter) {
    note.innerHTML = `
      <span>현재 태그 필터: <strong>${tagFilter}</strong></span>
      <a href="./characters.html" class="text-link">필터 해제</a>
    `;
  } else {
    note.innerHTML = "";
  }
}

function bindCharacterFilters() {
  const filterRoot = document.getElementById("characterFilters");
  if (!filterRoot) return;

  const buttons = [...filterRoot.querySelectorAll("[data-filter]")];
  const params = new URLSearchParams(window.location.search);
  const activeTag = params.get("tag") || "";

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      renderCharacterCatalog(button.dataset.filter, activeTag);
    });
  });

  if (activeTag) {
    renderCharacterCatalog("all", activeTag);
  }
}

function renderCharacterDetail() {
  const hero = document.getElementById("detailHero");
  if (!hero) return;

  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug");
  const artist = characters.find((item) => item.slug === slug) || characters[0];
  const status = statusMeta[artist.status];

  document.title = `${artist.publicName} | AI Entertainment Studio`;

  hero.className = `detail-hero-card ${status.className}`;
  hero.innerHTML = `
    <span class="eyebrow">${artist.type}</span>
    <strong>${artist.publicName}</strong>
    <em class="catalog-status-caption">${status.label}</em>
  `;

  const intro = document.getElementById("detailIntro");
  if (intro) {
    intro.innerHTML = `
      <p class="eyebrow">Official Profile</p>
      <h1>${artist.publicName}</h1>
      <p class="detail-summary">${artist.summary}</p>
      <p>${artist.intro}</p>
      <p>${artist.concept}</p>
    `;
  }

  const meta = document.getElementById("detailMeta");
  if (meta) {
    meta.innerHTML = `
      <div class="status-badge status-badge-${artist.status}">${status.label}</div>
      <div class="tag-list">
        <span>${artist.reference}</span>
        <span>${artist.type}</span>
        <span>${artist.tier}</span>
      </div>
    `;
  }

  const profile = document.getElementById("detailProfile");
  if (profile) {
    profile.innerHTML = Object.entries(artist.profile)
      .map(
        ([label, value]) => `
          <div>
            <dt>${label}</dt>
            <dd>${value}</dd>
          </div>
        `
      )
      .join("");
  }

  const shortsRoot = document.getElementById("detailShorts");
  if (shortsRoot) {
    shortsRoot.innerHTML = artist.shorts
      .map(
        (item) => `
          <article class="detail-short-card">
            <div class="detail-short-media ${status.className}">
              <span class="eyebrow">${artist.publicName}</span>
              <strong>${item.title}</strong>
            </div>
            <div class="detail-short-body">
              <span>${item.metric}</span>
            </div>
          </article>
        `
      )
      .join("");
  }

  const cta = document.getElementById("detailCta");
  if (cta) {
    cta.innerHTML = artist.status === "secret"
      ? `
        <div class="detail-cta-card is-secret">
          <strong>공개 전 시크릿 라인입니다</strong>
          <p>현재는 실루엣과 상태만 공개되며, 숏폼 반응 전략에 따라 공개 순서를 조정합니다.</p>
        </div>
      `
      : `
        <div class="detail-cta-card">
          <strong>팬 반응과 숏폼 지표를 모으는 단계입니다</strong>
          <p>후원과 캐릭터챗은 나중 단계에서 붙고, 지금은 캐릭터와 대표 숏폼을 중심으로 팬 유입을 설계합니다.</p>
        </div>
      `;
  }

  const tagNav = document.getElementById("detailTagNavigation");
  if (tagNav) {
    tagNav.innerHTML = artist.tags
      .map(
        (tag) => `
          <a class="tag-link" href="./characters.html?tag=${encodeURIComponent(tag)}">${tag}</a>
        `
      )
      .join("");
  }
}

function renderBusinessPackages() {
  const root = document.getElementById("businessPackageGrid");
  if (!root) return;

  root.innerHTML = businessPackages
    .map(
      (item) => `
        <article class="package-card">
          <span class="eyebrow">${item.target}</span>
          <strong>${item.name}</strong>
          <p>${item.summary}</p>
          <ul class="package-list">
            ${item.deliverables.map((detail) => `<li>${detail}</li>`).join("")}
          </ul>
        </article>
      `
    )
    .join("");
}

function bindCardNavigation() {
  const cards = [...document.querySelectorAll(".clickable-card")];
  if (!cards.length) return;

  cards.forEach((card) => {
    card.tabIndex = 0;
    card.setAttribute("role", "link");

    const navigate = () => {
      const href = card.dataset.href;
      if (!href) return;

      const isSecret = card.dataset.secret === "true";

      if (isSecret) {
        document.body.classList.add("is-secret-transition");

        const overlay = document.createElement("div");
        overlay.className = "secret-transition";
        overlay.innerHTML = `
          <div class="secret-transition-panel">
            <span>Secret Access</span>
            <strong>비공개 프로필에 접근 중입니다</strong>
          </div>
        `;
        document.body.appendChild(overlay);

        window.setTimeout(() => {
          window.location.href = href;
        }, 540);
        return;
      }

      window.location.href = href;
    };

    card.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      navigate();
    });

    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        navigate();
      }
    });
  });
}

renderMainArtists();
renderShortforms();
renderShortformHub();
renderBusinessPackages();
renderRoster();
renderCharacterCatalog();
bindCharacterFilters();
renderCharacterDetail();
bindCardNavigation();
