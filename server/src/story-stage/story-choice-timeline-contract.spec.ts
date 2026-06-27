import { STORY_CHOICE_TIMELINE_READ_MODEL_CONTRACT } from './story-choice-timeline-contract';

describe('Story choice timeline read model contract', () => {
  it('publishes bounded choice projection and major event timeline read model without mutation', () => {
    expect(STORY_CHOICE_TIMELINE_READ_MODEL_CONTRACT).toMatchObject({
      version: '2026-06-18.story-choice-timeline-read-model.v1',
      status: 'read_model_contract_only',
      enabled: false,
      surfaces: ['story_session_choices', 'story_major_event_timeline'],
      choicePolicy: {
        defaultChoiceCount: 3,
        maxChoiceCount: 5,
        minChoiceCount: 1,
        rawGeneratedChoiceReturned: false,
        clientSubmittedChoiceSetAllowed: false,
      },
      choiceProjection: {
        field: 'story.choices[]',
        choiceTypes: [
          'dialogue',
          'physical_action',
          'investigation',
          'travel',
          'wait',
          'letter_or_report',
        ],
        availabilityStates: ['available', 'locked', 'disabled'],
        rawEnumAsUiCopy: false,
      },
      majorEventTimeline: {
        field: 'story.timeline.majorEvents[]',
        eventKinds: [
          'public_incident',
          'private_revelation',
          'relationship_shift',
          'world_state_change',
          'chapter_climax',
          'season_marker',
        ],
        playerKnowledgeStates: [
          'witnessed',
          'heard_as_rumor',
          'received_report',
          'unknown_to_player',
        ],
        privateSpoilerBodyReturnedWhenUnknown: false,
        rawAuthorNotesReturned: false,
      },
      timelineAnchorReadModel: {
        version: '2026-06-23.story-timeline-anchor-read-model.v1',
        status: 'read_model_contract_only',
        endpoint: 'GET /api/v1/story-sessions/:sessionId/timeline-anchors',
        sourceOfTruth: 'story_timeline_anchors',
        canonicalOrdering: {
          orderField: 'anchorNo',
          stableTieBreakers: ['occurredAtStoryTime', 'id'],
          clientSubmittedOrderTrusted: false,
          branchLocalEventMayNotReorderCanonicalAnchors: true,
        },
        anchorKinds: [
          'world_event',
          'regional_incident',
          'character_milestone',
          'faction_shift',
          'chapter_climax',
          'season_marker',
        ],
        playerKnowledgeStates: [
          'witnessed',
          'informed',
          'rumor',
          'not_yet_revealed',
        ],
      },
    });
    expect(
      STORY_CHOICE_TIMELINE_READ_MODEL_CONTRACT.validationOrder,
    ).toEqual([
      'load_story_session_or_public_preview',
      'resolve_current_chapter_and_scene',
      'load_canonical_timeline_anchors_in_server_order',
      'resolve_user_scene_presence',
      'filter_choices_by_presence_and_availability',
      'project_major_events_by_player_knowledge',
      'project_timeline_anchors_by_region_branch_and_knowledge',
      'return_read_model_without_story_state_mutation',
    ]);
    expect(
      Object.values(
        STORY_CHOICE_TIMELINE_READ_MODEL_CONTRACT.noMutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
  });

  it('separates direct intervention from remote rumor report choices by user presence', () => {
    expect(
      STORY_CHOICE_TIMELINE_READ_MODEL_CONTRACT.scenePresencePolicy,
    ).toMatchObject({
      userPresent: {
        key: 'present',
        choiceMode: 'direct_intervention',
        allowedChoiceTypes: [
          'dialogue',
          'physical_action',
          'investigation',
          'travel',
          'wait',
        ],
        timelineNarrationMode: 'firsthand_scene',
        canInterveneInCurrentScene: true,
      },
      userFarAway: {
        key: 'far_away',
        choiceMode: 'indirect_information',
        allowedChoiceTypes: ['letter_or_report', 'wait', 'travel'],
        timelineNarrationMode: 'letter_rumor_report',
        canInterveneInCurrentScene: false,
      },
    });
    expect(STORY_CHOICE_TIMELINE_READ_MODEL_CONTRACT.privacy).toMatchObject({
      rawPromptReturned: false,
      providerPayloadReturned: false,
      hiddenFutureTimelineReturned: false,
      authorPrivateNotesReturned: false,
      moderationNotesReturned: false,
    });
  });

  it('keeps canonical timeline anchors ordered while varying region and branch projections', () => {
    const anchors =
      STORY_CHOICE_TIMELINE_READ_MODEL_CONTRACT.timelineAnchorReadModel;

    expect(anchors.projectionFields).toEqual([
      'anchorId',
      'anchorNo',
      'anchorKind',
      'titleKey',
      'summaryKey',
      'regionKey',
      'branchKey',
      'storyTimeKey',
      'playerKnowledgeState',
      'deliveryMode',
      'interventionChoiceKeys',
    ]);
    expect(anchors.regionBranchPolicy).toMatchObject({
      userSameRegion: {
        deliveryMode: 'scene_or_direct_news',
        canIntervene: true,
        allowedChoiceTypes: ['dialogue', 'physical_action', 'investigation'],
      },
      userDifferentRegion: {
        deliveryMode: 'delayed_report_or_rumor',
        canIntervene: false,
        allowedChoiceTypes: ['travel', 'letter_or_report', 'wait'],
      },
      userDifferentBranch: {
        deliveryMode: 'canonical_summary_only',
        canIntervene: false,
        allowedChoiceTypes: ['letter_or_report', 'wait'],
      },
    });
    expect(anchors.continuityGuard).toMatchObject({
      pastAnchorMutationAllowed: false,
      futureAnchorSpoilerReturned: false,
      branchChoiceCanHideAnchor: false,
      branchChoiceCanCreateLocalConsequence: true,
      canonicalAnchorMustRemainAddressable: true,
    });
    expect(anchors.responsePolicy).toMatchObject({
      stableKeysOnly: true,
      rawEnumAsUiCopy: false,
      rawAuthorNotesReturned: false,
      providerPromptReturned: false,
      hiddenFutureTimelineReturned: false,
    });
    expect(
      Object.values(anchors.noMutationPolicy).every((enabled) => enabled === false),
    ).toBe(true);
  });
});
