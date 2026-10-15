import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { communitySearchReadPrivacyMiddleware as current } from './community-search-read.privacy';
import { communityPersonalizedReadPrivacyMiddleware as original } from './community-personalized-read.privacy';

const phase = process.env.FEED_SEARCH_CACHE_PHASE ?? 'current';
assert(phase === 'baseline' || phase === 'current', 'Unknown QA phase denied');
const subject: typeof current = phase === 'baseline' ? original : current;
const first = 'FEED.SEARCH.CACHE.01 actual authenticated representation overrides storage and anonymous retains policy';
type Request = Parameters<typeof current>[0];
type Response = Parameters<typeof current>[1];
const mergeVary = require('vary') as (response: unknown, field: string) => void;

function response(initial?: string, prior = 'Origin, Accept-Encoding') {
  if (arguments.length === 0) initial = 'public, max-age=60';
  const headers = new Map<string, unknown>([['vary', prior]]);
  if (initial !== undefined) headers.set('cache-control', initial);
  let next = 0, variations = 0;
  const res = {
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    setHeader: (name: string, value: string) => { headers.set(name.toLowerCase(), value); },
    vary: (field: string) => { variations++; mergeVary(res, field); },
  };
  return { res, headers, proceed: () => { next++; }, next: () => next, variations: () => variations };
}

function tokens(value: unknown) {
  assert.equal(typeof value, 'string');
  return (value as string).split(',').map(part => part.trim().toLowerCase());
}

test(first, () => {
  const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
  const imported = "import { communitySearchReadPrivacyMiddleware } from './community/community-search-read.privacy';\n";
  const installed = '  app.use(communitySearchReadPrivacyMiddleware);\n';
  assert.equal(main.split(imported).length, 2);
  assert.equal(main.split(installed).length, 2);
  assert(main.indexOf(installed) > main.indexOf('app.use(communityPersonalizedReadPrivacyMiddleware)'));
  assert(main.indexOf(installed) < main.indexOf('configureHttpRouting(app)'));
  assert.equal(typeof subject, 'function');

  const firstResponse = response();
  subject({ method: 'GET', path: '/api/v1/lumina-feed/search', headers: { authorization: 'synthetic-a' } },
    firstResponse.res, firstResponse.proceed);
  assert.equal(firstResponse.next(), 1, 'Actual middleware completed before the missing-header oracle');
  assert.equal(firstResponse.headers.get('cache-control'), 'private, no-store',
    'FEED_SEARCH_CACHE_AUTH_RESPONSE_NOT_PRIVATE');

  const present: unknown[] = ['', 'malformed-synthetic', 'synthetic-a', 'synthetic-b', null,
    [], ['synthetic-a'], ['synthetic-a', 'synthetic-b'], 0, false, {}];
  let coerced = 0;
  present.push({ toString() { coerced++; throw new Error('Do not coerce synthetic metadata'); } });
  for (const method of ['GET', 'HEAD']) {
    for (const path of ['/api/v1/lumina-feed/search', '/api/v1/lumina-feed/search/', '/API/V1/LUMINA-FEED/SEARCH']) {
      for (const authorization of present) {
        for (const initial of ['public, max-age=60', undefined]) {
          const r = response(initial);
          subject({ method, path, headers: { authorization } }, r.res, r.proceed);
          assert.equal(r.headers.get('cache-control'), 'private, no-store');
          assert.deepEqual(tokens(r.headers.get('vary')).sort(), ['accept-encoding', 'authorization', 'origin']);
          assert.equal(r.variations(), 1); assert.equal(r.next(), 1);
        }
      }
      for (const request of [{ method, path }, { method, path, headers: {} },
        { method, path, headers: { authorization: undefined } }]) {
        for (const initial of ['public, max-age=60', undefined]) {
          const r = response(initial);
          subject(request, r.res, r.proceed);
          assert.equal(r.headers.get('cache-control'), initial);
          assert.deepEqual(tokens(r.headers.get('vary')).sort(), ['accept-encoding', 'authorization', 'origin']);
          assert.equal(r.next(), 1);
        }
      }
    }
  }
  const prior = response(undefined, 'Origin, AUTHORIZATION, Accept-Encoding');
  subject({ method: 'GET', path: '/api/v1/lumina-feed/search' }, prior.res, prior.proceed);
  assert.equal(tokens(prior.headers.get('vary')).filter(value => value === 'authorization').length, 1);
  for (const authorization of [undefined, 'synthetic-a']) {
    let cookieReads = 0;
    const headers = { authorization };
    Object.defineProperty(headers, 'cookie', { get() { cookieReads++; throw new Error('Cookie is not a QA credential source'); } });
    const r = response();
    subject({ method: 'GET', path: '/api/v1/lumina-feed/search', headers }, r.res, r.proceed);
    assert.equal(cookieReads, 0);
    assert.equal(r.headers.get('cache-control'), authorization === undefined ? 'public, max-age=60' : 'private, no-store');
  }
  assert.equal(coerced, 0, 'Credential presence is not parsing, authentication or string conversion');
});

