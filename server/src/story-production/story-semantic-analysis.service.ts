import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, type StoryAnalysisChunk, type StoryAnalysisJob } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash, randomUUID } from 'crypto';
import { analyzeStructuredManuscript, deriveContinuityLedger, manuscriptContentHash, STORY_LOCALES, type ManuscriptPart } from './story-production.policy';
import { SemanticAnalysisRepository } from './story-semantic-analysis.repository';
import { SemanticAnalysisProvider, semanticPlainText } from './story-semantic-analysis.provider';
import { assertSemanticJobPins, semanticCost, semanticPinHash, semanticReservation, type SemanticPins } from './story-semantic-analysis.config';
import { nextSourceChunk, pieceFor, sha256, sourceParts } from './story-semantic-analysis.source';
import { SEMANTIC_PIPELINE, STYLE_CATEGORIES, SemanticAnalysisError, type SemanticInput, type SemanticResult,
  type SourceCursor, type SourceRef, type SemanticUsage } from './story-semantic-analysis.types';
import { StoryAnalysisDiscoveryQueryDto } from './dto/story-analysis-discovery.dto';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { StoryCompanyFinalSubmissionService } from './story-company-final-submission.service';

@Injectable()
export class SemanticAnalysisService {
  private readonly logger = new Logger(SemanticAnalysisService.name);
  private cache?: { jobId: string; parts: ManuscriptPart[]; digest: string };
  constructor(
    private readonly repository: SemanticAnalysisRepository,
    private readonly provider: SemanticAnalysisProvider,
    private readonly generationProfiles: StoryGenerationProfileService,
    @Optional() private readonly companySubmission?: StoryCompanyFinalSubmissionService,
  ) {}
  private get db() { return this.repository.prisma; }

  manuscripts(userId: string, workId: string, query: StoryAnalysisDiscoveryQueryDto) {
    return this.repository.manuscripts(userId, workId, query);
  }

  async analyses(userId: string, manuscriptId: string, query: StoryAnalysisDiscoveryQueryDto) {
    const page = await this.repository.analyses(userId, manuscriptId, query);
    return { ...page, items: page.items.map(job => ({
      id: job.id, manuscriptVersionId: job.manuscriptVersionId, analysisVersion: job.analysisVersion,
      status: job.status, kind: job.pipeline, phase: job.phase, sourceLocale: job.sourceLocale,
      sourceContentHash: job.sourceContentHash,
      semanticCompleted: job.pipeline === SEMANTIC_PIPELINE && job.status === 'completed',
      progress: { totalParagraphs: job.totalParagraphs, plannedParagraphs: job.plannedParagraphs,
        completedParagraphs: job.completedParagraphs, plannedChunks: job.plannedChunks,
        completedChunks: job.completedChunks, coverageComplete: job.pipeline === SEMANTIC_PIPELINE &&
          job.status === 'completed' && job.completedParagraphs === job.totalParagraphs },
      approval: 'not_approved', memoryApproved: false, errorCode: job.errorCode,
      createdAt: job.createdAt, startedAt: job.startedAt, completedAt: job.completedAt,
    })) };
  }

  async enqueue(userId: string, manuscriptId: string, key?: string) {
    const readiness = await this.provider.readiness();
    const job = await this.repository.enqueue(userId, manuscriptId, key, this.provider.config,
      readiness.enabled ? undefined : readiness.reason);
    return this.project(job);
  }

