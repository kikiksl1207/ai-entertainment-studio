export const STORY_SCENE_READ_MODEL_VERSION =
  '2026-06-29.story-scene-read-model.v1';

export const STORY_SCENE_BACKGROUND_STATES = [
  'ready',
  'loading',
  'missing',
  'fallback',
] as const;

export type StorySceneBackgroundState =
  (typeof STORY_SCENE_BACKGROUND_STATES)[number];

export const STORY_SCENE_CHARACTER_POSES = [
  'neutral',
  'speaking',
  'listening',
  'alert',
  'leaving',
] as const;

export type StorySceneCharacterPose =
  (typeof STORY_SCENE_CHARACTER_POSES)[number];

export const STORY_SCENE_CHARACTER_LAYERS = [
  'background',
  'midground',
  'foreground',
  'offscreen',
] as const;

export type StorySceneCharacterLayer =
  (typeof STORY_SCENE_CHARACTER_LAYERS)[number];

export const STORY_SCENE_CHARACTER_ENTRANCE_STATES = [
  'entering',
  'present',
  'exiting',
  'absent',
] as const;

export type StorySceneCharacterEntranceState =
  (typeof STORY_SCENE_CHARACTER_ENTRANCE_STATES)[number];

export const STORY_SCENE_CHARACTER_VISIBILITY_STATES = [
  'visible',
  'offscreen',
  'hidden',
] as const;

export type StorySceneCharacterVisibility =
  (typeof STORY_SCENE_CHARACTER_VISIBILITY_STATES)[number];

export interface StoryScenePublicBackgroundAsset {
  assetId: string;
  url: string;
  labelKey: string;
}

export interface StorySceneCharacterProjection {
  characterId: string;
  artistSlug: string;
  displayNameKey: string;
  assetId: string;
  characterPose: StorySceneCharacterPose;
  characterLayer: StorySceneCharacterLayer;
  visibility: StorySceneCharacterVisibility;
  entranceState: StorySceneCharacterEntranceState;
}

export interface StorySceneReadModel {
  sceneId: string;
  sceneText: string;
  backgroundAsset: StoryScenePublicBackgroundAsset;
  backgroundPromptKey: string;
  backgroundState: StorySceneBackgroundState;
  characters: StorySceneCharacterProjection[];
  fallbackKey: string;
}

interface StorySceneFixtureSource {
  sceneId: string;
  sceneText: string;
  backgroundPromptKey: string;
  fallbackKey?: string;
  backgroundAsset?: StoryScenePublicBackgroundAsset | null;
  requestedBackgroundState?: StorySceneBackgroundState;
  characters?: StorySceneCharacterProjection[];
}

export const STORY_SCENE_DEFAULT_FALLBACK_KEY =
  'storyStage.scene.assetFallback.default';

export const STORY_SCENE_FALLBACK_BACKGROUND_ASSET: StoryScenePublicBackgroundAsset =
  {
    assetId: 'story-scene-background-fallback-default',
    url: '/fixtures/story-scenes/backgrounds/default-stage.webp',
    labelKey: 'storyStage.scene.background.default',
  };

export const STORY_SCENE_CHARACTER_LAYER_ORDER: Record<
  StorySceneCharacterLayer,
  number
> = {
  background: 0,
  midground: 1,
  foreground: 2,
  offscreen: 3,
};

export const STORY_SCENE_ALLOWED_RESPONSE_FIELDS = [
  'sceneId',
  'sceneText',
  'backgroundAsset',
  'backgroundPromptKey',
  'backgroundState',
  'characters',
  'fallbackKey',
] as const;

export const STORY_SCENE_ALLOWED_BACKGROUND_ASSET_FIELDS = [
  'assetId',
  'url',
  'labelKey',
] as const;

export const STORY_SCENE_ALLOWED_CHARACTER_FIELDS = [
  'characterId',
  'artistSlug',
  'displayNameKey',
  'assetId',
  'characterPose',
  'characterLayer',
  'visibility',
  'entranceState',
] as const;

