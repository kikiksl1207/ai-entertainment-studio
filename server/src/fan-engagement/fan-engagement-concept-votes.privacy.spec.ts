import { fanEngagementPrivacyMiddleware } from './fan-engagement.privacy';

const parseUrl = require('parseurl') as (request: { url: string }) => { pathname: string };
const CONCEPT = '/api/v1/fan-engagement/concept-votes';
const MISSIONS = '/api/v1/fan-engagement/missions';
const SUMMARY = '/api/v1/me/fan-engagement/summary';
const TITLE = '/api/v1/me/fan-engagement/title';

function responseProbe() {
  const headers = new Map([['Cache-Control', 'public, max-age=60']]);
  const varyFields = new Set(['Accept-Encoding']);
  const response = {
    setHeader: jest.fn((name: string, value: string) => { headers.set(name, value); }),
    vary: jest.fn((field: string) => { varyFields.add(field); }),
  };
  return { response, headers, varyFields };
}

describe('concept-vote list privacy middleware (no HTTP/server/DB)', () => {
  const readPaths: Array<[string, string]> = [
    ['GET', CONCEPT], ['HEAD', CONCEPT],
    ['GET', CONCEPT + '/'], ['HEAD', CONCEPT + '/'],
    ['GET', '/API/V1/FAN-ENGAGEMENT/CONCEPT-VOTES'],
    ['HEAD', '/Api/V1/Fan-Engagement/Concept-Votes/'],
  ];

  it.each(readPaths)('%s %s sets private/no-store and varies before continuation', (method, path) => {
    const probe = responseProbe();
    const next = jest.fn(() => {
      expect(probe.headers.get('Cache-Control')).toBe('private, no-store');
      expect([...probe.varyFields]).toEqual(['Accept-Encoding', 'Authorization']);
    });
    fanEngagementPrivacyMiddleware({ method, path }, probe.response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(probe.response.setHeader).toHaveBeenCalledTimes(1);
    expect(probe.response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(probe.response.vary).toHaveBeenCalledTimes(1);
    expect(probe.response.vary).toHaveBeenCalledWith('Authorization');
  });

  it.each([200, 401, 403, 404, 429, 500])('headers precede synthetic downstream status %s without inspecting auth', status => {
    const probe = responseProbe();
    const failure = new Error('synthetic downstream rejection');
    const request = { method: 'GET', path: CONCEPT,
      get headers(): never { throw new Error('middleware must not inspect credentials'); } };
    const next = jest.fn(() => {
      expect(probe.headers.get('Cache-Control')).toBe('private, no-store');
      expect(probe.response.vary).toHaveBeenCalledWith('Authorization');
      if (status !== 200) throw failure;
    });
    const run = () => fanEngagementPrivacyMiddleware(request, probe.response, next);
    if (status === 200) expect(run).not.toThrow();
    else expect(run).toThrow(failure);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each(['GET', 'HEAD'])('%s uses parser pathname rather than query parameters', method => {
    const parsed = parseUrl({ url: CONCEPT + '/?take=20&artistId=synthetic&status=active' });
    const probe = responseProbe(), next = jest.fn();
    fanEngagementPrivacyMiddleware({ method, path: parsed.pathname }, probe.response, next);
    expect(probe.headers.get('Cache-Control')).toBe('private, no-store');
    expect(probe.response.vary).toHaveBeenCalledWith('Authorization');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('requires Vary support before proceeding on a concept list', () => {
    const setHeader = jest.fn(), next = jest.fn();
    expect(() => fanEngagementPrivacyMiddleware({ method: 'GET', path: CONCEPT }, { setHeader }, next))
      .toThrow('Concept-list response requires Vary support');
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(next).not.toHaveBeenCalled();
  });

  it('retains the exact mission-list Vary failure contract', () => {
    const setHeader = jest.fn(), next = jest.fn();
    expect(() => fanEngagementPrivacyMiddleware({ method: 'HEAD', path: MISSIONS }, { setHeader }, next))
      .toThrow('Mission-list response requires Vary support');
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['GET', 'HEAD'])('%s mission-list protection remains unchanged', method => {
    const probe = responseProbe(), next = jest.fn();
    fanEngagementPrivacyMiddleware({ method, path: MISSIONS + '/' }, probe.response, next);
    expect(probe.headers.get('Cache-Control')).toBe('private, no-store');
    expect(probe.response.vary).toHaveBeenCalledWith('Authorization');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([['GET', SUMMARY], ['HEAD', SUMMARY + '/'], ['PATCH', TITLE]])('preserves %s %s without adding Vary', (method, path) => {
    const probe = responseProbe(), next = jest.fn();
    fanEngagementPrivacyMiddleware({ method, path }, probe.response, next);
    expect(probe.headers.get('Cache-Control')).toBe('private, no-store');
    expect(probe.response.vary).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  const nonRoutes: Array<[string | undefined, string]> = [
    ['POST', CONCEPT], ['POST', CONCEPT + '/synthetic/ballots'],
    ['GET', CONCEPT + '/synthetic/ballots'], ['HEAD', CONCEPT + '/synthetic/ballots'],
    ['PATCH', CONCEPT], ['DELETE', CONCEPT], ['OPTIONS', CONCEPT],
    ['get', CONCEPT], [undefined, CONCEPT],
    ['GET', CONCEPT + '//'], ['GET', CONCEPT + '-extra'], ['GET', CONCEPT + '/extra'],
    ['GET', '/fan-engagement/concept-votes'], ['GET', '/api/v1/other/concept-votes'],
    ['GET', '/api/v1/fan-engagement/concept-votes%2f'],
    ['GET', '/api/v1/fan-engagement%2fconcept-votes'],
    ['GET', CONCEPT + '?take=20'], ['GET', CONCEPT + '#fragment'],
    ['POST', MISSIONS], ['GET', TITLE], ['PATCH', SUMMARY],
  ];
  it.each(nonRoutes)('%s %s leaves existing non-read/non-route policy untouched', (method, path) => {
    const probe = responseProbe(), next = jest.fn();
    fanEngagementPrivacyMiddleware({ method, path }, probe.response, next);
    expect(probe.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect([...probe.varyFields]).toEqual(['Accept-Encoding']);
    expect(probe.response.setHeader).not.toHaveBeenCalled();
    expect(probe.response.vary).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('preserves the fail-open path-getter behavior without changing headers', () => {
    const probe = responseProbe(), next = jest.fn();
    const request = { method: 'GET', get path(): string { throw new Error('synthetic path getter failure'); } };
    fanEngagementPrivacyMiddleware(request, probe.response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(probe.response.setHeader).not.toHaveBeenCalled();
    expect(probe.response.vary).not.toHaveBeenCalled();
  });
});
