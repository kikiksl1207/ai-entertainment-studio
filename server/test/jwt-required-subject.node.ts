import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';

// Full guard with synthetic verifier/lookup boundaries; no token issuance or database access.
const id = '00000000-0000-4000-8000-000000000101';
const opts = { concurrency: false, timeout: 2000 };
function fixture(payload: unknown = { tokenType: 'access', sub: id }, authorization: string | string[] | undefined = 'Bearer synthetic') {
  const request: { headers: Record<string, string | string[] | undefined>; user?: unknown } = { headers: { authorization } };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
  const calls: { verify: unknown[][]; lookup: unknown[]; config: string[] } = { verify: [], lookup: [], config: [] };
  let verifierError: Error | undefined, lookupError: Error | undefined;
  let user: { id: string; email: string | null } | null = { id, email: null };
  const jwt = { verifyAsync: async (...args: unknown[]) => { calls.verify.push(args); if (verifierError) throw verifierError; return payload; } };
  const config = { getOrThrow: (key: string) => { calls.config.push(key); return 'synthetic-qa-only'; } };
  const prisma = { user: { findFirst: async (query: unknown) => { calls.lookup.push(query); if (lookupError) throw lookupError; return user; } } };
  const guard = new JwtAuthGuard(jwt as never, config as never, prisma as never);
  return { request, context, calls, guard, failVerifier: (e: Error) => { verifierError = e; },
    failLookup: (e: Error) => { lookupError = e; }, setUser: (value: typeof user) => { user = value; } };
}
async function denied(f: ReturnType<typeof fixture>, lookups = 0) {
  await assert.rejects(f.guard.canActivate(f.context), (error: unknown) => error instanceof UnauthorizedException && error.getStatus() === 401);
  assert.equal(f.calls.lookup.length, lookups); assert.equal(f.request.user, undefined);
}
test('01 absent and malformed bearer headers cannot query a user', opts, async () => {
  for (const header of [undefined, '', 'Bearer', 'Bearer ', 'Basic synthetic', []]) {
    const f = fixture({ tokenType: 'access', sub: id }, header);
    // Undefined must not invoke the fixture default argument.
    f.request.headers.authorization = header;
    await denied(f); assert.equal(f.calls.verify.length, 0); assert.equal(f.calls.config.length, 0);
  }
});
test('02 null or undefined verified claims cannot query a user', opts, async () => {
  for (const payload of [null, undefined]) { const f = fixture(null); const jwt = { verifyAsync: async () => payload };
    const guard = new JwtAuthGuard(jwt as never, { getOrThrow: () => 'synthetic-qa-only' } as never,
      { user: { findFirst: async () => { f.calls.lookup.push('unexpected'); return { id }; } } } as never);
    f.guard = guard; await denied(f);
  }
});
test('03 a missing subject cannot become an unfiltered lookup', opts, async () => { await denied(fixture({ tokenType: 'access' })); });
test('04 null and empty subjects fail before lookup', opts, async () => {
  for (const sub of [null, '', '   ', '\t\n']) await denied(fixture({ tokenType: 'access', sub }));
});
test('05 non-string subjects fail before lookup', opts, async () => {
  for (const sub of [0, 123, false, {}, [], [id]]) await denied(fixture({ tokenType: 'access', sub }));
});
test('06 refresh and absent token types remain unauthorized', opts, async () => {
  for (const tokenType of ['refresh', '', null, undefined]) await denied(fixture({ tokenType, sub: id }));
});
test('07 verifier failure does not query or attach a user', opts, async () => {
  const f = fixture(); f.failVerifier(new Error('synthetic verifier failure')); await denied(f); assert.equal(f.calls.verify.length, 1);
});
test('08 an inactive missing or deleted lookup remains unauthorized', opts, async () => {
  const f = fixture(); f.setUser(null); await denied(f, 1);
  assert.deepEqual(f.calls.lookup, [{ where: { id, status: 'active', deletedAt: null }, select: { id: true, email: true } }]);
});
test('09 lookup failure never attaches an identity', opts, async () => {
  const f = fixture(); f.failLookup(new Error('synthetic lookup failure')); await denied(f, 1);
});
test('10 normal access preserves the exact subject and active filter', opts, async () => {
  const f = fixture(); assert.equal(await f.guard.canActivate(f.context), true);
  assert.deepEqual(f.calls.verify, [['synthetic', { secret: 'synthetic-qa-only' }]]);
  assert.deepEqual(f.calls.config, ['JWT_ACCESS_SECRET']);
  assert.deepEqual(f.calls.lookup, [{ where: { id, status: 'active', deletedAt: null }, select: { id: true, email: true } }]);
  assert.deepEqual(f.request.user, { id, email: undefined });
});
test('11 the first array header and existing email fallback are unchanged', opts, async () => {
  const f = fixture({ tokenType: 'access', sub: id, email: 'synthetic@example.test' }, ['Bearer synthetic', 'Basic ignored']);
  assert.equal(await f.guard.canActivate(f.context), true);
  assert.deepEqual(f.request.user, { id, email: 'synthetic@example.test' }); assert.equal(f.calls.lookup.length, 1);
});
test('12 surrounding spaces never normalize a subject into another identity', opts, async () => {
  const sub = ' ' + id + ' '; const f = fixture({ tokenType: 'access', sub }); f.setUser(null);
  await denied(f, 1); assert.deepEqual(f.calls.lookup, [{ where: { id: sub, status: 'active', deletedAt: null }, select: { id: true, email: true } }]);
});
