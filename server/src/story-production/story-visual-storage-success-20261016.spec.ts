import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as vm from 'node:vm';
import * as ts from 'typescript';

const NativeResponse = globalThis.Response;
const NativeStream = globalThis.ReadableStream;
const NativeAbortController = globalThis.AbortController;
const NativeAbortSignal = globalThis.AbortSignal;
const phase = process.env.STORY_STORAGE_SUCCESS_PHASE ?? 'current';
if (!['baseline', 'current'].includes(phase)) throw new Error('Unadmitted success-body phase');
const httpAdmission = process.env.STORY_STORAGE_SUCCESS_HTTP_ADMITTED;
if (httpAdmission !== undefined && (httpAdmission !== '1' || phase !== 'current'))
  throw new Error('Unadmitted success-body HTTP phase');

const sourcePath = process.env.STORY_STORAGE_SUCCESS_SOURCE ?? join(__dirname, 'story-visual-generation.service.ts');
if (process.env.STORY_STORAGE_SUCCESS_SOURCE !== undefined) {
  const canonical = resolve(sourcePath).replace(/\\/g, '/').toLowerCase();
  if (!/^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-visual-upload-success-body\/focused-(?:baseline|current)-[a-f0-9]{12}\/capsule\/context\/story-visual-generation\.service\.ts$/.test(canonical) ||
    realpathSync(sourcePath).replace(/\\/g, '/').toLowerCase() !== canonical)
    throw new Error('Unadmitted actual upload context');
}
const rawSource = readFileSync(sourcePath);
if (rawSource[0] === 0xef && rawSource[1] === 0xbb && rawSource[2] === 0xbf)
  throw new Error('BOM is not admitted');
const decodedSource = new TextDecoder('utf-8', { fatal: true }).decode(rawSource);
if (decodedSource.includes('\r') && /[\r\n]/.test(decodedSource.replace(/\r\n/g, '')))
  throw new Error('Mixed or bare-CR source is not admitted');
const actualSource = decodedSource.replace(/\r\n/g, '\n');
const sourceSha = createHash('sha256').update(actualSource).digest('hex');
const expectedSourceSha = phase === 'baseline'
  ? '39845ffd03190df426a82a619c59f562461f23e1dc430a1416a5b2bb6b938826'
  : '21a1cb8303414b03f539284adbf4ab2031cefcc9eaeff5b707b421429802e441';
if (sourceSha !== expectedSourceSha) throw new Error('Actual whole-source version mismatch');

