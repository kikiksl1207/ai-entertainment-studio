'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ts = require(path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js'));
const { Decimal } = require(path.join(ROOT, 'server/node_modules/@prisma/client/runtime/library.js'));
const sourcePath = path.join(ROOT, 'server/src/fan-letters/fan-letters.service.ts');
const bytes = fs.readFileSync(sourcePath), suppliedSha = hash(bytes);
const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const tree = ts.createSourceFile(sourcePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
assert.equal(tree.parseDiagnostics.length, 0);
const classes = tree.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === 'FanLettersService');
assert.equal(classes.length, 1);
const names = ['updateReceivedLetterStatus', 'assertArtistOperator', 'fanLetterReplyBody',
  'fanLetterInclude', 'toFanLetterView', 'truncate'];
const methods = names.map(name => {
  const found = classes[0].members.filter(node => ts.isMethodDeclaration(node) && node.name.getText(tree) === name);
  assert.equal(found.length, 1, 'One genuine selected method: ' + name);
  assert.ok(found[0].body);
  return found[0].getText(tree);
});
const constructors = classes[0].members.filter(ts.isConstructorDeclaration);
assert.equal(constructors.length, 1);
const loggerFields = classes[0].members.filter(node => ts.isPropertyDeclaration(node) && node.name.getText(tree) === 'logger');
assert.ok(loggerFields.length <= 1);
const constants = ['FAN_LETTER_STATUSES', 'FAN_LETTER_REPLY_MAX_LENGTH', 'UUID_PATTERN'].map(name => {
  const found = tree.statements.filter(ts.isVariableStatement).flatMap(node => Array.from(node.declarationList.declarations))
    .filter(node => ts.isIdentifier(node.name) && node.name.text === name);
  assert.equal(found.length, 1, 'One genuine constant: ' + name);
  return 'const ' + found[0].getText(tree) + ';';
});
const selected = constants.join('\n') + '\nclass FanLettersService {\n' +
  loggerFields.map(node => node.getText(tree)).join('\n') + '\n' +
  constructors[0].getText(tree) + '\n' + methods.join('\n') +
  '\n}\nmodule.exports = FanLettersService;';
