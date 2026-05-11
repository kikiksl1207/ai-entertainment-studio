import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { FanEngagementJwtAuthGuard } from './fan-engagement-auth.guard';
import { FanEngagementService } from './fan-engagement.service';

type FanEngagementQuery = Record<string, string | undefined>;
type FanEngagementBody = Record<string, unknown>;
type RequestWithOptionalAuth = { user?: AuthUser };

@Controller('fan-engagement')
export class FanEngagementController {
  constructor(private readonly fanEngagementService: FanEngagementService) {}

  @Get('missions')
  @UseGuards(OptionalJwtAuthGuard)
  getMissions(
    @Query() query: FanEngagementQuery,
    @Req() request: RequestWithOptionalAuth,
  ) {
    return this.fanEngagementService.getMissions(query, request.user?.id);
  }

  @Get('concept-votes')
  @UseGuards(OptionalJwtAuthGuard)
  getConceptVotes(
    @Query() query: FanEngagementQuery,
    @Req() request: RequestWithOptionalAuth,
  ) {
    return this.fanEngagementService.getConceptVotes(query, request.user?.id);
  }

  @Post('concept-votes/:voteId/ballots')
  @UseGuards(JwtAuthGuard)
  submitConceptVoteBallot(
    @CurrentUser() user: AuthUser,
    @Param('voteId') voteId: string,
    @Body() body: FanEngagementBody,
  ) {
    return this.fanEngagementService.submitConceptVoteBallot(user.id, voteId, body);
  }

  @Post('missions/:missionId/participations')
  @UseGuards(FanEngagementJwtAuthGuard)
  createMissionParticipation(
    @CurrentUser() user: AuthUser,
    @Param('missionId') missionId: string,
    @Body() body: FanEngagementBody,
  ) {
    return this.fanEngagementService.createMissionParticipation(user.id, missionId, body);
  }
}

@Controller('me/fan-engagement')
@UseGuards(JwtAuthGuard)
export class MyFanEngagementController {
  constructor(private readonly fanEngagementService: FanEngagementService) {}

  @Get('summary')
  getSummary(@CurrentUser() user: AuthUser, @Query() query: FanEngagementQuery) {
    return this.fanEngagementService.getMySummary(user.id, query);
  }

  @Patch('title')
  equipTitle(@CurrentUser() user: AuthUser, @Body() body: FanEngagementBody) {
    return this.fanEngagementService.equipTitle(user.id, body);
  }
}

@Controller('users/:userId/fan-engagement')
export class PublicFanEngagementController {
  constructor(private readonly fanEngagementService: FanEngagementService) {}

  @Get('public-summary')
  getPublicSummary(
    @Param('userId') userId: string,
    @Query() query: FanEngagementQuery,
  ) {
    return this.fanEngagementService.getPublicSummary(userId, query);
  }
}