export const STORY_SCENE_FORBIDDEN_PROVIDER_FIELDS = [
  'rawPrompt',
  'providerPayload',
  'providerRequest',
  'providerResponse',
  'rawModelResponse',
  'internalCost',
  'privateUserInput',
  'privatePrompt',
  'storageKey',
  'signedUrl',
  'providerAssetId',
  'providerUrl',
  'privatePersona',
  'privateAuthorNotes',
  'adminMemo',
  'apiKey',
  'token',
  'password',
  'cookie',
] as const;

const STORY_SCENE_FIXTURE_SOURCES: readonly StorySceneFixtureSource[] = [
  {
    sceneId: 'fixture-scene-rain-alley',
    sceneText: 'storyStage.fixture.scene.rainAlley.text',
    backgroundPromptKey: 'storyStage.fixture.background.rainAlley.prompt',
    backgroundAsset: {
      assetId: 'fixture-background-rain-alley',
      url: '/fixtures/story-scenes/backgrounds/rain-alley.webp',
      labelKey: 'storyStage.fixture.background.rainAlley.label',
    },
    requestedBackgroundState: 'ready',
    characters: [
      {
        characterId: 'fixture-character-mira',
        artistSlug: 'mira',
        displayNameKey: 'artist.mira.displayName',
        assetId: 'fixture-character-mira-coat',
        characterPose: 'speaking',
        characterLayer: 'foreground',
        visibility: 'visible',
        entranceState: 'entering',
      },
    ],
  },
  {
    sceneId: 'fixture-scene-archive-room',
    sceneText: 'storyStage.fixture.scene.archiveRoom.text',
    backgroundPromptKey: 'storyStage.fixture.background.archiveRoom.prompt',
    backgroundAsset: {
      assetId: 'fixture-background-archive-room',
      url: '/fixtures/story-scenes/backgrounds/archive-room.webp',
      labelKey: 'storyStage.fixture.background.archiveRoom.label',
    },
    requestedBackgroundState: 'ready',
    characters: [],
  },
  {
    sceneId: 'fixture-scene-collapsed-bridge',
    sceneText: 'storyStage.fixture.scene.collapsedBridge.text',
    backgroundPromptKey: 'storyStage.fixture.background.collapsedBridge.prompt',
    fallbackKey: 'storyStage.scene.assetFallback.collapsedBridge',
    backgroundAsset: null,
    requestedBackgroundState: 'missing',
    characters: [
      {
        characterId: 'fixture-character-ren',
        artistSlug: 'ren',
        displayNameKey: 'artist.ren.displayName',
        assetId: 'fixture-character-ren-alert',
        characterPose: 'alert',
        characterLayer: 'midground',
        visibility: 'visible',
        entranceState: 'present',
      },
      {
        characterId: 'fixture-character-sol',
        artistSlug: 'sol',
        displayNameKey: 'artist.sol.displayName',
        assetId: 'fixture-character-sol-offscreen',
        characterPose: 'listening',
        characterLayer: 'offscreen',
        visibility: 'offscreen',
        entranceState: 'absent',
      },
    ],
  },
];

function copyBackgroundAsset(
  asset: StoryScenePublicBackgroundAsset,
): StoryScenePublicBackgroundAsset {
  return {
    assetId: asset.assetId,
    url: asset.url,
    labelKey: asset.labelKey,
  };
}

function copyCharacter(
  character: StorySceneCharacterProjection,
): StorySceneCharacterProjection {
  return {
    characterId: character.characterId,
    artistSlug: character.artistSlug,
    displayNameKey: character.displayNameKey,
    assetId: character.assetId,
    characterPose: character.characterPose,
    characterLayer: character.characterLayer,
    visibility: resolveStorySceneCharacterVisibility(character),
    entranceState: character.entranceState,
  };
}

export function resolveStorySceneCharacterVisibility(
  character: Pick<
    StorySceneCharacterProjection,
    'characterLayer' | 'entranceState'
  >,
): StorySceneCharacterVisibility {
  if (character.characterLayer === 'offscreen') {
    return 'offscreen';
  }

  if (character.entranceState === 'absent') {
    return 'hidden';
  }

  return 'visible';
}

export function resolveStorySceneBackgroundState(input: {
  backgroundAsset?: StoryScenePublicBackgroundAsset | null;
  requestedBackgroundState?: StorySceneBackgroundState;
  fallbackKey?: string;
}): Pick<
  StorySceneReadModel,
  'backgroundAsset' | 'backgroundState' | 'fallbackKey'
