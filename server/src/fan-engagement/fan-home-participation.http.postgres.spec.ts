import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { createValidationException } from '../common/validation-exception.factory';
import { PrismaService } from '../prisma/prisma.service';
import { FanEngagementJwtAuthGuard } from './fan-engagement-auth.guard';
import { FanEngagementController } from './fan-engagement.controller';
import { fanEngagementPrivacyMiddleware } from './fan-engagement.privacy';
import { FanEngagementService } from './fan-engagement.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
const missionPath = '/api/v1/fan-engagement/missions';
const homePath = missionPath + '?surface=home&scope=today&take=3';
type Counts = { participations: number; ledgers: number; points: number };
type Barrier = { arrivals: number; arrive(): Promise<void>; close(): void };
type HttpResult = { status: number; cache: string | undefined; vary: string | undefined; json: any };

// Scoped controller module, real JWT guards and Prisma SDK174; NOT AppModule/AuthModule bootstrap.
// Only fresh owned QA rows/tokens are created. Parent prepares the 103-migration DB and owns execution.
// Frontend integration is PENDING: parent is changing startup ordering and will supply a new frozen pin.
// No consumer pin, DOM/VM substitute, worker, provider, migration or schema setup is included here.
// Synthetic rows are retained in this admitted DB; each case has a new ID scope and no cleanup deletes.
jest.setTimeout(30000);

