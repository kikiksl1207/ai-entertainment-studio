import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { INTERNAL_GENERATION_COST_TREATMENT } from '../story-settlement/content-rights-contract.contract';
import { STORY_AI_QUALITY_RUBRIC } from './dto/story-ai-activation.dto';
import type { ActivatePublishedStoryAiDto } from './dto/story-publication-intake.dto';
import { StoryAiActivationService } from './story-ai-activation.service';

const STORY_KEYS = {
  imjin: 'records-of-the-burning-sea-imjin-war',
  norse: 'norse-myth-loki-crossroads',
} as const;
const STORY_LOCALES = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const RATE_CARD_ID = 'ed9b8bf1-df49-4f2d-9f62-6aeb9c5ed4f6';
const RATE_CARD_VERSION = 'story-openai-gpt-5.4-mini-2026-03-17-krw-v1';
const MODEL = 'gpt-5.4-mini-2026-03-17';
const REGION = 'KR';
const LOCALE = 'ko';
const MODERATION_POLICY_VERSION = 'story-public-beta-moderation-v1';
const MODERATION_EVIDENCE_VERSION = 'admin-rights-confirmation-v1';
const STYLE_SAMPLE_COUNT = 8;

type StoryKey = keyof typeof STORY_KEYS;
type Tx = Prisma.TransactionClient;

