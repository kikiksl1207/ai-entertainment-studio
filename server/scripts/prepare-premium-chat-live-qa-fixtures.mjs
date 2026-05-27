const SCRIPT_NAME = 'scripts/prepare-premium-chat-live-qa-fixtures.mjs';
const TASK_ID = '#534';
const CONFIRM_BY_MODE = {
  prepare: 'PREPARE_PREMIUM_CHAT_LIVE_QA_FIXTURES',
  verify: 'VERIFY_PREMIUM_CHAT_LIVE_QA_FIXTURES',
  cleanup: 'CLEANUP_PREMIUM_CHAT_LIVE_QA_FIXTURES',
};

const FIXTURES = [
  {
    qaBucket: 'baseline_active_room',
    roomStatus: 'active',
    amountLumina: '300',
    remainingUnits: 12,
    openedOffsetHours: -48,
    expiresOffsetHours: 72,
    lastUserMessageOffsetHours: -6,
    lastArtistReplyOffsetHours: -2,
  },
  {
    qaBucket: 'reported_room',
    roomStatus: 'paused_by_report',
    amountLumina: '300',
    remainingUnits: 8,
    openedOffsetHours: -36,
    expiresOffsetHours: 36,
    lastUserMessageOffsetHours: -4,
    reportedOffsetHours: -2,
  },
  {
    qaBucket: 'admin_review_room',
    roomStatus: 'admin_review',
    amountLumina: '500',
    remainingUnits: 8,
    openedOffsetHours: -36,
    expiresOffsetHours: 36,
    lastUserMessageOffsetHours: -5,
    reportedOffsetHours: -3,
    adminReviewOffsetHours: -1,
  },
  {
    qaBucket: 'unanswered_refund_candidate',
    roomStatus: 'refund_pending',
    amountLumina: '1000',
    remainingUnits: 4,
    openedOffsetHours: -50,
    expiresOffsetHours: 22,
    lastUserMessageOffsetHours: -26,
    refundCandidateOffsetHours: -1,
  },
  {
    qaBucket: 'near_expiry_room',
    roomStatus: 'active',
    amountLumina: '300',
    remainingUnits: 2,
    openedOffsetHours: -64,
    expiresOffsetHours: 8,
    lastUserMessageOffsetHours: -3,
    lastArtistReplyOffsetHours: -1,
  },
  {
    qaBucket: 'closed_room',
    roomStatus: 'closed_by_artist',
    amountLumina: '3000',
    remainingUnits: 0,
    openedOffsetHours: -72,
    expiresOffsetHours: 0,
    lastUserMessageOffsetHours: -30,
    lastArtistReplyOffsetHours: -25,
    closedOffsetHours: -2,
  },
  {
    qaBucket: 'expired_room',
    roomStatus: 'expired',
    amountLumina: '500',
    remainingUnits: 0,
    openedOffsetHours: -96,
    expiresOffsetHours: -1,
    lastUserMessageOffsetHours: -30,
  },
];

const config = {
  mode: env('PREMIUM_CHAT_QA_FIXTURE_MODE', 'dry-run').trim().toLowerCase(),
  confirm: env('PREMIUM_CHAT_QA_FIXTURE_CONFIRM'),
  ownerUserId: env('PREMIUM_CHAT_QA_OWNER_USER_ID'),
  artistSlug: env('PREMIUM_CHAT_QA_ARTIST_SLUG'),
  artistOperatorUserId: env('PREMIUM_CHAT_QA_ARTIST_OPERATOR_USER_ID'),
  runId: env('PREMIUM_CHAT_QA_FIXTURE_RUN_ID', defaultRunId()),
  targetEnv: env('PREMIUM_CHAT_QA_TARGET_ENV', env('NODE_ENV', 'development')),
  allowProduction: boolEnv('PREMIUM_CHAT_QA_FIXTURE_ALLOW_PRODUCTION'),
};

if (!['dry-run', 'prepare', 'verify', 'cleanup'].includes(config.mode)) {
  fail('PREMIUM_CHAT_QA_FIXTURE_MODE must be dry-run, prepare, verify, or cleanup.');
}

if (config.mode === 'dry-run') {
  print({
    ok: true,
    dryRun: true,
    task: TASK_ID,
    script: SCRIPT_NAME,
    runId: config.runId,
    plannedBuckets: FIXTURES.map(({ qaBucket, roomStatus }) => ({
      qaBucket,
      roomStatus,
    })),
    requiredEnvForPrepare: [
      'DATABASE_URL',
      'PREMIUM_CHAT_QA_OWNER_USER_ID',
      'PREMIUM_CHAT_QA_ARTIST_SLUG',
      'PREMIUM_CHAT_QA_FIXTURE_CONFIRM',
    ],
    optionalEnv: ['PREMIUM_CHAT_QA_ARTIST_OPERATOR_USER_ID'],
    note: 'No database connection or write was performed.',
  });
  process.exit(0);
}

