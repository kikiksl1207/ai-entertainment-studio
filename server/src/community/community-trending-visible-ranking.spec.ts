import { BadRequestException } from '@nestjs/common';
import type { FeedSearchBlockedTerm, FeedSearchEvent, Prisma } from '@prisma/client';
import { CommunityService } from './community.service';

const NOW = new Date('2026-10-10T01:00:00.000Z');
const MINUTE = 60_000;
const DIMENSIONS = ['normalizedKeyword', 'searchType', 'language'];
const GROUP_ORDER = [
  { _count: { normalizedKeyword: 'desc' } },
  { _max: { createdAt: 'desc' } },
];
type EventRow = Pick<FeedSearchEvent,
  'id' | 'keyword' | 'normalizedKeyword' | 'searchType' | 'language' | 'createdAt'
  | 'userId' | 'visitorHash'>;
type BlockRow = Pick<FeedSearchBlockedTerm,
  'normalizedKeyword' | 'searchType' | 'language' | 'status'>;
type Group = Pick<EventRow, 'normalizedKeyword' | 'searchType' | 'language'> & {
  _count: { _all: number };
  _max: { createdAt: Date };
};
let eventSequence = 0;
const readOnlyChecks: Array<() => void> = [];

function events(keyword: string, count: number, minutesAgo = 1,
  overrides: Partial<EventRow> = {}): EventRow[] {
  return Array.from({ length: count }, (_, index) => {
    const sequence = ++eventSequence;
    return {
      id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
      userId: null, visitorHash: sequence.toString(16).padStart(64, '0'),
      keyword, normalizedKeyword: keyword, searchType: 'text', language: 'en',
      createdAt: new Date(NOW.getTime() - minutesAgo * MINUTE - index * 1000),
      ...overrides,
    };
  });
}

function block(keyword: string, overrides: Partial<BlockRow> = {}): BlockRow {
  return { normalizedKeyword: keyword, searchType: 'all', language: 'all',
    status: 'active', ...overrides };
}

function predicates(value: unknown): object[] {
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Unsupported fixture predicate');
    }
  }
  return items as object[];
}

// Evaluate the supplied Prisma predicates; never remove blocked rows independently.
function matches(row: object, where?: object): boolean {
  const data = row as Record<string, unknown>;
  return Object.entries(where ?? {}).every(([field, condition]) => {
    if (condition === undefined) return true;
    if (field === 'AND') return predicates(condition).every(item => matches(row, item));
    if (field === 'OR') {
      const items = predicates(condition);
      if (!items.length) throw new Error('Empty OR is outside the fixture contract');
      return items.some(item => matches(row, item));
    }
    if (field === 'NOT') return predicates(condition).every(item => !matches(row, item));
    if (!['normalizedKeyword', 'searchType', 'language', 'status', 'createdAt'].includes(field)) {
      throw new Error(`Unsupported fixture field: ${field}`);
    }
    const value = data[field];
    if (condition instanceof Date) return value instanceof Date
      && value.getTime() === condition.getTime();
    if (condition === null || typeof condition !== 'object') return value === condition;
    return Object.entries(condition).every(([operator, operand]) => {
      if (operator === 'equals') return value === operand;
      if (operator === 'in' && Array.isArray(operand)) return operand.includes(value);
      if (operator === 'gte' && value instanceof Date && operand instanceof Date) {
        return value.getTime() >= operand.getTime();
      }
      throw new Error(`Unsupported fixture operator: ${operator}`);
    });
  });
}

function dimensionKey(row: object, fields: string[]): string {
  const data = row as Record<string, unknown>;
  return JSON.stringify(fields.map(field => data[field]));
}

