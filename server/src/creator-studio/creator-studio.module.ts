import { Module } from '@nestjs/common';
import { CreatorStudioController } from './creator-studio.controller';
import { CreatorStudioService } from './creator-studio.service';
import { ArtistIdentityAnalysisProvider } from '../generation-profile/artist-identity-analysis.provider';

@Module({
  controllers: [CreatorStudioController],
  providers: [CreatorStudioService, ArtistIdentityAnalysisProvider],
})
export class CreatorStudioModule {}
