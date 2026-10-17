'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const ts = require(path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js'));
const sourceFile = path.join(ROOT, 'server/src/admin/admin.service.ts');
const source = fs.readFileSync(sourceFile, 'utf8');
const tree = ts.createSourceFile(sourceFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
assert.equal(tree.parseDiagnostics.length, 0, 'Actual AdminService must parse');
const classes = tree.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === 'AdminService');
assert.equal(classes.length, 1, 'Exactly one actual AdminService required');
const selected = ['hideCommunityPost', 'restoreCommunityPost', 'findCommunityPostForAdmin'].map(name => {
  const methods = classes[0].members.filter(node => ts.isMethodDeclaration(node) && node.name.getText(tree) === name);
  assert.equal(methods.length, 1, 'Exactly one actual method required: ' + name);
  assert(methods[0].body, 'Actual method body required: ' + name);
  return methods[0].getText(tree);
});
// Only these actual methods execute. Remaining helpers and the transaction are fixture seams.
const compiled = ts.transpileModule('class ScopedAdmin {\n' + selected.join('\n') +
  '\n}\nmodule.exports = ScopedAdmin;', { fileName: 'actual-community-methods.ts', reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
assert.equal((compiled.diagnostics || []).length, 0, 'Selected methods must transpile');
const sandbox = { module: { exports: {} }, BadRequestException: class extends Error {},
  NotFoundException: class extends Error {},
  Prisma: { TransactionIsolationLevel: { ReadCommitted: 'ReadCommitted' } } };
vm.runInNewContext(compiled.outputText, sandbox, { filename: 'actual-community-methods.js', timeout: 1000 });
const ScopedAdmin = sandbox.module.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const POST = '00000000-0000-4000-8000-000000000001';
const ACTOR = '00000000-0000-4000-8000-000000000002';

async function checkCurrentRow(action) {
  const user = Object.freeze({ id: ACTOR });
  const input = Object.freeze({ reason: 'synthetic reason', note: 'synthetic note' });
  const stale = { id: POST, status: action === 'hide' ? 'hidden' : 'published', deletedAt: null,
    metadata: { revision: 'preflight', staleOnly: true, moderation: { revision: 'preflight', staleOnly: true } } };
  const current = { id: POST, status: action === 'hide' ? 'published' : 'hidden',
    deletedAt: action === 'hide' ? null : '2026-10-01T00:00:00.000Z',
    metadata: { revision: 'locked', writerOnly: { value: 'synthetic current metadata' },
      moderation: { revision: 'locked', status: 'prior', writerOnly: { value: 'synthetic current moderation' } } } };
  const originalStale = plain(stale), originalCurrent = plain(current);
  const include = Object.freeze({ fixtureInclude: true });
  const auditMetadata = Object.freeze({ syntheticAuditMetadata: true });
  const events = [];
  let inside = false, locked = false, txReads = 0, transactions = 0, rootWrites = 0;
  let updateRequest, written, audit;
  const snapshot = row => plain({ id: row.id, status: row.status, deletedAt: row.deletedAt, metadata: row.metadata });
  const lookup = request => {
    assert.deepEqual(plain(request.where), { id: POST });
    assert.equal(request.include, include);
  };
  const rejectRootWrite = () => { rootWrites++; assert.fail('Root writes are forbidden'); };
  const tx = {
    async $queryRaw(strings, ...values) {
      assert(inside && !locked, 'Lock must occur once inside the transaction');
      assert(Array.isArray(strings) && Array.isArray(strings.raw), 'Lock must use tagged SQL');
      assert(Object.isFrozen(strings) && Object.isFrozen(strings.raw));
      assert.equal(strings.length, 2);
      assert.deepEqual([...strings.raw], [...strings]);
      assert.deepEqual(values, [POST], 'Lock binds the same post id, not interpolated SQL');
      assert.equal((strings[0] + '$1' + strings[1]).replace(/\s+/g, ' ').trim(),
        'SELECT id FROM community_posts WHERE id = $1::uuid FOR UPDATE');
      events.push('lock'); locked = true;
      return [{ id: POST }];
    },
    communityPost: {
      async findUnique(request) {
        assert(inside && locked && txReads === 0, 'Current read must follow the row lock');
        lookup(request); txReads++; events.push('tx-read');
        return plain(current);
      },
      async update(request) {
        assert(inside && locked && txReads === 1, 'Update must use the locked transaction');
        lookup(request); events.push('tx-update'); updateRequest = request;
        written = plain({ ...current, ...request.data });
        return written;
      },
    },
  };
  const service = new ScopedAdmin();
  service.prisma = {
    communityPost: {
      async findUnique(request) {
        assert(!inside, 'Root client is only for preflight');
        lookup(request); events.push('root-preflight'); return plain(stale);
      },
      update: rejectRootWrite,
    },
    auditEvent: { create: rejectRootWrite },
    $queryRaw: rejectRootWrite,
    async $transaction(work, options) {
      assert(!inside && transactions === 0);
      assert.deepEqual(events, ['root-preflight']);
      assert.deepEqual(plain(options), { isolationLevel: 'ReadCommitted' });
      transactions++; inside = true; events.push('transaction');
      try {
        const response = await work(tx);
        events.push('commit'); return response;
      } finally { inside = false; }
    },
  };
  // These seams observe selected-method arguments, not actual helper validation or audit SQL.
  Object.assign(service, {
    isUuid(value) { assert.equal(value, POST); return true; },
    communityPostInclude() { return include; },
    metadataObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; },
    optionalString(value, key) { assert.equal(value, input); assert(['reason', 'note'].includes(key)); return value[key]; },
    toJson: plain,
    communityPostAuditSnapshot: snapshot,
    communityModerationAuditMetadata(value) { assert.equal(value, input); return auditMetadata; },
    async recordAudit(actor, verb, targetType, targetId, before, after, metadata, client) {
      assert(inside && locked && written && !audit, 'Audit must follow the transaction update');
      assert.equal(client, tx, 'Audit must receive the same transaction client');
      audit = { actor, verb, targetType, targetId, before, after, metadata };
      events.push('audit');
    },
  });

  const result = await service[action === 'hide' ? 'hideCommunityPost' : 'restoreCommunityPost'](user, POST, input);
  assert.deepEqual(events, ['root-preflight', 'transaction', 'lock', 'tx-read', 'tx-update', 'audit', 'commit']);
  assert.equal(transactions, 1); assert.equal(txReads, 1); assert.equal(rootWrites, 0); assert.equal(inside, false);
  assert.deepEqual(Object.keys(result).sort(), ['ok', 'post']);
  assert.equal(result.ok, true); assert.equal(result.post, written);
  const restoring = action === 'restore', prefix = restoring ? 'restored' : 'hidden';
  assert.equal(written.status, restoring ? 'published' : 'hidden');
  assert.equal(written.deletedAt, restoring ? null : current.deletedAt);
  assert.deepEqual(Object.keys(updateRequest.data).sort(), restoring
    ? ['deletedAt', 'metadata', 'status', 'updatedAt'] : ['metadata', 'status', 'updatedAt']);
  assert.match(updateRequest.data.updatedAt.toISOString(), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  const stamp = written.metadata.moderation[prefix + 'At'];
  assert.match(stamp, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.deepEqual(written.metadata, { ...current.metadata, moderation: { ...current.metadata.moderation,
    status: restoring ? 'restored' : 'hidden', reason: input.reason, note: input.note,
    [prefix + 'ByUserId']: ACTOR, [prefix + 'At']: stamp } }, 'COMMUNITY_CURRENT_ROW_METADATA');
  assert.equal(audit.actor, user); assert.equal(audit.verb, 'community_post.' + action);
  assert.equal(audit.targetType, 'community_post'); assert.equal(audit.targetId, POST);
  assert.deepEqual(audit.before, snapshot(current), 'COMMUNITY_CURRENT_ROW_AUDIT_BEFORE');
  assert.deepEqual(audit.after, snapshot(written)); assert.equal(audit.metadata, auditMetadata);
  assert.deepEqual(stale, originalStale); assert.deepEqual(current, originalCurrent);
}

test('community hide preserves locked current metadata and audit before', { timeout: 5000 }, async () => {
  await checkCurrentRow('hide');
});

test('community restore preserves locked current metadata and audit before', { timeout: 5000 }, async () => {
  await checkCurrentRow('restore');
});
