import { HttpException, Logger, type ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { assertAtomicWalletDebitSucceeded, requireWalletMutationIdempotencyKey,
  throwWalletMutationIdempotencyConflict } from './wallet-mutation-safety';

describe('Wallet safety helpers through the real HTTP exception filter', () => {
  function serialize(error: unknown) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = { switchToHttp: () => ({ getResponse: () => ({ status }),
      getRequest: () => ({ url: '/wallet/test', headers: {} }) }) } as unknown as ArgumentsHost;
    new HttpExceptionFilter().catch(error, host);
    return JSON.parse(JSON.stringify(json.mock.calls[0][0]));
  }

  it.each([
    ['IDEMPOTENCY_REQUIRED', 400, () => requireWalletMutationIdempotencyKey(undefined)],
    ['IDEMPOTENCY_CONFLICT', 409, () => throwWalletMutationIdempotencyConflict()],
    ['INSUFFICIENT_BALANCE', 400, () => assertAtomicWalletDebitSucceeded({ count: 0 })],
  ] as const)('preserves no-mutation details for %s without changing legacy fields', (suffix, status, action) => {
    let error: unknown;
    try { action(); } catch (thrown) { error = thrown; }
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: `WALLET_MUTATION_${suffix}`, walletMutation: false,
    });
    expect(serialize(error)).toMatchObject({ success: false, error: {
      code: `WALLET_MUTATION_${suffix}`, statusCode: status, details: { walletMutation: false },
    } });
  });

  it('does not assert a known rollback or no mutation for an unknown database failure', () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const wire = serialize(new Error('synthetic database failure'));
      expect(wire.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(wire.error.statusCode).toBe(500);
      expect(wire.error.details).toBeUndefined();
      expect(JSON.stringify(wire)).not.toContain('walletMutation');
    } finally { log.mockRestore(); }
  });
});
