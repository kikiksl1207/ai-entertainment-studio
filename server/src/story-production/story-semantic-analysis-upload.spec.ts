import { ConflictException } from '@nestjs/common';
import { SemanticAnalysisService } from './story-semantic-analysis.service';
import { semanticTestConfig } from './story-semantic-analysis.test-fixture';

const manuscriptId = '00000000-0000-4000-8000-000000000185';
const userId = '00000000-0000-4000-8000-000000000184';

function service(config = semanticTestConfig()) {
  const provider = { config };
  const analysis = new SemanticAnalysisService({} as never, provider as never, {} as never);
  const enqueue = jest.spyOn(analysis, 'enqueue');
  return { analysis, enqueue };
}

describe('automatic manuscript analysis admission', () => {
  it('does not enqueue paid work without the explicit upload switch and worker', async () => {
    const disabled = service(semanticTestConfig({ enabled: true, workerEnabled: true }));
    expect(await disabled.analysis.enqueueUploadedManuscript(userId, manuscriptId))
      .toEqual({ analysisStarted: false });
    expect(disabled.enqueue).not.toHaveBeenCalled();

    const noWorker = service(semanticTestConfig({ autoEnqueueOnUpload: true, workerEnabled: false }));
    expect(await noWorker.analysis.enqueueUploadedManuscript(userId, manuscriptId))
      .toEqual({ analysisStarted: false });
    expect(noWorker.enqueue).not.toHaveBeenCalled();
  });

  it('honors the manuscript allowlist before scheduling', async () => {
    const { analysis, enqueue } = service(semanticTestConfig({
      autoEnqueueOnUpload: true, workerEnabled: true, manuscriptAllowlist: ['different-manuscript'],
    }));
    expect(await analysis.enqueueUploadedManuscript(userId, manuscriptId)).toEqual({ analysisStarted: false });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('returns the server job receipt with a stable upload key', async () => {
    const { analysis, enqueue } = service(semanticTestConfig({
      autoEnqueueOnUpload: true, workerEnabled: true, manuscriptAllowlist: [manuscriptId],
    }));
    enqueue.mockResolvedValue({ id: 'analysis-job-id' } as never);
    expect(await analysis.enqueueUploadedManuscript(userId, manuscriptId))
      .toEqual({ analysisStarted: true, analysisJobId: 'analysis-job-id' });
    expect(enqueue).toHaveBeenCalledWith(userId, manuscriptId, `manuscript-upload:${manuscriptId}`);
  });

  it('reuses an already reserved job and leaves the manuscript recoverable on queue failure', async () => {
    const { analysis, enqueue } = service(semanticTestConfig({
      autoEnqueueOnUpload: true, workerEnabled: true,
    }));
    enqueue.mockRejectedValueOnce(new ConflictException({
      code: 'ANALYSIS_VERSION_ALREADY_RESERVED', analysisJobId: 'prior-job-id',
    }));
    expect(await analysis.enqueueUploadedManuscript(userId, manuscriptId))
      .toEqual({ analysisStarted: true, analysisJobId: 'prior-job-id' });
    enqueue.mockRejectedValueOnce(new Error('queue unavailable'));
    expect(await analysis.enqueueUploadedManuscript(userId, manuscriptId))
      .toEqual({ analysisStarted: false });
  });
});

describe('transactional upload analysis admission', () => {
  const tx = {} as never;
  function transactional(config = semanticTestConfig()) {
    const enqueueInTransaction = jest.fn();
    const provider = { config, readiness: jest.fn().mockResolvedValue({ enabled: true }) };
    const analysis = new SemanticAnalysisService({ enqueueInTransaction } as never, provider as never, {} as never);
    return { analysis, enqueueInTransaction, provider };
  }

  it('keeps the default, worker and allowlist gates closed', async () => {
    for (const config of [
      semanticTestConfig(),
      semanticTestConfig({ autoEnqueueOnUpload: true }),
      semanticTestConfig({ autoEnqueueOnUpload: true, workerEnabled: true, manuscriptAllowlist: ['other'] }),
    ]) {
      const { analysis, enqueueInTransaction } = transactional(config);
      expect(await analysis.enqueueUploadedManuscriptInTransaction(tx, userId, manuscriptId))
        .toEqual({ analysisStarted: false });
      expect(enqueueInTransaction).not.toHaveBeenCalled();
    }
  });

  it('uses the supplied transaction and stable key, including an existing job', async () => {
    const { analysis, enqueueInTransaction } = transactional(semanticTestConfig({
      autoEnqueueOnUpload: true, workerEnabled: true,
    }));
    enqueueInTransaction.mockResolvedValueOnce({ id: 'analysis-job-id' });
    expect(await analysis.enqueueUploadedManuscriptInTransaction(tx, userId, manuscriptId))
      .toEqual({ analysisStarted: true, analysisJobId: 'analysis-job-id' });
    expect(enqueueInTransaction).toHaveBeenCalledWith(tx, userId, manuscriptId,
      `manuscript-upload:${manuscriptId}`, expect.any(Object));
    enqueueInTransaction.mockRejectedValueOnce(new ConflictException({
      code: 'ANALYSIS_VERSION_ALREADY_RESERVED', analysisJobId: 'analysis-job-id',
    }));
    expect(await analysis.enqueueUploadedManuscriptInTransaction(tx, userId, manuscriptId))
      .toEqual({ analysisStarted: true, analysisJobId: 'analysis-job-id' });
  });

  it('fails the upload transaction when the opted-in queue cannot be written', async () => {
    const { analysis, enqueueInTransaction, provider } = transactional(semanticTestConfig({
      autoEnqueueOnUpload: true, workerEnabled: true,
    }));
    provider.readiness.mockResolvedValueOnce({ enabled: false, reason: 'invalid_config' });
    expect(await analysis.enqueueUploadedManuscriptInTransaction(tx, userId, manuscriptId))
      .toEqual({ analysisStarted: false });
    enqueueInTransaction.mockRejectedValueOnce(new Error('private database detail'));
    await expect(analysis.enqueueUploadedManuscriptInTransaction(tx, userId, manuscriptId))
      .rejects.toThrow('private database detail');
  });
});
