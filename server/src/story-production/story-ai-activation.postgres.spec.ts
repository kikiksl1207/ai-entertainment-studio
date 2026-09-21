import { PrismaClient } from '@prisma/client';
import { activationFixture, postgresClient } from './story-ai-activation.postgres-fixture';

const describePostgres = process.env.STORY_TEST_DATABASE_URL ? describe : describe.skip;

describePostgres('persisted story AI activation and explicit review PostgreSQL', () => {
  let db: PrismaClient;
  const region = process.env.STORY_AI_REGION;
  beforeAll(() => { process.env.STORY_AI_REGION = 'KR'; db = postgresClient(); });
  afterAll(async () => {
    if (region === undefined) delete process.env.STORY_AI_REGION; else process.env.STORY_AI_REGION = region;
    await db?.$disconnect();
  });

  it('configuration approval alone never legally activates a request', async () => {
    const f = await activationFixture(db, false);
    expect(await f.activation.prepare(f.context)).toBeNull();
    await expect(f.request()).rejects.toThrow('Forbidden');
    expect(f.provider.readiness).not.toHaveBeenCalled();
  });

  it('allows legally activated private generation without granting shared reuse', async () => {
    const f = await activationFixture(db, true, false);
    expect(await f.activation.prepare(f.context, db, false)).not.toBeNull();
    expect(await f.approval.prepare(f.context)).toMatchObject({ eligible: false });
    const continuation = await f.generatePersonal();
    expect(continuation).toMatchObject({ status: 'completed', sharedResultId: null, reuseKey: null });
    expect(await db.storyAiGeneratedScene.findUnique({ where: { id: continuation.resultGeneratedSceneId! } }))
      .toMatchObject({ provenance: 'ai_generated', sharedResultId: null });
    expect(await db.storyAiReusableResult.count({ where: { workId: f.work.id } })).toBe(0);
    expect(await db.storyAiResultEvidence.count({ where: { originGeneratedSceneId: continuation.resultGeneratedSceneId! } })).toBe(0);
  });

  it('ignores a newer draft but fails closed on a newer effective approved rights version', async () => {
    const f = await activationFixture(db);
    const { id: _id, createdAt: _createdAt, ...rights } = f.rights;
    await db.contentRightsContractVersion.create({ data: { ...rights, revision: 2, approvalState: 'draft',
      approvedByUserId: null,
      media: rights.media as never, regions: rights.regions as never } });
    expect(await f.activation.prepare(f.context)).not.toBeNull();
    await db.contentRightsContractVersion.create({ data: { ...rights, revision: 3,
      media: rights.media as never, regions: rights.regions as never } });
    expect(await f.activation.prepare(f.context)).toBeNull();
  });

  it('private first result, review pending, explicit concurrent promotion, exact second reader zero-cost hit', async () => {
    const f = await activationFixture(db);
    const result = await f.generate();
    expect(result).toMatchObject({ status: 'pending', title: null, visualManifest: null, claimToken: null });
    expect(await db.storyAiResultEvidence.count({ where: { sharedResultId: result.id } })).toBe(0);
    expect(await db.storyAiReusableBeat.count({ where: { sharedResultId: result.id } })).toBe(0);
    expect(await db.storyAiGeneratedScene.findUnique({ where: { id: result.originGeneratedSceneId! } }))
      .toMatchObject({ sharedResultId: null, provenance: 'ai_generated' });
    await expect(f.request(1)).rejects.toMatchObject({ response: { code: 'STORY_AI_SHARED_RESULT_PENDING' } });
    const detail = await f.activation.review(result.id);
    expect(detail.reviewState).toBe('review_pending');
    expect(detail.content?.beats).toHaveLength(1);
    expect(detail.content?.choices).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toMatch(/userId|contextReferences|privateInput|providerPayload/);
    expect((await f.activation.reviewQueue({ limit: 1 })).items).toHaveLength(1);
    await expect(f.activation.promote(f.owner.id, result.id, result.resultChecksum!)).rejects.toThrow('evidence required');
    await f.addEvidence(result, 'moderation');
    await expect(f.activation.promote(f.owner.id, result.id, result.resultChecksum!)).rejects.toThrow('evidence required');
    await f.addEvidence(result, 'quality');
    const approvals = await Promise.all([
      f.activation.promote(f.owner.id, result.id, result.resultChecksum!),
      f.activation.promote(f.owner.id, result.id, result.resultChecksum!),
    ]);
    expect(approvals.map((r) => r.idempotentReplay).sort()).toEqual([false, true]);
    const allowancesBefore = await db.storyAiAllowanceBucket.findMany({ where: { workId: f.work.id } });
    const canonicalBefore = await db.storyBeat.findMany({ where: { sceneId: f.scene.id } });
    const readinessCalls = f.provider.readiness.mock.calls.length;
    f.provider.readiness.mockResolvedValue({ enabled: false });
    const hit = await f.request(1);
    expect(hit).toMatchObject({ status: 'completed', provenance: 'ai_reused' });
    expect(f.provider.readiness).toHaveBeenCalledTimes(readinessCalls);
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(await db.storyAiAllowanceBucket.findMany({ where: { workId: f.work.id } })).toEqual(allowancesBefore);
    expect(await db.storyBeat.findMany({ where: { sceneId: f.scene.id } })).toEqual(canonicalBefore);
    const ledger = await db.storyAiUsageLedger.findFirstOrThrow({ where: { continuationId: hit.continuationId } });
    expect(ledger).toMatchObject({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, imageUnits: 0, allowanceDelta: 0 });
    expect(ledger.estimatedCostKrw.isZero() && ledger.actualCostKrw!.isZero()).toBe(true);
    expect(await db.storyAiGeneratedScene.findUnique({ where: { id: hit.resultGeneratedSceneId! } }))
      .toMatchObject({ userId: f.second.id, progressId: f.progresses[1].id, sharedResultId: result.id, provenance: 'ai_reused' });
  }, 30000);

  it('rejects missing, mismatched, stale-policy and unconfirmed quality evidence', async () => {
    const f = await activationFixture(db);
    const result = await f.generate();
    await expect(f.addEvidence(result, 'moderation', { resultChecksum: 'f'.repeat(64) })).rejects.toThrow('checksum');
    await expect(f.addEvidence(result, 'quality', { qualityRubricConfirmed: false })).rejects.toThrow('Explicit');
    await f.addEvidence(result, 'moderation', { policyVersion: 'old-v0' });
    await f.addEvidence(result, 'quality');
    await expect(f.activation.promote(f.owner.id, result.id, result.resultChecksum!)).rejects.toThrow('evidence required');
    await expect(db.$executeRaw`UPDATE story_ai_reusable_results SET status='approved', title='{}',
      visual_manifest='{}', approved_at=now() WHERE id=${result.id}::uuid`).rejects.toThrow(/requires active legal/);
  });

  it('activation and evidence are append-only; supersession/revoke invalidates future hits', async () => {
    const f = await activationFixture(db);
    const result = await f.generate();
    const moderation = await f.addEvidence(result, 'moderation');
    await f.addEvidence(result, 'quality');
    await f.activation.promote(f.owner.id, result.id, result.resultChecksum!);
    await expect(db.storyAiLegalActivation.update({ where: { id: f.active!.id }, data: { evidenceHash: 'f'.repeat(64) } }))
      .rejects.toThrow('append-only');
    await expect(db.storyAiResultEvidence.delete({ where: { id: moderation.id } })).rejects.toThrow('append-only');
    await expect(f.addEvidence(result, 'moderation', { revision: 3, supersedesId: moderation.id })).rejects.toThrow('revision');
    await f.addEvidence(result, 'moderation', { revision: 2, supersedesId: moderation.id, decision: 'revoke' });
    expect(await db.storyAiReusableResult.findUnique({ where: { id: result.id } })).toMatchObject({ status: 'revoked' });
    await expect(f.request(1)).rejects.toMatchObject({ response: { code: 'STORY_AI_SHARED_RESULT_REVOKED' } });
    expect(await db.storyAiResultEvidence.count({ where: { sharedResultId: result.id } })).toBe(3);
  });

  it.each(['locale', 'region', 'consent-revision', 'consent-withdrawal', 'activation-revoke'])('fails closed for %s', async (kind) => {
    const f = await activationFixture(db);
    expect(await f.activation.prepare(f.context)).not.toBeNull();
    if (kind === 'locale') expect(await f.activation.prepare({ ...f.context, locale: 'en' })).toBeNull();
    else if (kind === 'region') {
      process.env.STORY_AI_REGION = 'JP';
      try { expect(await f.activation.prepare(f.context)).toBeNull(); } finally { process.env.STORY_AI_REGION = 'KR'; }
    } else {
      if (kind === 'consent-revision') await db.storyStyleProfileConsent.update({ where: { id: f.consent.id }, data: { revision: 2 } });
      if (kind === 'consent-withdrawal') await db.storyStyleProfileConsent.update({ where: { id: f.consent.id }, data: { status: 'withdrawn', withdrawnAt: new Date() } });
      if (kind === 'activation-revoke') await f.activation.revokeActivation(f.owner.id, f.active!.id, 'e'.repeat(64));
      expect(await f.activation.prepare(f.context)).toBeNull();
    }
  });

  it('expired activation and evidence cannot authorize approval', async () => {
    const f = await activationFixture(db, false);
    await expect(f.activation.createActivation(f.owner.id, { ...f.activationBody,
      startsAt: new Date(0).toISOString(), expiresAt: new Date(1).toISOString() })).rejects.toThrow('not currently valid');
    await f.activation.createActivation(f.owner.id, f.activationBody);
    const result = await f.generate();
    await expect(f.addEvidence(result, 'moderation', { expiresAt: new Date(0).toISOString() })).rejects.toThrow('expired');
  });

  it('rejects cross-owner activation and evidence origins at the database boundary', async () => {
    const f = await activationFixture(db);
    const other = await activationFixture(db);
    await expect(f.activation.createActivation(f.owner.id, { ...f.activationBody, rightsContractVersionId: other.rights.id }))
      .rejects.toThrow('owner or version mismatch');
    const result = await f.generate();
    const otherResult = await other.generate();
    await expect(db.storyAiResultEvidence.create({ data: {
      sharedResultId: result.id, originGeneratedSceneId: otherResult.originGeneratedSceneId!, resultChecksum: result.resultChecksum!,
      kind: 'moderation', decision: 'allow', revision: 1, policyVersion: 'v1', evaluatorVersion: 'v1',
      evidenceHash: 'e'.repeat(64), actorUserId: f.owner.id, expiresAt: new Date(Date.now() + 100000),
    } })).rejects.toThrow('origin or checksum mismatch');
  });

  it('freezes reviewed private payload and refuses promotion of pre-existing checksum corruption', async () => {
    const f = await activationFixture(db);
    const result = await f.generate();
    await f.addEvidence(result, 'moderation');
    await f.addEvidence(result, 'quality');
    await expect(db.storyAiGeneratedBeat.updateMany({ where: { sceneId: result.originGeneratedSceneId! },
      data: { content: { ko: 'Altered after review' } } })).rejects.toThrow('reviewed origin children are immutable');
    // Deliberate corruption injection only, simulating data predating the new guard.
    // Normal setup and every service/gate execution run with all triggers enabled.
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.storyAiGeneratedBeat.updateMany({ where: { sceneId: result.originGeneratedSceneId! },
        data: { content: { ko: 'Altered after review' } } });
    });
    await expect(f.activation.promote(f.owner.id, result.id, result.resultChecksum!)).rejects.toThrow('checksum mismatch');
    expect(await f.activation.review(result.id)).toMatchObject({ reviewState: 'invalid_checksum', checksumValid: false });
    expect(await db.storyAiReusableBeat.count({ where: { sharedResultId: result.id } })).toBe(0);
  });
});
