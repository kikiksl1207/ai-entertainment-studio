import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

const USER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const ACTOR = '00000000-0000-4000-8000-000000000003';
const POST = '00000000-0000-4000-8000-000000000004';
const FIRST = '00000000-0000-4000-8000-000000000013';
const SECOND = '00000000-0000-4000-8000-000000000012';
const THIRD = '00000000-0000-4000-8000-000000000011';
const AVATAR = '00000000-0000-4000-8000-000000000020';
const CREATED = new Date('2026-10-03T01:00:00.000Z');
const READ = new Date('2026-10-03T02:00:00.000Z');
const RAW_TITLE = 'PRIVATE_OLD_COMMENT_TITLE';
const RAW_BODY = 'PRIVATE_OLD_COMMENT_BODY';
const RAW_METADATA = 'PRIVATE_OLD_COMMENT_METADATA';

type Row = {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  actorUserId: string | null;
  artistId: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
  actorUser: {
    id: string;
    email: string;
    profile: {
      displayName: string | null;
      publicHandle: string | null;
      avatarAssetId: string | null;
    } | null;
  } | null;
  artist: { id: string; slug: string; displayName: string } | null;
};

function notification(overrides: Partial<Row> = {}): Row {
  return {
    id: FIRST, userId: USER, type: 'feed.reply', title: RAW_TITLE,
    body: RAW_BODY, actorUserId: ACTOR, artistId: null,
    targetType: 'community_post', targetId: POST, readAt: null,
    createdAt: CREATED,
    metadata: {
      messageKey: RAW_METADATA, titleKey: RAW_METADATA, bodyKey: RAW_METADATA,
      defaultTitle: RAW_TITLE, defaultBody: RAW_BODY,
      commentBody: RAW_BODY, postBody: RAW_BODY,
      nested: { body: RAW_METADATA }, token: RAW_METADATA, cookie: RAW_METADATA,
    },
    actorUser: {
      id: ACTOR, email: 'private-actor-email@example.test',
      profile: { displayName: 'Public Actor', publicHandle: 'public_actor', avatarAssetId: null },
    },
    artist: null,
    ...overrides,
  };
}

type CapturedSql = { sql: string; values: unknown[] };

function captureSql(args: unknown[]): CapturedSql {
  const [first, ...parameters] = args;
  if (Array.isArray(first) && 'raw' in first) {
    expect(first.length).toBe(parameters.length + 1);
    return { sql: first.join('?'), values: parameters };
  }
  const query = first as Prisma.Sql;
  expect(typeof first).not.toBe('string');
  expect(query).toEqual(expect.objectContaining({ sql: expect.any(String), values: expect.any(Array) }));
  expect(parameters).toHaveLength(0);
  return { sql: query.sql, values: [...query.values] };
}