function fixture(rows: EventRow[] = [], blocks: BlockRow[] = []) {
  const before = JSON.stringify({ rows, blocks });
  const forbidden = () => { throw new Error('Trending fixture forbids writes and raw queries'); };
  const writes = {
    create: jest.fn(forbidden), createMany: jest.fn(forbidden),
    update: jest.fn(forbidden), updateMany: jest.fn(forbidden), upsert: jest.fn(forbidden),
    delete: jest.fn(forbidden), deleteMany: jest.fn(forbidden),
  };
  const prisma = {
    $transaction: jest.fn(forbidden), $queryRaw: jest.fn(forbidden),
    $queryRawUnsafe: jest.fn(forbidden), $executeRaw: jest.fn(forbidden),
    $executeRawUnsafe: jest.fn(forbidden),
    feedSearchBlockedTerm: {
      findMany: jest.fn(async (args: Prisma.FeedSearchBlockedTermFindManyArgs) => {
        expect(Object.keys(args).sort()).toEqual(['select', 'where']);
        expect(args.select).toEqual({ normalizedKeyword: true, searchType: true, language: true });
        return blocks.filter(row => matches(row, args.where)).map(row =>
          Object.fromEntries(Object.keys(args.select!).map(field =>
            [field, row[field as keyof BlockRow]])));
      }),
    },
    feedSearchEvent: {
      ...writes,
      groupBy: jest.fn(async (args: Prisma.FeedSearchEventGroupByArgs) => {
        expect(Object.keys(args).sort()).toEqual(['_count', '_max', 'by', 'orderBy', 'take', 'where']);
        expect(args.by).toEqual(DIMENSIONS);
        expect(args._count).toEqual({ _all: true });
        expect(args._max).toEqual({ createdAt: true });
        expect(args.orderBy).toEqual(GROUP_ORDER);
        if (args.take === undefined) throw new Error('Fixture requires a bounded take');
        expect(Number.isInteger(args.take)).toBe(true);
        expect(args.take).toBeGreaterThan(0);
        expect(args.take).toBeLessThanOrEqual(100);
        const grouped = new Map<string, Group>();
        const fields = args.by as string[];
        for (const row of rows.filter(item => matches(item, args.where))) {
          const key = dimensionKey(row, fields);
          const previous = grouped.get(key);
          if (previous) {
            previous._count._all++;
            if (row.createdAt > previous._max.createdAt) previous._max.createdAt = row.createdAt;
          } else {
            grouped.set(key, { normalizedKeyword: row.normalizedKeyword,
              searchType: row.searchType, language: row.language,
              _count: { _all: 1 }, _max: { createdAt: row.createdAt } });
          }
        }
        const ordering = args.orderBy as Array<{
          _count?: { normalizedKeyword: 'asc' | 'desc' };
          _max?: { createdAt: 'asc' | 'desc' };
        }>;
        return [...grouped.values()].sort((left, right) => {
          for (const order of ordering) {
            const difference = order._count ? left._count._all - right._count._all
              : left._max.createdAt.getTime() - right._max.createdAt.getTime();
            const direction = order._count?.normalizedKeyword ?? order._max?.createdAt;
            if (difference) return direction === 'desc' ? -difference : difference;
          }
          return 0;
        }).slice(0, args.take);
      }),
      findMany: jest.fn(async (args: Prisma.FeedSearchEventFindManyArgs) => {
        expect(Object.keys(args).sort()).toEqual(['distinct', 'orderBy', 'where']);
        expect(args.orderBy).toEqual({ createdAt: 'desc' });
        expect(args.distinct).toEqual(DIMENSIONS);
        const seen = new Set<string>();
        return rows.filter(row => matches(row, args.where))
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
          .filter(row => {
            const key = dimensionKey(row, args.distinct as string[]);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }).map(row => ({ ...row }));
      }),
    },
  };
  readOnlyChecks.push(() => {
    expect(JSON.stringify({ rows, blocks })).toBe(before);
    for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled();
    for (const raw of [prisma.$transaction, prisma.$queryRaw, prisma.$queryRawUnsafe,
      prisma.$executeRaw, prisma.$executeRawUnsafe]) expect(raw).not.toHaveBeenCalled();
  });
  return { prisma, service: new CommunityService(prisma as never, {} as never, {} as never) };
}

