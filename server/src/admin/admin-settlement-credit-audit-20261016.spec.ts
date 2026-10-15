import assert = require('node:assert/strict');
import { AsyncLocalStorage } from 'node:async_hooks';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type SettlementLuminaConversionRequest, type WalletAccount, type WalletLedger } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { AuthUser } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

const ID = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const WALLET = '44444444-4444-4444-8444-444444444444';
const LEDGER = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-10-16T00:00:00.500Z');
const OLD = new Date('2026-10-15T00:00:00.123Z');
const OPERATOR: AuthUser = { id: ACTOR, adminRole: 'settlement_admin' };
const AUDIT_FAILURE = new Error('SYNTHETIC_CREDIT_AUDIT_REJECTED');
const WORK_FAILURE = new Error('SYNTHETIC_CREDIT_WORK_REJECTED');
const COMMIT_FAILURE = new Error('SYNTHETIC_CREDIT_COMMIT_REJECTED');
const CREDIT_LOCK = 'SELECT id FROM settlement_lumina_conversion_requests WHERE id = ?::uuid FOR UPDATE';
const SNAPSHOT = '\n            SELECT xmin::text AS "rowVersion" FROM settlement_lumina_conversion_requests\n            WHERE id = ?::uuid';
const VERSION_LOCK = '\n        SELECT xmin::text AS "rowVersion" FROM settlement_lumina_conversion_requests\n        WHERE id = ?::uuid FOR UPDATE';
const POLICY = {
  requestOnly: true, unitPriceKrw: 10, minAmountKrw: 1000,
  statusFlow: { requested: ['approved', 'rejected', 'credited', 'cancelled'],
    approved: ['credited', 'rejected', 'cancelled'], rejected: [], credited: [], cancelled: [] },
  walletCredit: { status: 'credited', ledgerType: 'settlement_lumina_conversion',
    referenceType: 'settlement_lumina_conversion_request', idempotencyKeyPrefix: 'settlement-lumina-conversion' },
};
type State = { row: SettlementLuminaConversionRequest | null; wallet: WalletAccount | null;
  ledgers: WalletLedger[]; audits: Record<string, unknown>[]; version: string };
type Tx = { work: State; active: boolean; locked: boolean; readOnly: boolean;
  isolation: Prisma.TransactionIsolationLevel | undefined; writes: number };
type Failure = 'audit' | 'ledger' | 'balance' | 'conversion' | 'commit' | null;
type Seed = 'first' | 'linked' | 'linked-null' | 'relink';

function newRow(status = 'approved'): SettlementLuminaConversionRequest {
  return { id: ID, requesterUserId: OWNER, settlementKey: 'partner:' + OWNER + ':2026-10',
    settlementType: 'partner', period: '2026-10', targetArtistId: null,
    amountKrw: new Decimal('1250'), requestedLumina: new Decimal('125'), status,
    note: 'Synthetic attribution', adminNote: 'old synthetic note', walletLedgerId: null,
    processedByUserId: null, processedAt: null, idempotencyKey: 'synthetic-request-key',
    metadata: { synthetic: true }, createdAt: new Date(OLD.getTime()), updatedAt: new Date(OLD.getTime()) };
}
function newWallet(balance = '10'): WalletAccount {
  return { id: WALLET, userId: OWNER, currencyCode: 'LUMINA', status: 'active',
    cachedBalance: new Decimal(balance), createdAt: new Date(OLD.getTime()), updatedAt: new Date(OLD.getTime()) };
}
function newLedger(data?: Record<string, unknown>): WalletLedger {
  return { id: LEDGER, walletAccountId: WALLET, direction: 'credit', amount: new Decimal('125'),
    ledgerType: 'settlement_lumina_conversion', referenceType: 'settlement_lumina_conversion_request',
    referenceId: ID, idempotencyKey: 'settlement-lumina-conversion:' + ID,
    memo: 'Settlement money charged as Lumina: partner:' + OWNER + ':2026-10',
    createdAt: new Date(OLD.getTime()), ...data } as WalletLedger;
}
function copyRow(row: SettlementLuminaConversionRequest | null) {
  return row && { ...row, amountKrw: new Decimal(row.amountKrw), requestedLumina: new Decimal(row.requestedLumina),
    metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? { ...row.metadata } : row.metadata,
    createdAt: new Date(row.createdAt.getTime()), updatedAt: new Date(row.updatedAt.getTime()),
    processedAt: row.processedAt && new Date(row.processedAt.getTime()) };
}
function clone(state: State): State {
  return { row: copyRow(state.row), wallet: state.wallet && { ...state.wallet,
    cachedBalance: new Decimal(state.wallet.cachedBalance), createdAt: new Date(state.wallet.createdAt.getTime()),
    updatedAt: new Date(state.wallet.updatedAt.getTime()) },
    ledgers: state.ledgers.map(row => ({ ...row, amount: new Decimal(row.amount), createdAt: new Date(row.createdAt.getTime()) })),
    audits: state.audits.map(row => ({ ...row })), version: state.version };
}
function json(value: unknown): unknown { return JSON.parse(JSON.stringify(value)); }
function keys(value: object, expected: string[]) { assert.deepEqual(Object.keys(value).sort(), [...expected].sort()); }