function normalized(query: CapturedSql): string {
  return query.sql.replace(/"/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function expectVisibleScope(query: CapturedSql) {
  const sql = normalized(query);
  expect(query.values).toContain(USER);
  expect(sql).not.toContain(USER);
  expect(sql).toMatch(/\b\w+\.user_id\s*=\s*\?(?:::uuid)?/);
  expect(sql).toContain('user_notifications');
  expect(sql).toContain('user_blocks');
  expect(sql).toContain('community_posts');
  expect(sql).toContain('community_hidden_posts');
  expect(sql).toMatch(/\b\w+\.status\s*=\s*'published'/);
  expect(sql).toMatch(/\b\w+\.visibility\s*=\s*'public'/);
  expect(sql).toMatch(/\b\w+\.id\s*=\s*\w+\.target_id/);
  expect(sql).toMatch(/\b\w+\.target_type\s*=\s*'community_post'/);
  expect(sql).toMatch(/\b\w+\.type\s+not\s+like\s+'feed\.%'/);
  expect(sql).toMatch(/\b\w+\.target_type\s+is\s+distinct\s+from\s+'community_post'/);
  expect(sql).toMatch(/not exists\s*\(/);
  expect(sql.match(/\.status\s*=\s*'active'/g)).toHaveLength(3);
  expect(sql.match(/\.deleted_at\s+is\s+null/g)).toHaveLength(4);
  expect(sql).toMatch(/\b\w+\.post_id\s*=\s*\w+\.id/);
  // Both directions must be present for the actor and the target post's author.
  for (const column of ['actor_user_id', 'author_user_id']) {
    expect(sql).toMatch(new RegExp(
      `\\b\\w+\\.blocker_user_id\\s*=\\s*\\?(?:::uuid)?\\s+and\\s+\\w+\\.blocked_user_id\\s*=\\s*\\w+\\.${column}`,
    ));
    expect(sql).toMatch(new RegExp(
      `\\b\\w+\\.blocked_user_id\\s*=\\s*\\?(?:::uuid)?\\s+and\\s+\\w+\\.blocker_user_id\\s*=\\s*\\w+\\.${column}`,
    ));
  }
}

function visibilityCore(query: CapturedSql): string {
  const sql = normalized(query);
  const start = sql.search(/\b\w+\.user_id\s*=/);
  const hiddenStart = sql.indexOf('community_hidden_posts');
  const end = /\b\w+\.deleted_at\s+is\s+null/.exec(sql.slice(hiddenStart));
  expect(start).toBeGreaterThanOrEqual(0);
  expect(hiddenStart).toBeGreaterThan(start);
  expect(end).not.toBeNull();
  return sql.slice(start, hiddenStart + end!.index + end![0].length);
}

function expectSqlNativeCursor(query: CapturedSql, cursor: string) {
  const sql = normalized(query);
  expect(sql).toMatch(/\(\w+\.created_at,\s*\w+\.id\)\s*<\s*\(\s*\(select anchor\.created_at from user_notifications anchor where anchor\.user_id\s*=\s*\?::uuid and anchor\.id\s*=\s*\?::uuid\),\s*\?::uuid\s*\)/);
  expect(query.values.filter((value) => value === cursor)).toHaveLength(2);
  expect(query.values.some((value) => value instanceof Date)).toBe(false);
  expect(query.sql).not.toContain(cursor);
  expect(query.sql).not.toContain(USER);
}

type FindArgs = {
  where?: {
    id?: string | { in: string[] };
    userId?: string;
    type?: string;
    readAt?: null | { not: null };
  };
  orderBy?: unknown;
  take?: number;
  cursor?: { id: string };
  skip?: number;
};

function fixture(rows: Row[] = [notification()]) {
  const state = {
    ids: rows.map(({ id }) => ({ id })),
    count: rows.filter((row) => row.userId === USER && !row.readAt).length,
    anchors: [{ id: FIRST }],
    readRows: [{ id: FIRST, readAt: rows.find((row) => row.id === FIRST)?.readAt ?? null }],
    updatedCount: 1,
  };
  const queries: CapturedSql[] = [];
  const writes: CapturedSql[] = [];

  function selectRows(args: FindArgs = {}): Row[] {
    const where = args.where ?? {};
    const idFilter = where.id;
    let selected = rows.filter((row) =>
      (!where.userId || row.userId === where.userId) &&
      (!where.type || row.type === where.type) &&
      (!idFilter || (typeof idFilter === 'string' ? row.id === idFilter : idFilter.in.includes(row.id))) &&
      (where.readAt === undefined || (where.readAt === null ? row.readAt === null : row.readAt !== null)),
    );
    if (args.orderBy) {
      selected = [...selected].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    }
    if (args.cursor) {
      selected = selected.slice(selected.findIndex((row) => row.id === args.cursor!.id) + (args.skip ?? 0));
    }
    return args.take === undefined ? selected : selected.slice(0, args.take);
  }

  function client() {
    return {
      $queryRaw: jest.fn(async (...args: unknown[]) => {
        const query = captureSql(args);
        queries.push(query);
        const sql = normalized(query);
        if (/\bcount\s*\(/.test(sql)) return [{ unreadCount: state.count }];
        // These are supplied SQL results, not a JavaScript emulation of PostgreSQL visibility.
        const selection = sql.split(/\bfrom\b/)[0];
        if (selection.includes('read_at')) return state.readRows;
        if (/\blimit 1\b/.test(sql) && !/\border by\b/.test(sql)) return state.anchors;
        return state.ids;
      }),
      $executeRaw: jest.fn(async (...args: unknown[]) => {
        const query = captureSql(args);
        writes.push(query);
        if (/\b\w+\.id\s*=\s*\?(?:::uuid)?/.test(normalized(query))) {
          for (const selected of state.readRows) {
            if (selected.readAt === null && query.values.includes(selected.id)) {
              selected.readAt = READ;
              const row = rows.find((item) => item.id === selected.id);
              if (row) row.readAt = READ;
            }
          }
        }
        return state.updatedCount;
      }),
      $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn(),
      userNotification: {
        findMany: jest.fn(async (args?: FindArgs) => selectRows(args)),
        findUnique: jest.fn(async (args: FindArgs) => selectRows(args)[0] ?? null),
        findFirst: jest.fn(async (args: FindArgs) => selectRows(args)[0] ?? null),
        count: jest.fn(async (args?: FindArgs) => selectRows(args).length),
        update: jest.fn(async (args: FindArgs) => selectRows(args)[0] ?? null),
        updateMany: jest.fn(async (args?: FindArgs) => ({ count: selectRows(args).length })),
        create: jest.fn(), delete: jest.fn(), deleteMany: jest.fn(),
      },
      asset: { findUnique: jest.fn().mockResolvedValue(null) },
      userSettings: { findUnique: jest.fn() },
      communityPost: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      communityReply: { create: jest.fn(), update: jest.fn() },
      walletAccount: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      walletLedger: { create: jest.fn() },
      settlementRecord: { create: jest.fn(), update: jest.fn() },
      userPayoutAccount: { create: jest.fn(), update: jest.fn() },
    };
  }

  const tx = client();
  const prisma = {
    ...client(),
    $transaction: jest.fn(async (callback: (db: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const config = { get: jest.fn().mockReturnValue('https://assets.example.test') };
  const service = new NotificationsService(prisma as never, config as never);
  const controller = new NotificationsController(service);
  return { rows, state, queries, writes, tx, prisma, service, controller };
}

type Fixture = ReturnType<typeof fixture>;
const operations = ['list', 'unreadCount', 'markRead', 'markAllRead'] as const;
type Operation = typeof operations[number];
const rawConflictCases = operations.flatMap((operation) =>
  ['40001', '40P01'].map((sqlState) => ({ operation, sqlState })),
);

function run(f: Fixture, operation: Operation) {
  switch (operation) {
    case 'list': return f.service.list(USER, {});
    case 'unreadCount': return f.service.unreadCount(USER);
    case 'markRead': return f.service.markRead(USER, FIRST);
    case 'markAllRead': return f.service.markAllRead(USER);
  }
}

function expectNoFallback(f: Fixture) {
  expect(f.prisma.$queryRaw).not.toHaveBeenCalled();
  expect(f.prisma.$executeRaw).not.toHaveBeenCalled();
  expect(f.prisma.asset.findUnique).not.toHaveBeenCalled();
  for (const method of Object.values(f.prisma.userNotification)) expect(method).not.toHaveBeenCalled();
  for (const db of [f.prisma, f.tx]) {
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(db.userNotification.count).not.toHaveBeenCalled();
    expect(db.userNotification.findFirst).not.toHaveBeenCalled();
    expect(db.userNotification.update).not.toHaveBeenCalled();
    expect(db.userNotification.updateMany).not.toHaveBeenCalled();
  }
}

function expectNoUnrelatedWrites(f: Fixture) {
  for (const db of [f.prisma, f.tx]) {
    expect(db.userNotification.create).not.toHaveBeenCalled();
    expect(db.userNotification.delete).not.toHaveBeenCalled();
    expect(db.userNotification.deleteMany).not.toHaveBeenCalled();
    expect(db.userSettings.findUnique).not.toHaveBeenCalled();
    for (const delegate of [db.communityPost, db.communityReply, db.walletAccount,
      db.walletLedger, db.settlementRecord, db.userPayoutAccount]) {
      for (const method of Object.values(delegate)) expect(method).not.toHaveBeenCalled();
    }
  }
}

function knownError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('Synthetic transaction failure', {
    code, clientVersion: 'unit-test', meta,
  });
}

describe('NotificationsService visibility (synthetic Prisma unit fixtures)', () => {
  it('projects feed.reply title, body, metadata and i18n from templates, never historical comment content', async () => {
    const f = fixture();
    const { notifications } = await f.service.list(USER, {});
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      id: FIRST, type: 'feed.reply',
      title: 'New reply on your feed post', body: 'Someone replied to your feed post.',
      i18n: {
        messageKey: 'notification.feed.reply', titleKey: 'notification.feed.reply.title',
        bodyKey: 'notification.feed.reply.body', defaultTitle: 'New reply on your feed post',
        defaultBody: 'Someone replied to your feed post.',
      },
      actor: { id: ACTOR, displayName: 'Public Actor', publicHandle: 'public_actor' },
    });
    const output = JSON.stringify(notifications);
    for (const secret of [RAW_TITLE, RAW_BODY, RAW_METADATA, 'private-actor-email@example.test']) {
      expect(output).not.toContain(secret);
    }
    expect(notifications[0].metadata).toEqual({
      messageKey: 'notification.feed.reply', titleKey: 'notification.feed.reply.title',
      bodyKey: 'notification.feed.reply.body',
    });
    expect(notifications[0].actor).not.toHaveProperty('email');
    expect(f.rows[0].body).toBe(RAW_BODY);
    expect(f.rows[0].metadata).toHaveProperty('commentBody', RAW_BODY);
  });

  it.each(['feed.like', 'feed.thread_continuation', 'feed.repost', 'feed.future_event'])(
    'does not trust stored content or translation keys for %s', async (type) => {
      const f = fixture([notification({ type })]);
      const result = await f.service.list(USER, {});
      expect(result.notifications).toHaveLength(1);
      for (const secret of [RAW_TITLE, RAW_BODY, RAW_METADATA]) {
        expect(JSON.stringify(result.notifications)).not.toContain(secret);
      }
      expect(result.notifications[0].i18n.defaultTitle).toBe(result.notifications[0].title);
      expect(result.notifications[0].i18n.defaultBody).toBe(result.notifications[0].body);
    },
  );

  it.each([
    { metadata: null }, { metadata: ['legacy', RAW_METADATA] },
    { metadata: RAW_METADATA }, { metadata: 42 },
  ])(
    'handles non-object legacy feed metadata without exposing it: %p', async ({ metadata }) => {
      const f = fixture([notification({ metadata })]);
      const result = await f.service.list(USER, {});
      expect(result.notifications[0].i18n.messageKey).toBe('notification.feed.reply');
      expect(JSON.stringify(result.notifications)).not.toContain(RAW_METADATA);
      expect(JSON.stringify(result.notifications)).not.toContain(RAW_BODY);
    },
  );

  it.each(['fan_letter.received', 'fan_letter.reply', 'user.follow', 'system.announcement'])(
    'preserves non-feed %s title/body/metadata compatibility', async (type) => {
      const metadata = { messageKey: 'legacy.custom.message', titleKey: 'legacy.custom.title',
        bodyKey: 'legacy.custom.body', letterPreview: 'Existing fan letter preview', nested: { keep: true } };
      const row = notification({ type, targetType: 'fan_letter', title: 'Legacy title', body: 'Legacy body', metadata });
      const f = fixture([row]);
      const result = await f.service.list(USER, {});
      expect(result.notifications[0]).toMatchObject({ title: row.title, body: row.body, metadata,
        i18n: { messageKey: metadata.messageKey, titleKey: metadata.titleKey,
          bodyKey: metadata.bodyKey, defaultTitle: row.title, defaultBody: row.body } });
    },
  );

  it.each(operations)('%s uses callback RepeatableRead and the same complete parameterized visibility scope', async (operation) => {
    const f = fixture();
    await run(f, operation);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function),
      expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
    const sqlCalls = [...f.queries, ...f.writes];
    expect(sqlCalls.length).toBeGreaterThan(0);
    for (const query of sqlCalls) expectVisibleScope(query);
    expectNoFallback(f);
    expectNoUnrelatedWrites(f);
  });

  it('shares the identical recipient/post/block/hidden scope across list, count, cursor and both writes', async () => {
    const f = fixture();
    await f.service.list(USER, { cursor: FIRST });
    await f.service.unreadCount(USER);
    await f.service.markRead(USER, FIRST);
    await f.service.markAllRead(USER);
    const all = [...f.queries, ...f.writes];
    expect(all).toHaveLength(7);
    for (const query of all) expectVisibleScope(query);
    expect(new Set(all.map(visibilityCore)).size).toBe(1);
  });

  it('binds an adversarial type value as data and never interpolates identifiers or filter text', async () => {
    const type = "feed.reply' OR TRUE; DROP TABLE user_notifications; --";
    const f = fixture();
    f.state.ids = [];
    await f.service.list(USER, { type, take: '2' });
    const page = f.queries.find((query) => /order by/i.test(query.sql))!;
    expect(page).toBeDefined();
    expect(page.values).toContain(type);
    expect(page.values).toContain(3);
    expect(page.sql).not.toContain(type);
    expect(normalized(page)).toMatch(/\.type\s*=\s*\?/);
    expectNoFallback(f);
  });

  it('returns only the SQL-visible slice, including public actor/artist data, and never hydrates lookahead or excluded rows', async () => {
    const f = fixture([
      notification({ id: THIRD }), notification({ id: SECOND }),
      notification({ id: FIRST, artistId: POST, artist: { id: POST, slug: 'stage', displayName: 'Stage' } }),
      notification({ id: OTHER, userId: OTHER }),
    ]);
    f.state.ids = [{ id: FIRST }, { id: SECOND }, { id: THIRD }];
    f.state.count = 2;
    const result = await f.service.list(USER, { take: '2' });
    expect(result.notifications.map((row) => row.id)).toEqual([FIRST, SECOND]);
    expect(result.notifications[0].artist).toEqual({ id: POST, slug: 'stage', displayName: 'Stage' });
    expect(result).toMatchObject({ unreadCount: 2, nextCursor: SECOND });
    expect(f.tx.userNotification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: USER, id: { in: [FIRST, SECOND] } },
      include: expect.objectContaining({ actorUser: expect.any(Object), artist: expect.any(Object) }),
    }));
    const include = (f.tx.userNotification.findMany.mock.calls[0][0] as unknown as { include: {
      actorUser: { select: Record<string, unknown> };
    } }).include;
    expect(include.actorUser.select).not.toHaveProperty('email');
    expectNoFallback(f);
  });

  it('keeps list and count read-only and leaves stored notification data untouched', async () => {
    const f = fixture();
    const before = JSON.stringify(f.rows);
    await f.service.list(USER, {});
    await f.service.unreadCount(USER);
    expect(f.writes).toHaveLength(0);
    expect(f.queries.every((query) => !/\b(update|insert|delete)\b/i.test(query.sql))).toBe(true);
    expect(JSON.stringify(f.rows)).toBe(before);
    for (const db of [f.tx, f.prisma]) expect(db.$executeRaw).not.toHaveBeenCalled();
    expectNoFallback(f);
    expectNoUnrelatedWrites(f);
  });

  it('returns empty pages and the visible global unread count without hydration', async () => {
    const f = fixture();
    f.state.ids = [];
    f.state.count = 7;
    await expect(f.service.list(USER, { type: 'feed.reply', status: 'read' })).resolves.toEqual({
      notifications: [], unreadCount: 7, nextCursor: null,
    });
    expect(f.tx.userNotification.findMany).not.toHaveBeenCalled();
    const count = f.queries.find((query) => /count\s*\(/i.test(query.sql))!;
    expect(count.values).not.toContain('feed.reply');
    expect(normalized(count)).toMatch(/\.read_at is null/);
  });

  it('returns a terminal page without a next cursor when there is no lookahead', async () => {
    const f = fixture();
    await expect(f.service.list(USER, { take: '1' })).resolves.toMatchObject({
      notifications: [{ id: FIRST }], nextCursor: null,
    });
    await expect(f.service.unreadCount(USER)).resolves.toEqual({ unreadCount: 1 });
  });

  it.each([{ take: undefined, limit: 21 }, { take: '1', limit: 2 }, { take: '100', limit: 101 }])(
    'binds default and boundary page sizes with exactly one SQL lookahead row: %p', async ({ take, limit }) => {
      const f = fixture([]);
      await f.service.list(USER, { take });
      const page = f.queries.find((query) => /order by/i.test(query.sql))!;
      expect(page.values).toContain(limit);
      expect(normalized(page)).toMatch(/\blimit\s*\?/);
    },
  );

  it.each([
    ['unread', /\.read_at is null/], ['read', /\.read_at is not null/],
  ] as const)('binds type and applies %s only to the page, not the global unread total', async (status, predicate) => {
    const f = fixture();
    f.state.ids = [];
    await f.service.list(USER, { type: ' fan_letter.reply ', status: ` ${status} ` });
    const page = f.queries.find((query) => /order by/i.test(query.sql))!;
    const count = f.queries.find((query) => /count\s*\(/i.test(query.sql))!;
    expect(page.values).toContain('fan_letter.reply');
    expect(normalized(page)).toMatch(predicate);
    expect(count.values).not.toContain('fan_letter.reply');
    expect(normalized(count)).toMatch(/\.read_at is null/);
  });

  it('uses a visible owned SQL cursor anchor and stable timestamp/id keyset ordering for ties', async () => {
    const f = fixture([notification({ id: SECOND }), notification({ id: THIRD })]);
    f.state.ids = [{ id: SECOND }, { id: THIRD }];
    const result = await f.service.list(USER, { cursor: FIRST, take: '1' });
    expect(result.notifications.map((row) => row.id)).toEqual([SECOND]);
    expect(result.nextCursor).toBe(SECOND);
    const anchor = f.queries[0];
    const page = f.queries.find((query) => /order by/i.test(query.sql))!;
    expectVisibleScope(anchor);
    expect(anchor.values).toContain(FIRST);
    expect(normalized(anchor)).toMatch(/^select \w+\.id from user_notifications/);
    expect(normalized(anchor)).not.toContain('created_at');
    expect(anchor.values.some((value) => value instanceof Date)).toBe(false);
    expectSqlNativeCursor(page, FIRST);
    expect(normalized(page)).toMatch(/order by \w+\.created_at desc,\s*\w+\.id desc/);
    expect(normalized(page)).not.toMatch(/\boffset\b/);
  });

  it('keeps microsecond cursor bounds SQL-native across four supplied pages, including exact timestamp ties', async () => {
    const fourth = '00000000-0000-4000-8000-000000000010';
    const preciseRows = [
      { id: FIRST, timestamp: '2026-10-03T01:00:00.123900Z' },
      { id: THIRD, timestamp: '2026-10-03T01:00:00.123800Z' },
      { id: SECOND, timestamp: '2026-10-03T01:00:00.123900Z' },
      { id: fourth, timestamp: '2026-10-03T01:00:00.123100Z' },
    ];
    const rows = preciseRows.map(({ id, timestamp }) => notification({ id, createdAt: new Date(timestamp) }));
    // JS collapses these timestamps; supplied SQL result order is not a PostgreSQL emulation.
    expect(new Set(rows.map((row) => row.createdAt.getTime())).size).toBe(1);
    const f = fixture(rows);
    const nativeOrder = [FIRST, SECOND, THIRD, fourth];
    const returned: string[] = [];

    for (let index = 0; index < nativeOrder.length; index++) {
      const cursor = index ? nativeOrder[index - 1] : undefined;
      f.state.ids = nativeOrder.slice(index, index + 2).map((id) => ({ id }));
      f.state.anchors = cursor ? [{ id: cursor }] : [];
      const queryStart = f.queries.length;
      const result = await f.service.list(USER, { take: '1', cursor });
      expect(result.notifications.map((row) => row.id)).toEqual([nativeOrder[index]]);
      expect(result.nextCursor).toBe(index + 1 < nativeOrder.length ? nativeOrder[index] : null);
      returned.push(result.notifications[0].id);
      const calls = f.queries.slice(queryStart);
      expect(calls.every((query) => query.values.every((value) => !(value instanceof Date)))).toBe(true);
      const page = calls.find((query) => /order by/i.test(query.sql))!;
      expect(normalized(page)).toMatch(/order by \w+\.created_at desc,\s*\w+\.id desc/);
      if (cursor) {
        expect(normalized(calls[0])).toMatch(/^select \w+\.id from user_notifications/);
        expect(normalized(calls[0])).not.toContain('created_at');
        expectVisibleScope(calls[0]);
        expectSqlNativeCursor(page, cursor);
        expect(page.values.slice(-4)).toEqual([USER, cursor, cursor, 2]);
      } else {
        expect(normalized(page)).not.toContain('select anchor.created_at');
      }
    }

    expect(returned).toEqual(nativeOrder);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(4);
    expect(f.writes).toHaveLength(0);
    expectNoFallback(f);
  });

  it.each(['unowned', 'hidden', 'private', 'deleted', 'missing', 'blocked actor', 'blocked author'])(
    'rejects an unavailable %s cursor instead of treating it as an empty or first page', async () => {
      const f = fixture();
      f.state.anchors = [];
      await expect(f.service.list(USER, { cursor: FIRST })).rejects.toBeInstanceOf(BadRequestException);
      expect(f.tx.userNotification.findMany).not.toHaveBeenCalled();
      expect(f.queries).toHaveLength(1);
      expectVisibleScope(f.queries[0]);
      expectNoFallback(f);
    },
  );

  it.each(['hidden post', 'private post', 'deleted post', 'missing post', 'unpublished post',
    'blocked actor', 'blocked author', 'feed with null target', 'feed with non-post target'])(
    'honors empty SQL visibility results for %s without falling back to stored rows/count', async () => {
      const f = fixture();
      f.state.ids = [];
      f.state.count = 0;
      await expect(f.service.list(USER, {})).resolves.toEqual({ notifications: [], unreadCount: 0, nextCursor: null });
      await expect(f.service.unreadCount(USER)).resolves.toEqual({ unreadCount: 0 });
      expect(f.tx.userNotification.findMany).not.toHaveBeenCalled();
      expectNoFallback(f);
    },
  );

  it.each(['NaN', '1.5', '0', '-1', '101', 'Infinity', '', "1; SELECT 'injection'"])(
    'rejects invalid take %p before opening a transaction', async (take) => {
      const f = fixture();
      await expect(f.service.list(USER, { take })).rejects.toBeInstanceOf(BadRequestException);
      expect(f.prisma.$transaction).not.toHaveBeenCalled();
      expectNoFallback(f);
    },
  );

  it.each([{ status: 'not-a-status' }, { cursor: 'bad' }, { cursor: "' OR TRUE --" }])(
    'rejects invalid list input %p before any database access', async (query) => {
      const f = fixture();
      await expect(f.service.list(USER, query)).rejects.toBeInstanceOf(BadRequestException);
      expect(f.prisma.$transaction).not.toHaveBeenCalled();
      expect(f.queries).toHaveLength(0);
      expectNoFallback(f);
    },
  );

  it('rejects a malformed notification ID before any transaction or write', async () => {
    const f = fixture();
    await expect(f.service.markRead(USER, "bad' OR TRUE --")).rejects.toBeInstanceOf(BadRequestException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.queries).toHaveLength(0);
    expect(f.writes).toHaveLength(0);
    expectNoFallback(f);
  });

  it.each(['take', 'cursor', 'status', 'type'] as const)(
    'rejects array, object, number and boolean %s input with 400 before database access', async (key) => {
      for (const value of [['1'], ['1', '2'], { value: '1' }, 1, true]) {
        const f = fixture();
        const query = { [key]: value } as unknown as Record<string, string | undefined>;
        const error = await f.service.list(USER, query).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getStatus()).toBe(400);
        expect(f.prisma.$transaction).not.toHaveBeenCalled();
        expect(f.queries).toHaveLength(0);
        expectNoFallback(f);
      }
    },
  );

  it('rejects non-string notification IDs including single-element UUID arrays before database access', async () => {
    for (const value of [[FIRST], { toString: () => FIRST }, 1, true, null, undefined]) {
      const f = fixture();
      const error = await f.service.markRead(USER, value as unknown as string).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect(f.prisma.$transaction).not.toHaveBeenCalled();
      expectNoFallback(f);
    }
  });

  it('marks an already-read visible notification idempotently and sanitizes the returned projection', async () => {
    const f = fixture([notification({ readAt: READ })]);
    const result = await f.service.markRead(USER, FIRST);
    expect(result.notification).toMatchObject({ id: FIRST, readAt: READ,
      title: 'New reply on your feed post', body: 'Someone replied to your feed post.' });
    expect(JSON.stringify(result)).not.toContain(RAW_METADATA);
    const lookup = f.queries[0];
    expect(normalized(lookup)).toMatch(/^select \w+\.id,\s*\w+\.read_at as readat/);
    expectVisibleScope(lookup);
    expect(lookup.values).toContain(FIRST);
    expect(lookup.sql).not.toContain(FIRST);
    expect(f.tx.$executeRaw).not.toHaveBeenCalled();
    expect(f.writes).toHaveLength(0);
    expect(f.tx.userNotification.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: FIRST }, include: expect.any(Object),
    }));
    expectNoFallback(f);
  });

  it('writes the first read once, using the same scoped recipient/id guard and read_at IS NULL', async () => {
    const f = fixture();
    const result = await f.service.markRead(USER, FIRST);
    expect(result.notification.readAt).toEqual(READ);
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
    const lookup = f.queries[0];
    const update = f.writes[0];
    expect(normalized(lookup)).toMatch(/^select \w+\.id,\s*\w+\.read_at as readat/);
    expect(normalized(update)).toMatch(/^update user_notifications/);
    expect(normalized(update)).toMatch(/set read_at\s*=\s*current_timestamp/);
    expect(normalized(update)).toMatch(/\.read_at is null/);
    expect(normalized(update)).not.toContain('coalesce');
    expectVisibleScope(lookup);
    expectVisibleScope(update);
    expect(visibilityCore(update)).toBe(visibilityCore(lookup));
    for (const query of [lookup, update]) {
      expect(query.values).toContain(FIRST);
      expect(query.sql).not.toContain(FIRST);
    }
    expect(f.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(f.tx.$executeRaw.mock.invocationCallOrder[0]);
    expect(f.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(f.tx.userNotification.findUnique.mock.invocationCallOrder[0]);
    expectNoFallback(f);
    expectNoUnrelatedWrites(f);
  });

  it('keeps the first read timestamp and avoids all duplicate writes for ten repeated markRead requests', async () => {
    const f = fixture();
    const first = await f.service.markRead(USER, FIRST);
    for (let duplicate = 0; duplicate < 10; duplicate++) {
      const result = await f.service.markRead(USER, FIRST);
      expect(result.notification.readAt).toEqual(first.notification.readAt);
    }
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(11);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(11);
    expectNoFallback(f);
  });

  it.each(['unowned', 'hidden', 'private', 'deleted', 'missing', 'blocked', 'malformed feed target'])(
    'returns the same 404 for %s markRead results without hydrating or falling back', async () => {
      const f = fixture();
      f.state.readRows = [];
      const error = await f.service.markRead(USER, FIRST).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
      expect(f.tx.userNotification.findUnique).not.toHaveBeenCalled();
      expect(f.tx.$executeRaw).not.toHaveBeenCalled();
      expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
      expectNoFallback(f);
    },
  );

  it('fails closed if markRead hydration cannot find the SQL-returned ID', async () => {
    const f = fixture([]);
    await expect(f.service.markRead(USER, FIRST)).rejects.toBeInstanceOf(NotFoundException);
    expectNoFallback(f);
  });

  it('does not hydrate or return success after a first-read update fails', async () => {
    const f = fixture();
    const failure = new Error('Scoped read update failed');
    f.tx.$executeRaw.mockRejectedValue(failure);
    await expect(f.service.markRead(USER, FIRST)).rejects.toBe(failure);
    expect(f.tx.userNotification.findUnique).not.toHaveBeenCalled();
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    expectNoFallback(f);
  });

  it('fails closed if an ID selected by SQL is absent during page hydration', async () => {
    const f = fixture([]);
    f.state.ids = [{ id: FIRST }];
    await expect(f.service.list(USER, {})).rejects.toBeInstanceOf(NotFoundException);
    expectNoFallback(f);
  });

  it.each([0, 3])('marks only visible unread rows in one parameterized update and returns affected count %i', async (updatedCount) => {
    const f = fixture();
    f.state.updatedCount = updatedCount;
    await expect(f.service.markAllRead(USER)).resolves.toEqual({ ok: true, updatedCount });
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
    expect(normalized(f.writes[0])).toMatch(/^update user_notifications/);
    expect(normalized(f.writes[0])).toMatch(/set read_at\s*=\s*current_timestamp/);
    expect(normalized(f.writes[0])).toMatch(/\.read_at is null/);
    expectVisibleScope(f.writes[0]);
    expectNoFallback(f);
    expectNoUnrelatedWrites(f);
  });

  it('performs avatar enrichment inside the same snapshot, including nullable actor/profile fallbacks', async () => {
    const withAvatar = notification();
    withAvatar.actorUser!.profile!.avatarAssetId = AVATAR;
    const f = fixture([withAvatar, notification({ id: SECOND, actorUser: null, actorUserId: null }),
      notification({ id: THIRD, actorUser: { id: ACTOR, email: 'private-actor-email@example.test', profile: null } })]);
    const result = await f.service.list(USER, {});
    expect(f.tx.asset.findUnique).toHaveBeenCalledWith({ where: { id: AVATAR }, select: { storageKey: true } });
    expect(result.notifications[0].actor?.avatarUrl).toBeNull();
    expect(result.notifications[1].actor).toBeNull();
    expect(result.notifications[2].actor?.displayName).toBe('Lumina User');
    expectNoFallback(f);
  });

  it.each(operations)('%s retries P2034 twice and succeeds on the third callback transaction', async (operation) => {
    const f = fixture();
    f.prisma.$transaction.mockRejectedValueOnce(knownError('P2034')).mockRejectedValueOnce(knownError('P2034'));
    await run(f, operation);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(3);
    for (const [callback, options] of f.prisma.$transaction.mock.calls as unknown as [unknown, unknown][]) {
      expect(callback).toEqual(expect.any(Function));
      expect(options).toEqual(expect.objectContaining({ isolationLevel: 'RepeatableRead' }));
    }
    expectNoFallback(f);
    expectNoUnrelatedWrites(f);
  });

  it.each(operations)('%s stops after three failed P2034 transaction attempts and returns the failure', async (operation) => {
    const f = fixture();
    const failure = knownError('P2034');
    f.prisma.$transaction.mockRejectedValue(failure);
    await expect(run(f, operation)).rejects.toBe(failure);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(3);
    expectNoFallback(f);
  });

  it.each(rawConflictCases)(
    '$operation retries raw P2010/$sqlState twice by restarting the whole callback transaction', async ({ operation, sqlState }) => {
      const f = fixture();
      const raw = operation === 'markAllRead' ? f.tx.$executeRaw : f.tx.$queryRaw;
      raw.mockRejectedValueOnce(knownError('P2010', { code: sqlState }))
        .mockRejectedValueOnce(knownError('P2010', { code: sqlState }));
      await run(f, operation);
      expect(f.prisma.$transaction).toHaveBeenCalledTimes(3);
      for (const [callback, options] of f.prisma.$transaction.mock.calls as unknown as [unknown, unknown][]) {
        expect(callback).toEqual(expect.any(Function));
        expect(options).toEqual(expect.objectContaining({ isolationLevel: 'RepeatableRead' }));
      }
      if (operation === 'list') expect(f.tx.userNotification.findMany).toHaveBeenCalledTimes(1);
      if (operation === 'markRead') {
        expect(f.tx.$queryRaw).toHaveBeenCalledTimes(3);
        expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
        expect(f.tx.userNotification.findUnique).toHaveBeenCalledTimes(1);
      }
      if (operation === 'markAllRead') expect(f.tx.$executeRaw).toHaveBeenCalledTimes(3);
      expectNoFallback(f);
      expectNoUnrelatedWrites(f);
    },
  );

  it.each(rawConflictCases)(
    '$operation stops after three raw P2010/$sqlState conflicts and propagates the final failure', async ({ operation, sqlState }) => {
      const f = fixture();
      const failure = knownError('P2010', { code: sqlState });
      const raw = operation === 'markAllRead' ? f.tx.$executeRaw : f.tx.$queryRaw;
      raw.mockRejectedValue(failure);
      await expect(run(f, operation)).rejects.toBe(failure);
      expect(f.prisma.$transaction).toHaveBeenCalledTimes(3);
      expect(raw).toHaveBeenCalledTimes(3);
      expect(f.tx.userNotification.findMany).not.toHaveBeenCalled();
      expect(f.tx.userNotification.findUnique).not.toHaveBeenCalled();
      expectNoFallback(f);
      expectNoUnrelatedWrites(f);
    },
  );

  it.each(['40001', '40P01'])(
    'markRead restarts the scoped lookup after raw P2010/%s update conflicts and hydrates only once', async (sqlState) => {
      const f = fixture();
      f.tx.$executeRaw.mockRejectedValueOnce(knownError('P2010', { code: sqlState }))
        .mockRejectedValueOnce(knownError('P2010', { code: sqlState }));
      const result = await f.service.markRead(USER, FIRST);
      expect(result.notification.readAt).toEqual(READ);
      expect(f.prisma.$transaction).toHaveBeenCalledTimes(3);
      expect(f.tx.$queryRaw).toHaveBeenCalledTimes(3);
      expect(f.tx.$executeRaw).toHaveBeenCalledTimes(3);
      expect(f.tx.userNotification.findUnique).toHaveBeenCalledTimes(1);
      expect(f.writes).toHaveLength(1);
      expectNoFallback(f);
      expectNoUnrelatedWrites(f);
    },
  );

  it.each(['40001', '40P01'])(
    'markRead stops after three raw P2010/%s update conflicts without hydration', async (sqlState) => {
      const f = fixture();
      const failure = knownError('P2010', { code: sqlState });
      f.tx.$executeRaw.mockRejectedValue(failure);
      await expect(f.service.markRead(USER, FIRST)).rejects.toBe(failure);
      expect(f.prisma.$transaction).toHaveBeenCalledTimes(3);
      expect(f.tx.$queryRaw).toHaveBeenCalledTimes(3);
      expect(f.tx.$executeRaw).toHaveBeenCalledTimes(3);
      expect(f.tx.userNotification.findUnique).not.toHaveBeenCalled();
      expectNoFallback(f);
    },
  );

  it.each(operations)('%s does not retry raw SQL syntax, permission or network failures', async (operation) => {
    const failures = [
      knownError('P2010', { code: '42601' }),
      knownError('P2010', { code: '42501' }),
      knownError('P2010', { code: '08006' }),
      knownError('P1001'),
      Object.assign(new Error('Network reset'), { code: 'ECONNRESET' }),
      Object.assign(new Error('Network timeout'), { code: 'ETIMEDOUT' }),
    ];
    for (const failure of failures) {
      const f = fixture();
      const raw = operation === 'markAllRead' ? f.tx.$executeRaw : f.tx.$queryRaw;
      raw.mockRejectedValue(failure);
      await expect(run(f, operation)).rejects.toBe(failure);
      expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(raw).toHaveBeenCalledTimes(1);
      expectNoFallback(f);
      expectNoUnrelatedWrites(f);
    }
  });

  it.each(operations)('%s does not infer a raw conflict from absent, null, wrong-type or inexact metadata', async (operation) => {
    const failures = [
      knownError('P2010'),
      ...[undefined, null, {}, '40001', 40001, true, ['40001'],
        { code: null }, { code: 40001 }, { code: true }, { code: ['40001'] },
        { sqlState: '40001' }, { code: ' 40001 ' }, { code: '40p01' }]
        .map((meta) => Object.assign(knownError('P2010'), { meta })),
      Object.assign(knownError('P2024'), { meta: { code: '40001' } }),
      new Error('P2010 serialization SQLSTATE 40001 deadlock 40P01'),
    ];
    for (const failure of failures) {
      const f = fixture();
      const raw = operation === 'markAllRead' ? f.tx.$executeRaw : f.tx.$queryRaw;
      raw.mockRejectedValue(failure);
      await expect(run(f, operation)).rejects.toBe(failure);
      expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(raw).toHaveBeenCalledTimes(1);
      expectNoFallback(f);
      expectNoUnrelatedWrites(f);
    }
  });

  it.each(operations)('%s does not retry other Prisma failures or ordinary errors', async (operation) => {
    for (const failure of [knownError('P2024'), knownError('P2025'), new Error('SQL unavailable'), null]) {
      const f = fixture();
      f.prisma.$transaction.mockRejectedValue(failure);
      await expect(run(f, operation)).rejects.toBe(failure);
      expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
      expectNoFallback(f);
    }
  });

  it.each(operations)('%s propagates SQL failures without an unrestricted fallback', async (operation) => {
    const f = fixture();
    const failure = new Error('Visibility query failed');
    if (operation === 'markAllRead') f.tx.$executeRaw.mockRejectedValue(failure);
    else f.tx.$queryRaw.mockRejectedValue(failure);
    await expect(run(f, operation)).rejects.toBe(failure);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    expectNoFallback(f);
  });

  it('does not turn an absent SQL count result into a success or an unrestricted legacy count', async () => {
    const f = fixture();
    f.tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(f.service.unreadCount(USER)).rejects.toBeDefined();
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    expectNoFallback(f);
  });

  it('reruns the whole list snapshot after a P2034 raised inside the callback', async () => {
    const f = fixture();
    f.tx.$queryRaw.mockRejectedValueOnce(knownError('P2034'));
    const result = await f.service.list(USER, {});
    expect(result.notifications.map((row) => row.id)).toEqual([FIRST]);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(f.tx.userNotification.findMany).toHaveBeenCalledTimes(1);
    expectNoFallback(f);
  });

  it('reruns the markRead snapshot when the first-read update conflicts before hydration', async () => {
    const f = fixture();
    f.tx.$executeRaw.mockRejectedValueOnce(knownError('P2034'));
    const result = await f.service.markRead(USER, FIRST);
    expect(result.notification.readAt).toEqual(READ);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(f.tx.userNotification.findUnique).toHaveBeenCalledTimes(1);
    expectNoFallback(f);
  });
});

