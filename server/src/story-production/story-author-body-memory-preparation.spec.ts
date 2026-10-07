import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, HEADERS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoryAuthorBodyReviewService } from './story-author-body-review.service';
import { AuthorBodyReviewPrivacyGuard, AuthorBodyReviewRawInputGuard, StoryAuthorBodyReviewController } from './story-author-body-review.controller';
import { authorBodyReviewPrivacyMiddleware } from './story-author-body-review.privacy';
import { AUTHOR_BODY_REVIEW_CONTRACT, bodyReviewHash, privateBodyReviewFlags } from './story-author-body-review.policy';
import { BodyReviewRow } from './story-author-body-review.store';
import { storyAiResultChecksum } from './story-ai-result-checksum';
import { STORY_LOCALES } from './story-production.policy';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const USER = id(1), WORK = id(2), PRIVATE = 'SYNTHETIC_PRIVATE_NAME: not an approved event';
const contract = 'story-author-body-memory-preparation-v1';
const topKeys = ['contract', ...Object.keys(privateBodyReviewFlags), 'workId', 'locale', 'readOnly', 'state',
  'bodyReviewable', 'target', 'sourcePins', 'participantReference', 'latestBodyReview',
  'generatedEventApprovalSupported', 'generatedEventReadProofAvailable', 'chatCurrentIdentityClaimed', 'readerMemoryApplied'];
const sourceKeys = ['releaseId', 'releaseChecksum', 'releaseVersion', 'releaseRevision', 'manuscriptVersionId',
  'manuscriptHash', 'routeNodeId', 'routeHash', 'routeStepHash', 'sourceRouteNodeId', 'sourceRouteHash',
  'continuationId', 'materializedHash'];
const judgmentKeys = ['id', 'locale', 'version', 'decision', 'approvalBasis', 'styleReviewed', 'charactersReviewed',
  'timelineReviewed', 'createdAt', 'withdrawnAt', 'applicability'];

function matches(row: any, where: any): boolean {
  if (!row) return false;
  return Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (key === 'userId_workId') return matches(row, value);
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key]);
      if ('gt' in value) return row[key] > value.gt;
      throw new Error(`Unexpected synthetic query predicate: ${key}`);
    }
    return row[key] === value;
  });
}

