import { assertStoryContinuationQuality } from './story-continuation-quality.policy';
import type { StoryContinuationApprovedContext } from './story-continuation-context.assembler';
import type { StoryContinuationProviderResult } from './story-continuation.provider';

const context: StoryContinuationApprovedContext = {
  sourceScene: { title: '출발', beats: [{ beatType: 'paragraph', content: '첫 장면이 끝났다.' }] },
  selectedChoice: { label: '항구로 간다' },
  path: [],
  memories: [],
};

function result(text: string): StoryContinuationProviderResult {
  return {
    title: { ko: '새 장면' },
    beats: [{ beatType: 'paragraph', content: { ko: text } }],
    nextChoices: [
      { choiceKey: 'a', label: { ko: '첫째' } },
      { choiceKey: 'b', label: { ko: '둘째' } },
      { choiceKey: 'c', label: { ko: '셋째' } },
    ],
    visualManifest: {},
    usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, imageUnits: 0 },
  };
}

describe('story continuation quality gate', () => {
  it('rejects impossible explicit dates without reflecting private prose', () => {
    for (const text of ['2025-02-29의 사진을 찾았다.', '2026년 4월 31일의 쪽지를 펼쳤다.']) {
      expect(() => assertStoryContinuationQuality(result(text), context, 'ko'))
        .toThrow('continuation_invalid_calendar_date');
    }
  });

  it('allows valid leap dates and ordinary short repeated dialogue', () => {
    expect(() => assertStoryContinuationQuality(result('2024-02-29의 사진을 찾았다.\n\n"기다려."\n\n"기다려."'), context, 'ko'))
      .not.toThrow();
  });

  it('preserves an impossible date deliberately present in the approved manuscript', () => {
    const approved = { ...context, sourceScene: { ...context.sourceScene,
      beats: [{ beatType: 'paragraph', content: '편지에는 2025년 2월 29일이라는 날짜가 쓰여 있었다.' }] } };
    expect(() => assertStoryContinuationQuality(result('2025년 2월 29일의 편지를 다시 펼쳤다.'), approved, 'ko'))
      .not.toThrow();
  });

  it('blocks a long paragraph copied from the source scene', () => {
    const prose = '그날의 바다를 바라보며 오래된 기록을 다시 읽었다. '.repeat(12);
    const source = { ...context, sourceScene: { ...context.sourceScene,
      beats: [{ beatType: 'paragraph', content: prose }] } };
    expect(() => assertStoryContinuationQuality(result(prose), source, 'ko'))
      .toThrow('continuation_source_prose_repeated');
  });

  it('blocks a long paragraph copied from an approved author-style sample', () => {
    const prose = '작가가 남긴 오래된 항구의 공기를 천천히 묘사한 문장이 이어졌다. '.repeat(10);
    const approved = { ...context, memories: [{ memoryType: 'style', content: prose }] };
    expect(() => assertStoryContinuationQuality(result(prose), approved, 'ko'))
      .toThrow('continuation_source_prose_repeated');
  });

  it('blocks a long excerpt copied from inside a larger author-style paragraph', () => {
    const copied = '바람이 멎은 항구에서 오래된 편지를 펼쳤고, 누구도 그날의 이름을 말하지 않았다. '.repeat(9);
    const approved = { ...context, memories: [{ memoryType: 'style', content: `앞부분. ${copied} 뒷부분.` }] };
    expect(() => assertStoryContinuationQuality(result(copied), approved, 'ko'))
      .toThrow('continuation_source_prose_repeated');
  });

  it('blocks a long source paragraph copied and extended with new prose', () => {
    const copied = '바람이 멎은 항구에서 오래된 편지를 펼쳤고, 누구도 그날의 이름을 말하지 않았다. '.repeat(9);
    const approved = { ...context, memories: [{ memoryType: 'style', content: copied }] };
    expect(() => assertStoryContinuationQuality(result(`이후의 일이 시작됐다. ${copied} 새로운 결말이었다.`), approved, 'ko'))
      .toThrow('continuation_source_prose_repeated');
  });

  it('allows a short quotation from the source', () => {
    const source = { ...context, sourceScene: { ...context.sourceScene,
      beats: [{ beatType: 'paragraph', content: '작가는 기록에 이렇게 남겼다. "항구로 돌아와."' }] } };
    expect(() => assertStoryContinuationQuality(result('"항구로 돌아와."라는 말을 떠올렸다.'), source, 'ko'))
      .not.toThrow();
  });

  it('blocks a long paragraph repeated inside the generated scene', () => {
    const prose = '그녀는 불빛이 사라진 항구에서 마지막 편지를 조심스럽게 펼쳤다. '.repeat(10);
    expect(() => assertStoryContinuationQuality(result(`${prose}\n\n${prose}`), context, 'ko'))
      .toThrow('continuation_generated_prose_repeated');
  });
});
