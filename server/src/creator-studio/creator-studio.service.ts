import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { buildPublicAssetUrl } from '../common/asset-url';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCreatorStudioArtistProfileDto } from './dto/creator-studio.dto';

const OPEN_IMAGE_REQUEST_STATUSES = [
  'submitted',
  'reviewing',
  'generating',
  'needs_more_info',
];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  async updateArtistProfile(
    user: AuthUser,
    artistId: string,
    input: UpdateCreatorStudioArtistProfileDto,
  ) {
    this.assertUuid(artistId, 'artistId');
    await this.assertArtistOperator(user.id, artistId);

    if (
      input.publicProfile === undefined &&
      input.visualProfile === undefined &&
      input.contentProfile === undefined
    ) {
      throw new BadRequestException('At least one profile section is required');
    }

    const before = await this.prisma.artist.findUnique({
      where: { id: artistId },
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
    });

    if (!before) {
      throw new NotFoundException('Artist not found');
    }

    await this.prisma.$transaction(async (tx) => {
      if (input.publicProfile !== undefined) {
        const publicMetadata =
          input.publicProfile.publicMetadata === undefined
            ? undefined
            : this.mergeMetadata(before.publicProfile?.publicMetadata, {
                ...input.publicProfile.publicMetadata,
                creatorStudioUpdatedByUserId: user.id,
                creatorStudioUpdatedAt: new Date().toISOString(),
              });

        await tx.artistPublicProfile.upsert({
          where: { artistId },
          create: {
            artistId,
            tagline: input.publicProfile.tagline,
            summary: input.publicProfile.summary,
            personalityKeywords: input.publicProfile.personalityKeywords ?? [],
            publicStory: input.publicProfile.publicStory,
            publicMetadata: publicMetadata ?? Prisma.JsonNull,
          },
          update: this.clean({
            tagline: input.publicProfile.tagline,
            summary: input.publicProfile.summary,
            personalityKeywords: input.publicProfile.personalityKeywords,
            publicStory: input.publicProfile.publicStory,
            publicMetadata,
            updatedAt: new Date(),
          }),
        });
      }

      if (input.visualProfile !== undefined) {
        await tx.artistVisualProfile.upsert({
          where: { artistId },
          create: {
            artistId,
            visualKeywords: input.visualProfile.visualKeywords ?? [],
            styleNotes: input.visualProfile.styleNotes,
            primaryColor: input.visualProfile.primaryColor,
            secondaryColor: input.visualProfile.secondaryColor,
          },
          update: this.clean({
            visualKeywords: input.visualProfile.visualKeywords,
            styleNotes: input.visualProfile.styleNotes,
            primaryColor: input.visualProfile.primaryColor,
            secondaryColor: input.visualProfile.secondaryColor,
            updatedAt: new Date(),
          }),
        });
      }

      if (input.contentProfile !== undefined) {
        await tx.artistContentProfile.upsert({
          where: { artistId },
          create: {
            artistId,
            contentTone: input.contentProfile.contentTone,
            allowedTopics: input.contentProfile.allowedTopics ?? [],
            blockedTopics: input.contentProfile.blockedTopics ?? [],
            operatingNotes: input.contentProfile.operatingNotes,
          },
          update: this.clean({
            contentTone: input.contentProfile.contentTone,
            allowedTopics: input.contentProfile.allowedTopics,
            blockedTopics: input.contentProfile.blockedTopics,
            operatingNotes: input.contentProfile.operatingNotes,
            updatedAt: new Date(),
          }),
        });
      }

      await tx.artist.update({
        where: { id: artistId },
        data: { updatedAt: new Date() },
      });

      await tx.auditEvent.create({
        data: {
          actorUserId: user.id,
          actorType: 'creator',
          action: 'creator_studio.artist_profile.update',
          targetType: 'artist',
          targetId: artistId,
          beforeData: this.toJson({
            publicProfile: before.publicProfile,
            visualProfile: before.visualProfile,
            contentProfile: before.contentProfile,
          }),
          afterData: this.toJson(input),
          metadata: Prisma.JsonNull,
        },
      });
    });

    const updated = await this.prisma.artistOperator.findFirstOrThrow({
      where: {
        userId: user.id,
        artistId,
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
    });

    return {
      artist: this.presentOperator(updated).artist,
      message: 'Creator studio artist profile updated',
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

  private async assertArtistOperator(userId: string, artistId: string) {
    const operator = await this.prisma.artistOperator.findFirst({
      where: {
        userId,
        artistId,
        status: 'active',
        revokedAt: null,
      },
      select: { id: true },
    });

    if (!operator) {
      throw new ForbiddenException('Artist operator access is required');
    }
  }

  private assertUuid(value: string, field: string) {
    if (!UUID_PATTERN.test(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
  }

  private mergeMetadata(current: Prisma.JsonValue | undefined, patch: Record<string, unknown>) {
    const base =
      current && typeof current === 'object' && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {};

    return this.toJson({ ...base, ...patch });
  }

  private clean<T extends Record<string, unknown>>(input: T) {
    return Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as T;
  }

  private toJson(value: unknown) {
    if (value === null || value === undefined) {
      return Prisma.JsonNull;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
