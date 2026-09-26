import { Module } from '@nestjs/common';
import { PopularVoteAdminController, PopularVoteController } from './popular-vote.controller';
import { PopularVoteService } from './popular-vote.service';
import { PopularVoteRolloverService } from './popular-vote-rollover.service';

@Module({
  controllers: [PopularVoteController, PopularVoteAdminController],
  providers: [PopularVoteService, PopularVoteRolloverService],
})
export class PopularVoteModule {}