postgres('HOME general participation HTTP on fresh owned PostgreSQL (scoped module, synthetic only)', () => {
  let db: PrismaClient, app: INestApplication, port: number, jwt: JwtService, secret: string;
  let admitted = false;
  let barrier: Barrier | null = null;
  let ledgerFailure: { userId: string; missionId: string } | null = null;
  let rollbackVisible: Counts | null = null;
  let injectedCreates = 0;
  let missionSequence = 0;
  const users = new Set<string>(), missions = new Set<string>();
  const retained: Array<{ userIds: string[]; missionIds: string[]; rows: Awaited<ReturnType<typeof footprint>> }> = [];

  async function infrastructure(database: string) {
    expect(Prisma.dmmf.datamodel.models.length).toBe(174);
    const identity = await db.$queryRaw<Array<{ database: string; role: string; schema: string }>>`
      SELECT current_database() AS database, current_user AS role, current_schema() AS schema
    `;
    expect(identity).toEqual([{ database, role: 'lumina_qa', schema: 'public' }]);
    const migrations = await db.$queryRaw<Array<{ total: number; applied: number }>>`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied
      FROM public._prisma_migrations
    `;
    expect(migrations).toEqual([{ total: 103, applied: 103 }]);
  }

  async function counts(client: PrismaClient | Prisma.TransactionClient, userId: string, missionId: string) {
    const result = await client.$queryRaw<Counts[]>`
      SELECT
        (SELECT count(*)::int FROM public.fan_mission_participations
          WHERE user_id = ${userId}::uuid AND mission_id = ${missionId}::uuid) AS participations,
        (SELECT count(*)::int FROM public.fan_engagement_point_ledger
          WHERE user_id = ${userId}::uuid) AS ledgers,
        (SELECT coalesce(sum(points), 0)::int FROM public.fan_engagement_point_ledger
          WHERE user_id = ${userId}::uuid) AS points
    `;
    expect(result).toHaveLength(1);
    return result[0];
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
      parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash ||
      !/^\/lumina_failed_cost_qa_[a-f0-9]{12}$/.test(parsed.pathname)) {
      throw new Error('Dedicated fresh owned loopback QA database required');
    }
    expect(Prisma.dmmf.datamodel.models.length).toBe(174);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    await infrastructure(parsed.pathname.slice(1));
    expect(await db.user.count()).toBe(0);
    expect(await db.fanMission.count()).toBe(0);
    expect(await db.fanMissionParticipation.count()).toBe(0);
    expect(await db.fanEngagementPointLedger.count()).toBe(0);
    admitted = true;

    // All operations still reach the real client/transaction. Only the two named test boundaries are observed.
    const observed = new Proxy(db, { get(target, field) {
      if (field === '$transaction') return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        target.$transaction(async tx => callback(new Proxy(tx, { get(transaction, modelName) {
          const delegate = Reflect.get(transaction, modelName);
          if (modelName === 'fanMissionParticipation' || modelName === 'fanEngagementPointLedger') {
            return new Proxy(delegate, { get(model, method) {
              const original = Reflect.get(model, method);
              if (method === 'create') return async (...args: unknown[]) => {
                if (modelName === 'fanMissionParticipation' && barrier) await barrier.arrive();
                const created = await Reflect.apply(original, model, args);
                if (modelName === 'fanEngagementPointLedger' && ledgerFailure && created &&
                  typeof created === 'object' && 'userId' in created && created.userId === ledgerFailure.userId) {
                  const fault = ledgerFailure; ledgerFailure = null; injectedCreates++;
                  rollbackVisible = await counts(tx, fault.userId, fault.missionId);
                  // Both SQL INSERTs have actually happened inside this real transaction; throwing must roll back both.
                  throw new Error('SYNTHETIC_LEDGER_CREATE_FAILURE');
                }
                return created;
              };
              return typeof original === 'function' ? original.bind(model) : original;
            } });
          }
          return typeof delegate === 'function' ? delegate.bind(transaction) : delegate;
        } })));
      const value = Reflect.get(target, field);
      return typeof value === 'function' ? value.bind(target) : value;
    } });

    jwt = new JwtService(); secret = randomUUID() + randomUUID();
    const module = await Test.createTestingModule({ controllers: [FanEngagementController], providers: [
      { provide: PrismaService, useValue: observed }, { provide: JwtService, useValue: jwt },
      { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
      FanEngagementService, JwtAuthGuard, OptionalJwtAuthGuard, FanEngagementJwtAuthGuard,
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    app.use(fanEngagementPrivacyMiddleware);
    configureHttpRouting(app);
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true,
      forbidUnknownValues: true, exceptionFactory: createValidationException }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    expect(address.address).toBe('127.0.0.1'); port = address.port;
  });

  beforeEach(() => {
    users.clear(); missions.clear();
    barrier = null; ledgerFailure = null; rollbackVisible = null; injectedCreates = 0;
  });
  afterEach(async () => {
    barrier?.close(); barrier = null; ledgerFailure = null;
    if (!admitted) return;
    const userIds = [...users], missionIds = [...missions];
    retained.push({ userIds, missionIds, rows: await footprint(userIds, missionIds) });
  });
  afterAll(async () => {
    try {
      await app?.close();
      if (admitted) {
        for (const prior of retained) expect(await footprint(prior.userIds, prior.missionIds)).toEqual(prior.rows);
        await infrastructure(new URL(url!).pathname.slice(1));
      }
    } finally { await db?.$disconnect(); }
  });

  async function fixture() {
    async function user(status: 'active' | 'suspended' = 'active') {
      const row = await db.user.create({ data: { status } }); users.add(row.id); return row;
    }
    const owner = await user(), other = await user(), inactive = await user('suspended');
    const token = (id: string) => jwt.signAsync({ sub: id, tokenType: 'access' }, { secret, expiresIn: '5m' });
    return { owner, other, inactive, ownerToken: await token(owner.id), otherToken: await token(other.id),
      inactiveToken: await token(inactive.id) };
  }

  async function mission(data: Partial<Prisma.FanMissionUncheckedCreateInput> = {}) {
    const row = await db.fanMission.create({ data: { slug: 'synthetic-home-http-' + randomUUID(),
      missionType: 'daily_signal', status: 'active', surfaces: ['home'], resetPolicy: 'daily',
      actionType: 'mission_participation', actionTargetId: null, rewardPolicy: { points: 5 },
      // Deterministic fixture ordering keeps the latest case's HOME rows visible without modifying prior rows.
      createdAt: new Date(Date.UTC(2026, 0, 1) + ++missionSequence * 1000),
      copy: { labels: { ko: { title: 'Synthetic HOME mission', description: 'Synthetic stored mission' } } }, ...data } });
    missions.add(row.id); return row;
  }

  async function footprint(userIds = [...users], missionIds = [...missions]) {
    return {
      users: await db.user.findMany({ where: { id: { in: userIds } }, orderBy: { id: 'asc' } }),
      missions: await db.fanMission.findMany({ where: { id: { in: missionIds } }, orderBy: { id: 'asc' } }),
      participations: await db.fanMissionParticipation.findMany({ where: { userId: { in: userIds } }, orderBy: { id: 'asc' } }),
      ledger: await db.fanEngagementPointLedger.findMany({ where: { userId: { in: userIds } }, orderBy: { id: 'asc' } }),
    };
  }

  function call(method: 'GET' | 'POST', path: string, token: string | null, body?: unknown): Promise<HttpResult> {
    if (!/^\/api\/v1\/fan-engagement\/missions(?:\?|\/|$)/.test(path)) throw new Error('Only scoped mission HTTP allowed');
    return new Promise((resolve, reject) => {
      const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      let timer: ReturnType<typeof setTimeout>;
      const req = request({ hostname: '127.0.0.1', port, method, path,
        headers: { accept: 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}),
          ...(bytes ? { 'content-type': 'application/json', 'content-length': String(bytes.length) } : {}) } }, res => {
        const chunks: Buffer[] = []; let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > 262144) { req.destroy(new Error('Owned loopback response bound exceeded')); return; }
          chunks.push(chunk);
        });
        res.on('error', () => { clearTimeout(timer); reject(new Error('Owned loopback response failed')); });
        res.on('end', () => {
          clearTimeout(timer);
          try { resolve({ status: res.statusCode!, cache: res.headers['cache-control'], vary: res.headers.vary,
            json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
          catch { reject(new Error('Owned loopback JSON response required')); }
        });
      });
      timer = setTimeout(() => req.destroy(new Error('Owned loopback HTTP deadline')), 5000);
      req.on('error', () => { clearTimeout(timer); reject(new Error('Owned loopback HTTP failed')); });
      req.end(bytes);
    });
  }
  const post = (id: string, token: string | null, key = randomUUID(), extra: Record<string, unknown> = {}) =>
    call('POST', `${missionPath}/${id}/participations`, token, { action: 'complete', idempotencyKey: key, ...extra });

  function assertPrivate(response: HttpResult) {
    expect(response.cache).toBe('private, no-store');
    expect(response.vary?.split(',').map(value => value.trim().toLowerCase())).toContain('authorization');
  }
  function assertNonCash(value: unknown) {
    expect(value).toMatchObject({ cashLike: false, luminaAmount: 0, settlementEligible: false, transferable: false });
  }
  async function assertAward(userId: string, missionId: string) {
    expect(await counts(db, userId, missionId)).toEqual({ participations: 1, ledgers: 1, points: 5 });
    const participation = await db.fanMissionParticipation.findFirstOrThrow({ where: { userId, missionId } });
    expect(participation).toMatchObject({ status: 'accepted', sourceType: null, sourceId: null, moderationStatus: 'not_required' });
    const ledger = await db.fanEngagementPointLedger.findFirstOrThrow({ where: { userId } });
    expect(ledger).toMatchObject({ points: 5, direction: 'earn', ledgerType: 'mission_reward',
      referenceType: 'fan_mission_participation', referenceId: participation.id });
    assertNonCash(ledger.metadata);
  }

  it('viewer-auth GET projects daily/once and locks unsupported rows with an immutable private footprint', async () => {
    const f = await fixture(), daily = await mission(), once = await mission({ resetPolicy: 'once' });
    const unsupported = await mission({ missionType: 'vote_concept', actionType: 'concept_vote' });
    await db.fanMissionParticipation.create({ data: { missionId: once.id, userId: f.owner.id,
      participationType: 'daily_signal', resetBucket: 'once', status: 'accepted' } });
    const before = await footprint();
    for (const token of [f.ownerToken, f.otherToken, null]) {
      const result = await call('GET', homePath, token); expect(result.status).toBe(200); assertPrivate(result);
      expect(result.json.items).toHaveLength(3);
      for (const row of [daily, once]) {
        const dto = result.json.items.find((item: { id: string }) => item.id === row.id);
        expect(dto).toMatchObject({ missionType: 'daily_signal', status: 'active', resetPolicy: row.resetPolicy,
          action: { type: 'mission_participation', method: 'POST', requiresAuth: true,
            endpoint: `${missionPath}/${row.id}/participations`, bodyHint: { action: 'complete', idempotencyKey: 'client-generated-key' } } });
        expect(dto.participation).toMatchObject(row.id === once.id && token === f.ownerToken
          ? { status: 'accepted', remainingCount: 0 } : { status: 'not_started', remainingCount: 1 });
      }
      const locked = result.json.items.find((item: { id: string }) => item.id === unsupported.id);
      expect(locked.action).toBeNull(); expect(locked).not.toHaveProperty('resetPolicy');
      expect(result.json.policy).toMatchObject({ serviceTimezone: 'Asia/Seoul', cashLike: false, pointsTransferable: false });
    }
    expect(await footprint()).toEqual(before);
  });

  it('real optional/required JWT and service body validation deny invalid requests without mutation', async () => {
    const f = await fixture(), row = await mission(), before = await footprint();
    for (const token of [null, 'synthetic-invalid-jwt', f.inactiveToken]) {
      const denied = await post(row.id, token); expect(denied.status).toBe(401);
      expect(denied.json.error.code).toBe('AUTH_REQUIRED');
      const list = await call('GET', homePath, token); assertPrivate(list);
      expect(list.status).toBe(token === null ? 200 : 401);
    }
    // This controller uses Record bodies, not class DTOs: the real pipe is installed, service validates these fields.
    for (const body of [[], { action: false }, { action: 'not-complete' }, { sourceId: 'not-a-uuid' }, { idempotencyKey: {} }]) {
      expect((await call('POST', `${missionPath}/${row.id}/participations`, f.ownerToken, body)).status).toBe(400);
    }
    expect((await post('not-a-uuid', f.ownerToken)).status).toBe(400);
    expect(await footprint()).toEqual(before);
  });

  it('accepted source-free HTTP creates exactly one participation and one five-point noncash ledger', async () => {
    const f = await fixture(), row = await mission();
    const accepted = await post(row.id, f.ownerToken);
    expect(accepted.status).toBe(201); expect(accepted.json.idempotentReplay).toBe(false);
    expect(accepted.json.participation).toMatchObject({ missionId: row.id, status: 'accepted', moderationStatus: 'not_required' });
    expect(accepted.json.rewards.pointsGranted).toBe(5); assertNonCash(accepted.json.rewards);
    await assertAward(f.owner.id, row.id);
    const other = await call('GET', homePath, f.otherToken);
    expect(other.json.items[0].participation).toMatchObject({ status: 'not_started', remainingCount: 1 });
    expect(await counts(db, f.other.id, row.id)).toEqual({ participations: 0, ledgers: 0, points: 0 });
  });

  it('same-key replay awards zero; different key, cross-mission key and changed body preserve the first rows', async () => {
    const f = await fixture(), row = await mission(), other = await mission(), key = randomUUID();
    const accepted = await post(row.id, f.ownerToken, key), before = await footprint();
    expect(accepted.status).toBe(201);
    const replay = await post(row.id, f.ownerToken, key);
    expect(replay.status).toBe(201); expect(replay.json.idempotentReplay).toBe(true);
    expect(replay.json.participation.id).toBe(accepted.json.participation.id);
    expect(replay.json.rewards.pointsGranted).toBe(0); assertNonCash(replay.json.rewards);
    const duplicate = await post(row.id, f.ownerToken);
    expect(duplicate.status).toBe(400); expect(duplicate.json.error.code).toBe('ALREADY_PARTICIPATED');
    const reused = await post(other.id, f.ownerToken, key);
    expect(reused.status).toBe(400); expect(reused.json.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const mismatch = await post(row.id, f.ownerToken, key, { sourceType: 'synthetic-changed-source' });
    expect(mismatch.status).toBe(400); expect(mismatch.json.error.code).toBe('IDEMPOTENCY_BODY_MISMATCH');
    expect(await footprint()).toEqual(before); await assertAward(f.owner.id, row.id);
  });

  it('unsupported discriminator, linked target, noncanonical reset and closed missions cannot use generic POST', async () => {
    const f = await fixture();
    for (const data of [{ missionType: 'fan_proposal' }, { actionType: 'concept_vote' },
      { actionTargetId: randomUUID() }, { resetPolicy: 'weekly' }, { resetPolicy: 'daily:extra' }, { status: 'closed' }]) {
      const row = await mission(data), before = await footprint();
      const denied = await post(row.id, f.ownerToken); expect(denied.status).toBe(400);
      expect(denied.json.error.code).toBe(data.status === 'closed' ? 'MISSION_NOT_ACTIVE' : 'MISSION_REQUIRES_VERIFIED_ACTIVITY');
      expect(await footprint()).toEqual(before);
      expect(await counts(db, f.owner.id, row.id)).toEqual({ participations: 0, ledgers: 0, points: 0 });
    }
  });

  it('two overlapping real transaction CREATE attempts produce exactly one participation and one ledger', async () => {
    const f = await fixture(), row = await mission();
    let release!: () => void, fail!: (error: Error) => void, timer: ReturnType<typeof setTimeout> | undefined;
    const ready = new Promise<void>((resolve, reject) => { release = resolve; fail = reject; });
    const gate: Barrier = { arrivals: 0,
      arrive() {
        gate.arrivals++;
        if (gate.arrivals === 1) timer = setTimeout(() => fail(new Error('Synthetic concurrency boundary not reached')), 2000);
        if (gate.arrivals === 2) { clearTimeout(timer); release(); }
        return ready;
      },
      close() { clearTimeout(timer); release(); },
    };
    barrier = gate;
    const requests = [post(row.id, f.ownerToken), post(row.id, f.ownerToken)];
    try {
      const results = await Promise.all(requests);
      expect(gate.arrivals).toBe(2); expect(results.map(result => result.status).sort()).toEqual([201, 400]);
      expect(results.find(result => result.status === 400)!.json.error.code).toBe('ALREADY_PARTICIPATED');
      await assertAward(f.owner.id, row.id);
    } finally { gate.close(); barrier = null; await Promise.allSettled(requests); }
  });

  it('SQL KST yesterday permits a new daily intent today, while once and yesterday-key replay award nothing new', async () => {
    const f = await fixture(), daily = await mission(), once = await mission({ resetPolicy: 'once' });
    const clock = await db.$queryRaw<Array<{ today: string; yesterday: string; prior: Date }>>`
      SELECT (current_timestamp AT TIME ZONE 'Asia/Seoul')::date::text AS today,
        ((current_timestamp AT TIME ZONE 'Asia/Seoul')::date - 1)::text AS yesterday,
        current_timestamp - interval '1 day' AS prior
    `;
    const yesterdayKey = randomUUID();
    for (const row of [daily, once]) {
      const old = await db.fanMissionParticipation.create({ data: { missionId: row.id, userId: f.owner.id,
        participationType: 'daily_signal', resetBucket: row.id === once.id ? 'once' : clock[0].yesterday,
        idempotencyKey: row.id === daily.id ? yesterdayKey : randomUUID(), createdAt: clock[0].prior } });
      await db.fanEngagementPointLedger.create({ data: { userId: f.owner.id, points: 5, direction: 'earn',
        ledgerType: 'mission_reward', referenceType: 'fan_mission_participation', referenceId: old.id,
        metadata: { cashLike: false, luminaAmount: 0, settlementEligible: false, transferable: false }, createdAt: clock[0].prior } });
    }
    const before = await footprint(), list = await call('GET', homePath, f.ownerToken);
    expect(list.json.items.find((item: { id: string }) => item.id === daily.id).participation)
      .toMatchObject({ status: 'not_started', remainingCount: 1 });
    expect(list.json.items.find((item: { id: string }) => item.id === once.id).participation)
      .toMatchObject({ status: 'accepted', remainingCount: 0 });
    const replay = await post(daily.id, f.ownerToken, yesterdayKey);
    expect(replay.status).toBe(201); expect(replay.json.idempotentReplay).toBe(true); expect(replay.json.rewards.pointsGranted).toBe(0);
    const onceDenied = await post(once.id, f.ownerToken);
    expect(onceDenied.status).toBe(400); expect(onceDenied.json.error.code).toBe('ALREADY_PARTICIPATED');
    expect(await footprint()).toEqual(before);
    const accepted = await post(daily.id, f.ownerToken);
    expect(accepted.status).toBe(201); expect(accepted.json.rewards.pointsGranted).toBe(5);
    const buckets = await db.fanMissionParticipation.findMany({ where: { userId: f.owner.id, missionId: daily.id }, select: { resetBucket: true } });
    expect(buckets.map(row => row.resetBucket).sort()).toEqual([clock[0].yesterday, clock[0].today].sort());
    expect(await counts(db, f.owner.id, daily.id)).toEqual({ participations: 2, ledgers: 3, points: 15 });
    const end = await db.$queryRaw<Array<{ today: string }>>`
      SELECT (current_timestamp AT TIME ZONE 'Asia/Seoul')::date::text AS today
    `;
    expect(end[0].today).toBe(clock[0].today);
  });

  it('failure after actual ledger CREATE rolls back both SQL rows and does not consume the intent key', async () => {
    const f = await fixture(), row = await mission(), key = randomUUID(), before = await footprint();
    ledgerFailure = { userId: f.owner.id, missionId: row.id };
    const failed = await post(row.id, f.ownerToken, key);
    expect(failed.status).toBe(500); expect(failed.json.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(failed.json)).not.toContain('SYNTHETIC_LEDGER_CREATE_FAILURE');
    expect(injectedCreates).toBe(1); expect(rollbackVisible).toEqual({ participations: 1, ledgers: 1, points: 5 });
    expect(await counts(db, f.owner.id, row.id)).toEqual({ participations: 0, ledgers: 0, points: 0 });
    expect(await footprint()).toEqual(before);
    const retry = await post(row.id, f.ownerToken, key);
    expect(retry.status).toBe(201); expect(retry.json.idempotentReplay).toBe(false);
    await assertAward(f.owner.id, row.id);
  });
});
