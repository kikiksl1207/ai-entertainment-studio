import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { actorA, actorB, adminContextA, adminListA, harness, sourceHash, excerpts } from
  './fixtures/backstage-admin-context-gap-harness-20261005.mjs';

const evidence = [];
const record = (condition, h, operation) => evidence.push({ condition, error: operation.error, ...h.snapshot() });
after(() => {
  if (process.env.BACKSTAGE_CONTEXT_GAP_EVIDENCE) writeFileSync(process.env.BACKSTAGE_CONTEXT_GAP_EVIDENCE,
    JSON.stringify({ sourceHash, excerpts: excerpts.map(({ body, ...metadata }) => metadata), evidence }, null, 2) + '\n');
});

test('CONTEXT-GAP-01 normal same-A verify keeps initiating actor and applies current context', async () => {
  const h = harness(); const operation = h.startVerify(); const release = await h.pendingJson();
  release(adminContextA); await h.drain(operation); record('normal-verify', h, operation);
  assert.equal(operation.error, null);
  assert.equal(h.api.auth().user.id, actorA);
  assert.equal(h.api.auth().user.adminUser.id, 'synthetic-admin-a');
  assert.deepEqual(h.calls.map(call => call.actor), [actorA, actorA]);
  assert.equal(h.api.canAccess('admins'), true);
});

test('CONTEXT-GAP-02 same-A refresh and native verify remain normal', async () => {
  const h = harness({ expired: true }); const operation = h.startVerify(); const release = await h.pendingJson();
  release(adminContextA); await h.drain(operation); record('normal-refresh-verify', h, operation);
  assert.equal(operation.error, null);
  assert.equal(h.api.auth().accessToken, 'ram-a-refreshed');
  assert.equal(h.api.auth().user.id, actorA);
  assert.deepEqual(h.calls.map(call => call.path), ['/admin/api/v1/me', '/api/v1/auth/refresh',
    '/admin/api/v1/me', '/admin/api/v1/audit-events?take=1']);
  assert.ok(h.calls.every(call => call.actor === actorA));
});

test('CONTEXT-GAP-03 auth B after final fetch check must not receive A context or follow-up', async () => {
  const h = harness(); const operation = h.startVerify(); const release = await h.pendingJson();
  h.releaseAndSchedule(release, adminContextA); await h.drain(operation);
  record('verify-return-gap', h, operation);
  assert.equal(h.calls[0].actor, actorA, 'The original protected /me request is A-owned');
  const switchIndex = h.trace.findIndex(event => event.event === 'auth-switch-complete');
  const releaseIndex = h.trace.findIndex(event => event.event === 'json-release');
  assert.ok(switchIndex > releaseIndex);
  if (excerpts.find(item => item.name === 'fetch').body.includes('checkCurrent();')) {
    assert.ok(h.trace.slice(releaseIndex, switchIndex).some(event =>
      event.site === 'backstageFetch.checkCurrent' && event.actor === actorA),
    'The real final JSON owner check must run as A before the independent B microtask');
  }
  // Stronger control: two actual backstageFetch calls and the unmodified login handler.
  // Both body promises finish in one task, B first. No scheduled auth mutation is inserted.
  const loginHarness = harness({ visible: false });
  const oldVerify = loginHarness.startVerify();
  const releaseOld = await loginHarness.pendingJson();
  const login = loginHarness.startLogin();
  const releaseLogin = await loginHarness.pendingJson('/api/v1/auth/login', actorB);
  releaseLogin(loginHarness.authFor(actorB));
  releaseOld(adminContextA);
  await loginHarness.drain(oldVerify);
  const loginSnapshot = loginHarness.snapshot();
  evidence.push({ condition: 'actual-login-handler-return-gap', error: oldVerify.error, ...loginSnapshot });
  const oldJsonIndex = loginSnapshot.trace.findIndex(event =>
    event.event === 'json-release' && event.path === '/admin/api/v1/me');
  const storeBIndex = loginSnapshot.trace.findIndex(event => event.event === 'auth-write' && event.actor === actorB);
  if (excerpts.find(item => item.name === 'fetch').body.includes('checkCurrent();')) {
    assert.ok(loginSnapshot.trace.slice(oldJsonIndex + 1, storeBIndex).some(event =>
      event.site === 'backstageFetch.checkCurrent' && event.actor === actorA),
    'Actual login reproduction must store B only after the real final A fetch owner check');
  }
  const applyBIndex = loginSnapshot.trace.findIndex(event =>
    event.event === 'auth-read' && event.site === 'applyAdminContext' && event.actor === actorB);
  // A repaired verifier is expected to omit this read entirely.
  if (applyBIndex !== -1) assert.ok(applyBIndex > storeBIndex);
  const audit = loginHarness.calls.find(call => call.path === '/admin/api/v1/audit-events?take=1');
  if (audit) assert.deepEqual({ actor: audit.actor, status: audit.status }, { actor: actorB, status: 403 },
    'Stale UI context does not alter the synthetic backend credential actor or its denial');
  assert.equal(login.settled, false, 'B own verification is still in flight during A context consumption');
  const pendingB = loginHarness.calls.find(call => call.path === '/admin/api/v1/me' && call.actor === actorB);
  assert.ok(pendingB && !pendingB.responded);
  pendingB.respond({ message: 'Synthetic nonadmin denied' }, 403);
  await loginHarness.drain(login);
  assert.equal(loginHarness.api.auth(), null, 'Actual login failure cleanup settles all RAM work');
  evidence.push({ condition: 'actual-login-handler-cleanup', error: login.error, ...loginHarness.snapshot() });
  assert.deepEqual({ actor: loginSnapshot.auth.user.id, token: loginSnapshot.auth.accessToken,
    canAccessAdmins: loginSnapshot.canAccessAdmins, oldVerifyError: oldVerify.error },
  { actor: actorB, token: 'ram-access-b', canAccessAdmins: false,
    oldVerifyError: { status: 409, code: 'BACKSTAGE_SESSION_CHANGED' } },
  'Actual login B must not receive obsolete A identity/permissions from the other verifier');
  assert.deepEqual({ actor: h.api.auth().user.id, token: h.api.auth().accessToken,
    canAccessAdmins: h.api.canAccess('admins'), adminUser: h.api.auth().user.adminUser || null,
    calls: h.calls.map(({ path, actor }) => ({ path, actor })) },
  { actor: actorB, token: 'ram-access-b', canAccessAdmins: false, adminUser: null,
    calls: [{ path: '/admin/api/v1/me', actor: actorA }] },
  'An obsolete A verification must preserve B storage and stop its request sequence');
});

