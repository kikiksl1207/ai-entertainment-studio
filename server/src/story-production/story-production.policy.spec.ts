import {
  analyzeStructuredManuscript,
  assertPublicProjectionHasNoFixtureMarkers,
  boundedPath,
  deriveContinuityLedger,
  hasActiveEntitlement,
  isPublicStorySourceSafe,
  manuscriptContentHash,
  projectLocalizedValue,
  projectStoryGraphValidationSummary,
} from './story-production.policy';

describe('story production policy', () => {
  it('uses the work locale before a stable five-locale fallback', () => {
    expect(projectLocalizedValue({ en: 'Title', ja: '題名' }, 'zh-Hant', 'ja')).toEqual({
      value: '題名',
      locale: 'ja',
      fallback: true,
    });
  });

  it('blocks fixture identities and fixture asset URLs from public reads', () => {
    expect(isPublicStorySourceSafe({ slug: 'fixture-story', fixtureSource: false })).toBe(false);
    expect(
      isPublicStorySourceSafe({
        slug: 'published-story',
        manifest: { url: '/fixtures/story/cover.webp' },
      }),
    ).toBe(false);
    expect(
      assertPublicProjectionHasNoFixtureMarkers({
        items: [{ id: 'story-1', cover: '/public/story/cover.webp' }],
      }),
    ).toEqual([]);
  });

  it('bounds long reader paths without losing the newest choice', () => {
    const path = Array.from({ length: 150 }, (_, index) => index);
    expect(boundedPath(path)).toHaveLength(24);
    expect(boundedPath(path).at(-1)).toBe(149);
  });

  it('projects release graph validation codes without internal identifiers', () => {
    const result = projectStoryGraphValidationSummary({
      ready: false,
      blockingIssueCount: 3,
      graph: {
        violationCodes: [
          'graph_cycle:private-scene-id',
          'ending_unreachable:private-ending-id',
          'private_validator_detail:do-not-return',
          'graph_cycle:another-private-scene-id',
        ],
      },
    });

    expect(result).toEqual({
      status: 'needs_attention',
      blockingIssueCount: 3,
      warnings: [
        {
          code: 'graph_cycle',
          severity: 'error',
          messageKey: 'story.graph.warning.cycle',
        },
        {
          code: 'ending_unreachable',
          severity: 'error',
          messageKey: 'story.graph.warning.endingUnreachable',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('private-scene-id');
  });

  it('hashes structured manuscript content deterministically', () => {
    expect(manuscriptContentHash({ b: 2, a: 1 })).toBe(
      manuscriptContentHash({ a: 1, b: 2 }),
    );
  });

  it('extracts evidence and creates a critical issue until a payoff exists', () => {
    const analysis = analyzeStructuredManuscript([
      {
        partKey: 'part-1',
        title: 'Part 1',
        paragraphs: [
          { kind: 'scene_break', text: 'Opening' },
          { kind: 'paragraph', text: '[foreshadow:broken watch] The watch stopped.' },
          {
            kind: 'dialogue',
            text: '[entity:Mina] [cast:Mina] [background:station] [time:midnight] [place:Seoul] [branch:leave] We should leave.',
          },
        ],
      },
    ]);
    const evidence = analysis.evidence.map((item, index) => ({ ...item, id: `e-${index}` }));
    expect(analysis.counts.scene).toBe(1);
    expect(analysis.counts.background).toBe(1);
    expect(analysis.counts.cast).toBe(1);
    expect(analysis.counts.time).toBe(1);
    expect(analysis.counts.place).toBe(1);
    expect(analysis.counts.branch_candidate).toBe(1);
    expect(deriveContinuityLedger(evidence).issues).toEqual([
      expect.objectContaining({ issueKey: 'missing-payoff:broken-watch', severity: 'critical' }),
    ]);

    const withPayoff = [
      ...evidence,
      {
        id: 'e-payoff',
        evidenceType: 'payoff' as const,
        sourcePartKey: 'part-2',
        sourceParagraphIndex: 1,
        payload: { label: 'broken watch' },
      },
    ];
    expect(deriveContinuityLedger(withPayoff).issues).toEqual([]);
  });

  it('accepts only currently active, unrevoked entitlements', () => {
    const now = new Date('2026-07-12T00:00:00.000Z');
    expect(
      hasActiveEntitlement(
        [{ startsAt: new Date('2026-07-01'), expiresAt: null, revokedAt: null }],
        now,
      ),
    ).toBe(true);
    expect(
      hasActiveEntitlement(
        [{ startsAt: new Date('2026-07-01'), expiresAt: null, revokedAt: now }],
        now,
      ),
    ).toBe(false);
  });
});
