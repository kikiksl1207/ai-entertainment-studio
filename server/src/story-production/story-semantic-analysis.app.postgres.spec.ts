import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { get } from 'http';
import type { AddressInfo } from 'net';
import { SemanticAnalysisProvider } from './story-semantic-analysis.provider';
import { SEMANTIC_WORKER } from './story-semantic-analysis.worker';
import { StoryContinuationProvider } from './story-continuation.provider';

const databaseUrl = process.env.STORY_ANALYSIS_TEST_DATABASE_URL;
const postgres = databaseUrl ? describe : describe.skip;

postgres('Full AppModule defaults-OFF boot with own PostgreSQL', () => {
  it('requires no semantic/continuation key or rate card, serves health200, and closes cleanly', async () => {
    const parsed = new URL(databaseUrl!);
    if (parsed.hostname !== '127.0.0.1' || parsed.port !== '55432' || parsed.pathname !== '/lumina_analysis_packing_qa')
      throw new Error('Dedicated semantic analysis QA database required');
    const previous = { ...process.env };
    const network = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('External requests forbidden in defaults-OFF smoke'); });
    let app: INestApplication | undefined;
    try {
      for (const key of Object.keys(process.env)) if (key.startsWith('STORY_SEMANTIC_ANALYSIS_') || key.startsWith('STORY_CONTINUATION_') || key === 'OPENAI_API_KEY') delete process.env[key];
      Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: databaseUrl,
        JWT_ACCESS_SECRET: 'offline-analysis-access-secret-32-or-more',
        JWT_REFRESH_SECRET: 'offline-analysis-refresh-secret-32-or-more',
        PAYMENT_PROVIDER: 'mock', OBJECT_STORAGE_PROVIDER: 'local' });
      const { AppModule } = await import('../app.module');
      app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
      await app.listen(0, '127.0.0.1');
      const provider = app.get(SemanticAnalysisProvider);
      expect(Boolean(provider.config.apiKey || provider.config.rateCardId || provider.config.model)).toBe(false);
      expect(await provider.readiness()).toMatchObject({ enabled: false });
      expect(await app.get(StoryContinuationProvider).readiness()).toMatchObject({ enabled: false });
      const worker = app.get(SEMANTIC_WORKER);
      expect(worker.readiness()).toMatchObject({ enabled: false, active: false, reason: 'worker_disabled' });
      const port = (app.getHttpServer().address() as AddressInfo).port;
      const response = await new Promise<{ status?: number; body: string }>((resolve, reject) => {
        const request = get({ hostname: '127.0.0.1', port, path: '/health', timeout: 3000 }, res => {
          let body = '';
          res.on('data', chunk => { body += chunk.toString(); });
          res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        request.on('timeout', () => request.destroy(new Error('Local health timeout')));
        request.on('error', reject);
      });
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({ status: 'ok', service: 'lumina-stage-api' });
      await app.close(); app = undefined;
      expect(worker.readiness()).toMatchObject({ active: false, stopping: true });
      expect(network).not.toHaveBeenCalled();
    } finally {
      await app?.close(); network.mockRestore();
      for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  }, 30000);
});
