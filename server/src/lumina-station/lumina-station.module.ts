import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LuminaStationController } from './lumina-station.controller';
import { LuminaStationService } from './lumina-station.service';

@Module({
  imports: [PrismaModule],
  controllers: [LuminaStationController],
  providers: [LuminaStationService],
})
export class LuminaStationModule {}
