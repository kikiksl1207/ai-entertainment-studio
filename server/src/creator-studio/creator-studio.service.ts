import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { buildPublicAssetUrl } from '../common/asset-url';
import { PrismaService } from '../prisma/prisma.service';

const OPEN_IMAGE_REQUEST_STATUSES = [
  'submitted',
  'reviewing',
  'generating',
  'needs_more_info',
];

@Injectable()
export class CreatorStudioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getStudio(userId: string) {
    const operators = await this.prisma.artistOperator.findMany({
      where: {
        userId,
        status: 'active',
        revokedAt: null,
      },
      include: {
        artist: {
          include: {
            publicProfile: true,
            visualProfile: true,
            contentProfile: true,
            artistAssets: {
              where: { asset: { visibility: 'public' } },
              include: { asset: true },
              orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const artistIds = operators.map((operator) => operator.artistId);
    const [imageRequestCounts, recentImageRequests] = artistIds.length
      ? await Promise.all([
          this.prisma.creatorImageRequest.groupBy({
            by: ['artistId', 'status'],
            where: { artistId: { in: artistIds } },
            _count: { _all: true },
          }),
          this.prisma.creatorImageRequest.findMany({
            where: { artistId: { in: artistIds } },
            take: 8,
            include: {
              artist: {
                select: {
                  id: true,
                  slug: true,
                  displayName: true,
                  status: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          }),
        ])
      : [[], []];

    const imageRequestSummary = this.imageRequestSummary(imageRequestCounts);

    return {
      artists: operators.map((operator) =>
        this.presentOperator(operator, imageRequestSummary.byArtist[operator.artistId]),
      ),
      imageRequests: {
        summary: imageRequestSummary.total,
        recent: recentImageRequests.map((request) => this.presentImageRequest(request)),
      },
      policy: {
        mode: 'creator_studio_bootstrap_v1',
        emptyState:
          'No active artist operator access is connected to this account yet.',
        canCreateImageRequests: artistIds.length > 0,
        imageRequestTypes: [
          'profile_image',
          'content_image',
          'feed_image',
          'shortform_thumbnail',
          'concept_reference',
        ],
        endpoints: {
          createImageRequest: '/api/v1/creator-image-requests',
          imageRequests: '/api/v1/me/creator-image-requests',
          uploadIntent: '/api/v1/me/assets/upload-intents',
          confirmUpload: '/api/v1/me/assets/:assetId/confirm-upload',
        },
      },
    };
  }

  private presentOperator(
    operator: Prisma.ArtistOperatorGetPayload<{
      include: {
        artist: {
          include: {
            publicProfile: true;
            visualProfile: true;
            contentProfile: true;
            artistAssets: { include: { asset: true } };
          };
        };
      };
    }>,
    imageRequests?: {
      total: number;
      open: number;
      delivered: number;
      rejected: number;
      byStatus: Record<string, number>;
    },
  ) {
    const assets = operator.artist.artistAssets
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
      operator: {
        id: operator.id,
        role: operator.role,
        permissions: operator.permissions,
        status: operator.status,
        createdAt: operator.createdAt,
      },
      artist: {
        id: operator.artist.id,
        slug: operator.artist.slug,
        displayName: operator.artist.displayName,
        status: operator.artist.status,
        sortOrder: operator.artist.sortOrder,
        launchedAt: operator.artist.launchedAt,
        publicProfile: operator.artist.publicProfile,
        visualProfile: operator.artist.visualProfile,
        contentProfile: operator.artist.contentProfile,
        coverImage,
        thumbnailImage,
        assets,
      },
      imageRequests:
        imageRequests ?? {
          total: 0,
          open: 0,
          delivered: 0,
          rejected: 0,
          byStatus: {},
        },
    };
  }

  private presentImageRequest(
    request: Prisma.CreatorImageRequestGetPayload<{
      include: {
        artist: {
          select: {
            id: true;
            slug: true;
            displayName: true;
            status: true;
          };
        };
      };
    }>,
  ) {
    return {
      ...request,
      referenceAssetIds: Array.isArray(request.referenceAssetIds)
        ? request.referenceAssetIds
        : [],
      resultAssetIds: Array.isArray(request.resultAssetIds) ? request.resultAssetIds : [],
    };
  }

  private imageRequestSummary(
    counts: Array<{
      artistId: string;
      status: string;
      _count: { _all: number };
    }>,
  ) {
    const total = {
      total: 0,
      open: 0,
      delivered: 0,
      rejected: 0,
      byStatus: {} as Record<string, number>,
    };
    const byArtist: Record<string, typeof total> = {};

    for (const row of counts) {
      const count = row._count._all;
      const artistSummary =
        byArtist[row.artistId] ??
        (byArtist[row.artistId] = {
          total: 0,
          open: 0,
          delivered: 0,
          rejected: 0,
          byStatus: {},
        });

      for (const summary of [total, artistSummary]) {
        summary.total += count;
        summary.byStatus[row.status] = (summary.byStatus[row.status] ?? 0) + count;

        if (OPEN_IMAGE_REQUEST_STATUSES.includes(row.status)) {
          summary.open += count;
        }

        if (row.status === 'delivered') {
          summary.delivered += count;
        }

        if (row.status === 'rejected') {
          summary.rejected += count;
        }
      }
    }

    return { total, byArtist };
  }

  private isPublicReadyAsset(metadata: unknown) {
    const record = this.recordOrEmpty(metadata);
    const uploadIntent = this.recordOrEmpty(record.uploadIntent);
    const lifecycle = this.recordOrEmpty(record.lifecycle);

    return (
      uploadIntent.status !== 'pending_upload' &&
      lifecycle.status !== 'archived'
    );
  }

  private recordOrEmpty(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private assetUrl(storageKey: string) {
    return buildPublicAssetUrl(this.configService, storageKey, storageKey);
  }
}
