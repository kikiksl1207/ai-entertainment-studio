import 'reflect-metadata';
import { INestApplication, NotFoundException, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { PrismaService } from '../prisma/prisma.service';
import { StoryApprovedReadingCatalogQueryDto } from './dto/story-approved-reading-catalog.dto';
import { StoryProductionController } from './story-production.controller';
import { StoryProductionService } from './story-production.service';
import { StoryProgressControlService } from './story-progress-control.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const native = url ? describe : describe.skip;
const query = (changes: Partial<StoryApprovedReadingCatalogQueryDto> = {}) => ({ locale: 'ko', limit: 12, ...changes }) as StoryApprovedReadingCatalogQueryDto;
const privateValue = 'SYNTHETIC_CATALOG_PRIVATE_SENTINEL';
const emoji = '\uD83D\uDE00';
jest.setTimeout(30000);

// The parent admits the exact 174-model SDK / 103 HEAD migrations and owns one PG lifecycle.
// This suite only connects to that dedicated database; fixtures remain for evidence, with no reset/delete/DDL.
native('approved reading catalog (owned PostgreSQL, no provider or auth mint)', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432'
      || parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash
      || !/^\/lumina_failed_cost_qa_[a-f0-9]{12}$/.test(parsed.pathname)) throw new Error('Dedicated parent-owned loopback QA database required');
    expect(Prisma.dmmf.datamodel.models).toHaveLength(174);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    const current = await db.$queryRaw<Array<{ name: string }>>(Prisma.sql`SELECT current_database() AS name`);
    expect(current).toEqual([{ name: parsed.pathname.slice(1) }]);
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function fixture() {
    const owner = await db.user.create({ data: {} }), other = await db.user.create({ data: {} });
    return { owner, other };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function work(ownerId: string, changes: Partial<Prisma.StoryWorkUncheckedCreateInput> = {}) {
    return db.storyWork.create({ data: { ownerUserId: ownerId, slug: 'synthetic-catalog-' + randomUUID(),
      title: { ko: 'Owned title', en: 'English title' }, summary: { ko: privateValue },
      coverManifest: { private: privateValue }, status: 'draft', defaultLocale: 'ko', fixtureSource: false, ...changes } });
  }
  async function state(f: Fixture) {
    return {
      works: await db.storyWork.findMany({ where: { ownerUserId: { in: [f.owner.id, f.other.id] } }, orderBy: { id: 'asc' } }),
      exactTimes: await db.$queryRaw(Prisma.sql`SELECT id,
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"
        FROM story_works WHERE owner_user_id IN (${f.owner.id}::uuid, ${f.other.id}::uuid) ORDER BY id`),
      wallets: await db.walletAccount.findMany({ orderBy: { id: 'asc' } }),
      ledgers: await db.walletLedger.findMany({ orderBy: { id: 'asc' } }),
      audits: await db.auditEvent.findMany({ orderBy: { id: 'asc' } }),
      profiles: await db.storyWorkGenerationProfile.findMany({ orderBy: { id: 'asc' } }),
      manuscripts: await db.storyManuscriptVersion.findMany({ orderBy: { id: 'asc' } }),
      continuations: await db.storyAiContinuation.findMany({ orderBy: { id: 'asc' } }),
      usage: await db.storyAiUsageLedger.findMany({ orderBy: { id: 'asc' } }),
      entitlements: await db.userEntitlement.findMany({ orderBy: { id: 'asc' } }),
    };
  }

  function observed(probeWorkId?: string) {
    const forbidden = jest.fn(() => { throw new Error('Service write, model read, provider or bootstrap forbidden'); });
    const modes: Array<{ readOnly: string; isolation: string }> = [];
    const sets: Prisma.Sql[] = [], reads: Array<{ sql: Prisma.Sql; rows: Array<Record<string, unknown>> }> = [];
    let probeError: unknown, probeWriteSucceeded = false;
    const transaction = jest.fn(async (run: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: { isolationLevel: Prisma.TransactionIsolationLevel }) => db.$transaction(async tx => {
      let set = false;
      const observedTx = new Proxy(tx, { get(target, key) {
        if (key === '$executeRaw') return async (sql: Prisma.Sql) => {
          sets.push(sql);
          if (set || sql.text !== 'SET TRANSACTION READ ONLY' || sql.values.length !== 0) return forbidden();
          const result = await target.$executeRaw(sql); set = true;
          const settings = await target.$queryRaw<Array<{ readOnly: string; isolation: string }>>(Prisma.sql`
            SELECT current_setting('transaction_read_only') AS "readOnly", current_setting('transaction_isolation') AS isolation`);
          modes.push(...settings);
          if (probeWorkId) {
            // A deliberately rejected fixture-row write proves DB enforcement in the service's own transaction.
            try { await target.$executeRaw(Prisma.sql`UPDATE story_works SET status = status WHERE id = ${probeWorkId}::uuid`); }
            catch (error) { probeError = error; throw error; }
            probeWriteSucceeded = true;
            throw new Error('READ ONLY probe unexpectedly wrote; force rollback');
          }
          return result;
        };
        if (key === '$queryRaw') return async (sql: Prisma.Sql) => {
          if (!set) return forbidden();
          const rows = await target.$queryRaw<Array<Record<string, unknown>>>(sql);
          reads.push({ sql, rows }); return rows;
        };
        return forbidden;
      } });
      return run(observedTx);
    }, options));
    const client = new Proxy({ $transaction: transaction }, { get(target, key) { return key === '$transaction' ? target.$transaction : forbidden; } });
    const dependencies = new Proxy({}, { get() { return forbidden(); } });
    const service = new StoryProductionService(client as never, dependencies as never, dependencies as never, dependencies as never,
      dependencies as never, dependencies as never, dependencies as never, dependencies as never, dependencies as never, dependencies as never);
    return { service, forbidden, modes, sets, reads, transaction, probe: () => ({ error: probeError, writeSucceeded: probeWriteSucceeded }) };
  }
  type Observed = ReturnType<typeof observed>;
  function checked(h: Observed, transactions: number, reads: number) {
    // These assertions are outside the service catch, so SQL/proxy errors cannot fake a valid rejection.
    expect(h.forbidden).not.toHaveBeenCalled(); expect(h.transaction).toHaveBeenCalledTimes(transactions);
    expect(h.sets).toHaveLength(transactions); expect(h.modes).toHaveLength(transactions); expect(h.reads).toHaveLength(reads);
    for (const [, options] of h.transaction.mock.calls) expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    for (const sql of h.sets) { expect(sql.text).toBe('SET TRANSACTION READ ONLY'); expect(sql.values).toEqual([]); }
    for (const mode of h.modes) expect(mode).toEqual({ readOnly: 'on', isolation: 'repeatable read' });
    for (const read of h.reads) {
      expect(read.sql.text).toMatch(/FROM story_works/); expect(read.sql.text).toContain('fixture_source = false');
      expect(read.sql.values.some(value => value instanceof Date)).toBe(false);
      if (read.sql.text.includes('AS "updatedAt"')) { expect(read.rows.length).toBeLessThanOrEqual(1); continue; }
      expect(read.rows.length).toBeLessThanOrEqual(21);
      expect(read.sql.text).toContain('left(chosen.value, $1::integer)');
      for (const row of read.rows) {
        expect(Object.keys(row).sort()).toEqual(['defaultLocale', 'fixtureSource', 'id', 'ownerUserId', 'status',
          'titleBounded', 'titleFallback', 'titleInvalid', 'titleLocale', 'titleValue'].sort());
        expect(typeof row.titleValue).toBe('string'); expect(Array.from(row.titleValue as string).length).toBeLessThanOrEqual(256);
        for (const name of ['titleBounded', 'titleFallback', 'titleInvalid']) expect(typeof row[name]).toBe('boolean');
      }
    }
  }
  async function failure(promise: Promise<unknown>, kind: typeof NotFoundException | typeof ServiceUnavailableException, code: string) {
    let error: unknown; try { await promise; } catch (value) { error = value; }
    expect(error).toBeInstanceOf(kind); expect((error as NotFoundException).getResponse()).toEqual({ code });
  }

  it('lists only the current owner non-fixture records and an empty owner, without approval/private data or writes', async () => {
    const f = await fixture(), owned = await work(f.owner.id), foreign = await work(f.other.id), h = observed();
    await work(f.owner.id, { fixtureSource: true }); const before = await state(f);
    const result = await h.service.approvedReadingCatalog(f.owner.id, query());
    expect(result.items).toEqual([{ workId: owned.id, title: { value: 'Owned title', locale: 'ko', fallback: false, bounded: false },
      defaultLocale: 'ko', recordedState: { workStatus: 'draft', approval: 'not_checked' } }]);
    expect(result).toMatchObject({ contract: 'story-owner-approved-reading-catalog-v1', sourceScope: 'owner_work_records_only',
      readOnly: true, providerCalls: 0, operatingWrites: 0, nextCursor: null });
    expect(JSON.stringify(result)).not.toContain(privateValue); expect(JSON.stringify(result)).not.toContain(foreign.id);
    checked(h, 1, 1); expect(await state(f)).toEqual(before);
    const emptyOwner = await db.user.create({ data: {} }), empty = observed();
    expect((await empty.service.approvedReadingCatalog(emptyOwner.id, query())).items).toEqual([]); checked(empty, 1, 1);
  });

  it('returns identical generic 404 for missing, foreign-owner and fixture cursors before the list query', async () => {
    const f = await fixture(), foreign = await work(f.other.id), fixtureWork = await work(f.owner.id, { fixtureSource: true });
    await work(f.owner.id); const before = await state(f);
    for (const cursor of [randomUUID(), foreign.id, fixtureWork.id]) {
      const h = observed(); await failure(h.service.approvedReadingCatalog(f.owner.id, query({ cursor })), NotFoundException,
        'STORY_APPROVED_READING_CATALOG_NOT_FOUND');
      checked(h, 1, 1); expect(h.reads[0].rows).toEqual([]);
    }
    expect(await state(f)).toEqual(before);
  });

  it('paginates exact .123001/.123456/.123999 timestamps and same-time UUID ties without millisecond rounding', async () => {
    const f = await fixture(), ids = [1, 2, 3, 4].map(n => '33333333-3333-4333-8333-' + String(n).padStart(12, '0'));
    const stamps = ['2026-10-13T01:02:03.123001Z', '2026-10-13T01:02:03.123456Z',
      '2026-10-13T01:02:03.123456Z', '2026-10-13T01:02:03.123999Z'];
    for (let index = 0; index < ids.length; index++) {
      await work(f.owner.id, { id: ids[index] });
      await db.$executeRaw(Prisma.sql`UPDATE story_works SET updated_at = ${stamps[index]}::timestamptz WHERE id = ${ids[index]}::uuid`);
    }
    const before = await state(f), visited: string[] = [], h = observed(); let cursor: string | undefined;
    for (let page = 0; page < ids.length; page++) {
      const result = await h.service.approvedReadingCatalog(f.owner.id, query({ limit: 1, ...(cursor ? { cursor } : {}) }));
      expect(result.items).toHaveLength(1); visited.push(result.items[0].workId);
      expect(result.nextCursor).toBe(page < ids.length - 1 ? ids[3 - page] : null); cursor = result.nextCursor ?? undefined;
    }
    expect(visited).toEqual([...ids].reverse()); checked(h, 4, 7);
    const anchors = h.reads.filter(read => read.sql.text.includes('AS "updatedAt"'));
    expect(anchors.map(read => read.rows[0].updatedAt)).toEqual([stamps[3], stamps[2], stamps[1]]);
    const pages = h.reads.filter(read => !read.sql.text.includes('AS "updatedAt"')).slice(1);
    expect(pages.map(read => read.sql.values[5])).toEqual([stamps[3], stamps[2], stamps[1]]);
    for (const page of pages) expect(page.sql.text).toContain('(updated_at, id) < ($6::timestamptz, $7::uuid)');
    expect(await state(f)).toEqual(before);
  });

  it('uses actual raw integer casts/limit+1 and all five requested locales', async () => {
    const f = await fixture(), title = { ko: 'Korean', en: 'English', ja: 'Japanese', 'zh-Hans': 'Simplified', 'zh-Hant': 'Traditional' };
    for (let i = 0; i < 21; i++) await work(f.owner.id, { title });
    const before = await state(f), h = observed();
    for (const limit of [1, 12, 20]) {
      const result = await h.service.approvedReadingCatalog(f.owner.id, query({ limit }));
      expect(result.items).toHaveLength(limit); expect(result.nextCursor).toBe(result.items.at(-1)!.workId);
      expect(h.reads.at(-1)!.rows).toHaveLength(limit + 1); expect(h.reads.at(-1)!.sql.values[0]).toBe(256);
    }
    for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'] as const) {
      const result = await h.service.approvedReadingCatalog(f.owner.id, query({ locale, limit: 1 }));
      expect(result.items[0].title).toEqual({ value: title[locale], locale, fallback: false, bounded: false });
    }
    checked(h, 8, 8); expect(await state(f)).toEqual(before);
  });

  it('preserves default/ko/en/ja/Chinese literal fallback order and skips non-string JSON candidates in SQL', async () => {
    const f = await fixture(), expected = new Map<string, { value: string; locale: string }>();
    for (const source of [
      { defaultLocale: 'zh-Hans', title: { ko: 'Korean', en: 'English', 'zh-Hans': 'Default' }, locale: 'zh-Hans', value: 'Default' },
      { defaultLocale: 'ja', title: { ko: 'Korean', en: 'English' }, locale: 'ko', value: 'Korean' },
      { defaultLocale: 'ja', title: { en: 'English', 'zh-Hans': 'Simplified' }, locale: 'en', value: 'English' },
      { defaultLocale: 'ja', title: { 'zh-Hans': 'Simplified', 'zh-Hant': 'Traditional' }, locale: 'zh-Hans', value: 'Simplified' },
      { defaultLocale: 'ja', title: { 'zh-Hant': 'Traditional' }, locale: 'zh-Hant', value: 'Traditional' },
      { defaultLocale: 'ko', title: { ja: { private: privateValue }, ko: 'Default string' }, locale: 'ko', value: 'Default string' },
    ]) {
      const sourceWork = await work(f.owner.id, { defaultLocale: source.defaultLocale, title: source.title });
      expected.set(sourceWork.id, { value: source.value, locale: source.locale });
    }
    const before = await state(f), h = observed(), result = await h.service.approvedReadingCatalog(f.owner.id, query({ locale: 'ja' }));
    expect(result.items).toHaveLength(expected.size);
    for (const item of result.items) expect(item.title).toEqual({ ...expected.get(item.workId), fallback: true, bounded: false });
    checked(h, 1, 1); expect(await state(f)).toEqual(before);
  });

  it('treats NBSP/BOM/wide spaces and trim-only controls as empty candidates, preserving selected whitespace', async () => {
    const f = await fixture();
    for (const blank of ['\t\n', '\u00a0', '\ufeff', '\u2003', '\u2028', '\u3000']) {
      await work(f.owner.id, { title: { ja: blank, ko: blank, en: ' English title ' } });
    }
    const before = await state(f), h = observed(), result = await h.service.approvedReadingCatalog(f.owner.id, query({ locale: 'ja' }));
    expect(result.items).toHaveLength(6);
    for (const item of result.items) expect(item.title).toEqual({ value: ' English title ', locale: 'en', fallback: true, bounded: false });
    checked(h, 1, 1); expect(await state(f)).toEqual(before);
  });

  it('rejects actual BMP/supplementary Cc/Cf after character 256 via the full-value DB boolean, not a query error', async () => {
    const f = await fixture(), source = await work(f.owner.id);
    for (const character of ['\n', '\u200b', '\uD804\uDCBD', '\uDB40\uDC01']) {
      await db.storyWork.update({ where: { id: source.id }, data: { title: { ko: 'a'.repeat(256) + character } } });
      const before = await state(f), h = observed();
      await failure(h.service.approvedReadingCatalog(f.owner.id, query()), ServiceUnavailableException, 'STORY_APPROVED_READING_CATALOG_UNAVAILABLE');
      checked(h, 1, 1); expect(h.reads[0].rows[0]).toMatchObject({ titleValue: 'a'.repeat(256), titleBounded: true, titleInvalid: true });
      expect(await state(f)).toEqual(before);
    }
  });

  it('materializes only 256 supplementary title characters and scalar flags, leaving the full JSON unchanged', async () => {
    const f = await fixture(), exact = await work(f.owner.id, { title: { ko: emoji.repeat(256), extra: privateValue.repeat(1024) } });
    const over = await work(f.owner.id, { title: { ko: emoji.repeat(257), extra: privateValue.repeat(1024) } });
    const before = await state(f), h = observed(), result = await h.service.approvedReadingCatalog(f.owner.id, query());
    expect(result.items.find(item => item.workId === exact.id)!.title).toMatchObject({ value: emoji.repeat(256), bounded: false });
    expect(result.items.find(item => item.workId === over.id)!.title).toMatchObject({ value: emoji.repeat(256), bounded: true });
    checked(h, 1, 1); expect(await state(f)).toEqual(before); expect(JSON.stringify(h.reads[0].rows)).not.toContain(privateValue);
  });

  it('byte bounded catalog returns a maximal full-title prefix above 8192 UTF-8 bytes after a bounded native SQL read', async () => {
    const f = await fixture(); for (let i = 0; i < 20; i++) await work(f.owner.id, { title: { ko: emoji.repeat(256) } });
    const before = await state(f), h = observed();
    const result = await h.service.approvedReadingCatalog(f.owner.id, query({ limit: 20 }));
    expect(result.items).toHaveLength(6); expect(result.nextCursor).toBe(result.items.at(-1)!.workId);
    expect(result.items.map(item => item.workId)).toEqual(h.reads[0].rows.slice(0, 6).map(row => row.id));
    for (const item of result.items) expect(item.title).toEqual({ value: emoji.repeat(256), locale: 'ko', fallback: false, bounded: false });
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(8192);
    const seventh = h.reads[0].rows[6];
    const oneMore = { ...result, items: [...result.items, { ...result.items[0], workId: seventh.id }], nextCursor: seventh.id };
    expect(Buffer.byteLength(JSON.stringify(oneMore), 'utf8')).toBeGreaterThan(8192);
    checked(h, 1, 1); expect(h.reads[0].rows).toHaveLength(20); expect(await state(f)).toEqual(before);
  });

  it('byte bounded catalog admits exactly 8192 bytes and trims the tail after one extra ASCII byte with native bounded titles', async () => {
    const f = await fixture(), sources: Array<{ id: string; length: number }> = [], h = observed();
    for (let i = 0; i < 20; i++) sources.push({ id: (await work(f.owner.id, { title: { ko: 'a' } })).id, length: 1 });
    const base = await h.service.approvedReadingCatalog(f.owner.id, query({ limit: 20 }));
    let remaining = 8192 - Buffer.byteLength(JSON.stringify(base), 'utf8'); expect(remaining).toBeGreaterThan(0);
    for (const source of sources) {
      const extra = Math.min(255, remaining); source.length += extra; remaining -= extra;
      await db.storyWork.update({ where: { id: source.id }, data: { title: { ko: 'a'.repeat(source.length) } } });
    }
    expect(remaining).toBe(0); const before = await state(f);
    const exact = await h.service.approvedReadingCatalog(f.owner.id, query({ limit: 20 }));
    expect(Buffer.byteLength(JSON.stringify(exact), 'utf8')).toBe(8192); expect(await state(f)).toEqual(before);
    const extra = sources.find(source => source.length < 256)!; expect(extra).toBeDefined();
    await db.storyWork.update({ where: { id: extra.id }, data: { title: { ko: 'a'.repeat(extra.length + 1) } } });
    const oversized = await state(f);
    const prefix = await h.service.approvedReadingCatalog(f.owner.id, query({ limit: 20 }));
    const fullItems = h.reads.at(-1)!.rows.map(row => {
      const item = exact.items.find(item => item.workId === row.id)!;
      return { ...item, title: { ...item.title, value: row.titleValue as string } };
    });
    expect(Buffer.byteLength(JSON.stringify({ ...exact, items: fullItems }), 'utf8')).toBe(8193);
    expect(prefix.items).toEqual(fullItems.slice(0, 19)); expect(prefix.nextCursor).toBe(prefix.items.at(-1)!.workId);
    expect(Buffer.byteLength(JSON.stringify(prefix), 'utf8')).toBeLessThanOrEqual(8192);
    expect(Buffer.byteLength(JSON.stringify({ ...prefix, items: fullItems, nextCursor: fullItems.at(-1)!.workId }), 'utf8')).toBeGreaterThan(8192);
    checked(h, 3, 3); expect(await state(f)).toEqual(oversized);
  });

  it.each([
    { label: 'creator-sized 120-code-point four-byte titles over 11 plus 1', count: 12, title: emoji.repeat(120), lengths: [11, 1] },
    { label: 'maximum 256-code-point titles over two short pages', count: 12, title: emoji.repeat(256), lengths: [6, 6] },
    { label: 'minimal titles over 12 plus a final no-cursor page', count: 13, title: 'a', lengths: [12, 1] },
  ])('byte bounded catalog native multipage $label loses or duplicates no work and preserves the six-digit anchor', async source => {
    const f = await fixture(), ids: string[] = [], stamp = '2026-10-13T01:02:03.123456Z';
    for (let index = 0; index < source.count; index++) {
      const created = await work(f.owner.id, { title: { ko: source.title } }); ids.push(created.id);
      await db.$executeRaw(Prisma.sql`UPDATE story_works SET updated_at = ${stamp}::timestamptz WHERE id = ${created.id}::uuid`);
    }
    await work(f.other.id, { title: { ko: source.title } }); await work(f.owner.id, { fixtureSource: true, title: { ko: source.title } });
    const before = await state(f), expected = [...ids].sort().reverse(), visited: string[] = [], sizes: number[] = [], h = observed();
    let cursor: string | undefined;
    for (let page = 0; page < source.lengths.length; page++) {
      const result = await h.service.approvedReadingCatalog(f.owner.id, query({ ...(cursor ? { cursor } : {}) }));
      const json = JSON.stringify(result); sizes.push(Buffer.byteLength(json, 'utf8'));
      expect(sizes.at(-1)).toBeLessThanOrEqual(8192); expect(result.items).toHaveLength(source.lengths[page]);
      expect(result.items.map(item => item.workId)).toEqual(expected.slice(visited.length, visited.length + source.lengths[page]));
      expect(result).toMatchObject({ readOnly: true, providerCalls: 0, operatingWrites: 0 }); expect(json).not.toContain(privateValue);
      for (const item of result.items) {
        expect(item.title).toEqual({ value: source.title, locale: 'ko', fallback: false, bounded: false });
        expect(item.recordedState.approval).toBe('not_checked');
      }
      visited.push(...result.items.map(item => item.workId));
      expect(result.nextCursor).toBe(page < source.lengths.length - 1 ? result.items.at(-1)!.workId : null);
      cursor = result.nextCursor ?? undefined;
    }
    expect(cursor).toBeUndefined(); expect(visited).toEqual(expected); expect(new Set(visited).size).toBe(source.count);
    expect(Math.min(...sizes)).toBeGreaterThan(0); expect(Math.max(...sizes)).toBeLessThanOrEqual(8192);
    checked(h, 2, 3);
    const anchor = h.reads.find(read => read.sql.text.includes('AS "updatedAt"'))!;
    expect(anchor.rows).toEqual([{ id: visited[source.lengths[0] - 1], ownerUserId: f.owner.id, fixtureSource: false, updatedAt: stamp }]);
    const nextRead = h.reads.at(-1)!;
    expect(nextRead.sql.values.slice(5, 8)).toEqual([stamp, visited[source.lengths[0] - 1], 13]);
    expect(nextRead.sql.text).toContain('(updated_at, id) < ($6::timestamptz, $7::uuid)');
    expect(await state(f)).toEqual(before);
  });

  it('enforces SET READ ONLY on a real permanent-table write in the exact service transaction and rolls back', async () => {
    const f = await fixture(), source = await work(f.owner.id), before = await state(f), h = observed(source.id);
    await failure(h.service.approvedReadingCatalog(f.owner.id, query()), ServiceUnavailableException, 'STORY_APPROVED_READING_CATALOG_UNAVAILABLE');
    checked(h, 1, 0); expect(h.probe().writeSucceeded).toBe(false);
    expect(h.probe().error).toMatchObject({ code: 'P2010', meta: { code: '25006' } }); expect(await state(f)).toEqual(before);
  });

  it('uses the actual HTTP controller/JWT guard to return private no-store 401 before data reads, without minting auth', async () => {
    const h = observed(), jwt = new JwtService(), verify = jest.spyOn(jwt, 'verifyAsync');
    const signing = jest.spyOn(jwt, 'signAsync').mockImplementation(async () => { throw new Error('Auth mint forbidden'); });
    const prisma = { user: { findFirst: h.forbidden }, adminUser: { findUnique: h.forbidden, update: h.forbidden }, $transaction: h.forbidden };
    let app: INestApplication | undefined;
    try {
      const module = await Test.createTestingModule({ controllers: [StoryProductionController], providers: [
        { provide: StoryProductionService, useValue: h.service }, { provide: StoryProgressControlService, useValue: {} },
        { provide: PrismaService, useValue: prisma }, { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: 'SYNTHETIC_CATALOG_QA_NOT_OPERATING_SECRET' }) }, JwtAuthGuard,
      ] }).compile();
      app = module.createNestApplication({ logger: false }); configureHttpRouting(app); app.useGlobalFilters(new HttpExceptionFilter());
      app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }));
      await app.listen(0, '127.0.0.1'); const port = (app.getHttpServer().address() as AddressInfo).port;
      const call = (method: string, token?: string) => new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port, method, agent: false,
          path: '/api/v1/me/creator-studio/approved-reading-catalog?locale=ko&limit=12',
          headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), Connection: 'close' } }, response => {
          const chunks: Buffer[] = []; let bytes = 0;
          response.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 8192) req.destroy(new Error('Loopback response limit')); else chunks.push(chunk); });
          response.on('error', reject);
          response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.setTimeout(5000, () => req.destroy(new Error('Loopback HTTP timeout'))); req.on('error', reject); req.end();
      });
      for (const method of ['GET', 'HEAD']) {
        for (const token of [undefined, 'invalid.synthetic.bearer']) {
          const result = await call(method, token); expect(result.status).toBe(401);
          expect(result.headers['cache-control']).toBe('private, no-store'); expect(result.headers.pragma).toBe('no-cache');
          expect(result.headers.expires).toBe('0');
          expect(String(result.headers.vary).toLowerCase().split(',').map(value => value.trim())).toContain('authorization');
          expect(result.body).not.toContain(privateValue);
        }
      }
      expect(verify).toHaveBeenCalledTimes(2); expect(signing).not.toHaveBeenCalled();
      checked(h, 0, 0);
    } finally { await app?.close(); verify.mockRestore(); signing.mockRestore(); }
  });
});
