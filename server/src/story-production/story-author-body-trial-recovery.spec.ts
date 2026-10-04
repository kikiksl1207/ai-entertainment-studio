import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { StoryAuthorBodyTrialReceiptService } from './story-author-body-trial-receipt.service';
import { authorBodyTrialReceiptPrivacyMiddleware, StoryAuthorBodyTrialRecoveryController } from './story-author-body-trial-receipt.controller';

const userId = randomUUID(), workId = randomUUID(), progressId = randomUUID(), approvalId = randomUUID(), choiceId = randomUUID();
function prepared() {
  const command = { userId, workId, choiceId, approvalId, progressId, sourceRevision: 4, locale: 'ko',
    idempotencyKey: 'synthetic-recovery-command', createdAt: new Date(),
    receipt: { contract: 'story-author-body-trial-choice-v1', progressId, generationStarted: false,
      imageGenerationStarted: false, status: 'active', revisionAfterRequest: 5, privateDiagnostic: 'must not return' } };
  const tx = { $executeRaw: jest.fn().mockResolvedValue(0),
    storyWork: { findFirst: jest.fn().mockResolvedValue({ id: workId, ownerUserId: userId }) },
    storyAuthorBodyTrialCommand: { findFirst: jest.fn().mockResolvedValue(command) },
    storyAuthorBodyTrialApproval: { findFirst: jest.fn().mockResolvedValue({ id: approvalId, status: 'revoked' }) },
    storyReaderProgress: { findFirst: jest.fn().mockResolvedValue({ id: progressId }) } };
  const prisma = { $transaction: jest.fn(async (action, options) => { expect(options).toEqual({ isolationLevel: 'RepeatableRead' }); return action(tx); }) };
  const service = new StoryAuthorBodyTrialReceiptService(prisma as never);
  return { tx, prisma, command, service, get: (actor: string = userId, work: string = workId) => service.recover(actor, work) };
}

