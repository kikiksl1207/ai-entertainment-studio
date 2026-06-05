import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InputJsonValue } from '@prisma/client/runtime/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ChatGenerationResult,
  ChatLlmProviderAdapter,
  ChatLlmProviderNotConfiguredError,
  ChatLlmProviderRequestError,
  ChatLlmProviderReadiness,
  ChatRuntimePersonaContext,
} from './llm-provider.adapter';
import {
  ARTIST_URL_KNOWLEDGE_CHAT_CONTEXT_POLICY,
  ARTIST_URL_KNOWLEDGE_CONTRACT,
  buildArtistKnowledgeChatContext,
  ArtistKnowledgeChatContext,
} from './artist-url-knowledge-contract';
import {
  CHAT_GENERATION_DISABLED_REASONS,
  PUBLIC_CHAT_FEATURE_TYPES,
  findChatFeatureProductPolicy,
} from './chat-feature-policy';
import {
  CHARACTER_CHAT_CATALOG_POLICY,
  CHAT_PERSONA_SEED_POLICY,
  CHAT_PERSONA_TRAIT_CATALOG,
  defaultCharacterGreeting,
  defaultCharacterStarterOptions,
  defaultCharacterStatus,
} from './chat-persona-catalog';
import {
  CHARACTER_CHAT_PREMIUM_TRANSITION_CTA_CONTRACT,
  PREMIUM_CHAT_SUPPORT_CONTRACT,
} from './premium-chat-support-contract';

const DEFAULT_CURRENCY = 'LUMINA';
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREMIUM_ROOM_DEFAULT_TAKE = 20;
const PREMIUM_ROOM_MAX_TAKE = 50;
const PREMIUM_ROOM_PUBLIC_LIST_STATUSES = ['opened', 'active', 'artist_answered'];
const PREMIUM_ROOM_READ_STATUSES = [
  'opened',
  'active',
  'artist_answered',
  'reported',
  'paused_by_report',
  'blind',
  'blinded',
  'suspended',
  'admin_review',
  'refund_pending',
  'refunded',
  'closed',
  'artist_closed',
  'closed_by_artist',
  'closed_by_operator',
  'expired',
] as const;
const PREMIUM_ROOM_SAFE_STATUS_ONLY_STATUSES = [
  'reported',
  'paused_by_report',
  'blind',
  'blinded',
  'suspended',
  'admin_review',
  'refund_pending',
] as const;
const PREMIUM_ROOM_ARCHIVE_STATUSES = [
  'refunded',
  'closed',
  'artist_closed',
  'closed_by_artist',
  'closed_by_operator',
  'expired',
] as const;
const PREMIUM_ROOM_NEAR_EXPIRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const STARTER_PROMPT_POLICY = {
  showForFirstSession: true,
  hideAfterFirstMessage: true,
  allowDismiss: true,
  maxVisibleOptions: 2,
  directInputEnabled: true,
};
const DEFAULT_STARTER_PROMPT_COPY = {
  guideText: (artistDisplayName: string) =>
    `처음이라 조금 어색하죠? ${artistDisplayName}에게 이렇게 말을 걸어볼까요?`,
  options: [
    {
      key: 'A',
      label: '오늘 어땠는지 물어보기',
      message: (artistDisplayName: string) =>
        `오늘 하루 어땠어? 괜히 ${artistDisplayName} 생각이 나서 들렀어.`,
    },
    {
      key: 'B',
      label: '조용히 응원하기',
      message: (artistDisplayName: string) =>
        `오늘도 ${artistDisplayName}의 무대를 기다리고 있어. 천천히 와도 괜찮아.`,
    },
  ],
  directInputLabel: '직접 입력하기',
};
type CharacterChatFallbackCopy = {
  greetingText: string;
  guideText: string;
  options: StarterPromptOption[];
  emptyStateText: string;
  premiumChatText: string;
  premiumChatCtaLabel: string;
  toneGuideKo: string;
  personaTags: string[];
};
const CHARACTER_CHAT_FALLBACK_COPY: Record<string, CharacterChatFallbackCopy> = {
  'yoon-serin': {
    greetingText: '세린이 무대 뒤 조용한 숨을 고르며 당신을 바라봐요.',
    guideText: '세린에게 차분하게 말을 걸어보세요.',
    options: [
      {
        key: 'A',
        label: '무대의 여운 묻기',
        message: '세린아, 오늘 무대에서 가장 오래 남은 순간은 뭐였어?',
      },
      {
        key: 'B',
        label: '조용한 응원 보내기',
        message: '오늘도 네 무대를 조용히 응원하고 있어. 천천히 쉬어도 괜찮아.',
      },
    ],
    emptyStateText: '세린과의 첫 대화가 아직 없어요. 조용한 인사를 건네보세요.',
    premiumChatText: '세린의 깊은 답변은 준비 중이에요. 지금은 차분한 첫 대화를 시작해 보세요.',
    premiumChatCtaLabel: '세린에게 인사하기',
    toneGuideKo: '차분하고 다정한 무대 뒤 톤을 유지하며 짧고 섬세하게 답해요.',
    personaTags: ['차분함', '다정함', '무대의 여운'],
  },
  'han-seoyul': {
    greetingText: '서율이 밝은 목소리로 오늘의 이야기를 물어봐요.',
    guideText: '서율에게 따뜻한 안부를 건네보세요.',
    options: [
      {
        key: 'A',
        label: '오늘의 소리 나누기',
        message: '서율아, 오늘 하루를 노래로 표현하면 어떤 느낌일까?',
      },
      {
        key: 'B',
        label: '작은 위로 부탁하기',
        message: '오늘 조금 지쳤어. 서율이의 밝은 한마디를 듣고 싶어.',
      },
    ],
    emptyStateText: '서율과 아직 나눈 이야기가 없어요. 밝은 안부부터 시작해 보세요.',
    premiumChatText: '서율의 특별 답변은 준비 중이에요. 지금은 따뜻한 안부를 남겨보세요.',
    premiumChatCtaLabel: '서율에게 안부 묻기',
    toneGuideKo: '밝고 따뜻한 목소리로 팬의 하루를 먼저 살피는 톤을 유지해요.',
    personaTags: ['밝음', '따뜻함', '작은 위로'],
  },
  'park-doa': {
    greetingText: '도아가 먼저 활짝 웃으며 말을 걸 준비를 해요.',
    guideText: '도아에게 가볍고 생기 있게 말을 걸어보세요.',
    options: [
      {
        key: 'A',
        label: '오늘 텐션 충전하기',
        message: '도아야, 오늘 기분 올릴 수 있는 한마디 해줄래?',
      },
      {
        key: 'B',
        label: '가벼운 장난 건네기',
        message: '도아랑 잠깐 웃고 싶어. 오늘 제일 재밌었던 일 뭐야?',
      },
    ],
    emptyStateText: '도아와의 대화가 아직 없어요. 가볍게 텐션을 올려보세요.',
    premiumChatText: '도아의 특별 답변은 준비 중이에요. 지금은 생기 있는 인사를 건네보세요.',
    premiumChatCtaLabel: '도아와 웃기',
    toneGuideKo: '활기 있고 장난스러운 리듬을 살리되 안전한 응원 대화로 이어가요.',
    personaTags: ['활기', '장난기', '에너지 충전'],
  },
  'choi-seojin': {
    greetingText: '서진이 차분한 시선으로 다음 장면을 기다려요.',
    guideText: '서진에게 차분하고 선명하게 말을 걸어보세요.',
    options: [
      {
        key: 'A',
        label: '오늘의 장면 묻기',
        message: '서진아, 오늘 가장 마음에 남은 장면은 어떤 분위기였어?',
      },
      {
        key: 'B',
        label: '깊은 응원 보내기',
        message: '말은 길지 않아도 네 장면을 오래 응원하고 있어.',
      },
    ],
    emptyStateText: '서진과 아직 대화가 없어요. 마음에 남은 장면을 물어보세요.',
    premiumChatText: '서진의 깊은 답변은 준비 중이에요. 지금은 조용한 응원을 전해보세요.',
    premiumChatCtaLabel: '서진에게 장면 묻기',
    toneGuideKo: '선명하고 절제된 표현으로 감정의 깊이를 천천히 보여줘요.',
    personaTags: ['절제', '깊은 응원', '선명한 장면'],
  },
  'min-chaeon': {
    greetingText: '채온이 컨디션을 살피며 천천히 대화를 시작해요.',
    guideText: '채온에게 부드럽게 컨디션과 루틴을 물어보세요.',
    options: [
      {
        key: 'A',
        label: '오늘 컨디션 묻기',
        message: '채온아, 오늘 몸 상태는 어때? 무리하지 않았으면 좋겠어.',
      },
      {
        key: 'B',
        label: '무대 루틴 응원하기',
        message: '다음 무대 준비도 채온답게 차근차근 해내길 응원할게.',
      },
    ],
    emptyStateText: '채온과의 대화가 아직 없어요. 컨디션을 먼저 물어보세요.',
    premiumChatText: '채온의 특별 답변은 준비 중이에요. 지금은 루틴을 응원해 보세요.',
    premiumChatCtaLabel: '채온의 컨디션 묻기',
    toneGuideKo: '부드럽고 현실적인 컨디션 체크 톤으로 무리 없는 응원을 건네요.',
    personaTags: ['부드러움', '컨디션 케어', '차근차근'],
  },
};
const CHARACTER_CHAT_FALLBACK_ARTISTS: Record<
  string,
  {
    id: string;
    displayName: string;
    tagline: string | null;
    personalityKeywords: string[];
    contentTone: string | null;
  }
> = {
  'yoon-serin': {
    id: '00000000-0000-4000-8000-000000000601',
    displayName: '\uC724\uC138\uB9B0',
    tagline: null,
    personalityKeywords: [],
    contentTone: null,
  },
  'han-seoyul': {
    id: '00000000-0000-4000-8000-000000000602',
    displayName: '\uD55C\uC11C\uC728',
    tagline: null,
    personalityKeywords: [],
    contentTone: null,
  },
  'park-doa': {
    id: '00000000-0000-4000-8000-000000000603',
    displayName: '\uBC15\uB3C4\uC544',
    tagline: null,
    personalityKeywords: [],
    contentTone: null,
  },
  'choi-seojin': {
    id: '00000000-0000-4000-8000-000000000604',
    displayName: '\uCD5C\uC11C\uC9C4',
    tagline: null,
    personalityKeywords: [],
    contentTone: null,
  },
  'min-chaeon': {
    id: '00000000-0000-4000-8000-000000000605',
    displayName: '\uBBFC\uCC44\uC628',
    tagline: null,
    personalityKeywords: [],
    contentTone: null,
  },
};
const DEFAULT_CHAT_RUNTIME_FORBIDDEN_TONE_KO = [
  '실존 인물 사칭',
  '성인/위험 대화 유도',
  '외부 연락처·결제 유도',
];
const DEFAULT_CHAT_RUNTIME_SAFETY_NOTE_KO =
  '캐릭터의 fictional boundary를 지키고, 실존 인물 사칭·성인/위험 대화·외부 연락처나 결제 유도는 피합니다.';

const CHARACTER_CHAT_GREETING_TONE_CONTRACT_VERSION =
  '2026-05-21.character-chat-greeting-tone.v1';
const CHARACTER_CHAT_DYNAMIC_GREETING_CONTRACT_VERSION =
  '2026-06-05.character-chat-opening-greeting-variants.v1';
const CHARACTER_CHAT_OPENING_GREETING_MESSAGE_TYPE = 'opening_greeting';
const CHARACTER_CHAT_OPENING_GREETING_MAX_CHARS = 180;
const CHARACTER_CHAT_OPENING_GREETING_MAX_OUTPUT_TOKENS = 120;
const CHARACTER_CHAT_OPENING_GREETING_MIN_VARIANTS = 5;
const CHARACTER_CHAT_OPENING_GREETING_MAX_VARIANTS = 10;

type StarterPromptOption = {
  key: string;
  label: string;
  message: string;
};

type StarterPromptSet = {
  id: string;
  guideText: string;
  options: StarterPromptOption[];
  directInput: {
    key: string;
    label: string;
  };
};
type CharacterChatCmsCopy = {
  entryId: string;
  contentKey: string;
  locale: string;
  version: number;
  welcomeText?: string;
  statusLabelKo?: string;
  statusDescriptionKo?: string;
  starterSets: StarterPromptSet[];
  emptyStateText?: string;
  premiumChatText?: string;
  premiumChatCtaLabel?: string;
};
type CharacterRuntimePersonaContext = ChatRuntimePersonaContext & {
  starterSets: StarterPromptSet[];
  directInput: {
    enabled: boolean;
    key: string;
    label: string;
  };
};
type ChatFeatureProductRecord = {
  id: string;
  sku: string;
  name: string;
  featureType: string;
  priceLumina: unknown;
  status: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};
type ChatProviderUserContext = {
  userId: string;
  userEmail: string | null;
};
type ChatProviderOpsStats = {
  totalResponses: number;
  failureCount: number;
  fallbackCount: number;
  usageByModel: Array<{
    provider: string;
    model: string;
    responses: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostKrw: string;
  }>;
  estimatedCostKrw: string;
};
type ChatConversationBox = 'recent' | 'archive' | 'all';
type ChatConversationStatusMutation = 'archive' | 'restore';
type ChatConversationListSessionRecord = {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  artist: {
    id: string;
    slug: string;
    displayName: string;
  };
  chatPersona: {
    id: string;
    name: string;
    status: string;
  } | null;
  messages: Array<{
    id: string;
    senderType: string;
    messageType: string;
    body: string | null;
    chatFeatureOrderId: string | null;
    createdAt: Date;
  }>;
  _count: {
    messages: number;
  };
};
type ChatOpeningGreetingSessionRecord = {
  id: string;
  userId: string;
  artistId: string;
  chatPersonaId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  artist: {
    id: string;
    slug: string;
    displayName: string;
    publicProfile?: {
      publicMetadata?: unknown;
      tagline?: string | null;
      personalityKeywords?: string[] | null;
    } | null;
    contentProfile?: {
      contentTone?: string | null;
    } | null;
  };
  chatPersona: {
    id: string;
    name: string;
    systemPrompt: string;
    safetyRules: unknown;
    modelConfig: unknown;
  } | null;
};
type ChatOpeningGreetingMessageRecord = {
  id: string;
  senderType: string;
  messageType: string;
  body: string | null;
  modelMetadata?: unknown;
  safetyMetadata?: unknown;
  createdAt: Date;
};
type ChatOpeningGreetingToneCandidate = {
  contractVersion: string;
  characterSlug: string;
  guideKo: string;
  guideSource: string;
  toneTags: string[];
  personaTags: string[];
  displaySafe: true;
  rawPersonaPromptStored: false;
};
type ChatOpeningGreetingCandidate = {
  body: string;
  source: 'provider' | 'fallback';
  providerCall: boolean;
  providerAttempted: boolean;
  toneCandidate: ChatOpeningGreetingToneCandidate;
  generated?: ChatGenerationResult;
  fallbackReason?: string;
};
const CHAT_CONVERSATION_MUTABLE_STATUSES = new Set(['active', 'archived']);
const BASIC_CHAT_POLICY = {
  mode: 'daily_talk',
  priceLumina: 0,
  modelTier: 'nano',
  cooldownSeconds: 30,
  dailyLimit: 50,
  maxInputChars: 1000,
  estimatedCostCeilingKrw: '0.20',
};
const CHAT_LLM_OPS_GUARD_POLICY = {
  policyVersion: '2026-05-14.chat-llm-ops-guard-v1',
  providerDailyRequestLimit: BASIC_CHAT_POLICY.dailyLimit,
  providerDailyFailureLimit: 5,
  cooldownSeconds: BASIC_CHAT_POLICY.cooldownSeconds,
  failClosed: true,
  usageMetadataPath: 'chat_messages.model_metadata.usage',
  safetyMetadataPath: 'chat_messages.safety_metadata',
  walletMutation: false,
  settlementMutation: false,
};
const KOREA_SERVICE_DAY_TIME_ZONE = 'Asia/Seoul';
const KOREA_SERVICE_DAY_OFFSET_MS = 9 * 60 * 60 * 1000;
const BASIC_CHAT_BLOCK_REASONS = {
  invalidMode: {
    reason: 'invalid_mode',
    code: 'CHAT_GENERATION_INVALID_MODE',
    messageKey: 'chat.generation.invalidMode',
    fallbackCopyKo: '지원하지 않는 대화 모드입니다.',
  },
  invalidBody: {
    reason: 'invalid_body',
    code: 'CHAT_GENERATION_INVALID_BODY',
    messageKey: 'chat.generation.invalidBody',
    fallbackCopyKo: '메시지는 1,000자 이하로 입력해주세요.',
  },
  cooldownActive: {
    reason: 'cooldown_active',
    code: 'CHAT_GENERATION_COOLDOWN_ACTIVE',
    messageKey: 'chat.generation.cooldownActive',
    fallbackCopyKo: '잠시 후 다시 말을 걸어주세요.',
  },
  dailyLimitReached: {
    reason: 'daily_limit_reached',
    code: 'CHAT_GENERATION_DAILY_LIMIT_REACHED',
    messageKey: 'chat.generation.dailyLimitReached',
    fallbackCopyKo: '오늘의 무료 대화 한도에 도달했어요.',
  },
  providerFailureLimitReached: {
    reason: 'provider_failure_limit_reached',
    code: 'CHAT_GENERATION_PROVIDER_FAILURE_LIMIT_REACHED',
    messageKey: 'chat.generation.providerFailureLimitReached',
    fallbackCopyKo:
      '\uc751\ub2f5\uc774 \uc548\uc815\ub420 \ub54c\uae4c\uc9c0 \uc7a0\uc2dc \ud6c4 \ub2e4\uc2dc \uc2dc\ub3c4\ud574 \uc8fc\uc138\uc694.',
  },
} as const;
const CHAT_FEATURE_ORDER_IDEMPOTENCY_REQUIRED = {
  code: 'CHAT_FEATURE_ORDER_IDEMPOTENCY_REQUIRED',
  messageKey: 'chat.order.idempotencyRequired',
  fallbackCopyKo: '주문을 안전하게 처리하려면 다시 시도해주세요.',
};
const CHAT_FEATURE_ORDER_CONFLICT = {
  code: 'CHAT_FEATURE_ORDER_IDEMPOTENCY_CONFLICT',
  messageKey: 'chat.order.idempotencyConflict',
  fallbackCopyKo:
    '\uc774\ubbf8 \ub2e4\ub978 \uc8fc\ubb38\uc5d0 \uc0ac\uc6a9\ub41c \uc694\uccad\uc774\uc5d0\uc694. \uc0c8\ub85c \uc2dc\ub3c4\ud574 \uc8fc\uc138\uc694.',
};
const CHAT_FEATURE_PRODUCT_LOCKED = {
  code: 'CHAT_FEATURE_PRODUCT_LOCKED',
  messageKey: CHAT_GENERATION_DISABLED_REASONS.mvpLocked.messageKey,
  fallbackCopyKo: CHAT_GENERATION_DISABLED_REASONS.mvpLocked.displayMessageKo,
};
const PAID_GENERATION_FEATURE_TYPES = new Set([
  'deep_reply',
  'story_reply',
  'premium_reply',
  'fan_letter',
  'special_reply',
  'image_reply',
  'voice_reply',
]);
const GENERATION_FAILURE_POLICY = {
  refundOnGenerationFailure: true,
  orderFailureStatus: 'failed',
  walletRecoveryLedgerType: 'refund',
  walletRecoveryReferenceType: 'chat_feature_order',
};
const CHAT_CONVERSATION_DEFAULT_TAKE = 20;
const CHAT_CONVERSATION_MAX_TAKE = 50;
const CHAT_CONVERSATION_LAST_MESSAGE_PREVIEW_MAX_CHARS = 120;
const CHAT_CONVERSATION_ITEM_REQUIRED_FIELDS = [
  'id',
  'box',
  'status',
  'artist',
  'persona',
  'messageCount',
  'lastMessage',
  'lastMessageAt',
  'latestMessage',
  'latestAt',
  'lastActivityAt',
  'updatedAt',
  'createdAt',
  'readState',
] as const;
const CHARACTER_CHAT_COPY_CMS_VERSION = '2026-05-20.character-chat-copy-cms.v1';
const CHARACTER_CHAT_COPY_CMS_SCOPE = 'character';
const CHARACTER_CHAT_COPY_CMS_PAGE_KEY = 'character-chat';
const CHARACTER_CHAT_COPY_CMS_LOCALE = 'ko-KR';
const CHARACTER_CHAT_COPY_CMS_CONTENT_KEY_PREFIX = 'character-chat.copy.';
const CHARACTER_CHAT_COPY_CMS_EDITABLE_FIELDS = [
  'welcome.text',
  'starterSets[].guideText',
  'starterSets[].options[].label',
  'starterSets[].options[].message',
  'starterSets[].directInput.label',
  'emptyState.text',
  'premiumChat.text',
  'premiumChat.ctaLabel',
  'status.labelKo',
  'status.descriptionKo',
] as const;
const CHARACTER_CHAT_COPY_FIXED_UI_LABELS = [
  'sendButton',
  'archiveButton',
  'restoreButton',
  'reportButton',
  'conversationTabLabels',
  'providerStateLabels',
] as const;
const CHARACTER_CHAT_DEFAULT_EMPTY_STATE_KO =
  '\uc544\uc9c1 \ub300\ud654\uac00 \uc5c6\uc5b4\uc694. \uba3c\uc800 \uc778\uc0ac\ub97c \uac74\ub124\ubcf4\uc138\uc694.';