if (config.confirm !== CONFIRM_BY_MODE[config.mode]) {
  fail(
    [
      `Refusing ${config.mode} without explicit confirmation.`,
      `Set PREMIUM_CHAT_QA_FIXTURE_CONFIRM=${CONFIRM_BY_MODE[config.mode]}.`,
      `Run from the server directory: node ${SCRIPT_NAME}`,
    ].join('\n'),
  );
}

if (!isUuid(config.ownerUserId)) {
  fail('PREMIUM_CHAT_QA_OWNER_USER_ID must be the approved QA owner user UUID.');
}

if (!config.artistSlug.trim()) {
  fail('PREMIUM_CHAT_QA_ARTIST_SLUG is required.');
}

if (config.artistOperatorUserId && !isUuid(config.artistOperatorUserId)) {
  fail('PREMIUM_CHAT_QA_ARTIST_OPERATOR_USER_ID must be a UUID when provided.');
}

if (isProductionLike(config.targetEnv) && !config.allowProduction) {
  fail(
    [
      'Production-like fixture operations are blocked by default.',
      'Use staging/local whenever possible.',
      'For an approved live-safe QA run, set',
      'PREMIUM_CHAT_QA_FIXTURE_ALLOW_PRODUCTION=true for that one run.',
    ].join('\n'),
  );
}

const prisma = await createPrismaClient();

try {
  const context = await resolveContext(prisma);

  if (config.mode === 'prepare') {
    await prepareFixtures(prisma, context);
  } else if (config.mode === 'verify') {
    await verifyFixtures(prisma, context);
  } else {
    await cleanupFixtures(prisma, context);
  }
} finally {
  await prisma.$disconnect();
}

async function resolveContext(prismaClient) {
  const [owner, artist] = await Promise.all([
    prismaClient.user.findUnique({
      where: { id: config.ownerUserId },
      select: { id: true, status: true, deletedAt: true },
    }),
    prismaClient.artist.findUnique({
      where: { slug: config.artistSlug.trim() },
      select: { id: true, slug: true, status: true },
    }),
  ]);

  if (!owner || owner.status !== 'active' || owner.deletedAt) {
    fail('Approved QA owner user was not found or is not active.');
  }

  if (!artist || artist.status !== 'active') {
    fail('Target artist was not found or is not active.');
  }

  if (config.artistOperatorUserId) {
    const operator = await prismaClient.artistOperator.findFirst({
      where: {
        userId: config.artistOperatorUserId,
        artistId: artist.id,
        status: 'active',
        revokedAt: null,
      },
      select: { id: true },
    });

    if (!operator) {
      fail('Artist operator QA user is not active for the selected artist.');
    }
  }

  return { owner, artist };
}

async function prepareFixtures(prismaClient, context) {
  const now = new Date();
  const existing = await findFixtureRows(prismaClient, context);
  const existingByBucket = new Map(
    existing.map((row) => [row.metadata?.qaFixture?.qaBucket, row]),
  );
  const created = [];
  const updated = [];

  for (const fixture of FIXTURES) {
    const data = fixtureData(fixture, context, now);
    const row = existingByBucket.get(fixture.qaBucket);

    if (row) {
      const updatedRow = await prismaClient.premiumChatRoom.update({
        where: { id: row.id },
        data,
        select: { id: true, status: true, metadata: true },
      });
      updated.push(toSafeFixtureResult(updatedRow));
    } else {
      const createdRow = await prismaClient.premiumChatRoom.create({
        data,
        select: { id: true, status: true, metadata: true },
      });
      created.push(toSafeFixtureResult(createdRow));
    }
  }

  const allRows = [...created, ...updated].sort(byBucketOrder);

  print({
    ok: true,
    mode: config.mode,
    task: TASK_ID,
    runId: config.runId,
    created,
    updated,
    qaEndpoints: endpointsForRows(allRows),
    sessionHandoff:
      'Sign in through the approved private QA credential/session channel only. Do not paste raw passwords, tokens, cookies, DB URLs, or raw emails into Notion, Git, chat, or QA reports.',
    noMutationPolicy: noMutationPolicy(),
  });
}

async function verifyFixtures(prismaClient, context) {
  const rows = await findFixtureRows(prismaClient, context);
  const rowsByBucket = new Map(
    rows.map((row) => [row.metadata?.qaFixture?.qaBucket, row]),
  );
  const checks = FIXTURES.map((fixture) => {
    const row = rowsByBucket.get(fixture.qaBucket);

    return {
      qaBucket: fixture.qaBucket,
      expectedStatus: fixture.roomStatus,
      roomId: row?.id ?? null,
      pass: Boolean(row && row.status === fixture.roomStatus),
      actualStatus: row?.status ?? null,
    };
  });

  print({
    ok: checks.every((check) => check.pass),
    mode: config.mode,
    task: TASK_ID,
    runId: config.runId,
    checks,
    qaEndpoints: endpointsForRows(rows.map(toSafeFixtureResult).sort(byBucketOrder)),
    note:
      'No API token, password, cookie, raw email, DB URL, wallet ledger id, or raw response body was printed.',
    noMutationPolicy: noMutationPolicy(),
  });
}