describe('owner recent trial recovery is only a private read locator', () => {
  it('returns the latest exact command locator without receipt/provider/prose/cost or new dispatch permission', async () => {
    const f = prepared();
    expect(await f.get(userId.toUpperCase(), workId.toUpperCase())).toEqual({
      contract: 'story-author-body-trial-recovery-v1', workId, readOnly: true, generationAuthorized: false,
      generationStarted: false, imageGenerationStarted: false,
      command: { workId, choiceId, key: f.command.idempotencyKey, body: { approvalId, progressId, expectedRevision: 4, locale: 'ko' } } });
    expect(f.tx.$executeRaw.mock.calls[0][0].strings.join('')).toContain('READ ONLY');
    expect(f.tx.storyAuthorBodyTrialCommand.findFirst).toHaveBeenCalledWith({ where: { userId, workId },
      orderBy: [{ createdAt: 'desc' }, { idempotencyKey: 'desc' }] });
  });
  it('returns null when no record exists without saying a pending HTTP request never arrived', async () => {
    const f = prepared(); f.tx.storyAuthorBodyTrialCommand.findFirst.mockResolvedValue(null);
    expect(await f.get()).toMatchObject({ command: null, generationAuthorized: false });
    expect(f.tx.storyReaderProgress.findFirst).not.toHaveBeenCalled();
  });
  it.each(['', 'bad', null, 42])('rejects invalid input before the DB %p', async actor => {
    const f = prepared(); await expect(f.get(actor as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each(['missing', 'foreign', 'wrong-work'])('checks work ownership first: %s', async kind => {
    const f = prepared(); f.tx.storyWork.findFirst.mockResolvedValue(kind === 'missing' ? null : {
      id: kind === 'wrong-work' ? randomUUID() : workId, ownerUserId: kind === 'foreign' ? randomUUID() : userId });
    await expect(f.get()).rejects.toBeInstanceOf(NotFoundException);
    expect(f.tx.storyAuthorBodyTrialCommand.findFirst).not.toHaveBeenCalled();
  });
  it.each(['userId', 'workId', 'choiceId', 'approvalId', 'progressId', 'locale', 'sourceRevision', 'idempotencyKey'] as const)
    ('rejects malformed latest %s and never falls back to an older record', async field => {
      const f = prepared();
      (f.command as any)[field] = field === 'sourceRevision' ? 2147483647 : field === 'locale' ? 'fr' :
        field === 'userId' || field === 'workId' ? randomUUID() : 'bad';
      await expect(f.get()).rejects.toBeInstanceOf(ConflictException);
      expect(f.tx.storyAuthorBodyTrialCommand.findFirst).toHaveBeenCalledTimes(1);
    });
  it.each(['approval', 'progress'])('requires the same owner/work %s link, not approval being currently active', async kind => {
    const f = prepared();
    (kind === 'approval' ? f.tx.storyAuthorBodyTrialApproval : f.tx.storyReaderProgress).findFirst.mockResolvedValue(null);
    await expect(f.get()).rejects.toBeInstanceOf(ConflictException);
  });
  function ai(f: ReturnType<typeof prepared>, status: string = 'queued') {
    const receipt = f.command.receipt as any;
    Object.assign(receipt, { continuationId: randomUUID(), status, privateInputReturned: false,
      providerPayloadReturned: false, internalCostReturned: false, progressApplied: status === 'completed',
      provenance: 'ai_generated', resultGeneratedSceneId: status === 'completed' ? randomUUID() : null });
    delete receipt.progressId; delete receipt.generationStarted;
    return receipt;
  }
  it.each(['queued', 'processing', 'completed', 'failed', 'timeout'])('accepts the recorded AI %s locator but returns no outcome', async status => {
    const f = prepared(); ai(f, status);
    expect(await f.get()).toMatchObject({ command: { key: f.command.idempotencyKey } });
    expect(JSON.stringify(await f.get())).not.toContain('continuationId');
  });
  it.each([{ status: undefined }, { status: 'active' }, { status: 'retry_wait' }, { privateInputReturned: true },
    { providerPayloadReturned: true }, { internalCostReturned: true }, { progressApplied: true },
    { provenance: 'writer_original' }, { resultGeneratedSceneId: undefined }, { resultGeneratedSceneId: 'bad' },
    { status: 'completed', progressApplied: true, resultGeneratedSceneId: null }])
    ('rejects malformed latest recorded AI %p without older fallback', async change => {
      const f = prepared(); Object.assign(ai(f), change);
      await expect(f.get()).rejects.toBeInstanceOf(ConflictException);
      expect(f.tx.storyAuthorBodyTrialCommand.findFirst).toHaveBeenCalledTimes(1);
    });
  it.each([{ contract: 'bad' }, { imageGenerationStarted: true }, { revisionAfterRequest: 6 },
    { generationStarted: true }, { progressId: randomUUID() }, { status: 'queued' }, { continuationId: 'bad' }])
    ('rejects inconsistent latest receipt %p', async change => {
      const f = prepared(); Object.assign(f.command.receipt, change); await expect(f.get()).rejects.toBeInstanceOf(ConflictException);
    });
  it.each(['queued', 'processing', 'failed', 'timeout'])('rejects a result UUID on recorded non-completed %s without fallback', async status => {
    const f = prepared(); ai(f, status).resultGeneratedSceneId = randomUUID();
    await expect(f.get()).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.storyAuthorBodyTrialCommand.findFirst).toHaveBeenCalledTimes(1);
  });
  it.each(['/api/v1/me/creator-studio/stories/id/body-trial/recovery?x=1', '/API/ME/CREATOR-STUDIO/STORIES/id/BODY-TRIAL/RECOVERY'])
    ('sets privacy before auth/parser for %s', url => {
      const response = { setHeader: jest.fn() }, next = jest.fn();
      authorBodyTrialReceiptPrivacyMiddleware({ url }, response, next);
      expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store'); expect(next).toHaveBeenCalledTimes(1);
    });
  it('rejects caller scope/authority query fields instead of ignoring them', () => {
    const service = { recover: jest.fn() }, controller = new StoryAuthorBodyTrialRecoveryController(service as never);
    expect(() => controller.recover({ id: userId } as never, workId, { url: '/recovery?workId=' + randomUUID() }))
      .toThrow(BadRequestException);
    expect(service.recover).not.toHaveBeenCalled();
    controller.recover({ id: userId } as never, workId, { url: '/recovery' });
    expect(service.recover).toHaveBeenCalledWith(userId, workId);
  });
});
