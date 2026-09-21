import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { TextDecoder } from 'util';

export const IMJIN_RELEASE_SOURCE = {
  byteLength: 2_734_895,
  sha256: '34e2f00f1c375ca5a5af6733f74287224f3d63213a0981e4bc3655b6ed7db125',
  partCount: 75,
  directiveCounts: {
    scene: 95,
    background: 196,
    character: 173,
    background_image: 14,
    flashback: 4,
  },
} as const;

const DIRECTIVE_LABELS = {
  '장면': 'scene',
  '배경': 'background',
  '등장': 'character',
  '배경 이미지 지시': 'background_image',
  '회상': 'flashback',
} as const;
type ImjinDirectiveType = typeof DIRECTIVE_LABELS[keyof typeof DIRECTIVE_LABELS];
type ImjinDirectiveCounts = Record<ImjinDirectiveType, number>;

const REQUIRED_SECTIONS = [
  '파트 제목',
  '본문 원고',
  '배경 이미지 지시',
  '선택지 3개',
  '각 선택지 결과 메모',
  'AI 연결부 생성용 요약',
  '다음 파트 연결 정보',
] as const;
const MAX_PUBLIC_BEAT_UNITS = 7_500;

export type ImjinSourceExpectation = {
  byteLength: number;
  sha256: string;
  partCount: number;
  directiveCounts?: ImjinDirectiveCounts;
};

export type ImjinReleasePlan = {
  source: ImjinSourceExpectation;
  parts: Array<{
    partKey: string;
    title: string;
    sceneKey: string;
    beats: string[];
    choices: Array<{
      choiceKey: 'A' | 'B' | 'C';
      label: string;
      routeKind: 'writer_original' | 'generation_required';
      targetPartKey: string | null;
      targetEndingKey: 'author_main' | 'author_sub' | null;
    }>;
    privateDirectives: Array<{
      type: ImjinDirectiveType;
      ordinal: number | null;
      value: string | null;
      sourceLine: number;
    }>;
    sceneDirectiveCount: number;
    backgroundDirectiveCount: number;
  }>;
};

export type ImjinDryRunReport = {
  mode: 'dry_run';
  valid: true;
  source: { byteLength: number; sha256: string; utf8: true };
  structure: {
    partCount: number;
    choiceCount: number;
    sceneDirectiveCount: number;
    backgroundDirectiveCount: number;
    productionDirectiveCount: number;
    directiveCounts: ImjinDirectiveCounts;
    endingMetadataCount: number;
  };
  releasePolicy: {
    priceLumina: 0;
    recommendedChoiceLimit: 3;
    customChoiceEnabled: false;
    writerOriginalChoice: 'A';
    generationRequiredChoices: readonly ['B', 'C'];
  };
  rawManuscriptIncluded: false;
  privateSourcePathIncluded: false;
  applyExecuted: false;
};

function invalid(code: string): never {
  throw new BadRequestException({ code, message: 'Imjin release source did not pass bounded validation' });
}

function sectionsFor(partText: string) {
  const sections = new Map<string, string>();
  const headings = [...partText.matchAll(/^##\s+([^\r\n]+)\s*$/gm)];
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    const name = heading[1].trim();
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? partText.length;
    if (sections.has(name)) invalid('IMJIN_DUPLICATE_SECTION');
    sections.set(name, partText.slice(start, end).trim());
  }
  return sections;
}

function emptyDirectiveCounts(): ImjinDirectiveCounts {
  return { scene: 0, background: 0, character: 0, background_image: 0, flashback: 0 };
}

function productionDirective(line: string, sourceLine: number) {
  const valued = line.match(/^\s*\[\s*(배경 이미지 지시|배경|등장|장면|회상)(?:\s+(\d+))?\s*:\s*([^\]\r\n]+)\]\s*$/);
  if (valued) return {
    type: DIRECTIVE_LABELS[valued[1] as keyof typeof DIRECTIVE_LABELS],
    ordinal: valued[2] ? Number(valued[2]) : null,
    value: valued[3].trim(),
    sourceLine,
  };
  const marker = line.match(/^\s*\[\s*(장면)\s+(\d+)\s*\]\s*$/);
  if (marker) return {
    type: DIRECTIVE_LABELS[marker[1] as keyof typeof DIRECTIVE_LABELS],
    ordinal: Number(marker[2]),
    value: null,
    sourceLine,
  };
  // Unknown colon directives and numbered stage markers are ambiguous private
  // production syntax. Fail closed instead of publishing or deleting them.
  if (/^\s*\[[^\]\r\n]{1,80}:[^\]\r\n]*\]\s*$/.test(line) ||
      /^\s*\[[가-힣A-Za-z][가-힣A-Za-z ]{0,30}\s+\d+\s*\]\s*$/.test(line)) {
    invalid('IMJIN_UNKNOWN_PRODUCTION_DIRECTIVE');
  }
  return null;
}

