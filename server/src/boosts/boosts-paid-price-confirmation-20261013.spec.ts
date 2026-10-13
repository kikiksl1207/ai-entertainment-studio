import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BoostsController } from './boosts.controller';
import { BoostsService } from './boosts.service';

const ID = {
  owner: '11111111-1111-4111-8111-111111111111', campaign: '22222222-2222-4222-8222-222222222222',
  artist: '33333333-3333-4333-8333-333333333333', product: '44444444-4444-4444-8444-444444444444',
  wallet: '55555555-5555-4555-8555-555555555555', ledger: '66666666-6666-4666-8666-666666666666',
  event: '77777777-7777-4777-8777-777777777777', other: '88888888-8888-4888-8888-888888888888',
};
const key = 'synthetic-paid-confirmation-key';
type Input = Parameters<BoostsService['createPaidLike']>[1];
const request = (changes: Partial<Input> = {}): Input => ({
  campaignId: ID.campaign, artistId: ID.artist, quantity: 1, idempotencyKey: key, ...changes,
});

function originalEvent(unit = '10', quantity = 1) {
  const total = new Decimal(unit).mul(quantity);
  return {
    id: ID.event, userId: ID.owner, campaignId: ID.campaign, artistId: ID.artist,
    boostType: 'lumina_boost', boostProductId: ID.product, idempotencyKey: key,
    rawAmount: new Decimal(quantity), weightedScore: new Decimal(quantity), walletLedgerId: ID.ledger,
    walletLedger: {
      id: ID.ledger, walletAccountId: ID.wallet, direction: 'debit', amount: total,
      ledgerType: 'boost_spend', referenceType: 'boost_product', referenceId: ID.product,
      idempotencyKey: `wallet:boost-paid-like:${key}`,
    },
    metadata: { source: 'paid_like', quantity, artistSlug: 'synthetic-artist',
      unitPriceLumina: unit, totalPriceLumina: total.toString() } as Record<string, unknown>,
  };
}
type Event = ReturnType<typeof originalEvent>;

