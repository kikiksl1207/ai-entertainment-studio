import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, HttpException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { authorBodyReviewPrivacyMiddleware } from '../src/story-production/story-author-body-review.privacy';

// Actual filter with synthetic HTTP/logger boundaries; no server, parser stream or database.
const opts = { concurrency: false, timeout: 2000 };
const missionUrl = '/api/v1/me/fan-engagement/missions/synthetic/participations';
const rawMarker = 'synthetic-parser-raw-body-marker';
type Envelope = {
  success: boolean;
  error: {
    code: string; message: string; statusCode: number; details?: unknown; messageKey?: unknown;
    path?: string; requestId?: string; timestamp: string;
  };
};

function capture(exception: unknown, url = missionUrl,
  options: { initialHeaders?: Record<string, string>; currentFitPrivacy?: boolean } = {}) {
  const filter = new HttpExceptionFilter();
  let loggerCalls = 0, status = 0;
  const bodies: unknown[] = [];
  const headers = { ...options.initialHeaders };
  const logger = (filter as unknown as { logger: { error: (...args: unknown[]) => void } }).logger;
  logger.error = () => { loggerCalls += 1; };
  const request = { url, headers: { 'x-request-id': 'synthetic-parser-request' } };
  const response = {
    status(value: number) { status = value; return { json(value: unknown) { bodies.push(value); } }; },
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; },
  };
  if (options.currentFitPrivacy) authorBodyReviewPrivacyMiddleware(request, response, () => {});
  const beforeHeaders = { ...headers };
  const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }) } as unknown as ArgumentsHost;
  filter.catch(exception, host);
  assert.equal(bodies.length, 1);
  assert.deepEqual(headers, beforeHeaders);
  const body = bodies[0] as Envelope;
  assert.equal(body.success, false);
  assert.equal(body.error.statusCode, status);
  assert.equal(body.error.path, url);
  assert.equal(body.error.requestId, request.headers['x-request-id']);
  assert(Number.isFinite(Date.parse(body.error.timestamp)));
  return { status, body, loggerCalls, headers };
}

function parserError(type: unknown = 'entity.too.large') {
  const error = new Error(rawMarker);
  Object.defineProperty(error, 'type', { value: type, configurable: true, enumerable: true });
  return error;
}

function statusOwner(error: Error, depth: number): object {
  let owner: object = error;
  for (let index = 0; index < depth; index += 1) {
    const prototype: object = Object.create(Error.prototype);
    Object.setPrototypeOf(owner, prototype); owner = prototype;
  }
  return owner;
}

function withStatus(value: unknown, depth = 0) {
  const error = parserError();
  Object.defineProperty(statusOwner(error, depth), 'status', { value, configurable: true });
  return error;
}

