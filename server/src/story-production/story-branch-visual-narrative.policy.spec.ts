import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { verifiedStoredBranchVisualNarrative } from './story-branch-visual-narrative.policy';
import { stableContinuationJson } from './story-continuation-context.policy';
import type { StoryContinuationProviderResult } from './story-continuation.provider';
import { STORY_LOCALES } from './story-production.policy';

type Narrative = Pick<StoryContinuationProviderResult, 'title' | 'beats'>;
type Fixture = {
  locale: string;
  title: Prisma.JsonValue;
  beats: Array<{ position: number; beatType: string; content: Prisma.JsonValue }>;
  expected: Narrative;
};

function fixture(locale = 'ko', title = '  Stored title\r\n', contents = [' First\r\nline ', '\tSecond ', '* * *']): Fixture {
  const types: Narrative['beats'][number]['beatType'][] = ['paragraph', 'dialogue', 'scene_break'];
  return {
    locale,
    title: { [locale]: title },
    beats: contents.map((text, index) => ({
      position: index + 1, beatType: types[index % types.length], content: { [locale]: text },
    })),
    expected: {
      title: { [locale]: title },
      beats: contents.map((text, index) => ({ beatType: types[index % types.length], content: { [locale]: text } })),
    },
  };
}

function verify(source: Fixture) {
  return verifiedStoredBranchVisualNarrative(source.locale, source.title, source.beats, source.expected);
}

