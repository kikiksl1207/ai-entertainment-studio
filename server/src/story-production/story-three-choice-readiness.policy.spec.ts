import { hasPreparedOriginalAndAlternatives } from './story-three-choice-readiness.policy';

describe('published three-choice readiness', () => {
  const valid = [
    { position: 1, label: { ko: '원작대로 간다' }, routeKind: 'writer_original',
      targetSceneId: 'next-scene', targetEndingKey: null },
    { position: 2, label: { ko: '비밀을 밝힌다' }, routeKind: 'generation_required',
      targetSceneId: null, targetEndingKey: null },
    { position: 3, label: { ko: '증인을 구한다' }, routeKind: 'generation_required',
      targetSceneId: null, targetEndingKey: null },
  ];

  it('accepts one authored route and two distinct generated routes', () => {
    expect(hasPreparedOriginalAndAlternatives(valid)).toBe(true);
  });

  it('rejects three rows with a missing original or an immediate generated target', () => {
    expect(hasPreparedOriginalAndAlternatives(valid.map((choice) => ({
      ...choice, routeKind: 'generation_required',
    })))).toBe(false);
    expect(hasPreparedOriginalAndAlternatives(valid.map((choice, index) => ({
      ...choice, targetSceneId: index === 1 ? 'forced-rejoin' : choice.targetSceneId,
    })))).toBe(false);
  });

  it('rejects duplicate labels and missing ending or next scene', () => {
    expect(hasPreparedOriginalAndAlternatives(valid.map((choice, index) => ({
      ...choice, label: index === 2 ? { ko: '비밀을 밝힌다' } : choice.label,
    })))).toBe(false);
    expect(hasPreparedOriginalAndAlternatives(valid.map((choice, index) => ({
      ...choice, targetSceneId: index === 0 ? null : choice.targetSceneId,
    })))).toBe(false);
  });
});
