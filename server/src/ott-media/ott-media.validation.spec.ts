import { ConfigService } from '@nestjs/config';
import { expectedMedia, subtitles } from './ott-media.contract';
import { FfprobeOttMediaProbe, validateProbeOutput, verifyObject } from './ott-media.probe';
import { EXPECTED, MemoryStorage, SAMPLE } from './ott-media.test-doubles';
import { byteRange } from './ott-media.controller';

describe('OTT validation boundaries', () => {
  const cue = { startMs: 0, endMs: 1000, text: 'text' };
  it.each(['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'])('accepts separate available %s subtitle cues', (locale) => {
    expect(subtitles([{ locale, cues: [cue] }], 1000)[0].locale).toBe(locale);
  });
  it.each([
    [{ locale: 'fr', cues: [cue] }], [{ locale: 'ko', cues: [] }],
    [{ locale: 'ko', cues: [cue] }, { locale: 'ko', cues: [cue] }],
    [{ locale: 'ko', cues: [{ ...cue, startMs: -1 }] }],
    [{ locale: 'ko', cues: [{ ...cue, endMs: 1001 }] }],
    [{ locale: 'ko', cues: [{ ...cue, endMs: NaN }] }],
    [{ locale: 'ko', cues: [{ ...cue, text: '<script>' }] }],
    [{ locale: 'ko', cues: [cue, cue] }],
  ])('rejects invalid subtitle tracks %#', (...value) => { expect(() => subtitles(value, 1000)).toThrow(); });
  it('never fills absent subtitles as translated', () => { expect(subtitles([], 1000)).toEqual([]); });
  it.each([{ ...EXPECTED, sizeBytes: '30' }, { ...EXPECTED, sizeBytes: Infinity },
    { ...EXPECTED, sizeBytes: 100_000_000 }, { ...EXPECTED, mimeType: 'video/webm' },
    { ...EXPECTED, declaredDurationMs: 0 }, { ...EXPECTED, sha256: 'etag' }])('rejects invalid registration %#', (v) => { expect(() => expectedMedia(v)).toThrow(); });
  it('supports bounded native Range reads without full fetch/Blob', () => {
    expect(byteRange('bytes=0-7', 100)).toEqual({ start: 0, end: 7 });
    expect(byteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(byteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    for (const input of ['bytes=100-', 'bytes=-0', 'bytes=2-1', 'bytes=0-1,4-5', 'http://localhost']) expect(() => byteRange(input, 100)).toThrow();
  });

  describe('ffprobe output contract, not a real binary/media test', () => {
    const storage = new MemoryStorage();
    storage.bytes.set('test', SAMPLE);
    const output = { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', duration: '1' },
      { index: 1, codec_type: 'audio', codec_name: 'aac', duration: '1' }],
    packets: [{ stream_index: 0, pts_time: '0', duration_time: '1', size: '1' },
      { stream_index: 1, pts_time: '0', duration_time: '1', size: '1' }] };
    it('requires actual server probe configuration', async () => {
      const media = await storage.open('test');
      await expect(new FfprobeOttMediaProbe(new ConfigService({})).inspect(media, EXPECTED)).rejects.toMatchObject({ response: { code: 'OTT_PROBE_UNAVAILABLE' } });
    });
    it('accepts finite consistent demuxed duration, size and checksum contract', async () => {
      const media = await storage.open('test');
      expect(validateProbeOutput(JSON.stringify(output), media, EXPECTED).durationMs).toBe(1000);
    });
    it.each(['missing-packets', 'nan', 'lie', 'gap', 'codec'])('rejects %s output', async (mode) => {
      const media = await storage.open('test');
      const altered = structuredClone(output);
      if (mode === 'missing-packets') altered.packets = [];
      if (mode === 'nan') altered.streams[0].duration = 'N/A';
      if (mode === 'lie') altered.streams[0].duration = '900';
      if (mode === 'gap') altered.packets[0].pts_time = '100';
      if (mode === 'codec') altered.streams[0].codec_name = 'unknown';
      expect(() => validateProbeOutput(JSON.stringify(altered), media, EXPECTED)).toThrow();
    });
    it('never considers a filename or claimed mime sufficient for signature validation', async () => {
      const media = await storage.open('test');
      expect(() => verifyObject({ ...media, prefix: Buffer.alloc(32) }, EXPECTED)).toThrow();
      expect(() => verifyObject({ ...media, sizeBytes: media.sizeBytes + 1 }, EXPECTED)).toThrow();
    });
  });
});