  async recoverProfile(userId: string, id: string, expectedSourceContentHash: string) {
    if (!/^[a-f0-9]{64}$/.test(expectedSourceContentHash))
      throw new BadRequestException({ code: 'ANALYSIS_RECOVERY_SOURCE_INVALID' });
    try {
      const owned = await this.repository.owned(userId, id);
      const recovered = await this.db.$transaction(async tx => {
        // Use the writer's normal work lock, then fence the failed job. This is
        // local finalization only: no provider readiness, queueing or dispatch.
        const work = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM story_works WHERE id=${owned.workId}::uuid
            AND owner_user_id=${userId}::uuid FOR UPDATE
        `;
        if (!work.length) throw new NotFoundException('Analysis job not found');
        const locked = await tx.$queryRaw<Array<{ leaseActive: boolean }>>`
          SELECT (lease_token IS NOT NULL AND
            (lease_expires_at IS NULL OR lease_expires_at>clock_timestamp())) AS "leaseActive"
          FROM story_analysis_jobs WHERE id=${id}::uuid FOR UPDATE
        `;
        const job = await tx.storyAnalysisJob.findUniqueOrThrow({ where: { id } });
        if (job.actorUserId !== userId || job.workId !== owned.workId)
          throw new NotFoundException('Analysis job not found');
        if (job.sourceContentHash !== expectedSourceContentHash)
          throw new ConflictException({ code: 'ANALYSIS_RECOVERY_SOURCE_CHANGED' });
        if (job.status === 'completed' && await tx.auditEvent.findFirst({
          where: { actorUserId: userId, action: 'story_analysis.profile_recovered',
            targetType: 'story_analysis_job', targetId: id }, select: { id: true },
        })) return this.project(job);
        if (!profileRecoveryCandidate(job) || locked[0]?.leaseActive !== false)
          throw new ConflictException({ code: 'ANALYSIS_PROFILE_RECOVERY_UNAVAILABLE' });
        const manuscript = await tx.storyManuscriptVersion.findFirst({
          where: { id: job.manuscriptVersionId, ownerUserId: userId, workId: job.workId },
        });
        const latest = await tx.storyManuscriptVersion.findFirst({
          where: { workId: job.workId, ownerUserId: userId },
          orderBy: { version: 'desc' }, select: { id: true },
        });
        if (!manuscript || latest?.id !== manuscript.id || manuscript.locale !== job.sourceLocale ||
            manuscript.contentHash !== job.sourceContentHash ||
            streamedManuscriptHash(manuscript.structuredBody) !== job.sourceDigest ||
            semanticPinHash(job.configPins as unknown as SemanticPins) !== job.configHash)
          throw new ConflictException({ code: 'ANALYSIS_RECOVERY_SOURCE_CHANGED' });
        const chunks = await tx.storyAnalysisChunk.aggregate({ where: { analysisJobId: id },
          _count: { _all: true, dispatchStartedAt: true, completedAt: true, inputTokens: true,
            outputTokens: true, cachedInputTokens: true, reasoningTokens: true, actualCostKrw: true },
          _min: { ordinal: true }, _max: { ordinal: true },
          _sum: { paragraphCount: true, inputTokenBudget: true, inputTokens: true, outputTokens: true, actualCostKrw: true },
        });
        const invalid = await tx.storyAnalysisChunk.findFirst({ where: { analysisJobId: id,
          OR: [{ status: { not: 'completed' } }, { errorCode: { not: null } }] }, select: { id: true } });
        const unfinished = await tx.storyContinuityEntry.count({ where: { analysisJobId: id,
          entryType: { in: ['foreshadow', 'payoff'] }, ...(job.finalCursor ? { id: { gt: job.finalCursor } } : {}) } });
        if (invalid || unfinished || Object.values(chunks._count).some(count => count !== job.plannedChunks) ||
            chunks._min.ordinal !== 0 || chunks._max.ordinal !== job.plannedChunks - 1 ||
            chunks._sum.paragraphCount !== job.totalParagraphs ||
            chunks._sum.inputTokenBudget !== job.reservedInputTokens ||
            (chunks._sum.inputTokens ?? Infinity) > job.reservedInputTokens ||
            (chunks._sum.outputTokens ?? Infinity) > job.reservedOutputTokens ||
            !chunks._sum.actualCostKrw?.equals(job.observedCostKrw) ||
            job.observedCostKrw.gt(job.reservedCostKrw))
          throw new ConflictException({ code: 'ANALYSIS_PROFILE_RECOVERY_UNAVAILABLE' });
        const leaseToken = randomUUID();
        const recovering = await tx.storyAnalysisJob.update({ where: { id }, data: {
          status: 'running', leaseToken, leaseExpiresAt: new Date(Date.now() + 120000),
        } });
        await this.generationProfiles.createDraftAtCompletion(tx, recovering);
        const continuityEntryCount = await tx.storyContinuityEntry.count({ where: { analysisJobId: id } });
        const completed = await tx.storyAnalysisJob.update({ where: { id }, data: {
          status: 'completed', phase: 'completed', errorCode: null, completedAt: new Date(),
          leaseToken: null, leaseExpiresAt: null, actualCostKrw: job.observedCostKrw,
          result: { ...jsonRecord(job.result), continuityEntryCount },
        } });
        await tx.auditEvent.create({ data: { actorUserId: userId, actorType: 'user',
          action: 'story_analysis.profile_recovered', targetType: 'story_analysis_job', targetId: id,
          beforeData: { status: job.status, errorCode: job.errorCode },
          afterData: { status: completed.status, approval: 'not_approved' },
          metadata: { workId: job.workId, manuscriptVersionId: job.manuscriptVersionId,
            sourceContentHash: job.sourceContentHash, providerRequests: 0, mode: 'local_settings_only' },
        } });
        return this.project(completed);
      }, { timeout: 10000 });
      // The explicit recovery commits first; company submission failure must not repeat paid analysis.
      if (this.companySubmission)
        await this.finalizeCompanySubmission(userId, owned.workId, owned.manuscriptVersionId, id);
      return recovered;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: 'ANALYSIS_PROFILE_RECOVERY_RETRY' });
    }
  }

  async enqueueUploadedManuscript(userId: string, manuscriptId: string) {
    const config = this.provider.config;
    if (!config.autoEnqueueOnUpload || !config.enabled || !config.workerEnabled ||
        (config.manuscriptAllowlist.length > 0 && !config.manuscriptAllowlist.includes(manuscriptId))) {
      return { analysisStarted: false };
    }
    try {
      const job = await this.enqueue(userId, manuscriptId, `manuscript-upload:${manuscriptId}`);
      return { analysisStarted: true, analysisJobId: job.id };
    } catch (error) {
      if (error instanceof ConflictException) {
        const response = error.getResponse();
        const priorId = typeof response === 'object' && response !== null &&
          'analysisJobId' in response ? response.analysisJobId : null;
        if (typeof priorId === 'string') return { analysisStarted: true, analysisJobId: priorId };
      }
      this.logger.warn('Automatic manuscript analysis could not be queued; manuscript remains available for retry');
      return { analysisStarted: false };
    }
  }

  async enqueueUploadedManuscriptInTransaction(tx: Prisma.TransactionClient, userId: string, manuscriptId: string) {
    const config = this.provider.config;
    if (!config.autoEnqueueOnUpload || !config.enabled || !config.workerEnabled ||
        (config.manuscriptAllowlist.length > 0 && !config.manuscriptAllowlist.includes(manuscriptId)) ||
        !(await this.provider.readiness()).enabled) return { analysisStarted: false };
    try {
      const job = await this.repository.enqueueInTransaction(tx, userId, manuscriptId,
        `manuscript-upload:${manuscriptId}`, config);
      return { analysisStarted: true, analysisJobId: job.id };
    } catch (error) {
      if (error instanceof ConflictException) {
        const response = error.getResponse();
        const priorId = typeof response === 'object' && response !== null &&
          'analysisJobId' in response ? response.analysisJobId : null;
        if (typeof priorId === 'string') return { analysisStarted: true, analysisJobId: priorId };
      }
      // The manuscript transaction owns retry and error sanitization.
      throw error;
    }
  }
  async get(userId: string, id: string, cursor?: string, view?: 'semantic' | 'structural') {
    const job = await this.repository.owned(userId, id);
    const semantic = job.pipeline === SEMANTIC_PIPELINE;
    const provenance = view === 'semantic' ? 'semantic_candidate' : undefined;
    const anchor = cursor ? await this.db.storyAnalysisEvidence.findFirst({ where: { id: cursor, analysisJobId: id,
      ...(provenance ? { provenance } : view === 'structural' ? { provenance: { in: ['structural_only', 'structural_legacy'] } } : {}) },
      select: { id: true, sequence: true } }) : null;
    if (cursor && (!anchor || (semantic && anchor.sequence === null))) throw new BadRequestException({ code: 'ANALYSIS_CURSOR_INVALID' });
    const filter = provenance ? { provenance } : view === 'structural' ? { provenance: { in: ['structural_only', 'structural_legacy'] } } : {};
    const evidence = await this.db.storyAnalysisEvidence.findMany({
      where: { analysisJobId: id, ...filter, ...(anchor ? semantic ? { sequence: { gt: anchor.sequence! } } : { id: { gt: anchor.id } } : {}) },
      orderBy: semantic ? [{ sequence: 'asc' }, { id: 'asc' }] : { id: 'asc' }, take: 101,
    });
    const totalCount = view ? await this.db.storyAnalysisEvidence.count({ where: { analysisJobId: id, ...filter } })
      : safeCount(jsonRecord(job.result).evidenceCount);
    const page = evidence.slice(0, 100);
    return {
      job: this.project(job), view: view ?? 'all', totalCount, evidence: page.map(row => ({ id: row.id, evidenceType: row.evidenceType,
        sourcePartKey: row.sourcePartKey, sourceParagraphIndex: row.sourceParagraphIndex,
        provenance: row.provenance, sourceLocale: job.sourceLocale, reviewRequired: true,
        ...(row.provenance === 'semantic_candidate' ? {
          title: semanticPlainText(jsonRecord(row.payload).title, 120),
          observation: semanticPlainText(jsonRecord(row.payload).observation, 1200),
          interpretation: 'model_inference', factualTruthApproved: false,
          citations: citationProjection(jsonRecord(row.payload).citations),
          styleCategory: STYLE_CATEGORIES.includes(jsonRecord(row.payload).styleCategory as never)
            ? jsonRecord(row.payload).styleCategory : null,
        } : {}),
      })),
      bounded: true, hasMore: evidence.length > 100,
      nextCursor: evidence.length > 100 ? page[page.length - 1].id : null,
      endCursor: page.length ? page[page.length - 1].id : cursor ?? null,
      review: { status: 'not_approved', fullyReviewed: false, publicationApproved: false, memoryApproved: false },
    };
  }
  async citation(userId: string, jobId: string, evidenceId: string) {
    const job = await this.repository.owned(userId, jobId);
    const evidence = await this.db.storyAnalysisEvidence.findFirst({ where: { id: evidenceId, analysisJobId: job.id,
      provenance: 'semantic_candidate' } });
    if (!evidence) throw new NotFoundException('Analysis evidence not found');
    const manuscript = await this.db.storyManuscriptVersion.findUniqueOrThrow({ where: { id: job.manuscriptVersionId } });
    if (manuscript.contentHash !== job.sourceContentHash || manuscriptContentHash(manuscript.structuredBody) !== job.sourceDigest)
      throw new SemanticAnalysisError('analysis_source_changed');
    const parts = sourceParts(manuscript.structuredBody);
    const citations = citationProjection(jsonRecord(evidence.payload).citations);
    if (!citations.length) throw new SemanticAnalysisError('analysis_citation_invalid');
    return { evidenceId, manuscriptVersionId: job.manuscriptVersionId, sourceLocale: job.sourceLocale,
      citations: citations.map(ref => {
        const piece = pieceFor(parts, ref);
        if (piece.text.length > 512 || sha256(piece.text) !== ref.quoteHash) throw new SemanticAnalysisError('analysis_citation_invalid');
        return { ...ref, quote: piece.text };
      }), reviewRequired: true };
  }
  project(job: StoryAnalysisJob) {
    const result = jsonRecord(job.result);
    const counts = jsonRecord(result.counts);
    return {
      id: job.id, manuscriptVersionId: job.manuscriptVersionId, analysisVersion: job.analysisVersion,
      status: job.status, kind: job.pipeline, sourceLocale: job.sourceLocale,
      sourceContentHash: job.sourceContentHash, phase: job.phase,
      semanticCompleted: job.pipeline === SEMANTIC_PIPELINE && job.status === 'completed',
      counts: Object.fromEntries(Object.entries(counts).filter(([key, value]) =>
        ['scene','beat','dialogue','background','cast','time','place','branch_candidate','entity','event','foreshadow','payoff','style'].includes(key) && Number.isSafeInteger(value))),
      partCount: job.totalParts || safeCount(result.partCount), evidenceCount: safeCount(result.evidenceCount),
      discardedEvidenceCount: safeCount(result.discardedEvidenceCount),
      continuityEntryCount: safeCount(result.continuityEntryCount), criticalIssueCount: safeCount(result.criticalIssueCount),
      warningIssueCount: safeCount(result.warningIssueCount),
      progress: { totalParagraphs: job.totalParagraphs, plannedParagraphs: job.plannedParagraphs,
        completedParagraphs: job.completedParagraphs, plannedChunks: job.plannedChunks, completedChunks: job.completedChunks,
        coverageComplete: job.pipeline === SEMANTIC_PIPELINE && job.status === 'completed' && job.completedParagraphs === job.totalParagraphs },
      styleCandidates: Object.fromEntries(Object.entries(jsonRecord(result.styleCounts))
        .filter(([key, count]) => STYLE_CATEGORIES.includes(key as never) && typeof count === 'number' && count >= 0 && Number.isSafeInteger(count))),
      approval: 'not_approved', memoryApproved: false,
      profileRecovery: { available: profileRecoveryCandidate(job), mode: 'local_settings_only' },
      budget: { reservedInputTokens: job.reservedInputTokens, reservedOutputTokens: job.reservedOutputTokens,
        reservedCostKrw: job.reservedCostKrw?.toString() ?? null, actualCostKrw: job.actualCostKrw?.toString() ?? null,
        usageUnobserved: job.errorCode === 'provider_outcome_unknown' || result.usageUnobserved === true },
      errorCode: job.errorCode, startedAt: job.startedAt, completedAt: job.completedAt,
    };
  }

  async executeOne(_workerId: string, signal = new AbortController().signal): Promise<{ status: string }> {
    if (!(await this.provider.readiness()).enabled) return { status: 'disabled' };
    if (signal.aborted) return { status: 'idle' };
    const job = await this.repository.claim();
    if (!job) return { status: 'idle' };
    let chunk: StoryAnalysisChunk | null = null;
    try {
      chunk = await this.db.storyAnalysisChunk.findFirst({ where: { analysisJobId: job.id,
        dispatchStartedAt: { not: null }, status: { not: 'completed' } }, orderBy: { ordinal: 'asc' } });
      if (chunk) throw new SemanticAnalysisError('provider_outcome_unknown', 'unknown');
      assertSemanticJobPins(this.provider.config, job.configPins as unknown as SemanticPins, job.configHash);
      const parts = await this.source(job);
      if (signal.aborted) { await this.repository.leased(job, async () => undefined); return { status: 'idle' }; }
      if (job.phase === 'initializing') {
        const total = parts.reduce((sum, part) => sum + part.paragraphs.length, 0);
        if (!total) throw new SemanticAnalysisError('analysis_source_empty');
        await this.repository.leased(job, tx => tx.storyAnalysisJob.update({ where: { id: job.id }, data: {
          sourceDigest: this.cache!.digest, totalParagraphs: total, totalParts: parts.length, phase: 'planning',
        } }));
      } else if (job.phase === 'planning') await this.plan(job, parts);
      else if (job.phase === 'extracting') {
        chunk = await this.db.storyAnalysisChunk.findFirst({ where: { analysisJobId: job.id, status: { not: 'completed' } }, orderBy: { ordinal: 'asc' } });
        if (!chunk) {
          if (job.completedChunks !== job.plannedChunks || job.completedParagraphs !== job.totalParagraphs)
            throw new SemanticAnalysisError('analysis_coverage_incomplete');
          await this.repository.leased(job, async tx => {
            const coverage = await tx.storyAnalysisChunk.aggregate({ where: { analysisJobId: job.id, status: 'completed' },
              _count: true, _min: { ordinal: true }, _max: { ordinal: true }, _sum: { paragraphCount: true, inputTokenBudget: true } });
            if (coverage._count !== job.plannedChunks || coverage._min.ordinal !== 0 ||
              coverage._max.ordinal !== job.plannedChunks - 1 || coverage._sum.paragraphCount !== job.totalParagraphs ||
              coverage._sum.inputTokenBudget !== job.reservedInputTokens) throw new SemanticAnalysisError('analysis_coverage_incomplete');
            await tx.storyAnalysisJob.update({ where: { id: job.id }, data: { phase: 'finalizing' } });
          });
        } else {
          if (chunk.dispatchStartedAt) throw new SemanticAnalysisError('provider_outcome_unknown', 'unknown');
          const input = this.input(job, parts, chunk);
          this.provider.preflight(input);
          if (signal.aborted) { await this.repository.leased(job, async () => undefined); return { status: 'idle' }; }
          await this.repository.leased(job, async tx => {
            const pins = job.configPins as unknown as SemanticPins;
            this.assertReservation(job, pins);
            await this.repository.assertRateCard(tx, pins);
            const fenced = await tx.storyAnalysisChunk.updateMany({ where: { id: chunk!.id, analysisJobId: job.id,
              status: 'queued', dispatchStartedAt: null }, data: { dispatchStartedAt: new Date(), status: 'running' } });
            if (fenced.count !== 1) throw new SemanticAnalysisError('analysis_dispatch_conflict');
          }, false);
          const result = await this.provider.generate(input, signal);
          if (result.usage.inputTokens > chunk.inputTokenBudget || result.usage.outputTokens > this.provider.config.outputTokenLimit)
            throw new SemanticAnalysisError('analysis_usage_exceeds_reservation', 'received', result.usage);
          await this.completeChunk(job, chunk, parts, result);
        }
      } else if (job.phase === 'finalizing') await this.finalize(job);
      else throw new SemanticAnalysisError('analysis_phase_invalid');
      return { status: 'processed' };
    } catch (error) {
      const safe = error instanceof SemanticAnalysisError ? error : new SemanticAnalysisError('analysis_local_failure');
      if (safe.code === 'analysis_profile_draft_unavailable') {
        try {
          const attempts = safeCount(jsonRecord(job.result).profileDraftAttempts) + 1;
          const exhausted = attempts >= 3;
          await this.repository.leased(job, tx => tx.storyAnalysisJob.update({ where: { id: job.id }, data: {
            result: { ...jsonRecord(job.result), profileDraftAttempts: attempts },
            ...(exhausted ? { status: 'failed', errorCode: safe.code, completedAt: new Date(), actualCostKrw: null } : {}),
          } }));
          return { status: exhausted ? 'failed' : 'retry_wait' };
        } catch { return { status: 'failed' }; }
      }
      // Persistence may fail after paid generation. The durable fence remains and
      // a later lease holder terminates unknown; it never repeats the provider call.
      try {
        await this.repository.leased(job, async tx => {
          const current = chunk ? await tx.storyAnalysisChunk.findUnique({ where: { id: chunk.id } }) : null;
          if (current?.dispatchStartedAt && safe.outcome === 'not_dispatched' && safe.code === 'analysis_cancelled') {
            await tx.storyAnalysisChunk.update({ where: { id: current.id }, data: { dispatchStartedAt: null, status: 'queued' } });
            return;
          }
          const unknown = Boolean(current?.dispatchStartedAt && (safe.outcome === 'unknown' || safe.code === 'analysis_local_failure'));
          const code = unknown ? 'provider_outcome_unknown' : safe.code;
          if (current) await tx.storyAnalysisChunk.update({ where: { id: current.id }, data: {
            status: 'failed', errorCode: code, ...this.usage(job, safe.usage),
          } });
          await tx.storyAnalysisJob.update({ where: { id: job.id }, data: {
            status: 'failed', errorCode: code, completedAt: new Date(), actualCostKrw: null,
            result: { ...jsonRecord(job.result), usageUnobserved: Boolean(current?.dispatchStartedAt && !safe.usage && safe.outcome !== 'known_rejected') },
            ...(safe.usage ? { observedCostKrw: { increment: this.usage(job, safe.usage).actualCostKrw! } } : {}),
          } });
        });
      } catch { /* No source, transport, or Prisma exception text is logged. */ }
      return { status: 'failed' };
    }
  }

  private async source(job: StoryAnalysisJob) {
    const owned = await this.db.storyWork.findFirst({ where: { id: job.workId, ownerUserId: job.actorUserId! }, select: { id: true } });
    if (!owned) throw new SemanticAnalysisError('analysis_owner_changed');
    if (this.cache?.jobId === job.id) return this.cache.parts;
    const manuscript = await this.db.storyManuscriptVersion.findUniqueOrThrow({ where: { id: job.manuscriptVersionId } });
    if (manuscript.workId !== job.workId || manuscript.ownerUserId !== job.actorUserId ||
      manuscript.contentHash !== job.sourceContentHash || manuscript.locale !== job.sourceLocale || !STORY_LOCALES.includes(manuscript.locale as never))
      throw new SemanticAnalysisError('analysis_source_changed');
    const parts = sourceParts(manuscript.structuredBody);
    const body = jsonRecord(manuscript.structuredBody), intake = jsonRecord(body.intake), raw = jsonRecord(intake.source);
    if (intake.identityVersion !== undefined && ![1, 2, 3, 4].includes(intake.identityVersion as number))
      throw new SemanticAnalysisError('analysis_source_identity_unsupported');
    const expected = intake.identityVersion === 3 || intake.identityVersion === 4
      ? streamedManuscriptHash({ identityVersion: intake.identityVersion, locale: manuscript.locale, parts, sourceSha256: raw.sha256 })
      : intake.identityVersion === 2 ? streamedManuscriptHash({ identityVersion: 2, locale: manuscript.locale, parts })
      : streamedManuscriptHash({ parts });
    if (expected !== manuscript.contentHash || (typeof raw.rawText === 'string' && sha256(raw.rawText) !== raw.sha256))
      throw new SemanticAnalysisError('analysis_source_checksum_invalid');
    const digest = streamedManuscriptHash(manuscript.structuredBody);
    if (job.phase !== 'initializing' && digest !== job.sourceDigest) throw new SemanticAnalysisError('analysis_source_changed');
    this.cache = { jobId: job.id, parts, digest };
    return parts;
  }
  private async plan(job: StoryAnalysisJob, parts: ManuscriptPart[]) {
    const pins = job.configPins as unknown as SemanticPins;
    let cursor = job.planCursor as unknown as SourceCursor;
    const rows: Prisma.StoryAnalysisChunkCreateManyInput[] = [];
    let input = job.reservedInputTokens, output = job.reservedOutputTokens, paragraphs = job.plannedParagraphs, done = false;
    for (let i = 0; i < 8; i++) {
      const next = nextSourceChunk(parts, cursor, { manuscriptVersionId: job.manuscriptVersionId,
        contentHash: job.sourceContentHash!, locale: job.sourceLocale! }, pins);
      if (!next) { done = true; break; }
      // Check local persistence density while the whole book is still planning,
      // before any paid dispatch can occur.
      this.structuralEvidence(parts, next.refs);
      input += next.inputTokens; output += pins.outputTokenLimit; paragraphs += next.completedParagraphs;
      rows.push({ analysisJobId: job.id, ordinal: job.plannedChunks + rows.length, sourceRefs: next.refs,
        sourceHash: next.sourceHash, paragraphCount: next.completedParagraphs, inputTokenBudget: next.inputTokens });
      cursor = next.next;
      if (next.done) { done = true; break; }
    }
    const cost = semanticReservation(pins, input, output, job.plannedChunks + rows.length);
    if (input > pins.maxJobInputTokens || output > pins.maxJobOutputTokens || cost.gt(pins.maxJobCostKrw))
      throw new SemanticAnalysisError('analysis_aggregate_budget_exceeded');
    if (done && paragraphs !== job.totalParagraphs) throw new SemanticAnalysisError('analysis_coverage_incomplete');
    await this.repository.leased(job, async tx => {
      if (rows.length) await tx.storyAnalysisChunk.createMany({ data: rows });
      await tx.storyAnalysisJob.update({ where: { id: job.id }, data: {
        planCursor: cursor, plannedChunks: { increment: rows.length }, plannedParagraphs: paragraphs,
        reservedInputTokens: input, reservedOutputTokens: output, reservedCostKrw: cost,
        phase: done ? 'extracting' : 'planning',
      } });
    });
  }
  private input(job: StoryAnalysisJob, parts: ManuscriptPart[], chunk: StoryAnalysisChunk): SemanticInput {
    const pieces = (chunk.sourceRefs as unknown as SourceRef[]).map(ref => pieceFor(parts, ref));
    if (manuscriptContentHash(pieces) !== chunk.sourceHash) throw new SemanticAnalysisError('analysis_chunk_checksum_invalid');
    return { manuscriptVersionId: job.manuscriptVersionId, contentHash: job.sourceContentHash!, locale: job.sourceLocale!, pieces };
  }
  private assertReservation(job: StoryAnalysisJob, pins: SemanticPins) {
    if (job.plannedChunks < 1 || job.plannedParagraphs !== job.totalParagraphs || job.phase !== 'extracting' ||
      job.reservedInputTokens > pins.maxJobInputTokens || job.reservedOutputTokens > pins.maxJobOutputTokens ||
      job.reservedOutputTokens !== job.plannedChunks * pins.outputTokenLimit || job.reservedCostKrw.gt(pins.maxJobCostKrw) ||
      !job.reservedCostKrw.equals(semanticReservation(pins, job.reservedInputTokens, job.reservedOutputTokens, job.plannedChunks)))
      throw new SemanticAnalysisError('analysis_reservation_invalid');
  }
  private usage(job: StoryAnalysisJob, usage?: SemanticUsage): Partial<SemanticUsage> & { actualCostKrw?: Decimal } {
    return usage ? { ...usage, actualCostKrw: semanticCost(job.configPins as unknown as SemanticPins,
      usage.inputTokens, usage.outputTokens, usage.cachedInputTokens).toDecimalPlaces(6, Decimal.ROUND_CEIL) } : {};
  }

  private async completeChunk(job: StoryAnalysisJob, chunk: StoryAnalysisChunk, parts: ManuscriptPart[], response: SemanticResult) {
    const refs = chunk.sourceRefs as unknown as SourceRef[];
    const structural = this.structuralEvidence(parts, refs).map(item => ({ ...item, id: randomUUID() }));
    const semantic: Prisma.StoryAnalysisEvidenceCreateManyInput[] = response.evidence.map(item => ({
      id: randomUUID(), analysisJobId: job.id, chunkId: chunk.id, provenance: 'semantic_candidate',
      evidenceType: item.kind, sourcePartKey: item.citations[0].partKey, sourceParagraphIndex: item.citations[0].paragraphIndex,
      payload: { title: item.title, observation: item.observation, interpretation: 'model_inference',
        citations: item.citations, styleCategory: item.styleCategory, sourceLocale: job.sourceLocale,
        manuscriptVersionId: job.manuscriptVersionId, contentHash: job.sourceContentHash, reviewRequired: true },
    }));
    const ledger = deriveContinuityLedger(structural);
    const entries = ledger.entries.map(entry => ({ id: stableId(`${job.id}:${entry.ledgerKey}`),
      workId: job.workId, analysisJobId: job.id, analysisVersion: job.analysisVersion,
      entryType: entry.entryType, ledgerKey: entry.ledgerKey, label: entry.label, evidenceIds: [], state: entry.state }));
    const result = jsonRecord(job.result), counts = { ...jsonRecord(result.counts) } as Record<string, number>;
    const styleCounts = { ...jsonRecord(result.styleCounts) } as Record<string, number>;
    for (const item of [...structural, ...semantic]) counts[item.evidenceType] = (counts[item.evidenceType] ?? 0) + 1;
    for (const item of response.evidence) if (item.kind === 'style') styleCounts[item.styleCategory!] = (styleCounts[item.styleCategory!] ?? 0) + 1;
    await this.repository.leased(job, async tx => {
      const rows: Prisma.StoryAnalysisEvidenceCreateManyInput[] = [...structural.map(item => ({
        id: item.id, analysisJobId: job.id, chunkId: chunk.id, evidenceType: item.evidenceType,
        sourcePartKey: item.sourcePartKey, sourceParagraphIndex: item.sourceParagraphIndex, provenance: 'structural_only',
        payload: { ...(typeof item.payload.label === 'string' && ['entity','event','foreshadow','payoff'].includes(item.evidenceType)
          ? { label: item.payload.label } : {}), parser: 'tag_parser_v1', semanticApproval: false },
      })), ...semantic];
      rows.forEach((row, index) => { row.sequence = safeCount(result.evidenceCount) + index; });
      for (let i = 0; i < rows.length; i += 200) await tx.storyAnalysisEvidence.createMany({ data: rows.slice(i, i + 200) });
      if (entries.length) {
        await tx.storyContinuityEntry.createMany({ data: entries, skipDuplicates: true });
        await tx.storyContinuityEntryEvidence.createMany({ data: ledger.entries.flatMap((entry, index) =>
          entry.evidenceIds.map(evidenceId => ({ analysisJobId: job.id, analysisVersion: job.analysisVersion,
            entryId: entries[index].id, evidenceId }))), skipDuplicates: true });
        await tx.storyContinuityPathState.createMany({ data: entries.map(entry => ({ workId: job.workId,
          analysisJobId: job.id, analysisVersion: job.analysisVersion, entryId: entry.id, pathScope: 'author_original',
          pathKey: 'author_original', state: entry.state })), skipDuplicates: true });
      }
      await tx.storyAnalysisChunk.update({ where: { id: chunk.id }, data: {
        status: 'completed', completedAt: new Date(), ...this.usage(job, response.usage),
      } });
      await tx.storyAnalysisJob.update({ where: { id: job.id }, data: {
        completedChunks: { increment: 1 }, completedParagraphs: { increment: chunk.paragraphCount },
        observedCostKrw: { increment: this.usage(job, response.usage).actualCostKrw! },
        result: { ...result, counts, styleCounts, evidenceCount: safeCount(result.evidenceCount) + rows.length,
          discardedEvidenceCount: safeCount(result.discardedEvidenceCount) + (response.discardedEvidenceCount ?? 0) },
      } });
    });
  }

  private structuralEvidence(parts: ManuscriptPart[], refs: SourceRef[]) {
    const evidence = refs.filter(ref => ref.end === parts[ref.partIndex].paragraphs[ref.paragraphIndex].text.length)
      .flatMap(ref => analyzeStructuredManuscript([{ ...parts[ref.partIndex], paragraphs: [parts[ref.partIndex].paragraphs[ref.paragraphIndex]] }]).evidence
        .map(item => ({ ...item, sourceParagraphIndex: ref.paragraphIndex })));
    if (evidence.length > 2000) throw new SemanticAnalysisError('analysis_structural_density_exceeded');
    return evidence;
  }

  private async finalize(job: StoryAnalysisJob) {
    const entries = await this.db.storyContinuityEntry.findMany({ where: { analysisJobId: job.id,
      entryType: { in: ['foreshadow','payoff'] }, ...(job.finalCursor ? { id: { gt: job.finalCursor } } : {}) }, orderBy: { id: 'asc' }, take: 100 });
    if (!entries.length) {
      const count = await this.db.storyContinuityEntry.count({ where: { analysisJobId: job.id } });
      try {
        await this.repository.leased(job, async tx => {
          await this.generationProfiles.createDraftAtCompletion(tx, job);
          await tx.storyAnalysisJob.update({ where: { id: job.id }, data: {
            status: 'completed', phase: 'completed', completedAt: new Date(), actualCostKrw: job.observedCostKrw,
            result: { ...jsonRecord(job.result), continuityEntryCount: count },
          } });
        });
        if (job.actorUserId) await this.finalizeCompanySubmission(job.actorUserId, job.workId, job.manuscriptVersionId, job.id);
      } catch (error) {
        if (error instanceof SemanticAnalysisError && error.code === 'analysis_lease_lost') throw error;
        throw new SemanticAnalysisError('analysis_profile_draft_unavailable');
      }
      this.cache = undefined;
      return;
    }
    const counterpart = (entry: typeof entries[number]) => `${entry.entryType === 'payoff' ? 'foreshadow' : 'payoff'}:${entry.ledgerKey.split(':').slice(1).join(':')}`;
    const others = await this.db.storyContinuityEntry.findMany({ where: { analysisJobId: job.id,
      ledgerKey: { in: entries.map(counterpart) } }, select: { ledgerKey: true } });
    const found = new Set(others.map(entry => entry.ledgerKey));
    const missing = entries.filter(entry => !found.has(counterpart(entry)));
    const links = missing.length ? await this.db.$queryRaw<Array<{ entry_id: string; evidence_id: string }>>`
      SELECT entry_id,evidence_id FROM (
        SELECT entry_id,evidence_id,row_number() OVER (PARTITION BY entry_id ORDER BY evidence_id) AS rank
        FROM story_continuity_entry_evidence WHERE analysis_job_id=${job.id}::uuid
          AND entry_id IN (${Prisma.join(missing.map(entry => Prisma.sql`${entry.id}::uuid`))})
      ) page WHERE rank<=4
    ` : [];
    const issues = missing.map(entry => ({ id: stableId(`${job.id}:issue:${entry.ledgerKey}`), workId: job.workId,
      analysisJobId: job.id, analysisVersion: job.analysisVersion, pathScope: 'author_original', pathKey: 'author_original',
      issueKey: `${entry.entryType === 'foreshadow' ? 'missing-payoff' : 'orphan-payoff'}:${entry.ledgerKey.split(':').slice(1).join(':')}`,
      severity: entry.entryType === 'foreshadow' ? 'critical' : 'warning',
      summary: `Structural tag requires author review: ${entry.label}`, evidenceIds: links.filter(link => link.entry_id === entry.id).map(link => link.evidence_id),
    }));
    await this.repository.leased(job, async tx => {
      if (issues.length) {
        await tx.storyContinuityIssue.createMany({ data: issues, skipDuplicates: true });
        await tx.storyContinuityIssueEvidence.createMany({ data: issues.flatMap(issue => issue.evidenceIds.map(evidenceId => ({
          analysisJobId: job.id, analysisVersion: job.analysisVersion, issueId: issue.id, evidenceId }))), skipDuplicates: true });
      }
      const result = jsonRecord(job.result);
      await tx.storyAnalysisJob.update({ where: { id: job.id }, data: { finalCursor: entries[entries.length - 1].id,
        result: { ...result, criticalIssueCount: safeCount(result.criticalIssueCount) + issues.filter(issue => issue.severity === 'critical').length,
          warningIssueCount: safeCount(result.warningIssueCount) + issues.filter(issue => issue.severity === 'warning').length },
      } });
    });
  }

  private async finalizeCompanySubmission(ownerUserId: string, workId: string, manuscriptVersionId: string, analysisJobId: string) {
    try {
      await this.generationProfiles.autoApproveCompany(ownerUserId, workId, { manuscriptVersionId, analysisJobId });
    } catch (error) {
      this.logger.warn(`Company story profile remains in review: ${error instanceof Error ? error.name : 'unknown error'}`);
      return;
    }
    if (!this.companySubmission) return;
    try {
      await this.companySubmission.autoSubmitCompletedAnalysis(ownerUserId, workId, manuscriptVersionId, analysisJobId);
    } catch (error) {
      // Completed extraction is retained; the normal review POST can reconcile without another paid request.
      this.logger.warn(`Company manuscript submission needs review reconciliation: ${error instanceof Error ? error.name : 'unknown error'}`);
    }
  }
}
function profileRecoveryCandidate(job: StoryAnalysisJob) {
  return job.pipeline === SEMANTIC_PIPELINE && job.status === 'failed' && job.phase === 'finalizing' &&
    job.errorCode === 'analysis_profile_draft_unavailable' && job.totalParagraphs > 0 &&
    job.completedParagraphs === job.totalParagraphs && job.plannedParagraphs === job.totalParagraphs &&
    job.plannedChunks > 0 && job.completedChunks === job.plannedChunks &&
    jsonRecord(job.result).usageUnobserved !== true;
}
function jsonRecord(value: unknown): Record<string, Prisma.JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
}
function safeCount(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function citationProjection(value: unknown): Array<SourceRef & { quoteHash: string }> {
  if (!Array.isArray(value) || value.length > 4) return [];
  return value.flatMap(item => {
    const ref = jsonRecord(item);
    if (typeof ref.partKey !== 'string' || ref.partKey.length > 120 || typeof ref.quoteHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(ref.quoteHash) ||
      ![ref.partIndex, ref.paragraphIndex, ref.start, ref.end].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return [];
    return [{ partIndex: Number(ref.partIndex), partKey: ref.partKey, paragraphIndex: Number(ref.paragraphIndex),
      start: Number(ref.start), end: Number(ref.end), quoteHash: ref.quoteHash }];
  });
}
function stableId(key: string) { const hash = sha256(key); return `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`; }

export function streamedManuscriptHash(value: unknown): string {
  // Match manuscriptContentHash's sorted JSON bytes without retaining a full serialized manuscript.
  const hash = createHash('sha256');
  const write = (item: unknown): void => {
    if (typeof item === 'string') {
      hash.update('"');
      for (let start = 0; start < item.length;) {
        let end = Math.min(start + 4096, item.length);
        if (end < item.length && item.charCodeAt(end - 1) >= 0xd800 && item.charCodeAt(end - 1) <= 0xdbff &&
          item.charCodeAt(end) >= 0xdc00 && item.charCodeAt(end) <= 0xdfff) end--;
        hash.update(JSON.stringify(item.slice(start, end)).slice(1, -1));
        start = end;
      }
      hash.update('"');
    } else if (Array.isArray(item)) {
      hash.update('[');
      item.forEach((entry, index) => { if (index) hash.update(','); write(entry); });
      hash.update(']');
    } else if (item && typeof item === 'object') {
      hash.update('{');
      Object.keys(item).sort().forEach((key, index) => {
        if (index) hash.update(',');
        write(key);
        hash.update(':');
        write((item as Record<string, unknown>)[key]);
      });
      hash.update('}');
    } else {
      hash.update(JSON.stringify(item) ?? 'undefined');
    }
  };
  write(value);
  return hash.digest('hex');
}
