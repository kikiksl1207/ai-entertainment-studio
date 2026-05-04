import { Module } from '@nestjs/common';
import {
  CreatorImageRequestsAdminController,
  CreatorImageRequestsController,
} from './creator-image-requests.controller';
import { CreatorImageRequestsService } from './creator-image-requests.service';

@Module({
  controllers: [CreatorImageRequestsController, CreatorImageRequestsAdminController],
  providers: [CreatorImageRequestsService],
})
export class CreatorImageRequestsModule {}
