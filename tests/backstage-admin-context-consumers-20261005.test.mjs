import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { actorA, actorB, consumerExcerpts, consumerHarness, sourceHash, tick } from './fixtures/backstage-admin-context-consumer-harness-20261005.mjs';

const evidence = [];
const me = '/admin/api/v1/me';
const audit = '/admin/api/v1/audit-events?take=1';
after(() => {
  if (process.env.BACKSTAGE_CONSUMER_EVIDENCE) writeFileSync(process.env.BACKSTAGE_CONSUMER_EVIDENCE,
    JSON.stringify({ sourceHash, consumerExcerpts: consumerExcerpts.map(({ body, ...metadata }) => metadata),
      evidence }, null, 2) + '\n', { flag: 'wx' });
});
async function startA(h, kind) {
  const operation = h.start(kind);
  if (kind !== 'bootstrap' && kind !== 'verify') {
    const path = kind === 'google' ? '/api/v1/auth/social/login' : '/api/v1/auth/login';
    (await h.request(path, actorA)).respond(h.authFor(actorA));
  }
  return { operation, request: await h.request(me, actorA) };
}
async function finishB(h) {
  const operation = h.start('login', actorB);
  (await h.request('/api/v1/auth/login', actorB)).respond(h.authFor(actorB));
  (await h.request(me, actorB)).respond(h.meFor(actorB));
  (await h.request(audit, actorB)).respond({ items: [] });
  await h.drain(operation);
  const snapshot = h.snapshot();
  assert.equal(operation.error, null);
  assert.equal(snapshot.auth.user.id, actorB);
  assert.equal(snapshot.auth.user.adminUser.id, 'synthetic-admin-b');
  assert.equal(snapshot.canAccessAdmins, false);
  assert.ok(snapshot.events.some(event => event.event === 'dashboard-consumer' && event.actor === actorB));
  return snapshot;
}

test('CONSUMER-01 obsolete verification failure must not clear a completed newer login', async () => {
  const results = [];
  for (const kind of ['login', 'google', 'bootstrap']) {
    const h = consumerHarness(); const old = await startA(h, kind);
    const before = await finishB(h); const marker = h.events.length;
    old.request.respond({ message: 'Synthetic obsolete denied A response' }, 403);
    await h.drain(old.operation);
    const after = h.snapshot();
    const subsequent = after.events.slice(marker);
    evidence.push({ condition: 'obsolete-error-cleanup', kind, before, after, subsequent });
    assert.ok(after.calls.filter(call => call.path.startsWith('/admin/')).every(call =>
      call.actor === actorA || call.actor === actorB));
    results.push({ kind, preservedB: JSON.stringify(after.auth) === JSON.stringify(before.auth),
      cleared: subsequent.some(event => event.event === 'auth-cleared'),
      staleSurface: subsequent.some(event => ['status', 'show-login-boundary', 'dashboard-consumer'].includes(event.event)) });
  }
  assert.deepEqual(results, ['login', 'google', 'bootstrap'].map(kind =>
    ({ kind, preservedB: true, cleared: false, staleSurface: false })),
  'An obsolete login/bootstrap error must neither delete B nor overwrite B status/surface');
});

test('CONSUMER-02 switched-owner audit failure must not become obsolete dashboard success', async () => {
  const results = [];
  for (const kind of ['login', 'google', 'bootstrap']) {
    const h = consumerHarness(); const old = await startA(h, kind);
    old.request.respond(h.meFor(actorA));
    const oldAudit = await h.request(audit, actorA);
    const before = await finishB(h); const marker = h.events.length;
    oldAudit.respond({ items: [] });
    await h.drain(old.operation);
    const after = h.snapshot(); const subsequent = after.events.slice(marker);
    evidence.push({ condition: 'obsolete-audit-consumer', kind, before, after, subsequent });
    results.push({ kind, preservedB: JSON.stringify(after.auth) === JSON.stringify(before.auth),
      obsoleteDashboard: subsequent.some(event => event.event === 'dashboard-consumer'),
      staleSurface: subsequent.some(event => ['status', 'show-login-boundary'].includes(event.event)) });
  }
  assert.deepEqual(results, ['login', 'google', 'bootstrap'].map(kind =>
    ({ kind, preservedB: true, obsoleteDashboard: false, staleSurface: false })),
  'Session-change from the audit request must not let an obsolete caller publish success or clear B');
});

test('CONSUMER-03 A-owned me returning user B must be rejected before context or follow-up', async () => {
  const results = [];
  for (const kind of ['verify', 'login', 'google', 'bootstrap']) {
    const h = consumerHarness(); const old = await startA(h, kind);
    const before = h.snapshot(); const marker = h.events.length;
    old.request.respond(h.meFor(actorB));
    await tick();
    // On a vulnerable baseline, settle any improper audit request rather than leaving RAM work pending.
    for (const call of h.calls) if (call.path === audit && !call.responded) call.respond({ items: [] });
    await h.drain(old.operation);
    const after = h.snapshot(); const subsequent = after.events.slice(marker);
    evidence.push({ condition: 'returned-wrong-actor', kind, before, after, subsequent, error: old.operation.error });
    assert.ok(after.calls.filter(call => call.path.startsWith('/admin/')).every(call => call.actor === actorA),
      'Returned identity must never change the protected endpoint credential actor');
    results.push({ kind, directStatus: old.operation.error?.status || null,
      identityUnmutated: !subsequent.some(event => event.event === 'auth-write'),
      authDispositionCorrect: kind === 'verify' ? JSON.stringify(after.auth) === JSON.stringify(before.auth) : after.auth === null,
      auditCalls: after.calls.filter(call => call.path === audit).length,
      dashboard: subsequent.some(event => event.event === 'dashboard-consumer') });
  }
  assert.deepEqual(results, ['verify', 'login', 'google', 'bootstrap'].map(kind =>
    ({ kind, directStatus: kind === 'verify' ? 403 : null, identityUnmutated: true,
      authDispositionCorrect: true, auditCalls: 0, dashboard: false })),
  'Wrong returned actor must not be applied; own-session login failures must still clean up normally');
});
