import 'reflect-metadata';
import { BadRequestException, INestApplication, NotFoundException, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createHash } from 'crypto';
import { request } from 'http';
import { Prisma } from '@prisma/client';
import type { AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CREATOR_GENERATION_PROFILE_SCHEMA, STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile, stableJson } from '../generation-profile/creator-generation-profile.policy';
import { StoryAuthorCurrentFitQueryDto } from './dto/story-author-current-fit.dto';
import { StoryAuthorCurrentFitController } from './story-author-current-fit.controller';
import { StoryAuthorCurrentFitService } from './story-author-current-fit.service';
import * as contextReader from './story-continuation-diagnostic-context';
import * as inspector from './story-continuation-fixed-cap-fit';
import { authorPartStoryContinuationLengthBounds } from './story-continuation-length.policy';
import { prepareStoryContinuationOpenAiRequestForDiagnostics } from './story-continuation-openai.prompt';
import { storyContinuationInputTokenBudget } from './story-continuation-tokenizer';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';
import { readCurrentApprovedStoryStyleSnapshot } from './story-author-approved-style.snapshot';
import * as profilePolicy from './story-continuation-context.policy';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const owner = uuid(1), workId = uuid(2), releaseId = uuid(3), progressId = uuid(4), partId = uuid(5);
const sceneId = uuid(6), originId = uuid(7), choiceId = uuid(8), manuscriptId = uuid(9), analysisId = uuid(10);
const profileId = uuid(11), rateCardId = uuid(12);
const PRIVATE = 'PRIVATE_CURRENT_FIT_SOURCE';
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const loc = (text: string) => Object.fromEntries(locales.map(locale => [locale, text]));
const digest = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex');
type Row = Record<string, any>;
type Query = { where?: Row; select?: Record<string, boolean>; orderBy?: Row; take?: number };

function matches(row: Row, where: Row = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) throw new Error('Unsupported fixture predicate');
    return row[key] === value;
  });
}
function fixtureClone(value: any): any {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(fixtureClone);
  if (value !== null && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, fixtureClone(item)]));
  return value;
}
const selected = (row: Row, select?: Record<string, boolean>) => fixtureClone(select
  ? Object.fromEntries(Object.entries(select).filter(([, enabled]) => enabled).map(([key]) => [key, row[key]])) : row);

