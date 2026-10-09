import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { CommunityService } from './community.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

postgres('suggestion cleanup on owned PostgreSQL (synthetic posts only)', () => {
  let db: PrismaClient;
  let service: CommunityService;
  const baseTime = Date.now();

  async function snapshot() {
    return {
      posts: await db.communityPost.findMany({ orderBy: { id: 'asc' } }),
      terms: await db.feedSearchBlockedTerm.findMany({ orderBy: { id: 'asc' } }),
      events: await db.feedSearchEvent.findMany({ orderBy: { id: 'asc' } }),
      users: await db.user.findMany({ orderBy: { id: 'asc' } }),
    };
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

  it('excludes existing cleanup markers and preserves normal public suggestions without read-side writes', async () => {
    const original = await snapshot();
    const actor = await db.user.create({ data: { id: randomUUID() } });
    const post = (body: string, extra: Record<string, unknown> = {}) => ({
      id: randomUUID(), authorUserId: actor.id, body,
      publishedAt: new Date(baseTime - 60_000), ...extra,
    });
    await db.communityPost.createMany({ data: [
      post('#visible'), post('#visible'),
      post('#QA358hidden'), post('#testtestHidden'),
      post('#private', { visibility: 'followers' }),
      post('#draft', { status: 'draft' }),
      post('#deleted', { deletedAt: new Date(baseTime - 30_000) }),
      post('#old', { publishedAt: new Date(baseTime - 25 * 60 * 60_000) }),
      post('#blocked'),
    ] });
    await db.feedSearchBlockedTerm.create({ data: {
      id: randomUUID(), keyword: '#blocked', normalizedKeyword: 'blocked',
      language: 'all', searchType: 'hashtag', status: 'active',
    } });
    const seeded = await snapshot();
    expect(seeded.posts.length - original.posts.length).toBe(9);
    expect(seeded.terms.length - original.terms.length).toBe(1);
    expect(seeded.users.length - original.users.length).toBe(1);
    expect(seeded.events).toEqual(original.events);

    for (const language of ['all', 'en']) {
      const result = await service.getSearchSuggestions({ language, window: '24h', take: '10' });
      expect(result.sections.hashtags.map(item => ({ keyword: item.keyword, count: item.postCount })))
        .toEqual([{ keyword: '#visible', count: 2 }]);
      expect(result.sections.recentQueries).toEqual([]);
      expect(result.sections.artists).toEqual([]);
      expect(result.sections.users).toEqual([]);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ section: 'hashtags', type: 'hashtag', language: 'en' });
      expect(result.policy.defaultWindow).toBe('24h');
      expect(result.policy.sectionTakeLimit).toBe(10);
      expect(result.policy.blockedTermFiltering).toBe(true);
      expect(await snapshot()).toEqual(seeded);
    }
    await expect(service.getSearchSuggestions({ window: 'invalid' })).rejects.toBeInstanceOf(BadRequestException);
    expect(await snapshot()).toEqual(seeded);
  });
});
