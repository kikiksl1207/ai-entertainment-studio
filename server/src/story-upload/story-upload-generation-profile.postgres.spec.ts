import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { CREATOR_GENERATION_PROFILE_SCHEMA, STORY_PROFILE_SECTION_KEYS } from '../generation-profile/creator-generation-profile.policy';
import { StoryUploadService } from './story-upload.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('upload generation profile audit on dedicated PostgreSQL', () => {
  let db: PrismaClient;
  let service: StoryUploadService;
  const storage = new Proxy({}, { get() { throw new Error('Storage must not be used by profile review'); } });

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
        parsed.username !== 'lumina_qa' || parsed.pathname !== '/lumina_creator_identity_qa' || parsed.search || parsed.hash) {
      throw new Error('Dedicated creator identity QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    service = new StoryUploadService(db as never, storage as never);
  });
  afterAll(async () => { await db?.$disconnect(); });

  function settings(decision = 'accepted') {
    return { schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
      sections: STORY_PROFILE_SECTION_KEYS.map(key => ({ key, decision,
        value: { summary: 'Synthetic profile review' }, evidence: [] })) };
  }

  async function fixture() {
    const owner = await db.user.create({ data: {} });
    const outsider = await db.user.create({ data: {} });
    const submission = await db.storyUploadSubmission.create({ data: {
      userId: owner.id, title: 'Synthetic audit-profile QA', originalLocale: 'ko',
      requestKeyHash: createHash('sha256').update(randomUUID()).digest('hex'),
      requestFingerprint: 'a'.repeat(64), submissionType: 'manuscript', sourceClass: 'original', totalBytes: 1n,
    } });
    return { owner, outsider, submission };
  }

  function auditFailureService() {
    return new StoryUploadService({ $transaction: (callback: (tx: Prisma.TransactionClient) => unknown) =>
      db.$transaction(async tx => callback(new Proxy(tx, { get(target, key) {
        if (key === 'auditEvent') return { create: async () => { throw new Error('Synthetic audit outage'); } };
        return Reflect.get(target, key);
      } }))) } as never, storage as never);
  }

  it('persists an owner draft and explicit approval with valid user audits', async () => {
    const f = await fixture();
    const saved = await service.updateGenerationProfile(f.owner.id, f.submission.id, { settings: settings() } as never);
    expect(saved.profile).toMatchObject({ status: 'needs_review', reviewRequired: true, profileVersion: 1 });
    const approved = await service.approveGenerationProfile(f.owner.id, f.submission.id, {
      expectedDraftFingerprint: saved.profile.draftFingerprint!,
    });
    expect(approved.profile).toMatchObject({ status: 'approved', reviewRequired: false, reviewRevision: 1 });
    const row = await db.storyUploadGenerationProfile.findUniqueOrThrow({ where: { id: saved.profile.id } });
    expect(row).toMatchObject({ ownerUserId: f.owner.id, approvedByUserId: f.owner.id,
      approvedFingerprint: saved.profile.draftFingerprint, sourceFingerprint: f.submission.requestFingerprint });
    expect(row.approvedAt).toBeInstanceOf(Date);
    const audits = await db.auditEvent.findMany({ where: { targetId: row.id } });
    expect(audits).toHaveLength(2);
    expect(audits.map(audit => audit.action).sort()).toEqual([
      'story_generation_profile.approved', 'story_generation_profile.draft_saved',
    ]);
    for (const audit of audits) {
      expect(audit).toMatchObject({ actorType: 'user', actorUserId: f.owner.id });
      expect(JSON.stringify(audit.metadata)).not.toContain('Synthetic profile review');
    }
  });

  it('rejects another owner and malformed identifiers without profile or audit writes', async () => {
    const f = await fixture();
    await expect(service.updateGenerationProfile(f.outsider.id, f.submission.id, { settings: settings() } as never))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.approveGenerationProfile(f.outsider.id, f.submission.id, { expectedDraftFingerprint: 'b'.repeat(64) }))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.updateGenerationProfile(f.owner.id, 'invalid', { settings: settings() } as never))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(await db.storyUploadGenerationProfile.count({ where: { submissionId: f.submission.id } })).toBe(0);
    expect(await db.auditEvent.count({ where: { actorUserId: f.owner.id } })).toBe(0);
  });

  it('rejects a stale fingerprint and a changed submission source', async () => {
    const f = await fixture();
    const saved = await service.updateGenerationProfile(f.owner.id, f.submission.id, { settings: settings() } as never);
    await expect(service.approveGenerationProfile(f.owner.id, f.submission.id, { expectedDraftFingerprint: 'b'.repeat(64) }))
      .rejects.toBeInstanceOf(ConflictException);
    await db.storyUploadSubmission.update({ where: { id: f.submission.id }, data: { requestFingerprint: 'c'.repeat(64) } });
    await expect(service.approveGenerationProfile(f.owner.id, f.submission.id, {
      expectedDraftFingerprint: saved.profile.draftFingerprint!,
    })).rejects.toBeInstanceOf(ConflictException);
    expect(await db.storyUploadGenerationProfile.findUniqueOrThrow({ where: { id: saved.profile.id } }))
      .toMatchObject({ status: 'needs_review', reviewRevision: 0, approvedAt: null });
    expect(await db.auditEvent.count({ where: { targetId: saved.profile.id } })).toBe(1);
  });

  it('requires review and does not approve proposed sections', async () => {
    const f = await fixture();
    const saved = await service.updateGenerationProfile(f.owner.id, f.submission.id, { settings: settings('proposed') } as never);
    await expect(service.approveGenerationProfile(f.owner.id, f.submission.id, {
      expectedDraftFingerprint: saved.profile.draftFingerprint!,
    })).rejects.toBeInstanceOf(ConflictException);
    expect(await db.storyUploadGenerationProfile.findUniqueOrThrow({ where: { id: saved.profile.id } }))
      .toMatchObject({ status: 'needs_review', approvedAt: null });
  });

  it('creates an unapproved new version after approval and rejects approval replay', async () => {
    const f = await fixture();
    const saved = await service.updateGenerationProfile(f.owner.id, f.submission.id, { settings: settings() } as never);
    const input = { expectedDraftFingerprint: saved.profile.draftFingerprint! };
    await service.approveGenerationProfile(f.owner.id, f.submission.id, input);
    await expect(service.approveGenerationProfile(f.owner.id, f.submission.id, input)).rejects.toBeInstanceOf(ConflictException);
    expect(await db.auditEvent.count({ where: { targetId: saved.profile.id } })).toBe(2);
    const next = await service.updateGenerationProfile(f.owner.id, f.submission.id, { settings: settings('edited') } as never);
    expect(next.profile).toMatchObject({ profileVersion: 2, status: 'needs_review', reviewRevision: 0, approvedAt: null });
    expect(next.profile.id).not.toBe(saved.profile.id);
    expect(await db.storyUploadGenerationProfile.findUniqueOrThrow({ where: { id: saved.profile.id } }))
      .toMatchObject({ status: 'approved', reviewRevision: 1 });
  });

  it('rolls back draft insertion when audit storage fails', async () => {
    const f = await fixture();
    await expect(auditFailureService().updateGenerationProfile(f.owner.id, f.submission.id, { settings: settings() } as never))
      .rejects.toThrow('Synthetic audit outage');
    expect(await db.storyUploadGenerationProfile.count({ where: { submissionId: f.submission.id } })).toBe(0);
    expect(await db.auditEvent.count({ where: { actorUserId: f.owner.id } })).toBe(0);
  });

  it('rolls back approval state and revision when audit storage fails', async () => {
    const f = await fixture();
    const saved = await service.updateGenerationProfile(f.owner.id, f.submission.id, { settings: settings() } as never);
    await expect(auditFailureService().approveGenerationProfile(f.owner.id, f.submission.id, {
      expectedDraftFingerprint: saved.profile.draftFingerprint!,
    })).rejects.toThrow('Synthetic audit outage');
    expect(await db.storyUploadGenerationProfile.findUniqueOrThrow({ where: { id: saved.profile.id } }))
      .toMatchObject({ status: 'needs_review', reviewRevision: 0, approvedAt: null, approvedFingerprint: null });
    expect(await db.auditEvent.count({ where: { targetId: saved.profile.id } })).toBe(1);
  });
});
