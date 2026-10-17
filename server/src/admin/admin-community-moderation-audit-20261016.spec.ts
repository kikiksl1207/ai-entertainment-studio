import assert = require('node:assert/strict');
import { AsyncLocalStorage } from 'node:async_hooks';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

// AUTHOR UNRUN. Real class/helpers, synthetic staged ORM; not SQL or route-auth proof.
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const AUTHOR = '44444444-4444-4444-8444-444444444444';
const ARTIST = '55555555-5555-4555-8555-555555555555';
const OLD = new Date('2026-10-16T00:00:00.123Z');
const USER: AuthUser = { id: ACTOR, adminRole: 'super_admin' };
const BODY = 'SYNTHETIC_POST_BODY_NOT_FOR_AUDIT';
const NOTE = 'SYNTHETIC_MODERATION_NOTE_NOT_FOR_AUDIT';
const EMAIL = 'author@example.invalid';
const EXTRA = 'SYNTHETIC_UNADMITTED_PAYLOAD_NOT_FOR_AUDIT';
const INCLUDE = {
  author: { select: { id: true, email: true, status: true,
    profile: { select: { displayName: true, avatarAssetId: true } } } },
  artist: { select: { id: true, slug: true, displayName: true, status: true } },
};
type Row = Prisma.CommunityPostGetPayload<{ include: typeof INCLUDE }>;
type Action = 'hide' | 'restore';
type Audit = Record<string, unknown>;
type Tx = { active: boolean; row: Row; audits: Audit[] };
type Failure = 'find' | 'transaction' | 'update' | 'audit' | 'commit';

