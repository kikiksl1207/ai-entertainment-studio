import { buildStoryVisualBible, composeStoryVisualPrompt } from './story-visual-bible';

describe('story visual bible', () => {
  it('builds a stable, bounded bible with all required consistency sections', () => {
    const input = {
      workTitle: { ko: '불타는 바다의 기록자' },
      workSummary: { ko: '임진왜란의 바다에서 선택과 결과를 기록하는 역사 서사.' },
      canonicalPrompts: [
        '1592 Joseon naval command deck, restrained navy and fire-amber palette, cinematic historical illustration.',
        'Adjutant Han wears the same indigo official robe, black gat, narrow face, and small scar beside the left eyebrow.',
      ],
      canonicalStoryExcerpts: [
        { ko: '이순신은 검은 수염과 붉은 철릭 차림으로 갑판에 섰다.' },
      ],
    };
    const first = buildStoryVisualBible(input);
    const second = buildStoryVisualBible(input);

    expect(second).toEqual(first);
    expect(first.privatePrompt).toContain('[ERA AND WORLD LOCK]');
    expect(first.privatePrompt).toContain('[ART STYLE LOCK]');
    expect(first.privatePrompt).toContain('[COLOR AND LIGHTING LOCK]');
    expect(first.privatePrompt).toContain('[RECURRING CHARACTER APPEARANCE LOCK]');
    expect(first.privatePrompt).toContain('[PROHIBITED ELEMENTS]');
    expect(first.privatePrompt).toContain('[LAYER-READY COMPOSITION]');
    expect(first.privatePrompt).toContain('one primary focal character and no more than two secondary');
    expect(first.privatePrompt).toContain('floating or disembodied heads');
    expect(first.privatePrompt).toContain('fill the entire image edge to edge');
    expect(first.privatePrompt).toContain('isolated character cutouts');
    expect(first.privatePrompt).toContain('plastic or waxy skin');
    expect(first.privatePrompt).toContain('Adjutant Han wears the same indigo official robe');
    expect(first.privatePrompt).toContain('이순신은 검은 수염과 붉은 철릭');
    expect(Array.from(first.privatePrompt).length).toBeLessThanOrEqual(7_000);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{20}$/);
  });

  it('uses explicit release visual anchors without allowing arbitrary manifest fields', () => {
    const bible = buildStoryVisualBible({
      workTitle: { ko: '북유럽 신화' },
      workSummary: { ko: '운명의 갈림길' },
      localizedDisplaySnapshot: { ko: { title: '북유럽 신화: 로키의 선택', summary: '라그나로크의 갈림길' } },
      sceneAssetManifest: {
        visualBible: {
          era: 'Mythic Norse Nine Realms before Ragnarok.',
          artStyle: 'Painterly Nordic epic with consistent realistic faces.',
          palette: 'Cold iron blue, ash gray, aurora green, and restrained ember gold.',
          characters: [{ name: 'Loki', appearance: 'lean adult, angular face, shoulder-length black hair, green-and-gold layered leather' }],
          prohibited: ['modern streetwear'],
        },
        privatePrompt: 'must not be copied',
      },
      canonicalPrompts: [],
    });

    expect(bible.privatePrompt).toContain('Mythic Norse Nine Realms before Ragnarok.');
    expect(bible.privatePrompt).toContain('Loki: lean adult, angular face');
    expect(bible.privatePrompt).toContain('modern streetwear');
    expect(bible.privatePrompt).not.toContain('must not be copied');
  });

  it('places the immutable work bible before a bounded scene direction', () => {
    const bible = buildStoryVisualBible({
      workTitle: 'Work', workSummary: 'Summary', canonicalPrompts: ['Canonical style direction'],
    });
    const result = composeStoryVisualPrompt(
      bible,
      `Scene direction ${'가'.repeat(7_100)} closing consequence`,
    );

    expect(result.indexOf('[PRIVATE VISUAL BIBLE')).toBeLessThan(result.indexOf('[SCENE-SPECIFIC DIRECTION]'));
    expect(result).toContain('Canonical style direction');
    expect(result).toContain('Do not illustrate them all.');
    expect(result).toContain('one continuous physical location and moment');
    expect(result).toContain('Never a character-sheet layout, poster montage, isolated cutouts');
    expect(result).toContain('[...middle of scene omitted for visual direction...]');
    expect(result).toContain('closing consequence');
    expect(Array.from(result.split('[SCENE-SPECIFIC DIRECTION]')[1]).length).toBeLessThan(3_700);
  });

  it('retains a cover-matched fixed-route bible supplied by the release', () => {
    const bible = buildStoryVisualBible({
      workTitle: { ko: '우리는 서로의 몸에 반역을 썼다' },
      workSummary: { ko: '기록관과 황태자의 정치 미스터리' },
      sceneAssetManifest: {
        visualBible: {
          artStyle: 'Match the published cover identity with cinematic dark-fantasy realism.',
          palette: 'Ink black, deep forest green, cold silver, and red sealing wax.',
          characters: [
            { name: '연서린', appearance: 'adult East Asian woman, long black hair, forest-green archival coat' },
            { name: '레반 아르켈', appearance: 'adult East Asian man, swept black hair, black imperial coat' },
          ],
        },
      },
      canonicalPrompts: ['rainy archive scene'],
    });

    expect(bible.privatePrompt).toContain('published cover identity');
    expect(bible.privatePrompt).toContain('연서린: adult East Asian woman');
    expect(bible.privatePrompt).toContain('레반 아르켈: adult East Asian man');
  });
});
