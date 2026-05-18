import { createHash, createHmac } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const SCRIPT_NAME = 'scripts/verify-chat-conversation-list-fixture.mjs';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const FORBIDDEN_PAYLOAD_TERMS = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'password',
  'cookie',
  'set-cookie',
  'authorization',
  'modelMetadata',
  'safetyMetadata',
];

const config = {
  userId: env('CHARACTER_CHAT_QA_USER_ID'),
  apiBase: env(
    'CHARACTER_CHAT_QA_API_BASE',
    env('RENDER_EXTERNAL_URL', `http://127.0.0.1:${env('PORT', '3001')}`),
  ),
  take: intEnv('CHARACTER_CHAT_QA_TAKE', 2),
  allowMissingArchive: boolEnv('CHARACTER_CHAT_QA_ALLOW_MISSING_ARCHIVE'),
};

if (!isUuid(config.userId)) {
  fail('CHARACTER_CHAT_QA_USER_ID must be the disposable owner user UUID.');
}

if (!env('JWT_ACCESS_SECRET')) {
  fail('JWT_ACCESS_SECRET is required to sign a short-lived owner-only QA token.');
}

const prisma = new PrismaClient();

try {
  const owner = await resolveOwner(config.userId);
  const fixtureState = await inspectFixtureState(owner.id);
  const token = signAccessToken(owner);
  const checks = [];

  for (const box of ['recent', 'archive', 'all']) {
    checks.push(await verifyConversationBox(box, token, fixtureState));
  }

  const blockedBy = blockersFor(fixtureState);
  const pass = blockedBy.length === 0 && checks.every((check) => check.pass);

  print({
    ok: pass,
    task: '#276/#287',
    status: pass ? 'PASS' : 'BLOCKED',
    runId: `qa276-chat-conversations-${new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14)}`,
    ownerHash: hashValue(owner.id),
    fixtureState,
    checks,
    blockedBy,
    note:
      'Read-only verifier only. It performs DB reads and authenticated GET requests; it does not create chat messages, call LLM, mutate wallet/Lumina/settlement, or print raw token, cookie, password, DB URL, raw email, owner UUID, or raw message body.',
  });

  if (!pass) {
    process.exitCode = 2;
  }
} finally {
  await prisma.$disconnect();
}

async function resolveOwner(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, status: true, deletedAt: true },
  });

  if (!user || user.status !== 'active' || user.deletedAt) {
    fail('Disposable QA owner user was not found or is not active.');
  }

  return user;
}

async function inspectFixtureState(userId) {
  const rows = await prisma.chatSession.findMany({
    where: {
      userId,
      status: { in: ['active', 'archived'] },
      messages: { some: {} },
    },
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          senderType: true,
          messageType: true,
          body: true,
          chatFeatureOrderId: true,
          createdAt: true,
        },
      },
      _count: {
        select: { messages: true },
      },
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });
  const recent = rows.filter((row) => row.status === 'active');
  const archive = rows.filter((row) => row.status === 'archived');

  return {
    recentPopulatedCount: recent.length,
    archivePopulatedCount: archive.length,
    allPopulatedCount: rows.length,
    recentHasLastMessagePreview: recent.some((row) => hasPreview(row)),
    archiveHasLastMessagePreview: archive.some((row) => hasPreview(row)),
    messageCountsPresent: rows.every(
      (row) => Number.isInteger(row._count?.messages) && row._count.messages > 0,
    ),
  };
}

async function verifyConversationBox(box, token, fixtureState) {
  const path = `/api/v1/chat/conversations?box=${box}&take=${config.take}`;
  const { res, data } = await fetchJson(path, token);
  const payload = JSON.stringify(data ?? {});
  const items = Array.isArray(data?.items) ? data.items : [];
  const forbiddenPayloadTerms = FORBIDDEN_PAYLOAD_TERMS.filter((term) =>
    payload.toLowerCase().includes(term.toLowerCase()),
  );
  const expectedPopulated = expectedPopulatedCount(box, fixtureState);
  const expectedAppliedTake = Math.min(config.take, 50);
  const itemShapePass = items.every((item) => hasConversationItemShape(item));
  const populatedShape = summarizePopulatedItems(items);
  const paginationContractPass =
    data?.paginationContract?.defaultTake === 20 &&
    data?.paginationContract?.maxTake === 50 &&
    data?.paginationContract?.appliedTake === expectedAppliedTake &&
    data?.paginationContract?.cursor === null &&
    data?.paginationContract?.cursorField === 'chat_sessions.id';
  const boxContractPass =
    data?.boxContract?.recentStatus === 'active' &&
    data?.boxContract?.archiveStatus === 'archived' &&
    Array.isArray(data?.boxContract?.allStatuses) &&
    data.boxContract.allStatuses.includes('active') &&
    data.boxContract.allStatuses.includes('archived');
  const itemShapeContractPass =
    data?.itemShapeContract?.itemsAlwaysArray === true &&
    data?.itemShapeContract?.emptyItemsAllowed === true &&
    data?.itemShapeContract?.lastMessagePreviewMaxChars === 120 &&
    data?.itemShapeContract?.lastMessageRawBodyReturned === false &&
    data?.itemShapeContract?.modelMetadataReturned === false &&
    data?.itemShapeContract?.safetyMetadataReturned === false;
  const emptyStatePass =
    items.length > 0 || data?.emptyState?.messageKey === expectedEmptyMessageKey(box);
  const populatedPass =
    expectedPopulated === 0 ||
    (items.length > 0 &&
      populatedShape.allReturnedItemsHaveMessageCount &&
      populatedShape.allReturnedItemsHaveLastMessage &&
      populatedShape.allReturnedItemsHaveBodyPreview &&
      populatedShape.allReturnedItemsHaveActivityTimestamps);
  const safety = data?.safety ?? {};
  const pass =
    res.status === 200 &&
    data?.readOnly === true &&
    data?.ownerOnly === true &&
    data?.box === box &&
    itemShapePass &&
    paginationContractPass &&
    boxContractPass &&
    itemShapeContractPass &&
    emptyStatePass &&
    (items.length > 0) === (expectedPopulated > 0) &&
    populatedPass &&
    safety.llmCall === false &&
    safety.walletMutation === false &&
    safety.messageMutation === false &&
    safety.orderMutation === false &&
    safety.settlementMutation === false &&
    safety.secretsReturned === false &&
    forbiddenPayloadTerms.length === 0;

  return {
    box,
    path,
    httpStatus: res.status,
    readOnly: data?.readOnly === true,
    ownerOnly: data?.ownerOnly === true,
    itemCount: items.length,
    expectedPopulatedCount: expectedPopulated,
    hasMore: data?.hasMore ?? null,
    nextCursorPresent: typeof data?.nextCursor === 'string' && data.nextCursor.length > 0,
    itemShapePass,
    paginationContractPass,
    boxContractPass,
    itemShapeContractPass,
    emptyStatePass,
    populatedShape,
    populatedPass,
    safety,
    forbiddenPayloadTerms,
    pass,
  };
}

