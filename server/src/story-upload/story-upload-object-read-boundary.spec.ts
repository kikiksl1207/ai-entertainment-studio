import * as assert from 'node:assert/strict';
import { ReadableStream } from 'node:stream/web';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StoryUploadStorageService } from './story-upload-storage.service';

// Actual whole service and native HWM0 stream; fetch/configuration are synthetic.
// No network, filesystem, provider, original bytes or actual signing credentials.
const KEY = 'private/story-upload/qa/receipt/manuscript/00.bin';
const ORIGIN = 'https://object-read-fixture.invalid';
const PATH = `/qa-fixture-bucket/${KEY}`;
type Provider = 'r2' | 's3';
type Step = { chunk: unknown; sentinel?: boolean } | { error: Error };
type Options = {
  steps?: Step[];
  header?: string | null;
  status?: number;
  noBody?: boolean;
  cancelError?: Error;
  fetchError?: Error;
  locked?: boolean;
  provider?: Provider;
};

function streamFixture(options: Options = {}) {
  const steps = options.steps ?? [{ chunk: Uint8Array.of(0, 255, 128, 1) }];
  const faults: string[] = [];
  const stats = { attemptedFetches: 0, admittedFetches: 0, pulls: 0, sentinelPulls: 0,
    eof: 0, streamErrors: 0, cancels: 0 };
  let index = 0;
  const body = options.noBody ? null : new ReadableStream<unknown>({
    pull(controller) {
      stats.pulls += 1;
      try {
        assert.ok(stats.pulls <= steps.length + 1, 'Bounded scripted stream only');
      } catch (error) { faults.push('stream-admission'); throw error; }
      const step = steps[index++];
      if (!step) { stats.eof += 1; controller.close(); return; }
      // Scripted transport/body faults are deliberately outside admission validation.
      if ('error' in step) { stats.streamErrors += 1; controller.error(step.error); return; }
      if (step.sentinel) stats.sentinelPulls += 1;
      controller.enqueue(step.chunk);
    },
    cancel() {
      stats.cancels += 1;
      if (options.cancelError) return Promise.reject(options.cancelError);
      return undefined;
    },
  }, { highWaterMark: 0 });
  const headers = new Headers();
  if (options.header !== null) headers.set('content-length', options.header ?? '4');
  const response = new Response(body as unknown as BodyInit | null,
    { status: options.status ?? 200, headers });
  const held = options.locked ? body?.getReader() : undefined;
  const arrayBuffer = jest.spyOn(response, 'arrayBuffer');
  const provider = options.provider ?? 'r2';
  const service = new StoryUploadStorageService(new ConfigService({
    NODE_ENV: 'test', OBJECT_STORAGE_PROVIDER: provider,
    OBJECT_STORAGE_ENDPOINT: ORIGIN, OBJECT_STORAGE_BUCKET: 'qa-fixture-bucket',
    OBJECT_STORAGE_REGION: 'auto', OBJECT_STORAGE_ACCESS_KEY_ID: 'synthetic-access-only',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'synthetic-secret-only',
  }));
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    stats.attemptedFetches += 1;
    try {
      assert.equal(stats.attemptedFetches, 1, 'No retry or extra request admitted');
      assert.equal(typeof input, 'string');
      const url = new URL(input as string);
      assert.equal(url.origin, ORIGIN);
      assert.equal(url.pathname, PATH);
      assert.equal(url.username, ''); assert.equal(url.password, ''); assert.equal(url.hash, '');
      assert.deepEqual([...url.searchParams.keys()].sort(), [
        'X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Expires',
        'X-Amz-Signature', 'X-Amz-SignedHeaders',
      ].sort());
      assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
      assert.equal(url.searchParams.get('X-Amz-Expires'), '120');
      assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
      assert.match(url.searchParams.get('X-Amz-Date') ?? '', /^\d{8}T\d{6}Z$/);
      assert.match(url.searchParams.get('X-Amz-Credential') ?? '',
        /^synthetic-access-only\/\d{8}\/auto\/s3\/aws4_request$/);
      assert.match(url.searchParams.get('X-Amz-Signature') ?? '', /^[a-f0-9]{64}$/);
      assert.deepEqual(init, { method: 'GET' });
      stats.admittedFetches += 1;
    } catch (error) { faults.push('fetch-admission'); throw error; }
    if (options.fetchError) throw options.fetchError;
    return response;
  });
  return {
    service, response, body, stats, arrayBuffer,
    read(expectedBytes = 4, suppliedProvider: Provider = provider, key = KEY) {
      return service.getObject({ storageProvider: suppliedProvider, storageKey: key, expectedBytes });
    },
    check(expectedFetches = 1) {
      assert.deepEqual(faults, [], 'REMOTE_OBJECT_FIXTURE_ADMISSION_FAULT');
      assert.equal(stats.attemptedFetches, expectedFetches);
      assert.equal(stats.admittedFetches, expectedFetches);
      assert.equal(fetch.mock.calls.length, expectedFetches);
    },
    async finish(expectedFetches = 1) {
      try { this.check(expectedFetches); }
      finally {
        fetch.mockRestore(); arrayBuffer.mockRestore();
        // Release only the deliberate fixture lock; do not repair product-owned locks.
        held?.releaseLock();
        if (body && !body.locked) await body.cancel().catch(() => undefined);
      }
    },
  };
}

