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

  describe('M1 full-source paragraph segmentation', () => {
    const samples = [
      { locale: "ko", sentences: [
        "\uc11c\uc724\uc740 \uc0c8\ubcbd \uae30\ucc28\uc5d0\uc11c \ub0b4\ub9b0 \ub4a4 \uc544\uc9c1 \ubb38\uc744 \uc5f4\uc9c0 \uc54a\uc740 \ud56d\uad6c \ucc3d\uace0 \uc55e\uc5d0\uc11c \uc816\uc740 \uc9c0\ub3c4\uc640 \uc5b4\uc81c \ubc1b\uc740 \ud3b8\uc9c0\ub97c \ubc88\uac08\uc544 \uc0b4\ud3c8\ub2e4.",
        "\ubbfc\ud638\ub294 \ubc29\ud30c\uc81c \uc544\ub798 \ubb36\uc5ec \uc788\ub294 \uc791\uc740 \ubc30\ub97c \uac00\ub9ac\ud0a4\uba70 \ubc24\uc0ac\uc774 \ub204\uad70\uac00 \ubc27\uc904\uc758 \ub9e4\ub4ed\uc744 \ub2e4\uc2dc \uace0\uccd0 \ub193\uc558\ub2e4\ub294 \uc0ac\uc2e4\uc744 \uc870\uc6a9\ud788 \ub9d0\ud588\ub2e4.",
        "\ucc3d\uace0 \uad00\ub9ac\uc778\uc740 \ubd89\uc740 \uc5f4\uc1e0\ub97c \uc8fc\uba38\ub2c8\uc5d0\uc11c \uaebc\ub0c8\uc9c0\ub9cc \uc624\ub798\ub41c \ucd9c\uc785 \uc7a5\ubd80\uc5d0 \ub0a8\uc740 \ub0af\uc120 \uc774\ub984\uc744 \ud655\uc778\ud558\uae30 \uc804\uc5d0\ub294 \ubb38\uc744 \uc5f4\uc9c0 \uc54a\uc558\ub2e4.",
        "\uba40\ub9ac \uc2dc\uc7a5\uc5d0\uc11c\ub294 \uc0c1\uc778\ub4e4\uc774 \uc811\uc5b4 \ub454 \ucc9c\ub9c9\uc744 \ud3b4\uae30 \uc2dc\uc791\ud588\uace0 \uc0dd\uc120 \uc0c1\uc790\ub97c \uc62e\uae30\ub294 \uc218\ub808\uc758 \ubc14\ud034\uac00 \ub3cc\ubc14\ub2e5 \uc704\uc5d0\uc11c \ub290\ub9ac\uac8c \uc6b8\ub838\ub2e4.",
        "\uc11c\uc724\uc740 \ud3b8\uc9c0\uc758 \ub9c8\uc9c0\ub9c9 \uc904\uc744 \uc18c\ub9ac \ub0b4\uc5b4 \uc77d\ub294 \ub300\uc2e0 \uc9c0\ub3c4\ub97c \uc811\uc5b4 \uac00\ubc29\uc5d0 \ub123\uace0 \uad00\ub9ac\uc778\uc5d0\uac8c \uc5b4\uc81c \ub3cc\uc544\uc628 \ubc30\uc758 \uc774\ub984\ubd80\ud130 \ubb3c\uc5c8\ub2e4.",
      ], before: "\uadf8\ub54c \uace8\ubaa9\uc758 \uc791\uc740 \ube75\uc9d1\uc5d0\uc11c \uc720\ub9ac\uac00 \uae68\uc9c0\ub294 \uc18c\ub9ac\uac00 \ub0ac\ub2e4.", after: "\ub450 \uc0ac\ub78c\uc740 \ucc3d\uace0\ub97c \ub5a0\ub098 \ub0af\uc120 \uc18c\ub9ac\uac00 \ub4e4\ub9b0 \uace8\ubaa9\uc73c\ub85c \ud5a5\ud588\ub2e4." },
      { locale: "en", sentences: [
        "Lena stepped off the early ferry and studied the folded harbor map while the warehouse doors remained locked.",
        "Owen pointed to the small boat below the pier and explained that someone had retied its wet mooring rope during the night.",
        "The caretaker took a red key from his coat but refused to open the door until they checked an unfamiliar name in the entry book.",
        "Beyond the fence, the morning caf\u00e9 raised its shutters as two traders slowly pushed a rattling cart toward the fish market.",
        "Lena put the letter back in her bag and asked the caretaker which boat had returned before the first bell sounded.",
      ], before: "A bicycle bell rang from the narrow street behind them.", after: "They left the pier to find out why the cyclist was calling." },
      { locale: "zh-Hant", sentences: [
        "\u6797\u96e8\u8d70\u4e0b\u6e05\u6668\u7684\u6e21\u8f2a\uff0c\u628a\u6fd5\u900f\u7684\u6e2f\u53e3\u5730\u5716\u6524\u5728\u884c\u674e\u7bb1\u4e0a\uff0c\u4ed4\u7d30\u6bd4\u5c0d\u5009\u5eab\u9580\u908a\u7684\u865f\u78bc\u8207\u4fe1\u5c01\u80cc\u9762\u7684\u925b\u7b46\u8a18\u865f\u3002",
        "\u9673\u5b89\u6307\u8457\u78bc\u982d\u4e0b\u65b9\u7e6b\u4f4f\u7684\u5c0f\u8239\uff0c\u4f4e\u8072\u8aaa\u6628\u591c\u6709\u4eba\u91cd\u65b0\u6253\u904e\u7e9c\u7e69\u7684\u7d50\uff0c\u9023\u5cb8\u908a\u7559\u4e0b\u7684\u6ce5\u5370\u4e5f\u88ab\u96e8\u6c34\u6c96\u6de1\u4e86\u3002",
        "\u7ba1\u7406\u54e1\u5f9e\u5916\u5957\u53e3\u888b\u53d6\u51fa\u7d05\u8272\u9470\u5319\uff0c\u537b\u5805\u6301\u5148\u6838\u5c0d\u51fa\u5165\u7c3f\u4e0a\u7684\u964c\u751f\u59d3\u540d\uff0c\u624d\u80af\u8b93\u5169\u4eba\u67e5\u770b\u5009\u5eab\u88e1\u7684\u6728\u7bb1\u3002",
        "\u570d\u6b04\u53e6\u4e00\u5074\u7684\u5e02\u5834\u9010\u6f38\u71b1\u9b27\u8d77\u4f86\uff0c\u6524\u8ca9\u62c9\u958b\u6536\u597d\u7684\u906e\u96e8\u5e03\uff0c\u642c\u904b\u9b5a\u7bb1\u7684\u624b\u63a8\u8eca\u6cbf\u8457\u77f3\u677f\u8def\u7de9\u6162\u524d\u9032\u3002",
        "\u6797\u96e8\u6c92\u6709\u5ff5\u51fa\u4fe1\u88e1\u6700\u5f8c\u4e00\u53e5\u8a71\uff0c\u800c\u662f\u6536\u597d\u5730\u5716\u8207\u4fe1\u5c01\uff0c\u8f49\u8eab\u8a62\u554f\u7ba1\u7406\u54e1\u6628\u5929\u6700\u5f8c\u4e00\u73ed\u8239\u8f09\u56de\u4e86\u54ea\u4e9b\u8ca8\u7269\u3002",
        "\u7ba1\u7406\u54e1\u7ffb\u5230\u4e0b\u4e00\u9801\uff0c\u6307\u8457\u78bc\u982d\u5de5\u4eba\u7684\u7c3d\u540d\u8aaa\u660e\u8ca8\u7269\u5df2\u5728\u5929\u4eae\u524d\u5165\u5eab\uff0c\u537b\u6c92\u6709\u4eba\u7559\u4e0b\u6536\u4ef6\u5730\u5740\u3002",
      ], before: "\u9019\u6642\u8857\u89d2\u50b3\u4f86\u8173\u8e0f\u8eca\u9234\u8072\uff0c\u4e00\u540d\u90f5\u5dee\u671d\u4ed6\u5011\u62db\u624b\u3002", after: "\u5169\u4eba\u96e2\u958b\u78bc\u982d\uff0c\u6cbf\u8457\u5c0f\u5df7\u8d70\u5411\u7b49\u5019\u7684\u90f5\u5dee\u3002" },
    ];
    type Sample = typeof samples[number];
    const normalized = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
    const units = (text: string) => Array.from(normalized(text)).length;
    // Single Chinese line breaks belong to one paragraph; no spaces or punctuation are removed.
    const sourceParagraph = (sample: Sample) =>
      sample.sentences.join(sample.locale === 'zh-Hant' ? '\n' : ' \t ').normalize('NFD');
    const fragments = (sample: Sample) => sample.sentences.map((sentence, index) =>
      (index === 0 ? sample.before + ' ' : '') + sentence +
      (index === sample.sentences.length - 1 ? ' ' + sample.after : ''));
    const approvedSource = (sample: Sample): StoryContinuationApprovedContext => ({
      ...context, sourceScene: { title: 'Synthetic approved source',
        beats: [{ beatType: 'paragraph', content: sourceParagraph(sample) }] },
    });
    const localizedResult = (locale: string, texts: string[]): StoryContinuationProviderResult => ({
      ...result(''), title: { [locale]: 'Synthetic continuation' },
      beats: texts.map(text => ({ beatType: 'paragraph' as const, content: { [locale]: text } })),
      nextChoices: ['a', 'b', 'c'].map(choiceKey => ({
        choiceKey, label: { [locale]: 'Synthetic next choice ' + choiceKey },
      })),
    });
    function assertFixture(sample: Sample) {
      expect(units(sourceParagraph(sample))).toBeGreaterThanOrEqual(240);
      expect(normalized(sample.sentences.join('\n\n'))).toBe(normalized(sourceParagraph(sample)));
      for (const sentence of sample.sentences) expect(sentence).toMatch(/[.\u3002]$/u);
      for (const fragment of fragments(sample)) expect(units(fragment)).toBeLessThan(240);
    }

    it.each(samples)('M1 rejects a full approved paragraph split across complete-sentence beats ($locale)', sample => {
      assertFixture(sample);
      expect(() => assertStoryContinuationQuality(
        localizedResult(sample.locale, fragments(sample)), approvedSource(sample), sample.locale,
      )).toThrow('continuation_source_prose_repeated');
    });

    it.each(samples)('M1 rejects a full approved paragraph split across blank paragraphs ($locale)', sample => {
      assertFixture(sample);
      const approved = { ...context, memories: [{ memoryType: 'style', content: sourceParagraph(sample) }] };
      expect(() => assertStoryContinuationQuality(
        localizedResult(sample.locale, [fragments(sample).join('\n\n')]), approved, sample.locale,
      )).toThrow('continuation_source_prose_repeated');
    });

    const newProse = [
      'The greenhouse caretaker turned off the leaking pump and spread the repair diagrams across a dry bench.',
      'While a neighbor fetched a replacement valve, a child carefully moved the seedlings away from the puddle.',
      'By the time the rain stopped, they had tested the new fitting and carried the empty buckets back to the tool shed.',
    ].join(' ');

    it('M1 allows genuinely new prose beyond the long-paragraph threshold', () => {
      expect(units(newProse)).toBeGreaterThanOrEqual(240);
      expect(() => assertStoryContinuationQuality(
        localizedResult('en', [newProse]), approvedSource(samples[1]), 'en',
      )).not.toThrow();
    });

    it('M1 allows a short complete-sentence quotation from a long approved source', () => {
      const sample = samples[0];
      const quotation = sample.before + ' "' + sample.sentences[0] + '" ' + sample.after;
      expect(units(quotation)).toBeLessThan(240);
      expect(units(sourceParagraph(sample))).toBeGreaterThanOrEqual(240);
      expect(() => assertStoryContinuationQuality(
        localizedResult(sample.locale, [quotation]), approvedSource(sample), sample.locale,
      )).not.toThrow();
    });

    it('M1 excludes non-style memories and profile constraints from the prose source pool', () => {
      const prose = sourceParagraph(samples[1]);
      const approved: StoryContinuationApprovedContext = {
        ...context,
        memories: [{ memoryType: 'event', content: prose }, { memoryType: 'author_plan_foreshadow', content: prose }],
        generationProfile: { schemaVersion: 'creator-generation-profile-v1', sections: [
          { key: 'scene_scale', value: { referenceScope: 'production_constraint', description: prose } },
        ] },
      };
      expect(units(prose)).toBeGreaterThanOrEqual(240);
      expect(() => assertStoryContinuationQuality(localizedResult('en', [prose]), approved, 'en')).not.toThrow();
    });

    it('M1 excludes copied prose stored only under an unrequested output locale', () => {
      const sample = samples[2];
      const candidate = localizedResult(sample.locale, [sample.before + ' ' + sample.after]);
      candidate.beats[0].content.en = sourceParagraph(sample);
      expect(() => assertStoryContinuationQuality(candidate, approvedSource(sample), sample.locale)).not.toThrow();
    });

    it('M1 excludes titles and choice labels from both prose source and output pools', () => {
      const sample = samples[1];
      const approved = approvedSource(sample);
      approved.sourceScene.title = newProse;
      approved.selectedChoice = { label: newProse };
      const candidate = localizedResult('en', [newProse]);
      candidate.title.en = sourceParagraph(sample);
      for (const choice of candidate.nextChoices ?? []) choice.label.en = sourceParagraph(sample);
      expect(() => assertStoryContinuationQuality(candidate, approved, 'en')).not.toThrow();
    });

    it('M1 retains inserted spaces in originally unspaced Traditional Chinese', () => {
      const sample = samples[2];
      const unspaced = sample.sentences.join('').normalize('NFD');
      expect(units(unspaced)).toBeGreaterThanOrEqual(240);
      expect(normalized(sample.sentences.join('\n\n'))).not.toBe(normalized(unspaced));
      const approved = { ...context, sourceScene: { ...context.sourceScene,
        beats: [{ beatType: 'paragraph', content: unspaced }] } };
      expect(() => assertStoryContinuationQuality(
        localizedResult(sample.locale, [fragments(sample).join('\n\n')]), approved, sample.locale,
      )).not.toThrow();
    });
  });
});
