import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import {
  FanEngagementController,
  MyFanEngagementController,
  PublicFanEngagementController,
} from './fan-engagement.controller';
import { FanEngagementJwtAuthGuard } from './fan-engagement-auth.guard';
import { FanEngagementService } from './fan-engagement.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    FanEngagementController,
    MyFanEngagementController,
    PublicFanEngagementController,
  ],
  providers: [FanEngagementService, FanEngagementJwtAuthGuard],
})
export class FanEngagementModule {}
