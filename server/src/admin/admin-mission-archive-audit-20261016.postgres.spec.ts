// AUTHOR UNRUN. Two new current-only cases; parent alone admits/runs a fresh owned PG.
// Actual full AdminService/SDK SQL. Only the fault case substitutes the actor FK in
// the forwarded audit INSERT; the public method receives the retained valid actor.
import 'reflect-metadata';
import { Prisma, PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AdminService } from './admin.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

jest.setTimeout(120000);
const BASE = 'a4d293eadd2c3cade66dd4026af3f48ba43b6ecc';
const SERVICE_SHA = '3ad32ef2a64cf5240c1407e475aac294b207151c71244dd9744bfc1d94e9d507';
const SPEC = 'server/src/admin/admin-mission-archive-audit-20261016.postgres.spec.ts';
const MAX_BYTES = 50_000_000;
const native = process.env.RUN_MISSION_ARCHIVE_AUDIT_NATIVE === '1' ? describe : describe.skip;
const canonical = (value: string) => resolve(value).replace(/\\/g, '/').toLowerCase();
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const INCLUDE = { artist: { select: { id: true, slug: true, displayName: true, status: true } } };
const POLICY = { cashLike: false, luminaAmount: 0, settlementEligible: false, transferable: false };
type TableState = { relation: string; rows: string; digest: string };
type RowState = { json: string; xmin: string };
type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };
function check(value: unknown, label: string): void { if (!value) throw new Error(label); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!record(value)) throw new Error('Expected synthetic record shape');
  return value;
}
function same(left: unknown, right: unknown): boolean {
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
    : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
  // Date serialization remains the existing JSON contract; object key order is not an oracle.
  const json = (value: unknown) => sorted(JSON.parse(JSON.stringify(value)) as unknown);
  return JSON.stringify(json(left)) === JSON.stringify(json(right));
}
async function settle(promise: Promise<unknown>): Promise<Outcome> {
  try { return { ok: true, value: await promise }; }
  catch (error: unknown) { return { ok: false, error }; }
}

