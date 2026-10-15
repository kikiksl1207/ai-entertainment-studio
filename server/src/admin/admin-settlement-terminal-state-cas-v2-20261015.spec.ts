import assert = require('node:assert/strict');
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type SettlementLuminaConversionRequest } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { AuthUser } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

const ID = '11111111-1111-4111-8111-111111111111';
const REQUESTER = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const WALLET = '44444444-4444-4444-8444-444444444444';
const LEDGER = '55555555-5555-4555-8555-555555555555';
const DATE = new Date('2026-10-15T00:00:00.123Z');
const EXACT_TIME = '2026-10-15T00:00:00.123456Z';
const OPERATOR: AuthUser = { id: ACTOR, adminRole: 'settlement_admin' };
const AUDIT_FAILURE = new Error('SYNTHETIC_SETTLEMENT_AUDIT_FAILURE_V2');
const READ_ONLY = 'SET TRANSACTION READ ONLY';
const SNAPSHOT_SQL = '\n            SELECT xmin::text AS "rowVersion" FROM settlement_lumina_conversion_requests\n            WHERE id = ?::uuid';
const VERSION_LOCK_SQL = '\n        SELECT xmin::text AS "rowVersion" FROM settlement_lumina_conversion_requests\n        WHERE id = ?::uuid FOR UPDATE';
const CREDIT_LOCK_SQL = 'SELECT id FROM settlement_lumina_conversion_requests WHERE id = ?::uuid FOR UPDATE';
const POLICY = {
  requestOnly: true, unitPriceKrw: 10, minAmountKrw: 1000,
  statusFlow: { requested: ['approved', 'rejected', 'credited', 'cancelled'],
    approved: ['credited', 'rejected', 'cancelled'], rejected: [], credited: [], cancelled: [] },
  walletCredit: { status: 'credited', ledgerType: 'settlement_lumina_conversion',
    referenceType: 'settlement_lumina_conversion_request', idempotencyKeyPrefix: 'settlement-lumina-conversion' },
};

type Ledger = Record<string, unknown> & { id: string; idempotencyKey: string; amount: Decimal };
type State = { row: SettlementLuminaConversionRequest; rowVersion: string; exactTime: string;
  wallet: { id: string; userId: string; currencyCode: string; cachedBalance: Decimal };
  ledgers: Ledger[]; audits: Record<string, unknown>[] };
type Tx = { working: State; isolation: Prisma.TransactionIsolationLevel | undefined;
  readOnly: boolean; writes: number; versionLocked: boolean; creditLocked: boolean };

function conversion(status: string): SettlementLuminaConversionRequest {
  return { id: ID, requesterUserId: REQUESTER, settlementKey: 'partner:' + REQUESTER + ':2026-10',
    settlementType: 'partner', period: '2026-10', targetArtistId: null,
    amountKrw: new Decimal(1000), requestedLumina: new Decimal(100), status,
    note: 'Synthetic approved attribution', adminNote: null, walletLedgerId: null,
    processedByUserId: null, processedAt: null, idempotencyKey: 'synthetic-conversion-request',
    metadata: { synthetic: true }, createdAt: new Date(DATE.getTime()), updatedAt: new Date(DATE.getTime()) };
}
function clone(state: State): State {
  return { ...state, row: { ...state.row, updatedAt: new Date(state.row.updatedAt.getTime()) },
    wallet: { ...state.wallet, cachedBalance: new Decimal(state.wallet.cachedBalance) },
    ledgers: state.ledgers.map(row => ({ ...row })), audits: state.audits.map(row => ({ ...row })) };
}
function gate() {
  let open!: () => void;
  const promise = new Promise<void>(done => { open = done; }); return { promise, open };
}
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, wanted]) => {
    const actual = row[key];
    if (wanted instanceof Date) return actual instanceof Date && actual.getTime() === wanted.getTime();
    return actual === wanted;
  });
}
function privateVersionAbsent(value: unknown): void {
  if (!value || typeof value !== 'object' || value instanceof Date || value instanceof Decimal) return;
  for (const [key, child] of Object.entries(value)) {
    expect(['xmin', 'rowVersion']).not.toContain(key); privateVersionAbsent(child);
  }
}