function expectedEmptyMessageKey(box) {
  if (box === 'archive') {
    return 'chat.conversations.emptyArchive';
  }

  if (box === 'all') {
    return 'chat.conversations.emptyAll';
  }

  return 'chat.conversations.emptyRecent';
}

async function fetchJson(path, token) {
  const url = `${config.apiBase.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const data = await res.json().catch(() => null);

  return { res, data };
}

function blockersFor(fixtureState) {
  const blockers = [];

  if (fixtureState.recentPopulatedCount < 1) {
    blockers.push('No active chat session with at least one message for the QA owner.');
  }

  if (!config.allowMissingArchive && fixtureState.archivePopulatedCount < 1) {
    blockers.push(
      'No archived chat session with at least one message for the QA owner. Set CHARACTER_CHAT_QA_ALLOW_MISSING_ARCHIVE=true only when archive population is intentionally out of scope.',
    );
  }

  if (!fixtureState.messageCountsPresent) {
    blockers.push('At least one candidate fixture row is missing message count data.');
  }

  return blockers;
}

function expectedPopulatedCount(box, fixtureState) {
  if (box === 'recent') {
    return fixtureState.recentPopulatedCount;
  }

  if (box === 'archive') {
    return fixtureState.archivePopulatedCount;
  }

  return fixtureState.allPopulatedCount;
}

function hasConversationItemShape(item) {
  return (
    item &&
    typeof item === 'object' &&
    isUuid(item?.id) &&
    ['recent', 'archive'].includes(item?.box) &&
    typeof item?.status === 'string' &&
    typeof item?.artist?.slug === 'string' &&
    typeof item?.artist?.displayName === 'string' &&
    Number.isInteger(item?.messageCount) &&
    ('lastMessage' in item) &&
    ('lastMessageAt' in item) &&
    ('lastActivityAt' in item) &&
    item?.readState?.supported === false &&
    item?.readState?.unreadCount === null
  );
}

function hasPreview(row) {
  const message = row.messages?.[0];
  return typeof message?.body === 'string' && message.body.trim().length > 0;
}

function summarizePopulatedItems(items) {
  const total = items.length;
  const withMessageCount = items.filter((item) => item?.messageCount > 0).length;
  const withLastMessage = items.filter((item) => isObject(item?.lastMessage)).length;
  const withBodyPreview = items.filter((item) =>
    nonEmptyString(item?.lastMessage?.bodyPreview),
  ).length;
  const withActivityTimestamps = items.filter(
    (item) => nonEmptyString(item?.lastMessageAt) && nonEmptyString(item?.lastActivityAt),
  ).length;

  return {
    total,
    withMessageCount,
    withLastMessage,
    withBodyPreview,
    withActivityTimestamps,
    allReturnedItemsHaveMessageCount: total > 0 && withMessageCount === total,
    allReturnedItemsHaveLastMessage: total > 0 && withLastMessage === total,
    allReturnedItemsHaveBodyPreview: total > 0 && withBodyPreview === total,
    allReturnedItemsHaveActivityTimestamps:
      total > 0 && withActivityTimestamps === total,
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function signAccessToken(user) {
  const now = Math.floor(Date.now() / 1000);

  return signJwt(
    {
      sub: user.id,
      email: user.email,
      tokenType: 'access',
      iat: now,
      exp: now + 600,
    },
    env('JWT_ACCESS_SECRET'),
  );
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

function hashValue(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function env(key, fallback = '') {
  return process.env[key] ?? fallback;
}

function boolEnv(key) {
  return ['1', 'true', 'yes', 'y'].includes(env(key).trim().toLowerCase());
}

function intEnv(key, fallback) {
  const value = env(key);

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    fail(`${key} must be an integer from 1 to 50.`);
  }

  return parsed;
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
