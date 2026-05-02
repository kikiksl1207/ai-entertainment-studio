import { Module } from '@nestjs/common';
import { PopularVoteAdminController, PopularVoteController } from './popular-vote.controller';
import { PopularVoteService } from './popular-vote.service';

@Module({
  controllers: [PopularVoteController, PopularVoteAdminController],
  providers: [PopularVoteService],
})
export class PopularVoteModule {}
