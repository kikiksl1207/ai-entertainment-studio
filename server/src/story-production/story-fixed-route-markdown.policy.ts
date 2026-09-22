import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { TextDecoder } from 'util';
import {
  PreparedManuscript,
  preparePastedManuscript,
} from './story-manuscript-file.policy';

export type FixedRouteStoryKey = 'monster' | 'rebellion';

export type FixedRouteStoryConfig = {
  storyKey: FixedRouteStoryKey;
  slug: string;
  title: string;
  summary: string;
  genre: string;
  coverPath: string;
  manuscriptSha256: string;
  promptSha256: string;
  mainPartCount: number;
  extraPartCount: number;
};

export const FIXED_ROUTE_STORIES: Record<FixedRouteStoryKey, FixedRouteStoryConfig> = {
  monster: {
    storyKey: 'monster',
    slug: 'the-monster-that-did-not-eat-my-name',
    title: '내 이름을 먹지 않은 괴물',
    summary: '세상 누구도 기억하지 못하는 언니의 목소리를 따라, 기억과 이름의 선택권을 되찾는 현대 한국 미스터리 판타지 로맨스.',
    genre: '현대 한국 미스터리 판타지 로맨스',
    coverPath: '/assets/story/monster-name-cover.png',
    manuscriptSha256: 'e5c3e0719995380e2544062a83dceb43c4811ff7c9029ca81b15ba4a3c1b4bff',
    promptSha256: 'ba2763caa77bb52bd56a216b1852b2be9241314019015624a65ab128df25e033',
    mainPartCount: 28,
    extraPartCount: 4,
  },
  rebellion: {
    storyKey: 'rebellion',
    slug: 'we-wrote-rebellion-on-each-others-bodies',
    title: '우리는 서로의 몸에 반역을 썼다',
    summary: '몸에 나뉘어 새겨진 건국 헌장을 따라, 기록관과 황태자가 왕권의 거짓말과 서로의 욕망을 함께 심문하는 정치 미스터리 판타지 로맨스.',
    genre: '정치 미스터리 판타지, 관계 중심 로맨스',
    coverPath: '/assets/story/rebellion-bodies-cover.png',
    manuscriptSha256: '9c855d771b9e2d89ef8b36b7a445b0fa62bf854738bb2d78becb12284f16ecff',
    promptSha256: 'fb1ecc405c2471035fdfc85fec17f4e4d883334e2928d898eec988188ec1a5c3',
    mainPartCount: 40,
    extraPartCount: 4,
  },
};

type SourceHeading = {
  kind: 'main' | 'extra';
  ordinal: number;
  title: string;
  headingStart: number;
  bodyStart: number;
  blockEnd: number;
};

export type FixedRoutePublicationSource = {
  manuscript: PreparedManuscript;
  sourceBindingSha256: string;
  parts: Array<{
    partKey: string;
    title: string;
    actNumber: number;
    position: number;
    beats: Array<{ text: string; sourceSceneKey: string }>;
    choices: Array<{
      choiceKey: string;
      label: string;
      position: number;
      routeKind: 'writer_original';
      targetPartKey: string | null;
      targetEndingKey: 'author_main' | null;
    }>;
  }>;
  prompts: Array<{
    sourceSceneKey: string;
    promptText: string;
    promptSha256: string;
  }>;
};

export function fixedRouteStoryKeyFromChecksums(checksums: ReadonlySet<string>) {
  return (Object.values(FIXED_ROUTE_STORIES).find((story) =>
    checksums.has(story.manuscriptSha256) && checksums.has(story.promptSha256))?.storyKey ?? null);
}

export function prepareFixedRoutePublicationSource(
  config: FixedRouteStoryConfig,
  manuscriptBuffer: Buffer,
  promptBuffer: Buffer,
): FixedRoutePublicationSource {
  assertChecksum(manuscriptBuffer, config.manuscriptSha256, 'manuscript');
  assertChecksum(promptBuffer, config.promptSha256, 'visual prompt');
  const manuscriptText = decodeUtf8(manuscriptBuffer, 'manuscript');
  const promptText = decodeUtf8(promptBuffer, 'visual prompt');
  const headings = parseHeadings(manuscriptText, config);
  const promptSections = promptLinesByPart(promptText, config);
  const boundaries = headings.map((heading, index) => ({
    partKey: partKey(heading),
    title: heading.title,
    start: index === 0 ? 0 : heading.headingStart,
    end: index === headings.length - 1 ? manuscriptText.length : headings[index + 1].headingStart,
  }));
  const manuscript = preparePastedManuscript(manuscriptBuffer, JSON.stringify({
    locale: 'ko',
    confirmed: true,
    parts: boundaries,
  }));
  const parts = headings.map((heading, index) => {
    const key = partKey(heading);
    const beats = sceneBodies(manuscriptText.slice(heading.bodyStart, heading.blockEnd)).map((text, sceneIndex) => ({
      text,
      sourceSceneKey: `${key}-scene-${String(sceneIndex + 1).padStart(2, '0')}`,
    }));
    if (!beats.length || beats.length > 40) invalid('STORY_FIXED_ROUTE_SCENE_COUNT_INVALID');
    const prompts = promptSections.get(key) ?? [];
    if (prompts.length > beats.length) {
      throw new ConflictException({
        code: 'STORY_FIXED_ROUTE_PROMPT_COUNT_INVALID',
        message: `${key} has more visual prompts than manuscript scenes`,
      });
    }
    const next = headings[index + 1];
    return {
      partKey: key,
      title: heading.title,
      actNumber: Math.floor(index / 10) + 1,
      position: index + 1,
      beats,
      choices: [{
        choiceKey: index === headings.length - 1 ? 'finish' : 'next',
        label: index === headings.length - 1 ? '이 이야기를 마친다' : '다음 장으로',
        position: 1,
        routeKind: 'writer_original' as const,
        targetPartKey: next ? partKey(next) : null,
        targetEndingKey: next ? null : 'author_main' as const,
      }],
    };
  });
  const prompts = parts.flatMap((part) => {
    const sourcePrompts = promptSections.get(part.partKey) ?? [];
    return distributePrompts(part.beats, sourcePrompts).map(({ beat, value }) => {
      return {
        sourceSceneKey: beat.sourceSceneKey,
        promptText: value,
        promptSha256: sha256(Buffer.from(value, 'utf8')),
      };
    });
  });
  return {
    manuscript,
    sourceBindingSha256: sha256(Buffer.concat([
      manuscriptBuffer,
      Buffer.from([0]),
      promptBuffer,
    ])),
    parts,
    prompts,
  };
}

