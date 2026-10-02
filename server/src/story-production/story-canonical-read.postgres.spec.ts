import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { activationFixture } from './story-ai-activation.postgres-fixture';
import { StoryCanonicalReadService } from './story-canonical-read.service';
import { releaseChecksum } from './story-lifecycle.policy';
import { StoryProgressControlService } from './story-progress-control.service';
import { STORY_LOCALES, StoryLocale } from './story-production.policy';
import { appendStoryRoute, createStoryRouteRoot } from './story-route-identity.store';

// Operator setup only: verify this dedicated database is absent before creating
// it, apply all 99 migrations normally, generate Prisma, then run this spec alone.
// Never disable constraints/triggers or truncate the append-only route fixtures.
// Unpaired surrogates and NUL cannot be persisted in PostgreSQL JSONB; their
// validation belongs to unit specs, not simulated source rows in this suite.
const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
jest.setTimeout(30000);
const dedicatedUrl = 'postgresql://lumina_qa@127.0.0.1:55432/lumina_canonical_read_qa';
const sourceTexts: Record<StoryLocale, string> = {
  ko: ' \t\uD55C\uAE00 canonical read: the door opens.\r\n ',
  en: ' \tCafe\u0301 canonical read: the rocket \uD83D\uDE80 arrives.\r\n ',
  ja: ' \t\u65E5\u672C\u8A9E canonical read: the bell rings.\r\n ',
  'zh-Hans': ' \t\u7B80\u4F53 canonical read: the lantern glows.\r\n ',
  'zh-Hant': ' \t\u7E41\u9AD4 canonical read: the bridge opens.\r\n ',
};
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Preview = Awaited<ReturnType<StoryCanonicalReadService['preview']>>;

async function fixture(db: PrismaClient) {
  const f = await activationFixture(db, false);
  const work = await db.storyWork.update({ where: { id: f.work.id }, data: {
    slug: `synthetic-canonical-read-${randomUUID()}`, publishedAt: new Date(0),
    supportedLocales: [...STORY_LOCALES],
  } });
  const beat = await db.storyBeat.update({
    where: { sceneId_position: { sceneId: f.scene.id, position: 1 } },
    data: { beatType: 'paragraph', content: sourceTexts },
  });
  return { ...f, work, beat, progress: f.progresses[0] };
}

function confirmation(preview: Preview, locale: StoryLocale = 'ko', idempotencyKey: string = randomUUID()) {
  return { locale, expectedRevision: preview.expectedRevision,
    expectedScopeChecksum: preview.scopeChecksum, expectedSourceTextHash: preview.sourceTextHash,
    idempotencyKey, displayedAndRead: true };
}

function assertPrivate(value: unknown) {
  const forbidden = new Set(['sourceText', 'rawText', 'text', 'content', 'structuredBody',
    'manuscriptText', 'privateInput', 'memoryText', 'evidenceText', 'prompt', 'providerPayload']);
  function visit(item: unknown) {
    if (!item || typeof item !== 'object' || item instanceof Date) return;
    for (const [key, child] of Object.entries(item)) {
      expect(forbidden.has(key)).toBe(false);
      visit(child);
    }
  }
  visit(value);
  const serialized = JSON.stringify(value);
  for (const text of Object.values(sourceTexts)) {
    expect(serialized).not.toContain(JSON.stringify(text).slice(1, -1));
    expect(serialized).not.toContain(JSON.stringify(text.trim()).slice(1, -1));
  }
}

