import { semanticPinHash, semanticPins } from './story-semantic-analysis.config';
import { semanticTestConfig } from './story-semantic-analysis.test-fixture';
import { SemanticAnalysisService } from './story-semantic-analysis.service';

function fixture() {
  const config = semanticTestConfig();
  const pins = semanticPins(config);
  const job = {
    id: 'job', workId: 'work', manuscriptVersionId: 'manuscript', actorUserId: 'owner',
    pipeline: 'semantic_extraction_v1', status: 'running', phase: 'finalizing',
    configPins: pins, configHash: semanticPinHash(pins), result: {},
    leaseToken: 'lease', observedCostKrw: 1,
  };
  const tx = { storyAnalysisJob: { update: jest.fn().mockResolvedValue({}) } };
  const db = {
    storyAnalysisChunk: { findFirst: jest.fn().mockResolvedValue(null) },
    storyContinuityEntry: {
      findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0),
    },
  };
  const repository = {
    prisma: db,
    claim: jest.fn().mockResolvedValue(job),
    leased: jest.fn(async (_job: unknown, run: (client: { storyAnalysisJob: { update: jest.Mock } }) => Promise<unknown>) => run(tx)),
  };
  const provider = { config, readiness: jest.fn().mockResolvedValue({ enabled: true }) };
  const profiles = { createDraftAtCompletion: jest.fn().mockResolvedValue({ status: 'needs_review' }),
    autoApproveCompany: jest.fn().mockResolvedValue(null) };
  const service = new SemanticAnalysisService(repository as never, provider as never, profiles as never);
  jest.spyOn(service as any, 'source').mockResolvedValue([]);
  return { job, tx, repository, profiles, service };
}

describe('Semantic analysis profile completion', () => {
  it('commits a review draft before the completed state', async () => {
    const f = fixture();
    const calls: string[] = [];
    f.profiles.createDraftAtCompletion.mockImplementation(async () => { calls.push('draft'); });
    f.tx.storyAnalysisJob.update.mockImplementation(async () => { calls.push('complete'); });

    expect(await f.service.executeOne('worker')).toEqual({ status: 'processed' });
    expect(calls).toEqual(['draft', 'complete']);
    expect(f.tx.storyAnalysisJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed', phase: 'completed' }),
    }));
    expect(f.profiles.createDraftAtCompletion).toHaveBeenCalledTimes(1);
    expect(f.profiles.autoApproveCompany).toHaveBeenCalledWith('owner', 'work');
  });

  it('retries a failed draft without publishing completion, then succeeds once', async () => {
    const f = fixture();
    f.profiles.createDraftAtCompletion.mockRejectedValueOnce(new Error('temporary write failure'));
    f.repository.claim.mockResolvedValueOnce(f.job).mockResolvedValueOnce({
      ...f.job, result: { profileDraftAttempts: 1 },
    });

    expect(await f.service.executeOne('worker')).toEqual({ status: 'retry_wait' });
    expect(f.tx.storyAnalysisJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { result: { profileDraftAttempts: 1 } },
    }));
    expect(f.tx.storyAnalysisJob.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed' }),
    }));
    expect(await f.service.executeOne('worker')).toEqual({ status: 'processed' });
    expect(f.profiles.createDraftAtCompletion).toHaveBeenCalledTimes(2);
    expect(f.profiles.autoApproveCompany).toHaveBeenCalledTimes(1);
    expect(f.tx.storyAnalysisJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed' }),
    }));
  });

  it('keeps a completed analysis when company auto-approval needs recovery', async () => {
    const f = fixture();
    f.profiles.autoApproveCompany.mockRejectedValueOnce(new Error('temporary approval failure'));

    expect(await f.service.executeOne('worker')).toEqual({ status: 'processed' });
    expect(f.tx.storyAnalysisJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed' }),
    }));
  });

  it('retries when the final status write fails after draft derivation', async () => {
    const f = fixture();
    f.tx.storyAnalysisJob.update.mockRejectedValueOnce(new Error('temporary status write failure'));

    expect(await f.service.executeOne('worker')).toEqual({ status: 'retry_wait' });
    expect(f.profiles.createDraftAtCompletion).toHaveBeenCalledTimes(1);
    expect(f.tx.storyAnalysisJob.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { result: { profileDraftAttempts: 1 } },
    }));
  });

  it('fails closed after bounded draft retries', async () => {
    const f = fixture();
    f.profiles.createDraftAtCompletion.mockRejectedValue(new Error('persistent write failure'));
    f.repository.claim.mockResolvedValueOnce(f.job).mockResolvedValueOnce({
      ...f.job, result: { profileDraftAttempts: 1 },
    }).mockResolvedValueOnce({ ...f.job, result: { profileDraftAttempts: 2 } });

    expect(await f.service.executeOne('worker')).toEqual({ status: 'retry_wait' });
    expect(await f.service.executeOne('worker')).toEqual({ status: 'retry_wait' });
    expect(await f.service.executeOne('worker')).toEqual({ status: 'failed' });
    expect(f.tx.storyAnalysisJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', errorCode: 'analysis_profile_draft_unavailable' }),
    }));
    expect(f.tx.storyAnalysisJob.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed' }),
    }));
  });

  it('does not backfill a previously completed analysis', async () => {
    const f = fixture();
    f.repository.claim.mockResolvedValue(null);

    expect(await f.service.executeOne('worker')).toEqual({ status: 'idle' });
    expect(f.profiles.createDraftAtCompletion).not.toHaveBeenCalled();
  });
});
