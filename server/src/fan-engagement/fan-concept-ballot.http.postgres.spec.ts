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
type HttpResult = { status: number; json: any; cache: string | undefined; vary: string | undefined };
type Totals = { ballots: number; participations: number; ledgers: number; points: number };
jest.setTimeout(30000);

// Fresh retained synthetic rows, real guards/SQL, scoped controller only. No AppModule or provider.
postgres('Concept ballot HTTP on owned PostgreSQL, SDK174 and migrations103', () => {
  let db: PrismaClient, app: INestApplication, port: number, jwt: JwtService, secret: string;
  let beforeWrite: (() => Promise<void>) | null = null;
  let failLedgerFor: string | null = null;
  let insertedBeforeRollback: Totals | null = null;
  let barrier: { arrive(): Promise<void>; close(): void } | null = null;
  let admitted = false;
  const caseUsers = new Set<string>(), caseVotes = new Set<string>(), caseMissions = new Set<string>();
  const retained: Array<{ users: string[]; votes: string[]; missions: string[]; footprint: unknown }> = [];

  async function totals(client: PrismaClient | Prisma.TransactionClient, userId: string) {
    const rows = await client.$queryRaw<Totals[]>`SELECT
      (SELECT count(*)::int FROM public.concept_vote_ballots WHERE user_id = ${userId}::uuid) AS ballots,
      (SELECT count(*)::int FROM public.fan_mission_participations WHERE user_id = ${userId}::uuid) AS participations,
      (SELECT count(*)::int FROM public.fan_engagement_point_ledger WHERE user_id = ${userId}::uuid) AS ledgers,
      (SELECT coalesce(sum(points),0)::int FROM public.fan_engagement_point_ledger WHERE user_id = ${userId}::uuid) AS points`;
    expect(rows).toHaveLength(1); return rows[0];
  }
  async function footprint(users = [...caseUsers], votes = [...caseVotes], missions = [...caseMissions]) {
    return {
      users: await db.user.findMany({ where: { id: { in: users } }, orderBy: { id: 'asc' } }),
      votes: await db.conceptVote.findMany({ where: { id: { in: votes } }, orderBy: { id: 'asc' } }),
      options: await db.conceptVoteOption.findMany({ where: { voteId: { in: votes } }, orderBy: { id: 'asc' } }),
      missions: await db.fanMission.findMany({ where: { id: { in: missions } }, orderBy: { id: 'asc' } }),
      ballots: await db.conceptVoteBallot.findMany({ where: { userId: { in: users } }, orderBy: { id: 'asc' } }),
      participations: await db.fanMissionParticipation.findMany({ where: { userId: { in: users } }, orderBy: { id: 'asc' } }),
      ledgers: await db.fanEngagementPointLedger.findMany({ where: { userId: { in: users } }, orderBy: { id: 'asc' } }),
    };
  }
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
      parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash ||
      !/^\/lumina_body_length_qa_[a-f0-9]{12}$/.test(parsed.pathname)) throw new Error('Fresh owned loopback database required');
    expect(Prisma.dmmf.datamodel.models.length).toBe(174);
    db = new PrismaClient({ datasources: { db: { url } } }); await db.$connect();
    const identity = await db.$queryRaw<Array<{ database: string; role: string }>>`
      SELECT current_database() AS database, current_user AS role`;
    expect(identity).toEqual([{ database: parsed.pathname.slice(1), role: 'lumina_qa' }]);
    const migrations = await db.$queryRaw<Array<{ total: number; applied: number }>>`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied FROM public._prisma_migrations`;
    expect(migrations).toEqual([{ total: 103, applied: 103 }]);
    for (const count of [await db.user.count(), await db.conceptVote.count(), await db.conceptVoteBallot.count(),
      await db.fanMission.count(), await db.fanMissionParticipation.count(), await db.fanEngagementPointLedger.count()]) expect(count).toBe(0);
    admitted = true;
    const observed = new Proxy(db, { get(target, field) {
      if (field === '$transaction') return async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        const hook = beforeWrite; beforeWrite = null; if (hook) await hook();
        return target.$transaction(async tx => callback(new Proxy(tx, { get(transaction, modelName) {
          const delegate = Reflect.get(transaction, modelName);
          if (modelName === 'conceptVoteBallot' || modelName === 'fanEngagementPointLedger') {
            return new Proxy(delegate, { get(model, method) {
              const original = Reflect.get(model, method);
              if (method === 'create') return async (...args: unknown[]) => {
                if (modelName === 'conceptVoteBallot' && barrier) await barrier.arrive();
                const created = await Reflect.apply(original, model, args);
                if (modelName === 'fanEngagementPointLedger' && failLedgerFor && created && typeof created === 'object' &&
                  'userId' in created && created.userId === failLedgerFor) {
                  const userId = failLedgerFor; failLedgerFor = null;
                  insertedBeforeRollback = await totals(tx, userId);
                  throw new Error('SYNTHETIC_BALLOT_LEDGER_FAILURE');
                }
                return created;
              };
              return typeof original === 'function' ? original.bind(model) : original;
            } });
          }
          return typeof delegate === 'function' ? delegate.bind(transaction) : delegate;
        } })));
      };
      const value = Reflect.get(target, field); return typeof value === 'function' ? value.bind(target) : value;
    } });
    jwt = new JwtService(); secret = randomUUID() + randomUUID();
    const module = await Test.createTestingModule({ controllers: [FanEngagementController], providers: [
      { provide: PrismaService, useValue: observed }, { provide: JwtService, useValue: jwt },
      { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
      FanEngagementService, JwtAuthGuard, OptionalJwtAuthGuard, FanEngagementJwtAuthGuard,
    ] }).compile();
    app = module.createNestApplication({ logger: false }); app.use(fanEngagementPrivacyMiddleware);
    configureHttpRouting(app);
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true,
      forbidUnknownValues: true, exceptionFactory: createValidationException }));
    app.useGlobalFilters(new HttpExceptionFilter()); await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo; expect(address.address).toBe('127.0.0.1'); port = address.port;
  });
  beforeEach(() => { caseUsers.clear(); caseVotes.clear(); caseMissions.clear(); beforeWrite = null; failLedgerFor = null; insertedBeforeRollback = null; });
  afterEach(async () => {
    barrier?.close(); barrier = null; beforeWrite = null; failLedgerFor = null;
    if (admitted) retained.push({ users: [...caseUsers], votes: [...caseVotes], missions: [...caseMissions], footprint: await footprint() });
  });
  afterAll(async () => {
    try { await app?.close();
      if (admitted) for (const r of retained) expect(await footprint(r.users, r.votes, r.missions)).toEqual(r.footprint);
    } finally { await db?.$disconnect(); }
  });
  async function fixture() {
    const owner = await db.user.create({ data: { status: 'active' } }), other = await db.user.create({ data: { status: 'active' } });
    caseUsers.add(owner.id); caseUsers.add(other.id);
    const artist = await db.artist.create({ data: { slug: 'synthetic-ballot-' + randomUUID(), displayName: 'Synthetic ballot artist' } });
    const vote = await db.conceptVote.create({ data: { artistId: artist.id, status: 'active', visibility: 'public',
      copy: { labels: { ko: { title: 'Synthetic public vote' } } } } }); caseVotes.add(vote.id);
    const option = await db.conceptVoteOption.create({ data: { voteId: vote.id, optionKey: 'one', sortOrder: 2,
      copy: { labels: { ko: { label: 'Synthetic option one' } } } } });
    const alternative = await db.conceptVoteOption.create({ data: { voteId: vote.id, optionKey: 'two', sortOrder: 1,
      copy: { labels: { ko: { label: 'Synthetic option two' } } } } });
    const mission = await db.fanMission.create({ data: { slug: 'synthetic-ballot-mission-' + randomUUID(), artistId: artist.id,
      missionType: 'vote_concept', actionType: 'concept_vote', actionTargetId: vote.id, status: 'active',
      surfaces: ['home'], resetPolicy: 'once', rewardPolicy: { points: 5 },
      copy: { labels: { ko: { title: 'Synthetic linked mission' } } } } }); caseMissions.add(mission.id);
    const token = (id: string) => jwt.signAsync({ sub: id, tokenType: 'access' }, { secret, expiresIn: '5m' });
    return { owner, other, artist, vote, option, alternative, mission, ownerToken: await token(owner.id), otherToken: await token(other.id) };
  }
  function call(method: 'GET' | 'POST', path: string, token: string | null, body?: unknown): Promise<HttpResult> {
    if (!/^\/api\/v1\/fan-engagement\/(?:missions|concept-votes)(?:\?|\/|$)/.test(path)) throw new Error('Scoped fan path required');
    return new Promise((resolve, reject) => {
      const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      let timer: ReturnType<typeof setTimeout>;
      const req = request({ hostname: '127.0.0.1', port, method, path, headers: { accept: 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}), ...(bytes ? { 'content-type': 'application/json', 'content-length': String(bytes.length) } : {}) } }, res => {
        const chunks: Buffer[] = []; let count = 0;
        res.on('data', (b: Buffer) => { count += b.length; if (count > 262144) req.destroy(new Error('Bounded response required')); else chunks.push(b); });
        res.on('error', () => { clearTimeout(timer); reject(new Error('Scoped response failed')); });
        res.on('end', () => { clearTimeout(timer); try { resolve({ status: res.statusCode!, json: JSON.parse(Buffer.concat(chunks).toString()),
          cache: res.headers['cache-control'], vary: res.headers.vary }); } catch { reject(new Error('Scoped JSON required')); } });
      });
      timer = setTimeout(() => req.destroy(new Error('Scoped HTTP deadline')), 15000);
      req.on('error', () => { clearTimeout(timer); reject(new Error('Scoped HTTP failed')); }); req.end(bytes);
    });
  }
  const post = (f: Awaited<ReturnType<typeof fixture>>, key = randomUUID(), overrides: Record<string, unknown> = {}, token = f.ownerToken) =>
    call('POST', `/api/v1/fan-engagement/concept-votes/${f.vote.id}/ballots`, token,
      { optionId: f.option.id, missionId: f.mission.id, idempotencyKey: key, ...overrides });
  const voteRead = (f: Awaited<ReturnType<typeof fixture>>, token: string | null) => call('GET',
    `/api/v1/fan-engagement/concept-votes?status=active&artistId=${f.artist.id}&locale=ko&take=20`, token);
  function privateRead(r: HttpResult) { expect(r.cache).toBe('private, no-store');
    expect(r.vary?.split(',').map(v => v.trim().toLowerCase())).toContain('authorization'); }
  function code(r: HttpResult) { return r.json.error?.code ?? r.json.code; }

  it('persists the selected real option and confirms the same owner through separate vote and mission reads', async () => {
    const f = await fixture(); const initial = await voteRead(f, null); privateRead(initial);
    expect(initial.json.items[0].options.map((o: any) => o.id)).toEqual([f.alternative.id, f.option.id]);
    expect(initial.json.items[0].viewer).toEqual({ hasVoted: false, selectedOptionId: null });
    const accepted = await post(f); expect(accepted.status).toBe(201);
    expect(accepted.json).toMatchObject({ ballot: { voteId: f.vote.id, optionId: f.option.id },
      viewer: { hasVoted: true, selectedOptionId: f.option.id }, missionParticipation: { missionId: f.mission.id, status: 'accepted' },
      rewards: { pointsGranted: 5, cashLike: false, luminaAmount: 0 }, idempotentReplay: false });
    const owned = await voteRead(f, f.ownerToken), other = await voteRead(f, f.otherToken); privateRead(owned); privateRead(other);
    expect(owned.json.items[0].viewer).toEqual({ hasVoted: true, selectedOptionId: f.option.id });
    expect(other.json.items[0].viewer).toEqual({ hasVoted: false, selectedOptionId: null });
    const missions = await call('GET', `/api/v1/fan-engagement/missions?surface=home&scope=today&artistId=${f.artist.id}&locale=ko&take=20`, f.ownerToken);
    expect(missions.json.items.find((m: any) => m.id === f.mission.id).participation.status).toBe('accepted');
    expect(owned.json.items[0].mission.participationStatus).toBe('not_started');
    expect(await totals(db, f.owner.id)).toEqual({ ballots: 1, participations: 1, ledgers: 1, points: 5 });
    expect(await totals(db, f.other.id)).toEqual({ ballots: 0, participations: 0, ledgers: 0, points: 0 });
  });

  it('replays an unchanged lost-response request, rejects changed tuples and preserves all stored rows', async () => {
    const f = await fixture(), key = randomUUID(); expect((await post(f, key)).status).toBe(201);
    const before = await footprint(); const replay = await post(f, key);
    expect(replay.status).toBe(201); expect(replay.json).toMatchObject({ idempotentReplay: true, missionParticipation: null, rewards: { pointsGranted: 0 } });
    for (const change of [{ optionId: f.alternative.id }, { missionId: null }]) {
      const rejected = await post(f, key, change); expect(rejected.status).toBe(400); expect(code(rejected)).toBe('IDEMPOTENCY_BODY_MISMATCH');
    }
    const denied = await post(f, randomUUID(), {}, 'synthetic-invalid'); expect(denied.status).toBe(401);
    expect(await footprint()).toEqual(before);
  });

  it('allows at most one concurrent same-user ballot and one linked point grant', async () => {
    const f = await fixture(); let arrivals = 0, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    barrier = { arrive: async () => { if (++arrivals === 2) release(); await gate; }, close: release };
    const [a, b] = await Promise.all([post(f), post(f)]); barrier.close(); barrier = null;
    expect(arrivals).toBe(2); expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect(code(a.status === 400 ? a : b)).toBe('ALREADY_VOTED');
    expect(await totals(db, f.owner.id)).toEqual({ ballots: 1, participations: 1, ledgers: 1, points: 5 });
  });

  it('rechecks real withdrawal or relinking committed between preflight and transaction entry', async () => {
    for (const change of ['private-vote', 'closed-mission', 'relinked-mission', 'moved-option'] as const) {
      const f = await fixture();
      if (change === 'private-vote') beforeWrite = async () => { await db.conceptVote.update({ where: { id: f.vote.id }, data: { visibility: 'private' } }); };
      if (change === 'closed-mission') beforeWrite = async () => { await db.fanMission.update({ where: { id: f.mission.id }, data: { status: 'closed' } }); };
      if (change === 'relinked-mission') beforeWrite = async () => { await db.fanMission.update({ where: { id: f.mission.id }, data: { actionTargetId: randomUUID() } }); };
      if (change === 'moved-option') {
        const otherVote = await db.conceptVote.create({ data: { artistId: f.artist.id, status: 'active', visibility: 'public' } }); caseVotes.add(otherVote.id);
        beforeWrite = async () => { await db.conceptVoteOption.update({ where: { id: f.option.id }, data: { voteId: otherVote.id } }); };
      }
      const result = await post(f); expect(result.status).toBe(400);
      expect(code(result)).toBe(({ 'private-vote': 'VOTE_NOT_ACTIVE', 'closed-mission': 'MISSION_NOT_ACTIVE',
        'relinked-mission': 'MISSION_NOT_LINKED_TO_VOTE', 'moved-option': 'OPTION_NOT_IN_VOTE' })[change]);
      expect(beforeWrite).toBeNull(); expect(await totals(db, f.owner.id)).toEqual({ ballots: 0, participations: 0, ledgers: 0, points: 0 });
    }
  });

  it('rolls back an actual ballot, participation and ledger insert after a later failure', async () => {
    const f = await fixture(), key = randomUUID(); failLedgerFor = f.owner.id;
    const failed = await post(f, key); expect(failed.status).toBe(500);
    expect(insertedBeforeRollback).toEqual({ ballots: 1, participations: 1, ledgers: 1, points: 5 });
    expect(await totals(db, f.owner.id)).toEqual({ ballots: 0, participations: 0, ledgers: 0, points: 0 });
    const manual = await post(f, key); expect(manual.status).toBe(201); expect(manual.json.idempotentReplay).toBe(false);
    expect(await totals(db, f.owner.id)).toEqual({ ballots: 1, participations: 1, ledgers: 1, points: 5 });
  });
});
