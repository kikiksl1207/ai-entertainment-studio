'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const walletBytes = fs.readFileSync(path.join(ROOT, 'server/src/common/wallet-mutation-safety.ts'));
const ts = require(path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js'));
const { Decimal } = require(path.join(ROOT, 'server/node_modules/@prisma/client/runtime/library.js'));
const inputPath = path.join(ROOT, 'server/src/fan-letters/fan-letters.service.ts');
const bytes = fs.readFileSync(inputPath), inputSha = sha(bytes);
const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const tree = ts.createSourceFile(inputPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
assert.equal(tree.parseDiagnostics.length, 0);
const classes = tree.statements.filter(n => ts.isClassDeclaration(n) && n.name?.text === 'FanLettersService');
assert.equal(classes.length, 1);
const constants = tree.statements.filter(ts.isVariableStatement).map(n => n.getText(tree));
assert.equal(constants.length, 7);
const selected = constants.join('\n') + '\n' + classes[0].getText(tree) + '\nmodule.exports = FanLettersService;';
const walletTree = ts.createSourceFile('wallet.ts', new TextDecoder('utf-8', { fatal: true }).decode(walletBytes), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
assert.equal(walletTree.parseDiagnostics.length, 0);
const walletSelected = walletTree.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(walletTree)).join('\n');
function transpile(text) {
  const result = ts.transpileModule(text, { fileName: 'genuine-create-scope.ts', reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } });
  assert.equal((result.diagnostics || []).length, 0, 'Transpile scope, not whole server type');
  return result.outputText;
}
const compiled = transpile(selected), walletCompiled = transpile(walletSelected);
const plain = value => JSON.parse(JSON.stringify(value));
class BadRequestException extends Error {}
class ForbiddenException extends Error {}
class NotFoundException extends Error {}
class ConflictException extends Error {}
const ids = Object.freeze({ sender: '10000000-0000-4000-8000-000000000011',
  artist: '10000000-0000-4000-8000-000000000012', operator: '10000000-0000-4000-8000-000000000013',
  wallet: '10000000-0000-4000-8000-000000000014', ledger: '10000000-0000-4000-8000-000000000015',
  letter: '10000000-0000-4000-8000-000000000016' });
const body = 'Synthetic fan letter body '.repeat(8).trim(), key = 'synthetic-create-intent';
const include = { artist: { select: { id: true, slug: true, displayName: true, status: true } },
  sender: { select: { id: true, email: true, profile: { select: { displayName: true, publicHandle: true } } } }, walletLedger: true };
function harness(mode = 'normal') {
  const calls = [], effects = [], warnings = [], notifications = [], faults = {};
  const state = { balance: '100', ledger: null, letter: null, commits: 0, rollbacks: 0 };
  const artist = Object.freeze({ id: ids.artist, slug: 'synthetic-artist', displayName: 'Synthetic artist', status: 'active' });
  const sender = Object.freeze({ id: ids.sender, email: 'synthetic-not-exported', profile: { displayName: 'Synthetic fan', publicHandle: 'synthetic-fan' } });
  const date = new Date('2026-01-01T00:00:00.000Z');
  const fresh = () => ({ id: ids.letter, senderUserId: ids.sender, artistId: ids.artist, status: 'submitted',
    moderationStatus: 'pending', amountLumina: new Decimal(30), title: 'Synthetic title', body,
    replyBody: null, repliedAt: null, createdAt: date, updatedAt: date, walletLedgerId: ids.ledger,
    idempotencyKey: key, metadata: { retained: 'synthetic', priceLumina: '30', productSku: 'FAN_LETTER_BASIC_30L', settlementCandidate: true }, artist, sender });
  for (const name of ['notification', 'operator', 'ledger', 'logger']) faults[name] = new Error('SYNTHETIC_' + name.toUpperCase() + '_REJECTION');
  const check = fn => { try { fn(); } catch (error) { effects.push(error.message); throw error; } };
  const deny = () => { effects.push('unadmitted dependency'); throw new Error('UNADMITTED_DEPENDENCY'); };
  const allowed = object => new Proxy(Object.freeze(object), { get(target, name) { return Object.hasOwn(target, name) ? target[name] : deny(); } });
  if (mode.startsWith('replay')) {
    state.letter = fresh(); state.balance = '70'; state.ledger = { id: ids.ledger, referenceId: ids.letter };
    if (mode === 'replay-conflict') state.letter.body = body + ' conflict';
  }
  const original = plain(state);
  class Logger {
    constructor(context) { assert.equal(context, 'FanLettersService'); }
    warn(...args) { warnings.push(args); if (mode === 'logger-reject') throw faults.logger; }
  }
  const walletContext = { exports: {}, module: { exports: {} }, BadRequestException, ConflictException };
  walletContext.module.exports = walletContext.exports;
  vm.runInNewContext(walletCompiled, walletContext, { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
  const context = { exports: {}, module: { exports: {} }, Decimal, Date, Logger,
    Injectable: () => target => target, BadRequestException, ForbiddenException, NotFoundException, ConflictException,
    ...walletContext.module.exports };
  context.module.exports = context.exports;
  vm.runInNewContext(compiled, context, { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
  const Service = context.module.exports;
  const methods = Object.getOwnPropertyNames(Service.prototype).filter(n => n !== 'constructor');
  const identities = methods.map(n => Service.prototype[n]);
  const tx = allowed({
    fanLetter: allowed({
      async findUnique(request) { calls.push('intent'); check(() => assert.deepEqual(plain(request), { where: { idempotencyKey: key }, include })); return state.letter; },
      async create(request) {
        calls.push('create-letter');
        check(() => assert.deepEqual(plain(request), { data: { senderUserId: ids.sender, artistId: ids.artist, walletLedgerId: ids.ledger,
          amountLumina: '30', title: 'Synthetic title', body, idempotencyKey: key,
          metadata: { retained: 'synthetic', priceLumina: '30', productSku: 'FAN_LETTER_BASIC_30L', settlementCandidate: true } }, include }));
        state.letter = fresh(); return state.letter;
      }
    }),
    walletAccount: allowed({
      async findUnique(request) { calls.push('wallet'); check(() => assert.deepEqual(plain(request), { where: { userId_currencyCode: { userId: ids.sender, currencyCode: 'LUMINA' } } })); return { id: ids.wallet, status: mode === 'wallet-inactive' ? 'inactive' : 'active', cachedBalance: new Decimal(state.balance) }; },
      async updateMany(request) {
        calls.push('debit'); check(() => {
          assert.deepEqual(plain(request.where), { id: ids.wallet, cachedBalance: { gte: '30' } });
          assert.equal(request.data.cachedBalance.decrement.toString(), '30');
          assert.ok(request.data.updatedAt instanceof Date);
          assert.deepEqual(Object.keys(request.data).sort(), ['cachedBalance', 'updatedAt']);
        });
        if (mode === 'insufficient') return { count: 0 };
        state.balance = new Decimal(state.balance).minus(30).toString(); return { count: 1 };
      }
    }),
    walletLedger: allowed({
      async create(request) {
        calls.push('ledger'); check(() => assert.deepEqual(plain(request), { data: { walletAccountId: ids.wallet, direction: 'debit', amount: '30',
          ledgerType: 'fan_letter_spend', referenceType: 'fan_letter', idempotencyKey: 'fan-letter:' + key, memo: 'Fan letter to Synthetic artist' } }));
        if (mode === 'ledger-reject') throw faults.ledger;
        state.ledger = { id: ids.ledger, referenceId: null }; return state.ledger;
      },
      async update(request) { calls.push('ledger-link'); check(() => assert.deepEqual(plain(request), { where: { id: ids.ledger }, data: { referenceId: ids.letter } })); state.ledger.referenceId = ids.letter; return state.ledger; }
    })
  });
  const prisma = allowed({
    artist: allowed({ async findFirst(request) { calls.push('artist'); check(() => assert.deepEqual(plain(request), { where: { status: 'active', id: ids.artist }, select: { id: true, slug: true, displayName: true, status: true } })); return mode === 'artist-missing' ? null : artist; } }),
    artistOperator: allowed({ async findMany(request) {
      calls.push('operators'); check(() => {
        assert.equal(state.commits, 1, 'Operator lookup only after resolved commit');
        assert.deepEqual(plain(request), { where: { artistId: ids.artist, status: 'active', revokedAt: null }, select: { userId: true }, take: 20 });
      });
      if (mode === 'operator-reject') throw faults.operator;
      return [{ userId: ids.operator }];
    } }),
    async $transaction(callback) {
      calls.push('tx-start'); const before = { balance: state.balance, letter: state.letter, ledger: state.ledger };
      try { const result = await callback(tx); state.commits++; calls.push('tx-commit'); return result; }
      catch (error) { Object.assign(state, before); state.rollbacks++; calls.push('tx-rollback'); throw error; }
    }
  });
  const notificationService = allowed({ async createNotification(input) {
    calls.push('notification'); notifications.push(plain(input));
    check(() => {
      assert.equal(state.commits, 1); assert.equal(state.balance, '70');
      assert.equal(state.letter.id, ids.letter); assert.equal(state.ledger.referenceId, ids.letter);
      assert.deepEqual(plain(input), { userId: ids.operator, type: 'fan_letter.received', title: 'New fan letter',
        body: body.slice(0, 119) + '...', actorUserId: ids.sender, artistId: ids.artist, targetType: 'fan_letter', targetId: ids.letter });
    });
    if (mode === 'notification-reject' || mode === 'logger-reject') throw faults.notification;
    return mode === 'suppressed' ? null : { id: 'synthetic-alert' };
  } });
  const service = new Service(prisma, notificationService);
  const input = Object.freeze({ artistId: ids.artist, title: '  Synthetic title  ', body: '  ' + body + '  ', idempotencyKey: '  ' + key + '  ', metadata: Object.freeze({ retained: 'synthetic' }) });
  const inputBefore = plain(input);
  return { service, input, inputBefore, state, original, calls, effects, warnings, notifications, faults,
    run(override) { return service.createFanLetter(ids.sender, override || input); },
    checkIdentity() { methods.forEach((n, i) => assert.equal(Service.prototype[n], identities[i])); assert.deepEqual(plain(input), inputBefore); assert.deepEqual(effects, []); } };
}
function checkSaved(result, h) {
  assert.equal(result.idempotentReplay, false); assert.equal(result.fanLetter.id, ids.letter);
  assert.equal(result.fanLetter.amountLumina.toString(), '30'); assert.equal(result.fanLetter.settlement.grossLumina.toString(), '30');
  assert.equal(result.fanLetter.body, body); assert.equal(result.fanLetter.title, 'Synthetic title');
  assert.equal(Object.hasOwn(result.fanLetter.sender, 'email'), false);
  assert.equal(h.state.balance, '70'); assert.equal(h.state.commits, 1); assert.equal(h.state.rollbacks, 0);
  assert.equal(h.state.ledger.referenceId, ids.letter); assert.equal(h.calls.filter(x => x === 'debit').length, 1);
  h.checkIdentity();
}
test('fan create notification: normal and preference-suppressed collaborator return saved create outcome', async () => {
  for (const mode of ['normal', 'suppressed']) {
    const h = harness(mode), result = await h.run(); checkSaved(result, h);
    assert.deepEqual(h.calls, ['artist', 'tx-start', 'intent', 'wallet', 'debit', 'ledger', 'create-letter', 'ledger-link', 'tx-commit', 'operators', 'notification']);
    assert.deepEqual(h.warnings, []); assert.equal(h.notifications.length, 1);
  }
});
test('fan create notification: post-commit alert failures do not replace saved create outcome', async () => {
  for (const mode of ['notification-reject', 'operator-reject', 'logger-reject']) {
    const h = harness(mode); let result, error;
    try { result = await h.run(); } catch (caught) { error = caught; }
    assert.equal(h.state.commits, 1); assert.equal(h.state.balance, '70'); assert.equal(h.state.letter.id, ids.letter);
    const trace = ['artist', 'tx-start', 'intent', 'wallet', 'debit', 'ledger', 'create-letter', 'ledger-link', 'tx-commit', 'operators'];
    if (mode !== 'operator-reject') trace.push('notification');
    assert.deepEqual(h.calls, trace);
    h.checkIdentity();
    assert.equal(h.notifications.length, mode === 'operator-reject' ? 0 : 1);
    assert.equal(error, undefined, 'Already committed result must not become alert failure');
    checkSaved(result, h); assert.deepEqual(h.warnings, [['FAN_LETTER_CREATE_NOTIFICATION_FAILED']]);
    assert.equal(h.notifications.length, mode === 'operator-reject' ? 0 : 1);
  }
});
test('fan create notification: original validation rollback and exact replay boundaries remain', async () => {
  for (const mode of ['artist-missing', 'wallet-inactive', 'insufficient', 'ledger-reject', 'replay-conflict']) {
    const h = harness(mode); let error;
    try { await h.run(); } catch (caught) { error = caught; }
    assert.ok(error); if (mode === 'ledger-reject') assert.equal(error, h.faults.ledger);
    else assert.equal(error.constructor.name, mode === 'artist-missing' ? 'NotFoundException' : mode === 'replay-conflict' ? 'ConflictException' : 'BadRequestException');
    assert.equal(h.state.balance, h.original.balance); assert.equal(h.state.commits, 0);
    assert.equal(h.state.rollbacks, mode === 'artist-missing' ? 0 : 1);
    assert.deepEqual(plain(h.state.letter), h.original.letter); assert.deepEqual(plain(h.state.ledger), h.original.ledger);
    assert.deepEqual(h.notifications, []); assert.deepEqual(h.warnings, []); h.checkIdentity();
  }
  for (const change of [{ body: 'short' }, { idempotencyKey: '' }]) {
    const h = harness(); await assert.rejects(h.run({ ...h.input, ...change }), BadRequestException);
    assert.deepEqual(h.calls, ['artist']); assert.equal(h.state.balance, '100'); h.checkIdentity();
  }
  const h = harness('replay'), result = await h.run();
  assert.equal(result.idempotentReplay, true); assert.equal(result.fanLetter.id, ids.letter);
  assert.equal(h.state.balance, '70'); assert.equal(h.state.commits, 1);
  assert.deepEqual(h.calls, ['artist', 'tx-start', 'intent', 'tx-commit']);
  assert.deepEqual(h.notifications, []); assert.deepEqual(h.warnings, []); h.checkIdentity();
});
process.on('exit', () => assert.equal(sha(fs.readFileSync(inputPath)), inputSha, 'Closing selected source pin'));
