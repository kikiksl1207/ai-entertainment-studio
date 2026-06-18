import {
  STORY_AUTHOR_SETTLEMENT_PENALTY_REASONS,
  STORY_AUTHOR_SETTLEMENT_RATE_PENALTY_READ_MODEL,
} from './story-settlement-contract';

describe('STORY_AUTHOR_SETTLEMENT_RATE_PENALTY_READ_MODEL', () => {
  it('defines a read-only story author settlement penalty projection', () => {
    const contract = STORY_AUTHOR_SETTLEMENT_RATE_PENALTY_READ_MODEL;

    expect(contract).toMatchObject({
      version: '2026-06-19.story-author-settlement-rate-penalty.v1',
      feature: 'story_author_settlement_rate_penalty_read_model',
      status: 'read_model_contract_only',
      enabled: false,
      mutationEnabled: false,
      settlementMutationEnabled: false,
      payoutMutationEnabled: false,
      walletMutationEnabled: false,
      paymentMutationEnabled: false,
      sourceOfTruth: {
        completedChapterLedger: 'future_story_completed_chapter_ledger',
        serializationState: 'future_story_pack_serialization_state',
        operatorDecisionAudit: 'future_story_author_policy_decisions',
        existingSettlementRowsMutated: false,
      },
    });
    expect(STORY_AUTHOR_SETTLEMENT_PENALTY_REASONS).toEqual([
      'none',
      'long_hiatus',
      'serialization_stopped',
      'operator_review',
    ]);
  });

  it('separates completed chapter rates from future and incomplete penalties', () => {
    const contract = STORY_AUTHOR_SETTLEMENT_RATE_PENALTY_READ_MODEL;

    expect(contract.baseRatePolicy).toMatchObject({
      defaultAuthorShareBps: 5000,
      penaltyAuthorShareBps: 4500,
      clientSubmittedRateTrusted: false,
      operatorMustUseStableReasonKey: true,
    });
    expect(contract.completedChapterProtection).toMatchObject({
      alreadyCompletedChapterRateLocked: true,
      completedBeforePenaltyUsesOriginalRate: true,
      retroactivePenaltyOnCompletedChapters: false,
      settledOrPayoutRowsRewritten: false,
    });
    expect(contract.futureAndIncompletePolicy).toMatchObject({
      appliesOnlyToFutureOrIncompleteChapters: true,
      incompleteChapterStatusKeys: ['draft', 'scheduled', 'publishing', 'paused'],
      newCompletionAfterPenaltyUsesPenaltyRate: true,
      penaltyLiftRequiresNewOperatorDecision: true,
    });
    expect(contract.projection).toMatchObject({
      baseAuthorShareBps: 5000,
      currentAuthorShareBps: '<5000|4500>',
      completedChapterRateLocked: true,
      futureChapterPenaltyApplies: '<boolean>',
    });
  });

  it('does not mutate settlement, payout, wallet, payment, or chapter access', () => {
    const contract = STORY_AUTHOR_SETTLEMENT_RATE_PENALTY_READ_MODEL;

    expect(
      Object.values(contract.forbiddenSideEffects).every(
        (enabled) => enabled === false,
      ),
    ).toBe(true);
    expect(contract.adminReadModel).toMatchObject({
      endpoint: 'GET /admin/api/v1/story-settlement/author-rate-penalties',
      enabled: false,
      requiredPermission: 'settlement:read',
      mutation: false,
    });
    expect(contract.privacy).toMatchObject({
      bankAccountReturned: false,
      taxIdReturned: false,
      rawContractReturned: false,
      settlementLedgerIdsReturned: false,
      payoutIdsReturned: false,
      tokenReturned: false,
      cookieReturned: false,
    });
  });
});
