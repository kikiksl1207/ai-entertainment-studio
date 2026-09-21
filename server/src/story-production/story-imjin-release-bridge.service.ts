import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { ImportImjinReleaseDto } from './dto/story-lifecycle.dto';
import {
  ImjinReleasePlan,
  prepareImjinReleasePlan,
  projectImjinDryRun,
} from './story-imjin-release-bridge.policy';

type StoredIntake = {
  source?: { kind?: unknown; rawText?: unknown; sha256?: unknown; byteLength?: unknown };
};

@Injectable()
export class StoryImjinReleaseBridgeService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    actorUserId: string,
    workId: string,
    body: ImportImjinReleaseDto,
    idempotencyKey?: string,
  ) {
    const manuscript = await this.prisma.storyManuscriptVersion.findFirst({
      where: { id: body.manuscriptVersionId, workId },
      select: { id: true, structuredBody: true },
    });
    if (!manuscript) throw new NotFoundException('Manuscript version not found');
    const source = this.sourceFrom(manuscript.structuredBody);
    const plan = prepareImjinReleasePlan(Buffer.from(source.rawText, 'utf8'));
    const dryRun = projectImjinDryRun(plan);
    if (body.apply !== true) return dryRun;
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new ConflictException({ code: 'IMJIN_IMPORT_IDEMPOTENCY_REQUIRED', message: 'A bounded idempotency key is required' });
    }
    if (!body.releaseId || !body.expectedReleaseChecksum) {
      throw new ConflictException({ code: 'IMJIN_IMPORT_RELEASE_REQUIRED', message: 'A validated release binding is required' });
    }
    let applied: { releaseId: string; idempotentReplay: boolean };
    try {
      applied = await this.applyTransaction(
        actorUserId,
        workId,
        manuscript.id,
        body.releaseId,
        body.expectedReleaseChecksum,
        idempotencyKey,
        plan,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Prisma failures may contain submitted beat content. Replace them before
      // the global exception logger or response boundary can observe the error.
      throw new ServiceUnavailableException({
        code: 'IMJIN_IMPORT_TRANSACTION_FAILED',
        message: 'Import transaction failed and was rolled back',
      });
    }
    return { ...dryRun, mode: 'apply', applyExecuted: true, ...applied };
  }

  private sourceFrom(structuredBody: Prisma.JsonValue) {
    const body = structuredBody && typeof structuredBody === 'object' && !Array.isArray(structuredBody)
      ? structuredBody as Record<string, unknown>
      : null;
    const intake = body?.intake && typeof body.intake === 'object' && !Array.isArray(body.intake)
      ? body.intake as StoredIntake
      : null;
    const source = intake?.source;
    if (source?.kind !== 'utf8_paste' || typeof source.rawText !== 'string') {
      throw new ConflictException({ code: 'IMJIN_IMPORT_ACTUAL_PASTE_REQUIRED', message: 'Actual UTF-8 paste intake is required' });
    }
    return { rawText: source.rawText };
  }

  private async applyTransaction(
    actorUserId: string,
    workId: string,
    manuscriptVersionId: string,
    releaseId: string,
    expectedReleaseChecksum: string,
    idempotencyKey: string,
    plan: ImjinReleasePlan,
  ) {
    const keyHash = createHash('sha256').update(idempotencyKey).digest('hex');
    const payloadHash = createHash('sha256').update(JSON.stringify({
      workId, manuscriptVersionId, releaseId, expectedReleaseChecksum,
      sourceSha256: plan.source.sha256,
    })).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "story_works" WHERE "id" = ${workId}::uuid FOR UPDATE
      `);
      if (!locked.length) throw new NotFoundException('Story work not found');
      const [work, release, capability] = await Promise.all([
        tx.storyWork.findUnique({ where: { id: workId } }),
        tx.storyRelease.findFirst({ where: { id: releaseId, workId } }),
        tx.storyReleaseCapability.findUnique({ where: { releaseId } }),
      ]);
      if (!work || !release) throw new NotFoundException('Import release dependency not found');
      const previous = this.importMarker(release.diffSummary);
      if (previous) {
        if (previous.keyHash === keyHash && previous.payloadHash === payloadHash) {
          return { releaseId, idempotentReplay: true };
        }
        throw new ConflictException({ code: 'IMJIN_IMPORT_ALREADY_APPLIED', message: 'Release import binding already exists' });
      }
      const validation = this.record(release.validationSummary);
      if (
        work.status !== 'release_ready' || work.fixtureSource || !work.priceLumina.isZero() || work.customChoiceEnabled ||
        release.status !== 'candidate' || release.manuscriptVersionId !== manuscriptVersionId ||
        release.checksum !== expectedReleaseChecksum || validation?.ready !== true ||
        Number(validation.blockingIssueCount ?? 0) > 0
      ) {
        throw new ConflictException({ code: 'IMJIN_IMPORT_RELEASE_NOT_READY', message: 'Release publication conditions are not satisfied' });
      }
      if (!capability || capability.status !== 'active' || capability.fixedChoiceCount !== 3 || capability.customChoiceEnabled) {
        throw new ConflictException({ code: 'IMJIN_IMPORT_CAPABILITY_NOT_READY', message: 'Active fixed-choice capability is required' });
      }
      const rateCard = await tx.storyAiRateCard.findUnique({ where: { id: capability.rateCardId }, select: { status: true } });
      if (rateCard?.status !== 'active') {
        throw new ConflictException({ code: 'IMJIN_IMPORT_RATE_CARD_NOT_READY', message: 'Active release rate card is required' });
      }
      const analysis = await tx.storyAnalysisJob.findFirst({
        where: { workId, manuscriptVersionId, status: 'completed' },
        orderBy: { analysisVersion: 'desc' },
        select: { id: true },
      });
      if (!analysis) throw new ConflictException({ code: 'IMJIN_IMPORT_ANALYSIS_REQUIRED', message: 'Completed analysis is required' });
      const critical = await tx.storyContinuityIssue.count({
        where: { workId, analysisJobId: analysis.id, severity: 'critical', status: 'open', pathScope: 'author_original', pathKey: 'author_original' },
      });
      if (critical) throw new ConflictException({ code: 'IMJIN_IMPORT_CONTINUITY_BLOCKED', message: 'Unresolved author continuity blocks import' });
      if (await tx.storyPart.count({ where: { workId } })) {
        throw new ConflictException({ code: 'IMJIN_IMPORT_NONEMPTY_WORK', message: 'Import requires an empty production work' });
      }

      const partRows = plan.parts.map((part, index) => ({
        id: randomUUID(), workId, seasonKey: 'season-1', actNumber: Math.floor(index / 15) + 1,
        position: index + 1, status: 'published', title: { ko: part.title }, priceLumina: 0,
        fixtureSource: false, publishedAt: new Date(),
      }));
      const sceneRows = plan.parts.map((part, index) => ({
        id: randomUUID(), partId: partRows[index].id, sceneKey: part.sceneKey, position: 1,
        status: 'published', title: { ko: part.title }, fixtureSource: false,
        endingType: index === plan.parts.length - 1 ? 'writer_primary' : null,
        visualManifest: {
          sceneKey: part.sceneKey,
          background: { state: 'missing', altKey: 'story.scene.background' },
          characters: [],
          fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.scene.fallback' },
        },
      }));
      const sceneByPartKey = new Map(plan.parts.map((part, index) => [part.partKey, sceneRows[index].id]));
      await tx.storyPart.createMany({ data: partRows });
      await tx.storyScene.createMany({ data: sceneRows });
      await tx.storyBeat.createMany({ data: plan.parts.flatMap((part, partIndex) =>
        part.beats.map((content, beatIndex) => ({
          sceneId: sceneRows[partIndex].id, position: beatIndex + 1, beatType: 'narration', content: { ko: content },
        }))),
      });
      await tx.storyChoice.createMany({ data: plan.parts.flatMap((part, partIndex) =>
        part.choices.map((choice, choiceIndex) => ({
          sceneId: sceneRows[partIndex].id, choiceKey: choice.choiceKey, position: choiceIndex + 1,
          label: { ko: choice.label }, routeKind: choice.routeKind,
          targetSceneId: choice.targetPartKey ? sceneByPartKey.get(choice.targetPartKey) : null,
          targetEndingKey: choice.targetEndingKey,
        }))),
      });
      await tx.storyRelease.update({
        where: { id: release.id },
        data: { diffSummary: {
          ...this.record(release.diffSummary),
          importBridge: {
            contract: 'imjin-release-v1', keyHash, payloadHash,
            sourceSha256: plan.source.sha256, partCount: plan.parts.length,
          },
        } as Prisma.InputJsonValue },
      });
      await tx.auditEvent.create({ data: {
        actorUserId, actorType: 'admin', action: 'story_release.imjin_import_materialized',
        targetType: 'story_release', targetId: release.id,
        metadata: { sourceSha256: plan.source.sha256, partCount: plan.parts.length, rawSourceIncluded: false },
      } });
      return { releaseId, idempotentReplay: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2_000, timeout: 15_000 });
  }

  private record(value: Prisma.JsonValue): Record<string, any> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
  }

  private importMarker(value: Prisma.JsonValue) {
    const marker = this.record(this.record(value)?.importBridge as Prisma.JsonValue);
    return marker && typeof marker.keyHash === 'string' && typeof marker.payloadHash === 'string'
      ? { keyHash: marker.keyHash, payloadHash: marker.payloadHash }
      : null;
  }
}
