import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PopularVoteRolloverService } from './popular-vote-rollover.service';
import { PopularVoteService } from './popular-vote.service';

// The runner creates this disposable database and applies all 100 migrations; no seed.
const describePostgres = process.env.RUN_PICK_MONTHLY_DB_QA === '1' ? describe : describe.skip;
const AUDIT_ACTION = 'popular_vote.monthly_pick.finalize';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const GRACE_MS = 5 * 60 * 1000;

function guardedDatabaseUrl() {
  const value = process.env.PICK_MONTHLY_QA_DATABASE_URL;
  const message = 'PICK_MONTHLY_QA_DATABASE_URL requires 127.0.0.1:55432, ' +
    'lumina_pick_qa_[a-f0-9]{12}, and exactly ?schema=public';
  if (!value) throw new Error(message);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(message);
  }
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol) ||
      parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
      !/^\/lumina_pick_qa_[a-f0-9]{12}$/.test(parsed.pathname) ||
      parsed.search !== '?schema=public' || parsed.hash) {
    throw new Error(message);
  }
  return { url: value, database: parsed.pathname.slice(1) };
}

function monthRange(year: number, month: number) {
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - KST_OFFSET_MS),
    end: new Date(Date.UTC(year, month, 1) - KST_OFFSET_MS),
  };
}

function currentKstMonth() {
  const kst = new Date(Date.now() + KST_OFFSET_MS);
  return { year: kst.getUTCFullYear(), month: kst.getUTCMonth() + 1 };
}

function boundProperty(target: object, property: string | symbol) {
  const value = Reflect.get(target, property);
  return typeof value === 'function' ? value.bind(target) : value;
}

type TransactionOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

type CaseIds = {
  users: string[];
  artists: string[];
  campaigns: string[];
  audits: Set<string>;
  tasks: Promise<unknown>[];
  pending: Set<Promise<unknown>>;
  releaseGates: (() => void)[];
};

