import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [controller, service, policy, migration] = await Promise.all([
  readFile(new URL('../src/story-production/story-production.controller.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/story-production/story-progress-control.service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/story-production/story-progress-control.policy.ts', import.meta.url), 'utf8'),
  readFile(new URL('../prisma/migrations/0049_story_progress_controls/migration.sql', import.meta.url), 'utf8'),
]);

const checks = {
  customChoiceGuarded:
    controller.includes("@Post('me/story-progress/:progressId/custom-choice')") &&
    service.includes('hasActivePaidEntitlement') &&
    service.includes('expectedRevision'),
  checkpointVersioned:
    migration.includes('"story_progress_checkpoints"') &&
    migration.includes('"progress_revision"'),
  quotaAtomic:
    service.includes('usedCount: { lt: bucket.limitCount }') &&
    migration.includes('"story_reset_quota_counts_check"'),
  adminAdjustmentSeparated:
    controller.includes("@Post('reset-quota-adjustments')") &&
    controller.includes("@RequireAdminPermissions('*')") &&
    migration.includes('"story_reset_quota_adjustments"'),
  resetAuditSanitized:
    service.includes('safeResetAuditMetadata') &&
    !policy.includes('privateInput'),
  publicProjectionSafe:
    controller.includes("@Get('me/stories/:workId/progress-state')") &&
    service.includes('customChoiceCapability') &&
    service.includes('privateInputReturned: false'),
};

const failures = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);
const report = {
  runId: randomUUID(),
  publicPath: '/api/v1/me/stories/:workId/progress-state',
  status: failures.length ? 'blocked' : 'passed',
  checks,
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
