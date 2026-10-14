import { contentRightsContractPrivacyMiddleware, isContentRightsContractPrivateRead } from './content-rights-contract.privacy';

const roots = ['/admin/api/v1/content-rights-contracts', '/api/v1/me/creator-studio/content-rights-contracts'];
const parseUrl = require('parseurl') as (request: { url: string }) => { pathname: string };
function probe() {
  const headers = new Map([['Cache-Control', 'public, max-age=60']]);
  const vary = new Set(['Origin', 'Accept-Encoding']);
  const response = { setHeader: jest.fn((name: string, value: string) => headers.set(name, value)),
    vary: jest.fn((field: string) => vary.add(field)) };
  return { headers, vary, response };
}

describe('content rights contract private-read boundary', () => {
  it('protects only the existing admin and party list/detail GET and HEAD routes', () => {
    for (const root of roots) for (const suffix of ['', '/synthetic-id'])
      for (const method of ['GET', 'HEAD']) for (const path of [root + suffix, root + suffix + '/', (root + suffix).toUpperCase()]) {
        const p = probe();
        const next = jest.fn(() => {
          expect(p.headers.get('Cache-Control')).toBe('private, no-store');
          expect([...p.vary]).toEqual(['Origin', 'Accept-Encoding', 'Authorization']);
        });
        expect(isContentRightsContractPrivateRead({ method, path })).toBe(true);
        contentRightsContractPrivacyMiddleware({ method, path }, p.response, next);
        expect(p.response.setHeader).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledTimes(1);
      }
  });
  it('uses Express pathname without reading credentials, body, or the raw query', () => {
    const path = parseUrl({ url: roots[1] + '?synthetic=1' }).pathname;
    const p = probe(), next = jest.fn();
    const request = { method: 'GET', path,
      get headers(): never { throw new Error('Unexpected credential read'); },
      get body(): never { throw new Error('Unexpected body read'); },
      get url(): never { throw new Error('Unexpected raw URL read'); } };
    contentRightsContractPrivacyMiddleware(request, p.response, next);
    expect(p.headers.get('Cache-Control')).toBe('private, no-store');
    expect(next).toHaveBeenCalledTimes(1);
  });
  it('protects invalid detail parameters before downstream validation without rewriting requests', () => {
    for (const root of roots) for (const id of ['not-a-uuid', '%2F', '%20', '%E0%A4%A']) {
      const request = { method: 'GET', path: root + '/' + id }, before = { ...request };
      const p = probe();
      contentRightsContractPrivacyMiddleware(request, p.response, jest.fn());
      expect(request).toEqual(before);
      expect(p.headers.get('Cache-Control')).toBe('private, no-store');
    }
  });
  it('preserves errors from downstream after setting private headers', () => {
    const p = probe(), failure = new Error('Synthetic downstream failure');
    const next = jest.fn(() => {
      expect(p.headers.get('Cache-Control')).toBe('private, no-store');
      throw failure;
    });
    expect(() => contentRightsContractPrivacyMiddleware({ method: 'HEAD', path: roots[0] }, p.response, next)).toThrow(failure);
    expect(next).toHaveBeenCalledTimes(1);
  });
  it('does not widen methods, writes, neighboring APIs, prefixes, or child paths', () => {
    const pairs: Array<[string | undefined, string]> = [
      ...['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'get', undefined].map(method => [method, roots[0]] as [string | undefined, string]),
      ['POST', roots[0] + '/synthetic-id/approve'], ['POST', roots[0] + '/synthetic-id/revisions'],
      ...[roots[0] + '-extra', roots[0] + '//', roots[0] + '/one/two', roots[0] + '?raw=1', roots[0] + '#fragment',
        roots[0] + '\n', roots[0].replace('content-rights', '%63ontent-rights'),
        '/api/v1/admin/api/v1/content-rights-contracts', '/api/v2/me/creator-studio/content-rights-contracts',
        '/api/v1/me/creator-studio/settlement-preview', '/api/v1/boost-products'].map(path => ['GET', path] as [string, string]),
    ];
    for (const [method, path] of pairs) {
      const p = probe(), next = jest.fn();
      contentRightsContractPrivacyMiddleware({ method, path }, p.response, next);
      expect(p.headers.get('Cache-Control')).toBe('public, max-age=60');
      expect([...p.vary]).toEqual(['Origin', 'Accept-Encoding']);
      expect(p.response.setHeader).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    }
  });
  it('does not inspect unrelated failing or unavailable request fields', () => {
    for (const request of [{ method: 'GET', get path(): string { throw new Error('Synthetic path failure'); } },
      { method: 'GET', path: undefined as unknown as string }]) {
      const p = probe(), next = jest.fn();
      contentRightsContractPrivacyMiddleware(request, p.response, next);
      expect(p.response.setHeader).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    }
  });
  it('does not dispatch protected reads if Authorization Vary cannot be merged', () => {
    const setHeader = jest.fn(), next = jest.fn();
    expect(() => contentRightsContractPrivacyMiddleware({ method: 'GET', path: roots[1] }, { setHeader }, next))
      .toThrow('Contract read response requires Vary support');
    const failure = new Error('Synthetic merge failure');
    expect(() => contentRightsContractPrivacyMiddleware({ method: 'GET', path: roots[1] },
      { setHeader, vary() { throw failure; } }, next)).toThrow(failure);
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(next).not.toHaveBeenCalled();
  });
  it('leaves unrelated routes alone even without Vary support', () => {
    const setHeader = jest.fn(), next = jest.fn();
    contentRightsContractPrivacyMiddleware({ method: 'GET', path: '/health' }, { setHeader }, next);
    expect(setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
