import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { BoostsModule } from './boosts/boosts.module';
import { ChatModule } from './chat/chat.module';
import { validateEnv } from './config/env.validation';
import { DebutModule } from './debut/debut.module';
import { GiftsModule } from './gifts/gifts.module';
import { HealthController } from './health.controller';
import { LuminaProductsModule } from './lumina-products/lumina-products.module';
import { PaymentsModule } from './payments/payments.module';
import { PopularVoteModule } from './popular-vote/popular-vote.module';
import { PremiumVideosModule } from './premium-videos/premium-videos.module';
import { PrismaModule } from './prisma/prisma.module';
import { ArtistsModule } from './public/artists/artists.module';
import { ShortformsModule } from './public/shortforms/shortforms.module';
import { RewardsModule } from './rewards/rewards.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { UserGiftsModule } from './user-gifts/user-gifts.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    AuthModule,
    AdminModule,
    ArtistsModule,
    ShortformsModule,
    WalletModule,
    LuminaProductsModule,
    GiftsModule,
    BoostsModule,
    PopularVoteModule,
    DebutModule,
    PremiumVideosModule,
    ChatModule,
    PaymentsModule,
    RewardsModule,
    UserGiftsModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
