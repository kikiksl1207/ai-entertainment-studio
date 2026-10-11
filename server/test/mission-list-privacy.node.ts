// Actual middleware and Express prototype checks; no tokens, server, or database.
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fanEngagementPrivacyMiddleware } from '../src/fan-engagement/fan-engagement.privacy';

const ROOT = 'E:/Codex/LuminaStage/ai-entertainment-studio-git';
const requireLocal = createRequire(ROOT + '/server/package.json');

type HeaderValue = string | string[];
type RequestFixture = Parameters<typeof fanEngagementPrivacyMiddleware>[0] & { url: string };
interface ResponseFixture {
  setHeader(name: string, value: HeaderValue): void;
  getHeader(name: string): HeaderValue | undefined;
  vary?: (field: string | string[]) => unknown;
}
interface LocalExpress {
  request: object;
  response: { vary: (field: string | string[]) => unknown };
}

// Only the installed request/response prototypes are used; no express() or listener.
const express = requireLocal('express') as LocalExpress;
const MISSION = '/api/v1/fan-engagement/missions';
const SUMMARY = '/api/v1/me/fan-engagement/summary';
const TITLE = '/api/v1/me/fan-engagement/title';
const PRIVATE = 'private, no-store';
const OPTIONS = { timeout: 1000, concurrency: false };

function requestFixture(method: string | undefined, url: string): RequestFixture {
  const request = Object.create(express.request) as RequestFixture;
  Object.defineProperties(request, {
    method: { value: method, enumerable: true },
    url: { value: url, writable: true, enumerable: true },
  });
  return request;
}

function responseFixture(initial: Record<string, HeaderValue> = {}) {
  const headers = new Map<string, HeaderValue>();
  for (const [name, value] of Object.entries(initial)) headers.set(name.toLowerCase(), value);
  const writes: Array<{ name: string; value: HeaderValue }> = [];
  const response = Object.create(express.response) as ResponseFixture;
  response.getHeader = name => headers.get(name.toLowerCase());
  response.setHeader = (name, value) => {
    headers.set(name.toLowerCase(), value);
    writes.push({ name, value });
  };
  return { response, headers, writes };
}

function assertMissionHeaders(response: ResponseFixture, vary: string) {
  assert.equal(response.getHeader('Cache-Control'), PRIVATE);
  assert.equal(response.getHeader('Vary'), vary);
}

test('01 GET uses actual pathname without the query before next', OPTIONS, () => {
  const request = requestFixture('GET', MISSION + '?surface=home&locale=ko');
  const { response, writes } = responseFixture();
  assert.equal(Object.getPrototypeOf(request), express.request);
  assert.equal(request.path, MISSION);
  assert.equal(response.vary, express.response.vary);
  let nextCalls = 0;
  fanEngagementPrivacyMiddleware(request, response, () => {
    nextCalls++;
    assertMissionHeaders(response, 'Authorization');
  });
  assert.equal(nextCalls, 1);
  assert.deepEqual(writes, [
    { name: 'Cache-Control', value: PRIVATE },
    { name: 'Vary', value: 'Authorization' },
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'user'), false);
});

test('02 HEAD uses actual pathname without the query before next', OPTIONS, () => {
  const request = requestFixture('HEAD', MISSION + '?surface=home&locale=en');
  const { response } = responseFixture();
  assert.equal(request.path, MISSION);
  let nextCalls = 0;
  fanEngagementPrivacyMiddleware(request, response, () => {
    nextCalls++;
    assertMissionHeaders(response, 'Authorization');
  });
  assert.equal(nextCalls, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'user'), false);
});

test('03 current case-insensitive and single trailing slash matching stays exact', OPTIONS, () => {
  for (const method of ['GET', 'HEAD']) {
    for (const url of [MISSION + '/', '/API/V1/FAN-ENGAGEMENT/MISSIONS?locale=ja']) {
      const { response } = responseFixture();
      let nextCalls = 0;
      fanEngagementPrivacyMiddleware(requestFixture(method, url), response, () => nextCalls++);
      assert.equal(nextCalls, 1);
      assertMissionHeaders(response, 'Authorization');
    }
  }
});

test('04 real Express Vary preserves Origin before and after mission middleware', OPTIONS, () => {
  const { response } = responseFixture({ Vary: 'Origin', 'X-QA-Control': 'unchanged' });
  let nextCalls = 0;
  fanEngagementPrivacyMiddleware(requestFixture('GET', MISSION), response, () => nextCalls++);
  assert.equal(nextCalls, 1);
  assertMissionHeaders(response, 'Origin, Authorization');
  response.vary!('Origin');
  assertMissionHeaders(response, 'Origin, Authorization');
  assert.equal(response.getHeader('X-QA-Control'), 'unchanged');

  const later = responseFixture().response;
  fanEngagementPrivacyMiddleware(requestFixture('HEAD', MISSION), later, () => {});
  later.vary!('Origin');
  assertMissionHeaders(later, 'Authorization, Origin');
});

