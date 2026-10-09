import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { request } from 'http';
import { AddressInfo } from 'net';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { configureHttpRouting } from '../common/http-routing';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { activationFixture } from './story-ai-activation.postgres-fixture';
import { createStoryRouteRoot } from './story-route-identity.store';
import { StoryAuthorBodyTrialCostService } from './story-author-body-trial-cost.service';
import { StoryAuthorBodyTrialService } from './story-author-body-trial.service';
import { StoryAiActivationService } from './story-ai-activation.service';
import { PersistedStoryContinuationLegalActivationGate } from './story-continuation-legal-activation.gate';
import { StoryEconomicsService } from './story-economics.service';
import { StoryProductionService } from './story-production.service';
import { StoryAuthorBodyTrialReceiptService } from './story-author-body-trial-receipt.service';
import { authorBodyTrialReceiptPrivacyMiddleware, StoryAuthorBodyTrialReceiptController, StoryAuthorBodyTrialRecoveryController } from './story-author-body-trial-receipt.controller';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
jest.setTimeout(30000);

postgres('read-only trial receipt recovery (isolated PostgreSQL and real HTTP, no paid providers)', () => {
  let db: PrismaClient;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' ||
        parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash ||
        !/^\/lumina_failed_cost_qa_[a-f0-9]{12}$/.test(parsed.pathname)) throw new Error('Dedicated loopback QA database required');
    db = new PrismaClient({ datasources: { db: { url } } }); await db.$connect();
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function prepared() {
    const f = await activationFixture(db);
    const progress = await db.storyReaderProgress.create({ data: { userId: f.owner.id, workId: f.work.id,
      currentSceneId: f.scene.id, checkpointSceneId: f.scene.id, activeReleaseId: f.release.id,
      aiRateCardId: f.rate.id, capabilityRevision: 1 } });
    const routeNodeId = await createStoryRouteRoot(db, progress, f.scene.id, f.part.actNumber);
    await db.storyReaderProgress.update({ where: { id: progress.id }, data: { routeNodeId } });
    const analysis = await db.storyAnalysisJob.findFirstOrThrow({ where: { workId: f.work.id } });
    const approval = await db.storyAuthorBodyTrialApproval.create({ data: { userId: f.owner.id, workId: f.work.id,
      releaseId: f.release.id, manuscriptVersionId: f.manuscript.id, releaseChecksum: f.release.checksum,
      capabilityRevision: 1, styleConsentId: f.consent.id, styleConsentRevision: f.consent.revision,
      analysisJobId: analysis.id, analysisVersion: analysis.analysisVersion, approvedBudgetKrw: '10000',
      approvalReference: `synthetic-read-receipt:${randomUUID()}`, expiresAt: new Date(Date.now() + 3600000) } });
    const costs = new StoryAuthorBodyTrialCostService(db as never), trial = new StoryAuthorBodyTrialService(costs);
    const legal = new PersistedStoryContinuationLegalActivationGate(new StoryAiActivationService(db as never));
    const provider = { ...f.provider, preflight: jest.fn().mockResolvedValue({ supported: true, inputTokenUpperBound: 100 }) };
    const economics = new StoryEconomicsService(db as never, legal, provider as never, f.approval, undefined, trial);
    const stories = new StoryProductionService(db as never, economics, provider as never, legal,
      undefined, undefined, undefined, undefined, undefined, trial);
    const receipts = new StoryAuthorBodyTrialReceiptService(db as never);
    const key = `synthetic-receipt:${randomUUID()}`;
    const body = { approvalId: approval.id, progressId: progress.id, expectedRevision: 1, locale: 'ko' };
    const choose = (choiceId = f.choice.id) => stories.selectAuthorBodyTrialChoice(f.owner.id, f.work.id, choiceId, body, key);
    const lookup = (scope = body, userId = f.owner.id, suppliedKey = key, choiceId = f.choice.id) =>
      receipts.lookup(userId, f.work.id, choiceId, scope, suppliedKey);
    return { ...f, progress, approval, economics, stories, receipts, provider, key, body, choose, lookup };
  }
  type Fixture = Awaited<ReturnType<typeof prepared>>;
  async function state(f: Fixture) {
    return { progress: await db.storyReaderProgress.findUnique({ where: { id: f.progress.id } }),
      continuations: await db.storyAiContinuation.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } }),
      commands: await db.storyAuthorBodyTrialCommand.findMany({ where: { workId: f.work.id } }),
      ledger: await db.storyAiUsageLedger.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } }),
      allowance: await db.storyAiAllowanceBucket.findMany({ where: { workId: f.work.id }, orderBy: { id: 'asc' } }),
      reviews: await db.$queryRaw`SELECT id FROM story_author_body_reviews WHERE work_id = ${f.work.id}::uuid`,
      routes: await db.storyProgressRouteNode.findMany({ where: { progressId: f.progress.id }, orderBy: { id: 'asc' } }),
      events: await db.storyChoiceEvent.findMany({ where: { progressId: f.progress.id }, orderBy: { id: 'asc' } }),
      audit: await db.auditEvent.findMany({ where: { actorUserId: f.owner.id }, orderBy: { id: 'asc' } }),
      visuals: await db.storyVisualGeneration.count() };
  }

  it.each([
    ['dispatch_lease_insufficient', 'lease_time_insufficient'],
    ['provider_outcome_unknown', 'provider_outcome_unknown'],
    ['continuation_output_underlength', 'narrative_length_rejected'],
    ['provider_malformed_output', 'output_validation_rejected'],
    ['provider_output_token_limit', 'output_limit_reached'],
    ['continuation_invalid_calendar_date', 'quality_rule_rejected'],
    ['participant_missing_from_scene', 'participant_missing'],
    ['provider_content_filtered', 'content_rejected'],
    ['PROVIDER_MALFORMED_OUTPUT', null],
    ['synthetic-private-diagnostic', null],
  ])('safe failure description %s stays read-only and never certifies an unknown cost', async (code, reason) => {
    const f = await prepared(), accepted = await f.choose() as { continuationId: string }, leaseToken = randomUUID();
    await db.storyAiContinuation.update({ where: { id: accepted.continuationId }, data: { status: 'processing',
      leaseToken, leaseOwner: 'synthetic-failure-view', leaseExpiresAt: new Date(Date.now() + 60000), attemptCount: 1 } });
    // No no-send proof is provided: a reason alone must never settle this as free.
    await f.economics.failClaimedContinuation({ continuationId: accepted.continuationId, leaseToken,
      attemptCount: 1, maxAttempts: 1 } as never, code!, 'failed');
    const before = await state(f);
    for (let index = 0; index < 2; index++) {
      const result = await f.lookup();
      expect(result).toMatchObject({ readOnly: true, generationAuthorized: false, generationStarted: false,
        receipt: { failureReason: reason, status: 'failed', internalCostReturned: false, progressApplied: false } });
      expect(result.receipt).not.toHaveProperty('failureCode');
      expect(result.receipt).not.toHaveProperty('actualCostKrw');
      expect(JSON.stringify(result)).not.toContain('synthetic-private-diagnostic');
    }
    await expect(f.lookup(f.body, f.reader.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.lookup({ ...f.body, expectedRevision: 2 })).rejects.toMatchObject({ status: 404 });
    expect(await new StoryAuthorBodyTrialCostService(db as never).current(f.owner.id, f.work.id))
      .toMatchObject({ unknownCostCount: 1, evidenceReadyForBudgetCheck: false });
    expect(await state(f)).toEqual(before);
    expect(before.continuations[0].actualCostKrw).toBeNull();
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('recovers the original locator after client storage loss without mutations or a generation grant', async () => {
    const f = await prepared();
    const absent = await state(f);
    expect(await f.receipts.recover(f.owner.id, f.work.id)).toMatchObject({ command: null, generationAuthorized: false });
    expect(await state(f)).toEqual(absent);
    await f.choose(); const before = await state(f);
    expect(await f.receipts.recover(f.owner.id, f.work.id)).toEqual({
      contract: 'story-author-body-trial-recovery-v1', workId: f.work.id, readOnly: true,
      generationAuthorized: false, generationStarted: false, imageGenerationStarted: false,
      command: { workId: f.work.id, choiceId: f.choice.id, key: f.key, body: f.body } });
    expect(await f.lookup()).toMatchObject({ receipt: { status: 'queued' } });
    expect(await state(f)).toEqual(before); expect(f.provider.generate).not.toHaveBeenCalled();
  });
  it('uses deterministic latest stored command and never falls back after malformed latest evidence', async () => {
    const f = await prepared(); await f.choose();
    const first = await db.storyAuthorBodyTrialCommand.findUniqueOrThrow({ where: { userId_idempotencyKey: {
      userId: f.owner.id, idempotencyKey: f.key } } });
    const lastKey = 'synthetic-latest:' + randomUUID();
    await db.storyAuthorBodyTrialCommand.create({ data: { ...first, idempotencyKey: lastKey,
      createdAt: new Date(first.createdAt.getTime() + 1000), receipt: { contract: 'invalid-synthetic-latest' } } });
    const before = await state(f);
    await expect(f.receipts.recover(f.owner.id, f.work.id)).rejects.toMatchObject({ status: 409 });
    expect(await state(f)).toEqual(before); expect(f.provider.generate).not.toHaveBeenCalled();
  });
  it('does not expose a previous author locator after ownership transfer', async () => {
    const f = await prepared(); await f.choose();
    await expect(f.receipts.recover(f.reader.id, f.work.id)).rejects.toMatchObject({ status: 404 });
    await db.storyWork.update({ where: { id: f.work.id }, data: { ownerUserId: f.reader.id } });
    const before = await state(f);
    await expect(f.receipts.recover(f.owner.id, f.work.id)).rejects.toMatchObject({ status: 404 });
    expect(await f.receipts.recover(f.reader.id, f.work.id)).toMatchObject({ command: null });
    expect(await state(f)).toEqual(before); expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('reads the accepted queue receipt repeatedly without changing reservation, progress, audit or provider state', async () => {
    const f = await prepared(), accepted = await f.choose() as { continuationId: string }, before = await state(f);
    for (let index = 0; index < 3; index++) expect(await f.lookup()).toMatchObject({
      contract: 'story-author-body-trial-receipt-v1', workId: f.work.id, choiceId: f.choice.id,
      approvalId: f.approval.id, progressId: f.progress.id, sourceRevision: 1, locale: 'ko',
      readOnly: true, generationAuthorized: false, generationStarted: false, imageGenerationStarted: false,
      receipt: { continuationId: accepted.continuationId, status: 'queued', idempotentReplay: true } });
    expect(await state(f)).toEqual(before); expect(f.provider.generate).not.toHaveBeenCalled();
  });
  it.each(['revoked', 'expired', 'unpublished', 'release-changed', 'consent-revoked'] as const)
    ('preserves historical read access after %s without extending dispatch permission', async kind => {
      const f = await prepared(); await f.choose();
      if (kind === 'revoked' || kind === 'expired') await db.storyAuthorBodyTrialApproval.update({ where: { id: f.approval.id },
        data: kind === 'revoked' ? { status: 'revoked' } : { expiresAt: new Date(0) } });
      if (kind === 'unpublished') await db.storyWork.update({ where: { id: f.work.id }, data: { status: 'draft' } });
      if (kind === 'release-changed') await db.storyWork.update({ where: { id: f.work.id }, data: { activeReleaseId: null } });
      if (kind === 'consent-revoked') await db.storyStyleProfileConsent.update({ where: { id: f.consent.id }, data: { status: 'revoked' } });
      const before = await state(f);
      expect(await f.lookup()).toMatchObject({ readOnly: true, generationAuthorized: false, receipt: { status: 'queued' } });
      expect(await f.receipts.recover(f.owner.id, f.work.id)).toMatchObject({ generationAuthorized: false,
        command: { key: f.key, body: f.body } });
      await expect(f.choose()).rejects.toBeDefined(); expect(await state(f)).toEqual(before);
      expect(f.provider.generate).not.toHaveBeenCalled();
    });
  it('returns a terminal failure after restoring progress and keeps unknown cost intact', async () => {
    const f = await prepared(), accepted = await f.choose() as { continuationId: string }, leaseToken = randomUUID();
    await db.storyAiContinuation.update({ where: { id: accepted.continuationId }, data: { status: 'processing',
      leaseToken, leaseOwner: 'synthetic-receipt', leaseExpiresAt: new Date(Date.now() + 60000), attemptCount: 1 } });
    await f.economics.failClaimedContinuation({ continuationId: accepted.continuationId, leaseToken, attemptCount: 1, maxAttempts: 1 } as never,
      'provider_outcome_unknown', 'failed');
    await db.storyAuthorBodyTrialApproval.update({ where: { id: f.approval.id }, data: { status: 'revoked' } });
    const before = await state(f);
    expect(before.progress).toMatchObject({ status: 'active', progressRevision: 3 });
    expect(await f.lookup()).toMatchObject({ receipt: { status: 'failed', progressApplied: false,
      resultGeneratedSceneId: null, revisionAfterRequest: 2, internalCostReturned: false } });
    expect(await state(f)).toEqual(before); expect(f.provider.generate).not.toHaveBeenCalled();
    expect(before.continuations[0].actualCostKrw).toBeNull();
  });
  it('does not leak another author or mismatched command scope and does not call provider preflight', async () => {
    const f = await prepared(); await f.choose(); const before = await state(f); f.provider.preflight.mockClear();
    await expect(f.lookup(f.body, f.reader.id)).rejects.toMatchObject({ status: 404 });
    for (const change of [{ approvalId: randomUUID() }, { progressId: randomUUID() }, { expectedRevision: 2 }, { locale: 'en' }]) {
      await expect(f.lookup({ ...f.body, ...change })).rejects.toMatchObject({ status: 404 });
    }
    await expect(f.lookup(f.body, f.owner.id, `absent-receipt:${randomUUID()}`)).rejects.toMatchObject({ status: 404 });
    await expect(f.lookup(f.body, f.owner.id, f.key, randomUUID())).rejects.toMatchObject({ status: 404 });
    expect(await state(f)).toEqual(before); expect(f.provider.preflight).not.toHaveBeenCalled();
    expect(f.provider.generate).not.toHaveBeenCalled();
  });
  it('reads an original ending command without constructing a continuation or overwriting later progress', async () => {
    const f = await prepared();
    const ending = await db.storyChoice.create({ data: { sceneId: f.scene.id, choiceKey: 'original', position: 2,
      label: { ko: 'Synthetic original ending' }, routeKind: 'canonical', targetEndingKey: 'author_main' } });
    await f.choose(ending.id); await db.storyAuthorBodyTrialApproval.update({ where: { id: f.approval.id }, data: { status: 'revoked' } });
    const before = await state(f);
    expect(await f.lookup(f.body, f.owner.id, f.key, ending.id)).toMatchObject({ receipt: { status: 'completed',
      generationStarted: false, progressId: f.progress.id, idempotentReplay: true } });
    expect(await state(f)).toEqual(before); expect(before.continuations).toHaveLength(0);
    expect(f.provider.generate).not.toHaveBeenCalled();
  });
  it('uses real authenticated HTTP: revoked owner can read, foreign/anonymous blocked, malformed/duplicate query rejected privately', async () => {
    const f = await prepared(); await f.choose(); await db.storyAuthorBodyTrialApproval.update({ where: { id: f.approval.id }, data: { status: 'revoked' } });
    const jwt = new JwtService(), secret = randomUUID();
    const ownerToken = await jwt.signAsync({ sub: f.owner.id, tokenType: 'access' }, { secret, expiresIn: '5m' });
    const readerToken = await jwt.signAsync({ sub: f.reader.id, tokenType: 'access' }, { secret, expiresIn: '5m' });
    const module = await Test.createTestingModule({ controllers: [StoryAuthorBodyTrialReceiptController, StoryAuthorBodyTrialRecoveryController], providers: [
      { provide: StoryAuthorBodyTrialReceiptService, useValue: f.receipts }, { provide: PrismaService, useValue: db },
      { provide: JwtService, useValue: jwt }, { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) }, JwtAuthGuard,
    ] }).compile();
    const app = module.createNestApplication({ logger: false }); configureHttpRouting(app);
    app.use(authorBodyTrialReceiptPrivacyMiddleware); app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1'); const port = (app.getHttpServer().address() as AddressInfo).port;
    const route = `/api/v1/me/creator-studio/stories/${f.work.id}/body-trial/choices/${f.choice.id}/receipt`;
    const query = '?' + new URLSearchParams({ ...f.body, expectedRevision: '1' }).toString();
    function get(token = ownerToken, suffix = query, method = 'GET', malformed = false, targetRoute = route) {
      return new Promise<{ status: number; cache: unknown; body: any }>((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port, path: targetRoute + suffix, method,
          headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'Idempotency-Key': f.key,
            ...(malformed ? { 'content-type': 'application/json', 'content-length': '4' } : {}) } }, response => {
          const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
          response.on('end', () => { try { resolve({ status: response.statusCode!, cache: response.headers['cache-control'],
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch (error) { reject(error); } });
        });
        req.on('error', reject); req.setTimeout(10000, () => req.destroy(new Error('Loopback receipt timeout')));
        req.end(malformed ? 'null' : undefined);
      });
    }
    try {
      const before = await state(f);
      expect(await get()).toMatchObject({ status: 200, cache: 'private, no-store', body: {
        readOnly: true, generationAuthorized: false, receipt: { status: 'queued' } } });
      expect(await get(readerToken)).toMatchObject({ status: 404, cache: 'private, no-store' });
      expect(await get('')).toMatchObject({ status: 401, cache: 'private, no-store' });
      expect(await get(ownerToken, query, 'GET', true)).toMatchObject({ status: 400, cache: 'private, no-store' });
      for (const bad of [query + '&locale=ko', query + '&ownerUserId=' + f.owner.id,
        query.replace('expectedRevision=1', 'expectedRevision=1e0')]) expect(await get(ownerToken, bad)).toMatchObject({ status: 400, cache: 'private, no-store' });
      expect(await get(ownerToken, query, 'POST')).toMatchObject({ status: 404 });
      const recovery = `/api/v1/me/creator-studio/stories/${f.work.id}/body-trial/recovery`;
      expect(await get(ownerToken, '', 'GET', false, recovery)).toMatchObject({ status: 200, cache: 'private, no-store',
        body: { command: { key: f.key, body: f.body }, generationAuthorized: false } });
      expect(await get(readerToken, '', 'GET', false, recovery)).toMatchObject({ status: 404, cache: 'private, no-store' });
      expect(await get('', '', 'GET', false, recovery)).toMatchObject({ status: 401, cache: 'private, no-store' });
      expect(await get(ownerToken, '?generationAuthorized=true', 'GET', false, recovery))
        .toMatchObject({ status: 400, cache: 'private, no-store' });
      expect(await get(ownerToken, '', 'GET', true, recovery)).toMatchObject({ status: 400, cache: 'private, no-store' });
      expect(await get(ownerToken, '', 'POST', false, recovery)).toMatchObject({ status: 404, cache: 'private, no-store' });
      expect(await state(f)).toEqual(before); expect(f.provider.generate).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('uses actual browser and isolated API after tab storage loss, manually locating then reading a receipt with no POST', async () => {
    const f = await prepared(); await f.choose();
    await db.storyAuthorBodyTrialApproval.update({ where: { id: f.approval.id }, data: { status: 'revoked' } });
    const before = await state(f), jwt = new JwtService(), secret = randomUUID();
    const token = await jwt.signAsync({ sub: f.owner.id, tokenType: 'access' }, { secret, expiresIn: '5m' });
    const module = await Test.createTestingModule({ controllers: [StoryAuthorBodyTrialReceiptController, StoryAuthorBodyTrialRecoveryController], providers: [
      { provide: StoryAuthorBodyTrialReceiptService, useValue: f.receipts }, { provide: PrismaService, useValue: db },
      { provide: JwtService, useValue: jwt }, { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) }, JwtAuthGuard,
    ] }).compile();
    const app = module.createNestApplication({ logger: false }); configureHttpRouting(app);
    app.use(authorBodyTrialReceiptPrivacyMiddleware); app.useGlobalFilters(new HttpExceptionFilter());
    const root = join(__dirname, '../../..');
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/pages/creator-body-trial.css"><style>body{margin:0;background:white;color:#252a2d;font-family:system-ui}main{max-width:960px;margin:auto;padding:24px}</style></head><body><main id="studioShell"><section id="writer-manuscript" class="is-active"><select id="writerManuscriptWork"><option value="${f.work.id}">Isolated synthetic story</option></select><select id="writerManuscriptLocale"><option value="ko">ko</option></select><section id="writerBodyTrial"></section></section></main><script>const owner={ownerId:${JSON.stringify(f.owner.id)},epoch:1};window.getAuth=()=>({accessToken:${JSON.stringify(token)}});window.luminaI18n={getLocale:()=>document.documentElement.lang};window.LuminaCreatorStudioApi={identity:()=>owner,isCurrent:x=>x.ownerId===owner.ownerId&&x.epoch===owner.epoch,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Authorization:'Bearer '+window.getAuth().accessToken},body:options.body===undefined?undefined:JSON.stringify(options.body)})};</script><script src="/pages/creator-body-preview.js"></script><script src="/pages/creator-body-trial.js"></script></body></html>`;
    app.use((req: any, res: any, next: () => void) => {
      if (req.url === '/') return res.type('html').send(html);
      if (['/pages/creator-body-trial.js', '/pages/creator-body-trial.css', '/pages/creator-body-preview.js'].includes(req.url)) {
        return res.type(req.url.endsWith('.css') ? 'text/css' : 'text/javascript').send(readFileSync(join(root, req.url.slice(1))));
      }
      next();
    });
    const { chromium } = require('C:/Users/kim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
    let browser: any;
    try {
      await app.listen(0, '127.0.0.1'); const origin = 'http://127.0.0.1:' + (app.getHttpServer().address() as AddressInfo).port;
      browser = await chromium.launch({ headless: true,
        executablePath: 'E:/Codex/LuminaStage/qa-browsers/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe',
        args: ['--disable-background-networking'] });
      const layouts: unknown[] = [];
      for (const width of [1280, 390]) for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
        const context = await browser.newContext({ viewport: { width, height: 844 } });
        await context.route('**/*', (route: any) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        const page = await context.newPage(), calls: { method: string; path: string }[] = [], errors: string[] = [];
        page.setDefaultTimeout(10000);
        page.setDefaultNavigationTimeout(10000);
        page.on('pageerror', (error: Error) => errors.push(error.message));
        page.on('request', (request: any) => { if (request.url().includes('/api/')) calls.push({ method: request.method(), path: new URL(request.url()).pathname }); });
        await page.goto(origin);
        await page.evaluate((language: string) => { document.documentElement.lang = language; window.dispatchEvent(new Event('lumina:localechange')); }, locale);
        expect(calls).toEqual([]);
        expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
        await page.locator('#writerBodyTrialRecover').click();
        await page.waitForFunction(() => !document.getElementById('writerBodyTrialRetry')!.hasAttribute('hidden') && !(document.getElementById('writerBodyTrialRetry') as HTMLButtonElement).disabled, undefined, { timeout: 10000 });
        expect(calls).toHaveLength(1); expect(calls[0].method).toBe('GET'); expect(calls[0].path.endsWith('/recovery')).toBe(true);
        const saved = await page.evaluate(() => sessionStorage.getItem(sessionStorage.key(0)!));
        expect(JSON.parse(saved)).toMatchObject({ key: f.key, body: f.body });
        expect(saved).not.toContain(token);
        const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
          overflow: [...document.querySelectorAll('#writerBodyTrial button,#writerBodyTrial h3')].some(node => node.scrollWidth > node.clientWidth + 1) }));
        expect(layout.scroll).toBeLessThanOrEqual(layout.width); expect(layout.overflow).toBe(false);
        await page.screenshot({ path: join(process.env.TEMP!, `recovery-${width}-${locale}.png`), fullPage: true });
        await page.locator('#writerBodyTrialRetry').click();
        await page.waitForFunction(() => document.getElementById('writerBodyTrialRetry')!.hasAttribute('hidden'), undefined, { timeout: 10000 });
        expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
        expect(calls).toHaveLength(2); expect(calls[1].method).toBe('GET'); expect(calls[1].path.endsWith('/receipt')).toBe(true);
        expect(errors).toEqual([]); layouts.push({ width, locale, ...layout, apiGetCount: 2, apiPostCount: 0 });
        await context.close();
      }
      expect(await state(f)).toEqual(before); expect(f.provider.generate).not.toHaveBeenCalled();
      writeFileSync(join(process.env.TEMP!, 'browser-recovery-evidence.json'), JSON.stringify({ passed: true,
        actualLocalApi: true, authenticatedLocalOnly: true, production: false, realAI: false,
        syntheticFixture: true, layouts, providerCalls: 0, progressLedgerHistoryUnchanged: true }, null, 2));
    } finally { await browser?.close(); await app.close(); }
  }, 90000);
});
