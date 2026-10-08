import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { RewardsService } from './rewards.service';

const USER = '00000000-0000-4000-8000-000000000001';
const OTHER_USER = '00000000-0000-4000-8000-000000000002';
const WALLET = '10000000-0000-4000-8000-000000000001';
const OTHER_WALLET = '10000000-0000-4000-8000-000000000002';
const LEDGER = '20000000-0000-4000-8000-000000000001';
const DATE = new Date('2026-10-09T00:00:00.000Z');
const SUBJECT = 'synthetic-receipt-owner-subject';
const KEY = `birthday_bonus:${SUBJECT}:2026`;
type Row = Record<string, any>;

function fixture(options: { receipt?: Row; missingWallet?: boolean; walletReadFailure?: boolean } = {}) {
  const identity = { userId: USER, status: 'verified', identitySubjectHash: SUBJECT,
    birthDate: new Date('1990-10-09T00:00:00.000Z') };
  const wallet = { id: WALLET, userId: USER, currencyCode: 'LUMINA', status: 'active',
    cachedBalance: new Decimal(3000) };
  const receipt: Row = { id: LEDGER, walletAccountId: WALLET, direction: 'credit',
    amount: new Decimal(500), ledgerType: 'birthday_bonus', referenceType: 'user',
    referenceId: USER, idempotencyKey: KEY, memo: 'Synthetic annual receipt', createdAt: DATE,
    ...options.receipt };
  const events: string[] = [];
  const walletError = new Error('Synthetic receipt wallet read failure');
  const noWrite = (name: string) => jest.fn(async () => { throw new Error(`Unexpected synthetic ${name}`); });
  const tx = {
    $queryRaw: jest.fn(async (query: TemplateStringsArray, ...values: unknown[]) => {
      const sql = Array.from(query).join('?').replace(/\s+/g, ' ').trim();
      if (/FROM public\.users\b.*FOR NO KEY UPDATE\b/i.test(sql)) {
        expect(values).toEqual([USER]); events.push('lock.user'); return [{ id: USER }];
      }
      if (/FROM public\.wallet_accounts\b.*FOR UPDATE\b/i.test(sql)) {
        expect(values).toEqual([USER, 'LUMINA']); events.push('lock.wallet');
        return options.missingWallet ? [] : [wallet];
      }
      throw new Error('Unexpected synthetic receipt lock');
    }),
    walletLedger: {
      findUnique: jest.fn(async (args: Row) => {
        expect(args).toEqual({ where: { idempotencyKey: KEY } });
        events.push('receipt.read'); return receipt;
      }),
      aggregate: noWrite('cap aggregation'),
      create: noWrite('ledger write'),
    },
    walletAccount: {
      findUnique: jest.fn(async (args: Row) => {
        expect(args).toEqual({ where: { userId_currencyCode: { userId: USER, currencyCode: 'LUMINA' } } });
        events.push('wallet.read');
        if (options.walletReadFailure) throw walletError;
        return options.missingWallet ? null : wallet;
      }),
      upsert: noWrite('wallet upsert'),
      update: noWrite('wallet credit'),
    },
  };
  const prisma = {
    user: {
      findFirst: jest.fn(async (args: Row) => {
        expect(args.where).toEqual({ id: USER, status: 'active', deletedAt: null });
        return { id: USER };
      }),
      findUniqueOrThrow: jest.fn(async (args: Row) => {
        expect(args.where).toEqual({ id: USER });
        return { id: USER, status: 'active', identityVerification: identity };
      }),
    },
    userIdentityVerification: { findUniqueOrThrow: jest.fn(async (args: Row) => {
      expect(args).toEqual({ where: { userId: USER } }); return identity;
    }) },
    // A different transaction commits the annual receipt after this actual preflight read.
    walletLedger: { findUnique: jest.fn(async (args: Row) => {
      expect(args).toEqual({ where: { idempotencyKey: KEY } }); return null;
    }) },
    walletAccount: { findUnique: noWrite('nontransactional wallet lookup') },
    $transaction: jest.fn(async (callback: (db: typeof tx) => Promise<unknown>, options: Row) => {
      expect(options).toEqual({ isolationLevel: 'ReadCommitted' }); return callback(tx);
    }),
  };
  const service = new RewardsService(prisma as never);
  jest.spyOn(service as any, 'getKoreanServiceDate').mockReturnValue(DATE);
  return { service, prisma, tx, wallet, receipt, events, walletError };
}