test('05 existing Authorization case and repeated calls do not duplicate Vary', OPTIONS, () => {
  const { response } = responseFixture({ Vary: 'Origin, aUtHoRiZaTiOn' });
  let nextCalls = 0;
  for (const method of ['GET', 'HEAD']) {
    fanEngagementPrivacyMiddleware(requestFixture(method, MISSION), response, () => nextCalls++);
    assertMissionHeaders(response, 'Origin, aUtHoRiZaTiOn');
  }
  assert.equal(nextCalls, 2);
});

test('06 real Express Vary merges an existing header array without losing fields', OPTIONS, () => {
  const { response } = responseFixture({ Vary: ['Origin', 'Accept-Encoding'] });
  let nextCalls = 0;
  fanEngagementPrivacyMiddleware(requestFixture('GET', MISSION), response, () => nextCalls++);
  assert.equal(nextCalls, 1);
  assertMissionHeaders(response, 'Origin, Accept-Encoding, Authorization');
});

test('07 existing Vary star remains star while the cache directive is private', OPTIONS, () => {
  for (const value of ['*', ['Origin', '*']]) {
    const { response } = responseFixture({ Vary: value });
    let nextCalls = 0;
    fanEngagementPrivacyMiddleware(requestFixture('HEAD', MISSION), response, () => nextCalls++);
    assert.equal(nextCalls, 1);
    assertMissionHeaders(response, '*');
  }
});

test('08 headers precede and survive synthetic downstream error propagation', OPTIONS, () => {
  for (const method of ['GET', 'HEAD']) {
    for (const status of [400, 401, 403, 404, 413, 429, 500]) {
      const { response } = responseFixture({ Vary: 'Origin' });
      const error = Object.assign(new Error('QA_DOWNSTREAM_ERROR'), { status });
      let nextCalls = 0;
      assert.throws(() => fanEngagementPrivacyMiddleware(requestFixture(method, MISSION), response, () => {
        nextCalls++;
        assertMissionHeaders(response, 'Origin, Authorization');
        throw error;
      }), value => value === error);
      assert.equal(nextCalls, 1);
      assertMissionHeaders(response, 'Origin, Authorization');
    }
  }
});

test('09 existing summary GET and HEAD need no Vary function and keep their header boundary', OPTIONS, () => {
  for (const method of ['GET', 'HEAD']) {
    for (const url of [SUMMARY, SUMMARY + '/?locale=ko']) {
      const { response, writes } = responseFixture({ Vary: 'Origin' });
      Object.defineProperty(response, 'vary', { value: undefined });
      let nextCalls = 0;
      fanEngagementPrivacyMiddleware(requestFixture(method, url), response, () => nextCalls++);
      assert.equal(nextCalls, 1);
      assert.equal(response.getHeader('Cache-Control'), PRIVATE);
      assert.equal(response.getHeader('Vary'), 'Origin');
      assert.deepEqual(writes, [{ name: 'Cache-Control', value: PRIVATE }]);
    }
  }
});

test('10 existing title PATCH needs no Vary function and keeps its header boundary', OPTIONS, () => {
  for (const url of [TITLE, TITLE + '/?locale=en']) {
    const { response, writes } = responseFixture({ Vary: 'Origin' });
    Object.defineProperty(response, 'vary', { value: undefined });
    let nextCalls = 0;
    fanEngagementPrivacyMiddleware(requestFixture('PATCH', url), response, () => nextCalls++);
    assert.equal(nextCalls, 1);
    assert.equal(response.getHeader('Cache-Control'), PRIVATE);
    assert.equal(response.getHeader('Vary'), 'Origin');
    assert.deepEqual(writes, [{ name: 'Cache-Control', value: PRIVATE }]);
  }
});

test('11 adjacent and child paths gain no cache or Authorization Vary policy', OPTIONS, () => {
  const paths: Array<[string, string]> = [
    [MISSION + '//', 'qa-existing'], [MISSION + '/next', 'qa-existing'],
    [MISSION + '/participations', 'qa-existing'], [MISSION + '-archive', 'qa-existing'],
    ['/prefix' + MISSION, 'qa-existing'], ['/api/v1/fan-engagement/concept-votes', 'qa-existing'],
    ['/api/v1/me/fan-engagement/titles', 'qa-existing'],
    [SUMMARY + '/next', 'qa-existing'], [TITLE + '/next', 'qa-existing'],
    ['/api/v1/me/creator-studio/stories/qa-fixture/body-preview/current-fit', PRIVATE],
    ['/admin/api/v1/artist-operator-watch', PRIVATE],
  ];
  // The last two controls only preserve preseeded headers; their middleware is not invoked.
  for (const method of ['GET', 'HEAD', 'PATCH', 'POST']) {
    for (const [url, cache] of paths) {
      const { response, writes } = responseFixture({ 'Cache-Control': cache, Vary: 'Origin' });
      let nextCalls = 0;
      fanEngagementPrivacyMiddleware(requestFixture(method, url), response, () => nextCalls++);
      assert.equal(nextCalls, 1);
      assert.equal(response.getHeader('Cache-Control'), cache);
      assert.equal(response.getHeader('Vary'), 'Origin');
      assert.deepEqual(writes, []);
    }
  }
});

