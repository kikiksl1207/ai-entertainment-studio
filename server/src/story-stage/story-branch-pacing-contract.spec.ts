import {
  buildStoryBranchPacingProjection,
  STORY_BRANCH_TIMELINE_PACING_BACKEND_CONTRACT,
} from './story-branch-pacing-contract';

function buildInput(currentPartNumber: number) {
  return {
    currentPartNumber,
    totalPartCount: 10,
    timelineSummaryKey: 'story.timeline.summary.current',
    storyTimeKey: 'story.time.day-12',
    authorStyleReferenceKey: 'story.style.reference.primary',
    worldRuleKeys: ['story.world.rule-one'],
    requestEnding: true,
  };
}

describe('story branch timeline pacing backend contract', () => {
  it('prevents an ungrounded early ending', () => {
    expect(buildStoryBranchPacingProjection(buildInput(2))).toMatchObject({
      progressBps: 2_000,
      endingDecision: 'continue',
      endingAllowed: false,
    });
  });

  it('allows an explicit early ending only after its minimum window', () => {
    expect(
      buildStoryBranchPacingProjection({
        ...buildInput(4),
        explicitEarlyEndingConditionKey: 'story.ending.condition.sacrifice',
      }),
    ).toMatchObject({
      progressBps: 4_000,
      endingDecision: 'explicit_early_ending_window',
      endingAllowed: true,
    });
  });

  it('opens the author ending window without provider or write mutation', () => {
    expect(buildStoryBranchPacingProjection(buildInput(8))).toMatchObject({
      progressBps: 8_000,
      endingDecision: 'author_ending_window',
      endingAllowed: true,
    });
    expect(
      Object.values(
        STORY_BRANCH_TIMELINE_PACING_BACKEND_CONTRACT.mutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
  });
});