const compiled = ts.transpileModule(selected, { fileName: 'selected-fan-letter-reply.ts', reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
assert.equal((compiled.diagnostics || []).length, 0, 'Selected transpile only, not whole-server type proof');
const plain = value => JSON.parse(JSON.stringify(value));
const ids = Object.freeze({ operator: '10000000-0000-4000-8000-000000000001',
  sender: '10000000-0000-4000-8000-000000000002', artist: '10000000-0000-4000-8000-000000000003',
  letter: '10000000-0000-4000-8000-000000000004' });
const reply = 'Synthetic reply '.repeat(10).trim();
const include = {
  artist: { select: { id: true, slug: true, displayName: true, status: true } },
  sender: { select: { id: true, email: true, profile: { select: { displayName: true, publicHandle: true } } } },
  walletLedger: true
};
class BadRequestException extends Error {}
class ForbiddenException extends Error {}
class NotFoundException extends Error {}
function harness(mode = 'normal') {
  const calls = [], warnings = [], effects = [];
  let clock = 0, row;
  class TestDate extends Date {
    constructor(...args) { assert.equal(args.length, 0); super(Date.UTC(2026, 0, 1) + clock++); }
  }
  class Logger {
    constructor(context) { assert.equal(context, 'FanLettersService'); }
    warn(...args) {
      warnings.push(args);
      if (mode === 'notification-and-logger-reject') throw new Error('SYNTHETIC_LOGGER_REJECTION');
    }
  }
  const context = { module: { exports: {} }, Decimal, Date: TestDate, Logger,
    BadRequestException, ForbiddenException, NotFoundException };
  vm.runInNewContext(compiled.outputText, context, { filename: 'genuine-fan-letter-reply.js',
    timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
  const Service = context.module.exports;
  const identities = names.map(name => Service.prototype[name]);
  const fault = new Error('SYNTHETIC_NOTIFICATION_REJECTION');
  const updateFault = new Error('SYNTHETIC_UPDATE_REJECTION');
  row = { id: ids.letter, senderUserId: ids.sender, artistId: ids.artist, status: 'submitted',
    title: null, body: 'Synthetic original letter', replyBody: null, repliedAt: null, repliedByUserId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    amountLumina: new Decimal(30), moderationStatus: 'pending', walletLedgerId: 'synthetic-existing-ledger',
    artist: Object.freeze({ id: ids.artist, slug: 'synthetic-artist', displayName: 'Synthetic', status: 'active' }),
    sender: Object.freeze({ id: ids.sender, email: 'synthetic-private-sentinel', profile: { displayName: 'Synthetic fan', publicHandle: 'synthetic-fan' } }) };
  const initial = plain(row);
  const forbidden = () => { effects.push('unadmitted dependency'); throw new Error('UNADMITTED_DEPENDENCY'); };
  const allowed = members => new Proxy(Object.freeze(members), { get(target, name) {
    return Object.hasOwn(target, name) ? target[name] : forbidden();
  } });
  const prisma = allowed({
    fanLetter: allowed({
      async findUnique(request) {
        calls.push('read-letter'); assert.deepEqual(plain(request), { where: { id: ids.letter }, include });
        return row;
      },
      async update(request) {
        calls.push('update-attempt');
        assert.deepEqual(plain(request.where), { id: ids.letter });
        assert.deepEqual(plain(request.include), include);
        assert.equal(request.data.status, 'replied'); assert.equal(request.data.replyBody, reply);
        assert.equal(request.data.repliedByUserId, ids.operator);
        assert.ok(request.data.updatedAt instanceof TestDate); assert.ok(request.data.repliedAt instanceof TestDate);
        assert.deepEqual(Object.keys(request.data).sort(), ['status', 'replyBody', 'repliedAt', 'repliedByUserId', 'updatedAt'].sort());
        if (mode === 'update-reject') throw updateFault;
        row = { ...row, ...request.data }; calls.push('update-resolved');
        return row;
      }
    }),
    artistOperator: allowed({ async findFirst(request) {
      calls.push('operator');
      assert.deepEqual(plain(request), { where: { userId: ids.operator, artistId: ids.artist, status: 'active', revokedAt: null }, select: { id: true } });
      return mode === 'denied' ? null : { id: 'synthetic-operator-link' };
    } })
  });
  const notifications = allowed({ async createNotification(input) {
    calls.push('notification');
    try {
      assert.equal(row.status, 'replied'); assert.equal(row.replyBody, reply);
      assert.deepEqual(plain(input), { userId: ids.sender, type: 'fan_letter.reply', title: 'Fan letter reply arrived',
        body: reply.length > 120 ? reply.slice(0, 119) + '...' : reply, actorUserId: ids.operator,
        artistId: ids.artist, targetType: 'fan_letter', targetId: ids.letter });
    } catch (error) {
      effects.push('notification contract mismatch');
      throw error;
    }
    if (mode === 'notification-reject' || mode === 'notification-and-logger-reject') throw fault;
    return mode === 'suppressed' ? null : { id: 'synthetic-notification' };
  } });
  const service = new Service(prisma, notifications);
  const input = Object.freeze({ status: 'replied', replyBody: '  ' + reply + '  ' });
  return { service, calls, warnings, effects, input, initial, fault, updateFault, get row() { return row; },
    checkIdentities() { names.forEach((name, i) => assert.equal(Service.prototype[name], identities[i])); },
    async run(override) { return service.updateReceivedLetterStatus(ids.operator, ids.letter, override || input); } };
}
function checkView(result, h) {
  assert.equal(result.fanLetter.replyBody, reply);
  assert.equal(result.fanLetter.status, 'replied');
  assert.equal(result.fanLetter.amountLumina.toString(), '30');
  assert.equal(result.fanLetter.settlement.grossLumina.toString(), '30');
  assert.deepEqual(Object.keys(result.fanLetter.sender).sort(), ['id', 'displayName', 'publicHandle'].sort());
  assert.equal(result.fanLetter.sender.displayName, 'Synthetic fan');
  assert.equal(Object.hasOwn(result.fanLetter.sender, 'email'), false);
  assert.deepEqual(h.effects, []); h.checkIdentities();
  assert.equal(h.input.replyBody, '  ' + reply + '  ');
}
test('fan reply notification: successful and preference-suppressed alerts preserve the saved reply', async () => {
  for (const mode of ['normal', 'suppressed']) {
    const h = harness(mode), result = await h.run();
    assert.deepEqual(h.calls, ['read-letter', 'operator', 'update-attempt', 'update-resolved', 'notification']);
    assert.deepEqual(h.warnings, []); checkView(result, h);
  }
});
test('fan reply notification: rejected alert does not replace an already saved reply outcome', async () => {
  for (const mode of ['notification-reject', 'notification-and-logger-reject']) {
    const h = harness(mode);
    let result, failure;
    try { result = await h.run(); } catch (error) { failure = error; }
    assert.deepEqual(h.calls, ['read-letter', 'operator', 'update-attempt', 'update-resolved', 'notification']);
    assert.equal(h.row.replyBody, reply); assert.equal(h.row.status, 'replied');
    assert.equal(failure, undefined, 'A resolved reply update must not be reported as failed only because its alert failed');
    checkView(result, h);
    assert.deepEqual(h.warnings, [['FAN_LETTER_REPLY_NOTIFICATION_FAILED']]);
  }
});
test('fan reply notification: permission input and update failures remain failures without alert retry', async () => {
  const denied = harness('denied');
  await assert.rejects(denied.run(), ForbiddenException);
  assert.deepEqual(denied.calls, ['read-letter', 'operator']);
  assert.deepEqual(plain(denied.row), denied.initial);
  const invalid = harness();
  await assert.rejects(invalid.run({ status: 'replied', replyBody: ' ' }), BadRequestException);
  assert.deepEqual(invalid.calls, ['read-letter', 'operator']);
  assert.deepEqual(plain(invalid.row), invalid.initial);
  const update = harness('update-reject');
  await assert.rejects(update.run(), error => error === update.updateFault);
  assert.deepEqual(update.calls, ['read-letter', 'operator', 'update-attempt']);
  assert.deepEqual(plain(update.row), update.initial);
  for (const h of [denied, invalid, update]) {
    assert.deepEqual(h.warnings, []); assert.deepEqual(h.effects, []); h.checkIdentities();
  }
});
