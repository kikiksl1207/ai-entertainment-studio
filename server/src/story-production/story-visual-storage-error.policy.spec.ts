import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as vm from 'node:vm';
import * as ts from 'typescript';
import { readStoryVisualStorageErrorCode } from './story-visual-storage-error.policy';

const NativeResponse = globalThis.Response;
const NativeStream = globalThis.ReadableStream;
const NativeAbortController = globalThis.AbortController;
const phase = process.env.STORY_STORAGE_ERROR_PHASE ?? 'current';
const xml = '<Error><Code>AccessDenied</Code><Message>SYNTHETIC_PRIVATE_XML</Message></Error>';
const bytes = (value: string) => new Uint8Array(Buffer.from(value));
const flush = async () => { for (let index = 0; index < 256; index++) await Promise.resolve(); };
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const message = (value: unknown) => record(value) && typeof value.message === 'string' ? value.message : 'non-error';

// Parse the actual method as data. Do not import, construct or initialize the paid generator.
const sourcePath = process.env.STORY_STORAGE_ERROR_SOURCE ?? join(__dirname, 'story-visual-generation.service.ts');
if (process.env.STORY_STORAGE_ERROR_SOURCE !== undefined) {
  const canonical = resolve(sourcePath).replace(/\\/g, '/').toLowerCase();
  if (!/^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-story-storage-error-body\/focused-(?:baseline|current)-[a-f0-9]{12}\/capsule\/context\/story-visual-generation\.service\.ts$/.test(canonical) ||
    realpathSync(sourcePath).replace(/\\/g, '/').toLowerCase() !== canonical) throw new Error('Unadmitted upload method context');
}
const actualSource = readFileSync(sourcePath, 'utf8');
const parsed = ts.createSourceFile('actual-visual-service.ts', actualSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const classes = parsed.statements.filter(ts.isClassDeclaration)
  .filter(value => value.name?.text === 'StoryVisualGenerationService');
if (classes.length !== 1) throw new Error('Exactly one actual visual service source required');
const methods = classes[0].members.filter(ts.isMethodDeclaration)
  .filter(value => ts.isIdentifier(value.name) && value.name.text === 'uploadImage');
if (methods.length !== 1) throw new Error('Exactly one actual uploadImage required');
const methodSource = methods[0].getText(parsed);
const emitted = ts.transpileModule('class CapturedUpload {\n' + methodSource + '\n}', {
  compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true,
});
if ((emitted.diagnostics ?? []).some(value => value.category === ts.DiagnosticCategory.Error))
  throw new Error('Actual uploadImage syntax must transpile without errors');
if (!['baseline', 'current'].includes(phase)) throw new Error('Unexpected focused profile');

type BodyOptions = { status?: number; hold?: boolean; readError?: boolean; acquisitionError?: boolean;
  cancel?: 'normal' | 'reject' | 'hang'; noBody?: boolean };
type Body = ReturnType<typeof bodyFixture>;
function bodyFixture(chunks: Uint8Array[], options: BodyOptions = {}) {
  const stats = { pulls: 0, sent: 0, getReaders: 0, reads: 0, texts: 0, readerCancels: 0,
    sourceCancels: 0, releases: 0, abortEvents: 0 };
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new NativeStream<Uint8Array>({
    start(controller) { streamController = controller; },
    pull(controller) {
      stats.pulls++;
      if (stats.sent < chunks.length) {
        controller.enqueue(chunks[stats.sent++]);
        if (stats.sent === chunks.length && !options.hold && !options.readError) controller.close();
      } else if (options.readError) controller.error(new Error('Synthetic body failure'));
      else if (!options.hold) controller.close();
    },
    cancel() { stats.sourceCancels++; },
  }, { highWaterMark: 0 });
  const actualGetReader = stream.getReader.bind(stream);
  stream.getReader = (() => {
    stats.getReaders++;
    if (options.acquisitionError) throw new Error('Synthetic reader acquisition failure');
    const reader = actualGetReader(), read = reader.read.bind(reader), cancel = reader.cancel.bind(reader);
    const release = reader.releaseLock.bind(reader);
    reader.read = () => { stats.reads++; return read(); };
    reader.cancel = reason => {
      stats.readerCancels++;
      if (options.cancel === 'reject') return Promise.reject(new Error('Synthetic cancel rejection'));
      if (options.cancel === 'hang') return new Promise<void>(() => undefined);
      return cancel(reason);
    };
    reader.releaseLock = () => { stats.releases++; release(); };
    return reader;
  }) as typeof stream.getReader;
  const response = new NativeResponse(options.noBody ? null : stream, { status: options.status ?? 403 });
  const text = response.text.bind(response);
  response.text = () => { stats.texts++; return text(); };
  let signal: AbortSignal | undefined;
  const onAbort = () => {
    stats.abortEvents++;
    try { streamController?.error(new Error('Synthetic transport abort')); } catch { /* Already closed. */ }
  };
  return { response, stream, stats,
    bind(next: AbortSignal) {
      if (signal && signal !== next) throw new Error('One signal per synthetic response');
      signal = next; signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    },
    enqueue(value: Uint8Array) { streamController!.enqueue(value); },
    close() { streamController!.close(); },
    dispose() { signal?.removeEventListener('abort', onAbort); },
  };
}

function fixture() {
  const faults: string[] = [], bodies: Body[] = [];
  const fail = (code: string): never => { faults.push(code); throw new Error(code); };
  const active = new Map<number, { due: number; callback: () => void }>();
  const timers = { made: 0, cleared: 0, fired: 0 };
  let now = 0, next = 0;
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    if (typeof callback !== 'function' || delay !== 5000) return fail('FIXTURE_TIMER_ADMISSION');
    const id = ++next; timers.made++; active.set(id, { callback, due: now + delay });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    const key = Number(id);
    if (!Number.isInteger(key) || key < 1 || key > next) return fail('FIXTURE_CLEAR_ADMISSION');
    timers.cleared++; active.delete(key);
  }) as typeof clearTimeout;
  const operations = { fetchAttempts: 0, helperCalls: 0, abortCalls: 0, contextAttempts: 0 };
  const warnings: Record<string, unknown>[] = [];
  let requestSignal: AbortSignal | undefined, helperController: AbortController | undefined;
  function observedController(controller: AbortController) {
    const abort = controller.abort.bind(controller);
    controller.abort = reason => { operations.abortCalls++; abort(reason); };
    return controller;
  }
  function upload(body: Body, fallback = false, pendingHeaders?: Promise<Response>) {
    const image = Buffer.from([0, 255, 128, 17]);
    const fetch = (url: unknown, options: RequestInit) => {
      operations.fetchAttempts++;
      if (url !== 'https://storage.invalid/synthetic-put' || options.method !== 'PUT' || options.body !== image ||
        !record(options.headers) || Object.keys(options.headers).join(',') !== 'content-type' ||
        options.headers['content-type'] !== 'image/webp' ||
        (phase === 'current' && !(options.signal instanceof AbortSignal)) ||
        (phase === 'baseline' && options.signal !== undefined)) return fail('FIXTURE_PUT_ADMISSION');
      requestSignal = options.signal ?? undefined;
      if (requestSignal) body.bind(requestSignal);
      return pendingHeaders ?? Promise.resolve(body.response);
    };
    const helper = (response: Response, controller: AbortController) => {
      operations.helperCalls++;
      if (response !== body.response || !(controller instanceof NativeAbortController) || controller.signal !== requestSignal)
        return fail('FIXTURE_HELPER_CONTROLLER_ADMISSION');
      helperController = observedController(controller);
      return readStoryVisualStorageErrorCode(response, controller);
    };
    const fn: (this: object, ...args: unknown[]) => Promise<unknown> = new vm.Script(
      emitted.outputText + '\nCapturedUpload.prototype.uploadImage;', { filename: 'actual-uploadImage-only.js' })
      .runInNewContext({ fetch, readStoryVisualStorageErrorCode: helper,
        AbortController: NativeAbortController, Buffer }, { timeout: 2500 });
    const allowed: Record<string, unknown> = {
      requiredEnv(name: string) { operations.contextAttempts++; if (name !== 'OBJECT_STORAGE_PROVIDER') return fail('FIXTURE_CONFIG'); return 'r2'; },
      storageKeyPrefix() { operations.contextAttempts++; return 'synthetic-prefix'; },
      model() { operations.contextAttempts++; return 'synthetic-model'; },
      size() { operations.contextAttempts++; return '1024x1536'; },
      sha256Hex(value: string) { operations.contextAttempts++; if (value !== 'synthetic-variant') return fail('FIXTURE_HASH'); return createHash('sha256').update(value).digest('hex'); },
      presignedPutUrl(provider: string, key: string, type: string) {
        operations.contextAttempts++;
        if (provider !== 'r2' || !key.startsWith('synthetic-prefix/story-visuals/synthetic-work/synthetic-release/synthetic-scene/') || type !== 'image/webp')
          return fail('FIXTURE_SIGNING');
        return 'https://storage.invalid/synthetic-put';
      },
      databaseFallbackEnabled() { operations.contextAttempts++; return fallback; },
      logger: { warn(value: unknown) {
        operations.contextAttempts++;
        if (!record(value) || Object.keys(value).sort().join(',') !== 'event,objectStorageCode,objectStorageStatus,sourceSceneKey,workId' ||
          !['story_visual_database_fallback', 'story_visual_object_storage_rejected'].includes(String(value.event)) ||
          value.workId !== 'synthetic-work' || value.sourceSceneKey !== 'synthetic-scene' || value.objectStorageStatus !== body.response.status ||
          typeof value.objectStorageCode !== 'string' || !/^(?:unknown|[A-Za-z][A-Za-z0-9]{0,63})$/.test(value.objectStorageCode))
          return fail('FIXTURE_WARNING_ADMISSION');
        warnings.push({ ...value });
      } },
    };
    const context = new Proxy(allowed, { get(target, key) {
      if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(target, key)) return fail('FIXTURE_UNADMITTED_CONTEXT');
      return target[key];
    } });
    const result = fn.call(context, 'synthetic-work', 'synthetic-release', 'synthetic-scene',
      'synthetic-variant', 'synthetic-prompt-hash', 'synthetic-quality', image);
    return { result, image, get signal() { return requestSignal; }, get controller() { return helperController; } };
  }
  return { operations, warnings, timers, active, faults,
    body(chunks: Uint8Array[], options?: BodyOptions) { const body = bodyFixture(chunks, options); bodies.push(body); return body; },
    controller(body: Body) { const controller = observedController(new NativeAbortController()); body.bind(controller.signal); return controller; },
    upload,
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...active]) if (timer.due <= now) { active.delete(id); timers.fired++; timer.callback(); }
    },
    check() { expect(faults).toEqual([]); },
    finish() {
      const remaining = active.size;
      for (const body of bodies) body.dispose();
      globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear;
      expect(faults).toEqual([]); expect(remaining).toBe(0);
    },
  };
}
async function outcome(promise: Promise<unknown>) {
  try { return { ok: true as const, value: await promise }; }
  catch (error) { return { ok: false as const, message: message(error) }; }
}

