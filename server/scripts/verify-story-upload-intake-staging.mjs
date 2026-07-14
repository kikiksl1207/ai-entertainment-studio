import { randomUUID } from 'node:crypto';

const runId = randomUUID();
const publicPath = '/api/v1/story-upload/intake';

if (process.env.STORY_UPLOAD_STAGING_MODE === 'preflight') {
  const originConfigured = Boolean(
    process.env.STORY_UPLOAD_STAGING_API_ORIGIN?.trim(),
  );
  const privateSessionConfigured = Boolean(
    process.env.STORY_UPLOAD_STAGING_ACCESS_TOKEN?.trim(),
  );
  console.log(
    JSON.stringify({
      runId,
      publicPath,
      status:
        originConfigured && privateSessionConfigured
          ? 'ready_for_private_run'
          : 'blocked_private_session_required',
      checks: { originConfigured, privateSessionConfigured },
      mutationExecuted: false,
    }),
  );
  process.exit(0);
}

const origin = requiredEnv('STORY_UPLOAD_STAGING_API_ORIGIN').replace(/\/+$/, '');
const accessToken = requiredEnv('STORY_UPLOAD_STAGING_ACCESS_TOKEN');
const endpoint = `${origin}/api/v1/story-upload/intake`;
const idempotencyKey = `story-intake-smoke-${randomUUID()}`;
const syntheticTitle = `Synthetic staging intake ${new Date().toISOString()}`;

const first = await submitSyntheticIntake(idempotencyKey);
assertReceipt(first, false);
const replay = await submitSyntheticIntake(idempotencyKey);
assertReceipt(replay, true);
if (first.submissionId !== replay.submissionId) {
  throw new Error('Idempotent retry returned a different submission');
}

await assertRejectedExtension();
if (process.env.STORY_UPLOAD_STAGING_TEST_LIMITS !== '0') {
  await assertRejectedSize();
}

console.log(
  JSON.stringify({
    runId,
    publicPath,
    status: 'passed',
    checks: {
      receiptReturned: first.status === 'received',
      idempotentReplay: replay.replayed,
      expectedFileCount: first.fileCount === 3,
      extensionRejected: true,
      sizeRejected:
        process.env.STORY_UPLOAD_STAGING_TEST_LIMITS === '0' ? null : true,
    },
    mutationExecuted: true,
  }),
);

async function submitSyntheticIntake(key) {
  const form = baseForm();
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
  form.append('visuals', new Blob([tinyPng()], { type: 'image/png' }), 'cover.png');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Idempotency-Key': key,
    },
    body: form,
  });
  if (!response.ok) throw new Error(`Story intake failed with HTTP ${response.status}`);
  return response.json();
}

async function assertRejectedExtension() {
  const form = baseForm();
  form.append(
    'manuscripts',
    new Blob(['synthetic-invalid-extension'], { type: 'application/octet-stream' }),
    'synthetic.exe',
  );
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Idempotency-Key': `story-intake-extension-${randomUUID()}`,
    },
    body: form,
  });
  if (response.status !== 400) {
    throw new Error(`Extension rejection expected HTTP 400, got ${response.status}`);
  }
}

async function assertRejectedSize() {
  const form = baseForm();
  form.append(
    'manuscripts',
    new Blob([new Uint8Array(50 * 1024 * 1024 + 1)], {
      type: 'text/plain',
    }),
    'synthetic-oversized.txt',
  );
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Idempotency-Key': `story-intake-size-${randomUUID()}`,
    },
    body: form,
  });
  if (response.status !== 413) {
    throw new Error(`Size rejection expected HTTP 413, got ${response.status}`);
  }
}

function baseForm() {
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

function tinyPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=',
    'base64',
  );
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
