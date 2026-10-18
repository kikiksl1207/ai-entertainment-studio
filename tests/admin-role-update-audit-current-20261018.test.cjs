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
const methods = classes[0].members.filter(node => ts.isMethodDeclaration(node) && node.name.getText(tree) === 'updateAdminUser');
assert.equal(methods.length, 1); assert(methods[0].body);
// Actual method only; authority, role lookup, audit serialization and SQL are fixture seams.
const compiled = ts.transpileModule('class ScopedAdmin {\n' + methods[0].getText(tree) +
  '\n}\nmodule.exports = ScopedAdmin;', { fileName: 'actual-admin-role-update.ts', reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
assert.equal((compiled.diagnostics || []).length, 0);
const context = { module: { exports: {} }, BadRequestException: class extends Error {},
  NotFoundException: class extends Error {}, Prisma: { TransactionIsolationLevel: { ReadCommitted: 'ReadCommitted' } } };
vm.runInNewContext(compiled.outputText, context, { filename: 'actual-admin-role-update.js', timeout: 1000 });
const ScopedAdmin = context.module.exports, plain = value => JSON.parse(JSON.stringify(value));

test('administrator role updates audit the locked current row and roll back together', async () => {
  for (const rejectAudit of [false, true]) {
    const service = new ScopedAdmin(), actor = Object.freeze({ id: '00000000-0000-4000-8000-000000000001', adminRole: 'super_admin' });
    const id = '00000000-0000-4000-8000-000000000002', userId = '00000000-0000-4000-8000-000000000003';
    const oldRole = Object.freeze({ id: '00000000-0000-4000-8000-000000000004', name: 'content_admin' });
    const role = Object.freeze({ id: '00000000-0000-4000-8000-000000000005', name: 'review_admin' });
    const fullUser = Object.freeze({ id: userId, email: null, status: 'active', syntheticExtra: 'full preimage only' });
    const input = Object.freeze({ status: 'suspended', roleName: 'review_admin' });
    const before = Object.freeze({ id, userId, roleId: oldRole.id, status: 'active', role: oldRole, user: fullUser });
    const current = Object.freeze({ ...before, status: 'revoked' });
    const retained = Object.freeze({ retained: 'unrelated synthetic administrator' });
    const previousAudit = Object.freeze({ retained: 'unrelated synthetic audit' });
    const rows = [current, retained], audits = [previousAudit], events = [];
    const fault = new Error('synthetic role audit rejection');
    let active = false, locked = false, staged, stagedAudit;
    let authorityCalls = 0, preflightReads = 0, roleLookups = 0, transactions = 0;
    let locks = 0, currentReads = 0, updates = 0, auditCalls = 0, rootWrites = 0;
    const tx = {
      async $queryRaw(parts, ...values) {
        assert(active); assert.equal(++locks, 1); assert.deepEqual(values, [id]);
        assert.equal(Array.from(parts).join('?').replace(/\s+/g, ' ').trim(),
          'SELECT id FROM admin_users WHERE id = ?::uuid FOR UPDATE');
        locked = true; events.push('lock'); return [{ id }];
      },
      adminUser: {
        async findUniqueOrThrow(request) {
          assert(active && locked); assert.equal(++currentReads, 1); events.push('current');
          assert.deepEqual(plain(request), { where: { id }, include: { role: true, user: true } }); return current;
        },
        async update(request) {
          assert(active && locked); assert.equal(++updates, 1); events.push('update');
          assert.deepEqual(plain(request.where), { id });
          const data = plain(request.data), time = data.updatedAt;
          assert.equal(typeof time, 'string'); assert(Number.isFinite(Date.parse(time))); delete data.updatedAt;
          assert.deepEqual(data, { roleId: role.id, status: 'suspended' });
          assert.deepEqual(plain(request.include), { role: true, user: { select: { id: true, email: true, status: true } } });
          staged = Object.freeze({ ...current, ...request.data, role,
            user: Object.freeze({ id: userId, email: null, status: 'active' }) });
          return staged;
        },
      },
      auditEvent: { async create(request) {
        assert(active && locked); assert.equal(++auditCalls, 1); events.push('audit');
        assert.equal(request.data.beforeData, current); assert.equal(request.data.afterData, staged);
        assert.deepEqual(plain(request.data), { actorUserId: actor.id, action: 'admin_user.update', targetType: 'admin_user',
          targetId: id, beforeData: plain(current), afterData: plain(staged), metadata: {} });
        if (rejectAudit) throw fault;
        stagedAudit = request.data; return stagedAudit;
      } },
    };
    const forbidden = () => { rootWrites++; assert.fail('Role changes cannot bypass their audit transaction'); };
    service.prisma = {
      adminUser: { async findUnique(request) {
        assert(!active); assert.equal(authorityCalls, 1); assert.equal(++preflightReads, 1); events.push('preflight');
        assert.deepEqual(plain(request), { where: { id }, include: { role: true, user: true } }); return before;
      }, update: forbidden }, auditEvent: { create: forbidden },
      async $transaction(work, options) {
        assert.equal(++transactions, 1); assert(!active); assert.equal(roleLookups, 1);
        assert.deepEqual(plain(options), { isolationLevel: 'ReadCommitted' }); active = true; events.push('begin');
        try {
          const result = await work(tx); assert.equal(result, staged); assert(stagedAudit);
          rows[0] = staged; audits.push(stagedAudit); events.push('commit'); return result;
        } catch (error) { events.push('rollback'); throw error; }
        finally { active = false; locked = false; }
      },
    };
    service.assertSuperAdmin = user => { assert.equal(user, actor); assert(!active); assert.equal(++authorityCalls, 1); events.push('authority'); };
    service.adminStatus = (body, key) => { assert.equal(body, input); assert.equal(key, 'status'); events.push('status'); return body.status; };
    service.optionalString = (body, key) => { assert.equal(body, input); assert.equal(key, 'roleName'); events.push('role-name'); return body.roleName; };
    service.findAdminRole = async name => { assert(!active); assert.equal(name, input.roleName); assert.equal(++roleLookups, 1); events.push('role-lookup'); return role; };
    service.clean = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
    service.recordAudit = (user, action, targetType, targetId, beforeData, afterData, metadata, client) => {
      assert.equal(user, actor); assert.equal(client, tx); assert(active && locked);
      return client.auditEvent.create({ data: { actorUserId: user.id, action, targetType, targetId, beforeData, afterData, metadata } });
    };
    if (rejectAudit) {
      await assert.rejects(service.updateAdminUser(actor, id, input), error => error === fault);
      assert.equal(rows[0], current); assert.equal(audits.length, 1);
      assert.deepEqual(events, ['authority', 'preflight', 'status', 'role-name', 'role-lookup', 'begin', 'lock', 'current', 'update', 'audit', 'rollback']);
    } else {
      const result = await service.updateAdminUser(actor, id, input);
      assert.equal(result, staged); assert.equal(rows[0], staged); assert.equal(audits.length, 2); assert.equal(audits[1], stagedAudit);
      assert.deepEqual(events, ['authority', 'preflight', 'status', 'role-name', 'role-lookup', 'begin', 'lock', 'current', 'update', 'audit', 'commit']);
    }
    assert.equal(rows[1], retained); assert.equal(audits[0], previousAudit);
    assert.equal(before.status, 'active'); assert.equal(current.status, 'revoked'); assert.equal(input.status, 'suspended');
    assert.equal(active, false); assert.equal(locked, false); assert.equal(rootWrites, 0);
    assert.equal(authorityCalls, 1); assert.equal(preflightReads, 1); assert.equal(roleLookups, 1); assert.equal(transactions, 1);
    assert.equal(locks, 1); assert.equal(currentReads, 1); assert.equal(updates, 1); assert.equal(auditCalls, 1);
  }
});
