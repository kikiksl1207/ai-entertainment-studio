import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { CommunityService } from './community.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('visible trending ranking on owned PostgreSQL (synthetic events, no recording API)', () => {
  let db: PrismaClient;
  let service: CommunityService;
  const nonce = randomUUID().replace(/-/g, '');
  const names = {
    first: `qa-first-${nonce}`, second: `qa-second-${nonce}`, third: `qa-third-${nonce}`,
    allowed: `qa-allowed-${nonce}`, global: `qa-global-${nonce}`, inactive: `qa-inactive-${nonce}`,
  };
  const baseTime = Date.now();

  async function snapshot() {
    return {
      events: await db.feedSearchEvent.findMany({ orderBy: { id: 'asc' } }),
      terms: await db.feedSearchBlockedTerm.findMany({ orderBy: { id: 'asc' } }),
      users: await db.user.count(),
    };
  }

  async function events(keyword: string, count: number, language = 'en', searchType = 'text', age = 60_000) {
    await db.feedSearchEvent.createMany({ data: Array.from({ length: count }, (_, index) => ({
      id: randomUUID(), keyword: keyword.toUpperCase(), normalizedKeyword: keyword,
      language, searchType, visitorHash: `synthetic-${nonce}-${randomUUID()}`,
      resultCount: 0, createdAt: new Date(baseTime - age - index * 1000),
    })) });
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    expect(parsed.hostname).toBe('127.0.0.1');
    expect(parsed.port).toBe('55432');
    expect(parsed.pathname).toMatch(/^\/lumina_guidance_qa_20261010_[a-f0-9]{12}$/);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    service = new CommunityService(db as never, {} as never, {} as never);
  });

  afterAll(async () => { await db?.$disconnect(); });

  it('keeps the eligible fourth group, exact/all scope and inactive rules without read-side writes', async () => {
    const original = await snapshot();
    expect(original.events).toEqual([]);
    expect(original.terms).toEqual([]);
    await events(names.first, 4);
    await events(names.second, 3);
    await events(names.third, 2);
    await events(names.allowed, 1);
    await events(names.allowed, 12, 'en', 'text', 2 * 60 * 60_000);
    await db.feedSearchBlockedTerm.createMany({ data: [names.first, names.second, names.third].map(keyword => ({
      keyword, normalizedKeyword: keyword, language: 'en', searchType: 'text', status: 'active',
    })) });

    const firstSeed = await snapshot();
    const first = await service.getTrendingSearches({ language: 'en', type: 'text', window: '1h', take: '1' });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ rank: 1, keyword: names.allowed.toUpperCase(),
      normalizedKeyword: names.allowed, type: 'text', language: 'en', searchCount: 1 });
    expect(first.window.key).toBe('1h');
    expect(first.window.minutes).toBe(60);
    expect(await snapshot()).toEqual(firstSeed);

    await events(names.first, 7, 'ja', 'text');
    await events(names.first, 5, 'en', 'hashtag');
    await events(names.global, 8, 'en', 'hashtag');
    await events(names.global, 8, 'ja', 'text');
    await events(names.inactive, 6, 'en', 'text');
    await db.feedSearchBlockedTerm.createMany({ data: [
      { keyword: names.global, normalizedKeyword: names.global, language: 'all', searchType: 'all', status: 'active' },
      { keyword: names.inactive, normalizedKeyword: names.inactive, language: 'all', searchType: 'all', status: 'inactive' },
    ] });

    const finalSeed = await snapshot();
    const all = await service.getTrendingSearches({ language: 'all', window: '1h', take: '50' });
    expect(all.items.map(item => [item.normalizedKeyword, item.language, item.type, item.searchCount]))
      .toEqual([[names.first, 'ja', 'text', 7], [names.inactive, 'en', 'text', 6],
        [names.first, 'en', 'hashtag', 5], [names.allowed, 'en', 'text', 1]]);
    expect(all.items.map(item => item.rank)).toEqual([1, 2, 3, 4]);
    const text = await service.getTrendingSearches({ language: 'en', type: 'text', window: '1h', take: '1' });
    expect(text.items).toHaveLength(1);
    expect(text.items[0]).toMatchObject({ normalizedKeyword: names.inactive, searchCount: 6 });
    const hashtag = await service.getTrendingSearches({ language: 'en', type: 'hashtag', window: '1h', take: '1' });
    expect(hashtag.items).toHaveLength(1);
    expect(hashtag.items[0]).toMatchObject({ normalizedKeyword: names.first, searchCount: 5 });
    await expect(service.getTrendingSearches({ window: 'unsupported' })).rejects.toBeInstanceOf(BadRequestException);
    expect(await snapshot()).toEqual(finalSeed);
    expect(finalSeed.users).toBe(original.users);
    expect(finalSeed.events).toHaveLength(56);
    expect(finalSeed.terms).toHaveLength(5);
  });
});
