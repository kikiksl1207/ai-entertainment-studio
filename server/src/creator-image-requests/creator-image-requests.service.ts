import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminUpdateCreatorImageRequestDto,
  CreateCreatorImageRequestDto,
  CreatorImageRequestListQueryDto,
} from './dto/creator-image-requests.dto';

type AssetForOwnership = {
  id: string;
  metadata: Prisma.JsonValue;
};

@Injectable()
export class CreatorImageRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async createRequest(user: AuthUser, input: CreateCreatorImageRequestDto) {
    await this.assertArtistOperator(user.id, input.artistId);
    await this.assertReferenceAssetsBelongToUser(user.id, input.referenceAssetIds ?? []);

    const request = await this.prisma.creatorImageRequest.create({
      data: {
        requesterUserId: user.id,
        artistId: input.artistId,
        requestType: input.requestType,
        title: input.title,
        brief: input.brief,
        prompt: input.prompt,
        referenceAssetIds: this.toJson(input.referenceAssetIds ?? []),
        metadata: this.toJson(input.metadata ?? {}),
      },
      include: this.requestInclude(),
    });

    return {
      request: this.presentRequest(request),
      message: 'Creator image request submitted',
    };
  }

  async listMyRequests(user: AuthUser, query: CreatorImageRequestListQueryDto) {
    const take = query.take ?? 30;
    const where: Prisma.CreatorImageRequestWhereInput = {
      OR: [
        { requesterUserId: user.id },
        {
          artist: {
            artistOperators: {
              some: {
                userId: user.id,
                status: 'active',
                revokedAt: null,
              },
            },
          },
        },
      ],
      ...(query.artistId ? { artistId: query.artistId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.requestType ? { requestType: query.requestType } : {}),
    };

    return this.findPaginated(where, take, query.cursor);
  }

  async getMyRequest(user: AuthUser, requestId: string) {
    const request = await this.prisma.creatorImageRequest.findFirst({
      where: {
        id: requestId,
        OR: [
          { requesterUserId: user.id },
          {
            artist: {
              artistOperators: {
                some: {
                  userId: user.id,
                  status: 'active',
                  revokedAt: null,
                },
              },
            },
          },
        ],
      },
      include: this.requestInclude(),
    });

    if (!request) {
      throw new NotFoundException('Creator image request not found');
    }

    return this.presentRequest(request);
  }

  listAdminRequests(query: CreatorImageRequestListQueryDto) {
    const take = query.take ?? 50;
    const filters: Prisma.CreatorImageRequestWhereInput[] = [];

    if (query.artistId) {
      filters.push({ artistId: query.artistId });
    }

    if (query.status) {
      filters.push({ status: query.status });
    }

    if (query.requestType) {
      filters.push({ requestType: query.requestType });
    }

    if (query.query) {
      filters.push({
        OR: [
          { title: { contains: query.query, mode: 'insensitive' } },
          { brief: { contains: query.query, mode: 'insensitive' } },
          { prompt: { contains: query.query, mode: 'insensitive' } },
          { artist: { displayName: { contains: query.query, mode: 'insensitive' } } },
          { requester: { email: { contains: query.query, mode: 'insensitive' } } },
          {
            requester: {
              profile: { displayName: { contains: query.query, mode: 'insensitive' } },
            },
          },
        ],
      });
    }

    return this.findPaginated(filters.length ? { AND: filters } : {}, take, query.cursor);
  }

  async getAdminRequest(requestId: string) {
    const request = await this.prisma.creatorImageRequest.findUnique({
      where: { id: requestId },
      include: this.requestInclude(),
    });

    if (!request) {
      throw new NotFoundException('Creator image request not found');
    }

    return this.presentRequest(request);
  }

  async updateAdminRequest(
    user: AuthUser,
    requestId: string,
    input: AdminUpdateCreatorImageRequestDto,
  ) {
    if (
      input.status === undefined &&
      input.moderationStatus === undefined &&
      input.adminNote === undefined &&
      input.rejectionReason === undefined &&
      input.resultAssetIds === undefined &&
      input.metadata === undefined
    ) {
      throw new BadRequestException('At least one update field is required');
    }

    const before = await this.prisma.creatorImageRequest.findUnique({
      where: { id: requestId },
      include: this.requestInclude(),
    });

    if (!before) {
      throw new NotFoundException('Creator image request not found');
    }

    if (input.resultAssetIds) {
      await this.assertAssetsExist(input.resultAssetIds);
    }

    const request = await this.prisma.creatorImageRequest.update({
      where: { id: requestId },
      data: this.clean({
        status: input.status,
        moderationStatus: input.moderationStatus,
        adminNote: input.adminNote,
        rejectionReason: input.rejectionReason,
        resultAssetIds:
          input.resultAssetIds === undefined ? undefined : this.toJson(input.resultAssetIds),
        metadata:
          input.metadata === undefined
            ? undefined
            : this.mergeMetadata(before.metadata, {
                ...input.metadata,
                adminUpdatedByUserId: user.id,
                adminUpdatedAt: new Date().toISOString(),
              }),
        updatedAt: new Date(),
      }),
      include: this.requestInclude(),
    });

    await this.recordAudit(user, request.id, before, request);

    return {
      request: this.presentRequest(request),
      message: 'Creator image request updated',
    };
  }

  private async findPaginated(
    where: Prisma.CreatorImageRequestWhereInput,
    take: number,
    cursor?: string,
  ) {
    const rows = await this.prisma.creatorImageRequest.findMany({
      where,
      take: take + 1,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      include: this.requestInclude(),
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const lastItem = items.at(-1);

    return {
      items: items.map((request) => this.presentRequest(request)),
      count: items.length,
      hasMore,
      nextCursor: hasMore && lastItem ? lastItem.id : null,
    };
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

  private async assertReferenceAssetsBelongToUser(userId: string, assetIds: string[]) {
    if (!assetIds.length) {
      return;
    }

    const assets = await this.assertAssetsExist(assetIds);
    const blockedAsset = assets.find((asset) => {
      const metadata = this.metadataObject(asset.metadata);
      const uploadIntent = this.metadataObject(metadata.uploadIntent);
      return uploadIntent.createdByUserId && uploadIntent.createdByUserId !== userId;
    });

    if (blockedAsset) {
      throw new ForbiddenException('Reference asset owner access is required');
    }
  }

  private async assertAssetsExist(assetIds: string[]) {
    const uniqueAssetIds = [...new Set(assetIds)];
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: uniqueAssetIds } },
      select: { id: true, metadata: true },
    });

    if (assets.length !== uniqueAssetIds.length) {
      throw new BadRequestException('All asset ids must exist');
    }

    return assets as AssetForOwnership[];
  }

  private requestInclude() {
    return {
      requester: {
        select: {
          id: true,
          email: true,
          status: true,
          profile: {
            select: {
              displayName: true,
              publicHandle: true,
              avatarAssetId: true,
            },
          },
        },
      },
      artist: {
        select: {
          id: true,
          slug: true,
          displayName: true,
          status: true,
        },
      },
    } satisfies Prisma.CreatorImageRequestInclude;
  }

  private presentRequest(
    request: Prisma.CreatorImageRequestGetPayload<{
      include: ReturnType<CreatorImageRequestsService['requestInclude']>;
    }>,
  ) {
    return {
      ...request,
      referenceAssetIds: this.jsonArray(request.referenceAssetIds),
      resultAssetIds: this.jsonArray(request.resultAssetIds),
    };
  }

  private recordAudit(
    user: AuthUser,
    targetId: string,
    beforeData: unknown,
    afterData: unknown,
  ) {
    return this.prisma.auditEvent.create({
      data: {
        actorUserId: user.id,
        actorType: 'admin',
        action: 'creator_image_request.update',
        targetType: 'creator_image_request',
        targetId,
        beforeData: this.toJson(beforeData),
        afterData: this.toJson(afterData),
        metadata: Prisma.JsonNull,
      },
    });
  }

  private metadataObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private jsonArray(value: Prisma.JsonValue) {
    return Array.isArray(value) ? value : [];
  }

  private mergeMetadata(current: Prisma.JsonValue, patch: Record<string, unknown>) {
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
