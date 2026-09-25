import { randomUUID } from 'crypto';
import { prepareManuscript, preparePastedManuscript, storedManuscriptBody } from './story-manuscript-file.policy';
import { linearPartPlan, splitStudioLinearBeats, StoryStudioLinearService } from './story-studio-linear.service';

function fixture() {
  const ids = { owner: randomUUID(), work: randomUUID(), manuscript: randomUUID(), analysis: randomUUID(),
    review: randomUUID(), release: randomUUID(), consent: randomUUID() };
  const raw = '첫 파트 원고.\n\n두 번째 파트 원고.';
  const split = raw.indexOf('두 번째');
  const prepared = preparePastedManuscript(Buffer.from(raw), JSON.stringify({ locale: 'ko', confirmed: true,
    parts: [{ partKey: 'part-a', title: '첫 파트', start: 0, end: split },
      { partKey: 'part-b', title: '둘째 파트', start: split, end: raw.length }] }));
  const manuscript = { id: ids.manuscript, workId: ids.work, ownerUserId: ids.owner,
    locale: 'ko', contentHash: prepared.contentHash, structuredBody: storedManuscriptBody(prepared) };
  const work = { id: ids.work, ownerUserId: ids.owner, status: 'draft', activeReleaseId: null,
    publishedAt: null, fixtureSource: false };
  const consent = { id: ids.consent, ownerUserId: ids.owner, manuscriptVersionId: ids.manuscript,
    status: 'active', rightsConfirmed: true, aiBranchAllowed: true, startsAt: new Date(0),
    expiresAt: null, allowedLocales: ['ko'], revision: 1 };
  const release = { id: ids.release, workId: ids.work, manuscriptVersionId: ids.manuscript, status: 'candidate',
    validationSummary: { ready: false } };
  const partRows: any[] = []; const sceneRows: any[] = []; const beatRows: any[] = []; const choiceRows: any[] = [];
  let storedRelease: any = null;
  const db: any = {
    storyWork: { findFirst: jest.fn().mockResolvedValue(work) },
    storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue(manuscript) },
    storyAnalysisJob: { findFirst: jest.fn().mockResolvedValue({ id: ids.analysis, status: 'completed',
      pipeline: 'semantic_extraction_v1', sourceContentHash: prepared.contentHash, sourceLocale: 'ko',
      totalParagraphs: prepared.paragraphCount, completedParagraphs: prepared.paragraphCount }) },
    storyWriterReview: { findFirst: jest.fn().mockResolvedValue({ id: ids.review, analysisJobId: ids.analysis,
      state: 'submitted', decisions: { warningAcknowledged: true }, revision: 6 }) },
    storyFinalSubmission: { findUnique: jest.fn().mockResolvedValue({ checksum: prepared.contentHash, status: 'submitted' }) },
    storyStyleProfileConsent: { findUnique: jest.fn().mockResolvedValue(consent) },
    storyAuthoredImport: { findUnique: jest.fn().mockResolvedValue(null) },
    storyContinuityIssue: { findMany: jest.fn().mockResolvedValue([]) },
    storyReaderProgress: { count: jest.fn().mockResolvedValue(0) },
    storyRelease: { findFirst: jest.fn(async ({ where }) => where.id ? release : storedRelease),
      create: jest.fn(async ({ data }) => { storedRelease = { ...release, ...data }; return storedRelease; }),
      update: jest.fn(async ({ data }) => { storedRelease = { ...storedRelease, ...data }; return storedRelease; }) },
    storyPart: { count: jest.fn().mockResolvedValue(0), createMany: jest.fn(async ({ data }) => {
      partRows.push(...data); return { count: data.length }; }), findMany: jest.fn(async () => partRows) },
    storyScene: { createMany: jest.fn(async ({ data }) => { sceneRows.push(...data); return { count: data.length }; }),
      findFirst: jest.fn(async ({ where }) => sceneRows.find(row => row.partId === where.partId)) },
    storyBeat: { createMany: jest.fn(async ({ data }) => { beatRows.push(...data); return { count: data.length }; }) },
    storyChoice: { createMany: jest.fn(async ({ data }) => { choiceRows.push(...data); return { count: data.length }; }),
      findMany: jest.fn(async ({ where }) => choiceRows.filter(row => row.sceneId === where.sceneId)) },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (run: (tx: unknown) => Promise<unknown>) => run(db)),
  };
  const choiceGate = { assertPublishableTx: jest.fn().mockResolvedValue({}) };
  const service = new StoryStudioLinearService(db as never, choiceGate as never);
  const body = { manuscriptVersionId: ids.manuscript, expectedManuscriptHash: prepared.contentHash,
    originalRoutesReviewed: true, originalRoutes: [
      { partKey: 'part-a', label: '편지를 가지고 둘째 파트로 간다' },
      { partKey: 'part-b', label: '원작의 결말을 맞이한다' },
    ] };
  return { ids, prepared, manuscript, work, consent, release, db, service, body,
    partRows, sceneRows, beatRows, choiceRows, choiceGate };
}

