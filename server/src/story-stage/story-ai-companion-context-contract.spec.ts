import { STORY_AI_COMPANION_CONTEXT_BOUNDARY_CONTRACT } from './story-ai-companion-context-contract';

describe('Story AI companion context boundary contract', () => {
  it('caps companion artists and active speakers without enabling provider or story mutation', () => {
    expect(STORY_AI_COMPANION_CONTEXT_BOUNDARY_CONTRACT).toMatchObject({
      version: '2026-06-18.story-ai-companion-context-boundary.v1',
      status: 'context_boundary_contract_only',
      enabled: false,
      scope: {
        maxCompanionArtistsPerSession: 5,
        activeSpeakersPerScene: { min: 1, recommended: [2, 3], max: 3 },
        nonActiveCompanionRoles: [
          'cameo',
          'background',
          'offscreen_reference',
        ],
        providerCallEnabled: false,
        storyMutationEnabled: false,
      },
      companionRoles: {
        activeSpeaker: {
          canSpeakInScene: true,
          canDriveChoiceText: true,
          requiresPersonaToneContext: true,
          maxPerScene: 3,
        },
        cameo: {
          canSpeakInScene: 'brief_only',
          canDriveChoiceText: false,
          requiresPersonaToneContext: 'summary_only',
          maxPerScene: 5,
        },
        background: {
          canSpeakInScene: false,
          canDriveChoiceText: false,
          requiresPersonaToneContext: false,
          maxPerScene: 5,
        },
      },
    });
    expect(
      STORY_AI_COMPANION_CONTEXT_BOUNDARY_CONTRACT.participationBudget,
    ).toMatchObject({
      version: '2026-06-23.story-ai-companion-budget-guard.v1',
      targetMaxParticipantsIncludingPlayer: 6,
      playerIncluded: true,
      maxAiCompanionsPerSession: 5,
      freePrologue: {
        maxAiCompanions: 1,
        allowedModes: ['solo_player', 'one_ai_companion'],
        companionAddCostLumina: 0,
        companionSwapCostLumina: 0,
        paidExpansionAllowed: false,
      },
      paidStory: {
        maxAiCompanions: 5,
        companionAddCostPolicy: 'server_story_product_policy_required',
        companionSwapCostPolicy: 'server_story_product_policy_required',
        freeCompanionCarryOverAllowed: true,
        clientSubmittedCostAccepted: false,
      },
      contextBudgetGuard: {
        maxActiveSpeakersPerScene: 3,
        maxBackgroundCompanionsSummarized: 2,
        downgradeOverflowCompanionsTo: [
          'cameo',
          'background',
          'offscreen_reference',
        ],
        providerContextOverflowBehavior: 'summarize_or_exclude_before_provider',
        rawPromptBudgetReturned: false,
      },
      noMutationPolicy: {
        paymentMutation: false,
        walletMutation: false,
        luminaMutation: false,
        storyProgressMutation: false,
        providerCall: false,
      },
    });
    expect(
      Object.values(
        STORY_AI_COMPANION_CONTEXT_BOUNDARY_CONTRACT.noMutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
  });

  it('keeps world scene persona and player context layered without leaking raw prompts', () => {
    expect(STORY_AI_COMPANION_CONTEXT_BOUNDARY_CONTRACT.contextLayers).toMatchObject({
      world: {
        priority: 1,
        source: 'story_pack_world_bible',
        immutableDuringScene: true,
        playerCanOverride: false,
      },
      scene: {
        priority: 2,
        source: 'current_chapter_scene_state',
      },
      artistPersona: {
        priority: 3,
        source: 'approved_artist_persona_tone_profile',
        maxActiveProfilesInjected: 3,
        maxBackgroundProfilesSummarized: 2,
        rawPromptReturned: false,
      },
      playerState: {
        priority: 4,
        source: 'story_session_player_state_projection',
      },
    });
    expect(
      STORY_AI_COMPANION_CONTEXT_BOUNDARY_CONTRACT.boundaryRules,
    ).toMatchObject({
      preserveWorldCanon: true,
      preserveArtistTone: true,
      preserveSceneObjective: true,
      preventPersonaMerge: true,
      preventAllCompanionsSpeakingAtOnce: true,
      preventBackgroundRoleFromSolvingScene: true,
      preventPlayerChoiceFromOverridingCanon: true,
      rawProviderInstructionReturned: false,
    });
    expect(STORY_AI_COMPANION_CONTEXT_BOUNDARY_CONTRACT.privacy).toMatchObject({
      rawPersonaPromptReturned: false,
      rawWorldBibleReturned: false,
      providerPayloadReturned: false,
      privateArtistNotesReturned: false,
      adminMemoReturned: false,
    });
  });
});
