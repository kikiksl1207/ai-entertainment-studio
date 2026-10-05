import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { types } from 'util';

export type TestAccountClassification = 'test' | 'unclassified';

type TestAccountReasonCode = 'qa_owned' | 'fixture' | 'manual_confirmation' | 'clear';
type TestAccountBody = {
  classification: TestAccountClassification;
  expectedRevision: number;
  reasonCode: TestAccountReasonCode;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BODY_FIELDS = ['classification', 'expectedRevision', 'reasonCode'] as const;

export function parseTestAccountCommand(
  userId: unknown,
  idempotencyKey: unknown,
  body: unknown,
): TestAccountBody & { userId: string; idempotencyKey: string; fingerprint: string } {
  if (typeof userId !== 'string' || userId.length !== 36 || !UUID.test(userId)) {
    invalid('ADMIN_TEST_ACCOUNT_USER_ID_INVALID');
  }
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 ||
      idempotencyKey.length > 120 || /[^A-Za-z0-9._:-]/.test(idempotencyKey)) {
    invalid('ADMIN_TEST_ACCOUNT_IDEMPOTENCY_KEY_INVALID');
  }

  const normalizedBody = parseBody(body);
  const target = { userId: userId.toLowerCase(), ...normalizedBody };
  // The replay key identifies the attempt; the fingerprint binds its target and body.
  const fingerprint = createHash('sha256').update(JSON.stringify(target), 'utf8').digest('hex');
  return { ...target, idempotencyKey, fingerprint };
}

export function parseTestAccountFilter(value: unknown): 'all' | 'test' | 'unclassified' {
  if (value === undefined) return 'all';
  if (value === 'all' || value === 'test' || value === 'unclassified') return value;
  invalid('ADMIN_TEST_ACCOUNT_FILTER_INVALID');
}

function parseBody(body: unknown): TestAccountBody {
  if (body === null || typeof body !== 'object' || types.isProxy(body) ||
      Array.isArray(body) || Object.getPrototypeOf(body) !== Object.prototype) {
    invalid('ADMIN_TEST_ACCOUNT_BODY_INVALID');
  }

  const descriptors = Object.getOwnPropertyDescriptors(body);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== BODY_FIELDS.length || keys.some(key =>
    typeof key !== 'string' || !BODY_FIELDS.includes(key as typeof BODY_FIELDS[number]))) {
    invalid('ADMIN_TEST_ACCOUNT_BODY_INVALID');
  }
  for (const field of BODY_FIELDS) {
    const descriptor = descriptors[field];
    if (!descriptor || descriptor.enumerable !== true ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      invalid('ADMIN_TEST_ACCOUNT_BODY_INVALID');
    }
  }

  const classification: unknown = descriptors.classification.value;
  const expectedRevision: unknown = descriptors.expectedRevision.value;
  const reasonCode: unknown = descriptors.reasonCode.value;
  if (classification !== 'test' && classification !== 'unclassified') {
    invalid('ADMIN_TEST_ACCOUNT_CLASSIFICATION_INVALID');
  }
  if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) ||
      expectedRevision < 0 || expectedRevision > 2147483646) {
    invalid('ADMIN_TEST_ACCOUNT_EXPECTED_REVISION_INVALID');
  }
  if (classification === 'test') {
    if (reasonCode !== 'qa_owned' && reasonCode !== 'fixture' && reasonCode !== 'manual_confirmation') {
      invalid('ADMIN_TEST_ACCOUNT_REASON_CODE_INVALID');
    }
  } else if (reasonCode !== 'clear') {
    invalid('ADMIN_TEST_ACCOUNT_REASON_CODE_INVALID');
  }

  return {
    classification,
    expectedRevision: expectedRevision === 0 ? 0 : expectedRevision,
    reasonCode: reasonCode as TestAccountReasonCode,
  };
}

function invalid(code: string): never {
  throw new BadRequestException({ code, message: 'Invalid test account request' });
}
