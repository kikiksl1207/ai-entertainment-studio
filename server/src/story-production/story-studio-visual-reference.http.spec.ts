import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { request } from 'http';
import { AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { PrismaService } from '../prisma/prisma.service';
import { StoryStudioLinearController } from './story-studio-linear.controller';
import { StoryStudioLinearService } from './story-studio-linear.service';
import { StoryStudioChoiceJobService } from './story-studio-choice-job.service';
import { StoryStudioChoiceRecoveryService } from './story-studio-choice-recovery.service';

describe('Original image references HTTP (real JWT/DTO, read-only synthetic persistence)', () => {
  let app: INestApplication, port: number, token: string;
  const owner = randomUUID(), workId = randomUUID(), manuscriptId = randomUUID();
  const page = jest.fn(), detail = jest.fn(), materialize = jest.fn(), retry = jest.fn(), reset = jest.fn();
  const hashes = { expectedManuscriptHash: 'a'.repeat(64), expectedSourceChecksum: 'b'.repeat(64) };

  beforeAll(async () => {
    const jwt = new JwtService(), secret = randomUUID();
    token = await jwt.signAsync({ sub: owner, tokenType: 'access' }, { secret, expiresIn: '5m' });
    const module = await Test.createTestingModule({ controllers: [StoryStudioLinearController], providers: [
      { provide: StoryStudioLinearService, useValue: { visualReferencePage: page, visualReferenceDetail: detail, materialize } },
      { provide: StoryStudioChoiceJobService, useValue: { retry } },
      { provide: StoryStudioChoiceRecoveryService, useValue: { reset } },
      { provide: PrismaService, useValue: { user: { findFirst: jest.fn(async ({ where }) => ({ id: where.id })) } } },
      { provide: JwtService, useValue: jwt },
      { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) }, JwtAuthGuard,
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app); app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1'); port = (app.getHttpServer().address() as AddressInfo).port;
  });
  beforeEach(() => {
    page.mockReset().mockResolvedValue({ contract: 'publication-visual-reference-page-v1', approvalState: 'reference_only', items: [] });
    detail.mockReset().mockResolvedValue({ contract: 'publication-visual-reference-detail-v1', approvalState: 'reference_only', promptText: 'PRIVATE ORIGINAL', reader: null });
    materialize.mockReset(); retry.mockReset(); reset.mockReset();
  });
  afterAll(async () => { await app?.close(); });

  function call(index: string | null = null, query: Record<string, string> = hashes,
    authorization: string | null = token, work: string = workId, manuscript: string = manuscriptId, method = 'GET') {
    return new Promise<{ status: number; cache: string | undefined; body: any }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, method,
        path: `/api/v1/me/creator-studio/stories/${work}/linear-draft/${manuscript}/visual-references` +
          (index === null ? '' : `/${index}`) + `?${new URLSearchParams(query)}`,
        headers: authorization ? { authorization: `Bearer ${authorization}` } : {} }, res => {
        const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode!, cache: res.headers['cache-control'],
          body: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      req.setTimeout(10000, () => req.destroy(new Error('Local HTTP timeout')));
      req.on('error', reject); req.end();
    });
  }

  it('requires authentication on metadata and raw text before either service is called', async () => {
    expect((await call(null, hashes, null)).status).toBe(401);
    expect((await call('0', hashes, 'invalid')).status).toBe(401);
    expect(page).not.toHaveBeenCalled(); expect(detail).not.toHaveBeenCalled();
  });

  it('reads only as the JWT actor, parses numeric offsets, and disables caching', async () => {
    const first = await call();
    expect(first.status).toBe(200); expect(first.cache).toBe('private, no-store');
    expect(page).toHaveBeenCalledWith(owner, workId, manuscriptId, { ...hashes, offset: 0 });
    await call(null, { ...hashes, offset: '8' });
    expect(page).toHaveBeenLastCalledWith(owner, workId, manuscriptId, { ...hashes, offset: 8 });
    const text = await call('3', { ...hashes, textOffset: '6000' });
    expect(text.status).toBe(200); expect(text.cache).toBe('private, no-store');
    expect(detail).toHaveBeenCalledWith(owner, workId, manuscriptId, 3, { ...hashes, textOffset: 6000 });
    expect(materialize).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled(); expect(reset).not.toHaveBeenCalled();
  });

  it.each(['offset', 'textOffset'])('rejects missing source checks, caller identities and invalid %s before service reads', async field => {
    const index = field === 'offset' ? null : '0';
    const cases: Array<Record<string, string>> = [{}, { expectedManuscriptHash: hashes.expectedManuscriptHash },
      { ...hashes, expectedSourceChecksum: 'bad' }, { ...hashes, actorUserId: owner },
      { ...hashes, apiKey: 'synthetic' }, { ...hashes, [field]: '-1' }, { ...hashes, [field]: '1.5' },
      { ...hashes, [field]: 'NaN' }, { ...hashes, [field]: '9007199254740992' }];
    for (const query of cases) {
      expect((await call(index, query)).status).toBe(400);
    }
    expect(page).not.toHaveBeenCalled(); expect(detail).not.toHaveBeenCalled();
  });

  it('rejects wrong UUIDs, noninteger reference IDs, cross-endpoint offsets and write methods', async () => {
    expect((await call(null, hashes, token, 'invalid')).status).toBe(400);
    expect((await call('0', hashes, token, workId, 'invalid')).status).toBe(400);
    expect((await call('bad')).status).toBe(400);
    expect((await call('0.5')).status).toBe(400);
    expect((await call(null, { ...hashes, textOffset: '0' })).status).toBe(400);
    expect((await call('0', { ...hashes, offset: '0' })).status).toBe(400);
    expect((await call(null, hashes, token, workId, manuscriptId, 'POST')).status).toBe(404);
    expect(page).not.toHaveBeenCalled(); expect(detail).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled(); expect(reset).not.toHaveBeenCalled();
  });
});
