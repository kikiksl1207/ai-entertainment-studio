export const CHAT_GENERATION_DISABLED_REASONS = {
  providerNotConfigured: {
    reason: 'provider_not_configured',
    messageKey: 'chat.generation.providerNotConfigured',
    displayMessageKo: '응답 생성 준비 중입니다.',
  },
  mvpLocked: {
    reason: 'mvp_locked',
    messageKey: 'chat.generation.mvpLocked',
    displayMessageKo: '아직 준비 중인 상품입니다.',
  },
} as const;

export type ChatFeatureProductPolicy = {
  sku: string;
  name: string;
  featureType: string;
  displayNameKo: string;
  priceLumina: number;
  status: 'active' | 'draft' | 'archived';
  modelTier: 'mini' | 'premium' | 'async_special' | 'image_later' | 'voice_later';
  settlementEligible: boolean;
  creatorShareEligible: boolean;
  settlementSource: 'chat' | 'fan_letter' | null;
  providerRequired: boolean;
  orderFlow: 'paid_generation' | 'async_reviewed_fan_letter' | 'draft_reserved';
  generationMode: 'inline_reply' | 'async_reviewed_reply' | 'reserved';
  maxInputChars: number;
  estimatedCostCeilingKrw: string;
  cooldownSeconds: number;
  dailyLimit: number | null;
  mvpLocked: boolean;
  requiresPreview: boolean;
  refundOnGenerationFailure: boolean;
  descriptionKo: string;
};

export const CHAT_FEATURE_PRODUCT_POLICIES: ChatFeatureProductPolicy[] = [
  {
    sku: 'CHAT_DEEP_REPLY',
    name: 'Deep Reply',
    featureType: 'deep_reply',
    displayNameKo: '딥 리플',
    priceLumina: 2,
    status: 'active',
    modelTier: 'mini',
    settlementEligible: true,
    creatorShareEligible: true,
    settlementSource: 'chat',
    providerRequired: true,
    orderFlow: 'paid_generation',
    generationMode: 'inline_reply',
    maxInputChars: 2000,
    estimatedCostCeilingKrw: '1.00',
    cooldownSeconds: 0,
    dailyLimit: null,
    mvpLocked: false,
    requiresPreview: true,
    refundOnGenerationFailure: true,
    descriptionKo: '기본 채팅보다 조금 더 깊은 캐릭터 응답입니다.',
  },
  {
    sku: 'CHAT_STORY_REPLY',
    name: 'Story Reply',
    featureType: 'story_reply',
    displayNameKo: '스토리 리플',
    priceLumina: 5,
    status: 'active',
    modelTier: 'mini',
    settlementEligible: true,
    creatorShareEligible: true,
    settlementSource: 'chat',
    providerRequired: true,
    orderFlow: 'paid_generation',
    generationMode: 'inline_reply',
    maxInputChars: 2000,
    estimatedCostCeilingKrw: '1.00',
    cooldownSeconds: 0,
    dailyLimit: null,
    mvpLocked: false,
    requiresPreview: true,
    refundOnGenerationFailure: true,
    descriptionKo: '캐릭터 세계관과 상황을 반영한 긴 응답입니다.',
  },
  {
    sku: 'CHAT_PREMIUM_REPLY',
    name: 'Premium Reply',
    featureType: 'premium_reply',
    displayNameKo: '프리미엄 리플',
    priceLumina: 10,
    status: 'active',
    modelTier: 'premium',
    settlementEligible: true,
    creatorShareEligible: true,
    settlementSource: 'chat',
    providerRequired: true,
    orderFlow: 'paid_generation',
    generationMode: 'inline_reply',
    maxInputChars: 2000,
    estimatedCostCeilingKrw: '3.00',
    cooldownSeconds: 0,
    dailyLimit: null,
    mvpLocked: false,
    requiresPreview: true,
    refundOnGenerationFailure: true,
    descriptionKo: '더 높은 비용 상한을 가진 프리미엄 캐릭터 응답입니다.',
  },
  {
    sku: 'CHAT_FANLETTER_30',
    name: 'Fan Letter 30',
    featureType: 'fan_letter',
    displayNameKo: '스페셜 팬레터 30',
    priceLumina: 30,
    status: 'active',
    modelTier: 'async_special',
    settlementEligible: true,
    creatorShareEligible: true,
    settlementSource: 'fan_letter',
    providerRequired: true,
    orderFlow: 'async_reviewed_fan_letter',
    generationMode: 'async_reviewed_reply',
    maxInputChars: 1000,
    estimatedCostCeilingKrw: '5.00',
    cooldownSeconds: 0,
    dailyLimit: null,
    mvpLocked: false,
    requiresPreview: true,
    refundOnGenerationFailure: true,
    descriptionKo: '즉시 DM이 아닌 비동기 검수형 팬레터 응답 상품입니다.',
  },
  {
    sku: 'CHAT_FANLETTER_50',
    name: 'Fan Letter 50',
    featureType: 'fan_letter',
    displayNameKo: '스페셜 팬레터 50',
    priceLumina: 50,
    status: 'active',
    modelTier: 'async_special',
    settlementEligible: true,
    creatorShareEligible: true,
    settlementSource: 'fan_letter',
    providerRequired: true,
    orderFlow: 'async_reviewed_fan_letter',
    generationMode: 'async_reviewed_reply',
    maxInputChars: 1000,
    estimatedCostCeilingKrw: '5.00',
    cooldownSeconds: 0,
    dailyLimit: null,
    mvpLocked: false,
    requiresPreview: true,
    refundOnGenerationFailure: true,
    descriptionKo: '더 긴 비동기 검수형 팬레터 응답 상품 후보입니다.',
  },
  {
    sku: 'CHAT_FANLETTER_100',
    name: 'Fan Letter 100',
    featureType: 'fan_letter',
    displayNameKo: '스페셜 팬레터 100',
    priceLumina: 100,
    status: 'active',
    modelTier: 'async_special',
    settlementEligible: true,
    creatorShareEligible: true,
    settlementSource: 'fan_letter',
    providerRequired: true,
    orderFlow: 'async_reviewed_fan_letter',
    generationMode: 'async_reviewed_reply',
    maxInputChars: 1000,
    estimatedCostCeilingKrw: '5.00',
    cooldownSeconds: 0,
    dailyLimit: null,
    mvpLocked: false,
    requiresPreview: true,
    refundOnGenerationFailure: true,
    descriptionKo: '상위 비동기 검수형 팬레터 응답 상품 후보입니다.',
  },
  {
    sku: 'CHAT_IMAGE_REPLY',
    name: 'Image Reply',
    featureType: 'image_reply',
    displayNameKo: '이미지 답장',
    priceLumina: 20,
    status: 'draft',
    modelTier: 'image_later',
    settlementEligible: true,
    creatorShareEligible: false,
    settlementSource: null,
    providerRequired: true,
    orderFlow: 'draft_reserved',
    generationMode: 'reserved',
    maxInputChars: 1000,
    estimatedCostCeilingKrw: '0.00',
    cooldownSeconds: 0,
    dailyLimit: null,
    mvpLocked: true,
    requiresPreview: true,
    refundOnGenerationFailure: true,
    descriptionKo: '이미지 생성 비용과 안전 정책 확정 전까지 예약 상태입니다.',
  },
  {
    sku: 'CHAT_VOICE_REPLY',
    name: 'Voice Reply',
    featureType: 'voice_reply',
    displayNameKo: '음성 답장',
    priceLumina: 20,
    status: 'draft',
    modelTier: 'voice_later',
    settlementEligible: true,
    creatorShareEligible: false,
    settlementSource: null,
    providerRequired: true,
    orderFlow: 'draft_reserved',
    generationMode: 'reserved',
    maxInputChars: 1000,
    estimatedCostCeilingKrw: '0.00',
    cooldownSeconds: 0,
    dailyLimit: null,
    mvpLocked: true,
    requiresPreview: true,
    refundOnGenerationFailure: true,
    descriptionKo: '음성 모델 비용과 안전 정책 확정 전까지 예약 상태입니다.',
  },
];

