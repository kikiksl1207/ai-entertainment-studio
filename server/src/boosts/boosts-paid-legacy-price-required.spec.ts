import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { BoostsService } from './boosts.service';

const ID = {
  owner: '11111111-1111-4111-8111-111111111111', campaign: '22222222-2222-4222-8222-222222222222',
  artist: '33333333-3333-4333-8333-333333333333', product: '44444444-4444-4444-8444-444444444444',
  wallet: '55555555-5555-4555-8555-555555555555', ledger: '66666666-6666-4666-8666-666666666666',
  event: '77777777-7777-4777-8777-777777777777', other: '88888888-8888-4888-8888-888888888888',
};
const key = 'synthetic-legacy-receipt-key';
const slug = 'original-artist';
type Input = Parameters<BoostsService['createPaidLike']>[1];
type Query = { where: Record<string, unknown> };
const request = (changes: Partial<Input> = {}): Input => ({
  campaignId: ID.campaign, artistId: ID.artist, quantity: 5, idempotencyKey: key, ...changes,
});

function receipt(unit = '0.29', quantity = 5) {
  const total = new Decimal(unit).mul(quantity);
  return {
    id: ID.event, userId: ID.owner, campaignId: ID.campaign, artistId: ID.artist,
    boostType: 'lumina_boost', boostProductId: ID.product, idempotencyKey: key,
    walletLedgerId: ID.ledger, rawAmount: new Decimal(quantity).mul(3), weightedScore: new Decimal(45),
    walletLedger: {
      id: ID.ledger, walletAccountId: ID.wallet, direction: 'debit', amount: total,
      ledgerType: 'boost_spend', referenceType: 'boost_product', referenceId: ID.product,
      idempotencyKey: `wallet:boost-paid-like:${key}`,
    },
    metadata: { source: 'paid_like', artistSlug: slug, quantity,
      unitPriceLumina: unit, totalPriceLumina: total.toString() } as Record<string, unknown>,
  };
}
type Receipt = ReturnType<typeof receipt>;
type Wallet = { id: string; userId: string; currencyCode: string; status: string; cachedBalance: Decimal };

// Local persistence doubles; no database, HTTP server or real payment.
function harness() {
  const trace: string[] = [];
  const state = {
    event: null as Receipt | null, saleActive: false, currentUnit: '0.30', balance: new Decimal(1000),
    artist: { id: ID.artist, slug, displayName: 'Synthetic artist', status: 'inactive' },
    product: { id: ID.product, sku: 'BOOST_BASIC_VOTE', name: 'Synthetic vote', status: 'inactive',
      priceLumina: new Decimal(99), boostAmount: new Decimal(99) },
    wallet: { id: ID.wallet, userId: ID.owner, currencyCode: 'LUMINA', status: 'active',
      cachedBalance: new Decimal(1000) } as Wallet | null,
    ledger: null as Record<string, unknown> | null, createdEvent: null as Record<string, unknown> | null,
  };
  const forbidden = (name: string) => jest.fn(() => { throw new Error(`Unexpected persistence access: ${name}`); });
  const writeTraps = (name: string) => ({
    create: forbidden(`${name}.create`), update: forbidden(`${name}.update`),
    updateMany: forbidden(`${name}.updateMany`), upsert: forbidden(`${name}.upsert`),
    delete: forbidden(`${name}.delete`), deleteMany: forbidden(`${name}.deleteMany`),
  });
  const outer = (name: string) => ({ ...writeTraps(name), findFirst: forbidden(`${name}.findFirst`),
    findUnique: forbidden(`${name}.findUnique`), findMany: forbidden(`${name}.findMany`) });
  const tx = {
    $queryRaw: jest.fn(async (query: Prisma.Sql) => {
      expect(query.text).toBe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text');
      expect(query.values).toEqual([`boost-paid-like:${ID.campaign}:${ID.owner}`]);
      trace.push('lock'); return [];
    }),
    $executeRaw: forbidden('raw.write'),
    boostCampaign: { ...writeTraps('campaign'), findFirst: jest.fn(async (_query: Query) => {
      trace.push('campaign.active');
      return state.saleActive ? { id: ID.campaign, luminaBoostWeight: new Decimal(1) } : null;
    }) },
    artist: { ...writeTraps('artist'), findFirst: jest.fn(async ({ where }: Query) => {
      trace.push(where.status ? 'artist.active' : 'artist.original');
      if (!where.status) return where.id === state.artist.id ? state.artist : null;
      const alternatives = where.OR as Array<Record<string, unknown>>;
      return state.saleActive && alternatives.some(item => item.id === state.artist.id || item.slug === state.artist.slug)
        ? { ...state.artist, status: 'active' } : null;
    }) },
    boostProduct: { ...writeTraps('product'), findFirst: jest.fn(async ({ where }: Query) => {
      trace.push(where.status ? 'product.active' : 'product.original');
      if (where.status) return state.saleActive ? { ...state.product, status: 'active',
        priceLumina: new Decimal(state.currentUnit) } : null;
      return where.id === state.product.id && where.sku === state.product.sku ? state.product : null;
    }) },
    artistBoostEvent: { ...writeTraps('event'),
      findUnique: jest.fn(async (_query: Query) => { trace.push('event.original'); return state.event; }),
      findMany: jest.fn(async (_query: Query) => { trace.push('quota'); return [] as Array<{ metadata: unknown }>; }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.createdEvent = { id: ID.event, ...data }; return state.createdEvent;
      }),
    },
    walletAccount: { ...writeTraps('wallet'),
      findFirst: jest.fn(async (_query: Query) => { trace.push('wallet.original'); return state.wallet; }),
      findUnique: jest.fn(async (_query: Query) => { trace.push('wallet.current'); return state.wallet; }),
      updateMany: jest.fn(async ({ data }: { where: Record<string, unknown>; data: { cachedBalance: { decrement: Decimal } } }) => {
        state.balance = state.balance.minus(data.cachedBalance.decrement); return { count: 1 };
      }),
    },
    walletLedger: { ...writeTraps('ledger'), create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.ledger = { id: ID.ledger, ...data }; return state.ledger;
    }) },
  };
  const prisma = {
    boostCampaign: outer('outer.campaign'), artist: outer('outer.artist'), boostProduct: outer('outer.product'),
    artistBoostEvent: outer('outer.event'), walletAccount: outer('outer.wallet'), walletLedger: outer('outer.ledger'),
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => { trace.push('transaction'); return callback(tx); }),
  };
  return { state, trace, tx, prisma, service: new BoostsService(prisma as never) };
}
type Harness = ReturnType<typeof harness>;

