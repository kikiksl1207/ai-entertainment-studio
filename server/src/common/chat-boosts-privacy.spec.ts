import { chatBoostsPrivacyMiddleware, isChatBoostsPrivateRequest } from './chat-boosts-privacy';

// Source plan UNRUN: exact route/method boundaries and header ordering only; no auth/service/DB work.
const parseUrl = require('parseurl') as (request: { url: string }) => { pathname: string };
const SESSION = '00000000-0000-4000-8000-000000000801';
const ROOT = '/api/v1';
const reads = [ROOT + '/chat/conversations', ROOT + '/chat/sessions',
  ROOT + '/chat/sessions/' + SESSION + '/messages', ROOT + '/me/paid-like-quota'];
const writes = [ROOT + '/chat/sessions', ROOT + '/chat/conversations/' + SESSION + '/archive',
  ROOT + '/chat/conversations/' + SESSION + '/restore', ROOT + '/chat/sessions/' + SESSION + '/messages',
  ROOT + '/chat/sessions/' + SESSION + '/generate', ROOT + '/chat/sessions/' + SESSION + '/preflight',
  ROOT + '/boost-campaigns/' + SESSION + '/paid-like'];
function probe() {
  const headers = new Map([['Cache-Control', 'public, max-age=60']]), vary = new Set(['Origin', 'Accept-Encoding']);
  const response = { setHeader: jest.fn((name: string, value: string) => { headers.set(name, value); }),
    vary: jest.fn((field: string) => { vary.add(field); }) };
  return { headers, vary, response };
}

