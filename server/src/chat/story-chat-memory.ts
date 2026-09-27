const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StoryChatMemoryItem = {
  workTitle: string;
  sceneTitle: string;
  choiceLabel: string;
};

export type StoryChatMemoryContext = {
  source: 'active_story_route';
  items: StoryChatMemoryItem[];
};

export type StoryPathChoice = {
  choiceId: string;
  sceneId: string | null;
};

export function activeStoryPathChoices(pathSummary: unknown, limit = 3): StoryPathChoice[] {
  if (!Array.isArray(pathSummary)) return [];
  return pathSummary
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      choiceId: entry.choiceId,
      sceneId: entry.sceneId ?? entry.sourceSceneId ?? entry.sourceGeneratedSceneId ?? null,
    }))
    .filter((entry): entry is StoryPathChoice =>
      typeof entry.choiceId === 'string' && UUID_PATTERN.test(entry.choiceId) &&
      (entry.sceneId === null || (typeof entry.sceneId === 'string' && UUID_PATTERN.test(entry.sceneId))))
    .slice(-limit);
}

export function storyMemoryText(value: unknown, maxChars: number): string {
  const localized = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).ko ?? Object.values(value as Record<string, unknown>).find((item) => typeof item === 'string')
    : value;
  return typeof localized === 'string'
    ? localized.replace(/\s+/g, ' ').trim().slice(0, maxChars)
    : '';
}
