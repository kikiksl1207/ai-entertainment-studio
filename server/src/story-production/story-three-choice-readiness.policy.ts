import type { Prisma } from '@prisma/client';

export type PreparedStoryChoice = {
  position: number;
  label: Prisma.JsonValue;
  routeKind: string;
  targetSceneId: string | null;
  targetEndingKey: string | null;
};

export function hasValidWriterOriginalChoice(choice: PreparedStoryChoice): boolean {
  const label = choice.label && typeof choice.label === 'object' && !Array.isArray(choice.label)
    ? (choice.label as Record<string, unknown>).ko : null;
  return choice.position === 1 && choice.routeKind === 'writer_original' &&
    Boolean(choice.targetSceneId) !== Boolean(choice.targetEndingKey) &&
    typeof label === 'string' && Boolean(label.trim());
}

export function hasPreparedOriginalAndAlternatives(choices: readonly PreparedStoryChoice[]): boolean {
  if (choices.length !== 3) return false;
  const original = choices.find((choice) => choice.position === 1);
  const alternatives = choices.filter((choice) => choice.position === 2 || choice.position === 3);
  const labels = choices.map((choice) => {
    const label = choice.label && typeof choice.label === 'object' && !Array.isArray(choice.label)
      ? (choice.label as Record<string, unknown>).ko : null;
    return typeof label === 'string' ? label.trim() : '';
  });
  return Boolean(original && hasValidWriterOriginalChoice(original)) &&
    alternatives.length === 2 &&
    new Set(alternatives.map((choice) => choice.position)).size === 2 &&
    alternatives.every((choice) => choice.routeKind === 'generation_required' &&
      !choice.targetSceneId && !choice.targetEndingKey) &&
    labels.every(Boolean) && new Set(labels).size === 3;
}
