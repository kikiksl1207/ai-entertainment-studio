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
const CLEANUP_NOT = [
  { body: { equals: 'test', mode: 'insensitive' } },
  { body: { contains: 'testtest', mode: 'insensitive' } },
  { body: { equals: 'sample', mode: 'insensitive' } },
  { body: { equals: 'fixture', mode: 'insensitive' } },
  { body: { equals: '\ud14c\uc2a4\ud2b8' } },
  { body: { contains: '\uc784\uc2dc\ubb38\uad6c' } },
  { body: { contains: '\uc0d8\ud50c\ubb38\uad6c' } },
  { body: { contains: 'QA358', mode: 'insensitive' } },
];
type PostRow = Pick<CommunityPost,
  'id' | 'body' | 'status' | 'visibility' | 'deletedAt' | 'publishedAt'>;
type BlockRow = Pick<FeedSearchBlockedTerm,
  'normalizedKeyword' | 'searchType' | 'language' | 'status'>;
type EventRow = Pick<FeedSearchEvent,
  'id' | 'keyword' | 'normalizedKeyword' | 'searchType' | 'language' | 'createdAt'>;
type ArtistRow = Pick<Artist, 'id' | 'slug' | 'displayName' | 'status'>;
type UserRow = Pick<User, 'id' | 'status' | 'deletedAt' | 'createdAt'> & {
  profile: Pick<UserProfile, 'displayName' | 'publicHandle'>;
};
type Group = Pick<EventRow, 'normalizedKeyword' | 'searchType' | 'language'> & {
  _count: { _all: number }; _max: { createdAt: Date };
};
type FixtureData = {
  posts?: PostRow[]; blocks?: BlockRow[]; events?: EventRow[];
  artists?: ArtistRow[]; users?: UserRow[];
};
let sequence = 0;
const readOnlyChecks: Array<() => void> = [];

