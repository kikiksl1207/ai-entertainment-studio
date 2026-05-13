import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LuminaStationService } from './lumina-station.service';

@Controller('lumina-station')
export class LuminaStationController {
  constructor(private readonly luminaStationService: LuminaStationService) {}

  @Get('charge-policy')
  getChargePolicy() {
    return this.luminaStationService.getChargePolicy();
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  getStation(@CurrentUser() user: AuthUser, @Query('take') take?: string) {
    return this.luminaStationService.getStation(user.id, take);
  }
}
