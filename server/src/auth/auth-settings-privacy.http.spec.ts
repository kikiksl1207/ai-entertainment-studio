import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { CanActivate, Controller, ForbiddenException, Get, HttpException, Injectable,
  INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { configureHttpRouting } from '../common/http-routing';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { createValidationException } from '../common/validation-exception.factory';
import { MeController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { settingsPrivacyMiddleware } from './auth-settings.privacy';
import { UpdateSettingsDto } from './dto/auth.dto';

const USER = '00000000-0000-4000-8000-000000000901';
const NOW = new Date('2026-10-08T00:00:00.000Z');
let controlled429 = false;

@Injectable()
class ControlledGlobal429Guard implements CanActivate {
  canActivate() {
    if (controlled429) throw new HttpException('Synthetic global rejection', 429);
    return true;
  }
}

@Controller('qa-settings-public')
class PublicProbeController {
  @Get() get() { return { syntheticOnly: true }; }
}

describe('settings privacy: real localhost HTTP/JWT, synthetic identities and storage', () => {
  let app: INestApplication | undefined, base: string, access: string, badAccess: string;
  let active = true;
  const db = {
    user: { findFirst: jest.fn(async ({ where }: { where: { id: string; status: string; deletedAt: unknown } }) =>
      active && where.id === USER && where.status === 'active' && where.deletedAt === null
        ? { id: USER, email: 'settings-http@example.invalid' } : null) },
    userSettings: { upsert: jest.fn(async ({ update }: { update: Record<string, unknown> }) => ({
      id: '00000000-0000-4000-8000-000000000902', userId: USER,
      locale: 'ko-KR', timezone: 'Asia/Seoul', marketingOptIn: false, pushOptIn: true,
      activityNotifications: true, feedNotifications: true, emailNotifications: true,
      createdAt: NOW, updatedAt: NOW, ...update,
    })) },
  };
  // Existing locale tests use this same native-prototype pattern; no constructor or real client runs.
  const auth = Object.assign(Object.create(AuthService.prototype), { prisma: db }) as AuthService;
  const read = jest.spyOn(auth, 'getSettings');
  const update = jest.spyOn(auth, 'updateSettings');

  beforeAll(async () => {
    const main = readFileSync(join(__dirname, '../main.ts'), 'utf8');
    expect(/import\s*\{\s*settingsPrivacyMiddleware\s*\}\s*from\s*['"]\.\/auth\/auth-settings\.privacy['"]/.test(main)).toBe(true);
    expect((main.match(/app\.use\(settingsPrivacyMiddleware\)/g) ?? []).length).toBe(1);
    expect(/app\.use\(authorBodyTrialReceiptPrivacyMiddleware\);\s*app\.use\(settingsPrivacyMiddleware\);/.test(main)).toBe(true);
    expect(main.indexOf('app.use(settingsPrivacyMiddleware)')).toBeLessThan(main.indexOf('configureHttpRouting(app)'));
    const secret = randomBytes(32).toString('hex');
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret, signOptions: { expiresIn: '5m' } })],
      controllers: [MeController, PublicProbeController],
      providers: [JwtAuthGuard,
        { provide: APP_GUARD, useClass: ControlledGlobal429Guard },
        { provide: PrismaService, useValue: db },
        { provide: AuthService, useValue: auth },
        { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
      ],
    }).compile();
    const jwt = module.get(JwtService);
    access = await jwt.signAsync({ sub: USER, tokenType: 'access' });
    badAccess = await jwt.signAsync({ sub: USER, tokenType: 'access' }, { secret: randomBytes(32).toString('hex') });
    app = module.createNestApplication({ logger: false });
    app.use(settingsPrivacyMiddleware);
    configureHttpRouting(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true,
      forbidUnknownValues: true, transform: true, exceptionFactory: createValidationException }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  });

  beforeEach(() => {
    active = true; controlled429 = false;
    db.user.findFirst.mockClear(); db.userSettings.upsert.mockClear();
    read.mockReset().mockImplementation(AuthService.prototype.getSettings.bind(auth));
    update.mockReset().mockImplementation(AuthService.prototype.updateSettings.bind(auth));
  });
  afterAll(async () => {
    read.mockRestore(); update.mockRestore();
    await app?.close();
    access = ''; badAccess = '';
  });

  async function request(method: 'GET' | 'HEAD' | 'PATCH', token: string | null = access,
    body?: string, path = '/api/v1/me/settings') {
    const headers: Record<string, string> = {};
    if (token !== null) headers.authorization = 'Bearer ' + token;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(base + path, { method, headers, body,
      redirect: 'error', signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    // Boolean assertions cannot print either in-memory signed token on failure.
    expect(text.includes(access)).toBe(false);
    expect(text.includes(badAccess)).toBe(false);
    expect(response.headers.get('set-cookie')).toBeNull();
    return { response, text };
  }
  function privateStatus(result: Awaited<ReturnType<typeof request>>, status: number) {
    expect(result.response.status).toBe(status);
    expect(result.response.headers.get('cache-control')).toBe('private, no-store');
  }
  function noService() {
    expect(read.mock.calls.length).toBe(0); expect(update.mock.calls.length).toBe(0);
    expect(db.userSettings.upsert.mock.calls.length).toBe(0);
  }

  it('GET200 preserves native settings/default creation behind actual JWT validation', async () => {
    const result = await request('GET'); privateStatus(result, 200);
    expect(JSON.parse(result.text).settings.locale).toBe('ko-KR');
    expect(read).toHaveBeenCalledWith(USER);
    expect(db.user.findFirst).toHaveBeenCalledWith({ where: { id: USER, status: 'active', deletedAt: null },
      select: { id: true, email: true } });
    expect(db.userSettings.upsert).toHaveBeenCalledWith({ where: { userId: USER }, update: {}, create: { userId: USER } });
  });

  it('PATCH200 preserves validated canonical zh-Hant and native update arguments', async () => {
    const result = await request('PATCH', access, JSON.stringify({ locale: ' zh-Hant ' })); privateStatus(result, 200);
    expect(JSON.parse(result.text).settings.locale).toBe('zh-Hant');
    expect(update.mock.calls.length).toBe(1);
    expect(update.mock.calls[0][0]).toBe(USER);
    expect(update.mock.calls[0][1]).toBeInstanceOf(UpdateSettingsDto);
    expect(update.mock.calls[0][1].locale).toBe('zh-Hant');
    expect(db.userSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: USER }, update: expect.objectContaining({ locale: 'zh-Hant' }) }));
  });

  it('missing and wrong-signature JWT401 keep privacy before either settings service', async () => {
    for (const token of [null, badAccess]) for (const method of ['GET', 'PATCH'] as const) {
      privateStatus(await request(method, token, method === 'PATCH' ? '{}' : undefined), 401);
    }
    noService(); expect(db.user.findFirst.mock.calls.length).toBe(0);
  });

  it('inactive synthetic identity401 keeps privacy without settings dispatch', async () => {
    active = false;
    for (const method of ['GET', 'PATCH'] as const)
      privateStatus(await request(method, access, method === 'PATCH' ? '{}' : undefined), 401);
    noService(); expect(db.user.findFirst.mock.calls.length).toBe(2);
  });

  it('synthetic downstream403 retains both route statuses and privacy without a new permission', async () => {
    read.mockRejectedValue(new ForbiddenException('Synthetic downstream rejection'));
    update.mockRejectedValue(new ForbiddenException('Synthetic downstream rejection'));
    privateStatus(await request('GET'), 403);
    privateStatus(await request('PATCH', access, '{"locale":"zh-Hant"}'), 403);
    expect(read.mock.calls.length).toBe(1); expect(update.mock.calls.length).toBe(1);
    expect(db.userSettings.upsert.mock.calls.length).toBe(0);
  });

  it('synthetic service500 keeps privacy and does not return a successful response', async () => {
    read.mockRejectedValue(new Error('Synthetic settings failure'));
    update.mockRejectedValue(new Error('Synthetic settings failure'));
    privateStatus(await request('GET'), 500);
    privateStatus(await request('PATCH', access, '{"locale":"zh-Hant"}'), 500);
    expect(read.mock.calls.length).toBe(1); expect(update.mock.calls.length).toBe(1);
    expect(db.userSettings.upsert.mock.calls.length).toBe(0);
  });

  it('DTO400 retains privacy and rejects invalid settings before the service', async () => {
    for (const body of [{ locale: 'fr-FR' }, { marketingOptIn: 'false' }, { unrecognized: true }])
      privateStatus(await request('PATCH', access, JSON.stringify(body)), 400);
    noService();
  });

  it('empty command400 uses the native service rejection without a storage call', async () => {
    privateStatus(await request('PATCH', access, '{}'), 400);
    expect(update.mock.calls.length).toBe(1); expect(db.userSettings.upsert.mock.calls.length).toBe(0);
  });

  it('malformed JSON400 is private before parsing/authentication and service dispatch', async () => {
    privateStatus(await request('PATCH', null, '{'), 400);
    noService(); expect(db.user.findFirst.mock.calls.length).toBe(0);
  });

  it('HEAD and exact middleware paths are private without affecting unrelated public responses', async () => {
    const head = await request('HEAD'); privateStatus(head, 200); expect(head.text).toBe('');
    const publicRead = await request('GET', null, undefined, '/api/v1/qa-settings-public');
    expect(publicRead.response.status).toBe(200); expect(publicRead.response.headers.get('cache-control')).toBeNull();
    const positives = ['/api/v1/me/settings', '/api/me/settings', '/api/v1/me/settings/',
      '/api/me/settings/?q=synthetic', '/api/v1/me/settings?q=synthetic'];
    const negatives = ['/api/v1/me/settings-extra', '/api/v1/me/settings/child', '/api/v1/me/settings//',
      '/api/v1/me/profile', '/api/v1/qa-settings-public'];
    for (const method of ['GET', 'HEAD', 'PATCH']) for (const url of positives) {
      const setHeader = jest.fn(), next = jest.fn();
      settingsPrivacyMiddleware({ method, url }, { setHeader }, next);
      expect(setHeader.mock.calls).toEqual([['Cache-Control', 'private, no-store']]);
      expect(next.mock.calls.length).toBe(1);
    }
    for (const [method, url] of [...negatives.map(url => ['GET', url]),
      ...['OPTIONS', 'POST', 'PUT', 'DELETE', 'get'].map(method => [method, positives[0]])]) {
      const setHeader = jest.fn(), next = jest.fn();
      settingsPrivacyMiddleware({ method, url }, { setHeader }, next);
      expect(setHeader.mock.calls.length).toBe(0); expect(next.mock.calls.length).toBe(1);
    }
  });

  it('controlled global guard429 is private before JWT without claiming real throttler quotas', async () => {
    controlled429 = true;
    for (const method of ['GET', 'PATCH'] as const)
      privateStatus(await request(method, null, method === 'PATCH' ? '{}' : undefined), 429);
    noService(); expect(db.user.findFirst.mock.calls.length).toBe(0);
  });
});
