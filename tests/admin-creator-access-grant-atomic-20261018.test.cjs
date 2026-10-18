'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const ts = require(path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js'));
const file = path.join(ROOT, 'server/src/admin/admin.service.ts');
const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
assert.equal(tree.parseDiagnostics.length, 0);
const classes = tree.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === 'AdminService');
assert.equal(classes.length, 1);
const methods = classes[0].members.filter(node => ts.isMethodDeclaration(node) && node.name.getText(tree) === 'grantBackstageCreatorAccess');
assert.equal(methods.length, 1); assert(methods[0].body);
const compiled = ts.transpileModule('class ScopedAdmin {\n' + methods[0].getText(tree) + '\n}\nmodule.exports = ScopedAdmin;', {
  fileName: 'actual-creator-access-grant.ts', reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
assert.equal((compiled.diagnostics || []).length, 0);
const context = { module: { exports: {} } };
vm.runInNewContext(compiled.outputText, context, { filename: 'actual-creator-access-grant.js', timeout: 1000,
  contextCodeGeneration: { strings: false, wasm: false } });
const ScopedAdmin = context.module.exports, plain = value => JSON.parse(JSON.stringify(value));

// Genuine method; synthetic validation, database, audit and projection seams. No SQL/AuthGuard proof.
test('creator access grant and restore roll back together with the audit', { timeout: 10000 }, async () => {
  for (const existing of [false, true]) for (const failAudit of [false, true]) {
    const service = new ScopedAdmin(), events = [];
    const actor = Object.freeze({ id: '00000000-0000-4000-8000-000000000001' });
    const target = Object.freeze({ id: '00000000-0000-4000-8000-000000000002' });
    const artist = Object.freeze({ id: '00000000-0000-4000-8000-000000000003', slug: 'synthetic-only' });
    const id = '00000000-0000-4000-8000-000000000004';
    const before = existing ? Object.freeze({ id, userId: target.id, artistId: artist.id, role: 'editor', status: 'revoked',
      permissions: Object.freeze(['profile:update']), revokedAt: '2026-01-01T00:00:00.000Z' }) : null;
    const retained = Object.freeze({ retained: true }), retainedAudit = Object.freeze({ retainedAudit: true });
    const rows = [retained, ...(before ? [before] : [])], audits = [retainedAudit];
    const original = [...rows], input = Object.freeze({ note: ' synthetic ' }), include = Object.freeze({ user: true, artist: true });
    const permissions = ['feed:post', 'feed:reply', 'image:request', 'profile:update', 'settlement:read'];
    const policy = Object.freeze({ syntheticPolicy: true }), fault = new Error('synthetic audit failure');
    let active = false, staged, stagedAudit, commits = 0, rollbacks = 0, projections = 0;
    const tx = { artistOperator: { async upsert(request) {
      assert(active); events.push('upsert'); assert.equal(request.include, include);
      assert.deepEqual(plain(request.where), { userId_artistId: { userId: target.id, artistId: artist.id } });
      assert.deepEqual(plain(request.create), { userId: target.id, artistId: artist.id, role: 'owner', status: 'active', permissions, revokedAt: null });
      assert.deepEqual(Object.keys(request.update).sort(), ['permissions', 'revokedAt', 'role', 'status', 'updatedAt']);
      assert.equal(request.update.role, 'owner'); assert.equal(request.update.status, 'active');
      assert.deepEqual(plain(request.update.permissions), permissions); assert.equal(request.update.revokedAt, null);
      assert(Number.isFinite(Date.parse(request.update.updatedAt.toISOString())));
      staged = Object.freeze({ id, ...(before || request.create), ...(before ? request.update : {}) }); return staged;
    } }, auditEvent: { async create(request) {
      assert(active); events.push('audit'); assert.equal(request.before, before); assert.equal(request.after, staged);
      if (failAudit) throw fault; stagedAudit = request; return request;
    } } };
    service.prisma = { artistOperator: { async findUnique(request) {
      assert(!active); events.push('before'); assert.equal(request.include, include);
      assert.deepEqual(plain(request.where), { userId_artistId: { userId: target.id, artistId: artist.id } }); return before;
    }, upsert() { assert.fail('Root upsert must not partially commit'); } },
    async $transaction(work, options) {
      assert(!active); assert.equal(options, undefined); active = true; events.push('begin');
      try { const result = await work(tx); assert.equal(result, staged); assert(stagedAudit);
        if (before) rows[1] = staged; else rows.push(staged); audits.push(stagedAudit); commits++; events.push('commit'); return result;
      } catch (error) { rollbacks++; events.push('rollback'); throw error; } finally { active = false; }
    } };
    service.findAdminTargetUser = async body => { assert.equal(body, input); events.push('target'); return target; };
    service.findCreatorAccessArtist = async body => { assert.equal(body, input); events.push('artist'); return artist; };
    service.string = (body, key, fallback) => { assert.equal(body, input); assert.equal(key, 'role'); assert.equal(fallback, 'owner'); return fallback; };
    service.artistOperatorStatus = (body, key, fallback) => { assert.equal(body, input); assert.equal(key, 'status'); assert.equal(fallback, 'active'); return fallback; };
    service.optionalStringArray = (body, key) => { assert.equal(body, input); assert.equal(key, 'permissions'); return undefined; };
    service.artistOperatorInclude = () => include;
    service.optionalString = (body, key) => { assert.equal(body, input); assert.equal(key, 'note'); return 'synthetic'; };
    service.recordAudit = (user, action, type, targetId, old, updated, metadata, client) => {
      assert(active); assert.equal(user, actor); assert.equal(client, tx); assert.equal(type, 'artist_operator'); assert.equal(targetId, id);
      assert.equal(action, existing ? 'backstage.creator_access.restore' : 'backstage.creator_access.grant');
      assert.equal(old, before); assert.equal(updated, staged);
      assert.deepEqual(plain(metadata), { targetUserId: target.id, artistId: artist.id, artistSlug: artist.slug, note: 'synthetic' });
      return client.auditEvent.create({ before: old, after: updated, action });
    };
    service.creatorAccessItem = operator => { assert(!active); assert.equal(commits, 1); assert.equal(operator, staged); projections++; return operator; };
    service.creatorAccessPolicy = () => { assert(!active); assert.equal(projections, 1); return policy; };
    if (failAudit) {
      await assert.rejects(service.grantBackstageCreatorAccess(actor, input), error => error === fault);
      assert.deepEqual(rows, original); assert.deepEqual(audits, [retainedAudit]);
      assert.equal(commits, 0); assert.equal(rollbacks, 1); assert.equal(projections, 0);
    } else {
      const result = await service.grantBackstageCreatorAccess(actor, input);
      assert.equal(result.ok, true); assert.equal(result.item, staged); assert.equal(result.policy, policy);
      assert.deepEqual(Object.keys(result).sort(), ['item', 'ok', 'policy']);
      assert.equal(rows[1], staged); assert.equal(audits[1], stagedAudit); assert.equal(commits, 1); assert.equal(rollbacks, 0);
    }
    assert.deepEqual(events, ['target', 'artist', 'before', 'begin', 'upsert', 'audit', failAudit ? 'rollback' : 'commit']);
    assert.equal(rows[0], retained); assert.equal(audits[0], retainedAudit); assert.equal(active, false);
    assert.deepEqual(input, { note: ' synthetic ' });
  }
});
