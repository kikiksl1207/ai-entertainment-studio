import {
  AI_CONTENT_USAGE_LEDGER_GUARD,
  buildAiContentUsageLedgerRow,
  summarizeAiContentUsage,
} from './ai-content-usage-ledger.contract';

describe('AI content usage ledger guard', () => {
  it('keeps the usage ledger skeleton provider-neutral and mutation-free', () => {
    expect(AI_CONTENT_USAGE_LEDGER_GUARD).toMatchObject({
      status: 'skeleton_guard_only',
      providerCallsEnabled: false,
      liveUsageLedgerMutationEnabled: false,
      sensitiveDataPolicy: {
        vendorCredentialStored: false,
        rawProviderPayloadStored: false,
        rawPromptStored: false,
        rawAssetBytesStored: false,
      },
      mutationPolicy: {
        walletMutation: false,
        orderMutation: false,
        settlementMutation: false,
        payoutMutation: false,
        revenueShareMutation: false,
      },
      idempotency: {
        futureKeyPattern: 'ai-content-usage:<requestId>:<attempt>',
      },
    });
    expect(AI_CONTENT_USAGE_LEDGER_GUARD.pipelineLogPolicy).toMatchObject({
      source: 'ai_middleware_pipeline',
      providerCallEnabled: false,
      providerRouteAliasOnly: true,
      vendorProviderKeyStored: false,
      vendorModelKeyStored: false,
      modelRouteAliasPrefix: 'ai_premium_content.',
      requiredBeforeProviderAttempt: [
        'requestType',
        'modelRouteAlias',
        'estimatedCostMicros',
        'safetyStatus',
        'reuseState',
      ],
      safetyBlockedBehavior: 'log_skeleton_only_without_provider_attempt',
      reusedResultBehavior:
        'record cache or derived result without a billable provider attempt or duplicate cost row',
    });
    expect(AI_CONTENT_USAGE_LEDGER_GUARD.fields).toEqual(
      expect.arrayContaining([
        'requestType',
        'providerFamily',
        'modelAlias',
        'modelRouteAlias',
        'capability',
        'safetyStatus',
        'attempt',
        'regenerationCount',
        'reuseState',
        'reuseSourceRequestId',
        'providerAttemptBillable',
        'estimatedCostMicros',
        'actualCostMicros',
        'inputUnits',
        'outputUnits',
        'failureCode',
      ]),
    );
  });

  it('builds sanitized usage rows without raw provider or payment state', () => {
    const row = buildAiContentUsageLedgerRow({
      requestId: 'request-1',
      requestType: 'image_single',
      providerFamily: 'openai',
      modelAlias: 'gpt-image-future',
      modelRouteAlias: 'ai_premium_content.image.text_to_image',
      capability: 'image_generation',
      safetyStatus: 'cleared',
      attempt: '2',
      regenerationCount: '1',
      reuseState: 'derived_from_previous',
      reuseSourceRequestId: 'source-request-1',
      estimatedCostMicros: '1200',
      actualCostMicros: '900',
      inputUnits: '8',
      outputUnits: '1',
      failureCode: 'provider_timeout',
      vendorPayload: { token: 'SHOULD_NOT_LEAK' },
      vendorCredential: 'SHOULD_NOT_LEAK',
      rawPrompt: 'SHOULD_NOT_LEAK',
      rawAssetBytes: 'SHOULD_NOT_LEAK',
    });

    expect(row).toMatchObject({
      schemaVersion: '2026-06-02.ai-content-usage-ledger-guard.v1',
      requestId: 'request-1',
      requestType: 'image_single',
      providerFamily: 'openai',
      modelAlias: 'gpt-image-future',
      modelRouteAlias: 'ai_premium_content.image.text_to_image',
      capability: 'image_generation',
      safetyStatus: 'cleared',
      attempt: 2,
      regenerationCount: 1,
      reuseState: 'derived_from_previous',
      reuseSourceRequestId: 'source-request-1',
      providerAttemptBillable: false,
      estimatedCostMicros: 1200,
      actualCostMicros: 900,
      inputUnits: 8,
      outputUnits: 1,
      failureCode: 'provider_timeout',
      rawProviderPayloadStored: false,
      vendorCredentialStored: false,
      rawPromptStored: false,
      rawAssetBytesStored: false,
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
    });
    expect(JSON.stringify(row)).not.toContain('SHOULD_NOT_LEAK');
  });

  it('normalizes middleware request routing and safety fields before logging', () => {
    const blockedVideoRow = buildAiContentUsageLedgerRow({
      requestId: 'request-2',
      requestType: 'video_clip',
      modelRouteAlias: 'ai_premium_content.video.text_to_video',
      safetyStatus: 'blocked',
      reuseState: 'cache_hit',
      estimatedCostMicros: 5000,
    });
    const invalidRouteRow = buildAiContentUsageLedgerRow({
      requestId: 'request-3',
      requestType: 'unexpected_request_type',
      modelRouteAlias: 'vendor.private.route',
      safetyStatus: 'unsafe_raw_status',
      reuseState: 'unsafe_raw_reuse_state',
    });

    expect(blockedVideoRow).toMatchObject({
      requestType: 'video_clip',
      modelRouteAlias: 'ai_premium_content.video.text_to_video',
      safetyStatus: 'blocked',
      reuseState: 'cache_hit',
      estimatedCostMicros: 5000,
      providerAttemptBillable: false,
      walletMutation: false,
      orderMutation: false,
    });
    expect(invalidRouteRow).toMatchObject({
      requestType: 'unknown',
      modelRouteAlias: null,
      safetyStatus: 'unknown',
      reuseState: 'unknown',
    });
  });

  it('summarizes cost usage and failure rate without opening wallet or settlement mutations', () => {
    const rows = [
      buildAiContentUsageLedgerRow({
        requestId: 'request-1',
        estimatedCostMicros: 1000,
        actualCostMicros: 700,
        inputUnits: 5,
        outputUnits: 1,
      }),
      buildAiContentUsageLedgerRow({
        requestId: 'request-1',
        attempt: 2,
        regenerationCount: 1,
        reuseState: 'cache_hit',
        reuseSourceRequestId: 'request-1',
        estimatedCostMicros: 1200,
        actualCostMicros: 0,
        inputUnits: 5,
        outputUnits: 0,
        failureCode: 'provider_timeout',
      }),
    ];

    expect(summarizeAiContentUsage(rows)).toMatchObject({
      totalAttempts: 2,
      failedAttempts: 1,
      failureRate: 0.5,
      totalEstimatedCostMicros: 2200,
      totalActualCostMicros: 700,
      totalInputUnits: 10,
      totalOutputUnits: 1,
      maxRegenerationCount: 1,
      reusedAttemptCount: 1,
      billableProviderAttemptCount: 1,
      avoidedEstimatedCostMicros: 1200,
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
    });
  });

  it('keeps reused or derived AI results out of duplicate provider billing totals', () => {
    const rows = [
      buildAiContentUsageLedgerRow({
        requestId: 'image-request-1',
        requestType: 'image_single',
        modelRouteAlias: 'ai_premium_content.image.text_to_image',
        safetyStatus: 'cleared',
        estimatedCostMicros: 3000,
      }),
      buildAiContentUsageLedgerRow({
        requestId: 'image-request-2',
        requestType: 'image_variation',
        modelRouteAlias: 'ai_premium_content.image.text_to_image',
        safetyStatus: 'cleared',
        reuseState: 'derived_from_previous',
        reuseSourceRequestId: 'image-request-1',
        estimatedCostMicros: 3000,
      }),
      buildAiContentUsageLedgerRow({
        requestId: 'video-request-1',
        requestType: 'video_clip',
        modelRouteAlias: 'ai_premium_content.video.text_to_video',
        safetyStatus: 'cleared',
        reuseState: 'cache_hit',
        reuseSourceRequestId: 'image-request-1',
        estimatedCostMicros: 5000,
      }),
    ];

    expect(rows.map((row) => row.providerAttemptBillable)).toEqual([
      true,
      false,
      false,
    ]);
    expect(summarizeAiContentUsage(rows)).toMatchObject({
      totalAttempts: 3,
      reusedAttemptCount: 2,
      billableProviderAttemptCount: 1,
      totalEstimatedCostMicros: 11000,
      avoidedEstimatedCostMicros: 8000,
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
    });
  });
});
