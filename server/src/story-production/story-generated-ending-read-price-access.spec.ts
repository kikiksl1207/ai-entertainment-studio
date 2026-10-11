import 'reflect-metadata';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { fixture } from '../../test/fixtures/story-generated-ending-read.fixture';
import { assertCreatorGenerationProfileApprovable, creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile, stableJson, STORY_PROFILE_SECTION_KEYS } from '../generation-profile/creator-generation-profile.policy';
import { currentApprovedStoryVisual } from './story-approved-visual-context.policy';
import { parseContinuationGenerationProfilePin } from './story-continuation-context.policy';

// SOURCE memo: parent owns immutable a632 admission and the receipt's OR-to-AND edit.
// story-current-scene-access-boundary.spec.ts ALLOWED_ACCESS already covers free-work
// and free-current-part for generated-ending; StoryProductionService's access gate
// uses either zero price. This spec does not add the separate public-beta exception.
// docs/story-completion-current.md:1227/1349-1351 separates reading from approval/reuse.
// Reuse the real receipt service through its existing fixture. currentProgress and
// storage/locks are synthetic; this is not a full projection or real DB rollback proof.
// The base fixture has null approval. The extension below constructs approved facts
// using the existing visual-approval fixture pattern and actual policy functions.
// Existing one-paid-price denial fixtures need parent-owned correction, not edits here.
// Read ROOT/CLEAN receipt raw ef778d61aad4dbe1b35a833f0fc033c97defdfef64f8878ae4cb9e2744e7e6bf;
// prior a632 receipt raw 3183eea4a9c9a3a0af3724184ec28553ac34bca7722cd94a49dff5071e4c5e08 is parent-confirmed.
// Reused fixture raw 029d5056ddda5d774affe0813c7f2812bb57e29d51c7d4586defaa5d70cae533.

const scopeChanged = { response: { code: 'STORY_GENERATED_ENDING_READ_SCOPE_CHANGED' } };
const artworkChanged = { response: { code: 'STORY_GENERATED_ENDING_READ_ARTWORK_CHANGED' } };
const evidenceInvalid = { response: { code: 'STORY_GENERATED_ENDING_READ_EVIDENCE_INVALID' } };
const accessRequired = { status: 403, response: { code: 'STORY_GENERATED_ENDING_READ_ACCESS_REQUIRED' } };
const receiptFlags = { progressMutated: false, generationStarted: false, imageGenerationStarted: false,
  meaningApproved: false, qualityApproved: false, publicationStarted: false };

async function approvedFixture(workPrice = 0, partPrice = 0) {
  const f = fixture();
  f.work.priceLumina = new Prisma.Decimal(workPrice);
  f.part.priceLumina = new Prisma.Decimal(partPrice);
  const analysis = { id: randomUUID(), analysisVersion: 1, workId: f.work.id,
    manuscriptVersionId: f.manuscript.id, configHash: 'd'.repeat(64),
    sourceContentHash: f.manuscript.contentHash, completedParagraphs: 2, totalParagraphs: 2 };
  const sourceFingerprint = createHash('sha256').update(stableJson({ workId: f.work.id,
    manuscriptVersionId: f.manuscript.id, contentHash: f.manuscript.contentHash,
    analysisJobId: analysis.id, analysisVersion: analysis.analysisVersion, analysisConfigHash: analysis.configHash })).digest('hex');
  const settings = normalizeCreatorGenerationProfile('story', { schemaVersion: 'creator-generation-profile-v1', kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted',
      value: { summary: `Synthetic ${key}` }, evidence: [] })) });
  assertCreatorGenerationProfileApprovable(settings);
  const profile = { id: randomUUID(), workId: f.work.id, ownerUserId: f.work.ownerUserId,
    approvedByUserId: f.work.ownerUserId, manuscriptVersionId: f.manuscript.id, analysisJobId: analysis.id,
    profileVersion: 1, reviewRevision: 1, status: 'approved', approvedAt: new Date('2026-01-01T00:00:00.000Z'),
    sourceFingerprint, approvedSettings: settings,
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings) };
  const consent = { id: randomUUID(), revision: 1, workId: f.work.id, ownerUserId: f.work.ownerUserId,
    manuscriptVersionId: f.manuscript.id, status: 'active', rightsConfirmed: true,
    imageTransformationAllowed: true, aiBranchAllowed: true, allowedLocales: ['ko'],
    startsAt: new Date(0), expiresAt: null as Date | null };
  f.tx.storyWorkGenerationProfile.findFirst.mockImplementation(async () => profile as never);
  f.tx.storyAnalysisJob.findFirst.mockImplementation(async () => analysis as never);
  f.tx.storyStyleProfileConsent.findUnique.mockImplementation(async () => consent as never);
  const approval = await currentApprovedStoryVisual(f.tx as never, f.work, f.manuscript.id);
  const pin = parseContinuationGenerationProfilePin(approval?.approvalIdentity as Prisma.JsonValue | undefined);
  if (!pin) throw new Error('Synthetic approved fixture requires the actual current profile pin');
  const origin = Object.assign(f.origin, { contextReferences: { generationProfilePin: { ...pin } } as Prisma.JsonObject });
  return { ...f, origin, profile, consent };
}

