import 'reflect-metadata';
import { All, Controller, Get, HttpCode, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { request } from 'http';
import { AddressInfo } from 'net';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { HealthController } from '../health.controller';
import { StoryAiActivationAdminController } from '../story-production/story-ai-activation.controller';
import { StoryAiActivationService } from '../story-production/story-ai-activation.service';
import { HttpExceptionFilter } from './http-exception.filter';
import { configureHttpRouting } from './http-routing';

@Controller()
class RoutingProbeController {
  @Get('stories/prefix-probe')
  publicRoute() { return { route: 'public' }; }

  @Get(['admin/api/v10/prefix-probe', 'admin/api/v1-extra/prefix-probe', 'xadmin/api/v1/prefix-probe'])
  lookalike() { return { route: 'lookalike' }; }

  @All('admin/api/v1/prefix-probe/nested')
  @HttpCode(200)
  adminMethods() { return { route: 'admin' }; }

  @Post('health')
  nonGetHealth() { return { route: 'post-health' }; }

  @Get('health/nested')
  nestedHealth() { return { route: 'nested-health' }; }
}

describe('bootstrap HTTP routing through the installed Nest adapter', () => {
  let app: INestApplication;
  let port: number;
  const deniedAdmin = jest.fn(() => false);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [RoutingProbeController, HealthController, StoryAiActivationAdminController],
      providers: [{ provide: StoryAiActivationService, useValue: {} }],
    })
      .overrideGuard(AdminAuthGuard).useValue({ canActivate: deniedAdmin })
      .overrideGuard(AdminPermissionGuard).useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app);
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  afterAll(async () => { await app?.close(); });

  function call(method: string, path: string) {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, method, path, agent: false }, res => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          try { resolve({ status: res.statusCode!, body: text ? JSON.parse(text) : undefined }); }
          catch (error) { reject(error); }
        });
      });
      req.setTimeout(3000, () => req.destroy(new Error('Loopback routing test timed out')));
      req.on('error', reject); req.end();
    });
  }

  it.each([
    ['GET', '/admin/api/v1/story-ai/shared-results/review-queue'],
    ['POST', '/admin/api/v1/story-ai/shared-results/00000000-0000-4000-8000-000000000001/revoke'],
  ])('reaches the real admin guard at %s %s, without a duplicate public prefix', async (method, path) => {
    const before = deniedAdmin.mock.calls.length;
    const denied = await call(method, path);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(deniedAdmin.mock.calls.length).toBe(before + 1);
    expect((await call(method, '/api/v1' + path)).status).toBe(404);
    expect(deniedAdmin.mock.calls.length).toBe(before + 1);
  });

  it.each(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('excludes nested admin routes for %s', async method => {
    expect((await call(method, '/admin/api/v1/prefix-probe/nested')).status).toBe(200);
    expect((await call(method, '/api/v1/admin/api/v1/prefix-probe/nested')).status).toBe(404);
  });

  it('keeps public routes under /api/v1', async () => {
    expect(await call('GET', '/api/v1/stories/prefix-probe')).toEqual({ status: 200, body: { route: 'public' } });
    expect((await call('GET', '/stories/prefix-probe')).status).toBe(404);
  });

  it.each(['admin/api/v10/prefix-probe', 'admin/api/v1-extra/prefix-probe', 'xadmin/api/v1/prefix-probe'])
    ('does not exclude the lookalike %s', async path => {
      expect((await call('GET', '/' + path)).status).toBe(404);
      expect(await call('GET', '/api/v1/' + path)).toEqual({ status: 200, body: { route: 'lookalike' } });
    });

  it('keeps GET health unprefixed and does not broaden its method or nested-path exclusion', async () => {
    const health = await call('GET', '/health');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ status: 'ok', service: 'lumina-stage-api' });
    expect((await call('GET', '/api/v1/health')).status).toBe(404);
    expect((await call('POST', '/health')).status).toBe(404);
    expect(await call('POST', '/api/v1/health')).toEqual({ status: 201, body: { route: 'post-health' } });
    expect((await call('GET', '/health/nested')).status).toBe(404);
    expect(await call('GET', '/api/v1/health/nested')).toEqual({ status: 200, body: { route: 'nested-health' } });
  });
});
