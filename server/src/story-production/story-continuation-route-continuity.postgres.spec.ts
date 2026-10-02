import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { activationFixture } from './story-ai-activation.postgres-fixture';
import { assembleContinuationRouteContinuity } from './story-continuation-route-continuity';
import { createStoryRouteRoot } from './story-route-identity.store';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('long route continuity on isolated PostgreSQL', () => {
  let db: PrismaClient;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' ||
        parsed.port !== '55432' || parsed.username !== 'lumina_qa' ||
        parsed.pathname !== '/lumina_chat_memory_qa' || parsed.search || parsed.hash) {
      throw new Error('Dedicated route-continuity QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
  });

  afterAll(async () => { await db?.$disconnect(); });

  it('keeps the origin and latest action in a real 265-node ancestry', async () => {
    const f = await activationFixture(db, false);
    const progress = f.progresses[0];
    let parentId = await createStoryRouteRoot(db, progress, f.scene.id, f.part.actNumber);
    for (let depth = 1; depth <= 265; depth += 1) {
      const node = await db.storyProgressRouteNode.create({ data: {
        progressId: progress.id, workId: f.work.id, releaseId: f.release.id,
        parentId, depth, stepKind: 'canonical', sourceSceneId: f.scene.id,
        sourceChoiceId: f.choice.id, targetSceneId: f.scene.id,
        actNumber: f.part.actNumber,
        routeHash: createHash('sha256').update(`${parentId}:${depth}`).digest('hex'),
        narrativeStep: { sourceSceneId: f.scene.id, choiceId: f.choice.id,
          targetSceneId: f.scene.id },
      } });
      parentId = node.id;
    }

    const view = await assembleContinuationRouteContinuity(db, {
      routeNodeId: parentId, progressId: progress.id, workId: f.work.id,
      releaseId: f.release.id, userId: progress.userId, locale: 'ko', pathSummary: [],
    });

    expect(view.actions[0]?.step).toBe(1);
    expect(view.actions.at(-1)?.step).toBe(265);
    expect(Buffer.byteLength(JSON.stringify(view), 'utf8')).toBeLessThanOrEqual(6_000);
  }, 120_000);
});
