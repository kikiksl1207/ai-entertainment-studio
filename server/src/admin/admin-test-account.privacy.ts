import { Injectable, NestMiddleware } from '@nestjs/common';

@Injectable()
export class AdminTestAccountPrivacyMiddleware implements NestMiddleware {
  use(_request: unknown, response: { setHeader(name: string, value: string): void; getHeader(name: string): string | number | string[] | undefined }, next: () => void) {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
    const existingVary = response.getHeader('Vary');
    const vary = String(existingVary ?? '').split(',').map(value => value.trim()).filter(Boolean);
    if (!vary.some(value => ['authorization', '*'].includes(value.toLowerCase()))) vary.push('Authorization');
    response.setHeader('Vary', vary.join(', '));
    next();
  }
}
