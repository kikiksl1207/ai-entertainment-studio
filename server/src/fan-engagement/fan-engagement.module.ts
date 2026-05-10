import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import {
  FanEngagementController,
  MyFanEngagementController,
} from './fan-engagement.controller';
import { FanEngagementService } from './fan-engagement.service';

@Module({
  imports: [PrismaModule],
  controllers: [FanEngagementController, MyFanEngagementController],
  providers: [FanEngagementService],
})
export class FanEngagementModule {}
