import { strict as assert } from 'node:assert';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { RewardsService } from './rewards.service';

const crypto: typeof import('crypto') = require('crypto');
const USER = '00000000-0000-4000-8000-000000003401';
const OTHER = '00000000-0000-4000-8000-000000003402';
const WHEN = new Date('2026-10-16T00:00:00.000Z');
const UUIDS: Array<ReturnType<typeof crypto.randomUUID>> = [
  '11111111-1100-4000-8000-000000000001',
  '22222222-2200-4000-8000-000000000002',
];
type Row = { id: string; userId: string; code: string; status: string;
  useCount: number; createdAt: Date; updatedAt: Date };
type Mode = 'race' | 'fresh' | 'existing' | 'create-error';
type Recovery = 'none' | 'own' | 'foreign' | 'throw';
function row(userId = USER, code = 'LS-1111111111'): Row {
  return { id: '00000000-0000-4000-8000-000000003403', userId, code,
    status: 'active', useCount: 0, createdAt: new Date(WHEN.getTime()), updatedAt: new Date(WHEN.getTime()) };
}
function p2002(target: string) {
  return new Prisma.PrismaClientKnownRequestError('Synthetic unique constraint', {
    code: 'P2002', clientVersion: 'synthetic-sdk174', meta: { target: [target] },
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
type Settings = { mode: Mode; recovery?: Recovery; createError?: unknown;
  recoveryError?: Error; userState?: 'active' | 'missing' | 'suspended' | 'deleted';
  occupiedCandidate?: boolean; externalCodeWinner?: boolean };

// The fixture models ORM ownership/uniqueness and an initial-read barrier, not the service algorithm.
// All error injection occurs outside admission validation so expected failures are not fixture faults.
function fixture(settings: Settings) {
  const attempts = { user: 0, lookup: 0, ownerRead: 0, codeRead: 0, create: 0,
    random: 0, otherDb: 0 };
  const faults: string[] = [], events: string[] = [];
  const initialReads = deferred();
  const committed: Row[] = settings.mode === 'existing' ? [{ ...row(), useCount: 7 }] : [];
  const external: Row[] = [];
  const createFailure = Object.prototype.hasOwnProperty.call(settings, 'createError') ? settings.createError : p2002('user_id');
  const recoveryFailure = settings.recoveryError ?? new Error('Synthetic recovery read failed');
  let failedCreates = 0;
  function admit<T>(run: () => T): T {
    try { return run(); }
    catch (error) { faults.push('Fixture admission failed'); throw error; }
  }
  const random = jest.spyOn(crypto, 'randomUUID').mockImplementation(() => {
    attempts.random++;
    return admit(() => {
      assert(attempts.random <= UUIDS.length, 'No automatic regeneration or create retry');
      return UUIDS[attempts.random - 1];
    });
  });
  const user = { findFirst: jest.fn(async (args: unknown) => {
    attempts.user++;
    admit(() => {
      assert.deepEqual(args, { where: { id: USER, status: 'active', deletedAt: null }, select: { id: true } });
      assert(attempts.user <= (settings.mode === 'race' ? 2 : 1));
    });
    events.push('active-user-check');
    return !settings.userState || settings.userState === 'active' ? { id: USER } : null;
  }) };
  const referral = {
    findUnique: jest.fn(async (args: unknown): Promise<Row | { id: string } | null> => {
      attempts.lookup++;
      const kind = admit(() => {
        assert(args !== null && typeof args === 'object');
        const value = args as { where?: { userId?: unknown; code?: unknown }; select?: unknown };
        if (value.where && Object.prototype.hasOwnProperty.call(value.where, 'userId')) {
          assert.deepEqual(args, { where: { userId: USER } }); return 'owner';
        }
        assert.deepEqual(Object.keys(value).sort(), ['select', 'where']);
        assert.equal(typeof value.where?.code, 'string');
        assert.deepEqual(Object.keys(value.where!), ['code']); assert.deepEqual(value.select, { id: true });
        assert(['LS-1111111111', 'LS-2222222222'].includes(value.where!.code as string));
        return 'code';
      });
      if (kind === 'code') {
        attempts.codeRead++;
        events.push('candidate-read');
        return settings.occupiedCandidate && attempts.codeRead === 1
          ? { id: '00000000-0000-4000-8000-000000003404' } : null;
      }
      attempts.ownerRead++;
      const initial = settings.mode === 'race' ? attempts.ownerRead <= 2 : attempts.ownerRead === 1;
      if (initial) {
        events.push(settings.mode === 'existing' ? 'initial-owner-existing' : 'initial-owner-null');
        if (settings.mode === 'existing') return committed[0];
        if (settings.mode === 'race') {
          // Snapshot null before releasing either initial read; both real service calls continue.
          if (attempts.ownerRead === 2) initialReads.resolve();
          await initialReads.promise;
        }
        return null;
      }
      admit(() => {
        assert.equal(attempts.ownerRead, settings.mode === 'race' ? 3 : 2, 'At most one recovery read');
        assert.equal(failedCreates, 1, 'Recovery follows the losing create, not an invented preflight');
      });
      events.push('recovery-owner-read');
      if (settings.mode === 'race') return committed[0] ?? null;
      if (settings.recovery === 'throw') throw recoveryFailure;
      if (settings.recovery === 'own') return external.find(value => value.userId === USER) ?? null;
      if (settings.recovery === 'foreign') return external[0] ?? null;
      return null;
    }),
    create: jest.fn(async (args: unknown): Promise<Row> => {
      attempts.create++;
      const data = admit(() => {
        assert(attempts.create <= (settings.mode === 'race' ? 2 : 1), 'No create retry');
        const value = args as { data?: { userId?: unknown; code?: unknown } };
        assert.deepEqual(Object.keys(value), ['data']);
        assert.deepEqual(Object.keys(value.data!).sort(), ['code', 'userId']);
        assert.equal(value.data!.userId, USER); assert.equal(typeof value.data!.code, 'string');
        assert(['LS-1111111111', 'LS-2222222222'].includes(value.data!.code as string));
        if (settings.mode === 'race') {
          assert.equal(events.filter(event => event === 'initial-owner-null').length, 2,
            'Both first owner queries must read null before either create');
        }
        return { userId: USER, code: value.data!.code as string };
      });
      events.push('create-attempt');
      if (settings.mode === 'create-error') {
        // A different owner's committed code winner is not the losing caller's inserted row.
        if (settings.externalCodeWinner) external.push(row(OTHER, data.code));
        if (settings.recovery === 'own') external.push(row(USER, data.code));
        if (settings.recovery === 'foreign') external.push(row(OTHER, data.code));
        failedCreates++; throw createFailure;
      }
      if (committed.some(existing => existing.userId === data.userId)) {
        failedCreates++; throw createFailure;
      }
      const created = row(data.userId, data.code); committed.push(created);
      events.push('create-committed'); return created;
    }),
  };
  const db = new Proxy({ user, userReferralCode: referral }, {
    get(target, key) {
      if (Object.prototype.hasOwnProperty.call(target, key)) return target[key as keyof typeof target];
      attempts.otherDb++;
      return admit(() => { assert.fail('No wallet/ledger/audit/transaction/provider or other ORM dependency admitted'); });
    },
  });
  const service = new RewardsService(db as never);
  function check() {
    assert.deepEqual(faults, [], 'Admission faults cannot be hidden by product catch');
    assert.equal(attempts.otherDb, 0);
    assert.equal(random.mock.calls.length, attempts.random);
    assert.equal(referral.findUnique.mock.calls.length, attempts.lookup);
    assert.equal(referral.create.mock.calls.length, attempts.create);
    assert.equal(user.findFirst.mock.calls.length, attempts.user);
  }
  function finish() { try { check(); } finally { random.mockRestore(); } }
  return { service, attempts, committed, external, events, createFailure, recoveryFailure, check, finish,
    failedCreates: () => failedCreates };
}
async function rejectsSame(operation: Promise<unknown>, expected: unknown) {
  let rejected = false, caught: unknown;
  try { await operation; } catch (error) { rejected = true; caught = error; }
  assert.equal(rejected, true); assert.equal(caught, expected, 'Original error identity must propagate');
}

describe('RewardsService referral code create replay focused', () => {
  afterEach(() => jest.restoreAllMocks());

  it('01 concurrent same-owner first calls return one committed code rather than the losing unique error', async () => {
    const f = fixture({ mode: 'race' });
    try {
      const outcomes = await Promise.allSettled([
        f.service.getOrCreateReferralCode(USER), f.service.getOrCreateReferralCode(USER),
      ]);
      f.check();
      assert.equal(f.committed.length, 1);
      assert.equal(f.failedCreates(), 1);
      assert.equal(f.attempts.create, 2);
      assert.equal(f.attempts.random, 2);
      assert.equal(f.attempts.codeRead, 2);
      assert.deepEqual(outcomes.map(result => result.status), ['fulfilled', 'fulfilled'],
        'REFERRAL_CODE_SAME_OWNER_REPLAY: the real losing create must return the committed same-owner winner');
      for (const result of outcomes) {
        assert.equal(result.status, 'fulfilled');
        if (result.status === 'fulfilled') assert.deepEqual(result.value, f.committed[0]);
      }
      assert.equal(f.attempts.ownerRead, 3);
      assert.equal(f.events.filter(event => event === 'recovery-owner-read').length, 1);
      assert.equal(f.external.length, 0);
    } finally { f.finish(); }
  }, 10000);

  it('02 only exact P2002 permits one own-winner read while foreign absent and failed recovery never become success', async () => {
    const recoveries: Array<{ recovery: Recovery; target: string; external?: boolean }> = [
      { recovery: 'none', target: 'code', external: true },
      { recovery: 'none', target: 'user_id' },
      { recovery: 'foreign', target: 'user_id' },
      { recovery: 'throw', target: 'user_id' },
      { recovery: 'own', target: 'user_id' },
    ];
    for (const sample of recoveries) {
      const f = fixture({ mode: 'create-error', recovery: sample.recovery,
        createError: p2002(sample.target), externalCodeWinner: sample.external });
      try {
        if (sample.recovery === 'own') {
          assert.deepEqual(await f.service.getOrCreateReferralCode(USER), row());
        } else {
          await rejectsSame(f.service.getOrCreateReferralCode(USER),
            sample.recovery === 'throw' ? f.recoveryFailure : f.createFailure);
        }
        f.check();
        assert.equal(f.attempts.ownerRead, 2); assert.equal(f.attempts.lookup, 3);
        assert.equal(f.attempts.create, 1); assert.equal(f.attempts.random, 1);
        assert.equal(f.committed.length, 0, 'The failed caller create was not committed');
        assert.equal(f.external.length, sample.external || ['own', 'foreign'].includes(sample.recovery) ? 1 : 0);
      } finally { f.finish(); }
    }
    for (const failure of [new Error('Synthetic non-unique create failed'),
      { code: 'P2025' }, { code: 'p2002' }, { code: 2002 }, 'P2002', null]) {
      const f = fixture({ mode: 'create-error', createError: failure, recovery: 'own' });
      try {
        await rejectsSame(f.service.getOrCreateReferralCode(USER), failure);
        f.check();
        assert.equal(f.attempts.ownerRead, 1);
        assert.equal(f.attempts.create, 1); assert.equal(f.attempts.random, 1);
        assert.equal(f.committed.length, 0);
        assert.equal(f.external.length, 1, 'An external same-owner row must not mask a non-P2002 error');
      } finally { f.finish(); }
    }
  }, 10000);

  it('03 existing own rows fresh creation candidate probes and inactive-user refusal retain their original boundaries', async () => {
    assert(Decimal.isDecimal(new Decimal('17.00')), 'Use the actual pinned Prisma Decimal, not a substitute');
    const existing = fixture({ mode: 'existing' });
    try {
      assert.deepEqual(await existing.service.getOrCreateReferralCode(USER), { ...row(), useCount: 7 });
      existing.check();
      assert.equal(existing.attempts.user, 1); assert.equal(existing.attempts.ownerRead, 1);
      assert.equal(existing.attempts.create, 0); assert.equal(existing.attempts.codeRead, 0);
      assert.equal(existing.attempts.random, 0); assert.equal(existing.committed[0].useCount, 7);
    } finally { existing.finish(); }
    for (const occupiedCandidate of [false, true]) {
      const f = fixture({ mode: 'fresh', occupiedCandidate });
      try {
        const created = await f.service.getOrCreateReferralCode(USER); f.check();
        assert.deepEqual(created, row(USER, occupiedCandidate ? 'LS-2222222222' : 'LS-1111111111'));
        assert.equal(f.attempts.ownerRead, 1); assert.equal(f.attempts.create, 1);
        assert.equal(f.attempts.codeRead, occupiedCandidate ? 2 : 1);
        assert.equal(f.attempts.random, occupiedCandidate ? 2 : 1);
        assert.equal(f.committed.length, 1); assert.equal(f.failedCreates(), 0);
      } finally { f.finish(); }
    }
    for (const userState of ['missing', 'suspended', 'deleted'] as const) {
      const f = fixture({ mode: 'fresh', userState });
      try {
        let caught: unknown;
        try { await f.service.getOrCreateReferralCode(USER); } catch (error) { caught = error; }
        assert(caught instanceof BadRequestException); assert.equal(caught.getStatus(), 400);
        assert.equal(caught.message, 'Active user not found'); f.check();
        assert.equal(f.attempts.user, 1); assert.equal(f.attempts.lookup, 0);
        assert.equal(f.attempts.create, 0); assert.equal(f.attempts.random, 0);
        assert.equal(f.committed.length, 0);
      } finally { f.finish(); }
    }
  }, 10000);
});
