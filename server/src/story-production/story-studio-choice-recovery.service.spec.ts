import { randomUUID } from 'crypto';
import { preparePastedManuscript, storedManuscriptBody } from './story-manuscript-file.policy';
import { releaseChecksum } from './story-lifecycle.policy';
import { choiceDigest, sceneDigest } from './story-studio-choice-preparation.service';
import { StoryStudioChoiceRecoveryService } from './story-studio-choice-recovery.service';
import { publicationReaderProjection } from './story-publication-reader-projection.policy';

function fixture(options: { withReaderProjection?: boolean } = {}) {
  const ids = { owner: randomUUID(), work: randomUUID(), manuscript: randomUUID(), release: randomUUID(),
    analysis: randomUUID(), review: randomUUID(), consent: randomUUID() };
  const raw = options.withReaderProjection
    ? 'Production note: opening.\n[장면 1]\n첫 기록을 열었다.\n\nProduction note: ending.\n[장면 2]\n둘째 기록을 닫았다.'
    : '첫 기록을 열었다.\n\n둘째 기록을 닫았다.';
  const split = raw.indexOf(options.withReaderProjection ? 'Production note: ending.' : '둘째');
  const prepared = preparePastedManuscript(Buffer.from(raw), JSON.stringify({ locale: 'ko', confirmed: true,
    parts: [{ partKey: 'part-a', title: '첫 기록', start: 0, end: split },
      { partKey: 'part-b', title: '둘째 기록', start: split, end: raw.length }] }));
  const manuscript: any = { id: ids.manuscript, workId: ids.work, ownerUserId: ids.owner, version: 1,
    locale: 'ko', contentHash: prepared.contentHash, structuredBody: storedManuscriptBody(prepared) };
  const readerTexts = ['첫 기록을 열었다.', '둘째 기록을 닫았다.'];
  if (options.withReaderProjection) {
    manuscript.structuredBody.publicationReaderProjection = publicationReaderProjection(prepared.contentHash,
      prepared.parts, prepared.parts.map((part, index) => ({ partKey: part.partKey, title: part.title,
        beats: [{ text: readerTexts[index] }] })));
  }
  const work: any = { id: ids.work, ownerUserId: ids.owner, status: 'draft', activeReleaseId: null,
    publishedAt: null, fixtureSource: false };
  const snapshot = { manuscriptVersionId: ids.manuscript,
    branchGraphSnapshot: { contract: 'studio-linear-v1', parts: prepared.parts.map((part, index) => ({
      partKey: part.partKey, originalLabel: index ? '작가가 검토한 엔딩' : null,
      nextPartKey: prepared.parts[index + 1]?.partKey ?? null })) },
    endingSetSnapshot: { authorMain: 'author_main' }, sceneAssetManifest: { contract: 'studio-linear-v1', visualState: 'missing' },
    localizedDisplaySnapshot: { locale: 'ko', titles: prepared.parts.map(part => part.title) } };
  const release: any = { id: ids.release, workId: ids.work, ...snapshot, checksum: releaseChecksum(snapshot),
    status: 'candidate', activatedAt: null, retiredAt: null, validationSummary: { ready: true } };
  const parts = prepared.parts.map((part, index) => ({ id: randomUUID(), position: index + 1,
    title: { ko: part.title }, status: 'draft', fixtureSource: false }));
  const scenes = parts.map((part, index) => ({ id: randomUUID(), partId: part.id,
    sceneKey: `${prepared.parts[index].partKey}-main`, status: 'draft', fixtureSource: false }));
  const beats = prepared.parts.map((part, index) => ({ sceneId: scenes[index].id,
    content: { ko: options.withReaderProjection ? readerTexts[index] : part.paragraphs.map(row => row.text).join('') } }));
  const choices: any[] = scenes.flatMap((scene, index) => [
    { id: randomUUID(), sceneId: scene.id, choiceKey: 'author-original', position: 1, routeKind: 'writer_original',
      createdAt: new Date(0),
      label: { ko: index ? '작가가 검토한 엔딩' : 'AI가 제안한 원작 문구' },
      targetSceneId: scenes[index + 1]?.id ?? null, targetEndingKey: index ? 'author_main' : null, declaredRejoinSceneId: null },
    ...[2, 3].map(position => ({ id: randomUUID(), sceneId: scene.id, position,
      createdAt: new Date(0),
      choiceKey: position === 2 ? 'branch-b' : 'branch-c', label: { ko: `다른 선택 ${position}` },
      routeKind: 'generation_required', targetSceneId: null, targetEndingKey: null, declaredRejoinSceneId: null })),
  ]);
  const profile = { pin: { approvedFingerprint: 'b'.repeat(64), reviewRevision: 2 },
    viewVersion: 'story-continuation-approved-profile-v3', analysisJobId: ids.analysis };
  const proofs = scenes.map(scene => ({ id: randomUUID(), targetId: scene.id, metadata: {
    workId: ids.work, releaseId: ids.release, manuscriptHash: prepared.contentHash, consentId: ids.consent, consentRevision: 1,
    sceneDigest: sceneDigest(beats.find(beat => beat.sceneId === scene.id)!.content.ko),
    choiceDigest: choiceDigest(choices.filter(choice => choice.sceneId === scene.id), 'ko'),
    generationProfilePin: { approvedFingerprint: 'a'.repeat(64), reviewRevision: 1 },
    generationProfileViewVersion: profile.viewVersion, analysisJobId: ids.analysis } }));
  const job: any = { id: randomUUID(), ownerUserId: ids.owner, workId: ids.work, releaseId: ids.release,
    manuscriptVersionId: ids.manuscript, totalParts: 2, completedParts: 2,
    status: 'completed', leaseToken: null, leaseExpiresAt: null, errorCode: null };
  const auditRows: any[] = [];
  const consent = { id: ids.consent, ownerUserId: ids.owner, manuscriptVersionId: ids.manuscript,
    status: 'active', startsAt: new Date(0), expiresAt: null, rightsConfirmed: true, aiBranchAllowed: true,
    allowedLocales: ['ko'], revision: 1 };
  const db: any = {
    storyWork: { findFirst: jest.fn().mockResolvedValue(work) },
    storyAuthoredImport: { findUnique: jest.fn().mockResolvedValue(null) },
    storyPublicationTransition: { findFirst: jest.fn().mockResolvedValue(null) },
    storyRelease: { findFirst: jest.fn(async ({ where }) => where.id ? release : null),
      update: jest.fn(async ({ data }) => Object.assign(release, data)) },
    storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue(manuscript) },
    storyWriterReview: { findFirst: jest.fn().mockResolvedValue({ id: ids.review, state: 'submitted', analysisJobId: ids.analysis, decisions: {} }) },
    storyFinalSubmission: { findUnique: jest.fn().mockResolvedValue({ status: 'submitted', manuscriptVersionId: ids.manuscript,
      checksum: prepared.contentHash }) },
    storyStyleProfileConsent: { findUnique: jest.fn().mockResolvedValue(consent) },
    storyAnalysisJob: { findUnique: jest.fn().mockResolvedValue({ totalParagraphs: prepared.paragraphCount,
      completedParagraphs: prepared.paragraphCount, sourceLocale: 'ko' }) },
    storyContinuityIssue: { findMany: jest.fn().mockResolvedValue([]) },
    storyPart: { findMany: jest.fn().mockResolvedValue(parts) },
    storyScene: { findMany: jest.fn().mockResolvedValue(scenes) },
    storyBeat: { findMany: jest.fn().mockResolvedValue(beats) },
    storyChoice: { findMany: jest.fn(async () => [...choices]),
      deleteMany: jest.fn(async ({ where }) => {
        const removed = choices.filter(choice => where.id.in.includes(choice.id));
        for (const row of removed) choices.splice(choices.indexOf(row), 1);
        return { count: removed.length };
      }), update: jest.fn(async ({ where, data }) => Object.assign(choices.find(choice => choice.id === where.id)!, data)) },
    storyStudioChoiceJob: { findUnique: jest.fn().mockResolvedValue(job),
      update: jest.fn(async ({ data }) => Object.assign(job, data)) },
    auditEvent: { create: jest.fn(async ({ data }) => { auditRows.push(data); return data; }),
      findMany: jest.fn(async ({ where }) => [...auditRows].reverse().filter(row => row.action === where.action)),
      findFirst: jest.fn(async () => auditRows.find(row => row.action === 'story_studio_choices.reset_reviewed') ?? null) },
    $queryRaw: jest.fn(async (sql) => sql.sql.includes('DISTINCT ON') ? proofs : []),
    $transaction: jest.fn(async (callback) => callback(db)),
  };
  for (const table of ['storyReaderProgress', 'storyAiContinuation', 'storyAiGeneratedScene',
    'storyAiReusableResult', 'storyEndingDiscovery', 'storyChoiceEvent']) db[table] = { findFirst: jest.fn().mockResolvedValue(null) };
  const gate = { approvedGenerationProfile: jest.fn().mockResolvedValue(profile),
    assertPublishableTx: jest.fn().mockResolvedValue(undefined),
    assertOriginalSceneReadyTx: jest.fn().mockResolvedValue(undefined) };
  const service = new StoryStudioChoiceRecoveryService(db, gate as never);
  const body = { expectedManuscriptHash: prepared.contentHash, expectedApprovedFingerprint: profile.pin.approvedFingerprint,
    expectedProfilePinHash: releaseChecksum({ pin: profile.pin, viewVersion: profile.viewVersion }),
    expectedReleaseChecksum: release.checksum, resetConfirmed: true };
  return { ids, db, gate, service, body, manuscript, release, work, job, parts, scenes, choices, beats, proofs, profile, consent, auditRows };
}

