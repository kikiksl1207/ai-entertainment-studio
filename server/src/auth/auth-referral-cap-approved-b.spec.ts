import assert from 'node:assert/strict';
import { describe, it } from '@jest/globals';
import { Decimal } from '@prisma/client/runtime/library';
import { AuthService } from './auth.service';

const REFERRER = '00000000-0000-4000-8000-000000000001';
const REFERRED = '00000000-0000-4000-8000-000000000002';
const THIRD = '00000000-0000-4000-8000-000000000003';
const PROMO_TYPES = ['signup_bonus', 'referral_reward', 'daily_attendance',
  'identity_verification_bonus', 'birthday_bonus', 'achievement_reward',
  'quest_reward', 'profile_completion_reward'];
type Row = Record<string, any>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, wanted]) => {
    if (key === 'OR') return wanted.some((item: Row) => matches(row, item));
    const actual = row[key];
    if (wanted !== null && typeof wanted === 'object') {
      if ('in' in wanted) return wanted.in.includes(actual);
      if ('startsWith' in wanted) return String(actual ?? '').startsWith(wanted.startsWith);
      return matches(actual ?? {}, wanted);
    }
    return actual === wanted;
  });
}

function fixture(caller = false) {
  const state: Row = { users: [], wallets: [], ledgers: [], receipts: [], auth: [], profiles: [], settings: [], useCount: 0 };
  const code: Row = { id: 'synthetic-code', userId: REFERRER, code: 'SYNTHETIC', status: 'active' };
  const events: Row[] = [];
  const locks = new Map<string, Promise<void>>();
  const waiting = deferred();
  let seq = 0;
  let txSeq = 0;
  let failure: { name: string; ordinal: number } | undefined;
  let afterInitialCode: (() => void) | undefined;
  let firstCreditGate: ReturnType<typeof deferred> | undefined;
  let firstCreditEntered: ReturnType<typeof deferred> | undefined;
  const seed = (userId: string, amount: number | string, overrides: Row = {}) => {
    const wallet = state.wallets.find((row: Row) => row.userId === userId);
    const row = { id: `seed-${++seq}`, walletAccountId: wallet.id, direction: 'credit',
      amount: new Decimal(amount), ledgerType: 'signup_bonus', idempotencyKey: `synthetic:${seq}`, ...overrides };
    state.ledgers.push(row);
    return row;
  };
  const addRecipient = (userId: string) => {
    state.users.push({ id: userId, status: 'active', deletedAt: null });
    state.wallets.push({ id: `wallet-${userId}`, userId, currencyCode: 'LUMINA',
      status: 'active', cachedBalance: new Decimal(300) });
    seed(userId, 300);
  };
  addRecipient(REFERRER);
  if (!caller) addRecipient(REFERRED);

  // Read-committed overlays and explicit mutexes model the SQL calls, not a real DB.
  const transaction = async (body: (tx: Row) => Promise<any>, options?: Row) => {
    const txId = ++txSeq;
    const pending: Row = { users: [], wallets: [], ledgers: [], receipts: [], auth: [], profiles: [], settings: [], useCount: 0 };
    const increments = new Map<string, Decimal>();
    const held = new Set<string>();
    const releases: Array<() => void> = [];
    const visible = (name: string): Row[] => [...state[name], ...pending[name]];
    const mark = (name: string, args: Row = {}) => {
      events.push({ txId, name, args });
      if (failure?.name === name && events.filter(e => e.name === name).length === failure.ordinal) {
        throw new Error('SYNTHETIC_WRITE_FAILURE');
      }
    };
    const copyWallet = (wallet?: Row) => wallet ? {
      ...wallet, cachedBalance: wallet.cachedBalance.plus(increments.get(wallet.id) ?? 0),
    } : null;
    const acquire = async (key: string) => {
      if (held.has(key)) return;
      const previous = locks.get(key) ?? Promise.resolve();
      const gate = deferred();
      const tail = previous.then(() => gate.promise);
      if (locks.has(key)) { events.push({ txId, name: 'lock.wait' }); waiting.resolve(); }
      locks.set(key, tail);
      await previous;
      held.add(key);
      releases.push(() => { gate.resolve(); if (locks.get(key) === tail) locks.delete(key); });
      events.push({ txId, name: 'lock.acquired', args: { key } });
    };
    const tx: Row = {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?').replace(/\s+/g, ' ').trim();
        mark('query', { sql, values });
        if (sql.startsWith('SELECT id FROM public.users')) {
          assert(sql.endsWith('FOR NO KEY UPDATE'));
          await acquire(`user:${values[0]}`);
          return visible('users').filter(row => row.id === values[0]);
        }
        assert(sql.startsWith('SELECT id FROM public.wallet_accounts') && sql.endsWith('FOR UPDATE'));
        assert.equal(values[1], 'LUMINA');
        await acquire(`wallet:${values[0]}`);
        return visible('wallets').filter(row => row.userId === values[0] && row.currencyCode === values[1]);
      },
      user: {
        create: async ({ data }: Row) => {
          mark('user.create');
          const row = { id: REFERRED, deletedAt: null, ...data };
          pending.users.push(row);
          return row;
        },
        findFirst: async ({ where }: Row) => { mark('user.findFirst'); return visible('users').find(row => matches(row, where)) ?? null; },
        findUnique: async ({ where }: Row) => { mark('user.findUnique'); return visible('users').find(row => matches(row, where)) ?? null; },
      },
      userReferralCode: {
        findFirst: async ({ where }: Row) => {
          mark('code.read');
          const row = matches({ ...code, user: visible('users').find(user => user.id === code.userId) }, where) ? { ...code } : null;
          if (afterInitialCode) { const hook = afterInitialCode; afterInitialCode = undefined; hook(); }
          return row;
        },
        update: async ({ data }: Row) => { mark('code.update'); pending.useCount += data.useCount.increment; return code; },
      },
      walletAccount: {
        create: async ({ data }: Row) => {
          mark('wallet.create');
          const wallet = { id: `wallet-${data.userId}`, status: 'active', ...data, cachedBalance: new Decimal(data.cachedBalance) };
          pending.wallets.push(wallet);
          return wallet;
        },
        findUnique: async ({ where }: Row) => {
          mark('wallet.read');
          return copyWallet(visible('wallets').find(row => matches(row, where.userId_currencyCode ?? where)));
        },
        update: async ({ where, data }: Row) => {
          mark('wallet.update');
          const wallet = visible('wallets').find(row => row.id === where.id)!;
          increments.set(wallet.id, (increments.get(wallet.id) ?? new Decimal(0)).plus(data.cachedBalance.increment));
          return copyWallet(wallet);
        },
      },
      walletLedger: {
        aggregate: async ({ where, _sum }: Row) => {
          mark('aggregate', { where, _sum });
          const rows = visible('ledgers').filter(row => matches({ ...row,
            walletAccount: visible('wallets').find(wallet => wallet.id === row.walletAccountId) }, where));
          return { _sum: { amount: rows.length ? rows.reduce((sum, row) => sum.plus(row.amount), new Decimal(0)) : null } };
        },
        create: async ({ data }: Row) => {
          mark('ledger.create', { data });
          if (data.ledgerType === 'referral_reward' && firstCreditGate) {
            const gate = firstCreditGate;
            firstCreditGate = undefined;
            firstCreditEntered!.resolve();
            await gate.promise;
          }
          if (visible('ledgers').some(row => row.idempotencyKey === data.idempotencyKey)) throw new Error('SYNTHETIC_UNIQUE_CONFLICT');
          const row = { id: `ledger-${++seq}`, ...data, amount: new Decimal(data.amount) };
          pending.ledgers.push(row);
          return row;
        },
      },
      referralReward: {
        findUnique: async ({ where }: Row) => { mark('receipt.read'); return visible('receipts').find(row => matches(row, where)) ?? null; },
        create: async ({ data }: Row) => {
          mark('receipt.create');
          if (visible('receipts').some(row => row.referredUserId === data.referredUserId)) throw new Error('SYNTHETIC_UNIQUE_CONFLICT');
          const receipt = { id: 'synthetic-receipt', ...data };
          pending.receipts.push(receipt);
          return receipt;
        },
      },
    };
    for (const [delegate, target] of [['userAuthAccount', 'auth'], ['userProfile', 'profiles'], ['userSettings', 'settings']]) {
      tx[delegate] = { create: async ({ data }: Row) => { mark(`${target}.create`); pending[target].push(data); return data; } };
    }
    events.push({ txId, name: 'transaction.begin', args: { options } });
    try {
      const result = await body(tx);
      for (const name of ['users', 'wallets', 'ledgers', 'receipts', 'auth', 'profiles', 'settings']) state[name].push(...pending[name]);
      for (const [id, amount] of increments) {
        const wallet = state.wallets.find((row: Row) => row.id === id);
        wallet.cachedBalance = wallet.cachedBalance.plus(amount);
      }
      state.useCount += pending.useCount;
      events.push({ txId, name: 'transaction.commit' });
      return result;
    } catch (error) {
      events.push({ txId, name: 'transaction.rollback' });
      throw error;
    } finally { for (const release of releases.reverse()) release(); }
  };
  const service: Row = Object.create(AuthService.prototype);
  service.prisma = { $transaction: transaction, user: { findUnique: async () => null },
    userAuthAccount: { findUnique: async () => null } };
  service.generateTemporaryProfileIdentity = async () => ({ displayName: 'Synthetic', publicHandle: 'synthetic' });
  service.socialAuthService = { verifyProfile: async () => ({ provider: 'google', providerUserId: 'synthetic', emailVerified: false }) };
  service.getMe = async () => { events.push({ name: 'getMe' }); return { id: REFERRED }; };
  service.issueTokens = async () => { events.push({ name: 'tokens' }); return { accessToken: 'synthetic' }; };
  service.authResponse = (user: Row, tokens: Row) => ({ user, tokens });
  const apply = (userId = REFERRED, referralCode: string | undefined = 'SYNTHETIC') =>
    transaction(tx => service.applyReferralReward(tx, userId, referralCode));
  return { state, code, service, events, seed, addRecipient, transaction, apply,
    fail: (name: string, ordinal = 1) => { failure = { name, ordinal }; },
    afterInitialCode: (hook: () => void) => { afterInitialCode = hook; },
    holdFirstCredit: () => {
      firstCreditGate = deferred(); firstCreditEntered = deferred();
      return { entered: firstCreditEntered.promise, release: firstCreditGate.resolve, waiting: waiting.promise };
    },
  };
}

