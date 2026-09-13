import { ExecutionContext, INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { request } from 'http';
import { AddressInfo } from 'net';
import { join, resolve, sep } from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HealthController } from '../health.controller';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { PrismaService } from '../prisma/prisma.service';
import { UserAssetsModule } from '../assets/user-assets.module';
import { OttMediaModule } from './ott-media.module';
import { OttMediaProbe } from './ott-media.probe';
import { OttMediaRepository } from './ott-media.repository';
import { OttObjectStorage } from './ott-media.storage';
import { EXPECTED, MemoryRepository, ProbeDouble, SAMPLE } from './ott-media.test-doubles';

describe('loopback HTTP vertical flow: real stream storage/controller/cookie; explicit auth, DB and probe doubles', () => {
  let app: INestApplication;
  let port: number;
  let root: string;
  const owner = randomUUID();
  let active = true;
  beforeAll(async () => {
    if (!/^E:[/\\]/i.test(process.env.TEMP ?? '')) throw new Error('E-only TEMP required');
    root = await mkdtemp(join(process.env.TEMP!, 'ott-http-'));
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true, skipProcessEnv: true }), OttMediaModule, UserAssetsModule],
      controllers: [HealthController],
    }).overrideProvider(PrismaService).useValue({ user: { findFirst: async () => active ? { id: owner } : null },
      asset: { findFirst: async () => null, findUnique: async () => null } })
      .overrideProvider(ConfigService).useValue(new ConfigService({ OTT_MEDIA_STORAGE_MODE: 'private_local',
        OTT_MEDIA_LOCAL_ROOT: root, OTT_MEDIA_LOCAL_PRIVATE_CONFIRMED: 'true', OTT_MEDIA_PUBLIC_ROOTS: '[]',
        OTT_MEDIA_DELIVERY_SECRET: 'test-only-not-production'.repeat(2), OTT_MEDIA_BROWSER_ORIGINS: '["https://lumina-stage.com"]' }))
      .overrideProvider(OttMediaRepository).useValue(new MemoryRepository())
      .overrideProvider(OttMediaProbe).useValue(new ProbeDouble())
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        if (req.headers.authorization !== 'Bearer local-test') return false;
        req.user = { id: owner }; return true;
      } }).compile();
    app = module.createNestApplication({ rawBody: true, logger: false });
    app.setGlobalPrefix('api/v1', { exclude: [{ path: 'health', method: RequestMethod.ALL }] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });
  afterAll(async () => {
    await app?.close();
    const parent = resolve(process.env.TEMP!);
    if (root && resolve(root).startsWith(`${parent}${sep}ott-http-`)) await rm(root, { recursive: true, force: true });
  });

  function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    if (!path.startsWith('/')) throw new Error('loopback paths only');
    return new Promise<{ status: number; headers: Record<string, unknown>; bytes: Buffer; json: any }>((accept, reject) => {
      const bytes = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
      const req = request({ hostname: '127.0.0.1', port, method, path,
        headers: { ...(bytes && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const bytes = Buffer.concat(chunks);
          let json: unknown; try { json = JSON.parse(bytes.toString()); } catch { json = undefined; }
          accept({ status: res.statusCode!, headers: res.headers, bytes, json });
        });
      });
      req.on('error', reject);
      req.end(bytes);
    });
  }

  it('health stays ok; author registers, streams, confirms, gets private Range session, refreshes; generic/anonymous/disabled access blocked', async () => {
    const auth = { authorization: 'Bearer local-test' };
    expect((await call('GET', '/health')).json.status).toBe('ok');
    const work = await call('POST', '/api/v1/me/ott-media/works', { title: 'Tiny synthetic contract test' }, auth);
    expect(work.status).toBe(201);
    const intent = await call('POST', `/api/v1/me/ott-media/versions/${work.json.versionId}/upload-intents`, EXPECTED,
      { ...auth, 'idempotency-key': 'http-test-key-1' });
    expect(intent.status).toBe(201);
    expect(intent.json.media).toBeNull();
    const id = intent.json.fileId;
    expect((await call('GET', `/api/v1/me/ott-media/files/${id}/preview`, undefined, auth)).status).toBe(409);
    const uploaded = await call('PUT', intent.json.upload.path, SAMPLE, { ...auth, 'content-type': 'video/mp4' });
    expect(uploaded.status).toBe(200);
    expect(uploaded.json.status).toBe('uploaded');
    const confirm = await call('POST', `/api/v1/me/ott-media/files/${id}/confirm`, { subtitles: [] }, auth);
    expect(confirm.json.status).toBe('confirmed');
    const preview = await call('GET', `/api/v1/me/ott-media/files/${id}/preview`, undefined, auth);
    expect(preview.json.availableSubtitleLocales).toEqual([]);
    const sessionPath = preview.json.browserPlayback.sessionPath;
    expect((await call('POST', sessionPath, {}, { ...auth, origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('POST', sessionPath, {}, { origin: 'https://lumina-stage.com' })).status).toBe(403);
    const session = await call('POST', sessionPath, {}, { ...auth, origin: 'https://lumina-stage.com' });
    expect(session.status).toBe(201);
    expect(session.json).not.toHaveProperty('cookie');
    const cookie = (session.headers['set-cookie'] as string[])[0].split(';')[0];
    const path = session.json.playback.path;
    expect((await call('GET', path)).status).toBe(403);
    const range = await call('GET', path, undefined, { cookie, range: 'bytes=0-7' });
    expect(range.status).toBe(206);
    expect(range.bytes).toEqual(SAMPLE.subarray(0, 8));
    expect(range.headers['content-range']).toBe(`bytes 0-7/${SAMPLE.length}`);
    expect(range.headers['cache-control']).toBe('private, no-store');
    const storage = app.get(OttObjectStorage);
    const open = storage.open.bind(storage);
    const closes: jest.Mock[] = [];
    const opened = jest.spyOn(storage, 'open').mockImplementation(async (id) => {
      const media = await open(id);
      const close = jest.fn(() => media.close());
      closes.push(close);
      return { ...media, close };
    });
    try {
      const invalidRange = await call('GET', path, undefined, { cookie, range: 'bytes=9999-' });
      expect(opened).toHaveBeenCalledTimes(1);
      expect(closes).toHaveLength(1);
      expect(closes[0]).toHaveBeenCalledTimes(1);
      expect(invalidRange.status).toBe(416);
      expect(invalidRange.headers['content-range']).toBe(`bytes */${SAMPLE.length}`);
      expect(invalidRange.headers['cache-control']).toBe('private, no-store');
      expect(invalidRange.headers.vary).toBe('Origin, Authorization, Cookie');
      expect(invalidRange.headers['cross-origin-resource-policy']).toBe('same-site');
    } finally { opened.mockRestore(); }
    expect((await call('GET', path, undefined, { cookie, origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('GET', `/api/v1/assets/public/${id}`)).status).toBe(404);
    expect((await call('GET', `/api/v1/me/assets/${id}`, undefined, auth)).status).toBe(404);
    expect((await call('GET', `/storage/${id}.mp4`)).status).toBe(404);
    active = false;
    expect((await call('GET', path, undefined, { cookie, range: 'bytes=8-' })).status).toBe(403);
    active = true;
    const fresh = await call('POST', sessionPath, {}, { ...auth, origin: 'https://lumina-stage.com' });
    expect(fresh.status).toBe(201);
    expect((await call('GET', path, undefined, { cookie: (fresh.headers['set-cookie'] as string[])[0].split(';')[0], range: 'bytes=8-' })).status).toBe(206);
  });
});
