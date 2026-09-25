export const STORY_CONTINUATION_PROMPT_VERSION = 'story-continuation-v4';
export const STORY_CONTINUATION_SCHEMA_VERSION = 'story-continuation-output-v1';

function object(properties: Record<string, unknown>) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

export function storyContinuationOutputSchema(locale: string, minimumNarrativeUnits = 0, maximumNarrativeUnits = 0) {
  const longForm = minimumNarrativeUnits >= 2_400 && maximumNarrativeUnits > minimumNarrativeUnits;
  const requiredBeats = longForm ? Math.min(40, Math.ceil(minimumNarrativeUnits / 460)) : 1;
  const minimumBeatLength = longForm ? Math.ceil(minimumNarrativeUnits / requiredBeats / 0.8) : 1;
  const maximumBeatLength = longForm ? Math.min(2_500, Math.floor(maximumNarrativeUnits / requiredBeats)) : 2_500;
  if (minimumBeatLength > maximumBeatLength) throw new Error('provider_narrative_schema_unavailable');
  const localized = (maxLength: number) => object({
    [locale]: { type: 'string', minLength: 1, maxLength },
  });
  const narrative = object({
    [locale]: { type: 'string', minLength: minimumBeatLength, maxLength: maximumBeatLength },
  });
  return object({
    title: localized(160),
    beats: {
      type: 'array', minItems: requiredBeats, maxItems: longForm ? requiredBeats : 40,
      items: object({
        beatType: { type: 'string', enum: longForm ? ['paragraph', 'dialogue'] : ['paragraph', 'dialogue', 'scene_break'] },
        content: narrative,
      }),
    },
    nextChoices: {
      type: 'array', minItems: 0, maxItems: 3,
      items: object({
        choiceKey: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' },
        label: localized(320),
      }),
    },
    ending: {
      anyOf: [
        object({ endingKey: { type: 'string', pattern: '^ai-[a-zA-Z0-9][a-zA-Z0-9_-]{0,116}$' } }),
        { type: 'null' },
      ],
    },
  });
}
