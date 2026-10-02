import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile, stableJson } from '../generation-profile/creator-generation-profile.policy';
import { continuationGenerationProfileSnapshot, STORY_CONTINUATION_PROFILE_VIEW_VERSION } from './story-continuation-context.policy';
import { releaseChecksum } from './story-lifecycle.policy';
import { preparePastedManuscript, storedManuscriptBody } from './story-manuscript-file.policy';
import { publicationReaderProjection } from './story-publication-reader-projection.policy';
import { publicationVisualSceneBindings } from './story-publication-visual-binding.policy';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';
import { StoryStudioVisualReviewService } from './story-studio-visual-review.service';
import { linearPartPlan, sourceOf } from './story-studio-linear.service';
import { studioSceneVisualPrompt } from './story-approved-visual.policy';
import { studioManuscriptVisualReviewSource } from './story-studio-visual-source.policy';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function fixture(count = 3, headingOnly = false, sharedPart = false) {
  const ids = { owner: randomUUID(), work: randomUUID(), manuscript: randomUUID(), analysis: randomUUID(), profile: randomUUID(), release: randomUUID() };
  let raw = '';
  const bounds = Array.from({ length: count }, (_, index) => {
    const start = raw.length; raw += headingOnly ? `# Part ${index + 1}. 장면 ${index}\n\n실제 본문 사건.\n\n` : `실제 본문 ${index}. 작중 인물이 약속을 지켰다.\n\n`;
    return { partKey: `part-${index}`, title: `장면 ${index}`, start, end: raw.length };
  });
  const prepared = preparePastedManuscript(Buffer.from(raw), JSON.stringify({ locale: 'ko', confirmed: true,
    parts: sharedPart ? [{ ...bounds[0], end: raw.length }] : bounds }));
  const planned = prepared.parts.map((part, index) => ({ partKey: part.partKey, title: part.title,
    beats: headingOnly ? [{ text: part.paragraphs[0].text, sourceSceneKey: `source-${index}` },
      { text: part.paragraphs.slice(1).map(row => row.text).join('\n\n'), sourceSceneKey: `unreferenced-${index}` }]
      : sharedPart ? part.paragraphs.map((row, index) => ({ text: row.text, sourceSceneKey: `source-${index}` }))
        : [{ text: part.paragraphs.map(row => row.text).join(''), sourceSceneKey: `source-${index}` }] }));
  const projection = publicationReaderProjection(prepared.contentHash, prepared.parts, planned);
  const prompts = Array.from({ length: count }, (_, index) => ({ sourceSceneKey: `source-${index}`, promptText: `ORIGINAL-${index}`, promptSha256: sha256(`ORIGINAL-${index}`) }));
  const reference: any = { contract: 'publication-visual-source-v1', approvalState: 'reference_only',
    sourceBindingSha256: 'f'.repeat(64), prompts,
    sceneBindings: publicationVisualSceneBindings(prepared.contentHash, prepared.parts, projection, planned, prompts) };
  const sourceChecksum = releaseChecksum(reference);
  const manuscript: any = { id: ids.manuscript, workId: ids.work, ownerUserId: ids.owner, version: 1, locale: 'ko',
    contentHash: prepared.contentHash, structuredBody: { ...storedManuscriptBody(prepared), publicationReaderProjection: projection,
      publicationVisualSource: { ...reference, checksum: sourceChecksum } } };
  const totalParagraphs = prepared.parts.reduce((total, part) => total + part.paragraphs.length, 0);
  const analysis: any = { id: ids.analysis, workId: ids.work, manuscriptVersionId: ids.manuscript,
    sourceLocale: 'ko', totalParagraphs, plannedParagraphs: totalParagraphs, completedParagraphs: totalParagraphs,
    status: 'completed', pipeline: SEMANTIC_PIPELINE, analysisVersion: 1, configHash: 'a'.repeat(64), sourceContentHash: prepared.contentHash };
  const sourceFingerprint = sha256(stableJson({ workId: ids.work, manuscriptVersionId: ids.manuscript, contentHash: prepared.contentHash,
    analysisJobId: ids.analysis, analysisVersion: analysis.analysisVersion, analysisConfigHash: analysis.configHash }));
  const settings = normalizeCreatorGenerationProfile('story', { schemaVersion: 'creator-generation-profile-v1', kind: 'story',
    sections: ['writing_style', 'scene_scale', 'canon', 'timeline', 'visual_direction', 'visual_cast', 'narrative_devices', 'branch_behavior']
      .map(key => ({ key, decision: 'accepted', value: { summary: `작가 기준 ${key}` }, evidence: [] })) });
  const profile: any = { id: ids.profile, workId: ids.work, ownerUserId: ids.owner, manuscriptVersionId: ids.manuscript,
    analysisJobId: ids.analysis, sourceFingerprint, profileVersion: 1, reviewRevision: 1, status: 'approved',
    approvedSettings: settings, approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings),
    approvedByUserId: ids.owner, approvedAt: new Date('2026-09-30T12:00:00Z') };
  const snapshot = continuationGenerationProfileSnapshot(profile);
  const pin = { ...snapshot.pin, manuscriptVersionId: ids.manuscript, analysisJobId: ids.analysis, analysisVersion: 1,
    approvedByUserId: ids.owner, approvedAt: profile.approvedAt.toISOString() };
  const profilePinHash = releaseChecksum({ pin, viewVersion: STORY_CONTINUATION_PROFILE_VIEW_VERSION });
  const batches: any[] = [], audit: any[] = [], selections: any[] = [];
  const publishedWork = { id: ids.work, ownerUserId: ids.owner, status: 'published', fixtureSource: false, activeReleaseId: ids.release };
  const release = { id: ids.release, workId: ids.work, status: 'active', checksum: 'e'.repeat(64), manuscriptVersionId: ids.manuscript,
    branchGraphSnapshot: {} as Record<string, unknown> };
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'referenceIndexes') return value.has !== undefined ? row.referenceIndexes.includes(value.has)
      : value.hasSome.some((index: number) => row.referenceIndexes.includes(index));
    if (key === 'batchVersion' && value?.gt !== undefined) return row.batchVersion > value.gt;
    return row[key] === value;
  });
  const db: any = {
    storyWork: { findFirst: jest.fn(async ({ where }) => Object.entries(where).every(([key, value]) =>
      publishedWork[key as keyof typeof publishedWork] === value) ? publishedWork : null) },
    storyRelease: { findFirst: jest.fn(async ({ where }) => Object.entries(where).every(([key, value]) =>
      release[key as keyof typeof release] === value) ? release : null), update: jest.fn() },
    storyManuscriptVersion: { findFirst: jest.fn(async () => manuscript) },
    storyAnalysisJob: { findFirst: jest.fn(async () => analysis) },
    storyWorkGenerationProfile: { findFirst: jest.fn(async () => profile) },
    storySceneVisualReviewBatch: {
      findFirst: jest.fn(async ({ where }) => batches.filter(row => matches(row, where)).sort((a, b) => b.batchVersion - a.batchVersion)[0] ?? null),
      create: jest.fn(async ({ data }) => { const row = { id: randomUUID(), ...data, status: 'draft', revision: 1,
        approvedByUserId: null, approvedAt: null, createdAt: new Date(), updatedAt: new Date() }; batches.push(row); return row; }),
      updateMany: jest.fn(async ({ where, data }) => { const row = batches.find(row => matches(row, where));
        if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
      findUniqueOrThrow: jest.fn(async ({ where }) => batches.find(row => row.id === where.id)),
    },
    storyPartVisualSelection: {
      findFirst: jest.fn(async ({ where }) => selections.filter(row => matches(row, where)).sort((a, b) => b.selectionVersion - a.selectionVersion)[0] ?? null),
      create: jest.fn(async ({ data }) => { const row = { id: randomUUID(), ...data, createdAt: new Date() }; selections.push(row); return row; }),
    },
    auditEvent: { create: jest.fn(async ({ data }) => { audit.push(data); return data; }) },
    storyVisualPrompt: { update: jest.fn(), create: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) }, storyVisualGeneration: { create: jest.fn() },
    storyStyleProfileConsent: { upsert: jest.fn() },
    $queryRaw: jest.fn(async () => [{ id: ids.work }]), $transaction: jest.fn(async cb => cb(db)),
  };
  const gate = new StoryStudioChoicePreparationService(db);
  const service = new StoryStudioVisualReviewService(db, gate);
  const identity = { expectedManuscriptHash: prepared.contentHash, expectedSourceChecksum: sourceChecksum, expectedProfilePinHash: profilePinHash };
  const input = { ...identity, idempotencyKey: randomUUID(), entries: [{ referenceIndex: 0, sourceSceneKey: prompts[0].sourceSceneKey,
    originalPromptSha256: prompts[0].promptSha256, promptText: '작가가 직접 다듬은 장면 지침. 사람과 배경, 시간을 유지한다.' }] };
  const approval = (batch: any) => ({ ...identity, expectedBatchChecksum: batch.batchChecksum, expectedRevision: batch.revision, scenesReviewed: true });
  return { ids, db, service, identity, input, approval, batches, audit, selections, manuscript, analysis, profile, prompts, reference, publishedWork, release };
}

