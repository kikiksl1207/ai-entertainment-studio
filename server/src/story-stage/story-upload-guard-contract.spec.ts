import {
  findStoryUploadSensitiveFieldViolations,
  STORY_ENDING_TYPE_BACKEND_POLICY_CONTRACT,
  STORY_HIATUS_PENALTY_PENDING_VALUES_GUARD_CONTRACT,
  STORY_STAGE_CONTRACT,
  STORY_UPLOAD_BACKEND_GUARD_CONTRACT,
  STORY_UPLOAD_FIXTURE_PRIVACY_GUARD_CONTRACT,
  STORY_UPLOAD_INTAKE_STORAGE_GUARD_CONTRACT,
  STORY_UPLOAD_PUBLIC_SOURCE_SAFETY_GUARD_CONTRACT,
} from './story-stage-contract';

describe('Story upload backend guard contracts', () => {
  it('exposes the Kaido story upload guard bundle through the stage aggregate', () => {
    expect(STORY_STAGE_CONTRACT.storyUploadBackendGuard).toBe(
      STORY_UPLOAD_BACKEND_GUARD_CONTRACT,
    );
    expect(STORY_UPLOAD_BACKEND_GUARD_CONTRACT).toMatchObject({
      status: 'contract_bundle_only',
      intakeStorageGuard: STORY_UPLOAD_INTAKE_STORAGE_GUARD_CONTRACT,
      endingTypePolicy: STORY_ENDING_TYPE_BACKEND_POLICY_CONTRACT,
      publicSourceSafetyGuard: STORY_UPLOAD_PUBLIC_SOURCE_SAFETY_GUARD_CONTRACT,
      hiatusPenaltyPendingValuesGuard:
        STORY_HIATUS_PENALTY_PENDING_VALUES_GUARD_CONTRACT,
      fixturePrivacyGuard: STORY_UPLOAD_FIXTURE_PRIVACY_GUARD_CONTRACT,
    });
    expect(
      Object.values(STORY_UPLOAD_BACKEND_GUARD_CONTRACT.mutationPolicy).every(
        (enabled) => enabled === false,
      ),
    ).toBe(true);
  });

  it('splits story upload intake storage into normalized read-model slices', () => {
    expect(
      STORY_UPLOAD_INTAKE_STORAGE_GUARD_CONTRACT.normalizedSlices,
    ).toMatchObject({
      work: expect.arrayContaining([
        'storyUploadId',
        'title',
        'reviewStatusKey',
      ]),
      scenes: expect.arrayContaining([
        'sceneId',
        'backgroundRef',
        'castRefs',
      ]),
      choices: expect.arrayContaining(['choiceId', 'nextSceneId', 'branchId']),
      endings: expect.arrayContaining(['endingId', 'sceneId', 'endingType']),
    });
    expect(STORY_UPLOAD_INTAKE_STORAGE_GUARD_CONTRACT.localeExpansion).toEqual({
      slots: ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'],
      i18nKeyRequiredForUserCopy: true,
      rawLocaleBlobStoredAsPrimary: false,
    });
    expect(STORY_UPLOAD_INTAKE_STORAGE_GUARD_CONTRACT.forbiddenStorageFields).toEqual(
      expect.arrayContaining([
        'rawPrompt',
        'providerPayload',
        'rawAccountId',
        'rawEmail',
        'dbUrl',
      ]),
    );
  });

  it('separates author endings from AI fallback endings', () => {
    expect(STORY_ENDING_TYPE_BACKEND_POLICY_CONTRACT.endingTypes).toEqual([
      'author_main',
      'author_sub',
      'ai_fallback',
    ]);
    expect(STORY_ENDING_TYPE_BACKEND_POLICY_CONTRACT.authorMain).toMatchObject({
      required: true,
      exactCount: 1,
    });
    expect(STORY_ENDING_TYPE_BACKEND_POLICY_CONTRACT.authorSub).toMatchObject({
      required: false,
      minWhenProvided: 2,
      maxWhenProvided: 10,
    });
    expect(STORY_ENDING_TYPE_BACKEND_POLICY_CONTRACT.aiFallback).toMatchObject({
      allowedOnlyWhenWriterBranchMissing: true,
      mayReplaceAuthorEnding: false,
    });
    expect(
      STORY_ENDING_TYPE_BACKEND_POLICY_CONTRACT.displaySeparation
        .aiFallbackMustNotUseAuthorBadge,
    ).toBe(true);
  });

  it('requires PM review flags for public-source uncertainty and modern references', () => {
    expect(
      STORY_UPLOAD_PUBLIC_SOURCE_SAFETY_GUARD_CONTRACT.publicSourceCandidates,
    ).toEqual(
      expect.arrayContaining([
        'three_kingdoms',
        'imjin_war',
        'greek_myth',
        'norse_myth',
        'cthulhu_public_domain_candidate',
      ]),
    );
    expect(
      STORY_UPLOAD_PUBLIC_SOURCE_SAFETY_GUARD_CONTRACT.pmReviewRequiredWhen,
    ).toEqual(
      expect.arrayContaining([
        'modern_game_unique_expression',
        'modern_webtoon_unique_expression',
        'modern_translation_unique_wording',
        'uncertain_public_domain_status',
      ]),
    );
    expect(
      STORY_UPLOAD_PUBLIC_SOURCE_SAFETY_GUARD_CONTRACT.rewritePolicy,
    ).toMatchObject({
      luminaOriginalVoiceRequired: true,
      copiedModernTranslationAllowed: false,
      automaticCopyrightClearance: false,
    });
  });

  it('keeps hiatus penalty values pending until PM decides and protects completed chapters', () => {
    expect(
      STORY_HIATUS_PENALTY_PENDING_VALUES_GUARD_CONTRACT.pendingDecisionKeys,
    ).toEqual([
      'longHiatusDayThreshold',
      'firstWarningDay',
      'settlementRateReductionSteps',
      'partialRefundFormula',
    ]);
    expect(
      STORY_HIATUS_PENALTY_PENDING_VALUES_GUARD_CONTRACT.placeholderPolicy,
    ).toMatchObject({
      unsetValuesUseStableKey: 'pending_pm_decision',
      clientSubmittedPenaltyValuesTrusted: false,
      operatorDecisionRequiredBeforeEnforcement: true,
    });
    expect(
      STORY_HIATUS_PENALTY_PENDING_VALUES_GUARD_CONTRACT
        .completedChapterProtection,
    ).toMatchObject({
      alreadyCompletedChapterRateLocked: true,
      retroactivePenaltyOnCompletedChapters: false,
      settledOrPayoutRowsRewritten: false,
    });
  });

  it('keeps story upload fixtures separate and rejects sensitive fields', () => {
    expect(STORY_UPLOAD_FIXTURE_PRIVACY_GUARD_CONTRACT.fixtureNamespace).toMatchObject({
      prefix: 'story-upload-fixture-',
      realAuthorUploadMixingAllowed: false,
      publicDummyTextOnly: true,
    });
    expect(STORY_UPLOAD_FIXTURE_PRIVACY_GUARD_CONTRACT.allowedReportFields).toEqual(
      expect.arrayContaining([
        'runId',
        'fixtureNamespace',
        'storyUploadPreviewPath',
        'reviewStatusKey',
        'publicSceneCount',
      ]),
    );
    expect(
      findStoryUploadSensitiveFieldViolations({
        runId: 'story-upload-fixture-20260701-run1',
        author: {
          rawEmail: 'not-allowed',
          rawAccountId: 'not-allowed',
        },
        scene: {
          providerPayload: { rawPrompt: 'not-allowed' },
          storageKey: 'not-allowed',
        },
      }),
    ).toEqual([
      'author.rawEmail',
      'author.rawAccountId',
      'scene.providerPayload',
      'scene.providerPayload.rawPrompt',
      'scene.storageKey',
    ]);
  });
});
