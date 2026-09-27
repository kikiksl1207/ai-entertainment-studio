import type { Prisma } from '@prisma/client';
import { localizedContinuationText } from './story-continuation-context.policy';
import { authorPartStoryContinuationLengthBounds } from './story-continuation-length.policy';

export async function authoredPartContinuationLengthBounds(
  db: Pick<Prisma.TransactionClient, 'storyScene' | 'storyBeat'>,
  partId: string,
  locale: string,
) {
  const scenes = await db.storyScene.findMany({
    where: { partId, status: 'published', fixtureSource: false },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: { id: true },
    take: 101,
  });
  if (!scenes.length || scenes.length > 100) throw new Error('author_length_scenes_invalid');
  const beats = await db.storyBeat.findMany({
    where: { sceneId: { in: scenes.map((scene) => scene.id) } },
    select: { beatType: true, content: true },
    take: 1_001,
  });
  if (!beats.length || beats.length > 1_000) throw new Error('author_length_beats_invalid');
  return authorPartStoryContinuationLengthBounds(
    locale,
    beats.filter((beat) => beat.beatType !== 'scene_break')
      .map((beat) => localizedContinuationText(beat.content, locale)),
  );
}
