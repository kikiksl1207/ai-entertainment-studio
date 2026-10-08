import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { RewardsService } from './rewards.service';

const USER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const AT = new Date('2026-10-03T01:00:00.000Z');
const SERVICE_DATE = new Date('2026-10-03T00:00:00.000Z');

type Row = Record<string, any>;
type UserRow = {
  id: string; status: string; deletedAt: Date | null; phoneNumber: string | null;
  profile: { bio: string | null; avatarAssetId: string | null; coverAssetId: string | null };
  identityVerification: null;
};
type WalletRow = { id: string; userId: string; currencyCode: string; status: string; cachedBalance: Decimal };
type LedgerRow = {
  id: string; walletAccountId: string; direction: string; amount: Decimal;
  ledgerType: string; referenceType: string; referenceId: string;
  idempotencyKey: string; memo: string | null; createdAt: Date;
};
type AttendanceRow = {
  id: string; userId: string; serviceDate: Date; rewardLumina: Decimal;
  walletLedgerId: string | null; idempotencyKey: string; createdAt: Date;
};
type Event = { tx: number | null; name: string; args?: Row };
type Context = {
  id: number; ledgers: LedgerRow[]; attendances: AttendanceRow[]; increments: Map<string, Decimal>;
  releases: Array<() => void>; held: Set<string>;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, wanted]) => {
    if (wanted === undefined) return true;
    if (key === 'AND') return (Array.isArray(wanted) ? wanted : [wanted]).every(item => matches(row, item));
    if (key === 'OR') return wanted.some((item: Row) => matches(row, item));
    if (key === 'NOT') return !(Array.isArray(wanted) ? wanted : [wanted]).some(item => matches(row, item));
    if (key === 'is') return matches(row, wanted);
    const actual = row[key];
    if (wanted && typeof wanted === 'object' && !(wanted instanceof Date) && !(wanted instanceof Decimal)) {
      return Object.entries(wanted).every(([operator, value]) => {
        if (operator === 'in') return (value as unknown[]).includes(actual);
        if (operator === 'not') return actual !== value;
        if (operator === 'equals') return actual === value;
        if (operator === 'startsWith') return typeof actual === 'string' && actual.startsWith(String(value));
        if (operator === 'gt') return new Decimal(actual).greaterThan(value as string);
        if (operator === 'gte') return new Decimal(actual).greaterThanOrEqualTo(value as string);
        if (operator === 'lt') return actual < (value as any);
        if (operator === 'lte') return actual <= (value as any);
        return matches(actual ?? {}, { [operator]: value });
      });
    }
    return wanted instanceof Date
      ? actual instanceof Date && actual.getTime() === wanted.getTime()
      : actual === wanted;
  });
}

