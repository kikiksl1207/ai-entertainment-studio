import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatorStudioService } from './creator-studio.service';

@Controller('me/creator-studio')
@UseGuards(JwtAuthGuard)
export class CreatorStudioController {
  constructor(private readonly creatorStudioService: CreatorStudioService) {}

  @Get()
  getStudio(@CurrentUser() user: AuthUser) {
    return this.creatorStudioService.getStudio(user.id);
  }
}
