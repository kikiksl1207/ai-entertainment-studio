import { createHmac } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const SCRIPT_NAME = 'scripts/verify-debut-status-owner-projection.mjs';
const CONFIRM_VALUE = 'VERIFY_DEBUT_STATUS_OWNER_PROJECTION';
const TASK_ID = '#352';

const STATUS_ORDER = ['needs_more_info', 'approved_for_contact', 'rejected'];
const EXPECTED_USER_STATUS = {
  needs_more_info: 'needs_more_info',
  approved_for_contact: 'approved',
  rejected: 'rejected',
};
const EXPLICIT_ID_ENV = {
  needs_more_info: 'DEBUT_STATUS_QA_NEEDS_MORE_INFO_ID',
  approved_for_contact: 'DEBUT_STATUS_QA_APPROVED_FOR_CONTACT_ID',
  rejected: 'DEBUT_STATUS_QA_REJECTED_ID',
};

const FORBIDDEN_TERMS = [
  'Internal',
  'review note',
  'call memo',
  'rights note',
  'partner note',
  'private/',
  '@example.invalid',
  'blocked-etag',
];

const config = {
  confirm: env('DEBUT_STATUS_QA_VERIFY_CONFIRM'),
  ownerUserId: env('DEBUT_STATUS_QA_USER_ID'),
  runId: env('DEBUT_STATUS_QA_FIXTURE_RUN_ID'),
  targetEnv: env('DEBUT_STATUS_QA_TARGET_ENV', env('NODE_ENV', 'development')),
  allowProduction: boolEnv('DEBUT_STATUS_QA_VERIFY_ALLOW_PRODUCTION'),
  dryRun: boolEnv('DEBUT_STATUS_QA_VERIFY_DRY_RUN'),
  expectNeedsMoreInfoCtaEnabled: boolEnv('DEBUT_STATUS_QA_EXPECT_NEEDS_MORE_INFO_CTA_ENABLED', true),
  explicitIds: Object.fromEntries(
    STATUS_ORDER.map((status) => [status, env(EXPLICIT_ID_ENV[status])]),
  ),
};

if (config.confirm !== CONFIRM_VALUE) {
  fail(
    [
      'Refusing to verify debut owner projection without explicit confirmation.',
      `Set DEBUT_STATUS_QA_VERIFY_CONFIRM=${CONFIRM_VALUE}.`,
      `Run from the server directory: node ${SCRIPT_NAME}`,
    ].join('\n'),
  );
}

if (isProductionLike(config.targetEnv) && !config.allowProduction) {
  fail(
    [
      'Production-like owner projection verification is blocked by default.',
      'Use a staging/local API and disposable owner whenever possible.',
      'If an explicitly approved live-safe read-only QA run is required, set',
      'DEBUT_STATUS_QA_VERIFY_ALLOW_PRODUCTION=true for that one run.',
    ].join('\n'),
  );
}

if (explicitTargetIdsPartiallyProvided(config.explicitIds)) {
  fail(
    [
      'Explicit fixture id mode requires all three status ids.',
      `Set ${Object.values(EXPLICIT_ID_ENV).join(', ')} together, or use DEBUT_STATUS_QA_USER_ID plus DEBUT_STATUS_QA_FIXTURE_RUN_ID.`,
    ].join('\n'),
  );
}

if (config.dryRun) {
  print({
    ok: true,
    dryRun: true,
    task: TASK_ID,
    targetSource: explicitTargetIdsProvided(config.explicitIds) ? 'explicit_ids' : 'runId',
    runId: config.runId || null,
    expectedOrder: STATUS_ORDER,
    expectedNeedsMoreInfoCtaEnabled: config.expectNeedsMoreInfoCtaEnabled,
    note: 'No database read, JWT signing, or API request was performed.',
  });
  process.exit(0);
}

const prisma = new PrismaClient();

try {
  const targets = await resolveTargets(prisma, config);
  const owner = await resolveFixtureOwner(prisma, targets);
  const token = signAccessToken(owner);
  const checks = [];

  for (const target of targets) {
    checks.push(await verifyTarget(target, token));
  }

  print({
    ok: checks.every((check) => check.pass),
    task: TASK_ID,
    runId: config.runId || null,
    targetSource: explicitTargetIdsProvided(config.explicitIds) ? 'explicit_ids' : 'runId',
    expectedOrder: STATUS_ORDER,
    checks,
    note:
      'No raw token, secret, cookie, password, DB URL, owner user UUID, raw email, or raw response body printed.',
  });
} finally {
  await prisma.$disconnect();
}

