import 'reflect-metadata';
import { BadRequestException, HttpException, ParseUUIDPipe, RequestMethod, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, HEADERS_METADATA, METHOD_METADATA, PARAMTYPES_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoryInteractionCatalogQueryDto } from './dto/story-interaction-approval.dto';
import { StoryInteractionApprovalController } from './story-interaction-approval.controller';
import { StoryInteractionApprovalService } from './story-interaction-approval.service';
import { STORY_LOCALES } from './story-production.policy';

const owner = '11111111-1111-4111-8111-111111111111';
const workId = '22222222-2222-4222-8222-222222222222';
const releaseId = '33333333-3333-4333-8333-333333333333';
const manuscriptId = '44444444-4444-4444-8444-444444444444';
const partId = '55555555-5555-4555-8555-555555555555';
const sceneId = '66666666-6666-4666-8666-666666666666';
const other = '77777777-7777-4777-8777-777777777777';
const checksum = 'a'.repeat(64);
const manuscriptHash = 'b'.repeat(64);
const beatId = (index: number) => `88888888-8888-4888-8888-${String(index).padStart(12, '0')}`;
type Row = { beatId: string; sceneId: string; partId: string; partPosition: number;
  scenePosition: number; beatPosition: number; beatType: string; sourceText: unknown };

function matches(row: object, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value);
}

// Delegate/SQL projections are mocked. Real ordering and PostgreSQL read-only behavior are tested separately.
function fixture() {
  const work = { id: workId, ownerUserId: owner, status: 'published', fixtureSource: false,
    activeReleaseId: releaseId as string | null, defaultLocale: 'ko' };
  const release = { id: releaseId, workId, status: 'active', checksum, manuscriptVersionId: manuscriptId,
    branchGraphSnapshot: { private: 'RELEASE_BLOB' } };
  const manuscript = { id: manuscriptId, workId, ownerUserId: owner, contentHash: manuscriptHash,
    structuredBody: { private: 'MANUSCRIPT_BODY' } };
  const state = { cursor: null as Row | null, rows: Array.from({ length: 9 }, (_, index): Row => ({
    beatId: beatId(index + 1), sceneId, partId, partPosition: 1, scenePosition: 2,
    beatPosition: index + 1, beatType: ['paragraph', 'narration', 'dialogue'][index % 3], sourceText: `Exact source ${index + 1}.`,
  })) };
  const tx = {
    $executeRaw: jest.fn(async (_sql: Prisma.Sql) => 0),
    $queryRaw: jest.fn(async (sql: Prisma.Sql): Promise<unknown[]> =>
      sql.sql.includes('AS "sourceText"') ? state.rows : state.cursor ? [state.cursor] : []),
    storyWork: { findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => matches(work, where) ? work : null) },
    storyRelease: { findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => matches(release, where) ? release : null) },
    storyManuscriptVersion: { findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => matches(manuscript, where) ? manuscript : null) },
    storyInteractionApproval: { create: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
    auditEvent: { create: jest.fn() },
    storyAiContinuation: { create: jest.fn(), findMany: jest.fn() },
    storyAiGeneratedScene: { findMany: jest.fn() },
    storyReaderProgress: { updateMany: jest.fn() },
    storyReaderActorMemory: { upsert: jest.fn() },
    asset: { create: jest.fn() },
  };
  const prisma = { $transaction: jest.fn(async (run: (db: typeof tx) => Promise<unknown>, _options?: unknown) => run(tx)) };
  const service = new StoryInteractionApprovalService(prisma as never);
  const catalog = (query: StoryInteractionCatalogQueryDto = { locale: 'en' }) => service.catalog(owner, workId, query);
  return { work, release, manuscript, state, tx, prisma, service, catalog };
}

function noWrites(f: ReturnType<typeof fixture>) {
  for (const model of [f.tx.storyInteractionApproval, f.tx.auditEvent, f.tx.storyAiContinuation,
    f.tx.storyAiGeneratedScene, f.tx.storyReaderProgress, f.tx.storyReaderActorMemory, f.tx.asset]) {
    for (const fn of Object.values(model)) expect(fn).not.toHaveBeenCalled();
  }
}

async function rejection(promise: Promise<unknown>, status: number, code: string) {
  try { await promise; } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
    expect((error as HttpException).getResponse()).toEqual({ code });
    return;
  }
  throw new Error(`Expected rejection: ${code}`);
}

