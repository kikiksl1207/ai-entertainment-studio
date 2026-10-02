import { randomUUID, createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { brotliCompressSync } from 'zlib';
import { Prisma } from '@prisma/client';
import { StoryPublicationIntakeService } from './story-publication-intake.service';
import { MANUSCRIPT_FILE_LIMITS, preparePastedManuscript, storedManuscriptBody } from './story-manuscript-file.policy';
import { assertPrivatePublicationSource } from './story-publication-private-intake.policy';
import { FIXED_ROUTE_STORIES } from './story-fixed-route-markdown.policy';
import { sourceOf } from './story-studio-linear.service';
import { readerPartText } from './story-studio-reader-text.policy';
import { publicationVisualReference } from './story-approved-visual.policy';
import { studioVisualReferenceDetail, studioVisualReferencePage } from './story-studio-visual-reference.policy';

const sourceDir = process.env.STORY_PRIVATE_APPROVED_SOURCE_DIR;
const manuscriptPath = sourceDir ? join(sourceDir, '01_독자공개_전체원고.md') : '';
const promptPath = sourceDir ? join(sourceDir, '03_장면이미지_프롬프트.md') : '';
const actualSourceTest = manuscriptPath && promptPath && existsSync(manuscriptPath) && existsSync(promptPath) ? it : it.skip;

function fixture() {
  const actorUserId = randomUUID();
  const texts = ['# The ledger\r\nAn archivist opened a ledger.\r\n\r\n', '# The door\r\nShe opened a door.'];
  const raw = texts.join('');
  const prepared = preparePastedManuscript(Buffer.from(raw), JSON.stringify({ locale: 'ko', confirmed: true,
    parts: texts.map((text, index) => ({ partKey: `part-${index + 1}`, title: ['The ledger', 'The door'][index],
      start: index ? texts[0].length : 0, end: index ? raw.length : text.length })) }));
  const plan = { storyKey: 'monster', slug: `private-intake-${randomUUID()}`, title: 'The archive',
    summary: 'The private archive', coverPath: '/assets/story/monster.webp', sourceBindingSha256: 'a'.repeat(64),
    manuscript: { locale: prepared.locale, contentHash: prepared.contentHash,
      structuredBody: storedManuscriptBody(prepared) as unknown as Prisma.JsonValue },
    writerIntakeWorkflow: 'writer_review_before_choices_v1',
    parts: prepared.parts.map((part, index) => ({ partKey: part.partKey, title: part.title, actNumber: 1,
      position: index + 1, beats: [{ text: texts[index], sourceSceneKey: `${part.partKey}-main` }],
      choices: [{ choiceKey: 'next', position: 1, label: 'Original route', routeKind: 'writer_original',
        targetPartKey: index ? null : 'part-2', targetEndingKey: index ? 'author_main' : null }] })), prompts: [] };
  const service = new StoryPublicationIntakeService({} as never, {} as never);
  const row = { id: randomUUID(), actorUserId, storyKey: plan.storyKey, sourceBindingSha256: plan.sourceBindingSha256,
    status: 'queued', workId: null as string | null, releaseId: null, batchCursor: 0,
    errorCode: null as string | null, updatedAt: new Date(), planSnapshot: (service as any).storedPlan(plan) };
  let work: any = null;
  let manuscript: any = null;
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: row.id }]),
    storyPublicationImportJob: { findUnique: jest.fn(async () => ({ ...row })),
      update: jest.fn(async ({ data }: any) => Object.assign(row, data)),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    storyWork: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: any) => (work = data)), findFirst: jest.fn(async () => work),
      update: jest.fn() },
    storyManuscriptVersion: { create: jest.fn(async ({ data }: any) => (manuscript = data)),
      findFirst: jest.fn(async () => manuscript) },
    storyBranchPreparationJob: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    storyRelease: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    storyPart: { createMany: jest.fn() }, storyScene: { createMany: jest.fn() },
    storyBeat: { createMany: jest.fn() }, storyChoice: { createMany: jest.fn() },
    storyStyleProfileConsent: { create: jest.fn() }, storyWorkGenerationProfile: { create: jest.fn() },
    storyAnalysisJob: { create: jest.fn() },
    storyUploadSubmission: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    storyPublicationSourceChunk: { findMany: jest.fn() },
  };
  const prisma = { ...tx, $transaction: jest.fn(async (callback: (value: unknown) => unknown) => callback(tx)) };
  (service as any).prisma = prisma;
  const provider = jest.spyOn(service as any, 'choiceProvider');
  return { actorUserId, service, prepared, plan, row, prisma, tx, provider, work: () => work, manuscript: () => manuscript };
}

