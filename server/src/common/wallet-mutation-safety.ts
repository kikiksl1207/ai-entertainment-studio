import { BadRequestException, ConflictException } from '@nestjs/common';

export const WALLET_MUTATION_IDEMPOTENCY_REQUIRED = {
  code: 'WALLET_MUTATION_IDEMPOTENCY_REQUIRED',
  message: 'wallet.mutation.idempotencyRequired',
  messageKey: 'wallet.mutation.idempotencyRequired',
  walletMutation: false,
  idempotencyRequired: true,
} as const;

export const WALLET_MUTATION_IDEMPOTENCY_CONFLICT = {
  code: 'WALLET_MUTATION_IDEMPOTENCY_CONFLICT',
  message: 'wallet.mutation.idempotencyConflict',
  messageKey: 'wallet.mutation.idempotencyConflict',
  walletMutation: false,
} as const;

export const WALLET_MUTATION_INSUFFICIENT_BALANCE = {
  code: 'WALLET_MUTATION_INSUFFICIENT_BALANCE',
  message: 'wallet.mutation.insufficientBalance',
  messageKey: 'wallet.mutation.insufficientBalance',
  walletMutation: false,
  serverAuthority: 'wallet_accounts.cached_balance',
} as const;

export function requireWalletMutationIdempotencyKey(value?: string) {
  const idempotencyKey = value?.trim();

  if (!idempotencyKey) {
    throw new BadRequestException(WALLET_MUTATION_IDEMPOTENCY_REQUIRED);
  }

  return idempotencyKey;
}

export function throwWalletMutationIdempotencyConflict(): never {
  throw new ConflictException(WALLET_MUTATION_IDEMPOTENCY_CONFLICT);
}

export function assertAtomicWalletDebitSucceeded(result: { count: number }) {
  if (result.count !== 1) {
    throw new BadRequestException(WALLET_MUTATION_INSUFFICIENT_BALANCE);
  }
}
