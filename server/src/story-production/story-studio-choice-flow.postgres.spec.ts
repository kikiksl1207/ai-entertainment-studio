import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { preparePastedManuscript, storedManuscriptBody } from './story-manuscript-file.policy';
import { StoryManuscriptFileController } from './story-manuscript-file.controller';
import { StoryChoicePreparationProvider } from './story-choice-preparation.provider';
import { StoryLifecycleService } from './story-lifecycle.service';
import { StoryAiActivationService } from './story-ai-activation.service';
import { StoryEconomicsService } from './story-economics.service';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { PersistedStoryContinuationLegalActivationGate } from './story-continuation-legal-activation.gate';
import { PersistedStoryReusableResultApprovalGate } from './story-reusable-result-approval.gate';
import { STORY_AI_QUALITY_EVALUATOR, STORY_AI_QUALITY_RUBRIC } from './dto/story-ai-activation.dto';
import { INTERNAL_GENERATION_COST_TREATMENT } from '../story-settlement/content-rights-contract.contract';
import { normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { StoryProductionService } from './story-production.service';
import { UserAssetsService } from '../assets/user-assets.service';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';
import { StoryStudioChoiceJobService } from './story-studio-choice-job.service';
import { StoryStudioLinearService } from './story-studio-linear.service';
import { readerPartText } from './story-studio-reader-text.policy';
import { SemanticAnalysisRepository } from './story-semantic-analysis.repository';
import { SemanticAnalysisService } from './story-semantic-analysis.service';
import { SemanticAnalysisProvider } from './story-semantic-analysis.provider';
import { semanticTestConfig } from './story-semantic-analysis.test-fixture';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('Studio automatic original choices (isolated PostgreSQL, fake provider)', () => {
  let db: PrismaClient;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' ||
        parsed.port !== '55432' || parsed.username !== 'lumina_qa' ||
        parsed.pathname !== '/lumina_story_qa' || parsed.search || parsed.hash) {
      throw new Error('Dedicated story QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
  });

  afterAll(async () => { await db?.$disconnect(); });

  async function manuscriptFixture(partCount = 2, supplied?: ReturnType<typeof preparePastedManuscript>,
    viaUpload = false, newWriterDraft = false) {
    const owner = await db.user.create({ data: {} });
    const work = await db.storyWork.create({ data: {
      ownerUserId: owner.id, slug: `${newWriterDraft ? 'draft' : 'studio-auto'}-${randomUUID()}`,
      title: { ko: '합성 원고' }, summary: {},
    } });
    const prepared = supplied ?? (() => {
      const texts = Array.from({ length: partCount }, (_, index) => partCount === 2
        ? ['해원이 기록을 발견했다.', '해원은 다음 방으로 향했다.'][index]
        : `해원은 ${index + 1}번째 기록을 확인했다.`);
      const raw = texts.join('\n\n');
      let offset = 0;
      const parts = texts.map((text, index) => {
        const start = offset;
        offset += text.length + (index < texts.length - 1 ? 2 : 0);
        return { partKey: `part-${index + 1}`,
          title: partCount === 2 ? ['기록', '다음 방'][index] : `장면 ${index + 1}`,
          start, end: offset };
      });
      return preparePastedManuscript(Buffer.from(raw), JSON.stringify({ locale: 'ko',
        confirmed: true, parts,
      }));
    })();
    const uploadReceipt = viaUpload ? await new StoryManuscriptFileController(db as never).paste(
      { id: owner.id } as never, work.id,
      { fieldname: 'manuscript', mimetype: 'text/plain', buffer: Buffer.from(prepared.source.rawText, 'utf8'),
        size: prepared.source.byteLength } as never,
      { body: { manifest: JSON.stringify({ locale: 'ko', confirmed: true,
        ...(prepared.confirmedPreface ? { preface: prepared.confirmedPreface } : {}),
        parts: prepared.confirmedBoundaries }) } } as never,
    ) : null;
    const manuscript = uploadReceipt
      ? await db.storyManuscriptVersion.findUniqueOrThrow({ where: { id: uploadReceipt.manuscript.id } })
      : await db.storyManuscriptVersion.create({ data: {
        workId: work.id, ownerUserId: owner.id, version: 1, locale: 'ko',
        contentHash: prepared.contentHash, structuredBody: storedManuscriptBody(prepared),
      } });
    const rateCard = await db.storyAiRateCard.create({ data: {
      version: `offline-studio-${randomUUID()}`, provider: 'offline', model: 'fixture',
      status: 'active', inputCostPerMillion: 0, outputCostPerMillion: 0,
      createdByUserId: owner.id,
    } });
    const analysis = await db.storyAnalysisJob.create({ data: {
      workId: work.id, manuscriptVersionId: manuscript.id, analysisVersion: 1,
      idempotencyKey: randomUUID(), status: 'completed', pipeline: 'semantic_extraction_v1',
      sourceContentHash: prepared.contentHash, sourceLocale: 'ko',
      actorUserId: owner.id, rateCardId: rateCard.id, sourceDigest: prepared.contentHash,
      configHash: prepared.contentHash,
      totalParagraphs: prepared.paragraphCount, completedParagraphs: prepared.paragraphCount,
      plannedParagraphs: prepared.paragraphCount,
    } });
    await db.storyAnalysisEvidence.create({ data: {
      analysisJobId: analysis.id, provenance: 'semantic_candidate', sequence: 1,
      evidenceType: 'style', sourcePartKey: prepared.parts[0].partKey, sourceParagraphIndex: 0,
      payload: { title: '서술 시점', observation: '해원의 1인칭 관찰과 감각 묘사를 유지한다.',
        styleCategory: 'narration' },
    } });
    const profiles = new StoryGenerationProfileService(db as never);
    const draft = await profiles.getOrCreate(owner.id, work.id);
    expect(draft.profile.status).toBe('needs_review');
    const settings = normalizeCreatorGenerationProfile('story', draft.profile.draftSettings);
    const reviewed = await profiles.update(owner.id, work.id, { settings: {
      ...settings, sections: settings.sections.map(section => ({ ...section, decision: 'accepted' as const })),
    } });
    await profiles.approve(owner.id, work.id, { expectedDraftFingerprint: reviewed.profile.draftFingerprint! });
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
      rightsConfirmed: true, aiBranchAllowed: true, allowedLocales: ['ko'],
      startsAt: new Date(0),
    } });
    return { owner, work, manuscript, prepared, uploadReceipt };
  }

  function scopeClaim(job: StoryStudioChoiceJobService, releaseId: string) {
    jest.spyOn(job as unknown as { claim: () => Promise<{ id: string; leaseToken: string } | null> }, 'claim')
      .mockImplementation(async () => {
        const target = await db.storyStudioChoiceJob.findUniqueOrThrow({ where: { releaseId } });
        const leaseToken = randomUUID();
        const changed = await db.storyStudioChoiceJob.updateMany({ where: { id: target.id, status: 'queued' },
          data: { status: 'processing', leaseToken,
            leaseExpiresAt: new Date(Date.now() + 5 * 60_000) } });
        return changed.count === 1 ? { id: target.id, leaseToken } : null;
      });
  }

  it('binds prepared choices to the approved profile and blocks publication after an approval change', async () => {
    const { owner, work, manuscript, prepared } = await manuscriptFixture(1);
    const choices = new StoryStudioChoicePreparationService(db as never);
    const studio = new StoryStudioLinearService(db as never, choices);
    const materialized = await studio.materialize(owner.id, work.id, {
      manuscriptVersionId: manuscript.id, expectedManuscriptHash: prepared.contentHash,
      originalRoutesReviewed: true, originalRoutes: [{ partKey: prepared.parts[0].partKey }],
    });
    const provider = { generate: jest.fn(async (input: { generationProfile: { sections: Array<{
      key: string; value: Record<string, unknown>;
    }> }; parts: Array<{ partKey: string }> }) => {
      expect(input.generationProfile.sections.find(section => section.key === 'writing_style')?.value)
        .toMatchObject({ referenceScope: 'production_constraint', summary: expect.stringContaining('1인칭') });
      return input.parts.map(part => ({ partKey: part.partKey,
        originalChoiceLabel: '기록을 보존하고 원고의 결말에 이른다',
        alternatives: ['기록을 감추고 혼자 조사한다', '기록을 공개하고 마을에 묻는다'] }));
    }) };
    jest.spyOn(choices as unknown as { provider: () => StoryChoicePreparationProvider }, 'provider').mockReturnValue(provider as never);
    const job = new StoryStudioChoiceJobService(db as never, choices);
    scopeClaim(job, materialized.releaseId);
    expect(await job.executeOne()).toBe('progress');
    expect(await job.executeOne()).toBe('completed');
    await expect(studio.finish(owner.id, work.id, materialized.releaseId)).resolves.toMatchObject({ ready: true });
    const profile = await db.storyWorkGenerationProfile.findFirstOrThrow({ where: { workId: work.id } });
    await db.storyWorkGenerationProfile.update({ where: { id: profile.id }, data: { reviewRevision: { increment: 1 } } });
    await expect(studio.finish(owner.id, work.id, materialized.releaseId))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED' } });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(await db.storyScene.count({ where: { id: { in: materialized.scenes.map(scene => scene.sceneId) },
      status: 'published' } })).toBe(0);
  }, 60_000);

  it('rejects a real approval change during provider execution before storing alternatives', async () => {
    const { owner, work, manuscript, prepared } = await manuscriptFixture(1);
    const choices = new StoryStudioChoicePreparationService(db as never);
    const studio = new StoryStudioLinearService(db as never, choices);
    const materialized = await studio.materialize(owner.id, work.id, {
      manuscriptVersionId: manuscript.id, expectedManuscriptHash: prepared.contentHash,
      originalRoutesReviewed: true, originalRoutes: [{ partKey: prepared.parts[0].partKey }],
    });
    const profile = await db.storyWorkGenerationProfile.findFirstOrThrow({ where: { workId: work.id } });
    const provider = { generate: jest.fn(async (input: { parts: Array<{ partKey: string }> }) => {
      await db.storyWorkGenerationProfile.update({ where: { id: profile.id }, data: { reviewRevision: { increment: 1 } } });
      return input.parts.map(part => ({ partKey: part.partKey,
        originalChoiceLabel: '기록을 보존하고 원고의 결말에 이른다',
        alternatives: ['기록을 감추고 혼자 조사한다', '기록을 공개하고 마을에 묻는다'] }));
    }) };
    jest.spyOn(choices as unknown as { provider: () => StoryChoicePreparationProvider }, 'provider').mockReturnValue(provider as never);
    const job = new StoryStudioChoiceJobService(db as never, choices);
    scopeClaim(job, materialized.releaseId);
    expect(await job.executeOne()).toBe('failed');
    expect(await db.storyChoice.count({ where: { sceneId: materialized.scenes[0].sceneId } })).toBe(1);
    expect(await db.auditEvent.count({ where: { targetId: materialized.scenes[0].sceneId,
      action: 'story_studio_choices.prepared' } })).toBe(0);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('keeps blank authored labels private, recovers a failed job, then proves all three choices per part', async () => {
    const { owner, work, manuscript, prepared } = await manuscriptFixture();
    const choices = new StoryStudioChoicePreparationService(db as never);
    const studio = new StoryStudioLinearService(db as never, choices);
    const job = new StoryStudioChoiceJobService(db as never, choices);
    const materialized = await studio.materialize(owner.id, work.id, {
      manuscriptVersionId: manuscript.id, expectedManuscriptHash: prepared.contentHash,
      originalRoutesReviewed: true, originalRoutes: prepared.parts.map(part => ({ partKey: part.partKey })),
    });
    expect(materialized.scenes).toHaveLength(2);
    expect(materialized.scenes.every(scene => scene.originalLabel === null && scene.choiceCount === 1)).toBe(true);
    scopeClaim(job, materialized.releaseId);
    await expect(studio.finish(owner.id, work.id, materialized.releaseId))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_PUBLICATION_CHOICES_INCOMPLETE' } });

    const transport = jest.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      if (transport.mock.calls.length === 1) return new Response('offline failure', { status: 503 });
      const request = JSON.parse(String(init.body)) as { input: string };
      const source = JSON.parse(request.input) as { parts: Array<{
        partKey: string; originalChoiceLabel?: string; nextPartTitle: string | null;
      }> };
      expect(source.parts[0].originalChoiceLabel).toBeUndefined();
      expect(source.parts[0].nextPartTitle).toBe(transport.mock.calls.length === 2 ? '다음 방' : null);
      return new Response(JSON.stringify({ status: 'completed', usage: {
        input_tokens: 120, output_tokens: 80, total_tokens: 200,
        input_tokens_details: { cached_tokens: 20 }, output_tokens_details: { reasoning_tokens: 10 },
      }, output: [{ type: 'message', content: [{
        type: 'output_text', text: JSON.stringify({ choices: { [source.parts[0].partKey]: {
          original: '기록을 따라 원작의 다음 장면으로 간다',
          first: '기록을 감추고 다른 인물을 찾아간다',
          second: '기록을 공개하고 사건을 뒤집는다',
        } } }),
      }] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    jest.spyOn(choices as unknown as { provider: () => StoryChoicePreparationProvider }, 'provider')
      .mockReturnValue(new StoryChoicePreparationProvider({
      apiKey: 'offline-test-only', model: 'fixture',
      }, transport));
    expect(await job.executeOne()).toBe('failed');
    expect(await db.storyChoice.count({ where: { sceneId: materialized.scenes[0].sceneId } })).toBe(1);
    expect((await db.storyRelease.findUniqueOrThrow({ where: { id: materialized.releaseId } })
      .then(row => row.validationSummary as Record<string, unknown>)).ready).toBe(false);

    await job.retry(owner.id, work.id, materialized.releaseId);
    expect(await job.executeOne()).toBe('progress');
    expect(await job.executeOne()).toBe('progress');
    expect(await job.executeOne()).toBe('completed');
    expect(transport).toHaveBeenCalledTimes(3);
    expect((await db.storyStudioChoiceJob.findUniqueOrThrow({ where: { releaseId: materialized.releaseId } })))
      .toMatchObject({ status: 'completed', completedParts: 2, totalParts: 2 });
    const usageEvents = await db.auditEvent.findMany({ where: { actorUserId: owner.id,
      action: 'story_studio_choices.provider_usage', targetType: 'story_scene',
      targetId: { in: materialized.scenes.map(scene => scene.sceneId) } } });
    expect(usageEvents).toHaveLength(3);
    const rejectedUsage = usageEvents.filter(event => (event.metadata as Record<string, unknown>).outcome === 'rejected');
    const acceptedUsage = usageEvents.filter(event => (event.metadata as Record<string, unknown>).outcome === 'accepted');
    expect(rejectedUsage).toHaveLength(1);
    expect(rejectedUsage[0].metadata).toMatchObject({ usageStatus: 'unavailable', providerUsage: null });
    expect(acceptedUsage).toHaveLength(2);
    for (const event of acceptedUsage) expect(event.metadata).toMatchObject({
      usageStatus: 'reported', providerUsage: { inputTokens: 120, outputTokens: 80,
        cachedInputTokens: 20, reasoningTokens: 10 },
    });
    for (const [index, scene] of materialized.scenes.entries()) {
      const rows = await db.storyChoice.findMany({ where: { sceneId: scene.sceneId }, orderBy: { position: 'asc' } });
      expect(rows.map(row => row.position)).toEqual([1, 2, 3]);
      expect(rows.map(row => (row.label as Record<string, unknown>).ko)).toEqual([
        '기록을 따라 원작의 다음 장면으로 간다',
        '기록을 감추고 다른 인물을 찾아간다',
        '기록을 공개하고 사건을 뒤집는다',
      ]);
      expect(rows[0]).toMatchObject({ routeKind: 'writer_original',
        targetSceneId: materialized.scenes[index + 1]?.sceneId ?? null,
        targetEndingKey: index === 1 ? 'author_main' : null });
      expect(rows.slice(1).every(row => row.routeKind === 'generation_required' &&
        !row.targetSceneId && !row.targetEndingKey)).toBe(true);
    }
    expect(await studio.finish(owner.id, work.id, materialized.releaseId))
      .toEqual({ releaseId: materialized.releaseId, ready: true, published: false });
    expect((await db.storyRelease.findUniqueOrThrow({ where: { id: materialized.releaseId } })
      .then(row => row.validationSummary as Record<string, unknown>)).ready).toBe(true);
  }, 60_000);

  it('uploads a reviewed preface unchanged and materializes only authored parts as reader scenes', async () => {
    const raw = '작품 소개와 제작 메모.\n\n# Part 01. 첫 장\n첫 장 본문.\n\n# Part 02. 둘째 장\n둘째 장 본문.';
    const first = raw.indexOf('# Part 01');
    const second = raw.indexOf('# Part 02');
    const prepared = preparePastedManuscript(Buffer.from(raw), JSON.stringify({ locale: 'ko',
      confirmed: true, preface: { start: 0, end: first }, parts: [
        { partKey: 'part-1', title: '첫 장', start: first, end: second },
        { partKey: 'part-2', title: '둘째 장', start: second, end: raw.length },
      ] }));
    const { owner, work, manuscript, uploadReceipt } = await manuscriptFixture(2, prepared, true);
    expect(uploadReceipt).toMatchObject({ received: { parts: 2, byteLength: Buffer.byteLength(raw) } });
    const stored = manuscript.structuredBody as { intake: { source: { rawText: string },
      confirmedPreface: { start: number; end: number } } };
    expect(stored.intake.source.rawText).toBe(raw);
    expect(stored.intake.confirmedPreface).toEqual({ start: 0, end: first });
    const studio = new StoryStudioLinearService(db as never,
      new StoryStudioChoicePreparationService(db as never));
    const result = await studio.materialize(owner.id, work.id, {
      manuscriptVersionId: manuscript.id, expectedManuscriptHash: prepared.contentHash,
      originalRoutesReviewed: true,
      originalRoutes: prepared.parts.map(part => ({ partKey: part.partKey })),
    });
    const beats = await db.storyBeat.findMany({ where: { sceneId: result.scenes[0].sceneId },
      orderBy: { position: 'asc' } });
    const readerText = beats.map(beat => (beat.content as { ko: string }).ko).join('');
    expect(readerText).toBe('첫 장 본문.\n\n');
    expect(readerText).not.toContain('작품 소개와 제작 메모.');
    expect(readerText).not.toContain('# Part 01. 첫 장');
  }, 60_000);

  it('queues semantic analysis atomically when a writer pastes a manuscript', async () => {
    const owner = await db.user.create({ data: {} });
    const work = await db.storyWork.create({ data: {
      ownerUserId: owner.id, slug: `draft-${randomUUID()}`,
      title: { ko: '새 원고' }, summary: {},
    } });
    const rateCardId = randomUUID();
    const config = semanticTestConfig({ workerEnabled: true, autoEnqueueOnUpload: true,
      rateCardId, rateCardVersion: `paste-${rateCardId}` });
    await db.storyAiRateCard.create({ data: {
      id: rateCardId, version: config.rateCardVersion,
      provider: config.provider, model: config.model, status: 'active',
      inputCostPerMillion: config.inputKrwPerMillion,
      cachedInputCostPerMillion: config.cachedInputKrwPerMillion,
      outputCostPerMillion: config.outputKrwPerMillion, createdByUserId: owner.id,
    } });
    const transport = jest.fn(async () => { throw new Error('External AI calls are prohibited'); });
    const analysis = new SemanticAnalysisService(new SemanticAnalysisRepository(db as never),
      new SemanticAnalysisProvider(config, transport), {} as never);
    const controller = new StoryManuscriptFileController(db as never, analysis);
    const raw = '해원은 문 앞에서 이름을 떠올렸다.\n\n해원은 안쪽 기록을 펼쳤다.';
    const second = raw.indexOf('해원은 안쪽');
    const manifest = JSON.stringify({ locale: 'ko', confirmed: true, parts: [
      { partKey: 'part-1', title: '문 앞', start: 0, end: second },
      { partKey: 'part-2', title: '기록', start: second, end: raw.length },
    ] });
    const buffer = Buffer.from(raw, 'utf8');
    const upload = () => controller.paste({ id: owner.id } as never, work.id,
      { fieldname: 'manuscript', mimetype: 'text/plain', buffer, size: buffer.length } as never,
      { body: { manifest } } as never);

    const first = await upload();
    expect(first).toMatchObject({ analysisStarted: true, idempotentReplay: false,
      received: { parts: 2, sourceKind: 'utf8_paste' } });
    expect(await db.storyAnalysisJob.findUniqueOrThrow({ where: { id: first.analysisJobId } }))
      .toMatchObject({ workId: work.id, manuscriptVersionId: first.manuscript.id,
        pipeline: 'semantic_extraction_v1', status: 'queued', actorUserId: owner.id });
    expect(await db.storyBranchPreparationJob.count({ where: { manuscriptVersionId: first.manuscript.id } }))
      .toBe(2);
    await expect(upload()).resolves.toMatchObject({ analysisStarted: true, idempotentReplay: true,
      analysisJobId: first.analysisJobId, manuscript: { id: first.manuscript.id } });
    expect(await db.storyAnalysisJob.count({ where: { manuscriptVersionId: first.manuscript.id } }))
      .toBe(1);
    expect(transport).not.toHaveBeenCalled();
  }, 60_000);

  it('keeps uploaded choices private until the complete automatic set is published to a reader', async () => {
    const network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited'));
    try {
      const { owner, work, manuscript, prepared, uploadReceipt } = await manuscriptFixture(2, undefined, true, true);
      expect(uploadReceipt).toMatchObject({ idempotentReplay: false, received: { parts: 2 } });
      expect(await db.storyBranchPreparationJob.count({ where: { manuscriptVersionId: manuscript.id } })).toBe(2);
      const reader = await db.user.create({ data: {} });
      const choices = new StoryStudioChoicePreparationService(db as never);
      const studio = new StoryStudioLinearService(db as never, choices);
      const lifecycle = new StoryLifecycleService(db as never);
      const production = new StoryProductionService(db as never);
      const materialized = await studio.materialize(owner.id, work.id, {
        manuscriptVersionId: manuscript.id, expectedManuscriptHash: prepared.contentHash,
        originalRoutesReviewed: true, originalRoutes: prepared.parts.map(part => ({ partKey: part.partKey })),
      });
      const provider = { generate: jest.fn(async (input: { parts: Array<{
        partKey: string; nextPartTitle: string | null;
      }> }) => input.parts.map(part => ({
        partKey: part.partKey,
        originalChoiceLabel: part.nextPartTitle ? '기록을 따라 다음 장으로 간다' : '기록을 보존하고 결말에 이른다',
        alternatives: ['기록을 감추고 혼자 조사한다', '기록을 공개하고 마을에 묻는다'],
      }))) };
      jest.spyOn(choices as unknown as { provider: () => StoryChoicePreparationProvider }, 'provider')
        .mockReturnValue(provider as never);
      const job = new StoryStudioChoiceJobService(db as never, choices);
      scopeClaim(job, materialized.releaseId);

      await expect(production.startProgress(reader.id, work.id, { mode: 'continue', locale: 'ko' }))
        .rejects.toMatchObject({ status: 404 });
      for (const toStatus of ['intake_received', 'reviewing', 'release_ready']) {
        const current = await db.storyWork.findUniqueOrThrow({ where: { id: work.id } });
        await lifecycle.transitionPublication(owner.id, work.id,
          { toStatus, expectedRevision: current.releaseRevision }, randomUUID());
      }
      const publish = async () => {
        const current = await db.storyWork.findUniqueOrThrow({ where: { id: work.id } });
        return lifecycle.transitionPublication(owner.id, work.id, {
          toStatus: 'published', releaseId: materialized.releaseId,
          expectedRevision: current.releaseRevision,
        }, randomUUID());
      };
      await expect(publish()).rejects.toMatchObject({ status: 409 });
      expect(await job.executeOne()).toBe('progress');
      await expect(publish()).rejects.toMatchObject({ status: 409 });
      expect(await db.storyWork.findUniqueOrThrow({ where: { id: work.id } }))
        .toMatchObject({ status: 'release_ready', activeReleaseId: null });
      await expect(production.startProgress(reader.id, work.id, { mode: 'continue', locale: 'ko' }))
        .rejects.toMatchObject({ status: 404 });
      expect(await db.storyScene.count({ where: { id: { in: materialized.scenes.map(scene => scene.sceneId) },
        status: 'published' } })).toBe(0);
      expect(await job.executeOne()).toBe('progress');
      expect(await job.executeOne()).toBe('completed');
      expect(provider.generate).toHaveBeenCalledTimes(2);
      expect(await studio.finish(owner.id, work.id, materialized.releaseId))
        .toMatchObject({ ready: true, published: false });
      await expect(publish()).rejects.toMatchObject({
        response: { code: 'STORY_PUBLICATION_METADATA_REQUIRED' },
      });
      const coverAsset = await db.asset.create({ data: {
        assetType: 'image', visibility: 'public', storageProvider: 'r2',
        storageKey: `qa/new-writer-cover/${randomUUID()}.png`, mimeType: 'image/png',
        metadata: { uploadIntent: { status: 'uploaded', createdByUserId: owner.id },
          lifecycle: { status: 'active' } },
      } });
      const assets = new UserAssetsService(db as never, { get: () => undefined } as never);
      const writer = new StoryProductionService(db as never, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, assets);
      await expect(writer.updateDraftMetadata(owner.id, work.id, {
        authorDisplayName: '루미나', summary: '선택에 따라 다른 기록을 따라가는 이야기',
        coverAssetId: coverAsset.id,
      })).resolves.toMatchObject({
        authorDisplayName: '루미나', cover: { assetId: coverAsset.id },
      });
      await expect(publish()).resolves.toMatchObject({ toStatus: 'published' });

      const progress = await production.startProgress(reader.id, work.id, { mode: 'continue', locale: 'ko' });
      expect(progress.scene?.id).toBe(materialized.scenes[0].sceneId);
      expect(progress.choices).toHaveLength(3);
      expect(progress.choices.map(choice => choice.label.value)).toEqual([
        '기록을 따라 다음 장으로 간다',
        '기록을 감추고 혼자 조사한다',
        '기록을 공개하고 마을에 묻는다',
      ]);
      expect(progress.choices.map(choice => choice.routeKind))
        .toEqual(['writer_original', 'generation_required', 'generation_required']);
      const secondPart = await production.selectChoice(reader.id, progress.progressId,
        progress.choices[0].id, progress.revision, 'ko') as {
          progressId: string; revision: number; status: string;
          scene: { id: string } | null; choices: Array<{ id: string }>;
        };
      expect(secondPart).toMatchObject({ status: 'active', scene: { id: materialized.scenes[1].sceneId } });
      expect(secondPart.choices).toHaveLength(3);
      const ending = await production.selectChoice(reader.id, secondPart.progressId,
        secondPart.choices[0].id, secondPart.revision, 'ko');
      expect(ending).toMatchObject({ status: 'completed', scene: null, choices: [] });
      expect(await db.storyEndingDiscovery.count({ where: {
        userId: reader.id, workId: work.id, releaseId: materialized.releaseId,
        endingKey: 'author_main', endingKind: 'author_main',
      } })).toBe(1);
      expect(await db.storyRelease.findUniqueOrThrow({ where: { id: materialized.releaseId } }))
        .toMatchObject({ status: 'active' });
      expect(await db.storyScene.count({ where: { id: { in: materialized.scenes.map(scene => scene.sceneId) },
        status: 'published' } })).toBe(2);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  }, 60_000);

  it('materializes a 265-part original route without exposing empty choice labels', async () => {
    const { owner, work, manuscript, prepared } = await manuscriptFixture(265);
    const choices = new StoryStudioChoicePreparationService(db as never);
    const studio = new StoryStudioLinearService(db as never, choices);
    const result = await studio.materialize(owner.id, work.id, {
      manuscriptVersionId: manuscript.id, expectedManuscriptHash: prepared.contentHash,
      originalRoutesReviewed: true, originalRoutes: prepared.parts.map(part => ({ partKey: part.partKey })),
    });
    expect(result.scenes).toHaveLength(265);
    expect(result.scenes.every(scene => scene.choiceCount === 1 && scene.originalLabel === null)).toBe(true);
    expect((await db.storyStudioChoiceJob.findUniqueOrThrow({ where: { releaseId: result.releaseId } })))
      .toMatchObject({ status: 'queued', totalParts: 265, completedParts: 0 });
    const first = await db.storyChoice.findFirstOrThrow({ where: { sceneId: result.scenes[0].sceneId } });
    const last = await db.storyChoice.findFirstOrThrow({ where: { sceneId: result.scenes[264].sceneId } });
    expect(first).toMatchObject({ routeKind: 'writer_original', targetSceneId: result.scenes[1].sceneId,
      targetEndingKey: null, label: { ko: null } });
    expect(last).toMatchObject({ routeKind: 'writer_original', targetSceneId: null,
      targetEndingKey: 'author_main', label: { ko: null } });
    expect(await db.storyBeat.count({ where: { sceneId: { in: result.scenes.map(scene => scene.sceneId) } } }))
      .toBe(265);
    expect((await db.storyRelease.findUniqueOrThrow({ where: { id: result.releaseId } })
      .then(row => row.validationSummary as Record<string, unknown>)).ready).toBe(false);
  }, 120_000);

  (process.env.STORY_QA_MANUSCRIPT_PATH ? it : it.skip)(
    'uploads a real 32-part manuscript and reaches both author and generated endings', async () => {
      const raw = readFileSync(process.env.STORY_QA_MANUSCRIPT_PATH!, 'utf8');
      const headings = [...raw.matchAll(/^# (?:Part|외전) [0-9]{1,2}\. (.+?)\r?$/gm)];
      expect(headings).toHaveLength(32);
      const firstPart = headings[0].index!;
      const parts = headings.map((heading, index) => ({
        partKey: `part-${index + 1}`, title: heading[1],
        start: heading.index!,
        end: headings[index + 1]?.index ?? raw.length,
      }));
      const prepared = preparePastedManuscript(Buffer.from(raw), JSON.stringify({
        locale: 'ko', confirmed: true, preface: { start: 0, end: firstPart }, parts,
      }));
      const { owner, work, manuscript, uploadReceipt } = await manuscriptFixture(32, prepared, true, true);
      expect(uploadReceipt).toMatchObject({ idempotentReplay: false, received: { parts: 32 } });
      const choices = new StoryStudioChoicePreparationService(db as never);
      const studio = new StoryStudioLinearService(db as never, choices);
      const result = await studio.materialize(owner.id, work.id, {
        manuscriptVersionId: manuscript.id, expectedManuscriptHash: prepared.contentHash,
        originalRoutesReviewed: true,
        originalRoutes: prepared.parts.map(part => ({ partKey: part.partKey })),
      });
      expect(result.scenes).toHaveLength(32);
      expect(result.scenes.every(scene => scene.choiceCount === 1 && scene.originalLabel === null)).toBe(true);
      const beats = await db.storyBeat.findMany({
        where: { sceneId: { in: result.scenes.map(scene => scene.sceneId) } },
        select: { sceneId: true, position: true, content: true },
      });
      for (const [index, scene] of result.scenes.entries()) {
        const restored = beats.filter(beat => beat.sceneId === scene.sceneId)
          .sort((a, b) => a.position - b.position)
          .map(beat => (beat.content as { ko: string }).ko).join('');
        expect(restored).toBe(readerPartText(raw.slice(parts[index].start, parts[index].end), parts[index].title));
        expect(restored).not.toMatch(/^#\s*(?:Part|외전)\s+[0-9]+[.·:：-]/u);
      }
      expect(beats.filter(beat => beat.sceneId === result.scenes[0].sceneId)
        .sort((a, b) => a.position - b.position)[0].content)
        .toMatchObject({ ko: expect.stringMatching(/^테이프가 숨을 쉬기 시작한 것은/u) });
      expect((await db.storyRelease.findUniqueOrThrow({ where: { id: result.releaseId } })).status)
        .toBe('candidate');
      expect((await db.storyStudioChoiceJob.findUniqueOrThrow({ where: { releaseId: result.releaseId } })))
        .toMatchObject({ status: 'queued', totalParts: 32, completedParts: 0 });
      const transport = jest.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as { input: string };
        const source = JSON.parse(request.input) as { parts: Array<{
          partKey: string; nextPartTitle: string | null;
        }> };
        const row = source.parts[0];
        return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{
          type: 'output_text', text: JSON.stringify({ choices: { [row.partKey]: {
            original: row.nextPartTitle
              ? `${row.nextPartTitle}의 실마리를 따라 원고의 길로 간다`
              : '해원의 선택을 받아들이고 작가의 결말에 이른다',
            first: '누리를 찾아 숨은 기록을 다시 묻는다',
            second: '마을 앞에서 지워진 증거를 공개한다',
          } } }),
        }] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
      jest.spyOn(choices as unknown as { provider: () => StoryChoicePreparationProvider }, 'provider')
        .mockReturnValue(new StoryChoicePreparationProvider({
          apiKey: 'offline-test-only', model: 'fixture',
        }, transport));
      const job = new StoryStudioChoiceJobService(db as never, choices);
      scopeClaim(job, result.releaseId);
      for (let index = 0; index < 32; index++) expect(await job.executeOne()).toBe('progress');
      expect(await job.executeOne()).toBe('completed');
      expect(transport).toHaveBeenCalledTimes(32);
      for (const [index, scene] of result.scenes.entries()) {
        const rows = await db.storyChoice.findMany({ where: { sceneId: scene.sceneId },
          orderBy: { position: 'asc' } });
        expect(rows.map(row => row.position)).toEqual([1, 2, 3]);
        expect(rows[0]).toMatchObject({ routeKind: 'writer_original',
          targetSceneId: result.scenes[index + 1]?.sceneId ?? null,
          targetEndingKey: index === 31 ? 'author_main' : null });
        expect(rows.slice(1).every(row => row.routeKind === 'generation_required')).toBe(true);
      }
      expect(await studio.finish(owner.id, work.id, result.releaseId))
        .toEqual({ releaseId: result.releaseId, ready: true, published: false });
      const lifecycle = new StoryLifecycleService(db as never);
      for (const toStatus of ['intake_received', 'reviewing', 'release_ready']) {
        const current = await db.storyWork.findUniqueOrThrow({ where: { id: work.id } });
        await lifecycle.transitionPublication(owner.id, work.id,
          { toStatus, expectedRevision: current.releaseRevision }, randomUUID());
      }
      const coverAsset = await db.asset.create({ data: {
        assetType: 'image', visibility: 'public', storageProvider: 'r2',
        storageKey: `qa/full-writer-cover/${randomUUID()}.png`, mimeType: 'image/png',
        metadata: { uploadIntent: { status: 'uploaded', createdByUserId: owner.id },
          lifecycle: { status: 'active' } },
      } });
      const assets = new UserAssetsService(db as never, { get: () => undefined } as never);
      const writer = new StoryProductionService(db as never, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, assets);
      await writer.updateDraftMetadata(owner.id, work.id, {
        authorDisplayName: '루미나', summary: '잃어버린 이름을 따라 다른 선택을 마주하는 이야기',
        coverAssetId: coverAsset.id,
      });
      const current = await db.storyWork.findUniqueOrThrow({ where: { id: work.id } });
      await lifecycle.transitionPublication(owner.id, work.id, {
        toStatus: 'published', releaseId: result.releaseId, expectedRevision: current.releaseRevision,
      }, randomUUID());
      const catalog = await new StoryProductionService(db as never).catalog(undefined, {
        locale: 'ko', limit: 12, q: '루미나',
      });
      expect(catalog.items).toEqual(expect.arrayContaining([expect.objectContaining({
        id: work.id, author: { displayName: '루미나' },
      })]));
      const reader = await db.user.create({ data: {} });
      const production = new StoryProductionService(db as never);
      let progress = await production.startProgress(reader.id, work.id, { mode: 'continue', locale: 'ko' });
      for (let index = 0; index < 32; index++) {
        expect(progress.scene?.id).toBe(result.scenes[index].sceneId);
        expect(progress.choices).toHaveLength(3);
        progress = await production.selectChoice(reader.id, progress.progressId,
          progress.choices[0].id, progress.revision, 'ko') as typeof progress;
      }
      expect(progress).toMatchObject({ status: 'completed', scene: null, choices: [] });
      expect(await db.storyEndingDiscovery.count({ where: {
        userId: reader.id, workId: work.id, releaseId: result.releaseId,
        endingKey: 'author_main', endingKind: 'author_main',
      } })).toBe(1);

      const originalRegion = process.env.STORY_AI_REGION;
      process.env.STORY_AI_REGION = 'KR';
      try {
        const consent = await db.storyStyleProfileConsent.findFirstOrThrow({ where: {
          workId: work.id, manuscriptVersionId: manuscript.id,
        } });
        await db.storyStyleProfileConsent.update({ where: { id: consent.id }, data: { allowedRegions: ['KR'] } });
        const contract = await db.contentRightsContract.create({ data: {
          workType: 'story', workId: work.id, createdByUserId: owner.id,
        } });
        const rights = await db.contentRightsContractVersion.create({ data: {
          contractId: contract.id, revision: 1, contentVersionId: manuscript.id,
          exclusivity: 'nonexclusive', media: ['story_publication'], regions: ['KR'],
          startsAt: new Date(0), effectiveFrom: new Date(0), saleAllowed: true,
          aiTransformationAllowed: true, generatedResultReuseAllowed: true,
          approvalState: 'approved_configuration', authorRightsHolderShareBps: 4500,
          salesAgencyShareBps: 500, companyShareBps: 5000, pointUsagePolicy: 'unresolved',
          refundReversalPolicy: 'unresolved', paidPointPolicy: 'unresolved',
          bonusPointPolicy: 'unresolved', vatPolicy: 'unresolved',
          internalGenerationCostTreatment: INTERNAL_GENERATION_COST_TREATMENT,
          createdByUserId: owner.id, approvedByUserId: owner.id,
        } });
        const analysis = await db.storyAnalysisJob.findFirstOrThrow({ where: {
          workId: work.id, manuscriptVersionId: manuscript.id,
        } });
        const profiles = new StoryGenerationProfileService(db as never);
        const approved = await profiles.getOrCreate(owner.id, work.id);
        expect(approved.profile.status).toBe('approved');
        await db.storyReleaseCapability.create({ data: {
          workId: work.id, releaseId: result.releaseId, rateCardId: analysis.rateCardId!,
          status: 'active', includedAiRouteCount: 2, aiInputTokenLimit: 1000,
          aiOutputTokenLimit: 300, updatedByUserId: owner.id,
        } });
        const activation = new StoryAiActivationService(db as never);
        await activation.createActivation(owner.id, {
          releaseId: result.releaseId, rightsContractVersionId: rights.id,
          consentId: consent.id, consentRevision: consent.revision, locale: 'ko', region: 'KR',
          moderationPolicyVersion: 'offline-moderation-v1',
          moderationEvidenceVersion: 'offline-review-v1',
          qualityPolicyVersion: STORY_AI_QUALITY_RUBRIC, evidenceHash: 'c'.repeat(64),
          startsAt: new Date(Date.now() - 1000).toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          legalActivationConfirmed: true,
        });
        const provider = { readiness: jest.fn().mockResolvedValue({ enabled: true }),
          preflight: jest.fn().mockResolvedValue({ supported: true, inputTokenUpperBound: 100 }),
          generate: jest.fn() };
        const legal = new PersistedStoryContinuationLegalActivationGate(activation);
        const economics = new StoryEconomicsService(db as never, legal, provider as never,
          new PersistedStoryReusableResultApprovalGate(activation));
        const readyVisuals = {
          variantKeyForProgress: jest.fn().mockResolvedValue('default'),
          readyVisuals: jest.fn().mockImplementation(async (_workId: string, _releaseId: string,
            sceneKeys: string[]) => new Map(sceneKeys.map(sceneKey => [sceneKey, {
              sourceSceneKey: sceneKey, publicAssetPath: '/assets/story/fallback.webp',
            }]))),
          promptKeys: jest.fn().mockResolvedValue(new Set<string>()),
        };
        const branching = new StoryProductionService(db as never, economics, provider as never,
          legal, undefined, readyVisuals as never);
        const alternateReader = await db.user.create({ data: {} });
        let alternate = await branching.startProgress(alternateReader.id, work.id,
          { mode: 'continue', locale: 'ko' });
        expect(alternate.choices).toHaveLength(3);
        const first = await branching.selectChoice(alternateReader.id, alternate.progressId,
          alternate.choices[1].id, alternate.revision, 'ko', randomUUID()) as {
          continuationId: string; status: string;
        };
        expect(first.status).toBe('queued');
        async function settle(continuationId: string, prose: string,
          nextChoices: Array<{ choiceKey: string; label: { ko: string } }>, endingKey?: string) {
          const leaseToken = randomUUID();
          await db.storyAiContinuation.update({ where: { id: continuationId }, data: {
            status: 'processing', leaseToken, leaseOwner: 'offline-manuscript-test',
            leaseExpiresAt: new Date(Date.now() + 60000), attemptCount: 1,
          } });
          await economics.settleContinuation(null, continuationId, {
            status: 'completed', moderationDecision: 'allow', actualCostKrw: 0,
            inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, imageUnits: 0,
            resultTitle: { ko: endingKey ? '다른 결말' : '기록을 좇는 길' },
            resultBeats: [{ beatType: 'paragraph', content: { ko: prose } }],
            resultVisualManifest: {
              sceneKey: `ai-${continuationId}`,
              background: { state: 'fallback', altKey: 'story.visual.fallback' },
              characters: [],
              fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
            }, nextChoices, ...(endingKey ? { ending: { endingKey } } : {}),
          }, `settle-${continuationId}`, leaseToken);
        }
        await settle(first.continuationId, '해원은 누리의 흔적을 따라 원고에 없는 길로 접어들었다.', [
          { choiceKey: 'trace', label: { ko: '누리의 흔적을 계속 따라간다' } },
          { choiceKey: 'ask', label: { ko: '목격자에게 길을 묻는다' } },
          { choiceKey: 'return', label: { ko: '섬으로 돌아가 기록을 찾는다' } },
        ]);
        const firstContinuation = await db.storyAiContinuation.findUniqueOrThrow({
          where: { id: first.continuationId },
        });
        expect((await db.storyAiGeneratedBeat.findFirstOrThrow({ where: {
          sceneId: firstContinuation.resultGeneratedSceneId!,
        } })).content).toEqual({ ko: '해원은 누리의 흔적을 따라 원고에 없는 길로 접어들었다.' });
        const shared = await db.storyAiReusableResult.findUniqueOrThrow({
          where: { id: firstContinuation.sharedResultId! },
        });
        expect(shared.status).toBe('pending');
        const sameChoiceReader = await db.user.create({ data: {} });
        const sameChoiceStart = await branching.startProgress(sameChoiceReader.id, work.id,
          { mode: 'continue', locale: 'ko' });
        await expect(branching.selectChoice(sameChoiceReader.id, sameChoiceStart.progressId,
          sameChoiceStart.choices[1].id, sameChoiceStart.revision, 'ko', randomUUID()))
          .rejects.toMatchObject({ response: { code: 'STORY_AI_SHARED_RESULT_PENDING' } });
        for (const kind of ['moderation', 'quality'] as const) {
          await activation.evidence(owner.id, shared.id, {
            originGeneratedSceneId: shared.originGeneratedSceneId!,
            resultChecksum: shared.resultChecksum!, kind, decision: 'allow', revision: 1,
            policyVersion: kind === 'quality' ? STORY_AI_QUALITY_RUBRIC : 'offline-moderation-v1',
            evaluatorVersion: kind === 'quality' ? STORY_AI_QUALITY_EVALUATOR : 'offline-review-v1',
            evidenceHash: 'd'.repeat(64),
            expiresAt: new Date(Date.now() + 3600000).toISOString(), qualityRubricConfirmed: true,
          });
        }
        await expect(activation.promote(owner.id, shared.id, shared.resultChecksum!))
          .resolves.toMatchObject({ status: 'approved' });
        provider.readiness.mockResolvedValue({ enabled: false });
        const reused = await branching.selectChoice(sameChoiceReader.id, sameChoiceStart.progressId,
          sameChoiceStart.choices[1].id, sameChoiceStart.revision, 'ko', randomUUID()) as {
          continuationId: string; status: string; provenance: string;
        };
        expect(reused).toMatchObject({ status: 'completed', provenance: 'ai_reused' });
        expect(provider.generate).not.toHaveBeenCalled();
        const reusedContinuation = await db.storyAiContinuation.findUniqueOrThrow({
          where: { id: reused.continuationId },
        });
        expect(reusedContinuation.sharedResultId).toBe(shared.id);
        expect(reusedContinuation.resultGeneratedSceneId).not.toBe(firstContinuation.resultGeneratedSceneId);
        expect(await db.storyAiUsageLedger.findFirstOrThrow({
          where: { continuationId: reused.continuationId },
        })).toMatchObject({ inputTokens: 0, outputTokens: 0, allowanceDelta: 0 });
        provider.readiness.mockResolvedValue({ enabled: true });
        alternate = await branching.startProgress(alternateReader.id, work.id,
          { mode: 'continue', locale: 'ko' });
        expect(alternate.scene?.id).not.toBe(result.scenes[1].sceneId);
        expect(alternate.choices).toHaveLength(3);
        await expect(branching.selectChoice(alternateReader.id, alternate.progressId,
          alternate.choices[1].id, alternate.revision, 'ko', randomUUID()))
          .rejects.toMatchObject({ response: { code: 'STORY_AI_CONTEXT_PART_UNAVAILABLE' } });
        alternate = await branching.updateBeatProgress(alternateReader.id, alternate.progressId, {
          position: alternate.scene!.beats.at(-1)!.position,
          expectedRevision: alternate.revision,
        }, 'ko');
        const second = await branching.selectChoice(alternateReader.id, alternate.progressId,
          alternate.choices[1].id, alternate.revision, 'ko', randomUUID()) as {
          continuationId: string; status: string;
        };
        expect(second.status).toBe('queued');
        await settle(second.continuationId, '목격자의 증언으로 해원은 다른 결말에 이르렀다.', [],
          'ai-witness-ending');
        const secondContinuation = await db.storyAiContinuation.findUniqueOrThrow({
          where: { id: second.continuationId },
        });
        expect(secondContinuation.resultGeneratedSceneId).not.toBe(firstContinuation.resultGeneratedSceneId);
        const reached = await branching.startProgress(alternateReader.id, work.id,
          { mode: 'continue', locale: 'ko' });
        expect(reached.status).toBe('completed');
        expect(await db.storyEndingDiscovery.count({ where: {
          userId: alternateReader.id, workId: work.id, releaseId: result.releaseId,
          endingKey: 'ai-witness-ending', endingKind: 'ai_generated',
        } })).toBe(1);
        expect(provider.generate).not.toHaveBeenCalled();
      } finally {
        if (originalRegion === undefined) delete process.env.STORY_AI_REGION;
        else process.env.STORY_AI_REGION = originalRegion;
      }
    }, 120_000);

  (process.env.STORY_QA_LONG_MANUSCRIPT_PATH ? it : it.skip)(
    'materializes the supplied 265-part manuscript with its narration and author ending intact', async () => {
      const raw = readFileSync(process.env.STORY_QA_LONG_MANUSCRIPT_PATH!, 'utf8');
      const headings = [...raw.matchAll(/^# Part ([0-9]{3})\. (.+?)\r?$/gm)];
      expect(headings).toHaveLength(265);
      const parts = headings.map((heading, index) => ({
        partKey: `part-${index + 1}`, title: heading[2],
        start: index === 0 ? 0 : heading.index!,
        end: headings[index + 1]?.index ?? raw.length,
      }));
      const prepared = preparePastedManuscript(Buffer.from(raw), JSON.stringify({
        locale: 'ko', confirmed: true, parts,
      }));
      const { owner, work, manuscript } = await manuscriptFixture(265, prepared);
      const choices = new StoryStudioChoicePreparationService(db as never);
      const studio = new StoryStudioLinearService(db as never, choices);
      const result = await studio.materialize(owner.id, work.id, {
        manuscriptVersionId: manuscript.id, expectedManuscriptHash: prepared.contentHash,
        originalRoutesReviewed: true,
        originalRoutes: prepared.parts.map(part => ({ partKey: part.partKey })),
      });
      expect(result.scenes).toHaveLength(265);
      expect(result.scenes.every(scene => scene.choiceCount === 1 && scene.originalLabel === null)).toBe(true);
      const beats = await db.storyBeat.findMany({
        where: { sceneId: { in: result.scenes.map(scene => scene.sceneId) } },
        select: { sceneId: true, position: true, content: true },
      });
      for (const [index, scene] of result.scenes.entries()) {
        const restored = beats.filter(beat => beat.sceneId === scene.sceneId)
          .sort((a, b) => a.position - b.position)
          .map(beat => (beat.content as { ko: string }).ko).join('');
        expect(restored).toBe(raw.slice(parts[index].start, parts[index].end));
      }
      const last = await db.storyChoice.findFirstOrThrow({
        where: { sceneId: result.scenes[264].sceneId },
      });
      expect(last).toMatchObject({ routeKind: 'writer_original', label: { ko: null },
        targetSceneId: null, targetEndingKey: 'author_main' });
      expect((await db.storyStudioChoiceJob.findUniqueOrThrow({ where: { releaseId: result.releaseId } })))
        .toMatchObject({ status: 'queued', totalParts: 265, completedParts: 0 });
      expect((await db.storyRelease.findUniqueOrThrow({ where: { id: result.releaseId } })).status)
        .toBe('candidate');
    }, 180_000);
});
