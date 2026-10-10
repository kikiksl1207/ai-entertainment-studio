import { NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA, STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile, stableJson,
} from '../generation-profile/creator-generation-profile.policy';
import { StoryAuthorBodyPreviewService } from './story-author-body-preview.service';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
const hash = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex');
const PRIVATE = 'SYNTHETIC_BODY_STYLE_REFERENCE_PRIVATE_SENTINEL';
jest.setTimeout(30000);

// Historical body/pin metadata is directly seeded, not generated or settled.
// The draft rate/denied consent are required FKs, not dispatch rights or grants.
// Approval rows are explicit synthetic metadata, not evidence of human approval.
postgres('author body style reference on owned PostgreSQL (synthetic only)', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432'
      || parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash
      || !/^\/lumina_body_length_qa_[a-f0-9]{12}$/.test(parsed.pathname)) {
      throw new Error('Owned loopback body-style reference QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
  });
  afterAll(async () => { await db?.$disconnect(); jest.restoreAllMocks(); });

  async function fixture() {
    const owner = await db.user.create({ data: {} });
    const other = await db.user.create({ data: {} });
    const work = await db.storyWork.create({ data: {
      id: 'a' + randomUUID().slice(1), ownerUserId: owner.id,
      slug: 'body-style-reference-' + randomUUID(), title: { ko: PRIVATE }, summary: {},
      defaultLocale: 'ko', supportedLocales: ['ko'], status: 'draft',
    } });
    const rate = await db.storyAiRateCard.create({ data: {
      version: 'body-style-read-fk-' + randomUUID(), status: 'draft', provider: 'offline-test',
      model: 'not-dispatchable-fixture', inputCostPerMillion: 0, outputCostPerMillion: 0,
      createdByUserId: owner.id,
    } });
    async function source(version: number) {
      const structuredBody = { parts: [{ paragraphs: [PRIVATE + version] }] };
      const manuscript = await db.storyManuscriptVersion.create({ data: {
        workId: work.id, ownerUserId: owner.id, version, locale: 'ko',
        contentHash: hash(structuredBody), structuredBody,
      } });
      const configHash = hash({ syntheticCompletedAnalysis: true });
      const analysis = await db.storyAnalysisJob.create({ data: {
        workId: work.id, manuscriptVersionId: manuscript.id, analysisVersion: 1, idempotencyKey: randomUUID(),
        pipeline: SEMANTIC_PIPELINE, status: 'completed', actorUserId: owner.id,
        sourceContentHash: manuscript.contentHash, sourceLocale: 'ko', sourceDigest: manuscript.contentHash,
        configHash, configPins: { synthetic: true }, rateCardId: rate.id, phase: 'completed',
        totalParts: 1, totalParagraphs: 1, plannedParagraphs: 1, completedParagraphs: 1,
        plannedChunks: 1, completedChunks: 1, completedAt: new Date(),
      } });
      return { manuscript, analysis, fingerprint: hash({
        workId: work.id, manuscriptVersionId: manuscript.id, contentHash: manuscript.contentHash,
        analysisJobId: analysis.id, analysisVersion: analysis.analysisVersion, analysisConfigHash: analysis.configHash,
      }) };
    }
    const current = await source(1);
    const settings = normalizeCreatorGenerationProfile('story', {
      schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
      sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
        key, decision: 'accepted', evidence: [],
        value: key === 'writing_style' ? {
          summary: PRIVATE, customTail: { complete: PRIVATE },
          observations: Array.from({ length: 5 }, (_, i) => ({
            title: 'Whole approved title ' + i, detail: PRIVATE.repeat(10) + 'MIDDLE_TAIL_' + i,
          })),
          categories: Array.from({ length: 7 }, (_, i) => ({
            category: 'Whole category ' + i,
            observations: [PRIVATE, 'Complete middle exception ' + i, 'CATEGORY_TAIL_' + i],
          })),
        } : { summary: PRIVATE },
      })),
    });
    const profile = await db.storyWorkGenerationProfile.create({ data: {
      workId: work.id, ownerUserId: owner.id, manuscriptVersionId: current.manuscript.id,
      analysisJobId: current.analysis.id, sourceFingerprint: current.fingerprint,
      profileVersion: 1, reviewRevision: 1, status: 'approved',
      draftSettings: settings as unknown as Prisma.InputJsonValue,
      approvedSettings: settings as unknown as Prisma.InputJsonValue,
      approvedFingerprint: creatorGenerationProfileFingerprint(current.fingerprint, settings),
      approvedByUserId: owner.id, approvedAt: new Date(),
    } });
    const pin = { id: profile.id, profileVersion: profile.profileVersion, reviewRevision: profile.reviewRevision,
      sourceFingerprint: profile.sourceFingerprint, approvedFingerprint: profile.approvedFingerprint! };
    const part = await db.storyPart.create({ data: {
      workId: work.id, position: 1, title: {}, status: 'published',
    } });
    const canonical = await db.storyScene.create({ data: {
      partId: part.id, sceneKey: 'synthetic-source', position: 1, status: 'published', title: { ko: PRIVATE },
    } });
    await db.storyBeat.create({ data: {
      sceneId: canonical.id, position: 1, beatType: 'paragraph', content: { ko: 'a'.repeat(100) },
    } });
    const release = await db.storyRelease.create({ data: {
      workId: work.id, version: 1, status: 'active', manuscriptVersionId: current.manuscript.id,
      checksum: hash({ syntheticRelease: work.id }), branchGraphSnapshot: {}, endingSetSnapshot: {},
      sceneAssetManifest: {}, localizedDisplaySnapshot: {}, createdByUserId: owner.id,
    } });
    await db.storyWork.update({ where: { id: work.id }, data: {
      status: 'published', activeReleaseId: release.id, publishedVersion: release.version,
    } });
    const progress = await db.storyReaderProgress.create({ data: {
      userId: owner.id, workId: work.id, currentSceneId: canonical.id, activeReleaseId: release.id,
      storyVersion: release.version, progressRevision: 7,
    } });
    const consent = await db.storyStyleProfileConsent.create({ data: {
      workId: work.id, ownerUserId: owner.id, manuscriptVersionId: current.manuscript.id,
      rightsConfirmed: false, aiBranchAllowed: false, startsAt: new Date(0),
    } });
    const choice = await db.storyCustomChoice.create({ data: {
      userId: owner.id, workId: work.id, progressId: progress.id, sceneId: canonical.id,
      idempotencyKey: randomUUID(), privateInput: PRIVATE, contentHash: hash(PRIVATE),
      moderationDecision: 'allow',
    } });
    const origin = await db.storyAiContinuation.create({ data: {
      userId: owner.id, workId: work.id, releaseId: release.id, progressId: progress.id,
      requestKind: 'custom_choice', customChoiceId: choice.id, rateCardId: rate.id,
      styleConsentId: consent.id, capabilityRevision: 1, idempotencyKey: randomUUID(),
      sourcePartId: part.id, sourceSceneId: canonical.id, sourceProgressRevision: progress.progressRevision,
      manuscriptVersionId: current.manuscript.id, analysisJobId: current.analysis.id, analysisVersion: current.analysis.analysisVersion,
      status: 'completed', completedAt: new Date(), contextReferences: { generationProfilePin: pin, privateContext: PRIVATE },
      estimatedCostKrw: 0, hardBudgetKrw: 0, inputTokenLimit: 32768, outputTokenLimit: 8192,
    } });
    const generated = await db.storyAiGeneratedScene.create({ data: {
      continuationId: origin.id, userId: owner.id, workId: work.id, releaseId: release.id,
      progressId: progress.id, sourcePartId: part.id, sceneKey: 'synthetic-stored-body',
      resultChecksum: hash({ syntheticBody: origin.id }), title: { ko: PRIVATE }, visualManifest: {},
    } });
    await db.storyAiGeneratedBeat.create({ data: {
      sceneId: generated.id, position: 1, beatType: 'paragraph', content: { ko: 'a'.repeat(100) },
    } });
    await db.storyAiGeneratedChoice.create({ data: {
      sceneId: generated.id, choiceKey: 'synthetic-next', position: 1,
      label: { ko: PRIVATE }, routeKind: 'generation_required',
    } });
    await db.storyAiContinuation.update({ where: { id: origin.id }, data: { resultGeneratedSceneId: generated.id } });
    await db.storyReaderProgress.update({ where: { id: progress.id }, data: {
      currentSceneId: null, currentGeneratedSceneId: generated.id,
    } });
    await db.storyMemoryRecord.create({ data: {
      workId: work.id, manuscriptVersionId: current.manuscript.id, analysisJobId: current.analysis.id,
      memoryType: 'style', memoryKey: 'synthetic-memory-' + randomUUID(), content: { ko: PRIVATE },
      provenance: 'writer_original', status: 'approved',
    } });
    await db.auditEvent.create({ data: {
      actorUserId: owner.id, actorType: 'system', action: 'qa_fixture_seed',
      targetType: 'story_work', targetId: work.id, metadata: { synthetic: true },
    } });

    const modes: Array<{ readOnly: string; isolation: string }> = [];
    const reads: Array<{ model: string; method: string; query: unknown }> = [];
    const forbidden = jest.fn(() => { throw new Error('Outer read, write or bootstrap prohibited'); });
    const mutations = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
    const transaction = jest.fn(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: { isolationLevel: Prisma.TransactionIsolationLevel }) => {
      expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      return db.$transaction(async tx => {
        let readOnly = false;
        const observed = new Proxy(tx, {
          get(target, key) {
            if (key === '$executeRaw') return async (sql: Prisma.Sql) => {
              expect(readOnly).toBe(false);
              expect(sql.strings.join('')).toBe('SET TRANSACTION READ ONLY'); expect(sql.values).toEqual([]);
              const result = await target.$executeRaw(sql);
              readOnly = true;
              const mode = await target.$queryRaw<Array<{ transaction_read_only: string }>>(Prisma.raw('SHOW transaction_read_only'));
              const isolation = await target.$queryRaw<Array<{ transaction_isolation: string }>>(Prisma.raw('SHOW transaction_isolation'));
              modes.push({ readOnly: mode[0].transaction_read_only, isolation: isolation[0].transaction_isolation });
              return result;
            };
            if (typeof key === 'string' && key.startsWith('$')) return forbidden;
            const delegate = Reflect.get(target, key);
            if (typeof key !== 'string' || !delegate || typeof delegate !== 'object') return delegate;
            return new Proxy(delegate, {
              get(model, method) {
                if (typeof method === 'string' && mutations.has(method)) return forbidden;
                const actual = Reflect.get(model, method);
                if (typeof actual !== 'function') return actual;
                return (...args: unknown[]) => {
                  expect(readOnly).toBe(true);
                  reads.push({ model: key, method: String(method), query: args[0] });
                  return actual.apply(model, args);
                };
              },
            });
          },
        });
        return callback(observed);
      }, options);
    });
    const service = new StoryAuthorBodyPreviewService(new Proxy({ $transaction: transaction }, {
      get(target, key) { return key === '$transaction' ? target.$transaction : new Proxy({}, { get: () => forbidden }); },
    }) as never);
    const spies = (['getOrCreate', 'autoApproveCompany', 'approve', 'update',
      'createDraftAtCompletion', 'onApplicationBootstrap'] as const)
      .map(name => jest.spyOn(StoryGenerationProfileService.prototype, name));
    return { owner, other, work, current, source, profile, settings, pin, progress, origin, generated,
      service, modes, reads, transaction, forbidden, spies };
  }

  // Whole affected rows, including source/approval/memory/audit and empty finance/grant tables.
  // No deletes, trigger toggles, activation, economics or provider calls are used.
  async function snapshot() {
    const names = ['user', 'storyWork', 'storyManuscriptVersion', 'storyAnalysisJob', 'storyAiRateCard',
      'storyWorkGenerationProfile', 'storyMemoryRecord', 'auditEvent', 'storyPart', 'storyScene', 'storyBeat',
      'storyRelease', 'storyReaderProgress', 'storyStyleProfileConsent', 'storyCustomChoice',
      'storyAiContinuation', 'storyAiGeneratedScene', 'storyAiGeneratedBeat', 'storyAiGeneratedChoice',
      'storyAiUsageLedger', 'storyAiAllowanceBucket', 'storyAuthorBodyTrialApproval', 'walletLedger', 'userEntitlement'] as const;
    const rows: Record<string, unknown> = {};
    for (const name of names) rows[name] = await (db[name] as any).findMany({ orderBy: { id: 'asc' } });
    return rows;
  }
  function assertReadOnly(f: Awaited<ReturnType<typeof fixture>>) {
    expect(f.forbidden).not.toHaveBeenCalled();
    for (const spy of f.spies) expect(spy).not.toHaveBeenCalled();
    expect(f.modes).toHaveLength(f.transaction.mock.calls.length);
    for (const mode of f.modes) expect(mode).toEqual({ readOnly: 'on', isolation: 'repeatable read' });
  }
  function safe(result: Awaited<ReturnType<StoryAuthorBodyPreviewService['styleReference']>>) {
    expect(result).toMatchObject({ contract: 'story-author-body-style-reference-read-v1', locale: 'ko',
      readOnly: true, providerCalls: 0, operatingWrites: 0, bodySourceAligned: false,
      semanticQualityVerified: false, dispatchAuthorized: false, diagnostic: {
        version: 'story-author-body-style-reference-v1', currentApprovalVerified: false,
        originalGenerationApprovalVerified: false, semanticQualityVerified: false,
        generatedBodyQualityVerified: false, bodySourceAligned: false,
        dispatchAuthorized: false, providerCalls: 0, operatingWrites: 0,
      } });
    const wire = JSON.stringify(result);
    expect(wire).not.toContain(PRIVATE);
    expect(wire).not.toMatch(/"(?:id|workId|userId|sceneId|releaseId|progressId|title|content|beats|choices|section|hash|fingerprint)"/);
    expect(wire).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|\b[a-f0-9]{64}\b/i);
  }

  it('AUTHOR-BODY-STYLE-READ-PG: real owner/source/body snapshot compares exact pins and preserves all affected rows', async () => {
    const f = await fixture();
    try {
      const before = await snapshot();
      const result = await f.service.styleReference(f.owner.id, f.work.id.toUpperCase(), { locale: 'ko' });
      safe(result);
      expect(result).toMatchObject({ progressRevision: 7, currentSourceState: 'validated',
        currentProfileVersion: 1, currentReviewRevision: 1,
        diagnostic: { comparison: 'same_approval_pin', reason: 'body_style_reference_same_approval_pin' } });
      expect(f.transaction).toHaveBeenCalledTimes(1);
      expect(f.reads.filter(row => row.model === 'storyWorkGenerationProfile')).toHaveLength(1);
      expect(await snapshot()).toEqual(before);
      await expect(f.service.styleReference(f.other.id, f.work.id, { locale: 'ko' })).rejects.toBeInstanceOf(NotFoundException);
      expect(await snapshot()).toEqual(before);
      assertReadOnly(f);

      // A later, still source-bound synthetic approval is a different pin, not a body-quality decision.
      await db.storyWorkGenerationProfile.create({ data: {
        workId: f.work.id, ownerUserId: f.owner.id, manuscriptVersionId: f.current.manuscript.id,
        analysisJobId: f.current.analysis.id, sourceFingerprint: f.current.fingerprint,
        profileVersion: 2, reviewRevision: 1, status: 'approved',
        draftSettings: f.settings as unknown as Prisma.InputJsonValue,
        approvedSettings: f.settings as unknown as Prisma.InputJsonValue,
        approvedFingerprint: f.profile.approvedFingerprint, approvedByUserId: f.owner.id, approvedAt: new Date(),
      } });
      const changedBefore = await snapshot();
      const changed = await f.service.styleReference(f.owner.id, f.work.id, { locale: 'ko' });
      safe(changed);
      expect(changed).toMatchObject({ currentSourceState: 'validated', currentProfileVersion: 2,
        diagnostic: { comparison: 'different_approval_pin', reason: 'body_style_reference_different_approval_pin' } });
      expect(await snapshot()).toEqual(changedBefore);
      assertReadOnly(f);
    } finally { jest.restoreAllMocks(); }
  });

  it('AUTHOR-BODY-STYLE-READ-PG: newer needs-review source cannot reuse older approval; reused marker never proves a match', async () => {
    const f = await fixture();
    try {
      const latest = await f.source(2);
      const needsReview = await db.storyWorkGenerationProfile.create({ data: {
        workId: f.work.id, ownerUserId: f.owner.id, manuscriptVersionId: latest.manuscript.id,
        analysisJobId: latest.analysis.id, sourceFingerprint: latest.fingerprint,
        profileVersion: 2, reviewRevision: 0, status: 'needs_review',
        draftSettings: f.settings as unknown as Prisma.InputJsonValue,
      } });
      const before = await snapshot();
      const unavailable = await f.service.styleReference(f.owner.id, f.work.id, { locale: 'ko' });
      safe(unavailable);
      expect(unavailable).toMatchObject({ currentSourceState: 'unavailable',
        currentProfileVersion: null, currentReviewRevision: null,
        diagnostic: { comparison: 'unavailable', reason: 'body_style_reference_pin_unavailable' } });
      const body = await f.service.preview(f.owner.id, f.work.id, { locale: 'ko' });
      expect(body.progress?.scene?.id).toBe(f.generated.id);
      expect(body.progress?.scene?.beats[0].content).toBe('a'.repeat(100));
      expect(await db.storyWorkGenerationProfile.findUniqueOrThrow({ where: { id: needsReview.id } }))
        .toMatchObject({ status: 'needs_review', approvedSettings: null, approvedFingerprint: null });
      expect(await snapshot()).toEqual(before); assertReadOnly(f);

      // Conservative marker handling only: this is not actual shared-result materialization/lineage proof.
      await db.storyAiContinuation.update({ where: { id: f.origin.id }, data: {
        contextReferences: { generationProfilePin: f.pin, sharedResultReused: true, privateContext: PRIVATE },
      } });
      const reusedBefore = await snapshot(), start = f.reads.length;
      const reused = await f.service.styleReference(f.owner.id, f.work.id, { locale: 'ko' });
      safe(reused);
      expect(reused).toMatchObject({ currentSourceState: 'not_checked',
        currentProfileVersion: null, currentReviewRevision: null,
        diagnostic: { comparison: 'unavailable', reason: 'body_style_reference_reused_origin_unavailable' } });
      expect(f.reads.slice(start).filter(row => ['storyManuscriptVersion', 'storyAnalysisJob',
        'storyWorkGenerationProfile'].includes(row.model))).toEqual([]);
      expect(await snapshot()).toEqual(reusedBefore); assertReadOnly(f);
    } finally { jest.restoreAllMocks(); }
  });
});
