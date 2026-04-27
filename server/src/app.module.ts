import { Module } from '@nestjs/common';
import { BoostsModule } from './boosts/boosts.module';
import { GiftsModule } from './gifts/gifts.module';
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
    GiftsModule,
    BoostsModule,
  ],
})
export class AppModule {}