async function resolveTargets(prismaClient, currentConfig) {
  if (explicitTargetIdsProvided(currentConfig.explicitIds)) {
    return resolveExplicitTargets(prismaClient, currentConfig.explicitIds);
  }

  if (!isUuid(currentConfig.ownerUserId)) {
    throw new Error('DEBUT_STATUS_QA_USER_ID must be the disposable owner user UUID.');
  }

  if (!currentConfig.runId) {
    throw new Error('DEBUT_STATUS_QA_FIXTURE_RUN_ID is required unless explicit fixture ids are provided.');
  }

  const rows = await prismaClient.debutApplication.findMany({
    where: {
      userId: currentConfig.ownerUserId,
      status: { in: STATUS_ORDER },
      metadata: {
        path: ['qaFixture', 'runId'],
        equals: currentConfig.runId,
      },
    },
    select: { id: true, userId: true, status: true },
    orderBy: { createdAt: 'asc' },
  });

  return targetsFromRows(rows);
}

async function resolveExplicitTargets(prismaClient, explicitIds) {
  const ids = STATUS_ORDER.map((status) => explicitIds[status]);

  for (const id of ids) {
    if (!isUuid(id)) {
      throw new Error('Explicit debut status QA fixture ids must be valid UUIDs.');
    }
  }

  const rows = await prismaClient.debutApplication.findMany({
    where: { id: { in: ids } },
    select: { id: true, userId: true, status: true },
  });

  return targetsFromRows(rows);
}

function targetsFromRows(rows) {
  const rowsByStatus = new Map(rows.map((row) => [row.status, row]));
  const missing = STATUS_ORDER.filter((status) => !rowsByStatus.has(status));

  if (missing.length > 0 || rows.length !== STATUS_ORDER.length) {
    throw new Error(`Fixture rows are missing for statuses: ${missing.join(', ') || 'duplicate/unknown'}.`);
  }

  const ownerIds = [...new Set(rows.map((row) => row.userId))];

  if (ownerIds.length !== 1) {
    throw new Error('Fixture rows do not share one owner.');
  }

  return STATUS_ORDER.map((status) => {
    const row = rowsByStatus.get(status);

    return {
      id: row.id,
      rawStatus: status,
      expectedUserStatus: EXPECTED_USER_STATUS[status],
      ownerUserId: row.userId,
      path: `/api/v1/me/debut-applications/${row.id}/status`,
    };
  });
}

async function resolveFixtureOwner(prismaClient, targets) {
  const ownerIds = [...new Set(targets.map((target) => target.ownerUserId))];

  if (ownerIds.length !== 1) {
    throw new Error('Fixture targets do not share one owner.');
  }

  const user = await prismaClient.user.findUnique({
    where: { id: ownerIds[0] },
    select: { id: true, email: true, status: true, deletedAt: true },
  });

  if (!user || user.status !== 'active' || user.deletedAt) {
    throw new Error('Fixture owner is not an active user.');
  }

  return user;
}

function signAccessToken(user) {
  const secret = process.env.JWT_ACCESS_SECRET;

  if (!secret) {
    throw new Error('JWT access secret is missing in the execution environment.');
  }

  const now = Math.floor(Date.now() / 1000);

  return signJwt(
    {
      sub: user.id,
      email: user.email,
      tokenType: 'access',
      iat: now,
      exp: now + 600,
    },
    secret,
  );
}

