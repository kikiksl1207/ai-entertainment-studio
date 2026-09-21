import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { request } from 'http';
import { AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { OttPlaybackController } from './ott-playback.controller';
import { playbackFixture, playbackPostgresClient } from './ott-playback.postgres-fixture';
import { OttPlaybackService } from './ott-playback.service';

const describePostgres = process.env.OTT_PLAYBACK_TEST_DATABASE_URL ? describe : describe.skip;
jest.setTimeout(30_000);

describePostgres('OTT graph controller -> service -> real PostgreSQL; loopback HTTP, explicit auth/media doubles', () => {
  let app: INestApplication; let db: PrismaClient; let port: number;
  let f: Awaited<ReturnType<typeof playbackFixture>>;
  beforeAll(async () => {
    db = playbackPostgresClient(); f = await playbackFixture(db);
    const module = await Test.createTestingModule({ controllers: [OttPlaybackController],
      providers: [{ provide: OttPlaybackService, useValue: f.service }] })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest(); const key = req.headers.authorization;
        if (key !== 'Bearer owner-fixture' && key !== 'Bearer other-fixture') return false;
        req.user = { id: key === 'Bearer owner-fixture' ? f.owner : f.other }; return true;
      } }).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1'); port = (app.getHttpServer().address() as AddressInfo).port;
  });
  afterAll(async () => { await app?.close(); await db?.$disconnect(); });

  function call(method: string, path: string, body?: unknown, actor: 'owner' | 'other' | 'anonymous' = 'owner', key?: string) {
    return new Promise<{ status: number; cache: string | undefined; json: any }>((accept, reject) => {
      const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const req = request({ hostname: '127.0.0.1', port, method, path: `/api/v1/me/ott-media/${path}`,
        headers: { ...(bytes ? { 'content-type': 'application/json' } : {}),
          ...(actor !== 'anonymous' ? { authorization: `Bearer ${actor}-fixture` } : {}), ...(key ? { 'idempotency-key': key } : {}) } }, (res) => {
        const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try { accept({ status: res.statusCode!, cache: res.headers['cache-control'], json: JSON.parse(Buffer.concat(chunks).toString()) }); }
          catch (error) { reject(error); }
        });
      });
      req.on('error', reject); req.end(bytes);
    });
  }

  it('creates/lists/reviews/pins/plays authored branches privately; server resolves target and resume preserves revision', async () => {
    const path = `works/${f.work.workId}/playback-manifests`;
    expect((await call('POST', path, { graph: f.graph }, 'anonymous', randomUUID())).status).toBe(403);
    const created = await call('POST', path, { graph: f.graph }, 'owner', randomUUID());
    expect(created.status).toBe(201); expect(created.cache).toBe('private, no-store');
    const id = created.json.manifestId;
    const list = await call('GET', `${path}?limit=1`);
    expect(list.json.items[0].manifestId).toBe(id);
    const detail = await call('GET', `playback-manifests/${id}`);
    expect(detail.json.graph.nodes).toHaveLength(3);
    expect(detail.json.readiness.fiveLocaleReady).toBe(true);
    expect((await call('GET', `playback-manifests/${id}`, undefined, 'other')).status).toBe(404);
    const preview = await call('POST', `playback-manifests/${id}/preview-pins`, { locale: 'ko' });
    expect(preview.json.publication).toBe('not_authorized');
    const started = await call('POST', `playback-previews/${preview.json.previewId}/progress`, {});
    const p = started.json; const progressPath = `playback-progress/${p.progressId}`;
    expect(p.node.clip.fileId).toBe(f.intro.fileId);
    const command = { manifestId: id, expectedRevision: p.revision, nodeKey: 'intro', choiceKey: 'take-c' };
    expect((await call('POST', `${progressPath}/choices`, { ...command, targetNodeKey: 'b' }, 'owner', randomUUID())).status).toBe(400);
    const key = randomUUID(); const selected = await call('POST', `${progressPath}/choices`, command, 'owner', key);
    expect(selected.json.node.key).toBe('c'); expect(selected.json.node.clip.fileId).toBe(f.c.fileId);
    expect(selected.json.browserPlayback.sessionPath).toBe(`/api/v1/me/ott-media/files/${f.c.fileId}/playback-session`);
    expect(JSON.stringify(selected.json)).not.toMatch(/ownerId|authorId|storageKey|signature|secret|token|publicUrl/);
    expect((await call('POST', `${progressPath}/choices`, command, 'owner', key)).json.idempotentReplay).toBe(true);
    expect((await call('GET', progressPath, undefined, 'other')).status).toBe(404);
    const saved = await call('PUT', `${progressPath}/position`, { manifestId: id, expectedRevision: 2, nodeKey: 'c', positionMs: 450 }, 'owner', randomUUID());
    expect(saved.status).toBe(200); expect(saved.json.revision).toBe(3);
    const resumed = await call('GET', progressPath);
    expect(resumed.json).toMatchObject({ manifestId: id, revision: 3, positionMs: 450 });
    expect((await call('POST', `${progressPath}/choices`, command, 'owner', randomUUID())).status).toBe(409);
    await f.media.revoke(f.owner, f.c.fileId, {});
    expect((await call('GET', progressPath)).status).toBe(409);
    expect((await call('POST', `${progressPath}/choices`, command, 'owner', key)).status).toBe(409);
  });
});
