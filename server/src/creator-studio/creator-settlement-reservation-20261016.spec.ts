import assert = require('node:assert/strict');
import { AsyncLocalStorage } from 'node:async_hooks';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma, type SettlementLuminaConversionRequest } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { PrismaService } from '../prisma/prisma.service';
import type { CreateCreatorStudioSettlementConversionDto } from './dto/creator-studio.dto';
import { CreatorStudioService } from './creator-studio.service';

// AUTHOR UNRUN. This is an admitted ORM/transaction boundary, NOT PostgreSQL lock/SQL proof.
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ARTIST = '33333333-3333-4333-8333-333333333333';
const WHEN = new Date('2026-10-16T00:00:00.000Z');
const PERIOD = '2026-10';
const FIRST = 'synthetic-reservation-first';
const SECOND = 'synthetic-reservation-second';
const MODEL = 'SettlementLuminaConversionRequest';
const CONSTRAINT = 'uq_settlement_lumina_conversions_idempotency';
type Input = CreateCreatorStudioSettlementConversionDto;
type Row = SettlementLuminaConversionRequest;
type Data = Pick<Row, 'requesterUserId' | 'settlementKey' | 'settlementType' | 'period' |
  'targetArtistId' | 'amountKrw' | 'requestedLumina' | 'note' | 'idempotencyKey'> & { metadata: Prisma.InputJsonValue };
type AccessArgs = { where: { userId: string; artistId?: string; status: string; revokedAt: null;
  role: string; permissions: { has: string } }; select: Record<string, unknown>; orderBy?: unknown };
type Lookup = { where: { requesterUserId: string; idempotencyKey: string } };
type Aggregate = { where: { requesterUserId: string; settlementKey: string; status: { in: string[] } };
  _sum: { amountKrw: true } };
type RevenueArgs = { where: { artistId?: { in: string[] }; status?: unknown; boostType?: string;
  createdAt?: { gte: Date; lt: Date }; unlockedAt?: { gte: Date; lt: Date };
  premiumVideoProduct?: { artistId: { in: string[] } }; amountLumina?: { gt: number } };
  select?: unknown; include?: unknown };
type Event = { client: string; op: string; sum?: string };
type Tx = { id: string; active: boolean; locked: boolean; staged: Row[]; release?: () => void };
const partner = (user = USER, period = PERIOD) => 'partner:' + user + ':' + period;
const artist = () => 'artist:' + ARTIST + ':' + PERIOD;
const domain = (user: string, rawKey: string) => 'creator_settlement_conversion:v1:' + user + ':' + rawKey;
const input = (patch: Partial<Input> = {}): Input => ({ settlementKey: partner(), amountKrw: '4000',
  idempotencyKey: FIRST, ...patch });
