import 'reflect-metadata';
import { CanActivate, ExecutionContext, INestApplication, Injectable, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { chatBoostsPrivacyMiddleware } from '../common/chat-boosts-privacy';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { createValidationException } from '../common/validation-exception.factory';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

jest.setTimeout(60000);

const OWNER = '00000000-0000-4000-8000-000000001301';
const ARTIST = '0000000a-0000-4000-8000-000000001302';
const PATH = '/api/v1/chat/usage-summary';
const shapeQueries: unknown[] = [];
const read = jest.fn(async (_owner: string, _input: { artistId: string }) => ({ syntheticOnly: true }));

@Injectable()
class SyntheticGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (request.headers['x-qa-auth'] !== 'allowed') throw new UnauthorizedException('Synthetic rejection');
    request.user = { id: OWNER }; return true;
  }
}

describe('artist query shape with production global primitive transformation', () => {
  let app: INestApplication, base: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [ChatController],
      providers: [{ provide: ChatService, useValue: { getUsageSummary: read } }],
    }).overrideGuard(JwtAuthGuard).useClass(SyntheticGuard).compile();
    app = module.createNestApplication({ logger: false });
    app.use((request: { query: { artistId?: unknown } }, _response: unknown, next: () => void) => {
      shapeQueries.push(request.query.artistId); next();
    });
    app.use(chatBoostsPrivacyMiddleware); configureHttpRouting(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true,
      forbidUnknownValues: true, transform: true, exceptionFactory: createValidationException }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1'); base = 'http://127.0.0.1:' + app.getHttpServer().address().port;
  });
  beforeEach(() => { read.mockClear(); shapeQueries.length = 0; });
  afterAll(async () => { await app?.close(); });
  async function call(query: URLSearchParams, method = 'GET', authenticated = true) {
    const response = await fetch(base + PATH + '?' + query, { method, redirect: 'error',
      headers: authenticated ? { 'x-qa-auth': 'allowed' } : {}, signal: AbortSignal.timeout(15000) });
    const body = await response.text();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')?.toLowerCase()).toContain('authorization');
    expect(response.headers.get('set-cookie')).toBeNull();
    if (method === 'HEAD') expect(body).toBe('');
    return { status: response.status, body };
  }

  it('raw one-item bracket arrays are rejected before scalar coercion and service dispatch', async () => {
    for (const key of ['artistId[]', 'artistId[0]']) for (const method of ['GET', 'HEAD']) {
      const result = await call(new URLSearchParams({ [key]: ARTIST }), method);
      expect(shapeQueries.at(-1)).toEqual([ARTIST]);
      expect(result.status).toBe(400); expect(read).not.toHaveBeenCalled();
    }
  });

  it('raw canonical scalar arguments remain unchanged through the production global pipe', async () => {
    for (const id of [ARTIST, ARTIST.toUpperCase(), '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff']) for (const method of ['GET', 'HEAD']) {
      const result = await call(new URLSearchParams({ artistId: id }), method);
      expect(result.status).toBe(200); expect(shapeQueries.at(-1)).toBe(id);
      expect(read.mock.calls.at(-1)).toEqual([OWNER, { artistId: id }]);
    }
    expect(read).toHaveBeenCalledTimes(8);
  });

  it('repeated arrays and nested objects remain private rejected inputs under the production pipe', async () => {
    const duplicate = new URLSearchParams(); duplicate.append('artistId', ARTIST); duplicate.append('artistId', ARTIST);
    for (const query of [duplicate, new URLSearchParams({ 'artistId[inside]': ARTIST })]) {
      const result = await call(query); expect(result.status).toBe(400);
      expect(typeof shapeQueries.at(-1)).toBe('object'); expect(read).not.toHaveBeenCalled();
    }
  });

  it('missing-field and authentication denials retain their original ordering and no dispatch', async () => {
    const missing = await call(new URLSearchParams()); expect(missing.status).toBe(400);
    expect(JSON.parse(missing.body).error.message).toBe('artistId is required');
    const empty = await call(new URLSearchParams({ artistId: '' })); expect(empty.status).toBe(400);
    const rejected = await call(new URLSearchParams({ 'artistId[]': ARTIST }), 'GET', false);
    expect(rejected.status).toBe(401); expect(read).not.toHaveBeenCalled();
  });
});