it('01 actual uploadImage rejects finite oversized diagnostic consumption before the later sentinel', async () => {
  const f = fixture();
  try {
    const first = new Uint8Array(8193); first.set(bytes('<Code>AccessDenied</Code>'));
    const body = f.body([first, bytes('SYNTHETIC_LATER_SENTINEL')]);
    const call = f.upload(body), result = await outcome(call.result); f.check();
    // This is the qualified old-method RED, after its actual finite Response.text consumption.
    if (body.stats.sent > 1) throw new Error('STORY_VISUAL_STORAGE_ERROR_BODY_READ_PAST_BUDGET');
    expect(result.ok).toBe(false); if (result.ok) throw new Error('Expected unchanged status rejection');
    expect(result.message).toBe('OBJECT_STORAGE_403');
    expect(f.operations.fetchAttempts).toBe(1); expect(f.operations.helperCalls).toBe(1);
    expect(call.signal).toBe(call.controller?.signal); expect(call.signal?.aborted).toBe(true);
    expect(f.operations.abortCalls).toBe(1); expect(body.stats.texts).toBe(0);
    expect(f.warnings[0].objectStorageCode).toBe('unknown'); expect(body.stats.releases).toBe(1);
  } finally { f.finish(); }
});

it('02 normal codes and both fallback modes retain actual upload key status metadata and success behavior', async () => {
  for (const fallback of [false, true]) {
    const f = fixture();
    try {
      const body = f.body([bytes(xml)]), call = f.upload(body, fallback), result = await outcome(call.result); f.check();
      if (fallback) {
        expect(result.ok).toBe(true); if (!result.ok || !record(result.value)) throw new Error('Expected original fallback object');
        expect(result.value.provider).toBe('database'); expect(result.value.inlineBase64).toBe(call.image.toString('base64'));
        expect(result.value.key).toBe('synthetic-prefix/story-visuals/synthetic-work/synthetic-release/synthetic-scene/' +
          createHash('sha256').update('synthetic-variant').digest('hex').slice(0, 16) + '-synthetic-prompt-hash-synthetic-model-synthetic-quality-1024x1536.webp');
      } else { expect(result.ok).toBe(false); if (!result.ok) expect(result.message).toBe('OBJECT_STORAGE_403'); }
      expect(f.warnings).toHaveLength(1); expect(f.warnings[0].objectStorageCode).toBe('AccessDenied');
      expect(JSON.stringify(f.warnings)).not.toContain('SYNTHETIC_PRIVATE_XML');
      expect(call.signal).toBe(call.controller?.signal); expect(call.signal?.aborted).toBe(false);
      expect(f.operations.fetchAttempts).toBe(1); expect(body.stats.texts).toBe(0);
      expect(body.stats.readerCancels).toBe(1); expect(body.stats.releases).toBe(1);
    } finally { f.finish(); }
  }
  const f = fixture();
  try {
    const body = f.body([bytes('UNREAD_SUCCESS_BODY')], { status: 200 }), call = f.upload(body);
    const result = await outcome(call.result); f.check();
    expect(result.ok).toBe(true); if (!result.ok || !record(result.value)) throw new Error('Expected success object');
    expect(result.value.provider).toBe('r2'); expect(Object.keys(result.value).sort()).toEqual(['key', 'provider']);
    expect(f.operations.helperCalls).toBe(0); expect(body.stats.getReaders).toBe(0);
    expect(body.stats.pulls).toBe(0); expect(f.warnings).toHaveLength(0); expect(f.timers.made).toBe(0);
    expect(call.signal?.aborted).toBe(false);
  } finally { f.finish(); }
});