// Actual service/controller/Decimal; every persistence boundary is local and synthetic.
function fixture(unit = '10', scope = { owner: ID.owner, campaign: ID.campaign }) {
  const trace: string[] = [];
  const state = { currentPrice: unit, balance: new Decimal('100000000000000'), ledger: null as null | Record<string, unknown>,
    event: null as null | Record<string, unknown>, onProductRead: () => {} };
  const forbidden = (name: string) => jest.fn(() => { trace.push(name); throw new Error('Unexpected synthetic write: ' + name); });
  const wallet = () => ({ id: ID.wallet, userId: scope.owner, currencyCode: 'LUMINA', status: 'active', cachedBalance: state.balance });
  const tx = {
    boostCampaign: { findFirst: jest.fn(async () => {
      trace.push('campaign.findFirst'); return { id: scope.campaign, luminaBoostWeight: new Decimal(1), dailyFreeLikeLimit: 1 };
    }) },
    artist: { findFirst: jest.fn(async () => {
      trace.push('artist.findFirst'); return { id: ID.artist, slug: 'synthetic-artist', displayName: 'Synthetic artist' };
    }) },
    boostProduct: {
      findFirst: jest.fn(async () => {
        trace.push('product.findFirst');
        const product = { id: ID.product, sku: 'BOOST_BASIC_VOTE', name: 'Synthetic vote',
          priceLumina: new Decimal(state.currentPrice), boostAmount: new Decimal(1) };
        state.onProductRead(); return product;
      }),
      update: forbidden('product.update'), upsert: forbidden('product.upsert'),
    },
    artistBoostEvent: {
      findUnique: jest.fn(async () => { trace.push('event.findUnique'); return null as Event | null; }),
      findMany: jest.fn(async () => { trace.push('event.findMany'); return [] as Array<{ metadata: unknown }>; }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        trace.push('event.create'); state.event = { id: ID.event, ...data, walletLedger: state.ledger }; return state.event;
      }),
      update: forbidden('event.update'), upsert: forbidden('event.upsert'), delete: forbidden('event.delete'),
    },
    walletAccount: {
      findUnique: jest.fn(async (_query: unknown) => { trace.push('wallet.findUnique'); return wallet(); }),
      findFirst: jest.fn(async () => { trace.push('wallet.findFirst'); return wallet(); }),
      updateMany: jest.fn(async ({ data }: { data: { cachedBalance: { decrement: Decimal } } }) => {
        trace.push('wallet.updateMany'); state.balance = state.balance.minus(data.cachedBalance.decrement); return { count: 1 };
      }),
      upsert: forbidden('wallet.upsert'), create: forbidden('wallet.create'), update: forbidden('wallet.update'),
      delete: forbidden('wallet.delete'),
    },
    walletLedger: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        trace.push('ledger.create'); state.ledger = { id: ID.ledger, ...data }; return state.ledger;
      }),
      update: forbidden('ledger.update'), upsert: forbidden('ledger.upsert'), delete: forbidden('ledger.delete'),
    },
    $executeRaw: forbidden('raw.write'),
    $queryRaw: jest.fn(async (query: Prisma.Sql) => {
      expect(query.text).toBe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text');
      expect(query.sql).toBe('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))::text');
      expect(query.values).toEqual([`boost-paid-like:${scope.campaign}:${scope.owner}`]);
      trace.push('scope.lock'); return [];
    }),
  };
  const prisma = {
    boostCampaign: { findFirst: jest.fn(async () => ({ id: scope.campaign, luminaBoostWeight: new Decimal(1), dailyFreeLikeLimit: 1 })) },
    artist: { findFirst: jest.fn(async () => ({ id: ID.artist, slug: 'synthetic-artist', displayName: 'Synthetic artist' })) },
    boostProduct: {
      findFirst: jest.fn(async () => ({ id: ID.product, sku: 'BOOST_BASIC_VOTE', name: 'Synthetic vote',
        priceLumina: new Decimal(state.currentPrice), boostAmount: new Decimal(1) })),
      update: forbidden('product.update'), upsert: forbidden('product.upsert'),
    },
    walletAccount: { upsert: forbidden('outer.wallet.upsert'), updateMany: forbidden('outer.wallet.updateMany') },
    walletLedger: { create: forbidden('outer.ledger.create') },
    artistBoostEvent: { create: forbidden('outer.event.create') },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => {
      trace.push('transaction'); return callback(tx);
    }),
  };
  return { state, trace, tx, prisma, service: new BoostsService(prisma as never) };
}
type Fixture = ReturnType<typeof fixture>;
function noWrites(h: Fixture) {
  for (const method of [h.tx.walletAccount.updateMany, h.tx.walletAccount.upsert, h.tx.walletAccount.create,
    h.tx.walletAccount.update, h.tx.walletAccount.delete, h.tx.walletLedger.create, h.tx.walletLedger.update,
    h.tx.walletLedger.upsert, h.tx.walletLedger.delete, h.tx.artistBoostEvent.create, h.tx.artistBoostEvent.update,
    h.tx.artistBoostEvent.upsert, h.tx.artistBoostEvent.delete, h.tx.$executeRaw,
    h.tx.boostProduct.update, h.tx.boostProduct.upsert, h.prisma.boostProduct.update,
    h.prisma.boostProduct.upsert, h.prisma.walletAccount.upsert, h.prisma.walletAccount.updateMany,
    h.prisma.walletLedger.create, h.prisma.artistBoostEvent.create]) expect(method).not.toHaveBeenCalled();
  expect(h.state.balance.toString()).toBe('100000000000000'); expect(h.state.ledger).toBeNull(); expect(h.state.event).toBeNull();
}
async function rejection(promise: Promise<unknown>, type: typeof BadRequestException | typeof ConflictException, code: string) {
  let thrown: unknown;
  try { await promise; } catch (error) { thrown = error; }
  expect(thrown).toBeInstanceOf(type);
  expect(thrown).toMatchObject({ response: { code, walletMutation: false } });
  return thrown;
}

