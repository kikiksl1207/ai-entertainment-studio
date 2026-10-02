import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthUser } from '../auth.types';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

const userId = '00000000-0000-4000-8000-000000000101';

function setup(authorization?: string | string[]) {
  const request: {
    headers: Record<string, string | string[] | undefined>;
    user?: AuthUser;
  } = { headers: { authorization } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
  const jwt = {
    verifyAsync: jest.fn().mockResolvedValue({
      sub: userId,
      email: 'token@example.test',
      tokenType: 'access',
    }),
  };
  const config = { getOrThrow: jest.fn().mockReturnValue('test-secret') };
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: userId, email: 'user@example.test' }) },
  };
  const guard = new OptionalJwtAuthGuard(jwt as never, config as never, prisma as never);
  return { request, context, jwt, config, prisma, guard };
}

describe('OptionalJwtAuthGuard', () => {
  it('allows public access without an authorization header', async () => {
    const { guard, context, request, jwt, prisma } = setup();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    { authorization: '' },
    { authorization: 'Bearer' },
    { authorization: 'Bearer ' },
    { authorization: 'Bearer   ' },
    { authorization: 'Basic token' },
    { authorization: [] },
  ])(
    'rejects an explicitly malformed authorization header: $authorization',
    async ({ authorization }) => {
      const { guard, context, request, jwt, prisma } = setup(authorization);

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(request.user).toBeUndefined();
      expect(jwt.verifyAsync).not.toHaveBeenCalled();
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    },
  );

  it.each(['invalid signature', 'expired token'])('returns 401 for %s instead of anonymous access', async (message) => {
    const { guard, context, request, jwt, prisma } = setup('Bearer bad-token');
    jwt.verifyAsync.mockRejectedValue(new Error(message));

    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 401 });
    expect(request.user).toBeUndefined();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    { sub: userId, tokenType: 'refresh' },
    { sub: userId },
    { tokenType: 'access' },
    { sub: '', tokenType: 'access' },
    { sub: '   ', tokenType: 'access' },
    { sub: 123, tokenType: 'access' },
  ])('rejects a verified token with invalid access claims: %j', async (payload) => {
    const { guard, context, request, jwt, prisma } = setup('Bearer token');
    jwt.verifyAsync.mockResolvedValue(payload);

    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 401 });
    expect(request.user).toBeUndefined();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('returns 401 when the token user is missing, inactive, or deleted', async () => {
    const { guard, context, request, prisma } = setup('Bearer token');
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 401 });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: userId, status: 'active', deletedAt: null },
      select: { id: true, email: true },
    });
    expect(request.user).toBeUndefined();
  });

  it.each([{ authorization: 'Bearer token' }, { authorization: ['Bearer token'] }])('attaches an active viewer for $authorization', async ({ authorization }) => {
    const { guard, context, request, jwt, config, prisma } = setup(authorization);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(config.getOrThrow).toHaveBeenCalledWith('JWT_ACCESS_SECRET');
    expect(jwt.verifyAsync).toHaveBeenCalledWith('token', { secret: 'test-secret' });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: userId, status: 'active', deletedAt: null },
      select: { id: true, email: true },
    });
    expect(request.user).toEqual({ id: userId, email: 'user@example.test' });
  });

  it('preserves the token email fallback for an active user', async () => {
    const { guard, context, request, prisma } = setup('Bearer token');
    prisma.user.findFirst.mockResolvedValue({ id: userId, email: null });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: userId, email: 'token@example.test' });
  });

  it('propagates lookup failures without granting public access or reporting a bad token', async () => {
    const { guard, context, request, prisma } = setup('Bearer token');
    const error = new Error('user lookup unavailable');
    prisma.user.findFirst.mockRejectedValue(error);

    await expect(guard.canActivate(context)).rejects.toBe(error);
    expect(request.user).toBeUndefined();
  });
});
