import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { TextDecoder } from 'util';
import {
  PreparedManuscript,
  preparePastedManuscript,
} from './story-manuscript-file.policy';

export type FixedRouteStoryKey = 'monster' | 'rebellion';

export type FixedRouteVisualBible = {
  era: string;
  artStyle: string;
  palette: string;
  characters: Array<{ name: string; appearance: string }>;
  prohibited: string[];
};

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
  visualBible?: FixedRouteVisualBible;
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
    visualBible: {
      era: 'Present-day coastal Korea and the isolated fictional island Haemyeongdo. Preserve Korean faces, fishing-port infrastructure, concrete seawalls, lighthouses, analog cassette equipment, rain gear, and contemporary Korean interiors.',
      artStyle: 'Match the published cover identity: premium cinematic Korean mystery-fantasy realism, semi-realistic adult faces, natural anatomy and skin texture, detailed wet environments, restrained acting, and film-like 16:9 framing. Keep the same realistic medium and character identity in every scene.',
      palette: 'Storm blue, wet charcoal, sea gray, cold white lighthouse light, and small warm amber harbor lights. The red cassette is a restrained recurring accent. Faces and actions must remain readable without flattening the scene into black.',
      characters: [
        { name: '윤해원', appearance: '28-year-old Korean woman with an oval face, dark brown eyes, long straight black hair, realistic adult proportions, and a practical dark rain jacket; the red cassette is her recurring prop.' },
        { name: '누리', appearance: 'Lean young adult Korean-presenting man with pale skin, a narrow face, dark eyes, tousled short black hair, realistic adult proportions, and simple dark clothing.' },
        { name: '윤해주', appearance: 'Korean woman seven years older than Yun Hae-won, left-handed, with a mature resemblance to Hae-won. She disappeared at age nineteen; preserve the same face, age impression, and understated island clothing whenever she appears.' },
        { name: '백문옥', appearance: 'Older Korean island innkeeper with a weathered but composed face, practical layered work clothes, and the grounded bearing of someone accustomed to a fishing village.' },
        { name: '정세라', appearance: 'Adult Korean woman and sound-archive colleague with neatly tied dark hair, a gray archive T-shirt or practical field clothes, blue jeans, and pale cotton handling gloves when working with recordings.' },
      ],
      prohibited: ['anime, webtoon, chibi, glossy 3D render, fashion-poster posing, non-Korean facial redesigns, generic beauty-filter faces, plastic or waxy skin'],
    },
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
    visualBible: {
      era: 'An original imperial political-fantasy world combining East Asian tiled administrative buildings and archival culture with restrained European stone, brick, glass, steam rail, and mechanical document technology. Never introduce modern objects.',
      artStyle: 'Match the published cover identity: premium cinematic dark-fantasy realism, semi-realistic adult East Asian faces, natural anatomy, intricate embroidered historical-fantasy costumes, detailed monumental environments, restrained expressions, and film-like 16:9 framing. Keep one rendering medium throughout the work.',
      palette: 'Ink black, deep forest green, cold silver, aged paper ivory, red sealing wax, and restrained ember crimson. Snow, rain, and archival interiors may alter lighting but not the master costume and skin colors.',
      characters: [
        { name: '연서린', appearance: 'Adult East Asian woman with a pale oval face, dark brown eyes, long black hair loosely braided and pinned, and a deep forest-green archival coat with fine bronze embroidery; a faint red half-moon script mark sits at the left collarbone when visible.' },
        { name: '레반 아르켈', appearance: 'Tall adult East Asian man with an angular pale face, dark eyes, swept black hair, and a black imperial high-collar coat with silver embroidery and a black fur mantle; a faint vertical red script mark lies over the sternum when visible.' },
        { name: '도하', appearance: 'Adult East Asian woman with practical dark hair tucked into a scarf, alert calculating eyes, plain layered street clothes, and a bread bag or copied petitions when the scene calls for them.' },
        { name: '미레아 아르켈', appearance: 'Adult East Asian imperial princess serving as a field medic, with composed features, sleeves rolled for work, historically grounded medical clothing, and needle-and-thread equipment rather than ceremonial posing.' },
        { name: '소운', appearance: 'Seventeen-year-old East Asian boy who looks younger, with a slight build, a worn wet cap, plain provincial clothes, and cautious posture; do not age him into an adult.' },
        { name: '오르단 베르크', appearance: 'Older East Asian chancellor with a severe angular face, controlled posture, a heavy gray fur mantle, and restrained high-ranking imperial dress.' },
      ],
      prohibited: ['anime, webtoon, chibi, glossy 3D render, modern fashion, generic medieval-European redesigns, character face or costume changes between scenes, generic beauty-filter faces, plastic or waxy skin'],
    },
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
      routeKind: 'writer_original' | 'generation_required';
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
      choices: fixedRouteSuggestedChoices(config.storyKey, heading.title, index + 1, next ? partKey(next) : null),
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

