import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CommunityService } from './community.service';

type Row = Record<string, unknown>;
type ReadArgs = { where: Row; take: number; cursor?: { id: string }; skip?: number; include: Row; orderBy: Row };
type Context = { userId?: string; visitorHash?: string };
const A = '00000000-0000-4000-8000-000000000101';
const B = '00000000-0000-4000-8000-000000000102';
const WRITER = '00000000-0000-4000-8000-000000000201';
const H = '00000000-0000-4000-8000-000000000301';
const V = '00000000-0000-4000-8000-000000000302';
const HIDE_SENTINEL = 'synthetic-hide-relation-not-public';
const AUTHOR_SENTINEL = 'synthetic-private-author-not-public';
const object = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [value];

// Deliberately generic query evaluation: a missing relation predicate does not filter anything.
// This is a bounded Prisma double, not SQL, the production search algorithm, or a hide-policy substitute.
function matches(value: unknown, filter: unknown): boolean {
  if (filter === undefined) return true;
  if (!object(filter)) return Object.is(value, filter);
  return Object.entries(filter).every(([key, condition]) => {
    if (key === 'mode') return true;
    if (key === 'AND') return list(condition).every(part => matches(value, part));
    if (key === 'OR') return list(condition).some(part => matches(value, part));
    if (key === 'NOT') return list(condition).every(part => !matches(value, part));
    if (key === 'equals') return filter.mode === 'insensitive' && typeof value === 'string' && typeof condition === 'string'
      ? value.toLowerCase() === condition.toLowerCase() : Object.is(value, condition);
    if (key === 'contains') {
      if (typeof value !== 'string' || typeof condition !== 'string') return false;
      return filter.mode === 'insensitive' ? value.toLowerCase().includes(condition.toLowerCase()) : value.includes(condition);
    }
    if (key === 'in' || key === 'notIn') {
      if (!Array.isArray(condition)) throw new Error('UNSUPPORTED_FIXTURE_SET');
      const found = condition.some(item => Object.is(value, item));
      return key === 'in' ? found : !found;
    }
    if (key === 'not') return !matches(value, condition);
    if (key === 'is') return matches(value, condition);
    if (key === 'none' || key === 'some') {
      if (!Array.isArray(value)) throw new Error('UNSUPPORTED_FIXTURE_RELATION');
      const found = value.some(item => matches(item, condition));
      return key === 'none' ? !found : found;
    }
    return object(value) && matches(value[key], condition);
  });
}

function selected(value: unknown, specification: unknown): unknown {
  if (value === null || specification === true) return value;
  if (Array.isArray(value)) return value.map(item => selected(item, specification));
  if (!object(value) || !object(specification) || !object(specification.select)) throw new Error('UNSUPPORTED_FIXTURE_PROJECTION');
  return Object.fromEntries(Object.entries(specification.select)
    .filter(([, spec]) => Boolean(spec)).map(([key, spec]) => [key, spec === true ? value[key] : selected(value[key], spec)]));
}

function post(id: string, minute: number, overrides: Row = {}): Row {
  const time = new Date(Date.UTC(2031, 0, 2, 12, minute));
  return {
    id, authorUserId: WRITER, artistId: null, postType: 'user_post',
    body: '#StageProof synthetic public root', status: 'published', visibility: 'public',
    deletedAt: null, publishedAt: time, createdAt: time, updatedAt: time, metadata: {},
    author: { id: WRITER, email: AUTHOR_SENTINEL, profile: {
      displayName: 'StageProof synthetic writer', publicHandle: 'synthetic-writer',
      avatarAssetId: null, coverAssetId: null, privateMemo: AUTHOR_SENTINEL,
    } },
    artist: null, assets: [], ...overrides,
  };
}

function hide(userId: string, postId: string, status = 'active', deletedAt: Date | null = null): Row {
  return { userId, postId, status, deletedAt, privateHideMarker: HIDE_SENTINEL };
}

