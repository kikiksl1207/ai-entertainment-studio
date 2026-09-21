import { INestApplication, RequestMethod } from '@nestjs/common';

export function configureHttpRouting(app: INestApplication) {
  app.setGlobalPrefix('api/v1', {
    exclude: [
      // Nest 10's path-to-regexp expects a capture group, not a brace wildcard.
      { path: 'admin/api/v1/(.*)', method: RequestMethod.ALL },
      { path: 'health', method: RequestMethod.GET },
    ],
  });
}