export const LEGACY_CHAT_FEATURE_PRODUCT_POLICIES = [
  {
    sku: 'CHAT_SPECIAL_REPLY',
    name: 'Special Reply',
    featureType: 'special_reply',
    displayNameKo: '스페셜 답장',
    priceLumina: 30,
    status: 'archived',
    modelTier: 'mini',
    settlementEligible: false,
    creatorShareEligible: false,
    settlementSource: null,
    providerRequired: true,
    orderFlow: 'draft_reserved',
    generationMode: 'reserved',
    maxInputChars: 1000,
    estimatedCostCeilingKrw: '0.00',
    cooldownSeconds: 0,
    dailyLimit: null,
    mvpLocked: true,
    requiresPreview: true,
    refundOnGenerationFailure: true,
    descriptionKo: '레거시 상품입니다. 팬레터/프리미엄 응답 정책으로 대체되었습니다.',
  },
] as const satisfies readonly ChatFeatureProductPolicy[];

export const PUBLIC_CHAT_FEATURE_TYPES = [
  'deep_reply',
  'story_reply',
  'premium_reply',
  'fan_letter',
];

const POLICIES_BY_SKU = new Map(
  [...CHAT_FEATURE_PRODUCT_POLICIES, ...LEGACY_CHAT_FEATURE_PRODUCT_POLICIES].map(
    (policy) => [policy.sku, policy],
  ),
);

const POLICIES_BY_FEATURE_TYPE = new Map<string, ChatFeatureProductPolicy>();

for (const policy of CHAT_FEATURE_PRODUCT_POLICIES) {
  if (!POLICIES_BY_FEATURE_TYPE.has(policy.featureType)) {
    POLICIES_BY_FEATURE_TYPE.set(policy.featureType, policy);
  }
}

export function findChatFeatureProductPolicy(input: {
  sku?: string;
  featureType?: string;
}) {
  return (
    (input.sku ? POLICIES_BY_SKU.get(input.sku) : undefined) ??
    (input.featureType ? POLICIES_BY_FEATURE_TYPE.get(input.featureType) : undefined) ??
    null
  );
}