function tooLarge(result: ReturnType<typeof capture>) {
  assert.equal(result.status, 413);
  assert.equal(result.body.error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(result.body.error.message, 'Request body is too large');
  assert.equal(result.body.error.details, undefined);
  assert.equal(result.body.error.messageKey, undefined);
  assert(!JSON.stringify(result.body).includes(rawMarker));
  assert.equal(result.loggerCalls, 0);
}

function internal(result: ReturnType<typeof capture>) {
  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(result.body.error.message, 'Internal server error');
  assert(!JSON.stringify(result.body).includes(rawMarker));
  assert.equal(result.loggerCalls, 1);
}

test('01 own parser type and status413 produce a constant safe envelope without logging', opts, () => {
  const error = withStatus(413);
  let rawReads = 0;
  for (const key of ['body', 'details']) Object.defineProperty(error, key, {
    get() { rawReads += 1; throw new Error('Raw parser fields must not be read'); },
  });
  const result = capture(error);
  tooLarge(result); assert.equal(rawReads, 0); assert.deepEqual(result.headers, {});
});

test('02 prototype data status is accepted only within the four inspected owners', opts, () => {
  for (const depth of [1, 2, 3]) tooLarge(capture(withStatus(413, depth)));
});

test('03 own type accessor is never invoked and remains an unknown500', opts, () => {
  const error = withStatus(413);
  let reads = 0;
  Object.defineProperty(error, 'type', { get() { reads += 1; throw new Error('Type accessor invoked'); } });
  internal(capture(error)); assert.equal(reads, 0);
});

test('04 own or inherited status accessor is never invoked or bypassed', opts, () => {
  for (const depth of [0, 1, 2, 3]) {
    const error = parserError();
    const owner = statusOwner(error, depth);
    let reads = 0;
    Object.defineProperty(owner, 'status', { get() { reads += 1; throw new Error('Status accessor invoked'); } });
    internal(capture(error)); assert.equal(reads, 0);
  }
});

test('05 wrong or inherited type and non-Error parser-shaped objects stay500', opts, () => {
  for (const type of ['entity.parse.failed', 'other', 413, null, false]) {
    const error = parserError(type); Object.defineProperty(error, 'status', { value: 413 });
    internal(capture(error));
  }
  const inherited = new Error(rawMarker);
  const owner = statusOwner(inherited, 1);
  Object.defineProperty(owner, 'type', { value: 'entity.too.large' });
  Object.defineProperty(inherited, 'status', { value: 413 });
  internal(capture(inherited));
  internal(capture({ type: 'entity.too.large', status: 413 }));
});

test('06 wrong or absent status never falls back to statusCode or a farther owner', opts, () => {
  for (const value of ['413', 400, 500, 0, null, undefined, NaN, Infinity]) internal(capture(withStatus(value)));
  const statusCodeOnly = parserError();
  Object.defineProperty(statusCodeOnly, 'statusCode', { value: 413 });
  internal(capture(statusCodeOnly));
  const nearest = withStatus(400);
  Object.defineProperty(statusOwner(nearest, 1), 'status', { value: 413 });
  internal(capture(nearest));
});

test('07 depth-four and deeper status remain500 without reading a deeper accessor', opts, () => {
  for (const depth of [4, 5]) internal(capture(withStatus(413, depth)));
  const error = parserError();
  let reads = 0;
  Object.defineProperty(statusOwner(error, 4), 'status', { get() { reads += 1; return 413; } });
  internal(capture(error)); assert.equal(reads, 0);
  internal(capture(parserError()));
});

test('08 existing HttpException retains its status response and fields without parser reads', opts, () => {
  const payload = { code: 'SYNTHETIC_EXISTING', message: 'Existing policy', details: { retained: true } };
  const exception = new HttpException(payload, 409);
  let parserReads = 0, statusCalls = 0, responseCalls = 0;
  for (const key of ['type', 'status']) Object.defineProperty(exception, key, {
    get() { parserReads += 1; throw new Error('Existing HttpException parser accessor invoked'); },
  });
  exception.getStatus = () => { statusCalls += 1; return 409; };
  exception.getResponse = () => { responseCalls += 1; return payload; };
  const result = capture(exception);
  assert.equal(result.status, 409); assert.equal(result.body.error.code, payload.code);
  assert.equal(result.body.error.message, payload.message); assert.equal(result.body.error.details, payload.details);
  assert.equal(statusCalls, 1); assert.equal(responseCalls, 1); assert.equal(parserReads, 0);
  assert.equal(result.loggerCalls, 0);
});

test('09 existing malformed400 is unchanged while unrelated errors keep unknown logging', opts, () => {
  const result = capture(new BadRequestException('Synthetic malformed JSON'));
  assert.equal(result.status, 400); assert.equal(result.body.error.code, 'BAD_REQUEST');
  assert.equal(result.body.error.message, 'Synthetic malformed JSON'); assert.equal(result.loggerCalls, 0);
  internal(capture(new Error(rawMarker)));
  internal(capture(null));
});

test('10 current-fit privacy and already-coded watch exceptions retain their policies', opts, () => {
  const fitUrl = '/api/v1/me/creator-studio/stories/synthetic/body-preview/current-fit';
  const fit = capture(withStatus(413, 1), fitUrl, { currentFitPrivacy: true });
  tooLarge(fit); assert.equal(fit.headers['cache-control'], 'private, no-store');
  const watchHeaders = { 'cache-control': 'private, no-store', pragma: 'no-cache', expires: '0', vary: 'Authorization' };
  for (const [status, code] of [[413, 'ARTIST_WATCH_BODY_TOO_LARGE'], [400, 'ARTIST_WATCH_INVALID_INPUT']] as const) {
    const watch = capture(new HttpException({ code, message: 'Existing watch policy' }, status),
      '/admin/api/v1/artist-operator-watch', { initialHeaders: watchHeaders });
    assert.equal(watch.status, status); assert.equal(watch.body.error.code, code);
    assert.equal(watch.body.error.message, 'Existing watch policy'); assert.equal(watch.loggerCalls, 0);
    assert.deepEqual(watch.headers, watchHeaders);
  }
});