async function outcome<T>(operation: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  try { return { value: await operation }; } catch (error) { return { error }; }
}

function unavailable(error: unknown) {
  assert.ok(error instanceof ServiceUnavailableException);
  assert.equal(error.getStatus(), 503);
  assert.deepEqual(error.getResponse(), {
    code: 'STORY_UPLOAD_STORAGE_UNAVAILABLE', messageKey: 'storyUpload.intake.storageUnavailable',
  });
}

describe('StoryUploadStorageService remote object read boundary', () => {
  it('01 stops an oversized remote body before pulling the later sentinel', async () => {
    const f = streamFixture({ header: '4', steps: [
      { chunk: Uint8Array.of(0, 255) },
      { chunk: Uint8Array.of(128, 1, 2) },
      { chunk: Uint8Array.of(9), sentinel: true },
    ] });
    try {
      const result = await outcome(f.read());
      unavailable(result.error);
      assert.equal(result.value, undefined);
      f.check();
      assert.equal(f.stats.sentinelPulls, 0, 'STORY_UPLOAD_OBJECT_READ_PULLED_AFTER_QUOTA');
      assert.equal(f.stats.pulls, 2);
      assert.equal(f.stats.cancels, 1);
      assert.equal(f.stats.eof, 0);
      assert.equal(f.arrayBuffer.mock.calls.length, 0, 'No whole-body materialization');
      assert.equal(f.body?.locked, false);
    } finally { await f.finish(); }
  });

  it('02 preserves exact binary bytes across block boundaries tiny chunks and zero length', async () => {
    const large = Buffer.alloc(65_539);
    for (let index = 0; index < large.length; index++) large[index] = (index * 37) & 255;
    const cuts = [0, 1, 16_385, 65_535, 65_539];
    const largeChunks = cuts.slice(1).map((end, index) => Uint8Array.from(large.subarray(cuts[index], end)));
    const small = Uint8Array.from([0, 255, 128, 192, 193, 245, 13, 10, 0, 17, 254]);
    const variants: Array<{ provider: Provider; expected: Buffer; chunks: Uint8Array[]; noBody?: boolean }> = [
      { provider: 'r2', expected: Buffer.from(large),
        chunks: [new Uint8Array(0), largeChunks[0], largeChunks[1], new Uint8Array(0), largeChunks[2], largeChunks[3]] },
      { provider: 's3', expected: Buffer.from(small),
        chunks: [...small].flatMap(byte => [new Uint8Array(0), Uint8Array.of(byte)]) },
      { provider: 'r2', expected: Buffer.alloc(0), chunks: [new Uint8Array(0), new Uint8Array(0)] },
      { provider: 's3', expected: Buffer.alloc(0), chunks: [], noBody: true },
    ];
    for (const variant of variants) {
      const f = streamFixture({ provider: variant.provider, header: String(variant.expected.length),
        steps: variant.chunks.map(chunk => ({ chunk })), noBody: variant.noBody });
      try {
        const result = await f.read(variant.expected.length);
        assert.ok(Buffer.isBuffer(result));
        assert.deepEqual(result, variant.expected);
        for (const chunk of variant.chunks) chunk.fill(17);
        assert.deepEqual(result, variant.expected, 'Returned bytes do not alias delivered chunks');
        assert.equal(f.arrayBuffer.mock.calls.length, 0);
        if (f.body) {
          assert.equal(f.body.locked, false);
          assert.equal(f.stats.eof, 1);
        } else assert.equal(f.stats.pulls, 0);
        assert.equal(f.stats.sentinelPulls, 0);
      } finally { await f.finish(); }
    }
  });

  it('03 maps short EOF read acquisition and transport faults to 503 without retry or leaked reader locks', async () => {
    const variants: Array<{ label: string; options: Options; pulls: number; cancels?: number }> = [
      { label: 'short', options: { header: '4', steps: [{ chunk: Uint8Array.of(0, 255) }] }, pulls: 2 },
      { label: 'read-error', options: { steps: [
        { chunk: Uint8Array.of(1) }, { error: new Error('Synthetic stream failure') },
      ] }, pulls: 2 },
      { label: 'non-byte-chunk', options: { steps: [{ chunk: new Uint16Array([1, 2]) }] }, pulls: 1, cancels: 1 },
      { label: 'cancel-rejection', options: { cancelError: new Error('Synthetic cancellation rejection'), steps: [
        { chunk: Uint8Array.of(1, 2, 3, 4, 5) }, { chunk: Uint8Array.of(9), sentinel: true },
      ] }, pulls: 1, cancels: 1 },
      { label: 'reader-acquisition', options: { locked: true }, pulls: 0 },
      { label: 'fetch-rejection', options: { fetchError: new Error('Synthetic fetch rejection') }, pulls: 0 },
    ];
    for (const variant of variants) {
      const f = streamFixture(variant.options);
      try {
        const result = await outcome(f.read());
        unavailable(result.error);
        assert.equal(result.value, undefined);
        assert.equal(f.stats.pulls, variant.pulls, variant.label);
        assert.equal(f.stats.sentinelPulls, 0);
        assert.equal(f.arrayBuffer.mock.calls.length, 0);
        if (variant.cancels !== undefined) assert.equal(f.stats.cancels, variant.cancels);
        if (!variant.options.locked) assert.equal(f.body?.locked, false);
        else assert.equal(f.body?.locked, true, 'Pre-existing fixture lock is not product-owned');
      } finally { await f.finish(); }
    }
  });

  it('04 preserves header and early policy admission while applying the receipt quota to nonfinite headers', async () => {
    for (const options of [
      { header: '3' }, { header: '5' }, { header: '3.5' }, { header: '' },
      { header: null }, { status: 403 }, { status: 500 },
    ]) {
      const f = streamFixture(options);
      try {
        const result = await outcome(f.read());
        unavailable(result.error);
        assert.equal(f.stats.pulls, 0, 'Rejected headers/status must not consume body');
        assert.equal(f.stats.cancels, 1);
        assert.equal(f.arrayBuffer.mock.calls.length, 0);
        assert.equal(f.body?.locked, false);
      } finally { await f.finish(); }
    }
    for (const header of ['not-a-number', 'Infinity']) {
      const f = streamFixture({ header });
      try {
        assert.deepEqual(await f.read(), Buffer.from([0, 255, 128, 1]));
        assert.equal(f.arrayBuffer.mock.calls.length, 0);
        assert.equal(f.body?.locked, false);
      } finally { await f.finish(); }
    }
    for (const expected of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      const f = streamFixture({ header: 'not-a-number' });
      try {
        const result = await outcome(f.read(expected));
        unavailable(result.error);
        assert.equal(f.stats.pulls, 0);
        assert.equal(f.stats.cancels, 1);
        assert.equal(f.arrayBuffer.mock.calls.length, 0);
      } finally { await f.finish(); }
    }
    const missing = streamFixture({ noBody: true, header: '4' });
    try { unavailable((await outcome(missing.read())).error); }
    finally { await missing.finish(); }
    for (const invalid of ['provider-mismatch', 'invalid-key'] as const) {
      const f = streamFixture();
      try {
        const result = await outcome(invalid === 'provider-mismatch'
          ? f.read(4, 's3') : f.read(4, 'r2', '../not-admitted'));
        if (invalid === 'provider-mismatch') unavailable(result.error);
        else assert.ok(result.error instanceof BadRequestException);
        assert.equal(f.stats.pulls, 0);
        f.check(0);
      } finally { await f.finish(0); }
    }
  });
});
