import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LuminaStationService } from './lumina-station.service';

@Controller('lumina-station')
@UseGuards(JwtAuthGuard)
export class LuminaStationController {
  constructor(private readonly luminaStationService: LuminaStationService) {}

  @Get()
  getStation(@CurrentUser() user: AuthUser, @Query('take') take?: string) {
    return this.luminaStationService.getStation(user.id, take);
  }
}
