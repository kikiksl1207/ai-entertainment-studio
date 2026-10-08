import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import {
  BadRequestException, Controller, Get, Header, INestApplication, ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { createValidationException } from '../common/validation-exception.factory';
import { PrismaService } from '../prisma/prisma.service';
import { RewardsController } from './rewards.controller';
import { rewardsPrivacyMiddleware } from './rewards.privacy';
import { RewardsService } from './rewards.service';

const USER = '00000000-0000-4000-8000-000000000971';
const OTHER = '00000000-0000-4000-8000-000000000972';
const ROOT = '/api/v1/rewards';
type Method = 'GET' | 'HEAD' | 'POST' | 'PATCH' | 'OPTIONS';
const readRoutes = [
  ['referral-code', 'getOrCreateReferralCode', true],
  ['referrals', 'getReferralRewards', true],
  ['daily-attendance', 'getDailyAttendanceHistory', true],
  ['daily-attendance/policy', 'getDailyAttendancePolicy', false],
  ['activation-policy', 'getActivationPolicy', false],
  ['ledger-policy', 'getRewardLedgerPolicy', false],
  ['activation-progress', 'getActivationProgress', true],
  ['birthday', 'getBirthdayRewardStatus', true],
] as const;
const writeRoutes = [
  ['daily-attendance', 'claimDailyAttendance'],
  ['birthday/claim', 'claimBirthdayReward'],
  ['activation-quests/first_feed_like/claim', 'claimActivationQuest'],
] as const;

@Controller('qa-reward-public')
class PublicProbeController {
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  get() { return { syntheticOnly: true }; }
}

describe('reward private response: native localhost HTTP/JWT/parser with synthetic readers and service', () => {
  let app: INestApplication | undefined;
  let base = '', access = '', badAccess = '', active = true;
  let verify: jest.SpyInstance | undefined;
  const db = {
    user: { findFirst: jest.fn(async ({ where }: {
      where: { id: string; status: string; deletedAt: unknown };
    }) => active && where.id === USER && where.status === 'active' && where.deletedAt === null
      ? { id: USER, email: null } : null) },
  };
  const service = {
    getOrCreateReferralCode: jest.fn(), getReferralRewards: jest.fn(),
    getDailyAttendanceHistory: jest.fn(), getDailyAttendancePolicy: jest.fn(),
    getActivationPolicy: jest.fn(), getRewardLedgerPolicy: jest.fn(),
    getActivationProgress: jest.fn(), getBirthdayRewardStatus: jest.fn(),
    claimDailyAttendance: jest.fn(), claimBirthdayReward: jest.fn(), claimActivationQuest: jest.fn(),
  };

  beforeAll(async () => {
    // Read registration; never import main.ts or initialize AppModule/PrismaClient.
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    expect(/import\s*\{\s*rewardsPrivacyMiddleware\s*\}\s*from\s*['"]\.\/rewards\/rewards\.privacy['"]/.test(main)).toBe(true);
    expect((main.match(/^\s*app\.use\(rewardsPrivacyMiddleware\);?\s*$/gm) ?? []).length).toBe(1);
    const use = main.indexOf('app.use(rewardsPrivacyMiddleware)');
    expect(use > main.indexOf('app.use(fanEngagementPrivacyMiddleware)')).toBe(true);
    expect(use < main.indexOf('helmet({') && use < main.indexOf('configureHttpRouting(app)')).toBe(true);
    const secret = randomBytes(32).toString('hex');
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret, signOptions: { expiresIn: '5m' } })],
      controllers: [RewardsController, PublicProbeController],
      providers: [JwtAuthGuard,
        { provide: PrismaService, useValue: db },
        { provide: RewardsService, useValue: service },
        { provide: ConfigService, useValue: {
          getOrThrow(name: string) {
            if (name !== 'JWT_ACCESS_SECRET') throw new Error('Unexpected synthetic config key');
            return secret;
          },
        } },
      ],
    }).compile();
    const jwt = module.get(JwtService);
    access = await jwt.signAsync({ sub: USER, tokenType: 'access' });
    badAccess = await jwt.signAsync({ sub: USER, tokenType: 'access' },
      { secret: randomBytes(32).toString('hex') });
    verify = jest.spyOn(jwt, 'verifyAsync');
    app = module.createNestApplication({ rawBody: true, logger: false });
    app.use(rewardsPrivacyMiddleware);
    configureHttpRouting(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true,
      forbidUnknownValues: true, transform: true, exceptionFactory: createValidationException }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  });

  beforeEach(() => {
    active = true;
    verify?.mockClear(); db.user.findFirst.mockClear();
    for (const spy of Object.values(service)) spy.mockReset().mockResolvedValue({ syntheticOnly: true });
  });

  afterAll(async () => {
    try { await app?.close(); }
    finally { verify?.mockRestore(); access = ''; badAccess = ''; base = ''; }
  });

  async function request(method: Method, path: string, token: string | null = access, body?: string) {
    const headers: Record<string, string> = { connection: 'close' };
    if (token !== null) headers.authorization = 'Bearer ' + token;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(base + path, {
      method, headers, body, redirect: 'error', signal: AbortSignal.timeout(4000),
    });
    const text = await response.text();
    expect(access.length > 0 && badAccess.length > 0).toBe(true);
    expect(text.includes(access) || text.includes(badAccess)).toBe(false);
    expect(response.headers.get('set-cookie')).toBeNull();
    return { response, text };
  }

  async function rawRequest(method: Method, target: string, body?: string) {
    const local = new URL(base);
    const headers: Record<string, string | number> = { authorization: 'Bearer ' + access, connection: 'close' };
    if (body !== undefined) {
      headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(body);
    }
    // A raw absolute request-target never changes the owned loopback socket destination.
    const value = await new Promise<{ status: number | undefined; cache: string | undefined;
      cookie: string[] | undefined; text: string }>((resolve, reject) => {
      const outgoing = httpRequest({ hostname: '127.0.0.1', port: Number(local.port), method,
        path: target, headers, agent: false, signal: AbortSignal.timeout(4000) }, incoming => {
        let text = ''; incoming.setEncoding('utf8');
        incoming.on('data', (chunk: string) => { text += chunk; });
        incoming.once('error', reject);
        incoming.once('end', () => resolve({ status: incoming.statusCode,
          cache: incoming.headers['cache-control'], cookie: incoming.headers['set-cookie'], text }));
      });
      outgoing.once('error', reject); outgoing.end(body);
    });
    expect(value.cookie).toBeUndefined();
    expect(value.text.includes(access) || value.text.includes(badAccess)).toBe(false);
    return value;
  }

  function privateStatus(value: Awaited<ReturnType<typeof request>>, status: number) {
    expect(value.response.status).toBe(status);
    expect(value.response.headers.get('cache-control')).toBe('private, no-store');
  }
  function noService() {
    for (const spy of Object.values(service)) expect(spy.mock.calls.length).toBe(0);
  }

  it('all exact GET and HEAD endpoints preserve native CurrentUser and private success without cookies', async () => {
    for (const [path, method, owned] of readRoutes) {
      const value = await request('GET', ROOT + '/' + path + '/?userId=' + OTHER);
      privateStatus(value, 200); expect(JSON.parse(value.text)).toEqual({ syntheticOnly: true });
      const head = await request('HEAD', ROOT + '/' + path + '/?probe=synthetic');
      privateStatus(head, 200); expect(head.text).toBe('');
      if (owned) expect(service[method]).toHaveBeenCalledWith(USER);
      else expect(service[method]).toHaveBeenCalledWith();
      expect(service[method].mock.calls.length).toBe(2);
    }
    expect(verify?.mock.calls.length).toBe(16); expect(db.user.findFirst.mock.calls.length).toBe(16);
    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: { id: USER, status: 'active', deletedAt: null }, select: { id: true, email: true },
    });
    for (const [, method] of writeRoutes) expect(service[method].mock.calls.length).toBe(0);
  });

  it('all explicit POST endpoints retain201 and dispatch one synthetic action for the authenticated owner', async () => {
    for (const [path, method] of writeRoutes) {
      const value = await request('POST', ROOT + '/' + path + '/?userId=' + OTHER, access, '{}');
      privateStatus(value, 201); expect(JSON.parse(value.text)).toEqual({ syntheticOnly: true });
      if (method === 'claimActivationQuest') expect(service[method]).toHaveBeenCalledWith(USER, 'first_feed_like');
      else expect(service[method]).toHaveBeenCalledWith(USER);
      expect(service[method].mock.calls.length).toBe(1);
    }
    expect(verify?.mock.calls.length).toBe(3); expect(db.user.findFirst.mock.calls.length).toBe(3);
    for (const [, method] of readRoutes) expect(service[method].mock.calls.length).toBe(0);
  });

  it('missing or wrong-signature JWT and inactive identity401 are private with no service dispatch', async () => {
    const probes: Array<[Method, string]> = [
      ['GET', 'activation-progress'], ['GET', 'activation-policy'], ['GET', 'daily-attendance'],
      ['HEAD', 'activation-progress'], ['POST', 'daily-attendance'],
    ];
    for (const token of [null, badAccess]) {
      for (const [method, path] of probes) {
        const value = await request(method, ROOT + '/' + path, token, method === 'POST' ? '{}' : undefined);
        privateStatus(value, 401); if (method === 'HEAD') expect(value.text).toBe('');
      }
      if (token === null) expect(verify?.mock.calls.length).toBe(0);
    }
    noService(); expect(db.user.findFirst.mock.calls.length).toBe(0);
    expect(verify?.mock.calls.length).toBe(probes.length);
    active = false;
    for (const [method, path] of probes) {
      privateStatus(await request(method, ROOT + '/' + path, access, method === 'POST' ? '{}' : undefined), 401);
    }
    noService(); expect(db.user.findFirst.mock.calls.length).toBe(probes.length);
    expect(verify?.mock.calls.length).toBe(probes.length * 2);
  });

  it('controlled400 and500 preserve native filter status and privacy on GET HEAD and POST', async () => {
    for (const [status, error] of [
      [400, new BadRequestException('Synthetic controlled invalid input')],
      [500, new Error('Synthetic controlled downstream failure')],
    ] as const) {
      for (const spy of Object.values(service)) spy.mockRejectedValue(error);
      for (const method of ['GET', 'HEAD', 'POST'] as const) {
        const path = method === 'POST' ? 'activation-quests/first_feed_like/claim' : 'activation-progress';
        const value = await request(method, ROOT + '/' + path, access, method === 'POST' ? '{}' : undefined);
        privateStatus(value, status);
        if (method === 'HEAD') expect(value.text).toBe('');
        else expect(JSON.parse(value.text).error.statusCode).toBe(status);
        if (status === 500) expect(value.text.includes('Synthetic controlled downstream failure')).toBe(false);
      }
    }
  });

  it('malformed JSON400 is already private before JWT identity or service dispatch', async () => {
    for (const [path] of writeRoutes) {
      privateStatus(await request('POST', ROOT + '/' + path + '/?probe=synthetic', null, '{'), 400);
    }
    expect(verify?.mock.calls.length).toBe(0); expect(db.user.findFirst.mock.calls.length).toBe(0); noService();
  });

  it('absolute request-target and native case matching use Express pathname without external destination', async () => {
    const absolute = await rawRequest('POST', 'http://qa-reward.invalid' + ROOT +
      '/activation-quests/first_feed_like/claim/?probe=synthetic', '{}');
    expect(absolute.status).toBe(201); expect(absolute.cache).toBe('private, no-store');
    expect(JSON.parse(absolute.text)).toEqual({ syntheticOnly: true });
    expect(service.claimActivationQuest).toHaveBeenCalledWith(USER, 'first_feed_like');
    expect(service.claimActivationQuest.mock.calls.length).toBe(1);
    privateStatus(await request('GET', '/API/V1/REWARDS/ACTIVATION-PROGRESS/?probe=synthetic'), 200);
    expect(service.getActivationProgress).toHaveBeenCalledWith(USER);
    expect(verify?.mock.calls.length).toBe(2); expect(db.user.findFirst.mock.calls.length).toBe(2);
  });

  it('public probe lookalike paths and wrong methods remain outside this private scope', async () => {
    for (const method of ['GET', 'HEAD'] as const) {
      const value = await request(method, '/api/v1/qa-reward-public', null);
      expect(value.response.status).toBe(200);
      expect(value.response.headers.get('cache-control')).toBe('public, max-age=60');
      if (method === 'HEAD') expect(value.text).toBe('');
    }
    for (const [method, path] of [
      ['GET', ROOT], ['GET', ROOT + '/activation-progress/extra'],
      ['GET', '/api/v1/rewards-public/activation-progress'], ['GET', '/rewards/activation-progress'],
      ['POST', ROOT + '/activation-policy'], ['GET', ROOT + '/birthday/claim'],
      ['PATCH', ROOT + '/daily-attendance'],
    ] as const) {
      const value = await request(method, path, null, method === 'POST' || method === 'PATCH' ? '{}' : undefined);
      expect(value.response.status).toBe(404); expect(value.response.headers.get('cache-control')).toBeNull();
    }
    const options = await request('OPTIONS', ROOT + '/activation-progress', null);
    expect(options.response.headers.get('cache-control')).toBeNull();
    expect(verify?.mock.calls.length).toBe(0); expect(db.user.findFirst.mock.calls.length).toBe(0); noService();
  });

  it('native origin-form backslash stays404 without private header or auth dispatch', async () => {
    const value = await rawRequest('GET', '/api/v1/rewards\\activation-progress');
    expect(value.status).toBe(404); expect(value.cache).toBeUndefined();
    expect(verify?.mock.calls.length).toBe(0); expect(db.user.findFirst.mock.calls.length).toBe(0); noService();
  });
});
