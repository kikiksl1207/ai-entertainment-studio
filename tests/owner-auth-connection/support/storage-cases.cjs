"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ReadableStream } = require("node:stream/web");
const { TextEncoder, TextDecoder } = require("node:util");
const { setImmediate } = require("node:timers");
const { loadSubject } = require("./subject.cjs");

for (const name of ["EventTarget", "Event", "AbortController", "AbortSignal", "Uint8Array", "Promise"]) {
  assert.equal(typeof globalThis[name], "function", `native ${name} required`);
}
assert.equal(globalThis.ReadableStream, ReadableStream);
assert.equal(globalThis.TextEncoder, TextEncoder);
assert.equal(globalThis.TextDecoder, TextDecoder);

const AUTH_KEY = "lumina_auth";
const ENDPOINT = "https://api.lumina-stage.com/api/v1/auth/refresh";
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OLD_ACCESS = "access.storage-old-A";
const OLD_REFRESH = "refresh.storage-old-A";
const NEW_ACCESS = "access.storage-new-A";
const NEW_REFRESH = "refresh.storage-new-A";
const USER = Object.freeze({ id: OWNER.toUpperCase(), userId: OWNER, name: "Synthetic storage owner A" });
const RAW_OLD = JSON.stringify({ accessToken: OLD_ACCESS, refreshToken: OLD_REFRESH, user: USER });
const RAW_NEXT = JSON.stringify({ accessToken: NEW_ACCESS, refreshToken: NEW_REFRESH, user: USER });
const BODY_TEXT = JSON.stringify({ user: USER, tokenType: "Bearer",
  accessToken: NEW_ACCESS, access_token: NEW_ACCESS, refreshToken: NEW_REFRESH, refresh_token: NEW_REFRESH,
  tokens: { tokenType: "Bearer", accessToken: NEW_ACCESS, refreshToken: NEW_REFRESH } });
const OPTIONS = Object.freeze({ timeout: 3000, concurrency: false });
const COUNTERS = Object.freeze([
  Object.freeze({ id: "STORAGE1", name: "native complete-stream positive", hookRead: null,
    result: true, writes: 1, mutations: 1, events: 1, raw: RAW_NEXT }),
  Object.freeze({ id: "STORAGE2", name: "getter read12 disposal forbids SET", hookRead: 12,
    result: false, writes: 0, mutations: 0, events: 0, raw: RAW_OLD }),
  Object.freeze({ id: "STORAGE3", name: "postwrite getter read13 disposal forbids publication", hookRead: 13,
    result: false, writes: 1, mutations: 1, events: 0, raw: RAW_NEXT }),
]);

function rawLabel(value) {
  return value === RAW_OLD ? "initial" : value === RAW_NEXT ? "rotated" : "other";
}