function row(patch: Partial<Row> = {}): Row {
  return { id: '44444444-4444-4444-8444-444444444444', requesterUserId: USER,
    settlementKey: partner(), settlementType: 'partner', period: PERIOD, targetArtistId: null,
    amountKrw: new Decimal(4000), requestedLumina: new Decimal(400), status: 'requested',
    note: null, adminNote: null, walletLedgerId: null, processedByUserId: null, processedAt: null,
    idempotencyKey: FIRST, metadata: { syntheticStored: true }, createdAt: WHEN, updatedAt: WHEN, ...patch };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function unique(target: unknown = CONSTRAINT, code = 'P2002') {
  return new Prisma.PrismaClientKnownRequestError('Synthetic unique collision',
    { code, clientVersion: 'synthetic-sdk174', meta: { target, modelName: MODEL } });
}
async function failed(action: () => Promise<unknown>): Promise<unknown> {
  try { await action(); } catch (error) { return error; }
  assert.fail('Expected synthetic service failure');
}
function amountFailure(error: unknown) {
  assert(error instanceof BadRequestException); assert.equal(error.getStatus(), 400);
  assert.equal((error.getResponse() as { code: string }).code, 'SETTLEMENT_CONVERSION_AMOUNT_EXCEEDS_PREVIEW');
}
function fixture(initial: Row[] = [], overlapRootSum = false) {
  const context = new AsyncLocalStorage<Tx>(), locks = new Map<string, Promise<void>>(), rootBarrier = deferred();
  const events: Event[] = [], transactions: Tx[] = [], committed = initial.slice();
  let admissionFaults = 0, attempts = 0, rootSumCalls = 0, ownCreates = 0, createAttempts = 0, externalCommits = 0;
  const financial = { balance: '777', ledgers: [] as unknown[], audits: [] as unknown[] };
  const financialBefore = JSON.stringify(financial);
  const state = { denyRoot: false, denyTx: false, failAt: '', error: new Error('Synthetic infrastructure failure') as unknown,
    createError: undefined as unknown, winnerAfterRollback: null as Row | null, winnerAtLock: null as Row | null };
  async function admitted<T>(client: Tx | null, op: string, validate: () => void, effect: () => T | Promise<T>): Promise<T> {
    attempts++; events.push({ client: client?.id ?? 'root', op });
    try {
      assert(attempts <= 256, 'Bounded ORM attempts');
      if (client) { assert.equal(context.getStore(), client); assert.equal(client.active, true);
        if (op !== 'lock') assert.equal(client.locked, true, 'Lock is the first transaction DB operation'); }
      else assert.equal(context.getStore(), undefined, 'ROOT_POOL_ONE: no root query inside transaction callback');
      validate();
    } catch (error) { admissionFaults++; throw error; }
    if (state.failAt === op) throw state.error;
    return await effect();
  }
  const visible = (client: Tx | null) => [...committed, ...(client?.staged ?? [])];
  function access(args: AccessArgs) {
    assert.deepEqual(args.where, { userId: USER, ...(args.where.artistId === undefined ? {} : { artistId: ARTIST }),
      status: 'active', revokedAt: null, role: 'owner', permissions: { has: 'settlement:read' } });
  }
  function clientFor(tx: Tx | null) {
    const delegates = {
      artistOperator: {
        findFirst(args: AccessArgs) { return admitted(tx, 'access', () => {
          access(args); assert.deepEqual(args.select, { id: true });
        }, () => (tx ? state.denyTx : state.denyRoot) ? null : { id: 'synthetic-operator' }); },
        findMany(args: AccessArgs) { return admitted(tx, 'preview-operators', () => {
          access(args); assert.equal(args.select.artistId, true);
          assert.deepEqual(args.orderBy, [{ artist: { sortOrder: 'asc' } }, { createdAt: 'desc' }]);
        }, () => [{ id: 'synthetic-operator', userId: USER, artistId: ARTIST, role: 'owner', permissions: ['settlement:read'],
          artist: { id: ARTIST, slug: 'synthetic-artist', displayName: 'Synthetic artist', status: 'active', sortOrder: 0 } }]); },
      },
      settlementLuminaConversionRequest: {
        findFirst(args: Lookup) { return admitted(tx, 'replay', () => {
          assert.deepEqual(Object.keys(args.where).sort(), ['idempotencyKey', 'requesterUserId']);
          assert.equal(args.where.requesterUserId, USER); assert.equal(typeof args.where.idempotencyKey, 'string');
        }, () => visible(tx).find(value => value.requesterUserId === args.where.requesterUserId
          && value.idempotencyKey === args.where.idempotencyKey) ?? null); },
        aggregate(args: Aggregate) { return admitted(tx, 'aggregate', () => {
          assert.deepEqual(args._sum, { amountKrw: true });
          assert.deepEqual(args.where.status, { in: ['requested', 'approved', 'credited'] });
          assert.equal(args.where.requesterUserId, USER);
          assert([partner(), artist()].includes(args.where.settlementKey));
        }, async () => {
          const sum = visible(tx).filter(value => value.requesterUserId === args.where.requesterUserId
            && value.settlementKey === args.where.settlementKey && args.where.status.in.includes(value.status))
            .reduce((total, value) => total.plus(value.amountKrw), new Decimal(0));
          events.push({ client: tx?.id ?? 'root', op: 'observed-sum', sum: sum.toString() });
          if (!tx && overlapRootSum) { rootSumCalls++; if (rootSumCalls === 2) rootBarrier.resolve(); await rootBarrier.promise; }
          return { _sum: { amountKrw: sum } };
        }); },
        create(args: { data: Data }) { return admitted(tx, 'create', () => {
          assert.deepEqual(Object.keys(args.data).sort(), ['requesterUserId', 'settlementKey', 'settlementType', 'period',
            'targetArtistId', 'amountKrw', 'requestedLumina', 'note', 'idempotencyKey', 'metadata'].sort());
          assert.equal(args.data.requesterUserId, USER); assert([partner(), artist()].includes(args.data.settlementKey));
          assert(args.data.amountKrw instanceof Decimal); assert(args.data.requestedLumina instanceof Decimal);
          assert.equal(args.data.period, PERIOD);
        }, () => {
          createAttempts++;
          if (state.createError !== undefined) throw state.createError;
          const saved = row({ ...args.data, id: '55555555-5555-4555-8555-' + String(createAttempts).padStart(12, '0'),
            metadata: args.data.metadata as Prisma.JsonValue });
          if (tx) tx.staged.push(saved); else { committed.push(saved); ownCreates++; }
          return saved;
        }); },
      },
      ...Object.fromEntries(['chatFeatureOrder', 'giftOrder', 'artistBoostEvent', 'userPremiumVideoUnlock', 'fanLetter'].map(model => [
        model, { findMany(args: RevenueArgs) { return admitted(tx, model, () => {
          const where = args.where, range = model === 'userPremiumVideoUnlock' ? where.unlockedAt : where.createdAt;
          assert(range?.gte instanceof Date && range.lt instanceof Date); assert(range.gte < range.lt);
          assert.deepEqual(model === 'userPremiumVideoUnlock' ? where.premiumVideoProduct?.artistId : where.artistId, { in: [ARTIST] });
          if (model === 'chatFeatureOrder' || model === 'giftOrder') assert.equal(where.status, 'completed');
          if (model === 'artistBoostEvent') assert.equal(where.boostType, 'lumina_boost');
          if (model === 'fanLetter') { assert.deepEqual(where.status, { in: ['submitted', 'seen', 'replied', 'archived'] });
            assert.deepEqual(where.amountLumina, { gt: 0 }); }
        }, () => model === 'giftOrder' ? [{ artistId: ARTIST, totalLumina: new Decimal(1000) }] : []); } },
      ])),
      $queryRaw(query: Prisma.Sql) { return admitted(tx, 'lock', () => {
        assert(tx); assert.equal(tx.locked, false);
        assert.deepEqual(query.strings.map(value => value.replace(/\s+/g, ' ').trim()), [
          'SELECT 1 AS locked FROM pg_advisory_xact_lock( hashtextextended(', '::text, 0::bigint) )',
        ]);
        assert.equal(query.values.length, 1);
        assert([domain(USER, partner()), domain(USER, artist())].includes(query.values[0] as string));
      }, async () => {
        assert(tx); const key = query.values[0] as string, previous = locks.get(key) ?? Promise.resolve(), gate = deferred();
        const tail = previous.then(() => gate.promise); locks.set(key, tail);
        await previous; tx.locked = true;
        tx.release = () => { gate.resolve(); if (locks.get(key) === tail) locks.delete(key); };
        if (state.winnerAtLock) { committed.push(state.winnerAtLock); state.winnerAtLock = null; externalCommits++; }
        return [{ locked: 1 }];
      }); },
    };
    return new Proxy(delegates, { get(target, property) {
      if (Object.prototype.hasOwnProperty.call(target, property)) return Reflect.get(target, property);
      admissionFaults++; throw new Error('SYNTHETIC_UNADMITTED_PRISMA_DELEGATE');
    } });
  }
  const root = clientFor(null);
  const prisma = new Proxy(root, { get(target, property) {
    if (property !== '$transaction') return Reflect.get(target, property);
    return async (callback: (db: unknown) => Promise<unknown>, options: { isolationLevel: string }) => {
      attempts++; events.push({ client: 'root', op: 'transaction' });
      try { assert.equal(context.getStore(), undefined); assert.equal(typeof callback, 'function');
        assert.deepEqual(options, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }); }
      catch (error) { admissionFaults++; throw error; }
      const tx: Tx = { id: 'tx' + (transactions.length + 1), active: true, locked: false, staged: [] };
      transactions.push(tx);
      try {
        const result = await context.run(tx, () => callback(clientFor(tx)));
        if (state.failAt === 'commit') throw state.error;
        committed.push(...tx.staged); ownCreates += tx.staged.length; events.push({ client: tx.id, op: 'commit' }); return result;
      } catch (error) {
        events.push({ client: tx.id, op: 'rollback' });
        if (state.winnerAfterRollback) { committed.push(state.winnerAfterRollback); state.winnerAfterRollback = null; externalCommits++; }
        throw error;
      } finally { tx.active = false; tx.release?.(); }
    };
  } });
  const service = new CreatorStudioService(prisma as unknown as PrismaService, { get() {
    admissionFaults++; throw new Error('SYNTHETIC_CONFIGURATION_READ');
  } } as unknown as ConfigService);
  const count = (op: string, where?: string) => events.filter(value => value.op === op && (where === undefined || value.client === where)).length;
  function check() {
    assert.equal(admissionFaults, 0, 'FIXTURE_ADMISSION_FAULT_OUTSIDE_PRODUCT_CATCH');
    assert.equal(JSON.stringify(financial), financialBefore);
    assert(transactions.every(tx => !tx.active)); assert.equal(locks.size, 0);
  }
  return { service, state, committed, events, transactions, count, check,
    ownCreates: () => ownCreates, createAttempts: () => createAttempts, externalCommits: () => externalCommits,
    finish() { rootBarrier.resolve(); check(); } };
}
type Fixture = ReturnType<typeof fixture>;
function currentTxTrace(f: Fixture) {
  assert(f.transactions.length > 0, 'Actual service must enter transaction');
  for (const tx of f.transactions) {
    const ops = f.events.filter(event => event.client === tx.id).map(event => event.op);
    assert.equal(ops[0], 'lock'); assert.equal(ops.filter(op => op === 'lock').length, 1);
    if (ops.includes('aggregate')) {
      for (const op of ['access', 'preview-operators', 'chatFeatureOrder', 'giftOrder', 'artistBoostEvent',
        'userPremiumVideoUnlock', 'fanLetter', 'create']) {
        if (op !== 'create' || ops.includes('create')) assert(ops.includes(op), 'Actual preview dependency must use that same transaction');
      }
    }
  }
}