it('03 byte and chunk limits retain exact boundaries and never read a later overflow sentinel', async () => {
  for (const plan of [
    { parts: [bytes(xml + ' '.repeat(8192 - Buffer.byteLength(xml)))], expected: 'AccessDenied', abort: false },
    { parts: [new Uint8Array(8193), bytes('LATE')], expected: 'unknown', abort: true },
    { parts: [...Array.from({ length: 63 }, () => bytes(' ')), bytes('<Code>A</Code>')], expected: 'A', abort: false },
    { parts: [...Array.from({ length: 65 }, () => new Uint8Array(0)), bytes('LATE')], expected: 'unknown', abort: true },
    { parts: [bytes('<Code>9bad</Code>')], expected: 'unknown', abort: false },
    { parts: [bytes('<Code>' + 'A'.repeat(65) + '</Code>')], expected: 'unknown', abort: false },
  ]) {
    const f = fixture();
    try {
      const body = f.body(plan.parts), controller = f.controller(body);
      expect(await readStoryVisualStorageErrorCode(body.response, controller)).toBe(plan.expected); f.check();
      expect(controller.signal.aborted).toBe(plan.abort); expect(f.operations.abortCalls).toBe(plan.abort ? 1 : 0);
      if (plan.abort) expect(body.stats.sent).toBeLessThan(plan.parts.length);
      expect(body.stats.texts).toBe(0); expect(body.stats.readerCancels).toBe(1);
      expect(body.stats.releases).toBe(1); expect(body.stream.locked).toBe(false);
      expect(f.timers.made).toBe(1); expect(f.timers.cleared).toBe(1);
    } finally { f.finish(); }
  }
});

