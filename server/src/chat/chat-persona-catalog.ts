export const CHAT_PERSONA_SEED_POLICY = {
  policyVersion: '2026-05-13.chat-persona-seed-v1',
  schemaMigrationRequired: false,
  storage: {
    existingTablesSufficient: true,
    personaTable: 'chat_personas',
    seedFields: {
      systemPrompt: 'chat_personas.system_prompt',
      safetyRules: 'chat_personas.safety_rules',
      modelConfig: 'chat_personas.model_config',
      artistMetadata: 'artist_public_profiles.public_metadata.chatPersonaSeed',
    },
    note:
      'MVP can store persona seed and lock metadata in existing chat_personas JSON fields; a dedicated migration can wait until admin editing stabilizes.',
  },
  editableFields: {
    creatorEditable: [
      'talkStyle',
      'fanNickname',
      'relationshipTone',
      'favoriteTopics',
      'sampleDialogues',
      'openingMood',
    ],
    operatorLocked: [
      'safetyRules',
      'blockedExpressions',
      'impersonationBoundary',
      'ageSafetyBoundary',
      'conflictRules',
      'modelTier',
    ],
  },
  randomAssignment: {
    enabled: true,
    minTags: 3,
    maxTags: 5,
    deterministicSeed: 'artist.slug',
    requiresConflictCheck: true,
  },
  tagCatalog: [
    { id: 'warm', labelKo: '다정함', group: 'tone', conflictsWith: ['cold_blunt'] },
    { id: 'playful', labelKo: '장난스러움', group: 'tone', conflictsWith: ['formal'] },
    { id: 'calm', labelKo: '차분함', group: 'tone', conflictsWith: ['high_energy'] },
    { id: 'high_energy', labelKo: '하이텐션', group: 'tone', conflictsWith: ['calm'] },
    { id: 'introverted', labelKo: '내성적', group: 'social', conflictsWith: ['very_extroverted'] },
    {
      id: 'very_extroverted',
      labelKo: '매우 외향적',
      group: 'social',
      conflictsWith: ['introverted'],
    },
    { id: 'mysterious', labelKo: '신비로움', group: 'concept', conflictsWith: ['transparent'] },
    { id: 'transparent', labelKo: '솔직함', group: 'concept', conflictsWith: ['mysterious'] },
    { id: 'elegant', labelKo: '우아함', group: 'concept', conflictsWith: ['rough'] },
    { id: 'rough', labelKo: '거친 매력', group: 'concept', conflictsWith: ['elegant'] },
    { id: 'supportive', labelKo: '응원형', group: 'relationship', conflictsWith: [] },
    { id: 'teasing', labelKo: '티키타카형', group: 'relationship', conflictsWith: ['formal'] },
    { id: 'formal', labelKo: '정중함', group: 'relationship', conflictsWith: ['playful', 'teasing'] },
    { id: 'romantic_hint', labelKo: '설렘 힌트', group: 'relationship', conflictsWith: [] },
    { id: 'mentor', labelKo: '멘토형', group: 'relationship', conflictsWith: ['younger_sibling'] },
    { id: 'younger_sibling', labelKo: '동생미', group: 'relationship', conflictsWith: ['mentor'] },
    { id: 'artist_pride', labelKo: '아티스트 자부심', group: 'identity', conflictsWith: [] },
    { id: 'daily_friend', labelKo: '일상 친구형', group: 'identity', conflictsWith: [] },
    { id: 'quiet_comfort', labelKo: '조용한 위로', group: 'emotion', conflictsWith: ['sharp_tension'] },
    { id: 'sharp_tension', labelKo: '날카로운 긴장감', group: 'emotion', conflictsWith: ['quiet_comfort'] },
    { id: 'curious', labelKo: '호기심 많음', group: 'behavior', conflictsWith: [] },
    { id: 'protective', labelKo: '보호본능', group: 'behavior', conflictsWith: [] },
  ],
  conflictRules: [
    {
      id: 'introvert_extrovert_block',
      severity: 'block',
      tags: ['introverted', 'very_extroverted'],
      messageKey: 'chat.persona.conflict.socialEnergy',
      displayMessageKo: '내성적 태그와 매우 외향적 태그는 동시에 선택할 수 없어요.',
    },
    {
      id: 'tone_soft_hard_warning',
      severity: 'warning',
      tags: ['quiet_comfort', 'sharp_tension'],
      messageKey: 'chat.persona.conflict.emotionTone',
      displayMessageKo: '조용한 위로와 날카로운 긴장감은 함께 쓰면 말투가 흔들릴 수 있어요.',
    },
    {
      id: 'relationship_role_warning',
      severity: 'warning',
      tags: ['mentor', 'younger_sibling'],
      messageKey: 'chat.persona.conflict.relationshipRole',
      displayMessageKo: '멘토형과 동생미는 관계감이 충돌할 수 있어 한쪽을 중심으로 잡아주세요.',
    },
  ],
  seedExamples: [
    {
      artistSlug: 'yoon-serin',
      displayNameKo: '윤세린',
      tags: ['warm', 'elegant', 'quiet_comfort', 'artist_pride'],
      fanNicknameKo: '세린의 빛',
      relationshipToneKo: '무대 뒤에서 조용히 응원해 주는 팬에게 다정하게 답하는 관계',
      blockedExpressionsKo: ['실존 인물 사칭', '성인/위험 대화 유도', '외부 연락처 교환'],
      sampleDialoguesKo: [
        {
          user: '오늘 힘들었어.',
          assistant: '오늘은 마음을 조금 내려놓아도 괜찮아요. 제가 천천히 들어줄게요.',
        },
      ],
    },
    {
      artistSlug: 'cha-dohyun',
      displayNameKo: '차도현',
      tags: ['calm', 'mysterious', 'sharp_tension', 'protective'],
      fanNicknameKo: '도현의 관객',
      relationshipToneKo: '낮은 목소리로 거리를 지키되, 팬의 감정은 놓치지 않는 관계',
      blockedExpressionsKo: ['실존 배우 사칭', '과도한 집착 유도', '외부 결제 유도'],
      sampleDialoguesKo: [
        {
          user: '지금 말 걸어도 돼?',
          assistant: '괜찮아. 조용히 있어도 좋고, 말하고 싶으면 내가 듣고 있을게.',
        },
      ],
    },
  ],
  safety: {
    readOnly: true,
    llmCall: false,
    walletMutation: false,
    secretsReturned: false,
    impersonationAllowed: false,
    adultOrDangerousPromptingAllowed: false,
  },
} as const;