function fixture() {
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story', sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
      key, decision: 'accepted', value: key === 'writing_style'
        ? { summary: PRIVATE, observations: [{ title: 'head', detail: 'first style rule' },
          { title: 'middle', detail: 'middle style rule' }, { title: 'tail', detail: 'mandatory uncut style tail' }],
          categories: [{ category: 'rhythm', observations: ['first category', 'tail category'] }], customRule: 'full generic value' }
        : { summary: `approved ${key}` }, evidence: [],
    })),
  });
  const manuscript = { id: manuscriptId, workId, ownerUserId: owner, version: 1, locale: 'ko', contentHash: 'a'.repeat(64) };
  const analysis = { id: analysisId, workId, manuscriptVersionId: manuscriptId, status: 'completed', pipeline: SEMANTIC_PIPELINE,
    analysisVersion: 2, sourceContentHash: manuscript.contentHash, configHash: 'b'.repeat(64) };
  const sourceFingerprint = digest({ workId, manuscriptVersionId: manuscriptId, contentHash: manuscript.contentHash,
    analysisJobId: analysisId, analysisVersion: analysis.analysisVersion, analysisConfigHash: analysis.configHash });
  const profile = { id: profileId, workId, ownerUserId: owner, manuscriptVersionId: manuscriptId, analysisJobId: analysisId,
    status: 'approved', profileVersion: 1, reviewRevision: 1, sourceFingerprint, approvedSettings: settings,
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings), approvedByUserId: owner,
    approvedAt: new Date('2026-10-10T10:00:00Z') };
  const state = {
    work: { id: workId, ownerUserId: owner, status: 'published', fixtureSource: false, activeReleaseId: releaseId, publishedVersion: 1 },
    progress: { id: progressId, userId: owner, workId, activeReleaseId: releaseId, storyVersion: 1, progressRevision: 52,
      currentBeatPosition: 3, currentSceneId: null, currentGeneratedSceneId: sceneId, status: 'active', routeNodeId: uuid(13),
      pathSummary: [], aiRateCardId: rateCardId, capabilityRevision: 2 } as Row,
    release: { id: releaseId, workId, status: 'active', version: 1, checksum: 'c'.repeat(64), manuscriptVersionId: manuscriptId },
    manuscripts: [manuscript], analyses: [analysis], profiles: [profile] as Row[],
    generated: { id: sceneId, userId: owner, workId, progressId, releaseId, status: 'ready', sourcePartId: partId,
      title: loc(PRIVATE), endingType: null, continuationId: originId, sharedResultId: null } as Row,
    canonical: { id: sceneId, partId, status: 'published', fixtureSource: false, title: loc(PRIVATE), endingType: null },
    origin: { id: originId, userId: owner, workId, progressId, releaseId, status: 'completed', resultGeneratedSceneId: sceneId },
    part: { id: partId, workId, status: 'published', fixtureSource: false, position: 1 },
    beats: [1, 2, 3].map(position => ({ sceneId, position })),
    choice: { id: choiceId, sceneId, position: 2, label: loc(PRIVATE), routeKind: 'generation_required',
      targetSceneId: null, targetEndingKey: null, declaredRejoinSceneId: null },
    capability: { workId, releaseId, status: 'active', revision: 2, rateCardId, aiInputTokenLimit: 32768, aiOutputTokenLimit: 8192 },
    rate: { id: rateCardId, status: 'active', provider: 'openai', model: 'gpt-5.4-mini-2026-03-17', version: 'synthetic-rate-v1' },
  };
  const traces: string[][] = [], writes: jest.Mock[] = [];
  let trace: string[] | null = null;
  const read = (name: string) => {
    if (!trace || trace[0] !== 'READ ONLY') throw new Error('Read outside READ ONLY');
    trace.push(name);
  };
  const first = (name: string, rows: () => Row[]) => jest.fn(async (query: Query) => {
    read(name);
    const values = rows().filter(row => matches(row, query.where));
    for (const [key, order] of Object.entries(query.orderBy || {})) values.sort((a, b) => (a[key] - b[key]) * (order === 'desc' ? -1 : 1));
    return values.length ? selected(values[0], query.select) : null;
  });
  const model = (name: string, methods: Record<string, jest.Mock>): Record<string, jest.Mock> => ({ ...methods,
    ...Object.fromEntries(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'].map(method => {
      const blocked = jest.fn(() => { throw new Error(`Unexpected ${name}.${method}`); });
      writes.push(blocked);
      return [method, blocked];
    })) });
  const unique = (name: string, rows: () => Row[]) => ({ findUnique: first(`${name}.findUnique`, rows) });
  const db = {
    storyWork: model('work', { findFirst: first('work', () => [state.work]) }),
    storyReaderProgress: model('progress', { findUnique: jest.fn(async (query: Query) => {
      read('progress');
      const scope = query.where!.userId_workId;
      return state.progress.userId === scope.userId && state.progress.workId === scope.workId ? selected(state.progress, query.select) : null;
    }) }),
    storyRelease: model('release', { findFirst: first('release', () => [state.release]) }),
    storyManuscriptVersion: model('manuscript', { findFirst: first('manuscript', () => state.manuscripts) }),
    storyAnalysisJob: model('analysis', { findFirst: first('analysis', () => state.analyses) }),
    storyWorkGenerationProfile: model('profile', { findFirst: first('profile', () => state.profiles), ...unique('profile', () => state.profiles) }),
    storyAiGeneratedScene: model('generated', { findFirst: first('generated', () => [state.generated]) }),
    storyScene: model('canonical', { findFirst: first('canonical', () => [state.canonical]) }),
    storyPart: model('part', { findFirst: first('part', () => [state.part]) }),
    storyAiContinuation: model('origin', { findFirst: first('origin', () => [state.origin]) }),
    storyAiGeneratedChoice: model('choice', { findFirst: first('choice', () => [state.choice]) }),
    storyChoice: model('choice', { findFirst: first('choice', () => [state.choice]) }),
    storyAiGeneratedBeat: model('generatedBeat', { findMany: jest.fn(async (query: Query) => {
      read('generatedBeat'); return state.beats.filter(row => matches(row, query.where)).map(row => selected(row, query.select));
    }) }),
    storyBeat: model('canonicalBeat', { findMany: jest.fn(async (query: Query) => {
      read('canonicalBeat'); return state.beats.filter(row => matches(row, query.where)).map(row => selected(row, query.select));
    }) }),
    storyReleaseCapability: model('capability', unique('capability', () => [state.capability])),
    storyAiRateCard: model('rate', unique('rate', () => [state.rate])),
    $executeRaw: jest.fn(async (sql: { strings: readonly string[]; values: unknown[] }) => {
      if (!trace || trace.length || sql.strings.join('') !== 'SET TRANSACTION READ ONLY' || sql.values.length) throw new Error('Unexpected SQL');
      trace.push('READ ONLY'); return 0;
    }),
    $queryRaw: jest.fn(() => { throw new Error('Raw/locking query prohibited'); }),
  };
  const prisma = { $transaction: jest.fn(async (callback: (tx: typeof db) => Promise<unknown>, options: unknown) => {
    expect(options).toEqual({ isolationLevel: 'RepeatableRead' });
    expect(trace).toBeNull();
    trace = []; traces.push(trace);
    try { return await callback(db); } finally { trace.push('closed'); trace = null; }
  }) };
  const context = jest.spyOn(contextReader, 'readStoryContinuationDiagnosticContext').mockImplementation(async (_tx, input) => ({
    sourceScene: { title: PRIVATE, beats: [{ beatType: 'paragraph', content: 'a'.repeat(5200) }] },
    selectedChoice: { label: PRIVATE }, path: [], memories: [{ memoryType: 'author_plan_foreshadow', content: PRIVATE }],
    narrativeLength: authorPartStoryContinuationLengthBounds(input.locale, ['a'.repeat(6034)]),
    generationProfile: input.generationProfile,
  }));
  const inspect = jest.spyOn(inspector, 'inspectStoryContinuationFixedCapFit');
  const service = new StoryAuthorCurrentFitService(prisma as never);
  const run = (locale = 'ko', revision = 52, choice = choiceId) => service.inspect(owner, workId,
    { locale, expectedProgressRevision: revision, choiceId: choice });
  const unchanged = (before: string) => {
    expect(stableJson(state)).toBe(before);
    writes.forEach(write => expect(write).not.toHaveBeenCalled());
    expect(db.$queryRaw).not.toHaveBeenCalled();
    traces.forEach(items => { expect(items[0]).toBe('READ ONLY'); expect(items.at(-1)).toBe('closed'); });
  };
  return { state, service, run, context, inspect, prisma, db, traces, unchanged };
}

