import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminUsersReadService } from './admin-users-read.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, AdminUsersReadService],
})
export class AdminModule {}
