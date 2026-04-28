import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

const publicArtistInclude = {
  publicProfile: true,
  visualProfile: true,
  artistAssets: {
    where: {
      asset: {
        visibility: 'public' as const,
      },
    },
    include: {
      asset: true,
    },
    orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }],
  },
};

@Injectable()
export class ArtistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findAll() {
    const artists = await this.prisma.artist.findMany({
      where: { status: 'active' },
      include: publicArtistInclude,
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    });

    return artists.map((artist) => this.toPublicArtist(artist));
  }

  async findBySlug(slug: string) {
    const artist = await this.prisma.artist.findFirst({
      where: {
        slug,
        status: 'active',
      },
      include: {
        ...publicArtistInclude,
        contentProfile: true,
      },
    });

    return artist ? this.toPublicArtist(artist, { includeContentProfile: true }) : null;
  }

  private toPublicArtist(
    artist: Awaited<ReturnType<PrismaService['artist']['findFirstOrThrow']>> & {
      publicProfile?: unknown;
      visualProfile?: unknown;
      contentProfile?: unknown;
      artistAssets?: Array<{
        usageType: string;
        isPrimary: boolean;
        sortOrder: number;
        asset: {
          id: string;
          assetType: string;
          storageProvider: string;
          storageKey: string;
          mimeType: string;
          width: number | null;
          height: number | null;
          metadata: unknown;
        };
      }>;
    },
    options: { includeContentProfile?: boolean } = {},
  ) {
    const assets = (artist.artistAssets ?? []).map((artistAsset) => ({
      id: artistAsset.asset.id,
      usageType: artistAsset.usageType,
      assetType: artistAsset.asset.assetType,
      storageProvider: artistAsset.asset.storageProvider,
      storageKey: artistAsset.asset.storageKey,
      url: this.assetUrl(artistAsset.asset.storageKey),
      mimeType: artistAsset.asset.mimeType,
      width: artistAsset.asset.width,
      height: artistAsset.asset.height,
      isPrimary: artistAsset.isPrimary,
      sortOrder: artistAsset.sortOrder,
      metadata: artistAsset.asset.metadata,
    }));
    const coverImage = assets.find((asset) => asset.usageType === 'cover') ?? null;
    const thumbnailImage = assets.find((asset) => asset.usageType === 'thumb') ?? coverImage;

    return {
      id: artist.id,
      slug: artist.slug,
      displayName: artist.displayName,
      status: artist.status,
      sortOrder: artist.sortOrder,
      launchedAt: artist.launchedAt,
      profile: artist.publicProfile,
      visual: artist.visualProfile,
      contentProfile: options.includeContentProfile ? artist.contentProfile : undefined,
      coverImage,
      thumbnailImage,
      assets,
      createdAt: artist.createdAt,
      updatedAt: artist.updatedAt,
    };
  }

  private assetUrl(storageKey: string) {
    const baseUrl = this.configService.get<string>('ASSET_PUBLIC_BASE_URL');

    if (!baseUrl) {
      return storageKey;
    }

    return `${baseUrl.replace(/\/+$/, '')}/${storageKey}`;
  }
}
