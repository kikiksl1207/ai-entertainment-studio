import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { FanEngagementService } from './fan-engagement.service';

// AUTHOR UNRUN. Real whole service; synthetic read-only ORM rows, not SQL or HTTP.
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const WHEN = new Date('2026-01-02T03:04:05.000Z');
type Target = { id: string; status: string; deletedAt: Date | null };
type Kind = 'target' | 'title' | 'badges';
type Summary = Awaited<ReturnType<FanEngagementService['getPublicSummary']>>;

function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(item => clone(item)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  }
  return value;
}

const POLICY = {
  serviceTimezone: 'Asia/Seoul',
  rewardsAreCashLike: false, cashLike: false, luminaAmount: 0,
  pointsTransferable: false, transferable: false, settlementEligible: false,
  luminaConvertible: false, aiDraftsAutoPublish: false,
};
const PRIVACY = { participationHistoryPublic: false, exposesPrivateLedger: false };
function expectedSummary(empty = false) {
  return {
    userId: A,
    publicTitle: empty ? null : {
      code: 'synthetic-title',
      copy: { displayNameKey: 'synthetic.title.name', labels: { ko: { name: 'Synthetic title' } } },
      equippedAt: clone(WHEN),
    },
    publicBadges: empty ? [] : [{
      code: 'synthetic-badge', badgeIconKey: 'synthetic.badge.icon',
      copy: {
        titleKey: 'synthetic.badge.title', descriptionKey: 'synthetic.badge.description',
        labels: { ko: { title: 'Synthetic badge' } },
      },
      earnedAt: clone(WHEN),
    }],
    privacy: clone(PRIVACY), locale: 'ko', policy: clone(POLICY),
  };
}