// Self-contained rows exercise the real snapshot validators, not a mocked snapshot method.
function fixture(locale = 'en', ending = false) {
  const hash = (label: string) => bodyReviewHash({ synthetic: label });
  const pin = { id: id(20), artistId: id(21), participantFingerprint: hash('participant'),
    identityProfileId: id(22), identityProfileVersion: 4, identityReviewRevision: 5,
    identitySourceFingerprint: hash('identity-source'), identityApprovedFingerprint: hash('identity-approved'),
    referenceAssetIds: [id(23)], referenceChecksums: [hash('reference')] };
  const state: any = {
    work: { id: WORK, ownerUserId: USER, fixtureSource: false, status: 'published', activeReleaseId: id(3),
      publishedVersion: 1, releaseRevision: 2, authorDisplayName: PRIVATE },
    progress: { id: id(4), userId: USER, workId: WORK, status: ending ? 'completed' : 'active',
      activeReleaseId: id(3), storyVersion: 1, progressRevision: 7, routeNodeId: id(5),
      currentSceneId: null, currentGeneratedSceneId: id(6), pathSummary: [] },
    release: { id: id(3), workId: WORK, status: 'active', version: 1, checksum: hash('release'), manuscriptVersionId: id(7) },
    manuscript: { id: id(7), workId: WORK, ownerUserId: USER, contentHash: hash('manuscript'), locale },
    scene: { id: id(6), userId: USER, workId: WORK, progressId: id(4), releaseId: id(3), status: 'ready',
      provenance: 'ai_generated', continuationId: id(8), sourcePartId: id(9), endingType: ending ? 'ai_generated' : null,
      title: { [locale]: PRIVATE }, visualManifest: { privatePayload: PRIVATE }, resultChecksum: '' },
    origin: { id: id(8), userId: USER, workId: WORK, progressId: id(4), releaseId: id(3), resultGeneratedSceneId: id(6),
      status: 'completed', sourcePartId: id(9), manuscriptVersionId: id(7), releaseChecksum: hash('release'), locale,
      contextFingerprint: hash('context'), sourceRouteNodeId: id(10), sourceRouteHash: hash('source-route'),
      sourceProgressRevision: 3, contextReferences: { memoryPins: [], participantPin: pin, privatePayload: PRIVATE },
      styleConsentId: id(11), styleConsentRevision: 1, capabilityRevision: 1, analysisJobId: id(12), analysisVersion: 1 },
    part: { id: id(9), workId: WORK, status: 'published', fixtureSource: false },
    route: { id: id(5), progressId: id(4), workId: WORK, releaseId: id(3), parentId: id(10),
      narrativeStep: { generatedSceneId: id(6), privatePayload: PRIVATE }, routeHash: hash('route') },
    consent: { id: id(11), workId: WORK, ownerUserId: USER, manuscriptVersionId: id(7), status: 'active', revision: 1,
      rightsConfirmed: true, aiBranchAllowed: true, withdrawnAt: null, deletionRequestedAt: null, deletedAt: null,
      startsAt: new Date(0), expiresAt: null, allowedLocales: [...STORY_LOCALES] },
    capability: { workId: WORK, releaseId: id(3), status: 'active', revision: 1 },
    analysis: { id: id(12), workId: WORK, manuscriptVersionId: id(7), status: 'completed', analysisVersion: 1,
      pipeline: 'legacy_fixture' },
    profile: null,
    beats: [{ id: id(13), sceneId: id(6), position: 1, beatType: 'narration', content: { [locale]: PRIVATE } }],
    choices: ending ? [] : [{ id: id(14), sceneId: id(6), position: 1, choiceKey: 'synthetic-choice', label: { [locale]: PRIVATE } }],
    discoveries: ending ? [{ id: id(15), userId: USER, workId: WORK, releaseId: id(3), pathSignature: bodyReviewHash([]),
      endingKind: 'ai_generated', provenance: 'ai_generated', endingKey: 'synthetic-ending' }] : [],
    head: null, participant: { pin, approved: { displayName: PRIVATE, identityProfile: { privatePayload: PRIVATE } } },
  };
  state.scene.resultChecksum = storyAiResultChecksum({ title: state.scene.title, beats: state.beats,
    visualManifest: state.scene.visualManifest, nextChoices: state.choices,
    ending: ending ? { endingKey: 'synthetic-ending' } : null });
  const writes = jest.fn(() => { throw new Error('Unit forbids all writes'); });
  const db: any = { auditEvent: { create: writes }, $executeRawUnsafe: writes, $queryRawUnsafe: writes };
  const models = { storyWork: 'work', storyReaderProgress: 'progress', storyRelease: 'release',
    storyManuscriptVersion: 'manuscript', storyAiGeneratedScene: 'scene', storyAiContinuation: 'origin', storyPart: 'part',
    storyProgressRouteNode: 'route', storyStyleProfileConsent: 'consent', storyReleaseCapability: 'capability',
    storyAnalysisJob: 'analysis', storyWorkGenerationProfile: 'profile', storyAiGeneratedBeat: 'beats',
    storyAiGeneratedChoice: 'choices', storyEndingDiscovery: 'discoveries' };
  for (const [model, property] of Object.entries(models)) {
    const rows = (query: any) => {
      const value = state[property], available = Array.isArray(value) ? value : value ? [value] : [];
      return available.filter((row: any) => matches(row, query.where)).slice(0, query.take ?? Infinity);
    };
    db[model] = { findFirst: jest.fn(async (query: any) => rows(query)[0] ?? null),
      findUnique: jest.fn(async (query: any) => rows(query)[0] ?? null), findMany: jest.fn(async (query: any) => rows(query)),
      create: writes, update: writes, updateMany: writes, delete: writes, deleteMany: writes, upsert: writes };
  }
  db.$executeRaw = jest.fn(async (sql: Prisma.Sql) => {
    if (sql.strings.join('').trim() !== 'SET TRANSACTION READ ONLY') return writes();
    return 0;
  });
  db.$queryRaw = jest.fn(async (sql: Prisma.Sql) => {
    const text = sql.strings.join('?');
    if (!text.trim().startsWith('SELECT') || !text.includes('FROM story_author_body_reviews r') ||
        !text.includes('ORDER BY r.version DESC LIMIT 1') || /FOR (?:UPDATE|SHARE)|INSERT|UPDATE|DELETE/.test(text)) return writes();
    expect(sql.values).toEqual([USER, WORK]);
    expect(text).not.toMatch(/WHERE[^]*r\.locale\s*=/);
    return state.head ? [state.head] : [];
  });
  const prisma: any = { $transaction: jest.fn(async (fn: (client: any) => unknown) => fn(db)),
    $connect: writes, $executeRaw: writes, $queryRaw: writes };
  const participants: any = { pinnedContext: jest.fn(async () => state.participant) };
  const service = new StoryAuthorBodyReviewService(prisma, participants);
  const effects = [jest.spyOn(service, 'autoApproveCompanyContinuation').mockImplementation(writes),
    jest.spyOn(service, 'deferCompanyContinuationApproval').mockImplementation(writes),
    jest.spyOn(service, 'onApplicationBootstrap').mockImplementation(writes)];
  const read = () => service.memoryPreparation(USER, WORK, locale);
  const noEffects = () => {
    expect(writes).not.toHaveBeenCalled();
    effects.forEach(effect => expect(effect).not.toHaveBeenCalled());
    expect((service as any).retryTimer).toBeNull();
    expect((service as any).approvalRetries.size).toBe(0);
  };
  const singleRead = () => {
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    noEffects();
  };
  return { state, db, prisma, participants, service, read, noEffects, singleRead };
}

