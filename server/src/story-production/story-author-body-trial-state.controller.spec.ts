import 'reflect-metadata';
import {
  ConflictException,
  ForbiddenException,
  INestApplication,
  InternalServerErrorException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { request } from 'http';
import { AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { PrismaService } from '../prisma/prisma.service';
import { StoryAuthorBodyTrialStateController } from './story-author-body-trial-state.controller';
import { StoryAuthorBodyTrialStateService } from './story-author-body-trial-state.service';

const owner = randomUUID(), outsider = randomUUID(), inactiveUser = randomUUID(), workId = randomUUID();
const snapshot = { workId, readOnly: true, status: 'synthetic-current-state' };

describe.each([false, true])(
  'author body trial state HTTP (real Nest/JWT/HTTP, stubbed state/account, no DB, global validation=%s)',
  globalValidation => {
    let app: INestApplication, port: number, token: string, otherToken: string;
    let invalidTokens: Record<string, string>;

    // Ownership rejection here is a service stub, not a database authorization check.
    const currentStateStub = async (userId: string, requestedWorkId: string) => {
      if (userId !== owner || requestedWorkId.toLowerCase() !== workId) {
        throw new NotFoundException({ code: 'STORY_AUTHOR_BODY_TRIAL_STATE_NOT_FOUND' });
      }
      return snapshot;
    };
    const states = { current: jest.fn(currentStateStub) };
    const findAccount = jest.fn(async ({ where }: {
      where: { id: string; status: string; deletedAt: unknown };
    }) => [owner, outsider].some(id => id === where.id) && where.status === 'active' && where.deletedAt === null
      ? { id: where.id, email: 'synthetic-author@example.invalid' } : null);

    beforeAll(async () => {
      const secret = randomUUID(), jwt = new JwtService();
      const payload = { sub: owner, userId: outsider, tokenType: 'access' };
      token = await jwt.signAsync(payload, { secret, expiresIn: '5m' });
      otherToken = await jwt.signAsync({ sub: outsider, tokenType: 'access' }, { secret, expiresIn: '5m' });
      invalidTokens = {
        malformed: 'invalid',
        expired: await jwt.signAsync(payload, { secret, expiresIn: -60 }),
        wrongSignature: await jwt.signAsync(payload, { secret: randomUUID(), expiresIn: '5m' }),
        refresh: await jwt.signAsync({ ...payload, tokenType: 'refresh' }, { secret, expiresIn: '5m' }),
        inactiveAccount: await jwt.signAsync({ ...payload, sub: inactiveUser }, { secret, expiresIn: '5m' }),
      };
      const module = await Test.createTestingModule({
        controllers: [StoryAuthorBodyTrialStateController],
        providers: [
          { provide: StoryAuthorBodyTrialStateService, useValue: states },
          { provide: PrismaService, useValue: { user: { findFirst: findAccount } } },
          { provide: JwtService, useValue: jwt },
          { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
          JwtAuthGuard,
        ],
      }).compile();
      app = module.createNestApplication({ logger: false });
      configureHttpRouting(app);
      app.useGlobalFilters(new HttpExceptionFilter());
      if (globalValidation) {
        app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
      }
      await app.listen(0, '127.0.0.1');
      port = (app.getHttpServer().address() as AddressInfo).port;
    });

    beforeEach(() => {
      states.current.mockReset().mockImplementation(currentStateStub);
      findAccount.mockClear();
    });
    afterAll(async () => { await app?.close(); });

    type CallOptions = {
      authorization?: string | null;
      work?: string;
      query?: string;
      method?: string;
    };
    function call(options: CallOptions = {}) {
      const { authorization = token, work = workId, query = '', method = 'GET' } = options;
      return new Promise<{ status: number; cache?: string; body: unknown }>((resolve, reject) => {
        const req = request({
          hostname: '127.0.0.1', port, method,
          path: `/api/v1/me/creator-studio/stories/${work}/body-trial-state${query ? `?${query}` : ''}`,
          headers: authorization !== null ? { authorization: `Bearer ${authorization}` } : {},
        }, res => {
          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('error', reject);
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode!, cache: res.headers['cache-control'],
                body: JSON.parse(Buffer.concat(chunks).toString()) });
            } catch (error) {
              reject(error);
            }
          });
        });
        req.setTimeout(10000, () => req.destroy(new Error('Local HTTP timeout')));
        req.on('error', reject);
        req.end();
      });
    }

    function expectPrivateError(response: Awaited<ReturnType<typeof call>>, status: number) {
      expect(response.status).toBe(status);
      expect(response.cache).toBe('private, no-store');
      expect(response.body).toMatchObject({ success: false, error: { statusCode: status } });
      expect(JSON.stringify(response.body)).not.toContain(snapshot.status);
      expect(response.body).not.toHaveProperty('workId');
    }

    it('returns the service state unchanged using only the verified JWT subject and route UUID', async () => {
      const response = await call();
      expect(response.status).toBe(200);
      expect(response.cache).toBe('private, no-store');
      expect(response.body).toEqual(snapshot);
      expect(states.current).toHaveBeenCalledTimes(1);
      expect(states.current.mock.calls[0]).toEqual([owner, workId]);
      expect(findAccount).toHaveBeenCalledWith({
        where: { id: owner, status: 'active', deletedAt: null },
        select: { id: true, email: true },
      });
    });

    it('accepts uppercase UUIDs without changing the work ID passed to the service', async () => {
      const work = workId.toUpperCase();
      const response = await call({ work });
      expect(response.status).toBe(200);
      expect(response.cache).toBe('private, no-store');
      expect(response.body).toEqual(snapshot);
      expect(states.current.mock.calls).toEqual([[owner, work]]);
    });

    it('sets no-store before missing-token failure even when UUID and query inputs are invalid', async () => {
      expectPrivateError(await call({ authorization: null, work: 'invalid', query: 'userId=other' }), 401);
      expect(states.current).not.toHaveBeenCalled();
      expect(findAccount).not.toHaveBeenCalled();
    });

    it('rejects an unauthenticated request to an otherwise valid route', async () => {
      expectPrivateError(await call({ authorization: null }), 401);
      expect(states.current).not.toHaveBeenCalled();
      expect(findAccount).not.toHaveBeenCalled();
    });

    it.each(['malformed', 'expired', 'wrongSignature', 'refresh', 'inactiveAccount'])(
      'keeps JWT failure private without reading state: %s', async kind => {
        expectPrivateError(await call({ authorization: invalidTokens[kind] }), 401);
        expect(states.current).not.toHaveBeenCalled();
      },
    );

    it.each(['invalid', workId.slice(0, -1), `${workId}x`, `%20${workId}%20`])(
      'rejects an invalid work UUID before service access: %s', async work => {
        expectPrivateError(await call({ work }), 400);
        expect(states.current).not.toHaveBeenCalled();
      },
    );

    it.each([
      'owner=other', 'ownerUserId=other', 'userId=other', 'releaseId=other',
      'approvalId=other', 'progressId=other', 'locale=ko', 'startAt=now',
      'budgetKrw=999999', 'generateImages=true', 'x=1&x=2', 'x=', 'unknown', '=value', '&', '&&',
      '__proto__=other', '__proto__[owner]=other', 'constructor[prototype][owner]=other',
      '%5F%5Fproto%5F%5F%5Bowner%5D=other',
    ])('rejects every query parameter before service access: %s', async query => {
      const response = await call({ query });
      expectPrivateError(response, 400);
      expect(response.body).toMatchObject({ error: { code: 'STORY_AUTHOR_BODY_TRIAL_STATE_INPUT_INVALID' } });
      expect(states.current).not.toHaveBeenCalled();
    });

    it('passes the authenticated outsider to the ownership stub and preserves its non-disclosing 404', async () => {
      const response = await call({ authorization: otherToken });
      expectPrivateError(response, 404);
      expect(response.body).toMatchObject({ error: { code: 'STORY_AUTHOR_BODY_TRIAL_STATE_NOT_FOUND' } });
      expect(states.current.mock.calls).toEqual([[outsider, workId]]);
      expect(findAccount).toHaveBeenCalledWith({
        where: { id: outsider, status: 'active', deletedAt: null },
        select: { id: true, email: true },
      });
    });

    it.each([
      new ForbiddenException({ code: 'STORY_AUTHOR_BODY_TRIAL_STATE_FORBIDDEN' }),
      new NotFoundException({ code: 'STORY_AUTHOR_BODY_TRIAL_STATE_NOT_FOUND' }),
      new ConflictException({ code: 'STORY_AUTHOR_BODY_TRIAL_STATE_CONFLICT' }),
      new InternalServerErrorException({ code: 'STORY_AUTHOR_BODY_TRIAL_STATE_FAILED' }),
    ])('preserves service HTTP errors with no-store and no retry: %p', async error => {
      states.current.mockRejectedValueOnce(error);
      const response = await call();
      expectPrivateError(response, error.getStatus());
      expect(response.body).toMatchObject({ error: error.getResponse() });
      expect(states.current.mock.calls).toEqual([[owner, workId]]);
    });

    it('returns a private 500 without fallback state or leaked details after an unexpected service failure', async () => {
      states.current.mockRejectedValueOnce(new Error('synthetic private service failure'));
      const response = await call();
      expectPrivateError(response, 500);
      expect(response.body).toMatchObject({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
      expect(JSON.stringify(response.body)).not.toContain('synthetic private service failure');
      expect(states.current.mock.calls).toEqual([[owner, workId]]);
    });

    it('reads fresh service state on each GET and keeps both responses private and non-cacheable', async () => {
      const updated = { ...snapshot, status: 'synthetic-updated-state' };
      states.current.mockResolvedValueOnce(snapshot).mockResolvedValueOnce(updated);
      const first = await call(), second = await call();
      for (const response of [first, second]) {
        expect(response.status).toBe(200);
        expect(response.cache).toBe('private, no-store');
      }
      expect(first.body).toEqual(snapshot);
      expect(second.body).toEqual(updated);
      expect(states.current.mock.calls).toEqual([[owner, workId], [owner, workId]]);
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('exposes no write route for %s', async method => {
      const response = await call({ method });
      expect(response.status).toBe(404);
      expect(states.current).not.toHaveBeenCalled();
      expect(findAccount).not.toHaveBeenCalled();
    });
  },
);
