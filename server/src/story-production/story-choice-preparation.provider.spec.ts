import {
  AuthoredPartChoiceInput,
  StoryChoicePreparationProvider,
  StoryChoiceTransport,
} from './story-choice-preparation.provider';

const parts: AuthoredPartChoiceInput[] = [
  {
    partKey: 'part-1',
    title: '잠긴 서재',
    endingExcerpt: '서재 문 뒤에서 발소리가 들린다.',
    originalChoiceLabel: '문을 열고 들어간다',
    context: '동료가 복도에서 기다린다.',
  },
  {
    partKey: 'part-2',
    title: '사라진 편지',
    endingExcerpt: '편지의 마지막 문장이 지워져 있다.',
    originalChoiceLabel: '편지를 공개한다',
  },
];
const input = { workTitle: '밤의 기록', parts };

const validChoices = {
  choices: {
    'part-1': {
      first: '복도로 돌아가 동료에게 도움을 청한다',
      second: '창문 밖으로 나가 발자국을 추적한다',
    },
    'part-2': {
      first: '편지를 봉인하고 필체를 조사한다',
      second: '편지를 태워 증거를 없앤다',
    },
  },
};

function apiResponse(choices: unknown, status = 'completed'): Response {
  return new Response(JSON.stringify({
    status,
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(choices) }] },
    ],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function providerWith(response: Response) {
  const transport = jest.fn<ReturnType<StoryChoiceTransport>, Parameters<StoryChoiceTransport>>()
    .mockResolvedValue(response);
  return {
    provider: new StoryChoicePreparationProvider(
      { apiKey: 'unit-test-key', model: 'gpt-5-mini' }, transport,
    ),
    transport,
  };
}

