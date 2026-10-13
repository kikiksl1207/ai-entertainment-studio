import { BadRequestException, ConflictException } from '@nestjs/common';
import { BoostProduct, Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { BoostsService } from './boosts.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const native = url ? describe : describe.skip;
const sku = 'BOOST_BASIC_VOTE';
type Input = Parameters<BoostsService['createPaidLike']>[1];
type Receipt = Awaited<ReturnType<BoostsService['createPaidLike']>>;
jest.setTimeout(30000);

native('legacy paid-like price requirement (owned PostgreSQL, no provider)', () => {
  let db: PrismaClient;
  let product: BoostProduct;
  let originalProduct: BoostProduct | null = null;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432'
      || parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash
      || !/^\/lumina_failed_cost_qa_[a-f0-9]{12}$/.test(parsed.pathname)) {
      throw new Error('Dedicated loopback QA database required');
    }
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    const existing = await db.boostProduct.findUnique({ where: { sku } });
    // The unchanged confirmation spec creates this synthetic singleton in the same QA DB.
    if (existing) {
      if (existing.name !== 'Synthetic vote') throw new Error('Refusing a non-synthetic paid-like product');
      const foreignEvents = await db.artistBoostEvent.count({ where: { boostProductId: existing.id, OR: [{ idempotencyKey: null }, { NOT: {
        AND: [{ campaign: { slug: { startsWith: 'synthetic-' } } }, { artist: { slug: { startsWith: 'synthetic-' } } },
          { idempotencyKey: { startsWith: 'synthetic-' } }],
      } }] } });
      if (foreignEvents) throw new Error('Refusing non-synthetic product references');
      originalProduct = existing;
      product = existing;
    } else {
      product = await db.boostProduct.create({ data: {
        sku, name: 'Synthetic vote', priceLumina: '0.29', boostAmount: '1.25',
        metadata: { source: 'synthetic-paid-legacy-price-required' },
      } });
    }
  });
  beforeEach(async () => {
    await db.boostProduct.update({ where: { id: product.id }, data: {
      priceLumina: '0.29', boostAmount: '1.25', status: 'active',
    } });
  });
  afterAll(async () => {
    try {
      if (originalProduct) await db.boostProduct.update({ where: { id: originalProduct.id }, data: {
        priceLumina: originalProduct.priceLumina, boostAmount: originalProduct.boostAmount,
        status: originalProduct.status,
      } });
    } finally { await db?.$disconnect(); }
  });

  async function prepared(createWallet = true) {
    const nonce = randomUUID();
    const owner = await db.user.create({ data: {} });
    const artist = await db.artist.create({ data: {
      slug: 'synthetic-legacy-' + nonce, displayName: 'Synthetic legacy artist', status: 'active',
    } });
    const campaign = await db.boostCampaign.create({ data: {
      slug: 'synthetic-legacy-' + nonce, name: 'Synthetic legacy campaign', status: 'active',
      startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 86400000), luminaBoostWeight: '2',
    } });
    const wallet = createWallet ? await db.walletAccount.create({ data: { userId: owner.id, cachedBalance: '1000' } }) : null;
    const input: Input = { campaignId: campaign.id, artistId: artist.id, quantity: 5,
      idempotencyKey: 'synthetic-legacy-' + nonce, expectedTotalPriceLumina: '1.45' };
    return { owner, artist, campaign, wallet, input, ownerIds: [owner.id], service: new BoostsService(db as never) };
  }
  type Fixture = Awaited<ReturnType<typeof prepared>>;
  const legacy = (f: Fixture, changes: Partial<Input> = {}): Input => {
    const { expectedTotalPriceLumina: _unused, ...input } = f.input;
    return { ...input, ...changes };
  };
  async function state(f: Fixture) {
    return {
      wallets: await db.walletAccount.findMany({ where: { userId: { in: f.ownerIds } }, orderBy: { id: 'asc' } }),
      ledgers: await db.walletLedger.findMany({ where: { OR: [
        { walletAccount: { userId: { in: f.ownerIds } } },
        { idempotencyKey: { startsWith: `wallet:boost-paid-like:${f.input.idempotencyKey}` } },
      ] }, orderBy: { id: 'asc' } }),
      events: await db.artistBoostEvent.findMany({ where: { OR: [
        { userId: { in: f.ownerIds } }, { idempotencyKey: { startsWith: f.input.idempotencyKey! } },
      ] }, orderBy: { id: 'asc' } }),
      product: await db.boostProduct.findUnique({ where: { id: product.id } }),
      rowCounts: [await db.walletAccount.count(), await db.walletLedger.count(), await db.artistBoostEvent.count()],
    };
  }
  async function rejected(promise: Promise<unknown>, code: string,
    type: typeof ConflictException | typeof BadRequestException = ConflictException) {
    let error: unknown;
    try { await promise; } catch (e) { error = e; }
    expect(error).toBeInstanceOf(type);
    expect(error).toMatchObject({ response: { code, walletMutation: false } });
  }
  function originalReplay(result: Receipt, original: Receipt) {
    expect(result.idempotentReplay).toBe(true);
    expect(result.event).toEqual(original.event);
    expect(result.paidLike.quantity).toBe(5);
    expect(result.paidLike.unitPriceLumina?.toString()).toBe('0.29');
    expect(result.paidLike.totalPriceLumina?.toString()).toBe('1.45');
    expect(result.paidLike.unitBoostAmount.toString()).toBe('1.25');
    expect(result.paidLike.totalBoostAmount.toString()).toBe('6.25');
    expect(result.wallet?.cachedBalance.toString()).toBe('998.55');
  }
  async function contended(f: Fixture, submit: () => Promise<PromiseSettledResult<Receipt>[]>) {
    let release!: () => void, started!: () => void;
    const hold = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { started = r; });
    const holder = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`boost-paid-like:${f.campaign.id}:${f.owner.id}`}, 0))::text`;
      started(); await hold;
    }, { timeout: 15000 });
    await Promise.race([ready, holder.then(() => { throw new Error('Synthetic lock holder ended early'); })]);
    const outcomes = submit();
    let waiting = 0;
    try {
      const end = Date.now() + 3000;
      while (waiting < 2 && Date.now() < end) {
        const rows = await db.$queryRaw<Array<{ waiting: number }>>`SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event = 'advisory' AND state = 'active'`;
        waiting = rows[0]?.waiting ?? 0;
        if (waiting < 2) await new Promise(r => setTimeout(r, 20));
      }
    } finally { release(); await holder; }
    const result = await outcomes;
    expect(waiting).toBe(2);
    return result;
  }
  function instrument(wrap: (tx: Prisma.TransactionClient) => Prisma.TransactionClient, entered: () => void = () => {}) {
    return new Proxy(db, { get(target, property) {
      if (property === '$transaction') return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => {
        entered(); return db.$transaction(tx => callback(wrap(tx)), options);
      };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  }

  it('omitted NEW confirmation cannot debit or create rows, including a missing wallet', async () => {
    for (const createWallet of [true, false]) {
      const f = await prepared(createWallet), before = await state(f);
      await rejected(f.service.createPaidLike(f.owner.id, legacy(f)), 'BOOST_PAID_LIKE_PRICE_REQUIRED', BadRequestException);
      expect(await state(f)).toEqual(before);
    }
  });

  it('a distinct NEW legacy key cannot borrow another completed receipt', async () => {
    const f = await prepared(); await f.service.createPaidLike(f.owner.id, f.input);
    const before = await state(f);
    await rejected(f.service.createPaidLike(f.owner.id, legacy(f, { idempotencyKey: f.input.idempotencyKey + '-new' })),
      'BOOST_PAID_LIKE_PRICE_REQUIRED', BadRequestException);
    expect(await state(f)).toEqual(before);
  });

  it('a modern confirmation commits exactly the fractional original debit and boosts', async () => {
    const f = await prepared(), result = await f.service.createPaidLike(f.owner.id, f.input), s = await state(f);
    expect(result.idempotentReplay).toBe(false);
    expect(s.wallets[0].cachedBalance.toString()).toBe('998.55');
    expect(s.events).toHaveLength(1); expect(s.ledgers).toHaveLength(1);
    expect(s.ledgers[0]).toMatchObject({ direction: 'debit', ledgerType: 'boost_spend', referenceType: 'boost_product',
      referenceId: product.id, walletAccountId: f.wallet!.id, idempotencyKey: `wallet:boost-paid-like:${f.input.idempotencyKey}` });
    expect(s.ledgers[0].amount.toString()).toBe('1.45');
    expect(s.events[0].walletLedgerId).toBe(s.ledgers[0].id);
    expect(s.events[0].rawAmount.toString()).toBe('6.25');
    expect(s.events[0].weightedScore.toString()).toBe('12.5');
    expect(s.events[0].metadata).toMatchObject({ source: 'paid_like', quantity: 5, unitPriceLumina: '0.29', totalPriceLumina: '1.45' });
    expect(result.paidLike.totalPriceLumina?.toString()).toBe('1.45');
  });

  it('omitted replay remains exact and read-only after price/boost changes and all sale contexts end', async () => {
    const f = await prepared(), original = await f.service.createPaidLike(f.owner.id, f.input);
    await db.boostProduct.update({ where: { id: product.id }, data: { priceLumina: '99', boostAmount: '9', status: 'inactive' } });
    await db.boostCampaign.update({ where: { id: f.campaign.id }, data: { status: 'closed', endsAt: new Date(Date.now() - 1000) } });
    await db.artist.update({ where: { id: f.artist.id }, data: { status: 'archived', slug: f.artist.slug + '-renamed' } });
    await db.walletAccount.update({ where: { id: f.wallet!.id }, data: { status: 'frozen' } });
    const before = await state(f);
    for (const identity of [{ artistId: f.artist.id }, { artistId: undefined, artistSlug: f.artist.slug }, { artistId: f.artist.slug }]) {
      originalReplay(await f.service.createPaidLike(f.owner.id, legacy(f, identity)), original);
      expect(await state(f)).toEqual(before);
    }
  });

  it('wrong owner/campaign/artist/quantity/confirmed total conflict without writes', async () => {
    const f = await prepared(); await f.service.createPaidLike(f.owner.id, f.input);
    const other = await db.user.create({ data: {} }); f.ownerIds.push(other.id);
    await db.walletAccount.create({ data: { userId: other.id, cachedBalance: '1000' } });
    const before = await state(f);
    const attempts: Array<[string, Input, string]> = [
      [other.id, legacy(f), 'BOOST_IDEMPOTENCY_CONFLICT'],
      [f.owner.id, legacy(f, { campaignId: randomUUID() }), 'BOOST_IDEMPOTENCY_CONFLICT'],
      [f.owner.id, legacy(f, { artistId: randomUUID() }), 'BOOST_IDEMPOTENCY_CONFLICT'],
      [f.owner.id, legacy(f, { artistSlug: 'synthetic-wrong-artist' }), 'BOOST_IDEMPOTENCY_CONFLICT'],
      [f.owner.id, legacy(f, { quantity: 4 }), 'BOOST_IDEMPOTENCY_CONFLICT'],
      [f.owner.id, { ...f.input, expectedTotalPriceLumina: '495' }, 'BOOST_PAID_LIKE_PRICE_MISMATCH'],
    ];
    for (const [owner, input, code] of attempts) {
      await rejected(f.service.createPaidLike(owner, input), code); expect(await state(f)).toEqual(before);
    }
  });

  it('malformed original metadata, ledger, reference and wallet evidence fail closed', async () => {
    const f = await prepared(), receipt = await f.service.createPaidLike(f.owner.id, f.input);
    const ledger = await db.walletLedger.findUniqueOrThrow({ where: { id: receipt.event.walletLedgerId! } });
    const metadata = receipt.event.metadata as Prisma.JsonObject;
    const other = await db.user.create({ data: {} }); f.ownerIds.push(other.id);
    const otherWallet = await db.walletAccount.create({ data: { userId: other.id, cachedBalance: '1000' } });
    const mutations: Array<{ event?: Prisma.ArtistBoostEventUpdateInput; ledger?: Prisma.WalletLedgerUncheckedUpdateInput }> = [
      { event: { metadata: { ...metadata, source: 'boost_order' } } },
      { event: { metadata: { ...metadata, totalPriceLumina: '0' } } },
      { event: { metadata: { source: 'paid_like', quantity: 5, unitPriceLumina: '0.29' } } },
      { event: { metadata: { ...metadata, totalPriceLumina: '1.4501' } } },
      { ledger: { amount: '1.44' } }, { ledger: { direction: 'credit' } }, { ledger: { ledgerType: 'adjustment' } },
      { ledger: { referenceType: 'gift_product' } }, { ledger: { referenceId: randomUUID() } },
      { ledger: { idempotencyKey: ledger.idempotencyKey + '-wrong' } }, { ledger: { walletAccountId: otherWallet.id } },
    ];
    for (const mutation of mutations) {
      if (mutation.event) await db.artistBoostEvent.update({ where: { id: receipt.event.id }, data: mutation.event });
      if (mutation.ledger) await db.walletLedger.update({ where: { id: ledger.id }, data: mutation.ledger });
      const before = await state(f);
      await rejected(f.service.createPaidLike(f.owner.id, legacy(f)), 'BOOST_IDEMPOTENCY_CONFLICT');
      expect(await state(f)).toEqual(before);
      await db.artistBoostEvent.update({ where: { id: receipt.event.id }, data: { metadata: metadata as Prisma.InputJsonObject } });
      await db.walletLedger.update({ where: { id: ledger.id }, data: { amount: ledger.amount, direction: ledger.direction,
        ledgerType: ledger.ledgerType, referenceType: ledger.referenceType, referenceId: ledger.referenceId,
        idempotencyKey: ledger.idempotencyKey, walletAccountId: ledger.walletAccountId } });
    }
    await db.walletAccount.update({ where: { id: f.wallet!.id }, data: { currencyCode: 'SYNTHETIC_NOT_LUMINA' } });
    const before = await state(f);
    await rejected(f.service.createPaidLike(f.owner.id, legacy(f)), 'BOOST_IDEMPOTENCY_CONFLICT');
    expect(await state(f)).toEqual(before);
  });

  it('missing unit can derive from original total/quantity; present malformed unit cannot', async () => {
    const f = await prepared(), original = await f.service.createPaidLike(f.owner.id, f.input);
    const { unitPriceLumina: _unit, ...metadata } = original.event.metadata as Prisma.JsonObject;
    await db.artistBoostEvent.update({ where: { id: original.event.id }, data: { metadata: metadata as Prisma.InputJsonObject } });
    const before = await state(f), replay = await f.service.createPaidLike(f.owner.id, legacy(f));
    expect(replay.idempotentReplay).toBe(true); expect(replay.paidLike.unitPriceLumina?.toString()).toBe('0.29');
    expect(replay.paidLike.totalPriceLumina?.toString()).toBe('1.45'); expect(await state(f)).toEqual(before);
    await db.artistBoostEvent.update({ where: { id: original.event.id }, data: {
      metadata: { ...metadata, unitPriceLumina: 'not-a-price' } as Prisma.InputJsonObject,
    } });
    const malformed = await state(f);
    await rejected(f.service.createPaidLike(f.owner.id, legacy(f)), 'BOOST_IDEMPOTENCY_CONFLICT');
    expect(await state(f)).toEqual(malformed);
  });

  it('native constraints preserve positive raw amounts and required paid ledger links', async () => {
    const f = await prepared(), original = await f.service.createPaidLike(f.owner.id, f.input), before = await state(f);
    await expect(db.artistBoostEvent.update({ where: { id: original.event.id }, data: { rawAmount: '0' } })).rejects.toThrow();
    await expect(db.artistBoostEvent.update({ where: { id: original.event.id }, data: { walletLedger: { disconnect: true } } })).rejects.toThrow();
    expect(await state(f)).toEqual(before);
    originalReplay(await f.service.createPaidLike(f.owner.id, legacy(f)), original);
    expect(await state(f)).toEqual(before);
  });

  it('simultaneous confirmed and unconfirmed same-key requests debit once or reject the missing NEW confirmation', async () => {
    const f = await prepared(), results = await contended(f, () => Promise.allSettled([
      f.service.createPaidLike(f.owner.id, f.input), f.service.createPaidLike(f.owner.id, legacy(f)),
    ]));
    expect(results[0].status).toBe('fulfilled');
    const confirmed = (results[0] as PromiseFulfilledResult<Receipt>).value;
    expect(confirmed.idempotentReplay).toBe(false);
    if (results[1].status === 'fulfilled') originalReplay(results[1].value, confirmed);
    else {
      expect(results[1].reason).toBeInstanceOf(BadRequestException);
      expect(results[1].reason).toMatchObject({ response: { code: 'BOOST_PAID_LIKE_PRICE_REQUIRED', walletMutation: false } });
    }
    const before = await state(f); expect(before.events).toHaveLength(1); expect(before.ledgers).toHaveLength(1);
    expect(before.wallets[0].cachedBalance.toString()).toBe('998.55');
    originalReplay(await f.service.createPaidLike(f.owner.id, legacy(f)), confirmed);
    expect(await state(f)).toEqual(before);
  });

  it('two concurrent legacy NEW requests both reject, for same and distinct keys', async () => {
    for (const distinct of [false, true]) {
      const f = await prepared(), before = await state(f);
      const results = await contended(f, () => Promise.allSettled([
        f.service.createPaidLike(f.owner.id, legacy(f)),
        f.service.createPaidLike(f.owner.id, legacy(f, { idempotencyKey: f.input.idempotencyKey + (distinct ? '-new' : '') })),
      ]));
      for (const result of results) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
          expect(result.reason).toBeInstanceOf(BadRequestException);
          expect(result.reason).toMatchObject({ response: { code: 'BOOST_PAID_LIKE_PRICE_REQUIRED', walletMutation: false } });
        }
      }
      expect(await state(f)).toEqual(before);
    }
  });

  it('an injected ledger failure after a real debit rolls back without auto retry', async () => {
    const f = await prepared(), before = await state(f);
    let transactions = 0, ledgerAttempts = 0, debitRows = 0;
    const client = instrument(tx => new Proxy(tx, { get(target, property) {
      if (property === 'walletLedger') return new Proxy(target.walletLedger, { get(delegate, method) {
        if (method === 'create') return async () => { ledgerAttempts++; throw new Error('Synthetic legacy ledger failure'); };
        const value = Reflect.get(delegate, method); return typeof value === 'function' ? value.bind(delegate) : value;
      } });
      if (property === 'walletAccount') return new Proxy(target.walletAccount, { get(delegate, method) {
        if (method === 'updateMany') return async (args: Prisma.WalletAccountUpdateManyArgs) => {
          const result = await delegate.updateMany(args); debitRows += result.count; return result;
        };
        const value = Reflect.get(delegate, method); return typeof value === 'function' ? value.bind(delegate) : value;
      } });
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } }), () => { transactions++; });
    await expect(new BoostsService(client as never).createPaidLike(f.owner.id, f.input)).rejects.toThrow('Synthetic legacy ledger failure');
    expect(transactions).toBe(1); expect(ledgerAttempts).toBe(1); expect(debitRows).toBe(1);
    expect(await state(f)).toEqual(before);
  });

  it('contradictory normalized artist identifiers cannot authorize a NEW debit', async () => {
    const f = await prepared();
    const other = await db.artist.create({ data: { slug: 'synthetic-legacy-other-' + randomUUID(), displayName: 'Synthetic other', status: 'active' } });
    const before = await state(f);
    await rejected(f.service.createPaidLike(f.owner.id, { ...f.input, artistId: ` ${f.artist.id} `, artistSlug: ` ${other.slug} ` }),
      'BOOST_IDEMPOTENCY_CONFLICT');
    expect(await state(f)).toEqual(before);
  });

  it('freezing the wallet after lookup but before debit invalidates the NEW charge', async () => {
    const f = await prepared();
    let invalidated: Awaited<ReturnType<typeof state>> | undefined, debitRows = -1, attempts = 0;
    const client = instrument(tx => new Proxy(tx, { get(target, property) {
      if (property === 'walletAccount') return new Proxy(target.walletAccount, { get(delegate, method) {
        if (method === 'updateMany') return async (args: Prisma.WalletAccountUpdateManyArgs) => {
          attempts++;
          await db.walletAccount.update({ where: { id: f.wallet!.id }, data: { status: 'frozen' } });
          invalidated = await state(f);
          const result = await delegate.updateMany(args); debitRows = result.count; return result;
        };
        const value = Reflect.get(delegate, method); return typeof value === 'function' ? value.bind(delegate) : value;
      } });
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } }));
    await expect(new BoostsService(client as never).createPaidLike(f.owner.id, f.input)).rejects.toBeInstanceOf(BadRequestException);
    expect(attempts).toBe(1); expect(debitRows).toBe(0); expect(invalidated).toBeDefined();
    expect(await state(f)).toEqual(invalidated);
  });

  it('an orphan ledger is not a receipt and cannot cause false-success or a second charge', async () => {
    const f = await prepared();
    await db.walletLedger.create({ data: { walletAccountId: f.wallet!.id, direction: 'debit', amount: '1.45',
      ledgerType: 'boost_spend', referenceType: 'boost_product', referenceId: product.id,
      idempotencyKey: `wallet:boost-paid-like:${f.input.idempotencyKey}`, memo: 'Synthetic incomplete receipt' } });
    const before = await state(f);
    await rejected(f.service.createPaidLike(f.owner.id, legacy(f)), 'BOOST_PAID_LIKE_PRICE_REQUIRED', BadRequestException);
    expect(await state(f)).toEqual(before);
    await expect(f.service.createPaidLike(f.owner.id, f.input)).rejects.toMatchObject({ code: 'P2002' });
    expect(await state(f)).toEqual(before); expect(before.events).toHaveLength(0);
  });
});