function privateProjection(result: any) {
  expect(Object.keys(result).sort()).toEqual([...topKeys].sort());
  expect(result).toMatchObject({ contract, workId: WORK, readOnly: true, ...privateBodyReviewFlags,
    generatedEventApprovalSupported: false, generatedEventReadProofAvailable: false,
    chatCurrentIdentityClaimed: false, readerMemoryApplied: false });
  const json = JSON.stringify(result);
  expect(json).not.toContain(PRIVATE);
  expect(json).not.toMatch(/"(?:body|content|title|beats|choices|events|eventClassification|artistDid|artistSaid|displayName|profilePin|participantPin|identityProfileId|referenceAssetIds|referenceChecksums|contextReferences|delegationSnapshot)"\s*:/);
  if (result.target) {
    expect(Object.keys(result.target).sort()).toEqual(['progressId', 'progressRevision', 'sceneId', 'sourceBindingHash', 'bodyChecksum', 'ending'].sort());
    expect(Object.keys(result.sourcePins).sort()).toEqual([...sourceKeys].sort());
  } else {
    expect(result.sourcePins).toBeNull();
    expect(result.participantReference).toBeNull();
  }
  if (result.participantReference) expect(Object.keys(result.participantReference).sort())
    .toEqual(['id', 'artistId', 'participantFingerprint'].sort());
  if (result.latestBodyReview) expect(Object.keys(result.latestBodyReview).sort()).toEqual([...judgmentKeys].sort());
}

