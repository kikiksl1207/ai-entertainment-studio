import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { LOCALES } from './ott-media.contract';
import { OttMediaDelivery } from './ott-media.delivery';
import { OttMediaService } from './ott-media.service';
import { EXPECTED, MemoryRepository, MemoryStorage, ProbeDouble, SAMPLE } from './ott-media.test-doubles';

describe('OTT owner intake contract (explicit storage/probe/persistence doubles)', () => {
  let repo: MemoryRepository;
  let storage: MemoryStorage;
  let probe: ProbeDouble;
  let service: OttMediaService;
  let owner: string;
  let version: string;
  let file: string;
  const tracks = [{ locale: 'ko', cues: [{ startMs: 0, endMs: 900, text: 'test subtitle' }] }];

  beforeEach(async () => {
    owner = randomUUID(); repo = new MemoryRepository(); storage = new MemoryStorage(); probe = new ProbeDouble();
    service = new OttMediaService(repo, storage, probe, new OttMediaDelivery(new ConfigService({ OTT_MEDIA_DELIVERY_SECRET: 'test-only-not-a-real-secret'.repeat(2) })));
    version = (await service.createWork(owner, { title: 'Synthetic private test' })).versionId;
    file = (await service.createIntent(owner, version, 'intent-key-1', EXPECTED)).fileId;
  });
  const code = (name: string) => ({ response: expect.objectContaining({ code: `OTT_${name}` }) });
  async function upload() { return service.uploadObject(owner, file, Readable.from([SAMPLE]), 'video/mp4'); }
  async function confirm() { await upload(); return service.confirm(owner, file, { subtitles: tracks }); }

  it('streams intent -> uploaded -> confirmed -> authorized short delivery; only available subtitles', async () => {
    expect((await service.getFile(owner, file)).media).toBeNull();
    expect((await upload()).status).toBe('uploaded');
    expect((await service.confirm(owner, file, { subtitles: tracks })).status).toBe('confirmed');
    const preview = await service.preview(owner, file);
    expect(preview.media?.durationMs).toBe(1000);
    expect(preview.availableSubtitleLocales).toEqual(['ko']);
    expect(preview.choicePolicy.maxRecommendations).toBe(3);
    expect(preview.playback.authorization).toBe('bearer-required');
    expect(preview.playback.path).not.toContain('?');
    expect(JSON.stringify(preview)).not.toMatch(/storageKey|publicUrl|secret|\.mp4/);
    const media = await service.deliver(owner, file, preview.playback.headers['x-ott-expires'], preview.playback.headers['x-ott-signature']);
    expect(media.sizeBytes).toBe(SAMPLE.length);
    await media.close();
  });

  it('does not make missing or pending media playable', async () => {
    await expect(service.confirm(owner, file, { subtitles: [] })).rejects.toMatchObject(code('NOT_READY'));
    await expect(service.preview(owner, file)).rejects.toMatchObject(code('NOT_READY'));
    await expect(service.preview(owner, randomUUID())).rejects.toMatchObject(code('NOT_FOUND'));
  });

  it('serializes duplicate intent creation and completion', async () => {
    const [a, b] = await Promise.all([service.createIntent(owner, version, 'intent-key-1', EXPECTED), service.createIntent(owner, version, 'intent-key-1', EXPECTED)]);
    expect(a.fileId).toBe(b.fileId);
    await upload();
    const values = await Promise.all([service.confirm(owner, file, { subtitles: tracks }), service.confirm(owner, file, { subtitles: tracks })]);
    expect(values[0]).toEqual(values[1]);
    expect(probe.calls).toBe(1);
    expect(repo.uploads.size).toBe(1);
  });

  it('rejects changed intent payload, same version with another key and cross-version key replay', async () => {
    await expect(service.createIntent(owner, version, 'intent-key-1', { ...EXPECTED, declaredDurationMs: 2000 })).rejects.toMatchObject(code('CONFLICT'));
    await expect(service.createIntent(owner, version, 'different-key', EXPECTED)).rejects.toMatchObject(code('CONFLICT'));
    const next = await service.createVersion(owner, repo.uploads.get(file)!.workId, {});
    await expect(service.createIntent(owner, next.versionId, 'intent-key-1', EXPECTED)).rejects.toMatchObject(code('CONFLICT'));
  });

  it('rejects missing/foreign versions, works and all foreign file operations', async () => {
    const other = randomUUID();
    await expect(service.createIntent(owner, randomUUID(), 'intent-key-2', EXPECTED)).rejects.toMatchObject(code('NOT_FOUND'));
    await expect(service.createIntent(other, version, 'intent-key-2', EXPECTED)).rejects.toMatchObject(code('NOT_FOUND'));
    await expect(service.createVersion(other, repo.uploads.get(file)!.workId, {})).rejects.toMatchObject(code('NOT_FOUND'));
    await expect(service.uploadObject(other, file, Readable.from([SAMPLE]), 'video/mp4')).rejects.toMatchObject(code('NOT_FOUND'));
    await expect(service.confirm(other, file, { subtitles: [] })).rejects.toMatchObject(code('NOT_FOUND'));
    await expect(service.getFile(other, file)).rejects.toMatchObject(code('NOT_FOUND'));
    await confirm();
    await expect(service.preview(other, file)).rejects.toMatchObject(code('NOT_FOUND'));
    await expect(service.deliver(other, file, '', '')).rejects.toMatchObject(code('NOT_FOUND'));
  });

  it('keeps confirmed original and subtitle payload immutable', async () => {
    const first = await confirm();
    expect(await service.confirm(owner, file, { subtitles: tracks })).toEqual(first);
    await expect(service.confirm(owner, file, { subtitles: [] })).rejects.toMatchObject(code('CONFLICT'));
    await expect(service.uploadObject(owner, file, Readable.from([Buffer.alloc(SAMPLE.length)]), 'video/mp4')).rejects.toMatchObject(code('OBJECT_MISMATCH'));
  });

  it('expires pending/received intents but permits immutable confirmed receipt replay', async () => {
    repo.uploads.get(file)!.expiresAt = new Date(0);
    await expect(upload()).rejects.toMatchObject(code('EXPIRED'));
    await expect(service.createIntent(owner, version, 'intent-key-1', EXPECTED)).rejects.toMatchObject(code('EXPIRED'));
    repo.uploads.get(file)!.expiresAt = new Date(Date.now() + 10_000);
    await confirm();
    repo.uploads.get(file)!.expiresAt = new Date(0);
    expect((await service.confirm(owner, file, { subtitles: tracks })).status).toBe('confirmed');
  });

  it('rejects failed object stat/read without confirming and allows retry', async () => {
    await upload(); storage.unavailable = true;
    await expect(service.confirm(owner, file, { subtitles: [] })).rejects.toMatchObject(code('STORAGE_UNAVAILABLE'));
    expect(repo.uploads.get(file)!.status).toBe('uploaded');
    storage.unavailable = false;
    expect((await service.confirm(owner, file, { subtitles: [] })).status).toBe('confirmed');
  });

  it('requires actual probe duration, never trusting the declared length', async () => {
    await upload(); probe.durationMs = 5000;
    await expect(service.confirm(owner, file, { subtitles: [] })).rejects.toMatchObject(code('OBJECT_MISMATCH'));
    probe.durationMs = NaN;
    await expect(service.confirm(owner, file, { subtitles: [] })).rejects.toMatchObject(code('OBJECT_MISMATCH'));
    probe.unavailable = true;
    await expect(service.confirm(owner, file, { subtitles: [] })).rejects.toMatchObject(code('PROBE_UNAVAILABLE'));
    expect(repo.uploads.get(file)!.verified).toBeNull();
  });

  it.each([
    { declaredDurationMs: 1800, endMs: 1900, accepted: true },
    { declaredDurationMs: 2200, endMs: 2100, accepted: false },
  ])('uses measured 2000ms for subtitles with declaration $declaredDurationMs and cue $endMs', async ({ declaredDurationMs, endMs, accepted }) => {
    version = (await service.createWork(owner, { title: 'Duration regression' })).versionId;
    file = (await service.createIntent(owner, version, 'duration-regression', { ...EXPECTED, declaredDurationMs })).fileId;
    probe.durationMs = 2000;
    await upload();
    const result = service.confirm(owner, file, { subtitles: [{ locale: 'ko', cues: [{ startMs: 0, endMs, text: 'test' }] }] });
    if (accepted) {
      await expect(result).resolves.toMatchObject({ status: 'confirmed', media: { durationMs: 2000 } });
    } else {
      await expect(result).rejects.toMatchObject(code('INVALID'));
      expect(repo.uploads.get(file)!.status).toBe('uploaded');
      expect(repo.uploads.get(file)!.verified).toBeNull();
    }
    expect(probe.calls).toBe(1);
  });

  it('still rejects invalid subtitle text before opening/probing media', async () => {
    await upload();
    const open = jest.spyOn(storage, 'open');
    await expect(service.confirm(owner, file, { subtitles: [{ locale: 'ko', cues: [{ startMs: 0, endMs: 900, text: '<script>' }] }] })).rejects.toMatchObject(code('INVALID'));
    expect(open).not.toHaveBeenCalled();
    expect(probe.calls).toBe(0);
  });

  it('rejects replaced/deleted objects on confirm replay, preview and delivery', async () => {
    await confirm();
    const p = await service.preview(owner, file);
    storage.bytes.set(file, Buffer.alloc(SAMPLE.length));
    await expect(service.confirm(owner, file, { subtitles: tracks })).rejects.toMatchObject(code('OBJECT_MISMATCH'));
    await expect(service.preview(owner, file)).rejects.toMatchObject(code('OBJECT_MISMATCH'));
    await expect(service.deliver(owner, file, p.playback.headers['x-ott-expires'], p.playback.headers['x-ott-signature'])).rejects.toMatchObject(code('OBJECT_MISMATCH'));
    storage.bytes.delete(file);
    await expect(service.preview(owner, file)).rejects.toMatchObject(code('STORAGE_UNAVAILABLE'));
  });

  it('rejects forged, expired and other-file delivery signatures', async () => {
    await confirm();
    const p = await service.preview(owner, file);
    await expect(service.deliver(owner, file, p.playback.headers['x-ott-expires'], 'a'.repeat(43))).rejects.toMatchObject(code('TOKEN_INVALID'));
    await expect(service.deliver(owner, file, '1000000000', p.playback.headers['x-ott-signature'])).rejects.toMatchObject(code('TOKEN_INVALID'));
    const oldFile = file;
    version = (await service.createWork(owner, { title: 'second' })).versionId;
    file = (await service.createIntent(owner, version, 'intent-key-2', EXPECTED)).fileId;
    await confirm();
    expect(file).not.toBe(oldFile);
    await expect(service.deliver(owner, file, p.playback.headers['x-ott-expires'], p.playback.headers['x-ott-signature'])).rejects.toMatchObject(code('TOKEN_INVALID'));
  });

  it.each(['url', 'storageKey', 'ownerId', 'signature', 'recommendations', 'targetFileId'])('rejects unsupported field %s including SSRF/choice routing inputs', async (field) => {
    await expect(service.createIntent(owner, version, 'intent-key-2', { ...EXPECTED, [field]: 'http://169.254.169.254/' })).rejects.toMatchObject(code('INVALID'));
  });

  it('returns five locale error messages through the common details contract', async () => {
    try { await service.preview(owner, file); failTest(); }
    catch (error) { expect(Object.keys((error as { response: { details: { messages: object } } }).response.details.messages)).toEqual([...LOCALES]); }
  });
});

function failTest(): never { throw new Error('expected OTT exception'); }
