"use strict";

const assert = require("node:assert/strict");
const { ReadableStream } = require("node:stream/web");
const { TextDecoder, TextEncoder } = require("node:util");
const { setImmediate } = require("node:timers");

for (const name of ["EventTarget", "Event", "AbortController", "AbortSignal", "Uint8Array", "Promise"]) {
  assert.equal(typeof globalThis[name], "function", `native ${name} required`);
}
assert.equal(globalThis.TextDecoder, TextDecoder);
assert.equal(globalThis.TextEncoder, TextEncoder);
assert.equal(globalThis.ReadableStream, ReadableStream);

const AUTH_KEY = "lumina_auth";
const ENDPOINT = "https://api.lumina-stage.com/api/v1/auth/refresh";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OLD_ACCESS = "access.old-A";
const OLD_REFRESH = "refresh.old-A";
const NEW_ACCESS = "access.new-A";
const NEW_REFRESH = "refresh.new-A";
const OPTIONS = Object.freeze({ timeout: 3000, concurrency: false });

function initialAuth(id = A) {
  return JSON.stringify({ user: { id: id.toUpperCase(), userId: id },
    accessToken: OLD_ACCESS, access_token: OLD_ACCESS, token: OLD_ACCESS,
    refreshToken: OLD_REFRESH, refresh_token: OLD_REFRESH,
    tokens: { accessToken: OLD_ACCESS, access_token: OLD_ACCESS,
      refreshToken: OLD_REFRESH, refresh_token: OLD_REFRESH } });
}

function validReply() {
  return { user: { id: A.toUpperCase(), userId: A, name: "Synthetic owner A" },
    tokenType: "Bearer", accessToken: NEW_ACCESS, access_token: NEW_ACCESS,
    refreshToken: NEW_REFRESH, refresh_token: NEW_REFRESH,
    tokens: { tokenType: "Bearer", accessToken: NEW_ACCESS, refreshToken: NEW_REFRESH } };
}

const RAW_A = initialAuth();
const RAW_B = initialAuth(B);
const NEXT_A = JSON.stringify({ accessToken: NEW_ACCESS, refreshToken: NEW_REFRESH, user: validReply().user });

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