async function verifyTarget(target, token) {
  const { base, res, data } = await fetchFirst(target.path, token);
  const payload = JSON.stringify(data ?? {});
  const app = data?.application ?? {};
  const notice = app.publicNotice ?? {};
  const privacy = app.privacy ?? {};
  const dispatch = notice.dispatch ?? {};
  const forbiddenLeakLabels = FORBIDDEN_TERMS.filter((term) => payload.includes(term));
  const statusHistory = Array.isArray(app.statusHistory)
    ? app.statusHistory.map((item) => item.status)
    : [];
  const expectedCtaEnabled =
    target.rawStatus === 'needs_more_info' ? config.expectNeedsMoreInfoCtaEnabled : false;
  const ctaMatches = app.cta?.enabled === expectedCtaEnabled;
  const ctaSafetyMatches =
    expectedCtaEnabled === true
      ? app.cta?.actionAllowed === true &&
        app.cta?.mutationAllowed === true &&
        app.cta?.contractOnly === false
      : app.cta?.actionAllowed === false &&
        app.cta?.mutationAllowed === false &&
        app.cta?.contractOnly === true;
  const pass =
    res.status === 200 &&
    data?.readOnly === true &&
    data?.ownerOnly === true &&
    app.status === target.expectedUserStatus &&
    app.materialSummary?.metadataOnly === true &&
    ctaMatches &&
    ctaSafetyMatches &&
    notice.status === target.expectedUserStatus &&
    dispatch.inAppSent === false &&
    dispatch.emailSent === false &&
    dispatch.contractOnly === true &&
    notice.internalAdminNoteReturned === false &&
    notice.settlementOrContractFinalized === false &&
    privacy.contactReturned === false &&
    privacy.introReturned === false &&
    privacy.adminReviewNoteReturned === false &&
    privacy.internalMetadataReturned === false &&
    privacy.privateMaterialUrlReturned === false &&
    forbiddenLeakLabels.length === 0;

  return {
    path: target.path,
    base,
    httpStatus: res.status,
    rawStatus: target.rawStatus,
    expectedUserStatus: target.expectedUserStatus,
    actualUserStatus: app.status ?? null,
    readOnly: data?.readOnly === true,
    ownerOnly: data?.ownerOnly === true,
    materialMetadataOnly: app.materialSummary?.metadataOnly === true,
    expectedCtaEnabled,
    cta: {
      enabled: app.cta?.enabled ?? null,
      messageKey: app.cta?.messageKey ?? null,
      actionAllowed: app.cta?.actionAllowed ?? null,
      mutationAllowed: app.cta?.mutationAllowed ?? null,
      contractOnly: app.cta?.contractOnly ?? null,
      disabledReasonKey: app.cta?.disabledReasonKey ?? null,
    },
    publicNotice: {
      status: notice.status ?? null,
      hasPublicReason: typeof notice.publicReason === 'string' && notice.publicReason.length > 0,
      inAppSent: dispatch.inAppSent ?? null,
      emailSent: dispatch.emailSent ?? null,
      contractOnly: dispatch.contractOnly ?? null,
      internalAdminNoteReturned: notice.internalAdminNoteReturned ?? null,
      settlementOrContractFinalized: notice.settlementOrContractFinalized ?? null,
    },
    privacy,
    statusHistory,
    forbiddenLeakLabels,
    pass,
  };
}

async function fetchFirst(path, token) {
  const bases = [
    process.env.DEBUT_STATUS_QA_API_BASE,
    process.env.RENDER_EXTERNAL_URL,
    `http://127.0.0.1:${process.env.PORT || 10000}`,
    config.allowProduction ? 'https://api.lumina-stage.com' : null,
  ].filter(Boolean);
  const errors = [];

  for (const base of bases) {
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
      const data = await res.json().catch(() => null);

      return {
        base: base.startsWith('http://127.0.0.1') ? 'localhost' : 'configured-qa-api-base',
        res,
        data,
      };
    } catch (error) {
      errors.push(safeErrorMessage(error));
    }
  }

  throw new Error(`All configured API bases failed: ${errors.join(' | ')}`);
}

function explicitTargetIdsProvided(explicitIds) {
  return STATUS_ORDER.every((status) => explicitIds[status]);
}

function explicitTargetIdsPartiallyProvided(explicitIds) {
  return STATUS_ORDER.some((status) => explicitIds[status]) && !explicitTargetIdsProvided(explicitIds);
}

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', secret).update(body).digest('base64url');

  return `${body}.${signature}`;
}

function base64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function env(key, fallback = '') {
  return process.env[key] ?? fallback;
}

function boolEnv(key, defaultValue = false) {
  const value = env(key);

  if (!value) {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase());
}

function isProductionLike(value) {
  return ['production', 'prod', 'live'].includes(value.trim().toLowerCase());
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function safeErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
