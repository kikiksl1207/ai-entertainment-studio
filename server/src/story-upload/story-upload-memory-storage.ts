import { BadRequestException } from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  createStoryUploadTotalSizeError,
  STORY_UPLOAD_TOTAL_MAX_BYTES,
} from './story-upload-size.policy';

type UploadRequest = object & {
  aborted?: boolean;
  complete?: boolean;
  once?: (event: string, listener: () => void) => unknown;
  removeListener?: (event: string, listener: () => void) => unknown;
  unpipe?: () => unknown;
  resume?: () => unknown;
  file?: BufferedFile;
  files?: BufferedFile[] | Record<string, BufferedFile[]>;
};

type IncomingFile = { stream: Readable };
type BufferedFile = { buffer?: Buffer };
type FileInfo = { buffer: Buffer; size: number };
type FileCallback = (error: Error | null, info?: FileInfo) => void;
type CancelFile = (error: Error, force?: boolean) => void;
type RequestBudget = {
  receivedBytes: number;
  failure?: Error;
  deferTotal: boolean;
  bodyEnded: boolean;
  active: Set<CancelFile>;
};

const BLOCK_BYTES = 64 * 1024;
const interrupted = () => new BadRequestException('Multipart: Unexpected end of form');

export function createStoryUploadMemoryStorage(
  totalMaxBytes = STORY_UPLOAD_TOTAL_MAX_BYTES,
) {
  if (!Number.isSafeInteger(totalMaxBytes) || totalMaxBytes < 1) {
    throw new RangeError('A positive safe integer upload budget is required');
  }
  const requests = new WeakMap<object, RequestBudget>();

  function failAll(state: RequestBudget, error: Error, deferTotal = false, force = false) {
    if (!state.failure) {
      state.failure = error;
      state.deferTotal = deferTotal;
    }
    for (const cancel of Array.from(state.active)) cancel(state.failure, force);
  }

  function budgetFor(request: UploadRequest) {
    let state = requests.get(request);
    if (state) return state;
    state = { receivedBytes: 0, deferTotal: false, bodyEnded: request.complete === true, active: new Set() };
    requests.set(request, state);
    const budget = state;
    const detach = () => {
      request.removeListener?.('aborted', onAborted);
      request.removeListener?.('end', onEnd);
      request.removeListener?.('close', onClose);
    };
    const onAborted = () => failAll(budget, interrupted(), false, true);
    const onEnd = () => {
      budget.bodyEnded = true;
      if (budget.failure) failAll(budget, budget.failure, false, true);
      detach();
    };
    const onClose = () => {
      if (request.aborted || request.complete === false) onAborted();
      else if (request.complete === true) onEnd();
      detach();
    };
    request.once?.('aborted', onAborted);
    request.once?.('end', onEnd);
    request.once?.('close', onClose);
    if (request.aborted) onAborted();
    return state;
  }

  return {
    _handleFile(request: UploadRequest, file: IncomingFile, callback: FileCallback) {
      const state = budgetFor(request);
      let done = false;
      let deferred = false;
      let fileEnded = false;
      let fileBytes = 0;
      let block: Buffer | undefined;
      let blockUsed = 0;
      const blocks: Buffer[] = [];

      const clearBuffers = () => {
        blocks.length = 0;
        block = undefined;
        blockUsed = 0;
      };
      const release = () => {
        done = true;
        state.active.delete(cancel);
        file.stream.removeListener('data', onData);
        file.stream.removeListener('end', onEnd);
        file.stream.removeListener('error', onInputError);
        file.stream.removeListener('close', onClose);
        clearBuffers();
      };
      const finish = (error: Error | null, info?: FileInfo) => {
        if (done) return;
        release();
        callback(error, info);
      };
      const cancel: CancelFile = (error, force = false) => {
        if (done) return;
        if (state.deferTotal && !force && !state.bodyEnded &&
            request.complete === false && !request.aborted) {
          // Drain without buffering before Multer emits the aggregate response.
          deferred = true;
          clearBuffers();
          file.stream.removeListener('data', onData);
          file.stream.resume();
          return;
        }
        finish(error);
        file.stream.resume();
      };
      const onData = (chunk: Buffer) => {
        if (done) return;
        if (!Buffer.isBuffer(chunk)) {
          failAll(state, interrupted());
          return;
        }
        if (chunk.length > totalMaxBytes - state.receivedBytes) {
          const canDiscard = request.complete === false &&
            typeof request.unpipe === 'function' && typeof request.resume === 'function';
          failAll(state, createStoryUploadTotalSizeError(totalMaxBytes), canDiscard);
          if (canDiscard) {
            try {
              // Multer exclusively consumes this request body; stop parser backpressure.
              request.unpipe!();
              request.resume!();
            } catch (error) {
              failAll(state, error instanceof Error ? error : interrupted(), false, true);
            }
          }
          return;
        }
        if (!chunk.length) return;
        state.receivedBytes += chunk.length;
        fileBytes += chunk.length;
        try {
          // Coalesce fragments rather than retaining arbitrary backing buffers.
          let offset = 0;
          while (offset < chunk.length) {
            block ??= Buffer.allocUnsafe(BLOCK_BYTES);
            const copied = Math.min(BLOCK_BYTES - blockUsed, chunk.length - offset);
            chunk.copy(block, blockUsed, offset, offset + copied);
            offset += copied;
            blockUsed += copied;
            if (blockUsed === BLOCK_BYTES) {
              blocks.push(block);
              block = undefined;
              blockUsed = 0;
            }
          }
        } catch (error) {
          failAll(state, error instanceof Error ? error : new Error('Upload buffering failed'));
        }
      };
      const onEnd = () => {
        if (done) return;
        fileEnded = true;
        if (deferred) return;
        let buffer: Buffer;
        try {
          if (block && blockUsed) blocks.push(block.subarray(0, blockUsed));
          buffer = Buffer.concat(blocks, fileBytes);
        } catch (error) {
          failAll(state, error instanceof Error ? error : new Error('Upload buffering failed'));
          return;
        }
        finish(null, { buffer, size: fileBytes });
      };
      const onInputError = (error: Error) => {
        if (done) return;
        // Multer already decrements this file's pending write on input error.
        release();
        failAll(state, error, false, true);
      };
      const onClose = () => {
        if (!done && !(deferred && fileEnded)) failAll(state, interrupted(), false, true);
      };

      state.active.add(cancel);
      file.stream.once('end', onEnd);
      file.stream.once('error', onInputError);
      file.stream.once('close', onClose);
      file.stream.on('data', onData);
      if (state.failure) cancel(state.failure);
      else if (file.stream.destroyed || file.stream.readableEnded) {
        failAll(state, interrupted(), false, true);
      }
    },

    _removeFile(request: UploadRequest, file: BufferedFile, callback: (error: Error | null) => void) {
      const buffer = file.buffer;
      delete file.buffer;
      if (Buffer.isBuffer(buffer)) {
        const clearAlias = (candidate?: BufferedFile) => {
          if (candidate?.buffer === buffer) delete candidate.buffer;
        };
        clearAlias(request.file);
        if (Array.isArray(request.files)) {
          for (const candidate of request.files) clearAlias(candidate);
        } else if (request.files) {
          for (const group of Object.values(request.files)) {
            if (Array.isArray(group)) for (const candidate of group) clearAlias(candidate);
          }
        }
      }
      callback(null);
    },
  };
}