function clone<T>(value: T): T {
  if (value === Prisma.JsonNull) return value;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(item => clone(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  }
  return value;
}
function seeded(action: Action): Row {
  return {
    id: ID, authorUserId: AUTHOR, artistId: action === 'hide' ? ARTIST : null,
    postType: 'user_post', status: action === 'hide' ? 'published' : 'hidden', visibility: 'public',
    body: BODY, likeCount: 7, replyCount: 2, reportCount: 3,
    metadata: { preserved: { synthetic: true }, moderation: {
      status: 'prior', reason: 'prior_reason', note: NOTE,
      hiddenByUserId: OTHER, restoredByUserId: OTHER,
      hiddenAt: OLD.toISOString(), restoredAt: OLD.toISOString(), preserved: 'moderation-marker',
    } },
    publishedAt: clone(OLD), createdAt: clone(OLD), updatedAt: clone(OLD), deletedAt: clone(OLD),
    author: { id: AUTHOR, email: EMAIL, status: 'active',
      profile: { displayName: 'Synthetic author', avatarAssetId: null } },
    artist: action === 'hide'
      ? { id: ARTIST, slug: 'synthetic-artist', displayName: 'Synthetic artist', status: 'active' } : null,
  };
}
function input(): Record<string, unknown> {
  return { reason: ' synthetic_review ', note: ' ' + NOTE + ' ', ignored: EXTRA };
}
function optional(value: unknown) { return typeof value === 'string' ? value.trim() : undefined; }
function auditSnapshot(row: Row) {
  const metadata = row.metadata as Record<string, unknown>;
  const moderation = metadata.moderation as Record<string, unknown>;
  const text = (value: unknown) => typeof value === 'string' && value.length ? value : null;
  return {
    id: row.id, status: row.status, visibility: row.visibility, postType: row.postType,
    authorUserId: row.authorUserId, artistId: row.artistId, reportCount: row.reportCount,
    publishedAt: row.publishedAt.toISOString(), deletedAt: row.deletedAt?.toISOString() ?? null,
    bodyPresent: true, bodyLength: BODY.length,
    author: { id: AUTHOR, status: 'active', emailMasked: 'au***@example.invalid' },
    artist: row.artist ? { id: ARTIST, slug: 'synthetic-artist', status: 'active' } : null,
    moderation: {
      status: text(moderation.status), reason: text(moderation.reason),
      notePresent: typeof moderation.note === 'string' && moderation.note.length > 0,
      hiddenByUserId: text(moderation.hiddenByUserId), restoredByUserId: text(moderation.restoredByUserId),
      hiddenAt: text(moderation.hiddenAt), restoredAt: text(moderation.restoredAt),
    },
    auditRawBodyStored: false, auditRawEmailStored: false, auditRawModerationNoteStored: false,
    auditTokenCookiePasswordStored: false, auditDbUrlStored: false,
  };
}
function auditData(action: Action, before: Row, after: Row, payload: Record<string, unknown>): Audit {
  return {
    actorUserId: ACTOR, actorType: 'admin', action: 'community_post.' + action,
    targetType: 'community_post', targetId: ID,
    beforeData: auditSnapshot(before), afterData: auditSnapshot(after),
    metadata: { reason: optional(payload.reason) ?? null, notePresent: Boolean(optional(payload.note)),
      rawBodyStored: false, rawEmailStored: false, rawModerationNoteStored: false,
      tokenCookiePasswordStored: false, dbUrlStored: false },
  };
}

function fixture(action: Action, payload: Record<string, unknown> = input()) {
  const initial = seeded(action);
  let committed = clone(initial), missing = false;
  const unrelated = { ...seeded('hide'), id: OTHER }, beforeOther = clone(unrelated);
  const audits: Audit[] = [], faults: string[] = [], events: string[] = [];
  const context = new AsyncLocalStorage<Tx>();
  let failure: { stage: Failure; error: unknown } | null = null;
  const error = new Error('SYNTHETIC_COMMUNITY_AUDIT_OR_DB_FAILURE');
  const stats = { attempts: 0, unexpected: 0, finds: 0, txLocks: 0, txFinds: 0, rootUpdates: 0, txUpdates: 0,
    rootAudits: 0, txAudits: 0, transactions: 0, active: 0, commits: 0, rollbacks: 0 };
  function admit<T>(tx: Tx | null, label: string, extra: unknown[], check: () => T): T {
    stats.attempts++; events.push((tx ? 'tx:' : 'root:') + label);
    try {
      assert.deepEqual(extra, [], 'No extra delegate arguments admitted');
      assert.equal(context.getStore() ?? null, tx, 'Exact root or transaction calling context required');
      if (tx) assert.equal(tx.active, true);
      return check();
    } catch (caught) { faults.push(label); throw caught; }
  }
  function failAt(stage: Failure) { if (failure?.stage === stage) throw failure.error; }
  function deny(label: string): never {
    stats.attempts++; stats.unexpected++; faults.push(label);
    throw new Error('COMMUNITY_MODERATION_FIXTURE_UNADMITTED_DEPENDENCY');
  }
  function closed<T extends object>(target: T, label: string): T {
    return new Proxy(target, { get(object, key, receiver) {
      if (typeof key === 'symbol' || Object.prototype.hasOwnProperty.call(object, key)) return Reflect.get(object, key, receiver);
      return deny(label + '.' + String(key));
    } });
  }
  function posts(tx: Tx | null) {
    const update = async (args: unknown, ...extra: unknown[]) => {
      if (tx) stats.txUpdates++; else stats.rootUpdates++;
      const row = admit(tx, 'update', extra, () => {
        assert.equal(stats.rootUpdates + stats.txUpdates, 1);
        assert.equal(stats.finds, 1);
        assert.equal(stats.txLocks, 1); assert.equal(stats.txFinds, 1);
        const value = args as { data: { updatedAt: Date; metadata: Record<string, unknown> } };
        assert(value.data.updatedAt instanceof Date); assert(Number.isFinite(value.data.updatedAt.getTime()));
        const metadata = value.data.metadata;
        const moderation = metadata.moderation as Record<string, unknown>;
        const dateKey = action === 'hide' ? 'hiddenAt' : 'restoredAt';
        const timestamp = moderation[dateKey];
        assert.equal(typeof timestamp, 'string');
        assert.equal(new Date(timestamp as string).toISOString(), timestamp);
        const prior = initial.metadata as Record<string, unknown>;
        const expected = {
          status: action === 'hide' ? 'hidden' : 'published',
          ...(action === 'restore' ? { deletedAt: null } : {}),
          updatedAt: value.data.updatedAt,
          metadata: { ...clone(prior), moderation: {
            ...(prior.moderation as Record<string, unknown>),
            status: action === 'hide' ? 'hidden' : 'restored',
            reason: optional(payload.reason) ?? null, note: optional(payload.note) ?? null,
            [action === 'hide' ? 'hiddenByUserId' : 'restoredByUserId']: ACTOR,
            [dateKey]: timestamp,
          } },
        };
        assert.deepEqual(args, { where: { id: ID }, data: expected, include: INCLUDE });
        return { ...clone(tx ? tx.row : committed), ...clone(expected) } as Row;
      });
      // Planned DB errors occur after admission, never inside the admission-fault catch.
      failAt('update');
      if (tx) tx.row = row; else committed = row;
      return clone(row);
    };
    if (tx) return closed({ update, findUnique: async (args: unknown, ...extra: unknown[]) => {
      stats.txFinds++;
      return admit(tx, 'find', extra, () => {
        assert.equal(stats.txFinds, 1); assert.equal(stats.txLocks, 1);
        assert.equal(stats.finds, 1); assert.equal(stats.txUpdates, 0);
        assert.deepEqual(args, { where: { id: ID }, include: INCLUDE });
        return clone(tx.row);
      });
    } }, 'tx.communityPost');
    return closed({ update, findUnique: async (args: unknown, ...extra: unknown[]) => {
      stats.finds++;
      admit(null, 'find', extra, () => {
        assert.equal(stats.finds, 1); assert.deepEqual(args, { where: { id: ID }, include: INCLUDE });
      });
      failAt('find'); return missing ? null : clone(committed);
    } }, 'root.communityPost');
  }
  function auditDelegate(tx: Tx | null) {
    return closed({ create: async (args: unknown, ...extra: unknown[]) => {
      if (tx) stats.txAudits++; else stats.rootAudits++;
      const data = admit(tx, 'audit', extra, () => {
        assert.equal(stats.rootAudits + stats.txAudits, 1);
        assert.equal(stats.rootUpdates + stats.txUpdates, 1);
        const expected = auditData(action, initial, tx ? tx.row : committed, payload);
        assert.equal(Object.keys(expected).length, 8);
        assert.deepEqual(args, { data: expected });
        const serialized = JSON.stringify(args);
        for (const marker of [BODY, NOTE, EMAIL, EXTRA]) assert(!serialized.includes(marker));
        assert(serialized.includes('au***@example.invalid'));
        return clone(expected);
      });
      failAt('audit'); (tx ? tx.audits : audits).push(data);
      return { id: 'synthetic-audit', ...clone(data) };
    } }, tx ? 'tx.auditEvent' : 'root.auditEvent');
  }
  const prisma = closed({
    communityPost: posts(null), auditEvent: auditDelegate(null),
    $transaction: async <T>(work: (tx: unknown) => Promise<T>, options: unknown, ...extra: unknown[]): Promise<T> => {
      stats.transactions++;
      admit(null, 'transaction', extra, () => {
        assert.equal(stats.transactions, 1); assert.equal(stats.finds, 1);
        assert.equal(typeof work, 'function');
        assert.deepEqual(options, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      });
      failAt('transaction');
      const tx: Tx = { active: true, row: clone(committed), audits: [] }; stats.active++;
      const client = closed({
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          stats.txLocks++;
          return admit(tx, 'lock', [], () => {
            assert.equal(stats.txLocks, 1); assert.equal(stats.txFinds, 0);
            assert.equal(stats.finds, 1); assert.equal(stats.txUpdates, 0); assert.equal(stats.txAudits, 0);
            assert(Object.isFrozen(strings) && Object.isFrozen(strings.raw));
            assert.equal(strings.length, 2); assert.deepEqual([...strings.raw], [...strings]);
            assert.deepEqual(values, [ID]);
            assert.equal((strings[0] + '$1' + strings[1]).replace(/\s+/g, ' ').trim(),
              'SELECT id FROM community_posts WHERE id = $1::uuid FOR UPDATE');
            return [{ id: ID }];
          });
        },
        communityPost: posts(tx), auditEvent: auditDelegate(tx),
      }, 'tx');
      try {
        return await context.run(tx, async () => {
          const value = await work(client); failAt('commit');
          committed = clone(tx.row); audits.push(...clone(tx.audits));
          stats.commits++; events.push('tx:commit'); return value;
        });
      } catch (caught) { stats.rollbacks++; events.push('tx:rollback'); throw caught; }
      finally { tx.active = false; stats.active--; }
    },
  }, 'root');
  const config = closed({ get: () => deny('config.get') }, 'config');
  const service = new AdminService(prisma as unknown as PrismaService, config as unknown as ConfigService);
  function check() {
    assert.deepEqual(faults, [], 'Fixture admission faults cannot be swallowed by product catches');
    assert.equal(stats.unexpected, 0); assert.deepEqual(unrelated, beforeOther);
    const currentReads = stats.transactions === 1 && failure?.stage !== 'transaction' ? 1 : 0;
    assert.equal(stats.txLocks, currentReads); assert.equal(stats.txFinds, currentReads);
  }
  return { service, initial, stats, audits, events, error, check,
    call: (postId = ID) => action === 'hide'
      ? service.hideCommunityPost(USER, postId, payload) : service.restoreCommunityPost(USER, postId, payload),
    snapshot: () => ({ post: clone(committed), audits: clone(audits) }),
    fail: (stage: Failure, injected: unknown = error) => { failure = { stage, error: injected }; },
    missing: () => { missing = true; },
    finish: () => { check(); assert.equal(stats.active, 0); } };
}
type Fixture = ReturnType<typeof fixture>;
function noMutation(f: Fixture) {
  assert.equal(f.stats.rootUpdates, 0); assert.equal(f.stats.txUpdates, 0);
  assert.equal(f.stats.rootAudits, 0); assert.equal(f.stats.txAudits, 0);
  assert.deepEqual(f.snapshot(), { post: f.initial, audits: [] });
}
function rolledBack(f: Fixture, updates: number, audits: number) {
  assert.deepEqual(f.snapshot(), { post: f.initial, audits: [] });
  assert.equal(f.stats.transactions, 1); assert.equal(f.stats.commits, 0); assert.equal(f.stats.rollbacks, 1);
  assert.equal(f.stats.txUpdates, updates); assert.equal(f.stats.txAudits, audits);
  assert.equal(f.stats.rootUpdates, 0); assert.equal(f.stats.rootAudits, 0);
}

describe('AdminService community moderation audit focused', () => {
  it('01 audit rejection cannot leave a committed community post mutation', async () => {
    for (const action of ['hide', 'restore'] as const) {
      const f = fixture(action), before = f.snapshot();
      try {
        f.fail('audit'); await assert.rejects(f.call(), caught => caught === f.error);
        f.check();
        assert.deepEqual(f.snapshot(), before, 'COMMUNITY_MODERATION_AUDIT_PARTIAL_COMMIT');
        rolledBack(f, 1, 1);
        assert.deepEqual(f.events, ['root:find', 'root:transaction', 'tx:lock', 'tx:find', 'tx:update', 'tx:audit', 'tx:rollback']);
      } finally { f.finish(); }
    }
  });

  it('02 hide and restore preserve exact payload privacy response and transaction-local audit order', async () => {
    for (const action of ['hide', 'restore'] as const) {
      for (const payload of [input(), {}, { reason: 12, note: false }]) {
        const f = fixture(action, payload);
        try {
          const result = await f.call(); f.check();
          const saved = f.snapshot();
          assert.deepEqual(result, { ok: true, post: saved.post });
          assert.equal(saved.post.status, action === 'hide' ? 'hidden' : 'published');
          assert.deepEqual(saved.post.deletedAt, action === 'hide' ? OLD : null);
          assert.equal(saved.post.body, BODY); assert.deepEqual(saved.post.author, f.initial.author);
          assert.deepEqual(saved.post.artist, f.initial.artist);
          assert.deepEqual(saved.audits, [auditData(action, f.initial, saved.post, payload)]);
          assert.equal(f.stats.finds, 1); assert.equal(f.stats.transactions, 1);
          assert.equal(f.stats.txUpdates, 1); assert.equal(f.stats.txAudits, 1);
          assert.equal(f.stats.rootUpdates, 0); assert.equal(f.stats.rootAudits, 0);
          assert.equal(f.stats.commits, 1); assert.equal(f.stats.rollbacks, 0);
          assert.deepEqual(f.events, ['root:find', 'root:transaction', 'tx:lock', 'tx:find', 'tx:update', 'tx:audit', 'tx:commit']);
        } finally { f.finish(); }
      }
    }
  });

  it('03 transaction update audit and commit failures retain identity without retries or partial state', async () => {
    const known = (code: string) => new Prisma.PrismaClientKnownRequestError('Synthetic SDK error', {
      code, clientVersion: 'synthetic-sdk174', meta: { target: ['synthetic'] },
    });
    for (const action of ['hide', 'restore'] as const) {
      for (const stage of ['transaction', 'update', 'audit', 'commit'] as const) {
        const errors: unknown[] = stage === 'audit' ? [new Error('Synthetic audit'), known('P2002'), known('P2003')]
          : [new Error('Synthetic ' + stage), known('P2025')];
        for (const error of errors) {
          const f = fixture(action);
          try {
            f.fail(stage, error); await assert.rejects(f.call(), caught => caught === error); f.check();
            if (stage === 'transaction') {
              noMutation(f); assert.equal(f.stats.transactions, 1);
              assert.equal(f.stats.commits, 0); assert.equal(f.stats.rollbacks, 0);
            } else {
              rolledBack(f, 1, stage === 'update' ? 0 : 1);
            }
            assert.equal(f.stats.finds, 1);
          } finally { f.finish(); }
        }
      }
    }
  });

  it('04 malformed missing and lookup-failed posts stop before transaction or audit side effects', async () => {
    for (const action of ['hide', 'restore'] as const) {
      for (const kind of ['invalid', 'missing', 'findError'] as const) {
        const f = fixture(action);
        try {
          if (kind === 'missing') f.missing();
          if (kind === 'findError') f.fail('find');
          await assert.rejects(f.call(kind === 'invalid' ? 'invalid-synthetic-id' : ID), caught => {
            if (kind === 'invalid') return caught instanceof BadRequestException && caught.getStatus() === 400
              && caught.message === 'postId must be a UUID';
            if (kind === 'missing') return caught instanceof NotFoundException && caught.getStatus() === 404
              && caught.message === 'Community post not found';
            return caught === f.error;
          });
          f.check(); noMutation(f);
          assert.equal(f.stats.finds, kind === 'invalid' ? 0 : 1);
          assert.equal(f.stats.transactions, 0); assert.equal(f.stats.commits, 0); assert.equal(f.stats.rollbacks, 0);
        } finally { f.finish(); }
      }
    }
  });
});
