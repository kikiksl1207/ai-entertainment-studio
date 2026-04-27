import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BoostsModule } from './boosts/boosts.module';
import { validateEnv } from './config/env.validation';
import { GiftsModule } from './gifts/gifts.module';
import { LuminaProductsModule } from './lumina-products/lumina-products.module';
import { PrismaModule } from './prisma/prisma.module';
import { ArtistsModule } from './public/artists/artists.module';
import { ShortformsModule } from './public/shortforms/shortforms.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
    ArtistsModule,
    ShortformsModule,
    WalletModule,
    LuminaProductsModule,
    GiftsModule,
    BoostsModule,
  ],
})
export class AppModule {}
