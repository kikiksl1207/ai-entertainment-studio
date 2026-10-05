import { brotliCompressSync } from 'zlib';
import { releaseChecksum } from './story-lifecycle.policy';
import { resolveCompanyPrivateIntakeSource, resolveCompanyPrivateSubmissionSource } from './story-company-source.policy';

const owner = '00000000-0000-4000-8000-000000000801';
const workId = '00000000-0000-4000-8000-000000000802';
const manuscriptId = '00000000-0000-4000-8000-000000000803';
const jobId = '00000000-0000-4000-8000-000000000804';
const intakeAuditId = '00000000-0000-4000-8000-000000000805';
const releaseId = '00000000-0000-4000-8000-000000000806';
const linkAuditId = '00000000-0000-4000-8000-000000000807';
const transitionId = '00000000-0000-4000-8000-000000000808';
const other = '00000000-0000-4000-8000-000000000899';
const contentHash = 'a'.repeat(64);
const sourceBindingSha256 = 'b'.repeat(64);
const changedHash = 'c'.repeat(64);
const expectedProof = { companyPrivateIntakeJobId: jobId, companyPrivateIntakeAuditId: intakeAuditId,
  companySourceBindingSha256: sourceBindingSha256, companyManuscriptVersionId: manuscriptId };

function fixture() {
  const plan = { storyKey: 'monster', slug: 'synthetic-company-source-lifecycle', sourceBindingSha256,
    writerIntakeWorkflow: 'writer_review_before_choices_v1', manuscript: { contentHash }, parts: [{}, {}], prompts: [] };
  const work = { id: workId, ownerUserId: owner, slug: plan.slug, authorDisplayName: '\uB8E8\uBBF8\uB098',
    fixtureSource: false, status: 'draft', activeReleaseId: null as string | null, publishedAt: null as Date | null,
    coverManifest: { privateIntake: { contract: 'publication-writer-intake-v1', jobId, sourceBindingSha256,
      manuscriptHash: contentHash } } };
  const manuscript = { id: manuscriptId, ownerUserId: owner, workId, contentHash };
  const snapshot = { manuscriptVersionId: manuscriptId,
    branchGraphSnapshot: { contract: 'studio-linear-v1', parts: [{ partKey: 'part-1' }, { partKey: 'part-2' }] },
    endingSetSnapshot: { authorMain: 'author_main' }, sceneAssetManifest: { contract: 'studio-linear-v1' },
    localizedDisplaySnapshot: { locale: 'ko' } };
  const release = { id: releaseId, workId, status: 'active', ...snapshot, checksum: releaseChecksum(snapshot) };
  const job = { id: jobId, actorUserId: owner, workId, status: 'awaiting_author_review',
    releaseId: null as string | null, errorCode: null as string | null, batchCursor: 0,
    storyKey: plan.storyKey, sourceBindingSha256, planSnapshot: plan as unknown };
  const intakeAudit = { id: intakeAuditId, actorUserId: owner, actorType: 'admin',
    action: 'story_publication.private_writer_intake', targetType: 'story_work', targetId: workId,
    metadata: { jobId, manuscriptVersionId: manuscriptId, manuscriptHash: contentHash, sourceBindingSha256,
      partCount: 2, analysisStarted: false, choicesGenerated: false, published: false } };
  const linkAudit = { id: linkAuditId, actorUserId: owner, actorType: 'admin',
    action: 'story_publication.writer_flow_linked', targetType: 'story_work', targetId: workId,
    metadata: { jobId, releaseId, manuscriptHash: contentHash, sourceBindingSha256,
      releaseChecksum: release.checksum, publicationTransitionId: transitionId, providerCalled: false } };
  const transition = { id: transitionId, workId, releaseId, toStatus: 'published' };
  const available = { intakeAudit: true, linkAudit: true, transition: true };
  const transitionRead = jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
    if (!available.transition) return null;
    return Object.entries(where).every(([key, value]) =>
      (transition as Record<string, unknown>)[key] === value) ? transition : null;
  });
  const db = {
    storyWork: { findFirst: jest.fn().mockResolvedValue(work) },
    storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue(manuscript) },
    storyPublicationImportJob: { findFirst: jest.fn().mockResolvedValue(job) },
    storyRelease: { findFirst: jest.fn().mockResolvedValue(release) },
    storyPublicationTransition: { findFirst: transitionRead },
    auditEvent: { findFirst: jest.fn(async ({ where }: { where: { action: string } }) => {
      if (where.action === 'story_publication.private_writer_intake') return available.intakeAudit ? intakeAudit : null;
      if (where.action === 'story_publication.writer_flow_linked') return available.linkAudit ? linkAudit : null;
      return null;
    }) },
  };
  return { plan, work, manuscript, release, job, intakeAudit, linkAudit, transition, available, db };
}