function productState(f: ReturnType<typeof fixture>) {
  return JSON.stringify({ progress: f.progress, work: f.work, release: f.release, manuscript: f.manuscript,
    scene: f.scene, part: f.part, origin: f.origin, route: f.route, asset: f.asset });
}

function noProductWrites(f: ReturnType<typeof fixture>) {
  expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  expect(f.tx.storyAiContinuation.create).not.toHaveBeenCalled();
}

function noReceiptWrites(f: ReturnType<typeof fixture>) {
  expect(f.rows).toHaveLength(0);
  expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  noProductWrites(f);
}

async function recordsOneCurrentRead(f: Awaited<ReturnType<typeof approvedFixture>>) {
  const before = productState(f);
  const preview = await f.preview();
  expect(preview).toMatchObject({ contract: 'story-generated-ending-read-review-v1', confirmation: null });
  noReceiptWrites(f);
  expect(f.tx.$executeRaw.mock.calls[0][0].sql).toBe('SET TRANSACTION READ ONLY');
  const body = await f.input(), receipt = await f.confirm(body);
  expect(receipt).toMatchObject({ contract: 'story-generated-ending-read-receipt-v1', ...receiptFlags,
    idempotentReplay: false });
  expect(await f.confirm(body)).toMatchObject({ receiptId: receipt.receiptId, ...receiptFlags, idempotentReplay: true });
  expect((await f.preview()).confirmation).toMatchObject({ receiptId: receipt.receiptId, ...receiptFlags });
  await expect(f.confirm({ ...body, idempotencyKey: randomUUID() })).rejects.toMatchObject({
    response: { code: 'STORY_GENERATED_ENDING_READ_ALREADY_RECORDED' } });
  expect(f.rows).toHaveLength(1);
  expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
  expect(f.rows[0].metadata).toMatchObject({ explicitRead: true, meaningApproved: false,
    qualityApproved: false, publicationStarted: false, receipt: receiptFlags });
  expect(productState(f)).toBe(before);
  noProductWrites(f);
  expect(f.stories.currentProgress).toHaveBeenCalledWith(f.userId, f.progressId, 'ko', false);
}