postgres('canonical read receipts on dedicated PostgreSQL', () => {
  let db: PrismaClient;
  let service: StoryCanonicalReadService;

  beforeAll(async () => {
    // Exact equality also rejects passwords, query options and alternate URLs.
    if (url !== dedicatedUrl) throw new Error(`Dedicated canonical-read QA database required: ${dedicatedUrl}`);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    service = new StoryCanonicalReadService(db as never);
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function state(f: Fixture) {
    const workId = f.work.id;
    const progressIds = f.progresses.map(progress => progress.id);
    const parts = await db.storyPart.findMany({ where: { workId }, orderBy: { id: 'asc' } });
    const scenes = await db.storyScene.findMany({ where: { partId: { in: parts.map(part => part.id) } }, orderBy: { id: 'asc' } });
    return {
      work: await db.storyWork.findUniqueOrThrow({ where: { id: workId } }), parts, scenes,
      beats: await db.storyBeat.findMany({ where: { sceneId: { in: scenes.map(scene => scene.id) } }, orderBy: { id: 'asc' } }),
      releases: await db.storyRelease.findMany({ where: { workId }, orderBy: { id: 'asc' } }),
      manuscripts: await db.storyManuscriptVersion.findMany({ where: { workId }, orderBy: { id: 'asc' } }),
      progresses: await db.storyReaderProgress.findMany({ where: { workId }, orderBy: { id: 'asc' } }),
      nodes: await db.storyProgressRouteNode.findMany({ where: { workId }, orderBy: { id: 'asc' } }),
      checkpoints: await db.storyProgressCheckpoint.findMany({ where: { progressId: { in: progressIds } }, orderBy: { id: 'asc' } }),
      choices: await db.storyChoiceEvent.findMany({ where: { progressId: { in: progressIds } }, orderBy: { id: 'asc' } }),
      resets: await db.storyResetCommand.findMany({ where: { progressId: { in: progressIds } }, orderBy: { id: 'asc' } }),
      resetQuotas: await db.storyResetQuotaBucket.findMany({ where: { workId }, orderBy: { id: 'asc' } }),
      allowances: await db.storyAiAllowanceBucket.findMany({ where: { workId }, orderBy: { id: 'asc' } }),
      continuations: await db.storyAiContinuation.findMany({ where: { workId }, orderBy: { id: 'asc' } }),
      generatedScenes: await db.storyAiGeneratedScene.findMany({ where: { workId }, orderBy: { id: 'asc' } }),
      usage: await db.storyAiUsageLedger.findMany({ where: { workId }, orderBy: { id: 'asc' } }),
      memory: await db.storyMemoryRecord.findMany({ where: { workId }, orderBy: { id: 'asc' } }),
      quality: await db.storyQualityEvent.findMany({ where: { workId }, orderBy: { id: 'asc' } }),
      entitlements: await db.userEntitlement.findMany({ where: {
        userId: { in: [f.reader.id, f.second.id] },
      }, orderBy: { id: 'asc' } }),
      receipts: await db.storyCanonicalReadReceipt.findMany({ where: { workId }, orderBy: { id: 'asc' } }),
      audits: await db.auditEvent.findMany({ where: {
        actorUserId: { in: [f.owner.id, f.reader.id, f.second.id] },
      }, orderBy: { id: 'asc' } }),
    };
  }

  async function rejectsUnchanged(f: Fixture, request: () => Promise<unknown>, expected: new (...args: never[]) => Error) {
    const before = await state(f);
    await expect(request()).rejects.toBeInstanceOf(expected);
    expect(await state(f)).toEqual(before);
  }

  const previewFor = (f: Fixture, locale: StoryLocale = 'ko') =>
    service.preview(f.reader.id, f.progress.id, f.beat.id, { locale });
  const confirmFor = (f: Fixture, body: ReturnType<typeof confirmation>) =>
    service.confirm(f.reader.id, f.progress.id, f.beat.id, body);

  it.each(STORY_LOCALES)('preview in %s is inert; confirm writes one private receipt and user audit; replay is inert', async locale => {
    const f = await fixture(db);
    const before = await state(f);
    const preview = await previewFor(f, locale);
    const node = await db.storyProgressRouteNode.findUniqueOrThrow({ where: { id: f.progress.routeNodeId! } });
    const sourceChecksum = releaseChecksum({ contract: 'story-canonical-interaction-source-v1',
      workId: f.work.id, ownerUserId: f.owner.id, releaseId: f.release.id, releaseChecksum: f.release.checksum,
      manuscriptVersionId: f.manuscript.id, manuscriptHash: f.manuscript.contentHash,
      partId: f.part.id, partPosition: f.part.position, sceneId: f.scene.id,
      sceneKey: f.scene.sceneKey, scenePosition: f.scene.position, beatId: f.beat.id,
      beatPosition: f.beat.position, beatType: f.beat.beatType, sourceSceneKey: f.beat.sourceSceneKey,
      locale, sourceText: sourceTexts[locale] });
    const identity = { userId: f.reader.id, progressId: f.progress.id, workId: f.work.id,
      ownerUserId: f.owner.id, releaseId: f.release.id, releaseChecksum: f.release.checksum,
      manuscriptVersionId: f.manuscript.id, manuscriptHash: f.manuscript.contentHash,
      partId: f.part.id, sceneId: f.scene.id, beatId: f.beat.id, routeNodeId: node.id,
      routeHash: node.routeHash, storyVersion: f.progress.storyVersion,
      progressRevision: f.progress.progressRevision, actNumber: f.part.actNumber,
      beatPosition: f.beat.position, locale, sourceChecksum, sourceTextHash: sha256(sourceTexts[locale]) };
    expect(preview.identity).toEqual(identity);
    expect(preview).toMatchObject({ sourceChecksum, sourceTextHash: identity.sourceTextHash,
      scopeChecksum: releaseChecksum({ contract: 'story-canonical-read-scope-v1', ...identity, displayedAndRead: true }),
      expectedRevision: f.progress.progressRevision, confirmationRecorded: false, readerMemoryApplied: false });
    expect(preview.sourceTextHash).not.toBe(sha256(sourceTexts[locale].trim()));
    if (locale === 'en') expect(preview.sourceTextHash).not.toBe(sha256(sourceTexts.en.normalize('NFC')));
    assertPrivate(preview);
    expect(await state(f)).toEqual(before);

    const body = confirmation(preview, locale);
    const confirmed = await confirmFor(f, body);
    expect(confirmed).toMatchObject({ receiptId: expect.any(String), sourceChecksum,
      sourceTextHash: identity.sourceTextHash, scopeChecksum: preview.scopeChecksum, locale,
      routeNodeId: node.id, invalidatedAt: null, confirmedAt: expect.any(String),
      readerMemoryApplied: false, idempotentReplay: false });
    const after = await state(f);
    expect(after.receipts).toHaveLength(1);
    const row = after.receipts[0];
    expect(row).toMatchObject({ ...identity, id: confirmed.receiptId, scopeChecksum: preview.scopeChecksum,
      idempotencyKey: body.idempotencyKey, invalidatedAt: null, resetCommandId: null });
    expect(row.confirmedAt.toISOString()).toBe(confirmed.confirmedAt);
    expect(after.audits).toHaveLength(before.audits.length + 1);
    const audit = after.audits.find(item => !before.audits.some(previous => previous.id === item.id))!;
    expect(audit).toMatchObject({ actorUserId: f.reader.id, actorType: 'user',
      action: 'story_canonical_read.confirmed', targetType: 'story_canonical_read_receipt', targetId: confirmed.receiptId });
    expect(after).toEqual({ ...before, receipts: [row], audits: after.audits });
    assertPrivate({ confirmed, row, audit });

    expect(await confirmFor(f, body)).toEqual({ ...confirmed, idempotentReplay: true });
    expect(await service.confirm(f.reader.id.toUpperCase(), f.progress.id.toUpperCase(), f.beat.id.toUpperCase(),
      { ...body, idempotencyKey: body.idempotencyKey.toUpperCase() })).toEqual({ ...confirmed, idempotentReplay: true });
    expect(await previewFor(f, locale)).toEqual(preview);
    expect(await state(f)).toEqual(after);
  });

  it.each([
    ['missing Korean locale', { en: sourceTexts.en }],
    ['nested Korean object', { ko: { text: sourceTexts.ko }, en: sourceTexts.en }],
    ['Korean array', { ko: [sourceTexts.ko], en: sourceTexts.en }],
    ['empty Korean string', { ko: '', en: sourceTexts.en }],
  ] as const)('rejects %s without borrowing another language or writing a receipt', async (_label, content) => {
    const f = await fixture(db);
    const preview = await previewFor(f);
    await db.storyBeat.update({ where: { id: f.beat.id }, data: { content: content as Prisma.InputJsonValue } });
    await rejectsUnchanged(f, () => previewFor(f), ConflictException);
    await rejectsUnchanged(f, () => confirmFor(f, confirmation(preview)), ConflictException);
    expect(await db.storyCanonicalReadReceipt.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it.each(['source', 'source metadata', 'part position', 'scene metadata', 'beat position',
    'release', 'release version', 'active release', 'manuscript', 'manuscript version',
    'current route', 'current revision', 'story version'] as const)
  ('rejects a stale %s pin without any service writes', async changed => {
    const f = await fixture(db);
    const preview = await previewFor(f);
    switch (changed) {
      case 'source':
        await db.storyBeat.update({ where: { id: f.beat.id }, data: { content: { ...sourceTexts, ko: `${sourceTexts.ko}Changed.` } } });
        break;
      case 'source metadata':
        await db.storyBeat.update({ where: { id: f.beat.id }, data: { beatType: 'dialogue', sourceSceneKey: 'changed-source',
          visualManifest: { sceneKey: 'changed-source' } } });
        break;
      case 'part position':
        await db.storyPart.update({ where: { id: f.part.id }, data: { position: 2 } });
        break;
      case 'scene metadata':
        await db.storyScene.update({ where: { id: f.scene.id }, data: { sceneKey: 'changed-scene', position: 2 } });
        break;
      case 'beat position':
        await db.storyBeat.update({ where: { id: f.beat.id }, data: { position: 2 } });
        break;
      case 'release':
        await db.storyRelease.update({ where: { id: f.release.id }, data: { checksum: 'c'.repeat(64) } });
        break;
      case 'release version':
        await db.storyRelease.update({ where: { id: f.release.id }, data: { version: 2 } });
        break;
      case 'active release': {
        const release = await db.storyRelease.create({ data: { workId: f.work.id, version: 2,
          status: 'active', manuscriptVersionId: f.manuscript.id, checksum: 'e'.repeat(64),
          branchGraphSnapshot: {}, endingSetSnapshot: {}, sceneAssetManifest: {},
          localizedDisplaySnapshot: {}, createdByUserId: f.owner.id } });
        await db.storyWork.update({ where: { id: f.work.id }, data: { activeReleaseId: release.id } });
        break;
      }
      case 'manuscript':
        await db.storyManuscriptVersion.update({ where: { id: f.manuscript.id }, data: { contentHash: 'd'.repeat(64) } });
        break;
      case 'manuscript version': {
        const manuscript = await db.storyManuscriptVersion.create({ data: { workId: f.work.id,
          ownerUserId: f.owner.id, version: 2, locale: 'ko', contentHash: 'f'.repeat(64), structuredBody: {} } });
        await db.storyRelease.update({ where: { id: f.release.id }, data: { manuscriptVersionId: manuscript.id } });
        break;
      }
      case 'current route': {
        const routeNodeId = await createStoryRouteRoot(db, f.progress, f.scene.id, f.part.actNumber);
        await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { routeNodeId } });
        break;
      }
      case 'current revision':
        await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { progressRevision: { increment: 1 } } });
        break;
      case 'story version':
        await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { storyVersion: { increment: 1 } } });
        break;
    }
    await rejectsUnchanged(f, () => confirmFor(f, confirmation(preview)), ConflictException);
    expect(await db.storyCanonicalReadReceipt.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('a route for another current scene is not evidence for the requested canonical beat', async () => {
    const f = await fixture(db);
    const body = confirmation(await previewFor(f));
    const scene = await db.storyScene.create({ data: { partId: f.part.id, sceneKey: 'different-target',
      position: 2, status: 'published', title: {}, visualManifest: {} } });
    const beat = await db.storyBeat.create({ data: { sceneId: scene.id, position: 1,
      beatType: 'paragraph', content: sourceTexts } });
    await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { currentSceneId: scene.id } });
    await rejectsUnchanged(f, () => service.preview(f.reader.id, f.progress.id, beat.id, { locale: 'ko' }), ConflictException);
    await rejectsUnchanged(f, () => service.confirm(f.reader.id, f.progress.id, beat.id, body), ConflictException);
    expect(await db.storyCanonicalReadReceipt.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it.each(['work slug', 'work cover', 'scene visual', 'current act'] as const)
  ('rejects unsafe or mismatched %s metadata without writes', async changed => {
    const f = await fixture(db);
    const body = confirmation(await previewFor(f));
    let error: typeof ConflictException | typeof NotFoundException = ConflictException;
    if (changed === 'work slug') {
      await db.storyWork.update({ where: { id: f.work.id }, data: { slug: `fixture-canonical-read-${randomUUID()}` } });
    } else if (changed === 'work cover') {
      await db.storyWork.update({ where: { id: f.work.id }, data: { coverManifest: { publicAssetPath: '/fixtures/cover.webp' } } });
    } else if (changed === 'scene visual') {
      await db.storyScene.update({ where: { id: f.scene.id }, data: { visualManifest: { publicAssetPath: '/fixtures/scene.webp' } } });
      error = NotFoundException;
    } else {
      await db.storyReaderProgress.update({ where: { id: f.progress.id }, data: { currentAct: 2 } });
      error = NotFoundException;
    }
    await rejectsUnchanged(f, () => previewFor(f), error);
    await rejectsUnchanged(f, () => confirmFor(f, body), error);
  });

  it.each(['work', 'part'] as const)('paid %s source requires the exact reader entitlement', async scope => {
    const f = await fixture(db);
    const other = await fixture(db);
    const freeBody = confirmation(await previewFor(f));
    if (scope === 'work') await db.storyWork.update({ where: { id: f.work.id }, data: { priceLumina: 10 } });
    else await db.storyPart.update({ where: { id: f.part.id }, data: { priceLumina: 10 } });
    // Normal migrations currently admit story_work, not story_part/story_season.
    // A valid whole-work entitlement also covers a paid part of that exact work.
    const referenceId = f.work.id;
    const wrongScopeId = other.work.id;
    const entitlementType = 'story_work';
    const referenceType = 'story_work';
    await db.userEntitlement.createMany({ data: [
      { userId: f.second.id, entitlementType, referenceType, referenceId, startsAt: new Date(0) },
      { userId: f.reader.id, entitlementType, referenceType, referenceId: wrongScopeId, startsAt: new Date(0) },
    ] });
    await rejectsUnchanged(f, () => previewFor(f), ForbiddenException);
    await rejectsUnchanged(f, () => confirmFor(f, freeBody), ForbiddenException);
    const entitlement = await db.userEntitlement.create({ data: { userId: f.reader.id,
      entitlementType, referenceType, referenceId, startsAt: new Date(0), expiresAt: new Date(1) } });
    await rejectsUnchanged(f, () => previewFor(f), ForbiddenException);
    await rejectsUnchanged(f, () => confirmFor(f, freeBody), ForbiddenException);
    await db.userEntitlement.update({ where: { id: entitlement.id }, data: { expiresAt: null, revokedAt: new Date() } });
    await rejectsUnchanged(f, () => confirmFor(f, freeBody), ForbiddenException);
    await db.userEntitlement.update({ where: { id: entitlement.id }, data: { revokedAt: null,
      startsAt: new Date(Date.now() + 3600000) } });
    await rejectsUnchanged(f, () => confirmFor(f, freeBody), ForbiddenException);
    await db.userEntitlement.update({ where: { id: entitlement.id }, data: { startsAt: new Date(0) } });
    const before = await state(f);
    expect(await previewFor(f)).toMatchObject({ sourceTextHash: freeBody.expectedSourceTextHash });
    expect(await state(f)).toEqual(before);
    expect(await confirmFor(f, freeBody)).toMatchObject({ idempotentReplay: false, readerMemoryApplied: false });
    const after = await state(f);
    expect(after.receipts).toHaveLength(1);
    expect(after.audits).toHaveLength(before.audits.length + 1);
    expect(after).toEqual({ ...before, receipts: after.receipts, audits: after.audits });
  });

  it('rejects another user, work or noncurrent scene before revealing source or inserting receipts', async () => {
    const f = await fixture(db);
    const other = await fixture(db);
    const preview = await previewFor(f);
    const body = confirmation(preview);
    const siblingScene = await db.storyScene.create({ data: { partId: f.part.id,
      sceneKey: 'unvisited-scene', position: 2, status: 'published', title: {} } });
    const siblingBeat = await db.storyBeat.create({ data: { sceneId: siblingScene.id,
      position: 1, beatType: 'paragraph', content: sourceTexts } });
    for (const [userId, beatId] of [[f.second.id, f.beat.id], [f.reader.id, other.beat.id],
      [f.reader.id, siblingBeat.id]]) {
      await rejectsUnchanged(f, () => service.preview(userId, f.progress.id, beatId, { locale: 'ko' }), NotFoundException);
      await rejectsUnchanged(f, () => service.confirm(userId, f.progress.id, beatId, body), NotFoundException);
    }
    expect(await db.storyCanonicalReadReceipt.count({ where: { workId: { in: [f.work.id, other.work.id] } } })).toBe(0);
  });

  it('rejects false acknowledgement, wrong hashes, stale expected revision and non-UUID keys without writes', async () => {
    const f = await fixture(db);
    const body = confirmation(await previewFor(f));
    await rejectsUnchanged(f, () => confirmFor(f, { ...body, displayedAndRead: false }), BadRequestException);
    await rejectsUnchanged(f, () => confirmFor(f, { ...body, idempotencyKey: 'not-a-uuid' }), BadRequestException);
    await rejectsUnchanged(f, () => confirmFor(f, { ...body, expectedSourceTextHash: '0'.repeat(64) }), ConflictException);
    await rejectsUnchanged(f, () => confirmFor(f, { ...body, expectedScopeChecksum: '0'.repeat(64) }), ConflictException);
    await rejectsUnchanged(f, () => confirmFor(f, { ...body, expectedRevision: body.expectedRevision + 1 }), ConflictException);
    expect(await db.storyCanonicalReadReceipt.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('same key with a different body conflicts; the key cannot replay another beat or reader receipt', async () => {
    const f = await fixture(db);
    const body = confirmation(await previewFor(f));
    const first = await confirmFor(f, body);
    const en = confirmation(await previewFor(f, 'en'), 'en', body.idempotencyKey);
    await rejectsUnchanged(f, () => confirmFor(f, en), ConflictException);
    await rejectsUnchanged(f, () => confirmFor(f, { ...body, expectedRevision: body.expectedRevision + 1 }), ConflictException);
    await rejectsUnchanged(f, () => confirmFor(f, { ...body, expectedSourceTextHash: '0'.repeat(64) }), ConflictException);
    const nextBeat = await db.storyBeat.create({ data: { sceneId: f.scene.id, position: 2,
      beatType: 'paragraph', content: sourceTexts } });
    const nextPreview = await service.preview(f.reader.id, f.progress.id, nextBeat.id, { locale: 'ko' });
    await rejectsUnchanged(f, () => service.confirm(f.reader.id, f.progress.id, nextBeat.id,
      confirmation(nextPreview, 'ko', body.idempotencyKey)), ConflictException);
    await rejectsUnchanged(f, () => service.confirm(f.second.id, f.progress.id, f.beat.id, body), NotFoundException);

    const second = f.progresses[1];
    const secondPreview = await service.preview(f.second.id, second.id, f.beat.id, { locale: 'ko' });
    expect(secondPreview.scopeChecksum).not.toBe(body.expectedScopeChecksum);
    await rejectsUnchanged(f, () => service.confirm(f.second.id, second.id, f.beat.id, body), ConflictException);
    const secondReceipt = await service.confirm(f.second.id, second.id, f.beat.id,
      confirmation(secondPreview, 'ko', body.idempotencyKey));
    expect(secondReceipt.receiptId).not.toBe(first.receiptId);
    expect(await db.storyCanonicalReadReceipt.count({ where: { workId: f.work.id } })).toBe(2);
  });

  it('two parallel confirmations insert only one row; the loser replays or reports a conflict', async () => {
    const f = await fixture(db);
    const body = confirmation(await previewFor(f));
    const before = await state(f);
    const results = await Promise.allSettled([confirmFor(f, body),
      new StoryCanonicalReadService(db as never).confirm(f.reader.id, f.progress.id, f.beat.id, body)]);
    const successes = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    expect(successes.length).toBeGreaterThanOrEqual(1);
    expect(successes.filter(result => !result.idempotentReplay)).toHaveLength(1);
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(ConflictException);
    const after = await state(f);
    expect(after.receipts).toHaveLength(1);
    expect(after.audits).toHaveLength(before.audits.length + 1);
    expect(new Set(successes.map(result => result.receiptId)).size).toBe(1);
    expect(after).toEqual({ ...before, receipts: after.receipts, audits: after.audits });
    expect(await confirmFor(f, body)).toMatchObject({ receiptId: after.receipts[0].id, idempotentReplay: true });
    expect(await state(f)).toEqual(after);
  });

  it('an actual audit CHECK failure rolls back the inserted receipt and permits the same-key retry', async () => {
    const f = await fixture(db);
    const body = confirmation(await previewFor(f));
    const before = await state(f);
    const observed: string[] = [];
    const client = new Proxy(db, { get(target, key) {
      if (key === '$transaction') return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number }) =>
        target.$transaction(tx => callback(new Proxy(tx, { get(transaction, field) {
          if (field === 'auditEvent') return new Proxy(transaction.auditEvent, { get(audit, method) {
            if (method === 'create') return async (args: Prisma.AuditEventCreateArgs) => {
              const row = await transaction.storyCanonicalReadReceipt.findFirstOrThrow({
                where: { progressId: f.progress.id, idempotencyKey: body.idempotencyKey },
              });
              observed.push(row.id);
              // Execute the real INSERT with an actor forbidden by the DB CHECK.
              return audit.create({ ...args, data: { ...args.data, actorType: 'creator' } });
            };
            const value = Reflect.get(audit, method, audit);
            return typeof value === 'function' ? value.bind(audit) : value;
          } });
          const value = Reflect.get(transaction, field, transaction);
          return typeof value === 'function' ? value.bind(transaction) : value;
        } })), options);
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const broken = new StoryCanonicalReadService(client as never);
    await expect(broken.confirm(f.reader.id, f.progress.id, f.beat.id, body))
      .rejects.toThrow(/audit_events_actor_type_check/);
    expect(observed).toHaveLength(1);
    expect(await state(f)).toEqual(before);
    const retried = await confirmFor(f, body);
    expect(retried).toMatchObject({ idempotentReplay: false });
    expect(await db.storyCanonicalReadReceipt.count({ where: { workId: f.work.id } })).toBe(1);
  });

  it('normal receipt constraints enforce reader, route, release, manuscript and source ownership', async () => {
    const f = await fixture(db);
    const other = await fixture(db);
    const receipt = await confirmFor(f, confirmation(await previewFor(f)));
    const row = await db.storyCanonicalReadReceipt.findUniqueOrThrow({ where: { id: receipt.receiptId } });
    const { id: _id, ...data } = row;
    const before = await state(f);
    const invalidPins: Array<Partial<Prisma.StoryCanonicalReadReceiptUncheckedCreateInput>> = [
      { userId: f.second.id }, { ownerUserId: f.reader.id },
      { routeNodeId: f.progresses[1].routeNodeId! }, { routeNodeId: other.progress.routeNodeId! },
      { releaseId: other.release.id }, { manuscriptVersionId: other.manuscript.id },
      { partId: other.part.id }, { sceneId: other.scene.id }, { beatId: other.beat.id },
    ];
    for (const pin of invalidPins) {
      await expect(db.storyCanonicalReadReceipt.create({ data: { ...data, ...pin, idempotencyKey: randomUUID() } }))
        .rejects.toMatchObject({ code: 'P2003' });
      expect(await state(f)).toEqual(before);
    }
    await expect(db.storyCanonicalReadReceipt.create({ data: { ...data,
      idempotencyKey: randomUUID(), invalidatedAt: new Date() } }))
      .rejects.toThrow(/ck_story_canonical_read_invalidation/);
    expect(await state(f)).toEqual(before);
    assertPrivate(row);
  });

  it('the real receipt trigger forbids every identity/source/timestamp/key edit and deletion', async () => {
    const f = await fixture(db);
    const other = await fixture(db);
    const receipt = await confirmFor(f, confirmation(await previewFor(f)));
    const row = await db.storyCanonicalReadReceipt.findUniqueOrThrow({ where: { id: receipt.receiptId } });
    const before = await state(f);
    const edits: Prisma.StoryCanonicalReadReceiptUncheckedUpdateInput[] = [
      { id: randomUUID() }, { userId: f.second.id }, { progressId: f.progresses[1].id },
      { workId: other.work.id }, { ownerUserId: other.owner.id }, { releaseId: other.release.id },
      { releaseChecksum: 'c'.repeat(64) }, { manuscriptVersionId: other.manuscript.id },
      { manuscriptHash: 'd'.repeat(64) }, { partId: other.part.id }, { sceneId: other.scene.id },
      { beatId: other.beat.id }, { beatPosition: 2 }, { actNumber: 2 }, { locale: 'en' },
      { sourceChecksum: '0'.repeat(64) }, { sourceTextHash: '1'.repeat(64) },
      { routeNodeId: other.progress.routeNodeId! }, { routeHash: '2'.repeat(64) },
      { storyVersion: 2 }, { progressRevision: 2 }, { scopeChecksum: '3'.repeat(64) },
      { idempotencyKey: randomUUID() }, { confirmedAt: new Date(row.confirmedAt.getTime() + 1000) },
    ];
    for (const data of edits) {
      await expect(db.storyCanonicalReadReceipt.update({ where: { id: row.id }, data }))
        .rejects.toThrow(/Story canonical read source is immutable/);
      expect(await db.storyCanonicalReadReceipt.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
    }
    await expect(db.storyCanonicalReadReceipt.delete({ where: { id: row.id } }))
      .rejects.toThrow(/Story canonical read history is append-only/);
    expect(await state(f)).toEqual(before);
  });

  it('real act/full resets invalidate only their receipt scope, reject old pins and leave reset replay inert', async () => {
    const f = await fixture(db);
    const controls = new StoryProgressControlService(db as never, undefined as never, f.economics);
    const firstBody = confirmation(await previewFor(f));
    const first = await confirmFor(f, firstBody);
    const second = f.progresses[1];
    const otherPreview = await service.preview(f.second.id, second.id, f.beat.id, { locale: 'ko' });
    const otherReceipt = await service.confirm(f.second.id, second.id, f.beat.id, confirmation(otherPreview));
    const part = await db.storyPart.create({ data: { workId: f.work.id, position: 2, actNumber: 2,
      status: 'published', publishedAt: new Date(0), title: {} } });
    const scene = await db.storyScene.create({ data: { partId: part.id, sceneKey: 'act-two-entry',
      position: 1, status: 'published', title: {} } });
    const beat = await db.storyBeat.create({ data: { sceneId: scene.id, position: 1,
      beatType: 'paragraph', content: sourceTexts } });
    const choice = await db.storyChoice.update({ where: { id: f.choice.id },
      data: { routeKind: 'branch', targetSceneId: scene.id } });
    await db.$transaction(async tx => {
      const progress = await tx.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progress.id } });
      const routeNodeId = await appendStoryRoute(tx, progress, { kind: 'canonical', sceneId: f.scene.id,
        choiceId: choice.id, targetSceneId: scene.id, endingKey: null }, part.actNumber);
      await tx.storyReaderProgress.update({ where: { id: progress.id }, data: {
        routeNodeId, currentSceneId: scene.id, checkpointSceneId: scene.id,
        currentAct: 2, currentBeatPosition: 0, progressRevision: { increment: 1 },
      } });
    });
    const preview = await service.preview(f.reader.id, f.progress.id, beat.id, { locale: 'ko' });
    const oldBody = confirmation(preview);
    const actReceipt = await service.confirm(f.reader.id, f.progress.id, beat.id, oldBody);
    const laterPart = await db.storyPart.create({ data: { workId: f.work.id, position: 3, actNumber: 3,
      status: 'published', publishedAt: new Date(0), title: {} } });
    const laterScene = await db.storyScene.create({ data: { partId: laterPart.id, sceneKey: 'act-three-entry',
      position: 1, status: 'published', title: {} } });
    const laterBeat = await db.storyBeat.create({ data: { sceneId: laterScene.id, position: 1,
      beatType: 'paragraph', content: sourceTexts } });
    const laterChoice = await db.storyChoice.create({ data: { sceneId: scene.id, choiceKey: 'act-three',
      position: 1, label: {}, routeKind: 'branch', targetSceneId: laterScene.id } });
    await db.$transaction(async tx => {
      const progress = await tx.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progress.id } });
      const routeNodeId = await appendStoryRoute(tx, progress, { kind: 'canonical', sceneId: scene.id,
        choiceId: laterChoice.id, targetSceneId: laterScene.id, endingKey: null }, laterPart.actNumber);
      await tx.storyReaderProgress.update({ where: { id: progress.id }, data: {
        routeNodeId, currentSceneId: laterScene.id, checkpointSceneId: laterScene.id,
        currentAct: 3, currentBeatPosition: 0, progressRevision: { increment: 1 },
      } });
    });
    const laterPreview = await service.preview(f.reader.id, f.progress.id, laterBeat.id, { locale: 'ko' });
    const laterReceipt = await service.confirm(f.reader.id, f.progress.id, laterBeat.id, confirmation(laterPreview));
    const actBody = { target: 'act' as const, actNumber: 2, locale: 'ko', expectedRevision: laterPreview.expectedRevision };
    const actKey = randomUUID();
    const actReset = await controls.executeReset(f.reader.id, f.progress.id, actBody, actKey);
    const invalidated = await db.storyCanonicalReadReceipt.findUniqueOrThrow({ where: { id: actReceipt.receiptId } });
    expect(invalidated).toMatchObject({ actNumber: 2, invalidatedAt: expect.any(Date), resetCommandId: actReset.commandId });
    const laterInvalidated = await db.storyCanonicalReadReceipt.findUniqueOrThrow({ where: { id: laterReceipt.receiptId } });
    expect(laterInvalidated).toMatchObject({ actNumber: 3, invalidatedAt: expect.any(Date), resetCommandId: actReset.commandId });
    for (const receiptId of [first.receiptId, otherReceipt.receiptId]) {
      expect(await db.storyCanonicalReadReceipt.findUniqueOrThrow({ where: { id: receiptId } }))
        .toMatchObject({ invalidatedAt: null, resetCommandId: null });
    }
    const beforeTampering = await state(f);
    const edits: Prisma.StoryCanonicalReadReceiptUncheckedUpdateInput[] = [
      { invalidatedAt: null, resetCommandId: null },
      { invalidatedAt: new Date(invalidated.invalidatedAt!.getTime() + 1000) },
      { resetCommandId: randomUUID() },
    ];
    for (const data of edits) {
      await expect(db.storyCanonicalReadReceipt.update({ where: { id: invalidated.id }, data }))
        .rejects.toThrow(/Story canonical read source is immutable/);
    }
    await expect(db.storyCanonicalReadReceipt.update({ where: { id: otherReceipt.receiptId },
      data: { invalidatedAt: new Date(), resetCommandId: actReset.commandId } }))
      .rejects.toMatchObject({ code: 'P2003' });
    expect(await state(f)).toEqual(beforeTampering);
    await rejectsUnchanged(f, () => service.confirm(f.reader.id, f.progress.id, beat.id,
      { ...oldBody, idempotencyKey: randomUUID() }), ConflictException);
    await rejectsUnchanged(f, () => service.confirm(f.reader.id, f.progress.id, beat.id, oldBody), ConflictException);
    const afterAct = await state(f);
    expect(await controls.executeReset(f.reader.id, f.progress.id, actBody, actKey))
      .toEqual({ ...actReset, idempotentReplay: true });
    expect(await state(f)).toEqual(afterAct);

    const freshPreview = await service.preview(f.reader.id, f.progress.id, beat.id, { locale: 'ko' });
    expect(freshPreview.identity.routeNodeId).toBe(preview.identity.routeNodeId);
    expect(freshPreview.sourceTextHash).toBe(preview.sourceTextHash);
    expect(freshPreview.scopeChecksum).not.toBe(preview.scopeChecksum);
    const freshBody = confirmation(freshPreview);
    const freshReceipt = await service.confirm(f.reader.id, f.progress.id, beat.id, freshBody);
    const fullBody = { target: 'full' as const, locale: 'ko', expectedRevision: freshPreview.expectedRevision };
    const fullKey = randomUUID();
    const fullReset = await controls.executeReset(f.reader.id, f.progress.id, fullBody, fullKey);
    for (const receiptId of [first.receiptId, freshReceipt.receiptId]) {
      expect(await db.storyCanonicalReadReceipt.findUniqueOrThrow({ where: { id: receiptId } }))
        .toMatchObject({ invalidatedAt: expect.any(Date), resetCommandId: fullReset.commandId });
    }
    expect(await db.storyCanonicalReadReceipt.findUniqueOrThrow({ where: { id: actReceipt.receiptId } })).toEqual(invalidated);
    expect(await db.storyCanonicalReadReceipt.findUniqueOrThrow({ where: { id: laterReceipt.receiptId } })).toEqual(laterInvalidated);
    expect(await db.storyCanonicalReadReceipt.findUniqueOrThrow({ where: { id: otherReceipt.receiptId } }))
      .toMatchObject({ invalidatedAt: null, resetCommandId: null });
    await rejectsUnchanged(f, () => confirmFor(f, { ...firstBody, idempotencyKey: randomUUID() }), ConflictException);
    await rejectsUnchanged(f, () => confirmFor(f, firstBody), ConflictException);
    await rejectsUnchanged(f, () => service.confirm(f.reader.id, f.progress.id, beat.id, freshBody), NotFoundException);
    const afterFull = await state(f);
    expect(await controls.executeReset(f.reader.id, f.progress.id, fullBody, fullKey))
      .toEqual({ ...fullReset, idempotentReplay: true });
    expect(await state(f)).toEqual(afterFull);
    const current = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progress.id } });
    expect(current).toMatchObject({ currentSceneId: f.scene.id, currentBeatPosition: 0, currentAct: 1 });
    expect(current.progressRevision).toBe(freshPreview.expectedRevision + 1);
    expect(current.routeNodeId).not.toBe(freshPreview.identity.routeNodeId);
    expect(afterFull.continuations).toEqual([]);
    expect(afterFull.usage).toEqual([]);
    expect(afterFull.memory).toEqual([]);
  });
});
