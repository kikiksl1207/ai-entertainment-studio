import 'reflect-metadata';
import { CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable, INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatController } from '../chat/chat.controller';
import { ChatService } from '../chat/chat.service';
import { BoostsController } from '../boosts/boosts.controller';
import { BoostsService } from '../boosts/boosts.service';
import { HttpExceptionFilter } from './http-exception.filter';
import { configureHttpRouting } from './http-routing';
import { chatBoostsPrivacyMiddleware } from './chat-boosts-privacy';

// Source plan UNRUN: real Nest/Express/controller routes with synthetic guards and inert service mocks.
// This verifies header timing, not production JWT permissions, rate limits, prices or provider behavior.
const ID = '00000000-0000-4000-8000-000000000801';
const ORIGIN = 'https://privacy-qa.example.invalid';
const READS = ['/chat/conversations?box=inbox&take=1', '/chat/sessions', '/chat/sessions/' + ID + '/messages', '/me/paid-like-quota'];
const WRITES = ['/chat/sessions', '/chat/conversations/' + ID + '/archive', '/chat/conversations/' + ID + '/restore',
  '/chat/sessions/' + ID + '/messages', '/chat/sessions/' + ID + '/generate', '/chat/sessions/' + ID + '/preflight',
  '/boost-campaigns/' + ID + '/paid-like'];

@Injectable()
class SyntheticGlobal429Guard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (context.switchToHttp().getRequest().headers['x-qa-global-429'] === 'yes') throw new HttpException('Synthetic rejection', 429);
    return true;
  }
}
@Injectable()
class SyntheticAuthenticationGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (request.headers['x-qa-auth'] !== 'synthetic-allowed') throw new UnauthorizedException('Synthetic rejection');
    if (request.headers['x-qa-forbidden'] === 'yes') throw new ForbiddenException('Synthetic rejection');
    request.user = { id: ID };
    return true;
  }
}
const inert = () => jest.fn(async () => ({ syntheticOnly: true }));
const chat = { createSession: inert(), getSessions: inert(), getConversationList: inert(), archiveConversation: inert(),
  restoreConversation: inert(), getMessages: inert(), createMessage: inert(), generateMessage: inert(), preflightMessage: inert() };
const boosts = { createPaidLike: inert(), getMyPaidLikeQuota: inert(), getBoostProducts: inert(), getCurrentCampaign: inert(), getRankings: inert() };
const mocks = [...Object.values(chat), ...Object.values(boosts)];

