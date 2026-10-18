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
const names = ['createArtistOperator', 'ensureArtist', 'findAdminTargetUser', 'optionalStringArray',
  'string', 'optionalString', 'artistOperatorStatus', 'artistOperatorInclude', 'recordAudit', 'toJson'];
const slices = names.map(name => {
  const methods = classes[0].members.filter(node => ts.isMethodDeclaration(node) && node.name.getText(tree) === name);
  assert.equal(methods.length, 1, 'One genuine AdminService method required: ' + name);
  assert(methods[0].body);
  return methods[0].getText(tree);
});
const target = classes[0].members.find(node => ts.isMethodDeclaration(node) && node.name.getText(tree) === 'createArtistOperator');
const auditCalls = [];
function visit(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword && node.expression.name.text === 'recordAudit') auditCalls.push(node);
  ts.forEachChild(node, visit);
}
visit(target.body);
assert.equal(auditCalls.length, 1); assert.equal(auditCalls[0].arguments.length, 8);
assert.equal(auditCalls[0].arguments[4].kind, ts.SyntaxKind.NullKeyword);
const compiled = ts.transpileModule('class ScopedAdmin {\n' + slices.join('\n') +
  '\n}\nmodule.exports = ScopedAdmin;', { fileName: 'actual-artist-operator-upsert.ts', reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
assert.equal((compiled.diagnostics || []).length, 0);
const plain = value => JSON.parse(JSON.stringify(value));
const defaults = ['feed:post', 'feed:reply'];
const include = { user: { select: { id: true, email: true, status: true,
  profile: { select: { displayName: true, avatarAssetId: true } } } },
  artist: { select: { id: true, slug: true, displayName: true, status: true } } };

// Genuine method/helper slices; the clock, JsonNull and staged database below are synthetic, not Prisma/SQL.
async function scenario(restoring, rejectAudit) {
  const actor = Object.freeze({ id: '00000000-0000-4000-8000-000000000001' });
  const userId = '00000000-0000-4000-8000-000000000002';
  const artistId = '00000000-0000-4000-8000-000000000003';
  const operatorId = '00000000-0000-4000-8000-000000000004';
  const input = Object.freeze({ userId });
  const user = Object.freeze({ id: userId, email: null, status: 'active', deletedAt: null });
  const projectedUser = Object.freeze({ id: userId, email: null, status: 'active', profile: null });
  const artist = Object.freeze({ id: artistId, slug: 'synthetic-artist', displayName: 'Synthetic', status: 'active' });
  const previous = Object.freeze({ id: operatorId, userId, artistId, role: 'previous-role', status: 'revoked',
    permissions: Object.freeze(['feed:post']), revokedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', user: projectedUser, artist });
  const unrelated = Object.freeze({ id: 'unrelated-operator', role: 'sentinel', permissions: Object.freeze(['unchanged']) });
  const earlierSuccess = Object.freeze({ id: 'earlier-success', role: 'owner', status: 'active' });
  const earlierAudit = Object.freeze({ id: 'earlier-audit', targetId: earlierSuccess.id, action: 'artist_operator.upsert' });
  const unrelatedAudit = Object.freeze({ id: 'unrelated-audit', action: 'unrelated' });
  const state = { operators: restoring ? [unrelated, earlierSuccess, previous] : [unrelated, earlierSuccess],
    audits: [unrelatedAudit, earlierAudit], users: [actor, user], artists: [artist], walletLedger: [], pointLedger: [] };
  const initialRows = state.operators, initialAudits = state.audits, initial = plain(state);
  const jsonNull = Object.freeze({ syntheticJsonNull: true });
  const fault = new Error(restoring ? 'synthetic restore audit rejection' : 'synthetic create audit rejection');
  const events = [], counts = { artist: 0, user: 0, preparedDates: 0, transactions: 0, upserts: 0,
    audits: 0, commits: 0, rollbacks: 0, settled: 0, forbidden: 0 };
  let active = false, preparedDate, staged, stagedAudit, auditedInput;
  class SyntheticDate extends Date {
    constructor(...args) {
      assert.equal(args.length, 0);
      super('2026-10-18T00:00:00.000Z');
      assert(!active); assert.equal(counts.transactions, 0);
      assert.equal(counts.artist, 1); assert.equal(counts.user, 1);
      assert.equal(++counts.preparedDates, 1); events.push('prepare-date'); preparedDate = this;
    }
  }
  const context = { module: { exports: {} }, Date: SyntheticDate,
    BadRequestException: class extends Error {}, NotFoundException: class extends Error {},
    Prisma: Object.freeze({ JsonNull: jsonNull }) };
  vm.runInNewContext(compiled.outputText, context, { filename: 'actual-artist-operator-upsert.js', timeout: 1000,
    contextCodeGeneration: { strings: false, wasm: false } });
  const ScopedAdmin = context.module.exports, service = new ScopedAdmin();
  const identities = names.map(name => ScopedAdmin.prototype[name]);
  assert(identities.every(method => typeof method === 'function'));
  const forbidden = () => { counts.forbidden++; assert.fail('Unadmitted root write, preimage, lock, retry or other model dependency'); };
  const allowed = members => new Proxy(Object.freeze(members), { get(target, key) {
    if (!Object.hasOwn(target, key)) return forbidden();
    return target[key];
  } });
  service.prisma = allowed({
    artist: allowed({ async findUnique(request) {
      assert(!active); assert.equal(counts.transactions, 0);
      assert.equal(++counts.artist, 1); assert.equal(counts.user, 0); events.push('artist');
      assert.deepEqual(plain(request), { where: { id: artistId } }); return artist;
    } }),
    user: allowed({ async findUnique(request) {
      assert(!active); assert.equal(counts.transactions, 0);
      assert.equal(counts.artist, 1); assert.equal(++counts.user, 1); events.push('user');
      assert.deepEqual(plain(request), { where: { id: userId } }); return user;
    } }),
    async $transaction(...args) {
      assert.equal(args.length, 1); assert.equal(typeof args[0], 'function');
      assert(!active); assert.equal(counts.artist, 1); assert.equal(counts.user, 1);
      assert.equal(counts.preparedDates, 1); assert.equal(++counts.transactions, 1);
      assert.deepEqual(plain(state), initial); events.push('begin'); active = true;
      const draftRows = state.operators.slice(), draftAudits = state.audits.slice();
      const tx = allowed({
        artistOperator: allowed({ async upsert(request) {
          assert(active); assert.equal(++counts.upserts, 1); assert.equal(counts.audits, 0); events.push('upsert');
          assert.deepEqual(Object.keys(request).sort(), ['create', 'include', 'update', 'where']);
          assert.deepEqual(plain(request.where), { userId_artistId: { userId, artistId } });
          assert.deepEqual(plain(request.include), include);
          assert.deepEqual(Object.keys(request.create).sort(), ['artistId', 'permissions', 'role', 'status', 'userId']);
          assert.deepEqual(plain(request.create), { userId, artistId, role: 'owner', status: 'active', permissions: defaults });
          assert.deepEqual(Object.keys(request.update).sort(), ['permissions', 'revokedAt', 'role', 'status', 'updatedAt']);
          assert.equal(request.update.role, undefined); assert.equal(request.update.status, 'active');
          assert.deepEqual(plain(request.update.permissions), defaults); assert.equal(request.update.revokedAt, null);
          assert.equal(request.create.permissions, request.update.permissions);
          assert.equal(request.update.updatedAt, preparedDate);
          assert.equal(request.update.updatedAt.toISOString(), '2026-10-18T00:00:00.000Z');
          if (restoring) {
            const changes = Object.fromEntries(Object.entries(request.update).filter(([, value]) => value !== undefined));
            staged = Object.freeze({ ...previous, ...changes });
            draftRows[2] = staged;
          } else {
            staged = Object.freeze({ id: operatorId, ...request.create, revokedAt: null,
              createdAt: new Date('2026-10-18T00:00:01.000Z'), updatedAt: new Date('2026-10-18T00:00:01.000Z'),
              user: projectedUser, artist });
            draftRows.push(staged);
          }
          assert.deepEqual(plain(state), initial); return staged;
        } }),
        auditEvent: allowed({ async create(request) {
          assert(active); assert.equal(counts.upserts, 1); assert.equal(++counts.audits, 1); events.push('audit');
          assert.deepEqual(Object.keys(request), ['data']);
          assert.deepEqual(Object.keys(request.data).sort(),
            ['action', 'actorType', 'actorUserId', 'afterData', 'beforeData', 'metadata', 'targetId', 'targetType']);
          assert.equal(request.data.beforeData, jsonNull);
          assert.notEqual(request.data.afterData, staged);
          assert.deepEqual(plain(request.data), { actorUserId: actor.id, actorType: 'admin', action: 'artist_operator.upsert',
            targetType: 'artist_operator', targetId: operatorId, beforeData: plain(jsonNull), afterData: plain(staged),
            metadata: { artistId, targetUserId: userId } });
          assert.deepEqual(plain(state), initial); assert.equal(counts.commits, 0); auditedInput = request.data;
          if (rejectAudit) throw fault;
          stagedAudit = Object.freeze({ id: 'new-synthetic-audit', ...request.data, beforeData: null });
          draftAudits.push(stagedAudit); return stagedAudit;
        } }),
      });
      try {
        const result = await args[0](tx);
        assert.equal(result, staged); assert(stagedAudit); assert.deepEqual(plain(state), initial);
        state.operators = draftRows; state.audits = draftAudits;
        counts.commits++; events.push('commit'); return result;
      } catch (error) { counts.rollbacks++; events.push('rollback'); throw error; }
      finally { active = false; counts.settled++; }
    },
  });
  if (rejectAudit) {
    await assert.rejects(service.createArtistOperator(actor, artistId, input), error => error === fault);
    assert(staged); assert(auditedInput); assert.equal(stagedAudit, undefined);
    assert.equal(state.operators, initialRows); assert.equal(state.audits, initialAudits);
    assert.deepEqual(plain(state), initial); assert.equal(counts.commits, 0); assert.equal(counts.rollbacks, 1);
    if (restoring) { assert.equal(state.operators[2], previous); assert.notDeepEqual(plain(staged), plain(previous)); }
    else assert(!state.operators.some(row => row.id === operatorId));
  } else {
    const result = await service.createArtistOperator(actor, artistId, input);
    assert.equal(result, staged); assert.deepEqual(plain(result), plain(staged));
    assert.equal(state.operators[2], staged); assert.equal(state.audits[2], stagedAudit);
    assert.equal(result.role, restoring ? previous.role : 'owner'); assert.equal(result.status, 'active');
    assert.equal(result.revokedAt, null); assert.deepEqual(plain(result.permissions), defaults);
    assert.equal(result.user, projectedUser); assert.equal(result.artist, artist);
    assert.deepEqual(Object.keys(result).sort(),
      ['artist', 'artistId', 'createdAt', 'id', 'permissions', 'revokedAt', 'role', 'status', 'updatedAt', 'user', 'userId']);
    assert.equal(stagedAudit.beforeData, null); assert.deepEqual(plain(stagedAudit.afterData), plain(result));
    if (restoring) { assert.equal(result.id, previous.id); assert.equal(result.createdAt, previous.createdAt); }
    assert.equal(counts.commits, 1); assert.equal(counts.rollbacks, 0);
  }
  assert.deepEqual(events, ['artist', 'user', 'prepare-date', 'begin', 'upsert', 'audit', rejectAudit ? 'rollback' : 'commit']);
  for (const key of ['artist', 'user', 'preparedDates', 'transactions', 'upserts', 'audits', 'settled']) assert.equal(counts[key], 1);
  assert.equal(counts.forbidden, 0); assert.equal(active, false);
  assert.equal(state.operators[0], unrelated); assert.equal(state.operators[1], earlierSuccess);
  assert.equal(state.audits[0], unrelatedAudit); assert.equal(state.audits[1], earlierAudit);
  assert.deepEqual(plain(state.users), initial.users); assert.deepEqual(plain(state.artists), initial.artists);
  assert.deepEqual(state.walletLedger, []); assert.deepEqual(state.pointLedger, []);
  assert.equal(state.operators.length, rejectAudit ? initialRows.length : 3);
  assert.equal(state.audits.length, rejectAudit ? 2 : 3);
  assert.deepEqual(input, { userId });
  names.forEach((name, index) => assert.equal(ScopedAdmin.prototype[name], identities[index]));
}

test('artist operator upsert creates raw owner active row with default two and original null audit',
  { timeout: 10000 }, () => scenario(false, false));
test('artist operator upsert restores raw row preserving omitted role and default two',
  { timeout: 10000 }, () => scenario(true, false));
test('artist operator upsert propagates identical create audit error and rolls back the synthetic transaction',
  { timeout: 10000 }, () => scenario(false, true));
test('artist operator upsert propagates identical restore audit error and retains prior rows and audits',
  { timeout: 10000 }, () => scenario(true, true));
