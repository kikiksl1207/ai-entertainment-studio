import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { INHERITOR_STORY, prepareInheritorPublicationSource } from './story-inheritor-publication.policy';

const sourceDir = process.env.INHERITOR_TEST_SOURCE_DIR;
const manuscriptPath = sourceDir ? join(sourceDir, '01_전체_원고_통합본.md') : '';
const promptPath = sourceDir ? join(sourceDir, '02_배경_이미지_지시_통합본.md') : '';
const sourceTest = manuscriptPath && promptPath && existsSync(manuscriptPath) && existsSync(promptPath)
  ? it : it.skip;

describe('Inheritor approved publication', () => {
  sourceTest('preserves all 265 authored parts with matched image directions', () => {
    const manuscript = readFileSync(manuscriptPath);
    const directions = readFileSync(promptPath);
    const plan = prepareInheritorPublicationSource(manuscript, directions);
    expect(plan.parts).toHaveLength(INHERITOR_STORY.partCount);
    expect(plan.prompts).toHaveLength(INHERITOR_STORY.partCount);
    expect(plan.parts[0]).toMatchObject({ position: 1, title: '스물일곱 번째 남자' });
    expect(plan.parts.at(-1)).toMatchObject({ position: 265, title: '기록은 용서하지 않는다' });
    expect(plan.parts.every((part) => part.beats.length === 1 && part.beats[0].text.length > 8000)).toBe(true);
    expect(plan.parts[0].beats[0].text).not.toContain('## 이미지 지시');
    expect(plan.parts.every((part) => !part.beats[0].text.endsWith('---'))).toBe(true);
    expect(plan.parts[0].choices).toHaveLength(1);
    expect(plan.parts.at(-1)?.choices[0].targetEndingKey).toBe('author_main');
  });

  sourceTest('rejects source bytes changed after approval', () => {
    const manuscript = readFileSync(manuscriptPath);
    const directions = readFileSync(promptPath);
    expect(() => prepareInheritorPublicationSource(
      Buffer.concat([manuscript, Buffer.from('tampered')]), directions,
    )).toThrow();
  });

  sourceTest('matches every authoritative part manuscript, not just the review bundle', () => {
    const plan = prepareInheritorPublicationSource(
      readFileSync(manuscriptPath), readFileSync(promptPath),
    );
    const partDir = join(sourceDir!, '파트별_원고');
    const files = readdirSync(partDir).filter((name) => /^Part_\d{3}_.+\.md$/.test(name)).sort();
    expect(files).toHaveLength(INHERITOR_STORY.partCount);
    files.forEach((file, index) => {
      const source = readFileSync(join(partDir, file), 'utf8');
      const bodyStart = source.indexOf('## 본문');
      const bodyEnd = source.indexOf('## 이미지 지시');
      expect(bodyStart).toBeGreaterThanOrEqual(0);
      expect(bodyEnd).toBeGreaterThan(bodyStart);
      const body = source.slice(bodyStart + '## 본문'.length, bodyEnd)
        .replace(/^\[장면 \d+\]\r?\n?/gm, '').trim();
      expect(plan.parts[index].beats[0].text).toBe(body);
    });
  });
});
