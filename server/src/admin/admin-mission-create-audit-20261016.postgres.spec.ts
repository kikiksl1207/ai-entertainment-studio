// AUTHOR UNRUN. Three new current-only cases; parent alone owns first serial PG execution.
// Real AdminService/SDK SQL. Fault seam changes only audit actor FK; schedule seam
// delays return of an actual null preflight until a second actual public create commits.
import 'reflect-metadata';
import { Prisma, PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AdminService } from './admin.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

jest.setTimeout(120000);
const BASE = 'e88dc0d83734c448bf17c90d1ad750bea7bc9961';
const SERVICE_SHA = 'df17a35615d8b251e56a245eee58fd0aabf580e878558d3afa21600c436d387b';
const SPEC = 'server/src/admin/admin-mission-create-audit-20261016.postgres.spec.ts';
const MAX_BYTES = 50_000_000;
const native = process.env.RUN_MISSION_CREATE_AUDIT_NATIVE === '1' ? describe : describe.skip;
const canonical = (value: string) => resolve(value).replace(/\\/g, '/').toLowerCase();
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const INCLUDE = { artist: { select: { id: true, slug: true, displayName: true, status: true } } };
const POLICY = { cashLike: false, luminaAmount: 0, settlementEligible: false, transferable: false };
const COPY = { titleKey: 'native.synthetic.title', descriptionKey: 'native.synthetic.description',
  ctaKey: 'native.synthetic.cta', statusKey: 'native.synthetic.status' };
const START = '2026-01-01T00:00:00.000Z', END = '2099-01-01T00:00:00.000Z';
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
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort)
    : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
  const json = (value: unknown) => sort(JSON.parse(JSON.stringify(value)) as unknown);
  return JSON.stringify(json(left)) === JSON.stringify(json(right));
}
async function settle(promise: Promise<unknown>): Promise<Outcome> {
  try { return { ok: true, value: await promise }; }
  catch (error: unknown) { return { ok: false, error }; }
}
function input(slug: string) {
  return { slug, missionType: 'daily_signal', status: 'draft', surfaces: ['home'], resetPolicy: 'once',
    actionType: 'mission_participation', rewardPolicy: { points: 0 }, copy: { ...COPY }, startsAt: START, endsAt: END };
}
function expectedData(slug: string) {
  return { artistId: undefined, slug, missionType: 'daily_signal', status: 'draft', surfaces: ['home'],
    resetPolicy: 'once', actionType: 'mission_participation', actionTargetId: undefined,
    rewardPolicy: { points: 0 }, copy: { ...COPY }, startsAt: new Date(START), endsAt: new Date(END) };
}
function projection(value: unknown) {
  const row = object(value);
  return { id: row.id, slug: row.slug, missionType: row.missionType, status: row.status,
    statusKey: 'fanMission.status.' + String(row.status), surfaces: row.surfaces, resetPolicy: row.resetPolicy,
    action: { type: row.actionType, targetId: row.actionTargetId }, artist: null,
    rewardPolicy: { points: 0, policy: { ...POLICY } }, copy: row.copy,
    startsAt: row.startsAt, endsAt: row.endsAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
    policy: { ...POLICY } };
}