describe('Approved source bundle private writer handoff (no AI/network)', () => {
  beforeEach(() => jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network allowed')));
  afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

  actualSourceTest('keeps the pinned 32-part source lossless and preserves all verified reader prose in private intake', async () => {
    const f = fixture();
    const raw = readFileSync(manuscriptPath);
    const directions = readFileSync(promptPath);
    const plan = { ...(f.service as any).fixedRoutePlan('monster', new Map([
      [createHash('sha256').update(raw).digest('hex'), raw],
      [createHash('sha256').update(directions).digest('hex'), directions],
    ])), writerIntakeWorkflow: 'writer_review_before_choices_v1' };
    f.row.sourceBindingSha256 = plan.sourceBindingSha256;
    f.row.planSnapshot = (f.service as any).storedPlan(plan);
    await expect(f.service.processApprovedJob(f.actorUserId, f.row.id)).resolves.toMatchObject({
      status: 'awaiting_author_review', totalParts: 32, releaseId: null });
    expect(f.manuscript().structuredBody.intake.source.rawText).toBe(raw.toString('utf8'));
    expect(f.manuscript().structuredBody.publicationVisualSource).toMatchObject({
      contract: 'publication-visual-source-v1', sourceBindingSha256: plan.sourceBindingSha256,
      approvalState: 'reference_only', prompts: plan.prompts, visualBible: plan.visualBible });
      expect(publicationVisualReference(f.manuscript().structuredBody)).toMatchObject({
        bible: plan.visualBible, promptCount: plan.prompts.length,
      });
    const verified = sourceOf(f.manuscript());
    expect(verified.parts).toHaveLength(32);
    const bindings = f.manuscript().structuredBody.publicationVisualSource.sceneBindings;
    expect(plan.prompts).toHaveLength(146);
    expect(bindings).toHaveLength(146);
    expect(new Set(bindings.map((binding: { partKey: string }) => binding.partKey)).size).toBe(32);
    expect(new Set(bindings.map((binding: { sourceSceneKey: string }) => binding.sourceSceneKey)).size)
      .toBe(plan.prompts.length);
    expect(bindings.every((binding: { partKey: string; segmentIndexes: number[] }) =>
      verified.parts.some(part => part.partKey === binding.partKey) && binding.segmentIndexes.length > 0)).toBe(true);
    const manuscript = f.manuscript();
    const visual = manuscript.structuredBody.publicationVisualSource;
    const identity = { workId: manuscript.workId, manuscriptVersionId: manuscript.id, manuscriptHash: manuscript.contentHash };
    const referenceIndexes: number[] = [];
    for (let offset: number | null = 0; offset !== null;) {
      const page = studioVisualReferencePage(manuscript.structuredBody, identity, manuscript.contentHash, visual.checksum, offset);
      expect(page.items.length).toBeLessThanOrEqual(8);
      expect(page.approvalState).toBe('reference_only');
      referenceIndexes.push(...page.items.map(item => item.referenceIndex)); offset = page.nextOffset;
    }
    expect(referenceIndexes).toEqual(Array.from({ length: 146 }, (_, index) => index));
    for (const index of [0, 73, 145]) {
      const result = studioVisualReferenceDetail(manuscript.structuredBody, identity, manuscript.contentHash, visual.checksum, index);
      expect(result.promptText).toBe(plan.prompts[index].promptText);
      const binding = bindings[index];
      const matched = manuscript.structuredBody.publicationReaderProjection.parts.find((part: { partKey: string }) => part.partKey === binding.partKey);
      expect(result.reader!.text).toBe(binding.segmentIndexes.map((segment: number) => matched.segments[segment]).join('\n\n').slice(0, result.reader!.text.length));
      expect(result.reader!.partKey).toBe(binding.partKey);
    }
    plan.parts.forEach((part: { partKey: string; title: string; beats: Array<{ text: string }> }) => {
      expect(verified.readerPartTexts!.get(part.partKey))
        .toBe(readerPartText(part.beats.map(beat => beat.text).join('\n\n'), part.title));
    });
    expect(f.provider).not.toHaveBeenCalled();
    expect(f.tx.storyRelease.create).not.toHaveBeenCalled();
  });

  it('creates a lossless private manuscript before any provider, release or public graph', async () => {
    const f = fixture();
    const result = await f.service.processApprovedJob(f.actorUserId, f.row.id);
    expect(result).toMatchObject({ status: 'awaiting_author_review', totalParts: 2,
      processedParts: 0, releaseId: null, writerReview: { manuscriptHash: f.prepared.contentHash,
        analysisStarted: false, nextAction: 'analyze_and_approve', studioUrl: '/creator-studio' } });
    expect(f.work()).toMatchObject({ ownerUserId: f.actorUserId, status: 'draft',
      activeReleaseId: null, publishedAt: null, authorDisplayName: '루미나' });
    expect(f.manuscript().structuredBody).toMatchObject(f.plan.manuscript.structuredBody as object);
    expect(f.tx.storyBranchPreparationJob.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({ status: 'awaiting_author_consent' })]) }));
    for (const delegate of [f.tx.storyRelease, f.tx.storyAnalysisJob, f.tx.storyStyleProfileConsent,
      f.tx.storyWorkGenerationProfile]) expect(delegate.create).not.toHaveBeenCalled();
    for (const delegate of [f.tx.storyPart, f.tx.storyScene, f.tx.storyBeat, f.tx.storyChoice])
      expect(delegate.createMany).not.toHaveBeenCalled();
    expect(f.provider).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create.mock.calls[0][0].data.metadata).toMatchObject({
      published: false, analysisStarted: false, choicesGenerated: false });
  });

  it('rejects a changed visual-source prompt before work creation rather than losing source references', async () => {
    const f = fixture();
    Object.assign(f.plan, { prompts: [{ sourceSceneKey: 'part-1-main', promptText: 'Changed visual direction',
      promptSha256: 'f'.repeat(64) }] });
    f.row.planSnapshot = (f.service as any).storedPlan(f.plan);
    await expect(f.service.processApprovedJob(f.actorUserId, f.row.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_PUBLICATION_PRIVATE_VISUAL_SOURCE_INVALID' }) });
    expect(f.tx.storyWork.create).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
  });

  it('preserves every contiguous split segment of an original image direction before any AI or public graph', async () => {
    const f = fixture();
    const original = f.plan.parts[0].beats[0].text;
    f.plan.parts[0].beats = [{ text: original.slice(0, 12), sourceSceneKey: 'one-source-scene' },
      { text: original.slice(12), sourceSceneKey: 'one-source-scene' }];
    const promptText = 'Original illustration reference requiring author scene review.';
    Object.assign(f.plan, { prompts: [{ sourceSceneKey: 'one-source-scene', promptText,
      promptSha256: createHash('sha256').update(promptText).digest('hex') }] });
    f.row.planSnapshot = (f.service as any).storedPlan(f.plan);
    await f.service.processApprovedJob(f.actorUserId, f.row.id);
    expect(f.manuscript().structuredBody.publicationVisualSource).toMatchObject({ approvalState: 'reference_only',
      sceneBindings: [{ sourceSceneKey: 'one-source-scene', partKey: 'part-1',
        segmentIndexes: [0, 1], segmentSha256s: f.plan.parts[0].beats.map(beat =>
          createHash('sha256').update(beat.text).digest('hex')) }] });
    expect(publicationVisualReference(f.manuscript().structuredBody)).toMatchObject({ promptCount: 1 });
    expect(f.provider).not.toHaveBeenCalled(); expect(f.tx).not.toHaveProperty('storyVisualPrompt');
  });

  it('rejects an ambiguous image key spanning two parts before any private work write', async () => {
    const f = fixture();
    f.plan.parts.forEach(part => { part.beats[0].sourceSceneKey = 'same-image-key'; });
    const promptText = 'An ambiguous source instruction.';
    Object.assign(f.plan, { prompts: [{ sourceSceneKey: 'same-image-key', promptText,
      promptSha256: createHash('sha256').update(promptText).digest('hex') }] });
    f.row.planSnapshot = (f.service as any).storedPlan(f.plan);
    await expect(f.service.processApprovedJob(f.actorUserId, f.row.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_PUBLICATION_VISUAL_BINDING_INVALID' }) });
    expect(f.tx.storyWork.create).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
  });

  it('replays the same private handoff without new source versions, analysis or approval', async () => {
    const f = fixture();
    const first = await f.service.processApprovedJob(f.actorUserId, f.row.id);
    await expect(f.service.processApprovedJob(f.actorUserId, f.row.id)).resolves.toEqual(first);
    expect(f.tx.storyWork.create).toHaveBeenCalledTimes(1);
    expect(f.tx.storyManuscriptVersion.create).toHaveBeenCalledTimes(1);
    expect(f.provider).not.toHaveBeenCalled();
  });

  it('does not treat a private submission as already published when promotion is retried', async () => {
    const f = fixture();
    await f.service.processApprovedJob(f.actorUserId, f.row.id);
    Object.assign(f.prisma.storyUploadSubmission, { findUnique: jest.fn().mockResolvedValue({
      userId: f.actorUserId, promotedWorkId: f.row.workId }) });
    Object.assign(f.prisma.storyPublicationImportJob, { findFirst: jest.fn().mockResolvedValue({ id: f.row.id }) });
    f.tx.storyWork.findUnique.mockResolvedValue(f.work());
    await expect(f.service.promote(f.actorUserId, randomUUID(), { storyKey: 'monster',
      rightsConfirmed: true, finalManuscriptConfirmed: true, publicReleaseConfirmed: true })).resolves.toMatchObject({
      status: 'awaiting_author_review', workId: f.row.workId });
    expect(f.provider).not.toHaveBeenCalled();
  });

  function laterReceipt(f: ReturnType<typeof fixture>) {
    const receipt = { id: randomUUID(), userId: f.actorUserId, status: 'received', promotedWorkId: null,
      files: [FIXED_ROUTE_STORIES.monster.manuscriptSha256, FIXED_ROUTE_STORIES.monster.promptSha256]
        .map(checksumSha256 => ({ category: 'manuscript', checksumSha256 })) };
    Object.assign(f.tx.storyUploadSubmission, { findUnique: jest.fn().mockResolvedValue(receipt) });
    return receipt;
  }

  it('attaches a later same-owner source receipt to the existing private work without duplicates', async () => {
    const f = fixture();
    const first = await f.service.processApprovedJob(f.actorUserId, f.row.id);
    const receipt = laterReceipt(f);
    await expect((f.service as any).stagePrivateIntake(f.actorUserId, f.row.id, receipt.id)).resolves.toEqual(first);
    expect(f.tx.storyUploadSubmission.updateMany).toHaveBeenCalledWith({ where: { id: receipt.id,
      userId: f.actorUserId, status: 'received', promotedWorkId: null },
      data: { status: 'author_review', promotedWorkId: first.workId } });
    expect((f.service as any).readStoredPlan(f.row.planSnapshot).submissionId).toBe(receipt.id);
    await expect((f.service as any).stagePrivateIntake(f.actorUserId, f.row.id, receipt.id)).resolves.toEqual(first);
    expect(f.tx.storyUploadSubmission.updateMany).toHaveBeenCalledTimes(1);
    expect(f.tx.storyWork.create).toHaveBeenCalledTimes(1);
    expect(f.provider).not.toHaveBeenCalled();
  });

  it.each(['owner', 'source', 'promoted', 'status', 'compare-and-set', 'different-receipt'])
    ('rejects a later receipt with %s mismatch without creating a new work or calling AI', async kind => {
      const f = fixture(); await f.service.processApprovedJob(f.actorUserId, f.row.id);
      const receipt = laterReceipt(f);
      if (kind === 'owner') receipt.userId = randomUUID();
      if (kind === 'source') receipt.files[0].checksumSha256 = 'f'.repeat(64);
      if (kind === 'promoted') Object.assign(receipt, { promotedWorkId: randomUUID() });
      if (kind === 'status') receipt.status = 'withdrawn';
      if (kind === 'compare-and-set') f.tx.storyUploadSubmission.updateMany.mockResolvedValue({ count: 0 });
      if (kind === 'different-receipt') f.row.planSnapshot = (f.service as any).storedPlan({ ...f.plan,
        submissionId: randomUUID() });
      await expect((f.service as any).stagePrivateIntake(f.actorUserId, f.row.id, receipt.id)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'STORY_PUBLICATION_SUBMISSION_CHANGED' }) });
      expect(f.tx.storyWork.create).toHaveBeenCalledTimes(1); expect(f.provider).not.toHaveBeenCalled();
      expect(f.tx.auditEvent.create.mock.calls).toHaveLength(1);
    });

  it.each(['owner', 'hash', 'private-collision', 'submission', 'source-binding', 'part-key', 'part-title'])
    ('blocks %s mismatch before invoking AI', async kind => {
      const f = fixture();
      if (kind === 'owner') f.row.actorUserId = randomUUID();
      if (kind === 'hash') f.plan.manuscript.contentHash = 'b'.repeat(64);
      if (kind === 'private-collision') f.tx.storyWork.findUnique.mockResolvedValue({ id: randomUUID(), status: 'draft' });
      if (kind === 'submission') {
        Object.assign(f.plan, { submissionId: randomUUID() });
        f.tx.storyUploadSubmission.updateMany.mockResolvedValue({ count: 0 });
      }
      if (kind === 'source-binding') f.row.sourceBindingSha256 = 'c'.repeat(64);
      if (kind === 'part-key') f.plan.parts[0].partKey = 'other-part';
      if (kind === 'part-title') f.plan.parts[0].title = 'Changed';
      f.row.planSnapshot = (f.service as any).storedPlan(f.plan);
      await expect(f.service.processApprovedJob(f.actorUserId, f.row.id)).rejects.toBeDefined();
      expect(f.provider).not.toHaveBeenCalled();
    });

  it.each(['choice_preparing:pending', 'choice_review_required:pending'])
    ('does not bypass an uncertain paid batch: %s', async code => {
      const f = fixture(); f.row.errorCode = code;
      await expect(f.service.processApprovedJob(f.actorUserId, f.row.id)).rejects.toBeDefined();
      expect(f.tx.storyWork.create).not.toHaveBeenCalled();
      expect(f.provider).not.toHaveBeenCalled();
    });

  it.each([{ label: 'partial', keys: ['part-1'] }, { label: 'all', keys: ['part-1', 'part-2'] }])
    ('cannot bypass author review by attaching $label completed choices to a new import marker', async ({ keys }) => {
    const f = fixture();
    f.row.planSnapshot = (f.service as any).storedPlan({ ...f.plan, choicePreparation: {
      version: 'authored-context-two-alternatives-v1', preparedPartKeys: keys,
    } });
    await expect(f.service.processApprovedJob(f.actorUserId, f.row.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_PUBLICATION_PRIVATE_INTAKE_CHANGED' }) });
    expect(f.tx.storyWork.create).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
  });

  it.each(['changed-source', 'changed-owner', 'published'])('does not rerun the legacy import after handoff: %s', async kind => {
    const f = fixture(); await f.service.processApprovedJob(f.actorUserId, f.row.id);
    if (kind === 'changed-source') f.manuscript().contentHash = 'd'.repeat(64);
    if (kind === 'changed-owner') f.tx.storyWork.findFirst.mockResolvedValue(null);
    if (kind === 'published') f.work().status = 'published';
    await expect(f.service.processApprovedJob(f.actorUserId, f.row.id)).rejects.toBeDefined();
    expect(f.tx.storyWork.create).toHaveBeenCalledTimes(1);
    expect(f.provider).not.toHaveBeenCalled();
  });

  it('preserves the adult classification even while the work is only a private draft', async () => {
    const f = fixture(); Object.assign(f.plan, { contentRating: 'adults_only', catalogVisibility: 'public_test' });
    f.row.planSnapshot = (f.service as any).storedPlan(f.plan);
    await f.service.processApprovedJob(f.actorUserId, f.row.id);
    expect(f.work().coverManifest).toMatchObject({ contentRating: 'adults_only', catalogVisibility: 'public_test' });
    expect(f.work().status).toBe('draft');
  });

  function archive(f: ReturnType<typeof fixture>, mutation?: string) {
    f.plan.storyKey = 'inheritor'; f.row.storyKey = 'inheritor';
    const sources = [Buffer.from('approved manuscript'), Buffer.from('approved image instructions')];
    const pieces = sources.flatMap(source => {
      const length = Buffer.alloc(4); length.writeUInt32BE(source.length); return [length, source];
    });
    const bundle = Buffer.concat([Buffer.from(mutation === 'magic' ? 'BROKEN_INHERITOR_V1\0' : 'LUMINA_INHERITOR_BUNDLE_V1\0'),
      ...pieces, ...(mutation === 'trailing' ? [Buffer.from('trailing')] : [])]);
    const payload = brotliCompressSync(bundle);
    const chunks = [{ position: 0, totalChunks: 1, payload,
      checksumSha256: createHash('sha256').update(payload).digest('hex') }];
    if (mutation === 'checksum') chunks[0].checksumSha256 = 'f'.repeat(64);
    if (mutation === 'position') chunks[0].position = 1;
    if (mutation === 'total') chunks[0].totalChunks = 2;
    if (mutation === 'empty') chunks.length = 0;
    f.tx.storyPublicationSourceChunk.findMany.mockResolvedValue(chunks);
    jest.spyOn(f.service as any, 'inheritorPlan').mockReturnValue({ ...f.plan, manuscript: f.prepared });
    f.row.planSnapshot = (f.service as any).storedPlan({ ...f.plan, manuscript: f.prepared });
  }

  it('restores an archived source to a normal lossless writer manuscript without using reader prose', async () => {
    const f = fixture(); archive(f);
    await expect(f.service.processApprovedJob(f.actorUserId, f.row.id)).resolves.toMatchObject({ status: 'awaiting_author_review' });
    expect(f.manuscript().structuredBody.intake.source.rawText).toBe(f.prepared.source.rawText);
    expect(f.tx.storyPublicationSourceChunk.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 65 }));
    expect(f.provider).not.toHaveBeenCalled();
  });

  it.each(['checksum', 'position', 'total', 'empty', 'magic', 'trailing'])
    ('rejects a damaged archive (%s) before a private work is created', async mutation => {
      const f = fixture(); archive(f, mutation);
      await expect(f.service.processApprovedJob(f.actorUserId, f.row.id)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'STORY_PUBLICATION_PRIVATE_ARCHIVE_INVALID' }) });
      expect(f.tx.storyWork.create).not.toHaveBeenCalled();
      expect(f.provider).not.toHaveBeenCalled();
    });

  it('does not accept a structured projection that has no original upload source', () => {
    const f = fixture();
    f.plan.manuscript.structuredBody = { parts: f.prepared.parts };
    expect(() => assertPrivatePublicationSource(f.plan)).toThrow();
  });

  it('applies the existing stored-manuscript byte limit before inserting work or source rows', async () => {
    const f = fixture();
    jest.replaceProperty(MANUSCRIPT_FILE_LIMITS, 'storedBytes', 30 as never);
    await expect(f.service.processApprovedJob(f.actorUserId, f.row.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_PUBLICATION_PRIVATE_MANUSCRIPT_TOO_LARGE' }) });
    expect(f.tx.storyWork.create).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
  });
});
