import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { type GeneratedPartChoices, StoryChoicePreparationProvider,
  type StoryChoicePreparationInput } from './story-choice-preparation.provider';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { preparePastedManuscript, storedManuscriptBody } from './story-manuscript-file.policy';
import { StoryStudioChoiceJobService } from './story-studio-choice-job.service';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';
import { StoryStudioLinearService } from './story-studio-linear.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
type Claim = { id: string; leaseToken: string; recovered: boolean };
type FixtureIds = { owner: string; work: string; manuscript: string; analysis: string;
  review: string; rateCard: string };

function barrier() {
  let signal!: () => void;
  let open!: () => void;
  const entered = new Promise<void>(resolve => { signal = resolve; });
  const released = new Promise<void>(resolve => { open = resolve; });
  return { entered, open, pause: async () => { signal(); await released; } };
}

postgres('Studio choice job leases (isolated PostgreSQL, offline provider)', () => {
  let db: PrismaClient;
  const fixtures: FixtureIds[] = [];
  const workers: StoryStudioChoiceJobService[] = [];

  beforeAll(async () => {
    let parsed: URL;
    try { parsed = new URL(url!); }
    catch { throw new Error('Dedicated story QA database required'); }
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' ||
        parsed.port !== '55432' || parsed.username !== 'lumina_qa' ||
        parsed.pathname !== '/lumina_story_qa' || parsed.search || parsed.hash) {
      throw new Error('Dedicated story QA database required');
    }
    expect(process.env.NODE_ENV).toBe('test');
    db = new PrismaClient({ datasources: { db: { url } }, log: [] });
    try { await db.$connect(); }
    catch { throw new Error('Isolated story QA PostgreSQL runtime unavailable'); }
    const rows = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (rows[0]?.name !== 'lumina_story_qa') throw new Error('Dedicated story QA database required');
  });

  beforeEach(() => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network calls are forbidden in choice job QA'));
  });

  afterEach(async () => {
    for (const worker of workers.splice(0)) worker.onModuleDestroy();
    try { expect(globalThis.fetch).not.toHaveBeenCalled(); }
    finally {
      jest.restoreAllMocks();
      for (const ids of fixtures.splice(0)) await cleanup(ids);
    }
  });

  afterAll(async () => { await db?.$disconnect(); });

  async function cleanup(ids: FixtureIds) {
    await db.$transaction(async tx => {
      // Immutable visual prompts require the existing QA cleanup bypass, only in this transaction.
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      const parts = await tx.storyPart.findMany({ where: { workId: ids.work }, select: { id: true } });
      const scenes = await tx.storyScene.findMany({ where: { partId: { in: parts.map(part => part.id) } },
        select: { id: true } });
      const sceneIds = scenes.map(scene => scene.id);
      await tx.auditEvent.deleteMany({ where: { actorUserId: ids.owner } });
      await tx.storyStudioChoiceJob.deleteMany({ where: { workId: ids.work } });
      await tx.storyVisualGeneration.deleteMany({ where: { workId: ids.work } });
      await tx.storyVisualPrompt.deleteMany({ where: { workId: ids.work } });
      await tx.storyChoice.deleteMany({ where: { sceneId: { in: sceneIds } } });
      await tx.storyBeat.deleteMany({ where: { sceneId: { in: sceneIds } } });
      await tx.storyScene.deleteMany({ where: { id: { in: sceneIds } } });
      await tx.storyPart.deleteMany({ where: { id: { in: parts.map(part => part.id) } } });
      await tx.storyRelease.deleteMany({ where: { workId: ids.work } });
      await tx.storyFinalSubmission.deleteMany({ where: { reviewId: ids.review } });
      await tx.storyWriterReview.deleteMany({ where: { id: ids.review } });
      await tx.storyStyleProfileConsent.deleteMany({ where: { workId: ids.work } });
      await tx.storyWorkGenerationProfile.deleteMany({ where: { workId: ids.work } });
      await tx.storyMemoryRecord.deleteMany({ where: { workId: ids.work, analysisJobId: ids.analysis } });
      await tx.storyAnalysisEvidence.deleteMany({ where: { analysisJobId: ids.analysis } });
      await tx.storyAnalysisJob.deleteMany({ where: { id: ids.analysis } });
      await tx.storyManuscriptVersion.deleteMany({ where: { id: ids.manuscript } });
      await tx.storyAiRateCard.deleteMany({ where: { id: ids.rateCard } });
      await tx.storyWork.deleteMany({ where: { id: ids.work } });
      await tx.user.deleteMany({ where: { id: ids.owner } });
    }, { timeout: 30_000 });
  }

  async function fixture(partCount = 1) {
    const ids: FixtureIds = { owner: randomUUID(), work: randomUUID(), manuscript: randomUUID(),
      analysis: randomUUID(), review: randomUUID(), rateCard: randomUUID() };
    fixtures.push(ids);
    await db.user.create({ data: { id: ids.owner } });
    await db.storyWork.create({ data: { id: ids.work, ownerUserId: ids.owner,
      slug: `studio-choice-job-${randomUUID()}`, title: { ko: 'The private ledger' }, summary: {} } });
    const texts = ['The archivist found a sealed ledger.', 'The archivist carried the ledger into the final room.']
      .slice(0, partCount);
    const raw = texts.join('\n\n');
    let offset = 0;
    const parts = texts.map((text, index) => {
      const start = offset;
      offset += text.length + (index < texts.length - 1 ? 2 : 0);
      return { partKey: `part-${index + 1}`, title: `Ledger room ${index + 1}`, start, end: offset };
    });
    const prepared = preparePastedManuscript(Buffer.from(raw), JSON.stringify({
      locale: 'ko', confirmed: true, parts,
    }));
    await db.storyManuscriptVersion.create({ data: { id: ids.manuscript, workId: ids.work,
      ownerUserId: ids.owner, version: 1, locale: 'ko', contentHash: prepared.contentHash,
      structuredBody: storedManuscriptBody(prepared) } });
    await db.storyAiRateCard.create({ data: { id: ids.rateCard, version: `offline-choice-job-${randomUUID()}`,
      provider: 'offline', model: 'fixture', status: 'active', inputCostPerMillion: 0,
      outputCostPerMillion: 0, createdByUserId: ids.owner } });
    await db.storyAnalysisJob.create({ data: { id: ids.analysis, workId: ids.work,
      manuscriptVersionId: ids.manuscript, analysisVersion: 1, idempotencyKey: randomUUID(),
      status: 'completed', pipeline: 'semantic_extraction_v1', sourceContentHash: prepared.contentHash,
      sourceLocale: 'ko', actorUserId: ids.owner, rateCardId: ids.rateCard,
      sourceDigest: prepared.contentHash, configHash: prepared.contentHash,
      totalParagraphs: prepared.paragraphCount, completedParagraphs: prepared.paragraphCount,
      plannedParagraphs: prepared.paragraphCount } });
    await db.storyAnalysisEvidence.create({ data: { analysisJobId: ids.analysis,
      provenance: 'semantic_candidate', sequence: 1, evidenceType: 'style', sourcePartKey: 'part-1',
      sourceParagraphIndex: 0, payload: { title: 'Narrative style',
        observation: 'First-person observation with short, restrained sentences.', styleCategory: 'narration' } } });
    const profiles = new StoryGenerationProfileService(db as never);
    const draft = await profiles.getOrCreate(ids.owner, ids.work);
    const settings = normalizeCreatorGenerationProfile('story', draft.profile.draftSettings);
    const reviewed = await profiles.update(ids.owner, ids.work, { settings: {
      ...settings, sections: settings.sections.map(section => ({ ...section, decision: 'accepted' as const })),
    } });
    await profiles.approve(ids.owner, ids.work, { expectedDraftFingerprint: reviewed.profile.draftFingerprint! });
    await db.storyWriterReview.create({ data: { id: ids.review, workId: ids.work, ownerUserId: ids.owner,
      manuscriptVersionId: ids.manuscript, analysisJobId: ids.analysis, state: 'submitted' } });
    await db.storyFinalSubmission.create({ data: { reviewId: ids.review, manuscriptVersionId: ids.manuscript,
      idempotencyKey: randomUUID(), checksum: prepared.contentHash } });
    await db.storyStyleProfileConsent.create({ data: { workId: ids.work, ownerUserId: ids.owner,
      manuscriptVersionId: ids.manuscript, rightsConfirmed: true, aiBranchAllowed: true,
      allowedLocales: ['ko'], startsAt: new Date(0) } });
    const choices = new StoryStudioChoicePreparationService(db as never);
    const provider = { modelName: 'offline-choice-job', generate: jest.fn(async (
      input: StoryChoicePreparationInput): Promise<GeneratedPartChoices[]> => generatedChoices(input)) };
    const providerFactory = jest.spyOn(choices as unknown as { provider: () => StoryChoicePreparationProvider },
      'provider').mockReturnValue(provider as never);
    const studio = new StoryStudioLinearService(db as never, choices);
    const materialized = await studio.materialize(ids.owner, ids.work, {
      manuscriptVersionId: ids.manuscript, expectedManuscriptHash: prepared.contentHash,
      originalRoutesReviewed: true, originalRoutes: prepared.parts.map(part => ({ partKey: part.partKey })),
    });
    const job = await db.storyStudioChoiceJob.findUniqueOrThrow({ where: { releaseId: materialized.releaseId } });
    return { ids, choices, provider, providerFactory, materialized, jobId: job.id };
  }

  type Fixture = Awaited<ReturnType<typeof fixture>>;

  function generatedChoices(input: StoryChoicePreparationInput): GeneratedPartChoices[] {
    return input.parts.map(part => ({ partKey: part.partKey,
      originalChoiceLabel: part.originalChoiceLabel ?? `Preserve the ledger along the authored ${part.partKey} route`,
      alternatives: [`Hide the ledger and search alone in ${part.partKey}`,
        `Reveal the ledger and question the archivists in ${part.partKey}`] }));
  }

  async function withClaimScope(f: Fixture, run: () => Promise<void>) {
    // A separate connection locks other suites' rows so the unchanged claim SQL skips them.
    await db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_studio_choice_jobs
        WHERE id <> ${f.jobId}::uuid FOR UPDATE SKIP LOCKED`);
      await run();
    }, { timeout: 60_000 });
  }

  function worker(f: Fixture, hooks: {
    afterChoiceScan?: () => Promise<void>;
    beforeReleaseReady?: (tx: Prisma.TransactionClient) => Promise<void>;
    afterTransactionRollback?: () => Promise<void>;
  } = {}) {
    const scopedDb = new Proxy(db, { get(target, key) {
      if (key === '$queryRaw') return (query: Prisma.Sql) => db.$transaction(async tx => {
        const rows = await tx.$queryRaw<Array<{ id: string; previous_status: string }>>(query);
        // Roll back rather than claiming a foreign row inserted after the scope lock was taken.
        if (rows.some(row => row.id !== f.jobId)) throw new Error('Choice job QA claim escaped its fixture');
        return rows;
      });
      if (key === '$transaction' && hooks.beforeReleaseReady) return async (
        run: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number },
      ) => {
        try {
          return await db.$transaction(tx => run(new Proxy(tx, { get(transaction, operation) {
            if (operation === 'storyRelease') return new Proxy(transaction.storyRelease, {
              get(delegate, method) {
                if (method === 'update') return async (args: Prisma.StoryReleaseUpdateArgs) => {
                  await hooks.beforeReleaseReady!(tx);
                  return delegate.update(args);
                };
                return Reflect.get(delegate, method);
              },
            });
            return Reflect.get(transaction, operation);
          } })), options);
        } catch (error) {
          await hooks.afterTransactionRollback?.();
          throw error;
        }
      };
      if (key === 'storyChoice' && hooks.afterChoiceScan) return new Proxy(target.storyChoice, {
        get(delegate, operation) {
          if (operation === 'findMany') return async (args: Prisma.StoryChoiceFindManyArgs) => {
            const rows = await db.storyChoice.findMany(args);
            await hooks.afterChoiceScan!();
            return rows;
          };
          return Reflect.get(delegate, operation);
        },
      });
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const instance = new StoryStudioChoiceJobService(scopedDb as never, f.choices);
    workers.push(instance);
    return instance;
  }

  async function claim(instance: StoryStudioChoiceJobService): Promise<Claim | null> {
    return (instance as unknown as { claim: () => Promise<Claim | null> }).claim();
  }

  async function expire(f: Fixture, token: string) {
    const changed = await db.storyStudioChoiceJob.updateMany({ where: { id: f.jobId,
      status: 'processing', leaseToken: token }, data: { leaseExpiresAt: new Date(0) } });
    expect(changed.count).toBe(1);
  }

  async function state(f: Fixture) {
    return { job: await db.storyStudioChoiceJob.findUniqueOrThrow({ where: { id: f.jobId } }),
      release: await db.storyRelease.findUniqueOrThrow({ where: { id: f.materialized.releaseId } }) };
  }

  async function storedChoices(f: Fixture, sceneId = f.materialized.scenes[0].sceneId) {
    return db.storyChoice.findMany({ where: { sceneId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
  }

  async function preparedProofs(f: Fixture) {
    return db.auditEvent.findMany({ where: { actorUserId: f.ids.owner,
      action: 'story_studio_choices.prepared', targetId: { in: f.materialized.scenes.map(scene => scene.sceneId) } },
      orderBy: { id: 'asc' } });
  }

  async function persistFirstPartWithoutCounter(f: Fixture) {
    const owned = await claim(worker(f));
    expect(owned).toMatchObject({ id: f.jobId, recovered: false });
    await f.choices.prepare(f.ids.owner, f.ids.work, f.materialized.releaseId,
      f.materialized.scenes[0].sceneId, owned!.leaseToken);
    expect((await storedChoices(f)).map(choice => choice.position)).toEqual([1, 2, 3]);
    expect(await preparedProofs(f)).toHaveLength(1);
    expect((await state(f)).job).toMatchObject({ status: 'processing', completedParts: 0,
      leaseToken: owned!.leaseToken });
    expect((await state(f)).release.validationSummary).toMatchObject({ ready: false });
    return owned!;
  }

  async function waitForPause(pause: ReturnType<typeof barrier>, running: Promise<unknown>) {
    await Promise.race([pause.entered, running.then(() => {
      throw new Error('Choice worker finished before the expected interruption point');
    })]);
  }

  it.each(['profile_reapproved', 'consent_revision'])
  ('blocks the next provider request if a persisted part has stale approval: %s', async change => {
    const f = await fixture(2);
    await withClaimScope(f, async () => {
      const instance = worker(f);
      expect(await instance.executeOne()).toBe('progress');
      const firstChoices = await storedChoices(f);
      const proofs = await preparedProofs(f);
      const calls = f.provider.generate.mock.calls.length;
      expect(firstChoices).toHaveLength(3);
      if (change === 'profile_reapproved') {
        const profiles = new StoryGenerationProfileService(db as never);
        const current = await profiles.getOrCreate(f.ids.owner, f.ids.work);
        const settings = normalizeCreatorGenerationProfile('story', current.profile.draftSettings);
        settings.sections[0].decision = 'edited';
        settings.sections[0].value.summary = 'A changed, newly approved author voice';
        const draft = await profiles.update(f.ids.owner, f.ids.work, { settings: settings as never });
        await profiles.approve(f.ids.owner, f.ids.work, { expectedDraftFingerprint: draft.profile.draftFingerprint! });
      } else {
        await db.storyStyleProfileConsent.update({ where: { workId: f.ids.work }, data: { revision: { increment: 1 } } });
      }
      expect(await instance.executeOne()).toBe('failed');
      expect((await state(f)).job).toMatchObject({ completedParts: 1, status: 'failed',
        errorCode: 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED', leaseToken: null });
      expect((await state(f)).release.validationSummary).toMatchObject({ ready: false });
      expect(await storedChoices(f)).toEqual(firstChoices);
      expect(await preparedProofs(f)).toEqual(proofs);
      expect(await storedChoices(f, f.materialized.scenes[1].sceneId)).toHaveLength(1);
      expect(f.provider.generate).toHaveBeenCalledTimes(calls);
    });
  }, 60_000);

  it('executes real claim SQL: skips locked rows, grants one queued claim, and takes over only expired leases', async () => {
    const f = await fixture();
    await withClaimScope(f, async () => {
      const first = worker(f);
      const second = worker(f);
      await db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM story_studio_choice_jobs WHERE id = ${f.jobId}::uuid FOR UPDATE`);
        expect(await claim(first)).toBeNull();
      });
      const claims = await Promise.all([claim(first), claim(second)]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const owned = claims.find((row): row is Claim => row !== null)!;
      expect(owned).toMatchObject({ id: f.jobId, recovered: false });
      expect(owned.leaseToken).toMatch(/^[a-f0-9-]{36}$/);
      const live = await state(f);
      expect(live.job).toMatchObject({ status: 'processing', leaseToken: owned.leaseToken, completedParts: 0 });
      expect(live.job.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
      expect(await claim(second)).toBeNull();
      expect(await state(f)).toEqual(live);
      await expire(f, owned.leaseToken);
      const takeover = await claim(second);
      expect(takeover).toMatchObject({ id: f.jobId, recovered: true });
      expect(takeover!.leaseToken).not.toBe(owned.leaseToken);
      expect((await state(f)).job).toMatchObject({ status: 'processing', completedParts: 0,
        leaseToken: takeover!.leaseToken });
      expect((await state(f)).release).toEqual(live.release);
      expect(f.providerFactory).not.toHaveBeenCalled();
      expect(f.provider.generate).not.toHaveBeenCalled();
    });
  }, 60_000);

  it('finalizes all persisted choices after an expired lease without regenerating or trusting the old counter', async () => {
    const f = await fixture();
    await withClaimScope(f, async () => {
      const old = await persistFirstPartWithoutCounter(f);
      const choices = await storedChoices(f);
      const proofs = await preparedProofs(f);
      const generateCalls = f.provider.generate.mock.calls.length;
      const factoryCalls = f.providerFactory.mock.calls.length;
      const prepare = jest.spyOn(f.choices, 'prepare');
      await expire(f, old.leaseToken);
      expect(await worker(f).executeOne()).toBe('completed');
      expect((await state(f)).job).toMatchObject({ status: 'completed', completedParts: 1, totalParts: 1,
        leaseToken: null, leaseExpiresAt: null, errorCode: null });
      expect((await state(f)).release).toMatchObject({ status: 'candidate',
        validationSummary: { ready: true, blockingIssueCount: 0 } });
      expect(await storedChoices(f)).toEqual(choices);
      expect(await preparedProofs(f)).toEqual(proofs);
      expect(prepare).not.toHaveBeenCalled();
      expect(f.provider.generate).toHaveBeenCalledTimes(generateCalls);
      expect(f.providerFactory).toHaveBeenCalledTimes(factoryCalls);
    });
  }, 60_000);

  it('fences interrupted provider cost, then explicit owner retry prepares only the missing part', async () => {
    const f = await fixture(2);
    await withClaimScope(f, async () => {
      const old = await persistFirstPartWithoutCounter(f);
      const firstChoices = await storedChoices(f);
      const proofs = await preparedProofs(f);
      const prepare = jest.spyOn(f.choices, 'prepare');
      await expire(f, old.leaseToken);
      const replacement = worker(f);
      expect(await replacement.executeOne()).toBe('failed');
      expect((await state(f)).job).toMatchObject({ status: 'failed',
        errorCode: 'STUDIO_CHOICES_INTERRUPTED_RETRY_REQUIRED', completedParts: 1,
        leaseToken: null, leaseExpiresAt: null });
      expect((await state(f)).release.validationSummary).toMatchObject({ ready: false });
      expect(await storedChoices(f)).toEqual(firstChoices);
      expect(await storedChoices(f, f.materialized.scenes[1].sceneId)).toHaveLength(1);
      expect(await preparedProofs(f)).toEqual(proofs);
      expect(prepare).not.toHaveBeenCalled();
      expect(f.provider.generate).toHaveBeenCalledTimes(1);
      expect(f.providerFactory).toHaveBeenCalledTimes(1);
      expect(await replacement.executeOne()).toBe('idle');
      await replacement.retry(f.ids.owner, f.ids.work, f.materialized.releaseId);
      expect((await state(f)).job).toMatchObject({ status: 'queued', errorCode: null });
      expect(await replacement.executeOne()).toBe('progress');
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(prepare).toHaveBeenCalledWith(f.ids.owner, f.ids.work, f.materialized.releaseId,
        f.materialized.scenes[1].sceneId, expect.any(String));
      expect(f.provider.generate.mock.calls.map(([input]) => input.parts.map(part => part.partKey)))
        .toEqual([['part-1'], ['part-2']]);
      expect(await storedChoices(f)).toEqual(firstChoices);
      expect(await replacement.executeOne()).toBe('completed');
      expect(f.provider.generate).toHaveBeenCalledTimes(2);
      expect((await state(f)).job).toMatchObject({ status: 'completed', completedParts: 2, totalParts: 2 });
      expect((await state(f)).release.validationSummary).toMatchObject({ ready: true });
    });
  }, 60_000);

  it('rejects stale completion before release.ready and preserves the replacement token for valid finalization', async () => {
    const f = await fixture();
    await withClaimScope(f, async () => {
      const seed = await persistFirstPartWithoutCounter(f);
      await expire(f, seed.leaseToken);
      const pause = barrier();
      const stale = worker(f, { afterChoiceScan: pause.pause });
      const running = stale.executeOne();
      try {
        await waitForPause(pause, running);
        const previous = await state(f);
        await expire(f, previous.job.leaseToken!);
        const currentWorker = worker(f);
        const current = await claim(currentWorker);
        expect(current).toMatchObject({ id: f.jobId, recovered: true });
        expect(current!.leaseToken).not.toBe(previous.job.leaseToken);
        const before = await state(f);
        const choices = await storedChoices(f);
        const proofs = await preparedProofs(f);
        pause.open();
        expect(await running).toBe('idle');
        expect(await state(f)).toEqual(before);
        expect(before.release.validationSummary).toMatchObject({ ready: false });
        expect(await storedChoices(f)).toEqual(choices);
        expect(await preparedProofs(f)).toEqual(proofs);
        expect(f.provider.generate).toHaveBeenCalledTimes(1);
        await expire(f, current!.leaseToken);
        expect(await currentWorker.executeOne()).toBe('completed');
        expect((await state(f)).release.validationSummary).toMatchObject({ ready: true });
        expect(f.provider.generate).toHaveBeenCalledTimes(1);
      } finally { pause.open(); await running; }
    });
  }, 60_000);

  it('holds the job lock through validation and aborts release.ready when the owned lease expires', async () => {
    const f = await fixture();
    await withClaimScope(f, async () => {
      const seed = await persistFirstPartWithoutCounter(f);
      await expire(f, seed.leaseToken);
      const scan = barrier();
      const validation = barrier();
      const assertPublishable = f.choices.assertPublishableTx.bind(f.choices);
      jest.spyOn(f.choices, 'assertPublishableTx').mockImplementation(async (...args) => {
        await validation.pause();
        return assertPublishable(...args);
      });
      const running = worker(f, { afterChoiceScan: scan.pause }).executeOne();
      try {
        await waitForPause(scan, running);
        const owned = await state(f);
        const expiresAt = new Date(Date.now() + 2_000);
        const shortened = await db.storyStudioChoiceJob.updateMany({ where: { id: f.jobId,
          status: 'processing', leaseToken: owned.job.leaseToken }, data: { leaseExpiresAt: expiresAt } });
        expect(shortened.count).toBe(1);
        scan.open();
        await waitForPause(validation, running);
        // Expire by wall clock, not by an UPDATE that would itself wait for the tested row lock.
        await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now()) + 100));
        const rows = await db.$queryRaw<Array<{ expired: boolean }>>(Prisma.sql`
          SELECT lease_expires_at < CURRENT_TIMESTAMP AS expired
          FROM story_studio_choice_jobs WHERE id = ${f.jobId}::uuid`);
        expect(rows).toEqual([{ expired: true }]);
        expect(await claim(worker(f))).toBeNull();
        expect((await state(f)).job).toMatchObject({ status: 'processing',
          leaseToken: owned.job.leaseToken, completedParts: 0 });
        expect((await state(f)).release).toEqual(owned.release);
        validation.open();
        expect(await running).toBe('failed');
        expect((await state(f)).job).toMatchObject({ status: 'failed', completedParts: 1,
          errorCode: 'STUDIO_CHOICES_LEASE_CHANGED', leaseToken: null, leaseExpiresAt: null });
        expect((await state(f)).release).toEqual(owned.release);
        expect(owned.release.validationSummary).toMatchObject({ ready: false });
        expect(f.provider.generate).toHaveBeenCalledTimes(1);
      } finally { scan.open(); validation.open(); await running; }
    });
  }, 60_000);

  it('rolls back the completion CAS if release.ready fails, then fails only the still-owned original lease', async () => {
    const f = await fixture();
    await withClaimScope(f, async () => {
      const seed = await persistFirstPartWithoutCounter(f);
      await expire(f, seed.leaseToken);
      const pause = barrier();
      let inside: Awaited<ReturnType<typeof state>> | undefined;
      let rolledBack: Awaited<ReturnType<typeof state>> | undefined;
      const replacement = worker(f, { afterChoiceScan: pause.pause,
        beforeReleaseReady: async tx => {
          inside = { job: await tx.storyStudioChoiceJob.findUniqueOrThrow({ where: { id: f.jobId } }),
            release: await tx.storyRelease.findUniqueOrThrow({ where: { id: f.materialized.releaseId } }) };
          throw new Error('Injected release readiness write failure');
        },
        afterTransactionRollback: async () => { rolledBack = await state(f); },
      });
      const running = replacement.executeOne();
      try {
        await waitForPause(pause, running);
        const owned = await state(f);
        expect(owned.job).toMatchObject({ status: 'processing', completedParts: 0 });
        expect(owned.job.leaseToken).not.toBe(seed.leaseToken);
        pause.open();
        expect(await running).toBe('failed');
        expect(inside?.job).toMatchObject({ status: 'completed', completedParts: 1,
          leaseToken: null, leaseExpiresAt: null });
        expect(inside?.release).toEqual(owned.release);
        expect(rolledBack).toEqual(owned);
        expect((await state(f)).job).toMatchObject({ status: 'failed', completedParts: 1,
          errorCode: 'STUDIO_CHOICES_PREPARATION_FAILED', leaseToken: null, leaseExpiresAt: null });
        expect((await state(f)).release).toEqual(owned.release);
        expect(owned.release.validationSummary).toMatchObject({ ready: false });
        expect(await storedChoices(f)).toHaveLength(3);
        expect(await preparedProofs(f)).toHaveLength(1);
        expect(f.provider.generate).toHaveBeenCalledTimes(1);
      } finally { pause.open(); await running; }
    });
  }, 60_000);

  it.each(['resolve', 'reject'] as const)(
    'fences a stale provider %s after real takeover without replacing the current token or persisting choices', async outcome => {
      const f = await fixture();
      await withClaimScope(f, async () => {
        const pause = barrier();
        f.provider.generate.mockImplementationOnce(async input => {
          await pause.pause();
          if (outcome === 'reject') throw new Error('Offline provider interruption');
          return generatedChoices(input);
        });
        const running = worker(f).executeOne();
        try {
          await waitForPause(pause, running);
          const old = await state(f);
          await expire(f, old.job.leaseToken!);
          const takeover = await claim(worker(f));
          expect(takeover).toMatchObject({ id: f.jobId, recovered: true });
          expect(takeover!.leaseToken).not.toBe(old.job.leaseToken);
          const current = await state(f);
          const choices = await storedChoices(f);
          pause.open();
          expect(await running).toBe('idle');
          expect(await state(f)).toEqual(current);
          expect(current.job).toMatchObject({ status: 'processing', leaseToken: takeover!.leaseToken,
            completedParts: 0, errorCode: null });
          expect(current.release.validationSummary).toMatchObject({ ready: false });
          expect(await storedChoices(f)).toEqual(choices);
          expect(choices).toHaveLength(1);
          expect(await preparedProofs(f)).toHaveLength(0);
          expect(f.provider.generate).toHaveBeenCalledTimes(1);
        } finally { pause.open(); await running; }
      });
    }, 60_000,
  );
});
