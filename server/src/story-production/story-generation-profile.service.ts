import {
  BeforeApplicationShutdown,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type StoryAnalysisJob } from '@prisma/client';
import { createHash } from 'crypto';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  assertCreatorGenerationProfileApprovable,
  creatorGenerationProfileFingerprint,
  creatorGenerationProfileProjection,
  normalizeCreatorGenerationProfile,
  stableJson,
  type CreatorGenerationProfileEvidence,
  type CreatorGenerationProfileSection,
  type CreatorGenerationProfileSettings,
} from '../generation-profile/creator-generation-profile.policy';
import {
  ApproveCreatorGenerationProfileDto,
  UpdateStoryGenerationProfileDto,
} from '../generation-profile/dto/creator-generation-profile.dto';
import { PrismaService } from '../prisma/prisma.service';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';
import { assertStoryVisualSettings, publicationVisualReference, STORY_VISUAL_REVIEW_VERSION } from './story-approved-visual.policy';
import { continuationGenerationProfileApprovalPin, continuationGenerationProfileSnapshot } from './story-continuation-context.policy';
import { STORY_LOCALES } from './story-production.policy';
import { resolveCompanyPrivateIntakeSource, resolveCurrentCompanyPublicationBinding } from './story-company-source.policy';
import { StoryCompanyFinalSubmissionService } from './story-company-final-submission.service';

const EVIDENCE_TYPES = [
  'scene',
  'background',
  'entity',
  'event',
  'foreshadow',
  'payoff',
  'style',
] as const;

type EvidenceType = (typeof EVIDENCE_TYPES)[number];
type ProfileEvidenceRow = {
  id: string;
  evidenceType: string;
  sourcePartKey: string;
  sourceParagraphIndex: number;
  payload: unknown;
};

type PendingCompanyProfile = {
  id: string; createdAt: string; workId: string; ownerUserId: string;
  manuscriptVersionId: string; analysisJobId: string;
};

