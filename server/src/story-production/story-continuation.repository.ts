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
  request: StoryContinuationProviderRequest;
};

export abstract class StoryContinuationQueueRepository {
  abstract claimExpiredTerminal(workerId: string, leaseMs: number): Promise<StoryContinuationClaim | null>;
  abstract claimNext(workerId: string, leaseMs: number): Promise<StoryContinuationClaim | null>;
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
            AND attempt_count >= max_attempts
            AND lease_expires_at < CURRENT_TIMESTAMP
            OR NOT ${terminalRecovery}
            AND attempt_count < max_attempts
            AND next_attempt_at <= CURRENT_TIMESTAMP
            AND (status IN ('queued', 'retry_wait')
              OR (status = 'processing' AND lease_expires_at < CURRENT_TIMESTAMP)))
        ORDER BY next_attempt_at ASC, created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
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
    `);
    const row = rows[0];
    if (!row) return null;
    return {
      continuationId: row.id,
      leaseToken,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      request: {
        operationId: row.id,
        locale: row.locale,
        contextFingerprint: row.context_fingerprint,
        promptVersion: row.prompt_version,
        outputSchemaVersion: row.output_schema_version,
        inputTokenLimit: row.input_token_limit,
        outputTokenLimit: row.output_token_limit,
      },
    };
  }

  async releaseForRetry(
    claim: StoryContinuationClaim,
    errorCode: string,
    retryAt: Date,
  ) {
    const updated = await this.prisma.storyAiContinuation.updateMany({
      where: {
        id: claim.continuationId,
        status: 'processing',
        leaseToken: claim.leaseToken,
        attemptCount: claim.attemptCount,
      },
      data: {
        status: 'retry_wait',
        lastErrorCode: errorCode.slice(0, 80),
        nextAttemptAt: retryAt,
        leaseToken: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException('Story AI continuation lease is stale');
    }
  }
}