async function approvedReference(f: ReturnType<typeof fixture>, index = 0) {
  const saved = await f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, { ...f.input, idempotencyKey: randomUUID(),
    entries: [{ referenceIndex: index, sourceSceneKey: f.prompts[index].sourceSceneKey,
      originalPromptSha256: f.prompts[index].promptSha256, promptText: `승인한 대표 장면 ${index}. 같은 인물과 배경, 시간을 유지한다.` }] });
  return f.service.approve(f.ids.owner, f.ids.work, f.ids.manuscript, saved.batchId, f.approval(saved));
}

function selectionInput(f: ReturnType<typeof fixture>, batch: Awaited<ReturnType<typeof approvedReference>>, version = 0) {
  return { ...f.identity, mode: 'select' as const, idempotencyKey: randomUUID(), expectedSelectionVersion: version,
    batchId: batch.batchId, expectedBatchChecksum: batch.batchChecksum, representativeReviewed: true };
}

function publishedPartPrompt(f: ReturnType<typeof fixture>, partKey = 'part-0') {
  const prepared = sourceOf(f.manuscript);
  const part = linearPartPlan(prepared, prepared.parts.map(part => ({ partKey: part.partKey }))).find(part => part.partKey === partKey)!;
  const promptText = studioSceneVisualPrompt(part.title, part.text);
  const prompt = { workId: f.ids.work, releaseId: f.ids.release, releaseChecksum: f.release.checksum,
    sourceSceneKey: `${partKey}-main`, promptText, promptSha256: sha256(promptText), sourceKind: 'studio_reviewed',
    sourceBindingSha256: releaseChecksum({ manuscriptId: f.ids.manuscript, manuscriptHash: f.manuscript.contentHash,
      partKey, textSha256: sha256(part.text) }) };
  f.release.branchGraphSnapshot = { contract: 'studio-linear-v1', parts: prepared.parts.map(part => ({ partKey: part.partKey })) };
  f.db.storyVisualPrompt.findUnique.mockResolvedValue(prompt);
  return prompt;
}