function distributePrompts<T extends { sourceSceneKey: string }>(beats: T[], prompts: string[]) {
  if (!prompts.length) return [];
  if (prompts.length === 1) return [{ beat: beats[0], value: prompts[0] }];
  return prompts.map((value, index) => ({
    beat: beats[Math.round(index * (beats.length - 1) / (prompts.length - 1))],
    value,
  }));
}

function parseHeadings(text: string, config: FixedRouteStoryConfig) {
  const matches = [...text.matchAll(/^#{1,2}[ \t]+(Part|외전)[ \t]+(\d{2})\.[ \t]+(.+?)[ \t]*$/gm)];
  const expectedCount = config.mainPartCount + config.extraPartCount;
  if (matches.length !== expectedCount) invalid('STORY_FIXED_ROUTE_PART_COUNT_MISMATCH');
  const headings: SourceHeading[] = matches.map((match, index) => {
    const headingStart = match.index ?? -1;
    const kind = match[1] === 'Part' ? 'main' as const : 'extra' as const;
    const ordinal = Number(match[2]);
    return {
      kind,
      ordinal,
      title: match[3].trim(),
      headingStart,
      bodyStart: afterLineBreak(text, headingStart + match[0].length),
      blockEnd: matches[index + 1]?.index ?? text.length,
    };
  });
  headings.forEach((heading, index) => {
    const expectedKind = index < config.mainPartCount ? 'main' : 'extra';
    const expectedOrdinal = expectedKind === 'main' ? index + 1 : index - config.mainPartCount + 1;
    if (heading.kind !== expectedKind || heading.ordinal !== expectedOrdinal || !heading.title) {
      invalid('STORY_FIXED_ROUTE_PART_ORDER_INVALID');
    }
  });
  return headings;
}

function promptLinesByPart(text: string, config: FixedRouteStoryConfig) {
  const headings = parseHeadings(text, config);
  const result = new Map<string, string[]>();
  for (const heading of headings) {
    const body = text.slice(heading.bodyStart, heading.blockEnd);
    const prompts = [...body.matchAll(/^\d+\.[ \t]+(.+?)[ \t]*$/gm)]
      .map((match) => match[1].trim())
      .filter(Boolean);
    if (!prompts.length) invalid('STORY_FIXED_ROUTE_PROMPTS_REQUIRED');
    result.set(partKey(heading), prompts);
  }
  return result;
}

function sceneBodies(text: string) {
  const matches = [...text.matchAll(/^\[장면[ \t]+(\d+)\][ \t]*$/gm)];
  if (!matches.length) return [cleanBody(text)].filter(Boolean);
  return matches.map((match, index) => {
    const start = afterLineBreak(text, (match.index ?? 0) + match[0].length);
    const end = matches[index + 1]?.index ?? text.length;
    return cleanBody(text.slice(start, end));
  }).filter(Boolean);
}

function cleanBody(value: string) {
  return value
    .replace(/^[\r\n]+/, '')
    .replace(/[\r\n]+---[\t ]*(?:[\r\n]+)?$/, '')
    .trim();
}

function partKey(heading: Pick<SourceHeading, 'kind' | 'ordinal'>) {
  const prefix = heading.kind === 'main' ? 'part' : 'extra';
  return `${prefix}-${String(heading.ordinal).padStart(2, '0')}`;
}

function afterLineBreak(value: string, index: number) {
  let cursor = index;
  if (value[cursor] === '\r') cursor += 1;
  if (value[cursor] === '\n') cursor += 1;
  return cursor;
}

function decodeUtf8(buffer: Buffer, label: string) {
  let value: string;
  try {
    value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    throw new BadRequestException({
      code: 'STORY_FIXED_ROUTE_SOURCE_ENCODING_INVALID',
      message: `The approved ${label} must be valid UTF-8`,
    });
  }
  if (!value.trim() || value.includes('\0')) invalid('STORY_FIXED_ROUTE_SOURCE_INVALID');
  return value.startsWith('\ufeff') ? value.slice(1) : value;
}

function assertChecksum(buffer: Buffer, expected: string, label: string) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || sha256(buffer) !== expected) {
    throw new ConflictException({
      code: 'STORY_PUBLICATION_SOURCE_IDENTITY_MISMATCH',
      message: `The selected ${label} does not match the approved final source`,
    });
  }
}

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function invalid(code: string): never {
  throw new BadRequestException({ code, message: 'Invalid approved fixed-route story package' });
}