const CHARACTER_CHAT_DEFAULT_PREMIUM_COPY_KO =
  '\uae4a\uc740 \ub2f5\ubcc0\uacfc \ud2b9\ubcc4 \ud32c\ub808\ud130 \uae30\ub2a5\uc740 \uc900\ube44 \uc911\uc774\uc5d0\uc694.';
const CHARACTER_CHAT_DEFAULT_PREMIUM_CTA_KO = '\uc900\ube44 \uc911';
const CHARACTER_CHAT_DEFAULT_TONE_GUIDE_KO =
  '\uce90\ub9ad\ud130\uc758 \uacf5\uac1c \ud1a4\uacfc \uc548\uc804 \uacbd\uacc4\ub97c \uc9c0\ud0a4\uba70 \uc9e7\uace0 \ub530\ub73b\ud558\uac8c \ub2f5\ud574\uc694.';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmProvider: ChatLlmProviderAdapter,
  ) {}

  async createSession(
    userId: string,
    input: {
      artistId: string;
      chatPersonaId?: string;
    },
  ) {
    const artist = await this.prisma.artist.findFirst({
      where: { id: input.artistId, status: 'active' },
      select: { id: true },
    });

    if (!artist) {
      throw new NotFoundException('Artist not found');
    }

    if (input.chatPersonaId) {
      const persona = await this.prisma.chatPersona.findFirst({
        where: {
          id: input.chatPersonaId,
          artistId: input.artistId,
          status: 'active',
        },
      });

      if (!persona) {
        throw new NotFoundException('Chat persona not found');
      }
    }

    const session = await this.prisma.chatSession.create({
      data: {
        userId,
        artistId: input.artistId,
        chatPersonaId: input.chatPersonaId,
        status: 'active',
      },
      include: this.openingGreetingSessionInclude(),
    });
    const openingGreeting = await this.ensureSessionOpeningGreeting(
      userId,
      session,
    );

    return {
      ...session,
      openingGreeting,
    };
  }

  getSessions(userId: string) {
    return this.prisma.chatSession.findMany({
      where: { userId },
      include: {
        artist: {
          select: { id: true, slug: true, displayName: true },
        },
        chatPersona: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getConversationList(
    userId: string,
    input: {
      box?: string;
      take?: number;
      cursor?: string;
    } = {},
  ) {
    const box = this.normalizeConversationBox(input.box);
    const take = this.normalizeConversationTake(input.take);
    const rows = await this.prisma.chatSession.findMany({
      where: this.conversationListWhere(userId, box),
      take: take + 1,
      ...(input.cursor
        ? {
            cursor: { id: this.validateCursor(input.cursor) },
            skip: 1,
          }
        : {}),
      include: this.conversationListInclude(),
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const page = this.paginate<ChatConversationListSessionRecord>(rows, take);

    return {
      readOnly: true,
      ownerOnly: true,
      box,
      items: page.items.map((session) => this.presentConversationListItem(session)),
      count: page.items.length,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      paginationContract: {
        defaultTake: CHAT_CONVERSATION_DEFAULT_TAKE,
        maxTake: CHAT_CONVERSATION_MAX_TAKE,
        appliedTake: take,
        cursor: input.cursor ?? null,
        cursorField: 'chat_sessions.id',
      },
      emptyState: this.conversationEmptyState(box),
      boxContract: {
        recentStatus: 'active',
        archiveStatus: 'archived',
        allStatuses: ['active', 'archived'],
      },
      itemShapeContract: {
        requiredFields: [...CHAT_CONVERSATION_ITEM_REQUIRED_FIELDS],
        itemsAlwaysArray: true,
        emptyItemsAllowed: true,
        lastMessagePreviewMaxChars:
          CHAT_CONVERSATION_LAST_MESSAGE_PREVIEW_MAX_CHARS,
        lastMessageRawBodyReturned: false,
        modelMetadataReturned: false,
        safetyMetadataReturned: false,
      },
      readStateContract: {
        supported: false,
        status: 'not_tracked',
        hasUnread: false,
        unreadCount: null,
        lastReadAt: null,
        badgeVisible: false,
        source: 'not_persisted',
        reason: 'read_receipts_not_implemented',
        messageKey: 'chat.conversations.readStateNotAvailable',
      },
      latestMessageContract: {
        aliasOf: 'lastMessage',
        previewField: 'bodyPreview',
        previewRawBodyReturned: false,
        pendingProviderMessageKey:
          'chat.conversations.latestMessage.pendingProvider',
        providerFailureMessageKey:
          'chat.conversations.latestMessage.providerFailed',
        emptyMessageKey: 'chat.conversations.latestMessage.empty',
      },
      archiveContract: {
        supported: true,
        mutationEnabled: true,
        actions: ['archive', 'restore'],
        archivePathTemplate: '/api/v1/chat/conversations/:sessionId/archive',
        restorePathTemplate: '/api/v1/chat/conversations/:sessionId/restore',
        statusField: 'chat_sessions.status',
        activeStatus: 'active',
        archivedStatus: 'archived',
      },
      safety: {
        llmCall: false,
        walletMutation: false,
        messageMutation: false,
        orderMutation: false,
        settlementMutation: false,
        secretsReturned: false,
      },
    };
  }

  async archiveConversation(userId: string, sessionId: string) {
    return this.mutateConversationStatus(userId, sessionId, 'archive');
  }

  async restoreConversation(userId: string, sessionId: string) {
    return this.mutateConversationStatus(userId, sessionId, 'restore');
  }

  getPersonaSeedPolicy() {
    return CHAT_PERSONA_SEED_POLICY;
  }

  getPersonaTraitCatalog() {
    return CHAT_PERSONA_TRAIT_CATALOG;
  }

  async getProviderOpsStatus(userId: string) {
    const now = new Date();
    const todayStart = this.koreaServiceDayStartUtc(now);
    const [providerUserContext, opsStats] = await Promise.all([
      this.getProviderUserContext(userId),
      this.providerOpsStatsForUser(userId, todayStart),
    ]);
    const readiness = this.llmProvider.readiness({
      userId: providerUserContext.userId,
      userEmail: providerUserContext.userEmail,
    });
    const requestRemaining = Math.max(
      0,
      CHAT_LLM_OPS_GUARD_POLICY.providerDailyRequestLimit -
        opsStats.totalResponses,
    );
    const failureRemaining = Math.max(
      0,
      CHAT_LLM_OPS_GUARD_POLICY.providerDailyFailureLimit -
        opsStats.failureCount,
    );

    return {
      serviceDay: {
        timeZone: KOREA_SERVICE_DAY_TIME_ZONE,
        startedAt: todayStart.toISOString(),
        checkedAt: now.toISOString(),
      },
      provider: this.providerDetails(readiness),
      guard: {
        ...CHAT_LLM_OPS_GUARD_POLICY,
        requestRemaining,
        failureRemaining,
        canAttemptProvider:
          readiness.configured && requestRemaining > 0 && failureRemaining > 0,
      },
      usage: {
        totalResponses: opsStats.totalResponses,
        failureCount: opsStats.failureCount,
        fallbackCount: opsStats.fallbackCount,
        usageByModel: opsStats.usageByModel,
        estimatedCostKrw: opsStats.estimatedCostKrw,
      },
      walletMutation: false,
      settlementMutation: false,
      secretsReturned: false,
    };
  }

  async getUsageSummary(
    userId: string,
    input: {
      artistId: string;
    },
  ) {
    const artist = await this.prisma.artist.findFirst({
      where: { id: input.artistId, status: 'active' },
      select: { id: true, slug: true, displayName: true },
    });

    if (!artist) {
      throw new NotFoundException('Artist not found');
    }

    const providerUserContext = await this.getProviderUserContext(userId);
    const preflight = await this.buildBasicChatPreflight(
      userId,
      { id: 'usage-summary', artistId: artist.id },
      '',
      BASIC_CHAT_POLICY.mode,
      providerUserContext,
    );

    return {
      artist,
      canSend: preflight.canSend,
      canGenerate: preflight.canGenerate,
      disabledReason: preflight.disabledReason,
      messageKey: preflight.messageKey,
      fallbackCopyKo: preflight.fallbackCopyKo,
      cooldownSeconds: preflight.limits.cooldownSeconds,
      cooldownRemainingSeconds: preflight.limits.cooldownRemainingSeconds,
      dailyLimit: preflight.limits.dailyLimit,
      dailyUsed: preflight.limits.dailyUsed,
      dailyRemaining: preflight.limits.dailyRemaining,
      providerDailyLimit: preflight.limits.providerDailyLimit,
      providerDailyUsed: preflight.limits.providerDailyUsed,
      providerDailyRemaining: preflight.limits.providerDailyRemaining,
      providerDailyFailureLimit: preflight.limits.providerDailyFailureLimit,
      providerDailyFailureCount: preflight.limits.providerDailyFailureCount,
      providerDailyFailureRemaining:
        preflight.limits.providerDailyFailureRemaining,
      serviceDayTimeZone: preflight.limits.serviceDayTimeZone,
      serviceDayStartAt: preflight.limits.serviceDayStartAt,
      maxInputChars: preflight.limits.maxInputChars,
      provider: preflight.provider,
      providerOps: preflight.providerOps,
      policy: preflight.policy,
      walletMutation: false,
      settlementEligible: false,
      providerCall: false,
      rawMessagesExposed: false,
    };
  }

  async getCharacterChatCatalog(input: { artistId?: string; artistSlug?: string }) {
    const artist = await this.findActiveChatArtist(input);
    const cmsCopy = await this.getCharacterChatCmsCopy(artist.slug);
    const metadata = this.recordOrEmpty(artist.publicProfile?.publicMetadata);
    const catalogMetadata = this.recordOrEmpty(metadata.chatCatalog);
    const cmsStarterSets = cmsCopy?.starterSets ?? [];
    const metadataSets = this.normalizeStarterPromptSets(metadata.chatStarterPromptSets);
    const configuredSets = cmsStarterSets.length ? cmsStarterSets : metadataSets;
    const fallbackCopy = CHARACTER_CHAT_FALLBACK_COPY[artist.slug];
    const metadataGreeting =
      cmsCopy?.welcomeText ?? this.stringFromUnknown(catalogMetadata.greetingText);
    const runtimePersona = this.buildCharacterRuntimePersonaContext(artist, {
      metadata,
      catalogMetadata,
      configuredSets,
      cmsCopy,
    });
    const statusLabelKo =
      cmsCopy?.statusLabelKo ?? this.stringFromUnknown(catalogMetadata.statusLabelKo);
    const statusDescriptionKo =
      cmsCopy?.statusDescriptionKo ??
      this.stringFromUnknown(catalogMetadata.statusDescriptionKo);
    const defaultStatus = defaultCharacterStatus();

    return {
      artist: {
        id: artist.id,
        slug: artist.slug,
        displayName: artist.displayName,
      },
      status: {
        key: defaultStatus.key,
        labelKo: statusLabelKo ?? defaultStatus.labelKo,
        descriptionKo: statusDescriptionKo ?? defaultStatus.descriptionKo,
      },
      greeting: runtimePersona.welcome,
      openingPrompt: this.characterChatOpeningPrompt(runtimePersona),
      starterOptions: runtimePersona.starterOptions,
      starterSets: runtimePersona.starterSets,
      directInput: runtimePersona.directInput,
      emptyState: this.characterChatEmptyState(cmsCopy, fallbackCopy),
      premiumChat: this.characterChatPremiumCopy(cmsCopy, fallbackCopy),
      tone: runtimePersona.tone,
      personaTags: runtimePersona.personaTags,
      forbiddenTone: this.characterChatForbiddenTone(runtimePersona),
      personaReference: runtimePersona.personaReference,
      runtimePersona,
      policy: CHARACTER_CHAT_CATALOG_POLICY,
      copyContract: this.characterChatCopyContract(artist.slug, cmsCopy),
      greetingToneContract: this.characterChatGreetingToneContract(artist.slug),
      dynamicGreetingContract: this.characterChatDynamicGreetingContract(
        artist.slug,
      ),
      source: cmsCopy
        ? 'site_content'
        : configuredSets.length || metadataGreeting
          ? 'artist_metadata'
          : runtimePersona.source,
    };
  }

  async getStarterPrompts(input: { artistId?: string; artistSlug?: string }) {
    const artist = await this.findActiveChatArtist(input);
    const cmsCopy = await this.getCharacterChatCmsCopy(artist.slug);
    const metadata = this.recordOrEmpty(artist.publicProfile?.publicMetadata);
    const cmsStarterSets = cmsCopy?.starterSets ?? [];
    const metadataSets = this.normalizeStarterPromptSets(metadata.chatStarterPromptSets);
    const configuredSets = cmsStarterSets.length
      ? cmsStarterSets
      : metadataSets;
    const fallbackCopy = CHARACTER_CHAT_FALLBACK_COPY[artist.slug];
    const runtimePersona = this.buildCharacterRuntimePersonaContext(artist, {
      metadata,
      configuredSets,
      cmsCopy,
    });

    return {
      artist: {
        id: artist.id,
        slug: artist.slug,
        displayName: artist.displayName,
      },
      policy: STARTER_PROMPT_POLICY,
      greeting: runtimePersona.welcome,
      openingPrompt: this.characterChatOpeningPrompt(runtimePersona),
      tone: runtimePersona.tone,
      personaTags: runtimePersona.personaTags,
      forbiddenTone: this.characterChatForbiddenTone(runtimePersona),
      personaReference: runtimePersona.personaReference,
      sets: runtimePersona.starterSets,
      emptyState: this.characterChatEmptyState(cmsCopy, fallbackCopy),
      premiumChat: this.characterChatPremiumCopy(cmsCopy, fallbackCopy),
      runtimePersona,
      copyContract: this.characterChatCopyContract(artist.slug, cmsCopy),
      greetingToneContract: this.characterChatGreetingToneContract(artist.slug),
      dynamicGreetingContract: this.characterChatDynamicGreetingContract(
        artist.slug,
      ),
      source: cmsCopy
        ? 'site_content'
        : configuredSets.length
          ? 'artist_metadata'
          : runtimePersona.source,
    };
  }

  private async ensureSessionOpeningGreeting(
    userId: string,
    session: ChatOpeningGreetingSessionRecord,
  ) {
    const cached = await this.prisma.chatMessage.findFirst({
      where: {
        chatSessionId: session.id,
        senderType: 'artist',
        messageType: CHARACTER_CHAT_OPENING_GREETING_MESSAGE_TYPE,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (cached) {
      return this.openingGreetingResponse(cached, {
        cacheHit: true,
        providerCall: false,
      });
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Lock the session row so concurrent opening-greeting requests serialize.
      await tx.chatSession.update({
        where: { id: session.id },
        data: { updatedAt: new Date() },
      });

      const cachedInTransaction = await tx.chatMessage.findFirst({
        where: {
          chatSessionId: session.id,
          senderType: 'artist',
          messageType: CHARACTER_CHAT_OPENING_GREETING_MESSAGE_TYPE,
        },
        orderBy: { createdAt: 'asc' },
      });

      if (cachedInTransaction) {
        return this.openingGreetingResponse(cachedInTransaction, {
          cacheHit: true,
          providerCall: false,
        });
      }

      const candidate = await this.buildOpeningGreetingCandidate(userId, session);

      const message = await tx.chatMessage.create({
        data: {
          chatSessionId: session.id,
          senderType: 'artist',
          messageType: CHARACTER_CHAT_OPENING_GREETING_MESSAGE_TYPE,
          body: candidate.body,
          modelMetadata: this.inputJson(
            this.openingGreetingModelMetadata(candidate),
          ),
          safetyMetadata: this.inputJson(
            this.openingGreetingSafetyMetadata(candidate),
          ),
        },
      });

      return this.openingGreetingResponse(message, {
        cacheHit: false,
        providerCall: candidate.providerCall,
      });
    });
  }

  private async buildOpeningGreetingCandidate(
    userId: string,
    session: ChatOpeningGreetingSessionRecord,
  ): Promise<ChatOpeningGreetingCandidate> {
    const runtimePersona = this.buildCharacterRuntimePersonaContext(session.artist);
    const toneCandidate = this.openingGreetingToneCandidate(
      session.artist.slug,
      runtimePersona,
    );
    const providerUserContext = await this.getProviderUserContext(userId);
    const readiness = await this.providerReadinessForUser(
      userId,
      providerUserContext,
    );

    if (readiness.configured) {
      const todayStart = this.koreaServiceDayStartUtc(new Date());
      const opsStats = await this.providerOpsStatsForUser(userId, todayStart);
      const canAttemptProvider =
        opsStats.totalResponses <
          CHAT_LLM_OPS_GUARD_POLICY.providerDailyRequestLimit &&
        opsStats.failureCount <
          CHAT_LLM_OPS_GUARD_POLICY.providerDailyFailureLimit;

      if (canAttemptProvider) {
        try {
          const generated = await this.llmProvider.generate({
            sessionId: session.id,
            userId,
            userEmail: providerUserContext.userEmail,
            artist: {
              id: session.artist.id,
              slug: session.artist.slug,
              displayName: session.artist.displayName,
            },
            persona: session.chatPersona
              ? {
                  id: session.chatPersona.id,
                  name: session.chatPersona.name,
                  systemPrompt: session.chatPersona.systemPrompt,
                  safetyRules: session.chatPersona.safetyRules,
                  modelConfig: session.chatPersona.modelConfig,
                }
              : null,
            runtimePersona,
            mode: CHARACTER_CHAT_OPENING_GREETING_MESSAGE_TYPE,
            userMessage: this.openingGreetingGenerationInstruction(session),
            maxOutputTokens: CHARACTER_CHAT_OPENING_GREETING_MAX_OUTPUT_TOKENS,
            recentMessages: [],
            order: null,
          });
          const body = this.normalizeOpeningGreetingText(generated.body);

          if (body) {
            return {
              body,
              source: 'provider',
              providerCall: true,
              providerAttempted: true,
              toneCandidate,
              generated: {
                ...generated,
                body,
              },
            };
          }

          return this.fallbackOpeningGreetingCandidate(
            runtimePersona,
            session.id,
            toneCandidate,
            'provider_empty_response',
            true,
          );
        } catch (error) {
          return this.fallbackOpeningGreetingCandidate(
            runtimePersona,
            session.id,
            toneCandidate,
            error instanceof ChatLlmProviderRequestError
              ? error.code
              : 'provider_failed',
            true,
          );
        }
      }

      return this.fallbackOpeningGreetingCandidate(
        runtimePersona,
        session.id,
        toneCandidate,
        'provider_guard_blocked',
        false,
      );
    }

    return this.fallbackOpeningGreetingCandidate(
      runtimePersona,
      session.id,
      toneCandidate,
      readiness.status,
      false,
    );
  }

  private fallbackOpeningGreetingCandidate(
    runtimePersona: CharacterRuntimePersonaContext,
    sessionId: string,
    toneCandidate: ChatOpeningGreetingToneCandidate,
    fallbackReason: string,
    providerAttempted: boolean,
  ): ChatOpeningGreetingCandidate {
    return {
      body: this.fallbackOpeningGreeting(runtimePersona, sessionId),
      source: 'fallback',
      providerCall: false,
      providerAttempted,
      toneCandidate,
      fallbackReason,
    };
  }

  private fallbackOpeningGreeting(
    runtimePersona: CharacterRuntimePersonaContext,
    sessionId: string,
  ) {
    const welcome =
      this.normalizeOpeningGreetingText(runtimePersona.welcome.text) ??
      defaultCharacterGreeting('Lumina');
    const starterMessages = runtimePersona.starterOptions
      .filter((option) => !option.directInput)
      .map((option) => this.normalizeOpeningGreetingText(option.message))
      .filter((message): message is string => Boolean(message))
      .slice(0, 4);
    const personaTags = runtimePersona.personaTags
      .map((tag) => this.normalizeOpeningGreetingText(tag))
      .filter((tag): tag is string => Boolean(tag))
      .slice(0, 6);
    const toneGuide = this.normalizeOpeningGreetingText(runtimePersona.tone.guideKo);
    const starterMessage =
      starterMessages[
        this.openingGreetingVariantIndex(
          `${sessionId}:starter:${welcome}`,
          starterMessages.length,
        )
      ];
    const alternateStarterMessage =
      starterMessages[
        this.openingGreetingVariantIndex(
          `${sessionId}:alternate-starter:${welcome}`,
          starterMessages.length,
        )
      ];
    const personaTag =
      personaTags[
        this.openingGreetingVariantIndex(
          `${sessionId}:persona:${welcome}`,
          personaTags.length,
        )
      ];
    const candidates = [
      welcome,
      starterMessage ? `${starterMessage} ${welcome}` : null,
      toneGuide ? `${welcome} ${toneGuide}` : null,
      personaTag ? `${personaTag}. ${welcome}` : null,
      starterMessage ? `${welcome} ${starterMessage}` : null,
      personaTag && starterMessage ? `${personaTag}. ${starterMessage}` : null,
      personaTag && toneGuide ? `${personaTag}. ${toneGuide}` : null,
      alternateStarterMessage && toneGuide
        ? `${alternateStarterMessage} ${toneGuide}`
        : null,
      ...this.fallbackOpeningGreetingDefaultCandidates(welcome),
    ];
    const uniqueCandidates = [
      ...new Set(
        candidates
          .map((candidate) => this.normalizeOpeningGreetingText(candidate))
          .filter((candidate): candidate is string => Boolean(candidate)),
      ),
    ].slice(0, CHARACTER_CHAT_OPENING_GREETING_MAX_VARIANTS);
    const selected =
      uniqueCandidates[
        this.openingGreetingVariantIndex(
          `${sessionId}:opening-greeting:${welcome}`,
          uniqueCandidates.length,
        )
      ] ?? welcome;

    return (
      this.normalizeOpeningGreetingText(selected) ??
      this.normalizeOpeningGreetingText(welcome) ??
      defaultCharacterGreeting('Lumina')
    );
  }

  private fallbackOpeningGreetingDefaultCandidates(welcome: string) {
    return [
      welcome,
      `반가워요. ${welcome}`,
      `오늘은 천천히 이야기해봐요. ${welcome}`,
      `편하게 말을 걸어줘요. ${welcome}`,
      `지금부터 같이 시작해볼게요. ${welcome}`,
      `궁금한 이야기를 들려줘요. ${welcome}`,
    ];
  }

  private openingGreetingGenerationInstruction(
    session: ChatOpeningGreetingSessionRecord,
  ) {
    return [
      'Write one short Korean first greeting for this new chat session.',
      `Character: ${session.artist.displayName}.`,
      'Use one warm sentence, vary the wording naturally, and stay within the runtime persona.',
      'Treat this as one selection from a 5 to 10 variant greeting pool, but return only the selected greeting.',
      'Do not mention prompts, providers, models, payment, settlement, or policies.',
      `Session variant seed: ${this.openingGreetingVariantSeed(session.id)}.`,
    ].join(' ');
  }

  private openingGreetingModelMetadata(
    candidate: ChatOpeningGreetingCandidate,
  ) {
    if (!candidate.generated) {
      return {
        usageSchemaVersion: '2026-05-22.character-chat-opening-greeting-v1',
        purpose: CHARACTER_CHAT_OPENING_GREETING_MESSAGE_TYPE,
        contractVersion: CHARACTER_CHAT_DYNAMIC_GREETING_CONTRACT_VERSION,
        source: candidate.source,
        fallbackReason: candidate.fallbackReason ?? null,
        estimatedCostKrw: '0.00',
        maxOutputChars: CHARACTER_CHAT_OPENING_GREETING_MAX_CHARS,
        cacheScope: 'chat_session',
        toneCandidate: candidate.toneCandidate,
        rawPromptStored: false,
        rawProviderPayloadStored: false,
        userPrivateDataStored: false,
      };
    }

    return {
      usageSchemaVersion: '2026-05-22.character-chat-opening-greeting-v1',
      purpose: CHARACTER_CHAT_OPENING_GREETING_MESSAGE_TYPE,
      contractVersion: CHARACTER_CHAT_DYNAMIC_GREETING_CONTRACT_VERSION,
      provider: candidate.generated.usage.provider,
      model: candidate.generated.usage.model,
      usage: candidate.generated.usage,
      estimatedCostKrw: candidate.generated.usage.estimatedCostKrw,
      maxOutputChars: CHARACTER_CHAT_OPENING_GREETING_MAX_CHARS,
      maxOutputTokens: CHARACTER_CHAT_OPENING_GREETING_MAX_OUTPUT_TOKENS,
      cacheScope: 'chat_session',
      toneCandidate: candidate.toneCandidate,
      rawPromptStored: false,
      rawProviderPayloadStored: false,
      userPrivateDataStored: false,
    };
  }

  private openingGreetingSafetyMetadata(
    candidate: ChatOpeningGreetingCandidate,
  ) {
    return {
      ...(candidate.generated?.safetyMetadata ?? {}),
      purpose: CHARACTER_CHAT_OPENING_GREETING_MESSAGE_TYPE,
      contractVersion: CHARACTER_CHAT_DYNAMIC_GREETING_CONTRACT_VERSION,
      openingGreetingSource: candidate.source,
      providerAttempted: candidate.providerAttempted,
      fallbackReason: candidate.fallbackReason ?? null,
      cacheScope: 'chat_session',
      cacheKey: CHARACTER_CHAT_OPENING_GREETING_MESSAGE_TYPE,
      rawPromptStored: false,
      rawProviderPayloadStored: false,
      userPrivateDataStored: false,
    };
  }

  private openingGreetingResponse(
    message: ChatOpeningGreetingMessageRecord,
    options: {
      cacheHit: boolean;
      providerCall: boolean;
    },
  ) {
    const modelMetadata = this.recordOrEmpty(message.modelMetadata);
    const safetyMetadata = this.recordOrEmpty(message.safetyMetadata);

    return {
      id: message.id,
      text: this.normalizeOpeningGreetingText(message.body) ?? '',
      messageType: CHARACTER_CHAT_OPENING_GREETING_MESSAGE_TYPE,
      createdAt: message.createdAt,
      source:
        this.stringFromUnknown(safetyMetadata.openingGreetingSource) ??
        (options.cacheHit ? 'cache' : 'fallback'),
      cache: {
        scope: 'chat_session',
        key: CHARACTER_CHAT_OPENING_GREETING_MESSAGE_TYPE,
        hit: options.cacheHit,
        generatedOnce: !options.cacheHit,
        reloadCreatesNewGreeting: false,
      },
      generation: {
        contractVersion: CHARACTER_CHAT_DYNAMIC_GREETING_CONTRACT_VERSION,
        providerCall: options.providerCall,
        maxOutputChars: CHARACTER_CHAT_OPENING_GREETING_MAX_CHARS,
        maxOutputTokens: CHARACTER_CHAT_OPENING_GREETING_MAX_OUTPUT_TOKENS,
      },
      toneCandidate: this.openingGreetingToneCandidateFromMetadata(modelMetadata),
      safety: {
        rawPromptStored: false,
        rawProviderPayloadStored: false,
        userPrivateDataStored: false,
        tokenReturned: false,
        apiKeyReturned: false,
      },
    };
  }

  private openingGreetingToneCandidate(
    characterSlug: string,
    runtimePersona: CharacterRuntimePersonaContext,
  ): ChatOpeningGreetingToneCandidate {
    return {
      contractVersion: CHARACTER_CHAT_GREETING_TONE_CONTRACT_VERSION,
      characterSlug,
      guideKo: runtimePersona.tone.guideKo,
      guideSource: runtimePersona.tone.guideSource,
      toneTags: runtimePersona.tone.toneTags.slice(0, 8),
      personaTags: runtimePersona.personaTags.slice(0, 8),
      displaySafe: true,
      rawPersonaPromptStored: false,
    };
  }

  private openingGreetingToneCandidateFromMetadata(
    modelMetadata: Record<string, unknown>,
  ) {
    const toneCandidate = this.recordOrEmpty(modelMetadata.toneCandidate);
    const guideKo = this.stringFromUnknown(toneCandidate.guideKo);

    if (!guideKo) {
      return null;
    }

    return {
      contractVersion:
        this.stringFromUnknown(toneCandidate.contractVersion) ??
        CHARACTER_CHAT_GREETING_TONE_CONTRACT_VERSION,
      characterSlug: this.stringFromUnknown(toneCandidate.characterSlug) ?? null,
      guideKo,
      guideSource: this.stringFromUnknown(toneCandidate.guideSource) ?? null,
      toneTags: this.normalizeStringList(toneCandidate.toneTags, 8, 40),
      personaTags: this.normalizeStringList(toneCandidate.personaTags, 8, 40),
      displaySafe: toneCandidate.displaySafe === true,
      rawPersonaPromptStored: false,
    };
  }

  private normalizeOpeningGreetingText(value: unknown) {
    const normalized = this.stringFromUnknown(value)?.replace(/\s+/g, ' ').trim();

    return normalized?.slice(0, CHARACTER_CHAT_OPENING_GREETING_MAX_CHARS) ?? null;
  }

  private openingGreetingVariantIndex(seed: string, modulo: number) {
    if (modulo <= 1) {
      return 0;
    }

    let hash = 0;

    for (let index = 0; index < seed.length; index += 1) {
      hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
    }

    return hash % modulo;
  }

  private openingGreetingVariantSeed(sessionId: string) {
    return sessionId.replace(/[^0-9a-f]/gi, '').slice(-8) || 'default';
  }

  async getMessages(userId: string, sessionId: string) {
    const session = await this.getOwnedSessionForOpeningGreeting(userId, sessionId);

    await this.ensureSessionOpeningGreeting(userId, session);

    return this.prisma.chatMessage.findMany({
      where: { chatSessionId: sessionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async preflightMessage(
    userId: string,
    sessionId: string,
    input: {
      body?: string;
      mode?: string;
    },
  ) {
    const mode = this.normalizeBasicChatMode(input.mode);
    const body = this.normalizeBasicChatBody(input.body);
    const session = await this.getOwnedSession(userId, sessionId);

    return this.buildBasicChatPreflight(userId, session, body, mode);
  }

  async createMessage(
    userId: string,
    sessionId: string,
    input: {
      body: string;
      messageType?: string;
      chatFeatureOrderId?: string;
    },
  ) {
    const body = input.chatFeatureOrderId
      ? input.body
      : this.normalizeBasicChatBody(input.body);
    const session = await this.getOwnedSession(userId, sessionId);

    if (input.chatFeatureOrderId) {
      const order = await this.prisma.chatFeatureOrder.findFirst({
        where: {
          id: input.chatFeatureOrderId,
          userId,
          chatSessionId: session.id,
          status: 'completed',
        },
      });

      if (!order) {
        throw new BadRequestException('Completed chat feature order not found');
      }
    } else {
      const preflight = await this.buildBasicChatPreflight(
        userId,
        session,
        body,
        BASIC_CHAT_POLICY.mode,
      );

      if (!preflight.canSend) {
        throw this.basicChatPreflightException(preflight);
      }
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const message = await tx.chatMessage.create({
        data: {
          chatSessionId: session.id,
          senderType: 'user',
          messageType: input.messageType ?? 'text',
          body,
          chatFeatureOrderId: input.chatFeatureOrderId,
        },
      });

      await tx.chatSession.update({
        where: { id: session.id },
        data: { updatedAt: new Date() },
      });

      return message;
    });
  }

  async getFeatureProducts() {
    const products = await this.prisma.chatFeatureProduct.findMany({
      where: {
        status: 'active',
        featureType: { in: [...PUBLIC_CHAT_FEATURE_TYPES] },
      },
      orderBy: [{ priceLumina: 'asc' }, { name: 'asc' }],
    });

    return products.map((product: ChatFeatureProductRecord) =>
      this.chatFeatureProductResponse(product),
    );
  }

  getPremiumSupportContract() {
    return PREMIUM_CHAT_SUPPORT_CONTRACT;
  }

  async getPremiumRoomList(input: {
    artistSlug?: string;
    status?: string;
    take?: number;
    cursor?: string;
  }) {
    const take = this.normalizePremiumRoomTake(input.take);
    const statusFilter = this.normalizePremiumRoomListStatus(input.status);
    const cursor = this.normalizeOptionalRoomCursor(input.cursor);
    const where: Prisma.PremiumChatRoomWhereInput = {
      status: statusFilter ? statusFilter : { in: PREMIUM_ROOM_PUBLIC_LIST_STATUSES },
      artist: {
        status: 'active',
        ...(input.artistSlug ? { slug: input.artistSlug.trim() } : {}),
      },
    };

    const [rooms, total] = await Promise.all([
      this.prisma.premiumChatRoom.findMany({
        where,
        include: this.premiumRoomInclude(),
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.premiumChatRoom.count({ where }),
    ]);

    return {
      items: rooms.map((room) => this.toPremiumRoomListItem(room)),
      count: rooms.length,
      total,
      nextCursor: rooms.length === take ? rooms[rooms.length - 1]?.id ?? null : null,
      generatedAt: new Date().toISOString(),
      policy: this.premiumRoomReadPolicy('public_room_list'),
    };
  }

  async getMyPremiumRoomStatus(userId: string, roomId: string) {
    this.assertPremiumRoomId(roomId);
    const room = await this.prisma.premiumChatRoom.findFirst({
      where: {
        id: roomId,
        ownerUserId: userId,
      },
      include: this.premiumRoomInclude(),
    });

    if (!room) {
      throw this.premiumRoomNotFound();
    }

    return this.toPremiumRoomDetail(room, 'owner_user');
  }

  async getArtistPremiumRoomStatus(userId: string, roomId: string) {
    this.assertPremiumRoomId(roomId);
    const room = await this.prisma.premiumChatRoom.findFirst({
      where: { id: roomId },
      include: this.premiumRoomInclude(),
    });

    if (!room) {
      throw this.premiumRoomNotFound();
    }

    const operator = await this.prisma.artistOperator.findFirst({
      where: {
        userId,
        artistId: room.artistId,
        status: 'active',
        revokedAt: null,
      },
      select: { id: true },
    });

    if (!operator) {
      throw this.premiumRoomNotFound();
    }

    return this.toPremiumRoomDetail(room, 'artist_operator');
  }

  getArtistUrlKnowledgeContract() {
    return ARTIST_URL_KNOWLEDGE_CONTRACT;
  }

  async previewFeatureOrder(
    userId: string,
    input: {
      chatSessionId: string;
      chatFeatureProductId: string;
    },
  ) {
    const [session, product, wallet, providerUserContext] = await Promise.all([
      this.getOwnedSession(userId, input.chatSessionId),
      this.prisma.chatFeatureProduct.findFirst({
        where: { id: input.chatFeatureProductId, status: 'active' },
      }),
      this.prisma.walletAccount.findUnique({
        where: {
          userId_currencyCode: { userId, currencyCode: DEFAULT_CURRENCY },
        },
      }),
      this.getProviderUserContext(userId),
    ]);

    if (!product) {
      throw new NotFoundException('Chat feature product not found');
    }

    if (!wallet || wallet.status !== 'active') {
      throw new BadRequestException('Active wallet not found');
    }

    const productPolicy = this.chatFeatureProductPolicy(product);
    const readiness = await this.providerReadinessForUser(
      userId,
      providerUserContext,
    );
    const generationPolicy = this.chatGenerationPolicy(product, readiness);
    const afterBalanceLumina = wallet.cachedBalance.minus(product.priceLumina);
    const sufficientBalance = wallet.cachedBalance.comparedTo(product.priceLumina) >= 0;

    return {
      session: {
        id: session.id,
        artistId: session.artistId,
        chatPersonaId: session.chatPersonaId,
      },
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        displayName: productPolicy.displayName,
        description: productPolicy.description,
        featureType: product.featureType,
        priceLumina: product.priceLumina,
        status: product.status,
        modelTier: productPolicy.modelTier,
      },
      wallet: {
        id: wallet.id,
        currencyCode: wallet.currencyCode,
        balanceLumina: wallet.cachedBalance,
        afterBalanceLumina,
        sufficientBalance,
      },
      policy: {
        idempotencyRequired: true,
        settlementEligible: productPolicy.settlementEligible,
        refundOnGenerationFailure: productPolicy.refundOnGenerationFailure,
        mvpLocked: productPolicy.mvpLocked,
        requiresIdentityVerification: false,
        generationStatus: generationPolicy.generationStatus,
        product: productPolicy,
        settlement: this.chatSettlementPolicy(product),
        generation: generationPolicy,
        failure: GENERATION_FAILURE_POLICY,
      },
    };
  }

  async createFeatureOrder(
    userId: string,
    input: {
      chatSessionId: string;
      chatFeatureProductId: string;
      idempotencyKey?: string;
    },
  ) {
    const idempotencyKey = input.idempotencyKey?.trim();

    if (!idempotencyKey) {
      throw new BadRequestException({
        ...CHAT_FEATURE_ORDER_IDEMPOTENCY_REQUIRED,
        message: CHAT_FEATURE_ORDER_IDEMPOTENCY_REQUIRED.fallbackCopyKo,
      });
    }

    const [session, product, providerUserContext] = await Promise.all([
      this.getOwnedSession(userId, input.chatSessionId),
      this.prisma.chatFeatureProduct.findFirst({
        where: { id: input.chatFeatureProductId, status: 'active' },
      }),
      this.getProviderUserContext(userId),
    ]);

    if (!product) {
      throw new NotFoundException('Chat feature product not found');
    }

    const readiness = await this.providerReadinessForUser(
      userId,
      providerUserContext,
    );

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existingOrder = await tx.chatFeatureOrder.findUnique({
        where: { idempotencyKey },
        include: { walletLedger: true, chatFeatureProduct: true },
      });

      if (existingOrder) {
        this.assertIdempotentFeatureOrderReplay(existingOrder, {
          userId,
          chatSessionId: session.id,
          chatFeatureProductId: product.id,
        });

        return {
          order: existingOrder,
          idempotentReplay: true,
          policy: {
            generation: this.chatGenerationPolicy(
              existingOrder.chatFeatureProduct,
              readiness,
            ),
            settlement: this.chatSettlementPolicy(existingOrder.chatFeatureProduct),
            failure: GENERATION_FAILURE_POLICY,
          },
        };
      }

      this.assertCanCreateFeatureOrder(product, readiness);

      const wallet = await tx.walletAccount.findUnique({
        where: {
          userId_currencyCode: { userId, currencyCode: DEFAULT_CURRENCY },
        },
      });

      if (!wallet || wallet.status !== 'active') {
        throw new BadRequestException('Active wallet not found');
      }

      const updatedWallet = await tx.walletAccount.updateMany({
        where: { id: wallet.id, cachedBalance: { gte: product.priceLumina } },
        data: { cachedBalance: { decrement: product.priceLumina } },
      });

      if (updatedWallet.count !== 1) {
        throw new BadRequestException('Insufficient Lumina balance');
      }

      const ledger = await tx.walletLedger.create({
        data: {
          walletAccountId: wallet.id,
          direction: 'debit',
          amount: product.priceLumina,
          ledgerType: 'chat_feature_spend',
          referenceType: 'chat_feature_product',
          referenceId: product.id,
          idempotencyKey: `chat-feature:${idempotencyKey}`,
          memo: `Chat feature order: ${product.name}`,
        },
      });

      const order = await tx.chatFeatureOrder.create({
        data: {
          userId,
          artistId: session.artistId,
          chatSessionId: session.id,
          chatFeatureProductId: product.id,
          walletLedgerId: ledger.id,
          status: 'completed',
          idempotencyKey,
        },
        include: { walletLedger: true, chatFeatureProduct: true },
      });

      return {
        order,
        idempotentReplay: false,
        policy: {
          generation: this.chatGenerationPolicy(product, readiness),
          settlement: this.chatSettlementPolicy(product),
          failure: GENERATION_FAILURE_POLICY,
        },
      };
    });
  }

  async generateMessage(
    userId: string,
    sessionId: string,
    input: {
      body: string;
      chatFeatureOrderId?: string;
    },
  ) {
    const session = await this.getOwnedSessionForGeneration(userId, sessionId);
    const order = input.chatFeatureOrderId
      ? await this.getFeatureOrderForGeneration(userId, session.id, input.chatFeatureOrderId)
      : null;
    const body = order
      ? this.normalizeGenerationBody(input.body)
      : this.normalizeBasicChatBody(input.body);
    const providerUserContext = await this.getProviderUserContext(userId);

    if (!order) {
      const preflight = await this.buildBasicChatPreflight(
        userId,
        session,
        body,
        BASIC_CHAT_POLICY.mode,
        providerUserContext ?? undefined,
      );

      if (!preflight.canGenerate) {
        throw this.basicChatPreflightException(preflight);
      }
    }

    const existingGenerated = order?.messages.find(
      (message: { senderType: string }) => message.senderType === 'artist',
    );

    if (order && existingGenerated) {
      return {
        generationStatus: 'completed',
        order: this.orderSummary(order),
        message: existingGenerated,
        usage: this.recordOrEmpty(existingGenerated.modelMetadata).usage ?? null,
        policy: {
          generation: this.chatGenerationPolicy(order.chatFeatureProduct),
          failure: GENERATION_FAILURE_POLICY,
        },
      };
    }

    if (order) {
      const readiness = await this.providerReadinessForUser(
        userId,
        providerUserContext,
      );
      const generationPolicy = this.chatGenerationPolicy(
        order.chatFeatureProduct,
        readiness,
      );

      if (!generationPolicy.canGenerate) {
        await this.failFeatureOrderAndRestoreLumina(
          userId,
          order.id,
          generationPolicy.disabledReason ?? 'generation_unavailable',
        );

        if (this.isProviderUnavailableReason(generationPolicy.disabledReason)) {
          throw this.providerUnavailableException(
            order.chatFeatureProduct,
            undefined,
            readiness,
          );
        }

        throw this.chatFeatureProductLockedException(
          order.chatFeatureProduct,
          readiness,
        );
      }
    }

    const recentMessages = await this.prisma.chatMessage.findMany({
      where: { chatSessionId: session.id },
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: {
        senderType: true,
        messageType: true,
        body: true,
      },
    });
    const runtimePersona = this.buildCharacterRuntimePersonaContext(session.artist);
    runtimePersona.knowledgeContext = await this.loadApprovedArtistKnowledgeContext(
      session.artist.id,
    );

    try {
      const generated = await this.llmProvider.generate({
        sessionId: session.id,
        userId,
        userEmail: providerUserContext.userEmail,
        artist: session.artist,
        persona: session.chatPersona
          ? {
              id: session.chatPersona.id,
              name: session.chatPersona.name,
              systemPrompt: session.chatPersona.systemPrompt,
              safetyRules: session.chatPersona.safetyRules,
              modelConfig: session.chatPersona.modelConfig,
            }
          : null,
        runtimePersona,
        mode: order?.chatFeatureProduct.featureType ?? BASIC_CHAT_POLICY.mode,
        userMessage: body,
        recentMessages: recentMessages.reverse(),
        order: order
          ? {
              id: order.id,
              sku: order.chatFeatureProduct.sku,
              featureType: order.chatFeatureProduct.featureType,
              priceLumina: order.chatFeatureProduct.priceLumina,
            }
          : null,
      });

      return this.persistGeneratedMessage(userId, session.id, body, order?.id, generated);
    } catch (error) {
      if (order) {
        await this.failFeatureOrderAndRestoreLumina(
          userId,
          order.id,
          error instanceof ChatLlmProviderNotConfiguredError
            ? 'provider_not_configured'
            : 'generation_failed',
        );
      }

      if (error instanceof ChatLlmProviderNotConfiguredError) {
        throw this.providerUnavailableException(order?.chatFeatureProduct ?? null);
      }

      if (!order && error instanceof ChatLlmProviderRequestError) {
        const fallback = await this.persistGeneratedMessage(
          userId,
          session.id,
          body,
          undefined,
          this.llmProvider.fallbackResult(error),
        );

        return {
          ...fallback,
          generationStatus: 'fallback',
          requestId: error.requestId ?? null,
        };
      }

      throw new ServiceUnavailableException({
        code: 'CHAT_LLM_GENERATION_FAILED',
        message: 'Character chat generation failed',
        messageKey: 'chat.generation.failed',
        details: {
          generationStatus: 'failed',
          order: order ? this.orderSummary({ ...order, status: 'failed' }) : null,
          policy: {
            generation: this.chatGenerationPolicy(order?.chatFeatureProduct),
            failure: GENERATION_FAILURE_POLICY,
          },
        },
      });
    }
  }

  private async getOwnedSession(userId: string, sessionId: string) {
    const session = await this.prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId,
        status: 'active',
      },
    });

    if (!session) {
      throw new NotFoundException('Active chat session not found');
    }

    return session;
  }

  private openingGreetingSessionInclude() {
    return {
      artist: {
        select: {
          id: true,
          slug: true,
          displayName: true,
          publicProfile: {
            select: {
              publicMetadata: true,
              tagline: true,
              personalityKeywords: true,
            },
          },
          contentProfile: {
            select: {
              contentTone: true,
            },
          },
        },
      },
      chatPersona: true,
    };
  }

  private async getOwnedSessionForOpeningGreeting(
    userId: string,
    sessionId: string,
  ) {
    const session = await this.prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId,
        status: 'active',
      },
      include: this.openingGreetingSessionInclude(),
    });

    if (!session) {
      throw new NotFoundException('Active chat session not found');
    }

    return session;
  }

  private normalizeConversationBox(value: string | undefined): ChatConversationBox {
    if (!value) {
      return 'recent';
    }

    if (value === 'recent' || value === 'archive' || value === 'all') {
      return value;
    }

    throw new BadRequestException({
      code: 'CHAT_CONVERSATION_BOX_INVALID',
      message: 'box must be recent, archive, or all',
      messageKey: 'chat.conversations.invalidBox',
    });
  }

  private normalizeConversationTake(value: number | undefined) {
    if (value === undefined) {
      return CHAT_CONVERSATION_DEFAULT_TAKE;
    }

    if (!Number.isInteger(value) || value < 1) {
      throw new BadRequestException({
        code: 'CHAT_CONVERSATION_TAKE_INVALID',
        message: 'take must be a positive integer',
        messageKey: 'chat.conversations.invalidTake',
      });
    }

    return Math.min(value, CHAT_CONVERSATION_MAX_TAKE);
  }

  private normalizePremiumRoomTake(value: number | undefined) {
    if (value === undefined) {
      return PREMIUM_ROOM_DEFAULT_TAKE;
    }

    if (!Number.isInteger(value) || value < 1) {
      throw new BadRequestException({
        code: 'PREMIUM_CHAT_ROOM_TAKE_INVALID',
        message: 'take must be a positive integer',
        messageKey: 'chat.premiumRoom.invalidTake',
      });
    }

    return Math.min(value, PREMIUM_ROOM_MAX_TAKE);
  }

  private normalizePremiumRoomListStatus(value: string | undefined) {
    const normalized = value?.trim();

    if (!normalized || normalized === 'all') {
      return undefined;
    }

    if (!PREMIUM_ROOM_PUBLIC_LIST_STATUSES.includes(normalized)) {
      throw new BadRequestException({
        code: 'PREMIUM_CHAT_ROOM_STATUS_INVALID',
        message: 'status is not supported for public premium room list',
        messageKey: 'chat.premiumRoom.invalidStatus',
      });
    }

    return normalized;
  }

  private normalizeOptionalRoomCursor(value: string | undefined) {
    const cursor = value?.trim();

    if (!cursor) {
      return undefined;
    }

    if (!UUID_V4_PATTERN.test(cursor)) {
      throw new BadRequestException({
        code: 'PREMIUM_CHAT_ROOM_CURSOR_INVALID',
        message: 'cursor must be a room UUID',
        messageKey: 'chat.premiumRoom.invalidCursor',
      });
    }

    return cursor;
  }

  private conversationListWhere(userId: string, box: ChatConversationBox) {
    const where: {
      userId: string;
      status?: string | { in: string[] };
    } = { userId };

    if (box === 'recent') {
      where.status = 'active';
    } else if (box === 'archive') {
      where.status = 'archived';
    } else {
      where.status = { in: ['active', 'archived'] };
    }

    return where;
  }

  private conversationListInclude() {
    return {
      artist: {
        select: { id: true, slug: true, displayName: true },
      },
      chatPersona: {
        select: { id: true, name: true, status: true },
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          senderType: true,
          messageType: true,
          body: true,
          chatFeatureOrderId: true,
          createdAt: true,
        },
      },
      _count: {
        select: { messages: true },
      },
    } as const;
  }

  private premiumRoomInclude() {
    return {
      artist: {
        select: {
          id: true,
          slug: true,
          displayName: true,
        },
      },
      owner: {
        select: {
          profile: {
            select: {
              displayName: true,
              publicHandle: true,
            },
          },
        },
      },
    } as const;
  }

  private toPremiumRoomListItem(room: any) {
    const status = this.normalizePremiumRoomStatus(room.status);
    const availability = this.premiumRoomReadAvailability(status);

    return {
      roomId: room.id,
      artist: this.toPremiumRoomArtist(room.artist),
      tier: {
        tierKey: room.tierKey,
        amountLumina: room.amountLumina?.toString?.() ?? String(room.amountLumina),
        labelKey: `chat.premiumRoom.tier.${room.tierKey}`,
      },
      roomStatus: status,
      statusKey: status,
      statusLabelKey: this.premiumRoomStatusLabelKey(status),
      readMode: availability.readMode,
      openedAt: this.isoStringOrNull(room.openedAt),
      expiresAt: this.isoStringOrNull(room.expiresAt),
      remaining: {
        units: room.remainingUnits ?? null,
        nearExpiry: this.isPremiumRoomNearExpiry(room.expiresAt),
      },
      viewerCta: {
        enabled: false,
        reasonKey: 'chat.premiumRoom.readOnlyStorageOnly',
      },
      donationAvailability: this.premiumRoomDonationAvailability(status),
      policy: {
        projection: 'premium_room_list_item_v1',
        rawChatBodyReturned: false,
        walletMutation: false,
        settlementMutation: false,
        payoutMutation: false,
      },
    };
  }

  private toPremiumRoomDetail(room: any, viewerRole: 'owner_user' | 'artist_operator') {
    const status = this.normalizePremiumRoomStatus(room.status);
    const availability = this.premiumRoomReadAvailability(status);
    const generatedAt = new Date().toISOString();

    return {
      room: this.toPremiumRoomListItem(room),
      premiumRoomStatus: {
        roomId: room.id,
        viewerRole,
        roomStatus: status,
        statusKey: status,
        statusLabelKey: this.premiumRoomStatusLabelKey(status),
        readMode: availability.readMode,
        generatedAt,
        timestamps: {
          openedAt: this.isoStringOrNull(room.openedAt),
          expiresAt: this.isoStringOrNull(room.expiresAt),
          lastUserMessageAt: this.isoStringOrNull(room.lastUserMessageAt),
          lastArtistReplyAt: this.isoStringOrNull(room.lastArtistReplyAt),
          lastSupportAt: this.isoStringOrNull(room.lastSupportAt),
          closedAt: this.isoStringOrNull(room.closedAt),
        },
        answerState: this.premiumRoomAnswerState(room),
        nearExpiry: this.isPremiumRoomNearExpiry(room.expiresAt),
      },
      premiumRoomRefundStatus: {
        eligible: status === 'refund_pending',
        statusKey: status === 'refund_pending' ? 'refund_candidate' : 'not_eligible',
        reasonKey:
          status === 'refund_pending'
            ? 'unanswered_24h_full_refund'
            : 'chat.premiumRoom.refund.notEligible',
        refundCandidateAt: this.isoStringOrNull(room.refundCandidateAt),
        refundMutationEnabled: false,
        walletCreditMutationEnabled: false,
      },
      premiumRoomReportStatus: {
        reported: Boolean(room.reportedAt) || ['reported', 'blind', 'blinded'].includes(status),
        adminReview: Boolean(room.adminReviewAt) || status === 'admin_review',
        reportedAt: this.isoStringOrNull(room.reportedAt),
        adminReviewAt: this.isoStringOrNull(room.adminReviewAt),
        reportMutationEnabled: false,
        rawReportReasonReturned: false,
      },
      premiumRoomMutationAvailability: {
        canSendMessage: false,
        canArtistReply: false,
        canDonate: false,
        canReport: false,
        canRequestRefund: false,
        disabledReasonKey: availability.disabledReasonKey,
        futureAvailability: availability.futureAvailability,
        walletMutationEnabled: false,
        settlementMutationEnabled: false,
        payoutMutationEnabled: false,
      },
      counterparty:
        viewerRole === 'artist_operator'
          ? {
              displayName:
                room.owner?.profile?.displayName ??
                room.owner?.profile?.publicHandle ??
                'Lumina User',
              publicHandle: room.owner?.profile?.publicHandle ?? null,
            }
          : null,
      policy: this.premiumRoomReadPolicy(
        viewerRole === 'owner_user' ? 'owner_room_status' : 'artist_room_status',
      ),
    };
  }

  private toPremiumRoomArtist(artist: { id: string; slug: string; displayName: string }) {
    return {
      id: artist.id,
      slug: artist.slug,
      displayName: artist.displayName,
    };
  }

  private normalizePremiumRoomStatus(value: string) {
    return (PREMIUM_ROOM_READ_STATUSES as readonly string[]).includes(value)
      ? value
      : 'admin_review';
  }

  private premiumRoomReadAvailability(status: string) {
    if ((PREMIUM_ROOM_ARCHIVE_STATUSES as readonly string[]).includes(status)) {
      return {
        readMode: 'safe_archive',
        disabledReasonKey: `chat.premiumRoom.${status}.locked`,
        futureAvailability: {
          canSendMessage: false,
          canArtistReply: false,
          canDonate: false,
        },
      };
    }

    if ((PREMIUM_ROOM_SAFE_STATUS_ONLY_STATUSES as readonly string[]).includes(status)) {
      return {
        readMode: 'safe_status_only',
        disabledReasonKey: `chat.premiumRoom.${status}.locked`,
        futureAvailability: {
          canSendMessage: false,
          canArtistReply: false,
          canDonate: false,
        },
      };
    }

    return {
      readMode: 'safe_conversation',
      disabledReasonKey: 'chat.premiumRoom.readOnlyStorageOnly',
      futureAvailability: {
        canSendMessage: true,
        canArtistReply: true,
        canDonate: true,
      },
    };
  }

  private premiumRoomDonationAvailability(status: string) {
    const availability = this.premiumRoomReadAvailability(status);

    return {
      enabled: false,
      allowedByStatus: availability.futureAvailability.canDonate,
      disabledReasonKey: availability.disabledReasonKey,
      walletLookupRequired: false,
    };
  }

  private premiumRoomAnswerState(room: any) {
    if (room.lastArtistReplyAt) {
      return {
        state: 'replied',
        stateKey: 'replied',
        labelKey: 'chat.premiumRoom.answer.replied',
      };
    }

    if (room.refundCandidateAt || room.status === 'refund_pending') {
      return {
        state: 'overdue_24h',
        stateKey: 'overdue_24h',
        labelKey: 'chat.premiumRoom.answer.overdue24h',
      };
    }

    return {
      state: 'needs_reply',
      stateKey: 'needs_reply',
      labelKey: 'chat.premiumRoom.answer.needsReply',
    };
  }

  private premiumRoomStatusLabelKey(status: string) {
    return `chat.premiumRoom.status.${status.replace(/_/g, '.')}`;
  }

  private premiumRoomReadPolicy(surface: string) {
    return {
      surface,
      version: '2026-06-05.premium-chat-room-status-projection.v1',
      readOnly: true,
      visiblePublicStatuses: PREMIUM_ROOM_PUBLIC_LIST_STATUSES,
      ownerArtistStatusOnlyStatuses: PREMIUM_ROOM_SAFE_STATUS_ONLY_STATUSES,
      archiveStatuses: PREMIUM_ROOM_ARCHIVE_STATUSES,
      publicListExcludesOwnerArtistStates: true,
      rawChatBodyReturned: false,
      rawReportReasonReturned: false,
      rawAdminNoteReturned: false,
      rawWalletLedgerIdReturned: false,
      rawSupportPointLedgerIdReturned: false,
      rawConversationMeterLedgerIdReturned: false,
      tokenReturned: false,
      cookieReturned: false,
      walletMutation: false,
      luminaMutation: false,
      donationMutation: false,
      reportMutation: false,
      refundMutation: false,
      settlementMutation: false,
      payoutMutation: false,
    };
  }

  private assertPremiumRoomId(roomId: string) {
    if (!UUID_V4_PATTERN.test(roomId)) {
      throw new BadRequestException({
        code: 'PREMIUM_CHAT_ROOM_INVALID_ID',
        message: 'roomId must be a UUID v4',
        messageKey: 'chat.premiumRoom.invalidId',
      });
    }
  }

  private premiumRoomNotFound() {
    return new NotFoundException({
      code: 'PREMIUM_CHAT_ROOM_NOT_FOUND',
      message: 'Premium chat room not found',
      messageKey: 'chat.premiumRoom.notFound',
    });
  }

  private isPremiumRoomNearExpiry(expiresAt: Date | null | undefined) {
    if (!expiresAt) {
      return false;
    }

    const diff = expiresAt.getTime() - Date.now();

    return diff > 0 && diff <= PREMIUM_ROOM_NEAR_EXPIRY_WINDOW_MS;
  }

  private isoStringOrNull(value: Date | string | null | undefined) {
    if (!value) {
      return null;
    }

    return value instanceof Date ? value.toISOString() : value;
  }

  private async mutateConversationStatus(
    userId: string,
    sessionId: string,
    action: ChatConversationStatusMutation,
  ) {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: this.validateConversationId(sessionId), userId },
      include: this.conversationListInclude(),
    });

    if (!session) {
      throw new NotFoundException('Chat conversation not found');
    }

    if (!CHAT_CONVERSATION_MUTABLE_STATUSES.has(session.status)) {
      throw new BadRequestException({
        code: 'CHAT_CONVERSATION_STATUS_TRANSITION_INVALID',
        message: 'chat conversation can only move between active and archived',
        messageKey: 'chat.conversations.invalidStatusTransition',
        status: session.status,
      });
    }

    const targetStatus = action === 'archive' ? 'archived' : 'active';
    const changed = session.status !== targetStatus;
    const nextSession = changed
      ? await this.prisma.chatSession.update({
          where: { id: session.id },
          data: { status: targetStatus },
          include: this.conversationListInclude(),
        })
      : session;

    return this.presentConversationMutation(action, nextSession, changed);
  }

  private presentConversationMutation(
    action: ChatConversationStatusMutation,
    session: ChatConversationListSessionRecord,
    changed: boolean,
  ) {
    const targetStatus = action === 'archive' ? 'archived' : 'active';
    const targetBox = targetStatus === 'archived' ? 'archive' : 'recent';

    return {
      ownerOnly: true,
      idempotent: true,
      action,
      changed,
      targetStatus,
      targetBox,
      conversation: this.presentConversationListItem(session),
      listImpact: {
        recent: targetStatus === 'active',
        archive: targetStatus === 'archived',
        all: true,
      },
      safety: {
        llmCall: false,
        walletMutation: false,
        messageMutation: false,
        orderMutation: false,
        settlementMutation: false,
        secretsReturned: false,
      },
    };
  }

  private presentConversationListItem(session: ChatConversationListSessionRecord) {
    const lastMessage = session.messages[0] ?? null;
    const presentedLastMessage = lastMessage
      ? this.presentConversationLastMessage(lastMessage)
      : null;
    const latestAt = lastMessage?.createdAt ?? session.updatedAt;

    return {
      id: session.id,
      box: session.status === 'archived' ? 'archive' : 'recent',
      status: session.status,
      artist: session.artist,
      persona: session.chatPersona
        ? {
            id: session.chatPersona.id,
            name: session.chatPersona.name,
            status: session.chatPersona.status,
          }
        : null,
      messageCount: session._count.messages,
      lastMessage: presentedLastMessage,
      lastMessageAt: lastMessage?.createdAt ?? null,
      latestMessage: presentedLastMessage,
      latestAt,
      lastActivityAt: latestAt,
      updatedAt: session.updatedAt,
      createdAt: session.createdAt,
      readState: {
        supported: false,
        status: 'not_tracked',
        hasUnread: false,
        unreadCount: null,
        lastReadAt: null,
        badgeVisible: false,
        source: 'not_persisted',
        messageKey: 'chat.conversations.readStateNotAvailable',
      },
    };
  }

  private presentConversationLastMessage(
    lastMessage: ChatConversationListSessionRecord['messages'][number],
  ) {
    const bodyPreview = this.bodyPreview(lastMessage.body);
    const previewMessageKey = this.conversationPreviewMessageKey(
      lastMessage.messageType,
      bodyPreview,
    );

    return {
      id: lastMessage.id,
      senderType: lastMessage.senderType,
      messageType: lastMessage.messageType,
      bodyPreview,
      previewMessageKey,
      previewAvailable: Boolean(bodyPreview),
      createdAt: lastMessage.createdAt,
      paidFeatureOrderPresent: Boolean(lastMessage.chatFeatureOrderId),
    };
  }

  private conversationPreviewMessageKey(
    messageType: string,
    bodyPreview: string | null,
  ) {
    if (messageType === 'pending_provider' || messageType === 'provider_pending') {
      return 'chat.conversations.latestMessage.pendingProvider';
    }

    if (messageType === 'provider_error' || messageType === 'generation_failed') {
      return 'chat.conversations.latestMessage.providerFailed';
    }

    if (!bodyPreview) {
      return 'chat.conversations.latestMessage.empty';
    }

    return null;
  }

  private bodyPreview(value: string | null) {
    if (!value) {
      return null;
    }

    const collapsed = value.replace(/\s+/g, ' ').trim();
    return collapsed.length > CHAT_CONVERSATION_LAST_MESSAGE_PREVIEW_MAX_CHARS
      ? `${collapsed.slice(0, CHAT_CONVERSATION_LAST_MESSAGE_PREVIEW_MAX_CHARS - 3)}...`
      : collapsed;
  }

  private conversationEmptyState(box: ChatConversationBox) {
    if (box === 'archive') {
      return {
        messageKey: 'chat.conversations.emptyArchive',
        defaultMessageKo: '\uBCF4\uAD00\uD55C \uB300\uD654\uAC00 \uC5C6\uC5B4\uC694.',
      };
    }

    if (box === 'all') {
      return {
        messageKey: 'chat.conversations.emptyAll',
        defaultMessageKo:
          '\uC544\uC9C1 \uC2DC\uC791\uD558\uAC70\uB098 \uBCF4\uAD00\uD55C \uB300\uD654\uAC00 \uC5C6\uC5B4\uC694.',
      };
    }

    return {
      messageKey: 'chat.conversations.emptyRecent',
      defaultMessageKo:
        '\uC544\uC9C1 \uC2DC\uC791\uD55C \uB300\uD654\uAC00 \uC5C6\uC5B4\uC694.',
    };
  }

  private paginate<T extends { id: string }>(rows: T[], take: number) {
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const lastItem = items.at(-1);

    return {
      items,
      hasMore,
      nextCursor: hasMore && lastItem ? lastItem.id : null,
    };
  }

  private validateCursor(value: string) {
    if (!UUID_V4_PATTERN.test(value)) {
      throw new BadRequestException({
        code: 'CHAT_CONVERSATION_CURSOR_INVALID',
        message: 'cursor must be a UUID v4',
        messageKey: 'chat.conversations.invalidCursor',
      });
    }

    return value;
  }

  private validateConversationId(value: string) {
    if (!UUID_V4_PATTERN.test(value)) {
      throw new BadRequestException({
        code: 'CHAT_CONVERSATION_ID_INVALID',
        message: 'conversation id must be a UUID v4',
        messageKey: 'chat.conversations.invalidConversationId',
      });
    }

    return value;
  }

  private async getOwnedSessionForGeneration(userId: string, sessionId: string) {
    const session = await this.prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId,
        status: 'active',
      },
      include: {
        artist: {
          select: {
            id: true,
            slug: true,
            displayName: true,
            publicProfile: {
              select: {
                publicMetadata: true,
                tagline: true,
                personalityKeywords: true,
              },
            },
            contentProfile: {
              select: {
                contentTone: true,
              },
            },
          },
        },
        chatPersona: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Active chat session not found');
    }

    return session;
  }

  private async getFeatureOrderForGeneration(
    userId: string,
    sessionId: string,
    orderId: string,
  ) {
    const order = await this.prisma.chatFeatureOrder.findFirst({
      where: {
        id: orderId,
        userId,
        chatSessionId: sessionId,
      },
      include: {
        walletLedger: true,
        chatFeatureProduct: true,
        messages: {
          where: { senderType: 'artist' },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!order) {
      throw new BadRequestException('Chat feature order not found for this session');
    }

    if (order.status === 'failed') {
      throw new BadRequestException('Chat feature order is already failed');
    }

    if (order.status !== 'completed') {
      throw new BadRequestException('Completed chat feature order is required');
    }

    return order;
  }

  private async buildBasicChatPreflight(
    userId: string,
    session: { id: string; artistId: string },
    body: string,
    mode: string,
    providerUserContext?: ChatProviderUserContext,
  ) {
    const now = new Date();
    const todayStart = this.koreaServiceDayStartUtc(now);
    const cooldownCutoff = new Date(
      now.getTime() - BASIC_CHAT_POLICY.cooldownSeconds * 1000,
    );
    const [lastFreeMessage, dailyUsed, providerOpsStats, readiness] =
      await Promise.all([
        this.prisma.chatMessage.findFirst({
          where: {
            senderType: 'user',
            chatFeatureOrderId: null,
            createdAt: { gte: cooldownCutoff },
            chatSession: {
              userId,
              artistId: session.artistId,
            },
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true, createdAt: true },
        }),
        this.prisma.chatMessage.count({
          where: {
            senderType: 'user',
            chatFeatureOrderId: null,
            createdAt: { gte: todayStart },
            chatSession: {
              userId,
              artistId: session.artistId,
            },
          },
        }),
        this.providerOpsStatsForUser(userId, todayStart),
        this.providerReadinessForUser(userId, providerUserContext),
      ]);
    const cooldownRemainingSeconds = lastFreeMessage
      ? Math.max(
          0,
          Math.ceil(
            (BASIC_CHAT_POLICY.cooldownSeconds * 1000 -
              (now.getTime() - lastFreeMessage.createdAt.getTime())) /
              1000,
          ),
        )
      : 0;
    const dailyRemaining = Math.max(0, BASIC_CHAT_POLICY.dailyLimit - dailyUsed);
    const blockReason =
      cooldownRemainingSeconds > 0
        ? BASIC_CHAT_BLOCK_REASONS.cooldownActive
        : dailyUsed >= BASIC_CHAT_POLICY.dailyLimit
          ? BASIC_CHAT_BLOCK_REASONS.dailyLimitReached
          : providerOpsStats.totalResponses >=
              CHAT_LLM_OPS_GUARD_POLICY.providerDailyRequestLimit
            ? BASIC_CHAT_BLOCK_REASONS.dailyLimitReached
            : providerOpsStats.failureCount >=
                CHAT_LLM_OPS_GUARD_POLICY.providerDailyFailureLimit
              ? BASIC_CHAT_BLOCK_REASONS.providerFailureLimitReached
              : !readiness.configured
                ? {
                    reason: readiness.status,
                    code: 'CHAT_LLM_PROVIDER_NOT_CONFIGURED',
                    messageKey: readiness.messageKey,
                    fallbackCopyKo:
                      CHAT_GENERATION_DISABLED_REASONS.providerNotConfigured
                        .displayMessageKo,
                  }
                : null;
    const generationPolicy = this.chatGenerationPolicy(null, readiness);
    const providerDailyRemaining = Math.max(
      0,
      CHAT_LLM_OPS_GUARD_POLICY.providerDailyRequestLimit -
        providerOpsStats.totalResponses,
    );
    const providerFailureRemaining = Math.max(
      0,
      CHAT_LLM_OPS_GUARD_POLICY.providerDailyFailureLimit -
        providerOpsStats.failureCount,
    );

    return {
      canSend: !blockReason,
      canGenerate: !blockReason,
      mode,
      bodyLength: body.length,
      limits: {
        cooldownSeconds: BASIC_CHAT_POLICY.cooldownSeconds,
        cooldownRemainingSeconds,
        dailyLimit: BASIC_CHAT_POLICY.dailyLimit,
        dailyUsed,
        dailyRemaining,
        providerDailyLimit: CHAT_LLM_OPS_GUARD_POLICY.providerDailyRequestLimit,
        providerDailyUsed: providerOpsStats.totalResponses,
        providerDailyRemaining,
        providerDailyFailureLimit:
          CHAT_LLM_OPS_GUARD_POLICY.providerDailyFailureLimit,
        providerDailyFailureCount: providerOpsStats.failureCount,
        providerDailyFailureRemaining: providerFailureRemaining,
        serviceDayTimeZone: KOREA_SERVICE_DAY_TIME_ZONE,
        serviceDayStartAt: todayStart.toISOString(),
        maxInputChars: BASIC_CHAT_POLICY.maxInputChars,
        estimatedCostCeilingKrw: BASIC_CHAT_POLICY.estimatedCostCeilingKrw,
      },
      provider: this.providerDetails(readiness),
      providerOps: {
        policy: CHAT_LLM_OPS_GUARD_POLICY,
        usageByModel: providerOpsStats.usageByModel,
        fallbackCount: providerOpsStats.fallbackCount,
        estimatedCostKrw: providerOpsStats.estimatedCostKrw,
      },
      disabledReason: blockReason?.reason ?? null,
      messageKey: blockReason?.messageKey ?? null,
      fallbackCopyKo: blockReason?.fallbackCopyKo ?? null,
      walletMutation: false,
      settlementEligible: false,
      policy: {
        generation: generationPolicy,
        settlement: null,
        failure: GENERATION_FAILURE_POLICY,
      },
    };
  }

  private koreaServiceDayStartUtc(now: Date) {
    const koreaTime = new Date(now.getTime() + KOREA_SERVICE_DAY_OFFSET_MS);
    koreaTime.setUTCHours(0, 0, 0, 0);

    return new Date(koreaTime.getTime() - KOREA_SERVICE_DAY_OFFSET_MS);
  }

  private isProviderUnavailableReason(reason: string | null) {
    return (
      reason === 'provider_disabled' ||
      reason === 'provider_not_configured' ||
      reason === 'provider_not_allowed'
    );
  }

  private basicChatPreflightException(
    preflight: Awaited<ReturnType<ChatService['buildBasicChatPreflight']>>,
  ) {
    if (this.isProviderUnavailableReason(preflight.disabledReason)) {
      return this.providerUnavailableException(null, preflight);
    }

    const blockReason =
      preflight.disabledReason === BASIC_CHAT_BLOCK_REASONS.cooldownActive.reason
        ? BASIC_CHAT_BLOCK_REASONS.cooldownActive
        : preflight.disabledReason ===
            BASIC_CHAT_BLOCK_REASONS.dailyLimitReached.reason
          ? BASIC_CHAT_BLOCK_REASONS.dailyLimitReached
          : preflight.disabledReason ===
              BASIC_CHAT_BLOCK_REASONS.providerFailureLimitReached.reason
            ? BASIC_CHAT_BLOCK_REASONS.providerFailureLimitReached
            : BASIC_CHAT_BLOCK_REASONS.invalidBody;

    return new BadRequestException({
      code: blockReason.code,
      message: blockReason.fallbackCopyKo,
      messageKey: blockReason.messageKey,
      fallbackCopyKo: blockReason.fallbackCopyKo,
      details: {
        preflight,
      },
    });
  }

  private async persistGeneratedMessage(
    userId: string,
    sessionId: string,
    userMessageBody: string,
    chatFeatureOrderId: string | undefined,
    generated: ChatGenerationResult,
  ) {
    const usageRecordedAt = new Date().toISOString();

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const userMessage = await tx.chatMessage.create({
        data: {
          chatSessionId: sessionId,
          senderType: 'user',
          messageType: 'text',
          body: userMessageBody,
          chatFeatureOrderId,
        },
      });
      const aiMessage = await tx.chatMessage.create({
        data: {
          chatSessionId: sessionId,
          senderType: 'artist',
          messageType: 'text',
          body: generated.body,
          chatFeatureOrderId,
          modelMetadata: this.inputJson({
            usageSchemaVersion: '2026-05-14.chat-provider-usage-v1',
            provider: generated.usage.provider,
            model: generated.usage.model,
            usage: generated.usage,
            estimatedCostKrw: generated.usage.estimatedCostKrw,
            usageRecordedAt,
            opsGuard: {
              policyVersion: CHAT_LLM_OPS_GUARD_POLICY.policyVersion,
              serviceDayTimeZone: KOREA_SERVICE_DAY_TIME_ZONE,
              countedForDailyLimit: !chatFeatureOrderId,
            },
          }),
          safetyMetadata: this.inputJson(generated.safetyMetadata),
        },
      });

      await tx.chatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });

      return {
        generationStatus: 'completed',
        order: chatFeatureOrderId ? { id: chatFeatureOrderId, status: 'completed' } : null,
        userMessage,
        message: aiMessage,
        usage: generated.usage,
      };
    });
  }

  private async failFeatureOrderAndRestoreLumina(
    userId: string,
    orderId: string,
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const order = await tx.chatFeatureOrder.findFirst({
        where: { id: orderId, userId },
        include: { walletLedger: true },
      });

      if (!order || order.status === 'failed') {
        return order;
      }

      const failedOrderUpdate = await tx.chatFeatureOrder.updateMany({
        where: {
          id: order.id,
          userId,
          status: { not: GENERATION_FAILURE_POLICY.orderFailureStatus },
        },
        data: {
          status: GENERATION_FAILURE_POLICY.orderFailureStatus,
          updatedAt: new Date(),
        },
      });

      if (failedOrderUpdate.count !== 1) {
        return order;
      }

      const failedOrder = {
        ...order,
        status: GENERATION_FAILURE_POLICY.orderFailureStatus,
      };

      if (!order.walletLedger) {
        return failedOrder;
      }

      const refundIdempotencyKey = `chat-feature-refund:${order.id}`;
      const existingRefund = await tx.walletLedger.findUnique({
        where: { idempotencyKey: refundIdempotencyKey },
      });

      if (!existingRefund) {
        await tx.walletAccount.update({
          where: { id: order.walletLedger.walletAccountId },
          data: { cachedBalance: { increment: order.walletLedger.amount } },
        });
        await tx.walletLedger.create({
          data: {
            walletAccountId: order.walletLedger.walletAccountId,
            direction: 'credit',
            amount: order.walletLedger.amount,
            ledgerType: GENERATION_FAILURE_POLICY.walletRecoveryLedgerType,
            referenceType: GENERATION_FAILURE_POLICY.walletRecoveryReferenceType,
            referenceId: order.id,
            idempotencyKey: refundIdempotencyKey,
            memo: `Chat feature generation failed: ${reason}`,
          },
        });
      }

      return failedOrder;
    });
  }

  private assertIdempotentFeatureOrderReplay(
    order: {
      userId: string;
      chatSessionId: string;
      chatFeatureProductId: string;
    },
    expected: {
      userId: string;
      chatSessionId: string;
      chatFeatureProductId: string;
    },
  ) {
    if (
      order.userId === expected.userId &&
      order.chatSessionId === expected.chatSessionId &&
      order.chatFeatureProductId === expected.chatFeatureProductId
    ) {
      return;
    }

    throw new BadRequestException({
      ...CHAT_FEATURE_ORDER_CONFLICT,
      message: CHAT_FEATURE_ORDER_CONFLICT.fallbackCopyKo,
      walletMutation: false,
    });
  }

  private assertCanCreateFeatureOrder(
    product: {
      id: string;
      sku: string;
      featureType: string;
      metadata: unknown;
      status?: string;
    },
    readiness: ChatLlmProviderReadiness,
  ) {
    const generationPolicy = this.chatGenerationPolicy(product, readiness);

    if (generationPolicy.canCreatePaidOrder) {
      return;
    }

    if (this.isProviderUnavailableReason(generationPolicy.disabledReason)) {
      throw this.providerUnavailableException(product, undefined, readiness);
    }

    throw this.chatFeatureProductLockedException(product, readiness);
  }

  private chatFeatureProductLockedException(
    product: {
      id: string;
      sku: string;
      featureType: string;
      metadata: unknown;
      status?: string;
    },
    readiness: ChatLlmProviderReadiness,
  ) {
    return new BadRequestException({
      ...CHAT_FEATURE_PRODUCT_LOCKED,
      message: CHAT_FEATURE_PRODUCT_LOCKED.fallbackCopyKo,
      walletMutation: false,
      details: {
        product: this.productSummary(product),
        policy: {
          generation: this.chatGenerationPolicy(product, readiness),
          settlement: this.chatSettlementPolicy(product),
          failure: GENERATION_FAILURE_POLICY,
        },
      },
    });
  }

  private providerUnavailableException(
    product: {
      id: string;
      sku: string;
      featureType: string;
      metadata: unknown;
    } | null,
    preflight?: Awaited<ReturnType<ChatService['buildBasicChatPreflight']>>,
    readinessOverride?: ChatLlmProviderReadiness,
  ) {
    const readiness = preflight
      ? ({
          provider: preflight.provider.name,
          configured: preflight.provider.configured,
          status: preflight.provider.status,
          messageKey:
            preflight.messageKey ??
            CHAT_GENERATION_DISABLED_REASONS.providerNotConfigured.messageKey,
        } satisfies ChatLlmProviderReadiness)
      : (readinessOverride ?? this.llmProvider.readiness());

    return new ServiceUnavailableException({
      code: 'CHAT_LLM_PROVIDER_NOT_CONFIGURED',
      message: 'Character chat generation provider is not configured',
      messageKey: readiness.messageKey,
      fallbackCopyKo:
        CHAT_GENERATION_DISABLED_REASONS.providerNotConfigured.displayMessageKo,
      walletMutation: false,
      details: {
        generationStatus: readiness.status,
        provider: this.providerDetails(readiness),
        product: product ? this.productSummary(product) : null,
        preflight: preflight ?? null,
        policy: {
          generation: this.chatGenerationPolicy(product),
          settlement: product ? this.chatSettlementPolicy(product) : null,
          failure: GENERATION_FAILURE_POLICY,
        },
      },
    });
  }

  private chatGenerationPolicy(product?: {
    sku?: string;
    featureType: string;
    metadata: unknown;
    status?: string;
  } | null, readinessOverride?: ChatLlmProviderReadiness) {
    const readiness = readinessOverride ?? this.llmProvider.readiness();
    const productPolicy = product ? this.chatFeatureProductPolicy(product) : null;
    const providerRequired = product
      ? productPolicy?.providerRequired ?? this.requiresLlmGeneration(product)
      : true;
    const mvpLocked = productPolicy?.mvpLocked ?? false;
    const providerUnavailable = providerRequired && !readiness.configured;
    const disabledReason = mvpLocked
      ? CHAT_GENERATION_DISABLED_REASONS.mvpLocked
      : providerUnavailable
        ? CHAT_GENERATION_DISABLED_REASONS.providerNotConfigured
        : null;
    const canGenerate = !mvpLocked && !providerUnavailable;
    const canCreatePaidOrder = product ? canGenerate : false;
    const modelTier = productPolicy?.modelTier ?? BASIC_CHAT_POLICY.modelTier;

    return {
      mode: product?.featureType ?? BASIC_CHAT_POLICY.mode,
      provider: this.providerDetails(readiness),
      canGenerate,
      canCreatePaidOrder,
      disabledReason: disabledReason?.reason ?? null,
      disabledMessageKey: disabledReason?.messageKey ?? null,
      disabledDisplayMessageKo: disabledReason?.displayMessageKo ?? null,
      generationStatus: canGenerate ? 'ready' : disabledReason?.reason ?? readiness.status,
      modelTier,
      orderFlow: productPolicy?.orderFlow ?? 'basic_chat',
      generationMode: productPolicy?.generationMode ?? BASIC_CHAT_POLICY.mode,
      providerRequired,
      requiresPreview: product ? productPolicy?.requiresPreview ?? true : false,
      maxInputChars: productPolicy?.maxInputChars ?? BASIC_CHAT_POLICY.maxInputChars,
      cooldownSeconds:
        productPolicy?.cooldownSeconds ?? BASIC_CHAT_POLICY.cooldownSeconds,
      dailyLimit: productPolicy?.dailyLimit ?? BASIC_CHAT_POLICY.dailyLimit,
      estimatedCostCeilingKrw:
        productPolicy?.estimatedCostCeilingKrw ??
        BASIC_CHAT_POLICY.estimatedCostCeilingKrw,
      usageMetadataPath: 'chat_messages.model_metadata',
      safetyMetadataPath: 'chat_messages.safety_metadata',
    };
  }

  private productSummary(product: {
    id: string;
    sku: string;
    name?: string;
    featureType: string;
    priceLumina?: unknown;
    status?: string;
    metadata: unknown;
  }) {
    const productPolicy = this.chatFeatureProductPolicy(product);

    return {
      id: product.id,
      sku: product.sku,
      featureType: product.featureType,
      displayName: productPolicy.displayName,
      modelTier: productPolicy.modelTier,
      orderFlow: productPolicy.orderFlow,
      generationMode: productPolicy.generationMode,
    };
  }

  private chatFeatureProductResponse(product: {
    id: string;
    sku: string;
    name: string;
    featureType: string;
    priceLumina: unknown;
    status: string;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const productPolicy = this.chatFeatureProductPolicy(product);

    return {
      ...product,
      displayName: productPolicy.displayName,
      description: productPolicy.description,
      modelTier: productPolicy.modelTier,
      policy: {
        product: productPolicy,
        settlement: this.chatSettlementPolicy(product),
        generation: this.chatGenerationPolicy(product),
        failure: GENERATION_FAILURE_POLICY,
      },
    };
  }

  private chatFeatureProductPolicy(product: {
    sku?: string;
    name?: string;
    featureType: string;
    priceLumina?: unknown;
    status?: string;
    metadata: unknown;
  }) {
    const metadata = this.recordOrEmpty(product.metadata);
    const configuredPolicy = findChatFeatureProductPolicy({
      sku: product.sku,
      featureType: product.featureType,
    });
    const metadataMvpLocked = metadata.mvpLocked === true;
    const policyStatus = configuredPolicy?.status ?? product.status ?? 'active';
    const mvpLocked =
      metadataMvpLocked || configuredPolicy?.mvpLocked === true || policyStatus !== 'active';
    const displayName =
      this.stringFromUnknown(metadata.displayNameKo) ??
      configuredPolicy?.displayNameKo ??
      product.name ??
      product.featureType;
    const description =
      this.stringFromUnknown(metadata.descriptionKo) ??
      configuredPolicy?.descriptionKo ??
      null;
    const settlementEligible =
      metadata.settlementEligible === false
        ? false
        : configuredPolicy?.settlementEligible ?? true;
    const creatorShareEligible =
      metadata.creatorShareEligible === false
        ? false
        : configuredPolicy?.creatorShareEligible ?? settlementEligible;
    const modelTier =
      this.stringFromUnknown(metadata.modelTier) ??
      configuredPolicy?.modelTier ??
      'mini';

    return {
      sku: product.sku ?? configuredPolicy?.sku ?? null,
      featureType: product.featureType,
      displayName,
      description,
      priceLumina: product.priceLumina ?? configuredPolicy?.priceLumina ?? null,
      status: product.status ?? configuredPolicy?.status ?? 'active',
      modelTier,
      orderFlow: configuredPolicy?.orderFlow ?? 'paid_generation',
      generationMode: configuredPolicy?.generationMode ?? 'inline_reply',
      providerRequired:
        configuredPolicy?.providerRequired ?? this.requiresLlmGeneration(product),
      requiresPreview: configuredPolicy?.requiresPreview ?? true,
      mvpLocked,
      settlementEligible,
      creatorShareEligible,
      settlementSource:
        this.stringFromUnknown(metadata.settlementSource) ??
        configuredPolicy?.settlementSource ??
        'chat',
      maxInputChars: configuredPolicy?.maxInputChars ?? 2000,
      cooldownSeconds: configuredPolicy?.cooldownSeconds ?? 0,
      dailyLimit: configuredPolicy?.dailyLimit ?? null,
      estimatedCostCeilingKrw:
        configuredPolicy?.estimatedCostCeilingKrw ??
        this.estimatedPaidCostCeiling(modelTier),
      refundOnGenerationFailure:
        configuredPolicy?.refundOnGenerationFailure ??
        GENERATION_FAILURE_POLICY.refundOnGenerationFailure,
    };
  }

  private chatSettlementPolicy(product: {
    sku?: string;
    featureType: string;
    metadata: unknown;
  }) {
    const productPolicy = this.chatFeatureProductPolicy(product);

    return {
      eligible: productPolicy.settlementEligible,
      creatorShareEligible: productPolicy.creatorShareEligible,
      source: productPolicy.settlementSource,
      eventType: productPolicy.creatorShareEligible
        ? productPolicy.settlementSource ?? 'chat'
        : null,
      freeBasicExcluded: true,
      finalPayoutRequiresSettlementRun: true,
    };
  }

  private orderSummary(order: {
    id: string;
    status: string;
    chatFeatureProduct?: {
      sku: string;
      featureType: string;
    };
  }) {
    return {
      id: order.id,
      status: order.status,
      sku: order.chatFeatureProduct?.sku,
      featureType: order.chatFeatureProduct?.featureType,
    };
  }

  private async providerReadinessForUser(
    userId: string,
    providerUserContext?: ChatProviderUserContext,
  ) {
    const context = providerUserContext ?? (await this.getProviderUserContext(userId));

    return this.llmProvider.readiness({
      userId: context.userId,
      userEmail: context.userEmail,
    });
  }

  private async providerOpsStatsForUser(
    userId: string,
    todayStart: Date,
  ): Promise<ChatProviderOpsStats> {
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        senderType: 'artist',
        chatFeatureOrderId: null,
        createdAt: { gte: todayStart },
        chatSession: {
          userId,
        },
      },
      select: {
        modelMetadata: true,
        safetyMetadata: true,
      },
    });

    return this.aggregateProviderOpsStats(rows);
  }

  private aggregateProviderOpsStats(
    rows: Array<{
      modelMetadata: unknown;
      safetyMetadata: unknown;
    }>,
  ): ChatProviderOpsStats {
    const usageByModel = new Map<
      string,
      {
        provider: string;
        model: string;
        responses: number;
        inputTokens: number;
        outputTokens: number;
        estimatedCostKrw: number;
      }
    >();
    let totalResponses = 0;
    let failureCount = 0;
    let fallbackCount = 0;

    for (const row of rows) {
      const modelMetadata = this.recordOrEmpty(row.modelMetadata);
      const safetyMetadata = this.recordOrEmpty(row.safetyMetadata);
      const usage = this.recordOrEmpty(modelMetadata.usage);
      const provider =
        this.stringFromUnknown(modelMetadata.provider) ??
        this.stringFromUnknown(usage.provider) ??
        this.stringFromUnknown(safetyMetadata.provider);
      const model =
        this.stringFromUnknown(modelMetadata.model) ??
        this.stringFromUnknown(usage.model) ??
        'unknown';
      const isProviderTracked = Boolean(
        provider ||
          modelMetadata.usage ||
          safetyMetadata.generationStatus ||
          safetyMetadata.reason,
      );

      if (!isProviderTracked) {
        continue;
      }

      const normalizedProvider = provider ?? 'unknown';
      const generationStatus = this.stringFromUnknown(
        safetyMetadata.generationStatus,
      );
      const failureReason = this.stringFromUnknown(safetyMetadata.reason);
      const isFallback = generationStatus === 'fallback' || model === 'fallback';
      const isFailure =
        isFallback ||
        generationStatus === 'failed' ||
        Boolean(failureReason?.startsWith('provider_'));

      totalResponses += 1;
      fallbackCount += isFallback ? 1 : 0;
      failureCount += isFailure ? 1 : 0;

      const key = `${normalizedProvider}:${model}`;
      const current =
        usageByModel.get(key) ??
        {
          provider: normalizedProvider,
          model,
          responses: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostKrw: 0,
        };

      current.responses += 1;
      current.inputTokens += this.numberFromUnknown(
        usage.inputTokens ?? usage.input_tokens,
      );
      current.outputTokens += this.numberFromUnknown(
        usage.outputTokens ?? usage.output_tokens,
      );
      current.estimatedCostKrw += this.numberFromUnknown(
        modelMetadata.estimatedCostKrw ?? usage.estimatedCostKrw,
      );
      usageByModel.set(key, current);
    }

    const usageRows = [...usageByModel.values()].map((row) => ({
      ...row,
      estimatedCostKrw: row.estimatedCostKrw.toFixed(2),
    }));
    const estimatedCostKrw = usageRows
      .reduce((sum, row) => sum + this.numberFromUnknown(row.estimatedCostKrw), 0)
      .toFixed(2);

    return {
      totalResponses,
      failureCount,
      fallbackCount,
      usageByModel: usageRows,
      estimatedCostKrw,
    };
  }

  private async getProviderUserContext(
    userId: string,
  ): Promise<ChatProviderUserContext> {
    const userDelegate = (
      this.prisma as unknown as {
        user?: {
          findUnique?: (args: {
            where: { id: string };
            select: { id: true; email: true };
          }) => Promise<{ id: string; email: string | null } | null>;
        };
      }
    ).user;

    if (!userDelegate?.findUnique) {
      return { userId, userEmail: null };
    }

    const user = await userDelegate.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    return {
      userId,
      userEmail: user?.email ?? null,
    };
  }

  private providerDetails(readiness: ChatLlmProviderReadiness) {
    return {
      name: readiness.provider,
      configured: readiness.configured,
      status: readiness.status,
    };
  }

  private requiresLlmGeneration(product: { featureType: string }) {
    const configuredPolicy = findChatFeatureProductPolicy({
      featureType: product.featureType,
    });

    return configuredPolicy?.providerRequired ?? PAID_GENERATION_FEATURE_TYPES.has(product.featureType);
  }

  private normalizeBasicChatMode(value?: string) {
    const mode = value?.trim() || BASIC_CHAT_POLICY.mode;

    if (mode !== BASIC_CHAT_POLICY.mode) {
      throw new BadRequestException({
        code: BASIC_CHAT_BLOCK_REASONS.invalidMode.code,
        message: BASIC_CHAT_BLOCK_REASONS.invalidMode.fallbackCopyKo,
        messageKey: BASIC_CHAT_BLOCK_REASONS.invalidMode.messageKey,
        fallbackCopyKo: BASIC_CHAT_BLOCK_REASONS.invalidMode.fallbackCopyKo,
      });
    }

    return mode;
  }

  private normalizeBasicChatBody(value?: string) {
    const body = value?.trim() ?? '';

    if (!body || body.length > BASIC_CHAT_POLICY.maxInputChars) {
      throw new BadRequestException({
        code: BASIC_CHAT_BLOCK_REASONS.invalidBody.code,
        message: BASIC_CHAT_BLOCK_REASONS.invalidBody.fallbackCopyKo,
        messageKey: BASIC_CHAT_BLOCK_REASONS.invalidBody.messageKey,
        fallbackCopyKo: BASIC_CHAT_BLOCK_REASONS.invalidBody.fallbackCopyKo,
        details: {
          limits: {
            maxInputChars: BASIC_CHAT_POLICY.maxInputChars,
          },
        },
      });
    }

    return body;
  }

  private normalizeGenerationBody(value: string) {
    const body = value.trim();

    if (!body) {
      throw new BadRequestException('body is required');
    }

    if (body.length > 2000) {
      throw new BadRequestException('body must be 2000 characters or fewer');
    }

    return body;
  }

  private estimatedPaidCostCeiling(modelTier: string) {
    return modelTier === 'premium'
      ? '3.00'
      : modelTier === 'async_special'
        ? '5.00'
        : '1.00';
  }

  private recordOrEmpty(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private inputJson(value: unknown): InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as InputJsonValue;
  }

  private async getCharacterChatCmsCopy(
    artistSlug: string,
  ): Promise<CharacterChatCmsCopy | null> {
    const siteContentEntry = (this.prisma as unknown as {
      siteContentEntry?: {
        findFirst?: (args: unknown) => Promise<{
          id: string;
          contentKey: string;
          locale: string;
          body: string | null;
          ctaLabel: string | null;
          content: unknown;
          version: number;
        } | null>;
      };
    }).siteContentEntry;

    if (!siteContentEntry?.findFirst) {
      return null;
    }

    const contentKey = this.characterChatCopyContentKey(artistSlug);
    const entry = await siteContentEntry.findFirst({
      where: {
        contentKey,
        scope: CHARACTER_CHAT_COPY_CMS_SCOPE,
        pageKey: CHARACTER_CHAT_COPY_CMS_PAGE_KEY,
        characterSlug: artistSlug,
        locale: CHARACTER_CHAT_COPY_CMS_LOCALE,
        status: 'published',
        archivedAt: null,
      },
      select: {
        id: true,
        contentKey: true,
        locale: true,
        body: true,
        ctaLabel: true,
        content: true,
        version: true,
      },
      orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
    });

    if (!entry) {
      return null;
    }

    const content = this.recordOrEmpty(entry.content);
    const welcome = this.recordOrEmpty(content.welcome);
    const status = this.recordOrEmpty(content.status);
    const emptyState = this.recordOrEmpty(content.emptyState);
    const premiumChat = this.recordOrEmpty(content.premiumChat);
    const normalizedStarterSets = this.normalizeStarterPromptSets(content.starterSets);
    const starterSets =
      normalizedStarterSets.length > 0
        ? normalizedStarterSets
        : this.characterChatCmsStarterSet(content);

    return {
      entryId: entry.id,
      contentKey: entry.contentKey,
      locale: entry.locale,
      version: entry.version,
      welcomeText:
        this.stringFromUnknown(welcome.text) ??
        this.stringFromUnknown(content.welcomeText) ??
        this.stringFromUnknown(entry.body) ??
        undefined,
      statusLabelKo: this.stringFromUnknown(status.labelKo) ?? undefined,
      statusDescriptionKo:
        this.stringFromUnknown(status.descriptionKo) ?? undefined,
      starterSets,
      emptyStateText:
        this.stringFromUnknown(emptyState.text) ??
        this.stringFromUnknown(content.emptyStateText) ??
        undefined,
      premiumChatText:
        this.stringFromUnknown(premiumChat.text) ??
        this.stringFromUnknown(content.premiumChatText) ??
        undefined,
      premiumChatCtaLabel:
        this.stringFromUnknown(premiumChat.ctaLabel) ??
        this.stringFromUnknown(content.premiumChatCtaLabel) ??
        this.stringFromUnknown(entry.ctaLabel) ??
        undefined,
    };
  }

  private characterChatCmsStarterSet(content: Record<string, unknown>) {
    const starterOptions = this.normalizeStarterPromptOptions(content.starterOptions);
    const guideText =
      this.stringFromUnknown(content.guideText) ??
      this.stringFromUnknown(this.recordOrEmpty(content.starter).guideText);

    if (!guideText || starterOptions.length === 0) {
      return [];
    }

    return [
      {
        id: this.stringFromUnknown(content.starterSetId) ?? 'cms-starter-1',
        guideText,
        options: starterOptions.slice(0, STARTER_PROMPT_POLICY.maxVisibleOptions),
        directInput: this.normalizeDirectInput(content.directInput),
      },
    ];
  }

  private characterChatCopyContentKey(artistSlug: string) {
    return `${CHARACTER_CHAT_COPY_CMS_CONTENT_KEY_PREFIX}${artistSlug}`;
  }

  private characterChatEmptyState(
    cmsCopy: CharacterChatCmsCopy | null,
    fallbackCopy?: CharacterChatFallbackCopy,
  ) {
    return {
      text:
        cmsCopy?.emptyStateText ??
        fallbackCopy?.emptyStateText ??
        CHARACTER_CHAT_DEFAULT_EMPTY_STATE_KO,
      source: cmsCopy?.emptyStateText
        ? 'site_content'
        : fallbackCopy?.emptyStateText
          ? 'character_fallback'
          : 'default',
      messageKey: 'chat.character.emptyState.default',
    };
  }

  private characterChatPremiumCopy(
    cmsCopy: CharacterChatCmsCopy | null,
    fallbackCopy?: CharacterChatFallbackCopy,
  ) {
    return {
      text:
        cmsCopy?.premiumChatText ??
        fallbackCopy?.premiumChatText ??
        CHARACTER_CHAT_DEFAULT_PREMIUM_COPY_KO,
      ctaLabel:
        cmsCopy?.premiumChatCtaLabel ??
        fallbackCopy?.premiumChatCtaLabel ??
        CHARACTER_CHAT_DEFAULT_PREMIUM_CTA_KO,
      enabled: false,
      source:
        cmsCopy?.premiumChatText || cmsCopy?.premiumChatCtaLabel
          ? 'site_content'
          : fallbackCopy?.premiumChatText || fallbackCopy?.premiumChatCtaLabel
            ? 'character_fallback'
            : 'default',
      messageKey: 'chat.character.premiumChat.locked',
      transitionCta: CHARACTER_CHAT_PREMIUM_TRANSITION_CTA_CONTRACT,
      walletMutation: false,
      orderMutation: false,
    };
  }

  private characterChatCopyContract(
    artistSlug: string,
    cmsCopy: CharacterChatCmsCopy | null,
  ) {
    return {
      version: CHARACTER_CHAT_COPY_CMS_VERSION,
      readOnlyProjection: true,
      cmsSource: 'site_content',
      contentKey: this.characterChatCopyContentKey(artistSlug),
      scope: CHARACTER_CHAT_COPY_CMS_SCOPE,
      pageKey: CHARACTER_CHAT_COPY_CMS_PAGE_KEY,
      characterSlug: artistSlug,
      locale: CHARACTER_CHAT_COPY_CMS_LOCALE,
      publishedEntryId: cmsCopy?.entryId ?? null,
      publishedVersion: cmsCopy?.version ?? null,
      source: cmsCopy ? 'site_content' : 'fallback',
      fallbackOrder: ['site_content', 'artist_metadata', 'character_fallback', 'default'],
      characterFallbackAvailable: Boolean(CHARACTER_CHAT_FALLBACK_COPY[artistSlug]),
      requiredUiFields: [
        'greeting.text',
        'openingPrompt.guideText',
        'openingPrompt.options[].label',
        'openingPrompt.options[].message',
        'emptyState.text',
        'premiumChat.ctaLabel',
        'premiumChat.transitionCta.characterDetailCtaProjection',
        'premiumChat.transitionCta.routingSeparation',
        'premiumChat.transitionCta.replyModeCopy.directArtistReplyKo',
        'premiumChat.transitionCta.roomStateReasons',
        'premiumChat.transitionCta.priceSummary',
        'tone.guideKo',
        'personaTags',
        'forbiddenTone.items',
      ],
      characterSpecificFallbackFields: [
        'greeting.text',
        'openingPrompt.guideText',
        'openingPrompt.options[].label',
        'openingPrompt.options[].message',
        'starterSets[].guideText',
        'starterSets[].options[].label',
        'starterSets[].options[].message',
        'emptyState.text',
        'premiumChat.text',
        'premiumChat.ctaLabel',
        'tone.guideKo',
        'personaTags',
        'forbiddenTone.items',
      ],
      editableFields: [...CHARACTER_CHAT_COPY_CMS_EDITABLE_FIELDS],
      fixedUiLabels: [...CHARACTER_CHAT_COPY_FIXED_UI_LABELS],
      rawPersonaPromptExposed: false,
      rawLlmPayloadExposed: false,
      mutation: false,
      llmCall: false,
      walletMutation: false,
    };
  }

  private characterChatGreetingToneContract(artistSlug: string) {
    return {
      version: CHARACTER_CHAT_GREETING_TONE_CONTRACT_VERSION,
      characterSlug: artistSlug,
      readOnlyProjection: true,
      fallbackOrder: ['site_content', 'artist_metadata', 'character_fallback', 'default'],
      responseFields: [
        'greeting.text',
        'openingPrompt.guideText',
        'openingPrompt.options[].label',
        'openingPrompt.options[].message',
        'tone.guideKo',
        'tone.toneTags',
        'personaTags',
        'forbiddenTone.items',
      ],
      sampleMinimumCharacters: 2,
      perCharacterIsolationRequired: true,
      rawPersonaPromptExposed: false,
      rawPromptSecretExposed: false,
      rawLlmPayloadExposed: false,
      providerCall: false,
      mutation: false,
      walletMutation: false,
      orderMutation: false,
      settlementMutation: false,
    };
  }

  private characterChatDynamicGreetingContract(artistSlug: string) {
    return {
      version: CHARACTER_CHAT_DYNAMIC_GREETING_CONTRACT_VERSION,
      characterSlug: artistSlug,
      cacheScope: 'chat_session',
      cacheMessageType: CHARACTER_CHAT_OPENING_GREETING_MESSAGE_TYPE,
      generatedOn: ['POST /api/v1/chat/sessions', 'first GET /api/v1/chat/sessions/:sessionId/messages when missing'],
      refreshCreatesNewGreeting: false,
      sameSessionReplay: 'return_cached_opening_greeting',
      sameCharacterDifferentSessionsCanVary: true,
      variantPolicy: {
        minCandidates: CHARACTER_CHAT_OPENING_GREETING_MIN_VARIANTS,
        maxCandidates: CHARACTER_CHAT_OPENING_GREETING_MAX_VARIANTS,
        selectionStrategy: 'deterministic_session_variant_index',
        sameSessionReplay: 'return_cached_opening_greeting',
      },
      sourceSeparation: {
        cache: true,
        templateFallback: true,
        providerCallOptional: true,
        providerDailyGuard: true,
        providerCallOnRefresh: false,
      },
      provider: {
        lightweightModelPreferred: true,
        maxOutputTokens: CHARACTER_CHAT_OPENING_GREETING_MAX_OUTPUT_TOKENS,
        maxOutputChars: CHARACTER_CHAT_OPENING_GREETING_MAX_CHARS,
        providerCallSkippedWhenNotReady: true,
      },
      fallback: {
        enabled: true,
        sourceOrder: ['site_content', 'artist_metadata', 'character_fallback', 'default'],
        sessionVariantSeed: 'chat_sessions.id',
        candidateInputs: [
          'runtimePersona.welcome.text',
          'runtimePersona.starterOptions[].message',
          'runtimePersona.tone.guideKo',
          'runtimePersona.personaTags[]',
        ],
        minCandidates: CHARACTER_CHAT_OPENING_GREETING_MIN_VARIANTS,
        maxCandidates: CHARACTER_CHAT_OPENING_GREETING_MAX_VARIANTS,
        selectionStrategy: 'deterministic_session_variant_index',
        sameSessionStable: true,
      },
      toneCandidate: {
        enabled: true,
        contractVersion: CHARACTER_CHAT_GREETING_TONE_CONTRACT_VERSION,
        source: 'runtimePersona.tone',
        displaySafe: true,
        rawPersonaPromptStored: false,
      },
      safety: {
        forbiddenToneApplied: true,
        minorCleanRequired: true,
        rawPromptStored: false,
        rawProviderPayloadStored: false,
        userPrivateDataStored: false,
      },
      responseFields: [
        'openingGreeting.text',
        'openingGreeting.cache.scope',
        'openingGreeting.cache.hit',
        'openingGreeting.generation.providerCall',
        'openingGreeting.toneCandidate.guideKo',
        'openingGreeting.toneCandidate.toneTags',
        'openingGreeting.toneCandidate.personaTags',
        'openingGreeting.safety.rawPromptStored',
      ],
      rawPromptStored: false,
      rawPromptSecretExposed: false,
      rawProviderPayloadStored: false,
      tokenReturned: false,
      apiKeyReturned: false,
      userPrivateDataStored: false,
      walletMutation: false,
      orderMutation: false,
      settlementMutation: false,
    };
  }

  private characterChatOpeningPrompt(runtimePersona: CharacterRuntimePersonaContext) {
    const starterSet = runtimePersona.starterSets[0];

    return {
      guideText: starterSet.guideText,
      options: starterSet.options
        .slice(0, STARTER_PROMPT_POLICY.maxVisibleOptions)
        .map((option) => ({ ...option })),
      directInput: { ...runtimePersona.directInput },
      source: runtimePersona.source,
      readOnly: true,
      mutation: false,
      llmCall: false,
    };
  }

  private characterChatForbiddenTone(runtimePersona: CharacterRuntimePersonaContext) {
    return {
      items: [...runtimePersona.forbiddenTone],
      source: runtimePersona.source,
      displaySafe: true,
      rawPersonaPromptExposed: false,
      rawPromptSecretExposed: false,
      rawLlmPayloadExposed: false,
      providerCall: false,
      mutation: false,
    };
  }

  private buildCharacterRuntimePersonaContext(
    artist: {
      id: string;
      slug: string;
      displayName: string;
      publicProfile?: {
        publicMetadata?: unknown;
        tagline?: string | null;
        personalityKeywords?: string[] | null;
      } | null;
      contentProfile?: {
        contentTone?: string | null;
      } | null;
    },
    options: {
      metadata?: Record<string, unknown>;
      catalogMetadata?: Record<string, unknown>;
      configuredSets?: StarterPromptSet[];
      cmsCopy?: CharacterChatCmsCopy | null;
    } = {},
  ): CharacterRuntimePersonaContext {
    const metadata =
      options.metadata ?? this.recordOrEmpty(artist.publicProfile?.publicMetadata);
    const catalogMetadata =
      options.catalogMetadata ?? this.recordOrEmpty(metadata.chatCatalog);
    const configuredSets =
      options.configuredSets ??
      this.normalizeStarterPromptSets(metadata.chatStarterPromptSets);
    const cmsCopy = options.cmsCopy ?? null;
    const fallbackCopy = CHARACTER_CHAT_FALLBACK_COPY[artist.slug];
    const starterSet =
      configuredSets[0] ?? this.defaultStarterPromptSet(artist.slug, artist.displayName);
    const metadataGreeting =
      cmsCopy?.welcomeText ?? this.stringFromUnknown(catalogMetadata.greetingText);
    const personalityKeywords = this.normalizeStringList(
      artist.publicProfile?.personalityKeywords,
      8,
      30,
    );
    const contentTone = this.stringFromUnknown(artist.contentProfile?.contentTone);
    const personaReference = this.personaReferenceFromMetadata({
      metadata,
      contentTone,
      personalityKeywords,
    });
    const forbiddenTone = this.runtimeForbiddenToneFromMetadata(
      metadata,
      catalogMetadata,
    );
    const safetyNote = this.runtimeSafetyNoteFromMetadata(metadata, catalogMetadata);
    const metadataToneGuide = this.runtimeToneGuideFromMetadata(
      metadata,
      catalogMetadata,
      personaReference,
    );
    const personaTagsFromMetadata = this.runtimeToneTags(
      personaReference,
      personalityKeywords,
    );
    const personaTags = personaTagsFromMetadata.length
      ? personaTagsFromMetadata
      : [...(fallbackCopy?.personaTags ?? [])].slice(0, 12);
    const toneGuideKo =
      metadataToneGuide ??
      fallbackCopy?.toneGuideKo ??
      CHARACTER_CHAT_DEFAULT_TONE_GUIDE_KO;
    const toneGuideSource = metadataToneGuide
      ? 'artist_metadata'
      : fallbackCopy?.toneGuideKo
        ? 'character_fallback'
        : 'default';

    return {
      welcome: {
        text:
          metadataGreeting ??
          fallbackCopy?.greetingText ??
          defaultCharacterGreeting(artist.displayName),
        source: cmsCopy?.welcomeText
          ? 'site_content'
          : metadataGreeting
            ? 'artist_metadata'
          : fallbackCopy
            ? 'character_fallback'
            : 'default',
      },
      starterOptions:
        starterSet.options.length > 0
          ? [
              ...starterSet.options,
              {
                key: starterSet.directInput.key,
                label: starterSet.directInput.label,
                message: '',
                directInput: true,
              },
            ].slice(0, CHARACTER_CHAT_CATALOG_POLICY.beginner.starterOptionMax)
          : defaultCharacterStarterOptions(artist.displayName),
      starterSets: configuredSets.length ? configuredSets : [starterSet],
      directInput: {
        enabled: CHARACTER_CHAT_CATALOG_POLICY.beginner.directInputEnabled,
        ...starterSet.directInput,
      },
      tone: {
        tagline: artist.publicProfile?.tagline ?? null,
        contentTone,
        personalityKeywords,
        toneTags: personaTags,
        guideKo: toneGuideKo,
        guideSource: toneGuideSource,
      },
      personaTags,
      personaReference,
      forbiddenTone,
      safetyNote,
      source:
        cmsCopy ||
        metadataGreeting ||
        configuredSets.length ||
        toneGuideSource === 'artist_metadata' ||
        safetyNote.source === 'artist_metadata' ||
        personaReference.source === 'artist_metadata'
          ? cmsCopy
            ? 'site_content'
            : 'artist_metadata'
          : fallbackCopy
            ? 'character_fallback'
          : personaReference.source === 'legacy_artist_profile'
            ? 'legacy_artist_profile'
            : 'default',
    };
  }

  private runtimeToneTags(
    personaReference: CharacterRuntimePersonaContext['personaReference'],
    personalityKeywords: string[],
  ) {
    return [
      ...new Set([
        ...personaReference.selectedTraits.map((trait) => trait.labelKo),
        ...personaReference.customFields.customTraitsKo,
        ...personalityKeywords,
      ]),
    ].filter(Boolean).slice(0, 12);
  }

  private runtimeToneGuideFromMetadata(
    metadata: Record<string, unknown>,
    catalogMetadata: Record<string, unknown>,
    personaReference: CharacterRuntimePersonaContext['personaReference'],
  ) {
    const personaSeed = this.recordOrEmpty(metadata.chatPersonaSeed);
    const configuredGuide =
      this.stringFromUnknown(catalogMetadata.toneGuideKo) ??
      this.stringFromUnknown(catalogMetadata.toneGuide) ??
      this.stringFromUnknown(personaSeed.toneGuideKo) ??
      this.stringFromUnknown(personaSeed.toneGuide);

    if (configuredGuide) {
      return configuredGuide;
    }

    const traitGuide = personaReference.selectedTraits
      .map((trait) => trait.toneGuideKo)
      .filter((guide): guide is string => Boolean(guide))
      .slice(0, 2)
      .join(' ');

    if (traitGuide) {
      return traitGuide;
    }

    return personaReference.customFields.relationshipToneKo;
  }

  private runtimeForbiddenToneFromMetadata(
    metadata: Record<string, unknown>,
    catalogMetadata: Record<string, unknown>,
  ) {
    const personaSeed = this.recordOrEmpty(metadata.chatPersonaSeed);
    const forbiddenTone = [
      ...this.normalizeStringList(
        catalogMetadata.forbiddenToneKo ?? catalogMetadata.forbiddenTone,
        8,
        60,
      ),
      ...this.normalizeStringList(
        personaSeed.blockedExpressionsKo ?? personaSeed.blockedExpressions,
        8,
        60,
      ),
      ...this.normalizeStringList(
        personaSeed.forbiddenToneKo ?? personaSeed.forbiddenTone,
        8,
        60,
      ),
    ];
    const uniqueForbiddenTone = [...new Set(forbiddenTone)].slice(0, 8);

    return uniqueForbiddenTone.length
      ? uniqueForbiddenTone
      : [...DEFAULT_CHAT_RUNTIME_FORBIDDEN_TONE_KO];
  }

  private runtimeSafetyNoteFromMetadata(
    metadata: Record<string, unknown>,
    catalogMetadata: Record<string, unknown>,
  ) {
    const personaSeed = this.recordOrEmpty(metadata.chatPersonaSeed);
    const text =
      this.stringFromUnknown(catalogMetadata.safetyNoteKo) ??
      this.stringFromUnknown(catalogMetadata.safetyNote) ??
      this.stringFromUnknown(personaSeed.safetyNoteKo) ??
      this.stringFromUnknown(personaSeed.safetyNote);

    return {
      text: text ?? DEFAULT_CHAT_RUNTIME_SAFETY_NOTE_KO,
      source: text ? 'artist_metadata' : 'default',
    };
  }

  private personaReferenceFromMetadata(input: {
    metadata: Record<string, unknown>;
    contentTone: string | null;
    personalityKeywords: string[];
  }) {
    const personaSeed = this.recordOrEmpty(input.metadata.chatPersonaSeed);
    const selectedTraitIds = this.normalizePersonaTraitIds(
      personaSeed.selectedTraitIds ??
        personaSeed.traitIds ??
        personaSeed.tags ??
        input.metadata.personaTraitIds,
    );
    const selectedTraits = CHAT_PERSONA_TRAIT_CATALOG.traits
      .filter((trait) => selectedTraitIds.includes(trait.id))
      .map((trait) => ({
        id: trait.id,
        group: trait.group,
        labelKo: trait.labelKo,
        i18nKey: trait.i18nKey,
        conflictsWith: [...trait.conflictsWith],
        toneGuideKo: trait.toneGuideKo,
      }));
    const customFields = {
      customTraitsKo: this.normalizeStringList(
        personaSeed.customTraitsKo ?? personaSeed.customTraits,
        6,
        30,
      ),
      fanNicknameKo: this.stringFromUnknown(personaSeed.fanNicknameKo),
      relationshipToneKo: this.stringFromUnknown(personaSeed.relationshipToneKo),
      favoriteTopicsKo: this.normalizeStringList(
        personaSeed.favoriteTopicsKo ?? personaSeed.favoriteTopics,
        8,
        30,
      ),
      openingMoodKo: this.stringFromUnknown(personaSeed.openingMoodKo),
    };
    const hasCustomFields = Boolean(
      customFields.customTraitsKo.length ||
        customFields.fanNicknameKo ||
        customFields.relationshipToneKo ||
        customFields.favoriteTopicsKo.length ||
        customFields.openingMoodKo,
    );
    const legacyToneSignals = {
      contentTone: input.contentTone,
      personalityKeywords: input.personalityKeywords,
    };

    return {
      catalogVersion: CHAT_PERSONA_TRAIT_CATALOG.catalogVersion,
      selectedTraitIds,
      selectedTraits,
      customFields,
      legacyToneSignals,
      source:
        selectedTraitIds.length || hasCustomFields
          ? 'artist_metadata'
          : input.contentTone || input.personalityKeywords.length
            ? 'legacy_artist_profile'
            : 'default',
      readOnly: true,
      mutationEnabled: false,
    };
  }

  private normalizePersonaTraitIds(value: unknown) {
    const allowed = new Set<string>(
      CHAT_PERSONA_TRAIT_CATALOG.traits.map((trait) => trait.id),
    );
    const rawItems = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',')
        : [];
    const ids = rawItems
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => allowed.has(item));

    return [...new Set(ids)];
  }

  private normalizeStringList(value: unknown, maxItems: number, maxLength: number) {
    const rawItems = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',')
        : [];

    return [
      ...new Set(
        rawItems
          .map((item) => this.stringFromUnknown(item))
          .filter((item): item is string => Boolean(item))
          .map((item) => item.slice(0, maxLength)),
      ),
    ].slice(0, maxItems);
  }

  private stringFromUnknown(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private numberFromUnknown(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);

      return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
  }

  private async findActiveChatArtist(input: { artistId?: string; artistSlug?: string }) {
    const artistId = input.artistId?.trim();
    const artistSlug = input.artistSlug?.trim();

    if (!artistId && !artistSlug) {
      throw new BadRequestException('artistId or artistSlug is required');
    }

    if (artistId && !UUID_V4_PATTERN.test(artistId)) {
      throw new BadRequestException('artistId must be a UUID v4');
    }

    const artist = await this.prisma.artist.findFirst({
      where: {
        status: 'active',
        ...(artistId ? { id: artistId } : { slug: artistSlug }),
      },
      select: {
        id: true,
        slug: true,
        displayName: true,
        publicProfile: {
          select: {
            publicMetadata: true,
            tagline: true,
            personalityKeywords: true,
          },
        },
        contentProfile: {
          select: {
            contentTone: true,
          },
        },
      },
    });

    if (!artist) {
      if (!artistId) {
        const fallbackArtist = this.fallbackChatArtistForSlug(artistSlug);

        if (fallbackArtist) {
          return fallbackArtist;
        }
      }

      throw new NotFoundException('Artist not found');
    }

    return artist;
  }

  private async loadApprovedArtistKnowledgeContext(
    artistId: string,
  ): Promise<ArtistKnowledgeChatContext> {
    const items = await this.prisma.artistKnowledgeUrl.findMany({
      where: {
        artistId,
        status: 'approved',
        allowChatReference: true,
      },
      orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }],
      take: ARTIST_URL_KNOWLEDGE_CHAT_CONTEXT_POLICY.maxItems,
      select: {
        id: true,
        artistId: true,
        status: true,
        sourceType: true,
        canonicalUrl: true,
        summary: true,
        metadata: true,
        allowChatReference: true,
        reviewedAt: true,
        createdAt: true,
      },
    });

    return buildArtistKnowledgeChatContext(items);
  }

  private fallbackChatArtistForSlug(artistSlug?: string) {
    if (!artistSlug || !CHARACTER_CHAT_FALLBACK_COPY[artistSlug]) {
      return null;
    }

    const fallback = CHARACTER_CHAT_FALLBACK_ARTISTS[artistSlug];

    if (!fallback) {
      return null;
    }

    return {
      id: fallback.id,
      slug: artistSlug,
      displayName: fallback.displayName,
      publicProfile: {
        publicMetadata: {},
        tagline: fallback.tagline,
        personalityKeywords: [...fallback.personalityKeywords],
      },
      contentProfile: {
        contentTone: fallback.contentTone,
      },
    };
  }

  private normalizeStarterPromptSets(value: unknown): StarterPromptSet[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((set, index) => this.normalizeStarterPromptSet(set, index))
      .filter((set): set is StarterPromptSet => Boolean(set));
  }

  private normalizeStarterPromptSet(value: unknown, index: number) {
    const record = this.recordOrEmpty(value);
    const guideText = this.stringFromUnknown(record.guideText);
    const options = this.normalizeStarterPromptOptions(record.options);

    if (!guideText || options.length === 0) {
      return null;
    }

    return {
      id: this.stringFromUnknown(record.id) ?? `starter-${index + 1}`,
      guideText,
      options: options.slice(0, STARTER_PROMPT_POLICY.maxVisibleOptions),
      directInput: this.normalizeDirectInput(record.directInput),
    };
  }

  private normalizeStarterPromptOptions(value: unknown): StarterPromptOption[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((option, index) => {
        const record = this.recordOrEmpty(option);
        const label = this.stringFromUnknown(record.label);
        const message = this.stringFromUnknown(record.message);

        if (!label || !message) {
          return null;
        }

        return {
          key: this.stringFromUnknown(record.key) ?? String.fromCharCode(65 + index),
          label,
          message,
        };
      })
      .filter((option): option is StarterPromptOption => Boolean(option));
  }

  private normalizeDirectInput(value: unknown) {
    const record = this.recordOrEmpty(value);

    return {
      key: this.stringFromUnknown(record.key) ?? 'C',
      label:
        this.stringFromUnknown(record.label) ??
        DEFAULT_STARTER_PROMPT_COPY.directInputLabel,
    };
  }

  private defaultStarterPromptSet(
    artistSlug: string,
    artistDisplayName: string,
  ): StarterPromptSet {
    const fallbackCopy = CHARACTER_CHAT_FALLBACK_COPY[artistSlug];

    if (fallbackCopy) {
      return {
        id: `${artistSlug}-character-start-1`,
        guideText: fallbackCopy.guideText,
        options: fallbackCopy.options.map((option) => ({ ...option })),
        directInput: {
          key: 'C',
          label: DEFAULT_STARTER_PROMPT_COPY.directInputLabel,
        },
      };
    }

    return {
      id: `${artistSlug}-soft-start-1`,
      guideText: DEFAULT_STARTER_PROMPT_COPY.guideText(artistDisplayName),
      options: DEFAULT_STARTER_PROMPT_COPY.options.map((option) => ({
        key: option.key,
        label: option.label,
        message: option.message(artistDisplayName),
      })),
      directInput: {
        key: 'C',
        label: DEFAULT_STARTER_PROMPT_COPY.directInputLabel,
      },
    };
  }
}
