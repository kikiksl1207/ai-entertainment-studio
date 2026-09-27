import { PopularVoteRolloverService } from './popular-vote-rollover.service';
import { PopularVoteService } from './popular-vote.service';
import { Logger } from '@nestjs/common';

describe('PopularVoteRolloverService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-30T14:59:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('runs at startup and again at KST month rollover', async () => {
    const archiveCompletedMonths = jest.fn().mockResolvedValue(undefined);
    const worker = new PopularVoteRolloverService({ archiveCompletedMonths } as unknown as PopularVoteService);

    await worker.onModuleInit();
    expect(archiveCompletedMonths).toHaveBeenCalledTimes(1);
    expect(archiveCompletedMonths).toHaveBeenCalledWith(new Date('2026-09-30T14:59:00.000Z'));

    await jest.advanceTimersByTimeAsync(6 * 60_000);
    expect(archiveCompletedMonths).toHaveBeenCalledTimes(2);
    expect(archiveCompletedMonths).toHaveBeenLastCalledWith(new Date('2026-09-30T15:05:00.000Z'));
    worker.onModuleDestroy();
  });

  it('schedules the current boundary when startup lands inside the grace window', async () => {
    jest.setSystemTime(new Date('2026-09-30T15:02:00.000Z'));
    const archiveCompletedMonths = jest.fn().mockResolvedValue(undefined);
    const worker = new PopularVoteRolloverService({ archiveCompletedMonths } as unknown as PopularVoteService);

    await worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(3 * 60_000);

    expect(archiveCompletedMonths).toHaveBeenCalledTimes(2);
    expect(archiveCompletedMonths).toHaveBeenLastCalledWith(new Date('2026-09-30T15:05:00.000Z'));
    worker.onModuleDestroy();
  });

  it('retries a failed archival and stops timers on shutdown', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const archiveCompletedMonths = jest.fn()
      .mockRejectedValueOnce(new Error('temporary database failure'))
      .mockResolvedValue(undefined);
    const worker = new PopularVoteRolloverService({ archiveCompletedMonths } as unknown as PopularVoteService);

    await worker.onModuleInit();
    expect(archiveCompletedMonths).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(archiveCompletedMonths).toHaveBeenCalledTimes(2);

    worker.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(31 * 24 * 60 * 60 * 1000);
    expect(archiveCompletedMonths).toHaveBeenCalledTimes(2);
  });

  it('does not miss a boundary crossed while catch-up is still running', async () => {
    let completeCatchup: (() => void) | undefined;
    const archiveCompletedMonths = jest.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { completeCatchup = resolve; }))
      .mockResolvedValue(undefined);
    const worker = new PopularVoteRolloverService({ archiveCompletedMonths } as unknown as PopularVoteService);

    const startup = worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(6 * 60_000);
    completeCatchup?.();
    await startup;
    await jest.advanceTimersByTimeAsync(0);

    expect(archiveCompletedMonths).toHaveBeenCalledTimes(2);
    worker.onModuleDestroy();
  });
});
