import assert = require('node:assert/strict');
import { AsyncLocalStorage } from 'node:async_hooks';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Prisma, type SettlementLuminaConversionRequest } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { PrismaService } from '../prisma/prisma.service';
import { CreatorStudioService } from './creator-studio.service';
import type { CreateCreatorStudioSettlementConversionDto } from './dto/creator-studio.dto';

// Synthetic service boundary only. Real driver uniqueness/races are a separate parent gate.
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ARTIST = '33333333-3333-4333-8333-333333333333';
const REQUEST = '44444444-4444-4444-8444-444444444444';
const CREATED = '55555555-5555-4555-8555-555555555555';
const OPERATOR = '66666666-6666-4666-8666-666666666666';
const KEY = 'synthetic-request-intent';
const WHEN = new Date('2026-10-15T12:00:00.000Z');
const MODEL = 'SettlementLuminaConversionRequest';
const CONSTRAINT = 'uq_settlement_lumina_conversions_idempotency';
const CONFLICT = { code: 'SETTLEMENT_CONVERSION_IDEMPOTENCY_CONFLICT',
  message: 'Idempotency key is already associated with a different settlement conversion request' };
type Input = CreateCreatorStudioSettlementConversionDto;
type Row = SettlementLuminaConversionRequest;
type Operator = { id: string; userId: string; artistId: string; status: string;
  revokedAt: Date | null; role: string; permissions: string[] };
type OperatorArgs = { where: { userId: string; artistId?: string; status: string;
  revokedAt: null; role: string; permissions: { has: string } }; select: { id: true } };
type Lookup = { where: { requesterUserId: string; idempotencyKey: string } };
type Aggregate = { where: { requesterUserId: string; settlementKey: string; status: { in: string[] } };
  _sum: { amountKrw: true } };
type CreateData = { requesterUserId: string; settlementKey: string; settlementType: string; period: string;
  targetArtistId: string | null; amountKrw: Decimal; requestedLumina: Decimal; note: string | null;
  idempotencyKey: string | null; metadata: Prisma.InputJsonValue };
const partner = (user = USER, period = '2026-10') => 'partner:' + user + ':' + period;
const artist = (period = '2026-10') => 'artist:' + ARTIST + ':' + period;
const input = (patch: Partial<Input> = {}): Input => ({ settlementKey: partner(), amountKrw: '1000',
  idempotencyKey: KEY, ...patch });
function row(patch: Partial<Row> = {}): Row {
  return { id: REQUEST, requesterUserId: USER, settlementKey: partner(), settlementType: 'partner',
    period: '2026-10', targetArtistId: null, amountKrw: new Decimal(1000), requestedLumina: new Decimal(37),
    status: 'approved', note: null, adminNote: 'Synthetic stored administrative note', walletLedgerId: null,
    processedByUserId: null, processedAt: null, idempotencyKey: KEY, metadata: { syntheticSnapshot: true },
    createdAt: WHEN, updatedAt: WHEN, ...patch };
}
const operator = (patch: Partial<Operator> = {}): Operator => ({ id: OPERATOR, userId: USER,
  artistId: ARTIST, status: 'active', revokedAt: null, role: 'owner', permissions: ['settlement:read'], ...patch });
