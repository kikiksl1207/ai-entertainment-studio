import { ConflictException } from '@nestjs/common';
import { PrismaStoryContinuationQueueRepository } from './story-continuation.repository';

function fixture() {
  const row = {
    id: 'continuation-1', locale: 'ko', context_fingerprint: 'context',
    prompt_version: 'prompt-v1', output_schema_version: 'schema-v1',
    input_token_limit: 2000, output_token_limit: 1000,
    attempt_count: 1, max_attempts: 3,
    provider: 'openai', model: 'pinned-model',
    rate_card_id: 'card-1', rate_card_version: 'rate-v1',
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([row]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const repository = new PrismaStoryContinuationQueueRepository(prisma as never);
  return { row, prisma, repository };
}

describe('continuation queue provider pins', () => {
  it('delivers the reserved model and rate version with the lease', async () => {
    const f = fixture();
    const claim = await f.repository.claimNext('worker', 60_000);
    expect(claim).toMatchObject({
      continuationId: 'continuation-1', attemptCount: 1, maxAttempts: 3,
      request: {
        provider: 'openai', model: 'pinned-model',
        rateCardId: 'card-1', rateCardVersion: 'rate-v1',
      },
    });
    expect(claim?.leaseToken).toMatch(/^[0-9a-f-]{36}$/);
    const query = f.prisma.$queryRaw.mock.calls[0][0].text as string;
    expect(query).toContain('FOR UPDATE SKIP LOCKED');
    expect(query).toContain("reservation.event_kind = 'recommended_route_request'");
    expect(query).toContain('reservation.user_id = claimed.user_id');
    expect(query).toContain('reservation.work_id = claimed.work_id');
    expect(query).toContain('reservation.release_id = claimed.release_id');
    expect(query).toContain('card.model = reservation.model');
    expect(query).toContain('card.provider = reservation.provider');
    expect(query).toContain('card.version = reservation.rate_card_version');
  });

  it('does not fill missing or mismatched reservation pins with a default model', async () => {
    const f = fixture();
    f.prisma.$queryRaw.mockResolvedValue([{
      ...f.row, provider: null, model: null, rate_card_version: null,
    }]);
    const claim = await f.repository.claimNext('worker', 60_000);
    expect(claim?.request).toMatchObject({
      provider: undefined, model: undefined, rateCardVersion: undefined,
    });
  });

  it('returns idle when no job can be claimed', async () => {
    const f = fixture();
    f.prisma.$queryRaw.mockResolvedValue([]);
    expect(await f.repository.claimNext('worker', 60_000)).toBeNull();
  });

  it('recovers terminal jobs even when their provider pins are missing', async () => {
    const f = fixture();
    f.prisma.$queryRaw.mockResolvedValue([{
      ...f.row, attempt_count: 3, provider: null, model: null, rate_card_version: null,
    }]);
    expect(await f.repository.claimExpiredTerminal('worker', 60_000))
      .toMatchObject({ attemptCount: 3 });
  });

  it('cannot return a stale lease to the queue', async () => {
    const f = fixture();
    const claim = await f.repository.claimNext('worker', 60_000);
    f.prisma.$executeRaw.mockResolvedValue(0);
    await expect(f.repository.releaseForRetry(claim!, 'transient', new Date()))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
