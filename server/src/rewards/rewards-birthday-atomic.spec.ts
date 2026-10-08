import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { RewardsService } from './rewards.service';

const USER = '00000000-0000-4000-8000-000000000001';
const WALLET = '10000000-0000-4000-8000-000000000001';
const SUBJECT = 'synthetic-birthday-subject';
const DATE = new Date('2026-10-09T00:00:00.000Z');
const KEY = `birthday_bonus:${SUBJECT}:2026`;
type Row = Record<string, any>;
type Context = {
  id: number; ledgers: Row[]; wallets: Row[]; attendance: Row[];
  increments: Map<string, Decimal>; held: Set<string>; releases: Array<() => void>;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === 'OR') return value.some((item: Row) => matches(row, item));
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every(item => matches(row, item));
    const actual = row[key];
    if (value instanceof Date) return actual instanceof Date && actual.getTime() === value.getTime();
    if (value && typeof value === 'object') {
      return Object.entries(value).every(([operator, wanted]) => {
        if (operator === 'in') return (wanted as unknown[]).includes(actual);
        if (operator === 'startsWith') return typeof actual === 'string' && actual.startsWith(String(wanted));
        if (operator === 'lt') return actual < (wanted as any);
        return matches(actual ?? {}, { [operator]: wanted });
      });
    }
    return actual === value;
  });
}