function fixture(subject) {
  const window = new EventTarget();
  const entries = new Map([[AUTH_KEY, RAW_OLD]]);
  const nativeReads = [];
  const trace = {
    storageReads: 0, readLog: [], setCalls: 0, mutations: 0, writeLog: [],
    rollbackWrites: 0, removeCalls: 0, clearCalls: 0, wrongReceiver: 0,
    hookHits: 0, hook: null, arm: null, disposeFromHook: 0,
    fetchCalls: 0, requests: [], startEvents: 0, authChangeEvents: 0,
    nativeEventChecks: [], notifications: [], nativeStreams: 0, chunksEnqueued: 0,
    enqueuedBytes: 0, closeCalls: 0, readerGets: 0, bodyReads: 0,
    nativeReadPromises: [], readerCancels: 0, bodyCancels: 0, underlyingCancels: 0,
    releases: 0, abortEvents: 0, modalCalls: 0, logoutCalls: 0,
  };
  let client, armed = false, targetRead = null, stream;
  const connectedCount = () => trace.notifications.filter(state => state.phase === "connected").length;
  const storage = {
    getItem(key) {
      if (this !== storage) trace.wrongReceiver++;
      const capturedRaw = entries.has(key) ? entries.get(key) : null;
      const ordinal = ++trace.storageReads;
      const entry = { ordinal, key, captured: rawLabel(capturedRaw), setsAtEntry: trace.setCalls,
        mutationsAtEntry: trace.mutations, hook: false, returned: null };
      trace.readLog.push(entry);
      if (armed && ordinal === targetRead) {
        armed = false;
        entry.hook = true;
        trace.hookHits++;
        const hook = trace.hook = { ordinal, writesAtHook: trace.setCalls, mutationsAtHook: trace.mutations,
          captured: rawLabel(capturedRaw), readsBeforeDispose: trace.storageReads,
          eventsBeforeDispose: trace.authChangeEvents, connectedBeforeDispose: connectedCount() };
        trace.disposeFromHook++;
        client.dispose();
        hook.readsAfterDispose = trace.storageReads;
        hook.writesAfterDispose = trace.setCalls;
        hook.mutationsAfterDispose = trace.mutations;
        hook.eventsAfterDispose = trace.authChangeEvents;
        hook.connectedAfterDispose = connectedCount();
        hook.returned = rawLabel(capturedRaw);
      }
      // Return the entry-time snapshot, including rotated raw at read13; never write here.
      entry.returned = rawLabel(capturedRaw);
      return capturedRaw;
    },
    setItem(key, value) {
      if (this !== storage) trace.wrongReceiver++;
      trace.setCalls++;
      trace.writeLog.push({ key, value });
      if (key === AUTH_KEY && value === RAW_OLD) trace.rollbackWrites++;
      entries.set(String(key), String(value));
      trace.mutations++;
    },
    removeItem(key) { trace.removeCalls++; entries.delete(key); },
    clear() { trace.clearCalls++; entries.clear(); },
  };

  function makeResponse() {
    const bytes = new TextEncoder().encode(BODY_TEXT);
    stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        trace.chunksEnqueued++;
        trace.enqueuedBytes += bytes.byteLength;
        controller.close();
        trace.closeCalls++;
      },
      cancel() { trace.underlyingCancels++; },
    }, { highWaterMark: 0 });
    trace.nativeStreams++;
    const getReader = stream.getReader, bodyCancel = stream.cancel;
    Object.defineProperty(stream, "cancel", { value: function (...args) {
      trace.bodyCancels++;
      return Reflect.apply(bodyCancel, this, args);
    } });
    Object.defineProperty(stream, "getReader", { value: function (...args) {
      trace.readerGets++;
      const reader = Reflect.apply(getReader, this, args);
      const read = reader.read, cancel = reader.cancel, release = reader.releaseLock;
      Object.defineProperty(reader, "read", { value: function (...readArgs) {
        trace.bodyReads++;
        const promise = Reflect.apply(read, this, readArgs);
        nativeReads.push(promise);
        trace.nativeReadPromises.push(Object.getPrototypeOf(promise) === Promise.prototype);
        return promise;
      } });
      Object.defineProperty(reader, "cancel", { value: function (...cancelArgs) {
        trace.readerCancels++;
        return Reflect.apply(cancel, this, cancelArgs);
      } });
      Object.defineProperty(reader, "releaseLock", { value: function (...releaseArgs) {
        trace.releases++;
        return Reflect.apply(release, this, releaseArgs);
      } });
      return reader;
    } });
    return { status: 200, redirected: false, headers: { get(name) {
      if (name === "content-type") return "application/json; charset=utf-8";
      if (name === "content-length") return String(bytes.byteLength);
      return null;
    } }, body: stream };
  }

  window.localStorage = storage;
  window.fetch = (url, init) => {
    trace.fetchCalls++;
    trace.requests.push({ url, method: init?.method, credentials: init?.credentials, redirect: init?.redirect,
      cache: init?.cache, referrerPolicy: init?.referrerPolicy, headers: { ...init?.headers },
      body: init?.body, signal: init?.signal });
    init?.signal?.addEventListener("abort", () => { trace.abortEvents++; }, { once: true });
    // Fixed synthetic reply only. Never delegate to global fetch or any real transport.
    return Promise.resolve(makeResponse());
  };
  window.showLoginModal = window.openLoginModal = () => { trace.modalCalls++; };
  window.clearAuth = window.logout = () => { trace.logoutCalls++; };
  const onStart = event => { trace.startEvents++; trace.nativeEventChecks.push(event instanceof Event); };
  const onAuthChange = event => { trace.authChangeEvents++; trace.nativeEventChecks.push(event instanceof Event); };
  window.addEventListener("creator:approved-auth-connection-start", onStart);
  window.addEventListener("lumina:authchange", onAuthChange);
  subject.install(window);
  assert.ok(Object.isFrozen(window.LuminaCreatorApprovedAuthConnection));
  client = window.LuminaCreatorApprovedAuthConnection.create({ storage, eventTarget: window, deadlineMs: 80,
    onChange(state) {
      trace.notifications.push({ phase: state.phase, canConnect: state.canConnect, frozen: Object.isFrozen(state) });
    } });
  assert.ok(Object.isFrozen(client));

  return { client, trace, nativeReads, stream: () => stream, raw: () => entries.get(AUTH_KEY),
    arm(readOrdinal) {
      assert.equal(trace.arm, null, "arm once per fresh private fixture");
      trace.arm = { reads: trace.storageReads, sets: trace.setCalls, mutations: trace.mutations,
        notifications: trace.notifications.length, fetches: trace.fetchCalls, targetRead: readOrdinal };
      targetRead = readOrdinal;
      armed = true;
    },
    cleanup() {
      client.dispose();
      window.removeEventListener("creator:approved-auth-connection-start", onStart);
      window.removeEventListener("lumina:authchange", onAuthChange);
    },
  };
}

