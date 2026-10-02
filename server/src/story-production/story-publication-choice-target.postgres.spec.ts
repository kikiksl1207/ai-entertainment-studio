import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { activationFixture } from './story-ai-activation.postgres-fixture';
import { StoryAiActivationService } from './story-ai-activation.service';
import { INHERITOR_STORY } from './story-inheritor-publication.policy';
import { StoryPublicBetaAiActivationService } from './story-public-beta-ai-activation.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('Explicit published target on isolated PostgreSQL', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' ||
        parsed.port !== '55432' || parsed.username !== 'lumina_qa' ||
        parsed.pathname !== '/lumina_chat_memory_qa' || parsed.search || parsed.hash) {
      throw new Error('Dedicated QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } }); await db.$connect();
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function readyWork(activate: boolean) {
    const f = await activationFixture(db, activate);
    await db.storyWork.update({ where: { id: f.work.id }, data: {
      slug: `${INHERITOR_STORY.slug}-${randomUUID()}`, publishedAt: new Date(),
    } });
    await db.storyChoice.update({ where: { id: f.choice.id }, data: {
      choiceKey: 'original', routeKind: 'writer_original', targetEndingKey: 'author-ending',
      label: { ko: 'Follow the authored ending' },
    } });
    await db.storyChoice.createMany({ data: ['Investigate the record', 'Protect the witness'].map((label, index) => ({
      sceneId: f.scene.id, choiceKey: `alternative-${index + 2}`, position: index + 2,
      label: { ko: label }, routeKind: 'generation_required',
    })) });
    return f;
  }

  it('does not inherit a different publication activation or mutate its approval and reader data', async () => {
    const a = await readyWork(true), b = await readyWork(false);
    const service = new StoryPublicBetaAiActivationService(db as never, new StoryAiActivationService(db as never));
    const sourceA = { workId: a.work.id, releaseId: a.release.id };
    const sourceB = { workId: b.work.id, releaseId: b.release.id };
    const aBefore = {
      consent: await db.storyStyleProfileConsent.findUnique({ where: { workId: a.work.id } }),
      capability: await db.storyReleaseCapability.findUnique({ where: { releaseId: a.release.id } }),
      readers: await db.storyReaderProgress.findMany({ where: { workId: a.work.id }, orderBy: { id: 'asc' } }),
      choices: await db.storyChoice.findMany({ where: { sceneId: a.scene.id }, orderBy: { id: 'asc' } }),
    };
    await expect(service.status('inheritor')).rejects.toThrow('Multiple published inheritor works match');
    await expect(service.status('inheritor', sourceA)).resolves.toMatchObject({ ...sourceA, active: true });
    await expect(service.status('inheritor', sourceB)).resolves.toMatchObject({ ...sourceB, active: false });
    await expect(service.choiceCoverage('inheritor', sourceB)).resolves.toMatchObject({ ...sourceB,
      totalParts: 1, totalScenes: 1, distribution: { threeValid: 1 } });
    const body = { ...sourceB, aiBranchGenerationConfirmed: true, authorStyleReferenceConfirmed: true,
      generatedResultReuseConfirmed: true, imageTransformationConfirmed: true } as const;
    await expect(service.activate(b.owner.id, 'inheritor', body)).resolves.toMatchObject({ ...sourceB, active: true });
    expect(await db.storyAiLegalActivation.count({ where: { releaseId: b.release.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { targetId: a.work.id, action: 'story_public_beta.ai_activation.prepare' } })).toBe(0);
    expect({
      consent: await db.storyStyleProfileConsent.findUnique({ where: { workId: a.work.id } }),
      capability: await db.storyReleaseCapability.findUnique({ where: { releaseId: a.release.id } }),
      readers: await db.storyReaderProgress.findMany({ where: { workId: a.work.id }, orderBy: { id: 'asc' } }),
      choices: await db.storyChoice.findMany({ where: { sceneId: a.scene.id }, orderBy: { id: 'asc' } }),
    }).toEqual(aBefore);
  }, 60_000);

  it('rechecks a selected work after lock waiting and never falls back when it is hidden', async () => {
    const a = await readyWork(true), b = await readyWork(false);
    const service = new StoryPublicBetaAiActivationService(db as never, new StoryAiActivationService(db as never));
    const body = { workId: b.work.id, releaseId: b.release.id,
      aiBranchGenerationConfirmed: true, authorStyleReferenceConfirmed: true,
      generatedResultReuseConfirmed: true, imageTransformationConfirmed: true } as const;
    let unlock!: () => void, locked!: () => void;
    const lockReady = new Promise<void>(resolve => { locked = resolve; });
    const hold = new Promise<void>(resolve => { unlock = resolve; });
    const writer = db.$transaction(async tx => {
      await tx.storyWork.update({ where: { id: b.work.id }, data: { status: 'draft' } });
      locked(); await hold;
    }, { timeout: 30_000 });
    await lockReady;
    const attempting = service.activate(b.owner.id, 'inheritor', body).then(
      value => ({ value, error: null }), error => ({ value: null, error }),
    );
    try {
      await new Promise(resolve => setTimeout(resolve, 50));
    } finally { unlock(); }
    await writer;
    const result = await attempting;
    expect(result.error).toMatchObject({ status: 404 });
    expect(await db.storyAiLegalActivation.count({ where: { releaseId: b.release.id } })).toBe(0);
    expect(await db.auditEvent.count({ where: {
      targetId: { in: [a.work.id, b.work.id] }, action: 'story_public_beta.ai_activation.prepare',
    } })).toBe(0);
    expect(await db.storyStyleProfileConsent.findUniqueOrThrow({ where: { workId: b.work.id } }))
      .toMatchObject({ revision: b.consent.revision, imageTransformationAllowed: false });
    await expect(service.status('inheritor', { workId: b.work.id, releaseId: b.release.id }))
      .rejects.toMatchObject({ status: 404 });
    await expect(service.activate(b.owner.id, 'inheritor', { ...body, workId: a.work.id }))
      .rejects.toMatchObject({ response: { code: 'STORY_PUBLICATION_CHOICE_SOURCE_CHANGED' } });
    expect(await db.auditEvent.count({ where: { targetId: a.work.id, action: 'story_public_beta.ai_activation.prepare' } })).toBe(0);
  }, 60_000);
});
