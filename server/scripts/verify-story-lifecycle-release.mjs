import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [service, policy, migration, productionService] = await Promise.all([
  readFile(new URL('../src/story-production/story-lifecycle.service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/story-production/story-lifecycle.policy.ts', import.meta.url), 'utf8'),
  readFile(new URL('../prisma/migrations/0050_story_release_memory_observability/migration.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/story-production/story-production.service.ts', import.meta.url), 'utf8'),
]);
const checks = {
  activeReleaseAuthority:
    migration.includes('"active_release_id"') &&
    productionService.includes("status: 'active'"),
  immutableRollback:
    migration.includes('"story_releases"') &&
    service.includes('story_release.rollback_or_switch'),
  saveSlotsAndEndings:
    migration.includes('"story_save_slots"') &&
    migration.includes('"story_ending_discoveries"'),
  boundedMemory:
    service.includes('take: 50') &&
    service.includes('fullManuscriptIncluded: false'),
  reviewIdempotency:
    migration.includes('"story_final_submissions"') &&
    service.includes("idempotencyKey('story-final-submit'"),
  privacySafeMetrics:
    migration.includes('"session_key_hash"') &&
    policy.includes('qualityDimensionViolations'),
};
const failures = Object.entries(checks).filter(([, value]) => !value);
console.log(
  JSON.stringify(
    {
      runId: randomUUID(),
      publicPath: '/api/v1/stories',
      status: failures.length ? 'blocked' : 'passed',
      checks,
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
