import { createHash, createHmac, randomUUID } from 'crypto';
import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as sharp from 'sharp';
import { buildPublicAssetUrl } from '../common/asset-url';
import { PrismaService } from '../prisma/prisma.service';

type UserAssetBody = Record<string, unknown>;
type UserAssetQuery = Record<string, string | undefined>;
type SourceImageDownload = {
  buffer: Buffer;
  contentType: string | null;
  contentLength: number | null;
  bodyLength: number;
  detectedMimeType: string | null;
  prefixHex: string;
};
type FeedImageDerivativeContext = {
  assetId: string;
  requestId?: string;
  source?: Omit<SourceImageDownload, 'buffer'>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEED_IMAGE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const USER_IMAGE_UPLOAD_MAX_BYTES = FEED_IMAGE_UPLOAD_MAX_BYTES;
const FEED_IMAGE_DISPLAY_MAX_EDGE = 2048;
const FEED_IMAGE_THUMBNAIL_MAX_EDGE = 768;
const FEED_IMAGE_DISPLAY_QUALITY = 82;
const FEED_IMAGE_THUMBNAIL_QUALITY = 78;
const USER_ASSET_DERIVATIVE_VARIANTS = new Set(['original', 'display', 'thumbnail']);
const USER_ASSET_UPLOAD_STATUSES = new Set(['all', 'pending_upload', 'uploaded', 'ready']);
const USER_ASSET_LIFECYCLE_STATUSES = new Set(['active', 'archived']);

@Injectable()
export class UserAssetsService {
  private readonly logger = new Logger(UserAssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async listAssets(userId: string, query: UserAssetQuery) {
    const take = this.take(query.take, 30, 100);
    const cursor = this.optionalQueryString(query.cursor);
    const uploadStatus = this.userAssetUploadStatus(query.uploadStatus ?? query.status);
    const lifecycleStatus = this.userAssetLifecycleStatus(query.lifecycleStatus);
    const assetType = this.optionalQueryString(query.assetType) ?? 'image';

    if (assetType !== 'image') {
      throw new BadRequestException('assetType must be image for user assets');
    }

    const filters: Prisma.AssetWhereInput[] = [
      this.userAssetOwnerWhere(userId),
      { assetType: 'image' },
    ];

    if (uploadStatus && uploadStatus !== 'all' && uploadStatus !== 'ready') {
      filters.push({
        metadata: {
          path: ['uploadIntent', 'status'],
          equals: uploadStatus,
        },
      });
    }

    if (lifecycleStatus === 'archived') {
      filters.push({
        metadata: {
          path: ['lifecycle', 'status'],
          equals: 'archived',
        },
      });
    } else {
      filters.push({
        OR: [
          {
            metadata: {
              path: ['lifecycle', 'status'],
              equals: Prisma.JsonNull,
            },
          },
          {
            NOT: {
              metadata: {
                path: ['lifecycle', 'status'],
                equals: 'archived',
              },
            },
          },
        ],
      });
    }

    const rows = await this.prisma.asset.findMany({
      where: { AND: filters },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const lastItem = items.at(-1);

    return {
      items: items.map((asset) => this.presentAsset(asset)),
      count: items.length,
      hasMore,
      nextCursor: hasMore && lastItem ? lastItem.id : null,
      policy: this.userAssetPolicy(),
    };
  }

  async getAsset(userId: string, assetId: string) {
    const asset = await this.findUserAsset(userId, assetId);

    return {
      asset: this.presentAsset(asset),
      usage: await this.assetUsage(asset.id, userId),
      policy: this.userAssetPolicy(),
    };
  }

  async createUploadIntent(userId: string, input: UserAssetBody) {
    const fileName = this.safeFileName(this.string(input, 'fileName'));
    const mimeType = this.imageMimeType(input, fileName);
    const fileSizeBytes = this.imageFileSizeBytes(input);
    const storageProvider = this.configService.get<string>('OBJECT_STORAGE_PROVIDER') ?? 'local';
    const storageKey = this.buildStorageKey(fileName);
    const expiresInSeconds = this.numberFromEnv('OBJECT_UPLOAD_INTENT_TTL_SECONDS', 900);
    const uploadUrl = this.buildUploadUrl(
      storageProvider,
      storageKey,
      expiresInSeconds,
      mimeType,
    );
    const publicUrl = buildPublicAssetUrl(this.configService, storageKey, null);

    const asset = await this.prisma.asset.create({
      data: {
        assetType: 'image',
        visibility: 'public',
        storageProvider,
        storageKey,
        mimeType,
        fileSizeBytes,
        width: this.optionalNumber(input, 'width'),
        height: this.optionalNumber(input, 'height'),
        checksum: this.optionalString(input, 'checksum'),
        metadata: this.toJson({
          uploadIntent: {
            status: 'pending_upload',
            scope: 'user_image',
            createdByUserId: userId,
            fileName,
            createdAt: new Date().toISOString(),
          },
        }),
      },
    });

    return {
      asset: this.presentAsset(asset),
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
  }

  async confirmUpload(
    userId: string,
    assetId: string,
    input: UserAssetBody,
    requestId?: string,
  ) {
    const asset = await this.findUserAsset(userId, assetId);
    const metadata = this.metadataObject(asset.metadata);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);

    if (input.fileSizeBytes !== undefined) {
      this.imageFileSizeBytes(input);
    }

    const uploadedObject = await this.assertObjectUploaded(
      asset.storageProvider,
      asset.storageKey,
    );
    const maxSize = this.numberFromEnv(
      'MAX_IMAGE_UPLOAD_BYTES',
      USER_IMAGE_UPLOAD_MAX_BYTES,
    );

    if (uploadedObject.fileSizeBytes && uploadedObject.fileSizeBytes > maxSize) {
      throw this.feedImageTooLargeException(maxSize);
    }

    const derivatives = await this.runConfirmUploadStage(
      asset.id,
      requestId,
      'create-derivatives',
      () => this.createFeedImageDerivatives(asset, requestId),
    );

    const confirmedAt = new Date().toISOString();
    const updatedAsset = await this.runConfirmUploadStage(
      asset.id,
      requestId,
      'update-asset-metadata',
      () =>
        this.prisma.asset.update({
          where: { id: asset.id },
          data: {
            metadata: this.toJson({
              ...metadata,
              uploadIntent: {
                ...uploadIntent,
                status: 'uploaded',
                confirmedByUserId: userId,
                confirmedAt,
                objectETag: this.optionalString(input, 'objectETag'),
              },
              derivatives,
            }),
            updatedAt: new Date(),
          },
        }),
    );
    const presentedAsset = await this.runConfirmUploadStage(
      asset.id,
      requestId,
      'present-confirmed-asset',
      async () => this.presentAsset(updatedAsset),
    );
    const publicDerivatives = await this.runConfirmUploadStage(
      asset.id,
      requestId,
      'public-derivative-summary',
      async () => this.publicDerivativeSummary(updatedAsset.metadata),
    );

    return {
      asset: presentedAsset,
      upload: {
        status: 'uploaded',
        confirmedAt,
        publicUrl: buildPublicAssetUrl(this.configService, updatedAsset.storageKey, null),
        derivatives: publicDerivatives,
      },
    };
  }

  async archiveAsset(userId: string, assetId: string, input: UserAssetBody) {
    const asset = await this.findUserAsset(userId, assetId);
    const usage = await this.assetUsage(asset.id, userId);
    const force = this.optionalBoolean(input, 'force') ?? false;

    if (!force && usage.blockingReasons.length > 0) {
      throw new BadRequestException({
        code: 'ASSET_IN_USE',
        message: 'Asset is still in use',
        details: {
          blockingReasons: usage.blockingReasons,
          usage,
        },
      });
    }

    const metadata = this.metadataObject(asset.metadata);
    const archivedAt = new Date().toISOString();
    const archivedAsset = await this.prisma.asset.update({
      where: { id: asset.id },
      data: {
        metadata: this.toJson({
          ...metadata,
          lifecycle: {
            ...this.metadataObject(metadata.lifecycle),
            status: 'archived',
            archivedByUserId: userId,
            archivedAt,
            archiveReason: this.optionalString(input, 'reason') ?? null,
            forced: force,
          },
        }),
        updatedAt: new Date(),
      },
    });

    return {
      asset: this.presentAsset(archivedAsset),
      usage,
      message: 'Asset archived',
    };
  }

  async restoreAsset(userId: string, assetId: string) {
    const asset = await this.findUserAsset(userId, assetId);
    const metadata = this.metadataObject(asset.metadata);
    const restoredAt = new Date().toISOString();
    const restoredAsset = await this.prisma.asset.update({
      where: { id: asset.id },
      data: {
        metadata: this.toJson({
          ...metadata,
          lifecycle: {
            ...this.metadataObject(metadata.lifecycle),
            status: 'active',
            restoredByUserId: userId,
            restoredAt,
          },
        }),
        updatedAt: new Date(),
      },
    });

    return {
      asset: this.presentAsset(restoredAsset),
      message: 'Asset restored',
    };
  }

  async getPublicAssetDeliveryUrl(assetId: string, variant = 'original') {
    if (!UUID_PATTERN.test(assetId)) {
      throw new BadRequestException('assetId must be a UUID');
    }

    if (!USER_ASSET_DERIVATIVE_VARIANTS.has(variant)) {
      throw new BadRequestException('variant must be original, display, or thumbnail');
    }

    const asset = await this.prisma.asset.findFirst({
      where: {
        id: assetId,
        visibility: 'public',
      },
    });

    if (!asset || !this.isPublicDeliverableAsset(asset)) {
      throw new NotFoundException('Asset not found');
    }

    const derivative = this.assetDerivative(asset.metadata, variant);
    const storageProvider = this.deliveryStorageProvider(
      derivative?.storageProvider ?? asset.storageProvider,
    );
    const selectedStorageKey = derivative?.storageKey ?? asset.storageKey;

    if (storageProvider === 's3' || storageProvider === 'r2') {
      const storageKey = await this.resolveReadableObjectStorageKey(
        storageProvider,
        selectedStorageKey,
      );

      return this.buildS3CompatibleSignedReadUrl(
        storageProvider,
        storageKey,
        this.numberFromEnv('OBJECT_PUBLIC_READ_URL_TTL_SECONDS', 300),
      );
    }

    return buildPublicAssetUrl(this.configService, selectedStorageKey, selectedStorageKey);
  }

  private presentAsset(asset: {
    id: string;
    assetType: string;
    visibility: string;
    storageProvider: string;
    storageKey: string;
    mimeType: string;
    fileSizeBytes: bigint | null;
    width: number | null;
    height: number | null;
    metadata: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const metadata = this.metadataObject(asset.metadata);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);
    const lifecycle = this.metadataObject(metadata.lifecycle);

    return {
      id: asset.id,
      assetType: asset.assetType,
      visibility: asset.visibility,
      mimeType: asset.mimeType,
      fileSizeBytes: asset.fileSizeBytes?.toString() ?? null,
      width: asset.width,
      height: asset.height,
      url: this.publicAssetProxyUrl(asset.id, 'original'),
      displayUrl: this.assetDerivative(asset.metadata, 'display')
        ? this.publicAssetProxyUrl(asset.id, 'display')
        : this.publicAssetProxyUrl(asset.id, 'original'),
      thumbnailUrl: this.assetDerivative(asset.metadata, 'thumbnail')
        ? this.publicAssetProxyUrl(asset.id, 'thumbnail')
        : this.publicAssetProxyUrl(asset.id, 'original'),
      derivatives: this.publicDerivativeSummary(asset.metadata),
      uploadStatus:
        typeof uploadIntent.status === 'string' ? uploadIntent.status : 'ready',
      lifecycleStatus:
        typeof lifecycle.status === 'string' ? lifecycle.status : 'active',
      owner: {
        userId:
          typeof uploadIntent.createdByUserId === 'string'
            ? uploadIntent.createdByUserId
            : null,
      },
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    };
  }

  private async createFeedImageDerivatives(asset: {
    id: string;
    storageProvider: string;
    storageKey: string;
    mimeType: string;
    metadata: Prisma.JsonValue;
  }, requestId?: string) {
    const context: FeedImageDerivativeContext = { assetId: asset.id, requestId };
    const storageProvider = this.deliveryStorageProvider(asset.storageProvider);

    if (storageProvider !== 's3' && storageProvider !== 'r2') {
      return this.existingDerivatives(asset.metadata);
    }

    const sourceStorageKey = await this.runDerivativeStage(
      context,
      'resolve-source-key',
      () => this.resolveReadableObjectStorageKey(storageProvider, asset.storageKey),
    );
    const source = await this.runDerivativeStage(context, 'download-source', () =>
      this.downloadObjectBuffer(storageProvider, sourceStorageKey),
    );
    const sourceBuffer = source.buffer;
    context.source = this.publicSourceImageDiagnostics(source);
    const sourceMetadata = await this.readSourceMetadata(sourceBuffer, context);
    const display = await this.runDerivativeStage(context, 'build-display', () =>
      this.buildImageDerivative(sourceBuffer, {
        maxEdge: FEED_IMAGE_DISPLAY_MAX_EDGE,
        quality: FEED_IMAGE_DISPLAY_QUALITY,
      }),
    );
    const thumbnail = await this.runDerivativeStage(context, 'build-thumbnail', () =>
      this.buildImageDerivative(sourceBuffer, {
        maxEdge: FEED_IMAGE_THUMBNAIL_MAX_EDGE,
        quality: FEED_IMAGE_THUMBNAIL_QUALITY,
      }),
    );
    const displayStorageKey = this.derivativeStorageKey(
      sourceStorageKey,
      'display',
      display.extension,
    );
    const thumbnailStorageKey = this.derivativeStorageKey(
      sourceStorageKey,
      'thumbnail',
      thumbnail.extension,
    );

    await this.runDerivativeStage(context, 'upload-derivatives', () =>
      Promise.all([
        this.uploadObjectBuffer(
          storageProvider,
          displayStorageKey,
          display.mimeType,
          display.buffer,
        ),
        this.uploadObjectBuffer(
          storageProvider,
          thumbnailStorageKey,
          thumbnail.mimeType,
          thumbnail.buffer,
        ),
      ]),
    );

    return {
      original: {
        storageProvider,
        storageKey: sourceStorageKey,
        mimeType: asset.mimeType,
        width: sourceMetadata.width ?? null,
        height: sourceMetadata.height ?? null,
        preserved: true,
      },
      display: {
        storageProvider,
        storageKey: displayStorageKey,
        mimeType: display.mimeType,
        width: display.width,
        height: display.height,
        fileSizeBytes: display.buffer.length,
        maxEdge: FEED_IMAGE_DISPLAY_MAX_EDGE,
      },
      thumbnail: {
        storageProvider,
        storageKey: thumbnailStorageKey,
        mimeType: thumbnail.mimeType,
        width: thumbnail.width,
        height: thumbnail.height,
        fileSizeBytes: thumbnail.buffer.length,
        maxEdge: FEED_IMAGE_THUMBNAIL_MAX_EDGE,
      },
      policy: {
        source: 'feed_image_upload_v1',
        originalPreserved: true,
        displayMaxEdge: FEED_IMAGE_DISPLAY_MAX_EDGE,
        thumbnailMaxEdge: FEED_IMAGE_THUMBNAIL_MAX_EDGE,
        outputFormat: display.extension === 'webp' ? 'webp' : 'jpeg',
      },
      generatedAt: new Date().toISOString(),
    };
  }

  private async runDerivativeStage<T>(
    context: FeedImageDerivativeContext,
    stage: string,
    action: () => Promise<T>,
  ) {
    try {
      return await action();
    } catch (error) {
      this.logger.warn({
        event: 'feed_image_derivative_failed',
        assetId: context.assetId,
        requestId: context.requestId,
        stage,
        reason: this.safeErrorMessage(error),
        diagnostics: this.safeErrorDetails(error) ?? context.source ?? null,
      });

      if (this.isHttpExceptionLike(error)) {
        throw error;
      }

      throw new BadRequestException({
        code: 'FEED_IMAGE_DERIVATIVE_FAILED',
        message: 'Could not process uploaded feed image',
        details: {
          stage,
          requestId: context.requestId ?? null,
          reason: this.safeErrorMessage(error),
        },
      });
    }
  }

  private async runConfirmUploadStage<T>(
    assetId: string,
    requestId: string | undefined,
    stage: string,
    action: () => Promise<T>,
  ) {
    try {
      return await action();
    } catch (error) {
      this.logger.error({
        event: 'feed_image_confirm_upload_failed',
        assetId,
        requestId,
        stage,
        reason: this.safeErrorMessage(error),
      });

      if (this.isHttpExceptionLike(error)) {
        throw error;
      }

      throw new BadRequestException({
        code: 'FEED_IMAGE_CONFIRM_UPLOAD_FAILED',
        message: 'Could not confirm uploaded feed image',
        details: {
          stage,
          requestId: requestId ?? null,
          reason: this.safeErrorMessage(error),
        },
      });
    }
  }

  private async readSourceMetadata(
    sourceBuffer: Buffer,
    context: FeedImageDerivativeContext,
  ) {
    try {
      return await sharp(sourceBuffer, { animated: false, failOn: 'none' }).metadata();
    } catch (error) {
      this.logger.warn({
        event: 'feed_image_source_metadata_unavailable',
        assetId: context.assetId,
        requestId: context.requestId,
        stage: 'read-source-metadata',
        reason: error instanceof Error ? error.message : 'unknown error',
        diagnostics: {
          source: context.source ?? null,
          sharp: this.safeSharpDiagnostics(),
        },
      });

      return { width: null, height: null };
    }
  }

  private async buildImageDerivative(
    sourceBuffer: Buffer,
    options: { maxEdge: number; quality: number },
  ) {
    const pipeline = sharp(sourceBuffer, { animated: false }).rotate().resize({
      width: options.maxEdge,
      height: options.maxEdge,
      fit: 'inside',
      withoutEnlargement: true,
    });
    let buffer: Buffer;
    let mimeType = 'image/webp';
    let extension = 'webp';

    try {
      buffer = await pipeline.clone().webp({ quality: options.quality }).toBuffer();
    } catch {
      buffer = await pipeline.jpeg({ quality: options.quality, mozjpeg: true }).toBuffer();
      mimeType = 'image/jpeg';
      extension = 'jpg';
    }

    const metadata = await sharp(buffer).metadata();

    return {
      buffer,
      mimeType,
      extension,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
    };
  }

  private async downloadObjectBuffer(
    storageProvider: string,
    storageKey: string,
  ): Promise<SourceImageDownload> {
    let response: Response;

    try {
      response = await fetch(
        this.buildS3CompatibleSignedReadUrl(storageProvider, storageKey, 60),
      );
    } catch {
      throw new BadRequestException({
        code: 'FEED_IMAGE_SOURCE_READ_FAILED',
        message: 'Could not read uploaded image for processing',
        details: { stage: 'download-source', storageProvider },
      });
    }

    if (!response.ok) {
      throw new BadRequestException({
        code: 'FEED_IMAGE_SOURCE_READ_FAILED',
        message: 'Could not read uploaded image for processing',
        details: {
          stage: 'download-source',
          storageProvider,
          status: response.status,
        },
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const diagnostics = this.sourceImageDiagnostics(response, buffer);

    if (!diagnostics.detectedMimeType) {
      throw new BadRequestException({
        code: 'FEED_IMAGE_SOURCE_NOT_IMAGE',
        message: 'Uploaded object is not a readable image',
        details: {
          stage: 'download-source',
          storageProvider,
          contentType: diagnostics.contentType,
          contentLength: diagnostics.contentLength,
          bodyLength: diagnostics.bodyLength,
          prefixHex: diagnostics.prefixHex,
        },
      });
    }

    this.logger.log({
      event: 'feed_image_source_downloaded',
      storageProvider,
      contentType: diagnostics.contentType,
      contentLength: diagnostics.contentLength,
      bodyLength: diagnostics.bodyLength,
      detectedMimeType: diagnostics.detectedMimeType,
    });

    return {
      buffer,
      ...diagnostics,
    };
  }

  private publicSourceImageDiagnostics(source: SourceImageDownload) {
    return {
      contentType: source.contentType,
      contentLength: source.contentLength,
      bodyLength: source.bodyLength,
      detectedMimeType: source.detectedMimeType,
      prefixHex: source.prefixHex,
    };
  }

  private async uploadObjectBuffer(
    storageProvider: string,
    storageKey: string,
    mimeType: string,
    buffer: Buffer,
  ) {
    const uploadUrl = this.buildS3CompatiblePresignedPutUrl(
      storageProvider,
      storageKey,
      this.numberFromEnv('OBJECT_UPLOAD_INTENT_TTL_SECONDS', 900),
      mimeType,
    );
    let response: Response;

    try {
      response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': mimeType },
        body: buffer as unknown as BodyInit,
      });
    } catch {
      throw new BadRequestException({
        code: 'FEED_IMAGE_DERIVATIVE_UPLOAD_FAILED',
        message: 'Could not write processed image derivative',
        details: { stage: 'upload-derivatives', storageProvider, mimeType },
      });
    }

    if (!response.ok) {
      throw new BadRequestException({
        code: 'FEED_IMAGE_DERIVATIVE_UPLOAD_FAILED',
        message: 'Could not write processed image derivative',
        details: {
          stage: 'upload-derivatives',
          storageProvider,
          mimeType,
          status: response.status,
        },
      });
    }
  }

  private derivativeStorageKey(storageKey: string, variant: string, extension: string) {
    const normalizedKey = storageKey.replace(/^\/+/, '');
    const slashIndex = normalizedKey.lastIndexOf('/');
    const directory = slashIndex >= 0 ? normalizedKey.slice(0, slashIndex) : '';
    const fileName = slashIndex >= 0 ? normalizedKey.slice(slashIndex + 1) : normalizedKey;
    const baseName = fileName.replace(/\.[^.]+$/, '');
    const derivativeFileName = `${baseName}.${variant}.${extension}`;

    return directory
      ? `${directory}/derivatives/${derivativeFileName}`
      : `derivatives/${derivativeFileName}`;
  }

  private sourceImageDiagnostics(response: Response, buffer: Buffer) {
    return {
      contentType: this.headerValue(response, 'content-type'),
      contentLength: this.headerNumber(response, 'content-length'),
      bodyLength: buffer.length,
      detectedMimeType: this.detectImageMimeType(buffer),
      prefixHex: buffer.subarray(0, 16).toString('hex'),
    };
  }

  private detectImageMimeType(buffer: Buffer) {
    if (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return 'image/jpeg';
    }

    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return 'image/png';
    }

    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp';
    }

    if (
      buffer.length >= 6 &&
      (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
        buffer.subarray(0, 6).toString('ascii') === 'GIF89a')
    ) {
      return 'image/gif';
    }

    return null;
  }

  private headerValue(response: Response, name: string) {
    return response.headers.get(name)?.split(';')[0].trim().toLowerCase() ?? null;
  }

  private headerNumber(response: Response, name: string) {
    const value = Number(response.headers.get(name));
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  private existingDerivatives(metadata: Prisma.JsonValue) {
    const derivatives = this.metadataObject(this.metadataObject(metadata).derivatives);
    return Object.keys(derivatives).length > 0 ? derivatives : {};
  }

  private assetDerivative(metadata: Prisma.JsonValue, variant: string) {
    if (variant === 'original') {
      return null;
    }

    const derivatives = this.metadataObject(this.metadataObject(metadata).derivatives);
    const derivative = this.metadataObject(derivatives[variant]);
    const storageKey =
      typeof derivative.storageKey === 'string' ? derivative.storageKey : null;

    if (!storageKey) {
      return null;
    }

    return {
      storageProvider:
        typeof derivative.storageProvider === 'string'
          ? derivative.storageProvider
          : undefined,
      storageKey,
      mimeType:
        typeof derivative.mimeType === 'string' ? derivative.mimeType : undefined,
    };
  }

  private publicDerivativeSummary(metadata: Prisma.JsonValue) {
    const derivatives = this.metadataObject(this.metadataObject(metadata).derivatives);

    return {
      original: this.publicDerivativeItem(derivatives.original),
      display: this.publicDerivativeItem(derivatives.display),
      thumbnail: this.publicDerivativeItem(derivatives.thumbnail),
      policy: this.publicDerivativePolicy(derivatives.policy),
      generatedAt:
        typeof derivatives.generatedAt === 'string' ? derivatives.generatedAt : null,
    };
  }

  private publicDerivativeItem(value: unknown) {
    const item = this.metadataObject(value);
    const width = this.numberOrNull(item.width);
    const height = this.numberOrNull(item.height);
    const fileSizeBytes = this.numberOrNull(item.fileSizeBytes);
    const maxEdge = this.numberOrNull(item.maxEdge);
    const mimeType = typeof item.mimeType === 'string' ? item.mimeType : null;

    if (!mimeType && width === null && height === null && fileSizeBytes === null) {
      return null;
    }

    return {
      mimeType,
      width,
      height,
      fileSizeBytes,
      maxEdge,
      preserved: typeof item.preserved === 'boolean' ? item.preserved : undefined,
    };
  }

  private publicDerivativePolicy(value: unknown) {
    const policy = this.metadataObject(value);

    if (Object.keys(policy).length === 0) {
      return null;
    }

    return {
      source: typeof policy.source === 'string' ? policy.source : null,
      originalPreserved:
        typeof policy.originalPreserved === 'boolean'
          ? policy.originalPreserved
          : null,
      displayMaxEdge: this.numberOrNull(policy.displayMaxEdge),
      thumbnailMaxEdge: this.numberOrNull(policy.thumbnailMaxEdge),
      outputFormat:
        typeof policy.outputFormat === 'string' ? policy.outputFormat : null,
    };
  }

  private publicAssetProxyUrl(assetId: string, variant: string) {
    const configuredBaseUrl =
      this.configService.get<string>('API_PUBLIC_BASE_URL') ??
      this.configService.get<string>('BACKEND_PUBLIC_BASE_URL');
    const baseUrl = configuredBaseUrl ?? 'https://api.lumina-stage.com';

    return `${baseUrl.replace(/\/+$/, '')}/api/v1/assets/public/${assetId}/${variant}`;
  }

  private numberOrNull(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private safeErrorMessage(error: unknown) {
    if (this.isHttpExceptionLike(error)) {
      const response = error.getResponse();
      if (typeof response === 'object' && response && 'message' in response) {
        return String((response as { message?: unknown }).message);
      }

      return error.message;
    }

    return error instanceof Error ? error.message : 'unknown error';
  }

  private safeErrorDetails(error: unknown) {
    if (!this.isHttpExceptionLike(error)) {
      return null;
    }

    const response = error.getResponse();
    if (!response || typeof response !== 'object' || !('details' in response)) {
      return null;
    }

    return (response as { details?: unknown }).details ?? null;
  }

  private isHttpExceptionLike(error: unknown): error is HttpException {
    if (error instanceof HttpException) {
      return true;
    }

    return (
      Boolean(error) &&
      typeof error === 'object' &&
      typeof (error as { getStatus?: unknown }).getStatus === 'function' &&
      typeof (error as { getResponse?: unknown }).getResponse === 'function'
    );
  }

  private safeSharpDiagnostics() {
    const sharpModule = sharp as unknown as {
      versions?: Record<string, string | undefined>;
    } | undefined;
    const versions = sharpModule?.versions ?? {};

    return {
      sharp: versions.sharp ?? null,
      vips: versions.vips ?? null,
      png: versions.png ?? null,
      webp: versions.webp ?? null,
      jpeg: versions.jpeg ?? versions.mozjpeg ?? null,
    };
  }

  private imageMimeType(input: UserAssetBody, fileName: string) {
    const rawMimeType =
      this.optionalString(input, 'mimeType') ??
      this.optionalString(input, 'contentType') ??
      this.inferImageMimeType(fileName);
    return this.allowedImageMimeType(rawMimeType);
  }

  private inferImageMimeType(fileName: string) {
    const extension = fileName.split('.').pop()?.toLowerCase();
    const byExtension: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
    };

    return extension ? byExtension[extension] : undefined;
  }

  private allowedImageMimeType(mimeType?: string) {
    if (mimeType === 'image/jpg') {
      return 'image/jpeg';
    }

    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

    if (!mimeType || !allowed.has(mimeType)) {
      throw new BadRequestException(
        'mimeType must be image/jpeg, image/png, image/webp, or image/gif',
      );
    }

    return mimeType;
  }

  private imageFileSizeBytes(input: UserAssetBody) {
    const size =
      input.fileSizeBytes !== undefined
        ? this.number(input, 'fileSizeBytes')
        : input.fileSize !== undefined
          ? this.number(input, 'fileSize')
          : this.number(input, 'size');
    const maxSize = this.numberFromEnv(
      'MAX_IMAGE_UPLOAD_BYTES',
      USER_IMAGE_UPLOAD_MAX_BYTES,
    );

    if (!Number.isInteger(size) || size < 1) {
      throw new BadRequestException('fileSizeBytes must be a positive integer');
    }

    if (size > maxSize) {
      throw this.feedImageTooLargeException(maxSize);
    }


    return BigInt(size);
  }

  private formatMegabytes(bytes: number) {
    return Math.floor(bytes / (1024 * 1024));
  }

  private feedImageTooLargeException(maxSize: number) {
    return new PayloadTooLargeException({
      code: 'PAYLOAD_TOO_LARGE',
      message: `Feed images must be ${this.formatMegabytes(maxSize)}MB or smaller.`,
      details: {
        field: 'fileSizeBytes',
        maxBytes: maxSize,
        maxMegabytes: this.formatMegabytes(maxSize),
      },
    });
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

  private buildStorageKey(fileName: string) {
    const date = new Date();
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const prefix = this.storageKeyPrefix();
    const path = `uploads/user-images/${yyyy}/${mm}/${dd}/${randomUUID()}-${fileName}`;

    return prefix ? `${prefix}/${path}` : path;
  }

  private buildUploadUrl(
    storageProvider: string,
    storageKey: string,
    expiresInSeconds: number,
    mimeType: string,
  ) {
    if (storageProvider === 'r2' || storageProvider === 's3') {
      return this.buildS3CompatiblePresignedPutUrl(
        storageProvider,
        storageKey,
        expiresInSeconds,
        mimeType,
      );
    }

    if (storageProvider !== 'local') {
      throw new BadRequestException('OBJECT_STORAGE_PROVIDER must be local, r2, or s3');
    }

    return `/pending-local-upload/${storageKey}`;
  }

  private async assertObjectUploaded(storageProvider: string, storageKey: string) {
    if (storageProvider === 'local') {
      return {};
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

      const contentLength = Number(response.headers.get('content-length'));

      return {
        fileSizeBytes:
          Number.isFinite(contentLength) && contentLength > 0
            ? contentLength
            : undefined,
      };
    }

    throw new BadRequestException('OBJECT_STORAGE_PROVIDER must be local, r2, or s3');
  }

  private buildS3CompatiblePresignedPutUrl(
    storageProvider: string,
    storageKey: string,
    expiresInSeconds: number,
    mimeType: string,
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
    const signedHeaders = 'content-type;host';
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
      `content-type:${mimeType}\nhost:${url.host}\n`,
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
    return this.buildS3CompatibleSignedReadUrl(storageProvider, storageKey, 60, 'HEAD');
  }

  private buildS3CompatibleSignedReadUrl(
    storageProvider: string,
    storageKey: string,
    expiresInSeconds: number,
    method: 'GET' | 'HEAD' = 'GET',
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
      method,
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

  private isPublicDeliverableAsset(asset: {
    assetType: string;
    metadata: Prisma.JsonValue;
  }) {
    if (asset.assetType !== 'image') {
      return false;
    }

    const metadata = this.metadataObject(asset.metadata);
    const uploadIntent = this.metadataObject(metadata.uploadIntent);
    const lifecycle = this.metadataObject(metadata.lifecycle);
    const uploadStatus =
      typeof uploadIntent.status === 'string' ? uploadIntent.status : 'ready';
    const lifecycleStatus =
      typeof lifecycle.status === 'string' ? lifecycle.status : 'active';

    return uploadStatus !== 'pending_upload' && lifecycleStatus !== 'archived';
  }

  private deliveryStorageProvider(assetStorageProvider: string) {
    if (assetStorageProvider === 's3' || assetStorageProvider === 'r2') {
      return assetStorageProvider;
    }

    const configuredProvider = this.configService.get<string>('OBJECT_STORAGE_PROVIDER');
    if (configuredProvider === 's3' || configuredProvider === 'r2') {
      return configuredProvider;
    }

    return assetStorageProvider;
  }

  private async resolveReadableObjectStorageKey(
    storageProvider: string,
    storageKey: string,
  ) {
    for (const candidate of this.objectStorageKeyCandidates(storageKey)) {
      if (await this.canReadObjectStorageKey(storageProvider, candidate)) {
        return candidate;
      }
    }

    return storageKey;
  }

  private objectStorageKeyCandidates(storageKey: string) {
    const prefix = this.storageKeyPrefix();
    const normalizedKey = storageKey.replace(/^\/+/, '');
    const candidates = [normalizedKey];

    if (prefix && !normalizedKey.startsWith(`${prefix}/`)) {
      candidates.push(`${prefix}/${normalizedKey}`);
    }

    if (prefix && normalizedKey.startsWith(`${prefix}/`)) {
      candidates.push(normalizedKey.slice(prefix.length + 1));
    }

    return [...new Set(candidates)];
  }

  private async canReadObjectStorageKey(storageProvider: string, storageKey: string) {
    try {
      const response = await fetch(
        this.buildS3CompatibleSignedHeadUrl(storageProvider, storageKey),
        { method: 'HEAD' },
      );

      return response.ok;
    } catch {
      return false;
    }
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

  private string(input: UserAssetBody, key: string) {
    const value = input[key];

    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${key} must be a non-empty string`);
    }

    return value.trim();
  }

  private optionalString(input: UserAssetBody, key: string) {
    const value = input[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private number(input: UserAssetBody, key: string) {
    const value = Number(input[key]);

    if (!Number.isFinite(value)) {
      throw new BadRequestException(`${key} must be a number`);
    }

    return value;
  }

  private optionalNumber(input: UserAssetBody, key: string) {
    return input[key] === undefined ? undefined : this.number(input, key);
  }

  private optionalBoolean(input: UserAssetBody, key: string) {
    const value = input[key];

    if (value === undefined) {
      return undefined;
    }

    if (value === true || value === 'true') {
      return true;
    }

    if (value === false || value === 'false') {
      return false;
    }

    throw new BadRequestException(`${key} must be a boolean`);
  }

  private metadataObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as UserAssetBody)
      : {};
  }

  private toJson(value: unknown) {
    if (value === null || value === undefined) {
      return Prisma.JsonNull;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private async findUserAsset(userId: string, assetId: string) {
    if (!UUID_PATTERN.test(assetId)) {
      throw new BadRequestException('assetId must be a UUID');
    }

    const asset = await this.prisma.asset.findFirst({
      where: {
        id: assetId,
        ...this.userAssetOwnerWhere(userId),
      },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    return asset;
  }

  private userAssetOwnerWhere(userId: string): Prisma.AssetWhereInput {
    return {
      metadata: {
        path: ['uploadIntent', 'createdByUserId'],
        equals: userId,
      },
    };
  }

  private async assetUsage(assetId: string, userId: string) {
    const [
      avatarProfile,
      coverProfile,
      feedLinks,
      creatorReferenceRequests,
      creatorResultRequests,
    ] =
      await Promise.all([
        this.prisma.userProfile.findFirst({
          where: { userId, avatarAssetId: assetId },
          select: { userId: true },
        }),
        this.prisma.userProfile.findFirst({
          where: { userId, coverAssetId: assetId },
          select: { userId: true },
        }),
        this.prisma.communityPostAsset.findMany({
          where: {
            assetId,
            post: {
              authorUserId: userId,
              status: 'published',
              deletedAt: null,
            },
          },
          select: { postId: true },
          take: 20,
        }),
        this.prisma.creatorImageRequest.findMany({
          where: { requesterUserId: userId },
          select: { id: true, referenceAssetIds: true },
          take: 100,
        }),
        this.prisma.creatorImageRequest.findMany({
          where: { requesterUserId: userId },
          select: { id: true, resultAssetIds: true },
          take: 100,
        }),
      ]);
    const referenceRequestIds = creatorReferenceRequests
      .filter((request) => this.jsonArrayContains(request.referenceAssetIds, assetId))
      .slice(0, 20)
      .map((request) => request.id);
    const resultRequestIds = creatorResultRequests
      .filter((request) => this.jsonArrayContains(request.resultAssetIds, assetId))
      .slice(0, 20)
      .map((request) => request.id);

    const blockingReasons = [
      ...(avatarProfile ? ['avatar'] : []),
      ...(coverProfile ? ['profile_cover'] : []),
      ...(feedLinks.length ? ['published_feed_post'] : []),
      ...(referenceRequestIds.length ? ['creator_image_reference'] : []),
      ...(resultRequestIds.length ? ['creator_image_result'] : []),
    ];

    return {
      avatar: Boolean(avatarProfile),
      profileCover: Boolean(coverProfile),
      feedPostIds: feedLinks.map((link) => link.postId),
      creatorImageReferenceRequestIds: referenceRequestIds,
      creatorImageResultRequestIds: resultRequestIds,
      blockingReasons,
    };
  }

  private jsonArrayContains(value: Prisma.JsonValue, expected: string) {
    return Array.isArray(value) && value.includes(expected);
  }

  private userAssetUploadStatus(value?: string) {
    const normalized = this.optionalQueryString(value);

    if (!normalized) {
      return undefined;
    }

    if (!USER_ASSET_UPLOAD_STATUSES.has(normalized)) {
      throw new BadRequestException(
        'status must be all, pending_upload, uploaded, or ready',
      );
    }

    return normalized;
  }

  private userAssetLifecycleStatus(value?: string) {
    const normalized = this.optionalQueryString(value) ?? 'active';

    if (!USER_ASSET_LIFECYCLE_STATUSES.has(normalized)) {
      throw new BadRequestException('lifecycleStatus must be active or archived');
    }

    return normalized;
  }

  private take(raw: string | undefined, fallback: number, max: number) {
    const parsed = raw ? Number(raw) : fallback;

    if (!Number.isInteger(parsed)) {
      throw new BadRequestException('take must be an integer');
    }

    return Math.max(1, Math.min(parsed, max));
  }

  private optionalQueryString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private userAssetPolicy() {
    return {
      assetTypes: ['image'],
      uploadStatuses: ['pending_upload', 'uploaded', 'ready'],
      lifecycleStatuses: ['active', 'archived'],
      maxImageUploadBytes: this.numberFromEnv(
        'MAX_IMAGE_UPLOAD_BYTES',
        USER_IMAGE_UPLOAD_MAX_BYTES,
      ),
      archive: {
        blocksWhenUsedAs: [
          'avatar',
          'profile_cover',
          'published_feed_post',
          'creator_image_reference',
          'creator_image_result',
        ],
        forceSupported: true,
        deletesObjectStorageFile: false,
      },
    };
  }
}
