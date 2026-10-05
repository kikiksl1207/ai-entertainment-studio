import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminUsersReadService } from './admin-users-read.service';
import { AdminTestAccountController } from './admin-test-account.controller';
import { AdminTestAccountService } from './admin-test-account.service';
import { AdminTestAccountPrivacyMiddleware } from './admin-test-account.privacy';

@Module({
  controllers: [AdminController, AdminTestAccountController],
  providers: [AdminService, AdminUsersReadService, AdminTestAccountService],
})
export class AdminModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AdminTestAccountPrivacyMiddleware).forRoutes(AdminController, AdminTestAccountController);
  }
}
