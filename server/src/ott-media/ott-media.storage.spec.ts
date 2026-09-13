import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { Readable } from 'stream';
import { PrivateLocalOttStorage, sha256 } from './ott-media.storage';
import { EXPECTED, SAMPLE } from './ott-media.test-doubles';

describe('private-local storage, real tiny files on explicitly configured E temp', () => {
  let root: string;
  let config: Record<string, string>;
  let storage: PrivateLocalOttStorage;
  beforeEach(async () => {
    const parent = process.env.TEMP!;
    if (!parent || !/^E:[/\\]/i.test(parent)) throw new Error('E-only TEMP required');
    await mkdir(parent, { recursive: true });
    root = await mkdtemp(join(parent, 'ott-test-'));
    config = { OTT_MEDIA_STORAGE_MODE: 'private_local', OTT_MEDIA_LOCAL_ROOT: root,
      OTT_MEDIA_PUBLIC_ROOTS: '[]', OTT_MEDIA_LOCAL_PRIVATE_CONFIRMED: 'true' };
    storage = new PrivateLocalOttStorage(new ConfigService(config));
  });
  afterEach(async () => {
    const allowed = resolve(process.env.TEMP!);
    if (root && resolve(root).startsWith(`${allowed}\\ott-test-`)) await rm(root, { recursive: true, force: true });
  });

  it('streams bounded bytes atomically and reopens using a pinned descriptor', async () => {
    const id = randomUUID();
    await storage.put(id, Readable.from([SAMPLE.subarray(0, 10), SAMPLE.subarray(10)]), EXPECTED);
    const media = await storage.open(id);
    expect(media.sha256).toBe(EXPECTED.sha256);
    expect(media.sizeBytes).toBe(SAMPLE.length);
    const chunks: Buffer[] = [];
    for await (const chunk of media.stream(0, 7)) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(SAMPLE.subarray(0, 8));
    await media.close();
    expect(await readdir(root)).toEqual([`${id}.mp4`]);
  });

  it('permits identical retry without replacing the original inode', async () => {
    const id = randomUUID();
    await storage.put(id, Readable.from([SAMPLE]), EXPECTED);
    const before = await lstat(join(root, `${id}.mp4`));
    await storage.put(id, Readable.from([SAMPLE]), EXPECTED);
    expect((await lstat(join(root, `${id}.mp4`))).ino).toBe(before.ino);
    const changed = Buffer.alloc(SAMPLE.length, 1);
    await expect(storage.put(id, Readable.from([changed]), { ...EXPECTED, sha256: sha256(changed) })).rejects.toMatchObject({ response: { code: 'OTT_OBJECT_MISMATCH' } });
  });

  it.each(['over', 'under', 'checksum', 'abort'])('cleans partial files for %s', async (mode) => {
    const id = randomUUID();
    const source = mode === 'abort' ? Readable.from((async function* () { yield SAMPLE.subarray(0, 8); throw new Error('disconnected'); })())
      : Readable.from([mode === 'over' ? Buffer.concat([SAMPLE, SAMPLE]) : mode === 'under' ? SAMPLE.subarray(0, 8) : Buffer.alloc(SAMPLE.length)]);
    await expect(storage.put(id, source, EXPECTED)).rejects.toBeDefined();
    expect(await readdir(root)).toEqual([]);
  });

  it.each(['local', 'metadata_only', 's3', 'r2', 'unknown', ''])('fails closed for unsupported mode %s', (mode) => {
    config.OTT_MEDIA_STORAGE_MODE = mode;
    expect(() => storage.assertAvailable()).toThrow();
  });

  it('requires private root attestation and a durable root in production', () => {
    config.NODE_ENV = 'production';
    expect(() => storage.assertAvailable()).toThrow();
    config.OTT_MEDIA_DURABLE_ROOT_CONFIRMED = 'true';
    expect(() => storage.assertAvailable()).not.toThrow();
    delete config.OTT_MEDIA_LOCAL_PRIVATE_CONFIRMED;
    expect(() => storage.assertAvailable()).toThrow();
  });

  it.each(['relative', 'checkout', 'static-descendant', 'static-ancestor', 'root', 'C'])('rejects unsafe configured root %s', (mode) => {
    if (mode === 'relative') config.OTT_MEDIA_LOCAL_ROOT = 'relative/private';
    if (mode === 'checkout') config.OTT_MEDIA_LOCAL_ROOT = join(process.cwd(), 'storage');
    if (mode === 'static-descendant') config.OTT_MEDIA_PUBLIC_ROOTS = JSON.stringify([resolve(root, '..')]);
    if (mode === 'static-ancestor') config.OTT_MEDIA_PUBLIC_ROOTS = JSON.stringify([join(root, 'public')]);
    if (mode === 'root') config.OTT_MEDIA_LOCAL_ROOT = 'E:/';
    if (mode === 'C') config.OTT_MEDIA_LOCAL_ROOT = 'C:/temp/private';
    expect(() => storage.assertAvailable()).toThrow();
  });

  it('rejects ancestor junctions, not just a symlink at the final root', async () => {
    const target = join(root, 'target');
    await mkdir(target);
    const junction = join(root, 'junction');
    await symlink(target, junction, 'junction');
    config.OTT_MEDIA_LOCAL_ROOT = join(junction, 'private');
    await expect(storage.put(randomUUID(), Readable.from([SAMPLE]), EXPECTED)).rejects.toMatchObject({ response: { code: 'OTT_STORAGE_UNAVAILABLE' } });
    expect(await readdir(target)).toEqual([]);
  });

  it('rejects external URLs, traversal, and unsupported raw file names without reads', async () => {
    for (const id of ['../file', 'http://127.0.0.1/private', 'file.zip', 'E:/file']) {
      await expect(storage.open(id)).rejects.toMatchObject({ response: { code: 'OTT_INVALID' } });
    }
  });

  it('rejects object substitution with a directory', async () => {
    const id = randomUUID();
    await mkdir(join(root, `${id}.mp4`));
    await expect(storage.open(id)).rejects.toMatchObject({ response: { code: 'OTT_OBJECT_MISMATCH' } });
  });

  it('reports a changed on-disk checksum so the service cannot issue playback', async () => {
    const id = randomUUID();
    await storage.put(id, Readable.from([SAMPLE]), EXPECTED);
    await writeFile(join(root, `${id}.mp4`), Buffer.alloc(SAMPLE.length));
    const media = await storage.open(id);
    expect(media.sha256).not.toBe(EXPECTED.sha256);
    await media.close();
  });
});
