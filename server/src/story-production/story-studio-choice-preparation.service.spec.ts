import { randomUUID } from 'crypto';
import { StoryChoicePreparationError } from './story-choice-preparation.provider';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';

function fixture() {
  const ids = { owner: randomUUID(), work: randomUUID(), release: randomUUID(), manuscript: randomUUID(),
    scene: randomUUID(), part: randomUUID(), review: randomUUID(), consent: randomUUID(), next: randomUUID() };
  const original = { id: randomUUID(), sceneId: ids.scene, choiceKey: 'original', position: 1,
    routeKind: 'writer_original', label: { ko: '증거를 들고 다음 방으로 간다' },
    targetSceneId: ids.next as string | null, targetEndingKey: null, declaredRejoinSceneId: null };
  const work = { id: ids.work, ownerUserId: ids.owner, status: 'draft', activeReleaseId: null,
    publishedAt: null, fixtureSource: false, title: { ko: '시험 작품' } };
  const manuscript = { id: ids.manuscript, workId: ids.work, ownerUserId: ids.owner, locale: 'ko',
    contentHash: 'hash', structuredBody: { intake: { format: 'story-manuscript-intake-v1' }, parts: [
      { partKey: 'part-1', title: '첫 장', paragraphs: [{ kind: 'paragraph', text: '첫 문장. 마지막 문장.' }] },
    ] } };
  const consent = { id: ids.consent, ownerUserId: ids.owner, manuscriptVersionId: ids.manuscript,
    status: 'active', rightsConfirmed: true, aiBranchAllowed: true, startsAt: new Date(0),
    expiresAt: null, allowedLocales: ['ko'], revision: 1 };
  const choices = [original];
  let evidence: Record<string, unknown> | null = null;
  const db: any = {
    storyWork: { findFirst: jest.fn().mockResolvedValue(work) },
    storyAuthoredImport: { findUnique: jest.fn().mockResolvedValue(null) },
    storyRelease: { findFirst: jest.fn().mockResolvedValue({ id: ids.release, manuscriptVersionId: ids.manuscript }) },
    storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue(manuscript), findUnique: jest.fn().mockResolvedValue(manuscript) },
    storyWriterReview: { findFirst: jest.fn().mockResolvedValue({ id: ids.review, state: 'submitted' }) },
    storyFinalSubmission: { findUnique: jest.fn().mockResolvedValue({ status: 'submitted', checksum: 'hash', manuscriptVersionId: ids.manuscript }) },
    storyStyleProfileConsent: { findUnique: jest.fn().mockResolvedValue(consent) },
    storyScene: { findFirst: jest.fn().mockResolvedValue({ id: ids.scene, partId: ids.part }),
      findUnique: jest.fn().mockResolvedValue({ id: ids.next, partId: randomUUID() }),
      findMany: jest.fn().mockResolvedValue([{ id: ids.scene, status: 'published' }]) },
    storyPart: { findFirst: jest.fn().mockImplementation(async ({ where }) => ({
      id: where.id, workId: ids.work, position: where.id === ids.part ? 1 : 2,
      status: 'draft', title: { ko: '첫 장' },
    })), findMany: jest.fn().mockResolvedValue([{ id: ids.part, position: 1, status: 'published' }]) },
    storyBeat: { findMany: jest.fn().mockResolvedValue([{ content: { ko: '첫 문장. 마지막 문장.' } }]) },
    storyChoice: { findMany: jest.fn().mockImplementation(async () => choices),
      createMany: jest.fn(async ({ data }) => { choices.push(...data); return { count: data.length }; }) },
    auditEvent: { create: jest.fn(async ({ data }) => { evidence = data; return data; }),
      findFirst: jest.fn(async () => evidence) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (run: (tx: unknown) => Promise<unknown>) => run(db)),
  };
  const service = new StoryStudioChoicePreparationService(db as never);
  const provider = { generate: jest.fn().mockResolvedValue([{ partKey: 'part-1', alternatives: [
    '증거를 숨기고 혼자 조사한다', '증거를 경찰에게 건넨다',
  ] }]) };
  jest.spyOn(service as never, 'provider').mockReturnValue(provider as never);
  return { ids, db, service, provider, consent, choices, original, manuscript };
}

