import { BadRequestException, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { CommunityService } from './community.service';

const run = process.env.RUN_FEED_SEARCH_DB_QA === '1' ? describe : describe.skip;
type SearchQuery = Parameters<CommunityService['searchFeed']>[0];
type SearchContext = NonNullable<Parameters<CommunityService['searchFeed']>[1]>;
type TransactionOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};
type RankingEntry = {
  normalizedKeyword: string;
  type: string;
  language: string;
  searchCount: number;
};

run('isolated PostgreSQL FEED-03 search event dedupe', () => {
  const prefix = `feed03qa${randomUUID().replace(/-/g, '')}`;
  const userIds = [randomUUID(), randomUUID(), randomUUID()];
  const eventIds: string[] = [];
  const blockedTermIds: string[] = [];
  const eventWhere: Prisma.FeedSearchEventWhereInput = {
    OR: [
      { normalizedKeyword: { startsWith: prefix } },
      { userId: { in: userIds } },
      { id: { in: eventIds } },
    ],
  };
  const blockedTermWhere: Prisma.FeedSearchBlockedTermWhereInput = {
    OR: [
      { normalizedKeyword: { startsWith: prefix } },
      { id: { in: blockedTermIds } },
    ],
  };
  let db: PrismaClient;
  let service: CommunityService;
  let verifiedDatabase = false;
  let warnings: jest.SpyInstance;
  let expectedWarnings = 0;

  beforeAll(async () => {
    let url: URL;
    try {
      url = new URL(process.env.FEED_SEARCH_QA_DATABASE_URL || '');
    } catch {
      throw new Error('A valid isolated feed search QA database URL is required');
    }
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.host !== '127.0.0.1:55432' ||
      url.pathname !== '/lumina_story_qa' ||
      url.hash ||
      [...url.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public')
    ) {
      throw new Error('Only 127.0.0.1:55432/lumina_story_qa in the public schema is allowed');
    }
    url.searchParams.set('schema', 'public');
    url.searchParams.set('connection_limit', '8');
    url.searchParams.set('connect_timeout', '5');
    url.searchParams.set('pool_timeout', '5');
    db = new PrismaClient({
      datasources: { db: { url: url.toString() } },
    });
    await db.$connect();
    const names = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (names.length !== 1 || names[0].name !== 'lumina_story_qa') {
      throw new Error('Unexpected feed search QA database');
    }
    verifiedDatabase = true;
    warnings = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await db.user.createMany({ data: userIds.map(id => ({ id })) });
    service = serviceWith(db);
  }, 20_000);

  beforeEach(() => { expectedWarnings = 0; });

  afterEach(() => {
    expect(warnings?.mock.calls ?? []).toHaveLength(expectedWarnings);
    warnings?.mockClear();
  });

  afterAll(async () => {
    if (!db) return;
    try {
      if (!verifiedDatabase) return;
      await db.feedSearchEvent.deleteMany({ where: eventWhere });
      await db.feedSearchBlockedTerm.deleteMany({ where: blockedTermWhere });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      expect(await db.feedSearchEvent.count({ where: eventWhere })).toBe(0);
      expect(await db.feedSearchBlockedTerm.count({ where: blockedTermWhere })).toBe(0);
      expect(await db.user.count({ where: { id: { in: userIds } } })).toBe(0);
    } finally {
      try { await db.$disconnect(); } finally { warnings?.mockRestore(); }
    }
  }, 20_000);

  function keyword(label: string) {
    return `${prefix}-${label}`;
  }

  function visitor(label: string) {
    return `${prefix}:${label}:${randomUUID()}`;
  }

  function hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  function serviceWith(prisma: unknown) {
    return new CommunityService(prisma as never, {} as never, {} as never);
  }

  function withOverrides<T extends object>(target: T, overrides: Record<string, unknown>): T {
    return new Proxy(target, {
      get(object, property) {
        if (typeof property === 'string' && Object.prototype.hasOwnProperty.call(overrides, property)) {
          return overrides[property];
        }
        const value = Reflect.get(object, property, object);
        return typeof value === 'function' ? value.bind(object) : value;
      },
    });
  }

  async function search(
    q: string,
    context: SearchContext = {},
    query: SearchQuery = {},
    target = service,
  ) {
    const result = await target.searchFeed({ q, type: 'text', language: 'en', ...query }, context);
    expect(result.items).toEqual([]);
    expect(result.posts).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.nextCursor).toBeNull();
    expect(result.query.normalizedKeyword).toBe(q);
    return result;
  }

  async function parallelSearch(q: string, contexts: SearchContext[], queries: SearchQuery[] = []) {
    // Drain every request before assertions or cleanup, including unexpected failures.
    const results = await Promise.allSettled(
      contexts.map((context, index) => search(q, context, queries[index])),
    );
    expect(results.every(result => result.status === 'fulfilled')).toBe(true);
  }

  async function events(q: string) {
    return db.feedSearchEvent.findMany({
      where: { normalizedKeyword: q },
      select: {
        id: true,
        userId: true,
        visitorHash: true,
        normalizedKeyword: true,
        searchType: true,
        language: true,
        resultCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async function expectRanking(
    keywords: string[],
    expected: RankingEntry[],
    query: SearchQuery = {},
  ) {
    // Keep PostgreSQL aggregation real, but isolate the capped ranking from other QA runs.
    const scopedEvents = withOverrides(db.feedSearchEvent, {
      groupBy: (args: Prisma.FeedSearchEventGroupByArgs) => Reflect.apply(
        db.feedSearchEvent.groupBy,
        db.feedSearchEvent,
        [{ ...args, where: { AND: [args.where ?? {}, { normalizedKeyword: { in: keywords } }] } }],
      ),
    });
    const reader = serviceWith({
      feedSearchEvent: scopedEvents,
      feedSearchBlockedTerm: db.feedSearchBlockedTerm,
    });
    const result = await reader.getTrendingSearches({
      take: '50', window: '1h', language: 'all', ...query,
    });
    expect(result.items).toHaveLength(expected.length);
    expect(result.items.map(({ normalizedKeyword, type, language, searchCount }) => ({
      normalizedKeyword, type, language, searchCount,
    }))).toEqual(expect.arrayContaining(expected));
    expect(result.items.map(item => item.rank)).toEqual(expected.map((_, index) => index + 1));
    return result.items;
  }

  async function seed(q: string, userId: string, visitorHash: string, minutesAgo: number) {
    const id = randomUUID();
    eventIds.push(id);
    return db.feedSearchEvent.create({
      data: {
        id, userId, visitorHash: hash(visitorHash), keyword: q, normalizedKeyword: q,
        searchType: 'text', language: 'en', resultCount: 0,
        createdAt: new Date(Date.now() - minutesAgo * 60_000),
      },
    });
  }

  test('eight parallel searches by one user with different visitors count once', async () => {
    const q = keyword('user-race');
    const visitors = Array.from({ length: 8 }, (_, index) => visitor(`user-${index}`));
    await parallelSearch(q, visitors.map(visitorHash => ({ userId: userIds[0], visitorHash })),
      visitors.map((_, index) => ({
        q: index % 2 ? `  ${q.toUpperCase()}  ` : q,
        language: index % 2 ? 'EN-us' : 'en',
      })));
    const rows = await events(q);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: userIds[0], searchType: 'text', language: 'en', resultCount: 0 });
    expect(visitors.map(hash)).toContain(rows[0].visitorHash);
    await expectRanking([q], [{ normalizedKeyword: q, type: 'text', language: 'en', searchCount: 1 }]);
  }, 20_000);

  test('eight parallel anonymous searches by one visitor count once', async () => {
    const q = keyword('visitor-race');
    const visitorHash = visitor('anonymous');
    await parallelSearch(q, Array.from({ length: 8 }, () => ({ visitorHash })));
    const rows = await events(q);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: null, visitorHash: hash(visitorHash), resultCount: 0 });
    await expectRanking([q], [{ normalizedKeyword: q, type: 'text', language: 'en', searchCount: 1 }]);
  }, 20_000);

  test('mixed anonymous and logged-in searches sharing one visitor count once', async () => {
    const q = keyword('mixed-race');
    const visitorHash = visitor('shared');
    await parallelSearch(q, Array.from({ length: 8 }, (_, index) => ({
      visitorHash,
      ...(index % 2 ? { userId: userIds[index % userIds.length] } : {}),
    })));
    const rows = await events(q);
    expect(rows).toHaveLength(1);
    expect(rows[0].visitorHash).toBe(hash(visitorHash));
    expect([null, ...userIds]).toContain(rows[0].userId);
    await expectRanking([q], [{ normalizedKeyword: q, type: 'text', language: 'en', searchCount: 1 }]);
  }, 20_000);

  test('independent identities, keywords, types, and normalized languages remain distinct', async () => {
    const q = keyword('independent');
    const other = keyword('other-keyword');
    const first = { userId: userIds[0], visitorHash: visitor('first') };
    const second = { userId: userIds[1], visitorHash: visitor('second') };
    await parallelSearch(q, [first, second, { visitorHash: visitor('third') }, { visitorHash: visitor('fourth') }]);
    await search(q, { userId: userIds[1] });
    await search(other, first);
    await search(q, first, { q: `#${q.toUpperCase()}`, type: 'hashtag' });
    await search(q, first, { language: undefined, locale: 'ko-KR' });
    await search(q, first, { language: 'KO' });
    const rows = await events(q);
    expect(rows).toHaveLength(6);
    expect(rows.filter(row => row.searchType === 'text' && row.language === 'en')).toHaveLength(4);
    expect(rows.filter(row => row.searchType === 'hashtag' && row.language === 'en')).toHaveLength(1);
    expect(rows.filter(row => row.searchType === 'text' && row.language === 'ko')).toHaveLength(1);
    expect(rows.every(row => row.resultCount === 0)).toBe(true);
    expect(await events(other)).toHaveLength(1);
    const ranking = await expectRanking([q, other], [
      { normalizedKeyword: q, type: 'text', language: 'en', searchCount: 4 },
      { normalizedKeyword: q, type: 'hashtag', language: 'en', searchCount: 1 },
      { normalizedKeyword: q, type: 'text', language: 'ko', searchCount: 1 },
      { normalizedKeyword: other, type: 'text', language: 'en', searchCount: 1 },
    ]);
    expect(ranking[0]).toMatchObject({ normalizedKeyword: q, type: 'text', language: 'en', searchCount: 4 });
    await expectRanking([q, other], [
      { normalizedKeyword: q, type: 'hashtag', language: 'en', searchCount: 1 },
    ], { type: 'hashtag', language: undefined, locale: 'en-US' });
  }, 20_000);

  test('identityless searches retain the existing count-every-call policy', async () => {
    const q = keyword('identityless');
    const contexts: SearchContext[] = [{}, { visitorHash: null }, { visitorHash: '' }];
    await parallelSearch(q, Array.from({ length: 8 }, (_, index) => contexts[index % contexts.length]));
    const rows = await events(q);
    expect(rows).toHaveLength(8);
    expect(rows.every(row => row.userId === null && row.visitorHash === null && row.resultCount === 0)).toBe(true);
    await expectRanking([q], [{ normalizedKeyword: q, type: 'text', language: 'en', searchCount: 8 }]);
  }, 20_000);

  test('recent events suppress either matching identity but events older than ten minutes allow a new row', async () => {
    const recent = keyword('recent');
    const old = keyword('old');
    const recentVisitor = visitor('recent');
    const oldVisitor = visitor('old');
    const recentSeed = await seed(recent, userIds[0], recentVisitor, 9);
    const oldSeed = await seed(old, userIds[1], oldVisitor, 11);
    await search(recent, { userId: userIds[0], visitorHash: visitor('changed') });
    await search(recent, { visitorHash: recentVisitor });
    expect((await events(recent)).map(row => row.id)).toEqual([recentSeed.id]);
    await search(old, { userId: userIds[1], visitorHash: oldVisitor });
    await search(old, { userId: userIds[1], visitorHash: oldVisitor });
    const rows = await events(old);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe(oldSeed.id);
    expect(rows[1].createdAt.getTime() - oldSeed.createdAt.getTime()).toBeGreaterThan(10 * 60_000);
    const ranking = await expectRanking([recent, old], [
      { normalizedKeyword: recent, type: 'text', language: 'en', searchCount: 1 },
      { normalizedKeyword: old, type: 'text', language: 'en', searchCount: 2 },
    ]);
    expect(ranking[0].normalizedKeyword).toBe(old);
  }, 20_000);

  test('an analytics failure rolls back the real insert, preserves search, and does not retry automatically', async () => {
    expectedWarnings = 2;
    const q = keyword('rollback');
    const visitorHash = visitor('rollback');
    const context = { userId: userIds[2], visitorHash };
    let createAttempts = 0;
    const transaction = jest.fn((
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: TransactionOptions,
    ) => db.$transaction(async tx => {
      const faultedEvents = withOverrides(tx.feedSearchEvent, {
        create: async (args: Prisma.FeedSearchEventCreateArgs) => {
          createAttempts += 1;
          const id = randomUUID();
          eventIds.push(id);
          await tx.feedSearchEvent.create({ ...args, data: { ...args.data, id } });
          // Fail after a real write so a swallowed error inside the transaction cannot pass.
          if (createAttempts === 1) await tx.$queryRaw`SELECT 1 / 0`;
          throw new Error(`Synthetic analytics failure ${q} ${visitorHash} ${context.userId}`);
        },
      });
      return callback(withOverrides(tx, { feedSearchEvent: faultedEvents }));
    }, options));
    const failing = serviceWith(withOverrides(db, { $transaction: transaction }));
    const first = await search(q, context, {}, failing);
    expect(createAttempts).toBe(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(await events(q)).toHaveLength(0);
    const second = await search(q, context, {}, failing);
    expect(second).toEqual(first);
    expect(createAttempts).toBe(2);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction.mock.calls.every(([, options]) =>
      options?.isolationLevel === Prisma.TransactionIsolationLevel.ReadCommitted,
    )).toBe(true);
    expect(await events(q)).toHaveLength(0);
    expect(warnings.mock.calls).toHaveLength(2);
    const warning = warnings.mock.calls[0];
    expect(warning).toHaveLength(1);
    expect(typeof warning[0]).toBe('string');
    expect(warning[0].trim().length).toBeGreaterThan(0);
    expect(warnings.mock.calls[1]).toEqual(warning);
    for (const detail of [q, visitorHash, context.userId, 'Synthetic analytics failure', 'SELECT', 'division by zero']) {
      expect(warning[0]).not.toContain(detail);
    }
    await expectRanking([q], []);
    expect(await search(q, context)).toEqual(first);
    const rows = await events(q);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: context.userId, visitorHash: hash(visitorHash), resultCount: 0 });
    await expectRanking([q], [{ normalizedKeyword: q, type: 'text', language: 'en', searchCount: 1 }]);
  }, 20_000);

  test('an active blocked term is omitted from rankings without rejecting direct search', async () => {
    const blocked = keyword('blocked');
    const visible = keyword('visible');
    const id = randomUUID();
    blockedTermIds.push(id);
    await db.feedSearchBlockedTerm.create({
      data: {
        id, keyword: blocked, normalizedKeyword: blocked, searchType: 'all', language: 'all',
        status: 'active', createdByUserId: userIds[0],
      },
    });
    await parallelSearch(blocked, Array.from({ length: 3 }, () => ({ visitorHash: visitor('blocked') })));
    await parallelSearch(visible, Array.from({ length: 2 }, () => ({ visitorHash: visitor('visible') })));
    expect(await events(blocked)).toHaveLength(3);
    expect(await events(visible)).toHaveLength(2);
    await expectRanking([blocked, visible], [
      { normalizedKeyword: visible, type: 'text', language: 'en', searchCount: 2 },
    ]);
    await db.feedSearchBlockedTerm.update({ where: { id }, data: { status: 'inactive' } });
    const ranking = await expectRanking([blocked, visible], [
      { normalizedKeyword: blocked, type: 'text', language: 'en', searchCount: 3 },
      { normalizedKeyword: visible, type: 'text', language: 'en', searchCount: 2 },
    ]);
    expect(ranking[0].normalizedKeyword).toBe(blocked);
  }, 20_000);

  test('invalid search input does not write any event owned by this run', async () => {
    const q = keyword('invalid');
    const before = await db.feedSearchEvent.count({ where: eventWhere });
    const inputs: SearchQuery[] = [
      {}, { q: '' }, { q: '   ' }, { q: '#', type: 'hashtag' }, { q: `${q}${q}` },
      { q, type: 'invalid' }, { q, language: 'invalid' }, { q, take: '1.5' },
    ];
    for (const input of inputs) {
      await expect(service.searchFeed(input, {
        userId: userIds[0], visitorHash: visitor('invalid'),
      })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(await db.feedSearchEvent.count({ where: eventWhere })).toBe(before);
    expect(await events(q)).toHaveLength(0);
    await expectRanking([q], []);
  }, 20_000);
});