describe('generic Studio linear manuscript materialization', () => {
  it('preserves long original prose while ending pages at natural whitespace', () => {
    const text = '권이현은 복도로 나갔다. 다음 기록을 확인했다.\n\n'.repeat(240);
    const beats = splitStudioLinearBeats(text);
    expect(beats.length).toBeGreaterThanOrEqual(3);
    expect(beats.join('')).toBe(text);
    expect(beats.slice(0, -1).every(beat => /\s$/u.test(beat))).toBe(true);
    expect(beats.every(beat => beat.length <= 2_400)).toBe(true);
  });
  it('keeps every pasted source character and binds choice 1 to the next original part or authored ending', async () => {
    const f = fixture();
    const result = await f.service.materialize(f.ids.owner, f.ids.work, f.body);
    expect(result.scenes).toHaveLength(2);
    expect(f.partRows).toHaveLength(2);
    expect(f.sceneRows).toHaveLength(2);
    expect(f.beatRows.filter(row => row.sceneId === f.sceneRows[0].id).map(row => row.content.ko).join(''))
      .toBe(f.prepared.parts[0].paragraphs.map(row => row.text).join(''));
    expect(f.choiceRows[0]).toMatchObject({ position: 1, routeKind: 'writer_original',
      targetSceneId: f.sceneRows[1].id, targetEndingKey: null });
    expect(f.choiceRows[1]).toMatchObject({ position: 1, routeKind: 'writer_original',
      targetSceneId: null, targetEndingKey: 'author_main' });
    expect(f.db.storyRelease.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      validationSummary: expect.objectContaining({ ready: false }) }) });
    expect(f.choiceRows).toHaveLength(2);
  });

  it('rejects missing review, consent, changed source and unconfirmed routes without creating scenes', async () => {
    const f = fixture();
    f.db.storyFinalSubmission.findUnique.mockResolvedValueOnce(null);
    await expect(f.service.materialize(f.ids.owner, f.ids.work, f.body))
      .rejects.toMatchObject({ response: { code: 'STUDIO_LINEAR_FINAL_REVIEW_REQUIRED' } });
    f.consent.aiBranchAllowed = false;
    await expect(f.service.materialize(f.ids.owner, f.ids.work, f.body))
      .rejects.toMatchObject({ response: { code: 'STUDIO_LINEAR_AI_RIGHTS_CONSENT_REQUIRED' } });
    f.consent.aiBranchAllowed = true;
    await expect(f.service.materialize(f.ids.owner, f.ids.work, { ...f.body, expectedManuscriptHash: 'a'.repeat(64) }))
      .rejects.toMatchObject({ response: { code: 'STUDIO_LINEAR_SOURCE_CHANGED' } });
    await expect(f.service.materialize(f.ids.owner, f.ids.work, { ...f.body, originalRoutesReviewed: false }))
      .rejects.toMatchObject({ response: { code: 'STUDIO_LINEAR_ROUTE_REVIEW_REQUIRED' } });
    expect(f.db.storyRelease.create).not.toHaveBeenCalled();
    expect(f.db.storyScene.createMany).not.toHaveBeenCalled();
  });

  it('requires explicit, ordered original labels, even for a long manuscript', () => {
    const f = fixture();
    const routes = f.body.originalRoutes;
    expect(() => linearPartPlan(f.prepared, routes.slice().reverse())).toThrow();
    expect(() => linearPartPlan(f.prepared, [{ ...routes[0], label: '다음' }, routes[1]])).toThrow();
    const long = { ...f.prepared, parts: Array.from({ length: 265 }, (_, index) => ({
      partKey: `part-${index + 1}`, title: `파트 ${index + 1}`,
      paragraphs: [{ kind: 'paragraph' as const, text: `본문 ${index + 1}` }] })) };
    expect(linearPartPlan(long, long.parts.map(part => ({ partKey: part.partKey,
      label: `${part.title}의 원작 전개를 따른다` })))).toHaveLength(265);
  });

  it('does not mark a release ready until every choice proof passes', async () => {
    const f = fixture();
    f.choiceGate.assertPublishableTx.mockRejectedValueOnce(new Error('choice proof missing'));
    await expect(f.service.finish(f.ids.owner, f.ids.work, f.ids.release))
      .rejects.toMatchObject({ response: { code: 'STUDIO_LINEAR_FINAL_VALIDATION_FAILED' } });
    expect(f.db.storyRelease.update).not.toHaveBeenCalled();
    await expect(f.service.finish(f.ids.owner, f.ids.work, f.ids.release))
      .resolves.toEqual({ releaseId: f.ids.release, ready: true, published: false });
    expect(f.db.storyRelease.update).toHaveBeenCalledWith({ where: { id: f.ids.release },
      data: { validationSummary: expect.objectContaining({ ready: true, blockingIssueCount: 0 }) } });
  });

  it('replays only the same reviewed materialization and does not duplicate parts or choices', async () => {
    const f = fixture();
    const first = await f.service.materialize(f.ids.owner, f.ids.work, f.body);
    const replay = await f.service.materialize(f.ids.owner, f.ids.work, f.body);
    expect(replay).toMatchObject({ releaseId: first.releaseId, idempotentReplay: true });
    expect(f.db.storyPart.createMany).toHaveBeenCalledTimes(1);
    expect(f.db.storyChoice.createMany).toHaveBeenCalledTimes(1);
    await expect(f.service.materialize(f.ids.owner, f.ids.work, { ...f.body,
      originalRoutes: [{ ...f.body.originalRoutes[0], label: '다른 길을 간다' }, f.body.originalRoutes[1]] }))
      .rejects.toMatchObject({ response: { code: 'STUDIO_LINEAR_EXISTING_RELEASE_CONFLICT' } });
  });

  it('rejects stored text that no longer matches its original upload hash', async () => {
    const f = fixture();
    const body = structuredClone(f.manuscript.structuredBody);
    body.intake.source.rawText += '변조';
    f.db.storyManuscriptVersion.findFirst.mockResolvedValue({ ...f.manuscript, structuredBody: body });
    await expect(f.service.materialize(f.ids.owner, f.ids.work, f.body))
      .rejects.toMatchObject({ response: { code: 'STUDIO_LINEAR_SOURCE_CHANGED' } });
    expect(f.db.storyRelease.create).not.toHaveBeenCalled();
  });

  it('blocks a critical continuity issue even after a submitted final review', async () => {
    const f = fixture();
    f.db.storyContinuityIssue.findMany.mockResolvedValue([{ severity: 'critical' }]);
    await expect(f.service.materialize(f.ids.owner, f.ids.work, f.body))
      .rejects.toMatchObject({ response: { code: 'STUDIO_LINEAR_CONTINUITY_REVIEW_REQUIRED' } });
    expect(f.db.storyScene.createMany).not.toHaveBeenCalled();
  });

  it('does not materialize a partially completed semantic analysis', async () => {
    const f = fixture();
    f.db.storyAnalysisJob.findFirst.mockResolvedValue({ id: f.ids.analysis, status: 'completed',
      pipeline: 'semantic_extraction_v1', sourceContentHash: f.prepared.contentHash, sourceLocale: 'ko',
      totalParagraphs: f.prepared.paragraphCount, completedParagraphs: f.prepared.paragraphCount - 1 });
    await expect(f.service.materialize(f.ids.owner, f.ids.work, f.body))
      .rejects.toMatchObject({ response: { code: 'STUDIO_LINEAR_FINAL_REVIEW_REQUIRED' } });
    expect(f.db.storyScene.createMany).not.toHaveBeenCalled();
  });

  it('keeps title and scene-break text in a structured file manuscript', () => {
    const prepared = prepareManuscript(Buffer.from(JSON.stringify({ locale: 'ko', parts: [
      { partKey: 'p1', title: '첫 장', paragraphs: [
        { kind: 'title', text: '제목\n' }, { kind: 'paragraph', text: '본문\n' },
        { kind: 'scene_break', text: '***\n' }, { kind: 'dialogue', text: '대화' },
      ] },
    ] })));
    expect(linearPartPlan(prepared, [{ partKey: 'p1', label: '원작 결말로 향한다' }])[0].text)
      .toBe('제목\n본문\n***\n대화');
  });
});
