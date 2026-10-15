import assert = require('node:assert/strict');
import { ExecutionContext, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { PrismaService } from '../../prisma/prisma.service';

// This secret and every signed fixture are local synthetic verification material, never operating credentials.
const SECRET = 'unit29-synthetic-only-never-an-operating-key';
const OWNER = 'unit29-synthetic-owner';
const MESSAGE = 'Invalid or expired access token';
const UNAVAILABLE = 'Authentication temporarily unavailable';
function fixture(authorization?: string | string[], jwt = new JwtService()) {
  const request: { headers: { authorization?: string | string[] }; user?: { id: string; email?: string } } = {
    headers: { authorization },
  };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  const state = { configurationError: undefined as unknown, lookupError: undefined as unknown,
    user: { id: OWNER, email: 'stored@example.invalid' } as { id: string; email: string | null } | null };
  const names: string[] = [];
  const getOrThrow = jest.fn((name: string) => {
    names.push(name);
    if (state.configurationError) throw state.configurationError;
    assert.equal(name, 'JWT_ACCESS_SECRET'); return SECRET;
  });
  const findFirst = jest.fn(async (args: unknown) => {
    assert.deepEqual(args, { where: { id: OWNER, status: 'active', deletedAt: null }, select: { id: true, email: true } });
    if (state.lookupError) throw state.lookupError;
    return state.user;
  });
  const guard = new JwtAuthGuard(jwt, { getOrThrow } as unknown as ConfigService,
    { user: { findFirst } } as unknown as PrismaService);
  return { request, context, state, names, getOrThrow, findFirst, jwt, guard };
}
async function reject(action: () => Promise<unknown>) {
  try { await action(); } catch (error) { return error; }
  assert.fail('Expected a guarded rejection');
}
function generic(error: unknown) {
  assert(error instanceof UnauthorizedException); assert.equal(error.getStatus(), 401);
  const response = error.getResponse(); assert.equal(typeof response, 'object');
  assert.equal((response as { message: string }).message, MESSAGE);
  assert(!Object.prototype.hasOwnProperty.call(response, 'code'));
}
async function signed(jwt: JwtService, patch: Record<string, unknown> = {}, expiresIn = 3600) {
  return jwt.signAsync({ sub: OWNER, email: 'payload@example.invalid', tokenType: 'access', ...patch },
    { secret: SECRET, expiresIn });
}

describe('JwtAuthGuard safe auth reason focused', () => {
  it('01 actual local verifier expiry is denied with a finite reason and no identity lookup', async () => {
    for (const patch of [{}, { tokenType: 'refresh' }, { sub: ' ' }]) {
      const jwt = new JwtService(), token = await signed(jwt, patch, -60), f = fixture('Bearer ' + token, jwt);
      // Expiry is not proof that application type/subject/owner checks have passed.
      const verifierError = await reject(() => jwt.verifyAsync(token, { secret: SECRET }));
      assert(verifierError instanceof TokenExpiredError);
      const error = await reject(() => f.guard.canActivate(f.context));
      assert(error instanceof UnauthorizedException); assert.equal(error.getStatus(), 401);
      assert.deepEqual(error.getResponse(), { code: 'AUTH_TOKEN_EXPIRED', message: MESSAGE }, 'AUTH_REASON_REAL_EXPIRY');
      assert.equal(f.findFirst.mock.calls.length, 0); assert.equal(f.request.user, undefined);
      assert.deepEqual(f.names, ['JWT_ACCESS_SECRET']);
    }
  });

  it('02 configuration failure is sanitized unavailable while absent bearer never reads configuration', async () => {
    for (const authorization of [undefined, '', 'Basic synthetic', 'Bearer ']) {
      const f = fixture(authorization), error = await reject(() => f.guard.canActivate(f.context));
      assert(error instanceof UnauthorizedException); assert.equal(error.getStatus(), 401);
      assert.equal(f.getOrThrow.mock.calls.length, 0); assert.equal(f.findFirst.mock.calls.length, 0);
      assert.equal(f.request.user, undefined);
    }
    for (const configurationError of [new Error('synthetic sensitive error detail'), new TokenExpiredError('synthetic config error', new Date(0))]) {
      const jwt = new JwtService(), verify = jest.spyOn(jwt, 'verifyAsync'), f = fixture('Bearer synthetic-invalid', jwt);
      f.state.configurationError = configurationError;
      const error = await reject(() => f.guard.canActivate(f.context));
      assert(error instanceof ServiceUnavailableException); assert.equal(error.getStatus(), 503);
      assert.deepEqual(error.getResponse(), { code: 'AUTH_CONFIG_UNAVAILABLE', message: UNAVAILABLE });
      assert(!JSON.stringify(error.getResponse()).includes('synthetic'));
      assert.equal(verify.mock.calls.length, 0); assert.equal(f.findFirst.mock.calls.length, 0);
      assert.equal(f.request.user, undefined); verify.mockRestore();
    }
  });

  it('03 signature type subject future token and spoofed expiry errors remain generic denied', async () => {
    const jwt = new JwtService();
    const invalidSignature = await jwt.signAsync({ sub: OWNER, tokenType: 'access' }, { secret: SECRET + '-other', expiresIn: 3600 });
    const invalidSignatureExpired = await jwt.signAsync({ sub: OWNER, tokenType: 'access' }, { secret: SECRET + '-other', expiresIn: -60 });
    const future = await jwt.signAsync({ sub: OWNER, tokenType: 'access' }, { secret: SECRET, expiresIn: 3600, notBefore: 3600 });
    const tokens = ['not-a-token', invalidSignature, invalidSignatureExpired, future,
      await signed(jwt, { tokenType: 'refresh' }), await signed(jwt, { tokenType: null }),
      await signed(jwt, { sub: ' ' }), await signed(jwt, { sub: 42 })];
    for (const token of tokens) {
      const f = fixture('Bearer ' + token, jwt);
      generic(await reject(() => f.guard.canActivate(f.context)));
      assert.equal(f.findFirst.mock.calls.length, 0); assert.equal(f.request.user, undefined);
    }
    const spoof = new Error('synthetic expiry name'); spoof.name = 'TokenExpiredError';
    for (const error of [spoof, { name: 'TokenExpiredError', expiredAt: new Date(0) }, new Error('synthetic verifier failure')]) {
      const fake = { verifyAsync: jest.fn().mockRejectedValue(error) } as unknown as JwtService;
      const f = fixture('Bearer synthetic-invalid', fake);
      generic(await reject(() => f.guard.canActivate(f.context)));
      assert.equal(f.findFirst.mock.calls.length, 0); assert.equal(f.request.user, undefined);
    }
  });

  it('04 valid access preserves server principal active user predicate and lookup failure behavior', async () => {
    const jwt = new JwtService(), token = await signed(jwt);
    for (const email of ['stored@example.invalid', null]) {
      const f = fixture(['Bearer ' + token], jwt); f.state.user = { id: OWNER, email };
      assert.equal(await f.guard.canActivate(f.context), true);
      assert.deepEqual(f.request.user, { id: OWNER, email: email ?? 'payload@example.invalid' });
      assert.equal(f.findFirst.mock.calls.length, 1); assert.deepEqual(f.names, ['JWT_ACCESS_SECRET']);
    }
    {
      const f = fixture('Bearer ' + token, jwt); f.state.user = null;
      generic(await reject(() => f.guard.canActivate(f.context)));
      assert.equal(f.findFirst.mock.calls.length, 1); assert.equal(f.request.user, undefined);
    }
    {
      const f = fixture('Bearer ' + token, jwt); f.state.lookupError = new Error('synthetic database detail');
      const error = await reject(() => f.guard.canActivate(f.context));
      assert(error instanceof ServiceUnavailableException); assert.equal(error.getStatus(), 503);
      assert.deepEqual(error.getResponse(), { code: 'AUTH_LOOKUP_UNAVAILABLE', message: UNAVAILABLE });
      assert.equal(f.findFirst.mock.calls.length, 1); assert.equal(f.request.user, undefined);
    }
  });
});
