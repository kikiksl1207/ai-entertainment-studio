export const CHARACTER_CHAT_MONETIZATION_POLICY = {
  policyVersion: '2026-05-13.character-chat-monetization-v1',
  currency: {
    code: 'LUMINA',
    displayNameKo: '루미나',
    unitPriceKrw: 10,
    userBalancePresentation: 'single_balance',
    userBalanceCopyKo: '보유 루미나',
    doNotSplitPaidAndFreeInUserUi: true,
  },
  products: {
    fanLetters: [
      {
        sku: 'CHAT_FANLETTER_30',
        labelKo: '스페셜 팬레터 30',
        priceLumina: 30,
        settlementSource: 'fan_letter',
        orderFlow: 'async_reviewed_fan_letter',
        status: 'contract_candidate',
      },
      {
        sku: 'CHAT_FANLETTER_50',
        labelKo: '스페셜 팬레터 50',
        priceLumina: 50,
        settlementSource: 'fan_letter',
        orderFlow: 'async_reviewed_fan_letter',
        status: 'contract_candidate',
      },
      {
        sku: 'CHAT_FANLETTER_100',
        labelKo: '스페셜 팬레터 100',
        priceLumina: 100,
        settlementSource: 'fan_letter',
        orderFlow: 'async_reviewed_fan_letter',
        status: 'contract_candidate',
      },
    ],
    characterChatReplies: [
      {
        sku: 'CHAT_DEEP_REPLY',
        labelKo: '딥리플',
        priceLumina: 2,
        settlementSource: 'chat',
        orderFlow: 'paid_generation',
        status: 'contract_candidate',
      },
      {
        sku: 'CHAT_STORY_REPLY',
        labelKo: '스토리 리플',
        priceLumina: 5,
        settlementSource: 'chat',
        orderFlow: 'paid_generation',
        status: 'contract_candidate',
      },
      {
        sku: 'CHAT_PREMIUM_REPLY',
        labelKo: '프리미엄 스토리',
        priceLumina: 10,
        settlementSource: 'chat',
        orderFlow: 'paid_generation',
        status: 'contract_candidate',
      },
    ],
    creatorImageRequests: [
      {
        sku: 'CREATOR_IMAGE_BASIC_30',
        labelKo: '기본 이미지 요청',
        priceLumina: 30,
        settlementSource: 'creator_image_request',
        status: 'contract_candidate',
      },
      {
        sku: 'CREATOR_IMAGE_PREMIUM_100',
        labelKo: '고급 이미지 요청',
        priceLumina: 100,
        settlementSource: 'creator_image_request',
        status: 'contract_candidate',
      },
    ],
    shortVideoRequests: [
      {
        sku: 'CREATOR_SHORT_VIDEO_RESERVED',
        labelKo: '짧은 영상 요청',
        priceLumina: 300,
        settlementSource: 'creator_video_request',
        status: 'hidden_after_mvp',
        visibleInMvp: false,
      },
    ],
  },
  ledgerContract: {
    userFacingRule:
      '무료/유료/프로모션 루미나는 사용자 화면에서 분리하지 않고 하나의 보유 루미나로 표시합니다.',
    internalSourceTrackingRequired: true,
    creditSources: [
      {
        source: 'purchase',
        labelKo: '유료 충전',
        settlementEligibleWhenSpent: true,
      },
      {
        source: 'promotion_reward',
        labelKo: '프로모션 지급',
        settlementEligibleWhenSpent: false,
      },
      {
        source: 'ad_reward',
        labelKo: '무료 광고 충전',
        settlementEligibleWhenSpent: false,
      },
      {
        source: 'admin_adjustment',
        labelKo: '운영 조정',
        settlementEligibleWhenSpent: 'operator_decision_required',
      },
    ],
    debitLedgerTypes: [
      {
        ledgerType: 'fan_letter_spend',
        referenceType: 'fan_letter',
        settlementSource: 'fan_letter',
      },
      {
        ledgerType: 'chat_feature_spend',
        referenceType: 'chat_feature_product',
        settlementSource: 'chat',
      },
      {
        ledgerType: 'creator_image_request_spend',
        referenceType: 'creator_image_request',
        settlementSource: 'creator_image_request',
      },
    ],
    recoveryLedgerTypes: [
      {
        ledgerType: 'refund',
        referenceType: 'chat_feature_order',
        reason: 'generation_failed_or_provider_not_configured',
      },
    ],
  },
  settlementContract: {
    userSpendLumina: 'amount paid by user-facing product action',
    settlementEligibleLumina:
      'portion allowed by backend source policy after promo/free-source filtering',
    creatorEstimateOnly: true,
    finalPayoutRequiresAdminSettlementRun: true,
    deductions: ['platform_fee', 'pg_fee', 'ai_cost', 'tax_withholding', 'refund_hold'],
    warningCopyKo:
      '표시 금액은 정산 후보 추정치이며, 최종 정산액은 수수료·AI 비용·세금·환불 검토 후 달라질 수 있어요.',
  },
  endpoints: {
    readOnlyPolicy: '/api/v1/character-chat/monetization-policy',
    chatProducts: '/api/v1/chat-feature-products',
    fanLetterPolicy: '/api/v1/fan-letters/policy',
  },
  safety: {
    readOnly: true,
    walletMutation: false,
    settlementMutation: false,
    paymentMutation: false,
    creatorPayoutMutation: false,
    secretsReturned: false,
  },
} as const;
