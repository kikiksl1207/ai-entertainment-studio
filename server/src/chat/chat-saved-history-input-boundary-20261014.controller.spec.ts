import 'reflect-metadata';
import {
  BadRequestException, ExecutionContext, INestApplication, ParseUUIDPipe,
  UnauthorizedException, ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { request } from 'node:http';
import { AddressInfo } from 'node:net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { createValidationException } from '../common/validation-exception.factory';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { storyChatHistoryPrivacyMiddleware } from './story-chat-history.privacy';

const OWNER = '00000000-0000-4000-8000-000000001411';
const SESSION = 'abcdefab-cdef-4000-8000-000000001414';
const PROGRESS = 'feedbeef-cafe-4000-8000-000000001415';
const ROOT = '/api/v1/chat/sessions';
// Installed ParseUUIDPipe's unspecified version accepts every hex version/variant field.
const VERSION_IDS = [...'0123456789abcdef'].map(version => `abcdefab-cdef-${version}000-8000-000000001414`);
const saved = [{ id: '00000000-0000-4000-8000-000000001416', senderType: 'user',
  messageType: 'text', body: 'Synthetic saved HTTP response', createdAt: '2026-10-13T00:00:00.000Z' }];
const blocked = () => jest.fn(() => { throw new Error('History input tests must not dispatch other effects'); });
const effects = {
  createSession: blocked(), createMessage: blocked(), generateMessage: blocked(), preflightMessage: blocked(),
  getSessions: blocked(), getConversationList: blocked(), archiveConversation: blocked(), restoreConversation: blocked(),
};
const getMessages = jest.fn(async (_owner: string, _session: string, _progress?: unknown) => saved);
const chat = { ...effects, getMessages };
const authenticate = jest.fn((context: ExecutionContext) => {
  const req = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined>; user?: { id: string } }>();
  if (req.headers['x-qa-auth'] !== 'synthetic-allowed') throw new UnauthorizedException('Synthetic history auth denied');
  req.user = { id: OWNER };
  return true;
});
type Method = 'GET' | 'HEAD' | 'PUT';
type Reply = { status: number; cacheControl: string | undefined; text: string; body: unknown };

