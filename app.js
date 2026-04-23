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

const roster = [
  { name: "윤세린", type: "아이돌", note: "메인 A / 카리나 결" },
  { name: "한서율", type: "아이돌", note: "메인 B / 장원영 결" },
  { name: "박도아", type: "스트리머", note: "메인 C / 쯔양 결" },
  { name: "최서진", type: "배우", note: "프리미엄 메인 / 김혜수 결" },
  { name: "오해린", type: "아이돌", note: "감성형 보컬 라인" },
  { name: "민채온", type: "아이돌", note: "성숙한 섹시 러블리형" },
  { name: "서유안", type: "모델", note: "내추럴 럭셔리형" },
  { name: "강시아", type: "모델", note: "세련된 도시형" },
  { name: "이지원", type: "배우", note: "고급스러운 톱스타형" },
  { name: "하윤아", type: "배우", note: "도회적 스타일형" }
];

function renderMainArtists() {
  const root = document.getElementById("mainArtistGrid");
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
  root.innerHTML = roster
    .map(
      (artist) => `
        <article class="roster-card">
          <div class="roster-media">
            <strong>${artist.name}</strong>
          </div>
          <div class="roster-body">
            <span class="eyebrow">${artist.type}</span>
            <p>${artist.note}</p>
          </div>
        </article>
      `
    )
    .join("");
}

renderMainArtists();
renderShortforms();
renderRoster();