function fixture() {
  const users: UserRow[] = [USER, OTHER].map(id => ({
    id, status: 'active', deletedAt: null, phoneNumber: null,
    profile: { bio: 'Synthetic QA profile', avatarAssetId: null, coverAssetId: null },
    identityVerification: null,
  }));
  const wallets: WalletRow[] = [USER, OTHER].map((userId, index) => ({
    id: `10000000-0000-4000-8000-00000000000${index + 1}`, userId,
    currencyCode: 'LUMINA', status: 'active', cachedBalance: new Decimal(300),
  }));
  const counts = new Map([USER, OTHER].map(id => [id, {
    communityPost: 1, communityReaction: 1, communityReply: 1,
    artistFollow: 1, userFollow: 0, fanLetter: 0, artistBoostEvent: 0,
  }]));
  const ledgers: LedgerRow[] = [];
  const attendances: AttendanceRow[] = [];
  const events: Event[] = [];
  const queries: Array<{ tx: number; sql: string; values: unknown[] }> = [];
  const txClients: Row[] = [];
  const locks = new Map<string, Promise<void>>();
  const failures = new Map<string, Error>();
  const paidOrders: Row[] = [];
  let sequence = 0;
  let transactionSequence = 0;
  let onStart = () => {};
  let globalPromo: Decimal | undefined;
  let forbidGlobalReads = false;
  let nextCreditGate: ReturnType<typeof deferred> | undefined;
  let nextCreditEntered: ReturnType<typeof deferred> | undefined;

  const seed = (amount: number, overrides: Partial<LedgerRow> = {}) => {
    const row: LedgerRow = {
      id: `ledger-${++sequence}`, walletAccountId: wallets[0].id, direction: 'credit',
      amount: new Decimal(amount), ledgerType: 'signup_bonus', referenceType: 'user',
      referenceId: USER, idempotencyKey: `synthetic:${sequence}`, memo: null, createdAt: AT,
      ...overrides,
    };
    ledgers.push(row);
    return row;
  };
  const seedAttendance = (serviceDate: Date, userId = USER) => {
    const row: AttendanceRow = {
      id: `attendance-${++sequence}`, userId, serviceDate, rewardLumina: new Decimal(10),
      walletLedgerId: null,
      idempotencyKey: `daily_attendance:${userId}:${serviceDate.toISOString().slice(0, 10)}`,
      createdAt: AT,
    };
    attendances.push(row);
    return row;
  };
  const visibleAttendances = (ctx: Context | null, where: Row = {}) =>
    [...attendances, ...(ctx?.attendances ?? [])].filter(row => matches(row, where));
  const mark = (ctx: Context | null, name: string, args?: Row) => {
    events.push({ tx: ctx?.id ?? null, name, args });
    if (!ctx && forbidGlobalReads) throw new Error(`Unexpected global read: ${name}`);
  };
  const fail = (name: string) => {
    const error = failures.get(name);
    if (error) { failures.delete(name); throw error; }
  };
  const visibleLedgers = (ctx: Context | null, where: Row = {}) =>
    [...ledgers, ...(ctx?.ledgers ?? [])].filter(row => matches({
      ...row, walletAccount: wallets.find(wallet => wallet.id === row.walletAccountId),
    }, where));
  const walletCopy = (wallet: WalletRow, ctx: Context | null) => ({
    ...wallet, cachedBalance: wallet.cachedBalance.plus(ctx?.increments.get(wallet.id) ?? 0),
  });
  const userRead = (ctx: Context | null, args: Row) => {
    const user = users.find(row => matches(row, args.where));
    return user ? {
      ...user, profile: { ...user.profile },
      walletAccounts: wallets.filter(wallet => wallet.userId === user.id).map(wallet => walletCopy(wallet, ctx)),
    } : null;
  };
  const uniqueConflict = () => Object.assign(new Error('Synthetic unique idempotency conflict'), { code: 'P2002' });

  // Only explicit SQL locks serialize callers. Transaction reads see committed rows
  // plus their own writes; rollback discards only the failing transaction's overlay.
  const lock = async (ctx: Context, key: string) => {
    if (ctx.held.has(key)) return;
    const previous = locks.get(key) ?? Promise.resolve();
    const held = deferred();
    const tail = previous.then(() => held.promise);
    locks.set(key, tail);
    await previous;
    ctx.held.add(key);
    ctx.releases.push(() => {
      held.resolve();
      if (locks.get(key) === tail) locks.delete(key);
    });
  };

  const client = (ctx: Context | null): Row => {
    const read = (name: string, action: (args: Row) => unknown) => jest.fn(async (args: Row = {}) => {
      mark(ctx, name, args);
      return action(args);
    });
    const db: Row = {
      user: {
        findFirst: read('user.findFirst', args => userRead(ctx, args)),
        findUnique: read('user.findUnique', args => userRead(ctx, args)),
        findUniqueOrThrow: read('user.findUniqueOrThrow', args => {
          const row = userRead(ctx, args);
          if (!row) throw Object.assign(new Error('User not found'), { code: 'P2025' });
          return row;
        }),
      },
      walletLedger: {
        findUnique: read('walletLedger.findUnique', args => visibleLedgers(ctx, args.where)[0] ?? null),
        findFirst: read('walletLedger.findFirst', args => visibleLedgers(ctx, args.where)[0] ?? null),
        findMany: read('walletLedger.findMany', args => visibleLedgers(ctx, args.where).map(row =>
          args.select ? Object.fromEntries(Object.entries(args.select)
            .filter(([, selected]) => selected === true)
            .map(([key]) => [key, row[key as keyof LedgerRow]])) : { ...row },
        )),
        aggregate: read('walletLedger.aggregate', args => ({ _sum: { amount:
          !ctx && globalPromo !== undefined && args.where?.ledgerType !== 'first_charge_bonus'
            ? globalPromo
            : visibleLedgers(ctx, args.where).reduce((sum, row) => sum.plus(row.amount), new Decimal(0)),
        } })),
        create: jest.fn(async (args: Row) => {
          if (!ctx) throw new Error('Ledger write outside transaction');
          mark(ctx, 'walletLedger.create', args);
          if (nextCreditGate && nextCreditEntered) {
            const gate = nextCreditGate;
            nextCreditEntered.resolve();
            nextCreditGate = undefined;
            nextCreditEntered = undefined;
            await gate.promise;
          }
          fail('walletLedger.create');
          if (visibleLedgers(ctx, { idempotencyKey: args.data.idempotencyKey }).length) throw uniqueConflict();
          const row = { id: `ledger-${++sequence}`, createdAt: AT, ...args.data } as LedgerRow;
          ctx.ledgers.push(row);
          return { ...row };
        }),
      },
      walletAccount: {
        findUnique: read('walletAccount.findUnique', args => {
          const where = args.where.userId_currencyCode ?? args.where;
          const wallet = wallets.find(row => matches(row, where));
          return wallet ? walletCopy(wallet, ctx) : null;
        }),
        findFirst: read('walletAccount.findFirst', args => {
          const wallet = wallets.find(row => matches(row, args.where));
          return wallet ? walletCopy(wallet, ctx) : null;
        }),
        update: jest.fn(async (args: Row) => {
          if (!ctx) throw new Error('Wallet write outside transaction');
          mark(ctx, 'walletAccount.update', args);
          fail('walletAccount.update');
          const wallet = wallets.find(row => matches(row, args.where));
          if (!wallet) throw new Error('Wallet not found');
          const increment = new Decimal(args.data.cachedBalance.increment);
          ctx.increments.set(wallet.id, (ctx.increments.get(wallet.id) ?? new Decimal(0)).plus(increment));
          fail('walletAccount.update.afterUpdate');
          return walletCopy(wallet, ctx);
        }),
      },
      paymentOrder: { findMany: read('paymentOrder.findMany', args => paidOrders.filter(row => matches(row, args.where))) },
      dailyAttendanceReward: {
        findUnique: read('dailyAttendanceReward.findUnique', args =>
          visibleAttendances(ctx, args.where.userId_serviceDate ?? args.where)[0] ?? null),
        findMany: read('dailyAttendanceReward.findMany', args =>
          visibleAttendances(ctx, args.where).sort((a, b) =>
            b.serviceDate.getTime() - a.serviceDate.getTime()).slice(0, args.take)),
        create: jest.fn(async (args: Row) => {
          if (!ctx) throw new Error('Attendance write outside transaction');
          mark(ctx, 'dailyAttendanceReward.create', args);
          fail('dailyAttendanceReward.create');
          if (visibleAttendances(ctx).some(row => row.idempotencyKey === args.data.idempotencyKey ||
              (row.userId === args.data.userId && row.serviceDate.getTime() === args.data.serviceDate.getTime()))) {
            throw uniqueConflict();
          }
          const row = { id: `attendance-${++sequence}`, createdAt: AT, ...args.data } as AttendanceRow;
          ctx.attendances.push(row);
          fail('dailyAttendanceReward.create.afterInsert');
          return { ...row };
        }),
      },
      $queryRaw: jest.fn(async (strings: TemplateStringsArray | { strings: string[]; values: unknown[] }, ...values: unknown[]) => {
        if (!ctx) throw new Error('Lock outside transaction');
        const fragments = 'strings' in strings ? strings.strings : strings;
        const sql = Array.from(fragments).join('?').replace(/"/g, '').replace(/\s+/g, ' ').trim();
        const parameters = 'strings' in strings ? strings.values : values;
        queries.push({ tx: ctx.id, sql, values: parameters });
        if (/FROM (?:public\.)?users\b/i.test(sql) && /FOR NO KEY UPDATE\b/i.test(sql)) {
          fail('lock.user');
          await lock(ctx, `user:${parameters[0]}`);
          mark(ctx, 'lock.user');
          return users.filter(row => row.id === parameters[0]
            && (!/status\s*=\s*'active'/i.test(sql) || row.status === 'active')
            && (!/deleted_at IS NULL/i.test(sql) || row.deletedAt === null)).map(row => ({ ...row }));
        }
        if (/FROM (?:public\.)?wallet_accounts\b/i.test(sql) && /FOR UPDATE\b/i.test(sql)) {
          fail('lock.wallet');
          const rows = wallets.filter(row => /\buser_id\s*=/i.test(sql)
            ? row.userId === parameters[0] && row.currencyCode === (parameters[1] ?? 'LUMINA')
            : row.id === parameters[0]);
          for (const row of rows) await lock(ctx, `wallet:${row.id}`);
          mark(ctx, 'lock.wallet');
          return rows.filter(row => !/status\s*=\s*'active'/i.test(sql) || row.status === 'active').map(row => walletCopy(row, ctx));
        }
        throw new Error(`Unexpected transaction SQL: ${sql}`);
      }),
    };
    for (const name of ['communityPost', 'communityReaction', 'communityReply', 'artistFollow', 'userFollow', 'fanLetter', 'artistBoostEvent'] as const) {
      db[name] = { count: read(`${name}.count`, args => {
        const id = args.where.authorUserId ?? args.where.followerUserId ?? args.where.senderUserId ?? args.where.userId;
        return counts.get(id)?.[name] ?? 0;
      }) };
    }
    return db;
  };

  const prisma = client(null);
  prisma.$transaction = jest.fn(async (callback: (db: Row) => Promise<unknown>) => {
    onStart();
    const ctx: Context = { id: ++transactionSequence, ledgers: [], attendances: [], increments: new Map(), releases: [], held: new Set() };
    const tx = client(ctx);
    txClients.push(tx);
    try {
      const result = await callback(tx);
      fail('transaction.commit');
      if (ctx.ledgers.some(row => ledgers.some(committed => committed.idempotencyKey === row.idempotencyKey))) throw uniqueConflict();
      if (ctx.attendances.some(row => attendances.some(committed =>
          committed.idempotencyKey === row.idempotencyKey ||
          (committed.userId === row.userId && committed.serviceDate.getTime() === row.serviceDate.getTime())))) {
        throw uniqueConflict();
      }
      ledgers.push(...ctx.ledgers);
      attendances.push(...ctx.attendances);
      for (const [id, increment] of ctx.increments) {
        const wallet = wallets.find(row => row.id === id)!;
        wallet.cachedBalance = wallet.cachedBalance.plus(increment);
      }
      events.push({ tx: ctx.id, name: 'commit' });
      return result;
    } catch (error) {
      events.push({ tx: ctx.id, name: 'rollback' });
      throw error;
    } finally {
      for (const release of ctx.releases.reverse()) release();
    }
  });

  const service = new RewardsService(prisma as never);
  const date = jest.spyOn(service as any, 'getKoreanServiceDate').mockReturnValue(SERVICE_DATE);
  return {
    users, wallets, counts, ledgers, attendances, events, queries, txClients, prisma, paidOrders, seed, seedAttendance,
    service, setDate: (value: Date) => { date.mockReturnValue(value); },
    onStart: (hook: () => void) => { onStart = hook; },
    staleGlobalPromo: (amount: number) => { globalPromo = new Decimal(amount); },
    forbidGlobalReads: () => { forbidGlobalReads = true; },
    failNext: (point: string, error: Error) => { failures.set(point, error); },
    pauseNextCredit: () => {
      const entered = deferred();
      const gate = deferred();
      nextCreditEntered = entered;
      nextCreditGate = gate;
      return { entered: entered.promise, release: gate.resolve };
    },
  };
}

type Fixture = ReturnType<typeof fixture>;

function noCredit(f: Fixture) {
  expect(f.events.filter(event => ['walletLedger.create', 'walletAccount.update', 'dailyAttendanceReward.create'].includes(event.name))).toEqual([]);
  expect(f.wallets[0]?.cachedBalance.toString()).toBe('300');
}

function expectLocks(f: Fixture, tx: number) {
  const events = f.events.filter(event => event.tx === tx).map(event => event.name);
  const userLock = events.indexOf('lock.user');
  const walletLock = events.indexOf('lock.wallet');
  expect(userLock).toBeGreaterThanOrEqual(0);
  expect(walletLock).toBeGreaterThan(userLock);
  for (const [index, name] of events.entries()) {
    if (/^(walletLedger\.|walletAccount\.|dailyAttendanceReward\.|community|artistFollow|userFollow|fanLetter|artistBoostEvent)/.test(name)) {
      expect(index).toBeGreaterThan(walletLock);
    }
    if (/^user\./.test(name)) expect(index).toBeGreaterThan(userLock);
  }
  const queries = f.queries.filter(query => query.tx === tx);
  expect(queries[0]).toMatchObject({ sql: expect.stringMatching(/WHERE id\s*=\s*\?.*FOR NO KEY UPDATE\b/i), values: [USER] });
  expect(queries[1].sql).toMatch(/WHERE (?:user_id|id)\s*=\s*\?.*FOR UPDATE\b/i);
  expect(queries[1].values).toContain(queries[1].sql.includes('user_id') ? USER : f.wallets[0].id);
}

async function deadline<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 1500);
    })]);
  } finally { clearTimeout(timer); }
}

