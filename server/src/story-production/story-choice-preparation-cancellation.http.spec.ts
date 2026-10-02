import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import {
  StoryChoicePreparationProvider,
  type StoryChoicePreparationInput,
  type StoryChoiceTransport,
} from './story-choice-preparation.provider';

// Mirror the provider's private MAX_RESPONSE_BYTES without widening its API.
const MAX_RESPONSE_BYTES = 65_536;
const EVENT_TIMEOUT_MS = 8_000;
const TEST_TIMEOUT_MS = 30_000;
const input: StoryChoicePreparationInput = {
  workTitle: '\ubc24\uc758 \uae30\ub85d',
  parts: [{
    partKey: 'part-1',
    title: '\uc7a0\uae34 \uc11c\uc7ac',
    endingExcerpt: '\uc11c\uc7ac \ubb38 \ub4a4\uc5d0\uc11c \ubc1c\uc18c\ub9ac\uac00 \ub4e4\ub9b0\ub2e4.',
    originalChoiceLabel: '\ubb38\uc744 \uc5f4\uace0 \ub4e4\uc5b4\uac04\ub2e4',
    context: '\ub3d9\ub8cc\uac00 \ubcf5\ub3c4\uc5d0\uc11c \uae30\ub2e4\ub9b0\ub2e4.',
  }],
};
const validChoices = {
  choices: {
    'part-1': {
      first: '\ubcf5\ub3c4\ub85c \ub3cc\uc544\uac00 \ub3d9\ub8cc\uc5d0\uac8c \ub3c4\uc6c0\uc744 \uccad\ud55c\ub2e4',
      second: '\ucc3d\ubb38 \ubc16\uc73c\ub85c \ub098\uac00 \ubc1c\uc790\uad6d\uc744 \ucd94\uc801\ud55c\ub2e4',
    },
  },
};
const validUsage = {
  input_tokens: 120,
  output_tokens: 80,
  total_tokens: 200,
  input_tokens_details: { cached_tokens: 30 },
  output_tokens_details: { reasoning_tokens: 50 },
};
const completedBody = JSON.stringify({
  status: 'completed',
  usage: validUsage,
  output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(validChoices) }] },
  ],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>, description: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(description)), EVENT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type HttpFixture = {
  transport: jest.Mock<ReturnType<StoryChoiceTransport>, Parameters<StoryChoiceTransport>>;
  headersReceived: Promise<Response>;
  track<T>(promise: Promise<T>): Promise<T>;
  close(): Promise<void>;
};
const fixtures: HttpFixture[] = [];

async function localServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<HttpFixture> {
  const sockets = new Set<Socket>();
  const responses = new Set<Response>();
  const pending = new Set<Promise<void>>();
  const headersReceived = deferred<Response>();
  let closing = false;
  let localURL = '';
  const server = createServer((request, response) => {
    request.resume();
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Connection', 'close');
    handler(request, response);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    if (closing) socket.destroy();
  });
  const transport = jest.fn<ReturnType<StoryChoiceTransport>, Parameters<StoryChoiceTransport>>(
    async (_providerURL, args) => {
      // The provider URL is never fetched; only this literal loopback fixture is used.
      const response = await fetch(localURL, args);
      responses.add(response);
      headersReceived.resolve(response);
      return response;
    },
  );
  const fixture: HttpFixture = {
    transport,
    headersReceived: headersReceived.promise,
    track<T>(promise: Promise<T>): Promise<T> {
      const settled = promise.then(() => undefined, () => undefined);
      pending.add(settled);
      void settled.then(() => pending.delete(settled));
      return promise;
    },
    async close() {
      closing = true;
      const closed = server.listening
        ? new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        })
        : Promise.resolve();
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      try {
        await bounded(Promise.all([closed, ...pending]), 'HTTP fixture did not finish cleanup');
      } finally {
        for (const response of responses) {
          if (response.body && !response.body.locked) {
            await bounded(response.body.cancel().catch(() => undefined), 'Response cleanup stalled');
          }
        }
      }
    },
  };
  // Register before listening so setup failures also run through afterEach cleanup.
  fixtures.push(fixture);
  let onError!: (error: Error) => void;
  try {
    await bounded(new Promise<void>((resolve, reject) => {
      onError = reject;
      server.once('error', onError);
      server.listen(0, '127.0.0.1', resolve);
    }), 'Loopback HTTP server did not listen');
  } finally {
    server.removeListener('error', onError);
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback TCP address');
  localURL = `http://127.0.0.1:${address.port}/responses`;
  return fixture;
}

