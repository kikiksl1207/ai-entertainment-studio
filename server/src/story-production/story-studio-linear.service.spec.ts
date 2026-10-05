import { createHash, randomUUID } from 'crypto';
import { prepareManuscript, preparePastedManuscript, storedManuscriptBody } from './story-manuscript-file.policy';
import { linearPartPlan, splitStudioLinearBeats, StoryStudioLinearService } from './story-studio-linear.service';
import { readerPartText } from './story-studio-reader-text.policy';
import { publicationReaderProjection } from './story-publication-reader-projection.policy';
import { publicationVisualSceneBindings } from './story-publication-visual-binding.policy';
import { releaseChecksum } from './story-lifecycle.policy';
import * as companyFinalSubmission from './story-company-final-submission.policy';

function fixture(options: { withPreface?: boolean } = {}) {
  const ids = { owner: randomUUID(), work: randomUUID(), manuscript: randomUUID(), analysis: randomUUID(),
    review: randomUUID(), release: randomUUID(), consent: randomUUID() };
  const preface = options.withPreface ? '작품 소개와 제작 메모.\n\n' : '';
  const raw = preface + '첫 파트 원고.\n\n두 번째 파트 원고.';
  const split = raw.indexOf('두 번째');
  const prepared = preparePastedManuscript(Buffer.from(raw), JSON.stringify({ locale: 'ko', confirmed: true,
    ...(options.withPreface ? { preface: { start: 0, end: preface.length } } : {}),
    parts: [{ partKey: 'part-a', title: '첫 파트', start: preface.length, end: split },
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
  let choiceJob: any = null;
  const visualPrompts: any[] = [];
  const db: any = {
    storyVisualPrompt: { findMany: jest.fn(async () => visualPrompts), createMany: jest.fn(async ({ data }) => {
      visualPrompts.push(...data); return { count: data.length }; }) },
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
      findMany: jest.fn(async ({ where }) => sceneRows.filter(row => where.partId.in.includes(row.partId))) },
    storyBeat: { createMany: jest.fn(async ({ data }) => { beatRows.push(...data); return { count: data.length }; }) },
    storyChoice: { createMany: jest.fn(async ({ data }) => { choiceRows.push(...data); return { count: data.length }; }),
      findMany: jest.fn(async ({ where }) => choiceRows.filter(row => where.sceneId.in.includes(row.sceneId))) },
    storyStudioChoiceJob: { findUnique: jest.fn(async () => choiceJob),
      create: jest.fn(async ({ data }) => { choiceJob = { ...data, status: 'queued', completedParts: 0 }; return choiceJob; }),
      upsert: jest.fn(async ({ create }) => { choiceJob ??= { ...create, status: 'queued', completedParts: 0 }; return choiceJob; }) },
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
    partRows, sceneRows, beatRows, choiceRows, choiceGate, visualPrompts };
}

describe('generic Studio linear manuscript materialization', () => {
  it('keeps source intact but removes only a matching reviewed chapter heading from reader prose', () => {
    const source = '# Part 01. 지워진 목소리\r\n\r\n테이프가 숨을 쉬었다.\r\n';
    expect(readerPartText(source, '지워진 목소리')).toBe('테이프가 숨을 쉬었다.\r\n');
    expect(readerPartText(source, '다른 제목')).toBe(source);
    expect(readerPartText('첫 문장.\n\n다음 문장.', '첫 문장')).toBe('첫 문장.\n\n다음 문장.');
    expect(readerPartText('# 제1화 첫 문\n본문', '첫 문')).toBe('본문');
  });
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
    expect(f.db.storyStudioChoiceJob.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      releaseId: result.releaseId, totalParts: 2 }) });
  });

  it('revalidates stored preface boundaries without putting the preface into reader scenes', async () => {
    const f = fixture({ withPreface: true });
    const result = await f.service.materialize(f.ids.owner, f.ids.work, f.body);
    expect(result.scenes).toHaveLength(2);
    expect(f.prepared.source.rawText).toMatch(/^작품 소개와 제작 메모\./);
    expect(f.prepared.confirmedPreface).toEqual({ start: 0,
      end: '작품 소개와 제작 메모.\n\n'.length });
    expect(f.beatRows.filter(row => row.sceneId === f.sceneRows[0].id)
      .map(row => row.content.ko).join('')).toBe('첫 파트 원고.\n\n');
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

  it('requires ordered original routes and rejects generic labels, even for a long manuscript', () => {
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

  it('keeps an unlabelled original route private for AI preparation without changing its target', async () => {
    const f = fixture();
    const body = { ...f.body, originalRoutes: f.body.originalRoutes.map(route => ({
      partKey: route.partKey, label: '',
    })) };
    const result = await f.service.materialize(f.ids.owner, f.ids.work, body);
    expect(result.scenes.map(scene => scene.originalLabel)).toEqual([null, null]);
    expect(f.choiceRows.map(choice => choice.label)).toEqual([{ ko: null }, { ko: null }]);
    expect(f.choiceRows[0].targetSceneId).toBe(f.sceneRows[1].id);
    expect(f.choiceRows[1].targetEndingKey).toBe('author_main');
    expect(f.db.storyRelease.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      validationSummary: expect.objectContaining({ ready: false }),
    }) });
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
    expect(f.db.storyVisualPrompt.createMany).toHaveBeenCalledTimes(1);
    expect(f.db.storyStudioChoiceJob.upsert).toHaveBeenCalledTimes(1);
    expect(f.db.storyScene.findMany).toHaveBeenCalledTimes(1);
    expect(f.db.storyChoice.findMany).toHaveBeenCalledTimes(1);
    await expect(f.service.materialize(f.ids.owner, f.ids.work, { ...f.body,
      originalRoutes: [{ ...f.body.originalRoutes[0], label: '다른 길을 간다' }, f.body.originalRoutes[1]] }))
      .rejects.toMatchObject({ response: { code: 'STUDIO_LINEAR_EXISTING_RELEASE_CONFLICT' } });
  });

  it('prepares one immutable prose-bound image direction per part without generating images', async () => {
    const f = fixture({ withPreface: true });
    await f.service.materialize(f.ids.owner, f.ids.work, f.body);
    expect(f.visualPrompts.map(row => row.sourceSceneKey)).toEqual(['part-a-main', 'part-b-main']);
    expect(f.visualPrompts.every(row => row.sourceKind === 'studio_reviewed' && row.promptSha256.length === 64 && row.sourceBindingSha256.length === 64)).toBe(true);
    expect(f.visualPrompts[0].promptText).toContain('첫 파트 원고.');
    expect(f.visualPrompts[0].promptText).not.toContain('제작 메모');
    f.visualPrompts[0].promptText += 'changed';
    await expect(f.service.materialize(f.ids.owner, f.ids.work, f.body)).rejects.toMatchObject({
      response: { code: 'STUDIO_LINEAR_VISUAL_SOURCE_CHANGED' } });
    expect(f.db.storyPart.createMany).toHaveBeenCalledTimes(1);
  });

  it('previews a materialized draft with one scene and choice query for all parts', async () => {
    const f = fixture();
    await f.service.materialize(f.ids.owner, f.ids.work, f.body);
    const preview = await f.service.preview(f.ids.owner, f.ids.work, f.ids.manuscript);
    expect(preview.choiceWorkerAvailable).toBe(false);
    expect(preview.scenes.map(scene => scene.originalLabel)).toEqual(f.body.originalRoutes.map(route => route.label));
    expect(f.db.storyScene.findMany).toHaveBeenCalledTimes(1);
    expect(f.db.storyChoice.findMany).toHaveBeenCalledTimes(1);
  });

  it('offers private proposed guides for ordinary manuscripts without inventing imported originals or writes', async () => {
    const f = fixture({ withPreface: true }), original = JSON.stringify(f.manuscript.structuredBody);
    const preview = await f.service.preview(f.ids.owner, f.ids.work, f.ids.manuscript);
    expect(preview.importedVisualReferences).toMatchObject({ guidanceOrigin: 'manuscript_proposal',
      approvalState: 'reference_only', requiresSceneReview: true, mappingState: 'exact_source_segments',
      totalReferences: 2, mappedReferences: 2, items: [{ sourceSceneKey: 'part-a-main' }, { sourceSceneKey: 'part-b-main' }] });
    const query = { expectedManuscriptHash: f.manuscript.contentHash, expectedSourceChecksum: preview.importedVisualReferences.checksum,
      offset: 0, textOffset: 0 };
    expect(await f.service.visualReferencePage(f.ids.owner, f.ids.work, f.ids.manuscript, query))
      .toMatchObject({ guidanceOrigin: 'manuscript_proposal', totalReferences: 2 });
    const detail = await f.service.visualReferenceDetail(f.ids.owner, f.ids.work, f.ids.manuscript, 0, query);
    expect(detail).toMatchObject({ guidanceOrigin: 'manuscript_proposal', reader: { partKey: 'part-a', text: '첫 파트 원고.\n\n' } });
    expect(detail.promptText).not.toContain('제작 메모');
    expect(JSON.stringify(f.manuscript.structuredBody)).toBe(original);
    expect(f.db.storyVisualPrompt.createMany).not.toHaveBeenCalled(); expect(f.db.storyRelease.create).not.toHaveBeenCalled();
    expect(f.db.auditEvent.create).not.toHaveBeenCalled();
    await expect(f.service.visualReferenceDetail(f.ids.owner, f.ids.work, f.ids.manuscript, 0,
      { ...query, expectedSourceChecksum: 'f'.repeat(64) })).rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REFERENCE_SOURCE_CHANGED' } });
  });

  function addImportedVisualReference(f: ReturnType<typeof fixture>, mapped: boolean) {
    const promptText = 'PRIVATE ORIGINAL REFERENCE. Review the actual scene before reuse.';
    const prompts = [{ sourceSceneKey: 'arbitrary-image-key', promptText,
      promptSha256: createHash('sha256').update(promptText).digest('hex') }];
    const parts = f.prepared.parts.map((part, index) => ({ partKey: part.partKey, title: part.title,
      beats: [{ text: part.paragraphs.map(row => row.text).join(''),
        sourceSceneKey: index ? 'different-image-key' : 'arbitrary-image-key' }] }));
    const projection = publicationReaderProjection(f.prepared.contentHash, f.prepared.parts, parts);
    const reference = { contract: 'publication-visual-source-v1', approvalState: 'reference_only',
      sourceBindingSha256: 'a'.repeat(64), prompts,
      ...(mapped ? { sceneBindings: publicationVisualSceneBindings(f.prepared.contentHash, f.prepared.parts, projection,
        parts, prompts) } : {}) };
    Object.assign(f.manuscript.structuredBody, { publicationReaderProjection: projection,
      publicationVisualSource: { ...reference, checksum: releaseChecksum(reference) } });
  }

  it.each([true, false])('previews imported visual references as private unapproved data, mapped=%s', async mapped => {
    const f = fixture(); addImportedVisualReference(f, mapped);
    const result = await f.service.preview(f.ids.owner, f.ids.work, f.ids.manuscript);
    expect(result.importedVisualReferences).toMatchObject({ approvalState: 'reference_only', requiresSceneReview: true,
      manuscriptHash: f.prepared.contentHash, totalReferences: 1, mappedReferences: mapped ? 1 : 0,
      mappingState: mapped ? 'exact_source_segments' : 'unmapped_legacy', truncated: false,
      items: [{ sourceSceneKey: 'arbitrary-image-key', promptExcerpt: expect.stringContaining('PRIVATE ORIGINAL') }] });
    const item = result.importedVisualReferences!.items[0];
    if (mapped) expect(item.binding).toMatchObject({ partKey: 'part-a', segmentIndexes: [0] });
    else expect(item).not.toHaveProperty('binding');
    expect(f.db.storyVisualPrompt.createMany).not.toHaveBeenCalled();
    expect(f.db.storyRelease.create).not.toHaveBeenCalled();
    expect(f.db.storyStudioChoiceJob.create).not.toHaveBeenCalled();
    expect(f.db.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not expose retained image references to another owner', async () => {
    const f = fixture(); addImportedVisualReference(f, true);
    f.db.storyWork.findFirst.mockResolvedValue(null);
    await expect(f.service.preview(randomUUID(), f.ids.work, f.ids.manuscript)).rejects.toBeDefined();
    expect(f.db.storyWork.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: f.ids.work, ownerUserId: expect.any(String) }) }));
    expect(f.db.storyManuscriptVersion.findFirst).not.toHaveBeenCalled();
  });

  it.each([true, false])('reads paginated original references without analysis, approval or provider writes, mapped=%s', async mapped => {
    const f = fixture(); addImportedVisualReference(f, mapped);
    const query = { expectedManuscriptHash: f.manuscript.contentHash,
      expectedSourceChecksum: (f.manuscript.structuredBody as any).publicationVisualSource.checksum, offset: 0 };
    const page = await f.service.visualReferencePage(f.ids.owner, f.ids.work, f.ids.manuscript, query);
    expect(page).toMatchObject({ workId: f.ids.work, manuscriptVersionId: f.ids.manuscript,
      approvalState: 'reference_only', items: [{ referenceIndex: 0, sourceSceneKey: 'arbitrary-image-key' }] });
    const detail = await f.service.visualReferenceDetail(f.ids.owner, f.ids.work, f.ids.manuscript, 0, { ...query, textOffset: 0 });
    expect(detail.promptText).toContain('PRIVATE ORIGINAL');
    if (mapped) expect(detail.reader).toMatchObject({ partKey: 'part-a', text: '첫 파트 원고.\n\n' });
    else expect(detail.reader).toBeNull();
    expect(f.db.storyManuscriptVersion.findFirst).toHaveBeenCalledWith({ where: {
      id: f.ids.manuscript, workId: f.ids.work, ownerUserId: f.ids.owner } });
    expect(f.db.storyAnalysisJob.findFirst).not.toHaveBeenCalled();
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.db.storyVisualPrompt.createMany).not.toHaveBeenCalled();
    expect(f.db.storyRelease.create).not.toHaveBeenCalled();
    expect(f.db.storyStudioChoiceJob.create).not.toHaveBeenCalled();
    expect(f.db.auditEvent.create).not.toHaveBeenCalled();
  });

  it('protects original-reference page/detail reads from wrong owner, missing manuscript and changed upload', async () => {
    const f = fixture(); addImportedVisualReference(f, true);
    const query = { expectedManuscriptHash: f.manuscript.contentHash,
      expectedSourceChecksum: (f.manuscript.structuredBody as any).publicationVisualSource.checksum, offset: 0, textOffset: 0 };
    f.db.storyWork.findFirst.mockResolvedValueOnce(null);
    await expect(f.service.visualReferencePage(randomUUID(), f.ids.work, f.ids.manuscript, query)).rejects.toBeDefined();
    expect(f.db.storyManuscriptVersion.findFirst).not.toHaveBeenCalled();
    f.db.storyManuscriptVersion.findFirst.mockResolvedValueOnce(null);
    await expect(f.service.visualReferenceDetail(f.ids.owner, f.ids.work, f.ids.manuscript, 0, query)).rejects.toBeDefined();
    const corrupt = structuredClone(f.manuscript.structuredBody) as any;
    corrupt.intake.source.rawText += '변경';
    f.db.storyManuscriptVersion.findFirst.mockResolvedValueOnce({ ...f.manuscript, structuredBody: corrupt });
    await expect(f.service.visualReferencePage(f.ids.owner, f.ids.work, f.ids.manuscript, query))
      .rejects.toMatchObject({ response: { code: 'STUDIO_LINEAR_SOURCE_CHANGED' } });
    await expect(f.service.visualReferenceDetail(f.ids.owner, 'invalid', f.ids.manuscript, 0, query)).rejects.toBeDefined();
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it('reports private choice-worker availability without exposing its key', async () => {
    const f = fixture();
    const previous = { nodeEnv: process.env.NODE_ENV,
      enabled: process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED,
      key: process.env.OPENAI_API_KEY,
      continuationKey: process.env.STORY_CONTINUATION_OPENAI_API_KEY };
    try {
      process.env.NODE_ENV = 'production';
      process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED = 'true';
      process.env.OPENAI_API_KEY = 'local-test-only';
      delete process.env.STORY_CONTINUATION_OPENAI_API_KEY;
      const available = await f.service.preview(f.ids.owner, f.ids.work, f.ids.manuscript);
      expect(available.choiceWorkerAvailable).toBe(true);
      expect(JSON.stringify(available)).not.toContain('local-test-only');
      process.env.STORY_STUDIO_CHOICE_WORKER_ENABLED = 'false';
      expect((await f.service.preview(f.ids.owner, f.ids.work, f.ids.manuscript)).choiceWorkerAvailable).toBe(false);
    } finally {
      process.env.NODE_ENV = previous.nodeEnv;
      for (const [key, value] of [
        ['STORY_STUDIO_CHOICE_WORKER_ENABLED', previous.enabled],
        ['OPENAI_API_KEY', previous.key],
        ['STORY_CONTINUATION_OPENAI_API_KEY', previous.continuationKey],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('does not silently preview a duplicate draft scene or a missing original scene', async () => {
    const f = fixture();
    await f.service.materialize(f.ids.owner, f.ids.work, f.body);
    f.sceneRows.push({ ...f.sceneRows[0], id: randomUUID() });
    await expect(f.service.preview(f.ids.owner, f.ids.work, f.ids.manuscript))
      .rejects.toMatchObject({ response: { code: 'STUDIO_LINEAR_EXISTING_GRAPH_CHANGED' } });
    f.sceneRows.pop();
    f.sceneRows.pop();
    await expect(f.service.preview(f.ids.owner, f.ids.work, f.ids.manuscript))
      .rejects.toMatchObject({ response: { code: 'STUDIO_LINEAR_EXISTING_GRAPH_CHANGED' } });
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

  describe('read-only company submission preview', () => {
    afterEach(() => jest.restoreAllMocks());

    it('returns only a current verified receipt without approval or materialization writes', async () => {
      const f = fixture(), submissionId = randomUUID();
      const review = { id: f.ids.review, workId: f.ids.work, ownerUserId: f.ids.owner,
        manuscriptVersionId: f.ids.manuscript, analysisJobId: f.ids.analysis, state: 'submitted', revision: 2 };
      const submission = { id: submissionId, reviewId: review.id,
        idempotencyKey: `story-company-final-v1:${'a'.repeat(64)}` };
      f.db.storyWriterReview.findFirst.mockResolvedValue(review);
      f.db.storyFinalSubmission.findUnique.mockResolvedValue(submission);
      const verify = jest.spyOn(companyFinalSubmission, 'assertCompanyFinalSubmissionCurrent')
        .mockResolvedValue({ approvalBasis: 'company_delegation', bindingHash: 'b'.repeat(64) });
      const result = await f.service.preview(f.ids.owner, f.ids.work, f.ids.manuscript);
      expect(verify).toHaveBeenCalledWith(f.db, { ownerUserId: f.ids.owner, workId: f.ids.work,
        review, manuscript: f.manuscript, submission });
      expect(result.review).toEqual({ reviewId: review.id, state: 'submitted', revision: 2,
        approvalBasis: 'company_delegation', companySubmission: { contract: 'story-company-final-submission-v1',
          scope: 'manuscript_submission', submissionId, manuscriptVersionId: f.ids.manuscript,
          manuscriptHash: f.manuscript.contentHash, analysisJobId: f.ids.analysis,
          reviewRevision: 2, bindingHash: 'b'.repeat(64), humanSemanticReview: false,
          published: false, generationStarted: false } });
      expect(f.db.$transaction).not.toHaveBeenCalled(); expect(f.db.auditEvent.create).not.toHaveBeenCalled();
      expect(f.db.storyRelease.create).not.toHaveBeenCalled(); expect(f.db.storyVisualPrompt.createMany).not.toHaveBeenCalled();
      expect(f.db.storyStudioChoiceJob.create).not.toHaveBeenCalled();
    });

    it('rejects unverifiable company authority instead of returning a submitted success', async () => {
      const f = fixture();
      f.db.storyFinalSubmission.findUnique.mockResolvedValue({ idempotencyKey: `story-company-final-v1:${'a'.repeat(64)}` });
      jest.spyOn(companyFinalSubmission, 'assertCompanyFinalSubmissionCurrent').mockRejectedValue(
        new Error('Synthetic authority unavailable'));
      await expect(f.service.preview(f.ids.owner, f.ids.work, f.ids.manuscript)).rejects.toThrow('Synthetic authority unavailable');
      expect(f.db.$transaction).not.toHaveBeenCalled(); expect(f.db.auditEvent.create).not.toHaveBeenCalled();
      expect(f.db.storyRelease.create).not.toHaveBeenCalled();
    });

    it('keeps a newly committed company review aligned after the earlier analysis read', async () => {
      const f = fixture(), latestAnalysisId = randomUUID();
      f.db.storyWriterReview.findFirst.mockResolvedValue({ id: f.ids.review, state: 'submitted', revision: 2,
        analysisJobId: latestAnalysisId });
      f.db.storyFinalSubmission.findUnique.mockResolvedValue({ id: randomUUID(),
        idempotencyKey: `story-company-final-v1:${'a'.repeat(64)}` });
      jest.spyOn(companyFinalSubmission, 'assertCompanyFinalSubmissionCurrent')
        .mockResolvedValue({ approvalBasis: 'company_delegation', bindingHash: 'b'.repeat(64) });
      const result = await f.service.preview(f.ids.owner, f.ids.work, f.ids.manuscript);
      expect(result.analysisJobId).toBe(latestAnalysisId);
      expect(result.review?.companySubmission?.analysisJobId).toBe(latestAnalysisId);
      expect(f.db.storyContinuityIssue.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ analysisJobId: latestAnalysisId }) }));
      expect(f.db.$transaction).not.toHaveBeenCalled();
      expect(f.db.auditEvent.create).not.toHaveBeenCalled();
      expect(f.db.storyRelease.create).not.toHaveBeenCalled();
      expect(f.db.storyStudioChoiceJob.create).not.toHaveBeenCalled();
    });

    it('keeps legacy manual review projection and does not invent company authority', async () => {
      const f = fixture();
      const verify = jest.spyOn(companyFinalSubmission, 'assertCompanyFinalSubmissionCurrent');
      expect((await f.service.preview(f.ids.owner, f.ids.work, f.ids.manuscript)).review)
        .toEqual({ reviewId: f.ids.review, state: 'submitted', revision: 6 });
      expect(verify).not.toHaveBeenCalled(); expect(f.db.$transaction).not.toHaveBeenCalled();
      expect(f.db.auditEvent.create).not.toHaveBeenCalled();
    });
  });
});