async function drain() {
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

function diagnostic(profile, counter, h, result, readResults) {
  const tr = h.trace;
  return { profile: profile.id, sourceSha256: profile.sha256, counter: counter.id,
    status: "OBSERVATION_NOT_EXPECTED_RED", result, arm: tr.arm, storageReads: tr.storageReads,
    reads: tr.readLog, hookHits: tr.hookHits, hook: tr.hook, disposeFromHook: tr.disposeFromHook,
    effects: { fetches: tr.fetchCalls, starts: tr.startEvents, sets: tr.setCalls, mutations: tr.mutations,
      writes: tr.writeLog.map(write => ({ key: write.key, value: rawLabel(write.value) })),
      authChanges: tr.authChangeEvents,
      connectedNotifications: tr.notifications.filter(state => state.phase === "connected").length,
      rollbackWrites: tr.rollbackWrites, finalRaw: rawLabel(h.raw()), notifications: tr.notifications,
      removes: tr.removeCalls, clears: tr.clearCalls, modals: tr.modalCalls, logouts: tr.logoutCalls },
    stream: { nativeStreams: tr.nativeStreams, chunksEnqueued: tr.chunksEnqueued, enqueuedBytes: tr.enqueuedBytes,
      closeCalls: tr.closeCalls, readerGets: tr.readerGets, bodyReads: tr.bodyReads,
      nativeReadPromises: tr.nativeReadPromises, returnedDone: readResults.map(value => value.done),
      bodyCancels: tr.bodyCancels, readerCancels: tr.readerCancels, underlyingCancels: tr.underlyingCancels,
      releases: tr.releases, aborts: tr.abortEvents } };
}

function qualify(counter, h, pending, readResults) {
  const tr = h.trace;
  assert.equal(Object.getPrototypeOf(pending), Promise.prototype, "native connect Promise");
  assert.deepEqual(tr.arm, { reads: 0, sets: 0, mutations: 0, notifications: 0, fetches: 0,
    targetRead: counter.hookRead }, "FIXTURE: no pre-arm state/sync/onChange/fetch/storage work");
  assert.equal(tr.wrongReceiver, 0, "FIXTURE: real storage method receiver");
  assert.ok(tr.readLog.every((entry, index) => entry.ordinal === index + 1 && entry.key === AUTH_KEY &&
    entry.returned === entry.captured), "FIXTURE: actual consecutive getter calls return entry-time snapshots");
  assert.equal(tr.readLog.length, tr.storageReads);
  assert.equal(tr.fetchCalls, 1, "FIXTURE: exactly one fake POST");
  assert.equal(tr.requests.length, 1);
  const request = tr.requests[0];
  assert.equal(request.url, ENDPOINT);
  assert.equal(request.method, "POST");
  assert.equal(request.credentials, "omit");
  assert.equal(request.redirect, "error");
  assert.equal(request.cache, "no-store");
  assert.equal(request.referrerPolicy, "no-referrer");
  assert.deepEqual(request.headers, { "Content-Type": "application/json", Accept: "application/json" });
  assert.equal(request.body, JSON.stringify({ refreshToken: OLD_REFRESH }));
  assert.ok(request.signal instanceof AbortSignal);
  assert.equal(tr.startEvents, 1);
  assert.ok(tr.nativeEventChecks.every(Boolean));
  assert.ok(h.stream() instanceof ReadableStream);
  assert.equal(tr.nativeStreams, 1);
  assert.equal(tr.chunksEnqueued, 1);
  assert.equal(tr.enqueuedBytes, new TextEncoder().encode(BODY_TEXT).byteLength);
  assert.equal(tr.closeCalls, 1, "FIXTURE: ordinary native EOF, no forced deadline");
  assert.equal(tr.readerGets, 1);
  assert.equal(tr.bodyReads, 2);
  assert.deepEqual(tr.nativeReadPromises, [true, true]);
  assert.equal(readResults.length, 2);
  assert.equal(readResults[0].done, false);
  assert.ok(readResults[0].value instanceof Uint8Array);
  assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(readResults[0].value), BODY_TEXT);
  assert.deepEqual(readResults[1], { value: undefined, done: true });
  assert.equal(tr.abortEvents, 1, "product abort/finally only");
  assert.equal(tr.releases, 1);
  assert.equal(tr.hookHits, counter.hookRead === null ? 0 : 1);
  assert.equal(tr.disposeFromHook, counter.hookRead === null ? 0 : 1);
  if (counter.hookRead === null) {
    assert.equal(tr.hook, null);
    assert.ok(tr.readLog.every(entry => entry.hook === false));
  } else {
    // Qualify by the independently counted getter ordinal BEFORE checking writesAtHook.
    assert.equal(tr.hook.ordinal, counter.hookRead, "FIXTURE: actual read12/read13 hook hit");
    assert.equal(tr.storageReads, counter.hookRead, "FIXTURE: no shifted read path");
    assert.deepEqual(tr.readLog.filter(entry => entry.hook).map(entry => entry.ordinal), [counter.hookRead]);
    const beforeWrites = counter.hookRead === 12 ? 0 : 1;
    const captured = counter.hookRead === 12 ? "initial" : "rotated";
    assert.deepEqual(tr.hook, { ordinal: counter.hookRead, writesAtHook: beforeWrites,
      mutationsAtHook: beforeWrites, captured, readsBeforeDispose: counter.hookRead,
      eventsBeforeDispose: 0, connectedBeforeDispose: 0, readsAfterDispose: counter.hookRead,
      writesAfterDispose: beforeWrites, mutationsAfterDispose: beforeWrites,
      eventsAfterDispose: 0, connectedAfterDispose: 0, returned: captured },
    "FIXTURE: dispose inside getter; handler neither reads again nor mutates/publishes");
  }
}

