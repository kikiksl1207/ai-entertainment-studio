// AUTHOR UNRUN. Actual AdminAuthGuard; JWT/current-user admission and storage
// are synthetic dependencies. No token verification, DB, HTTP or real grant.
import { strict as assert } from 'node:assert';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../auth.types';
import type { JwtAuthGuard } from './jwt-auth.guard';
import { AdminAuthGuard } from './admin-auth.guard';

const USER: AuthUser = Object.freeze({
  id: '00000000-0000-4000-8000-000000000941',
  email: 'synthetic-bootstrap@example.invalid',
});
const ADMIN_ID = '00000000-0000-4000-8000-000000000942';
const MATCHING_ALLOWLIST = ' ,  SYNTHETIC-BOOTSTRAP@example.invalid , ';
type StoredAdmin = {
  id: string; userId: string; status: string;
  role: { name: string; permissions: string[] };
};
type Options = {
  stored?: StoredAdmin | null;
  jwtUser?: AuthUser | null;
  allowlist?: string;
  jwtError?: unknown; lookupError?: unknown; updateError?: unknown; configError?: unknown;
};
type Outcome = { allowed: boolean; error: unknown };
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return Array.from(value, item => clone(item)) as unknown as T;
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}
function admin(status: string, permissions = ['*']): StoredAdmin {
  return { id: ADMIN_ID, userId: USER.id, status, role: { name: 'synthetic_assigned', permissions: [...permissions] } };
}
function fixture(options: Options = {}) {
  const stored = clone(options.stored === undefined ? null : options.stored);
  const storedBefore = clone(stored);
  const principal = options.jwtUser === undefined ? clone(USER) : clone(options.jwtUser);
  const request: { user?: AuthUser } = {};
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  let afterJwt: AuthUser | undefined;
  const attempts = { jwt: 0, lookup: 0, update: 0, config: 0 };
  const faults: string[] = [], updateArguments: unknown[] = [], events: string[] = [];
  function admit<T>(kind: keyof typeof attempts, validate: () => T): T {
    attempts[kind]++;
    try { return validate(); } catch (error: unknown) {
      faults.push(kind + ': ' + (error instanceof Error ? error.message : 'unknown admission fault'));
      throw error;
    }
  }
  const jwt = {
    async canActivate(received: ExecutionContext) {
      admit('jwt', () => {
        assert.equal(attempts.jwt, 1); assert.strictEqual(received, context);
        assert.equal(request.user, undefined, 'Fresh synthetic request, not cached authority');
      });
      events.push('jwt');
      if (options.jwtError !== undefined) throw options.jwtError;
      // This supplies the already-admitted current User, not a JWT algorithm.
      request.user = principal ? clone(principal) : undefined;
      afterJwt = clone(request.user);
      return true;
    },
  };
  const prisma = {
    adminUser: {
      async findUnique(args: unknown) {
        admit('lookup', () => {
          assert.equal(attempts.jwt, 1); assert.equal(attempts.lookup, 1);
          assert(principal && request.user?.id === principal.id);
          assert.deepStrictEqual(clone(args), { where: { userId: principal.id }, include: { role: true } });
        });
        events.push('lookup');
        if (options.lookupError !== undefined) throw options.lookupError;
        return stored;
      },
      async update(args: unknown) {
        admit('update', () => {
          assert.equal(attempts.lookup, 1); assert.equal(attempts.update, 1);
          assert(stored); assert(record(args)); assert(record(args.data));
          assert.deepStrictEqual(Object.keys(args).sort(), ['data', 'where']);
          assert.deepStrictEqual(clone(args.where), { id: stored.id });
          assert.deepStrictEqual(Object.keys(args.data), ['lastAccessAt']);
          assert(args.data.lastAccessAt instanceof Date && Number.isFinite(args.data.lastAccessAt.getTime()));
        });
        updateArguments.push(clone(args)); events.push('update');
        if (options.updateError !== undefined) throw options.updateError;
        return clone(stored);
      },
    },
  };
  const config = {
    get(key: unknown) {
      admit('config', () => {
        assert.equal(attempts.lookup, 1); assert.equal(attempts.config, 1);
        assert.equal(key, 'ADMIN_EMAILS', 'Only the synthetic bootstrap list is admitted');
      });
      events.push('config');
      if (options.configError !== undefined) throw options.configError;
      return options.allowlist ?? MATCHING_ALLOWLIST;
    },
  };
  const guard = new AdminAuthGuard(
    jwt as unknown as JwtAuthGuard,
    config as unknown as ConfigService,
    prisma as unknown as PrismaService,
  );
  return {
    attempts, events, updateArguments,
    user: () => clone(request.user), principal: () => clone(afterJwt),
    async invoke(): Promise<Outcome> {
      try { return { allowed: await guard.canActivate(context), error: null }; }
      catch (error: unknown) { return { allowed: false, error }; }
    },
    check() {
      assert.deepStrictEqual(faults, [], 'Fixture admission faults cannot be swallowed by product');
      assert.deepStrictEqual(stored, storedBefore, 'Stored status/role/grants must not be mutated in memory');
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
function forbidden(result: Outcome) {
  assert.equal(result.allowed, false);
  assert(result.error instanceof ForbiddenException);
  assert.equal(result.error.getStatus(), 403);
  assert.equal(result.error.message, 'Admin access is required');
}
function unchangedAuthority(f: Fixture) {
  assert.deepStrictEqual(f.user(), f.principal());
  assert.equal(f.user()?.adminRole, undefined); assert.equal(f.user()?.adminPermissions, undefined);
}

describe('AdminAuthGuard disabled stored admin precedence (synthetic dependencies)', () => {
  it('01 explicit suspension or revocation cannot be replaced by bootstrap wildcard authority', async () => {
    for (const status of ['suspended', 'revoked']) {
      const f = fixture({ stored: admin(status) });
      try {
        const result = await f.invoke(); f.check();
        // Old 0CFA reaches this assertion with allowed=true, not an import error.
        assert.equal(result.allowed, false, 'ADMIN_DISABLED_BOOTSTRAP_GRANTED');
        forbidden(result); unchangedAuthority(f);
        assert.deepStrictEqual(f.attempts, { jwt: 1, lookup: 1, update: 0, config: 0 });
        assert.deepStrictEqual(f.events, ['jwt', 'lookup']);
        assert.deepStrictEqual(f.updateArguments, []);
      } finally { f.check(); }
    }
  });

  it('02 active assignments and absent-row bootstrap retain their existing authority boundaries', async () => {
    for (const permissions of [['artists:read'], []]) {
      const row = admin('active', permissions), f = fixture({ stored: row });
      try {
        const result = await f.invoke(); f.check();
        assert.equal(result.error, null); assert.equal(result.allowed, true);
        assert.deepStrictEqual(f.user(), { ...USER, adminRole: row.role.name, adminPermissions: permissions });
        assert.deepStrictEqual(f.attempts, { jwt: 1, lookup: 1, update: 1, config: 0 });
        assert.deepStrictEqual(f.events, ['jwt', 'lookup', 'update']);
        assert.equal(f.updateArguments.length, 1);
      } finally { f.check(); }
    }
    const bootstrap = fixture();
    try {
      const result = await bootstrap.invoke(); bootstrap.check();
      assert.equal(result.error, null); assert.equal(result.allowed, true);
      assert.deepStrictEqual(bootstrap.user(), { ...USER, adminRole: 'super_admin', adminPermissions: ['*'] });
      assert.deepStrictEqual(bootstrap.attempts, { jwt: 1, lookup: 1, update: 0, config: 1 });
      assert.deepStrictEqual(bootstrap.events, ['jwt', 'lookup', 'config']);
      assert.deepStrictEqual(bootstrap.updateArguments, []);
    } finally { bootstrap.check(); }
    for (const stored of [null, admin('suspended'), admin('revoked')]) {
      const f = fixture({ stored, allowlist: 'different-synthetic@example.invalid' });
      try {
        const result = await f.invoke(); f.check(); forbidden(result); unchangedAuthority(f);
        assert.deepStrictEqual(f.attempts, { jwt: 1, lookup: 1, update: 0, config: stored ? 0 : 1 });
        assert.deepStrictEqual(f.updateArguments, []);
      } finally { f.check(); }
    }
  });

  it('03 JWT principal and storage failures never fall through to bootstrap or partial request authority', async () => {
    const noPrincipal = fixture({ jwtUser: null });
    try {
      const result = await noPrincipal.invoke(); noPrincipal.check(); forbidden(result); unchangedAuthority(noPrincipal);
      assert.deepStrictEqual(noPrincipal.attempts, { jwt: 1, lookup: 0, update: 0, config: 0 });
    } finally { noPrincipal.check(); }
    const failures: Array<{ options: Options; error: Error; expected: Fixture['attempts'] }> = [
      { options: {}, error: new UnauthorizedException('Synthetic JWT refusal'), expected: { jwt: 1, lookup: 0, update: 0, config: 0 } },
      { options: {}, error: new Error('Synthetic admin lookup failure'), expected: { jwt: 1, lookup: 1, update: 0, config: 0 } },
      { options: { stored: admin('active', ['artists:read']) }, error: new Error('Synthetic last-access update failure'), expected: { jwt: 1, lookup: 1, update: 1, config: 0 } },
      { options: {}, error: new Error('Synthetic bootstrap-list lookup failure'), expected: { jwt: 1, lookup: 1, update: 0, config: 1 } },
    ];
    const stages: Array<keyof Pick<Options, 'jwtError' | 'lookupError' | 'updateError' | 'configError'>> =
      ['jwtError', 'lookupError', 'updateError', 'configError'];
    for (let index = 0; index < failures.length; index++) {
      const { options, error, expected } = failures[index];
      const f = fixture({ ...options, [stages[index]]: error });
      try {
        const result = await f.invoke(); f.check();
        assert.strictEqual(result.error, error, 'Dependency failure identity must be preserved');
        assert.equal(result.allowed, false); unchangedAuthority(f); assert.deepStrictEqual(f.attempts, expected);
      } finally { f.check(); }
    }
  });
});

// No real token/account/configuration, role grant, grant normalization policy,
// email-verification policy, controller/service invocation, SQL/FK/transaction,
// mid-request revocation or operating privilege escalation is established here.
