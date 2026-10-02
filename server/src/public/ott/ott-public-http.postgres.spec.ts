import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { readFile, mkdtemp, rm } from 'fs/promises';
import { request } from 'http';
import { AddressInfo } from 'net';
import { join, resolve, sep } from 'path';
import { Readable } from 'stream';
import helmet from 'helmet';
import { HttpExceptionFilter } from '../../common/http-exception.filter';
import { configureHttpRouting } from '../../common/http-routing';
import { LOCALES } from '../../ott-media/ott-media.contract';
import { OttMediaDelivery } from '../../ott-media/ott-media.delivery';
import { FfprobeOttMediaProbe } from '../../ott-media/ott-media.probe';
import { PrismaOttMediaRepository } from '../../ott-media/ott-media.repository';
import { OttMediaService } from '../../ott-media/ott-media.service';
import { PrivateLocalOttStorage, sha256 } from '../../ott-media/ott-media.storage';
import { OttPlaybackService } from '../../ott-playback/ott-playback.service';
import { INTERNAL_GENERATION_COST_TREATMENT } from '../../story-settlement/content-rights-contract.contract';
import { OttPublicController } from './ott-public.controller';
import { OttPublicService } from './ott-public.service';

const databaseName = 'lumina_ott_public_http_qa';
const origin = 'https://lumina-stage.com';
const url = process.env.OTT_PUBLIC_HTTP_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
const labels = (prefix: string) => Object.fromEntries(LOCALES.map((locale) => [locale, `${prefix} ${locale}`]));

type HttpResult = { status: number; headers: Record<string, string | string[] | undefined>; bytes: Buffer; json: any };

function localDatabaseUrl(value: string) {
  const target = new URL(value);
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '55432'
    || target.pathname !== `/${databaseName}` || target.username !== 'lumina_qa' || target.password
    || target.hash || [...target.searchParams.keys()].some((key) => key !== 'schema')
    || (target.searchParams.has('schema') && target.searchParams.get('schema') !== 'public')) {
    throw new Error('Dedicated E-drive OTT public HTTP QA database required');
  }
  return target.toString();
}

