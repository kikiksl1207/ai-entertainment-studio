'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const ts = require(path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js'));
const file = path.join(ROOT, 'server/src/community/community.service.ts');
const source = fs.readFileSync(file, 'utf8');
const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
assert.equal(tree.parseDiagnostics.length, 0);
const declarations = tree.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === 'CommunityService');
assert.equal(declarations.length, 1);
const names = ['followUser', 'blockUser', 'removeFollower', 'socialBadRequest', 'socialConflict'];
const slices = names.map(name => {
  const matches = declarations[0].members.filter(node => ts.isMethodDeclaration(node) && node.name.getText(tree) === name);
  assert.equal(matches.length, 1); assert(matches[0].body); return matches[0].getText(tree);
});
const uuidDeclarations = tree.statements.filter(node => ts.isVariableStatement(node))
  .flatMap(node => [...node.declarationList.declarations]).filter(node => node.name.getText(tree) === 'UUID_PATTERN');
assert.equal(uuidDeclarations.length, 1); assert(uuidDeclarations[0].initializer);
const program = 'const UUID_PATTERN = ' + uuidDeclarations[0].initializer.getText(tree) + ';\nclass ScopedCommunity {\n' +
  slices.join('\n') + '\n}\nmodule.exports = ScopedCommunity;';
