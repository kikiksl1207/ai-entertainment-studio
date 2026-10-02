import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ARTIST_PROFILE_SECTION_KEYS, CREATOR_GENERATION_PROFILE_SCHEMA, creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { activationFixture } from './story-ai-activation.postgres-fixture';
import { StoryInteractionApprovalService } from './story-interaction-approval.service';
import { STORY_LOCALES } from './story-production.policy';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('canonical interaction approval on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let service: StoryInteractionApprovalService;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
        parsed.username !== 'lumina_qa' || parsed.pathname !== '/lumina_interaction_approval_qa' || parsed.search || parsed.hash) {
      throw new Error('Dedicated interaction approval QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    service = new StoryInteractionApprovalService(db as never);
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function fixture() {
    const f = await activationFixture(db, false);
    const sourceText = 'Aster: I will open the door. Aster opens the door for the reader.';
    const beat = await db.storyBeat.update({ where: { sceneId_position: { sceneId: f.scene.id, position: 1 } },
      data: { beatType: 'narration', content: Object.fromEntries(STORY_LOCALES.map(locale => [locale, sourceText])) } });
    const artist = await db.artist.create({ data: { slug: `interaction-qa-${randomUUID()}`, displayName: 'Aster', status: 'active' } });
    const settings = normalizeCreatorGenerationProfile('artist', { schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'artist',
      sections: ARTIST_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted' as const,
        value: { description: 'Synthetic approved identity' }, evidence: [] })) });
    const profile = await db.artistStoryIdentityProfile.create({ data: { artistId: artist.id, status: 'approved',
      profileVersion: 1, reviewRevision: 1, sourceFingerprint: 'e'.repeat(64), referenceAssetIds: [],
      approvedSettings: settings as unknown as Prisma.InputJsonValue,
      approvedFingerprint: creatorGenerationProfileFingerprint('e'.repeat(64), settings),
      approvedByUserId: f.owner.id, approvedAt: new Date() } });
    const query = { artistId: artist.id, locale: 'ko' };
    const review = await service.review(f.owner.id, f.work.id, beat.id, query);
    const input = { ...query, idempotencyKey: randomUUID(), expectedSourceChecksum: review.identity.sourceChecksum,
      expectedIdentityPinHash: review.identity.identityPinHash, interactionKind: 'dialogue' as const,
      evidenceStart: sourceText.indexOf('I will'), evidenceText: 'I will open the door.',
      memoryText: 'I will open the door.', interactionReviewed: true };
    return { ...f, artist, profile, beat, query, review, input, sourceText };
  }

  it.each(STORY_LOCALES)('stores an explicitly reviewed exact quote only in %s', async locale => {
    const f = await fixture();
    const review = await service.review(f.owner.id, f.work.id, f.beat.id, { ...f.query, locale });
    expect(review).toMatchObject({ proposalApproved: false, readerMemoryApplied: false, approvals: [] });
    const approved = await service.approve(f.owner.id, f.work.id, f.beat.id, { ...f.input, locale,
      expectedSourceChecksum: review.identity.sourceChecksum });
    expect(approved).toMatchObject({ locale, status: 'approved', revision: 1, interactionKind: 'dialogue',
      memoryText: f.input.evidenceText, readerMemoryApplied: false });
    expect((await service.review(f.owner.id, f.work.id, f.beat.id, { ...f.query, locale })).approvals).toHaveLength(1);
    const row = await db.storyInteractionApproval.findUniqueOrThrow({ where: { id: approved.approvalId } });
    expect(row).toMatchObject({ ownerUserId: f.owner.id, manuscriptVersionId: f.manuscript.id,
      releaseId: f.release.id, partId: f.part.id, sceneId: f.scene.id, beatId: f.beat.id,
      artistId: f.artist.id, identityProfileId: f.profile.id });
    const audit = await db.auditEvent.findFirstOrThrow({ where: { targetId: approved.approvalId, action: 'story_interaction.approved' } });
    expect(JSON.stringify(audit.metadata)).not.toContain(f.input.evidenceText);
    expect(await db.storyAiContinuation.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('separates owner-reviewed action from dialogue rather than extracting a colon as approval', async () => {
    const f = await fixture();
    expect(f.review.approvals).toEqual([]);
    const input = { ...f.input, interactionKind: 'action' as const,
      evidenceStart: f.sourceText.indexOf('Aster opens'), evidenceText: 'Aster opens the door for the reader.',
      memoryText: 'Opened the door together.' };
    expect(await service.approve(f.owner.id, f.work.id, f.beat.id, input)).toMatchObject({
      interactionKind: 'action', memoryText: input.memoryText, readerMemoryApplied: false });
    await expect(service.approve(f.owner.id, f.work.id, f.beat.id, { ...f.input, idempotencyKey: randomUUID(),
      memoryText: 'Made up another quotation.' })).rejects.toMatchObject({ response: { code: 'STORY_INTERACTION_EVIDENCE_INVALID' } });
  });

  it('never borrows an English-only attribution when Korean source is missing', async () => {
    const f = await fixture();
    await db.storyBeat.update({ where: { id: f.beat.id }, data: { content: { en: f.sourceText } } });
    await expect(service.review(f.owner.id, f.work.id, f.beat.id, f.query))
      .rejects.toMatchObject({ response: { code: 'STORY_INTERACTION_TRANSLATION_UNAVAILABLE' } });
    expect(await db.storyInteractionApproval.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('rejects nonowners and a beat from another work before exposing its text', async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(service.review(f.reader.id, f.work.id, f.beat.id, f.query)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.approve(f.owner.id, f.work.id, other.beat.id, f.input)).rejects.toBeInstanceOf(NotFoundException);
    expect(await db.storyInteractionApproval.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('excludes an old approval after the exact source changes and still permits withdrawal', async () => {
    const f = await fixture();
    const approved = await service.approve(f.owner.id, f.work.id, f.beat.id, f.input);
    await db.storyBeat.update({ where: { id: f.beat.id }, data: { content: { ko: `${f.sourceText} Changed.` } } });
    expect((await service.review(f.owner.id, f.work.id, f.beat.id, f.query)).approvals).toEqual([]);
    await expect(service.approve(f.owner.id, f.work.id, f.beat.id, { ...f.input, idempotencyKey: randomUUID() }))
      .rejects.toBeInstanceOf(ConflictException);
    await db.storyWork.update({ where: { id: f.work.id }, data: { status: 'archived' } });
    expect(await service.revoke(f.owner.id, f.work.id, approved.approvalId, {
      expectedRevision: 1, expectedApprovalChecksum: approved.approvalChecksum })).toMatchObject({ status: 'revoked', revision: 2 });
  });

  it('rejects a changed release or actor approval rather than accepting an old pin', async () => {
    const f = await fixture();
    await db.storyRelease.update({ where: { id: f.release.id }, data: { checksum: 'f'.repeat(64) } });
    await expect(service.approve(f.owner.id, f.work.id, f.beat.id, f.input)).rejects.toBeInstanceOf(ConflictException);
    await db.artistStoryIdentityProfile.update({ where: { id: f.profile.id }, data: { status: 'needs_review' } });
    await expect(service.review(f.owner.id, f.work.id, f.beat.id, f.query))
      .rejects.toMatchObject({ response: { code: 'STORY_INTERACTION_ARTIST_APPROVAL_REQUIRED' } });
  });

  it('requires explicit confirmation even when the artist identity is approved', async () => {
    const f = await fixture();
    await expect(service.approve(f.owner.id, f.work.id, f.beat.id, { ...f.input, interactionReviewed: false }))
      .rejects.toMatchObject({ response: { code: 'STORY_INTERACTION_EVIDENCE_INVALID' } });
    await expect(service.approve(f.owner.id, f.work.id, f.beat.id, { ...f.input, evidenceStart: f.input.evidenceStart + 1 }))
      .rejects.toMatchObject({ response: { code: 'STORY_INTERACTION_EVIDENCE_SOURCE_CHANGED' } });
    expect(await db.storyInteractionApproval.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('same-key replay neither duplicates evidence nor resurrects a withdrawal', async () => {
    const f = await fixture();
    const first = await service.approve(f.owner.id.toUpperCase(), f.work.id.toUpperCase(), f.beat.id.toUpperCase(), {
      ...f.input, artistId: f.artist.id.toUpperCase(), idempotencyKey: f.input.idempotencyKey.toUpperCase() });
    expect(await service.approve(f.owner.id, f.work.id, f.beat.id, f.input)).toEqual(first);
    await expect(service.approve(f.owner.id, f.work.id, f.beat.id, { ...f.input,
      interactionKind: 'action', memoryText: 'Another reviewed action.' })).rejects.toMatchObject({
      response: { code: 'STORY_INTERACTION_IDEMPOTENCY_CONFLICT' } });
    const revoke = { expectedRevision: 1, expectedApprovalChecksum: first.approvalChecksum };
    await expect(service.revoke(f.reader.id, f.work.id, first.approvalId, revoke)).rejects.toBeInstanceOf(NotFoundException);
    const revoked = await service.revoke(f.owner.id, f.work.id, first.approvalId, revoke);
    expect(await service.revoke(f.owner.id, f.work.id, first.approvalId, revoke)).toEqual(revoked);
    expect(await service.approve(f.owner.id, f.work.id, f.beat.id, f.input)).toEqual(revoked);
    expect(await db.storyInteractionApproval.count({ where: { workId: f.work.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { targetId: first.approvalId } })).toBe(2);
  });

  it('competing approvers create one row; serialization conflicts require refreshed review', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([service.approve(f.owner.id, f.work.id, f.beat.id, f.input),
      new StoryInteractionApprovalService(db as never).approve(f.owner.id, f.work.id, f.beat.id, f.input)]);
    expect(results.some(result => result.status === 'fulfilled')).toBe(true);
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(ConflictException);
    expect(await db.storyInteractionApproval.count({ where: { workId: f.work.id } })).toBe(1);
    expect(await service.approve(f.owner.id, f.work.id, f.beat.id, f.input)).toMatchObject({ status: 'approved' });
  });

  it('an audit storage failure rolls back approval insertion in the same real transaction', async () => {
    const f = await fixture();
    const broken = new StoryInteractionApprovalService({ $transaction: (fn: (tx: Prisma.TransactionClient) => unknown, options: object) =>
      db.$transaction(async tx => fn(new Proxy(tx, { get(target, key) {
        if (key === 'auditEvent') return { create: async () => { throw new Error('Synthetic audit outage'); } };
        return Reflect.get(target, key);
      } })), options) } as never);
    await expect(broken.approve(f.owner.id, f.work.id, f.beat.id, f.input)).rejects.toThrow('Synthetic audit outage');
    expect(await db.storyInteractionApproval.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('normal database constraints reject cross-scene beats and cross-artist profiles', async () => {
    const f = await fixture();
    const other = await fixture();
    const approved = await service.approve(f.owner.id, f.work.id, f.beat.id, f.input);
    const row = await db.storyInteractionApproval.findUniqueOrThrow({ where: { id: approved.approvalId } });
    const { id, ...data } = row;
    await expect(db.storyInteractionApproval.create({ data: { ...data, idempotencyKey: randomUUID(), beatId: other.beat.id } }))
      .rejects.toMatchObject({ code: 'P2003' });
    await expect(db.storyInteractionApproval.create({ data: { ...data, idempotencyKey: randomUUID(), identityProfileId: other.profile.id } }))
      .rejects.toMatchObject({ code: 'P2003' });
    expect(await db.storyInteractionApproval.count({ where: { workId: f.work.id } })).toBe(1);
  });

  it('rejects a one-character surrogate pair before SQL and preserves valid Unicode offsets', async () => {
    const f = await fixture();
    const rocket = '\uD83D\uDE80';
    const source = `${rocket} opens a door.`;
    await db.storyBeat.update({ where: { id: f.beat.id }, data: { content: { ko: source } } });
    const review = await service.review(f.owner.id, f.work.id, f.beat.id, f.query);
    const input = { ...f.input, expectedSourceChecksum: review.identity.sourceChecksum, interactionKind: 'action' as const,
      evidenceStart: 0, evidenceText: rocket, memoryText: 'Opened a door.' };
    await expect(service.approve(f.owner.id, f.work.id, f.beat.id, input))
      .rejects.toMatchObject({ response: { code: 'STORY_INTERACTION_EVIDENCE_INVALID' } });
    expect(await db.storyInteractionApproval.count({ where: { workId: f.work.id } })).toBe(0);
    expect(await service.approve(f.owner.id, f.work.id, f.beat.id, { ...input, evidenceText: source,
      memoryText: `${rocket}${rocket}` })).toMatchObject({ evidenceStart: 0, memoryText: `${rocket}${rocket}` });
  });
});