function ordinaryFixture() {
  const f = fixture();
  delete f.manuscript.structuredBody.publicationVisualSource;
  delete f.manuscript.structuredBody.publicationReaderProjection;
  const view = studioManuscriptVisualReviewSource(f.manuscript.structuredBody, f.manuscript.contentHash, sourceOf(f.manuscript));
  f.prompts = (view.body as any).publicationVisualSource.prompts;
  f.reference = (view.body as any).publicationVisualSource;
  Object.assign(f.identity, { expectedSourceChecksum: view.reference.checksum });
  f.input.expectedSourceChecksum = view.reference.checksum;
  f.input.entries = [{ ...f.input.entries[0], sourceSceneKey: f.prompts[0].sourceSceneKey, originalPromptSha256: f.prompts[0].promptSha256 }];
  return f;
}

describe('explicit scene approval for ordinary manuscripts without imported image guidance', () => {
  it('keeps proposed directions unapproved until saved, explicitly approved and chosen as the part representative', async () => {
    const f = ordinaryFixture(), original = JSON.stringify(f.manuscript.structuredBody), prompt = publishedPartPrompt(f);
    const context = await f.service.review(f.ids.owner, f.ids.work, f.ids.manuscript, 0, f.identity);
    expect(context).toMatchObject({ guidanceOrigin: 'manuscript_proposal', sourceSceneKey: 'part-0-main', batch: null,
      representative: { selectionVersion: 0, selection: null } });
    const draft = await f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, f.input);
    expect(draft).toMatchObject({ status: 'draft', generationStarted: false, published: false });
    await expect(f.service.approvedForReference(f.ids.owner, f.ids.work, f.ids.manuscript, 0, f.identity))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_APPROVAL_REQUIRED' } });
    const approved = await f.service.approve(f.ids.owner, f.ids.work, f.ids.manuscript, draft.batchId, f.approval(draft));
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, prompt.sourceSceneKey, prompt.promptSha256))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_REPRESENTATIVE_REQUIRED' } });
    await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, selectionInput(f, approved));
    expect(await f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, prompt.sourceSceneKey, prompt.promptSha256))
      .toMatchObject({ sourceSceneKey: prompt.sourceSceneKey, promptText: f.input.entries[0].promptText, batchId: approved.batchId,
        partSelection: { partKey: 'part-0', targetSceneKey: 'part-0-main' } });
    expect(JSON.stringify(f.manuscript.structuredBody)).toBe(original);
    expect(f.db.storyVisualPrompt.create).not.toHaveBeenCalled(); expect(f.db.storyVisualPrompt.update).not.toHaveBeenCalled();
    expect(f.db.storyVisualGeneration.create).not.toHaveBeenCalled(); expect(f.db.storyRelease.update).not.toHaveBeenCalled();
  });

  it('preserves owner, current profile and canonical release source gates for proposed guides', async () => {
    const f = ordinaryFixture(), prompt = publishedPartPrompt(f);
    await expect(f.service.save(randomUUID(), f.ids.work, f.ids.manuscript, f.input)).rejects.toBeDefined();
    f.profile.status = 'draft';
    await expect(f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, f.input)).rejects.toBeDefined();
    f.profile.status = 'approved';
    const approved = await approvedReference(f);
    await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, selectionInput(f, approved));
    f.db.storyVisualPrompt.findUnique.mockResolvedValue({ ...prompt, sourceKind: 'ai_branch' });
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, prompt.sourceSceneKey, prompt.promptSha256))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_SOURCE_CHANGED' } });
    f.db.storyVisualPrompt.findUnique.mockResolvedValue({ ...prompt, promptText: prompt.promptText + 'changed' });
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, prompt.sourceSceneKey, prompt.promptSha256))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_SOURCE_CHANGED' } });
    f.db.storyVisualPrompt.findUnique.mockResolvedValue(prompt);
    f.release.branchGraphSnapshot = {};
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, prompt.sourceSceneKey, prompt.promptSha256))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_SOURCE_CHANGED' } });
  });

  it('does not turn a proposed original-part approval into an approval of a new AI branch', async () => {
    const f = ordinaryFixture(), approved = await approvedReference(f);
    await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, selectionInput(f, approved));
    publishedPartPrompt(f);
    expect(await f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, 'ai-new-scene', 'c'.repeat(64))).toBeNull();
  });

  it('rejects an inconsistent ordinary release even when no scene guide was saved, approved or selected', async () => {
    const f = ordinaryFixture(), prompt = publishedPartPrompt(f);
    f.release.branchGraphSnapshot = {};
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, prompt.sourceSceneKey, prompt.promptSha256))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_SOURCE_CHANGED' } });
    expect(f.batches).toHaveLength(0); expect(f.selections).toHaveLength(0);
    expect(f.db.storyVisualGeneration.create).not.toHaveBeenCalled();
  });

  it('never restores an older approved representative when a newer proposed guide remains a draft', async () => {
    const f = ordinaryFixture(), approved = await approvedReference(f), prompt = publishedPartPrompt(f);
    await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, selectionInput(f, approved));
    await f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, { ...f.input, idempotencyKey: randomUUID(),
      entries: [{ ...f.input.entries[0], promptText: '새 장면 지침 수정안' }] });
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, prompt.sourceSceneKey, prompt.promptSha256))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_APPROVAL_REQUIRED' } });
  });

  it('invalidates proposal approval when an imported guide source appears, without editing saved history', async () => {
    const f = ordinaryFixture(), approved = await approvedReference(f);
    const other = fixture(); f.manuscript.structuredBody.publicationReaderProjection = other.manuscript.structuredBody.publicationReaderProjection;
    f.manuscript.structuredBody.publicationVisualSource = other.manuscript.structuredBody.publicationVisualSource;
    await expect(f.service.approvedForReference(f.ids.owner, f.ids.work, f.ids.manuscript, 0, f.identity))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_SOURCE_CHANGED' } });
    expect(f.batches.find(row => row.id === approved.batchId)?.status).toBe('approved');
  });
});

