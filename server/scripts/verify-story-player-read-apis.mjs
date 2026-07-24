import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const files = {
  controller: new URL(
    '../src/story-production/story-production.controller.ts',
    import.meta.url,
  ),
  service: new URL(
    '../src/story-production/story-production.service.ts',
    import.meta.url,
  ),
  sceneContract: new URL(
    '../src/story-stage/story-scene-read-model.ts',
    import.meta.url,
  ),
  visualContract: new URL(
    '../src/story-stage/story-scene-visual-manifest-contract.ts',
    import.meta.url,
  ),
  policy: new URL(
    '../src/story-production/story-production.policy.ts',
    import.meta.url,
  ),
};

const [controller, service, sceneContract, visualContract, policy] =
  await Promise.all(Object.values(files).map((file) => readFile(file, 'utf8')));

const currentProgress = methodBody(
  service,
  'async currentProgress(',
  'async updateBeatProgress(',
);
const sceneProjection = methodBody(
  service,
  'private async sceneProjection(',
  'private async publicWorkById(',
);
const graph = methodBody(
  service,
  'async graph(',
  'async createManuscriptVersion(',
);
const readSlices = `${currentProgress}\n${sceneProjection}\n${graph}`;

const checks = {
  authenticatedCurrentScene:
    controller.includes("@Get('story-sessions/:sessionId/current-scene')") &&
    guardedRoute(controller, "@Get('story-sessions/:sessionId/current-scene')"),
  currentSceneContractEnabled:
    sceneContract.includes("path: '/api/v1/story-sessions/:sessionId/current-scene'") &&
    sceneContract.includes("status: 'production_read_endpoint'") &&
    sceneContract.includes('enabled: true'),
  safeVisualProjection:
    sceneProjection.includes('projectStoredStorySceneVisualManifest') &&
    visualContract.includes("responseField: 'scene.visualManifest'") &&
    visualContract.includes('publicPathOnly: true'),
  publishedFixtureRowsExcluded:
    sceneProjection.includes("status: 'published'") &&
    sceneProjection.includes('fixtureSource: false'),
  boundedScenePayload:
    sceneProjection.includes('take: 40') &&
    sceneProjection.includes('take: 12') &&
    sceneProjection.includes('boundedPath('),
  authenticatedOwnerGraph:
    controller.includes("@Get('stories/:workId/graph')") &&
    guardedRoute(controller, "@Get('stories/:workId/graph')") &&
    graph.includes('this.assertOwner('),
  localizedBoundedGraph:
    graph.includes('projectLocalizedValue(') &&
    graph.includes('take: 20') &&
    graph.includes('fullGraphIncluded: false'),
  safeReleaseWarnings:
    graph.includes('projectStoryGraphValidationSummary(') &&
    policy.includes('STORY_GRAPH_WARNING_MESSAGE_KEYS') &&
    policy.includes("code.split(':', 1)[0]"),
  readOnlyExecution:
    !/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\s*\(/.test(
      readSlices,
    ) && !readSlices.includes('$transaction('),
};

const failed = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);
const report = {
  runId: randomUUID(),
  publicPath: '/api/v1/story-sessions/:sessionId/current-scene',
  graphPath: '/api/v1/stories/:workId/graph',
  status: failed.length ? 'blocked' : 'passed',
  checks,
  mutationExecuted: false,
};

console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;

function methodBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Method marker missing: ${startMarker}`);
  return source.slice(start, end);
}

function guardedRoute(source, routeMarker) {
  const start = source.indexOf(routeMarker);
  const tail = source.slice(start, start + 180);
  return start >= 0 && tail.includes('@UseGuards(JwtAuthGuard)');
}
