const CONFIRM_VALUE = 'CREATE_FOLLOWER_BLOCK_QA_FIXTURE';
const HANDLE_PREFIX = 'qa-fb-';
const FIXTURE_STATUS = {
  dryRun: 'dry_run_preview_only',
  confirmed: 'confirmed_ready',
};

function env(name) {
  return process.env[name]?.trim() || '';
}

function todayRunId() {
  return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}

function normalizeRunId(value) {
  const runId = value || `qa-${todayRunId()}-run1`;
  if (!/^qa-[0-9]{8}-run[0-9]+$/.test(runId)) {
    throw new Error('FOLLOWER_BLOCK_QA_RUN_ID must match qa-YYYYMMDD-runN');
  }
  return runId;
}

function handleFor(role, runId) {
  return `${HANDLE_PREFIX}${runId}-${role}`.toLowerCase();
}

function assertQaHandle(handle) {
  if (!handle.startsWith(HANDLE_PREFIX)) {
    throw new Error(`Refusing to touch non-QA publicHandle: ${handle}`);
  }
}

function handoff(runId, targetHandle, followerHandle, fixtureStatus) {
  const encodedTarget = encodeURIComponent(targetHandle);
  return {
    runId,
    fixtureStatus,
    publicProfileHandle: targetHandle,
    publicProfilePath: `/user-profile?handle=${encodedTarget}`,
    publicProfileApiPath: `/api/v1/users/handle/${encodedTarget}/profile`,
    followersApiPath: `/api/v1/users/handle/${encodedTarget}/followers`,
    followingApiPath: `/api/v1/users/handle/${encodedTarget}/following-users`,
    blockApiPath: `/api/v1/users/handle/${encodedTarget}/block`,
    followerPublicHandle: followerHandle,
    notes: [
      'Record only this handoff object in PM/QA notes.',
      'Do not record raw email, password, token, cookie, API key, or DB URL.',
      'dry_run_preview_only is not PASS evidence for live/backend QA.',
      'Use read-only GET paths for QA unless a separately approved safe session is available.',
    ],
  };
}

async function upsertQaUser(prisma, publicHandle, displayName) {
  assertQaHandle(publicHandle);
  const existingProfile = await prisma.userProfile.findUnique({
    where: { publicHandle },
    select: { userId: true },
  });

  if (existingProfile) {
    await prisma.user.update({
      where: { id: existingProfile.userId },
      data: { status: 'active', deletedAt: null, updatedAt: new Date() },
    });
    await prisma.userProfile.update({
      where: { userId: existingProfile.userId },
      data: { displayName, bio: 'QA-only follower/block fixture', updatedAt: new Date() },
    });
    return existingProfile.userId;
  }

  const user = await prisma.user.create({
    data: {
      status: 'active',
      profile: {
        create: {
          publicHandle,
          displayName,
          bio: 'QA-only follower/block fixture',
        },
      },
      settings: {
        create: {
          locale: 'ko-KR',
          timezone: 'Asia/Seoul',
        },
      },
    },
    select: { id: true },
  });

  return user.id;
}

async function main() {
  const runId = normalizeRunId(env('FOLLOWER_BLOCK_QA_RUN_ID'));
  const dryRun = env('FOLLOWER_BLOCK_QA_FIXTURE_DRY_RUN') !== 'false';
  const targetHandle = handleFor('target', runId);
  const followerHandle = handleFor('follower', runId);
  const result = handoff(
    runId,
    targetHandle,
    followerHandle,
    dryRun ? FIXTURE_STATUS.dryRun : FIXTURE_STATUS.confirmed,
  );

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, ...result }, null, 2));
    return;
  }

  if (env('FOLLOWER_BLOCK_QA_FIXTURE_CONFIRM') !== CONFIRM_VALUE) {
    throw new Error(
      `Set FOLLOWER_BLOCK_QA_FIXTURE_CONFIRM=${CONFIRM_VALUE} to create QA-only rows.`,
    );
  }

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const targetUserId = await upsertQaUser(
      prisma,
      targetHandle,
      `QA Follower Target ${runId}`,
    );
    const followerUserId = await upsertQaUser(
      prisma,
      followerHandle,
      `QA Follower Source ${runId}`,
    );

    await prisma.userFollow.upsert({
      where: {
        followerUserId_followingUserId: {
          followerUserId,
          followingUserId: targetUserId,
        },
      },
      create: {
        followerUserId,
        followingUserId: targetUserId,
        status: 'active',
      },
      update: {
        status: 'active',
        deletedAt: null,
        updatedAt: new Date(),
      },
    });

    console.log(JSON.stringify({ dryRun: false, ...result }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        code: 'FOLLOWER_BLOCK_QA_FIXTURE_FAILED',
        message: error instanceof Error ? error.message : 'Unknown fixture error',
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
