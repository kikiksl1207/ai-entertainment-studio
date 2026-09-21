import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { LOCALES, Locale } from '../ott-media/ott-media.contract';
import { OttMediaDelivery } from '../ott-media/ott-media.delivery';
import { PrismaOttMediaRepository } from '../ott-media/ott-media.repository';
import { OttMediaService } from '../ott-media/ott-media.service';
import { sha256 } from '../ott-media/ott-media.storage';
import { EXPECTED, MemoryStorage, ProbeDouble, SAMPLE } from '../ott-media/ott-media.test-doubles';
import { PlaybackGraph } from './ott-playback.contract';
import { OttPlaybackService } from './ott-playback.service';

export function playbackPostgresClient() {
  const url = new URL(process.env.OTT_PLAYBACK_TEST_DATABASE_URL!);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432'
    || url.pathname !== '/lumina_ott_branch_qa' || url.username !== 'lumina_qa'
    || url.password || [...url.searchParams.keys()].some((key) => !['schema', 'connection_limit'].includes(key))
    || (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public')) {
    throw new Error('OTT playback tests require the isolated synthetic loopback database');
  }
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

export const labels = () => Object.fromEntries(LOCALES.map((locale) => [locale, `Synthetic ${locale}`]));

// Persistence is real PostgreSQL; storage and probe are explicit doubles.
// These differing bytes are not movies and are never published or used as media proof.
export async function playbackFixture(db: PrismaClient, subtitleLocales: readonly Locale[] = LOCALES) {
  const owner = (await db.user.create({ data: {} })).id;
  const other = (await db.user.create({ data: {} })).id;
  const storage = new MemoryStorage(); const probe = new ProbeDouble();
  const delivery = new OttMediaDelivery(new ConfigService({ OTT_MEDIA_DELIVERY_SECRET: 'test-only-not-production'.repeat(2) }));
  const media = new OttMediaService(new PrismaOttMediaRepository(db as never), storage, probe, delivery);
  const service = new OttPlaybackService(db as never, media);
  const work = await media.createWork(owner, { title: 'Synthetic private authored graph' });
  async function source(versionId: string, name: string, actor = owner, locales = subtitleLocales) {
    const bytes = Buffer.concat([SAMPLE, Buffer.from(name)]);
    const expected = { ...EXPECTED, sizeBytes: bytes.length, sha256: sha256(bytes) };
    const file = await media.createIntent(actor, versionId, randomUUID(), expected);
    await media.uploadObject(actor, file.fileId, Readable.from([bytes]), 'video/mp4');
    await media.confirm(actor, file.fileId, { subtitles: locales.map((locale) => ({ locale,
      cues: [{ startMs: 0, endMs: 900, text: `Synthetic ${name} ${locale}` }] })) });
    return { fileId: file.fileId, mediaVersionId: versionId, startMs: 100, endMs: 900 };
  }
  const intro = await source(work.versionId, 'intro');
  const b = await source((await media.createVersion(owner, work.workId, {})).versionId, 'branch-b');
  const c = await source((await media.createVersion(owner, work.workId, {})).versionId, 'branch-c');
  const graph: PlaybackGraph = { entryNodeKey: 'intro', nodes: [
    { key: 'intro', clip: intro, rejoin: false, ending: null, choices: [
      { key: 'take-b', label: labels(), targetNodeKey: 'b' },
      { key: 'take-c', label: labels(), targetNodeKey: 'c' },
    ] },
    { key: 'b', clip: b, rejoin: false, choices: [], ending: { key: 'ending-b', label: labels() } },
    { key: 'c', clip: c, rejoin: false, choices: [], ending: { key: 'ending-c', label: labels() } },
  ] };
  async function manifest(value = graph, key = randomUUID()) {
    return service.createManifest(owner, work.workId, key, { graph: value });
  }
  async function playable(value = graph, locale: Locale = 'ko') {
    const result = await manifest(value);
    const preview = await service.pinPreview(owner, result.manifestId, { locale });
    const progress = await service.startProgress(owner, preview.previewId, {});
    return { manifest: result, preview, progress };
  }
  return { owner, other, storage, probe, delivery, media, service, work, source, intro, b, c, graph, manifest, playable };
}
