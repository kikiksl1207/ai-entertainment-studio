"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { performance } = require("node:perf_hooks");
const profile = require("./owner-auth-connection/profiles/v6.cjs");
const { admitSource, loadSubject } = require("./owner-auth-connection/support/subject.cjs");
const fixture = require("./owner-auth-connection/support/fixture.cjs");
const { A, B, AUTH_KEY, OLD_ACCESS, OLD_REFRESH, NEW_ACCESS, NEW_REFRESH,
  RAW_A, RAW_B, NEXT_A, OPTIONS, validReply, stateOf, fetchCount,
  effects, assertRequest, flushLateWork, ReadableStream } = fixture;

const subject = loadSubject(profile);
const harness = options => fixture.harness(subject, options);

test("1 whole-source admission; initial, unconfirmed and invalid auth have no automatic effects", OPTIONS, async t => {
  const source = subject.canonical;
  assert.equal(admitSource(Buffer.from(source), profile), source);
  assert.equal(admitSource(Buffer.from(source.replace(/\n/g, "\r\n")), profile), source);
  assert.throws(() => admitSource(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(source)]), profile));
  assert.throws(() => admitSource(Buffer.from(source.replace("\n", "\r\n")), profile));
  assert.throws(() => admitSource(Buffer.from([0xc3, 0x28]), profile));
  assert.throws(() => admitSource(Buffer.from("x" + source.slice(1)), profile));
  assert.throws(() => admitSource(Buffer.from(source.slice(0, -1)), profile));
  assert.throws(() => admitSource(Buffer.from(source.replace("authKey", "authKez")), profile));
  const h = harness();
  t.after(() => h.client.dispose());
  assert.equal(h.raw(), RAW_A);
  assert.deepEqual(stateOf(h), { phase: "idle", canConnect: true });
  h.client.sync();
  const unconfirmed = h.client.connect(false);
  assert.equal(Object.getPrototypeOf(unconfirmed), Promise.prototype);
  assert.equal(await unconfirmed, false);
  assert.equal(await h.client.connect(), false);
  assert.equal(await h.client.connect("true"), false);
  await flushLateWork();
  assert.equal(h.raw(), RAW_A);
  assert.deepEqual(stateOf(h), { phase: "idle", canConnect: true });
  effects(h, { fetches: 0, writes: 0, commits: 0, events: 0 });
  assert.equal(h.trace.startEvents, 0);
  for (const raw of [null, "{broken", JSON.stringify({ user: { id: "not-a-uuid" },
    accessToken: OLD_ACCESS, refreshToken: OLD_REFRESH })]) {
    const bad = harness({ raw });
    t.after(() => bad.client.dispose());
    assert.deepEqual(stateOf(bad), { phase: "idle", canConnect: false });
    assert.equal(await bad.client.connect(true), false);
    assert.equal(bad.raw(), raw);
    effects(bad, { fetches: 0, writes: 0, commits: 0, events: 0 });
  }
});

test("2 HTTP200/201 positive controls: POST1, same owner/aliases, write1/event1, GET0/repeat0", OPTIONS, async t => {
  for (const [status, supplied] of [[200, false], [200, true], [201, false], [201, true]]) {
    const h = harness({ supplied, status });
    t.after(() => h.client.dispose());
    assert.equal(h.raw(), RAW_A);
    assert.deepEqual(stateOf(h), { phase: "idle", canConnect: true });
    const pending = h.client.connect(true);
    assert.equal(Object.getPrototypeOf(pending), Promise.prototype);
    assert.equal(await pending, true);
    assert.ok(h.stream instanceof ReadableStream);
    assert.equal(h.raw(), NEXT_A);
    assert.deepEqual(stateOf(h), { phase: "connected", canConnect: false });
    effects(h, { fetches: 1, writes: 1, commits: 1, events: 1 });
    assert.equal(h.trace.nativeFetchInvoked, supplied ? 0 : 1);
    assert.equal(h.trace.suppliedFetchInvoked, supplied ? 1 : 0);
    assert.equal(h.trace.syntheticValidRotationFixtureIssued, 1);
    assert.equal(h.trace.startEvents, 1);
    assert.deepEqual(h.trace.nativeEventChecks, [true, true]);
    assert.deepEqual(h.trace.nativeReadPromises, [true, true]);
    assertRequest(h);
    assert.equal(h.trace.requests[0].signal.aborted, true);
    const next = JSON.parse(h.raw());
    assert.equal(next.user.id.toLowerCase(), A);
    assert.equal(next.user.userId, A);
    assert.equal(next.accessToken, NEW_ACCESS);
    assert.equal(next.refreshToken, NEW_REFRESH);
    assert.notEqual(next.refreshToken, OLD_REFRESH);
    h.client.sync();
    await flushLateWork();
    assert.equal(await h.client.connect(true), false);
    effects(h, { fetches: 1, writes: 1, commits: 1, events: 1 });
    assert.equal(h.raw(), NEXT_A);
  }
});

