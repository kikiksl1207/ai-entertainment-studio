import { releaseChecksum } from './story-lifecycle.policy';
import { resolveCompanyPublishedSource } from './story-company-source.policy';

const owner = '00000000-0000-4000-8000-000000000401';
const workId = '00000000-0000-4000-8000-000000000402';
const manuscriptId = '00000000-0000-4000-8000-000000000403';
const releaseId = '00000000-0000-4000-8000-000000000404';
const other = '00000000-0000-4000-8000-000000000405';
function fixture() {
  const work = { id: workId, ownerUserId: owner, authorDisplayName: '\uB8E8\uBBF8\uB098', fixtureSource: false,
    status: 'published', publishedAt: new Date(), activeReleaseId: releaseId };
  const source = { id: manuscriptId, contentHash: 'a'.repeat(64) };
  const manuscript = { ...source, workId, ownerUserId: owner };
  const release = { id: releaseId, workId, manuscriptVersionId: manuscriptId, status: 'active',
    branchGraphSnapshot: {}, endingSetSnapshot: {}, sceneAssetManifest: {}, localizedDisplaySnapshot: {}, checksum: '' };
  release.checksum = releaseChecksum({ manuscriptVersionId: manuscriptId, branchGraphSnapshot: {},
    endingSetSnapshot: {}, sceneAssetManifest: {}, localizedDisplaySnapshot: {} });
  const job = { id: other, actorUserId: owner, workId, releaseId, status: 'published', errorCode: null as string | null };
  const audit = { id: other, actorUserId: owner, actorType: 'admin', action: 'story_upload.public_beta_published',
    afterData: { workId, releaseId } };
  const db = { storyWork: { findFirst: jest.fn().mockResolvedValue(work) },
    storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue(manuscript) },
    storyRelease: { findFirst: jest.fn().mockResolvedValue(release) },
    storyPublicationImportJob: { findFirst: jest.fn().mockResolvedValue(job) },
    auditEvent: { findFirst: jest.fn().mockResolvedValue(audit) } };
  return { work, source, manuscript, release, job, audit, db };
}
const resolve = (f: ReturnType<typeof fixture>) => resolveCompanyPublishedSource(f.db as never, owner, workId, f.source, releaseId);
describe('published company authority for delegated body approval', () => {
  it('binds an exact native published receipt to the current checksum', async () => {
    const f = fixture();
    expect(await resolve(f)).toMatchObject({ companyPublishedReleaseId: releaseId,
      companyReleaseChecksum: f.release.checksum, companyPublicationJobId: other, companyPublicationAuditId: null });
    expect(f.db.auditEvent.findFirst).not.toHaveBeenCalled();
  });
  it.each(['story_upload.public_beta_published', 'story_approved_source.public_beta_published'])('accepts native admin %s only', async action => {
    const f = fixture(); f.db.storyPublicationImportJob.findFirst.mockResolvedValue(null); f.audit.action = action;
    expect(await resolve(f)).toMatchObject({ companyPublicationJobId: null, companyPublicationAuditId: other });
  });
  const invalid: Array<[string, (f: ReturnType<typeof fixture>) => void]> = [
    ['no native authority', f => { f.db.storyPublicationImportJob.findFirst.mockResolvedValue(null); f.db.auditEvent.findFirst.mockResolvedValue(null); }],
    ['name-only source', f => { f.db.storyPublicationImportJob.findFirst.mockResolvedValue(null); f.audit.action = 'story_upload.created'; }],
    ['external credit', f => { f.work.authorDisplayName = 'External'; }],
    ['fixture work', f => { f.work.fixtureSource = true; }],
    ['wrong work owner', f => { f.work.ownerUserId = other; }],
    ['old release', f => { f.work.activeReleaseId = other; }],
    ['unpublished', f => { f.work.status = 'draft'; }],
    ['changed manuscript', f => { f.manuscript.id = other; }],
    ['changed hash', f => { f.manuscript.contentHash = 'b'.repeat(64); }],
    ['changed release checksum', f => { f.release.checksum = 'c'.repeat(64); }],
    ['wrong receipt owner', f => { f.job.actorUserId = other; }],
    ['wrong receipt work', f => { f.job.workId = other; }],
    ['wrong receipt release', f => { f.job.releaseId = other; }],
    ['pending receipt', f => { f.job.status = 'awaiting_author_review'; }],
    ['failed receipt', f => { f.job.errorCode = 'FAILED'; }],
    ['wrong audit owner', f => { f.db.storyPublicationImportJob.findFirst.mockResolvedValue(null); f.audit.actorUserId = other; }],
    ['nonadmin audit', f => { f.db.storyPublicationImportJob.findFirst.mockResolvedValue(null); f.audit.actorType = 'user'; }],
    ['old audit work', f => { f.db.storyPublicationImportJob.findFirst.mockResolvedValue(null); f.audit.afterData.workId = other; }],
    ['old audit release', f => { f.db.storyPublicationImportJob.findFirst.mockResolvedValue(null); f.audit.afterData.releaseId = other; }],
  ];
  it.each(invalid)('fails closed: %s', async (_name, mutate) => { const f = fixture(); mutate(f); expect(await resolve(f)).toBeNull(); });
});
