// AUTHOR UNRUN. Three new current-only cases; parent owns first serial execution.
// Actual AdminService/SDK SQL. Only fault seam: replace the audit actor FK after
// validating original arguments. The precommit hook observes, never supplies results.
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
const BASE = '1fc183f2f1e42510951fa6655ea52799d123ceba';
const SERVICE_SHA = '06443d32f8a1c400ce91c401a31ac075483fcc28c3e326a38a04ba3a4d8f52a5';
const SPEC = 'server/src/admin/admin-community-moderation-audit-20261016.postgres.spec.ts';
const MAX_BYTES = 50_000_000;
const native = process.env.RUN_COMMUNITY_MODERATION_AUDIT_NATIVE === '1' ? describe : describe.skip;
const canonical = (value: string) => resolve(value).replace(/\\/g, '/').toLowerCase();
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const INCLUDE = {
  author: { select: { id: true, email: true, status: true,
    profile: { select: { displayName: true, avatarAssetId: true } } } },
  artist: { select: { id: true, slug: true, displayName: true, status: true } },
};
const INPUT = { reason: 'synthetic.moderation.reason', note: 'synthetic moderation note' };
const AUDIT_METADATA = { reason: INPUT.reason, notePresent: true, rawBodyStored: false, rawEmailStored: false,
  rawModerationNoteStored: false, tokenCookiePasswordStored: false, dbUrlStored: false };
type Action = 'hide' | 'restore';
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
const nullableString = (value: unknown) => typeof value === 'string' ? value : null;
function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const scalar: unknown = typeof value === 'string' ? value : JSON.parse(JSON.stringify(value));
  if (typeof scalar !== 'string') return null;
  const date = new Date(scalar);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function auditSnapshot(value: unknown) {
  const row = object(value), metadata = object(row.metadata), moderation = object(metadata.moderation);
  const author = object(row.author);
  return {
    id: row.id, status: row.status, visibility: row.visibility, postType: row.postType,
    authorUserId: row.authorUserId, artistId: row.artistId, reportCount: row.reportCount,
    publishedAt: iso(row.publishedAt), deletedAt: iso(row.deletedAt),
    bodyPresent: typeof row.body === 'string' && row.body.length > 0,
    bodyLength: typeof row.body === 'string' ? row.body.length : 0,
    author: { id: author.id, status: author.status, emailMasked: null }, artist: null,
    moderation: {
      status: nullableString(moderation.status), reason: nullableString(moderation.reason),
      notePresent: typeof moderation.note === 'string' && moderation.note.length > 0,
      hiddenByUserId: nullableString(moderation.hiddenByUserId),
      restoredByUserId: nullableString(moderation.restoredByUserId),
      hiddenAt: nullableString(moderation.hiddenAt), restoredAt: nullableString(moderation.restoredAt),
    },
    auditRawBodyStored: false, auditRawEmailStored: false, auditRawModerationNoteStored: false,
    auditTokenCookiePasswordStored: false, auditDbUrlStored: false,
  };
}
async function settle(promise: Promise<unknown>): Promise<Outcome> {
  try { return { ok: true, value: await promise }; }
  catch (error: unknown) { return { ok: false, error }; }
}

