/* ─────────────────────────────────────────────
   Lumina Stage — app.js
   Claude 담당: 프론트/UI
   Codex 담당: 백엔드/DB/API/Git push
   ───────────────────────────────────────────── */

/* ── API 설정 ──────────────────────────────────
   백엔드 배포 후 API_BASE를 실제 URL로 변경
   예) 'https://api.luminastage.com'
   로컬 개발: 'http://localhost:3000'
   빈 문자열 = 로컬 데이터 fallback 자동 사용
   ─────────────────────────────────────────── */
const API_BASE = ""; // TODO: 백엔드 배포 URL로 교체

async function apiFetch(path) {
  if (!API_BASE) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(API_BASE + path, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error("API " + res.status);
    return await res.json();
  } catch {
    return null;
  }
}

/* ── 캐릭터 마스터 데이터 (로컬 fallback) ─────
   role + artistDescription → mainArtists 배열 제거 후 통합
   ─────────────────────────────────────────── */
const characters = [
  {
    name: "윤세린", publicName: "윤세린", slug: "yoon-serin",
    type: "아이돌", tier: "main", status: "public",
    role: "대표 비주얼",
    artistDescription: "첫 화면을 책임지는 대표 아티스트. 강한 시선과 무대 장악력으로 팬을 끌어들이는 센터형 아이돌.",
    summary: "냉미녀 퍼포먼스형 메인 비주얼",
    fandom: "강한 비주얼 입덕형",
    business: "뷰티, 향수, 패션 필름",
    tags: ["시크", "퍼포먼스", "뷰티"],
    colorAccent: "#c4b0f0",
    images: { cover: "./assets/characters/yoon-serin/cover.png", thumb: "./assets/characters/yoon-serin/thumb.png" },
    intro: "서울 강남에서 태어난 윤세린은 열 살 때 우연히 참가한 뮤직비디오 오디션을 계기로 아역모델로 데뷔했다. 또래보다 훨씬 강한 눈빛과 타고난 무대 감각으로 현장에서 빠르게 이름을 알렸고, 중학교 2학년 재학 중 스타에이 엔터테인먼트 연습생으로 선발되며 본격적인 아티스트의 길을 걷기 시작했다. 2년간의 혹독한 훈련을 거치며 퍼포먼스와 비주얼 양면에서 정제된 무기를 갖추게 됐고, 이후 Lumina Stage 1기 메인 대표로 데뷔했다.",
    concept: "강한 시선, 정제된 퍼포먼스, 그리고 일상과 무대 사이의 극적인 온도 차. 윤세린은 차갑게 등장해서 뜨겁게 각인된다.",
    profile: { 생년월일: "2001년 3월 14일 (만 25세)", 출신지: "서울 강남구", 신체: "169cm", 혈액형: "A형", 포지션: "메인 비주얼 / 퍼포먼스", 데뷔: "2024년 Lumina Stage 1기", 팬포인트: "강한 시선과 무대 장악력", 광고축: "뷰티 · 향수 · 패션 필름", MBTI: "INTJ", 취미: "영화 감상, 향수 수집, 새벽 드라이브" },
    shorts: [{ title: "메인 비주얼 티저", metric: "조회 12.4만" }, { title: "콘셉트 퍼포먼스", metric: "조회 11.8만" }, { title: "뷰티 무드 컷", metric: "저장 4.2천" }]
  },
  {
    name: "한서율", publicName: "한서율", slug: "han-seoyul",
    type: "아이돌", tier: "main", status: "public",
    role: "센터 확장",
    artistDescription: "밝고 안정적인 센터 무드로 팬층을 넓히는 확장 축. 대중형 아이돌 라인의 핵심.",
    summary: "센터형 대중성과 하이틴 무드",
    fandom: "대중형 확장형",
    business: "패션, 음료, 라이프스타일",
    tags: ["센터", "하이틴", "대중성"],
    colorAccent: "#f0a8cc",
    images: { cover: "./assets/characters/han-seoyul/cover.png", thumb: "./assets/characters/han-seoyul/thumb.png" },
    intro: "경기도 분당에서 자란 한서율은 중학교 시절 전국 청소년 댄스 대회에서 2연패를 달성하며 일찌감치 재능을 증명했다. 아이디어엠 공개 오디션 최종 합격 후 1년간 트레이닝을 마치고 Lumina Stage 1기로 합류했다. 센터에 서는 순간 공간 전체를 밝히는 반짝임이 있고, 어떤 팀원과 붙어도 자연스럽게 분위기를 끌어올리는 무드메이커 기질이 타고났다.",
    concept: "센터의 무게를 즐기되 절대 혼자 빛나지 않는다. 한서율의 존재감은 모두가 더 빛나게 만드는 방식으로 작동한다.",
    profile: { 생년월일: "2003년 6월 22일 (만 22세)", 출신지: "경기도 분당", 신체: "166cm", 혈액형: "O형", 포지션: "메인 아이돌 / 센터형", 데뷔: "2024년 Lumina Stage 1기", 팬포인트: "정면 비주얼과 대중성", 광고축: "패션 · 음료 · 라이프스타일", MBTI: "ENFJ", 취미: "배드민턴, 카페 투어, 그림 그리기" },
    shorts: [{ title: "센터 무드 스냅", metric: "조회 9.7만" }, { title: "하이틴 센터 포맷", metric: "조회 10.1만" }, { title: "팬서비스 포토무드", metric: "좋아요 2.8만" }]
  },
  {
    name: "박도아", publicName: "박도아", slug: "park-doa",
    type: "스트리머", tier: "main", status: "public",
    role: "팬 소통형",
    artistDescription: "친근함과 생활감으로 댓글 반응을 끌어오는 캐릭터. 팬 전환과 커뮤니티 분위기를 담당.",
    summary: "친근함과 생활감이 강한 커뮤니티형 스타",
    fandom: "댓글·호감 전환형",
    business: "푸드, 라이프, 커머스",
    tags: ["친근함", "리액션", "생활형"],
    colorAccent: "#f0c870",
    images: { cover: "./assets/characters/park-doa/cover.png", thumb: "./assets/characters/park-doa/thumb.png" },
    intro: "부산 해운대 출신 박도아는 고등학교 1학년 때 시작한 틱톡 계정이 6개월 만에 팔로워 12만을 돌파하며 자신의 가능성을 직접 증명했다. 먹방, 리액션, 일상 브이로그를 자유롭게 오가는 콘텐츠 감각과 부산 특유의 직설적인 입담이 팬들의 마음을 사로잡았다.",
    concept: "화면 속에 있어도 옆집 언니처럼 편하다. 박도아의 친근함은 설계된 것이 아니라 그냥 그런 사람이라서다.",
    profile: { 생년월일: "2002년 11월 5일 (만 23세)", 출신지: "부산 해운대구", 신체: "163cm", 혈액형: "B형", 포지션: "커뮤니티 훅 / 스트리머", 데뷔: "2024년 Lumina Stage 1기", 팬포인트: "리액션과 친근함", 광고축: "푸드 · 커머스 · 라이프", MBTI: "ESFP", 취미: "먹방 촬영, 독서, 바다 수영" },
    shorts: [{ title: "친근 리액션 포맷", metric: "조회 15.3만" }, { title: "생활형 브이로그컷", metric: "댓글 1.1천" }, { title: "먹방 리액션 티저", metric: "저장 3.7천" }]
  },
  {
    name: "최서진", publicName: "최서진", slug: "choi-seojin",
    type: "배우", tier: "premium", status: "public",
    role: "프리미엄 간판",
    artistDescription: "광고, 화보, 브랜드 무드에 강한 프리미엄 라인. 사이트 전체의 고급감을 끌어올리는 간판.",
    summary: "럭셔리·에디토리얼에 강한 프리미엄 메인",
    fandom: "프리미엄 선망형",
    business: "주얼리, 럭셔리 뷰티, 에디토리얼",
    tags: ["럭셔리", "에디토리얼", "프리미엄"],
    colorAccent: "#a0bce8",
    images: { cover: "./assets/characters/choi-seojin/cover.png", thumb: "./assets/characters/choi-seojin/thumb.png" },
    intro: "서울 용산에서 태어난 최서진은 여덟 살 때 아역배우로 첫 스크린을 밟았다. 성장하면서 자연스럽게 패션·뷰티 모델로 영역을 넓혔고, 파리 아르떼 에콜 교환학생으로 선발되어 유럽 예술·패션 씬을 직접 경험했다. Lumina Stage에서는 프리미엄 라인의 간판을 맡아 스튜디오 전체의 품격을 책임진다.",
    concept: "화려하지 않아도 존재감이 넘친다. 최서진이 있는 장면은 그 자체로 하나의 화보가 된다.",
    profile: { 생년월일: "1999년 1월 28일 (만 27세)", 출신지: "서울 용산구", 신체: "172cm", 혈액형: "AB형", 포지션: "프리미엄 메인 / 배우", 데뷔: "2024년 Lumina Stage 1기", 팬포인트: "고급감과 존재감", 광고축: "주얼리 · 럭셔리 뷰티 · 에디토리얼", MBTI: "INFJ", 취미: "현대미술 관람, 와인 페어링, 필름 카메라" },
    shorts: [{ title: "에디토리얼 컷 무드", metric: "조회 6.2만" }, { title: "럭셔리 화보 티저", metric: "저장 2.1천" }, { title: "브랜드 무드 필름", metric: "완주율 68%" }]
  },
  {
    name: "오해린", publicName: "오해린", slug: "oh-haerin",
    type: "아이돌", tier: "sub", status: "debut",
    role: "감성 보컬",
    artistDescription: "청아한 보컬과 감정 몰입형 콘텐츠로 데뷔를 준비 중인 서브 아이돌.",
    summary: "감성 보컬 중심의 청아한 라인",
    fandom: "감성 몰입형", business: "음향, 감성 캠페인, 뷰티",
    tags: ["보컬", "감성", "청아함"],
    colorAccent: "#a8d8f0",
    images: { cover: "./assets/characters/oh-haerin/cover.jpg", thumb: "./assets/characters/oh-haerin/thumb.jpg" },
    intro: "청아한 보컬 감성을 중심으로 데뷔를 준비 중인 라인입니다.",
    concept: "감정 몰입형 숏폼과 무드형 콘텐츠에 적합한 예비 아이돌.",
    profile: { 포지션: "서브 아이돌 / 보컬", 팬포인트: "청아함과 감성선", 운영상태: "데뷔 예정", 광고축: "감성 캠페인 · 뷰티" },
    shorts: [{ title: "데뷔 예정 무드", metric: "준비 중" }]
  },
  {
    name: "민채온", publicName: "민채온", slug: "min-chaeon",
    type: "아이돌", tier: "sub", status: "debut",
    role: "무대형",
    artistDescription: "성숙한 매력과 러블리함을 함께 가진 데뷔 예정 무대형 아이돌.",
    summary: "성숙한 섹시 러블리 포지션",
    fandom: "직관적 매력 소비형", business: "패션, 뷰티, 퍼포먼스형 광고",
    tags: ["성숙함", "러블리", "무대형"],
    colorAccent: "#f0b0c0",
    images: { cover: "./assets/characters/min-chaeon/cover.jpg", thumb: "./assets/characters/min-chaeon/thumb.jpg" },
    intro: "성숙한 매력과 러블리함을 함께 가진 데뷔 예정 라인입니다.",
    concept: "무대형 퍼포먼스와 스타일링 확장이 가능한 보조 아이돌 포지션.",
    profile: { 포지션: "서브 아이돌 / 무대형", 팬포인트: "성숙함과 무대감", 운영상태: "데뷔 예정", 광고축: "패션 · 뷰티" },
    shorts: [{ title: "데뷔 예정 퍼포먼스", metric: "준비 중" }]
  },
  {
    name: "서유안", publicName: "서유안", slug: "seo-yuan",
    type: "모델", tier: "sub", status: "debut",
    role: "내추럴 모델",
    artistDescription: "자연스러운 고급감을 표현하는 뷰티·리빙 브랜드 특화 모델 라인.",
    summary: "내추럴 럭셔리 톤의 뷰티 모델",
    fandom: "호감·선망형", business: "스킨케어, 리빙, 뷰티",
    tags: ["내추럴", "우아함", "뷰티"],
    colorAccent: "#b8f0d0",
    images: { cover: "./assets/characters/seo-yuan/cover.jpg", thumb: "./assets/characters/seo-yuan/thumb.jpg" },
    intro: "자연스러운 고급감을 보여주는 데뷔 예정 모델 라인입니다.",
    concept: "뷰티와 리빙 브랜드에 맞는 잔잔하고 우아한 무드.",
    profile: { 포지션: "서브 모델", 팬포인트: "호감형 우아함", 운영상태: "데뷔 예정", 광고축: "스킨케어 · 리빙" },
    shorts: [{ title: "데뷔 예정 뷰티", metric: "준비 중" }]
  },
  {
    name: "강시아", publicName: "시크릿 트레이니 01", slug: "kang-sia",
    type: "모델", tier: "sub", status: "secret",
    role: "시크릿", artistDescription: "공개 전 시크릿 라인.",
    summary: "도시적이고 세련된 패션 라인",
    fandom: "공개 전", business: "비공개",
    tags: ["시크릿", "모델", "공개예정"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/kang-sia/cover.jpg", thumb: "./assets/characters/kang-sia/thumb.jpg" },
    intro: "공개 전 시크릿 라인입니다.", concept: "티저와 실루엣만 먼저 공개되는 시크릿 포지션.",
    profile: { 포지션: "시크릿 모델", 팬포인트: "비공개", 운영상태: "시크릿", 광고축: "비공개" },
    shorts: [{ title: "시크릿 티저", metric: "비공개" }]
  },
  {
    name: "이지원", publicName: "시크릿 트레이니 02", slug: "lee-jiwon",
    type: "배우", tier: "experiment", status: "secret",
    role: "시크릿", artistDescription: "공개 전 시크릿 배우 라인.",
    summary: "고급스럽고 대중적인 톱스타 포지션",
    fandom: "공개 전", business: "비공개",
    tags: ["시크릿", "배우", "공개예정"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/lee-jiwon/cover.jpg", thumb: "./assets/characters/lee-jiwon/thumb.jpg" },
    intro: "배우 라인의 시크릿 포지션입니다.", concept: "고급감 있는 티저 운영 전용 시크릿 배우 포지션.",
    profile: { 포지션: "시크릿 배우", 팬포인트: "비공개", 운영상태: "시크릿", 광고축: "비공개" },
    shorts: [{ title: "시크릿 티저", metric: "비공개" }]
  },
  {
    name: "하윤아", publicName: "시크릿 트레이니 03", slug: "ha-yuna",
    type: "배우", tier: "experiment", status: "secret",
    role: "시크릿", artistDescription: "스타일 라인의 실험형 시크릿 캐릭터.",
    summary: "도회적이고 스타일리시한 올라운더",
    fandom: "공개 전", business: "비공개",
    tags: ["시크릿", "스타일", "공개예정"],
    colorAccent: "#808080",
    images: { cover: "./assets/characters/ha-yuna/cover.jpg", thumb: "./assets/characters/ha-yuna/thumb.jpg" },
    intro: "스타일 라인의 실험형 시크릿 캐릭터입니다.", concept: "차후 반응을 보고 공개 여부를 정하는 스타일형 후보.",
    profile: { 포지션: "시크릿 스타일형", 팬포인트: "비공개", 운영상태: "시크릿", 광고축: "비공개" },
    shorts: [{ title: "시크릿 티저", metric: "비공개" }]
  }
];

const characterFrontAssets = {
  "yoon-serin": {
    cover: "./assets/characters/yoon-serin/reference-final/13_stage-cover-candidate-04.png",
    thumb: "./assets/characters/yoon-serin/reference-final/10_official-profile-close-03.png",
    gallery: [
      ["Full body", "./assets/characters/yoon-serin/reference-final/01_full-body-reference-01.png"],
      ["Close-up stage", "./assets/characters/yoon-serin/reference-final/02_close-up-stage-01.png"],
      ["Profile upper", "./assets/characters/yoon-serin/reference-final/03_profile-upper-01.png"],
      ["Upper body stage", "./assets/characters/yoon-serin/reference-final/04_upper-body-stage-01.png"],
      ["Performance half", "./assets/characters/yoon-serin/reference-final/05_performance-half-01.png"],
      ["Editorial close-up", "./assets/characters/yoon-serin/reference-final/06_editorial-closeup-01.png"],
      ["Stage half body", "./assets/characters/yoon-serin/reference-final/07_stage-half-body-01.png"],
      ["Mic command", "./assets/characters/yoon-serin/reference-final/08_stage-mic-command-02.png"],
      ["Beauty close-up", "./assets/characters/yoon-serin/reference-final/09_beauty-closeup-02.png"],
      ["Official profile", "./assets/characters/yoon-serin/reference-final/10_official-profile-close-03.png"],
      ["Soft profile", "./assets/characters/yoon-serin/reference-final/11_official-profile-soft-04.png"],
      ["Backstage corridor", "./assets/characters/yoon-serin/reference-final/12_backstage-corridor-03.png"],
      ["Stage cover", "./assets/characters/yoon-serin/reference-final/13_stage-cover-candidate-04.png"],
      ["Backstage side", "./assets/characters/yoon-serin/reference-final/14_backstage-corridor-02.png"],
      ["Styling chair", "./assets/characters/yoon-serin/reference-final/15_backstage-styling-chair-01.png"],
      ["Side profile", "./assets/characters/yoon-serin/reference-final/16_profile-side-03.png"],
      ["Rehearsal focus", "./assets/characters/yoon-serin/reference-final/17_rehearsal-focus-02.png"],
      ["Stage cover alt", "./assets/characters/yoon-serin/reference-final/18_stage-cover-candidate-02.png"],
      ["Stage full body", "./assets/characters/yoon-serin/reference-final/19_stage-full-body-02.png"],
      ["Stage upper body", "./assets/characters/yoon-serin/reference-final/20_stage-upper-body-02.png"]
    ]
  },
  "han-seoyul": {
    cover: "./assets/characters/han-seoyul/reference/cover-mid-01.png",
    thumb: "./assets/characters/han-seoyul/reference/thumb-closeup-01.png",
    gallery: [
      ["Angle profile", "./assets/characters/han-seoyul/reference/angle-profile-01.png"],
      ["Backstage emotion", "./assets/characters/han-seoyul/reference/backstage-emotion-closeup-01.png"],
      ["Backstage in-ear", "./assets/characters/han-seoyul/reference/backstage-in-ear-01.png"],
      ["Cover mid", "./assets/characters/han-seoyul/reference/cover-mid-01.png"],
      ["Mirror rehearsal", "./assets/characters/han-seoyul/reference/dance-rehearsal-mirror-01.png"],
      ["Fan service", "./assets/characters/han-seoyul/reference/fanservice-selfie-01.png"],
      ["Focused rehearsal", "./assets/characters/han-seoyul/reference/focused-rehearsal-notes-01.png"],
      ["Full body angle", "./assets/characters/han-seoyul/reference/full-body-angle-walk-01.png"],
      ["Full body 01", "./assets/characters/han-seoyul/reference/full-body-reference-01.png"],
      ["Full body 02", "./assets/characters/han-seoyul/reference/full-body-reference-02.png"],
      ["Performance mic 01", "./assets/characters/han-seoyul/reference/performance-mic-01.png"],
      ["Performance mic 02", "./assets/characters/han-seoyul/reference/performance-mic-02.png"],
      ["Performance mic 03", "./assets/characters/han-seoyul/reference/performance-mic-03.png"],
      ["Pout expression", "./assets/characters/han-seoyul/reference/pout-expression-01.png"],
      ["Recording booth", "./assets/characters/han-seoyul/reference/recording-booth-headphone-01.png"],
      ["Vocal practice", "./assets/characters/han-seoyul/reference/rehearsal-vocal-practice-01.png"],
      ["Stage motion", "./assets/characters/han-seoyul/reference/stage-motion-hair-01.png"],
      ["Thumb close-up 01", "./assets/characters/han-seoyul/reference/thumb-closeup-01.png"],
      ["Thumb close-up 02", "./assets/characters/han-seoyul/reference/thumb-closeup-02.png"]
    ]
  },
  "park-doa": {
    cover: "./assets/characters/park-doa/reference-final/01_mukbang-main-smile-01.png",
    thumb: "./assets/characters/park-doa/reference-final/09_streamer-selfie-reaction-01.png",
    gallery: [
      ["Mukbang main smile", "./assets/characters/park-doa/reference-final/01_mukbang-main-smile-01.png"],
      ["Big reaction", "./assets/characters/park-doa/reference-final/02_mukbang-big-reaction-01.png"],
      ["Food reaction", "./assets/characters/park-doa/reference-final/03_mukbang-food-reaction-01.png"],
      ["Table smile", "./assets/characters/park-doa/reference-final/04_mukbang-table-smile-01.png"],
      ["Drink sofa", "./assets/characters/park-doa/reference-final/05_vlog-drink-sofa-01.png"],
      ["Cushion smile", "./assets/characters/park-doa/reference-final/06_vlog-cushion-smile-01.png"],
      ["Sofa natural", "./assets/characters/park-doa/reference-final/07_vlog-sofa-natural-01.png"],
      ["Talking reaction", "./assets/characters/park-doa/reference-final/08_talking-reaction-01.png"],
      ["Selfie reaction", "./assets/characters/park-doa/reference-final/09_streamer-selfie-reaction-01.png"],
      ["Drink selfie", "./assets/characters/park-doa/reference-final/10_streamer-drink-selfie-01.png"],
      ["Mukbang bite", "./assets/characters/park-doa/reference-final/11_mukbang-bite-01.png"],
      ["Surprised bite", "./assets/characters/park-doa/reference-final/12_mukbang-surprised-bite-01.png"]
    ]
  }
};

characters.forEach((artist) => {
  const front = characterFrontAssets[artist.slug];
  if (!front) {
    artist.gallery = [
      { caption: "Cover", src: artist.images.cover },
      { caption: "Thumbnail", src: artist.images.thumb }
    ];
    return;
  }

  artist.images = {
    ...artist.images,
    cover: front.cover || artist.images.cover,
    thumb: front.thumb || artist.images.thumb
  };
  artist.gallery = front.gallery.map(([caption, src]) => ({ caption, src }));
});

/* ── 상태 메타 ──────────────────────────────── */
const statusMeta = {
  public: { label: "공개 활동 중", summaryLabel: "공개 중", className: "is-public" },
  debut:  { label: "데뷔 예정",    summaryLabel: "곧 공개",  className: "is-debut"  },
  secret: { label: "시크릿",       summaryLabel: "시크릿",   className: "is-secret" }
};

/* ── 숏폼 데이터 (로컬 fallback) ────────────── */
const shortformsLocal = [
  { title: "메인 비주얼 티저",   artist: "윤세린", metric: "조회 12.4만", tone: "첫 유입용 메인 비주얼 포맷, 강한 시선과 퍼포먼스 무드 중심", image: "./assets/characters/yoon-serin/thumb.png" },
  { title: "콘셉트 퍼포먼스",    artist: "윤세린", metric: "조회 11.8만", tone: "무대 장악력과 퍼포먼스 센터 이미지를 강화하는 핵심 포맷",    image: "./assets/characters/yoon-serin/cover.png" },
  { title: "센터 무드 스냅",     artist: "한서율", metric: "조회 9.7만",  tone: "정면 비주얼과 대중성 확장을 담당하는 센터형 포맷",            image: "./assets/characters/han-seoyul/thumb.png" },
  { title: "하이틴 센터 포맷",   artist: "한서율", metric: "조회 10.1만", tone: "밝고 반짝이는 센터 무드로 팬 확장을 노리는 포맷",             image: "./assets/characters/han-seoyul/cover.png" },
  { title: "친근 리액션 포맷",   artist: "박도아", metric: "조회 15.3만", tone: "생활형 리액션과 댓글 반응을 팬 전환으로 연결하는 포맷",        image: "./assets/characters/park-doa/thumb.png"   },
  { title: "먹방 리액션 티저",   artist: "박도아", metric: "저장 3.7천",  tone: "친근한 먹방 크리에이터 무드로 호감과 참여를 끌어오는 포맷",   image: "./assets/characters/park-doa/cover.png"   },
  { title: "에디토리얼 컷 무드", artist: "최서진", metric: "조회 6.2만",  tone: "브랜드 제안과 화보형 무드를 보여주는 프리미엄 포맷",          image: "./assets/characters/choi-seojin/thumb.png"},
  { title: "브랜드 무드 필름",   artist: "최서진", metric: "완주율 68%",  tone: "광고·화보 적합도를 직접 보여주는 프리미엄 쇼케이스 포맷",    image: "./assets/characters/choi-seojin/cover.png"}
];

/* ── 비즈니스 패키지 ─────────────────────────── */
const businessPackages = [
  { name: "숏폼 캠페인", target: "뷰티 / 패션 / 커머스", summary: "메인 캐릭터를 활용한 숏폼 광고 세트와 SNS 노출 패키지", deliverables: ["숏폼 3종", "썸네일 3종", "브랜드 컷 1세트"] },
  { name: "프리미엄 에디토리얼", target: "주얼리 / 럭셔리 / 에디토리얼", summary: "프리미엄 라인 중심의 화보형 콘텐츠와 브랜드 무드 연출", deliverables: ["에디토리얼 컷", "브랜드 티저", "룩북형 이미지"] },
  { name: "캐릭터 브랜딩", target: "브랜드 콜라보 / IP 협업", summary: "캐릭터 설정, 세계관, 반복 노출 구조를 함께 설계하는 브랜딩형 패키지", deliverables: ["캐릭터 협업안", "콘텐츠 콘셉트", "운영 제안"] }
];

/* ── 런타임 상태 ─────────────────────────────── */
let _artists = characters;
let _shortforms = shortformsLocal;

/* ── 유틸 ───────────────────────────────────── */
function getCharacterByName(name) {
  return _artists.find(a => a.publicName === name || a.name === name);
}
function getCharacterBySlug(slug) {
  return _artists.find(a => a.slug === slug);
}
function mediaStyle(path) {
  if (!path) return "";
  return `style="background-image: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(22,18,32,0.16)), url('${path}')"`;
}

/* ── API 어댑터 ─────────────────────────────────
   백엔드 응답 → 프론트 구조로 변환
   실제 API 필드명 확정 후 Codex와 맞춤
   ─────────────────────────────────────────── */
function adaptArtist(api) {
  const local = characters.find(c => c.slug === api.slug) || {};
  return {
    ...local,
    name:        api.name          || local.name,
    publicName:  api.publicName    || api.public_name    || local.publicName,
    slug:        api.slug,
    type:        api.type          || local.type,
    tier:        api.tier          || local.tier,
    status:      api.status        || local.status,
    summary:     api.summary       || local.summary,
    intro:       api.intro         || local.intro,
    concept:     api.concept       || local.concept,
    tags:        api.tags          || local.tags || [],
    fandom:      api.fandom        || local.fandom,
    business:    api.business      || local.business,
    images: {
      cover: api.coverImage  || api.cover_image  || local.images?.cover,
      thumb: api.thumbImage  || api.thumb_image  || local.images?.thumb
    },
    gallery:           local.gallery || [],
    profile:           api.profile || local.profile || {},
    shorts:            api.shorts  || local.shorts  || [],
    // 프론트 전용 필드: 항상 로컬 유지
    role:              local.role,
    artistDescription: local.artistDescription,
    colorAccent:       local.colorAccent
  };
}

function adaptShortform(api) {
  const local = shortformsLocal.find(s => s.title === api.title) || {};
  return {
    title:  api.title                           || local.title,
    artist: api.artistName || api.artist_name  || local.artist,
    metric: api.metric                          || local.metric,
    tone:   api.tone       || api.description  || local.tone,
    image:  api.thumbnailUrl || api.thumbnail_url || local.image
  };
}

/* ── 렌더링: 메인 아티스트 (mainArtists 배열 제거됨) */
function renderMainArtists() {
  const root = document.getElementById("mainArtistGrid");
  if (!root) return;

  const list = _artists.filter(a =>
    (a.tier === "main" || a.tier === "premium") && a.status === "public"
  );

  root.innerHTML = list.map(a => `
    <article class="artist-card clickable-card" data-href="./character-detail.html?slug=${a.slug}"
      style="--char-accent: ${a.colorAccent || "#9f8bc7"}">
      <div class="artist-media artist-media-${a.slug}">
        <img class="artist-media-image artist-media-image-${a.slug}"
          src="${a.images.thumb || a.images.cover}" alt="${a.publicName}"
          onerror="this.style.display='none'" />
        <div class="artist-media-copy">
          <span class="artist-role">${a.role}</span>
          <strong>${a.name}</strong>
        </div>
      </div>
      <div class="artist-body">
        <p>${a.artistDescription}</p>
        <div class="tag-list">${a.tags.map(t => `<span>${t}</span>`).join("")}</div>
        <a class="text-link" href="./character-detail.html?slug=${a.slug}">상세 보기</a>
      </div>
    </article>
  `).join("");
}

/* ── 렌더링: 데뷔 예정 라인 (6캐릭 서브) ─────── */
function renderDebutLine() {
  const root = document.getElementById("debutLineGrid");
  if (!root) return;

  const list = _artists.filter(a => a.status === "debut");
  if (!list.length) { root.closest("section")?.setAttribute("hidden", ""); return; }

  root.innerHTML = list.map(a => `
    <article class="debut-card clickable-card" data-href="./character-detail.html?slug=${a.slug}"
      style="--char-accent: ${a.colorAccent || "#9f8bc7"}">
      <div class="debut-card-media">
        <img src="${a.images.thumb || a.images.cover}" alt="${a.publicName}"
          onerror="this.style.display='none'" />
        <span class="debut-card-badge">데뷔 예정</span>
      </div>
      <div class="debut-card-body">
        <span class="debut-card-type eyebrow">${a.type}</span>
        <strong>${a.publicName}</strong>
        <p>${a.summary}</p>
      </div>
    </article>
  `).join("");
}

/* ── 렌더링: 숏폼 그리드 ─────────────────────── */
function renderShortforms() {
  const root = document.getElementById("shortformGrid");
  if (!root) return;
  root.innerHTML = _shortforms.map(item => {
    const a = getCharacterByName(item.artist);
    const img = item.image || a?.images.thumb || a?.images.cover || "";
    return `
      <article class="short-card clickable-card" data-href="./character-detail.html?slug=${a?.slug || ""}">
        <div class="short-card-head"><span class="eyebrow">${item.artist}</span><strong>${item.title}</strong></div>
        <div class="short-media"${mediaStyle(img)}><span class="short-media-metric">${item.metric}</span></div>
        <div class="short-body">
          <div class="short-meta"><span>${item.metric}</span><span>${item.artist}</span></div>
          <p>${item.tone}</p>
          <a class="text-link" href="./character-detail.html?slug=${a?.slug || ""}">캐릭터 상세</a>
        </div>
      </article>`;
  }).join("");
}

/* ── 렌더링: 숏폼 허브 ───────────────────────── */
function renderShortformHub() {
  const root = document.getElementById("shortformHub");
  if (!root) return;
  root.innerHTML = _shortforms.map(item => {
    const a = getCharacterByName(item.artist);
    const img = item.image || a?.images.thumb || a?.images.cover || "";
    return `
      <article class="feed-card clickable-card" data-href="./character-detail.html?slug=${a?.slug || ""}">
        <div class="feed-card-head"><span class="eyebrow">${item.artist}</span><strong>${item.title}</strong></div>
        <div class="feed-card-media"${mediaStyle(img)}><span class="feed-card-chip">${a?.type || ""}</span></div>
        <div class="feed-card-body">
          <div class="short-meta"><span>${item.metric}</span><span>${item.artist}</span></div>
          <p>${item.tone}</p>
          <a class="text-link" href="./character-detail.html?slug=${a?.slug || ""}">캐릭터 보기</a>
        </div>
      </article>`;
  }).join("");
}

/* ── 렌더링: 로스터 ──────────────────────────── */
function renderRoster() {
  const root = document.getElementById("rosterGrid");
  if (!root) return;
  const featured = _artists.filter(a => ["yoon-serin","han-seoyul","park-doa","choi-seojin"].includes(a.slug));
  root.innerHTML = featured.map(a => `
    <article class="roster-card ${statusMeta[a.status].className} clickable-card"
      data-href="./character-detail.html?slug=${a.slug}"
      data-secret="${a.status === "secret"}">
      <div class="roster-media roster-media-${a.status}"${mediaStyle(a.images.thumb || a.images.cover)}>
        <strong>${a.publicName}</strong>
      </div>
      <div class="roster-body">
        <div class="roster-meta">
          <span class="eyebrow">${a.type}</span>
          <span class="status-badge status-badge-${a.status}">${statusMeta[a.status].label}</span>
        </div>
        <p>${a.summary}</p>
        <a class="text-link ${a.status === "secret" ? "is-dimmed" : ""}" href="./character-detail.html?slug=${a.slug}">프로필 보기</a>
      </div>
    </article>`).join("");
}

/* ── 렌더링: 캐릭터 카탈로그 ────────────────── */
function renderCatalogMedia(a) {
  const s = statusMeta[a.status];
  if (a.status === "secret") {
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

function renderCharacterCatalog(filter = "all", tagFilter = "") {
  const root = document.getElementById("characterCatalog");
  if (!root) return;

  const tierLabel = { main: "메인", premium: "프리미엄", sub: "서브", experiment: "실험" };

  let list = filter === "all" ? _artists : _artists.filter(a => a.type === filter || a.tier === filter);
  if (tagFilter) list = list.filter(a => a.tags.includes(tagFilter));

  root.innerHTML = list.map(a => `
    <article class="catalog-card ${statusMeta[a.status].className} clickable-card"
      data-href="./character-detail.html?slug=${a.slug}"
      data-secret="${a.status === "secret"}"
      style="--char-accent: ${a.colorAccent || "#9f8bc7"}">
      ${renderCatalogMedia(a)}
      <div class="catalog-body">
        <h3 class="catalog-name">${a.publicName}</h3>
        <div class="catalog-meta">
          <span>${statusMeta[a.status].label}</span>
          <span>${tierLabel[a.tier] || a.tier}</span>
        </div>
        <p class="catalog-summary">${a.summary}</p>
        <dl class="catalog-details">
          <div><dt>팬 포인트</dt><dd>${a.fandom}</dd></div>
          <div><dt>광고 적합</dt><dd>${a.business}</dd></div>
        </dl>
        <div class="tag-list">${a.tags.map(t => `<span>${t}</span>`).join("")}</div>
        <a class="text-link ${a.status === "secret" ? "is-dimmed" : ""}" href="./character-detail.html?slug=${a.slug}">상세 페이지</a>
      </div>
    </article>`).join("");

  const note = document.getElementById("activeFilterNote");
  if (note) note.innerHTML = tagFilter
    ? `<span>현재 태그 필터: <strong>${tagFilter}</strong></span><a href="./characters.html" class="text-link">필터 해제</a>`
    : "";
}

function bindCharacterFilters() {
  const filterRoot = document.getElementById("characterFilters");
  if (!filterRoot) return;
  const btns = [...filterRoot.querySelectorAll("[data-filter]")];
  const activeTag = new URLSearchParams(window.location.search).get("tag") || "";
  btns.forEach(btn => {
    btn.addEventListener("click", () => {
      btns.forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      renderCharacterCatalog(btn.dataset.filter, activeTag);
    });
  });
  if (activeTag) renderCharacterCatalog("all", activeTag);
}

/* ── 렌더링: 캐릭터 상세 ─────────────────────── */
function renderCharacterDetail() {
  const hero = document.getElementById("detailHero");
  if (!hero) return;

  const slug   = new URLSearchParams(window.location.search).get("slug");
  const artist = getCharacterBySlug(slug) || _artists[0];
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
      <h1>${artist.publicName}</h1>
      <p class="detail-summary">${artist.summary}</p>
      <div class="detail-bio">
        <p>${artist.intro}</p>
        <p class="detail-concept">${artist.concept}</p>
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
      <span class="detail-tier-tag">${tierLabel[artist.tier] || artist.tier}</span>`;
  }

  const gallery = document.getElementById("detailGallery");
  if (gallery) {
    const galleryItems = artist.gallery?.length
      ? artist.gallery
      : [
          { caption: "Cover", src: artist.images.cover },
          { caption: "Thumbnail", src: artist.images.thumb }
        ];
    gallery.innerHTML = artist.status === "secret" ? "" : `
      <div><p class="eyebrow">Reference pack</p><h3>운영 이미지 갤러리</h3></div>
      <div class="detail-gallery-grid">
        ${galleryItems.map((item) => `
          <article class="detail-gallery-card">
            <img class="detail-gallery-image" src="${item.src}" alt="${artist.publicName} ${item.caption}" loading="lazy" />
            <div class="detail-gallery-caption">${item.caption}</div>
          </article>
        `).join("")}
      </div>`;
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
    cta.innerHTML = artist.status === "secret"
      ? `<div class="detail-cta-card is-secret"><strong>공개 전 시크릿 라인입니다</strong><p>숏폼 반응 전략에 따라 공개 순서를 조정합니다.</p></div>`
      : `<div class="detail-cta-card">
           <div class="detail-cta-info">
             <strong>${artist.publicName}을 응원하세요</strong>
             <p>후원은 캐릭터 외형 업그레이드, 신규 콘텐츠 해금, 팬 전용 이벤트로 이어집니다.</p>
           </div>
           <div class="detail-cta-actions">
             <button class="cta-btn cta-btn-support" disabled>
               <span class="cta-btn-icon">💜</span>
               <span class="cta-btn-label"><strong>후원하기</strong><small>준비 중</small></span>
             </button>
             <button class="cta-btn cta-btn-chat" disabled>
               <span class="cta-btn-icon">💬</span>
               <span class="cta-btn-label"><strong>캐릭터챗</strong><small>준비 중</small></span>
             </button>
           </div>
         </div>`;
  }

  const tagNav = document.getElementById("detailTagNavigation");
  if (tagNav) {
    tagNav.innerHTML = artist.tags
      .map(t => `<a class="tag-link" href="./characters.html?tag=${encodeURIComponent(t)}">${t}</a>`).join("");
  }
}

/* ── 렌더링: 비즈니스 패키지 ─────────────────── */
function renderBusinessPackages() {
  const root = document.getElementById("businessPackageGrid");
  if (!root) return;
  root.innerHTML = businessPackages.map(item => `
    <article class="package-card">
      <span class="eyebrow">${item.target}</span>
      <strong>${item.name}</strong>
      <p>${item.summary}</p>
      <ul class="package-list">${item.deliverables.map(d => `<li>${d}</li>`).join("")}</ul>
    </article>`).join("");
}

/* ── 카드 클릭 네비게이션 ────────────────────── */
function bindCardNavigation() {
  const cards = [...document.querySelectorAll(".clickable-card")];
  cards.forEach(card => {
    card.tabIndex = 0;
    card.setAttribute("role", "link");
    const go = () => {
      const href = card.dataset.href;
      if (!href) return;
      if (card.dataset.secret === "true") {
        const ov = document.createElement("div");
        ov.className = "secret-transition";
        ov.innerHTML = `<div class="secret-transition-panel"><span>시크릿 접근</span><strong>비공개 프로필에 접근 중입니다</strong></div>`;
        document.body.appendChild(ov);
        setTimeout(() => window.location.href = href, 540);
        return;
      }
      window.location.href = href;
    };
    card.addEventListener("click", e => { if (e.target.closest("a, button")) return; go(); });
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
}

/* ── 초기화: API 우선, fallback 로컬 ─────────── */
async function init() {
  const apiArtists = await apiFetch("/api/v1/artists");
  if (apiArtists && Array.isArray(apiArtists)) {
    _artists = apiArtists.map(adaptArtist);
    console.info(`[Lumina] API 아티스트 ${_artists.length}명 로드됨`);
  } else {
    console.info("[Lumina] 로컬 fallback 사용 중 (API_BASE 미설정 또는 응답 없음)");
  }

  const apiShortforms = await apiFetch("/api/v1/shortforms");
  if (apiShortforms && Array.isArray(apiShortforms)) {
    _shortforms = apiShortforms.map(adaptShortform);
    console.info(`[Lumina] API 숏폼 ${_shortforms.length}건 로드됨`);
  }

  renderMainArtists();
  renderDebutLine();
  renderShortforms();
  renderShortformHub();
  renderBusinessPackages();
  renderRoster();
  renderCharacterCatalog();
  bindCharacterFilters();
  renderCharacterDetail();
  bindCardNavigation();
}

init();
