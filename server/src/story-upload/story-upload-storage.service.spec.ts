import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoryUploadStorageService } from './story-upload-storage.service';

describe('StoryUploadStorageService', () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('writes and verifies a private local object for development tests', async () => {
    root = await mkdtemp(join(tmpdir(), 'story-upload-storage-'));
    const config = new ConfigService({
      NODE_ENV: 'test',
      OBJECT_STORAGE_PROVIDER: 'local',
      STORY_UPLOAD_LOCAL_STORAGE_ROOT: root,
    });
    const storage = new StoryUploadStorageService(config);
    const buffer = Buffer.from('Synthetic manuscript');

    await expect(
      storage.putObject({
        storageKey: 'private/story-upload/ref/request/manuscript/00.txt',
        mimeType: 'text/plain',
        buffer,
      }),
    ).resolves.toEqual({ storageProvider: 'local' });
    await expect(
      readFile(
        join(
          root,
          'private/story-upload/ref/request/manuscript/00.txt',
        ),
      ),
    ).resolves.toEqual(buffer);
    await expect(
      storage.getObject({
        storageProvider: 'local',
        storageKey: 'private/story-upload/ref/request/manuscript/00.txt',
        expectedBytes: buffer.length,
      }),
    ).resolves.toEqual(buffer);
  });

  it('rejects a stored object whose received size no longer matches its receipt', async () => {
    root = await mkdtemp(join(tmpdir(), 'story-upload-storage-'));
    const storage = new StoryUploadStorageService(
      new ConfigService({
        NODE_ENV: 'test',
        OBJECT_STORAGE_PROVIDER: 'local',
        STORY_UPLOAD_LOCAL_STORAGE_ROOT: root,
      }),
    );
    const buffer = Buffer.from('Synthetic manuscript');
    await storage.putObject({
      storageKey: 'private/story-upload/ref/request/manuscript/00.txt',
      mimeType: 'text/plain',
      buffer,
    });
    await expect(
      storage.getObject({
        storageProvider: 'local',
        storageKey: 'private/story-upload/ref/request/manuscript/00.txt',
        expectedBytes: buffer.length + 1,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not allow local-only storage in staging', async () => {
    root = await mkdtemp(join(tmpdir(), 'story-upload-storage-'));
    const storage = new StoryUploadStorageService(
      new ConfigService({
        NODE_ENV: 'staging',
        OBJECT_STORAGE_PROVIDER: 'local',
        STORY_UPLOAD_LOCAL_STORAGE_ROOT: root,
      }),
    );
    await expect(
      storage.putObject({
        storageKey: 'private/story-upload/ref/request/manuscript/00.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Synthetic manuscript'),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