function correctness(counter, h, result) {
  const tr = h.trace;
  // Profile selects source only; all correctness expectations depend solely on the counter.
  assert.equal(result, counter.result, "CORRECTNESS: connect result alone is not enough");
  assert.equal(tr.setCalls, counter.writes, "SAFETY: read12 disposal must not invoke SET");
  assert.equal(tr.mutations, counter.mutations, "SAFETY: only read13's prior mutation is permitted");
  assert.equal(tr.authChangeEvents, counter.events, "SAFETY: no authchange after getter disposal");
  assert.equal(h.raw(), counter.raw, "SAFETY: no destructive clear or rollback of rotated raw");
  assert.equal(tr.writeLog.length, counter.writes);
  assert.ok(tr.writeLog.every(write => write.key === AUTH_KEY && write.value === RAW_NEXT));
  assert.equal(tr.rollbackWrites, 0);
  assert.equal(tr.removeCalls, 0);
  assert.equal(tr.clearCalls, 0);
  assert.equal(tr.modalCalls, 0);
  assert.equal(tr.logoutCalls, 0);
  assert.ok(tr.notifications.every(state => state.frozen));
  const connected = tr.notifications.filter(state => state.phase === "connected").length;
  const last = tr.notifications.at(-1);
  assert.ok(last, "product must notify");
  if (counter.hookRead === null) {
    assert.ok(connected > 0, "POSITIVE: always reject is not a safe implementation");
    assert.deepEqual(last, { phase: "connected", canConnect: false, frozen: true });
  } else {
    assert.equal(connected, 0, "SAFETY: no connected notification after getter disposal");
    assert.deepEqual(last, { phase: "disposed", canConnect: false, frozen: true });
  }
}

function registerStorageCases(profile) {
  // Whole-IIFE admission and compilation are outside all product assertions/catches.
  const subject = loadSubject(profile);
  for (const counter of COUNTERS) {
    test(`${counter.id} ${profile.id}: ${counter.name}`, OPTIONS, async t => {
      const h = fixture(subject);
      t.after(() => h.cleanup());
      h.arm(counter.hookRead);
      const pending = h.client.connect(true);
      const result = await pending;
      await drain();
      // Observe saved native read results only after connect and its continuations drain.
      const readResults = [];
      for (const promise of h.nativeReads) readResults.push(await promise);
      t.diagnostic(JSON.stringify(diagnostic(profile, counter, h, result, readResults)));
      qualify(counter, h, pending, readResults);
      correctness(counter, h, result);
    });
  }
}

module.exports = Object.freeze({ registerStorageCases });
