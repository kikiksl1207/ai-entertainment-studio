import { Module } from '@nestjs/common';
import { ShortformsController } from './shortforms.controller';
import { ShortformsService } from './shortforms.service';

@Module({
  controllers: [ShortformsController],
  providers: [ShortformsService],
})
export class ShortformsModule {}