it('04 one total postheader deadline survives progress and hung cancel without adding a preheader timeout', async () => {
  const f = fixture();
  try {
    const body = f.body([bytes('<Code>')], { hold: true, cancel: 'hang' });
    let headers!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { headers = resolve; });
    const call = f.upload(body, true, pending); let settled = false;
    const result = outcome(call.result).then(value => { settled = true; return value; });
    await flush(); f.advance(6000); await flush();
    expect(f.timers.made).toBe(0); expect(call.signal?.aborted).toBe(false); expect(settled).toBe(false);
    headers(body.response); await flush(); expect(f.timers.made).toBe(1);
    f.advance(2500); body.enqueue(bytes('AccessDenied')); await flush();
    f.advance(2499); await flush(); expect(settled).toBe(false); expect(call.signal?.aborted).toBe(false);
    f.advance(1); await flush(); expect(settled).toBe(true);
    const completed = await result; f.check();
    expect(completed.ok).toBe(true); if (!completed.ok || !record(completed.value)) throw new Error('Original fallback must resolve');
    expect(completed.value.provider).toBe('database'); expect(f.warnings[0].objectStorageCode).toBe('unknown');
    expect(call.signal).toBe(call.controller?.signal); expect(f.operations.abortCalls).toBe(1);
    expect(body.stats.readerCancels).toBe(1); expect(body.stats.releases).toBe(1);
    expect(f.timers.made).toBe(1); expect(f.timers.fired).toBe(1); expect(f.timers.cleared).toBe(1);
    f.advance(10000); await flush(); expect(f.operations.fetchAttempts).toBe(1); expect(f.warnings).toHaveLength(1);
  } finally { f.finish(); }
});