function fixture(initial = 2500) {
  const identity: Row = { userId: USER, status: 'verified', identitySubjectHash: SUBJECT,
    birthDate: new Date('1990-10-09T00:00:00.000Z') };
  const user: Row = { id: USER, status: 'active', deletedAt: null, phoneNumber: null,
    profile: { bio: 'Synthetic QA', avatarAssetId: null, coverAssetId: null } };
  const wallets: Row[] = [{ id: WALLET, userId: USER, currencyCode: 'LUMINA', status: 'active',
    cachedBalance: new Decimal(initial) }];
  const ledgers: Row[] = [];
  const attendance: Row[] = [];
  const events: Array<{ tx: number | null; name: string }> = [];
  const queries: Array<{ tx: number; sql: string; values: unknown[] }> = [];
  const locks = new Map<string, Promise<void>>();
  let sequence = 0, txSequence = 0;
  let failure: string | null = null;
  let paused: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
  let nextUserLock: ReturnType<typeof deferred> | undefined;
  let nextReceiptRead: ReturnType<typeof deferred> | undefined;

  const seed = (amount: number, overrides: Row = {}) => {
    const row: Row = { id: `synthetic-ledger-${++sequence}`, walletAccountId: WALLET,
      direction: 'credit', amount: new Decimal(amount), ledgerType: 'signup_bonus',
      referenceType: 'user', referenceId: USER, idempotencyKey: `synthetic:${sequence}`,
      memo: null, createdAt: DATE, ...overrides };
    ledgers.push(row);
    return row;
  };
  if (initial) seed(initial);
  const mark = (ctx: Context | null, name: string) => events.push({ tx: ctx?.id ?? null, name });
  const fail = (point: string) => {
    if (failure === point) { failure = null; throw new Error('Synthetic rollback'); }
  };
  const visibleWallets = (ctx: Context | null) => [...wallets, ...(ctx?.wallets ?? [])];
  const visibleLedgers = (ctx: Context | null, where: Row = {}) =>
    [...ledgers, ...(ctx?.ledgers ?? [])].filter(row => matches({ ...row,
      walletAccount: visibleWallets(ctx).find(wallet => wallet.id === row.walletAccountId) }, where));
  const walletRead = (wallet: Row, ctx: Context | null) => ({ ...wallet,
    cachedBalance: wallet.cachedBalance.plus(ctx?.increments.get(wallet.id) ?? 0) });
  const attendanceRead = (ctx: Context | null, where: Row = {}) =>
    [...attendance, ...(ctx?.attendance ?? [])].filter(row => matches(row, where));

  // Transactions have isolated write overlays. Only the explicit source SQL
  // locks serialize callers; reads see committed rows plus their own overlay.
  const acquire = async (ctx: Context, key: string) => {
    if (ctx.held.has(key)) return;
    const previous = locks.get(key) ?? Promise.resolve();
    const held = deferred(), tail = previous.then(() => held.promise);
    locks.set(key, tail);
    await previous;
    ctx.held.add(key);
    ctx.releases.push(() => { held.resolve(); if (locks.get(key) === tail) locks.delete(key); });
  };
  const client = (ctx: Context | null): Row => {
    const read = (name: string, action: (args: Row) => unknown) => jest.fn(async (args: Row = {}) => {
      mark(ctx, name);
      return action(args);
    });
    const userRead = (args: Row) => matches(user, args.where) ? { ...user,
      identityVerification: { ...identity }, walletAccounts: visibleWallets(ctx).map(wallet => walletRead(wallet, ctx)) } : null;
    const db: Row = {
      user: {
        findFirst: read('user.findFirst', userRead),
        findUniqueOrThrow: read('user.findUniqueOrThrow', args => {
          const row = userRead(args);
          if (!row) throw Object.assign(new Error('Synthetic missing user'), { code: 'P2025' });
          return row;
        }),
      },
      userIdentityVerification: { findUniqueOrThrow: read('identity.findUniqueOrThrow', args => {
        if (args.where.userId !== USER) throw new Error('Synthetic missing identity');
        return { ...identity };
      }) },
      walletLedger: {
        findUnique: read('ledger.findUnique', args => {
          const row = visibleLedgers(ctx, args.where)[0] ?? null;
          if (!ctx && args.where.idempotencyKey === KEY && nextReceiptRead) {
            nextReceiptRead.resolve(); nextReceiptRead = undefined;
          }
          return row;
        }),
        findMany: read('ledger.findMany', args => visibleLedgers(ctx, args.where).map(row =>
          args.select ? Object.fromEntries(Object.entries(args.select).filter(([, enabled]) => enabled === true)
            .map(([key]) => [key, row[key]])) : { ...row })),
        aggregate: read('ledger.aggregate', args => {
          if (!ctx) throw new Error('Promotional aggregation outside transaction');
          return { _sum: { amount: visibleLedgers(ctx, args.where)
            .reduce((sum, row) => sum.plus(row.amount), new Decimal(0)) } };
        }),
        create: jest.fn(async (args: Row) => {
          if (!ctx) throw new Error('Ledger write outside transaction');
          mark(ctx, 'ledger.create'); fail('ledger.create');
          if (visibleLedgers(ctx, { idempotencyKey: args.data.idempotencyKey }).length)
            throw Object.assign(new Error('Synthetic duplicate'), { code: 'P2002' });
          const row = { id: `synthetic-ledger-${++sequence}`, createdAt: DATE, ...args.data };
          ctx.ledgers.push(row);
          if (paused) { const gate = paused; paused = undefined; gate.entered.resolve(); await gate.release.promise; }
          return { ...row };
        }),
      },
      walletAccount: {
        findUnique: read('wallet.findUnique', args => {
          const row = visibleWallets(ctx).find(wallet => matches(wallet, args.where.userId_currencyCode ?? args.where));
          return row ? walletRead(row, ctx) : null;
        }),
        upsert: jest.fn(async (args: Row) => {
          if (!ctx) throw new Error('Wallet upsert outside transaction');
          mark(ctx, 'wallet.upsert');
          expect(args.update).toEqual({});
          let row = visibleWallets(ctx).find(wallet => matches(wallet, args.where.userId_currencyCode));
          if (!row) { const created: Row = { id: WALLET, status: 'active', cachedBalance: new Decimal(0), ...args.create }; ctx.wallets.push(created); row = created; }
          if (!row) throw new Error('Synthetic missing upserted wallet');
          return walletRead(row, ctx);
        }),
        update: jest.fn(async (args: Row) => {
          if (!ctx) throw new Error('Wallet update outside transaction');
          mark(ctx, 'wallet.update');
          const row = visibleWallets(ctx).find(wallet => wallet.id === args.where.id);
          if (!row) throw new Error('Synthetic missing wallet');
          ctx.increments.set(row.id, (ctx.increments.get(row.id) ?? new Decimal(0)).plus(args.data.cachedBalance.increment));
          fail('wallet.update.afterIncrement');
          return walletRead(row, ctx);
        }),
      },
      paymentOrder: { findMany: read('payment.findMany', () => []) },
      dailyAttendanceReward: {
        findMany: read('attendance.findMany', args => attendanceRead(ctx, args.where)
          .sort((a, b) => b.serviceDate.getTime() - a.serviceDate.getTime()).slice(0, args.take)),
        findUnique: read('attendance.findUnique', args => attendanceRead(ctx, args.where.userId_serviceDate)[0] ?? null),
        create: jest.fn(async (args: Row) => {
          if (!ctx) throw new Error('Attendance write outside transaction');
          const row = { id: `synthetic-attendance-${++sequence}`, createdAt: DATE, ...args.data };
          ctx.attendance.push(row); return { ...row };
        }),
      },
      $queryRaw: jest.fn(async (query: TemplateStringsArray | { strings: string[]; values: unknown[] }, ...args: unknown[]) => {
        if (!ctx) throw new Error('Lock outside transaction');
        const fragments = Array.isArray(query) ? query : (query as { strings: string[] }).strings;
        const values = Array.isArray(query) ? args : (query as { values: unknown[] }).values;
        const sql = Array.from(fragments).join('?').replace(/\s+/g, ' ').trim();
        queries.push({ tx: ctx.id, sql, values });
        if (/FROM public\.users\b.*FOR NO KEY UPDATE\b/i.test(sql)) {
          expect(values).toEqual([USER]);
          if (nextUserLock) { nextUserLock.resolve(); nextUserLock = undefined; }
          await acquire(ctx, `user:${USER}`); mark(ctx, 'lock.user'); return [{ id: USER }];
        }
        if (/FROM public\.wallet_accounts\b.*FOR UPDATE\b/i.test(sql)) {
          expect(values).toEqual([USER, 'LUMINA']);
          for (const wallet of visibleWallets(ctx)) await acquire(ctx, `wallet:${wallet.id}`);
          mark(ctx, 'lock.wallet'); return visibleWallets(ctx).map(wallet => walletRead(wallet, ctx));
        }
        throw new Error('Unexpected synthetic lock query');
      }),
    };
    for (const name of ['communityPost', 'communityReaction', 'communityReply', 'artistFollow', 'userFollow', 'fanLetter', 'artistBoostEvent']) {
      db[name] = { count: read(`${name}.count`, args => {
        const owner = args.where.authorUserId ?? args.where.followerUserId ?? args.where.senderUserId ?? args.where.userId;
        return owner === USER && name === 'communityReaction' && args.where.reactionType === 'like' ? 1 : 0;
      }) };
    }
    return db;
  };
  const prisma = client(null);
  prisma.$transaction = jest.fn(async (callback: (db: Row) => Promise<unknown>, options: Row) => {
    expect(options).toEqual({ isolationLevel: 'ReadCommitted' });
    const ctx: Context = { id: ++txSequence, ledgers: [], wallets: [], attendance: [],
      increments: new Map(), held: new Set(), releases: [] };
    try {
      const result = await callback(client(ctx));
      if (ctx.ledgers.some(row => ledgers.some(existing => existing.idempotencyKey === row.idempotencyKey)))
        throw Object.assign(new Error('Synthetic commit duplicate'), { code: 'P2002' });
      wallets.push(...ctx.wallets);
      ledgers.push(...ctx.ledgers); attendance.push(...ctx.attendance);
      for (const [id, increment] of ctx.increments) {
        const wallet = wallets.find(row => row.id === id)!;
        wallet.cachedBalance = wallet.cachedBalance.plus(increment);
      }
      mark(ctx, 'commit'); return result;
    } catch (error) { mark(ctx, 'rollback'); throw error; }
    finally { for (const release of ctx.releases.reverse()) release(); }
  });
  const service = new RewardsService(prisma as never);
  jest.spyOn(service as any, 'getKoreanServiceDate').mockReturnValue(DATE);
  return { service, prisma, user, identity, wallets, ledgers, attendance, events, queries, seed,
    failNext: (point: string) => { failure = point; },
    pauseNextLedger: () => { const gate = { entered: deferred(), release: deferred() }; paused = gate; return gate; },
    nextLockRequest: () => { const gate = deferred(); nextUserLock = gate; return gate.promise; },
    nextBirthdayPreflight: () => { const gate = deferred(); nextReceiptRead = gate; return gate.promise; } };
}

