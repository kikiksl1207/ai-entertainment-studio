import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ExpectedMedia, Upload, fail } from './ott-media.contract';

export type WorkVersion = { workId: string; versionId: string; authorId: string; version: number };
export abstract class OttMediaRepository {
  abstract createWork(ownerId: string, title: string): Promise<WorkVersion>;
  abstract createVersion(ownerId: string, workId: string): Promise<WorkVersion>;
  abstract createIntent(ownerId: string, versionId: string, key: string, expected: ExpectedMedia): Promise<Upload>;
  abstract withUpload<T>(ownerId: string, id: string, fn: (upload: Upload) => Promise<T>): Promise<T>;
  abstract revoke(ownerId: string, id: string): Promise<{ fileId: string; revoked: true }>;
}

@Injectable()
export class PrismaOttMediaRepository extends OttMediaRepository {
  constructor(private readonly prisma: PrismaService) { super(); }

  async createWork(ownerId: string, title: string) {
    const work = await this.prisma.ottMediaWork.create({ data: { ownerId, title, versions: { create: { version: 1 } } }, include: { versions: true } }).catch(sanitizePersistenceError);
    return { workId: work.id, versionId: work.versions[0].id, authorId: ownerId, version: 1 };
  }

  async createVersion(ownerId: string, workId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ott_media_works WHERE id=${workId}::uuid AND owner_id=${ownerId}::uuid FOR UPDATE`;
      const work = await tx.ottMediaWork.findFirst({ where: { id: workId, ownerId } });
      if (!work) fail('NOT_FOUND');
      const last = await tx.ottMediaVersion.findFirst({ where: { workId }, orderBy: { version: 'desc' } });
      const version = await tx.ottMediaVersion.create({ data: { workId, version: (last?.version ?? 0) + 1 } });
      return { workId, versionId: version.id, authorId: ownerId, version: version.version };
    }).catch(sanitizePersistenceError);
  }

  async createIntent(ownerId: string, versionId: string, key: string, expected: ExpectedMedia) {
    return this.prisma.$transaction(async (tx) => {
      // Serialize owner-scoped idempotency keys across application instances.
      await tx.$queryRaw`SELECT id FROM users WHERE id=${ownerId}::uuid FOR UPDATE`;
      const version = await tx.ottMediaVersion.findFirst({ where: { id: versionId, work: { ownerId } } });
      if (!version) fail('NOT_FOUND');
      const replay = await tx.ottMediaUpload.findUnique({ where: { ownerId_intentKey: { ownerId, intentKey: key } }, include: { version: true } });
      if (replay) {
        if (await tx.ottMediaRevocation.findUnique({ where: { fileId: replay.id } })) fail('NOT_READY');
        const old = mapOttMediaUpload(replay);
        if (old.versionId !== versionId || !this.sameExpected(old.expected, expected)) fail('CONFLICT');
        return old;
      }
      if (await tx.ottMediaUpload.findUnique({ where: { versionId } })) fail('CONFLICT');
      const created = await tx.ottMediaUpload.create({ data: { ownerId, versionId, intentKey: key,
        expected, expiresAt: new Date(Date.now() + 15 * 60_000) }, include: { version: true } });
      return mapOttMediaUpload(created);
    }).catch(sanitizePersistenceError);
  }

  private sameExpected(a: ExpectedMedia, b: ExpectedMedia) {
    return a.sha256 === b.sha256 && a.sizeBytes === b.sizeBytes && a.mimeType === b.mimeType
      && a.audioLocale === b.audioLocale && a.declaredDurationMs === b.declaredDurationMs;
  }

  async revoke(ownerId: string, id: string): Promise<{ fileId: string; revoked: true }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ott_media_uploads WHERE id=${id}::uuid AND owner_id=${ownerId}::uuid FOR UPDATE`;
      const row = await tx.ottMediaUpload.findFirst({ where: { id, ownerId, version: { work: { ownerId } } } });
      if (!row) fail('NOT_FOUND');
      const prior = await tx.ottMediaRevocation.findUnique({ where: { fileId: id } });
      if (!prior) await tx.ottMediaRevocation.create({ data: { fileId: id, ownerId } });
      return { fileId: id, revoked: true as const };
    }, { timeout: 90_000, maxWait: 5_000 }).catch(sanitizePersistenceError);
  }

  async withUpload<T>(ownerId: string, id: string, fn: (upload: Upload) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ott_media_uploads WHERE id=${id}::uuid AND owner_id=${ownerId}::uuid FOR UPDATE`;
      const row = await tx.ottMediaUpload.findFirst({ where: { id, ownerId, version: { work: { ownerId } } }, include: { version: true } });
      if (!row) fail('NOT_FOUND');
      if (await tx.ottMediaRevocation.findUnique({ where: { fileId: id } })) fail('NOT_READY');
      const upload = mapOttMediaUpload(row);
      const result = await fn(upload);
      if (upload.status !== row.status) {
        await tx.ottMediaUpload.update({ where: { id }, data: { status: upload.status,
          verified: upload.verified ?? Prisma.DbNull, subtitles: upload.subtitles ?? Prisma.DbNull,
          confirmationHash: upload.confirmationHash } });
      }
      return result;
    }, { timeout: 90_000, maxWait: 5_000 }).catch(sanitizePersistenceError);
  }
}

export function mapOttMediaUpload(row: Prisma.OttMediaUploadGetPayload<{ include: { version: true } }>): Upload {
  if (!['pending_upload', 'uploaded', 'confirmed'].includes(row.status)) fail('NOT_READY');
  return { id: row.id, ownerId: row.ownerId, workId: row.version.workId, versionId: row.versionId,
    intentKey: row.intentKey, expected: row.expected as unknown as ExpectedMedia,
    status: row.status as Upload['status'], expiresAt: row.expiresAt,
    verified: row.verified as unknown as Upload['verified'], subtitles: row.subtitles as unknown as Upload['subtitles'],
    confirmationHash: row.confirmationHash };
}

function sanitizePersistenceError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  fail('PERSISTENCE_UNAVAILABLE');
}
