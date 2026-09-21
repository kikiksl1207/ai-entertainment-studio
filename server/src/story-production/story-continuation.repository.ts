import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { StoryContinuationProviderRequest } from './story-continuation.provider';

export type StoryContinuationClaim = {
  continuationId: string;
  leaseToken: string;
  attemptCount: number;
  maxAttempts: number;
  dispatchStartedAt?: Date | null;
  request: StoryContinuationProviderRequest;
};

export abstract class StoryContinuationQueueRepository {
  abstract claimExpiredTerminal(workerId: string, leaseMs: number): Promise<StoryContinuationClaim | null>;
  abstract claimNext(workerId: string, leaseMs: number): Promise<StoryContinuationClaim | null>;
  abstract markDispatched(claim: StoryContinuationClaim): Promise<void>;
  abstract releaseNotAcceptedForRetry(claim: StoryContinuationClaim, retryAt: Date): Promise<void>;
  abstract releaseForRetry(
    claim: StoryContinuationClaim,
    errorCode: string,
    retryAt: Date,
  ): Promise<void>;
}

type ClaimedRow = {
  id: string;
  locale: string;
  context_fingerprint: string;
  prompt_version: string;
  output_schema_version: string;
  input_token_limit: number;
  output_token_limit: number;
  attempt_count: number;
  max_attempts: number;
  provider: string | null;
  model: string | null;
  rate_card_id: string;
  rate_card_version: string | null;
  dispatch_started_at: Date | null;
};

@Injectable()
export class PrismaStoryContinuationQueueRepository extends StoryContinuationQueueRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async claimExpiredTerminal(workerId: string, leaseMs: number) {
    return this.claim(workerId, leaseMs, true);
  }

  async claimNext(workerId: string, leaseMs: number) {
    return this.claim(workerId, leaseMs, false);
  }

  private async claim(workerId: string, leaseMs: number, terminalRecovery: boolean) {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + Math.max(1_000, Math.min(300_000, leaseMs)));
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
      WITH candidate AS (
        SELECT id
        FROM story_ai_continuations
        WHERE request_kind = 'recommended_choice'
          AND (${terminalRecovery}
            AND status = 'processing'
            AND (attempt_count >= max_attempts OR dispatch_started_at IS NOT NULL)
            AND lease_expires_at < CURRENT_TIMESTAMP
            OR NOT ${terminalRecovery}
            AND dispatch_started_at IS NULL
            AND attempt_count < max_attempts
            AND next_attempt_at <= CURRENT_TIMESTAMP
            AND (status IN ('queued', 'retry_wait')
              OR (status = 'processing' AND lease_expires_at < CURRENT_TIMESTAMP)))
        ORDER BY next_attempt_at ASC, created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ), claimed AS (
      UPDATE story_ai_continuations AS continuation
      SET status = 'processing',
          attempt_count = continuation.attempt_count + CASE WHEN ${terminalRecovery} THEN 0 ELSE 1 END,
          lease_token = ${leaseToken},
          lease_owner = ${workerId},
          lease_expires_at = ${leaseExpiresAt},
          started_at = COALESCE(continuation.started_at, CURRENT_TIMESTAMP),
          last_error_code = NULL
      FROM candidate
      WHERE continuation.id = candidate.id
      RETURNING continuation.*
      )
      SELECT claimed.*, reservation.provider, reservation.model,
             reservation.rate_card_version
      FROM claimed
      LEFT JOIN story_ai_usage_ledger AS reservation
        ON reservation.idempotency_key = 'usage-request:' || claimed.id::text
        AND reservation.continuation_id = claimed.id
        AND reservation.user_id = claimed.user_id
        AND reservation.work_id = claimed.work_id
        AND reservation.release_id = claimed.release_id
        AND reservation.rate_card_id = claimed.rate_card_id
        AND reservation.event_kind = 'recommended_route_request'
        AND reservation.status = 'reserved'
        AND EXISTS (
          SELECT 1 FROM story_ai_rate_cards AS card
          WHERE card.id = claimed.rate_card_id
            AND card.provider = reservation.provider
            AND card.model = reservation.model
            AND card.version = reservation.rate_card_version
        )
    `);
    const row = rows[0];
    if (!row) return null;
    return {
      continuationId: row.id,
      leaseToken,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      dispatchStartedAt: row.dispatch_started_at ?? null,
      request: {
        operationId: row.id,
        locale: row.locale,
        contextFingerprint: row.context_fingerprint,
        promptVersion: row.prompt_version,
        outputSchemaVersion: row.output_schema_version,
        inputTokenLimit: row.input_token_limit,
        outputTokenLimit: row.output_token_limit,
        provider: row.provider ?? undefined,
        model: row.model ?? undefined,
        rateCardId: row.rate_card_id,
        rateCardVersion: row.rate_card_version ?? undefined,
      },
    };
  }

  async releaseForRetry(
    claim: StoryContinuationClaim,
    errorCode: string,
    retryAt: Date,
  ) {
    const updated = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE story_ai_continuations
      SET status = 'retry_wait', last_error_code = ${errorCode.slice(0, 80)},
          next_attempt_at = ${retryAt}, lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL
      WHERE id = ${claim.continuationId}::uuid AND status = 'processing'
        AND lease_token = ${claim.leaseToken} AND attempt_count = ${claim.attemptCount}
        AND attempt_count < max_attempts AND lease_expires_at > clock_timestamp()
        AND dispatch_started_at IS NULL
    `);
    if (updated !== 1) {
      throw new ConflictException('Story AI continuation lease is stale');
    }
  }

  async markDispatched(claim: StoryContinuationClaim): Promise<void> {
    // This autocommit CAS must resolve before any provider invocation. No transaction spans HTTP.
    const updated = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE story_ai_continuations SET dispatch_started_at = clock_timestamp()
      WHERE id = ${claim.continuationId}::uuid AND status = 'processing'
        AND request_kind = 'recommended_choice'
        AND lease_token = ${claim.leaseToken} AND attempt_count = ${claim.attemptCount}
        AND lease_expires_at > clock_timestamp() AND dispatch_started_at IS NULL
    `);
    if (updated !== 1) throw new ConflictException('Story AI continuation dispatch lease is stale');
  }

  async releaseNotAcceptedForRetry(claim: StoryContinuationClaim, retryAt: Date): Promise<void> {
    // Only the explicit 429 branch calls this: clearing the fence and releasing are one CAS.
    const updated = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE story_ai_continuations
      SET status = 'retry_wait', last_error_code = 'provider_rate_limited', dispatch_started_at = NULL,
          next_attempt_at = ${retryAt}, lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL
      WHERE id = ${claim.continuationId}::uuid AND status = 'processing'
        AND lease_token = ${claim.leaseToken} AND attempt_count = ${claim.attemptCount}
        AND attempt_count < max_attempts AND lease_expires_at > clock_timestamp()
        AND dispatch_started_at IS NOT NULL
    `);
    if (updated !== 1) throw new ConflictException('Story AI continuation dispatch lease is stale');
  }
}
