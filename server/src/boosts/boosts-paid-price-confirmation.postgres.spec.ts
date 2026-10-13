import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { BoostsService } from './boosts.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const native = url ? describe : describe.skip;
jest.setTimeout(30000);

native('paid price confirmation (owned PostgreSQL, no provider)', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432'
      || parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash
      || !/^\/lumina_failed_cost_qa_[a-f0-9]{12}$/.test(parsed.pathname)) throw new Error('Dedicated loopback QA database required');
    db = new PrismaClient({ datasources: { db: { url } } }); await db.$connect();
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function prepared(unit = '10', balance = '1000', createWallet = true) {
    const nonce = randomUUID();
    const owner = await db.user.create({ data: {} });
    const artist = await db.artist.create({ data: { slug: 'synthetic-confirmation-' + nonce, displayName: 'Synthetic artist', status: 'active' } });
    const campaign = await db.boostCampaign.create({ data: { slug: 'synthetic-confirmation-' + nonce, name: 'Synthetic campaign',
      status: 'active', startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 86400000) } });
    const product = await db.boostProduct.upsert({ where: { sku: 'BOOST_BASIC_VOTE' },
      create: { sku: 'BOOST_BASIC_VOTE', name: 'Synthetic vote', priceLumina: unit, boostAmount: '1' },
      update: { priceLumina: unit, status: 'active' } });
    const wallet = createWallet ? await db.walletAccount.create({ data: { userId: owner.id, cachedBalance: balance } }) : null;
    const input = { campaignId: campaign.id, artistId: artist.id, quantity: 1, idempotencyKey: 'synthetic-price-' + nonce,
      expectedTotalPriceLumina: unit };
    return { owner, artist, campaign, product, wallet, input, service: new BoostsService(db as never) };
  }
  type Fixture = Awaited<ReturnType<typeof prepared>>;
  async function state(f: Fixture) {
    return {
      wallets: await db.walletAccount.findMany({ where: { userId: f.owner.id }, orderBy: { id: 'asc' } }),
      ledgers: await db.walletLedger.findMany({ where: { walletAccount: { userId: f.owner.id } }, orderBy: { id: 'asc' } }),
      events: await db.artistBoostEvent.findMany({ where: { userId: f.owner.id }, orderBy: { id: 'asc' } }),
    };
  }
  async function rejected(promise: Promise<unknown>, code: string) {
    let error: unknown;
    try { await promise; } catch (e) { error = e; }
    expect(error).toBeInstanceOf(ConflictException);
    expect(error).toMatchObject({ response: { code, walletMutation: false } });
  }

  async function contended(f: Fixture, submit: () => PromiseSettledResult<unknown>[] | Promise<PromiseSettledResult<unknown>[]>) {
    let release!: () => void, started!: () => void;
    const hold = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { started = r; });
    const holder = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`boost-paid-like:${f.campaign.id}:${f.owner.id}`}, 0))::text`;
      started(); await hold;
    }, { timeout: 15000 });
    await ready;
    const outcomes = Promise.resolve(submit()); let waiting = 0;
    try {
      const end = Date.now() + 3000;
      while (waiting < 2 && Date.now() < end) {
        const rows = await db.$queryRaw<Array<{ waiting: number }>>`SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event = 'advisory' AND state = 'active'`;
        waiting = rows[0]?.waiting ?? 0;
        if (waiting < 2) await new Promise(r => setTimeout(r, 20));
      }
    } finally { release(); await holder; }
    const result = await outcomes; expect(waiting).toBe(2); return result;
  }

  it.each([['10', 10, '100', '900'], ['0.29', 5, '1.45', '998.55']] as const)
    ('unit %s quantity %s persists only the confirmed total %s', async (unit, quantity, total, remaining) => {
      const f = await prepared(unit), result = await f.service.createPaidLike(f.owner.id, { ...f.input, quantity, expectedTotalPriceLumina: total });
      expect(result.idempotentReplay).toBe(false); expect(result.paidLike.totalPriceLumina?.equals(total)).toBe(true);
      const s = await state(f); expect(s.wallets).toHaveLength(1); expect(s.ledgers).toHaveLength(1); expect(s.events).toHaveLength(1);
      expect(s.wallets[0].cachedBalance.equals(remaining)).toBe(true); expect(s.ledgers[0].amount.equals(total)).toBe(true);
      expect(s.events[0].walletLedgerId).toBe(s.ledgers[0].id);
      expect((s.events[0].metadata as Record<string, unknown>).totalPriceLumina).toBe(result.paidLike.totalPriceLumina?.toString());
    });

  it('existing DB constraints reject a zero-price paid product without a charge', async () => {
    const f = await prepared(), before = await state(f);
    await expect(db.boostProduct.update({ where: { id: f.product.id }, data: { priceLumina: '0' } })).rejects.toThrow();
    expect((await db.boostProduct.findUniqueOrThrow({ where: { id: f.product.id } })).priceLumina.toString()).toBe('10');
    expect(await state(f)).toEqual(before);
  });

  it('a different displayed total cannot mutate wallet, ledger or event', async () => {
    const f = await prepared('11'), before = await state(f);
    await rejected(f.service.createPaidLike(f.owner.id, { ...f.input, quantity: 10, expectedTotalPriceLumina: '100' }), 'BOOST_PAID_LIKE_PRICE_MISMATCH');
    expect(await state(f)).toEqual(before);
  });

  it('invalid subcent input leaves native rows unchanged', async () => {
    const f = await prepared(), before = await state(f);
    await expect(f.service.createPaidLike(f.owner.id, { ...f.input, expectedTotalPriceLumina: '10.001' })).rejects.toBeInstanceOf(BadRequestException);
    expect(await state(f)).toEqual(before);
  });

  it('replays the original debit after a product-price change without a new write', async () => {
    const f = await prepared(); await f.service.createPaidLike(f.owner.id, f.input);
    await db.boostProduct.update({ where: { id: f.product.id }, data: { priceLumina: '99' } });
    const before = await state(f), result = await f.service.createPaidLike(f.owner.id, f.input);
    expect(result.idempotentReplay).toBe(true); expect(result.paidLike.unitPriceLumina?.toString()).toBe('10');
    expect(result.paidLike.totalPriceLumina?.toString()).toBe('10'); expect(await state(f)).toEqual(before);
  });

  it('matching the new price cannot reinterpret an old receipt', async () => {
    const f = await prepared(); await f.service.createPaidLike(f.owner.id, f.input);
    await db.boostProduct.update({ where: { id: f.product.id }, data: { priceLumina: '99' } });
    const before = await state(f);
    await rejected(f.service.createPaidLike(f.owner.id, { ...f.input, expectedTotalPriceLumina: '99' }), 'BOOST_PAID_LIKE_PRICE_MISMATCH');
    expect(await state(f)).toEqual(before);
  });

  it('another owner cannot replay the original receipt or debit either wallet', async () => {
    const f = await prepared(); await f.service.createPaidLike(f.owner.id, f.input);
    const other = await db.user.create({ data: {} });
    const otherWallet = await db.walletAccount.create({ data: { userId: other.id, cachedBalance: '1000' } });
    const before = await state(f);
    await rejected(f.service.createPaidLike(other.id, f.input), 'BOOST_IDEMPOTENCY_CONFLICT');
    expect(await state(f)).toEqual(before);
    expect(await db.walletAccount.findUnique({ where: { id: otherWallet.id } })).toEqual(otherWallet);
    expect(await db.walletLedger.count({ where: { walletAccountId: otherWallet.id } })).toBe(0);
  });

  it('concurrent duplicate requests commit at most one original debit', async () => {
    const f = await prepared(), results = await contended(f, () => Promise.allSettled([
      f.service.createPaidLike(f.owner.id, f.input), f.service.createPaidLike(f.owner.id, f.input),
    ]));
    expect(results.some(r => r.status === 'fulfilled')).toBe(true);
    const s = await state(f); expect(s.ledgers).toHaveLength(1); expect(s.events).toHaveLength(1);
    expect(s.wallets[0].cachedBalance.toString()).toBe('990');
    for (const result of results) if (result.status === 'fulfilled') expect((result.value as Awaited<ReturnType<BoostsService['createPaidLike']>>).paidLike.totalPriceLumina?.toString()).toBe('10');
    const before = await state(f), replay = await f.service.createPaidLike(f.owner.id, f.input);
    expect(replay.idempotentReplay).toBe(true); expect(await state(f)).toEqual(before);
  });

  it.each([false, true])('distinct-key concurrent requests respect the shared quota across different artists=%s', async differentArtist => {
    const f = await prepared();
    const artist = differentArtist ? await db.artist.create({ data: { slug: 'synthetic-other-' + randomUUID(), displayName: 'Other synthetic artist', status: 'active' } }) : f.artist;
    const input = { ...f.input, quantity: 20, expectedTotalPriceLumina: '200' };
    const outcomes = await contended(f, () => Promise.allSettled([f.service.createPaidLike(f.owner.id, input),
      f.service.createPaidLike(f.owner.id, { ...input, artistId: artist.id, idempotencyKey: input.idempotencyKey + '-second' })]));
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(BadRequestException); expect(rejected?.reason.message).toBe('Daily paid like limit exceeded');
    const s = await state(f); expect(s.events).toHaveLength(1); expect(s.ledgers).toHaveLength(1);
    expect(s.wallets[0].cachedBalance.toString()).toBe('800');
    expect((s.events[0].metadata as Record<string, unknown>).quantity).toBe(20);
  });

  it('a failure after native debit rolls the transaction back', async () => {
    const f = await prepared(), before = await state(f);
    const client = new Proxy(db, { get(target, property) {
      if (property !== '$transaction') { const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value; }
      return (callback: (tx: unknown) => unknown) => db.$transaction(async tx => callback(new Proxy(tx, { get(t, p) {
        if (p === 'walletLedger') return { ...t.walletLedger, create: () => Promise.reject(new Error('Synthetic ledger failure')) };
        const value = Reflect.get(t, p); return typeof value === 'function' ? value.bind(t) : value;
      } })));
    } });
    await expect(new BoostsService(client as never).createPaidLike(f.owner.id, f.input)).rejects.toThrow('Synthetic ledger failure');
    expect(await state(f)).toEqual(before);
  });

  it('a corrupted isolated ledger is not accepted as original price proof', async () => {
    const f = await prepared(), result = await f.service.createPaidLike(f.owner.id, f.input);
    await db.walletLedger.update({ where: { id: result.event.walletLedgerId! }, data: { amount: '9' } });
    const before = await state(f);
    await rejected(f.service.createPaidLike(f.owner.id, f.input), 'BOOST_IDEMPOTENCY_CONFLICT'); expect(await state(f)).toEqual(before);
  });

  it('confirmed price does not bypass insufficient balance', async () => {
    const f = await prepared('10', '1'), before = await state(f);
    await expect(f.service.createPaidLike(f.owner.id, f.input)).rejects.toThrow('Insufficient Lumina balance');
    expect(await state(f)).toEqual(before);
  });

  it('mismatch before a missing wallet cannot create one', async () => {
    const f = await prepared('11', '0', false), before = await state(f);
    await rejected(f.service.createPaidLike(f.owner.id, { ...f.input, expectedTotalPriceLumina: '10' }), 'BOOST_PAID_LIKE_PRICE_MISMATCH');
    expect(await state(f)).toEqual(before); expect(before.wallets).toHaveLength(0);
  });
});
