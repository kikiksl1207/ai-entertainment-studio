import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdtemp, readFile, rm, stat } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { OttMediaDelivery } from './ott-media.delivery';
import { FfprobeOttMediaProbe } from './ott-media.probe';
import { OttMediaService } from './ott-media.service';
import { PrivateLocalOttStorage, sha256 } from './ott-media.storage';
import { MemoryRepository } from './ott-media.test-doubles';

// Opt in with approved local tools and a tiny 2-second H.264/AAC fixture; no download/generation.
const executable = process.env.OTT_TEST_FFPROBE_PATH;
const fixture = process.env.OTT_TEST_DURATION_FIXTURE;
const describeProbe = executable && fixture ? describe : describe.skip;

describeProbe('actual ffprobe duration regression (real tiny file storage; persistence double)', () => {
  let root: string;
  let fixtureHash: string;
  let sizeBytes: number;
  beforeAll(async () => {
    for (const value of [process.env.TEMP, executable, fixture]) {
      if (!value || !/^E:[/\\]/i.test(value)) throw new Error('Explicit E-only tool, fixture and TEMP required');
    }
    sizeBytes = (await stat(fixture!)).size;
    if (sizeBytes < 16 || sizeBytes > 1024 * 1024) throw new Error('Tiny media fixture required');
    fixtureHash = sha256(await readFile(fixture!));
  });
  beforeEach(async () => { root = await mkdtemp(join(process.env.TEMP!, 'ott-duration-')); });
  afterEach(async () => {
    const parent = resolve(process.env.TEMP!);
    if (root && resolve(root).startsWith(`${parent}${sep}ott-duration-`)) await rm(root, { recursive: true, force: true });
  });
  afterAll(async () => { expect(sha256(await readFile(fixture!))).toBe(fixtureHash); });

  it.each([
    { declaredDurationMs: 1800, endMs: 1900, accepted: true },
    { declaredDurationMs: 2200, endMs: 2100, accepted: false },
  ])('actual 2000ms, declared $declaredDurationMs, cue $endMs', async ({ declaredDurationMs, endMs, accepted }) => {
    const config = new ConfigService({ OTT_MEDIA_STORAGE_MODE: 'private_local', OTT_MEDIA_LOCAL_ROOT: root,
      OTT_MEDIA_LOCAL_PRIVATE_CONFIRMED: 'true', OTT_MEDIA_PUBLIC_ROOTS: '[]', OTT_MEDIA_FFPROBE_PATH: executable,
      OTT_MEDIA_DELIVERY_SECRET: 'test-only-duration-regression'.repeat(2) });
    const repository = new MemoryRepository();
    const storage = new PrivateLocalOttStorage(config);
    const probe = new FfprobeOttMediaProbe(config);
    const inspected = jest.spyOn(probe, 'inspect');
    const service = new OttMediaService(repository, storage, probe, new OttMediaDelivery(config));
    const owner = randomUUID();
    const work = await service.createWork(owner, { title: 'Duration regression' });
    const intent = await service.createIntent(owner, work.versionId, 'real-duration-regression', {
      sha256: fixtureHash, sizeBytes, mimeType: 'video/mp4', declaredDurationMs, audioLocale: 'ko',
    });
    await service.uploadObject(owner, intent.fileId, createReadStream(fixture!), 'video/mp4');
    const result = service.confirm(owner, intent.fileId, { subtitles: [{ locale: 'ko', cues: [{ startMs: 0, endMs, text: 'test' }] }] });
    if (accepted) {
      await expect(result).resolves.toMatchObject({ status: 'confirmed', media: { durationMs: 2000 } });
    } else {
      await expect(result).rejects.toMatchObject({ response: { code: 'OTT_INVALID' } });
      expect(repository.uploads.get(intent.fileId)!.status).toBe('uploaded');
      expect(repository.uploads.get(intent.fileId)!.verified).toBeNull();
    }
    expect(inspected).toHaveBeenCalledTimes(1);
    await expect(inspected.mock.results[0].value).resolves.toMatchObject({ durationMs: 2000 });
  }, 20_000);
});
