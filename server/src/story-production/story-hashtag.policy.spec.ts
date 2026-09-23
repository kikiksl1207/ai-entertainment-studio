import {
  buildStorySearchText,
  labelsForStoryHashtags,
  normalizeStoryHashtagKey,
  projectStoryHashtags,
} from './story-hashtag.policy';

describe('story hashtag policy', () => {
  it('projects a stable key with a localized display label', () => {
    const labels = labelsForStoryHashtags(['romance', 'exclusive-contract']);

    expect(projectStoryHashtags(['romance', 'exclusive-contract'], labels, 'ja', 'ko')).toEqual([
      expect.objectContaining({ key: 'romance', label: 'ロマンス', locale: 'ja', fallback: false }),
      expect.objectContaining({ key: 'exclusive-contract', label: '独占契約', locale: 'ja', fallback: false }),
    ]);
  });

  it('builds searchable text from every localized hashtag label', () => {
    const labels = labelsForStoryHashtags(['romance', 'mystery']);
    const searchText = buildStorySearchText('작품 제목', '작품 소개', labels);

    expect(searchText).toContain('로맨스');
    expect(searchText).toContain('romance');
    expect(searchText).toContain('ミステリー');
  });

  it('accepts canonical keys and rejects display labels as query keys', () => {
    expect(normalizeStoryHashtagKey(' Romance ')).toBe('romance');
    expect(normalizeStoryHashtagKey('#로맨스')).toBe('');
  });
});
