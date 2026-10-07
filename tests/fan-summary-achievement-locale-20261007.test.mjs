import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const sourcePath = process.env.FAN_SUMMARY_LOCALE_SOURCE || new URL('../server/src/fan-engagement/fan-engagement.service.ts', import.meta.url);
const bytes = fs.readFileSync(sourcePath);
if (process.env.FAN_SUMMARY_LOCALE_SOURCE) {
  assert.match(process.env.FAN_SUMMARY_LOCALE_SOURCE_SHA256 || '', /^[a-f0-9]{64}$/);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), process.env.FAN_SUMMARY_LOCALE_SOURCE_SHA256);
}
const moduleRoot = process.env.FAN_SUMMARY_LOCALE_MODULE_ROOT;
const dependencyRequire = createRequire(moduleRoot ? path.join(moduleRoot, '__locale_helpers_test.cjs') : new URL('../server/package.json', import.meta.url));
const ts = dependencyRequire('typescript');
const source = bytes.toString('utf8');
const tree = ts.createSourceFile('fan-engagement.service.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
assert.equal(tree.parseDiagnostics.length, 0);
const serviceClass = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FanEngagementService');
assert(serviceClass);
const methods = new Map(serviceClass.members.filter(ts.isMethodDeclaration).map(node => [node.name.getText(tree), node]));
const required = ['achievementCopy', 'metadataObject', 'labels', 'copyKey', 'locale', 'titleCopy'];
for (const name of required) assert(methods.has(name), 'Actual helper required: ' + name);
const names = [...required, ...(methods.has('summaryLocale') ? ['summaryLocale'] : [])];
const adapter = 'class SummaryCopyHelpers {\n' + names.map(name => methods.get(name).getText(tree)).join('\n') + '\n}\nmodule.exports = new SummaryCopyHelpers();';
const result = ts.transpileModule(adapter, { fileName: 'summary-copy-helpers.ts', reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
assert.equal((result.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
const module = { exports: {} };
vm.runInNewContext(result.outputText, { module, exports: module.exports }, { filename: 'actual-summary-copy-helpers.js' });
const helpers = module.exports, plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const ko = { title: 'Synthetic Korean title', description: 'Synthetic Korean record' };
const en = { title: 'Synthetic English title', description: 'Synthetic English record' };
const calls = node => {
  const found = [];
  const visit = child => { if (ts.isCallExpression(child)) found.push(child); ts.forEachChild(child, visit); };
  visit(node); return found;
};

test('owner achievement requested labels retain genuine Korean fallback', () => {
  const copy = helpers.achievementCopy({ labels: { ko, en } }, 'synthetic-record', 'en');
  assert.deepEqual(plain(copy.labels), { ko, en });
  assert.equal(copy.titleKey, 'achievement.synthetic-record.title');
  assert.equal(copy.descriptionKey, 'achievement.synthetic-record.description');
});

test('summary locale accepts exact five public values and otherwise Korean', () => {
  assert.equal(typeof helpers.summaryLocale, 'function');
  for (const language of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) assert.equal(helpers.summaryLocale(language), language);
  for (const other of [undefined, null, '', 'en-US', 'KO', 'zh-CN', ' en', 'ja ', 1, {}, []]) assert.equal(helpers.summaryLocale(other), 'ko');
});

test('missing malformed requested labels use real Korean key without fake translation', () => {
  for (const invalid of [undefined, null, [], 'opaque', {}]) {
    const copy = helpers.achievementCopy({ labels: { ko, en: invalid } }, 'synthetic-record', 'en');
    assert.deepEqual(plain(copy.labels), { ko });
    assert.equal(Object.hasOwn(copy.labels, 'en'), false);
  }
  for (const labels of [undefined, null, [], 'opaque', {}]) {
    assert.equal(helpers.achievementCopy({ labels }, 'synthetic-record', 'en').labels, undefined);
  }
});

test('all requested real copy and partial fields stay under original locale keys', () => {
  for (const language of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
    const requested = { title: 'Synthetic ' + language }, value = { labels: { ko, [language]: requested } };
    const before = JSON.stringify(value), copy = helpers.achievementCopy(value, 'synthetic-record', language);
    assert.deepEqual(plain(copy.labels), language === 'ko' ? { ko: requested } : { ko, [language]: requested });
    assert.equal(copy.labels[language].description, undefined);
    assert.equal(JSON.stringify(value), before);
  }
  assert.deepEqual(plain(helpers.achievementCopy({ titleKey: 'real.title', descriptionKey: 'real.description', labels: { en } }, 'synthetic-record', 'en')),
    { titleKey: 'real.title', descriptionKey: 'real.description', labels: { en } });
});

test('default public achievement title copy and global locale behavior remain Korean', () => {
  const value = { labels: { ko, en } };
  assert.deepEqual(plain(helpers.achievementCopy(value, 'synthetic-record').labels), { ko });
  assert.deepEqual(plain(helpers.titleCopy(value, 'synthetic-title').labels), { ko });
  for (const language of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) assert.equal(helpers.locale(language), 'ko');
  assert.equal(helpers.achievementCopy({ labels: { en } }, 'synthetic-record').labels, undefined);
});

test('actual owner callsite alone routes summary locale to achievement copy', () => {
  const summary = methods.get('getMySummary'), publicSummary = methods.get('getPublicSummary');
  assert(summary && publicSummary);
  const summaryCalls = calls(summary), publicCalls = calls(publicSummary);
  const localeCalls = summaryCalls.filter(call => call.expression.getText(tree) === 'this.summaryLocale');
  assert.equal(localeCalls.length, 1);
  assert.equal(localeCalls[0].arguments[0].getText(tree), 'query.locale');
  const owned = summaryCalls.filter(call => call.expression.getText(tree) === 'this.achievementCopy');
  assert.equal(owned.length, 1);
  assert.deepEqual(owned[0].arguments.map(node => node.getText(tree)), ['row.achievement.copy', 'row.achievement.code', 'locale']);
  const publicCopy = publicCalls.filter(call => call.expression.getText(tree) === 'this.achievementCopy');
  assert.equal(publicCopy.length, 1);
  assert.equal(publicCopy[0].arguments.length, 2);
  const allSummaryCalls = calls(serviceClass).filter(call => call.expression.getText(tree) === 'this.summaryLocale');
  assert.equal(allSummaryCalls.length, 1);
  const title = summaryCalls.filter(call => call.expression.getText(tree) === 'this.titleCopy');
  assert.equal(title.length, 1);
  assert.equal(title[0].arguments.length, 2);
  assert(publicCalls.some(call => call.expression.getText(tree) === 'this.locale'));
});
