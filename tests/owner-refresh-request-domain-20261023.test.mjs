import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const AUTH_KEY = 'lumina_auth';
const OWNER = '11111111-1111-4111-8111-111111111111';
const ENDPOINT = 'https://api.lumina-stage.com/api/v1/auth/refresh';

function auth(refreshToken, accessToken = 'a') {
  return { user: { id: OWNER }, accessToken, refreshToken };
}

function canonical200(refreshToken, accessToken, trace) {
  const bytes = new TextEncoder().encode(JSON.stringify({
    user: { id: OWNER }, tokenType: 'Bearer', accessToken, refreshToken,
    tokens: { tokenType: 'Bearer', accessToken, refreshToken },
  }));
  let delivered = false;
  return {
    status: 200,
    redirected: false,
    headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json' : null },
    body: {
      cancel() { ++trace.bodyCancels; return Promise.resolve(); },
      getReader() {
        ++trace.readers;
        return {
          async read() {
            ++trace.reads;
            if (delivered) return { done: true };
            delivered = true;
            ++trace.chunks;
            return { done: false, value: bytes };
          },
          cancel() { ++trace.readerCancels; return Promise.resolve(); },
          releaseLock() { ++trace.releases; },
        };
      },
    },
  };
}

function responseTrace() {
  return { readers: 0, reads: 0, chunks: 0, bodyCancels: 0, readerCancels: 0, releases: 0 };
}

function consumed(trace, label) {
  assert.deepEqual(trace, {
    readers: 1, reads: 2, chunks: 1, bodyCancels: 0, readerCancels: 1, releases: 1,
  }, `${label}: canonical chunk, done, reader cleanup`);
}

// Fixture storage and events are isolated by makeContext below.
async function withAuth({ api, makeContext }, value, exercise, responseFactory = () => ({ status: 401 })) {
  const raw = JSON.stringify(value);
  const context = makeContext({ raw });
  const calls = [];
  const pending = [];
  const events = { authchange: 0 };
  const authChanged = () => { ++events.authchange; };
  let connection;
  try {
    context.eventTarget.addEventListener('lumina:authchange', authChanged);
    connection = api.create({
      storage: context.storage,
      eventTarget: context.eventTarget,
      fetch: async (url, init) => {
        calls.push({ url, init });
        return responseFactory();
      },
    });
    const connect = confirmed => {
      const result = connection.connect(confirmed);
      pending.push(result);
      return result;
    };
    const unchanged = label => {
      assert.equal(context.storage.getItem(AUTH_KEY), raw, `${label}: stored auth unchanged`);
      assert.equal(context.writes.length, 0, `${label}: no storage writes`);
    };
    await exercise({ connection, connect, calls, unchanged, context, events });
  } finally {
    try {
      connection?.dispose();
    } finally {
      try {
        await Promise.allSettled(pending);
      } finally {
        try {
          context.eventTarget.removeEventListener('lumina:authchange', authChanged);
        } finally {
          calls.length = 0;
          pending.length = 0;
          await context.cleanup();
        }
      }
    }
  }
}

async function refuses(env, label, value) {
  await withAuth(env, value, async ({ connection, connect, calls, unchanged }) => {
    assert.equal(connection.state().canConnect, false, `${label}: unavailable before submission`);
    assert.equal(calls.length, 0, `${label}: no implicit request`);
    assert.equal(await connect(true), false, `${label}: explicit request refused`);
    assert.equal(calls.length, 0, `${label}: refused before fetch`);
    assert.equal(connection.state().canConnect, false, `${label}: remains unavailable`);
    unchanged(label);
  });
}