describe('explicit renewed consent review without AI dispatch', () => {
  function renewed() {
    const f = fixture({ withReaderProjection: true });
    f.proofs.forEach(proof => { proof.metadata.generationProfilePin = f.profile.pin; });
    f.consent.revision = 2;
    return f;
  }
  async function body(f: ReturnType<typeof fixture>) {
    const view = await f.service.review(f.ids.owner, f.ids.work, f.ids.release);
    return { expectedManuscriptHash: view.expectedManuscriptHash!, expectedApprovedFingerprint: view.expectedApprovedFingerprint!,
      expectedProfilePinHash: view.expectedProfilePinHash!, expectedReleaseChecksum: view.expectedReleaseChecksum!,
      expectedConsentId: f.consent.id, expectedConsentRevision: f.consent.revision,
      expectedBatchHash: view.consentReview!.batchHash, choicesReviewed: true, currentConsentConfirmed: true };
  }
  it('shows every saved label only to the private owner and makes no writes on review', async () => {
    const f = renewed();
    const view = await f.service.review(f.ids.owner, f.ids.work, f.ids.release);
    expect(view).toMatchObject({ status: 'consent_changed', canReset: false, generationStarted: false,
      consentReview: { canReapprove: true, consentId: f.consent.id, consentRevision: 2 } });
    expect(view.consentReview!.scenes).toHaveLength(2);
    expect(view.consentReview!.scenes[0].choices.map(choice => choice.label)).toEqual(f.choices.slice(0, 3).map(choice => choice.label.ko));
    expect(f.db.auditEvent.create).not.toHaveBeenCalled(); expect(f.db.storyStudioChoiceJob.update).not.toHaveBeenCalled();
  });
  it('appends receipts bound to immutable generation proofs, preserves all prose/labels and safely replays', async () => {
    const f = renewed(), before = JSON.stringify([f.proofs, f.choices, f.beats, f.manuscript]);
    const input = await body(f);
    expect(await f.service.reapprove(f.ids.owner, f.ids.work, f.ids.release, input)).toMatchObject({
      status: 'current', reapprovedScenes: 2, generationStarted: false, idempotentReplay: false });
    expect(f.auditRows).toHaveLength(2);
    expect(f.auditRows[0]).toMatchObject({ actorUserId: f.ids.owner, action: 'story_studio_choices.consent_reapproved',
      metadata: { sourceProofId: f.proofs[0].id, consentRevision: 2, choicesReviewed: true, currentConsentConfirmed: true } });
    expect(JSON.stringify(f.auditRows)).not.toContain('AI가 제안한');
    expect(JSON.stringify([f.proofs, f.choices, f.beats, f.manuscript])).toBe(before);
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).toMatchObject({ status: 'current', canReset: false });
    expect(await f.service.reapprove(f.ids.owner, f.ids.work, f.ids.release, input)).toMatchObject({ idempotentReplay: true, reapprovedScenes: 0 });
    expect(f.auditRows).toHaveLength(2); expect(f.db.storyStudioChoiceJob.update).toHaveBeenCalledTimes(1);
    expect(f.db.storyChoice.update).not.toHaveBeenCalled(); expect(f.db.storyChoice.deleteMany).not.toHaveBeenCalled();
  });
  it.each(['choicesReviewed', 'currentConsentConfirmed'])('requires explicit %s confirmation', async field => {
    const f = renewed(), input = await body(f);
    await expect(f.service.reapprove(f.ids.owner, f.ids.work, f.ids.release, { ...input, [field]: false }))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_CONSENT_REVIEW_CONFIRMATION_REQUIRED' } });
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it.each(['expectedManuscriptHash', 'expectedApprovedFingerprint', 'expectedProfilePinHash', 'expectedReleaseChecksum', 'expectedBatchHash',
    'expectedConsentId', 'expectedConsentRevision'])('rejects outdated %s before approval writes', async field => {
    const f = renewed(), input = await body(f);
    const value = field === 'expectedConsentId' ? randomUUID() : field === 'expectedConsentRevision' ? 3 : 'f'.repeat(64);
    await expect(f.service.reapprove(f.ids.owner, f.ids.work, f.ids.release, { ...input, [field]: value }))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_CONSENT_REVIEW_SOURCE_CHANGED' } });
    expect(f.db.auditEvent.create).not.toHaveBeenCalled();
  });
  it.each([undefined, null, '1', 0, -1, 1.5, 3])('does not bless malformed/future previous revision %s', async revision => {
    const f = renewed(); f.proofs[0].metadata.consentRevision = revision as any;
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).toMatchObject({ status: 'blocked', canReset: false });
    expect(f.db.auditEvent.create).not.toHaveBeenCalled();
  });
  it('still blocks changed style, active jobs, new manuscript, revoked rights and used stories', async () => {
    for (const mutation of [(f: ReturnType<typeof fixture>) => { f.proofs[0].metadata.generationProfilePin = { approvedFingerprint: 'c'.repeat(64), reviewRevision: 1 }; },
      (f: ReturnType<typeof fixture>) => { f.job.status = 'processing'; f.job.leaseToken = randomUUID(); },
      (f: ReturnType<typeof fixture>) => { f.db.storyManuscriptVersion.findFirst.mockResolvedValueOnce({ ...f.manuscript, contentHash: 'e'.repeat(64) }); },
      (f: ReturnType<typeof fixture>) => { f.consent.status = 'revoked'; },
      (f: ReturnType<typeof fixture>) => { f.db.storyReaderProgress.findFirst.mockResolvedValue({ id: randomUUID() }); }]) {
      const f = renewed(), input = await body(f); mutation(f);
      await expect(f.service.reapprove(f.ids.owner, f.ids.work, f.ids.release, input)).rejects.toBeDefined();
      expect(f.db.auditEvent.create).not.toHaveBeenCalled(); expect(f.db.storyRelease.update).not.toHaveBeenCalled();
    }
  });
  it('rejects a receipt if any saved choice or source generation proof identity changes', async () => {
    const f = renewed(); await f.service.reapprove(f.ids.owner, f.ids.work, f.ids.release, await body(f));
    f.proofs[0].id = randomUUID();
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).toMatchObject({ status: 'consent_changed' });
    f.choices[0].label.ko = '변경된 문구';
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).toMatchObject({ status: 'blocked' });
  });
  it('never automatically accepts the next renewed consent revision', async () => {
    const f = renewed(); await f.service.reapprove(f.ids.owner, f.ids.work, f.ids.release, await body(f));
    f.consent.revision = 3;
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).toMatchObject({ status: 'consent_changed',
      consentReview: { canReapprove: true, consentRevision: 3 } });
  });
});

