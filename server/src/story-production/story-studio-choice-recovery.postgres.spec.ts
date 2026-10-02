import 'reflect-metadata';
import { HttpException, type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClient, Prisma, type StoryChoice } from '@prisma/client';
import { randomUUID } from 'crypto';
import { request } from 'http';
import { type AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { PrismaService } from '../prisma/prisma.service';
import { type GeneratedPartChoices, StoryChoicePreparationProvider,
  type StoryChoicePreparationInput } from './story-choice-preparation.provider';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { StoryEconomicsService } from './story-economics.service';
import { preparePastedManuscript, storedManuscriptBody } from './story-manuscript-file.policy';
import { StoryStudioChoiceJobService } from './story-studio-choice-job.service';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';
import { StoryStudioChoiceRecoveryService } from './story-studio-choice-recovery.service';
import { StoryStudioLinearService } from './story-studio-linear.service';
import { StoryStudioLinearController } from './story-studio-linear.controller';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
const OLD_STYLE = 'First-person observation with short, restrained sentences.';
const NEW_STYLE = 'Close third-person observation with longer, lyrical sentences.';
const ARCHIVE_ACTION = 'story_studio_choices.reset_archive';
const RESET_MARKER = 'STUDIO_CHOICES_REPREPARATION_READY';

function choiceSnapshot(row: StoryChoice) {
  return { id: row.id, sceneId: row.sceneId, choiceKey: row.choiceKey, position: row.position,
    label: row.label, routeKind: row.routeKind, targetSceneId: row.targetSceneId,
    targetEndingKey: row.targetEndingKey, declaredRejoinSceneId: row.declaredRejoinSceneId };
}

function nonNullSnapshot(value: Prisma.JsonValue): Prisma.InputJsonValue {
  if (value === null) throw new Error('The release fixture requires non-null snapshots');
  return value;
}

function jsonObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(jsonObjects);
  if (!value || typeof value !== 'object') return [];
  const row = value as Record<string, unknown>;
  return [row, ...Object.values(row).flatMap(jsonObjects)];
}

