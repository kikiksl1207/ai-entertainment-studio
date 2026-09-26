import { ConflictException } from '@nestjs/common';
import { CREATOR_GENERATION_PROFILE_SCHEMA, STORY_PROFILE_SECTION_KEYS,
  type CreatorGenerationProfileSettings } from '../generation-profile/creator-generation-profile.policy';
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
    $queryRaw: jest.fn().mockResolvedValue([{ id: workId }]),
    storyWork: { findFirst: jest.fn() },
    storyManuscriptVersion: { findFirst: jest.fn() },
    storyAnalysisEvidence: { findMany: jest.fn() },
    storyWorkGenerationProfile: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    storyMemoryRecord: { updateMany: jest.fn(), createMany: jest.fn() },
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

function reviewedSettings(): CreatorGenerationProfileSettings {
  return {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
    kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map((key) => ({
      key,
      decision: 'accepted' as const,
      value: { summary: key },
      evidence: [],
    })),
  };
}

describe('StoryGenerationProfileService', () => {
  it('recovers a missing draft for the owned latest completed semantic analysis without duplicating it', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    let stored: ReturnType<typeof profileRow> | null = null;
    f.prisma.storyWorkGenerationProfile.findFirst.mockImplementation(() => stored);
    f.tx.storyAnalysisEvidence.findMany.mockResolvedValue([
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
    f.tx.storyWorkGenerationProfile.create.mockImplementation(({ data }) => {
      stored = profileRow(data);
      return stored;
    });

    const result = await f.service.getOrCreate(owner, workId);
    const replay = await f.service.getOrCreate(owner, workId);
    const draft = result.profile.draftSettings as ReturnType<typeof reviewedSettings>;

    expect(replay.profile).toEqual(result.profile);
    expect(f.tx.storyWorkGenerationProfile.create).toHaveBeenCalledTimes(1);
    expect(result.profile.status).toBe('needs_review');
    expect(result.profile.reviewRequired).toBe(true);
    expect(draft.sections).toHaveLength(8);
    expect(draft.sections.every((section: { decision: string }) => section.decision === 'proposed')).toBe(true);
    expect(draft.sections.find((section: { key: string }) => section.key === 'scene_scale')!.value)
      .toMatchObject({ partCount: 2, paragraphCount: 3 });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'story_generation_profile.analysis_draft_created' }),
    }));
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('does not recover a legacy publication-style snapshot as a semantic profile', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    f.prisma.storyAnalysisJob.findFirst.mockResolvedValue(null);

    await expect(f.service.getOrCreate(owner, workId)).rejects.toMatchObject({
      response: { code: 'GENERATION_PROFILE_ANALYSIS_REQUIRED' },
    });
    expect(f.prisma.storyAnalysisJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ pipeline: 'semantic_extraction_v1' }),
    }));
    expect(f.tx.storyWorkGenerationProfile.create).not.toHaveBeenCalled();
  });

  it('creates one NEEDS_REVIEW draft and audit event when completion is replayed', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    f.tx.storyWork.findFirst.mockResolvedValue({ id: workId });
    f.tx.storyManuscriptVersion.findFirst.mockResolvedValue(await f.prisma.storyManuscriptVersion.findFirst());
    f.tx.storyAnalysisEvidence.findMany.mockResolvedValue([
      { id: 'e-style', evidenceType: 'style', sourcePartKey: 'part-1', sourceParagraphIndex: 0,
        payload: { title: 'Rhythm', observation: 'Short sentences.', styleCategory: 'sentence_rhythm' } },
    ]);
    let stored: ReturnType<typeof profileRow> | null = null;
    f.tx.storyWorkGenerationProfile.findFirst.mockImplementation(({ where }) =>
      where.analysisJobId ? stored : null);
    f.tx.storyWorkGenerationProfile.create.mockImplementation(({ data }) => {
      stored = profileRow(data);
      return stored;
    });
    const job = { id: analysisId, workId, manuscriptVersionId: manuscriptId, actorUserId: owner,
      pipeline: 'semantic_extraction_v1', status: 'running', phase: 'finalizing',
      analysisVersion: 2, sourceContentHash: 'a'.repeat(64),
      configHash: 'b'.repeat(64), totalParts: 2, totalParagraphs: 3 } as never;

    const first = await f.service.createDraftAtCompletion(f.tx as never, job);
    const replay = await f.service.createDraftAtCompletion(f.tx as never, job);

    expect(replay).toBe(first);
    expect(first.status).toBe('needs_review');
    expect(first.approvedSettings).toBeNull();
    expect(first.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.draftFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(f.tx.storyWorkGenerationProfile.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(f.tx.storyAnalysisEvidence.findMany).toHaveBeenCalledTimes(1);
  });

  it('refuses to backfill a historically completed job', async () => {
    const f = fixture();
    await expect(f.service.createDraftAtCompletion(f.tx as never, {
      actorUserId: owner, pipeline: 'semantic_extraction_v1', status: 'completed', phase: 'completed',
    } as never)).rejects.toThrow('Invalid semantic profile source');
    expect(f.tx.storyWorkGenerationProfile.create).not.toHaveBeenCalled();
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

  it('indexes only writer-approved semantic facts and supersedes older profile memories', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    const entityId = '00000000-0000-4000-8000-000000000301';
    const eventId = '00000000-0000-4000-8000-000000000302';
    const omittedId = '00000000-0000-4000-8000-000000000303';
    const settings = reviewedSettings();
    for (const section of settings.sections) {
      if (section.key === 'canon') section.value = { observations: [
        { sourceRef: `analysis:${entityId}`, title: '주인공', detail: '왼손을 다친 채 항구에 도착한다.' },
      ] };
      if (section.key === 'timeline') section.value = { observations: [
        { sourceRef: `analysis:${eventId}`, title: '도착', detail: '폭풍이 지나간 뒤에 도착한다.' },
      ] };
      if (section.key === 'narrative_devices') {
        section.decision = 'removed';
        section.value = { observations: [
          { sourceRef: `analysis:${omittedId}`, title: '제외한 복선', detail: '저장하지 않는다.' },
        ] };
      }
    }
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow({ draftSettings: settings }));
    f.tx.storyWorkGenerationProfile.updateMany.mockResolvedValue({ count: 1 });
    f.tx.storyWorkGenerationProfile.findUniqueOrThrow.mockResolvedValue(profileRow({
      status: 'approved', draftSettings: settings,
    }));
    f.tx.storyAnalysisEvidence.findMany.mockResolvedValue([
      { id: entityId, evidenceType: 'entity', sourcePartKey: 'part-1' },
      { id: eventId, evidenceType: 'event', sourcePartKey: 'part-2' },
    ]);

    await f.service.approve(owner, workId, { expectedDraftFingerprint: 'd'.repeat(64) });

    expect(f.tx.storyAnalysisEvidence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: [entityId, eventId] }, analysisJobId: analysisId,
        provenance: 'semantic_candidate' },
    }));
    expect(f.tx.storyMemoryRecord.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ analysisJobId: analysisId, status: 'approved',
        provenance: 'writer_approved_semantic' }),
      data: { status: 'superseded' },
    }));
    const created = f.tx.storyMemoryRecord.createMany.mock.calls[0][0].data;
    expect(created).toHaveLength(2);
    expect(created).toEqual(expect.arrayContaining([
      expect.objectContaining({ memoryType: 'entity', evidenceIds: [entityId],
        content: { ko: '주인공: 왼손을 다친 채 항구에 도착한다.' } }),
      expect.objectContaining({ memoryType: 'event', evidenceIds: [eventId],
        content: { ko: '도착: 폭풍이 지나간 뒤에 도착한다.' } }),
    ]));
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metadata: expect.objectContaining({ approvedMemoryCount: 2 }) }),
    }));
  });

  it('does not persist unverified references from a reviewed section', async () => {
    const f = fixture();
    sourceMocks(f.prisma);
    const settings = reviewedSettings();
    settings.sections.find((section) => section.key === 'canon')!.value = { observations: [
      { sourceRef: 'analysis:00000000-0000-4000-8000-000000000399', detail: '다른 분석의 인물' },
    ] };
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profileRow({ draftSettings: settings }));
    f.tx.storyWorkGenerationProfile.updateMany.mockResolvedValue({ count: 1 });
    f.tx.storyWorkGenerationProfile.findUniqueOrThrow.mockResolvedValue(profileRow({ status: 'approved' }));
    f.tx.storyAnalysisEvidence.findMany.mockResolvedValue([]);

    await f.service.approve(owner, workId, { expectedDraftFingerprint: 'd'.repeat(64) });

    expect(f.tx.storyMemoryRecord.createMany).not.toHaveBeenCalled();
    expect(f.tx.storyMemoryRecord.updateMany).toHaveBeenCalledTimes(1);
  });
});
