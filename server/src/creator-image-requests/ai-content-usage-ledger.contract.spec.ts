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
    expect(AI_CONTENT_USAGE_LEDGER_GUARD.fields).toEqual(
      expect.arrayContaining([
        'providerFamily',
        'modelAlias',
        'capability',
        'attempt',
        'regenerationCount',
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
      providerFamily: 'openai',
      modelAlias: 'gpt-image-future',
      capability: 'image_generation',
      attempt: '2',
      regenerationCount: '1',
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
      providerFamily: 'openai',
      modelAlias: 'gpt-image-future',
      capability: 'image_generation',
      attempt: 2,
      regenerationCount: 1,
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
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
    });
  });
});
