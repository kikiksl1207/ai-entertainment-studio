import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoryUploadController } from './story-upload.controller';

describe('StoryUploadController', () => {
  it('mounts the final intake as an authenticated POST route', () => {
    const handler = StoryUploadController.prototype.intake as unknown as object;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('intake');
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
  });

  it.each([
    ['getGenerationProfile', RequestMethod.GET, 'submissions/:submissionId/generation-profile'],
    ['updateGenerationProfile', RequestMethod.PATCH, 'submissions/:submissionId/generation-profile'],
    ['approveGenerationProfile', RequestMethod.POST, 'submissions/:submissionId/generation-profile/approve'],
  ])('mounts %s as an authenticated generation-profile route', (name, method, path) => {
    const handler = StoryUploadController.prototype[name as keyof StoryUploadController] as unknown as object;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
  });
});
