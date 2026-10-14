import 'reflect-metadata';
import { ExecutionContext, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { AuthUser } from '../auth.types';
import { JwtAuthGuard } from './jwt-auth.guard';

jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class PrismaService {} }));

const OWNER = '00000000-0000-4000-8000-000000000815';
const TOKEN = 'synthetic-lookup-access';
const SECRET = 'synthetic-lookup-secret-not-a-real-key';
const PRIVATE_DETAIL = 'SYNTHETIC_PRIVATE_LOOKUP_DETAIL';

function setup(authorization: string | string[] | undefined = `Bearer ${TOKEN}`) {
  const request: { headers: Record<string, string | string[] | undefined>; user?: AuthUser } = {
    headers: { authorization },
  };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
  const jwt = { verifyAsync: jest.fn().mockResolvedValue({
    sub: OWNER, tokenType: 'access', email: 'synthetic-token@example.invalid',
  }) };
  const config = { getOrThrow: jest.fn().mockReturnValue(SECRET) };
  const prisma = { user: { findFirst: jest.fn().mockResolvedValue({
    id: OWNER, email: 'synthetic-user@example.invalid',
  }) } };
  const readService = jest.fn();
  const guard = new JwtAuthGuard(jwt as never, config as never, prisma as never);
  return { guard, context, request, jwt, config, prisma, readService };
}

async function deniedRead(state: ReturnType<typeof setup>) {
  let caught: unknown;
  try {
    if (await state.guard.canActivate(state.context)) state.readService(state.request.user);
  } catch (error) {
    caught = error;
  }
  expect(state.request.user).toBeUndefined();
  expect(state.readService).not.toHaveBeenCalled();
  expect(caught).toBeInstanceOf(HttpException);
  return caught as HttpException;
}

function expectUnauthorized(error: HttpException) {
  expect(error.getStatus()).toBe(401);
  expect(error.getResponse()).toEqual({
    statusCode: 401, message: 'Invalid or expired access token', error: 'Unauthorized',
  });
  expect(JSON.stringify(error.getResponse())).not.toContain(PRIVATE_DETAIL);
}

function expectLookupUnavailable(error: HttpException) {
  expect(error.getStatus()).toBe(503);
  expect(error).toBeInstanceOf(ServiceUnavailableException);
  expect(error.getResponse()).toEqual({
    code: 'AUTH_LOOKUP_UNAVAILABLE', message: 'Authentication temporarily unavailable',
  });
  for (const value of [PRIVATE_DETAIL, TOKEN, SECRET, OWNER, 'synthetic-user@example.invalid']) {
    expect(JSON.stringify(error.getResponse())).not.toContain(value);
  }
}

function expectLookupQuery(state: ReturnType<typeof setup>) {
  expect(state.prisma.user.findFirst).toHaveBeenCalledTimes(1);
  expect(state.prisma.user.findFirst).toHaveBeenCalledWith({
    where: { id: OWNER, status: 'active', deletedAt: null }, select: { id: true, email: true },
  });
}

