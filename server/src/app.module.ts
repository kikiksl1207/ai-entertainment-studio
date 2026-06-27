import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AiPremiumContentModule } from './ai-premium-content/ai-premium-content.module';
import { UserAssetsModule } from './assets/user-assets.module';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { BoostsModule } from './boosts/boosts.module';
import { ChatModule } from './chat/chat.module';
import { CommunityModule } from './community/community.module';
import { validateEnv } from './config/env.validation';
import { CreatorImageRequestsModule } from './creator-image-requests/creator-image-requests.module';
import { CreatorStudioModule } from './creator-studio/creator-studio.module';
import { DebutModule } from './debut/debut.module';
import { FanEngagementModule } from './fan-engagement/fan-engagement.module';
import { FanLettersModule } from './fan-letters/fan-letters.module';
import { GiftsModule } from './gifts/gifts.module';
import { HealthController } from './health.controller';
import { LuminaProductsModule } from './lumina-products/lumina-products.module';
import { LuminaStationModule } from './lumina-station/lumina-station.module';
import { ModerationModule } from './moderation/moderation.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { PopularVoteModule } from './popular-vote/popular-vote.module';
import { PremiumVideosModule } from './premium-videos/premium-videos.module';
import { PrismaModule } from './prisma/prisma.module';
import { ArtistsModule } from './public/artists/artists.module';
import { ShortformsModule } from './public/shortforms/shortforms.module';
import { RewardsModule } from './rewards/rewards.module';
import { SiteContentModule } from './site-content/site-content.module';
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
    UserAssetsModule,
    AuthModule,
    AdminModule,
    AiPremiumContentModule,
    ArtistsModule,
    ShortformsModule,
    WalletModule,
    LuminaProductsModule,
    LuminaStationModule,
    GiftsModule,
    BoostsModule,
    PopularVoteModule,
    DebutModule,
    FanEngagementModule,
    FanLettersModule,
    PremiumVideosModule,
    ChatModule,
    CommunityModule,
    CreatorImageRequestsModule,
    CreatorStudioModule,
    ModerationModule,
    NotificationsModule,
    PaymentsModule,
    RewardsModule,
    SiteContentModule,
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