describe('chat/paid-like privacy before guards through actual Nest HTTP routes', () => {
  let app: INestApplication | undefined, base: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [ChatController, BoostsController],
      providers: [{ provide: ChatService, useValue: chat }, { provide: BoostsService, useValue: boosts },
        { provide: APP_GUARD, useClass: SyntheticGlobal429Guard }],
    }).overrideGuard(JwtAuthGuard).useClass(SyntheticAuthenticationGuard).compile();
    app = module.createNestApplication({ logger: false });
    app.use((_request: unknown, response: { vary(field: string): unknown }, next: () => void) => {
      response.vary('Origin'); response.vary('Accept-Encoding'); next();
    });
    app.use(chatBoostsPrivacyMiddleware);
    configureHttpRouting(app);
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableCors({ origin: [ORIGIN], credentials: true });
    await app.listen(0, '127.0.0.1');
    base = 'http://127.0.0.1:' + app.getHttpServer().address().port;
  });
  beforeEach(() => { for (const mock of mocks) mock.mockClear(); });
  afterAll(async () => { await app?.close(); });
  function dispatches() { return mocks.reduce((count, mock) => count + mock.mock.calls.length, 0); }
  async function call(method: string, path: string, extra: Record<string, string> = {}, body?: string) {
    const headers: Record<string, string> = { Origin: ORIGIN, ...extra };
    if (method === 'POST') headers['Content-Type'] = 'application/json';
    const response = await fetch(base + '/api/v1' + path, { method, headers, body,
      redirect: 'error', signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    expect(response.headers.get('set-cookie')).toBeNull();
    return { response, text };
  }
  function privateStatus(result: Awaited<ReturnType<typeof call>>, status: number) {
    expect(result.response.status).toBe(status);
    expect(result.response.headers.get('cache-control')).toBe('private, no-store');
    const vary = (result.response.headers.get('vary') ?? '').toLowerCase().split(',').map(value => value.trim());
    expect(vary).toEqual(expect.arrayContaining(['origin', 'accept-encoding', 'authorization']));
    expect(vary.filter(value => value === 'authorization')).toHaveLength(1);
    expect(result.response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  }
  it('anonymous 401 is private on every intended read HEAD and POST before service dispatch', async () => {
    for (const path of READS) for (const method of ['GET', 'HEAD']) privateStatus(await call(method, path), 401);
    for (const path of WRITES) privateStatus(await call('POST', path, {}, '{}'), 401);
    expect(dispatches()).toBe(0);
  });
  it('synthetic downstream guard403 retains privacy on all intended surfaces without granting a production role', async () => {
    const headers = { 'x-qa-auth': 'synthetic-allowed', 'x-qa-forbidden': 'yes' };
    for (const path of READS) privateStatus(await call('GET', path, headers), 403);
    for (const path of WRITES) privateStatus(await call('POST', path, headers, '{}'), 403);
    expect(dispatches()).toBe(0);
  });
  it('synthetic global429 is private before authentication and all controllers', async () => {
    for (const path of READS) privateStatus(await call('GET', path, { 'x-qa-global-429': 'yes' }), 429);
    for (const path of WRITES) privateStatus(await call('POST', path, { 'x-qa-global-429': 'yes' }, '{}'), 429);
    expect(dispatches()).toBe(0);
  });
  it('real controller GET200 HEAD200 and POST201 retain merged Origin and Authorization with inert services', async () => {
    const headers = { 'x-qa-auth': 'synthetic-allowed' };
    for (const path of READS) {
      const get = await call('GET', path, headers); privateStatus(get, 200); expect(JSON.parse(get.text)).toEqual({ syntheticOnly: true });
      const head = await call('HEAD', path, headers); privateStatus(head, 200); expect(head.text).toBe('');
    }
    const body = JSON.stringify({ artistId: ID, body: 'Synthetic request' });
    for (const path of WRITES) privateStatus(await call('POST', path, headers, body), 201);
    expect(dispatches()).toBe(15);
  });
  it('malformed paid-like JSON400 is private before parser authentication or service dispatch', async () => {
    privateStatus(await call('POST', WRITES[6], {}, '{'), 400); expect(dispatches()).toBe(0);
  });
  it('public catalogs and rankings and unrelated guarded free-like and usage routes gain no new cache or Authorization Vary', async () => {
    for (const path of ['/boost-products', '/boost-campaigns/current', '/boost-campaigns/' + ID + '/rankings']) {
      const result = await call('GET', path); expect(result.response.status).toBe(200);
      expect(result.response.headers.get('cache-control')).toBeNull();
      expect(result.response.headers.get('vary')?.toLowerCase()).not.toContain('authorization');
    }
    for (const [method, path] of [['POST', '/boost-campaigns/' + ID + '/free-like'], ['GET', '/chat/usage-summary']]) {
      const result = await call(method, path, {}, method === 'POST' ? '{}' : undefined);
      expect(result.response.status).toBe(401); expect(result.response.headers.get('cache-control')).toBeNull();
      expect(result.response.headers.get('vary')?.toLowerCase()).not.toContain('authorization');
    }
    expect(dispatches()).toBe(3);
  });
  it('child paths wrong methods and CORS preflight preserve unrelated response behavior', async () => {
    for (const [method, path] of [['POST', '/chat/conversations'], ['GET', WRITES[6]], ['GET', '/chat/conversations/child'],
      ['POST', WRITES[6] + '/child']]) {
      const result = await call(method, path, {}, method === 'POST' ? '{}' : undefined);
      expect(result.response.status).toBe(404); expect(result.response.headers.get('cache-control')).toBeNull();
      expect(result.response.headers.get('vary')?.toLowerCase()).not.toContain('authorization');
    }
    const preflight = await call('OPTIONS', '/chat/conversations', { 'Access-Control-Request-Method': 'GET' });
    expect(preflight.response.status).toBe(204); expect(preflight.response.headers.get('cache-control')).toBeNull();
    expect(preflight.response.headers.get('vary')?.toLowerCase()).not.toContain('authorization'); expect(dispatches()).toBe(0);
  });
});
