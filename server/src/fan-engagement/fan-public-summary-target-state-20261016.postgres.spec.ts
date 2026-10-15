import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { PrismaService } from '../prisma/prisma.service';
import { FanEngagementService } from './fan-engagement.service';

jest.setTimeout(90_000);
const COMMIT = '7d405decdd53414e80d0579bd400271fd3183acf';
const SERVICE_SHA = '46492fd31e8cbd08ae1eebc43ce99aa1064d00f62859312d39d6e08bef9dff33';
const MAX_BYTES = 50_000_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const EQUIPPED = new Date('2026-01-02T03:04:05.000Z');
const EARNED = new Date('2026-01-03T03:04:05.000Z');
const normalize = (value: string) => resolve(value).replace(/\\/g, '/').toLowerCase();
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const native = process.env.RUN_PUBLIC_FAN_SUMMARY_NATIVE === '1' ? describe : describe.skip;
type TableState = { relation: string; rows: string; digest: string };
type Exclusions = Record<string, string[]>;
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T>(promise: Promise<T>): Promise<Outcome<T>> => promise.then(
  value => ({ ok: true as const, value }), error => ({ ok: false as const, error }),
);
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

native('fan public summary target state postgres (actual SQL eligibility)', () => {
  let setup: PrismaClient, observer: PrismaClient, caller: PrismaClient;
  let initial: TableState[] | undefined, caseStart: TableState[] | undefined;
  const owned: Exclusions = { users: [], fan_titles: [], user_fan_titles: [],
    fan_achievements: [], user_fan_achievements: [] };
  let caseOwned: Exclusions = {};
  const targets = new Set<string>();
  function remember(table: string, id: string) {
    check(Object.prototype.hasOwnProperty.call(owned, table) && UUID.test(id), 'Exact additive owned row required');
    if (owned[table].includes(id)) return;
    check(owned[table].length < 16, 'Bounded additive fixture count required');
    owned[table].push(id);
    if (caseStart) (caseOwned[table] ??= []).push(id);
  }
  async function snapshot(exclude: Exclusions = {}): Promise<TableState[]> {
    const tables = await observer.$queryRaw<Array<{ relation: string }>>`
      SELECT table_name AS relation FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
    check(tables.length > 0 && tables.length <= 256, 'Bounded actual public table inventory required');
    const rows: TableState[] = [];
    for (const { relation } of tables) {
      check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(relation), 'Unexpected catalog relation');
      const ids = exclude[relation] ?? [];
      check(ids.length <= 16 && ids.every(id => UUID.test(id)), 'Bounded exact UUID exclusions required');
      const where = ids.length ? ` WHERE t.id NOT IN (${ids.map((_, i) => `$${i + 1}::uuid`).join(',')})` : '';
      const [row] = await observer.$queryRawUnsafe<Array<{ rows: string; digest: string }>>(
        `SELECT count(*)::text AS rows, md5(COALESCE(string_agg(md5(to_jsonb(t)::text || ':' || t.xmin::text), '' ` +
        `ORDER BY to_jsonb(t)::text, t.xmin::text), '')) AS digest FROM "public"."${relation}" t` + where, ...ids);
      check(row && /^\d+$/.test(row.rows) && /^[a-f0-9]{32}$/.test(row.digest), 'Actual table JSON/xmin digest required');
      rows.push({ relation, ...row });
    }
    return rows;
  }
  async function bounds() {
    const [row] = await observer.$queryRaw<Array<{ bytes: string; readonly: boolean }>>`
      SELECT pg_database_size(current_database())::text AS bytes,
        current_setting('default_transaction_read_only') = 'on'
        AND current_setting('transaction_read_only') = 'on' AS readonly`;
    check(row.readonly && Number(row.bytes) > 0 && Number(row.bytes) <= MAX_BYTES,
      'Read-only observer and fresh bounded database required');
  }
  async function noEconomicEffects() {
    check(await observer.fanMissionParticipation.count() === 0 && await observer.fanEngagementPointLedger.count() === 0
      && await observer.walletAccount.count() === 0 && await observer.walletLedger.count() === 0
      && await observer.auditEvent.count() === 0, 'No participation, points, wallet, ledger or audit effects allowed');
  }
  async function user(status: string, deletedAt: Date | null = null) {
    check(['active', 'deleted', 'suspended'].includes(status), 'Fixed synthetic status fixture required');
    const id = randomUUID();
    await setup.user.create({ data: { id, status, deletedAt } });
    remember('users', id); targets.add(id); return id;
  }
  async function catalogs() {
    const titleId = randomUUID(), badgeId = randomUUID();
    const titleCode = 'qa-native-title-' + titleId, badgeCode = 'qa-native-badge-' + badgeId;
    const title = await setup.fanTitle.create({ data: {
      id: titleId, code: titleCode, rarity: 'common', status: 'active', copy: {
        displayNameKey: 'synthetic.title.name', descriptionKey: 'synthetic.title.description',
        labels: { ko: { name: 'Synthetic title' }, en: { name: 'Unselected title locale' } },
      },
    } });
    remember('fan_titles', title.id);
    const badge = await setup.fanAchievement.create({ data: {
      id: badgeId, code: badgeCode, category: 'participation', status: 'active', badgeIconKey: 'synthetic-icon', copy: {
        titleKey: 'synthetic.badge.title', descriptionKey: 'synthetic.badge.description',
        labels: { ko: { name: 'Synthetic badge' }, en: { name: 'Unselected badge locale' } },
      },
    } });
    remember('fan_achievements', badge.id); return { title, badge };
  }
  async function retain(owner: string, source: Awaited<ReturnType<typeof catalogs>>) {
    const title = await setup.userFanTitle.create({ data: {
      id: randomUUID(), userId: owner, titleId: source.title.id, status: 'active', equipped: true, equippedAt: EQUIPPED,
    } });
    remember('user_fan_titles', title.id);
    const badge = await setup.userFanAchievement.create({ data: {
      id: randomUUID(), userId: owner, achievementId: source.badge.id, status: 'earned',
      progressCurrent: 1, progressTarget: 1, earnedAt: EARNED,
    } });
    remember('user_fan_achievements', badge.id); return { title, badge };
  }

  // Counters/argument admission only; every admitted model call forwards to real SQL unchanged.
  function instrument(targetId: string) {
    check(targets.has(targetId), 'Only exact owned or explicitly absent synthetic target is admitted');
    const stats = { userAttempts: 0, titleAttempts: 0, badgeAttempts: 0, actualUserRows: 0, faults: 0 };
    function admit(value: unknown, message: string): asserts value {
      if (!value) { stats.faults++; throw new Error(message); }
    }
    const client = new Proxy(caller, { get(target, field) {
      if (field === 'user') return new Proxy(target.user, { get(model, member) {
        if (member !== 'findUnique') { stats.faults++; throw new Error('Only target unique lookup is admitted'); }
        return async (args: Prisma.UserFindUniqueArgs) => {
          stats.userAttempts++;
          admit(stats.userAttempts === 1 && same(args, {
            where: { id: targetId, status: 'active', deletedAt: null }, select: { id: true },
          }), 'Exact original target plus active/undeleted extended-unique predicate required');
          const value = await model.findUnique(args);
          admit(value === null || value.id === targetId, 'Actual selected target or actual null required');
          stats.actualUserRows += value === null ? 0 : 1; return value;
        };
      } });
      if (field === 'userFanTitle') return new Proxy(target.userFanTitle, { get(model, member) {
        if (member !== 'findFirst') { stats.faults++; throw new Error('Only original public title query is admitted'); }
        return async (args: Prisma.UserFanTitleFindFirstArgs) => {
          stats.titleAttempts++;
          admit(stats.titleAttempts === 1 && stats.userAttempts === 1 && stats.actualUserRows === 1
            && same(args, { where: { userId: targetId, status: 'active', equipped: true, title: { status: 'active' } },
              include: { title: true }, orderBy: [{ equippedAt: 'desc' }, { createdAt: 'desc' }] }),
          'Title query may follow only a real qualified target and must stay target-bound');
          return model.findFirst(args);
        };
      } });
      if (field === 'userFanAchievement') return new Proxy(target.userFanAchievement, { get(model, member) {
        if (member !== 'findMany') { stats.faults++; throw new Error('Only original public badge query is admitted'); }
        return async (args: Prisma.UserFanAchievementFindManyArgs) => {
          stats.badgeAttempts++;
          admit(stats.badgeAttempts === 1 && stats.userAttempts === 1 && stats.actualUserRows === 1
            && same(args, { where: { userId: targetId, status: 'earned', achievement: { status: 'active' } },
              include: { achievement: true }, orderBy: [{ earnedAt: 'desc' }, { createdAt: 'desc' }], take: 6 }),
          'Badge query may follow only a real qualified target and must retain original filters/cap');
          return model.findMany(args);
        };
      } });
      stats.faults++; throw new Error('No other service delegate, raw query, transaction or writer is admitted');
    } });
    return { service: new FanEngagementService(client as unknown as PrismaService), stats };
  }
  function projectionKeys(value: Awaited<ReturnType<FanEngagementService['getPublicSummary']>>, owner: string) {
    check(same(Object.keys(value).sort(), ['locale', 'policy', 'privacy', 'publicBadges', 'publicTitle', 'userId'])
      && value.userId === owner && value.locale === 'ko'
      && same(value.privacy, { participationHistoryPublic: false, exposesPrivateLedger: false })
      && same(value.policy, { serviceTimezone: 'Asia/Seoul', rewardsAreCashLike: false, cashLike: false,
        luminaAmount: 0, pointsTransferable: false, transferable: false, settlementEligible: false,
        luminaConvertible: false, aiDraftsAutoPublish: false }), 'Original public-only envelope, locale and policy required');
  }

  beforeAll(async () => {
    const report = normalize(process.env.RELEASE_QA_GUARD_REPORT ?? '');
    const match = /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-public-fan-summary-target-state\/owned-([a-f0-9]{12})\/test-guards\.json$/.exec(report);
    const expected = match ? 'postgresql://lumina_qa@127.0.0.1:55432/lumina_public_fan_summary_qa_' + match[1] : null;
    const url = process.env.STORY_TEST_DATABASE_URL, root = process.env.PUBLIC_FAN_SUMMARY_SOURCE_ROOT ?? '';
    check(expected && url === expected && process.env.DATABASE_URL === url && process.env.NODE_ENV === 'test'
      && process.env.PUBLIC_FAN_SUMMARY_BASE_COMMIT === COMMIT
      && process.env.PUBLIC_FAN_SUMMARY_MAX_DB_BYTES === String(MAX_BYTES)
      && /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-public-fan-summary-target-state\/recipe-[a-f0-9]{12}\/source$/.test(normalize(root))
      && normalize(realpathSync(root)) === normalize(root)
      && normalize(realpathSync(dirname(report))) === normalize(dirname(report))
      && normalize(realpathSync(__filename)) === normalize(resolve(root, 'server/src/fan-engagement/fan-public-summary-target-state-20261016.postgres.spec.ts'))
      && sha(readFileSync(__filename)) === process.env.PUBLIC_FAN_SUMMARY_SPEC_SHA
      && sha(readFileSync(resolve(__dirname, 'fan-engagement.service.ts'))) === SERVICE_SHA,
    'Exact selected source and fresh owned loopback database required');
    check(Prisma.dmmf.datamodel.models.length === 174, 'Pinned SDK174 required');
    const write = new URL(url!); write.searchParams.set('connection_limit', '1'); write.searchParams.set('pool_timeout', '15');
    const read = new URL(write.toString()); read.searchParams.set('options', '-c default_transaction_read_only=on');
    setup = new PrismaClient({ datasources: { db: { url: write.toString() } } });
    observer = new PrismaClient({ datasources: { db: { url: read.toString() } } });
    caller = new PrismaClient({ datasources: { db: { url: write.toString() } } });
    for (const db of [setup, observer, caller]) await db.$connect();
    const [identity] = await observer.$queryRaw<Array<{ database: string; schema: string; port: string }>>`
      SELECT current_database() AS database, current_schema() AS schema, current_setting('port') AS port`;
    const [migrations] = await observer.$queryRaw<Array<{ total: number; applied: number }>>`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied
      FROM "_prisma_migrations"`;
    check(identity.database === expected.split('/').at(-1) && identity.schema === 'public' && identity.port === '55432'
      && migrations.total === 103 && migrations.applied === 103, 'Owned schema103 identity required');
    check(await observer.user.count() === 0 && await observer.userFanTitle.count() === 0
      && await observer.userFanAchievement.count() === 0, 'Fresh private target/ownership tables required');
    await noEconomicEffects();
    const artists = await observer.artist.findMany({ select: {
      id: true, slug: true, displayName: true, status: true, sortOrder: true, launchedAt: true,
    } });
    check(artists.length === 1 && UUID.test(artists[0].id) && artists[0].slug === 'oh-hyerin'
      && artists[0].displayName === String.fromCodePoint(0xc624, 0xd61c, 0xb9b0) && artists[0].status === 'active'
      && artists[0].sortOrder === 50 && artists[0].launchedAt?.toISOString() === '2026-04-27T00:00:00.000Z',
    'Only immutable migration public Artist seed may pre-exist');
    // Public title/badge catalogs may contain immutable seeds; preserve rather than assuming empty.
    await bounds(); initial = await snapshot();
  });
  beforeEach(async () => { if (initial) { caseOwned = {}; caseStart = await snapshot(); } });
  afterEach(async () => {
    if (!initial || !caseStart) return;
    check(same(await snapshot(caseOwned), caseStart), 'Every earlier fixture and original table JSON/xmin row must remain unchanged');
    check(same(await snapshot(owned), initial), 'All original catalog/private table JSON/xmin rows must remain unchanged');
    await noEconomicEffects(); await bounds(); caseStart = undefined;
  });
  afterAll(async () => {
    for (const db of [caller, observer, setup]) if (db) await db.$disconnect();
    // Retain all fixtures and cluster files; only the parent recipe owns normal PG stop.
  });

  it('FAN.PUBLIC.SUMMARY.NATIVE.01 retained rows on unavailable targets are denied before public projection queries', async () => {
    const source = await catalogs();
    const entries = [
      { id: await user('deleted', new Date('2026-01-04T00:00:00.000Z')), status: 'deleted', deleted: true },
      { id: await user('suspended'), status: 'suspended', deleted: false },
      { id: await user('active', new Date('2026-01-04T00:00:00.000Z')), status: 'active', deleted: true },
    ];
    for (const entry of entries) await retain(entry.id, source);
    const missing = randomUUID(); targets.add(missing);
    check(await observer.user.findUnique({ where: { id: missing } }) === null, 'Missing target must actually be absent');
    for (const entry of entries) {
      const actual = await observer.user.findUnique({ where: { id: entry.id } });
      check(actual !== null && actual.status === entry.status && (actual.deletedAt !== null) === entry.deleted
        && await observer.userFanTitle.count({ where: { userId: entry.id, status: 'active', equipped: true } }) === 1
        && await observer.userFanAchievement.count({ where: { userId: entry.id, status: 'earned' } }) === 1,
      'Actual unavailable target must retain eligible title/badge rows, not a missing fixture');
    }
    const before = await snapshot();
    for (const id of [...entries.map(entry => entry.id), missing]) {
      const seam = instrument(id), result = await settle(seam.service.getPublicSummary(id, {}));
      check(seam.stats.faults === 0 && seam.stats.userAttempts === 1 && seam.stats.actualUserRows === 0
        && seam.stats.titleAttempts === 0 && seam.stats.badgeAttempts === 0,
      'Real SQL target rejection must precede every title/badge query without swallowed fixture faults');
      check(!result.ok && result.error instanceof NotFoundException && result.error.getStatus() === 404,
        'Existing not-found exception must reject unavailable or missing targets');
      const response: unknown = result.error.getResponse();
      check(object(response) && response.code === 'USER_NOT_FOUND' && response.message === 'User not found'
        && response.messageKey === 'fanEngagement.publicSummary.userNotFound'
        && same(response.details, { userId: id }), 'Original bounded service not-found response must remain unchanged');
      check(same(await snapshot(), before), 'Each denied read must preserve every row including retained ownership/xmin');
    }
  });

  it('FAN.PUBLIC.SUMMARY.NATIVE.02 active target keeps only original public projection without any writes', async () => {
    const owner = await user('active'), other = await user('active'), empty = await user('active');
    const ownCatalog = await catalogs(), otherCatalog = await catalogs();
    await retain(owner, ownCatalog); await retain(other, otherCatalog);
    const before = await snapshot(), seam = instrument(owner);
    const result = await seam.service.getPublicSummary(owner, {});
    check(seam.stats.faults === 0 && seam.stats.userAttempts === 1 && seam.stats.actualUserRows === 1
      && seam.stats.titleAttempts === 1 && seam.stats.badgeAttempts === 1,
    'Actual qualified target and exact original target-bound projection queries required');
    projectionKeys(result, owner);
    check(same(result.publicTitle, { code: ownCatalog.title.code, copy: {
      displayNameKey: 'synthetic.title.name', labels: { ko: { name: 'Synthetic title' } },
    }, equippedAt: EQUIPPED }) && same(result.publicBadges, [{ code: ownCatalog.badge.code,
      badgeIconKey: 'synthetic-icon', copy: { titleKey: 'synthetic.badge.title',
        descriptionKey: 'synthetic.badge.description', labels: { ko: { name: 'Synthetic badge' } } }, earnedAt: EARNED }]),
    'Only this active target original public title/badge fields and dates may be returned');
    check(result.publicTitle?.code !== otherCatalog.title.code
      && result.publicBadges.every(badge => badge.code !== otherCatalog.badge.code), 'Other owner retained awards must not substitute');
    check(same(await snapshot(), before), 'Active projection must write no original or fixture row');
    const emptySeam = instrument(empty), none = await emptySeam.service.getPublicSummary(empty, {});
    check(emptySeam.stats.faults === 0 && emptySeam.stats.userAttempts === 1 && emptySeam.stats.actualUserRows === 1
      && emptySeam.stats.titleAttempts === 1 && emptySeam.stats.badgeAttempts === 1,
    'Active empty control must execute original SQL projections, not a scripted shortcut');
    projectionKeys(none, empty);
    check(none.publicTitle === null && same(none.publicBadges, []), 'Active target without awards retains null title and empty badges');
    check(same(await snapshot(), before), 'Active empty projection must preserve every JSON/xmin row without exclusions');
  });
});
