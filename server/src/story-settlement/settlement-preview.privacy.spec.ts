import { isSettlementPreviewPrivateRead, settlementPreviewPrivacyMiddleware } from './settlement-preview.privacy';

type VaryReceiver = {
  getHeader(name: string): string | number | readonly string[] | undefined;
  setHeader(name: string, value: string | number | readonly string[]): void;
  vary(field: string): VaryReceiver;
};
const expressResponse = require('express').response as { vary(this: VaryReceiver, field: string): VaryReceiver };

const paths = [
  '/api/v1/me/creator-studio/settlement-preview',
  '/api/v1/me/creator-studio/payout-summary',
  '/api/v1/me/creator-studio/settlement-conversions',
  '/admin/api/v1/backstage/operations/settlement-preview',
  '/admin/api/v1/backstage/operations/partner-settlement-preview',
  '/admin/api/v1/backstage/settlement-conversions',
];
type PrivacyRequest = Parameters<typeof isSettlementPreviewPrivateRead>[0];
type PrivacyResponse = Parameters<typeof settlementPreviewPrivacyMiddleware>[1];

function responseProbe(initialVary = 'Origin, Accept-Encoding') {
  const headers = new Map<string, string | number | readonly string[]>([
    ['cache-control', 'public, max-age=60'], ['vary', initialVary],
  ]);
  const response = {
    getHeader: jest.fn((name: string) => headers.get(name.toLowerCase())),
    setHeader: jest.fn((name: string, value: string | number | readonly string[]) => {
      headers.set(name.toLowerCase(), value);
    }),
    vary: jest.fn((field: string): VaryReceiver => expressResponse.vary.call(response as unknown as VaryReceiver, field)),
  };
  const varyTokens = () => String(headers.get('vary')).toLowerCase().split(',').map(value => value.trim());
  return { headers, response, varyTokens };
}

