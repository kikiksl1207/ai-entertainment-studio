import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash, createHmac, randomUUID } from 'crypto';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

type AdminPayload = Record<string, unknown>;
type AuditQuery = Record<string, string | undefined>;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  getAdminRoles() {
    return this.prisma.adminRole.findMany({
      orderBy: { name: 'asc' },
    });
  }

  getAdminUsers() {
    return this.prisma.adminUser.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        role: true,
        user: {
          select: {
            id: true,
            email: true,
            status: true,
            createdAt: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
  }

  async createAdminUser(user: AuthUser, input: AdminPayload) {
    this.assertSuperAdmin(user);

    const targetUser = await this.findAdminTargetUser(input);
    const existing = await this.prisma.adminUser.findUnique({
      where: { userId: targetUser.id },
    });

    if (existing) {
      throw new ConflictException('User is already an admin');
    }

    const role = await this.findAdminRole(this.string(input, 'roleName', 'content_admin'));
    const adminUser = await this.prisma.adminUser.create({
      data: {
        userId: targetUser.id,
        roleId: role.id,
        status: this.adminStatus(input, 'status', 'active'),
        createdByUserId: user.id,
      },
      include: {
        role: true,
        user: {
          select: {
            id: true,
            email: true,
            status: true,
          },
        },
      },
    });

    await this.recordAudit(
      user,
      'admin_user.create',
      'admin_user',
      adminUser.id,
      null,
      adminUser,
    );

    return adminUser;
  }

  async updateAdminUser(user: AuthUser, adminUserId: string, input: AdminPayload) {
    this.assertSuperAdmin(user);

    const before = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      include: { role: true, user: true },
    });

    if (!before) {
      throw new NotFoundException('Admin user not found');
    }

    const nextStatus =
      input.status === undefined ? undefined : this.adminStatus(input, 'status');

    if (before.userId === user.id && nextStatus && nextStatus !== 'active') {
      throw new BadRequestException('You cannot deactivate your own admin access');
    }

    const roleName = this.optionalString(input, 'roleName');
    const role = roleName ? await this.findAdminRole(roleName) : null;
    const adminUser = await this.prisma.adminUser.update({
      where: { id: adminUserId },
      data: this.clean({
        roleId: role?.id,
        status: nextStatus,
        updatedAt: new Date(),
      }),
      include: {
        role: true,
        user: {
          select: {
            id: true,
            email: true,
            status: true,
          },
        },
      },
    });

    await this.recordAudit(
      user,
      'admin_user.update',
      'admin_user',
      adminUser.id,
      before,
      adminUser,
    );

    return adminUser;
  }

  getAuditEvents(query: AuditQuery) {
    const take = Math.max(1, Math.min(this.number(query, 'take', 50), 100));
    const where: Prisma.AuditEventWhereInput = this.clean({
      actorUserId: this.optionalString(query, 'actorUserId'),
      action: this.optionalString(query, 'action'),
      targetType: this.optionalString(query, 'targetType'),
      targetId: this.optionalString(query, 'targetId'),
    });

    return this.prisma.auditEvent.findMany({
      where,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        actorUser: {
          select: { id: true, email: true, status: true },
        },
      },
    });
  }

  async getAssets(query: AuditQuery) {
    const take = Math.max(1, Math.min(this.number(query, 'take', 50), 100));
    const where: Prisma.AssetWhereInput = this.clean({
      assetType: this.optionalString(query, 'assetType'),
      visibility: this.optionalString(query, 'visibility'),
      storageProvider: this.optionalString(query, 'storageProvider'),
    });
    const uploadStatus = this.optionalString(query, 'uploadStatus');
    const lifecycleStatus = this.optionalString(query, 'lifecycleStatus');

    const assets = await this.prisma.asset.findMany({
      where,
      take,
      orderBy: { createdAt: 'desc' },
      include: this.assetRelationInclude(),
    });

    return assets
      .map((asset) => this.presentAsset(asset))
      .filter((asset) => !uploadStatus || asset.uploadStatus === uploadStatus)
      .filter((asset) => !lifecycleStatus || asset.lifecycleStatus === lifecycleStatus);
  }

  async getAsset(assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: this.assetRelationInclude(),
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    return this.presentAsset(asset);
  }

  async createAsset(user: AuthUser, input: AdminPayload) {
    const asset = await this.prisma.asset.create({
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

    await this.recordAudit(user, 'asset.create', 'asset', asset.id, null, asset);
    return asset;
  }

  async createAssetUploadIntent(user: AuthUser, input: AdminPayload) {
    const mimeType = this.allowedMimeType(this.string(input, 'mimeType'));
    const assetType = this.assetTypeFromInput(input, mimeType);
    const fileName = this.safeFileName(this.string(input, 'fileName'));
    const fileSizeBytes = this.fileSizeBytes(input, assetType);
    const visibility = this.visibility(input, 'visibility', 'public');
    const storageProvider = this.configService.get<string>('OBJECT_STORAGE_PROVIDER') ?? 'local';
    const storageKey = this.buildStorageKey(assetType, fileName);
    const expiresInSeconds = this.numberFromEnv('OBJECT_UPLOAD_INTENT_TTL_SECONDS', 900);
    const uploadUrl = this.buildUploadUrl(storageProvider, storageKey, expiresInSeconds);
    const publicUrl = this.buildPublicAssetUrl(storageKey);

    const asset = await this.prisma.asset.create({
      data: {
        assetType,
        visibility,
        storageProvider,
        storageKey,
        mimeType,
        fileSizeBytes,
        width: this.optionalNumber(input, 'width'),
        height: this.optionalNumber(input, 'height'),
        durationSeconds: this.optionalDecimal(input, 'durationSeconds'),
        checksum: this.optionalString(input, 'checksum'),
        metadata: this.toJson({
          ...this.json(input, 'metadata'),
          uploadIntent: {
            status: 'pending_upload',
            fileName,
            createdByUserId: user.id,
            createdAt: new Date().toISOString(),
          },
        }),
      },
    });

    const result = {
      asset,
      upload: {
        method: 'PUT',
        url: uploadUrl,
        publicUrl,
        storageProvider,
        storageKey,
        requiredHeaders: {
          'content-type': mimeType,
        },
        expiresInSeconds,
        mode: storageProvider === 'local' ? 'metadata_only' : 'direct_upload_ready',
      },
    };

    await this.recordAudit(
      user,
      'asset.upload_intent.create',
      'asset',
      asset.id,
      null,
      result,
    );
    return result;
  }

  async confirmAssetUpload(user: AuthUser, assetId: string, input: AdminPayload) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const before = asset;
    await this.assertObjectUploaded(asset.storageProvider, asset.storageKey);

    const confirmedAt = new Date().toISOString();
    const metadata = this.metadataObject(asset.metadata);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);
    const updatedMetadata = {
      ...metadata,
      uploadIntent: {
        ...uploadIntent,
        status: 'uploaded',
        confirmedByUserId: user.id,
        confirmedAt,
        objectETag: this.optionalString(input, 'objectETag'),
      },
    };

    const updatedAsset = await this.prisma.asset.update({
      where: { id: asset.id },
      data: {
        metadata: this.toJson(updatedMetadata),
        updatedAt: new Date(),
      },
    });

    const result = {
      asset: updatedAsset,
      upload: {
        status: 'uploaded',
        confirmedAt,
        publicUrl: this.buildPublicAssetUrl(updatedAsset.storageKey),
      },
    };

    await this.recordAudit(
      user,
      'asset.upload.confirm',
      'asset',
      updatedAsset.id,
      before,
      result,
    );

    return result;
  }

  async archiveAsset(user: AuthUser, assetId: string, input: AdminPayload) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: this.assetRelationInclude(),
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const linkedCount =
      asset.artistAssets.length + asset.shortformAssets.length + asset.premiumVideoAssets.length;
    const force = this.boolean(input, 'force', false);

    if (linkedCount > 0 && !force) {
      throw new BadRequestException('Asset must be unlinked before archive unless force is true');
    }

    const archivedAt = new Date().toISOString();
    const metadata = this.metadataObject(asset.metadata);
    const lifecycle = this.metadataObject(metadata.lifecycle);
    const updatedMetadata = {
      ...metadata,
      lifecycle: {
        ...lifecycle,
        status: 'archived',
        reason: this.optionalString(input, 'reason') ?? null,
        archivedByUserId: user.id,
        archivedAt,
      },
    };

    const updatedAsset = await this.prisma.asset.update({
      where: { id: asset.id },
      data: {
        metadata: this.toJson(updatedMetadata),
        updatedAt: new Date(),
      },
      include: this.assetRelationInclude(),
    });
    const result = this.presentAsset(updatedAsset);

    await this.recordAudit(
      user,
      'asset.archive',
      'asset',
      asset.id,
      this.presentAsset(asset),
      result,
      { force, linkedCount },
    );
    return result;
  }

  async restoreAsset(user: AuthUser, assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: this.assetRelationInclude(),
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const restoredAt = new Date().toISOString();
    const metadata = this.metadataObject(asset.metadata);
    const lifecycle = this.metadataObject(metadata.lifecycle);
    const updatedMetadata = {
      ...metadata,
      lifecycle: {
        ...lifecycle,
        status: 'active',
        restoredByUserId: user.id,
        restoredAt,
      },
    };

    const updatedAsset = await this.prisma.asset.update({
      where: { id: asset.id },
      data: {
        metadata: this.toJson(updatedMetadata),
        updatedAt: new Date(),
      },
      include: this.assetRelationInclude(),
    });
    const result = this.presentAsset(updatedAsset);

    await this.recordAudit(
      user,
      'asset.restore',
      'asset',
      asset.id,
      this.presentAsset(asset),
      result,
    );
    return result;
  }

  async createArtist(user: AuthUser, input: AdminPayload) {
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
    const result = await this.getArtistWithProfiles(artist.id);
    await this.recordAudit(user, 'artist.create', 'artist', artist.id, null, result);
    return result;
  }

  async updateArtist(user: AuthUser, artistId: string, input: AdminPayload) {
    await this.ensureArtist(artistId);
    const before = await this.getArtistWithProfiles(artistId);
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
    const result = await this.getArtistWithProfiles(artistId);
    await this.recordAudit(user, 'artist.update', 'artist', artistId, before, result);
    return result;
  }

  async linkArtistAsset(user: AuthUser, artistId: string, input: AdminPayload) {
    await this.ensureArtist(artistId);
    const asset = await this.ensureAssetLinkable(this.string(input, 'assetId'));
    const usageType = this.assetRole(input, 'usageType', 'cover');
    const isPrimary = this.boolean(input, 'isPrimary', false);
    const sortOrder = this.number(input, 'sortOrder', 0);

    const result = await this.prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.artistAsset.updateMany({
          where: { artistId, usageType },
          data: { isPrimary: false },
        });
      }

      return tx.artistAsset.upsert({
        where: {
          artistId_assetId_usageType: {
            artistId,
            assetId: asset.id,
            usageType,
          },
        },
        update: {
          isPrimary,
          sortOrder,
        },
        create: {
          artistId,
          assetId: asset.id,
          usageType,
          isPrimary,
          sortOrder,
        },
        include: { asset: true },
      });
    });

    await this.recordAudit(
      user,
      'artist_asset.link',
      'artist',
      artistId,
      null,
      result,
    );
    return result;
  }

  async unlinkArtistAsset(user: AuthUser, artistId: string, artistAssetId: string) {
    const link = await this.prisma.artistAsset.findUnique({
      where: { id: artistAssetId },
      include: { asset: true, artist: true },
    });

    if (!link || link.artistId !== artistId) {
      throw new NotFoundException('Artist asset link not found');
    }

    await this.prisma.artistAsset.delete({
      where: { id: artistAssetId },
    });

    const result = { deleted: true, link };
    await this.recordAudit(
      user,
      'artist_asset.unlink',
      'artist',
      artistId,
      link,
      result,
    );
    return result;
  }

  async createShortform(user: AuthUser, input: AdminPayload) {
    const shortform = await this.prisma.shortform.create({
      data: {
        artistId: this.optionalString(input, 'artistId'),
        title: this.string(input, 'title'),
        slug: this.string(input, 'slug'),
        description: this.optionalString(input, 'description'),
        status: this.string(input, 'status', 'draft'),
        publishedAt: this.optionalDate(input, 'publishedAt'),
      },
    });

    await this.recordAudit(user, 'shortform.create', 'shortform', shortform.id, null, shortform);
    return shortform;
  }

  async updateShortform(user: AuthUser, shortformId: string, input: AdminPayload) {
    const before = await this.prisma.shortform.findUnique({ where: { id: shortformId } });
    const shortform = await this.prisma.shortform.update({
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

    await this.recordAudit(user, 'shortform.update', 'shortform', shortformId, before, shortform);
    return shortform;
  }

  async linkShortformAsset(user: AuthUser, shortformId: string, input: AdminPayload) {
    await this.ensureShortform(shortformId);
    const asset = await this.ensureAssetLinkable(this.string(input, 'assetId'));
    const role = this.assetRole(input, 'role', 'thumbnail');
    const sortOrder = this.number(input, 'sortOrder', 0);

    const result = await this.prisma.shortformAsset.upsert({
      where: {
        shortformId_assetId_role: {
          shortformId,
          assetId: asset.id,
          role,
        },
      },
      update: { sortOrder },
      create: {
        shortformId,
        assetId: asset.id,
        role,
        sortOrder,
      },
      include: { asset: true },
    });

    await this.recordAudit(
      user,
      'shortform_asset.link',
      'shortform',
      shortformId,
      null,
      result,
    );
    return result;
  }

  async unlinkShortformAsset(
    user: AuthUser,
    shortformId: string,
    shortformAssetId: string,
  ) {
    const link = await this.prisma.shortformAsset.findUnique({
      where: { id: shortformAssetId },
      include: { asset: true, shortform: true },
    });

    if (!link || link.shortformId !== shortformId) {
      throw new NotFoundException('Shortform asset link not found');
    }

    await this.prisma.shortformAsset.delete({
      where: { id: shortformAssetId },
    });

    const result = { deleted: true, link };
    await this.recordAudit(
      user,
      'shortform_asset.unlink',
      'shortform',
      shortformId,
      link,
      result,
    );
    return result;
  }

  async createLuminaProduct(user: AuthUser, input: AdminPayload) {
    const product = await this.prisma.luminaProduct.create({
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

    await this.recordAudit(
      user,
      'lumina_product.create',
      'lumina_product',
      product.id,
      null,
      product,
    );
    return product;
  }

  async updateLuminaProduct(user: AuthUser, productId: string, input: AdminPayload) {
    const before = await this.prisma.luminaProduct.findUnique({ where: { id: productId } });
    const product = await this.prisma.luminaProduct.update({
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

    await this.recordAudit(
      user,
      'lumina_product.update',
      'lumina_product',
      productId,
      before,
      product,
    );
    return product;
  }

  async createGiftProduct(user: AuthUser, input: AdminPayload) {
    const product = await this.prisma.giftProduct.create({
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

    await this.recordAudit(user, 'gift_product.create', 'gift_product', product.id, null, product);
    return product;
  }

  async updateGiftProduct(user: AuthUser, productId: string, input: AdminPayload) {
    const before = await this.prisma.giftProduct.findUnique({ where: { id: productId } });
    const product = await this.prisma.giftProduct.update({
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

    await this.recordAudit(
      user,
      'gift_product.update',
      'gift_product',
      productId,
      before,
      product,
    );
    return product;
  }

  async createBoostProduct(user: AuthUser, input: AdminPayload) {
    const product = await this.prisma.boostProduct.create({
      data: {
        sku: this.string(input, 'sku'),
        name: this.string(input, 'name'),
        boostAmount: this.decimal(input, 'boostAmount'),
        priceLumina: this.decimal(input, 'priceLumina'),
        status: this.string(input, 'status', 'active'),
        metadata: this.json(input, 'metadata'),
      },
    });

    await this.recordAudit(
      user,
      'boost_product.create',
      'boost_product',
      product.id,
      null,
      product,
    );
    return product;
  }

  async updateBoostProduct(user: AuthUser, productId: string, input: AdminPayload) {
    const before = await this.prisma.boostProduct.findUnique({ where: { id: productId } });
    const product = await this.prisma.boostProduct.update({
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

    await this.recordAudit(
      user,
      'boost_product.update',
      'boost_product',
      productId,
      before,
      product,
    );
    return product;
  }

  async createBoostCampaign(user: AuthUser, input: AdminPayload) {
    const campaign = await this.prisma.boostCampaign.create({
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

    await this.recordAudit(
      user,
      'boost_campaign.create',
      'boost_campaign',
      campaign.id,
      null,
      campaign,
    );
    return campaign;
  }

  async updateBoostCampaign(user: AuthUser, campaignId: string, input: AdminPayload) {
    const before = await this.prisma.boostCampaign.findUnique({ where: { id: campaignId } });
    const campaign = await this.prisma.boostCampaign.update({
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

    await this.recordAudit(
      user,
      'boost_campaign.update',
      'boost_campaign',
      campaignId,
      before,
      campaign,
    );
    return campaign;
  }

  async snapshotBoostCampaign(user: AuthUser, campaignId: string) {
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
      await this.recordAudit(user, 'boost_campaign.snapshot', 'boost_campaign', campaignId, null, {
        rows: 0,
      });
      return [];
    }

    await this.prisma.artistRankingSnapshot.createMany({ data: rankedRows });
    const snapshots = await this.prisma.artistRankingSnapshot.findMany({
      where: { campaignId, snapshotAt },
      include: {
        artist: {
          select: { id: true, slug: true, displayName: true },
        },
      },
      orderBy: { rankNo: 'asc' },
    });

    await this.recordAudit(
      user,
      'boost_campaign.snapshot',
      'boost_campaign',
      campaignId,
      null,
      { rows: snapshots },
    );
    return snapshots;
  }

  async createPremiumVideoProduct(user: AuthUser, input: AdminPayload) {
    const product = await this.prisma.premiumVideoProduct.create({
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

    await this.recordAudit(
      user,
      'premium_video_product.create',
      'premium_video_product',
      product.id,
      null,
      product,
    );
    return product;
  }

  async updatePremiumVideoProduct(user: AuthUser, productId: string, input: AdminPayload) {
    const before = await this.prisma.premiumVideoProduct.findUnique({
      where: { id: productId },
    });
    const product = await this.prisma.premiumVideoProduct.update({
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

    await this.recordAudit(
      user,
      'premium_video_product.update',
      'premium_video_product',
      productId,
      before,
      product,
    );
    return product;
  }

  async linkPremiumVideoAsset(user: AuthUser, productId: string, input: AdminPayload) {
    await this.ensurePremiumVideoProduct(productId);
    const asset = await this.ensureAssetLinkable(this.string(input, 'assetId'));
    const role = this.assetRole(input, 'role', 'video');
    const sortOrder = this.number(input, 'sortOrder', 0);

    const result = await this.prisma.premiumVideoAsset.upsert({
      where: {
        premiumVideoProductId_assetId_role: {
          premiumVideoProductId: productId,
          assetId: asset.id,
          role,
        },
      },
      update: { sortOrder },
      create: {
        premiumVideoProductId: productId,
        assetId: asset.id,
        role,
        sortOrder,
      },
      include: { asset: true },
    });

    await this.recordAudit(
      user,
      'premium_video_asset.link',
      'premium_video_product',
      productId,
      null,
      result,
    );
    return result;
  }

  async unlinkPremiumVideoAsset(
    user: AuthUser,
    productId: string,
    premiumVideoAssetId: string,
  ) {
    const link = await this.prisma.premiumVideoAsset.findUnique({
      where: { id: premiumVideoAssetId },
      include: { asset: true, premiumVideoProduct: true },
    });

    if (!link || link.premiumVideoProductId !== productId) {
      throw new NotFoundException('Premium video asset link not found');
    }

    await this.prisma.premiumVideoAsset.delete({
      where: { id: premiumVideoAssetId },
    });

    const result = { deleted: true, link };
    await this.recordAudit(
      user,
      'premium_video_asset.unlink',
      'premium_video_product',
      productId,
      link,
      result,
    );
    return result;
  }

  async createChatFeatureProduct(user: AuthUser, input: AdminPayload) {
    const product = await this.prisma.chatFeatureProduct.create({
      data: {
        sku: this.string(input, 'sku'),
        name: this.string(input, 'name'),
        featureType: this.string(input, 'featureType'),
        priceLumina: this.decimal(input, 'priceLumina'),
        status: this.string(input, 'status', 'active'),
        metadata: this.json(input, 'metadata'),
      },
    });

    await this.recordAudit(
      user,
      'chat_feature_product.create',
      'chat_feature_product',
      product.id,
      null,
      product,
    );
    return product;
  }

  async updateChatFeatureProduct(user: AuthUser, productId: string, input: AdminPayload) {
    const before = await this.prisma.chatFeatureProduct.findUnique({
      where: { id: productId },
    });
    const product = await this.prisma.chatFeatureProduct.update({
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

    await this.recordAudit(
      user,
      'chat_feature_product.update',
      'chat_feature_product',
      productId,
      before,
      product,
    );
    return product;
  }

  private recordAudit(
    user: AuthUser,
    action: string,
    targetType: string,
    targetId: string | null,
    beforeData: unknown,
    afterData: unknown,
    metadata: AdminPayload = {},
  ) {
    return this.prisma.auditEvent.create({
      data: {
        actorUserId: user.id,
        actorType: 'admin',
        action,
        targetType,
        targetId,
        beforeData: this.toJson(beforeData),
        afterData: this.toJson(afterData),
        metadata: this.toJson(metadata),
      },
    });
  }

  private assetRelationInclude() {
    return {
      artistAssets: {
        include: {
          artist: {
            select: { id: true, slug: true, displayName: true, status: true },
          },
        },
      },
      shortformAssets: {
        include: {
          shortform: {
            select: { id: true, slug: true, title: true, status: true },
          },
        },
      },
      premiumVideoAssets: {
        include: {
          premiumVideoProduct: {
            select: { id: true, sku: true, title: true, status: true },
          },
        },
      },
    } satisfies Prisma.AssetInclude;
  }

  private presentAsset(
    asset: Prisma.AssetGetPayload<{
      include: ReturnType<AdminService['assetRelationInclude']>;
    }>,
  ) {
    const metadata = this.metadataObject(asset.metadata);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);
    const uploadStatus =
      typeof uploadIntent.status === 'string' ? uploadIntent.status : 'ready';
    const lifecycle = this.metadataObject(metadata.lifecycle);
    const lifecycleStatus =
      typeof lifecycle.status === 'string' ? lifecycle.status : 'active';

    return {
      id: asset.id,
      assetType: asset.assetType,
      visibility: asset.visibility,
      storageProvider: asset.storageProvider,
      storageKey: asset.storageKey,
      url: this.buildPublicAssetUrl(asset.storageKey),
      mimeType: asset.mimeType,
      fileSizeBytes: asset.fileSizeBytes?.toString() ?? null,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds?.toString() ?? null,
      checksum: asset.checksum,
      metadata: asset.metadata,
      uploadStatus,
      lifecycleStatus,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
      links: {
        artists: asset.artistAssets.map((link) => ({
          id: link.id,
          artistId: link.artistId,
          usageType: link.usageType,
          isPrimary: link.isPrimary,
          sortOrder: link.sortOrder,
          artist: link.artist,
        })),
        shortforms: asset.shortformAssets.map((link) => ({
          id: link.id,
          shortformId: link.shortformId,
          role: link.role,
          sortOrder: link.sortOrder,
          shortform: link.shortform,
        })),
        premiumVideos: asset.premiumVideoAssets.map((link) => ({
          id: link.id,
          premiumVideoProductId: link.premiumVideoProductId,
          role: link.role,
          sortOrder: link.sortOrder,
          premiumVideoProduct: link.premiumVideoProduct,
        })),
      },
    };
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

  private async ensureShortform(shortformId: string) {
    const shortform = await this.prisma.shortform.findUnique({
      where: { id: shortformId },
    });

    if (!shortform) {
      throw new NotFoundException('Shortform not found');
    }
  }

  private async ensurePremiumVideoProduct(productId: string) {
    const product = await this.prisma.premiumVideoProduct.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException('Premium video product not found');
    }
  }

  private async ensureAssetLinkable(assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const metadata = this.metadataObject(asset.metadata);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);

    if (uploadIntent.status && uploadIntent.status !== 'uploaded') {
      throw new BadRequestException('Asset upload must be confirmed before linking');
    }

    const lifecycle = this.metadataObject(metadata.lifecycle);

    if (lifecycle.status === 'archived') {
      throw new BadRequestException('Archived assets cannot be linked');
    }

    return asset;
  }

  private async findAdminTargetUser(input: AdminPayload) {
    const userId = this.optionalString(input, 'userId');
    const email = this.optionalString(input, 'email')?.toLowerCase();

    if (!userId && !email) {
      throw new BadRequestException('userId or email is required');
    }

    const targetUser = userId
      ? await this.prisma.user.findUnique({ where: { id: userId } })
      : await this.prisma.user.findUnique({ where: { email } });

    if (!targetUser || targetUser.status !== 'active' || targetUser.deletedAt) {
      throw new NotFoundException('Active user not found');
    }

    return targetUser;
  }

  private async findAdminRole(roleName: string) {
    const role = await this.prisma.adminRole.findUnique({
      where: { name: roleName },
    });

    if (!role) {
      throw new NotFoundException('Admin role not found');
    }

    return role;
  }

  private assertSuperAdmin(user: AuthUser) {
    if (
      user.adminRole !== 'super_admin' &&
      !user.adminPermissions?.includes('*')
    ) {
      throw new ForbiddenException('Super admin access is required');
    }
  }

  private adminStatus(input: AdminPayload, key: string, fallback?: string) {
    const status = this.string(input, key, fallback);

    if (!['active', 'suspended', 'revoked'].includes(status)) {
      throw new BadRequestException(`${key} must be active, suspended, or revoked`);
    }

    return status;
  }

  private visibility(input: AdminPayload, key: string, fallback: string) {
    const visibility = this.string(input, key, fallback);

    if (!['public', 'private'].includes(visibility)) {
      throw new BadRequestException(`${key} must be public or private`);
    }

    return visibility;
  }

  private assetTypeFromInput(input: AdminPayload, mimeType: string) {
    const value = this.string(input, 'assetType', mimeType.startsWith('video/') ? 'video' : 'image');

    if (!['image', 'video'].includes(value)) {
      throw new BadRequestException('assetType must be image or video');
    }

    if (value === 'image' && !mimeType.startsWith('image/')) {
      throw new BadRequestException('image assets must use an image mimeType');
    }

    if (value === 'video' && !mimeType.startsWith('video/')) {
      throw new BadRequestException('video assets must use a video mimeType');
    }

    return value;
  }

  private allowedMimeType(mimeType: string) {
    const allowed = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
      'video/webm',
      'video/quicktime',
    ]);

    if (!allowed.has(mimeType)) {
      throw new BadRequestException('mimeType is not allowed');
    }

    return mimeType;
  }

  private fileSizeBytes(input: AdminPayload, assetType: string) {
    const size = this.number(input, 'fileSizeBytes');
    const maxSize =
      assetType === 'video'
        ? this.numberFromEnv('MAX_VIDEO_UPLOAD_BYTES', 524_288_000)
        : this.numberFromEnv('MAX_IMAGE_UPLOAD_BYTES', 20_971_520);

    if (!Number.isInteger(size) || size < 1) {
      throw new BadRequestException('fileSizeBytes must be a positive integer');
    }

    if (size > maxSize) {
      throw new BadRequestException(`fileSizeBytes must be less than or equal to ${maxSize}`);
    }

    return BigInt(size);
  }

  private safeFileName(fileName: string) {
    const cleaned = fileName
      .normalize('NFKD')
      .replace(/[^\w.\-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .toLowerCase();

    if (!cleaned || !cleaned.includes('.')) {
      throw new BadRequestException('fileName must include a safe extension');
    }

    return cleaned.slice(0, 120);
  }

  private buildStorageKey(assetType: string, fileName: string) {
    const date = new Date();
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const prefix = this.storageKeyPrefix();
    const path = `uploads/${assetType}s/${yyyy}/${mm}/${dd}/${randomUUID()}-${fileName}`;

    return prefix ? `${prefix}/${path}` : path;
  }

  private buildUploadUrl(storageProvider: string, storageKey: string, expiresInSeconds: number) {
    if (storageProvider === 'r2' || storageProvider === 's3') {
      return this.buildS3CompatiblePresignedPutUrl(storageProvider, storageKey, expiresInSeconds);
    }

    if (storageProvider !== 'local') {
      throw new BadRequestException('OBJECT_STORAGE_PROVIDER must be local, r2, or s3');
    }

    return `/pending-local-upload/${storageKey}`;
  }

  private async assertObjectUploaded(storageProvider: string, storageKey: string) {
    if (storageProvider === 'local') {
      return;
    }

    if (storageProvider === 'r2' || storageProvider === 's3') {
      const response = await fetch(
        this.buildS3CompatibleSignedHeadUrl(storageProvider, storageKey),
        { method: 'HEAD' },
      );

      if (response.status === 404) {
        throw new BadRequestException('Uploaded object was not found in storage');
      }

      if (!response.ok) {
        throw new BadRequestException('Could not verify uploaded object');
      }

      return;
    }

    throw new BadRequestException('OBJECT_STORAGE_PROVIDER must be local, r2, or s3');
  }

  private buildPublicAssetUrl(storageKey: string) {
    const baseUrl = this.configService.get<string>('OBJECT_STORAGE_PUBLIC_BASE_URL');

    if (baseUrl) {
      return `${baseUrl.replace(/\/+$/, '')}/${storageKey}`;
    }

    return null;
  }

  private buildS3CompatiblePresignedPutUrl(
    storageProvider: string,
    storageKey: string,
    expiresInSeconds: number,
  ) {
    const bucket = this.envString('OBJECT_STORAGE_BUCKET');
    const region = this.configService.get<string>('OBJECT_STORAGE_REGION') ?? 'auto';
    const accessKeyId = this.envString('OBJECT_STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = this.envString('OBJECT_STORAGE_SECRET_ACCESS_KEY');
    const now = new Date();
    const amzDate = this.amzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const endpoint = this.buildObjectStorageEndpoint(storageProvider, bucket, region);
    const url = new URL(this.joinUrlPath(endpoint, storageKey));
    const credential = `${accessKeyId}/${scope}`;
    const signedHeaders = 'host';

    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresInSeconds),
      'X-Amz-SignedHeaders': signedHeaders,
    };

    const canonicalQuery = this.canonicalQueryString(query);
    const canonicalRequest = [
      'PUT',
      this.canonicalUri(url.pathname),
      canonicalQuery,
      `host:${url.host}\n`,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      this.sha256Hex(canonicalRequest),
    ].join('\n');
    const signature = this.hmacHex(
      this.signingKey(secretAccessKey, dateStamp, region, 's3'),
      stringToSign,
    );

    url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    return url.toString();
  }

  private buildS3CompatibleSignedHeadUrl(storageProvider: string, storageKey: string) {
    const bucket = this.envString('OBJECT_STORAGE_BUCKET');
    const region = this.configService.get<string>('OBJECT_STORAGE_REGION') ?? 'auto';
    const accessKeyId = this.envString('OBJECT_STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = this.envString('OBJECT_STORAGE_SECRET_ACCESS_KEY');
    const now = new Date();
    const amzDate = this.amzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const endpoint = this.buildObjectStorageEndpoint(storageProvider, bucket, region);
    const url = new URL(this.joinUrlPath(endpoint, storageKey));
    const credential = `${accessKeyId}/${scope}`;
    const signedHeaders = 'host';
    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': '60',
      'X-Amz-SignedHeaders': signedHeaders,
    };
    const canonicalQuery = this.canonicalQueryString(query);
    const canonicalRequest = [
      'HEAD',
      this.canonicalUri(url.pathname),
      canonicalQuery,
      `host:${url.host}\n`,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      this.sha256Hex(canonicalRequest),
    ].join('\n');
    const signature = this.hmacHex(
      this.signingKey(secretAccessKey, dateStamp, region, 's3'),
      stringToSign,
    );

    url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    return url.toString();
  }

  private buildObjectStorageEndpoint(storageProvider: string, bucket: string, region: string) {
    const configuredEndpoint = this.configService.get<string>('OBJECT_STORAGE_ENDPOINT');

    if (configuredEndpoint) {
      return `${configuredEndpoint.replace(/\/+$/, '')}/${bucket}`;
    }

    if (storageProvider === 's3') {
      return `https://${bucket}.s3.${region}.amazonaws.com`;
    }

    throw new BadRequestException('OBJECT_STORAGE_ENDPOINT is required for r2 storage');
  }

  private joinUrlPath(baseUrl: string, storageKey: string) {
    return `${baseUrl.replace(/\/+$/, '')}/${storageKey
      .split('/')
      .map((part) => this.rfc3986Encode(part))
      .join('/')}`;
  }

  private canonicalUri(pathname: string) {
    return pathname
      .split('/')
      .map((part) => this.rfc3986Encode(decodeURIComponent(part)))
      .join('/');
  }

  private canonicalQueryString(query: Record<string, string>) {
    return Object.entries(query)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${this.rfc3986Encode(key)}=${this.rfc3986Encode(value)}`)
      .join('&');
  }

  private rfc3986Encode(value: string) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  }

  private amzDate(date: Date) {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  }

  private sha256Hex(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private signingKey(secretAccessKey: string, dateStamp: string, region: string, service: string) {
    const dateKey = this.hmacBuffer(`AWS4${secretAccessKey}`, dateStamp);
    const dateRegionKey = this.hmacBuffer(dateKey, region);
    const dateRegionServiceKey = this.hmacBuffer(dateRegionKey, service);
    return this.hmacBuffer(dateRegionServiceKey, 'aws4_request');
  }

  private hmacBuffer(key: string | Buffer, value: string) {
    return createHmac('sha256', key).update(value).digest();
  }

  private hmacHex(key: string | Buffer, value: string) {
    return createHmac('sha256', key).update(value).digest('hex');
  }

  private envString(key: string) {
    const value = this.configService.get<string>(key);

    if (!value) {
      throw new BadRequestException(`${key} environment variable is required`);
    }

    return value;
  }

  private storageKeyPrefix() {
    const value = this.configService.get<string>('OBJECT_STORAGE_KEY_PREFIX');

    if (!value) {
      return '';
    }

    return value
      .trim()
      .replace(/^\/+|\/+$/g, '')
      .replace(/\/+/g, '/')
      .split('/')
      .map((part) =>
        part
          .normalize('NFKD')
          .replace(/[^\w.\-]+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^[-.]+|[-.]+$/g, '')
          .toLowerCase(),
      )
      .filter(Boolean)
      .join('/');
  }

  private numberFromEnv(key: string, fallback: number) {
    const value = this.configService.get<string>(key);

    if (!value) {
      return fallback;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new BadRequestException(`${key} must be a positive number`);
    }

    return parsed;
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

  private boolean(input: AdminPayload, key: string, fallback: boolean) {
    const value = input[key] ?? fallback;

    if (typeof value === 'boolean') {
      return value;
    }

    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    throw new BadRequestException(`${key} must be a boolean`);
  }

  private assetRole(input: AdminPayload, key: string, fallback: string) {
    const value = this.string(input, key, fallback);

    if (!/^[a-z][a-z0-9_-]{1,40}$/.test(value)) {
      throw new BadRequestException(`${key} must be a safe role string`);
    }

    return value;
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

  private metadataObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as AdminPayload)
      : {};
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

  private toJson(value: unknown) {
    if (value === null || value === undefined) {
      return Prisma.JsonNull;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
