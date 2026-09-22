import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { get } from 'http';
import type { AddressInfo } from 'net';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { createValidationException } from '../common/validation-exception.factory';
import { StoryAuthorFinalReviewService } from './story-author-final-review.service';
import { assertAuthorReviewTestDatabase } from './story-author-final-review.postgres-fixture';
import { StoryContinuationProvider } from './story-continuation.provider';
import { StoryContinuationWorker } from './story-continuation.worker';
import { SemanticAnalysisProvider } from './story-semantic-analysis.provider';
import { SEMANTIC_WORKER } from './story-semantic-analysis.worker';

const databaseUrl = process.env.STORY_AUTHOR_REVIEW_TEST_DATABASE_URL;
const pg = databaseUrl ? describe : describe.skip;

pg('author-proof AppModule defaults-OFF (actual local HTTP, not author-flow acceptance)', () => {
  it('boots the new DI graph without provider keys/rates, serves health200 and drains cleanly', async () => {
    assertAuthorReviewTestDatabase(databaseUrl!);
    const previous = { ...process.env };
    const network = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('External requests forbidden in author-review smoke');
    });
    let app: INestApplication | undefined;
    try {
      for (const key of Object.keys(process.env)) {
        if (key.startsWith('STORY_SEMANTIC_ANALYSIS_') || key.startsWith('STORY_CONTINUATION_') || key === 'OPENAI_API_KEY') {
          delete process.env[key];
        }
      }
      Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: databaseUrl,
        JWT_ACCESS_SECRET: 'offline-author-review-access-secret-32-or-more',
        JWT_REFRESH_SECRET: 'offline-author-review-refresh-secret-32-or-more',
        PAYMENT_PROVIDER: 'mock', OBJECT_STORAGE_PROVIDER: 'local' });
      const { AppModule } = await import('../app.module');
      app = await NestFactory.create(AppModule, { rawBody: true, logger: false, abortOnError: false });
      configureHttpRouting(app);
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true,
        forbidUnknownValues: true, transform: true, exceptionFactory: createValidationException }));
      app.useGlobalFilters(new HttpExceptionFilter());
      await app.listen(0, '127.0.0.1');
      expect(app.get(StoryAuthorFinalReviewService)).toBeDefined();
      expect(await app.get(StoryContinuationProvider).readiness()).toMatchObject({ enabled: false });
      const semantic = app.get(SemanticAnalysisProvider);
      expect(Boolean(semantic.config.apiKey || semantic.config.rateCardId || semantic.config.model)).toBe(false);
      expect(await semantic.readiness()).toMatchObject({ enabled: false });
      const worker = app.get(StoryContinuationWorker);
      const semanticWorker = app.get(SEMANTIC_WORKER);
      expect(worker.readiness()).toMatchObject({ enabled: false, active: false });
      expect(semanticWorker.readiness()).toMatchObject({ enabled: false, active: false });
      const port = (app.getHttpServer().address() as AddressInfo).port;
      const response = await new Promise<{ status?: number; body: string }>((resolve, reject) => {
        const request = get({ hostname: '127.0.0.1', port, path: '/health', timeout: 3000,
          headers: { connection: 'close' } }, res => {
          let body = '';
          res.on('data', chunk => {
            body += chunk.toString();
            if (Buffer.byteLength(body) > 4096) res.destroy(new Error('Unexpected local health response size'));
          });
          res.on('error', reject);
          res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        request.on('timeout', () => request.destroy(new Error('Local health timeout')));
        request.on('error', reject);
      });
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({ status: 'ok', service: 'lumina-stage-api' });
      await app.close();
      app = undefined;
      expect(worker.readiness()).toMatchObject({ active: false, stopping: true });
      expect(semanticWorker.readiness()).toMatchObject({ active: false, stopping: true });
      expect(network).not.toHaveBeenCalled();
    } finally {
      await app?.close();
      network.mockRestore();
      for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  }, 30000);
});
