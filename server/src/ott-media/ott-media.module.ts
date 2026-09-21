import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OttMediaBrowserController, OttMediaController } from './ott-media.controller';
import { OttMediaBrowserGuard } from './ott-media-browser.guard';
import { OttMediaDelivery } from './ott-media.delivery';
import { FfprobeOttMediaProbe, OttMediaProbe } from './ott-media.probe';
import { OttMediaRepository, PrismaOttMediaRepository } from './ott-media.repository';
import { OttMediaService } from './ott-media.service';
import { OttObjectStorage, PrivateLocalOttStorage } from './ott-media.storage';

@Module({
  imports: [PrismaModule], controllers: [OttMediaController, OttMediaBrowserController],
  providers: [OttMediaService, OttMediaDelivery, OttMediaBrowserGuard,
    { provide: OttMediaRepository, useClass: PrismaOttMediaRepository },
    { provide: OttObjectStorage, useClass: PrivateLocalOttStorage },
    { provide: OttMediaProbe, useClass: FfprobeOttMediaProbe }],
  exports: [OttMediaService],
})
export class OttMediaModule {}