async function cleanupFixtures(prismaClient, context) {
  const rows = await findFixtureRows(prismaClient, context);
  const ids = rows.map((row) => row.id);

  if (ids.length > 0) {
    await prismaClient.premiumChatRoom.deleteMany({
      where: { id: { in: ids } },
    });
  }

  print({
    ok: true,
    mode: config.mode,
    task: TASK_ID,
    runId: config.runId,
    deletedCount: ids.length,
    deletedBuckets: rows
      .map((row) => row.metadata?.qaFixture?.qaBucket)
      .filter(Boolean)
      .sort(),
    note:
      'Only premium_chat_rooms rows tagged as #534 QA fixtures for this run id were deleted.',
    noMutationPolicy: noMutationPolicy(),
  });
}

async function findFixtureRows(prismaClient, context) {
  return prismaClient.premiumChatRoom.findMany({
    where: {
      ownerUserId: context.owner.id,
      artistId: context.artist.id,
      AND: [
        {
          metadata: {
            path: ['qaFixture', 'task'],
            equals: TASK_ID,
          },
        },
        {
          metadata: {
            path: ['qaFixture', 'runId'],
            equals: config.runId,
          },
        },
      ],
    },
    select: { id: true, status: true, metadata: true },
    orderBy: { createdAt: 'asc' },
  });
}

function fixtureData(fixture, context, now) {
  return {
    ownerUserId: context.owner.id,
    artistId: context.artist.id,
    tierKey: tierKeyForAmount(fixture.amountLumina),
    status: fixture.roomStatus,
    amountLumina: fixture.amountLumina,
    remainingUnits: fixture.remainingUnits,
    openedAt: dateFromOffset(now, fixture.openedOffsetHours),
    expiresAt: dateFromOffset(now, fixture.expiresOffsetHours),
    lastUserMessageAt: dateFromOffset(now, fixture.lastUserMessageOffsetHours),
    lastArtistReplyAt: dateFromOffset(now, fixture.lastArtistReplyOffsetHours),
    lastSupportAt: null,
    reportedAt: dateFromOffset(now, fixture.reportedOffsetHours),
    adminReviewAt: dateFromOffset(now, fixture.adminReviewOffsetHours),
    refundCandidateAt: dateFromOffset(now, fixture.refundCandidateOffsetHours),
    closedAt: dateFromOffset(now, fixture.closedOffsetHours),
    metadata: {
      qaFixture: {
        task: TASK_ID,
        runId: config.runId,
        qaBucket: fixture.qaBucket,
        expectedRoomStatus: fixture.roomStatus,
        readOnlyStatusMatrixOnly: true,
        createdBy: SCRIPT_NAME,
        updatedAt: now.toISOString(),
        productionCustomerDataAllowed: false,
        paymentMutation: false,
        supportDonationMutation: false,
        walletMutation: false,
        reportMutation: false,
        refundMutation: false,
        settlementMutation: false,
        payoutMutation: false,
      },
    },
  };
}

function toSafeFixtureResult(row) {
  const qaBucket = row.metadata?.qaFixture?.qaBucket ?? 'unknown';

  return {
    qaBucket,
    roomStatus: row.status,
    roomId: row.id,
  };
}

function endpointsForRows(rows) {
  return rows.map((row) => ({
    qaBucket: row.qaBucket,
    roomStatus: row.roomStatus,
    publicListPath:
      row.roomStatus === 'active'
        ? '/api/v1/chat/premium-rooms?status=active&take=20'
        : null,
    ownerStatusPath: `/api/v1/chat/me/premium-rooms/${row.roomId}/status`,
    artistStatusPath: `/api/v1/creator-studio/premium-chat/rooms/${row.roomId}/status`,
  }));
}

function byBucketOrder(left, right) {
  return bucketIndex(left.qaBucket) - bucketIndex(right.qaBucket);
}

function bucketIndex(bucket) {
  const index = FIXTURES.findIndex((fixture) => fixture.qaBucket === bucket);

  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function tierKeyForAmount(amountLumina) {
  return `premium_chat_room_${amountLumina}`;
}

function dateFromOffset(now, offsetHours) {
  if (offsetHours === undefined || offsetHours === null) {
    return null;
  }

  return new Date(now.getTime() + offsetHours * 60 * 60 * 1000);
}

function defaultRunId() {
  return `qa534-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
}

function noMutationPolicy() {
  return {
    actualPaymentMutation: false,
    supportDonationMutation: false,
    walletDebitMutation: false,
    walletCreditMutation: false,
    reportMutation: false,
    refundMutation: false,
    settlementMutation: false,
    payoutMutation: false,
  };
}

function env(key, fallback = '') {
  return process.env[key] ?? fallback;
}

async function createPrismaClient() {
  const { PrismaClient } = await import('@prisma/client');

  return new PrismaClient();
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

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