@Injectable()
export class StoryPublicBetaAiActivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly legalActivation: StoryAiActivationService,
  ) {}

  async status(storyKeyValue: string) {
    const storyKey = this.storyKey(storyKeyValue);
    const work = await this.prisma.storyWork.findUnique({
      where: { slug: STORY_KEYS[storyKey] },
      select: { id: true, activeReleaseId: true, status: true },
    });
    if (!work?.activeReleaseId || work.status !== 'published') {
      return { storyKey, status: 'unavailable', active: false };
    }
    const activation = await this.latestValidActivation(this.prisma, work.id, work.activeReleaseId);
    return {
      storyKey,
      status: activation ? 'active' : 'inactive',
      active: Boolean(activation),
      locale: activation?.locale ?? LOCALE,
      region: activation?.region ?? REGION,
      expiresAt: activation?.expiresAt ?? null,
    };
  }

  async activate(actorUserId: string, storyKeyValue: string, body: ActivatePublishedStoryAiDto) {
    const storyKey = this.storyKey(storyKeyValue);
    if (!body || Object.values(body).some((value) => value !== true)) {
      throw new BadRequestException('All AI publication confirmations are required');
    }
    const now = new Date();
    const startsAt = new Date(now.getTime() - 60_000);
    const expiresAt = new Date(now);
    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);

    const prepared = await this.prisma.$transaction(async (tx) => {
      const work = await tx.storyWork.findUnique({ where: { slug: STORY_KEYS[storyKey] } });
      if (!work || work.status !== 'published' || work.fixtureSource || !work.activeReleaseId) {
        throw new NotFoundException('Published story work not found');
      }
      const release = await tx.storyRelease.findFirst({
        where: { id: work.activeReleaseId, workId: work.id, status: 'active' },
      });
      if (!release) throw new NotFoundException('Active story release not found');
      const manuscript = await tx.storyManuscriptVersion.findFirst({
        where: { id: release.manuscriptVersionId, workId: work.id, ownerUserId: work.ownerUserId },
      });
      if (!manuscript) throw new ConflictException('Published manuscript binding is invalid');
      const parts = await tx.storyPart.findMany({
        where: { workId: work.id, status: 'published', fixtureSource: false },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: { id: true, position: true, title: true },
      });
      if (!parts.length) throw new ConflictException('Published story has no parts');

      const rateCard = await this.ensureRateCard(tx, actorUserId, startsAt);
      const analysis = await this.ensureStyleSnapshot(tx, actorUserId, work, manuscript, parts, rateCard.id);
      const consent = await this.ensureConsent(tx, work, manuscript.id, startsAt, expiresAt);
      const rights = await this.ensureRights(tx, actorUserId, work, manuscript.id, startsAt, expiresAt);
      const capability = await this.ensureCapability(tx, actorUserId, work.id, release.id, rateCard.id, parts.length);

      await tx.storyReaderProgress.updateMany({
        where: { workId: work.id, activeReleaseId: release.id, status: { not: 'ai_pending' } },
        data: { aiRateCardId: rateCard.id, capabilityRevision: capability.revision, updatedAt: now },
      });
      await tx.storyAiAllowanceBucket.updateMany({
        where: { workId: work.id, releaseId: release.id, includedLimit: { lt: capability.includedAiRouteCount } },
        data: { includedLimit: capability.includedAiRouteCount, revision: { increment: 1 }, updatedAt: now },
      });
      await tx.auditEvent.create({ data: {
        actorUserId,
        actorType: 'admin',
        action: 'story_public_beta.ai_activation.prepare',
        targetType: 'story_work',
        targetId: work.id,
        metadata: {
          storyKey, releaseId: release.id, manuscriptVersionId: manuscript.id,
          analysisJobId: analysis.id, consentId: consent.id, consentRevision: consent.revision,
          rightsContractVersionId: rights.id, rateCardId: rateCard.id,
          capabilityRevision: capability.revision, explicitConfirmations: true,
        },
      } });
      return { work, release, manuscript, analysis, consent, rights, rateCard, capability };
    });

    const existing = await this.latestValidActivation(
      this.prisma,
      prepared.work.id,
      prepared.release.id,
      prepared.rights.id,
      prepared.consent.id,
      prepared.consent.revision,
    );
    const evidenceHash = this.sha256({
      contract: 'story-public-beta-ai-explicit-activation-v1',
      actorUserId,
      storyKey,
      workId: prepared.work.id,
      releaseId: prepared.release.id,
      releaseChecksum: prepared.release.checksum,
      manuscriptVersionId: prepared.manuscript.id,
      rightsContractVersionId: prepared.rights.id,
      consentId: prepared.consent.id,
      consentRevision: prepared.consent.revision,
      confirmations: body,
    });
    const activation = existing ?? await this.legalActivation.createActivation(actorUserId, {
      releaseId: prepared.release.id,
      rightsContractVersionId: prepared.rights.id,
      consentId: prepared.consent.id,
      consentRevision: prepared.consent.revision,
      locale: LOCALE,
      region: REGION,
      moderationPolicyVersion: MODERATION_POLICY_VERSION,
      moderationEvidenceVersion: MODERATION_EVIDENCE_VERSION,
      qualityPolicyVersion: STORY_AI_QUALITY_RUBRIC,
      evidenceHash,
      startsAt: startsAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      legalActivationConfirmed: true,
    });
    return {
      storyKey,
      status: 'active',
      active: true,
      idempotentReplay: Boolean(existing),
      activationId: activation.id,
      locale: LOCALE,
      region: REGION,
      expiresAt,
      model: MODEL,
      rateCardId: prepared.rateCard.id,
      rateCardVersion: prepared.rateCard.version,
      includedAiRouteCount: prepared.capability.includedAiRouteCount,
      styleMemorySource: 'publication_style_snapshot_v1',
    };
  }

  private storyKey(value: string): StoryKey {
    if (value !== 'imjin' && value !== 'norse') throw new BadRequestException('Unsupported story key');
    return value;
  }

  private async ensureRateCard(tx: Tx, actorUserId: string, effectiveAt: Date) {
    let rate = await tx.storyAiRateCard.findUnique({ where: { version: RATE_CARD_VERSION } });
    if (!rate) rate = await tx.storyAiRateCard.create({ data: {
      id: RATE_CARD_ID,
      version: RATE_CARD_VERSION,
      provider: 'openai',
      model: MODEL,
      status: 'active',
      currencyCode: 'KRW',
      inputCostPerMillion: 1125,
      outputCostPerMillion: 6750,
      cachedInputCostPerMillion: 112.5,
      imageUnitCost: 0,
      createdByUserId: actorUserId,
      effectiveAt,
    } });
    if (rate.id !== RATE_CARD_ID || rate.provider !== 'openai' || rate.model !== MODEL) {
      throw new ConflictException('Pinned public beta AI rate card changed');
    }
    if (rate.status !== 'active' || !rate.effectiveAt || rate.effectiveAt > effectiveAt || rate.retiredAt) rate = await tx.storyAiRateCard.update({
      where: { id: rate.id },
      data: { status: 'active', effectiveAt, retiredAt: null },
    });
    return rate;
  }

  private async ensureStyleSnapshot(
    tx: Tx,
    actorUserId: string,
    work: { id: string; title: Prisma.JsonValue; summary: Prisma.JsonValue; defaultLocale: string },
    manuscript: { id: string; contentHash: string; locale: string },
    parts: Array<{ id: string; position: number; title: Prisma.JsonValue }>,
    rateCardId: string,
  ) {
    let analysis = await tx.storyAnalysisJob.findFirst({
      where: { workId: work.id, manuscriptVersionId: manuscript.id, status: 'completed' },
      orderBy: [{ analysisVersion: 'desc' }, { createdAt: 'desc' }],
    });
    if (!analysis) {
      const latest = await tx.storyAnalysisJob.findFirst({
        where: { manuscriptVersionId: manuscript.id },
        orderBy: { analysisVersion: 'desc' },
        select: { analysisVersion: true },
      });
      const analysisVersion = (latest?.analysisVersion ?? 0) + 1;
      analysis = await tx.storyAnalysisJob.create({ data: {
        workId: work.id,
        manuscriptVersionId: manuscript.id,
        analysisVersion,
        idempotencyKey: `publication-style:${work.id}:${manuscript.id}:${manuscript.contentHash}`,
        status: 'completed',
        pipeline: 'publication_style_snapshot_v1',
        actorUserId,
        sourceContentHash: manuscript.contentHash,
        sourceLocale: manuscript.locale,
        rateCardId,
        sourceDigest: manuscript.contentHash,
        configPins: { contract: 'publication_style_snapshot_v1', sampleCount: STYLE_SAMPLE_COUNT },
        configHash: this.sha256({ contract: 'publication_style_snapshot_v1', sampleCount: STYLE_SAMPLE_COUNT }),
        phase: 'completed',
        totalParagraphs: parts.length,
        totalParts: parts.length,
        plannedParagraphs: parts.length,
        completedParagraphs: parts.length,
        result: { bounded: true, fullManuscriptStored: false, source: 'published_canonical_beats' },
        startedAt: new Date(),
        completedAt: new Date(),
      } });
    }

    const sampleParts = this.evenlySpaced(parts, STYLE_SAMPLE_COUNT);
    let createdSamples = 0;
    for (let index = 0; index < sampleParts.length; index += 1) {
      const part = sampleParts[index];
      const scene = await tx.storyScene.findFirst({
        where: { partId: part.id, status: 'published', fixtureSource: false },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      const beats = scene ? await tx.storyBeat.findMany({
        where: { sceneId: scene.id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: { content: true },
        take: 3,
      }) : [];
      const excerpt = this.clipUtf8(beats.map((beat) => this.localized(beat.content, manuscript.locale)).filter(Boolean).join('\n'), 7_200);
      if (!excerpt) continue;
      await tx.storyMemoryRecord.upsert({
        where: { analysisJobId_memoryType_memoryKey: {
          analysisJobId: analysis.id, memoryType: 'style', memoryKey: `publication-sample-${String(index + 1).padStart(2, '0')}`,
        } },
        create: {
          workId: work.id,
          analysisJobId: analysis.id,
          manuscriptVersionId: manuscript.id,
          memoryType: 'style',
          memoryKey: `publication-sample-${String(index + 1).padStart(2, '0')}`,
          partKey: `part-${part.position}`,
          content: { [manuscript.locale]: excerpt },
          provenance: 'writer_original_publication_sample',
        },
        update: {},
      });
      createdSamples += 1;
    }
    const summary = this.localized(work.summary, manuscript.locale);
    if (summary) await tx.storyMemoryRecord.upsert({
      where: { analysisJobId_memoryType_memoryKey: {
        analysisJobId: analysis.id, memoryType: 'event', memoryKey: 'publication-work-premise',
      } },
      create: {
        workId: work.id,
        analysisJobId: analysis.id,
        manuscriptVersionId: manuscript.id,
        memoryType: 'event',
        memoryKey: 'publication-work-premise',
        content: { [manuscript.locale]: this.clipUtf8(summary, 7_200) },
        provenance: 'writer_original_publication_summary',
      },
      update: {},
    });
    if (!createdSamples) throw new ConflictException('Published story style samples are unavailable');
    return analysis;
  }

  private async ensureConsent(
    tx: Tx,
    work: { id: string; ownerUserId: string },
    manuscriptVersionId: string,
    startsAt: Date,
    expiresAt: Date,
  ) {
    const current = await tx.storyStyleProfileConsent.findUnique({ where: { workId: work.id } });
    const matching = current && current.ownerUserId === work.ownerUserId &&
      current.manuscriptVersionId === manuscriptVersionId && current.status === 'active' &&
      current.rightsConfirmed && current.aiBranchAllowed && current.translationAllowed &&
      current.imageTransformationAllowed && this.sameStrings(current.allowedLocales, STORY_LOCALES) &&
      this.sameStrings(current.allowedRegions, [REGION]) && current.startsAt <= new Date() &&
      (!current.expiresAt || current.expiresAt > new Date()) && !current.withdrawnAt && !current.deletionRequestedAt && !current.deletedAt;
    if (matching) return current;
    const data = {
      ownerUserId: work.ownerUserId,
      manuscriptVersionId,
      status: 'active',
      rightsConfirmed: true,
      aiBranchAllowed: true,
      translationAllowed: true,
      imageTransformationAllowed: true,
      allowedLocales: STORY_LOCALES,
      allowedRegions: [REGION],
      startsAt,
      expiresAt,
      withdrawnAt: null,
      deletionRequestedAt: null,
      deletedAt: null,
      publicClaim: 'writer_approved_manuscript_based_ai_expansion',
    };
    return current
      ? tx.storyStyleProfileConsent.update({ where: { id: current.id }, data: { ...data, revision: { increment: 1 }, updatedAt: new Date() } })
      : tx.storyStyleProfileConsent.create({ data: { workId: work.id, ...data } });
  }

  private async ensureRights(
    tx: Tx,
    actorUserId: string,
    work: { id: string; ownerUserId: string },
    manuscriptVersionId: string,
    startsAt: Date,
    expiresAt: Date,
  ) {
    let contract = await tx.contentRightsContract.findFirst({ where: { workType: 'story', workId: work.id } });
    if (!contract) contract = await tx.contentRightsContract.create({ data: {
      workType: 'story', workId: work.id, createdByUserId: actorUserId,
    } });
    const versions = await tx.contentRightsContractVersion.findMany({
      where: { contractId: contract.id },
      orderBy: [{ revision: 'desc' }, { createdAt: 'desc' }],
    });
    const latestApproved = versions.find((version) => version.approvalState === 'approved_configuration');
    if (latestApproved && latestApproved.contentVersionId === manuscriptVersionId && latestApproved.aiTransformationAllowed &&
        latestApproved.generatedResultReuseAllowed && this.includes(latestApproved.media, 'story_publication') &&
        this.includes(latestApproved.regions, REGION) && latestApproved.startsAt <= new Date() &&
        latestApproved.effectiveFrom <= new Date() && (!latestApproved.endsAt || latestApproved.endsAt > new Date())) return latestApproved;
    const latest = versions[0];
    const version = await tx.contentRightsContractVersion.create({ data: {
      contractId: contract.id,
      revision: (latest?.revision ?? 0) + 1,
      sourceVersionId: latest?.id ?? null,
      contentVersionId: manuscriptVersionId,
      exclusivity: 'nonexclusive',
      media: ['story_publication'],
      regions: [REGION],
      startsAt,
      endsAt: expiresAt,
      saleAllowed: true,
      aiTransformationAllowed: true,
      generatedResultReuseAllowed: true,
      approvalState: 'approved_configuration',
      effectiveFrom: startsAt,
      authorRightsHolderShareBps: 5000,
      salesAgencyShareBps: 0,
      companyShareBps: 5000,
      pointUsagePolicy: 'unresolved',
      refundReversalPolicy: 'unresolved',
      paidPointPolicy: 'unresolved',
      bonusPointPolicy: 'unresolved',
      vatPolicy: 'unresolved',
      internalGenerationCostTreatment: INTERNAL_GENERATION_COST_TREATMENT,
      createdByUserId: actorUserId,
      approvedByUserId: actorUserId,
    } });
    await tx.contentRightsContractParty.create({ data: {
      contractVersionId: version.id,
      role: 'author',
      userId: work.ownerUserId,
    } });
    await tx.contentRightsContractAudit.create({ data: {
      contractId: contract.id,
      contractVersionId: version.id,
      actorUserId,
      action: 'approved_configuration',
      snapshotHash: this.sha256({
        workId: work.id, manuscriptVersionId, revision: version.revision,
        aiTransformationAllowed: true, generatedResultReuseAllowed: true,
      }),
    } });
    return version;
  }

  private async ensureCapability(
    tx: Tx,
    actorUserId: string,
    workId: string,
    releaseId: string,
    rateCardId: string,
    partCount: number,
  ) {
    const current = await tx.storyReleaseCapability.findUnique({ where: { releaseId } });
    const desired = {
      workId,
      releaseId,
      rateCardId,
      fixedChoiceCount: 3,
      customChoiceEnabled: false,
      customChoiceMaxLength: 200,
      fullResetLimit: 1,
      actResetLimit: 3,
      includedAiRouteCount: Math.min(1000, partCount + 10),
      aiInputTokenLimit: 32768,
      aiOutputTokenLimit: 8192,
      warningBudgetKrw: 100,
      hardBudgetKrw: 300,
      status: 'active',
      validationErrors: [],
      updatedByUserId: actorUserId,
    };
    const matching = current && current.rateCardId === desired.rateCardId && current.fixedChoiceCount === 3 &&
      !current.customChoiceEnabled && current.includedAiRouteCount === desired.includedAiRouteCount &&
      current.aiInputTokenLimit === desired.aiInputTokenLimit && current.aiOutputTokenLimit === desired.aiOutputTokenLimit &&
      current.fullResetLimit === 1 && current.actResetLimit === 3 &&
      Number(current.warningBudgetKrw) === desired.warningBudgetKrw && Number(current.hardBudgetKrw) === desired.hardBudgetKrw &&
      current.status === 'active';
    if (matching) return current;
    return current
      ? tx.storyReleaseCapability.update({ where: { id: current.id }, data: { ...desired, revision: { increment: 1 }, updatedAt: new Date() } })
      : tx.storyReleaseCapability.create({ data: desired });
  }

  private async latestValidActivation(
    client: PrismaService | Tx,
    workId: string,
    releaseId: string,
    rightsContractVersionId?: string,
    consentId?: string,
    consentRevision?: number,
  ) {
    const rows = await client.storyAiLegalActivation.findMany({
      where: {
        workId, releaseId, locale: LOCALE, region: REGION, expiresAt: { gt: new Date() },
        ...(rightsContractVersionId ? { rightsContractVersionId } : {}),
        ...(consentId ? { consentId } : {}),
        ...(consentRevision ? { consentRevision } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
    });
    for (const row of rows) {
      const revoked = await client.storyAiActivationRevocation.findUnique({ where: { activationId: row.id } });
      if (revoked) continue;
      const [valid] = await client.$queryRaw<Array<{ valid: boolean }>>`
        SELECT story_ai_activation_valid(${row.id}, ${LOCALE}, ${REGION}, false) AS valid`;
      if (valid?.valid) return row;
    }
    return null;
  }

  private evenlySpaced<T>(items: T[], limit: number) {
    if (items.length <= limit) return items;
    return Array.from({ length: limit }, (_, index) => items[Math.round(index * (items.length - 1) / (limit - 1))]);
  }

  private localized(value: Prisma.JsonValue, locale: string) {
    if (typeof value === 'string') return value.trim();
    if (!value || Array.isArray(value) || typeof value !== 'object') return '';
    const record = value as Record<string, Prisma.JsonValue>;
    const localized = record[locale];
    if (typeof localized === 'string') return localized.trim();
    const fallback = Object.values(record).find((item) => typeof item === 'string');
    return typeof fallback === 'string' ? fallback.trim() : '';
  }

  private clipUtf8(value: string, maxBytes: number) {
    let text = value.trim();
    while (text && Buffer.byteLength(text, 'utf8') > maxBytes) text = text.slice(0, Math.floor(text.length * 0.9));
    return text.trim();
  }

  private sameStrings(value: Prisma.JsonValue, expected: string[]) {
    return Array.isArray(value) && value.length === expected.length && expected.every((item) => value.includes(item));
  }

  private includes(value: Prisma.JsonValue, expected: string) {
    return Array.isArray(value) && value.includes(expected);
  }

  private sha256(value: unknown) {
    return createHash('sha256').update(this.stableJson(value)).digest('hex');
  }

  private stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.stableJson(item)).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${this.stableJson(item)}`).join(',')}}`;
    return JSON.stringify(value) ?? 'null';
  }
}

export const STORY_PUBLIC_BETA_AI_RUNTIME = {
  model: MODEL,
  rateCardId: RATE_CARD_ID,
  rateCardVersion: RATE_CARD_VERSION,
  locale: LOCALE,
  region: REGION,
} as const;
