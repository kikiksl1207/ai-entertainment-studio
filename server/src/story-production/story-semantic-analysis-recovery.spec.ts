import 'reflect-metadata';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Decimal } from '@prisma/client/runtime/library';
import { validate } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RecoverStoryAnalysisProfileDto } from './dto/story-semantic-analysis.dto';
import { StoryProductionController } from './story-production.controller';
import { semanticPinHash, semanticPins } from './story-semantic-analysis.config';
import { SemanticAnalysisService, streamedManuscriptHash } from './story-semantic-analysis.service';
import { semanticTestConfig } from './story-semantic-analysis.test-fixture';

function fixture() {
  const pins = semanticPins(semanticTestConfig());
  const body = { parts: [{ partKey: 'part-1', paragraphs: [{ kind: 'paragraph', text: 'Synthetic source.' }] }] };
  const job = {
    id: 'job', workId: 'work', actorUserId: 'owner', manuscriptVersionId: 'source', analysisVersion: 1,
    pipeline: 'semantic_extraction_v1', status: 'failed', phase: 'finalizing',
    errorCode: 'analysis_profile_draft_unavailable', sourceLocale: 'ko', sourceContentHash: 'a'.repeat(64),
    sourceDigest: streamedManuscriptHash(body), configPins: pins, configHash: semanticPinHash(pins),
    totalParagraphs: 1, plannedParagraphs: 1, completedParagraphs: 1, plannedChunks: 1, completedChunks: 1,
    observedCostKrw: new Decimal('0.2'), reservedCostKrw: new Decimal('1'),
    reservedInputTokens: 8192, reservedOutputTokens: 2048, result: { evidenceCount: 1, profileDraftAttempts: 3 },
  };
  const counts = { _all: 1, dispatchStartedAt: 1, completedAt: 1, inputTokens: 1,
    outputTokens: 1, cachedInputTokens: 1, reasoningTokens: 1, actualCostKrw: 1 };
  const aggregate = { _count: counts, _min: { ordinal: 0 }, _max: { ordinal: 0 },
    _sum: { paragraphCount: 1, inputTokenBudget: 8192, inputTokens: 100, outputTokens: 50, actualCostKrw: new Decimal('0.2') } };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValueOnce([{ id: 'work' }]).mockResolvedValueOnce([{ leaseActive: false }]),
    storyAnalysisJob: { findUniqueOrThrow: jest.fn().mockResolvedValue(job),
      update: jest.fn().mockImplementation(async ({ data }) => ({ ...job, ...data })) },
    storyManuscriptVersion: { findFirst: jest.fn()
      .mockResolvedValueOnce({ id: 'source', contentHash: job.sourceContentHash, locale: 'ko', structuredBody: body })
      .mockResolvedValueOnce({ id: 'source' }) },
    storyAnalysisChunk: { aggregate: jest.fn().mockResolvedValue(aggregate), findFirst: jest.fn().mockResolvedValue(null) },
    storyContinuityEntry: { count: jest.fn().mockResolvedValue(0) },
    auditEvent: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
  };
  const db = { $transaction: jest.fn(async run => run(tx)) };
  const owned = jest.fn().mockResolvedValue(job);
  const provider = { readiness: jest.fn(), generate: jest.fn() };
  const profiles = { createDraftAtCompletion: jest.fn().mockResolvedValue({ status: 'needs_review' }), autoApproveCompany: jest.fn() };
  const service = new SemanticAnalysisService({ prisma: db, owned } as never, provider as never, profiles as never);
  return { job, body, aggregate, tx, db, provider, profiles, service, owned,
    recover: () => service.recoverProfile('owner', 'job', job.sourceContentHash) };
}