postgres('Private stale Studio choice recovery (isolated PostgreSQL, fake provider)', () => {
  let db: PrismaClient;
  const jobs: StoryStudioChoiceJobService[] = [];

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' ||
        parsed.port !== '55432' || parsed.username !== 'lumina_qa' ||
        parsed.pathname !== '/lumina_story_qa' || parsed.search || parsed.hash) {
      throw new Error('Dedicated story QA database required');
    }
    expect(process.env.NODE_ENV).toBe('test');
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
  });

  beforeEach(() => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network calls are forbidden in choice recovery QA'));
  });

  afterEach(() => {
    for (const job of jobs.splice(0)) job.onModuleDestroy();
    try {
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      jest.restoreAllMocks();
    }
  });

  afterAll(async () => { await db?.$disconnect(); });

  async function fixture(authoredLabels = false) {
    const owner = await db.user.create({ data: {} });
    const work = await db.storyWork.create({ data: {
      ownerUserId: owner.id, slug: `studio-choice-recovery-${randomUUID()}`,
      title: { ko: 'The private ledger' }, summary: {},
    } });
    const texts = ['The archivist found a sealed ledger.', 'The archivist carried the ledger into the final room.'];
    const raw = texts.join('\n\n');
    const secondStart = texts[0].length + 2;
    const prepared = preparePastedManuscript(Buffer.from(raw), JSON.stringify({
      locale: 'ko', confirmed: true, parts: [
        { partKey: 'part-1', title: 'The ledger', start: 0, end: secondStart },
        { partKey: 'part-2', title: 'The final room', start: secondStart, end: raw.length },
      ],
    }));
    const manuscript = await db.storyManuscriptVersion.create({ data: {
      workId: work.id, ownerUserId: owner.id, version: 1, locale: 'ko',
      contentHash: prepared.contentHash, structuredBody: storedManuscriptBody(prepared),
    } });
    const rateCard = await db.storyAiRateCard.create({ data: {
      version: `offline-choice-recovery-${randomUUID()}`, provider: 'offline', model: 'fixture',
      status: 'active', inputCostPerMillion: 0, outputCostPerMillion: 0, createdByUserId: owner.id,
    } });
    const analysis = await db.storyAnalysisJob.create({ data: {
      workId: work.id, manuscriptVersionId: manuscript.id, analysisVersion: 1,
      idempotencyKey: randomUUID(), status: 'completed', pipeline: 'semantic_extraction_v1',
      sourceContentHash: prepared.contentHash, sourceLocale: 'ko', actorUserId: owner.id,
      rateCardId: rateCard.id, sourceDigest: prepared.contentHash, configHash: prepared.contentHash,
      totalParagraphs: prepared.paragraphCount, completedParagraphs: prepared.paragraphCount,
      plannedParagraphs: prepared.paragraphCount,
    } });
    await db.storyAnalysisEvidence.create({ data: {
      analysisJobId: analysis.id, provenance: 'semantic_candidate', sequence: 1,
      evidenceType: 'style', sourcePartKey: 'part-1', sourceParagraphIndex: 0,
      payload: { title: 'Narrative style', observation: OLD_STYLE, styleCategory: 'narration' },
    } });
    const profiles = new StoryGenerationProfileService(db as never);
    const draft = await profiles.getOrCreate(owner.id, work.id);
    expect(draft.profile.status).toBe('needs_review');
    const settings = normalizeCreatorGenerationProfile('story', draft.profile.draftSettings);
    const reviewed = await profiles.update(owner.id, work.id, { settings: {
      ...settings, sections: settings.sections.map(section => ({ ...section, decision: 'accepted' as const })),
    } });
    const approved = await profiles.approve(owner.id, work.id, {
      expectedDraftFingerprint: reviewed.profile.draftFingerprint!,
    });
    const review = await db.storyWriterReview.create({ data: {
      workId: work.id, ownerUserId: owner.id, manuscriptVersionId: manuscript.id,
      analysisJobId: analysis.id, state: 'submitted',
    } });
    await db.storyFinalSubmission.create({ data: {
      reviewId: review.id, manuscriptVersionId: manuscript.id,
      idempotencyKey: randomUUID(), checksum: prepared.contentHash,
    } });
    await db.storyStyleProfileConsent.create({ data: {
      workId: work.id, ownerUserId: owner.id, manuscriptVersionId: manuscript.id,
      rightsConfirmed: true, aiBranchAllowed: true, allowedLocales: ['ko'], startsAt: new Date(0),
    } });
    const choices = new StoryStudioChoicePreparationService(db as never);
    const studio = new StoryStudioLinearService(db as never, choices);
    const materialized = await studio.materialize(owner.id, work.id, {
      manuscriptVersionId: manuscript.id, expectedManuscriptHash: prepared.contentHash,
      originalRoutesReviewed: true,
      originalRoutes: prepared.parts.map((part, index) => ({ partKey: part.partKey,
        ...(authoredLabels ? { label: `Preserve the ledger on the author's route ${index + 1}` } : {}) })),
    });
    const provider = { modelName: 'offline-choice-recovery',
      generate: jest.fn(async (input: StoryChoicePreparationInput): Promise<GeneratedPartChoices[]> => {
        const style = input.generationProfile?.sections.find(section => section.key === 'writing_style')?.value;
        expect(style).toMatchObject({ referenceScope: 'production_constraint' });
        expect([OLD_STYLE, NEW_STYLE]).toContain(style?.summary);
        const version = style?.summary === NEW_STYLE ? 'new' : 'old';
        return input.parts.map(part => ({ partKey: part.partKey,
          originalChoiceLabel: part.originalChoiceLabel ?? `Preserve the ledger along the authored ${part.partKey} route`,
          alternatives: [`Hide the ${version} ledger and search alone in ${part.partKey}`,
            `Reveal the ${version} ledger and question the archivists in ${part.partKey}`],
        }));
      }) };
    const providerFactory = jest.spyOn(choices as unknown as { provider: () => StoryChoicePreparationProvider },
      'provider').mockReturnValue(provider as never);
    const job = new StoryStudioChoiceJobService(db as never, choices);
    jobs.push(job);
    // Never claim another suite's queued job from the shared isolated QA database.
    jest.spyOn(job as unknown as { claim: () => Promise<{ id: string; leaseToken: string } | null> }, 'claim')
      .mockImplementation(async () => {
        const target = await db.storyStudioChoiceJob.findUniqueOrThrow({ where: { releaseId: materialized.releaseId } });
        const leaseToken = randomUUID();
        const changed = await db.storyStudioChoiceJob.updateMany({
          where: { id: target.id, status: 'queued' }, data: { status: 'processing', leaseToken,
            leaseExpiresAt: new Date(Date.now() + 5 * 60_000) },
        });
        return changed.count === 1 ? { id: target.id, leaseToken } : null;
      });
    const execute = jest.spyOn(job, 'executeOne');
    const retry = jest.spyOn(job, 'retry');
    const prepare = jest.spyOn(choices, 'prepare');
    const recovery = new StoryStudioChoiceRecoveryService(db as never, choices);
    return { owner, work, manuscript, prepared, profiles, approved, materialized, choices,
      provider, providerFactory, job, execute, retry, prepare, studio, recovery };
  }

  type Fixture = Awaited<ReturnType<typeof fixture>>;

  async function approveChangedProfile(f: Fixture) {
    const current = await f.profiles.getOrCreate(f.owner.id, f.work.id);
    const settings = normalizeCreatorGenerationProfile('story', current.profile.draftSettings);
    const changed = await f.profiles.update(f.owner.id, f.work.id, { settings: {
      ...settings, sections: settings.sections.map(section => section.key === 'writing_style'
        ? { ...section, decision: 'edited' as const, value: { ...section.value, summary: NEW_STYLE } }
        : section),
    } });
    await expect(f.recovery.review(f.owner.id, f.work.id, f.materialized.releaseId))
      .resolves.toMatchObject({ status: 'approval_required', canReset: false, generationStarted: false });
    const approved = await f.profiles.approve(f.owner.id, f.work.id, {
      expectedDraftFingerprint: changed.profile.draftFingerprint!,
    });
    expect(approved.profile.status).toBe('approved');
    expect(approved.profile.approvedFingerprint).not.toBe(f.approved.profile.approvedFingerprint);
    return approved;
  }

  async function complete(f: Fixture) {
    for (const _scene of f.materialized.scenes) expect(await f.job.executeOne()).toBe('progress');
    expect(await f.job.executeOne()).toBe('completed');
    await expect(f.studio.finish(f.owner.id, f.work.id, f.materialized.releaseId))
      .resolves.toMatchObject({ ready: true, published: false });
  }

  async function rows(f: Fixture) {
    return db.storyChoice.findMany({ where: { sceneId: { in: f.materialized.scenes.map(scene => scene.sceneId) } },
      orderBy: [{ sceneId: 'asc' }, { position: 'asc' }, { id: 'asc' }] });
  }

  async function archives(f: Fixture) {
    return db.auditEvent.findMany({ where: { action: ARCHIVE_ACTION,
      targetId: { in: f.materialized.scenes.map(scene => scene.sceneId) } }, orderBy: { id: 'asc' } });
  }

  async function resetInput(f: Fixture) {
    const profile = await f.profiles.getOrCreate(f.owner.id, f.work.id);
    const release = await db.storyRelease.findUniqueOrThrow({ where: { id: f.materialized.releaseId } });
    const review = await f.recovery.review(f.owner.id, f.work.id, f.materialized.releaseId);
    expect(review.expectedProfilePinHash).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
    return { expectedManuscriptHash: f.prepared.contentHash,
      expectedApprovedFingerprint: profile.profile.approvedFingerprint!,
      expectedProfilePinHash: review.expectedProfilePinHash!,
      expectedReleaseChecksum: release.checksum, resetConfirmed: true as const };
  }

  function callCounts(f: Fixture) {
    return { generate: f.provider.generate.mock.calls.length, factory: f.providerFactory.mock.calls.length,
      execute: f.execute.mock.calls.length, retry: f.retry.mock.calls.length, prepare: f.prepare.mock.calls.length };
  }

  async function state(f: Fixture) {
    const sceneIds = f.materialized.scenes.map(scene => scene.sceneId);
    const profiles = await db.storyWorkGenerationProfile.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } });
    return {
      work: await db.storyWork.findUniqueOrThrow({ where: { id: f.work.id } }),
      manuscript: await db.storyManuscriptVersion.findUniqueOrThrow({ where: { id: f.manuscript.id } }),
      profiles,
      release: await db.storyRelease.findUniqueOrThrow({ where: { id: f.materialized.releaseId } }),
      releases: await db.storyRelease.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } }),
      job: await db.storyStudioChoiceJob.findUniqueOrThrow({ where: { releaseId: f.materialized.releaseId } }),
      parts: await db.storyPart.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } }),
      scenes: await db.storyScene.findMany({ where: { id: { in: sceneIds } }, orderBy: { id: 'asc' } }),
      beats: await db.storyBeat.findMany({ where: { sceneId: { in: sceneIds } }, orderBy: { id: 'asc' } }),
      choices: await rows(f),
      audits: await db.auditEvent.findMany({ where: { OR: [
        { actorUserId: f.owner.id },
        { targetId: { in: [f.work.id, f.materialized.releaseId, ...sceneIds, ...profiles.map(profile => profile.id)] } },
      ] }, orderBy: { id: 'asc' } }),
      progress: await db.storyReaderProgress.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } }),
      transitions: await db.storyPublicationTransition.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } }),
    };
  }

  describe('renewed consent explicit approval', () => {
    const owned: Fixture[] = [];
    async function renewed() {
      const f = await fixture(true); owned.push(f); await complete(f);
      await db.storyStyleProfileConsent.update({ where: { workId: f.work.id }, data: { revision: { increment: 1 } } });
      const view = await f.recovery.review(f.owner.id, f.work.id, f.materialized.releaseId);
      expect(view).toMatchObject({ status: 'consent_changed', canReset: false,
        consentReview: { canReapprove: true, consentRevision: 2 } });
      const input = { expectedManuscriptHash: view.expectedManuscriptHash!, expectedApprovedFingerprint: view.expectedApprovedFingerprint!,
        expectedProfilePinHash: view.expectedProfilePinHash!, expectedReleaseChecksum: view.expectedReleaseChecksum!,
        expectedConsentId: view.consentReview!.consentId, expectedConsentRevision: view.consentReview!.consentRevision,
        expectedBatchHash: view.consentReview!.batchHash, choicesReviewed: true, currentConsentConfirmed: true };
      return { f, input };
    }
    async function mixed() {
      const { f } = await renewed(); await approveChangedProfile(f);
      const view = await f.recovery.review(f.owner.id, f.work.id, f.materialized.releaseId);
      expect(view).toMatchObject({ status: 'settings_changed', canReset: true, resetRequiredScenes: 2,
        resetConsentReview: { consentRevision: 2 } });
      return { f, input: { expectedManuscriptHash: view.expectedManuscriptHash!,
        expectedApprovedFingerprint: view.expectedApprovedFingerprint!, expectedProfilePinHash: view.expectedProfilePinHash!,
        expectedReleaseChecksum: view.expectedReleaseChecksum!, resetConfirmed: true,
        expectedConsentId: view.resetConsentReview!.consentId, expectedConsentRevision: view.resetConsentReview!.consentRevision,
        expectedBatchHash: view.resetConsentReview!.batchHash, consentChangeConfirmed: true } };
    }
    afterEach(async () => {
      for (const f of owned.splice(0)) await db.$transaction(async tx => {
        // Remove only this unit's synthetic records in the existing dedicated QA database.
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        const analyses = await tx.storyAnalysisJob.findMany({ where: { workId: f.work.id }, select: { id: true, rateCardId: true } });
        const reviews = await tx.storyWriterReview.findMany({ where: { workId: f.work.id }, select: { id: true } });
        const sceneIds = f.materialized.scenes.map(scene => scene.sceneId);
        await tx.auditEvent.deleteMany({ where: { actorUserId: f.owner.id } });
        await tx.storyStudioChoiceJob.deleteMany({ where: { workId: f.work.id } });
        await tx.storyVisualGeneration.deleteMany({ where: { workId: f.work.id } });
        await tx.storyVisualPrompt.deleteMany({ where: { workId: f.work.id } });
        await tx.storyChoice.deleteMany({ where: { sceneId: { in: sceneIds } } });
        await tx.storyBeat.deleteMany({ where: { sceneId: { in: sceneIds } } });
        await tx.storyScene.deleteMany({ where: { id: { in: sceneIds } } });
        await tx.storyPart.deleteMany({ where: { workId: f.work.id } });
        await tx.storyRelease.deleteMany({ where: { workId: f.work.id } });
        await tx.storyFinalSubmission.deleteMany({ where: { reviewId: { in: reviews.map(row => row.id) } } });
        await tx.storyWriterReview.deleteMany({ where: { workId: f.work.id } });
        await tx.storyStyleProfileConsent.deleteMany({ where: { workId: f.work.id } });
        await tx.storyWorkGenerationProfile.deleteMany({ where: { workId: f.work.id } });
        await tx.storyMemoryRecord.deleteMany({ where: { workId: f.work.id } });
        await tx.storyAnalysisEvidence.deleteMany({ where: { analysisJobId: { in: analyses.map(row => row.id) } } });
        await tx.storyAnalysisJob.deleteMany({ where: { workId: f.work.id } });
        await tx.storyManuscriptVersion.deleteMany({ where: { workId: f.work.id } });
        await tx.storyAiRateCard.deleteMany({ where: { id: { in: analyses.map(row => row.rateCardId).filter((id): id is string => Boolean(id)) } } });
        await tx.storyWork.deleteMany({ where: { id: f.work.id } });
        await tx.user.deleteMany({ where: { id: f.owner.id } });
      }, { timeout: 30_000 });
    });
    it('commits separate author receipts while preserving all source evidence and replays without new writes or AI', async () => {
      const { f, input } = await renewed(), before = await state(f), calls = callCounts(f);
      await expect(f.choices.assertPublishableTx(db as never, f.work.id, f.owner.id, f.manuscript.id, f.materialized.releaseId))
        .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED' } });
      expect(await f.recovery.reapprove(f.owner.id, f.work.id, f.materialized.releaseId, input))
        .toMatchObject({ status: 'current', reapprovedScenes: 2, generationStarted: false, idempotentReplay: false });
      const after = await state(f);
      for (const key of ['work', 'manuscript', 'profiles', 'parts', 'scenes', 'beats', 'choices'] as const) expect(after[key]).toEqual(before[key]);
      expect(after.audits.filter(row => row.action === 'story_studio_choices.prepared'))
        .toEqual(before.audits.filter(row => row.action === 'story_studio_choices.prepared'));
      expect(after.audits.filter(row => row.action === 'story_studio_choices.consent_reapproved')).toHaveLength(2);
      await expect(f.studio.finish(f.owner.id, f.work.id, f.materialized.releaseId)).resolves.toMatchObject({ ready: true, published: false });
      const replayBefore = await state(f);
      expect(await f.recovery.reapprove(f.owner.id, f.work.id, f.materialized.releaseId, input)).toMatchObject({ idempotentReplay: true, reapprovedScenes: 0 });
      expect(await state(f)).toEqual(replayBefore); expect(callCounts(f)).toEqual(calls);
    }, 60_000);
    it('rolls all author receipts back when the second receipt or release-ready write fails', async () => {
      for (const failure of ['receipt', 'release']) {
        const { f, input } = await renewed(), before = await state(f), calls = callCounts(f);
        let writes = 0;
        const wrapped = { $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number }) => db.$transaction(async tx => callback(new Proxy(tx, {
          get(target, key) {
            if (key === 'auditEvent') return { ...target.auditEvent, create: async (args: Prisma.AuditEventCreateArgs) => {
              if (failure === 'receipt' && ++writes === 2) throw new Error('Synthetic receipt persistence failure');
              return target.auditEvent.create(args);
            } };
            if (key === 'storyRelease' && failure === 'release') return { ...target.storyRelease,
              update: async () => { throw new Error('Synthetic readiness persistence failure'); } };
            return Reflect.get(target, key);
          },
        })), options) };
        const service = new StoryStudioChoiceRecoveryService(wrapped as never, f.choices);
        await expect(service.reapprove(f.owner.id, f.work.id, f.materialized.releaseId, input))
          .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_CONSENT_REVIEW_UNCONFIRMED' } });
        expect(await state(f)).toEqual(before); expect(callCounts(f)).toEqual(calls);
      }
    }, 60_000);
    it('blocks changed labels, renewed-again consent, changed style and foreign actors before any reapproval write', async () => {
      const { f, input } = await renewed(), calls = callCounts(f);
      const alternative = (await rows(f)).find(row => row.position === 2)!;
      await db.storyChoice.update({ where: { id: alternative.id }, data: { label: { ko: 'Changed after review' } } });
      const changed = await state(f);
      await expect(f.recovery.reapprove(f.owner.id, f.work.id, f.materialized.releaseId, input)).rejects.toBeInstanceOf(HttpException);
      expect(await state(f)).toEqual(changed);
      await db.storyChoice.update({ where: { id: alternative.id }, data: { label: nonNullSnapshot(alternative.label) } });
      await db.storyStyleProfileConsent.update({ where: { workId: f.work.id }, data: { revision: 3 } });
      const newer = await state(f);
      await expect(f.recovery.reapprove(f.owner.id, f.work.id, f.materialized.releaseId, input)).rejects.toBeInstanceOf(HttpException);
      expect(await state(f)).toEqual(newer);
      await db.storyStyleProfileConsent.update({ where: { workId: f.work.id }, data: { revision: 2 } });
      await approveChangedProfile(f);
      expect(await f.recovery.review(f.owner.id, f.work.id, f.materialized.releaseId)).toMatchObject({
        status: 'settings_changed', canReset: true, resetConsentReview: { consentRevision: 2 } });
      const style = await state(f);
      await expect(f.recovery.reapprove(f.owner.id, f.work.id, f.materialized.releaseId, input)).rejects.toBeInstanceOf(HttpException);
      await expect(f.recovery.reapprove(randomUUID(), f.work.id, f.materialized.releaseId, input)).rejects.toBeInstanceOf(HttpException);
      expect(await state(f)).toEqual(style); expect(callCounts(f)).toEqual(calls);
    }, 60_000);
    it('serializes duplicate approvals without duplicate receipts and permits a safe fresh replay', async () => {
      const { f, input } = await renewed(), calls = callCounts(f);
      const results = await Promise.allSettled([1, 2].map(() => f.recovery.reapprove(f.owner.id, f.work.id, f.materialized.releaseId, input)));
      expect(results.filter(result => result.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
      for (const result of results) if (result.status === 'rejected') expect(result.reason)
        .toMatchObject({ response: { code: 'STUDIO_CHOICES_CONSENT_REVIEW_UNCONFIRMED' } });
      expect((await state(f)).audits.filter(row => row.action === 'story_studio_choices.consent_reapproved')).toHaveLength(2);
      expect(await f.recovery.reapprove(f.owner.id, f.work.id, f.materialized.releaseId, input)).toMatchObject({ idempotentReplay: true });
      expect(callCounts(f)).toEqual(calls);
    }, 60_000);
    it('mixed reset archives unchanged old proof, preserves prose/routes and starts only after separate retry', async () => {
      const { f, input } = await mixed(), before = await state(f), calls = callCounts(f);
      await expect(f.recovery.reset(f.owner.id, f.work.id, f.materialized.releaseId, {
        expectedManuscriptHash: input.expectedManuscriptHash, expectedApprovedFingerprint: input.expectedApprovedFingerprint,
        expectedProfilePinHash: input.expectedProfilePinHash, expectedReleaseChecksum: input.expectedReleaseChecksum,
        resetConfirmed: true })).rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_RESET_CONSENT_CONFIRMATION_REQUIRED' } });
      expect(await state(f)).toEqual(before);
      expect(await f.recovery.reset(f.owner.id, f.work.id, f.materialized.releaseId, input))
        .toMatchObject({ resetScenes: 2, generationStarted: false, nextAction: 'explicit_retry_required' });
      const after = await state(f);
      for (const key of ['work', 'manuscript', 'profiles', 'parts', 'scenes', 'beats'] as const) expect(after[key]).toEqual(before[key]);
      expect(after.choices).toEqual(before.choices.filter(choice => choice.position === 1));
      expect(after.audits.filter(row => row.action === 'story_studio_choices.prepared'))
        .toEqual(before.audits.filter(row => row.action === 'story_studio_choices.prepared'));
      expect(after.job).toMatchObject({ status: 'failed', completedParts: 0, errorCode: RESET_MARKER });
      expect(after.release.validationSummary).toMatchObject({ ready: false });
      expect(callCounts(f)).toEqual(calls);
      expect(await f.recovery.reset(f.owner.id, f.work.id, f.materialized.releaseId, input)).toMatchObject({ idempotentReplay: true, resetScenes: 0 });
      expect(await state(f)).toEqual(after);
      await f.job.retry(f.owner.id, f.work.id, f.materialized.releaseId);
      expect(f.provider.generate).toHaveBeenCalledTimes(calls.generate);
      await complete(f);
      const regenerated = await state(f);
      expect(regenerated.choices).toHaveLength(6);
      expect(regenerated.choices.filter(choice => choice.position === 1)).toEqual(after.choices);
      expect(regenerated.audits.filter(row => row.action === 'story_studio_choices.prepared' &&
        (row.metadata as Record<string, unknown>)?.consentRevision === 2)).toHaveLength(2);
      expect(f.provider.generate).toHaveBeenCalledTimes(calls.generate + 2);
      expect(regenerated.job).toMatchObject({ status: 'completed', completedParts: 2 });
      expect(regenerated.release.validationSummary).toMatchObject({ ready: true });
    }, 60_000);
    it('mixed reset rolls archive/delete/label/job/release changes back when original validation fails', async () => {
      const { f, input } = await mixed(), before = await state(f), calls = callCounts(f);
      jest.spyOn(f.choices, 'assertOriginalSceneReadyTx').mockRejectedValueOnce(new Error('Synthetic original validation failure'));
      await expect(f.recovery.reset(f.owner.id, f.work.id, f.materialized.releaseId, input))
        .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_RESET_UNCONFIRMED' } });
      expect(await state(f)).toEqual(before); expect(callCounts(f)).toEqual(calls);
    }, 60_000);
    it('mixed reset binds the exact proof identity and renewed-again consent before any writes', async () => {
      const { f, input } = await mixed(), calls = callCounts(f);
      await db.storyStyleProfileConsent.update({ where: { workId: f.work.id }, data: { revision: 3 } });
      const newer = await state(f);
      await expect(f.recovery.reset(f.owner.id, f.work.id, f.materialized.releaseId, input))
        .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_RESET_SOURCE_CHANGED' } });
      expect(await state(f)).toEqual(newer);
      await db.storyStyleProfileConsent.update({ where: { workId: f.work.id }, data: { revision: 2 } });
      const priorProof = await db.auditEvent.findFirstOrThrow({ where: { actorUserId: f.owner.id,
        action: 'story_studio_choices.prepared', targetId: f.materialized.scenes[0].sceneId } });
      await db.auditEvent.create({ data: { actorUserId: f.owner.id, actorType: 'user', action: priorProof.action,
        targetType: 'story_scene', targetId: priorProof.targetId, metadata: nonNullSnapshot(priorProof.metadata) } });
      const replaced = await state(f);
      await expect(f.recovery.reset(f.owner.id, f.work.id, f.materialized.releaseId, input))
        .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_RESET_SOURCE_CHANGED' } });
      expect(await state(f)).toEqual(replaced); expect(callCounts(f)).toEqual(calls);
    }, 60_000);
    it('mixed duplicate reset commits one archive per affected scene and fresh replay never re-deletes', async () => {
      const { f, input } = await mixed(), calls = callCounts(f);
      const outcomes = await Promise.allSettled([1, 2].map(() => f.recovery.reset(f.owner.id, f.work.id, f.materialized.releaseId, input)));
      expect(outcomes.filter(result => result.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
      for (const result of outcomes) if (result.status === 'rejected') expect(result.reason)
        .toMatchObject({ response: { code: 'STUDIO_CHOICES_RESET_UNCONFIRMED' } });
      expect(await archives(f)).toHaveLength(2); expect(await rows(f)).toHaveLength(2);
      const after = await state(f);
      expect(await f.recovery.reset(f.owner.id, f.work.id, f.materialized.releaseId, input)).toMatchObject({ idempotentReplay: true });
      expect(await state(f)).toEqual(after); expect(callCounts(f)).toEqual(calls);
    }, 60_000);

    describe('real recovery HTTP and update races', () => {
      let app: INestApplication | undefined;
      const extraUsers: string[] = [];

      afterEach(async () => {
        await app?.close(); app = undefined;
        for (const id of extraUsers.splice(0)) await db.user.delete({ where: { id } });
      });

      async function http(f: Fixture) {
        const jwt = new JwtService(), secret = randomUUID();
        const tokenFor = (sub: string, tokenType = 'access') => jwt.signAsync({ sub, tokenType }, { secret, expiresIn: '5m' });
        const token = await tokenFor(f.owner.id);
        const module = await Test.createTestingModule({ controllers: [StoryStudioLinearController], providers: [
          { provide: StoryStudioLinearService, useValue: f.studio },
          { provide: StoryStudioChoiceJobService, useValue: f.job },
          { provide: StoryStudioChoiceRecoveryService, useValue: f.recovery },
          { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt },
          { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) }, JwtAuthGuard,
        ] }).compile();
        app = module.createNestApplication({ logger: false });
        configureHttpRouting(app); app.useGlobalFilters(new HttpExceptionFilter());
        app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
        await app.listen(0, '127.0.0.1');
        const port = (app.getHttpServer().address() as AddressInfo).port;
        function call(action: string, body?: unknown, authorization: string | null = token) {
          return new Promise<{ status: number; cache: string | undefined; body: any }>((resolve, reject) => {
            const payload = body === undefined ? '' : JSON.stringify(body);
            const req = request({ hostname: '127.0.0.1', port, method: action === 'choice-review' ? 'GET' : 'POST',
              path: `/api/v1/me/creator-studio/stories/${f.work.id}/linear-draft/releases/${f.materialized.releaseId}/${action}`,
              headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
                ...(authorization ? { authorization: `Bearer ${authorization}` } : {}) } }, res => {
              const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk));
              res.on('end', () => {
                try { resolve({ status: res.statusCode!, cache: res.headers['cache-control'],
                  body: JSON.parse(Buffer.concat(chunks).toString()) }); } catch (error) { reject(error); }
              });
            });
            req.setTimeout(10000, () => req.destroy(new Error('Local recovery HTTP timeout')));
            req.on('error', reject); req.end(payload);
          });
        }
        return { call, tokenFor };
      }

      function requestFromReview(view: Awaited<ReturnType<StoryStudioChoiceRecoveryService['review']>>) {
        const binding = view.resetConsentReview!;
        return { expectedManuscriptHash: view.expectedManuscriptHash!, expectedApprovedFingerprint: view.expectedApprovedFingerprint!,
          expectedProfilePinHash: view.expectedProfilePinHash!, expectedReleaseChecksum: view.expectedReleaseChecksum!,
          resetConfirmed: true, expectedConsentId: binding.consentId, expectedConsentRevision: binding.consentRevision,
          expectedBatchHash: binding.batchHash, consentChangeConfirmed: true };
      }

      it('authenticates actual users and persists GET/reset/replay before a separate offline preparation retry', async () => {
        const { f } = await mixed(), before = await state(f), calls = callCounts(f), client = await http(f);
        const reviewed = await client.call('choice-review');
        expect(reviewed).toMatchObject({ status: 200, cache: 'private, no-store', body: {
          status: 'settings_changed', canReset: true, resetRequiredScenes: 2, resetConsentReview: { consentRevision: 2 } } });
        expect(await state(f)).toEqual(before);
        const body = requestFromReview(reviewed.body);
        expect(await client.call('retry-choices', {})).toMatchObject({ status: 409 });
        expect(await state(f)).toEqual(before); expect(callCounts(f)).toEqual(calls);
        const reset = await client.call('reset-choices', body);
        expect(reset).toMatchObject({ status: 201, cache: 'private, no-store', body: {
          status: 'reset_ready', resetScenes: 2, generationStarted: false, nextAction: 'explicit_retry_required', idempotentReplay: false } });
        const after = await state(f);
        for (const key of ['work', 'manuscript', 'profiles', 'parts', 'scenes', 'beats'] as const) expect(after[key]).toEqual(before[key]);
        expect(after.choices).toEqual(before.choices.filter(row => row.position === 1));
        expect(after.audits.filter(row => row.action === 'story_studio_choices.prepared'))
          .toEqual(before.audits.filter(row => row.action === 'story_studio_choices.prepared'));
        expect(after.job).toMatchObject({ status: 'failed', completedParts: 0, errorCode: RESET_MARKER });
        expect(callCounts(f)).toEqual(calls);
        expect(await client.call('reset-choices', body)).toMatchObject({ status: 201, body: { idempotentReplay: true, resetScenes: 0 } });
        expect(await state(f)).toEqual(after);
        expect(await client.call('choice-review')).toMatchObject({ status: 200, body: { status: 'reset_ready', preparedScenes: 0 } });
        expect(await client.call('retry-choices', {})).toMatchObject({ status: 201, body: { status: 'queued' } });
        expect(f.provider.generate).toHaveBeenCalledTimes(calls.generate);
        await complete(f);
        expect(await client.call('finish', {})).toMatchObject({ status: 201, body: { ready: true, published: false } });
        expect(await client.call('choice-review')).toMatchObject({ status: 200, body: { status: 'current', preparedScenes: 2 } });
        expect(f.provider.generate).toHaveBeenCalledTimes(calls.generate + 2);
      }, 60_000);

      it('rejects missing, invalid, refresh, inactive and foreign-owner credentials without persistence', async () => {
        const { f, input } = await mixed(), before = await state(f), calls = callCounts(f), client = await http(f);
        const foreign = await db.user.create({ data: {} }); extraUsers.push(foreign.id);
        const foreignToken = await client.tokenFor(foreign.id);
        for (const token of [null, 'invalid', await client.tokenFor(f.owner.id, 'refresh')]) {
          expect((await client.call('choice-review', undefined, token)).status).toBe(401);
          expect((await client.call('reset-choices', input, token)).status).toBe(401);
        }
        expect((await client.call('choice-review', undefined, foreignToken)).status).toBe(404);
        expect((await client.call('reset-choices', input, foreignToken)).status).toBe(404);
        await db.user.update({ where: { id: foreign.id }, data: { status: 'suspended' } });
        expect((await client.call('choice-review', undefined, foreignToken)).status).toBe(401);
        expect((await client.call('reset-choices', input, foreignToken)).status).toBe(401);
        expect(await state(f)).toEqual(before); expect(callCounts(f)).toEqual(calls);
      }, 60_000);

      it('rejects malformed, partial, caller-controlled and stale source input through HTTP against the actual database', async () => {
        const { f, input } = await mixed(), before = await state(f), calls = callCounts(f), client = await http(f);
        for (const field of ['expectedConsentId', 'expectedConsentRevision', 'expectedBatchHash', 'consentChangeConfirmed']) {
          const missing: Record<string, unknown> = { ...input }; delete missing[field];
          expect((await client.call('reset-choices', missing)).status).toBe(400);
          expect((await client.call('reset-choices', { ...input, [field]: null })).status).toBe(400);
        }
        for (const body of [{ ...input, expectedConsentRevision: '2' }, { ...input, consentChangeConfirmed: false },
          { ...input, actorUserId: randomUUID() }, { ...input, apiKey: 'offline-not-a-key' }, JSON.stringify(input)]) {
          expect((await client.call('reset-choices', body)).status).toBe(400);
        }
        const { expectedConsentId: _id, expectedConsentRevision: _revision, expectedBatchHash: _batch,
          consentChangeConfirmed: _confirm, ...legacy } = input;
        expect(await client.call('reset-choices', legacy)).toMatchObject({ status: 409,
          body: { error: { code: 'STUDIO_CHOICES_RESET_CONSENT_CONFIRMATION_REQUIRED' } } });
        for (const field of ['expectedBatchHash', 'expectedProfilePinHash', 'expectedReleaseChecksum']) {
          expect(await client.call('reset-choices', { ...input, [field]: 'f'.repeat(64) })).toMatchObject({ status: 409,
            body: { error: { code: 'STUDIO_CHOICES_RESET_SOURCE_CHANGED' } } });
        }
        expect(await state(f)).toEqual(before); expect(callCounts(f)).toEqual(calls);
      }, 60_000);

      it('does not accept an HTTP review after consent renews again and rolls a failed reset back before fresh retry', async () => {
        const { f } = await mixed(), calls = callCounts(f), client = await http(f);
        const reviewed = await client.call('choice-review'), prior = requestFromReview(reviewed.body);
        await db.storyStyleProfileConsent.update({ where: { workId: f.work.id }, data: { revision: 3 } });
        const newer = await state(f);
        expect(await client.call('reset-choices', prior)).toMatchObject({ status: 409,
          body: { error: { code: 'STUDIO_CHOICES_RESET_SOURCE_CHANGED' } } });
        expect(await state(f)).toEqual(newer);
        const fresh = requestFromReview((await client.call('choice-review')).body);
        const failure = jest.spyOn(f.choices, 'assertOriginalSceneReadyTx').mockRejectedValueOnce(new Error('Offline persistence failure'));
        expect(await client.call('reset-choices', fresh)).toMatchObject({ status: 503,
          body: { error: { code: 'STUDIO_CHOICES_RESET_UNCONFIRMED' } } });
        expect(await state(f)).toEqual(newer); expect(callCounts(f)).toEqual(calls); failure.mockRestore();
        expect(await client.call('reset-choices', fresh)).toMatchObject({ status: 201, body: { resetScenes: 2, generationStarted: false } });
        expect(callCounts(f)).toEqual(calls);
      }, 60_000);

      function latch() {
        let release!: () => void;
        const promise = new Promise<void>(resolve => { release = resolve; });
        return { promise, release };
      }

      async function blockedBy(pid: number, blocker: number) {
        const until = Date.now() + 5000;
        do {
          const result = await db.$queryRaw<Array<{ blocked: boolean }>>(Prisma.sql`
            SELECT ${blocker}::integer = ANY(pg_blocking_pids(${pid}::integer)) AS blocked`);
          if (result[0]?.blocked) return;
          await new Promise(resolve => setTimeout(resolve, 10));
        } while (Date.now() < until);
        throw new Error('The expected isolated row-lock wait was not observed');
      }

      function watchedReset(f: Fixture, observed: { pid?: number }, signal: ReturnType<typeof latch>) {
        const wrapped = { $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number }) => db.$transaction(async tx => {
          const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          observed.pid = pid; signal.release();
          return callback(tx);
        }, options) };
        return new StoryStudioChoiceRecoveryService(wrapped as never, f.choices);
      }

      it('cannot reset old reviewed rights while a concurrent consent update owns the row lock', async () => {
        const { f, input } = await mixed(), before = await state(f), calls = callCounts(f);
        const held = latch(), unlock = latch(), entered = latch(), observed: { pid?: number } = {};
        let blocker = 0;
        const mutation = db.$transaction(async tx => {
          const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; blocker = pid;
          await tx.storyStyleProfileConsent.update({ where: { workId: f.work.id }, data: { revision: 3 } });
          held.release(); await unlock.promise;
        }, { timeout: 15000 });
        let reset: Promise<unknown> | undefined;
        try {
          await held.promise;
          reset = watchedReset(f, observed, entered).reset(f.owner.id, f.work.id, f.materialized.releaseId, input);
          const outcome = reset.then(value => ({ value, error: null }), error => ({ value: null, error }));
          await entered.promise; await blockedBy(observed.pid!, blocker); unlock.release(); await mutation;
          const result = await outcome;
          expect(result.value).toBeNull(); expect(result.error).toBeInstanceOf(HttpException);
          expect(['STUDIO_CHOICES_RESET_SOURCE_CHANGED', 'STUDIO_CHOICES_RESET_UNCONFIRMED'])
            .toContain((result.error as any).response.code);
          expect(await state(f)).toEqual(before); expect(await archives(f)).toHaveLength(0);
          expect((await db.storyStyleProfileConsent.findUniqueOrThrow({ where: { workId: f.work.id } })).revision).toBe(3);
          expect(callCounts(f)).toEqual(calls);
        } finally { unlock.release(); await Promise.allSettled([mutation, ...(reset ? [reset] : [])]); }
      }, 60_000);

      it('cannot reset with the old approved profile when a real profile update commits first', async () => {
        const { f, input } = await mixed(), before = await state(f), calls = callCounts(f);
        const held = latch(), unlock = latch(), entered = latch(), observed: { pid?: number } = {};
        let blocker = 0;
        const wrapped = new Proxy(db, { get(target, key) {
          if (key === '$transaction') return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(async tx => {
            const result = await callback(tx);
            const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; blocker = pid;
            held.release(); await unlock.promise; return result;
          }, { timeout: 15000 });
          return Reflect.get(target, key);
        } });
        const current = await f.profiles.getOrCreate(f.owner.id, f.work.id);
        const settings = normalizeCreatorGenerationProfile('story', current.profile.draftSettings);
        const mutation = new StoryGenerationProfileService(wrapped as never).update(f.owner.id, f.work.id, { settings: {
          ...settings, sections: settings.sections.map(section => section.key === 'writing_style'
            ? { ...section, decision: 'edited' as const, value: { ...section.value, summary: 'Revised third-person, current approval pending.' } }
            : section),
        } });
        let reset: Promise<unknown> | undefined;
        try {
          await held.promise;
          reset = watchedReset(f, observed, entered).reset(f.owner.id, f.work.id, f.materialized.releaseId, input);
          const outcome = reset.then(value => ({ value, error: null }), error => ({ value: null, error }));
          await entered.promise; await blockedBy(observed.pid!, blocker); unlock.release(); await mutation;
          const result = await outcome;
          expect(result.value).toBeNull(); expect(result.error).toBeInstanceOf(HttpException);
          const after = await state(f);
          for (const key of ['manuscript', 'release', 'job', 'parts', 'scenes', 'beats', 'choices'] as const) expect(after[key]).toEqual(before[key]);
          expect({ ...after.work, updatedAt: before.work.updatedAt }).toEqual(before.work);
          expect(await archives(f)).toHaveLength(0);
          expect(await f.recovery.review(f.owner.id, f.work.id, f.materialized.releaseId))
            .toMatchObject({ status: 'approval_required', canReset: false });
          expect(callCounts(f)).toEqual(calls);
        } finally { unlock.release(); await Promise.allSettled([mutation, ...(reset ? [reset] : [])]); }
      }, 60_000);

      it('cannot erase choices after a concurrent lease acquisition updates its own job', async () => {
        const { f, input } = await mixed(), before = await state(f), calls = callCounts(f);
        const held = latch(), unlock = latch(), entered = latch(), observed: { pid?: number } = {};
        const leaseToken = randomUUID(); let blocker = 0;
        const mutation = db.$transaction(async tx => {
          const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; blocker = pid;
          await tx.storyStudioChoiceJob.update({ where: { releaseId: f.materialized.releaseId }, data: {
            status: 'processing', leaseToken, leaseExpiresAt: new Date(Date.now() + 60000) } });
          held.release(); await unlock.promise;
        }, { timeout: 15000 });
        let reset: Promise<unknown> | undefined;
        try {
          await held.promise;
          reset = watchedReset(f, observed, entered).reset(f.owner.id, f.work.id, f.materialized.releaseId, input);
          const outcome = reset.then(value => ({ value, error: null }), error => ({ value: null, error }));
          await entered.promise; await blockedBy(observed.pid!, blocker); unlock.release(); await mutation;
          const result = await outcome;
          expect(result.value).toBeNull(); expect(result.error).toBeInstanceOf(HttpException);
          const after = await state(f);
          for (const key of ['work', 'manuscript', 'profiles', 'release', 'parts', 'scenes', 'beats', 'choices', 'audits'] as const) expect(after[key]).toEqual(before[key]);
          expect(after.job).toMatchObject({ status: 'processing', leaseToken }); expect(await archives(f)).toHaveLength(0);
          expect(callCounts(f)).toEqual(calls);
        } finally { unlock.release(); await Promise.allSettled([mutation, ...(reset ? [reset] : [])]); }
      }, 60_000);

      function consentInput(f: Fixture, expectedRevision?: number) {
        return { manuscriptVersionId: f.manuscript.id, expectedRevision, rightsConfirmed: true,
          aiBranchAllowed: true, translationAllowed: false, imageTransformationAllowed: false,
          allowedLocales: ['ko'], allowedRegions: ['KR'], startsAt: new Date(0).toISOString() };
      }

      it('rejects an active save whose read predates a real withdrawal instead of resurrecting consent', async () => {
        const { f } = await mixed(), held = latch(), unlock = latch(), calls = callCounts(f);
        let first = true;
        const wrapped = new Proxy(db, { get(target, key) {
          if (key === 'storyStyleProfileConsent') return { ...target.storyStyleProfileConsent,
            findUnique: async (args: Prisma.StoryStyleProfileConsentFindUniqueArgs) => {
              const value = await target.storyStyleProfileConsent.findUnique(args);
              if (first) { first = false; held.release(); await unlock.promise; }
              return value;
            } };
          return Reflect.get(target, key);
        } });
        const stale = new StoryEconomicsService(wrapped as never).upsertStyleConsent(f.owner.id, f.work.id, consentInput(f, 2));
        const outcome = stale.then(value => ({ value, error: null }), error => ({ value: null, error }));
        try {
          await held.promise;
          await new StoryEconomicsService(db as never).transitionStyleConsent(f.owner.id, f.work.id, { expectedRevision: 2, toStatus: 'withdrawn' });
          const before = await state(f), withdrawn = await db.storyStyleProfileConsent.findUniqueOrThrow({ where: { workId: f.work.id } });
          expect(withdrawn).toMatchObject({ status: 'withdrawn', revision: 3 }); expect(withdrawn.withdrawnAt).toBeInstanceOf(Date);
          unlock.release();
          const result = await outcome;
          expect(result.value).toBeNull(); expect((result.error as HttpException).getStatus()).toBe(409);
          expect(await db.storyStyleProfileConsent.findUniqueOrThrow({ where: { workId: f.work.id } })).toEqual(withdrawn);
          expect(await state(f)).toEqual(before); expect(callCounts(f)).toEqual(calls);
        } finally { unlock.release(); await Promise.allSettled([stale]); }
      }, 60_000);

      it('does not overwrite the winner when two first consent saves both observed an absent row', async () => {
        const { f } = await mixed(), calls = callCounts(f);
        await db.storyStyleProfileConsent.delete({ where: { workId: f.work.id } });
        const held = latch(), unlock = latch(); let first = true;
        const wrapped = new Proxy(db, { get(target, key) {
          if (key === 'storyStyleProfileConsent') return { ...target.storyStyleProfileConsent,
            findUnique: async (args: Prisma.StoryStyleProfileConsentFindUniqueArgs) => {
              const value = await target.storyStyleProfileConsent.findUnique(args);
              if (first) { first = false; expect(value).toBeNull(); held.release(); await unlock.promise; }
              return value;
            } };
          return Reflect.get(target, key);
        } });
        const stale = new StoryEconomicsService(wrapped as never).upsertStyleConsent(f.owner.id, f.work.id, consentInput(f));
        const outcome = stale.then(value => ({ value, error: null }), error => ({ value: null, error }));
        try {
          await held.promise;
          await new StoryEconomicsService(db as never).upsertStyleConsent(f.owner.id, f.work.id, { ...consentInput(f), aiBranchAllowed: false });
          const winner = await db.storyStyleProfileConsent.findUniqueOrThrow({ where: { workId: f.work.id } });
          unlock.release();
          const result = await outcome;
          expect(result.value).toBeNull(); expect((result.error as HttpException).getStatus()).toBe(409);
          expect(await db.storyStyleProfileConsent.findUniqueOrThrow({ where: { workId: f.work.id } })).toEqual(winner);
          expect(winner).toMatchObject({ revision: 1, aiBranchAllowed: false }); expect(callCounts(f)).toEqual(calls);
        } finally { unlock.release(); await Promise.allSettled([stale]); }
      }, 60_000);

      it('rolls consent deletion and style-memory cleanup back if its audit cannot persist', async () => {
        const { f } = await mixed(), calls = callCounts(f), service = new StoryEconomicsService(db as never);
        await service.transitionStyleConsent(f.owner.id, f.work.id, { expectedRevision: 2, toStatus: 'withdrawn' });
        await service.transitionStyleConsent(f.owner.id, f.work.id, { expectedRevision: 3, toStatus: 'deletion_pending' });
        const before = await state(f), consent = await db.storyStyleProfileConsent.findUniqueOrThrow({ where: { workId: f.work.id } });
        const memories = await db.storyMemoryRecord.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } });
        expect(memories.some(row => row.memoryType === 'style' && row.status !== 'deleted')).toBe(true);
        const wrapped = { $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(tx => callback(new Proxy(tx, {
          get(target, key) {
            if (key === 'auditEvent') return { ...target.auditEvent, create: async () => { throw new Error('Offline consent audit failure'); } };
            return Reflect.get(target, key);
          },
        }))), storyWork: db.storyWork, storyStyleProfileConsent: db.storyStyleProfileConsent };
        await expect(new StoryEconomicsService(wrapped as never).transitionStyleConsent(f.owner.id, f.work.id,
          { expectedRevision: 4, toStatus: 'deleted' })).rejects.toThrow('Offline consent audit failure');
        expect(await state(f)).toEqual(before);
        expect(await db.storyStyleProfileConsent.findUniqueOrThrow({ where: { workId: f.work.id } })).toEqual(consent);
        expect(await db.storyMemoryRecord.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } })).toEqual(memories);
        await service.transitionStyleConsent(f.owner.id, f.work.id, { expectedRevision: 4, toStatus: 'deleted' });
        expect(await db.storyStyleProfileConsent.findUniqueOrThrow({ where: { workId: f.work.id } })).toMatchObject({ revision: 5, status: 'deleted' });
        expect((await db.storyMemoryRecord.findMany({ where: { workId: f.work.id, memoryType: 'style' } })).every(row => row.status === 'deleted')).toBe(true);
        expect(callCounts(f)).toEqual(calls);
      }, 60_000);
    });
  });

  async function expectArchive(f: Fixture, prior: StoryChoice[], sceneIds: string[]) {
    const events = await archives(f);
    expect(events.map(event => event.targetId).sort()).toEqual([...sceneIds].sort());
    for (const event of events) {
      expect(event).toMatchObject({ actorUserId: f.owner.id, targetType: 'story_scene', action: ARCHIVE_ACTION });
      const stored = jsonObjects([event.beforeData, event.afterData, event.metadata]);
      for (const choice of prior.filter(row => row.sceneId === event.targetId)) {
        expect(stored.find(row => row.id === choice.id)).toMatchObject({ ...choiceSnapshot(choice),
          createdAt: choice.createdAt.toISOString() });
      }
    }
  }

  it('archives old-profile choices 2/3 once, preserves originals and prose, and waits for explicit retry', async () => {
    const f = await fixture(true);
    await complete(f);
    const currentState = await state(f);
    const current = await f.recovery.review(f.owner.id, f.work.id, f.materialized.releaseId);
    expect(current).toMatchObject({ status: 'current', canReset: false, generationStarted: false });
    expect(current.resetRequiredScenes).toBe(0);
    expect(current.preparedScenes).toBe(2);
    expect(await state(f)).toEqual(currentState);
    const approved = await approveChangedProfile(f);
    const before = await state(f);
    const beforeCalls = callCounts(f);
    const input = await resetInput(f);
    const stale = await f.recovery.review(f.owner.id, f.work.id, f.materialized.releaseId);
    expect(stale).toMatchObject({ status: 'settings_changed', canReset: true, generationStarted: false,
      expectedManuscriptHash: input.expectedManuscriptHash,
      expectedApprovedFingerprint: approved.profile.approvedFingerprint,
      expectedProfilePinHash: input.expectedProfilePinHash,
      expectedReleaseChecksum: input.expectedReleaseChecksum });
    expect(stale.resetRequiredScenes).toBe(2);
    expect(stale.preparedScenes).toBe(2);
    expect(await state(f)).toEqual(before);
    const reset = await f.recovery.reset(f.owner.id, f.work.id, f.materialized.releaseId, input);
    expect(reset).toMatchObject({ status: 'reset_ready', generationStarted: false,
      nextAction: 'explicit_retry_required', idempotentReplay: false });
    expect(reset.resetScenes).toBe(2);
    const after = await state(f);
    expect(after.choices).toEqual(before.choices.filter(choice => choice.position === 1));
    for (const key of ['work', 'manuscript', 'profiles', 'parts', 'scenes', 'beats'] as const) {
      expect(after[key]).toEqual(before[key]);
    }
    const { validationSummary: _oldSummary, ...oldRelease } = before.release;
    const { validationSummary: _newSummary, ...newRelease } = after.release;
    expect(newRelease).toEqual(oldRelease);
    expect(after.release.validationSummary).toMatchObject({ ready: false });
    expect(after.job).toMatchObject({ status: 'failed', errorCode: RESET_MARKER,
      leaseToken: null, leaseExpiresAt: null });
    for (const proof of before.audits.filter(event => event.action === 'story_studio_choices.prepared')) {
      expect(after.audits).toContainEqual(proof);
    }
    await expectArchive(f, before.choices, f.materialized.scenes.map(scene => scene.sceneId));
    expect(callCounts(f)).toEqual(beforeCalls);
    const ready = await f.recovery.review(f.owner.id, f.work.id, f.materialized.releaseId);
    expect(ready).toMatchObject({ status: 'reset_ready', canReset: false, generationStarted: false });
    expect(ready.resetRequiredScenes).toBe(0);
    expect(ready.preparedScenes).toBe(0);
    const archived = await archives(f);
    const replay = await f.recovery.reset(f.owner.id, f.work.id, f.materialized.releaseId, input);
    expect(replay).toMatchObject({ status: 'reset_ready', idempotentReplay: true,
      resetScenes: 0, generationStarted: false, nextAction: 'explicit_retry_required' });
    expect(await archives(f)).toEqual(archived);
    expect(await state(f)).toEqual(after);
    expect(callCounts(f)).toEqual(beforeCalls);
    await expect(f.job.retry(f.owner.id, f.work.id, f.materialized.releaseId)).resolves.toMatchObject({ status: 'queued' });
    expect(f.provider.generate).toHaveBeenCalledTimes(beforeCalls.generate);
    await complete(f);
    const regenerated = await rows(f);
    for (const [index, scene] of f.materialized.scenes.entries()) {
      const set = regenerated.filter(choice => choice.sceneId === scene.sceneId);
      expect(set.map(choice => choice.position)).toEqual([1, 2, 3]);
      expect(set[0]).toEqual(before.choices.find(choice => choice.sceneId === scene.sceneId && choice.position === 1));
      expect(set[0]).toMatchObject({ routeKind: 'writer_original',
        targetSceneId: f.materialized.scenes[index + 1]?.sceneId ?? null,
        targetEndingKey: index === 1 ? 'author_main' : null });
      for (const choice of set.slice(1)) {
        expect(choice).toMatchObject({ routeKind: 'generation_required',
          targetSceneId: null, targetEndingKey: null, declaredRejoinSceneId: null });
        expect((choice.label as { ko: string }).ko).toContain('new ledger');
        expect(before.choices.map(row => row.id)).not.toContain(choice.id);
      }
      const proof = await db.auditEvent.findFirstOrThrow({ where: { action: 'story_studio_choices.prepared',
        targetId: scene.sceneId, metadata: { path: ['generationProfilePin', 'approvedFingerprint'],
          equals: approved.profile.approvedFingerprint! } } });
      expect(proof.metadata).toMatchObject({ workId: f.work.id, releaseId: f.materialized.releaseId,
        manuscriptHash: f.prepared.contentHash, generationProfilePin: { approvedFingerprint: input.expectedApprovedFingerprint } });
    }
    expect(f.provider.generate).toHaveBeenCalledTimes(beforeCalls.generate + 2);
    expect((await state(f)).release.validationSummary).toMatchObject({ ready: true });
    expect((await state(f)).job).toMatchObject({ status: 'completed', completedParts: 2, errorCode: null });
    await expect(f.recovery.review(f.owner.id, f.work.id, f.materialized.releaseId))
      .resolves.toMatchObject({ status: 'current', canReset: false, generationStarted: false });
    expect(await archives(f)).toEqual(archived);
  }, 60_000);

  it('archives generated original labels before restoring pending labels without changing identity, targets or prose', async () => {
    const f = await fixture();
    await complete(f);
    await approveChangedProfile(f);
    const before = await state(f);
    const calls = callCounts(f);
    const input = await resetInput(f);
    const reset = await f.recovery.reset(f.owner.id, f.work.id, f.materialized.releaseId, input);
    expect(reset).toMatchObject({ status: 'reset_ready', resetScenes: 2,
      generationStarted: false, nextAction: 'explicit_retry_required', idempotentReplay: false });
    const after = await state(f);
    expect(after.choices).toEqual(before.choices.filter(choice => choice.position === 1)
      .map(choice => ({ ...choice, label: { ko: null } })));
    for (const key of ['work', 'manuscript', 'profiles', 'parts', 'scenes', 'beats'] as const) {
      expect(after[key]).toEqual(before[key]);
    }
    await expectArchive(f, before.choices, f.materialized.scenes.map(scene => scene.sceneId));
    expect(after.job).toMatchObject({ status: 'failed', errorCode: RESET_MARKER, completedParts: 0 });
    expect(after.release.validationSummary).toMatchObject({ ready: false });
    expect(callCounts(f)).toEqual(calls);
    const archived = await archives(f);
    await expect(f.recovery.reset(f.owner.id, f.work.id, f.materialized.releaseId, input))
      .resolves.toMatchObject({ idempotentReplay: true, resetScenes: 0, generationStarted: false });
    expect(await state(f)).toEqual(after);
    expect(await archives(f)).toEqual(archived);
    await f.job.retry(f.owner.id, f.work.id, f.materialized.releaseId);
    await complete(f);
    const regenerated = await rows(f);
    for (const original of before.choices.filter(choice => choice.position === 1)) {
      expect(regenerated.find(choice => choice.id === original.id)).toEqual(original);
    }
    expect(f.provider.generate).toHaveBeenCalledTimes(calls.generate + 2);
    expect((await state(f)).release.validationSummary).toMatchObject({ ready: true });
    expect(await archives(f)).toEqual(archived);
  }, 60_000);

  it('removes only stale generated rows and keeps a scene already prepared under the new approval', async () => {
    const f = await fixture(true);
    expect(await f.job.executeOne()).toBe('progress');
    await approveChangedProfile(f);
    expect(await f.job.executeOne()).toBe('progress');
    expect(await f.job.executeOne()).toBe('failed');
    const before = await state(f);
    const calls = callCounts(f);
    const [stale, alreadyCurrent] = f.materialized.scenes;
    const review = await f.recovery.review(f.owner.id, f.work.id, f.materialized.releaseId);
    expect(review).toMatchObject({ status: 'settings_changed', canReset: true, generationStarted: false });
    expect(review.resetRequiredScenes).toBe(1);
    expect(review.preparedScenes).toBe(2);
    const reset = await f.recovery.reset(f.owner.id, f.work.id, f.materialized.releaseId, await resetInput(f));
    expect(reset.resetScenes).toBe(1);
    expect(await rows(f)).toEqual(before.choices.filter(choice => choice.sceneId !== stale.sceneId || choice.position === 1));
    await expectArchive(f, before.choices, [stale.sceneId]);
    expect((await state(f)).job).toMatchObject({ status: 'failed', errorCode: RESET_MARKER });
    expect((await state(f)).release.validationSummary).toMatchObject({ ready: false });
    expect(callCounts(f)).toEqual(calls);
    await expect(f.recovery.review(f.owner.id, f.work.id, f.materialized.releaseId))
      .resolves.toMatchObject({ status: 'reset_ready', preparedScenes: 1, resetRequiredScenes: 0,
        canReset: false, generationStarted: false });
    await f.job.retry(f.owner.id, f.work.id, f.materialized.releaseId);
    expect(await f.job.executeOne()).toBe('progress');
    expect(await f.job.executeOne()).toBe('completed');
    expect(f.provider.generate).toHaveBeenCalledTimes(calls.generate + 1);
    expect((await rows(f)).filter(choice => choice.sceneId === alreadyCurrent.sceneId))
      .toEqual(before.choices.filter(choice => choice.sceneId === alreadyCurrent.sceneId));
    await expect(f.studio.finish(f.owner.id, f.work.id, f.materialized.releaseId)).resolves.toMatchObject({ ready: true });
  }, 60_000);

  it('rejects changed confirmation pins or missing confirmation without mutation or generation', async () => {
    const f = await fixture();
    await complete(f);
    await approveChangedProfile(f);
    const input = await resetInput(f);
    const before = await state(f);
    const calls = callCounts(f);
    const invalidInputs = [
      { ...input, expectedManuscriptHash: '0'.repeat(64) },
      { ...input, expectedApprovedFingerprint: f.approved.profile.approvedFingerprint! },
      { ...input, expectedProfilePinHash: '0'.repeat(64) },
      { ...input, expectedReleaseChecksum: '0'.repeat(64) },
      { ...input, resetConfirmed: false },
    ];
    for (const invalid of invalidInputs) {
      await expect(f.recovery.reset(f.owner.id, f.work.id, f.materialized.releaseId, invalid))
        .rejects.toBeInstanceOf(HttpException);
      expect(await state(f)).toEqual(before);
      expect(await archives(f)).toEqual([]);
      expect(callCounts(f)).toEqual(calls);
    }
  }, 60_000);

  it('rejects a review pin after real unchanged-settings re-approval even when the approved fingerprint is unchanged', async () => {
    const f = await fixture(true);
    await complete(f);
    await approveChangedProfile(f);
    const input = await resetInput(f);
    const current = await f.profiles.getOrCreate(f.owner.id, f.work.id);
    const unchanged = await f.profiles.update(f.owner.id, f.work.id, {
      settings: normalizeCreatorGenerationProfile('story', current.profile.draftSettings),
    });
    const approved = await f.profiles.approve(f.owner.id, f.work.id, {
      expectedDraftFingerprint: unchanged.profile.draftFingerprint!,
    });
    expect(approved.profile.approvedFingerprint).toBe(input.expectedApprovedFingerprint);
    const review = await f.recovery.review(f.owner.id, f.work.id, f.materialized.releaseId);
    expect(review).toMatchObject({ status: 'settings_changed', canReset: true, generationStarted: false,
      expectedApprovedFingerprint: input.expectedApprovedFingerprint });
    expect(review.expectedProfilePinHash).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(review.expectedProfilePinHash).not.toBe(input.expectedProfilePinHash);
    const before = await state(f);
    const calls = callCounts(f);
    await expect(f.recovery.reset(f.owner.id, f.work.id, f.materialized.releaseId, input))
      .rejects.toBeInstanceOf(HttpException);
    expect(await state(f)).toEqual(before);
    expect(await archives(f)).toEqual([]);
    expect(callCounts(f)).toEqual(calls);
  }, 60_000);

  it('rolls back the first archive and deletion when original-route validation fails inside the real transaction', async () => {
    const f = await fixture(true);
    await complete(f);
    await approveChangedProfile(f);
    const input = await resetInput(f);
    const before = await state(f);
    const calls = callCounts(f);
    let observed: { sceneId: string; choices: StoryChoice[]; archives: number } | undefined;
    const failure = jest.spyOn(f.choices, 'assertOriginalSceneReadyTx')
      .mockImplementationOnce(async (tx, _ownerId, _workId, _releaseId, sceneId) => {
        observed = { sceneId,
          choices: await tx.storyChoice.findMany({ where: { sceneId }, orderBy: { position: 'asc' } }),
          archives: await tx.auditEvent.count({ where: { action: ARCHIVE_ACTION, targetId: sceneId } }) };
        throw new Error('Injected failure after the first stale-choice deletion');
      });
    await expect(f.recovery.reset(f.owner.id, f.work.id, f.materialized.releaseId, input))
      .rejects.toBeInstanceOf(HttpException);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(observed?.sceneId).toBe(f.materialized.scenes[0].sceneId);
    expect(observed?.choices).toEqual(before.choices.filter(choice =>
      choice.sceneId === f.materialized.scenes[0].sceneId && choice.position === 1));
    expect(observed?.archives).toBe(1);
    expect(await state(f)).toEqual(before);
    expect(await archives(f)).toEqual([]);
    expect(callCounts(f)).toEqual(calls);
  }, 60_000);

  it.each(['published work', 'active release', 'published release', 'prior publication timestamp',
    'publication history', 'retired release history', 'reader usage', 'queued job', 'processing job',
    'foreign owner'] as const)(
    'blocks %s before changing choices, audits, release or job', async blocker => {
      const f = await fixture();
      await complete(f);
      await approveChangedProfile(f);
      const input = await resetInput(f);
      let actorId = f.owner.id;
      switch (blocker) {
        case 'published work':
          await db.storyWork.update({ where: { id: f.work.id }, data: { status: 'published' } });
          break;
        case 'active release':
          await db.storyWork.update({ where: { id: f.work.id }, data: { activeReleaseId: f.materialized.releaseId } });
          break;
        case 'published release':
          await db.storyRelease.update({ where: { id: f.materialized.releaseId },
            data: { status: 'active', activatedAt: new Date() } });
          break;
        case 'prior publication timestamp':
          await db.storyWork.update({ where: { id: f.work.id }, data: { publishedAt: new Date(0) } });
          break;
        case 'publication history':
          await db.storyPublicationTransition.create({ data: {
            workId: f.work.id, releaseId: f.materialized.releaseId, actorUserId: f.owner.id,
            idempotencyKey: randomUUID(), fromStatus: 'release_ready', toStatus: 'published',
            beforeRevision: 1, afterRevision: 2,
          } });
          break;
        case 'retired release history': {
          const release = await db.storyRelease.findUniqueOrThrow({ where: { id: f.materialized.releaseId } });
          await db.storyRelease.create({ data: { workId: release.workId,
            manuscriptVersionId: release.manuscriptVersionId, createdByUserId: release.createdByUserId,
            branchGraphSnapshot: nonNullSnapshot(release.branchGraphSnapshot),
            endingSetSnapshot: nonNullSnapshot(release.endingSetSnapshot),
            sceneAssetManifest: nonNullSnapshot(release.sceneAssetManifest),
            localizedDisplaySnapshot: nonNullSnapshot(release.localizedDisplaySnapshot),
            version: 2,
            checksum: randomUUID().replace(/-/g, '').repeat(2), status: 'retired',
            activatedAt: new Date(0), retiredAt: new Date(1000) } });
          break;
        }
        case 'reader usage': {
          const reader = await db.user.create({ data: {} });
          await db.storyReaderProgress.create({ data: {
            userId: reader.id, workId: f.work.id, activeReleaseId: f.materialized.releaseId,
            currentSceneId: f.materialized.scenes[0].sceneId,
          } });
          break;
        }
        case 'queued job':
          await db.storyStudioChoiceJob.update({ where: { releaseId: f.materialized.releaseId },
            data: { status: 'queued' } });
          break;
        case 'processing job':
          await db.storyStudioChoiceJob.update({ where: { releaseId: f.materialized.releaseId },
            data: { status: 'processing', leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 300_000) } });
          break;
        case 'foreign owner':
          actorId = (await db.user.create({ data: {} })).id;
          break;
      }
      const before = await state(f);
      const calls = callCounts(f);
      const outcome = await f.recovery.review(actorId, f.work.id, f.materialized.releaseId)
        .then(review => ({ review, error: null }), error => ({ review: null, error: error as unknown }));
      if (outcome.review) {
        expect(outcome.review).toMatchObject({ canReset: false, generationStarted: false });
        if (!['queued job', 'processing job'].includes(blocker)) expect(outcome.review.status).toBe('blocked');
      } else {
        expect(outcome.error).toBeInstanceOf(HttpException);
      }
      expect(await state(f)).toEqual(before);
      await expect(f.recovery.reset(actorId, f.work.id, f.materialized.releaseId, input)).rejects.toBeInstanceOf(HttpException);
      expect(await state(f)).toEqual(before);
      expect(await archives(f)).toEqual([]);
      expect(callCounts(f)).toEqual(calls);
    }, 60_000,
  );
});