describe('Rewards attendance atomic contract (synthetic transactions; no PostgreSQL)', () => {
  jest.setTimeout(5000);

  it('reads eligibility, replay, streak, cap and wallet only after user then wallet locks', async () => {
    const f = fixture();
    f.forbidGlobalReads();
    f.staleGlobalPromo(0);
    f.seed(2990);
    const result = await f.service.claimDailyAttendance(USER);
    expectLocks(f, 1);
    expect(f.events.filter(event => event.tx === null)).toEqual([]);
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted' });
    expect(result).toMatchObject({
      idempotentReplay: false, streak: { day: 1, cycleDay: 1, cycleLength: 7 },
      policy: { resetTimezone: 'Asia/Seoul', startedAt: '2026-05-05',
        antiAbuse: { oneClaimPerServiceDate: true, freePromoRewardCapLumina: 3000 } },
    });
    expect(result.reward).toMatchObject({
      userId: USER, serviceDate: SERVICE_DATE,
      idempotencyKey: `daily_attendance:${USER}:2026-10-03`,
    });
    expect(result.reward.rewardLumina.toString()).toBe('10');
    expect(f.ledgers[1]).toMatchObject({
      walletAccountId: f.wallets[0].id, direction: 'credit', ledgerType: 'daily_attendance',
      referenceType: 'user', referenceId: USER, memo: 'Daily attendance reward day 1',
      idempotencyKey: `daily_attendance:${USER}:2026-10-03`,
    });
    expect(f.ledgers[1].id).toBe(result.reward.walletLedgerId);
    expect(f.wallets.map(wallet => wallet.cachedBalance.toString())).toEqual(['310', '300']);
    const reads = f.events.filter(event => event.tx === 1).map(event => event.name);
    expect(reads.indexOf('user.findFirst')).toBeGreaterThan(reads.indexOf('lock.wallet'));
    expect(reads.indexOf('dailyAttendanceReward.findMany')).toBeLessThan(reads.indexOf('walletLedger.aggregate'));
    expect(f.txClients[0].dailyAttendanceReward.findMany).toHaveBeenCalledWith({
      where: { userId: USER, serviceDate: { lt: SERVICE_DATE } }, orderBy: { serviceDate: 'desc' }, take: 30,
    });
  });

  it.each(['missing', 'suspended', 'deleted'])('rechecks a user becoming %s at transaction admission', async state => {
    const f = fixture();
    f.onStart(() => {
      if (state === 'missing') f.users.shift();
      if (state === 'suspended') f.users[0].status = 'suspended';
      if (state === 'deleted') f.users[0].deletedAt = AT;
    });
    await expect(f.service.claimDailyAttendance(USER)).rejects.toMatchObject({
      response: { message: 'Active user not found' },
    });
    noCredit(f);
    expect(f.attendances).toHaveLength(0);
    expect(f.events.filter(event => event.name === 'dailyAttendanceReward.findUnique')).toHaveLength(0);
  });

  it('keeps the seven-day schedule and cycles to ten Lumina on day eight', async () => {
    const f = fixture();
    for (let day = 0; day < 8; day += 1) {
      f.setDate(new Date(SERVICE_DATE.getTime() + day * 86400000));
      const result = await f.service.claimDailyAttendance(USER);
      expect(result.reward.rewardLumina.toString()).toBe(String([10, 10, 20, 20, 20, 20, 50, 10][day]));
      expect(result).toMatchObject({ streak: { day: day + 1, cycleDay: day % 7 + 1, cycleLength: 7 } });
    }
    expect(f.wallets[0].cachedBalance.toString()).toBe('460');
    expect(f.attendances).toHaveLength(8);
    expect(f.service.getDailyAttendancePolicy().schedule.map(item => item.rewardLumina)).toEqual([10, 10, 20, 20, 20, 20, 50]);
  });

  it('uses only consecutive prior dates for the current user, not a gap or another user', async () => {
    const f = fixture();
    f.seedAttendance(new Date('2026-10-01T00:00:00.000Z'));
    f.seedAttendance(new Date('2026-10-02T00:00:00.000Z'), OTHER);
    const first = await f.service.claimDailyAttendance(USER);
    expect(first).toMatchObject({ streak: { day: 1, cycleDay: 1 } });
    f.setDate(new Date('2026-10-04T00:00:00.000Z'));
    const next = await f.service.claimDailyAttendance(USER);
    expect(next).toMatchObject({ streak: { day: 2, cycleDay: 2 } });
    expect(f.attendances.filter(row => row.userId === OTHER)).toHaveLength(1);
    expect(f.wallets[1].cachedBalance.toString()).toBe('300');
  });

  it('returns one daily receipt and one increment for simultaneous same-key requests', async () => {
    const f = fixture();
    const results = await Promise.all([
      f.service.claimDailyAttendance(USER), f.service.claimDailyAttendance(USER),
    ]);
    expect(results.map(result => result.idempotentReplay).sort()).toEqual([false, true]);
    expect(results[0].reward.id).toBe(results[1].reward.id);
    expect(results[0].reward.createdAt).toEqual(results[1].reward.createdAt);
    expect(f.attendances).toHaveLength(1);
    expect(f.ledgers).toHaveLength(1);
    expect(f.wallets[0].cachedBalance.toString()).toBe('310');
    expect(f.events.filter(event => event.name === 'walletAccount.update')).toHaveLength(1);
    expectLocks(f, 1);
    expectLocks(f, 2);
  });

  it('preserves existing replay before cap, streak and wallet validation, without another write', async () => {
    const f = fixture();
    const first = await f.service.claimDailyAttendance(USER);
    f.seed(2990);
    f.wallets[0].status = 'frozen';
    const offset = f.events.length;
    const replay = await f.service.claimDailyAttendance(USER);
    expect(replay).toEqual({ reward: first.reward, idempotentReplay: true, policy: f.service.getDailyAttendancePolicy() });
    expect(f.events.slice(offset).map(event => event.name)).toEqual([
      'lock.user', 'lock.wallet', 'user.findFirst', 'dailyAttendanceReward.findUnique', 'commit',
    ]);
    expect(f.attendances).toHaveLength(1);
    expect(f.ledgers).toHaveLength(2);
    expect(f.wallets[0].cachedBalance.toString()).toBe('310');
    f.users[0].status = 'suspended';
    await expect(f.service.claimDailyAttendance(USER)).rejects.toMatchObject({
      response: { message: 'Active user not found' },
    });
    expect(f.attendances).toHaveLength(1);
  });

  it.each(['attendance', 'activation'])('shares the remaining cap with activation when %s holds the first lock', async firstWriter => {
    const f = fixture();
    f.seed(2990);
    f.forbidGlobalReads();
    const started = deferred();
    let starts = 0;
    f.onStart(() => { if (++starts === 2) started.resolve(); });
    const gate = f.pauseNextCredit();
    const attendance = () => f.service.claimDailyAttendance(USER);
    const activation = () => f.service.claimActivationQuest(USER, 'first_feed_like');
    const first = firstWriter === 'attendance' ? attendance() : activation();
    let second!: Promise<unknown>;
    let waitingQueries = 0;
    let waitingEvents: Event[] = [];
    try {
      await deadline(gate.entered, 'First synthetic credit did not arrive');
      second = firstWriter === 'attendance' ? activation() : attendance();
      await deadline(started.promise, 'Second synthetic transaction did not arrive');
      waitingQueries = f.queries.filter(query => query.tx === 2).length;
      waitingEvents = f.events.filter(event => event.tx === 2);
    } finally { gate.release(); }
    const results = await Promise.allSettled([first, second]);
    expect(waitingQueries).toBe(1);
    expect(waitingEvents).toEqual([]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({
      response: { code: 'FREE_PROMO_REWARD_CAP_EXCEEDED' },
    });
    expect(f.ledgers.reduce((sum, row) => sum.plus(row.amount), new Decimal(0)).toString()).toBe('3000');
    expect(f.wallets[0].cachedBalance.toString()).toBe('310');
    expectLocks(f, 1);
    expectLocks(f, 2);
  });

  it('allows an unrelated user to claim while the first user holds the wallet lock', async () => {
    const f = fixture();
    const gate = f.pauseNextCredit();
    const first = f.service.claimDailyAttendance(USER);
    try {
      await deadline(gate.entered, 'First synthetic credit did not arrive');
      const other = await deadline(f.service.claimDailyAttendance(OTHER), 'Unrelated user was serialized');
      expect(other.idempotentReplay).toBe(false);
      expect(f.wallets.map(wallet => wallet.cachedBalance.toString())).toEqual(['300', '310']);
    } finally { gate.release(); await first; }
    expect(f.attendances.map(row => row.userId).sort()).toEqual([USER, OTHER].sort());
  });

  it.each(['missing', 'frozen'])('keeps the active-wallet error for a %s wallet without writes', async state => {
    const f = fixture();
    if (state === 'missing') f.wallets.shift();
    else f.wallets[0].status = 'frozen';
    await expect(f.service.claimDailyAttendance(USER)).rejects.toMatchObject({
      response: { message: 'Active wallet not found' },
    });
    expect(f.ledgers).toHaveLength(0);
    expect(f.attendances).toHaveLength(0);
    expect(f.events.filter(event => ['walletLedger.create', 'walletAccount.update', 'dailyAttendanceReward.create'].includes(event.name))).toEqual([]);
  });

  it('keeps the exact cap error and cap-before-wallet precedence', async () => {
    const f = fixture();
    f.seed(2991);
    f.wallets[0].status = 'frozen';
    await expect(f.service.claimDailyAttendance(USER)).rejects.toMatchObject({
      response: {
        code: 'FREE_PROMO_REWARD_CAP_EXCEEDED',
        message: 'Free promotional reward cap would be exceeded',
        details: { capLumina: '3000', earnedLumina: '2991', remainingLumina: '9',
          requestedLumina: '10', ledgerType: 'daily_attendance' },
      },
    });
    noCredit(f);
    expect(f.ledgers).toHaveLength(1);
    expect(f.attendances).toHaveLength(0);
  });

  it.each(['walletAccount.update', 'walletAccount.update.afterUpdate',
    'dailyAttendanceReward.create', 'dailyAttendanceReward.create.afterInsert', 'transaction.commit'])
  ('rolls back after a ledger insert at %s and recovers only on explicit retry', async point => {
    const f = fixture();
    const error = new Error('Synthetic controlled rollback');
    f.failNext(point, error);
    await expect(f.service.claimDailyAttendance(USER)).rejects.toBe(error);
    expect(f.ledgers).toHaveLength(0);
    expect(f.attendances).toHaveLength(0);
    expect(f.wallets.map(wallet => wallet.cachedBalance.toString())).toEqual(['300', '300']);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(f.events.some(event => event.name === 'walletLedger.create')).toBe(true);
    const recovered = await f.service.claimDailyAttendance(USER);
    expect(recovered.idempotentReplay).toBe(false);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(f.ledgers).toHaveLength(1);
    expect(f.attendances).toHaveLength(1);
    expect(f.wallets.map(wallet => wallet.cachedBalance.toString())).toEqual(['310', '300']);
  });

  it('keeps the existing progress read consistent with the committed daily receipt', async () => {
    const f = fixture();
    const result = await f.service.claimDailyAttendance(USER);
    const progress = await f.service.getActivationProgress(USER);
    expect(progress.progress.attendance).toMatchObject({ claimedToday: true,
      recent: [expect.objectContaining({ id: result.reward.id, serviceDate: SERVICE_DATE })] });
    expect(progress.caps.freePromo).toMatchObject({ capLumina: '3000', earnedLumina: '10', remainingLumina: '2990' });
  });
});