function fixture(input: {
  user?: Target | null; target?: string; empty?: boolean;
  failure?: { kind: Kind; error: Error };
} = {}) {
  const target = input.target ?? A;
  const user: Target | null = input.user === undefined
    ? { id: A, status: 'active', deletedAt: null } : clone(input.user);
  const title = input.empty ? null : {
    userId: A, status: 'active', equipped: true, equippedAt: clone(WHEN),
    title: {
      code: 'synthetic-title', status: 'active',
      copy: { displayNameKey: 'synthetic.title.name',
        labels: { ko: { name: 'Synthetic title' }, en: { name: 'Synthetic English title' } } },
    },
  };
  const badges = input.empty ? [] : [{
    userId: A, status: 'earned', earnedAt: clone(WHEN),
    achievement: {
      code: 'synthetic-badge', status: 'active', badgeIconKey: 'synthetic.badge.icon',
      copy: { titleKey: 'synthetic.badge.title', descriptionKey: 'synthetic.badge.description',
        labels: { ko: { title: 'Synthetic badge' }, en: { title: 'Synthetic English badge' } } },
    },
  }];
  const stored = { user, title, badges };
  const before = clone(stored);
  const attempts: Record<string, number> = {};
  const calls: Array<{ kind: string; args: unknown }> = [];
  const faults: string[] = [];

  function attempt(kind: string) { attempts[kind] = (attempts[kind] ?? 0) + 1; }
  function admit<T>(run: () => T): T {
    try { return run(); } catch (error) { faults.push('Synthetic admission failure'); throw error; }
  }
  function invoke<T>(kind: Kind, args: unknown, run: () => T): T {
    attempt(kind);
    return admit(() => {
      assert.equal(attempts[kind], 1, 'No automatic retries');
      const result = run();
      calls.push({ kind, args: clone(args) });
      return result;
    });
  }
  function deny(kind: string): never {
    attempt(kind);
    return admit(() => { throw new Error('Unadmitted private-history or write dependency'); });
  }
  function plannedFailure(kind: Kind) {
    // Deliberate query errors are outside admission so exact original identity can propagate.
    if (input.failure?.kind === kind) throw input.failure.error;
  }
  const users = new Proxy({}, { get(_target, field) {
    if (field === 'findUnique') return async (args: unknown) => {
      const result = invoke('target', args, () => {
        const query = args as { where: { id: string; status?: string; deletedAt?: null }; select: unknown };
        const where = query.where;
        const filtered = Object.prototype.hasOwnProperty.call(where, 'status')
          || Object.prototype.hasOwnProperty.call(where, 'deletedAt');
        assert.deepEqual(args, {
          where: filtered ? { id: target, status: 'active', deletedAt: null } : { id: target },
          select: { id: true },
        });
        // Evaluate only the supplied equality predicates. Both immutable old and new shapes are admitted.
        if (!user || user.id !== where.id) return null;
        if (Object.prototype.hasOwnProperty.call(where, 'status') && user.status !== where.status) return null;
        if (Object.prototype.hasOwnProperty.call(where, 'deletedAt') && user.deletedAt !== where.deletedAt) return null;
        return { id: user.id };
      });
      plannedFailure('target');
      return result;
    };
    return deny('user.' + String(field));
  } });
  const titles = new Proxy({}, { get(_target, field) {
    if (field === 'findFirst') return async (args: unknown) => {
      const result = invoke('title', args, () => {
        assert.deepEqual(args, {
          where: { userId: target, status: 'active', equipped: true, title: { status: 'active' } },
          include: { title: true },
          orderBy: [{ equippedAt: 'desc' }, { createdAt: 'desc' }],
        });
        return clone(title);
      });
      plannedFailure('title');
      return result;
    };
    return deny('userFanTitle.' + String(field));
  } });
  const achievements = new Proxy({}, { get(_target, field) {
    if (field === 'findMany') return async (args: unknown) => {
      const result = invoke('badges', args, () => {
        assert.deepEqual(args, {
          where: { userId: target, status: 'earned', achievement: { status: 'active' } },
          include: { achievement: true },
          orderBy: [{ earnedAt: 'desc' }, { createdAt: 'desc' }], take: 6,
        });
        return clone(badges);
      });
      plannedFailure('badges');
      return result;
    };
    return deny('userFanAchievement.' + String(field));
  } });
  const db = new Proxy({}, { get(_target, field) {
    if (field === 'user') return users;
    if (field === 'userFanTitle') return titles;
    if (field === 'userFanAchievement') return achievements;
    return deny('root.' + String(field));
  } });
  const service = new FanEngagementService(db as PrismaService);
  const count = (kind: string) => attempts[kind] ?? 0;
  function check() {
    assert.deepEqual(faults, [], 'Product catches cannot swallow fixture admission faults');
    for (const [kind, count] of Object.entries(attempts)) {
      assert.equal(count, calls.filter(row => row.kind === kind).length, 'Every attempted invocation is admitted');
    }
    assert(Object.keys(attempts).every(kind => ['target', 'title', 'badges'].includes(kind)),
      'No private ledger, participation history, raw queries, transactions, grants or writes');
    assert.deepEqual(stored, before, 'All retained rows remain unchanged');
  }
  function exactCurrentTarget() {
    assert.deepEqual(calls.filter(row => row.kind === 'target').map(row => row.args),
      [{ where: { id: target, status: 'active', deletedAt: null }, select: { id: true } }]);
  }
  function counts(targetReads: number, titleReads: number, badgeReads: number) {
    check();
    assert.equal(count('target'), targetReads); assert.equal(count('title'), titleReads);
    assert.equal(count('badges'), badgeReads);
    assert.equal(calls.length, targetReads + titleReads + badgeReads);
  }
  return { service, check, counts, exactCurrentTarget };
}

async function settle(promise: Promise<Summary>): Promise<
  { ok: true; value: Summary } | { ok: false; error: unknown }
> {
  try { return { ok: true, value: await promise }; } catch (error) { return { ok: false, error }; }
}
function notFound(error: unknown, userId = A) {
  assert(error instanceof NotFoundException);
  assert.equal(error.getStatus(), 404);
  assert.deepEqual(error.getResponse(), {
    code: 'USER_NOT_FOUND', message: 'User not found',
    messageKey: 'fanEngagement.publicSummary.userNotFound', details: { userId },
  });
}

