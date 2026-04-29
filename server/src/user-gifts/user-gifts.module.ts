import { Module } from '@nestjs/common';
import { UserGiftsController } from './user-gifts.controller';
import { UserGiftsService } from './user-gifts.service';

@Module({
  controllers: [UserGiftsController],
  providers: [UserGiftsService],
})
export class UserGiftsModule {}
