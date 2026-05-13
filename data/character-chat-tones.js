/* Character DM tone fallback.
 * User-facing copy only. No payment, wallet, order, or message mutation wiring.
 */

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
      statusLine: "잠깐 한숨 돌리며 팬 메시지를 보는 중이에요",
      welcomeMessage: "어서 와요! 오늘 하루 어땠어요?",
      lastMessagePreview: "오늘 하루 어땠어요?",
      starters: [
        { key: "A", label: "오늘 하루 공유하기", message: "오늘 이런 일이 있었어요. 같이 들어줄래요?" },
        { key: "B", label: "센터 무대 응원", message: "오늘도 센터 너무 잘 어울렸어요. 빛났어요." },
        { key: "C", label: "팬 인증 자랑하기", message: "오늘 보낸 응원 봤어요? 댓글 한 줄 남겼어요." },
        { key: "D", label: "다음 팬미팅 기다리기", message: "다음 팬미팅 너무 기대돼요. 어떤 코너 준비 중이에요?" }
      ]
    },
    "park-doa": {
      statusLine: "오늘 먹은 메뉴를 자랑하는 중이에요",
      welcomeMessage: "왔어요! 오늘 뭐 먹었어요? 저 진짜 맛있는 거 발견했어요.",
      lastMessagePreview: "오늘 뭐 먹었어요?",
      starters: [
        { key: "A", label: "맛집 추천받기", message: "오늘 점심 뭐 먹을지 못 정했어요. 추천해줘요." },
        { key: "B", label: "짧은 안부 남기기", message: "그냥 안녕 한마디 하러 들렀어요. 잘 지내요?" },
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
        { key: "B", label: "조용한 응원", message: "말 없이 응원만 보낼게요. 오래 봐줄게요." },
        { key: "C", label: "다음 캠페인 궁금해하기", message: "다음 브랜드 협업은 어떤 무드일지 궁금해요." },
        { key: "D", label: "영화 같은 무드 요청", message: "오늘은 영화 한 장면 같은 분위기로 이야기하고 싶어요." }
      ]
    },
    "oh-hyerin": {
      statusLine: "마이크 앞에서 첫 숨을 고르는 중이에요",
      welcomeMessage: "안녕하세요. 오늘은 어떤 노래 들으면서 왔어요?",
      lastMessagePreview: "오늘은 어떤 노래 들으면서 왔어요?",
      starters: [
        { key: "A", label: "오늘의 노래 추천하기", message: "오늘 듣다가 떠올라서 들어왔어요. 같이 들어볼래요?" },
        { key: "B", label: "다음 곡 기대", message: "다음 곡은 어떤 분위기일지 너무 궁금해요." },
        { key: "C", label: "조용한 응원", message: "오늘도 한 음 한 음 잘 부르길 응원할게요." },
        { key: "D", label: "무대 전 안부", message: "무대 전이라면 따뜻한 물 꼭 챙겨요. 오늘도 기다릴게요." }
      ]
    },
    "min-chaeon": {
      statusLine: "가벼운 스트레칭으로 하루를 여는 중이에요",
      welcomeMessage: "왔네요. 오늘은 에너지 얼마나 남아 있어요?",
      lastMessagePreview: "오늘은 에너지 얼마나 남아 있어요?",
      starters: [
        { key: "A", label: "운동 루틴 묻기", message: "오늘 따라할 만한 짧은 루틴 하나만 추천해줘요." },
        { key: "B", label: "상쾌한 응원 보내기", message: "오늘도 밝은 에너지 덕분에 힘이 나요." },
        { key: "C", label: "사진 무드 칭찬", message: "최근 사진에서 건강한 분위기가 정말 잘 보여요." },
        { key: "D", label: "퇴근길 인사", message: "퇴근길에 들렀어요. 오늘 하루도 고생했어요." }
      ]
    },
    "cha-dohyun": {
      statusLine: "오늘 입을 코디를 정리하는 중이에요",
      welcomeMessage: "왔어요. 오늘 무드는 어떤 쪽이에요?",
      lastMessagePreview: "오늘 무드는 어떤 쪽이에요?",
      starters: [
        { key: "A", label: "오늘 코디 칭찬", message: "오늘 보여준 룩 진짜 멋졌어요." },
        { key: "B", label: "스타일 조언받기", message: "이번 주말 약속 룩 추천 좀 해줘요." },
        { key: "C", label: "다음 무대 응원", message: "다음 무대도 차도현답게 장악해줘요." },
        { key: "D", label: "차분한 안부", message: "바쁜 하루였죠? 잠깐 쉬어가도 괜찮아요." }
      ]
    },
    "kang-sia": {
      statusLine: "도시의 밤빛을 고르는 중이에요",
      welcomeMessage: "어서 와요. 오늘은 어떤 장면으로 기억되고 싶어요?",
      lastMessagePreview: "오늘은 어떤 장면으로 기억되고 싶어요?",
      starters: [
        { key: "A", label: "도시 야경 무드", message: "오늘은 도시 야경 같은 분위기로 이야기하고 싶어요." },
        { key: "B", label: "촬영 컷 칭찬", message: "최근 컷에서 시선이 너무 강해서 오래 봤어요." },
        { key: "C", label: "다음 화보 묻기", message: "다음 화보는 어떤 콘셉트인지 살짝 알려줄 수 있어요?" },
        { key: "D", label: "짧은 응원", message: "오늘도 강시아다운 장면을 남겨줘요. 응원할게요." }
      ]
    },
    "lee-jiwon": {
      statusLine: "대본의 마지막 장면을 다시 읽는 중이에요",
      welcomeMessage: "왔어요. 오늘은 어떤 장면이 마음에 남았어요?",
      lastMessagePreview: "오늘은 어떤 장면이 마음에 남았어요?",
      starters: [
        { key: "A", label: "인상 깊은 장면 말하기", message: "오늘 본 장면 중에 이지원 생각이 나는 순간이 있었어요." },
        { key: "B", label: "다음 작품 궁금해하기", message: "다음 작품에서는 어떤 얼굴을 보여줄지 궁금해요." },
        { key: "C", label: "배우 무드 응원", message: "차분하게 쌓이는 분위기가 좋아요. 오래 응원할게요." },
        { key: "D", label: "하루 안부", message: "촬영이 있는 날이라면 밥 꼭 챙겨요. 오늘도 고생했어요." }
      ]
    },
    "ha-yuna": {
      statusLine: "새로운 색 조합을 고르는 중이에요",
      welcomeMessage: "왔어요! 오늘은 어떤 색이 제일 끌려요?",
      lastMessagePreview: "오늘은 어떤 색이 제일 끌려요?",
      starters: [
        { key: "A", label: "오늘 컬러 고르기", message: "오늘 기분에 어울리는 색 하나 골라줘요." },
        { key: "B", label: "트렌드 이야기", message: "요즘 제일 눈에 들어오는 스타일은 뭐예요?" },
        { key: "C", label: "밝은 응원", message: "하윤아의 밝은 에너지가 오늘도 필요해서 왔어요." },
        { key: "D", label: "사진 칭찬", message: "최근 사진 색감이 너무 예뻐서 계속 보게 돼요." }
      ]
    },
    "baek-ria": {
      statusLine: "바람 좋은 곳에서 잠깐 쉬는 중이에요",
      welcomeMessage: "안녕. 오늘은 조금 가볍게 이야기해볼까요?",
      lastMessagePreview: "오늘은 조금 가볍게 이야기해볼까요?",
      starters: [
        { key: "A", label: "여름 무드 보내기", message: "오늘은 맑은 바람 같은 분위기가 생각나서 왔어요." },
        { key: "B", label: "편안한 안부", message: "오늘 하루는 어땠어요? 천천히 쉬어가요." },
        { key: "C", label: "청량한 사진 칭찬", message: "최근 사진이 정말 청량해서 기분이 좋아졌어요." },
        { key: "D", label: "다음 콘텐츠 기다리기", message: "다음에는 어떤 모습으로 찾아올지 기다리고 있어요." }
      ]
    },
    "oh-yuna": {
      statusLine: "무대 뒤에서 축제의 첫 박자를 기다려요",
      welcomeMessage: "어서 와요! 오늘은 같이 조금 신나볼까요?",
      lastMessagePreview: "오늘은 같이 조금 신나볼까요?",
      starters: [
        { key: "A", label: "축제 같은 응원", message: "오늘도 무대가 축제처럼 빛나길 응원해요." },
        { key: "B", label: "댄스 포인트 묻기", message: "이번 안무에서 제일 좋아하는 포인트는 어디예요?" },
        { key: "C", label: "밝은 안부", message: "기분 좋아지는 한마디 들으러 왔어요. 오늘 어때요?" },
        { key: "D", label: "팬서비스 칭찬", message: "팬들 바라보는 표정이 너무 따뜻해서 좋았어요." }
      ]
    },
    "kwon-taejun": {
      statusLine: "조용한 대기실에서 다음 장면을 기다려요",
      welcomeMessage: "왔군요. 오늘은 어떤 말부터 남기고 싶어요?",
      lastMessagePreview: "오늘은 어떤 말부터 남기고 싶어요?",
      starters: [
        { key: "A", label: "깊은 분위기 칭찬", message: "말수가 많지 않아도 분위기가 오래 남아요." },
        { key: "B", label: "다음 장면 묻기", message: "다음에는 어떤 장면으로 만나게 될지 궁금해요." },
        { key: "C", label: "차분한 응원", message: "오늘도 권태준만의 속도로 잘 걸어가길 응원해요." },
        { key: "D", label: "늦은 밤 인사", message: "늦은 밤에 생각나서 들렀어요. 편히 쉬어요." }
      ]
    },
    "seo-hamin": {
      statusLine: "오늘의 진행 멘트를 가볍게 맞춰보는 중이에요",
      welcomeMessage: "왔어요! 오늘 분위기는 제가 살려볼까요?",
      lastMessagePreview: "오늘 분위기는 제가 살려볼까요?",
      starters: [
        { key: "A", label: "유쾌한 인사", message: "오늘 텐션 좀 올려줘요. 서하민식으로 부탁해요." },
        { key: "B", label: "진행 실력 칭찬", message: "말을 편하게 이어가는 분위기가 좋아요." },
        { key: "C", label: "오늘의 질문", message: "오늘 팬들에게 하나만 질문한다면 뭐라고 물어볼 거예요?" },
        { key: "D", label: "짧은 응원", message: "무대든 토크든 오늘도 자연스럽게 빛나줘요." }
      ]
    },
    "ryu-taeo": {
      statusLine: "훈련 끝나고 숨을 고르는 중이에요",
      welcomeMessage: "왔어요. 오늘은 어디까지 달려봤어요?",
      lastMessagePreview: "오늘은 어디까지 달려봤어요?",
      starters: [
        { key: "A", label: "훈련 응원", message: "오늘도 묵묵히 해내는 모습이 멋져요." },
        { key: "B", label: "스포츠 루틴 묻기", message: "컨디션 올릴 때 꼭 챙기는 루틴이 있어요?" },
        { key: "C", label: "직선적인 칭찬", message: "꾸밈없이 집중하는 모습이 제일 좋았어요." },
        { key: "D", label: "휴식 챙기기", message: "열심히 한 만큼 쉬는 것도 잊지 마요." }
      ]
    },
    "seo-yuan": {
      statusLine: "창가에서 햇볕을 쬐는 중이에요",
      welcomeMessage: "와줬구나. 오늘 날씨 좋죠?",
      lastMessagePreview: "오늘 날씨 좋죠?",
      starters: [
        { key: "A", label: "오늘 산책 같이하기", message: "오늘 같이 산책하는 느낌으로 한 마디만 남기고 갈게요." },
        { key: "B", label: "최근 컷 칭찬", message: "최근 화보 한 장이 너무 자연스러워서 좋았어요." },
        { key: "C", label: "조용한 안부", message: "잘 지내요. 그 한 줄이면 충분해요." },
        { key: "D", label: "따뜻한 응원", message: "서유안의 편안한 분위기가 오늘도 오래 남았어요." }
      ]
    }
  };

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
