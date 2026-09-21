import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OttMediaModule } from '../ott-media/ott-media.module';
import { OttPlaybackController } from './ott-playback.controller';
import { OttPlaybackService } from './ott-playback.service';

@Module({ imports: [PrismaModule, OttMediaModule], controllers: [OttPlaybackController], providers: [OttPlaybackService] })
export class OttPlaybackModule {}
