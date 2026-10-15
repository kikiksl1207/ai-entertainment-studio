import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { request as send } from 'node:http';
import { BadRequestException, CanActivate, Controller, ExecutionContext, Get, HttpException,
  Injectable, INestApplication, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { communitySearchReadPrivacyMiddleware } from './community-search-read.privacy';
import { communityPersonalizedReadPrivacyMiddleware } from './community-personalized-read.privacy';

jest.setTimeout(20000);
type Request = { headers: { authorization?: string }; query: Record<string, string>; user?: { id: string } };
let guards = 0, handlers = 0;
const projected: Array<string | null> = [];

@Injectable()
class SyntheticOptionalGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    guards++;
    const request = context.switchToHttp().getRequest<Request>();
    if (request.query.mode === 'quota') throw new HttpException('Synthetic quota', 429);
    if (request.query.mode === 'guard500') throw new Error('Synthetic guard failure');
    const value = request.headers.authorization;
    if (value === undefined) return true;
    if (value !== 'synthetic-a' && value !== 'synthetic-b') throw new UnauthorizedException();
    request.user = { id: value === 'synthetic-a' ? 'synthetic-reader-a' : 'synthetic-reader-b' };
    return true;
  }
}

@Controller('lumina-feed')
class SyntheticSearchController {
  @Get('search')
  @UseGuards(SyntheticOptionalGuard)
  search(@Req() request: Request, @Query() query: Record<string, string>) {
    handlers++;
    if (query.mode === 'handler500') throw new Error('Synthetic handler failure');
    if (query.mode === 'bad400') throw new BadRequestException();
    const viewer = request.user?.id ?? null;
    projected.push(viewer);
    return { items: [{ syntheticOnly: true, viewer: { userId: viewer, hasLiked: viewer === 'synthetic-reader-a' } }] };
  }

  @Get('search-suggestions')
  publicControl() { return { syntheticOnly: true }; }
}

test('FEED.SEARCH.CACHE.03 actual Nest HTTP keeps exact variants private before synthetic auth and failures', async () => {
  assert.equal(process.env.FEED_SEARCH_CACHE_PHASE ?? 'current', 'current');
  let app: INestApplication | undefined, requests = 0;
  guards = 0; handlers = 0; projected.length = 0;
  const query = '/api/v1/lumina-feed/search?q=synthetic';
  try {
    const module = await Test.createTestingModule({ controllers: [SyntheticSearchController],
      providers: [SyntheticOptionalGuard] }).compile();
    app = module.createNestApplication({ logger: false });
    app.use((_request: unknown, response: { setHeader(name: string, value: string): void; vary(field: string): void }, next: () => void) => {
      response.setHeader('Cache-Control', 'public, max-age=60');
      response.vary('Origin'); response.vary('Accept-Encoding'); next();
    });
    app.use(communityPersonalizedReadPrivacyMiddleware);
    app.use(communitySearchReadPrivacyMiddleware);
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    const port = app.getHttpServer().address().port as number;
    async function read(method: string, path: string, authorization?: string) {
      requests++;
      return new Promise<{ status: number; cache: string | undefined; vary: string; body: string }>((resolve, reject) => {
        const req = send({ host: '127.0.0.1', port, method, path, agent: false,
          headers: { Connection: 'close', ...(authorization === undefined ? {} : { Authorization: authorization }) } }, res => {
          let bytes = 0; const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 16384) req.destroy(new Error('SYNTHETIC_HTTP_BODY_LIMIT'));
            else chunks.push(chunk);
          });
          res.on('error', reject);
          res.on('end', () => resolve({ status: res.statusCode ?? 0,
            cache: res.headers['cache-control'], vary: String(res.headers.vary ?? ''), body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.setTimeout(2000, () => req.destroy(new Error('SYNTHETIC_HTTP_TIMEOUT')));
        req.on('error', reject); req.end();
      });
    }
    const rows: Array<[string, string, string | undefined, number, boolean]> = [
      ['GET', query, undefined, 200, true],
      ['GET', query, 'synthetic-a', 200, true],
      ['GET', query, 'synthetic-b', 200, true],
      ['HEAD', query, 'synthetic-a', 200, true],
      ['GET', query, '', 401, true],
      ['GET', query, 'malformed-synthetic', 401, true],
      ['GET', query + '&mode=handler500', 'synthetic-a', 500, true],
      ['HEAD', query + '&mode=handler500', 'synthetic-a', 500, true],
      ['GET', query + '&mode=quota', 'synthetic-a', 429, true],
      ['GET', query + '&mode=guard500', 'synthetic-a', 500, true],
      ['GET', '/api/v1/lumina-feed/search/?q=synthetic', 'synthetic-a', 200, true],
      ['GET', '/api/v1/lumina-feed/search-suggestions', 'synthetic-a', 200, false],
      ['POST', query, 'synthetic-a', 404, false],
      ['GET', '/api/v1/lumina-feed/searching', 'synthetic-a', 404, false],
      ['GET', query + '&mode=bad400', 'synthetic-a', 400, true],
    ];
    const firstThree: Array<string | null> = [];
    for (const [method, path, authorization, status, protectedRoute] of rows) {
      const result = await read(method, path, authorization);
      assert.equal(result.status, status);
      assert.equal(result.cache, protectedRoute && authorization !== undefined ? 'private, no-store' : 'public, max-age=60');
      const varying = result.vary.split(',').map(value => value.trim().toLowerCase()).sort();
      assert.deepEqual(varying, protectedRoute ? ['accept-encoding', 'authorization', 'origin'] : ['accept-encoding', 'origin']);
      if (method === 'HEAD') assert.equal(result.body, '');
      if (firstThree.length < 3) {
        const body = JSON.parse(result.body) as { items: Array<{ viewer: { userId: string | null; hasLiked: boolean } }> };
        firstThree.push(body.items[0].viewer.userId);
        assert.equal(body.items[0].viewer.hasLiked, authorization === 'synthetic-a');
      }
    }
    assert.deepEqual(firstThree, [null, 'synthetic-reader-a', 'synthetic-reader-b']);
    assert.equal(rows.length, 15); assert.equal(requests, 15);
    assert.equal(guards, 12); assert.equal(handlers, 8);
    assert.deepEqual(projected, [null, 'synthetic-reader-a', 'synthetic-reader-b', 'synthetic-reader-a', 'synthetic-reader-a']);
  } finally {
    await app?.close();
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));
  }
});