> {
  const fallbackKey = input.fallbackKey ?? STORY_SCENE_DEFAULT_FALLBACK_KEY;
  const requestedState = input.requestedBackgroundState ?? 'missing';

  if (requestedState === 'ready' && input.backgroundAsset) {
    return {
      backgroundAsset: copyBackgroundAsset(input.backgroundAsset),
      backgroundState: 'ready',
      fallbackKey,
    };
  }

  if (requestedState === 'loading' && input.backgroundAsset) {
    return {
      backgroundAsset: copyBackgroundAsset(input.backgroundAsset),
      backgroundState: 'loading',
      fallbackKey,
    };
  }

  return {
    backgroundAsset: copyBackgroundAsset(STORY_SCENE_FALLBACK_BACKGROUND_ASSET),
    backgroundState: requestedState === 'loading' ? 'loading' : 'fallback',
    fallbackKey,
  };
}

export function projectStorySceneReadModel(
  source: StorySceneFixtureSource,
): StorySceneReadModel {
  const background = resolveStorySceneBackgroundState({
    backgroundAsset: source.backgroundAsset,
    requestedBackgroundState: source.requestedBackgroundState,
    fallbackKey: source.fallbackKey,
  });

  const characters = [...(source.characters ?? [])]
    .sort(
      (left, right) =>
        STORY_SCENE_CHARACTER_LAYER_ORDER[left.characterLayer] -
        STORY_SCENE_CHARACTER_LAYER_ORDER[right.characterLayer],
    )
    .slice(0, 4)
    .map(copyCharacter);

  return {
    sceneId: source.sceneId,
    sceneText: source.sceneText,
    backgroundAsset: background.backgroundAsset,
    backgroundPromptKey: source.backgroundPromptKey,
    backgroundState: background.backgroundState,
    characters,
    fallbackKey: background.fallbackKey,
  };
}

export const STORY_SCENE_FIXTURE_READ_MODELS: readonly StorySceneReadModel[] =
  STORY_SCENE_FIXTURE_SOURCES.map(projectStorySceneReadModel);

export function listStorySceneFixtureReadModels(): StorySceneReadModel[] {
  return STORY_SCENE_FIXTURE_READ_MODELS.map((scene) => ({
    ...scene,
    backgroundAsset: copyBackgroundAsset(scene.backgroundAsset),
    characters: scene.characters.map(copyCharacter),
  }));
}

export function getStorySceneFixtureReadModel(
  sceneId: string,
): StorySceneReadModel | undefined {
  return listStorySceneFixtureReadModels().find(
    (scene) => scene.sceneId === sceneId,
  );
}

export const STORY_SCENE_CURRENT_SCENE_ENDPOINT_DELTA_CONTRACT = {
  version: '2026-06-30.story-scene-current-scene-endpoint-delta.v1',
  status: 'read_endpoint_delta_contract',
  endpoint: {
    method: 'GET',
    path: '/api/v1/story-sessions/:sessionId/current-scene',
    enabled: false,
    authRequired: true,
    response: 'StorySceneReadModel',
  },
  allowedResponseFields: STORY_SCENE_ALLOWED_RESPONSE_FIELDS,
  allowedBackgroundAssetFields: STORY_SCENE_ALLOWED_BACKGROUND_ASSET_FIELDS,
  allowedCharacterFields: STORY_SCENE_ALLOWED_CHARACTER_FIELDS,
  sourceCompatibility: {
    sharesProjectionWithSceneList: true,
    fixtureProjectionReusable: true,
    sceneAssetContractCompatible: true,
  },
  privacy: {
    rawPromptReturned: false,
    providerPayloadReturned: false,
    internalCostReturned: false,
    privateUserInputReturned: false,
    storageKeyReturned: false,
    signedUrlReturned: false,
  },
  mutationPolicy: {
    providerCall: false,
    storyProgressMutation: false,
    storySceneWrite: false,
    paymentMutation: false,
    walletMutation: false,
    settlementMutation: false,
    payoutMutation: false,
  },
} as const;

