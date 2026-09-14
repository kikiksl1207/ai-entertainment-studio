import { ConflictException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PreparedManuscript, storedManuscriptBody } from './story-manuscript-file.policy';

const receiptSelect = {
  id: true, workId: true, ownerUserId: true, version: true, locale: true, contentHash: true, createdAt: true,
} as const;

export async function requireManuscriptOwner(
  prisma: Pick<Prisma.TransactionClient, 'storyWork'>, userId: string, workId: string,
) {
  const work = await prisma.storyWork.findFirst({ where: { id: workId, ownerUserId: userId }, select: { id: true } });
  if (!work) throw new NotFoundException({ code: 'STORY_WORK_NOT_FOUND', message: 'Story work not found' });
}

export async function storeManuscriptVersion(
  prisma: PrismaService, userId: string, workId: string, input: PreparedManuscript,
) {
  const structuredBody = storedManuscriptBody(input);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        // Prisma has no row-lock projection API. Parameterized locking also serializes
        // ownership changes and version allocation for this one existing work.
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id" FROM "story_works"
          WHERE "id" = ${workId}::uuid AND "owner_user_id" = ${userId}::uuid
          FOR UPDATE
        `);
        if (!locked.length) throw new NotFoundException({ code: 'STORY_WORK_NOT_FOUND', message: 'Story work not found' });
        await requireManuscriptOwner(tx, userId, workId);
        let existing = await tx.storyManuscriptVersion.findUnique({
          where: { workId_contentHash: { workId, contentHash: input.contentHash } }, select: receiptSelect,
        });
        let legacy = false;
        if (!existing && input.source.kind !== 'utf8_paste') {
          const old = await tx.storyManuscriptVersion.findUnique({
            where: { workId_contentHash: { workId, contentHash: input.legacyHash } }, select: receiptSelect,
          });
          if (old?.locale === input.locale) { existing = old; legacy = true; }
        }
        if (existing && (existing.ownerUserId !== userId || existing.locale !== input.locale)) {
          throw new ConflictException({ code: 'MANUSCRIPT_VERSION_OWNER_CONFLICT', message: 'Existing version cannot be reused' });
        }
        const latest = existing ? null : await tx.storyManuscriptVersion.findFirst({
          where: { workId }, orderBy: { version: 'desc' }, select: { version: true },
        });
        const row = existing ?? await tx.storyManuscriptVersion.create({
          data: { workId, ownerUserId: userId, version: (latest?.version ?? 0) + 1,
            locale: input.locale, contentHash: input.contentHash,
            structuredBody: structuredBody as unknown as Prisma.InputJsonValue },
          select: receiptSelect,
        });
        return {
          manuscript: { id: row.id, workId: row.workId, version: row.version, locale: row.locale,
            contentHash: row.contentHash, createdAt: row.createdAt },
          idempotentReplay: Boolean(existing),
          received: { sha256: input.source.sha256, byteLength: input.source.byteLength,
            sourceKind: input.source.kind, parts: input.parts.length, paragraphs: input.paragraphCount },
          rawSource: legacy ? 'legacy_projection_only' : existing ? 'existing_version_unchanged' : 'stored_with_version',
          analysisStarted: false,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 10000 });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if ((code === 'P2002' || code === 'P2034') && attempt < 2) continue;
      // Prisma errors can include submitted JSON. Never let the global logger print it.
      throw new ServiceUnavailableException({ code: 'MANUSCRIPT_STORE_RETRY', message: 'Manuscript could not be stored; retry the complete request' });
    }
  }
  throw new ServiceUnavailableException('Manuscript intake unavailable');
}