function publicBody(body: string) {
  const directives: ImjinReleasePlan['parts'][number]['privateDirectives'] = [];
  const publicLines = body.split(/\r?\n/).filter((line, index) => {
    const directive = productionDirective(line, index + 1);
    if (!directive) return true;
    directives.push(directive);
    return false;
  });
  const paragraphs = publicLines.join('\n')
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const beats: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (paragraph.includes('\0') || paragraph.length > MAX_PUBLIC_BEAT_UNITS) {
      invalid('IMJIN_PUBLIC_BEAT_LIMIT');
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > MAX_PUBLIC_BEAT_UNITS) {
      beats.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) beats.push(current);
  if (!beats.length || beats.length > 40) invalid('IMJIN_PUBLIC_BEAT_COUNT');
  return { beats, directives };
}

export function prepareImjinReleasePlan(
  buffer: Buffer,
  expected: ImjinSourceExpectation = IMJIN_RELEASE_SOURCE,
): ImjinReleasePlan {
  if (!Buffer.isBuffer(buffer) || !buffer.length) invalid('IMJIN_SOURCE_REQUIRED');
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  if (buffer.length !== expected.byteLength || sha256 !== expected.sha256.toLowerCase()) {
    invalid('IMJIN_SOURCE_IDENTITY_MISMATCH');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    invalid('IMJIN_SOURCE_INVALID_UTF8');
  }
  if (text.includes('\0') || text.includes('\ufffd')) invalid('IMJIN_SOURCE_INVALID_UNICODE');

  const headings = [...text.matchAll(/^#\s+PART\s+(\d+)\b[^\r\n]*$/gim)];
  if (headings.length !== expected.partCount) invalid('IMJIN_PART_COUNT_MISMATCH');
  const parts = headings.map((heading, index) => {
    const number = Number(heading[1]);
    if (number !== index + 1) invalid('IMJIN_PART_SEQUENCE_INVALID');
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? text.length;
    const partText = text.slice(start, end);
    const sections = sectionsFor(partText);
    for (const required of REQUIRED_SECTIONS) {
      if (!sections.get(required)?.trim()) invalid('IMJIN_REQUIRED_SECTION_MISSING');
    }
    const titleLines = sections.get('파트 제목')!.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (titleLines.length !== 1 || titleLines[0].length > 240) invalid('IMJIN_PART_TITLE_INVALID');
    const body = sections.get('본문 원고')!;
    const parsedBody = publicBody(body);
    const directiveCounts = parsedBody.directives.reduce((counts, directive) => {
      counts[directive.type]++;
      return counts;
    }, emptyDirectiveCounts());
    const sceneDirectiveCount = directiveCounts.scene;
    const backgroundDirectiveCount = directiveCounts.background + directiveCounts.background_image;
    if (!backgroundDirectiveCount) invalid('IMJIN_BACKGROUND_DIRECTIVE_MISSING');

    const choiceLines = sections.get('선택지 3개')!
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([ABC])\.\s+(.+?)\s*$/))
      .filter((match): match is RegExpMatchArray => Boolean(match));
    if (choiceLines.length !== 3 || choiceLines.map((match) => match[1]).join('') !== 'ABC') {
      invalid('IMJIN_CHOICE_SET_INVALID');
    }
    if (choiceLines.some((match) => !match[2].trim() || match[2].length > 500)) {
      invalid('IMJIN_CHOICE_LABEL_INVALID');
    }
    const nextMetadata = sections.get('다음 파트 연결 정보')!;
    if (index < headings.length - 1) {
      const nextNumber = index + 2;
      if (!new RegExp(`\\bPART\\s+0*${nextNumber}\\b`, 'i').test(nextMetadata)) {
        invalid('IMJIN_NEXT_PART_METADATA_INVALID');
      }
    } else if (/\bPART\s+0*76\b/i.test(nextMetadata) || !/(완결|종결|마지막|ending|end)/i.test(nextMetadata)) {
      invalid('IMJIN_ENDING_METADATA_INVALID');
    }
    return {
      partKey: `part-${String(number).padStart(2, '0')}`,
      title: titleLines[0],
      sceneKey: `part-${String(number).padStart(2, '0')}-main`,
      beats: parsedBody.beats,
      choices: choiceLines.map((match, choiceIndex) => ({
        choiceKey: match[1] as 'A' | 'B' | 'C',
        label: match[2].trim(),
        routeKind: choiceIndex === 0 ? 'writer_original' as const : 'generation_required' as const,
        targetPartKey: choiceIndex === 0 && index < headings.length - 1
          ? `part-${String(number + 1).padStart(2, '0')}`
          : null,
        targetEndingKey: choiceIndex === 0 && index === headings.length - 1 ? 'author_main' as const : null,
      })),
      privateDirectives: parsedBody.directives,
      sceneDirectiveCount,
      backgroundDirectiveCount,
    };
  });
  if (!parts.some((part) => part.sceneDirectiveCount > 0)) invalid('IMJIN_SCENE_DIRECTIVE_MISSING');
  const actualDirectiveCounts = parts.flatMap((part) => part.privateDirectives)
    .reduce((counts, directive) => {
      counts[directive.type]++;
      return counts;
    }, emptyDirectiveCounts());
  if (expected.directiveCounts && Object.entries(expected.directiveCounts)
      .some(([type, count]) => actualDirectiveCounts[type as ImjinDirectiveType] !== count)) {
    invalid('IMJIN_DIRECTIVE_COUNT_MISMATCH');
  }
  return { source: { byteLength: buffer.length, sha256, partCount: parts.length }, parts };
}