function fixture(status = 'approved') {
  let state: State = { row: conversion(status), rowVersion: '910001', exactTime: EXACT_TIME,
    wallet: { id: WALLET, userId: REQUESTER, currencyCode: 'LUMINA', cachedBalance: new Decimal(10) },
    ledgers: [], audits: [] };
  let nextVersion = 910002, auditFailure = false;
  let held: { kind: 'outer' | 'snapshot'; reached: ReturnType<typeof gate>; release: ReturnType<typeof gate> } | null = null;
  const stats = { outerReads: 0, snapshotReads: 0, writeReads: 0, snapshotCompleted: 0,
    snapshotStarted: 0, readOnlyCommands: 0, versionLocks: 0, creditLocks: 0,
    rowWriteAttempts: 0, ledgerCreateAttempts: 0, balanceWriteAttempts: 0, auditAttempts: 0,
    writerCommits: 0, writerRollbacks: 0, readOnlyWriteAttempts: 0, unsupported: 0,
    snapshotVersions: [] as string[], lockedVersions: [] as string[],
    options: [] as (Prisma.TransactionIsolationLevel | undefined)[] };
  const unsupported: () => never = () => { stats.unsupported++; throw new Error('SYNTHETIC_UNADMITTED_DB_OPERATION_V2'); };
  const tag = (args: unknown[], expected: string, withId: boolean) => {
    const first = args[0];
    if (!Array.isArray(first) || !Array.isArray((first as { raw?: unknown }).raw)
      || first.join('?') !== expected || args.length !== (withId ? 2 : 1)
      || (withId && args[1] !== ID)) unsupported();
  };
  function writable(tx: Tx | null): Tx {
    if (!tx) return unsupported();
    if (tx.readOnly || tx.isolation === Prisma.TransactionIsolationLevel.RepeatableRead) {
      stats.readOnlyWriteAttempts++; throw new Error('SYNTHETIC_READ_ONLY_WRITE_V2');
    }
    if (tx.isolation === Prisma.TransactionIsolationLevel.ReadCommitted ? !tx.versionLocked : !tx.creditLocked) unsupported();
    tx.writes++; return tx;
  }
  function touch(tx: Tx, data: Record<string, unknown>) {
    tx.working.row = { ...tx.working.row, ...data } as SettlementLuminaConversionRequest;
    tx.working.rowVersion = String(nextVersion++);
    if (data.updatedAt instanceof Date) tx.working.exactTime = data.updatedAt.toISOString();
  }
  const delegates = (get: () => State, tx: Tx | null) => ({
    settlementLuminaConversionRequest: {
      findUnique: jest.fn(async (args: { where: Record<string, unknown> }) => {
        if (tx?.isolation === Prisma.TransactionIsolationLevel.RepeatableRead) {
          if (!tx.readOnly) unsupported(); stats.snapshotReads++;
        } else if (tx) stats.writeReads++; else stats.outerReads++;
        const current = get().row;
        const row = matches(current as unknown as Record<string, unknown>, args.where) ? { ...current } : null;
        const kind = !tx ? 'outer' : tx.readOnly ? 'snapshot' : null;
        if (held && held.kind === kind) {
          const flight = held; held = null; flight.reached.open(); await flight.release.promise;
        }
        return row;
      }),
      update: jest.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const writer = writable(tx); stats.rowWriteAttempts++;
        if (!matches(get().row as unknown as Record<string, unknown>, args.where)) unsupported();
        touch(writer, args.data); return { ...get().row };
      }),
      updateMany: jest.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const writer = writable(tx); stats.rowWriteAttempts++;
        if (!matches(get().row as unknown as Record<string, unknown>, args.where)) return { count: 0 };
        touch(writer, args.data); return { count: 1 };
      }),
    },
    walletLedger: {
      findUnique: jest.fn(async (args: { where: Record<string, unknown> }) => {
        const row = get().ledgers.find(value => matches(value, args.where)); return row ? { ...row } : null;
      }),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        writable(tx); stats.ledgerCreateAttempts++;
        if (get().ledgers.some(row => row.idempotencyKey === args.data.idempotencyKey)) unsupported();
        const row = { ...args.data, id: LEDGER } as Ledger; get().ledgers.push(row); return { ...row };
      }),
    },
    walletAccount: {
      upsert: jest.fn(async (args: { where: { userId_currencyCode: { userId: string; currencyCode: string } } }) => {
        writable(tx); expect(args.where.userId_currencyCode).toEqual({ userId: REQUESTER, currencyCode: 'LUMINA' });
        return { ...get().wallet };
      }),
      update: jest.fn(async (args: { where: { id: string }; data: { cachedBalance: { increment: Decimal } } }) => {
        writable(tx); stats.balanceWriteAttempts++; expect(args.where.id).toBe(WALLET);
        get().wallet.cachedBalance = get().wallet.cachedBalance.add(args.data.cachedBalance.increment);
        return { ...get().wallet };
      }),
    },
    auditEvent: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        if (tx) writable(tx); stats.auditAttempts++;
        if (auditFailure) throw AUDIT_FAILURE;
        privateVersionAbsent(args.data);
        const row = { ...args.data, id: 'synthetic-audit-v2-' + (get().audits.length + 1) };
        get().audits.push(row); return row;
      }),
    },
    $executeRaw: jest.fn(async (...args: unknown[]) => {
      tag(args, READ_ONLY, false);
      if (!tx || tx.isolation !== Prisma.TransactionIsolationLevel.RepeatableRead || tx.readOnly || tx.writes) unsupported();
      tx.readOnly = true; stats.readOnlyCommands++; return 0;
    }),
    $queryRaw: jest.fn(async (...args: unknown[]) => {
      if (!tx) return unsupported();
      if (tx.isolation === Prisma.TransactionIsolationLevel.RepeatableRead) {
        tag(args, SNAPSHOT_SQL, true); if (!tx.readOnly) unsupported();
        stats.snapshotVersions.push(get().rowVersion); return [{ rowVersion: get().rowVersion }];
      }
      if (tx.isolation === Prisma.TransactionIsolationLevel.ReadCommitted) {
        tag(args, VERSION_LOCK_SQL, true); tx.versionLocked = true; stats.versionLocks++;
        stats.lockedVersions.push(get().rowVersion); return [{ rowVersion: get().rowVersion }];
      }
      tag(args, CREDIT_LOCK_SQL, true); tx.creditLocked = true; stats.creditLocks++; return [{ id: ID }];
    }),
  });
  const db = { ...delegates(() => state, null),
    $transaction: jest.fn(async <T>(callback: (transaction: ReturnType<typeof delegates>) => Promise<T>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) => {
      const isolation = options?.isolationLevel;
      expect(options ? Object.keys(options) : []).toEqual(options ? ['isolationLevel'] : []);
      if (isolation !== undefined && isolation !== Prisma.TransactionIsolationLevel.RepeatableRead
        && isolation !== Prisma.TransactionIsolationLevel.ReadCommitted) unsupported();
      stats.options.push(isolation);
      const tx: Tx = { working: clone(state), isolation, readOnly: false, writes: 0, versionLocked: false, creditLocked: false };
      if (isolation === Prisma.TransactionIsolationLevel.RepeatableRead) stats.snapshotStarted++;
      try {
        const value = await callback(delegates(() => tx.working, tx));
        if (isolation === Prisma.TransactionIsolationLevel.RepeatableRead) {
          expect(tx.readOnly).toBe(true); expect(tx.writes).toBe(0); stats.snapshotCompleted++;
          // Completing a read-only snapshot must never replace a newer committed winner.
        } else { state = tx.working; stats.writerCommits++; }
        return value;
      } catch (error) {
        if (isolation !== Prisma.TransactionIsolationLevel.RepeatableRead) stats.writerRollbacks++;
        throw error;
      }
    }),
  };
  const service = new AdminService(db as unknown as PrismaService, new ConfigService({}));
  return { service, stats, state: () => state, snapshot: () => JSON.stringify(state),
    holdNextRead(kind: 'outer' | 'snapshot') {
      expect(held).toBeNull(); const flight = { kind, reached: gate(), release: gate() }; held = flight;
      return { reached: flight.reached.promise, release: () => flight.release.open() };
    },
    commitSameDateVersion() {
      expect(state.exactTime).toBe(EXACT_TIME);
      state = { ...clone(state), exactTime: '2026-10-15T00:00:00.123457Z', rowVersion: String(nextVersion++) };
    },
    failAudit() { auditFailure = true; },
    seedExistingLedger(link = false) {
      state.ledgers.push({ id: LEDGER, idempotencyKey: 'settlement-lumina-conversion:' + ID, amount: new Decimal(100) });
      state.wallet.cachedBalance = new Decimal(110); if (link) state.row.walletLedgerId = LEDGER;
    },
  };
}
async function observed(promise: ReturnType<AdminService['updateBackstageSettlementConversionStatus']>) {
  try { return { result: await promise, error: null }; } catch (error) { return { result: null, error }; }
}
function healthy(f: ReturnType<typeof fixture>) {
  expect(f.stats.unsupported).toBe(0); expect(f.stats.readOnlyWriteAttempts).toBe(0);
  expect(f.stats.readOnlyCommands).toBe(f.stats.snapshotStarted);
}

