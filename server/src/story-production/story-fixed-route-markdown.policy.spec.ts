import { createHash } from 'crypto';
import {
  FIXED_ROUTE_STORIES,
  FixedRouteStoryConfig,
  prepareFixedRoutePublicationSource,
} from './story-fixed-route-markdown.policy';

const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');

function fixture() {
  const manuscript = Buffer.from(`# 검증 작품

- 본편: 2파트
- 외전: 1편

# Part 01. 첫 문

[장면 1]

첫 장면 본문.

[장면 2]

두 번째 장면 본문.

# Part 02. 돌아오는 길

[장면 1]

다음 파트 본문.

# 외전

# 외전 01. 그 뒤의 이름

[장면 1]

외전 본문.
`, 'utf8');
  const prompts = Buffer.from(`# 검증 작품 장면 이미지 프롬프트

# Part 01. 첫 문

1. 첫 번째 장면 프롬프트.
2. 두 번째 장면 프롬프트.

# Part 02. 돌아오는 길

1. 세 번째 장면 프롬프트.

# 외전 01. 그 뒤의 이름

1. 외전 장면 프롬프트.
`, 'utf8');
  const config: FixedRouteStoryConfig = {
    storyKey: 'monster',
    slug: 'fixture-story',
    title: '검증 작품',
    summary: '검증용',
    genre: '검증',
    coverPath: '/fixture.webp',
    manuscriptSha256: hash(manuscript),
    promptSha256: hash(prompts),
    mainPartCount: 2,
    extraPartCount: 1,
  };
  return { manuscript, prompts, config };
}

describe('approved fixed-route Markdown publication source', () => {
  it('pins cover-matched visual identity for both public fixed-route stories', () => {
    for (const story of Object.values(FIXED_ROUTE_STORIES)) {
      expect(story.visualBible?.artStyle).toContain('published cover identity');
      expect(story.visualBible?.characters.length).toBeGreaterThanOrEqual(2);
      expect(story.visualBible?.palette).toBeTruthy();
    }
  });

  it('preserves the complete manuscript and materializes ordered scenes with linear navigation', () => {
    const f = fixture();
    const result = prepareFixedRoutePublicationSource(f.config, f.manuscript, f.prompts);

    expect(result.manuscript.source.rawText).toBe(f.manuscript.toString('utf8'));
    expect(result.parts.map((part) => part.partKey)).toEqual(['part-01', 'part-02', 'extra-01']);
    expect(result.parts[0].beats.map((beat) => beat.text)).toEqual([
      '첫 장면 본문.',
      '두 번째 장면 본문.',
    ]);
    expect(result.parts[0].choices[0]).toMatchObject({
      label: '다음 장으로',
      routeKind: 'writer_original',
      targetPartKey: 'part-02',
      targetEndingKey: null,
    });
    expect(result.parts.at(-1)?.choices[0]).toMatchObject({
      label: '이 이야기를 마친다',
      targetPartKey: null,
      targetEndingKey: 'author_main',
    });
    expect(result.prompts).toHaveLength(4);
    expect(result.prompts[1]).toMatchObject({
      sourceSceneKey: 'part-01-scene-02',
      promptText: '두 번째 장면 프롬프트.',
    });
  });

  it('distributes selected visual prompts across all manuscript scenes', () => {
    const f = fixture();
    const changed = Buffer.from(f.prompts.toString('utf8').replace('2. 두 번째 장면 프롬프트.\n', ''), 'utf8');
    const config = { ...f.config, promptSha256: hash(changed) };
    const result = prepareFixedRoutePublicationSource(config, f.manuscript, changed);

    expect(result.prompts).toHaveLength(3);
    expect(result.prompts[0]).toMatchObject({
      sourceSceneKey: 'part-01-scene-01',
      promptText: '첫 번째 장면 프롬프트.',
    });
  });

  it('rejects a package when a part has more prompts than manuscript scenes', () => {
    const f = fixture();
    const changed = Buffer.from(f.prompts.toString('utf8').replace(
      '2. 두 번째 장면 프롬프트.\n',
      '2. 두 번째 장면 프롬프트.\n3. 허용되지 않는 추가 프롬프트.\n',
    ), 'utf8');
    const config = { ...f.config, promptSha256: hash(changed) };
    expect(() => prepareFixedRoutePublicationSource(config, f.manuscript, changed))
      .toThrow('part-01 has more visual prompts than manuscript scenes');
  });

  it('rejects changed approved source bytes before parsing', () => {
    const f = fixture();
    const changed = Buffer.concat([f.manuscript, Buffer.from('changed')]);
    expect(() => prepareFixedRoutePublicationSource(f.config, changed, f.prompts))
      .toThrow('does not match the approved final source');
  });
});