test('CONTEXT-GAP-04 admin-list consumer rejects the identical return-gap switch; normal list still applies', async () => {
  const normal = harness({ holdPath: '/admin/api/v1/admin-users' });
  const normalOperation = normal.startAdmins(); const normalRelease = await normal.pendingJson();
  normalRelease(adminListA); await normal.drain(normalOperation); record('normal-admin-list', normal, normalOperation);
  assert.equal(normalOperation.error, null);
  assert.equal(normal.api.auth().user.adminUser.id, 'synthetic-admin-a');
  assert.equal(normal.api.state().rows.length, 1);
  const h = harness({ holdPath: '/admin/api/v1/admin-users' });
  const operation = h.startAdmins(); const release = await h.pendingJson();
  h.releaseAndSchedule(release, adminListA); await h.drain(operation); record('admin-list-return-gap', h, operation);
  assert.equal(operation.error, null);
  assert.equal(h.api.auth().user.id, actorB);
  assert.equal(h.api.auth().user.adminUser, undefined);
  assert.equal(h.api.canAccess('admins'), false);
  assert.equal(h.api.state().rows.length, 0);
  assert.equal(h.api.state().auditRows.length, 0);
  assert.ok(h.calls.every(call => call.actor === actorA));
  const switchIndex = h.trace.findIndex(event => event.event === 'auth-switch-complete');
  assert.ok(h.trace.slice(switchIndex).every(event => event.site !== 'syncCurrentAdminContext'));
});

test('CONTEXT-GAP-05 same-owner access rotation in that microtask must remain accepted', async () => {
  const h = harness(); const operation = h.startVerify(); const release = await h.pendingJson();
  h.releaseAndSchedule(release, adminContextA, actorA, 'ram-a-rotated'); await h.drain(operation);
  record('same-owner-return-gap-rotation', h, operation);
  assert.equal(operation.error, null);
  assert.equal(h.api.auth().accessToken, 'ram-a-rotated');
  assert.equal(h.api.auth().user.id, actorA);
  assert.equal(h.api.auth().user.adminUser.id, 'synthetic-admin-a');
  assert.ok(h.calls.every(call => call.actor === actorA));
});
