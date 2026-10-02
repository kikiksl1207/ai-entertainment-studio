import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CommunityService } from './community.service';

const userId = '00000000-0000-4000-8000-000000000101';
const otherUserId = '00000000-0000-4000-8000-000000000102';
const postId = '00000000-0000-4000-8000-000000000201';
const otherPostId = '00000000-0000-4000-8000-000000000202';
const requestKey = '00000000-0000-4000-8000-000000000301';
const otherRequestKey = '00000000-0000-4000-8000-000000000302';

const activeUserQuery = {
  where: { id: userId, status: 'active', deletedAt: null },
  select: { id: true },
};
const cleanupExclusions = [
  { body: { equals: 'test', mode: 'insensitive' } },
  { body: { contains: 'testtest', mode: 'insensitive' } },
  { body: { equals: 'sample', mode: 'insensitive' } },
  { body: { equals: 'fixture', mode: 'insensitive' } },
  { body: { equals: '\uD14C\uC2A4\uD2B8' } },
  { body: { contains: '\uC784\uC2DC\uBB38\uAD6C' } },
  { body: { contains: '\uC0D8\uD50C\uBB38\uAD6C' } },
  { body: { contains: 'QA358', mode: 'insensitive' } },
];
const publicPostQuery = {
  where: {
    id: postId,
    status: 'published',
    visibility: 'public',
    deletedAt: null,
    NOT: cleanupExclusions,
  },
  select: { id: true },
};

function reportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000401',
    postId,
    reporterUserId: userId,
    reason: 'spam',
    status: 'submitted',
    detail: undefined,
    metadata: { reportRequestKey: null as string | null },
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createHarness() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: { findFirst: jest.fn().mockResolvedValue({ id: userId }) },
    communityPost: {
      findFirst: jest.fn().mockResolvedValue({ id: postId }),
      update: jest.fn().mockResolvedValue({ id: postId, reportCount: 1 }),
    },
    communityReport: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(reportRow()),
    },
  };
  // Distinct clients make reads or writes outside the transaction observable.
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: userId }) },
    $queryRaw: jest.fn(),
    communityPost: { findFirst: jest.fn(), update: jest.fn() },
    communityReport: { findFirst: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const service = new CommunityService(prisma as never, {} as never, {} as never);
  return { service, prisma, tx };
}

type Harness = ReturnType<typeof createHarness>;

function expectNoWrites({ prisma, tx }: Harness) {
  expect(tx.communityReport.create).not.toHaveBeenCalled();
  expect(tx.communityPost.update).not.toHaveBeenCalled();
  expect(prisma.communityReport.create).not.toHaveBeenCalled();
  expect(prisma.communityPost.update).not.toHaveBeenCalled();
}

function expectNoTransactionWork(harness: Harness) {
  expect(harness.tx.$queryRaw).not.toHaveBeenCalled();
  expect(harness.tx.user.findFirst).not.toHaveBeenCalled();
  expect(harness.tx.communityPost.findFirst).not.toHaveBeenCalled();
  expect(harness.tx.communityReport.findFirst).not.toHaveBeenCalled();
  expectNoWrites(harness);
}

function duplicateQuery(reporterUserId = userId, reason = 'spam', key?: string, targetPostId = postId) {
  return {
    where: {
      postId: targetPostId,
      reporterUserId,
      OR: [
        { reason, status: { in: ['submitted', 'reviewing'] } },
        ...(key ? [{ metadata: { path: ['reportRequestKey'], equals: key } }] : []),
      ],
    },
    orderBy: { createdAt: 'asc' },
  };
}