describe('CreatorStudioService same-key reservation focused', () => {
  it('01 same caller raw key distinct claims cannot both reserve the same remaining capacity', async () => {
    const f = fixture([], true);
    try {
      const outcomes = await Promise.allSettled([
        f.service.createSettlementConversion(USER, input()),
        f.service.createSettlementConversion(USER, input({ idempotencyKey: SECOND })),
      ]);
      f.check();
      const success = outcomes.filter(value => value.status === 'fulfilled');
      assert(success.length >= 1, 'At least one actual new claim must complete after admission');
      assert.equal(success.length, 1, 'SETTLEMENT_SAME_KEY_RESERVATION_OVERLAP');
      const rejected = outcomes.find(value => value.status === 'rejected') as PromiseRejectedResult;
      amountFailure(rejected.reason); assert.equal(f.ownCreates(), 1); assert.equal(f.committed.length, 1);
      const metadata = f.committed[0].metadata as { estimatedAvailableKrw: string };
      const available = new Decimal(metadata.estimatedAvailableKrw);
      assert(available.greaterThan(4000) && available.lessThan(8000), 'Actual unchanged preview makes both single claims individually fit');
      assert(f.committed[0].amountKrw.lessThanOrEqualTo(available));
      assert.deepEqual(f.events.filter(event => event.op === 'observed-sum').map(event => event.sum), ['0', '4000']);
      assert.equal(f.transactions.length, 2); currentTxTrace(f);
    } finally { f.finish(); }
  }, 10000);

  it('02 lock precedes real preview dependencies tx access recheck and inside replay with no root pool checkout', async () => {
    {
      const f = fixture(); try {
        await f.service.createSettlementConversion(USER, input());
        currentTxTrace(f); assert.equal(f.count('access', 'root'), 1); assert.equal(f.count('replay', 'root'), 1);
        assert.equal(f.count('access', 'tx1'), 1); assert.equal(f.count('replay', 'tx1'), 1);
        assert.equal(f.count('aggregate', 'root'), 0); assert.equal(f.count('create', 'root'), 0);
        for (const name of ['preview-operators', 'chatFeatureOrder', 'giftOrder', 'artistBoostEvent', 'userPremiumVideoUnlock', 'fanLetter'])
          assert.equal(f.count(name, 'tx1'), 1);
        const before = f.committed.length;
        const preview = await f.service.getSettlementPreview(USER, { period: PERIOD });
        assert(preview.totals.creatorShareKrw.greaterThan(4000)); assert.equal(f.committed.length, before);
        assert.equal(f.count('preview-operators', 'root'), 1, 'Existing two-argument public preview defaults to root outside a transaction'); f.check();
      } finally { f.finish(); }
    }
    {
      const f = fixture(); try {
        f.state.denyTx = true;
        assert(await failed(() => f.service.createSettlementConversion(USER, input())) instanceof ForbiddenException);
        assert.equal(f.count('access', 'root'), 1); assert.equal(f.count('access', 'tx1'), 1);
        assert.equal(f.count('preview-operators'), 0); assert.equal(f.createAttempts(), 0); assert.equal(f.committed.length, 0); f.check();
      } finally { f.finish(); }
    }
    {
      const f = fixture(), winner = row({ status: 'approved' }); try {
        f.state.winnerAtLock = winner;
        const result = await f.service.createSettlementConversion(USER, input({ amountKrw: '4000.00' }));
        assert.equal(result.idempotentReplay, true); assert.equal(result.conversion.id, winner.id);
        assert.equal(f.count('replay', 'root'), 1); assert.equal(f.count('replay', 'tx1'), 1);
        assert.equal(f.count('preview-operators'), 0); assert.equal(f.createAttempts(), 0); assert.equal(f.externalCommits(), 1); f.check();
      } finally { f.finish(); }
    }
  }, 10000);

  it('03 original Decimal minimum reserved status predicate access replay and request-only policy are preserved', async () => {
    const seeds = ['requested', 'approved', 'credited', 'rejected', 'cancelled'].map((status, index) =>
      row({ status, amountKrw: new Decimal(status === 'requested' ? 1000 : status === 'approved' ? 500 : status === 'credited' ? 250 : 90000),
        idempotencyKey: 'synthetic-seed-' + index }));
    seeds.push(row({ requesterUserId: OTHER, amountKrw: new Decimal(90000), idempotencyKey: 'synthetic-other-owner' }),
      row({ settlementKey: partner(USER, '2026-11'), amountKrw: new Decimal(90000), idempotencyKey: 'synthetic-other-key' }));
    for (const settlementKey of [partner(), artist()]) {
      const f = fixture(settlementKey === partner() ? seeds : []);
      try {
        const result = await f.service.createSettlementConversion(USER, input({ settlementKey, amountKrw: '1000.00', note: 'Synthetic note' }));
        assert.equal(result.idempotentReplay, false); assert.equal(result.conversion.status, 'requested');
        assert.equal(result.conversion.amountKrw.toString(), '1000'); assert.equal(result.conversion.requestedLumina.toString(), '100');
        assert.equal(result.policy.unitPriceKrw.toString(), '10'); assert.equal(result.policy.minAmountKrw.toString(), '1000');
        assert.equal(result.policy.status, 'request_only'); assert.equal(result.policy.walletCreditTiming, 'admin_approval_required');
        assert.deepEqual(result.policy.statuses, ['requested', 'approved', 'rejected', 'credited', 'cancelled']);
        assert.equal((result.conversion.metadata as { reservedKrw: string }).reservedKrw, settlementKey === partner() ? '1750' : '0');
        assert.equal(result.conversion.note, 'Synthetic note'); currentTxTrace(f); f.check();
      } finally { f.finish(); }
    }
    for (const patch of [{}, { amountKrw: '4001' }, { note: 'Different synthetic note' }]) {
      const saved = row({ status: 'cancelled' }), f = fixture([saved]); try {
        f.state.failAt = 'giftOrder';
        const action = () => f.service.createSettlementConversion(USER, input({ amountKrw: '4000.00', ...patch }));
        if (Object.keys(patch).length) assert(await failed(action) instanceof ConflictException);
        else { const result = await action(); assert.equal(result.idempotentReplay, true); assert.equal(result.conversion.status, 'cancelled'); }
        assert.equal(f.transactions.length, 0); assert.equal(f.count('preview-operators'), 0); assert.equal(f.createAttempts(), 0); f.check();
      } finally { f.finish(); }
    }
    for (const kind of ['minimum', 'root-denied', 'foreign-partner', 'no-idempotency']) {
      const f = fixture(); try {
        if (kind === 'root-denied') f.state.denyRoot = true;
        const action = () => f.service.createSettlementConversion(USER, input(kind === 'minimum' ? { amountKrw: '999.99' }
          : kind === 'foreign-partner' ? { settlementKey: partner(OTHER) }
          : kind === 'no-idempotency' ? { idempotencyKey: null, amountKrw: '1000' } : {}));
        if (kind === 'no-idempotency') { assert.equal((await action()).idempotentReplay, false); assert.equal(f.count('replay'), 0);
          assert.equal(f.committed[0].idempotencyKey, null); }
        else { const error = await failed(action); assert(kind === 'minimum' ? error instanceof BadRequestException : error instanceof ForbiddenException);
          assert.equal(f.createAttempts(), 0); assert.equal(f.committed.length, 0); }
        f.check();
      } finally { f.finish(); }
    }
  }, 10000);

  it('04 failures rollback staged claims exact P2002 recovery occurs after rollback and never retries create', async () => {
    for (const stage of ['lock', 'giftOrder', 'aggregate', 'create', 'commit']) {
      const f = fixture(); try {
        f.state.failAt = stage;
        assert.equal(await failed(() => f.service.createSettlementConversion(USER, input())), f.state.error);
        assert.equal(f.ownCreates(), 0); assert.equal(f.committed.length, 0); assert.equal(f.transactions.length, 1);
        assert.equal(f.count('rollback'), 1); assert(f.createAttempts() <= 1); f.check();
      } finally { f.finish(); }
    }
    for (const kind of ['same', 'changed', 'missing', 'unrelated']) {
      const f = fixture(), error = unique(CONSTRAINT, kind === 'unrelated' ? 'P2003' : 'P2002'); try {
        f.state.createError = error;
        if (kind === 'same' || kind === 'changed') f.state.winnerAfterRollback = row({ note: kind === 'changed' ? 'Different synthetic note' : null });
        const action = () => f.service.createSettlementConversion(USER, input({ amountKrw: '4000.00' }));
        if (kind === 'same') assert.equal((await action()).idempotentReplay, true);
        else if (kind === 'changed') assert(await failed(action) instanceof ConflictException);
        else assert.equal(await failed(action), error);
        assert.equal(f.ownCreates(), 0); assert.equal(f.createAttempts(), 1); assert.equal(f.transactions.length, 1);
        assert.equal(f.count('rollback'), 1); assert.equal(f.count('replay', 'root'), kind === 'unrelated' ? 1 : 2);
        if (kind !== 'unrelated') {
          const rollback = f.events.findIndex(event => event.op === 'rollback');
          assert(f.events.findIndex((event, index) => index > rollback && event.client === 'root' && event.op === 'replay') > rollback);
        }
        assert.equal(f.externalCommits(), kind === 'same' || kind === 'changed' ? 1 : 0); f.check();
      } finally { f.finish(); }
    }
  }, 10000);
});
