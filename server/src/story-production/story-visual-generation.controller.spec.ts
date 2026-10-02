import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ADMIN_PERMISSIONS_KEY } from '../auth/decorators/admin-permissions.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  StoryVisualGenerationAdminController,
  StoryVisualAssetController,
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

  it('protects booking review and explicit recovery with admin permission and a server-owned actor', async () => {
    const visuals = { bookingReview: jest.fn(), reprepareBooking: jest.fn() };
    const controller = new StoryVisualGenerationAdminController(visuals as never);
    for (const key of ['bookingReview', 'reprepareBooking'] as const) {
      expect(Reflect.getMetadata(ADMIN_PERMISSIONS_KEY, StoryVisualGenerationAdminController.prototype[key])).toEqual(['*']);
    }
    await controller.bookingReview('work-id', 'cursor-id');
    expect(visuals.bookingReview).toHaveBeenCalledWith('work-id', 'cursor-id');
    const body = { actorUserId: 'attacker', asOwner: false } as never;
    await controller.reprepareBooking({ id: 'authenticated' } as never, 'work-id', body);
    expect(visuals.reprepareBooking).toHaveBeenCalledWith('authenticated', 'work-id', body);
  });

  it('forces the authenticated author ownership boundary on creator booking routes', async () => {
    const visuals = { bookingReview: jest.fn(), reprepareBooking: jest.fn() };
    const controller = new StoryVisualGenerationController(visuals as never);
    expect(Reflect.getMetadata(GUARDS_METADATA, StoryVisualGenerationController)).toEqual([JwtAuthGuard]);
    const user = { id: 'author' } as never, body = { asOwner: false, ownerUserId: 'attacker' } as never;
    await controller.bookingReview(user, 'work-id', 'cursor-id');
    await controller.reprepareBooking(user, 'work-id', body);
    expect(visuals.bookingReview).toHaveBeenCalledWith('work-id', 'cursor-id', 'author');
    expect(visuals.reprepareBooking).toHaveBeenCalledWith('author', 'work-id', body, true);
  });

  it.each(['redirect', 'inline'] as const)('requires a fresh asset check for %s delivery', async kind => {
    const image = Buffer.from('verified-image');
    const visuals = { publicVisualAsset: jest.fn().mockResolvedValue(kind === 'redirect'
      ? { kind, url: '/api/v1/assets/public/asset-id/original' }
      : { kind, mimeType: 'image/webp', image }) };
    const response = { statusCode: 0, setHeader: jest.fn(), end: jest.fn() };

    await new StoryVisualAssetController(visuals as never).deliver('asset-id', response as never);

    expect(visuals.publicVisualAsset).toHaveBeenCalledWith('asset-id');
    expect(response.setHeader).toHaveBeenCalledWith('cache-control', 'no-store');
    expect(response.statusCode).toBe(kind === 'redirect' ? 302 : 200);
    if (kind === 'redirect') expect(response.end).toHaveBeenCalledWith();
    else expect(response.end).toHaveBeenCalledWith(image);
  });
});
