import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatorStudioService } from './creator-studio.service';
import { UpdateCreatorStudioArtistProfileDto } from './dto/creator-studio.dto';

@Controller('me/creator-studio')
@UseGuards(JwtAuthGuard)
export class CreatorStudioController {
  constructor(private readonly creatorStudioService: CreatorStudioService) {}

  @Get()
  getStudio(@CurrentUser() user: AuthUser) {
    return this.creatorStudioService.getStudio(user.id);
  }

  @Patch('artists/:artistId/profile')
  updateArtistProfile(
    @CurrentUser() user: AuthUser,
    @Param('artistId') artistId: string,
    @Body() body: UpdateCreatorStudioArtistProfileDto,
  ) {
    return this.creatorStudioService.updateArtistProfile(user, artistId, body);
  }
}
