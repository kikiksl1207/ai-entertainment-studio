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
  node.name.getText(tree) === 'updateBackstageFeedSearchBlockedTerm');
assert.equal(methods.length, 1); assert(methods[0].body);
// Actual method only; validation, audit serialization and SQL remain fixture seams.
const compiled = ts.transpileModule('class ScopedAdmin {\n' + methods[0].getText(tree) +
  '\n}\nmodule.exports = ScopedAdmin;', { fileName: 'actual-blocked-term-update.ts', reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
assert.equal((compiled.diagnostics || []).length, 0);
const context = { module: { exports: {} }, ConflictException: class extends Error {},
  BadRequestException: class extends Error {}, NotFoundException: class extends Error {},
  Prisma: { PrismaClientKnownRequestError: class extends Error {},
    TransactionIsolationLevel: { ReadCommitted: 'ReadCommitted' } } };
vm.runInNewContext(compiled.outputText, context, { filename: 'actual-blocked-term-update.js', timeout: 1000 });
const ScopedAdmin = context.module.exports, plain = value => JSON.parse(JSON.stringify(value));

test('blocked term updates derive from the locked row and share audit rollback', async () => {
  for (const rejectAudit of [false, true]) {
    const service = new ScopedAdmin(), actor = Object.freeze({ id: '00000000-0000-4000-8000-000000000001' });
    const id = '00000000-0000-4000-8000-000000000002';
    const input = Object.freeze({ type: 'hashtag' });
    const before = Object.freeze({ id, keyword: '#Old', normalizedKeyword: '#old', searchType: 'text',
      language: 'en', status: 'active', reason: 'retained current reason' });
    const current = Object.freeze({ ...before, keyword: '#New', normalizedKeyword: '#new' });
    const retained = Object.freeze({ retained: 'unrelated synthetic row' });
    const previousAudit = Object.freeze({ retained: 'unrelated synthetic audit' });
    const terms = [current, retained], audits = [previousAudit], events = [], normalized = [];
    const policy = Object.freeze({ fixturePolicy: true }), fault = new Error('synthetic audit rejection');
    let active = false, locked = false, committed = current, staged, stagedAudit;
    let transactions = 0, rootReads = 0, rootWrites = 0, locks = 0, currentReads = 0, updates = 0, auditCalls = 0;
    const tx = {
      async $queryRaw(parts, ...values) {
        assert(active); assert.equal(++locks, 1); assert.equal(values.length, 1); assert.equal(values[0], id);
        assert.equal(Array.from(parts).join('?').replace(/\s+/g, ' ').trim(),
          'SELECT id FROM feed_search_blocked_terms WHERE id = ?::uuid FOR UPDATE');
        locked = true; events.push('lock'); return [{ id }];
      },
      feedSearchBlockedTerm: {
        async findUniqueOrThrow(request) {
          assert(active && locked); assert.equal(++currentReads, 1); events.push('current');
          assert.deepEqual(plain(request), { where: { id } }); return current;
        },
        async update(request) {
          assert(active && locked); assert.equal(++updates, 1); events.push('update');
          assert.equal(request.where.id, id);
          const data = plain(request.data), time = data.updatedAt;
          assert.equal(typeof time, 'string'); assert(Number.isFinite(Date.parse(time))); delete data.updatedAt;
          assert.deepEqual(data, { normalizedKeyword: 'new', searchType: 'hashtag', updatedByUserId: actor.id });
          staged = Object.freeze({ ...current, ...request.data }); return staged;
        },
      },
      auditEvent: { async create(request) {
        assert(active && locked); assert.equal(++auditCalls, 1); events.push('audit');
        assert.equal(request.data.beforeData, current); assert.equal(request.data.afterData, staged);
        assert.deepEqual(plain(request.data), { actorUserId: actor.id, action: 'feed_search_blocked_term.update',
          targetType: 'feed_search_blocked_term', targetId: id, beforeData: plain(current), afterData: plain(staged),
          metadata: { status: 'active', searchType: 'hashtag', language: 'en' } });
        if (rejectAudit) throw fault;
        stagedAudit = request.data; return stagedAudit;
      } },
    };
    const forbidden = () => { rootWrites++; assert.fail('No root write may bypass the row transaction'); };
    service.prisma = {
      feedSearchBlockedTerm: { async findUnique(request) {
        assert(!active); assert.equal(++rootReads, 1); events.push('preflight');
        assert.deepEqual(plain(request), { where: { id } }); return before;
      }, update: forbidden }, auditEvent: { create: forbidden },
      async $transaction(work, options) {
        assert.equal(++transactions, 1); assert(!active); events.push('begin');
        assert.deepEqual(plain(options), { isolationLevel: 'ReadCommitted' }); active = true;
        try {
          const result = await work(tx); assert.equal(result, staged); assert(stagedAudit);
          committed = staged; terms[0] = staged; audits.push(stagedAudit); events.push('commit'); return result;
        } catch (error) { events.push('rollback'); throw error; }
        finally { active = false; locked = false; }
      },
    };
    service.isUuid = value => { assert.equal(value, id); return true; };
    service.feedSearchBlockedKeyword = () => assert.fail('Omitted keyword must retain its presence');
    service.feedSearchType = value => { assert.equal(value, 'hashtag'); return value; };
    service.feedSearchLanguage = () => assert.fail('Omitted language must retain its presence');
    service.feedSearchBlockedTermStatus = () => assert.fail('Omitted status must retain its presence');
    service.optionalString = () => assert.fail('Omitted reason must retain its presence');
    service.normalizeFeedSearchBlockedKeyword = (keyword, type) => {
      assert.equal(type, 'hashtag'); normalized.push(keyword); return keyword.slice(1).toLowerCase();
    };
    service.clean = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
    service.recordAudit = (user, action, targetType, targetId, beforeData, afterData, metadata, client) => {
      assert.equal(user, actor); assert.equal(client, tx); assert(active && locked);
      return client.auditEvent.create({ data: { actorUserId: user.id, action, targetType, targetId, beforeData, afterData, metadata } });
    };
    service.feedSearchBlockedTermsPolicy = () => { assert(!active); events.push('policy'); return policy; };
    if (rejectAudit) {
      await assert.rejects(service.updateBackstageFeedSearchBlockedTerm(actor, id, input), error => error === fault);
      assert.equal(committed, current); assert.equal(audits.length, 1);
      assert.deepEqual(events, ['preflight', 'begin', 'lock', 'current', 'update', 'audit', 'rollback']);
    } else {
      const result = await service.updateBackstageFeedSearchBlockedTerm(actor, id, input);
      assert.equal(result.ok, true); assert.equal(result.item, staged); assert.equal(result.policy, policy);
      assert.equal(committed, staged); assert.equal(audits.length, 2); assert.equal(audits[1], stagedAudit);
      assert.deepEqual(events, ['preflight', 'begin', 'lock', 'current', 'update', 'audit', 'commit', 'policy']);
    }
    assert.equal(audits[0], previousAudit); assert.equal(terms[0], committed); assert.equal(terms[1], retained);
    assert.deepEqual(normalized, ['#Old', '#New']);
    assert.deepEqual(plain(before), { id, keyword: '#Old', normalizedKeyword: '#old', searchType: 'text',
      language: 'en', status: 'active', reason: 'retained current reason' });
    assert.equal(current.keyword, '#New'); assert.equal(input.type, 'hashtag');
    assert.equal(active, false); assert.equal(locked, false); assert.equal(rootWrites, 0);
    assert.equal(rootReads, 1); assert.equal(transactions, 1); assert.equal(locks, 1);
    assert.equal(currentReads, 1); assert.equal(updates, 1); assert.equal(auditCalls, 1);
  }
});
