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

const artistCategoryTaxonomy = {
  labels: ['아티스트', '모델', '배우', '엔터테이너', '스포츠', '기타'],
  bySlug: {
    'yoon-serin': '아티스트',
    'han-seoyul': '아티스트',
    'oh-hyerin': '아티스트',
    'min-chaeon': '아티스트',
    'baek-ria': '아티스트',
    'oh-yuna': '아티스트',
    'cha-dohyun': '아티스트',
    'kang-sia': '모델',
    'ha-yuna': '모델',
    'seo-yuan': '모델',
    'choi-seojin': '배우',
    'lee-jiwon': '배우',
    'kwon-taejun': '배우',
    'park-doa': '엔터테이너',
    'seo-hamin': '엔터테이너',
    'ryu-taeo': '스포츠',
  },
} as const;

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

  async findRoadmap() {
    const artists = await this.prisma.artist.findMany({
      where: { status: { in: ['planned', 'candidate'] } },
      include: publicArtistInclude,
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    });

    return {
      items: artists.map((artist) => this.toRoadmapArtist(artist)),
      policy: {
        visibility: 'planned_candidate_only',
        categories: artistCategoryTaxonomy.labels,
        publicLaunchRule:
          'Roadmap artists are not returned by GET /api/v1/artists until status becomes active and cover/thumb assets are ready.',
      },
    };
  }

  async findBySlug(slug: string, viewerUserId?: string) {
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
    if (!this.isPublicReadyArtist(publicArtist)) {
      return null;
    }

    return this.withViewerFollowState(publicArtist, viewerUserId);
  }

  private async withViewerFollowState(
    artist: ReturnType<ArtistsService['toPublicArtist']>,
    viewerUserId?: string,
  ) {
    const [followerCount, viewerFollow] = await Promise.all([
      this.prisma.artistFollow.count({
        where: {
          artistId: artist.id,
          status: 'active',
          deletedAt: null,
        },
      }),
      viewerUserId
        ? this.prisma.artistFollow.findUnique({
            where: {
              userId_artistId: {
                userId: viewerUserId,
                artistId: artist.id,
              },
            },
            select: {
              status: true,
              deletedAt: true,
            },
          })
        : Promise.resolve(null),
    ]);
    const isFollowing = Boolean(viewerFollow?.status === 'active' && !viewerFollow.deletedAt);

    return {
      ...artist,
      stats: {
        followerCount,
      },
      viewer: {
        isAuthenticated: Boolean(viewerUserId),
        isFollowing,
        canFollow: Boolean(viewerUserId && !isFollowing),
        canUnfollow: Boolean(viewerUserId && isFollowing),
      },
      policy: {
        followTarget: 'artist_id',
        followEndpoint: 'POST /api/v1/artists/:artistId/follow',
        unfollowEndpoint: 'DELETE /api/v1/artists/:artistId/follow',
      },
    };
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
    const publicMetadata = this.recordOrEmpty(
      (artist.publicProfile as { publicMetadata?: unknown } | null | undefined)?.publicMetadata,
    );
    const profileFacts = this.recordOrEmpty(publicMetadata.profileFacts);
    const displayCategory = this.displayCategoryForArtist(artist.slug, profileFacts);

    return {
      id: artist.id,
      slug: artist.slug,
      displayName: artist.displayName,
      category: displayCategory,
      displayCategory,
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

  private toRoadmapArtist(
    artist: Awaited<ReturnType<PrismaService['artist']['findFirstOrThrow']>> & {
      publicProfile?: {
        tagline?: string | null;
        summary?: string | null;
        personalityKeywords?: string[];
        publicStory?: string | null;
        publicMetadata?: unknown;
      } | null;
      visualProfile?: unknown;
      artistAssets?: Array<{
        usageType: string;
        isPrimary: boolean;
        sortOrder: number;
        asset: {
          id: string;
          storageKey: string;
          metadata: unknown;
        };
      }>;
    },
  ) {
    const assets = (artist.artistAssets ?? []).filter((artistAsset) =>
      this.isPublicReadyAsset(artistAsset.asset.metadata),
    );
    const cover = assets.find((asset) => asset.usageType === 'cover') ?? null;
    const thumb = assets.find((asset) => asset.usageType === 'thumb') ?? cover;
    const galleryCount = assets.filter((asset) => asset.usageType === 'gallery').length;
    const publicMetadata = this.recordOrEmpty(artist.publicProfile?.publicMetadata);
    const profileFacts = this.recordOrEmpty(publicMetadata.profileFacts);

    return {
      id: artist.id,
      slug: artist.slug,
      displayName: artist.displayName,
      category: this.displayCategoryForArtist(artist.slug, profileFacts),
      displayCategory: this.displayCategoryForArtist(artist.slug, profileFacts),
      status: artist.status,
      sortOrder: artist.sortOrder,
      gender: this.stringFromUnknown(profileFacts.gender),
      launchPhase: this.stringFromUnknown(profileFacts.launchPhase) ?? artist.status,
      operationRole: this.stringFromUnknown(profileFacts.operationRole),
      publicTagline:
        this.stringFromUnknown(profileFacts.publicTagline) ?? artist.publicProfile?.tagline ?? null,
      fandomCandidate: this.stringFromUnknown(profileFacts.fandomNameCandidate),
      characterType: this.stringFromUnknown(profileFacts.characterType),
      thumbnailUrl: thumb ? this.assetUrl(thumb.asset.storageKey) : null,
      thumbUrl: thumb ? this.assetUrl(thumb.asset.storageKey) : null,
      coverUrl: cover ? this.assetUrl(cover.asset.storageKey) : null,
      galleryCount,
      imageBaselineNote: this.stringFromUnknown(profileFacts.imageBaselineNote),
      metadata: {
        monetizationLane: this.stringFromUnknown(profileFacts.monetizationLane),
        contentLane: this.stringFromUnknown(profileFacts.contentLane),
        talkTone: this.stringArrayFromUnknown(profileFacts.talkTone),
        favoriteGifts: this.stringArrayFromUnknown(profileFacts.favoriteGifts),
        signatureItems: this.stringArrayFromUnknown(profileFacts.signatureItems),
        representativeContents:
          this.stringArrayFromUnknown(profileFacts.representativeContents) ??
          this.stringArrayFromUnknown(profileFacts.representativeContent),
        adCategories:
          this.stringArrayFromUnknown(profileFacts.adCategories) ??
          this.stringArrayFromUnknown(profileFacts.adCategory),
      },
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

  private recordOrEmpty(value: unknown) {
    return this.isRecord(value) ? value : {};
  }

  private stringFromUnknown(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  }

  private stringArrayFromUnknown(value: unknown) {
    if (Array.isArray(value)) {
      const strings = value.filter((item): item is string => typeof item === 'string');
      return strings.length > 0 ? strings : null;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return [value];
    }

    return null;
  }

  private displayCategoryForArtist(slug: string, profileFacts: Record<string, unknown>) {
    return (
      this.stringFromUnknown(profileFacts.displayCategory) ??
      this.stringFromUnknown(profileFacts.category) ??
      artistCategoryTaxonomy.bySlug[slug as keyof typeof artistCategoryTaxonomy.bySlug] ??
      '기타'
    );
  }
}
