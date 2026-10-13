import 'reflect-metadata';
import { BadRequestException, ExecutionContext, NotFoundException, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoryProductionController } from './story-production.controller';
import { StoryProductionService } from './story-production.service';
import { StoryApprovedReadingCatalogQueryDto } from './dto/story-approved-reading-catalog.dto';
import { projectLocalizedValue } from './story-production.policy';

const ID = {
  owner: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  work: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', cursor: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};
const stamp = '2026-10-13T01:02:03.123456Z';
const rowId = (index: number) => `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`;
function row(index = 1, changes: Record<string, unknown> = {}) {
  return { id: rowId(index), ownerUserId: ID.owner, fixtureSource: false, title: { ko: 'Owned story', en: 'English story' },
    defaultLocale: 'ko', status: 'draft', ...changes };
}
type Row = ReturnType<typeof row>;
type Anchor = { id: string; ownerUserId: string; fixtureSource: boolean; updatedAt: string };
const trimCharacters = '\t\n\u000b\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
const invalidTitlePattern = '[\\u0001-\\u001f\\u007f-\\u009f\\u00ad\\u0600-\\u0605\\u061c\\u06dd\\u070f\\u0890-\\u0891\\u08e2\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u206f\\ufeff\\ufff9-\\ufffb\\U000110bd\\U000110cd\\U00013430-\\U0001343f\\U0001bca0-\\U0001bca3\\U0001d173-\\U0001d17a\\U000e0001\\U000e0020-\\U000e007f]';

function assertCursorSql(sql: Prisma.Sql) {
  expect(sql.text.trim().replace(/\s+/g, ' ')).toBe(
    'SELECT id, owner_user_id AS "ownerUserId", fixture_source AS "fixtureSource", '
    + 'to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS "updatedAt" '
    + 'FROM story_works WHERE id = $1::uuid AND owner_user_id = $2::uuid AND fixture_source = false LIMIT 1',
  );
  expect(sql.values).toEqual([ID.cursor, ID.owner]);
}

function assertListSql(sql: Prisma.Sql, anchorStamp = stamp) {
  const cursor = sql.values.length === 10;
  const locale = sql.values[1], take = sql.values[cursor ? 7 : 5];
  const takeParameter = cursor ? '$8' : '$6', localeParameter = cursor ? '$9' : '$7', trimParameter = cursor ? '$10' : '$8';
  expect(['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']).toContain(locale);
  expect(Number.isInteger(take)).toBe(true); expect(take).toBeGreaterThanOrEqual(2); expect(take).toBeLessThanOrEqual(21);
  expect(sql.values).toEqual([256, locale, 256, invalidTitlePattern, ID.owner,
    ...(cursor ? [anchorStamp, ID.cursor] : []), take, locale, trimCharacters]);
  expect(sql.text.trim().replace(/\s+/g, ' ')).toBe(
    'SELECT w.id, w.owner_user_id AS "ownerUserId", w.fixture_source AS "fixtureSource", '
    + 'left(w.default_locale, 8) AS "defaultLocale", left(w.status, 33) AS status, '
    + 'COALESCE(left(chosen.value, $1::integer), \'\') AS "titleValue", '
    + 'left(COALESCE(chosen.locale, w.default_locale), 8) AS "titleLocale", '
    + '(chosen.locale IS NULL OR chosen.locale <> $2) AS "titleFallback", '
    + 'COALESCE(char_length(chosen.value) > $3::integer, false) AS "titleBounded", '
    + 'COALESCE(chosen.value ~ $4, false) AS "titleInvalid" '
    + 'FROM ( SELECT id, owner_user_id, fixture_source, default_locale, status, title, updated_at FROM story_works '
    + 'WHERE owner_user_id = $5::uuid AND fixture_source = false '
    + (cursor ? 'AND (updated_at, id) < ($6::timestamptz, $7::uuid) ' : '')
    + `ORDER BY updated_at DESC, id DESC LIMIT ${takeParameter} ) AS w `
    + 'LEFT JOIN LATERAL ( SELECT candidate.locale, w.title ->> candidate.locale AS value '
    + `FROM unnest(ARRAY[${localeParameter}, w.default_locale, 'ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']::text[]) `
    + 'WITH ORDINALITY AS candidate(locale, position) '
    + 'WHERE jsonb_typeof(w.title -> candidate.locale) = \'string\' '
    + `AND btrim(w.title ->> candidate.locale, ${trimParameter}) <> '' `
    + 'ORDER BY candidate.position LIMIT 1 ) AS chosen ON true ORDER BY w.updated_at DESC, w.id DESC',
  );
}

// Reference projection simulates bounded driver rows, not PostgreSQL execution or collation proof.
function projectedRow(source: Row, locale: string) {
  const title = projectLocalizedValue(source.title, locale, source.defaultLocale), characters = Array.from(title.value);
  return { id: source.id, ownerUserId: source.ownerUserId, fixtureSource: source.fixtureSource,
    defaultLocale: source.defaultLocale.slice(0, 8), status: source.status.slice(0, 33),
    titleValue: characters.slice(0, 256).join(''), titleLocale: title.locale.slice(0, 8), titleFallback: title.fallback,
    titleBounded: characters.length > 256, titleInvalid: /[\p{Cc}\p{Cf}]/u.test(title.value) };
}

// Real service/controller/DTO, with only tx-bound synthetic reads and explicit write traps.
function fixture(rows: Row[] = [row()], anchorStamp = stamp) {
  const trace: string[] = [], writes: jest.Mock[] = [], outside: jest.Mock[] = [];
  const forbidden = (name: string, group = writes) => {
    const method = jest.fn(() => { throw new Error('Forbidden synthetic operation: ' + name); }); group.push(method); return method;
  };
  const cursorRead = jest.fn(async (_sql: Prisma.Sql) => {
    trace.push('cursor'); return [{ id: ID.cursor, ownerUserId: ID.owner, fixtureSource: false, updatedAt: anchorStamp }] as Anchor[];
  });
  const listRead = jest.fn(async (sql: Prisma.Sql) => {
    trace.push('list'); return rows.map(source => projectedRow(source, sql.values[1] as string));
  });
  const tx = {
    $executeRaw: jest.fn(async (query: Prisma.Sql) => {
      expect(query.text).toBe('SET TRANSACTION READ ONLY'); expect(query.values).toEqual([]); trace.push('readOnly'); return 0;
    }),
    $queryRaw: jest.fn(async (query: Prisma.Sql) => {
      if (query.text.includes('AS "updatedAt"')) {
        assertCursorSql(query); return cursorRead(query);
      }
      assertListSql(query, anchorStamp); return listRead(query);
    }),
    $queryRawUnsafe: forbidden('tx.raw.unsafe', outside), $executeRawUnsafe: forbidden('tx.raw.unsafe.write'),
    storyWork: {
      findMany: forbidden('tx.work.unboundedJSON', outside),
      findFirst: forbidden('tx.work.findFirst', outside), findUnique: forbidden('tx.work.findUnique', outside),
      create: forbidden('tx.work.create'), update: forbidden('tx.work.update'), updateMany: forbidden('tx.work.updateMany'),
      upsert: forbidden('tx.work.upsert'), delete: forbidden('tx.work.delete'),
    },
    storyWorkGenerationProfile: { findFirst: forbidden('profile.read', outside), findMany: forbidden('profile.list', outside),
      findUnique: forbidden('profile.unique', outside), update: forbidden('profile.update') },
    storyManuscriptVersion: { findMany: forbidden('manuscript.read', outside), create: forbidden('manuscript.create') },
    walletAccount: { upsert: forbidden('wallet.upsert'), updateMany: forbidden('wallet.updateMany') },
    walletLedger: { create: forbidden('ledger.create') },
  };
  const prisma = {
    storyWork: { findMany: forbidden('outer.work.list', outside), findFirst: forbidden('outer.work.first', outside) },
    $queryRaw: forbidden('outer.raw.read', outside), $executeRaw: forbidden('outer.raw.write'),
    $transaction: jest.fn(async (callback: (db: typeof tx) => unknown, options: unknown) => {
      expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }); return callback(tx);
    }),
  };
  const dependencies = new Proxy({}, { get: (_target, property) => { throw new Error('Provider/bootstrap forbidden: ' + String(property)); } });
  const service = new StoryProductionService(prisma as never, dependencies as never, dependencies as never, dependencies as never,
    dependencies as never, dependencies as never, dependencies as never, dependencies as never, dependencies as never, dependencies as never);
  return { service, prisma, tx, cursorRead, listRead, trace, writes, outside, rows, anchorStamp };
}
type Fixture = ReturnType<typeof fixture>;
const query = (changes: Record<string, unknown> = {}) => ({ locale: 'ko', limit: 12, ...changes }) as StoryApprovedReadingCatalogQueryDto;
function noSideEffects(h: Fixture) {
  for (const method of [...h.writes, ...h.outside]) expect(method).not.toHaveBeenCalled();
  // Assert outside the service catch too: a broken SQL oracle must not count as a valid rejection.
  for (const [sql] of h.tx.$executeRaw.mock.calls) { expect(sql.text).toBe('SET TRANSACTION READ ONLY'); expect(sql.values).toEqual([]); }
  for (const [, options] of h.prisma.$transaction.mock.calls) expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  for (const [sql] of h.tx.$queryRaw.mock.calls) {
    if (sql.text.includes('AS "updatedAt"')) assertCursorSql(sql); else assertListSql(sql, h.anchorStamp);
  }
}
async function failure(promise: Promise<unknown>, type: typeof BadRequestException | typeof NotFoundException | typeof ServiceUnavailableException, code: string) {
  let error: unknown; try { await promise; } catch (value) { error = value; }
  expect(error).toBeInstanceOf(type); expect(error).toMatchObject({ response: { code } }); return error;
}

