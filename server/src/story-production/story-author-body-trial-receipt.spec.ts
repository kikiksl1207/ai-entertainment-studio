import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { normalizeAuthorBodyTrialReceiptQuery, StoryAuthorBodyTrialReceiptService } from './story-author-body-trial-receipt.service';
import { authorBodyTrialReceiptPrivacyMiddleware } from './story-author-body-trial-receipt.controller';

const userId = randomUUID(), workId = randomUUID(), choiceId = randomUUID(), approvalId = randomUUID(), progressId = randomUUID();
const scope = { approvalId, progressId, expectedRevision: 4, locale: 'ko' };
const key = 'synthetic-receipt-key';
const url = '?' + new URLSearchParams({ ...scope, expectedRevision: '4' }).toString();

describe('private trial receipt strict read scope', () => {
  it.each(['/api/v1/me/creator-studio/stories/id/body-trial/choices/id/receipt?locale=ko',
    '/API/ME/CREATOR-STUDIO/STORIES/id/BODY-TRIAL/CHOICES/id/RECEIPT'])('protects pre-guard/parser errors for %s', url => {
    const response = { setHeader: jest.fn() }, next = jest.fn();
    authorBodyTrialReceiptPrivacyMiddleware({ url }, response, next);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store'); expect(next).toHaveBeenCalledTimes(1);
  });
  it('leaves other routes unchanged', () => {
    const response = { setHeader: jest.fn() }, next = jest.fn();
    authorBodyTrialReceiptPrivacyMiddleware({ url: '/api/v1/story/public' }, response, next);
    expect(response.setHeader).not.toHaveBeenCalled(); expect(next).toHaveBeenCalledTimes(1);
  });
  it('decodes the exact four query fields without permissive numeric coercion', () => {
    expect(normalizeAuthorBodyTrialReceiptQuery(url)).toEqual(scope);
  });
  it.each(['', url + '&locale=ko', url + '&userId=' + userId, url.replace('expectedRevision=4', 'expectedRevision=04'),
    url.replace('expectedRevision=4', 'expectedRevision=4e0'), url.replace('expectedRevision=4', 'expectedRevision=2147483647'),
    url.replace('expectedRevision=4', 'expectedRevision=-1'), url.replace('locale=ko', 'locale=fr'),
    url.replace(approvalId, 'bad')])('rejects malformed/duplicate/foreign fields %s', query => {
    expect(() => normalizeAuthorBodyTrialReceiptQuery(query)).toThrow(BadRequestException);
  });
});

function prepared() {
  const receipt = { contract: 'story-author-body-trial-choice-v1', progressId, status: 'completed',
    generationStarted: false, imageGenerationStarted: false, revisionAfterRequest: 5,
    idempotentReplay: false, privateDiagnostic: 'must not return' };
  const tx = { $executeRaw: jest.fn().mockResolvedValue(0),
    storyWork: { findFirst: jest.fn().mockResolvedValue({ id: workId, ownerUserId: userId }) },
    storyAuthorBodyTrialCommand: { findUnique: jest.fn().mockResolvedValue({ userId, workId, approvalId, progressId,
      choiceId, sourceRevision: 4, locale: 'ko', receipt }) },
    storyAuthorBodyTrialApproval: { findFirst: jest.fn().mockResolvedValue({ id: approvalId, releaseId: randomUUID(), status: 'revoked' }) },
    storyReaderProgress: { findFirst: jest.fn().mockResolvedValue({ id: progressId }) },
    storyAiContinuation: { findFirst: jest.fn() }, storyAiGeneratedScene: { findFirst: jest.fn() } };
  const prisma = { $transaction: jest.fn(async (action, options) => {
    expect(options).toEqual({ isolationLevel: 'RepeatableRead' }); return action(tx);
  }) };
  const service = new StoryAuthorBodyTrialReceiptService(prisma as never);
  const get = (input = scope, actor = userId, suppliedKey = key) => service.lookup(actor, workId, choiceId, input, suppliedKey);
  return { tx, prisma, get, service, receipt };
}

