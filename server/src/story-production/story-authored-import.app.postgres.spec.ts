import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { request } from 'http';
import type { AddressInfo } from 'net';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { createValidationException } from '../common/validation-exception.factory';
import { PrismaService } from '../prisma/prisma.service';
import { assertAuthoredImportTestDatabase, createAuthoredImportPgFixture } from './story-authored-import.postgres-fixture';
import { StoryManuscriptAdmission } from './story-manuscript-file.controller';
import { MANUSCRIPT_FILE_LIMITS } from './story-manuscript-file.policy';
import { StoryContinuationProvider } from './story-continuation.provider';
import { StoryContinuationWorker } from './story-continuation.worker';
import { SemanticAnalysisProvider } from './story-semantic-analysis.provider';
import { SEMANTIC_WORKER } from './story-semantic-analysis.worker';

const databaseUrl = process.env.STORY_AUTHORED_TEST_DATABASE_URL;
const postgres = databaseUrl ? describe : describe.skip;
const secret = 'offline-authored-import-access-secret-32-or-more';

function multipart(source: Buffer, metadata: string, filename = 'sourceMap.json') {
  const boundary = `authored-qa-${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="sourceMap"; filename="${filename}"\r\nContent-Type: application/json\r\n\r\n`),
    source, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) } };
}

