import 'reflect-metadata';
import { BadRequestException, ConflictException, RequestMethod, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, HEADERS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoryAuthorBodyTrialService } from './story-author-body-trial.service';
import { SelectAuthorBodyTrialChoiceDto, StoryAuthorBodyTrialController } from './story-author-body-trial.controller';
import { STORY_LOCALES } from './story-production.policy';
import { StoryProductionService } from './story-production.service';

const owner = randomUUID(), outsider = randomUUID(), workId = randomUUID(), releaseId = randomUUID();
const approvalId = randomUUID(), progressId = randomUUID(), sceneId = randomUUID(), continuationId = randomUUID();
const manuscriptVersionId = randomUUID(), consentId = randomUUID(), analysisId = randomUUID();
const body = { approvalId, progressId, expectedRevision: 39, locale: 'ko' };
const key = 'explicit-body-read:one';
const localized = () => Object.fromEntries(STORY_LOCALES.map(locale => [locale, 'Synthetic beat text.']));

function fixture() {
  const state = {
    work: { id: workId, ownerUserId: owner, activeReleaseId: releaseId, publishedVersion: 1, status: 'published', fixtureSource: false },
    approval: { id: approvalId, userId: owner, workId, releaseId, manuscriptVersionId, status: 'active',
      expiresAt: new Date(Date.now() + 3600000), createdAt: new Date(0), approvedBudgetKrw: new Prisma.Decimal(10000),
      approvalReference: 'synthetic-read-test', releaseChecksum: 'a'.repeat(64), capabilityRevision: 2,
      styleConsentId: consentId, styleConsentRevision: 3, analysisJobId: analysisId, analysisVersion: 4,
      generationProfileId: null, generationProfileRevision: null, generationProfileFingerprint: null },
    release: { id: releaseId, workId, status: 'active', manuscriptVersionId, version: 1, checksum: 'a'.repeat(64) },
    capability: { releaseId, status: 'active', revision: 2 },
    consent: { id: consentId, workId, ownerUserId: owner, manuscriptVersionId, status: 'active', revision: 3,
      rightsConfirmed: true, aiBranchAllowed: true, startsAt: new Date(0), expiresAt: null as Date | null },
    analysis: { id: analysisId, workId, manuscriptVersionId, status: 'completed', analysisVersion: 4 },
    progress: { id: progressId, userId: owner, workId, activeReleaseId: releaseId, storyVersion: 1,
      capabilityRevision: 2, status: 'active', progressRevision: 39, currentBeatPosition: 0,
      currentSceneId: null as string | null, currentGeneratedSceneId: sceneId as string | null },
    scene: { id: sceneId, continuationId, userId: owner, workId, progressId, releaseId, status: 'ready', endingType: null as string | null },
    origin: { id: continuationId, userId: owner, workId, progressId, releaseId, status: 'completed', resultGeneratedSceneId: sceneId },
    beats: Array.from({ length: 5 }, (_, index) => ({ id: randomUUID(), sceneId, position: index + 1,
      beatType: 'paragraph', content: localized() })),
    audits: [] as any[],
  };
  const controls = { casFailure: false, auditFailure: false, incompleteCosts: false };
  const matches = (row: any, where: any) => row && Object.entries(where).every(([field, expected]: [string, any]) =>
    expected && typeof expected === 'object' && 'gt' in expected ? row[field] > expected.gt : row[field] === expected);
  const first = (row: () => any) => jest.fn(async ({ where }: any) => matches(row(), where) ? { ...row() } : null);
  const db = {
    storyWork: { findFirst: first(() => state.work) },
    storyAuthorBodyTrialApproval: { findFirst: first(() => state.approval) },
    storyRelease: { findFirst: first(() => state.release) },
    storyReleaseCapability: { findUnique: first(() => state.capability) },
    storyStyleProfileConsent: { findUnique: first(() => state.consent) },
    storyAnalysisJob: { findFirst: first(() => state.analysis) },
    storyWorkGenerationProfile: { findFirst: jest.fn(async () => null) },
    storyReaderProgress: {
      findFirst: first(() => state.progress),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (controls.casFailure || !matches(state.progress, where)) return { count: 0 };
        state.progress.currentBeatPosition = data.currentBeatPosition;
        state.progress.progressRevision += data.progressRevision.increment;
        return { count: 1 };
      }),
    },
    storyAiGeneratedScene: { findFirst: first(() => state.scene) },
    storyAiContinuation: { findFirst: first(() => state.origin) },
    storyAiGeneratedBeat: { findMany: jest.fn(async ({ where, take }: any) => state.beats.filter(beat => beat.sceneId === where.sceneId).slice(0, take)) },
    auditEvent: {
      findMany: jest.fn(async ({ where, take }: any) => state.audits.filter(audit =>
        audit.actorType === where.actorType && audit.actorUserId === where.actorUserId && audit.action === where.action &&
        audit.targetType === where.targetType && audit.metadata.commandHash === where.metadata.equals).slice(0, take)),
      create: jest.fn(async ({ data }: any) => {
        if (controls.auditFailure) throw new Error('Synthetic audit persistence failure');
        state.audits.push(structuredClone(data)); return data;
      }),
    },
    $executeRaw: jest.fn(async () => 1), $queryRaw: jest.fn(async () => []),
  };
  const prisma = { $transaction: jest.fn(async (callback: (tx: typeof db) => Promise<unknown>, _options: unknown) => {
    const before = { ...state.progress }, audits = state.audits.slice();
    try { return await callback(db); }
    catch (error) { Object.assign(state.progress, before); state.audits = audits; throw error; }
  }) };
  const costs = { snapshotTx: jest.fn(async () => ({ userId: owner, workId, complete: !controls.incompleteCosts, continuations: [], ledger: [] })) };
  const trial = new StoryAuthorBodyTrialService(costs as never);
  const authorization = jest.spyOn(trial, 'authorizeTx'), budget = jest.spyOn(trial, 'assertCommittedBudgetTx');
  const service = new StoryProductionService(prisma as never, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, trial);
  const publicProjection = jest.spyOn(service, 'currentProgress').mockRejectedValue(new Error('Public projection forbidden'));
  return { state, db, prisma, controls, costs, authorization, budget, publicProjection, service };
}