describe('StoryChoicePreparationProvider', () => {
  it('accepts authored paragraphs with line breaks as source context', async () => {
    const { provider, transport } = providerWith(apiResponse(validChoices));
    const paragraphInput = {
      ...input,
      parts: input.parts.map((part, index) => index === 0
        ? { ...part, endingExcerpt: '첫 문장.\n\n마지막 문장.', context: '인물 A.\n인물 B.' }
        : part),
    };
    await expect(provider.generate(paragraphInput)).resolves.toHaveLength(2);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('requests a strict per-part schema and returns two labels in input order', async () => {
    const { provider, transport } = providerWith(apiResponse(validChoices));

    await expect(provider.generate(input)).resolves.toEqual([
      {
        partKey: 'part-1',
        alternatives: [
          '복도로 돌아가 동료에게 도움을 청한다',
          '창문 밖으로 나가 발자국을 추적한다',
        ],
      },
      {
        partKey: 'part-2',
        alternatives: ['편지를 봉인하고 필체를 조사한다', '편지를 태워 증거를 없앤다'],
      },
    ]);

    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(options).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer unit-test-key',
        'Content-Type': 'application/json',
      },
    });
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({ model: 'gpt-5-mini', store: false });
    expect(body.input).toBe(JSON.stringify(input));
    expect(body.instructions).toContain('Do not force the paths to converge');
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
    expect(body.text.format.schema).toEqual({
      type: 'object',
      properties: {
        choices: {
          type: 'object',
          properties: {
            'part-1': {
              type: 'object',
              properties: { first: { type: 'string' }, second: { type: 'string' } },
              required: ['first', 'second'],
              additionalProperties: false,
            },
            'part-2': {
              type: 'object',
              properties: { first: { type: 'string' }, second: { type: 'string' } },
              required: ['first', 'second'],
              additionalProperties: false,
            },
          },
          required: ['part-1', 'part-2'],
          additionalProperties: false,
        },
      },
      required: ['choices'],
      additionalProperties: false,
    });
    expect(body.max_output_tokens).toBeLessThanOrEqual(1_600);
  });

  it.each([
    [[], 'invalid_batch'],
    [Array(9).fill(parts[0]), 'invalid_batch'],
    [[parts[0], parts[0]], 'invalid_input'],
    [[{ ...parts[0], endingExcerpt: 'x'.repeat(1_201) }], 'invalid_input'],
    [[{ ...parts[0], partKey: '__proto__' }], 'invalid_input'],
    [[{ ...parts[0], context: '\n' }], 'invalid_input'],
  ])('rejects invalid input before HTTP', async (input, code) => {
    const { provider, transport } = providerWith(apiResponse(validChoices));
    await expect(provider.generate({ workTitle: '밤의 기록', parts: input as AuthoredPartChoiceInput[] }))
      .rejects.toMatchObject({ code });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    { choices: { 'part-1': validChoices.choices['part-1'] } },
    { choices: { ...validChoices.choices, extra: validChoices.choices['part-1'] } },
    { choices: { ...validChoices.choices, 'part-1': { first: '복도로 간다' } } },
    { choices: { ...validChoices.choices, 'part-1': { ...validChoices.choices['part-1'], third: '추가' } } },
  ])('rejects missing, extra, or incorrectly counted part choices', async (output) => {
    const { provider } = providerWith(apiResponse(output));
    await expect(provider.generate(input)).rejects.toMatchObject({ code: 'invalid_output' });
  });

  it.each([
    ['문을 열고 들어간다', '창문 밖으로 나가 발자국을 추적한다'],
    ['문을 열고 들어가기로 한다', '창문 밖으로 나가 발자국을 추적한다'],
    ['복도로 돌아가 동료에게 도움을 청한다', '복도로 돌아가 동료에게 도움을 청한다'],
    ['다음 챕터로', '창문 밖으로 나가 발자국을 추적한다'],
    ['다음 장으로 넘어간다', '창문 밖으로 나가 발자국을 추적한다'],
    ['계속 읽기', '창문 밖으로 나가 발자국을 추적한다'],
    ['<script>악성</script>', '창문 밖으로 나가 발자국을 추적한다'],
    ['https://example.com 방문', '창문 밖으로 나가 발자국을 추적한다'],
    ['가'.repeat(121), '창문 밖으로 나가 발자국을 추적한다'],
    ['   ', '창문 밖으로 나가 발자국을 추적한다'],
  ])('rejects unsafe, generic, or insufficiently distinct labels', async (first, second) => {
    const output = {
      choices: {
        ...validChoices.choices,
        'part-1': { first, second },
      },
    };
    const { provider } = providerWith(apiResponse(output));
    await expect(provider.generate(input)).rejects.toMatchObject({ code: 'invalid_output' });
  });

  it('rejects HTTP, malformed, refusal, and incomplete responses without exposing manuscript', async () => {
    const responses = [
      new Response('upstream detail', { status: 503 }),
      new Response('{not json'),
      new Response(JSON.stringify({ status: 'completed', output: [
        { type: 'message', content: [{ type: 'refusal', refusal: 'No' }] },
      ] })),
      apiResponse(validChoices, 'incomplete'),
    ];
    for (const [index, response] of responses.entries()) {
      const { provider } = providerWith(response);
      await expect(provider.generate(input)).rejects.toMatchObject({
        code: ['provider_http_503', 'invalid_response', 'invalid_response', 'incomplete_response'][index],
        message: expect.not.stringContaining(parts[0].endingExcerpt),
      });
    }
  });

  it('rejects oversized responses by header or stream size', async () => {
    const byHeader = new Response('x', { headers: { 'Content-Length': '65537' } });
    const byStream = new Response('x'.repeat(65_537));
    for (const response of [byHeader, byStream]) {
      const { provider } = providerWith(response);
      await expect(provider.generate(input))
        .rejects.toMatchObject({ code: 'response_too_large' });
    }
  });

  it('times out an unresponsive transport and aborts its signal', async () => {
    let signal: AbortSignal | undefined;
    const transport: StoryChoiceTransport = async (_url, options) => {
      signal = options?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    };
    const provider = new StoryChoicePreparationProvider(
      { apiKey: 'unit-test-key', model: 'gpt-5-mini', timeoutMs: 10 }, transport,
    );
    await expect(provider.generate(input)).rejects.toMatchObject({ code: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });

  it('rejects an invalid work title and transport failure without leaking story text', async () => {
    const transport = jest.fn<ReturnType<StoryChoiceTransport>, Parameters<StoryChoiceTransport>>()
      .mockRejectedValue(new Error(parts[0].endingExcerpt));
    const provider = new StoryChoicePreparationProvider(
      { apiKey: 'unit-test-key', model: 'gpt-5-mini' }, transport,
    );
    await expect(provider.generate({ workTitle: '', parts }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    expect(transport).not.toHaveBeenCalled();
    await expect(provider.generate(input)).rejects.toMatchObject({
      code: 'request_failed',
      message: expect.not.stringContaining(parts[0].endingExcerpt),
    });
  });

  it('requires explicit credentials and model', () => {
    expect(() => new StoryChoicePreparationProvider({ apiKey: '', model: 'gpt-5-mini' }))
      .toThrow('not_configured');
    expect(() => new StoryChoicePreparationProvider({ apiKey: 'key', model: '' }))
      .toThrow('not_configured');
  });
});
