import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { authoredImportFixture } from './story-authored-import.test-fixture';
import { StoryAuthoredImportService, assertAuthoredImportPublicationTx } from './story-authored-import.service';
import { authoredHash } from './story-authored-source-map.policy';
import { storedManuscriptBody } from './story-manuscript-file.policy';
import { releaseChecksum } from './story-lifecycle.policy';

describe('private authored initial import service', () => {
  function fixture() {
    const source = authoredImportFixture();
    const ownerUserId = randomUUID();
    const work = { id: randomUUID(), ownerUserId, releaseRevision: 1, status: 'draft', activeReleaseId: null,
      customChoiceEnabled: false, publishedAt: null, fixtureSource: true, priceLumina: new Prisma.Decimal(37) };
    const manuscript = { id: randomUUID(), workId: work.id, ownerUserId, locale: 'ko',
      contentHash: source.manuscript.contentHash, structuredBody: storedManuscriptBody(source.manuscript) };
    const snapshot = { manuscriptVersionId: manuscript.id, branchGraphSnapshot: {}, endingSetSnapshot: {},
      sceneAssetManifest: {}, localizedDisplaySnapshot: {} };
    const release = { id: randomUUID(), workId: work.id, ...snapshot, status: 'candidate',
      checksum: releaseChecksum(snapshot), validationSummary: { ready: true } };
    const prisma = { storyWork: { findFirst: jest.fn().mockResolvedValue(work) },
      storyManuscriptVersion: { findFirst: jest.fn().mockResolvedValue(manuscript) },
      storyRelease: { findFirst: jest.fn().mockResolvedValue(release) }, $transaction: jest.fn() };
    const body = { manuscriptVersionId: manuscript.id, releaseId: release.id,
      expectedReleaseChecksum: release.checksum, expectedManuscriptHash: manuscript.contentHash,
      expectedPackageSha256: source.root.packageSha256, expectedSourceMapSha256: authoredHash(source.buffer),
      expectedRevision: 1, endingKey: source.ending.endingKey, endingEvidenceSegment: source.ending.evidenceSegment };
    return { source, work, ownerUserId, manuscript, release, prisma, body,
      service: new StoryAuthoredImportService(prisma as never) };
  }

  it('dry-runs without any transaction, fake approvals, price writes, or prose in its result', async () => {
    const f = fixture();
    const result = await f.service.execute(f.ownerUserId, f.work.id, f.body, f.source.buffer);
    expect(result).toMatchObject({ mode: 'dry_run', applyExecuted: false, publishReady: false,
      counts: { parts: 3, sourceScenes: 6, choices: 9 }, requiredNextAction: 'review_binding_contract_required' });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|Synthetic narrative|sourcePath|ownerUserId|priceLumina/);
  });

  it('checks owner before parsing or fetching private manuscript content', async () => {
    const f = fixture();
    f.prisma.storyWork.findFirst.mockResolvedValue(null);
    await expect(f.service.execute(randomUUID(), f.work.id, f.body, Buffer.from('invalid'))).rejects.toMatchObject({ status: 404 });
    expect(f.prisma.storyManuscriptVersion.findFirst).not.toHaveBeenCalled();
  });

  it('labels changed declared package provenance honestly and never turns it into approval', async () => {
    const f = fixture();
    f.source.root.packageSha256 = 'e'.repeat(64);
    const buffer = Buffer.from(JSON.stringify(f.source.root));
    const result = await f.service.execute(f.ownerUserId, f.work.id, { ...f.body,
      expectedPackageSha256: 'e'.repeat(64), expectedSourceMapSha256: authoredHash(buffer) }, buffer);
    expect(result).toMatchObject({ publishReady: false, requiredNextAction: 'review_binding_contract_required',
      identityEvidence: { declared: { packageSha256: 'e'.repeat(64), originalPackageBytesReceived: false },
        submittedInventory: { originalFilesystemVerifiedByServer: false },
        serverVerified: { compactByteSha256: authoredHash(buffer), orderedStoredManuscriptHash: f.manuscript.contentHash } },
      readiness: { ending: 'owner_intent_not_approval', rights: 'not_granted_by_import', price: 'not_approved_by_import' } });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects stored prose mutations despite unchanged stored/expected hashes and caller ready', async () => {
    const f = fixture();
    (f.manuscript.structuredBody.parts[0].paragraphs[1]).text = 'PRIVATE_CHANGED_STORED_SOURCE';
    await expect(f.service.execute(f.ownerUserId, f.work.id, f.body, f.source.buffer))
      .rejects.toMatchObject({ response: { code: 'AUTHORED_MANUSCRIPT_CONTENT_CHANGED' } });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('recomputes the release snapshot and does not accept a stored checksum string alone', async () => {
    const f = fixture();
    f.release.endingSetSnapshot = { changed: true };
    await expect(f.service.execute(f.ownerUserId, f.work.id, f.body, f.source.buffer))
      .rejects.toMatchObject({ response: { code: 'AUTHORED_RELEASE_CONTENT_CHANGED' } });
  });

  it('requires an explicit idempotency key for apply', async () => {
    const f = fixture();
    await expect(f.service.execute(f.ownerUserId, f.work.id, { ...f.body, apply: true }, f.source.buffer))
      .rejects.toMatchObject({ response: { code: 'AUTHORED_IDEMPOTENCY_KEY_REQUIRED' } });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps unrelated legacy publication behavior untouched when there is no import receipt', async () => {
    const tx = { storyAuthoredImport: { findUnique: jest.fn().mockResolvedValue(null) } };
    await expect(assertAuthoredImportPublicationTx(tx as never, randomUUID(), randomUUID())).resolves.toBeUndefined();
  });
});