test("3 HTTP401/403 preserve current auth; no clear, modal or additional request", OPTIONS, async t => {
  for (const status of [401, 403]) {
    const h = harness({ status, rotatedFixture: false });
    t.after(() => h.client.dispose());
    assert.equal(h.raw(), RAW_A);
    assert.deepEqual(stateOf(h), { phase: "idle", canConnect: true });
    assert.equal(await h.client.connect(true), false);
    assert.equal(h.raw(), RAW_A);
    assert.deepEqual(stateOf(h), { phase: "rejected", canConnect: false });
    assert.equal(h.trace.getReaderInvoked, 0);
    assert.equal(h.trace.bodyCancelInvoked, 1);
    assert.equal(await h.client.connect(true), false);
    effects(h, { fetches: 1, writes: 0, commits: 0, events: 0 });
  }
});

test("4 exactly four bad-response conditions: owner, alias, missing type, declared length", OPTIONS, async t => {
  const wrongOwner = validReply();
  wrongOwner.user = { id: B, userId: B };
  const wrongAlias = validReply();
  wrongAlias.access_token = "access.conflicting-alias";
  const missingType = validReply();
  delete missingType.tokenType;
  const cases = [
    { name: "wrong owner", data: wrongOwner, expectedReaders: 1 },
    { name: "conflicting alias", data: wrongAlias, expectedReaders: 1 },
    { name: "missing outer tokenType; nested Bearer remains", data: missingType, expectedReaders: 1 },
    { name: "declared content-length 65537", length: "65537", expectedReaders: 0 },
  ];
  assert.equal(cases.length, 4);
  for (const item of cases) {
    const h = harness({ ...item, rotatedFixture: false });
    t.after(() => h.client.dispose());
    assert.deepEqual(stateOf(h), { phase: "idle", canConnect: true }, item.name);
    assert.equal(await h.client.connect(true), false, item.name);
    assert.equal(h.raw(), RAW_A, item.name);
    assert.deepEqual(stateOf(h), { phase: "uncertain", canConnect: false }, item.name);
    assert.equal(h.trace.getReaderInvoked, item.expectedReaders, item.name);
    assert.equal(await h.client.connect(true), false, item.name);
    effects(h, { fetches: 1, writes: 0, commits: 0, events: 0 });
  }
});

test("5 pre-dispatch owner change fetch0; observed in-flight A-B-A late response write0", OPTIONS, async t => {
  let intervened = false;
  const before = harness({ onChange(state, h) {
    if (state.phase === "connecting" && !intervened) {
      intervened = true;
      h.replaceAuth(RAW_B);
      h.client.sync();
    }
  } });
  t.after(() => before.client.dispose());
  assert.deepEqual(stateOf(before), { phase: "idle", canConnect: true });
  assert.equal(await before.client.connect(true), false);
  await flushLateWork();
  assert.equal(intervened, true);
  assert.equal(before.raw(), RAW_B);
  assert.deepEqual(stateOf(before), { phase: "changed", canConnect: true });
  assert.equal(before.trace.startEvents, 0);
  effects(before, { fetches: 0, writes: 0, commits: 0, events: 0 });
  const after = harness({ mode: "stalled-fetch" });
  t.after(() => after.client.dispose());
  const pending = after.client.connect(true);
  assert.equal(fetchCount(after), 1);
  assert.deepEqual(stateOf(after), { phase: "connecting", canConnect: false });
  after.replaceAuth(RAW_B);
  after.client.sync();
  after.replaceAuth(RAW_A);
  after.client.sync();
  assert.equal(await pending, false);
  assert.equal(after.trace.requests[0].signal.aborted, true);
  after.releaseFetch();
  await flushLateWork();
  assert.equal(after.raw(), RAW_A);
  assert.deepEqual(stateOf(after), { phase: "uncertain", canConnect: false });
  assert.equal(await after.client.connect(true), false);
  effects(after, { fetches: 1, writes: 0, commits: 0, events: 0 });
});

test("6 pending duplicate/pagehide: abort, ignore late reply, no new request", OPTIONS, async t => {
  const h = harness({ mode: "stalled-fetch" });
  t.after(() => h.client.dispose());
  assert.equal(h.raw(), RAW_A);
  const pending = h.client.connect(true);
  assert.equal(fetchCount(h), 1);
  assert.deepEqual(stateOf(h), { phase: "connecting", canConnect: false });
  assert.equal(await h.client.connect(true), false);
  assert.equal(fetchCount(h), 1);
  h.emit("pagehide");
  assert.equal(await pending, false);
  assert.equal(h.trace.requests[0].signal.aborted, true);
  assert.equal(h.trace.abortEvents, 1);
  h.releaseFetch();
  await flushLateWork();
  assert.equal(h.raw(), RAW_A);
  assert.deepEqual(stateOf(h), { phase: "disposed", canConnect: false });
  assert.equal(await h.client.connect(true), false);
  effects(h, { fetches: 1, writes: 0, commits: 0, events: 0 });
});