// Only the actual method is compiled as data; the paid service module is never imported.
const parsed = ts.createSourceFile('actual-visual-service.ts', actualSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const classes = parsed.statements.filter(ts.isClassDeclaration)
  .filter(value => value.name?.text === 'StoryVisualGenerationService');
if (classes.length !== 1) throw new Error('Exactly one actual visual service is required');
const methods = classes[0].members.filter(ts.isMethodDeclaration)
  .filter(value => ts.isIdentifier(value.name) && value.name.text === 'uploadImage');
if (methods.length !== 1) throw new Error('Exactly one actual uploadImage is required');
const methodSource = methods[0].getText(parsed);
const emitted = ts.transpileModule('class CapturedUpload {\n' + methodSource + '\n}', {
  compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true,
});
if ((emitted.diagnostics ?? []).some(value => value.category === ts.DiagnosticCategory.Error))
  throw new Error('Actual uploadImage must transpile without errors');

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const flush = async () => { for (let index = 0; index < 64; index++) await Promise.resolve(); };
const variant = 'synthetic-variant';
const expectedKey = 'synthetic-prefix/story-visuals/synthetic-work/synthetic-release/synthetic-scene/' +
  createHash('sha256').update(variant).digest('hex').slice(0, 16) +
  '-synthetic-prompt-hash-synthetic-model-synthetic-quality-1024x1536.webp';
const syntheticUrl = 'https://storage.invalid/synthetic-put';
type Fetch = (url: string, options: RequestInit) => Promise<Response>;
type Transport = { url: string; fetch: Fetch };
type SuccessProof = { cancelCalls: number; textCalls: number; getReaders: number; helperCalls: number;
  abortCalls: number; putAttempts: number; fixtureFaults: number; provider: string; key: string };
type HttpObservation = {
  passed: boolean; requests: number; requestBytes: number; status: number;
  responseOnlyAfterRequestEnd: boolean; responseClosed: number; serverClosed: boolean;
  connections: number; socketCloses: number; clientConnections: number; clientSocketCloses: number;
  activeServerSockets: number; activeClientSockets: number; activeRequests: number;
  activeResponses: number; activeTimers: number; forceCleanup: number; faults: number;
};

function bodyFixture(mode: 'normal' | 'reject' | 'hang' | 'null' = 'normal') {
  const stats = { pulls: 0, sourceCancels: 0 };
  const stream = new NativeStream<Uint8Array>({
    pull() { stats.pulls++; throw new Error('Unused synthetic success body was pulled'); },
    cancel() {
      stats.sourceCancels++;
      if (mode === 'reject') return Promise.reject(new Error('Synthetic cancel rejection'));
      if (mode === 'hang') return new Promise<void>(() => undefined);
    },
  }, { highWaterMark: 0 });
  return { response: new NativeResponse(mode === 'null' ? null : stream, { status: 200 }), stats };
}

function fixture(plan: { response: Response } | { transport: Transport }) {
  const faults: string[] = [];
  const fail = (code: string): never => { faults.push(code); throw new Error(code); };
  const stats = { invocations: 0, putAttempts: 0, responses: 0, controllerConstructors: 0,
    cancelCalls: 0, textCalls: 0, getReaders: 0, helperCalls: 0, abortCalls: 0,
    fallbackCalls: 0, logCalls: 0, signingCalls: 0 };
  const image = Buffer.from(Array.from({ length: 32 }, (_, index) => (index * 17) % 256));
  let signal: AbortSignal | undefined;
  let observedResponse: Response | undefined;
  const url = 'transport' in plan ? plan.transport.url : syntheticUrl;
  class ObservedController extends NativeAbortController {
    constructor() { super(); stats.controllerConstructors++; }
    abort(reason?: unknown) { stats.abortCalls++; super.abort(reason); }
  }
  const fetch: Fetch = async (input, options) => {
    // Attempts and faults are latched before validation, outside any product catch.
    stats.putAttempts++;
    if (stats.putAttempts !== 1 || input !== url || !options ||
      Object.keys(options).sort().join(',') !== 'body,headers,method,signal' ||
      options.method !== 'PUT' || options.body !== image || !record(options.headers) ||
      Object.keys(options.headers).join(',') !== 'content-type' || options.headers['content-type'] !== 'image/webp' ||
      !(options.signal instanceof NativeAbortSignal) || options.signal.aborted)
      return fail('SUCCESS_PUT_ADMISSION');
    signal = options.signal;
    const response = 'transport' in plan ? await plan.transport.fetch(input, options) : plan.response;
    stats.responses++;
    if (!(response instanceof NativeResponse) || response.status !== 200 || !response.ok)
      return fail('SUCCESS_RESPONSE_ADMISSION');
    observedResponse = response;
    response.text = () => { stats.textCalls++; return fail('SUCCESS_TEXT_CONSUMPTION'); };
    if (response.body) {
      const body = response.body, cancel = body.cancel.bind(body);
      body.getReader = (() => { stats.getReaders++; return fail('SUCCESS_READER_CONSUMPTION'); }) as typeof body.getReader;
      body.cancel = reason => {
        stats.cancelCalls++;
        if (stats.cancelCalls !== 1 || reason !== undefined) return fail('SUCCESS_CANCEL_ADMISSION');
        // Rejection/hanging cancellation belongs to the scripted body, not an admission fault.
        return cancel(reason);
      };
    }
    return response;
  };
  const helper = () => { stats.helperCalls++; return fail('SUCCESS_ERROR_HELPER_CALLED'); };
  const fn: (this: object, ...args: unknown[]) => Promise<unknown> = new vm.Script(
    emitted.outputText + '\nCapturedUpload.prototype.uploadImage;', { filename: 'actual-uploadImage-only.js' })
    .runInNewContext({ fetch, readStoryVisualStorageErrorCode: helper, AbortController: ObservedController, Buffer },
      { timeout: 2500 });
  const allowed: Record<string, unknown> = {
    requiredEnv(...args: unknown[]) {
      if (args.length !== 1 || args[0] !== 'OBJECT_STORAGE_PROVIDER') return fail('SUCCESS_CONFIG_ADMISSION');
      return 'r2';
    },
    storageKeyPrefix(...args: unknown[]) { if (args.length) return fail('SUCCESS_PREFIX_ARGUMENTS'); return 'synthetic-prefix'; },
    model(...args: unknown[]) { if (args.length) return fail('SUCCESS_MODEL_ARGUMENTS'); return 'synthetic-model'; },
    size(...args: unknown[]) { if (args.length) return fail('SUCCESS_SIZE_ARGUMENTS'); return '1024x1536'; },
    sha256Hex(...args: unknown[]) {
      if (args.length !== 1 || args[0] !== variant) return fail('SUCCESS_HASH_ADMISSION');
      return createHash('sha256').update(variant).digest('hex');
    },
    presignedPutUrl(...args: unknown[]) {
      stats.signingCalls++;
      if (stats.signingCalls !== 1 || args.length !== 3 || args[0] !== 'r2' || args[1] !== expectedKey || args[2] !== 'image/webp')
        return fail('SUCCESS_SIGNING_ADMISSION');
      return url;
    },
    databaseFallbackEnabled() { stats.fallbackCalls++; return fail('SUCCESS_FALLBACK_CALLED'); },
    logger: { warn() { stats.logCalls++; return fail('SUCCESS_WARNING_EMITTED'); } },
  };
  const context = new Proxy(allowed, { get(target, key) {
    if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(target, key))
      return fail('SUCCESS_CONTEXT_ADMISSION');
    return target[key];
  } });
  return {
    stats, faults,
    invoke() {
      stats.invocations++;
      if (stats.invocations !== 1) return fail('SUCCESS_INVOCATION_ADMISSION');
      return fn.call(context, 'synthetic-work', 'synthetic-release', 'synthetic-scene', variant,
        'synthetic-prompt-hash', 'synthetic-quality', image);
    },
    check() {
      expect(faults).toEqual([]); expect(stats.invocations).toBe(1); expect(stats.putAttempts).toBe(1);
      expect(stats.responses).toBe(1); expect(stats.controllerConstructors).toBe(1); expect(stats.signingCalls).toBe(1);
      expect(stats.textCalls).toBe(0); expect(stats.getReaders).toBe(0); expect(stats.helperCalls).toBe(0);
      expect(stats.fallbackCalls).toBe(0); expect(stats.logCalls).toBe(0); expect(stats.abortCalls).toBe(0);
      expect(signal).toBeDefined(); expect(signal?.aborted).toBe(false);
    },
    success(value: unknown): SuccessProof {
      if (!record(value)) return fail('SUCCESS_RESULT_SHAPE');
      expect(Object.keys(value).sort()).toEqual(['key', 'provider']);
      expect(value.provider).toBe('r2'); expect(value.key).toBe(expectedKey);
      return { cancelCalls: stats.cancelCalls, textCalls: stats.textCalls, getReaders: stats.getReaders,
        helperCalls: stats.helperCalls, abortCalls: stats.abortCalls, putAttempts: stats.putAttempts,
        fixtureFaults: faults.length, provider: String(value.provider), key: String(value.key) };
    },
    finish() {
      expect(faults).toEqual([]); expect(stats.abortCalls).toBe(0);
      if (observedResponse?.body) expect(observedResponse.body.locked).toBe(false);
    },
  };
}

