import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { AdminTestAccountPrivacyMiddleware } from '../admin/admin-test-account.privacy';
import {
  SiteContentAdminController,
  SiteContentController,
} from './site-content.controller';
import { SiteContentService } from './site-content.service';

@Module({
  controllers: [SiteContentController, SiteContentAdminController],
  providers: [SiteContentService],
})
export class SiteContentModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AdminTestAccountPrivacyMiddleware)
      .forRoutes(
        SiteContentAdminController,
        {
          path: 'admin/api/v1/backstage/site-content',
          method: RequestMethod.HEAD,
        },
        {
          path: 'admin/api/v1/backstage/site-content/:id',
          method: RequestMethod.HEAD,
        },
      );
  }
}
