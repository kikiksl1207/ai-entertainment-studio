import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  parseTestAccountCommand,
  parseTestAccountFilter,
  TestAccountClassification,
} from './admin-test-account-policy';

const USER_ID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_USER_ID = '123e4567-e89b-42d3-a456-426614174001';
const KEY = 'synthetic-private-header:01';
const validBody = () => ({ classification: 'test', expectedRevision: 0, reasonCode: 'qa_owned' });
const parseBody = (body: unknown) => parseTestAccountCommand(USER_ID, KEY, body);
const fields = ['classification', 'expectedRevision', 'reasonCode'] as const;

function expectInvalid(run: () => unknown, suffix: string) {
  let error: unknown;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(BadRequestException);
  const exception = error as BadRequestException;
  expect(exception.getStatus()).toBe(400);
  expect(exception.getResponse()).toEqual({
    code: `ADMIN_TEST_ACCOUNT_${suffix}_INVALID`,
    message: 'Invalid test account request',
  });
  expect(exception.message).toBe('Invalid test account request');
  expect(JSON.stringify(exception.getResponse())).not.toContain(KEY);
}

describe('parseTestAccountCommand', () => {
  it.each(['qa_owned', 'fixture', 'manual_confirmation'])('accepts test reason %s', reasonCode => {
    const command = parseBody({ ...validBody(), reasonCode });
    const classification: TestAccountClassification = command.classification;
    expect(classification).toBe('test');
    expect(command).toEqual({
      userId: USER_ID, idempotencyKey: KEY, classification: 'test', expectedRevision: 0,
      reasonCode, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('clears to unclassified without introducing a real-customer classification', () => {
    expect(parseBody({ classification: 'unclassified', expectedRevision: 4, reasonCode: 'clear' }))
      .toMatchObject({ classification: 'unclassified', expectedRevision: 4, reasonCode: 'clear' });
  });

  it('canonicalizes UUID case without modifying the input body or key', () => {
    const body = Object.freeze(validBody());
    const before = Object.getOwnPropertyDescriptors(body);
    const command = parseTestAccountCommand(USER_ID.toUpperCase(), 'QA.Key:_-01', body);
    expect(command.userId).toBe(USER_ID);
    expect(command.idempotencyKey).toBe('QA.Key:_-01');
    expect(Object.getOwnPropertyDescriptors(body)).toEqual(before);
    expect(Object.keys(command).sort()).toEqual([
      'classification', 'expectedRevision', 'fingerprint', 'idempotencyKey', 'reasonCode', 'userId',
    ]);
  });

  it('accepts repository UUID versions 1 through 5 and standard variants', () => {
    for (const version of [1, 2, 3, 4, 5]) {
      for (const variant of ['8', '9', 'a', 'b']) {
        const id = `123e4567-e89b-${version}2d3-${variant}456-426614174000`;
        expect(parseTestAccountCommand(id, KEY, validBody()).userId).toBe(id);
      }
    }
  });

  it.each<[string, unknown]>([
    ['missing', undefined], ['null', null], ['number', 123], ['NaN', NaN],
    ['boolean', true], ['bigint', 1n], ['symbol', Symbol('synthetic')],
    ['array', [USER_ID]], ['record', { id: USER_ID }], ['boxed', new String(USER_ID)],
    ['empty', ''], ['short', USER_ID.slice(0, -1)], ['long', `${USER_ID}0`],
    ['nil UUID', '00000000-0000-0000-0000-000000000000'],
    ['max UUID', 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
    ['version zero', '123e4567-e89b-02d3-a456-426614174000'],
    ['version six', '123e4567-e89b-62d3-a456-426614174000'],
    ['version seven', '123e4567-e89b-72d3-a456-426614174000'],
    ['version eight', '123e4567-e89b-82d3-a456-426614174000'],
    ['nonstandard variant', '123e4567-e89b-42d3-c456-426614174000'],
    ['legacy variant', '123e4567-e89b-42d3-7456-426614174000'],
    ['nonhex', '123g4567-e89b-42d3-a456-426614174000'],
    ['no hyphens', USER_ID.replace(/-/g, '')], ['braces', `{${USER_ID}}`],
    ['URN', `urn:uuid:${USER_ID}`], ['leading space', ` ${USER_ID}`],
    ['trailing space', `${USER_ID} `], ['trailing newline', `${USER_ID}\n`],
    ['embedded NUL', USER_ID.replace('e', '\0')],
  ])('rejects UUID: %s', (_label, userId) => {
    expectInvalid(() => parseTestAccountCommand(userId, KEY, validBody()), 'USER_ID');
  });

  it.each(['A'.repeat(8), 'z'.repeat(120), 'aZ09._:-'])('accepts key %s', key => {
    expect(parseTestAccountCommand(USER_ID, key, validBody()).idempotencyKey).toBe(key);
  });

  it.each<[string, unknown]>([
    ['missing', undefined], ['null', null], ['number', 12345678], ['boolean', false],
    ['array header', [KEY]], ['object header', { key: KEY }], ['boxed', new String(KEY)],
    ['symbol', Symbol('synthetic')], ['bigint', 12345678n], ['empty', ''],
    ['seven characters', 'a'.repeat(7)], ['121 characters', 'a'.repeat(121)],
    ['leading space', ` ${KEY}`], ['trailing space', `${KEY} `],
    ['embedded space', 'qa owned:01'], ['newline', `${KEY}\n`], ['CRLF', `${KEY}\r\n`],
    ['tab', `${KEY}\t`], ['NUL', `${KEY}\0`], ['slash', 'qa/owned:01'],
    ['comma', `${KEY},other`], ['percent', 'qa%owned:01'], ['at', 'qa@owned:01'],
    ['non-ASCII', 'synthetic-\u00e9'], ['Unicode lookalike', '\uff21'.repeat(8)],
  ])('rejects key: %s', (_label, key) => {
    expectInvalid(() => parseTestAccountCommand(USER_ID, key, validBody()), 'IDEMPOTENCY_KEY');
  });

  it.each<[string, unknown]>([
    ['missing', undefined], ['null', null], ['string', 'synthetic body'], ['number', 1],
    ['boolean', false], ['bigint', 1n], ['symbol', Symbol('synthetic')],
    ['function', () => validBody()], ['empty array', []], ['array', [validBody()]],
    ['date', new Date(0)], ['map', new Map()], ['set', new Set()], ['regexp', /synthetic/],
    ['empty record', {}], ['null prototype', Object.assign(Object.create(null), validBody())],
    ['custom prototype', Object.assign(Object.create({ inherited: true }), validBody())],
    ['inherited fields', Object.create(validBody())],
    ['class instance', Object.assign(new (class SyntheticBody {})(), validBody())],
    ['changed prototype', Object.assign(Object.create({ classification: 'test' }), validBody())],
  ])('rejects body: %s', (_label, body) => {
    expectInvalid(() => parseBody(body), 'BODY');
  });

  it.each(fields)('rejects missing own field %s', field => {
    const body: Record<string, unknown> = validBody();
    delete body[field];
    expectInvalid(() => parseBody(body), 'BODY');
  });

  it.each([
    'unknown', 'email', 'name', 'reason', 'userId', 'idempotencyKey', 'fingerprint',
    'constructor', 'prototype', '__proto__', 'toJSON',
  ])('rejects unknown own field %s without using it to infer classification', field => {
    const body = { ...validBody(), [field]: 'synthetic-person@example.invalid' };
    expectInvalid(() => parseBody(body), 'BODY');
  });

  it.each(fields)('rejects non-enumerable field %s', field => {
    const body = validBody();
    Object.defineProperty(body, field, { enumerable: false });
    expectInvalid(() => parseBody(body), 'BODY');
  });

  it('rejects an unknown non-enumerable field', () => {
    const body = validBody();
    Object.defineProperty(body, 'hidden', { value: 'synthetic-private-text' });
    expectInvalid(() => parseBody(body), 'BODY');
  });

  it.each([true, false])('rejects symbol fields with enumerable=%s', enumerable => {
    const body = validBody();
    Object.defineProperty(body, Symbol('synthetic'), { value: 1, enumerable });
    expectInvalid(() => parseBody(body), 'BODY');
  });

  it.each(fields)('rejects getter %s without invoking it', field => {
    const getter = jest.fn(() => { throw new Error('synthetic-private-getter-error'); });
    const body = validBody();
    Object.defineProperty(body, field, { enumerable: true, get: getter });
    expectInvalid(() => parseBody(body), 'BODY');
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(fields)('rejects setter-only field %s without invoking it', field => {
    const setter = jest.fn();
    const body = validBody();
    Object.defineProperty(body, field, { enumerable: true, set: setter });
    expectInvalid(() => parseBody(body), 'BODY');
    expect(setter).not.toHaveBeenCalled();
  });

  it('rejects an unknown accessor without invoking it', () => {
    const getter = jest.fn(() => 'synthetic-private-text');
    const body = validBody();
    Object.defineProperty(body, 'extra', { enumerable: true, get: getter });
    expectInvalid(() => parseBody(body), 'BODY');
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects proxy and revoked-proxy bodies without leaking trap errors', () => {
    const trap = jest.fn(() => { throw new Error('synthetic-private-trap-error'); });
    const proxy = new Proxy(validBody(), { getPrototypeOf: trap, ownKeys: trap, get: trap });
    expectInvalid(() => parseBody(proxy), 'BODY');
    expect(trap).not.toHaveBeenCalled();
    const revocable = Proxy.revocable(validBody(), {});
    revocable.revoke();
    expectInvalid(() => parseBody(revocable.proxy), 'BODY');
  });

  it.each<[string, unknown]>([
    ['missing value', undefined], ['null', null], ['boolean', true], ['number', 1],
    ['array', ['test']], ['object', { value: 'test' }], ['boxed', new String('test')],
    ['all', 'all'], ['real', 'real'], ['realcustomer', 'realcustomer'],
    ['customer', 'customer'], ['empty', ''], ['case variant', 'Test'],
    ['whitespace', 'test '], ['newline', 'test\n'],
  ])('rejects classification: %s', (_label, classification) => {
    expectInvalid(() => parseBody({ ...validBody(), classification }), 'CLASSIFICATION');
  });

  it.each([0, 1, 2147483645, 2147483646])('accepts expectedRevision %s', expectedRevision => {
    expect(parseBody({ ...validBody(), expectedRevision }).expectedRevision).toBe(expectedRevision);
  });

  it('canonicalizes integer negative zero to zero', () => {
    const command = parseBody({ ...validBody(), expectedRevision: -0 });
    expect(Object.is(command.expectedRevision, 0)).toBe(true);
    expect(command.fingerprint).toBe(parseBody(validBody()).fingerprint);
  });

  it.each<[string, unknown]>([
    ['missing value', undefined], ['null', null], ['NaN', NaN], ['Infinity', Infinity],
    ['negative Infinity', -Infinity], ['negative', -1], ['fractional', 0.5],
    ['negative fractional', -0.5], ['reserved overflow', 2147483647],
    ['32-bit overflow', 2147483648], ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['numeric string', '0'], ['empty string', ''], ['boolean', false],
    ['bigint', 0n], ['boxed', new Number(0)], ['array', [0]], ['record', { value: 0 }],
  ])('rejects expectedRevision: %s', (_label, expectedRevision) => {
    expectInvalid(() => parseBody({ ...validBody(), expectedRevision }), 'EXPECTED_REVISION');
  });

  it.each<[string, unknown]>([
    ['missing value', undefined], ['null', null], ['number', 1], ['boolean', true],
    ['array', ['fixture']], ['record', { reason: 'fixture' }], ['boxed', new String('fixture')],
    ['empty', ''], ['freeform', 'Synthetic fixture note'],
    ['personal text', 'synthetic-person@example.invalid'], ['case variant', 'QA_OWNED'],
    ['whitespace', 'fixture '], ['newline', 'fixture\n'],
  ])('rejects reasonCode: %s', (_label, reasonCode) => {
    expectInvalid(() => parseBody({ ...validBody(), reasonCode }), 'REASON_CODE');
  });

  it.each([
    { classification: 'test', reasonCode: 'clear' },
    { classification: 'unclassified', reasonCode: 'qa_owned' },
    { classification: 'unclassified', reasonCode: 'fixture' },
    { classification: 'unclassified', reasonCode: 'manual_confirmation' },
  ])('rejects mismatched $classification / $reasonCode', body => {
    expectInvalid(() => parseBody({ ...body, expectedRevision: 0 }), 'REASON_CODE');
  });

  it('never coerces submitted objects or executes serialization hooks', () => {
    const hook = jest.fn(() => { throw new Error('synthetic-private-coercion-error'); });
    const value = { toString: hook, valueOf: hook, toJSON: hook };
    expectInvalid(() => parseTestAccountCommand(value, KEY, validBody()), 'USER_ID');
    expectInvalid(() => parseTestAccountCommand(USER_ID, value, validBody()), 'IDEMPOTENCY_KEY');
    expectInvalid(() => parseBody({ ...validBody(), classification: value }), 'CLASSIFICATION');
    expectInvalid(() => parseBody({ ...validBody(), expectedRevision: value }), 'EXPECTED_REVISION');
    expectInvalid(() => parseBody({ ...validBody(), reasonCode: value }), 'REASON_CODE');
    expect(hook).not.toHaveBeenCalled();
  });
});

describe('test account fingerprint', () => {
  it('is the SHA256 of the exact canonical target and body, with no raw key', () => {
    const serialized = '{"userId":"123e4567-e89b-42d3-a456-426614174000",' +
      '"classification":"test","expectedRevision":0,"reasonCode":"qa_owned"}';
    expect(parseBody(validBody()).fingerprint)
      .toBe(createHash('sha256').update(serialized, 'utf8').digest('hex'));
  });

  it('is deterministic across body order, UUID case and independently allocated bodies', () => {
    const expected = parseBody(validBody()).fingerprint;
    const permutations = [
      { classification: 'test', expectedRevision: 0, reasonCode: 'qa_owned' },
      { classification: 'test', reasonCode: 'qa_owned', expectedRevision: 0 },
      { expectedRevision: 0, classification: 'test', reasonCode: 'qa_owned' },
      { expectedRevision: 0, reasonCode: 'qa_owned', classification: 'test' },
      { reasonCode: 'qa_owned', classification: 'test', expectedRevision: 0 },
      { reasonCode: 'qa_owned', expectedRevision: 0, classification: 'test' },
    ];
    for (const body of permutations) {
      expect(parseTestAccountCommand(USER_ID.toUpperCase(), KEY, body).fingerprint).toBe(expected);
    }
    expect(parseBody(validBody()).fingerprint).toBe(expected);
  });

  it('distinguishes target, revision, every test reason and a clear command', () => {
    const fingerprints = [
      parseBody(validBody()),
      parseTestAccountCommand(OTHER_USER_ID, KEY, validBody()),
      parseBody({ ...validBody(), expectedRevision: 1 }),
      parseBody({ ...validBody(), reasonCode: 'fixture' }),
      parseBody({ ...validBody(), reasonCode: 'manual_confirmation' }),
      parseBody({ classification: 'unclassified', expectedRevision: 0, reasonCode: 'clear' }),
    ].map(command => command.fingerprint);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });

  it('keeps attempt keys separate from the target/body fingerprint', () => {
    const first = parseBody(validBody());
    const second = parseTestAccountCommand(USER_ID, 'different-attempt:02', validBody());
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    expect(first.fingerprint).toBe(second.fingerprint);
  });
});

describe('parseTestAccountFilter', () => {
  it('defaults only undefined to all', () => {
    expect(parseTestAccountFilter(undefined)).toBe('all');
  });

  it.each(['all', 'test', 'unclassified'] as const)('accepts exact filter %s', value => {
    expect(parseTestAccountFilter(value)).toBe(value);
  });

  it.each<[string, unknown]>([
    ['null', null], ['empty', ''], ['number', 0], ['boolean', false],
    ['array', ['test']], ['record', { filter: 'test' }], ['boxed', new String('test')],
    ['symbol', Symbol('synthetic')], ['case variant', 'All'], ['uppercase', 'TEST'],
    ['leading space', ' test'], ['trailing space', 'unclassified '], ['newline', 'all\n'],
    ['real', 'real'], ['customer', 'customer'], ['not-test', 'not-test'],
  ])('rejects filter: %s', (_label, value) => {
    expectInvalid(() => parseTestAccountFilter(value), 'FILTER');
  });
});