describe('AdminService settlement terminal CAS focused v2', () => {
  it('01 stale credit preserves rejected and cancelled winners with400 and no additional committed evidence', async () => {
    for (const terminal of ['rejected', 'cancelled']) {
      const f = fixture(), held = f.holdNextRead('outer');
      const losing = observed(f.service.updateBackstageSettlementConversionStatus(OPERATOR, ID, { status: 'credited' }));
      try {
        await held.reached;
        const winner = await f.service.updateBackstageSettlementConversionStatus(OPERATOR, ID, { status: terminal });
        expect(winner.conversion.status).toBe(terminal); const committed = f.snapshot(); held.release();
        const lost = await losing;
        assert.equal(f.snapshot(), committed, 'SETTLEMENT_V2_STALE_CREDIT: defeated credit changed a committed terminal');
        expect(lost.error).toBeInstanceOf(BadRequestException); expect((lost.error as BadRequestException).getStatus()).toBe(400);
        expect(f.state().audits).toHaveLength(1); expect(f.state().ledgers).toHaveLength(0);
        expect(f.state().wallet.cachedBalance.toString()).toBe('10'); healthy(f);
      } finally { held.release(); await losing; }
    }
  }, 10000);

  it('02 stale non-credit and same-Date exact-version changes lose409 without read-only snapshot resurrection', async () => {
    const f = fixture(), held = f.holdNextRead('snapshot'), initialVersion = f.state().rowVersion;
    const losing = observed(f.service.updateBackstageSettlementConversionStatus(OPERATOR, ID, { status: 'rejected' }));
    try {
      await held.reached;
      await f.service.updateBackstageSettlementConversionStatus(OPERATOR, ID, { status: 'credited' });
      const committed = f.snapshot(), winnerVersion = f.state().rowVersion; held.release(); const lost = await losing;
      assert.equal(f.snapshot(), committed, 'SETTLEMENT_V2_READONLY_RESURRECTION: old snapshot or stale writer overwrote winner');
      expect(lost.error).toBeInstanceOf(ConflictException); expect((lost.error as ConflictException).getStatus()).toBe(409);
      expect(f.stats.snapshotVersions).toEqual([initialVersion]); expect(f.stats.lockedVersions).toEqual([winnerVersion]);
      expect(f.stats.snapshotCompleted).toBe(1); expect(f.state().ledgers).toHaveLength(1);
      expect(f.state().wallet.cachedBalance.toString()).toBe('110'); expect(f.state().audits).toHaveLength(1); healthy(f);
    } finally { held.release(); await losing; }

    const v = fixture('requested'), pending = v.holdNextRead('snapshot');
    const originalVersion = v.state().rowVersion, originalDate = v.state().row.updatedAt.getTime();
    const stale = observed(v.service.updateBackstageSettlementConversionStatus(OPERATOR, ID, { status: 'approved' }));
    try {
      await pending.reached; v.commitSameDateVersion();
      expect(v.state().row.status).toBe('requested'); expect(v.state().row.updatedAt.getTime()).toBe(originalDate);
      expect(v.state().exactTime).toBe('2026-10-15T00:00:00.123457Z'); expect(v.state().rowVersion).not.toBe(originalVersion);
      const committed = v.snapshot(), currentVersion = v.state().rowVersion; pending.release(); const lost = await stale;
      assert.equal(v.snapshot(), committed, 'SETTLEMENT_V2_SAME_DATE_VERSION: exact version change was lost or overwritten');
      expect(lost.error).toBeInstanceOf(ConflictException); expect((lost.error as ConflictException).getStatus()).toBe(409);
      expect(v.stats.snapshotVersions).toEqual([originalVersion]); expect(v.stats.lockedVersions).toEqual([currentVersion]);
      expect(v.stats.rowWriteAttempts).toBe(0); expect(v.stats.auditAttempts).toBe(0);
      expect(v.stats.writerCommits).toBe(0); expect(v.stats.writerRollbacks).toBe(1); healthy(v);
    } finally { pending.release(); await stale; }
  }, 10000);

  it('03 unchanged exact versions normal credit replay and non-credit audit rollback preserve original policy', async () => {
    const normal = fixture('requested');
    expect(normal.state().exactTime).toBe(EXACT_TIME); expect(normal.state().row.updatedAt.toISOString()).toBe('2026-10-15T00:00:00.123Z');
    const approved = await normal.service.updateBackstageSettlementConversionStatus(OPERATOR, ID, { status: 'approved', adminNote: '  synthetic note  ' });
    expect(approved).toMatchObject({ ok: true, policy: POLICY }); expect(normal.state().row.adminNote).toBe('synthetic note');
    expect(normal.stats.snapshotVersions).toEqual(['910001']); expect(normal.stats.lockedVersions).toEqual(['910001']);
    expect(normal.stats.options).toEqual([Prisma.TransactionIsolationLevel.RepeatableRead, Prisma.TransactionIsolationLevel.ReadCommitted]);
    expect(normal.stats.snapshotCompleted).toBe(1); expect(normal.stats.writerCommits).toBe(1);
    expect(normal.state().audits).toHaveLength(1); privateVersionAbsent(approved); healthy(normal);

    for (const status of ['requested', 'approved']) {
      const f = fixture(status);
      const first = await f.service.updateBackstageSettlementConversionStatus(OPERATOR, ID, { status: 'credited' });
      expect(first).toMatchObject({ ok: true, idempotentReplay: false, policy: POLICY });
      const replay = await f.service.updateBackstageSettlementConversionStatus(OPERATOR, ID, { status: 'credited' });
      expect(replay).toMatchObject({ ok: true, idempotentReplay: true, policy: POLICY });
      expect(f.state().ledgers).toHaveLength(1); expect(f.state().row.walletLedgerId).toBe(LEDGER);
      expect(f.state().ledgers[0]).toMatchObject({ amount: new Decimal(100), referenceId: ID,
        referenceType: 'settlement_lumina_conversion_request', ledgerType: 'settlement_lumina_conversion', direction: 'credit' });
      expect(f.state().wallet.cachedBalance.toString()).toBe('110'); expect(f.state().audits).toHaveLength(2);
      expect(f.stats.ledgerCreateAttempts).toBe(1); expect(f.stats.balanceWriteAttempts).toBe(1);
      expect(f.stats.snapshotStarted).toBe(0); expect(f.stats.creditLocks).toBe(2); privateVersionAbsent(first); privateVersionAbsent(replay); healthy(f);
    }
    const linked = fixture(); linked.seedExistingLedger();
    const recovered = await linked.service.updateBackstageSettlementConversionStatus(OPERATOR, ID, { status: 'credited' });
    expect(recovered).toMatchObject({ idempotentReplay: true, policy: POLICY });
    expect(linked.state().row.walletLedgerId).toBe(LEDGER); expect(linked.stats.ledgerCreateAttempts).toBe(0);
    expect(linked.stats.balanceWriteAttempts).toBe(0); expect(linked.state().wallet.cachedBalance.toString()).toBe('110'); healthy(linked);
    for (const [from, to] of [['rejected', 'credited'], ['cancelled', 'credited'], ['credited', 'approved'], ['approved', 'approved']]) {
      const f = fixture(from); if (from === 'credited') f.seedExistingLedger(true); const before = f.snapshot();
      await expect(f.service.updateBackstageSettlementConversionStatus(OPERATOR, ID, { status: to })).rejects.toBeInstanceOf(BadRequestException);
      expect(f.snapshot()).toBe(before); expect(f.stats.rowWriteAttempts).toBe(0); expect(f.stats.auditAttempts).toBe(0); healthy(f);
    }
    const denied = fixture(), deniedBefore = denied.snapshot();
    await expect(denied.service.updateBackstageSettlementConversionStatus({ id: ACTOR }, ID, { status: 'credited' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(denied.service.updateBackstageSettlementConversionStatus(OPERATOR, 'invalid-id', { status: 'credited' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(denied.service.updateBackstageSettlementConversionStatus(OPERATOR, ID, { status: 'requested' })).rejects.toBeInstanceOf(BadRequestException);
    expect(denied.snapshot()).toBe(deniedBefore); expect(denied.stats.outerReads).toBe(0); expect(denied.stats.snapshotStarted).toBe(0);
    const wildcard = fixture('requested');
    await wildcard.service.updateBackstageSettlementConversionStatus({ id: ACTOR, adminPermissions: ['*'] }, ID, { status: 'approved' });
    expect(wildcard.state().row.status).toBe('approved'); healthy(wildcard);

    const failed = fixture('requested'), beforeFailure = failed.snapshot(); failed.failAudit();
    await expect(failed.service.updateBackstageSettlementConversionStatus(OPERATOR, ID, { status: 'approved' })).rejects.toBe(AUDIT_FAILURE);
    assert.equal(failed.snapshot(), beforeFailure, 'SETTLEMENT_V2_AUDIT_ROLLBACK: failed non-credit audit committed status or version');
    expect(failed.stats.snapshotCompleted).toBe(1); expect(failed.stats.writerRollbacks).toBe(1); expect(failed.stats.writerCommits).toBe(0);
    expect(failed.stats.rowWriteAttempts).toBe(1); expect(failed.stats.auditAttempts).toBe(1);
    expect(failed.stats.ledgerCreateAttempts).toBe(0); expect(failed.stats.balanceWriteAttempts).toBe(0); healthy(failed);
  }, 10000);
});
