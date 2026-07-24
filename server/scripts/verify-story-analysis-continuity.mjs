import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [controller, service, policy, migration] = await Promise.all([
  readFile(
    new URL(
      '../src/story-production/story-production.controller.ts',
      import.meta.url,
    ),
    'utf8',
  ),
  readFile(
    new URL(
      '../src/story-production/story-production.service.ts',
      import.meta.url,
    ),
    'utf8',
  ),
  readFile(
    new URL(
      '../src/story-production/story-production.policy.ts',
      import.meta.url,
    ),
    'utf8',
  ),
  readFile(
    new URL(
      '../prisma/migrations/0048_story_production_backend/migration.sql',
      import.meta.url,
    ),
    'utf8',
  ),
]);

const createManuscript = methodBody(
  service,
  'async createManuscriptVersion(',
  'async analyzeManuscript(',
);
const analyzeManuscript = methodBody(
  service,
  'async analyzeManuscript(',
  'async analysis(',
);
const analysisRead = methodBody(
  service,
  'async analysis(',
  'async continuity(',
);
const continuityRead = methodBody(
  service,
  'async continuity(',
  'async decideContinuityIssue(',
);
const continuityDecision = methodBody(
  service,
  'async decideContinuityIssue(',
  'private async sceneProjection(',
);

const creatorRoutes = [
  "@Post('me/creator-studio/stories/:workId/manuscripts')",
  "@Post('me/creator-studio/manuscripts/:manuscriptId/analyses')",
  "@Get('me/creator-studio/analyses/:analysisId')",
  "@Get('me/creator-studio/stories/:workId/continuity')",
  "@Post('me/creator-studio/stories/:workId/continuity/:issueId/decision')",
];
const readSlices = `${analysisRead}\n${continuityRead}`;
const checks = {
  authenticatedCreatorRoutes: creatorRoutes.every((route) =>
    guardedRoute(controller, route),
  ),
  ownerScopedWrites:
    createManuscript.includes('this.assertOwner(userId, workId)') &&
    analyzeManuscript.includes('ownerUserId: userId') &&
    continuityDecision.includes('this.assertOwner(userId, workId)') &&
    continuityDecision.includes('where: { id: issueId, workId }'),
  immutableManuscriptVersions:
    createManuscript.includes('manuscriptContentHash(') &&
    createManuscript.includes('workId_contentHash') &&
    createManuscript.includes('idempotentReplay: true') &&
    migration.includes(
      'story_manuscript_versions_work_id_content_hash_key',
    ),
  idempotentVersionedAnalysis:
    analyzeManuscript.includes('analysisIdempotencyKey(') &&
    analyzeManuscript.includes('idempotencyKey: key') &&
    analyzeManuscript.includes('analysisVersion: (latest?.analysisVersion ?? 0) + 1') &&
    migration.includes('story_analysis_jobs_idempotency_key_key'),
  evidenceProvenancePersisted:
    policy.includes('sourcePartKey: string') &&
    policy.includes('sourceParagraphIndex: number') &&
    analyzeManuscript.includes('tx.storyAnalysisEvidence.create') &&
    migration.includes('"source_part_key"') &&
    migration.includes('"source_paragraph_index"'),
  continuityLedgerPersisted:
    analyzeManuscript.includes('deriveContinuityLedger(') &&
    analyzeManuscript.includes('tx.storyContinuityEntry.create') &&
    analyzeManuscript.includes('tx.storyContinuityIssue.create') &&
    migration.includes('"story_continuity_entries"') &&
    migration.includes('"story_continuity_issues"'),
  criticalPublishGate:
    policy.includes("severity: 'critical'") &&
    continuityRead.includes("issue.severity === 'critical'") &&
    continuityRead.includes("issue.status === 'open'") &&
    continuityRead.includes('publishGate:'),
  authorDecisionSeparated:
    continuityDecision.includes('authorDecision: body.decision') &&
    continuityDecision.includes('decidedByUserId: userId') &&
    continuityDecision.includes('decidedAt: new Date()') &&
    !continuityDecision.includes('storyManuscriptVersion.update'),
  readOnlyCreatorProjections:
    !/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\s*\(/.test(
      readSlices,
    ) && !readSlices.includes('$transaction('),
};
const failed = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);
const report = {
  runId: randomUUID(),
  publicPath: '/api/v1/me/creator-studio/analyses/:analysisId',
  relatedPublicPaths: [
    '/api/v1/me/creator-studio/stories/:workId/continuity',
  ],
  status: failed.length ? 'blocked' : 'passed',
  checks,
  mutationExecuted: false,
};

console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;

function methodBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Method marker missing: ${startMarker}`);
  }
  return source.slice(start, end);
}

function guardedRoute(source, routeMarker) {
  const start = source.indexOf(routeMarker);
  const tail = source.slice(start, start + 180);
  return start >= 0 && tail.includes('@UseGuards(JwtAuthGuard)');
}
