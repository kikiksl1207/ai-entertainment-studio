import { Module } from '@nestjs/common';
import { DebutAdminController, DebutController } from './debut.controller';
import { DebutService } from './debut.service';

@Module({
  controllers: [DebutController, DebutAdminController],
  providers: [DebutService],
})
export class DebutModule {}
