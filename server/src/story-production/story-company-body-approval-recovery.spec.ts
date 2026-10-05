import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { StoryAuthorBodyReviewService } from './story-author-body-review.service';
const id = '00000000-0000-4000-8000-000000000501';
describe('bounded company approval-only retry', () => {
  let service: StoryAuthorBodyReviewService;
  beforeEach(() => { jest.useFakeTimers(); service = new StoryAuthorBodyReviewService({} as never, {} as never); });
  afterEach(async () => { await service.onApplicationShutdown(); jest.useRealTimers(); });
  it('retries one approval once, coalesces duplicates and stops after success', async () => {
    const approve = jest.spyOn(service, 'autoApproveCompanyContinuation').mockResolvedValue(null);
    service.deferCompanyContinuationApproval(id); service.deferCompanyContinuationApproval(id);
    expect(approve).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(60_000); expect(approve).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(120_000); expect(approve).toHaveBeenCalledTimes(1);
  });
  it('recovers a transient DB failure without touching the generation queue', async () => {
    const approve = jest.spyOn(service, 'autoApproveCompanyContinuation')
      .mockRejectedValueOnce(new ServiceUnavailableException()).mockResolvedValue(null);
    service.deferCompanyContinuationApproval(id);
    await jest.advanceTimersByTimeAsync(120_000); expect(approve).toHaveBeenCalledTimes(2);
  });
  it('stops after five failed approval attempts', async () => {
    const approve = jest.spyOn(service, 'autoApproveCompanyContinuation').mockRejectedValue(new ServiceUnavailableException());
    service.deferCompanyContinuationApproval(id);
    await jest.advanceTimersByTimeAsync(10 * 60_000); expect(approve).toHaveBeenCalledTimes(5);
  });
  it('does not repeat obsolete source conflicts', async () => {
    const approve = jest.spyOn(service, 'autoApproveCompanyContinuation').mockRejectedValue(new ConflictException());
    service.deferCompanyContinuationApproval(id);
    await jest.advanceTimersByTimeAsync(120_000); expect(approve).toHaveBeenCalledTimes(1);
  });
  it('clears scheduled work on shutdown and refuses new retries', async () => {
    const approve = jest.spyOn(service, 'autoApproveCompanyContinuation').mockResolvedValue(null);
    service.deferCompanyContinuationApproval(id); await service.onApplicationShutdown();
    service.deferCompanyContinuationApproval(id);
    await jest.advanceTimersByTimeAsync(120_000); expect(approve).not.toHaveBeenCalled();
  });
  it('waits for an in-flight approval write before shutdown completes', async () => {
    let finish!: (value: null) => void;
    const approve = jest.spyOn(service, 'autoApproveCompanyContinuation').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    service.deferCompanyContinuationApproval(id); await jest.advanceTimersByTimeAsync(60_000);
    let stopped = false; const shutdown = service.onApplicationShutdown().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    finish(null); await shutdown; expect(stopped).toBe(true); expect(approve).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid continuation identifiers before scheduling', async () => {
    const approve = jest.spyOn(service, 'autoApproveCompanyContinuation').mockResolvedValue(null);
    service.deferCompanyContinuationApproval('invalid');
    await jest.advanceTimersByTimeAsync(120_000); expect(approve).not.toHaveBeenCalled();
  });
  it('recovers a failed initial scan without restarting or generating', async () => {
    const query = jest.fn().mockRejectedValueOnce(new ServiceUnavailableException())
      .mockResolvedValueOnce([{ id, continuationId: id }]).mockResolvedValue([]);
    service = new StoryAuthorBodyReviewService({ $queryRaw: query } as never, {} as never);
    const approve = jest.spyOn(service, 'autoApproveCompanyContinuation').mockResolvedValue(null);
    service.onApplicationBootstrap(); await jest.advanceTimersByTimeAsync(120_000);
    expect(query).toHaveBeenCalledTimes(3); expect(approve).toHaveBeenCalledTimes(1);
  });
  it('resumes at the last scanned page after a later page query fails', async () => {
    const next = '00000000-0000-4000-8000-000000000502';
    const query = jest.fn().mockResolvedValueOnce([{ id, continuationId: id }])
      .mockRejectedValueOnce(new ServiceUnavailableException())
      .mockResolvedValueOnce([{ id: next, continuationId: next }]).mockResolvedValue([]);
    service = new StoryAuthorBodyReviewService({ $queryRaw: query } as never, {} as never);
    const approve = jest.spyOn(service, 'autoApproveCompanyContinuation').mockResolvedValue(null);
    service.onApplicationBootstrap(); await jest.advanceTimersByTimeAsync(120_000);
    expect(query).toHaveBeenCalledTimes(4); expect(approve.mock.calls).toEqual([[id], [next]]);
    expect(query.mock.calls[2][0].values).toContain(id);
  });
  it('stops scan recovery after the initial failure and five retries', async () => {
    const query = jest.fn().mockRejectedValue(new ServiceUnavailableException());
    service = new StoryAuthorBodyReviewService({ $queryRaw: query } as never, {} as never);
    const approve = jest.spyOn(service, 'autoApproveCompanyContinuation').mockResolvedValue(null);
    service.onApplicationBootstrap(); await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(query).toHaveBeenCalledTimes(6); expect(approve).not.toHaveBeenCalled();
  });
  it('cancels a pending scan retry on shutdown', async () => {
    const query = jest.fn().mockRejectedValue(new ServiceUnavailableException());
    service = new StoryAuthorBodyReviewService({ $queryRaw: query } as never, {} as never);
    service.onApplicationBootstrap(); await jest.advanceTimersByTimeAsync(0);
    await service.onApplicationShutdown(); await jest.advanceTimersByTimeAsync(120_000);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
