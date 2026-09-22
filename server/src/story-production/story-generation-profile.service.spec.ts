import { ConflictException } from '@nestjs/common';
import { CREATOR_GENERATION_PROFILE_SCHEMA, STORY_PROFILE_SECTION_KEYS } from '../generation-profile/creator-generation-profile.policy';
import { PrismaService } from '../prisma/prisma.service';
import { StoryGenerationProfileService } from './story-generation-profile.service';

const owner = '00000000-0000-4000-8000-000000000201';
const workId = '00000000-0000-4000-8000-000000000202';
const manuscriptId = '00000000-0000-4000-8000-000000000203';
const analysisId = '00000000-0000-4000-8000-000000000204';
const profileId = '00000000-0000-4000-8000-000000000205';

function sourceMocks(prisma: ReturnType<typeof fixture>['prisma']) {
  prisma.storyWork.findFirst.mockResolvedValue({ id: workId });
  prisma.storyManuscriptVersion.findFirst.mockResolvedValue({
    id: manuscriptId,
    version: 3,
    locale: 'ko',
    contentHash: 'a'.repeat(64),
    structuredBody: {
      parts: [
        { paragraphs: [{ text: 'first' }, { text: 'second' }] },
        { paragraphs: [{ text: 'third' }] },
      ],
    },
  });
  prisma.storyAnalysisJob.findFirst.mockResolvedValue({
    id: analysisId,
    analysisVersion: 2,
    sourceContentHash: 'a'.repeat(64),
    configHash: 'b'.repeat(64),
    totalParts: 2,
    totalParagraphs: 3,
  });
}

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: profileId,
    workId,
    ownerUserId: owner,
    manuscriptVersionId: manuscriptId,
    analysisJobId: analysisId,
    sourceFingerprint: 'c'.repeat(64),
    profileVersion: 1,
    reviewRevision: 0,
    status: 'needs_review',
    draftSettings: {},
    draftFingerprint: 'd'.repeat(64),
    approvedSettings: null,
    approvedFingerprint: null,
    approvedByUserId: null,
    approvedAt: null,
    analysisErrorCode: null,
    createdAt: new Date('2026-09-23T00:00:00.000Z'),
    updatedAt: new Date('2026-09-23T00:00:00.000Z'),
    ...overrides,
  };
}

function fixture() {
  const tx = {
    storyWorkGenerationProfile: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit' }) },
  };
  const prisma = {
    storyWork: { findFirst: jest.fn() },
    storyManuscriptVersion: { findFirst: jest.fn() },
    storyAnalysisJob: { findFirst: jest.fn() },
    storyAnalysisEvidence: { findMany: jest.fn() },
    storyWorkGenerationProfile: { findFirst: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { prisma, tx, service: new StoryGenerationProfileService(prisma as unknown as PrismaService) };
}

function reviewedSettings() {
  return {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
    kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map((key) => ({
      key,
      decision: 'accepted',
      value: { summary: key },
      evidence: [],
    })),
  };
}

describe('StoryGenerationProfileService', () => {
  it('materializes a review draft from the completed analysis of the latest manuscript', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    f.prisma.storyWorkGenerationProfile.findFirst.mockResolvedValue(null);
    f.prisma.storyAnalysisEvidence.findMany.mockResolvedValue([
      { id: 'e-style', evidenceType: 'style', sourcePartKey: 'part-1', sourceParagraphIndex: 0,
        payload: { title: 'Short rhythm', observation: 'Short sentences accelerate tense scenes.', styleCategory: 'sentence_rhythm' } },
      { id: 'e-event', evidenceType: 'event', sourcePartKey: 'part-2', sourceParagraphIndex: 0,
        payload: { title: 'Later event', observation: 'The later event follows the opening promise.' } },
      { id: 'e-entity', evidenceType: 'entity', sourcePartKey: 'part-1', sourceParagraphIndex: 1,
        payload: { title: 'Lead', observation: 'The lead retains the same identity.' } },
      { id: 'e-background', evidenceType: 'background', sourcePartKey: 'part-2', sourceParagraphIndex: 0,
        payload: { title: 'Harbor', observation: 'The harbor remains cold and foggy.' } },
    ]);
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(null);
    f.tx.storyWorkGenerationProfile.create.mockImplementation(({ data }) => profileRow({
      ...data,
      draftSettings: data.draftSettings,
      draftFingerprint: data.draftFingerprint,
      sourceFingerprint: data.sourceFingerprint,
    }));

    const result = await f.service.getOrCreate(owner, workId);
    const draft = result.profile.draftSettings as ReturnType<typeof reviewedSettings>;

    expect(result.profile.status).toBe('needs_review');
    expect(result.profile.reviewRequired).toBe(true);
    expect(draft.sections).toHaveLength(8);
    expect(draft.sections.every((section: { decision: string }) => section.decision === 'proposed')).toBe(true);
    expect(draft.sections.find((section: { key: string }) => section.key === 'scene_scale')!.value)
      .toMatchObject({ partCount: 2, paragraphCount: 3 });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'story_generation_profile.analysis_draft_created' }),
    }));
  });

  it('does not approve a stale reviewed draft', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow({
      sourceFingerprint: expect.anything(),
      draftSettings: reviewedSettings(),
      draftFingerprint: 'd'.repeat(64),
    }));

    await expect(f.service.approve(owner, workId, {
      expectedDraftFingerprint: 'e'.repeat(64),
    })).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.storyWorkGenerationProfile.updateMany).not.toHaveBeenCalled();
  });
});
