import { STORY_STAGE_CONTRACT } from './story-stage-contract';
import {
  findStoryUploadIntakeSensitiveFieldViolations,
  STORY_UPLOAD_CONTRACT_BUNDLE,
  STORY_UPLOAD_I18N_HANDOFF_KEY_PACKAGE,
  STORY_UPLOAD_INTAKE_ENDING_TYPES,
  STORY_UPLOAD_IMPORT_EXPORT_MIGRATION_CONTRACT,
  STORY_UPLOAD_INTAKE_API_CONTRACT,
  STORY_UPLOAD_REVIEW_STATUSES,
  STORY_UPLOAD_REVIEW_WORKFLOW_CONTRACT,
  STORY_UPLOAD_SAFE_DTO_FIELD_GROUPS,
  WRITER_MANUSCRIPT_SCENE_CHOICE_ENDING_SCHEMA,
} from './story-upload-intake-contract';

describe('Story upload intake contract bundle', () => {
  it('exposes all five upload handoff contracts from the aggregate bundle', () => {
    expect(STORY_STAGE_CONTRACT.storyUploadIntakeApi).toBe(
      STORY_UPLOAD_INTAKE_API_CONTRACT,
    );
    expect(
      STORY_STAGE_CONTRACT.writerManuscriptSceneChoiceEndingSchema,
    ).toBe(WRITER_MANUSCRIPT_SCENE_CHOICE_ENDING_SCHEMA);
    expect(STORY_STAGE_CONTRACT.storyUploadImportExportMigration).toBe(
      STORY_UPLOAD_IMPORT_EXPORT_MIGRATION_CONTRACT,
    );
    expect(STORY_STAGE_CONTRACT.storyUploadReviewWorkflow).toBe(
      STORY_UPLOAD_REVIEW_WORKFLOW_CONTRACT,
    );
    expect(STORY_STAGE_CONTRACT.storyUploadI18nHandoffKeyPackage).toBe(
      STORY_UPLOAD_I18N_HANDOFF_KEY_PACKAGE,
    );
    expect(STORY_STAGE_CONTRACT.storyUploadContractBundle).toBe(
      STORY_UPLOAD_CONTRACT_BUNDLE,
    );
  });

  it('defines an authenticated, persistent, safe-receipt intake API', () => {
    expect(STORY_UPLOAD_INTAKE_API_CONTRACT).toMatchObject({
      status: 'authenticated_persistence_implemented',
      sourceReference: {
        pmBoardIsAuthority: true,
        externalPageContentPersisted: false,
      },
      dtoFieldGroups: STORY_UPLOAD_SAFE_DTO_FIELD_GROUPS,
      partDefaults: {
        partTextLengthTarget: 10_000,
        branchSummaryLengthLimit: 2_000,
        defaultShortPlayPartCount: 10,
        branchSummaryMayReplaceManuscriptBody: false,
      },
      requiredSeparation: {
        workInfoSeparateFromScenes: true,
        choicesSeparateFromSceneText: true,
        choiceResultDeltasSeparateFromNextScene: true,
        endingTypeSeparateFromReviewStatus: true,
        reviewStatusSeparateFromPublishMutation: true,
      },
      endpoints: {
        intakeSubmit: {
          method: 'POST',
          path: '/api/v1/story-upload/intake',
          enabled: true,
          authRequired: true,
          contentType: 'multipart/form-data',
          idempotentRetry: true,
        },
      },
      persistenceBoundary: {
        submissionTable: 'story_upload_submissions',
        fileTable: 'story_upload_submission_files',
        objectStorageRequiredOutsideDevelopment: true,
        privateStorageKeyReturned: false,
        rightsReferenceReturned: false,
      },
    });
    expect(STORY_UPLOAD_SAFE_DTO_FIELD_GROUPS.work).toEqual(
      expect.arrayContaining([
        'partIndex',
        'partCount',
        'partTextLengthTarget',
        'branchSummaryLengthLimit',
      ]),
    );
    expect(STORY_UPLOAD_SAFE_DTO_FIELD_GROUPS.choices).toEqual(
      expect.arrayContaining([
        'choiceBodyKey',
        'resultDeltaKeys',
        'relationshipDeltaKey',
        'riskDeltaKey',
        'itemDeltaKey',
        'informationDeltaKey',
        'endingConditionKey',
      ]),
    );
    expect(STORY_UPLOAD_INTAKE_API_CONTRACT.branchChoiceResultAxes).toEqual([
      'relationship',
      'risk',
      'item',
      'information',
      'ending_condition',
    ]);
    expect(STORY_UPLOAD_INTAKE_API_CONTRACT.validationFailureConditions).toEqual(
      expect.arrayContaining([
        'branch_summary_replaces_manuscript_body',
        'branch_summary_over_length_limit',
        'all_choices_share_same_next_scene_body_and_result',
      ]),
    );
    expect(STORY_UPLOAD_INTAKE_API_CONTRACT.endpoints).toMatchObject({
      intakePreview: { enabled: false },
      intakeValidate: { enabled: false },
      intakeSubmit: { enabled: true, authRequired: true },
    });
    expect(STORY_UPLOAD_INTAKE_API_CONTRACT.mobileStatusKeys).toEqual([
      'storyUpload.status.draft',
      'storyUpload.status.pmReview',
      'storyUpload.status.needsRevision',
      'storyUpload.status.localeReady',
      'storyUpload.status.qaReady',
      'storyUpload.status.publishReady',
      'storyUpload.status.blocked',
    ]);
    expect(STORY_UPLOAD_INTAKE_API_CONTRACT.mutationPolicy).toMatchObject({
      uploadWrite: true,
      intakeDbWrite: true,
      objectStorageWrite: true,
      publishMutation: false,
      providerGeneration: false,
      paymentMutation: false,
      walletMutation: false,
    });
  });

  it('keeps #1523 manuscript-first with scene, branch, background, cast, and ending markers', () => {
    expect(WRITER_MANUSCRIPT_SCENE_CHOICE_ENDING_SCHEMA).toMatchObject({
      status: 'schema_contract_only',
      manuscriptFirst: true,
      partStructure: {
        partTextLengthTarget: 10_000,
        defaultShortPlayPartCount: 10,
        singlePartApproxCharacters: 10_000,
      },
      branchSummaryPolicy: {
        maxCharactersPerBranch: 2_000,
        mayReplaceManuscriptBody: false,
      },
      sceneChoiceRules: {
        multipleChoicesPerSceneAllowed: true,
        treeRootBranchingIsDefault: true,
        choiceCanTargetNextScene: true,
        choiceCanHaveDistinctBody: true,
        choiceResultDifferenceRequired: true,
        choiceResultDifferenceRequiredBeforeMerge: true,
        choiceCanRejoinCommonScene: true,
        resultDifferenceAxes: [
          'relationship',
          'risk',
          'item',
          'information',
          'ending_condition',
        ],
        choiceOnlyGameDesignUploadIsDefault: false,
      },
    });
    expect(
      WRITER_MANUSCRIPT_SCENE_CHOICE_ENDING_SCHEMA.acceptedMarkers,
    ).toMatchObject({
      scene: expect.arrayContaining(['[\uC7A5\uBA74]']),
      branch: expect.arrayContaining(['[\uBD84\uAE30\uC810]']),
      background: expect.arrayContaining(['[\uBC30\uACBD]']),
      cast: expect.arrayContaining(['[\uB4F1\uC7A5 \uCE90\uB9AD\uD130]']),
      ending: expect.arrayContaining(['[\uC5D4\uB529]']),
    });
    expect(STORY_UPLOAD_INTAKE_ENDING_TYPES).toEqual([
      'writer_primary_ending',
      'writer_sub_ending',
      'ai_fallback_ending',
    ]);
    expect(
      WRITER_MANUSCRIPT_SCENE_CHOICE_ENDING_SCHEMA.endingTypes,
    ).toMatchObject({
      writerPrimaryEnding: {
        writerAuthored: true,
        isDefaultCanonical: true,
      },
      writerSubEnding: {
        writerAuthored: true,
        canBeBranchSpecific: true,
      },
      aiFallbackEnding: {
        generatedByProviderAtIntake: false,
        labelRequired: true,
        mustRemainVisiblyMarked: true,
      },
    });
    expect(
      WRITER_MANUSCRIPT_SCENE_CHOICE_ENDING_SCHEMA.failureConditions,
    ).toEqual(
      expect.arrayContaining([
        'choice_only_game_design_uploaded_as_primary',
        'ending_type_missing',
        'ai_fallback_ending_unlabeled',
        'branch_summary_replaces_manuscript_body',
        'all_choices_share_same_next_scene_body_and_result',
      ]),
    );
  });

  it('maps #1524 import/export by stable ids without Notion or private internals', () => {
    expect(
      STORY_UPLOAD_IMPORT_EXPORT_MIGRATION_CONTRACT.stableIdentifiers,
    ).toMatchObject({
      workId: 'story_upload_work_id',
      sceneId: 'story_upload_scene_id',
      branchId: 'story_upload_branch_id',
      endingId: 'story_upload_ending_id',
    });
    expect(
      STORY_UPLOAD_IMPORT_EXPORT_MIGRATION_CONTRACT.explicitlyNotSourceOfTruth,
    ).toEqual(
      expect.arrayContaining(['notion_page_id', 'notion_block_id']),
    );
    expect(
      STORY_UPLOAD_IMPORT_EXPORT_MIGRATION_CONTRACT.exportFieldDenylist,
    ).toEqual(
      expect.arrayContaining([
        'rawCredential',
        'privateAccountId',
        'providerPayload',
        'paymentInternalValue',
        'settlementInternalValue',
        'walletLedgerId',
      ]),
    );
    expect(
      STORY_UPLOAD_IMPORT_EXPORT_MIGRATION_CONTRACT.fixtureExamples,
    ).toEqual([
      expect.objectContaining({
        workId: 'story-upload-work-fixture',
        sceneId: 'scene-001',
        branchId: 'B01',
        endingId: 'ending-writer-primary',
      }),
    ]);
    expect(
      Object.values(
        STORY_UPLOAD_IMPORT_EXPORT_MIGRATION_CONTRACT.mutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
  });

  it('defines #1525 review workflow statuses, blockers, handoff gates, and no publish mutation', () => {
    expect(STORY_UPLOAD_REVIEW_STATUSES).toEqual([
      'draft',
      'pm_review',
      'needs_revision',
      'locale_ready',
      'qa_ready',
      'publish_ready',
      'blocked',
    ]);
    expect(STORY_UPLOAD_REVIEW_WORKFLOW_CONTRACT.blockerReasonKeys).toEqual(
      expect.arrayContaining([
        'storyUpload.blocker.copyrightReviewRequired',
        'storyUpload.blocker.cthulhuDerivativeReviewRequired',
        'storyUpload.blocker.aiFallbackEndingLabelRequired',
      ]),
    );
    expect(STORY_UPLOAD_REVIEW_WORKFLOW_CONTRACT.handoffGates).toMatchObject({
      emilyLocalePackage: {
        requiresStatus: 'locale_ready',
        requiresNoBlockerReason: true,
      },
      viewerMobileReview: {
        requiresStatus: 'qa_ready',
        primaryMobileWidth: '390-400px',
      },
      qaContractReview: {
        requiresStatus: 'qa_ready',
        noRawKeyVisible: true,
      },
    });
    expect(
      Object.values(STORY_UPLOAD_REVIEW_WORKFLOW_CONTRACT.mutationPolicy).every(
        (enabled) => enabled === false,
      ),
    ).toBe(true);
  });

  it('packages #1526 i18n keys for every locale slot with mobile-safe copy limits', () => {
    expect(STORY_UPLOAD_I18N_HANDOFF_KEY_PACKAGE.localeSlots).toEqual([
      'ko',
      'en',
      'ja',
      'zh-Hans',
      'zh-Hant',
    ]);
    expect(
      STORY_UPLOAD_I18N_HANDOFF_KEY_PACKAGE.requiredKeyGroups,
    ).toMatchObject({
      statuses: STORY_UPLOAD_INTAKE_API_CONTRACT.mobileStatusKeys,
      warnings: STORY_UPLOAD_REVIEW_WORKFLOW_CONTRACT.blockerReasonKeys,
      endingTypes: [
        'storyUpload.ending.writerPrimary',
        'storyUpload.ending.writerSub',
        'storyUpload.ending.aiFallback',
      ],
    });
    expect(STORY_UPLOAD_I18N_HANDOFF_KEY_PACKAGE.mobileCopyLimits).toMatchObject({
      primaryMobileWidth: '390-400px',
      buttonMaxCharactersKo: 8,
      statusMaxCharactersKo: 10,
      warningShortLabelMaxCharactersKo: 14,
    });
    expect(STORY_UPLOAD_I18N_HANDOFF_KEY_PACKAGE.rawKeyPolicy).toMatchObject({
      rawKeyVisible: false,
      singleLocaleOnlyAllowed: false,
      missingTranslationBlocksQaReady: true,
    });
  });

  it('opens intake persistence only and detects nested sensitive fields', () => {
    expect(STORY_UPLOAD_CONTRACT_BUNDLE.mutationPolicy).toMatchObject({
      uploadWrite: true,
      intakeDbWrite: true,
      objectStorageWrite: true,
      publishMutation: false,
      migrationWrite: false,
      providerGeneration: false,
      paymentMutation: false,
      walletMutation: false,
      settlementMutation: false,
      payoutMutation: false,
    });
    expect(
      findStoryUploadIntakeSensitiveFieldViolations({
        workId: 'fixture',
        auth: { token: 'not-allowed' },
        submitter: { rawEmail: 'not-allowed' },
        provider: {
          providerPayload: {
            storageKey: 'not-allowed',
          },
        },
        billing: { settlementInternalValue: 'not-allowed' },
      }),
    ).toEqual([
      'auth.token',
      'submitter.rawEmail',
      'provider.providerPayload',
      'provider.providerPayload.storageKey',
      'billing.settlementInternalValue',
    ]);
  });
});