const compiled = ts.transpileModule(program, { fileName: 'genuine-community-self-methods.ts', reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
assert.equal((compiled.diagnostics || []).length, 0);
const plain = value => JSON.parse(JSON.stringify(value));
const A = 'abcdefab-cdef-4abc-8def-abcdefabcdef', U = A.toUpperCase();
const M = 'AbCdEfAb-cDeF-4aBc-8dEf-AbCdEfAbCdEf', B = 'fedcbafe-dcba-4fed-9cba-fedcbafedcba';
const methods = ['followUser', 'blockUser', 'removeFollower'];
const contracts = {
  followUser: { code: 'SELF_FOLLOW_NOT_ALLOWED', messageKey: 'social.follow.selfNotAllowed', message: 'Cannot follow yourself' },
  blockUser: { code: 'SELF_BLOCK_NOT_ALLOWED', messageKey: 'social.block.selfNotAllowed', message: 'Cannot block yourself' },
  removeFollower: { code: 'SELF_FOLLOW_NOT_ALLOWED', messageKey: 'social.follow.selfNotAllowed', message: 'Cannot remove yourself as follower' },
};
// Genuine AST methods; dependencies and receipts here are synthetic, NOT Prisma/SQL or Nest/JWT proof.
function harness() {
  class SyntheticHttpError extends Error {
    constructor(response, status) { super(response.message); this.response = response; this.status = status; }
    getStatus() { return this.status; }
    getResponse() { return this.response; }
  }
  class ConflictException extends SyntheticHttpError { constructor(response) { super(response, 409); } }
  class BadRequestException extends SyntheticHttpError { constructor(response) { super(response, 400); } }
  const jsonNull = Object.freeze({ syntheticJsonNull: true });
  const context = { module: { exports: {} }, ConflictException, BadRequestException, Prisma: { JsonNull: jsonNull } };
  vm.runInNewContext(compiled.outputText, context, { filename: 'genuine-community-self-methods.js', timeout: 1000,
    contextCodeGeneration: { strings: false, wasm: false } });
  const service = new context.module.exports(), identities = names.map(name => service[name]);
  const events = [], writes = [], notifications = [], audits = [];
  const step = (name, args) => { events.push({ name, args: plain(args) }); };
  const follow = { id: 'synthetic-follow', status: 'active' }, block = { id: 'synthetic-block', status: 'active' };
  service.assertActiveUser = async id => { step('active', [id]); };
  service.assertNoActiveUserBlock = async (...args) => { step('bilateral', args); };
  service.optionalText = (body, key, max) => { step('optionalText', [body, key, max]); return body[key] ?? null; };
  service.userFollowInclude = direction => { step('followInclude', [direction]); return { synthetic: direction }; };
  service.userBlockInclude = () => { step('blockInclude', []); return { synthetic: true }; };
  service.createNotificationSafely = async input => { step('notification', [input]); notifications.push(plain(input)); };
  service.toUserFollowActionView = async (row, actor, target, following) => {
    step('followView', [row, actor, target, following]); return { row, actor, target, following };
  };
  service.toUserBlockView = async row => { step('blockView', [row]); return row; };
  service.userBlockPolicy = () => { step('blockPolicy', []); return { syntheticPolicy: true }; };
  service.publicUserSummary = async id => { step('summary', [id]); return { id }; };
  service.userFollowStats = async id => { step('stats', [id]); return { syntheticFor: id }; };
  service.toJson = value => { step('toJson', [value]); return plain(value); };
  const updateMany = async request => { step('updateMany', [request]); writes.push(plain(request)); return { count: 1 }; };
  service.prisma = {
    userFollow: {
      async findUnique(request) { step('findFollow', [request]); return null; },
      async upsert(request) { step('upsertFollow', [request]); writes.push(plain(request)); return follow; },
      updateMany,
    },
    async $transaction(callback) {
      step('transaction', []);
      return callback({ userBlock: { async upsert(request) { step('upsertBlock', [request]); writes.push(plain(request)); return block; } },
        userFollow: { updateMany }, auditEvent: { async create(request) { step('audit', [request]); audits.push(request); return { id: 'synthetic-audit' }; } } });
    },
  };
  return { service, events, writes, notifications, audits, identities,
    unchanged() { names.forEach((name, index) => assert.equal(service[name], identities[index])); } };
}
test('social SELF rejects every actor/target case spelling before any downstream attempt', { timeout: 10000 }, async () => {
  for (const method of methods) for (const actor of [A, U, M]) for (const target of [A, U, M]) {
    const h = harness();
    await assert.rejects(h.service[method](actor, target), error => {
      assert.equal(error.getStatus(), 409); assert.deepEqual(plain(error.getResponse()), contracts[method]); return true;
    });
    assert.deepEqual(h.events, []); assert.deepEqual(h.writes, []);
    assert.deepEqual(h.notifications, []); assert.deepEqual(h.audits, []); h.unchanged();
  }
});
test('social invalid UUID targets keep exact bad request and never enter downstream', { timeout: 10000 }, async () => {
  const invalid = ['not-a-uuid', ' ' + A, A + ' ', '{' + A + '}', A.slice(0, 14) + '0' + A.slice(15),
    A.slice(0, 14) + '6' + A.slice(15), A.slice(0, 19) + '7' + A.slice(20)];
  for (const method of methods) for (const target of invalid) {
    const h = harness();
    await assert.rejects(h.service[method](A, target), error => {
      assert.equal(error.getStatus(), 400);
      assert.deepEqual(plain(error.getResponse()), { code: 'INVALID_USER_ID', messageKey: 'social.user.invalidId', message: 'userId must be a UUID' }); return true;
    });
    assert.deepEqual(h.events, []); h.unchanged();
  }
});
test('social distinct identities preserve raw arguments and complete valid synthetic downstream receipts', { timeout: 10000 }, async () => {
  for (const method of methods) for (const [actor, target] of [[A, B], [U, B], [B, U], [B, M]]) {
    const h = harness(), result = await h.service[method](actor, target);
    assert.deepEqual(h.events.filter(event => event.name === 'active').map(event => event.args), [[actor], [target]]);
    if (method === 'followUser') {
      assert.deepEqual(h.events.filter(event => event.name === 'bilateral').map(event => event.args), [[actor, target]]);
      assert.equal(h.writes.length, 1); assert.equal(h.notifications.length, 1); assert.equal(h.audits.length, 0);
      assert.deepEqual(h.writes[0].where, { followerUserId_followingUserId: { followerUserId: actor, followingUserId: target } });
      assert.deepEqual(h.writes[0].create, { followerUserId: actor, followingUserId: target });
      assert.equal(result.actor, actor); assert.equal(result.target, target); assert.equal(result.following, true);
      assert.deepEqual(h.notifications[0], { userId: target, type: 'user.follow', title: 'New follower', actorUserId: actor, targetType: 'user', targetId: actor });
    } else if (method === 'blockUser') {
      assert.equal(h.events.filter(event => event.name === 'transaction').length, 1);
      assert.equal(h.writes.length, 3); assert.equal(h.notifications.length, 0); assert.equal(h.audits.length, 1);
      assert.deepEqual(h.writes[0].where, { blockerUserId_blockedUserId: { blockerUserId: actor, blockedUserId: target } });
      assert.deepEqual(h.writes.slice(1).map(request => request.where), [
        { followerUserId: actor, followingUserId: target, status: 'active' },
        { followerUserId: target, followingUserId: actor, status: 'active' }]);
      assert.equal(h.audits[0].data.actorUserId, actor);
      assert.equal(result.block.id, 'synthetic-block');
      assert.equal(result.effects.viewerToTargetFollowRemoved, true); assert.equal(result.effects.targetToViewerFollowRemoved, true);
    } else {
      assert.equal(h.writes.length, 1); assert.equal(h.notifications.length, 0); assert.equal(h.audits.length, 0);
      assert.deepEqual(h.writes[0].where, { followerUserId: target, followingUserId: actor, status: 'active' });
      assert.equal(result.ok, true); assert.equal(result.removed, true); assert.equal(result.user.id, target);
      assert.equal(result.stats.syntheticFor, actor); assert.equal(result.policy.blockCreated, false); assert.equal(result.policy.refollowAllowed, true);
    }
    h.unchanged();
  }
});