describe('NotificationsController visibility API forwarding', () => {
  it('uses the authenticated recipient for all four methods and preserves service response shapes', async () => {
    const f = fixture();
    const user = { id: USER, email: 'recipient@example.test' };
    const list = jest.spyOn(f.service, 'list');
    const unreadCount = jest.spyOn(f.service, 'unreadCount');
    const markRead = jest.spyOn(f.service, 'markRead');
    const markAllRead = jest.spyOn(f.service, 'markAllRead');
    await expect(f.controller.list(user, { take: '1', userId: OTHER })).resolves.toMatchObject({
      notifications: [{ id: FIRST }], unreadCount: 1, nextCursor: null,
    });
    await expect(f.controller.unreadCount(user)).resolves.toEqual({ unreadCount: 1 });
    await expect(f.controller.markRead(user, FIRST)).resolves.toMatchObject({ notification: { id: FIRST } });
    await expect(f.controller.markAllRead(user)).resolves.toEqual({ ok: true, updatedCount: 1 });
    expect(list).toHaveBeenCalledWith(USER, { take: '1', userId: OTHER });
    expect(unreadCount).toHaveBeenCalledWith(USER);
    expect(markRead).toHaveBeenCalledWith(USER, FIRST);
    expect(markAllRead).toHaveBeenCalledWith(USER);
    for (const query of [...f.queries, ...f.writes]) {
      expect(query.values).toContain(USER);
      expect(query.values).not.toContain(OTHER);
    }
  });

  it('does not mask service validation, invisible-target 404s, or database failures', async () => {
    const f = fixture();
    await expect(f.controller.list({ id: USER }, { take: '0' })).rejects.toBeInstanceOf(BadRequestException);
    f.state.readRows = [];
    await expect(f.controller.markRead({ id: USER }, FIRST)).rejects.toBeInstanceOf(NotFoundException);
    const failure = new Error('Visibility database unavailable');
    f.prisma.$transaction.mockRejectedValue(failure);
    await expect(f.controller.unreadCount({ id: USER })).rejects.toBe(failure);
    await expect(f.controller.markAllRead({ id: USER })).rejects.toBe(failure);
  });
});