it('05 abort read acquisition and cancel failures stay unknown with settled readers and no retries', async () => {
  for (const mode of ['abort', 'read-error', 'acquisition', 'cancel-reject', 'missing-body'] as const) {
    const f = fixture(); const unhandled: unknown[] = [], listener = (value: unknown) => { unhandled.push(value); };
    process.on('unhandledRejection', listener);
    try {
      const body = f.body(mode === 'cancel-reject' ? [bytes(xml)] : [], {
        hold: mode === 'abort', readError: mode === 'read-error', acquisitionError: mode === 'acquisition',
        cancel: mode === 'cancel-reject' ? 'reject' : 'normal', noBody: mode === 'missing-body',
      });
      const controller = f.controller(body), pending = readStoryVisualStorageErrorCode(body.response, controller);
      await flush(); if (mode === 'abort') controller.abort();
      expect(await pending).toBe(mode === 'cancel-reject' ? 'AccessDenied' : 'unknown'); await flush(); f.check();
      expect(unhandled).toEqual([]); expect(body.stats.texts).toBe(0); expect(f.operations.fetchAttempts).toBe(0);
      if (!['acquisition', 'missing-body'].includes(mode)) {
        expect(body.stats.readerCancels).toBe(1); expect(body.stats.releases).toBe(1); expect(body.stream.locked).toBe(false);
      } else { expect(body.stats.readerCancels).toBe(0); expect(f.timers.made).toBe(0); }
    } finally { process.off('unhandledRejection', listener); f.finish(); }
  }
});

// Default Jest keeps five pure registrations; only the admitted runner enables this real listener.
const ownedHttpTest = process.env.STORY_STORAGE_ERROR_HTTP_ADMITTED === '1' ? it : it.skip;
ownedHttpTest('06 owned loopback PUT stall aborts its real transport after the helper body deadline', async () => {
  type HttpObservation = { passed: boolean; requests: number; requestBytes: number; status: number;
    abortCalls: number; responseClosed: number; serverClosed: boolean; activeSockets: number;
    connections: number; socketCloses: number; forceCleanup: number; faults: number;
    activeTimers: number; elapsedBodyMs: number };
  const http = require('node:http') as typeof import('node:http') & {
    storyStorageErrorOwnedHttp?: (reader: typeof readStoryVisualStorageErrorCode) => Promise<HttpObservation>;
  };
  if (typeof http.storyStorageErrorOwnedHttp !== 'function')
    throw new Error('Current-only guarded own-loopback admission is required; no fallback listener');
  const observation = await http.storyStorageErrorOwnedHttp(readStoryVisualStorageErrorCode);
  process.stdout.write('STORY_STORAGE_ERROR_HTTP_OBSERVATION ' + JSON.stringify(observation) + '\n');
  expect(observation.passed).toBe(true); expect(observation.requests).toBe(1);
  expect(observation.requestBytes).toBe(32); expect(observation.status).toBe(503);
  expect(observation.abortCalls).toBe(1); expect(observation.responseClosed).toBe(1);
  expect(observation.serverClosed).toBe(true); expect(observation.activeSockets).toBe(0);
  expect(observation.connections).toBeGreaterThanOrEqual(1);
  expect(observation.socketCloses).toBe(observation.connections);
  expect(observation.forceCleanup).toBe(0); expect(observation.faults).toBe(0); expect(observation.activeTimers).toBe(0);
}, 20000);
