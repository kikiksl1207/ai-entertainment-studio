import {
  calculateInitialStoryPrice,
  calculateStoryUsageCost,
  duplicateFixedChoice,
  estimateHierarchicalMemoryTokens,
  storyAllowanceRemaining,
  storyBudgetDecision,
  validateStoryReleaseCapability,
} from './story-economics.policy';

describe('story economics policy', () => {
  it('calculates versioned usage without charging cached tokens twice', () => {
    expect(
      calculateStoryUsageCost(
        {
          inputCostPerMillion: 1000,
          outputCostPerMillion: 2000,
          cachedInputCostPerMillion: 100,
          imageUnitCost: 20,
        },
        {
          inputTokens: 10_000,
          cachedInputTokens: 4_000,
          outputTokens: 2_000,
          imageUnits: 1,
        },
      ),
    ).toBe(30.4);
  });

  it('keeps purchase entitlement separate from AI allowance and repurchase', () => {
    expect(
      calculateInitialStoryPrice({
        authorRightsCostKrw: 1000,
        expectedReplayCostKrw: 200,
        includedAiRouteCostKrw: 300,
        paymentFeeRate: 0.03,
        vatRate: 0.1,
        storageDeliveryCostKrw: 100,
        operatingMarginRate: 0.2,
      }),
    ).toEqual({
      directCostKrw: 1600,
      recommendedRetailPriceKrw: 2389,
      repurchaseRequired: false,
      aiAllowanceSeparateFromEntitlement: true,
    });
    expect(
      storyAllowanceRemaining({
        includedLimit: 2,
        purchasedLimit: 1,
        reservedCount: 1,
        consumedCount: 2,
        compensatedCount: 1,
      }),
    ).toBe(1);
  });

  it('fails closed for invalid free and paid release capabilities', () => {
    expect(
      validateStoryReleaseCapability({
        freeStory: true,
        fixedChoiceCount: 3,
        customChoiceEnabled: true,
        customChoiceMaxLength: 200,
        fullResetLimit: 1,
        actResetLimit: 3,
        includedAiRouteCount: 0,
        aiInputTokenLimit: 12000,
        aiOutputTokenLimit: 2500,
        warningBudgetKrw: 3000,
        hardBudgetKrw: 4000,
      }),
    ).toContain('free_story_custom_choice_must_be_disabled');
  });

  it('bounds 150-part memory work estimates without resending the manuscript', () => {
    const estimate = estimateHierarchicalMemoryTokens({
      scopeType: 'work',
      partCount: 150,
      currentPartCharacters: 10_000,
      relatedEvidenceCharacters: 20_000,
      outputTokenLimit: 2500,
    });
    expect(estimate).toEqual({
      inputTokens: 52_500,
      outputTokens: 2500,
      fullManuscriptResent: false,
    });
    expect(storyBudgetDecision(4100, 3000, 4000)).toEqual({
      decision: 'blocked',
      reasonCode: 'hard_budget_exceeded',
    });
  });

  it('rejects a custom input that duplicates a fixed choice', () => {
    expect(duplicateFixedChoice(' Take the east gate ', ['Wait', 'Take the east gate'])).toBe(
      true,
    );
  });
});