describe('chat/paid-like early privacy matcher', () => {
  it('matches only the fifteen implemented read/HEAD and POST method/route pairs', () => {
    const positives: Array<[string, string]> = [
      ...reads.flatMap(path => [['GET', path], ['HEAD', path]] as Array<[string, string]>),
      ...writes.map(path => ['POST', path] as [string, string]),
    ];
    expect(positives).toHaveLength(15);
    for (const [method, path] of positives) for (const variant of [path, path + '/', path.toUpperCase()]) {
      const p = probe(), next = jest.fn(() => {
        expect(p.headers.get('Cache-Control')).toBe('private, no-store');
        expect([...p.vary]).toEqual(['Origin', 'Accept-Encoding', 'Authorization']);
      });
      expect(isChatBoostsPrivateRequest({ method, path: variant })).toBe(true);
      chatBoostsPrivacyMiddleware({ method, path: variant }, p.response, next);
      expect(p.response.setHeader).toHaveBeenCalledTimes(1);
      expect(p.response.vary).toHaveBeenCalledWith('Authorization'); expect(next).toHaveBeenCalledTimes(1);
    }
  });
  it('uses the Express pathname for the observed inbox query and does not inspect raw URL or credentials', () => {
    const p = probe(), next = jest.fn(), parsed = parseUrl({ url: reads[0] + '?box=inbox&take=1' });
    const request = { method: 'GET', path: parsed.pathname,
      get url(): never { throw new Error('Unexpected raw URL read'); },
      get headers(): never { throw new Error('Unexpected credential read'); },
      get body(): never { throw new Error('Unexpected body read'); } };
    chatBoostsPrivacyMiddleware(request, p.response, next);
    expect(p.headers.get('Cache-Control')).toBe('private, no-store'); expect(next).toHaveBeenCalledTimes(1);
  });
  it('protects rejected dynamic parameters without inventing UUID validation or changing requests', () => {
    for (const id of ['synthetic-not-a-uuid', '%2F', '%20']) {
      const request = { method: 'POST', path: ROOT + '/boost-campaigns/' + id + '/paid-like' };
      const before = { ...request }, p = probe(), next = jest.fn();
      chatBoostsPrivacyMiddleware(request, p.response, next);
      expect(request).toEqual(before); expect(p.headers.get('Cache-Control')).toBe('private, no-store');
      expect(next).toHaveBeenCalledTimes(1);
    }
  });
  it.each([200, 201, 401, 403, 429, 500])('sets headers before downstream status %s without swallowing its result', status => {
    const p = probe(), failure = new Error('Synthetic downstream denial');
    const next = jest.fn(() => {
      expect(p.headers.get('Cache-Control')).toBe('private, no-store');
      expect(p.response.vary).toHaveBeenCalledWith('Authorization');
      if (status >= 400) throw failure;
    });
    const run = () => chatBoostsPrivacyMiddleware({ method: 'POST', path: writes[6] }, p.response, next);
    if (status >= 400) expect(run).toThrow(failure); else expect(run).not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
  });
  it('does not widen wrong methods or mutation/reading pairs', () => {
    const negatives: Array<[string | undefined, string]> = [
      ...['OPTIONS', 'PATCH', 'PUT', 'DELETE', 'get', 'post', undefined].map(method => [method, reads[0]] as [string | undefined, string]),
      ['POST', reads[0]], ['POST', reads[3]], ['GET', writes[6]], ['HEAD', writes[6]],
      ...writes.slice(1).map(path => ['DELETE', path] as [string, string]),
    ];
    for (const [method, path] of negatives) {
      const p = probe(), next = jest.fn(); chatBoostsPrivacyMiddleware({ method, path }, p.response, next);
      expect(p.headers.get('Cache-Control')).toBe('public, max-age=60');
      expect(p.response.setHeader).not.toHaveBeenCalled(); expect(p.response.vary).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    }
  });
  it('leaves public products rankings free-likes other orders quotas and chat contracts untouched', () => {
    const negatives: Array<[string, string]> = [
      ['GET', '/boost-products'], ['GET', '/boost-campaigns/current'], ['GET', '/boost-campaigns/' + SESSION + '/rankings'],
      ['POST', '/boost-campaigns/' + SESSION + '/free-like'], ['POST', '/boost-orders'], ['GET', '/me/free-like-quota'],
      ['GET', '/me/boost-events'], ['GET', '/chat/usage-summary'], ['GET', '/chat/provider-ops-status'],
      ['GET', '/chat/character-catalog'], ['GET', '/chat/starter-prompts'], ['GET', '/chat/persona-seed-policy'],
      ['GET', '/chat/premium-support-contract'], ['GET', '/chat-feature-products'], ['POST', '/chat-feature-orders'],
      ['POST', '/chat-feature-orders/preview'],
    ];
    for (const [method, suffix] of negatives) {
      const p = probe(), next = jest.fn(); chatBoostsPrivacyMiddleware({ method, path: ROOT + suffix }, p.response, next);
      expect(p.headers.get('Cache-Control')).toBe('public, max-age=60'); expect([...p.vary]).toEqual(['Origin', 'Accept-Encoding']);
      expect(p.response.setHeader).not.toHaveBeenCalled(); expect(p.response.vary).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects adjacent children double slashes fragments raw queries prefixes and encoded static names', () => {
    const negatives = [reads[0] + '-extra', reads[0] + '/child', reads[0] + '//', reads[0] + '\n',
      reads[0] + '?box=inbox', reads[0] + '#fragment', reads[0].replace('/api/v1/', '/api/'),
      reads[0].replace('/api/v1/', '/api/v2/'), reads[0].replace('conversations', '%63onversations'),
      ROOT + '/chat/sessions/' + SESSION, ROOT + '/chat/sessions/' + SESSION + '/messages/child',
      ROOT + '/chat/conversations//archive', ROOT + '/chat/conversations/' + SESSION + '/archive/child',
      ROOT + '/boost-campaigns/' + SESSION + '/paid-likes', writes[6] + '/child'];
    for (const method of ['GET', 'HEAD', 'POST']) for (const path of negatives) {
      const p = probe(), next = jest.fn(); chatBoostsPrivacyMiddleware({ method, path }, p.response, next);
      expect(p.response.setHeader).not.toHaveBeenCalled(); expect(p.response.vary).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    }
  });
  it('passes through a throwing or unavailable path without touching unrelated headers', () => {
    for (const request of [{ method: 'GET', get path(): string { throw new Error('Synthetic path failure'); } },
      { method: 'GET', path: undefined as unknown as string }]) {
      const p = probe(), next = jest.fn(); chatBoostsPrivacyMiddleware(request, p.response, next);
      expect(p.response.setHeader).not.toHaveBeenCalled(); expect(p.response.vary).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    }
  });
  it('fails before next when Vary support is missing or its merge fails on a protected route', () => {
    const setHeader = jest.fn(), next = jest.fn();
    expect(() => chatBoostsPrivacyMiddleware({ method: 'GET', path: reads[0] }, { setHeader }, next))
      .toThrow('Chat/paid-like response requires Vary support');
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store'); expect(next).not.toHaveBeenCalled();
    const failure = new Error('Synthetic Vary failure');
    expect(() => chatBoostsPrivacyMiddleware({ method: 'GET', path: reads[0] }, { setHeader, vary() { throw failure; } }, next))
      .toThrow(failure); expect(next).not.toHaveBeenCalled();
  });
  it('does not require Vary support on an unrelated route', () => {
    const setHeader = jest.fn(), next = jest.fn();
    chatBoostsPrivacyMiddleware({ method: 'GET', path: ROOT + '/boost-products' }, { setHeader }, next);
    expect(setHeader).not.toHaveBeenCalled(); expect(next).toHaveBeenCalledTimes(1);
  });
});