describe('settlement preview HTTP privacy matcher and dispatch boundary', () => {
  it('matches exactly the six reads with GET/HEAD, case-insensitive paths and one trailing slash', () => {
    for (const path of paths) {
      for (const variant of [path, path + '/', path.toUpperCase(), path.toUpperCase() + '/']) {
        for (const method of ['GET', 'HEAD']) {
          expect(isSettlementPreviewPrivateRead({ method, path: variant })).toBe(true);
        }
      }
    }
  });

  it('rejects write methods, raw queries, suffixes, details and neighboring namespaces without changing headers', () => {
    const cases: PrivacyRequest[] = [];
    for (const path of paths) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'get', 'head', 'GET ', undefined]) {
        cases.push({ method, path });
      }
      for (const suffix of ['-extra', '/one', '/one/status', '//', '?period=2026-10', '#fragment']) {
        cases.push({ method: 'GET', path: path + suffix });
      }
    }
    for (const path of ['/settlement-preview', '/api/v2/me/creator-studio/settlement-preview',
      '/api/v1/admin/api/v1/backstage/operations/settlement-preview',
      '/api/v1/me/creator-studio/partner-settlement-preview',
      '/admin/api/v1/backstage/payout-summary', '/admin/api/v1/backstage/operations/settlement-conversions',
      '/api/v1/me/creator-studio/content-rights-contracts', '/admin/api/v1/backstage/settlements']) {
      cases.push({ method: 'HEAD', path });
    }
    for (const request of cases) {
      const probe = responseProbe(), next = jest.fn();
      expect(isSettlementPreviewPrivateRead(request)).toBe(false);
      settlementPreviewPrivacyMiddleware(request, probe.response, next);
      expect(probe.response.setHeader).not.toHaveBeenCalled();
      expect(probe.response.vary).not.toHaveBeenCalled();
      expect(probe.headers.get('cache-control')).toBe('public, max-age=60');
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it('fails closed for nonstring/control paths and throwing path or method accessors', () => {
    const malformed: unknown[] = [undefined, null, 42, [], {}, new String(paths[0])];
    const requests = malformed.map(path => ({ method: 'GET', path }) as PrivacyRequest);
    for (const control of ['\u0000', '\t', '\n', '\r', ' ', '\u001f', '\u007f']) {
      for (const path of [control + paths[0], paths[0] + control, paths[0].replace('studio', 'stu' + control + 'dio')]) {
        requests.push({ method: 'GET', path });
      }
    }
    requests.push({ method: 'GET', get path(): string { throw new Error('Synthetic path accessor'); } },
      { path: paths[0], get method(): string { throw new Error('Synthetic method accessor'); } });
    for (const request of requests) {
      const probe = responseProbe(), next = jest.fn();
      expect(isSettlementPreviewPrivateRead(request)).toBe(false);
      settlementPreviewPrivacyMiddleware(request, probe.response, next);
      expect(probe.response.setHeader).not.toHaveBeenCalled();
      expect(probe.response.vary).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it('sets private headers before next without reading credentials/body/raw URL or mutating the request', () => {
    const request = Object.freeze({ method: 'GET', path: paths[2],
      get headers(): never { throw new Error('Credential access forbidden'); },
      get body(): never { throw new Error('Body access forbidden'); },
      get url(): never { throw new Error('Raw URL access forbidden'); } });
    const probe = responseProbe();
    const next = jest.fn(() => {
      expect(probe.headers.get('cache-control')).toBe('private, no-store');
      expect(probe.varyTokens()).toEqual(['origin', 'accept-encoding', 'authorization']);
      expect(request.path).toBe(paths[2]);
    });
    settlementPreviewPrivacyMiddleware(request, probe.response, next);
    expect(probe.response.vary).toHaveBeenCalledTimes(1);
    expect(probe.response.vary).toHaveBeenCalledWith('Authorization');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('uses actual Express Vary merging, preserving existing fields and case-insensitive Authorization once', () => {
    for (const initial of ['Origin, Accept-Encoding', 'Origin, aUtHoRiZaTiOn, Accept-Encoding']) {
      const probe = responseProbe(initial), next = jest.fn();
      for (let pass = 0; pass < 2; pass++) {
        settlementPreviewPrivacyMiddleware({ method: 'HEAD', path: paths[4] }, probe.response, next);
      }
      expect(probe.headers.get('cache-control')).toBe('private, no-store');
      for (const token of ['origin', 'accept-encoding', 'authorization']) {
        expect(probe.varyTokens().filter(value => value === token)).toHaveLength(1);
      }
      expect(probe.response.vary.mock.calls).toEqual([['Authorization'], ['Authorization']]);
      expect(next).toHaveBeenCalledTimes(2);
    }
  });

  it('preserves wildcard Vary through the actual Express response implementation', () => {
    const probe = responseProbe('*'), next = jest.fn();
    settlementPreviewPrivacyMiddleware({ method: 'GET', path: paths[1] }, probe.response, next);
    expect(probe.headers.get('cache-control')).toBe('private, no-store');
    expect(probe.headers.get('vary')).toBe('*');
    expect(probe.response.vary).toHaveBeenCalledWith('Authorization');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('retains private headers and does not swallow a downstream next error', () => {
    const probe = responseProbe(), failure = new Error('Synthetic downstream failure');
    const next = jest.fn(() => {
      expect(probe.headers.get('cache-control')).toBe('private, no-store');
      expect(probe.varyTokens()).toContain('authorization');
      throw failure;
    });
    expect(() => settlementPreviewPrivacyMiddleware({ method: 'GET', path: paths[3] }, probe.response, next)).toThrow(failure);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('never dispatches a protected read when Vary is missing, nonfunctional or throws', () => {
    for (const vary of [undefined, null, 42]) {
      const next = jest.fn(), setHeader = jest.fn();
      const response = { setHeader, vary } as unknown as PrivacyResponse;
      expect(() => settlementPreviewPrivacyMiddleware({ method: 'HEAD', path: paths[5] }, response, next)).toThrow();
      expect(next).not.toHaveBeenCalled();
    }
    const probe = responseProbe(), failure = new Error('Synthetic Vary merge failure'), next = jest.fn();
    probe.response.vary.mockImplementationOnce(() => { throw failure; });
    expect(() => settlementPreviewPrivacyMiddleware({ method: 'GET', path: paths[0] }, probe.response, next)).toThrow(failure);
    expect(probe.headers.get('cache-control')).toBe('private, no-store');
    expect(next).not.toHaveBeenCalled();
  });

  it('does not inspect unavailable response Vary support on non-target requests', () => {
    const setHeader = jest.fn(), next = jest.fn();
    const response = { setHeader, get vary(): never { throw new Error('Unexpected response access'); } };
    settlementPreviewPrivacyMiddleware({ method: 'GET', path: '/health' }, response, next);
    settlementPreviewPrivacyMiddleware({ method: 'POST', path: paths[2] }, { setHeader }, next);
    expect(setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
  });
});