@Injectable()
export class StoryGenerationProfileService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(StoryGenerationProfileService.name);
  private bootstrapRecovery?: Promise<void>;
  private bootstrapStopping = false;
  constructor(private readonly prisma: PrismaService,
    @Optional() private readonly companySubmission?: StoryCompanyFinalSubmissionService) {}

  onApplicationBootstrap(): void {
    if (this.bootstrapStopping || this.bootstrapRecovery) return;
    const recovery: Promise<void> = this.approvePendingCompanyProfiles().catch((error: unknown) => {
      this.logger.warn(`Company story profile recovery stopped: ${this.bootstrapErrorName(error)}`);
    }).finally(() => {
      if (this.bootstrapRecovery === recovery) this.bootstrapRecovery = undefined;
    });
    this.bootstrapRecovery = recovery;
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.bootstrapStopping = true;
    await this.bootstrapRecovery;
  }

  private async approvePendingCompanyProfiles() {
    const batchSize = 100;
    const startedAt = Date.now();
    let after: Pick<PendingCompanyProfile, 'createdAt' | 'id'> | null = null;
    for (let page = 0; page < 10; page++) {
      if (!this.canStartBootstrapCandidate(startedAt)) return;
      const pending: PendingCompanyProfile[] = await this.prisma.$queryRaw<PendingCompanyProfile[]>(Prisma.sql`
        SELECT profile.id, profile.created_at::text AS "createdAt",
          profile.work_id AS "workId", profile.owner_user_id AS "ownerUserId",
          profile.manuscript_version_id AS "manuscriptVersionId", profile.analysis_job_id AS "analysisJobId"
        FROM story_work_generation_profiles AS profile
        JOIN story_works AS work ON work.id = profile.work_id AND work.owner_user_id = profile.owner_user_id
        WHERE profile.status = ${'needs_review'} AND work.author_display_name = ${'루미나'}
          AND work.fixture_source = false
          ${after ? Prisma.sql`AND (profile.created_at, profile.id) > (${after.createdAt}::timestamptz, ${after.id}::uuid)` : Prisma.empty}
        ORDER BY profile.created_at ASC, profile.id ASC LIMIT ${batchSize}
      `);
      for (const profile of pending) {
        if (!this.canStartBootstrapCandidate(startedAt)) return;
        try {
          const approved = await this.autoApproveCompany(profile.ownerUserId, profile.workId,
            { manuscriptVersionId: profile.manuscriptVersionId, analysisJobId: profile.analysisJobId });
          if (approved && this.companySubmission && !this.bootstrapStopping) {
            await this.companySubmission.autoSubmitCompletedAnalysis(profile.ownerUserId, profile.workId,
              profile.manuscriptVersionId, profile.analysisJobId);
          }
        } catch (error) {
          this.logger.warn(`Company story profile recovery skipped: ${this.bootstrapErrorName(error)}`);
        }
      }
      if (pending.length < batchSize) return;
      const last: PendingCompanyProfile = pending[pending.length - 1];
      after = { createdAt: last.createdAt, id: last.id };
    }
    this.logger.warn('Company story profile recovery reached the 1000-profile scan limit');
  }

  private canStartBootstrapCandidate(startedAt: number) {
    if (this.bootstrapStopping) return false;
    if (Date.now() - startedAt < 10000) return true;
    this.logger.warn('Company story profile recovery reached the 10-second time limit');
    return false;
  }

  private bootstrapErrorName(error: unknown) {
    if (error instanceof ConflictException) return 'ConflictException';
    if (error instanceof Prisma.PrismaClientKnownRequestError) return 'PrismaClientKnownRequestError';
    return error instanceof Error ? 'Error' : 'unknown error';
  }

  async autoApproveCompany(userId: string, workId: string,
    expectedSource?: { manuscriptVersionId: string; analysisJobId: string }) {
    const source = await this.latestCompletedSource(userId, workId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${workId}::uuid FOR UPDATE`);
      if (expectedSource) {
        if (source.manuscript.id !== expectedSource.manuscriptVersionId ||
            source.analysis.id !== expectedSource.analysisJobId) return null;
        const currentManuscript = await tx.storyManuscriptVersion.findFirst({
          where: { workId, ownerUserId: userId }, orderBy: { version: 'desc' },
          select: { id: true, contentHash: true },
        });
        if (currentManuscript?.id !== expectedSource.manuscriptVersionId ||
            currentManuscript.contentHash !== source.manuscript.contentHash) return null;
        const currentAnalysis = await tx.storyAnalysisJob.findFirst({
          where: { workId, manuscriptVersionId: currentManuscript.id, status: 'completed', pipeline: SEMANTIC_PIPELINE },
          orderBy: { analysisVersion: 'desc' }, select: { id: true, sourceContentHash: true, configHash: true },
        });
        if (currentAnalysis?.id !== expectedSource.analysisJobId ||
            currentAnalysis.sourceContentHash !== source.manuscript.contentHash ||
            currentAnalysis.configHash !== source.analysis.configHash) return null;
      }
      const work = await tx.storyWork.findFirst({
        where: { id: workId, ownerUserId: userId },
        select: { authorDisplayName: true, fixtureSource: true, activeReleaseId: true },
      });
      if (work?.authorDisplayName !== '루미나' || work.fixtureSource) return null;
      const companyImport = await tx.storyPublicationImportJob.findFirst({
        where: { workId, actorUserId: userId, status: 'published', releaseId: work.activeReleaseId },
        select: { id: true, releaseId: true },
      });
      const companyPublication = companyImport || !work.activeReleaseId ? null : await tx.auditEvent.findFirst({
        where: { actorUserId: userId, actorType: 'admin',
          action: { in: ['story_approved_source.public_beta_published', 'story_upload.public_beta_published'] },
          afterData: { path: ['workId'], equals: workId },
          AND: [{ afterData: { path: ['releaseId'], equals: work.activeReleaseId } }] },
        select: { id: true, afterData: true },
      });
      const companyPublishedBinding = companyImport || companyPublication
        ? await resolveCurrentCompanyPublicationBinding(tx, userId, workId, source.manuscript,
          companyImport ? companyImport.releaseId : this.record(companyPublication!.afterData).releaseId) : null;
      if ((companyImport || companyPublication) && !companyPublishedBinding) return null;
      const companyPrivateIntake = companyImport || companyPublication ? null
        : await resolveCompanyPrivateIntakeSource(tx, userId, workId, source.manuscript);
      if (!companyImport && !companyPublication && !companyPrivateIntake) return null;
      const current = await tx.storyWorkGenerationProfile.findFirst({
        where: { workId }, orderBy: { profileVersion: 'desc' },
      });
      if (!current || current.analysisJobId !== source.analysis.id || current.status !== 'needs_review' ||
          current.sourceFingerprint !== this.sourceFingerprint(source) || current.reviewRevision !== 0) return null;
      if (current.ownerUserId !== userId || current.workId !== workId ||
          current.manuscriptVersionId !== source.manuscript.id) return null;
      const draft = normalizeCreatorGenerationProfile('story', current.draftSettings);
      if (draft.sections.some((section) => section.decision !== 'proposed')) return null;
      const style = draft.sections.find((section) => section.key === 'writing_style');
      const styleEvidenceIds = Array.isArray(style?.value.observations)
        ? style.value.observations.flatMap((item) => {
          const ref = this.record(item).sourceRef;
          return typeof ref === 'string' && /^analysis:[0-9a-f-]{36}$/i.test(ref) ? [ref.slice(9)] : [];
        }) : [];
      if (!styleEvidenceIds.length || !await tx.storyAnalysisEvidence.findFirst({
        where: { id: { in: styleEvidenceIds }, analysisJobId: source.analysis.id,
          provenance: 'semantic_candidate', evidenceType: 'style' }, select: { id: true },
      })) return null;
      const settings = normalizeCreatorGenerationProfile('story', {
        ...draft,
        sections: draft.sections.map((section) => ({ ...section, decision: 'accepted' })),
      });
      assertCreatorGenerationProfileApprovable(settings);
      assertStoryVisualSettings(settings);
      const fingerprint = creatorGenerationProfileFingerprint(current.sourceFingerprint, settings);
      this.assertGenerationContextFits(current, settings, fingerprint);
      const updated = await tx.storyWorkGenerationProfile.updateMany({
        where: { id: current.id, status: 'needs_review', sourceFingerprint: current.sourceFingerprint,
          draftFingerprint: current.draftFingerprint, reviewRevision: 0 },
        data: { status: 'approved', draftSettings: settings as unknown as Prisma.InputJsonValue,
          draftFingerprint: fingerprint, approvedSettings: settings as unknown as Prisma.InputJsonValue,
          approvedFingerprint: fingerprint, approvedByUserId: userId, approvedAt: new Date(),
          reviewRevision: { increment: 1 }, updatedAt: new Date() },
      });
      if (updated.count !== 1) return null;
      await this.invalidateOlderWorkSnapshots(tx, userId, workId);
      const approved = await tx.storyWorkGenerationProfile.findUniqueOrThrow({ where: { id: current.id } });
      const approvedMemoryCount = await this.persistApprovedMemories(tx, source, approved.id, settings);
      await tx.auditEvent.create({ data: { actorUserId: userId, actorType: 'system',
        action: 'story_generation_profile.company_auto_approved',
        targetType: 'story_work_generation_profile', targetId: approved.id,
        beforeData: { status: current.status, reviewRevision: current.reviewRevision },
        afterData: { status: approved.status, reviewRevision: approved.reviewRevision,
          approvedFingerprint: approved.approvedFingerprint },
        metadata: { workId, analysisJobId: source.analysis.id,
          ...(companyImport ? { companyImportJobId: companyImport.id }
            : companyPublication ? { companyPublicationAuditId: companyPublication.id } : companyPrivateIntake!),
          ...(companyPublishedBinding ?? {}),
          approvedMemoryCount } } });
      return this.project(workId, source, approved);
    });
  }

  async readCurrentApprovedStyle(userId: string, workId: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      const work = await tx.storyWork.findFirst({
        where: { id: workId, ownerUserId: userId }, select: { id: true },
      });
      if (!work) throw new NotFoundException('Story work not found');
      const canonicalWorkId = work.id;
      const manuscript = await tx.storyManuscriptVersion.findFirst({
        where: { workId: canonicalWorkId, ownerUserId: userId }, orderBy: { version: 'desc' },
        select: { id: true, version: true, locale: true, contentHash: true },
      });
      if (!manuscript) throw new ConflictException({
        code: 'GENERATION_PROFILE_MANUSCRIPT_REQUIRED', message: 'A current manuscript is required',
      });
      const analysis = await tx.storyAnalysisJob.findFirst({
        where: { workId: canonicalWorkId, manuscriptVersionId: manuscript.id, status: 'completed', pipeline: SEMANTIC_PIPELINE },
        orderBy: { analysisVersion: 'desc' },
        select: { id: true, analysisVersion: true, sourceContentHash: true, configHash: true },
      });
      if (!analysis || analysis.sourceContentHash !== manuscript.contentHash) {
        throw new ServiceUnavailableException({
          code: 'GENERATION_PROFILE_ANALYSIS_REQUIRED', message: 'Current completed manuscript analysis is required',
        });
      }
      // Read the latest row before checking approval; never substitute an older approved profile.
      const profile = await tx.storyWorkGenerationProfile.findFirst({
        where: { workId: canonicalWorkId }, orderBy: { profileVersion: 'desc' },
        select: {
          id: true, workId: true, ownerUserId: true, manuscriptVersionId: true, analysisJobId: true,
          sourceFingerprint: true, profileVersion: true, reviewRevision: true, status: true,
          approvedSettings: true, approvedFingerprint: true, approvedByUserId: true, approvedAt: true,
        },
      });
      if (!profile || profile.status !== 'approved') throw new ConflictException({
        code: 'GENERATION_PROFILE_APPROVED_STYLE_REQUIRED', message: 'The current profile must be approved',
      });
      const sourceFingerprint = createHash('sha256').update(stableJson({
        workId: work.id, manuscriptVersionId: manuscript.id, contentHash: manuscript.contentHash,
        analysisJobId: analysis.id, analysisVersion: analysis.analysisVersion, analysisConfigHash: analysis.configHash,
      })).digest('hex');
      if (profile.workId !== canonicalWorkId || profile.ownerUserId !== userId
        || profile.manuscriptVersionId !== manuscript.id || profile.analysisJobId !== analysis.id
        || profile.sourceFingerprint !== sourceFingerprint) {
        throw new ConflictException({
          code: 'GENERATION_PROFILE_APPROVED_STYLE_STALE', message: 'The approved profile does not match the current source',
        });
      }
      const invalid = () => new ConflictException({
        code: 'GENERATION_PROFILE_APPROVED_STYLE_INVALID', message: 'The approved writing style is not readable',
      });
      let section: CreatorGenerationProfileSection;
      try {
        const positiveInteger = (value: number) => Number.isSafeInteger(value) && value > 0;
        if (!positiveInteger(manuscript.version) || !positiveInteger(analysis.analysisVersion)
          || !positiveInteger(profile.profileVersion) || !positiveInteger(profile.reviewRevision)
          || !STORY_LOCALES.includes(manuscript.locale as typeof STORY_LOCALES[number])
          || !/^[a-f0-9]{64}$/i.test(manuscript.contentHash)
          || typeof analysis.configHash !== 'string' || !/^[a-f0-9]{64}$/i.test(analysis.configHash)
          || profile.approvedByUserId !== userId || !(profile.approvedAt instanceof Date)
          || !Number.isFinite(profile.approvedAt.getTime())) throw invalid();
        const settings = normalizeCreatorGenerationProfile('story', profile.approvedSettings);
        assertCreatorGenerationProfileApprovable(settings);
        continuationGenerationProfileApprovalPin(profile);
        section = settings.sections.find(item => item.key === 'writing_style')!;
        const storedSections = this.record(profile.approvedSettings).sections;
        const storedStyle = Array.isArray(storedSections)
          ? storedSections.find(item => this.record(item).key === 'writing_style') : undefined;
        if (stableJson(storedStyle) !== stableJson(section)) throw invalid();
      } catch {
        throw invalid();
      }
      return {
        version: 'story-author-approved-style-v1' as const,
        sourceScope: 'latest_private_manuscript_completed_analysis' as const,
        locale: manuscript.locale, manuscriptVersion: manuscript.version, analysisVersion: analysis.analysisVersion,
        profileVersion: profile.profileVersion, reviewRevision: profile.reviewRevision, section,
        readOnly: true as const, providerCalls: 0 as const, operatingWrites: 0 as const,
        bodySourceAligned: false as const, semanticQualityVerified: false as const,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async getOrCreate(userId: string, workId: string) {
    const source = await this.latestCompletedSource(userId, workId);
    let profile = await this.prisma.storyWorkGenerationProfile.findFirst({
      where: { workId, analysisJobId: source.analysis.id },
      orderBy: { profileVersion: 'desc' },
    });
    if (!profile) {
      try {
        profile = await this.prisma.$transaction(tx => this.createDraft(tx, userId, source));
      } catch (error) {
        if (!this.isUniqueViolation(error)) throw error;
        profile = await this.prisma.storyWorkGenerationProfile.findFirst({
          where: { workId, analysisJobId: source.analysis.id },
          orderBy: { profileVersion: 'desc' },
        });
        if (!profile) throw error;
      }
    }
    if (profile.status === 'needs_review') {
      try {
        const approved = await this.autoApproveCompany(userId, workId);
        if (approved) return approved;
      } catch (error) {
        this.logger.warn(`Company story profile remained in review: ${this.bootstrapErrorName(error)}`);
      }
    }
    return this.project(workId, source, profile);
  }

  async createDraftAtCompletion(tx: Prisma.TransactionClient, job: StoryAnalysisJob) {
    const userId = job.actorUserId;
    if (!userId || job.pipeline !== SEMANTIC_PIPELINE || job.status !== 'running' || job.phase !== 'finalizing')
      throw new Error('Invalid semantic profile source');
    const work = await tx.storyWork.findFirst({
      where: { id: job.workId, ownerUserId: userId }, select: { id: true },
    });
    const manuscript = await tx.storyManuscriptVersion.findFirst({
      where: { id: job.manuscriptVersionId, workId: job.workId, ownerUserId: userId },
      select: { id: true, version: true, locale: true, contentHash: true, structuredBody: true },
    });
    if (!work || !manuscript || manuscript.contentHash !== job.sourceContentHash)
      throw new Error('Invalid semantic profile source');
    return this.createDraft(tx, userId, { work, manuscript, analysis: {
      id: job.id, analysisVersion: job.analysisVersion, sourceContentHash: job.sourceContentHash,
      configHash: job.configHash, totalParts: job.totalParts, totalParagraphs: job.totalParagraphs,
    } });
  }

  private async createDraft(
    tx: Prisma.TransactionClient,
    userId: string,
    source: Awaited<ReturnType<StoryGenerationProfileService['latestCompletedSource']>>,
  ) {
    const workId = source.work.id;
    const owned = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM story_works WHERE id=${workId}::uuid AND owner_user_id=${userId}::uuid FOR UPDATE
    `;
    if (!owned.length) throw new NotFoundException('Story work not found');
    const replay = await tx.storyWorkGenerationProfile.findFirst({
      where: { workId, analysisJobId: source.analysis.id }, orderBy: { profileVersion: 'desc' },
    });
    if (replay) return replay;
    const current = await tx.storyWorkGenerationProfile.findFirst({
      where: { workId }, orderBy: { profileVersion: 'desc' },
    });
    const settings = await this.settingsFromAnalysis(tx, source.analysis.id, source.manuscript);
    const sourceFingerprint = this.sourceFingerprint(source);
    const draftFingerprint = creatorGenerationProfileFingerprint(sourceFingerprint, settings);
    const created = await tx.storyWorkGenerationProfile.create({ data: {
      workId, ownerUserId: userId,
      manuscriptVersionId: source.manuscript.id, analysisJobId: source.analysis.id,
      sourceFingerprint, profileVersion: (current?.profileVersion ?? 0) + 1,
      status: 'needs_review', draftSettings: settings as unknown as Prisma.InputJsonValue, draftFingerprint,
    } });
    await this.invalidateOlderWorkSnapshots(tx, userId, workId);
    await tx.auditEvent.create({ data: {
      actorUserId: created.ownerUserId, actorType: 'system',
      action: 'story_generation_profile.analysis_draft_created',
      targetType: 'story_work_generation_profile', targetId: created.id,
      afterData: { status: created.status, profileVersion: created.profileVersion, draftFingerprint },
      metadata: { workId, manuscriptVersionId: source.manuscript.id, analysisJobId: source.analysis.id },
    } });
    return created;
  }

  async update(userId: string, workId: string, input: UpdateStoryGenerationProfileDto) {
    const settings = normalizeCreatorGenerationProfile('story', input.settings);
    const source = await this.latestCompletedSource(userId, workId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${workId}::uuid FOR UPDATE`);
      const current = await tx.storyWorkGenerationProfile.findFirst({
        where: { workId },
        orderBy: { profileVersion: 'desc' },
      });
      if (!current || current.analysisJobId !== source.analysis.id) {
        throw new ConflictException({
          code: 'GENERATION_PROFILE_SOURCE_CHANGED',
          message: 'Load the latest manuscript analysis before saving the profile',
        });
      }
      const previous = normalizeCreatorGenerationProfile('story', current.draftSettings);
      for (const section of settings.sections) {
        const visualControlsReviewed = section.value.visualReviewVersion === STORY_VISUAL_REVIEW_VERSION;
        // This request marker must not survive into an older client's next read.
        if (section.key === 'visual_direction' || section.key === 'visual_cast') delete section.value.visualReviewVersion;
        const prior = previous.sections.find(item => item.key === section.key);
        if (section.decision !== 'edited' || !prior || section.value.summary === prior.value.summary) continue;
        // A summary-only correction supersedes untouched AI interpretations.
        // Explicitly replaced observations and their source evidence remain valid.
        for (const field of ['observations', 'categories']) {
          if (Array.isArray(section.value[field]) &&
              stableJson(section.value[field]) === stableJson(prior.value[field])) section.value[field] = [];
        }
        // Older summary-only clients cannot silently retain unshown visual anchors.
        if (!visualControlsReviewed) {
          for (const field of ['visualBible', 'characters']) {
            if (section.value[field] !== undefined && stableJson(section.value[field]) === stableJson(prior.value[field])) {
              delete section.value[field];
            }
          }
        }
      }
      assertStoryVisualSettings(settings);
      const draftFingerprint = creatorGenerationProfileFingerprint(current.sourceFingerprint, settings);
      const data = {
        status: 'needs_review',
        draftSettings: settings as unknown as Prisma.InputJsonValue,
        draftFingerprint,
        approvedSettings: Prisma.DbNull,
        approvedFingerprint: null,
        approvedByUserId: null,
        approvedAt: null,
        updatedAt: new Date(),
      };
      const profile = current.status === 'approved'
        ? await tx.storyWorkGenerationProfile.create({
            data: {
              workId,
              ownerUserId: userId,
              manuscriptVersionId: current.manuscriptVersionId,
              analysisJobId: current.analysisJobId,
              sourceFingerprint: current.sourceFingerprint,
              profileVersion: current.profileVersion + 1,
              ...data,
            },
          })
        : await tx.storyWorkGenerationProfile.update({ where: { id: current.id }, data });
      await this.invalidateOlderWorkSnapshots(tx, userId, workId);
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          actorType: 'user',
          action: 'story_generation_profile.draft_saved',
          targetType: 'story_work_generation_profile',
          targetId: profile.id,
          beforeData: {
            status: current.status,
            profileVersion: current.profileVersion,
            draftFingerprint: current.draftFingerprint,
          },
          afterData: {
            status: profile.status,
            profileVersion: profile.profileVersion,
            draftFingerprint: profile.draftFingerprint,
          },
          metadata: { workId, analysisJobId: source.analysis.id },
        },
      });
      return this.project(workId, source, profile);
    });
  }

  async approve(userId: string, workId: string, input: ApproveCreatorGenerationProfileDto) {
    const source = await this.latestCompletedSource(userId, workId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${workId}::uuid FOR UPDATE`);
      const current = await tx.storyWorkGenerationProfile.findFirst({
        where: { workId },
        orderBy: { profileVersion: 'desc' },
      });
      if (!current || current.analysisJobId !== source.analysis.id) {
        throw new ConflictException({
          code: 'GENERATION_PROFILE_SOURCE_CHANGED',
          message: 'Load the latest manuscript analysis before approval',
        });
      }
      if (current.status !== 'needs_review' || current.draftFingerprint !== input.expectedDraftFingerprint) {
        throw new ConflictException({
          code: 'GENERATION_PROFILE_DRAFT_CHANGED',
          message: 'Review the latest generation profile before approval',
        });
      }
      const settings = normalizeCreatorGenerationProfile('story', current.draftSettings);
      assertCreatorGenerationProfileApprovable(settings);
      assertStoryVisualSettings(settings);
      this.assertGenerationContextFits(current, settings, creatorGenerationProfileFingerprint(current.sourceFingerprint, settings));
      const updated = await tx.storyWorkGenerationProfile.updateMany({
        where: {
          id: current.id,
          status: 'needs_review',
          draftFingerprint: input.expectedDraftFingerprint,
          sourceFingerprint: this.sourceFingerprint(source),
        },
        data: {
          status: 'approved',
          approvedSettings: settings as unknown as Prisma.InputJsonValue,
          approvedFingerprint: current.draftFingerprint,
          approvedByUserId: userId,
          approvedAt: new Date(),
          reviewRevision: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'GENERATION_PROFILE_DRAFT_CHANGED',
          message: 'Review the latest generation profile before approval',
        });
      }
      await this.invalidateOlderWorkSnapshots(tx, userId, workId);
      const profile = await tx.storyWorkGenerationProfile.findUniqueOrThrow({ where: { id: current.id } });
      const approvedMemoryCount = await this.persistApprovedMemories(tx, source, profile.id, settings);
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          actorType: 'user',
          action: 'story_generation_profile.approved',
          targetType: 'story_work_generation_profile',
          targetId: profile.id,
          beforeData: { status: current.status, reviewRevision: current.reviewRevision },
          afterData: {
            status: profile.status,
            profileVersion: profile.profileVersion,
            reviewRevision: profile.reviewRevision,
            approvedFingerprint: profile.approvedFingerprint,
          },
          metadata: { workId, analysisJobId: source.analysis.id, approvedMemoryCount },
        },
      });
      return this.project(workId, source, profile);
    });
  }

  private async invalidateOlderWorkSnapshots(tx: Prisma.TransactionClient, userId: string, workId: string) {
    // A row lock alone cannot invalidate a Serializable snapshot waiting on a newly inserted profile.
    const changed = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE story_works SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ${workId}::uuid AND owner_user_id = ${userId}::uuid RETURNING id
    `);
    if (!changed.length) throw new NotFoundException('Story work not found');
  }

  private async persistApprovedMemories(
    tx: Prisma.TransactionClient,
    source: Awaited<ReturnType<StoryGenerationProfileService['latestCompletedSource']>>,
    profileId: string,
    settings: CreatorGenerationProfileSettings,
  ) {
    const sectionTypes: Record<string, string[]> = {
      writing_style: ['style'],
      canon: ['entity', 'background'],
      timeline: ['event'],
      narrative_devices: ['foreshadow', 'payoff'],
    };
    const reviewed = settings.sections
      .filter((section) => ['accepted', 'edited'].includes(section.decision) && sectionTypes[section.key])
      .map((section) => ({ section, observations: Array.isArray(section.value.observations)
        ? section.value.observations : [] }));
    const ids = [...new Set(reviewed.flatMap(({ observations }) => observations.flatMap((value) => {
      const ref = this.record(value).sourceRef;
      return typeof ref === 'string' && /^analysis:[0-9a-f-]{36}$/i.test(ref) ? [ref.slice(9)] : [];
    })))];
    const evidence = ids.length ? await tx.storyAnalysisEvidence.findMany({
      where: { id: { in: ids }, analysisJobId: source.analysis.id, provenance: 'semantic_candidate' },
      select: { id: true, evidenceType: true, sourcePartKey: true },
    }) : [];
    const evidenceById = new Map(evidence.map((row) => [row.id, row]));
    const memories: Prisma.StoryMemoryRecordCreateManyInput[] = [];
    const used = new Set<string>();
    for (const { section, observations } of reviewed) {
      const valid = observations.flatMap((value) => {
        const observation = this.record(value);
        const ref = observation.sourceRef;
        const row = typeof ref === 'string' ? evidenceById.get(ref.slice(9)) : undefined;
        const detail = this.text(observation.detail, 320);
        if (!row || !detail || !sectionTypes[section.key].includes(row.evidenceType) || used.has(row.id)) return [];
        used.add(row.id);
        return [{ row, detail, title: this.text(observation.title, 80) }];
      });
      for (const { row, detail, title } of this.spread(valid, 6)) {
        const memoryType = section.key === 'writing_style' ? 'style'
          : section.key === 'canon' ? 'entity' : section.key === 'timeline' ? 'event' : 'foreshadow';
        memories.push({
          workId: source.work.id,
          analysisJobId: source.analysis.id,
          manuscriptVersionId: source.manuscript.id,
          memoryType,
          memoryKey: `profile:${profileId}:${row.id}`,
          partKey: row.sourcePartKey,
          content: { [source.manuscript.locale]: title ? `${title}: ${detail}` : detail },
          evidenceIds: [row.id],
          provenance: 'writer_approved_semantic',
          status: 'approved',
        });
      }
    }
    await tx.storyMemoryRecord.updateMany({
      where: { workId: source.work.id, analysisJobId: source.analysis.id,
        provenance: 'writer_approved_semantic', status: 'approved' },
      data: { status: 'superseded' },
    });
    if (memories.length) await tx.storyMemoryRecord.createMany({ data: memories });
    return memories.length;
  }

  private async latestCompletedSource(userId: string, workId: string) {
    const work = await this.prisma.storyWork.findFirst({
      where: { id: workId, ownerUserId: userId },
      select: { id: true },
    });
    if (!work) throw new NotFoundException('Story work not found');
    const manuscript = await this.prisma.storyManuscriptVersion.findFirst({
      where: { workId, ownerUserId: userId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, locale: true, contentHash: true, structuredBody: true },
    });
    if (!manuscript) {
      throw new ConflictException({
        code: 'GENERATION_PROFILE_MANUSCRIPT_REQUIRED',
        message: 'Submit a manuscript before reviewing generation settings',
      });
    }
    const analysis = await this.prisma.storyAnalysisJob.findFirst({
      where: {
        workId,
        manuscriptVersionId: manuscript.id,
        status: 'completed',
        pipeline: SEMANTIC_PIPELINE,
      },
      orderBy: { analysisVersion: 'desc' },
      select: {
        id: true,
        analysisVersion: true,
        sourceContentHash: true,
        configHash: true,
        totalParts: true,
        totalParagraphs: true,
      },
    });
    if (!analysis || analysis.sourceContentHash !== manuscript.contentHash) {
      throw new ServiceUnavailableException({
        code: 'GENERATION_PROFILE_ANALYSIS_REQUIRED',
        message: 'Complete analysis of the latest manuscript before reviewing generation settings',
      });
    }
    return { work, manuscript, analysis };
  }

  private async settingsFromAnalysis(
    db: Pick<Prisma.TransactionClient, 'storyAnalysisEvidence' | '$queryRaw'>,
    analysisJobId: string,
    manuscript: { id: string; version: number; locale: string; contentHash?: string; structuredBody: Prisma.JsonValue },
  ): Promise<CreatorGenerationProfileSettings> {
    const rows = await this.profileEvidence(db, analysisJobId);
    if (!rows.length) {
      throw new ServiceUnavailableException({
        code: 'GENERATION_PROFILE_ANALYSIS_EVIDENCE_MISSING',
        message: 'Completed analysis does not contain reviewable evidence',
      });
    }
    const byType = new Map<EvidenceType, ProfileEvidenceRow[]>();
    for (const type of EVIDENCE_TYPES) byType.set(type, []);
    for (const row of rows) {
      if (EVIDENCE_TYPES.includes(row.evidenceType as EvidenceType)) {
        byType.get(row.evidenceType as EvidenceType)!.push(row);
      }
    }
    const parts = this.manuscriptParts(manuscript.structuredBody);
    const section = (
      key: string,
      summary: string,
      observations: ProfileEvidenceRow[],
      extra: Record<string, unknown> = {},
    ): CreatorGenerationProfileSection => ({
      key,
      decision: 'proposed',
      value: {
        summary,
        observations: this.spread(observations, 20).map((row) => this.observation(row)),
        ...extra,
      },
      evidence: this.spread(observations, 20).map((row) => this.evidence(row)),
    });
    const styles = byType.get('style')!;
    const scenes = byType.get('scene')!;
    const backgrounds = byType.get('background')!;
    const entities = byType.get('entity')!;
    const events = byType.get('event')!;
    const foreshadow = byType.get('foreshadow')!;
    const payoff = byType.get('payoff')!;
    const settings: CreatorGenerationProfileSettings = {
      schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
      kind: 'story',
      sections: [
        section('writing_style', this.summary(styles, '원고에서 확인된 문체와 서술 리듬을 유지합니다.'), styles, {
          categories: this.styleCategories(styles),
          imitationBoundary: 'approved_work_only',
        }),
        section('scene_scale', `${parts.length}개 파트의 장면 밀도와 문단 길이를 기준으로 새 장면 분량을 맞춥니다.`, scenes, {
          partCount: parts.length,
          paragraphCount: parts.reduce((sum, part) => sum + part.paragraphs, 0),
          manuscriptVersion: manuscript.version,
        }),
        section('canon', this.summary([...entities, ...backgrounds], '인물, 장소, 세계관 설정을 원고와 일치시킵니다.'), [...entities, ...backgrounds]),
        section('timeline', this.summary(events, '사건의 선후 관계와 시간 흐름을 유지합니다.'), events),
        section('narrative_devices', this.summary([...foreshadow, ...payoff], '복선과 회수 여부를 경로 상태에 따라 추적합니다.'), [...foreshadow, ...payoff], {
          unresolvedForeshadowMustRemainTracked: true,
          impossiblePayoffMayBeReplanned: true,
        }),
        section('branch_behavior', '선택은 다음 장면의 사건과 관계를 실제로 바꾸며, 자연스러운 경우에만 기존 경로와 다시 합류합니다.', scenes, {
          maximumSuggestedChoices: 3,
          selectedChoiceMustMateriallyDiverge: true,
          rejoinOnlyWhenNarrativelyJustified: true,
          preserveSourceSegmentScale: true,
          firstReleaseCustomInput: false,
          futureCustomInputExpansion: true,
        }),
        section('visual_direction', this.summary(backgrounds, '시대, 장소, 시간대와 작품의 시각 분위기를 장면마다 유지합니다.'), backgrounds, {
          sceneImageMustMatchGeneratedText: true,
          lockEraPaletteAndRenderingStyle: true,
        }),
        section('visual_cast', this.summary(entities, '등장인물의 고정 외형과 장면별 의상·표정을 분리해 관리합니다.'), entities, {
          keepCharacterIdentityAcrossScenes: true,
          allowStorySpecificCostumeAndRendering: true,
          reserveParticipantCharacterLayer: true,
        }),
      ],
    };
    const reference = publicationVisualReference(manuscript.structuredBody, manuscript.contentHash);
    const direction = settings.sections.find(item => item.key === 'visual_direction')!;
    const cast = settings.sections.find(item => item.key === 'visual_cast')!;
    const bible = reference?.bible;
    direction.value.visualBible = { era: bible?.era ?? '', artStyle: bible?.artStyle ?? '',
      palette: bible?.palette ?? '', prohibited: bible?.prohibited ?? [] };
    cast.value.characters = bible?.characters ?? [];
    if (bible && reference) {
      for (const item of [direction, cast]) {
        item.value.sourceVisualChecksum = reference.checksum;
        item.evidence.unshift({ sourceType: 'visual', sourceRef: `publication-visual:${reference.checksum}`,
          summary: item.key === 'visual_direction'
            ? [bible.era, bible.artStyle, bible.palette].filter(Boolean).join(' / ').slice(0, 1000)
            : bible.characters.map(character => character.name).join(', ').slice(0, 1000) });
        item.evidence = item.evidence.slice(0, 20);
      }
    }
    assertStoryVisualSettings(settings);
    return normalizeCreatorGenerationProfile('story', settings);
  }

  private async profileEvidence(
    db: Pick<Prisma.TransactionClient, 'storyAnalysisEvidence' | '$queryRaw'>,
    analysisJobId: string,
  ): Promise<ProfileEvidenceRow[]> {
    const where: Prisma.StoryAnalysisEvidenceWhereInput = {
      analysisJobId, provenance: 'semantic_candidate', evidenceType: { in: [...EVIDENCE_TYPES] },
    };
    const select = {
      id: true, evidenceType: true, sourcePartKey: true, sourceParagraphIndex: true, payload: true,
    } as const;
    const orderBy = [{ sequence: 'asc' as const }, { id: 'asc' as const }];
    const total = await db.storyAnalysisEvidence.count({ where });
    if (total <= 5000) {
      return db.storyAnalysisEvidence.findMany({ where, orderBy, select, take: 5000 });
    }

    // One bounded query keeps finalization inside its short transaction while covering late parts.
    return db.$queryRaw<ProfileEvidenceRow[]>(Prisma.sql`
      WITH ranked AS (
        SELECT id, evidence_type,
          ROW_NUMBER() OVER (PARTITION BY evidence_type ORDER BY evidence_sequence ASC NULLS LAST, id) AS ordinal,
          COUNT(*) OVER (PARTITION BY evidence_type) AS type_count
        FROM story_analysis_evidence
        WHERE analysis_job_id = ${analysisJobId}::uuid AND provenance = 'semantic_candidate'
          AND evidence_type IN (${Prisma.join([...EVIDENCE_TYPES])})
      ), sampled AS (
        SELECT id, evidence_type, ordinal FROM ranked
        WHERE type_count <= 250 OR ordinal = 1 OR ordinal = type_count
          OR MOD(ordinal - 1, GREATEST(1, CEIL((type_count - 1)::numeric / 249)::bigint)) = 0
      )
      SELECT evidence.id, evidence.evidence_type AS "evidenceType",
        evidence.source_part_key AS "sourcePartKey",
        evidence.source_paragraph_index AS "sourceParagraphIndex", evidence.payload
      FROM sampled JOIN story_analysis_evidence AS evidence ON evidence.id = sampled.id
      ORDER BY sampled.evidence_type, sampled.ordinal
    `);
  }

  private project(
    workId: string,
    source: Awaited<ReturnType<StoryGenerationProfileService['latestCompletedSource']>>,
    profile: Parameters<typeof creatorGenerationProfileProjection>[0],
  ) {
    return {
      workId,
      manuscript: {
        id: source.manuscript.id,
        version: source.manuscript.version,
        locale: source.manuscript.locale,
        contentHash: source.manuscript.contentHash,
      },
      analysis: {
        id: source.analysis.id,
        version: source.analysis.analysisVersion,
        complete: true,
      },
      profile: creatorGenerationProfileProjection(profile),
    };
  }

  private assertGenerationContextFits(profile: { id: string; profileVersion: number; reviewRevision: number;
    sourceFingerprint: string }, settings: CreatorGenerationProfileSettings, fingerprint: string) {
    try {
      continuationGenerationProfileSnapshot({ ...profile, reviewRevision: profile.reviewRevision + 1,
        status: 'approved', approvedSettings: settings as unknown as Prisma.JsonValue, approvedFingerprint: fingerprint });
    } catch {
      throw new ConflictException({ code: 'GENERATION_PROFILE_CONTEXT_INVALID',
        message: 'The reviewed settings must fit the complete generation context before approval' });
    }
  }

  private sourceFingerprint(source: Awaited<ReturnType<StoryGenerationProfileService['latestCompletedSource']>>) {
    return createHash('sha256').update(stableJson({
      workId: source.work.id,
      manuscriptVersionId: source.manuscript.id,
      contentHash: source.manuscript.contentHash,
      analysisJobId: source.analysis.id,
      analysisVersion: source.analysis.analysisVersion,
      analysisConfigHash: source.analysis.configHash,
    })).digest('hex');
  }

  private manuscriptParts(value: Prisma.JsonValue) {
    const root = this.record(value);
    const rawParts = Array.isArray(root.parts) ? root.parts : [];
    return rawParts.map((raw) => {
      const part = this.record(raw);
      return { paragraphs: Array.isArray(part.paragraphs) ? part.paragraphs.length : 0 };
    });
  }

  private observation(row: ProfileEvidenceRow) {
    const payload = this.record(row.payload);
    return {
      title: this.text(payload.title, 120) || row.evidenceType,
      detail: this.text(payload.observation, 1200) || '',
      sourceRef: `analysis:${row.id}`,
    };
  }

  private evidence(row: ProfileEvidenceRow): CreatorGenerationProfileEvidence {
    const payload = this.record(row.payload);
    return {
      sourceType: 'manuscript',
      sourceRef: `analysis:${row.id}:${row.sourcePartKey}:${row.sourceParagraphIndex}`.slice(0, 300),
      summary: this.text(payload.observation, 1000) || this.text(payload.title, 120) || row.evidenceType,
    };
  }

  private summary(rows: ProfileEvidenceRow[], fallback: string) {
    const observations = this.spread(rows, 3)
      .map((row) => this.text(this.record(row.payload).observation, 320))
      .filter((value): value is string => Boolean(value));
    return observations.length ? observations.join(' ') : fallback;
  }

  private styleCategories(rows: ProfileEvidenceRow[]) {
    const categories = new Map<string, string[]>();
    for (const row of this.spread(rows, 40)) {
      const payload = this.record(row.payload);
      const category = this.text(payload.styleCategory, 40) || 'other';
      const observation = this.text(payload.observation, 500);
      if (!observation) continue;
      const values = categories.get(category) ?? [];
      if (values.length < 8) values.push(observation);
      categories.set(category, values);
    }
    return [...categories].map(([category, observations]) => ({ category, observations }));
  }

  private spread<T>(items: T[], limit: number) {
    if (items.length <= limit) return items;
    const selected: T[] = [];
    for (let index = 0; index < limit; index += 1) {
      selected.push(items[Math.round(index * (items.length - 1) / (limit - 1))]);
    }
    return selected;
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private text(value: unknown, maximum: number) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text && text.length <= maximum ? text : text.slice(0, maximum).trim() || null;
  }

  private isUniqueViolation(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
