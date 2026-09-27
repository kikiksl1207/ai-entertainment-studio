import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MONTHLY_PICK_ARCHIVE_GRACE_MS, PopularVoteService } from './popular-vote.service';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const RETRY_DELAY_MS = 60 * 60 * 1000;
const MAX_TIMER_DELAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PopularVoteRolloverService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PopularVoteRolloverService.name);
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(private readonly popularVoteService: PopularVoteService) {}

  async onModuleInit() {
    await this.run();
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  private async run() {
    try {
      const startedAt = new Date();
      await this.popularVoteService.archiveCompletedMonths(startedAt);
      this.schedule(this.nextArchiveTime(startedAt));
    } catch (error) {
      this.logger.error('Monthly pick rollover failed; retrying in one hour', error);
      this.schedule(Date.now() + RETRY_DELAY_MS);
    }
  }

  private schedule(targetTime: number) {
    if (this.stopped) {
      return;
    }

    this.timer = setTimeout(() => {
      if (Date.now() < targetTime) {
        this.schedule(targetTime);
      } else {
        void this.run();
      }
    }, Math.min(Math.max(targetTime - Date.now(), 0), MAX_TIMER_DELAY_MS));
  }

  private nextArchiveTime(now: Date) {
    const kst = new Date(now.getTime() + KST_OFFSET_MS);
    const current = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - KST_OFFSET_MS;
    const currentArchiveTime = current + MONTHLY_PICK_ARCHIVE_GRACE_MS;
    if (now.getTime() < currentArchiveTime) {
      return currentArchiveTime;
    }

    return Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + 1, 1) -
      KST_OFFSET_MS + MONTHLY_PICK_ARCHIVE_GRACE_MS;
  }
}
