import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BoostsModule } from './boosts/boosts.module';
import { ChatModule } from './chat/chat.module';
import { validateEnv } from './config/env.validation';
import { GiftsModule } from './gifts/gifts.module';
import { LuminaProductsModule } from './lumina-products/lumina-products.module';
import { PaymentsModule } from './payments/payments.module';
import { PremiumVideosModule } from './premium-videos/premium-videos.module';
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
    AdminModule,
    ArtistsModule,
    ShortformsModule,
    WalletModule,
    LuminaProductsModule,
    GiftsModule,
    BoostsModule,
    PremiumVideosModule,
    ChatModule,
    PaymentsModule,
  ],
})
export class AppModule {}
