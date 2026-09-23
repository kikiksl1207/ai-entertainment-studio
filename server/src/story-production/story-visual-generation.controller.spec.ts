import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ADMIN_PERMISSIONS_KEY } from '../auth/decorators/admin-permissions.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import {
  StoryVisualGenerationAdminController,
  StoryVisualGenerationController,
} from './story-visual-generation.controller';

describe('StoryVisualGenerationController security boundary', () => {
  it('does not forward a stale replacement option from the reader endpoint', async () => {
    const visuals = { requestForProgress: jest.fn().mockResolvedValue({ status: 'ready' }) };
    const controller = new StoryVisualGenerationController(visuals as never);

    await controller.requestSceneVisual(
      { id: 'reader-id' } as never,
      'progress-id',
      { sourceSceneKey: 'scene-1', replaceStale: true } as never,
    );

    expect(visuals.requestForProgress).toHaveBeenCalledWith('reader-id', 'progress-id', 'scene-1');
  });

  it('protects the separate stale replacement operation with full admin permission', async () => {
    const visuals = { replaceStale: jest.fn().mockResolvedValue({ status: 'ready' }) };
    const controller = new StoryVisualGenerationAdminController(visuals as never);
    const method = StoryVisualGenerationAdminController.prototype.replaceStale;

    expect(Reflect.getMetadata(GUARDS_METADATA, StoryVisualGenerationAdminController))
      .toEqual([AdminAuthGuard, AdminPermissionGuard]);
    expect(Reflect.getMetadata(ADMIN_PERMISSIONS_KEY, method)).toEqual(['*']);

    const body = { releaseId: 'release-id', releaseChecksum: 'a'.repeat(64), sourceSceneKey: 'scene-1' };
    await controller.replaceStale('work-id', body);
    expect(visuals.replaceStale).toHaveBeenCalledWith('work-id', body);
  });

  it('protects exact sample generation with full admin permission', async () => {
    const visuals = { generateSample: jest.fn().mockResolvedValue({ status: 'ready' }) };
    const controller = new StoryVisualGenerationAdminController(visuals as never);
    const method = StoryVisualGenerationAdminController.prototype.generateSample;

    expect(Reflect.getMetadata(ADMIN_PERMISSIONS_KEY, method)).toEqual(['*']);
    const body = { releaseId: 'release-id', releaseChecksum: 'a'.repeat(64), sourceSceneKey: 'scene-1' };
    await controller.generateSample('work-id', body);
    expect(visuals.generateSample).toHaveBeenCalledWith('work-id', body);
  });

  it('protects the replacement status inventory with full admin permission', async () => {
    const visuals = { replacementStatus: jest.fn().mockResolvedValue({ staleCount: 1 }) };
    const controller = new StoryVisualGenerationAdminController(visuals as never);
    const method = StoryVisualGenerationAdminController.prototype.replacementStatus;

    expect(Reflect.getMetadata(ADMIN_PERMISSIONS_KEY, method)).toEqual(['*']);
    await controller.replacementStatus('work-id');
    expect(visuals.replacementStatus).toHaveBeenCalledWith('work-id');
  });
});
