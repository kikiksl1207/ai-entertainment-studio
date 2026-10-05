import { semanticPinHash, semanticPins } from './story-semantic-analysis.config';
import { semanticTestConfig } from './story-semantic-analysis.test-fixture';
import { SemanticAnalysisService } from './story-semantic-analysis.service';

function fixture(withCompanySubmission = true) {
  const config = semanticTestConfig();
  const pins = semanticPins(config);
  const job = {
    id: 'job', workId: 'work', manuscriptVersionId: 'manuscript', actorUserId: 'owner' as string | null,
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
  const provider = { config, readiness: jest.fn().mockResolvedValue({ enabled: true }),
    generate: jest.fn(), preflight: jest.fn() };
  const profiles = { createDraftAtCompletion: jest.fn().mockResolvedValue({ status: 'needs_review' }),
    autoApproveCompany: jest.fn().mockResolvedValue(null) };
  const companySubmission = { autoSubmitCompletedAnalysis: jest.fn().mockResolvedValue(null) };
  const service = new SemanticAnalysisService(repository as never, provider as never, profiles as never,
    withCompanySubmission ? companySubmission as never : undefined);
  jest.spyOn(service as any, 'source').mockResolvedValue([]);
  const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  return { job, tx, repository, provider, profiles, companySubmission, service, warn };
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
    expect(f.profiles.autoApproveCompany).toHaveBeenCalledWith('owner', 'work', {
      manuscriptVersionId: 'manuscript', analysisJobId: 'job',
    });
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
    expect(f.companySubmission.autoSubmitCompletedAnalysis).not.toHaveBeenCalled();
    expect(await f.service.executeOne('worker')).toEqual({ status: 'processed' });
    expect(f.profiles.createDraftAtCompletion).toHaveBeenCalledTimes(2);
    expect(f.profiles.autoApproveCompany).toHaveBeenCalledTimes(1);
    expect(f.tx.storyAnalysisJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed' }),
    }));
    expect(f.companySubmission.autoSubmitCompletedAnalysis).toHaveBeenCalledTimes(1);
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('keeps a completed analysis when company auto-approval needs recovery', async () => {
    const f = fixture();
    f.profiles.autoApproveCompany.mockRejectedValueOnce(new Error('temporary approval failure'));

    expect(await f.service.executeOne('worker')).toEqual({ status: 'processed' });
    expect(f.tx.storyAnalysisJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed' }),
    }));
    expect(f.companySubmission.autoSubmitCompletedAnalysis).not.toHaveBeenCalled();
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('retries when the final status write fails after draft derivation', async () => {
    const f = fixture();
    f.tx.storyAnalysisJob.update.mockRejectedValueOnce(new Error('temporary status write failure'));

    expect(await f.service.executeOne('worker')).toEqual({ status: 'retry_wait' });
    expect(f.profiles.createDraftAtCompletion).toHaveBeenCalledTimes(1);
    expect(f.tx.storyAnalysisJob.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { result: { profileDraftAttempts: 1 } },
    }));
    expect(f.companySubmission.autoSubmitCompletedAnalysis).not.toHaveBeenCalled();
    expect(f.profiles.autoApproveCompany).not.toHaveBeenCalled();
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
    expect(f.companySubmission.autoSubmitCompletedAnalysis).not.toHaveBeenCalled();
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('does not backfill a previously completed analysis', async () => {
    const f = fixture();
    f.repository.claim.mockResolvedValue(null);

    expect(await f.service.executeOne('worker')).toEqual({ status: 'idle' });
    expect(f.profiles.createDraftAtCompletion).not.toHaveBeenCalled();
    expect(f.companySubmission.autoSubmitCompletedAnalysis).not.toHaveBeenCalled();
  });

  it.each([
    ['newly approved', { profile: { status: 'approved' } }],
    ['already approved or otherwise unchanged', null],
  ])('checks the current company submission after completion commits with a %s profile', async (_label, approval) => {
    const f = fixture();
    const calls: string[] = [];
    f.repository.leased.mockImplementation(async (_job, run) => {
      const result = await run(f.tx);
      calls.push('committed');
      return result;
    });
    f.profiles.createDraftAtCompletion.mockImplementation(async () => { calls.push('draft'); });
    f.tx.storyAnalysisJob.update.mockImplementation(async () => { calls.push('completed'); });
    f.profiles.autoApproveCompany.mockImplementation(async () => {
      calls.push('profile');
      return approval;
    });
    f.companySubmission.autoSubmitCompletedAnalysis.mockImplementation(async () => {
      calls.push('submission');
      return null;
    });

    expect(await f.service.executeOne('worker')).toEqual({ status: 'processed' });
    expect(calls).toEqual(['draft', 'completed', 'committed', 'profile', 'submission']);
    expect(f.profiles.autoApproveCompany).toHaveBeenCalledWith('owner', 'work', {
      manuscriptVersionId: 'manuscript', analysisJobId: 'job',
    });
    expect(f.companySubmission.autoSubmitCompletedAnalysis).toHaveBeenCalledTimes(1);
    expect(f.companySubmission.autoSubmitCompletedAnalysis).toHaveBeenCalledWith('owner', 'work', 'manuscript', 'job');
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.provider.preflight).not.toHaveBeenCalled();
  });

  it('retains completed extraction when company submission fails without retrying paid generation', async () => {
    const f = fixture();
    const diagnostic = 'Synthetic private receipt failure detail';
    f.companySubmission.autoSubmitCompletedAnalysis.mockRejectedValueOnce(new Error(diagnostic));

    expect(await f.service.executeOne('worker')).toEqual({ status: 'processed' });
    expect(f.repository.leased).toHaveBeenCalledTimes(1);
    expect(f.tx.storyAnalysisJob.update).toHaveBeenCalledTimes(1);
    expect(f.tx.storyAnalysisJob.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed', phase: 'completed', actualCostKrw: f.job.observedCostKrw }),
    }));
    expect(f.companySubmission.autoSubmitCompletedAnalysis).toHaveBeenCalledTimes(1);
    expect(f.warn).toHaveBeenCalledTimes(1);
    expect(f.warn.mock.calls[0][0]).toContain('submission needs review reconciliation');
    expect(f.warn.mock.calls[0][0]).not.toContain(diagnostic);
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.provider.preflight).not.toHaveBeenCalled();
  });

  it('does not approve or submit a completed analysis without an actor', async () => {
    const f = fixture();
    f.job.actorUserId = null;

    expect(await f.service.executeOne('worker')).toEqual({ status: 'processed' });
    expect(f.tx.storyAnalysisJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed', phase: 'completed' }),
    }));
    expect(f.profiles.autoApproveCompany).not.toHaveBeenCalled();
    expect(f.companySubmission.autoSubmitCompletedAnalysis).not.toHaveBeenCalled();
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('preserves profile completion when the optional company submission dependency is absent', async () => {
    const f = fixture(false);

    expect(await f.service.executeOne('worker')).toEqual({ status: 'processed' });
    expect(f.profiles.autoApproveCompany).toHaveBeenCalledWith('owner', 'work', {
      manuscriptVersionId: 'manuscript', analysisJobId: 'job',
    });
    expect(f.companySubmission.autoSubmitCompletedAnalysis).not.toHaveBeenCalled();
    expect(f.tx.storyAnalysisJob.update).toHaveBeenCalledTimes(1);
    expect(f.warn).not.toHaveBeenCalled();
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('does not approve or submit when the completion transaction fails to commit', async () => {
    const f = fixture();
    f.repository.leased.mockImplementationOnce(async (_job, run) => {
      await run(f.tx);
      throw new Error('Synthetic completion commit failure');
    });

    expect(await f.service.executeOne('worker')).toEqual({ status: 'retry_wait' });
    expect(f.profiles.createDraftAtCompletion).toHaveBeenCalledTimes(1);
    expect(f.tx.storyAnalysisJob.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { result: { profileDraftAttempts: 1 } },
    }));
    expect(f.profiles.autoApproveCompany).not.toHaveBeenCalled();
    expect(f.companySubmission.autoSubmitCompletedAnalysis).not.toHaveBeenCalled();
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.provider.preflight).not.toHaveBeenCalled();
  });
});