describe('Local semantic generation-profile recovery', () => {
  it('restores the review draft and final state without any provider or automatic approval', async () => {
    const f = fixture();
    expect(f.service.project(f.job as never).profileRecovery).toEqual({ available: true, mode: 'local_settings_only' });
    expect(await f.recover()).toMatchObject({ status: 'completed', phase: 'completed',
      semanticCompleted: true, approval: 'not_approved', memoryApproved: false,
      budget: { actualCostKrw: '0.2', reservedCostKrw: '1' }, profileRecovery: { available: false } });
    expect(f.profiles.createDraftAtCompletion).toHaveBeenCalledWith(f.tx, expect.objectContaining({ status: 'running', phase: 'finalizing' }));
    expect(f.provider.readiness).not.toHaveBeenCalled();
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.profiles.autoApproveCompany).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      actorUserId: 'owner', action: 'story_analysis.profile_recovered', metadata: expect.objectContaining({ providerRequests: 0 }),
    }) }));
    expect(f.tx.storyAnalysisJob.update.mock.calls[1][0].data).not.toHaveProperty('configPins');
    expect(f.tx.storyAnalysisJob.update.mock.calls[1][0].data).not.toHaveProperty('reservedCostKrw');
  });

  it.each([
    { pipeline: 'structural_legacy' }, { status: 'running' }, { phase: 'extracting' },
    { errorCode: 'provider_outcome_unknown' }, { result: { usageUnobserved: true } },
    { completedChunks: 0 }, { completedParagraphs: 0 }, { totalParagraphs: 0 },
  ])('does not offer or execute recovery for an unsafe source %p', async change => {
    const f = fixture(); Object.assign(f.job, change);
    expect(f.service.project(f.job as never).profileRecovery.available).toBe(false);
    await expect(f.recover()).rejects.toMatchObject({ response: { code: 'ANALYSIS_PROFILE_RECOVERY_UNAVAILABLE' } });
    expect(f.tx.storyAnalysisJob.update).not.toHaveBeenCalled();
  });

  it('blocks a live or ambiguous lease', async () => {
    const f = fixture(); f.tx.$queryRaw.mockReset().mockResolvedValueOnce([{ id: 'work' }]).mockResolvedValueOnce([{ leaseActive: true }]);
    await expect(f.recover()).rejects.toMatchObject({ response: { code: 'ANALYSIS_PROFILE_RECOVERY_UNAVAILABLE' } });
    expect(f.profiles.createDraftAtCompletion).not.toHaveBeenCalled();
  });

  it.each(['missingUsage', 'costMismatch', 'overReservation', 'partialChunk', 'unfinishedContinuity'])('checks durable completion rather than trusting a failure code: %s', async change => {
    const f = fixture();
    if (change === 'missingUsage') f.aggregate._count.inputTokens = 0;
    if (change === 'costMismatch') f.aggregate._sum.actualCostKrw = new Decimal('0.3');
    if (change === 'overReservation') f.aggregate._sum.outputTokens = 2049;
    if (change === 'partialChunk') f.tx.storyAnalysisChunk.findFirst.mockResolvedValue({ id: 'unfinished' } as never);
    if (change === 'unfinishedContinuity') f.tx.storyContinuityEntry.count.mockResolvedValue(1);
    await expect(f.recover()).rejects.toMatchObject({ response: { code: 'ANALYSIS_PROFILE_RECOVERY_UNAVAILABLE' } });
    expect(f.tx.storyAnalysisJob.update).not.toHaveBeenCalled();
  });

  it.each(['requestHash', 'newVersion', 'sourceBody', 'configHash'])('refuses stale or altered recovery: %s', async change => {
    const f = fixture();
    if (change === 'newVersion') f.tx.storyManuscriptVersion.findFirst.mockReset()
      .mockResolvedValueOnce({ id: 'source', contentHash: f.job.sourceContentHash, locale: 'ko', structuredBody: f.body })
      .mockResolvedValueOnce({ id: 'new-source' });
    if (change === 'sourceBody') f.body.parts[0].paragraphs[0].text = 'Changed source';
    if (change === 'configHash') f.job.configHash = 'b'.repeat(64);
    await expect(change === 'requestHash' ? f.service.recoverProfile('owner', 'job', 'b'.repeat(64)) : f.recover())
      .rejects.toMatchObject({ response: { code: 'ANALYSIS_RECOVERY_SOURCE_CHANGED' } });
    expect(f.tx.storyAnalysisJob.update).not.toHaveBeenCalled();
  });

  it('rechecks ownership after locking and keeps private diagnostics out of retry errors', async () => {
    const f = fixture(); f.job.actorUserId = 'stranger';
    await expect(f.recover()).rejects.toMatchObject({ status: 404 });
    const failed = fixture(); failed.profiles.createDraftAtCompletion.mockRejectedValue(new Error('secret/private manuscript diagnostic'));
    await expect(failed.recover()).rejects.toMatchObject({ response: { code: 'ANALYSIS_PROFILE_RECOVERY_RETRY' } });
    expect(failed.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('replays an already committed recovery without drafting or auditing twice', async () => {
    const f = fixture(); f.job.status = 'completed'; f.job.phase = 'completed';
    f.tx.auditEvent.findFirst.mockResolvedValue({ id: 'recovery-audit' } as never);
    expect(await f.recover()).toMatchObject({ status: 'completed' });
    expect(f.tx.storyAnalysisJob.update).not.toHaveBeenCalled();
    expect(f.profiles.createDraftAtCompletion).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('guards and validates the writer action', async () => {
    const action = StoryProductionController.prototype.recoverAnalysisProfile;
    expect(Reflect.getMetadata(PATH_METADATA, action)).toBe('me/creator-studio/analyses/:analysisId/recover-profile');
    expect(Reflect.getMetadata(GUARDS_METADATA, action)).toContain(JwtAuthGuard);
    const input = new RecoverStoryAnalysisProfileDto();
    expect(await validate(input)).not.toHaveLength(0);
    input.expectedSourceContentHash = 'a'.repeat(64);
    expect(await validate(input)).toHaveLength(0);
    input.expectedSourceContentHash = '<private>';
    expect(await validate(input)).not.toHaveLength(0);
  });
});
