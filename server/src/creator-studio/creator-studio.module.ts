import { Module } from '@nestjs/common';
import { CreatorStudioController } from './creator-studio.controller';
import { CreatorStudioService } from './creator-studio.service';

@Module({
  controllers: [CreatorStudioController],
  providers: [CreatorStudioService],
})
export class CreatorStudioModule {}
