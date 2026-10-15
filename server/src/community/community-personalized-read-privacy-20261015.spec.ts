import { communityPersonalizedReadPrivacyMiddleware as middleware } from './community-personalized-read.privacy';

const routes = ['/api/v1/me/lumina-feed', '/api/v1/me/lumina-feed/likes', '/api/v1/me/hidden-posts'];
const parseUrl = require('parseurl') as (request: { url: string }) => { pathname: string };

function probe() {
  const headers = new Map([['Cache-Control', 'public, max-age=60']]);
  const vary = new Set(['Origin', 'Accept-Encoding']);
  const response = {
    setHeader: jest.fn((name: string, value: string) => headers.set(name, value)),
    vary: jest.fn((field: string) => vary.add(field)),
  };
  return { headers, vary, response };
}

describe('community personalized read privacy middleware', () => {
  it('01 protects exactly the three GET/HEAD path families before next and merges Vary without reading credentials', () => {
    for (const route of routes) for (const method of ['GET', 'HEAD']) {
      for (const spelling of [route, route + '/', route.toUpperCase()]) {
        const path = parseUrl({ url: spelling + '?synthetic=1' }).pathname;
        const request = Object.freeze({ method, path,
          get headers(): never { throw new Error('Unexpected credential read'); },
          get body(): never { throw new Error('Unexpected body read'); },
          get url(): never { throw new Error('Unexpected raw URL read'); },
        });
        const p = probe();
        const next = jest.fn(() => {
          expect(p.headers.get('Cache-Control')).toBe('private, no-store');
          expect([...p.vary]).toEqual(['Origin', 'Accept-Encoding', 'Authorization']);
        });
        middleware(request, p.response, next);
        expect(p.response.setHeader.mock.calls).toEqual([['Cache-Control', 'private, no-store']]);
        expect(p.response.vary.mock.calls).toEqual([['Authorization']]);
        expect(next).toHaveBeenCalledTimes(1);
      }
    }
    const failure = new Error('Synthetic downstream failure'), p = probe();
    const next = jest.fn(() => {
      expect(p.headers.get('Cache-Control')).toBe('private, no-store');
      throw failure;
    });
    expect(() => middleware({ method: 'GET', path: routes[0] }, p.response, next)).toThrow(failure);
    expect(next).toHaveBeenCalledTimes(1);
    const blockedNext = jest.fn(), setHeader = jest.fn();
    expect(() => middleware({ method: 'HEAD', path: routes[2] }, { setHeader }, blockedNext))
      .toThrow('Personalized feed read response requires Vary support');
    const mergeFailure = new Error('Synthetic Vary merge failure');
    expect(() => middleware({ method: 'GET', path: routes[1] },
      { setHeader, vary() { throw mergeFailure; } }, blockedNext)).toThrow(mergeFailure);
    expect(blockedNext).not.toHaveBeenCalled();
  });

  it('02 leaves neighboring routes, public search, writes, unavailable paths and malformed path spellings untouched', () => {
    const pairs: Array<[string | undefined, string]> = [];
    for (const route of routes) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'get', 'head', undefined]) pairs.push([method, route]);
      for (const suffix of ['-extra', '//', '/child', '?raw=1', '#fragment', '\n', '\u0000', '/%E0%A4%A']) {
        pairs.push(['GET', route + suffix]);
      }
    }
    for (const path of ['/health', '/api/v1/lumina-feed', '/api/v1/lumina-feed/search',
      '/api/v1/me/blocked-users-extra', '/api/me/lumina-feed', '/api/v2/me/hidden-posts',
      '/api/v1/me/%6cumina-feed', '/prefix/api/v1/me/hidden-posts']) pairs.push(['GET', path]);
    const requests = pairs.map(([method, path]) => ({ method, path }));
    requests.push({ method: 'GET', path: undefined as unknown as string });
    requests.push({ method: 'GET', get path(): string { throw new Error('Synthetic path getter failure'); } });
    requests.push({ get method(): string { throw new Error('Synthetic method getter failure'); }, path: routes[0] });
    for (const request of requests) {
      const p = probe(), next = jest.fn();
      middleware(request, p.response, next);
      expect(p.headers.get('Cache-Control')).toBe('public, max-age=60');
      expect([...p.vary]).toEqual(['Origin', 'Accept-Encoding']);
      expect(p.response.setHeader).not.toHaveBeenCalled();
      expect(p.response.vary).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    }
    const next = jest.fn(), setHeader = jest.fn();
    middleware({ method: 'GET', path: '/health' }, { setHeader }, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(setHeader).not.toHaveBeenCalled();
  });
});
