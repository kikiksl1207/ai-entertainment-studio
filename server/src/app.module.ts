import { Module } from '@nestjs/common';
import { LuminaProductsModule } from './lumina-products/lumina-products.module';
import { PrismaModule } from './prisma/prisma.module';
import { ArtistsModule } from './public/artists/artists.module';
import { ShortformsModule } from './public/shortforms/shortforms.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    PrismaModule,
    ArtistsModule,
    ShortformsModule,
    WalletModule,
    LuminaProductsModule,
  ],
})
export class AppModule {}
