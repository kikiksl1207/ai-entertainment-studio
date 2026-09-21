import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStoryAiActivationDto, CreateStoryAiEvidenceDto, STORY_AI_QUALITY_EVALUATOR, STORY_AI_QUALITY_RUBRIC } from './dto/story-ai-activation.dto';
import type { StoryReusableResultApprovalContext } from './story-reusable-result-approval.gate';
import { projectStoredStorySceneVisualManifest } from '../story-stage/story-scene-visual-manifest-contract';
import { storyAiResultChecksum } from './story-ai-result-checksum';

type Client = Prisma.TransactionClient;
type Scope = {
  workId: string; releaseId: string; manuscriptVersionId: string | null;
  rightsContractVersionId: string | null; locale?: string; releaseChecksum?: string;
};

@Injectable()
export class StoryAiActivationService {
  constructor(private readonly prisma: PrismaService) {}

  async prepare(context: Scope, tx: Client = this.prisma, requireReuse = true) {
    const region = process.env.STORY_AI_REGION;
    if (!context.locale || !region || !/^[A-Z]{2}$/.test(region)) return null;
    const activation = await tx.storyAiLegalActivation.findFirst({
      where: { workId: context.workId, releaseId: context.releaseId, locale: context.locale, region },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!activation || activation.manuscriptVersionId !== context.manuscriptVersionId ||
      activation.rightsContractVersionId !== context.rightsContractVersionId ||
      (context.releaseChecksum && activation.releaseChecksum !== context.releaseChecksum)) return null;
    await this.lockActivation(tx, activation.id);
    const [check] = await tx.$queryRaw<{ valid: boolean }[]>`
      SELECT story_ai_activation_valid(${activation.id}, ${context.locale}, ${region}, ${requireReuse}) AS valid`;
    return check?.valid ? activation : null;
  }

  async authorizeResult(context: StoryReusableResultApprovalContext, tx: Client = this.prisma) {
    if (!context.resultId || !context.resultChecksum) return false;
    await tx.$queryRaw`SELECT id FROM story_ai_reusable_results WHERE id=${context.resultId}::uuid FOR SHARE`;
    const result = await tx.storyAiReusableResult.findUnique({ where: { id: context.resultId } });
    const activation = await this.prepare(context, tx);
    if (!result || !activation || result.status !== 'approved' || result.workId !== context.workId ||
      result.releaseId !== context.releaseId || result.releaseChecksum !== context.releaseChecksum ||
      result.resultChecksum !== context.resultChecksum || result.rightsActivationKey !== activation.id ||
      !result.originGeneratedSceneId) return false;
    if (!await this.ancestryValid(tx, result.id)) return false;
    return this.evidenceValid(tx, result);
  }

  async createActivation(actorUserId: string, body: CreateStoryAiActivationDto) {
    if (body.legalActivationConfirmed !== true || body.qualityPolicyVersion !== STORY_AI_QUALITY_RUBRIC) {
      throw new BadRequestException('Explicit legal activation and versioned quality rubric required');
    }
    return this.prisma.$transaction(async (tx) => {
      const release = await tx.storyRelease.findUnique({ where: { id: body.releaseId } });
      if (!release) throw new NotFoundException('Story release not found');
      const activation = await tx.storyAiLegalActivation.create({ data: {
        workId: release.workId, releaseId: release.id, releaseChecksum: release.checksum,
        manuscriptVersionId: release.manuscriptVersionId,
        rightsContractVersionId: body.rightsContractVersionId, consentId: body.consentId,
        consentRevision: body.consentRevision, locale: body.locale, region: body.region,
        moderationPolicyVersion: body.moderationPolicyVersion,
        moderationEvidenceVersion: body.moderationEvidenceVersion, qualityPolicyVersion: body.qualityPolicyVersion,
        evidenceHash: body.evidenceHash, actorUserId, startsAt: new Date(body.startsAt), expiresAt: new Date(body.expiresAt),
      } });
      const [check] = await tx.$queryRaw<{ valid: boolean }[]>`
        SELECT story_ai_activation_valid(${activation.id},${body.locale},${body.region},false) AS valid`;
      if (!check?.valid) throw new ForbiddenException('Legal activation scope is not currently valid');
      return { id: activation.id, createdAt: activation.createdAt };
    });
  }

  async revokeActivation(actorUserId: string, activationId: string, evidenceHash: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockActivation(tx, activationId, true);
      const existing = await tx.storyAiActivationRevocation.findUnique({ where: { activationId } });
      if (existing) return { id: existing.id, createdAt: existing.createdAt };
      const row = await tx.storyAiActivationRevocation.create({ data: { activationId, actorUserId, evidenceHash } });
      return { id: row.id, createdAt: row.createdAt };
    });
  }

  async evidence(actorUserId: string, resultId: string, body: CreateStoryAiEvidenceDto) {
    if (body.kind === 'quality' && (body.policyVersion !== STORY_AI_QUALITY_RUBRIC ||
      body.evaluatorVersion !== STORY_AI_QUALITY_EVALUATOR ||
      (body.decision === 'allow' && body.qualityRubricConfirmed !== true))) {
      throw new BadRequestException('Explicit versioned admin quality review required');
    }
    return this.prisma.$transaction(async (tx) => {
      const result = await this.lockResult(tx, resultId);
      if (!result.originGeneratedSceneId || result.originGeneratedSceneId !== body.originGeneratedSceneId ||
        result.resultChecksum !== body.resultChecksum || result.status === 'revoked') {
        throw new ConflictException('Review origin or checksum changed');
      }
      const row = await tx.storyAiResultEvidence.create({ data: {
        sharedResultId: resultId, originGeneratedSceneId: body.originGeneratedSceneId,
        resultChecksum: body.resultChecksum, kind: body.kind, decision: body.decision,
        revision: body.revision, supersedesId: body.supersedesId,
        policyVersion: body.policyVersion, evaluatorVersion: body.evaluatorVersion,
        evidenceHash: body.evidenceHash, actorUserId, expiresAt: new Date(body.expiresAt),
      } });
      if (body.decision !== 'allow' && result.status === 'approved') {
        await this.revokeResultTx(tx, actorUserId, resultId, body.evidenceHash);
      }
      return { id: row.id, revision: row.revision, createdAt: row.createdAt };
    });
  }

  async promote(actorUserId: string, resultId: string, resultChecksum: string) {
    return this.prisma.$transaction(async (tx) => {
      const result = await this.lockResult(tx, resultId);
      if (result.resultChecksum !== resultChecksum || !result.originGeneratedSceneId || result.status === 'revoked') {
        throw new ConflictException('Shared result is not reviewable');
      }
      const activation = await tx.storyAiLegalActivation.findUnique({ where: { id: result.rightsActivationKey } });
      const active = activation && await this.prepare({ ...result, rightsContractVersionId: activation.rightsContractVersionId }, tx);
      if (!active || active.id !== result.rightsActivationKey || !await this.evidenceValid(tx, result)) {
        throw new ForbiddenException('Current legal, moderation and quality evidence required');
      }
      if (result.sourceSharedResultId && !await this.ancestryValid(tx, result.sourceSharedResultId)) {
        throw new ForbiddenException('Shared result ancestor is not approved');
      }
      if (result.status === 'approved') return { id: resultId, status: 'approved', idempotentReplay: true };
      const scene = await tx.storyAiGeneratedScene.findUnique({ where: { id: result.originGeneratedSceneId } });
      if (!scene || scene.resultChecksum !== resultChecksum || scene.workId !== result.workId ||
        scene.releaseId !== result.releaseId || scene.provenance !== 'ai_generated' || scene.status !== 'ready') {
        throw new ConflictException('Private result is unavailable');
      }
      const continuation = await tx.storyAiContinuation.findUnique({ where: { id: scene.continuationId } });
      if (!continuation || continuation.status !== 'completed' || continuation.requestKind !== 'recommended_choice' ||
        continuation.sharedResultId !== resultId) throw new ConflictException('Continuation is not completed');
      const beats = await tx.storyAiGeneratedBeat.findMany({ where: { sceneId: scene.id }, orderBy: { position: 'asc' } });
      const choices = await tx.storyAiGeneratedChoice.findMany({ where: { sceneId: scene.id }, orderBy: { position: 'asc' } });
      const ending = result.endingKey;
      const computedChecksum = storyAiResultChecksum({ title: scene.title, beats, visualManifest: scene.visualManifest,
        nextChoices: choices, ending: ending ? { endingKey: ending } : null });
      if (computedChecksum !== resultChecksum || computedChecksum !== scene.resultChecksum) {
        throw new ConflictException('Private result checksum mismatch');
      }
      if (beats.length < 1 || beats.length > 40 || choices.length > 3 || ((choices.length > 0) === Boolean(ending))) {
        throw new ConflictException('Private result is incomplete');
      }
      for (const beat of beats) await tx.storyAiReusableBeat.create({ data: {
        sharedResultId: resultId, position: beat.position, beatType: beat.beatType, content: beat.content as Prisma.InputJsonValue,
      } });
      for (const choice of choices) await tx.storyAiReusableChoice.create({ data: {
        sharedResultId: resultId, position: choice.position, choiceKey: choice.choiceKey, label: choice.label as Prisma.InputJsonValue,
      } });
      await tx.storyAiReusableResult.update({ where: { id: resultId }, data: {
        status: 'approved', title: scene.title as Prisma.InputJsonValue,
        visualManifest: scene.visualManifest as Prisma.InputJsonValue, endingKey: ending,
        approvedAt: new Date(), updatedAt: new Date(),
      } });
      await tx.storyAiGeneratedScene.update({ where: { id: scene.id }, data: { sharedResultId: resultId } });
      await tx.auditEvent.create({ data: {
        actorUserId, actorType: 'admin', action: 'story_ai_reusable_result.approve',
        targetType: 'story_ai_reusable_result', targetId: resultId,
        metadata: { resultChecksum, explicitAdminApproval: true, privateContextStored: false },
      } });
      return { id: resultId, status: 'approved', idempotentReplay: false };
    });
  }

  async review(resultId: string) {
    const result = await this.prisma.storyAiReusableResult.findUnique({ where: { id: resultId }, select: {
      id: true, status: true, originGeneratedSceneId: true, resultChecksum: true, reviewPendingAt: true,
      endingKey: true,
      rightsActivationKey: true, moderationPolicyVersion: true, moderationEvidenceVersion: true, qualityPolicyVersion: true,
    } });
    if (!result) throw new NotFoundException('Shared result not found');
    const evidence = await this.prisma.storyAiResultEvidence.findMany({ where: { sharedResultId: resultId },
      orderBy: [{ kind: 'asc' }, { revision: 'desc' }], take: 100, select: {
        id: true, kind: true, decision: true, revision: true, supersedesId: true, policyVersion: true,
        evaluatorVersion: true, evidenceHash: true, expiresAt: true, createdAt: true,
      } });
    const scene = result.originGeneratedSceneId && await this.prisma.storyAiGeneratedScene.findUnique({
      where: { id: result.originGeneratedSceneId }, select: { sceneKey: true, title: true, visualManifest: true, resultChecksum: true },
    });
    const beats = scene ? await this.prisma.storyAiGeneratedBeat.findMany({
      where: { sceneId: result.originGeneratedSceneId! }, orderBy: { position: 'asc' }, take: 40,
      select: { position: true, beatType: true, content: true },
    }) : [];
    const choices = scene ? await this.prisma.storyAiGeneratedChoice.findMany({
      where: { sceneId: result.originGeneratedSceneId! }, orderBy: { position: 'asc' }, take: 3,
      select: { position: true, choiceKey: true, label: true },
    }) : [];
    const computedChecksum = scene ? storyAiResultChecksum({ title: scene.title, beats, visualManifest: scene.visualManifest,
      nextChoices: choices, ending: result.endingKey ? { endingKey: result.endingKey } : null }) : null;
    const checksumValid = Boolean(scene && computedChecksum === scene.resultChecksum && computedChecksum === result.resultChecksum);
    return { ...result, reviewState: !checksumValid && scene ? 'invalid_checksum'
      : result.status === 'pending' && result.reviewPendingAt ? 'review_pending' : result.status,
      checksumValid, computedChecksum,
      evidence, content: scene ? { title: this.localizedReviewText(scene.title),
        beats: beats.map((beat) => ({ ...beat, content: this.localizedReviewText(beat.content) })),
        choices: choices.map((choice) => ({ ...choice, label: this.localizedReviewText(choice.label) })),
        endingKey: result.endingKey,
        visual: projectStoredStorySceneVisualManifest(scene.visualManifest, scene.sceneKey), originChecksum: scene.resultChecksum } : null };
  }

  async reviewQueue(query: { limit?: number; cursor?: string }) {
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const rows = await this.prisma.storyAiReusableResult.findMany({
      where: { status: 'pending', reviewPendingAt: { not: null } },
      orderBy: [{ reviewPendingAt: 'asc' }, { id: 'asc' }], take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: { id: true, workId: true, releaseId: true, locale: true, resultChecksum: true, reviewPendingAt: true },
    });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }

  async revokeResult(actorUserId: string, resultId: string, evidenceHash: string) {
    return this.prisma.$transaction(async (tx) => {
      const result = await this.lockResult(tx, resultId);
      if (result.status !== 'revoked') await this.revokeResultTx(tx, actorUserId, resultId, evidenceHash);
      return { id: resultId, status: 'revoked' };
    });
  }

  private async revokeResultTx(tx: Client, actorUserId: string, resultId: string, evidenceHash: string) {
    await tx.storyAiReusableResult.update({ where: { id: resultId }, data: {
      status: 'revoked', claimToken: null, revokedAt: new Date(), revokeReason: 'explicit_admin_revocation', updatedAt: new Date(),
    } });
    await tx.auditEvent.create({ data: { actorUserId, actorType: 'admin', action: 'story_ai_reusable_result.revoke',
      targetType: 'story_ai_reusable_result', targetId: resultId, metadata: { evidenceHash } } });
  }

  private localizedReviewText(value: Prisma.JsonValue) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']
      .filter((locale) => typeof value[locale] === 'string')
      .map((locale) => [locale, value[locale]]));
  }

  private async lockResult(tx: Client, id: string) {
    await tx.$queryRaw`SELECT id FROM story_ai_reusable_results WHERE id=${id}::uuid FOR UPDATE`;
    const result = await tx.storyAiReusableResult.findUnique({ where: { id } });
    if (!result) throw new NotFoundException('Shared result not found');
    return result;
  }

  private async lockActivation(tx: Client, id: string, exclusive = false) {
    if (exclusive) await tx.$queryRaw`SELECT id FROM story_ai_legal_activations WHERE id=${id} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM story_ai_legal_activations WHERE id=${id} FOR SHARE`;
    await tx.$queryRaw`SELECT c.id FROM story_style_profile_consents c
      JOIN story_ai_legal_activations a ON a.consent_id=c.id WHERE a.id=${id} FOR SHARE OF c`;
  }

  private async evidenceValid(tx: Client, result: {
    id: string; resultChecksum: string | null; moderationPolicyVersion: string;
    moderationEvidenceVersion: string; qualityPolicyVersion: string;
  }) {
    const [check] = await tx.$queryRaw<{ valid: boolean }[]>`
      SELECT story_ai_evidence_valid(${result.id}::uuid,${result.resultChecksum},'moderation',
        ${result.moderationPolicyVersion},${result.moderationEvidenceVersion})
      AND story_ai_evidence_valid(${result.id}::uuid,${result.resultChecksum},'quality',
        ${result.qualityPolicyVersion},${STORY_AI_QUALITY_EVALUATOR}) AS valid`;
    return Boolean(check?.valid);
  }

  private async ancestryValid(tx: Client, resultId: string) {
    const ancestors = await tx.$queryRaw<Array<{ status: string; source_kind: string }>>`
      WITH RECURSIVE ancestry AS (
        SELECT id,source_shared_result_id,1 AS depth FROM story_ai_reusable_results WHERE id=${resultId}::uuid
        UNION ALL SELECT r.id,r.source_shared_result_id,a.depth+1 FROM story_ai_reusable_results r
            JOIN ancestry a ON r.id=a.source_shared_result_id WHERE a.depth<2048
      ) SELECT r.status,r.source_kind FROM story_ai_reusable_results r JOIN ancestry a ON a.id=r.id FOR SHARE OF r`;
    return ancestors.length > 0 && ancestors.every((row) => row.status === 'approved') &&
      ancestors.some((row) => row.source_kind === 'canonical');
  }
}
