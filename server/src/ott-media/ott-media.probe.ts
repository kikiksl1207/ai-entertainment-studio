import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { isAbsolute } from 'path';
import { ExpectedMedia, MAX_DURATION_MS, VerifiedMedia, fail } from './ott-media.contract';
import { StoredObject } from './ott-media.storage';

export abstract class OttMediaProbe {
  abstract inspect(media: StoredObject, expected: ExpectedMedia): Promise<VerifiedMedia>;
}

export function verifyObject(media: StoredObject, expected: ExpectedMedia) {
  const prefix = media.prefix;
  if (media.sizeBytes !== expected.sizeBytes || media.sha256 !== expected.sha256 || prefix.length < 16
    || prefix.toString('ascii', 4, 8) !== 'ftyp'
    || !['isom', 'iso2', 'mp41', 'mp42', 'avc1'].includes(prefix.toString('ascii', 8, 12))) fail('OBJECT_MISMATCH');
}

@Injectable()
export class FfprobeOttMediaProbe extends OttMediaProbe {
  constructor(private readonly config: ConfigService) { super(); }

  async inspect(media: StoredObject, expected: ExpectedMedia): Promise<VerifiedMedia> {
    verifyObject(media, expected);
    const executable = this.config.get<string>('OTT_MEDIA_FFPROBE_PATH');
    if (!executable || !isAbsolute(executable)) fail('PROBE_UNAVAILABLE');
    const output = await new Promise<string>((resolve, reject) => {
      // Only stdin is permitted: MP4 references cannot open files, URLs or network protocols.
      const child = spawn(executable, ['-v', 'error', '-protocol_whitelist', 'pipe', '-f', 'mov',
        '-i', 'pipe:0', '-show_streams', '-show_packets', '-show_entries',
        'stream=index,codec_type,codec_name,duration:packet=stream_index,pts_time,duration_time,size', '-of', 'json'],
      { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let size = 0;
      let stderr = false;
      let killed = false;
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => { killed = true; child.kill(); }, 15_000);
      child.on('error', () => { clearTimeout(timer); reject(new Error('unavailable')); });
      child.stdout.on('data', (part: Buffer) => {
        size += part.length;
        if (size > 8 * 1024 * 1024) { killed = true; child.kill(); } else chunks.push(part);
      });
      child.stderr.on('data', () => { stderr = true; });
      child.stdin.on('error', () => { /* Closed pipe is handled by the exit result. */ });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (killed || code !== 0 || stderr) reject(new Error('invalid'));
        else resolve(Buffer.concat(chunks).toString('utf8'));
      });
      const input = media.stream();
      input.on('error', () => { killed = true; child.kill(); });
      child.on('close', () => input.destroy());
      input.pipe(child.stdin);
    }).catch((error: Error) => fail(error.message === 'unavailable' ? 'PROBE_UNAVAILABLE' : 'OBJECT_MISMATCH'));
    return validateProbeOutput(output, media, expected);
  }
}

export function validateProbeOutput(output: string, media: StoredObject, expected: ExpectedMedia): VerifiedMedia {
  let parsed: { streams?: { index: number; codec_type: string; codec_name: string; duration: string }[];
    packets?: { stream_index: number; pts_time: string; duration_time: string; size: string }[] };
  try { parsed = JSON.parse(output); } catch { fail('OBJECT_MISMATCH'); }
  if (!Array.isArray(parsed.streams) || !Array.isArray(parsed.packets) || parsed.streams.length !== 2) fail('OBJECT_MISMATCH');
  const video = parsed.streams.find((s) => s.codec_type === 'video' && s.codec_name === 'h264');
  const audio = parsed.streams.find((s) => s.codec_type === 'audio' && s.codec_name === 'aac');
  if (!video || !audio || video.index === audio.index) fail('OBJECT_MISMATCH');
  for (const stream of [video, audio]) {
    const packets = parsed.packets.filter((p) => p.stream_index === stream.index);
    if (!packets.length) fail('OBJECT_MISMATCH');
    const ranges = packets.map((p) => ({ start: Number(p.pts_time), duration: Number(p.duration_time), size: Number(p.size) }));
    if (ranges.some((p) => !Number.isFinite(p.start) || !Number.isFinite(p.duration) || p.duration <= 0 || p.duration > 1
      || !Number.isSafeInteger(p.size) || p.size <= 0 || p.size > media.sizeBytes)) fail('OBJECT_MISMATCH');
    ranges.sort((a, b) => a.start - b.start);
    let end = ranges[0].start;
    if (Math.abs(end) > 0.25) fail('OBJECT_MISMATCH');
    for (const range of ranges) {
      if (range.start - end > 0.25) fail('OBJECT_MISMATCH');
      end = Math.max(end, range.start + range.duration);
    }
    const duration = Number(stream.duration);
    if (!Number.isFinite(duration) || duration <= 0 || Math.abs(end - duration) > 0.25) fail('OBJECT_MISMATCH');
  }
  const durationMs = Math.round(Number(video.duration) * 1000);
  if (durationMs <= 0 || durationMs > MAX_DURATION_MS || Math.abs(durationMs - expected.declaredDurationMs) > 250
    || Math.abs(Number(audio.duration) * 1000 - durationMs) > 500) fail('OBJECT_MISMATCH');
  return { durationMs, sha256: media.sha256, sizeBytes: media.sizeBytes, mimeType: 'video/mp4' };
}
