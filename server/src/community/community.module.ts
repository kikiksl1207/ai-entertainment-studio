import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';

@Module({
  imports: [NotificationsModule],
  controllers: [CommunityController],
  providers: [CommunityService],
})
export class CommunityModule {}