describe('RewardsService birthday shared promotional cap boundary', () => {
  afterEach(() => jest.restoreAllMocks());

  it('credits the existing 500 amount at exactly 2500, with cap reads after both native-shaped locks', async () => {
    const f = fixture();
    const result = await f.service.claimBirthdayReward(USER);
    expect(result).toMatchObject({ idempotentReplay: false, walletCredited: true,
      reward: { code: 'birthday_verified_annual', rewardLumina: 500, year: 2026 } });
    expect(f.wallets[0].cachedBalance.toString()).toBe('3000');
    expect(f.ledgers.filter(row => row.idempotencyKey === KEY)).toHaveLength(1);
    expect(f.ledgers.find(row => row.idempotencyKey === KEY)).toMatchObject({ walletAccountId: WALLET,
      direction: 'credit', ledgerType: 'birthday_bonus', referenceId: USER });
    const txEvents = f.events.filter(event => event.tx === 1).map(event => event.name);
    expect(txEvents.slice(0, 3)).toEqual(['lock.user', 'lock.wallet', 'ledger.findUnique']);
    expect(txEvents.indexOf('ledger.aggregate')).toBeGreaterThan(txEvents.indexOf('lock.wallet'));
    expect(f.events.filter(event => event.name === 'ledger.aggregate').every(event => event.tx !== null)).toBe(true);
    expect(f.queries).toHaveLength(2);
  });

  it.each([2501, 2500.01])('rejects the existing cap at earned %s without a birthday write', async earned => {
    const f = fixture(earned);
    await expect(f.service.claimBirthdayReward(USER)).rejects.toMatchObject({ response: {
      code: 'FREE_PROMO_REWARD_CAP_EXCEEDED', details: { requestedLumina: '500', ledgerType: 'birthday_bonus' } } });
    expect(f.ledgers).toHaveLength(1);
    expect(f.wallets[0].cachedBalance.toString()).toBe(new Decimal(earned).toString());
    expect(f.events.some(event => ['wallet.upsert', 'ledger.create', 'wallet.update'].includes(event.name))).toBe(false);
  });

  it.each([
    ['activation', 'birthday'], ['birthday', 'activation'],
    ['attendance', 'birthday'], ['birthday', 'attendance'],
  ])('serializes %s then %s without exceeding the existing 3000 cap', async (first, second) => {
    const f = fixture(2491), gate = f.pauseNextLedger();
    const claim = (kind: string) => kind === 'birthday' ? f.service.claimBirthdayReward(USER)
      : kind === 'activation' ? f.service.claimActivationQuest(USER, 'first_feed_like')
      : f.service.claimDailyAttendance(USER);
    const one = claim(first);
    const firstSettled = one.then(value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason }));
    await gate.entered.promise;
    const requested = f.nextLockRequest(), two = claim(second);
    const results = Promise.allSettled([firstSettled, two]);
    await requested; gate.release.resolve();
    const [a, b] = await results;
    expect(a.status).toBe('fulfilled');
    if (a.status === 'fulfilled') expect(a.value.status).toBe('fulfilled');
    expect(b.status).toBe('rejected');
    if (b.status === 'rejected') expect(b.reason.getResponse().code).toBe('FREE_PROMO_REWARD_CAP_EXCEEDED');
    expect(f.wallets[0].cachedBalance.lessThanOrEqualTo(3000)).toBe(true);
    expect(f.ledgers).toHaveLength(2);
    expect(f.events.filter(event => event.name === 'commit')).toHaveLength(1);
  });

  it('preserves the known matching annual receipt for a concurrent duplicate at the full cap', async () => {
    const f = fixture(), gate = f.pauseNextLedger();
    const first = f.service.claimBirthdayReward(USER);
    const firstSettled = first.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
    await gate.entered.promise;
    const preflight = f.nextBirthdayPreflight(), second = f.service.claimBirthdayReward(USER);
    const results = Promise.allSettled([firstSettled, second]);
    await preflight; gate.release.resolve();
    const [a, b] = await results;
    expect(a.status).toBe('fulfilled');
    if (a.status === 'fulfilled') expect(a.value.ok).toBe(true);
    expect(b.status).toBe('fulfilled');
    if (b.status === 'fulfilled') {
      expect(b.value).toMatchObject({ idempotentReplay: true, walletCredited: false,
        ledger: { walletAccountId: WALLET, direction: 'credit', ledgerType: 'birthday_bonus', idempotencyKey: KEY } });
      expect(new Decimal(b.value.ledger.amount).toString()).toBe('500');
    }
    expect(f.ledgers.filter(row => row.idempotencyKey === KEY)).toHaveLength(1);
    expect(f.wallets[0].cachedBalance.toString()).toBe('3000');
  });

  it.each(['ledger.create', 'wallet.update.afterIncrement'])('rolls back %s and permits one explicit retry', async point => {
    const f = fixture(); f.failNext(point);
    await expect(f.service.claimBirthdayReward(USER)).rejects.toThrow('Synthetic rollback');
    expect(f.ledgers).toHaveLength(1);
    expect(f.wallets[0].cachedBalance.toString()).toBe('2500');
    expect(f.events.filter(event => event.name === 'rollback')).toHaveLength(1);
    const result = await f.service.claimBirthdayReward(USER);
    expect(result.walletCredited).toBe(true);
    expect(f.ledgers.filter(row => row.idempotencyKey === KEY)).toHaveLength(1);
    expect(f.wallets[0].cachedBalance.toString()).toBe('3000');
  });

  it.each([
    ['status', 'unverified', 'identity_verification_required'],
    ['birthDate', null, 'verified_birthdate_required'],
    ['identitySubjectHash', null, 'identity_subject_hash_required'],
    ['birthDate', new Date('1990-10-08T00:00:00.000Z'), 'not_birthday_today'],
  ])('retains the existing %s/%s birthday eligibility rejection', async (field, value, reason) => {
    const f = fixture(); f.identity[String(field)] = value;
    await expect(f.service.claimBirthdayReward(USER)).rejects.toMatchObject({ response: {
      code: 'BIRTHDAY_REWARD_NOT_CLAIMABLE', details: { blockingReasons: expect.arrayContaining([reason]) } } });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.ledgers).toHaveLength(1);
  });

  it('keeps an already committed annual claim not claimable at the original preflight', async () => {
    const f = fixture(2000); f.seed(500, { idempotencyKey: KEY, ledgerType: 'birthday_bonus' });
    await expect(f.service.claimBirthdayReward(USER)).rejects.toMatchObject({ response: {
      code: 'BIRTHDAY_REWARD_NOT_CLAIMABLE', details: { blockingReasons: ['already_claimed_this_year'] } } });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.ledgers).toHaveLength(2);
  });

  it('preserves the original missing-wallet upsert rather than inventing a new wallet policy', async () => {
    const f = fixture(0); f.wallets.splice(0);
    const result = await f.service.claimBirthdayReward(USER);
    expect(result.walletCredited).toBe(true);
    expect(f.wallets).toHaveLength(1);
    expect(f.wallets[0]).toMatchObject({ userId: USER, currencyCode: 'LUMINA', status: 'active' });
    expect(f.wallets[0].cachedBalance.toString()).toBe('500');
  });

  it('retains the native active-user rejection before any birthday transaction', async () => {
    const f = fixture(); f.user.status = 'suspended';
    await expect(f.service.claimBirthdayReward(USER)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(f.ledgers).toHaveLength(1);
  });
});