type Fixture = ReturnType<typeof fixture>;

function published(f: Fixture, linked = false) {
  f.work.status = 'published';
  f.work.activeReleaseId = releaseId;
  f.work.publishedAt = new Date('2026-10-05T00:00:00Z');
  if (linked) {
    f.job.status = 'published';
    f.job.releaseId = releaseId;
    f.job.batchCursor = f.intakeAudit.metadata.partCount;
    // Prisma.DbNull is returned as null when reading the JSON column.
    f.job.planSnapshot = null;
  }
  return f;
}

function resolve(f: Fixture) {
  return resolveCompanyPrivateSubmissionSource(f.db as never, owner, workId, { id: manuscriptId, contentHash });
}

function creation(f: Fixture) {
  return resolveCompanyPrivateIntakeSource(f.db as never, owner, workId, { id: manuscriptId, contentHash });
}

function rows(f: Fixture) {
  return JSON.stringify({ work: f.work, manuscript: f.manuscript, release: f.release, job: f.job,
    intakeAudit: f.intakeAudit, linkAudit: f.linkAudit, transition: f.transition });
}

describe('company final source lifecycle (actual policy, synthetic read-only delegates)', () => {
  it.each([false, true])('preserves the original proof through publication and plan cleanup, compressed=%s', async compressed => {
    const f = fixture();
    if (compressed) f.job.planSnapshot = { storageContract: 'story-publication-plan-br-base64-v1',
      data: brotliCompressSync(Buffer.from(JSON.stringify(f.plan))).toString('base64') };
    let before = rows(f);
    await expect(creation(f)).resolves.toEqual(expectedProof);
    await expect(resolve(f)).resolves.toEqual(expectedProof);
    expect(rows(f)).toBe(before);

    published(f);
    f.available.linkAudit = false;
    f.available.transition = false;
    before = rows(f);
    await expect(resolve(f)).resolves.toEqual(expectedProof);
    expect(rows(f)).toBe(before);
    expect(f.db.storyPublicationTransition.findFirst).not.toHaveBeenCalled();
    expect(f.db.auditEvent.findFirst.mock.calls.some(([query]) =>
      query.where.action === 'story_publication.writer_flow_linked')).toBe(false);

    published(f, true);
    f.available.linkAudit = true;
    f.available.transition = true;
    before = rows(f);
    await expect(resolve(f)).resolves.toEqual(expectedProof);
    expect(f.job.planSnapshot).toBeNull();
    expect(rows(f)).toBe(before);
    expect(f.db.auditEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      actorUserId: owner, actorType: 'admin', action: 'story_publication.writer_flow_linked',
      targetType: 'story_work', targetId: workId,
    }) }));
    expect(f.db.storyPublicationTransition.findFirst).toHaveBeenCalled();
  });

  it.each(['intake_received', 'reviewing', 'release_ready'])('consumes the original proof in private stage %s', async status => {
    const f = fixture();
    f.work.status = status;
    const before = rows(f);
    await expect(resolve(f)).resolves.toEqual(expectedProof);
    expect(rows(f)).toBe(before);
    expect(f.db.storyRelease.findFirst).not.toHaveBeenCalled();
  });

  const invalid: Array<[string, (f: Fixture) => void]> = [
    ['missing active release', f => { f.work.activeReleaseId = null; }],
    ['old active release', f => { f.work.activeReleaseId = other; }],
    ['missing publication time', f => { f.work.publishedAt = null; }],
    ['external author name', f => { f.work.authorDisplayName = 'External author'; }],
    ['fixture work', f => { f.work.fixtureSource = true; }],
    ['foreign owner', f => { f.work.ownerUserId = other; }],
    ['new manuscript with the same hash', f => { f.manuscript.id = other; }],
    ['changed manuscript hash', f => { f.manuscript.contentHash = changedHash; }],
    ['missing current release', f => { f.db.storyRelease.findFirst.mockResolvedValue(null); }],
    ['retired current release', f => { f.release.status = 'retired'; }],
    ['current release bound to another manuscript', f => { f.release.manuscriptVersionId = other; }],
    ['current release checksum mismatch', f => { f.release.checksum = changedHash; }],
    ['current release snapshot changed', f => { f.release.branchGraphSnapshot.parts[0].partKey = 'changed'; }],
    ['cover source changed', f => { f.work.coverManifest.privateIntake.sourceBindingSha256 = changedHash; }],
    ['job source changed', f => { f.job.sourceBindingSha256 = changedHash; }],
    ['job linked to an old release', f => { f.job.releaseId = other; }],
    ['failed native job', f => { f.job.errorCode = 'FAILED'; }],
    ['missing native intake audit', f => { f.available.intakeAudit = false; }],
    ['native audit manuscript changed', f => { f.intakeAudit.metadata.manuscriptVersionId = other; }],
    ['native audit source changed', f => { f.intakeAudit.metadata.sourceBindingSha256 = changedHash; }],
    ['zero completed parts', f => { f.job.batchCursor = 0; }],
    ['incomplete completed parts', f => { f.job.batchCursor = 1; }],
    ['over-completed parts', f => { f.job.batchCursor = 3; }],
    ['fractional completed parts', f => { f.job.batchCursor = 2.5; }],
    ['zero native audit parts', f => { f.intakeAudit.metadata.partCount = 0; f.job.batchCursor = 0; }],
    ['negative native audit parts', f => { f.intakeAudit.metadata.partCount = -1; f.job.batchCursor = -1; }],
    ['fractional native audit parts', f => { f.intakeAudit.metadata.partCount = 2.5; f.job.batchCursor = 2.5; }],
    ['missing writer-flow link', f => { f.available.linkAudit = false; }],
    ['foreign link actor', f => { f.linkAudit.actorUserId = other; }],
    ['non-admin link actor', f => { f.linkAudit.actorType = 'user'; }],
    ['wrong link action', f => { f.linkAudit.action = 'story_publication.transition'; }],
    ['wrong link target type', f => { f.linkAudit.targetType = 'story_scene'; }],
    ['old link target work', f => { f.linkAudit.targetId = other; }],
    ['missing publication transition', f => { f.available.transition = false; }],
    ['old transition id', f => { f.transition.id = other; }],
    ['foreign transition work', f => { f.transition.workId = other; }],
    ['old transition release', f => { f.transition.releaseId = other; }],
    ['non-publication transition', f => { f.transition.toStatus = 'reviewing'; }],
  ];
  it.each(invalid)('rejects completed publication with %s', async (_name, change) => {
    const f = published(fixture(), true);
    change(f);
    const before = rows(f);
    await expect(resolve(f)).resolves.toBeNull();
    expect(rows(f)).toBe(before);
  });

  const linkFields = ['jobId', 'releaseId', 'manuscriptHash', 'sourceBindingSha256', 'releaseChecksum',
    'publicationTransitionId', 'providerCalled'] as const;
  it.each(linkFields)('rejects mismatched writer-flow link metadata %s', async field => {
    const f = published(fixture(), true);
    Object.assign(f.linkAudit.metadata, { [field]: field === 'providerCalled' ? true : 'wrong' });
    await expect(resolve(f)).resolves.toBeNull();
  });
  it.each(linkFields)('rejects missing writer-flow link metadata %s', async field => {
    const f = published(fixture(), true);
    Reflect.deleteProperty(f.linkAudit.metadata, field);
    await expect(resolve(f)).resolves.toBeNull();
  });

  it.each([{}, [], { storageContract: 'unknown', data: 'bad' },
    { storageContract: 'story-publication-plan-br-base64-v1', data: 'bad' }])
  ('does not treat a corrupt non-null completed plan as trusted cleanup (%j)', async plan => {
    const f = published(fixture(), true);
    f.job.planSnapshot = plan;
    await expect(resolve(f)).resolves.toBeNull();
  });

  it('does not accept a cleared pending plan by borrowing a completed link receipt', async () => {
    const f = published(fixture());
    f.job.planSnapshot = null;
    await expect(resolve(f)).resolves.toBeNull();
  });

  it('requires the completed link even when a completed job retains a valid plan', async () => {
    const f = published(fixture(), true);
    f.job.planSnapshot = f.plan;
    f.available.linkAudit = false;
    await expect(resolve(f)).resolves.toBeNull();
  });

  it.each(['intake_received', 'reviewing', 'release_ready', 'published', 'revision_requested', 'sale_suspended', 'archived'])
  ('keeps the creation helper draft-only in stage %s', async status => {
    const f = status === 'published' ? published(fixture(), true) : fixture();
    f.work.status = status;
    await expect(creation(f)).resolves.toBeNull();
    expect(f.db.storyPublicationImportJob.findFirst).not.toHaveBeenCalled();
  });

  it.each(['revision_requested', 'sale_suspended', 'archived'])('does not consume a receipt in forbidden stage %s', async status => {
    const f = published(fixture(), true);
    f.work.status = status;
    await expect(resolve(f)).resolves.toBeNull();
    expect(f.db.storyPublicationImportJob.findFirst).not.toHaveBeenCalled();
  });
});