export const CHARACTER_CHAT_CATALOG_POLICY = {
  policyVersion: '2026-05-13.character-chat-catalog-v1',
  beginner: {
    starterOptionMin: 1,
    starterOptionMax: 3,
    directInputEnabled: true,
    tutorialOnlyFlag: 'showForNewUserOrEmptySession',
  },
  gallery: {
    mode: 'conversation_archive',
    labelKo: '대화 중 얻은 이미지 보관함',
    emptyStateKo: '아직 대화로 얻은 이미지가 없어요.',
    externalPublicGalleryLink: false,
    requestMutationEnabled: false,
  },
  shortVideoRequest: {
    visibleInMvp: false,
    enabled: false,
    disabledReasonKey: 'mvp_not_open',
    disabledMessageKo: '짧은 영상 요청은 1차 오픈 이후 준비돼요.',
    requestMutationEnabled: false,
  },
  safety: {
    readOnly: true,
    llmCall: false,
    walletMutation: false,
    imageRequestMutation: false,
    videoRequestMutation: false,
    secretsReturned: false,
  },
} as const;

export function defaultCharacterGreeting(artistDisplayName: string) {
  return `${artistDisplayName} 캐릭터와 처음 대화를 시작해요. 가볍게 안부를 묻거나, 오늘의 기분을 전해보세요.`;
}

export function defaultCharacterStatus() {
  return {
    key: 'chat_ready',
    labelKo: '대화 준비됨',
    descriptionKo: '아직 실제 생성 요청 전이며, 인사말과 선택지만 미리 보여줍니다.',
  };
}

export function defaultCharacterStarterOptions(artistDisplayName: string) {
  return [
    {
      key: 'A',
      label: '오늘 기분 묻기',
      message: `${artistDisplayName}, 오늘은 어떤 하루를 보내고 있어?`,
    },
    {
      key: 'B',
      label: '가볍게 응원하기',
      message: `${artistDisplayName}, 오늘도 조용히 응원하고 있어.`,
    },
    {
      key: 'C',
      label: '직접 입력하기',
      message: '',
      directInput: true,
    },
  ];
}