async function run({ api, makeContext }) {
  const env = { api, makeContext };

  await test('G1: out-of-domain request and rotated-response refresh are refused', { concurrency: false }, async () => {
    for (const length of [19, 4097]) {
      const label = `request refresh length ${length}`;
      await withAuth(env, auth('r'.repeat(length)), async ({ connection, connect, calls, unchanged }) => {
        const initialCanConnect = connection.state().canConnect;
        const result = await connect(true);
        // Submit before the first assertion so baseline evidence includes its stub send.
        assert.equal(calls.length, 0, `${label}: refused before fetch`);
        assert.equal(initialCanConnect, false, `${label}: initially unavailable`);
        assert.equal(result, false, `${label}: explicit request refused`);
        assert.equal(connection.state().canConnect, false, `${label}: remains unavailable`);
        unchanged(label);
      });
    }
    for (const length of [19, 4097]) {
      const label = `response refresh length ${length}`;
      const value = auth('r'.repeat(20));
      const trace = responseTrace();
      await withAuth(env, value, async ({ connection, connect, calls, unchanged, events }) => {
        assert.deepEqual(connection.state(), { phase: 'idle', canConnect: true }, `${label}: valid request input`);
        const result = await connect(true);
        assert.equal(calls.length, 1, `${label}: invoked once`);
        assert.equal(result, false, `${label}: invalid rotated refresh refused`);
        assert.deepEqual(connection.state(), { phase: 'uncertain', canConnect: false }, `${label}: uncertain, not connected`);
        unchanged(label);
        assert.equal(events.authchange, 0, `${label}: no committed-auth event`);
        consumed(trace, label);
        assert.equal(await connect(true), false, `${label}: no resend after uncertainty`);
        assert.equal(calls.length, 1, `${label}: no second send`);
        unchanged(label);
      }, () => canonical200('s'.repeat(length), value.accessToken, trace));
    }
  });

  await test('G2: valid request rejection and rotated-response connection boundaries', { concurrency: false }, async () => {
    for (const [length, accessLength] of [[20, 1], [4096, 8192]]) {
      const label = `refresh length ${length}, access length ${accessLength}`;
      const refresh = 'r'.repeat(length);
      const value = {
        ...auth(refresh, 'a'.repeat(accessLength)),
        refresh_token: refresh,
        tokens: { refreshToken: refresh, refresh_token: refresh },
      };
      await withAuth(env, value, async ({ connection, connect, calls, unchanged }) => {
        const initial = { phase: 'idle', canConnect: true };
        assert.deepEqual(connection.state(), initial, `${label}: valid initial state`);
        assert.equal(calls.length, 0, `${label}: state does not send`);
        assert.equal(await connect(false), false, `${label}: confirmation required`);
        assert.deepEqual(connection.state(), initial, `${label}: false preserves state`);
        assert.equal(calls.length, 0, `${label}: false does not send`);
        unchanged(label);

        // Invoke the duplicate synchronously, while the first request is active.
        const first = connect(true);
        const duplicate = connect(true);
        assert.equal(calls.length, 1, `${label}: one in-flight stub request`);
        assert.equal(await duplicate, false, `${label}: active duplicate refused`);
        assert.equal(await first, false, `${label}: stub 401 returns false`);
        assert.deepEqual(connection.state(), { phase: 'rejected', canConnect: false }, `${label}: rejected, not connected`);
        assert.equal(calls.length, 1, `${label}: no automatic retry`);
        assert.equal(calls[0].url, ENDPOINT, `${label}: fixed refresh endpoint`);
        assert.equal(calls[0].init.method, 'POST', `${label}: explicit POST`);
        assert.equal(calls[0].init.body, JSON.stringify({ refreshToken: refresh }), `${label}: exact refresh-only payload`);
        assert.equal(calls[0].init.credentials, 'omit', `${label}: no ambient credentials`);
        assert.equal(calls[0].init.redirect, 'error', `${label}: no redirect following`);
        assert.equal(calls[0].init.cache, 'no-store', `${label}: no request caching`);
        assert.equal(await connect(true), false, `${label}: same auth cannot resend after rejection`);
        assert.equal(calls.length, 1, `${label}: exactly one request in total`);
        unchanged(label);
      });
    }
    for (const [length, accessLength] of [[20, 1], [4096, 8192]]) {
      const label = `response refresh length ${length}, identical access length ${accessLength}`;
      const value = auth('r'.repeat(20), 'a'.repeat(accessLength));
      const refresh = 's'.repeat(length);
      const trace = responseTrace();
      await withAuth(env, value, async ({ connection, connect, calls, context, events }) => {
        assert.deepEqual(connection.state(), { phase: 'idle', canConnect: true }, `${label}: valid initial state`);
        assert.equal(await connect(true), true, `${label}: canonical response connects`);
        assert.deepEqual(connection.state(), { phase: 'connected', canConnect: false }, `${label}: connected`);
        assert.equal(await connect(true), false, `${label}: committed auth cannot resend`);
        assert.equal(calls.length, 1, `${label}: exactly one invocation`);
        assert.equal(calls[0].init.body, JSON.stringify({ refreshToken: value.refreshToken }), `${label}: original refresh submitted`);
        assert.equal(context.writes.length, 1, `${label}: one memory commit, no rollback`);
        assert.equal(context.storage.getItem(AUTH_KEY), JSON.stringify({
          accessToken: value.accessToken, refreshToken: refresh, user: value.user,
        }), `${label}: exact rotated commit accepts unchanged access`);
        assert.equal(events.authchange, 1, `${label}: authchange exactly once`);
        consumed(trace, label);
      }, () => canonical200(refresh, value.accessToken, trace));
    }
  });

  await test('G3: malformed inputs and conflicting aliases remain pre-fetch refusals', { concurrency: false }, async () => {
    const refresh = 'r'.repeat(20);
    for (const [label, value] of [
      ['missing refresh', undefined], ['null refresh', null], ['numeric refresh', 20],
      ['boolean refresh', true], ['object refresh', { value: refresh }],
      ['array refresh', [refresh]], ['empty refresh', ''],
      ['leading whitespace', ` ${refresh}`], ['trailing whitespace', `${refresh} `],
      ['invalid lexical character', `${'r'.repeat(19)}!`],
    ]) {
      await refuses(env, label, auth(value));
    }
    const base = auth(refresh);
    for (const [label, value] of [
      ['snake refresh conflict', { ...base, refresh_token: 's'.repeat(20) }],
      ['nested camel refresh conflict', { ...base, tokens: { refreshToken: 's'.repeat(20) } }],
      ['nested snake refresh conflict', { ...base, tokens: { refresh_token: 's'.repeat(20) } }],
      ['nonstring alias alongside valid refresh', { ...base, refresh_token: 20 }],
      ['nonstring canonical alongside valid alias', { ...base, refreshToken: 20, refresh_token: refresh }],
      ['missing access', { ...base, accessToken: undefined }],
      ['nonstring access', { ...base, accessToken: 1 }],
      ['access alias conflict', { ...base, access_token: 'b' }],
      ['missing owner', { ...base, user: undefined }],
      ['nonstring owner', { ...base, user: { id: 1 } }],
      ['owner alias conflict', { ...base, user: { id: OWNER, userId: 'not-an-owner' } }],
    ]) {
      await refuses(env, label, value);
    }
  });
}