describe('private receipt does not dispatch or grant a new trial', () => {
  it.each<[string, unknown, string | null]>([
    ['failed', 'dispatch_lease_insufficient', 'lease_time_insufficient'],
    ['failed', 'provider_outcome_unknown', 'provider_outcome_unknown'],
    ['failed', 'provider_output_token_limit', 'output_limit_reached'],
    ...['continuation_output_underlength', 'continuation_output_overlength'].map(code =>
      ['failed', code, 'narrative_length_rejected'] as [string, unknown, string | null]),
    ...['provider_malformed_output', 'provider_output_route_invalid', 'provider_output_size_invalid',
      'provider_incomplete_output'].map(code => ['failed', code, 'output_validation_rejected'] as [string, unknown, string | null]),
    ...['continuation_invalid_calendar_date', 'continuation_source_prose_repeated',
      'continuation_generated_prose_repeated'].map(code => ['failed', code, 'quality_rule_rejected'] as [string, unknown, string | null]),
    ['failed', 'participant_missing_from_scene', 'participant_missing'],
    ...['server_moderation_rejected', 'provider_refusal', 'provider_content_filtered'].map(code => ['failed', code, 'content_rejected'] as [string, unknown, string | null]),
    ['failed', 'PROVIDER_MALFORMED_OUTPUT', null], ['failed', 'provider_malformed_output:private-detail', null],
    ['failed', 'continuation_output_underlength ', null], ['failed', '__proto__', null],
    ['failed', 'PROVIDER_OUTPUT_TOKEN_LIMIT', null], ['failed', 'provider_output_token_limit:private-detail', null],
    ['failed', { code: 'provider_refusal' }, null], ['failed', ['provider_refusal'], null],
    ...['timeout', 'queued', 'processing', 'completed'].map(status => [status, 'provider_malformed_output', null] as [string, unknown, string | null]),
    ['failed', 'synthetic-private-diagnostic', null], ['failed', null, null],
    ['failed', 'DISPATCH_LEASE_INSUFFICIENT', null], ['timeout', 'dispatch_lease_insufficient', null],
    ['timeout', 'provider_outcome_unknown', null], ['queued', 'dispatch_lease_insufficient', null],
    ['processing', 'provider_outcome_unknown', null], ['completed', 'dispatch_lease_insufficient', null],
    ...['timeout', 'queued', 'processing', 'completed'].map(status => [status, 'provider_output_token_limit', null] as [string, unknown, string | null]),
  ])('allowlists advisory failure description for %s/%s without usage or retry claims', async (status, failureCode, reason) => {
    const f = prepared(), continuationId = randomUUID();
    const resultGeneratedSceneId = status === 'completed' ? randomUUID() : null;
    Object.assign(f.receipt, { continuationId, failureReason: 'untrusted-stored-reason', actualCostKrw: '0' });
    const approval = await f.tx.storyAuthorBodyTrialApproval.findFirst();
    f.tx.storyAiContinuation.findFirst.mockResolvedValue({ id: continuationId, releaseId: approval.releaseId,
      requestKind: 'recommended_choice', idempotencyKey: 'recommended-choice:' + key, sourceProgressRevision: 4,
      locale: 'ko', maxAttempts: 1, recommendedChoiceId: choiceId, generatedChoiceId: null, status,
      failureCode, resultGeneratedSceneId, contextReferences: {}, actualCostKrw: null,
      providerPayload: 'synthetic-private-diagnostic' });
    f.tx.storyAiGeneratedScene.findFirst.mockResolvedValue({ id: resultGeneratedSceneId });
    const before = JSON.stringify(f.receipt), result = await f.get();
    expect(result.receipt).toMatchObject({ failureReason: reason, internalCostReturned: false });
    expect(result.generationAuthorized).toBe(false);
    expect(result).toMatchObject({ readOnly: true, generationStarted: false, imageGenerationStarted: false });
    expect(Object.keys(result.receipt)).not.toEqual(expect.arrayContaining(['retryable', 'allowanceRemaining']));
    expect(Object.keys(result.receipt)).not.toEqual(expect.arrayContaining(['failureCode']));
    expect(Object.keys(result.receipt)).not.toEqual(expect.arrayContaining(['actualCostKrw']));
    expect(JSON.stringify(result)).not.toContain('synthetic-private-diagnostic');
    expect(JSON.stringify(result)).not.toContain('untrusted-stored-reason');
    expect(JSON.stringify(f.receipt)).toBe(before);
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(f.tx.$executeRaw.mock.calls[0][0].strings.join('')).toContain('SET TRANSACTION READ ONLY');
  });
  it('reads a recorded canonical receipt even when its approval is revoked; private fields are allowlisted', async () => {
    const f = prepared(), result = await f.get();
    expect(result).toMatchObject({ contract: 'story-author-body-trial-receipt-v1', approvalId, progressId, locale: 'ko',
      sourceRevision: 4, readOnly: true, generationAuthorized: false, generationStarted: false });
    expect(result.receipt).toEqual({ contract: f.receipt.contract, progressId, status: 'completed',
      revisionAfterRequest: 5, generationStarted: false, imageGenerationStarted: false, idempotentReplay: true });
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(f.tx.$executeRaw.mock.calls[0][0].strings.join('')).toContain('SET TRANSACTION READ ONLY');
    expect(f.tx.storyAiContinuation.findFirst).not.toHaveBeenCalled();
  });
  it.each(['', 'short', 'x'.repeat(121), 'unsafe key'])('rejects invalid keys before opening the DB %s', async suppliedKey => {
    const f = prepared(); await expect(f.get(scope, userId, suppliedKey)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rejects coercion or caller-controlled authorization fields before opening the DB', async () => {
    const f = prepared();
    await expect(f.get({ ...scope, expectedRevision: '4' } as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(f.get({ ...scope, generationAuthorized: true } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('looks up ownership first and does not expose another owner command', async () => {
    const f = prepared(); f.tx.storyWork.findFirst.mockResolvedValue(null);
    await expect(f.get()).rejects.toBeInstanceOf(NotFoundException);
    expect(f.tx.storyAuthorBodyTrialCommand.findUnique).not.toHaveBeenCalled();
  });
  it.each(['userId', 'workId', 'approvalId', 'progressId', 'choiceId', 'sourceRevision', 'locale'] as const)
    ('never returns a receipt with mismatched stored %s', async field => {
      const f = prepared(), command = await f.tx.storyAuthorBodyTrialCommand.findUnique();
      command[field] = field === 'sourceRevision' ? 5 : field === 'locale' ? 'en' : randomUUID();
      await expect(f.get()).rejects.toBeInstanceOf(NotFoundException);
    });
  it('keeps a missing command unavailable, not a claim that nothing was accepted', async () => {
    const f = prepared(); f.tx.storyAuthorBodyTrialCommand.findUnique.mockResolvedValue(null);
    await expect(f.get()).rejects.toMatchObject({ response: { code: 'STORY_AUTHOR_BODY_TRIAL_RECEIPT_UNAVAILABLE' } });
  });
  it.each([{ contract: 'foreign' }, { imageGenerationStarted: true }, { revisionAfterRequest: 6 },
    { generationStarted: true }, { progressId: randomUUID() }, { status: 'queued' }])('rejects invalid stored canonical receipt %p', async change => {
    const f = prepared(); Object.assign(f.receipt, change); await expect(f.get()).rejects.toBeInstanceOf(ConflictException);
  });
  it.each(['queued', 'processing', 'failed', 'timeout', 'completed'])('reads live %s without returning provider, cost or input', async status => {
    const f = prepared(), continuationId = randomUUID(), resultGeneratedSceneId = status === 'completed' ? randomUUID() : null;
    Object.assign(f.receipt, { continuationId });
    const approval = await f.tx.storyAuthorBodyTrialApproval.findFirst();
    f.tx.storyAiContinuation.findFirst.mockResolvedValue({ id: continuationId, releaseId: approval.releaseId,
      requestKind: 'recommended_choice', idempotencyKey: 'recommended-choice:' + key, sourceProgressRevision: 4,
      locale: 'ko', maxAttempts: 1, recommendedChoiceId: choiceId, generatedChoiceId: null, status,
      resultGeneratedSceneId, contextReferences: { privateText: 'must not return' }, providerPayload: 'must not return', actualCostKrw: '999' });
    f.tx.storyAiGeneratedScene.findFirst.mockResolvedValue({ id: resultGeneratedSceneId });
    const result = await f.get();
    expect(result.receipt).toMatchObject({ status, continuationId, progressApplied: status === 'completed',
      privateInputReturned: false, providerPayloadReturned: false, internalCostReturned: false, idempotentReplay: true });
    expect(JSON.stringify(result)).not.toContain('must not return'); expect(JSON.stringify(result)).not.toContain('999');
  });
  it.each([{ releaseId: randomUUID() }, { requestKind: 'custom_choice' }, { idempotencyKey: 'foreign-key' },
    { sourceProgressRevision: 5 }, { locale: 'en' }, { maxAttempts: 3 }, { generatedChoiceId: randomUUID() },
    { recommendedChoiceId: null }, { status: 'retry_wait' }, { resultGeneratedSceneId: randomUUID() }])
    ('rejects inconsistent live continuation %p', async change => {
      const f = prepared(), continuationId = randomUUID(); Object.assign(f.receipt, { continuationId });
      const approval = await f.tx.storyAuthorBodyTrialApproval.findFirst();
      f.tx.storyAiContinuation.findFirst.mockResolvedValue({ id: continuationId, releaseId: approval.releaseId,
        requestKind: 'recommended_choice', idempotencyKey: 'recommended-choice:' + key, sourceProgressRevision: 4,
        locale: 'ko', maxAttempts: 1, recommendedChoiceId: choiceId, generatedChoiceId: null, status: 'queued',
        resultGeneratedSceneId: null, contextReferences: {}, ...change });
      await expect(f.get()).rejects.toBeInstanceOf(ConflictException);
    });
  it('rejects a completed receipt without its correctly scoped saved result', async () => {
    const f = prepared(), continuationId = randomUUID(); Object.assign(f.receipt, { continuationId });
    const approval = await f.tx.storyAuthorBodyTrialApproval.findFirst();
    f.tx.storyAiContinuation.findFirst.mockResolvedValue({ id: continuationId, releaseId: approval.releaseId,
      requestKind: 'recommended_choice', idempotencyKey: 'recommended-choice:' + key, sourceProgressRevision: 4,
      locale: 'ko', maxAttempts: 1, recommendedChoiceId: choiceId, generatedChoiceId: null, status: 'completed',
      resultGeneratedSceneId: randomUUID(), contextReferences: {} });
    f.tx.storyAiGeneratedScene.findFirst.mockResolvedValue(null);
    await expect(f.get()).rejects.toBeInstanceOf(ConflictException);
  });
});
