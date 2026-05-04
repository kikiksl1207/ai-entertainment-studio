import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { FanLettersController } from './fan-letters.controller';
import { FanLettersService } from './fan-letters.service';

@Module({
  imports: [NotificationsModule],
  controllers: [FanLettersController],
  providers: [FanLettersService],
})
export class FanLettersModule {}