function fixture(seed: Seed = 'first', status = 'approved', existingWallet = false, processedAt = false) {
  const row = newRow(status);
  if (seed === 'linked' || seed === 'linked-null') row.walletLedgerId = LEDGER;
  if (processedAt) row.processedAt = new Date(OLD.getTime());
  let state: State = { row, wallet: existingWallet || seed !== 'first' ? newWallet(seed === 'first' ? '10' : '135') : null,
    ledgers: seed === 'linked' || seed === 'relink' ? [newLedger()] : [], audits: [], version: '910001' };
  let failure: Failure = null, versionMismatch = false;
  const context = new AsyncLocalStorage<Tx>();
  const faults: string[] = [];
  const stats = { attempted: 0, rootReads: 0, rootAudits: 0, txAudits: 0, txStarts: 0,
    commits: 0, rollbacks: 0, readOnlyCompleted: 0, locks: 0, rowWrites: 0,
    ledgerCreates: 0, balanceWrites: 0, upserts: 0, readOnlyWrites: 0 };
  const events: string[] = [];
  function admit<T>(tx: Tx | null, name: string, validate: () => T): T {
    stats.attempted++; events.push((tx ? 'tx:' : 'root:') + name);
    try {
      assert.equal(context.getStore() ?? null, tx, 'No root pool checkout inside a transaction');
      if (tx) assert.equal(tx.active, true);
      return validate();
    } catch (error) { faults.push(name); throw error; }
  }
  function write(tx: Tx | null) {
    assert(tx && tx.locked);
    if (tx.readOnly) { stats.readOnlyWrites++; throw new Error('SYNTHETIC_READONLY_WRITE_DENIED'); }
    tx.writes++;
  }
  function delegates(tx: Tx | null) {
    const current = () => tx ? tx.work : state;
    const operation = <T>(name: string, validate: () => T) => admit(tx, name, validate);
    const value = {
      settlementLuminaConversionRequest: {
        findUnique: async (args: { where: { id: string } }) => {
          operation('conversion.read', () => {
            keys(args, ['where']); assert.deepEqual(args.where, { id: ID });
            if (tx) assert(tx.readOnly || tx.locked); else stats.rootReads++;
          });
          return copyRow(current().row);
        },
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          operation('conversion.update', () => {
            write(tx); keys(args, ['where', 'data']); assert.deepEqual(args.where, { id: ID });
            assert(current().row); assert.equal(args.data.status, 'credited');
            assert.equal(args.data.processedByUserId, ACTOR); assert(args.data.processedAt instanceof Date);
            assert(args.data.updatedAt instanceof Date);
            keys(args.data, args.data.walletLedgerId === undefined
              ? ['status', 'adminNote', 'processedByUserId', 'processedAt', 'updatedAt']
              : ['status', 'adminNote', 'walletLedgerId', 'processedByUserId', 'processedAt', 'updatedAt']);
            if (args.data.walletLedgerId !== undefined) assert.equal(args.data.walletLedgerId, LEDGER);
          });
          stats.rowWrites++;
          if (failure === 'conversion') throw WORK_FAILURE;
          current().row = { ...current().row!, ...args.data } as SettlementLuminaConversionRequest;
          current().version = '910002'; return copyRow(current().row)!;
        },
        updateMany: async (args: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
          operation('conversion.cas', () => {
            write(tx); keys(args, ['where', 'data']); keys(args.where, ['id', 'status']);
            assert.equal(args.where.id, ID); assert.equal(args.where.status, current().row?.status);
            keys(args.data, ['status', 'adminNote', 'processedByUserId', 'processedAt', 'updatedAt']);
          });
          stats.rowWrites++; current().row = { ...current().row!, ...args.data } as SettlementLuminaConversionRequest;
          current().version = '910002'; return { count: 1 };
        },
      },
      walletAccount: {
        upsert: async (args: Record<string, unknown>) => {
          operation('wallet.upsert', () => {
            write(tx); assert.deepEqual(args, { where: { userId_currencyCode: { userId: OWNER, currencyCode: 'LUMINA' } },
              update: {}, create: { userId: OWNER, currencyCode: 'LUMINA' } });
          });
          stats.upserts++; if (!current().wallet) current().wallet = newWallet('0');
          return { ...current().wallet! };
        },
        update: async (args: { where: { id: string }; data: { cachedBalance: { increment: Decimal }; updatedAt: Date } }) => {
          operation('wallet.update', () => {
            write(tx); keys(args, ['where', 'data']); assert.deepEqual(args.where, { id: WALLET });
            keys(args.data, ['cachedBalance', 'updatedAt']); keys(args.data.cachedBalance, ['increment']);
            assert(args.data.cachedBalance.increment instanceof Decimal);
            assert(args.data.cachedBalance.increment.eq('125')); assert(args.data.updatedAt instanceof Date);
            assert(current().wallet);
          });
          stats.balanceWrites++;
          if (failure === 'balance') throw WORK_FAILURE;
          current().wallet!.cachedBalance = current().wallet!.cachedBalance.plus(args.data.cachedBalance.increment);
          current().wallet!.updatedAt = args.data.updatedAt; return { ...current().wallet! };
        },
      },
      walletLedger: {
        findUnique: async (args: { where: { id?: string; idempotencyKey?: string } }) => {
          operation('ledger.read', () => {
            assert(tx?.locked); keys(args, ['where']);
            if (args.where.id !== undefined) assert.deepEqual(args.where, { id: LEDGER });
            else assert.deepEqual(args.where, { idempotencyKey: 'settlement-lumina-conversion:' + ID });
          });
          const found = current().ledgers.find(item => args.where.id !== undefined
            ? item.id === args.where.id : item.idempotencyKey === args.where.idempotencyKey);
          return found ? { ...found } : null;
        },
        create: async (args: { data: Record<string, unknown> }) => {
          operation('ledger.create', () => {
            write(tx); keys(args, ['data']);
            assert.deepEqual(args.data, { walletAccountId: WALLET, direction: 'credit', amount: new Decimal('125'),
              ledgerType: 'settlement_lumina_conversion', referenceType: 'settlement_lumina_conversion_request',
              referenceId: ID, idempotencyKey: 'settlement-lumina-conversion:' + ID,
              memo: 'Settlement money charged as Lumina: partner:' + OWNER + ':2026-10' });
            assert.equal(current().ledgers.length, 0);
          });
          stats.ledgerCreates++;
          if (failure === 'ledger') throw WORK_FAILURE;
          const ledger = newLedger({ ...args.data, createdAt: new Date(NOW.getTime()) });
          current().ledgers.push(ledger); return { ...ledger };
        },
      },
      auditEvent: {
        create: async (args: { data: Record<string, unknown> }) => {
          operation('audit.create', () => {
            // Baseline root audit is admitted outside its committed Tx so case01 reaches the real state oracle.
            if (tx) write(tx);
            keys(args, ['data']);
            keys(args.data, ['actorUserId', 'actorType', 'action', 'targetType', 'targetId', 'beforeData', 'afterData', 'metadata']);
            assert.equal(args.data.actorUserId, ACTOR); assert.equal(args.data.actorType, 'admin');
            assert.equal(args.data.action, 'settlement_lumina_conversion.status.update');
            assert.equal(args.data.targetType, 'settlement_lumina_conversion_request'); assert.equal(args.data.targetId, ID);
          });
          if (tx) stats.txAudits++; else stats.rootAudits++;
          if (failure === 'audit') throw AUDIT_FAILURE;
          const audit = { ...args.data, id: 'synthetic-audit-' + (current().audits.length + 1) };
          current().audits.push(audit); events.push('audit:resolved'); return audit;
        },
      },
      $executeRaw: async (...args: unknown[]) => operation('readonly', () => {
        assert(tx); assert.equal(tx.isolation, Prisma.TransactionIsolationLevel.RepeatableRead);
        assert.equal(tx.writes, 0); assert.equal(tx.readOnly, false);
        const strings = args[0] as TemplateStringsArray;
        assert(Array.isArray(strings) && Array.isArray(strings.raw)); assert.equal(args.length, 1);
        assert.equal(strings.join('?'), 'SET TRANSACTION READ ONLY'); tx.readOnly = true; return 0;
      }),
      $queryRaw: async (...args: unknown[]) => operation('lock-or-version', () => {
        assert(tx); const strings = args[0] as TemplateStringsArray;
        assert(Array.isArray(strings) && Array.isArray(strings.raw)); assert.equal(args.length, 2); assert.equal(args[1], ID);
        const text = strings.join('?');
        if (tx.readOnly) { assert.equal(text, SNAPSHOT); return [{ rowVersion: current().version }]; }
        if (tx.isolation === Prisma.TransactionIsolationLevel.ReadCommitted) {
          assert.equal(text, VERSION_LOCK); tx.locked = true;
          return [{ rowVersion: versionMismatch ? '910999' : current().version }];
        }
        assert.equal(tx.isolation, undefined); assert.equal(text, CREDIT_LOCK);
        assert.equal(tx.locked, false); tx.locked = true; stats.locks++; return [{ id: ID }];
      }),
    };
    return new Proxy(value, { get(target, prop, receiver) {
      if (typeof prop === 'string' && !(prop in target)) return operation('unknown:' + prop, () => { throw new Error('SYNTHETIC_UNADMITTED_DELEGATE'); });
      return Reflect.get(target, prop, receiver);
    } });
  }
  const root = delegates(null);
  const db = new Proxy({ ...root, $transaction: async <T>(
    callback: (client: ReturnType<typeof delegates>) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ) => {
    admit(null, 'transaction', () => {
      assert.equal(typeof callback, 'function');
      if (options) { keys(options, ['isolationLevel']); assert(options.isolationLevel === Prisma.TransactionIsolationLevel.RepeatableRead
        || options.isolationLevel === Prisma.TransactionIsolationLevel.ReadCommitted); }
    });
    stats.txStarts++;
    const tx: Tx = { work: clone(state), active: true, locked: false, readOnly: false,
      isolation: options?.isolationLevel, writes: 0 };
    return context.run(tx, async () => {
      try {
        const result = await callback(delegates(tx));
        if (failure === 'commit' && !tx.readOnly) throw COMMIT_FAILURE;
        if (tx.readOnly) {
          admit(tx, 'readonly.complete', () => { assert.equal(tx.writes, 0); }); stats.readOnlyCompleted++;
        } else { state = tx.work; stats.commits++; events.push('tx:commit'); }
        return result;
      } catch (error) {
        if (!tx.readOnly) { stats.rollbacks++; events.push('tx:rollback'); }
        throw error;
      } finally { tx.active = false; }
    });
  } }, { get(target, prop, receiver) {
    if (typeof prop === 'string' && !(prop in target)) return admit(null, 'unknown-root:' + prop, () => { throw new Error('SYNTHETIC_UNADMITTED_ROOT'); });
    return Reflect.get(target, prop, receiver);
  } });
  const service = new AdminService(db as unknown as PrismaService, new ConfigService({}));
  const check = () => { assert.deepEqual(faults, [], 'Fixture admission failures must not be swallowed by product catches');
    assert.equal(stats.readOnlyWrites, 0); assert.equal(context.getStore(), undefined); };
  return { service, stats, events, check, finish: check, state: () => clone(state), snapshot: () => JSON.stringify(state),
    fail(value: Failure) { failure = value; }, mismatchVersion() { versionMismatch = true; },
    removeRow() { state.row = null; },
    call(note: unknown = ' new synthetic note ', user: AuthUser = OPERATOR, target = ID, statusValue = 'credited') {
      return service.updateBackstageSettlementConversionStatus(user, target, { status: statusValue, adminNote: note });
    } };
}
type Fixture = ReturnType<typeof fixture>;
async function observed(promise: ReturnType<Fixture['call']>) {
  try { return { value: await promise, error: null }; } catch (error) { return { value: null, error }; }
}
function response(f: Fixture, value: unknown, replay: boolean) {
  const state = f.state(), row = state.row!;
  assert.deepEqual(value, { ok: true, conversion: { ...row, requester: null }, walletLedger: state.ledgers[0] ?? null,
    idempotentReplay: replay, policy: POLICY });
}
function audit(f: Fixture, before: SettlementLuminaConversionRequest, replay: boolean, credit = true) {
  const row = f.state().row!, record = f.state().audits[f.state().audits.length - 1];
  const metadata = { settlementKey: row.settlementKey, settlementType: row.settlementType, period: row.period,
    status: row.status, walletCredited: credit, ...(credit ? { walletLedgerId: row.walletLedgerId, idempotentReplay: replay } : {}) };
  assert.deepEqual(record, { id: 'synthetic-audit-' + f.state().audits.length, actorUserId: ACTOR, actorType: 'admin',
    action: 'settlement_lumina_conversion.status.update', targetType: 'settlement_lumina_conversion_request',
    targetId: ID, beforeData: json(before), afterData: json(row), metadata });
}
function beforeCommit(f: Fixture) {
  assert.equal(f.stats.rootAudits, 0);
  assert.equal(f.events.filter(event => event === 'audit:resolved').length, f.stats.commits);
  for (let index = 0; index < f.events.length; index++) if (f.events[index] === 'tx:commit') {
    assert.equal(f.events[index - 1], 'audit:resolved', 'Credit audit must resolve in the active Tx before commit');
  }
}

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
afterEach(() => { jest.useRealTimers(); });

