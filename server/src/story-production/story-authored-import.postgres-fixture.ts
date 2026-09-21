import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { authoredImportFixture } from './story-authored-import.test-fixture';
import { StoryAuthoredImportService } from './story-authored-import.service';
import { authoredHash } from './story-authored-source-map.policy';
import { storedManuscriptBody } from './story-manuscript-file.policy';
import { releaseChecksum } from './story-lifecycle.policy';

export function assertAuthoredImportTestDatabase(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432' ||
      url.username !== 'lumina_qa' || url.pathname !== '/lumina_norse_release_qa' ||
      url.search !== '' || url.hash !== '') {
    throw new Error('Dedicated authored-import loopback test database required');
  }
}

export async function createAuthoredImportPgFixture(db: PrismaClient,
  source = authoredImportFixture()) {
  try {
    const owner = await db.user.create({ data: {} });
    const work = await db.storyWork.create({ data: { ownerUserId: owner.id, slug: `local-import-${randomUUID()}`,
      title: { ko: 'Private authored import QA' }, summary: {}, status: 'draft', fixtureSource: true,
      priceLumina: 37 } }); // Synthetic QA price, never a real book price decision.
    const manuscript = await db.storyManuscriptVersion.create({ data: { workId: work.id, ownerUserId: owner.id,
      version: 1, locale: 'ko', contentHash: source.manuscript.contentHash,
      structuredBody: storedManuscriptBody(source.manuscript) as Prisma.InputJsonValue } });
    const snapshot = { manuscriptVersionId: manuscript.id, branchGraphSnapshot: {}, endingSetSnapshot: {},
      sceneAssetManifest: {}, localizedDisplaySnapshot: {} };
    const release = await db.storyRelease.create({ data: { workId: work.id, version: 1, ...snapshot,
      checksum: releaseChecksum(snapshot), createdByUserId: owner.id, validationSummary: { ready: true } } });
    const body = { manuscriptVersionId: manuscript.id, releaseId: release.id,
      expectedReleaseChecksum: release.checksum, expectedManuscriptHash: manuscript.contentHash,
      expectedPackageSha256: source.root.packageSha256, expectedSourceMapSha256: authoredHash(source.buffer),
      expectedRevision: work.releaseRevision, endingKey: source.ending.endingKey,
      endingEvidenceSegment: source.ending.evidenceSegment, apply: true };
    const service = new StoryAuthoredImportService(db as never);
    const key = randomUUID();
    const apply = (idempotencyKey = key) => service.execute(owner.id, work.id, body, source.buffer, idempotencyKey);
    return { source, owner, work, manuscript, release, body, service, apply, key };
  } catch (error) {
    // Fixture setup can contain actual private text; never print a Prisma payload.
    const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'unknown';
    throw new Error(`Private authored fixture setup failed (${code})`);
  }
}
