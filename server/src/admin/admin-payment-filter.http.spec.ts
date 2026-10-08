import 'reflect-metadata';
import { Controller, Get, Header, INestApplication, MiddlewareConsumer, Module,
  NestModule, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { IncomingHttpHeaders, request } from 'node:http';
import { AddressInfo } from 'node:net';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { createValidationException } from '../common/validation-exception.factory';
import { PrismaService } from '../prisma/prisma.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminTestAccountPrivacyMiddleware } from './admin-test-account.privacy';
import { AdminUsersReadService } from './admin-users-read.service';

const ACCESS_SECRET = 'synthetic-payment-http-access-secret-not-an-operating-key';
const AUTH_USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FILTER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ADMIN_RECORD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ORDER = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'payment-auth@example.invalid';
const CANARY = 'QA_FINANCE_SERVICE_JSON_CANARY_20261006';
const NOW = new Date('2026-10-08T00:00:00.000Z');
const PAYMENT_PATH = '/admin/api/v1/payment-orders';
const PUBLIC_PATH = '/api/v1/qa-payment-filter-public';

const db = {
  user: { findFirst: jest.fn() },
  adminUser: { findUnique: jest.fn(), update: jest.fn() },
  paymentOrder: { findMany: jest.fn() },
};

function adminRow(permissions = ['payments:read']) {
  return { id: ADMIN_RECORD, userId: AUTH_USER, status: 'active',
    role: { name: 'accounting_admin', permissions } };
}

function paymentRow() {
  return {
    id: ORDER, userId: FILTER_USER, luminaProductId: ORDER, orderNo: 'QA-HTTP-ORDER',
    provider: 'qa-provider', status: 'paid', amount: new Decimal('123456789012.34'), currency: 'KRW',
    createdAt: NOW, updatedAt: NOW, idempotencyKey: CANARY, metadata: { marker: CANARY },
    user: { id: FILTER_USER, email: 'payment-payer@example.invalid', status: 'active',
      createdAt: NOW, passwordHash: CANARY },
    luminaProduct: null,
    transactions: [{ id: ORDER, paymentOrderId: ORDER, provider: 'qa-provider',
      providerTransactionId: 'QA-HTTP-TX', status: 'paid', createdAt: NOW,
      rawPayload: { marker: CANARY } }],
    refunds: [],
  };
}

@Controller('qa-payment-filter-public')
class PublicProbeController {
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  get() { return { syntheticOnly: true }; }
}

@Module({
  imports: [JwtModule.register({ secret: ACCESS_SECRET, signOptions: { expiresIn: 300 } })],
  controllers: [AdminController, PublicProbeController],
  providers: [AdminService, AdminUsersReadService, JwtAuthGuard, AdminAuthGuard, AdminPermissionGuard,
    { provide: PrismaService, useValue: db },
    { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: ACCESS_SECRET, ADMIN_EMAILS: '' }) }],
})
class PaymentTransportModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AdminTestAccountPrivacyMiddleware).forRoutes(AdminController);
  }
}

type Reply = { status: number; headers: IncomingHttpHeaders; body: unknown };