function syntheticMp4(ffmpeg: string, path: string, color: string) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=${color}:s=64x64:r=10:d=1`,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '32k', '-movflags', '+faststart', path],
  { windowsHide: true, timeout: 15000 });
  if (result.status !== 0) throw new Error(`Synthetic MP4 generation failed: ${result.stderr?.toString()}`);
}

postgres('public OTT watch over loopback HTTP, real isolated PostgreSQL and private MP4 storage', () => {
  jest.setTimeout(120000);
  let db: PrismaClient;
  let app: INestApplication;
  let port: number;
  let root: string;
  let media: OttMediaService;
  let playback: OttPlaybackService;
  let releases: unknown[] = [];
  let clips: Buffer[];

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: localDatabaseUrl(url!) } } });
    await db.$connect();
    const [identity] = await db.$queryRaw<Array<{ name: string; actor: string; port: number }>>`
      SELECT current_database() AS name, current_user AS actor, inet_server_port() AS port`;
    expect(identity).toEqual({ name: databaseName, actor: 'lumina_qa', port: 55432 });

    const parent = resolve('E:/Codex/LuminaStage');
    root = await mkdtemp(join(parent, 'qa-ott-public-http-'));
    const ffmpeg = 'E:/Codex/ffmpeg-9.0.1-essentials_build/ffmpeg-9.0.1-essentials_build/bin/ffmpeg.exe';
    const ffprobe = 'E:/Codex/ffmpeg-9.0.1-essentials_build/ffmpeg-9.0.1-essentials_build/bin/ffprobe.exe';
    const paths = ['red.mp4', 'blue.mp4'].map((name) => join(root, name));
    syntheticMp4(ffmpeg, paths[0], 'red');
    syntheticMp4(ffmpeg, paths[1], 'blue');
    clips = await Promise.all(paths.map((path) => readFile(path)));
    expect(clips[0]).not.toEqual(clips[1]);

    const settings: Record<string, string> = {
      OTT_MEDIA_STORAGE_MODE: 'private_local', OTT_MEDIA_LOCAL_ROOT: join(root, 'private'),
      OTT_MEDIA_LOCAL_PRIVATE_CONFIRMED: 'true', OTT_MEDIA_PUBLIC_ROOTS: '[]',
      OTT_MEDIA_FFPROBE_PATH: ffprobe, OTT_MEDIA_DELIVERY_SECRET: 'synthetic-only-public-http-secret'.repeat(2),
      OTT_MEDIA_BROWSER_ORIGINS: JSON.stringify([origin]),
    };
    const config = {
      get: (key: string) => key === 'OTT_PUBLIC_CATALOG_RELEASES' ? JSON.stringify(releases) : settings[key],
      getOrThrow: (key: string) => {
        if (!settings[key]) throw new Error(`Missing test setting: ${key}`);
        return settings[key];
      },
    } as ConfigService;
    const delivery = new OttMediaDelivery(config);
    media = new OttMediaService(new PrismaOttMediaRepository(db as never),
      new PrivateLocalOttStorage(config), new FfprobeOttMediaProbe(config), delivery);
    playback = new OttPlaybackService(db as never, media);
    const publicService = new OttPublicService(db as never, config, media, delivery);
    const module = await Test.createTestingModule({ controllers: [OttPublicController], providers: [
      { provide: OttPublicService, useValue: publicService }, { provide: OttMediaDelivery, useValue: delivery },
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
    configureHttpRouting(app);
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableCors({ origin: [origin], credentials: true });
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    const parent = resolve('E:/Codex/LuminaStage');
    if (root && resolve(root).startsWith(`${parent}${sep}qa-ott-public-http-`)) {
      await rm(root, { recursive: true, force: true });
    }
  });

  function call(method: string, path: string, headers: Record<string, string> = {}): Promise<HttpResult> {
    if (!path.startsWith('/api/v1/ott/')) throw new Error('Only loopback OTT routes are allowed');
    return new Promise((resolveCall, reject) => {
      const req = request({ hostname: '127.0.0.1', port, method, path, headers }, (res) => {
        const parts: Buffer[] = [];
        res.on('data', (part: Buffer) => parts.push(part));
        res.on('end', () => {
          const bytes = Buffer.concat(parts);
          let json: unknown;
          try { json = JSON.parse(bytes.toString()); } catch { json = undefined; }
          resolveCall({ status: res.statusCode!, headers: res.headers, bytes, json });
        });
      });
      req.setTimeout(10000, () => req.destroy(new Error('Loopback HTTP timeout')));
      req.on('error', reject);
      req.end();
    });
  }

  async function fixture() {
    const owner = (await db.user.create({ data: {} })).id;
    const work = await media.createWork(owner, { title: 'Synthetic two-node public watch' });
    const versions = [work.versionId, (await media.createVersion(owner, work.workId, {})).versionId];
    const files = [];
    const durations = [];
    for (let index = 0; index < clips.length; index++) {
      const bytes = clips[index];
      const expected = { sha256: sha256(bytes), sizeBytes: bytes.length,
        mimeType: 'video/mp4' as const, declaredDurationMs: 1000, audioLocale: 'ko' as const };
      const intent = await media.createIntent(owner, versions[index], randomUUID(), expected);
      await media.uploadObject(owner, intent.fileId, Readable.from([bytes]), 'video/mp4');
      await media.confirm(owner, intent.fileId, { subtitles: LOCALES.map((locale) => ({ locale,
        cues: [{ startMs: 0, endMs: 900, text: `Synthetic node ${index} ${locale}` }] })) });
      const upload = await db.ottMediaUpload.findUniqueOrThrow({ where: { id: intent.fileId } });
      files.push(intent.fileId);
      durations.push((upload.verified as { durationMs: number }).durationMs);
    }
    const graph = { entryNodeKey: 'intro', nodes: [
      { key: 'intro', clip: { fileId: files[0], mediaVersionId: versions[0], startMs: 0, endMs: durations[0] },
        choices: [{ key: 'continue', label: labels('Continue'), targetNodeKey: 'outro' }], ending: null, rejoin: false },
      { key: 'outro', clip: { fileId: files[1], mediaVersionId: versions[1], startMs: 0, endMs: durations[1] },
        choices: [], ending: { key: 'end', label: labels('End') }, rejoin: false },
    ] };
    const manifest = await playback.createManifest(owner, work.workId, randomUUID(), { graph });
    expect(manifest.readiness.fiveLocaleReady).toBe(true);
    const contract = await db.contentRightsContract.create({ data: {
      workType: 'ott', workId: work.workId, createdByUserId: owner,
    } });
    const rights = [];
    for (let index = 0; index < versions.length; index++) {
      const right = await db.contentRightsContractVersion.create({ data: {
        contractId: contract.id, revision: index + 1, contentVersionId: versions[index],
        exclusivity: 'nonexclusive', media: ['ott_streaming'], regions: ['WORLDWIDE'],
        startsAt: new Date(0), effectiveFrom: new Date(0), saleAllowed: true,
        aiTransformationAllowed: false, generatedResultReuseAllowed: false,
        approvalState: 'approved_configuration', authorRightsHolderShareBps: 4500,
        salesAgencyShareBps: 500, companyShareBps: 5000,
        pointUsagePolicy: 'unresolved', refundReversalPolicy: 'unresolved',
        paidPointPolicy: 'unresolved', bonusPointPolicy: 'unresolved', vatPolicy: 'unresolved',
        internalGenerationCostTreatment: INTERNAL_GENERATION_COST_TREATMENT,
        createdByUserId: owner, approvedByUserId: owner,
      } });
      rights.push(right.id);
    }
    const slug = `synthetic-${randomUUID()}`;
    releases = [{ slug, workId: work.workId, manifestId: manifest.manifestId,
      rightsContractVersionIds: rights, status: 'published', source: 'authored_uploaded_clips',
      fixtureSource: false, rightsAuthorization: 'cleared_for_public_streaming',
      authorizedAt: new Date(0).toISOString(), publishedAt: new Date(0).toISOString(),
      title: labels('Synthetic title'), synopsis: labels('Synthetic synopsis'), creatorName: labels('Synthetic creator') }];
    return { slug, owner, work, versions, files, contract, rights };
  }

  it('serves detail/watch, origin-bound cookie and node-only 206; a newer draft stays published until rights revoke', async () => {
    const f = await fixture();
    const base = `/api/v1/ott/${f.slug}`;
    const detail = await call('GET', base, { origin });
    expect(detail.status).toBe(200);
    expect(detail.json.viewing).toEqual({ available: true, watchPath: `${base}/watch` });
    const watch = await call('GET', `${base}/watch`, { origin });
    expect(watch.status).toBe(200);
    expect(watch.json.nodes.map((node: { key: string }) => node.key)).toEqual(['intro', 'outro']);
    expect(watch.json.nodes[0].browserPlayback.sessionPath).toBe(`${base}/nodes/intro/playback-session`);
    expect(JSON.stringify(watch.json)).not.toMatch(/fileId|mediaVersionId|rightsContractVersionIds|__Secure-ott-public/);
    const session = await call('POST', watch.json.nodes[0].browserPlayback.sessionPath, { origin });
    expect(session.status).toBe(201);
    expect(session.headers['access-control-allow-origin']).toBe(origin);
    expect(session.headers['access-control-allow-credentials']).toBe('true');
    const setCookie = (session.headers['set-cookie'] as string[])[0];
    expect(setCookie).toMatch(/^__Secure-ott-public=.+; Path=\/api\/v1\/ott\/.+; Max-Age=60; HttpOnly; Secure; SameSite=Strict$/);
    const cookie = setCookie.split(';')[0];
    const path = session.json.playback.path;
    expect(path).toBe(`${base}/nodes/intro/delivery`);
    const denied = await call('GET', path, { origin, range: 'bytes=0-31' });
    expect(denied.status).toBe(403);
    expect(denied.bytes).not.toEqual(clips[0].subarray(0, 32));
    expect((await call('POST', watch.json.nodes[0].browserPlayback.sessionPath,
      { origin: 'https://not-allowed.example' })).status).toBe(403);
    const start = clips[0].findIndex((byte, index) => byte !== clips[1][index]);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = Math.min(start + 31, clips[0].length - 1);
    const range = await call('GET', path, { origin, cookie, range: `bytes=${start}-${end}` });
    expect(range.status).toBe(206);
    expect(range.bytes).toEqual(clips[0].subarray(start, end + 1));
    expect(range.bytes).not.toEqual(clips[1].subarray(start, end + 1));
    expect(range.headers['content-range']).toBe(`bytes ${start}-${end}/${clips[0].length}`);
    expect(range.headers['access-control-allow-origin']).toBe(origin);
    expect(range.headers['access-control-allow-credentials']).toBe('true');
    expect((await call('GET', `${base}/nodes/outro/delivery`, { origin, cookie, range: 'bytes=0-31' })).status).toBe(403);

    await db.contentRightsContractVersion.create({ data: {
      contractId: f.contract.id, revision: 3, sourceVersionId: f.rights[1], contentVersionId: f.versions[1],
      exclusivity: 'nonexclusive', media: ['ott_streaming'], regions: ['WORLDWIDE'],
      startsAt: new Date(0), effectiveFrom: new Date(0), saleAllowed: true,
      aiTransformationAllowed: false, generatedResultReuseAllowed: false,
      approvalState: 'draft', authorRightsHolderShareBps: 4500,
      salesAgencyShareBps: 500, companyShareBps: 5000,
      pointUsagePolicy: 'unresolved', refundReversalPolicy: 'unresolved',
      paidPointPolicy: 'unresolved', bonusPointPolicy: 'unresolved', vatPolicy: 'unresolved',
      internalGenerationCostTreatment: INTERNAL_GENERATION_COST_TREATMENT, createdByUserId: f.owner,
    } });
    expect((await call('GET', `${base}/watch`, { origin })).status).toBe(200);
    const afterDraft = await call('GET', path, { origin, cookie, range: 'bytes=32-63' });
    expect(afterDraft.status).toBe(206);
    expect(afterDraft.bytes).toEqual(clips[0].subarray(32, 64));

    await db.contentRightsContractVersion.create({ data: {
      contractId: f.contract.id, revision: 4, sourceVersionId: f.rights[1], contentVersionId: f.versions[1],
      exclusivity: 'nonexclusive', media: ['download'], regions: ['WORLDWIDE'],
      startsAt: new Date(0), effectiveFrom: new Date(0), saleAllowed: true,
      aiTransformationAllowed: false, generatedResultReuseAllowed: false,
      approvalState: 'approved_configuration', authorRightsHolderShareBps: 4500,
      salesAgencyShareBps: 500, companyShareBps: 5000,
      pointUsagePolicy: 'unresolved', refundReversalPolicy: 'unresolved',
      paidPointPolicy: 'unresolved', bonusPointPolicy: 'unresolved', vatPolicy: 'unresolved',
      internalGenerationCostTreatment: INTERNAL_GENERATION_COST_TREATMENT,
      createdByUserId: f.owner, approvedByUserId: f.owner,
    } });
    const revoked = await call('GET', path, { origin, cookie, range: 'bytes=64-95' });
    expect(revoked.status).toBe(404);
    expect(revoked.bytes).not.toEqual(clips[0].subarray(64, 96));
    expect((await call('GET', `${base}/watch`, { origin })).status).toBe(404);
  });

  it('revoking another graph asset blocks a previously issued node cookie', async () => {
    const f = await fixture();
    const base = `/api/v1/ott/${f.slug}`;
    const session = await call('POST', `${base}/nodes/intro/playback-session`, { origin });
    expect(session.status).toBe(201);
    const cookie = (session.headers['set-cookie'] as string[])[0].split(';')[0];
    const path = session.json.playback.path;
    expect((await call('GET', path, { origin, cookie, range: 'bytes=0-15' })).status).toBe(206);
    await db.ottMediaRevocation.create({ data: { fileId: f.files[1], ownerId: f.owner } });
    const revoked = await call('GET', path, { origin, cookie, range: 'bytes=16-31' });
    expect(revoked.status).toBe(404);
    expect(revoked.bytes).not.toEqual(clips[0].subarray(16, 32));
    expect((await call('GET', base, { origin })).status).toBe(404);
  });

  it.each(['rights expiry', 'regional restriction', 'publication withdrawal'])(
    'stops serving bytes to an already issued cookie after %s', async (change) => {
      const f = await fixture();
      const base = `/api/v1/ott/${f.slug}`;
      const session = await call('POST', `${base}/nodes/intro/playback-session`, { origin });
      expect(session.status).toBe(201);
      const cookie = (session.headers['set-cookie'] as string[])[0].split(';')[0];
      const path = session.json.playback.path;
      const before = await call('GET', path, { origin, cookie, range: 'bytes=0-31' });
      expect(before.status).toBe(206);
      expect(before.bytes).toEqual(clips[0].subarray(0, 32));

      if (change === 'rights expiry') {
        const endsAt = new Date(Date.now() + 500);
        await db.contentRightsContractVersion.update({ where: { id: f.rights[1] }, data: { endsAt } });
        await new Promise((done) => setTimeout(done, Math.max(0, endsAt.getTime() - Date.now()) + 20));
      } else if (change === 'regional restriction') {
        await db.contentRightsContractVersion.update({ where: { id: f.rights[1] }, data: { regions: ['KR'] } });
      } else {
        releases = [];
      }

      expect(new Date(session.json.playback.expiresAt).getTime()).toBeGreaterThan(Date.now());
      const after = await call('GET', path, { origin, cookie, range: 'bytes=32-63' });
      expect(after.status).toBe(404);
      expect(after.bytes).not.toEqual(clips[0].subarray(32, 64));
      expect((await call('POST', `${base}/nodes/intro/playback-session`, { origin })).status).toBe(404);
      expect((await call('GET', `${base}/watch`, { origin })).status).toBe(404);
    });
});
