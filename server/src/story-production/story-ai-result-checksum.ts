import { createHash } from 'crypto';
import { stableContinuationJson } from './story-continuation-context.policy';

export function storyAiResultChecksum(input: {
  title: unknown;
  beats: { beatType: string; content: unknown }[];
  visualManifest: unknown;
  nextChoices?: { choiceKey: string; label: unknown }[];
  ending?: { endingKey: string } | null;
}) {
  return createHash('sha256').update(stableContinuationJson({
    title: input.title,
    beats: input.beats.map(({ beatType, content }) => ({ beatType, content })),
    visualManifest: input.visualManifest,
    nextChoices: (input.nextChoices ?? []).map(({ choiceKey, label }) => ({ choiceKey: choiceKey.trim(), label })),
    ending: input.ending ? { endingKey: input.ending.endingKey } : null,
  })).digest('hex');
}
