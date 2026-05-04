import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FanLettersService } from './fan-letters.service';

type FanLetterBody = Record<string, unknown>;
type FanLetterQuery = Record<string, string | undefined>;

@Controller()
export class FanLettersController {
  constructor(private readonly fanLettersService: FanLettersService) {}

  @Get('fan-letters/policy')
  getPolicy() {
    return this.fanLettersService.getPolicy();
  }

  @Post('fan-letters')
  @UseGuards(JwtAuthGuard)
  createFanLetter(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() body: FanLetterBody,
  ) {
    return this.fanLettersService.createFanLetter(user.id, {
      artistId: this.requiredString(body.artistId, 'artistId'),
      title: this.optionalString(body.title),
      body: this.requiredString(body.body, 'body'),
      idempotencyKey: this.optionalString(body.idempotencyKey) ?? idempotencyKeyHeader,
      metadata: this.optionalObject(body.metadata),
    });
  }

  @Post('fan-letters/preview')
  @UseGuards(JwtAuthGuard)
  previewFanLetter(@CurrentUser() user: AuthUser, @Body() body: FanLetterBody) {
    return this.fanLettersService.previewFanLetter(user.id, {
      artistId: this.requiredString(body.artistId, 'artistId'),
    });
  }

  @Get('me/fan-letters/sent')
  @UseGuards(JwtAuthGuard)
  getSentLetters(@CurrentUser() user: AuthUser, @Query() query: FanLetterQuery) {
    return this.fanLettersService.getSentLetters(user.id, query);
  }

  @Get('me/fan-letters/received')
  @UseGuards(JwtAuthGuard)
  getReceivedLetters(@CurrentUser() user: AuthUser, @Query() query: FanLetterQuery) {
    return this.fanLettersService.getReceivedLetters(user.id, query);
  }

  @Patch('me/fan-letters/received/:fanLetterId/status')
  @UseGuards(JwtAuthGuard)
  updateReceivedLetterStatus(
    @CurrentUser() user: AuthUser,
    @Param('fanLetterId') fanLetterId: string,
    @Body() body: FanLetterBody,
  ) {
    return this.fanLettersService.updateReceivedLetterStatus(user.id, fanLetterId, {
      status: this.requiredString(body.status, 'status'),
      replyBody: this.optionalString(body.replyBody),
    });
  }

  private requiredString(value: unknown, fieldName: string) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${fieldName} is required`);
    }

    return value.trim();
  }

  private optionalString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private optionalObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }
}
