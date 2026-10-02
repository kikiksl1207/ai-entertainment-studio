import { StoryPublicationIntakeService } from './story-publication-intake.service';
import { StoryPublicationChoiceProfileService } from './story-publication-choice-profile.service';

function fixture() {
  const prisma = { storyPublicationImportJob: {
    findUnique: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  }, $transaction: jest.fn(async (callback: (tx: unknown) => unknown): Promise<unknown> => callback(prisma)) };
  const policy = { forPlan: jest.fn(), forWork: jest.fn(),
    assertSame: new StoryPublicationChoiceProfileService({} as never).assertSame };
  const service = new StoryPublicationIntakeService(prisma as never, {} as never, undefined, policy as never);
  const plan = { storyKey: 'monster', slug: 'publication-profile-test', title: 'Test story', summary: 'Test',
    coverPath: '/cover.webp', sourceBindingSha256: 'a'.repeat(64),
    manuscript: { locale: 'ko', contentHash: 'b'.repeat(64), structuredBody: {} },
    parts: [{ partKey: 'part-1', title: 'The ledger', actNumber: 1, position: 1,
      beats: [{ text: 'The archivist hid the ledger.', sourceSceneKey: 'part-1-scene-01' }],
      choices: [{ choiceKey: 'next', label: 'Preserve the original route', position: 1,
        routeKind: 'writer_original', targetPartKey: null, targetEndingKey: 'author_main' }] }], prompts: [] };
  const job = { id: 'job-id', actorUserId: 'operator-id', status: 'queued', batchCursor: 0,
    workId: 'work-id', releaseId: null, errorCode: null, updatedAt: new Date(0),
    planSnapshot: (service as any).storedPlan(plan) };
  prisma.storyPublicationImportJob.findUnique.mockResolvedValue(job);
  const profile = { binding: { workId: 'work-id', manuscriptVersionId: 'manuscript-id',
    manuscriptHash: plan.manuscript.contentHash, consentId: 'consent-id', consentRevision: 1,
    generationProfilePin: { approvedFingerprint: 'c'.repeat(64), approvedAt: '2026-09-30T00:00:00.000Z' },
    generationProfileViewVersion: 'v3' }, approved: { sections: [{ key: 'writing_style', value: {
      summary: 'Restrained first person', referenceScope: 'production_constraint' } }] } };
  policy.forPlan.mockResolvedValue(profile);
  const generate = jest.fn().mockResolvedValue([{ partKey: 'part-1', alternatives: ['Hide the ledger', 'Reveal the ledger'] }]);
  jest.spyOn(service as any, 'choiceProvider').mockReturnValue({ generate });
  return { prisma, policy, service, plan, job, profile, generate };
}

