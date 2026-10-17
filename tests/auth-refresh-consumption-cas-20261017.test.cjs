'use strict';
// Portable CI admission; the nine D32 method fixtures/oracles are unchanged.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');
const { isDeepStrictEqual } = require('node:util');
const { createContext, runInContext } = require('node:vm');

const PINS = [
  { variant: 'candidate', size: 116170,
    sha: '98cfc8bc8c671ca28e8d782d1aeff2fbd67bddb82fca82bf0befe0eecb3f5ae0',
    blob: 'e68ff4d0a7db324dfa2f69bc3c15b7b50aaae4a2', methodSize: 1917,
    methodSHA: '82ec2fbf9a99cac96f8a29c978aa319200a202520c03ed4f9a3e872ca698e3b0' },
];
const PARSER = { size: 9112572,
  sha: '3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675' };
const INVALID = 'Invalid or expired refresh token';
const NOW = 2000000000000;
const INPUT = 'synthetic-refresh-argument';
const USER = 'synthetic-user';
const ROW = 'synthetic-tracked-row';
const HASH = 'synthetic-tracked-hash';
const norm = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let variant;
let program;

function pinned(file, allowed, canonicalSource = false) {
  assert.equal(typeof file === 'string' && path.isAbsolute(file), true, 'INPUT_ABSOLUTE');
  const real = fs.realpathSync.native(file);
  assert.equal(norm(real), norm(file), 'INPUT_EXACT_REALPATH');
  const stat = fs.statSync(real);
  const cap = Math.max(...allowed.map(pin => pin.size)) * (canonicalSource ? 2 : 1);
  assert.equal(stat.isFile() && stat.size > 0 && stat.size <= cap, true, 'INPUT_BOUNDED_REGULAR_SIZE');
  const raw = fs.readFileSync(real);
  assert.equal(raw.length, stat.size, 'INPUT_READ_SIZE');
  let bytes = raw;
  if (canonicalSource) {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    assert.equal(text.startsWith('\uFEFF'), false, 'INPUT_NO_BOM');
    assert.equal(Buffer.from(text, 'utf8').equals(raw), true, 'INPUT_RAW_UTF8_ROUNDTRIP');
    const withoutPairs = text.replace(/\r\n/g, '');
    assert.equal(withoutPairs.includes('\r'), false, 'INPUT_NO_BARE_CR');
    assert.equal(text.includes('\r\n') && withoutPairs.includes('\n'), false, 'INPUT_UNIFORM_EOL');
    bytes = Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8');
  }
  const pin = allowed.find(item => item.size === bytes.length && item.sha === sha(bytes));
  assert.equal(Boolean(pin), true, 'INPUT_EXACT_SIZE_SHA');
  return { real, bytes, pin };
}

