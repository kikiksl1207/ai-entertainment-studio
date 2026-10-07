import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const sourcePath = process.env.FAN_SUMMARY_CACHE_SOURCE || new URL('../server/src/fan-engagement/fan-engagement.controller.ts', import.meta.url);
const bytes = fs.readFileSync(sourcePath);
if (process.env.FAN_SUMMARY_CACHE_SOURCE) {
  assert.match(process.env.FAN_SUMMARY_CACHE_SOURCE_SHA256 || '', /^[a-f0-9]{64}$/);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), process.env.FAN_SUMMARY_CACHE_SOURCE_SHA256);
}
const source = bytes.toString('utf8');
const modules = process.env.FAN_SUMMARY_CACHE_MODULE_ROOT;
const dependencyRequire = createRequire(modules ? path.join(modules, '__cache_metadata_test.cjs') : new URL('../server/package.json', import.meta.url));
dependencyRequire('reflect-metadata');
const nest = dependencyRequire('@nestjs/common');
const constants = dependencyRequire('@nestjs/common/constants');
const ts = dependencyRequire('typescript');
class JwtAuthGuard { canActivate() { throw new Error('Metadata tests do not run authentication'); } }
class OptionalJwtAuthGuard { canActivate() { throw new Error('Metadata tests do not run authentication'); } }
class FanEngagementJwtAuthGuard { canActivate() { throw new Error('Metadata tests do not run authentication'); } }
class FanEngagementService {}
const CurrentUser = nest.createParamDecorator(() => { throw new Error('Metadata tests do not run request extraction'); });
const dependencies = new Map([
  ['@nestjs/common', nest],
  ['../auth/auth.types', {}],
  ['../auth/decorators/current-user.decorator', { CurrentUser }],
  ['../auth/guards/jwt-auth.guard', { JwtAuthGuard }],
  ['../auth/guards/optional-jwt-auth.guard', { OptionalJwtAuthGuard }],
  ['./fan-engagement-auth.guard', { FanEngagementJwtAuthGuard }],
  ['./fan-engagement.service', { FanEngagementService }],
]);
const transpiled = ts.transpileModule(source, { fileName: 'fan-engagement.controller.ts', reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: true } });
assert.equal((transpiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
const module = { exports: {} };
const context = vm.createContext({ Reflect, exports: module.exports, module,
  require(name) { assert(dependencies.has(name), 'Unexpected controller runtime dependency: ' + name); return dependencies.get(name); } });
vm.runInContext(transpiled.outputText, context, { filename: fileURLToPath(new URL('../server/src/fan-engagement/fan-engagement.controller.ts', import.meta.url)) });
const { FanEngagementController, MyFanEngagementController, PublicFanEngagementController } = module.exports;
const metadata = (key, target) => Reflect.getMetadata(key, target);

test('owner fan summary has actual Nest private no-store GET metadata', () => {
  assert.equal(metadata(constants.PATH_METADATA, MyFanEngagementController), 'me/fan-engagement');
  assert.equal(metadata(constants.PATH_METADATA, MyFanEngagementController.prototype.getSummary), 'summary');
  assert.equal(metadata(constants.METHOD_METADATA, MyFanEngagementController.prototype.getSummary), nest.RequestMethod.GET);
  assert.deepEqual(metadata(constants.HEADERS_METADATA, MyFanEngagementController.prototype.getSummary),
    [{ name: 'Cache-Control', value: 'private, no-store' }]);
  assert.deepEqual(metadata(constants.GUARDS_METADATA, MyFanEngagementController), [JwtAuthGuard]);
});

test('owner summary delegation errors and other controller headers guards routes stay scoped', () => {
  const sentinel = { achievements: [], titles: { items: [], equipped: null } }, calls = [];
  const service = { getMySummary(id, query) { calls.push({ id, query }); return sentinel; } };
  const controller = new MyFanEngagementController(service);
  for (const [id, locale] of [['synthetic-owner-a', 'ko'], ['synthetic-owner-b', 'en']]) {
    const query = { locale }; assert.equal(controller.getSummary({ id }, query), sentinel);
    assert.equal(calls.at(-1).id, id); assert.equal(calls.at(-1).query, query);
  }
  const error = new Error('Synthetic service error');
  const failed = new MyFanEngagementController({ getMySummary() { throw error; } });
  assert.throws(() => failed.getSummary({ id: 'synthetic-owner-a' }, {}), value => value === error);
  const otherRoutes = [
    [FanEngagementController, 'getMissions', 'missions', nest.RequestMethod.GET, OptionalJwtAuthGuard],
    [FanEngagementController, 'getConceptVotes', 'concept-votes', nest.RequestMethod.GET, OptionalJwtAuthGuard],
    [FanEngagementController, 'submitConceptVoteBallot', 'concept-votes/:voteId/ballots', nest.RequestMethod.POST, JwtAuthGuard],
    [FanEngagementController, 'createMissionParticipation', 'missions/:missionId/participations', nest.RequestMethod.POST, FanEngagementJwtAuthGuard],
    [MyFanEngagementController, 'equipTitle', 'title', nest.RequestMethod.PATCH, null],
    [PublicFanEngagementController, 'getPublicSummary', 'public-summary', nest.RequestMethod.GET, null],
  ];
  for (const [type, name, route, method, guard] of otherRoutes) {
    const handler = type.prototype[name];
    assert.equal(metadata(constants.HEADERS_METADATA, handler), undefined, name);
    assert.equal(metadata(constants.PATH_METADATA, handler), route);
    assert.equal(metadata(constants.METHOD_METADATA, handler), method);
    assert.deepEqual(metadata(constants.GUARDS_METADATA, handler), guard ? [guard] : undefined);
  }
  assert.equal(metadata(constants.HEADERS_METADATA, MyFanEngagementController), undefined);
  assert.equal(metadata(constants.HEADERS_METADATA, FanEngagementController), undefined);
  assert.equal(metadata(constants.HEADERS_METADATA, PublicFanEngagementController), undefined);
});