postgres('Authored import actual AppModule auth and multipart (private synthetic fixtures)', () => {
  let app: INestApplication | undefined;
  let db: PrismaService;
  let port: number;
  let previous: NodeJS.ProcessEnv;
  let network: jest.SpyInstance | undefined;

  beforeAll(async () => {
    assertAuthoredImportTestDatabase(databaseUrl!);
    previous = { ...process.env };
    network = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('External requests forbidden in authored-import smoke');
    });
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('STORY_SEMANTIC_ANALYSIS_') || key.startsWith('STORY_CONTINUATION_') || key === 'OPENAI_API_KEY') delete process.env[key];
    }
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: databaseUrl,
      JWT_ACCESS_SECRET: secret, JWT_REFRESH_SECRET: 'offline-authored-import-refresh-secret-32-or-more',
      PAYMENT_PROVIDER: 'mock', OBJECT_STORAGE_PROVIDER: 'local' });
    const { AppModule } = await import('../app.module');
    app = await NestFactory.create(AppModule, { rawBody: true, logger: false, abortOnError: false });
    configureHttpRouting(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true,
      forbidUnknownValues: true, transform: true, exceptionFactory: createValidationException }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    db = app.get(PrismaService);
    port = (app.getHttpServer().address() as AddressInfo).port;
  }, 30000);

  afterAll(async () => {
    try {
      await app?.close();
      if (app) {
        expect(app.get(StoryContinuationWorker).readiness()).toMatchObject({ active: false, stopping: true });
        expect(app.get(SEMANTIC_WORKER).readiness()).toMatchObject({ active: false, stopping: true });
      }
      if (network) expect(network).not.toHaveBeenCalled();
    } finally {
      network?.mockRestore();
      if (previous) {
        for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
        Object.assign(process.env, previous);
      }
    }
  });

  function send(path: string, input?: ReturnType<typeof multipart>, token?: string,
    extraHeaders: Record<string, string> = {}) {
    return new Promise<{ status: number; json: any }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path, method: input ? 'POST' : 'GET',
        headers: { connection: 'close', ...input?.headers, ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
        timeout: 10000 }, res => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) res.destroy(new Error('Unexpected oversized local smoke response'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
          catch { reject(new Error('Invalid local smoke JSON response')); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('Local authored-import HTTP timeout')));
      req.on('error', reject);
      req.end(input?.body);
    });
  }

  async function fixture() {
    const f = await createAuthoredImportPgFixture(db);
    const token = await app!.get(JwtService).signAsync({ sub: f.owner.id, tokenType: 'access' }, { secret, expiresIn: '5m' });
    return { ...f, token, path: `/api/v1/me/creator-studio/stories/${f.work.id}/authored-imports`,
      upload: multipart(f.source.buffer, JSON.stringify({ ...f.body, apply: false })) };
  }

  it('boots the complete module with both providers/workers default OFF and health unprefixed', async () => {
    expect(await send('/health')).toMatchObject({ status: 200, json: { status: 'ok', service: 'lumina-stage-api' } });
    const semantic = app!.get(SemanticAnalysisProvider);
    expect(Boolean(semantic.config.apiKey || semantic.config.rateCardId || semantic.config.model)).toBe(false);
    expect(await semantic.readiness()).toMatchObject({ enabled: false });
    expect(await app!.get(StoryContinuationProvider).readiness()).toMatchObject({ enabled: false });
    expect(app!.get(SEMANTIC_WORKER).readiness()).toMatchObject({ enabled: false, active: false, reason: 'worker_disabled' });
    expect(app!.get(StoryContinuationWorker).readiness()).toMatchObject({ enabled: false, active: false, reason: 'worker_disabled' });
  });

  it('requires the actual /api/v1 route and JWT before intake', async () => {
    const f = await fixture();
    expect((await send(f.path.replace('/api/v1', ''), f.upload, f.token)).status).toBe(404);
    expect((await send(f.path, f.upload)).status).toBe(401);
    expect((await send(f.path, f.upload, 'invalid-local-token')).status).toBe(401);
    expect(await db.storyPart.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('rejects another active actor without exposing bindings or parsing source content', async () => {
    const f = await fixture();
    const other = await db.user.create({ data: {} });
    const token = await app!.get(JwtService).signAsync({ sub: other.id, tokenType: 'access' }, { secret, expiresIn: '5m' });
    const response = await send(f.path, multipart(Buffer.from('PRIVATE_NOT_JSON'), '{}'), token);
    expect(response.status).toBe(404);
    const safe = JSON.stringify(response.json);
    expect(safe).not.toContain('PRIVATE_NOT_JSON');
    expect(safe).not.toContain(f.manuscript.id);
    expect(safe).not.toContain(f.owner.id);
  });

  it('parses owned multipart into the registered service and dry-runs without materializing', async () => {
    const f = await fixture();
    const response = await send(f.path, f.upload, f.token);
    expect(response).toMatchObject({ status: 201, json: { mode: 'dry_run', applyExecuted: false, publishReady: false,
      counts: { parts: 3, acts: 2, sourceScenes: 6, beats: 6, choices: 9, verifiedVisualAssets: 0 } } });
    expect(JSON.stringify(response.json)).not.toMatch(/PRIVATE_|Synthetic narrative|parts\/1\.md/);
    expect(await db.storyPart.count({ where: { workId: f.work.id } })).toBe(0);
    expect(await db.storyAuthoredImport.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('rejects unknown metadata and invalid file names, then releases admission after both errors', async () => {
    const f = await fixture();
    const unknown = multipart(f.source.buffer, JSON.stringify({ ...f.body, apply: false, ready: 'PRIVATE_FAKE_APPROVAL' }));
    const badMetadata = await send(f.path, unknown, f.token);
    expect(badMetadata).toMatchObject({ status: 400, json: { error: { code: 'AUTHORED_IMPORT_MULTIPART_INVALID' } } });
    expect(JSON.stringify(badMetadata.json)).not.toContain('PRIVATE_FAKE_APPROVAL');
    const badFile = await send(f.path, multipart(f.source.buffer, JSON.stringify(f.body), 'sourceMap.exe'), f.token);
    expect(badFile.status).toBe(400);
    expect((await send(f.path, f.upload, f.token)).status).toBe(201);
  });

  it('bounds the real request envelope and rejects encoded uploads before allocating the file', async () => {
    const f = await fixture();
    expect(await send(f.path, f.upload, f.token, { 'content-length': String(MANUSCRIPT_FILE_LIMITS.requestBytes + 1) }))
      .toMatchObject({ status: 413, json: { error: { code: 'MANUSCRIPT_REQUEST_TOO_LARGE' } } });
    expect(await send(f.path, f.upload, f.token, { 'content-encoding': 'gzip' }))
      .toMatchObject({ status: 400, json: { error: { code: 'MANUSCRIPT_MULTIPART_REQUIRED' } } });
  });

  it('shares the existing admission pool with manuscript intake and resumes after release', async () => {
    const f = await fixture();
    const release = app!.get(StoryManuscriptAdmission).enter(randomUUID());
    try {
      expect(await send(f.path, f.upload, f.token)).toMatchObject({ status: 429,
        json: { error: { code: 'MANUSCRIPT_INTAKE_BUSY' } } });
      expect(await send(f.path.replace('/authored-imports', '/manuscripts/file'), f.upload, f.token))
        .toMatchObject({ status: 429, json: { error: { code: 'MANUSCRIPT_INTAKE_BUSY' } } });
    } finally { release(); }
    expect((await send(f.path, f.upload, f.token)).status).toBe(201);
  });
});