describe('generated ending receipt current price access', () => {
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Synthetic receipt tests must not dispatch network or provider requests');
    });
  });
  afterEach(() => {
    try { expect(fetchSpy).not.toHaveBeenCalled(); } finally { fetchSpy.mockRestore(); }
  });

  it.each([
    { name: 'free work with paid current part', workPrice: 0, partPrice: 25 },
    { name: 'paid work with free current part', workPrice: 100, partPrice: 0 },
  ])('previews and confirms $name without an entitlement or approval promotion', async ({ workPrice, partPrice }) => {
    const f = await approvedFixture(workPrice, partPrice);
    await recordsOneCurrentRead(f);
    expect(f.tx.userEntitlement.findFirst).not.toHaveBeenCalled();
    expect(f.profile.status).toBe('approved');
    expect(f.consent.status).toBe('active');
  });

  it('rejects preview and confirm when both prices are paid and no entitlement exists', async () => {
    const f = await approvedFixture(), body = await f.input();
    f.work.priceLumina = new Prisma.Decimal(100);
    f.part.priceLumina = new Prisma.Decimal(25);
    const before = productState(f);
    const deniedPreview = f.preview();
    await expect(deniedPreview).rejects.toBeInstanceOf(ForbiddenException);
    await expect(deniedPreview).rejects.toMatchObject(accessRequired);
    await expect(f.confirm(body)).rejects.toMatchObject(accessRequired);
    expect(f.tx.userEntitlement.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where:
      expect.objectContaining({ userId: f.userId, revokedAt: null, referenceId: { in: [f.work.id, f.part.id] } }) }));
    expect(productState(f)).toBe(before);
    noReceiptWrites(f);
  });

  it('previews and confirms both paid prices with a current matching entitlement', async () => {
    const f = await approvedFixture(100, 25), grantId = randomUUID();
    // The existing fixture's selected entitlement projection is a synthetic DB fact.
    f.tx.userEntitlement.findFirst.mockResolvedValue({ id: grantId } as never);
    await recordsOneCurrentRead(f);
    expect(f.tx.userEntitlement.findFirst).toHaveBeenCalledWith({ where: {
      userId: f.userId, entitlementType: { in: ['story_work', 'story_season', 'story_part'] },
      referenceId: { in: [f.work.id, f.part.id] }, revokedAt: null, startsAt: { lte: expect.any(Date) },
      OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] }, select: { id: true } });
    const index = f.tx.$queryRaw.mock.calls.findIndex(([sql]) => /FROM user_entitlements[\s\S]*FOR SHARE/u.test(sql.sql));
    expect(index).toBeGreaterThanOrEqual(0);
    expect(f.tx.$queryRaw.mock.invocationCallOrder[index]).toBeLessThan(f.tx.auditEvent.create.mock.invocationCallOrder[0]);
  });

  it('rechecks paid entitlement after a captured ready page before writing the receipt', async () => {
    const f = await approvedFixture(100, 25);
    f.tx.userEntitlement.findFirst.mockResolvedValue({ id: randomUUID() } as never);
    const body = await f.input();
    f.stories.currentProgress.mockImplementationOnce(async (_user, _progress, locale) => {
      const captured = f.page(locale);
      f.tx.userEntitlement.findFirst.mockResolvedValue(null);
      return captured;
    });
    await expect(f.confirm(body)).rejects.toMatchObject(accessRequired);
    noReceiptWrites(f);
  });

  it.each(['release', 'manuscript', 'approval', 'route', 'ownership', 'revision'] as const)(
    'free-work access does not bypass the current %s fence', async kind => {
      const f = await approvedFixture(0, 25), body = await f.input();
      if (kind === 'release') f.work.activeReleaseId = randomUUID();
      if (kind === 'manuscript') f.origin.manuscriptVersionId = randomUUID();
      if (kind === 'approval') f.profile.reviewRevision++;
      if (kind === 'route') f.route.parentId = randomUUID();
      if (kind === 'ownership') f.progress.userId = randomUUID();
      if (kind === 'revision') f.progress.progressRevision++;
      const before = productState(f);
      if (kind === 'ownership') await expect(f.confirm(body)).rejects.toBeInstanceOf(NotFoundException);
      else await expect(f.confirm(body)).rejects.toMatchObject(kind === 'approval' ? artworkChanged : scopeChanged);
      expect(productState(f)).toBe(before);
      noReceiptWrites(f);
    },
  );

  it('free-current-part access does not turn a generated scene with choices into an ending', async () => {
    const f = await approvedFixture(100, 0), body = await f.input();
    f.tx.storyAiGeneratedChoice.count.mockResolvedValue(1);
    await expect(f.confirm(body)).rejects.toMatchObject(scopeChanged);
    noReceiptWrites(f);
  });

  it('free access still rejects current author consent withdrawn after a ready projection', async () => {
    const f = await approvedFixture(0, 25), body = await f.input();
    f.stories.currentProgress.mockImplementationOnce(async (_user, _progress, locale) => {
      const captured = f.page(locale);
      f.consent.status = 'withdrawn';
      f.consent.revision++;
      return captured;
    });
    await expect(f.confirm(body)).rejects.toMatchObject(artworkChanged);
    expect(f.origin.contextReferences.generationProfilePin).toBeDefined();
    noReceiptWrites(f);
  });

  it('free access still rejects artwork withdrawn after a ready projection', async () => {
    const f = await approvedFixture(100, 0), body = await f.input();
    f.stories.currentProgress.mockImplementationOnce(async (_user, _progress, locale) => {
      const captured = f.page(locale);
      f.asset.visibility = 'private';
      return captured;
    });
    await expect(f.confirm(body)).rejects.toMatchObject(artworkChanged);
    noReceiptWrites(f);
  });

  it('rejects duplicate stored receipt evidence without adding an audit or promoting approval', async () => {
    const f = await approvedFixture(0, 25), body = await f.input();
    await f.confirm(body);
    f.rows.push({ ...f.rows[0], id: randomUUID() });
    const before = JSON.stringify(f.rows);
    await expect(f.preview()).rejects.toMatchObject(evidenceInvalid);
    await expect(f.confirm(body)).rejects.toMatchObject(evidenceInvalid);
    expect(JSON.stringify(f.rows)).toBe(before);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    noProductWrites(f);
  });

  it('does not accept a stored meaning-approval flag as a valid free-access read receipt', async () => {
    const f = await approvedFixture(100, 0);
    await f.confirm(await f.input());
    (f.rows[0].metadata as Record<string, unknown>).meaningApproved = true;
    const before = JSON.stringify(f.rows);
    const invalidPreview = f.preview();
    await expect(invalidPreview).rejects.toBeInstanceOf(ConflictException);
    await expect(invalidPreview).rejects.toMatchObject(evidenceInvalid);
    expect(JSON.stringify(f.rows)).toBe(before);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    noProductWrites(f);
  });
});
