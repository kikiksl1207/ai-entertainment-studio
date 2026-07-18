import {
  BadRequestException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StoryUploadStorageService } from './story-upload-storage.service';
import {
  assertStoryUploadTotalBytes,
  STORY_UPLOAD_TOTAL_MAX_BYTES,
  StoryUploadService,
} from './story-upload.service';
import { StoryUploadFile } from './story-upload.types';

function uploadFile(
  originalname: string,
  mimetype: string,
  buffer: Buffer,
): StoryUploadFile {
  return {
    fieldname: 'manuscripts',
    originalname,
    encoding: '7bit',
    mimetype,
    size: buffer.length,
    buffer,
  };
}

function receiptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    requestKeyHash: 'a'.repeat(64),
    requestFingerprint: 'b'.repeat(64),
    submissionType: 'final',
    title: 'Synthetic title',
    originalLocale: 'ko',
    sourceClass: 'original',
    rightsReference: null,
    status: 'received',
    totalBytes: 12n,
    createdAt: new Date('2026-07-11T00:00:00.000Z'),
    updatedAt: new Date('2026-07-11T00:00:00.000Z'),
    _count: { files: 1 },
    ...overrides,
  };
}

describe('StoryUploadService', () => {
  function setup() {
    const tx = {
      storyUploadSubmission: {
        create: jest.fn().mockResolvedValue(receiptRow()),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-row' }) },
    };
    const prisma = {
      storyUploadSubmission: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const storage = {
      provider: jest.fn().mockReturnValue('r2'),
      putObject: jest.fn().mockResolvedValue({ storageProvider: 'r2' }),
    };
    return {
      service: new StoryUploadService(
        prisma as unknown as PrismaService,
        storage as unknown as StoryUploadStorageService,
      ),
      prisma,
      storage,
      tx,
    };
  }

  it('stores validated files and returns only a safe receipt', async () => {
    const { service, storage, tx } = setup();
    const manuscript = uploadFile(
      'final.md',
      'text/markdown',
      Buffer.from('# Synthetic final manuscript'),
    );
    const metadata = uploadFile(
      'branches.json',
      'application/json',
      Buffer.from('{"branches":[]}'),
    );

    const receipt = await service.intake(
      '22222222-2222-4222-8222-222222222222',
      {
        title: 'Synthetic title',
        originalLocale: 'ko',
        sourceClass: 'original',
        submissionType: 'final',
      },
      { manuscripts: [manuscript], metadata: [metadata] },
      'story-intake-retry-key',
    );

    expect(storage.putObject).toHaveBeenCalledTimes(2);
    expect(tx.storyUploadSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'received',
          submissionType: 'final',
          files: { create: expect.any(Array) },
        }),
      }),
    );
    expect(tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'story_upload_intake_received',
          metadata: expect.objectContaining({ fileCount: 2 }),
        }),
      }),
    );
    expect(receipt).toMatchObject({
      submissionId: '11111111-1111-4111-8111-111111111111',
      status: 'received',
      submissionType: 'final',
      replayed: false,
    });
    expect(receipt).not.toHaveProperty('storageKey');
    expect(receipt).not.toHaveProperty('rightsReference');
  });

  it('returns an idempotent replay without writing storage again', async () => {
    const { service, prisma, storage, tx } = setup();
    const manuscript = uploadFile(
      'final.txt',
      'text/plain',
      Buffer.from('Synthetic final manuscript'),
    );
    await service.intake(
      '22222222-2222-4222-8222-222222222222',
      {
        title: 'Synthetic title',
        originalLocale: 'ko',
        sourceClass: 'original',
        submissionType: 'final',
      },
      { manuscripts: [manuscript] },
      'story-intake-retry-key',
    );
    const createdData = tx.storyUploadSubmission.create.mock.calls[0][0].data;
    prisma.storyUploadSubmission.findUnique.mockResolvedValue(
      receiptRow({
        requestFingerprint: createdData.requestFingerprint,
        totalBytes: BigInt(manuscript.size),
      }),
    );
    storage.putObject.mockClear();

    const replay = await service.intake(
      '22222222-2222-4222-8222-222222222222',
      {
        title: 'Synthetic title',
        originalLocale: 'ko',
        sourceClass: 'original',
        submissionType: 'final',
      },
      { manuscripts: [manuscript] },
      'story-intake-retry-key',
    );

    expect(replay.replayed).toBe(true);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key for different content', async () => {
    const { service, prisma } = setup();
    prisma.storyUploadSubmission.findUnique.mockResolvedValue(receiptRow());
    await expect(
      service.intake(
        '22222222-2222-4222-8222-222222222222',
        {
          title: 'Different synthetic title',
          originalLocale: 'en',
          sourceClass: 'original',
          submissionType: 'final',
        },
        {
          manuscripts: [
            uploadFile('final.md', 'text/markdown', Buffer.from('Different body')),
          ],
        },
        'story-intake-retry-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects unsupported extensions and invalid signatures', async () => {
    const { service, prisma, storage } = setup();
    const input = {
      title: 'Synthetic title',
      originalLocale: 'ko',
      sourceClass: 'original',
      submissionType: 'final' as const,
    };
    await expect(
      service.intake(
        '22222222-2222-4222-8222-222222222222',
        input,
        {
          manuscripts: [
            uploadFile('final.exe', 'application/octet-stream', Buffer.from('x')),
          ],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.intake(
        '22222222-2222-4222-8222-222222222222',
        input,
        {
          manuscripts: [
            uploadFile('final.pdf', 'application/pdf', Buffer.from('not a pdf')),
          ],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an oversized file before storage or database writes', async () => {
    const { service, prisma, storage } = setup();
    const oversized = uploadFile(
      'final.txt',
      'text/plain',
      Buffer.alloc(50 * 1024 * 1024 + 1, 0x61),
    );

    await expect(
      service.intake(
        '22222222-2222-4222-8222-222222222222',
        {
          title: 'Synthetic title',
          originalLocale: 'ko',
          sourceClass: 'original',
          submissionType: 'final',
        },
        { manuscripts: [oversized] },
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects licensed submissions without an internal rights reference', async () => {
    const { service } = setup();
    await expect(
      service.intake(
        '22222222-2222-4222-8222-222222222222',
        {
          title: 'Synthetic title',
          originalLocale: 'ko',
          sourceClass: 'licensed_ip',
          submissionType: 'final',
        },
        {
          manuscripts: [
            uploadFile('final.txt', 'text/plain', Buffer.from('Synthetic body')),
          ],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enforces the aggregate upload limit without allocating a large fixture', () => {
    expect(() =>
      assertStoryUploadTotalBytes([
        { size: STORY_UPLOAD_TOTAL_MAX_BYTES },
        { size: 1 },
      ]),
    ).toThrow(PayloadTooLargeException);
  });
});
