import type { StoryContinuationApprovedContext } from './story-continuation-context.assembler';

// Original synthetic QA prose, not a user's manuscript. Recombined episodes exercise Korean,
// dialogue, names and continuity at a full 10k-character context size without live generation.
const events = [
  '서윤은 물에 잠긴 다리를 건너는 대신 마을에 남아 사람들을 돕기로 했다. 도현은 떠날 기회를 놓쳤다고 생각했지만, 아이가 내민 젖은 지도를 받아 들고는 말을 삼켰다.',
  '창고 문을 열자 곡식 자루 사이에 접힌 편지가 있었다. 편지는 이웃을 탓하지 말고 강의 흐름부터 살펴 달라고 부탁했다. 서윤은 그 문장을 두 번 읽었다.',
  '도현이 등불을 들어 올렸을 때 벽에 남은 물자국이 보였다. 물은 바깥에서 들어온 것이 아니었다. 오래전에 막아 둔 수로가 창고 아래로 이어지고 있었다.',
  '마을 회의에서 서윤은 발견한 사실을 숨기지 않았다. 누군가는 당장 수문을 열자고 했고, 누군가는 아래쪽 집들이 먼저 위험해질 것이라고 반대했다.',
  '도현은 자신의 잘못을 설명하려다가 멈췄다. 서윤이 대신 말해 주기를 바랐던 것은 아니지만, 혼자 책임을 져야 한다는 두려움이 목소리를 작게 만들었다.',
  '두 사람은 아래쪽 집들을 직접 찾아갔다. 노인은 이미 짐을 싸고 있었다. 그는 누구의 명령인지 묻지 않고, 아직 소식을 듣지 못한 집의 위치를 알려 주었다.',
  '서윤이 돌아왔을 때 회의장에는 빈 의자만 남아 있었다. 도현은 문 옆에서 기다리고 있었다. 먼저 떠날 수 있었는데도 기다렸다는 사실을 굳이 설명하지 않았다.',
  '수문을 열기 전에 종을 세 번 울리기로 약속했다. 아이들은 그 약속을 골목마다 전했고, 사람들은 자신이 들은 횟수를 서로 확인했다. 서두르는 것보다 확인하는 일이 중요했다.',
  '첫 번째 종이 울리자 강변의 불빛이 움직였다. 서윤은 도현에게 열쇠를 건넸다. 그를 믿겠다는 말보다, 열쇠를 받은 손이 잠시 떨렸다는 사실이 오래 기억에 남았다.',
  '두 번째 종은 예상보다 늦게 울렸다. 마지막 집의 문이 열리지 않았기 때문이다. 도현은 수문 곁을 지키고 서윤은 골목으로 달려갔다. 두 사람은 서로의 일을 대신하지 않았다.',
  '세 번째 종이 끝난 뒤에야 수문이 움직였다. 물소리는 컸지만 사람들의 목소리는 들렸다. 서윤은 누가 무사히 도착했는지 한 명씩 확인하며 젖은 명부에 표시했다.',
  '새벽이 밝았을 때 다리는 여전히 끊겨 있었다. 떠날 길은 아직 없었지만, 남아 있는 사람들 사이에는 새로운 약속이 생겼다. 도현은 다음 일을 혼자 결정하지 않고 서윤에게 물었다.',
];

const observations = [
  '바람이 지나갈 때마다 처마 끝에서 물방울이 떨어졌다. 마을의 시간은 그 작은 소리와 사람들의 발걸음에 맞추어 흘렀다. 서윤은 서두르지 않고 눈앞의 일을 하나씩 살폈다.',
  '등불 아래에서 서로의 얼굴을 확인하는 일은 생각보다 중요했다. 같은 말을 듣고도 다른 장면을 떠올릴 수 있었다. 두 사람은 모르는 부분을 아는 척하지 않기로 했다.',
  '아직 대답하지 못한 질문이 남아 있었다. 하지만 대답을 미루는 것과 책임을 피하는 것은 달랐다. 서윤은 알아낸 사실과 짐작한 내용을 따로 적어 두었다.',
  '길 위에 남은 발자국은 금방 물에 지워졌다. 누가 먼저 왔는지보다 누가 아직 오지 않았는지를 기억해야 했다. 도현은 명부의 빈칸을 손가락으로 짚었다.',
];

export function koreanContinuationContext(): StoryContinuationApprovedContext {
  const beats: Array<{ beatType: string; content: string }> = [];
  let remaining = 10_000;
  for (let i = 0; remaining > 0; i++) {
    const prose = `${events[i % events.length]} ${observations[i % observations.length]} ` +
      `"${i % 2 ? '먼저 약속한 일을 끝내고 다음 길을 정하자.' : '네가 확인한 사실부터 말해 줘. 함께 판단할게.'}" ` +
      '그 말은 명령이 아니라 함께 책임을 지겠다는 뜻이었다. 선택의 결과를 지우지 않고 기억하는 것이 두 사람에게는 필요했다. ';
    const content = prose.slice(0, remaining);
    beats.push({ beatType: i % 5 === 0 ? 'dialogue' : 'paragraph', content });
    remaining -= content.length;
  }
  return {
    sourceScene: { title: '세 번째 종이 울린 마을', beats },
    selectedChoice: { label: '도현과 마을에 남아 끊어진 다리를 고친다' },
    path: [{ sourceTitle: '강가의 갈림길', choiceLabel: '떠나는 배를 보내고 남는다', targetTitle: '세 번째 종이 울린 마을', explicitRejoin: false, endingType: null }],
    memories: [
      { memoryType: 'author_style', content: '절제된 삼인칭 시점. 감정은 행동과 대화의 간격으로 보여 준다. 갑작스러운 설명이나 운명적 재회를 넣지 않는다.' },
      { memoryType: 'relationship', content: '서윤은 도현에게 수문 열쇠를 맡겼다. 도현은 이제 혼자 결정하지 않는다. 두 사람은 마을을 떠날 기회를 스스로 포기했다.' },
    ],
  };
}
