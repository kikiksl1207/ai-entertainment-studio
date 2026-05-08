import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PublicAssetsController, UserAssetsController } from './user-assets.controller';
import { UserAssetsService } from './user-assets.service';

@Module({
  imports: [PrismaModule],
  controllers: [UserAssetsController, PublicAssetsController],
  providers: [UserAssetsService],
})
export class UserAssetsModule {}
