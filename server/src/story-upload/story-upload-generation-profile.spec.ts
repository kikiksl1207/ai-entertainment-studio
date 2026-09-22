import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  STORY_PROFILE_SECTION_KEYS,
} from '../generation-profile/creator-generation-profile.policy';
import { StoryUploadStorageService } from './story-upload-storage.service';
import { StoryUploadService } from './story-upload.service';

const owner = '00000000-0000-4000-8000-000000000101';
const submissionId = '00000000-0000-4000-8000-000000000102';
const profileId = '00000000-0000-4000-8000-000000000103';
const sourceFingerprint = 'a'.repeat(64);

function settings(decision = 'accepted') {
  return {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
    kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map((key) => ({ key, decision, value: { summary: key }, evidence: [] })),
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: profileId,
    submissionId,
    ownerUserId: owner,
    sourceFingerprint,
    profileVersion: 1,
    reviewRevision: 0,
    status: 'pending_analysis',
    draftSettings: {},
    draftFingerprint: null,
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
    storyUploadSubmission: { findFirst: jest.fn() },
    storyUploadGenerationProfile: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit' }) },
  };
  const prisma = {
    storyUploadSubmission: { findFirst: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return {
    service: new StoryUploadService(
      prisma as unknown as PrismaService,
      {} as StoryUploadStorageService,
    ),
    prisma,
    tx,
  };
}

describe('StoryUploadService generation profile', () => {
  it('saves an owner-scoped review draft without approving it', async () => {
    const f = fixture();
    const current = row();
    f.tx.storyUploadSubmission.findFirst.mockResolvedValue({
      id: submissionId,
      userId: owner,
      requestFingerprint: sourceFingerprint,
      generationProfiles: [current],
    });
    f.tx.storyUploadGenerationProfile.update.mockImplementation(({ data }) => row({ ...data }));

    const result = await f.service.updateGenerationProfile(owner, submissionId, { settings: settings() } as never);

    expect(result.profile).toMatchObject({ status: 'needs_review', reviewRequired: true });
    expect(result.profile.draftFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'story_generation_profile.draft_saved', actorUserId: owner }),
    }));
  });

  it('rejects approval when the viewed draft fingerprint is stale', async () => {
    const f = fixture();
    f.tx.storyUploadSubmission.findFirst.mockResolvedValue({
      id: submissionId,
      userId: owner,
      requestFingerprint: sourceFingerprint,
      generationProfiles: [row({ status: 'needs_review', draftFingerprint: 'b'.repeat(64) })],
    });

    await expect(f.service.approveGenerationProfile(owner, submissionId, {
      expectedDraftFingerprint: 'c'.repeat(64),
    })).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.storyUploadGenerationProfile.updateMany).not.toHaveBeenCalled();
  });

  it('approves a fully reviewed profile with an atomic source and draft fence', async () => {
    const f = fixture();
    const draftFingerprint = 'b'.repeat(64);
    const current = row({ status: 'needs_review', draftFingerprint, draftSettings: settings() });
    f.tx.storyUploadSubmission.findFirst.mockResolvedValue({
      id: submissionId,
      userId: owner,
      requestFingerprint: sourceFingerprint,
      generationProfiles: [current],
    });
    f.tx.storyUploadGenerationProfile.updateMany.mockResolvedValue({ count: 1 });
    f.tx.storyUploadGenerationProfile.findUniqueOrThrow.mockResolvedValue(row({
      status: 'approved', draftFingerprint, draftSettings: settings(), approvedSettings: settings(),
      approvedFingerprint: draftFingerprint, approvedByUserId: owner, approvedAt: new Date(), reviewRevision: 1,
    }));

    const result = await f.service.approveGenerationProfile(owner, submissionId, {
      expectedDraftFingerprint: draftFingerprint,
    });

    expect(result.profile).toMatchObject({ status: 'approved', reviewRequired: false, reviewRevision: 1 });
    expect(f.tx.storyUploadGenerationProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sourceFingerprint, draftFingerprint }),
      data: expect.objectContaining({ status: 'approved', approvedByUserId: owner }),
    }));
  });
});