describe('mixed approved-settings and renewed-consent reset (no AI dispatch)', () => {
  async function mixed() {
    const f = fixture({ withReaderProjection: true }); f.consent.revision = 2;
    const view = await f.service.review(f.ids.owner, f.ids.work, f.ids.release);
    expect(view).toMatchObject({ status: 'settings_changed', canReset: true, resetRequiredScenes: 2,
      resetConsentReview: { consentId: f.consent.id, consentRevision: 2 } });
    const input = { ...f.body, expectedConsentId: f.consent.id, expectedConsentRevision: 2,
      expectedBatchHash: view.resetConsentReview!.batchHash, consentChangeConfirmed: true };
    return { f, input };
  }
  it('archives old evidence, clears old choices, preserves original routes/prose and pauses without generation', async () => {
    const { f, input } = await mixed(), source = JSON.stringify([f.manuscript, f.beats, f.proofs]);
    const originals = f.choices.filter(choice => choice.position === 1).map(choice => ({ ...choice }));
    expect(await f.service.reset(f.ids.owner, f.ids.work, f.ids.release, input)).toMatchObject({
      resetScenes: 2, generationStarted: false, nextAction: 'explicit_retry_required' });
    expect(f.choices).toEqual([{ ...originals[0], label: { ko: null } }, originals[1]]);
    expect(JSON.stringify([f.manuscript, f.beats, f.proofs])).toBe(source);
    expect(f.auditRows[0]).toMatchObject({ action: 'story_studio_choices.reset_archive',
      metadata: { previousConsentId: f.consent.id, previousConsentRevision: 1, consentRevision: 2 } });
    expect(f.auditRows.at(-1).metadata).toMatchObject({ consentChangeConfirmed: true,
      reviewedBatchHash: input.expectedBatchHash, consentId: f.consent.id, consentRevision: 2 });
    expect(f.job).toMatchObject({ status: 'failed', completedParts: 0, errorCode: 'STUDIO_CHOICES_REPREPARATION_READY' });
    expect(f.gate.assertPublishableTx).not.toHaveBeenCalled();
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).toMatchObject({ status: 'reset_ready', preparedScenes: 0 });
    const writes = f.auditRows.length;
    expect(await f.service.reset(f.ids.owner, f.ids.work, f.ids.release, input)).toMatchObject({ idempotentReplay: true, resetScenes: 0 });
    expect(f.auditRows).toHaveLength(writes);
  });
  it('counts and archives the union of stale style and unapproved renewed-consent choices', async () => {
    const { f, input } = await mixed(); f.proofs[0].metadata.generationProfilePin = f.profile.pin;
    const view = await f.service.review(f.ids.owner, f.ids.work, f.ids.release);
    expect(view.resetRequiredScenes).toBe(2);
    expect(await f.service.reset(f.ids.owner, f.ids.work, f.ids.release, {
      ...input, expectedBatchHash: view.resetConsentReview!.batchHash })).toMatchObject({ resetScenes: 2 });
    expect(f.choices).toHaveLength(2); expect(f.job.completedParts).toBe(0);
  });
  it('preserves already current-consent/current-style choices and their generated original label', async () => {
    const { f, input } = await mixed(); f.proofs[0].metadata.generationProfilePin = f.profile.pin;
    f.proofs[0].metadata.consentRevision = 2;
    const preserved = JSON.stringify(f.choices.slice(0, 3)), view = await f.service.review(f.ids.owner, f.ids.work, f.ids.release);
    expect(view.resetRequiredScenes).toBe(1);
    expect(await f.service.reset(f.ids.owner, f.ids.work, f.ids.release, {
      ...input, expectedBatchHash: view.resetConsentReview!.batchHash })).toMatchObject({ resetScenes: 1 });
    expect(JSON.stringify(f.choices.slice(0, 3))).toBe(preserved); expect(f.job.completedParts).toBe(1);
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).toMatchObject({ status: 'reset_ready', preparedScenes: 1 });
  });
  it.each(['expectedConsentId', 'expectedConsentRevision', 'expectedBatchHash', 'consentChangeConfirmed'])
    ('requires the complete explicit renewed-consent binding: %s', async key => {
      const { f, input } = await mixed(); const incomplete: any = { ...input }; delete incomplete[key];
      await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, incomplete)).rejects.toMatchObject({
        response: { code: 'STUDIO_CHOICES_RESET_CONSENT_CONFIRMATION_REQUIRED' } });
      expect(f.db.$transaction).not.toHaveBeenCalled(); expect(f.db.storyChoice.deleteMany).not.toHaveBeenCalled();
    });
  it('cannot reuse the old four-hash-only confirmation after consent renewal', async () => {
    const { f } = await mixed();
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, f.body)).rejects.toMatchObject({
      response: { code: 'STUDIO_CHOICES_RESET_CONSENT_CONFIRMATION_REQUIRED' } });
    expect(f.db.auditEvent.create).not.toHaveBeenCalled();
  });
  it.each(['expectedConsentId', 'expectedConsentRevision', 'expectedBatchHash'])('rejects changed %s before archives', async key => {
    const { f, input } = await mixed(), value = key === 'expectedConsentId' ? randomUUID() : key === 'expectedConsentRevision' ? 3 : 'f'.repeat(64);
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, { ...input, [key]: value }))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_RESET_SOURCE_CHANGED' } });
    expect(f.db.auditEvent.create).not.toHaveBeenCalled();
  });
  it('blocks a replaced generation proof identity even when saved labels and current style stay unchanged', async () => {
    const { f, input } = await mixed(); f.proofs[0].id = randomUUID();
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, input)).rejects.toMatchObject({
      response: { code: 'STUDIO_CHOICES_RESET_SOURCE_CHANGED' } });
    expect(f.db.storyChoice.deleteMany).not.toHaveBeenCalled();
  });
  it.each([undefined, null, '1', 0, 3])('does not archive an unverifiable/future source consent revision %s', async value => {
    const { f, input } = await mixed(); f.proofs[0].metadata.consentRevision = value as any;
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, input)).rejects.toMatchObject({
      response: { code: 'STUDIO_CHOICES_RESET_PROOF_REQUIRED' } });
    expect(f.db.auditEvent.create).not.toHaveBeenCalled();
  });
  it('does not turn a rights-only renewal into a destructive reset', async () => {
    const { f, input } = await mixed(); f.proofs.forEach(proof => { proof.metadata.generationProfilePin = f.profile.pin; });
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).toMatchObject({ status: 'consent_changed', canReset: false });
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, input)).rejects.toMatchObject({
      response: { code: 'STUDIO_CHOICES_RESET_CONSENT_REAPPROVAL_REQUIRED' } });
    expect(f.db.storyChoice.deleteMany).not.toHaveBeenCalled();
  });
  it('cannot omit mixed-consent confirmation on replay or replay after consent renews again', async () => {
    const { f, input } = await mixed(); await f.service.reset(f.ids.owner, f.ids.work, f.ids.release, input);
    const writes = f.auditRows.length;
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, f.body)).rejects.toMatchObject({
      response: { code: 'STUDIO_CHOICES_RESET_NOT_REQUIRED' } });
    f.consent.revision = 3;
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, input)).rejects.toMatchObject({
      response: { code: 'STUDIO_CHOICES_RESET_SOURCE_CHANGED' } });
    expect(f.auditRows).toHaveLength(writes);
  });
  it('rejects a valid-format but wrong reviewed batch on replay without any additional changes', async () => {
    const { f, input } = await mixed(); await f.service.reset(f.ids.owner, f.ids.work, f.ids.release, input);
    const saved = JSON.stringify([f.choices, f.job, f.auditRows, f.manuscript, f.beats, f.proofs]);
    const deletes = f.db.storyChoice.deleteMany.mock.calls.length;
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, {
      ...input, expectedBatchHash: 'f'.repeat(64) })).rejects.toMatchObject({
      response: { code: 'STUDIO_CHOICES_RESET_NOT_REQUIRED' } });
    expect(JSON.stringify([f.choices, f.job, f.auditRows, f.manuscript, f.beats, f.proofs])).toBe(saved);
    expect(f.db.storyChoice.deleteMany).toHaveBeenCalledTimes(deletes);
    expect(await f.service.reset(f.ids.owner, f.ids.work, f.ids.release, input))
      .toMatchObject({ idempotentReplay: true, resetScenes: 0, generationStarted: false });
    expect(JSON.stringify([f.choices, f.job, f.auditRows, f.manuscript, f.beats, f.proofs])).toBe(saved);
  });
  it.each(['queued', 'processing', 'revoked', 'expired', 'used', 'unapproved style'])('does not reset %s candidates', async blocked => {
    const { f, input } = await mixed();
    if (blocked === 'queued' || blocked === 'processing') f.job.status = blocked;
    if (blocked === 'revoked') f.consent.status = 'revoked';
    if (blocked === 'expired') f.consent.expiresAt = new Date(0) as any;
    if (blocked === 'used') f.db.storyReaderProgress.findFirst.mockResolvedValue({ id: randomUUID() });
    if (blocked === 'unapproved style') f.gate.approvedGenerationProfile.mockResolvedValue(null);
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, input)).rejects.toBeDefined();
    expect(f.db.storyChoice.deleteMany).not.toHaveBeenCalled(); expect(f.db.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe('private Studio stale choice re-review (no AI dispatch)', () => {
  it('reviews current projected reader text without treating omitted production notes or markers as corruption', async () => {
    const f = fixture({ withReaderProjection: true });
    f.proofs.forEach(proof => { proof.metadata.generationProfilePin = f.profile.pin; });
    const source = JSON.stringify(f.manuscript.structuredBody);
    expect(f.manuscript.structuredBody.intake.source.rawText).toContain('Production note:');
    expect(f.manuscript.structuredBody.intake.source.rawText).toContain('[장면 1]');
    expect(f.beats.map(beat => beat.content.ko)).toEqual(['첫 기록을 열었다.', '둘째 기록을 닫았다.']);
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).toMatchObject({
      status: 'current', canReset: false, preparedScenes: 2, resetRequiredScenes: 0, generationStarted: false });
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, f.body))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_RESET_NOT_REQUIRED' } });
    expect(f.db.storyChoice.deleteMany).not.toHaveBeenCalled();
    expect(f.db.storyChoice.update).not.toHaveBeenCalled();
    expect(f.db.storyStudioChoiceJob.update).not.toHaveBeenCalled();
    expect(f.db.storyRelease.update).not.toHaveBeenCalled();
    expect(f.db.auditEvent.create).not.toHaveBeenCalled();
    expect(JSON.stringify(f.manuscript.structuredBody)).toBe(source);
  });

  it('resets stale projected choices while preserving reader prose and the exact source with omitted notes and markers', async () => {
    const f = fixture({ withReaderProjection: true });
    const source = JSON.stringify(f.manuscript.structuredBody), beats = JSON.stringify(f.beats);
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).toMatchObject({
      status: 'settings_changed', canReset: true, preparedScenes: 2, resetRequiredScenes: 2, generationStarted: false });
    expect(f.db.storyChoice.deleteMany).not.toHaveBeenCalled();
    expect(f.db.auditEvent.create).not.toHaveBeenCalled();
    expect(await f.service.reset(f.ids.owner, f.ids.work, f.ids.release, f.body)).toMatchObject({
      status: 'reset_ready', resetScenes: 2, generationStarted: false, nextAction: 'explicit_retry_required' });
    expect(f.choices).toHaveLength(2);
    expect(f.job).toMatchObject({ status: 'failed', errorCode: 'STUDIO_CHOICES_REPREPARATION_READY', completedParts: 0 });
    expect(f.gate.assertOriginalSceneReadyTx).toHaveBeenCalledTimes(2);
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).toMatchObject({
      status: 'reset_ready', canReset: false, preparedScenes: 0, resetRequiredScenes: 0 });
    expect(JSON.stringify(f.manuscript.structuredBody)).toBe(source);
    expect(JSON.stringify(f.beats)).toBe(beats);
  });

  it.each<[string, boolean]>([
    ['reader text', false], ['reader text', true], ['proof digest', false], ['proof digest', true],
  ])('blocks corrupted projected %s before writes, stale=%s', async (corruption, stale) => {
    const f = fixture({ withReaderProjection: true });
    if (!stale) f.proofs.forEach(proof => { proof.metadata.generationProfilePin = f.profile.pin; });
    if (corruption === 'reader text') {
      f.beats[0].content.ko += ' Changed reader prose.';
      f.proofs[0].metadata.sceneDigest = sceneDigest(f.beats[0].content.ko);
    } else {
      f.proofs[0].metadata.sceneDigest = '0'.repeat(64);
    }
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).toMatchObject({
      status: 'blocked', code: 'STUDIO_CHOICES_RESET_PROOF_REQUIRED', canReset: false });
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, f.body))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_RESET_PROOF_REQUIRED' } });
    expect(f.db.storyChoice.deleteMany).not.toHaveBeenCalled();
    expect(f.db.storyChoice.update).not.toHaveBeenCalled();
    expect(f.db.storyStudioChoiceJob.update).not.toHaveBeenCalled();
    expect(f.db.storyRelease.update).not.toHaveBeenCalled();
    expect(f.db.auditEvent.create).not.toHaveBeenCalled();
  });

  it('is readonly and reports only fingerprints/counts, not archived labels or private profile', async () => {
    const f = fixture();
    const result = await f.service.review(f.ids.owner, f.ids.work, f.ids.release);
    expect(result).toMatchObject({ status: 'settings_changed', canReset: true, resetRequiredScenes: 2,
      preparedScenes: 2, generationStarted: false });
    expect(JSON.stringify(result)).not.toContain('원작 문구');
    expect(f.db.storyChoice.deleteMany).not.toHaveBeenCalled();
    expect(f.db.storyStudioChoiceJob.update).not.toHaveBeenCalled();
    expect(f.db.auditEvent.create).not.toHaveBeenCalled();
  });

  it('archives stale choices, preserves original identity/targets, restores only generated original labels and pauses', async () => {
    const f = fixture(); const originals = f.choices.filter(choice => choice.position === 1).map(choice => ({ ...choice }));
    const result = await f.service.reset(f.ids.owner, f.ids.work, f.ids.release, f.body);
    expect(result).toEqual({ releaseId: f.ids.release, status: 'reset_ready', resetScenes: 2,
      generationStarted: false, nextAction: 'explicit_retry_required', idempotentReplay: false });
    expect(f.choices).toHaveLength(2);
    expect(f.choices[0]).toEqual({ ...originals[0], label: { ko: null } });
    expect(f.choices[1]).toEqual(originals[1]);
    expect(f.auditRows.filter(row => row.action === 'story_studio_choices.reset_archive')).toHaveLength(2);
    expect(f.auditRows[0].beforeData).toHaveLength(3);
    expect(f.job).toMatchObject({ status: 'failed', errorCode: 'STUDIO_CHOICES_REPREPARATION_READY', completedParts: 0 });
    expect(f.release.validationSummary.ready).toBe(false);
    expect(f.gate.assertOriginalSceneReadyTx).toHaveBeenCalledTimes(2);
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: 'Serializable' }));
  });

  it('does not erase a completed set already prepared for current approved settings', async () => {
    const f = fixture(); const preserved = f.choices.slice(0, 3).map(choice => ({ ...choice }));
    f.proofs[0].metadata.generationProfilePin = f.profile.pin;
    await f.service.reset(f.ids.owner, f.ids.work, f.ids.release, f.body);
    expect(f.choices.slice(0, 3)).toEqual(preserved);
    expect(f.choices).toHaveLength(4); expect(f.job.completedParts).toBe(1);
    expect(f.db.storyChoice.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('replays a paused reset without another archive or mutating original prose', async () => {
    const f = fixture(); const source = JSON.stringify(f.manuscript.structuredBody);
    await f.service.reset(f.ids.owner, f.ids.work, f.ids.release, f.body);
    const writes = f.db.auditEvent.create.mock.calls.length;
    expect(await f.service.reset(f.ids.owner, f.ids.work, f.ids.release, f.body)).toMatchObject({ idempotentReplay: true, resetScenes: 0 });
    expect(f.db.auditEvent.create).toHaveBeenCalledTimes(writes);
    expect(JSON.stringify(f.manuscript.structuredBody)).toBe(source);
    expect((await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).status).toBe('reset_ready');
  });

  it.each(['queued', 'processing'])('cannot reset a %s background job even with an expired lease', async status => {
    const f = fixture(); f.job.status = status; f.job.leaseToken = randomUUID(); f.job.leaseExpiresAt = new Date(0);
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).toMatchObject({ status: 'settings_changed', canReset: false });
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, f.body))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_RESET_JOB_ACTIVE' } });
    expect(f.db.storyChoice.deleteMany).not.toHaveBeenCalled();
  });

  it.each(['expectedApprovedFingerprint', 'expectedProfilePinHash', 'expectedManuscriptHash', 'expectedReleaseChecksum'])('rejects stale %s before deletion', async key => {
    const f = fixture();
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, { ...f.body, [key]: 'c'.repeat(64) }))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_RESET_SOURCE_CHANGED' } });
    expect(f.db.storyChoice.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a changed approval revision even when the approved settings fingerprint stays identical', async () => {
    const f = fixture(); f.profile.pin.reviewRevision += 1;
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, f.body))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_RESET_SOURCE_CHANGED' } });
    expect(f.db.storyChoice.deleteMany).not.toHaveBeenCalled();
  });

  it.each(['storyReaderProgress', 'storyAiContinuation', 'storyAiGeneratedScene', 'storyAiReusableResult',
    'storyEndingDiscovery', 'storyChoiceEvent'])('never resets when %s records exist', async table => {
    const f = fixture(); f.db[table].findFirst.mockResolvedValue({ id: randomUUID() });
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).toMatchObject({ status: 'blocked', canReset: false });
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, f.body))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_RESET_PRIVATE_UNUSED_REQUIRED' } });
    expect(f.db.auditEvent.create).not.toHaveBeenCalled();
  });

  it.each(['published', 'archived'])('never resets a %s work', async status => {
    const f = fixture(); f.work.status = status;
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).toMatchObject({ status: 'blocked' });
    expect(f.gate.approvedGenerationProfile).not.toHaveBeenCalled();
  });

  it('rejects prior publication, foreign owner/job and changed graph/beat/proof without removing choices', async () => {
    for (const change of [
      (f: ReturnType<typeof fixture>) => { f.release.activatedAt = new Date(); },
      (f: ReturnType<typeof fixture>) => { f.job.ownerUserId = randomUUID(); },
      (f: ReturnType<typeof fixture>) => { f.choices[1].targetSceneId = f.scenes[1].id; },
      (f: ReturnType<typeof fixture>) => { f.beats[0].content.ko += '다른 문장'; },
      (f: ReturnType<typeof fixture>) => { f.proofs[0].metadata.choiceDigest = 'bad'; },
      (f: ReturnType<typeof fixture>) => { f.release.checksum = 'c'.repeat(64); },
    ]) {
      const f = fixture(); change(f);
      expect((await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).status).toBe('blocked');
      await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, f.body)).rejects.toThrow();
      expect(f.db.storyChoice.deleteMany).not.toHaveBeenCalled();
    }
    const f = fixture(); f.db.storyWork.findFirst.mockResolvedValue(null);
    await expect(f.service.review(randomUUID(), f.ids.work, f.ids.release)).rejects.toMatchObject({ status: 404 });
  });

  it('requires a new approval instead of silently resetting under an unapproved profile', async () => {
    const f = fixture();
    f.gate.approvedGenerationProfile.mockResolvedValue(null);
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).toMatchObject({ status: 'approval_required', canReset: false });
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, f.body)).rejects.toThrow();
    expect(f.db.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects an unconfirmed request and does not treat a current completed set as resettable', async () => {
    const f = fixture();
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, { ...f.body, resetConfirmed: false })).rejects.toThrow();
    expect(f.db.$transaction).not.toHaveBeenCalled();
    f.proofs.forEach(proof => { proof.metadata.generationProfilePin = f.profile.pin; });
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.release)).toMatchObject({ status: 'current', canReset: false });
    await expect(f.service.reset(f.ids.owner, f.ids.work, f.ids.release, f.body))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_RESET_NOT_REQUIRED' } });
    expect(f.db.storyChoice.deleteMany).not.toHaveBeenCalled();
  });
});
