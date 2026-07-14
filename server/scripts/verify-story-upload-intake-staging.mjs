import { randomUUID } from 'node:crypto';

const runId = randomUUID();
const publicPath = '/api/v1/story-upload/intake';
let mutationExecuted = false;

if (process.env.STORY_UPLOAD_STAGING_MODE === 'preflight') {
  const originConfigured = configured('STORY_UPLOAD_STAGING_API_ORIGIN');
  const privateSessionConfigured = configured(
    'STORY_UPLOAD_STAGING_ACCESS_TOKEN',
  );
  const persistenceInspectionConfigured = configured('DATABASE_URL');
  printResult({
    status:
      originConfigured &&
      privateSessionConfigured &&
      persistenceInspectionConfigured
        ? 'ready_for_private_run'
        : 'blocked_private_session_required',
    checks: {
      originConfigured,
      privateSessionConfigured,
      persistenceInspectionConfigured,
    },
  });
} else {
  try {
    await runStagingVerification();
  } catch {
    printResult({ status: 'failed', checks: {} }, true);
    process.exitCode = 1;
  }
}

async function runStagingVerification() {
  const origin = requiredEnv('STORY_UPLOAD_STAGING_API_ORIGIN').replace(
    /\/+$/,
    '',
  );
  const accessToken = requiredEnv('STORY_UPLOAD_STAGING_ACCESS_TOKEN');
  requiredEnv('DATABASE_URL');
  const endpoint = `${origin}${publicPath}`;
  const userId = accessTokenSubject(accessToken);
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const idempotencyKey = `story-intake-smoke-${randomUUID()}`;
  const syntheticTitle = `Synthetic staging intake ${new Date().toISOString()}`;

  try {
    const beforeIntake = await countPersistenceWrites(prisma, userId);
    mutationExecuted = true;
    const first = await submitSyntheticIntake(
      endpoint,
      accessToken,
      idempotencyKey,
      syntheticTitle,
    );
    assertReceipt(first, false);
    const afterIntake = await countPersistenceWrites(prisma, userId);
    assertWriteDelta(beforeIntake, afterIntake, {
      submissions: 1,
      files: 3,
      audits: 1,
    });

    const replay = await submitSyntheticIntake(
      endpoint,
      accessToken,
      idempotencyKey,
      syntheticTitle,
    );
    assertReceipt(replay, true);
    if (first.submissionId !== replay.submissionId) {
      throw new Error('Idempotent retry returned a different submission');
    }
    assertSameWriteCounts(
      afterIntake,
      await countPersistenceWrites(prisma, userId),
    );

    await assertRejectedWithoutWrites(prisma, userId, () =>
      assertRejectedExtension(endpoint, accessToken, syntheticTitle),
    );
    await assertRejectedWithoutWrites(prisma, userId, () =>
      assertRejectedSignature(endpoint, accessToken, syntheticTitle),
    );

    const sizeRejected = process.env.STORY_UPLOAD_STAGING_TEST_LIMITS !== '0';
    if (sizeRejected) {
      await assertRejectedWithoutWrites(prisma, userId, () =>
        assertRejectedSize(endpoint, accessToken, syntheticTitle),
      );
    }

    printResult({
      status: 'passed',
      checks: {
        receiptReturned: first.status === 'received',
        expectedFileCount: first.fileCount === 3,
        persistenceCounts: true,
        idempotentReplay: replay.replayed,
        replayZeroAdditionalWrites: true,
        extensionRejectedZeroWrites: true,
        signatureRejectedZeroWrites: true,
        sizeRejectedZeroWrites: sizeRejected ? true : null,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function submitSyntheticIntake(
  endpoint,
  accessToken,
  key,
  syntheticTitle,
) {
  const form = baseForm(syntheticTitle);
  form.append(
    'manuscripts',
    new Blob(['# Synthetic staging manuscript'], { type: 'text/markdown' }),
    'synthetic-final.md',
  );
  form.append(
    'metadata',
    new Blob(['{"branches":[],"endings":[]}'], { type: 'application/json' }),
    'synthetic-branches.json',
  );
  form.append(
    'visuals',
    new Blob([tinyPng()], { type: 'image/png' }),
    'cover.png',
  );
  const response = await authenticatedPost(endpoint, accessToken, key, form);
  if (!response.ok) {
    throw new Error(`Story intake failed with HTTP ${response.status}`);
  }
  return response.json();
}

async function assertRejectedExtension(endpoint, accessToken, syntheticTitle) {
  const form = baseForm(syntheticTitle);
  form.append(
    'manuscripts',
    new Blob(['synthetic-invalid-extension'], {
      type: 'application/octet-stream',
    }),
    'synthetic.exe',
  );
  await assertHttpStatus(endpoint, accessToken, form, 'extension', 400);
}

async function assertRejectedSignature(endpoint, accessToken, syntheticTitle) {
  const form = baseForm(syntheticTitle);
  form.append(
    'manuscripts',
    new Blob(['synthetic-invalid-pdf-signature'], { type: 'application/pdf' }),
    'synthetic.pdf',
  );
  await assertHttpStatus(endpoint, accessToken, form, 'signature', 400);
}

async function assertRejectedSize(endpoint, accessToken, syntheticTitle) {
  const form = baseForm(syntheticTitle);
  form.append(
    'manuscripts',
    new Blob([new Uint8Array(50 * 1024 * 1024 + 1)], {
      type: 'text/plain',
    }),
    'synthetic-oversized.txt',
  );
  await assertHttpStatus(endpoint, accessToken, form, 'size', 413);
}

async function assertHttpStatus(
  endpoint,
  accessToken,
  form,
  fixtureName,
  expectedStatus,
) {
  const response = await authenticatedPost(
    endpoint,
    accessToken,
    `story-intake-${fixtureName}-${randomUUID()}`,
    form,
  );
  if (response.status !== expectedStatus) {
    throw new Error(
      `${fixtureName} rejection expected HTTP ${expectedStatus}, got ${response.status}`,
    );
  }
}

function authenticatedPost(endpoint, accessToken, key, form) {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Idempotency-Key': key,
    },
    body: form,
  });
}

function baseForm(syntheticTitle) {
  const form = new FormData();
  form.append('title', syntheticTitle);
  form.append('originalLocale', 'ko');
  form.append('sourceClass', 'original');
  form.append('submissionType', 'final');
  return form;
}

function assertReceipt(receipt, replayed) {
  if (
    !receipt ||
    typeof receipt.submissionId !== 'string' ||
    receipt.status !== 'received' ||
    receipt.submissionType !== 'final' ||
    receipt.fileCount !== 3 ||
    receipt.replayed !== replayed
  ) {
    throw new Error('Story intake returned an invalid safe receipt');
  }
  for (const forbidden of ['storageKey', 'rightsReference', 'files']) {
    if (Object.prototype.hasOwnProperty.call(receipt, forbidden)) {
      throw new Error('Story intake receipt exposed a private field');
    }
  }
}

async function countPersistenceWrites(prisma, userId) {
  const [submissions, files, audits] = await Promise.all([
    prisma.storyUploadSubmission.count({ where: { userId } }),
    prisma.storyUploadSubmissionFile.count({
      where: { submission: { userId } },
    }),
    prisma.auditEvent.count({
      where: { actorUserId: userId, action: 'story_upload_intake_received' },
    }),
  ]);
  return { submissions, files, audits };
}

async function assertRejectedWithoutWrites(prisma, userId, request) {
  const before = await countPersistenceWrites(prisma, userId);
  await request();
  assertSameWriteCounts(before, await countPersistenceWrites(prisma, userId));
}

function assertWriteDelta(before, after, expected) {
  for (const key of Object.keys(expected)) {
    if (after[key] - before[key] !== expected[key]) {
      throw new Error(`Unexpected ${key} persistence delta`);
    }
  }
}

function assertSameWriteCounts(before, after) {
  assertWriteDelta(before, after, { submissions: 0, files: 0, audits: 0 });
}

function accessTokenSubject(accessToken) {
  const encodedPayload = accessToken.split('.')[1];
  if (!encodedPayload) throw new Error('Private QA session token is invalid');
  let payload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    );
  } catch {
    throw new Error('Private QA session token is invalid');
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new Error('Private QA session token subject is missing');
  }
  return payload.sub;
}

function tinyPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=',
    'base64',
  );
}

function printResult({ status, checks }, failed = false) {
  const output = JSON.stringify({
    runId,
    publicPath,
    status,
    checks,
    mutationExecuted,
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