describePostgres('monthly picks on isolated PostgreSQL (real Prisma, native timers)', () => {
  let db: PrismaClient;
  let ids: CaseIds | undefined;
  let baseline: Awaited<ReturnType<typeof state>>;
  let ready = false;

  function caseIds() {
    if (!ids) throw new Error('Monthly pick case fixture is not initialized');
    return ids;
  }

  function newService(client: PrismaClient | Prisma.TransactionClient = db) {
    return new PopularVoteService(client as unknown as PrismaService);
  }

  function track<T>(task: Promise<T>) {
    const fixture = caseIds();
    fixture.tasks.push(task);
    fixture.pending.add(task);
    void task.then(
      () => { fixture.pending.delete(task); },
      () => { fixture.pending.delete(task); },
    );
    return task;
  }

  async function drainConcurrent<T>(tasks: Promise<T>[]) {
    const results = await Promise.allSettled(tasks.map(track));
    expect(caseIds().pending.size).toBe(0);
    for (const result of results) expect(result.status).toBe('fulfilled');
    return results.map(result => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
  }

  async function state() {
    const [users, artists, campaigns, events, winners, audits, snapshots] =
      await db.$transaction([
        db.user.findMany({ orderBy: { id: 'asc' } }),
        db.artist.findMany({ orderBy: { id: 'asc' } }),
        db.boostCampaign.findMany({ orderBy: { id: 'asc' } }),
        db.artistBoostEvent.findMany({ orderBy: { id: 'asc' } }),
        db.monthlyPickWinner.findMany({ orderBy: [{ year: 'asc' }, { month: 'asc' }] }),
        db.auditEvent.findMany({ orderBy: { id: 'asc' } }),
        db.artistRankingSnapshot.findMany({ orderBy: { id: 'asc' } }),
      ]);
    return { users, artists, campaigns, events, winners, audits, snapshots };
  }

  async function user() {
    const id = randomUUID();
    caseIds().users.push(id);
    return db.user.create({ data: { id, status: 'active' } });
  }

  async function artist(displayName: string, sortOrder = -20, status = 'active') {
    const id = randomUUID();
    caseIds().artists.push(id);
    return db.artist.create({ data: { id, slug: `pick-qa-${id}`, displayName, sortOrder, status } });
  }

  async function campaign(startsAt: Date, endsAt: Date, freeLikeWeight = '1') {
    const id = randomUUID();
    caseIds().campaigns.push(id);
    return db.boostCampaign.create({ data: {
      id, slug: `pick-qa-${id}`, name: 'Synthetic monthly pick QA', status: 'active',
      startsAt, endsAt, freeLikeWeight,
    } });
  }

  async function vote(
    campaignId: string, userId: string, artistId: string, createdAt: Date,
    rawAmount: string, weightedScore = rawAmount,
  ) {
    const id = randomUUID();
    return db.artistBoostEvent.create({ data: {
      id, campaignId, userId, artistId, createdAt, boostType: 'free_like',
      rawAmount, weightedScore, idempotencyKey: `pick-qa-${id}`, metadata: { syntheticPickQa: true },
    } });
  }

  function transactionsThrough(
    transform: (tx: Prisma.TransactionClient) => Prisma.TransactionClient,
    observedOptions: (TransactionOptions | undefined)[] = [],
  ) {
    return new Proxy(db, {
      get(target, property) {
        if (property === '$transaction') {
          return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: TransactionOptions) => {
            observedOptions.push(options);
            // Forward the product's options verbatim, including its default timeout.
            return target.$transaction(tx => callback(transform(tx)), options);
          };
        }
        return boundProperty(target, property);
      },
    });
  }

  function racingService(year: number, month: number, participants: number) {
    let arrivals = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    caseIds().releaseGates.push(release);
    const reads: (string | null)[] = [];
    const manualCreates: number[] = [];
    const automaticCreates: number[] = [];
    const options: (TransactionOptions | undefined)[] = [];
    const client = transactionsThrough(tx => new Proxy(tx, {
      get(target, property) {
        if (property === 'monthlyPickWinner') return new Proxy(target.monthlyPickWinner, {
          get(delegate, method) {
            if (method === 'createMany') return async (args: Prisma.MonthlyPickWinnerCreateManyArgs) => {
              const result = await delegate.createMany(args);
              manualCreates.push(result.count);
              return result;
            };
            return boundProperty(delegate, method);
          },
        });
        return boundProperty(target, property);
      },
    }), options);
    const root = new Proxy(client, {
      get(target, property) {
        if (property === 'monthlyPickWinner') return new Proxy(db.monthlyPickWinner, {
          get(delegate, method) {
            if (method === 'findUnique') return async (args: Prisma.MonthlyPickWinnerFindUniqueArgs) => {
              const result = await delegate.findUnique(args);
              if (args.where.year_month?.year === year && args.where.year_month.month === month) {
                reads.push(result?.id ?? null);
                arrivals += 1;
                if (arrivals === participants) release();
                await gate;
              }
              return result;
            };
            if (method === 'createMany') return async (args: Prisma.MonthlyPickWinnerCreateManyArgs) => {
              const result = await delegate.createMany(args);
              automaticCreates.push(result.count);
              return result;
            };
            return boundProperty(delegate, method);
          },
        });
        return boundProperty(target, property);
      },
    });
    return { service: newService(root), reads, manualCreates, automaticCreates, options };
  }

  async function readOnly<T>(read: (service: PopularVoteService) => Promise<T>) {
    return db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      expect(await tx.$queryRaw`SHOW transaction_read_only`).toEqual([{ transaction_read_only: 'on' }]);
      return read(newService(tx));
    });
  }

  function expectManualAudit(
    audit: Prisma.AuditEventGetPayload<{}>, winner: Prisma.MonthlyPickWinnerGetPayload<{}>, actorId: string,
  ) {
    expect(winner.metadata).toEqual({ source: 'admin_manual', finalizedByUserId: actorId });
    expect(audit).toMatchObject({
      actorUserId: actorId, actorType: 'admin', action: AUDIT_ACTION,
      targetType: 'monthly_pick_winner', targetId: winner.id, beforeData: null, afterData: null,
      metadata: { campaignId: winner.campaignId, artistId: winner.artistId, year: winner.year, month: winner.month },
    });
  }

  beforeAll(async () => {
    const target = guardedDatabaseUrl();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    await db.$connect();
    const identity = await db.$queryRaw<{ database: string; schema: string; schemas: string[] }[]>`
      SELECT current_database() AS database, current_schema() AS schema, current_schemas(false) AS schemas
    `;
    expect(identity).toEqual([{ database: target.database, schema: 'public', schemas: ['public'] }]);
    const migrations = await db.$queryRaw<{ total: number; applied: number }[]>`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied
      FROM public._prisma_migrations
    `;
    expect(migrations).toEqual([{ total: 100, applied: 100 }]);
    baseline = await state();
    expect(baseline).toMatchObject({
      users: [], campaigns: [], events: [], winners: [], audits: [], snapshots: [],
    });
    // Migration 0045 supplies an active artist. Preserve it, never seed or delete it.
    expect(baseline.artists.map(row => row.slug)).toEqual(['oh-hyerin']);
    expect(Date.now()).toBeGreaterThanOrEqual(new Date('2026-09-30T15:05:00.000Z').getTime());
    ready = true;
  });

  beforeEach(async () => {
    if (!ready) return;
    expect(await state()).toEqual(baseline);
    ids = { users: [], artists: [], campaigns: [], audits: new Set(), tasks: [], pending: new Set(), releaseGates: [] };
  });

  afterEach(async () => {
    if (!ids) return;
    const fixture = ids;
    for (const release of fixture.releaseGates) release();
    const drained = await Promise.allSettled(fixture.tasks);
    const pendingAfterDrain = fixture.pending.size;
    jest.restoreAllMocks();
    const campaignWhere = { campaignId: { in: fixture.campaigns } };
    const ownedWinners = await db.monthlyPickWinner.findMany({ where: campaignWhere, select: { id: true } });
    const ownedAudits = await db.auditEvent.findMany({ where: { OR: [
      { id: { in: [...fixture.audits] } },
      { actorUserId: { in: fixture.users } },
      { targetId: { in: ownedWinners.map(row => row.id) } },
    ] }, select: { id: true } });
    const auditIds = [...new Set([...fixture.audits, ...ownedAudits.map(row => row.id)])];
    // All deletes use this case's exact generated IDs, never dates, slugs, or blanket deletes.
    await db.auditEvent.deleteMany({ where: { id: { in: auditIds } } });
    await db.monthlyPickWinner.deleteMany({ where: campaignWhere });
    await db.artistRankingSnapshot.deleteMany({ where: campaignWhere });
    await db.artistBoostEvent.deleteMany({ where: campaignWhere });
    await db.boostCampaign.deleteMany({ where: { id: { in: fixture.campaigns } } });
    await db.artist.deleteMany({ where: { id: { in: fixture.artists } } });
    await db.user.deleteMany({ where: { id: { in: fixture.users } } });
    expect(drained).toHaveLength(fixture.tasks.length);
    expect(pendingAfterDrain).toBe(0);
    const remaining = await db.$transaction([
      db.auditEvent.count({ where: { id: { in: auditIds } } }),
      db.monthlyPickWinner.count({ where: campaignWhere }),
      db.artistRankingSnapshot.count({ where: campaignWhere }),
      db.artistBoostEvent.count({ where: campaignWhere }),
      db.boostCampaign.count({ where: { id: { in: fixture.campaigns } } }),
      db.artist.count({ where: { id: { in: fixture.artists } } }),
      db.user.count({ where: { id: { in: fixture.users } } }),
    ]);
    expect(remaining).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(await state()).toEqual(baseline);
    ids = undefined;
  });

  afterAll(async () => { await db?.$disconnect(); });

  it('catches up missed months, preserves receipts on rerun/new service, and preserves them through real rollover startup', async () => {
    const voter = await user();
    const first = await artist('QA First');
    const second = await artist('QA Second', -10);
    const august = monthRange(2026, 8);
    const september = monthRange(2026, 9);
    const c = await campaign(august.start, september.end, '1.25');
    await vote(c.id, voter.id, first.id, august.start, '4', '5');
    await vote(c.id, voter.id, second.id, august.start, '2', '2.5');
    await vote(c.id, voter.id, second.id, september.start, '8', '10');
    const events = (await state()).events;
    const now = new Date(september.end.getTime() + GRACE_MS);
    const service = newService();
    await track(service.archiveCompletedMonths(now));
    const saved = (await state()).winners;
    expect(saved).toHaveLength(2);
    expect(saved.map(row => [row.year, row.month, row.artistId, row.totalWeightedScore.toString()])).toEqual([
      [2026, 8, first.id, '5'], [2026, 9, second.id, '10'],
    ]);
    expect(saved.every(row => row.campaignId === c.id && row.rankNo === 1)).toBe(true);
    expect(saved.map(row => row.totalFreeLikes.toString())).toEqual(['4', '8']);
    expect(saved.map(row => row.totalLuminaBoosts.toString())).toEqual(['0', '0']);
    expect(saved.map(row => row.metadata)).toEqual([
      { source: 'automatic_kst_rollover' }, { source: 'automatic_kst_rollover' },
    ]);
    await track(service.archiveCompletedMonths(now));
    const restarted = newService();
    await track(restarted.archiveCompletedMonths(now));
    expect((await state()).winners).toEqual(saved);
    const duplicate = await track(restarted.finalizeMonthlyPick(voter, { campaignId: c.id, year: 2026, month: 9 }));
    expect(duplicate.winner.id).toBe(saved[1].id);
    expect(duplicate.rankings).toEqual([]);

    // Actual module lifecycle with native timers, not a full process restart.
    const lifecycleService = newService();
    const archive = jest.spyOn(lifecycleService, 'archiveCompletedMonths');
    const rollover = new PopularVoteRolloverService(lifecycleService);
    try {
      await track(rollover.onModuleInit());
    } finally {
      rollover.onModuleDestroy();
    }
    expect(archive).toHaveBeenCalled();
    // Startup catches errors internally; also assert that its actual archival calls succeeded.
    await drainConcurrent(archive.mock.results.map(result => {
      if (result.type !== 'return') throw new Error('Rollover archival did not return a promise');
      return result.value as Promise<void>;
    }));
    const after = await state();
    expect(after.winners).toEqual(saved);
    expect(after.events).toEqual(events);
    expect(after.audits).toEqual([]);
  });

  it('uses fixed KST first-millisecond bounds, exact five-minute grace, active tie order, and no zero-score winner', async () => {
    const voter = await user();
    const zeta = await artist('QA Zeta');
    const alpha = await artist('QA Alpha');
    const laterOrder = await artist('QA Aardvark', -10);
    const zero = await artist('QA Zero', -30);
    // The migrated status CHECK has no literal hidden status; archived is non-public.
    const hidden = await artist('QA Hidden', -100, 'archived');
    const mayStart = new Date('2026-04-30T15:00:00.000Z');
    const juneStart = new Date('2026-05-31T15:00:00.000Z');
    const julyStart = new Date('2026-06-30T15:00:00.000Z');
    const augustStart = new Date('2026-07-31T15:00:00.000Z');
    const c = await campaign(monthRange(2026, 4).start, augustStart);
    await vote(c.id, voter.id, alpha.id, new Date(mayStart.getTime() - 1), '1000');
    await vote(c.id, voter.id, zeta.id, mayStart, '8');
    await vote(c.id, voter.id, alpha.id, mayStart, '4');
    await vote(c.id, voter.id, alpha.id, new Date(juneStart.getTime() - 1), '4');
    await vote(c.id, voter.id, laterOrder.id, mayStart, '8');
    await vote(c.id, voter.id, hidden.id, mayStart, '99999');
    await vote(c.id, voter.id, zeta.id, juneStart, '1000');
    await vote(c.id, voter.id, zero.id, julyStart, '1', '0');
    const events = (await state()).events;
    const service = newService();
    await track(service.archiveCompletedMonths(new Date(juneStart.getTime() + GRACE_MS - 1)));
    expect(await db.monthlyPickWinner.findUnique({ where: { year_month: { year: 2026, month: 5 } } })).toBeNull();
    expect(await db.monthlyPickWinner.findUnique({ where: { year_month: { year: 2026, month: 4 } } }))
      .toMatchObject({ artistId: alpha.id, totalWeightedScore: new Prisma.Decimal('1000') });
    const beforeEarlyManual = await state();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(juneStart.getTime() + GRACE_MS - 1);
    try {
      await expect(track(service.finalizeMonthlyPick(voter, { campaignId: c.id, year: 2026, month: 5 })))
        .rejects.toThrow('Only settled KST months');
      expect(await state()).toEqual(beforeEarlyManual);
      clock.mockReturnValue(juneStart.getTime() + GRACE_MS);
      const manual = await track(service.finalizeMonthlyPick(voter, { campaignId: c.id, year: 2026, month: 5 }));
      expect(manual.rankings.map(row => row.artist.id)).toEqual([alpha.id, zeta.id, laterOrder.id]);
      expect(manual.rankings.map(row => row.totalWeightedScore.toString())).toEqual(['8', '8', '8']);
      expect(manual.winner).toMatchObject({ artistId: alpha.id, totalFreeLikes: new Prisma.Decimal('8'),
        totalWeightedScore: new Prisma.Decimal('8'), year: 2026, month: 5 });
    } finally {
      // Only Date.now was spied; Date construction and every PostgreSQL/native timer remain real.
      clock.mockRestore();
    }
    const may = await db.monthlyPickWinner.findUniqueOrThrow({ where: { year_month: { year: 2026, month: 5 } } });
    await track(service.archiveCompletedMonths(new Date(julyStart.getTime() + GRACE_MS - 1)));
    expect(await db.monthlyPickWinner.findUnique({ where: { year_month: { year: 2026, month: 6 } } })).toBeNull();
    await track(service.archiveCompletedMonths(new Date(julyStart.getTime() + GRACE_MS)));
    expect(await db.monthlyPickWinner.findUnique({ where: { year_month: { year: 2026, month: 6 } } }))
      .toMatchObject({ artistId: zeta.id, totalWeightedScore: new Prisma.Decimal('1000') });
    await track(newService().archiveCompletedMonths(new Date(augustStart.getTime() + GRACE_MS)));
    const after = await state();
    expect(after.winners.map(row => row.month)).toEqual([4, 5, 6]);
    expect(after.winners.find(row => row.month === 5)).toEqual(may);
    expect(after.winners.some(row => row.artistId === hidden.id || row.artistId === zero.id)).toBe(false);
    expect(after.events).toEqual(events);
    expect(after.audits).toHaveLength(1);
    expectManualAudit(after.audits[0], may, voter.id);
  });

  it('keeps monthly, real-current-KST main, annual, and existing-past-winner reads PostgreSQL read-only', async () => {
    const voter = await user();
    const visible = await artist('QA Visible', -30);
    const zero = await artist('QA Zero', -20);
    const hidden = await artist('QA Hidden', -100, 'archived');
    const january = monthRange(2026, 1);
    const current = currentKstMonth();
    const currentRange = monthRange(current.year, current.month);
    const c = await campaign(monthRange(2025, 1).start, currentRange.end);
    await vote(c.id, voter.id, visible.id, monthRange(2025, 12).start, '5');
    await vote(c.id, voter.id, hidden.id, monthRange(2025, 12).start, '99999');
    await vote(c.id, voter.id, visible.id, january.start, '3');
    await vote(c.id, voter.id, visible.id, currentRange.start, '7');
    await vote(c.id, voter.id, visible.id, new Date(currentRange.start.getTime() - 1), '1000');
    await vote(c.id, voter.id, hidden.id, currentRange.start, '99999');
    await vote(c.id, voter.id, visible.id, currentRange.end, '2000');
    const before = await state();
    await track(readOnly(async service => {
      expect(await service.getMonthlyPicks({ year: '2026' })).toEqual([]);
      const main = await service.getMainPick();
      expect(main.campaign?.id).toBe(c.id);
      expect(main.leader?.artist.id).toBe(visible.id);
      expect(main.leader?.totalWeightedScore.toString()).toBe('7');
      expect(main.rankings.find(row => row.artist.id === zero.id)?.totalWeightedScore.toString()).toBe('0');
      expect(main.rankings.some(row => row.artist.id === hidden.id)).toBe(false);
      const pastYear = await service.getYearChampion({ year: '2025' });
      expect(pastYear.champion?.artist.id).toBe(visible.id);
      expect(pastYear.champion?.totalWeightedScore.toString()).toBe('5');
      expect(pastYear.rankings.map(row => row.artist.id)).toEqual([visible.id]);
      const thisYear = await service.getYearChampion({ year: String(current.year) });
      expect(thisYear.champion).toBeNull();
      expect(thisYear.rule).toBe('annual_weighted_score_sum');
    }));
    expect(await state()).toEqual(before);
    const finalized = await track(newService().finalizeMonthlyPick(voter, { campaignId: c.id, year: 2026, month: 1 }));
    const withWinner = await state();
    await track(readOnly(async service => {
      const monthly = await service.getMonthlyPicks({ year: '2026' });
      expect(monthly.map(row => row.id)).toEqual([finalized.winner.id]);
      // Existing-winner lookup must not recompute even with an unrelated campaign ID.
      expect(await service.finalizeMonthlyPick(voter, { campaignId: randomUUID(), year: 2026, month: 1 }))
        .toMatchObject({ winner: { id: finalized.winner.id }, rankings: [] });
      expect((await service.getMainPick()).leader?.totalWeightedScore.toString()).toBe('7');
      expect((await service.getYearChampion({ year: '2025' })).champion?.totalWeightedScore.toString()).toBe('5');
    }));
    expect(await state()).toEqual(withWinner);
    expect(withWinner.events).toEqual(before.events);
    expect(withWinner.audits).toHaveLength(1);
  });

  it('settles eight genuinely competing manual transactions into one winner and exactly one matching audit', async () => {
    const voter = await user();
    const admins = [voter];
    for (let index = 1; index < 8; index += 1) admins.push(await user());
    const a = await artist('QA Parallel');
    const january = monthRange(2026, 1);
    const c = await campaign(january.start, january.end, '1.25');
    await vote(c.id, voter.id, a.id, january.start, '8', '10');
    const events = (await state()).events;
    const race = racingService(2026, 1, admins.length);
    const results = await drainConcurrent(admins.map(admin => race.service.finalizeMonthlyPick(admin, {
      campaignId: c.id, year: 2026, month: 1,
    })));
    expect(race.reads).toEqual(Array(8).fill(null));
    expect(race.manualCreates.sort()).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(race.options).toEqual(Array.from({ length: 8 }, () => ({
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    })));
    expect(new Set(results.map(result => result.winner.id)).size).toBe(1);
    expect(results.filter(result => result.rankings.length > 0)).toHaveLength(1);
    expect(results.filter(result => result.rankings.length === 0)).toHaveLength(7);
    const after = await state();
    expect(after.winners).toHaveLength(1);
    expect(after.audits).toHaveLength(1);
    expect(after.winners[0]).toMatchObject({ campaignId: c.id, artistId: a.id, year: 2026, month: 1,
      totalFreeLikes: new Prisma.Decimal('8'), totalLuminaBoosts: new Prisma.Decimal('0'),
      totalWeightedScore: new Prisma.Decimal('10') });
    const winningIndex = results.findIndex(result => result.rankings.length > 0);
    expectManualAudit(after.audits[0], after.winners[0], admins[winningIndex].id);
    expect(after.events).toEqual(events);
    expect(after.snapshots).toEqual([]);
    const receipt = after.winners[0];
    for (const result of results) expect(result.winner).toMatchObject(receipt);
    const duplicate = await track(newService().finalizeMonthlyPick(admins[0], { campaignId: c.id, year: 2026, month: 1 }));
    expect(duplicate.rankings).toEqual([]);
    expect(duplicate.winner).toMatchObject(receipt);
    expect(await state()).toEqual(after);
  });

  it('races automatic and manual choices without overwriting the receipt or auditing an automatic winner', async () => {
    const admin = await user();
    const manualArtist = await artist('QA Manual');
    const automaticArtist = await artist('QA Automatic', -10);
    const january = monthRange(2026, 1);
    const manualCampaign = await campaign(january.start, january.end);
    const automaticCampaign = await campaign(new Date(january.start.getTime() + 1), january.end);
    await vote(manualCampaign.id, admin.id, manualArtist.id, new Date(january.start.getTime() + 2), '4');
    await vote(automaticCampaign.id, admin.id, automaticArtist.id, new Date(january.start.getTime() + 2), '20');
    const events = (await state()).events;
    const race = racingService(2026, 1, 2);
    const now = new Date(january.end.getTime() + GRACE_MS);
    const [automatic, manual] = await drainConcurrent<
      Awaited<ReturnType<PopularVoteService['finalizeMonthlyPick']>> | null
    >([
      race.service.archiveCompletedMonths(now).then(() => null),
      race.service.finalizeMonthlyPick(admin, { campaignId: manualCampaign.id, year: 2026, month: 1 }),
    ]);
    expect(automatic).toBeNull();
    if (!manual) throw new Error('Missing competing manual result');
    expect(race.reads).toEqual([null, null]);
    expect(race.manualCreates).toHaveLength(1);
    expect(race.automaticCreates).toHaveLength(1);
    expect([...race.manualCreates, ...race.automaticCreates].sort()).toEqual([0, 1]);
    expect(race.options).toEqual([{ isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }]);
    const after = await state();
    expect(after.winners).toHaveLength(1);
    expect(after.audits.length).toBeLessThanOrEqual(1);
    const winner = after.winners[0];
    expect(manual.winner).toMatchObject(winner);
    if (race.manualCreates[0] === 1) {
      expect(winner).toMatchObject({ campaignId: manualCampaign.id, artistId: manualArtist.id,
        totalWeightedScore: new Prisma.Decimal('4') });
      expect(manual.rankings).toHaveLength(1);
      expect(after.audits).toHaveLength(1);
      expectManualAudit(after.audits[0], winner, admin.id);
    } else {
      expect(winner).toMatchObject({ campaignId: automaticCampaign.id, artistId: automaticArtist.id,
        totalWeightedScore: new Prisma.Decimal('20'), metadata: { source: 'automatic_kst_rollover' } });
      expect(manual.rankings).toEqual([]);
      expect(after.audits).toEqual([]);
    }
    expect(after.events).toEqual(events);
    await track(newService().archiveCompletedMonths(now));
    const duplicate = await track(newService().finalizeMonthlyPick(admin, {
      campaignId: manualCampaign.id, year: 2026, month: 1,
    }));
    expect(duplicate.rankings).toEqual([]);
    expect(duplicate.winner).toMatchObject(winner);
    expect(await state()).toEqual(after);
  });

  it('rolls back real winning and audit writes when the transaction audit proxy throws, then retries the same request', async () => {
    const admin = await user();
    const a = await artist('QA Rollback');
    const january = monthRange(2026, 1);
    const c = await campaign(january.start, january.end, '1.25');
    await vote(c.id, admin.id, a.id, january.start, '4', '5');
    const request = { campaignId: c.id, year: 2026, month: 1 };
    const before = await state();
    const fault = new Error('Synthetic audit failure after real PostgreSQL writes');
    let uncommittedWinner: Prisma.MonthlyPickWinnerGetPayload<{}> | undefined;
    let uncommittedAuditId: string | undefined;
    const options: (TransactionOptions | undefined)[] = [];
    const failingClient = transactionsThrough(tx => new Proxy(tx, {
      get(target, property) {
        if (property === 'auditEvent') return new Proxy(target.auditEvent, {
          get(delegate, method) {
            if (method === 'create') return async (args: Prisma.AuditEventCreateArgs) => {
              // This row exists in the actual transaction before injecting the failure.
              uncommittedWinner = await tx.monthlyPickWinner.findUniqueOrThrow({
                where: { year_month: { year: request.year, month: request.month } },
              });
              expect(uncommittedWinner).toMatchObject({ campaignId: c.id, artistId: a.id,
                totalWeightedScore: new Prisma.Decimal('5'), metadata: { source: 'admin_manual', finalizedByUserId: admin.id } });
              expect(await tx.$queryRaw`SHOW transaction_isolation`).toEqual([{ transaction_isolation: 'read committed' }]);
              const writtenAudit = await delegate.create(args);
              uncommittedAuditId = writtenAudit.id;
              caseIds().audits.add(writtenAudit.id);
              expectManualAudit(writtenAudit, uncommittedWinner, admin.id);
              throw fault;
            };
            return boundProperty(delegate, method);
          },
        });
        return boundProperty(target, property);
      },
    }), options);
    await expect(track(newService(failingClient).finalizeMonthlyPick(admin, request))).rejects.toBe(fault);
    expect(options).toEqual([{ isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }]);
    expect(uncommittedWinner).toBeDefined();
    expect(uncommittedAuditId).toBeDefined();
    expect(await db.monthlyPickWinner.findUnique({ where: { year_month: { year: 2026, month: 1 } } })).toBeNull();
    expect(await db.monthlyPickWinner.findUnique({ where: { id: uncommittedWinner!.id } })).toBeNull();
    expect(await db.auditEvent.findUnique({ where: { id: uncommittedAuditId! } })).toBeNull();
    expect(await state()).toEqual(before);
    const retry = await track(newService().finalizeMonthlyPick(admin, request));
    expect(retry.winner.id).not.toBe(uncommittedWinner!.id);
    expect(retry.rankings).toHaveLength(1);
    const after = await state();
    expect(after.winners).toHaveLength(1);
    expect(after.winners[0].id).toBe(retry.winner.id);
    expect(after.audits).toHaveLength(1);
    expect(after.audits[0].id).not.toBe(uncommittedAuditId);
    expectManualAudit(after.audits[0], after.winners[0], admin.id);
    expect(after.events).toEqual(before.events);
  });

  it('rejects bad, partial, future, unrelated, missing, empty, and zero-score requests without a write', async () => {
    const admin = await user();
    const a = await artist('QA No Positive');
    const january = monthRange(2026, 1);
    const february = monthRange(2026, 2);
    const c = await campaign(january.start, february.end, '0');
    const unrelated = await campaign(january.end, february.end);
    const ended = await campaign(monthRange(2025, 12).start, january.start);
    await vote(c.id, admin.id, a.id, january.start, '1', '0');
    const before = await state();
    const current = currentKstMonth();
    const future = current.month === 12 ? { year: current.year + 1, month: 1 } :
      { year: current.year, month: current.month + 1 };
    const invalid: { campaignId?: string; year?: number; month?: number }[] = [
      { year: 2025, month: 1 }, { year: 2101, month: 1 }, { year: 2026.5, month: 1 },
      { year: Number.NaN, month: 1 }, { year: 2026, month: 0 }, { year: 2026, month: 13 },
      { year: 2026, month: 1.5 }, { year: 2026, month: Number.NaN },
      { year: 2026 }, { month: 1 }, current, future,
      { campaignId: unrelated.id, year: 2026, month: 1 },
      { campaignId: ended.id, year: 2026, month: 1 },
      { campaignId: c.id, year: 2026, month: 1 },
      { campaignId: c.id, year: 2026, month: 2 },
    ];
    const service = newService();
    for (const request of invalid) {
      await expect(track(service.finalizeMonthlyPick(admin, request))).rejects.toBeInstanceOf(BadRequestException);
      expect(await state()).toEqual(before);
    }
    await expect(track(service.finalizeMonthlyPick(admin, { campaignId: randomUUID(), year: 2026, month: 1 })))
      .rejects.toBeInstanceOf(NotFoundException);
    await track(service.archiveCompletedMonths(new Date(february.end.getTime() + GRACE_MS)));
    expect(await state()).toEqual(before);
    expect(await db.monthlyPickWinner.count()).toBe(0);
    expect(await db.auditEvent.count()).toBe(0);
  });
});
