import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage,
  type RequestListener, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { authorBodyReviewPrivacyMiddleware } from './story-author-body-review.privacy';

const WORK = '11111111-1111-4111-8111-111111111111';
const ROOT = '/api/me/creator-studio/stories/' + WORK;
const FIT = ROOT + '/body-preview/current-fit';
const LEGACY_FIT = '/api/v1/me/creator-studio/stories/' + WORK + '/body-preview/current-fit';
const GARBAGE_FIT = '/api/me/creator-studio/stories/not-a-uuid/body-preview/current-fit';
const PRIVATE_CACHE = 'private, no-store';
const METHODS = ['GET', 'HEAD'] as const;
type Method = typeof METHODS[number] | 'POST';

function privacyFixture() {
  const headers: Record<string, string> = { 'Cache-Control': 'public, max-age=60', Vary: 'Origin' };
  const response = { setHeader: jest.fn((name: string, value: string) => { headers[name] = value; }) };
  return { headers, response };
}

describe('current-fit early privacy matcher (actual middleware, no authorization)', () => {
  it.each([FIT, LEGACY_FIT, FIT + '/', FIT + '?locale=ko', FIT + '/?locale=ko',
    FIT.toUpperCase(), GARBAGE_FIT])('protects exact current-fit %s before next', url => {
    const f = privacyFixture();
    const next = jest.fn(() => {
      expect(f.headers).toEqual({ 'Cache-Control': PRIVATE_CACHE, Vary: 'Origin' });
    });
    authorBodyReviewPrivacyMiddleware({ url }, f.response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(f.response.setHeader).toHaveBeenCalledTimes(1);
  });

  it('preserves existing body-review roots, aliases, queries and descendants', () => {
    for (const url of [ROOT + '/body-review', ROOT + '/body-review?locale=ko',
      ROOT + '/body-review/', ROOT + '/body-review/observations/item',
      '/api/v1/me/creator-studio/stories/' + WORK + '/body-review/observations?locale=ko']) {
      const f = privacyFixture();
      const next = jest.fn(() => { expect(f.headers['Cache-Control']).toBe(PRIVATE_CACHE); });
      authorBodyReviewPrivacyMiddleware({ url }, f.response, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(f.response.setHeader).toHaveBeenCalledTimes(1);
    }
  });

  it.each([FIT + '/child', FIT + '-other', FIT + '//', FIT + '%2F',
    '/public/stories/' + WORK + '/body-preview/current-fit',
    '/api/v2/me/creator-studio/stories/' + WORK + '/body-preview/current-fit',
    ROOT + '/body-preview', ROOT + '/body-review-public',
    '/public/stories?next=' + FIT])('leaves nearby/public/lookalike %s unchanged', url => {
    const f = privacyFixture();
    const next = jest.fn();
    authorBodyReviewPrivacyMiddleware({ url }, f.response, next);
    expect(f.headers).toEqual({ 'Cache-Control': 'public, max-age=60', Vary: 'Origin' });
    expect(f.response.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets only cache privacy without changing the request or manufacturing authorization', () => {
    const request = Object.freeze({
      url: FIT, method: 'POST', headers: Object.freeze({ authorization: 'synthetic-not-verified' }),
      body: Object.freeze({ synthetic: true }), user: undefined,
    });
    const f = privacyFixture();
    const next = jest.fn();
    authorBodyReviewPrivacyMiddleware(request, f.response, next);
    expect(request).toEqual({
      url: FIT, method: 'POST', headers: { authorization: 'synthetic-not-verified' },
      body: { synthetic: true }, user: undefined,
    });
    expect(f.response.setHeader.mock.calls).toEqual([['Cache-Control', PRIVATE_CACHE]]);
    expect(next.mock.calls).toEqual([[]]);
  });
});

// Use the installed Express runtime without adding a new types dependency.
type ParsedRequest = IncomingMessage & { url: string; body?: unknown };
type Next = (error?: unknown) => void;
type Middleware = (request: ParsedRequest, response: ServerResponse, next: Next) => void;
type ErrorMiddleware = (error: unknown, request: ParsedRequest, response: ServerResponse, next: Next) => void;
type ExpressApp = RequestListener & { use(handler: Middleware | ErrorMiddleware): void };
type ExpressFactory = {
  (): ExpressApp;
  json(options: { limit: number; strict: boolean }): Middleware;
};
const express = require('express') as ExpressFactory;
type Packet = { status: number; headers: IncomingHttpHeaders; text: string };

describe('current-fit privacy ahead of real Express JSON parsing (synthetic downstream only)', () => {
  const malformed = '{"synthetic":';
  const oversized = JSON.stringify({ synthetic: 'x'.repeat(96) });
  const valid = '{"synthetic":true}';
  const sockets = new Set<Socket>();
  let server: Server | undefined;
  let port = 0;
  let incoming = 0;
  let sent = 0;
  let totalSent = 0;
  let allowSyntheticDownstream = false;
  const parserFailures: { type: string; status: number }[] = [];

  function reply(response: ServerResponse, status: number, code: string) {
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ code }));
  }

  // This sentinel is not JwtAuthGuard/JWT verification or a production permission decision.
  const syntheticJwtGate = jest.fn((_request: ParsedRequest, response: ServerResponse, next: Next) => {
    if (allowSyntheticDownstream) next();
    else reply(response, 401, 'SYNTHETIC_AUTH_REQUIRED');
  });
  const syntheticHandler = jest.fn((_request: ParsedRequest, response: ServerResponse, _next: Next) => {
    reply(response, 200, 'SYNTHETIC_DOWNSTREAM_ONLY');
  });

  async function closeOwnedServer() {
    const owned = server;
    server = undefined;
    port = 0;
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    if (owned?.listening) {
      await new Promise<void>((resolve, reject) => {
        owned.close(error => { if (error) reject(error); else resolve(); });
      });
    }
  }

  beforeAll(async () => {
    try {
      const app = express();
      const countIncoming: Middleware = (_request, _response, next) => { incoming++; next(); };
      app.use(countIncoming);
      app.use(authorBodyReviewPrivacyMiddleware);
      // Small fixture limit only; this does not change or certify the production parser limit.
      app.use(express.json({ limit: 64, strict: true }));
      app.use(syntheticJwtGate);
      app.use(syntheticHandler);
      const parserError: ErrorMiddleware = (error, _request, response, _next) => {
        const raw = error && typeof error === 'object'
          ? error as { type?: unknown; status?: unknown } : {};
        if (raw.type === 'entity.parse.failed' && raw.status === 400) {
          parserFailures.push({ type: raw.type, status: raw.status });
          reply(response, 400, 'SYNTHETIC_JSON_PARSE_FAILED');
        } else if (raw.type === 'entity.too.large' && raw.status === 413) {
          parserFailures.push({ type: raw.type, status: raw.status });
          reply(response, 413, 'SYNTHETIC_JSON_BODY_TOO_LARGE');
        } else reply(response, 500, 'SYNTHETIC_UNEXPECTED_ERROR');
      };
      // Fixed fixture responses are not evidence of the production exception-filter contract.
      app.use(parserError);
      const owned = createServer(app);
      server = owned;
      owned.on('connection', socket => {
        sockets.add(socket);
        socket.once('close', () => { sockets.delete(socket); });
      });
      await new Promise<void>((resolve, reject) => {
        owned.once('error', reject);
        owned.listen(0, '127.0.0.1', () => {
          owned.off('error', reject);
          resolve();
        });
      });
      const address = owned.address() as AddressInfo | null;
      if (!address || address.address !== '127.0.0.1') throw new Error('Owned loopback address missing');
      port = address.port;
    } catch (error) {
      await closeOwnedServer();
      throw error;
    }
  }, 15_000);

  beforeEach(() => {
    incoming = 0;
    sent = 0;
    allowSyntheticDownstream = false;
    parserFailures.length = 0;
    syntheticJwtGate.mockClear();
    syntheticHandler.mockClear();
  });

  afterEach(() => { expect(incoming).toBe(sent); });
  afterAll(async () => { await closeOwnedServer(); }, 15_000);

  async function request(method: Method, path: string, body: string): Promise<Packet> {
    if (!server?.listening || !port) throw new Error('Owned loopback server is not listening');
    if (totalSent >= 17) throw new Error('Bounded loopback request cap exceeded');
    totalSent++;
    sent++;
    const packet = await new Promise<Packet>((resolve, reject) => {
      const client = httpRequest({
        hostname: '127.0.0.1', port, method, path, agent: false,
        headers: { connection: 'close', 'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body, 'utf8')) },
      }, response => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => { chunks.push(Buffer.from(chunk)); });
        response.on('error', reject);
        response.on('aborted', () => { reject(new Error('Owned loopback response aborted')); });
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, headers: response.headers,
            text: Buffer.concat(chunks).toString('utf8') });
        });
      });
      client.setTimeout(4_000, () => { client.destroy(new Error('Owned loopback request timed out')); });
      client.on('error', reject);
      client.end(body);
    });
    expect(packet.headers['set-cookie']).toBeUndefined();
    if (method === 'HEAD') expect(packet.text).toBe('');
    return packet;
  }

  function expectParserFailure(packet: Packet, method: Method, status: 400 | 413, privateRoute = true) {
    expect(packet.status).toBe(status);
    expect(packet.headers['cache-control']).toBe(privateRoute ? PRIVATE_CACHE : undefined);
    expect(parserFailures).toEqual([{
      type: status === 400 ? 'entity.parse.failed' : 'entity.too.large', status,
    }]);
    expect(syntheticJwtGate).not.toHaveBeenCalled();
    expect(syntheticHandler).not.toHaveBeenCalled();
    if (method !== 'HEAD') {
      expect(JSON.parse(packet.text)).toEqual({
        code: status === 400 ? 'SYNTHETIC_JSON_PARSE_FAILED' : 'SYNTHETIC_JSON_BODY_TOO_LARGE',
      });
    }
  }

  it.each(METHODS)('keeps malformed %s private before the synthetic JWT sentinel', async method => {
    expectParserFailure(await request(method, FIT, malformed), method, 400);
  });

  it.each(METHODS)('keeps malformed legacy trailing/query %s private before auth', async method => {
    expectParserFailure(await request(method, LEGACY_FIT + '/?locale=ko', malformed), method, 400);
  });

  it.each(METHODS)('keeps over-limit %s private before auth', async method => {
    expectParserFailure(await request(method, FIT, oversized), method, 413);
  });

  // Parser/header behavior on POST is not a claim that the production GET controller accepts POST.
  it('keeps malformed POST on the exact path private before auth', async () => {
    expectParserFailure(await request('POST', FIT, malformed), 'POST', 400);
  });

  it('keeps over-limit POST on the exact path private before auth', async () => {
    expectParserFailure(await request('POST', FIT, oversized), 'POST', 413);
  });

  it('protects malformed input even when work ID/query would later be invalid', async () => {
    expectParserFailure(await request('GET', GARBAGE_FIT + '?unexpected=1', malformed), 'GET', 400);
  });

  it('does not authorize normal GET/HEAD merely because privacy matched', async () => {
    for (const method of METHODS) {
      const packet = await request(method, FIT, valid);
      expect(packet.status).toBe(401);
      expect(packet.headers['cache-control']).toBe(PRIVATE_CACHE);
      if (method === 'GET') expect(JSON.parse(packet.text)).toEqual({ code: 'SYNTHETIC_AUTH_REQUIRED' });
    }
    expect(parserFailures).toEqual([]);
    expect(syntheticJwtGate).toHaveBeenCalledTimes(2);
    expect(syntheticHandler).not.toHaveBeenCalled();
    for (const [parsed] of syntheticJwtGate.mock.calls) {
      expect(parsed.body).toEqual({ synthetic: true });
      expect(parsed.headers.authorization).toBeUndefined();
    }
  });

  it('preserves normal parsed GET/HEAD flow only when the synthetic sentinel explicitly permits it', async () => {
    allowSyntheticDownstream = true;
    for (const method of METHODS) {
      const packet = await request(method, FIT + '?locale=ko', valid);
      expect(packet.status).toBe(200);
      expect(packet.headers['cache-control']).toBe(PRIVATE_CACHE);
      if (method === 'GET') expect(JSON.parse(packet.text)).toEqual({ code: 'SYNTHETIC_DOWNSTREAM_ONLY' });
    }
    expect(parserFailures).toEqual([]);
    expect(syntheticJwtGate).toHaveBeenCalledTimes(2);
    expect(syntheticHandler).toHaveBeenCalledTimes(2);
  });

  it('does not capture nearby/public parser GET/HEAD errors, including a private URL only in query', async () => {
    for (const path of [FIT + '-other', '/public/stories?next=' + FIT]) {
      for (const method of METHODS) {
        parserFailures.length = 0;
        expectParserFailure(await request(method, path, malformed), method, 400, false);
      }
    }
  });
});
