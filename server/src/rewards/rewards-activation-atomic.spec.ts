import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { RewardsService } from './rewards.service';

const USER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const AT = new Date('2026-10-03T01:00:00.000Z');
const QUESTS = [
  ['profile_basic_setup', 30, 'profile_completion_reward'],
  ['first_feed_post', 20, 'quest_reward'],
  ['first_feed_like', 10, 'quest_reward'],
  ['first_follow', 10, 'quest_reward'],
  ['first_reply', 20, 'quest_reward'],
] as const;

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
type Event = { tx: number | null; name: string; args?: Row };
type Context = {
  id: number; ledgers: LedgerRow[]; increments: Map<string, Decimal>;
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
    return actual === wanted;
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
          return walletCopy(wallet, ctx);
        }),
      },
      paymentOrder: { findMany: read('paymentOrder.findMany', args => paidOrders.filter(row => matches(row, args.where))) },
      dailyAttendanceReward: { findMany: read('dailyAttendanceReward.findMany', () => []) },
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
    const ctx: Context = { id: ++transactionSequence, ledgers: [], increments: new Map(), releases: [], held: new Set() };
    const tx = client(ctx);
    txClients.push(tx);
    try {
      const result = await callback(tx);
      fail('transaction.commit');
      if (ctx.ledgers.some(row => ledgers.some(committed => committed.idempotencyKey === row.idempotencyKey))) throw uniqueConflict();
      ledgers.push(...ctx.ledgers);
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

  return {
    users, wallets, counts, ledgers, events, queries, txClients, prisma, paidOrders, seed,
    service: new RewardsService(prisma as never),
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
  expect(f.events.filter(event => ['walletLedger.create', 'walletAccount.update'].includes(event.name))).toEqual([]);
  expect(f.wallets[0]?.cachedBalance.toString()).toBe('300');
}

function expectLocks(f: Fixture, tx: number) {
  const events = f.events.filter(event => event.tx === tx).map(event => event.name);
  const userLock = events.indexOf('lock.user');
  const walletLock = events.indexOf('lock.wallet');
  expect(userLock).toBeGreaterThanOrEqual(0);
  expect(walletLock).toBeGreaterThan(userLock);
  for (const [index, name] of events.entries()) {
    if (/^(walletLedger\.|community|artistFollow|userFollow|fanLetter|artistBoostEvent)/.test(name)) {
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

describe('Rewards activation atomic contract (synthetic transactions; no PostgreSQL)', () => {
  jest.setTimeout(5000);

  it.each(QUESTS)('credits the frozen %s amount once with its exact ledger scope', async (code, amount, ledgerType) => {
    const f = fixture();
    f.seed(300);
    const result = await f.service.claimActivationQuest(USER, code);
    expect(result).toMatchObject({ idempotentReplay: false, walletCredited: true,
      quest: { code, rewardLumina: amount, completed: true, claimStatus: 'claimed' },
      caps: { freePromo: { capLumina: '3000', earnedLumina: String(300 + amount), remainingLumina: String(2700 - amount) } },
      policy: { claimableCodes: QUESTS.map(item => item[0]), oneTimePerUser: true, capScope: 'free_promo', freePromoRewardCapLumina: 3000 },
    });
    expect(result.ledger).toMatchObject({ walletAccountId: f.wallets[0].id, direction: 'credit', ledgerType,
      referenceType: 'user', referenceId: USER, idempotencyKey: `activation_quest:${USER}:${code}` });
    expect(result.ledger.amount.toString()).toBe(String(amount));
    expect(f.ledgers).toHaveLength(2);
    expect(f.wallets.map(wallet => wallet.cachedBalance.toString())).toEqual([String(300 + amount), '300']);
  });

  it.each(['unknown', '__proto__', 'constructor', 'identity_verification_bonus', 'birthday_verified_annual', 'first_charge_bonus'])('rejects unsupported code %s without writes', async code => {
    const f = fixture();
    await expect(f.service.claimActivationQuest(USER, code)).rejects.toMatchObject({ response: { code: 'ACTIVATION_QUEST_NOT_CLAIMABLE' } });
    noCredit(f);
  });

  it.each(QUESTS)('rejects incomplete %s rather than granting by request alone', async code => {
    const f = fixture();
    f.users[0].profile.bio = null;
    for (const name of Object.keys(f.counts.get(USER)!)) f.counts.get(USER)![name as keyof NonNullable<ReturnType<typeof f.counts.get>>] = 0;
    await expect(f.service.claimActivationQuest(USER, code)).rejects.toMatchObject({ response: { code: 'ACTIVATION_QUEST_NOT_COMPLETED' } });
    noCredit(f);
  });

  it.each(['missing', 'inactive', 'deleted'])('rejects an initially %s user', async state => {
    const f = fixture();
    if (state === 'missing') f.users.shift();
    if (state === 'inactive') f.users[0].status = 'inactive';
    if (state === 'deleted') f.users[0].deletedAt = AT;
    await expect(f.service.claimActivationQuest(USER, 'first_feed_like')).rejects.toBeInstanceOf(BadRequestException);
    noCredit(f);
  });

  it.each(['missing', 'inactive', 'deleted'])('rechecks the user becoming %s before transaction admission', async state => {
    const f = fixture();
    f.onStart(() => {
      if (state === 'missing') f.users.splice(f.users.findIndex(user => user.id === USER), 1);
      if (state === 'inactive') f.users[0].status = 'inactive';
      if (state === 'deleted') f.users[0].deletedAt = AT;
    });
    await expect(f.service.claimActivationQuest(USER, 'first_feed_like')).rejects.toBeInstanceOf(BadRequestException);
    noCredit(f);
  });

  it.each(['missing', 'inactive', 'frozen'])('rejects a %s wallet without a ledger or balance write', async state => {
    const f = fixture();
    if (state === 'missing') f.wallets.shift();
    else f.wallets[0].status = state;
    await expect(f.service.claimActivationQuest(USER, 'first_feed_like')).rejects.toBeInstanceOf(BadRequestException);
    expect(f.ledgers).toHaveLength(0);
    expect(f.events.filter(event => event.name === 'walletLedger.create' || event.name === 'walletAccount.update')).toHaveLength(0);
  });

  it('replays a committed code even after evidence is removed and the cap is full', async () => {
    const f = fixture();
    const first = await f.service.claimActivationQuest(USER, 'first_feed_like');
    f.counts.get(USER)!.communityReaction = 0;
    f.seed(2990);
    const progress = await f.service.getActivationProgress(USER);
    expect(progress.milestoneStatus.find(item => item.code === 'first_feed_like')).toMatchObject({
      code: 'first_feed_like', rewardLumina: 10, completed: false, claimStatus: 'claimed',
    });
    expect(progress.caps.freePromo).toMatchObject({ earnedLumina: '3000', remainingLumina: '0' });
    const replay = await f.service.claimActivationQuest(USER, 'first_feed_like');
    expect(replay).toMatchObject({ idempotentReplay: true, walletCredited: false,
      ledger: { id: first.ledger.id }, quest: { code: 'first_feed_like', completed: false, claimStatus: 'claimed' },
      caps: { freePromo: { earnedLumina: '3000', remainingLumina: '0' } } });
    expect(f.events.filter(event => event.name === 'walletLedger.create')).toHaveLength(1);
    expect(f.events.filter(event => event.name === 'walletAccount.update')).toHaveLength(1);
    expect(f.wallets[0].cachedBalance.toString()).toBe('310');
    expectLocks(f, 2);
  });

  it('returns a successful same-code concurrent replay instead of a unique-key error', async () => {
    const f = fixture();
    const results = await Promise.allSettled([
      f.service.claimActivationQuest(USER, 'first_feed_like'),
      f.service.claimActivationQuest(USER, 'first_feed_like'),
    ]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const values = results.map(result => (result as PromiseFulfilledResult<Row>).value);
    expect(values.map(result => result.idempotentReplay).sort()).toEqual([false, true]);
    expect(values.map(result => result.walletCredited).sort()).toEqual([false, true]);
    expect(values[0].ledger.id).toBe(values[1].ledger.id);
    expect(f.ledgers).toHaveLength(1);
    expect(f.wallets[0].cachedBalance.toString()).toBe('310');
  });

  it.each(['wallet', 'direction', 'amount', 'ledgerType'])('rejects a committed replay with mismatched %s', async field => {
    const f = fixture();
    const existing = f.seed(10, { ledgerType: 'quest_reward', idempotencyKey: `activation_quest:${USER}:first_feed_like` });
    if (field === 'wallet') existing.walletAccountId = f.wallets[1].id;
    if (field === 'direction') existing.direction = 'debit';
    if (field === 'amount') existing.amount = new Decimal(11);
    if (field === 'ledgerType') existing.ledgerType = 'purchase';
    await expect(f.service.claimActivationQuest(USER, 'first_feed_like')).rejects.toBeInstanceOf(BadRequestException);
    noCredit(f);
    expect(f.ledgers).toHaveLength(1);
  });

  it.each(['inactive_user', 'deleted_user', 'inactive_wallet', 'missing_wallet'])('does not bypass %s validation for an existing claim', async state => {
    const f = fixture();
    f.seed(10, { ledgerType: 'quest_reward', idempotencyKey: `activation_quest:${USER}:first_feed_like` });
    if (state === 'inactive_user') f.users[0].status = 'inactive';
    if (state === 'deleted_user') f.users[0].deletedAt = AT;
    if (state === 'inactive_wallet') f.wallets[0].status = 'inactive';
    if (state === 'missing_wallet') f.wallets.shift();
    await expect(f.service.claimActivationQuest(USER, 'first_feed_like')).rejects.toBeInstanceOf(BadRequestException);
    expect(f.ledgers).toHaveLength(1);
    expect(f.events.filter(event => event.name === 'walletLedger.create' || event.name === 'walletAccount.update')).toHaveLength(0);
  });

  it('serializes different quests of the same wallet against the remaining promo cap', async () => {
    const f = fixture();
    f.seed(2990);
    const results = await Promise.allSettled([
      f.service.claimActivationQuest(USER, 'first_feed_like'),
      f.service.claimActivationQuest(USER, 'first_follow'),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ response: { code: 'FREE_PROMO_REWARD_CAP_EXCEEDED' } });
    expect(f.ledgers.reduce((sum, row) => sum.plus(row.amount), new Decimal(0)).toString()).toBe('3000');
    expect(f.wallets[0].cachedBalance.toString()).toBe('310');
  });

  it('does not serialize another user behind an unrelated held wallet', async () => {
    const f = fixture();
    const gate = f.pauseNextCredit();
    const first = f.service.claimActivationQuest(USER, 'first_feed_like');
    try {
      await deadline(gate.entered, 'First synthetic credit did not arrive');
      const second = await deadline(f.service.claimActivationQuest(OTHER, 'first_feed_like'), 'Unrelated wallet was serialized');
      expect(second.walletCredited).toBe(true);
      expect(f.wallets[1].cachedBalance.toString()).toBe('310');
      expect(f.wallets[0].cachedBalance.toString()).toBe('300');
    } finally { gate.release(); await first; }
  });

  it('rejects a new credit when fresh transaction rows exceed stale global headroom', async () => {
    const f = fixture();
    f.seed(2990);
    f.onStart(() => { f.seed(10, { ledgerType: 'daily_attendance' }); });
    await expect(f.service.claimActivationQuest(USER, 'first_feed_like')).rejects.toMatchObject({ response: {
      code: 'FREE_PROMO_REWARD_CAP_EXCEEDED', details: { capLumina: '3000', earnedLumina: '3000', remainingLumina: '0', requestedLumina: '10' },
    } });
    noCredit(f);
  });

  it('uses current transaction headroom when a stale global aggregate says the cap is full', async () => {
    const f = fixture();
    f.seed(2990);
    f.staleGlobalPromo(3000);
    const result = await f.service.claimActivationQuest(USER, 'first_feed_like');
    expect(result).toMatchObject({ walletCredited: true, caps: { freePromo: { earnedLumina: '3000', remainingLumina: '0' } } });
    expect(f.wallets[0].cachedBalance.toString()).toBe('310');
  });

  it.each(['profile_basic_setup', 'first_feed_post', 'first_feed_like', 'first_follow', 'first_reply'])('rechecks %s evidence inside the transaction', async code => {
    const f = fixture();
    f.onStart(() => {
      f.users[0].profile.bio = null;
      Object.assign(f.counts.get(USER)!, { communityPost: 0, communityReaction: 0, communityReply: 0, artistFollow: 0, userFollow: 0 });
    });
    await expect(f.service.claimActivationQuest(USER, code)).rejects.toMatchObject({ response: { code: 'ACTIVATION_QUEST_NOT_COMPLETED' } });
    noCredit(f);
  });

  it.each([2990, 2990.01, 3000, 3001])('enforces Decimal cap boundary at %s actual promo earned', async earned => {
    const f = fixture();
    f.seed(earned);
    if (earned === 2990) {
      const result = await f.service.claimActivationQuest(USER, 'first_feed_like');
      expect(result.caps.freePromo).toMatchObject({ earnedLumina: '3000', remainingLumina: '0' });
    } else {
      await expect(f.service.claimActivationQuest(USER, 'first_feed_like')).rejects.toMatchObject({ response: { code: 'FREE_PROMO_REWARD_CAP_EXCEEDED' } });
      noCredit(f);
    }
  });

  it('reports post-credit usedRate consistently with the returned earned and remaining cap amounts', async () => {
    const f = fixture();
    f.seed(2990);
    const result = await f.service.claimActivationQuest(USER, 'first_feed_like');
    expect(result.caps.freePromo).toMatchObject({ earnedLumina: '3000', remainingLumina: '0', usedRate: '100' });
  });

  it.each(['avatarAssetId', 'coverAssetId'] as const)('preserves profile completion through %s without a bio', async field => {
    const f = fixture();
    f.users[0].profile.bio = null;
    f.users[0].profile[field] = 'synthetic-asset';
    const result = await f.service.claimActivationQuest(USER, 'profile_basic_setup');
    expect(result.quest).toMatchObject({ completed: true, rewardLumina: 30 });
    expect(f.wallets[0].cachedBalance.toString()).toBe('330');
  });

  it('preserves first-follow completion through a user follow without an artist follow', async () => {
    const f = fixture();
    f.counts.get(USER)!.artistFollow = 0;
    f.counts.get(USER)!.userFollow = 1;
    const result = await f.service.claimActivationQuest(USER, 'first_follow');
    expect(result.quest).toMatchObject({ completed: true, rewardLumina: 10 });
    expect(f.wallets[0].cachedBalance.toString()).toBe('310');
  });

  it('includes legacy free promo credits but excludes paid bonuses, debits, other users and currencies', async () => {
    const f = fixture();
    f.wallets.push({ ...f.wallets[0], id: 'wallet-other-currency', currencyCode: 'KRW' });
    f.seed(2980);
    f.seed(10, { ledgerType: 'event_grant', idempotencyKey: 'signup_bonus:legacy' });
    f.seed(1000, { ledgerType: 'event_grant', idempotencyKey: 'unrelated:event' });
    f.seed(1000, { ledgerType: 'purchase' });
    f.seed(1000, { ledgerType: 'first_charge_bonus' });
    f.seed(1000, { direction: 'debit' });
    f.seed(1000, { walletAccountId: f.wallets[1].id, referenceId: OTHER });
    f.seed(1000, { walletAccountId: 'wallet-other-currency' });
    const result = await f.service.claimActivationQuest(USER, 'first_feed_like');
    expect(result.caps.freePromo).toMatchObject({ earnedLumina: '3000', remainingLumina: '0' });
    const promoReads = f.events.filter(event => event.tx !== null && event.name === 'walletLedger.aggregate' && event.args?.where.ledgerType !== 'first_charge_bonus');
    expect(promoReads.length).toBeGreaterThan(0);
    expect(promoReads[0].args).toMatchObject({ where: { direction: 'credit', walletAccount: { userId: USER, currencyCode: 'LUMINA' } }, _sum: { amount: true } });
  });

  it('takes user then wallet locks before authoritative reads and never reads the global client', async () => {
    const f = fixture();
    f.forbidGlobalReads();
    const progress = jest.spyOn(f.service, 'getActivationProgress');
    await f.service.claimActivationQuest(USER, 'first_feed_like');
    expectLocks(f, 1);
    expect(f.events.filter(event => event.tx === null)).toHaveLength(0);
    expect(progress).toHaveBeenCalledWith(USER, f.txClients[0]);
    expect(f.txClients[0]).not.toBe(f.prisma);
    expect(f.txClients[0].user.findFirst).not.toBe(f.prisma.user.findFirst);
    for (const name of ['user.findFirst', 'user.findUniqueOrThrow', 'walletLedger.findUnique', 'walletLedger.aggregate', 'communityReaction.count']) {
      expect(f.events.some(event => event.tx === 1 && event.name === name)).toBe(true);
    }
  });

  it('reads the entire real progress implementation from a supplied tx, including paid bonus and activity counts', async () => {
    const f = fixture();
    f.forbidGlobalReads();
    f.seed(750);
    f.seed(100, { ledgerType: 'first_charge_bonus' });
    f.paidOrders.push({ userId: USER, status: 'paid', luminaProduct: { luminaAmount: new Decimal(1000), bonusAmount: new Decimal(50) }, refunds: [], updatedAt: AT });
    const getProgress = f.service.getActivationProgress as (
      userId: string, db?: Prisma.TransactionClient,
    ) => ReturnType<RewardsService['getActivationProgress']>;
    const result = await f.prisma.$transaction((tx: Prisma.TransactionClient) => getProgress.call(f.service, USER, tx));
    expect(result.caps).toMatchObject({ freePromo: { earnedLumina: '750', remainingLumina: '2250' },
      paidBonus: { basePaidLumina: '1000', productBonusLumina: '50', firstChargeBonusLumina: '100', grantedBonusLumina: '150', capLumina: '200' } });
    expect(result.progress.counts).toMatchObject({ feedPosts: 1, feedLikes: 1, feedReplies: 1, followsTotal: 1 });
    expect(f.events.filter(event => event.tx === null)).toHaveLength(0);
    for (const name of ['user.findFirst', 'user.findUniqueOrThrow', 'paymentOrder.findMany', 'dailyAttendanceReward.findMany', 'communityPost.count', 'communityReaction.count', 'communityReply.count', 'artistFollow.count', 'userFollow.count', 'fanLetter.count', 'artistBoostEvent.count']) {
      expect(f.events.some(event => event.tx === 1 && event.name === name)).toBe(true);
    }
  });

  it('marks exactly the five committed claim keys as claimed on a subsequent progress read', async () => {
    const f = fixture();
    for (const [code, amount, ledgerType] of QUESTS) f.seed(amount, { ledgerType, idempotencyKey: `activation_quest:${USER}:${code}` });
    const result = await f.service.getActivationProgress(USER);
    expect(result.milestoneStatus.filter(item => QUESTS.some(([code]) => code === item.code)).map(item => [item.code, item.claimStatus])).toEqual(QUESTS.map(([code]) => [code, 'claimed']));
    const lookup = f.events.find(event => event.name === 'walletLedger.findMany');
    expect(lookup?.args?.where.idempotencyKey).toEqual({ in: QUESTS.map(([code]) => `activation_quest:${USER}:${code}`) });
    expect(result.milestoneStatus.find(item => item.code === 'identity_verification_bonus')?.claimStatus).toBe('planned_not_claimable');
    expect(result.milestoneStatus.find(item => item.code === 'first_charge_bonus')?.claimStatus).toBe('automatic_on_first_paid_order');
  });

  it.each(['amount', 'ledgerType'] as const)('does not mark a wrong-%s receipt claimed on progress read', async field => {
    const f = fixture();
    const existing = f.seed(10, {
      ledgerType: 'quest_reward', idempotencyKey: `activation_quest:${USER}:first_feed_like`,
    });
    if (field === 'amount') existing.amount = new Decimal(9);
    else existing.ledgerType = 'purchase';
    const before = { ...existing };

    const result = await f.service.getActivationProgress(USER);

    expect(result.milestoneStatus.find(item => item.code === 'first_feed_like')).toMatchObject({
      code: 'first_feed_like', rewardLumina: 10, completed: true, claimStatus: 'claimable_when_completed',
    });
    const lookup = f.events.find(event => event.name === 'walletLedger.findMany');
    expect(lookup?.args?.select).toEqual({ idempotencyKey: true, amount: true, ledgerType: true });
    const selectedRows = await f.prisma.walletLedger.findMany.mock.results[0].value;
    expect(selectedRows).toEqual([{
      idempotencyKey: existing.idempotencyKey, amount: existing.amount, ledgerType: existing.ledgerType,
    }]);
    expect(selectedRows[0].amount).toBe(existing.amount);
    expect(f.ledgers).toEqual([before]);
    expect(f.events.some(event => event.tx !== null)).toBe(false);
    noCredit(f);
  });

  it('does not mark foreign-user keys, unknown codes or prefix lookalikes as claimed', async () => {
    const f = fixture();
    f.seed(10, { walletAccountId: f.wallets[1].id, referenceId: OTHER, ledgerType: 'quest_reward', idempotencyKey: `activation_quest:${OTHER}:first_feed_like` });
    f.seed(10, { ledgerType: 'quest_reward', idempotencyKey: `activation_quest:${USER}:first_feed_like:extra` });
    f.seed(10, { ledgerType: 'quest_reward', idempotencyKey: `activation_quest:${USER}:unknown` });
    const result = await f.service.getActivationProgress(USER);
    expect(result.milestoneStatus.filter(item => QUESTS.some(([code]) => code === item.code)).map(item => item.claimStatus)).toEqual(QUESTS.map(() => 'claimable_when_completed'));
    expect(f.events.filter(event => event.name === 'walletLedger.create' || event.name === 'walletAccount.update')).toHaveLength(0);
  });

  it.each(['lock.user', 'lock.wallet', 'walletLedger.create', 'walletAccount.update', 'transaction.commit'])('rolls back a %s failure and permits a clean retry', async point => {
    const f = fixture();
    const failure = new Error(`Synthetic ${point} failure`);
    f.failNext(point, failure);
    await expect(f.service.claimActivationQuest(USER, 'first_feed_like')).rejects.toBe(failure);
    expect(f.ledgers).toHaveLength(0);
    expect(f.wallets[0].cachedBalance.toString()).toBe('300');
    expect(f.events.some(event => event.name === 'rollback')).toBe(true);
    const retry = await f.service.claimActivationQuest(USER, 'first_feed_like');
    expect(retry).toMatchObject({ idempotentReplay: false, walletCredited: true });
    expect(f.ledgers).toHaveLength(1);
    expect(f.wallets[0].cachedBalance.toString()).toBe('310');
  });

  it('progress refresh after a claim hides only that claimed code', async () => {
    const f = fixture();
    await f.service.claimActivationQuest(USER, 'first_feed_post');
    const refreshed = await f.service.getActivationProgress(USER);
    expect(refreshed.milestoneStatus.filter(item => item.claimStatus === 'claimed').map(item => item.code)).toEqual(['first_feed_post']);
    expect(refreshed.milestoneStatus.filter(item => QUESTS.some(([code]) => code === item.code) && item.claimStatus !== 'claimed')).toHaveLength(4);
  });
});