describe('author body trial read service (native authorization/budget, synthetic transaction)', () => {
  let f: ReturnType<typeof fixture>;
  const read = (patch = {}, requestKey = key, user: string = owner, work: string = workId) =>
    f.service.recordAuthorBodyTrialRead(user, work, { ...body, ...patch }, requestKey);
  beforeEach(() => { f = fixture(); });
  afterEach(() => { expect(f.publicProjection).not.toHaveBeenCalled(); });

  it.each(STORY_LOCALES)('records the last valid %s beat with explicit user audit, no semantic approval', async locale => {
    const before = { ...f.state.progress };
    expect(await read({ locale })).toEqual({ contract: 'story-author-body-trial-read-v1', workId, progressId,
      sourceRevision: 39, revision: 40, beatPosition: 5, idempotentReplay: false,
      generationStarted: false, imageGenerationStarted: false, readOnly: false });
    expect(f.state.progress).toEqual({ ...before, currentBeatPosition: 5, progressRevision: 40 });
    expect(f.authorization).toHaveBeenCalledTimes(1); expect(f.budget).toHaveBeenCalledTimes(1);
    expect(f.prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable', timeout: 20000 });
    expect(f.state.audits[0]).toMatchObject({ actorType: 'user', actorUserId: owner,
      metadata: { explicitRead: true, meaningApproved: false, qualityApproved: false, publicationStarted: false } });
    expect(f.state.audits[0].metadata.commandHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(f.state.audits)).not.toContain('Synthetic beat text.');
    expect(f.db.storyAiGeneratedBeat.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 41,
      orderBy: [{ position: 'asc' }, { id: 'asc' }] }));
  });

  it('same key returns the original revision even after further progress, with zero domain writes', async () => {
    const first = await read(); f.state.progress.progressRevision = 42; f.state.progress.status = 'ai_pending';
    f.db.storyReaderProgress.updateMany.mockClear(); f.db.auditEvent.create.mockClear();
    expect(await read()).toEqual({ ...first, idempotentReplay: true });
    expect(f.db.storyReaderProgress.updateMany).not.toHaveBeenCalled(); expect(f.db.auditEvent.create).not.toHaveBeenCalled();
    expect(f.state.progress.progressRevision).toBe(42);
  });

  it.each(STORY_LOCALES)('completed generated ending records explicit %s read without reopening or generation', async locale => {
    f.state.progress.status = 'completed'; f.state.scene.endingType = 'ai_generated';
    const before = { ...f.state.progress }, origin = JSON.stringify(f.state.origin);
    expect(await read({ locale })).toMatchObject({ revision: 40, beatPosition: 5,
      generationStarted: false, imageGenerationStarted: false, idempotentReplay: false });
    expect(f.state.progress).toEqual({ ...before, currentBeatPosition: 5, progressRevision: 40 });
    expect(JSON.stringify(f.state.origin)).toBe(origin);
    expect(f.db.storyReaderProgress.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'completed', currentGeneratedSceneId: sceneId }),
      data: { currentBeatPosition: 5, progressRevision: { increment: 1 }, updatedAt: expect.any(Date) } }));
    expect(f.state.audits[0].metadata).toMatchObject({ explicitRead: true, meaningApproved: false,
      qualityApproved: false, publicationStarted: false });
  });

  it('completed generated ending replay does not duplicate read, revision or audit', async () => {
    f.state.progress.status = 'completed'; f.state.scene.endingType = 'ai_generated';
    const first = await read(); const before = JSON.stringify(f.state);
    f.db.storyReaderProgress.updateMany.mockClear(); f.db.auditEvent.create.mockClear();
    expect(await read()).toEqual({ ...first, idempotentReplay: true });
    expect(f.db.storyReaderProgress.updateMany).not.toHaveBeenCalled(); expect(f.db.auditEvent.create).not.toHaveBeenCalled();
    expect(JSON.stringify(f.state)).toBe(before);
  });

  it.each(['missing-ending', 'canonical-ending', 'unknown-ending', 'active-ending', 'expired', 'wrong-scene',
    'failed-origin', 'audit-failure', 'cas-failure'])('completed generated ending protects %s without writes', async kind => {
    f.state.progress.status = 'completed'; f.state.scene.endingType = 'ai_generated';
    if (kind === 'missing-ending') f.state.scene.endingType = null;
    if (kind === 'canonical-ending') f.state.scene.endingType = 'author_main';
    if (kind === 'unknown-ending') f.state.scene.endingType = 'unknown';
    if (kind === 'active-ending') f.state.progress.status = 'active';
    if (kind === 'expired') f.state.approval.expiresAt = new Date(0);
    if (kind === 'wrong-scene') f.state.scene.userId = outsider;
    if (kind === 'failed-origin') f.state.origin.status = 'failed';
    if (kind === 'audit-failure') f.controls.auditFailure = true;
    if (kind === 'cas-failure') f.controls.casFailure = true;
    const before = JSON.stringify(f.state);
    await expect(read()).rejects.toThrow(); expect(JSON.stringify(f.state)).toBe(before);
  });

  it('new key on already fully read body rejects without repeated revision increment', async () => {
    await read(); f.db.storyReaderProgress.updateMany.mockClear(); f.db.auditEvent.create.mockClear();
    await expect(read({ expectedRevision: 40 }, 'explicit-body-read:two')).rejects.toMatchObject({
      response: { code: 'STORY_AUTHOR_BODY_TRIAL_READ_ALREADY_RECORDED' } });
    expect(f.state.progress.progressRevision).toBe(40);
    expect(f.db.storyReaderProgress.updateMany).not.toHaveBeenCalled(); expect(f.db.auditEvent.create).not.toHaveBeenCalled();
  });

  it('normalizes UUIDs consistently for replay', async () => {
    const first = await read();
    expect(await read({ approvalId: approvalId.toUpperCase(), progressId: progressId.toUpperCase() }, key,
      owner.toUpperCase(), workId.toUpperCase())).toEqual({ ...first, idempotentReplay: true });
  });

  it.each([{ locale: 'en' }, { expectedRevision: 40 }, { progressId: randomUUID() }])('rejects same-key request collision %p', async patch => {
    await read();
    await expect(read(patch)).rejects.toMatchObject({ response: { code: 'STORY_AUTHOR_BODY_TRIAL_READ_IDEMPOTENCY_CONFLICT' } });
    expect(f.state.progress.progressRevision).toBe(40); expect(f.state.audits).toHaveLength(1);
  });

  it.each(['nonowner', 'expired', 'revoked', 'stale-consent', 'stale-capability', 'stale-analysis', 'incomplete-costs'])('native gates stop %s before writes', async kind => {
    if (kind === 'expired') f.state.approval.expiresAt = new Date(0);
    if (kind === 'revoked') f.state.approval.status = 'revoked';
    if (kind === 'stale-consent') f.state.consent.revision++;
    if (kind === 'stale-capability') f.state.capability.revision++;
    if (kind === 'stale-analysis') f.state.analysis.analysisVersion++;
    if (kind === 'incomplete-costs') f.controls.incompleteCosts = true;
    await expect(read({}, key, kind === 'nonowner' ? outsider : owner)).rejects.toThrow();
    expect(f.db.storyReaderProgress.updateMany).not.toHaveBeenCalled(); expect(f.db.auditEvent.create).not.toHaveBeenCalled();
  });

  it.each(['pending', 'completed', 'stale-revision', 'canonical', 'missing-pointer', 'wrong-release', 'wrong-progress-owner', 'wrong-scene', 'failed-origin'])('stops invalid current progress %s', async kind => {
    if (kind === 'pending') f.state.progress.status = 'ai_pending';
    if (kind === 'completed') f.state.progress.status = 'completed';
    if (kind === 'stale-revision') f.state.progress.progressRevision++;
    if (kind === 'canonical') f.state.progress.currentSceneId = randomUUID();
    if (kind === 'missing-pointer') f.state.progress.currentGeneratedSceneId = null;
    if (kind === 'wrong-release') f.state.progress.activeReleaseId = randomUUID();
    if (kind === 'wrong-progress-owner') f.state.progress.userId = outsider;
    if (kind === 'wrong-scene') f.state.scene.progressId = randomUUID();
    if (kind === 'failed-origin') f.state.origin.status = 'failed';
    await expect(read()).rejects.toThrow();
    expect(f.db.storyReaderProgress.updateMany).not.toHaveBeenCalled(); expect(f.db.auditEvent.create).not.toHaveBeenCalled();
  });

  it.each(['none', '41', 'zero-position', '41-position', 'duplicate-position', 'unordered', 'duplicate-id', 'missing-locale', 'blank', 'nul', 'control', 'del', 'surrogate', 'long', 'beat-type-invalid', 'beat-type-leading-digit', 'beat-type-empty', 'beat-type-long'])('rejects invalid bounded/localized beats %s', async kind => {
    if (kind === 'none') f.state.beats = [];
    if (kind === '41') f.state.beats = Array.from({ length: 41 }, (_, i) => ({ ...f.state.beats[0], id: randomUUID(), position: i + 1 }));
    if (kind === 'zero-position') f.state.beats[0].position = 0;
    if (kind === '41-position') f.state.beats[4].position = 41;
    if (kind === 'duplicate-position') f.state.beats[1].position = 1;
    if (kind === 'unordered') f.state.beats.reverse();
    if (kind === 'duplicate-id') f.state.beats[1].id = f.state.beats[0].id;
    if (kind === 'missing-locale') delete f.state.beats[0].content.ko;
    if (kind === 'blank') f.state.beats[0].content.ko = ' ';
    if (kind === 'nul') f.state.beats[0].content.ko = 'bad\0text';
    if (kind === 'control') f.state.beats[0].content.ko = 'bad\u0001text';
    if (kind === 'del') f.state.beats[0].content.ko = 'bad\u007ftext';
    if (kind === 'surrogate') f.state.beats[0].content.ko = '\uD800';
    if (kind === 'long') f.state.beats[0].content.ko = 'x'.repeat(64001);
    if (kind === 'beat-type-invalid') f.state.beats[0].beatType = 'paragraph/body';
    if (kind === 'beat-type-leading-digit') f.state.beats[0].beatType = '1paragraph';
    if (kind === 'beat-type-empty') f.state.beats[0].beatType = '';
    if (kind === 'beat-type-long') f.state.beats[0].beatType = 'p'.repeat(65);
    await expect(read()).rejects.toMatchObject({ response: { code: 'STORY_AUTHOR_BODY_TRIAL_READ_BEATS_INVALID' } });
    expect(f.db.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  });

  it('matches preview case-insensitive tokens and permits tabs, LF, CR in content', async () => {
    f.state.beats[0].beatType = 'Paragraph_1-body';
    f.state.beats[0].content.ko = 'First\tsecond\nthird\r\nfourth';
    expect(await read()).toMatchObject({ beatPosition: 5, revision: 40 });
  });

  it('accepts exactly 40 beats and records position 40', async () => {
    f.state.beats = Array.from({ length: 40 }, (_, i) => ({ ...f.state.beats[0], id: randomUUID(), position: i + 1 }));
    expect(await read()).toMatchObject({ beatPosition: 40, revision: 40 });
  });

  it.each(['CAS', 'audit'])('rolls current position/revision and audit back on %s failure', async kind => {
    f.controls.casFailure = kind === 'CAS'; f.controls.auditFailure = kind === 'audit';
    const before = { ...f.state.progress };
    await expect(read()).rejects.toThrow();
    expect(f.state.progress).toEqual(before); expect(f.state.audits).toHaveLength(0);
  });

  it('rejects corrupted or duplicate stored audit receipts', async () => {
    await read(); f.state.audits[0].metadata.receipt.beatPosition = 41;
    await expect(read()).rejects.toMatchObject({ response: { code: 'STORY_AUTHOR_BODY_TRIAL_READ_EVIDENCE_INVALID' } });
    f.state.audits.push(structuredClone(f.state.audits[0]));
    await expect(read()).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([{ expectedRevision: 2147483647 }, { expectedRevision: 1.5 }, { locale: 'fr' }, { amount: 1 }])('rejects invalid service input %p before transaction', async patch => {
    await expect(read(patch)).rejects.toBeInstanceOf(BadRequestException); expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('author body trial read controller (no listener or auth minting)', () => {
  const stories = { recordAuthorBodyTrialRead: jest.fn(), selectAuthorBodyTrialChoice: jest.fn() };
  const controller = new StoryAuthorBodyTrialController(stories);
  const url = `/api/v1/me/creator-studio/stories/${workId}/body-trial/read-beats`;
  beforeEach(() => jest.clearAllMocks());

  it('has native JWT/raw input/private cache guards and only explicit POST route', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, StoryAuthorBodyTrialController);
    expect(guards).toContain(JwtAuthGuard);
    expect(guards.map((guard: any) => guard.name)).toEqual(['AuthorBodyTrialNoStoreGuard', 'JwtAuthGuard', 'AuthorBodyTrialInputGuard']);
    expect(Reflect.getMetadata(PATH_METADATA, controller.readBeats)).toBe('read-beats');
    expect(Reflect.getMetadata(METHOD_METADATA, controller.readBeats)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(HEADERS_METADATA, controller.readBeats)).toContainEqual({ name: 'Cache-Control', value: 'private, no-store' });
    const setHeader = jest.fn(); new guards[0]().canActivate({ switchToHttp: () => ({ getResponse: () => ({ setHeader }) }) });
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(() => new guards[2]().canActivate({ switchToHttp: () => ({ getRequest: () => ({ body: { ...body, generateImages: true } }) }) })).toThrow(BadRequestException);
  });

  it('delegates only exact DTO, verified user, work, and unchanged key', () => {
    controller.readBeats({ id: owner }, workId, body, key, { url });
    expect(stories.recordAuthorBodyTrialRead).toHaveBeenCalledWith(owner, workId, body, key);
    expect(stories.selectAuthorBodyTrialChoice).not.toHaveBeenCalled();
  });

  it.each(['locale=ko', 'unknown', '&&', 'x=1&x=2'])('rejects every raw query %s', query => {
    expect(() => controller.readBeats({ id: owner }, workId, body, key, { url: `${url}?${query}` })).toThrow(BadRequestException);
    expect(stories.recordAuthorBodyTrialRead).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'short', 'a'.repeat(121), 'read/key', 'read key'])('rejects invalid key %p', requestKey => {
    expect(() => controller.readBeats({ id: owner }, workId, body, requestKey, { url })).toThrow(BadRequestException);
    expect(stories.recordAuthorBodyTrialRead).not.toHaveBeenCalled();
  });

  it('uses native four-field DTO validation without permitting position or approval claims', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    const transform = (value: unknown) => pipe.transform(value, { type: 'body', metatype: SelectAuthorBodyTrialChoiceDto });
    expect(await transform(body)).toEqual(body);
    for (const field of ['position', 'meaningApproved', 'qualityApproved', 'userId', 'budgetKrw']) {
      await expect(transform({ ...body, [field]: true })).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(transform({ ...body, progressId: 'invalid' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('native JWT guard denies unauthenticated read without verification or account lookup', async () => {
    const verifyAsync = jest.fn(), findFirst = jest.fn();
    const guard = new JwtAuthGuard({ verifyAsync } as never, {} as never, { user: { findFirst } } as never);
    await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }) } as never)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verifyAsync).not.toHaveBeenCalled(); expect(findFirst).not.toHaveBeenCalled();
  });
});