describe('Studio authored choice preparation', () => {
  it('preserves the authored route and commits two generated alternatives only after final review and consent', async () => {
    const f = fixture();
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .resolves.toEqual({ sceneId: f.ids.scene, choiceCount: 3, originalRoutePreserved: true });
    expect(f.db.storyChoice.createMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ position: 2, routeKind: 'generation_required', label: { ko: '증거를 숨기고 혼자 조사한다' } }),
      expect.objectContaining({ position: 3, routeKind: 'generation_required', label: { ko: '증거를 경찰에게 건넨다' } }),
    ] });
    expect(f.original.targetSceneId).toBe(f.ids.next);
    expect(f.db.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('fails closed without reviewed submission or current AI rights consent', async () => {
    const f = fixture();
    f.db.storyFinalSubmission.findUnique.mockResolvedValueOnce(null);
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_FINAL_REVIEW_REQUIRED' } });
    f.consent.aiBranchAllowed = false;
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_AI_RIGHTS_CONSENT_REQUIRED' } });
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
  });

  it('does not persist placeholder choices when generation fails', async () => {
    const f = fixture();
    f.provider.generate.mockRejectedValueOnce(new StoryChoicePreparationError('invalid_output'));
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_FAILED' } });
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
  });

  it('rejects a changed manuscript between generation and storage', async () => {
    const f = fixture();
    f.db.storyManuscriptVersion.findFirst.mockResolvedValueOnce(f.manuscript)
      .mockResolvedValueOnce({ ...f.manuscript, contentHash: 'changed' });
    await expect(f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_FINAL_REVIEW_REQUIRED' } });
    expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
  });

  it('blocks publication when reviewed Studio scenes have fewer than three choices', async () => {
    const f = fixture();
    await expect(f.service.assertPublishableTx(f.db as never, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_PUBLICATION_CHOICES_INCOMPLETE' } });
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    await expect(f.service.assertPublishableTx(f.db as never, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release)).resolves.toBeUndefined();
  });

  it('blocks publication when an uploaded Studio manuscript has no final review', async () => {
    const f = fixture();
    f.db.storyWriterReview.findFirst.mockResolvedValueOnce(null);
    await expect(f.service.assertPublishableTx(f.db as never, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_FINAL_REVIEW_REQUIRED' } });
    expect(f.db.storyChoice.createMany).not.toHaveBeenCalled();
  });

  it('returns only reviewed draft rows for atomic promotion at publication', async () => {
    const f = fixture();
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    f.db.storyPart.findMany.mockResolvedValueOnce([{ id: f.ids.part, position: 1, status: 'draft' }]);
    f.db.storyScene.findMany.mockResolvedValueOnce([{ id: f.ids.scene, status: 'draft' }]);
    await expect(f.service.assertPublishableTx(f.db as never, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release))
      .resolves.toEqual({ partIds: [f.ids.part], sceneIds: [f.ids.scene] });
  });

  it('rejects hand-edited placeholder labels without matching generation evidence', async () => {
    const f = fixture();
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    f.choices[1].label = { ko: '임시 선택지' };
    await expect(f.service.assertPublishableTx(f.db as never, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED' } });
  });

  it('rejects scene prose changed after choice generation', async () => {
    const f = fixture();
    await f.service.prepare(f.ids.owner, f.ids.work, f.ids.release, f.ids.scene);
    f.db.storyBeat.findMany.mockResolvedValueOnce([{ content: { ko: '다른 본문' } }]);
    await expect(f.service.assertPublishableTx(f.db as never, f.ids.work, f.ids.owner, f.ids.manuscript, f.ids.release))
      .rejects.toMatchObject({ response: { code: 'STUDIO_CHOICES_GENERATION_PROOF_REQUIRED' } });
  });
});