native('mission archive audit atomicity postgres', () => {
  let setup: PrismaClient, observer: PrismaClient, failedClient: PrismaClient, normalClient: PrismaClient;
  let actor: string, missingActor: string, failedMission: string, normalMission: string;
  let original: TableState[] | null = null, observationFile: string;
  const owned = new Map<string, string[]>(), forbidden: string[] = [];
  const observations: Record<string, unknown> = {
    contract: 'mission-archive-audit-atomicity-native-observation-v1', phase: 'not_started',
    case01Reached: false, case02Reached: false, preservationChecked: false,
    clientsDisconnected: false, actualAuthGuardsExercised: false,
    actorForeignKeySubstitutionIsTestSeam: true, rawRowsOrBusinessIdentifiersSaved: false,
  };
  function save() {
    if (observationFile) writeFileSync(observationFile, JSON.stringify(observations, null, 2) + '\n');
  }
  function track(table: string, id: string) {
    check(['users', 'fan_missions', 'audit_events'].includes(table) && /^[0-9a-f-]{36}$/.test(id),
      'Only retained synthetic footprint admitted');
    const ids = owned.get(table) ?? [];
    check(ids.length < 4 && !ids.includes(id), 'Bounded distinct owned identities required');
    ids.push(id); owned.set(table, ids); return id;
  }
  function denyDependency(): never {
    forbidden.push('config-or-unadmitted-dependency');
    throw new Error('Native fixture dependency forbidden');
  }
  const config = new Proxy({}, { get: denyDependency });
  const service = (db: unknown) => new AdminService(db as PrismaService, config as ConfigService);

  async function snapshot(exclusions: Map<string, string[]> = new Map()): Promise<TableState[]> {
    const tables = await observer.$queryRaw<Array<{ relation: string }>>`
      SELECT table_name AS relation FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
    check(tables.length > 0 && tables.length <= 256, 'Bounded actual public-table catalog required');
    const result: TableState[] = [];
    for (const { relation } of tables) {
      check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(relation), 'Catalog identifier outside fixed SQL form');
      const ids = exclusions.get(relation) ?? [];
      check(ids.length <= 4 && ids.every(id => /^[0-9a-f-]{36}$/.test(id)), 'Only exact owned exclusions allowed');
      const where = ids.length ? ` WHERE t.id NOT IN (${ids.map((_, i) => `$${i + 1}::uuid`).join(',')})` : '';
      const values = await observer.$queryRawUnsafe<Array<{ rows: string; digest: string }>>(
        `SELECT count(*)::text AS rows, md5(COALESCE(string_agg(md5(to_jsonb(t)::text || ':' || t.xmin::text), '' ` +
        `ORDER BY to_jsonb(t)::text, t.xmin::text), '')) AS digest FROM "public"."${relation}" t` + where, ...ids);
      check(values.length === 1 && /^\d+$/.test(values[0].rows) && /^[a-f0-9]{32}$/.test(values[0].digest),
        'Actual table JSON/xmin checksum required');
      result.push({ relation, rows: values[0].rows, digest: values[0].digest });
    }
    return result;
  }
  async function bounds() {
    const rows = await observer.$queryRaw<Array<{ bytes: string; readonly: boolean }>>`
      SELECT pg_database_size(current_database())::text AS bytes,
        current_setting('default_transaction_read_only') = 'on'
        AND current_setting('transaction_read_only') = 'on' AS readonly`;
    check(rows.length === 1 && rows[0].readonly && Number(rows[0].bytes) > 0
      && Number(rows[0].bytes) <= MAX_BYTES, 'Read-only observer and bounded owned database required');
  }
  async function stored(id: string): Promise<RowState> {
    const rows = await observer.$queryRaw<RowState[]>`
      SELECT to_jsonb(m)::text AS json, m.xmin::text AS xmin FROM fan_missions m WHERE m.id = ${id}::uuid`;
    check(rows.length === 1 && /^\d+$/.test(rows[0].xmin), 'Actual selected mission JSON/xmin required');
    return rows[0];
  }
  function projection(value: unknown) {
    const row = object(value), reward = object(row.rewardPolicy);
    check(row.artist === null && reward.points === 0, 'Synthetic null artist and zero-point fixture required');
    return {
      id: row.id, slug: row.slug, missionType: row.missionType, status: row.status,
      statusKey: 'fanMission.status.' + String(row.status), surfaces: row.surfaces,
      resetPolicy: row.resetPolicy, action: { type: row.actionType, targetId: row.actionTargetId },
      artist: null, rewardPolicy: { ...reward, points: 0, policy: { ...POLICY } }, copy: row.copy,
      startsAt: row.startsAt, endsAt: row.endsAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
      policy: { ...POLICY },
    };
  }

  function observed(client: PrismaClient, id: string, initialStatus: string, reason: string,
    rejectActor: boolean, afterInsert?: (tx: Prisma.TransactionClient, auditId: string) => Promise<void>) {
    const context = new AsyncLocalStorage<Prisma.TransactionClient>(), faults: string[] = [];
    let beforeValue: unknown, updatedValue: unknown, auditError: unknown = null;
    const stats = { attempts: 0, transactions: 0, instrumentationQueries: 0, locks: 0, lockResolved: 0,
      reads: 0, updates: 0, updateResolved: 0, audits: 0, auditResolved: 0, auditErrors: 0,
      commits: 0, rejectedTransactions: 0, settled: 0, active: 0, pid: 0, precommitObservation: 0 };
    function admit(value: unknown, label: string): void {
      stats.attempts++;
      if (!value) { faults.push(label); throw new Error('Native admission: ' + label); }
    }
    function denied(label: string): never {
      admit(false, label); throw new Error('Unreachable admitted dependency');
    }
    function admittedObject(value: unknown): Record<string, unknown> {
      admit(record(value), 'Actual delegate input/result must be a record'); return object(value);
    }
    const db = new Proxy(client, { get(actual, key) {
      if (key !== '$transaction') return denied('No root delegate or side effect admitted');
      return async (callback: unknown, options: unknown) => {
        stats.transactions++;
        admit(!context.getStore() && stats.transactions === 1 && typeof callback === 'function'
          && same(options, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }),
        'One exact production RC transaction required');
        try {
          const result = await actual.$transaction(async tx => {
            stats.active++;
            try {
              stats.instrumentationQueries++;
              const properties = await tx.$queryRaw<Array<{ pid: number; isolation: string; readonly: boolean }>>`
                SELECT pg_backend_pid() AS pid, current_setting('transaction_isolation') AS isolation,
                  current_setting('transaction_read_only') = 'on' AS readonly`;
              admit(properties.length === 1 && Number.isSafeInteger(properties[0].pid) && properties[0].pid > 0
                && properties[0].isolation === 'read committed' && !properties[0].readonly,
              'Actual writable RC transaction required; properties query is instrumentation');
              stats.pid = properties[0].pid;
              const missions = new Proxy(tx.fanMission, { get(delegate, method) {
                if (method === 'findUnique') return async (args: Prisma.FanMissionFindUniqueArgs) => {
                  stats.reads++;
                  admit(context.getStore() === tx && stats.reads === 1 && stats.lockResolved === 1
                    && same(args, { where: { id }, include: INCLUDE }), 'Exact locked production lookup required');
                  const loaded: unknown = await delegate.findUnique(args);
                  const row = admittedObject(loaded);
                  admit(row.id === id && row.artistId === null && row.status === initialStatus,
                    'Actual current synthetic row must be returned unchanged');
                  beforeValue = loaded; return loaded;
                };
                if (method === 'update') return async (args: Prisma.FanMissionUpdateArgs) => {
                  stats.updates++;
                  const data = admittedObject(args.data);
                  admit(context.getStore() === tx && stats.updates === 1 && stats.reads === 1
                    && same(Object.keys(args).sort(), ['data', 'include', 'where'])
                    && same(args.where, { id }) && same(args.include, INCLUDE)
                    && same(Object.keys(data).sort(), ['status', 'updatedAt'])
                    && data.status === 'archived' && data.updatedAt instanceof Date,
                  'Original update data, archived floor and include required');
                  const saved: unknown = await delegate.update(args);
                  const row = admittedObject(saved);
                  admit(row.id === id && row.status === 'archived', 'Actual update must return its new row');
                  updatedValue = saved; stats.updateResolved++; return saved;
                };
                return denied('Unadmitted mission method');
              } });
              const audits = new Proxy(tx.auditEvent, { get(delegate, method) {
                if (method !== 'create') return denied('Only actual audit INSERT admitted');
                return async (args: Prisma.AuditEventCreateArgs) => {
                  stats.audits++;
                  const data = admittedObject(args.data);
                  admit(context.getStore() === tx && stats.active === 1 && stats.commits === 0
                    && stats.audits === 1 && stats.updateResolved === 1
                    && same(Object.keys(args), ['data'])
                    && same(Object.keys(data).sort(), ['actorType', 'actorUserId', 'action', 'afterData',
                      'beforeData', 'metadata', 'targetId', 'targetType'].sort())
                    && data.actorUserId === actor && data.actorType === 'admin'
                    && data.action === 'fan_mission.archive' && data.targetType === 'fan_mission' && data.targetId === id
                    && same(data.beforeData, projection(beforeValue)) && same(data.afterData, projection(updatedValue))
                    && same(data.metadata, { reason, policy: POLICY }),
                  'All original audit fields must reach the same open transaction after the actual update');
                  // Test-only fault: change exactly the valid synthetic actor FK to a verified absent UUID.
                  const forwarded: Prisma.AuditEventCreateArgs = rejectActor ? {
                    ...args, data: { ...(args.data as Prisma.AuditEventUncheckedCreateInput), actorUserId: missingActor },
                  } : args;
                  const created = await delegate.create(forwarded).catch((error: unknown) => {
                    stats.auditErrors++; auditError = error; throw error;
                  });
                  stats.auditResolved++;
                  admit(typeof created.id === 'string' && created.actorUserId === actor, 'Actual audit row required');
                  track('audit_events', created.id);
                  if (afterInsert) { await afterInsert(tx, created.id); stats.precommitObservation++; }
                  return created;
                };
              } });
              const observedTx = new Proxy(tx, { get(_unused, method) {
                if (method === 'fanMission') return missions;
                if (method === 'auditEvent') return audits;
                if (method === '$queryRaw') return async (strings: TemplateStringsArray, ...values: unknown[]) => {
                  stats.locks++;
                  admit(context.getStore() === tx && stats.locks === 1 && Array.isArray(strings)
                    && strings.join('?').replace(/\s+/g, ' ').trim() === 'SELECT id FROM fan_missions WHERE id=?::uuid FOR UPDATE'
                    && same(values, [id]), 'Exact bound production row lock required');
                  const locked: unknown = await tx.$queryRaw(strings, ...values);
                  admit(Array.isArray(locked) && locked.length === 1 && record(locked[0]) && locked[0].id === id,
                    'Actual SQL lock must return the owned row');
                  stats.lockResolved++; return locked;
                };
                return denied('Unadmitted transaction member');
              } });
              return await context.run(tx, () =>
                (callback as (value: Prisma.TransactionClient) => Promise<unknown>)(observedTx));
            } finally { stats.active--; }
          }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
          stats.commits++; return result;
        } catch (error: unknown) { stats.rejectedTransactions++; throw error; }
        finally { stats.settled++; }
      };
    } });
    return { db, counts: () => ({ ...stats }), before: () => beforeValue, updated: () => updatedValue,
      auditError: () => auditError,
      check() { check(faults.length === 0, 'Admission faults cannot be swallowed by product rejection'); },
      finish() {
        check(faults.length === 0 && stats.active === 0 && stats.settled === 1,
          'All admitted transaction work must finish once');
      } };
  }

  beforeAll(async () => {
    const report = canonical(process.env.RELEASE_QA_GUARD_REPORT ?? '');
    const match = /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-mission-archive-audit-atomicity\/owned-([a-f0-9]{12})\/test-guards\.json$/.exec(report);
    const expected = match ? 'postgresql://lumina_qa@127.0.0.1:55432/lumina_mission_archive_audit_qa_' + match[1] : '';
    const url = process.env.STORY_TEST_DATABASE_URL ?? '', root = process.env.MISSION_ARCHIVE_AUDIT_SOURCE_ROOT ?? '';
    check(expected && url === expected && process.env.DATABASE_URL === url && process.env.NODE_ENV === 'test'
      && process.env.MISSION_ARCHIVE_AUDIT_BASE_COMMIT === BASE
      && process.env.MISSION_ARCHIVE_AUDIT_MAX_DB_BYTES === String(MAX_BYTES)
      && /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-mission-archive-audit-atomicity\/recipe-[a-f0-9]{12}\/source$/.test(canonical(root))
      && canonical(realpathSync(root)) === canonical(root)
      && canonical(realpathSync(dirname(report))) === canonical(dirname(report))
      && canonical(realpathSync(__filename)) === canonical(resolve(root, SPEC))
      && sha(readFileSync(__filename)) === process.env.MISSION_ARCHIVE_AUDIT_SPEC_SHA
      && sha(readFileSync(resolve(root, 'server/src/admin/admin.service.ts'))) === SERVICE_SHA,
    'Exact fresh owned database, immutable capsule and private product pins required');
    observationFile = resolve(dirname(report), 'native-observations.json');
    observations.phase = 'database_admission'; save();
    check(Prisma.dmmf.datamodel.models.length === 174, 'Exact SDK174 required');
    const writable = new URL(url); writable.searchParams.set('connection_limit', '1');
    const readonly = new URL(writable.toString()); readonly.searchParams.set('options', '-c default_transaction_read_only=on');
    setup = new PrismaClient({ datasources: { db: { url: writable.toString() } } });
    observer = new PrismaClient({ datasources: { db: { url: readonly.toString() } } });
    failedClient = new PrismaClient({ datasources: { db: { url: writable.toString() } } });
    normalClient = new PrismaClient({ datasources: { db: { url: writable.toString() } } });
    for (const db of [setup, observer, failedClient, normalClient]) await db.$connect();
    const identities = await observer.$queryRaw<Array<{ database: string; schema: string; port: string }>>`
      SELECT current_database() AS database, current_schema() AS schema, current_setting('port') AS port`;
    const migrations = await observer.$queryRaw<Array<{ total: number; applied: number }>>`
      SELECT count(*)::int AS total, count(*) FILTER
        (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied FROM "_prisma_migrations"`;
    check(identities.length === 1 && identities[0].database === expected.split('/').pop()
      && identities[0].schema === 'public' && identities[0].port === '55432'
      && migrations.length === 1 && migrations[0].total === 103 && migrations[0].applied === 103,
    'Fresh exact schema103 and owned port required');
    check(await observer.user.count() === 0 && await observer.fanMission.count() === 0
      && await observer.auditEvent.count() === 0 && await observer.walletAccount.count() === 0
      && await observer.walletLedger.count() === 0 && await observer.fanEngagementPointLedger.count() === 0,
    'No existing private mission, audit or reward rows admitted');
    check(await observer.artist.count() === 1, 'Preserve the known schema103 artist seed');
    await bounds(); original = await snapshot();
    actor = track('users', randomUUID()); missingActor = randomUUID();
    failedMission = track('fan_missions', randomUUID()); normalMission = track('fan_missions', randomUUID());
    await setup.user.create({ data: { id: actor, status: 'active' } });
    for (const [id, status] of [[failedMission, 'active'], [normalMission, 'archived']]) {
      await setup.fanMission.create({ data: {
        id, artistId: null, slug: 'native-audit-' + id, missionType: 'daily_signal', status,
        surfaces: ['home'], resetPolicy: 'once', actionType: 'mission_participation', actionTargetId: null,
        rewardPolicy: { points: 0, marker: 'retained-synthetic' }, copy: { titleKey: 'native.synthetic.title' },
        startsAt: new Date('2026-01-01T00:00:00.000Z'), endsAt: new Date('2099-01-01T00:00:00.000Z'),
      } });
    }
    check(await observer.user.findUnique({ where: { id: missingActor } }) === null, 'Fault actor is actually absent');
    check(same(await snapshot(owned), original), 'Additive retained setup preserves every original JSON/xmin');
    observations.phase = 'fixture_ready'; save();
  });
  afterEach(async () => {
    check(forbidden.length === 0, 'No config/provider or unadmitted dependency access');
    if (!original) return;
    check(same(await snapshot(owned), original), 'Original tables and earlier rows retain JSON/xmin');
    check(await observer.user.count() === 1 && await observer.fanMission.count() === 2
      && await observer.auditEvent.count() === (owned.get('audit_events') ?? []).length,
    'Only exact additive retained fixtures remain');
    check(await observer.walletAccount.count() === 0 && await observer.walletLedger.count() === 0
      && await observer.fanEngagementPointLedger.count() === 0, 'No wallet or participation point writes');
    await bounds(); observations.preservationChecked = true; save();
  });
  afterAll(async () => {
    const results = await Promise.allSettled([setup, observer, failedClient, normalClient]
      .filter(Boolean).map(db => db.$disconnect()));
    observations.clientsDisconnected = results.every(value => value.status === 'fulfilled'); save();
    check(observations.clientsDisconnected, 'Every owned client disconnects normally');
    // No DELETE/drop. Retained fixtures/cluster artifacts belong to the inherited owned-PG lifecycle.
  });

  it('MISSION.ARCHIVE.AUDIT.NATIVE.01 a real audit FK rejection rolls back the actual mission update', async () => {
    const principal: AuthUser = { id: actor, adminRole: 'super_admin' };
    const before = await snapshot(), rowBefore = await stored(failedMission);
    const call = observed(failedClient, failedMission, 'active', 'synthetic-fk-failure', true);
    try {
      observations.phase = 'real_fk_rejection'; save();
      const outcome = await settle(service(call.db).archiveBackstageFanMission(principal, failedMission,
        { status: 'archived', reason: ' synthetic-fk-failure ' }));
      call.check();
      const error = !outcome.ok ? outcome.error : null;
      const known = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
      check(!outcome.ok && known && error === call.auditError(),
        'Actual unchanged SDK P2003 must propagate from the forwarded audit INSERT');
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw new Error('Known SDK error required');
      const model = error.meta?.modelName;
      check(model === undefined || model === 'AuditEvent', 'If supplied, failure model must be the actual audit');
      const counts = call.counts();
      check(counts.transactions === 1 && counts.locks === 1 && counts.lockResolved === 1
        && counts.reads === 1 && counts.updates === 1 && counts.updateResolved === 1
        && counts.audits === 1 && counts.auditErrors === 1 && counts.auditResolved === 0
        && counts.commits === 0 && counts.rejectedTransactions === 1 && counts.settled === 1,
      'Real update then real failing INSERT must reject exactly one transaction without retry');
      check(same(await stored(failedMission), rowBefore), 'Full selected mission JSON and xmin must roll back');
      check(same(await snapshot(), before), 'Every committed table and earlier fixture must remain byte/checksum exact');
      check(await observer.auditEvent.count() === 0, 'Failed audit creates no committed audit');
      observations.case01Reached = true;
      observations.case01 = { actualKnownP2003: known, sameErrorPropagated: error === call.auditError(),
        modelNameProvided: model !== undefined, counts, fullRowAndXminPreserved: true,
        allTablesWithoutExclusionsPreserved: true, actualAudits: 0 };
      observations.phase = 'case01_complete'; save();
    } finally { call.finish(); save(); }
  });

  it('MISSION.ARCHIVE.AUDIT.NATIVE.02 the actual audit is invisible with the mission until one commit', async () => {
    const principal: AuthUser = { id: actor, adminRole: 'super_admin' };
    const before = await snapshot(), rowBefore = await stored(normalMission);
    const otherBefore = await snapshot(new Map([['fan_missions', [normalMission]]]));
    let precommitChecks = 0;
    let call: ReturnType<typeof observed>;
    call = observed(normalClient, normalMission, 'archived', 'synthetic-normal-floor', false,
      async (tx, auditId) => {
        const inside = await tx.$queryRaw<Array<{ pid: number; xmin: string }>>`
          SELECT pg_backend_pid() AS pid, a.xmin::text AS xmin FROM audit_events a WHERE a.id = ${auditId}::uuid`;
        const insideMission = await tx.$queryRaw<RowState[]>`
          SELECT to_jsonb(m)::text AS json, m.xmin::text AS xmin FROM fan_missions m WHERE m.id = ${normalMission}::uuid`;
        check(inside.length === 1 && inside[0].pid === call.counts().pid && /^\d+$/.test(inside[0].xmin)
          && insideMission.length === 1 && insideMission[0].xmin === inside[0].xmin
          && insideMission[0].xmin !== rowBefore.xmin,
        'Actual audit INSERT and mission version must belong to the same still-open transaction');
        const reader = await observer.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        check(reader.length === 1 && reader[0].pid > 0 && reader[0].pid !== inside[0].pid,
          'Visibility observation uses an actual different backend connection');
        check(same(await stored(normalMission), rowBefore), 'Separate observer must still see the old full row/xmin');
        check(await observer.auditEvent.findUnique({ where: { id: auditId } }) === null,
          'Separate observer cannot see the actual uncommitted audit');
        check(same(await snapshot(), before), 'All committed tables remain exact before callback returns');
        check(call.counts().active === 1 && call.counts().commits === 0, 'Observation precedes actual commit');
        precommitChecks++;
      });
    try {
      observations.phase = 'normal_precommit_observation'; save();
      const outcome = await settle(service(call.db).archiveBackstageFanMission(principal, normalMission,
        { status: 'inactive', reason: ' synthetic-normal-floor ' }));
      call.check(); check(outcome.ok, 'Explicit actual public method must complete normally');
      if (!outcome.ok) throw new Error('Expected normal archive result');
      const counts = call.counts();
      check(precommitChecks === 1 && counts.precommitObservation === 1 && counts.transactions === 1
        && counts.locks === 1 && counts.lockResolved === 1 && counts.reads === 1
        && counts.updates === 1 && counts.updateResolved === 1 && counts.audits === 1
        && counts.auditResolved === 1 && counts.auditErrors === 0 && counts.commits === 1
        && counts.rejectedTransactions === 0 && counts.settled === 1,
      'One actual update, audit INSERT, precommit observation and commit; no retries');
      check(same(outcome.value, { mission: projection(call.updated()), archived: true, deactivated: false, policy: POLICY }),
        'Response and archived floor retain their original exact contract');
      const after = await stored(normalMission), oldJson = object(JSON.parse(rowBefore.json) as unknown);
      const newJson = object(JSON.parse(after.json) as unknown);
      const immutable = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value)
        .filter(([key]) => key !== 'updated_at'));
      check(newJson.status === 'archived' && after.xmin !== rowBefore.xmin && same(immutable(oldJson), immutable(newJson)),
        'Status floor and every non-timestamp field remain exact while the committed version changes');
      const audits = await observer.auditEvent.findMany();
      check(audits.length === 1 && (owned.get('audit_events') ?? []).length === 1, 'Exactly one retained actual audit');
      const audit = audits[0];
      check(audit.actorUserId === actor && audit.actorType === 'admin' && audit.action === 'fan_mission.archive'
        && audit.targetType === 'fan_mission' && audit.targetId === normalMission
        && same(audit.beforeData, projection(call.before())) && same(audit.afterData, projection(call.updated()))
        && same(audit.metadata, { reason: 'synthetic-normal-floor', policy: POLICY }),
      'Actual stored audit retains all eight original fields and normalized reason');
      const exclusions = new Map([['fan_missions', [normalMission]], ['audit_events', owned.get('audit_events') ?? []]]);
      check(same(await snapshot(exclusions), otherBefore),
        'Every unrelated row including the earlier failed-case mission preserves exact JSON/xmin');
      observations.case02Reached = true;
      observations.case02 = { counts, precommitChecks, observerSawOldMissionAndNoAudit: true,
        sameTransactionVersionObserved: true, archivedFloorPreserved: true, actualAudits: 1 };
      observations.phase = 'case02_complete'; save();
    } finally { call.finish(); save(); }
  });
});
