import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UserAssetsController } from './user-assets.controller';
import { UserAssetsService } from './user-assets.service';

@Module({
  imports: [PrismaModule],
  controllers: [UserAssetsController],
  providers: [UserAssetsService],
})
export class UserAssetsModule {}