describe('AdminService settlement credit audit focused', () => {
  it('01 audit rejection propagates and first credit leaves the committed wallet ledger conversion snapshot unchanged', async () => {
    for (const existingWallet of [false, true]) {
      const f = fixture('first', 'approved', existingWallet), before = f.snapshot(); f.fail('audit');
      try {
        const result = await observed(f.call()); f.check();
        assert.equal(result.error, AUDIT_FAILURE, 'Original audit rejection must propagate before the committed-state oracle');
        assert.equal(f.snapshot(), before, 'SETTLEMENT_CREDIT_AUDIT_ATOMICITY: rejected audit left committed credit evidence');
        assert.equal(f.stats.txStarts, 1); assert.equal(f.stats.commits, 0); assert.equal(f.stats.rollbacks, 1);
        assert.equal(f.stats.txAudits, 1); assert.equal(f.stats.rootAudits, 0);
        assert.equal(f.stats.ledgerCreates, 1); assert.equal(f.stats.balanceWrites, 1); assert.equal(f.stats.rowWrites, 1);
      } finally { f.finish(); }
    }
  }, 10000);

  it('02 linked nullable ledger and idempotency relink preserve exact replay payload audits and rollback processing changes', async () => {
    for (const seed of ['linked', 'linked-null', 'relink'] as const) for (const processedAt of [false, true]) {
      const failed = fixture(seed, 'approved', false, processedAt);
      const initial = failed.state(), initialSnapshot = failed.snapshot(); failed.fail('audit');
      try {
        assert.equal(initial.row!.walletLedgerId, seed === 'relink' ? null : LEDGER);
        const rejected = await observed(failed.call(' rejected fresh branch note ')); failed.check();
        assert.equal(rejected.error, AUDIT_FAILURE);
        assert.equal(failed.snapshot(), initialSnapshot, 'Fresh replay branch audit rejection must roll back its own processing and relink');
        assert.equal(failed.state().row!.walletLedgerId, initial.row!.walletLedgerId);
        assert.deepEqual(failed.state().wallet, initial.wallet); assert.deepEqual(failed.state().ledgers, initial.ledgers);
        assert.equal(failed.stats.txStarts, 1); assert.equal(failed.stats.commits, 0); assert.equal(failed.stats.rollbacks, 1);
        assert.equal(failed.stats.txAudits, 1); assert.equal(failed.stats.rootAudits, 0);
        assert.equal(failed.stats.rowWrites, 1); assert.equal(failed.stats.ledgerCreates, 0);
        assert.equal(failed.stats.balanceWrites, 0); assert.equal(failed.stats.upserts, 0);
      } finally { failed.finish(); }
      const f = fixture(seed, 'approved', false, processedAt), before = f.state().row!;
      try {
        const value = await f.call(); f.check(); response(f, value, true); audit(f, before, true);
        assert.equal(f.state().row!.adminNote, 'new synthetic note');
        assert.equal(f.state().row!.processedAt!.getTime(), (processedAt ? OLD : NOW).getTime());
        assert.equal(f.state().wallet!.cachedBalance.toString(), '135');
        assert.equal(f.stats.ledgerCreates, 0); assert.equal(f.stats.balanceWrites, 0); assert.equal(f.stats.upserts, 0);
        if (seed === 'linked-null') assert.equal(f.state().ledgers.length, 0);
        else assert.equal(f.state().ledgers.length, 1);
        beforeCommit(f);
        const committed = f.snapshot(); f.fail('audit');
        const rejected = await observed(f.call(' changed replay note ')); f.check();
        assert.equal(rejected.error, AUDIT_FAILURE); assert.equal(f.snapshot(), committed);
        assert.equal(f.stats.txStarts, 2); assert.equal(f.stats.commits, 1); assert.equal(f.stats.rollbacks, 1);
        assert.equal(f.stats.txAudits, 2); assert.equal(f.stats.rootAudits, 0);
        assert.equal(f.stats.ledgerCreates, 0); assert.equal(f.stats.balanceWrites, 0);
      } finally { f.finish(); }
    }
  }, 10000);

  it('03 first success and replay keep one ledger while work commit and audit failures never retry or publish staged state', async () => {
    for (const status of ['requested', 'approved']) {
      const f = fixture('first', status), original = f.state().row!;
      try {
        const first = await f.call(); f.check(); response(f, first, false); audit(f, original, false);
        const beforeReplay = f.state().row!;
        const replay = await f.call(); f.check(); response(f, replay, true); audit(f, beforeReplay, true);
        assert.equal(f.state().ledgers.length, 1); assert.equal(f.state().wallet!.cachedBalance.toString(), '125');
        assert.equal(f.stats.ledgerCreates, 1); assert.equal(f.stats.balanceWrites, 1);
        assert.equal(f.stats.txStarts, 2); assert.equal(f.stats.txAudits, 2); assert.equal(f.state().audits.length, 2);
        beforeCommit(f);
      } finally { f.finish(); }
    }
    for (const failure of ['ledger', 'balance', 'conversion', 'commit'] as const) {
      const f = fixture(), before = f.snapshot(); f.fail(failure);
      try {
        const result = await observed(f.call()); f.check();
        assert.equal(result.error, failure === 'commit' ? COMMIT_FAILURE : WORK_FAILURE);
        assert.equal(f.snapshot(), before); assert.equal(f.stats.txStarts, 1);
        assert.equal(f.stats.commits, 0); assert.equal(f.stats.rollbacks, 1); assert.equal(f.stats.ledgerCreates, 1);
        assert.equal(f.stats.rootAudits, 0); assert.equal(f.stats.txAudits, failure === 'commit' ? 1 : 0);
      } finally { f.finish(); }
    }
  }, 10000);

  it('04 permission input terminal missing and unchanged noncredit exact-version guards keep their original boundaries', async () => {
    for (const [user, target, status, ErrorType] of [
      [{ id: ACTOR }, ID, 'credited', ForbiddenException],
      [OPERATOR, 'invalid-id', 'credited', BadRequestException],
      [OPERATOR, ID, 'requested', BadRequestException],
    ] as const) {
      const f = fixture(), before = f.snapshot();
      try {
        const result = await observed(f.call(null, user, target, status)); f.check();
        assert(result.error instanceof ErrorType); assert.equal(f.snapshot(), before); assert.equal(f.stats.attempted, 0);
      } finally { f.finish(); }
    }
    for (const [from, to] of [['rejected', 'credited'], ['cancelled', 'credited'], ['credited', 'approved'], ['approved', 'approved']]) {
      const f = fixture('first', from), before = f.snapshot();
      try {
        const result = await observed(f.call(null, OPERATOR, ID, to)); f.check();
        assert(result.error instanceof BadRequestException); assert.equal(f.snapshot(), before);
        assert.equal(f.stats.rowWrites, 0); assert.equal(f.stats.txAudits, 0); assert.equal(f.stats.ledgerCreates, 0);
      } finally { f.finish(); }
    }
    const missing = fixture(); missing.removeRow();
    try {
      const before = missing.snapshot(), result = await observed(missing.call()); missing.check();
      assert(result.error instanceof NotFoundException); assert.equal(missing.snapshot(), before);
      assert.equal(missing.stats.txStarts, 0);
    } finally { missing.finish(); }
    for (const mode of ['success', 'audit-failure', 'version-conflict'] as const) {
      const f = fixture('first', 'requested'), before = f.snapshot(), beforeRow = f.state().row!;
      if (mode === 'audit-failure') f.fail('audit');
      if (mode === 'version-conflict') f.mismatchVersion();
      try {
        const result = await observed(f.call(' noncredit note ', { id: ACTOR, adminPermissions: ['*'] }, ID, 'approved')); f.check();
        assert.equal(f.stats.readOnlyCompleted, 1); assert.equal(f.stats.txStarts, 2);
        assert.equal(f.stats.ledgerCreates, 0); assert.equal(f.stats.balanceWrites, 0);
        if (mode === 'success') {
          assert.equal(result.error, null); assert.equal(f.state().row!.status, 'approved');
          assert.equal(f.state().row!.adminNote, 'noncredit note'); audit(f, beforeRow, false, false);
          assert.deepEqual(result.value, { ok: true, conversion: { ...f.state().row!, requester: null }, policy: POLICY });
        } else {
          assert.equal(f.snapshot(), before); assert.equal(f.stats.commits, 0); assert.equal(f.stats.rollbacks, 1);
          if (mode === 'audit-failure') assert.equal(result.error, AUDIT_FAILURE);
          else assert(result.error instanceof ConflictException);
        }
      } finally { f.finish(); }
    }
  }, 10000);
});