const snapshot = (value: unknown) => JSON.stringify(value);
function unique(meta: Record<string, unknown>, code = 'P2002') {
  return new Prisma.PrismaClientKnownRequestError('Synthetic conversion uniqueness failure',
    { code, clientVersion: 'synthetic-sdk174', meta });
}
async function failure(action: () => Promise<unknown>, label: string): Promise<unknown> {
  try { await action(); } catch (error) { return error; }
  assert.fail(label);
}
async function conflict(action: () => Promise<unknown>, label: string) {
  const error = await failure(action, label);
  assert(error instanceof ConflictException, label); assert.equal(error.getStatus(), 409);
  assert.deepEqual(error.getResponse(), CONFLICT, 'Fixed response has no intent/winner/difference payload');
}
function fixture(initial: Row[] = [], operators: Operator[] = [operator()]) {
  type Tx = { locked: boolean; active: boolean; aborted: boolean; staged: Row[]; client: unknown };
  const txContext = new AsyncLocalStorage<Tx>(), txHistory: Tx[] = [];
  const calls = { access: [] as OperatorArgs[], lookup: [] as Lookup[], aggregate: [] as Aggregate[],
    create: [] as { data: CreateData }[], preview: [] as { userId: string; period?: string }[] };
  const state = { rows: initial.slice(), operators: operators.slice(), available: new Decimal(5000),
    reserved: new Decimal(0), createError: undefined as unknown, lookupError: undefined as unknown,
    lookupErrorAt: 0, previewError: undefined as unknown, winner: null as Row | null,
    ownCreates: 0, externalCommits: 0, forbiddenCalls: 0, admissionAttempts: 0, admissionFaults: 0 };
  const financial = { cachedBalance: '77', ledgers: [] as unknown[], audits: [] as unknown[] };
  const initialFinancial = snapshot(financial);
  const delegates = {
    artistOperator: { async findFirst(args: OperatorArgs) {
      calls.access.push(args);
      assert.deepEqual(args.select, { id: true });
      assert.equal(args.where.status, 'active'); assert.equal(args.where.revokedAt, null);
      assert.equal(args.where.role, 'owner'); assert.deepEqual(args.where.permissions, { has: 'settlement:read' });
      const wanted = args.where;
      const found = state.operators.find(value => value.userId === wanted.userId
        && (wanted.artistId === undefined || value.artistId === wanted.artistId)
        && value.status === wanted.status && value.revokedAt === wanted.revokedAt
        && value.role === wanted.role && value.permissions.includes(wanted.permissions.has));
      return found ? { id: found.id } : null;
    } },
    settlementLuminaConversionRequest: {
      async findFirst(args: Lookup) {
        calls.lookup.push(args);
        assert.deepEqual(Object.keys(args.where).sort(), ['idempotencyKey', 'requesterUserId']);
        if (state.lookupErrorAt === calls.lookup.length) throw state.lookupError;
        return state.rows.find(value => value.requesterUserId === args.where.requesterUserId
          && value.idempotencyKey === args.where.idempotencyKey) ?? null;
      },
      async aggregate(args: Aggregate) {
        calls.aggregate.push(args);
        assert.deepEqual(args._sum, { amountKrw: true });
        assert.deepEqual(args.where.status, { in: ['requested', 'approved', 'credited'] });
        return { _sum: { amountKrw: state.reserved } };
      },
      async create(args: { data: CreateData }) {
        calls.create.push(args);
        if (state.winner) {
          // Explicit competing-commit injection, not an actual SQL schedule or a create retry.
          state.rows.push(state.winner); state.winner = null; state.externalCommits++;
        }
        if (state.createError !== undefined) throw state.createError;
        const saved = row({ id: CREATED, ...args.data, status: 'requested', adminNote: null,
          metadata: args.data.metadata as Prisma.JsonValue });
        const tx = txContext.getStore();
        if (tx) tx.staged.push(saved); else { state.rows.push(saved); state.ownCreates++; }
        return saved;
      },
    },
  };
  function boundary(tx: Tx | null) {
    const models = Object.fromEntries(Object.entries(delegates).map(([name, methods]) => [name,
      Object.fromEntries(Object.entries(methods).map(([operation, implementation]) => [operation, async (...args: unknown[]) => {
        state.admissionAttempts++;
        try {
          assert(state.admissionAttempts < 256);
          if (tx) { assert.equal(txContext.getStore(), tx); assert(tx.active && tx.locked && !tx.aborted); }
          else assert.equal(txContext.getStore(), undefined, 'No root pool checkout inside transaction');
          return await (implementation as (...values: unknown[]) => Promise<unknown>)(...args);
        } catch (error) {
          if (tx) tx.aborted = true;
          if (error !== state.createError && error !== state.lookupError && error !== state.previewError) state.admissionFaults++;
          throw error;
        }
      }]))]));
    return new Proxy(models, { get(target, property) {
      if (property === '$queryRaw' && tx) return async (query: Prisma.Sql) => {
        state.admissionAttempts++;
        try {
          assert.equal(txContext.getStore(), tx); assert(tx.active && !tx.locked && !tx.aborted);
          assert.deepEqual(query.strings.map(value => value.replace(/\s+/g, ' ').trim()), [
            'SELECT 1 AS locked FROM pg_advisory_xact_lock( hashtextextended(', '::text, 0::bigint) )',
          ]);
          assert.equal(query.values.length, 1);
          assert([USER + ':' + partner(), USER + ':' + artist(), OTHER + ':' + partner(OTHER)]
            .map(value => 'creator_settlement_conversion:v1:' + value).includes(query.values[0] as string));
        } catch (error) { state.admissionFaults++; throw error; }
        tx.locked = true; return [{ locked: 1 }];
      };
      if (property === '$transaction' && !tx) return async (callback: (client: unknown) => Promise<unknown>,
        options: { isolationLevel: string }) => {
        state.admissionAttempts++;
        try { assert.equal(txContext.getStore(), undefined); assert.equal(typeof callback, 'function');
          assert.deepEqual(options, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }); }
        catch (error) { state.admissionFaults++; throw error; }
        const current: Tx = { active: true, locked: false, aborted: false, staged: [], client: null };
        current.client = boundary(current); txHistory.push(current);
        try {
          const result = await txContext.run(current, () => callback(current.client));
          state.rows.push(...current.staged); state.ownCreates += current.staged.length; return result;
        } finally { current.active = false; }
      };
      if (Object.prototype.hasOwnProperty.call(target, property)) return Reflect.get(target, property);
      state.admissionFaults++; state.forbiddenCalls++; throw new Error('SYNTHETIC_UNADMITTED_PRISMA_OPERATION');
    } });
  }
  const prisma = boundary(null);
  const service = new CreatorStudioService(prisma as unknown as PrismaService,
    { get() { throw new Error('SYNTHETIC_UNADMITTED_CONFIGURATION_READ'); } } as unknown as ConfigService);
  type Preview = Awaited<ReturnType<CreatorStudioService['getSettlementPreview']>>;
  jest.spyOn(service, 'getSettlementPreview').mockImplementation(async (userId, query, db) => {
    state.admissionAttempts++;
    try { const tx = txContext.getStore(); assert(tx && tx.active && tx.locked && !tx.aborted); assert.equal(db, tx.client); }
    catch (error) { state.admissionFaults++; throw error; }
    calls.preview.push({ userId, period: query.period });
    if (state.previewError !== undefined) throw state.previewError;
    return { items: [{ artist: { id: ARTIST }, financials: { creatorShareKrw: state.available } }],
      totals: { creatorShareKrw: state.available } } as unknown as Preview;
  });
  function noFinancialWrites() {
    assert.equal(state.admissionFaults, 0, 'Admission errors cannot disappear inside product catch');
    assert.equal(txContext.getStore(), undefined); assert(txHistory.every(tx => !tx.active));
    assert.equal(state.forbiddenCalls, 0); assert.equal(snapshot(financial), initialFinancial);
  }
  function scope(userId = USER) {
    for (const query of calls.lookup) assert.deepEqual(query, { where: { requesterUserId: userId, idempotencyKey: KEY } });
  }
  return { service, state, calls, noFinancialWrites, scope };
}

