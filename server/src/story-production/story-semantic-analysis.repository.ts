import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, type StoryAnalysisJob } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SEMANTIC_PACKING_PROFILE, semanticPinHash, semanticPins, type SemanticConfig, type SemanticPins } from './story-semantic-analysis.config';
import { sha256 } from './story-semantic-analysis.source';
import { SEMANTIC_PIPELINE, SemanticAnalysisError } from './story-semantic-analysis.types';

@Injectable()
export class SemanticAnalysisRepository {
  constructor(readonly prisma: PrismaService) {}

  async enqueue(userId: string, manuscriptId: string, key: string | undefined, config: SemanticConfig, disabledReason?: string) {
    if (!key?.trim() || key.trim().length < 8 || key.trim().length > 200)
      throw new BadRequestException({ code: 'ANALYSIS_IDEMPOTENCY_REQUIRED' });
    const idempotencyKey = `semantic:${sha256(`${userId}:${key.trim()}`)}`;
    try {
      return await this.prisma.$transaction(async tx => {
        // Serialize a caller's key across works as well as each work's version.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKey},0))`;
        const manuscript = await tx.storyManuscriptVersion.findFirst({
          where: { id: manuscriptId, ownerUserId: userId },
          select: { id: true, workId: true, ownerUserId: true, contentHash: true, locale: true },
        });
        if (!manuscript) throw new NotFoundException('Manuscript version not found');
        const owned = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM story_works WHERE id=${manuscript.workId}::uuid
            AND owner_user_id=${userId}::uuid FOR UPDATE
        `;
        if (!owned.length) throw new NotFoundException('Manuscript version not found');
        await tx.$queryRaw`SELECT id FROM story_manuscript_versions WHERE id=${manuscriptId}::uuid FOR SHARE`;
        const current = await tx.storyManuscriptVersion.findUniqueOrThrow({ where: { id: manuscriptId },
          select: { workId: true, ownerUserId: true, contentHash: true, locale: true } });
        if (current.workId !== manuscript.workId || current.ownerUserId !== userId || current.contentHash !== manuscript.contentHash || current.locale !== manuscript.locale)
          throw new ConflictException({ code: 'ANALYSIS_SOURCE_CHANGED' });
        const existing = await tx.storyAnalysisJob.findUnique({ where: { idempotencyKey } });
        if (existing) {
          if (existing.actorUserId !== userId || existing.workId !== manuscript.workId || existing.manuscriptVersionId !== manuscriptId)
            throw new ConflictException({ code: 'ANALYSIS_IDEMPOTENCY_CONFLICT' });
          return existing;
        }
        const prior = await tx.storyAnalysisJob.findFirst({ where: { manuscriptVersionId: manuscriptId, pipeline: SEMANTIC_PIPELINE } });
        if (prior) throw new ConflictException({ code: 'ANALYSIS_VERSION_ALREADY_RESERVED', analysisJobId: prior.id });
        if (disabledReason) throw new ServiceUnavailableException({ code: 'SEMANTIC_ANALYSIS_UNAVAILABLE', reason: disabledReason });
        await this.assertRateCard(tx, config);
        const latest = await tx.storyAnalysisJob.findFirst({ where: { manuscriptVersionId: manuscriptId },
          orderBy: { analysisVersion: 'desc' }, select: { analysisVersion: true } });
        const pins = semanticPins({ ...config, packingProfile: SEMANTIC_PACKING_PROFILE });
        return tx.storyAnalysisJob.create({ data: {
          workId: manuscript.workId, manuscriptVersionId: manuscriptId, actorUserId: userId,
          analysisVersion: (latest?.analysisVersion ?? 0) + 1, idempotencyKey,
          pipeline: SEMANTIC_PIPELINE, phase: 'initializing', status: 'queued',
          sourceContentHash: manuscript.contentHash, sourceLocale: manuscript.locale, sourceDigest: manuscript.contentHash,
          rateCardId: config.rateCardId, configPins: pins, configHash: semanticPinHash(pins),
        } });
      }, { timeout: 5000 });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException ||
        error instanceof NotFoundException || error instanceof ServiceUnavailableException) throw error;
      if (error instanceof SemanticAnalysisError) throw new ServiceUnavailableException({
        code: 'SEMANTIC_ANALYSIS_UNAVAILABLE', reason: error.code,
      });
      // Never forward Prisma messages that may embed source JSON or private keys.
      throw new ServiceUnavailableException({ code: 'ANALYSIS_QUEUE_RETRY' });
    }
  }

  async owned(userId: string, id: string) {
    const job = await this.prisma.storyAnalysisJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Analysis job not found');
    const manuscript = await this.prisma.storyManuscriptVersion.findFirst({
      where: { id: job.manuscriptVersionId, ownerUserId: userId, workId: job.workId }, select: { id: true },
    });
    const work = await this.prisma.storyWork.findFirst({ where: { id: job.workId, ownerUserId: userId }, select: { id: true } });
    if (!manuscript || !work || (job.actorUserId && job.actorUserId !== userId)) throw new NotFoundException('Analysis job not found');
    return job;
  }

  async claim(): Promise<StoryAnalysisJob | null> {
    const token = randomUUID();
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      WITH next AS (
        SELECT id FROM story_analysis_jobs
        WHERE pipeline=${SEMANTIC_PIPELINE} AND status IN ('queued','running')
          AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
        ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE story_analysis_jobs j SET lease_token=${token},
        lease_expires_at=clock_timestamp()+interval '120 seconds', status='running',
        started_at=COALESCE(started_at,clock_timestamp()) FROM next WHERE j.id=next.id RETURNING j.id
    `;
    return rows.length ? this.prisma.storyAnalysisJob.findUniqueOrThrow({ where: { id: rows[0].id } }) : null;
  }

  async assertRateCard(tx: Prisma.TransactionClient, pins: SemanticPins) {
    await tx.$queryRaw`SELECT id FROM story_ai_rate_cards WHERE id=${pins.rateCardId}::uuid FOR SHARE`;
    const card = await tx.storyAiRateCard.findUnique({ where: { id: pins.rateCardId } });
    if (!card || card.provider !== pins.provider || card.model !== pins.model || card.version !== pins.rateCardVersion ||
      card.currencyCode !== 'KRW' || card.status !== 'active' || card.retiredAt ||
      (card.effectiveAt && card.effectiveAt > new Date()) ||
      !card.inputCostPerMillion.equals(pins.inputKrwPerMillion) ||
      !card.cachedInputCostPerMillion.equals(pins.cachedInputKrwPerMillion) ||
      !card.outputCostPerMillion.equals(pins.outputKrwPerMillion)) throw new SemanticAnalysisError('analysis_rate_card_mismatch');
  }

  async leased<T>(job: Pick<StoryAnalysisJob, 'id' | 'leaseToken'>, run: (tx: Prisma.TransactionClient) => Promise<T>, release = true): Promise<T> {
    return this.prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM story_analysis_jobs WHERE id=${job.id}::uuid AND lease_token=${job.leaseToken}
          AND lease_expires_at>clock_timestamp() AND status='running' FOR UPDATE
      `;
      if (!locked.length) throw new SemanticAnalysisError('analysis_lease_lost');
      const result = await run(tx);
      // Check again at commit time, so a slow local unit cannot publish after expiry.
      const current = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM story_analysis_jobs WHERE id=${job.id}::uuid AND lease_token=${job.leaseToken}
          AND lease_expires_at>clock_timestamp()
      `;
      if (!current.length) throw new SemanticAnalysisError('analysis_lease_lost');
      if (release) await tx.storyAnalysisJob.update({ where: { id: job.id }, data: { leaseToken: null, leaseExpiresAt: null } });
      return result;
    }, { timeout: 5000 });
  }
}