export function fixedRouteSuggestedChoices(
  storyKey: FixedRouteStoryKey,
  partTitle: string,
  partPosition: number,
  nextPartKey: string | null,
) {
  const final = nextPartKey === null;
  const alternatives = storyKey === 'monster'
    ? monsterAlternativeChoices(partTitle, partPosition, final)
    : rebellionAlternativeChoices(partTitle, partPosition, final);
  return [
    {
      choiceKey: final ? 'finish' : 'next',
      label: final ? '작가가 정한 결말을 선택한다' : '원작의 흐름대로 다음 장으로 간다',
      position: 1,
      routeKind: 'writer_original' as const,
      targetPartKey: nextPartKey,
      targetEndingKey: final ? 'author_main' as const : null,
    },
    ...alternatives.map((label, index) => ({
      choiceKey: index === 0 ? 'branch-b' : 'branch-c',
      label,
      position: index + 2,
      routeKind: 'generation_required' as const,
      targetPartKey: null,
      targetEndingKey: null,
    })),
  ];
}

function monsterAlternativeChoices(partTitle: string, partPosition: number, final: boolean) {
  if (final) return [
    '지워진 이름을 되찾기 위해 마지막 대가를 감수한다',
    '이름 대신 곁의 사람을 선택하고 새로운 결말로 향한다',
  ];
  const choices = [
    [`‘${partTitle}’에서 드러난 단서를 의심하고 숨겨진 기록을 추적한다`, '단서보다 곁의 사람을 먼저 지키며 다른 길을 택한다'],
    ['사라진 이름의 흔적을 따라 금지된 장소로 들어간다', '추적을 멈추고 사건의 피해자를 안전한 곳으로 옮긴다'],
    ['누리의 설명을 거부하고 해원만의 방식으로 확인한다', '누리와 정보를 나누고 함께 새로운 계획을 세운다'],
    ['관계자에게 진실을 공개하고 정면으로 답을 요구한다', '진실을 숨긴 채 상대의 다음 행동을 기다린다'],
    ['붉은 카세트의 목소리를 다시 재생해 위험을 감수한다', '카세트를 봉인하고 현재의 관계를 지키는 선택을 한다'],
    ['섬의 규칙을 깨고 지워진 사람의 기억을 되살린다', '섬을 떠나 바깥에서 기억을 되찾을 방법을 찾는다'],
  ];
  return choices[(partPosition - 1) % choices.length];
}

function rebellionAlternativeChoices(partTitle: string, partPosition: number, final: boolean) {
  if (final) return [
    '건국 헌장을 공개하고 왕권과 정면으로 맞서는 결말을 택한다',
    '기록을 봉인하고 서로를 지키는 새로운 질서를 만든다',
  ];
  const choices = [
    [`‘${partTitle}’의 기록을 공개하고 권력에 정면으로 맞선다`, '증거를 숨긴 채 반대 세력과 먼저 협상한다'],
    ['결문의 지시를 거부하고 직접 진실을 검증한다', '결문을 이용해 상대의 의도를 시험한다'],
    ['레반과 공식적으로 공조해 황실 기록을 연다', '레반을 배제하고 서린의 사람들만으로 움직인다'],
    ['청원인의 증언을 즉시 공개한다', '증언을 보호하기 위해 거짓 정보를 흘린다'],
    ['왕실 규칙을 깨고 지방 세력과 손을 잡는다', '수도에 남아 권력 내부를 갈라놓는다'],
    ['반역의 증거를 모두에게 배포한다', '결정적 증거 하나만 남기고 나머지를 없앤다'],
  ];
  return choices[(partPosition - 1) % choices.length];
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