describe('CreatorStudioService settlement idempotency intent focused', () => {
  it('01 same caller key with changed amount target or note conflicts without replay disclosure or writes', async () => {
    for (const [patch, label] of [
      [{ amountKrw: '1100' }, 'SETTLEMENT_INTENT_CHANGED_AMOUNT'],
      [{ settlementKey: partner(USER, '2026-11') }, 'SETTLEMENT_INTENT_CHANGED_TARGET'],
      [{ note: 'Synthetic different note' }, 'SETTLEMENT_INTENT_CHANGED_NOTE'],
    ] as const) {
      const f = fixture([row()]), before = snapshot(f.state.rows);
      await conflict(() => f.service.createSettlementConversion(USER, input(patch)), label);
      assert.equal(f.calls.access.length, 1); assert.equal(f.calls.lookup.length, 1);
      assert.equal(f.calls.preview.length, 0); assert.equal(f.calls.aggregate.length, 0);
      assert.equal(f.calls.create.length, 0); assert.equal(snapshot(f.state.rows), before);
      f.scope(); f.noFinancialWrites();
    }
  });

  it('02 numeric equivalent replay actual access and first creation preserve original request only policy', async () => {
    for (const amountKrw of ['1000', '1000.00']) for (const note of [undefined, null]) {
      const saved = row(), f = fixture([saved]), before = snapshot(f.state.rows);
      f.state.previewError = new Error('Synthetic preview unavailable after original request');
      const result = await f.service.createSettlementConversion(USER, input({ amountKrw, note }));
      assert.equal(result.idempotentReplay, true); assert.equal(result.conversion.id, saved.id);
      assert.equal(result.conversion.amountKrw.toString(), '1000');
      assert.equal(result.conversion.requestedLumina.toString(), '37');
      assert.equal(result.conversion.status, 'approved'); assert.deepEqual(result.conversion.metadata, saved.metadata);
      assert.equal(result.policy.unitPriceKrw.toString(), '10'); assert.equal(result.policy.minAmountKrw.toString(), '1000');
      assert.equal(result.policy.status, 'request_only'); assert.equal(result.policy.walletCreditTiming, 'admin_approval_required');
      assert.equal(f.calls.preview.length, 0); assert.equal(f.calls.aggregate.length, 0); assert.equal(f.calls.create.length, 0);
      assert.equal(snapshot(f.state.rows), before); f.scope(); f.noFinancialWrites();
    }
    for (const settlementKey of [partner(), artist()]) for (const idempotencyKey of [KEY, undefined]) {
      const f = fixture(); f.state.reserved = new Decimal(1000);
      const result = await f.service.createSettlementConversion(USER, input({ settlementKey, idempotencyKey, amountKrw: '1000.00', note: 'Synthetic request note' }));
      assert.equal(result.idempotentReplay, false); assert.equal(result.conversion.id, CREATED);
      assert.equal(result.conversion.requestedLumina.toString(), '100'); assert.equal(result.conversion.status, 'requested');
      assert.equal(f.calls.create.length, 1); assert.equal(f.state.ownCreates, 1); assert.equal(f.state.rows.length, 1);
      assert.equal(f.calls.lookup.length, idempotencyKey ? 2 : 0);
      assert.deepEqual(f.calls.access, Array(2).fill({ where: { userId: USER,
        ...(settlementKey.startsWith('artist:') ? { artistId: ARTIST } : {}), status: 'active',
        revokedAt: null, role: 'owner', permissions: { has: 'settlement:read' } }, select: { id: true } }));
      assert.deepEqual(f.calls.preview, [{ userId: USER, period: '2026-10' }]);
      assert.deepEqual(f.calls.aggregate, [{ where: { requesterUserId: USER, settlementKey,
        status: { in: ['requested', 'approved', 'credited'] } }, _sum: { amountKrw: true } }]);
      const data = f.calls.create[0].data;
      assert.deepEqual(Object.keys(data).sort(), ['requesterUserId', 'settlementKey', 'settlementType', 'period',
        'targetArtistId', 'amountKrw', 'requestedLumina', 'note', 'idempotencyKey', 'metadata'].sort());
      assert.equal(data.requesterUserId, USER); assert.equal(data.settlementKey, settlementKey);
      assert.equal(data.settlementType, settlementKey.startsWith('artist:') ? 'artist' : 'partner');
      assert.equal(data.targetArtistId, settlementKey.startsWith('artist:') ? ARTIST : null);
      assert.equal(data.period, '2026-10'); assert.equal(data.idempotencyKey, idempotencyKey ?? null);
      assert.equal(data.note, 'Synthetic request note'); assert.equal(data.amountKrw.toString(), '1000');
      assert.deepEqual(data.metadata, { source: 'creator_studio', previewOnly: true, unitPriceKrw: '10',
        estimatedAvailableKrw: '5000', reservedKrw: '1000', remainingKrwBeforeRequest: '4000', walletCredit: 'admin_approval_required' });
      f.noFinancialWrites();
    }
    for (const operatorPatch of [{ status: 'suspended' }, { revokedAt: WHEN }, { role: 'manager' }, { permissions: [] }]) {
      const f = fixture([row()], [operator(operatorPatch)]);
      const error = await failure(() => f.service.createSettlementConversion(USER, input()), 'Access must precede replay');
      assert(error instanceof ForbiddenException); assert.equal(f.calls.access.length, 1);
      assert.equal(f.calls.lookup.length, 0); assert.equal(f.calls.create.length, 0); f.noFinancialWrites();
    }
    {
      const f = fixture([row()], [operator({ userId: OTHER })]);
      const denied = await failure(() => f.service.createSettlementConversion(OTHER, input()), 'Foreign partner must not expose replay');
      assert(denied instanceof ForbiddenException); assert.equal(f.calls.access.length, 0); assert.equal(f.calls.lookup.length, 0);
      const result = await f.service.createSettlementConversion(OTHER, input({ settlementKey: partner(OTHER) }));
      assert.equal(result.idempotentReplay, false); assert.equal(result.conversion.id, CREATED);
      assert.equal(f.state.rows.length, 2); assert.equal(f.calls.create[0].data.requesterUserId, OTHER); f.scope(OTHER); f.noFinancialWrites();
    }
    for (const amountKrw of ['999.99', '4000.01']) {
      const f = fixture(); f.state.reserved = new Decimal(1000);
      const error = await failure(() => f.service.createSettlementConversion(USER, input({ amountKrw })), 'Original minimum/remaining admission must hold');
      assert(error instanceof BadRequestException); assert.equal(f.calls.create.length, 0); f.noFinancialWrites();
    }
  });

  it('03 exact SDK idempotency constraint collision replays only matching caller intent with one create', async () => {
    const targets = [['requesterUserId', 'idempotencyKey'], ['idempotency_key', 'requester_user_id'], CONSTRAINT];
    for (const target of targets) for (const patch of [{}, { amountKrw: new Decimal(1100) },
      { settlementKey: partner(USER, '2026-11'), period: '2026-11' }, { note: 'Synthetic competing note' }] as Partial<Row>[]) {
      const winner = row(patch), f = fixture(), expectedWinner = snapshot([winner]);
      f.state.createError = unique({ target, modelName: MODEL }); f.state.winner = winner;
      const action = () => f.service.createSettlementConversion(USER, input({ amountKrw: '1000.00', note: null }));
      if (Object.keys(patch).length === 0) {
        const result = await action(); assert.equal(result.idempotentReplay, true);
        assert.equal(result.conversion.id, winner.id); assert.equal(result.conversion.requestedLumina.toString(), '37');
        assert.equal(result.conversion.status, winner.status); assert.deepEqual(result.conversion.metadata, winner.metadata);
      } else await conflict(action, 'Different competing intent must not replay');
      assert.equal(f.calls.lookup.length, 3); assert.equal(f.calls.create.length, 1);
      assert.equal(f.calls.access.length, 2); assert.equal(f.calls.preview.length, 1); assert.equal(f.calls.aggregate.length, 1);
      assert.equal(f.state.ownCreates, 0); assert.equal(f.state.externalCommits, 1);
      assert.equal(snapshot(f.state.rows), expectedWinner); f.scope(); f.noFinancialWrites();
    }
  });

  it('04 unrelated collision unknown winner and lookup failures propagate original errors without retry', async () => {
    const rejected = [
      { code: 'P2002', meta: { target: CONSTRAINT } },
      unique({ target: CONSTRAINT }, 'P2003'),
      unique({ target: ['id'] }), unique({}),
      unique({ target: ['requesterUserId', 'idempotency_key'] }),
      unique({ target: ['requesterUserId', 'idempotencyKey', 'id'] }),
      unique({ target: ['requesterUserId', 'requesterUserId'] }),
      unique({ target: [CONSTRAINT] }), unique({ target: CONSTRAINT + '_suffix' }),
      unique({ target: CONSTRAINT, modelName: 'UnrelatedModel' }),
      unique({ target: CONSTRAINT, modelName: null }),
      new Error('Synthetic infrastructure create failure'),
    ];
    for (const error of rejected) {
      const f = fixture(); f.state.createError = error;
      assert.equal(await failure(() => f.service.createSettlementConversion(USER, input()), 'Original create error must propagate'), error);
      assert.equal(f.calls.lookup.length, 2); assert.equal(f.calls.create.length, 1); assert.equal(f.state.rows.length, 0);
      assert.equal(f.state.ownCreates, 0); f.scope(); f.noFinancialWrites();
    }
    {
      const error = unique({ target: CONSTRAINT }), f = fixture(); f.state.createError = error;
      assert.equal(await failure(() => f.service.createSettlementConversion(USER, input()), 'Absent winner retains exact P2002'), error);
      assert.equal(f.calls.lookup.length, 3); assert.equal(f.calls.create.length, 1); assert.equal(f.state.rows.length, 0); f.scope(); f.noFinancialWrites();
    }
    {
      const error = unique({ target: CONSTRAINT }), lookup = new Error('Synthetic recovery lookup failure'), f = fixture();
      f.state.createError = error; f.state.lookupErrorAt = 3; f.state.lookupError = lookup;
      assert.equal(await failure(() => f.service.createSettlementConversion(USER, input()), 'Recovery lookup failure is not remapped'), lookup);
      assert.equal(f.calls.lookup.length, 3); assert.equal(f.calls.create.length, 1); f.noFinancialWrites();
    }
    {
      const error = unique({ target: CONSTRAINT }), f = fixture(); f.state.createError = error;
      assert.equal(await failure(() => f.service.createSettlementConversion(USER, input({ idempotencyKey: null })), 'No caller key means no recovery'), error);
      assert.equal(f.calls.lookup.length, 0); assert.equal(f.calls.create.length, 1); f.noFinancialWrites();
    }
  });
});
