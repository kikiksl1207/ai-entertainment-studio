import { PrismaClient } from '@prisma/client';

const SCRIPT_NAME = 'scripts/create-debut-status-owner-fixtures.mjs';
const CONFIRM_VALUE = 'CREATE_DEBUT_STATUS_OWNER_FIXTURES';

const FIXTURES = [
  {
    status: 'needs_more_info',
    userStatus: 'needs_more_info',
    displayName: 'QA Debut Status - Needs More Info',
    publicStatusReason: '보완 확인이 필요한 QA 전용 상태입니다.',
    requestedActionKey: 'debut.application.action.provideMoreInfo',
  },
  {
    status: 'approved_for_contact',
    userStatus: 'approved',
    displayName: 'QA Debut Status - Approved For Contact',
    publicStatusReason: '연락 준비 상태를 확인하는 QA 전용 상태입니다.',
    requestedActionKey: null,
  },
  {
    status: 'rejected',
    userStatus: 'rejected',
    displayName: 'QA Debut Status - Rejected',
    publicStatusReason: '심사 종료 안내를 확인하는 QA 전용 상태입니다.',
    requestedActionKey: null,
  },
];

const config = {
  confirm: env('DEBUT_STATUS_QA_FIXTURE_CONFIRM'),
  userId: env('DEBUT_STATUS_QA_USER_ID'),
  runId: env('DEBUT_STATUS_QA_FIXTURE_RUN_ID', defaultRunId()),
  targetEnv: env('DEBUT_STATUS_QA_TARGET_ENV', env('NODE_ENV', 'development')),
  allowProduction: boolEnv('DEBUT_STATUS_QA_FIXTURE_ALLOW_PRODUCTION'),
  dryRun: boolEnv('DEBUT_STATUS_QA_FIXTURE_DRY_RUN'),
};

if (config.confirm !== CONFIRM_VALUE) {
  fail(
    [
      'Refusing to create debut status QA fixtures without explicit confirmation.',
      `Set DEBUT_STATUS_QA_FIXTURE_CONFIRM=${CONFIRM_VALUE}.`,
      `Run from the server directory: node ${SCRIPT_NAME}`,
    ].join('\n'),
  );
}

if (!isUuid(config.userId)) {
  fail('DEBUT_STATUS_QA_USER_ID must be the disposable owner user UUID.');
}

if (isProductionLike(config.targetEnv) && !config.allowProduction) {
  fail(
    [
      'Production-like fixture creation is blocked by default.',
      'Use a staging/local database whenever possible.',
      'If an explicitly approved live-safe QA owner is required, set',
      'DEBUT_STATUS_QA_FIXTURE_ALLOW_PRODUCTION=true for that one run.',
    ].join('\n'),
  );
}

if (config.dryRun) {
  printResult({
    ok: true,
    dryRun: true,
    runId: config.runId,
    targetEnv: config.targetEnv,
    plannedStatuses: FIXTURES.map(({ status, userStatus }) => ({ status, userStatus })),
    note: 'No database writes were performed.',
  });
  process.exit(0);
}

const prisma = new PrismaClient();

try {
  const user = await prisma.user.findUnique({
    where: { id: config.userId },
    select: { id: true, status: true, deletedAt: true },
  });

  if (!user || user.deletedAt || user.status !== 'active') {
    fail('Disposable QA owner user was not found or is not active.');
  }

  const existing = await prisma.debutApplication.findMany({
    where: {
      userId: config.userId,
      metadata: {
        path: ['qaFixture', 'runId'],
        equals: config.runId,
      },
    },
    select: { id: true, status: true },
    orderBy: { createdAt: 'asc' },
  });
  const existingStatuses = new Set(existing.map((item) => item.status));
  const now = new Date();
  const submittedAt = new Date(now.getTime() - 10 * 60 * 1000);
  const created = [];

  for (const fixture of FIXTURES) {
    if (existingStatuses.has(fixture.status)) {
      continue;
    }

    const application = await prisma.debutApplication.create({
      data: {
        userId: config.userId,
        status: fixture.status,
        applicantName: 'QA Debut Status Fixture',
        displayName: fixture.displayName,
        contactEmail: contactEmailFor(fixture.status, config.runId),
        contactPhone: null,
        isAdult: true,
        participationType: 'appearance_only',
        shareTierRequested: null,
        shareTierApproved: null,
        intro: 'Disposable QA fixture for debut status owner projection only.',
        portfolioUrl: null,
        consentAppearance: true,
        consentVoice: false,
        consentRevenuePolicy: true,
        consentPrivacy: true,
        consentMarketing: false,
        reviewNote: 'Internal QA fixture review note must not be exposed.',
        metadata: metadataFor(fixture, config.runId, now),
        createdAt: submittedAt,
        updatedAt: now,
      },
      select: { id: true, status: true },
    });
    created.push(application);
  }

  printResult({
    ok: true,
    dryRun: false,
    runId: config.runId,
    targetEnv: config.targetEnv,
    created,
    existing,
    statusEndpoints: [...created, ...existing].map((item) => ({
      status: item.status,
      path: `/api/v1/me/debut-applications/${item.id}/status`,
    })),
    note: 'Use only with the disposable owner session. No dispatch, wallet, settlement, contract, payout, or Lumina mutation was performed by this script.',
  });
} finally {
  await prisma.$disconnect();
}

function metadataFor(fixture, runId, now) {
  return removeNullish({
    applicationChannel: 'online_review',
    applicationType: 'personal_unaffiliated',
    materialSubmissionMode: 'qa_fixture_no_private_material',
    publicStatusReason: fixture.publicStatusReason,
    requestedActionKey: fixture.requestedActionKey,
    adminReviewUpdatedAt: now.toISOString(),
    qaFixture: {
      task: '#259',
      runId,
      disposable: true,
      status: fixture.status,
      expectedUserStatus: fixture.userStatus,
      createdBy: SCRIPT_NAME,
      createdAt: now.toISOString(),
      safeOwnerProjectionOnly: true,
    },
  });
}

function contactEmailFor(status, runId) {
  const safeRunId = runId.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 48);
  return `qa-debut-status-${status}-${safeRunId}@example.invalid`;
}

function defaultRunId() {
  return `qa259-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
}

function env(key, fallback = '') {
  return process.env[key] ?? fallback;
}

function boolEnv(key) {
  return ['1', 'true', 'yes', 'y'].includes(env(key).trim().toLowerCase());
}

function isProductionLike(value) {
  return ['production', 'prod', 'live'].includes(value.trim().toLowerCase());
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function removeNullish(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== null && entryValue !== undefined),
  );
}

function printResult(value) {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
