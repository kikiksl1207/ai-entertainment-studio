import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AuthUser } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

jest.setTimeout(90_000);
const COMMIT = '110d6bf463e5ed7eca464b1f68dcec65859bde13';
const SERVICE_SHA = 'e490a68a146b05dafc142833269b88017bcea94c54bf1632d316c8ed9b081e5e';
const MAX_BYTES = 50_000_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const normalize = (value: string) => resolve(value).replace(/\\/g, '/').toLowerCase();
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const native = process.env.RUN_SETTLEMENT_CREDIT_AUDIT_NATIVE === '1' ? describe : describe.skip;
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
type TableState = { relation: string; rows: string; digest: string };
type Exclusions = Record<string, string[]>;
type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };
type Fixture = { requester: string; conversion: string; wallet: string | null; ledger: string | null };
type ConversionResult = Awaited<ReturnType<AdminService['updateBackstageSettlementConversionStatus']>>;
const settle = <T>(promise: Promise<T>): Promise<Result<T>> => promise.then(
  value => ({ ok: true as const, value }), error => ({ ok: false as const, error }),
);
const POLICY = {
  requestOnly: true, unitPriceKrw: 10, minAmountKrw: 1000,
  statusFlow: { requested: ['approved', 'rejected', 'credited', 'cancelled'],
    approved: ['credited', 'rejected', 'cancelled'], rejected: [], credited: [], cancelled: [] },
  walletCredit: { status: 'credited', ledgerType: 'settlement_lumina_conversion',
    referenceType: 'settlement_lumina_conversion_request', idempotencyKeyPrefix: 'settlement-lumina-conversion' },
};
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function gate() {
  let open!: () => void;
  const promise = new Promise<void>(yes => { open = yes; });
  return { promise, open };
}
async function bounded<T>(promise: Promise<T>, ms = 6_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Owned audit gate timed out')), ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

native('settlement credit audit postgres (actual public Admin method and FK rollback)', () => {
  let setup: PrismaClient, observer: PrismaClient, writer: PrismaClient;
  let initial: TableState[] | undefined, caseStart: TableState[] | undefined;
  let actor: AuthUser, missingActor: string;
  const owned: Exclusions = {
    users: [], settlement_lumina_conversion_requests: [], wallet_accounts: [], wallet_ledger: [], audit_events: [],
  };
  let caseOwned: Exclusions = {};
  const config = { get() { throw new Error('Unexpected configuration access'); } } as unknown as ConfigService;
  const service = (db: unknown) => new AdminService(db as PrismaService, config);
  function remember(table: string, id: string) {
    check(Object.prototype.hasOwnProperty.call(owned, table) && UUID.test(id), 'Exact owned table and UUID required');
    if (owned[table].includes(id)) return;
    check(owned[table].length < 24, 'Bounded owned row count required');
    owned[table].push(id);
    if (caseStart) (caseOwned[table] ??= []).push(id);
  }
  async function snapshot(exclude: Exclusions = {}): Promise<TableState[]> {
    const tables = await observer.$queryRaw<Array<{ relation: string }>>`
      SELECT table_name AS relation FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
    check(tables.length > 0 && tables.length <= 256, 'Bounded public table inventory required');
    const result: TableState[] = [];
    for (const { relation } of tables) {
      check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(relation), 'Unexpected catalog relation');
      const ids = exclude[relation] ?? [];
      check(ids.length <= 24 && ids.every(id => UUID.test(id)), 'Bounded exact row exclusions required');
      const where = ids.length ? ` WHERE t.id NOT IN (${ids.map((_, i) => `$${i + 1}::uuid`).join(',')})` : '';
      const [row] = await observer.$queryRawUnsafe<Array<{ rows: string; digest: string }>>(
        `SELECT count(*)::text AS rows, md5(COALESCE(string_agg(md5(to_jsonb(t)::text || ':' || t.xmin::text), '' ` +
        `ORDER BY to_jsonb(t)::text, t.xmin::text), '')) AS digest FROM "public"."${relation}" t` + where, ...ids);
      check(row && /^\d+$/.test(row.rows) && /^[a-f0-9]{32}$/.test(row.digest), 'Actual bounded row digest required');
      result.push({ relation, ...row });
    }
    return result;
  }
  async function bounds() {
    const [row] = await observer.$queryRaw<Array<{ bytes: string; readonly: boolean }>>`
      SELECT pg_database_size(current_database())::text AS bytes,
        current_setting('default_transaction_read_only') = 'on'
        AND current_setting('transaction_read_only') = 'on' AS readonly`;
    check(row.readonly && Number(row.bytes) > 0 && Number(row.bytes) <= MAX_BYTES,
      'Read-only observer and bounded fresh database required');
  }
  async function fixture(branch: 'first' | 'linked' | 'relink'): Promise<Fixture> {
    const requester = randomUUID(), conversion = randomUUID();
    await setup.user.create({ data: { id: requester, status: 'active' } }); remember('users', requester);
    let wallet: string | null = null, ledger: string | null = null;
    if (branch !== 'first') {
      wallet = randomUUID(); ledger = randomUUID();
      await setup.walletAccount.create({ data: {
        id: wallet, userId: requester, currencyCode: 'LUMINA', cachedBalance: new Decimal(100),
      } }); remember('wallet_accounts', wallet);
      await setup.walletLedger.create({ data: {
        id: ledger, walletAccountId: wallet, direction: 'credit', amount: new Decimal(100),
        ledgerType: 'settlement_lumina_conversion', referenceType: 'settlement_lumina_conversion_request',
        referenceId: conversion, idempotencyKey: 'settlement-lumina-conversion:' + conversion,
        memo: 'Synthetic already-credited ledger fixture, not a payment',
      } }); remember('wallet_ledger', ledger);
    }
    await setup.settlementLuminaConversionRequest.create({ data: {
      id: conversion, requesterUserId: requester, settlementKey: 'partner:' + requester + ':2026-10',
      settlementType: 'partner', period: '2026-10', targetArtistId: null,
      amountKrw: new Decimal(1000), requestedLumina: new Decimal(100),
      status: branch === 'linked' ? 'credited' : branch === 'relink' ? 'approved' : 'requested',
      walletLedgerId: branch === 'linked' ? ledger : null,
      processedAt: branch === 'linked' ? new Date('2026-10-15T00:00:00.123Z') : null,
      note: 'Synthetic owned audit fixture', idempotencyKey: randomUUID(), metadata: { synthetic: true },
    } }); remember('settlement_lumina_conversion_requests', conversion);
    return { requester, conversion, wallet, ledger };
  }

  // All delegates forward to actual Prisma. Only audit actor substitution and a pre-commit gate are test seams.
  function instrument(db: PrismaClient, options: { failAudit?: boolean; holdAfterAudit?: boolean } = {}) {
    const auditReached = gate(), releaseAudit = gate();
    const stats = {
      transactions: 0, active: 0, rootDuringTx: 0, rootAudits: 0, txAudits: 0, sqlForeignKeyRejects: 0,
      substitutedActors: 0, barriers: 0, faults: 0, sqlError: null as unknown,
      operations: {} as Record<string, number>,
    };
    function admit(value: unknown, message: string): asserts value {
      if (!value) { stats.faults++; throw new Error(message); }
    }
    const countedDelegates = new Set(['settlementLuminaConversionRequest', 'walletAccount', 'walletLedger']);
    function delegate(target: object, name: string, inside: boolean) {
      return new Proxy(target, { get(model, key) {
        const value: unknown = Reflect.get(model, key);
        if (typeof value !== 'function') return value;
        return async (...args: unknown[]) => {
          if (!inside && stats.active) { stats.rootDuringTx++; admit(false, 'Root checkout inside Tx is unadmitted'); }
          const label = (inside ? 'tx.' : 'root.') + name + '.' + String(key);
          stats.operations[label] = (stats.operations[label] ?? 0) + 1;
          admit(stats.operations[label] <= 3, 'Finite delegate attempt count required');
          return await Reflect.apply(value, model, args);
        };
      } });
    }
    const client = new Proxy(db, { get(target, key) {
      if (key === 'auditEvent') return new Proxy(target.auditEvent, { get(model, member) {
        if (member === 'create') return () => { stats.rootAudits++; admit(false, 'Root audit is outside the admitted transaction'); };
        const value: unknown = Reflect.get(model, member); return typeof value === 'function' ? value.bind(model) : value;
      } });
      if (key === '$transaction') return async (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>, transactionOptions: unknown,
      ) => {
        admit(typeof callback === 'function' && transactionOptions === undefined && stats.transactions === 0,
          'Exactly one original default-isolation credit transaction required');
        stats.transactions++;
        return await target.$transaction(async tx => {
          stats.active++;
          try {
            const wrapped = new Proxy(tx, { get(current, field) {
              if (field === 'auditEvent') return new Proxy(current.auditEvent, { get(model, member) {
                if (member === 'create') return async (args: Prisma.AuditEventCreateArgs) => {
                  stats.txAudits++;
                  admit(stats.txAudits === 1 && Object.keys(args).join(',') === 'data', 'One actual audit INSERT required');
                  admit(Object.keys(args.data).sort().join(',') ===
                    'action,actorType,actorUserId,afterData,beforeData,metadata,targetId,targetType'
                    && !Object.prototype.hasOwnProperty.call(args.data, 'actorUser'), 'Original closed audit input required');
                  let selected = args;
                  if (options.failAudit) {
                    stats.substitutedActors++;
                    selected = { ...args, data: {
                      ...(args.data as Prisma.AuditEventUncheckedCreateInput), actorUserId: missingActor,
                    } };
                  }
                  const row = await model.create(selected).catch((error: unknown) => {
                    if (options.failAudit && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
                      stats.sqlForeignKeyRejects++; stats.sqlError = error;
                    }
                    throw error;
                  });
                  if (options.holdAfterAudit) {
                    stats.barriers++; auditReached.open(); await bounded(releaseAudit.promise);
                  }
                  return row;
                };
                const value: unknown = Reflect.get(model, member); return typeof value === 'function' ? value.bind(model) : value;
              } });
              if (countedDelegates.has(String(field))) {
                return delegate(Reflect.get(current, field) as object, String(field), true);
              }
              const value: unknown = Reflect.get(current, field); return typeof value === 'function' ? value.bind(current) : value;
            } });
            return await callback(wrapped);
          } finally { stats.active--; }
        }, { timeout: 15_000, maxWait: 15_000 });
      };
      if (countedDelegates.has(String(key))) return delegate(Reflect.get(target, key) as object, String(key), false);
      const value: unknown = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    function healthy(firstCredit: boolean, failed: boolean) {
      check(stats.faults === 0 && stats.transactions === 1 && stats.active === 0 && stats.rootDuringTx === 0
        && stats.rootAudits === 0 && stats.txAudits === 1, 'All fixture admissions and exact Tx ownership must hold outside product catch');
      check(stats.operations['root.settlementLuminaConversionRequest.findUnique'] === 1
        && stats.operations['tx.settlementLuminaConversionRequest.findUnique'] === 1
        && stats.operations['tx.settlementLuminaConversionRequest.update'] === 1,
      'Actual public preflight, locked reread and one conversion update required');
      check((stats.operations['tx.walletLedger.create'] ?? 0) === (firstCredit ? 1 : 0)
        && (stats.operations['tx.walletAccount.upsert'] ?? 0) === (firstCredit ? 1 : 0)
        && (stats.operations['tx.walletAccount.update'] ?? 0) === (firstCredit ? 1 : 0),
      'Only the first-credit branch may create a ledger and increment balance');
      check(stats.substitutedActors === (failed ? 1 : 0) && stats.sqlForeignKeyRejects === (failed ? 1 : 0)
        && stats.barriers === (options.holdAfterAudit ? 1 : 0), 'Actual FK rejection or pre-commit seam must be exact');
    }
    return { client, stats, auditReached, releaseAudit, healthy };
  }
  async function noCommittedFailure(current: Fixture, firstCredit: boolean) {
    check(await observer.user.count({ where: { id: missingActor } }) === 0, 'Injected actor must not exist');
    const before = await snapshot(), seam = instrument(writer, { failAudit: true });
    const outcome = await settle(service(seam.client).updateBackstageSettlementConversionStatus(
      actor, current.conversion, { status: 'credited', adminNote: '  owned audit attempt  ' },
    ));
    seam.healthy(firstCredit, true);
    check(!outcome.ok && outcome.error === seam.stats.sqlError
      && outcome.error instanceof Prisma.PrismaClientKnownRequestError && outcome.error.code === 'P2003',
    'The actual SQL foreign-key error must propagate unchanged');
    check(JSON.stringify(await snapshot()) === JSON.stringify(before),
      'Audit SQL rejection must roll back every preceding write including JSON/xmin changes');
  }
  async function committed(current: Fixture, before: unknown, result: ConversionResult, replay: boolean) {
    check('idempotentReplay' in result && 'walletLedger' in result && result.ok
      && result.idempotentReplay === replay && result.conversion.id === current.conversion
      && result.conversion.status === 'credited' && result.walletLedger !== null,
    'Actual public result shape, current conversion and replay value required');
    check(JSON.stringify(result.policy) === JSON.stringify(POLICY), 'Original policy must be unchanged');
    const conversion = await observer.settlementLuminaConversionRequest.findUnique({ where: { id: current.conversion } });
    const wallets = await observer.walletAccount.findMany({ where: { userId: current.requester } });
    const ledgers = await observer.walletLedger.findMany({ where: { referenceId: current.conversion } });
    const audits = await observer.auditEvent.findMany({ where: { targetId: current.conversion } });
    check(conversion && wallets.length === 1 && ledgers.length === 1 && audits.length === 1,
      'One committed conversion, wallet, ledger and audit required');
    const wallet = wallets[0], ledger = ledgers[0], audit = audits[0];
    check(wallet.currencyCode === 'LUMINA' && wallet.cachedBalance.equals(100)
      && ledger.walletAccountId === wallet.id && ledger.direction === 'credit' && ledger.amount.equals(100)
      && ledger.ledgerType === 'settlement_lumina_conversion' && ledger.referenceType === 'settlement_lumina_conversion_request'
      && ledger.idempotencyKey === 'settlement-lumina-conversion:' + current.conversion
      && conversion.walletLedgerId === ledger.id && result.walletLedger.id === ledger.id,
    'Original one-ledger amount, relation and balance effect must be preserved');
    if (current.wallet) check(wallet.id === current.wallet && ledger.id === current.ledger, 'Replay must reuse exact seeded wallet and ledger');
    check(audit.actorUserId === actor.id && audit.actorType === 'admin'
      && audit.action === 'settlement_lumina_conversion.status.update'
      && audit.targetType === 'settlement_lumina_conversion_request' && audit.targetId === conversion.id,
    'Original audit actor/action/target required');
    expect(audit.beforeData).toEqual(json(before));
    expect(audit.afterData).toEqual(json(conversion));
    expect(audit.metadata).toEqual({ settlementKey: conversion.settlementKey, settlementType: conversion.settlementType,
      period: conversion.period, status: conversion.status, walletCredited: true,
      walletLedgerId: conversion.walletLedgerId, idempotentReplay: replay });
    check(conversion.adminNote === 'owned audit attempt' && conversion.processedByUserId === actor.id,
      'Original normalization and processing actor required');
    remember('wallet_accounts', wallet.id); remember('wallet_ledger', ledger.id); remember('audit_events', audit.id);
  }

  beforeAll(async () => {
    const report = normalize(process.env.RELEASE_QA_GUARD_REPORT ?? '');
    const match = /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-settlement-credit-audit\/owned-([a-f0-9]{12})\/test-guards\.json$/.exec(report);
    const expected = match ? 'postgresql://lumina_qa@127.0.0.1:55432/lumina_settlement_credit_audit_qa_' + match[1] : null;
    const url = process.env.STORY_TEST_DATABASE_URL, root = process.env.SETTLEMENT_CREDIT_AUDIT_SOURCE_ROOT ?? '';
    check(expected && url === expected && process.env.DATABASE_URL === url && process.env.NODE_ENV === 'test'
      && process.env.SETTLEMENT_CREDIT_AUDIT_BASE_COMMIT === COMMIT
      && process.env.SETTLEMENT_CREDIT_AUDIT_MAX_DB_BYTES === String(MAX_BYTES)
      && /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-settlement-credit-audit\/recipe-[a-f0-9]{12}\/source$/.test(normalize(root))
      && normalize(realpathSync(root)) === normalize(root)
      && normalize(realpathSync(dirname(report))) === normalize(dirname(report))
      && normalize(realpathSync(__filename)) === normalize(resolve(root, 'server/src/admin/admin-settlement-credit-audit-20261016.postgres.spec.ts'))
      && sha(readFileSync(__filename)) === process.env.SETTLEMENT_CREDIT_AUDIT_SPEC_SHA
      && sha(readFileSync(resolve(__dirname, 'admin.service.ts'))) === SERVICE_SHA,
    'Exact frozen source and fresh owned loopback database required');
    check(Prisma.dmmf.datamodel.models.length === 174, 'Pinned SDK174 required');
    const write = new URL(url!); write.searchParams.set('connection_limit', '1'); write.searchParams.set('pool_timeout', '15');
    const read = new URL(write.toString()); read.searchParams.set('options', '-c default_transaction_read_only=on');
    setup = new PrismaClient({ datasources: { db: { url: write.toString() } } });
    observer = new PrismaClient({ datasources: { db: { url: read.toString() } } });
    writer = new PrismaClient({ datasources: { db: { url: write.toString() } } });
    for (const db of [setup, observer, writer]) await db.$connect();
    const [identity] = await observer.$queryRaw<Array<{ database: string; schema: string; port: string }>>`
      SELECT current_database() AS database, current_schema() AS schema, current_setting('port') AS port`;
    const [migrations] = await observer.$queryRaw<Array<{ total: number; applied: number }>>`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied
      FROM "_prisma_migrations"`;
    check(identity.database === expected.split('/').at(-1) && identity.schema === 'public' && identity.port === '55432'
      && migrations.total === 103 && migrations.applied === 103, 'Owned schema103 identity required');
    check(await observer.user.count() === 0 && await observer.artistOperator.count() === 0
      && await observer.fanLetter.count() === 0 && await observer.settlementLuminaConversionRequest.count() === 0
      && await observer.walletAccount.count() === 0 && await observer.walletLedger.count() === 0
      && await observer.auditEvent.count() === 0, 'Fresh private and financial tables required');
    check(await observer.artist.count() === 1 && await observer.artist.count({ where: {
      slug: 'oh-hyerin', displayName: String.fromCodePoint(0xc624, 0xd61c, 0xb9b0), status: 'active',
      sortOrder: 50, launchedAt: new Date('2026-04-27T00:00:00.000Z'),
    } }) === 1, 'Only immutable migration public Artist seed may pre-exist');
    await bounds(); initial = await snapshot();
    actor = { id: randomUUID(), adminRole: 'accounting_admin' }; missingActor = randomUUID();
    await setup.user.create({ data: { id: actor.id, status: 'active' } }); remember('users', actor.id);
    check(await observer.user.count({ where: { id: missingActor } }) === 0, 'Synthetic missing audit actor required');
  });
  beforeEach(async () => {
    if (!initial) return;
    caseOwned = {}; caseStart = await snapshot();
  });
  afterEach(async () => {
    if (!initial || !caseStart) return;
    check(JSON.stringify(await snapshot(caseOwned)) === JSON.stringify(caseStart),
      'All earlier fixture and original JSON/xmin rows must remain unchanged');
    check(JSON.stringify(await snapshot(owned)) === JSON.stringify(initial), 'Every initial public table row must be preserved');
    await bounds(); caseStart = undefined;
  });
  afterAll(async () => {
    for (const db of [writer, observer, setup]) if (db) await db.$disconnect();
    // Retain all additive fixtures and cluster files; parent wrapper owns normal PG stop.
  });

  it('SETTLEMENT.CREDIT.AUDIT.NATIVE.01 first credit FK audit failure rolls back and later commit stays invisible before finish', async () => {
    const current = await fixture('first');
    await noCommittedFailure(current, true);
    const before = await observer.settlementLuminaConversionRequest.findUnique({ where: { id: current.conversion } });
    check(before, 'Actual original conversion required');
    const state = await snapshot(), seam = instrument(writer, { holdAfterAudit: true });
    let settled = false;
    const task = settle(service(seam.client).updateBackstageSettlementConversionStatus(
      actor, current.conversion, { status: 'credited', adminNote: '  owned audit attempt  ' },
    )).then(value => { settled = true; return value; });
    try {
      await bounded(seam.auditReached.promise);
      check(!settled && seam.stats.txAudits === 1 && seam.stats.barriers === 1, 'Actual audit INSERT must be reached before callback return');
      check(JSON.stringify(await snapshot()) === JSON.stringify(state),
        'Read-only observer must see no uncommitted wallet, ledger, audit or conversion changes');
      seam.releaseAudit.open(); const outcome = await task;
      seam.healthy(true, false); check(outcome.ok, 'Explicit later valid public call must commit');
      await committed(current, before, outcome.value, false);
    } finally { seam.releaseAudit.open(); await task; }
  });

  it('SETTLEMENT.CREDIT.AUDIT.NATIVE.02 linked ledger replay audit failure rolls back processing fields then success audits without credit', async () => {
    const current = await fixture('linked');
    await noCommittedFailure(current, false);
    const before = await observer.settlementLuminaConversionRequest.findUnique({ where: { id: current.conversion } });
    check(before, 'Actual linked original conversion required');
    const immutable = await snapshot({ settlement_lumina_conversion_requests: [current.conversion] });
    const seam = instrument(writer);
    const outcome = await settle(service(seam.client).updateBackstageSettlementConversionStatus(
      actor, current.conversion, { status: 'credited', adminNote: '  owned audit attempt  ' },
    ));
    seam.healthy(false, false); check(outcome.ok, 'Explicit valid linked replay must commit its audit');
    await committed(current, before, outcome.value, true);
    check(JSON.stringify(await snapshot({ settlement_lumina_conversion_requests: [current.conversion],
      audit_events: caseOwned.audit_events ?? [] })) === JSON.stringify(immutable),
    'Linked replay must not rewrite wallet or ledger rows');
  });

  it('SETTLEMENT.CREDIT.AUDIT.NATIVE.03 idempotency ledger relink audit failure rolls back link then success preserves one ledger', async () => {
    const current = await fixture('relink');
    await noCommittedFailure(current, false);
    const before = await observer.settlementLuminaConversionRequest.findUnique({ where: { id: current.conversion } });
    check(before && before.walletLedgerId === null, 'Actual unlinked existing-ledger conversion required');
    const walletsBefore = await snapshot({ settlement_lumina_conversion_requests: [current.conversion] });
    const seam = instrument(writer);
    const outcome = await settle(service(seam.client).updateBackstageSettlementConversionStatus(
      actor, current.conversion, { status: 'credited', adminNote: '  owned audit attempt  ' },
    ));
    seam.healthy(false, false); check(outcome.ok, 'Explicit valid relink must commit its audit');
    await committed(current, before, outcome.value, true);
    check(JSON.stringify(await snapshot({ settlement_lumina_conversion_requests: [current.conversion],
      audit_events: caseOwned.audit_events ?? [] })) === JSON.stringify(walletsBefore),
    'Relink must not rewrite the original seeded wallet or ledger JSON/xmin');
  });
});
