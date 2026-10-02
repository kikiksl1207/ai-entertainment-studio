import 'reflect-metadata';
import { BadRequestException, ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { CommunityService } from '../community/community.service';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

describe('community moderation controller permission boundary', () => {
  const guard = new AdminPermissionGuard(new Reflector());
  const context = (handler: keyof AdminController, permissions?: string[]) => ({
    getHandler: () => AdminController.prototype[handler], getClass: () => AdminController,
    switchToHttp: () => ({ getRequest: () => ({ user: permissions ? { adminPermissions: permissions } : undefined }) }),
  }) as unknown as ExecutionContext;

  test('read permission cannot mutate reports or hide/restore posts; unrelated and guest permissions cannot read', () => {
    for (const handler of ['getCommunityReports', 'getCommunityPosts', 'getCommunityModerationSummary'] as const) {
      expect(guard.canActivate(context(handler, ['community:read']))).toBe(true);
      for (const permissions of [undefined, [], ['users:read']]) {
        expect(() => guard.canActivate(context(handler, permissions))).toThrow(ForbiddenException);
      }
    }
    for (const handler of ['updateCommunityReport', 'hideCommunityPost', 'restoreCommunityPost'] as const) {
      expect(() => guard.canActivate(context(handler, ['community:read']))).toThrow(ForbiddenException);
      for (const permissions of [['community:write'], ['community:*'], ['*']]) {
        expect(guard.canActivate(context(handler, permissions))).toBe(true);
      }
    }
  });
});

const run = process.env.RUN_COMMUNITY_MODERATION_DB_QA === '1' ? describe : describe.skip;
run('isolated PostgreSQL report to moderation to public-read flow', () => {
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const posts: string[] = [];
  const reportIds: string[] = [];
  let db: PrismaClient;
  let community: CommunityService;
  let admin: AdminService;
  const actor = { id: ids[2], adminPermissions: ['community:write'] };

  beforeAll(async () => {
    const url = new URL(process.env.COMMUNITY_MODERATION_QA_DATABASE_URL || '');
    if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/lumina_story_qa') {
      throw new Error('Only the named local isolated QA database is allowed');
    }
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await db.$connect();
    const names = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (names[0]?.name !== 'lumina_story_qa') throw new Error('Unexpected database');
    await db.user.createMany({ data: ids.map(id => ({ id })) });
    community = new CommunityService(db as never, {} as never, {} as never);
    admin = new AdminService(db as never, {} as never);
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await db.auditEvent.deleteMany({ where: { actorUserId: { in: ids } } });
      await db.communityReport.deleteMany({ where: { postId: { in: posts } } });
      await db.communityPost.deleteMany({ where: { id: { in: posts } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      expect(await db.auditEvent.count({ where: { actorUserId: { in: ids } } })).toBe(0);
      expect(await db.communityReport.count({ where: { id: { in: reportIds } } })).toBe(0);
      expect(await db.communityPost.count({ where: { id: { in: posts } } })).toBe(0);
      expect(await db.user.count({ where: { id: { in: ids } } })).toBe(0);
    } finally { await db.$disconnect(); }
  });

  async function fixture() {
    const id = randomUUID();
    posts.push(id);
    await db.communityPost.create({ data: { id, authorUserId: ids[0], body: 'PRIVATE_SYNTHETIC_BODY_NOT_FOR_AUDIT', metadata: { preserved: true } } });
    const requestKey = randomUUID();
    const receipt = await community.reportPost(ids[1], id, { reason: 'spam', detail: 'PRIVATE_SYNTHETIC_REPORT_DETAIL', requestKey });
    reportIds.push(receipt.report.id);
    return { postId: id, reportId: receipt.report.id, requestKey };
  }

  test('actual receipt appears in admin queue; review/hide/restore return fresh state and public reads follow it', async () => {
    const f = await fixture();
    const queue = await admin.getCommunityReports({ postId: f.postId, status: 'submitted', take: '1' });
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0].id).toBe(f.reportId);
    expect(queue.hasMore).toBe(false);
    expect((await community.getPost(f.postId)).post.id).toBe(f.postId);
    expect((await admin.updateCommunityReport(actor, f.reportId, { status: 'reviewing' })).status).toBe('reviewing');
    const hidden = await admin.updateCommunityReport(actor, f.reportId, { action: 'hide_post', note: 'PRIVATE_SYNTHETIC_MODERATION_NOTE', reason: 'PRIVATE_SYNTHETIC_MODERATION_REASON' });
    expect(hidden.status).toBe('resolved');
    expect(hidden.post.status).toBe('hidden');
    expect((await admin.getCommunityReports({ postId: f.postId, status: 'submitted' })).items).toHaveLength(0);
    await expect(community.getPost(f.postId)).rejects.toBeInstanceOf(NotFoundException);
    expect((await community.getFeed({ take: '100' })).some(post => post.id === f.postId)).toBe(false);
    const restored = await admin.updateCommunityReport(actor, f.reportId, { action: 'restore_post' });
    expect(restored.post.status).toBe('published');
    expect((await community.getPost(f.postId)).post.id).toBe(f.postId);
    const audits = await db.auditEvent.findMany({ where: { targetId: f.reportId } });
    expect(audits).toHaveLength(3);
    const serialized = JSON.stringify(audits);
    for (const secret of ['PRIVATE_SYNTHETIC_BODY_NOT_FOR_AUDIT', 'PRIVATE_SYNTHETIC_REPORT_DETAIL', 'PRIVATE_SYNTHETIC_MODERATION_NOTE', 'PRIVATE_SYNTHETIC_MODERATION_REASON']) {
      expect(serialized).not.toContain(secret);
    }
    expect(audits[1].afterData).toMatchObject({ status: 'resolved', post: { status: 'hidden', auditRawBodyStored: false }, rawReportDetailStored: false });
  });

  test('moderation metadata cannot erase or forge the client retry key after resolution', async () => {
    const f = await fixture();
    const reviewed = await admin.updateCommunityReport(actor, f.reportId, {
      status: 'resolved', metadata: { reviewTag: 'isolated', reportRequestKey: randomUUID() },
    });
    expect(reviewed.metadata).toMatchObject({ reviewTag: 'isolated', reportRequestKey: f.requestKey });
    const retry = await community.reportPost(ids[1], f.postId, { reason: 'spam', requestKey: f.requestKey });
    expect(retry.alreadySubmitted).toBe(true);
    expect(retry.report.id).toBe(f.reportId);
    expect(await db.communityReport.count({ where: { postId: f.postId } })).toBe(1);
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: f.postId } })).reportCount).toBe(1);
  });

  test('invalid report/action/status and absent targets cannot change reports, posts or audits', async () => {
    const f = await fixture();
    await expect(admin.updateCommunityReport(actor, 'bad', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(admin.updateCommunityReport(actor, randomUUID(), {})).rejects.toBeInstanceOf(NotFoundException);
    for (const input of [{ action: 'delete_post' }, { status: 'invalid' }]) {
      await expect(admin.updateCommunityReport(actor, f.reportId, input)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect((await db.communityReport.findUniqueOrThrow({ where: { id: f.reportId } })).status).toBe('submitted');
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: f.postId } })).status).toBe('published');
    expect(await db.auditEvent.count({ where: { targetId: f.reportId } })).toBe(0);
  });

  test('audit failure rolls back report, post and matching-report resolution; a retry completes atomically', async () => {
    const f = await fixture();
    const second = await community.reportPost(ids[0], f.postId, { reason: 'harassment', requestKey: randomUUID() });
    reportIds.push(second.report.id);
    const failing = new AdminService({
      communityReport: db.communityReport,
      $transaction: (callback: (tx: unknown) => Promise<unknown>) => db.$transaction(async tx => callback({
        ...tx, $queryRaw: tx.$queryRaw.bind(tx),
        auditEvent: { create: () => { throw new Error('isolated audit failure'); } },
      })),
    } as never, {} as never);
    await expect(failing.updateCommunityReport(actor, f.reportId, { action: 'hide_post', resolveMatchingReports: true })).rejects.toThrow('isolated audit failure');
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: f.postId } })).status).toBe('published');
    expect(await db.communityReport.count({ where: { postId: f.postId, status: 'submitted' } })).toBe(2);
    expect(await db.auditEvent.count({ where: { targetId: f.reportId } })).toBe(0);
    await admin.updateCommunityReport(actor, f.reportId, { action: 'hide_post', resolveMatchingReports: true });
    expect(await db.communityReport.count({ where: { postId: f.postId, status: 'resolved' } })).toBe(2);
    expect(await db.auditEvent.count({ where: { targetId: f.reportId } })).toBe(1);
  });

  test('the post lock re-read preserves metadata committed while a moderation request waits', async () => {
    const f = await fixture();
    let pending: ReturnType<AdminService['updateCommunityReport']>;
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM community_posts WHERE id = ${f.postId}::uuid FOR UPDATE`;
      await tx.communityPost.update({ where: { id: f.postId }, data: { metadata: { preserved: true, concurrentMarker: true } } });
      pending = admin.updateCommunityReport(actor, f.reportId, { action: 'hide_post' });
      pending.catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    const result = await pending!;
    expect(result.post.status).toBe('hidden');
    expect(result.post.metadata).toMatchObject({ concurrentMarker: true, preserved: true });
  });
});