native('community moderation audit atomicity postgres', () => {
  let setup: PrismaClient, observer: PrismaClient, clientA: PrismaClient, clientB: PrismaClient;
  let actor: string, missingActor: string, hidePost: string, restorePost: string, normalPost: string;
  let original: TableState[] | null = null, observationFile: string;
  const owned = new Map<string, string[]>(), forbidden: string[] = [];
  const observations: Record<string, unknown> = {
    contract: 'community-moderation-audit-atomicity-native-observation-v1', phase: 'not_started',
    case01Reached: false, case02Reached: false, case03Reached: false,
    preservationChecked: false, clientsDisconnected: false, actualAuthGuardsExercised: false,
    actorFkSubstitutionIsTestSeam: true, precommitReadIsInstrumentation: true,
    rawRowsOrBusinessIdentifiersSaved: false, stalePrelookupOrOtherWriterCoverageClaimed: false,
  };
  function save() {
    if (observationFile) writeFileSync(observationFile, JSON.stringify(observations, null, 2) + '\n');
  }
  function track(table: string, id: string) {
    check(['users', 'community_posts', 'audit_events'].includes(table) && /^[0-9a-f-]{36}$/.test(id),
      'Exact retained synthetic row required');
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
      check(rows.length === 1 && /^\d+$/.test(rows[0].rows) && /^[a-f0-9]{32}$/.test(rows[0].digest),
        'Actual all-table JSON/xmin checksum required');
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
  async function stored(id: string): Promise<RowState[]> {
    return observer.$queryRaw<RowState[]>`
      SELECT to_jsonb(p)::text AS json, p.xmin::text AS xmin FROM community_posts p WHERE p.id = ${id}::uuid`;
  }

  function observed(client: PrismaClient, postId: string, action: Action, rejectActor = false,
    afterAudit?: (tx: Prisma.TransactionClient, auditId: string) => Promise<void>) {
    const context = new AsyncLocalStorage<Prisma.TransactionClient>(), faults: string[] = [];
    let beforeValue: unknown, updatedValue: unknown, auditId: string | null = null, auditError: unknown = null;
    const stats = { attempts: 0, preflightReads: 0, transactions: 0, propertiesQueries: 0, updates: 0,
      updateResolved: 0, audits: 0, auditResolved: 0, auditErrors: 0, commits: 0, rejectedTransactions: 0,
      settled: 0, active: 0, pid: 0, precommitObservation: 0 };
    function admit(value: unknown, label: string): void {
      stats.attempts++;
      if (!value) { faults.push(label); throw new Error('Native admission: ' + label); }
    }
    function denied(label: string): never { admit(false, label); throw new Error('Unreachable dependency'); }
    const rootPosts = new Proxy(client.communityPost, { get(delegate, key) {
      if (key !== 'findUnique') return denied('Only original outer lookup may use root post delegate');
      return async (args: Prisma.CommunityPostFindUniqueArgs, ...extra: unknown[]) => {
        stats.preflightReads++;
        admit(!context.getStore() && stats.preflightReads === 1 && same(extra, [])
          && same(args, { where: { id: postId }, include: INCLUDE }), 'Exact original outer lookup required');
        const result: unknown = await delegate.findUnique(args);
        admit(record(result) && result.id === postId && result.artistId === null, 'Actual owned SQL post required');
        beforeValue = result; return result;
      };
    } });
    const db = new Proxy(client, { get(actual, key) {
      if (key === 'communityPost') return rootPosts;
      if (key !== '$transaction') return denied('No root audit/config/provider or other service dependency admitted');
      return async (callback: unknown, options: unknown, ...extra: unknown[]) => {
        stats.transactions++;
        admit(!context.getStore() && stats.preflightReads === 1 && stats.transactions === 1
          && typeof callback === 'function' && same(extra, [])
          && same(options, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }),
        'One exact RC transaction after original outer lookup required');
        try {
          const result = await actual.$transaction(async tx => {
            stats.active++;
            try {
              stats.propertiesQueries++;
              const rows = await tx.$queryRaw<Array<{ pid: number; isolation: string; readonly: boolean }>>`
                SELECT pg_backend_pid() AS pid, current_setting('transaction_isolation') AS isolation,
                  current_setting('transaction_read_only') = 'on' AS readonly`;
              admit(rows.length === 1 && Number.isSafeInteger(rows[0].pid) && rows[0].pid > 0
                && rows[0].isolation === 'read committed' && !rows[0].readonly,
              'Actual writable RC backend required; properties query is instrumentation');
              stats.pid = rows[0].pid;
              const posts = new Proxy(tx.communityPost, { get(delegate, method) {
                if (method !== 'update') return denied('Only production post UPDATE admitted');
                return async (args: Prisma.CommunityPostUpdateArgs, ...extras: unknown[]) => {
                  stats.updates++;
                  const data = object(args.data), before = object(beforeValue), metadata = object(before.metadata);
                  const nextMetadata = object(data.metadata), nextModeration = object(nextMetadata.moderation);
                  const timeKey = action === 'hide' ? 'hiddenAt' : 'restoredAt';
                  const time = nextModeration[timeKey];
                  admit(typeof time === 'string' && iso(time) === time, 'Original generated moderation ISO timestamp required');
                  const expectedModeration = { ...object(metadata.moderation),
                    status: action === 'hide' ? 'hidden' : 'restored', reason: INPUT.reason, note: INPUT.note,
                    [action === 'hide' ? 'hiddenByUserId' : 'restoredByUserId']: actor, [timeKey]: time };
                  const expected = { status: action === 'hide' ? 'hidden' : 'published', updatedAt: data.updatedAt,
                    metadata: { ...metadata, moderation: expectedModeration }, ...(action === 'restore' ? { deletedAt: null } : {}) };
                  admit(context.getStore() === tx && stats.updates === 1 && same(extras, [])
                    && same(Object.keys(args).sort(), ['data', 'include', 'where'])
                    && same(args.where, { id: postId }) && same(args.include, INCLUDE)
                    && Object.prototype.toString.call(data.updatedAt) === '[object Date]' && iso(data.updatedAt) !== null
                    && same(data, expected), 'Exact original UPDATE fields/include and metadata must be forwarded unchanged');
                  const result: unknown = await delegate.update(args);
                  admit(record(result) && result.id === postId && result.status === expected.status,
                    'Actual unchanged SDK post result required');
                  updatedValue = result; stats.updateResolved++; return result;
                };
              } });
              const audits = new Proxy(tx.auditEvent, { get(delegate, method) {
                if (method !== 'create') return denied('Only actual transaction audit INSERT admitted');
                return async (args: Prisma.AuditEventCreateArgs, ...extras: unknown[]) => {
                  stats.audits++;
                  const data = object(args.data);
                  admit(context.getStore() === tx && stats.active === 1 && stats.commits === 0
                    && stats.updateResolved === 1 && stats.audits === 1 && same(extras, [])
                    && same(Object.keys(args), ['data'])
                    && same(Object.keys(data).sort(), ['actorType', 'actorUserId', 'action', 'afterData',
                      'beforeData', 'metadata', 'targetId', 'targetType'].sort())
                    && data.actorUserId === actor && data.actorType === 'admin'
                    && data.action === 'community_post.' + action && data.targetType === 'community_post'
                    && data.targetId === postId && same(data.beforeData, auditSnapshot(beforeValue))
                    && same(data.afterData, auditSnapshot(updatedValue)) && same(data.metadata, AUDIT_METADATA),
                  'Exact original eight audit fields/privacy projections must reach the same open transaction');
                  const forwarded: Prisma.AuditEventCreateArgs = rejectActor ? {
                    ...args, data: { ...(args.data as Prisma.AuditEventUncheckedCreateInput), actorUserId: missingActor },
                  } : args;
                  const result = await delegate.create(forwarded).catch((error: unknown) => {
                    stats.auditErrors++; auditError = error; throw error;
                  });
                  stats.auditResolved++; auditId = result.id;
                  admit(result.actorUserId === actor && typeof result.id === 'string', 'Actual successful audit row required');
                  if (afterAudit) { await afterAudit(tx, result.id); stats.precommitObservation++; }
                  return result;
                };
              } });
              const observedTx = new Proxy(tx, { get(_unused, method) {
                if (method === 'communityPost') return posts;
                if (method === 'auditEvent') return audits;
                return denied('Unadmitted transaction member');
              } });
              return await context.run(tx, () =>
                (callback as (value: Prisma.TransactionClient) => Promise<unknown>)(observedTx));
            } finally { stats.active--; }
          }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
          stats.commits++;
          if (auditId) track('audit_events', auditId);
          return result;
        } catch (error: unknown) { stats.rejectedTransactions++; throw error; }
        finally { stats.settled++; }
      };
    } });
    return { db, counts: () => ({ ...stats }), before: () => beforeValue, updated: () => updatedValue,
      auditError: () => auditError, auditId: () => auditId,
      check() { check(faults.length === 0, 'Fixture admission faults cannot qualify a product rejection'); },
      finish() { check(faults.length === 0 && stats.active === 0 && stats.settled === 1,
        'Every admitted transaction must settle once'); } };
  }
  function invoke(call: ReturnType<typeof observed>, action: Action, id: string) {
    const principal: AuthUser = { id: actor, adminRole: 'super_admin' };
    return action === 'hide' ? service(call.db).hideCommunityPost(principal, id, INPUT)
      : service(call.db).restoreCommunityPost(principal, id, INPUT);
  }

  beforeAll(async () => {
    const report = canonical(process.env.RELEASE_QA_GUARD_REPORT ?? '');
    const match = /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-community-moderation-audit-atomicity\/owned-([a-f0-9]{12})\/test-guards\.json$/.exec(report);
    const expected = match ? 'postgresql://lumina_qa@127.0.0.1:55432/lumina_community_moderation_audit_qa_' + match[1] : '';
    const url = process.env.STORY_TEST_DATABASE_URL ?? '', root = process.env.COMMUNITY_MODERATION_AUDIT_SOURCE_ROOT ?? '';
    check(expected && url === expected && process.env.DATABASE_URL === url && process.env.NODE_ENV === 'test'
      && process.env.COMMUNITY_MODERATION_AUDIT_BASE_COMMIT === BASE
      && process.env.COMMUNITY_MODERATION_AUDIT_MAX_DB_BYTES === String(MAX_BYTES)
      && /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-community-moderation-audit-atomicity\/recipe-[a-f0-9]{12}\/source$/.test(canonical(root))
      && canonical(realpathSync(root)) === canonical(root) && canonical(realpathSync(dirname(report))) === canonical(dirname(report))
      && canonical(realpathSync(__filename)) === canonical(resolve(root, SPEC))
      && sha(readFileSync(__filename)) === process.env.COMMUNITY_MODERATION_AUDIT_SPEC_SHA
      && sha(readFileSync(resolve(root, 'server/src/admin/admin.service.ts'))) === SERVICE_SHA,
    'Exact fresh owned database, capsule and private product pins required');
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
    check(await observer.user.count() === 0 && await observer.communityPost.count() === 0 && await observer.auditEvent.count() === 0
      && await observer.walletAccount.count() === 0 && await observer.walletLedger.count() === 0
      && await observer.fanEngagementPointLedger.count() === 0, 'No existing private post/audit or reward records admitted');
    check(await observer.artist.count() === 1, 'Preserve known schema103 artist seed');
    await bounds(); original = await snapshot();
    actor = track('users', randomUUID()); missingActor = randomUUID();
    hidePost = track('community_posts', randomUUID()); restorePost = track('community_posts', randomUUID());
    normalPost = track('community_posts', randomUUID());
    await setup.user.create({ data: { id: actor, status: 'active' } });
    for (const id of [hidePost, restorePost, normalPost]) {
      const hidden = id === restorePost;
      await setup.communityPost.create({ data: { id, authorUserId: actor, artistId: null,
        body: 'synthetic retained community post', postType: 'user_post', status: hidden ? 'hidden' : 'published',
        visibility: 'public', reportCount: 2, deletedAt: hidden ? new Date('2026-01-01T00:00:00.123Z') : null,
        metadata: { synthetic: true, preserved: { value: 'unchanged' }, moderation: {
          status: hidden ? 'hidden' : 'published', reason: 'synthetic.previous.reason', note: 'synthetic previous note',
          ...(hidden ? { hiddenByUserId: actor, hiddenAt: '2026-01-01T00:00:00.123Z' } : {}),
        } } } });
    }
    check(await observer.user.findUnique({ where: { id: missingActor } }) === null, 'Fault actor must actually be absent');
    check(same(await snapshot(owned), original), 'Additive retained setup preserves all original JSON/xmin');
    observations.phase = 'fixture_ready'; save();
  });
  afterEach(async () => {
    check(forbidden.length === 0, 'No config/provider or unadmitted dependency access');
    if (!original) return;
    check(same(await snapshot(owned), original), 'All original rows and tables retain full JSON/xmin');
    check(await observer.user.count() === 1 && await observer.communityPost.count() === 3
      && await observer.auditEvent.count() === (owned.get('audit_events') ?? []).length, 'Only exact retained committed footprint remains');
    check(await observer.walletAccount.count() === 0 && await observer.walletLedger.count() === 0
      && await observer.fanEngagementPointLedger.count() === 0, 'No wallet or positive-point writes');
    await bounds(); observations.preservationChecked = true; save();
  });
  afterAll(async () => {
    const results = await Promise.allSettled([setup, observer, clientA, clientB].filter(Boolean).map(db => db.$disconnect()));
    observations.clientsDisconnected = results.every(value => value.status === 'fulfilled'); save();
    check(observations.clientsDisconnected, 'All owned clients disconnect normally');
    // No DELETE/drop; only inherited tuple-verified lifecycle may stop its owned PG.
  });

  async function rollbackCase(action: Action, id: string, observation: string) {
    const before = await snapshot(), rowBefore = await stored(id), auditsBefore = await observer.auditEvent.count();
    const call = observed(clientA, id, action, true);
    try {
      observations.phase = action + '_real_audit_fk_failure'; save();
      const outcome = await settle(invoke(call, action, id));
      call.check(); const error = !outcome.ok ? outcome.error : null;
      check(!outcome.ok && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003'
        && error === call.auditError(), 'Actual audit SDK P2003 must propagate unchanged');
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw new Error('Actual audit SDK error required');
      check(error.meta?.modelName === undefined || error.meta.modelName === 'AuditEvent', 'If supplied, failure model must be audit');
      const c = call.counts();
      check(c.preflightReads === 1 && c.transactions === 1 && c.updates === 1 && c.updateResolved === 1
        && c.audits === 1 && c.auditErrors === 1 && c.auditResolved === 0 && c.commits === 0
        && c.rejectedTransactions === 1, 'One real post UPDATE then audit failure without retry');
      check(same(await stored(id), rowBefore) && await observer.auditEvent.count() === auditsBefore
        && same(await snapshot(), before), 'Full prior post JSON/xmin and every table/earlier fixture remain exact with no exclusions');
      observations[observation] = true; observations[action + 'Rollback'] = { counts: c, actualKnownP2003: true,
        sameAuditErrorPropagated: true, fullPostAndAllTableJsonXminPreserved: true, additionalAudits: 0 };
      observations.phase = action + '_rollback_complete'; save();
    } finally { call.finish(); save(); }
  }

  it('COMMUNITY.MODERATION.AUDIT.NATIVE.01 hide audit FK rejection preserves full post and all rows', async () => {
    await rollbackCase('hide', hidePost, 'case01Reached');
  });
  it('COMMUNITY.MODERATION.AUDIT.NATIVE.02 restore audit FK rejection preserves full post and all rows', async () => {
    await rollbackCase('restore', restorePost, 'case02Reached');
  });
  it('COMMUNITY.MODERATION.AUDIT.NATIVE.03 normal hide and restore each commit with their own audit', async () => {
    const versions: string[] = [], results: Record<string, unknown>[] = [];
    for (const action of ['hide', 'restore'] as const) {
      const before = await snapshot(), rowBefore = await stored(normalPost), auditsBefore = await observer.auditEvent.count();
      const beforeExceptPost = await snapshot(new Map([['community_posts', [normalPost]]]));
      let checks = 0;
      let call: ReturnType<typeof observed>;
      call = observed(action === 'hide' ? clientA : clientB, normalPost, action, false, async (tx, auditId) => {
        const rows = await tx.$queryRaw<Array<{ pid: number; post_xmin: string; audit_xmin: string }>>`
          SELECT pg_backend_pid() AS pid, p.xmin::text AS post_xmin, a.xmin::text AS audit_xmin
          FROM community_posts p JOIN audit_events a ON a.target_id = p.id
          WHERE p.id = ${normalPost}::uuid AND a.id = ${auditId}::uuid`;
        const reader = await observer.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        check(rows.length === 1 && rows[0].pid === call.counts().pid && /^\d+$/.test(rows[0].post_xmin)
          && rows[0].post_xmin === rows[0].audit_xmin && reader.length === 1 && reader[0].pid > 0
          && reader[0].pid !== rows[0].pid, 'Actual same open transaction xmin and distinct read-only observer required');
        check(same(await stored(normalPost), rowBefore)
          && await observer.auditEvent.findUnique({ where: { id: auditId } }) === null
          && same(await snapshot(), before) && call.counts().active === 1 && call.counts().commits === 0,
        'Before commit, separate reader sees complete old post and no new audit; all committed tables unchanged');
        versions.push(rows[0].post_xmin); checks++;
      });
      try {
        observations.phase = 'normal_' + action + '_precommit'; save();
        const outcome = await settle(invoke(call, action, normalPost));
        call.check(); check(outcome.ok, 'Actual normal public moderation method must complete');
        if (!outcome.ok) throw new Error('Normal moderation result required');
        check(same(outcome.value, { ok: true, post: call.updated() }), 'Original complete public response required');
        const c = call.counts(), auditId = call.auditId();
        check(c.preflightReads === 1 && c.transactions === 1 && c.updates === 1 && c.updateResolved === 1
          && c.audits === 1 && c.auditResolved === 1 && c.auditErrors === 0 && c.commits === 1
          && c.rejectedTransactions === 0 && c.precommitObservation === 1 && checks === 1 && typeof auditId === 'string',
        'Exactly one UPDATE, audit INSERT and commit for each actual action, without retry');
        if (typeof auditId !== 'string') throw new Error('Actual committed audit ID required');
        const row = await stored(normalPost), post = await observer.communityPost.findUnique({ where: { id: normalPost }, include: INCLUDE });
        const audit = await observer.auditEvent.findUnique({ where: { id: auditId } });
        check(row.length === 1 && row[0].xmin === versions[versions.length - 1] && !same(row, rowBefore)
          && same(post, call.updated()) && audit !== null && await observer.auditEvent.count() === auditsBefore + 1,
        'Actual committed post and exactly one additional audit required');
        check(audit !== null && audit.actorUserId === actor && audit.actorType === 'admin'
          && audit.action === 'community_post.' + action && audit.targetType === 'community_post' && audit.targetId === normalPost
          && same(audit.beforeData, auditSnapshot(call.before())) && same(audit.afterData, auditSnapshot(call.updated()))
          && same(audit.metadata, AUDIT_METADATA), 'All eight stored audit fields retain exact semantic keys and values');
        check(same(await snapshot(new Map([['community_posts', [normalPost]], ['audit_events', [auditId]]])), beforeExceptPost),
          'Equal populations preserve every other post, earlier audit, user and table JSON/xmin');
        results.push({ action, counts: c, precommitChecks: checks, sameOpenXmin: true, separateReaderSawOldPost: true,
          additionalAudit: 1, exactResponseAndAuditFields: true });
      } finally { call.finish(); save(); }
    }
    check(versions.length === 2 && versions[0] !== versions[1], 'Hide and restore are separate committed transactions');
    check(await observer.auditEvent.count() === 2, 'Only the two successful moderation audits remain');
    observations.case03Reached = true; observations.normalTransitions = results;
    observations.phase = 'all_cases_complete'; save();
  });
});
