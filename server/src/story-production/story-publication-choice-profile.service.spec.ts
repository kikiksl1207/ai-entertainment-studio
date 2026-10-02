import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
  stableJson,
} from '../generation-profile/creator-generation-profile.policy';
import {
  STORY_CONTINUATION_PROFILE_VIEW_VERSION,
  continuationGenerationProfileSnapshot,
} from './story-continuation-context.policy';
import {
  PublicationChoiceProfileBinding,
  StoryPublicationChoiceProfileService,
} from './story-publication-choice-profile.service';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';

const NOW = new Date('2026-09-30T04:00:00.000Z');

function fixture() {
  const ids = {
    work: randomUUID(), owner: randomUUID(), manuscript: randomUUID(),
    release: randomUUID(), analysis: randomUUID(), consent: randomUUID(), profile: randomUUID(),
  };
  const work = { id: ids.work, ownerUserId: ids.owner, fixtureSource: false,
    status: 'published', activeReleaseId: ids.release };
  const manuscript = { id: ids.manuscript, ownerUserId: ids.owner,
    contentHash: createHash('sha256').update('latest authored manuscript').digest('hex'), locale: 'ko' };
  const analysis = { id: ids.analysis, workId: ids.work, manuscriptVersionId: ids.manuscript,
    status: 'completed', pipeline: SEMANTIC_PIPELINE, sourceContentHash: manuscript.contentHash,
    sourceLocale: 'ko', totalParagraphs: 1, plannedParagraphs: 1, completedParagraphs: 1,
    analysisVersion: 2, configHash: 'semantic-analysis-config' };
  const sourceFingerprint = createHash('sha256').update(stableJson({ workId: ids.work,
    manuscriptVersionId: ids.manuscript, contentHash: manuscript.contentHash,
    analysisJobId: ids.analysis, analysisVersion: analysis.analysisVersion,
    analysisConfigHash: analysis.configHash })).digest('hex');
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted',
      value: { summary: `Approved ${key}` }, evidence: [],
    })),
  });
  const profile = { id: ids.profile, workId: ids.work, ownerUserId: ids.owner,
    manuscriptVersionId: ids.manuscript, analysisJobId: ids.analysis, sourceFingerprint,
    status: 'approved', profileVersion: 2, reviewRevision: 3,
    approvedSettings: settings as unknown as Prisma.JsonValue | null,
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings) as string | null,
    approvedByUserId: ids.owner as string | null,
    approvedAt: new Date('2026-09-30T03:00:00.000Z') as Date | null,
    draftSettings: { summary: 'UNAPPROVED_DRAFT_MUST_NOT_BE_RETURNED' },
  };
  const consent = { id: ids.consent, ownerUserId: ids.owner, manuscriptVersionId: ids.manuscript,
    revision: 4, status: 'active', rightsConfirmed: true, aiBranchAllowed: true,
    startsAt: new Date(0), expiresAt: null as Date | null, allowedLocales: ['ko'] as Prisma.JsonValue };
  const release = { manuscriptVersionId: ids.manuscript };
  const db = {
    storyWork: { findUnique: jest.fn().mockResolvedValue(work) },
    storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue(manuscript) },
    storyRelease: { findFirst: jest.fn().mockResolvedValue(release) },
    storyAnalysisJob: { findFirst: jest.fn().mockResolvedValue(analysis) },
    storyWorkGenerationProfile: { findFirst: jest.fn().mockResolvedValue(profile) },
    storyStyleProfileConsent: { findUnique: jest.fn().mockResolvedValue(consent) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  return { ids, work, manuscript, analysis, settings, profile, consent, release, db,
    service: new StoryPublicationChoiceProfileService(db as never) };
}

type Fixture = ReturnType<typeof fixture>;

function expectedBinding(f: Fixture): PublicationChoiceProfileBinding {
  return {
    workId: f.ids.work, manuscriptVersionId: f.ids.manuscript, manuscriptHash: f.manuscript.contentHash,
    consentId: f.ids.consent, consentRevision: f.consent.revision,
    generationProfilePin: { ...continuationGenerationProfileSnapshot(f.profile).pin,
      manuscriptVersionId: f.ids.manuscript, analysisJobId: f.ids.analysis,
      analysisVersion: f.analysis.analysisVersion, approvedByUserId: f.ids.owner,
      approvedAt: f.profile.approvedAt!.toISOString() },
    generationProfileViewVersion: STORY_CONTINUATION_PROFILE_VIEW_VERSION,
  };
}

