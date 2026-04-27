import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

type AdminPayload = Record<string, unknown>;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  createAsset(input: AdminPayload) {
    return this.prisma.asset.create({
      data: {
        assetType: this.string(input, 'assetType'),
        visibility: this.string(input, 'visibility', 'public'),
        storageProvider: this.string(input, 'storageProvider', 'local'),
        storageKey: this.string(input, 'storageKey'),
        mimeType: this.string(input, 'mimeType'),
        fileSizeBytes: this.optionalBigInt(input, 'fileSizeBytes'),
        width: this.optionalNumber(input, 'width'),
        height: this.optionalNumber(input, 'height'),
        durationSeconds: this.optionalDecimal(input, 'durationSeconds'),
        checksum: this.optionalString(input, 'checksum'),
        metadata: this.json(input, 'metadata'),
      },
    });
  }

  async createArtist(input: AdminPayload) {
    const artist = await this.prisma.artist.create({
      data: {
        slug: this.string(input, 'slug'),
        displayName: this.string(input, 'displayName'),
        status: this.string(input, 'status', 'draft'),
        sortOrder: this.number(input, 'sortOrder', 0),
        launchedAt: this.optionalDate(input, 'launchedAt'),
      },
    });

    await this.upsertArtistProfiles(artist.id, input);
    return this.getArtistWithProfiles(artist.id);
  }

  async updateArtist(artistId: string, input: AdminPayload) {
    await this.ensureArtist(artistId);
    await this.prisma.artist.update({
      where: { id: artistId },
      data: this.clean({
        slug: this.optionalString(input, 'slug'),
        displayName: this.optionalString(input, 'displayName'),
        status: this.optionalString(input, 'status'),
        sortOrder: this.optionalNumber(input, 'sortOrder'),
        launchedAt: this.optionalDate(input, 'launchedAt'),
        updatedAt: new Date(),
      }),
    });

    await this.upsertArtistProfiles(artistId, input);
    return this.getArtistWithProfiles(artistId);
  }

  createShortform(input: AdminPayload) {
    return this.prisma.shortform.create({
      data: {
        artistId: this.optionalString(input, 'artistId'),
        title: this.string(input, 'title'),
        slug: this.string(input, 'slug'),
        description: this.optionalString(input, 'description'),
        status: this.string(input, 'status', 'draft'),
        publishedAt: this.optionalDate(input, 'publishedAt'),
      },
    });
  }

  updateShortform(shortformId: string, input: AdminPayload) {
    return this.prisma.shortform.update({
      where: { id: shortformId },
      data: this.clean({
        artistId: this.optionalString(input, 'artistId'),
        title: this.optionalString(input, 'title'),
        slug: this.optionalString(input, 'slug'),
        description: this.optionalString(input, 'description'),
        status: this.optionalString(input, 'status'),
        publishedAt: this.optionalDate(input, 'publishedAt'),
        updatedAt: new Date(),
      }),
    });
  }

  createLuminaProduct(input: AdminPayload) {
    return this.prisma.luminaProduct.create({
      data: {
        sku: this.string(input, 'sku'),
        name: this.string(input, 'name'),
        luminaAmount: this.decimal(input, 'luminaAmount'),
        bonusAmount: this.decimal(input, 'bonusAmount', 0),
        priceAmount: this.decimal(input, 'priceAmount'),
        priceCurrency: this.string(input, 'priceCurrency', 'KRW'),
        status: this.string(input, 'status', 'active'),
      },
    });
  }

  updateLuminaProduct(productId: string, input: AdminPayload) {
    return this.prisma.luminaProduct.update({
      where: { id: productId },
      data: this.clean({
        sku: this.optionalString(input, 'sku'),
        name: this.optionalString(input, 'name'),
        luminaAmount: this.optionalDecimal(input, 'luminaAmount'),
        bonusAmount: this.optionalDecimal(input, 'bonusAmount'),
        priceAmount: this.optionalDecimal(input, 'priceAmount'),
        priceCurrency: this.optionalString(input, 'priceCurrency'),
        status: this.optionalString(input, 'status'),
        updatedAt: new Date(),
      }),
    });
  }

  createGiftProduct(input: AdminPayload) {
    return this.prisma.giftProduct.create({
      data: {
        artistId: this.optionalString(input, 'artistId'),
        sku: this.string(input, 'sku'),
        name: this.string(input, 'name'),
        giftKind: this.string(input, 'giftKind'),
        priceLumina: this.decimal(input, 'priceLumina'),
        progressAmount: this.decimal(input, 'progressAmount', 0),
        targetAmount: this.optionalDecimal(input, 'targetAmount'),
        unlockAssetId: this.optionalString(input, 'unlockAssetId'),
        reactionAssetId: this.optionalString(input, 'reactionAssetId'),
        status: this.string(input, 'status', 'active'),
        metadata: this.json(input, 'metadata'),
      },
    });
  }

  updateGiftProduct(productId: string, input: AdminPayload) {
    return this.prisma.giftProduct.update({
      where: { id: productId },
      data: this.clean({
        artistId: this.optionalString(input, 'artistId'),
        sku: this.optionalString(input, 'sku'),
        name: this.optionalString(input, 'name'),
        giftKind: this.optionalString(input, 'giftKind'),
        priceLumina: this.optionalDecimal(input, 'priceLumina'),
        progressAmount: this.optionalDecimal(input, 'progressAmount'),
        targetAmount: this.optionalDecimal(input, 'targetAmount'),
        unlockAssetId: this.optionalString(input, 'unlockAssetId'),
        reactionAssetId: this.optionalString(input, 'reactionAssetId'),
        status: this.optionalString(input, 'status'),
        metadata: this.optionalJson(input, 'metadata'),
        updatedAt: new Date(),
      }),
    });
  }

  createBoostProduct(input: AdminPayload) {
    return this.prisma.boostProduct.create({
      data: {
        sku: this.string(input, 'sku'),
        name: this.string(input, 'name'),
        boostAmount: this.decimal(input, 'boostAmount'),
        priceLumina: this.decimal(input, 'priceLumina'),
        status: this.string(input, 'status', 'active'),
        metadata: this.json(input, 'metadata'),
      },
    });
  }

  updateBoostProduct(productId: string, input: AdminPayload) {
    return this.prisma.boostProduct.update({
      where: { id: productId },
      data: this.clean({
        sku: this.optionalString(input, 'sku'),
        name: this.optionalString(input, 'name'),
        boostAmount: this.optionalDecimal(input, 'boostAmount'),
        priceLumina: this.optionalDecimal(input, 'priceLumina'),
        status: this.optionalString(input, 'status'),
        metadata: this.optionalJson(input, 'metadata'),
        updatedAt: new Date(),
      }),
    });
  }

  createBoostCampaign(input: AdminPayload) {
    return this.prisma.boostCampaign.create({
      data: {
        slug: this.string(input, 'slug'),
        name: this.string(input, 'name'),
        description: this.optionalString(input, 'description'),
        status: this.string(input, 'status', 'draft'),
        startsAt: this.date(input, 'startsAt'),
        endsAt: this.date(input, 'endsAt'),
        freeLikeWeight: this.decimal(input, 'freeLikeWeight', 1),
        luminaBoostWeight: this.decimal(input, 'luminaBoostWeight', 1),
        dailyFreeLikeLimit: this.optionalNumber(input, 'dailyFreeLikeLimit'),
        metadata: this.json(input, 'metadata'),
      },
    });
  }

  updateBoostCampaign(campaignId: string, input: AdminPayload) {
    return this.prisma.boostCampaign.update({
      where: { id: campaignId },
      data: this.clean({
        slug: this.optionalString(input, 'slug'),
        name: this.optionalString(input, 'name'),
        description: this.optionalString(input, 'description'),
        status: this.optionalString(input, 'status'),
        startsAt: this.optionalDate(input, 'startsAt'),
        endsAt: this.optionalDate(input, 'endsAt'),
        freeLikeWeight: this.optionalDecimal(input, 'freeLikeWeight'),
        luminaBoostWeight: this.optionalDecimal(input, 'luminaBoostWeight'),
        dailyFreeLikeLimit: this.optionalNumber(input, 'dailyFreeLikeLimit'),
        metadata: this.optionalJson(input, 'metadata'),
        updatedAt: new Date(),
      }),
    });
  }

  async snapshotBoostCampaign(campaignId: string) {
    const campaign = await this.prisma.boostCampaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new NotFoundException('Boost campaign not found');
    }

    const events = await this.prisma.artistBoostEvent.findMany({
      where: { campaignId },
      include: { artist: true },
    });
    const rows = new Map<
      string,
      {
        totalFreeLikes: Decimal;
        totalLuminaBoosts: Decimal;
        totalWeightedScore: Decimal;
      }
    >();

    for (const event of events) {
      const row = rows.get(event.artistId) ?? {
        totalFreeLikes: new Decimal(0),
        totalLuminaBoosts: new Decimal(0),
        totalWeightedScore: new Decimal(0),
      };

      if (event.boostType === 'free_like') {
        row.totalFreeLikes = row.totalFreeLikes.plus(event.rawAmount);
      }

      if (event.boostType === 'lumina_boost') {
        row.totalLuminaBoosts = row.totalLuminaBoosts.plus(event.rawAmount);
      }

      row.totalWeightedScore = row.totalWeightedScore.plus(event.weightedScore);
      rows.set(event.artistId, row);
    }

    const snapshotAt = new Date();
    const rankedRows = [...rows.entries()]
      .sort((left, right) =>
        right[1].totalWeightedScore.comparedTo(left[1].totalWeightedScore),
      )
      .map(([artistId, row], index) => ({
        campaignId,
        artistId,
        rankNo: index + 1,
        snapshotAt,
        ...row,
      }));

    if (rankedRows.length === 0) {
      return [];
    }

    await this.prisma.artistRankingSnapshot.createMany({ data: rankedRows });
    return this.prisma.artistRankingSnapshot.findMany({
      where: { campaignId, snapshotAt },
      include: {
        artist: {
          select: { id: true, slug: true, displayName: true },
        },
      },
      orderBy: { rankNo: 'asc' },
    });
  }

  createPremiumVideoProduct(input: AdminPayload) {
    return this.prisma.premiumVideoProduct.create({
      data: {
        artistId: this.optionalString(input, 'artistId'),
        sku: this.string(input, 'sku'),
        title: this.string(input, 'title'),
        description: this.optionalString(input, 'description'),
        priceLumina: this.decimal(input, 'priceLumina'),
        status: this.string(input, 'status', 'draft'),
        publishedAt: this.optionalDate(input, 'publishedAt'),
      },
    });
  }

  updatePremiumVideoProduct(productId: string, input: AdminPayload) {
    return this.prisma.premiumVideoProduct.update({
      where: { id: productId },
      data: this.clean({
        artistId: this.optionalString(input, 'artistId'),
        sku: this.optionalString(input, 'sku'),
        title: this.optionalString(input, 'title'),
        description: this.optionalString(input, 'description'),
        priceLumina: this.optionalDecimal(input, 'priceLumina'),
        status: this.optionalString(input, 'status'),
        publishedAt: this.optionalDate(input, 'publishedAt'),
        updatedAt: new Date(),
      }),
    });
  }

  createChatFeatureProduct(input: AdminPayload) {
    return this.prisma.chatFeatureProduct.create({
      data: {
        sku: this.string(input, 'sku'),
        name: this.string(input, 'name'),
        featureType: this.string(input, 'featureType'),
        priceLumina: this.decimal(input, 'priceLumina'),
        status: this.string(input, 'status', 'active'),
        metadata: this.json(input, 'metadata'),
      },
    });
  }

  updateChatFeatureProduct(productId: string, input: AdminPayload) {
    return this.prisma.chatFeatureProduct.update({
      where: { id: productId },
      data: this.clean({
        sku: this.optionalString(input, 'sku'),
        name: this.optionalString(input, 'name'),
        featureType: this.optionalString(input, 'featureType'),
        priceLumina: this.optionalDecimal(input, 'priceLumina'),
        status: this.optionalString(input, 'status'),
        metadata: this.optionalJson(input, 'metadata'),
        updatedAt: new Date(),
      }),
    });
  }

  private async upsertArtistProfiles(artistId: string, input: AdminPayload) {
    const publicProfile = this.object(input, 'publicProfile');
    const visualProfile = this.object(input, 'visualProfile');
    const contentProfile = this.object(input, 'contentProfile');

    if (publicProfile) {
      await this.prisma.artistPublicProfile.upsert({
        where: { artistId },
        update: this.clean({ ...publicProfile, updatedAt: new Date() }) as never,
        create: { artistId, ...publicProfile } as never,
      });
    }

    if (visualProfile) {
      await this.prisma.artistVisualProfile.upsert({
        where: { artistId },
        update: this.clean({ ...visualProfile, updatedAt: new Date() }) as never,
        create: { artistId, ...visualProfile } as never,
      });
    }

    if (contentProfile) {
      await this.prisma.artistContentProfile.upsert({
        where: { artistId },
        update: this.clean({ ...contentProfile, updatedAt: new Date() }) as never,
        create: { artistId, ...contentProfile } as never,
      });
    }
  }

  private getArtistWithProfiles(artistId: string) {
    return this.prisma.artist.findUniqueOrThrow({
      where: { id: artistId },
      include: {
        publicProfile: true,
        visualProfile: true,
        contentProfile: true,
      },
    });
  }

  private async ensureArtist(artistId: string) {
    const artist = await this.prisma.artist.findUnique({ where: { id: artistId } });

    if (!artist) {
      throw new NotFoundException('Artist not found');
    }
  }

  private string(input: AdminPayload, key: string, fallback?: string) {
    const value = input[key] ?? fallback;

    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${key} must be a non-empty string`);
    }

    return value.trim();
  }

  private optionalString(input: AdminPayload, key: string) {
    const value = input[key];
    return typeof value === 'string' ? value.trim() : undefined;
  }

  private number(input: AdminPayload, key: string, fallback?: number) {
    const value = input[key] ?? fallback;
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      throw new BadRequestException(`${key} must be a number`);
    }

    return parsed;
  }

  private optionalNumber(input: AdminPayload, key: string) {
    return input[key] === undefined ? undefined : this.number(input, key);
  }

  private decimal(input: AdminPayload, key: string, fallback?: number) {
    const value = input[key] ?? fallback;

    try {
      return new Decimal(value as string | number);
    } catch {
      throw new BadRequestException(`${key} must be a decimal`);
    }
  }

  private optionalDecimal(input: AdminPayload, key: string) {
    return input[key] === undefined ? undefined : this.decimal(input, key);
  }

  private date(input: AdminPayload, key: string) {
    const value = input[key];
    const date = new Date(String(value));

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${key} must be a valid date`);
    }

    return date;
  }

  private optionalDate(input: AdminPayload, key: string) {
    return input[key] === undefined ? undefined : this.date(input, key);
  }

  private optionalBigInt(input: AdminPayload, key: string) {
    return input[key] === undefined ? undefined : BigInt(String(input[key]));
  }

  private json(input: AdminPayload, key: string) {
    return (input[key] ?? {}) as object;
  }

  private optionalJson(input: AdminPayload, key: string) {
    return input[key] === undefined ? undefined : this.json(input, key);
  }

  private object(input: AdminPayload, key: string) {
    const value = input[key];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as AdminPayload)
      : undefined;
  }

  private clean<T extends Record<string, unknown>>(input: T) {
    return Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as T;
  }
}