describe('owner approved-reading catalog (synthetic read-only boundary)', () => {
  it('returns only minimal work records, never publication-as-approval or profile/price/permission facts', async () => {
    const h = fixture([row(1, { status: 'published', summary: { ko: 'Private summary' }, authorEmail: 'private@example.invalid',
      approvedSettings: { private: true }, sourceFingerprint: 'private', priceLumina: '999', profileApproved: true })]);
    const result = await h.service.approvedReadingCatalog(ID.owner, query());
    expect(result).toEqual({ contract: 'story-owner-approved-reading-catalog-v1', sourceScope: 'owner_work_records_only',
      readOnly: true, providerCalls: 0, operatingWrites: 0, items: [{ workId: rowId(1),
        title: { value: 'Owned story', locale: 'ko', fallback: false, bounded: false }, defaultLocale: 'ko',
        recordedState: { workStatus: 'published', approval: 'not_checked' } }], nextCursor: null });
    expect(h.listRead).toHaveBeenCalledTimes(1); expect(h.listRead.mock.calls[0][0].values[5]).toBe(13);
    expect(h.trace).toEqual(['readOnly', 'list']); expect(h.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(h.cursorRead).not.toHaveBeenCalled(); noSideEffects(h);
  });

  it.each([1, 12, 20])('uses exactly one bounded parameterized list read and one lookahead for limit %s', async limit => {
    const h = fixture(Array.from({ length: limit + 1 }, (_value, index) => row(index + 1)));
    const result = await h.service.approvedReadingCatalog(ID.owner, query({ limit }));
    expect(result.items).toHaveLength(limit); expect(result.nextCursor).toBe(rowId(limit));
    expect(h.listRead).toHaveBeenCalledTimes(1); expect(h.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(h.listRead.mock.calls[0][0].values[5]).toBe(limit + 1); expect(h.cursorRead).not.toHaveBeenCalled(); noSideEffects(h);
  });

  it('returns an empty owner page without discovering another owner or fetching a profile', async () => {
    const h = fixture([]), result = await h.service.approvedReadingCatalog(ID.owner, query());
    expect(result.items).toEqual([]); expect(result.nextCursor).toBeNull(); noSideEffects(h);
  });

  it.each(['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'])('admits display locale %s without inventing the current manuscript source locale', async locale => {
    const h = fixture([row(1, { title: { [locale]: 'Localized title' } })]);
    const result = await h.service.approvedReadingCatalog(ID.owner, query({ locale }));
    expect(result.items[0].title).toMatchObject({ value: 'Localized title', locale, fallback: false });
    expect(result.items[0].defaultLocale).toBe('ko'); expect(result.items[0]).not.toHaveProperty('sourceLocale'); noSideEffects(h);
  });

  it('uses the established localized fallback without inventing approval', async () => {
    const h = fixture([row(1, { title: { ko: 'Fallback title' } })]);
    const result = await h.service.approvedReadingCatalog(ID.owner, query({ locale: 'en' }));
    expect(result.items[0].title).toMatchObject({ value: 'Fallback title', locale: 'ko', fallback: true });
    expect(result.items[0].recordedState.approval).toBe('not_checked'); noSideEffects(h);
  });

  const fallbackCases = [
    { defaultLocale: 'zh-Hans', title: { ko: 'Korean', en: 'English', 'zh-Hans': 'Default' }, expected: 'zh-Hans', value: 'Default' },
    { defaultLocale: 'ja', title: { ko: 'Korean', en: 'English' }, expected: 'ko', value: 'Korean' },
    { defaultLocale: 'ja', title: { en: 'English', 'zh-Hans': 'Simplified' }, expected: 'en', value: 'English' },
    { defaultLocale: 'ja', title: { 'zh-Hans': 'Simplified', 'zh-Hant': 'Traditional' }, expected: 'zh-Hans', value: 'Simplified' },
    { defaultLocale: 'ja', title: { 'zh-Hant': 'Traditional' }, expected: 'zh-Hant', value: 'Traditional' },
  ];
  it.each(fallbackCases)('preserves literal fallback ordering for $expected, after requested/default locale', async source => {
    const h = fixture([row(1, { defaultLocale: source.defaultLocale, title: source.title })]);
    const result = await h.service.approvedReadingCatalog(ID.owner, query({ locale: 'ja' }));
    expect(result.items[0].title).toEqual({ value: source.value, locale: source.expected, fallback: true, bounded: false }); noSideEffects(h);
  });

  it.each(['\t\n', '\u00a0', '\ufeff', '\u2003', '\u2028', '\u3000'])('skips only trim-empty candidates %s and preserves selected title whitespace', async blank => {
    const h = fixture([row(1, { title: { ja: blank, ko: blank, en: ' English title ' } })]);
    const result = await h.service.approvedReadingCatalog(ID.owner, query({ locale: 'ja' }));
    expect(result.items[0].title).toEqual({ value: ' English title ', locale: 'en', fallback: true, bounded: false }); noSideEffects(h);
  });

  it.each([{ title: null }, { title: [] }, { title: { ko: 123, en: false } }])('returns the established empty/default fallback for non-string JSON $title', async ({ title }) => {
    const h = fixture([row(1, { title })]), result = await h.service.approvedReadingCatalog(ID.owner, query());
    expect(result.items[0].title).toEqual({ value: '', locale: 'ko', fallback: true, bounded: false }); noSideEffects(h);
  });

  it('skips an invalid requested JSON value without skipping the valid default string', async () => {
    const h = fixture([row(1, { title: { en: { private: 'not a string' }, ko: 'Default title' } })]);
    const result = await h.service.approvedReadingCatalog(ID.owner, query({ locale: 'en' }));
    expect(result.items[0].title).toEqual({ value: 'Default title', locale: 'ko', fallback: true, bounded: false }); noSideEffects(h);
  });

  it.each([[256, false], [257, true], [1024, true]] as const)('bounds %s Unicode title code points without mutating stored data', async (length, bounded) => {
    const title = Object.freeze({ ko: '\uD83D\uDE00'.repeat(length) }), source = Object.freeze(row(1, { title }));
    const h = fixture([source]), result = await h.service.approvedReadingCatalog(ID.owner, query());
    expect(Array.from(result.items[0].title.value)).toHaveLength(256); expect(result.items[0].title.bounded).toBe(bounded);
    expect(title.ko).toBe('\uD83D\uDE00'.repeat(length)); expect(h.rows[0]).toBe(source); noSideEffects(h);
  });

  it.each(['\n', '\u0000', '\u200b'])('fails closed on title control content %s without returning a partial page', async character => {
    const h = fixture([row(), row(2, { title: { ko: 'Hidden' + character } })]);
    await failure(h.service.approvedReadingCatalog(ID.owner, query()), ServiceUnavailableException, 'STORY_APPROVED_READING_CATALOG_UNAVAILABLE');
    noSideEffects(h);
  });

  it.each(['\n', '\u200b', '\uD804\uDCBD', '\uDB40\uDC01'])('rejects a control beyond the bounded prefix %s via the full-value DB flag', async character => {
    const h = fixture([row(1, { title: { ko: 'a'.repeat(256) + character } })]);
    await failure(h.service.approvedReadingCatalog(ID.owner, query()), ServiceUnavailableException, 'STORY_APPROVED_READING_CATALOG_UNAVAILABLE');
    const projected = await h.listRead.mock.results[0].value;
    expect(projected[0].titleValue).toBe('a'.repeat(256)); expect(projected[0].titleInvalid).toBe(true); noSideEffects(h);
  });

  const badProjections: Array<[string, Record<string, unknown>]> = [
    ['unbounded title scalar', { titleValue: 'a'.repeat(257) }], ['JSON instead of scalar', { titleValue: { ko: 'Private' } }],
    ['null title scalar', { titleValue: null }], ['missing invalid flag', { titleInvalid: undefined }],
    ['string invalid flag', { titleInvalid: 'false' }], ['string bounded flag', { titleBounded: 'false' }],
    ['string fallback flag', { titleFallback: 'false' }], ['incorrect fallback flag', { titleFallback: true }],
    ['unknown selected locale', { titleLocale: 'fr' }],
  ];
  it.each(badProjections)('fails closed on malformed DB projection %s without returning a partial page', async (_label, changes) => {
    const h = fixture(), read = h.listRead.getMockImplementation()!;
    h.listRead.mockImplementation(async sql => { const result = await read(sql); return [{ ...result[0], ...changes }] as typeof result; });
    await failure(h.service.approvedReadingCatalog(ID.owner, query()), ServiceUnavailableException, 'STORY_APPROVED_READING_CATALOG_UNAVAILABLE'); noSideEffects(h);
  });

  it('rejects the complete response above 8KiB instead of silently shortening the page', async () => {
    const h = fixture(Array.from({ length: 20 }, (_value, index) => row(index + 1, { title: { ko: '\uD83D\uDE00'.repeat(256) } })));
    await failure(h.service.approvedReadingCatalog(ID.owner, query({ limit: 20 })), ServiceUnavailableException, 'STORY_APPROVED_READING_CATALOG_RESPONSE_TOO_LARGE');
    expect(h.listRead).toHaveBeenCalledTimes(1); noSideEffects(h);
  });

  it('admits exactly 8192 JSON UTF-8 bytes but rejects one additional byte without returning a prefix', async () => {
    const rows = Array.from({ length: 20 }, (_value, index) => row(index + 1, { title: { ko: 'a', en: 'a' } }));
    const h = fixture(rows), base = await h.service.approvedReadingCatalog(ID.owner, query({ limit: 20 }));
    let remaining = 8192 - Buffer.byteLength(JSON.stringify(base), 'utf8');
    expect(remaining).toBeGreaterThan(0);
    for (const source of rows) {
      const extra = Math.min(255, remaining); source.title.ko += 'a'.repeat(extra); remaining -= extra;
    }
    expect(remaining).toBe(0);
    const exact = await h.service.approvedReadingCatalog(ID.owner, query({ limit: 20 }));
    expect(Buffer.byteLength(JSON.stringify(exact), 'utf8')).toBe(8192);
    rows.find(source => source.title.ko.length < 256)!.title.ko += 'a';
    await failure(h.service.approvedReadingCatalog(ID.owner, query({ limit: 20 })), ServiceUnavailableException, 'STORY_APPROVED_READING_CATALOG_RESPONSE_TOO_LARGE');
    noSideEffects(h);
  });

  it('rejects a mock returning more than the single allowed lookahead instead of serving a partial list', async () => {
    const h = fixture(Array.from({ length: 14 }, (_value, index) => row(index + 1)));
    await failure(h.service.approvedReadingCatalog(ID.owner, query()), ServiceUnavailableException, 'STORY_APPROVED_READING_CATALOG_UNAVAILABLE');
    expect(h.listRead).toHaveBeenCalledTimes(1); noSideEffects(h);
  });

  const invalid: Array<[string, unknown]> = [
    ['null query', null], ['missing query', undefined], ['array query', []], ['string query', 'query'],
    ['null locale', { locale: null }], ['unknown locale', { locale: 'fr' }], ['repeated locale', { locale: ['ko', 'en'] }],
    ['null limit', { limit: null }], ['zero limit', { limit: 0 }], ['high limit', { limit: 21 }], ['negative limit', { limit: -1 }],
    ['fraction limit', { limit: 1.5 }], ['NaN limit', { limit: NaN }], ['Infinity limit', { limit: Infinity }],
    ['empty limit', { limit: '' }], ['leading-zero limit', { limit: '01' }], ['exponent limit', { limit: '1e1' }],
    ['hex limit', { limit: '0x10' }], ['spaced limit', { limit: ' 2 ' }], ['repeated limit', { limit: ['2'] }], ['high string limit', { limit: '21' }],
    ['null cursor', { cursor: null }], ['invalid cursor', { cursor: 'bad' }], ['spaced cursor', { cursor: ' ' + ID.cursor }],
    ['repeated cursor', { cursor: [ID.cursor] }], ['delegated owner', { ownerUserId: ID.other }], ['unsupported filter', { q: 'private' }],
  ];
  it.each(invalid)('rejects %s before any transaction or data query', async (_label, input) => {
    const h = fixture();
    await failure(h.service.approvedReadingCatalog(ID.owner, input as StoryApprovedReadingCatalogQueryDto), BadRequestException, 'STORY_APPROVED_READING_CATALOG_INPUT_INVALID');
    expect(h.prisma.$transaction).not.toHaveBeenCalled(); expect(h.tx.$executeRaw).not.toHaveBeenCalled(); noSideEffects(h);
  });

  it.each(['', '00000000-0000-0000-0000-000000000000', null])('rejects invalid owner %s before queries without adding a new role policy', async owner => {
    const h = fixture();
    await failure(h.service.approvedReadingCatalog(owner as string, query()), BadRequestException, 'STORY_APPROVED_READING_CATALOG_INPUT_INVALID');
    expect(h.prisma.$transaction).not.toHaveBeenCalled(); noSideEffects(h);
  });

  it('validates an uppercase cursor within owner scope and preserves its exact microsecond keyset boundary', async () => {
    const h = fixture(); await h.service.approvedReadingCatalog(ID.owner.toUpperCase(), query({ cursor: ID.cursor.toUpperCase() }));
    expect(h.trace).toEqual(['readOnly', 'cursor', 'list']); expect(h.tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(h.cursorRead).toHaveBeenCalledTimes(1); expect(h.listRead).toHaveBeenCalledTimes(1);
    expect(h.listRead.mock.calls[0][0].values.slice(5, 8)).toEqual([stamp, ID.cursor, 13]); noSideEffects(h);
  });

  it.each(['2026-10-13T01:02:03.123001Z', '2026-10-13T01:02:03.123999Z'])('binds exact six-digit boundary %s as text, never as a Prisma DateTime filter', async updatedAt => {
    const h = fixture([row()], updatedAt); await h.service.approvedReadingCatalog(ID.owner, query({ cursor: ID.cursor }));
    const sql = h.listRead.mock.calls[0][0]; expect(sql.values[5]).toBe(updatedAt); expect(sql.values[5]).not.toBeInstanceOf(Date);
    expect(sql.text).toContain('(updated_at, id) < ($6::timestamptz, $7::uuid)');
    expect(h.tx.$queryRaw).toHaveBeenCalledTimes(2); noSideEffects(h);
  });

  const badAnchors: Array<[string, Partial<Anchor> | null]> = [
    ['absent', null], ['foreign owner', { ownerUserId: ID.other }], ['fixture', { fixtureSource: true }],
    ['different id', { id: ID.other }], ['invalid timestamp', { updatedAt: 'private-invalid' }],
    ['normalized invalid date', { updatedAt: '2026-02-30T01:02:03.123456Z' }],
  ];
  it.each(badAnchors)('returns the same generic 404 for cursor %s without listing any work', async (_label, changes) => {
    const h = fixture(), execute = h.cursorRead.getMockImplementation()!;
    h.cursorRead.mockImplementation(async sql => { const anchors = await execute(sql); return changes ? [{ ...anchors[0], ...changes }] : []; });
    const error = await failure(h.service.approvedReadingCatalog(ID.owner, query({ cursor: ID.cursor })), NotFoundException, 'STORY_APPROVED_READING_CATALOG_NOT_FOUND');
    expect((error as NotFoundException).getResponse()).toEqual({ code: 'STORY_APPROVED_READING_CATALOG_NOT_FOUND' });
    expect(h.listRead).not.toHaveBeenCalled(); noSideEffects(h);
  });

  const badLists: Array<[string, Row[]]> = [
    ['foreign owner', [row(1, { ownerUserId: ID.other })]], ['fixture', [row(1, { fixtureSource: true })]],
    ['duplicate id', [row(), row()]], ['invalid locale', [row(1, { defaultLocale: 'fr' })]],
    ['invalid record state', [row(1, { status: 'private@example.invalid' })]],
  ];
  it.each(badLists)('rejects malformed list %s without exposing any row', async (_label, rows) => {
    const h = fixture(rows); await failure(h.service.approvedReadingCatalog(ID.owner, query()), ServiceUnavailableException, 'STORY_APPROVED_READING_CATALOG_UNAVAILABLE');
    noSideEffects(h);
  });

  it('a failed READ ONLY statement cannot fall back to an unguarded read', async () => {
    const h = fixture(); h.tx.$executeRaw.mockRejectedValue(new Error('Synthetic read-mode failure'));
    await failure(h.service.approvedReadingCatalog(ID.owner, query()), ServiceUnavailableException, 'STORY_APPROVED_READING_CATALOG_UNAVAILABLE');
    expect(h.tx.$queryRaw).not.toHaveBeenCalled(); expect(h.listRead).not.toHaveBeenCalled(); noSideEffects(h);
  });

  it.each([new Error('Private body/token/db details'), new ServiceUnavailableException({ private: 'profile facts' })])
    ('masks source failures rather than returning raw private details: %s', async error => {
      const h = fixture(); h.listRead.mockRejectedValue(error);
      const result = await failure(h.service.approvedReadingCatalog(ID.owner, query()), ServiceUnavailableException, 'STORY_APPROVED_READING_CATALOG_UNAVAILABLE');
      expect((result as ServiceUnavailableException).getResponse()).toEqual({ code: 'STORY_APPROVED_READING_CATALOG_UNAVAILABLE' }); noSideEffects(h);
    });
});

describe('approved-reading DTO/controller source boundary', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true });
  const meta = { type: 'query' as const, metatype: StoryApprovedReadingCatalogQueryDto };
  it('uses independent DTO defaults without widening the existing catalog DTO', async () => {
    expect(await pipe.transform({}, meta)).toMatchObject({ locale: 'ko', limit: 12 });
  });
  it('transforms only canonical integer query strings and preserves the validated cursor', async () => {
    expect(await pipe.transform({ limit: '20', locale: 'zh-Hant', cursor: ID.cursor }, meta)).toMatchObject({ limit: 20, locale: 'zh-Hant', cursor: ID.cursor });
  });
  it.each([{ locale: 'fr' }, { limit: '0x10' }, { limit: ['2'] }, { cursor: null }, { cursor: 'bad' }, { ownerUserId: ID.other }])
    ('rejects malformed or delegated HTTP DTO input %s', async input => { await expect(pipe.transform(input, meta)).rejects.toBeInstanceOf(BadRequestException); });

  it('retains cache-before-JWT order and exposes only the exact GET route', () => {
    const method = StoryProductionController.prototype.approvedReadingCatalog;
    const guards = Reflect.getMetadata(GUARDS_METADATA, method);
    expect(guards).toHaveLength(2); expect(guards[0].name).toBe('CreatorCatalogNoStoreGuard'); expect(guards[1]).toBe(JwtAuthGuard);
    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe('me/creator-studio/approved-reading-catalog');
    expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(0);
  });
  it('the reused first guard sets private no-store headers and merges Authorization before auth', () => {
    const method = StoryProductionController.prototype.approvedReadingCatalog, guards = Reflect.getMetadata(GUARDS_METADATA, method);
    const headers: Record<string, string> = { Vary: 'Accept-Encoding' };
    const response = { setHeader: (name: string, value: string) => { headers[name] = value; },
      vary: (field: string) => { headers.Vary += ', ' + field; } };
    const context = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ExecutionContext;
    expect(new guards[0]().canActivate(context)).toBe(true);
    expect(headers).toEqual({ Vary: 'Accept-Encoding, Authorization', 'Cache-Control': 'private, no-store', Pragma: 'no-cache', Expires: '0' });
  });
  it('forwards only CurrentUser owner and query without invoking Studio bootstrap', async () => {
    const approvedReadingCatalog = jest.fn(async () => ({ readOnly: true })), getStudio = jest.fn(() => { throw new Error('Studio forbidden'); });
    const controller = new StoryProductionController({ approvedReadingCatalog } as never, {} as never, undefined, undefined, { getStudio } as never);
    const input = query(); await controller.approvedReadingCatalog({ id: ID.owner }, input);
    expect(approvedReadingCatalog).toHaveBeenCalledWith(ID.owner, input); expect(getStudio).not.toHaveBeenCalled();
  });
});
