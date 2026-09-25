import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { TextDecoder } from 'util';
import { preparePastedManuscript } from './story-manuscript-file.policy';

export const INHERITOR_STORY = {
  key: 'inheritor',
  slug: 'the-killer-inherits-the-dead',
  title: '살인자는 죽은 자의 능력을 계승한다',
  summary: '죽은 자의 능력을 계승하는 살인자 윤태하가 이상재해의 진실을 추적하는 현대 헌터 판타지·오컬트 스릴러.',
  coverPath: '/assets/story/killer-inherits-cover.webp',
  manuscriptSha256: '3f8243a8e5f973c9aa21aa06b5b7aa94ea9717b1bd53629f71f6805b74d1dfaf',
  promptSha256: 'c948fd717e358eb4dd4a6822df95ba206455d108f2781ecb3f85fc6fc0474326',
  partCount: 265,
} as const;

const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

function sourceText(buffer: Buffer, expectedHash: string) {
  if (sha256(buffer) !== expectedHash) throw new ConflictException('Approved story source checksum mismatch');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); }
  catch { throw new BadRequestException('Approved story source is not UTF-8'); }
}

export function prepareInheritorPublicationSource(manuscriptBuffer: Buffer, promptBuffer: Buffer) {
  const text = sourceText(manuscriptBuffer, INHERITOR_STORY.manuscriptSha256);
  const promptText = sourceText(promptBuffer, INHERITOR_STORY.promptSha256);
  const headings = [...text.matchAll(/^# Part (\d{3})\. ([^\r\n]+)\r?$/gm)];
  const promptHeadings = [...promptText.matchAll(/^## Part (\d{3})\. ([^\r\n]+)\r?$/gm)];
  if (headings.length !== INHERITOR_STORY.partCount || promptHeadings.length !== headings.length) {
    throw new ConflictException('Approved story part or image direction count mismatch');
  }
  const boundaries = headings.map((heading, index) => ({
    partKey: `part-${index + 1}`,
    title: heading[2].trim(),
    start: index === 0 ? 0 : heading.index!,
    end: index + 1 === headings.length ? text.length : headings[index + 1].index!,
  }));
  const manuscript = preparePastedManuscript(manuscriptBuffer, JSON.stringify({
    locale: 'ko', confirmed: true, parts: boundaries,
  }));
  const parts = headings.map((heading, index) => {
    const ordinal = index + 1;
    const promptHeading = promptHeadings[index];
    if (Number(heading[1]) !== ordinal || Number(promptHeading[1]) !== ordinal ||
        heading[2].trim() !== promptHeading[2].trim()) {
      throw new ConflictException('Approved story part and image directions do not align');
    }
    const block = text.slice(heading.index! + heading[0].length, boundaries[index].end);
    const bodyHeading = /^## 본문\r?$/m.exec(block);
    if (!bodyHeading) throw new ConflictException(`Part ${ordinal} has no body`);
    const body = block.slice(bodyHeading.index + bodyHeading[0].length)
      .replace(/\r?\n---\s*$/, '').trim();
    if (!body || /^## 이미지 지시\r?$/m.test(body)) {
      throw new ConflictException(`Part ${ordinal} has an invalid reader body`);
    }
    const sceneCount = [...body.matchAll(/^\[장면 (\d+)\]\r?$/gm)];
    if (sceneCount.length !== 22 || sceneCount.some((scene, sceneIndex) => Number(scene[1]) !== sceneIndex + 1)) {
      throw new ConflictException(`Part ${ordinal} scene order is invalid`);
    }
    const readerText = body.replace(/^\[장면 \d+\]\r?\n?/gm, '').trim();
    const key = `part-${ordinal}`;
    return {
      partKey: key,
      title: heading[2].trim(),
      actNumber: 1,
      position: ordinal,
      beats: [{ text: readerText, sourceSceneKey: `${key}-scene-01` }],
      choices: [{
        choiceKey: ordinal === INHERITOR_STORY.partCount ? 'finish' : 'next',
        label: ordinal === INHERITOR_STORY.partCount ? '작가가 정한 결말을 본다' : '원작의 다음 장으로 간다',
        position: 1,
        routeKind: 'writer_original' as const,
        targetPartKey: ordinal === INHERITOR_STORY.partCount ? null : `part-${ordinal + 1}`,
        targetEndingKey: ordinal === INHERITOR_STORY.partCount ? 'author_main' as const : null,
      }],
    };
  });
  const prompts = promptHeadings.map((heading, index) => {
    const end = index + 1 === promptHeadings.length ? promptText.length : promptHeadings[index + 1].index!;
    const section = promptText.slice(heading.index! + heading[0].length, end);
    const fields = [...section.matchAll(/^- (?!배경:|등장인물:)([^\r\n]+)/gm)]
      .map((match) => match[1].trim());
    if (fields.length !== 3 || fields.some((field) => !field)) {
      throw new ConflictException(`Part ${index + 1} must have three image directions`);
    }
    const value = `현대 한국 오컬트 스릴러. ${fields.join(' ')} 과도한 고어와 문자 삽입은 피한다.`;
    return { sourceSceneKey: `part-${index + 1}-scene-01`, promptText: value, promptSha256: sha256(value) };
  });
  return {
    manuscript,
    sourceBindingSha256: sha256(Buffer.concat([manuscriptBuffer, Buffer.from([0]), promptBuffer])),
    parts,
    prompts,
  };
}
