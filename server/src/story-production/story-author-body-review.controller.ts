import {
  BadRequestException, Body, CanActivate, Controller, ExecutionContext, Get, Header, Headers,
  Param, ParseUUIDPipe, Post, Req, UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoryAuthorBodyReviewService } from './story-author-body-review.service';
import { AuthorBodyReviewInput, bodyReviewKey, normalizeBodyReviewInput } from './story-author-body-review.policy';

export class AuthorBodyReviewPrivacyGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Cache-Control', 'private, no-store');
    return true;
  }
}

export class AuthorBodyReviewRawInputGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{ method: string; url: string; body?: unknown }>();
    const query = new URL(req.url, 'http://localhost').searchParams;
    const invalid = () => { throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_REVIEW_INPUT_INVALID' }); };
    if (req.method === 'GET') {
      if (query.size !== 1 || !query.has('locale')) invalid();
    } else {
      if (query.size || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) invalid();
      const fields = new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '').endsWith('/withdraw') ? [] : ['locale', 'sourceBindingHash', 'expectedProgressRevision',
        'expectedReviewId', 'decision', 'styleReviewed', 'charactersReviewed', 'timelineReviewed'];
      if (Object.keys(req.body!).length !== fields.length || Object.keys(req.body!).some(key => !fields.includes(key))) invalid();
    }
    return true;
  }
}

@Controller('me/creator-studio/stories/:workId/body-review')
@UseGuards(AuthorBodyReviewPrivacyGuard, JwtAuthGuard, AuthorBodyReviewRawInputGuard)
export class StoryAuthorBodyReviewController {
  constructor(private readonly reviews: StoryAuthorBodyReviewService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  current(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string, @Req() req: { url: string }) {
    return this.reviews.current(user.id, workId, new URL(req.url, 'http://localhost').searchParams.get('locale')!);
  }

  @Post()
  @Header('Cache-Control', 'private, no-store')
  review(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Body() body: AuthorBodyReviewInput, @Headers('idempotency-key') key: string | undefined) {
    bodyReviewKey(key);
    return this.reviews.review(user.id, workId, normalizeBodyReviewInput(body), key);
  }

  @Post(':reviewId/withdraw')
  @Header('Cache-Control', 'private, no-store')
  withdraw(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Param('reviewId', ParseUUIDPipe) reviewId: string, @Headers('idempotency-key') key: string | undefined) {
    bodyReviewKey(key);
    return this.reviews.withdraw(user.id, workId, reviewId, key);
  }
}
