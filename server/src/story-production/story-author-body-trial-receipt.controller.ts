import { BadRequestException, CanActivate, Controller, ExecutionContext, Get, Header, Headers, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { normalizeAuthorBodyTrialReceiptQuery, StoryAuthorBodyTrialReceiptService } from './story-author-body-trial-receipt.service';

export function authorBodyTrialReceiptPrivacyMiddleware(request: { url: string },
  response: { setHeader(name: string, value: string): void }, next: () => void) {
  if (/^\/api\/(?:v1\/)?me\/creator-studio\/stories\/[^/?]+\/body-trial\/(?:choices\/[^/?]+\/receipt|recovery)(?:[/?]|$)/i.test(request.url)) {
    response.setHeader('Cache-Control', 'private, no-store');
  }
  next();
}

class AuthorBodyTrialReceiptNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Cache-Control', 'private, no-store');
    return true;
  }
}

@Controller('me/creator-studio/stories/:workId/body-trial/choices/:choiceId/receipt')
@UseGuards(AuthorBodyTrialReceiptNoStoreGuard, JwtAuthGuard)
export class StoryAuthorBodyTrialReceiptController {
  constructor(private readonly receipts: StoryAuthorBodyTrialReceiptService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  lookup(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Param('choiceId', ParseUUIDPipe) choiceId: string, @Headers('idempotency-key') key: string,
    @Req() request: { url: string }) {
    return this.receipts.lookup(user.id, workId, choiceId, normalizeAuthorBodyTrialReceiptQuery(request.url), key);
  }
}

@Controller('me/creator-studio/stories/:workId/body-trial/recovery')
@UseGuards(AuthorBodyTrialReceiptNoStoreGuard, JwtAuthGuard)
export class StoryAuthorBodyTrialRecoveryController {
  constructor(private readonly receipts: StoryAuthorBodyTrialReceiptService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  recover(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Req() request: { url: string }) {
    if (new URL(request.url, 'http://localhost').searchParams.size !== 0) {
      throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_TRIAL_RECOVERY_INPUT_INVALID' });
    }
    return this.receipts.recover(user.id, workId);
  }
}
