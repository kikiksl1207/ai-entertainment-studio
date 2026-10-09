import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { FanEngagementService } from './fan-engagement.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const korean = { title: 'Synthetic stored Korean title', description: 'Synthetic stored Korean description' };
jest.setTimeout(30000);

postgres('fan stored label fallback (owned PostgreSQL, no provider)', () => {
  let db: PrismaClient;
  let service: FanEngagementService;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
        parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash ||
        !/^\/lumina_failed_cost_qa_[a-f0-9]{12}$/.test(parsed.pathname)) {
      throw new Error('Dedicated loopback QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    service = new FanEngagementService(db as never);
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function fixture(copy: Prisma.InputJsonObject) {
    const owner = await db.user.create({ data: {} });
    const other = await db.user.create({ data: {} });
    const achievement = await db.fanAchievement.create({ data: {
      code: `synthetic-label-${randomUUID()}`, category: 'synthetic', copy,
    } });
    await db.userFanAchievement.create({ data: {
      userId: owner.id, achievementId: achievement.id, progressCurrent: 1, progressTarget: 1,
    } });
    await db.fanEngagementPointLedger.create({ data: {
      userId: owner.id, points: 7, direction: 'earn', ledgerType: 'synthetic',
      referenceType: 'synthetic', referenceId: achievement.id,
    } });
    return { owner, other, achievement };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function protectedState(f: Fixture) {
    return {
      definition: await db.fanAchievement.findUniqueOrThrow({ where: { id: f.achievement.id } }),
      ownership: await db.userFanAchievement.findMany({ where: { userId: f.owner.id }, orderBy: { id: 'asc' } }),
      ledger: await db.fanEngagementPointLedger.findMany({ where: { userId: f.owner.id }, orderBy: { id: 'asc' } }),
      participations: await db.fanMissionParticipation.findMany({ where: { userId: f.owner.id }, orderBy: { id: 'asc' } }),
      titles: await db.userFanTitle.findMany({ where: { userId: f.owner.id }, orderBy: { id: 'asc' } }),
    };
  }

  it('projects stored Korean fallback for every supported requested summary locale without awarding or mutating', async () => {
    const f = await fixture({ labels: { ko: korean } });
    const before = await protectedState(f);
    for (const locale of locales) {
      const result = await service.getMySummary(f.owner.id, { locale });
      expect(result.locale).toBe(locale);
      expect(result.achievements).toHaveLength(1);
      expect(result.achievements[0].copy.labels).toEqual({ ko: korean, [locale]: korean });
      expect(result.points.balance).toBe(7);
      expect(result.policy.cashLike).toBe(false);
    }
    await service.getMySummary(f.owner.id, { locale: 'en' });
    expect(await protectedState(f)).toEqual(before);
  });

  it('preserves populated requested dictionaries instead of silently replacing or merging their fields', async () => {
    const labels = Object.fromEntries(locales.map(locale => [locale, { title: `Synthetic stored ${locale} title` }]));
    const f = await fixture({ labels });
    const before = await protectedState(f);
    for (const locale of locales) {
      const result = await service.getMySummary(f.owner.id, { locale });
      expect(result.achievements[0].copy.labels).toEqual({ ko: labels.ko, [locale]: labels[locale] });
      expect(result.achievements[0].copy.labels?.[locale]).not.toHaveProperty('description');
    }
    expect(await protectedState(f)).toEqual(before);
  });

  it('falls back for actual stored empty, null, array, scalar and false requested metadata', async () => {
    for (const invalid of [{}, null, [], 'synthetic invalid dictionary', false, 0]) {
      const f = await fixture({ labels: { ko: korean, en: invalid } });
      const before = await protectedState(f);
      const result = await service.getMySummary(f.owner.id, { locale: 'en' });
      expect(result.achievements[0].copy.labels).toEqual({ ko: korean, en: korean });
      expect(await protectedState(f)).toEqual(before);
    }
  });

  it('does not invent missing copy, expose another owner or change the existing mission query validation', async () => {
    const f = await fixture({ labels: { en: {}, ko: [] } });
    const before = await protectedState(f);
    const own = await service.getMySummary(f.owner.id, { locale: 'en' });
    expect(own.achievements[0].copy.labels).toBeUndefined();
    const other = await service.getMySummary(f.other.id, { locale: 'en' });
    expect(other.achievements).toEqual([]);
    expect(other.points.balance).toBe(0);
    expect((await service.getMySummary(f.owner.id, { locale: 'unsupported' })).locale).toBe('ko');
    await expect(service.getMissions({ take: '-1' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getMissions({ surface: 'invalid' })).rejects.toBeInstanceOf(BadRequestException);
    expect((await service.getMissions({ locale: 'en' })).locale).toBe('ko');
    expect(await protectedState(f)).toEqual(before);
  });

  it('propagates an injected persistence failure instead of returning invented fallback data', async () => {
    const f = await fixture({ labels: { ko: korean } });
    const before = await protectedState(f);
    const failing = new Proxy(db, { get(target, field) {
      if (field === '$transaction') return async () => { throw new Error('Synthetic persistence failure'); };
      const value = Reflect.get(target, field);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    await expect(new FanEngagementService(failing as never).getMySummary(f.owner.id, { locale: 'en' }))
      .rejects.toThrow('Synthetic persistence failure');
    expect(await protectedState(f)).toEqual(before);
  });
});