describe('feed trending visible ranking', () => {
  beforeEach(() => {
    eventSequence = 0;
    readOnlyChecks.length = 0;
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  });
  afterEach(() => {
    try { for (const check of readOnlyChecks) check(); }
    finally { jest.restoreAllMocks(); }
  });

  test('FEED-VISIBLE-RED returns the allowed fourth group after three blocked leaders at take one', async () => {
    const f = fixture([...events('blocked-a', 4), ...events('blocked-b', 3),
      ...events('blocked-c', 2), ...events('visible', 1)],
    ['blocked-a', 'blocked-b', 'blocked-c'].map(keyword => block(keyword)));
    const result = await f.service.getTrendingSearches({ language: 'en', type: 'text', window: '1h', take: '1' });
    expect(result.items).toEqual([expect.objectContaining({
      normalizedKeyword: 'visible', searchCount: 1, rank: 1, type: 'text', language: 'en',
    })]);
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].take).toBe(3);
    expect(f.prisma.feedSearchEvent.groupBy).toHaveBeenCalledTimes(1);
  });

  test('FEED-VISIBLE-RED fills the UI top ten beyond thirty blocked leaders without raising the limit', async () => {
    const blocked = Array.from({ length: 30 }, (_, index) => `blocked-${index}`);
    const visible = Array.from({ length: 10 }, (_, index) => `visible-${index}`);
    const f = fixture([...blocked.flatMap(keyword => events(keyword, 2)),
      ...visible.flatMap((keyword, index) => events(keyword, 1, index + 2))], blocked.map(keyword => block(keyword)));
    const result = await f.service.getTrendingSearches({ language: 'en', type: 'all', window: '1h', take: '10' });
    expect(result.items.map(item => item.normalizedKeyword)).toEqual(visible);
    expect(result.items.map(item => item.rank)).toEqual(visible.map((_, index) => index + 1));
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].take).toBe(30);
    expect(f.prisma.feedSearchEvent.groupBy).toHaveBeenCalledTimes(1);
  });

  test('FEED-VISIBLE-RED fills an underfilled prefix containing one allowed group', async () => {
    const blocked = Array.from({ length: 5 }, (_, index) => `blocked-${index}`);
    const f = fixture([...blocked.flatMap(keyword => events(keyword, 3)),
      ...events('visible-first', 2), ...events('visible-second', 1)], blocked.map(keyword => block(keyword)));
    const result = await f.service.getTrendingSearches({ language: 'en', type: 'text', take: '2' });
    expect(result.items.map(item => [item.normalizedKeyword, item.searchCount, item.rank]))
      .toEqual([['visible-first', 2, 1], ['visible-second', 1, 2]]);
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].take).toBe(6);
  });

  test('FEED-VISIBLE-RED sends exact blocked scope NOT OR predicates before grouping', async () => {
    const f = fixture(events('visible', 1), [block('global'), block('language', { language: 'en' }),
      block('type', { searchType: 'text' }), block('exact', { searchType: 'hashtag', language: 'ja' })]);
    await f.service.getTrendingSearches({ language: 'all', type: 'all', take: '1' });
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].where).toEqual({
      createdAt: { gte: new Date(NOW.getTime() - 60 * MINUTE) },
      NOT: { OR: [{ normalizedKeyword: 'global' }, { normalizedKeyword: 'language', language: 'en' },
        { normalizedKeyword: 'type', searchType: 'text' },
        { normalizedKeyword: 'exact', searchType: 'hashtag', language: 'ja' }] },
    });
  });

  test('all-scope blocks every matching dimension but not a keyword prefix', async () => {
    const f = fixture([...events('hidden', 3), ...events('hidden', 2, 1, { searchType: 'hashtag' }),
      ...events('hidden', 1, 1, { language: 'ja' }), ...events('hidden-long', 1)], [block('hidden')]);
    const result = await f.service.getTrendingSearches({ language: 'all', type: 'all', take: '10' });
    expect(result.items.map(item => item.normalizedKeyword)).toEqual(['hidden-long']);
    expect(result.language).toBe('all');
    expect(result.type).toBe('all');
  });

  test('exact scope keeps the same keyword in other languages and search types', async () => {
    const f = fixture([...events('paired', 3), ...events('paired', 2, 1, { searchType: 'hashtag' }),
      ...events('paired', 1, 1, { language: 'ja' })],
    [block('paired', { searchType: 'text', language: 'en' }), block('unrelated')]);
    const result = await f.service.getTrendingSearches({ language: 'all', type: 'all', take: '10' });
    expect(result.items.map(item => [item.type, item.language, item.searchCount]))
      .toEqual([['hashtag', 'en', 2], ['text', 'ja', 1]]);
  });

  test('blocked findMany applies active status and requested or all language and selects only scope fields', async () => {
    const f = fixture([...events('visible', 1, 1, { language: 'ja' }),
      ...events('local-hidden', 2, 1, { language: 'ja' }), ...events('global-hidden', 3, 1, { language: 'ja' })],
    [block('visible', { language: 'en' }), block('local-hidden', { language: 'ja' }),
      block('global-hidden'), block('visible', { language: 'ja', status: 'inactive' })]);
    const result = await f.service.getTrendingSearches({ language: 'ja', type: 'text', take: '10' });
    expect(result.items.map(item => item.normalizedKeyword)).toEqual(['visible']);
    expect(f.prisma.feedSearchBlockedTerm.findMany).toHaveBeenCalledWith({
      where: { status: 'active', language: { in: ['all', 'ja'] } },
      select: { normalizedKeyword: true, searchType: true, language: true },
    });
    expect(await f.prisma.feedSearchBlockedTerm.findMany.mock.results[0].value).toEqual([
      { normalizedKeyword: 'local-hidden', searchType: 'all', language: 'ja' },
      { normalizedKeyword: 'global-hidden', searchType: 'all', language: 'all' },
    ]);
  });

  test('inactive rules neither hide a leader nor add an empty exclusion', async () => {
    const f = fixture([...events('visible', 3), ...events('runner-up', 2)], [block('visible', { status: 'inactive' })]);
    const result = await f.service.getTrendingSearches({ language: 'en', take: '1' });
    expect(result.items.map(item => [item.normalizedKeyword, item.searchCount])).toEqual([['visible', 3]]);
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].where?.NOT).toBeUndefined();
  });

  test('keeps original event counts and count then latest ordering with contiguous ranks', async () => {
    const f = fixture([...events('most-searched', 3, 10), ...events('tie-newer', 2, 1),
      ...events('tie-older', 2, 2), ...events('recent-single', 1, 0)]);
    const result = await f.service.getTrendingSearches({ language: 'en', type: 'text', take: '4' });
    expect(result.items.map(item => [item.normalizedKeyword, item.searchCount, item.rank])).toEqual([
      ['most-searched', 3, 1], ['tie-newer', 2, 2], ['tie-older', 2, 3], ['recent-single', 1, 4],
    ]);
    expect(result.policy).toMatchObject({ dedupeWindowMinutes: 10, blockedTermFiltering: true,
      defaultTrendingWindow: '1h', trendingWindows: ['15m', '1h', '6h', '24h', '7d'] });
  });

  test('default hour includes the exact boundary and applies requested language and type', async () => {
    const f = fixture([...events('boundary', 1, 60), ...events('inside', 2, 59),
      ...events('too-old', 4, 61), ...events('other-language', 4, 1, { language: 'ja' }),
      ...events('other-type', 4, 1, { searchType: 'hashtag' })]);
    const result = await f.service.getTrendingSearches({ locale: 'en-US', type: 'text', take: '10' });
    expect(result.items.map(item => [item.normalizedKeyword, item.searchCount])).toEqual([['inside', 2], ['boundary', 1]]);
    expect(result.window).toEqual({ key: '1h', since: new Date(NOW.getTime() - 60 * MINUTE), minutes: 60 });
    expect(result.generatedAt).toBeInstanceOf(Date);
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].where).toEqual({
      createdAt: { gte: result.window.since }, language: 'en', searchType: 'text',
    });
  });

  const windows: Array<[string, number]> = [['15m', 15], ['7d', 7 * 24 * 60]];
  test.each(windows)('keeps the %s requested window with inclusive boundary and older exclusion', async (window, minutes) => {
    const f = fixture([...events('boundary', 1, minutes), ...events('outside', 2, minutes + 1)]);
    const result = await f.service.getTrendingSearches({ language: 'en', type: 'text', window, take: '10' });
    expect(result.items.map(item => item.normalizedKeyword)).toEqual(['boundary']);
    expect(result.window).toEqual({ key: window, since: new Date(NOW.getTime() - minutes * MINUTE), minutes });
  });

  test('keeps the maximum fifty output and one hundred grouped candidates', async () => {
    const keywords = Array.from({ length: 120 }, (_, index) => `visible-${index}`);
    const f = fixture(keywords.flatMap((keyword, index) => events(keyword, 1, index / 3)));
    const result = await f.service.getTrendingSearches({ language: 'en', take: '500' });
    expect(result.items.map(item => item.normalizedKeyword)).toEqual(keywords.slice(0, 50));
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].take).toBe(100);
    expect(await f.prisma.feedSearchEvent.groupBy.mock.results[0].value).toHaveLength(100);
    expect(f.prisma.feedSearchEvent.groupBy).toHaveBeenCalledTimes(1);
  });

  test('latest label lookup honors exact dimensions date order and distinct keys', async () => {
    const f = fixture([...events('label', 1, 10, { keyword: 'Older label' }),
      ...events('label', 1, 1, { keyword: 'Latest label' }),
      ...events('label', 1, 0, { keyword: 'Wrong language label', language: 'ja' }),
      ...events('label', 1, 0, { keyword: 'Wrong type label', searchType: 'hashtag' }),
      ...events('unselected', 1, 0)]);
    const result = await f.service.getTrendingSearches({ language: 'en', type: 'text', take: '1' });
    expect(result.items).toEqual([expect.objectContaining({ keyword: 'Latest label',
      normalizedKeyword: 'label', searchCount: 2, lastSearchedAt: new Date(NOW.getTime() - MINUTE) })]);
    expect(f.prisma.feedSearchEvent.findMany).toHaveBeenCalledWith({
      where: { OR: [{ normalizedKeyword: 'label', searchType: 'text', language: 'en' }] },
      orderBy: { createdAt: 'desc' }, distinct: DIMENSIONS,
    });
  });

  test('empty events and empty blocked conditions stay empty without labels or an empty NOT OR', async () => {
    const f = fixture();
    const result = await f.service.getTrendingSearches({ language: 'all', type: 'all', take: '1' });
    expect(result.items).toEqual([]);
    expect(f.prisma.feedSearchBlockedTerm.findMany).toHaveBeenCalledWith({
      where: { status: 'active', language: undefined },
      select: { normalizedKeyword: true, searchType: true, language: true },
    });
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].where?.NOT).toBeUndefined();
    expect(f.prisma.feedSearchEvent.findMany).not.toHaveBeenCalled();
  });

  test('a genuinely all-blocked window remains empty without a label lookup', async () => {
    const f = fixture([...events('hidden-a', 2), ...events('hidden-b', 1)], [block('hidden-a'), block('hidden-b')]);
    const result = await f.service.getTrendingSearches({ language: 'en', type: 'text', take: '1' });
    expect(result.items).toEqual([]);
    expect(f.prisma.feedSearchEvent.findMany).not.toHaveBeenCalled();
  });

  test('invalid window rejects before blocked term or event reads', async () => {
    const f = fixture(events('visible', 1));
    await expect(f.service.getTrendingSearches({ language: 'en', window: 'invalid', take: '1' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(f.prisma.feedSearchBlockedTerm.findMany).not.toHaveBeenCalled();
    expect(f.prisma.feedSearchEvent.groupBy).not.toHaveBeenCalled();
    expect(f.prisma.feedSearchEvent.findMany).not.toHaveBeenCalled();
  });
});