native('mission create audit atomicity postgres', () => {
  let setup: PrismaClient, observer: PrismaClient, clientA: PrismaClient, clientB: PrismaClient;
  let actor: string, missingActor: string, faultSlug: string, normalSlug: string, raceSlug: string;
  let original: TableState[] | null = null, observationFile: string;
  const owned = new Map<string, string[]>(), forbidden: string[] = [];
  const observations: Record<string, unknown> = {
    contract: 'mission-create-audit-atomicity-native-observation-v1', phase: 'not_started',
    case01Reached: false, case02Reached: false, case03Reached: false,
    preservationChecked: false, clientsDisconnected: false, actualAuthGuardsExercised: false,
    actorFkSubstitutionIsTestSeam: true, actualNullPreflightGateIsInstrumentation: true,
    rawRowsOrBusinessIdentifiersSaved: false, auditP2002NativeCoverageClaimed: false,
  };
  function save() {
    if (observationFile) writeFileSync(observationFile, JSON.stringify(observations, null, 2) + '\n');
  }
  function track(table: string, id: string) {
    check(['users', 'fan_missions', 'audit_events'].includes(table) && /^[0-9a-f-]{36}$/.test(id), 'Exact retained synthetic row required');
    const ids = owned.get(table) ?? [];
    check(ids.length < 4 && !ids.includes(id), 'Bounded distinct retained rows required');
    ids.push(id); owned.set(table, ids); return id;
  }
  function denyDependency(): never { forbidden.push('unadmitted-dependency'); throw new Error('Native dependency forbidden'); }
  const config = new Proxy({}, { get: denyDependency });
  const service = (db: unknown) => new AdminService(db as PrismaService, config as ConfigService);
  async function snapshot(exclusions: Map<string, string[]> = new Map()): Promise<TableState[]> {
    const tables = await observer.$queryRaw<Array<{ relation: string }>>`
      SELECT table_name AS relation FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
    check(tables.length > 0 && tables.length <= 256, 'Bounded actual public table catalog required');
    const result: TableState[] = [];
    for (const { relation } of tables) {
      check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(relation), 'Catalog identifier outside fixed SQL form');
      const ids = exclusions.get(relation) ?? [];
      check(ids.length <= 4 && ids.every(id => /^[0-9a-f-]{36}$/.test(id)), 'Only exact owned exclusions allowed');
      const where = ids.length ? ` WHERE t.id NOT IN (${ids.map((_, i) => `$${i + 1}::uuid`).join(',')})` : '';
      const rows = await observer.$queryRawUnsafe<Array<{ rows: string; digest: string }>>(
        `SELECT count(*)::text AS rows, md5(COALESCE(string_agg(md5(to_jsonb(t)::text || ':' || t.xmin::text), '' ` +
        `ORDER BY to_jsonb(t)::text, t.xmin::text), '')) AS digest FROM "public"."${relation}" t` + where, ...ids);
      check(rows.length === 1 && /^\d+$/.test(rows[0].rows) && /^[a-f0-9]{32}$/.test(rows[0].digest), 'Actual JSON/xmin checksum required');
      result.push({ relation, rows: rows[0].rows, digest: rows[0].digest });
    }
    return result;
  }
  async function bounds() {
    const rows = await observer.$queryRaw<Array<{ bytes: string; readonly: boolean }>>`
      SELECT pg_database_size(current_database())::text AS bytes,
        current_setting('default_transaction_read_only') = 'on'
        AND current_setting('transaction_read_only') = 'on' AS readonly`;
    check(rows.length === 1 && rows[0].readonly && Number(rows[0].bytes) > 0 && Number(rows[0].bytes) <= MAX_BYTES,
      'Read-only observer and bounded owned database required');
  }
  async function stored(slug: string): Promise<RowState[]> {
    return observer.$queryRaw<RowState[]>`
      SELECT to_jsonb(m)::text AS json, m.xmin::text AS xmin FROM fan_missions m WHERE m.slug = ${slug}`;
  }

  function observed(client: PrismaClient, slug: string, rejectActor = false, hooks: {
    afterNullPreflight?: () => Promise<void>;
    afterAudit?: (tx: Prisma.TransactionClient, missionId: string, auditId: string) => Promise<void>;
  } = {}) {
    const context = new AsyncLocalStorage<Prisma.TransactionClient>(), faults: string[] = [];
    let createdValue: unknown, createdId: string | null = null, auditId: string | null = null;
    let createError: unknown = null, auditError: unknown = null;
    const stats = { attempts: 0, preflightReads: 0, preflightNull: 0, transactions: 0, propertiesQueries: 0,
      creates: 0, createResolved: 0, createErrors: 0, audits: 0, auditResolved: 0, auditErrors: 0,
      commits: 0, rejectedTransactions: 0, settled: 0, active: 0, pid: 0, precommitObservation: 0 };
    function admit(value: unknown, label: string): void {
      stats.attempts++;
      if (!value) { faults.push(label); throw new Error('Native admission: ' + label); }
    }
    function denied(label: string): never { admit(false, label); throw new Error('Unreachable dependency'); }
    function admittedObject(value: unknown) { admit(record(value), 'Actual delegate record required'); return object(value); }
    const rootMissions = new Proxy(client.fanMission, { get(delegate, key) {
      if (key !== 'findUnique') return denied('Only outer slug preflight may use the root mission delegate');
      return async (args: Prisma.FanMissionFindUniqueArgs, ...extra: unknown[]) => {
        stats.preflightReads++;
        admit(!context.getStore() && stats.preflightReads === 1 && same(extra, [])
          && same(args, { where: { slug }, select: { id: true } }), 'Exact original outer slug lookup required');
        const result: unknown = await delegate.findUnique(args);
        admit(result === null, 'Schedule requires a real SQL null preflight, not a substituted result');
        stats.preflightNull++;
        if (hooks.afterNullPreflight) await hooks.afterNullPreflight();
        return result;
      };
    } });
    const db = new Proxy(client, { get(actual, key) {
      if (key === 'fanMission') return rootMissions;
      if (key !== '$transaction') return denied('No root audit, artist, config or other service dependency admitted');
      return async (callback: unknown, options: unknown, ...extra: unknown[]) => {
        stats.transactions++;
        admit(!context.getStore() && stats.preflightNull === 1 && stats.transactions === 1 && typeof callback === 'function'
          && same(extra, []) && same(options, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }),
        'One exact RC transaction after actual null preflight required');
        try {
          const result = await actual.$transaction(async tx => {
            stats.active++;
            try {
              stats.propertiesQueries++;
              const rows = await tx.$queryRaw<Array<{ pid: number; isolation: string; readonly: boolean }>>`
                SELECT pg_backend_pid() AS pid, current_setting('transaction_isolation') AS isolation,
                  current_setting('transaction_read_only') = 'on' AS readonly`;
              admit(rows.length === 1 && rows[0].pid > 0 && Number.isSafeInteger(rows[0].pid)
                && rows[0].isolation === 'read committed' && !rows[0].readonly,
              'Actual writable RC backend required; this properties query is instrumentation');
              stats.pid = rows[0].pid;
              const missions = new Proxy(tx.fanMission, { get(delegate, method) {
                if (method !== 'create') return denied('Only production mission INSERT admitted in this transaction');
                return async (args: Prisma.FanMissionCreateArgs, ...extraArgs: unknown[]) => {
                  stats.creates++;
                  const data = admittedObject(args.data), expected = expectedData(slug);
                  admit(context.getStore() === tx && stats.creates === 1 && same(extraArgs, [])
                    && same(Object.keys(args).sort(), ['data', 'include']) && same(args.include, INCLUDE)
                    && same(Object.keys(data).sort(), Object.keys(expected).sort()) && same(data, expected),
                  'All normalized original create fields and include must be forwarded unchanged');
                  const created: unknown = await delegate.create(args).catch((error: unknown) => {
                    stats.createErrors++; createError = error; throw error;
                  });
                  const row = admittedObject(created);
                  admit(typeof row.id === 'string' && /^[0-9a-f-]{36}$/.test(row.id)
                    && row.slug === slug && row.status === 'draft' && row.artistId === null && row.artist === null
                    && row.actionTargetId === null && same(row.rewardPolicy, { points: 0 }) && same(row.copy, COPY),
                  'Actual SDK mission result with zero rewards required');
                  if (typeof row.id !== 'string') throw new Error('Actual generated mission ID required');
                  createdId = row.id; createdValue = created; stats.createResolved++; return created;
                };
              } });
              const audits = new Proxy(tx.auditEvent, { get(delegate, method) {
                if (method !== 'create') return denied('Only actual transaction audit INSERT admitted');
                return async (args: Prisma.AuditEventCreateArgs, ...extraArgs: unknown[]) => {
                  stats.audits++;
                  const data = admittedObject(args.data);
                  admit(context.getStore() === tx && stats.active === 1 && stats.commits === 0
                    && stats.createResolved === 1 && stats.audits === 1 && same(extraArgs, [])
                    && same(Object.keys(args), ['data'])
                    && same(Object.keys(data).sort(), ['actorType', 'actorUserId', 'action', 'afterData',
                      'beforeData', 'metadata', 'targetId', 'targetType'].sort())
                    && data.actorUserId === actor && data.actorType === 'admin' && data.action === 'fan_mission.create'
                    && data.targetType === 'fan_mission' && data.targetId === createdId
                    && data.beforeData === Prisma.JsonNull && same(data.afterData, projection(createdValue))
                    && same(data.metadata, { policy: POLICY }), 'Original eight audit fields must reach the same open transaction');
                  const forwarded: Prisma.AuditEventCreateArgs = rejectActor ? {
                    ...args, data: { ...(args.data as Prisma.AuditEventUncheckedCreateInput), actorUserId: missingActor },
                  } : args;
                  const created = await delegate.create(forwarded).catch((error: unknown) => {
                    stats.auditErrors++; auditError = error; throw error;
                  });
                  stats.auditResolved++; auditId = created.id;
                  admit(typeof created.id === 'string' && created.actorUserId === actor, 'Actual successful audit row required');
                  if (hooks.afterAudit && createdId) {
                    await hooks.afterAudit(tx, createdId, created.id); stats.precommitObservation++;
                  }
                  return created;
                };
              } });
              const observedTx = new Proxy(tx, { get(_unused, method) {
                if (method === 'fanMission') return missions;
                if (method === 'auditEvent') return audits;
                return denied('Unadmitted transaction member');
              } });
              return await context.run(tx, () =>
                (callback as (value: Prisma.TransactionClient) => Promise<unknown>)(observedTx));
            } finally { stats.active--; }
          }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
          stats.commits++;
          if (createdId) track('fan_missions', createdId);
          if (auditId) track('audit_events', auditId);
          return result;
        } catch (error: unknown) { stats.rejectedTransactions++; throw error; }
        finally { stats.settled++; }
      };
    } });
    return { db, counts: () => ({ ...stats }), created: () => createdValue,
      createError: () => createError, auditError: () => auditError,
      check() { check(faults.length === 0, 'Fixture admission faults cannot qualify a product rejection'); },
      finish() { check(faults.length === 0 && stats.active === 0 && stats.settled === 1,
        'Every admitted transaction must settle once'); } };
  }
  function normalResult(value: unknown, created: unknown) {
    check(same(value, { mission: projection(created), publicReadiness: {
      publicListEndpoint: 'GET /api/v1/fan-engagement/missions?surface=home&scope=today&take=3',
      homeTodayEligible: false, warningKey: 'admin.fanEngagement.mission.notHomeTodayEligible', policy: POLICY,
    }, policy: POLICY }), 'Original create response and draft public-readiness contract required');
  }

  beforeAll(async () => {
    const report = canonical(process.env.RELEASE_QA_GUARD_REPORT ?? '');
    const match = /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-mission-create-audit-atomicity\/owned-([a-f0-9]{12})\/test-guards\.json$/.exec(report);
    const expected = match ? 'postgresql://lumina_qa@127.0.0.1:55432/lumina_mission_create_audit_qa_' + match[1] : '';
    const url = process.env.STORY_TEST_DATABASE_URL ?? '', root = process.env.MISSION_CREATE_AUDIT_SOURCE_ROOT ?? '';
    check(expected && url === expected && process.env.DATABASE_URL === url && process.env.NODE_ENV === 'test'
      && process.env.MISSION_CREATE_AUDIT_BASE_COMMIT === BASE && process.env.MISSION_CREATE_AUDIT_MAX_DB_BYTES === String(MAX_BYTES)
      && /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-mission-create-audit-atomicity\/recipe-[a-f0-9]{12}\/source$/.test(canonical(root))
      && canonical(realpathSync(root)) === canonical(root) && canonical(realpathSync(dirname(report))) === canonical(dirname(report))
      && canonical(realpathSync(__filename)) === canonical(resolve(root, SPEC))
      && sha(readFileSync(__filename)) === process.env.MISSION_CREATE_AUDIT_SPEC_SHA
      && sha(readFileSync(resolve(root, 'server/src/admin/admin.service.ts'))) === SERVICE_SHA,
    'Exact fresh owned database, source capsule and private product pins required');
    observationFile = resolve(dirname(report), 'native-observations.json'); observations.phase = 'database_admission'; save();
    check(Prisma.dmmf.datamodel.models.length === 174, 'Exact SDK174 required');
    const writable = new URL(url); writable.searchParams.set('connection_limit', '1');
    const readonly = new URL(writable.toString()); readonly.searchParams.set('options', '-c default_transaction_read_only=on');
    setup = new PrismaClient({ datasources: { db: { url: writable.toString() } } });
    observer = new PrismaClient({ datasources: { db: { url: readonly.toString() } } });
    clientA = new PrismaClient({ datasources: { db: { url: writable.toString() } } });
    clientB = new PrismaClient({ datasources: { db: { url: writable.toString() } } });
    for (const db of [setup, observer, clientA, clientB]) await db.$connect();
    const identities = await observer.$queryRaw<Array<{ database: string; schema: string; port: string }>>`
      SELECT current_database() AS database, current_schema() AS schema, current_setting('port') AS port`;
    const migrations = await observer.$queryRaw<Array<{ total: number; applied: number }>>`
      SELECT count(*)::int AS total, count(*) FILTER
        (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied FROM "_prisma_migrations"`;
    check(identities.length === 1 && identities[0].database === expected.split('/').pop()
      && identities[0].schema === 'public' && identities[0].port === '55432'
      && migrations.length === 1 && migrations[0].total === 103 && migrations[0].applied === 103,
    'Exact fresh schema103 and owned port required');
    check(await observer.user.count() === 0 && await observer.fanMission.count() === 0 && await observer.auditEvent.count() === 0
      && await observer.walletAccount.count() === 0 && await observer.walletLedger.count() === 0
      && await observer.fanEngagementPointLedger.count() === 0, 'No existing private mission or reward records admitted');
    check(await observer.artist.count() === 1, 'Preserve known schema103 artist seed');
    await bounds(); original = await snapshot();
    actor = track('users', randomUUID()); missingActor = randomUUID();
    faultSlug = 'native-create-' + randomUUID(); normalSlug = 'native-create-' + randomUUID(); raceSlug = 'native-create-' + randomUUID();
    await setup.user.create({ data: { id: actor, status: 'active' } });
    check(await observer.user.findUnique({ where: { id: missingActor } }) === null, 'Fault actor must actually be absent');
    check(same(await snapshot(owned), original), 'Additive retained setup preserves all original JSON/xmin');
    observations.phase = 'fixture_ready'; save();
  });
  afterEach(async () => {
    check(forbidden.length === 0, 'No config/provider or unadmitted dependency access');
    if (!original) return;
    check(same(await snapshot(owned), original), 'All earlier rows and tables retain full JSON/xmin');
    check(await observer.user.count() === 1 && await observer.fanMission.count() === (owned.get('fan_missions') ?? []).length
      && await observer.auditEvent.count() === (owned.get('audit_events') ?? []).length, 'Only exact retained committed rows remain');
    check(await observer.walletAccount.count() === 0 && await observer.walletLedger.count() === 0
      && await observer.fanEngagementPointLedger.count() === 0, 'No wallet or positive-point writes');
    await bounds(); observations.preservationChecked = true; save();
  });
  afterAll(async () => {
    const results = await Promise.allSettled([setup, observer, clientA, clientB].filter(Boolean).map(db => db.$disconnect()));
    observations.clientsDisconnected = results.every(value => value.status === 'fulfilled'); save();
    check(observations.clientsDisconnected, 'All owned clients disconnect normally');
    // No DELETE/drop; the inherited tuple-verified lifecycle alone stops its owned PG.
  });

  it('MISSION.CREATE.AUDIT.NATIVE.01 real audit FK rejection leaves no new mission or audit', async () => {
    const before = await snapshot(), principal: AuthUser = { id: actor, adminRole: 'super_admin' };
    const call = observed(clientA, faultSlug, true);
    try {
      observations.phase = 'real_audit_fk_failure'; save();
      const outcome = await settle(service(call.db).createBackstageFanMission(principal, input(faultSlug)));
      call.check(); const error = !outcome.ok ? outcome.error : null;
      check(!outcome.ok && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003'
        && error === call.auditError(), 'Actual audit SDK P2003 must propagate unchanged, not become duplicate409');
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw new Error('Actual audit SDK error required');
      const model = error.meta?.modelName;
      check(model === undefined || model === 'AuditEvent', 'If provided, actual failure model must be the audit');
      const c = call.counts();
      check(c.preflightReads === 1 && c.preflightNull === 1 && c.transactions === 1 && c.creates === 1
        && c.createResolved === 1 && c.createErrors === 0 && c.audits === 1 && c.auditErrors === 1
        && c.auditResolved === 0 && c.commits === 0 && c.rejectedTransactions === 1, 'One real create then audit failure without retry');
      check((await stored(faultSlug)).length === 0 && await observer.auditEvent.count() === 0,
        'Neither actual new mission nor failing audit is committed');
      check(same(await snapshot(), before), 'All table JSON/xmin including earlier rows remain exact without exclusions');
      observations.case01Reached = true; observations.case01 = { counts: c, actualKnownP2003: true,
        sameAuditErrorPropagated: true, committedMissionAndAuditAbsent: true, fullAllTableJsonXminPreserved: true };
      observations.phase = 'case01_complete'; save();
    } finally { call.finish(); save(); }
  });

  it('MISSION.CREATE.AUDIT.NATIVE.02 actual mission and audit remain invisible until their one commit', async () => {
    const before = await snapshot(), principal: AuthUser = { id: actor, adminRole: 'super_admin' };
    let precommitChecks = 0;
    let call: ReturnType<typeof observed>;
    call = observed(clientA, normalSlug, false, { afterAudit: async (tx, missionId, auditId) => {
      const versions = await tx.$queryRaw<Array<{ pid: number; mission_xmin: string; audit_xmin: string }>>`
        SELECT pg_backend_pid() AS pid, m.xmin::text AS mission_xmin, a.xmin::text AS audit_xmin
        FROM fan_missions m JOIN audit_events a ON a.target_id = m.id
        WHERE m.id = ${missionId}::uuid AND a.id = ${auditId}::uuid`;
      const reader = await observer.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      check(versions.length === 1 && versions[0].pid === call.counts().pid
        && /^\d+$/.test(versions[0].mission_xmin) && versions[0].mission_xmin === versions[0].audit_xmin
        && reader.length === 1 && reader[0].pid > 0 && reader[0].pid !== versions[0].pid,
      'Actual same open INSERT transaction and different read-only backend required');
      check((await stored(normalSlug)).length === 0 && await observer.auditEvent.findUnique({ where: { id: auditId } }) === null,
        'Separate observer cannot see either uncommitted row');
      check(same(await snapshot(), before) && call.counts().active === 1 && call.counts().commits === 0,
        'Committed table view remains exact before the actual callback returns');
      precommitChecks++;
    } });
    try {
      observations.phase = 'normal_precommit_visibility'; save();
      const outcome = await settle(service(call.db).createBackstageFanMission(principal, input(normalSlug)));
      call.check(); check(outcome.ok, 'Actual normal public create must complete');
      if (!outcome.ok) throw new Error('Normal create result required');
      normalResult(outcome.value, call.created()); const c = call.counts();
      check(c.preflightReads === 1 && c.creates === 1 && c.createResolved === 1 && c.audits === 1
        && c.auditResolved === 1 && c.auditErrors === 0 && c.commits === 1 && c.rejectedTransactions === 0
        && c.transactions === 1 && c.precommitObservation === 1 && precommitChecks === 1, 'One exact create/audit/commit, no retry');
      const rows = await stored(normalSlug), created = object(call.created()), audits = await observer.auditEvent.findMany();
      check(rows.length === 1 && /^\d+$/.test(rows[0].xmin) && object(JSON.parse(rows[0].json) as unknown).id === created.id
        && created.status === 'draft' && audits.length === 1, 'Actual committed generated row and one audit required');
      const audit = audits[0];
      check(audit.actorUserId === actor && audit.actorType === 'admin' && audit.action === 'fan_mission.create'
        && audit.targetType === 'fan_mission' && audit.targetId === created.id && audit.beforeData === null
        && same(audit.afterData, projection(created)) && same(audit.metadata, { policy: POLICY }), 'All eight stored audit fields retain original contract');
      check(same(await snapshot(new Map([['fan_missions', [String(created.id)]], ['audit_events', [audit.id]]])), before),
        'Every unrelated table/row including actor preserves exact JSON/xmin');
      observations.case02Reached = true; observations.case02 = { counts: c, precommitChecks,
        sameOpenTransactionVersion: true, separateObserverSawNeitherRow: true, actualMission: 1, actualAudit: 1 };
      observations.phase = 'case02_complete'; save();
    } finally { call.finish(); save(); }
  });

  it('MISSION.CREATE.AUDIT.NATIVE.03 actual competing slug INSERT still makes the preflight loser409', async () => {
    const principal: AuthUser = { id: actor, adminRole: 'super_admin' };
    const before = await snapshot();
    let winner: ReturnType<typeof observed> | null = null, winnerResult: unknown;
    let committedWinner: TableState[] | null = null, winnerRows: RowState[] | null = null;
    const loser = observed(clientA, raceSlug, false, { afterNullPreflight: async () => {
      winner = observed(clientB, raceSlug);
      const result = await settle(service(winner.db).createBackstageFanMission(principal, input(raceSlug)));
      winner.check(); check(result.ok, 'Competing actual public create must commit before loser proceeds');
      if (!result.ok) throw new Error('Actual competing winner required');
      winnerResult = result.value; normalResult(winnerResult, winner.created());
      committedWinner = await snapshot(); winnerRows = await stored(raceSlug);
      check(winner.counts().commits === 1 && winnerRows.length === 1, 'Real committed winner barrier required');
    } });
    try {
      observations.phase = 'actual_preflight_competing_insert'; save();
      const outcome = await settle(service(loser.db).createBackstageFanMission(principal, input(raceSlug)));
      loser.check(); const raw = loser.createError();
      check(!outcome.ok && raw instanceof Prisma.PrismaClientKnownRequestError && raw.code === 'P2002',
        'Actual SDK P2002 from the losing mission INSERT must be observed, not manufactured');
      if (!(raw instanceof Prisma.PrismaClientKnownRequestError)) throw new Error('Actual duplicate SDK error required');
      const target = raw.meta?.target, model = raw.meta?.modelName;
      check(Array.isArray(target) && same(target, ['slug']) && (model === undefined || model === 'FanMission'),
        'Observed actual SDK target must be the existing slug uniqueness');
      const failure = !outcome.ok ? outcome.error : null;
      check(failure instanceof ConflictException && failure.getStatus() === 409, 'Existing duplicate409 mapping required');
      if (!(failure instanceof ConflictException)) throw new Error('Conflict response required');
      check(same(failure.getResponse(), { code: 'FAN_MISSION_SLUG_EXISTS', message: 'Fan mission slug already exists',
        messageKey: 'admin.fanEngagement.mission.slugExists', details: { slug: raceSlug } }), 'Original duplicate response is unchanged');
      const c = loser.counts();
      check(c.preflightNull === 1 && c.transactions === 1 && c.creates === 1 && c.createErrors === 1
        && c.createResolved === 0 && c.audits === 0 && c.commits === 0 && c.rejectedTransactions === 1,
      'One actual duplicate attempt, no loser audit and no create/transaction retry');
      check(committedWinner !== null && winnerRows !== null && same(await snapshot(), committedWinner)
        && same(await stored(raceSlug), winnerRows), 'Losing409 preserves full winner JSON/xmin and every earlier row');
      const winning = winner as ReturnType<typeof observed> | null;
      check(winning !== null, 'Competing service fixture must exist');
      if (!winning) throw new Error('Competing fixture missing');
      winning.check(); const wc = winning.counts(), created = object(winning.created());
      check(wc.preflightNull === 1 && wc.creates === 1 && wc.auditResolved === 1 && wc.commits === 1
        && wc.pid !== c.pid, 'Distinct real service connections and one committed winner required');
      const auditRows = await observer.auditEvent.findMany({ where: { targetId: String(created.id), action: 'fan_mission.create' } });
      check(auditRows.length === 1 && auditRows[0].actorUserId === actor && auditRows[0].beforeData === null
        && same(auditRows[0].afterData, projection(created)) && same(auditRows[0].metadata, { policy: POLICY }),
      'Actual winning audit and payload remain unchanged');
      check(same(await snapshot(new Map([['fan_missions', [String(created.id)]], ['audit_events', [auditRows[0].id]]])), before),
        'Only the actual competing winner/audit are additive; earlier normal case remains exact');
      observations.case03Reached = true; observations.case03 = { loserCounts: c, winnerCounts: wc,
        actualKnownP2002: true, observedTarget: Array.isArray(target) ? target.slice() : null,
        modelNameProvided: model !== undefined, mapped409: true, loserAudits: 0,
        originalNullPreflightThenWinnerCommit: true, winnerAndEarlierRowsJsonXminPreserved: true };
      observations.phase = 'case03_complete'; save();
    } finally { loser.finish(); if (winner) (winner as ReturnType<typeof observed>).finish(); save(); }
  });
});
