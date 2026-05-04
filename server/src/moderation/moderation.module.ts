import { Module } from '@nestjs/common';
import { ModerationAdminController, ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

@Module({
  controllers: [ModerationController, ModerationAdminController],
  providers: [ModerationService],
})
export class ModerationModule {}
