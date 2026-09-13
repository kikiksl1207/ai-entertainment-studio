import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Execute source methods against local storage doubles, following QR1's independent
// counterexample approach. No server bootstrap, database, or private QA file writes.
export function loadStoryServerContract(repo) {
  const deps = process.env.STORY_UI_SERVER_DEPS || path.join(repo, 'server/node_modules');
  const require = createRequire(path.join(deps, '../package.json'));
  const ts = require('typescript');
  const nest = require('@nestjs/common');
  function source(relative) {
    const file = path.join(repo, relative);
    return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  }
  function policy(relative) {
    const ast = source(relative);
    const mod = new Module(ast.fileName);
    mod.paths = [deps];
    mod._compile(ts.transpileModule(ast.text, { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022 } }).outputText, ast.fileName);
    return mod.exports;
  }
  const productionPolicy = policy('server/src/story-production/story-production.policy.ts');
  const progressPolicy = policy('server/src/story-production/story-progress-control.policy.ts');
  function methods(relative, names) {
    const ast = source(relative);
    const members = ast.statements.filter(ts.isClassDeclaration).flatMap((x) => [...x.members]);
    const printer = ts.createPrinter();
    const printed = names.map((name) => {
      const node = members.find((x) => ts.isMethodDeclaration(x) && x.name.getText(ast) === name);
      assert(node, `Missing actual server method: ${name}`);
      const clean = ts.factory.updateMethodDeclaration(node,
        node.modifiers?.filter((x) => x.kind === ts.SyntaxKind.AsyncKeyword), node.asteriskToken,
        node.name, node.questionToken, node.typeParameters, node.parameters, node.type, node.body);
      return printer.printNode(ts.EmitHint.Unspecified, clean, ast);
    });
    const code = ts.transpileModule(`const container = {${printed.join(',\n')}};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    const environment = { ...nest, ...productionPolicy, ...progressPolicy,
      jsonArray: (x) => Array.isArray(x) ? x : [],
      jsonStringArray: (x) => Array.isArray(x) ? x.filter((y) => typeof y === 'string') : [],
      sessionKeyHash: (x) => createHash('sha256').update(x).digest('hex') };
    return new Function(...Object.keys(environment), `${code}\nreturn container;`)(...Object.values(environment));
  }
  const production = methods('server/src/story-production/story-production.service.ts',
    ['detail', 'readerAccess', 'accessProjection', 'startProgress', 'currentProgress']);
  const controls = methods('server/src/story-production/story-progress-control.service.ts', ['publicState']);
  const economics = methods('server/src/story-production/story-economics.service.ts', ['capabilityProjection']);
  return async function contract(options = {}) {
    const ids = { work: '22222222-2222-4222-8222-222222222222', part: '44444444-4444-4444-8444-444444444444',
      scene: '55555555-5555-4555-8555-555555555555', progress: '11111111-1111-4111-8111-111111111111' };
    const free = options.free !== false;
    const price = { isZero: () => free, toString: () => free ? '0' : '125.5' };
    const localized = (x) => Object.fromEntries(['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'].map((l) => [l, `${x} ${l}`]));
    const work = { id: ids.work, slug: 'private-local-story', title: localized('Synthetic title'),
      summary: localized('Synthetic synopsis'), defaultLocale: 'en', priceLumina: price,
      fixtureSource: false, coverManifest: { url: '/private-qa-cover.png' }, activeReleaseId: 'local-release',
      status: 'published', publishedVersion: 1, publishedAt: new Date('2026-01-01') };
    let progress = !options.state || options.state === 'new' ? null : {
      id: ids.progress, status: options.state === 'active' ? 'active' : 'completed', currentAct: 1,
      currentSceneId: options.state === 'completed-null' ? null : ids.scene,
      checkpointSceneId: ids.scene, visitedEndingKeys: options.state === 'active' ? [] : ['local-ending'],
      storyVersion: options.versionMismatch ? 0 : 1, capabilityRevision: 4, progressRevision: 7, pathSummary: [],
    };
    const cap = economics.capabilityProjection({ status: 'active', revision: 4,
      aiInputTokenLimit: 10, aiOutputTokenLimit: 10, fullResetLimit: 1, actResetLimit: 3 });
    const writes = [];
    const prisma = {
      storyWork: { findFirst: async () => work },
      storyRelease: { findFirst: async () => ({ id: work.activeReleaseId }) },
      storyPart: { findMany: async () => [{ id: ids.part, actNumber: 1, position: 1, seasonKey: 'season-1',
        title: localized('Synthetic part'), priceLumina: price }] },
      storyScene: { findFirst: async () => ({ id: ids.scene, partId: ids.part }) },
      storyChoiceEvent: { findMany: async () => [] },
      storyReaderProgress: { findUnique: async () => progress, findFirst: async () => progress,
        create: async ({ data }) => { writes.push('progress-create'); progress = { ...data, id: ids.progress,
          status: 'active', progressRevision: 1, visitedEndingKeys: [] }; return progress; } },
      storyQualityEvent: { upsert: async () => { writes.push('quality-upsert'); return {}; } },
      storyResetQuotaBucket: { findMany: async () => options.exhausted ?
        [{ scopeKey: 'full', usedCount: 1, limitCount: 1 }, { scopeKey: 'act:1', usedCount: 3, limitCount: 3 }] : [] },
      storyProgressCheckpoint: { findFirst: async () => null },
    };
    const econ = { readerCapability: async () => cap, publicCapabilityByRelease: async () => cap,
      releaseSessionPin: async () => ({ aiRateCardId: 'local-rate', capabilityRevision: 4 }) };
    const prod = { ...production, prisma, economics: econ,
      publicWorkById: async () => work, hasEntitlement: async () => options.owned === true,
      entitledReferenceIds: async (user) => new Set(user && options.owned ? [ids.work] : []),
      // Scene assembly is outside the access/reentry contract; null-scene returns
      // are produced by the actual currentProgress method, not this scene double.
      sceneProjection: async (p) => ({ progressId: p.id, revision: p.progressRevision, status: p.status,
        currentAct: 1, storyVersion: p.storyVersion, scene: { id: ids.scene,
          beats: [{ content: 'SYNTHETIC END OR SCENE', position: 0 }], endingType: p.status === 'completed' ? 'normal' : null },
        choices: [], releaseCapability: cap }),
    };
    const control = { ...controls, prisma, economics: econ, hasActivePaidEntitlement: async () => options.owned === true };
    const locale = options.locale || 'en';
    return { ids, writes, cap,
      detail: await prod.detail(work.slug, undefined, { locale }),
      access: await prod.readerAccess('local-user', ids.work, { locale }),
      state: await control.publicState('local-user', ids.work),
      start: () => prod.startProgress('local-user', ids.work, { mode: 'continue', locale }),
      current: () => prod.currentProgress('local-user', ids.progress, locale) };
  };
}
