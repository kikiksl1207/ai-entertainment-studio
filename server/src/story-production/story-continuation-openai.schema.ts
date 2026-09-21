export const STORY_CONTINUATION_PROMPT_VERSION = 'story-continuation-v1';
export const STORY_CONTINUATION_SCHEMA_VERSION = 'story-continuation-output-v1';

function object(properties: Record<string, unknown>) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

export function storyContinuationOutputSchema(locale: string) {
  const localized = object({ [locale]: { type: 'string' } });
  return object({
    title: localized,
    beats: {
      type: 'array', minItems: 1, maxItems: 40,
      items: object({
        beatType: { type: 'string', enum: ['paragraph', 'dialogue', 'scene_break'] },
        content: localized,
      }),
    },
    nextChoices: {
      type: 'array', minItems: 0, maxItems: 3,
      items: object({ choiceKey: { type: 'string' }, label: localized }),
    },
    ending: { anyOf: [object({ endingKey: { type: 'string' } }), { type: 'null' }] },
  });
}