const require = createRequire(import.meta.url);
const source = fileURLToPath(new URL('../pages/creator-approved-auth-connection.js', import.meta.url));
const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
const contexts = new Set();
const inertStore = () => ({ getItem: () => null, setItem: () => { throw Error('AMBIENT_WRITE'); } });
const makeContext = ({ raw }) => {
  const values = new Map([['lumina_auth', raw]]), writes = [], listeners = [];
  const native = new EventTarget();
  const eventTarget = {
    addEventListener(type, listener) { listeners.push([type, listener]); native.addEventListener(type, listener); },
    removeEventListener(type, listener) { native.removeEventListener(type, listener); },
    dispatchEvent(event) { return native.dispatchEvent(event); }
  };
  const context = {
    storage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { writes.push({ key, value }); values.set(key, value); }
    }, eventTarget, writes,
    cleanup() {
      for (const [type, listener] of listeners) native.removeEventListener(type, listener);
      listeners.length = 0; values.clear(); writes.length = 0; contexts.delete(context);
    }
  };
  contexts.add(context);
  return context;
};
let sourceCacheKey;
try {
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true,
    value: { localStorage: inertStore(), sessionStorage: inertStore() } });
  sourceCacheKey = require.resolve(source);
  delete require.cache[sourceCacheKey];
  require(source);
  const api = globalThis.window.LuminaCreatorApprovedAuthConnection;
  assert.equal(typeof api?.create, 'function');
  await run({ api, makeContext });
  assert.equal(contexts.size, 0, 'UNCLOSED_CONTEXT');
} finally {
  try {
    for (const context of contexts) context.cleanup();
  } finally {
    try {
      if (sourceCacheKey) delete require.cache[sourceCacheKey];
    } finally {
      if (prior) Object.defineProperty(globalThis, 'window', prior);
      else delete globalThis.window;
    }
  }
}
