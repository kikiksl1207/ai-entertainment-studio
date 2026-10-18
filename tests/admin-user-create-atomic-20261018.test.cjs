'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const ts = require(path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js'));
const file = path.join(ROOT, 'server/src/admin/admin.service.ts');
const source = fs.readFileSync(file, 'utf8');
const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
assert.equal(tree.parseDiagnostics.length, 0);
const classes = tree.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === 'AdminService');
assert.equal(classes.length, 1);
const methods = classes[0].members.filter(node => ts.isMethodDeclaration(node) && node.name.getText(tree) === 'createAdminUser');
assert.equal(methods.length, 1); assert(methods[0].body);
// Actual public method; authority, lookup, audit and database behavior are fixture seams.
const compiled = ts.transpileModule('class ScopedAdmin {\n' + methods[0].getText(tree) +
  '\n}\nmodule.exports = ScopedAdmin;', { fileName: 'actual-admin-user-create.ts', reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
assert.equal((compiled.diagnostics || []).length, 0);
const context = { module: { exports: {} }, ConflictException: class extends Error {} };
vm.runInNewContext(compiled.outputText, context, { filename: 'actual-admin-user-create.js', timeout: 1000 });
const ScopedAdmin = context.module.exports, plain = value => JSON.parse(JSON.stringify(value));

test('administrator creation and its audit commit together or preserve both original collections', async () => {
  for (const failure of ['none', 'audit', 'unique']) {
    const service = new ScopedAdmin();
    const actor = Object.freeze({ id: '00000000-0000-4000-8000-000000000001', adminRole: 'super_admin' });
    const target = Object.freeze({ id: '00000000-0000-4000-8000-000000000002', email: null, status: 'active' });
    const role = Object.freeze({ id: '00000000-0000-4000-8000-000000000003', name: 'content_admin' });
    const id = '00000000-0000-4000-8000-000000000004';
    const input = Object.freeze({ userId: target.id });
    const retained = Object.freeze({ retained: 'unrelated synthetic administrator' });
    const retainedAudit = Object.freeze({ retained: 'unrelated synthetic audit' });
    const rows = [retained], audits = [retainedAudit], events = [];
    const fault = new Error('synthetic ' + failure + ' rejection');
    if (failure === 'unique') fault.code = 'P2002';
    let active = false, staged, stagedAudit, rootWrites = 0;
    let authorityCalls = 0, targetReads = 0, existingReads = 0, roleReads = 0;
    let statusCalls = 0, transactions = 0, creates = 0, auditCalls = 0;
    const tx = {
      adminUser: { async create(request) {
        assert(active); assert.equal(++creates, 1); events.push('create');
        assert.deepEqual(plain(request), {
          data: { userId: target.id, roleId: role.id, status: 'active', createdByUserId: actor.id },
          include: { role: true, user: { select: { id: true, email: true, status: true } } },
        });
        if (failure === 'unique') throw fault;
        staged = Object.freeze({ id, ...request.data, role, user: target }); return staged;
      } },
      auditEvent: { async create(request) {
        assert(active); assert.equal(++auditCalls, 1); events.push('audit');
        assert.equal(request.data.afterData, staged);
        assert.deepEqual(plain(request.data), { actorUserId: actor.id, action: 'admin_user.create',
          targetType: 'admin_user', targetId: id, beforeData: null, afterData: plain(staged), metadata: {} });
        if (failure === 'audit') throw fault;
        stagedAudit = request.data; return stagedAudit;
      } },
    };
    const forbidden = () => { rootWrites++; assert.fail('Administrator creation cannot bypass its audit transaction'); };
    service.prisma = {
      adminUser: { async findUnique(request) {
        assert(!active); assert.equal(targetReads, 1); assert.equal(++existingReads, 1); events.push('existing');
        assert.deepEqual(plain(request), { where: { userId: target.id } }); return null;
      }, create: forbidden }, auditEvent: { create: forbidden },
      async $transaction(work, ...options) {
        assert(!active); assert.equal(++transactions, 1); assert.equal(statusCalls, 1);
        assert.deepEqual(options, []); events.push('begin'); active = true;
        try {
          const result = await work(tx); assert.equal(result, staged); assert(stagedAudit);
          rows.push(staged); audits.push(stagedAudit); events.push('commit'); return result;
        } catch (error) { events.push('rollback'); throw error; }
        finally { active = false; }
      },
    };
    service.assertSuperAdmin = user => {
      assert.equal(user, actor); assert(!active); assert.equal(++authorityCalls, 1); events.push('authority');
    };
    service.findAdminTargetUser = async body => {
      assert.equal(body, input); assert(!active); assert.equal(authorityCalls, 1);
      assert.equal(++targetReads, 1); events.push('target'); return target;
    };
    service.string = (body, key, fallback) => {
      assert.equal(body, input); assert.equal(key, 'roleName'); assert.equal(fallback, 'content_admin');
      assert(!active); events.push('role-name'); return fallback;
    };
    service.findAdminRole = async name => {
      assert.equal(name, role.name); assert(!active); assert.equal(++roleReads, 1); events.push('role'); return role;
    };
    service.adminStatus = (body, key, fallback) => {
      assert.equal(body, input); assert.equal(key, 'status'); assert.equal(fallback, 'active');
      assert(!active); assert.equal(roleReads, 1); assert.equal(++statusCalls, 1); events.push('status'); return fallback;
    };
    service.recordAudit = (user, action, targetType, targetId, beforeData, afterData, metadata, client) => {
      assert.equal(user, actor); assert.equal(client, tx); assert(active);
      return client.auditEvent.create({ data: { actorUserId: user.id, action, targetType, targetId, beforeData, afterData, metadata } });
    };
    const prefix = ['authority', 'target', 'existing', 'role-name', 'role', 'status', 'begin', 'create'];
    if (failure === 'none') {
      const result = await service.createAdminUser(actor, input);
      assert.equal(result, staged); assert.equal(rows[1], staged); assert.equal(audits[1], stagedAudit);
      assert.deepEqual(events, [...prefix, 'audit', 'commit']);
    } else {
      await assert.rejects(service.createAdminUser(actor, input), error => error === fault);
      assert.deepEqual(events, [...prefix, ...(failure === 'audit' ? ['audit'] : []), 'rollback']);
      assert.equal(rows.length, 1); assert.equal(audits.length, 1);
    }
    assert.equal(rows[0], retained); assert.equal(audits[0], retainedAudit); assert.equal(rootWrites, 0);
    assert.equal(authorityCalls, 1); assert.equal(targetReads, 1); assert.equal(existingReads, 1);
    assert.equal(roleReads, 1); assert.equal(statusCalls, 1); assert.equal(transactions, 1); assert.equal(creates, 1);
    assert.equal(auditCalls, failure === 'unique' ? 0 : 1); assert.equal(active, false);
  }
});