describe('current owner fixed-cap snapshot service (synthetic context projection)', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(locales)('binds full approved profile and actual request builder/tokenizer in %s', async locale => {
    const f = fixture(), before = stableJson(f.state);
    const result = await f.run(locale);
    expect(result).toMatchObject({ outcome: 'request_checked', currentSourceState: 'validated', approvalReferenceVerified: true,
      progressRevision: 52, manuscriptVersion: 1, analysisVersion: 2, profileVersion: 1, reviewRevision: 1,
      providerCalls: 0, operatingWrites: 0, dispatchAuthorized: false, semanticQualityVerified: false,
      legalAuthorization: 'not_evaluated', paidApproval: 'not_evaluated',
      diagnostic: { inputFit: 'within_policy_bound', currentApprovalVerified: false, outputFit: 'unmeasured', multiStageFit: 'unimplemented' } });
    const [input, config] = f.inspect.mock.calls[0];
    const body = prepareStoryContinuationOpenAiRequestForDiagnostics(input, config);
    expect(result.diagnostic!.inputTokenBudget).toBe(storyContinuationInputTokenBudget(body));
    expect(result.diagnostic!.requestBytes).toBe(Buffer.byteLength(JSON.stringify(body), 'utf8'));
    const projected = JSON.parse(body.input[0].content[0].text);
    const style = projected.generationProfile.sections.find((section: Row) => section.key === 'writing_style').value;
    expect(style.observations.map((item: Row) => item.detail)).toEqual(['first style rule', 'middle style rule', 'mandatory uncut style tail']);
    expect(style.categories[0].observations).toEqual(['first category', 'tail category']);
    expect(style.customRule).toBe('full generic value');
    expect(projected.generationProfile.sections).toHaveLength(8);
    const publicJson = JSON.stringify(result);
    [PRIVATE, owner, workId, releaseId, manuscriptId, profileId, f.state.profiles[0].sourceFingerprint].filter(Boolean)
      .forEach(secret => expect(publicJson).not.toContain(secret));
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    f.unchanged(before);
  });

  it.each(locales)('keeps an oversized valid approved style intact and distinguishes its context limit in %s', async locale => {
    const f = fixture(), profile = f.state.profiles[0];
    const style = profile.approvedSettings.sections.find((section: Row) => section.key === 'writing_style');
    style.value.summary = '\uac00'.repeat(7999);
    profile.approvedFingerprint = creatorGenerationProfileFingerprint(profile.sourceFingerprint, profile.approvedSettings);
    const before = stableJson(f.state);
    const approval = await f.prisma.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      return readCurrentApprovedStoryStyleSnapshot(tx as never, owner, workId);
    },
      { isolationLevel: 'RepeatableRead' }) as Awaited<ReturnType<typeof readCurrentApprovedStoryStyleSnapshot>>;
    expect(approval.projection.section.value.summary).toBe(style.value.summary);
    const result = await f.run(locale);
    expect(result).toMatchObject({ outcome: 'current_source_unavailable', reason: 'approved_profile_context_too_large',
      approvalReferenceVerified: false, diagnostic: null, providerCalls: 0, operatingWrites: 0,
      dispatchAuthorized: false, semanticQualityVerified: false, legalAuthorization: 'not_evaluated', paidApproval: 'not_evaluated' });
    expect(f.context).not.toHaveBeenCalled();
    expect(f.inspect).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(style.value.summary);
    f.unchanged(before);
  });

  it('uses the canonical source kind only when it is the one active source', async () => {
    const f = fixture(); f.state.progress.currentGeneratedSceneId = null; f.state.progress.currentSceneId = sceneId;
    const result = await f.run();
    expect(result.outcome).toBe('request_checked');
    expect(f.context.mock.calls[0][1].sourceKind).toBe('canonical');
    expect(f.db.storyAiContinuation.findFirst).not.toHaveBeenCalled();
  });

  it.each(locales)('keeps numeric oversized-view evidence private and distinct from model input in %s', async locale => {
    const f = fixture(), profile = f.state.profiles[0];
    const style = profile.approvedSettings.sections.find((section: Row) => section.key === 'writing_style').value;
    style.summary = '\uac00'.repeat(7900);
    profile.approvedFingerprint = creatorGenerationProfileFingerprint(profile.sourceFingerprint, profile.approvedSettings);
    const before = stableJson(f.state), result = await f.run(locale);
    if (!('profileViewDiagnostic' in result) || !result.profileViewDiagnostic) throw new Error('Missing typed view-size result');
    const sizes = result.profileViewDiagnostic;
    expect(sizes).toMatchObject({ contract: 'story-profile-view-byte-diagnostic-v1', byteCap: 16384,
      projectionTiers: 3, scopeObservationCount: 3, modelInputFit: 'unmeasured',
      compactViewFit: 'unmeasured', semanticQualityVerified: false });
    expect(sizes.minimumProjectedViewBytes).toBeGreaterThan(16384);
    expect(sizes.writingStyleSectionBytes).toBeLessThanOrEqual(sizes.minimumProjectedViewBytes);
    expect(sizes.trustedRepeatedScopeBytes).toBe(3 * Buffer.byteLength(',"referenceScope":"writing_pattern"'));
    expect(result).toMatchObject({ outcome: 'current_source_unavailable', reason: 'approved_profile_context_too_large',
      approvalReferenceVerified: false, diagnostic: null, providerCalls: 0, operatingWrites: 0,
      dispatchAuthorized: false, semanticQualityVerified: false, paidApproval: 'not_evaluated', legalAuthorization: 'not_evaluated' });
    for (const secret of [PRIVATE, style.summary, owner, workId, profile.id, profile.sourceFingerprint, profile.approvedFingerprint]) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(f.context).not.toHaveBeenCalled(); expect(f.inspect).not.toHaveBeenCalled(); f.unchanged(before);
  });

  it('does not turn a same-message generic error with forged fields into measured evidence', async () => {
    const f = fixture(), before = stableJson(f.state);
    const forged = Object.assign(new Error('generation_profile_context_too_large'), {
      profileViewDiagnostic: { privateText: PRIVATE, minimumProjectedViewBytes: 99999 },
    });
    jest.spyOn(profilePolicy, 'continuationGenerationProfileSnapshot').mockImplementation(() => { throw forged; });
    const result = await f.run();
    expect(result).toMatchObject({ reason: 'approved_profile_context_too_large', diagnostic: null });
    expect(result).not.toHaveProperty('profileViewDiagnostic');
    expect(JSON.stringify(result)).not.toContain(PRIVATE); f.unchanged(before);
  });

  it.each(['stale', 'unapproved'])('exposes no size report for %s approval', async change => {
    const f = fixture(), profile = f.state.profiles[0];
    const style = profile.approvedSettings.sections.find((section: Row) => section.key === 'writing_style').value;
    style.summary = '\uac00'.repeat(7900);
    profile.approvedFingerprint = creatorGenerationProfileFingerprint(profile.sourceFingerprint, profile.approvedSettings);
    if (change === 'stale') style.summary += 'changed';
    else profile.status = 'needs_review';
    const before = stableJson(f.state), result = await f.run();
    expect(result).toMatchObject({ reason: 'approval_unavailable', diagnostic: null });
    expect(result).not.toHaveProperty('profileViewDiagnostic');
    expect(f.context).not.toHaveBeenCalled(); f.unchanged(before);
  });

  const invalidStates: Array<[string, (state: ReturnType<typeof fixture>['state']) => void, string]> = [
    ['pending progress', s => { s.progress.status = 'ai_pending'; }, 'progress_unavailable'],
    ['completed progress', s => { s.progress.status = 'completed'; }, 'progress_unavailable'],
    ['changed revision', s => { s.progress.progressRevision++; }, 'progress_changed'],
    ['retired release', s => { s.release.status = 'retired'; }, 'release_unavailable'],
    ['different active release', s => { s.progress.activeReleaseId = uuid(30); }, 'release_unavailable'],
    ['wrong story version', s => { s.progress.storyVersion++; }, 'release_unavailable'],
    ['invalid release checksum', s => { s.release.checksum = PRIVATE; }, 'release_unavailable'],
    ['release bound to older manuscript', s => { s.release.manuscriptVersionId = uuid(31); }, 'source_scope_mismatch'],
    ['unreviewed latest profile', s => { s.profiles.push({ ...s.profiles[0], id: uuid(32), profileVersion: 2, status: 'needs_review' }); }, 'approval_unavailable'],
    ['latest manuscript not analysed', s => { s.manuscripts.push({ ...s.manuscripts[0], id: uuid(33), version: 2 }); }, 'approval_unavailable'],
    ['failed analysis', s => { s.analyses[0].status = 'failed'; }, 'approval_unavailable'],
    ['changed analysis hash', s => { s.analyses[0].sourceContentHash = 'd'.repeat(64); }, 'approval_unavailable'],
    ['changed profile fingerprint', s => { s.profiles[0].approvedFingerprint = 'e'.repeat(64); }, 'approval_unavailable'],
    ['wrong approver', s => { s.profiles[0].approvedByUserId = uuid(35); }, 'approval_unavailable'],
    ['ambiguous current source', s => { s.progress.currentSceneId = sceneId; }, 'source_unavailable'],
    ['foreign generated source', s => { s.generated.userId = uuid(36); }, 'source_unavailable'],
    ['non-ready source', s => { s.generated.status = 'pending'; }, 'source_unavailable'],
    ['failed generated origin', s => { s.origin.status = 'failed'; }, 'source_unavailable'],
    ['mismatched origin result', s => { s.origin.resultGeneratedSceneId = uuid(37); }, 'source_unavailable'],
    ['draft part', s => { s.part.status = 'draft'; }, 'source_unavailable'],
    ['fixture part', s => { s.part.fixtureSource = true; }, 'source_unavailable'],
    ['unread beats', s => { s.progress.currentBeatPosition = 2; }, 'source_not_fully_read'],
    ['duplicate beat positions', s => { s.beats[2].position = 2; }, 'source_not_fully_read'],
    ['choice belongs to another source', s => { s.choice.sceneId = uuid(38); }, 'choice_unavailable'],
    ['not generation choice', s => { s.choice.routeKind = 'branch'; }, 'choice_unavailable'],
    ['stale capability revision', s => { s.capability.revision++; }, 'capability_unavailable'],
    ['foreign capability work', s => { s.capability.workId = uuid(39); }, 'capability_unavailable'],
    ['changed fixed input limit', s => { s.capability.aiInputTokenLimit++; }, 'fixed_cap_settings_mismatch'],
    ['changed fixed output limit', s => { s.capability.aiOutputTokenLimit++; }, 'fixed_cap_settings_mismatch'],
    ['retired rate', s => { s.rate.status = 'retired'; }, 'capability_unavailable'],
  ];
  it.each(invalidStates)('returns finite unavailable for %s without repair', async (_name, edit, reason) => {
    const f = fixture(); edit(f.state); const before = stableJson(f.state);
    const result = await f.run();
    expect(result).toMatchObject({ outcome: 'current_source_unavailable', reason, diagnostic: null,
      approvalReferenceVerified: false, progressRevision: null, profileVersion: null, dispatchAuthorized: false });
    expect(f.inspect).not.toHaveBeenCalled(); expect(f.context).not.toHaveBeenCalled(); f.unchanged(before);
  });

  it('does not treat an explicit canonical target as a generation request', async () => {
    const f = fixture(); f.state.progress.currentGeneratedSceneId = null; f.state.progress.currentSceneId = sceneId;
    f.state.choice.targetSceneId = uuid(40) as never;
    expect(await f.run()).toMatchObject({ reason: 'choice_unavailable', diagnostic: null });
  });

  it('does not disclose existence to another owner', async () => {
    const f = fixture(), before = stableJson(f.state);
    await expect(f.service.inspect(uuid(41), workId, { locale: 'ko', expectedProgressRevision: 52, choiceId })).rejects.toBeInstanceOf(NotFoundException);
    expect(f.context).not.toHaveBeenCalled(); f.unchanged(before);
  });

  it('returns unmeasured for an unsupported model without a provider call', async () => {
    const f = fixture(); f.state.rate.model = 'unknown-model';
    expect(await f.run()).toMatchObject({ outcome: 'request_checked', diagnostic: {
      inputFit: 'unmeasured', reason: 'provider_model_encoding_unknown', inputTokenBudget: null, requestBytes: null } });
  });

  it('keeps an expected context mismatch private and does not retry', async () => {
    const f = fixture(); f.context.mockRejectedValue(new contextReader.StoryContinuationDiagnosticContextUnavailable());
    const result = await f.run();
    expect(result).toMatchObject({ reason: 'context_unavailable', diagnostic: null });
    expect(JSON.stringify(result)).not.toContain(PRIVATE); expect(f.context).toHaveBeenCalledTimes(1);
  });

  it('masks an unexpected context failure as service failure, not ordinary source unavailability', async () => {
    const f = fixture(); f.context.mockRejectedValue(new Error(PRIVATE));
    await expect(f.run()).rejects.toMatchObject(new ServiceUnavailableException({ code: 'STORY_AUTHOR_CURRENT_FIT_UNAVAILABLE' }));
    expect(f.context).toHaveBeenCalledTimes(1); expect(f.inspect).not.toHaveBeenCalled();
  });

  it('masks database failure and does not retry', async () => {
    const f = fixture(); f.db.storyRelease.findFirst.mockImplementation(async () => { throw new Error(PRIVATE); });
    await expect(f.run()).rejects.toMatchObject(new ServiceUnavailableException({ code: 'STORY_AUTHOR_CURRENT_FIT_UNAVAILABLE' }));
    expect(f.db.storyRelease.findFirst).toHaveBeenCalledTimes(1);
  });

  it('duplicate diagnostics are two independent reads, not two operations', async () => {
    const f = fixture(), before = stableJson(f.state);
    expect(await f.run()).toEqual(await f.run()); expect(f.prisma.$transaction).toHaveBeenCalledTimes(2); f.unchanged(before);
  });

  it.each([NaN, Infinity, -1, 2147483648, '52', null])('rejects bad service revision %s before transaction', async revision => {
    const f = fixture();
    await expect(f.run('ko', revision as number)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['', '52 ', ' 52', '052', '1.5', '1e2', '2147483648'])('rejects malformed DTO revision %s', async revision => {
    const query = plainToInstance(StoryAuthorCurrentFitQueryDto, { locale: 'ko', choiceId, expectedProgressRevision: revision });
    expect((await validate(query)).length).toBeGreaterThan(0);
  });
});