export function projectImjinDryRun(plan: ImjinReleasePlan): ImjinDryRunReport {
  return {
    mode: 'dry_run',
    valid: true,
    source: { byteLength: plan.source.byteLength, sha256: plan.source.sha256, utf8: true },
    structure: {
      partCount: plan.parts.length,
      choiceCount: plan.parts.reduce((count, part) => count + part.choices.length, 0),
      sceneDirectiveCount: plan.parts.reduce((count, part) => count + part.sceneDirectiveCount, 0),
      backgroundDirectiveCount: plan.parts.reduce((count, part) => count + part.backgroundDirectiveCount, 0),
      productionDirectiveCount: plan.parts.reduce((count, part) => count + part.privateDirectives.length, 0),
      directiveCounts: plan.parts.flatMap((part) => part.privateDirectives)
        .reduce((counts, directive) => {
          counts[directive.type]++;
          return counts;
        }, emptyDirectiveCounts()),
      endingMetadataCount: plan.parts.at(-1)?.choices.some((choice) => choice.targetEndingKey) ? 1 : 0,
    },
    releasePolicy: {
      priceLumina: 0,
      recommendedChoiceLimit: 3,
      customChoiceEnabled: false,
      writerOriginalChoice: 'A',
      generationRequiredChoices: ['B', 'C'],
    },
    rawManuscriptIncluded: false,
    privateSourcePathIncluded: false,
    applyExecuted: false,
  };
}
