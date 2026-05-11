(function () {
  "use strict";

  window.LuminaFanEngagementCopy = {
    neutral: {
      title: "오늘의 팬 미션",
      description: "아티스트에게 작은 응원 신호를 보내보세요.",
      cta: "참여하기",
      status: "진행 중",
      missionType: "팬 참여",
      reward: "팬 포인트",
      remaining: "참여 가능",
      loading: "오늘의 팬 미션을 불러오고 있어요.",
      empty: "오늘 참여할 팬 미션을 준비하고 있어요.",
      error: "미션 정보를 불러오지 못해 준비된 예시를 먼저 보여드려요."
    },
    labelsByKey: {
      "fanMission.dailySignal.title": "오늘의 응원 미션",
      "fanMission.dailySignal.description": "한 번의 응원으로 아티스트에게 오늘의 신호를 보내주세요.",
      "fanMission.dailySignal.cta": "응원하기",
      "fanMission.dailyConceptVote.title": "오늘의 콘셉트 투표",
      "fanMission.dailyConceptVote.description": "다음에 보고 싶은 무드를 골라주세요.",
      "fanMission.dailyConceptVote.cta": "투표 준비하기",
      "fanMission.oneLineProposal.title": "한 줄 제안",
      "fanMission.oneLineProposal.description": "아티스트에게 어울릴 피드 아이디어를 한 줄로 남겨보세요.",
      "fanMission.oneLineProposal.cta": "제안 준비하기",
      "fanMission.status.active": "진행 중",
      "fanMission.status.completed": "완료",
      "fanMission.status.pending": "확인 중",
      "fanMission.participation.notStarted": "참여 가능",
      "fanMission.participation.accepted": "참여 완료",
      "fanMission.participation.submitted": "확인 중"
    },
    status: {
      active: "진행 중",
      completed: "완료",
      pending: "확인 중",
      accepted: "참여 완료",
      not_started: "참여 가능",
      submitted: "확인 중"
    },
    missionType: {
      daily_signal: "응원 미션",
      vote_concept: "콘셉트 투표",
      fan_proposal: "팬 제안"
    },
    submit: {
      cta: "참여하기",
      loginRequired: "로그인이 필요해요",
      submitting: "참여 기록 중이에요",
      accepted: "참여 완료",
      alreadyParticipated: "오늘은 이미 참여했어요",
      idempotentReplay: "이미 반영된 참여예요",
      validationError: "참여 조건을 확인해 주세요",
      networkError: "참여를 완료하지 못했어요. 잠시 후 다시 시도해 주세요",
      unavailable: "지금은 참여할 수 없는 미션이에요"
    },
    copyPackV1: {
      missionTitles: [
        "오늘의 응원 신호",
        "무대를 밝히는 한 번",
        "팬심 체크인",
        "오늘의 루미나 터치",
        "아티스트 성장 버튼"
      ],
      ctas: [
        "응원 보내기",
        "오늘 참여하기",
        "신호 남기기",
        "무대 밝히기",
        "한 번 누르기",
        "팬심 전하기",
        "응원 체크",
        "오늘도 함께",
        "성장 돕기",
        "루미나 터치"
      ],
      completed: [
        "응원이 전달됐어요.",
        "오늘의 참여가 기록됐어요.",
        "아티스트에게 작은 빛이 더해졌어요.",
        "팬심 체크인이 완료됐어요.",
        "오늘의 신호가 남았어요.",
        "무대에 한 칸 더 가까워졌어요.",
        "응원 포인트가 쌓였어요.",
        "오늘도 함께한 기록이 남았어요.",
        "성장에 보탬이 됐어요.",
        "루미나 터치 완료."
      ],
      duplicate: [
        "오늘은 이미 참여했어요.",
        "이 미션은 오늘 한 번만 참여할 수 있어요.",
        "이미 응원이 반영됐어요.",
        "오늘의 기록은 완료된 상태예요.",
        "다음 미션에서 다시 만나요."
      ],
      loginRequired: [
        "로그인 후 참여할 수 있어요.",
        "응원을 남기려면 로그인이 필요해요.",
        "내 참여 기록을 남기려면 로그인해 주세요.",
        "로그인하면 오늘의 미션에 참여할 수 있어요.",
        "계정 확인 후 응원을 보낼 수 있어요."
      ],
      titles: [
        "첫 조명",
        "응원 입문자",
        "무대 관찰자",
        "루미나 체크인",
        "팬심 점화",
        "오늘의 서포터",
        "작은 신호",
        "무드 수집가",
        "스테이지 메이트",
        "응원 루틴러"
      ],
      achievementToasts: [
        "업적 달성: 첫 응원을 남겼어요.",
        "업적 달성: 오늘의 미션을 완료했어요.",
        "업적 달성: 꾸준한 응원이 시작됐어요.",
        "업적 달성: 아티스트 성장에 참여했어요.",
        "업적 달성: 새로운 칭호를 얻었어요.",
        "업적 달성: 팬심 기록이 쌓였어요.",
        "업적 달성: 루미나 스테이지에 흔적을 남겼어요.",
        "업적 달성: 오늘도 무대를 밝혔어요.",
        "업적 달성: 응원 루틴이 이어졌어요.",
        "업적 달성: 팬 참여 기록이 갱신됐어요."
      ]
    }
  };
})();