if (phase === 'current') test('FEED.SEARCH.CACHE.02 exact scope and unreadable metadata fail conservatively without broad policy', () => {
  const paths: unknown[] = ['/api/v1/lumina-feed', '/api/v1/lumina-feed/search-suggestions',
    '/api/v1/lumina-feed/trending-searches', '/api/v1/lumina-feed/hashtags',
    '/api/v1/lumina-feed/searching', '/api/v1/lumina-feed/search/child', '/api/v1/lumina-feed/search//',
    '/api/v1/lumina-feed//search', '/api/v1/lumina-feed/%73earch', '/api/v1/lumina-feed/search%2f',
    '/api/v1/lumina-feed/search?q=synthetic', '/api/v1/lumina-feed/search#synthetic',
    '/api/v1/lumina-feed/search,/api/v1/lumina-feed/search', ' /api/v1/lumina-feed/search',
    '/api/v1/lumina-feed/search\n', '/api/v1/lumina-feed/search\u007f', '', undefined, null, 7];
  const requests: unknown[] = paths.map(path => ({ method: 'GET', path }));
  requests.push(...['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'get', 'head', undefined]
    .map(method => ({ method, path: '/api/v1/lumina-feed/search' })));
  for (const input of requests) {
    let read = 0;
    Object.defineProperty(input, 'headers', { get() { read++; throw new Error('Unmatched path must not read headers'); } });
    const r = response();
    subject(input as Request, r.res, r.proceed);
    assert.equal(r.headers.get('cache-control'), 'public, max-age=60');
    assert.equal(r.headers.get('vary'), 'Origin, Accept-Encoding');
    assert.equal(r.variations(), 0); assert.equal(r.next(), 1); assert.equal(read, 0);
  }
  for (const name of ['path', 'method']) {
    const request = { path: '/api/v1/lumina-feed/search', method: 'GET' };
    Object.defineProperty(request, name, { get() { throw new Error('Synthetic route getter failure'); } });
    const r = response(); subject(request, r.res, r.proceed);
    assert.equal(r.next(), 1); assert.equal(r.variations(), 0);
    assert.equal(r.headers.get('cache-control'), 'public, max-age=60');
  }
  for (const location of ['headers', 'authorization']) {
    let reads = 0;
    const request: Request = { method: 'GET', path: '/api/v1/lumina-feed/search', headers: {} };
    Object.defineProperty(location === 'headers' ? request : request.headers!, location, {
      get() { reads++; throw new Error('Synthetic credential metadata failure'); },
    });
    const r = response(); subject(request, r.res, r.proceed);
    assert.equal(reads, 1); assert.equal(r.next(), 1);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    assert(tokens(r.headers.get('vary')).includes('authorization'));
  }
  for (const authorization of [undefined, 'synthetic-a']) {
    const r = response();
    const missing: Response = { setHeader: r.res.setHeader };
    assert.throws(() => subject({ method: 'GET', path: '/api/v1/lumina-feed/search', headers: { authorization } },
      missing, r.proceed), /requires Vary support/);
    assert.equal(r.next(), 0);
    assert.equal(r.headers.get('cache-control'), authorization === undefined ? 'public, max-age=60' : 'private, no-store');
  }
  const r = response();
  assert.throws(() => subject({ method: 'GET', path: '/api/v1/lumina-feed/search', headers: { authorization: '' } },
    { setHeader: r.res.setHeader, vary() { throw new Error('SYNTHETIC_VARY_FAILURE'); } }, r.proceed), /SYNTHETIC_VARY_FAILURE/);
  assert.equal(r.next(), 0); assert.equal(r.headers.get('cache-control'), 'private, no-store');
});
