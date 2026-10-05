import { brotliCompressSync } from 'zlib';
import { resolveCompanyPrivateIntakeSource } from './story-company-source.policy';

const owner = '00000000-0000-4000-8000-000000000301';
const workId = '00000000-0000-4000-8000-000000000302';
const manuscriptId = '00000000-0000-4000-8000-000000000303';
const jobId = '00000000-0000-4000-8000-000000000304';
const auditId = '00000000-0000-4000-8000-000000000305';
const other = '00000000-0000-4000-8000-000000000306';
const contentHash = 'a'.repeat(64);
const sourceBindingSha256 = 'b'.repeat(64);

function fixture() {
  const plan = { storyKey: 'monster', slug: 'company-private-source', sourceBindingSha256,
    writerIntakeWorkflow: 'writer_review_before_choices_v1', manuscript: { contentHash }, parts: [{}], prompts: [] };
  const work = { id: workId, ownerUserId: owner, slug: plan.slug, authorDisplayName: '루미나',
    fixtureSource: false, status: 'draft', activeReleaseId: null as string | null, publishedAt: null as Date | null,
    coverManifest: { privateIntake: { contract: 'publication-writer-intake-v1', jobId, sourceBindingSha256,
      manuscriptHash: contentHash } } };
  const manuscript = { id: manuscriptId, ownerUserId: owner, workId, contentHash };
  const job = { id: jobId, actorUserId: owner, workId, status: 'awaiting_author_review',
    releaseId: null as string | null, errorCode: null as string | null,
    storyKey: plan.storyKey, sourceBindingSha256, planSnapshot: plan as unknown };
  const audit = { id: auditId, actorUserId: owner, actorType: 'admin', action: 'story_publication.private_writer_intake',
    targetType: 'story_work', targetId: workId, metadata: { jobId, manuscriptVersionId: manuscriptId,
      manuscriptHash: contentHash, sourceBindingSha256, partCount: 1,
      analysisStarted: false, choicesGenerated: false, published: false } };
  const db = { storyWork: { findFirst: jest.fn().mockResolvedValue(work) },
    storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue(manuscript) },
    storyPublicationImportJob: { findFirst: jest.fn().mockResolvedValue(job) },
    auditEvent: { findFirst: jest.fn().mockResolvedValue(audit) } };
  return { plan, work, manuscript, job, audit, db };
}

async function resolve(f: ReturnType<typeof fixture>) {
  return resolveCompanyPrivateIntakeSource(f.db as never, owner, workId, { id: manuscriptId, contentHash });
}

