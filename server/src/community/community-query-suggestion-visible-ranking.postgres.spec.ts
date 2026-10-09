import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { CommunityService } from './community.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('query suggestion ranking on owned PostgreSQL (synthetic search events)', () => {
  let db: PrismaClient;
  let service: CommunityService;
  const prefix = `candidate-${randomUUID().replace(/-/g, '')}`;
  const names = { first: `${prefix}-first`, second: `${prefix}-second`, third: `${prefix}-third`,
    allowed: `${prefix}-allowed`, global: `${prefix}-global`, inactive: `${prefix}-inactive` };
  const baseTime = Date.now();

  async function snapshot() {
    return {
      events: await db.feedSearchEvent.findMany({ orderBy: { id: 'asc' } }),
      terms: await db.feedSearchBlockedTerm.findMany({ orderBy: { id: 'asc' } }),
      users: await db.user.findMany({ orderBy: { id: 'asc' } }),
      posts: await db.communityPost.findMany({ orderBy: { id: 'asc' } }),
    };
  }
  async function events(keyword: string, count: number, language = 'en', searchType = 'text', age = 60_000) {
    await db.feedSearchEvent.createMany({ data: Array.from({ length: count }, (_, index) => ({
      id: randomUUID(), keyword: keyword.toUpperCase(), normalizedKeyword: keyword,
      language, searchType, visitorHash: `synthetic-${randomUUID()}`, resultCount: 0,
      createdAt: new Date(baseTime - age - index * 1000),
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

  it('ranks eligible query groups before the cap while keeping locale/type and read-side rows unchanged', async () => {
    const original = await snapshot();
    expect(original.events).toEqual([]);
    expect(original.terms).toEqual([]);
    await events(names.first, 4);
    await events(names.second, 3);
    await events(names.third, 2);
    await events(names.allowed, 1);
    await events(names.allowed, 12, 'en', 'text', 25 * 60 * 60_000);
    await db.feedSearchBlockedTerm.createMany({ data: [names.first, names.second, names.third].map(keyword => ({
      keyword, normalizedKeyword: keyword, language: 'en', searchType: 'text', status: 'active',
    })) });
    const firstSeed = await snapshot();
    const first = await service.getSearchSuggestions({ q: prefix, language: 'en', take: '1' });
    expect(first.sections.recentQueries).toHaveLength(1);
    expect(first.sections.recentQueries[0]).toMatchObject({ type: 'query', keyword: names.allowed.toUpperCase(),
      normalizedKeyword: names.allowed, searchType: 'text', language: 'en', searchCount: 1 });
    expect(first.sections.hashtags).toEqual([]);
    expect(first.sections.artists).toEqual([]);
    expect(first.sections.users).toEqual([]);
    expect(first.policy.sectionTakeLimit).toBe(10);
    expect(first.policy.defaultWindow).toBe('24h');
    expect(await snapshot()).toEqual(firstSeed);

    await events(names.first, 7, 'ja', 'text');
    await events(names.first, 5, 'en', 'hashtag');
    await events(names.global, 8, 'en', 'hashtag');
    await events(names.global, 8, 'ja', 'text');
    await events(names.inactive, 6);
    await db.feedSearchBlockedTerm.createMany({ data: [
      { keyword: names.global, normalizedKeyword: names.global, language: 'all', searchType: 'all', status: 'active' },
      { keyword: names.inactive, normalizedKeyword: names.inactive, language: 'all', searchType: 'all', status: 'inactive' },
    ] });
    const seeded = await snapshot();
    const all = await service.getSearchSuggestions({ q: prefix, language: 'all', take: '10', window: '24h' });
    expect(all.sections.recentQueries.map(item => [item.normalizedKeyword, item.language, item.searchType, item.searchCount]))
      .toEqual([[names.first, 'ja', 'text', 7], [names.inactive, 'en', 'text', 6],
        [names.first, 'en', 'hashtag', 5], [names.allowed, 'en', 'text', 1]]);
    expect(await snapshot()).toEqual(seeded);
    await expect(service.getSearchSuggestions({ window: 'invalid' })).rejects.toBeInstanceOf(BadRequestException);
    expect(await snapshot()).toEqual(seeded);
    expect(seeded.events).toHaveLength(56);
    expect(seeded.terms).toHaveLength(5);
    expect(seeded.users).toEqual(original.users);
    expect(seeded.posts).toEqual(original.posts);
  });
});