describe('payment filter HTTP transport with native guards and signed synthetic JWTs', () => {
  let app: INestApplication, base: string, accessToken: string, badSignatureToken: string;
  let serviceRead: jest.SpyInstance;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [PaymentTransportModule] }).compile();
    const jwt = module.get(JwtService);
    const payload = { sub: AUTH_USER, email: EMAIL, tokenType: 'access' };
    accessToken = await jwt.signAsync(payload);
    badSignatureToken = await jwt.signAsync(payload, { secret: 'different-synthetic-http-secret' });
    serviceRead = jest.spyOn(module.get(AdminService), 'getPaymentOrders');
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true,
      forbidUnknownValues: true, transform: true, exceptionFactory: createValidationException }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    if (!address || address.address !== '127.0.0.1' || address.port <= 0) {
      throw new Error('Synthetic HTTP listener must be loopback only');
    }
    base = `http://127.0.0.1:${address.port}`;
  }, 15000);

  afterAll(async () => {
    try { await app?.close(); } finally { serviceRead?.mockRestore(); }
  }, 15000);

  beforeEach(() => {
    db.user.findFirst.mockReset().mockResolvedValue({ id: AUTH_USER, email: EMAIL });
    db.adminUser.findUnique.mockReset().mockResolvedValue(adminRow());
    // The real guard's lastAccessAt touch is recorded, never sent to a database.
    db.adminUser.update.mockReset().mockResolvedValue({ id: ADMIN_RECORD });
    db.paymentOrder.findMany.mockReset().mockResolvedValue([paymentRow()]);
    serviceRead.mockClear();
  });

  function get(route: string, token?: string): Promise<Reply> {
    const url = new URL(route, base);
    if (url.origin !== base) throw new Error('Synthetic HTTP request escaped loopback origin');
    return new Promise((resolve, reject) => {
      const req = request(url, { agent: false, headers: token ? { authorization: 'Bearer ' + token } : {} }, res => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 65536) req.destroy(new Error('Synthetic HTTP response exceeded bound'));
          else chunks.push(chunk);
        });
        res.once('error', reject);
        res.once('end', () => {
          try { resolve({ status: res.statusCode ?? 0, headers: res.headers,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }); }
          catch (error) { reject(error); }
        });
      });
      req.setTimeout(3000, () => req.destroy(new Error('Synthetic loopback request timed out')));
      req.once('error', reject);
      req.end();
    });
  }

  function expectPrivate(reply: Reply) {
    expect(reply.headers['cache-control']).toBe('private, no-store');
    expect(reply.headers.pragma).toBe('no-cache');
    expect(reply.headers.expires).toBe('0');
    expect(String(reply.headers.vary ?? '').split(',').map(value => value.trim().toLowerCase()))
      .toContain('authorization');
    expect(JSON.stringify(reply.body)).not.toContain(CANARY);
  }

  function expectAcceptedAuth() {
    expect(db.user.findFirst).toHaveBeenCalledTimes(1);
    expect(db.adminUser.findUnique).toHaveBeenCalledTimes(1);
    expect(db.adminUser.update).toHaveBeenCalledTimes(1);
    expect(db.adminUser.update).toHaveBeenCalledWith({ where: { id: ADMIN_RECORD },
      data: { lastAccessAt: expect.any(Date) } });
  }

  it('rejects repeated userId keys with actual parsed array, 400 and payment reader0', async () => {
    const reply = await get(`${PAYMENT_PATH}?userId=${FILTER_USER}&userId=${OTHER_USER}`, accessToken);
    expect(reply.status).toBe(400);
    expectPrivate(reply);
    expectAcceptedAuth();
    expect(serviceRead).toHaveBeenCalledTimes(1);
    expect(serviceRead.mock.calls[0][0]).toEqual({ userId: [FILTER_USER, OTHER_USER] });
    expect(db.paymentOrder.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['array', `userId%5B0%5D=${FILTER_USER}&userId%5B1%5D=${OTHER_USER}`, [FILTER_USER, OTHER_USER]],
    ['object', `userId%5Bid%5D=${FILTER_USER}`, { id: FILTER_USER }],
  ] as const)('observes actual bracket %s parsing and rejects before payment read', async (_name, query, shape) => {
    const reply = await get(PAYMENT_PATH + '?' + query, accessToken);
    expect(reply.status).toBe(400);
    expectPrivate(reply);
    expectAcceptedAuth();
    expect(serviceRead).toHaveBeenCalledTimes(1);
    expect(serviceRead.mock.calls[0][0]).toEqual({ userId: shape });
    expect(db.paymentOrder.findMany).not.toHaveBeenCalled();
  });

  it('preserves omitted userId, default pagination and projected financial data over HTTP', async () => {
    const reply = await get(PAYMENT_PATH, accessToken);
    expect(reply.status).toBe(200);
    expectPrivate(reply);
    expectAcceptedAuth();
    expect(serviceRead).toHaveBeenCalledTimes(1);
    expect(db.paymentOrder.findMany).toHaveBeenCalledTimes(1);
    expect(db.paymentOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {}, take: 51 }));
    expect(reply.body).toMatchObject({ count: 1, hasMore: false, nextCursor: null,
      items: [{ id: ORDER, userId: FILTER_USER, amount: '123456789012.34',
        transactions: [{ providerTransactionId: 'QA-HTTP-TX' }] }] });
  });

  it('preserves valid UUID trimming and scoped where/pagination over HTTP', async () => {
    const query = `userId=${encodeURIComponent(' ' + FILTER_USER + ' ')}&take=2&cursor=${ORDER}`;
    const reply = await get(PAYMENT_PATH + '?' + query, accessToken);
    expect(reply.status).toBe(200);
    expectPrivate(reply);
    expectAcceptedAuth();
    expect(serviceRead).toHaveBeenCalledTimes(1);
    expect(db.paymentOrder.findMany).toHaveBeenCalledTimes(1);
    expect(db.paymentOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: FILTER_USER }, take: 3, cursor: { id: ORDER }, skip: 1,
      orderBy: { createdAt: 'desc' },
    }));
    expect(reply.body).toMatchObject({ count: 1, items: [{ userId: FILTER_USER }] });
  });

  it.each(['missing', 'bad signature'] as const)('rejects %s access JWT with 401 before auth/payment reads', async kind => {
    const reply = await get(PAYMENT_PATH, kind === 'missing' ? undefined : badSignatureToken);
    expect(reply.status).toBe(401);
    expectPrivate(reply);
    expect(db.user.findFirst).not.toHaveBeenCalled();
    expect(db.adminUser.findUnique).not.toHaveBeenCalled();
    expect(db.adminUser.update).not.toHaveBeenCalled();
    expect(serviceRead).not.toHaveBeenCalled();
    expect(db.paymentOrder.findMany).not.toHaveBeenCalled();
  });

  it('rejects a signed-in non-admin with 403 before controller/payment read', async () => {
    db.adminUser.findUnique.mockResolvedValue(null);
    const reply = await get(PAYMENT_PATH, accessToken);
    expect(reply.status).toBe(403);
    expectPrivate(reply);
    expect(db.user.findFirst).toHaveBeenCalledTimes(1);
    expect(db.adminUser.findUnique).toHaveBeenCalledTimes(1);
    expect(db.adminUser.update).not.toHaveBeenCalled();
    expect(serviceRead).not.toHaveBeenCalled();
    expect(db.paymentOrder.findMany).not.toHaveBeenCalled();
  });

  it('uses the real permission guard to deny an active admin without payments:read', async () => {
    db.adminUser.findUnique.mockResolvedValue(adminRow([]));
    const reply = await get(PAYMENT_PATH, accessToken);
    expect(reply.status).toBe(403);
    expectPrivate(reply);
    expectAcceptedAuth();
    expect(serviceRead).not.toHaveBeenCalled();
    expect(db.paymentOrder.findMany).not.toHaveBeenCalled();
  });

  it('preserves private cache headers and masks a payment-reader failure as 500', async () => {
    db.paymentOrder.findMany.mockRejectedValue(new Error(CANARY));
    const reply = await get(PAYMENT_PATH + '?userId=' + FILTER_USER, accessToken);
    expect(reply.status).toBe(500);
    expectPrivate(reply);
    expectAcceptedAuth();
    expect(serviceRead).toHaveBeenCalledTimes(1);
    expect(db.paymentOrder.findMany).toHaveBeenCalledTimes(1);
    expect(reply.body).toMatchObject({ success: false,
      error: { statusCode: 500, message: 'Internal server error' } });
  });

  it('leaves an unrelated public probe and its cache policy unaffected', async () => {
    const reply = await get(PUBLIC_PATH);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ syntheticOnly: true });
    expect(reply.headers['cache-control']).toBe('public, max-age=60');
    expect(reply.headers.pragma).toBeUndefined();
    expect(reply.headers.expires).toBeUndefined();
    expect(reply.headers.vary).toBeUndefined();
    expect(db.user.findFirst).not.toHaveBeenCalled();
    expect(db.adminUser.findUnique).not.toHaveBeenCalled();
    expect(db.adminUser.update).not.toHaveBeenCalled();
    expect(serviceRead).not.toHaveBeenCalled();
    expect(db.paymentOrder.findMany).not.toHaveBeenCalled();
  });
});