describe('JwtAuthGuard lookup classification', () => {
  it('lookupfailure503 AUTH_LOOKUP_UNAVAILABLE async infrastructure error is sanitized', async () => {
    const state = setup();
    // The BASE comparison starts with an active-user default, not a null-user denial.
    state.prisma.user.findFirst.mockRejectedValueOnce(new Error(PRIVATE_DETAIL));
    const error = await deniedRead(state);
    expectLookupUnavailable(error);
    expectLookupQuery(state);
    expect(state.jwt.verifyAsync).toHaveBeenCalledTimes(1);
  });

  it('sanitizes synchronous lookup throws as 503 without attaching a user or dispatching', async () => {
    const state = setup();
    state.prisma.user.findFirst.mockImplementationOnce(() => { throw new Error(PRIVATE_DETAIL); });
    expectLookupUnavailable(await deniedRead(state));
    expectLookupQuery(state);
    expect(state.jwt.verifyAsync).toHaveBeenCalledTimes(1);
  });

  it('preserves active-user projection, first bearer header and token-email fallback', async () => {
    for (const authorization of [`Bearer ${TOKEN}`, [`Bearer ${TOKEN}`, 'Bearer ignored-second']]) {
      for (const email of ['synthetic-user@example.invalid', null]) {
        const state = setup(authorization);
        state.prisma.user.findFirst.mockResolvedValueOnce({ id: OWNER, email });
        expect(state.guard).toBeInstanceOf(JwtAuthGuard);
        await expect(state.guard.canActivate(state.context)).resolves.toBe(true);
        expect(state.config.getOrThrow).toHaveBeenCalledTimes(1);
        expect(state.config.getOrThrow).toHaveBeenCalledWith('JWT_ACCESS_SECRET');
        expect(state.jwt.verifyAsync).toHaveBeenCalledTimes(1);
        expect(state.jwt.verifyAsync).toHaveBeenCalledWith(TOKEN, { secret: SECRET });
        expectLookupQuery(state);
        expect(state.request.user).toEqual({
          id: OWNER, email: email ?? 'synthetic-token@example.invalid',
        });
      }
    }
  });

  it('keeps an absent active user a generic 401 rather than lookup-unavailable', async () => {
    const state = setup();
    state.prisma.user.findFirst.mockResolvedValueOnce(null);
    expectUnauthorized(await deniedRead(state));
    expectLookupQuery(state);
  });

  it('keeps invalid and expired verification errors 401 with zero lookup and dispatch', async () => {
    for (const message of ['invalid signature', 'expired token']) {
      const state = setup();
      state.jwt.verifyAsync.mockRejectedValueOnce(new Error(`${message} ${PRIVATE_DETAIL}`));
      expectUnauthorized(await deniedRead(state));
      expect(state.prisma.user.findFirst).not.toHaveBeenCalled();
    }
  });

  it('keeps wrong token type and invalid subject claims 401 before lookup', async () => {
    for (const payload of [
      { sub: OWNER, tokenType: 'refresh' }, { sub: OWNER },
      { tokenType: 'access' }, { sub: '', tokenType: 'access' },
      { sub: '   ', tokenType: 'access' }, { sub: 123, tokenType: 'access' },
      { sub: null, tokenType: 'access' }, null,
    ]) {
      const state = setup();
      state.jwt.verifyAsync.mockResolvedValueOnce(payload);
      expectUnauthorized(await deniedRead(state));
      expect(state.prisma.user.findFirst).not.toHaveBeenCalled();
    }
  });

  it('keeps verification ServiceUnavailableException and configuration throws classified as 401', async () => {
    const verification = setup();
    verification.jwt.verifyAsync.mockRejectedValueOnce(new ServiceUnavailableException(PRIVATE_DETAIL));
    expectUnauthorized(await deniedRead(verification));
    expect(verification.prisma.user.findFirst).not.toHaveBeenCalled();
    for (const error of [new Error(PRIVATE_DETAIL), new ServiceUnavailableException(PRIVATE_DETAIL)]) {
      const state = setup();
      state.config.getOrThrow.mockImplementationOnce(() => { throw error; });
      expectUnauthorized(await deniedRead(state));
      expect(state.jwt.verifyAsync).not.toHaveBeenCalled();
      expect(state.prisma.user.findFirst).not.toHaveBeenCalled();
    }
  });

  it('preserves missing and malformed bearer rejection before verification or lookup', async () => {
    for (const authorization of [undefined, '', 'Bearer', 'Bearer ', 'Basic synthetic', 'bearer synthetic', []]) {
      const state = setup();
      state.request.headers.authorization = authorization;
      const error = await deniedRead(state);
      expect(error.getStatus()).toBe(401);
      expect(error.getResponse()).toEqual({
        statusCode: 401, message: 'Bearer token is required', error: 'Unauthorized',
      });
      expect(state.jwt.verifyAsync).not.toHaveBeenCalled();
      expect(state.prisma.user.findFirst).not.toHaveBeenCalled();
    }
  });
});