async function flushLateWork() {
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

function harness(subject, options = {}) {
  const window = new EventTarget();
  const entries = new Map();
  const originalRaw = options.raw === undefined ? RAW_A : options.raw;
  if (originalRaw !== null) entries.set(AUTH_KEY, originalRaw);
  const trace = {
    nativeFetchInvoked: 0, suppliedFetchInvoked: 0, getInvoked: 0, requests: [],
    storageGetInvoked: 0, storageSetInvoked: 0, localCommits: 0,
    rollbackWrites: 0, externalWrites: 0, writeAttempts: [],
    removeInvoked: 0, clearInvoked: 0, modalInvoked: 0, logoutInvoked: 0,
    startEvents: 0, authChangeEvents: 0, nativeEventChecks: [], notifications: [],
    fakeResponsesIssued: 0, syntheticValidRotationFixtureIssued: 0,
    nativeStreams: 0, enqueuedBytes: 0, getReaderInvoked: 0, readInvoked: 0,
    nativeReadPromises: [], readerCancelInvoked: 0, bodyCancelInvoked: 0,
    underlyingCancelInvoked: 0, cancelEntries: [], releaseLockInvoked: 0,
    abortEvents: 0, abortEntries: [], lateEnqueueAttempts: 0,
  };
  const fetchWait = deferred();
  let streamController;
  let responseBytes;
  let streamClosed = true;
  const pendingEOF = () => options.mode === "pending-eof" && !streamClosed && trace.readInvoked === 2;
  const controls = {
    trace, window, stream: null, nativeReads: [],
    raw: () => entries.has(AUTH_KEY) ? entries.get(AUTH_KEY) : null,
    replaceAuth(raw) {
      trace.externalWrites++;
      if (raw === null) entries.delete(AUTH_KEY);
      else entries.set(AUTH_KEY, raw);
    },
    emit(name, key) {
      const event = new Event(name);
      if (name === "storage") Object.defineProperty(event, "key", { value: key });
      return window.dispatchEvent(event);
    },
    releaseFetch() { fetchWait.resolve(makeReply()); },
    enqueueLateValid() {
      trace.lateEnqueueAttempts++;
      streamController.enqueue(responseBytes);
    },
  };
  const storage = {
    getItem(key) {
      trace.storageGetInvoked++;
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      trace.storageSetInvoked++;
      trace.writeAttempts.push({ key, value });
      if (key === AUTH_KEY && value === originalRaw) trace.rollbackWrites++;
      if (options.storageFault === "before") throw new Error("synthetic setItem before mutation");
      entries.set(String(key), String(value));
      trace.localCommits++;
      if (options.storageFault === "after") throw new Error("synthetic setItem after mutation");
      if (options.storageFault === "interpose") controls.replaceAuth(RAW_B);
    },
    removeItem(key) { trace.removeInvoked++; entries.delete(key); },
    clear() { trace.clearInvoked++; entries.clear(); },
  };

  function makeReply() {
    trace.fakeResponsesIssued++;
    if (options.rotatedFixture !== false) trace.syntheticValidRotationFixtureIssued++;
    responseBytes = new TextEncoder().encode(JSON.stringify(options.data === undefined ? validReply() : options.data));
    streamClosed = false;
    const body = new ReadableStream({
      start(controller) {
        streamController = controller;
        if (options.mode !== "stalled-stream") {
          controller.enqueue(responseBytes);
          trace.enqueuedBytes += responseBytes.byteLength;
        }
        if (options.mode !== "pending-eof" && options.mode !== "stalled-stream") {
          controller.close();
          streamClosed = true;
        }
      },
      cancel() {
        trace.underlyingCancelInvoked++;
        streamClosed = true;
      },
    }, { highWaterMark: 0 });
    trace.nativeStreams++;
    controls.stream = body;
    const nativeGetReader = body.getReader;
    const nativeBodyCancel = body.cancel;
    Object.defineProperty(body, "cancel", { value: function (...args) {
      trace.bodyCancelInvoked++;
      return Reflect.apply(nativeBodyCancel, this, args);
    } });
    Object.defineProperty(body, "getReader", { value: function (...args) {
      trace.getReaderInvoked++;
      const reader = Reflect.apply(nativeGetReader, this, args);
      const nativeRead = reader.read;
      const nativeCancel = reader.cancel;
      const nativeReleaseLock = reader.releaseLock;
      Object.defineProperty(reader, "read", { value: function (...readArgs) {
        trace.readInvoked++;
        const promise = Reflect.apply(nativeRead, this, readArgs);
        controls.nativeReads.push(promise);
        trace.nativeReadPromises.push(Object.getPrototypeOf(promise) === Promise.prototype);
        return promise;
      } });
      Object.defineProperty(reader, "cancel", { value: function (...cancelArgs) {
        trace.readerCancelInvoked++;
        trace.cancelEntries.push({ reads: trace.readInvoked, pendingEOF: pendingEOF() });
        return Reflect.apply(nativeCancel, this, cancelArgs);
      } });
      Object.defineProperty(reader, "releaseLock", { value: function (...releaseArgs) {
        trace.releaseLockInvoked++;
        return Reflect.apply(nativeReleaseLock, this, releaseArgs);
      } });
      return reader;
    } });
    return { status: options.status === undefined ? 200 : options.status, redirected: false,
      headers: { get(name) {
        if (name === "content-type") return "application/json; charset=utf-8";
        if (name === "content-length") return options.length === undefined ? String(responseBytes.byteLength) : options.length;
        return null;
      } }, body };
  }

  function fakeFetch(counter) {
    return function (url, init) {
      trace[counter]++;
      const request = { url, method: init?.method, credentials: init?.credentials, redirect: init?.redirect,
        cache: init?.cache, referrerPolicy: init?.referrerPolicy, headers: { ...init?.headers },
        body: init?.body, signal: init?.signal };
      trace.requests.push(request);
      if ((request.method || "GET") === "GET") trace.getInvoked++;
      init?.signal?.addEventListener("abort", () => {
        trace.abortEvents++;
        trace.abortEntries.push({ reads: trace.readInvoked, pendingEOF: pendingEOF() });
      }, { once: true });
      // The adapter ignores abort; only the genuine product deadline cancels its reader.
      if (options.mode === "stalled-fetch") return fetchWait.promise;
      return Promise.resolve(makeReply());
    };
  }

  window.localStorage = storage;
  window.fetch = fakeFetch("nativeFetchInvoked");
  window.showLoginModal = window.openLoginModal = () => { trace.modalInvoked++; };
  window.clearAuth = window.logout = () => { trace.logoutInvoked++; };
  window.addEventListener("creator:approved-auth-connection-start", event => {
    trace.startEvents++;
    trace.nativeEventChecks.push(event instanceof Event);
  });
  window.addEventListener("lumina:authchange", event => {
    trace.authChangeEvents++;
    trace.nativeEventChecks.push(event instanceof Event);
  });
  subject.install(window);
  const factory = window.LuminaCreatorApprovedAuthConnection;
  assert.equal(typeof factory?.create, "function");
  assert.ok(Object.isFrozen(factory));
  const createOptions = { deadlineMs: options.deadlineMs === undefined ? 80 : options.deadlineMs,
    onChange(state) {
      trace.notifications.push({ phase: state.phase, canConnect: state.canConnect });
      if (options.onChange) options.onChange(state, controls);
    } };
  if (options.supplied) createOptions.fetch = fakeFetch("suppliedFetchInvoked");
  controls.client = factory.create(createOptions);
  assert.ok(Object.isFrozen(controls.client));
  return controls;
}

function stateOf(h) {
  const state = h.client.state();
  assert.ok(Object.isFrozen(state));
  return { phase: state.phase, canConnect: state.canConnect };
}

function fetchCount(h) { return h.trace.nativeFetchInvoked + h.trace.suppliedFetchInvoked; }

function noClearOrModal(h) {
  assert.equal(h.trace.removeInvoked, 0);
  assert.equal(h.trace.clearInvoked, 0);
  assert.equal(h.trace.modalInvoked, 0);
  assert.equal(h.trace.logoutInvoked, 0);
  assert.equal(h.trace.getInvoked, 0, "no automatic catalog GET");
}

function effects(h, { fetches, writes, commits, events }) {
  assert.equal(fetchCount(h), fetches);
  assert.equal(h.trace.requests.length, fetches);
  assert.equal(h.trace.storageSetInvoked, writes);
  assert.equal(h.trace.localCommits, commits);
  assert.equal(h.trace.authChangeEvents, events);
  assert.equal(h.trace.rollbackWrites, 0);
  noClearOrModal(h);
}

function assertRequest(h) {
  const request = h.trace.requests[0];
  assert.equal(request.url, ENDPOINT);
  assert.equal(request.method, "POST");
  assert.equal(request.credentials, "omit");
  assert.equal(request.redirect, "error");
  assert.equal(request.cache, "no-store");
  assert.equal(request.referrerPolicy, "no-referrer");
  assert.deepEqual(request.headers, { "Content-Type": "application/json", Accept: "application/json" });
  assert.deepEqual(JSON.parse(request.body), { refreshToken: OLD_REFRESH });
  assert.ok(request.signal instanceof AbortSignal);
}

module.exports = Object.freeze({ A, B, AUTH_KEY, OLD_ACCESS, OLD_REFRESH, NEW_ACCESS, NEW_REFRESH,
  RAW_A, RAW_B, NEXT_A, OPTIONS, validReply, harness, stateOf, fetchCount,
  effects, assertRequest, noClearOrModal, flushLateWork, ReadableStream });
