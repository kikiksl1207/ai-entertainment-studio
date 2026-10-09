import { BadRequestException } from '@nestjs/common';
import type {
  Artist, CommunityPost, FeedSearchBlockedTerm, FeedSearchEvent, Prisma, User, UserProfile,
} from '@prisma/client';
import { CommunityService } from './community.service';

const NOW = new Date('2026-10-10T01:00:00.000Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const DIMENSIONS = ['normalizedKeyword', 'searchType', 'language'];
const GROUP_ORDER = [
  { _count: { normalizedKeyword: 'desc' } }, { _max: { createdAt: 'desc' } },
];
type EventRow = Pick<FeedSearchEvent,
  'id' | 'keyword' | 'normalizedKeyword' | 'searchType' | 'language' | 'createdAt' | 'resultCount'>;
type BlockRow = Pick<FeedSearchBlockedTerm,
  'normalizedKeyword' | 'searchType' | 'language' | 'status'>;
type PostRow = Pick<CommunityPost,
  'id' | 'body' | 'status' | 'visibility' | 'deletedAt' | 'publishedAt'>;
type ArtistRow = Pick<Artist, 'id' | 'slug' | 'displayName' | 'status'>;
type UserRow = Pick<User, 'id' | 'status' | 'deletedAt' | 'createdAt'> & {
  profile: Pick<UserProfile, 'displayName' | 'publicHandle'>;
};
type Group = Pick<EventRow, 'normalizedKeyword' | 'searchType' | 'language'> & {
  _count: { _all: number }; _max: { createdAt: Date };
};
type FixtureData = {
  events?: EventRow[]; blocks?: BlockRow[]; posts?: PostRow[];
  artists?: ArtistRow[]; users?: UserRow[];
};
let sequence = 0;
const readOnlyChecks: Array<() => void> = [];

function id() {
  return `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
}

function event(keyword: string, overrides: Partial<EventRow> = {}): EventRow {
  return { id: id(), keyword, normalizedKeyword: keyword.toLowerCase(), searchType: 'text',
    language: 'en', createdAt: new Date(NOW.getTime() - MINUTE), resultCount: 0, ...overrides };
}

function events(keyword: string, count: number, overrides: Partial<EventRow> = {}): EventRow[] {
  return Array.from({ length: count }, (_, index) => event(keyword, {
    createdAt: new Date(NOW.getTime() - MINUTE - index * 1000), ...overrides,
  }));
}

function block(normalizedKeyword: string, overrides: Partial<BlockRow> = {}): BlockRow {
  return { normalizedKeyword, searchType: 'all', language: 'all', status: 'active', ...overrides };
}

function predicates(value: unknown): object[] {
  const items = Array.isArray(value) ? value : [value];
  if (items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('Unsupported fixture predicate');
  }
  return items as object[];
}

// This interpreter sees only supplied predicates, never the fixture's blocked-rule list.
function matches(row: object, where?: object): boolean {
  const data = row as Record<string, unknown>;
  return Object.entries(where ?? {}).every(([field, condition]) => {
    if (condition === undefined) return true;
    if (field === 'AND') return predicates(condition).every(item => matches(row, item));
    if (field === 'OR') return predicates(condition).some(item => matches(row, item));
    if (field === 'NOT') return predicates(condition).every(item => !matches(row, item));
    if (!['normalizedKeyword', 'searchType', 'language', 'status', 'createdAt', 'body',
      'visibility', 'deletedAt', 'publishedAt', 'displayName', 'slug', 'profile', 'publicHandle']
      .includes(field)) throw new Error(`Unsupported fixture field: ${field}`);
    const value = data[field];
    if (condition instanceof Date) return value instanceof Date
      && value.getTime() === condition.getTime();
    if (condition === null || typeof condition !== 'object') return value === condition;
    const filter = condition as Record<string, unknown>;
    const insensitive = filter.mode === 'insensitive';
    const comparable = (item: unknown) => insensitive && typeof item === 'string'
      ? item.toLowerCase() : item;
    return Object.entries(filter).every(([operator, operand]) => {
      if (operator === 'mode') return operand === 'insensitive' || operand === 'default';
      if (operator === 'equals') return comparable(value) === comparable(operand);
      if (operator === 'contains' && typeof value === 'string' && typeof operand === 'string') {
        return (comparable(value) as string).includes(comparable(operand) as string);
      }
      if (operator === 'in' && Array.isArray(operand)) return operand.includes(value);
      if (operator === 'gte' && value instanceof Date && operand instanceof Date) {
        return value.getTime() >= operand.getTime();
      }
      if (operator === 'is' && value && typeof value === 'object'
        && operand && typeof operand === 'object') return matches(value, operand);
      throw new Error(`Unsupported fixture operator: ${operator}`);
    });
  });
}

function dimensionKey(row: object, fields: string[]): string {
  const data = row as Record<string, unknown>;
  return JSON.stringify(fields.map(field => data[field]));
}

function fixture(data: FixtureData = {}) {
  const { events: rows = [], blocks = [], posts = [], artists = [], users = [] } = data;
  const before = JSON.stringify({ rows, blocks, posts, artists, users });
  const forbidden = () => { throw new Error('Query suggestions fixture forbids writes and raw queries'); };
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
      ...writes,
      findMany: jest.fn(async (args: Prisma.FeedSearchBlockedTermFindManyArgs) => {
        expect(Object.keys(args).sort()).toEqual(['select', 'where']);
        expect(args.select).toEqual({ normalizedKeyword: true, searchType: true, language: true });
        return blocks.filter(row => matches(row, args.where))
          .map(({ normalizedKeyword, searchType, language }) =>
            ({ normalizedKeyword, searchType, language }));
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
        if (args.take === undefined) throw new Error('Fixture requires a bounded group take');
        expect(Number.isInteger(args.take)).toBe(true);
        expect(args.take).toBeGreaterThan(0);
        expect(args.take).toBeLessThanOrEqual(100);
        const groups = new Map<string, Group>();
        for (const row of rows.filter(item => matches(item, args.where))) {
          const key = dimensionKey(row, args.by as string[]);
          const previous = groups.get(key);
          if (previous) {
            previous._count._all++;
            if (row.createdAt > previous._max.createdAt) previous._max.createdAt = row.createdAt;
          } else {
            groups.set(key, { normalizedKeyword: row.normalizedKeyword,
              searchType: row.searchType, language: row.language,
              _count: { _all: 1 }, _max: { createdAt: row.createdAt } });
          }
        }
        return [...groups.values()].sort((left, right) =>
          right._count._all - left._count._all
          || right._max.createdAt.getTime() - left._max.createdAt.getTime()).slice(0, args.take);
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
    communityPost: {
      ...writes,
      findMany: jest.fn(async (args: Prisma.CommunityPostFindManyArgs) => {
        expect(Object.keys(args).sort()).toEqual(['orderBy', 'select', 'take', 'where']);
        expect(args.select).toEqual({ id: true, body: true, publishedAt: true });
        expect(args.orderBy).toEqual({ publishedAt: 'desc' });
        expect(args.take).toBe(500);
        return posts.filter(row => matches(row, args.where))
          .sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime())
          .slice(0, args.take).map(({ id: postId, body, publishedAt }) =>
            ({ id: postId, body, publishedAt }));
      }),
    },
    artist: {
      ...writes,
      findMany: jest.fn(async (args: Prisma.ArtistFindManyArgs) => {
        expect(Object.keys(args).sort()).toEqual(['orderBy', 'select', 'take', 'where']);
        expect(args.select).toEqual({ id: true, slug: true, displayName: true });
        expect(args.orderBy).toEqual({ displayName: 'asc' });
        if (args.take === undefined) throw new Error('Fixture requires a bounded artist take');
        expect(args.take).toBeGreaterThan(0);
        expect(args.take).toBeLessThanOrEqual(10);
        return artists.filter(row => matches(row, args.where))
          .sort((left, right) => left.displayName.localeCompare(right.displayName))
          .slice(0, args.take).map(({ id: artistId, slug, displayName }) =>
            ({ id: artistId, slug, displayName }));
      }),
    },
    user: {
      ...writes,
      findMany: jest.fn(async (args: Prisma.UserFindManyArgs) => {
        expect(Object.keys(args).sort()).toEqual(['orderBy', 'select', 'take', 'where']);
        expect(args.select).toEqual({ id: true,
          profile: { select: { displayName: true, publicHandle: true } } });
        expect(args.orderBy).toEqual({ createdAt: 'desc' });
        if (args.take === undefined) throw new Error('Fixture requires a bounded user take');
        expect(args.take).toBeGreaterThan(0);
        expect(args.take).toBeLessThanOrEqual(10);
        return users.filter(row => matches(row, args.where))
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
          .slice(0, args.take).map(({ id: userId, profile }) =>
            ({ id: userId, profile: { ...profile } }));
      }),
    },
  };
  readOnlyChecks.push(() => {
    expect(JSON.stringify({ rows, blocks, posts, artists, users })).toBe(before);
    for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled();
    for (const raw of [prisma.$transaction, prisma.$queryRaw, prisma.$queryRawUnsafe,
      prisma.$executeRaw, prisma.$executeRawUnsafe]) expect(raw).not.toHaveBeenCalled();
  });
  return { prisma, service: new CommunityService(prisma as never, {} as never, {} as never) };
}

describe('feed query suggestion visible ranking', () => {
  beforeEach(() => {
    sequence = 0;
    readOnlyChecks.length = 0;
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  });
  afterEach(() => {
    try { for (const check of readOnlyChecks) check(); }
    finally { jest.restoreAllMocks(); }
  });

  test('FEED-QUERY-SUGGESTION-RANKING-RED returns the allowed fourth group after three blocked leaders at take one', async () => {
    const allowed = event('QaAllowed');
    const f = fixture({ events: [...events('qafirst', 4), ...events('qasecond', 3),
      ...events('qathird', 2), allowed], blocks: ['qafirst', 'qasecond', 'qathird']
      .map(keyword => block(keyword, { searchType: 'text', language: 'en' })) });
    const result = await f.service.getSearchSuggestions({ q: 'qa', language: 'en', window: '24h', take: '1' });
    expect(result.query).toEqual({ keyword: 'qa', normalizedKeyword: 'qa', language: 'en' });
    expect(result.sections.hashtags).toEqual([]);
    expect(result.sections.artists).toEqual([]);
    expect(result.sections.users).toEqual([]);
    expect(f.prisma.feedSearchBlockedTerm.findMany).toHaveBeenCalledWith({
      where: { status: 'active', language: { in: ['all', 'en'] } },
      select: { normalizedKeyword: true, searchType: true, language: true },
    });
    expect(f.prisma.feedSearchEvent.groupBy).toHaveBeenCalledTimes(1);
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0]).toEqual(expect.objectContaining({
      by: DIMENSIONS, _count: { _all: true }, _max: { createdAt: true },
      orderBy: GROUP_ORDER, take: 3,
      where: expect.objectContaining({ createdAt: { gte: new Date(NOW.getTime() - DAY) },
        language: 'en', normalizedKeyword: { contains: 'qa', mode: 'insensitive' } }),
    }));
    // Keep the intended RED after baseline checks, before candidate-only shape assertions.
    expect(result.sections.recentQueries).toEqual([{
      type: 'query', keyword: 'QaAllowed', normalizedKeyword: 'qaallowed', searchType: 'text',
      language: 'en', searchCount: 1, lastSearchedAt: allowed.createdAt,
      searchUrl: '/api/v1/lumina-feed/search?q=QaAllowed&type=text&language=en',
    }]);
    expect(result.items).toEqual([{ ...result.sections.recentQueries[0], section: 'recentQueries' }]);
    expect(f.prisma.feedSearchEvent.findMany).toHaveBeenCalledTimes(1);
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].where?.NOT).toEqual({
      OR: ['qafirst', 'qasecond', 'qathird'].map(normalizedKeyword =>
        ({ normalizedKeyword, searchType: 'text', language: 'en' })),
    });
  });

  test('keeps exact type and language scope without adding a request type filter', async () => {
    const f = fixture({ events: [...events('shared', 4),
      ...events('shared', 2, { searchType: 'hashtag' }), event('shared', { language: 'ja' })],
    blocks: [block('shared', { searchType: 'text', language: 'en' })] });
    const result = await f.service.getSearchSuggestions({ language: 'all', type: 'text', take: '10' });
    expect(result.sections.recentQueries.map(item => [item.searchType, item.language, item.searchCount]))
      .toEqual([['hashtag', 'en', 2], ['text', 'ja', 1]]);
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].where).toEqual({
      createdAt: { gte: new Date(NOW.getTime() - DAY) },
      NOT: { OR: [{ normalizedKeyword: 'shared', searchType: 'text', language: 'en' }] },
    });
  });

  test('all-type rules exclude only their exact language', async () => {
    const f = fixture({ events: [event('shared'), event('shared', { searchType: 'hashtag' }),
      event('shared', { language: 'ja' })], blocks: [block('shared', { language: 'en' })] });
    const result = await f.service.getSearchSuggestions({ language: 'all' });
    expect(result.sections.recentQueries.map(item => [item.searchType, item.language]))
      .toEqual([['text', 'ja']]);
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].where?.NOT)
      .toEqual({ OR: [{ normalizedKeyword: 'shared', language: 'en' }] });
  });

  test('all-language rules exclude only their exact type', async () => {
    const f = fixture({ events: [event('shared'), event('shared', { language: 'ja' }),
      event('shared', { searchType: 'hashtag' })], blocks: [block('shared', { searchType: 'text' })] });
    const result = await f.service.getSearchSuggestions({ language: 'all' });
    expect(result.sections.recentQueries.map(item => [item.searchType, item.language]))
      .toEqual([['hashtag', 'en']]);
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].where?.NOT)
      .toEqual({ OR: [{ normalizedKeyword: 'shared', searchType: 'text' }] });
  });

  test('both-all rules stay exact keyword exclusions rather than substring or insensitive blocks', async () => {
    const f = fixture({ events: [event('qa'), event('qa', { language: 'ja', searchType: 'hashtag' }),
      event('qasuffix', { createdAt: NOW }), event('qacase')],
    blocks: [block('qa'), block('QaCase')] });
    const result = await f.service.getSearchSuggestions({ q: 'QA', language: 'all' });
    expect(result.sections.recentQueries.map(item => item.normalizedKeyword)).toEqual(['qasuffix', 'qacase']);
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].where).toEqual({
      createdAt: { gte: new Date(NOW.getTime() - DAY) },
      normalizedKeyword: { contains: 'qa', mode: 'insensitive' },
      NOT: { OR: [{ normalizedKeyword: 'qa' }, { normalizedKeyword: 'QaCase' }] },
    });
  });

  test('unions complete blocked tuples without creating cross-product exclusions', async () => {
    const f = fixture({ events: [event('read'), event('write', { language: 'ja', searchType: 'hashtag' }),
      event('read', { language: 'ja', createdAt: NOW }), event('write', { searchType: 'hashtag' })],
    blocks: [block('read', { language: 'en', searchType: 'text' }),
      block('write', { language: 'ja', searchType: 'hashtag' })] });
    const result = await f.service.getSearchSuggestions({ language: 'all' });
    expect(result.sections.recentQueries.map(item => [item.normalizedKeyword, item.language, item.searchType]))
      .toEqual([['read', 'ja', 'text'], ['write', 'en', 'hashtag']]);
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].where?.NOT).toEqual({ OR: [
      { normalizedKeyword: 'read', language: 'en', searchType: 'text' },
      { normalizedKeyword: 'write', language: 'ja', searchType: 'hashtag' },
    ] });
  });

  test('ignores inactive and unrelated-language rules and omits an empty NOT', async () => {
    const f = fixture({ events: events('visible', 2), blocks: [
      block('visible', { status: 'inactive' }), block('visible', { language: 'ja' }),
    ] });
    const result = await f.service.getSearchSuggestions({ locale: 'en-US' });
    expect(result.sections.recentQueries.map(item => [item.normalizedKeyword, item.searchCount]))
      .toEqual([['visible', 2]]);
    expect(f.prisma.feedSearchBlockedTerm.findMany.mock.calls[0][0].where)
      .toEqual({ status: 'active', language: { in: ['all', 'en'] } });
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].where).toEqual({
      createdAt: { gte: new Date(NOW.getTime() - DAY) }, language: 'en',
    });
  });

  test('empty query and data preserve empty sections and skip labels artists and users', async () => {
    const f = fixture();
    const result = await f.service.getSearchSuggestions({ q: '   ' });
    expect(result.query).toEqual({ keyword: null, normalizedKeyword: null, language: 'all' });
    expect(result.sections).toEqual({ recentQueries: [], hashtags: [], artists: [], users: [] });
    expect(result.items).toEqual([]);
    expect(Number.isFinite(result.generatedAt.getTime())).toBe(true);
    expect(result.policy).toEqual(expect.objectContaining({ qOptional: true,
      defaultWindow: '24h', sectionTakeLimit: 10, blockedTermFiltering: true }));
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].where)
      .toEqual({ createdAt: { gte: new Date(NOW.getTime() - DAY) } });
    expect(f.prisma.feedSearchEvent.findMany).not.toHaveBeenCalled();
    expect(f.prisma.artist.findMany).not.toHaveBeenCalled();
    expect(f.prisma.user.findMany).not.toHaveBeenCalled();
  });

  test.each([{ q: '#NeEd' }, { query: 'NEED' }, { keyword: 'need' }])
    ('keeps normalized q substring matching for alias %j', async query => {
      const f = fixture({ events: [event('needle'), event('need-other'), event('unrelated')],
        blocks: [block('need')] });
      const result = await f.service.getSearchSuggestions({ ...query, language: 'en' });
      expect(result.query.normalizedKeyword).toBe('need');
      expect(result.sections.recentQueries.map(item => item.normalizedKeyword)).toEqual(['needle', 'need-other']);
      expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].where).toEqual({
        createdAt: { gte: new Date(NOW.getTime() - DAY) }, language: 'en',
        normalizedKeyword: { contains: 'need', mode: 'insensitive' },
        NOT: { OR: [{ normalizedKeyword: 'need' }] },
      });
    });

  test('counts events and orders count before latest without a rank field', async () => {
    const f = fixture({ events: [...events('most', 3, { createdAt: new Date(NOW.getTime() - 10 * MINUTE) }),
      ...events('tie-newer', 2, { createdAt: new Date(NOW.getTime() - MINUTE) }),
      ...events('tie-older', 2, { createdAt: new Date(NOW.getTime() - 2 * MINUTE) }),
      event('newest-single', { createdAt: NOW, resultCount: 1000 })] });
    const result = await f.service.getSearchSuggestions({ take: '4' });
    expect(result.sections.recentQueries.map(item => [item.normalizedKeyword, item.searchCount]))
      .toEqual([['most', 3], ['tie-newer', 2], ['tie-older', 2], ['newest-single', 1]]);
    for (const item of result.sections.recentQueries) expect(item).not.toHaveProperty('rank');
    expect(result.sections.recentQueries[1].lastSearchedAt?.getTime()).toBe(NOW.getTime() - MINUTE);
  });

  test('latest labels use exact type-language triples and preserve encoded URLs', async () => {
    const latest = event('Latest Label', { normalizedKeyword: 'label', createdAt: NOW });
    const f = fixture({ events: [event('Older Label', { normalizedKeyword: 'label' }), latest,
      event('#Other Type', { normalizedKeyword: 'label', searchType: 'hashtag' }),
      event('Other Language', { normalizedKeyword: 'label', language: 'ja' })] });
    const result = await f.service.getSearchSuggestions({ q: 'label', language: 'all', take: '3' });
    expect(result.sections.recentQueries.map(item => [item.keyword, item.searchType, item.language]))
      .toEqual([['Latest Label', 'text', 'en'], ['#Other Type', 'hashtag', 'en'], ['Other Language', 'text', 'ja']]);
    expect(result.sections.recentQueries[0]).toEqual({ type: 'query', keyword: 'Latest Label',
      normalizedKeyword: 'label', searchType: 'text', language: 'en', searchCount: 2,
      lastSearchedAt: NOW, searchUrl: '/api/v1/lumina-feed/search?q=Latest%20Label&type=text&language=en' });
    expect(result.sections.recentQueries[1].searchUrl)
      .toBe('/api/v1/lumina-feed/search?q=%23Other%20Type&type=hashtag&language=en');
    expect(f.prisma.feedSearchEvent.findMany).toHaveBeenCalledWith({ where: { OR: [
      { normalizedKeyword: 'label', searchType: 'text', language: 'en' },
      { normalizedKeyword: 'label', searchType: 'hashtag', language: 'en' },
      { normalizedKeyword: 'label', searchType: 'text', language: 'ja' },
    ] }, orderBy: { createdAt: 'desc' }, distinct: DIMENSIONS });
  });

  test('keeps normalized keyword fallback when the latest-label read returns no rows', async () => {
    const f = fixture({ events: [event('Display label', { normalizedKeyword: 'fallback' })] });
    f.prisma.feedSearchEvent.findMany.mockResolvedValueOnce([]);
    const result = await f.service.getSearchSuggestions({});
    expect(result.sections.recentQueries[0]).toEqual(expect.objectContaining({ keyword: 'fallback',
      normalizedKeyword: 'fallback', searchCount: 1,
      searchUrl: '/api/v1/lumina-feed/search?q=fallback&type=text&language=en' }));
    expect(f.prisma.feedSearchEvent.findMany).toHaveBeenCalledTimes(1);
  });

  test('preserves inclusive default 24h and requested 1h event windows', async () => {
    const f = fixture({ events: [event('day-boundary', { createdAt: new Date(NOW.getTime() - DAY) }),
      event('day-outside', { createdAt: new Date(NOW.getTime() - DAY - 1) }),
      event('hour-boundary', { createdAt: new Date(NOW.getTime() - 60 * MINUTE) }),
      event('hour-outside', { createdAt: new Date(NOW.getTime() - 60 * MINUTE - 1) })] });
    const daily = await f.service.getSearchSuggestions({});
    expect(daily.sections.recentQueries.map(item => item.normalizedKeyword))
      .toEqual(['hour-boundary', 'hour-outside', 'day-boundary']);
    const hourly = await f.service.getSearchSuggestions({ window: '1h' });
    expect(hourly.sections.recentQueries.map(item => item.normalizedKeyword)).toEqual(['hour-boundary']);
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[1][0].where?.createdAt)
      .toEqual({ gte: new Date(NOW.getTime() - 60 * MINUTE) });
  });

  test('preserves all and mapped language modes including unknown', async () => {
    const modes = ['ko', 'ja', 'en', 'zh', 'unknown'];
    const f = fixture({ events: modes.map((language, index) => event(`visible-${language}`, {
      language, createdAt: new Date(NOW.getTime() - index * 1000),
    })) });
    const all = await f.service.getSearchSuggestions({ language: 'all' });
    expect(all.sections.recentQueries.map(item => item.language)).toEqual(modes);
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].where).not.toHaveProperty('language');
    const aliases = ['ko-KR', 'jp-JP', 'en-US', 'cn-CN', 'unknown'];
    for (const [index, locale] of aliases.entries()) {
      const result = await f.service.getSearchSuggestions({ locale });
      expect(result.query.language).toBe(modes[index]);
      expect(result.sections.recentQueries.map(item => item.language)).toEqual([modes[index]]);
      expect(f.prisma.feedSearchBlockedTerm.findMany.mock.calls[index + 1][0].where)
        .toEqual({ status: 'active', language: { in: ['all', modes[index]] } });
    }
  });

  test('keeps section ten and group thirty below the unchanged maximum hundred without refill', async () => {
    const names = Array.from({ length: 34 }, (_, index) => `visible-${index}`);
    const f = fixture({ events: names.map((keyword, index) => event(keyword, {
      createdAt: new Date(NOW.getTime() - index * 1000),
    })) });
    for (const query of [{}, { take: '500' }]) {
      const result = await f.service.getSearchSuggestions(query);
      expect(result.sections.recentQueries.map(item => item.normalizedKeyword)).toEqual(names.slice(0, 10));
      expect(result.policy.sectionTakeLimit).toBe(10);
    }
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls.map(call => call[0].take)).toEqual([30, 30]);
    for (const read of f.prisma.feedSearchEvent.groupBy.mock.results) {
      expect(await read.value).toHaveLength(30);
    }
    expect(f.prisma.feedSearchEvent.groupBy).toHaveBeenCalledTimes(2);
    expect(f.prisma.feedSearchEvent.findMany).toHaveBeenCalledTimes(2);
    expect(f.prisma.communityPost.findMany.mock.calls.map(call => call[0].take)).toEqual([500, 500]);
  });

  test('a genuinely all-blocked window stays empty without a label read or retry', async () => {
    const f = fixture({ events: [...events('hidden', 4), event('other-hidden')],
      blocks: [block('hidden'), block('other-hidden')] });
    const result = await f.service.getSearchSuggestions({});
    expect(result.sections.recentQueries).toEqual([]);
    expect(f.prisma.feedSearchEvent.findMany).not.toHaveBeenCalled();
    expect(f.prisma.feedSearchEvent.groupBy).toHaveBeenCalledTimes(1);
    expect(f.prisma.feedSearchBlockedTerm.findMany).toHaveBeenCalledTimes(1);
  });

  test('preserves other sections and flattened projection order', async () => {
    const artist: ArtistRow = { id: id(), slug: 'studio-artist', displayName: 'Studio Artist', status: 'active' };
    const user: UserRow = { id: id(), status: 'active', deletedAt: null, createdAt: NOW,
      profile: { displayName: 'Studio Reader', publicHandle: 'studio-reader' } };
    const post: PostRow = { id: id(), body: 'Public #Studio', status: 'published', visibility: 'public',
      deletedAt: null, publishedAt: NOW };
    const f = fixture({ events: [event('Studio Query')], posts: [post], artists: [artist], users: [user] });
    const result = await f.service.getSearchSuggestions({ q: 'STUDIO', language: 'en', take: '1' });
    expect(result.sections.recentQueries[0]).toEqual(expect.objectContaining({
      type: 'query', keyword: 'Studio Query', normalizedKeyword: 'studio query', searchCount: 1,
    }));
    expect(result.sections.hashtags).toEqual([{ type: 'hashtag', keyword: '#Studio',
      normalizedKeyword: 'studio', language: 'en', postCount: 1, latestPublishedAt: NOW,
      searchUrl: '/api/v1/lumina-feed/search?q=%23Studio&type=hashtag&language=en' }]);
    expect(result.sections.artists).toEqual([{ type: 'artist', id: artist.id, keyword: artist.displayName,
      slug: artist.slug, displayName: artist.displayName, searchUrl: '/api/v1/lumina-feed?artistSlug=studio-artist' }]);
    expect(result.sections.users).toEqual([{ type: 'user', id: user.id, keyword: user.profile.displayName,
      displayName: user.profile.displayName, publicHandle: user.profile.publicHandle,
      profileUrl: '/api/v1/users/handle/studio-reader/profile' }]);
    expect(result.items).toEqual([
      ...result.sections.recentQueries.map(item => ({ ...item, section: 'recentQueries' })),
      ...result.sections.hashtags.map(item => ({ ...item, section: 'hashtags' })),
      ...result.sections.artists.map(item => ({ ...item, section: 'artists' })),
      ...result.sections.users.map(item => ({ ...item, section: 'users' })),
    ]);
    expect(f.prisma.artist.findMany.mock.calls[0][0].take).toBe(1);
    expect(f.prisma.user.findMany.mock.calls[0][0].take).toBe(1);
  });

  test.each(['blockedTerms', 'groups', 'latest', 'posts', 'artists', 'users'] as const)
    ('propagates %s read failure without fallback automatic retry or writes', async source => {
      const f = fixture({ events: [event('visible')] });
      const reads = {
        blockedTerms: f.prisma.feedSearchBlockedTerm.findMany,
        groups: f.prisma.feedSearchEvent.groupBy,
        latest: f.prisma.feedSearchEvent.findMany,
        posts: f.prisma.communityPost.findMany,
        artists: f.prisma.artist.findMany,
        users: f.prisma.user.findMany,
      };
      const failure = new Error(`Synthetic ${source} read failure`);
      reads[source].mockRejectedValueOnce(failure);
      await expect(f.service.getSearchSuggestions({ q: 'visible' })).rejects.toBe(failure);
      expect(reads[source]).toHaveBeenCalledTimes(1);
      if (source === 'blockedTerms' || source === 'artists' || source === 'users') {
        expect(f.prisma.feedSearchEvent.groupBy).not.toHaveBeenCalled();
        expect(f.prisma.communityPost.findMany).not.toHaveBeenCalled();
      }
      if (source === 'groups') expect(f.prisma.feedSearchEvent.findMany).not.toHaveBeenCalled();
    });

  test.each([{ window: 'invalid' }, { language: 'invalid' }, { take: '1.5' }])
    ('rejects invalid admission %j before any suggestion reads', async query => {
      const f = fixture();
      await expect(f.service.getSearchSuggestions(query)).rejects.toBeInstanceOf(BadRequestException);
      for (const read of [f.prisma.feedSearchBlockedTerm.findMany, f.prisma.feedSearchEvent.groupBy,
        f.prisma.feedSearchEvent.findMany, f.prisma.communityPost.findMany,
        f.prisma.artist.findMany, f.prisma.user.findMany]) expect(read).not.toHaveBeenCalled();
    });
});
