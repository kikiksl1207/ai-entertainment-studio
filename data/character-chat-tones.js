/* ──────────────────────────────────────────────
 * #216 v2 — 캐릭터별 DM 인사말/스타터 톤 (에밀리 작성, Instagram DM 결)
 * - 각 캐릭터는 자기 콘셉트/팬포인트에 맞는 인사말과 스타터 3~5개를 가진다.
 * - 게임식·AI식 표현 X. "안녕하세요/반갑습니다" 같은 정형 인사는 캐릭터별로 다르게.
 * - 백엔드 starter-prompts API가 캐릭터별 데이터를 채워주기 전 프론트 fallback.
 * - 사용자 화면 노출. 결제/주문/지갑 mutation 호출 없음.
 * ────────────────────────────────────────────── */

(function (global) {
  global.LuminaStaticData = global.LuminaStaticData || {};

  const chatTones = {
    "yoon-serin": {
      statusLine: "조용히 무대를 정리하는 중이에요",
      welcomeMessage: "안녕. 오늘은 어떤 마음으로 와줬어요?",
      lastMessagePreview: "오늘은 어떤 마음으로 와줬어요?",
      starters: [
        { key: "A", label: "오늘 무대 응원 보내기", message: "오늘도 차분히 무대 준비하는 모습 응원해요." },
        { key: "B", label: "조용한 안부 묻기", message: "오늘 컨디션은 어때요? 무리하지 마요." },
        { key: "C", label: "다음 무대 궁금해하기", message: "다음 무대에서는 어떤 모습을 보여줄 거예요?" },
        { key: "D", label: "방금 본 화보 칭찬", message: "방금 본 화보 진짜 멋졌어요. 한참 바라봤어요." }
      ]
    },
    "han-seoyul": {
      statusLine: "잠깐 한숨 돌리는 중이에요",
      welcomeMessage: "어서 와요! 오늘 하루 어땠어요?",
      lastMessagePreview: "오늘 하루 어땠어요?",
      starters: [
        { key: "A", label: "오늘 하루 공유하기", message: "오늘 저 이런 일 있었어요. 같이 들어줄래요?" },
        { key: "B", label: "센터 무대 응원", message: "오늘도 센터 너무 잘 어울렸어요. 빛났어요." },
        { key: "C", label: "팬 인증 자랑하기", message: "오늘 보낸 응원 봤어요? 댓글 한 줄 남겼어요." },
        { key: "D", label: "다음 팬미팅 기다리기", message: "다음 팬미팅 너무 기대돼요. 어떤 코너 준비 중이에요?" }
      ]
    },
    "park-doa": {
      statusLine: "오늘 먹은 메뉴 자랑 중이에요",
      welcomeMessage: "왔어요! 오늘 뭐 먹었어요? 저 진짜 맛있는 거 발견했어요.",
      lastMessagePreview: "오늘 뭐 먹었어요?",
      starters: [
        { key: "A", label: "맛집 추천받기", message: "오늘 점심 뭐 먹을지 못 정했어요. 추천해줘요." },
        { key: "B", label: "오늘 짧은 안부", message: "그냥 안녕 한마디 하러 들렀어요. 잘 지내요?" },
        { key: "C", label: "최근 방송 응원", message: "최근 방송 너무 웃겼어요. 표정 진짜 귀여워요." },
        { key: "D", label: "주말 일정 묻기", message: "이번 주말은 뭐 해요? 같이 쉬어요." }
      ]
    },
    "choi-seojin": {
      statusLine: "다음 한 컷을 고르는 중이에요",
      welcomeMessage: "왔군요. 오늘 본 장면 중에 마음에 남은 것 있어요?",
      lastMessagePreview: "오늘 본 장면 중에 마음에 남은 것 있어요?",
      starters: [
        { key: "A", label: "화보 한 컷 칭찬", message: "최근 화보 한 컷이 계속 머릿속에 남아요." },
        { key: "B", label: "조명 톤 칭찬", message: "말 없이 응원만 보낼게요. 오래 봐줄게요." },
        { key: "C", label: "다음 캠페인 궁금해하기", message: "다음 브랜드 협업은 어떤 무드일지 궁금해요." },
        { key: "D", label: "최근 인터뷰 한 마디", message: "최근 인터뷰에서 남긴 한 마디가 오래 남았어요." }
      ]
    },
    "oh-hyerin": {
      statusLine: "마이크 앞에서 첫 숨 고르는 중이에요",
      welcomeMessage: "안녕하세요. 오늘은 어떤 노래 들으면서 왔어요?",
      lastMessagePreview: "오늘은 어떤 노래 들으면서 왔어요?",
      starters: [
        { key: "A", label: "오늘의 노래 추천하기", message: "오늘 듣다가 떠올라서 들어왔어요. 같이 들어볼래요?" },
        { key: "B", label: "다음 곡 기대", message: "다음 곡은 어떤 분위기일지 너무 궁금해요." },
        { key: "C", label: "조용한 응원", message: "오늘도 한 음 한 음 잘 부르길 응원할게요." },
        { key: "D", label: "팬레터 기록 남기기", message: "오늘 들은 곡을 짧은 메모로 남겨두려고요." }
      ]
    },
    "cha-dohyun": {
      statusLine: "오늘 입을 코디 정리 중이에요",
      welcomeMessage: "왔어요. 오늘 무드는 어떤 쪽이에요?",
      lastMessagePreview: "오늘 무드는 어떤 쪽이에요?",
      starters: [
        { key: "A", label: "오늘 코디 칭찬", message: "오늘 보여준 룩 진짜 멋졌어요." },
        { key: "B", label: "스타일 조언받기", message: "이번 주말 약속 룩 추천 좀 해줘요." },
        { key: "C", label: "다음 무대 응원", message: "다음 무대도 차도현답게 장악해줘요." },
        { key: "D", label: "패션 영감 묻기", message: "요즘 영감을 받는 디자이너나 룩 있어요?" }
      ]
    },
    "seo-yuan": {
      statusLine: "창가에서 햇볕 쬐는 중이에요",
      welcomeMessage: "와줬구나. 오늘 날씨 좋죠?",
      lastMessagePreview: "오늘 날씨 좋죠?",
      starters: [
        { key: "A", label: "오늘 산책 같이하기", message: "오늘 같이 산책하는 느낌으로 한 마디만 남기고 갈게요." },
        { key: "B", label: "최근 컷 칭찬", message: "최근 화보 한 장이 너무 자연스러워서 좋았어요." },
        { key: "C", label: "조용한 안부", message: "잘 지내요. 그 한 줄이면 충분해요." },
        { key: "D", label: "좋아하는 풍경 묻기", message: "요즘 카메라에 담고 싶은 풍경 있어요?" }
      ]
    },
    /* #315 — 공개 라인업이 늘어났는데 톤이 default로 떨어지면 캐릭터별 차별점이 사라짐.
       민채온/하윤아/권태준 세 명을 페르소나에 맞춰 추가. */
    "min-chaeon": {
      statusLine: "스트레칭 끝내고 한숨 돌리는 중이에요",
      welcomeMessage: "왔어요! 오늘 컨디션 어때요? 같이 무리 안 하고 시작해요.",
      lastMessagePreview: "오늘 컨디션 어때요?",
      starters: [
        { key: "A", label: "오늘 컨디션 묻기", message: "오늘 몸 상태 어때요? 무리하지 말고 같이 천천히 가요." },
        { key: "B", label: "운동 루틴 공유받기", message: "요즘 어떤 루틴으로 몸 만들고 있어요? 한 동작이라도 알려주세요." },
        { key: "C", label: "무대 응원", message: "다음 무대에서 보여줄 반전 에너지 너무 기대돼요." },
        { key: "D", label: "귀여운 안부", message: "오늘도 채온이답게 활짝 웃고 시작하세요." }
      ]
    },
    "ha-yuna": {
      statusLine: "오늘의 컬러 매치 골라보는 중이에요",
      welcomeMessage: "와줬네요. 오늘 입은 컬러는 뭐예요? 사진 한 장만 보여줘요.",
      lastMessagePreview: "오늘 입은 컬러는 뭐예요?",
      starters: [
        { key: "A", label: "오늘 컬러 자랑", message: "오늘 입은 컬러랑 무드 자랑하러 왔어요." },
        { key: "B", label: "트렌드 추천받기", message: "이번 주 꽂힌 컬러나 아이템 있으면 추천해줘요." },
        { key: "C", label: "최근 숏폼 응원", message: "최근 올린 컷 컬러 진짜 잘 맞춰서 한참 봤어요." },
        { key: "D", label: "주말 룩 묻기", message: "이번 주말 약속 룩 같이 골라줄래요?" }
      ]
    },
    "kwon-taejun": {
      statusLine: "조용히 대본 한 줄을 다시 보는 중이에요",
      welcomeMessage: "왔군. 오늘은 길게 말하지 않아도 돼요. 한마디면 충분해요.",
      lastMessagePreview: "한마디면 충분해요.",
      starters: [
        { key: "A", label: "묵묵한 한 줄 응원", message: "그냥 잘 지낸다는 한 줄만 남기고 갈게요." },
        { key: "B", label: "최근 장면 칭찬", message: "최근 본 장면에서 침묵이 더 길게 남았어요." },
        { key: "C", label: "다음 작품 기대", message: "다음 작품은 어떤 결의 인물일지 궁금해요." },
        { key: "D", label: "오늘 결 묻기", message: "오늘은 어떤 결의 침묵이에요? 따라가볼게요." }
      ]
    }
  };

  // fallback — 캐릭터별 톤이 없는 경우 사용. AI/봇 단어 안 쓰고 부드럽게.
  const defaultTone = {
    statusLine: "활동 중 · 메시지를 기다리고 있어요",
    welcomeMessage: "메시지 보내줘서 고마워요. 오늘은 어떤 이야기로 시작해볼까요?",
    lastMessagePreview: "오늘은 어떤 이야기로 시작해볼까요?",
    starters: [
      { key: "A", label: "오늘 하루 어땠는지 물어보기", message: "오늘 하루 어떻게 보냈어요? 무대 준비는 잘 되고 있어요?" },
      { key: "B", label: "응원 한마디 보내기", message: "당신의 무대를 항상 응원하고 있어요. 오늘도 빛나주세요." },
      { key: "C", label: "요즘 듣는 음악 물어보기", message: "요즘 자주 듣는 노래나 즐겨 보는 영상 있어요?" }
    ]
  };

  function getChatTone(slug) {
    if (!slug) return defaultTone;
    return chatTones[slug] || defaultTone;
  }

  global.LuminaStaticData.chatTones = chatTones;
  global.LuminaStaticData.getChatTone = getChatTone;
})(window);
