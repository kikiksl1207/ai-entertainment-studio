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
    });
    expect(
      STORY_CHOICE_TIMELINE_READ_MODEL_CONTRACT.validationOrder,
    ).toEqual([
      'load_story_session_or_public_preview',
      'resolve_current_chapter_and_scene',
      'resolve_user_scene_presence',
      'filter_choices_by_presence_and_availability',
      'project_major_events_by_player_knowledge',
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
});
