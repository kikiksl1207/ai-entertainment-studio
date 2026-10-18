'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const ts = require(path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js'));
const file = path.join(ROOT, 'server/src/admin/admin.service.ts');
const source = fs.readFileSync(file, 'utf8');
const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
assert.equal(tree.parseDiagnostics.length, 0);
const classes = tree.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === 'AdminService');
assert.equal(classes.length, 1);
const methods = classes[0].members.filter(node => ts.isMethodDeclaration(node) && node.name.getText(tree) === 'updateArtistOperator');
assert.equal(methods.length, 1); assert(methods[0].body);
const compiled = ts.transpileModule('class ScopedAdmin {\n' + methods[0].getText(tree) +
  '\n}\nmodule.exports = ScopedAdmin;', { fileName: 'actual-artist-operator-update.ts', reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
assert.equal((compiled.diagnostics || []).length, 0);
const context = { module: { exports: {} }, BadRequestException: class extends Error {},
  NotFoundException: class extends Error {}, Prisma: { TransactionIsolationLevel: { ReadCommitted: 'ReadCommitted' } } };
vm.runInNewContext(compiled.outputText, context, { filename: 'actual-artist-operator-update.js', timeout: 1000,
  contextCodeGeneration: { strings: false, wasm: false } });
const ScopedAdmin = context.module.exports, plain = value => JSON.parse(JSON.stringify(value));

// Real method, synthetic database/lookup/serialization/presentation seams; no AuthGuard or SQL proof.
test('artist operator update and audit share one transaction and its current preimage', { timeout: 10000 }, async () => {
  for (const scenario of ['normal', 'audit-failure', 'stale-preflight']) {
    const service = new ScopedAdmin();
    const actor = Object.freeze({ id: '00000000-0000-4000-8000-000000000001' });
    const id = '00000000-0000-4000-8000-000000000002';
    const input = Object.freeze({ role: ' editor ', permissions: Object.freeze(['profile:update']), note: ' synthetic ' });
    const preflight = Object.freeze({ id, status: 'active', role: 'owner', permissions: Object.freeze([]), revokedAt: null });
    const current = scenario === 'stale-preflight'
      ? Object.freeze({ ...preflight, status: 'revoked', revokedAt: '2026-01-01T00:00:00.000Z' }) : preflight;
    const retained = Object.freeze({ retained: 'unrelated synthetic operator' });
    const retainedAudit = Object.freeze({ retained: 'unrelated synthetic audit' });
    const initialRows = [retained, current], rows = [...initialRows], audits = [retainedAudit];
    const include = Object.freeze({ user: true, artist: true });
    const fault = new Error('synthetic audit insert failure');
    const events = []; let active = false, staged, stagedAudit;
    const counts = { preflight: 0, transactions: 0, locks: 0, current: 0, updates: 0, audits: 0,
      rootWrites: 0, commits: 0, rollbacks: 0 };
    const tx = {
      async $queryRaw(strings, ...values) {
        assert(active); assert.equal(++counts.locks, 1); events.push('lock');
        assert.deepEqual(values, [id]);
        assert.equal(strings.join('?').replace(/\s+/g, ' ').trim(),
          'SELECT id FROM artist_operators WHERE id = ?::uuid FOR UPDATE');
        return [{ id }];
      },
      artistOperator: {
        async findUniqueOrThrow(request) {
          assert(active); assert.equal(counts.locks, 1); assert.equal(++counts.current, 1); events.push('current');
          assert.deepEqual(plain(request), { where: { id }, include: plain(include) }); return current;
        },
        async update(request) {
          assert(active); assert.equal(counts.current, 1); assert.equal(++counts.updates, 1); events.push('update');
          assert.equal(request.include, include); assert.deepEqual(plain(request.where), { id });
          assert.deepEqual(Object.keys(request.data).sort(), ['permissions', 'role', 'updatedAt']);
          assert.equal(request.data.role, 'editor'); assert.deepEqual(plain(request.data.permissions), ['profile:update']);
          assert(Number.isFinite(Date.parse(request.data.updatedAt.toISOString())));
          staged = Object.freeze({ ...current, ...request.data }); return staged;
        },
      },
      auditEvent: { async create(request) {
        assert(active); assert.equal(counts.updates, 1); assert.equal(++counts.audits, 1); events.push('audit');
        assert.equal(request.data.beforeData, current); assert.equal(request.data.afterData, staged);
        assert.deepEqual(plain(request.data), { actorUserId: actor.id, actorType: 'admin',
          action: 'artist_operator.update', targetType: 'artist_operator', targetId: id,
          beforeData: plain(current), afterData: plain(staged), metadata: { note: 'synthetic' } });
        if (scenario === 'audit-failure') throw fault;
        stagedAudit = request.data; return stagedAudit;
      } },
    };
    const forbidden = () => { counts.rootWrites++; assert.fail('Cannot save creator access outside the audit transaction'); };
    service.prisma = {
      artistOperator: { async findUnique(request) {
        assert(!active); assert.equal(++counts.preflight, 1); events.push('preflight');
        assert.deepEqual(plain(request), { where: { id }, include: plain(include) }); return preflight;
      }, update: forbidden }, auditEvent: { create: forbidden },
      async $transaction(work, options) {
        assert(!active); assert.equal(counts.preflight, 1); assert.equal(++counts.transactions, 1);
        assert.deepEqual(plain(options), { isolationLevel: 'ReadCommitted' });
        active = true; events.push('begin');
        try {
          const result = await work(tx); assert.equal(result, staged); assert(stagedAudit);
          rows[1] = staged; audits.push(stagedAudit); counts.commits++; events.push('commit'); return result;
        } catch (error) { counts.rollbacks++; events.push('rollback'); throw error; }
        finally { active = false; }
      },
    };
    service.artistOperatorInclude = () => include;
    service.optionalString = (body, key) => { assert.equal(body, input); assert(['role', 'note'].includes(key)); return body[key].trim(); };
    service.optionalStringArray = (body, key) => { assert.equal(body, input); assert.equal(key, 'permissions'); return body[key]; };
    service.artistOperatorStatus = () => assert.fail('Omitted status must not become an implicit status change');
    service.clean = value => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
    service.recordAudit = (user, action, targetType, targetId, beforeData, afterData, metadata, client) => {
      assert.equal(user, actor); assert.equal(client, tx); assert(active);
      return client.auditEvent.create({ data: { actorUserId: user.id, actorType: 'admin', action, targetType,
        targetId, beforeData, afterData, metadata } });
    };
    if (scenario === 'audit-failure') {
      await assert.rejects(service.updateArtistOperator(actor, id, input), error => error === fault);
      assert.deepEqual(rows, initialRows); assert.deepEqual(audits, [retainedAudit]);
      assert.deepEqual(events, ['preflight', 'begin', 'lock', 'current', 'update', 'audit', 'rollback']);
      assert.equal(counts.commits, 0); assert.equal(counts.rollbacks, 1);
    } else {
      const result = await service.updateArtistOperator(actor, id, input);
      assert.equal(result, staged); assert.deepEqual(plain(result), plain(staged));
      assert.equal(rows[1], staged); assert.equal(audits[1], stagedAudit);
      assert.equal(staged.status, current.status); assert.equal(staged.revokedAt, current.revokedAt);
      assert.deepEqual(events, ['preflight', 'begin', 'lock', 'current', 'update', 'audit', 'commit']);
      assert.equal(counts.commits, 1); assert.equal(counts.rollbacks, 0);
    }
    assert.equal(rows[0], retained); assert.equal(audits[0], retainedAudit); assert.equal(counts.rootWrites, 0);
    for (const key of ['preflight', 'transactions', 'locks', 'current', 'updates', 'audits']) assert.equal(counts[key], 1);
    assert.equal(active, false); assert.deepEqual(input, { role: ' editor ', permissions: ['profile:update'], note: ' synthetic ' });
  }
});