function scoped(sql: Prisma.Sql) {
  expect(sql.sql).toContain('p.work_id =');
  expect(sql.values).toContain(workId);
  for (const alias of ['p', 's']) {
    expect(sql.sql).toContain(`${alias}.status = 'published'`);
    expect(sql.sql).toContain(`${alias}.fixture_source = false`);
  }
  expect(sql.sql).toContain("b.beat_type IN ('paragraph', 'narration', 'dialogue')");
  expect(sql.sql).not.toMatch(/story_ai|generated|structured_body|visual_manifest/i);
}

describe('canonical interaction catalog service', () => {
  it('returns the exact v1 contract, eight items and the last returned beat as cursor', async () => {
    const f = fixture();
    const result = await f.catalog();
    expect(result).toEqual({ contract: 'story-canonical-interaction-catalog-v1', ownerUserId: owner,
      workId, releaseId, releaseChecksum: checksum, manuscriptVersionId: manuscriptId,
      manuscriptHash, locale: 'en', items: f.state.rows.slice(0, 8).map(row => ({ ...row, sourceAvailable: true })),
      nextAfterBeatId: beatId(8) });
    expect(JSON.stringify(result)).not.toContain('Exact source 9.');
    const sql = f.tx.$queryRaw.mock.calls[0][0];
    scoped(sql);
    expect(sql.sql).toContain('ORDER BY p.position, s.position, b.position, b.id LIMIT 9');
    expect(sql.values).toEqual(['en', 'en', workId]);
    noWrites(f);
  });

  it('sets read-only before the first read and uses RepeatableRead with metadata-only identity selects', async () => {
    const f = fixture();
    await f.catalog();
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(f.tx.$executeRaw.mock.calls[0][0].sql).toBe('SET TRANSACTION READ ONLY');
    expect(f.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(f.tx.storyWork.findFirst.mock.invocationCallOrder[0]);
    expect(f.tx.storyWork.findFirst).toHaveBeenCalledWith({ where: { id: workId, ownerUserId: owner,
      status: 'published', fixtureSource: false } });
    expect(f.tx.storyRelease.findFirst).toHaveBeenCalledWith({ where: { id: releaseId, workId, status: 'active' },
      select: { id: true, checksum: true, manuscriptVersionId: true } });
    expect(f.tx.storyManuscriptVersion.findFirst).toHaveBeenCalledWith({ where: { id: manuscriptId, workId, ownerUserId: owner },
      select: { id: true, contentHash: true } });
    noWrites(f);
  });

  it('validates the scoped cursor without content before querying the next narrative tuple', async () => {
    const f = fixture();
    f.state.cursor = f.state.rows[7];
    f.state.rows = f.state.rows.slice(8);
    const result = await f.catalog({ locale: 'en', afterBeatId: beatId(8), expectedReleaseId: releaseId.toUpperCase(),
      expectedReleaseChecksum: checksum });
    expect(result.items.map(row => row.beatId)).toEqual([beatId(9)]);
    expect(result.nextAfterBeatId).toBeNull();
    const [cursor, page] = f.tx.$queryRaw.mock.calls.map(call => call[0]);
    scoped(cursor); scoped(page);
    expect(cursor.sql).not.toContain('content');
    expect(cursor.values).toEqual([beatId(8), workId]);
    expect(page.sql).toContain('AND (p.position, s.position, b.position, b.id) >');
    expect(page.values.slice(-4)).toEqual([1, 2, 8, beatId(8)]);
    noWrites(f);
  });

  it('returns 404 for foreign, unpublished, fixture or unsupported cursors before any text query', async () => {
    const f = fixture();
    await rejection(f.catalog({ locale: 'en', afterBeatId: other, expectedReleaseId: releaseId,
      expectedReleaseChecksum: checksum }), 404, 'STORY_INTERACTION_BEAT_UNAVAILABLE');
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(1);
    scoped(f.tx.$queryRaw.mock.calls[0][0]);
    expect(f.tx.$queryRaw.mock.calls[0][0].sql).not.toContain('content');
    noWrites(f);
  });

  it.each([{ expectedReleaseId: other }, { expectedReleaseChecksum: 'c'.repeat(64) }])(
    'rejects stale release pins before the next text query (case %#)', async change => {
      const f = fixture();
      f.state.cursor = f.state.rows[7];
      await rejection(f.catalog({ locale: 'en', afterBeatId: beatId(8), expectedReleaseId: releaseId,
        expectedReleaseChecksum: checksum, ...change }), 409, 'STORY_INTERACTION_SOURCE_CHANGED');
      expect(f.tx.$queryRaw).toHaveBeenCalledTimes(1);
      noWrites(f);
    });

  it.each([0, 1, 8])('returns no cursor for a terminal page containing %s rows', async count => {
    const f = fixture();
    f.state.rows = f.state.rows.slice(0, count);
    const result = await f.catalog();
    expect(result.items).toHaveLength(count);
    expect(result.nextAfterBeatId).toBeNull();
    expect(result.releaseId).toBe(releaseId);
    noWrites(f);
  });

  it.each(STORY_LOCALES)('queries only exact locale %s, preserving valid source verbatim', async locale => {
    const f = fixture();
    f.state.rows = [{ ...f.state.rows[0], sourceText: `  ${locale} \uD83D\uDE80 exact source.\n` }];
    const result = await f.catalog({ locale });
    expect(result.items[0]).toMatchObject({ sourceText: f.state.rows[0].sourceText, sourceAvailable: true });
    const sql = f.tx.$queryRaw.mock.calls[0][0];
    expect(sql.values).toEqual([locale, locale, workId]);
    expect(sql.sql).toContain('jsonb_typeof(b.content ->');
    expect(sql.sql).not.toMatch(/COALESCE|default_locale/i);
    noWrites(f);
  });

  it.each([null, undefined, '', 'x', '  ', 'ok\0', 'ok\uD800', 'ok\uDC00', 'x'.repeat(64001), 42, [], { en: 'Private nested source' }])(
    'marks missing/invalid exact source unavailable without dropping the beat (case %#)', async sourceText => {
      const f = fixture();
      f.state.rows = [{ ...f.state.rows[0], sourceText }];
      const result = await f.catalog();
      expect(result.items).toEqual([{ ...f.state.rows[0], sourceText: null, sourceAvailable: false }]);
      noWrites(f);
    });

  it('accepts the UTF-16 64000 boundary and rejects a supplementary-character overflow', async () => {
    const f = fixture();
    f.state.rows = [{ ...f.state.rows[0], sourceText: '\uD83D\uDE80'.repeat(32000) }];
    expect((await f.catalog()).items[0].sourceAvailable).toBe(true);
    f.state.rows[0].sourceText = '\uD83D\uDE80'.repeat(32001);
    expect((await f.catalog()).items[0]).toMatchObject({ sourceAvailable: false, sourceText: null });
    noWrites(f);
  });

  it('projects only public-source fields, never manuscript/source blobs or private generated data', async () => {
    const f = fixture();
    Object.assign(f.state.rows[0], { content: { en: 'SOURCE_BLOB' }, visualManifest: { private: 'PRIVATE_ASSET' },
      generatedScene: { source: 'PRIVATE_GENERATED' }, structuredBody: f.manuscript.structuredBody });
    const result = await f.catalog();
    expect(Object.keys(result).sort()).toEqual(['contract', 'ownerUserId', 'workId', 'releaseId', 'releaseChecksum',
      'manuscriptVersionId', 'manuscriptHash', 'locale', 'items', 'nextAfterBeatId'].sort());
    expect(Object.keys(result.items[0]).sort()).toEqual(['beatId', 'sceneId', 'partId', 'partPosition', 'scenePosition',
      'beatPosition', 'beatType', 'sourceText', 'sourceAvailable'].sort());
    expect(JSON.stringify(result)).not.toMatch(/MANUSCRIPT_BODY|RELEASE_BLOB|SOURCE_BLOB|PRIVATE_ASSET|PRIVATE_GENERATED/);
    noWrites(f);
  });

  it.each([{ ownerUserId: other }, { status: 'draft' }, { status: 'archived' }, { fixtureSource: true }, { activeReleaseId: null }])(
    'rejects unavailable owner/published/nonfixture work (case %#)', async change => {
      const f = fixture(); Object.assign(f.work, change);
      await rejection(f.catalog(), 404, 'STORY_INTERACTION_WORK_UNAVAILABLE');
      expect(f.tx.storyRelease.findFirst).not.toHaveBeenCalled();
      expect(f.tx.$queryRaw).not.toHaveBeenCalled();
      noWrites(f);
    });

  it('rejects a different authenticated user without reading source', async () => {
    const f = fixture();
    await rejection(f.service.catalog(other, workId, { locale: 'en' }), 404, 'STORY_INTERACTION_WORK_UNAVAILABLE');
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
    noWrites(f);
  });

  it.each(['foreign-release', 'inactive-release', 'release-hash', 'foreign-manuscript', 'manuscript-owner', 'manuscript-hash'])(
    'fails closed for invalid active source identity: %s', async change => {
      const f = fixture();
      if (change === 'foreign-release') f.release.workId = other;
      if (change === 'inactive-release') f.release.status = 'retired';
      if (change === 'release-hash') f.release.checksum = 'bad';
      if (change === 'foreign-manuscript') f.manuscript.workId = other;
      if (change === 'manuscript-owner') f.manuscript.ownerUserId = other;
      if (change === 'manuscript-hash') f.manuscript.contentHash = 'BAD';
      await rejection(f.catalog(), 409, 'STORY_INTERACTION_SOURCE_CHANGED');
      expect(f.tx.$queryRaw).not.toHaveBeenCalled();
      noWrites(f);
    });

  it('validates direct service calls before starting a transaction', async () => {
    for (const query of [{ locale: 'en-US' }, { locale: 'en', afterBeatId: 'bad' },
      { locale: 'en', afterBeatId: beatId(8) }, { locale: 'en', afterBeatId: beatId(8), expectedReleaseId: releaseId },
      { locale: 'en', expectedReleaseChecksum: 'A'.repeat(64) }]) {
      const f = fixture();
      await expect(f.catalog(query)).rejects.toBeInstanceOf(BadRequestException);
      expect(f.prisma.$transaction).not.toHaveBeenCalled();
      noWrites(f);
    }
  });
});

describe('catalog controller and query DTO (no HTTP server)', () => {
  it('requires JWT, exact GET path, no-store, UUID work pipe and the catalog query DTO', () => {
    const controller = StoryInteractionApprovalController;
    const handler = controller.prototype.catalog;
    expect(Reflect.getMetadata(PATH_METADATA, controller)).toBe('me/creator-studio/stories/:workId/interactions');
    expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([JwtAuthGuard]);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('beats');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toContainEqual({ name: 'Cache-Control', value: 'private, no-store' });
    expect(Reflect.getMetadata(PARAMTYPES_METADATA, controller.prototype, 'catalog')[2]).toBe(StoryInteractionCatalogQueryDto);
    const args = Object.values(Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, 'catalog'));
    expect(args).toContainEqual(expect.objectContaining({ data: 'workId', pipes: [ParseUUIDPipe] }));
  });

  it('forwards only the authenticated owner ID, work ID and unchanged query', async () => {
    const response = { contract: 'story-canonical-interaction-catalog-v1' };
    const approvals = { catalog: jest.fn().mockResolvedValue(response) };
    const controller = new StoryInteractionApprovalController(approvals as never);
    const query = { locale: 'ja', afterBeatId: beatId(8), expectedReleaseId: releaseId, expectedReleaseChecksum: checksum };
    expect(await controller.catalog({ id: owner, ownerUserId: other } as never, workId, query)).toBe(response);
    expect(approvals.catalog).toHaveBeenCalledWith(owner, workId, query);
  });

  it.each(STORY_LOCALES)('accepts exact %s locale and optional validated first-page pins', async locale => {
    for (const pins of [{}, { expectedReleaseId: releaseId }, { expectedReleaseChecksum: checksum },
      { afterBeatId: beatId(8), expectedReleaseId: releaseId, expectedReleaseChecksum: checksum }]) {
      expect(await validate(plainToInstance(StoryInteractionCatalogQueryDto, { locale, ...pins }))).toEqual([]);
    }
  });

  it('requires both release pins whenever afterBeatId is supplied', async () => {
    for (const pins of [{}, { expectedReleaseId: releaseId }, { expectedReleaseChecksum: checksum }]) {
      expect(await validate(plainToInstance(StoryInteractionCatalogQueryDto, { locale: 'en', afterBeatId: beatId(8), ...pins })))
        .not.toEqual([]);
    }
  });

  it('rejects malformed locales, UUIDs, checksums and explicit null fields', async () => {
    for (const [field, values] of Object.entries({ locale: [undefined, null, 'EN', 'en-US', 'zh', 'zh-hans', 42],
      afterBeatId: [null, 'bad', `${beatId(8)}\0`], expectedReleaseId: [null, 'bad'],
      expectedReleaseChecksum: [null, 'A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), 42] })) {
      for (const value of values) expect(await validate(plainToInstance(StoryInteractionCatalogQueryDto, {
        locale: 'en', afterBeatId: beatId(8), expectedReleaseId: releaseId, expectedReleaseChecksum: checksum, [field]: value })))
        .not.toEqual([]);
    }
  });

  it('rejects ownership/private-source fields at the transport boundary', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    for (const extra of [{ ownerUserId: other }, { workId: other }, { artistId: other }, { generatedSceneId: other }, { limit: 100 }]) {
      await expect(pipe.transform({ locale: 'en', ...extra }, { type: 'query', metatype: StoryInteractionCatalogQueryDto }))
        .rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