export const STORY_SCENE_CHOICE_PROGRESS_WRITE_GUARD_CONTRACT = {
  version: '2026-06-30.story-scene-choice-progress-write-guard.v1',
  status: 'write_guard_skeleton_only',
  guardedFutureEndpoints: {
    submitChoice: {
      method: 'POST',
      path: '/api/v1/story-sessions/:sessionId/scenes/:sceneId/choices',
      enabled: false,
    },
    advanceProgress: {
      method: 'POST',
      path: '/api/v1/story-sessions/:sessionId/progress',
      enabled: false,
    },
  },
  previewFixtureMode: {
    readOnly: true,
    acceptsChoiceSubmit: false,
    advancesProgress: false,
    failureMessageKey: 'storyStage.scene.choice.readOnlyPreview',
  },
  authorizationRequiredBeforeWrite: [
    'authenticated_session_owner',
    'confirmed_story_entitlement',
    'scene_belongs_to_session',
    'server_resolved_choice_id',
  ],
  blockedWithoutExplicitAuthority: {
    providerCall: true,
    storyProgressMutation: true,
    storySceneWrite: true,
    paymentMutation: true,
    walletMutation: true,
  },
  mutationPolicy: {
    providerCall: false,
    storyProgressMutation: false,
    storySceneWrite: false,
    paymentMutation: false,
    walletMutation: false,
    settlementMutation: false,
    payoutMutation: false,
  },
} as const;

export const STORY_SCENE_FIXTURE_LOCALE_FIELD_CONTRACT = {
  version: '2026-06-30.story-scene-fixture-locale-fields.v1',
  status: 'fixture_locale_key_contract',
  supportedLocaleSlots: ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'],
  fixtureFieldsUsingI18nKeys: [
    'sceneText',
    'backgroundAsset.labelKey',
    'backgroundPromptKey',
    'characters[].displayNameKey',
    'fallbackKey',
    'assetFallbackError.shortLabelKey',
  ],
  copyPolicy: {
    fullTranslatedCopyInFixture: false,
    publicKeyPreferred: true,
    rawProviderPromptAllowedAsCopy: false,
    privateAuthorNoteAllowedAsCopy: false,
  },
} as const;

export const STORY_SCENE_CHARACTER_VISIBILITY_RESOLVER_CONTRACT = {
  version: '2026-06-30.story-scene-character-visibility-resolver.v1',
  status: 'read_only_resolver_contract',
  states: STORY_SCENE_CHARACTER_VISIBILITY_STATES,
  inputFields: ['characterLayer', 'entranceState'],
  outputField: 'characters[].visibility',
  emptySceneBehavior: {
    returnsEmptyCharactersArray: true,
    notAnError: true,
  },
  mobileLayerOrder: STORY_SCENE_CHARACTER_LAYER_ORDER,
  mobileSafetyPolicy: {
    foregroundCanOverlapSceneArt: true,
    characterMayCoverChoiceButtons: false,
    characterMayCoverBottomNav: false,
    textAndChoicePriorityAboveDecorativeCharacters: true,
  },
  mutationPolicy: {
    providerCall: false,
    characterGeneration: false,
    assetUploadIntentCreate: false,
    assetCreate: false,
    paymentMutation: false,
    walletMutation: false,
  },
} as const;

export const STORY_SCENE_ASSET_FALLBACK_ERROR_CODES = [
  'STORY_SCENE_BACKGROUND_ASSET_UNAVAILABLE',
  'STORY_SCENE_CHARACTER_ASSET_UNAVAILABLE',
  'STORY_SCENE_ASSET_LOADING',
] as const;

export type StorySceneAssetFallbackErrorCode =
  (typeof STORY_SCENE_ASSET_FALLBACK_ERROR_CODES)[number];

export interface StorySceneAssetFallbackErrorEnvelope {
  code: StorySceneAssetFallbackErrorCode;
  fallbackKey: string;
  shortLabelKey: string;
  retryable: boolean;
}

export function buildStorySceneAssetFallbackErrorEnvelope(input: {
  code: StorySceneAssetFallbackErrorCode;
  fallbackKey?: string;
  shortLabelKey?: string;
  retryable?: boolean;
}): StorySceneAssetFallbackErrorEnvelope {
  return {
    code: input.code,
    fallbackKey: input.fallbackKey ?? STORY_SCENE_DEFAULT_FALLBACK_KEY,
    shortLabelKey:
      input.shortLabelKey ?? 'storyStage.scene.assetFallback.shortLabel',
    retryable: input.retryable ?? input.code === 'STORY_SCENE_ASSET_LOADING',
  };
}

