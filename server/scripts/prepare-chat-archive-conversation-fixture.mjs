import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const SCRIPT_NAME = 'scripts/prepare-chat-archive-conversation-fixture.mjs';
const CONFIRM_VALUE = 'PREPARE_CHARACTER_CHAT_ARCHIVE_QA_FIXTURE';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const config = {
  confirm: env('CHARACTER_CHAT_ARCHIVE_QA_CONFIRM'),
  userId: env('CHARACTER_CHAT_ARCHIVE_QA_USER_ID'),
  sessionId: env('CHARACTER_CHAT_ARCHIVE_QA_SESSION_ID'),
  action: env('CHARACTER_CHAT_ARCHIVE_QA_ACTION', 'archive'),
  targetEnv: env('CHARACTER_CHAT_ARCHIVE_QA_TARGET_ENV', env('NODE_ENV', 'development')),
  allowProduction: boolEnv('CHARACTER_CHAT_ARCHIVE_QA_ALLOW_PRODUCTION'),
  dryRun: boolEnv('CHARACTER_CHAT_ARCHIVE_QA_DRY_RUN'),
  force: boolEnv('CHARACTER_CHAT_ARCHIVE_QA_FORCE'),
};

if (config.confirm !== CONFIRM_VALUE) {
  fail(
    [
      'Refusing to prepare archive populated QA fixture without explicit confirmation.',
      `Set CHARACTER_CHAT_ARCHIVE_QA_CONFIRM=${CONFIRM_VALUE}.`,
      `Run from the server directory: node ${SCRIPT_NAME}`,
    ].join('\n'),
  );
}

if (!isUuid(config.userId)) {
  fail('CHARACTER_CHAT_ARCHIVE_QA_USER_ID must be the disposable owner user UUID.');
}

if (config.sessionId && !isUuid(config.sessionId)) {
  fail('CHARACTER_CHAT_ARCHIVE_QA_SESSION_ID must be a UUID when provided.');
}

if (!['archive', 'restore'].includes(config.action)) {
  fail('CHARACTER_CHAT_ARCHIVE_QA_ACTION must be archive or restore.');
}

if (config.action === 'restore' && !config.sessionId) {
  fail('restore action requires CHARACTER_CHAT_ARCHIVE_QA_SESSION_ID.');
}

if (isProductionLike(config.targetEnv) && !config.allowProduction) {
  fail(
    [
      'Production-like fixture preparation is blocked by default.',
      'Use local/staging whenever possible.',
      'If an explicitly approved live-safe disposable owner is required, set',
      'CHARACTER_CHAT_ARCHIVE_QA_ALLOW_PRODUCTION=true for that one run.',
    ].join('\n'),
  );
}

const prisma = new PrismaClient();

try {
  const owner = await resolveOwner(config.userId);
  const before = await inspectState(owner.id);
  const result =
    config.action === 'restore'
      ? await restoreFixture(owner.id, before)
      : await archiveFixture(owner.id, before);
  const after = result.changed && !config.dryRun ? await inspectState(owner.id) : before;

  print({
    ok: result.ok,
    task: '#276',
    action: config.action,
    dryRun: config.dryRun,
    targetEnv: config.targetEnv,
    ownerHash: hashValue(owner.id),
    before,
    after,
    result,
    safety: {
      chatSessionStatusMutation: result.changed && !config.dryRun,
      chatMessageMutation: false,
      llmCall: false,
      walletMutation: false,
      luminaMutation: false,
      featureOrderMutation: false,
      settlementMutation: false,
      secretsReturned: false,
      rawMessageBodyReturned: false,
      rawOwnerIdReturned: false,
      rawEmailReturned: false,
    },
    nextStep:
      'Run npm run qa:chat-conversation-list with the same approved disposable owner after this preparation succeeds.',
  });

  if (!result.ok) {
    process.exitCode = 2;
  }
} finally {
  await prisma.$disconnect();
}

async function resolveOwner(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true, deletedAt: true },
  });

  if (!user || user.status !== 'active' || user.deletedAt) {
    fail('Disposable QA owner user was not found or is not active.');
  }

  return user;
}

async function archiveFixture(userId, before) {
  if (before.archivePopulatedCount > 0 && !config.force) {
    return {
      ok: true,
      changed: false,
      reason: 'archive_populated_already_available',
      targetSessionHash: null,
    };
  }

  const target = await findTargetSession(userId, 'active');

  if (!target) {
    return {
      ok: false,
      changed: false,
      reason: 'no_active_populated_session_available',
      targetSessionHash: null,
    };
  }

  if (!config.dryRun) {
    await prisma.chatSession.update({
      where: { id: target.id },
      data: {
        status: 'archived',
        updatedAt: new Date(),
      },
      select: { id: true },
    });
  }

  return {
    ok: true,
    changed: true,
    reason: config.dryRun ? 'dry_run_archive_ready' : 'archived_existing_populated_session',
    targetSessionHash: hashValue(target.id),
    targetArtistSlug: target.artist.slug,
    targetMessageCount: target._count.messages,
    targetHasBodyPreview: hasPreview(target),
  };
}

async function restoreFixture(userId) {
  const target = await findTargetSession(userId, 'archived');

  if (!target) {
    return {
      ok: false,
      changed: false,
      reason: 'archived_populated_session_not_found_for_restore',
      targetSessionHash: config.sessionId ? hashValue(config.sessionId) : null,
    };
  }

  if (!config.dryRun) {
    await prisma.chatSession.update({
      where: { id: target.id },
      data: {
        status: 'active',
        updatedAt: new Date(),
      },
      select: { id: true },
    });
  }

  return {
    ok: true,
    changed: true,
    reason: config.dryRun ? 'dry_run_restore_ready' : 'restored_archived_fixture_to_active',
    targetSessionHash: hashValue(target.id),
    targetArtistSlug: target.artist.slug,
    targetMessageCount: target._count.messages,
    targetHasBodyPreview: hasPreview(target),
  };
}

async function inspectState(userId) {
  const rows = await prisma.chatSession.findMany({
    where: {
      userId,
      status: { in: ['active', 'archived'] },
      messages: { some: {} },
    },
    include: sessionInclude(),
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });
  const recent = rows.filter((row) => row.status === 'active');
  const archive = rows.filter((row) => row.status === 'archived');

  return {
    recentPopulatedCount: recent.length,
    archivePopulatedCount: archive.length,
    allPopulatedCount: rows.length,
    recentPreviewCount: recent.filter((row) => hasPreview(row)).length,
    archivePreviewCount: archive.filter((row) => hasPreview(row)).length,
  };
}

async function findTargetSession(userId, status) {
  if (config.sessionId) {
    const target = await prisma.chatSession.findFirst({
      where: {
        id: config.sessionId,
        userId,
        status,
        messages: { some: {} },
      },
      include: sessionInclude(),
    });

    return target && hasPreview(target) ? target : null;
  }

  const rows = await prisma.chatSession.findMany({
    where: {
      userId,
      status,
      messages: { some: {} },
    },
    include: sessionInclude(),
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: 10,
  });

  return rows.find((row) => hasPreview(row)) ?? null;
}

function sessionInclude() {
  return {
    artist: {
      select: { slug: true },
    },
    messages: {
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: {
        body: true,
        createdAt: true,
      },
    },
    _count: {
      select: { messages: true },
    },
  };
}

function hasPreview(session) {
  const message = session.messages?.[0];
  return typeof message?.body === 'string' && message.body.trim().length > 0;
}

function hashValue(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
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
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message) {
  console.error(`${SCRIPT_NAME}: ${message}`);
  process.exit(1);
}