describe('saved history controller input boundary (synthetic Nest HTTP 20261014)', () => {
  let app: INestApplication | undefined;
  let port: number;
  let uuidTransform: jest.SpyInstance;

  beforeAll(async () => {
    // Observe the real installed pipe, but never install a pipe or alter controller metadata in this fixture.
    uuidTransform = jest.spyOn(ParseUUIDPipe.prototype, 'transform');
    const module = await Test.createTestingModule({ controllers: [ChatController],
      providers: [{ provide: ChatService, useValue: chat }],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: authenticate }).compile();
    app = module.createNestApplication({ logger: false });
    app.use(storyChatHistoryPrivacyMiddleware);
    configureHttpRouting(app);
    // Mirror main.ts's existing global primitive transformation, not a new query-validation policy.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true,
      forbidUnknownValues: true, transform: true, exceptionFactory: createValidationException }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });
  beforeEach(() => {
    getMessages.mockReset().mockResolvedValue(saved);
    authenticate.mockClear(); uuidTransform.mockClear();
    for (const effect of Object.values(effects)) effect.mockClear();
  });
  afterEach(() => {
    for (const effect of Object.values(effects)) expect(effect).not.toHaveBeenCalled();
    for (const [, metadata] of uuidTransform.mock.calls) {
      expect(metadata).toMatchObject({ type: 'param', data: 'sessionId', metatype: String });
    }
  });
  afterAll(async () => {
    try { await app?.close(); }
    finally { jest.restoreAllMocks(); }
  });

  function call(method: Method, path: string, allowed = true) {
    // A raw request keeps malformed encodings and double slashes intact for Express routing.
    return new Promise<Reply>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, method, path, agent: false,
        headers: allowed ? { 'x-qa-auth': 'synthetic-allowed' } : {},
      }, res => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try { resolve({ status: res.statusCode!, cacheControl: res.headers['cache-control'],
            text, body: text ? JSON.parse(text) : undefined }); }
          catch (error) { reject(error); }
        });
      });
      req.setTimeout(5000, () => req.destroy(new Error('Synthetic history loopback request timed out')));
      req.on('error', reject); req.end();
    });
  }
  function history(id: string, query = '') { return `${ROOT}/${id}/messages${query}`; }
  function status(reply: Reply, expected: number, method: Method, privateResponse = true) {
    expect(reply.status).toBe(expected);
    expect(reply.cacheControl).toBe(privateResponse ? 'private, no-store' : undefined);
    if (method === 'HEAD') expect(reply.text).toBe('');
    else if (expected >= 400) expect(reply.body).toMatchObject({ success: false, error: {
      statusCode: expected, code: ({ 400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 404: 'NOT_FOUND' } as Record<number, string>)[expected],
    } });
  }
  function paramPassed(value: string) {
    expect(uuidTransform).toHaveBeenLastCalledWith(value,
      expect.objectContaining({ type: 'param', data: 'sessionId', metatype: String }));
  }

  it('GET preserves every locally supported canonical UUID version field through the actual parameter pipe', async () => {
    for (const id of VERSION_IDS) {
      const reply = await call('GET', history(id)); status(reply, 200, 'GET');
      expect(reply.body).toEqual(saved); paramPassed(id);
    }
    expect(getMessages.mock.calls).toEqual(VERSION_IDS.map(id => [OWNER, id, undefined]));
    expect(uuidTransform).toHaveBeenCalledTimes(VERSION_IDS.length);
  });

  it('HEAD uses the same broad GET pipe and passes nil max uppercase and unrestricted variant forms unchanged', async () => {
    const ids = [...VERSION_IDS, '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff', 'ABCDEFAB-CDEF-1234-CDEF-ABCDEFABCDEF'];
    for (const id of ids) {
      status(await call('HEAD', history(id)), 200, 'HEAD'); paramPassed(id);
    }
    expect(getMessages.mock.calls).toEqual(ids.map(id => [OWNER, id, undefined]));
    expect(uuidTransform).toHaveBeenCalledTimes(ids.length);
  });

  it('passes once-decoded valid IDs and optional trailing slashes without lowercase or other normalization', async () => {
    const variants = [
      [`%61${SESSION.slice(1)}`, SESSION, ''],
      [`%41${SESSION.toUpperCase().slice(1)}`, SESSION.toUpperCase(), ''],
      [SESSION, SESSION, '/'],
    ];
    for (const [wireId, decodedId, trailing] of variants) for (const method of ['GET', 'HEAD'] as const) {
      status(await call(method, history(wireId) + trailing), 200, method); paramPassed(decodedId);
      expect(getMessages).toHaveBeenLastCalledWith(OWNER, decodedId, undefined);
    }
    expect(getMessages).toHaveBeenCalledTimes(6);
  });

  it('rejects lexical invalid session IDs with 400 before any service call on GET and HEAD', async () => {
    const invalid = ['not-a-uuid', SESSION.slice(1), SESSION + '0', SESSION.replace('a', 'g'),
      SESSION.replace(/-/g, ''), `%20${SESSION}`, `${SESSION}%20`];
    for (const id of invalid) for (const method of ['GET', 'HEAD'] as const) {
      const reply = await call(method, history(id)); status(reply, 400, method);
      if (method === 'GET') expect(reply.body).toMatchObject({ error: { message: 'Validation failed (uuid is expected)' } });
      paramPassed(decodeURIComponent(id));
    }
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('rejects encoded slash query fragment control and double-encoded junk inside the session segment', async () => {
    for (const id of ['%2F', '%3F', '%23', '%00', '%20', `%2561${SESSION.slice(1)}`]) {
      for (const method of ['GET', 'HEAD'] as const) {
        status(await call(method, history(id)), 400, method); paramPassed(decodeURIComponent(id));
      }
    }
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('rejects array-shaped or comma-separated path strings rather than dispatching an array of session IDs', async () => {
    for (const value of ['[]', JSON.stringify([SESSION]), `${SESSION},${SESSION}`]) {
      for (const method of ['GET', 'HEAD'] as const) {
        status(await call(method, history(encodeURIComponent(value))), 400, method); paramPassed(value);
      }
    }
    expect(getMessages).not.toHaveBeenCalled();
    expect(uuidTransform.mock.calls.every(([value]) => typeof value === 'string')).toBe(true);
  });

  it('denies synthetic authentication before UUID validation for matched valid or invalid history routes', async () => {
    for (const id of [SESSION, 'not-a-uuid', '%2F']) for (const method of ['GET', 'HEAD'] as const) {
      const reply = await call(method, history(id), false); status(reply, 401, method);
      if (method === 'GET') expect(reply.body).toMatchObject({ error: { message: 'Synthetic history auth denied' } });
    }
    expect(authenticate).toHaveBeenCalledTimes(6);
    expect(uuidTransform).not.toHaveBeenCalled(); expect(getMessages).not.toHaveBeenCalled();
  });

  it('maps actual Express malformed-percentage decoding to private 400 before controller guards or pipes', async () => {
    for (const id of ['%ZZ', '%FF', '%E0%A4%A']) for (const method of ['GET', 'HEAD'] as const) {
      status(await call(method, history(id), false), 400, method);
    }
    expect(authenticate).not.toHaveBeenCalled(); expect(uuidTransform).not.toHaveBeenCalled();
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('keeps dangling missing child wrong-prefix greeting generate and wrong-method routes as actual 404s', async () => {
    const routes: Array<[Method, string, boolean]> = [
      ['GET', `${ROOT}/${SESSION}`, false], ['HEAD', `${ROOT}//messages`, false],
      ['GET', history(SESSION) + '/child', true],
      ['GET', `/api/chat/sessions/${SESSION}/messages`, true],
      ['GET', `/chat/sessions/${SESSION}/messages`, false],
      ['GET', `${ROOT}/${SESSION}/greeting`, false], ['GET', `${ROOT}/${SESSION}/generate`, false],
      ['PUT', history(SESSION), false],
    ];
    for (const [method, path, privateResponse] of routes) status(await call(method, path), 404, method, privateResponse);
    expect(authenticate).not.toHaveBeenCalled(); expect(uuidTransform).not.toHaveBeenCalled();
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('forwards existing storyProgressId spelling exactly on valid GET and HEAD without a new story pipe', async () => {
    for (const progress of [PROGRESS, PROGRESS.toUpperCase()]) for (const method of ['GET', 'HEAD'] as const) {
      status(await call(method, history(SESSION, '?storyProgressId=' + encodeURIComponent(progress))), 200, method);
      expect(getMessages).toHaveBeenLastCalledWith(OWNER, SESSION, progress); paramPassed(SESSION);
    }
    expect(getMessages).toHaveBeenCalledTimes(4);
    expect(uuidTransform).toHaveBeenCalledTimes(4);
  });

  it('preserves existing global story-query transformation and service 400 without dropping intent or fallback', async () => {
    const queries = [
      ['?storyProgressId=', ''], ['?storyProgressId=not-a-uuid', 'not-a-uuid'],
      [`?storyProgressId=${PROGRESS}&storyProgressId=other`, `${PROGRESS},other`],
      ['?storyProgressId%5B%5D=junk', 'junk'],
    ];
    for (const [query, expected] of queries) for (const method of ['GET', 'HEAD'] as const) {
      const before = getMessages.mock.calls.length;
      // Relay the existing service's exception; this inert fixture does not implement story validation.
      getMessages.mockRejectedValueOnce(new BadRequestException('storyProgressId must be a UUID v4'));
      const reply = await call(method, history(SESSION, query)); status(reply, 400, method);
      expect(getMessages.mock.calls.slice(before)).toEqual([[OWNER, SESSION, expected]]); paramPassed(SESSION);
      if (method === 'GET') expect(reply.body).toMatchObject({ error: { message: 'storyProgressId must be a UUID v4' } });
    }
  });

  it('never substitutes a duplicate query sessionId for the actual valid or invalid path parameter', async () => {
    const duplicate = `?sessionId=not-a-uuid&sessionId=${SESSION}`;
    for (const method of ['GET', 'HEAD'] as const) {
      status(await call(method, history(SESSION, duplicate)), 200, method);
      expect(getMessages).toHaveBeenLastCalledWith(OWNER, SESSION, undefined); paramPassed(SESSION);
      const before = getMessages.mock.calls.length;
      status(await call(method, history('not-a-uuid', '?sessionId=' + SESSION)), 400, method);
      expect(getMessages).toHaveBeenCalledTimes(before); paramPassed('not-a-uuid');
    }
    expect(getMessages).toHaveBeenCalledTimes(2);
  });
});
