import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildPublicAssetUrl } from '../../common/asset-url';
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

    return artists
      .map((artist) => this.toPublicArtist(artist))
      .filter((artist) => this.isPublicReadyArtist(artist));
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

    if (!artist) {
      return null;
    }

    const publicArtist = this.toPublicArtist(artist, { includeContentProfile: true });
    return this.isPublicReadyArtist(publicArtist) ? publicArtist : null;
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
    const assets = (artist.artistAssets ?? [])
      .filter((artistAsset) => this.isPublicReadyAsset(artistAsset.asset.metadata))
      .map((artistAsset) => ({
        id: artistAsset.asset.id,
        usageType: artistAsset.usageType,
        assetType: artistAsset.asset.assetType,
        url: this.assetUrl(artistAsset.asset.storageKey),
        mimeType: artistAsset.asset.mimeType,
        width: artistAsset.asset.width,
        height: artistAsset.asset.height,
        isPrimary: artistAsset.isPrimary,
        sortOrder: artistAsset.sortOrder,
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
    return buildPublicAssetUrl(this.configService, storageKey);
  }

  private isPublicReadyArtist(artist: { coverImage: unknown; thumbnailImage: unknown }) {
    return Boolean(artist.coverImage && artist.thumbnailImage);
  }

  private isPublicReadyAsset(metadata: unknown) {
    if (!this.isRecord(metadata)) {
      return true;
    }

    const uploadIntent = metadata.uploadIntent;
    const lifecycle = metadata.lifecycle;

    if (this.isRecord(lifecycle) && lifecycle.status === 'archived') {
      return false;
    }

    if (!this.isRecord(uploadIntent)) {
      return true;
    }

    return uploadIntent.status === 'uploaded';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
