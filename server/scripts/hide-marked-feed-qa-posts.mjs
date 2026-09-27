import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const qaAuthorIds = [
  '0a4afcae-3a5c-474b-8c9a-7a36f694b4d5',
  '271dc514-961e-420e-9111-28dafc7ca99f',
];
const marker = /^QA(?:357|358)(?=\s|$|[-:])/i;
const apply = process.argv.includes('--apply');
const expectedArg = process.argv.find((arg) => arg.startsWith('--expected='));
const expected = expectedArg ? Number(expectedArg.slice('--expected='.length)) : null;

if (apply && (!Number.isInteger(expected) || expected < 1)) {
  throw new Error('Apply requires --expected=<dry-run count>');
}

async function candidates(db) {
  const posts = await db.communityPost.findMany({
    where: {
      authorUserId: { in: qaAuthorIds },
      status: 'published',
      visibility: 'public',
      deletedAt: null,
      OR: [
        { body: { startsWith: 'QA357', mode: 'insensitive' } },
        { body: { startsWith: 'QA358', mode: 'insensitive' } },
      ],
    },
    select: { id: true, authorUserId: true, body: true, metadata: true, status: true },
    orderBy: { createdAt: 'desc' },
  });
  return posts.filter((post) => marker.test(post.body));
}

try {
  const posts = await candidates(prisma);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', count: posts.length, posts: posts.map(({ id, authorUserId, body }) => ({ id, authorUserId, body })) }, null, 2));
  if (!apply) process.exitCode = 0;
  else {
    if (posts.length !== expected) throw new Error(`Expected ${expected} posts, found ${posts.length}`);
    const ids = posts.map((post) => post.id);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const current = await candidates(tx);
      if (current.length !== expected || current.some((post) => !ids.includes(post.id))) {
        throw new Error('Feed QA target set changed after dry run');
      }
      for (const post of current) {
        const metadata = post.metadata && typeof post.metadata === 'object' && !Array.isArray(post.metadata) ? post.metadata : {};
        const previousModeration = metadata.moderation && typeof metadata.moderation === 'object' && !Array.isArray(metadata.moderation)
          ? metadata.moderation : {};
        await tx.communityPost.update({
          where: { id: post.id },
          data: {
            status: 'hidden',
            updatedAt: now,
            metadata: {
              ...metadata,
              moderation: {
                ...previousModeration,
                status: 'hidden',
                reason: 'approved_qa_cleanup',
                note: 'User-approved cleanup of QA357/QA358 public test posts',
                hiddenBy: 'release-script-2026-09-27',
                hiddenAt: now.toISOString(),
              },
            },
          },
        });
        await tx.auditEvent.create({
          data: {
            actorType: 'system',
            action: 'community_post.hide',
            targetType: 'community_post',
            targetId: post.id,
            beforeData: { status: post.status },
            afterData: { status: 'hidden' },
            metadata: { reason: 'approved_qa_cleanup', source: 'release-script-2026-09-27' },
          },
        });
      }
    }, { timeout: 30_000 });
    const remaining = await candidates(prisma);
    if (remaining.length) throw new Error(`${remaining.length} marked QA posts remain public`);
    console.log(`Hidden ${posts.length} marked QA posts with audit records; restore remains available.`);
  }
} finally {
  await prisma.$disconnect();
}