function providerFor(fixture: HttpFixture, timeoutMs = 10_000) {
  return new StoryChoicePreparationProvider(
    { apiKey: 'unit-test-key', model: 'gpt-5-mini', timeoutMs }, fixture.transport,
  );
}

describe('StoryChoicePreparationProvider loopback HTTP body cancellation', () => {
  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) await fixture.close();
  }, TEST_TIMEOUT_MS);

  it('reads a completed structured response and reports validated usage once', async () => {
    const fixture = await localServer((_request, response) => response.end(completedBody));
    const onUsage = jest.fn();

    await expect(fixture.track(providerFor(fixture).generate(input, onUsage))).resolves.toEqual([{
      partKey: 'part-1',
      originalChoiceLabel: input.parts[0].originalChoiceLabel,
      alternatives: [validChoices.choices['part-1'].first, validChoices.choices['part-1'].second],
    }]);
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 120, outputTokens: 80, cachedInputTokens: 30, reasoningTokens: 50,
    });
    expect(fixture.transport).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String(fixture.transport.mock.calls[0][1]?.body));
    expect(requestBody.text.format).toMatchObject({ type: 'json_schema', strict: true });
    expect(requestBody.text.format.schema.properties.choices.properties['part-1'].required)
      .toEqual(['first', 'second']);
    const response = await bounded(fixture.headersReceived, 'Completed response headers missing');
    expect(response.headers.get('connection')).toBe('close');
    expect(response.bodyUsed).toBe(true);
    expect(response.body?.locked).toBe(false);
  }, TEST_TIMEOUT_MS);

  it('times out after headers and a stalled body, closing the socket without reporting usage', async () => {
    const socketClosed = deferred<void>();
    const bodyClosed = deferred<void>();
    let upstream: ServerResponse | undefined;
    const fixture = await localServer((request, response) => {
      upstream = response;
      request.socket.once('close', () => socketClosed.resolve(undefined));
      response.once('close', () => bodyClosed.resolve(undefined));
      response.flushHeaders();
      response.write(completedBody.slice(0, -1));
    });
    const onUsage = jest.fn();
    const generation = fixture.track(providerFor(fixture, 1_500).generate(input, onUsage));
    const response = await bounded(fixture.headersReceived, 'Stalled response headers missing');

    expect(response.status).toBe(200);
    expect(response.headers.get('connection')).toBe('close');
    await bounded(expect(generation).rejects.toMatchObject({ code: 'timeout' }), 'Provider timeout missing');
    // These events must precede teardown, which would otherwise mask a cancellation failure.
    await bounded(Promise.all([socketClosed.promise, bodyClosed.promise]), 'Stalled body/socket stayed open');
    expect(upstream?.destroyed).toBe(true);
    expect(upstream?.writableEnded).toBe(false);
    expect(response.body?.locked).toBe(false);
    expect(onUsage).not.toHaveBeenCalled();
  }, TEST_TIMEOUT_MS);

  it('rejects a chunked stream over MAX_RESPONSE_BYTES and closes its unfinished body', async () => {
    const socketClosed = deferred<void>();
    const bodyClosed = deferred<void>();
    let upstream: ServerResponse | undefined;
    const fixture = await localServer((request, response) => {
      upstream = response;
      request.socket.once('close', () => socketClosed.resolve(undefined));
      response.once('close', () => bodyClosed.resolve(undefined));
      response.flushHeaders();
      // Separate chunks cross the byte limit without a length header or producer timers.
      response.write(Buffer.alloc(MAX_RESPONSE_BYTES, 'x'));
      response.write('x');
    });
    const onUsage = jest.fn();
    const generation = fixture.track(providerFor(fixture).generate(input, onUsage));
    const response = await bounded(fixture.headersReceived, 'Oversized response headers missing');

    expect(response.headers.get('content-length')).toBeNull();
    expect(response.headers.get('transfer-encoding')).toBe('chunked');
    expect(response.headers.get('connection')).toBe('close');
    await bounded(
      expect(generation).rejects.toMatchObject({ code: 'response_too_large' }),
      'Stream size rejection missing',
    );
    await bounded(Promise.all([socketClosed.promise, bodyClosed.promise]), 'Oversized body/socket stayed open');
    expect(upstream?.destroyed).toBe(true);
    expect(upstream?.writableEnded).toBe(false);
    expect(response.body?.locked).toBe(false);
    expect(onUsage).not.toHaveBeenCalled();
  }, TEST_TIMEOUT_MS);
});
