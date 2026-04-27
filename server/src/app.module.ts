import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ArtistsModule } from './public/artists/artists.module';
import { ShortformsModule } from './public/shortforms/shortforms.module';

@Module({
  imports: [PrismaModule, ArtistsModule, ShortformsModule],
})
export class AppModule {}