test('12 unmatched methods retain existing headers for all three exact paths', OPTIONS, () => {
  const rows: Array<[string, Array<string | undefined>]> = [
    [MISSION, ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'get', '', undefined]],
    [SUMMARY, ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'get', '', undefined]],
    [TITLE, ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'patch', '', undefined]],
  ];
  for (const [url, methods] of rows) {
    for (const method of methods) {
      const { response, writes } = responseFixture({ 'Cache-Control': 'qa-existing', Vary: 'Origin' });
      let nextCalls = 0;
      fanEngagementPrivacyMiddleware(requestFixture(method, url), response, () => nextCalls++);
      assert.equal(nextCalls, 1);
      assert.equal(response.getHeader('Cache-Control'), 'qa-existing');
      assert.equal(response.getHeader('Vary'), 'Origin');
      assert.deepEqual(writes, []);
    }
  }
});

test('13 a throwing path getter preserves the original fall-through contract', OPTIONS, () => {
  const request = requestFixture('GET', MISSION);
  let pathReads = 0;
  Object.defineProperty(request, 'path', { get: () => {
    pathReads++;
    throw new Error('QA_PATH_UNAVAILABLE');
  } });
  const { response, writes } = responseFixture({ 'Cache-Control': 'qa-existing', Vary: 'Origin' });
  let nextCalls = 0;
  fanEngagementPrivacyMiddleware(request, response, () => nextCalls++);
  assert.equal(pathReads, 1);
  assert.equal(nextCalls, 1);
  assert.equal(response.getHeader('Cache-Control'), 'qa-existing');
  assert.equal(response.getHeader('Vary'), 'Origin');
  assert.deepEqual(writes, []);
});

test('14 a missing mission Vary function fails after private cache and before next', OPTIONS, () => {
  for (const method of ['GET', 'HEAD']) {
    const { response, writes } = responseFixture({ Vary: 'Origin' });
    Object.defineProperty(response, 'vary', { value: undefined });
    let nextCalls = 0;
    assert.throws(() => fanEngagementPrivacyMiddleware(requestFixture(method, MISSION), response, () => nextCalls++), {
      name: 'TypeError', message: 'Mission-list response requires Vary support',
    });
    assert.equal(nextCalls, 0);
    assert.equal(response.getHeader('Cache-Control'), PRIVATE);
    assert.equal(response.getHeader('Vary'), 'Origin');
    assert.deepEqual(writes, [{ name: 'Cache-Control', value: PRIVATE }]);
  }
});

test('15 a non-function mission Vary member cannot silently pass through', OPTIONS, () => {
  for (const value of [null, 'Authorization', {}]) {
    const { response } = responseFixture({ Vary: 'Origin' });
    Object.defineProperty(response, 'vary', { value });
    let nextCalls = 0;
    assert.throws(() => fanEngagementPrivacyMiddleware(requestFixture('GET', MISSION), response, () => nextCalls++), {
      name: 'TypeError', message: 'Mission-list response requires Vary support',
    });
    assert.equal(nextCalls, 0);
    assert.equal(response.getHeader('Cache-Control'), PRIVATE);
    assert.equal(response.getHeader('Vary'), 'Origin');
  }
});

test('16 a real Express Vary write failure propagates without calling next', OPTIONS, () => {
  const { response, writes } = responseFixture({ Vary: 'Origin' });
  assert.equal(response.vary, express.response.vary);
  const setHeader = response.setHeader;
  const error = new Error('QA_VARY_WRITE_FAILED');
  response.setHeader = (name, value) => {
    if (name.toLowerCase() === 'vary') throw error;
    setHeader(name, value);
  };
  let nextCalls = 0;
  assert.throws(() => fanEngagementPrivacyMiddleware(requestFixture('GET', MISSION), response, () => nextCalls++),
    value => value === error);
  assert.equal(nextCalls, 0);
  assert.equal(response.getHeader('Cache-Control'), PRIVATE);
  assert.equal(response.getHeader('Vary'), 'Origin');
  assert.deepEqual(writes, [{ name: 'Cache-Control', value: PRIVATE }]);
});