export const STORY_SCENE_ASSET_FALLBACK_ERROR_ENVELOPE_CONTRACT = {
  version: '2026-06-30.story-scene-asset-fallback-error-envelope.v1',
  status: 'public_error_envelope_contract',
  allowedFields: ['code', 'fallbackKey', 'shortLabelKey', 'retryable'],
  allowedCodes: STORY_SCENE_ASSET_FALLBACK_ERROR_CODES,
  privacy: {
    providerRawErrorReturned: false,
    signedUrlReturned: false,
    storageKeyReturned: false,
    privateUserInputReturned: false,
    internalCostReturned: false,
    rawStackReturned: false,
  },
  mutationPolicy: {
    providerCall: false,
    assetUploadIntentCreate: false,
    assetCreate: false,
    paymentMutation: false,
    walletMutation: false,
    settlementMutation: false,
    payoutMutation: false,
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function findStorySceneProviderGuardViolations(
  candidate: unknown,
  path = '',
): string[] {
  const forbiddenFields = new Set<string>(STORY_SCENE_FORBIDDEN_PROVIDER_FIELDS);

  if (Array.isArray(candidate)) {
    return candidate.flatMap((item, index) =>
      findStorySceneProviderGuardViolations(item, `${path}[${index}]`),
    );
  }

  if (!isRecord(candidate)) {
    return [];
  }

  return Object.entries(candidate).flatMap(([field, value]) => {
    const fieldPath = path ? `${path}.${field}` : field;
    const fieldViolation = forbiddenFields.has(field) ? [fieldPath] : [];

    return [
      ...fieldViolation,
      ...findStorySceneProviderGuardViolations(value, fieldPath),
    ];
  });
}

export const STORY_SCENE_BACKGROUND_STATE_RESOLVER_CONTRACT = {
  version: '2026-06-29.story-scene-background-state-resolver.v1',
  status: 'read_only_contract',
  inputAuthority: {
    sceneProjection: 'story_session_scenes.safe_text_projection',
    publicBackgroundAsset: 'story_scene_assets.public_background_asset',
    fallbackKey: 'story_scene_asset_fallback_keys.public_i18n_key',
  },
  states: STORY_SCENE_BACKGROUND_STATES,
  fallbackBehavior: {
    missingAssetUsesDefaultBackground: true,
    loadingWithoutAssetUsesDefaultBackground: true,
    fallbackKeyRequired: true,
    defaultFallbackKey: STORY_SCENE_DEFAULT_FALLBACK_KEY,
  },
  privacy: {
    rawPromptReturned: false,
    providerUrlReturned: false,
    internalStorageKeyReturned: false,
    signedUrlReturned: false,
  },
  mutationPolicy: {
    providerCall: false,
    storySceneWrite: false,
    assetCreate: false,
    paymentMutation: false,
    walletMutation: false,
    settlementMutation: false,
    payoutMutation: false,
  },
} as const;

export const STORY_SCENE_CHARACTER_LAYER_READ_MODEL_CONTRACT = {
  version: '2026-06-29.story-scene-character-layer-read-model.v1',
  status: 'read_only_contract',
  fields: STORY_SCENE_ALLOWED_CHARACTER_FIELDS,
  allowedPoses: STORY_SCENE_CHARACTER_POSES,
  allowedLayers: STORY_SCENE_CHARACTER_LAYERS,
  allowedEntranceStates: STORY_SCENE_CHARACTER_ENTRANCE_STATES,
  layerOrder: STORY_SCENE_CHARACTER_LAYER_ORDER,
  emptySceneBehavior: {
    charactersReturnedAsEmptyArray: true,
    fallbackKeyStillReturned: true,
  },
  privacy: {
    privatePersonaReturned: false,
    rawPromptReturned: false,
    providerPayloadReturned: false,
    storageKeyReturned: false,
  },
  mutationPolicy: {
    characterGeneration: false,
    providerCall: false,
    storyProgressMutation: false,
    paymentMutation: false,
    walletMutation: false,
  },
} as const;

export const STORY_SCENE_FIXTURE_API_CONTRACT = {
  version: '2026-06-29.story-scene-fixture-api.v1',
  status: 'fixture_contract_ready_route_disabled',
  endpoint: {
    method: 'GET',
    path: '/api/v1/story-sessions/fixtures/story-scene-preview/scenes',
    enabled: false,
    authRequired: false,
    fixtureFlag: 'storySceneFixturePreview',
    response: 'StorySceneReadModel[]',
  },
  fixturePolicy: {
    minimumScenes: 3,
    providerCallRequired: false,
    includesCharacterPresentScene: true,
    includesCharacterAbsentScene: true,
    includesFallbackBackgroundScene: true,
    privatePromptAllowed: false,
    providerPayloadAllowed: false,
  },
  localeFields: STORY_SCENE_FIXTURE_LOCALE_FIELD_CONTRACT,
  handoffConsumers: ['cloud', 'viewer', 'qa2'],
} as const;

export const STORY_SCENE_PROVIDER_GUARD_CONTRACT = {
  version: '2026-06-29.story-scene-provider-guard.v1',
  status: 'provider_expansion_guard_contract',
  guardedSurfaces: ['story_scene_read_model', 'story_scene_fixture_api'],
  allowedTopLevelFields: STORY_SCENE_ALLOWED_RESPONSE_FIELDS,
  allowedBackgroundAssetFields: STORY_SCENE_ALLOWED_BACKGROUND_ASSET_FIELDS,
  allowedCharacterFields: STORY_SCENE_ALLOWED_CHARACTER_FIELDS,
  forbiddenResponseFields: STORY_SCENE_FORBIDDEN_PROVIDER_FIELDS,
  validationOrder: [
    'project_scene_from_safe_read_sources',
    'resolve_background_state_without_provider_call',
    'sort_character_layers_without_generation',
    'strip_provider_and_private_fields',
    'return_fixture_or_read_model_projection',
  ],
  privacy: {
    rawPromptReturned: false,
    providerPayloadReturned: false,
    providerResponseReturned: false,
    internalCostReturned: false,
    privateUserInputReturned: false,
    privatePersonaReturned: false,
    storageKeyReturned: false,
    signedUrlReturned: false,
  },
  mutationPolicy: {
    providerCall: false,
    imageGeneration: false,
    videoGeneration: false,
    storyProgressMutation: false,
    storySceneWrite: false,
    paymentMutation: false,
    walletMutation: false,
    settlementMutation: false,
    payoutMutation: false,
  },
} as const;

export const STORY_SCENE_READ_MODEL_CONTRACT = {
  version: STORY_SCENE_READ_MODEL_VERSION,
  status: 'read_model_contract_with_fixture_projection',
  fields: STORY_SCENE_ALLOWED_RESPONSE_FIELDS,
  backgroundAssetFields: STORY_SCENE_ALLOWED_BACKGROUND_ASSET_FIELDS,
  characterFields: STORY_SCENE_ALLOWED_CHARACTER_FIELDS,
  backgroundStateResolver: STORY_SCENE_BACKGROUND_STATE_RESOLVER_CONTRACT,
  characterLayerReadModel: STORY_SCENE_CHARACTER_LAYER_READ_MODEL_CONTRACT,
  currentSceneEndpointDelta: STORY_SCENE_CURRENT_SCENE_ENDPOINT_DELTA_CONTRACT,
  choiceProgressWriteGuard: STORY_SCENE_CHOICE_PROGRESS_WRITE_GUARD_CONTRACT,
  fixtureLocaleFields: STORY_SCENE_FIXTURE_LOCALE_FIELD_CONTRACT,
  characterVisibilityResolver:
    STORY_SCENE_CHARACTER_VISIBILITY_RESOLVER_CONTRACT,
  assetFallbackErrorEnvelope:
    STORY_SCENE_ASSET_FALLBACK_ERROR_ENVELOPE_CONTRACT,
  fixtureApiContract: STORY_SCENE_FIXTURE_API_CONTRACT,
  providerGuardContract: STORY_SCENE_PROVIDER_GUARD_CONTRACT,
  fixtures: {
    count: STORY_SCENE_FIXTURE_READ_MODELS.length,
    sceneIds: STORY_SCENE_FIXTURE_READ_MODELS.map((scene) => scene.sceneId),
  },
} as const;
