import { createHash } from 'crypto';
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

Synthetic body marker ${number}.
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
  });

  it('keeps B/C generation-required without converging them to A', () => {
    const plan = prepare(Buffer.from(source()));
    expect(plan.parts[0].choices).toEqual([
      expect.objectContaining({ choiceKey: 'A', routeKind: 'writer_original', targetPartKey: 'part-02' }),
      expect.objectContaining({ choiceKey: 'B', routeKind: 'generation_required', targetPartKey: null, targetEndingKey: null }),
      expect.objectContaining({ choiceKey: 'C', routeKind: 'generation_required', targetPartKey: null, targetEndingKey: null }),
    ]);
    expect(plan.parts[1].choices[0]).toEqual(expect.objectContaining({ targetPartKey: null, targetEndingKey: 'writer-primary' }));
  });

  it.each([
    ['missing B', source().replace('B. Generated B 1\n', ''), 'IMJIN_CHOICE_SET_INVALID'],
    ['missing background', source().replace('[배경: synthetic]\n', ''), 'IMJIN_BACKGROUND_DIRECTIVE_MISSING'],
    ['wrong next part', source().replace('PART 02', 'PART 03'), 'IMJIN_NEXT_PART_METADATA_INVALID'],
    ['missing ending', source().replace('완결 엔딩', 'continued'), 'IMJIN_ENDING_METADATA_INVALID'],
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
});
