import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile, stableJson,
  STORY_PROFILE_SECTION_KEYS } from '../generation-profile/creator-generation-profile.policy';
import { currentApprovedStoryVisual } from './story-approved-visual-context.policy';
import { parseContinuationGenerationProfilePin } from './story-continuation-context.policy';
import { fixture } from '../../test/fixtures/story-generated-ending-read.fixture';

const artworkChanged = { response: { code: 'STORY_GENERATED_ENDING_READ_ARTWORK_CHANGED' } };
const scopeChanged = { response: { code: 'STORY_GENERATED_ENDING_READ_SCOPE_CHANGED' } };

async function approvedFixture() {
  const f = fixture();
  const analysis = { id: randomUUID(), analysisVersion: 1, workId: f.work.id,
    manuscriptVersionId: f.manuscript.id, configHash: 'd'.repeat(64),
    sourceContentHash: f.manuscript.contentHash, completedParagraphs: 2, totalParagraphs: 2 };
  const sourceFingerprint = createHash('sha256').update(stableJson({ workId: f.work.id,
    manuscriptVersionId: f.manuscript.id, contentHash: f.manuscript.contentHash,
    analysisJobId: analysis.id, analysisVersion: analysis.analysisVersion, analysisConfigHash: analysis.configHash })).digest('hex');
  const settings = normalizeCreatorGenerationProfile('story', { schemaVersion: 'creator-generation-profile-v1', kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted', value: { summary: `Synthetic ${key}` }, evidence: [] })) });
  const profile = { id: randomUUID(), workId: f.work.id, ownerUserId: f.work.ownerUserId,
    approvedByUserId: f.work.ownerUserId, manuscriptVersionId: f.manuscript.id, analysisJobId: analysis.id,
    profileVersion: 1, reviewRevision: 1, status: 'approved', approvedAt: new Date(), sourceFingerprint,
    approvedSettings: settings, approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings) };
  const consent = { id: randomUUID(), revision: 1, workId: f.work.id, ownerUserId: f.work.ownerUserId,
    manuscriptVersionId: f.manuscript.id, status: 'active', rightsConfirmed: true, imageTransformationAllowed: true,
    aiBranchAllowed: true, allowedLocales: ['ko'], startsAt: new Date(0), expiresAt: null as Date | null };
  f.tx.storyWorkGenerationProfile.findFirst.mockImplementation(async () => profile as never);
  f.tx.storyAnalysisJob.findFirst.mockImplementation(async () => analysis as never);
  f.tx.storyStyleProfileConsent.findUnique.mockImplementation(async () => consent as never);
  const origin = Object.assign(f.origin, { contextReferences: {} as Prisma.JsonObject });
  const bindCurrentPin = async () => {
    const approval = await currentApprovedStoryVisual(f.tx as never, f.work, f.manuscript.id);
    const pin = parseContinuationGenerationProfilePin(approval?.approvalIdentity as Prisma.JsonValue | undefined);
    if (!pin) throw new Error('Synthetic approved fixture requires a current profile pin');
    origin.contextReferences.generationProfilePin = { ...pin };
    return approval!;
  };
  await bindCurrentPin();
  f.tx.storyStyleProfileConsent.findUnique.mockClear();
  return { ...f, origin, analysis, settings, profile, consent, bindCurrentPin };
}

function noReceiptWrites(f: ReturnType<typeof fixture>) {
  expect(f.rows).toHaveLength(0);
  expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  expect(f.tx.storyAiContinuation.create).not.toHaveBeenCalled();
}

describe('ending visual approval transaction', () => {
  it('confirms a matching current approval once without exposing approval identity or settings', async () => {
    const f = await approvedFixture(), body = await f.input(), receipt = await f.confirm(body);
    expect(receipt).toMatchObject({ contract: 'story-generated-ending-read-receipt-v1', meaningApproved: false,
      qualityApproved: false, publicationStarted: false, imageGenerationStarted: false, generationStarted: false });
    expect((await f.preview()).confirmation).toMatchObject({ receiptId: receipt.receiptId });
    expect(await f.confirm(body)).toMatchObject({ receiptId: receipt.receiptId, idempotentReplay: true });
    expect(f.rows).toHaveLength(1);
    const encoded = JSON.stringify({ receipt, audit: f.rows[0] });
    for (const value of [f.profile.id, f.consent.id, f.profile.approvedFingerprint, 'Synthetic visual_direction',
      'generationProfilePin', 'authorVisualApprovalHash']) expect(encoded).not.toContain(value);
  });

  it('rejects consent withdrawn before a new projection even if the synthetic delivery stays ready', async () => {
    const f = await approvedFixture(), body = await f.input(), assetBefore = JSON.stringify(f.asset);
    f.consent.status = 'withdrawn'; f.consent.revision++;
    f.stories.currentProgress.mockClear();
    await expect(f.confirm(body)).rejects.toMatchObject(artworkChanged);
    expect(f.stories.currentProgress).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.asset)).toBe(assetBefore); noReceiptWrites(f);
  });

  it('rejects consent withdrawal after a captured ready page but before the receipt transaction', async () => {
    const f = await approvedFixture(), body = await f.input(), assetBefore = JSON.stringify(f.asset);
    f.prisma.$transaction.mockClear();
    f.stories.currentProgress.mockImplementationOnce(async (_u, _p, locale) => {
      const captured = f.page(locale);
      expect(captured.scene.deliveryState).toBe('ready');
      expect(f.prisma.$transaction).not.toHaveBeenCalled();
      f.consent.status = 'withdrawn'; f.consent.revision++;
      return captured;
    });
    await expect(f.confirm(body)).rejects.toMatchObject(artworkChanged);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.asset)).toBe(assetBefore); noReceiptWrites(f);
  });

  it.each(['owner', 'rights', 'image', 'expiry', 'branch'])('rejects current consent with invalid %s eligibility', async kind => {
    const f = await approvedFixture(), body = await f.input();
    if (kind === 'owner') f.consent.ownerUserId = randomUUID();
    if (kind === 'rights') f.consent.rightsConfirmed = false;
    if (kind === 'image') f.consent.imageTransformationAllowed = false;
    if (kind === 'expiry') f.consent.expiresAt = new Date(0);
    if (kind === 'branch') f.consent.aiBranchAllowed = false;
    await expect(f.confirm(body)).rejects.toMatchObject(artworkChanged); noReceiptWrites(f);
  });

  it('rejects a valid current profile whose approval revision no longer matches the completed origin pin', async () => {
    const f = await approvedFixture(), body = await f.input();
    f.profile.reviewRevision++;
    const current = await currentApprovedStoryVisual(f.tx as never, f.work, f.manuscript.id);
    expect(current).not.toBeNull();
    await expect(f.confirm(body)).rejects.toMatchObject(artworkChanged); noReceiptWrites(f);
  });

  it('rejects a malformed completed-origin profile pin rather than falling back to legacy', async () => {
    const f = await approvedFixture(), body = await f.input();
    f.origin.contextReferences.generationProfilePin = { ...f.origin.contextReferences.generationProfilePin as Prisma.JsonObject,
      profileVersion: 0 };
    await expect(f.confirm(body)).rejects.toMatchObject(artworkChanged); noReceiptWrites(f);
  });

  it('requires a completed-origin pin when analyzed current criteria exist', async () => {
    const f = await approvedFixture(), body = await f.input();
    delete f.origin.contextReferences.generationProfilePin;
    await expect(f.confirm(body)).rejects.toMatchObject(artworkChanged); noReceiptWrites(f);
  });

  it('invalidates the old receipt scope after a consent revision change without rewriting the old audit', async () => {
    const f = await approvedFixture(), body = await f.input(); await f.confirm(body);
    const auditBefore = JSON.stringify(f.rows), originBefore = JSON.stringify(f.origin.contextReferences);
    f.consent.revision++;
    const current = await f.preview();
    expect(current.scopeChecksum).not.toBe(body.expectedScopeChecksum);
    expect(current.confirmation).toBeNull();
    expect(current.sourceTextHash).toBe(body.expectedSourceTextHash);
    await expect(f.confirm(body)).rejects.toMatchObject(scopeChanged);
    expect(JSON.stringify(f.rows)).toBe(auditBefore);
    expect(JSON.stringify(f.origin.contextReferences)).toBe(originBefore);
  });

  it('keeps approved GET read-only and validates consent without any FOR SHARE lock', async () => {
    const f = await approvedFixture(); f.tx.storyStyleProfileConsent.findUnique.mockClear();
    const result = await f.preview();
    expect(result.confirmation).toBeNull();
    expect(f.tx.storyStyleProfileConsent.findUnique).toHaveBeenCalledTimes(1);
    expect(f.tx.$executeRaw.mock.calls[0][0].sql).toBe('SET TRANSACTION READ ONLY');
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
    expect(f.prisma.$transaction.mock.calls[0][1]).toMatchObject({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    noReceiptWrites(f);
  });

  it('locks current work consent before the policy consent read and audit creation on POST', async () => {
    const f = await approvedFixture(), body = await f.input();
    f.tx.$queryRaw.mockClear(); f.tx.storyStyleProfileConsent.findUnique.mockClear();
    await f.confirm(body);
    const index = f.tx.$queryRaw.mock.calls.findIndex(([sql]) => /FROM story_style_profile_consents[\s\S]*FOR SHARE/u.test(sql.sql));
    expect(index).toBeGreaterThanOrEqual(0);
    const lock = f.tx.$queryRaw.mock.calls[index][0];
    expect(lock.values).toContain(f.work.id);
    expect(f.tx.$queryRaw.mock.invocationCallOrder[index]).toBeLessThan(f.tx.storyStyleProfileConsent.findUnique.mock.invocationCallOrder[0]);
    expect(f.tx.storyStyleProfileConsent.findUnique.mock.invocationCallOrder[0]).toBeLessThan(f.tx.auditEvent.create.mock.invocationCallOrder[0]);
    expect(f.prisma.$transaction.mock.calls.at(-1)![1]).toMatchObject({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });

  it('fails closed when analysis exists but the current approved profile is missing', async () => {
    const f = await approvedFixture(), body = await f.input();
    f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(null);
    await expect(f.confirm(body)).rejects.toMatchObject(artworkChanged); noReceiptWrites(f);
  });

  it('fails closed when a profile exists but current completed analysis is missing', async () => {
    const f = await approvedFixture(), body = await f.input();
    f.tx.storyAnalysisJob.findFirst.mockResolvedValue(null);
    await expect(f.confirm(body)).rejects.toMatchObject(artworkChanged); noReceiptWrites(f);
  });

  it('retains the null approval contract only for truly legacy sources with neither profile nor analysis', async () => {
    const f = fixture();
    expect(await currentApprovedStoryVisual(f.tx as never, f.work, f.manuscript.id)).toBeNull();
    const receipt = await f.confirm(await f.input());
    expect(receipt).toMatchObject({ contract: 'story-generated-ending-read-receipt-v1' });
    expect(f.tx.storyStyleProfileConsent.findUnique).not.toHaveBeenCalled();
    expect(f.rows).toHaveLength(1);
    expect((await f.preview()).confirmation).toMatchObject({ receiptId: receipt.receiptId });
  });

  it('rejects the old scope when current approved criteria and the origin pin both move consistently', async () => {
    const f = await approvedFixture(), body = await f.input();
    f.settings.sections.find(section => section.key === 'visual_direction')!.value.summary = 'Synthetic replacement direction';
    f.profile.approvedFingerprint = creatorGenerationProfileFingerprint(f.profile.sourceFingerprint, f.settings);
    f.profile.reviewRevision++;
    await f.bindCurrentPin();
    const current = await f.preview();
    expect(current.scopeChecksum).not.toBe(body.expectedScopeChecksum);
    expect(current.sourceTextHash).toBe(body.expectedSourceTextHash);
    await expect(f.confirm(body)).rejects.toMatchObject(scopeChanged); noReceiptWrites(f);
  });
});
