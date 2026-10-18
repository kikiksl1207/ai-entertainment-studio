'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const ts = require(path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js'));
const file = path.join(ROOT, 'server/src/fan-engagement/fan-engagement.service.ts');
const source = fs.readFileSync(file, 'utf8');
const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
assert.equal(tree.parseDiagnostics.length, 0);
const classes = tree.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === 'FanEngagementService');
assert.equal(classes.length, 1);
const names = ['getMySummary', 'summaryLocale', 'kstDateBucket', 'achievementCopy', 'titleCopy',
  'presentEquippedTitle', 'labels', 'metadataObject', 'copyKey', 'policy'];
const methods = names.map(name => {
  const rows = classes[0].members.filter(node => ts.isMethodDeclaration(node) && node.name.getText(tree) === name);
  assert.equal(rows.length, 1); assert(rows[0].body); return rows[0].getText(tree);
});
// Actual formatter/read method bodies; DB and the clock below are synthetic fixtures.
const built = ts.transpileModule('class ScopedFan {\n' + methods.join('\n') + '\n}\nmodule.exports=ScopedFan;', {
  fileName: 'actual-fan-summary-locales.ts', reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
assert.equal((built.diagnostics || []).length, 0);
const stamp = '2026-01-01T00:00:00.000Z';
class FixedDate extends Date { constructor(value) { super(arguments.length ? value : stamp); } }
const context = { module: { exports: {} }, Date: FixedDate,
  Prisma: { TransactionIsolationLevel: { RepeatableRead: 'RepeatableRead' } } };
vm.runInNewContext(built.outputText, context, { filename: 'actual-fan-summary-locales.js', timeout: 1000 });
const ScopedFan = context.module.exports, plain = value => JSON.parse(JSON.stringify(value));

test('personal summary titles preserve the selected stored language and Korean fallback without changing points or equipment', async () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
  const labels = Object.fromEntries(locales.map(locale => [locale,
    Object.freeze({ displayName: 'FIXTURE_' + locale, description: 'DETAIL_' + locale })]));
  const copy = Object.freeze({ displayNameKey: 'fixture.title.name', descriptionKey: 'fixture.title.description', labels });
  const title = Object.freeze({ code: 'fixture-title', status: 'active', rarity: 'rare', copy });
  const owned = Object.freeze({ id: 'owned-fixture', status: 'active', equipped: true, equippedAt: new Date(stamp), title });
  const revoked = Object.freeze({ ...owned, id: 'revoked-fixture', status: 'revoked' });
  for (const requested of [...locales, 'unsupported', undefined]) {
    const locale = locales.includes(requested) ? requested : 'ko';
    const service = new ScopedFan(); let active = false, transactions = 0, reads = 0;
    const read = request => { assert(active); reads++; assert.equal(request.where.userId, userId); };
    const tx = {
      fanEngagementPointLedger: {
        async findMany(request) { read(request); assert.equal(request.take, 20); return []; },
        async groupBy(request) { read(request); assert.deepEqual(plain(request.by), ['direction']);
          return [{ direction: 'earn', _sum: { points: 20 } }, { direction: 'spend', _sum: { points: 3 } }]; },
      },
      async $queryRaw(parts, ...values) {
        assert(active); reads++;
        assert(Array.from(parts).join('?').includes('FROM fan_mission_participations'));
        assert.equal(values.length, 4); assert.equal(values[0], userId); assert.equal(values[1].toISOString(), stamp);
        assert.deepEqual(values.slice(2), ['2026-01-01', '2026-01-01']);
        return [{ completedTodayCount: 1n, currentStreakDays: 2n, totalAcceptedCount: 3n }];
      },
      userFanAchievement: { async findMany(request) { read(request); return []; } },
      userFanTitle: { async findMany(request) {
        read(request); assert.deepEqual(plain(request.orderBy), [{ equipped: 'desc' }, { createdAt: 'desc' }]);
        return [owned, revoked];
      } },
    };
    service.prisma = { async $transaction(work, options) {
      assert.equal(++transactions, 1); assert(!active);
      assert.deepEqual(plain(options), { isolationLevel: 'RepeatableRead' }); active = true;
      try { return await work(tx); } finally { active = false; }
    } };
    const result = plain(await service.getMySummary(userId, { locale: requested }));
    const selected = locale === 'ko' ? { ko: labels.ko } : { ko: labels.ko, [locale]: labels[locale] };
    assert.equal(result.locale, locale); assert.equal(result.generatedAt, stamp);
    assert.deepEqual(result.titles.equipped, { code: title.code,
      copy: { displayNameKey: copy.displayNameKey, labels: selected }, equippedAt: stamp });
    for (const item of result.titles.items) assert.deepEqual(item.copy, {
      displayNameKey: copy.displayNameKey, descriptionKey: copy.descriptionKey, labels: selected,
    });
    assert.equal(result.titles.items[0].equipped, true); assert.equal(result.titles.items[0].canEquip, true);
    assert.equal(result.titles.items[1].equipped, false); assert.equal(result.titles.items[1].canEquip, false);
    assert.deepEqual(result.points, { balance: 17, lifetimeEarned: 20, cashLike: false,
      transferable: false, settlementEligible: false, luminaConvertible: false });
    assert.deepEqual(result.participationSummary, { completedTodayCount: 1, currentStreakDays: 2, totalAcceptedCount: 3 });
    assert.deepEqual(result.achievements, []); assert.deepEqual(result.recentLedger, []);
    assert.equal(result.policy.aiDraftsAutoPublish, false); assert.equal(result.policy.luminaAmount, 0);
    assert.equal(transactions, 1); assert.equal(reads, 5); assert.equal(active, false);
    assert.deepEqual(plain(service.presentEquippedTitle(owned)), {
      code: title.code, copy: { displayNameKey: copy.displayNameKey, labels: { ko: labels.ko } }, equippedAt: stamp,
    });
    assert.equal(service.presentEquippedTitle(undefined, locale), null);
  }
  const service = new ScopedFan();
  assert.deepEqual(plain(service.titleCopy({ labels: { ko: labels.ko } }, title.code, 'en')).labels, { ko: labels.ko });
  assert.deepEqual(plain(service.titleCopy({ labels: { en: labels.en } }, title.code, 'en')).labels, { en: labels.en });
  for (const malformed of [null, [], 'invalid', { labels: [] }, { labels: { en: [] } }]) {
    const value = service.titleCopy(malformed, title.code, 'en');
    assert.equal(value.labels, undefined); assert.equal(value.displayNameKey, 'fanTitle.' + title.code + '.name');
  }
  assert.deepEqual(plain(copy.labels), labels);
});