it('01 actual successful upload returns its original key and cancels the unused native body', async () => {
  const body = bodyFixture(), f = fixture({ response: body.response });
  try {
    const result = await f.invoke(); await flush(); f.check(); f.success(result);
    expect(body.stats.pulls).toBe(0);
    // Qualified baseline RED occurs only after the actual method succeeded and admission passed.
    if (f.stats.cancelCalls !== 1) throw new Error('UNCANCELLED_SUCCESS_BODY');
    expect(body.stats.sourceCancels).toBe(1);
  } finally { f.finish(); }
});

it('02 null rejected and hanging success cancellation never changes or delays the original result', async () => {
  const unhandled: unknown[] = [], listener = (value: unknown) => { unhandled.push(value); };
  process.on('unhandledRejection', listener);
  try {
    for (const mode of ['null', 'reject', 'hang'] as const) {
      const body = bodyFixture(mode), f = fixture({ response: body.response });
      try {
        let settled = false;
        const pending = f.invoke().then(value => { settled = true; return value; });
        await flush();
        expect(settled).toBe(true);
        const result = await pending; f.check(); f.success(result);
        expect(f.stats.cancelCalls).toBe(mode === 'null' ? 0 : 1);
        expect(body.stats.sourceCancels).toBe(mode === 'null' ? 0 : 1); expect(body.stats.pulls).toBe(0);
        await new Promise<void>(done => setImmediate(done));
        await new Promise<void>(done => setImmediate(done));
        expect(unhandled).toEqual([]); f.check();
      } finally { f.finish(); }
    }
  } finally { process.off('unhandledRejection', listener); }
});

