const MAX_ERROR_BYTES = 8 * 1024;
const MAX_ERROR_CHUNKS = 64;
const ERROR_BODY_TIMEOUT_MS = 5000;

export async function readStoryVisualStorageErrorCode(
  response: Response,
  controller: AbortController,
): Promise<string> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    reader = response.body?.getReader();
    if (!reader) return 'unknown';
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Storage error body deadline'));
      }, ERROR_BODY_TIMEOUT_MS);
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    for (let count = 0; ; count++) {
      const item = await Promise.race([reader.read(), deadline]);
      if (item.done) break;
      bytes += item.value.byteLength;
      if (count >= MAX_ERROR_CHUNKS || bytes > MAX_ERROR_BYTES) {
        controller.abort();
        return 'unknown';
      }
      chunks.push(Buffer.from(item.value));
    }
    return Buffer.concat(chunks, bytes).toString('utf8')
      .match(/<Code>([A-Za-z][A-Za-z0-9]{0,63})<\/Code>/)?.[1] ?? 'unknown';
  } catch {
    return 'unknown';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (reader) {
      // Cancellation must not extend the diagnostic deadline while fetch aborts the transport.
      try { void reader.cancel().catch(() => undefined); } catch {}
      try { reader.releaseLock(); } catch {}
    }
  }
}