describe('current-fit private read HTTP boundary', () => {
  let app: INestApplication, port: number, jwt: JwtService;
  const inspect = jest.fn(async () => ({ contract: 'synthetic-current-fit-boundary', dispatchAuthorized: false }));
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [StoryAuthorCurrentFitController], providers: [JwtAuthGuard,
      { provide: StoryAuthorCurrentFitService, useValue: { inspect } },
      { provide: ConfigService, useValue: { getOrThrow: (key: string) => {
        if (key !== 'JWT_ACCESS_SECRET') throw new Error('Unexpected configuration read');
        return 'synthetic-test-only-secret';
      } } },
      { provide: PrismaService, useValue: { user: { findFirst: async () => ({ id: owner, email: 'synthetic@example.invalid' }) } } },
      { provide: JwtService, useValue: new JwtService({ secret: 'synthetic-test-only-secret' }) }] }).compile();
    jwt = module.get(JwtService); app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1'); port = (app.getHttpServer().address() as AddressInfo).port;
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => inspect.mockClear());
  const call = (suffix: string, authenticated = true, method = 'GET') => new Promise<{ status: number; cache: string | undefined; bytes: number }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, method,
      path: `/me/creator-studio/stories/${workId}/body-preview/current-fit${suffix}`,
      headers: authenticated ? { Authorization: `Bearer ${jwt.sign({ sub: owner, email: 'synthetic@example.invalid', tokenType: 'access' })}` } : {} }, res => {
      let bytes = 0; res.on('data', buffer => { bytes += buffer.length; });
      res.on('end', () => resolve({ status: res.statusCode!, cache: res.headers['cache-control'], bytes }));
    }); req.on('error', reject); req.end();
  });
  it('anonymous request is no-store and never reaches reads', async () => {
    expect(await call('', false)).toMatchObject({ status: 401, cache: 'private, no-store' }); expect(inspect).not.toHaveBeenCalled();
  });
  it('valid explicit query reaches only the read service', async () => {
    expect(await call(`?locale=ko&choiceId=${choiceId}&expectedProgressRevision=52`)).toMatchObject({ status: 200, cache: 'private, no-store' });
    expect(inspect).toHaveBeenCalledWith(owner, workId, expect.objectContaining({ locale: 'ko', choiceId, expectedProgressRevision: 52 }));
  });
  it.each(['?locale=ko', `?locale=xx&choiceId=${choiceId}&expectedProgressRevision=52`,
    `?locale=ko&choiceId=${choiceId}&expectedProgressRevision=52&outputTokenLimit=32768`,
    `?locale=ko&choiceId=${choiceId}&expectedProgressRevision=52%20`])('bad query %s is no-store without reads', async suffix => {
    expect(await call(suffix)).toMatchObject({ status: 400, cache: 'private, no-store' }); expect(inspect).not.toHaveBeenCalled();
  });
  it('anonymous HEAD is no-store, empty and never reaches reads', async () => {
    expect(await call('', false, 'HEAD')).toEqual({ status: 401, cache: 'private, no-store', bytes: 0 });
    expect(inspect).not.toHaveBeenCalled();
  });
  it('authenticated HEAD preserves private read semantics with an empty response', async () => {
    expect(await call(`?locale=ko&choiceId=${choiceId}&expectedProgressRevision=52`, true, 'HEAD'))
      .toEqual({ status: 200, cache: 'private, no-store', bytes: 0 });
    expect(inspect).toHaveBeenCalledTimes(1);
  });
});
