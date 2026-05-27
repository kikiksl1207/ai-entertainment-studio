import {
  AI_PREMIUM_CONTENT_GENERATION_CONTRACT,
  buildAiPremiumContentProviderDisabledResponse,
  buildAiPremiumContentUsagePlaceholder,
} from './ai-premium-content-generation.contract';

describe('AI premium content generation contract', () => {
  it('keeps creator/admin request skeleton fail-closed while providers are disabled', () => {
    expect(AI_PREMIUM_CONTENT_GENERATION_CONTRACT).toMatchObject({
      status: 'provider_disabled_skeleton',
      bridge: {
        currentQueue: 'creator_image_requests',
        creatorImageRequestsPreserved: true,
      },
      providerRouter: {
        defaultStatus: 'provider_disabled',
        failClosed: true,
        liveProviderCallsEnabled: false,
        gptImageEnabled: false,
        stableDiffusionEnabled: false,
        seedanceEnabled: false,
        responseCode: 'AI_PREMIUM_CONTENT_PROVIDER_DISABLED',
        messageKey: 'aiPremiumContent.providerDisabled',
      },
      apiContracts: {
        creatorCreate: {
          method: 'POST',
          enabled: false,
        },
        creatorList: {
          method: 'GET',
          enabled: false,
        },
        creatorDetail: {
          method: 'GET',
          enabled: false,
        },
        adminReview: {
          method: 'POST',
          enabled: false,
          walletMutation: false,
          settlementMutation: false,
          payoutMutation: false,
        },
      },
    });
  });

  it('returns provider-disabled readiness without vendor credentials or mutations', () => {
    const response = buildAiPremiumContentProviderDisabledResponse({
      requestType: 'video_generation',
      capability: 'video_generation',
      modelAlias: 'seedance-future-route',
    });

    expect(response).toMatchObject({
      ok: false,
      status: 'provider_disabled',
      code: 'AI_PREMIUM_CONTENT_PROVIDER_DISABLED',
      messageKey: 'aiPremiumContent.providerDisabled',
      requestAccepted: false,
      providerConfigured: false,
      routingReadiness: 'provider_disabled',
      requestType: 'video_generation',
      capability: 'video_generation',
      modelAlias: 'seedance-future-route',
      policy: {
        failClosed: true,
        liveProviderCallsEnabled: false,
        walletMutation: false,
        orderMutation: false,
        settlementMutation: false,
        payoutMutation: false,
        vendorCredentialReturned: false,
        rawProviderPayloadReturned: false,
      },
    });
  });

  it('defines cost usage placeholders without raw provider payloads or payment state', () => {
    const usage = buildAiPremiumContentUsagePlaceholder({
      requestId: 'request-1',
      providerFamily: 'openai',
      modelAlias: 'gpt-image-future',
      capability: 'image_generation',
      attempt: '2',
      regenerationCount: '1',
      estimatedCostMicros: '1200',
      actualCostMicros: '0',
      inputUnits: '8',
      outputUnits: '1',
      failureCode: 'provider_disabled',
      vendorPayload: { secret: 'SHOULD_NOT_LEAK' },
      credential: 'SHOULD_NOT_LEAK',
    });

    expect(usage).toMatchObject({
      schemaVersion: '2026-05-28.ai-premium-content-cost-usage.v1',
      requestId: 'request-1',
      providerFamily: 'openai',
      modelAlias: 'gpt-image-future',
      capability: 'image_generation',
      attempt: 2,
      regenerationCount: 1,
      estimatedCostMicros: 1200,
      actualCostMicros: 0,
      inputUnits: 8,
      outputUnits: 1,
      failureCode: 'provider_disabled',
      placeholderOnly: true,
      rawProviderPayloadStored: false,
      vendorCredentialStored: false,
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
    });
    expect(JSON.stringify(usage)).not.toContain('SHOULD_NOT_LEAK');
  });
});