test("7 ignored-abort fetch/stream settle on product deadline; no late mutation", OPTIONS, async t => {
  const deadlineMs = 60;
  for (const mode of ["stalled-fetch", "stalled-stream"]) {
    const h = harness({ mode, deadlineMs });
    t.after(() => h.client.dispose());
    assert.equal(h.raw(), RAW_A);
    assert.deepEqual(stateOf(h), { phase: "idle", canConnect: true });
    const startedMs = performance.now();
    const pending = h.client.connect(true);
    assert.equal(Object.getPrototypeOf(pending), Promise.prototype);
    if (mode === "stalled-stream") {
      await flushLateWork();
      assert.equal(h.trace.readInvoked, 1);
    }
    assert.equal(await pending, false, mode);
    const elapsedMs = performance.now() - startedMs;
    assert.ok(elapsedMs >= deadlineMs - 20, `${mode}: elapsed milliseconds ${elapsedMs}`);
    assert.ok(elapsedMs < 2000, `${mode}: genuine promise did not settle promptly`);
    assert.equal(h.trace.requests[0].signal.aborted, true);
    assert.equal(h.trace.abortEvents, 1);
    assert.equal(h.raw(), RAW_A);
    assert.deepEqual(stateOf(h), { phase: "uncertain", canConnect: false });
    if (mode === "stalled-fetch") {
      assert.equal(h.trace.fakeResponsesIssued, 0);
      h.releaseFetch();
    } else {
      assert.ok(h.stream instanceof ReadableStream);
      assert.equal(h.trace.syntheticValidRotationFixtureIssued, 1);
      assert.equal(h.trace.enqueuedBytes, 0);
      assert.ok(h.trace.readerCancelInvoked >= 1);
      assert.equal(h.trace.underlyingCancelInvoked, 1);
      assert.equal(h.trace.releaseLockInvoked, 1);
      // Native cancel already closes this first-read stall; late enqueue must throw.
      assert.throws(() => h.enqueueLateValid(), TypeError);
      assert.equal(h.trace.lateEnqueueAttempts, 1);
    }
    await flushLateWork();
    assert.equal(h.raw(), RAW_A);
    assert.deepEqual(stateOf(h), { phase: "uncertain", canConnect: false });
    assert.equal(await h.client.connect(true), false);
    effects(h, { fetches: 1, writes: 0, commits: 0, events: 0 });
  }
});

test("8 local commit uncertainty/interposition: rollback0, persistent seal and retry0", OPTIONS, async t => {
  const cases = [
    { name: "setItem throws before mutation", storageFault: "before", commits: 0, rawAfter: RAW_A, events: 0 },
    { name: "setItem mutates then throws", storageFault: "after", commits: 1, rawAfter: NEXT_A, events: 0 },
    { name: "B interposes inside setItem", storageFault: "interpose", commits: 1, rawAfter: RAW_B, events: 0 },
    { name: "B interposes in connected notification", notifyInterpose: true, commits: 1, rawAfter: RAW_B, events: 1 },
  ];
  for (const item of cases) {
    let interposed = false;
    const h = harness({ storageFault: item.storageFault, onChange(state, control) {
      if (item.notifyInterpose && state.phase === "connected" && !interposed) {
        interposed = true;
        control.replaceAuth(RAW_B);
        control.client.sync();
      }
    } });
    t.after(() => h.client.dispose());
    assert.equal(h.raw(), RAW_A, item.name);
    assert.deepEqual(stateOf(h), { phase: "idle", canConnect: true }, item.name);
    assert.equal(await h.client.connect(true), false, item.name);
    assert.equal(h.trace.syntheticValidRotationFixtureIssued, 1, item.name);
    assert.equal(h.raw(), item.rawAfter, item.name);
    assert.deepEqual(stateOf(h), { phase: "uncertain", canConnect: false }, item.name);
    effects(h, { fetches: 1, writes: 1, commits: item.commits, events: item.events });
    assert.deepEqual(h.trace.writeAttempts, [{ key: AUTH_KEY, value: NEXT_A }], item.name);
    assert.equal(h.trace.externalWrites, item.storageFault === "interpose" || item.notifyInterpose ? 1 : 0);
    assert.equal(interposed, !!item.notifyInterpose);
    if (item.notifyInterpose) {
      assert.ok(h.trace.notifications.some(state => state.phase === "connected"), "transient notification is not final true");
    }
    assert.equal(await h.client.connect(true), false, item.name);
    assert.equal(h.raw(), item.rawAfter, item.name);
    h.replaceAuth(RAW_B);
    h.emit("storage", AUTH_KEY);
    h.client.sync();
    assert.equal(h.raw(), RAW_B, item.name);
    assert.deepEqual(stateOf(h), { phase: "uncertain", canConnect: false }, item.name);
    assert.equal(await h.client.connect(true), false, item.name);
    effects(h, { fetches: 1, writes: 1, commits: item.commits, events: item.events });
  }
});