function extract(ts, source, pin) {
  const file = ts.createSourceFile('auth.service.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(file.parseDiagnostics.length, 0, 'SOURCE_PARSE_CLEAN');
  const classes = file.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === 'AuthService');
  assert.equal(classes.length, 1, 'ONE_ACTUAL_AUTH_SERVICE');
  const methods = classes[0].members.filter(node => ts.isMethodDeclaration(node)
    && ts.isIdentifier(node.name) && node.name.text === 'refresh');
  assert.equal(methods.length, 1, 'ONE_ACTUAL_REFRESH_METHOD');
  const method = methods[0];
  assert.equal(Boolean(method.body), true, 'ACTUAL_REFRESH_BODY');
  assert.equal(method.modifiers.some(item => item.kind === ts.SyntaxKind.AsyncKeyword), true, 'ACTUAL_ASYNC_METHOD');
  assert.deepEqual(method.parameters.map(item => item.name.getText(file)),
    ['refreshToken', 'sessionContext'], 'ACTUAL_REFRESH_PARAMETERS');
  const imports = file.statements.filter(ts.isImportDeclaration).flatMap(node => {
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return [];
    return bindings.elements.filter(item => item.name.text === 'UnauthorizedException')
      .map(item => [node.moduleSpecifier.text, item.propertyName?.text ?? item.name.text]);
  });
  assert.deepEqual(imports, [['@nestjs/common', 'UnauthorizedException']], 'ACTUAL_EXCEPTION_IMPORT');
  const exact = method.getText(file);
  assert.equal(Buffer.byteLength(exact), pin.methodSize, 'EXACT_METHOD_SIZE');
  assert.equal(sha(Buffer.from(exact)), pin.methodSHA, 'EXACT_METHOD_SHA');
  const selected = 'class RefreshOnly {\n' + exact + '\n}\nexports.refresh = RefreshOnly.prototype.refresh;\n';
  const emitted = ts.transpileModule(selected, { fileName: 'refresh-only.ts', reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  assert.equal((emitted.diagnostics || []).length, 0, 'ISOLATED_SYNTAX_EMIT_CLEAN');
  return emitted.outputText;
}

before(() => {
  assert.equal(process.argv.length, 2, 'INPUT_FILENAME_ONLY');
  assert.equal(typeof process.argv[1], 'string', 'INPUT_FILENAME_REQUIRED');
  assert.equal(norm(process.argv[1]), norm(__filename), 'INPUT_EXACT_TEST_FILENAME');
  assert.equal(norm(fs.realpathSync.native(__filename)), norm(__filename), 'INPUT_TEST_REALPATH');
  const service = pinned(path.resolve(__dirname, '../server/src/auth/auth.service.ts'), PINS, true);
  const parser = pinned(path.resolve(__dirname, '../server/node_modules/typescript/lib/typescript.js'), [PARSER]);
  const blob = createHash('sha1').update('blob ' + service.bytes.length + '\0').update(service.bytes).digest('hex');
  assert.equal(blob, service.pin.blob, 'INPUT_EXACT_GIT_BLOB');
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(service.bytes);
  assert.equal(source.startsWith('\uFEFF') || source.includes('\r'), false, 'INPUT_LF_NO_BOM');
  assert.equal(Buffer.from(source).equals(service.bytes), true, 'INPUT_UTF8_ROUNDTRIP');
  variant = service.pin.variant;
  program = extract(require(parser.real), source, service.pin);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(options = {}) {
  const counts = { fixtureFaults: 0, verified: 0, userReads: 0, rowReads: 0,
    unconditionalWrites: 0, conditionalWrites: 0, conditionalMatches: 0,
    getMeCalls: 0, issueCalls: 0, responseCalls: 0 };
  const events = [];
  const row = { id: ROW, userId: USER, tokenHash: HASH, revokedAt: options.alreadyRevoked ? new Date(NOW - 1) : null,
    expiresAt: new Date(NOW + 60000), lastUsedAt: null };
  const secretMarker = Object.freeze({ syntheticConfigurationValue: true });
  const session = Object.freeze({ syntheticSessionContext: true });
  const me = Object.freeze({ syntheticMe: true });
  const issued = Object.freeze({ syntheticIssuedResult: true });
  const response = Object.freeze({ syntheticAuthResponse: true });
  const writeFailure = new Error('SYNTHETIC_WRITE_FAILURE');
  const mintFailure = new Error('SYNTHETIC_MINT_FAILURE');
  const gate = deferred();
  const snapshots = [];
  let interpositions = 0;
  function check(value) {
    if (value) return;
    counts.fixtureFaults++;
    throw new Error('FIXTURE_CONTRACT');
  }
  function same(actual, expected) {
    // Request literals originate in the isolated VM; compare their data, not realm prototypes.
    check(isDeepStrictEqual(JSON.parse(JSON.stringify(actual)), expected));
  }
  function only(object, keys) { same(Object.keys(object).sort(), [...keys].sort()); }
  function guarded(object) {
    return new Proxy(object, { get(target, key) {
      check(Object.hasOwn(target, key));
      return target[key];
    } });
  }
  function snapshot() {
    return { ...row, revokedAt: row.revokedAt === null ? null : new Date(row.revokedAt.getTime()),
      expiresAt: new Date(row.expiresAt.getTime()),
      lastUsedAt: row.lastUsedAt === null ? null : new Date(row.lastUsedAt.getTime()) };
  }
  function interpose() {
    if (!options.interpose) return;
    check(interpositions === 0);
    interpositions++;
    if (options.interpose === 'revoke') row.revokedAt = new Date(NOW - 1);
    else if (options.interpose === 'expiry') row.expiresAt = new Date(NOW);
    else if (options.interpose === 'hash') row.tokenHash = 'synthetic-replaced-hash';
    else if (options.interpose === 'user') row.userId = 'synthetic-replaced-user';
    else check(false);
  }
  function writeData(data, conditional) {
    only(data, ['revokedAt', 'lastUsedAt']);
    check(data.revokedAt instanceof Date && data.lastUsedAt instanceof Date);
    check(data.revokedAt.getTime() === NOW && data.lastUsedAt.getTime() === NOW);
    if (conditional) check(data.revokedAt === data.lastUsedAt);
  }
  class UnauthorizedException extends Error {
    constructor(message) { super(message); this.name = 'UnauthorizedException'; }
    getStatus() { return 401; }
  }
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  }
  const service = {
    configService: guarded({ getOrThrow(key) {
      check(key === 'JWT_REFRESH_SECRET');
      return secretMarker;
    } }),
    jwtService: guarded({ async verifyAsync(input, optionsArgument) {
      counts.verified++; events.push('verify');
      check(input === INPUT);
      only(optionsArgument, ['secret']);
      check(optionsArgument.secret === secretMarker);
      return { sub: USER, tokenType: 'refresh', tokenId: ROW };
    } }),
    prisma: guarded({
      user: guarded({ async findFirst(args) {
        counts.userReads++; events.push('user');
        same(args, { where: { id: USER, status: 'active', deletedAt: null } });
        return { id: USER, email: 'synthetic-email-marker' };
      } }),
      userRefreshToken: guarded({
        async findUnique(args) {
          counts.rowReads++; events.push('row');
          same(args, { where: { id: ROW } });
          const captured = snapshot();
          snapshots.push(captured);
          if (options.dualReads) {
            check(counts.rowReads <= 2);
            if (counts.rowReads === 2) gate.resolve();
            await gate.promise;
          }
          return captured;
        },
        async update(args) {
          counts.unconditionalWrites++; events.push('update');
          check(variant === 'original');
          only(args, ['where', 'data']);
          same(args.where, { id: ROW });
          writeData(args.data, false);
          interpose();
          if (options.writeFailure) throw writeFailure;
          row.revokedAt = args.data.revokedAt;
          row.lastUsedAt = args.data.lastUsedAt;
          return snapshot();
        },
        async updateMany(args) {
          counts.conditionalWrites++; events.push('updateMany');
          check(variant === 'candidate');
          only(args, ['where', 'data']);
          only(args.where, ['id', 'userId', 'tokenHash', 'revokedAt', 'expiresAt']);
          check(args.where.id === ROW && args.where.userId === USER && args.where.tokenHash === HASH);
          check(args.where.revokedAt === null);
          only(args.where.expiresAt, ['gt']);
          check(args.where.expiresAt.gt instanceof Date && args.where.expiresAt.gt.getTime() === NOW);
          writeData(args.data, true);
          check(args.where.expiresAt.gt === args.data.revokedAt);
          interpose();
          if (options.writeFailure) throw writeFailure;
          // One synchronous compare+write models a conditional ORM statement, not a DB engine.
          const match = row.id === args.where.id && row.userId === args.where.userId
            && row.tokenHash === args.where.tokenHash && row.revokedAt === null
            && row.expiresAt > args.where.expiresAt.gt;
          if (match) {
            counts.conditionalMatches++;
            row.revokedAt = args.data.revokedAt;
            row.lastUsedAt = args.data.lastUsedAt;
          }
          return { count: match ? 1 : 0 };
        },
      }),
    }),
    hashToken(input) { check(input === INPUT); return HASH; },
    async getMe(id) {
      counts.getMeCalls++; events.push('getMe');
      check(id === USER && row.revokedAt instanceof Date);
      return me;
    },
    async issueTokens(id, email, parent, context) {
      counts.issueCalls++; events.push('issue');
      check(id === USER && email === 'synthetic-email-marker' && parent === ROW && context === session);
      check(row.revokedAt instanceof Date);
      if (options.mintFailure) throw mintFailure;
      return issued;
    },
    authResponse(actualMe, actualIssued) {
      counts.responseCalls++; events.push('response');
      check(actualMe === me && actualIssued === issued);
      return response;
    },
  };
  const context = createContext({ exports: {}, UnauthorizedException, Date: FixtureDate });
  runInContext(program, context, { timeout: 1000 });
  check(typeof context.exports.refresh === 'function');
  return { counts, events, row, snapshots, response, writeFailure, mintFailure,
    UnauthorizedException, interpositions: () => interpositions,
    call: () => context.exports.refresh.call(service, INPUT, session) };
}

async function settled(call) {
  try { return { status: 'fulfilled', value: await call() }; }
  catch (reason) { return { status: 'rejected', reason }; }
}

function healthy(f) { assert.equal(f.counts.fixtureFaults, 0, 'NO_FIXTURE_FAULT'); }
function fulfilled(f, result) {
  assert.equal(result.status, 'fulfilled', 'NORMAL_RESPONSE_FULFILLED');
  assert.equal(result.value, f.response, 'EXACT_RESPONSE_IDENTITY');
}
function unauthorized(f, result) {
  assert.equal(result.status, 'rejected', 'EXACT_UNAUTHORIZED_REJECTION');
  assert.equal(result.reason instanceof f.UnauthorizedException, true, 'EXACT_UNAUTHORIZED_CLASS');
  assert.equal(result.reason.name, 'UnauthorizedException', 'EXACT_UNAUTHORIZED_NAME');
  assert.equal(result.reason.message, INVALID, 'EXACT_UNAUTHORIZED_MESSAGE');
  assert.equal(result.reason.getStatus(), 401, 'EXACT_UNAUTHORIZED_STATUS');
}
function writes(f, expected) {
  assert.equal(f.counts.unconditionalWrites, variant === 'original' ? expected : 0, 'EXACT_UPDATE_COUNT');
  assert.equal(f.counts.conditionalWrites, variant === 'candidate' ? expected : 0, 'EXACT_CAS_COUNT');
}
function effects(f, expected) {
  assert.equal(f.counts.getMeCalls, expected, 'EXACT_GET_ME_COUNT');
  assert.equal(f.counts.issueCalls, expected, 'EXACT_ISSUE_COUNT');
  assert.equal(f.counts.responseCalls, expected, 'EXACT_RESPONSE_COUNT');
}
function reads(f, expected) {
  assert.equal(f.counts.verified, expected, 'EXACT_VERIFY_COUNT');
  assert.equal(f.counts.userReads, expected, 'EXACT_USER_READ_COUNT');
  assert.equal(f.counts.rowReads, expected, 'EXACT_ROW_READ_COUNT');
}
function consumed(f) {
  assert.equal(f.row.revokedAt?.getTime(), NOW, 'EXACT_CONSUMED_AT');
  assert.equal(f.row.lastUsedAt?.getTime(), NOW, 'EXACT_LAST_USED_AT');
}
function diagnostic(name, f, results, semanticOriginalWitness = false) {
  healthy(f);
  console.log(JSON.stringify({ contract: 'refresh-consumption-cas-v1', variant, case: name,
    semanticOriginalWitness, ...f.counts,
    fulfilled: results.filter(item => item.status === 'fulfilled').length,
    rejected: results.filter(item => item.status === 'rejected').length }));
}

test('concurrent-dual-read-single-consumer', { concurrency: false }, async () => {
  const f = fixture({ dualReads: true });
  const results = await Promise.allSettled([f.call(), f.call()]);
  healthy(f); reads(f, 2); writes(f, 2); consumed(f);
  assert.equal(f.snapshots.length, 2, 'TWO_SNAPSHOTS_CAPTURED');
  assert.equal(f.snapshots.every(row => row.revokedAt === null && row.expiresAt.getTime() > NOW), true,
    'BOTH_READS_PRECEDE_ANY_CONSUMPTION');
  if (variant === 'original') {
    results.forEach(result => fulfilled(f, result));
    effects(f, 2);
    assert.equal(f.counts.conditionalMatches, 0, 'ORIGINAL_NO_CAS');
  } else {
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'ONE_CAS_FULFILLMENT');
    fulfilled(f, results.find(result => result.status === 'fulfilled'));
    unauthorized(f, results.find(result => result.status === 'rejected'));
    effects(f, 1);
    assert.equal(f.counts.conditionalMatches, 1, 'ONE_CAS_MATCH');
  }
  diagnostic('concurrent-dual-read-single-consumer', f, results, variant === 'original');
  // Original reaches this assertion only after two exact normal completions and two issues.
  assert.equal(f.counts.issueCalls, 1, 'SINGLE_REFRESH_ROW_HAS_ONE_SUCCESSOR');
});

test('normal-single-consumption', { concurrency: false }, async () => {
  const f = fixture();
  const result = await settled(f.call);
  healthy(f); fulfilled(f, result); reads(f, 1); writes(f, 1); effects(f, 1); consumed(f);
  assert.equal(f.counts.conditionalMatches, variant === 'candidate' ? 1 : 0, 'NORMAL_CAS_MATCH');
  assert.deepEqual(f.events, ['verify', 'user', 'row', variant === 'candidate' ? 'updateMany' : 'update',
    'getMe', 'issue', 'response'], 'NORMAL_CONSUME_BEFORE_RESPONSE_ORDER');
  diagnostic('normal-single-consumption', f, [result]);
});

test('already-revoked-no-write', { concurrency: false }, async () => {
  const f = fixture({ alreadyRevoked: true });
  const result = await settled(f.call);
  healthy(f); unauthorized(f, result); reads(f, 1); writes(f, 0); effects(f, 0);
  assert.equal(f.row.revokedAt.getTime(), NOW - 1, 'PREEXISTING_REVOCATION_UNCHANGED');
  assert.equal(f.row.lastUsedAt, null, 'PREEXISTING_LAST_USED_UNCHANGED');
  diagnostic('already-revoked-no-write', f, [result]);
});

const INTERPOSED = [
  ['interposed-revoke-no-successor', 'revoke', 'INTERPOSED_REVOKE_HAS_NO_SUCCESSOR'],
  ['interposed-expiry-no-successor', 'expiry', 'INTERPOSED_EXPIRY_HAS_NO_SUCCESSOR'],
  ['interposed-hash-change-no-successor', 'hash', 'INTERPOSED_HASH_CHANGE_HAS_NO_SUCCESSOR'],
  ['interposed-user-change-no-successor', 'user', 'INTERPOSED_USER_CHANGE_HAS_NO_SUCCESSOR'],
];
for (const [name, mutation, marker] of INTERPOSED) {
  test(name, { concurrency: false }, async () => {
    const f = fixture({ interpose: mutation });
    const result = await settled(f.call);
    healthy(f); reads(f, 1); writes(f, 1);
    assert.equal(f.interpositions(), 1, 'ONE_INTERPOSED_ROW_CHANGE');
    assert.equal(f.snapshots[0].revokedAt, null, 'VALID_READ_SNAPSHOT_UNREVOKED');
    assert.equal(f.snapshots[0].expiresAt.getTime(), NOW + 60000, 'VALID_READ_SNAPSHOT_UNEXPIRED');
    assert.equal(f.snapshots[0].tokenHash === HASH && f.snapshots[0].userId === USER, true,
      'VALID_READ_SNAPSHOT_HASH_AND_USER');
    if (mutation === 'expiry') assert.equal(f.row.expiresAt.getTime(), NOW, 'LIVE_EXPIRY_CHANGED');
    if (mutation === 'hash') assert.equal(f.row.tokenHash, 'synthetic-replaced-hash', 'LIVE_HASH_CHANGED');
    if (mutation === 'user') assert.equal(f.row.userId, 'synthetic-replaced-user', 'LIVE_USER_CHANGED');
    if (variant === 'original') {
      fulfilled(f, result); effects(f, 1); consumed(f);
    } else {
      unauthorized(f, result); effects(f, 0);
      assert.equal(f.row.lastUsedAt, null, 'LOSER_HAS_NO_CONSUMPTION_WRITE');
      assert.equal(f.row.revokedAt?.getTime() ?? null, mutation === 'revoke' ? NOW - 1 : null,
        'INTERPOSED_REVOCATION_PRESERVED');
    }
    assert.equal(f.counts.conditionalMatches, 0, 'INTERPOSED_NO_CAS_MATCH');
    diagnostic(name, f, [result], variant === 'original');
    // Original witness is normal fulfillment plus exact stale mint, never an arbitrary throw.
    assert.equal(f.counts.issueCalls, 0, marker);
  });
}

test('conditional-write-error-no-mint', { concurrency: false }, async () => {
  const f = fixture({ writeFailure: true });
  const result = await settled(f.call);
  healthy(f); reads(f, 1); writes(f, 1); effects(f, 0);
  assert.equal(result.status, 'rejected', 'WRITE_FAILURE_REJECTED');
  assert.equal(result.reason, f.writeFailure, 'EXACT_WRITE_FAILURE_IDENTITY');
  assert.equal(f.row.revokedAt, null, 'FAILED_WRITE_DID_NOT_CONSUME');
  assert.equal(f.row.lastUsedAt, null, 'FAILED_WRITE_DID_NOT_TOUCH_LAST_USED');
  assert.equal(f.counts.conditionalMatches, 0, 'FAILED_WRITE_NO_MATCH_REPORTED');
  diagnostic('conditional-write-error-no-mint', f, [result]);
});

test('mint-failure-consumed-no-retry', { concurrency: false }, async () => {
  const f = fixture({ mintFailure: true });
  const first = await settled(f.call);
  healthy(f); reads(f, 1); writes(f, 1); consumed(f);
  assert.equal(first.status, 'rejected', 'MINT_FAILURE_REJECTED');
  assert.equal(first.reason, f.mintFailure, 'EXACT_MINT_FAILURE_IDENTITY');
  assert.equal(f.counts.getMeCalls, 1, 'MINT_FAILURE_GET_ME_ONCE');
  assert.equal(f.counts.issueCalls, 1, 'MINT_FAILURE_NOT_AUTOMATICALLY_RETRIED');
  assert.equal(f.counts.responseCalls, 0, 'MINT_FAILURE_NO_SUCCESS_RESPONSE');
  const second = await settled(f.call);
  healthy(f); unauthorized(f, second); reads(f, 2); writes(f, 1); consumed(f);
  assert.equal(f.counts.getMeCalls, 1, 'EXPLICIT_REUSE_NO_GET_ME');
  assert.equal(f.counts.issueCalls, 1, 'EXPLICIT_REUSE_NO_SECOND_MINT');
  assert.equal(f.counts.responseCalls, 0, 'EXPLICIT_REUSE_NO_RESPONSE');
  assert.equal(f.counts.conditionalMatches, variant === 'candidate' ? 1 : 0, 'MINT_FAILURE_CONSUMPTION_RETAINED');
  diagnostic('mint-failure-consumed-no-retry', f, [first, second]);
});