function expectChanged(action: () => unknown): ConflictException {
  let error: unknown;
  try { action(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(ConflictException);
  const conflict = error as ConflictException;
  expect(conflict.getStatus()).toBe(409);
  expect(conflict.getResponse()).toEqual({ code: 'STORY_VISUAL_BRANCH_SOURCE_CHANGED' });
  return conflict;
}

describe('verifiedStoredBranchVisualNarrative', () => {
  it.each(STORY_LOCALES)('returns the complete unchanged stored source for %s', locale => {
    const title = ' \uac00\u65e5\u6f22 e\u0301 \ud83d\ude00\r\n';
    const contents = [' \uac00\r\n\ud83d\ude00 ', '\t\u00e9 e\u0301\rEnd ', '* * *\n'];
    const source = fixture(locale, title, contents);
    const before = JSON.stringify(source);
    Object.freeze(source.title);
    for (const beat of source.beats) { Object.freeze(beat.content); Object.freeze(beat); }
    Object.freeze(source.beats);
    Object.freeze(source.expected.title);
    for (const beat of source.expected.beats) { Object.freeze(beat.content); Object.freeze(beat); }
    Object.freeze(source.expected.beats);
    expect(verify(source)).toEqual({ title, prose: contents.join('\n') });
    expect(JSON.stringify(source)).toBe(before);
  });

  it.each(['', 'fr', 'KO', 'zh', 'zh-hans', ' ko ', null, undefined, 1])('rejects an unsupported locale %p', locale => {
    const source = fixture(); source.locale = locale as string;
    expectChanged(() => verify(source));
  });

  it.each([
    ['missing', undefined], ['null', null], ['array', ['text']], ['empty object', {}],
    ['scalar', 'text'], ['number', 1], ['boolean', true],
    ['wrong locale', { en: 'text' }], ['extra locale', { ko: 'text', en: 'text' }],
    ['extra key', { ko: 'text', note: 'private' }], ['nested object', { ko: { text: 'text' } }],
    ['array value', { ko: ['text'] }], ['null value', { ko: null }], ['number value', { ko: 1 }],
    ['empty string', { ko: '' }], ['whitespace', { ko: ' \r\n\t\u3000' }],
    ['NUL', { ko: 'private\0text' }], ['lone high surrogate', { ko: 'text\ud800' }],
    ['lone low surrogate', { ko: '\udc00text' }],
  ] as Array<[string, unknown]>)('rejects %s localized titles and contents on either side', (_label, value) => {
    for (const field of ['title', 'content']) {
      for (const side of ['stored', 'supplied', 'both']) {
        const source = fixture();
        if (field === 'title') {
          if (side !== 'supplied') source.title = value as Prisma.JsonValue;
          if (side !== 'stored') source.expected.title = value as Narrative['title'];
        } else {
          if (side !== 'supplied') source.beats[0].content = value as Prisma.JsonValue;
          if (side !== 'stored') source.expected.beats[0].content = value as Narrative['beats'][number]['content'];
        }
        expectChanged(() => verify(source));
      }
    }
  });

  it.each([null, undefined, [], {}, 'result', true, 1])('rejects malformed supplied results %p', value => {
    const source = fixture(); source.expected = value as Narrative;
    expectChanged(() => verify(source));
  });

  it.each([null, undefined, {}, 'beats', true, 1])('rejects non-array beat collections %p on either side', value => {
    const stored = fixture(); stored.beats = value as Fixture['beats'];
    expectChanged(() => verify(stored));
    const supplied = fixture(); supplied.expected.beats = value as Narrative['beats'];
    expectChanged(() => verify(supplied));
  });

  it.each([0, 41])('rejects %i beats even when the supplied result agrees', count => {
    expectChanged(() => verify(fixture('ko', 'Title', Array.from({ length: count }, () => 'text'))));
  });

  it.each([1, 40])('accepts the %i-beat count boundary without requiring quality or approval', count => {
    const contents = Array.from({ length: count }, () => '*');
    expect(verify(fixture('ko', 'Title', contents))).toEqual({ title: 'Title', prose: contents.join('\n') });
  });

  it.each([null, undefined, [], {}, 'beat', true, 1])('rejects malformed beat rows %p on either side', value => {
    const stored = fixture(); stored.beats[0] = value as Fixture['beats'][number];
    expectChanged(() => verify(stored));
    const supplied = fixture(); supplied.expected.beats[0] = value as Narrative['beats'][number];
    expectChanged(() => verify(supplied));
  });

  it('rejects sparse arrays and arrays disguised as localized objects or beat rows', () => {
    const stored = fixture('ko', 'Title', ['text']); stored.beats = new Array(1);
    expectChanged(() => verify(stored));
    const supplied = fixture('ko', 'Title', ['text']); supplied.expected.beats = new Array(1);
    expectChanged(() => verify(supplied));
    const arrayTitle = fixture(); arrayTitle.title = Object.assign([], { ko: 'Title' });
    expectChanged(() => verify(arrayTitle));
    const arrayBeat = fixture(); arrayBeat.beats[0] = Object.assign([], arrayBeat.beats[0]);
    expectChanged(() => verify(arrayBeat));
  });

  it.each([0, -1, 1.5, NaN, Infinity, '1', null, undefined])('rejects invalid starting position %p', position => {
    const source = fixture(); source.beats[0].position = position as number;
    expectChanged(() => verify(source));
  });

  it.each([[1, 1], [1, 3], [2, 1], [2, 3]])('rejects duplicate, missing or unordered positions %i/%i', (first, second) => {
    const source = fixture('ko', 'Title', ['first', 'second']);
    source.beats[0].position = first; source.beats[1].position = second;
    expectChanged(() => verify(source));
  });

  it.each(['', 'action', 'Paragraph', 'paragraph ', null, undefined, 1, [], {}])('rejects unsupported beat type %p', value => {
    const source = fixture();
    source.beats[0].beatType = value as string;
    source.expected.beats[0].beatType = value as Narrative['beats'][number]['beatType'];
    expectChanged(() => verify(source));
  });

  it.each(['title', 'content', 'beatType', 'order', 'count'])('rejects supplied %s drift', field => {
    const source = fixture();
    if (field === 'title') source.expected.title.ko = 'Different title';
    if (field === 'content') source.expected.beats[0].content.ko += 'Different prose';
    if (field === 'beatType') source.expected.beats[0].beatType = 'dialogue';
    if (field === 'order') source.expected.beats.reverse();
    if (field === 'count') source.expected.beats.pop();
    expectChanged(() => verify(source));
  });

  it('rejects changed beat boundaries even when the joined prose is identical', () => {
    const source = fixture('ko', 'Title', ['a', 'b\nc']);
    source.expected.beats[0].content.ko = 'a\nb';
    source.expected.beats[1].content.ko = 'c';
    expect(source.expected.beats.map(beat => beat.content.ko).join('\n')).toBe('a\nb\nc');
    expectChanged(() => verify(source));
  });

  it('verifies and returns prose beyond the caller-only 6000-character excerpt', () => {
    const text = 'a'.repeat(6_000) + '\ud83d\ude00 PRIVATE_SOURCE_TAIL';
    const source = fixture('ko', 'Title', [text]);
    expect(verify(source).prose).toBe(text);
    source.expected.beats[0].content.ko = text.replace('SOURCE_TAIL', 'CHANGED_TAIL');
    expect(Array.from(source.expected.beats[0].content.ko).slice(0, 6_000).join(''))
      .toBe(Array.from(text).slice(0, 6_000).join(''));
    const error = expectChanged(() => verify(source));
    expect(error.message + JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
  });

  it.each(['title', 'content'])('rejects trimming, newline and Unicode normalization drift in %s', field => {
    for (const [stored, supplied] of [
      [' text ', 'text'], ['a\r\nb', 'a\nb'], ['\u00e9', 'e\u0301'],
      ['\ud83d\ude00', '\ud83d\ude01'],
    ]) {
      const source = fixture('ko', field === 'title' ? stored : 'Title', [stored]);
      if (field === 'title') source.expected.title.ko = supplied;
      else source.expected.beats[0].content.ko = supplied;
      expectChanged(() => verify(source));
    }
  });

  it.each(['title', 'content'])('enforces the exact raw UTF-8 %s byte boundary', field => {
    const limit = field === 'title' ? 500 : 14_000;
    for (const unit of ['a', '\uac00', '\ud83d\ude00']) {
      const width = Buffer.byteLength(unit, 'utf8');
      const text = unit.repeat(Math.floor(limit / width)) + 'a'.repeat(limit % width);
      const source = fixture('ko', field === 'title' ? text : 'Title', [field === 'content' ? text : 'body']);
      expect(Buffer.byteLength(text, 'utf8')).toBe(limit);
      expect(verify(source)[field === 'title' ? 'title' : 'prose']).toBe(text);
      if (field === 'title') {
        source.title = { ko: text + ' ' }; source.expected.title.ko = text + ' ';
      } else {
        source.beats[0].content = { ko: text + ' ' }; source.expected.beats[0].content.ko = text + ' ';
      }
      expectChanged(() => verify(source));
    }
  });

  it('bounds the complete serialized title/beatType/content source at 100000 UTF-8 bytes', () => {
    const source = fixture('ko', 'Title', [...Array<string>(7).fill('a'.repeat(14_000)), 'b']);
    const padding = 100_000 - Buffer.byteLength(stableContinuationJson(source.expected), 'utf8');
    const last = 'b'.repeat(padding + 1);
    source.beats[7].content = { ko: last }; source.expected.beats[7].content.ko = last;
    expect(Buffer.byteLength(last, 'utf8')).toBeLessThanOrEqual(14_000);
    expect(Buffer.byteLength(stableContinuationJson(source.expected), 'utf8')).toBe(100_000);
    expect(verify(source).prose).toBe(source.expected.beats.map(beat => beat.content.ko).join('\n'));
    source.beats[7].content = { ko: last + 'b' }; source.expected.beats[7].content.ko = last + 'b';
    expectChanged(() => verify(source));
  });

  it('counts JSON escaping and title/type/locale overhead in the total source byte limit', () => {
    const source = fixture('zh-Hant', 'Title', Array<string>(8).fill('\\'.repeat(7_000)));
    expect(source.expected.beats.every(beat => Buffer.byteLength(beat.content['zh-Hant'], 'utf8') <= 14_000)).toBe(true);
    expect(Buffer.byteLength(stableContinuationJson(source.expected), 'utf8')).toBeGreaterThan(100_000);
    expectChanged(() => verify(source));
  });
});
