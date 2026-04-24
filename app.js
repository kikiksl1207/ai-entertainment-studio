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
    images: {
      cover: "./assets/characters/yoon-serin/cover.png",
      thumb: "./assets/characters/yoon-serin/thumb.png"
    },
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
    images: {
      cover: "./assets/characters/han-seoyul/cover.png",
      thumb: "./assets/characters/han-seoyul/thumb.png"
    },
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
    images: {
      cover: "./assets/characters/park-doa/cover.png",
      thumb: "./assets/characters/park-doa/thumb.png"
    },
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
    images: {
      cover: "./assets/characters/choi-seojin/cover.png",
      thumb: "./assets/characters/choi-seojin/thumb.png"
    },
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
    images: {
      cover: "./assets/characters/oh-haerin/cover.jpg",
      thumb: "./assets/characters/oh-haerin/thumb.jpg"
    },
    intro: "청아한 보컬 감성을 중심으로 데뷔를 준비 중인 라인입니다.",
    concept: "감정 몰입형 숏폼과 무드형 콘텐츠에 적합한 예비 아이돌.",
    profile: {
      포지션: "서브 아이돌 / 보컬",
      팬포인트: "청아함과 감성선",
      운영상태: "데뷔 예정",
      광고축: "감성 캠페인 · 뷰티"
    },
    shorts: [
      { title: "데뷔 예정 무드", metric: "준비 중" }
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
    images: {
      cover: "./assets/characters/min-chaeon/cover.jpg",
      thumb: "./assets/characters/min-chaeon/thumb.jpg"
    },
    intro: "성숙한 매력과 러블리함을 함께 가진 데뷔 예정 라인입니다.",
    concept: "무대형 퍼포먼스와 스타일링 확장이 가능한 보조 아이돌 포지션.",
    profile: {
      포지션: "서브 아이돌 / 무대형",
      팬포인트: "성숙함과 무대감",
      운영상태: "데뷔 예정",
      광고축: "패션 · 뷰티"
    },
    shorts: [
      { title: "데뷔 예정 퍼포먼스", metric: "준비 중" }
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
    images: {
      cover: "./assets/characters/seo-yuan/cover.jpg",
      thumb: "./assets/characters/seo-yuan/thumb.jpg"
    },
    intro: "자연스러운 고급감을 보여주는 데뷔 예정 모델 라인입니다.",
    concept: "뷰티와 리빙 브랜드에 맞는 잔잔하고 우아한 무드.",
    profile: {
      포지션: "서브 모델",
      팬포인트: "호감형 우아함",
      운영상태: "데뷔 예정",
      광고축: "스킨케어 · 리빙"
    },
    shorts: [
      { title: "데뷔 예정 뷰티", metric: "준비 중" }
    ]
  },
  {
    name: "강시아",
    publicName: "시크릿 트레이니 01",
    slug: "kang-sia",
    type: "모델",
    tier: "sub",
    status: "secret",
    reference: "신민아 결",
    summary: "도시적이고 세련된 패션 라인",
    fandom: "공개 전",
    business: "비공개",
    tags: ["시크릿", "모델", "공개예정"],
    note: "시크릿 / 모델 라인",
    images: {
      cover: "./assets/characters/kang-sia/cover.jpg",
      thumb: "./assets/characters/kang-sia/thumb.jpg"
    },
    intro: "공개 전 시크릿 라인입니다. 정체와 구체 설정은 아직 열리지 않았습니다.",
    concept: "티저와 실루엣만 먼저 공개되는 시크릿 모델 포지션.",
    profile: {
      포지션: "시크릿 모델",
      팬포인트: "비공개",
      운영상태: "시크릿",
      광고축: "비공개"
    },
    shorts: [
      { title: "시크릿 티저", metric: "비공개" }
    ]
  },
  {
    name: "이지원",
    publicName: "시크릿 트레이니 02",
    slug: "lee-jiwon",
    type: "배우",
    tier: "experiment",
    status: "secret",
    reference: "전지현 결",
    summary: "고급스럽고 대중적인 톱스타 포지션",
    fandom: "공개 전",
    business: "비공개",
    tags: ["시크릿", "배우", "공개예정"],
    note: "시크릿 / 배우 라인",
    images: {
      cover: "./assets/characters/lee-jiwon/cover.jpg",
      thumb: "./assets/characters/lee-jiwon/thumb.jpg"
    },
    intro: "배우 라인의 시크릿 포지션으로, 공개 전까지 실루엣만 유지합니다.",
    concept: "고급감 있는 티저 운영 전용 시크릿 배우 포지션.",
    profile: {
      포지션: "시크릿 배우",
      팬포인트: "비공개",
      운영상태: "시크릿",
      광고축: "비공개"
    },
    shorts: [
      { title: "시크릿 티저", metric: "비공개" }
    ]
  },
  {
    name: "하윤아",
    publicName: "시크릿 트레이니 03",
    slug: "ha-yuna",
    type: "배우",
    tier: "experiment",
    status: "secret",
    reference: "나나 결",
    summary: "도회적이고 스타일리시한 올라운더",
    fandom: "공개 전",
    business: "비공개",
    tags: ["시크릿", "스타일", "공개예정"],
    note: "시크릿 / 스타일형",
    images: {
      cover: "./assets/characters/ha-yuna/cover.jpg",
      thumb: "./assets/characters/ha-yuna/thumb.jpg"
    },
    intro: "스타일 라인의 실험형 시크릿 캐릭터입니다.",
    concept: "차후 반응을 보고 공개 여부를 정하는 스타일형 후보.",
    profile: {
      포지션: "시크릿 스타일형",
      팬포인트: "비공개",
      운영상태: "시크릿",
      광고축: "비공개"
    },
    shorts: [
      { title: "시크릿 티저", metric: "비공개" }
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
    summaryLabel: "곧 공개",
    className: "is-debut"
  },
  secret: {
    label: "시크릿",
    summaryLabel: "시크릿",
    className: "is-secret"
  }
};

const mainArtists = [
  {
    name: "윤세린",
    role: "대표 비주얼",
    description: "첫 유입과 강한 인상을 책임지는 메인 대표 캐릭터. 사이트 첫 화면에서 가장 먼저 각인되는 중심 축입니다.",
    tags: ["메인 대표", "퍼포먼스", "뷰티/향수"]
  },
  {
    name: "한서율",
    role: "센터 확장",
    description: "밝고 안정적인 센터 무드로 팬층을 넓히는 확장 축. 대중형 아이돌 라인을 맡는 캐릭터입니다.",
    tags: ["센터형", "대중성", "확장"]
  },
  {
    name: "박도아",
    role: "팬 소통형",
    description: "친근함과 생활감으로 댓글 반응을 끌어오는 캐릭터. 팬 전환과 커뮤니티 분위기를 담당합니다.",
    tags: ["쯔양 결", "친근함", "생활형"]
  },
  {
    name: "최서진",
    role: "프리미엄 간판",
    description: "광고, 화보, 브랜드 무드에 강한 프리미엄 라인. 사이트 전체의 고급감을 끌어올리는 간판 캐릭터입니다.",
    tags: ["김혜수 결", "럭셔리", "프리미엄"]
  }
];

const shortforms = [
  { title: "메인 비주얼 티저", artist: "윤세린", metric: "조회 12.4만", tone: "첫 유입용 메인 비주얼 포맷, 강한 시선과 퍼포먼스 무드 중심" },
  { title: "콘셉트 퍼포먼스", artist: "윤세린", metric: "조회 11.8만", tone: "무대 장악력과 퍼포먼스 센터 이미지를 강화하는 핵심 포맷" },
  { title: "센터 무드 스냅", artist: "한서율", metric: "조회 9.7만", tone: "정면 비주얼과 대중성 확장을 담당하는 센터형 포맷" },
  { title: "하이틴 센터 포맷", artist: "한서율", metric: "조회 10.1만", tone: "밝고 반짝이는 센터 무드로 팬 확장을 노리는 포맷" },
  { title: "친근 리액션 포맷", artist: "박도아", metric: "조회 15.3만", tone: "생활형 리액션과 댓글 반응을 팬 전환으로 연결하는 포맷" },
  { title: "먹방 리액션 티저", artist: "박도아", metric: "저장 3.7천", tone: "친근한 먹방 크리에이터 무드로 호감과 참여를 끌어오는 포맷" },
  { title: "에디토리얼 컷 무드", artist: "최서진", metric: "조회 6.2만", tone: "브랜드 제안과 화보형 무드를 보여주는 프리미엄 포맷" },
  { title: "브랜드 무드 필름", artist: "최서진", metric: "완주율 68%", tone: "광고·화보 적합도를 직접 보여주는 프리미엄 쇼케이스 포맷" }
];

const businessPackages = [
  {
    name: "숏폼 캠페인",
    target: "뷰티 / 패션 / 커머스",
    summary: "메인 캐릭터를 활용한 숏폼 광고 세트와 SNS 노출 패키지",
    deliverables: ["숏폼 3종", "썸네일 3종", "브랜드 컷 1세트"]
  },
  {
    name: "프리미엄 에디토리얼",
    target: "주얼리 / 럭셔리 / 에디토리얼",
    summary: "프리미엄 라인 중심의 화보형 콘텐츠와 브랜드 무드 연출",
    deliverables: ["에디토리얼 컷", "브랜드 티저", "룩북형 이미지"]
  },
  {
    name: "캐릭터 브랜딩",
    target: "브랜드 콜라보 / IP 협업",
    summary: "캐릭터 설정, 세계관, 반복 노출 구조를 함께 설계하는 브랜딩형 패키지",
    deliverables: ["캐릭터 협업안", "콘텐츠 콘셉트", "운영 제안"]
  }
];

const featuredRoster = characters.filter((artist) => ["yoon-serin", "han-seoyul", "park-doa", "choi-seojin"].includes(artist.slug));

const roster = characters.map((artist) => ({
  name: artist.publicName,
  type: artist.type,
  note: artist.note,
  status: artist.status,
  slug: artist.slug,
  thumb: artist.images.thumb
}));

function getCharacterByName(name) {
  return characters.find((artist) => artist.publicName === name || artist.name === name);
}

function mediaStyle(path) {
  if (!path) return "";
  return `style="background-image: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(22,18,32,0.16)), url('${path}')"`
}

function renderCatalogMedia(artist) {
  const status = statusMeta[artist.status];

  if (artist.status === "secret") {
    return `
      <div class="catalog-media catalog-media-${artist.tier} catalog-media-${artist.status}">
        <div class="catalog-overlay">
          <span class="eyebrow">${artist.type}</span>
          <strong>${artist.publicName}</strong>
          <em class="catalog-status-caption">${status.summaryLabel}</em>
        </div>
      </div>
    `;
  }

  return `
    <div class="catalog-media catalog-media-${artist.tier} catalog-media-${artist.status}">
      <img class="catalog-image" src="${artist.images.cover}" alt="${artist.publicName}" />
      <div class="catalog-overlay">
        <em class="catalog-status-caption">${status.summaryLabel}</em>
      </div>
    </div>
  `;
}

function renderMainArtists() {
  const root = document.getElementById("mainArtistGrid");
  if (!root) return;
  root.innerHTML = mainArtists
    .map(
      (artist) => {
        const source = getCharacterByName(artist.name);
        const mediaSrc = source?.images.thumb || source?.images.cover || "";
        return `
        <article class="artist-card clickable-card" data-href="./character-detail.html?slug=${artist.slug || source?.slug || ""}">
          <div class="artist-media">
            <img class="artist-media-image" src="${mediaSrc}" alt="${artist.name}" />
            <div class="artist-media-copy">
              <span class="artist-role">${artist.role}</span>
              <strong>${artist.name}</strong>
            </div>
          </div>
          <div class="artist-body">
            <p>${artist.description}</p>
            <div class="tag-list">
              ${artist.tags.map((tag) => `<span>${tag}</span>`).join("")}
            </div>
            <a class="text-link" href="./character-detail.html?slug=${artist.slug || source?.slug || ""}">상세 보기</a>
          </div>
        </article>
      `;
      }
    )
    .join("");
}

function renderShortforms() {
  const root = document.getElementById("shortformGrid");
  if (!root) return;
  root.innerHTML = shortforms
    .map(
      (item) => {
        const artist = getCharacterByName(item.artist);
        const image = artist?.images.thumb || artist?.images.cover || "";
        return `
        <article class="short-card clickable-card" data-href="./character-detail.html?slug=${artist?.slug || ""}">
          <div class="short-card-head">
            <span class="eyebrow">${item.artist}</span>
            <strong>${item.title}</strong>
          </div>
          <div class="short-media"${mediaStyle(image)}>
            <span class="short-media-metric">${item.metric}</span>
          </div>
          <div class="short-body">
            <div class="short-meta">
              <span>${item.metric}</span>
              <span>${item.artist}</span>
            </div>
            <p>${item.tone}</p>
            <a class="text-link" href="./character-detail.html?slug=${artist?.slug || ""}">캐릭터 상세</a>
          </div>
        </article>
      `;
      }
    )
    .join("");
}

function renderShortformHub() {
  const root = document.getElementById("shortformHub");
  if (!root) return;

  root.innerHTML = shortforms
    .map(
      (item) => {
        const artist = getCharacterByName(item.artist);
          const image = artist?.images.thumb || artist?.images.cover || "";
        return `
        <article class="feed-card clickable-card" data-href="./character-detail.html?slug=${artist?.slug || ""}">
          <div class="feed-card-head">
            <span class="eyebrow">${item.artist}</span>
            <strong>${item.title}</strong>
          </div>
          <div class="feed-card-media"${mediaStyle(image)}>
            <span class="feed-card-chip">${artist?.type || ""}</span>
          </div>
          <div class="feed-card-body">
            <div class="short-meta">
              <span>${item.metric}</span>
              <span>${item.artist}</span>
            </div>
            <p>${item.tone}</p>
            <a class="text-link" href="./character-detail.html?slug=${artist?.slug || ""}">캐릭터 보기</a>
          </div>
        </article>
      `;
      }
    )
    .join("");
}

function renderRoster() {
  const root = document.getElementById("rosterGrid");
  if (!root) return;
  root.innerHTML = featuredRoster
    .map(
      (artist) => `
        <article class="roster-card ${statusMeta[artist.status].className} clickable-card" data-href="./character-detail.html?slug=${artist.slug}" data-secret="${artist.status === "secret" ? "true" : "false"}">
          <div class="roster-media roster-media-${artist.status}"${mediaStyle(artist.images.thumb || artist.images.cover)}>
            <strong>${artist.publicName}</strong>
          </div>
          <div class="roster-body">
            <div class="roster-meta">
              <span class="eyebrow">${artist.type}</span>
              <span class="status-badge status-badge-${artist.status}">${statusMeta[artist.status].label}</span>
            </div>
            <p>${artist.summary}</p>
            <a class="text-link ${artist.status === "secret" ? "is-dimmed" : ""}" href="./character-detail.html?slug=${artist.slug}">프로필 보기</a>
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
          ${renderCatalogMedia(artist)}
          <div class="catalog-body">
            <h3 class="catalog-name">${artist.publicName}</h3>
            <div class="catalog-meta">
              <span>${statusMeta[artist.status].label}</span>
              <span>${artist.tier === "main" ? "메인" : artist.tier === "premium" ? "프리미엄" : artist.tier === "sub" ? "서브" : "실험"}</span>
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

  document.title = `${artist.publicName} | AI 엔터테인먼트 스튜디오`;

  hero.className = `detail-hero-card ${status.className}`;
  hero.innerHTML = artist.status === "secret"
    ? `
      <div class="detail-hero-secret">
        <span class="eyebrow">${artist.type}</span>
        <strong>${artist.publicName}</strong>
        <em class="catalog-status-caption">${status.label}</em>
      </div>
    `
    : `
      <div class="detail-hero-frame">
        <img class="detail-hero-image" src="${artist.images.cover}" alt="${artist.publicName}" />
      </div>
    `;

  const intro = document.getElementById("detailIntro");
  if (intro) {
    intro.innerHTML = `
      <p class="eyebrow">공식 프로필</p>
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
        <span>${artist.tier === "main" ? "메인" : artist.tier === "premium" ? "프리미엄" : artist.tier === "sub" ? "서브" : "실험"}</span>
      </div>
    `;
  }

  const gallery = document.getElementById("detailGallery");
  if (gallery) {
    gallery.innerHTML = artist.status === "secret"
      ? ""
      : `
        <div>
          <p class="eyebrow">대표 컷</p>
          <h3>대표 이미지</h3>
        </div>
        <div class="detail-gallery-grid">
          <article class="detail-gallery-card">
            <img class="detail-gallery-image" src="${artist.images.cover}" alt="${artist.publicName} 커버" />
            <div class="detail-gallery-caption">커버 컷</div>
          </article>
          <article class="detail-gallery-card">
            <img class="detail-gallery-image" src="${artist.images.thumb}" alt="${artist.publicName} 썸네일" />
            <div class="detail-gallery-caption">썸네일 컷</div>
          </article>
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
            <div class="detail-short-media ${status.className}"${mediaStyle(artist.images.thumb)}>
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
            <span>시크릿 접근</span>
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
