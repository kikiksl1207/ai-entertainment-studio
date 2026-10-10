import { Controller, Get, Module, UnauthorizedException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { authorBodyReviewPrivacyMiddleware } from './story-author-body-review.privacy';

const FIT = '/api/me/creator-studio/stories/11111111-1111-4111-8111-111111111111/body-preview/current-fit';
let downstreamCalls = 0;

@Controller()
class SyntheticPrivateController {
  @Get([FIT.slice(1), FIT.slice(1).replace('api/', 'api/v1/')])
  read() {
    downstreamCalls += 1;
    throw new UnauthorizedException('Synthetic authentication required');
  }
}

@Module({ controllers: [SyntheticPrivateController] })
class SyntheticPrivateModule {}

describe('actual Nest parser and current-fit error classification (synthetic downstream)', () => {
  let app: INestApplication | undefined;
  let port = 0;
  let loggerCalls = 0;
  let requests = 0;
  const oversized = JSON.stringify({ synthetic: 'x'.repeat(102400) });

  beforeAll(async () => {
    try {
      downstreamCalls = 0;
      app = await NestFactory.create(SyntheticPrivateModule, { logger: false, rawBody: true });
      app.use(authorBodyReviewPrivacyMiddleware);
      const filter = new HttpExceptionFilter();
      // Count legacy logging without keeping even synthetic raw error messages.
      Reflect.set(filter, 'logger', { error: () => { loggerCalls += 1; } });
      app.useGlobalFilters(filter);
      await app.listen(0, '127.0.0.1');
      port = (app.getHttpServer().address() as AddressInfo).port;
    } catch (error) {
      await app?.close();
      app = undefined;
      throw error;
    }
  });

  afterAll(async () => {
    await app?.close();
    app = undefined;
    expect(requests).toBe(12);
  });

  function send(method: 'GET' | 'HEAD' | 'POST', path: string, body?: string) {
    requests += 1;
    return new Promise<{ status: number; headers: IncomingHttpHeaders; text: string }>((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port, method, path,
        headers: body === undefined ? {} : {
          'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        } }, response => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 65536) response.destroy(new Error('Synthetic response bound exceeded'));
          else chunks.push(chunk);
        });
        response.once('error', reject);
        response.once('end', () => resolve({ status: response.statusCode ?? 0,
          headers: response.headers, text: Buffer.concat(chunks).toString() }));
      });
      req.setTimeout(10000, () => req.destroy(new Error('Synthetic request timeout')));
      req.once('error', reject);
      req.end(body);
    });
  }

  it.each(['GET', 'HEAD'] as const)('preserves unauthenticated %s as 401', async method => {
    const before = downstreamCalls;
    const result = await send(method, FIT);
    expect(result.status).toBe(401);
    expect(result.headers['cache-control']).toBe('private, no-store');
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(downstreamCalls).toBe(before + 1);
    if (method === 'HEAD') expect(result.text).toBe('');
  });

  it.each(['GET', 'HEAD'] as const)('preserves malformed JSON %s as 400 before downstream', async method => {
    const before = downstreamCalls;
    const result = await send(method, FIT, '{"synthetic":');
    expect(result.status).toBe(400);
    expect(result.headers['cache-control']).toBe('private, no-store');
    expect(downstreamCalls).toBe(before);
    if (method === 'HEAD') expect(result.text).toBe('');
  });

  it.each([
    ['GET', FIT], ['HEAD', FIT], ['POST', FIT],
    ['GET', FIT.replace('/api/', '/api/v1/') + '/?locale=ko'],
  ] as const)('normalizes oversized %s %s as finite 413', async (method, path) => {
    const before = downstreamCalls;
    const logged = loggerCalls;
    const result = await send(method, path, oversized);
    expect(result.status).toBe(413);
    expect(result.headers['cache-control']).toBe('private, no-store');
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(downstreamCalls).toBe(before);
    expect(loggerCalls).toBe(logged);
    if (method === 'HEAD') expect(result.text).toBe('');
    else {
      const body = JSON.parse(result.text) as { success: boolean; error: Record<string, unknown> };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(body.error.message).toBe('Request body is too large');
      expect(body.error.statusCode).toBe(413);
      expect(body.error.path).toBe(path);
      expect(body.error).not.toHaveProperty('stack');
      expect(body.error).not.toHaveProperty('body');
      expect(body.error).not.toHaveProperty('limit');
      expect(body.error).not.toHaveProperty('length');
    }
  });

  it.each([
    [FIT.replace('/body-preview/current-fit', '/body-review'), true],
    [FIT + '-other', false], [FIT + '/child', false], [FIT + '%2F', false],
  ] as const)('preserves legacy oversize classification outside exact route %s', async (path, isPrivate) => {
    const before = downstreamCalls;
    const logged = loggerCalls;
    const result = await send('GET', path, oversized);
    expect(result.status).toBe(500);
    expect(result.headers['cache-control']).toBe(isPrivate ? 'private, no-store' : undefined);
    expect(downstreamCalls).toBe(before);
    expect(loggerCalls).toBe(logged + 1);
  });
});
