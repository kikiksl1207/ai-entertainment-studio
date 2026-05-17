(function () {
  "use strict";

  const root = window.LuminaStaticData || (window.LuminaStaticData = {});

  /* ── 캐릭터 마스터 데이터 (로컬 fallback) ─────
     role + artistDescription → mainArtists 배열 제거 후 통합
     ─────────────────────────────────────────── */
  const characters = [
    {
      name: "윤세린", publicName: "윤세린", slug: "yoon-serin",
      gender: "female", type: "아티스트", tier: "main", status: "public",
      role: "대표 비주얼",
      artistDescription: "첫 조명이 켜지는 순간까지 흔들리지 않을게요. 차갑게 등장해서, 오래 남겠습니다.",
      summary: "차갑게 등장해, 오래 남는 뮤즈.",
      fandom: "강한 비주얼 입덕형",
      business: "뷰티, 향수, 패션 필름",
      tags: ["시크", "퍼포먼스", "뷰티"],
      colorAccent: "#c4b0f0",
      images: { cover: "./assets/characters/yoon-serin/cover.png", thumb: "./assets/characters/yoon-serin/thumb.png" },
      intro: "서울 강남에서 태어난 윤세린은 열 살 때 우연히 참가한 뮤직비디오 오디션을 계기로 아역모델로 데뷔했다. 또래보다 훨씬 강한 눈빛과 타고난 무대 감각으로 현장에서 빠르게 이름을 알렸고, 중학교 2학년 재학 중 스타에이 엔터테인먼트 연습생으로 선발되며 본격적인 아티스트의 길을 걷기 시작했다. 2년간의 혹독한 훈련을 거치며 퍼포먼스와 비주얼 양면에서 정제된 무기를 갖추게 됐고, 이후 Lumina Stage 1기 메인 대표로 데뷔했다.",
      concept: "차갑게 보이는 순간에도 저는 무대를 향해 가장 뜨겁게 준비하고 있어요. 흔들리지 않는 시선과 정제된 퍼포먼스로, 한 번 본 사람의 기억에 오래 남는 아티스트가 되겠습니다.",
      profile: {
        생년월일: "2001년 3월 14일 (만 25세)",
        출신지: "서울 강남구",
        신체: "169cm",
        혈액형: "A형",
        포지션: "메인 비주얼 / 퍼포먼스 센터",
        데뷔: "2024년 Lumina Stage 1기",
        캐릭터타입: "시크 퍼포먼스형",
        팬덤명: "Serinist",
        팬포인트: "차가운 시선, 절제된 표정, 무대 위 집중력",
        시그니처: "커스텀 인이어 · 와인 퍼플 마이크 · 슬림 이어커프",
        광고축: "뷰티 · 향수 · 패션 필름",
        대표컬러: "Deep Plum / Black Purple",
        MBTI: "INTJ",
        취미: "영화 감상, 향수 수집, 새벽 드라이브",
        좋아하는선물: "블랙 로즈, 니치 향수, 무대 조명"
      },
      shorts: [{ title: "메인 비주얼 티저", metric: "조회 12.4만" }, { title: "콘셉트 퍼포먼스", metric: "조회 11.8만" }, { title: "뷰티 무드 컷", metric: "저장 4.2천" }]
    },
    {
      name: "한서율", publicName: "한서율", slug: "han-seoyul",
      gender: "female",
      type: "아티스트", tier: "main", status: "public",
      role: "센터 확장",
      artistDescription: "센터에 서면 혼자 빛나는 게 아니라 모두의 표정이 같이 살아나요. 오늘도 같이 무대에 올라요.",
      summary: "센터에서 모두를 더 빛나게.",
      fandom: "대중형 확장형",
      business: "패션, 음료, 라이프스타일",
      tags: ["센터", "하이틴", "대중성"],
      colorAccent: "#f0a8cc",
      images: { cover: "./assets/characters/han-seoyul/cover.png", thumb: "./assets/characters/han-seoyul/thumb.png" },
      intro: "경기도 분당에서 자란 한서율은 중학교 시절 전국 청소년 댄스 대회에서 2연패를 달성하며 일찌감치 재능을 증명했다. 아이디어엠 공개 오디션 최종 합격 후 1년간 트레이닝을 마치고 Lumina Stage 1기로 합류했다. 센터에 서는 순간 공간 전체를 밝히는 반짝임이 있고, 어떤 팀원과 붙어도 자연스럽게 분위기를 끌어올리는 무드메이커 기질이 타고났다.",
      concept: "센터에 서는 이유는 혼자 빛나기 위해서가 아니에요. 제 옆에 선 사람들, 저를 바라봐주는 팬들까지 함께 환해지는 무대를 만들겠습니다.",
      profile: {
        생년월일: "2003년 6월 22일 (만 22세)",
        출신지: "경기도 성남시 분당구",
        신체: "166cm",
        혈액형: "O형",
        포지션: "메인 아이돌 / 럭셔리 러블리 센터",
        데뷔: "2024년 Lumina Stage 1기",
        캐릭터타입: "화사한 센터형 아이돌",
        팬덤명: "Yulight",
        팬포인트: "밝은 정면 비주얼, 무대 위 균형감, 팬서비스 감각",
        시그니처: "샴페인 핑크 리본 마이크 · 글리터 헤어핀 · 센터 포즈",
        광고축: "뷰티 · 음료 · 라이프스타일 · 팬미팅 콘텐츠",
        대표컬러: "Champagne Pink / Soft Gold",
        MBTI: "ENFJ",
        취미: "배드민턴, 카페 투어, 그림 그리기",
        좋아하는선물: "핑크 튤립, 손편지, 리본 액세서리, 달콤한 디저트"
      },
      shorts: [{ title: "센터 무드 스냅", metric: "조회 9.7만" }, { title: "하이틴 센터 포맷", metric: "조회 10.1만" }, { title: "팬서비스 포토무드", metric: "좋아요 2.8만" }]
    },
    {
      name: "박도아", publicName: "박도아", slug: "park-doa",
      gender: "female",
      type: "엔터테이너", tier: "main", status: "public",
      role: "팬 소통형",
      artistDescription: "화려하게 꾸미지 않아도 괜찮아요. 오늘 있었던 얘기부터 맛있는 한 입까지, 편하게 나눌게요.",
      summary: "솔직하고 편하게, 자주 보고 싶은 사람.",
      fandom: "댓글·호감 전환형",
      business: "푸드, 라이프, 커머스",
      tags: ["친근함", "리액션", "생활형"],
      colorAccent: "#f0c870",
      images: { cover: "./assets/characters/park-doa/cover.png", thumb: "./assets/characters/park-doa/thumb.png" },
      intro: "부산 해운대 출신 박도아는 고등학교 1학년 때 시작한 틱톡 계정이 6개월 만에 팔로워 12만을 돌파하며 자신의 가능성을 직접 증명했다. 먹방, 리액션, 일상 브이로그를 자유롭게 오가는 콘텐츠 감각과 부산 특유의 직설적인 입담이 팬들의 마음을 사로잡았다.",
      concept: "멀리 있는 스타보다 오늘도 편하게 말 걸 수 있는 사람이 되고 싶어요. 웃긴 순간도, 솔직한 하루도, 팬들과 가장 가까운 온도로 나누겠습니다.",
      profile: {
        생년월일: "2002년 11월 5일 (만 23세)",
        출신지: "부산 해운대구",
        신체: "163cm",
        혈액형: "B형",
        포지션: "커뮤니티 훅 / 리액션 스트리머",
        데뷔: "2024년 Lumina Stage 1기",
        캐릭터타입: "생활형 소통 스트리머",
        팬덤명: "Doable",
        팬포인트: "즉흥 리액션, 솔직한 말투, 가까운 친구 같은 친근함",
        시그니처: "코랄 후디 · 미니 먹방 테이블 · 반달 눈웃음",
        광고축: "푸드 · 커머스 · 라이프 · 댓글형 숏폼",
        대표컬러: "Warm Coral / Cream Orange",
        MBTI: "ESFP",
        취미: "먹방 촬영, 독서, 바다 수영",
        좋아하는선물: "지역 간식, 귀여운 머그컵, 코랄빛 소품, 편한 담요"
      },
      shorts: [{ title: "친근 리액션 포맷", metric: "조회 15.3만" }, { title: "생활형 브이로그컷", metric: "댓글 1.1천" }, { title: "먹방 리액션 티저", metric: "저장 3.7천" }]
    },
    {
      name: "최서진", publicName: "최서진", slug: "choi-seojin",
      gender: "female",
      type: "배우", tier: "premium", status: "public",
      role: "프리미엄 간판",
      artistDescription: "많이 말하지 않아도 장면은 남습니다. 한 컷의 온도로 오래 기억되겠습니다.",
      summary: "조용한 무게감, 한 장의 화보.",
      fandom: "프리미엄 선망형",
      business: "주얼리, 럭셔리 뷰티, 에디토리얼",
      tags: ["럭셔리", "에디토리얼", "프리미엄"],
      colorAccent: "#a0bce8",
      images: { cover: "./assets/characters/choi-seojin/cover.png", thumb: "./assets/characters/choi-seojin/thumb.png" },
      intro: "서울 용산에서 태어난 최서진은 여덟 살 때 아역배우로 첫 스크린을 밟았다. 성장하면서 자연스럽게 패션·뷰티 모델로 영역을 넓혔고, 파리 아르떼 에콜 교환학생으로 선발되어 유럽 예술·패션 씬을 직접 경험했다. Lumina Stage에서는 프리미엄 라인의 간판을 맡아 스튜디오 전체의 품격을 책임진다.",
      concept: "많이 말하지 않아도 장면은 남는다고 믿습니다. 한 컷의 시선, 한 번의 침묵까지 품격 있게 쌓아 최서진이라는 이름의 무드를 완성하겠습니다.",
      profile: {
        생년월일: "1999년 1월 28일 (만 27세)",
        출신지: "서울 용산구",
        신체: "172cm",
        혈액형: "AB형",
        포지션: "프리미엄 메인 / 배우",
        데뷔: "2024년 Lumina Stage 1기",
        캐릭터타입: "럭셔리 에디토리얼 배우형",
        팬덤명: "Seojin Atelier",
        팬포인트: "절제된 표정, 성숙한 분위기, 한 컷으로 남는 존재감",
        시그니처: "블랙 드레스 · 골드 드롭 이어링 · 필름 카메라",
        광고축: "주얼리 · 시계 · 럭셔리 뷰티 · 에디토리얼",
        대표컬러: "Black Gold / Champagne Beige",
        MBTI: "INFJ",
        취미: "현대미술 관람, 와인 페어링, 필름 카메라",
        좋아하는선물: "니치 향수, 블랙 다이어리, 골드 북마크, 전시 티켓"
      },
      shorts: [{ title: "에디토리얼 컷 무드", metric: "조회 6.2만" }, { title: "럭셔리 화보 티저", metric: "저장 2.1천" }, { title: "브랜드 무드 필름", metric: "완주율 68%" }]
    },
    {
      name: "오혜린", publicName: "오혜린", slug: "oh-hyerin",
      gender: "female",
      type: "아티스트", tier: "sub", status: "debut",
      role: "감성 메인보컬 / 음원 퀸",
      artistDescription: "맑고 깊은 목소리로 팬에게 조용한 위로를 건네는 Lumina Stage의 감성 메인보컬.",
      summary: "촉촉한 눈빛과 오래 남는 목소리로 조용한 위로를 건네는 감성 보컬.",
      fandom: "Hyerin Note", business: "감성 음원, 다이어리 굿즈, 소프트 뷰티, 힐링 캠페인",
      tags: ["메인보컬", "감성", "위로", "요정미"],
      colorAccent: "#c8b7f5",
      images: { cover: "./assets/characters/oh-hyerin/site-selected/cover.png", thumb: "./assets/characters/oh-hyerin/site-selected/thumb.png" },
      intro: "오혜린은 맑고 깊은 목소리로 팬에게 조용한 위로를 건네는 감성 메인보컬이다. 큰 제스처보다 오래 남는 감정선, 촉촉한 눈빛, 느린 호흡의 문장으로 팬덤 코어를 만든다.",
      concept: "조심스럽지만 진심이 오래 남는 목소리로, 팬의 하루 끝에 조용히 머무는 노래와 답장을 건넵니다.",
      profile: {
        생년월일: "2000년 6월 6일",
        출신지: "제주특별자치도 제주시",
        신체: "158cm",
        혈액형: "A형",
        포지션: "감성 메인보컬 / 음원 퀸 / 팬덤 코어 담당",
        데뷔: "2024년 Lumina Stage 1기",
        캐릭터타입: "감성 보컬 위로형",
        팬덤명: "Hyerin Note",
        팬포인트: "촉촉한 눈빛, 조용한 위로, 오래 남는 목소리",
        말투키워드: "조심스러움, 따뜻함, 느린 호흡, 진심 어린 문장",
        시그니처: "스탠딩 마이크 · 가죽 다이어리 · 페일 라벤더 시폰 드레스",
        광고축: "감성 음원 · 다이어리 굿즈 · 소프트 뷰티 · 힐링 캠페인",
        프리미엄포인트: "팬 이름이 들어간 음성 답장, 새벽 라이브 무드 필름, 감성 보컬 스페셜 컷",
        해금아이템: "페일 라벤더 보컬 스테이지 드레스",
        부스트포인트: "조용하지만 오래 남는 팬코어와 충성도",
        대표컬러: "Pale Lavender / Ash Beige",
        관계포지션: "메인 라인의 감정선과 위로를 담당하는 보컬 축",
        MBTI: "INFJ",
        취미: "새벽 산책, 가사 메모, 빈티지 다이어리 꾸미기",
        좋아하는선물: "라벤더 편지지, 따뜻한 머그잔, 작은 큐빅 귀걸이"
      },
      shorts: [{ title: "감성 보컬 클립", metric: "공개 준비" }, { title: "팬레터 무드 숏폼", metric: "공개 준비" }, { title: "음성 답장 티저", metric: "공개 준비" }]
    },
    {
      name: "민채온", publicName: "민채온", slug: "min-chaeon",
      gender: "female",
      type: "아티스트", tier: "candidate", status: "secret",
      role: "피트니스 아이돌",
      artistDescription: "웃을 땐 말랑하지만 무대에 서면 에너지가 달라져요. 귀여움 뒤의 탄탄한 반전을 보여줄게요.",
      summary: "러블리한 얼굴, 건강한 반전 에너지.",
      fandom: "직관적 매력 소비형", business: "피트니스, 스포츠 뷰티, 라이프스타일",
      tags: ["피트니스", "러블리", "반전매력"],
      colorAccent: "#f0b0c0",
      // #277 — 에밀리 최종 PNG 도착 전까지 SVG placeholder 18장 (cover/thumb/gallery-01..16).
      // PNG 도착 시 같은 파일명을 .png 로 추가하고, 이 path 의 확장자만 png 로 되돌리면 끝.
      images: { cover: "./assets/characters/min-chaeon/site-selected/cover.svg", thumb: "./assets/characters/min-chaeon/site-selected/thumb.svg" },
      intro: "민채온은 러블리한 첫인상과 탄탄한 에너지가 공존하는 피트니스형 아이돌이다. 가벼운 미소로 다가오지만, 무대 위에서는 리듬과 체력으로 시선을 붙잡는다.",
      concept: "귀엽게 웃는 모습 뒤에 숨겨둔 힘을 무대에서 보여드릴게요. 가볍게 시작해도 끝까지 단단하게 버티는 에너지로 제 이름을 증명하겠습니다.",
      profile: {
        생년월일: "2003년 9월 8일 (만 22세)",
        출신지: "경기도 고양시",
        신체: "165cm",
        혈액형: "O형",
        포지션: "피트니스 아이돌",
        데뷔: "Lumina Stage 확장 후보",
        캐릭터타입: "러블리 피트니스 반전형",
        팬덤명: "Chaeon Fit",
        팬포인트: "귀여운 첫인상, 탄탄한 에너지, 무대 위 반전 집중력",
        시그니처: "파스텔 트레이닝 밴드 · 하트 물병 · 포니테일 리본",
        광고축: "피트니스 · 스포츠 뷰티 · 밝은 라이프스타일",
        대표컬러: "Peach Pink / Active Mint",
        MBTI: "ESFJ",
        취미: "필라테스, 스무디 레시피 만들기, 운동복 코디",
        좋아하는선물: "스포츠 타월, 복숭아 향 바디미스트, 리본 헤어밴드, 단백질 쿠키"
      },
      shorts: [{ title: "피트니스 스냅", metric: "공개 대기" }]
    },
    {
      name: "차도현", publicName: "차도현", slug: "cha-dohyun",
      gender: "male",
      type: "아티스트", tier: "sub", status: "public",
      role: "젠더리스 패션",
      artistDescription: "패션은 갑옷이고 무대는 제 언어예요. 어떤 옷을 입어도 결국 가장 저답게 서겠습니다.",
      summary: "하이패션으로 무대를 장악하는 젠더리스 아티스트.",
      fandom: "아티스트 팬덤형",
      business: "하이패션, 매거진 화보, 스트릿 럭셔리",
      tags: ["하이패션", "젠더리스", "아티스트"],
      colorAccent: "#9090d0",
      images: { cover: "./assets/characters/cha-dohyun/cover.png", thumb: "./assets/characters/cha-dohyun/thumb.png" },
      intro: "슬림한 실루엣과 날카로운 눈매, 체인과 진주 레이어링이 트레이드마크. 하이패션과 K-pop 아티스트성을 동시에 구현하는 Lumina Stage 첫 번째 남성 아티스트다. 성별을 초월한 스타일링과 무대 퍼포먼스로 장르의 경계를 무너뜨린다.",
      concept: "제게 패션은 갑옷이고 무대는 언어입니다. 어떤 스타일을 입어도 결국 가장 저답게 서서, 경계를 넘는 아티스트가 되겠습니다.",
      profile: {
        생년월일: "2000년 10월 2일 (만 25세)",
        출신지: "서울 성수동",
        신체: "181cm",
        혈액형: "A형",
        포지션: "젠더리스 패션 아티스트",
        데뷔: "2026년 Lumina Stage 초기 공개",
        캐릭터타입: "하이패션 퍼포머형",
        팬덤명: "Dohyverse",
        팬포인트: "날카로운 눈매, 경계를 넘는 스타일링, 조용한 자기 확신",
        시그니처: "체인 초커 · 진주 레이어링 · 블랙 레더 장갑",
        광고축: "하이패션 · 매거진 화보 · 스트릿 럭셔리",
        대표컬러: "Midnight Violet / Silver Black",
        MBTI: "INFP",
        취미: "빈티지 패션 수집, 드로잉, 전시 탐방",
        좋아하는선물: "실버 링, 흑백 필름, 아트북, 빈티지 브로치"
      },
      shorts: [{ title: "하이패션 화보 티저", metric: "공개 중" }, { title: "스트릿 룩북", metric: "조회 8.1만" }]
    },
    {
      name: "강시아", publicName: "강시아", slug: "kang-sia",
      gender: "female",
      type: "모델", tier: "candidate", status: "secret",
      role: "도시형 라이프스타일",
      artistDescription: "애써 꾸미지 않아도 시선이 머무는 사람이 있어요. 도시의 오후처럼 담담하고 세련되게 남겠습니다.",
      summary: "도시의 오후를 닮은 에포트리스 시크.",
      fandom: "라이프스타일 선망형", business: "향수, 데님, 도시 라이프스타일",
      tags: ["시크", "내추럴", "라이프스타일"],
      colorAccent: "#808080",
      images: { cover: "./assets/characters/kang-sia/cover.png", thumb: "./assets/characters/kang-sia/thumb.png" },
      intro: "강시아는 향수, 데님, 카페의 온도가 어울리는 도시형 모델이다. 과한 포즈 대신 자연스러운 시선과 걷는 리듬으로 라이프스타일의 선망을 만든다.", concept: "애써 꾸미지 않아도 시선이 머무는 사람이 되고 싶어요. 도시의 오후처럼 담담하지만 오래 남는 분위기로 제 장면을 만들겠습니다.",
      profile: {
        생년월일: "2001년 9월 17일 (만 24세)",
        출신지: "서울 마포구 연남동",
        신체: "170cm",
        혈액형: "A형",
        포지션: "도시형 라이프스타일 모델",
        데뷔: "Lumina Stage 확장 후보",
        캐릭터타입: "에포트리스 시크 모델형",
        팬덤명: "Sia Hours",
        팬포인트: "자연스러운 시선, 담담한 세련미, 보조개가 남기는 여운",
        시그니처: "화이트 셔츠 · 빈티지 데님 · 무광 실버 이어링",
        광고축: "향수 · 데님 · 도시 라이프스타일 · 카페 화보",
        대표컬러: "Ivory Denim / City Gray",
        MBTI: "ISFP",
        취미: "동네 카페 기록, 필름 사진, 빈티지 숍 산책",
        좋아하는선물: "무향 핸드크림, 필름롤, 데님 키링, 작은 화병"
      },
      shorts: [{ title: "시티 무드 스냅", metric: "비공개 라인" }]
    },
    {
      name: "이지원", publicName: "이지원", slug: "lee-jiwon",
      gender: "female",
      type: "배우", tier: "candidate", status: "secret",
      role: "쿨한 톱스타",
      artistDescription: "흔들리지 않는 시선으로 장면을 밀고 나가요. 말보다 먼저 분위기가 도착하는 배우입니다.",
      summary: "쿨한 아우라로 장면을 장악하는 배우.",
      fandom: "선망형", business: "자동차, 테크, 액션 화보",
      tags: ["톱스타", "쿨함", "액션"],
      colorAccent: "#808080",
      images: { cover: "./assets/characters/lee-jiwon/cover.png", thumb: "./assets/characters/lee-jiwon/thumb.png" },
      intro: "이지원은 긴 흑발과 차가운 아우라로 액션, 테크, 자동차 캠페인에 어울리는 배우형 아티스트다. 감정을 크게 드러내지 않아도 장면의 긴장을 끝까지 붙잡는다.", concept: "쉽게 흔들리지 않는 눈빛으로 장면을 끝까지 밀고 가겠습니다. 말보다 분위기로 먼저 도착하는 배우가 되겠습니다.",
      profile: {
        생년월일: "1998년 8월 17일 (만 27세)",
        출신지: "서울 송파구",
        신체: "171cm",
        혈액형: "B형",
        포지션: "쿨 톱스타 배우",
        데뷔: "Lumina Stage 확장 후보",
        캐릭터타입: "액션 톱스타 배우형",
        팬덤명: "Jiwon Drive",
        팬포인트: "흔들리지 않는 눈빛, 차가운 아우라, 장면을 밀고 가는 힘",
        시그니처: "화이트 티셔츠 · 블랙 선글라스 · 실버 카 키링",
        광고축: "자동차 · 테크 · 액션 화보 · 프리미엄 캐주얼",
        대표컬러: "Cool White / Asphalt Black",
        MBTI: "ISTP",
        취미: "야간 드라이브, 액션 영화 분석, 러닝",
        좋아하는선물: "메탈 키링, 블랙 캡, 무선 이어폰 케이스, 시네마 티켓"
      },
      shorts: [{ title: "액션 무드 컷", metric: "비공개 라인" }]
    },
    {
      name: "하윤아", publicName: "하윤아", slug: "ha-yuna",
      gender: "female",
      type: "모델", tier: "main", status: "public",
      role: "SNS 스트릿 뷰티",
      artistDescription: "오늘의 색은 제가 정할게요. 스트릿의 속도와 비비드한 자신감으로 피드를 물들입니다.",
      summary: "비비드한 컬러로 피드를 바꾸는 스트릿 뷰티.",
      fandom: "트렌드 팔로워형", business: "스트릿 패션, 색조 뷰티, Y2K",
      tags: ["스트릿", "뷰티", "트렌드"],
      colorAccent: "#808080",
      images: { cover: "./assets/characters/ha-yuna/cover.png", thumb: "./assets/characters/ha-yuna/thumb.png" },
      intro: "하윤아는 고양이상 눈매와 비비드한 컬러 감각을 가진 스트릿 뷰티 모델이다. 빠르게 지나가는 숏폼 피드 안에서도 한 번 더 보게 만드는 트렌드 감도를 지녔다.", concept: "오늘의 색과 흐름은 제가 먼저 정해볼게요. 빠르게 지나가는 피드 안에서도 다시 멈춰 보게 만드는 존재가 되겠습니다.",
      profile: {
        생년월일: "2004년 4월 3일 (만 22세)",
        출신지: "서울 홍대",
        신체: "168cm",
        혈액형: "AB형",
        포지션: "SNS 스트릿 뷰티 모델",
        데뷔: "Lumina Stage 확장 후보",
        캐릭터타입: "비비드 스트릿 트렌드형",
        팬덤명: "Yunatic",
        팬포인트: "고양이상 눈매, 빠른 트렌드 감각, 비비드한 자신감",
        시그니처: "슬릭백 헤어 · 네온 네일 · 미니 크로스백",
        광고축: "스트릿 패션 · 색조 뷰티 · Y2K · SNS 챌린지",
        대표컬러: "Neon Pink / Electric Blue",
        MBTI: "ENTP",
        취미: "네일 컬러 믹스, 거리 사진 찍기, 신상 립 테스트",
        좋아하는선물: "컬러 립틴트, 키치한 스티커, 네온 헤어핀, 미니 파우치"
      },
      shorts: [{ title: "컬러 트렌드 컷", metric: "비공개 라인" }]
    },
    {
      name: "백리아", publicName: "백리아", slug: "baek-ria",
      gender: "female",
      type: "아티스트", tier: "candidate", status: "secret",
      role: "청량 직캠 보컬",
      artistDescription: "여름처럼 맑게 웃고, 직캠처럼 오래 남을게요. 첫 소절부터 시원하게 닿고 싶어요.",
      summary: "여름빛 보컬과 직캠 감성의 청량 아이돌.",
      fandom: "직캠 바이럴형", business: "청량 무대, 여름 음료, 직캠 숏폼",
      tags: ["청량", "보컬", "직캠"],
      colorAccent: "#808080",
      images: { cover: "./assets/characters/baek-ria/cover.png", thumb: "./assets/characters/baek-ria/thumb.png" },
      intro: "백리아는 맑은 얼굴, 청량한 색감, 보컬 커버에 강한 직캠형 아이돌이다. 여름 음료 광고처럼 시원한 첫인상과 다시 보고 싶은 무대 표정이 강점이다.", concept: "여름처럼 맑고 직캠처럼 오래 남고 싶어요. 첫 소절부터 시원하게 닿는 무대로 팬들의 하루를 환하게 만들겠습니다.",
      profile: {
        생년월일: "2005년 7월 12일 (만 20세)",
        출신지: "강원도 강릉시",
        신체: "165cm",
        혈액형: "O형",
        포지션: "청량 직캠 보컬",
        데뷔: "Lumina Stage 신규 후보",
        캐릭터타입: "여름빛 직캠 보컬형",
        팬덤명: "Ria Wave",
        팬포인트: "맑은 첫인상, 시원한 보컬, 다시 보게 되는 직캠 표정",
        시그니처: "스카이블루 마이크 · 투명 비즈 팔찌 · 흰 스니커즈",
        광고축: "청량 무대 · 보컬 커버 · 여름 음료 · 직캠 숏폼",
        대표컬러: "Sky Blue / Clear White",
        MBTI: "ENFP",
        취미: "보컬 커버 녹음, 바닷가 산책, 폴라로이드 모으기",
        좋아하는선물: "파란 리본, 투명 파우치, 조개 모양 액세서리, 청량한 향 바디미스트"
      },
      shorts: [{ title: "청량 직캠 컷", metric: "비공개 라인" }]
    },
    {
      name: "오유나", publicName: "오유나", slug: "oh-yuna",
      gender: "female",
      type: "아티스트", tier: "candidate", status: "secret",
      role: "여름 페스티벌 디바",
      artistDescription: "무대 위의 계절을 바꿀 수 있다면, 저는 늘 여름을 선택할래요. 뜨겁고 선명하게 기억될게요.",
      summary: "여름 페스티벌을 닮은 솔로 디바.",
      fandom: "시즌 이벤트형", business: "워터 스포츠, 여름 음료, 솔로 무대",
      tags: ["페스티벌", "디바", "여름"],
      colorAccent: "#808080",
      images: { cover: "./assets/characters/oh-yuna/cover.png", thumb: "./assets/characters/oh-yuna/thumb.png" },
      intro: "오유나는 워터 페스티벌, 솔로 퍼포먼스, 시즌 광고에 강한 여름 디바 라인이다. 강한 조명과 물빛 무대에서 에너지를 크게 터뜨리는 아티스트로 설계되어 있다.", concept: "무대 위의 계절을 바꿀 수 있다면 저는 늘 여름을 선택할래요. 뜨겁고 선명한 에너지로 가장 먼저 떠오르는 이름이 되겠습니다.",
      profile: {
        생년월일: "2000년 8월 2일 (만 25세)",
        출신지: "제주 서귀포시",
        신체: "169cm",
        혈액형: "B형",
        포지션: "여름 페스티벌 디바",
        데뷔: "Lumina Stage 신규 후보",
        캐릭터타입: "솔로 디바 페스티벌형",
        팬덤명: "Yuna Splash",
        팬포인트: "뜨거운 에너지, 당당한 표정, 시즌을 바꾸는 무대 장악력",
        시그니처: "아쿠아 고글 · 핫핑크 마이크 · 웻헤어 스타일",
        광고축: "워터 페스티벌 · 여름 음료 · 워터 스포츠 · 솔로 무대",
        대표컬러: "Aqua Blue / Hot Pink",
        MBTI: "ESTP",
        취미: "수영, 페스티벌 플레이리스트 만들기, 선글라스 수집",
        좋아하는선물: "아쿠아 향수, 선글라스, 방수 파우치, 핫핑크 타월"
      },
      shorts: [{ title: "페스티벌 티저", metric: "비공개 라인" }]
    },
    {
      name: "권태준", publicName: "권태준", slug: "kwon-taejun",
      gender: "male",
      type: "배우", tier: "main", status: "public",
      role: "누아르 배우",
      artistDescription: "낮은 목소리와 긴 침묵 사이에 감정이 있습니다. 천천히, 그러나 분명하게 남겠습니다.",
      summary: "깊은 눈빛으로 서사를 남기는 누아르 배우.",
      fandom: "감성 몰입형", business: "수트, 시계, 향수, 누아르",
      tags: ["누아르", "배우", "감성"],
      colorAccent: "#808080",
      images: { cover: "./assets/characters/kwon-taejun/cover.png", thumb: "./assets/characters/kwon-taejun/thumb.png" },
      intro: "권태준은 깊은 눈빛과 낮은 톤으로 누아르, 수트, 향수 캠페인에 어울리는 배우형 아티스트다. 대사가 많지 않아도 감정의 무게를 장면에 남긴다.", concept: "많이 말하지 않아도 감정은 남길 수 있다고 믿습니다. 낮은 목소리와 긴 침묵 사이에 제 서사를 깊게 새기겠습니다.",
      profile: {
        생년월일: "1997년 11월 23일 (만 28세)",
        출신지: "서울 종로구",
        신체: "184cm",
        혈액형: "A형",
        포지션: "누아르 배우 / 저음 챗",
        데뷔: "Lumina Stage 신규 후보",
        캐릭터타입: "저음 누아르 배우형",
        팬덤명: "Taejun Noir",
        팬포인트: "깊은 눈빛, 낮은 목소리, 긴 침묵에 남는 감정선",
        시그니처: "다크 수트 · 메탈 시계 · 검은 우산",
        광고축: "수트 · 시계 · 향수 · 누아르 숏폼",
        대표컬러: "Noir Black / Deep Burgundy",
        MBTI: "ISTJ",
        취미: "흑백 영화 보기, 시계 관리, 밤 산책",
        좋아하는선물: "가죽 북커버, 클래식 시계 스트랩, 다크 로즈, 우드 향수"
      },
      shorts: [{ title: "누아르 티저", metric: "비공개 라인" }]
    },
    {
      name: "서하민", publicName: "서하민", slug: "seo-hamin",
      gender: "male",
      type: "엔터테이너", tier: "candidate", status: "secret",
      role: "커뮤니티 MC",
      artistDescription: "어색한 공기도 제가 먼저 풀어볼게요. 팬과 아티스트 사이를 가장 즐겁게 잇는 진행자가 되겠습니다.",
      summary: "팬덤의 분위기를 여는 유쾌한 MC.",
      fandom: "커뮤니티 참여형", business: "예능 숏폼, 팬 이벤트, 고민 상담",
      tags: ["MC", "예능", "커뮤니티"],
      colorAccent: "#808080",
      images: { cover: "./assets/characters/seo-hamin/cover.png", thumb: "./assets/characters/seo-hamin/thumb.png" },
      intro: "서하민은 안경과 큐카드가 잘 어울리는 커뮤니티 MC형 아티스트다. 이벤트, 고민 상담, 팬 참여형 콘텐츠에서 자연스럽게 분위기를 만들고 사람들을 연결한다.", concept: "어색한 공기도 제가 먼저 열어볼게요. 팬과 아티스트가 편하게 웃고 참여할 수 있는 순간을 만드는 진행자가 되겠습니다.",
      profile: {
        생년월일: "2001년 4월 9일 (만 25세)",
        출신지: "대구 수성구",
        신체: "178cm",
        혈액형: "O형",
        포지션: "커뮤니티 MC / 이벤트 진행",
        데뷔: "Lumina Stage 신규 후보",
        캐릭터타입: "팬덤 분위기 메이커형",
        팬덤명: "Hamin Crew",
        팬포인트: "어색함을 푸는 진행력, 밝은 리액션, 팬과 아티스트를 잇는 센스",
        시그니처: "라운드 안경 · 큐카드 · 캐주얼 수트",
        광고축: "예능 숏폼 · 팬 이벤트 · 고민 상담 · 플랫폼 공지",
        대표컬러: "Lime Green / Warm Navy",
        MBTI: "ENFJ",
        취미: "보드게임, 진행 대본 정리, 라디오 듣기",
        좋아하는선물: "귀여운 펜, 큐카드 홀더, 커피 쿠폰, 응원 메시지 카드"
      },
      shorts: [{ title: "팬 이벤트 오프닝", metric: "비공개 라인" }]
    },
    {
      name: "류태오", publicName: "류태오", slug: "ryu-taeo",
      gender: "male",
      type: "스포츠", tier: "candidate", status: "secret",
      role: "스포츠 챌린지",
      artistDescription: "끝까지 가는 힘을 믿어요. 밝게 웃고, 크게 뛰고, 응원의 박자를 무대까지 가져가겠습니다.",
      summary: "끝까지 뛰는 스포츠 챌린지 아티스트.",
      fandom: "응원 캠페인형", business: "스포츠, 에너지 드링크, 챌린지",
      tags: ["스포츠", "챌린지", "응원"],
      colorAccent: "#808080",
      images: { cover: "./assets/characters/ryu-taeo/cover.png", thumb: "./assets/characters/ryu-taeo/thumb.png" },
      intro: "류태오는 밝은 미소와 애슬레틱한 움직임을 가진 스포츠 챌린지형 아티스트다. 글로벌 응원 캠페인, 에너지 드링크, 팀 챌린지 콘텐츠에서 활약할 수 있는 라인이다.", concept: "끝까지 뛰면 닿는 곳이 있다고 믿어요. 밝게 웃고 더 크게 움직이며, 응원의 에너지를 무대 끝까지 가져가겠습니다.",
      profile: {
        생년월일: "2000년 6월 3일 (만 25세)",
        출신지: "인천 송도",
        신체: "183cm",
        혈액형: "O형",
        포지션: "스포츠 챌린지 아티스트",
        데뷔: "Lumina Stage 신규 후보",
        캐릭터타입: "에너지 응원 캠페인형",
        팬덤명: "Taeo Run",
        팬포인트: "밝은 미소, 끝까지 뛰는 힘, 응원을 크게 되돌려주는 에너지",
        시그니처: "스포츠 저지 · 에너지 보틀 · 화이트 헤드밴드",
        광고축: "스포츠 · 운동 챌린지 · 에너지 드링크 · 글로벌 응원 캠페인",
        대표컬러: "Energy Red / Fresh White",
        MBTI: "ESFP",
        취미: "축구, 러닝 기록 체크, 팀 응원 영상 보기",
        좋아하는선물: "스포츠 양말, 팀 컬러 팔찌, 보틀 스티커, 에너지바"
      },
      shorts: [{ title: "응원 챌린지 컷", metric: "비공개 라인" }]
    },
    {
      name: "서유안", publicName: "서유안", slug: "seo-yuan",
      gender: "female",
      type: "모델", tier: "sub", status: "public",
      role: "내추럴 모델",
      artistDescription: "꾸미지 않은 듯 가장 오래 머무는 분위기가 있어요. 편안하지만 선명하게 인사드릴게요.",
      summary: "자연스럽게 스며드는 내추럴 럭셔리.",
      fandom: "호감·선망형", business: "스킨케어, 리빙, 뷰티",
      tags: ["내추럴", "우아함", "뷰티"],
      colorAccent: "#b8f0d0",
      images: { cover: "./assets/characters/seo-yuan/cover.png", thumb: "./assets/characters/seo-yuan/thumb.png" },
      intro: "투명한 피부와 단아한 롱헤어, 미니멀한 화이트 룩이 트레이드마크. 스킨케어와 홈리빙 광고에서 신뢰감 있는 무드를 만들어낸다.",
      concept: "꾸미지 않은 듯 가장 오래 머무는 분위기를 보여드릴게요. 편안하지만 흐려지지 않는 장면으로, 자연스럽게 팬들의 일상에 스며들겠습니다.",
      profile: {
        생년월일: "2002년 4월 21일 (만 24세)",
        출신지: "경기도 과천시",
        신체: "167cm",
        혈액형: "A형",
        포지션: "내추럴 럭셔리 모델",
        데뷔: "2026년 Lumina Stage 공개",
        캐릭터타입: "스킨케어 신뢰 모델형",
        팬덤명: "Yuan Room",
        팬포인트: "투명한 분위기, 편안한 신뢰감, 오래 머무는 자연스러움",
        시그니처: "아이보리 니트 · 투명 립밤 · 미니멀 실버 링",
        광고축: "스킨케어 · 향수 · 홈리빙 · 올드머니 룩",
        대표컬러: "Ivory White / Soft Sage",
        MBTI: "ISFJ",
        취미: "홈카페, 리빙 소품 정리, 식물 돌보기",
        좋아하는선물: "무화과 향 캔들, 세라믹 컵, 미니 화분, 부드러운 니트 소품"
      },
      shorts: [{ title: "스킨케어 무드컷", metric: "공개 중" }]
    }
  ];

  const siteSelectedSlugs = [
    "cha-dohyun",
    "choi-seojin",
    "yoon-serin",
    "han-seoyul",
    "park-doa",
    "seo-yuan",
    "ha-yuna",
    "kwon-taejun",
    "oh-hyerin",
    "min-chaeon"
  ];

  // #277 — slug 마다 gallery 매수와 파일 확장자가 달라질 수 있게 lookup. 기본은 oh-hyerin 까지의
  // 기존 규약(.png 14장). min-chaeon 은 placeholder SVG 18장 (cover/thumb + gallery 16).
  // 에밀리 최종 PNG 도착 시 ext "png", count 16 으로 한 줄만 바꾸면 된다.
  const siteSelectedGalleryConfig = {
    "min-chaeon": { count: 16, ext: "svg" }
  };

  function siteSelectedGallery(slug) {
    const { count = 14, ext = "png" } = siteSelectedGalleryConfig[slug] || {};
    return Array.from({ length: count }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      return [`Gallery ${number}`, `./assets/characters/${slug}/site-selected/gallery-${number}.${ext}`];
    });
  }

  const characterFrontAssets = siteSelectedSlugs.reduce((assets, slug) => {
    assets[slug] = { gallery: siteSelectedGallery(slug) };
    return assets;
  }, {});

  const localGalleryLockedSlugs = new Set(Object.keys(characterFrontAssets));

  function shouldKeepLocalGallery(slug) {
    return localGalleryLockedSlugs.has(slug);
  }

  characters.forEach((artist) => {
    const front = characterFrontAssets[artist.slug];
    if (!front) {
      artist.gallery = [
        { caption: "Cover", src: artist.images.cover },
        { caption: "Thumbnail", src: artist.images.thumb }
      ];
      return;
    }

    artist.gallery = front.gallery.map(([caption, src]) => ({ caption, src }));
  });

  root.characters = characters;
  root.shouldKeepLocalGallery = shouldKeepLocalGallery;
})();
