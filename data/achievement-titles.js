/* ──────────────────────────────────────────────
 * #204 v1 — 업적/칭호/배지 데이터 (에밀리 작성본 1:1 매핑)
 * - 칭호 표시 UI가 만들어지면 이 파일을 import 해서 칩/리스트로 그리면 됨.
 * - 서버 enum 도착 전까지는 키만 로컬 ID 로 사용. 추후 achievementId/titleId 와 매핑.
 * - 보상 지급/적립은 백엔드 단독. 프론트는 이름·조건·톤만 보여준다.
 * ────────────────────────────────────────────── */

window.LuminaAchievementTitles = (function () {
  // 배지 4등급 — 칭호 카드 좌측 라이트, 프로필 칩 컬러 등에 사용
  const badgeTiers = [
    {
      key: "soft_light",
      name: "Soft Light",
      hint: "라벤더 보라",
      gradient: "linear-gradient(135deg, #b48cff 0%, #d6b8ff 100%)",
      surface: "rgba(180, 140, 255, 0.16)",
      ink: "#d6b8ff",
      usage: "첫 진입, 기본 업적"
    },
    {
      key: "pink_signal",
      name: "Pink Signal",
      hint: "핫핑크 포인트",
      gradient: "linear-gradient(135deg, #ff4fc3 0%, #ff9ad0 100%)",
      surface: "rgba(255, 79, 195, 0.18)",
      ink: "#ff9ad0",
      usage: "첫 좋아요, 첫 응원, 첫 댓글"
    },
    {
      key: "stage_glow",
      name: "Stage Glow",
      hint: "보라+핑크 그라데이션",
      gradient: "linear-gradient(135deg, #9b7cf7 0%, #ff4fc3 100%)",
      surface: "rgba(155, 124, 247, 0.18)",
      ink: "#c8a8ff",
      usage: "7일/30일 꾸준한 활동"
    },
    {
      key: "spotlight",
      name: "Spotlight",
      hint: "딥 퍼플 + 골드 소량",
      gradient: "linear-gradient(135deg, #5a3aa8 0%, #f4c97a 100%)",
      surface: "rgba(90, 58, 168, 0.22)",
      ink: "#f4c97a",
      usage: "유료 응원, 장기 기여, 특별 이벤트"
    }
  ];

  // 업적 카테고리 6개 — 기존 분류 → 화면 표시명/보조설명
  const categories = [
    { key: "attendance", label: "매일의 조명", sub: "매일 방문하고 응원 흐름을 이어간 기록" },
    { key: "first_action", label: "첫 무대 입장", sub: "가입 후 처음 남긴 행동과 시작 기록" },
    { key: "fan_signal", label: "팬 시그널", sub: "좋아요, 댓글, 투표, 응원 등 팬 참여 기록" },
    { key: "profile_complete", label: "내 무대 정리", sub: "닉네임, 프로필, 소개 등 내 공간을 채운 기록" },
    { key: "creator_support", label: "크리에이터 서포트", sub: "유저/AI 크리에이터에게 남긴 응원과 후원 기록" },
    { key: "long_run", label: "오래 켠 조명", sub: "일정 기간 꾸준히 참여한 장기 활동 기록" }
  ];

  // 칭호 24개 — v1 라벨 1:1
  const titles = [
    { key: "first_lit_fan",            label: "첫 조명을 켠 팬",      tier: "soft_light",  category: "first_action",     condition: "첫 로그인 / 첫 방문" },
    { key: "stage_first_row",          label: "무대의 첫 줄",         tier: "soft_light",  category: "first_action",     condition: "첫 아티스트 상세 방문" },
    { key: "quiet_supporter",          label: "조용한 응원자",        tier: "pink_signal", category: "fan_signal",       condition: "첫 좋아요" },
    { key: "pink_signal",              label: "핑크 시그널",          tier: "pink_signal", category: "fan_signal",       condition: "첫 유료/무료 응원 중 하나" },
    { key: "today_audience",           label: "오늘의 객석",          tier: "soft_light",  category: "attendance",       condition: "하루 첫 출석" },
    { key: "lumina_mate",              label: "루미나 메이트",        tier: "soft_light",  category: "attendance",       condition: "3일 연속 방문" },
    { key: "weekly_light",             label: "일주일의 조명",        tier: "stage_glow",  category: "long_run",         condition: "7일 연속 방문" },
    { key: "long_spotlight",           label: "오래 켠 스포트라이트", tier: "stage_glow",  category: "long_run",         condition: "30일 누적 방문" },
    { key: "mood_catcher",             label: "무드 캐처",            tier: "pink_signal", category: "fan_signal",       condition: "숏폼/피드 좋아요 누적" },
    { key: "feed_warmth",              label: "피드의 온도",          tier: "pink_signal", category: "fan_signal",       condition: "첫 피드 댓글" },
    { key: "single_line_cheer",        label: "한 줄의 응원",         tier: "pink_signal", category: "fan_signal",       condition: "첫 응원 댓글" },
    { key: "fanletter_writer",         label: "팬레터 라이터",        tier: "stage_glow",  category: "fan_signal",       condition: "댓글 10회" },
    { key: "taste_curator",            label: "취향 큐레이터",        tier: "stage_glow",  category: "fan_signal",       condition: "좋아요 20회" },
    { key: "pick_starter",             label: "픽의 시작",            tier: "pink_signal", category: "first_action",     condition: "첫 인기투표 참여" },
    { key: "today_selector",           label: "오늘의 선택자",        tier: "stage_glow",  category: "fan_signal",       condition: "인기투표 3회" },
    { key: "backstage_friend",         label: "무대 뒤 친구",         tier: "soft_light",  category: "profile_complete", condition: "마이페이지 프로필 완성" },
    { key: "owner_of_my_stage",        label: "내 무대의 주인",       tier: "stage_glow",  category: "profile_complete", condition: "닉네임/프로필/소개 완성" },
    { key: "debut_cheer_squad",        label: "첫 데뷔 응원단",       tier: "pink_signal", category: "first_action",     condition: "데뷔하기 페이지 방문/신청 관심" },
    { key: "creator_supporter",        label: "크리에이터 서포터",    tier: "stage_glow",  category: "creator_support",  condition: "유저 크리에이터 첫 응원" },
    { key: "backstage_buddy",          label: "백스테이지 프렌드",    tier: "stage_glow",  category: "creator_support",  condition: "크리에이터 콘텐츠 반복 응원" },
    { key: "lumina_keeper",            label: "루미나 키퍼",          tier: "spotlight",   category: "long_run",         condition: "신고/숨김 등 건강한 커뮤니티 참여" },
    { key: "dawn_audience",            label: "새벽의 관객",          tier: "stage_glow",  category: "attendance",       condition: "야간 시간대 방문/응원" },
    { key: "stage_listener",           label: "스테이지 리스너",      tier: "pink_signal", category: "first_action",     condition: "캐릭터챗 첫 시작" },
    { key: "stargatherer",             label: "별빛을 모으는 사람",   tier: "spotlight",   category: "long_run",         condition: "루미나 누적 사용/적립" }
  ];

  // 초보자 온보딩 핵심 업적 5종 — 우선순위 순서. mypage 보상 섹션과 별개로
  // 칭호 추천 매핑까지 한 묶음으로 둔다.
  const beginnerOnboarding = [
    { rank: 1, key: "first_login",          label: "첫 조명 켜기",       condition: "회원가입 후 첫 로그인",
      rewardCopy: "첫 방문 보상으로 30L가 적립되었어요.",                titleSuggestion: "first_lit_fan" },
    { rank: 2, key: "profile_basic_setup",  label: "내 무대 정리",       condition: "닉네임/프로필/소개 중 필수 항목 완성",
      rewardCopy: "내 무대가 정리되었어요. 30L가 적립되었습니다.",      titleSuggestion: "owner_of_my_stage" },
    { rank: 3, key: "first_feed_like",      label: "첫 응원 시그널",     condition: "첫 좋아요 또는 첫 응원 클릭",
      rewardCopy: "첫 응원 시그널이 기록되었어요. 10L가 적립되었습니다.", titleSuggestion: "quiet_supporter" },
    { rank: 4, key: "first_character_chat", label: "첫 팬 대화",         condition: "캐릭터챗 첫 대화 시작",
      rewardCopy: "첫 대화가 시작되었어요. 10L가 적립되었습니다.",      titleSuggestion: "stage_listener" },
    { rank: 5, key: "first_popular_vote",   label: "첫 픽 참여",         condition: "인기투표 첫 참여",
      rewardCopy: "오늘의 선택이 기록되었어요. 10L가 적립되었습니다.",  titleSuggestion: "pick_starter" }
  ];

  // 본인확인 · 결제 관련 보상 (#204 큐알 FAIL — raw code 노출 차단용 v1 톤 매핑)
  // 백엔드가 보내는 code 가 사용자 제목에 그대로 노출되지 않도록 라벨/설명/추천 칭호까지 묶어둔다.
  const verificationAndChargeRewards = [
    { key: "identity_verification_bonus", label: "본인 확인 보상",
      condition: "NICE 본인 확인 완료",
      description: "본인 확인을 마치면 열려요.",
      titleSuggestion: "owner_of_my_stage" },
    { key: "first_charge_bonus",          label: "첫 충전 시그널",
      condition: "처음으로 루미나 충전 완료",
      description: "처음으로 루미나를 충전하면 열려요.",
      titleSuggestion: "pink_signal" }
  ];

  // 프론트 화면 i18n 카피 셋 — v1 JSON 1:1 (현재는 ko-KR 하드코딩, i18n 구조 확정 후 키 분리 예정)
  const copy = {
    "achievement.unlocked":       "업적이 기록되었어요.",
    "achievement.rewardSaved":    "참여 보상으로 {amount}L가 적립되었어요.",
    "achievement.titleUnlocked":  "새 칭호를 사용할 수 있어요.",
    "achievement.alreadyClaimed": "이미 받은 보상입니다.",
    "achievement.locked":         "조금만 더 참여하면 열려요.",
    "achievement.viewTitles":     "칭호 보러가기",
    "achievement.setTitle":       "대표 칭호로 설정",
    "achievement.beginnerGroup":  "처음 켠 조명",
    "achievement.fanGroup":       "팬 시그널",
    "achievement.longRunGroup":   "오래 켠 조명"
  };

  function getBadgeTier(key) {
    return badgeTiers.find(t => t.key === key) || badgeTiers[0];
  }
  function getTitle(key) {
    return titles.find(t => t.key === key) || null;
  }
  function getCategory(key) {
    return categories.find(c => c.key === key) || null;
  }

  return Object.freeze({
    badgeTiers, categories, titles, beginnerOnboarding, verificationAndChargeRewards, copy,
    getBadgeTier, getTitle, getCategory
  });
})();
