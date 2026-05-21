import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { WalletService } from './wallet.service';

const userId = '00000000-0000-4000-8000-000000000001';

function configMock(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

function prismaMock() {
  const wallet = {
    id: '00000000-0000-4000-8000-000000000101',
    userId,
    currencyCode: 'LUMINA',
    status: 'active',
    cachedBalance: new Decimal(0),
  };
  const tx = {
    walletAccount: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(wallet),
      update: jest.fn().mockResolvedValue({
        ...wallet,
        cachedBalance: new Decimal(10),
      }),
    },
    walletLedger: {
      create: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000201',
        walletAccountId: wallet.id,
        direction: 'credit',
        amount: new Decimal(10),
        ledgerType: 'event_grant',
        referenceType: 'local_test',
        idempotencyKey: 'local-grant-1',
      }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: userId }),
    },
    walletAccount: {
      upsert: jest.fn().mockResolvedValue(wallet),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };

  return { prisma, tx, wallet };
}

describe('WalletService local test grant safety', () => {
  it('keeps local test wallet grants disabled in production', async () => {
    const { prisma } = prismaMock();
    const service = new WalletService(
      prisma as never,
      configMock({
        NODE_ENV: 'production',
        ENABLE_LOCAL_WALLET_TEST_GRANT: 'true',
      }) as never,
    );

    await expect(
      service.grantForLocalTesting(userId, {
        amount: '10',
        idempotencyKey: 'local-grant-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.walletAccount.upsert).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires idempotency before local test wallet grants can create wallets', async () => {
    const { prisma } = prismaMock();
    const service = new WalletService(
      prisma as never,
      configMock({
        NODE_ENV: 'development',
        ENABLE_LOCAL_WALLET_TEST_GRANT: 'true',
      }) as never,
    );

    await expect(
      service.grantForLocalTesting(userId, {
        amount: '10',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'WALLET_MUTATION_IDEMPOTENCY_REQUIRED',
        messageKey: 'wallet.mutation.idempotencyRequired',
        walletMutation: false,
      },
    });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.walletAccount.upsert).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('replays the same local test grant without duplicate credit', async () => {
    const { prisma, tx, wallet } = prismaMock();
    tx.walletLedger.findUnique.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000201',
      walletAccountId: wallet.id,
      direction: 'credit',
      amount: new Decimal(10),
      ledgerType: 'event_grant',
      referenceType: 'local_test',
      idempotencyKey: 'local-grant-1',
    });
    const service = new WalletService(
      prisma as never,
      configMock({
        NODE_ENV: 'development',
        ENABLE_LOCAL_WALLET_TEST_GRANT: 'true',
      }) as never,
    );

    await expect(
      service.grantForLocalTesting(userId, {
        amount: '10',
        idempotencyKey: 'local-grant-1',
      }),
    ).resolves.toMatchObject({
      idempotentReplay: true,
    });
    expect(tx.walletAccount.update).not.toHaveBeenCalled();
    expect(tx.walletLedger.create).not.toHaveBeenCalled();
  });

  it('rejects local test grant idempotency reuse with a different amount', async () => {
    const { prisma, tx, wallet } = prismaMock();
    tx.walletLedger.findUnique.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000201',
      walletAccountId: wallet.id,
      direction: 'credit',
      amount: new Decimal(20),
      ledgerType: 'event_grant',
      referenceType: 'local_test',
      idempotencyKey: 'local-grant-1',
    });
    const service = new WalletService(
      prisma as never,
      configMock({
        NODE_ENV: 'development',
        ENABLE_LOCAL_WALLET_TEST_GRANT: 'true',
      }) as never,
    );

    await expect(
      service.grantForLocalTesting(userId, {
        amount: '10',
        idempotencyKey: 'local-grant-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.walletAccount.update).not.toHaveBeenCalled();
    expect(tx.walletLedger.create).not.toHaveBeenCalled();
  });

  it('creates local test grants with a ledger idempotency key when explicitly enabled', async () => {
    const { prisma, tx } = prismaMock();
    const service = new WalletService(
      prisma as never,
      configMock({
        NODE_ENV: 'development',
        ENABLE_LOCAL_WALLET_TEST_GRANT: 'true',
      }) as never,
    );

    await expect(
      service.grantForLocalTesting(userId, {
        amount: '10',
        idempotencyKey: 'local-grant-1',
      }),
    ).resolves.toMatchObject({
      idempotentReplay: false,
    });
    expect(tx.walletAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          cachedBalance: {
            increment: new Decimal(10),
          },
        },
      }),
    );
    expect(tx.walletLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: 'credit',
          amount: new Decimal(10),
          ledgerType: 'event_grant',
          referenceType: 'local_test',
          idempotencyKey: 'local-grant-1',
        }),
      }),
    );
  });
});
