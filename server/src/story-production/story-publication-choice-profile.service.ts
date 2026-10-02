import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';
import { stableJson } from '../generation-profile/creator-generation-profile.policy';

type Database = PrismaService | Prisma.TransactionClient;
type ApprovedProfile = NonNullable<Awaited<ReturnType<StoryStudioChoicePreparationService['approvedGenerationProfile']>>>;
export type PublicationChoiceProfileBinding = {
  workId: string;
  manuscriptVersionId: string;
  manuscriptHash: string;
  consentId: string;
  consentRevision: number;
  generationProfilePin: ApprovedProfile['pin'];
  generationProfileViewVersion: string;
};

function fail(code: string): never {
  throw new ConflictException({ code, message: 'Author settings must be reviewed before preparing publication choices' });
}

@Injectable()
export class StoryPublicationChoiceProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async forWork(db: Database, workId: string, options: {
    manuscriptHash?: string; releaseId?: string; lock?: boolean;
  } = {}): Promise<{ binding: PublicationChoiceProfileBinding; approved: ApprovedProfile['approved'] } | null> {
    if (!db.storyWorkGenerationProfile) return null;
    if (options.lock) {
      await db.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${workId}::uuid FOR SHARE`);
      await db.$queryRaw(Prisma.sql`SELECT id FROM story_work_generation_profiles WHERE work_id = ${workId}::uuid FOR SHARE`);
      await db.$queryRaw(Prisma.sql`SELECT id FROM story_style_profile_consents WHERE work_id = ${workId}::uuid FOR SHARE`);
    }
    const work = await db.storyWork.findUnique({ where: { id: workId },
      select: { id: true, ownerUserId: true, fixtureSource: true, activeReleaseId: true, status: true } });
    if (!work || work.fixtureSource) throw new NotFoundException('Story work not found');
    if (options.releaseId && (work.status !== 'published' || work.activeReleaseId !== options.releaseId)) {
      fail('STORY_PUBLICATION_CHOICE_SOURCE_CHANGED');
    }
    const manuscript = await db.storyManuscriptVersion.findFirst({ where: { workId },
      orderBy: { version: 'desc' }, select: { id: true, ownerUserId: true, contentHash: true, locale: true } });
    if (!manuscript || manuscript.ownerUserId !== work.ownerUserId || manuscript.locale !== 'ko' ||
        (options.manuscriptHash && options.manuscriptHash !== manuscript.contentHash)) {
      fail('STORY_PUBLICATION_PROFILE_SOURCE_MISMATCH');
    }
    if (options.releaseId) {
      const release = await db.storyRelease.findFirst({ where: { id: options.releaseId, workId, status: 'active' },
        select: { manuscriptVersionId: true } });
      if (!release || release.manuscriptVersionId !== manuscript.id) fail('STORY_PUBLICATION_PROFILE_SOURCE_MISMATCH');
    }
    const latestAnalysis = await db.storyAnalysisJob.findFirst({ where: {
      workId, manuscriptVersionId: manuscript.id, pipeline: SEMANTIC_PIPELINE,
    }, orderBy: { analysisVersion: 'desc' }, select: { id: true, status: true, sourceLocale: true,
      totalParagraphs: true, plannedParagraphs: true, completedParagraphs: true } });
    if (latestAnalysis && (latestAnalysis.status !== 'completed' || latestAnalysis.sourceLocale !== 'ko' ||
        latestAnalysis.totalParagraphs < 1 || latestAnalysis.plannedParagraphs !== latestAnalysis.totalParagraphs ||
        latestAnalysis.completedParagraphs !== latestAnalysis.totalParagraphs)) {
      fail('STORY_PUBLICATION_PROFILE_ANALYSIS_NOT_READY');
    }
    const profile = await new StoryStudioChoicePreparationService(this.prisma).approvedGenerationProfile(
      db, work.ownerUserId, workId, manuscript, latestAnalysis?.id ?? '');
    // Existing company imports with no semantic analysis retain their legacy contract.
    if (!profile) return null;
    const consent = await db.storyStyleProfileConsent.findUnique({ where: { workId } });
    const now = new Date();
    if (!consent || consent.ownerUserId !== work.ownerUserId || consent.manuscriptVersionId !== manuscript.id ||
        consent.status !== 'active' || !consent.rightsConfirmed || !consent.aiBranchAllowed ||
        consent.startsAt > now || (consent.expiresAt && consent.expiresAt <= now) ||
        !Array.isArray(consent.allowedLocales) || !consent.allowedLocales.includes('ko')) {
      fail('STORY_PUBLICATION_PROFILE_CONSENT_REQUIRED');
    }
    return { binding: { workId, manuscriptVersionId: manuscript.id, manuscriptHash: manuscript.contentHash,
      consentId: consent.id, consentRevision: consent.revision, generationProfilePin: profile.pin,
      generationProfileViewVersion: profile.viewVersion }, approved: profile.approved };
  }

  async forPlan(db: Database, plan: { slug: string; manuscript: { contentHash: string } }, lock = false) {
    if (!db.storyWorkGenerationProfile) return null;
    const work = await db.storyWork.findUnique({ where: { slug: plan.slug }, select: { id: true } });
    return work ? this.forWork(db, work.id, { manuscriptHash: plan.manuscript.contentHash, lock }) : null;
  }

  assertSame(expected: PublicationChoiceProfileBinding | null | undefined,
    current: PublicationChoiceProfileBinding | null | undefined) {
    if (stableJson(expected ?? null) !== stableJson(current ?? null)) fail('STORY_PUBLICATION_CHOICE_SETTINGS_CHANGED');
  }
}
