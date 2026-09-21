import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import {
  prepareImjinReleasePlan,
  projectImjinDryRun,
} from './story-imjin-release-bridge.policy';

function source(partCount = 2) {
  return Array.from({ length: partCount }, (_, index) => {
    const number = index + 1;
    const next = number < partCount ? `PART ${String(number + 1).padStart(2, '0')}` : '완결 엔딩';
    return `# PART ${String(number).padStart(2, '0')} - test
## 파트 제목
Synthetic title ${number}
## 본문 원고
[장면: synthetic]
[배경: synthetic]
[등장: synthetic]
[배경 이미지 지시: synthetic]
[회상: synthetic]

Synthetic body marker ${number} with [ordinary brackets].
[ordinary bracketed prose]
## 배경 이미지 지시
private directive placeholder
## 선택지 3개
A. Authored ${number}
B. Generated B ${number}
C. Generated C ${number}
## 각 선택지 결과 메모
synthetic result metadata
## AI 연결부 생성용 요약
synthetic generation metadata
## 다음 파트 연결 정보
${next}`;
  }).join('\n\n');
}

function prepare(value: Buffer, partCount = 2) {
  return prepareImjinReleasePlan(value, {
    byteLength: value.length,
    sha256: createHash('sha256').update(value).digest('hex'),
    partCount,
  });
}

describe('Imjin release dry-run policy', () => {
  it('validates structure without projecting raw text or private directives', () => {
    const raw = Buffer.from(source());
    const plan = prepare(raw);
    const report = projectImjinDryRun(plan);
    const serialized = JSON.stringify(report);

    expect(report).toMatchObject({
      mode: 'dry_run', valid: true, applyExecuted: false,
      structure: { partCount: 2, choiceCount: 6, endingMetadataCount: 1 },
      releasePolicy: { priceLumina: 0, recommendedChoiceLimit: 3, customChoiceEnabled: false },
    });
    expect(serialized).not.toContain('Synthetic body marker');
    expect(serialized).not.toContain('private directive placeholder');
    expect(serialized).not.toContain('synthetic generation metadata');
    expect(plan.parts.flatMap((part) => part.beats).join('\n')).toContain('[ordinary brackets]');
    expect(plan.parts.flatMap((part) => part.beats).join('\n')).toContain('[ordinary bracketed prose]');
    expect(plan.parts.flatMap((part) => part.beats).join('\n')).not.toMatch(/^\s*\[(?:장면|배경|등장|배경 이미지 지시|회상)/m);
    expect(report.structure.directiveCounts).toEqual({
      scene: 2, background: 2, character: 2, background_image: 2, flashback: 2,
    });
  });

  it('keeps B/C generation-required without converging them to A', () => {
    const plan = prepare(Buffer.from(source()));
    expect(plan.parts[0].choices).toEqual([
      expect.objectContaining({ choiceKey: 'A', routeKind: 'writer_original', targetPartKey: 'part-02' }),
      expect.objectContaining({ choiceKey: 'B', routeKind: 'generation_required', targetPartKey: null, targetEndingKey: null }),
      expect.objectContaining({ choiceKey: 'C', routeKind: 'generation_required', targetPartKey: null, targetEndingKey: null }),
    ]);
    expect(plan.parts[1].choices[0]).toEqual(expect.objectContaining({ targetPartKey: null, targetEndingKey: 'author_main' }));
  });

  it.each([
    ['missing B', source().replace('B. Generated B 1\n', ''), 'IMJIN_CHOICE_SET_INVALID'],
    ['missing background', source().replace('[배경: synthetic]\n', '').replace('[배경 이미지 지시: synthetic]\n', ''), 'IMJIN_BACKGROUND_DIRECTIVE_MISSING'],
    ['wrong next part', source().replace('PART 02', 'PART 03'), 'IMJIN_NEXT_PART_METADATA_INVALID'],
    ['missing ending', source().replace('완결 엔딩', 'continued'), 'IMJIN_ENDING_METADATA_INVALID'],
    ['unknown production directive', source().replace('[등장: synthetic]', '[카메라: synthetic]'), 'IMJIN_UNKNOWN_PRODUCTION_DIRECTIVE'],
  ])('rejects %s', (_name, text, code) => {
    expect(() => prepare(Buffer.from(text))).toThrow(expect.objectContaining({ response: expect.objectContaining({ code }) }));
  });

  it('rejects malformed UTF-8 after identity verification', () => {
    const raw = Buffer.from([0xff]);
    expect(() => prepareImjinReleasePlan(raw, {
      byteLength: 1,
      sha256: createHash('sha256').update(raw).digest('hex'),
      partCount: 1,
    })).toThrow(expect.objectContaining({
      response: expect.objectContaining({ code: 'IMJIN_SOURCE_INVALID_UTF8' }),
    }));
  });

  it('rejects an identity mismatch before parsing', () => {
    const raw = Buffer.from(source());
    expect(() => prepareImjinReleasePlan(raw, { byteLength: raw.length, sha256: '0'.repeat(64), partCount: 2 }))
      .toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'IMJIN_SOURCE_IDENTITY_MISMATCH' }) }));
  });

  const actualSourcePath = process.env.IMJIN_ACTUAL_SOURCE_PATH;
  (actualSourcePath ? it : it.skip)('keeps all actual production directives out of public beats', () => {
    const plan = prepareImjinReleasePlan(readFileSync(actualSourcePath!));
    const report = projectImjinDryRun(plan);
    expect(report.structure).toMatchObject({
      productionDirectiveCount: 482,
      directiveCounts: {
        scene: 95, background: 196, character: 173, background_image: 14, flashback: 4,
      },
    });
    expect(plan.parts.flatMap((part) => part.beats).join('\n'))
      .not.toMatch(/^\s*\[(?:장면|배경|등장|배경 이미지 지시|회상)(?:\s+\d+)?\s*(?::|\])/m);
  });

  (actualSourcePath ? it : it.skip)('keeps actual part 75 readable with A as its sole explicit author ending and B/C independent', () => {
    const plan = prepareImjinReleasePlan(readFileSync(actualSourcePath!));
    expect(plan.parts).toHaveLength(75);
    expect(plan.parts[73].choices[0]).toMatchObject({
      choiceKey: 'A', routeKind: 'writer_original', targetPartKey: 'part-75', targetEndingKey: null,
    });
    const last = plan.parts[74];
    expect(last.partKey).toBe('part-75');
    expect(last.beats.length).toBeGreaterThan(0);
    expect(last.choices.map(({ choiceKey, routeKind, targetPartKey, targetEndingKey }) =>
      ({ choiceKey, routeKind, targetPartKey, targetEndingKey }))).toEqual([
      { choiceKey: 'A', routeKind: 'writer_original', targetPartKey: null, targetEndingKey: 'author_main' },
      { choiceKey: 'B', routeKind: 'generation_required', targetPartKey: null, targetEndingKey: null },
      { choiceKey: 'C', routeKind: 'generation_required', targetPartKey: null, targetEndingKey: null },
    ]);
  });
});