describe('explicit author-approved part representative selection (synthetic DB)', () => {
  it('never selects the first source on open, draft save or guide approval', async () => {
    const f = fixture();
    expect((await f.service.review(f.ids.owner, f.ids.work, f.ids.manuscript, 0, f.identity)).representative)
      .toMatchObject({ partKey: 'part-0', targetSceneKey: 'part-0-main', selectionVersion: 0, selection: null });
    await approvedReference(f);
    expect(f.selections).toHaveLength(0);
    const prompt = publishedPartPrompt(f);
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, prompt.sourceSceneKey, prompt.promptSha256))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_REPRESENTATIVE_REQUIRED' } });
  });

  it('explicitly selects the second guide of a shared part without modifying the original or canonical prompt', async () => {
    const f = fixture(2, false, true), original = JSON.stringify(f.manuscript.structuredBody);
    const batch = await approvedReference(f, 1);
    const result = await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 1, selectionInput(f, batch));
    expect(result).toMatchObject({ partKey: 'part-0', targetSceneKey: 'part-0-main', selectionVersion: 1,
      selection: { status: 'selected', current: true, referenceIndex: 1, sourceSceneKey: 'source-1', batchId: batch.batchId } });
    const prompt = publishedPartPrompt(f);
    const guide = await f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, prompt.sourceSceneKey, prompt.promptSha256);
    expect(guide).toMatchObject({ referenceIndex: 1, sourceSceneKey: 'source-1', batchId: batch.batchId,
      partSelection: { id: result!.selection!.id, selectionVersion: 1, targetSceneKey: prompt.sourceSceneKey } });
    expect(JSON.stringify(f.manuscript.structuredBody)).toBe(original);
    expect(f.db.storyVisualPrompt.update).not.toHaveBeenCalled(); expect(f.db.storyVisualGeneration.create).not.toHaveBeenCalled();
    expect(f.db.storyRelease.update).not.toHaveBeenCalled(); expect(f.db.storyStyleProfileConsent.upsert).not.toHaveBeenCalled();
    expect(JSON.stringify(f.audit)).not.toContain('승인한 대표 장면');
  });

  it('switches between two guides of one part monotonically and never replays an older selection over the new one', async () => {
    const f = fixture(2, false, true), a = await approvedReference(f, 0), b = await approvedReference(f, 1);
    const first = selectionInput(f, a);
    await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, first);
    await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 1, selectionInput(f, b, 1));
    const review = await f.service.review(f.ids.owner, f.ids.work, f.ids.manuscript, 0, f.identity);
    expect(review.representative).toMatchObject({ selectionVersion: 2, selection: { referenceIndex: 1, current: true } });
    const prompt = publishedPartPrompt(f);
    expect(await f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, prompt.sourceSceneKey, prompt.promptSha256))
      .toMatchObject({ batchId: b.batchId, partSelection: { selectionVersion: 2 } });
    await expect(f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, first))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_REPRESENTATIVE_CHANGED' } });
    expect(f.selections).toHaveLength(2);
  });

  it('retries an identical selection without duplicating its row or audit', async () => {
    const f = fixture(), batch = await approvedReference(f), input = selectionInput(f, batch);
    const a = await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, input);
    const b = await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, input);
    expect(a!.selection!.id).toBe(b!.selection!.id); expect(f.selections).toHaveLength(1); expect(f.audit).toHaveLength(3);
    await expect(f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, { ...input, expectedSelectionVersion: 1 }))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_IDEMPOTENCY_CONFLICT' } });
  });

  it('clears a representative explicitly and blocks fallback to older selections or first-source guesses', async () => {
    const f = fixture(2, false, true), batch = await approvedReference(f, 1);
    await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 1, selectionInput(f, batch));
    const input = { ...f.identity, mode: 'clear' as const, idempotencyKey: randomUUID(), expectedSelectionVersion: 1 };
    const cleared = await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, input);
    expect(cleared).toMatchObject({ selectionVersion: 2, selection: { status: 'cleared', current: true,
      referenceIndex: null, sourceSceneKey: null, batchId: null, batchChecksum: null } });
    await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, input);
    expect(f.selections).toHaveLength(2); expect(f.audit).toHaveLength(4);
    const prompt = publishedPartPrompt(f);
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, prompt.sourceSceneKey, prompt.promptSha256))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_REPRESENTATIVE_REQUIRED' } });
  });

  it.each([{}, { representativeReviewed: false }, { batchId: randomUUID() }, { expectedBatchChecksum: 'f'.repeat(64) },
    { expectedSelectionVersion: 4 }, { expectedSelectionVersion: -1 }, { expectedSelectionVersion: 0.5 }, { mode: 'automatic' },
    { mode: 'clear', representativeReviewed: true }])('rejects incomplete, unconfirmed, stale or mismatched selection %j', async patch => {
    const f = fixture(), batch = await approvedReference(f);
    const input: any = selectionInput(f, batch);
    if (Object.keys(patch).length) Object.assign(input, patch); else delete input.representativeReviewed;
    await expect(f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, input)).rejects.toBeDefined();
    expect(f.selections).toHaveLength(0); expect(f.db.storyVisualGeneration.create).not.toHaveBeenCalled();
  });

  it('does not select an unapproved guide or a batch belonging to a different part', async () => {
    const f = fixture(), saved = await f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, f.input);
    const input = selectionInput(f, saved);
    await expect(f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, input))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_APPROVAL_REQUIRED' } });
    await f.service.approve(f.ids.owner, f.ids.work, f.ids.manuscript, saved.batchId, f.approval(saved));
    await expect(f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 1, input))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_APPROVAL_REQUIRED' } });
    expect(f.selections).toHaveLength(0);
  });

  it('retains but disables selection when a newer guide draft exists, and requires explicit reselection after reapproval', async () => {
    const f = fixture(), batch = await approvedReference(f);
    await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, selectionInput(f, batch));
    const draft = await f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, { ...f.input, idempotencyKey: randomUUID() });
    expect((await f.service.review(f.ids.owner, f.ids.work, f.ids.manuscript, 0, f.identity)).representative!.selection)
      .toMatchObject({ current: false, batchId: batch.batchId });
    const prompt = publishedPartPrompt(f);
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, prompt.sourceSceneKey, prompt.promptSha256))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_APPROVAL_REQUIRED' } });
    const next = await f.service.approve(f.ids.owner, f.ids.work, f.ids.manuscript, draft.batchId, f.approval(draft));
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, prompt.sourceSceneKey, prompt.promptSha256))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_REPRESENTATIVE_CHANGED' } });
    await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, selectionInput(f, next, 1));
    expect((await f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, prompt.sourceSceneKey, prompt.promptSha256))!.batchId)
      .toBe(next.batchId);
  });

  it.each(['promptText', 'promptSha256', 'sourceBindingSha256', 'releaseChecksum', 'sourceKind'])('rejects changed canonical part prompt %s rather than substituting a source guess', async field => {
    const f = fixture(), batch = await approvedReference(f);
    await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, selectionInput(f, batch));
    const prompt = publishedPartPrompt(f), hash = prompt.promptSha256;
    (prompt as any)[field] = field === 'promptText' ? 'tampered canonical direction' : field === 'sourceKind' ? 'admin_verified' : 'f'.repeat(64);
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, prompt.sourceSceneKey, hash))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_SOURCE_CHANGED' } });
  });

  it('does not bypass an explicit clear through a mislabeled canonical prompt or missing canonical row', async () => {
    const f = fixture(), batch = await approvedReference(f);
    await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, selectionInput(f, batch));
    await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, {
      ...f.identity, mode: 'clear', expectedSelectionVersion: 1, idempotencyKey: randomUUID() });
    const prompt = publishedPartPrompt(f);
    prompt.sourceKind = 'admin_verified';
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, prompt.sourceSceneKey, prompt.promptSha256))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_SOURCE_CHANGED' } });
    f.db.storyVisualPrompt.findUnique.mockResolvedValue(null);
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum, prompt.sourceSceneKey, prompt.promptSha256))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_SOURCE_CHANGED' } });
  });

  it('rejects a tampered selection checksum and hides an old-profile selection without resetting its version', async () => {
    const f = fixture(), batch = await approvedReference(f);
    await f.service.selectRepresentative(f.ids.owner, f.ids.work, f.ids.manuscript, 0, selectionInput(f, batch));
    const checksum = f.selections[0].selectionChecksum;
    f.selections[0].selectionChecksum = 'f'.repeat(64);
    await expect(f.service.review(f.ids.owner, f.ids.work, f.ids.manuscript, 0, f.identity))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_REPRESENTATIVE_CHANGED' } });
    f.selections[0].selectionChecksum = checksum; f.profile.reviewRevision++;
    const context = await f.service.review(f.ids.owner, f.ids.work, f.ids.manuscript, 0,
      { expectedManuscriptHash: f.identity.expectedManuscriptHash, expectedSourceChecksum: f.identity.expectedSourceChecksum });
    expect(context.representative).toMatchObject({ selectionVersion: 1, selection: { current: false } });
  });
});

