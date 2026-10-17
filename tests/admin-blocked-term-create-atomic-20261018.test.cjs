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
const methods = classes[0].members.filter(node => ts.isMethodDeclaration(node) &&
  node.name.getText(tree) === 'createBackstageFeedSearchBlockedTerm');
assert.equal(methods.length, 1); assert(methods[0].body);
// Execute the actual selected method; validation, audit serialization and SQL remain fixture seams.
const compiled = ts.transpileModule('class ScopedAdmin {\n' + methods[0].getText(tree) +
  '\n}\nmodule.exports = ScopedAdmin;', { fileName: 'actual-blocked-term-create.ts', reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
assert.equal((compiled.diagnostics || []).length, 0);
const context = { module: { exports: {} }, ConflictException: class extends Error {},
  Prisma: { PrismaClientKnownRequestError: class extends Error {} } };
vm.runInNewContext(compiled.outputText, context, { filename: 'actual-blocked-term-create.js', timeout: 1000 });
const ScopedAdmin = context.module.exports, plain = value => JSON.parse(JSON.stringify(value));

test('blocked term creation shares its audit transaction and rolls back both on audit rejection', async () => {
  for (const rejectAudit of [false, true]) {
    const service = new ScopedAdmin(), actor = Object.freeze({ id: '00000000-0000-4000-8000-000000000001' });
    const input = Object.freeze({ keyword: 'Synthetic term', type: 'text', language: 'en', status: 'active', reason: null });
    const policy = Object.freeze({ fixturePolicy: true }), fault = new Error('synthetic audit rejection');
    const retainedTerm = Object.freeze({ retained: 'synthetic unrelated term' });
    const retainedAudit = Object.freeze({ retained: 'synthetic unrelated audit' });
    const terms = [retainedTerm], audits = [retainedAudit], events = [];
    let active = false, transactions = 0, policyCalls = 0, rootWrites = 0, creates = 0, auditCalls = 0;
    let created, stagedAudit;
    const expectedData = { keyword: input.keyword, normalizedKeyword: 'synthetic term', searchType: 'text',
      language: 'en', status: 'active', reason: null, createdByUserId: actor.id, updatedByUserId: actor.id };
    const tx = {
      feedSearchBlockedTerm: { async create(request) {
        assert(active); assert.equal(++creates, 1); events.push('term');
        assert.deepEqual(plain(request), { data: expectedData });
        created = Object.freeze({ id: '00000000-0000-4000-8000-000000000002', ...expectedData });
        return created;
      } },
      auditEvent: { async create(request) {
        assert(active); assert.equal(++auditCalls, 1); events.push('audit');
        assert.equal(request.data.afterData, created);
        assert.deepEqual(plain(request.data), { actorUserId: actor.id, action: 'feed_search_blocked_term.create',
          targetType: 'feed_search_blocked_term', targetId: created.id, beforeData: null, afterData: plain(created),
          metadata: { keyword: input.keyword, normalizedKeyword: 'synthetic term', searchType: 'text', language: 'en', status: 'active' } });
        if (rejectAudit) throw fault;
        stagedAudit = request.data; return stagedAudit;
      } },
    };
    const forbidden = () => { rootWrites++; assert.fail('Root writes cannot bypass the transaction'); };
    service.prisma = {
      feedSearchBlockedTerm: { create: forbidden }, auditEvent: { create: forbidden },
      async $transaction(work, ...options) {
        assert.equal(options.length, 0); assert.equal(++transactions, 1); assert(!active);
        active = true; events.push('begin');
        try {
          const result = await work(tx); assert.equal(result, created); assert(stagedAudit);
          terms.push(created); audits.push(stagedAudit); events.push('commit'); return result;
        } catch (error) { events.push('rollback'); throw error; }
        finally { active = false; }
      },
    };
    service.feedSearchBlockedKeyword = value => { assert.equal(value, input.keyword); return value; };
    service.feedSearchType = value => { assert.equal(value, 'text'); return value; };
    service.feedSearchLanguage = value => { assert.equal(value, 'en'); return value; };
    service.feedSearchBlockedTermStatus = value => { assert.equal(value, 'active'); return value; };
    service.normalizeFeedSearchBlockedKeyword = (keyword, type) => {
      assert.equal(keyword, input.keyword); assert.equal(type, 'text'); return 'synthetic term';
    };
    service.optionalString = () => assert.fail('Explicit null reason must not invoke optional-string parsing');
    service.recordAudit = (user, action, targetType, targetId, beforeData, afterData, metadata, client) => {
      assert.equal(user, actor); assert.equal(client, tx); assert(active);
      return client.auditEvent.create({ data: { actorUserId: user.id, action, targetType, targetId, beforeData, afterData, metadata } });
    };
    service.feedSearchBlockedTermsPolicy = () => { assert(!active); assert.equal(++policyCalls, 1); events.push('policy'); return policy; };
    if (rejectAudit) {
      await assert.rejects(service.createBackstageFeedSearchBlockedTerm(actor, input), error => error === fault);
      assert.deepEqual(events, ['begin', 'term', 'audit', 'rollback']);
      assert.equal(terms.length, 1); assert.equal(audits.length, 1); assert.equal(policyCalls, 0);
    } else {
      const result = await service.createBackstageFeedSearchBlockedTerm(actor, input);
      assert.equal(result.ok, true); assert.equal(result.item, created); assert.equal(result.policy, policy);
      assert.deepEqual(events, ['begin', 'term', 'audit', 'commit', 'policy']);
      assert.equal(terms.length, 2); assert.equal(audits.length, 2);
      assert.equal(terms[1], created); assert.equal(audits[1], stagedAudit);
    }
    assert.equal(terms[0], retainedTerm); assert.equal(audits[0], retainedAudit);
    assert.equal(active, false); assert.equal(transactions, 1); assert.equal(rootWrites, 0);
    assert.equal(creates, 1); assert.equal(auditCalls, 1); assert.equal(input.reason, null);
  }
});
