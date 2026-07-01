import { STORY_STAGE_CONTRACT } from './story-stage-contract';
import {
  findStoryManuscriptSensitiveFieldViolations,
  MANUSCRIPT_SCENE_EXTRACTION_CONTRACT,
  PUBLIC_SOURCE_STORY_COPYRIGHT_BOUNDARY_CONTRACT,
  STORY_BRANCH_MARKER_INGESTION_CONTRACT,
  STORY_CHAT_PLAY_SCENE_READ_MODEL_SUPPORT_CONTRACT,
  STORY_MANUSCRIPT_PIPELINE_CONTRACT,
  WRITER_MANUSCRIPT_HANDOFF_FORMAT_CONTRACT,
} from './story-manuscript-ingestion-contract';

describe('Story manuscript ingestion and chat-play read-model contracts', () => {
  it('exposes the five Luffy handoff contracts from the aggregate bundle', () => {
    expect(STORY_STAGE_CONTRACT.storyManuscriptPipeline).toBe(
      STORY_MANUSCRIPT_PIPELINE_CONTRACT,
    );
    expect(STORY_STAGE_CONTRACT.storyChatPlaySceneReadModelSupport).toBe(
      STORY_CHAT_PLAY_SCENE_READ_MODEL_SUPPORT_CONTRACT,
    );
    expect(STORY_STAGE_CONTRACT.writerManuscriptHandoffFormat).toBe(
      WRITER_MANUSCRIPT_HANDOFF_FORMAT_CONTRACT,
    );
    expect(STORY_STAGE_CONTRACT.storyBranchMarkerIngestion).toBe(
      STORY_BRANCH_MARKER_INGESTION_CONTRACT,
    );
    expect(STORY_STAGE_CONTRACT.manuscriptSceneExtraction).toBe(
      MANUSCRIPT_SCENE_EXTRACTION_CONTRACT,
    );
    expect(STORY_STAGE_CONTRACT.publicSourceStoryCopyrightBoundary).toBe(
      PUBLIC_SOURCE_STORY_COPYRIGHT_BOUNDARY_CONTRACT,
    );
  });

  it('supports chat play with current-scene asset and character projections', () => {
    expect(
      STORY_CHAT_PLAY_SCENE_READ_MODEL_SUPPORT_CONTRACT.sceneAssetFields,
    ).toEqual(
      expect.arrayContaining([
        'backgroundAsset',
        'backgroundPromptKey',
        'backgroundState',
        'characters',
        'characterPose',
        'entranceState',
        'fallbackKey',
      ]),
    );
    expect(
      STORY_CHAT_PLAY_SCENE_READ_MODEL_SUPPORT_CONTRACT
        .sceneProjectionCompatibility,
    ).toMatchObject({
      chatTurnsReferenceSceneId: true,
      choicesReferenceNextSceneHint: true,
      currentSceneIsAuthoritative: true,
    });
    expect(
      STORY_CHAT_PLAY_SCENE_READ_MODEL_SUPPORT_CONTRACT.fixtureCoverage,
    ).toMatchObject({
      minimumScenes: 3,
      includesBackgroundChange: true,
      includesCharacterPresentScene: true,
      includesCharacterAbsentScene: true,
      includesFallbackBackgroundScene: true,
    });
    expect(
      STORY_CHAT_PLAY_SCENE_READ_MODEL_SUPPORT_CONTRACT.privacy,
    ).toMatchObject({
      rawPromptReturned: false,
      providerPayloadReturned: false,
      storageKeyReturned: false,
      signedUrlReturned: false,
      privateNoteReturned: false,
    });
  });

  it('defines writer manuscript handoff as long prose with parser-ready markers', () => {
    expect(WRITER_MANUSCRIPT_HANDOFF_FORMAT_CONTRACT.acceptedSubmissionShape).toEqual({
      primaryDocument: 'long_body_manuscript',
      branchMarkersRequired: true,
      sceneMarkersRequired: true,
      backgroundMarkersRequired: true,
      castMarkersRecommended: true,
    });
    expect(WRITER_MANUSCRIPT_HANDOFF_FORMAT_CONTRACT.deprecatedShape).toEqual({
      gameDesignDocFirst: false,
      userRoleSheetFirst: false,
      choiceSpreadsheetFirst: false,
    });
    expect(WRITER_MANUSCRIPT_HANDOFF_FORMAT_CONTRACT.minimumPolicy).toMatchObject(
      {
        minimumBodyCharactersBeforeFirstBranch: 1200,
        branchMarkerIdPattern: 'B\\d{2}',
        sceneMarkerIdPattern: '\\d+[A-Z]?',
        everySceneNeedsBackgroundOrFallback: true,
      },
    );
    expect(WRITER_MANUSCRIPT_HANDOFF_FORMAT_CONTRACT.downstreamHandoff).toMatchObject(
      {
        copyAndTranslationOwner: 'emily',
        localeSlots: ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'],
      },
    );
  });

  it('ingests branch markers into a scene-choice graph that may rejoin common scenes', () => {
    expect(STORY_BRANCH_MARKER_INGESTION_CONTRACT.graphModel).toMatchObject({
      nodeTypes: ['scene', 'choice', 'merge'],
      branchIdField: 'branchId',
      sceneIdField: 'sceneId',
      choiceIdField: 'choiceId',
      mergeTargetSceneIdField: 'mergeTargetSceneId',
      branchesMayRejoinCommonScene: true,
      fullyDivergentBranchesRequired: false,
    });
    expect(STORY_BRANCH_MARKER_INGESTION_CONTRACT.choiceSemantics).toMatchObject({
      mustNotBeTriviaAnswer: true,
      allowedAxes: ['personality', 'strategy', 'relationship', 'risk'],
      labelKeyRequired: true,
      nextSceneHintRequired: true,
    });
    expect(STORY_BRANCH_MARKER_INGESTION_CONTRACT.ingestionOrder).toEqual([
      'normalize_marker_tokens',
      'create_scene_nodes',
      'create_choice_edges',
      'attach_merge_targets',
      'return_read_model_without_progress_write',
    ]);
  });

  it('extracts manuscript scenes into background, character, narration, and dialogue projections', () => {
    expect(MANUSCRIPT_SCENE_EXTRACTION_CONTRACT.extractedSceneFields).toEqual(
      expect.arrayContaining([
        'sceneText',
        'narrationBlocks',
        'dialogueTurns',
        'backgroundAssetHintKey',
        'backgroundPromptKey',
        'characters',
        'fallbackKey',
      ]),
    );
    expect(MANUSCRIPT_SCENE_EXTRACTION_CONTRACT.backgroundPolicy).toMatchObject({
      minimumBackgroundsPerScene: 1,
      missingBackgroundRequiresFallbackKey: true,
      rawPromptAsUserCopyAllowed: false,
    });
    expect(MANUSCRIPT_SCENE_EXTRACTION_CONTRACT.characterPolicy).toMatchObject({
      entranceStateRequired: true,
      exitCanMapToEntranceState: 'exiting',
      absentCanMapToLayer: 'offscreen',
    });
    expect(MANUSCRIPT_SCENE_EXTRACTION_CONTRACT.privacy).toMatchObject({
      rawPromptReturned: false,
      providerPayloadReturned: false,
      privateNoteReturned: false,
      storageKeyReturned: false,
      signedUrlReturned: false,
    });
  });

  it('sets public-source copyright boundaries before Emily translation handoff', () => {
    expect(
      PUBLIC_SOURCE_STORY_COPYRIGHT_BOUNDARY_CONTRACT.allowedSourceClasses,
    ).toEqual(
      expect.arrayContaining([
        'public_domain_history',
        'public_domain_myth',
        'public_domain_classic_literature',
      ]),
    );
    expect(
      PUBLIC_SOURCE_STORY_COPYRIGHT_BOUNDARY_CONTRACT.forbiddenReferenceClasses,
    ).toEqual(
      expect.arrayContaining([
        'modern_game_unique_expression',
        'modern_webtoon_unique_expression',
        'modern_anime_unique_expression',
        'modern_translation_unique_wording',
      ]),
    );
    expect(
      PUBLIC_SOURCE_STORY_COPYRIGHT_BOUNDARY_CONTRACT.rewritePolicy,
    ).toMatchObject({
      luminaOriginalVoiceRequired: true,
      originalSceneCompositionRequired: true,
      originalCharacterInterpretationRequired: true,
      copiedModernTranslationAllowed: false,
    });
    expect(
      PUBLIC_SOURCE_STORY_COPYRIGHT_BOUNDARY_CONTRACT.specialReviewTopics,
    ).toMatchObject({
      cthulhuOrLaterDerivativeSettingRequiresPmReview: true,
      uncertainPublicDomainStatusRequiresPmReview: true,
    });
  });

  it('keeps the manuscript pipeline read-only and rejects sensitive fields', () => {
    expect(
      Object.values(STORY_MANUSCRIPT_PIPELINE_CONTRACT.mutationPolicy).every(
        (enabled) => enabled === false,
      ),
    ).toBe(true);
    expect(
      findStoryManuscriptSensitiveFieldViolations({
        sceneId: 'scene-1',
        backgroundAsset: { signedUrl: 'not-allowed' },
        branch: {
          providerPayload: { rawPrompt: 'not-allowed' },
          privateNote: 'not-allowed',
        },
        author: { rawEmail: 'not-allowed' },
      }),
    ).toEqual([
      'backgroundAsset.signedUrl',
      'branch.providerPayload',
      'branch.providerPayload.rawPrompt',
      'branch.privateNote',
      'author.rawEmail',
    ]);
  });
});