function id() {
  return `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
}

function post(body: string, overrides: Partial<PostRow> = {}): PostRow {
  return { id: id(), body, status: 'published', visibility: 'public', deletedAt: null,
    publishedAt: new Date(NOW.getTime() - MINUTE), ...overrides };
}

function block(normalizedKeyword: string, overrides: Partial<BlockRow> = {}): BlockRow {
  return { normalizedKeyword, searchType: 'all', language: 'all', status: 'active',
    ...overrides };
}

function event(keyword: string, overrides: Partial<EventRow> = {}): EventRow {
  return { id: id(), keyword, normalizedKeyword: keyword.toLowerCase(), searchType: 'text',
    language: 'en', createdAt: new Date(NOW.getTime() - MINUTE), ...overrides };
}

function predicates(value: unknown): object[] {
  const items = Array.isArray(value) ? value : [value];
  if (items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('Unsupported fixture predicate');
  }
  return items as object[];
}

// Only evaluate predicates supplied by the service, including its literal NOT array.
function matches(row: object, where?: object): boolean {
  const data = row as Record<string, unknown>;
  return Object.entries(where ?? {}).every(([field, condition]) => {
    if (condition === undefined) return true;
    if (field === 'AND') return predicates(condition).every(item => matches(row, item));
    if (field === 'OR') return predicates(condition).some(item => matches(row, item));
    if (field === 'NOT') return predicates(condition).every(item => !matches(row, item));
    if (!['body', 'status', 'visibility', 'deletedAt', 'publishedAt', 'normalizedKeyword',
      'searchType', 'language', 'createdAt', 'displayName', 'slug', 'profile', 'publicHandle']
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
  const { posts = [], blocks = [], events = [], artists = [], users = [] } = data;
  const before = JSON.stringify({ posts, blocks, events, artists, users });
  const forbidden = () => { throw new Error('Suggestions fixture forbids writes and raw queries'); };
  const writes = {
    create: jest.fn(forbidden), createMany: jest.fn(forbidden),
    update: jest.fn(forbidden), updateMany: jest.fn(forbidden), upsert: jest.fn(forbidden),
    delete: jest.fn(forbidden), deleteMany: jest.fn(forbidden),
  };
  const prisma = {
    $transaction: jest.fn(forbidden), $queryRaw: jest.fn(forbidden),
    $queryRawUnsafe: jest.fn(forbidden), $executeRaw: jest.fn(forbidden),
    $executeRawUnsafe: jest.fn(forbidden),
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
        if (args.take === undefined) throw new Error('Fixture requires bounded group take');
        expect(Number.isInteger(args.take)).toBe(true);
        expect(args.take).toBeGreaterThan(0);
        expect(args.take).toBeLessThanOrEqual(100);
        const grouped = new Map<string, Group>();
        for (const row of events.filter(item => matches(item, args.where))) {
          const key = dimensionKey(row, args.by as string[]);
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
        return [...grouped.values()].sort((left, right) =>
          right._count._all - left._count._all
          || right._max.createdAt.getTime() - left._max.createdAt.getTime()).slice(0, args.take);
      }),
      findMany: jest.fn(async (args: Prisma.FeedSearchEventFindManyArgs) => {
        expect(Object.keys(args).sort()).toEqual(['distinct', 'orderBy', 'where']);
        expect(args.orderBy).toEqual({ createdAt: 'desc' });
        expect(args.distinct).toEqual(DIMENSIONS);
        const seen = new Set<string>();
        return events.filter(row => matches(row, args.where))
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
          .filter(row => {
            const key = dimensionKey(row, args.distinct as string[]);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }).map(row => ({ ...row }));
      }),
    },
    artist: {
      ...writes,
      findMany: jest.fn(async (args: Prisma.ArtistFindManyArgs) => {
        expect(Object.keys(args).sort()).toEqual(['orderBy', 'select', 'take', 'where']);
        expect(args.select).toEqual({ id: true, slug: true, displayName: true });
        expect(args.orderBy).toEqual({ displayName: 'asc' });
        if (args.take === undefined) throw new Error('Fixture requires bounded artist take');
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
        if (args.take === undefined) throw new Error('Fixture requires bounded user take');
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
    expect(JSON.stringify({ posts, blocks, events, artists, users })).toBe(before);
    for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled();
    for (const raw of [prisma.$transaction, prisma.$queryRaw, prisma.$queryRawUnsafe,
      prisma.$executeRaw, prisma.$executeRawUnsafe]) expect(raw).not.toHaveBeenCalled();
  });
  return { prisma, service: new CommunityService(prisma as never, {} as never, {} as never) };
}

describe('feed suggestion cleanup', () => {
  beforeEach(() => {
    sequence = 0;
    readOnlyChecks.length = 0;
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  });
  afterEach(() => {
    try { for (const check of readOnlyChecks) check(); }
    finally { jest.restoreAllMocks(); }
  });

  test('FEED-SUGGESTION-CLEANUP-RED excludes cleanup-marked public hashtag posts', async () => {
    const f = fixture({ posts: [post('Public #qA358hidden'), post('Public #TESTTESThidden'),
      post('Public #visibleqa')] });
    const result = await f.service.getSearchSuggestions({ q: '', language: 'all' });
    expect(result.sections.hashtags.map(item => item.normalizedKeyword)).toEqual(['visibleqa']);
    expect(f.prisma.communityPost.findMany.mock.calls[0][0].where).toEqual({
      status: 'published', visibility: 'public', deletedAt: null,
      publishedAt: { gte: new Date(NOW.getTime() - DAY) }, body: { contains: '#' },
      NOT: CLEANUP_NOT,
    });
    expect(result.sections.artists).toEqual([]);
    expect(result.sections.users).toEqual([]);
    expect(f.prisma.artist.findMany).not.toHaveBeenCalled();
    expect(f.prisma.user.findMany).not.toHaveBeenCalled();
  });

  test('keeps only published public nondeleted posts containing a hashtag', async () => {
    const f = fixture({ posts: [post('#visible'), post('#draft', { status: 'draft' }),
      post('#private', { visibility: 'private' }),
      post('#deleted', { deletedAt: NOW }), post('Public prose without a hashtag')] });
    const result = await f.service.getSearchSuggestions({});
    expect(result.sections.hashtags.map(item => item.normalizedKeyword)).toEqual(['visible']);
    const where = f.prisma.communityPost.findMany.mock.calls[0][0].where;
    expect(where).toEqual(expect.objectContaining({ status: 'published', visibility: 'public',
      deletedAt: null, body: { contains: '#' } }));
  });

  test('preserves inclusive default 24h and requested 1h publication windows', async () => {
    const f = fixture({ posts: [
      post('#day-boundary', { publishedAt: new Date(NOW.getTime() - DAY) }),
      post('#day-outside', { publishedAt: new Date(NOW.getTime() - DAY - 1) }),
      post('#hour-boundary', { publishedAt: new Date(NOW.getTime() - 60 * MINUTE) }),
      post('#hour-outside', { publishedAt: new Date(NOW.getTime() - 60 * MINUTE - 1) }),
    ] });
    const daily = await f.service.getSearchSuggestions({});
    expect(daily.sections.hashtags.map(item => item.normalizedKeyword))
      .toEqual(['hour-boundary', 'hour-outside', 'day-boundary']);
    const hourly = await f.service.getSearchSuggestions({ window: '1h' });
    expect(hourly.sections.hashtags.map(item => item.normalizedKeyword)).toEqual(['hour-boundary']);
    expect(f.prisma.communityPost.findMany.mock.calls[1][0].where?.publishedAt)
      .toEqual({ gte: new Date(NOW.getTime() - 60 * MINUTE) });
  });

  test('preserves all-language tags and requested locale-derived hashtag language', async () => {
    const f = fixture({ posts: [post('#english #\ud55c\uae00 #\u30ab\u30ca #\u96fb\u5f71 #123')] });
    const all = await f.service.getSearchSuggestions({ language: 'all' });
    expect(all.sections.hashtags.map(item => item.language)).toEqual(['en', 'ko', 'ja', 'zh', 'unknown']);
    const korean = await f.service.getSearchSuggestions({ locale: 'ko-KR' });
    expect(korean.query.language).toBe('ko');
    expect(korean.sections.hashtags.map(item => item.normalizedKeyword)).toEqual(['\ud55c\uae00']);
    const english = await f.service.getSearchSuggestions({ language: 'en-US' });
    expect(english.sections.hashtags.map(item => item.normalizedKeyword)).toEqual(['english']);
    expect(f.prisma.feedSearchBlockedTerm.findMany.mock.calls[1][0].where)
      .toEqual({ status: 'active', language: { in: ['all', 'ko'] } });
  });

  test.each([
    { q: '#NEED' }, { query: 'NeEd' }, { keyword: 'need' },
  ])('preserves normalized hashtag substring matching for query alias %j', async query => {
    const f = fixture({ posts: [post('#Needle #need-other #unrelated')] });
    const result = await f.service.getSearchSuggestions({ ...query, language: 'en' });
    expect(result.query.normalizedKeyword).toBe('need');
    expect(result.sections.hashtags.map(item => item.normalizedKeyword))
      .toEqual(['needle', 'need-other']);
    expect(f.prisma.artist.findMany.mock.calls[0][0].where).toEqual({ status: 'active', OR: [
      { displayName: { contains: 'need', mode: 'insensitive' } },
      { slug: { contains: 'need', mode: 'insensitive' } },
    ] });
  });

  test('preserves active exact hashtag blocked scopes without hiding other types or languages', async () => {
    const f = fixture({ posts: [
      post('#global #local #inactive #textonly #otherlanguage #nearby #nearbysuffix'),
      post('#\ud55c\uae00', { publishedAt: new Date(NOW.getTime() - 2 * MINUTE) }),
    ], blocks: [block('global'), block('local', { searchType: 'hashtag', language: 'en' }),
      block('inactive', { status: 'inactive' }), block('textonly', { searchType: 'text' }),
      block('otherlanguage', { searchType: 'hashtag', language: 'ko' }),
      block('nearby', { searchType: 'hashtag', language: 'en' })] });
    const english = await f.service.getSearchSuggestions({ language: 'en' });
    expect(english.sections.hashtags.map(item => item.normalizedKeyword))
      .toEqual(['inactive', 'textonly', 'otherlanguage', 'nearbysuffix']);
    const all = await f.service.getSearchSuggestions({ language: 'all' });
    expect(all.sections.hashtags.map(item => item.normalizedKeyword))
      .toEqual(['inactive', 'textonly', 'otherlanguage', 'nearbysuffix', '\ud55c\uae00']);
    expect(f.prisma.feedSearchBlockedTerm.findMany.mock.calls[0][0].where)
      .toEqual({ status: 'active', language: { in: ['all', 'en'] } });
  });

  test('applies public predicates and descending publication order before the fixed 500-post sample', async () => {
    const sampled = Array.from({ length: 500 }, (_, index) => post('#sampled', {
      publishedAt: new Date(NOW.getTime() - index * 1000),
    }));
    const f = fixture({ posts: [post('#outside-sample', {
      publishedAt: new Date(NOW.getTime() - 500_000),
    }), ...sampled.reverse(), ...Array.from({ length: 20 }, () => post('#draft-leader', {
      status: 'draft', publishedAt: NOW,
    }))] });
    const result = await f.service.getSearchSuggestions({});
    expect(result.sections.hashtags).toEqual([expect.objectContaining({
      normalizedKeyword: 'sampled', postCount: 500, latestPublishedAt: NOW,
    })]);
    expect(f.prisma.communityPost.findMany).toHaveBeenCalledTimes(1);
    expect(f.prisma.communityPost.findMany.mock.calls[0][0].take).toBe(500);
  });

  test('keeps the default and oversized section take at ten without changing the sample cap', async () => {
    const f = fixture({ posts: Array.from({ length: 12 }, (_, index) => post(`#visible-${index}`, {
      publishedAt: new Date(NOW.getTime() - index * 1000),
    })) });
    for (const query of [{}, { take: '500' }]) {
      const result = await f.service.getSearchSuggestions(query);
      expect(result.sections.hashtags.map(item => item.normalizedKeyword))
        .toEqual(Array.from({ length: 10 }, (_, index) => `visible-${index}`));
      expect(result.policy.sectionTakeLimit).toBe(10);
    }
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls.map(call => call[0].take)).toEqual([30, 30]);
    expect(f.prisma.communityPost.findMany.mock.calls.map(call => call[0].take)).toEqual([500, 500]);
  });

  test('keeps distinct-post counts, latest spelling and count-then-time hashtag ordering', async () => {
    const latest = new Date(NOW.getTime() - 1000);
    const f = fixture({ posts: [post('#shared #shared #oldone'),
      post('#SHARED', { publishedAt: latest }),
      post('#newone', { publishedAt: new Date(NOW.getTime() - 2000) })] });
    const result = await f.service.getSearchSuggestions({ take: '3' });
    expect(result.sections.hashtags.map(item => [item.keyword, item.postCount]))
      .toEqual([['#SHARED', 2], ['#newone', 1], ['#oldone', 1]]);
    expect(result.sections.hashtags[0]).toEqual({ type: 'hashtag', keyword: '#SHARED',
      normalizedKeyword: 'shared', language: 'en', postCount: 2, latestPublishedAt: latest,
      searchUrl: '/api/v1/lumina-feed/search?q=%23SHARED&type=hashtag&language=en' });
  });

  test('preserves recent query, artist and user projections and flattened section order', async () => {
    const artist: ArtistRow = { id: id(), slug: 'studio-qa', displayName: 'Studio QA', status: 'active' };
    const user: UserRow = { id: id(), status: 'active', deletedAt: null, createdAt: NOW,
      profile: { displayName: 'Studio Reader QA', publicHandle: 'studio-reader-qa' } };
    const recent = event('Studio Query', { createdAt: new Date(NOW.getTime() - 1000) });
    const f = fixture({ posts: [post('#Studio #unrelated')],
      events: [event('studio query'), recent, event('studio expired', {
        createdAt: new Date(NOW.getTime() - DAY - 1),
      })], artists: [artist, { ...artist, id: id(), status: 'draft' }],
      users: [user, { ...user, id: id(), status: 'inactive' },
        { ...user, id: id(), deletedAt: NOW }] });
    const result = await f.service.getSearchSuggestions({ q: 'STUDIO', language: 'en', take: '1' });
    expect(result.sections.recentQueries).toEqual([{
      type: 'query', keyword: 'Studio Query', normalizedKeyword: 'studio query', searchType: 'text',
      language: 'en', searchCount: 2, lastSearchedAt: recent.createdAt,
      searchUrl: '/api/v1/lumina-feed/search?q=Studio%20Query&type=text&language=en',
    }]);
    expect(result.sections.artists).toEqual([{ type: 'artist', id: artist.id,
      keyword: artist.displayName, slug: artist.slug, displayName: artist.displayName,
      searchUrl: '/api/v1/lumina-feed?artistSlug=studio-qa' }]);
    expect(result.sections.users).toEqual([{ type: 'user', id: user.id,
      keyword: user.profile.displayName, displayName: user.profile.displayName,
      publicHandle: user.profile.publicHandle,
      profileUrl: '/api/v1/users/handle/studio-reader-qa/profile' }]);
    expect(result.items).toEqual([
      ...result.sections.recentQueries.map(item => ({ ...item, section: 'recentQueries' })),
      ...result.sections.hashtags.map(item => ({ ...item, section: 'hashtags' })),
      ...result.sections.artists.map(item => ({ ...item, section: 'artists' })),
      ...result.sections.users.map(item => ({ ...item, section: 'users' })),
    ]);
    expect(result.sections.hashtags.map(item => item.keyword)).toEqual(['#Studio']);
    expect(f.prisma.artist.findMany.mock.calls[0][0].take).toBe(1);
    expect(f.prisma.user.findMany.mock.calls[0][0].take).toBe(1);
    expect(f.prisma.feedSearchEvent.groupBy.mock.calls[0][0].take).toBe(3);
  });

  test('returns empty sections for empty data and skips artist and user reads without a query', async () => {
    const f = fixture();
    const result = await f.service.getSearchSuggestions({ q: '   ' });
    expect(result.query).toEqual({ keyword: null, normalizedKeyword: null, language: 'all' });
    expect(result.sections).toEqual({ recentQueries: [], hashtags: [], artists: [], users: [] });
    expect(result.items).toEqual([]);
    expect(result.generatedAt).toBeInstanceOf(Date);
    expect(result.policy).toEqual(expect.objectContaining({ qOptional: true,
      defaultWindow: '24h', sectionTakeLimit: 10, blockedTermFiltering: true }));
    expect(f.prisma.artist.findMany).not.toHaveBeenCalled();
    expect(f.prisma.user.findMany).not.toHaveBeenCalled();
    expect(f.prisma.feedSearchEvent.findMany).not.toHaveBeenCalled();
  });

  test.each(['posts', 'blockedTerms', 'queryGroups'] as const)
    ('propagates %s read failures without fallback, retry or writes', async source => {
      const f = fixture({ posts: [post('#visible')] });
      const failure = new Error(`Synthetic ${source} read failure`);
      const read = source === 'posts' ? f.prisma.communityPost.findMany
        : source === 'blockedTerms' ? f.prisma.feedSearchBlockedTerm.findMany
          : f.prisma.feedSearchEvent.groupBy;
      read.mockRejectedValueOnce(failure);
      await expect(f.service.getSearchSuggestions({})).rejects.toBe(failure);
      expect(read).toHaveBeenCalledTimes(1);
      if (source === 'blockedTerms') {
        expect(f.prisma.communityPost.findMany).not.toHaveBeenCalled();
        expect(f.prisma.feedSearchEvent.groupBy).not.toHaveBeenCalled();
      }
    });

  test('rejects an invalid window before starting any suggestion reads', async () => {
    const f = fixture({ posts: [post('#visible')] });
    await expect(f.service.getSearchSuggestions({ window: 'unsupported' }))
      .rejects.toBeInstanceOf(BadRequestException);
    for (const read of [f.prisma.communityPost.findMany, f.prisma.feedSearchBlockedTerm.findMany,
      f.prisma.feedSearchEvent.groupBy, f.prisma.feedSearchEvent.findMany,
      f.prisma.artist.findMany, f.prisma.user.findMany]) expect(read).not.toHaveBeenCalled();
  });
});
