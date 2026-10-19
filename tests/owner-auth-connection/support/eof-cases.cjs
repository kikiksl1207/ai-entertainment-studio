"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { performance } = require("node:perf_hooks");
const { TextEncoder } = require("node:util");
const { loadSubject } = require("./subject.cjs");
const { RAW_A, NEXT_A, OPTIONS, validReply, harness, stateOf, effects,
  assertRequest, flushLateWork, ReadableStream } = require("./fixture.cjs");

function registerEofCases(profile) {
  const subject = loadSubject(profile);

  test(`EOF1 ${profile.id}: native complete-stream positive control`, OPTIONS, async t => {
    const h = harness(subject, { supplied: true });
    t.after(() => h.client.dispose());
    assert.equal(h.raw(), RAW_A);
    assert.deepEqual(stateOf(h), { phase: "idle", canConnect: true });
    const pending = h.client.connect(true);
    assert.equal(Object.getPrototypeOf(pending), Promise.prototype);
    assert.equal(await pending, true);
    assert.ok(h.stream instanceof ReadableStream);
    assert.deepEqual(h.trace.nativeReadPromises, [true, true]);
    assertRequest(h);
    assert.equal(h.raw(), NEXT_A);
    assert.deepEqual(stateOf(h), { phase: "connected", canConnect: false });
    effects(h, { fetches: 1, writes: 1, commits: 1, events: 1 });
    assert.equal(h.trace.nativeFetchInvoked, 0);
    assert.equal(h.trace.suppliedFetchInvoked, 1);
    assert.equal(h.trace.syntheticValidRotationFixtureIssued, 1);
    assert.ok(h.trace.notifications.some(state => state.phase === "connected"));
    assert.equal(await h.client.connect(true), false);
    effects(h, { fetches: 1, writes: 1, commits: 1, events: 1 });
  });

  test(`EOF2 ${profile.id}: complete JSON, pending native EOF, timeout cancel must not commit`, OPTIONS, async t => {
    const deadlineMs = 60;
    const h = harness(subject, { supplied: true, mode: "pending-eof", deadlineMs });
    t.after(() => h.client.dispose());
    assert.equal(h.raw(), RAW_A);
    assert.deepEqual(stateOf(h), { phase: "idle", canConnect: true });
    const startedMs = performance.now();
    const pending = h.client.connect(true);
    assert.equal(Object.getPrototypeOf(pending), Promise.prototype);
    // No observer .then, artificial EOF resolution, manual abort or competing race.
    const result = await pending;
    const elapsedMs = performance.now() - startedMs;
    await flushLateWork();
    const observed = {
      result, writes: h.trace.storageSetInvoked, commits: h.trace.localCommits,
      events: h.trace.authChangeEvents,
      connectedNotifications: h.trace.notifications.filter(state => state.phase === "connected").length,
      raw: h.raw(), state: stateOf(h),
    };
    t.diagnostic(JSON.stringify({ profile: profile.id, sourceSha256: profile.sha256,
      elapsedMs, reads: h.trace.readInvoked, cancelEntries: h.trace.cancelEntries,
      abortEntries: h.trace.abortEntries, observed }));

    assert.ok(h.stream instanceof ReadableStream, "FIXTURE: native stream required");
    assert.equal(h.trace.nativeStreams, 1, "FIXTURE: one native body");
    assert.equal(h.trace.enqueuedBytes, new TextEncoder().encode(JSON.stringify(validReply())).byteLength,
      "FIXTURE: entire canonical valid JSON was enqueued");
    assert.equal(h.trace.readInvoked, 2, "FIXTURE: first data read completed, second read awaits EOF");
    assert.deepEqual(h.trace.nativeReadPromises, [true, true], "FIXTURE: native promises returned unchanged");
    assert.deepEqual(h.trace.abortEntries[0], { reads: 2, pendingEOF: true }, "FIXTURE: deadline abort at pending EOF");
    assert.deepEqual(h.trace.cancelEntries[0], { reads: 2, pendingEOF: true }, "FIXTURE: product cancel at pending EOF");
    assert.equal(h.trace.underlyingCancelInvoked, 1, "FIXTURE: native cancel closes the open stream");
    // Observe the saved native read only AFTER connect and its continuation drain.
    const nativeEOF = await h.nativeReads[1];
    assert.equal(nativeEOF.done, true, "FIXTURE: cancel resolved the pending read as EOF");
    assert.equal(nativeEOF.value, undefined);
    assert.equal(h.trace.abortEvents, 1);
    assert.ok(elapsedMs >= deadlineMs - 20, `FIXTURE: elapsed milliseconds ${elapsedMs}`);
    assert.ok(elapsedMs < 2000, "FIXTURE: product deadline must settle, not node:test timeout");
    assertRequest(h);
    assert.equal(h.trace.syntheticValidRotationFixtureIssued, 1);

    // Identical safety expectation for BOTH admitted profiles; no expected-red branch.
    assert.deepEqual(observed, { result: false, writes: 0, commits: 0, events: 0,
      connectedNotifications: 0, raw: RAW_A, state: { phase: "uncertain", canConnect: false } },
    "SAFETY: timeout/cancel must have zero commit/publication, not merely final false");
    effects(h, { fetches: 1, writes: 0, commits: 0, events: 0 });
    assert.equal(await h.client.connect(true), false);
    effects(h, { fetches: 1, writes: 0, commits: 0, events: 0 });
    assert.equal(h.raw(), RAW_A);
  });
}

module.exports = Object.freeze({ registerEofCases });
