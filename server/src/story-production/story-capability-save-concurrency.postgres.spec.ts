import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { activationFixture } from './story-ai-activation.postgres-fixture';
import { StoryEconomicsService } from './story-economics.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
jest.setTimeout(30000);

postgres('capability save concurrency (owned PostgreSQL, no provider)', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
      parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash ||
      !/^\/lumina_failed_cost_qa_[a-f0-9]{12}$/.test(parsed.pathname)) throw new Error('Dedicated loopback QA database required');
    db = new PrismaClient({ datasources: { db: { url } } }); await db.$connect();
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function prepared() {
    const f = await activationFixture(db, false, false);
    const capability = await db.storyReleaseCapability.findUniqueOrThrow({ where: { releaseId: f.release.id } });
    const analysis = await db.storyAnalysisJob.findFirstOrThrow({ where: { workId: f.work.id } });
    await db.storyAuthorBodyTrialApproval.create({ data: {
      userId: f.owner.id, workId: f.work.id, releaseId: f.release.id, manuscriptVersionId: f.manuscript.id,
      releaseChecksum: f.release.checksum, capabilityRevision: capability.revision, styleConsentId: f.consent.id,
      styleConsentRevision: f.consent.revision, analysisJobId: analysis.id, analysisVersion: analysis.analysisVersion,
      approvedBudgetKrw: '10000', approvalReference: `synthetic-capability-concurrency-${f.work.id}`, expiresAt: new Date(Date.now() + 3600000),
    } });
    const body = {
      rateCardId: f.rate.id, fixedChoiceCount: capability.fixedChoiceCount, customChoiceEnabled: capability.customChoiceEnabled,
      customChoiceMaxLength: capability.customChoiceMaxLength, fullResetLimit: capability.fullResetLimit,
      actResetLimit: capability.actResetLimit, includedAiRouteCount: capability.includedAiRouteCount,
      aiInputTokenLimit: capability.aiInputTokenLimit, aiOutputTokenLimit: capability.aiOutputTokenLimit,
      warningBudgetKrw: Number(capability.warningBudgetKrw), hardBudgetKrw: Number(capability.hardBudgetKrw),
      expectedRevision: capability.revision,
    };
    return { ...f, capability, body };
  }
  type Fixture = Awaited<ReturnType<typeof prepared>>;
  async function protectedState(f: Fixture) {
    return {
      approvals: await db.storyAuthorBodyTrialApproval.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } }),
      progress: await db.storyReaderProgress.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } }),
      requests: await db.storyAiContinuation.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } }),
      commands: await db.storyAuthorBodyTrialCommand.findMany({ where: { workId: f.work.id }, orderBy: [{ userId: 'asc' }, { idempotencyKey: 'asc' }] }),
      ledger: await db.storyAiUsageLedger.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } }),
      allowance: await db.storyAiAllowanceBucket.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } }),
      audit: await db.auditEvent.findMany({ where: { actorUserId: f.owner.id }, orderBy: { id: 'asc' } }),
      rates: await db.storyAiRateCard.findUnique({ where: { id: f.rate.id } }),
      consent: await db.storyStyleProfileConsent.findUnique({ where: { id: f.consent.id } }),
    };
  }
  function oneWinner(results: PromiseSettledResult<unknown>[]) {
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected).toHaveLength(1); expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect(rejected[0].reason.getStatus()).toBe(409);
    return results.findIndex(result => result.status === 'fulfilled');
  }

  it('saves one current revision without silently rebinding approvals, routes or costs', async () => {
    const f = await prepared(), before = await protectedState(f);
    await f.economics.upsertReleaseCapability(f.owner.id, f.release.id, f.body);
    const after = await db.storyReleaseCapability.findUniqueOrThrow({ where: { releaseId: f.release.id } });
    expect(after.revision).toBe(f.capability.revision + 1);
    expect(after.aiInputTokenLimit).toBe(f.capability.aiInputTokenLimit);
    expect(after.aiOutputTokenLimit).toBe(f.capability.aiOutputTokenLimit);
    expect(after.hardBudgetKrw).toEqual(f.capability.hardBudgetKrw);
    expect(await protectedState(f)).toEqual(before); expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('lets exactly one of two same-revision saves win and returns conflict to the stale save', async () => {
    const f = await prepared(), before = await protectedState(f);
    const results = await Promise.allSettled([
      f.economics.upsertReleaseCapability(f.owner.id, f.release.id, { ...f.body, includedAiRouteCount: 5 }),
      f.economics.upsertReleaseCapability(f.owner.id, f.release.id, { ...f.body, includedAiRouteCount: 6 }),
    ]);
    const winner = oneWinner(results);
    const after = await db.storyReleaseCapability.findUniqueOrThrow({ where: { releaseId: f.release.id } });
    expect(after.revision).toBe(f.capability.revision + 1); expect(after.includedAiRouteCount).toBe([5, 6][winner]);
    expect(await protectedState(f)).toEqual(before); expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('serializes two legacy first saves without overwriting the new initial capability', async () => {
    const f = await prepared();
    const release = await db.storyRelease.create({ data: {
      workId: f.work.id, version: 2, status: 'candidate', manuscriptVersionId: f.manuscript.id,
      checksum: 'e'.repeat(64), branchGraphSnapshot: {}, endingSetSnapshot: {}, sceneAssetManifest: {},
      localizedDisplaySnapshot: {}, createdByUserId: f.owner.id,
    } });
    const before = await protectedState(f), { expectedRevision: _expectedRevision, ...body } = f.body;
    const results = await Promise.allSettled([
      f.economics.upsertReleaseCapability(f.owner.id, release.id, { ...body, includedAiRouteCount: 5 }),
      f.economics.upsertReleaseCapability(f.owner.id, release.id, { ...body, includedAiRouteCount: 6 }),
    ]);
    const winner = oneWinner(results);
    const after = await db.storyReleaseCapability.findUniqueOrThrow({ where: { releaseId: release.id } });
    expect(after.revision).toBe(1); expect(after.includedAiRouteCount).toBe([5, 6][winner]);
    expect(await protectedState(f)).toEqual(before); expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('rejects a known stale revision without any capability or protected-state changes', async () => {
    const f = await prepared(); await f.economics.upsertReleaseCapability(f.owner.id, f.release.id, f.body);
    const before = await db.storyReleaseCapability.findUniqueOrThrow({ where: { releaseId: f.release.id } });
    const protectedBefore = await protectedState(f);
    await expect(f.economics.upsertReleaseCapability(f.owner.id, f.release.id, f.body)).rejects.toBeInstanceOf(ConflictException);
    expect(await db.storyReleaseCapability.findUnique({ where: { releaseId: f.release.id } })).toEqual(before);
    expect(await protectedState(f)).toEqual(protectedBefore); expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('rolls back an injected callback failure after the actual guarded update', async () => {
    const f = await prepared(), before = await protectedState(f);
    let updated = false;
    const failing = new Proxy(db, { get(target, key) {
      if (key === '$transaction') return (callback: (tx: unknown) => Promise<unknown>, options: unknown) =>
        target.$transaction(async tx => {
          const capability = new Proxy(tx.storyReleaseCapability, { get(delegate, method) {
            if (method === 'updateMany') return async (...args: unknown[]) => {
              const result = await (delegate.updateMany as Function)(...args);
              expect(result.count).toBe(1);
              const mutated = await tx.storyReleaseCapability.findUniqueOrThrow({ where: { releaseId: f.release.id } });
              expect(mutated.revision).toBe(f.capability.revision + 1);
              updated = true;
              throw new Error('Synthetic failure after guarded mutation');
            };
            const value = Reflect.get(delegate, method); return typeof value === 'function' ? value.bind(delegate) : value;
          } });
          return callback(new Proxy(tx, { get(client, field) {
            if (field === 'storyReleaseCapability') return capability;
            const value = Reflect.get(client, field); return typeof value === 'function' ? value.bind(client) : value;
          } }));
        }, options as never);
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const economics = new StoryEconomicsService(failing as never);
    await expect(economics.upsertReleaseCapability(f.owner.id, f.release.id, f.body)).rejects.toThrow('Synthetic failure after guarded mutation');
    expect(updated).toBe(true);
    expect(await db.storyReleaseCapability.findUnique({ where: { releaseId: f.release.id } })).toEqual(f.capability);
    expect(await protectedState(f)).toEqual(before); expect(f.provider.generate).not.toHaveBeenCalled();
  });
});
