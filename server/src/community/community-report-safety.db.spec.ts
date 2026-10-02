import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { CommunityService } from './community.service';

const run = process.env.RUN_FEED_REPORT_DB_QA === '1' ? describe : describe.skip;

run('isolated PostgreSQL feed report safety', () => {
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const posts: string[] = [];
  let db: PrismaClient;
  let service: CommunityService;

  beforeAll(async () => {
    const url = new URL(process.env.FEED_REPORT_QA_DATABASE_URL || '');
    if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/lumina_story_qa') {
      throw new Error('Only the named local isolated QA database is allowed');
    }
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await db.$connect();
    const names = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (names[0]?.name !== 'lumina_story_qa') throw new Error('Unexpected database');
    await db.user.createMany({ data: ids.map(id => ({ id })) });
    service = new CommunityService(db as never, {} as never, {} as never);
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await db.communityReport.deleteMany({ where: { postId: { in: posts } } });
      await db.communityPost.deleteMany({ where: { id: { in: posts } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      expect(await db.communityReport.count({ where: { reporterUserId: { in: ids } } })).toBe(0);
      expect(await db.communityPost.count({ where: { id: { in: posts } } })).toBe(0);
      expect(await db.user.count({ where: { id: { in: ids } } })).toBe(0);
    } finally { await db.$disconnect(); }
  });

  async function post(extra: Record<string, unknown> = {}) {
    const id = randomUUID();
    posts.push(id);
    await db.communityPost.create({ data: { id, authorUserId: ids[0], body: 'Isolated report safety proof.', ...extra } });
    return id;
  }

  test('parallel duplicates increment once and the same key remains safe after review', async () => {
    const id = await post();
    const requestKey = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 }, () => service.reportPost(ids[1], id, { reason: 'spam', requestKey })));
    expect(new Set(results.map(result => result.report.id)).size).toBe(1);
    expect(results.filter(result => !result.alreadySubmitted)).toHaveLength(1);
    expect(await db.communityReport.count({ where: { postId: id } })).toBe(1);
    expect((await db.communityPost.findUniqueOrThrow({ where: { id } })).reportCount).toBe(1);
    await db.communityReport.update({ where: { id: results[0].report.id }, data: { status: 'resolved' } });
    const retry = await service.reportPost(ids[1], id, { reason: 'spam', requestKey });
    expect(retry.alreadySubmitted).toBe(true);
    expect(retry.report.id).toBe(results[0].report.id);
    expect((await db.communityPost.findUniqueOrThrow({ where: { id } })).reportCount).toBe(1);
  });

  test('open duplicates ignore changing keys but distinct reporters and reasons stay separate', async () => {
    const id = await post();
    const first = await service.reportPost(ids[1], id, { reason: 'spam', requestKey: randomUUID() });
    await db.communityReport.update({ where: { id: first.report.id }, data: { status: 'reviewing' } });
    expect((await service.reportPost(ids[1], id, { reason: 'spam', requestKey: randomUUID() })).report.id).toBe(first.report.id);
    await service.reportPost(ids[2], id, { reason: 'spam', requestKey: randomUUID() });
    await service.reportPost(ids[1], id, { reason: 'harassment', requestKey: randomUUID() });
    expect(await db.communityReport.count({ where: { postId: id } })).toBe(3);
    expect((await db.communityPost.findUniqueOrThrow({ where: { id } })).reportCount).toBe(3);
  });

  test('bad inputs and unavailable posts cannot create a report or increase the counter', async () => {
    const id = await post();
    for (const input of [{ reason: 'invalid' }, { reason: 'spam', detail: 'x'.repeat(501) }, { reason: 'spam', requestKey: 'bad' }]) {
      await expect(service.reportPost(ids[1], id, input)).rejects.toBeInstanceOf(BadRequestException);
    }
    for (const extra of [{ visibility: 'followers' }, { status: 'hidden' }, { deletedAt: new Date() }]) {
      const unavailable = await post(extra);
      await expect(service.reportPost(ids[1], unavailable, { reason: 'spam' })).rejects.toBeInstanceOf(NotFoundException);
      expect((await db.communityPost.findUniqueOrThrow({ where: { id: unavailable } })).reportCount).toBe(0);
      expect(await db.communityReport.count({ where: { postId: unavailable } })).toBe(0);
    }
    expect((await db.communityPost.findUniqueOrThrow({ where: { id } })).reportCount).toBe(0);
  });

  test('visibility changed while waiting for the real post lock is rechecked', async () => {
    const id = await post();
    let report: Promise<unknown>;
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM community_posts WHERE id = ${id}::uuid FOR UPDATE`;
      await tx.communityPost.update({ where: { id }, data: { status: 'hidden' } });
      report = service.reportPost(ids[1], id, { reason: 'spam' });
      report.catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    await expect(report!).rejects.toBeInstanceOf(NotFoundException);
    expect(await db.communityReport.count({ where: { postId: id } })).toBe(0);
  });

  test('a failed counter update rolls back the inserted report and permits the same-key retry', async () => {
    const id = await post();
    const requestKey = randomUUID();
    const failing = new CommunityService({
      user: db.user,
      $transaction: (callback: (tx: unknown) => Promise<unknown>) => db.$transaction(async tx => callback({
        ...tx,
        $queryRaw: tx.$queryRaw.bind(tx),
        communityPost: { ...tx.communityPost, update: () => { throw new Error('isolated counter failure'); } },
      })),
    } as never, {} as never, {} as never);
    await expect(failing.reportPost(ids[1], id, { reason: 'spam', requestKey })).rejects.toThrow('isolated counter failure');
    expect(await db.communityReport.count({ where: { postId: id } })).toBe(0);
    expect((await db.communityPost.findUniqueOrThrow({ where: { id } })).reportCount).toBe(0);
    expect((await service.reportPost(ids[1], id, { reason: 'spam', requestKey })).alreadySubmitted).toBe(false);
  });

  test('a reporter deactivated during submission is rechecked after the user lock', async () => {
    const id = await post();
    let report: Promise<unknown>;
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${ids[2]}::uuid FOR UPDATE`;
      await tx.user.update({ where: { id: ids[2] }, data: { status: 'suspended' } });
      report = service.reportPost(ids[2], id, { reason: 'spam' });
      report.catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    await expect(report!).rejects.toBeInstanceOf(NotFoundException);
    expect(await db.communityReport.count({ where: { postId: id } })).toBe(0);
    await db.user.update({ where: { id: ids[2] }, data: { status: 'active' } });
  });
});
