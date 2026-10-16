import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createStoryUploadMemoryStorage } from './story-upload-memory-storage';
import {
  createStoryUploadTotalSizeError,
  STORY_UPLOAD_TOTAL_MAX_BYTES,
} from './story-upload-size.policy';

// AUTHOR UNRUN. Controlled events on real Readables; no HTTP/Multer/DB bootstrap.
// Injected small budgets exercise accounting, not a 150MiB wire/RSS proof.
type Storage = ReturnType<typeof createStoryUploadMemoryStorage>;
type FileInfo = { buffer: Buffer; size: number };
type Result = { error: Error | null; info?: FileInfo };
const fileEvents = ['data', 'end', 'error', 'close'] as const;
const requestEvents = ['aborted', 'end', 'close'] as const;

class RequestFixture extends EventEmitter {
  aborted = false;
  complete = false;
}

function digest(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function harness(storage: Storage) {
  const request = new RequestFixture();
  const faults: string[] = [];
  const events: string[] = [];
  const files: Array<{
    stream: Readable;
    calls: Result[];
    expectedCallbacks: number;
    baseline: number[];
    resume: jest.SpyInstance;
    removeOwner: () => void;
  }> = [];

  function file(name: string, multerInputOwner = false) {
    const stream = new Readable({ read() {} });
    const calls: Result[] = [];
    const ownerErrors: Error[] = [];
    const resume = jest.spyOn(stream, 'resume');
    // Installed Multer registers this input-error handler before storage does.
    const onOwnerError = (error: Error) => {
      events.push(`multer:${name}`);
      ownerErrors.push(error);
      if (ownerErrors.length > 1) faults.push(`duplicate input decrement:${name}`);
    };
    if (multerInputOwner) stream.on('error', onOwnerError);
    const record = {
      stream,
      calls,
      expectedCallbacks: 1,
      baseline: fileEvents.map(event => stream.listenerCount(event)),
      resume,
      removeOwner: () => stream.removeListener('error', onOwnerError),
    };
    files.push(record);
    storage._handleFile(request, { stream }, (error, info) => {
      events.push(`storage:${name}`);
      calls.push({ error, info });
      if (calls.length > 1) faults.push(`duplicate storage callback:${name}`);
    });
    return {
      ...record,
      ownerErrors,
      data: (chunk: Buffer) => stream.emit('data', chunk),
      end: () => stream.emit('end'),
      close: () => stream.emit('close'),
      inputError: (error: Error) => {
        if (!multerInputOwner) {
          faults.push(`missing preceding Multer handler:${name}`);
          return;
        }
        record.expectedCallbacks = 0;
        stream.emit('error', error);
      },
    };
  }

  function check() {
    expect(faults).toEqual([]);
  }

  function filesDetached() {
    for (const record of files) {
      expect(record.calls.length).toBe(record.expectedCallbacks);
      expect(fileEvents.map(event => record.stream.listenerCount(event)))
        .toEqual(record.baseline);
    }
    check();
  }

  function requestDetached() {
    expect(requestEvents.map(event => request.listenerCount(event))).toEqual([0, 0, 0]);
    check();
  }

  async function finish() {
    request.aborted = true;
    request.emit('aborted');
    request.emit('close');
    request.emit('end');
    for (const record of files) record.stream.destroy();
    await new Promise<void>(resolve => setImmediate(resolve));
    try {
      filesDetached();
      requestDetached();
    } finally {
      for (const record of files) {
        record.removeOwner();
        record.resume.mockRestore();
      }
    }
  }

  return { request, file, events, check, filesDetached, requestDetached, finish };
}

function completed(file: { calls: Result[] }) {
  expect(file.calls.length).toBe(1);
  const result = file.calls[0];
  expect(result.error).toBeNull();
  expect(result.info).toBeDefined();
  if (!result.info) throw new Error('Expected completed synthetic file');
  expect(Buffer.isBuffer(result.info.buffer)).toBe(true);
  expect(result.info.size).toBe(result.info.buffer.length);
  return result.info;
}

function rejected(file: { calls: Result[] }) {
  expect(file.calls.length).toBe(1);
  const result = file.calls[0];
  expect(result.error).toBeInstanceOf(Error);
  expect(result.info === undefined).toBe(true);
  if (!result.error) throw new Error('Expected rejected synthetic file');
  return result.error;
}

function totalExceeded(error: Error, maxBytes: number) {
  expect(error).toBeInstanceOf(PayloadTooLargeException);
  if (!(error instanceof PayloadTooLargeException)) throw error;
  expect(error.getStatus()).toBe(413);
  expect(error.getResponse()).toEqual({
    code: 'STORY_UPLOAD_TOTAL_SIZE_EXCEEDED',
    messageKey: 'storyUpload.intake.totalSizeExceeded',
    maxBytes,
  });
}

describe('Story upload bounded memory storage (synthetic stream events)', () => {
  it('01 preserves exact and below-budget binary bytes across tiny chunks and the 64KiB boundary', async () => {
    expect(STORY_UPLOAD_TOTAL_MAX_BYTES).toBe(150 * 1024 * 1024);
    totalExceeded(createStoryUploadTotalSizeError(), STORY_UPLOAD_TOTAL_MAX_BYTES);
    expect(() => createStoryUploadMemoryStorage()).not.toThrow();
    expect(() => createStoryUploadMemoryStorage(Number.MAX_SAFE_INTEGER)).not.toThrow();
    for (const value of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createStoryUploadMemoryStorage(value)).toThrow(RangeError);
    }

    const blockBytes = 64 * 1024;
    const payload = Buffer.alloc(blockBytes + 7);
    for (let i = 0; i < payload.length; i += 1) payload[i] = i % 251;
    const expectedDigest = digest(payload);
    const f = harness(createStoryUploadMemoryStorage(payload.length));
    try {
      const file = f.file('exact');
      const boundaries = [
        ...Array.from({ length: 97 }, (_, index) => index + 1),
        blockBytes - 1, blockBytes, payload.length,
      ];
      let offset = 0;
      for (const end of boundaries) {
        const chunk = payload.subarray(offset, end);
        file.data(chunk);
        chunk.fill(0); // Later source mutation must not change retained bytes.
        offset = end;
      }
      expect(file.calls.length).toBe(0);
      file.end();
      const info = completed(file);
      expect(info.size).toBe(blockBytes + 7);
      expect(digest(info.buffer)).toBe(expectedDigest);
      f.filesDetached();
    } finally { await f.finish(); }

    const below = harness(createStoryUploadMemoryStorage(8));
    try {
      const file = below.file('below');
      const bytes = Buffer.from([0, 255, 1, 128]);
      file.data(bytes.subarray(0, 1));
      file.data(bytes.subarray(1));
      file.end();
      expect(digest(completed(file).buffer)).toBe(digest(bytes));
      below.filesDetached();
    } finally { await below.finish(); }
  });

  it('02 rejects cumulative overflow before end, cancels active peers and isolates requests on one engine', async () => {
    const storage = createStoryUploadMemoryStorage(5);
    const f = harness(storage);
    const other = harness(storage);
    try {
      const first = f.file('first');
      const second = f.file('second');
      first.data(Buffer.from([1, 2]));
      second.data(Buffer.from([3, 4]));
      expect(first.calls.length).toBe(0);
      expect(second.calls.length).toBe(0);

      const independent = other.file('independent');
      const independentBytes = Buffer.from([9, 8, 7, 6, 5]);
      independent.data(independentBytes);
      independent.end();
      expect(digest(completed(independent).buffer)).toBe(digest(independentBytes));

      first.resume.mockClear();
      second.resume.mockClear();
      second.data(Buffer.from([5, 6]));
      const failure = rejected(second);
      totalExceeded(failure, 5);
      expect(rejected(first)).toBe(failure);
      expect(first.resume.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(second.resume.mock.calls.length).toBeGreaterThanOrEqual(1);
      f.filesDetached();

      const afterFailure = f.file('after-failure');
      expect(rejected(afterFailure)).toBe(failure);
      first.end(); second.end(); afterFailure.end();
      expect(completed(independent).size).toBe(5);
      f.filesDetached();
      other.filesDetached();
    } finally {
      try { await f.finish(); } finally { await other.finish(); }
    }
  });

  it('03 settles interrupted peers once and leaves the input-error decrement to the preceding Multer handler', async () => {
    for (const reason of ['aborted', 'incomplete-request-close', 'file-close']) {
      const f = harness(createStoryUploadMemoryStorage(8));
      try {
        const first = f.file('first');
        const second = f.file('second');
        first.data(Buffer.from([1])); second.data(Buffer.from([2]));
        if (reason === 'aborted') {
          f.request.aborted = true;
          f.request.emit('aborted');
        } else if (reason === 'incomplete-request-close') {
          f.request.complete = false;
          f.request.emit('close');
        } else {
          first.close();
        }
        const failure = rejected(first);
        expect(failure).toBeInstanceOf(BadRequestException);
        if (!(failure instanceof BadRequestException)) throw failure;
        expect(failure.getStatus()).toBe(400);
        expect(failure.message).toBe('Multipart: Unexpected end of form');
        expect(rejected(second)).toBe(failure);
        const late = f.file('late');
        expect(rejected(late)).toBe(failure);
        first.end(); second.end(); late.end();
        f.filesDetached();
        f.request.emit('close');
        f.requestDetached();
      } finally { await f.finish(); }
    }

    const f = harness(createStoryUploadMemoryStorage(8));
    try {
      const input = f.file('input', true);
      const peer = f.file('peer');
      input.data(Buffer.from([1])); peer.data(Buffer.from([2]));
      const original = new Error('Synthetic source stream failure');
      input.inputError(original);
      expect(input.ownerErrors.length).toBe(1);
      expect(input.ownerErrors[0]).toBe(original);
      expect(input.calls.length).toBe(0);
      expect(rejected(peer)).toBe(original);
      expect(f.events).toEqual(['multer:input', 'storage:peer']);
      const late = f.file('late-after-input-error');
      expect(rejected(late)).toBe(original);
      input.end(); peer.end(); late.end();
      f.filesDetached();
      f.request.emit('end');
      f.requestDetached();
    } finally { await f.finish(); }
  });

  it('04 normal request end keeps the cumulative budget for queued files and removal deletes only the buffer', async () => {
    const storage = createStoryUploadMemoryStorage(6);
    const f = harness(storage);
    try {
      const first = f.file('first');
      first.data(Buffer.from([0, 255])); first.end();
      const firstInfo = completed(first);
      f.request.complete = true;
      f.request.emit('end');
      f.requestDetached();

      const queued = f.file('queued-after-request-end');
      const queuedBytes = Buffer.from([2, 3, 4, 5]);
      queued.data(queuedBytes); queued.end();
      expect(digest(completed(queued).buffer)).toBe(digest(queuedBytes));

      const removable: { buffer?: Buffer; size: number; fieldname: string } = {
        buffer: firstInfo.buffer, size: firstInfo.size, fieldname: 'manuscripts',
      };
      const removalErrors: Array<Error | null> = [];
      storage._removeFile(f.request, removable, error => { removalErrors.push(error); });
      expect(removalErrors).toEqual([null]);
      expect(Object.keys(removable).sort()).toEqual(['fieldname', 'size']);
      expect(removable.size).toBe(2);
      expect(removable.fieldname).toBe('manuscripts');
      storage._removeFile(f.request, removable, error => { removalErrors.push(error); });
      expect(removalErrors).toEqual([null, null]);
      expect(Object.keys(removable).sort()).toEqual(['fieldname', 'size']);
      expect(removable.size).toBe(2);
      expect(removable.fieldname).toBe('manuscripts');

      // Multer OBJECT/ARRAY placeholders copy the buffer reference, not fileInfo.
      type Alias = { buffer?: Buffer; size: number; fieldname: string };
      type MirrorRequest = RequestFixture & {
        file?: Alias;
        files?: Alias[] | Record<string, Alias[]>;
      };
      for (const strategy of ['VALUE', 'ARRAY', 'OBJECT']) {
        const shared = firstInfo.buffer;
        const equalButDistinct = Buffer.from(shared);
        expect(equalButDistinct === shared).toBe(false);
        expect(digest(equalButDistinct)).toBe(digest(shared));
        const target: Alias = { buffer: shared, size: 2, fieldname: 'manuscripts' };
        const firstAlias: Alias = { ...target };
        const secondAlias: Alias = { ...target, fieldname: 'visuals' };
        const unrelated: Alias = { ...target, buffer: equalButDistinct };
        const request: MirrorRequest = new RequestFixture();
        const array = [firstAlias, unrelated, secondAlias];
        const groups = { manuscripts: [firstAlias, unrelated], visuals: [secondAlias] };
        if (strategy === 'VALUE') {
          request.file = firstAlias;
        } else {
          request.file = unrelated;
          request.files = strategy === 'ARRAY' ? array : groups;
        }
        const foreignFile: Alias = { ...target };
        const foreignMirror: Alias = { ...target };
        const foreignFiles = [foreignMirror];
        const otherRequest: MirrorRequest = new RequestFixture();
        otherRequest.file = foreignFile;
        otherRequest.files = foreignFiles;
        const errors: Array<Error | null> = [];

        storage._removeFile(request, target, error => { errors.push(error); });
        storage._removeFile(request, target, error => { errors.push(error); });
        expect(errors).toEqual([null, null]);
        const cleared = strategy === 'VALUE'
          ? [target, firstAlias]
          : [target, firstAlias, secondAlias];
        for (const alias of cleared) {
          expect(Object.keys(alias).sort()).toEqual(['fieldname', 'size']);
          expect(alias.size).toBe(2);
        }
        expect(target.fieldname).toBe('manuscripts');
        expect(firstAlias.fieldname).toBe('manuscripts');
        expect(secondAlias.fieldname).toBe('visuals');
        expect(unrelated.buffer === equalButDistinct).toBe(true);
        expect(unrelated.size).toBe(2);
        expect(unrelated.fieldname).toBe('manuscripts');
        expect(digest(equalButDistinct)).toBe(digest(shared));
        expect(otherRequest.file === foreignFile).toBe(true);
        expect(otherRequest.files === foreignFiles).toBe(true);
        expect(foreignFiles.length).toBe(1);
        expect(foreignFiles[0] === foreignMirror).toBe(true);
        expect(foreignFile.buffer === shared).toBe(true);
        expect(foreignMirror.buffer === shared).toBe(true);
        expect(foreignFile.size).toBe(2);
        expect(foreignMirror.size).toBe(2);
        expect(foreignFile.fieldname).toBe('manuscripts');
        expect(foreignMirror.fieldname).toBe('manuscripts');
        if (strategy === 'VALUE') {
          expect(request.file === firstAlias).toBe(true);
          expect(request.files === undefined).toBe(true);
        } else {
          expect(request.file === unrelated).toBe(true);
          if (strategy === 'ARRAY') {
            expect(request.files === array).toBe(true);
            expect(array.length).toBe(3);
            expect(array[0] === firstAlias).toBe(true);
            expect(array[1] === unrelated).toBe(true);
            expect(array[2] === secondAlias).toBe(true);
          } else {
            expect(request.files === groups).toBe(true);
            expect(Object.keys(groups).sort()).toEqual(['manuscripts', 'visuals']);
            expect(groups.manuscripts.length).toBe(2);
            expect(groups.visuals.length).toBe(1);
            expect(groups.manuscripts[0] === firstAlias).toBe(true);
            expect(groups.manuscripts[1] === unrelated).toBe(true);
            expect(groups.visuals[0] === secondAlias).toBe(true);
          }
        }
      }

      const over = f.file('no-budget-refund-after-removal');
      over.data(Buffer.from([6]));
      totalExceeded(rejected(over), 6);
      first.end(); queued.end(); over.end();
      first.close(); queued.close(); over.close();
      f.filesDetached();
      f.request.emit('close');
      f.requestDetached();
    } finally { await f.finish(); }
  });

  it('05 defers only aggregate callbacks until raw end and force-flushes interrupted peers once', async () => {
    const f = harness(createStoryUploadMemoryStorage(5));
    const raw = Object.assign(f.request, { unpipe: jest.fn(), resume: jest.fn() });
    try {
      expect(f.request.complete).toBe(false);
      const first = f.file('raw-first');
      const second = f.file('raw-second');
      first.data(Buffer.from([1, 2]));
      second.data(Buffer.from([3, 4]));
      first.resume.mockClear(); second.resume.mockClear();
      second.data(Buffer.from([5, 6]));
      expect(raw.unpipe.mock.calls.length).toBe(1);
      expect(raw.resume.mock.calls.length).toBe(1);
      expect(first.calls.length).toBe(0);
      expect(second.calls.length).toBe(0);
      expect(first.stream.listenerCount('data')).toBe(0);
      expect(second.stream.listenerCount('data')).toBe(0);
      expect(first.resume.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(second.resume.mock.calls.length).toBeGreaterThanOrEqual(1);

      const lateBytes = Buffer.from([7, 8, 9]);
      const queuedFiles: Array<ReturnType<typeof f.file>> = [];
      let allocations = -1;
      let concatenations = -1;
      // Observe only this synchronous post-failure window, not Jest assertions.
      const allocate = jest.spyOn(Buffer, 'allocUnsafe');
      const concatenate = jest.spyOn(Buffer, 'concat');
      try {
        const queued = f.file('raw-queued-after-overflow');
        queuedFiles.push(queued);
        first.data(lateBytes); second.data(lateBytes); queued.data(lateBytes);
        first.end(); second.end(); queued.end();
        first.close(); second.close(); queued.close();
        allocations = allocate.mock.calls.length;
        concatenations = concatenate.mock.calls.length;
      } finally {
        allocate.mockRestore();
        concatenate.mockRestore();
      }
      expect(allocations).toBe(0);
      expect(concatenations).toBe(0);
      expect(queuedFiles.length).toBe(1);
      const queued = queuedFiles[0];
      expect(queued.stream.listenerCount('data')).toBe(0);
      expect(queued.resume.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect([first.calls.length, second.calls.length, queued.calls.length]).toEqual([0, 0, 0]);
      expect(f.events).toEqual([]);
      f.check();

      // This explicit flush must pass before teardown can emit its own abort/end.
      f.request.complete = true;
      f.request.emit('end');
      const failure = rejected(first);
      totalExceeded(failure, 5);
      expect(rejected(second)).toBe(failure);
      expect(rejected(queued)).toBe(failure);
      f.filesDetached();
      f.requestDetached();

      const after = f.file('raw-no-reset-after-end');
      expect(rejected(after)).toBe(failure);
      f.request.emit('end'); f.request.emit('close'); f.request.emit('aborted');
      first.end(); second.end(); queued.end(); after.end();
      first.close(); second.close(); queued.close(); after.close();
      expect(rejected(first)).toBe(failure);
      expect(rejected(second)).toBe(failure);
      expect(rejected(queued)).toBe(failure);
      f.filesDetached();
      f.requestDetached();
      expect(raw.unpipe.mock.calls.length).toBe(1);
      expect(raw.resume.mock.calls.length).toBe(1);
    } finally { await f.finish(); }

    for (const reason of ['aborted', 'incomplete-request-close']) {
      const interrupted = harness(createStoryUploadMemoryStorage(5));
      const raw = Object.assign(interrupted.request, { unpipe: jest.fn(), resume: jest.fn() });
      try {
        const first = interrupted.file('interrupted-first');
        const peer = interrupted.file('interrupted-peer');
        first.data(Buffer.from([1, 2])); peer.data(Buffer.from([3, 4]));
        peer.data(Buffer.from([5, 6]));
        expect(raw.unpipe.mock.calls.length).toBe(1);
        expect(raw.resume.mock.calls.length).toBe(1);
        const queued = interrupted.file('interrupted-queued');
        expect([first.calls.length, peer.calls.length, queued.calls.length]).toEqual([0, 0, 0]);
        if (reason === 'aborted') {
          interrupted.request.aborted = true;
          interrupted.request.emit('aborted');
        } else {
          interrupted.request.complete = false;
          interrupted.request.emit('close');
        }
        const failure = rejected(first);
        totalExceeded(failure, 5);
        expect(rejected(peer)).toBe(failure);
        expect(rejected(queued)).toBe(failure);
        interrupted.filesDetached();
        interrupted.request.emit('close');
        interrupted.requestDetached();
        interrupted.request.emit('aborted'); interrupted.request.emit('end');
        first.end(); peer.end(); queued.end();
        first.close(); peer.close(); queued.close();
        interrupted.filesDetached();
        expect(raw.unpipe.mock.calls.length).toBe(1);
        expect(raw.resume.mock.calls.length).toBe(1);
      } finally { await interrupted.finish(); }
    }

    const inputFailure = harness(createStoryUploadMemoryStorage(5));
    const inputRaw = Object.assign(inputFailure.request, { unpipe: jest.fn(), resume: jest.fn() });
    try {
      const input = inputFailure.file('deferred-input', true);
      const peer = inputFailure.file('deferred-peer');
      input.data(Buffer.from([1, 2])); peer.data(Buffer.from([3, 4]));
      peer.data(Buffer.from([5, 6]));
      expect(inputRaw.unpipe.mock.calls.length).toBe(1);
      expect(inputRaw.resume.mock.calls.length).toBe(1);
      const queued = inputFailure.file('deferred-queued');
      expect([input.calls.length, peer.calls.length, queued.calls.length]).toEqual([0, 0, 0]);
      const original = new Error('Synthetic deferred input failure');
      input.inputError(original);
      expect(input.ownerErrors.length).toBe(1);
      expect(input.ownerErrors[0]).toBe(original);
      expect(input.calls.length).toBe(0);
      const failure = rejected(peer);
      totalExceeded(failure, 5);
      expect(failure === original).toBe(false);
      expect(rejected(queued)).toBe(failure);
      expect(inputFailure.events).toEqual([
        'multer:deferred-input', 'storage:deferred-peer', 'storage:deferred-queued',
      ]);
      inputFailure.filesDetached();

      inputFailure.request.complete = true;
      inputFailure.request.emit('end');
      inputFailure.request.emit('end'); inputFailure.request.emit('close');
      input.end(); peer.end(); queued.end();
      input.close(); peer.close(); queued.close();
      expect(input.calls.length).toBe(0);
      expect(input.ownerErrors.length).toBe(1);
      expect(rejected(peer)).toBe(failure);
      expect(rejected(queued)).toBe(failure);
      inputFailure.filesDetached();
      inputFailure.requestDetached();
      expect(inputRaw.unpipe.mock.calls.length).toBe(1);
      expect(inputRaw.resume.mock.calls.length).toBe(1);
    } finally { await inputFailure.finish(); }
  });
});
