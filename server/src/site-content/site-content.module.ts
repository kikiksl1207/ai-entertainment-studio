import { Module } from '@nestjs/common';
import {
  SiteContentAdminController,
  SiteContentController,
} from './site-content.controller';
import { SiteContentService } from './site-content.service';

@Module({
  controllers: [SiteContentController, SiteContentAdminController],
  providers: [SiteContentService],
})
export class SiteContentModule {}