function makeLegacy(f: Fixture) {
  f.db.storyWorkGenerationProfile.findFirst.mockResolvedValue(null);
  f.db.storyAnalysisJob.findFirst.mockResolvedValue(null);
}

describe('StoryPublicationChoiceProfileService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('forWork', () => {
    it('returns the real approved projection and full author, manuscript, consent and approval binding', async () => {
      const f = fixture();
      const approval = jest.spyOn(StoryStudioChoicePreparationService.prototype, 'approvedGenerationProfile');
      const result = await f.service.forWork(f.db as never, f.ids.work, {
        manuscriptHash: f.manuscript.contentHash, releaseId: f.ids.release,
      });
      expect(result).toEqual({ binding: expectedBinding(f),
        approved: continuationGenerationProfileSnapshot(f.profile).approved });
      expect(JSON.stringify(result)).not.toContain('UNAPPROVED_DRAFT');
      expect(approval).toHaveBeenCalledWith(f.db, f.ids.owner, f.ids.work, f.manuscript, f.ids.analysis);
      expect(f.db.storyManuscriptVersion.findFirst).toHaveBeenCalledWith({ where: { workId: f.ids.work },
        orderBy: { version: 'desc' },
        select: { id: true, ownerUserId: true, contentHash: true, locale: true } });
      expect(f.db.storyAnalysisJob.findFirst).toHaveBeenNthCalledWith(1, { where: {
        workId: f.ids.work, manuscriptVersionId: f.ids.manuscript, pipeline: SEMANTIC_PIPELINE,
      }, orderBy: { analysisVersion: 'desc' }, select: { id: true, status: true, sourceLocale: true,
        totalParagraphs: true, plannedParagraphs: true, completedParagraphs: true } });
      expect(f.db.storyAnalysisJob.findFirst).toHaveBeenNthCalledWith(2, { where: {
        workId: f.ids.work, manuscriptVersionId: f.ids.manuscript,
        pipeline: SEMANTIC_PIPELINE,
      }, orderBy: { analysisVersion: 'desc' } });
      expect(f.db.storyRelease.findFirst).toHaveBeenCalledWith({
        where: { id: f.ids.release, workId: f.ids.work, status: 'active' },
        select: { manuscriptVersionId: true },
      });
      expect(f.db.$queryRaw).not.toHaveBeenCalled();
    });

    it('reads the supplied transaction instead of the constructor database', async () => {
      const f = fixture();
      const rootDb = { storyWork: { findUnique: jest.fn() } };
      const service = new StoryPublicationChoiceProfileService(rootDb as never);
      await expect(service.forWork(f.db as never, f.ids.work)).resolves.toMatchObject({
        binding: expectedBinding(f),
      });
      expect(rootDb.storyWork.findUnique).not.toHaveBeenCalled();
    });

    it.each<[string, (f: Fixture) => void]>([
      ['missing work', f => { f.db.storyWork.findUnique.mockResolvedValue(null); }],
      ['fixture work', f => { f.work.fixtureSource = true; }],
    ])('rejects a %s without falling back to legacy', async (_name, mutate) => {
      const f = fixture();
      mutate(f);
      await expect(f.service.forWork(f.db as never, f.ids.work)).rejects.toBeInstanceOf(NotFoundException);
      expect(f.db.storyManuscriptVersion.findFirst).not.toHaveBeenCalled();
      expect(f.db.storyWorkGenerationProfile.findFirst).not.toHaveBeenCalled();
    });

    it('returns null only for a work with neither a generation profile nor semantic analysis', async () => {
      const f = fixture();
      makeLegacy(f);
      f.db.storyStyleProfileConsent.findUnique.mockResolvedValue(null);
      await expect(f.service.forWork(f.db as never, f.ids.work)).resolves.toBeNull();
      expect(f.db.storyWorkGenerationProfile.findFirst).toHaveBeenCalled();
      expect(f.db.storyAnalysisJob.findFirst).toHaveBeenCalledTimes(2);
      expect(f.db.storyStyleProfileConsent.findUnique).not.toHaveBeenCalled();
    });

    it('requires an approved profile when completed semantic analysis exists', async () => {
      const f = fixture();
      f.db.storyWorkGenerationProfile.findFirst.mockResolvedValue(null);
      await expect(f.service.forWork(f.db as never, f.ids.work)).rejects.toMatchObject({
        response: { code: 'STUDIO_CHOICES_GENERATION_PROFILE_APPROVAL_REQUIRED' },
      });
      expect(f.db.storyStyleProfileConsent.findUnique).not.toHaveBeenCalled();
    });

    it('does not treat an approved profile with missing analysis as legacy', async () => {
      const f = fixture();
      f.db.storyAnalysisJob.findFirst.mockResolvedValue(null);
      await expect(f.service.forWork(f.db as never, f.ids.work)).rejects.toMatchObject({
        response: { code: 'STUDIO_CHOICES_GENERATION_PROFILE_SOURCE_MISMATCH' },
      });
    });

    it.each<[string, (f: Fixture) => void]>([
      ['draft profile', f => { f.profile.status = 'draft'; }],
      ['unapproved profile', f => { f.profile.status = 'needs_review'; }],
      ['another profile owner', f => { f.profile.ownerUserId = randomUUID(); }],
      ['another approving user', f => { f.profile.approvedByUserId = randomUUID(); }],
      ['another profile work', f => { f.profile.workId = randomUUID(); }],
      ['missing approval timestamp', f => { f.profile.approvedAt = null; }],
      ['unversioned profile', f => { f.profile.profileVersion = 0; }],
      ['unreviewed profile', f => { f.profile.reviewRevision = 0; }],
    ])('rejects %s through the shared approval validator', async (_name, mutate) => {
      const f = fixture();
      mutate(f);
      await expect(f.service.forWork(f.db as never, f.ids.work)).rejects.toMatchObject({
        response: { code: 'STUDIO_CHOICES_GENERATION_PROFILE_APPROVAL_REQUIRED' },
      });
      expect(f.db.storyStyleProfileConsent.findUnique).not.toHaveBeenCalled();
    });

    it.each<[string, (f: Fixture) => void]>([
      ['missing approved settings', f => { f.profile.approvedSettings = null; }],
      ['missing approved fingerprint', f => { f.profile.approvedFingerprint = null; }],
      ['tampered approved fingerprint', f => { f.profile.approvedFingerprint = '0'.repeat(64); }],
      ['tampered approved settings', f => { f.settings.sections[0].value.summary = 'Unapproved replacement'; }],
    ])('rejects %s instead of returning the draft', async (_name, mutate) => {
      const f = fixture();
      mutate(f);
      await expect(f.service.forWork(f.db as never, f.ids.work)).rejects.toMatchObject({
        response: { code: 'STUDIO_CHOICES_GENERATION_PROFILE_INVALID' },
      });
      expect(f.db.storyStyleProfileConsent.findUnique).not.toHaveBeenCalled();
    });

    it.each<[string, (f: Fixture) => void]>([
      ['another profile manuscript', f => { f.profile.manuscriptVersionId = randomUUID(); }],
      ['another profile analysis', f => { f.profile.analysisJobId = randomUUID(); }],
      ['stale source fingerprint', f => { f.profile.sourceFingerprint = '0'.repeat(64); }],
      ['analysis for another work', f => { f.analysis.workId = randomUUID(); }],
      ['analysis for another manuscript', f => { f.analysis.manuscriptVersionId = randomUUID(); }],
      ['analysis of another content hash', f => { f.analysis.sourceContentHash = 'changed'; }],
      ['new analysis version', f => { f.analysis.analysisVersion += 1; }],
      ['changed analysis configuration', f => { f.analysis.configHash = 'changed'; }],
    ])('rejects %s through the shared source validator', async (_name, mutate) => {
      const f = fixture();
      mutate(f);
      await expect(f.service.forWork(f.db as never, f.ids.work)).rejects.toMatchObject({
        response: { code: 'STUDIO_CHOICES_GENERATION_PROFILE_SOURCE_MISMATCH' },
      });
      expect(f.db.storyStyleProfileConsent.findUnique).not.toHaveBeenCalled();
    });

    it.each(['queued', 'running', 'failed'])('blocks the latest %s analysis even when an older completed analysis is approved', async status => {
      const f = fixture();
      const approval = jest.spyOn(StoryStudioChoicePreparationService.prototype, 'approvedGenerationProfile');
      const latest = { ...f.analysis, id: randomUUID(), analysisVersion: 3, status };
      f.db.storyAnalysisJob.findFirst.mockImplementation(async ({ where }) =>
        where.status === 'completed' ? f.analysis : latest);
      await expect(f.service.forWork(f.db as never, f.ids.work)).rejects.toMatchObject({
        response: { code: 'STORY_PUBLICATION_PROFILE_ANALYSIS_NOT_READY' },
      });
      expect(f.db.storyAnalysisJob.findFirst).toHaveBeenCalledTimes(1);
      expect(approval).not.toHaveBeenCalled();
      expect(f.db.storyStyleProfileConsent.findUnique).not.toHaveBeenCalled();
    });

    it.each<[string, (f: Fixture) => void]>([
      ['non-Korean analysis', f => { f.analysis.sourceLocale = 'en'; }],
      ['empty analysis', f => {
        f.analysis.totalParagraphs = 0;
        f.analysis.plannedParagraphs = 0;
        f.analysis.completedParagraphs = 0;
      }],
      ['negative paragraph counts', f => {
        f.analysis.totalParagraphs = -1;
        f.analysis.plannedParagraphs = -1;
        f.analysis.completedParagraphs = -1;
      }],
      ['unplanned paragraph', f => {
        f.analysis.totalParagraphs = 2;
        f.analysis.completedParagraphs = 2;
      }],
      ['unfinished paragraph', f => {
        f.analysis.totalParagraphs = 2;
        f.analysis.plannedParagraphs = 2;
      }],
      ['excess planned paragraphs', f => { f.analysis.plannedParagraphs = 2; }],
      ['excess completed paragraphs', f => { f.analysis.completedParagraphs = 2; }],
    ])('blocks a completed status with %s before shared approval validation', async (_name, mutate) => {
      const f = fixture();
      const approval = jest.spyOn(StoryStudioChoicePreparationService.prototype, 'approvedGenerationProfile');
      mutate(f);
      await expect(f.service.forWork(f.db as never, f.ids.work)).rejects.toMatchObject({
        response: { code: 'STORY_PUBLICATION_PROFILE_ANALYSIS_NOT_READY' },
      });
      expect(approval).not.toHaveBeenCalled();
      expect(f.db.storyWorkGenerationProfile.findFirst).not.toHaveBeenCalled();
      expect(f.db.storyStyleProfileConsent.findUnique).not.toHaveBeenCalled();
    });

    it.each<[string, (f: Fixture) => void]>([
      ['missing latest manuscript', f => { f.db.storyManuscriptVersion.findFirst.mockResolvedValue(null); }],
      ['latest manuscript owned by another user', f => { f.manuscript.ownerUserId = randomUUID(); }],
      ['non-Korean latest manuscript', f => { f.manuscript.locale = 'en'; }],
      ['different expected manuscript hash', f => { f.manuscript.contentHash = 'changed'; }],
    ])('blocks %s before checking approval', async (_name, mutate) => {
      const f = fixture();
      const manuscriptHash = f.manuscript.contentHash;
      mutate(f);
      await expect(f.service.forWork(f.db as never, f.ids.work, { manuscriptHash })).rejects.toMatchObject({
        response: { code: 'STORY_PUBLICATION_PROFILE_SOURCE_MISMATCH' },
      });
      expect(f.db.storyAnalysisJob.findFirst).not.toHaveBeenCalled();
      expect(f.db.storyWorkGenerationProfile.findFirst).not.toHaveBeenCalled();
    });

    it.each<[string, (f: Fixture) => void]>([
      ['unpublished work', f => { f.work.status = 'draft'; }],
      ['different active release', f => { f.work.activeReleaseId = randomUUID(); }],
    ])('blocks a requested release for %s', async (_name, mutate) => {
      const f = fixture();
      mutate(f);
      await expect(f.service.forWork(f.db as never, f.ids.work, { releaseId: f.ids.release })).rejects.toMatchObject({
        response: { code: 'STORY_PUBLICATION_CHOICE_SOURCE_CHANGED' },
      });
      expect(f.db.storyRelease.findFirst).not.toHaveBeenCalled();
      expect(f.db.storyWorkGenerationProfile.findFirst).not.toHaveBeenCalled();
    });

    it.each<[string, (f: Fixture) => void]>([
      ['missing active release', f => { f.db.storyRelease.findFirst.mockResolvedValue(null); }],
      ['active release using an older manuscript', f => { f.release.manuscriptVersionId = randomUUID(); }],
    ])('blocks %s', async (_name, mutate) => {
      const f = fixture();
      mutate(f);
      await expect(f.service.forWork(f.db as never, f.ids.work, { releaseId: f.ids.release })).rejects.toMatchObject({
        response: { code: 'STORY_PUBLICATION_PROFILE_SOURCE_MISMATCH' },
      });
      expect(f.db.storyAnalysisJob.findFirst).not.toHaveBeenCalled();
      expect(f.db.storyWorkGenerationProfile.findFirst).not.toHaveBeenCalled();
    });

    it.each<[string, (f: Fixture) => void]>([
      ['missing consent', f => { f.db.storyStyleProfileConsent.findUnique.mockResolvedValue(null); }],
      ['another consent owner', f => { f.consent.ownerUserId = randomUUID(); }],
      ['another consent manuscript', f => { f.consent.manuscriptVersionId = randomUUID(); }],
      ['revoked consent', f => { f.consent.status = 'revoked'; }],
      ['unconfirmed rights', f => { f.consent.rightsConfirmed = false; }],
      ['AI branches not allowed', f => { f.consent.aiBranchAllowed = false; }],
      ['future consent start', f => { f.consent.startsAt = new Date(NOW.getTime() + 1); }],
      ['consent expiring exactly now', f => { f.consent.expiresAt = NOW; }],
      ['expired consent', f => { f.consent.expiresAt = new Date(NOW.getTime() - 1); }],
      ['Korean not allowed', f => { f.consent.allowedLocales = ['en']; }],
      ['non-array locale permission', f => { f.consent.allowedLocales = 'ko'; }],
    ])('requires valid legal and locale consent: %s', async (_name, mutate) => {
      const f = fixture();
      mutate(f);
      await expect(f.service.forWork(f.db as never, f.ids.work)).rejects.toMatchObject({
        response: { code: 'STORY_PUBLICATION_PROFILE_CONSENT_REQUIRED' },
      });
      expect(f.db.storyStyleProfileConsent.findUnique).toHaveBeenCalledWith({ where: { workId: f.ids.work } });
    });

    it('accepts consent starting now and expiring later, and pins its current revision', async () => {
      const f = fixture();
      f.consent.startsAt = NOW;
      f.consent.expiresAt = new Date(NOW.getTime() + 1);
      f.consent.allowedLocales = ['en', 'ko'];
      f.consent.revision = 12;
      await expect(f.service.forWork(f.db as never, f.ids.work)).resolves.toMatchObject({
        binding: { consentId: f.ids.consent, consentRevision: 12 },
      });
    });

    it('locks the work, generation profile and consent before reading a binding', async () => {
      const f = fixture();
      await expect(f.service.forWork(f.db as never, f.ids.work, { lock: true })).resolves.toMatchObject({
        binding: expectedBinding(f),
      });
      expect(f.db.$queryRaw).toHaveBeenCalledTimes(3);
      const queries = f.db.$queryRaw.mock.calls.map(([query]) => query as Prisma.Sql);
      expect(queries.map(query => query.sql)).toEqual([
        expect.stringContaining('FROM story_works'),
        expect.stringContaining('FROM story_work_generation_profiles'),
        expect.stringContaining('FROM story_style_profile_consents'),
      ]);
      for (const query of queries) {
        expect(query.sql).toContain('FOR SHARE');
        expect(query.values).toEqual([f.ids.work]);
      }
      expect(Math.max(...f.db.$queryRaw.mock.invocationCallOrder))
        .toBeLessThan(f.db.storyWork.findUnique.mock.invocationCallOrder[0]);
    });

    it.each(['profile', 'analysis', 'consent'] as const)('propagates a %s lookup failure instead of treating it as legacy', async lookup => {
      const f = fixture();
      const error = new Error(`${lookup} lookup unavailable`);
      const delegate = { profile: f.db.storyWorkGenerationProfile.findFirst,
        analysis: f.db.storyAnalysisJob.findFirst, consent: f.db.storyStyleProfileConsent.findUnique }[lookup];
      delegate.mockRejectedValueOnce(error);
      await expect(f.service.forWork(f.db as never, f.ids.work)).rejects.toBe(error);
    });
  });

  describe('assertSame', () => {
    it('accepts identical bindings regardless of object key order', () => {
      const f = fixture();
      const expected = expectedBinding(f);
      const reordered = { ...expected, generationProfilePin:
        Object.fromEntries(Object.entries(expected.generationProfilePin).reverse()) as typeof expected.generationProfilePin };
      expect(() => f.service.assertSame(expected, reordered)).not.toThrow();
    });

    it('treats null and undefined as the same genuine legacy binding', () => {
      const f = fixture();
      expect(() => f.service.assertSame(null, undefined)).not.toThrow();
      expect(() => f.service.assertSame(undefined, null)).not.toThrow();
    });

    it.each<[string, (binding: PublicationChoiceProfileBinding) => void]>([
      ['work ID', binding => { binding.workId = randomUUID(); }],
      ['manuscript ID', binding => { binding.manuscriptVersionId = randomUUID(); }],
      ['manuscript hash', binding => { binding.manuscriptHash = 'changed'; }],
      ['consent ID', binding => { binding.consentId = randomUUID(); }],
      ['consent revision', binding => { binding.consentRevision += 1; }],
      ['profile view version', binding => { binding.generationProfileViewVersion = 'different-view'; }],
      ['profile ID', binding => { binding.generationProfilePin.id = randomUUID(); }],
      ['profile version', binding => { binding.generationProfilePin.profileVersion += 1; }],
      ['review revision', binding => { binding.generationProfilePin.reviewRevision += 1; }],
      ['source fingerprint', binding => { binding.generationProfilePin.sourceFingerprint = 'changed'; }],
      ['approved fingerprint', binding => { binding.generationProfilePin.approvedFingerprint = 'changed'; }],
      ['pinned manuscript ID', binding => { binding.generationProfilePin.manuscriptVersionId = randomUUID(); }],
      ['analysis ID', binding => { binding.generationProfilePin.analysisJobId = randomUUID(); }],
      ['analysis version', binding => { binding.generationProfilePin.analysisVersion += 1; }],
      ['approving user', binding => { binding.generationProfilePin.approvedByUserId = randomUUID(); }],
      ['approval timestamp', binding => { binding.generationProfilePin.approvedAt = NOW.toISOString(); }],
    ])('rejects a changed %s in the full binding', (_name, mutate) => {
      const f = fixture();
      const expected = expectedBinding(f);
      const current = { ...expected, generationProfilePin: { ...expected.generationProfilePin } };
      mutate(current);
      expect(() => f.service.assertSame(expected, current)).toThrow(expect.objectContaining({
        response: { code: 'STORY_PUBLICATION_CHOICE_SETTINGS_CHANGED', message: expect.any(String) },
      }));
    });

    it.each<[string, (f: Fixture) => void]>([
      ['review revision', f => { f.profile.reviewRevision += 1; }],
      ['approval timestamp', f => { f.profile.approvedAt = NOW; }],
    ])('rejects reapproval with the same approved fingerprint but a different %s', async (_name, mutate) => {
      const f = fixture();
      const expected = await f.service.forWork(f.db as never, f.ids.work);
      mutate(f);
      const current = await f.service.forWork(f.db as never, f.ids.work);
      expect(current!.binding.generationProfilePin.approvedFingerprint)
        .toBe(expected!.binding.generationProfilePin.approvedFingerprint);
      expect(() => f.service.assertSame(expected!.binding, current!.binding)).toThrow(expect.objectContaining({
        response: { code: 'STORY_PUBLICATION_CHOICE_SETTINGS_CHANGED', message: expect.any(String) },
      }));
    });

    it('rejects a profile added after a genuine legacy binding was captured', async () => {
      const f = fixture();
      makeLegacy(f);
      const expected = await f.service.forWork(f.db as never, f.ids.work);
      expect(expected).toBeNull();
      f.db.storyWorkGenerationProfile.findFirst.mockResolvedValue(f.profile);
      f.db.storyAnalysisJob.findFirst.mockResolvedValue(f.analysis);
      const current = await f.service.forWork(f.db as never, f.ids.work);
      expect(current).not.toBeNull();
      expect(() => f.service.assertSame(expected?.binding ?? null, current!.binding)).toThrow(expect.objectContaining({
        response: { code: 'STORY_PUBLICATION_CHOICE_SETTINGS_CHANGED', message: expect.any(String) },
      }));
    });

    it('rejects removal of a previously captured approval binding', () => {
      const f = fixture();
      expect(() => f.service.assertSame(expectedBinding(f), null)).toThrow(expect.objectContaining({
        response: { code: 'STORY_PUBLICATION_CHOICE_SETTINGS_CHANGED', message: expect.any(String) },
      }));
    });
  });

  describe('forPlan', () => {
    it('looks up the exact slug and delegates the exact manuscript hash and lock flag', async () => {
      const f = fixture();
      const plan = { slug: 'author-work-v2', manuscript: { contentHash: f.manuscript.contentHash } };
      const result = { binding: expectedBinding(f), approved: continuationGenerationProfileSnapshot(f.profile).approved };
      const forWork = jest.spyOn(f.service, 'forWork').mockResolvedValue(result);
      await expect(f.service.forPlan(f.db as never, plan, true)).resolves.toBe(result);
      expect(f.db.storyWork.findUnique).toHaveBeenCalledWith({ where: { slug: plan.slug }, select: { id: true } });
      expect(forWork).toHaveBeenCalledWith(f.db, f.ids.work, { manuscriptHash: plan.manuscript.contentHash, lock: true });
    });

    it('defaults to an unlocked exact-hash work lookup', async () => {
      const f = fixture();
      const plan = { slug: 'author-work', manuscript: { contentHash: f.manuscript.contentHash } };
      const forWork = jest.spyOn(f.service, 'forWork');
      await expect(f.service.forPlan(f.db as never, plan)).resolves.toMatchObject({ binding: expectedBinding(f) });
      expect(forWork).toHaveBeenCalledWith(f.db, f.ids.work, { manuscriptHash: plan.manuscript.contentHash, lock: false });
      expect(f.db.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns null for a new slug without reading or locking another work', async () => {
      const f = fixture();
      f.db.storyWork.findUnique.mockResolvedValue(null);
      const forWork = jest.spyOn(f.service, 'forWork');
      const plan = { slug: 'new-exact-slug', manuscript: { contentHash: 'new-hash' } };
      await expect(f.service.forPlan(f.db as never, plan, true)).resolves.toBeNull();
      expect(f.db.storyWork.findUnique).toHaveBeenCalledWith({ where: { slug: plan.slug }, select: { id: true } });
      expect(forWork).not.toHaveBeenCalled();
      expect(f.db.storyManuscriptVersion.findFirst).not.toHaveBeenCalled();
      expect(f.db.$queryRaw).not.toHaveBeenCalled();
    });

    it('rejects an existing slug when the plan hash does not equal the latest manuscript hash', async () => {
      const f = fixture();
      await expect(f.service.forPlan(f.db as never, { slug: 'existing-work',
        manuscript: { contentHash: `${f.manuscript.contentHash}-changed` } })).rejects.toMatchObject({
        response: { code: 'STORY_PUBLICATION_PROFILE_SOURCE_MISMATCH' },
      });
      expect(f.db.storyWorkGenerationProfile.findFirst).not.toHaveBeenCalled();
    });

    it('retains a genuine legacy result for an existing slug with the exact manuscript hash', async () => {
      const f = fixture();
      makeLegacy(f);
      await expect(f.service.forPlan(f.db as never, { slug: 'legacy-work',
        manuscript: { contentHash: f.manuscript.contentHash } })).resolves.toBeNull();
      expect(f.db.storyWorkGenerationProfile.findFirst).toHaveBeenCalled();
    });
  });
});
