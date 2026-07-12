import { Module } from '@nestjs/common';
import { StoryUploadController } from './story-upload.controller';
import { StoryUploadService } from './story-upload.service';
import { StoryUploadStorageService } from './story-upload-storage.service';

@Module({
  controllers: [StoryUploadController],
  providers: [StoryUploadService, StoryUploadStorageService],
})
export class StoryUploadModule {}
