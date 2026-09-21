import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ADMIN_PERMISSIONS_KEY } from '../auth/decorators/admin-permissions.decorator';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { StoryAiActivationAdminController } from './story-ai-activation.controller';
import { CreateStoryAiEvidenceDto, StoryAiReviewQueueDto } from './dto/story-ai-activation.dto';
import { StoryAiActivationService } from './story-ai-activation.service';
import { PersistedStoryReusableResultApprovalGate } from './story-reusable-result-approval.gate';

describe('story AI review admin boundary', () => {
  it('uses existing authenticated admin and wildcard permission guards on every endpoint', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, StoryAiActivationAdminController)).toEqual([AdminAuthGuard, AdminPermissionGuard]);
    expect(Reflect.getMetadata(ADMIN_PERMISSIONS_KEY, StoryAiActivationAdminController)).toEqual(['*']);
    const guard = new AdminPermissionGuard(new Reflector());
    for (const permissions of [[], ['story:read'], ['story:write']]) {
      const context = { getHandler: () => StoryAiActivationAdminController.prototype.promote,
        getClass: () => StoryAiActivationAdminController,
        switchToHttp: () => ({ getRequest: () => ({ user: { adminPermissions: permissions } }) }) };
      expect(() => guard.canActivate(context as never)).toThrow('Admin permission');
    }
  });

  it('requires bounded queue limits and a UUID cursor', async () => {
    expect(await validate(plainToInstance(StoryAiReviewQueueDto, { limit: '50' }))).toHaveLength(0);
    expect(await validate(plainToInstance(StoryAiReviewQueueDto, { limit: '51', cursor: 'raw-content' }))).toHaveLength(2);
  });

  it('rejects raw evidence payload, malformed hashes and free text policy/evaluator versions', async () => {
    const body = plainToInstance(CreateStoryAiEvidenceDto, {
      originGeneratedSceneId: '00000000-0000-4000-8000-000000000001', resultChecksum: 'a'.repeat(64),
      kind: 'moderation', decision: 'allow', revision: 1, policyVersion: 'policy-v1', evaluatorVersion: 'evaluator-v1',
      evidenceHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 10000).toISOString(),
    });
    expect(await validate(body, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    Object.assign(body, { payload: 'private prompt', evidenceHash: 'raw text', evaluatorVersion: 'raw text' });
    expect(await validate(body, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(3);
  });

  it('does not treat prepare as result approval and fails closed on missing region/locale', async () => {
    const service = new StoryAiActivationService({} as never);
    const gate = new PersistedStoryReusableResultApprovalGate(service);
    const context = { workId: 'work', releaseId: 'release', releaseChecksum: 'hash', manuscriptVersionId: 'manuscript', rightsContractVersionId: 'rights' };
    expect(await gate.prepare(context)).toMatchObject({ eligible: false });
    expect(await gate.evaluate(context)).toMatchObject({ eligible: false });
    expect(await gate.authorizeResult(context)).toBe(false);
  });

  it('projects review text without extra JSON keys and never selects reviewer/user identifiers', async () => {
    const prisma = {
      storyAiReusableResult: { findUnique: jest.fn().mockResolvedValue({ id: 'result', status: 'pending',
        originGeneratedSceneId: 'origin', resultChecksum: 'checksum', reviewPendingAt: new Date() }) },
      storyAiResultEvidence: { findMany: jest.fn().mockResolvedValue([]) },
      storyAiGeneratedScene: { findUnique: jest.fn().mockResolvedValue({ sceneKey: 'scene',
        title: { ko: 'Reviewed title', privateInput: 'not projected' }, visualManifest: {}, resultChecksum: 'checksum' }) },
      storyAiGeneratedBeat: { findMany: jest.fn().mockResolvedValue([{ position: 1, beatType: 'paragraph', content: { ko: 'Reviewed beat', providerPayload: 'not projected' } }]) },
      storyAiGeneratedChoice: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const result = await new StoryAiActivationService(prisma as never).review('result');
    expect(result.content?.title).toEqual({ ko: 'Reviewed title' });
    expect(JSON.stringify(result)).not.toMatch(/not projected|providerPayload|privateInput/);
    expect(prisma.storyAiResultEvidence.findMany.mock.calls[0][0].select).not.toHaveProperty('actorUserId');
  });
});
