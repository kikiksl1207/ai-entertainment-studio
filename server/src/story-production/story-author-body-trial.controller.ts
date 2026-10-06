import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Header,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { IsIn, IsInt, IsUUID, Min } from 'class-validator';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { STORY_LOCALES } from './story-production.policy';
import { StoryProductionService } from './story-production.service';

export class SelectAuthorBodyTrialChoiceDto {
  @IsUUID()
  approvalId!: string;

  @IsUUID()
  progressId!: string;

  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @IsIn(STORY_LOCALES)
  locale!: string;
}

type AuthorBodyTrialChoiceService = {
  recordAuthorBodyTrialRead(userId: string, workId: string, body: SelectAuthorBodyTrialChoiceDto, idempotencyKey: string): unknown;
  selectAuthorBodyTrialChoice(
    userId: string,
    workId: string,
    choiceId: string,
    body: SelectAuthorBodyTrialChoiceDto,
    idempotencyKey: string,
  ): unknown;
};

class AuthorBodyTrialNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Cache-Control', 'private, no-store');
    return true;
  }
}

class AuthorBodyTrialInputGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const { body } = context.switchToHttp().getRequest<{ body?: unknown }>();
    // Check raw keys before validation pipes can strip unknown or prototype-related properties.
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['approvalId', 'progressId', 'expectedRevision', 'locale'].includes(key))) {
      throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_TRIAL_INPUT_INVALID' });
    }
    return true;
  }
}

@Controller('me/creator-studio/stories/:workId/body-trial')
@UseGuards(AuthorBodyTrialNoStoreGuard, JwtAuthGuard, AuthorBodyTrialInputGuard)
export class StoryAuthorBodyTrialController {
  constructor(@Inject(StoryProductionService) private readonly stories: AuthorBodyTrialChoiceService) {}

  @Post('read-beats')
  @Header('Cache-Control', 'private, no-store')
  readBeats(
    @CurrentUser() user: AuthUser,
    @Param('workId', ParseUUIDPipe) workId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    body: SelectAuthorBodyTrialChoiceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: { url: string },
  ) {
    if (new URL(request.url, 'http://localhost').search) {
      throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_TRIAL_INPUT_INVALID' });
    }
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey)) {
      throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_TRIAL_IDEMPOTENCY_KEY_INVALID' });
    }
    return this.stories.recordAuthorBodyTrialRead(user.id, workId, body, idempotencyKey);
  }

  @Post('choices/:choiceId')
  @Header('Cache-Control', 'private, no-store')
  choose(
    @CurrentUser() user: AuthUser,
    @Param('workId', ParseUUIDPipe) workId: string,
    @Param('choiceId', ParseUUIDPipe) choiceId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    body: SelectAuthorBodyTrialChoiceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: { url: string },
  ) {
    if (new URL(request.url, 'http://localhost').searchParams.size) {
      throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_TRIAL_INPUT_INVALID' });
    }
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 120
      || /[^A-Za-z0-9._:-]/.test(idempotencyKey)) {
      throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_TRIAL_IDEMPOTENCY_KEY_INVALID' });
    }
    return this.stories.selectAuthorBodyTrialChoice(user.id, workId, choiceId, body, idempotencyKey);
  }
}