describe('Publication choice profile integration (no provider network)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends only the approved bounded view and stores its whole binding with the prepared plan', async () => {
    const f = fixture();
    await (f.service as any).prepareApprovedChoices('operator-id', 'job-id');
    expect(f.generate).toHaveBeenCalledWith(expect.objectContaining({ generationProfile: f.profile.approved }));
    const savedCall = f.prisma.storyPublicationImportJob.updateMany.mock.calls.find(([input]) => input.data.planSnapshot);
    const saved = (f.service as any).readStoredPlan(savedCall![0].data.planSnapshot);
    expect(saved.choicePreparation.profileBinding).toEqual(f.profile.binding);
    expect(saved.parts[0].choices).toMatchObject([
      { routeKind: 'writer_original', targetEndingKey: 'author_main' },
      { routeKind: 'generation_required', targetPartKey: null, targetEndingKey: null },
      { routeKind: 'generation_required', targetPartKey: null, targetEndingKey: null },
    ]);
  });

  it('does not call a provider or acquire a paid claim when author approval is unavailable', async () => {
    const f = fixture();
    f.policy.forPlan.mockRejectedValue(new Error('Author approval required'));
    await expect((f.service as any).prepareApprovedChoices('operator-id', 'job-id')).rejects.toThrow('Author approval required');
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.prisma.storyPublicationImportJob.updateMany).not.toHaveBeenCalled();
  });

  it('does not silently mix older batches with newly approved settings', async () => {
    const f = fixture();
    f.job.planSnapshot = (f.service as any).storedPlan({ ...f.plan, choicePreparation: {
      version: 'authored-context-two-alternatives-v1', preparedPartKeys: ['another-part'], profileBinding: null,
    } });
    await expect((f.service as any).prepareApprovedChoices('operator-id', 'job-id')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_PUBLICATION_CHOICE_SETTINGS_CHANGED' }),
    });
    expect(f.generate).not.toHaveBeenCalled();
  });

  it('retains the old plan and pauses for review if the full approval pin changes during generation', async () => {
    const f = fixture();
    f.policy.forPlan.mockResolvedValueOnce(f.profile).mockResolvedValueOnce({ ...f.profile,
      binding: { ...f.profile.binding, generationProfilePin: { ...f.profile.binding.generationProfilePin,
        approvedAt: '2026-09-30T01:00:00.000Z' } } });
    await expect((f.service as any).prepareApprovedChoices('operator-id', 'job-id')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_PUBLICATION_CHOICE_SETTINGS_CHANGED' }),
    });
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.prisma.storyPublicationImportJob.updateMany.mock.calls.some(([input]) => input.data.planSnapshot)).toBe(false);
    expect(f.prisma.storyPublicationImportJob.updateMany.mock.calls.at(-1)![0].data.errorCode).toMatch(/^choice_review_required:/);
  });

  it('checks freshness even when every choice was prepared before the final publication step', async () => {
    const f = fixture();
    await expect((f.service as any).assertChoiceProfileTx(f.prisma, { ...f.plan, choicePreparation: {
      version: 'authored-context-two-alternatives-v1', preparedPartKeys: ['part-1'], profileBinding: null,
    } })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'STORY_PUBLICATION_CHOICE_SETTINGS_CHANGED' }) });
    await expect((f.service as any).assertChoiceProfileTx(f.prisma, { ...f.plan, choicePreparation: {
      version: 'authored-context-two-alternatives-v1', preparedPartKeys: ['part-1'], profileBinding: f.profile.binding,
    } })).resolves.toBeUndefined();
    expect(f.generate).not.toHaveBeenCalled();
  });

  it('preserves an already public source without regenerating a one-choice imported plan', async () => {
    const f = fixture();
    Object.assign(f.prisma, { storyWork: { findUnique: jest.fn().mockResolvedValue({ id: 'public-work', status: 'published' }) },
      storyRelease: {} });
    await expect((f.service as any).prepareApprovedChoices('operator-id', 'job-id')).resolves.toBeNull();
    expect(f.policy.forPlan).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.prisma.storyPublicationImportJob.updateMany).not.toHaveBeenCalled();
  });

  it('does not spend on a slug already occupied by another private draft', async () => {
    const f = fixture();
    Object.assign(f.prisma, { storyWork: { findUnique: jest.fn().mockResolvedValue({ id: 'private-work', status: 'draft' }) },
      storyRelease: {} });
    await expect((f.service as any).prepareApprovedChoices('operator-id', 'job-id')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_PUBLICATION_SOURCE_ALREADY_PREPARING' }),
    });
    expect(f.generate).not.toHaveBeenCalled();
  });

  it.each([true, false])('attaches a re-upload only when the saved job revision still matches: %s', async accepted => {
    const f = fixture();
    f.job.workId = null as never;
    const bytes = [Buffer.from('approved manuscript fixture'), Buffer.from('approved image instructions fixture')];
    const saved = { ...f.plan, choicePreparation: { version: 'authored-context-two-alternatives-v1',
      preparedPartKeys: ['part-1'], profileBinding: f.profile.binding } };
    f.prisma.storyPublicationImportJob.findUnique.mockReset()
      .mockResolvedValueOnce(f.job).mockResolvedValueOnce({ ...f.job,
        planSnapshot: (f.service as any).storedPlan(saved), updatedAt: new Date(1000) });
    f.prisma.storyPublicationImportJob.updateMany.mockResolvedValue({ count: accepted ? 1 : 0 });
    const chunks = jest.fn().mockResolvedValue({ count: 0 });
    Object.assign(f.prisma, { storyPublicationSourceChunk: { createMany: chunks } });
    jest.spyOn(f.service as any, 'detectStoryKey').mockReturnValue('monster');
    jest.spyOn(f.service as any, 'approvedPlan').mockReturnValue(f.plan);
    const action = f.service.publishApproved('operator-id', { storyKey: 'monster',
      finalManuscriptConfirmed: true, rightsConfirmed: true, publicReleaseConfirmed: true }, {
      manuscripts: bytes.map((buffer, index) => ({ buffer, size: buffer.length,
        originalname: `source-${index}.md`, fieldname: 'manuscripts', encoding: '7bit', mimetype: 'text/markdown' })),
    }, 'submission-id');
    if (accepted) {
      await expect(action).resolves.toMatchObject({ status: 'queued' });
      const call = f.prisma.storyPublicationImportJob.updateMany.mock.calls[0][0];
      expect(call.where).toMatchObject({ status: 'queued', workId: null, errorCode: null, updatedAt: new Date(1000) });
      const stored = (f.service as any).readStoredPlan(call.data.planSnapshot);
      expect(stored.submissionId).toBe('submission-id');
      expect(stored.choicePreparation.profileBinding).toEqual(f.profile.binding);
      expect(chunks).toHaveBeenCalledTimes(1);
    } else {
      await expect(action).rejects.toMatchObject({ response: expect.objectContaining({ code: 'STORY_CHOICE_PREPARATION_CONCURRENT_UPDATE' }) });
      expect(chunks).not.toHaveBeenCalled();
    }
    expect(f.generate).not.toHaveBeenCalled();
  });

  it('does not choose the newest prefix copy when more than one public source exists', async () => {
    const f = fixture();
    const findFirst = jest.fn();
    const findMany = jest.fn().mockResolvedValue([{ id: 'source-a' }, { id: 'source-b' }]);
    Object.assign(f.prisma, { storyWorkGenerationProfile: {}, storyWork: { findMany, findFirst } });
    await expect(f.service.publishedInheritorChoiceStatus()).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_PUBLICATION_SOURCE_SELECTION_REQUIRED' }),
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    expect(findFirst).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
  });

  it('keeps the response tied to the same work and release instead of following a newer public copy', async () => {
    const f = fixture();
    const findMany = jest.fn();
    const findFirst = jest.fn().mockResolvedValue({ id: 'source-a', activeReleaseId: 'changed-release' });
    Object.assign(f.prisma, { storyWorkGenerationProfile: {}, storyWork: { findMany, findFirst } });
    await expect(f.service.publishedInheritorChoiceStatus({ workId: 'source-a', releaseId: 'original-release' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STORY_PUBLICATION_CHOICE_SOURCE_CHANGED' }),
    });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'source-a' }) }));
    expect(findMany).not.toHaveBeenCalled();
  });
});
