import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { request } from 'http';
import { AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { PrismaService } from '../prisma/prisma.service';
import { StoryProductionController } from './story-production.controller';
import { StoryProductionService } from './story-production.service';
import { StoryProgressControlService } from './story-progress-control.service';
import { semanticConfig, semanticPinHash, semanticPins } from './story-semantic-analysis.config';
import { SemanticAnalysisProvider } from './story-semantic-analysis.provider';
import { SemanticAnalysisRepository } from './story-semantic-analysis.repository';
import { SemanticAnalysisService } from './story-semantic-analysis.service';
import { semanticTestConfig } from './story-semantic-analysis.test-fixture';

const url = process.env.STORY_DISCOVERY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;

// Real JWT/DTO/filter and database, focused controller module (not full AppModule).
postgres('Owned analysis discovery HTTP (isolated PG, providers disabled)', () => {
  jest.setTimeout(30000);
  let db: PrismaClient, app: INestApplication, port: number;
  let owner: string, other: string, work: string, foreignWork: string;
  let manuscripts: Array<{ id: string; version: number }>;
  let foreignManuscript: string, semanticId: string, foreignJob: string, otherOwnedJob: string;
  let ownerToken: string, otherToken: string;
  let provider: SemanticAnalysisProvider, transport: jest.Mock, readiness: jest.SpyInstance;

  beforeAll(async () => {
    const target = new URL(url!);
    if (target.hostname !== '127.0.0.1' || target.port !== '55432' ||
        target.pathname !== '/lumina_analysis_discovery_qa' || target.username !== 'lumina_qa')
      throw new Error('Dedicated discovery QA database required');
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    await db.$connect();
    const current = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (current[0]?.name !== 'lumina_analysis_discovery_qa') throw new Error('Dedicated discovery QA database required');
    owner = (await db.user.create({ data: {} })).id;
    other = (await db.user.create({ data: {} })).id;
    work = (await db.storyWork.create({ data: { ownerUserId: owner, slug: `discovery-${randomUUID()}`,
      title: { ko: 'Synthetic discovery' }, summary: {} } })).id;
    foreignWork = (await db.storyWork.create({ data: { ownerUserId: other, slug: `discovery-${randomUUID()}`,
      title: {}, summary: {} } })).id;
    manuscripts = [];
    for (let version = 1; version <= 14; version++) {
      manuscripts.push(await db.storyManuscriptVersion.create({ data: { workId: work, ownerUserId: owner,
        version, locale: 'ko', contentHash: version.toString(16).padStart(64, '0'),
        structuredBody: { privateSyntheticSentinel: 'must never appear in discovery' } }, select: { id: true, version: true } }));
    }
    foreignManuscript = (await db.storyManuscriptVersion.create({ data: { workId: foreignWork, ownerUserId: other,
      version: 1, locale: 'ko', contentHash: 'f'.repeat(64), structuredBody: {} } })).id;
    foreignJob = (await db.storyAnalysisJob.create({ data: { workId: foreignWork,
      manuscriptVersionId: foreignManuscript, analysisVersion: 1, idempotencyKey: randomUUID(), status: 'completed' } })).id;
    for (let analysisVersion = 1; analysisVersion <= 14; analysisVersion++) {
      await db.storyAnalysisJob.create({ data: { workId: work, manuscriptVersionId: manuscripts[0].id,
        analysisVersion, idempotencyKey: randomUUID(), status: 'completed', pipeline: 'structural_legacy',
        actorUserId: null, result: { privateSyntheticSentinel: 'not a metadata field' } },
        select: { id: true } });
    }
    otherOwnedJob = (await db.storyAnalysisJob.create({ data: { workId: work,
      manuscriptVersionId: manuscripts[2].id, analysisVersion: 1, idempotencyKey: randomUUID(), status: 'completed' } })).id;
    const cardId = randomUUID(), config = semanticTestConfig({ rateCardId: cardId, rateCardVersion: `discovery-${cardId}` });
    await db.storyAiRateCard.create({ data: { id: cardId, provider: config.provider, model: config.model,
      version: config.rateCardVersion, inputCostPerMillion: config.inputKrwPerMillion,
      cachedInputCostPerMillion: config.cachedInputKrwPerMillion, outputCostPerMillion: config.outputKrwPerMillion,
      status: 'active', createdByUserId: owner } });
    const pins = semanticPins(config);
    semanticId = (await db.storyAnalysisJob.create({ data: { workId: work, manuscriptVersionId: manuscripts[0].id,
      analysisVersion: 15, idempotencyKey: randomUUID(), pipeline: 'semantic_extraction_v1', actorUserId: owner,
      status: 'failed', phase: 'extracting', sourceLocale: 'ko', sourceContentHash: '1'.padStart(64, '0'),
      sourceDigest: 'a'.repeat(64), configPins: pins, configHash: semanticPinHash(pins), rateCardId: cardId,
      errorCode: 'provider_outcome_unknown', reservedCostKrw: 1, actualCostKrw: null,
      totalParts: 1, totalParagraphs: 3, plannedParagraphs: 3, plannedChunks: 1 } })).id;

    transport = jest.fn(() => { throw new Error('No external provider transport allowed'); });
    provider = new SemanticAnalysisProvider(semanticConfig({}), transport);
    readiness = jest.spyOn(provider, 'readiness');
    const semantic = new SemanticAnalysisService(new SemanticAnalysisRepository(db as never), provider);
    const stories = new StoryProductionService(db as never, undefined, undefined, undefined, semantic);
    const jwt = new JwtService(), secret = randomUUID();
    ownerToken = await jwt.signAsync({ sub: owner, tokenType: 'access' }, { secret, expiresIn: '5m' });
    otherToken = await jwt.signAsync({ sub: other, tokenType: 'access' }, { secret, expiresIn: '5m' });
    const module = await Test.createTestingModule({ controllers: [StoryProductionController], providers: [
      { provide: StoryProductionService, useValue: stories }, { provide: StoryProgressControlService, useValue: {} },
      { provide: PrismaService, useValue: db }, { provide: JwtService, useValue: jwt },
      { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) }, JwtAuthGuard,
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app);
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  afterEach(() => { expect(transport).not.toHaveBeenCalled(); readiness?.mockClear(); });
  afterAll(async () => { await app?.close(); await db?.$disconnect(); jest.restoreAllMocks(); });

  function call(path: string, token: string | null = ownerToken, method = 'GET') {
    return new Promise<{ status: number; cache?: string; json: any }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, method, path: `/api/v1/me/creator-studio/${path}`,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}) } }, res => {
        const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try { resolve({ status: res.statusCode!, cache: res.headers['cache-control'], json: JSON.parse(Buffer.concat(chunks).toString()) }); }
          catch (error) { reject(error); }
        });
      });
      req.setTimeout(10000, () => req.destroy(new Error('Loopback HTTP timeout')));
      req.on('error', reject); req.end();
    });
  }

  it('enforces the real JWT guard and private ownership for both new GETs', async () => {
    for (const path of [`stories/${work}/manuscripts`, `manuscripts/${manuscripts[0].id}/analyses`]) {
      expect((await call(path, null)).status).toBe(401);
      expect((await call(path, 'invalid')).status).toBe(401);
      const denied = await call(path, otherToken);
      expect(denied.status).toBe(404); expect(denied.json.error.details).toBeUndefined();
    }
    expect(readiness).not.toHaveBeenCalled();
  });

  it('lists all manuscript versions across default12 pages without loading body JSON', async () => {
    const first = await call(`stories/${work}/manuscripts`);
    expect(first.status).toBe(200); expect(first.json.items).toHaveLength(12); expect(first.json.hasMore).toBe(true);
    expect(first.cache).toBe('private, no-store');
    expect(Object.keys(first.json.items[0]).sort()).toEqual(['id','workId','version','locale','contentHash','createdAt'].sort());
    const next = await call(`stories/${work}/manuscripts?cursor=${first.json.nextCursor}`);
    expect(next.json.hasMore).toBe(false); expect(next.json.nextCursor).toBeNull();
    expect([...first.json.items, ...next.json.items].map(row => row.version)).toEqual(Array.from({ length: 14 }, (_, i) => 14 - i));
    expect(readiness).not.toHaveBeenCalled();
  });

  it('returns job metadata including legacy-null actors and unknown failed run, never author approval', async () => {
    const path = `manuscripts/${manuscripts[0].id}/analyses`;
    const before = await db.storyAnalysisJob.findUniqueOrThrow({ where: { id: semanticId } });
    const first = await call(path);
    expect(first.status).toBe(200); expect(first.json.items).toHaveLength(12);
    expect(first.cache).toBe('private, no-store');
    expect(first.json.items[0]).toMatchObject({ id: semanticId, status: 'failed', kind: 'semantic_extraction_v1',
      errorCode: 'provider_outcome_unknown', semanticCompleted: false, approval: 'not_approved', memoryApproved: false });
    expect(first.json.items[1]).toMatchObject({ kind: 'structural_legacy', status: 'completed', semanticCompleted: false,
      sourceLocale: null, approval: 'not_approved' });
    const next = await call(`${path}?cursor=${first.json.nextCursor}`);
    expect(next.json.hasMore).toBe(false); expect(next.json.nextCursor).toBeNull();
    expect([...first.json.items, ...next.json.items].map(row => row.analysisVersion))
      .toEqual(Array.from({ length: 15 }, (_, i) => 15 - i));
    expect(JSON.stringify(first.json)).not.toMatch(/privateSyntheticSentinel|structuredBody|configPins|idempotencyKey|leaseToken|sourceDigest|"result"/);
    const after = await db.storyAnalysisJob.findUniqueOrThrow({ where: { id: semanticId } });
    expect(after).toEqual(before); expect(after.actualCostKrw).toBeNull(); expect(after.reservedCostKrw.toString()).toBe('1');
    expect(readiness).not.toHaveBeenCalled();
  });

  it('rejects cross-work/version and unknown cursors without leaking job ids', async () => {
    for (const cursor of [foreignManuscript, randomUUID()]) {
      const result = await call(`stories/${work}/manuscripts?cursor=${cursor}`);
      expect(result.status).toBe(400); expect(result.json.error.code).toBe('ANALYSIS_DISCOVERY_CURSOR_INVALID');
    }
    for (const cursor of [foreignJob, otherOwnedJob, randomUUID()]) {
      const result = await call(`manuscripts/${manuscripts[0].id}/analyses?cursor=${cursor}`);
      expect(result.status).toBe(400); expect(result.json.error.details).toBeUndefined();
    }
  });

  it('applies actual DTO/UUID bounds and leaves the existing catalog/detail shapes intact', async () => {
    for (const query of ['limit=0','limit=31','limit=1.5','limit=no','cursor=no','unexpected=true']) {
      expect((await call(`stories/${work}/manuscripts?${query}`)).status).toBe(400);
      expect((await call(`manuscripts/${manuscripts[0].id}/analyses?${query}`)).status).toBe(400);
    }
    expect((await call('stories/not-uuid/manuscripts')).status).toBe(400);
    expect((await call('manuscripts/not-uuid/analyses')).status).toBe(400);
    expect((await call(`stories/${work}/manuscripts?limit=30`)).json.items).toHaveLength(14);
    const catalog = await call('stories'); expect(catalog.status).toBe(200);
    expect(catalog.json.items.some((item: { workId: string }) => item.workId === work)).toBe(true);
    const detail = await call(`analyses/${semanticId}`); expect(detail.status).toBe(200);
    expect(detail.json.job.id).toBe(semanticId); expect(detail.json.evidence).toEqual([]);
    expect(detail.json.review).toMatchObject({ fullyReviewed: false, publicationApproved: false, memoryApproved: false });
    expect(readiness).not.toHaveBeenCalled();
  });

  it('exposes owned reserved analysis id in real409 error.details even while provider is disabled', async () => {
    const before = await db.storyAnalysisJob.count({ where: { workId: work } });
    const response = await call(`manuscripts/${manuscripts[0].id}/analyses`, ownerToken, 'POST');
    expect(response.status).toBe(409);
    expect(response.json.error).toMatchObject({ code: 'ANALYSIS_VERSION_ALREADY_RESERVED', details: { analysisJobId: semanticId } });
    const denied = await call(`manuscripts/${manuscripts[0].id}/analyses`, otherToken, 'POST');
    expect(denied.status).toBe(404); expect(denied.json.error.details).toBeUndefined();
    expect(await db.storyAnalysisJob.count({ where: { workId: work } })).toBe(before);
  });

  it('returns empty analysis metadata without implicitly creating or resuming a job', async () => {
    const id = manuscripts[1].id;
    expect((await call(`manuscripts/${id}/analyses`)).json).toEqual({ manuscriptVersionId: id,
      items: [], hasMore: false, nextCursor: null });
    expect(await db.storyAnalysisJob.count({ where: { manuscriptVersionId: id } })).toBe(0);
    expect(readiness).not.toHaveBeenCalled();
  });
});
