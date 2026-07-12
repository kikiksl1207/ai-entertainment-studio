import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const controllerUrl = new URL(
  '../src/story-production/story-production.controller.ts',
  import.meta.url,
);
const serviceUrl = new URL(
  '../src/story-production/story-production.service.ts',
  import.meta.url,
);
const migrationUrl = new URL(
  '../prisma/migrations/0047_story_production_backend/migration.sql',
  import.meta.url,
);

const [controller, service, migration] = await Promise.all([
  readFile(controllerUrl, 'utf8'),
  readFile(serviceUrl, 'utf8'),
  readFile(migrationUrl, 'utf8'),
]);

const routeLiterals = [...controller.matchAll(/@(Get|Post)\('([^']+)'\)/g)].map(
  (match) => match[2],
);
const forbiddenRoute = routeLiterals.find((route) =>
  /(^|\/)(fixture|mock|sample|demo|preview)(\/|$)/i.test(route),
);
const checks = {
  noFixturePublicRoute: !forbiddenRoute,
  publishedOnlyQuery: service.includes("status: 'published'"),
  fixtureRowsExcluded: service.includes('fixtureSource: false'),
  publicSourceGuardApplied: service.includes('isPublicStorySourceSafe'),
  productionDefaultsClosed:
    migration.includes('"fixture_source" BOOLEAN NOT NULL DEFAULT false') &&
    !migration.includes('INSERT INTO "story_works"'),
};

const failures = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);
const report = {
  runId: randomUUID(),
  publicPath: '/api/v1/stories',
  status: failures.length ? 'blocked' : 'passed',
  checks,
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
