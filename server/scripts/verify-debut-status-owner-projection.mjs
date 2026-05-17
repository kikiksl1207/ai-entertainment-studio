import { createHmac } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const TARGETS = [
  {
    rawStatus: 'needs_more_info',
    expectedUserStatus: 'needs_more_info',
    path: '/api/v1/me/debut-applications/48d6cc9f-946f-4fe2-abe7-b7f6e0645aec/status',
  },
  {
    rawStatus: 'approved_for_contact',
    expectedUserStatus: 'approved',
    path: '/api/v1/me/debut-applications/44b49916-b6b5-4e9c-9e7d-f4a5c4845acf/status',
  },
  {
    rawStatus: 'rejected',
    expectedUserStatus: 'rejected',
    path: '/api/v1/me/debut-applications/28e4b673-1499-4602-b6bf-abeb4a3fefd0/status',
  },
];

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

const prisma = new PrismaClient();

try {
  const owner = await resolveFixtureOwner();
  const token = signAccessToken(owner);
  const checks = [];

  for (const target of TARGETS) {
    checks.push(await verifyTarget(target, token));
  }

  print({
    ok: checks.every((check) => check.pass),
    task: '#267',
    runId: `qa267-owner-projection-${new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14)}`,
    checks,
    note:
      'No raw token, secret, cookie, password, DB URL, owner user UUID, raw email, or raw response body printed.',
  });
} finally {
  await prisma.$disconnect();
}

async function resolveFixtureOwner() {
  const ids = TARGETS.map((target) => applicationIdFromPath(target.path));
  const rows = await prisma.debutApplication.findMany({
    where: { id: { in: ids } },
    select: { id: true, userId: true, status: true },
  });
  const ownerIds = [...new Set(rows.map((row) => row.userId))];

  if (rows.length !== TARGETS.length || ownerIds.length !== 1) {
    throw new Error('Fixture rows are missing or do not share one owner.');
  }

  const user = await prisma.user.findUnique({
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
    throw new Error('JWT_ACCESS_SECRET is missing in Render environment.');
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
  const pass =
    res.status === 200 &&
    data?.readOnly === true &&
    data?.ownerOnly === true &&
    app.status === target.expectedUserStatus &&
    app.materialSummary?.metadataOnly === true &&
    app.cta?.enabled === false &&
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
    ctaEnabled: app.cta?.enabled ?? null,
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
    'https://api.lumina-stage.com',
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
        base: base.startsWith('http://127.0.0.1') ? 'localhost' : 'public-or-render-base',
        res,
        data,
      };
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(`All API bases failed: ${errors.join(' | ')}`);
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

function applicationIdFromPath(path) {
  const id = path.match(/debut-applications\/([^/]+)/)?.[1];

  if (!id) {
    throw new Error(`Could not parse application id from path: ${path}`);
  }

  return id;
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}
