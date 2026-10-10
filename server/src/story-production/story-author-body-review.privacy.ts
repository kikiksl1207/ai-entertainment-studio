import { HttpException, HttpStatus } from '@nestjs/common';

// Run before the JSON parser so malformed private author requests cannot be cached.
export function authorBodyReviewPrivacyMiddleware(
  request: { url: string }, response: { setHeader(name: string, value: string): void }, next: () => void,
) {
  if (/^\/api\/(?:v1\/)?me\/creator-studio\/stories\/[^/?]+\/(?:body-review(?:[/?]|$)|body-preview\/current-fit\/?(?:\?|$))/i.test(request.url)) {
    response.setHeader('Cache-Control', 'private, no-store');
  }
  next();
}

export function normalizeStoryAuthorCurrentFitParserException(
  exception: unknown, request: { url?: string },
): unknown {
  if (!(exception instanceof Error) || exception instanceof HttpException ||
    typeof request.url !== 'string' ||
    !/^\/api\/(?:v1\/)?me\/creator-studio\/stories\/[^/?]+\/body-preview\/current-fit\/?(?:\?|$)/i.test(request.url)) {
    return exception;
  }
  const type = Object.getOwnPropertyDescriptor(exception, 'type');
  if (!type || !('value' in type) || type.value !== 'entity.too.large') return exception;

  // http-errors stores status on the Error prototype; never invoke an accessor.
  let owner: object | null = exception;
  for (let depth = 0; owner && depth < 4; depth += 1) {
    const status = Object.getOwnPropertyDescriptor(owner, 'status');
    if (status) {
      if (!('value' in status) || status.value !== HttpStatus.PAYLOAD_TOO_LARGE) return exception;
      return new HttpException({
        code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large',
      }, HttpStatus.PAYLOAD_TOO_LARGE);
    }
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return exception;
}