describe('company private intake source policy', () => {
  it.each([false, true])('resolves only exact trusted bindings (compressed=%s)', async compressed => {
    const f = fixture();
    if (compressed) f.job.planSnapshot = { storageContract: 'story-publication-plan-br-base64-v1',
      data: brotliCompressSync(Buffer.from(JSON.stringify(f.plan))).toString('base64') };

    expect(await resolve(f)).toEqual({ companyPrivateIntakeJobId: jobId, companyPrivateIntakeAuditId: auditId,
      companySourceBindingSha256: sourceBindingSha256, companyManuscriptVersionId: manuscriptId });
    expect(f.db.storyPublicationImportJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: jobId, workId, actorUserId: owner, status: 'awaiting_author_review', releaseId: null, errorCode: null },
    }));
    expect(f.db.auditEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      actorUserId: owner, actorType: 'admin', action: 'story_publication.private_writer_intake',
      targetType: 'story_work', targetId: workId, metadata: { path: ['jobId'], equals: jobId },
    } }));
  });

  const invalid: Array<[string, (f: ReturnType<typeof fixture>) => void]> = [
    ['missing work', f => { f.db.storyWork.findFirst.mockResolvedValue(null); }],
    ['wrong work', f => { f.work.id = other; }],
    ['wrong owner', f => { f.work.ownerUserId = other; }],
    ['external author', f => { f.work.authorDisplayName = 'External author'; }],
    ['fixture', f => { f.work.fixtureSource = true; }],
    ['published work', f => { f.work.status = 'published'; }],
    ['active release', f => { f.work.activeReleaseId = other; }],
    ['prior publication', f => { f.work.publishedAt = new Date(); }],
    ['display credit only', f => { f.db.storyWork.findFirst.mockResolvedValue({ ...f.work, coverManifest: {} }); }],
    ['wrong intake contract', f => { f.work.coverManifest.privateIntake.contract = 'external-import'; }],
    ['invalid source hash', f => { f.work.coverManifest.privateIntake.sourceBindingSha256 = 'invalid'; }],
    ['wrong cover manuscript', f => { f.work.coverManifest.privateIntake.manuscriptHash = 'c'.repeat(64); }],
    ['missing latest manuscript', f => { f.db.storyManuscriptVersion.findFirst.mockResolvedValue(null); }],
    ['new manuscript with same hash', f => { f.manuscript.id = other; }],
    ['wrong manuscript owner', f => { f.manuscript.ownerUserId = other; }],
    ['wrong manuscript work', f => { f.manuscript.workId = other; }],
    ['new manuscript hash', f => { f.manuscript.contentHash = 'c'.repeat(64); }],
    ['missing job', f => { f.db.storyPublicationImportJob.findFirst.mockResolvedValue(null); }],
    ['wrong job id', f => { f.job.id = other; }],
    ['wrong job owner', f => { f.job.actorUserId = other; }],
    ['wrong job work', f => { f.job.workId = other; }],
    ['non-review job', f => { f.job.status = 'published'; }],
    ['job release exists', f => { f.job.releaseId = other; }],
    ['failed job', f => { f.job.errorCode = 'FAILED'; }],
    ['wrong job source', f => { f.job.sourceBindingSha256 = 'c'.repeat(64); }],
    ['wrong workflow', f => { f.plan.writerIntakeWorkflow = 'external-import'; }],
    ['wrong plan story', f => { f.plan.storyKey = 'norse'; }],
    ['wrong plan slug', f => { f.plan.slug = 'other'; }],
    ['wrong plan source', f => { f.plan.sourceBindingSha256 = 'c'.repeat(64); }],
    ['wrong plan manuscript', f => { f.plan.manuscript.contentHash = 'c'.repeat(64); }],
    ['empty plan parts', f => { f.plan.parts = []; }],
    ['missing audit', f => { f.db.auditEvent.findFirst.mockResolvedValue(null); }],
    ['wrong audit actor', f => { f.audit.actorUserId = other; }],
    ['non-admin audit', f => { f.audit.actorType = 'user'; }],
    ['wrong audit action', f => { f.audit.action = 'story_upload.created'; }],
    ['wrong audit target type', f => { f.audit.targetType = 'story_manuscript'; }],
    ['wrong audit work', f => { f.audit.targetId = other; }],
    ['wrong audit job', f => { f.audit.metadata.jobId = other; }],
    ['old audit manuscript', f => { f.audit.metadata.manuscriptVersionId = other; }],
    ['old audit hash', f => { f.audit.metadata.manuscriptHash = 'c'.repeat(64); }],
    ['wrong audit source', f => { f.audit.metadata.sourceBindingSha256 = 'c'.repeat(64); }],
    ['wrong part count', f => { f.audit.metadata.partCount = 2; }],
    ['not an unpublished intake', f => { f.audit.metadata.published = true; }],
  ];
  it.each(invalid)('rejects %s', async (_name, change) => {
    const f = fixture();
    change(f);
    expect(await resolve(f)).toBeNull();
  });

  it.each([null, [], { storageContract: 'unknown', data: 'bad' },
    { storageContract: 'story-publication-plan-br-base64-v1', data: 'bad' }])(
    'keeps an invalid stored plan reviewable (%j)', async plan => {
      const f = fixture();
      f.job.planSnapshot = plan;
      expect(await resolve(f)).toBeNull();
      expect(f.db.auditEvent.findFirst).not.toHaveBeenCalled();
    });
});
