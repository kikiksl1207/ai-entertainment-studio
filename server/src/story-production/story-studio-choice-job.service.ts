import { BeforeApplicationShutdown, ConflictException, HttpException, Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';

const LEASE_MS = 5 * 60_000;
const POLL_MS = 3_000;
const DRAIN_MS = 120_000;
type JobResult = 'idle' | 'progress' | 'failed' | 'completed';

@Injectable()
export class StoryStudioChoiceJobService implements OnApplicationBootstrap, OnModuleDestroy, BeforeApplicationShutdown {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private active?: Promise<JobResult>;
  private shutdown?: Promise<void>;

  constructor(private readonly prisma: PrismaService,
    private readonly choices: StoryStudioChoicePreparationService) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED !== 'true') return;
    this.schedule(0);
  }

  onModuleDestroy(): Promise<void> {
    return this.shutdown ??= this.stopAndDrain();
  }

  beforeApplicationShutdown(): Promise<void> { return this.onModuleDestroy(); }

  private async stopAndDrain(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Preserve the current attempt's usage and storage outcome before Prisma disconnects.
      await Promise.race([
        this.active.then(() => undefined, () => undefined),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('studio_choice_worker_drain_timeout')), DRAIN_MS);
        }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }

  async retry(ownerUserId: string, workId: string, releaseId: string) {
    if (![workId, releaseId].every(id => isUUID(id))) throw new ConflictException({ code: 'STUDIO_CHOICES_INVALID_ID' });
    const work = await this.prisma.storyWork.findFirst({ where: { id: workId, ownerUserId,
      status: { not: 'published' }, activeReleaseId: null } });
    const release = await this.prisma.storyRelease.findFirst({ where: { id: releaseId, workId, status: 'candidate' } });
    if (!work || !release) throw new ConflictException({ code: 'STUDIO_CHOICES_PRIVATE_DRAFT_REQUIRED' });
    const changed = await this.prisma.storyStudioChoiceJob.updateMany({ where: {
      workId, releaseId, ownerUserId, manuscriptVersionId: release.manuscriptVersionId, status: 'failed',
    }, data: { status: 'queued', errorCode: null, leaseToken: null, leaseExpiresAt: null } });
    if (changed.count !== 1) throw new ConflictException({ code: 'STUDIO_CHOICES_RETRY_NOT_AVAILABLE' });
    if (process.env.NODE_ENV !== 'test' && process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED === 'true') {
      this.schedule(0);
    }
    return { releaseId, status: 'queued' };
  }

  executeOne(): Promise<JobResult> {
    if (this.stopped) return Promise.resolve('idle');
    if (this.active) return this.active;
    const pending = this.executeClaimedJob().finally(() => {
      if (this.active === pending) this.active = undefined;
    });
    this.active = pending;
    return pending;
  }

  private async executeClaimedJob(): Promise<JobResult> {
    const claimed = await this.claim();
    if (!claimed) return 'idle';
    const { id, leaseToken } = claimed;
    let verifiedCompletedParts: number | undefined;
    try {
      const job = await this.prisma.storyStudioChoiceJob.findUnique({ where: { id } });
      if (!job || job.leaseToken !== leaseToken || job.status !== 'processing' ||
          !job.leaseExpiresAt || job.leaseExpiresAt <= new Date()) return 'idle';
      const release = await this.prisma.storyRelease.findFirst({ where: {
        id: job.releaseId, workId: job.workId, manuscriptVersionId: job.manuscriptVersionId,
        status: 'candidate',
      } });
      if (!release) throw new ConflictException({ code: 'STUDIO_CHOICES_CANDIDATE_REQUIRED' });
      const parts = await this.prisma.storyPart.findMany({ where: { workId: job.workId,
        fixtureSource: false }, orderBy: { position: 'asc' }, select: { id: true } });
      if (parts.length !== job.totalParts) throw new ConflictException({ code: 'STUDIO_CHOICES_PART_COUNT_CHANGED' });
      const scenes = await this.prisma.storyScene.findMany({ where: { partId: { in: parts.map(part => part.id) },
        fixtureSource: false }, select: { id: true, partId: true } });
      if (scenes.length !== parts.length) throw new ConflictException({ code: 'STUDIO_CHOICES_SCENES_CHANGED' });
      const byPart = new Map(scenes.map(scene => [scene.partId, scene.id]));
      const ordered = parts.map(part => byPart.get(part.id));
      if (ordered.some(id => !id)) throw new ConflictException({ code: 'STUDIO_CHOICES_SCENES_CHANGED' });
      const choices = await this.prisma.storyChoice.findMany({ where: { sceneId: { in: ordered as string[] } },
        select: { sceneId: true } });
      const counts = new Map<string, number>();
      for (const choice of choices) counts.set(choice.sceneId, (counts.get(choice.sceneId) ?? 0) + 1);
      const complete = ordered.filter(sceneId => counts.get(sceneId!) === 3).length;
      if (ordered.some(sceneId => ![1, 3].includes(counts.get(sceneId!) ?? 0))) {
        throw new ConflictException({ code: 'STUDIO_CHOICES_PARTIAL_SET' });
      }
      verifiedCompletedParts = complete;
      const next = ordered.find(sceneId => counts.get(sceneId!) === 1);
      if (next) {
        // An expired attempt may already have reached the provider without a stored result.
        if (claimed.recovered) throw new ConflictException({ code: 'STUDIO_CHOICES_INTERRUPTED_RETRY_REQUIRED' });
        if (complete) {
          await this.prisma.$transaction(tx => this.choices.assertPreparedScenesTx(tx, job.workId,
            job.ownerUserId, job.manuscriptVersionId, job.releaseId,
            ordered.filter(sceneId => counts.get(sceneId!) === 3) as string[]),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 60000 });
        }
        await this.choices.prepare(job.ownerUserId, job.workId, job.releaseId, next, leaseToken);
        const stored = await this.prisma.storyStudioChoiceJob.updateMany({ where: { id, leaseToken,
          status: 'processing', leaseExpiresAt: { gt: new Date() } },
          data: { status: 'queued', completedParts: complete + 1, leaseToken: null, leaseExpiresAt: null } });
        if (stored.count !== 1) throw new ConflictException({ code: 'STUDIO_CHOICES_LEASE_CHANGED' });
        return 'progress';
      }
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM story_releases WHERE id = ${job.releaseId}::uuid FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM story_studio_choice_jobs WHERE id = ${id}::uuid FOR UPDATE`);
        const current = await tx.storyStudioChoiceJob.findUnique({ where: { id } });
        if (current?.leaseToken !== leaseToken || current.status !== 'processing' ||
            !current.leaseExpiresAt || current.leaseExpiresAt <= new Date()) {
          throw new ConflictException({ code: 'STUDIO_CHOICES_LEASE_CHANGED' });
        }
        await this.choices.assertPublishableTx(tx, job.workId, job.ownerUserId,
          job.manuscriptVersionId, job.releaseId);
        const completed = await tx.storyStudioChoiceJob.updateMany({ where: { id, leaseToken,
          status: 'processing', leaseExpiresAt: { gt: new Date() } }, data: {
          status: 'completed', completedParts: job.totalParts, leaseToken: null, leaseExpiresAt: null,
          errorCode: null,
        } });
        if (completed.count !== 1) throw new ConflictException({ code: 'STUDIO_CHOICES_LEASE_CHANGED' });
        await tx.storyRelease.update({ where: { id: job.releaseId }, data: {
          validationSummary: { ready: true, blockingIssueCount: 0,
            source: 'studio-reviewed-linear-choices-v1' },
        } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 60000 });
      return 'completed';
    } catch (error) {
      const response = error instanceof HttpException ? error.getResponse() : null;
      const code = response && typeof response === 'object' && 'code' in response &&
        typeof response.code === 'string' ? response.code : 'STUDIO_CHOICES_PREPARATION_FAILED';
      const failed = await this.prisma.storyStudioChoiceJob.updateMany({ where: { id, leaseToken, status: 'processing' },
        data: { status: 'failed', errorCode: code.slice(0, 120), leaseToken: null, leaseExpiresAt: null,
          ...(verifiedCompletedParts !== undefined ? { completedParts: verifiedCompletedParts } : {}) } });
      return failed.count === 1 ? 'failed' : 'idle';
    }
  }

  private async claim(): Promise<{ id: string; leaseToken: string; recovered: boolean } | null> {
    const leaseToken = randomUUID();
    const expiresAt = new Date(Date.now() + LEASE_MS);
    const rows = await this.prisma.$queryRaw<Array<{ id: string; previous_status: string }>>(Prisma.sql`
      WITH candidate AS (
        SELECT id, status FROM story_studio_choice_jobs
        WHERE status = 'queued' OR (status = 'processing' AND lease_expires_at < CURRENT_TIMESTAMP)
        ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE story_studio_choice_jobs AS job SET status = 'processing',
        lease_token = ${leaseToken}::uuid, lease_expires_at = ${expiresAt}, updated_at = CURRENT_TIMESTAMP
      FROM candidate WHERE job.id = candidate.id RETURNING job.id, candidate.status AS previous_status
    `);
    return rows[0] ? { id: rows[0].id, leaseToken, recovered: rows[0].previous_status === 'processing' } : null;
  }

  private schedule(delay: number) {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(async () => {
      this.timer = undefined;
      try {
        if (process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED === 'true' &&
            (process.env.STORY_CONTINUATION_OPENAI_API_KEY || process.env.OPENAI_API_KEY)) {
          await this.executeOne();
        }
      } catch { /* The lease expires after a process or database interruption. */ }
      this.schedule(POLL_MS);
    }, delay);
  }
}
