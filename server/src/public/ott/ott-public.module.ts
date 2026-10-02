import { Module } from '@nestjs/common';
import { OttMediaModule } from '../../ott-media/ott-media.module';
import { OttPublicController } from './ott-public.controller';
import { OttPublicService } from './ott-public.service';

@Module({ imports: [OttMediaModule], controllers: [OttPublicController], providers: [OttPublicService] })
export class OttPublicModule {}