function expectNoCredit(f: ReturnType<typeof fixture>) {
  expect(f.tx.walletLedger.create).not.toHaveBeenCalled();
  expect(f.tx.walletAccount.upsert).not.toHaveBeenCalled();
  expect(f.tx.walletAccount.update).not.toHaveBeenCalled();
  expect(f.tx.walletLedger.aggregate).not.toHaveBeenCalled();
  expect(f.prisma.walletAccount.findUnique).not.toHaveBeenCalled();
  expect(f.wallet.cachedBalance.toString()).toBe('3000');
  expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
}

async function expectBoundedMismatch(f: ReturnType<typeof fixture>) {
  let failure: unknown;
  try { await f.service.claimBirthdayReward(USER); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(BadRequestException);
  if (!(failure instanceof BadRequestException)) throw new Error('Expected bounded birthday receipt rejection');
  expect(failure.getStatus()).toBe(400);
  expect(failure.getResponse()).toEqual({ statusCode: 400, error: 'Bad Request',
    message: 'Birthday reward ledger does not match this wallet' });
  const output = JSON.stringify(failure.getResponse());
  for (const privateValue of [OTHER_USER, OTHER_WALLET, LEDGER, SUBJECT]) expect(output).not.toContain(privateValue);
  expect(f.tx.walletAccount.findUnique).toHaveBeenCalledTimes(1);
  expectNoCredit(f);
}

describe('RewardsService raced birthday receipt ownership', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reuses the exact current-caller receipt at the cap after the native-shaped locks without another 500', async () => {
    const f = fixture();
    const result = await f.service.claimBirthdayReward(USER);
    expect(result).toMatchObject({ ledger: { id: LEDGER, walletAccountId: WALLET, direction: 'credit',
      ledgerType: 'birthday_bonus', referenceType: 'user', referenceId: USER, idempotencyKey: KEY },
      idempotentReplay: true, walletCredited: false });
    expect(new Decimal(result.ledger.amount).toString()).toBe('500');
    expect(f.events).toEqual(['lock.user', 'lock.wallet', 'receipt.read', 'wallet.read']);
    expect(f.tx.walletAccount.findUnique).toHaveBeenCalledTimes(1);
    expect(f.prisma.walletLedger.findUnique).toHaveBeenCalledTimes(1);
    expectNoCredit(f);
  });

  it('never returns another owner receipt even when its subject-year key, type and amount match', async () => {
    const f = fixture({ receipt: { walletAccountId: OTHER_WALLET, referenceId: OTHER_USER } });
    await expectBoundedMismatch(f);
    expect(f.receipt).toMatchObject({ walletAccountId: OTHER_WALLET, referenceId: OTHER_USER, idempotencyKey: KEY });
  });

  it('rejects a raced receipt if the current caller has no wallet without invoking the fresh-claim upsert', async () => {
    await expectBoundedMismatch(fixture({ missingWallet: true }));
  });

  it.each([
    ['direction', 'debit'],
    ['amount', new Decimal(499)],
    ['amount', new Decimal('500.01')],
    ['ledgerType', 'signup_bonus'],
    ['referenceType', 'payment_order'],
    ['referenceType', null],
    ['referenceId', OTHER_USER],
    ['referenceId', null],
  ])('rejects an otherwise same-wallet receipt with mismatched %s=%s without returning it', async (field, value) => {
    await expectBoundedMismatch(fixture({ receipt: { [String(field)]: value } }));
  });

  it('does not convert a native wallet-read error into a replay, retry, upsert or credit', async () => {
    const f = fixture({ walletReadFailure: true });
    await expect(f.service.claimBirthdayReward(USER)).rejects.toBe(f.walletError);
    expect(f.tx.walletAccount.findUnique).toHaveBeenCalledTimes(1);
    expectNoCredit(f);
  });
});