async function installHead(f: ReturnType<typeof fixture>, overrides: Partial<BodyReviewRow> = {}) {
  const basis = await f.read();
  f.state.head = { id: id(30), ownerUserId: USER, workId: WORK, locale: basis.locale, version: 3,
    sceneId: id(6), sourceBindingHash: basis.target!.sourceBindingHash, requestHash: bodyReviewHash('request'),
    decision: 'approve', approvalBasis: 'human_review', delegationSnapshot: null,
    styleReviewed: true, charactersReviewed: true, timelineReviewed: true,
    createdAt: new Date('2026-10-07T00:00:00Z'), withdrawnAt: null, privatePayload: PRIVATE, ...overrides };
  return f.state.head as BodyReviewRow;
}

function context(request: any, response = { setHeader: jest.fn() }): any {
  return { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) };
}

describe('owner-current generated body memory preparation (synthetic, metadata only)', () => {
  it.each(STORY_LOCALES)('uses the exact %s source locale and one readonly snapshot/head transaction', async locale => {
    const f = fixture(locale, locale === 'zh-Hant');
    const result = await f.read();
    expect(result).toMatchObject({ locale, state: 'reviewable', bodyReviewable: true, latestBodyReview: null });
    expect(result.target).toMatchObject({ progressId: id(4), sceneId: id(6), progressRevision: 7, ending: locale === 'zh-Hant' });
    expect(result.sourcePins).toEqual({ releaseId: id(3), releaseChecksum: f.state.release.checksum,
      releaseVersion: 1, releaseRevision: 2, manuscriptVersionId: id(7), manuscriptHash: f.state.manuscript.contentHash,
      routeNodeId: id(5), routeHash: f.state.route.routeHash, routeStepHash: bodyReviewHash(f.state.route.narrativeStep),
      sourceRouteNodeId: id(10), sourceRouteHash: f.state.origin.sourceRouteHash, continuationId: id(8),
      materializedHash: bodyReviewHash({ title: f.state.scene.title, beats: f.state.beats, choices: f.state.choices }) });
    expect(result.participantReference).toEqual({ id: id(20), artistId: id(21), participantFingerprint: f.state.participant.pin.participantFingerprint });
    privateProjection(result); f.singleRead();
  });

  it('preserves the existing current response shape and target exactly', async () => {
    const f = fixture();
    const old = await f.service.current(USER, WORK, 'en'), result = await f.read();
    expect(old).toEqual({ contract: AUTHOR_BODY_REVIEW_CONTRACT, ...privateBodyReviewFlags, workId: WORK, locale: 'en',
      readOnly: true, state: result.state, target: result.target, latestReview: null });
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(2); f.noEffects();
  });

  it('projects a current human BODY judgment without event approval or content', async () => {
    const f = fixture(); await installHead(f);
    const result = await f.read();
    expect(result.latestBodyReview).toMatchObject({ id: id(30), decision: 'approve', approvalBasis: 'human_review', applicability: 'current' });
    privateProjection(result); f.noEffects();
  });

  it('keeps company-delegation BODY basis distinct and stale without matching authority', async () => {
    const f = fixture(); await installHead(f, { approvalBasis: 'company_delegation', delegationSnapshot: { privatePayload: PRIVATE },
      styleReviewed: false, charactersReviewed: false, timelineReviewed: false });
    const result = await f.read();
    expect(result.latestBodyReview).toMatchObject({ approvalBasis: 'company_delegation', applicability: 'stale', styleReviewed: false });
    privateProjection(result); f.noEffects();
  });

  it('preserves the latest withdrawn BODY judgment instead of treating it as approval', async () => {
    const f = fixture(); await installHead(f, { withdrawnAt: new Date('2026-10-07T00:01:00Z') });
    const result = await f.read();
    expect(result.latestBodyReview).toMatchObject({ applicability: 'withdrawn', withdrawnAt: '2026-10-07T00:01:00.000Z' });
    privateProjection(result); f.noEffects();
  });

  it('preserves the cross-locale latest head and stale reject without resurrecting an older approval', async () => {
    const f = fixture(); await installHead(f, { locale: 'ko', decision: 'reject', version: 9, sourceBindingHash: bodyReviewHash('older-source') });
    const result = await f.read();
    expect(result.latestBodyReview).toMatchObject({ locale: 'ko', decision: 'reject', version: 9, applicability: 'stale' });
    privateProjection(result); f.noEffects();
  });

  it('repeated reads are identical and never apply memory, audit, generation or deferred approval', async () => {
    const f = fixture(), first = await f.read(), second = await f.read();
    expect(second).toEqual(first); expect(f.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(2); f.noEffects();
  });

  it('returns the existing owner 404 for wrong owner, missing work and fixture work', async () => {
    for (const kind of ['wrong-owner', 'missing', 'fixture']) {
      const f = fixture();
      if (kind === 'missing') f.state.work = null;
      else if (kind === 'fixture') f.state.work.fixtureSource = true;
      else f.state.work.ownerUserId = id(99);
      await expect(f.read()).rejects.toMatchObject({ response: { code: 'STORY_AUTHOR_BODY_REVIEW_UNAVAILABLE' } });
      try { await f.read(); } catch (error) { expect(error).toBeInstanceOf(NotFoundException); }
      expect(f.db.$queryRaw).not.toHaveBeenCalled(); f.noEffects();
    }
  });

  it('rejects absent, non-source locale and malformed scope before opening a transaction', async () => {
    const f = fixture();
    for (const locale of [undefined, null, '', 'EN', 'en-US', 'zh-CN', 'ko-KR', 'unknown']) {
      await expect(f.service.memoryPreparation(USER, WORK, locale as any)).rejects.toMatchObject({ response: { code: 'STORY_AUTHOR_BODY_REVIEW_INPUT_INVALID' } });
    }
    for (const [user, work] of [['bad', WORK], [USER, 'bad']]) await expect(f.service.memoryPreparation(user, work, 'en'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled(); f.noEffects();
  });

  it('uses the existing raw GET guard to reject missing, duplicate and extra query keys', () => {
    const guard = new AuthorBodyReviewRawInputGuard(), base = `/api/v1/me/creator-studio/stories/${WORK}/body-review/memory-preparation`;
    for (const query of ['', '?locale=en&locale=en', '?locale=en&extra=1', '?extra=1', '?locale=en&%6cocale=ko']) {
      expect(() => guard.canActivate(context({ method: 'GET', url: base + query }))).toThrow(BadRequestException);
    }
    for (const locale of STORY_LOCALES) expect(guard.canActivate(context({ method: 'GET', url: base + '?locale=' + locale }))).toBe(true);
  });

  it('registers only an authenticated private GET and forwards the authenticated owner and exact locale', async () => {
    const f = fixture(), controller = new StoryAuthorBodyReviewController(f.service);
    const method = StoryAuthorBodyReviewController.prototype.memoryPreparation;
    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe('memory-preparation');
    expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(HEADERS_METADATA, method)).toEqual([{ name: 'Cache-Control', value: 'private, no-store' }]);
    expect(Reflect.getMetadata(GUARDS_METADATA, StoryAuthorBodyReviewController))
      .toEqual([AuthorBodyReviewPrivacyGuard, JwtAuthGuard, AuthorBodyReviewRawInputGuard]);
    const methods = Object.getOwnPropertyNames(StoryAuthorBodyReviewController.prototype)
      .filter(name => name !== 'constructor');
    expect(methods.sort()).toEqual(['current', 'memoryPreparation', 'review', 'withdraw'].sort());
    const spy = jest.spyOn(f.service, 'memoryPreparation');
    const result = await controller.memoryPreparation({ id: USER } as any, WORK, { url: '/body-review/memory-preparation?locale=en' });
    expect(spy).toHaveBeenCalledWith(USER, WORK, 'en'); privateProjection(result); f.singleRead();
  });

  it('preserves privacy before auth and before JSON parsing on the new subpath', () => {
    const response = { setHeader: jest.fn() };
    expect(new AuthorBodyReviewPrivacyGuard().canActivate(context({}, response))).toBe(true);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    for (const prefix of ['/api/me', '/api/v1/me', '/API/V1/ME']) {
      const next = jest.fn(); response.setHeader.mockClear();
      authorBodyReviewPrivacyMiddleware({ url: `${prefix}/creator-studio/stories/${WORK}/body-review/memory-preparation?locale=en` }, response, next);
      expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store'); expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it.each(['no-progress', 'canonical', 'pending', 'unpublished'])('keeps %s nonreviewable without pins or approval', async kind => {
    const f = fixture();
    if (kind === 'no-progress') f.state.progress = null;
    if (kind === 'canonical') { f.state.progress.currentGeneratedSceneId = null; f.state.progress.currentSceneId = id(40); }
    if (kind === 'pending') f.state.progress.status = 'ai_pending';
    if (kind === 'unpublished') f.state.work.status = 'draft';
    const result = await f.read();
    expect(result).toMatchObject({ state: kind === 'pending' ? 'generation_pending' : kind === 'unpublished' ? 'source_changed' : 'not_generated',
      bodyReviewable: false, target: null, latestBodyReview: null });
    privateProjection(result); f.singleRead();
  });

  it('uses existing validators for withdrawn consent and source, root, body or participant drift', async () => {
    const changes: Array<(f: ReturnType<typeof fixture>) => void> = [
      f => { f.state.release.checksum = bodyReviewHash('changed-release'); },
      f => { f.state.manuscript.id = id(90); },
      f => { f.state.route.parentId = id(91); },
      f => { f.state.consent.withdrawnAt = new Date(); },
      f => { f.state.capability.revision = 2; },
      f => { f.state.analysis.analysisVersion = 2; },
      f => { f.state.scene.resultChecksum = bodyReviewHash('changed-body'); },
      f => { f.state.participant = { pin: { ...f.state.participant.pin, participantFingerprint: bodyReviewHash('changed-participant') } }; },
      f => { f.participants.pinnedContext.mockRejectedValue(new ConflictException('synthetic participant drift')); },
    ];
    for (const change of changes) {
      const f = fixture(); await installHead(f); change(f);
      const result = await f.read();
      expect(result).toMatchObject({ state: 'source_changed', bodyReviewable: false, target: null,
        latestBodyReview: { applicability: 'stale' } });
      privateProjection(result); f.noEffects();
    }
  });

  it('allows the existing legacy null participant without inferring an actor or chat identity', async () => {
    const f = fixture(); f.state.participant = null; f.state.origin.contextReferences.participantPin = null;
    const result = await f.read();
    expect(result).toMatchObject({ state: 'reviewable', bodyReviewable: true, participantReference: null });
    privateProjection(result); f.singleRead();
  });

  it('propagates a failed source or head read without retrying, writing or claiming success', async () => {
    for (const stage of ['source', 'head']) {
      const f = fixture(), failure = new Error(`synthetic ${stage} read unavailable`);
      if (stage === 'source') f.db.storyRelease.findFirst.mockRejectedValue(failure);
      else f.db.$queryRaw.mockRejectedValue(failure);
      await expect(f.read()).rejects.toBe(failure);
      expect(f.prisma.$transaction).toHaveBeenCalledTimes(1); f.noEffects();
    }
  });

  it('does not fall back to another language when localized generated body content is missing', async () => {
    for (const source of ['title', 'beat', 'choice']) {
      const f = fixture('ja');
      if (source === 'title') f.state.scene.title = { en: PRIVATE };
      if (source === 'beat') f.state.beats[0].content = { en: PRIVATE };
      if (source === 'choice') f.state.choices[0].label = { en: PRIVATE };
      const result = await f.read();
      expect(result).toMatchObject({ state: 'source_changed', bodyReviewable: false, target: null });
      privateProjection(result); f.singleRead();
    }
  });
});
