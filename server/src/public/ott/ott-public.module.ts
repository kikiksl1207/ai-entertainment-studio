import { Module } from '@nestjs/common';
import { OttPublicController } from './ott-public.controller';
import { OttPublicService } from './ott-public.service';

@Module({ controllers: [OttPublicController], providers: [OttPublicService] })
export class OttPublicModule {}
