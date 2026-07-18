import { randomUUID } from 'node:crypto';

const runId = randomUUID();
const publicPath = '/api/v1/me/creator-studio/stories/:workId/lifecycle';
const relatedPublicPaths = [
  '/api/v1/me/stories/:workId/save-slots',
  '/api/v1/me/stories/:workId/endings',
];

if (process.env.STORY_LIFECYCLE_STAGING_MODE === 'preflight') {
  const checks = {
    originConfigured: configured('STORY_LIFECYCLE_STAGING_API_ORIGIN'),
    privateSessionConfigured: configured(
      'STORY_LIFECYCLE_STAGING_ACCESS_TOKEN',
    ),
    approvedWorkConfigured: configured('STORY_LIFECYCLE_STAGING_WORK_ID'),
    readOnlyExecution: true,
  };
  printResult(
    Object.values(checks).every(Boolean)
      ? 'ready_for_private_readonly_run'
      : 'blocked_private_session_required',
    checks,
  );
} else {
  try {
    await runReadOnlyVerification();
  } catch {
    printResult('failed', { readOnlyExecution: true }, true);
    process.exitCode = 1;
  }
}

async function runReadOnlyVerification() {
  const origin = requiredEnv('STORY_LIFECYCLE_STAGING_API_ORIGIN').replace(
    /\/+$/,
    '',
  );
  const accessToken = requiredEnv('STORY_LIFECYCLE_STAGING_ACCESS_TOKEN');
  const workId = requiredEnv('STORY_LIFECYCLE_STAGING_WORK_ID');
  const encodedWorkId = encodeURIComponent(workId);
  const [lifecycle, saveSlots, endings] = await Promise.all([
    authenticatedGet(
      `${origin}/api/v1/me/creator-studio/stories/${encodedWorkId}/lifecycle`,
      accessToken,
    ),
    authenticatedGet(
      `${origin}/api/v1/me/stories/${encodedWorkId}/save-slots`,
      accessToken,
    ),
    authenticatedGet(
      `${origin}/api/v1/me/stories/${encodedWorkId}/endings`,
      accessToken,
    ),
  ]);

  const statuses = new Set([
    'draft',
    'intake_received',
    'reviewing',
    'revision_requested',
    'release_ready',
    'published',
    'sale_suspended',
    'archived',
  ]);
  const slots = Array.isArray(saveSlots?.slots) ? saveSlots.slots : [];
  const endingRows = Array.isArray(endings) ? endings : [];
  const slotNumbers = slots.map((slot) => slot?.slotNumber);
  const endingKeys = endingRows.map((ending) => ending?.endingKey);
  const combined = JSON.stringify({ lifecycle, saveSlots, endings });
  const checks = {
    lifecycleRead: isRecord(lifecycle),
    lifecycleStateRecognized: statuses.has(lifecycle?.status),
    lifecycleTransitionSafe:
      lifecycle?.latestTransition == null ||
      (statuses.has(lifecycle.latestTransition.fromStatus) &&
        statuses.has(lifecycle.latestTransition.toStatus)),
    saveSlotsRead: isRecord(saveSlots) && Array.isArray(saveSlots.slots),
    minimumThreeSlots: Number(saveSlots?.minimumSlots) >= 3,
    slotNumbersValid:
      slotNumbers.every(
        (slotNumber) =>
          Number.isInteger(slotNumber) && slotNumber >= 1 && slotNumber <= 9,
      ) && new Set(slotNumbers).size === slotNumbers.length,
    endingGalleryRead: Array.isArray(endings),
    endingKeysUnique:
      endingKeys.every((endingKey) => typeof endingKey === 'string') &&
      new Set(endingKeys).size === endingKeys.length,
    privateChoiceHistoryExcluded:
      !/choiceHistory|rawChoice|manuscriptContent|storageKey|providerPayload/i.test(
        combined,
      ),
    readOnlyExecution: true,
  };
  const failed = Object.values(checks).some((value) => !value);
  printResult(failed ? 'blocked' : 'passed', checks);
  if (failed) process.exitCode = 1;
}

async function authenticatedGet(url, accessToken) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Read-only lifecycle request failed with HTTP ${response.status}`);
  }
  return response.json();
}

function printResult(status, checks, failed = false) {
  const output = JSON.stringify({
    runId,
    publicPath,
    relatedPublicPaths,
    status,
    checks,
    mutationExecuted: false,
  });
  if (failed) console.error(output);
  else console.log(output);
}

function configured(name) {
  return Boolean(process.env[name]?.trim());
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
