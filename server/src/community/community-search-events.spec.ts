import { BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { CommunityService } from './community.service';

function fixture() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    feedSearchEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'synthetic-search-event' }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    communityPost: { findMany: jest.fn().mockResolvedValue([]) },
    userBlock: { findMany: jest.fn().mockResolvedValue([]) },
    feedSearchEvent: { findFirst: jest.fn(), create: jest.fn() },
  };
  return { tx, prisma, service: new CommunityService(prisma as never, {} as never, {} as never) };
}

function key(keyword: string, type: string, language: string, kind: string, identity: string) {
  return createHash('sha256').update(JSON.stringify([
    'feed-search-event-v1', keyword, type, language, kind, identity,
  ])).digest().readBigInt64BE(0);
}

describe('feed search event transaction boundaries', () => {
  afterEach(() => jest.restoreAllMocks());

  test('locks both OR identities before reading and writes only through ReadCommitted transaction', async () => {
    const { tx, prisma, service } = fixture();
    const result = await service.searchFeed({ q: 'Aurora', language: 'en' }, {
      userId: '00000000-0000-4000-8000-000000000101', visitorHash: 'synthetic-visitor',
    });
    const visitorHash = createHash('sha256').update('synthetic-visitor').digest('hex');
    const keys = [key('aurora', 'text', 'en', 'user', '00000000-0000-4000-8000-000000000101'),
      key('aurora', 'text', 'en', 'visitor', visitorHash)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    expect(tx.$queryRaw.mock.calls.map(call => (call as unknown[])[1])).toEqual(keys);
    for (const [sql] of tx.$queryRaw.mock.calls as unknown[][]) {
      expect((sql as TemplateStringsArray).join('?')).toBe('SELECT pg_advisory_xact_lock(?::bigint)::text');
    }
    expect(tx.$queryRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(tx.feedSearchEvent.findFirst.mock.invocationCallOrder[0]);
    expect(tx.feedSearchEvent.findFirst.mock.invocationCallOrder[0]).toBeLessThan(tx.feedSearchEvent.create.mock.invocationCallOrder[0]);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    expect(tx.feedSearchEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ normalizedKeyword: 'aurora', searchType: 'text', language: 'en',
        OR: [{ userId: '00000000-0000-4000-8000-000000000101' }, { visitorHash }] }),
    }));
    expect(tx.feedSearchEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ keyword: 'Aurora', normalizedKeyword: 'aurora', visitorHash, resultCount: 0 }),
    }));
    expect(prisma.feedSearchEvent.findFirst).not.toHaveBeenCalled();
    expect(prisma.feedSearchEvent.create).not.toHaveBeenCalled();
    expect(result.count).toBe(0);
    expect(result.policy.dedupeWindowMinutes).toBe(10);
  });

  test.each([
    { userId: '00000000-0000-4000-8000-000000000101' },
    { visitorHash: 'synthetic-anonymous' },
  ])('a single identity locks once and existing recent record is not inserted again: %j', async (context) => {
    const { tx, service } = fixture();
    tx.feedSearchEvent.findFirst.mockResolvedValue({ id: 'recent' } as never);
    await service.searchFeed({ q: 'Aurora', language: 'en' }, context);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.feedSearchEvent.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.feedSearchEvent.create).not.toHaveBeenCalled();
  });

  test('identityless internal calls retain the existing record policy without a global lock', async () => {
    const { tx, service } = fixture();
    await service.searchFeed({ q: 'Aurora', language: 'en' });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.feedSearchEvent.findFirst).not.toHaveBeenCalled();
    expect(tx.feedSearchEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.feedSearchEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: null, visitorHash: null }),
    }));
  });

  test('the rolling window is evaluated after the advisory lock wait', async () => {
    const { tx, service } = fixture();
    let now = 1_800_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    tx.$queryRaw.mockImplementation(async () => { now += 15_000; return []; });
    await service.searchFeed({ q: 'Aurora', language: 'en' }, { visitorHash: 'synthetic-visitor' });
    expect(tx.feedSearchEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ createdAt: { gte: new Date(1_215_000) } }),
    }));
  });

  test.each(['userId', 'visitorHash', 'q', 'type', 'language'])('different %s has its own lock scope', async (field) => {
    const first = fixture();
    const second = fixture();
    const query = { q: 'Aurora', type: 'text', language: 'en' };
    const context = { userId: '00000000-0000-4000-8000-000000000101', visitorHash: 'synthetic-visitor' };
    const query2 = { ...query };
    const context2 = { ...context };
    if (field === 'userId') context2.userId = '00000000-0000-4000-8000-000000000102';
    else if (field === 'visitorHash') context2.visitorHash = 'synthetic-other-visitor';
    else if (field === 'q') query2.q = 'Comet';
    else if (field === 'type') { query.q = '#Aurora'; query2.q = '#Aurora'; query2.type = 'hashtag'; }
    else query2.language = 'ja';
    await first.service.searchFeed(query, context);
    await second.service.searchFeed(query2, context2);
    const one = first.tx.$queryRaw.mock.calls.map(call => (call as unknown[])[1]);
    const two = second.tx.$queryRaw.mock.calls.map(call => (call as unknown[])[1]);
    expect(two).not.toEqual(one);
    if (field === 'userId' || field === 'visitorHash') expect(two.filter(value => one.includes(value))).toHaveLength(1);
    else expect(two.filter(value => one.includes(value))).toHaveLength(0);
  });

  test.each(['lock', 'lookup', 'insert', 'transaction'])('analytics %s failure does not hide successful search or leak raw errors', async (boundary) => {
    const { tx, prisma, service } = fixture();
    const error = new Error('synthetic-private-search-and-sql');
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    if (boundary === 'lock') tx.$queryRaw.mockRejectedValue(error);
    if (boundary === 'lookup') tx.feedSearchEvent.findFirst.mockRejectedValue(error);
    if (boundary === 'insert') tx.feedSearchEvent.create.mockRejectedValue(error);
    if (boundary === 'transaction') prisma.$transaction.mockRejectedValue(error);
    const result = await service.searchFeed({ q: 'Aurora', language: 'en' }, { visitorHash: 'synthetic-visitor' });
    expect(result.items).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Failed to record feed search event');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    if (boundary === 'lock' || boundary === 'lookup') expect(tx.feedSearchEvent.create).not.toHaveBeenCalled();
  });

  test.each([{ q: '' }, { q: 'Aurora', type: 'invalid' }, { q: 'Aurora', language: 'invalid' }])('bad input cannot start a recording transaction: %j', async (query) => {
    const { prisma, service } = fixture();
    await expect(service.searchFeed(query)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.communityPost.findMany).not.toHaveBeenCalled();
  });
});