// Only the separately admitted current runner may supply a real native HTTP bridge.
const ownedHttpTest = httpAdmission === '1' ? it : it.skip;
ownedHttpTest('03 owned native PUT closes its unused successful response after receiving the full request', async () => {
  const http = require('node:http') as typeof import('node:http') & {
    storyVisualSuccessOwnedHttp?: (run: (transport: Transport) => Promise<SuccessProof>) => Promise<HttpObservation>;
  };
  if (typeof http.storyVisualSuccessOwnedHttp !== 'function')
    throw new Error('Current-only own HTTP bridge required; no fallback server or fetch');
  const outerFaults: string[] = [];
  const state: { calls: number; fixture?: ReturnType<typeof fixture>; proof?: SuccessProof } = { calls: 0 };
  try {
    const observation = await http.storyVisualSuccessOwnedHttp(async transport => {
      state.calls++;
      if (state.calls !== 1 || !transport || typeof transport.fetch !== 'function' ||
        !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/storage-success$/.test(transport.url)) {
        outerFaults.push('SUCCESS_HTTP_BRIDGE_ADMISSION');
        throw new Error('SUCCESS_HTTP_BRIDGE_ADMISSION');
      }
      state.fixture = fixture({ transport });
      const result = await state.fixture.invoke(); await flush(); state.fixture.check();
      state.proof = state.fixture.success(result);
      expect(state.proof.cancelCalls).toBe(1);
      return state.proof;
    });
    expect(outerFaults).toEqual([]); expect(state.calls).toBe(1);
    if (!state.fixture || !state.proof) throw new Error('Bridge did not run the actual captured method');
    state.fixture.check();
    expect(state.proof.cancelCalls).toBe(1); expect(state.proof.fixtureFaults).toBe(0);
    expect(observation.passed).toBe(true); expect(observation.requests).toBe(1);
    expect(observation.requestBytes).toBe(32); expect(observation.status).toBe(200);
    expect(observation.responseOnlyAfterRequestEnd).toBe(true); expect(observation.responseClosed).toBe(1);
    expect(observation.serverClosed).toBe(true); expect(observation.connections).toBeGreaterThanOrEqual(1);
    expect(observation.socketCloses).toBe(observation.connections);
    expect(observation.clientConnections).toBeGreaterThanOrEqual(1);
    expect(observation.clientSocketCloses).toBe(observation.clientConnections);
    expect(observation.activeServerSockets).toBe(0); expect(observation.activeClientSockets).toBe(0);
    expect(observation.activeRequests).toBe(0); expect(observation.activeResponses).toBe(0);
    expect(observation.activeTimers).toBe(0); expect(observation.forceCleanup).toBe(0); expect(observation.faults).toBe(0);
    console.log('STORY_STORAGE_SUCCESS_HTTP_OBSERVATION ' + JSON.stringify(observation));
  } finally {
    state.fixture?.finish();
    expect(outerFaults).toEqual([]);
  }
}, 20000);