function noReferralWrites(f: ReturnType<typeof fixture>) {
  assert.equal(f.events.filter(e => e.name === 'ledger.create' && e.args.data.ledgerType === 'referral_reward').length, 0);
  assert.equal(f.state.receipts.length, 0);
  assert.equal(f.state.useCount, 0);
  assert.equal(f.events.filter(e => ['wallet.update', 'code.update', 'receipt.create'].includes(e.name)).length, 0);
}

describe('Referral cap approved B (finite synthetic transactions)', () => {
  it('normal signup retains 300L and grants exactly 500L to each recipient', async () => {
    const f = fixture(true);
    await f.service.register({ email: 'synthetic@example.invalid', password: 'synthetic', referralCode: 'SYNTHETIC' });
    assert.deepEqual(f.state.ledgers.map((row: Row) => [row.ledgerType, row.amount.toString()]),
      [['signup_bonus', '300'], ['signup_bonus', '300'], ['referral_reward', '500'], ['referral_reward', '500']]);
    assert.deepEqual(f.state.wallets.map((row: Row) => row.cachedBalance.toString()), ['800', '800']);
    assert.equal(f.state.receipts[0].idempotencyKey, `referral:${REFERRED}`);
    assert.equal(f.state.useCount, 1);
    assert.deepEqual(f.events.find(e => e.name === 'transaction.begin')!.args.options, { isolationLevel: 'ReadCommitted' });
  });

  it('2500L plus 500L reaches the limit for both parties', async () => {
    const f = fixture();
    f.seed(REFERRER, 2200); f.seed(REFERRED, 2200);
    await f.apply();
    assert.equal(f.state.receipts.length, 1);
    assert.equal(f.state.receipts[0].referrerAmount, 500);
    assert.equal(f.state.receipts[0].referredAmount, 500);
  });

  it('approved B skips both referral credits at 2800L', async () => {
    const f = fixture();
    f.seed(REFERRER, 2500);
    const result = await f.apply();
    assert.equal(result, null);
    noReferralWrites(f);
    assert.equal(f.state.wallets[1].cachedBalance.toString(), '300');
  });

  it('already over-limit history skips both without modifying the history', async () => {
    const f = fixture(); f.seed(REFERRER, 2800);
    const count = f.state.ledgers.length;
    assert.equal(await f.apply(), null); noReferralWrites(f);
    assert.equal(f.state.ledgers.length, count);
  });

  for (const userId of [REFERRER, REFERRED]) {
    it(`one party full (${userId === REFERRER ? 'referrer' : 'referred'}) prevents either credit`, async () => {
      const f = fixture(); f.seed(userId, 2700);
      assert.equal(await f.apply(), null); noReferralWrites(f);
    });
  }

  it('spent-wallet balance does not reset lifetime eligibility', async () => {
    const f = fixture(); f.seed(REFERRER, 2500);
    f.state.wallets[0].cachedBalance = new Decimal(0);
    f.seed(REFERRER, 2800, { direction: 'debit' });
    assert.equal(await f.apply(), null); noReferralWrites(f);
  });

  it('high paid balances and unrelated event grants do not consume promo capacity', async () => {
    const f = fixture(); f.state.wallets[0].cachedBalance = new Decimal(9000);
    for (const ledgerType of ['purchase', 'first_charge_bonus', 'paid_bonus', 'event_grant']) f.seed(REFERRER, 9000, { ledgerType });
    f.seed(REFERRER, 9000, { walletAccountId: 'unrelated-wallet' });
    f.state.wallets.push({ id: 'other-currency', userId: REFERRER, currencyCode: 'KRW', status: 'active', cachedBalance: new Decimal(0) });
    f.seed(REFERRER, 9000, { walletAccountId: 'other-currency' });
    await f.apply(); assert.equal(f.state.receipts.length, 1);
  });

  it('counts every modern promo ledger type and all three legacy prefixes', async () => {
    for (const ledgerType of PROMO_TYPES) {
      const f = fixture(); f.seed(REFERRER, 2500, { ledgerType });
      assert.equal(await f.apply(), null); noReferralWrites(f);
    }
    for (const prefix of ['signup_bonus:', 'referral:referrer:', 'referral:referred:']) {
      const f = fixture(); f.seed(REFERRER, 2500, { ledgerType: 'event_grant', idempotencyKey: prefix + 'synthetic' });
      assert.equal(await f.apply(), null); noReferralWrites(f);
    }
  });

  it('uses Decimal comparison for fractional earned totals and null aggregates', async () => {
    const f = fixture(); f.seed(REFERRER, '2200.01');
    assert.equal(await f.apply(), null); noReferralWrites(f);
    const empty = fixture(); empty.state.ledgers.length = 0;
    await empty.apply(); assert.equal(empty.state.receipts.length, 1);
  });

  it('existing receipt replay bypasses cap and performs no new grant', async () => {
    const f = fixture(); await f.apply();
    f.seed(REFERRER, 10000); f.events.length = 0;
    const receipt = f.state.receipts[0];
    assert.equal(await f.apply(), receipt);
    assert.equal(f.events.filter(e => ['aggregate', 'ledger.create', 'wallet.update', 'code.update', 'receipt.create'].includes(e.name)).length, 0);
    assert.equal(f.state.useCount, 1);
  });

  it('locks all users before all wallets before locked code, receipt and cap reads', async () => {
    const f = fixture(); await f.apply();
    const queries = f.events.filter(e => e.name === 'query');
    assert.deepEqual(queries.map(e => e.args.values), [[REFERRER], [REFERRED], [REFERRER, 'LUMINA'], [REFERRED, 'LUMINA']]);
    const lastLock = f.events.map(e => e.name).lastIndexOf('lock.acquired');
    assert(f.events.findIndex(e => e.name === 'receipt.read') > lastLock);
    assert(f.events.findIndex(e => e.name === 'aggregate') > lastLock);
    assert.deepEqual(f.events.filter(e => e.name === 'aggregate').map(e => e.args.where.walletAccount.userId), [REFERRER, REFERRED]);
    assert.equal(f.events.filter(e => e.name === 'code.read').length, 2);
  });

  for (const mutate of ['code', 'referrer', 'referred']) {
    it(`rechecks ${mutate} eligibility after locking`, async () => {
      const f = fixture();
      f.afterInitialCode(() => {
        if (mutate === 'code') f.code.status = 'inactive';
        else f.state.users.find((row: Row) => row.id === (mutate === 'referrer' ? REFERRER : REFERRED)).status = 'inactive';
      });
      await assert.rejects(f.apply()); noReferralWrites(f);
    });
  }

  it('invalid, self and absent referral retain existing behavior', async () => {
    const invalid = fixture(); await assert.rejects(invalid.apply(REFERRED, 'INVALID')); noReferralWrites(invalid);
    const self = fixture(); await assert.rejects(self.apply(REFERRER)); noReferralWrites(self);
    const absent = fixture();
    assert.equal(await absent.transaction(tx => absent.service.applyReferralReward(tx, REFERRED, undefined)), null);
    assert.equal(absent.events.filter(e => e.name === 'query').length, 0); noReferralWrites(absent);
  });

  for (const userId of [REFERRER, REFERRED]) {
    it(`inactive ${userId === REFERRER ? 'referrer' : 'referred'} wallet remains an error`, async () => {
      const f = fixture(); f.state.wallets.find((row: Row) => row.userId === userId).status = 'inactive';
      await assert.rejects(f.apply()); noReferralWrites(f);
    });
  }

  for (const method of ['register', 'socialLogin']) {
    it(`${method} keeps account and signup 300L on cap skip`, async () => {
      const f = fixture(true); f.seed(REFERRER, 2500);
      await f.service[method]({ email: 'synthetic@example.invalid', password: 'synthetic', provider: 'google', token: 'synthetic', referralCode: 'SYNTHETIC' });
      noReferralWrites(f);
      assert.equal(f.state.users.length, 2);
      assert.equal(f.state.wallets[1].cachedBalance.toString(), '300');
      assert.equal(f.state.auth.length + f.state.profiles.length + f.state.settings.length, 3);
      assert.equal(f.events.filter(e => e.name === 'tokens').length, 1);
      assert.deepEqual(f.events.find(e => e.name === 'transaction.begin')!.args.options, { isolationLevel: 'ReadCommitted' });
    });
  }

  for (const [name, ordinal] of [['query', 1], ['aggregate', 1], ['ledger.create', 2], ['ledger.create', 3],
    ['wallet.update', 1], ['wallet.update', 2], ['code.update', 1], ['receipt.create', 1]] as const) {
    it(`register propagates ${name} failure ${ordinal} and discards the entire synthetic transaction`, async () => {
      const f = fixture(true); f.fail(name, ordinal);
      await assert.rejects(f.service.register({ email: 'synthetic@example.invalid', password: 'synthetic', referralCode: 'SYNTHETIC' }), /SYNTHETIC_WRITE_FAILURE/);
      assert.equal(f.state.users.length, 1); assert.equal(f.state.wallets.length, 1);
      assert.equal(f.state.ledgers.length, 1); assert.equal(f.state.receipts.length, 0);
      assert.equal(f.state.useCount, 0);
      assert.equal(f.state.auth.length + f.state.profiles.length + f.state.settings.length, 0);
      assert.equal(f.events.filter(e => ['tokens', 'getMe'].includes(e.name)).length, 0);
      assert.equal(f.events.filter(e => e.name === 'transaction.rollback').length, 1);
    });
  }

  it('social signup also propagates a receipt failure without issuing tokens', async () => {
    const f = fixture(true); f.fail('receipt.create');
    await assert.rejects(f.service.socialLogin({ provider: 'google', token: 'synthetic', referralCode: 'SYNTHETIC' }), /SYNTHETIC_WRITE_FAILURE/);
    assert.equal(f.state.users.length, 1); assert.equal(f.state.ledgers.length, 1);
    assert.equal(f.events.filter(e => e.name === 'tokens').length, 0);
  });

  it('two referrals sharing a referrer serialize their lifetime cap checks', async () => {
    const f = fixture(); f.addRecipient(THIRD); f.seed(REFERRER, 2200);
    const gate = f.holdFirstCredit();
    const first = f.apply(); await gate.entered;
    const second = f.apply(THIRD); await gate.waiting;
    gate.release();
    const results = await Promise.all([first, second]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(results.filter(value => value === null).length, 1);
    assert.equal(f.state.receipts.length, 1); assert.equal(f.state.useCount, 1);
    assert.equal(f.state.ledgers.filter((row: Row) => row.ledgerType === 'referral_reward').length, 2);
  });

  it('simultaneous receipt replay grants once under the same recipient locks', async () => {
    const f = fixture(); const gate = f.holdFirstCredit();
    const first = f.apply(); await gate.entered;
    const second = f.apply(); await gate.waiting;
    gate.release(); const results = await Promise.all([first, second]);
    assert.equal(results[0], results[1]);
    assert.equal(f.state.receipts.length, 1); assert.equal(f.state.useCount, 1);
  });

  it('a cooperating promo writer waits and sees committed referral credit', async () => {
    const f = fixture(); f.seed(REFERRER, 2200);
    const gate = f.holdFirstCredit(); const referral = f.apply(); await gate.entered;
    const other = f.transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM public.users WHERE id = ${REFERRER}::uuid FOR NO KEY UPDATE`;
      await tx.$queryRaw`SELECT id FROM public.wallet_accounts WHERE user_id = ${REFERRER}::uuid AND currency_code = ${'LUMINA'} FOR UPDATE`;
      const sum = await tx.walletLedger.aggregate({ where: { direction: 'credit', walletAccount: { userId: REFERRER, currencyCode: 'LUMINA' }, ledgerType: { in: PROMO_TYPES } }, _sum: { amount: true } });
      return new Decimal(sum._sum.amount).plus(10).greaterThan(3000);
    });
    await gate.waiting; gate.release();
    await referral; assert.equal(await other, true);
  });
});