function fixture(posts: Row[], hides: Row[] = [], blocks: Row[] = []) {
  const unexpected: string[] = [];
  const protect = <T extends object>(name: string, value: T): T => new Proxy(value, {
    get(target, key, receiver) {
      if (typeof key === 'string' && !(key in target)) {
        unexpected.push(name);
        throw new Error('UNEXPECTED_FIXTURE_OPERATION');
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const communityPost = protect('communityPost', {
    findMany: jest.fn(async (args: ReadArgs) => {
      expect(args.orderBy).toEqual({ publishedAt: 'desc' });
      const rows: Row[] = posts.map<Row>(row => ({ ...row, hiddenByUsers: hides.filter(item => item.postId === row.id) }))
        .filter(row => matches(row, args.where))
        .sort((left, right) => (right.publishedAt as Date).getTime() - (left.publishedAt as Date).getTime());
      const start = args.cursor ? rows.findIndex(row => row.id === args.cursor?.id) : 0;
      if (start < 0) throw new Error('FIXTURE_CURSOR_MUST_BE_ELIGIBLE');
      return rows.slice(start + (args.skip ?? 0), start + (args.skip ?? 0) + args.take).map(row => {
        const { author, artist, assets, hiddenByUsers, ...scalars } = row;
        const relations: Row = { author, artist, assets, hiddenByUsers };
        return { ...scalars, ...Object.fromEntries(Object.entries(args.include)
          .filter(([, spec]) => Boolean(spec)).map(([key, spec]) => [key, selected(relations[key], spec)])) };
      });
    }),
  });
  const userBlock = protect('userBlock', {
    findMany: jest.fn(async (args: { where: Row }) => blocks.filter(row => matches(row, args.where))
      .map(row => ({ blockerUserId: row.blockerUserId, blockedUserId: row.blockedUserId }))),
  });
  const tx = protect('transaction', {
    $queryRaw: jest.fn(async (..._args: unknown[]) => []),
    feedSearchEvent: protect('feedSearchEvent', {
      findFirst: jest.fn(async (_args: unknown): Promise<Row | null> => null),
      create: jest.fn(async (args: { data: Row }) => ({ id: 'synthetic-event', ...args.data })),
    }),
  });
  const prisma = protect('prisma', {
    communityPost, userBlock,
    user: protect('user', { findFirst: jest.fn(async (args: { where: { id: string } }) =>
      [A, B].includes(args.where.id) ? { id: args.where.id, status: 'active', deletedAt: null } : null) }),
    communityReaction: protect('communityReaction', { findUnique: jest.fn(async () => null) }),
    userFollow: protect('userFollow', { findUnique: jest.fn(async () => null) }),
    artistFollow: protect('artistFollow', { findUnique: jest.fn(async () => null) }),
    $transaction: jest.fn(async (callback: (value: typeof tx) => Promise<unknown>, _options?: unknown) => callback(tx)),
  });
  const config = protect('config', {});
  const notifications = protect('notifications', {});
  const service = new CommunityService(prisma as never, config as never, notifications as never);
  return { service, prisma, tx, unexpected };
}

type Fixture = ReturnType<typeof fixture>;
type Result = Awaited<ReturnType<CommunityService['searchFeed']>>;
const ids = (rows: Array<{ id: string }>) => rows.map(row => row.id);

function assertPrivateHideNotProjected(result: Result, f: Fixture) {
  const serialized = JSON.stringify(result);
  for (const forbidden of ['hiddenByUsers', 'hiddenPost', 'privateHideMarker', HIDE_SENTINEL, AUTHOR_SENTINEL]) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(f.unexpected).toEqual([]);
}

function assertExistingEvent(f: Fixture, result: Result, context: Context, keyword: string, type = 'text') {
  expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
  expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  });
  expect(f.tx.$queryRaw).toHaveBeenCalledTimes(Number(Boolean(context.userId)) + Number(Boolean(context.visitorHash)));
  for (const [sql] of f.tx.$queryRaw.mock.calls) {
    expect((sql as TemplateStringsArray).join('?')).toBe('SELECT pg_advisory_xact_lock(?::bigint)::text');
  }
  expect(f.tx.feedSearchEvent.findFirst).toHaveBeenCalledTimes(context.userId || context.visitorHash ? 1 : 0);
  expect(f.tx.feedSearchEvent.create).toHaveBeenCalledTimes(1);
  const event = f.tx.feedSearchEvent.create.mock.calls[0][0].data;
  expect(event).toMatchObject({ userId: context.userId ?? null, keyword, normalizedKeyword: 'stageproof',
    searchType: type, language: 'en', resultCount: result.count });
  expect(Object.keys(event).sort()).toEqual([
    'keyword', 'language', 'metadata', 'normalizedKeyword', 'resultCount', 'searchType', 'userId', 'visitorHash',
  ]);
  expect(event.metadata).toEqual({ source: 'lumina_feed_search', q: keyword, requestedLanguage: 'en', detectedLanguage: 'en' });
  expect(f.prisma.userBlock.findMany).toHaveBeenCalledTimes(context.userId ? 1 : 0);
  expect(f.unexpected).toEqual([]);
}

describe('feed search hidden current viewer', () => {
  test('01 excludes the current viewers active hidden post', async () => {
    const f = fixture([post(H, 20), post(V, 19)], [hide(A, H)]);
    const normal = await f.service.getPersonalizedFeed(A, { mode: 'all', take: '30' });
    expect(ids(normal)).toEqual([V]);
    const result = await f.service.searchFeed({ q: 'StageProof', type: 'text', language: 'en', take: '30' }, { userId: A });
    // Baseline must reach this response oracle and expose H; missing helper/admission errors are not RED.
    expect({ gate: 'hidden-post-resurfaced', ids: ids(result.items) })
      .toEqual({ gate: 'hidden-post-resurfaced', ids: [V] });
    expect(result.count).toBe(1);
    expect(result.posts).toBe(result.items);
    expect(f.prisma.communityPost.findMany).toHaveBeenCalledTimes(2);
    expect(f.prisma.userBlock.findMany).toHaveBeenCalledTimes(2);
    assertPrivateHideNotProjected(result, f);
    // The normal feed does not record a search event; only the actual search does.
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(f.tx.feedSearchEvent.create).toHaveBeenCalledTimes(1);
    expect(f.tx.feedSearchEvent.create.mock.calls[0][0].data).toMatchObject({ resultCount: 1, userId: A });
  });

  test('02 keeps other viewers anonymous and inactive hide controls scoped in text and hashtag search', async () => {
    const inactive = '00000000-0000-4000-8000-000000000303';
    const deleted = '00000000-0000-4000-8000-000000000304';
    const otherOwner = '00000000-0000-4000-8000-000000000305';
    const rows = [post(H, 24), post(inactive, 23), post(deleted, 22), post(otherOwner, 21)];
    const hides = [hide(A, H), hide(A, inactive, 'deleted'), hide(A, deleted, 'active', new Date('2031-01-01T00:00:00Z')), hide(B, otherOwner)];
    const controls: Array<{ context: Context; expected: string[] }> = [
      { context: { userId: A }, expected: [inactive, deleted, otherOwner] },
      { context: { userId: B }, expected: [H, inactive, deleted] },
      { context: { visitorHash: 'synthetic-anonymous-visitor' }, expected: [H, inactive, deleted, otherOwner] },
    ];
    for (const type of ['text', 'hashtag']) {
      for (const control of controls) {
        const f = fixture(rows, hides);
        const q = type === 'hashtag' ? '#StageProof' : 'StageProof';
        const result = await f.service.searchFeed({ q, type, language: 'en', take: '30',
          userId: control.context.userId === A ? B : A, includeHidden: 'true', permissions: '*' }, control.context);
        expect(ids(result.items)).toEqual(control.expected);
        expect(result.count).toBe(control.expected.length);
        expect(f.prisma.communityPost.findMany).toHaveBeenCalledTimes(1);
        expect(f.prisma.user.findFirst).not.toHaveBeenCalled();
        expect(f.prisma.artistFollow.findUnique).not.toHaveBeenCalled();
        assertPrivateHideNotProjected(result, f);
        assertExistingEvent(f, result, control.context, q, type);
      }
    }
  });

  test('03 retains root visibility blocks cursor projection event recording and invalid input rejection', async () => {
    const anchor = '00000000-0000-4000-8000-000000000310';
    const second = '00000000-0000-4000-8000-000000000311';
    const blockedForward = '00000000-0000-4000-8000-000000000212';
    const blockedReverse = '00000000-0000-4000-8000-000000000213';
    const rows = [post(anchor, 40), post(H, 39),
      post('00000000-0000-4000-8000-000000000312', 38, { authorUserId: blockedForward }),
      post('00000000-0000-4000-8000-000000000313', 37, { authorUserId: blockedReverse }),
      post('00000000-0000-4000-8000-000000000314', 36, { visibility: 'followers' }),
      post('00000000-0000-4000-8000-000000000315', 35, { status: 'draft' }),
      post('00000000-0000-4000-8000-000000000316', 34, { deletedAt: new Date('2031-01-01T00:00:00Z') }),
      post('00000000-0000-4000-8000-000000000317', 33, { body: 'test' }), post(V, 32), post(second, 31)];
    const f = fixture(rows, [hide(A, H)], [
      { blockerUserId: A, blockedUserId: blockedForward, status: 'active', deletedAt: null },
      { blockerUserId: blockedReverse, blockedUserId: A, status: 'active', deletedAt: null },
    ]);
    const result = await f.service.searchFeed({ q: 'StageProof', language: 'en', take: '2', cursor: anchor,
      userId: B, visibility: 'followers', role: 'super_admin' }, { userId: A });
    expect(ids(result.items)).toEqual([V, second]);
    expect(result.nextCursor).toBe(second);
    expect(result.query).toEqual({ keyword: 'StageProof', normalizedKeyword: 'stageproof', type: 'text', language: 'en', cursor: anchor });
    expect(f.prisma.communityPost.findMany).toHaveBeenCalledTimes(1);
    const args = f.prisma.communityPost.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ take: 2, cursor: { id: anchor }, skip: 1, orderBy: { publishedAt: 'desc' } });
    expect(Object.keys(args.include).sort()).toEqual(['artist', 'assets', 'author']);
    expect(result.items.every(item => item.thread.rootPostId === item.id && item.thread.engagementTarget === 'root')).toBe(true);
    assertPrivateHideNotProjected(result, f);
    assertExistingEvent(f, result, { userId: A }, 'StageProof');
    const invalid = [{ q: '' }, { q: 'x'.repeat(81) }, { q: 'StageProof', type: 'invalid' },
      { q: 'StageProof', language: 'invalid' }, { q: 'StageProof', take: 'NaN' }, { q: '#', type: 'hashtag' }];
    for (const query of invalid) {
      const bad = fixture(rows, [hide(A, H)]);
      await expect(bad.service.searchFeed(query, { userId: A })).rejects.toBeInstanceOf(BadRequestException);
      expect(bad.prisma.communityPost.findMany).not.toHaveBeenCalled();
      expect(bad.prisma.userBlock.findMany).not.toHaveBeenCalled();
      expect(bad.prisma.$transaction).not.toHaveBeenCalled();
      expect(bad.tx.feedSearchEvent.create).not.toHaveBeenCalled();
      expect(bad.unexpected).toEqual([]);
    }
  });
});
