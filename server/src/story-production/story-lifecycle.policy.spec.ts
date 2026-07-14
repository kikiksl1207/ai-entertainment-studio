import {
  canTransitionPublication,
  canTransitionReview,
  publicReleaseEligible,
  qualityDimensionViolations,
  releaseChecksum,
  sessionKeyHash,
  storyPathSignature,
} from './story-lifecycle.policy';

describe('story lifecycle policy', () => {
  it('allows only ordered publication and writer review transitions', () => {
    expect(canTransitionPublication('reviewing', 'release_ready')).toBe(true);
    expect(canTransitionPublication('draft', 'published')).toBe(false);
    expect(canTransitionReview('continuity_review', 'final_confirmation')).toBe(true);
    expect(canTransitionReview('summary_review', 'submitted')).toBe(false);
  });

  it('hashes immutable releases and paths deterministically', () => {
    expect(releaseChecksum({ b: 2, a: 1 })).toBe(releaseChecksum({ a: 1, b: 2 }));
    expect(storyPathSignature([{ choice: 1 }])).toHaveLength(64);
    expect(sessionKeyHash('progress-id')).toHaveLength(64);
  });

  it('requires an active release for public visibility', () => {
    expect(
      publicReleaseEligible({
        workStatus: 'published',
        releaseStatus: 'active',
        activeReleaseId: 'release-id',
      }),
    ).toBe(true);
    expect(
      publicReleaseEligible({
        workStatus: 'reviewing',
        releaseStatus: 'active',
        activeReleaseId: 'release-id',
      }),
    ).toBe(false);
  });

  it('rejects PII, manuscript, private choice, and provider dimensions', () => {
    expect(
      qualityDimensionViolations({
        choiceOutcomeKind: 'branch',
        nested: { privateInput: 'blocked', providerPayload: {} },
      }),
    ).toEqual(['nested.privateInput', 'nested.providerPayload']);
  });
});