describe('paid-like expected total confirmation (synthetic, no real payment)', () => {
  const normal = [
    ['10', 1, '10'], ['10', 5, '50'], ['10', 10, '100'], ['10', 20, '200'],
    ['0.29', 5, '1.45'], ['0.29', 20, '5.80'], ['2.75', 10, '27.50'],
  ] as const;
  it.each(normal)('confirms unit %s x %s against expected %s before exact debit', async (unit, quantity, expected) => {
    const h = fixture(unit), result = await h.service.createPaidLike(ID.owner, request({ quantity, expectedTotalPriceLumina: expected }));
    const total = new Decimal(expected);
    expect(result.idempotentReplay).toBe(false); expect(result.paidLike.totalPriceLumina?.equals(total)).toBe(true);
    expect(h.tx.walletAccount.updateMany).toHaveBeenCalledTimes(1);
    expect(h.tx.walletAccount.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: ID.wallet, userId: ID.owner, currencyCode: 'LUMINA', status: 'active',
        cachedBalance: { gte: total } }, data: { cachedBalance: { decrement: total } },
    });
    expect((h.state.ledger?.amount as Decimal).equals(total)).toBe(true);
    const metadata = h.state.event?.metadata as Record<string, unknown>;
    expect(new Decimal(metadata.totalPriceLumina as string).equals(total)).toBe(true);
    expect(metadata.unitPriceLumina).toBe(new Decimal(unit).toString());
    expect(h.tx.walletAccount.findUnique.mock.calls[0][0]).toEqual({ where: { userId_currencyCode: { userId: ID.owner, currencyCode: 'LUMINA' } } });
    expect(h.tx.walletLedger.create).toHaveBeenCalledTimes(1); expect(h.tx.artistBoostEvent.create).toHaveBeenCalledTimes(1);
    expect(h.tx.walletAccount.upsert).not.toHaveBeenCalled(); expect(h.prisma.boostProduct.update).not.toHaveBeenCalled();
    expect(h.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(h.trace.slice(0, 3)).toEqual(['transaction', 'scope.lock', 'event.findUnique']);
  });

  it.each([1, 20])('rejects a zero configured product for quantity %s after receipt lookup, before wallet access', async quantity => {
    const h = fixture('0');
    await rejection(h.service.createPaidLike(ID.owner, request({ quantity, expectedTotalPriceLumina: '0.00' })),
      BadRequestException, 'BOOST_PAID_LIKE_PRICE_INVALID');
    expect(h.tx.boostProduct.findFirst).toHaveBeenCalledTimes(1);
    expect(h.prisma.boostProduct.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1); expect(h.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(h.trace.slice(0, 3)).toEqual(['transaction', 'scope.lock', 'event.findUnique']);
    expect(h.tx.walletAccount.findUnique).not.toHaveBeenCalled(); noWrites(h);
  });

  it.each(['-1', 'NaN', 'Infinity', '-Infinity'])('rejects invalid configured unit %s before wallet access', async unit => {
    const h = fixture(unit);
    await rejection(h.service.createPaidLike(ID.owner, request({ expectedTotalPriceLumina: '10' })),
      BadRequestException, 'BOOST_PAID_LIKE_PRICE_INVALID');
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1); expect(h.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(h.tx.walletAccount.findUnique).not.toHaveBeenCalled(); noWrites(h);
  });

  it('legacy omission of expected total cannot enable a zero-price charge', async () => {
    const h = fixture('0');
    await rejection(h.service.createPaidLike(ID.owner, request()), BadRequestException, 'BOOST_PAID_LIKE_PRICE_REQUIRED');
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.tx.boostProduct.findFirst).not.toHaveBeenCalled(); noWrites(h);
  });

  it('expected zero parses successfully but mismatches a positive product without a debit', async () => {
    const h = fixture('10');
    await rejection(h.service.createPaidLike(ID.owner, request({ expectedTotalPriceLumina: '0.00' })),
      ConflictException, 'BOOST_PAID_LIKE_PRICE_MISMATCH');
    expect(h.tx.boostProduct.findFirst).toHaveBeenCalledTimes(1); expect(h.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(h.tx.walletAccount.findUnique).not.toHaveBeenCalled(); noWrites(h);
  });

  it.each([
    ['distinct key', ID.owner, ID.campaign, ID.artist, 'synthetic-distinct-key'],
    ['different artist', ID.owner, ID.campaign, ID.other, 'synthetic-artist-key'],
    ['different owner', ID.other, ID.campaign, ID.artist, key],
    ['different campaign', ID.owner, ID.other, ID.artist, key],
  ])('binds the exact owner/campaign lock for %s, independent of artist or intent key', async (_label, owner, campaign, artist, intentKey) => {
    const h = fixture('10', { owner, campaign });
    h.tx.artist.findFirst.mockResolvedValue({ id: artist, slug: 'synthetic-artist', displayName: 'Synthetic artist' });
    await h.service.createPaidLike(owner, request({ campaignId: campaign, artistId: artist, idempotencyKey: intentKey, expectedTotalPriceLumina: '10' }));
    expect(h.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(h.tx.$queryRaw.mock.calls[0][0].values).toEqual([`boost-paid-like:${campaign}:${owner}`]);
    expect(h.trace.slice(0, 3)).toEqual(['transaction', 'scope.lock', 'event.findUnique']);
  });

  it('does not read idempotency, quota or wallet until its transaction scope lock resolves', async () => {
    const h = fixture(), lock = h.tx.$queryRaw.getMockImplementation()!;
    let entered!: () => void, release!: () => void;
    const enteredLock = new Promise<void>(resolve => { entered = resolve; });
    const releasedLock = new Promise<void>(resolve => { release = resolve; });
    h.tx.$queryRaw.mockImplementation(async query => { const rows = await lock(query); entered(); await releasedLock; return rows; });
    const pending = h.service.createPaidLike(ID.owner, request({ expectedTotalPriceLumina: '10' }));
    await enteredLock;
    expect(h.tx.artistBoostEvent.findUnique).not.toHaveBeenCalled(); expect(h.tx.artistBoostEvent.findMany).not.toHaveBeenCalled();
    expect(h.tx.walletAccount.findUnique).not.toHaveBeenCalled(); noWrites(h);
    release(); await pending; expect(h.tx.walletAccount.updateMany).toHaveBeenCalledTimes(1);
  });

  it('a failed scope lock cannot fall back to unlocked event, quota or wallet writes', async () => {
    const h = fixture(); h.tx.$queryRaw.mockRejectedValue(new Error('Synthetic scope lock failure'));
    await expect(h.service.createPaidLike(ID.owner, request({ expectedTotalPriceLumina: '10' }))).rejects.toThrow('Synthetic scope lock failure');
    expect(h.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(h.tx.$queryRaw.mock.calls[0][0].text).toBe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text');
    expect(h.tx.$queryRaw.mock.calls[0][0].values).toEqual([`boost-paid-like:${ID.campaign}:${ID.owner}`]);
    expect(h.tx.artistBoostEvent.findUnique).not.toHaveBeenCalled(); expect(h.tx.artistBoostEvent.findMany).not.toHaveBeenCalled();
    expect(h.tx.walletAccount.findUnique).not.toHaveBeenCalled(); noWrites(h);
  });

  const invalid: Array<[string, unknown]> = [
    ['null', null], ['number', 10], ['boolean', true], ['array', ['10']], ['object', { amount: '10' }],
    ['empty', ''], ['space', ' '], ['trimmed-looking', ' 10.00 '], ['negative', '-1'], ['negative zero', '-0'],
    ['subcent', '0.001'], ['exponent', '1e1'], ['Infinity', 'Infinity'], ['NaN', 'NaN'],
    ['currency', '10L'], ['comma', '1,000'], ['unsafe cent', '90071992547409.92'], ['too many digits', '10000000000000000'],
  ];
  it.each(invalid)('rejects provided %s expected total before any DB query or write', async (_name, value) => {
    const h = fixture();
    await rejection(h.service.createPaidLike(ID.owner, request({ expectedTotalPriceLumina: value as string })),
      BadRequestException, 'BOOST_PAID_LIKE_PRICE_INVALID');
    expect(h.prisma.boostCampaign.findFirst).not.toHaveBeenCalled(); expect(h.prisma.boostProduct.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).not.toHaveBeenCalled(); noWrites(h);
  });

  it('admits the maximum safe-cent string without binary-number rounding', async () => {
    const h = fixture('90071992547409.91');
    const result = await h.service.createPaidLike(ID.owner, request({ expectedTotalPriceLumina: '90071992547409.91' }));
    expect(result.paidLike.totalPriceLumina?.toString()).toBe('90071992547409.91');
    expect((h.state.ledger?.amount as Decimal).toString()).toBe('90071992547409.91');
  });

  it.each([['10', '9'], ['10', '11'], ['10', '0'], ['0.29', '0']] as const)
    ('rejects current unit %s versus displayed total %s with no transaction writes', async (unit, expected) => {
      const h = fixture(unit);
      await rejection(h.service.createPaidLike(ID.owner, request({ expectedTotalPriceLumina: expected })),
        ConflictException, 'BOOST_PAID_LIKE_PRICE_MISMATCH');
      expect(h.tx.artistBoostEvent.findMany).not.toHaveBeenCalled(); expect(h.tx.walletAccount.findUnique).not.toHaveBeenCalled();
      noWrites(h);
    });

  it('changed server unit cannot turn a displayed hundred into a hundred-ten debit', async () => {
    const h = fixture('11');
    await rejection(h.service.createPaidLike(ID.owner, request({ quantity: 10, expectedTotalPriceLumina: '100' })),
      ConflictException, 'BOOST_PAID_LIKE_PRICE_MISMATCH'); noWrites(h);
  });

  it('legacy new requests without expected total cannot debit the current price', async () => {
    const h = fixture('11');
    await rejection(h.service.createPaidLike(ID.owner, request({ quantity: 5 })),
      BadRequestException, 'BOOST_PAID_LIKE_PRICE_REQUIRED');
    expect(h.tx.boostProduct.findFirst).not.toHaveBeenCalled();
    expect(h.tx.artistBoostEvent.findMany).not.toHaveBeenCalled();
    expect(h.tx.walletAccount.findUnique).not.toHaveBeenCalled(); noWrites(h);
  });

  it.each([['10', '11', 10], ['0.29', '0.30', 5]] as const)
    ('replays original unit %s after current price %s for quantity %s without repricing or writes', async (original, current, quantity) => {
      const h = fixture(current), event = originalEvent(original, quantity);
      h.tx.artistBoostEvent.findUnique.mockResolvedValue(event);
      const result = await h.service.createPaidLike(ID.owner, request({ quantity, expectedTotalPriceLumina: event.metadata.totalPriceLumina as string }));
      expect(result.event).toBe(event); expect(result.idempotentReplay).toBe(true);
      expect(result.paidLike.unitPriceLumina?.toString()).toBe(new Decimal(original).toString());
      expect(result.paidLike.totalPriceLumina?.toString()).toBe(event.metadata.totalPriceLumina);
      expect(h.tx.artistBoostEvent.findMany).not.toHaveBeenCalled(); expect(h.tx.walletAccount.findUnique).not.toHaveBeenCalled();
      expect(h.tx.walletAccount.findFirst).toHaveBeenCalledWith({ where: { userId: ID.owner, currencyCode: 'LUMINA' } });
      noWrites(h);
    });

  it('replay rejects an expectation matching the new product but not the original charge', async () => {
    const h = fixture('11'); h.tx.artistBoostEvent.findUnique.mockResolvedValue(originalEvent('10', 10));
    await rejection(h.service.createPaidLike(ID.owner, request({ quantity: 10, expectedTotalPriceLumina: '110' })),
      ConflictException, 'BOOST_PAID_LIKE_PRICE_MISMATCH'); noWrites(h);
  });

  const wrongScope: Array<[string, (event: Event) => void]> = [
    ['owner', event => { event.userId = ID.other; }], ['campaign', event => { event.campaignId = ID.other; }],
    ['artist', event => { event.artistId = ID.other; }], ['product', event => { event.boostProductId = ID.other; }],
    ['quantity', event => { event.metadata.quantity = 5; }], ['source', event => { event.metadata.source = 'boost_order'; }],
    ['original key', event => { event.idempotencyKey = 'synthetic-other-key'; }],
  ];
  it.each(wrongScope)('rejects wrong original %s even with a matching expected total', async (_name, mutate) => {
    const h = fixture(), event = originalEvent(); mutate(event); h.tx.artistBoostEvent.findUnique.mockResolvedValue(event);
    await rejection(h.service.createPaidLike(ID.owner, request({ expectedTotalPriceLumina: '10' })),
      ConflictException, 'BOOST_IDEMPOTENCY_CONFLICT'); noWrites(h);
  });

  const badReceipt: Array<[string, (event: Event) => void]> = [
    ['missing ledger', event => { event.walletLedger = null as unknown as Event['walletLedger']; }],
    ['ledger link', event => { event.walletLedger.id = ID.other; }],
    ['ledger amount', event => { event.walletLedger.amount = new Decimal('9'); }],
    ['ledger direction', event => { event.walletLedger.direction = 'credit'; }],
    ['ledger key', event => { event.walletLedger.idempotencyKey = 'wallet:other:key'; }],
    ['ledger type', event => { event.walletLedger.ledgerType = 'purchase'; }],
    ['ledger reference type', event => { event.walletLedger.referenceType = 'other'; }],
    ['ledger reference id', event => { event.walletLedger.referenceId = ID.other; }],
    ['ledger owner wallet', event => { event.walletLedger.walletAccountId = ID.other; }],
    ['missing original total', event => { delete event.metadata.totalPriceLumina; }],
    ['subcent original total', event => { event.metadata.totalPriceLumina = '10.001'; }],
    ['invalid original unit', event => { event.metadata.unitPriceLumina = null; }],
    ['inconsistent original unit', event => { event.metadata.unitPriceLumina = '9'; }],
  ];
  it.each(badReceipt)('requires original price proof: rejects %s without new charge', async (_name, mutate) => {
    const h = fixture(), event = originalEvent(); mutate(event); h.tx.artistBoostEvent.findUnique.mockResolvedValue(event);
    await rejection(h.service.createPaidLike(ID.owner, request({ expectedTotalPriceLumina: '10' })),
      ConflictException, 'BOOST_IDEMPOTENCY_CONFLICT'); noWrites(h);
  });

  it('valid original total without a stored unit derives its exact original unit price', async () => {
    const h = fixture('99'), event = originalEvent(); delete event.metadata.unitPriceLumina;
    h.tx.artistBoostEvent.findUnique.mockResolvedValue(event);
    const result = await h.service.createPaidLike(ID.owner, request({ expectedTotalPriceLumina: '10' }));
    expect(result.idempotentReplay).toBe(true); expect(result.paidLike.totalPriceLumina?.toString()).toBe('10');
    expect(result.paidLike.unitPriceLumina?.toString()).toBe('10'); noWrites(h);
  });

  it('complete legacy replay returns original recorded prices rather than the changed product', async () => {
    const h = fixture('99'); h.tx.artistBoostEvent.findUnique.mockResolvedValue(originalEvent());
    const result = await h.service.createPaidLike(ID.owner, request());
    expect(result.idempotentReplay).toBe(true); expect(result.paidLike.unitPriceLumina?.toString()).toBe('10');
    expect(result.paidLike.totalPriceLumina?.toString()).toBe('10'); noWrites(h);
  });

  it('legacy replay with missing price evidence rejects without a replacement charge', async () => {
    const h = fixture('99'), event = originalEvent(); delete event.metadata.totalPriceLumina; delete event.metadata.unitPriceLumina;
    event.walletLedger = null as unknown as Event['walletLedger']; h.tx.artistBoostEvent.findUnique.mockResolvedValue(event);
    await rejection(h.service.createPaidLike(ID.owner, request()),
      ConflictException, 'BOOST_IDEMPOTENCY_CONFLICT'); noWrites(h);
  });

  it('rejects an original zero receipt rather than recovering an impossible debit', async () => {
    const h = fixture('99'); h.tx.artistBoostEvent.findUnique.mockResolvedValue(originalEvent('0', 20));
    await rejection(h.service.createPaidLike(ID.owner, request({ quantity: 20, expectedTotalPriceLumina: '0' })),
      ConflictException, 'BOOST_IDEMPOTENCY_CONFLICT'); noWrites(h);
  });

  it('matching expected total does not bypass the original daily limit', async () => {
    const h = fixture(); h.tx.artistBoostEvent.findMany.mockResolvedValue([{ metadata: { quantity: 20 } }]);
    await expect(h.service.createPaidLike(ID.owner, request({ expectedTotalPriceLumina: '10' }))).rejects.toThrow('Daily paid like limit exceeded');
    noWrites(h);
  });

  it('matching expected total does not bypass the original required key', async () => {
    const h = fixture();
    await rejection(h.service.createPaidLike(ID.owner, request({ idempotencyKey: undefined, expectedTotalPriceLumina: '10' })),
      BadRequestException, 'BOOST_IDEMPOTENCY_REQUIRED'); expect(h.prisma.$transaction).not.toHaveBeenCalled(); noWrites(h);
  });

  it('a later product-row change leaves the captured compared total identical to the debited total', async () => {
    const h = fixture('10'); h.state.onProductRead = () => { h.state.currentPrice = '11'; };
    const result = await h.service.createPaidLike(ID.owner, request({ expectedTotalPriceLumina: '10' }));
    expect(h.state.currentPrice).toBe('11'); expect(result.paidLike.totalPriceLumina?.toString()).toBe('10');
    expect((h.state.ledger?.amount as Decimal).toString()).toBe('10');
    expect((h.state.event?.metadata as Record<string, unknown>).unitPriceLumina).toBe('10');
    expect(h.tx.boostProduct.findFirst).toHaveBeenCalledTimes(1);
    expect(h.prisma.boostProduct.findFirst).not.toHaveBeenCalled();
  });
});

describe('paid-like controller price boundary (no HTTP server)', () => {
  it.each(['0010.00', null, 10])('forwards provided expected total %s unchanged and takes owner only from CurrentUser', async value => {
    const createPaidLike = jest.fn(async () => ({ synthetic: true }));
    const controller = new BoostsController({ createPaidLike } as never);
    await controller.createPaidLike(ID.campaign, { id: ID.owner }, 'header-key', {
      artistId: ID.artist, quantity: 1, idempotencyKey: key, expectedTotalPriceLumina: value, userId: ID.other,
    } as never);
    expect(createPaidLike).toHaveBeenCalledWith(ID.owner, {
      campaignId: ID.campaign, artistId: ID.artist, artistSlug: undefined, quantity: 1,
      expectedTotalPriceLumina: value, idempotencyKey: key,
    });
  });

  it('absent expected total preserves legacy header-key forwarding', async () => {
    const createPaidLike = jest.fn(async () => ({ synthetic: true }));
    const controller = new BoostsController({ createPaidLike } as never);
    await controller.createPaidLike(ID.campaign, { id: ID.owner }, 'header-key', { artistId: ID.artist, quantity: 1 });
    expect(createPaidLike).toHaveBeenCalledWith(ID.owner, {
      campaignId: ID.campaign, artistId: ID.artist, artistSlug: undefined, quantity: 1,
      expectedTotalPriceLumina: undefined, idempotencyKey: 'header-key',
    });
  });

  it('retains the existing JWT guard without adding payment or role authority', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, BoostsController.prototype.createPaidLike)).toEqual([JwtAuthGuard]);
  });
});