describe('FanEngagementService public summary target state focused', () => {
  it('01 a retained retired target cannot disclose its public title and badges', async () => {
    const f = fixture({ user: { id: A, status: 'deleted', deletedAt: clone(WHEN) } });
    try {
      const result = await settle(f.service.getPublicSummary(A, {}));
      f.check();
      if (result.ok) {
        // The baseline must actually return retained award values before the named regression oracle.
        assert.deepEqual(result.value, expectedSummary());
        f.counts(1, 1, 1);
      }
      assert.equal(result.ok, false,
        'PUBLIC_FAN_TARGET_RETAINED_AWARD_DISCLOSURE: retired targets must stop before retained title or badge projection');
      if (result.ok) throw new Error('Unreachable after the named disclosure oracle');
      notFound(result.error);
      f.exactCurrentTarget(); f.counts(1, 0, 0);
    } finally { f.check(); }
  });

  it('02 active public targets keep exact public projections and empty summaries without private history', async () => {
    for (const empty of [false, true]) {
      const f = fixture({ empty });
      try {
        // An extraneous query userId cannot retarget the actual path-user award filters.
        const result = await f.service.getPublicSummary(A, { userId: B, locale: 'en' });
        assert.deepEqual(result, expectedSummary(empty));
        assert.deepEqual(Object.keys(result).sort(),
          ['locale', 'policy', 'privacy', 'publicBadges', 'publicTitle', 'userId']);
        assert.deepEqual(result.privacy, PRIVACY); assert.deepEqual(result.policy, POLICY);
        f.exactCurrentTarget(); f.counts(1, 1, 1);
      } finally { f.check(); }
    }
    // Probe the pinned SDK implementation, without constructing a database client.
    assert.equal(Prisma.dmmf.datamodel.models.length, 174);
    assert.equal(new Prisma.Decimal('0').toString(), '0');
  });

  it('03 inactive missing and invalid targets stop award reads while query errors retain identity', async () => {
    const variants: Array<{ user: Target | null; target?: string }> = [
      { user: { id: A, status: 'suspended', deletedAt: null } },
      { user: { id: A, status: 'deleted', deletedAt: null } },
      { user: { id: A, status: 'active', deletedAt: clone(WHEN) } },
      { user: null },
      { user: { id: A, status: 'active', deletedAt: null }, target: B },
    ];
    for (const variant of variants) {
      const f = fixture(variant);
      try {
        await assert.rejects(f.service.getPublicSummary(variant.target ?? A, {}), error => {
          notFound(error, variant.target ?? A); return true;
        });
        f.exactCurrentTarget(); f.counts(1, 0, 0);
      } finally { f.check(); }
    }
    const invalid = fixture();
    try {
      await assert.rejects(invalid.service.getPublicSummary('not-a-uuid', {}), error => {
        assert(error instanceof BadRequestException); assert.equal(error.getStatus(), 400);
        assert.deepEqual(error.getResponse(), {
          code: 'INVALID_UUID', message: 'userId must be a UUID',
          messageKey: 'fanEngagement.validation.invalidUuid', details: { field: 'userId' },
        });
        return true;
      });
      invalid.counts(0, 0, 0);
    } finally { invalid.check(); }
    for (const kind of ['target', 'title', 'badges'] as const) {
      const failure = new Error('Synthetic ' + kind + ' read failure');
      const f = fixture({ failure: { kind, error: failure } });
      try {
        await assert.rejects(f.service.getPublicSummary(A, {}), error => error === failure);
        f.exactCurrentTarget();
        // Both award promises are invoked once by the actual Promise.all, even if one rejects.
        f.counts(1, kind === 'target' ? 0 : 1, kind === 'target' ? 0 : 1);
      } finally { f.check(); }
    }
  });
});