function noOuterAccess(h: Harness) {
  for (const delegate of [h.prisma.boostCampaign, h.prisma.artist, h.prisma.boostProduct,
    h.prisma.artistBoostEvent, h.prisma.walletAccount, h.prisma.walletLedger]) {
    for (const method of Object.values(delegate)) expect(method).not.toHaveBeenCalled();
  }
}
function noWrites(h: Harness) {
  for (const delegate of [h.tx.boostCampaign, h.tx.artist, h.tx.boostProduct,
    h.tx.artistBoostEvent, h.tx.walletAccount, h.tx.walletLedger]) {
    for (const name of ['create', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'] as const) {
      expect(delegate[name]).not.toHaveBeenCalled();
    }
  }
  expect(h.tx.$executeRaw).not.toHaveBeenCalled(); noOuterAccess(h);
  expect(h.state.balance.toString()).toBe('1000');
  expect(h.state.ledger).toBeNull(); expect(h.state.createdEvent).toBeNull();
}
function noCurrentReads(h: Harness) {
  expect(h.tx.boostCampaign.findFirst).not.toHaveBeenCalled();
  for (const query of h.tx.artist.findFirst.mock.calls) expect(query[0].where).not.toHaveProperty('status');
  for (const query of h.tx.boostProduct.findFirst.mock.calls) expect(query[0].where).not.toHaveProperty('status');
  expect(h.tx.artistBoostEvent.findMany).not.toHaveBeenCalled();
  expect(h.tx.walletAccount.findUnique).not.toHaveBeenCalled(); noOuterAccess(h);
}
async function rejected(promise: Promise<unknown>, code: string, type: typeof BadRequestException | typeof ConflictException = ConflictException) {
  let error: unknown;
  try { await promise; } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(type);
  expect(error).toMatchObject({ response: { code, walletMutation: false } });
}

describe('paid-like legacy price requirement and original receipt recovery', () => {
  it.each([
    [1, '10', true], [5, '11', true], [20, '0', true], ['5', 'NaN', true], [undefined, '99', false],
  ] as const)('blocks a new legacy quantity %s before reading current price %s (active %s)', async (quantity, unit, active) => {
    const h = harness(); h.state.currentUnit = unit; h.state.saleActive = active;
    await rejected(h.service.createPaidLike(ID.owner, request({ quantity })),
      'BOOST_PAID_LIKE_PRICE_REQUIRED', BadRequestException);
    expect(h.trace).toEqual(['transaction', 'lock', 'event.original']);
    expect(h.tx.artistBoostEvent.findUnique).toHaveBeenCalledWith({ where: { idempotencyKey: key }, include: { walletLedger: true } });
    expect(h.tx.artist.findFirst).not.toHaveBeenCalled(); expect(h.tx.boostProduct.findFirst).not.toHaveBeenCalled();
    expect(h.tx.walletAccount.findFirst).not.toHaveBeenCalled(); noCurrentReads(h); noWrites(h);
  });

  it('does not inspect or charge a legacy request when its transaction lock fails', async () => {
    const h = harness(); h.tx.$queryRaw.mockRejectedValue(new Error('Synthetic lock failure'));
    await expect(h.service.createPaidLike(ID.owner, request())).rejects.toThrow('Synthetic lock failure');
    expect(h.tx.artistBoostEvent.findUnique).not.toHaveBeenCalled(); noCurrentReads(h); noWrites(h);
  });

  it.each([undefined, '1.45'])('recovers an original receipt with inactive sale rows and expected %s', async expected => {
    const h = harness(); h.state.event = receipt(); h.state.wallet!.status = 'inactive';
    const result = await h.service.createPaidLike(ID.owner, request({ expectedTotalPriceLumina: expected }));
    expect(result.idempotentReplay).toBe(true); expect(result.event).toBe(h.state.event);
    expect(result.paidLike.unitPriceLumina.toString()).toBe('0.29'); expect(result.paidLike.totalPriceLumina.toString()).toBe('1.45');
    expect(h.trace.slice(0, 3)).toEqual(['transaction', 'lock', 'event.original']);
    expect(h.tx.artist.findFirst).toHaveBeenCalledWith({ where: { id: ID.artist }, select: { id: true, slug: true } });
    expect(h.tx.boostProduct.findFirst).toHaveBeenCalledWith({ where: { id: ID.product, sku: 'BOOST_BASIC_VOTE' } });
    expect(h.tx.walletAccount.findFirst).toHaveBeenCalledWith({ where: { userId: ID.owner, currencyCode: 'LUMINA' } });
    noCurrentReads(h); noWrites(h);
  });

  it('returns historical raw boost counts even when current product boost and price are unusable', async () => {
    const h = harness(); h.state.event = receipt(); h.state.product.priceLumina = new Decimal('NaN');
    h.state.product.boostAmount = new Decimal(999);
    const result = await h.service.createPaidLike(ID.owner, request());
    expect(result.paidLike.totalBoostAmount.toString()).toBe('15');
    expect(result.paidLike.unitBoostAmount.toString()).toBe('3');
    expect(result.event.weightedScore.toString()).toBe('45'); noCurrentReads(h); noWrites(h);
  });

  it('uses the stored historical artist slug after the original artist is renamed', async () => {
    const h = harness(); h.state.event = receipt(); h.state.artist.slug = 'renamed-artist';
    const result = await h.service.createPaidLike(ID.owner, request({ artistId: undefined, artistSlug: slug }));
    expect(result.idempotentReplay).toBe(true); noCurrentReads(h); noWrites(h);
  });

  it.each([
    { artistId: ID.artist, artistSlug: undefined }, { artistId: undefined, artistSlug: slug },
    { artistId: ID.artist, artistSlug: slug }, { artistId: slug, artistSlug: slug },
    { artistId: ` ${ID.artist} `, artistSlug: ` ${slug} ` },
  ])('accepts matching normalized original identifiers %j', async identifiers => {
    const h = harness(); h.state.event = receipt(); delete h.state.event.metadata.artistSlug;
    const result = await h.service.createPaidLike(ID.owner, request(identifiers));
    expect(result.idempotentReplay).toBe(true); noCurrentReads(h); noWrites(h);
  });

  it.each([
    { artistId: ID.artist, artistSlug: 'wrong-slug' }, { artistId: ID.other, artistSlug: slug },
    { artistId: slug, artistSlug: 'wrong-slug' }, { artistId: undefined, artistSlug: undefined },
  ])('rejects any contradictory or absent original artist identifier %j', async identifiers => {
    const h = harness(); h.state.event = receipt();
    await rejected(h.service.createPaidLike(ID.owner, request(identifiers)), 'BOOST_IDEMPOTENCY_CONFLICT');
    noCurrentReads(h); noWrites(h);
  });

  it.each(['userId', 'campaignId'] as const)('rejects wrong original %s before historical row or wallet reads', async field => {
    const h = harness(); h.state.event = receipt(); h.state.event[field] = ID.other;
    await rejected(h.service.createPaidLike(ID.owner, request()), 'BOOST_IDEMPOTENCY_CONFLICT');
    expect(h.tx.artist.findFirst).not.toHaveBeenCalled(); expect(h.tx.boostProduct.findFirst).not.toHaveBeenCalled();
    expect(h.tx.walletAccount.findFirst).not.toHaveBeenCalled(); noCurrentReads(h); noWrites(h);
  });

  it.each(['artist', 'product', 'SKU'] as const)('rejects an unavailable original %s without falling back to an active product', async field => {
    const h = harness(); h.state.event = receipt(); h.state.saleActive = true;
    if (field === 'artist') h.state.event.artistId = ID.other;
    if (field === 'product') h.state.event.boostProductId = ID.other;
    if (field === 'SKU') h.state.product.sku = 'OTHER_PRODUCT';
    await rejected(h.service.createPaidLike(ID.owner, request()), 'BOOST_IDEMPOTENCY_CONFLICT');
    noCurrentReads(h); noWrites(h);
  });

  const corruptReceipt: Array<[string, (event: Receipt) => void]> = [
    ['intent key', event => { event.idempotencyKey = 'wrong-key'; }],
    ['quantity', event => { event.metadata.quantity = 4; }],
    ['source', event => { event.metadata.source = 'boost_order'; }],
    ['boost type', event => { event.boostType = 'free_like'; }],
    ['missing ledger', event => { event.walletLedger = null as unknown as Receipt['walletLedger']; }],
    ['ledger link', event => { event.walletLedgerId = ID.other; }],
    ['ledger direction', event => { event.walletLedger.direction = 'credit'; }],
    ['ledger type', event => { event.walletLedger.ledgerType = 'other_spend'; }],
    ['ledger reference type', event => { event.walletLedger.referenceType = 'other'; }],
    ['ledger reference product', event => { event.walletLedger.referenceId = ID.other; }],
    ['ledger key', event => { event.walletLedger.idempotencyKey = 'wallet:boost-order:wrong'; }],
    ['ledger amount', event => { event.walletLedger.amount = new Decimal('1.46'); }],
    ['missing total', event => { delete event.metadata.totalPriceLumina; }],
    ['zero total', event => { event.metadata.totalPriceLumina = '0'; event.walletLedger.amount = new Decimal(0); }],
    ['malformed unit', event => { event.metadata.unitPriceLumina = null; }],
    ['inconsistent unit', event => { event.metadata.unitPriceLumina = '0.30'; }],
    ['zero raw count', event => { event.rawAmount = new Decimal(0); }],
    ['negative raw count', event => { event.rawAmount = new Decimal(-1); }],
    ['infinite raw count', event => { event.rawAmount = new Decimal('Infinity'); }],
    ['NaN raw count', event => { event.rawAmount = new Decimal('NaN'); }],
    ['non-Decimal raw count', event => { event.rawAmount = 15 as unknown as Decimal; }],
  ];
  it.each(corruptReceipt)('rejects corrupt legacy %s with no replacement debit', async (_label, mutate) => {
    const h = harness(); h.state.event = receipt(); mutate(h.state.event);
    await rejected(h.service.createPaidLike(ID.owner, request()), 'BOOST_IDEMPOTENCY_CONFLICT');
    noCurrentReads(h); noWrites(h);
  });

  it.each(['missing', 'owner', 'currency', 'ledger wallet'] as const)('requires the original own LUMINA wallet: %s', async field => {
    const h = harness(); h.state.event = receipt();
    if (field === 'missing') h.state.wallet = null;
    if (field === 'owner') h.state.wallet!.userId = ID.other;
    if (field === 'currency') h.state.wallet!.currencyCode = 'KRW';
    if (field === 'ledger wallet') h.state.event.walletLedger.walletAccountId = ID.other;
    await rejected(h.service.createPaidLike(ID.owner, request()), 'BOOST_IDEMPOTENCY_CONFLICT');
    noCurrentReads(h); noWrites(h);
  });

  it.each([['0.29', 5], ['2.75', 10]] as const)('derives exact original unit %s for quantity %s when legacy unit is absent', async (unit, quantity) => {
    const h = harness(); h.state.event = receipt(unit, quantity); delete h.state.event.metadata.unitPriceLumina;
    h.state.event.metadata.quantity = String(quantity);
    const result = await h.service.createPaidLike(ID.owner, request({ quantity }));
    expect(result.paidLike.unitPriceLumina.toString()).toBe(unit); noCurrentReads(h); noWrites(h);
  });

  it.each(['0.01', '1'])('cannot derive a valid-cent original unit from total %s divided by three', async total => {
    const h = harness(); h.state.event = receipt('1', 3); delete h.state.event.metadata.unitPriceLumina;
    h.state.event.metadata.totalPriceLumina = total; h.state.event.walletLedger.amount = new Decimal(total);
    await rejected(h.service.createPaidLike(ID.owner, request({ quantity: 3 })), 'BOOST_IDEMPOTENCY_CONFLICT');
    noCurrentReads(h); noWrites(h);
  });

  it.each([null, 1.45, '', '1e0', '1.450', ' 1.45 '])('rejects supplied malformed expectation %j even for a valid receipt', async expected => {
    const h = harness(); h.state.event = receipt();
    await rejected(h.service.createPaidLike(ID.owner, request({ expectedTotalPriceLumina: expected as string })),
      'BOOST_PAID_LIKE_PRICE_INVALID', BadRequestException);
    expect(h.prisma.$transaction).not.toHaveBeenCalled(); noWrites(h);
  });

  it('rejects a new-price expectation that differs from the validated original receipt', async () => {
    const h = harness(); h.state.event = receipt(); h.state.saleActive = true;
    await rejected(h.service.createPaidLike(ID.owner, request({ expectedTotalPriceLumina: '1.50' })),
      'BOOST_PAID_LIKE_PRICE_MISMATCH'); noCurrentReads(h); noWrites(h);
  });

  it.each([
    { artistId: ID.artist, artistSlug: 'wrong-slug' }, { artistId: ID.other, artistSlug: slug },
  ])('rejects contradictory new paid-like identifiers %j before quota or wallet access', async identifiers => {
    const h = harness(); h.state.saleActive = true;
    await rejected(h.service.createPaidLike(ID.owner, request({ ...identifiers, expectedTotalPriceLumina: '1.50' })),
      'BOOST_IDEMPOTENCY_CONFLICT');
    expect(h.tx.artistBoostEvent.findMany).not.toHaveBeenCalled();
    expect(h.tx.walletAccount.findUnique).not.toHaveBeenCalled(); noWrites(h);
  });

  it('admits a modern exact confirmed charge with owner, currency, active status and balance guarded together', async () => {
    const h = harness(); h.state.saleActive = true;
    const result = await h.service.createPaidLike(ID.owner, request({ expectedTotalPriceLumina: '1.50' }));
    expect(result.idempotentReplay).toBe(false); expect(result.paidLike.totalPriceLumina.toString()).toBe('1.5');
    expect(h.tx.walletAccount.updateMany).toHaveBeenCalledWith({
      where: { id: ID.wallet, userId: ID.owner, currencyCode: 'LUMINA', status: 'active',
        cachedBalance: { gte: new Decimal('1.50') } },
      data: { cachedBalance: { decrement: new Decimal('1.50') } },
    });
    expect((h.state.ledger!.amount as Decimal).toString()).toBe('1.5');
    expect(h.tx.walletLedger.create).toHaveBeenCalledTimes(1); expect(h.tx.artistBoostEvent.create).toHaveBeenCalledTimes(1);
    expect(h.trace.slice(0, 3)).toEqual(['transaction', 'lock', 'event.original']); noOuterAccess(h);
  });

  it('creates no ledger or event when the wallet stops being active before the guarded debit', async () => {
    const h = harness(); h.state.saleActive = true;
    h.tx.walletAccount.updateMany.mockImplementation(async ({ where }) => {
      h.state.wallet!.status = 'inactive';
      expect(where).toMatchObject({ id: ID.wallet, userId: ID.owner, currencyCode: 'LUMINA', status: 'active' });
      return { count: 0 };
    });
    await expect(h.service.createPaidLike(ID.owner, request({ expectedTotalPriceLumina: '1.50' })))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(h.tx.walletAccount.updateMany).toHaveBeenCalledTimes(1);
    expect(h.tx.walletLedger.create).not.toHaveBeenCalled(); expect(h.tx.artistBoostEvent.create).not.toHaveBeenCalled();
    expect(h.state.balance.toString()).toBe('1000'); noOuterAccess(h);
  });
});
