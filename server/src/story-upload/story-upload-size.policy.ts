import { PayloadTooLargeException } from '@nestjs/common';

export const STORY_UPLOAD_TOTAL_MAX_BYTES = 150 * 1024 * 1024;

export function createStoryUploadTotalSizeError(maxBytes = STORY_UPLOAD_TOTAL_MAX_BYTES) {
  return new PayloadTooLargeException({
    code: 'STORY_UPLOAD_TOTAL_SIZE_EXCEEDED',
    messageKey: 'storyUpload.intake.totalSizeExceeded',
    maxBytes,
  });
}