describe('CommunityService reportPost safety', () => {
  it('locks and rechecks before finding, creating and incrementing exactly once', async () => {
    const h = createHarness();
    const detail = 'd'.repeat(500);
    const stored = reportRow({ detail, metadata: { reportRequestKey: requestKey } });
    h.tx.communityReport.create.mockResolvedValue(stored);

    const result = await h.service.reportPost(userId, postId, {
      reason: ' spam ', detail: ` ${detail} `, requestKey: ` ${requestKey} `,
    });

    expect(result).toEqual({ report: stored, alreadySubmitted: false });
    expect(result.report).toBe(stored);
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.prisma.user.findFirst).toHaveBeenCalledTimes(1);
    expect(h.prisma.user.findFirst).toHaveBeenCalledWith(activeUserQuery);
    expect(h.tx.user.findFirst).toHaveBeenCalledTimes(1);
    expect(h.tx.user.findFirst).toHaveBeenCalledWith(activeUserQuery);
    expect(h.tx.$queryRaw).toHaveBeenCalledTimes(2);
    const [userLock, postLock] = h.tx.$queryRaw.mock.calls;
    expect(Array.from(userLock[0])).toEqual(['SELECT id FROM users WHERE id = ', '::uuid FOR SHARE']);
    expect(userLock.slice(1)).toEqual([userId]);
    expect(Array.from(postLock[0])).toEqual(['SELECT id FROM community_posts WHERE id = ', '::uuid FOR UPDATE']);
    expect(postLock.slice(1)).toEqual([postId]);
    expect(h.tx.communityPost.findFirst).toHaveBeenCalledTimes(1);
    expect(h.tx.communityPost.findFirst).toHaveBeenCalledWith(publicPostQuery);
    expect(h.tx.communityReport.findFirst).toHaveBeenCalledTimes(1);
    expect(h.tx.communityReport.findFirst).toHaveBeenCalledWith(duplicateQuery(userId, 'spam', requestKey));
    expect(h.tx.communityReport.create).toHaveBeenCalledTimes(1);
    expect(h.tx.communityReport.create).toHaveBeenCalledWith({
      data: { postId, reporterUserId: userId, reason: 'spam', detail, metadata: { reportRequestKey: requestKey } },
    });
    expect(h.tx.communityPost.update).toHaveBeenCalledTimes(1);
    expect(h.tx.communityPost.update).toHaveBeenCalledWith({
      where: { id: postId },
      data: { reportCount: { increment: 1 }, updatedAt: expect.any(Date) },
    });
    const order = [
      h.prisma.user.findFirst.mock.invocationCallOrder[0],
      h.prisma.$transaction.mock.invocationCallOrder[0],
      h.tx.$queryRaw.mock.invocationCallOrder[0],
      h.tx.user.findFirst.mock.invocationCallOrder[0],
      h.tx.$queryRaw.mock.invocationCallOrder[1],
      h.tx.communityPost.findFirst.mock.invocationCallOrder[0],
      h.tx.communityReport.findFirst.mock.invocationCallOrder[0],
      h.tx.communityReport.create.mock.invocationCallOrder[0],
      h.tx.communityPost.update.mock.invocationCallOrder[0],
    ];
    for (let i = 1; i < order.length; i += 1) expect(order[i - 1]).toBeLessThan(order[i]);
    expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(h.prisma.communityPost.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.communityReport.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.communityReport.create).not.toHaveBeenCalled();
    expect(h.prisma.communityPost.update).not.toHaveBeenCalled();
  });

  it('returns submitted and reviewing duplicates without creating or incrementing', async () => {
    for (const status of ['submitted', 'reviewing']) {
      const h = createHarness();
      const existing = reportRow({ status });
      h.tx.communityReport.findFirst.mockResolvedValue(existing);

      const result = await h.service.reportPost(userId, postId, { reason: 'spam' });

      expect(result).toEqual({ report: existing, alreadySubmitted: true });
      expect(result.report).toBe(existing);
      expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(h.tx.communityReport.findFirst).toHaveBeenCalledWith(duplicateQuery());
      expectNoWrites(h);
    }
  });

  it('deduplicates repeated closed-report retries by requestKey even with a different reason', async () => {
    const h = createHarness();
    const existing = reportRow({ status: 'closed', metadata: { reportRequestKey: requestKey } });
    h.tx.communityReport.findFirst.mockResolvedValue(existing);

    for (let retry = 0; retry < 2; retry += 1) {
      await expect(h.service.reportPost(userId, postId, { reason: 'hate', requestKey })).resolves.toEqual({
        report: existing, alreadySubmitted: true,
      });
    }

    expect(h.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(h.tx.communityReport.findFirst).toHaveBeenCalledTimes(2);
    expect(h.tx.communityReport.findFirst).toHaveBeenCalledWith(duplicateQuery(userId, 'hate', requestKey));
    expectNoWrites(h);
  });

  it('scopes both duplicate branches to the post and reporter, and only open reports to the reason', async () => {
    const unrelatedReports = [
      reportRow({ reporterUserId: otherUserId, metadata: { reportRequestKey: requestKey } }),
      reportRow({ reason: 'hate' }),
      reportRow({ postId: otherPostId, metadata: { reportRequestKey: requestKey } }),
      reportRow({ status: 'closed', metadata: { reportRequestKey: otherRequestKey } }),
    ];
    const h = createHarness();
    h.tx.communityReport.findFirst.mockImplementation(async ({ where }) => {
      expect(where).toEqual(duplicateQuery(userId, 'spam', requestKey).where);
      return unrelatedReports.find((row) =>
        row.postId === where.postId && row.reporterUserId === where.reporterUserId &&
        where.OR.some((branch: { reason?: string; status?: { in: string[] }; metadata?: { equals: string } }) =>
          branch.reason
            ? row.reason === branch.reason && branch.status?.in.includes(row.status)
            : row.metadata.reportRequestKey === branch.metadata?.equals,
        ),
      ) ?? null;
    });

    await expect(h.service.reportPost(userId, postId, { reason: 'spam', requestKey })).resolves.toEqual({
      report: expect.any(Object), alreadySubmitted: false,
    });

    expect(h.tx.communityReport.findFirst).toHaveBeenCalledWith(duplicateQuery(userId, 'spam', requestKey));
    expect(h.tx.communityReport.create).toHaveBeenCalledTimes(1);
    expect(h.tx.communityReport.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ postId, reporterUserId: userId, reason: 'spam' }),
    }));
    expect(h.tx.communityPost.update).toHaveBeenCalledTimes(1);
  });

  it('rejects an inactive or deleted reporter before starting a transaction', async () => {
    const h = createHarness();
    h.prisma.user.findFirst.mockResolvedValue(null);

    await expect(h.service.reportPost(userId, postId, { reason: 'spam' })).rejects.toBeInstanceOf(NotFoundException);

    expect(h.prisma.user.findFirst).toHaveBeenCalledWith(activeUserQuery);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expectNoTransactionWork(h);
  });

  it('rejects invalid post UUID, reason, detail over 500 and requestKey before transaction work', async () => {
    const invalidInputs = [
      { targetPostId: 'not-a-uuid', input: { reason: 'spam' }, message: 'postId must be a UUID' },
      { targetPostId: '00000000-0000-4000-0000-000000000201', input: { reason: 'spam' }, message: 'postId must be a UUID' },
      { targetPostId: postId, input: {}, message: 'reason must be sexual_content, harassment, hate, impersonation, spam, or other' },
      { targetPostId: postId, input: { reason: 'unsupported' }, message: 'reason must be sexual_content, harassment, hate, impersonation, spam, or other' },
      { targetPostId: postId, input: { reason: 123 }, message: 'reason must be sexual_content, harassment, hate, impersonation, spam, or other' },
      { targetPostId: postId, input: { reason: 'spam', detail: 'd'.repeat(501) }, message: 'detail must be shorter than or equal to 500 characters' },
      { targetPostId: postId, input: { reason: 'spam', requestKey: 'not-a-uuid' }, message: 'requestKey must be a UUID' },
      { targetPostId: postId, input: { reason: 'spam', requestKey: '00000000-0000-4000-0000-000000000301' }, message: 'requestKey must be a UUID' },
      ...[null, '', 123, {}].map(requestKey => ({ targetPostId: postId, input: { reason: 'spam', requestKey }, message: 'requestKey must be a UUID' })),
    ];
    for (const { targetPostId, input, message } of invalidInputs) {
      const h = createHarness();

      await expect(h.service.reportPost(userId, targetPostId, input)).rejects.toThrow(new BadRequestException(message));

      expect(h.prisma.user.findFirst).toHaveBeenCalledWith(activeUserQuery);
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
      expectNoTransactionWork(h);
    }
  });

  it('rechecks the active reporter under the user lock and fails closed if the reporter disappeared', async () => {
    const h = createHarness();
    h.tx.user.findFirst.mockResolvedValue(null);

    await expect(h.service.reportPost(userId, postId, { reason: 'spam' })).rejects.toThrow(new NotFoundException('User not found'));

    expect(h.prisma.user.findFirst).toHaveBeenCalledWith(activeUserQuery);
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.tx.user.findFirst).toHaveBeenCalledWith(activeUserQuery);
    expect(h.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(h.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(h.tx.user.findFirst.mock.invocationCallOrder[0]);
    expect(h.tx.communityPost.findFirst).not.toHaveBeenCalled();
    expect(h.tx.communityReport.findFirst).not.toHaveBeenCalled();
    expectNoWrites(h);
  });

  it('rejects missing, unpublished, private, deleted and cleanup-excluded posts before duplicate lookup', async () => {
    const publicPost = { id: postId, status: 'published', visibility: 'public', deletedAt: null as Date | null, body: 'Real public post' };
    const unavailablePosts = [
      null,
      { ...publicPost, status: 'draft' },
      { ...publicPost, status: 'hidden' },
      { ...publicPost, visibility: 'followers' },
      { ...publicPost, visibility: 'private' },
      { ...publicPost, deletedAt: new Date('2026-10-01T00:00:00.000Z') },
      ...['TEST', 'testtest content', 'Sample', 'Fixture', '\uD14C\uC2A4\uD2B8', '\uC784\uC2DC\uBB38\uAD6C', '\uC0D8\uD50C\uBB38\uAD6C', 'qa358 content']
        .map((body) => ({ ...publicPost, body })),
    ];
    for (const post of unavailablePosts) {
      const h = createHarness();
      h.tx.communityPost.findFirst.mockImplementation(async ({ where }) => {
        expect(where).toEqual(publicPostQuery.where);
        if (!post || post.id !== where.id || post.status !== where.status ||
          post.visibility !== where.visibility || post.deletedAt !== where.deletedAt) return null;
        const excluded = where.NOT.some(({ body }: { body: { equals?: string; contains?: string; mode?: string } }) => {
          const text = body.mode === 'insensitive' ? post.body.toLowerCase() : post.body;
          const value = body.equals ?? body.contains ?? '';
          const needle = body.mode === 'insensitive' ? value.toLowerCase() : value;
          return body.equals !== undefined ? text === needle : text.includes(needle);
        });
        return excluded ? null : { id: post.id };
      });

      await expect(h.service.reportPost(userId, postId, { reason: 'spam', requestKey })).rejects.toThrow(new NotFoundException('Post not found'));

      expect(h.tx.$queryRaw).toHaveBeenCalledTimes(2);
      expect(h.tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(h.tx.communityPost.findFirst.mock.invocationCallOrder[0]);
      expect(h.tx.communityPost.findFirst).toHaveBeenCalledWith(publicPostQuery);
      expect(h.tx.communityReport.findFirst).not.toHaveBeenCalled();
      expectNoWrites(h);
    }
  });

  it('propagates the original create or counter-update error out of the same transaction', async () => {
    for (const stage of ['create', 'update'] as const) {
      const h = createHarness();
      const error = Object.assign(new Error(`${stage} failed`), { code: 'P2034', meta: { stage } });
      const failingWrite = stage === 'create' ? h.tx.communityReport.create : h.tx.communityPost.update;
      failingWrite.mockRejectedValueOnce(error);

      await expect(h.service.reportPost(userId, postId, { reason: 'spam' })).rejects.toBe(error);
      await expect(h.prisma.$transaction.mock.results[0].value).rejects.toBe(error);

      expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(h.tx.communityReport.create).toHaveBeenCalledTimes(1);
      expect(h.tx.communityPost.update).toHaveBeenCalledTimes(stage === 'create' ? 0 : 1);
      expect(h.prisma.communityReport.create).not.toHaveBeenCalled();
      expect(h.prisma.communityPost.update).not.toHaveBeenCalled();
    }
  });

  it('propagates a transaction failure without fallback, retry or writes', async () => {
    const h = createHarness();
    const error = new Error('transaction unavailable');
    h.prisma.$transaction.mockRejectedValueOnce(error);

    await expect(h.service.reportPost(userId, postId, { reason: 'spam' })).rejects.toBe(error);

    expect(h.prisma.user.findFirst).toHaveBeenCalledTimes(1);
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expectNoTransactionWork(h);
  });

  it('overrides a forged metadata reportRequestKey with the validated key or null', async () => {
    for (const key of [requestKey, undefined]) {
      const h = createHarness();
      const metadata = { reportRequestKey: otherRequestKey, source: 'feed', nested: { keep: true } };

      await expect(h.service.reportPost(userId, postId, { reason: 'spam', requestKey: key, metadata })).resolves.toEqual({
        report: expect.any(Object), alreadySubmitted: false,
      });

      expect(h.tx.communityReport.findFirst).toHaveBeenCalledWith(duplicateQuery(userId, 'spam', key));
      expect(h.tx.communityReport.create).toHaveBeenCalledTimes(1);
      expect(h.tx.communityReport.create).toHaveBeenCalledWith({
        data: {
          postId, reporterUserId: userId, reason: 'spam', detail: undefined,
          metadata: { reportRequestKey: key ?? null, source: 'feed', nested: { keep: true } },
        },
      });
      expect(h.tx.communityPost.update).toHaveBeenCalledTimes(1);
      expect(metadata.reportRequestKey).toBe(otherRequestKey);
    }
  });
});