describe('private author scene guidance save/approval/reuse (real approved-profile policy, synthetic DB)', () => {
  it('reads as reference-only without storing, granting rights, generating, or approving', async () => {
    const f = fixture();
    expect(await f.service.review(f.ids.owner, f.ids.work, f.ids.manuscript, 0, f.identity)).toMatchObject({
      contract: 'story-visual-review-context-v1', batch: null, profilePinHash: f.identity.expectedProfilePinHash,
      analysisJobId: f.ids.analysis, sourceSceneKey: 'source-0' });
    expect(f.db.storySceneVisualReviewBatch.create).not.toHaveBeenCalled(); expect(f.audit).toHaveLength(0);
    expect(f.db.storyStyleProfileConsent.upsert).not.toHaveBeenCalled(); expect(f.db.storyVisualGeneration.create).not.toHaveBeenCalled();
  });

  it('saves an immutable separate draft, explicitly approves it, then returns only the approved matching entry', async () => {
    const f = fixture(), original = JSON.stringify(f.manuscript.structuredBody);
    const saved = await f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, f.input);
    expect(saved).toMatchObject({ status: 'draft', revision: 1, approvedAt: null, generationStarted: false, published: false });
    await expect(f.service.approvedForReference(f.ids.owner, f.ids.work, f.ids.manuscript, 0, f.identity))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_APPROVAL_REQUIRED' } });
    const approved = await f.service.approve(f.ids.owner, f.ids.work, f.ids.manuscript, saved.batchId, f.approval(saved));
    expect(approved).toMatchObject({ status: 'approved', revision: 2, generationStarted: false, published: false });
    const reused = await f.service.approvedForReference(f.ids.owner, f.ids.work, f.ids.manuscript, 0, f.identity);
    expect(reused).toMatchObject({ batchId: saved.batchId, promptText: f.input.entries[0].promptText,
      promptSha256: sha256(f.input.entries[0].promptText), approvedByUserId: f.ids.owner, partKey: 'part-0' });
    expect(JSON.stringify(f.manuscript.structuredBody)).toBe(original);
    expect(f.db.storyVisualPrompt.update).not.toHaveBeenCalled(); expect(f.db.storyVisualGeneration.create).not.toHaveBeenCalled();
    expect(f.db.storyRelease.update).not.toHaveBeenCalled(); expect(f.db.storyStyleProfileConsent.upsert).not.toHaveBeenCalled();
    expect(JSON.stringify(f.audit)).not.toContain(f.input.entries[0].promptText);
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  });

  it('replays a saved request and an approved request without a second row or audit and rejects key reuse for changed text', async () => {
    const f = fixture();
    const saved = await f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, f.input);
    expect((await f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, f.input)).batchId).toBe(saved.batchId);
    const request = f.approval(saved);
    await f.service.approve(f.ids.owner, f.ids.work, f.ids.manuscript, saved.batchId, request);
    expect((await f.service.approve(f.ids.owner, f.ids.work, f.ids.manuscript, saved.batchId, request)).status).toBe('approved');
    expect(f.batches).toHaveLength(1); expect(f.audit).toHaveLength(2);
    await expect(f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, { ...f.input,
      entries: [{ ...f.input.entries[0], promptText: '다른 수정안' }] }))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_IDEMPOTENCY_CONFLICT' } });
  });

  it('supports eight reviewed entries with derived bindings and a stable checksum independent of input order', async () => {
    const f = fixture(8);
    const entries = f.prompts.map((prompt, index) => ({ referenceIndex: index, sourceSceneKey: prompt.sourceSceneKey,
      originalPromptSha256: prompt.promptSha256, promptText: `검토할 수정안 ${index}` }));
    const saved = await f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, { ...f.input, entries: entries.reverse() });
    expect((saved.entries as any[]).map(entry => entry.referenceIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    await f.service.approve(f.ids.owner, f.ids.work, f.ids.manuscript, saved.batchId, f.approval(saved));
    expect(await f.service.approvedForReference(f.ids.owner, f.ids.work, f.ids.manuscript, 7, f.identity)).toMatchObject({ partKey: 'part-7' });
  });

  it('a newer draft hides an old approval and prevents late approval from overwriting it, even with identical timestamps', async () => {
    const f = fixture();
    const saved = await f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, f.input);
    await f.service.approve(f.ids.owner, f.ids.work, f.ids.manuscript, saved.batchId, f.approval(saved));
    const latest = await f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, { ...f.input, idempotencyKey: randomUUID(),
      entries: [{ ...f.input.entries[0], promptText: '더 최근 수정안' }] });
    f.batches.forEach(row => { row.createdAt = new Date(0); row.updatedAt = new Date(0); });
    expect((await f.service.review(f.ids.owner, f.ids.work, f.ids.manuscript, 0, f.identity)).batch?.batchId).toBe(latest.batchId);
    await expect(f.service.approvedForReference(f.ids.owner, f.ids.work, f.ids.manuscript, 0, f.identity))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_APPROVAL_REQUIRED' } });
    await expect(f.service.approve(f.ids.owner, f.ids.work, f.ids.manuscript, saved.batchId, f.approval(saved)))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_BATCH_SUPERSEDED' } });
  });

  it.each(['manuscript', 'source', 'profile', 'analysis', 'same-setting-reapproval'])('rejects stale %s before save, approval and reuse', async kind => {
    const f = fixture(), saved = await f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, f.input);
    if (kind === 'manuscript') f.manuscript.id = randomUUID();
    if (kind === 'source') f.manuscript.structuredBody.publicationVisualSource.prompts[0].promptText = '변조됨';
    if (kind === 'profile') f.profile.status = 'needs_review';
    if (kind === 'analysis') f.analysis.id = randomUUID();
    if (kind === 'same-setting-reapproval') f.profile.reviewRevision++;
    await expect(f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, f.input)).rejects.toBeDefined();
    await expect(f.service.approve(f.ids.owner, f.ids.work, f.ids.manuscript, saved.batchId, f.approval(saved))).rejects.toBeDefined();
    await expect(f.service.approvedForReference(f.ids.owner, f.ids.work, f.ids.manuscript, 0, f.identity)).rejects.toBeDefined();
    expect(f.db.storySceneVisualReviewBatch.updateMany).not.toHaveBeenCalled(); expect(f.batches).toHaveLength(1);
  });

  it('enforces owner isolation on reads and writes and rejects a foreign batch ID', async () => {
    const f = fixture();
    await expect(f.service.review(randomUUID(), f.ids.work, f.ids.manuscript, 0, f.identity)).rejects.toMatchObject({ status: 404 });
    f.db.$queryRaw.mockResolvedValueOnce([]);
    await expect(f.service.save(randomUUID(), f.ids.work, f.ids.manuscript, f.input)).rejects.toMatchObject({ status: 404 });
    await expect(f.service.approve(f.ids.owner, f.ids.work, f.ids.manuscript, randomUUID(), { ...f.identity,
      expectedBatchChecksum: 'b'.repeat(64), expectedRevision: 1, scenesReviewed: true })).rejects.toMatchObject({ status: 404 });
    expect(f.batches).toHaveLength(0);
  });

  it.each(['empty', 'duplicate', 'too-many', 'nul', 'wrong-source', 'too-large'])('refuses %s entries rather than binding arbitrary text', async kind => {
    const f = fixture(); let entries = f.input.entries;
    if (kind === 'empty') entries = [{ ...entries[0], promptText: '  ' }];
    if (kind === 'duplicate') entries = [entries[0], entries[0]];
    if (kind === 'too-many') entries = Array(9).fill(entries[0]);
    if (kind === 'nul') entries = [{ ...entries[0], promptText: 'bad\0text' }];
    if (kind === 'wrong-source') entries = [{ ...entries[0], sourceSceneKey: 'source-2' }];
    if (kind === 'too-large') entries = [{ ...entries[0], promptText: 'x'.repeat(32001) }];
    await expect(f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, { ...f.input, entries })).rejects.toBeDefined();
    expect(f.batches).toHaveLength(0);
  });

  it('refuses legacy unmapped sources instead of fabricating a source scene', async () => {
    const f = fixture(); delete f.manuscript.structuredBody.publicationVisualSource.sceneBindings;
    const { checksum: _checksum, ...source } = f.manuscript.structuredBody.publicationVisualSource;
    const checksum = releaseChecksum(source); f.manuscript.structuredBody.publicationVisualSource.checksum = checksum;
    await expect(f.service.review(f.ids.owner, f.ids.work, f.ids.manuscript, 0, { ...f.identity, expectedSourceChecksum: checksum }))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_MAPPING_REQUIRED' } });
    expect(f.batches).toHaveLength(0);
  });

  it('refuses a structurally bound heading-only range with no reader prose', async () => {
    const f = fixture(1, true);
    await expect(f.service.review(f.ids.owner, f.ids.work, f.ids.manuscript, 0, f.identity))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_PROSE_REQUIRED' } });
    await expect(f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, f.input))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_PROSE_REQUIRED' } });
    expect(f.batches).toHaveLength(0);
  });

  it('bounds the serialized batch, including heavily escaped prompt text, before storage', async () => {
    const f = fixture(8);
    const entries = f.prompts.map((prompt, referenceIndex) => ({ referenceIndex, sourceSceneKey: prompt.sourceSceneKey,
      originalPromptSha256: prompt.promptSha256, promptText: '\u0001'.repeat(32000) }));
    await expect(f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, { ...f.input, entries }))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_ENTRIES_INVALID' } });
    expect(f.batches).toHaveLength(0); expect(f.audit).toHaveLength(0);
  });

  it('requires an explicit expected profile pin even for non-HTTP consumers', async () => {
    const f = fixture(), invalid = { ...f.identity, expectedProfilePinHash: undefined } as any;
    await expect(f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, { ...f.input, ...invalid }))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_PROFILE_PIN_REQUIRED' } });
    await expect(f.service.approvedForReference(f.ids.owner, f.ids.work, f.ids.manuscript, 0, invalid))
      .rejects.toMatchObject({ response: { code: 'STUDIO_VISUAL_REVIEW_PROFILE_PIN_REQUIRED' } });
    expect(f.batches).toHaveLength(0);
  });

  it.each(['checkbox', 'checksum', 'revision'])('requires the explicit current %s before approval', async field => {
    const f = fixture(), saved = await f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, f.input);
    const input = f.approval(saved);
    if (field === 'checkbox') input.scenesReviewed = false;
    if (field === 'checksum') input.expectedBatchChecksum = 'b'.repeat(64);
    if (field === 'revision') input.expectedRevision = 2;
    await expect(f.service.approve(f.ids.owner, f.ids.work, f.ids.manuscript, saved.batchId, input)).rejects.toBeDefined();
    expect(f.batches[0].status).toBe('draft'); expect(f.db.storySceneVisualReviewBatch.updateMany).not.toHaveBeenCalled();
  });

  it.each(['prompt', 'binding', 'pin', 'approval', 'indexes'])('fails closed on persisted %s tampering', async field => {
    const f = fixture(), saved = await f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, f.input);
    await f.service.approve(f.ids.owner, f.ids.work, f.ids.manuscript, saved.batchId, f.approval(saved));
    const batch = f.batches[0];
    if (field === 'prompt') batch.entries[0].promptText = '저장 이후 바뀐 내용';
    if (field === 'binding') batch.entries[0].bindingSha256 = 'd'.repeat(64);
    if (field === 'pin') batch.profilePin.pin.reviewRevision = 9;
    if (field === 'approval') batch.approvedByUserId = randomUUID();
    if (field === 'indexes') batch.referenceIndexes = [0, 1];
    await expect(f.service.review(f.ids.owner, f.ids.work, f.ids.manuscript, 0, f.identity)).rejects.toBeDefined();
    await expect(f.service.approvedForReference(f.ids.owner, f.ids.work, f.ids.manuscript, 0, f.identity)).rejects.toBeDefined();
  });

  it('resolves an exact approved source in the caller transaction without overwriting the original or nesting transactions', async () => {
    const f = fixture(), original = JSON.stringify(f.manuscript.structuredBody);
    const saved = await f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, f.input);
    await f.service.approve(f.ids.owner, f.ids.work, f.ids.manuscript, saved.batchId, f.approval(saved));
    f.db.$transaction.mockClear();
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum,
      'source-0', f.prompts[0].promptSha256)).resolves.toMatchObject({ batchId: saved.batchId,
      manuscriptVersionId: f.ids.manuscript, promptText: f.input.entries[0].promptText, generationStarted: false });
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(JSON.stringify(f.manuscript.structuredBody)).toBe(original);
    expect(f.db.storyVisualPrompt.create).not.toHaveBeenCalled();
    expect(f.db.storyVisualPrompt.update).not.toHaveBeenCalled();
    expect(f.db.storyVisualGeneration.create).not.toHaveBeenCalled();
    expect(f.db.storyStyleProfileConsent.upsert).not.toHaveBeenCalled();
    expect(f.db.storyRelease.update).not.toHaveBeenCalled();
  });

  it.each(['part-0-main', 'other-source', 'ai-unrelated'])('does not guess an original reference for %s', async key => {
    const f = fixture();
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum,
      key, f.prompts[0].promptSha256)).resolves.toBeNull();
    expect(f.db.storySceneVisualReviewBatch.findFirst).not.toHaveBeenCalled();
  });

  it('permits separately backed studio/branch prompts when no imported reference exists, not when reference data is corrupted', async () => {
    const f = fixture();
    delete f.manuscript.structuredBody.publicationVisualSource;
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum,
      'source-0', f.prompts[0].promptSha256)).resolves.toBeNull();
    f.manuscript.structuredBody.publicationVisualSource = { bad: true };
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, f.release.checksum,
      'source-0', f.prompts[0].promptSha256)).rejects.toBeDefined();
  });

  it.each(['draft', 'new-draft', 'profile', 'release', 'work', 'owner', 'prompt-hash'])('blocks published-source reuse after %s changes', async kind => {
    const f = fixture(), saved = await f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, f.input);
    if (kind !== 'draft') await f.service.approve(f.ids.owner, f.ids.work, f.ids.manuscript, saved.batchId, f.approval(saved));
    if (kind === 'new-draft') await f.service.save(f.ids.owner, f.ids.work, f.ids.manuscript, { ...f.input,
      idempotencyKey: randomUUID(), entries: [{ ...f.input.entries[0], promptText: '신규 미승인 수정안' }] });
    if (kind === 'profile') f.profile.reviewRevision++;
    if (kind === 'release') f.release.checksum = 'd'.repeat(64);
    if (kind === 'work') f.publishedWork.activeReleaseId = randomUUID();
    if (kind === 'owner') f.publishedWork.ownerUserId = randomUUID();
    await expect(f.service.approvedForPublishedSource(f.db, f.ids.work, f.ids.release, 'e'.repeat(64),
      'source-0', kind === 'prompt-hash' ? 'd'.repeat(64) : f.prompts[0].promptSha256)).rejects.toBeDefined();
    expect(f.db.storyVisualGeneration.create).not.toHaveBeenCalled();
  });
});
