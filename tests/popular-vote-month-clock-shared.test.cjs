'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const SOURCE = 'server/src/popular-vote/popular-vote.service.ts';
const SUITE = 'tests/popular-vote-month-clock-shared.test.cjs';
const GROUPS = Object.freeze([
  'WHOLE_MODULE_SYNTAX', 'ONE_PREAWAIT_SHARED_CLOCK',
  'CAMPAIGN_PARAMETER_BINDING', 'KST_CALENDAR_INPUT_BINDING',
]);
const BASELINE_FAILURES = Object.freeze([
  'ONE_PREAWAIT_SHARED_CLOCK', 'CAMPAIGN_PARAMETER_BINDING', 'KST_CALENDAR_INPUT_BINDING',
]);
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const canonical = p => path.resolve(p).toLowerCase();
const checks = new Map();
const initialCache = new Set(Object.keys(require.cache));
const owned = process.argv.length !== 2;
let admission, deadline, tsEntry, packageFile, sourceFile, guard, program;
function ordinary(file) {
  assert(fs.lstatSync(file).isFile());
  for (let p = path.resolve(file); ; p = path.dirname(p)) {
    assert(!fs.lstatSync(p).isSymbolicLink());
    if (path.dirname(p) === p) break;
  }
  assert.equal(canonical(fs.realpathSync.native(file)), canonical(file));
}
function read(row) {
  assert(row && typeof row.path === 'string' && Number.isSafeInteger(row.bytes) && row.bytes >= 0);
  assert(typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sha256));
  ordinary(row.path);
  const bytes = fs.readFileSync(row.path);
  assert.equal(bytes.length, row.bytes);
  assert.equal(digest(bytes), row.sha256);
  const prior = checks.get(canonical(row.path));
  if (prior) assert.deepEqual([prior.bytes, prior.sha256], [row.bytes, row.sha256]);
  checks.set(canonical(row.path), row);
  return bytes;
}
function capture(file) {
  ordinary(file);
  const bytes = fs.readFileSync(file);
  return read({ path: file, bytes: bytes.length, sha256: digest(bytes) });
}
function fresh() {
  if (owned) assert(Date.now() < deadline, 'AST_DEADLINE');
}
function declare(row) {
  const matches = admission.pins.filter(p => canonical(p.path) === canonical(row.path));
  assert.equal(matches.length, 1);
  assert.deepEqual([matches[0].bytes, matches[0].sha256], [row.bytes, row.sha256]);
  return read(row);
}
let rawAdmission = Buffer.alloc(0), sourceBytes, oracleBytes;
if (owned) {
  assert.equal(process.argv.length, 4);
  assert(/^[a-f0-9]{64}$/.test(process.argv[3]));
  ordinary(process.argv[2]);
  rawAdmission = fs.readFileSync(process.argv[2]);
  assert(rawAdmission.length <= 32768);
  assert.equal(digest(rawAdmission), process.argv[3]);
  admission = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawAdmission));
  assert.equal(admission.contract, 'popular-vote-month-clock-shared-admission-v1');
  assert(['baseline', 'candidate'].includes(admission.mode));
  deadline = admission.deadlineUtcMs;
  assert(Number.isSafeInteger(deadline) && Date.now() < deadline && deadline <= Date.now() + 120000);
  assert.equal(process.platform, 'win32');
  assert.equal(process.version, 'v22.14.0');
  assert(/^E:\\/i.test(path.resolve(admission.runRoot)));
  assert(/^owned-ast-first-[a-f0-9]{12}$/.test(path.basename(admission.runRoot)));
  assert.equal(canonical(path.dirname(process.argv[2])), canonical(admission.runRoot));
  assert(/^E:\\/i.test(path.resolve(admission.repositoryRoot)));
  assert(Array.isArray(admission.pins) && admission.pins.length <= 32);
  assert.equal(new Set(admission.pins.map(r => canonical(r.path))).size, admission.pins.length);
  for (const row of admission.pins) {
    assert(/^E:\\/i.test(path.resolve(row.path)));
    read(row);
  }
  assert(Array.isArray(admission.primary) && admission.primary.length === 2);
  function primary(repoPath) {
    const rows = admission.primary.filter(r => r.repoPath === repoPath);
    assert.equal(rows.length, 1);
    assert.equal(canonical(rows[0].path), canonical(path.join(admission.runRoot, repoPath)));
    return rows[0];
  }
  const source = primary(SOURCE), oracle = primary(SUITE);
  assert.equal(canonical(oracle.path), canonical(__filename));
  sourceFile = source.path;
  sourceBytes = declare(source);
  oracleBytes = declare(oracle);
  const standard = (row, relative, bytes, sha256) => {
    assert.equal(canonical(row.path), canonical(path.join(admission.repositoryRoot, relative)));
    assert.deepEqual([row.bytes, row.sha256], [bytes, sha256]);
    declare(row);
    return row.path;
  };
  tsEntry = standard(admission.typescript.entry, 'server/node_modules/typescript/lib/typescript.js',
    9112572, '3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675');
  packageFile = standard(admission.typescript.package, 'server/node_modules/typescript/package.json',
    3620, '822ef7ca6452205657b6288b066481ecf508bfbf43455d715cf7d3ec457561e6');
  standard(admission.guard, 'server/scripts/release-qa-guards.cjs',
    3480, '677eae3cfc1c9ad809557f4db5aa984683b5cd65d65bf92f64ebb1bcee2807eb');
  assert.equal(canonical(admission.node.path), canonical(path.join(path.parse(admission.runRoot).root, 'Program Files/nodejs/node.exe')));
  assert.equal(canonical(process.execPath), canonical(admission.node.path));
  assert.deepEqual([admission.node.bytes, admission.node.sha256],
    [83344536, '33b1bc1a8aca11fd5a4f2699e51019c63c0af30cf437701d07af69be7706771b']);
  declare(admission.node);
  assert.deepEqual([admission.preload.bytes, admission.preload.sha256],
    [420, 'eff655db3067b583cf57208f4f607f6255ac7fa52fe162ba67c8b301eb4cd327']);
  declare(admission.preload);
  assert.deepEqual(process.execArgv, ['--require', admission.preload.path]);
  assert(require.cache[require.resolve(admission.preload.path)]);
  assert(require.cache[require.resolve(admission.guard.path)]);
  assert.equal(canonical(process.env.RELEASE_QA_GUARD_REPORT || ''), canonical(path.join(admission.runRoot, 'guards.json')));
  guard = require(admission.guard.path);
  assert.deepEqual(guard.stats, { blockedEnvReads: 0, blockedWrites: 0, blockedNetwork: 0 });
  checks.set(canonical(process.argv[2]), { path: process.argv[2], bytes: rawAdmission.length, sha256: process.argv[3] });
} else {
  const root = path.resolve(__dirname, '..');
  sourceFile = path.join(root, SOURCE);
  tsEntry = path.join(root, 'server/node_modules/typescript/lib/typescript.js');
  packageFile = path.join(root, 'server/node_modules/typescript/package.json');
  sourceBytes = capture(sourceFile);
  oracleBytes = capture(__filename);
  capture(tsEntry);
  capture(packageFile);
}
program = { source: sourceBytes.length, oracle: oracleBytes.length, admission: rawAdmission.length };
program.total = program.source + program.oracle + program.admission;
program.limit = 64000;
assert(program.total < program.limit, 'AST_WHOLE_PROGRAM_LIMIT');
fresh();
const packageBytes = read(checks.get(canonical(packageFile)));
const pkg = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(packageBytes));
assert.equal(pkg.name, 'typescript');
assert.equal(pkg.version, '5.9.3');
assert.equal(pkg.main, './lib/typescript.js');
const ts = require(tsEntry);
assert.equal(ts.version, '5.9.3');
const text = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
const sf = ts.createSourceFile('popular-vote.service.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
fresh();

function nodes(root, predicate) {
  const found = [];
  function visit(n) {
    if (predicate(n)) found.push(n);
    ts.forEachChild(n, visit);
  }
  visit(root);
  return found;
}
function one(items) { assert.equal(items.length, 1); return items[0]; }
function service() {
  return one(sf.statements.filter(n => ts.isClassDeclaration(n) && n.name?.text === 'PopularVoteService'));
}
function method(name) {
  const m = one(service().members.filter(n => ts.isMethodDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name));
  assert(m.body && !m.asteriskToken && !m.questionToken);
  return m;
}
function modifier(n, kind) { return !!n.modifiers?.some(m => m.kind === kind); }
function ref(n, name) { assert(ts.isIdentifier(n)); assert.equal(n.text, name); }
function chain(n) {
  if (ts.isIdentifier(n)) return [n.text];
  if (n.kind === ts.SyntaxKind.ThisKeyword) return ['this'];
  assert(ts.isPropertyAccessExpression(n) && !n.questionDotToken);
  return chain(n.expression).concat(n.name.text);
}
function call(n, target, count) {
  assert(ts.isCallExpression(n) && !n.questionDotToken && !n.typeArguments?.length);
  assert.deepEqual(chain(n.expression), target);
  assert.equal(n.arguments.length, count);
  return n.arguments;
}
function declaration(s) {
  assert(ts.isVariableStatement(s) && (s.declarationList.flags & ts.NodeFlags.Const));
  return one(s.declarationList.declarations);
}
function object(n, keys) {
  assert(ts.isObjectLiteralExpression(n));
  assert(n.properties.every(p => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)));
  assert.deepEqual(n.properties.map(p => p.name.text).sort(), [...keys].sort());
  return key => one(n.properties.filter(p => p.name.text === key)).initializer;
}
function expression(n) {
  if (ts.isIdentifier(n)) return n.text;
  if (ts.isNumericLiteral(n)) return Number(n.text);
  if (ts.isBinaryExpression(n)) return [ts.tokenToString(n.operatorToken.kind), expression(n.left), expression(n.right)];
  if (ts.isConditionalExpression(n)) return ['?:', expression(n.condition), expression(n.whenTrue), expression(n.whenFalse)];
  assert(ts.isCallExpression(n) && !n.questionDotToken && !n.typeArguments?.length);
  return ['call', chain(n.expression), ...n.arguments.map(expression)];
}
function binding(s, names, target, args) {
  const d = declaration(s);
  assert(ts.isObjectBindingPattern(d.name));
  assert.deepEqual(d.name.elements.map(e => {
    assert(!e.propertyName && !e.initializer && !e.dotDotDotToken && ts.isIdentifier(e.name));
    return e.name.text;
  }), names);
  call(d.initializer, ['this', target], args.length).forEach((n, i) => ref(n, args[i]));
}
function stamp() {
  const m = method('getMainPick');
  assert.equal(m.parameters.length, 0);
  assert(modifier(m, ts.SyntaxKind.AsyncKeyword));
  assert.equal(m.body.statements.length, 7);
  const d = declaration(m.body.statements[0]);
  assert(ts.isIdentifier(d.name));
  const init = d.initializer;
  assert(ts.isNewExpression(init));
  ref(init.expression, 'Date');
  assert.equal(init.arguments?.length, 0);
  return { m, name: d.name.text, init };
}
const cases = [
  () => {
    assert.equal(sf.text, text);
    assert.equal(sf.end, text.length);
    assert.equal(sf.parseDiagnostics.length, 0);
    assert(modifier(service(), ts.SyntaxKind.ExportKeyword));
    ['getMainPick', 'findCurrentMainPickCampaign', 'kstParts', 'kstMonthRange'].forEach(method);
  },
  () => {
    const { m, name, init } = stamp();
    const clocks = nodes(m.body, n => ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Date');
    assert.deepEqual(clocks, [init]);
    assert.equal(nodes(m.body, n => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'Date').length, 0);
    const d = declaration(m.body.statements[1]);
    ref(d.name, 'campaign');
    assert(ts.isAwaitExpression(d.initializer));
    const args = call(d.initializer.expression, ['this', 'findCurrentMainPickCampaign'], 1);
    ref(args[0], name);
    assert.equal(one(nodes(m.body, ts.isAwaitExpression).filter(n => n.pos < d.initializer.end)), d.initializer);
    assert.equal(nodes(m.body, n => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name).length, 1);
    assert.equal(nodes(m.body, n => ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isFunctionDeclaration(n)).length, 0);
  },
  () => {
    const { name } = stamp();
    const m = method('findCurrentMainPickCampaign'), p = one(m.parameters);
    assert(modifier(m, ts.SyntaxKind.PrivateKeyword));
    assert(ts.isIdentifier(p.name) && !p.initializer && !p.questionToken && !p.dotDotDotToken);
    assert(ts.isTypeReferenceNode(p.type));
    ref(p.type.typeName, 'Date');
    assert.equal(p.type.typeArguments?.length || 0, 0);
    const statement = one(m.body.statements);
    assert(ts.isReturnStatement(statement));
    const args = call(statement.expression, ['this', 'prisma', 'boostCampaign', 'findFirst'], 1);
    const options = object(args[0], ['where', 'orderBy']);
    const where = object(options('where'), ['status', 'startsAt', 'endsAt']);
    assert(ts.isStringLiteral(where('status')) && where('status').text === 'active');
    ref(object(where('startsAt'), ['lte'])('lte'), p.name.text);
    ref(object(where('endsAt'), ['gt'])('gt'), p.name.text);
    const order = object(options('orderBy'), ['startsAt'])('startsAt');
    assert(ts.isStringLiteral(order) && order.text === 'desc');
    const mainCall = declaration(method('getMainPick').body.statements[1]).initializer;
    ref(call(mainCall.expression, ['this', 'findCurrentMainPickCampaign'], 1)[0], name);
  },
  () => {
    const { m, name } = stamp();
    binding(m.body.statements[3], ['year', 'month'], 'kstParts', [name]);
    binding(m.body.statements[4], ['start', 'end'], 'kstMonthRange', ['year', 'month']);
    const rankings = declaration(m.body.statements[5]);
    ref(rankings.name, 'rankings');
    assert(ts.isAwaitExpression(rankings.initializer));
    const args = call(rankings.initializer.expression, ['this', 'buildRankings'], 4);
    assert.deepEqual(chain(args[0]), ['campaign', 'id']);
    assert.equal(object(args[1], ['includeZeroScoreActiveArtists'])('includeZeroScoreActiveArtists').kind, ts.SyntaxKind.TrueKeyword);
    ref(args[2], 'start'); ref(args[3], 'end');
    const helper = method('kstParts'), input = one(helper.parameters);
    assert(modifier(helper, ts.SyntaxKind.PrivateKeyword));
    ref(input.name, 'date');
    assert(!input.initializer && !input.questionToken && ts.isTypeReferenceNode(input.type));
    ref(input.type.typeName, 'Date');
    assert.equal(helper.body.statements.length, 2);
    const shifted = declaration(helper.body.statements[0]);
    ref(shifted.name, 'kst');
    assert(ts.isNewExpression(shifted.initializer));
    ref(shifted.initializer.expression, 'Date');
    const offset = ['*', ['*', ['*', 9, 60], 60], 1000];
    assert.deepEqual(expression(one(shifted.initializer.arguments)), ['+', ['call', ['date', 'getTime']], offset]);
    const ret = helper.body.statements[1];
    assert(ts.isReturnStatement(ret));
    const fields = object(ret.expression, ['year', 'month']);
    assert.deepEqual(expression(fields('year')), ['call', ['kst', 'getUTCFullYear']]);
    assert.deepEqual(expression(fields('month')), ['+', ['call', ['kst', 'getUTCMonth']], 1]);
    const range = method('kstMonthRange');
    assert(modifier(range, ts.SyntaxKind.PrivateKeyword));
    assert.deepEqual(range.parameters.map(p => { assert(!p.initializer && !p.questionToken); return p.name.text; }), ['year', 'month']);
    assert.equal(range.body.statements.length, 5);
    const [start, endYear, endMonth, end] = range.body.statements.slice(0, 4).map(declaration);
    [start, endYear, endMonth, end].forEach((d, i) => ref(d.name, ['start', 'endYear', 'endMonth', 'end'][i]));
    assert.deepEqual(expression(endYear.initializer), ['?:', ['===', 'month', 12], ['+', 'year', 1], 'year']);
    assert.deepEqual(expression(endMonth.initializer), ['?:', ['===', 'month', 12], 0, 'month']);
    for (const [d, parts] of [[start, ['year', ['-', 'month', 1], 1]], [end, ['endYear', 'endMonth', 1]]]) {
      assert(ts.isNewExpression(d.initializer)); ref(d.initializer.expression, 'Date');
      assert.deepEqual(expression(one(d.initializer.arguments)), ['-', ['call', ['Date', 'UTC'], ...parts], offset]);
    }
    const last = range.body.statements[4];
    assert(ts.isReturnStatement(last) && ts.isObjectLiteralExpression(last.expression));
    assert.deepEqual(last.expression.properties.map(p => { assert(ts.isShorthandPropertyAssignment(p)); return p.name.text; }), ['start', 'end']);
  },
];
async function run() {
  const failedGroups = [];
  let passed = 0, finished = 0;
  for (let i = 0; i < GROUPS.length; i++) {
    await test(GROUPS[i], { concurrency: false }, () => {
      try { fresh(); cases[i](); passed++; }
      catch { failedGroups.push(GROUPS[i]); throw new Error('AST_GROUP_ASSERTION'); }
      finally { finished++; }
    });
  }
  let inputsStable = false, cacheClosed = false;
  try {
    fresh();
    for (const row of checks.values()) {
      ordinary(row.path);
      const bytes = fs.readFileSync(row.path);
      assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256);
    }
    if (owned) assert.deepEqual(guard.stats, { blockedEnvReads: 0, blockedWrites: 0, blockedNetwork: 0 });
    inputsStable = true;
    const allowed = new Set([canonical(__filename), canonical(tsEntry)]);
    if (owned) { allowed.add(canonical(admission.guard.path)); allowed.add(canonical(admission.preload.path)); }
    cacheClosed = Object.keys(require.cache).every(p => allowed.has(canonical(p)) || (!owned && initialCache.has(p)));
    fresh();
  } catch { inputsStable = false; }
  const result = {
    contract: 'popular-vote-month-clock-shared-result-v1', ownedAdmission: owned,
    complete: finished === GROUPS.length, groups: GROUPS, baselineFailures: BASELINE_FAILURES,
    failedGroups, passed, failed: failedGroups.length,
    inputsStable, loadedModulesAdmitted: owned && cacheClosed, program,
    astOnly: true, typeChecked: false, businessInvoked: false, nativeSqlProof: false,
    generationAuthorized: false, productInstalled: false,
  };
  process.stdout.write('POPULAR_VOTE_MONTH_CLOCK_SHARED_RESULT ' + JSON.stringify(result) + '\n');
  if (!result.complete || !inputsStable || !cacheClosed || failedGroups.length) process.exitCode = 1;
}
run().catch(() => { process.exitCode = 1; });
