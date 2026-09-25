export const STORY_CONTINUATION_PROMPT_VERSION = 'story-continuation-v3';
export const STORY_CONTINUATION_SCHEMA_VERSION = 'story-continuation-output-v1';

function object(properties: Record<string, unknown>) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

export function storyContinuationOutputSchema(locale: string) {
  const localized = (maxLength: number) => object({
    [locale]: { type: 'string', minLength: 1, maxLength },
  });
  return object({
    title: localized(160),
    beats: {
      type: 'array', minItems: 1, maxItems: 40,
      items: object({
        beatType: { type: 'string', enum: ['paragraph', 'dialogue', 'scene_break'] },
        content: localized(2_500),
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
